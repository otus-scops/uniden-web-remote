/**
 * @fileoverview BCT15X serial communication controller
 * @description Manages serial port communications with the BCT15X scanner, handling command transmission and responses.
 */

const EventEmitter = require('events');
const { parseResponse, parseGlgResponse, parsePwrResponse } = require('./protocolParser');

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

    /** @type {Array<Function>} Command response awaiting queue */
    this._responseQueue = [];

    /** @type {number} Mock reception counter */
    this._mockCounter = 0;

    /** @type {boolean} Mock reception in-progress flag */
    this._mockReceiving = false;
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
        new ReadlineParser({ delimiter: this._config.delimiter || '\r' })
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
   * Start periodic polling for GLG and PWR
   * @param {number} glgIntervalMs - GLG polling interval (ms)
   * @param {number} [pwrIntervalMs=500] - PWR polling interval (ms)
   */
  startPolling(glgIntervalMs, pwrIntervalMs = 500) {
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

    console.log(`[SerialController] Started polling: GLG=${glgIntervalMs}ms, PWR=${pwrIntervalMs}ms`);
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
  }

  /**
   * Simulate a keypress
   * @param {string} key - Key identifier (e.g. "S", "H", "L", "1"-"9")
   * @param {string} [action="P"] - Key action (P=Press, H=Hold, R=Release)
   * @returns {Promise<string>}
   */
  async pressKey(key, action = 'P') {
    return this.sendCommand(`KEY,${key},${action}`);
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
        return 'STS,011000,,,155.7000,FM,Auto Police,East Precinct,Dispatch,,0';

      default:
        if (cmd.startsWith('KEY')) {
          return 'OK';
        }
        return 'OK';
    }
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
