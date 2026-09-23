/**
 * @fileoverview BCT15X serial communication controller
 * @description Manages serial port communications with the BCT15X scanner, handling command transmission and responses.
 */

const EventEmitter = require('events');
const { parseResponse, parseGlgResponse, parsePwrResponse, parseStsResponse } = require('./protocolParser');

/**
 * BCT15X serial communication controller class
 * @extends EventEmitter
 * @fires SerialController#data - On data received
 * @fires SerialController#connected - On connected
 * @fires SerialController#disconnected - On disconnected
 * @fires SerialController#error - On error
 */
class SerialController extends EventEmitter {
  /**
   * @param {Object} config - Serial port configuration
   * @param {string} config.path - Device path
   * @param {number} config.baudRate - Baud rate
   * @param {boolean} [mockMode=false] - Mock mode flag
   */
  constructor(config, mockMode = false) {
    super();

    /** @type {Object} Configuration */
    this._config = config;

    /** @type {boolean} Mock mode flag */
    this._mockMode = mockMode;

    /** @type {Object|null} SerialPort instance */
    this._port = null;

    /** @type {Object|null} Parser instance */
    this._parser = null;

    /** @type {boolean} Connection status */
    this._isConnected = false;

    /** @type {number|null} GLG polling timer */
    this._pollTimer = null;

    /** @type {number|null} PWR polling timer */
    this._pwrTimer = null;

    /** @type {number|null} STS polling timer */
    this._stsTimer = null;

    /** @type {Array<Function>} Command response awaiting queue */
    this._responseQueue = [];

    /** @type {number} Mock reception counter */
    this._mockCounter = 0;

    /** @type {boolean} Mock reception in-progress flag */
    this._mockReceiving = false;

    /** @type {Object} Mock menu state for simulation */
    this._mockMenuState = {
      active: false,
      stack: [], // Breadcrumb path of menu objects
      cursor: 0,
    };
  }

  /**
   * Connect to serial port
   * @returns {Promise<void>}
   */
  async connect() {
    if (this._mockMode) {
      return this._connectMock();
    }

    try {
      // Dynamically load serialport module (installed in Docker environment)
      const { SerialPort } = require('serialport');
      const { ReadlineParser } = require('@serialport/parser-readline');

      this._port = new SerialPort({
        path: this._config.path,
        baudRate: this._config.baudRate,
        dataBits: this._config.dataBits || 8,
        parity: this._config.parity || 'none',
        stopBits: this._config.stopBits || 1,
        rtscts: this._config.rtscts || false,
      });

      this._parser = this._port.pipe(
        new ReadlineParser({
          delimiter: this._config.delimiter || '\r',
          encoding: 'latin1',
        })
      );

      // Data reception handler
      this._parser.on('data', (data) => {
        this._onData(data);
      });

      // Open event
      this._port.on('open', () => {
        this._isConnected = true;
        console.log(`[SerialController] Connected to port: ${this._config.path}`);
        this.emit('connected');
      });

      // Error handler
      this._port.on('error', (err) => {
        console.error(`[SerialController] Serial error:`, err.message);
        this.emit('error', err);
      });

      // Close handler
      this._port.on('close', () => {
        this._isConnected = false;
        console.log('[SerialController] Port disconnected');
        this.emit('disconnected');
      });

      // Await open completion
      await new Promise((resolve, reject) => {
        this._port.on('open', resolve);
        this._port.on('error', reject);
      });
    } catch (err) {
      console.error('[SerialController] Connection failed:', err.message);
      throw err;
    }
  }

  /**
   * Connect in mock mode
   * @private
   */
  _connectMock() {
    console.log('[SerialController] Connected in mock mode');
    this._isConnected = true;
    this.emit('connected');
  }

  /**
   * Disconnect serial port
   * @returns {Promise<void>}
   */
  async disconnect() {
    this.stopPolling();

    if (this._mockMode) {
      this._isConnected = false;
      this.emit('disconnected');
      return;
    }

    if (this._port && this._port.isOpen) {
      return new Promise((resolve) => {
        this._port.close(() => {
          this._isConnected = false;
          this.emit('disconnected');
          resolve();
        });
      });
    }
  }

