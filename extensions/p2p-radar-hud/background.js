/**
 * P2P Radar HUD - Background Service Worker (Manifest V3)
 * Coordinates data routing between local P2P Decisor app tabs and active Binance P2P tabs.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[P2P Radar Background] Extension installed successfully.');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'HUD_BROADCAST' && message.payload) {
    const payload = message.payload;

    // Cache locally for instant loading
    chrome.storage.local.set({
      lastRadarPayload: payload,
      lastSyncTime: Date.now(),
    });

    // Broadcast update to all Binance P2P tabs
    chrome.tabs.query({ url: '*://p2p.binance.com/*' }, (tabs) => {
      for (const tab of tabs) {
        if (tab.id != null) {
          chrome.tabs.sendMessage(tab.id, {
            action: 'HUD_UPDATE',
            payload: payload,
          }).catch(() => {
            // Tab might be loading or closing
          });
        }
      }
    });

    sendResponse({ status: 'delivered', recipientCount: 'all_binance_tabs' });
  }

  return true;
});
