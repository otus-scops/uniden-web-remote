/**
 * @fileoverview Scanner Display Module
 * @description Manages scanner LCD UI including frequency, channel tags, RSSI meter, and live audio
 */

/**
 * Scanner Display UI controller
 */
const scannerDisplay = (() => {
  // Cached DOM elements
  let elements = {};

  /** @type {boolean} Whether scanner is actively receiving signal */
  let isCurrentlyReceiving = false;

  /**
   * Retrieve and cache DOM elements
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
      // Live audio player controls
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
   * Handle scanner status updates
   * @param {Object} status - Scanner status object
   */
  function onStatusUpdate(status) {
    const el = getElements();

    // Connection state
    updateConnectionStatus(el, status.isConnected);

    // Model and firmware version
    if (status.model) {
      el.scannerModel.textContent = `${status.model}${status.firmwareVersion ? ' - ' + status.firmwareVersion : ''}`;
    }

    // Active reception display
    if (status.currentReception && status.isReceiving) {
      updateReceptionDisplay(el, status.currentReception);
      setReceivingState(el, true);
    } else if (!status.isReceiving) {
      if (isCurrentlyReceiving) {
        clearReceptionDisplay(el);
      }
      setReceivingState(el, false);
    }

    // Signal strength (RSSI)
    updateRssi(el, status.rssi || 0);

    // Status badges
    updateBadges(el, status);
  }

  /** @type {boolean} Last known connection state */
  let lastConnectedState = false;

  /**
   * Update connection indicator UI
   * @param {Object} el - DOM elements map
   * @param {boolean} connected - Connection status
   */
  function updateConnectionStatus(el, connected) {
    lastConnectedState = connected;
    if (connected) {
      el.statusDot.classList.add('connected');
      el.connectionText.textContent = typeof i18n !== 'undefined' ? i18n.t('header.connected') : '接続中';
      el.connectionText.style.color = 'var(--color-accent-green)';
    } else {
      el.statusDot.classList.remove('connected');
      el.connectionText.textContent = typeof i18n !== 'undefined' ? i18n.t('header.disconnected') : '切断中';
      el.connectionText.style.color = 'var(--color-accent-red)';
    }
  }

  /**
   * Update active reception data display
   * @param {Object} el - DOM elements map
   * @param {Object} reception - Reception metadata
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
   * Clear active reception data display
   * @param {Object} el - DOM elements map
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
   * Toggle visual state between receiving and scanning
   * @param {Object} el - DOM elements map
   * @param {boolean} receiving - Whether receiving
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
   * Update RSSI signal strength bar
   * @param {Object} el - DOM elements map
   * @param {number} rssi - RSSI signal level (0-7)
   */
  function updateRssi(el, rssi) {
    const maxRssi = 7;
    const percentage = Math.min(100, Math.max(0, (rssi / maxRssi) * 100));

    el.rssiBar.style.width = `${percentage}%`;
    el.rssiValue.textContent = rssi;
  }

  /**
   * Update status badges (Scan, Receiving, Recording)
   * @param {Object} el - DOM elements map
   * @param {Object} status - Status object
   */
  function updateBadges(el, status) {
    // Scanning badge
    if (status.isConnected && !status.isReceiving) {
      el.badgeScan.classList.add('active');
    } else {
      el.badgeScan.classList.remove('active');
    }

    // Receiving badge
    if (status.isReceiving) {
      el.badgeReceiving.classList.add('active');
    } else {
      el.badgeReceiving.classList.remove('active');
    }

    // Recording badge
    if (status.isRecording) {
      el.badgeRecording.classList.add('recording');
    } else {
      el.badgeRecording.classList.remove('recording');
    }
  }

  /**
   * Handle reception start event
   * @param {Object} data - Reception start event data
   */
  function onReceptionStart(data) {
    const el = getElements();
    if (data.reception) {
      updateReceptionDisplay(el, data.reception);
    }
    setReceivingState(el, true);
  }

  /**
   * Handle reception end event
   * @param {Object} data - Reception end event data
   */
  function onReceptionEnd(data) {
    const el = getElements();
    // Hold display briefly before resetting
    setTimeout(() => {
      if (!isCurrentlyReceiving) {
        clearReceptionDisplay(el);
        setReceivingState(el, false);
      }
    }, 500);
  }

  /** @type {AudioPlayer|null} AudioPlayer instance */
  let audioPlayer = null;

  /**
   * Get or initialize AudioPlayer instance
   * @returns {AudioPlayer}
   * @private
   */
  function getAudioPlayer() {
    if (!audioPlayer) {
      audioPlayer = new AudioPlayer({
        sampleRate: 16000,
        channels: 1,
        bufferLatencySec: 0.06,
        maxLatencySec: 0.25,
        onStateChange: (isPlaying, statusText) => {
          updateLiveAudioUI(isPlaying, statusText);
        },
        onError: (err) => {
          console.error('[ScannerDisplay] Audio error:', err);
          updateLiveAudioUI(false, typeof i18n !== 'undefined' ? i18n.t('scanner.liveAudioRetry') : 'クリックして再試行');
        },
      });

      const el = getElements();
      if (el.liveAudioVolume) {
        audioPlayer.setVolume(parseInt(el.liveAudioVolume.value, 10) || 80);
      }
    }
    return audioPlayer;
  }

  /**
   * Check whether live audio is active
   * @returns {boolean}
   */
  function isLiveAudioActive() {
    return audioPlayer ? audioPlayer.isPlaying() : false;
  }

  /**
   * Toggle live audio playback ON/OFF
   */
  function onToggleLiveAudio() {
    const player = getAudioPlayer();
    if (player.isPlaying()) {
      player.stop();
    } else {
      player.start();
    }
  }

  /**
   * Handle volume slider change
   * @param {number|string} value - Volume level (0-100)
   */
  function onVolumeChange(value) {
    const el = getElements();
    const vol = parseInt(value, 10);
    const player = getAudioPlayer();
    player.setVolume(vol);

    if (el.volumeValue) {
      el.volumeValue.textContent = `${vol}%`;
    }

    // Update volume icon
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
   * Update live audio player UI
   * @param {boolean} playing - Whether stream is playing
   * @param {string} [statusText] - Status text label (auto-detected if omitted)
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

  // Language change event listener
  window.addEventListener('languageChanged', () => {
    const el = getElements();
    updateConnectionStatus(el, lastConnectedState);
    updateLiveAudioUI(isLiveAudioActive());
  });

  // Public API
  return {
    onStatusUpdate,
    onReceptionStart,
    onReceptionEnd,
    onToggleLiveAudio,
    onVolumeChange,
  };
})();
