// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, beforeEach, vi } from 'vitest';

const hudDir = path.resolve(process.cwd(), 'extensions/p2p-radar-hud');
const manifestPath = path.join(hudDir, 'manifest.json');
const contentPath = path.join(hudDir, 'content.js');
const popupPath = path.join(hudDir, 'popup.js');

describe('P2P Radar HUD Extension (MV3 Contract & XSS Security)', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete window.__P2P_RADAR_HUD_API__;
  });

  it('registers Electron desktop localhost:51857 and 127.0.0.1:51857 bridge origins in manifest.json', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const bridgeMatches = manifest.content_scripts?.[0]?.matches ?? [];
    expect(bridgeMatches).toContain('http://localhost:51857/*');
    expect(bridgeMatches).toContain('http://127.0.0.1:51857/*');
  });

  it('never assigns innerHTML in content.js and safely renders RadarHudPayload contract without TypeError or XSS', () => {
    const source = fs.readFileSync(contentPath, 'utf-8');
    expect(source).not.toMatch(/\.innerHTML\s*=/);

    let messageListener = null;
    globalThis.chrome = {
      storage: {
        local: {
          get: (_keys, cb) => cb({}),
        },
      },
      runtime: {
        onMessage: {
          addListener: (fn) => {
            messageListener = fn;
          },
        },
      },
    };

    vm.runInThisContext(source, { filename: 'content.js' });
    expect(typeof messageListener).toBe('function');

    const payload = {
      version: '1.0.0',
      timestampMs: 1700000000000,
      userTier: 'REGULAR',
      merchantLevel: 'STANDARD',
      executionMode: 'TAKER_MAKER',
      operatingCapitalUsdt: 1000,
      targetNetMarginPct: 0.8,
      bestRoute: {
        sourceBank: 'Banesco',
        targetBank: '<img src=x onerror="window.__xss=1">',
        isInterbank: true,
        sellPrice: 78.5,
        buyPrice: 76.2,
        netSpreadPct: 2.35,
        netProfitUsdt: 23.5,
      },
      topRoutes: [
        {
          sourceBank: 'Banesco',
          targetBank: '<img src=x onerror="window.__xss=1">',
          isInterbank: true,
          sellPrice: 78.5,
          buyPrice: 76.2,
          netSpreadPct: 2.35,
          netProfitUsdt: 23.5,
        },
      ],
      bankTargetRates: {
        Banesco: {
          bank: 'Banesco',
          effectiveBuyPrice: 76.0,
          effectiveSellPrice: 78.5,
          vwapBuy: 76.1,
          vwapSell: 78.4,
          targetMakerSellPrice: 78.55,
          targetMakerBuyPrice: 76.05,
        },
      },
      detectedBots: [
        {
          advertiserNo: 'bot-1',
          nickName: 'AutoBot',
          botType: 'PING_PONG',
          bank: 'Banesco',
          side: 'SELL',
          limitPrice: 78.5,
          recommendedCounterPrice: 78.55,
        },
      ],
      activeBanks: ['Banesco'],
    };

    expect(() => {
      messageListener({ action: 'HUD_UPDATE', payload });
    }).not.toThrow();

    const body = document.getElementById('p2p-hud-body');
    expect(body).not.toBeNull();
    expect(body.querySelectorAll('img, script')).toHaveLength(0);
    expect(body.textContent).toContain('+2.35% NETO');
    expect(body.textContent).toContain('<img src=x onerror="window.__xss=1">');
    expect(body.textContent).toContain('+23.50 USDT');
    expect(body.querySelector('#p2p-hud-btn-copy')?.getAttribute('data-rate')).toBe('78.55');
    expect(body.querySelectorAll('.summary-bank-row')).toHaveLength(1);
    expect(body.querySelectorAll('.bot-indicator-dot')).toHaveLength(1);
    expect(document.getElementById('p2p-hud-tier-badge')?.textContent).toContain('STANDARD');
  });

  it('popup.js reads topRoutes[0].netSpreadPct directly without crashing on missing .metrics', () => {
    document.body.innerHTML = `
      <span id="status-text"></span>
      <span id="sync-text"></span>
      <span id="tier-text"></span>
      <span id="spread-text"></span>
      <button id="btn-open-app"></button>
    `;

    const popupSource = fs.readFileSync(popupPath, 'utf-8');
    globalThis.chrome = {
      storage: {
        local: {
          get: (_keys, cb) =>
            cb({
              lastRadarPayload: {
                timestampMs: 1700000000000,
                userTier: 'REGULAR',
                merchantLevel: 'STANDARD',
                executionMode: 'TAKER_MAKER',
                topRoutes: [
                  {
                    sourceBank: 'Banesco',
                    targetBank: 'Mercantil',
                    isInterbank: true,
                    sellPrice: 78.5,
                    buyPrice: 76.2,
                    netSpreadPct: 1.92,
                    netProfitUsdt: 19.2,
                  },
                ],
              },
            }),
        },
      },
      tabs: { create: vi.fn() },
    };

    vm.runInThisContext(popupSource, { filename: 'popup.js' });
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(document.getElementById('tier-text')?.textContent).toContain('STANDARD');
    expect(document.getElementById('spread-text')?.textContent).toContain('+1.92%');
    expect(document.getElementById('spread-text')?.textContent).toContain('Banesco');
  });
});
