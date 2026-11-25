/**
 * P2P Radar HUD - Tactical Terminal Overlay (Binance P2P Content Script)
 * Injects a floating, draggable, non-intrusive quantitative decision widget
 * built strictly via safe DOM APIs (zero innerHTML).
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
    BBVA: 'Provincial',
    Provincial: 'Provincial',
    BNC: 'BNC',
    Bancaribe: 'Bancaribe',
    Banplus: 'Banplus',
    BanescoPanama: 'Banesco Panamá',
    Zinli: 'Zinli',
  };

  function el(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    if (options.id) node.id = options.id;
    if (options.className) node.className = options.className;
    if (options.text != null) node.textContent = String(options.text);
    if (options.title) node.title = String(options.title);
    if (options.type) node.type = String(options.type);
    if (options.styleText) node.style.cssText = options.styleText;
    if (options.attrs) {
      for (const [k, v] of Object.entries(options.attrs)) {
        if (v != null) node.setAttribute(k, String(v));
      }
    }
    for (const child of children) {
      if (child != null) node.appendChild(child);
    }
    return node;
  }

  function formatPrice(val) {
    const n = Number(val);
    return Number.isFinite(n) && n > 0 ? n.toFixed(2) : '--';
  }

  function createHudElement() {
    const root = el('div', { id: HUD_ROOT_ID }, [
      el('div', { className: 'hud-card' }, [
        el('div', { className: 'hud-header', id: 'p2p-hud-drag-handle' }, [
          el('div', { className: 'hud-brand' }, [
            el('span', { className: 'pulse-dot' }),
            el('span', { className: 'hud-title font-mono', text: 'Radar Intel P2P' }),
          ]),
          el('div', { className: 'hud-header-actions' }, [
            el('button', {
              type: 'button',
              className: 'hud-btn-icon',
              id: 'p2p-hud-minimize-btn',
              title: 'Minimizar / Expandir',
              text: '_',
            }),
          ]),
        ]),
        el('div', { className: 'hud-body', id: 'p2p-hud-body' }, [
          el('div', { className: 'hud-waiting' }, [
            el('div', { className: 'hud-waiting-spinner' }),
            el('span', { text: 'Conectando con P2P Decisor Core...' }),
            el('span', {
              styleText: 'font-size: 10px; color: #64748b;',
              text: 'Abre tu app en localhost:4200/radar o app desktop (:51857) para sincronizar.',
            }),
          ]),
        ]),
        el('div', { className: 'hud-footer font-mono', id: 'p2p-hud-footer' }, [
          el('span', { id: 'p2p-hud-sync-time', text: 'Sync: --:--:--' }),
          el('span', { id: 'p2p-hud-tier-badge', text: 'NIVEL: --' }),
        ]),
      ]),
    ]);

    document.body.appendChild(root);
    setupInteractions(root);
    loadCachedPayload();
  }

  function setupInteractions(root) {
    const handle = root.querySelector('#p2p-hud-drag-handle');
    const minBtn = root.querySelector('#p2p-hud-minimize-btn');

    if (minBtn) {
      minBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isMinimized = !isMinimized;
        root.classList.toggle('minimized', isMinimized);
        minBtn.textContent = isMinimized ? '□' : '_';
      });
    }

    if (handle) {
      handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('#p2p-hud-minimize-btn')) return;
        isDragging = true;
        const rect = root.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - dragOffset.top;
        root.style.right = 'auto';
        if (typeof root.setPointerCapture === 'function') {
          root.setPointerCapture(e.pointerId);
        }
      });
    }

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

  function buildTopRouteSection(payload, topRoute) {
    const srcName = bankLabels[topRoute.sourceBank] || String(topRoute.sourceBank || '--');
    const tgtName = bankLabels[topRoute.targetBank] || String(topRoute.targetBank || '--');
    const netSpreadPct = Number(topRoute.netSpreadPct ?? topRoute.metrics?.netSpreadPct ?? 0);
    const netProfitUsdt = Number(topRoute.netProfitUsdt ?? topRoute.metrics?.netProfitUsdt ?? 0);
    const buyPrice = Number(topRoute.buyPrice ?? 0);
    const sellPrice = Number(topRoute.sellPrice ?? 0);
    const spreadSign = netSpreadPct >= 0 ? '+' : '';
    const isViable = netSpreadPct >= Number(payload.targetNetMarginPct ?? 0);

    const bankTarget = payload.bankTargetRates?.[topRoute.sourceBank];
    const targetSellPrice = Number(
      bankTarget?.targetMakerSellPrice ?? topRoute.metrics?.targetSellPrice ?? sellPrice,
    );
    const targetSellFormatted = Number.isFinite(targetSellPrice) ? targetSellPrice.toFixed(2) : '0.00';

    const profitSign = netProfitUsdt >= 0 ? '+' : '';
    const estFiatProfit =
      topRoute.metrics?.netProfitFiat ?? (sellPrice > 0 ? netProfitUsdt * sellPrice : null);
    const profitText =
      estFiatProfit != null && Number.isFinite(estFiatProfit)
        ? `${profitSign}${netProfitUsdt.toFixed(2)} USDT (${profitSign}Bs ${estFiatProfit.toFixed(2)})`
        : `${profitSign}${netProfitUsdt.toFixed(2)} USDT`;

    const heroCard = el('div', { className: 'opportunity-hero' }, [
      el('div', { className: 'opportunity-top-row' }, [
        el('span', {
          className: 'badge-hero font-mono',
          text: isViable ? '⚡ MEJOR RUTA TÁCTICA' : '⚡ RUTA EN SEGUIMIENTO',
        }),
        el('span', {
          className: 'spread-pill font-mono',
          text: `${spreadSign}${netSpreadPct.toFixed(2)}% NETO`,
        }),
      ]),
      el('div', { className: 'route-path-text font-mono' }, [
        el('strong', { text: srcName }),
        document.createTextNode(` (${sellPrice.toFixed(2)}) `),
        el('span', { className: 'arrow-accent', text: '➔' }),
        document.createTextNode(' '),
        el('strong', { text: tgtName }),
        document.createTextNode(` (${buyPrice.toFixed(2)})`),
      ]),
      el('div', { className: 'profit-row font-mono' }, [
        el('span', { text: `Ganancia Neta (${payload.operatingCapitalUsdt ?? 0} USDT):` }),
        el('span', { className: 'profit-highlight font-mono', text: profitText }),
      ]),
    ]);

    const copyBtn = el('button', {
      type: 'button',
      className: 'btn-copy-target font-mono',
      id: 'p2p-hud-btn-copy',
      attrs: { 'data-rate': targetSellFormatted },
      text: '📋 Copiar Tasa',
    });

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

    const actionBox = el('div', { className: 'action-box' }, [
      el('div', { className: 'target-rate-info font-mono' }, [
        el('span', { className: 'target-rate-label', text: `Tasa Sugerida (${srcName})` }),
        el('span', { className: 'target-rate-val font-mono', text: `${targetSellFormatted} VES` }),
      ]),
      copyBtn,
    ]);

    return [heroCard, actionBox];
  }

  function buildBankRatesSection(payload) {
    const targetRates = Object.values(payload.bankTargetRates || {});
    if (targetRates.length === 0) return null;

    const bots = Array.isArray(payload.detectedBots) ? payload.detectedBots : [];
    const rows = targetRates.map((rate) => {
      const bankKey = rate.bank || '';
      const bName = bankLabels[bankKey] || bankKey;
      const botCount = bots.filter((b) => b.bank === bankKey).length;

      const badgeChildren = [el('span', { text: bName })];
      if (Number.isFinite(rate.targetMakerSellPrice) && rate.targetMakerSellPrice > 0) {
        badgeChildren.push(
          el('span', {
            className: 'trend-mini-tag',
            text: `M:${rate.targetMakerSellPrice.toFixed(2)}`,
          }),
        );
      }
      if (botCount > 0) {
        badgeChildren.push(
          el('span', {
            className: 'bot-indicator-dot',
            title: `${botCount} bot(s) detectados`,
          }),
        );
      }

      return el('div', { className: 'summary-bank-row' }, [
        el('div', { className: 'bank-name-badge' }, badgeChildren),
        el('div', { className: 'bank-rates-preview font-mono' }, [
          el('span', { className: 'rate-col font-mono' }, [
            el('span', { className: 'rate-label', text: 'C:' }),
            el('span', { className: 'buy-val', text: formatPrice(rate.effectiveBuyPrice) }),
          ]),
          el('span', { className: 'rate-col font-mono' }, [
            el('span', { className: 'rate-label', text: 'V:' }),
            el('span', { className: 'sell-val', text: formatPrice(rate.effectiveSellPrice) }),
          ]),
        ]),
      ]);
    });

    return el('div', { className: 'banks-summary-grid font-mono' }, [
      el('div', {
        styleText: 'font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase;',
        text: 'Libros Limpios Activos',
      }),
      ...rows,
    ]);
  }

  function renderPayload(payload) {
    if (!payload) return;
    currentPayload = payload;

    const bodyEl = document.getElementById('p2p-hud-body');
    const syncTimeEl = document.getElementById('p2p-hud-sync-time');
    const tierBadgeEl = document.getElementById('p2p-hud-tier-badge');

    if (!bodyEl) return;

    const dateObj = new Date(payload.timestampMs);
    if (syncTimeEl) {
      const timeLabel = Number.isFinite(dateObj.getTime()) ? dateObj.toLocaleTimeString() : '--:--:--';
      syncTimeEl.textContent = `Sync: ${timeLabel}`;
    }
    if (tierBadgeEl) {
      const level = payload.merchantLevel || payload.userTier || '--';
      tierBadgeEl.textContent = `NIVEL: ${level} (${payload.executionMode || '--'})`;
    }

    const fragment = document.createDocumentFragment();
    const topRoute =
      payload.topRoutes && payload.topRoutes.length > 0
        ? payload.topRoutes[0]
        : payload.bestRoute || null;

    if (topRoute) {
      for (const node of buildTopRouteSection(payload, topRoute)) {
        fragment.appendChild(node);
      }
    } else {
      fragment.appendChild(
        el('div', { className: 'hud-waiting' }, [
          el('span', {
            text: `Libros escaneados. Sin brechas sobre el margen objetivo (+${payload.targetNetMarginPct ?? 0}%).`,
          }),
        ]),
      );
    }

    const banksGrid = buildBankRatesSection(payload);
    if (banksGrid) {
      fragment.appendChild(banksGrid);
    }

    bodyEl.replaceChildren(fragment);
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

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.action === 'HUD_UPDATE' && message.payload) {
        renderPayload(message.payload);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createHudElement);
  } else {
    createHudElement();
  }
})();
