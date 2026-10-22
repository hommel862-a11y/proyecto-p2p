/**
 * P2P Radar HUD - Tactical Terminal Overlay (Binance P2P Content Script)
 * Injects a floating, draggable, non-intrusive quantitative decision widget.
 */
(function () {
  const HUD_ROOT_ID = 'p2p-radar-hud-root';

  if (document.getElementById(HUD_ROOT_ID)) {
    return; // Already initialized
  }

  let currentPayload = null;
  let isMinimized = false;
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };

  const bankLabels = {
    Banesco: 'Banesco',
    Mercantil: 'Mercantil',
    SpecificBank: 'BDV',
    PagoMovil: 'Pago Móvil',
    Provincial: 'Provincial',
    Bancaribe: 'Bancaribe',
  };

  function createHudElement() {
    const root = document.createElement('div');
    root.id = HUD_ROOT_ID;

    root.innerHTML = `
      <div class="hud-card">
        <div class="hud-header" id="p2p-hud-drag-handle">
          <div class="hud-brand">
            <span class="pulse-dot"></span>
            <span class="hud-title font-mono">Radar Intel P2P</span>
          </div>
          <div class="hud-header-actions">
            <button type="button" class="hud-btn-icon" id="p2p-hud-minimize-btn" title="Minimizar / Expandir">_</button>
          </div>
        </div>

        <div class="hud-body" id="p2p-hud-body">
          <div class="hud-waiting">
            <div class="hud-waiting-spinner"></div>
            <span>Conectando con P2P Decisor Core...</span>
            <span style="font-size: 10px; color: #64748b;">Abre tu app en localhost:4200/radar para sincronizar.</span>
          </div>
        </div>

        <div class="hud-footer font-mono" id="p2p-hud-footer">
          <span id="p2p-hud-sync-time">Sync: --:--:--</span>
          <span id="p2p-hud-tier-badge">TIER: --</span>
        </div>
      </div>
    `;

    document.body.appendChild(root);
    setupInteractions(root);
    loadCachedPayload();
  }

  function setupInteractions(root) {
    const handle = root.querySelector('#p2p-hud-drag-handle');
    const minBtn = root.querySelector('#p2p-hud-minimize-btn');

    // Minimization Toggle
    minBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isMinimized = !isMinimized;
      root.classList.toggle('minimized', isMinimized);
      minBtn.textContent = isMinimized ? '□' : '_';
    });

    // Draggable Functionality
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('#p2p-hud-minimize-btn')) return;
      isDragging = true;
      const rect = root.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;
      root.style.right = 'auto'; // Disable right anchoring
      root.setPointerCapture(e.pointerId);
    });

    window.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const newX = Math.max(10, Math.min(window.innerWidth - 100, e.clientX - dragOffset.x));
      const newY = Math.max(10, Math.min(window.innerHeight - 50, e.clientY - dragOffset.y));
      root.style.left = `${newX}px`;
      root.style.top = `${newY}px`;
    });

    window.addEventListener('pointerup', () => {
      isDragging = false;
    });
  }

  function renderPayload(payload) {
    if (!payload) return;
    currentPayload = payload;

    const bodyEl = document.getElementById('p2p-hud-body');
    const syncTimeEl = document.getElementById('p2p-hud-sync-time');
    const tierBadgeEl = document.getElementById('p2p-hud-tier-badge');

    if (!bodyEl) return;

    // Update footer info
    const dateObj = new Date(payload.timestampMs);
    if (syncTimeEl) {
      syncTimeEl.textContent = `Sync: ${dateObj.toLocaleTimeString()}`;
    }
    if (tierBadgeEl) {
      tierBadgeEl.textContent = `TIER: ${payload.userTier} (${payload.executionMode})`;
    }

    const topRoute = payload.topRoutes && payload.topRoutes.length > 0 ? payload.topRoutes[0] : null;

    let html = '';

    // 1. Top Opportunity Card
    if (topRoute) {
      const srcName = bankLabels[topRoute.sourceBank] || topRoute.sourceBank;
      const tgtName = bankLabels[topRoute.targetBank] || topRoute.targetBank;
      const spreadSign = topRoute.metrics.netSpreadPct >= 0 ? '+' : '';
      const isViable = topRoute.metrics.netSpreadPct >= payload.targetNetMarginPct;

      html += `
        <div class="opportunity-hero">
          <div class="opportunity-top-row">
            <span class="badge-hero font-mono">⚡ MEJOR RUTA TÁCTICA</span>
            <span class="spread-pill font-mono">${spreadSign}${topRoute.metrics.netSpreadPct.toFixed(2)}% NETO</span>
          </div>

          <div class="route-path-text font-mono">
            <strong>${srcName}</strong> (${topRoute.sellPrice.toFixed(2)})
            <span class="arrow-accent">➔</span>
            <strong>${tgtName}</strong> (${topRoute.buyPrice.toFixed(2)})
          </div>

          <div class="profit-row font-mono">
            <span>Ganancia Neta (${payload.operatingCapitalUsdt} USDT):</span>
            <span class="profit-highlight font-mono">+${topRoute.metrics.netProfitUsdt.toFixed(2)} USDT (+Bs ${topRoute.metrics.netProfitFiat.toFixed(2)})</span>
          </div>
        </div>

        <div class="action-box">
          <div class="target-rate-info font-mono">
            <span class="target-rate-label">Tasa Sugerida (${srcName})</span>
            <span class="target-rate-val font-mono">${topRoute.metrics.targetSellPrice.toFixed(2)} VES</span>
          </div>
          <button type="button" class="btn-copy-target font-mono" id="p2p-hud-btn-copy" data-rate="${topRoute.metrics.targetSellPrice.toFixed(2)}">
            📋 Copiar Tasa
          </button>
        </div>
      `;
    } else {
      html += `
        <div class="hud-waiting">
          <span>Libros escaneados. Sin brechas sobre el margen objetivo (+${payload.targetNetMarginPct}%).</span>
        </div>
      `;
    }

    // 2. Micro Orderbook Summary by Bank
    if (payload.topBanks && payload.topBanks.length > 0) {
      html += `
        <div class="banks-summary-grid font-mono">
          <div style="font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase;">
            Libros Limpios Activos
          </div>
      `;

      for (const bank of payload.topBanks) {
        const bName = bankLabels[bank.bank] || bank.bank;
        const trendClass = `trend-${bank.trend}`;
        const hasBots = bank.botCount > 0;
        const buyPrice = bank.topBuyPrice != null ? bank.topBuyPrice.toFixed(2) : '--';
        const sellPrice = bank.topSellPrice != null ? bank.topSellPrice.toFixed(2) : '--';

        html += `
          <div class="summary-bank-row">
            <div class="bank-name-badge">
              <span>${bName}</span>
              <span class="trend-mini-tag ${trendClass}">${bank.trend}</span>
              ${hasBots ? `<span class="bot-indicator-dot" title="${bank.botCount} bot(s) detectados"></span>` : ''}
            </div>

            <div class="bank-rates-preview font-mono">
              <span class="rate-col font-mono">
                <span class="rate-label">C:</span>
                <span class="buy-val">${buyPrice}</span>
              </span>
              <span class="rate-col font-mono">
                <span class="rate-label">V:</span>
                <span class="sell-val">${sellPrice}</span>
              </span>
            </div>
          </div>
        `;
      }

      html += `</div>`;
    }

    bodyEl.innerHTML = html;

    // Attach copy button handler
    const copyBtn = document.getElementById('p2p-hud-btn-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const rate = copyBtn.getAttribute('data-rate');
        if (rate && navigator.clipboard) {
          navigator.clipboard.writeText(rate);
          copyBtn.textContent = '✓ ¡Copiado!';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.textContent = '📋 Copiar Tasa';
            copyBtn.classList.remove('copied');
          }, 1800);
        }
      });
    }
  }

  function loadCachedPayload() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['lastRadarPayload'], (res) => {
        if (res && res.lastRadarPayload) {
          renderPayload(res.lastRadarPayload);
        }
      });
    }
  }

  // Listen for real-time messages from background script
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === 'HUD_UPDATE' && message.payload) {
        renderPayload(message.payload);
      }
    });
  }

  // Initialize once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createHudElement);
  } else {
    createHudElement();
  }
})();
