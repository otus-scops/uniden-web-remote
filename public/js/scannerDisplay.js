/**
 * @fileoverview スキャナーディスプレイモジュール
 * @description 周波数表示、チャンネル情報、RSSIメーター等のスキャナーUIを管理する
 */

/**
 * スキャナーディスプレイUI管理
 */
const scannerDisplay = (() => {
  // DOM要素キャッシュ
  let elements = {};

  /** @type {boolean} 現在受信中かどうか */
  let isCurrentlyReceiving = false;

  /**
   * DOM要素を取得・キャッシュする
   */
  function getElements() {
    if (elements.frequencyDisplay) return elements;

    elements = {
      frequencyDisplay: document.getElementById('frequency-display'),
      infoSystem: document.getElementById('info-system'),
      infoDepartment: document.getElementById('info-department'),
      infoChannel: document.getElementById('info-channel'),
      infoModulation: document.getElementById('info-modulation'),
      infoCtcss: document.getElementById('info-ctcss'),
      infoNac: document.getElementById('info-nac'),
      rssiBar: document.getElementById('rssi-bar'),
      rssiValue: document.getElementById('rssi-value'),
      statusDot: document.getElementById('status-dot'),
      connectionText: document.getElementById('connection-text'),
      scannerModel: document.getElementById('scanner-model'),
      badgeScan: document.getElementById('badge-scan'),
      badgeReceiving: document.getElementById('badge-receiving'),
      badgeRecording: document.getElementById('badge-recording'),
      // ライブ音声プレイヤー
      liveAudioPlayer: document.getElementById('live-audio-player'),
      liveAudioBtn: document.getElementById('btn-live-audio'),
      liveAudioIcon: document.getElementById('live-audio-icon'),
      liveAudioStatus: document.getElementById('live-audio-status'),
      liveAudioVolume: document.getElementById('live-audio-volume'),
      volumeIcon: document.getElementById('volume-icon'),
      volumeValue: document.getElementById('volume-value'),
    };

    return elements;
  }

  /**
   * ステータス更新時の処理
   * @param {Object} status - スキャナーステータスオブジェクト
   */
  function onStatusUpdate(status) {
    const el = getElements();

    // 接続状態
    updateConnectionStatus(el, status.isConnected);

    // モデル情報
    if (status.model) {
      el.scannerModel.textContent = `${status.model}${status.firmwareVersion ? ' - ' + status.firmwareVersion : ''}`;
    }

    // 受信情報
    if (status.currentReception && status.isReceiving) {
      updateReceptionDisplay(el, status.currentReception);
      setReceivingState(el, true);
    } else if (!status.isReceiving) {
      if (isCurrentlyReceiving) {
        clearReceptionDisplay(el);
      }
      setReceivingState(el, false);
    }

    // RSSI
    updateRssi(el, status.rssi || 0);

    // バッジ
    updateBadges(el, status);
  }

  /**
   * 接続状態UIを更新する
   * @param {Object} el - DOM要素
   * @param {boolean} connected - 接続状態
   */
  function updateConnectionStatus(el, connected) {
    if (connected) {
      el.statusDot.classList.add('connected');
      el.connectionText.textContent = '接続中';
      el.connectionText.style.color = 'var(--color-accent-green)';
    } else {
      el.statusDot.classList.remove('connected');
      el.connectionText.textContent = '切断中';
      el.connectionText.style.color = 'var(--color-accent-red)';
    }
  }

  /**
   * 受信情報表示を更新する
   * @param {Object} el - DOM要素
   * @param {Object} reception - 受信情報
   */
  function updateReceptionDisplay(el, reception) {
    el.frequencyDisplay.textContent = reception.freqTgid || '----.---- MHz';
    el.infoSystem.textContent = reception.system || '---';
    el.infoDepartment.textContent = reception.department || '---';
    el.infoChannel.textContent = reception.channel || '---';
    el.infoModulation.textContent = reception.modulation || '---';
    el.infoCtcss.textContent = reception.ctcssDcs || '---';
    el.infoNac.textContent = reception.p25nac || '---';
  }

  /**
   * 受信情報表示をクリアする
   * @param {Object} el - DOM要素
   */
  function clearReceptionDisplay(el) {
    el.frequencyDisplay.textContent = '----.---- MHz';
    el.infoSystem.textContent = '---';
    el.infoDepartment.textContent = '---';
    el.infoChannel.textContent = '---';
    el.infoModulation.textContent = '---';
    el.infoCtcss.textContent = '---';
    el.infoNac.textContent = '---';
  }

  /**
   * 受信中状態のUIを切り替える
   * @param {Object} el - DOM要素
   * @param {boolean} receiving - 受信中かどうか
   */
  function setReceivingState(el, receiving) {
    isCurrentlyReceiving = receiving;

    if (receiving) {
      el.frequencyDisplay.classList.add('receiving');
      el.frequencyDisplay.classList.remove('scanning');
    } else {
      el.frequencyDisplay.classList.remove('receiving');
      el.frequencyDisplay.classList.add('scanning');
    }
  }

  /**
   * RSSIメーターを更新する
   * @param {Object} el - DOM要素
   * @param {number} rssi - RSSI値 (0-7)
   */
  function updateRssi(el, rssi) {
    const maxRssi = 7;
    const percentage = Math.min(100, Math.max(0, (rssi / maxRssi) * 100));

    el.rssiBar.style.width = `${percentage}%`;
    el.rssiValue.textContent = rssi;
  }

  /**
   * ステータスバッジを更新する
   * @param {Object} el - DOM要素
   * @param {Object} status - ステータス
   */
  function updateBadges(el, status) {
    // スキャンバッジ
    if (status.isConnected && !status.isReceiving) {
      el.badgeScan.classList.add('active');
    } else {
      el.badgeScan.classList.remove('active');
    }

    // 受信中バッジ
    if (status.isReceiving) {
      el.badgeReceiving.classList.add('active');
    } else {
      el.badgeReceiving.classList.remove('active');
    }

    // 録音バッジ
    if (status.isRecording) {
      el.badgeRecording.classList.add('recording');
    } else {
      el.badgeRecording.classList.remove('recording');
    }
  }

  /**
   * 受信開始イベント処理
   * @param {Object} data - 受信開始データ
   */
  function onReceptionStart(data) {
    const el = getElements();
    if (data.reception) {
      updateReceptionDisplay(el, data.reception);
    }
    setReceivingState(el, true);
  }

  /**
   * 受信終了イベント処理
   * @param {Object} data - 受信終了データ
   */
  function onReceptionEnd(data) {
    const el = getElements();
    // すぐにはクリアせず、少し表示を残す
    setTimeout(() => {
      if (!isCurrentlyReceiving) {
        clearReceptionDisplay(el);
        setReceivingState(el, false);
      }
    }, 500);
  }

  /** @type {boolean} ライブ音声ストリーミング中かどうか */
  let isLiveAudioPlaying = false;

  /** @type {number|null} 再接続タイマー */
  let liveAudioReconnectTimer = null;

  /** @type {boolean} 停止処理中フラグ（再開ガード用） */
  let isStopping = false;

  /**
   * ライブ音声のON/OFFを切り替える
   */
  function onToggleLiveAudio() {
    // 停止処理中は操作を無視
    if (isStopping) {
      console.log('[ScannerDisplay] 停止処理中のため操作を無視');
      return;
    }

    if (isLiveAudioPlaying) {
      stopLiveAudio();
    } else {
      startLiveAudio();
    }
  }

  /**
   * audio要素を新しく作り直す（前回の接続状態を完全にリセット）
   * @returns {HTMLAudioElement} 新しいaudio要素
   * @private
   */
  function resetAudioElement() {
    const el = getElements();
    const oldPlayer = el.liveAudioPlayer;

    if (oldPlayer) {
      // 全イベントハンドラーをクリア
      oldPlayer.onerror = null;
      oldPlayer.onended = null;
      oldPlayer.oncanplay = null;
      oldPlayer.pause();
      oldPlayer.removeAttribute('src');
      oldPlayer.load();
    }

    // 新しいaudio要素を作成して差し替え
    const newPlayer = document.createElement('audio');
    newPlayer.id = 'live-audio-player';
    newPlayer.preload = 'none';

    if (oldPlayer && oldPlayer.parentNode) {
      oldPlayer.parentNode.replaceChild(newPlayer, oldPlayer);
    }

    // キャッシュを更新
    elements.liveAudioPlayer = newPlayer;
    return newPlayer;
  }

  /**
   * ライブ音声ストリーミングを開始する
   */
  function startLiveAudio() {
    const el = getElements();

    // 停止処理中は開始しない
    if (isStopping) {
      console.log('[ScannerDisplay] 停止処理中のため開始を遅延...');
      setTimeout(() => {
        if (!isStopping && !isLiveAudioPlaying) {
          startLiveAudio();
        }
      }, 500);
      return;
    }

    // 再接続タイマーをクリア
    if (liveAudioReconnectTimer) {
      clearTimeout(liveAudioReconnectTimer);
      liveAudioReconnectTimer = null;
    }

    // audio要素を完全にリセットして新しい接続を確保
    const player = resetAudioElement();

    // 先にUIを更新（ユーザーフィードバックを即座に返す）
    isLiveAudioPlaying = true;
    updateLiveAudioUI(true, '接続中...');

    // イベントハンドラーをsrc設定前にセット
    player.onerror = () => {
      if (isLiveAudioPlaying) {
        console.log('[ScannerDisplay] ストリームエラー、3秒後に再接続...');
        updateLiveAudioUI(true, '再接続中...');
        liveAudioReconnectTimer = setTimeout(() => {
          if (isLiveAudioPlaying) {
            startLiveAudio();
          }
        }, 3000);
      }
    };

    player.onended = () => {
      if (isLiveAudioPlaying) {
        console.log('[ScannerDisplay] ストリーム終了、再接続...');
        liveAudioReconnectTimer = setTimeout(() => {
          if (isLiveAudioPlaying) {
            startLiveAudio();
          }
        }, 1000);
      }
    };

    // canplayイベントでストリーミング中UIに更新
    player.oncanplay = () => {
      if (isLiveAudioPlaying) {
        updateLiveAudioUI(true);
      }
    };

    // タイムスタンプを付けてキャッシュを回避
    const streamUrl = `/api/audio/stream?t=${Date.now()}`;
    player.src = streamUrl;
    player.volume = (el.liveAudioVolume ? el.liveAudioVolume.value : 80) / 100;

    const playPromise = player.play();
    if (playPromise) {
      playPromise.then(() => {
        updateLiveAudioUI(true);
        console.log('[ScannerDisplay] ライブ音声開始');
      }).catch((err) => {
        // 意図的にstopLiveAudioが呼ばれた場合はisLiveAudioPlayingがfalseになっている
        if (!isLiveAudioPlaying) {
          // pause()による中断 - 正常な停止操作なので無視
          return;
        }
        console.error('[ScannerDisplay] ライブ音声再生エラー:', err.message);
        // ブラウザのautoplayポリシーによるエラーの場合
        isLiveAudioPlaying = false;
        updateLiveAudioUI(false, 'クリックして再試行');
      });
    }
  }

  /**
   * ライブ音声ストリーミングを停止する
   */
  function stopLiveAudio() {
    const el = getElements();

    // 先にフラグをfalseにしてcatchが「クリックして再試行」を表示しないようにする
    isLiveAudioPlaying = false;
    isStopping = true;

    if (liveAudioReconnectTimer) {
      clearTimeout(liveAudioReconnectTimer);
      liveAudioReconnectTimer = null;
    }

    // audio要素を新しく作り直し（前回の接続を確実に切断）
    resetAudioElement();

    updateLiveAudioUI(false);
    console.log('[ScannerDisplay] ライブ音声停止');

    // サーバー側のSOXプロセス終了を待つため短い遅延を入れてから停止完了
    setTimeout(() => {
      isStopping = false;
    }, 500);
  }

  /**
   * 音量変更時の処理
   * @param {number|string} value - 音量値 (0-100)
   */
  function onVolumeChange(value) {
    const el = getElements();
    const vol = parseInt(value, 10);

    if (el.liveAudioPlayer) {
      el.liveAudioPlayer.volume = vol / 100;
    }

    if (el.volumeValue) {
      el.volumeValue.textContent = `${vol}%`;
    }

    // 音量アイコン更新
    if (el.volumeIcon) {
      if (vol === 0) {
        el.volumeIcon.textContent = '🔇';
      } else if (vol < 50) {
        el.volumeIcon.textContent = '🔉';
      } else {
        el.volumeIcon.textContent = '🔊';
      }
    }
  }

  /**
   * ライブ音声プレイヤーUIを更新する
   * @param {boolean} playing - 再生中かどうか
   * @param {string} [statusText] - ステータステキスト（省略時は自動設定）
   */
  function updateLiveAudioUI(playing, statusText) {
    const el = getElements();

    if (el.liveAudioBtn) {
      if (playing) {
        el.liveAudioBtn.classList.add('active');
      } else {
        el.liveAudioBtn.classList.remove('active');
      }
    }

    if (el.liveAudioIcon) {
      el.liveAudioIcon.textContent = playing ? '⏹' : '▶';
    }

    const btnText = document.getElementById('live-audio-btn-text');
    if (btnText && typeof i18n !== 'undefined') {
      btnText.textContent = playing
        ? (i18n.getLanguage() === 'en' ? 'Stop Live Audio' : '受信音声を停止')
        : (i18n.getLanguage() === 'en' ? 'Listen to Live Audio' : '受信音声を聞く');
    }

    if (el.liveAudioStatus) {
      if (statusText) {
        el.liveAudioStatus.textContent = statusText;
      } else {
        if (typeof i18n !== 'undefined') {
          el.liveAudioStatus.textContent = playing
            ? (i18n.getLanguage() === 'en' ? 'Streaming' : 'ストリーミング中')
            : (i18n.getLanguage() === 'en' ? 'Stopped' : '停止中');
        } else {
          el.liveAudioStatus.textContent = playing ? 'ストリーミング中' : '停止中';
        }
      }
      el.liveAudioStatus.classList.toggle('streaming', playing);
    }
  }

  // 言語切り替えリスナー
  window.addEventListener('languageChanged', () => {
    updateLiveAudioUI(isLiveAudioPlaying);
  });

  // 公開API
  return {
    onStatusUpdate,
    onReceptionStart,
    onReceptionEnd,
    onToggleLiveAudio,
    onVolumeChange,
  };
})();
