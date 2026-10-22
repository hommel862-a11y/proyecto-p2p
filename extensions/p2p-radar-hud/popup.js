/**
 * P2P Radar HUD - Extension Toolbar Popup Script
 */
document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('status-text');
  const syncEl = document.getElementById('sync-text');
  const tierEl = document.getElementById('tier-text');
  const spreadEl = document.getElementById('spread-text');
  const openAppBtn = document.getElementById('btn-open-app');

  chrome.storage.local.get(['lastRadarPayload', 'lastSyncTime'], (res) => {
    if (res && res.lastRadarPayload) {
      const payload = res.lastRadarPayload;
      const date = new Date(payload.timestampMs);

      statusEl.textContent = 'En Vivo';
      syncEl.textContent = date.toLocaleTimeString();
      tierEl.textContent = `${payload.userTier} (${payload.executionMode})`;

      if (payload.topRoutes && payload.topRoutes.length > 0) {
        const best = payload.topRoutes[0];
        spreadEl.textContent = `+${best.metrics.netSpreadPct.toFixed(2)}% (${best.sourceBank} ➔ ${best.targetBank})`;
      } else {
        spreadEl.textContent = 'Sin brechas > objetivo';
      }
    } else {
      statusEl.textContent = 'Esperando escaneo';
      statusEl.className = 'stat-val';
      syncEl.textContent = 'Nunca';
      tierEl.textContent = 'Desconocido';
      spreadEl.textContent = '--';
    }
  });

  if (openAppBtn) {
    openAppBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'http://localhost:4200/radar' });
    });
  }
});
