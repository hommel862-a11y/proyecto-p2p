/**
 * P2P Radar HUD - Cross-Tab App Bridge
 * Injected on P2P Decisor origins (e.g. localhost:4200) to capture
 * BroadcastChannel messages from P2PRadarService and relay them to Binance P2P tabs.
 */
(function () {
  const CHANNEL_NAME = 'p2p_radar_hud_channel';
  console.log('[P2P Radar Bridge] Initializing cross-origin bridge for P2P Decisor...');

  let channel = null;

  function initChannel() {
    try {
      if (typeof BroadcastChannel === 'undefined') {
        console.warn('[P2P Radar Bridge] BroadcastChannel API is not supported in this environment.');
        return;
      }

      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => {
        const payload = event.data;
        if (!payload || !payload.timestampMs) return;

        // Persist latest payload in extension storage
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({
            lastRadarPayload: payload,
            lastSyncTime: Date.now(),
          });
        }

        // Notify background service worker
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'HUD_BROADCAST',
            payload: payload,
          }).catch(() => {
            // Silently ignore if background worker is dormant
          });
        }
      };

      console.log('[P2P Radar Bridge] Connected to BroadcastChannel:', CHANNEL_NAME);
    } catch (err) {
      console.error('[P2P Radar Bridge] Failed to initialize channel:', err);
    }
  }

  initChannel();
})();
