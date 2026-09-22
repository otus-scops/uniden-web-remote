/**
 * @fileoverview BCT15X programming mode controller
 * @description Manages PRG mode locking, reading/writing, and full synchronization of DMA memory (systems, groups, channels).
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const {
  SystemTypes,
  toRawFrequency,
  fromRawFrequency,
  fromToneCode,
  toToneCode,
  parseSihResponse,
  parseSinResponse,
  parseGinResponse,
  parseCinResponse,
  parseCsyResponse,
  parseAgcResponse,
  parseAccResponse,
  buildSinCommand,
  buildGinCommand,
  buildCinCommand,
} = require('./dmaProtocol');

/**
 * Programming controller class
 * @extends EventEmitter
 */
class ProgrammingController extends EventEmitter {
  /**
   * @param {import('./serialController')} serialController
   */
  constructor(serialController) {
    super();
    this.serial = serialController;
    this.isProgramming = false;
    this._mockMemory = null;
    this._initMockMemory();
  }

  /**
   * Initialize mock memory hierarchy for testing/offline mode
   * @private
   */
  _initMockMemory() {
    this._mockMemory = [
      {
        id: 10,
        type: 'CNV',
        name: 'Tokyo Airband',
        quickKey: 1,
        holdTime: 2,
        lockout: false,
        delay: 2,
        groups: [
          {
            id: 101,
            groupType: 'C',
            name: 'Tokyo App/Dep',
            quickKey: 1,
            lockout: false,
            systemId: 10,
            channels: [
              {
                id: 1001,
                name: 'Tokyo TWR',
                frequency: '118.1000',
                modulation: 'AM',
                tone: 'None / All',
                toneCode: 0,
                lockout: false,
                priority: false,
                attenuator: false,
                systemId: 10,
                groupId: 101,
              },
              {
                id: 1002,
                name: 'Tokyo APP',
                frequency: '119.1000',
                modulation: 'AM',
                tone: 'None / All',
                toneCode: 0,
                lockout: false,
                priority: false,
                attenuator: false,
                systemId: 10,
                groupId: 101,
              },
              {
                id: 1003,
                name: 'Tokyo DEP',
                frequency: '126.0000',
                modulation: 'AM',
                tone: 'None / All',
                toneCode: 0,
                lockout: false,
                priority: false,
                attenuator: false,
                systemId: 10,
                groupId: 101,
              },
            ],
          },
          {
            id: 102,
            groupType: 'C',
            name: 'Tokyo Control',
            quickKey: 2,
            lockout: false,
            systemId: 10,
            channels: [
              {
                id: 1004,
                name: 'Tokyo Ctrl Kanto',
                frequency: '125.9000',
                modulation: 'AM',
                tone: 'None / All',
                toneCode: 0,
                lockout: false,
                priority: true,
                attenuator: false,
                systemId: 10,
                groupId: 102,
              },
              {
                id: 1005,
                name: 'Tokyo Ctrl Izu',
                frequency: '132.1000',
                modulation: 'AM',
                tone: 'None / All',
                toneCode: 0,
                lockout: false,
                priority: false,
                attenuator: false,
                systemId: 10,
                groupId: 102,
              },
            ],
          },
        ],
      },
      {
        id: 20,
        type: 'CNV',
        name: 'VHF Marine',
        quickKey: 2,
        holdTime: 2,
        lockout: false,
        delay: 2,
        groups: [
          {
            id: 201,
            groupType: 'C',
            name: 'Calling/Distress',
            quickKey: 1,
            lockout: false,
            systemId: 20,
            channels: [
              {
                id: 2001,
                name: 'Ch 16 Calling',
                frequency: '156.8000',
                modulation: 'FM',
                tone: 'None / All',
                toneCode: 0,
                lockout: false,
                priority: true,
                attenuator: false,
                systemId: 20,
                groupId: 201,
              },
            ],
          },
        ],
      },
    ];
  }