  /**
   * Get connection state
   * @returns {boolean}
   */
  isConnected() {
    return this._isConnected;
  }

  /**
   * Send a command to scanner
   * @param {string} command - Command string (\r will be appended automatically if omitted)
   * @returns {Promise<string>} Response string
   */
  async sendCommand(command) {
    if (this._mockMode) {
      return this._mockCommand(command);
    }

    if (!this._isConnected || !this._port) {
      throw new Error('Serial port not connected');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Remove from response queue on timeout
        const idx = this._responseQueue.indexOf(resolver);
        if (idx >= 0) {
          this._responseQueue.splice(idx, 1);
        }
        reject(new Error(`Command timeout: ${command}`));
      }, 3000);

      const resolver = (data) => {
        clearTimeout(timeout);
        resolve(data);
      };

      this._responseQueue.push(resolver);

      const cmdStr = command.endsWith('\r') ? command : command + '\r';
      this._port.write(cmdStr, (err) => {
        if (err) {
          clearTimeout(timeout);
          const idx = this._responseQueue.indexOf(resolver);
          if (idx >= 0) {
            this._responseQueue.splice(idx, 1);
          }
          reject(err);
        }
      });
    });
  }

  /**
   * Data reception handler
   * @param {string} data - Received raw data
   * @private
   */
  _onData(data) {
    const trimmed = data.trim();
    if (!trimmed) {
      return;
    }

    // Resolve next pending command if waiting in queue
    if (this._responseQueue.length > 0) {
      const resolver = this._responseQueue.shift();
      resolver(trimmed);
    }

    // Emit data event for all incoming records
    this.emit('data', trimmed);
  }

  /**
   * Start periodic polling for GLG, PWR, and STS
   * @param {number} glgIntervalMs - GLG polling interval (ms)
   * @param {number} [pwrIntervalMs=500] - PWR polling interval (ms)
   * @param {number} [stsIntervalMs=500] - STS polling interval (ms)
   */
  startPolling(glgIntervalMs, pwrIntervalMs = 500, stsIntervalMs = 500) {
    this.stopPolling();

    // GLG polling
    this._pollTimer = setInterval(async () => {
      try {
        const response = await this.sendCommand('GLG');
        const parsed = parseGlgResponse(response);
        this.emit('glgUpdate', parsed);
      } catch {
        // Ignore timeouts
      }
    }, glgIntervalMs);

    // PWR polling (RSSI)
    this._pwrTimer = setInterval(async () => {
      try {
        const response = await this.sendCommand('PWR');
        const parsed = parsePwrResponse(response);
        if (parsed) {
          this.emit('pwrUpdate', parsed);
        }
      } catch {
        // Ignore timeouts
      }
    }, pwrIntervalMs);

    // STS polling (LCD display status & menu)
    this._stsTimer = setInterval(async () => {
      await this.pollStatus();
    }, stsIntervalMs);

    console.log(`[SerialController] Started polling: GLG=${glgIntervalMs}ms, PWR=${pwrIntervalMs}ms, STS=${stsIntervalMs}ms`);
  }

  /**
   * Manually trigger an immediate STS poll (e.g. after keypress)
   */
  async pollStatus() {
    try {
      const response = await this.sendCommand('STS');
      if (response && !this._mockMode) {
        console.log('[DEBUG STS RAW]:', response);
        console.log('[DEBUG STS HEX]:', Buffer.from(response, 'latin1').toString('hex'));
      }
      const parsed = parseStsResponse(response);
      if (parsed) {
        this.emit('stsUpdate', parsed);
      }
    } catch {
      // Ignore timeouts
    }
  }

  /**
   * Stop polling
   */
  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._pwrTimer) {
      clearInterval(this._pwrTimer);
      this._pwrTimer = null;
    }
    if (this._stsTimer) {
      clearInterval(this._stsTimer);
      this._stsTimer = null;
    }
  }

  /**
   * Simulate a keypress
   * @param {string} key - Key identifier (e.g. "S", "H", "L", "1"-"9")
   * @param {string} [action="P"] - Key action (P=Press, H=Hold, R=Release)
   * @returns {Promise<string>}
   */
  async pressKey(key, action = 'P') {
    const res = await this.sendCommand(`KEY,${key},${action}`);
    // Trigger immediate status refresh so LCD reflects key action instantly
    setTimeout(() => this.pollStatus(), 50);
    return res;
  }

  /**
   * Start scanning (simulates Scan key press)
   * @returns {Promise<string>}
   */
  async startScan() {
    return this.pressKey('S', 'P');
  }

  /**
   * Hold channel (simulates Hold key press)
   * @returns {Promise<string>}
   */
  async hold() {
    return this.pressKey('H', 'P');
  }

  /**
   * Set volume level
   * @param {number} level - Volume level (0-15)
   * @returns {Promise<string>}
   */
  async setVolume(level) {
    // Format as 2 zero-padded digits (e.g. 5 -> 05, 12 -> 12)
    const formatted = String(level).padStart(2, '0');
    return this.sendCommand(`VOL,${formatted}`);
  }

  /**
   * Set squelch level
   * @param {number} level - Squelch level (0-15)
   * @returns {Promise<string>}
   */
  async setSquelch(level) {
    const formatted = String(level).padStart(2, '0');
    return this.sendCommand(`SQL,${formatted}`);
  }

  /**
   * Retrieve scanner model name
   * @returns {Promise<string>}
   */
  async getModel() {
    return this.sendCommand('MDL');
  }

  /**
   * Retrieve firmware version
   * @returns {Promise<string>}
   */
  async getVersion() {
    return this.sendCommand('VER');
  }

  /**
   * Generate mock responses for commands
   * @param {string} command - Command name
   * @returns {string} Mock response string
   * @private
   */
  _mockCommand(command) {
    const cmd = command.replace('\r', '').trim();

    switch (cmd) {
      case 'MDL':
        return 'MDL,BCT15X';

      case 'VER':
        return 'VER,Version 1.03.00';

      case 'GLG':
        return this._mockGlgResponse();

      case 'PWR':
        return this._mockReceiving ? `PWR,${Math.floor(Math.random() * 5) + 2}` : 'PWR,0';

      case 'STS':
        return this._mockStsResponse();

      default:
        if (cmd.startsWith('KEY,')) {
          const parts = cmd.split(',');
          const key = parts[1];
          const action = parts[2] || 'P';
          this._mockHandleKey(key, action);
          return 'OK';
        }
        return 'OK';
    }
  }

  /**
   * Handle keypress in mock mode for menu navigation
   * @param {string} key - Key identifier
   * @param {string} action - Key action
   * @private
   */
  _mockHandleKey(key, action) {
    if (key === 'M') {
      // MENU key
      if (!this._mockMenuState.active) {
        this._mockMenuState.active = true;
        this._mockMenuState.stack = [
          {
            title: 'Menu',
            items: ['Program System', 'Srch/CloCall Opt', 'Close Call', 'Set Scan/Srch Opt', 'Settings'],
            cursor: 0,
          },
        ];
      } else {
        this._mockMenuState.stack.pop();
        if (this._mockMenuState.stack.length === 0) {
          this._mockMenuState.active = false;
        }
      }
      return;
    }

    if (!this._mockMenuState.active) {
      return;
    }

    const current = this._mockMenuState.stack[this._mockMenuState.stack.length - 1];
    if (!current) return;

    if (key === '^') {
      // Up arrow / scroll up
      current.cursor = (current.cursor - 1 + current.items.length) % current.items.length;
    } else if (key === 'V') {
      // Down arrow / scroll down
      current.cursor = (current.cursor + 1) % current.items.length;
    } else if (key === 'E') {
      // Enter / Select
      const selected = current.items[current.cursor];
      if (selected === 'Program System') {
        this._mockMenuState.stack.push({
          title: 'Select System',
          items: ['Airband', 'MilitaryAir', 'New System'],
          cursor: 0,
        });
      } else if (selected === 'Airband' || selected === 'MilitaryAir') {
        this._mockMenuState.stack.push({
          title: 'Edit System',
          items: ['Edit Sys Option', 'Edit Name', 'Set Quick Key'],
          cursor: 0,
        });
      } else if (selected === 'Edit Sys Option') {
        this._mockMenuState.stack.push({
          title: 'Sys Option',
          items: ['Set Delay Time', 'Set Attenuator', 'Set Hold Time'],
          cursor: 0,
        });
      } else if (selected === 'Set Delay Time') {
        this._mockMenuState.stack.push({
          title: 'Set Delay Time',
          items: ['-10 sec', '-5 sec', '-2 sec', '0 sec', '1 sec', '2 sec', '5 sec'],
          cursor: 5, // Default +2 sec
        });
      } else if (current.title === 'Set Delay Time') {
        // Selection made: return to previous level
        this._mockMenuState.stack.pop();
      }
    }
  }

  /**
   * Generate realistic STS response for mock mode
   * @returns {string}
   * @private
   */
  _mockStsResponse() {
    if (this._mockMenuState.active && this._mockMenuState.stack.length > 0) {
      const current = this._mockMenuState.stack[this._mockMenuState.stack.length - 1];
      const title = current.title;
      const startIdx = Math.max(0, Math.min(current.cursor - 1, current.items.length - 3));
      const visibleItems = current.items.slice(startIdx, startIdx + 3);

      const l1 = title;
      const m1 = '0';
      const l2 = visibleItems[0] || '';
      const m2 = current.cursor === startIdx ? '1' : '0';
      const l3 = visibleItems[1] || '';
      const m3 = current.cursor === startIdx + 1 ? '1' : '0';
      const l4 = visibleItems[2] || '';
      const m4 = current.cursor === startIdx + 2 ? '1' : '0';

      return `STS,0000,${l1},${m1},${l2},${m2},${l3},${m3},${l4},${m4},0,0`;
    }

    // Normal scanner status display
    const freqs = ['133.5500 MHz  AM', '128.1250 MHz  AM', '122.0000 MHz  AM', '121.1750 MHz  AM'];
    const systems = ['Airband', 'Airband', 'MilitaryAir', 'Airband'];
    const depts = ['Control', 'Control', 'Gifu', 'Centrair'];
    const channels = ['KobeCtrl.N47', 'FukuokaCtrl.F05', 'TWR', 'TCA'];
    const idx = Math.floor(this._mockCounter / 50) % freqs.length;

    const l1 = systems[idx];
    const l2 = depts[idx];
    const l3 = channels[idx];
    const l4 = freqs[idx];
    const sql = this._mockReceiving ? '1' : '0';

    return `STS,0000,${l1},0,${l2},0,${l3},0,${l4},0,${sql},0`;
  }

  /**
   * Generate mock GLG response cycling between active receiving and idle
   * @returns {string}
   * @private
   */
  _mockGlgResponse() {
    this._mockCounter++;

    // Toggle reception status roughly every 5 seconds (25 ticks @200ms)
    const cycle = this._mockCounter % 50;

    if (cycle < 25) {
      // Actively receiving
      this._mockReceiving = true;
      const freqs = ['01557000', '04620000', '15180000', '08510125'];
      const systems = ['Auto Police', 'Fire Dept', 'EMS', 'Highway Patrol'];
      const channels = ['Dispatch', 'Tactical', 'Command', 'Patrol'];
      const depts = ['East', 'West', 'North', 'Central'];
      const mods = ['FM', 'NFM', 'AM', 'P25'];
      const idx = Math.floor(this._mockCounter / 50) % freqs.length;

      return `GLG,${freqs[idx]},${mods[idx]},OFF,none,${systems[idx]},${depts[idx]},${channels[idx]},0,0,1,1,`;
    } else {
      // Idle / scanning
      this._mockReceiving = false;
      return 'GLG,,,,,,,,,,,,';
    }
  }

  /**
   * Release resources
   */
  destroy() {
    this.stopPolling();
    this.removeAllListeners();
    if (this._port && this._port.isOpen) {
      this._port.close();
    }
  }
}

module.exports = SerialController;
