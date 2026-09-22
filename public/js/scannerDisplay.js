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

  /** @type {boolean} Whether live audio streaming is active */
  let isLiveAudioPlaying = false;

  /** @type {number|null} Reconnection timer ID */
  let liveAudioReconnectTimer = null;

  /** @type {boolean} Stopping in progress flag (guard against duplicate triggers) */
  let isStopping = false;

  /**
   * Toggle live audio playback ON/OFF
   */
  function onToggleLiveAudio() {
    // Ignore clicks while stopping
    if (isStopping) {
      console.log('[ScannerDisplay] Ignoring toggle request: currently stopping audio');
      return;
    }

    if (isLiveAudioPlaying) {
      stopLiveAudio();
    } else {
      startLiveAudio();
    }
  }

  /**
   * Recreate audio element to completely flush stale buffers and connections
   * @returns {HTMLAudioElement} Fresh audio element
   * @private
   */
  function resetAudioElement() {
    const el = getElements();
    const oldPlayer = el.liveAudioPlayer;

    if (oldPlayer) {
      // Clear event listeners
      oldPlayer.onerror = null;
      oldPlayer.onended = null;
      oldPlayer.oncanplay = null;
      oldPlayer.pause();
      oldPlayer.removeAttribute('src');
      oldPlayer.load();
    }

    // Create and insert clean audio element
    const newPlayer = document.createElement('audio');
    newPlayer.id = 'live-audio-player';
    newPlayer.preload = 'none';

    if (oldPlayer && oldPlayer.parentNode) {
      oldPlayer.parentNode.replaceChild(newPlayer, oldPlayer);
    }

    // Update cache
    elements.liveAudioPlayer = newPlayer;
    return newPlayer;
  }

  /**
   * Start live audio streaming
   */
  function startLiveAudio() {
    const el = getElements();

    // Guard against re-entry while stopping
    if (isStopping) {
      console.log('[ScannerDisplay] Delaying start: audio is stopping...');
      setTimeout(() => {
        if (!isStopping && !isLiveAudioPlaying) {
          startLiveAudio();
        }
      }, 500);
      return;
    }

    // Clear any pending reconnection timer
    if (liveAudioReconnectTimer) {
      clearTimeout(liveAudioReconnectTimer);
      liveAudioReconnectTimer = null;
    }

    // Reset audio element to ensure clean connection
    const player = resetAudioElement();

    // Immediately update UI for fast user feedback
    isLiveAudioPlaying = true;
    updateLiveAudioUI(true, typeof i18n !== 'undefined' ? i18n.t('scanner.liveAudioConnecting') : '接続中...');

    // Attach event handlers before setting src
    player.onerror = () => {
      if (isLiveAudioPlaying) {
        console.log('[ScannerDisplay] Stream error, reconnecting in 3 seconds...');
        const reconnectingMsg = typeof i18n !== 'undefined' && i18n.getLanguage() === 'en' ? 'Reconnecting...' : '再接続中...';
        updateLiveAudioUI(true, reconnectingMsg);
        liveAudioReconnectTimer = setTimeout(() => {
          if (isLiveAudioPlaying) {
            startLiveAudio();
          }
        }, 3000);
      }
    };

    player.onended = () => {
      if (isLiveAudioPlaying) {
        console.log('[ScannerDisplay] Stream ended, reconnecting...');
        liveAudioReconnectTimer = setTimeout(() => {
          if (isLiveAudioPlaying) {
            startLiveAudio();
          }
        }, 1000);
      }
    };

    // canplay event: update to streaming UI
    player.oncanplay = () => {
      if (isLiveAudioPlaying) {
        updateLiveAudioUI(true);
      }
    };

    // Append timestamp query parameter to bypass browser caching
    const streamUrl = `/api/audio/stream?t=${Date.now()}`;
    player.src = streamUrl;
    player.volume = (el.liveAudioVolume ? el.liveAudioVolume.value : 80) / 100;

    const playPromise = player.play();
    if (playPromise) {
      playPromise.then(() => {
        updateLiveAudioUI(true);
        console.log('[ScannerDisplay] Live audio stream started');
      }).catch((err) => {
        // If intentionally stopped, ignore interruption
        if (!isLiveAudioPlaying) {
          return;
        }
        console.error('[ScannerDisplay] Live audio playback error:', err.message);
        // Handle autoplay policy restrictions
        isLiveAudioPlaying = false;
        updateLiveAudioUI(false, typeof i18n !== 'undefined' ? i18n.t('scanner.liveAudioRetry') : 'クリックして再試行');
      });
    }
  }

  /**
   * Stop live audio streaming
   */
  function stopLiveAudio() {
    const el = getElements();

    // Set flags first to prevent error handlers from showing retry prompts
    isLiveAudioPlaying = false;
    isStopping = true;

    if (liveAudioReconnectTimer) {
      clearTimeout(liveAudioReconnectTimer);
      liveAudioReconnectTimer = null;
    }

    // Recreate audio element to cleanly disconnect stream
    resetAudioElement();

    updateLiveAudioUI(false);
    console.log('[ScannerDisplay] Live audio stopped');

    // Brief delay to allow server-side streaming process to terminate
    setTimeout(() => {
      isStopping = false;
    }, 500);
  }

  /**
   * Handle volume slider change
   * @param {number|string} value - Volume level (0-100)
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
    updateLiveAudioUI(isLiveAudioPlaying);
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