  /**
   * Enter programming mode
   * @returns {Promise<boolean>}
   */
  async enterProgramMode() {
    if (this.isProgramming) return true;

    // Stop normal status polling to ensure exclusive serial port access
    this.serial.stopPolling();

    try {
      if (this.serial._mockMode) {
        this.isProgramming = true;
        console.log('[ProgrammingController] [MOCK] Entered PRG mode');
        return true;
      }

      console.log('[ProgrammingController] Sending PRG command...');
      const res = await this.serial.sendCommand('PRG');
      if (res.includes('OK') || res.includes('PRG,OK')) {
        this.isProgramming = true;
        console.log('[ProgrammingController] Successfully entered PRG mode');
        return true;
      }
      throw new Error(`Failed to enter PRG mode: ${res}`);
    } catch (err) {
      console.error('[ProgrammingController] PRG mode failed, resuming polling:', err.message);
      this.serial.startPolling(200, 1000);
      throw err;
    }
  }

  /**
   * Exit programming mode
   * @returns {Promise<boolean>}
   */
  async exitProgramMode() {
    if (!this.isProgramming) return true;

    try {
      if (!this.serial._mockMode) {
        console.log('[ProgrammingController] Sending EPG command...');
        await this.serial.sendCommand('EPG');
      }
      console.log('[ProgrammingController] EPG completed, returning to normal reception mode');
    } catch (err) {
      console.warn('[ProgrammingController] EPG failed:', err.message);
    } finally {
      this.isProgramming = false;
      // Resume normal reception polling
      this.serial.startPolling(200, 1000);
    }
    return true;
  }

