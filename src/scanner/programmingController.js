/**
 * @fileoverview BCT15X プログラミングモードコントローラー
 * @description PRGモードの排他制御と、DMAメモリ(システム・グループ・チャンネル)の読み書き・一括同期を管理する
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
 * プログラミングコントローラークラス
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
   * テスト/モック用の初期メモリデータを設定
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
   * プログラミングモードに入る
   * @returns {Promise<boolean>}
   */
  async enterProgramMode() {
    if (this.isProgramming) return true;

    // 通常のステータスポーリングを停止（ポート排他制御）
    this.serial.stopPolling();

    try {
      if (this.serial._mockMode) {
        this.isProgramming = true;
        console.log('[ProgrammingController] [MOCK] PRGモードへ移行しました');
        return true;
      }

      console.log('[ProgrammingController] PRGコマンド送信中...');
      const res = await this.serial.sendCommand('PRG');
      if (res.includes('OK') || res.includes('PRG,OK')) {
        this.isProgramming = true;
        console.log('[ProgrammingController] PRGモードへ正常に移行しました');
        return true;
      }
      throw new Error(`PRGモード移行失敗: ${res}`);
    } catch (err) {
      console.error('[ProgrammingController] PRGモード失敗、ポーリングを再開します:', err.message);
      this.serial.startPolling(200, 1000);
      throw err;
    }
  }

  /**
   * プログラミングモードを終了する
   * @returns {Promise<boolean>}
   */
  async exitProgramMode() {
    if (!this.isProgramming) return true;

    try {
      if (!this.serial._mockMode) {
        console.log('[ProgrammingController] EPGコマンド送信中...');
        await this.serial.sendCommand('EPG');
      }
      console.log('[ProgrammingController] EPG完了、通常受信モードに戻ります');
    } catch (err) {
      console.warn('[ProgrammingController] EPG失敗:', err.message);
    } finally {
      this.isProgramming = false;
      // 通常受信ポーリングを再開
      this.serial.startPolling(200, 1000);
    }
    return true;
  }

  /**
   * BCT15Xから全メモリ（システム・グループ・チャンネル）を完全取得する (Download)
   * @param {Function} [onProgress] - 進捗通知コールバック ({ step, current, total, percent, message })
   * @returns {Promise<Array>} システムの配列（階層構造）
   */
  async getAllMemory(onProgress = () => {}) {
    await this.enterProgramMode();

    if (this.serial._mockMode) {
      onProgress({ step: 'systems', percent: 100, message: 'モックメモリを返します' });
      return JSON.parse(JSON.stringify(this._mockMemory));
    }

    try {
      onProgress({ step: 'init', percent: 5, message: 'スキャナー初期化・システム先頭検索中...' });

      // 1. システムヘッド取得 (SIH)
      const sihRes = await this.serial.sendCommand('SIH');
      const firstSysIndex = parseSihResponse(sihRes);
      if (firstSysIndex === -1) {
        console.log('[ProgrammingController] システムが存在しません (SIH=-1)');
        onProgress({ step: 'done', percent: 100, message: 'システムは空です' });
        return [];
      }

      // システムインデックスのチェーンを走査
      const systemIndices = [];
      let curSysIdx = firstSysIndex;
      while (curSysIdx !== -1 && curSysIdx !== undefined && !systemIndices.includes(curSysIdx)) {
        systemIndices.push(curSysIdx);
        const sinRes = await this.serial.sendCommand(`SIN,${curSysIdx}`);
        const parsedSin = parseSinResponse(sinRes, curSysIdx);
        if (!parsedSin) break;
        curSysIdx = parsedSin.fwdIndex;
      }

      console.log(`[ProgrammingController] システム検出数: ${systemIndices.length}`);
      const systemsData = [];
      const totalSystems = systemIndices.length;

      for (let sIdx = 0; sIdx < totalSystems; sIdx++) {
        const sysId = systemIndices[sIdx];
        const percent = Math.round(10 + (sIdx / totalSystems) * 80);

        // システム情報取得
        const sinRes = await this.serial.sendCommand(`SIN,${sysId}`);
        const sysInfo = parseSinResponse(sinRes, sysId);
        if (!sysInfo) continue;

        onProgress({
          step: 'system',
          current: sIdx + 1,
          total: totalSystems,
          percent,
          message: `システム読み出し中 [${sIdx + 1}/${totalSystems}]: ${sysInfo.name}`,
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

        // 2. グループチェーンの走査
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

            // 3. チャンネルチェーンの走査
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

      onProgress({ step: 'done', percent: 100, message: '全メモリデータの読み出しが完了しました' });
      return systemsData;
    } finally {
      await this.exitProgramMode();
    }
  }

  /**
   * 現在のメモリデータをローカルJSONバックアップファイルとして自動保存する
   * @param {Array} data - メモリ構造
   * @returns {string} 保存されたバックアップファイルパス
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
    console.log(`[ProgrammingController] 🛡️ 自動バックアップを保存しました: ${fullPath}`);
    return fullPath;
  }

  /**
   * 全メモリデータをBCT15X実機に書き込む (Upload)
   * 実行前に必ず自動バックアップを取得します。
   * @param {Array} memoryData - システム・グループ・チャンネル階層データ
   * @param {Function} [onProgress] - 進捗通知コールバック
   * @returns {Promise<Object>}
   */
  async uploadAllMemory(memoryData, onProgress = () => {}) {
    if (!Array.isArray(memoryData)) {
      throw new Error('無効なメモリデータ形式です。システムの配列を指定してください。');
    }

    // 1. 安全対策: 書き込み前に実機から現在のデータをバックアップ
    try {
      onProgress({ step: 'backup', percent: 5, message: '書き込み前の安全バックアップを取得中...' });
      const currentMemory = await this.getAllMemory();
      const backupPath = this.saveLocalBackup(currentMemory);
      console.log(`[ProgrammingController] 書き込み前バックアップ完了: ${backupPath}`);
    } catch (err) {
      console.warn('[ProgrammingController] 書き込み前バックアップの取得に失敗しましたが続行します:', err.message);
    }

    await this.enterProgramMode();

    if (this.serial._mockMode) {
      this._mockMemory = JSON.parse(JSON.stringify(memoryData));
      onProgress({ step: 'done', percent: 100, message: '[MOCK] アップロード完了' });
      await this.exitProgramMode();
      return { success: true, count: memoryData.length };
    }

    try {
      // 2. 既存の全システムを削除 (CLRコマンド、または全DSY)
      onProgress({ step: 'clear', percent: 15, message: 'スキャナーの既存メモリをクリア中...' });
      console.log('[ProgrammingController] CLRコマンド送信...');
      const clrRes = await this.serial.sendCommand('CLR');
      console.log('[ProgrammingController] CLR応答:', clrRes);

      // CLR後はスキャナーが初期化処理を行うため数秒待機
      await new Promise((r) => setTimeout(r, 2000));

      // 3. 各システム、グループ、チャンネルを順次作成
      const totalSystems = memoryData.length;
      for (let sIdx = 0; sIdx < totalSystems; sIdx++) {
        const sys = memoryData[sIdx];
        const percent = Math.round(20 + (sIdx / totalSystems) * 75);

        onProgress({
          step: 'upload_system',
          current: sIdx + 1,
          total: totalSystems,
          percent,
          message: `システム作成中 [${sIdx + 1}/${totalSystems}]: ${sys.name}`,
        });

        // CSY: システム作成
        const csyRes = await this.serial.sendCommand(`CSY,${sys.type || 'CNV'},0`);
        const newSysId = parseCsyResponse(csyRes);
        if (newSysId === -1) {
          throw new Error(`システム作成失敗: ${sys.name}`);
        }
        sys.id = newSysId;

        // SIN: システム情報設定
        await this.serial.sendCommand(buildSinCommand(sys));

        // グループ作成
        if (Array.isArray(sys.groups)) {
          for (const grp of sys.groups) {
            const agcRes = await this.serial.sendCommand(`AGC,${newSysId}`);
            const newGrpId = parseAgcResponse(agcRes);
            if (newGrpId === -1) {
              console.warn(`[ProgrammingController] グループ作成失敗: ${grp.name}`);
              continue;
            }
            grp.id = newGrpId;
            grp.systemId = newSysId;

            // GIN: グループ設定
            await this.serial.sendCommand(buildGinCommand(grp));

            // チャンネル作成
            if (Array.isArray(grp.channels)) {
              for (const chn of grp.channels) {
                const accRes = await this.serial.sendCommand(`ACC,${newGrpId}`);
                const newChnId = parseAccResponse(accRes);
                if (newChnId === -1) {
                  console.warn(`[ProgrammingController] チャンネル作成失敗: ${chn.name}`);
                  continue;
                }
                chn.id = newChnId;
                chn.groupId = newGrpId;
                chn.systemId = newSysId;

                // CIN: チャンネル設定
                await this.serial.sendCommand(buildCinCommand(chn));
              }
            }
          }
        }
      }

      onProgress({ step: 'done', percent: 100, message: '実機へのメモリ書き込みが完了しました！' });
      return { success: true, systemsCreated: totalSystems };
    } finally {
      await this.exitProgramMode();
    }
  }

  // --- 後方互換性および個別CRUDメソッド ---

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