  /**
   * Download complete memory structure (systems, groups, channels) from BCT15X
   * @param {Function} [onProgress] - Progress callback ({ step, current, total, percent, message })
   * @returns {Promise<Array>} Hierarchical array of systems
   */
  async getAllMemory(onProgress = () => {}) {
    await this.enterProgramMode();

    if (this.serial._mockMode) {
      onProgress({ step: 'systems', percent: 100, message: 'Returning mock memory' });
      return JSON.parse(JSON.stringify(this._mockMemory));
    }

    try {
      onProgress({ step: 'init', percent: 5, message: 'Initializing scanner, searching for system head...' });

      // 1. Get system head index (SIH)
      const sihRes = await this.serial.sendCommand('SIH');
      const firstSysIndex = parseSihResponse(sihRes);
      if (firstSysIndex === -1) {
        console.log('[ProgrammingController] No systems found (SIH=-1)');
        onProgress({ step: 'done', percent: 100, message: 'System memory is empty' });
        return [];
      }

      // Traverse system index chain
      const systemIndices = [];
      let curSysIdx = firstSysIndex;
      while (curSysIdx !== -1 && curSysIdx !== undefined && !systemIndices.includes(curSysIdx)) {
        systemIndices.push(curSysIdx);
        const sinRes = await this.serial.sendCommand(`SIN,${curSysIdx}`);
        const parsedSin = parseSinResponse(sinRes, curSysIdx);
        if (!parsedSin) break;
        curSysIdx = parsedSin.fwdIndex;
      }

      console.log(`[ProgrammingController] Detected systems count: ${systemIndices.length}`);
      const systemsData = [];
      const totalSystems = systemIndices.length;

      for (let sIdx = 0; sIdx < totalSystems; sIdx++) {
        const sysId = systemIndices[sIdx];
        const percent = Math.round(10 + (sIdx / totalSystems) * 80);

        // Fetch system details
        const sinRes = await this.serial.sendCommand(`SIN,${sysId}`);
        const sysInfo = parseSinResponse(sinRes, sysId);
        if (!sysInfo) continue;

        onProgress({
          step: 'system',
          current: sIdx + 1,
          total: totalSystems,
          percent,
          message: `Reading system [${sIdx + 1}/${totalSystems}]: ${sysInfo.name}`,
        });

        const sysNode = {
          id: sysInfo.id,
          type: sysInfo.type,
          name: sysInfo.name,
          quickKey: sysInfo.quickKey,
          holdTime: sysInfo.holdTime,
          lockout: sysInfo.lockout,
          delay: sysInfo.delay,
          groups: [],
        };

        // 2. Traverse group chain
        if (sysInfo.groupHead !== -1 && sysInfo.groupHead !== undefined) {
          const groupIndices = [];
          let curGrpIdx = sysInfo.groupHead;

          while (curGrpIdx !== -1 && curGrpIdx !== undefined && !groupIndices.includes(curGrpIdx)) {
            groupIndices.push(curGrpIdx);
            const ginRes = await this.serial.sendCommand(`GIN,${curGrpIdx}`);
            const parsedGin = parseGinResponse(ginRes, curGrpIdx);
            if (!parsedGin) break;
            curGrpIdx = parsedGin.fwdIndex;
          }

          for (const grpId of groupIndices) {
            const ginRes = await this.serial.sendCommand(`GIN,${grpId}`);
            const grpInfo = parseGinResponse(ginRes, grpId);
            if (!grpInfo) continue;

            const grpNode = {
              id: grpInfo.id,
              groupType: grpInfo.groupType,
              name: grpInfo.name,
              quickKey: grpInfo.quickKey,
              lockout: grpInfo.lockout,
              systemId: sysNode.id,
              channels: [],
            };

            // 3. Traverse channel chain
            if (grpInfo.channelHead !== -1 && grpInfo.channelHead !== undefined) {
              const channelIndices = [];
              let curChnIdx = grpInfo.channelHead;

              while (curChnIdx !== -1 && curChnIdx !== undefined && !channelIndices.includes(curChnIdx)) {
                channelIndices.push(curChnIdx);
                const cinRes = await this.serial.sendCommand(`CIN,${curChnIdx}`);
                const parsedCin = parseCinResponse(cinRes, curChnIdx);
                if (!parsedCin) break;
                curChnIdx = parsedCin.fwdIndex;
              }

              for (const chnId of channelIndices) {
                const cinRes = await this.serial.sendCommand(`CIN,${chnId}`);
                const chnInfo = parseCinResponse(cinRes, chnId);
                if (!chnInfo) continue;

                grpNode.channels.push({
                  id: chnInfo.id,
                  name: chnInfo.name,
                  frequency: chnInfo.frequency,
                  rawFrequency: chnInfo.rawFrequency,
                  modulation: chnInfo.modulation,
                  tone: chnInfo.tone,
                  toneCode: chnInfo.toneCode,
                  toneLockout: chnInfo.toneLockout,
                  lockout: chnInfo.lockout,
                  priority: chnInfo.priority,
                  attenuator: chnInfo.attenuator,
                  systemId: sysNode.id,
                  groupId: grpNode.id,
                });
              }
            }

            sysNode.groups.push(grpNode);
          }
        }

        systemsData.push(sysNode);
      }

      onProgress({ step: 'done', percent: 100, message: 'Completed reading all memory data' });
      return systemsData;
    } finally {
      await this.exitProgramMode();
    }
  }

  /**
   * Save current memory data as a local JSON backup file
   * @param {Array} data - Memory structure
   * @returns {string} Saved backup file path
   */
  saveLocalBackup(data) {
    const backupDir = path.join(process.cwd(), 'config', 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `bct15x_backup_${timestamp}.json`;
    const fullPath = path.join(backupDir, filename);

    fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[ProgrammingController] Automatic backup saved: ${fullPath}`);
    return fullPath;
  }

  /**
   * Upload and write complete memory data to physical BCT15X scanner
   * Creates an automatic backup prior to writing.
   * @param {Array} memoryData - Hierarchical system, group, and channel data
   * @param {Function} [onProgress] - Progress callback
   * @returns {Promise<Object>}
   */
  async uploadAllMemory(memoryData, onProgress = () => {}) {
    if (!Array.isArray(memoryData)) {
      throw new Error('Invalid memory data format. Expected an array of systems.');
    }

    // 1. Safety measure: backup current scanner data before writing
    try {
      onProgress({ step: 'backup', percent: 5, message: 'Creating pre-write safety backup...' });
      const currentMemory = await this.getAllMemory();
      const backupPath = this.saveLocalBackup(currentMemory);
      console.log(`[ProgrammingController] Pre-write backup completed: ${backupPath}`);
    } catch (err) {
      console.warn('[ProgrammingController] Failed to create pre-write backup, continuing anyway:', err.message);
    }

    await this.enterProgramMode();

    if (this.serial._mockMode) {
      this._mockMemory = JSON.parse(JSON.stringify(memoryData));
      onProgress({ step: 'done', percent: 100, message: '[MOCK] Upload completed' });
      await this.exitProgramMode();
      return { success: true, count: memoryData.length };
    }

    try {
      // 2. Clear all existing systems on scanner (CLR command)
      onProgress({ step: 'clear', percent: 15, message: 'Clearing scanner memory...' });
      console.log('[ProgrammingController] Sending CLR command...');
      const clrRes = await this.serial.sendCommand('CLR');
      console.log('[ProgrammingController] CLR response:', clrRes);

      // Wait a few seconds for scanner to complete internal memory initialization
      await new Promise((r) => setTimeout(r, 2000));

      // 3. Sequentially create systems, groups, and channels
      const totalSystems = memoryData.length;
      for (let sIdx = 0; sIdx < totalSystems; sIdx++) {
        const sys = memoryData[sIdx];
        const percent = Math.round(20 + (sIdx / totalSystems) * 75);

        onProgress({
          step: 'upload_system',
          current: sIdx + 1,
          total: totalSystems,
          percent,
          message: `Creating system [${sIdx + 1}/${totalSystems}]: ${sys.name}`,
        });

        // CSY: Create system
        const csyRes = await this.serial.sendCommand(`CSY,${sys.type || 'CNV'},0`);
        const newSysId = parseCsyResponse(csyRes);
        if (newSysId === -1) {
          throw new Error(`Failed to create system: ${sys.name}`);
        }
        sys.id = newSysId;

        // SIN: Set system details
        await this.serial.sendCommand(buildSinCommand(sys));

        // Create groups
        if (Array.isArray(sys.groups)) {
          for (const grp of sys.groups) {
            const agcRes = await this.serial.sendCommand(`AGC,${newSysId}`);
            const newGrpId = parseAgcResponse(agcRes);
            if (newGrpId === -1) {
              console.warn(`[ProgrammingController] Failed to create group: ${grp.name}`);
              continue;
            }
            grp.id = newGrpId;
            grp.systemId = newSysId;

            // GIN: Set group details
            await this.serial.sendCommand(buildGinCommand(grp));

            // Create channels
            if (Array.isArray(grp.channels)) {
              for (const chn of grp.channels) {
                const accRes = await this.serial.sendCommand(`ACC,${newGrpId}`);
                const newChnId = parseAccResponse(accRes);
                if (newChnId === -1) {
                  console.warn(`[ProgrammingController] Failed to create channel: ${chn.name}`);
                  continue;
                }
                chn.id = newChnId;
                chn.groupId = newGrpId;
                chn.systemId = newSysId;

                // CIN: Set channel details
                await this.serial.sendCommand(buildCinCommand(chn));
              }
            }
          }
        }
      }

      onProgress({ step: 'done', percent: 100, message: 'Memory upload to scanner completed successfully!' });
      return { success: true, systemsCreated: totalSystems };
    } finally {
      await this.exitProgramMode();
    }
  }

  // --- Backward compatibility and individual CRUD methods ---

  async getSystems() {
    const all = await this.getAllMemory();
    return all.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      quickKey: s.quickKey,
      groupsCount: (s.groups || []).length,
    }));
  }

  async getGroups(systemId) {
    const all = await this.getAllMemory();
    const sys = all.find((s) => String(s.id) === String(systemId));
    if (!sys) return [];
    return sys.groups || [];
  }

  async getChannels(groupId) {
    const all = await this.getAllMemory();
    for (const sys of all) {
      if (sys.groups) {
        const grp = sys.groups.find((g) => String(g.id) === String(groupId));
        if (grp) return grp.channels || [];
      }
    }
    return [];
  }

  async backupAll() {
    return this.getAllMemory();
  }
}

module.exports = ProgrammingController;
