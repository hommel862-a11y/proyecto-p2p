import { test, expect, type Page } from '@playwright/test';

if (process.env['PW_CHANNEL']) {
  test.use({ channel: process.env['PW_CHANNEL'] as 'chrome' | 'msedge', serviceWorkers: 'block' });
} else {
  test.use({ serviceWorkers: 'block' });
}

const THEMES = ['dark', 'apple-dark', 'light', 'neon-pink'] as const;
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

async function installMockBinanceP2p(page: Page): Promise<void> {
  await page.route(/binance\.com\/bapi\/c2c|127\.0\.0\.1:51857|\/api\/binance[/-]p2p/i, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'POST, GET, OPTIONS',
          'access-control-allow-headers': '*',
        },
      });
      return;
    }

    const rawBody = route.request().postData() || '{}';
    let tradeType = 'BUY';
    let payTypes: string[] = [];
    try {
      const parsed = JSON.parse(rawBody) as { tradeType?: string; payTypes?: string[] };
      tradeType = parsed.tradeType || 'BUY';
      payTypes = Array.isArray(parsed.payTypes) ? parsed.payTypes : [];
    } catch {
      tradeType = 'BUY';
    }

    const bankKey = payTypes[0] || 'Banesco';
    const isBuy = tradeType === 'BUY';
    // Give different banks distinct spreads so arbitrage matrix and ticker always populate live routes
    const bankDelta = bankKey === 'Mercantil' ? 0.9 : bankKey === 'SpecificBank' ? -0.4 : 0;
    const basePrice = (isBuy ? 78.4 : 76.1) + bankDelta;

    const payload = {
      code: '000000',
      data: [
        {
          adv: {
            advNo: `${bankKey}-${tradeType}-1`,
            price: basePrice.toFixed(2),
            surplusAmount: '850.00',
            minSingleTransAmount: '5000',
            maxSingleTransAmount: '65000',
            payTimeLimit: 15,
            buyerKycLimit: 0,
            buyerRegDaysLimit: 0,
            buyerBtcPositionLimit: 0,
            takerAdditionalKycRequired: 0,
          },
          advertiser: {
            userNo: `u-${bankKey}-1`,
            nickName: `Libre_${bankKey}`,
            monthFinishRate: 0.985,
            monthOrderCount: 140,
            userType: 'user',
            userGrade: 1,
            proMerchant: false,
            badges: [],
          },
        },
        {
          adv: {
            advNo: `${bankKey}-${tradeType}-2`,
            price: (basePrice + (isBuy ? 0.15 : -0.12)).toFixed(2),
            surplusAmount: '1200.00',
            minSingleTransAmount: '10000',
            maxSingleTransAmount: '90000',
            payTimeLimit: 15,
            buyerKycLimit: 1,
            buyerRegDaysLimit: 30,
            buyerBtcPositionLimit: 0,
            takerAdditionalKycRequired: 0,
          },
          advertiser: {
            userNo: `m-${bankKey}-2`,
            nickName: `OroMerchant_${bankKey}`,
            monthFinishRate: 0.994,
            monthOrderCount: 620,
            userType: 'merchant',
            userGrade: 3,
            proMerchant: true,
            badges: ['Gold'],
          },
        },
        {
          adv: {
            advNo: `${bankKey}-${tradeType}-3`,
            price: (basePrice + (isBuy ? 0.28 : -0.25)).toFixed(2),
            surplusAmount: '640.00',
            minSingleTransAmount: '4000',
            maxSingleTransAmount: '45000',
            payTimeLimit: 15,
            buyerKycLimit: 0,
            buyerRegDaysLimit: 0,
            buyerBtcPositionLimit: 0,
            takerAdditionalKycRequired: 0,
          },
          advertiser: {
            userNo: `u-${bankKey}-3`,
            nickName: `Peer_${bankKey}`,
            monthFinishRate: 0.96,
            monthOrderCount: 68,
            userType: 'user',
            userGrade: 1,
            proMerchant: false,
            badges: [],
          },
        },
      ],
    };

    await route.fulfill({
      status: 200,
      headers: {
        'access-control-allow-origin': '*',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  });
}

test.describe('Quantum Radar v4 Spatial Liquid Glass — 4 Themes, Desktop, Laptop & Mobile 9:16', () => {
  test('desktop 1440x900 and laptop 1280x720 maintain zero overflow, zero emojis and full interactive views across 4 themes', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const txt = msg.text();
        if (
          !txt.includes('Failed to fetch') &&
          !txt.includes('ERR_CONNECTION_REFUSED') &&
          !txt.includes('ERR_FAILED') &&
          !txt.includes('504 (Gateway Timeout)')
        ) {
          errors.push(`console.error: ${txt}`);
        }
      }
    });

    await installMockBinanceP2p(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/radar');

    await expect(page.locator('app-radar-command-header')).toBeVisible();
    await expect(page.getByTestId('radar-hero-kpis')).toBeVisible();
    await expect(page.locator('app-radar-books-grid')).toBeVisible();
    await expect(page.locator('app-radar-tactical-cockpit')).toBeVisible();

    await page.getByTestId('radar-scan-btn').click();
    await expect(page.locator('.radar-offer-row').first()).toBeVisible({ timeout: 12000 });
    await expect(page.locator('.radar-error-banner')).toHaveCount(0);
    await expect(page.locator('app-radar-opportunity-ticker .ticker-bar')).toBeVisible();

    const radarText = (await page.locator('app-p2p-radar').innerText()) ?? '';
    expect(radarText).not.toMatch(EMOJI_PATTERN);
    expect(radarText).not.toContain('8500%');

    // Open Parámetros drawer and verify Estándar / Merchant controls
    await page.getByTestId('radar-params-toggle').click();
    await expect(page.getByTestId('merchant-level-STANDARD')).toBeVisible();
    await expect(page.getByTestId('toggle-evade-merchants')).toBeVisible();
    await expect(page.getByTestId('toggle-open-taker')).toBeVisible();

    await page.getByTestId('merchant-level-GOLD').click();
    await page.getByTestId('merchant-level-STANDARD').click();
    await page.getByTestId('radar-params-toggle').click();

    // Check 4 themes on 1440x900 & verify ticker does not collide with sidebar
    const sidebarBox = await page.locator('.sidebar').boundingBox();
    const tickerBar = page.locator('app-radar-opportunity-ticker .ticker-bar');
    if (sidebarBox && (await tickerBar.isVisible())) {
      const tickerBox = await tickerBar.boundingBox();
      if (tickerBox) {
        expect(tickerBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width - 2);
      }
    }

    for (const theme of THEMES) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `Desktop 1440 overflow in theme ${theme}`).toBeLessThanOrEqual(0);
    }

    // Check Matrix & Forensic views
    await page.getByTestId('radar-tab-MATRIX').click();
    await expect(page.locator('app-radar-matrix-view')).toBeVisible();
    await page.getByTestId('radar-tab-FORENSIC').click();
    await expect(page.locator('app-radar-forensic-view')).toBeVisible();
    await page.getByTestId('radar-tab-BOOKS').click();

    // Check Cockpit Fee Schedule subtab
    await page.getByTestId('cockpit-tab-fees').click();
    await expect(page.locator('.fee-table')).toBeVisible();
    await page.getByTestId('cockpit-tab-simulator').click();

    // Laptop 1280x720 check
    await page.setViewportSize({ width: 1280, height: 720 });
    for (const theme of THEMES) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `Laptop 1280 overflow in theme ${theme}`).toBeLessThanOrEqual(0);
    }

    expect(errors).toEqual([]);
  });

  test('mobile 9:16 (390x844) preserves zero overflow and clears .mobile-bottom-nav without ticker collision', async ({
    page,
  }) => {
    await installMockBinanceP2p(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/radar');

    await expect(page.locator('app-radar-command-header')).toBeVisible();
    await page.getByTestId('radar-scan-btn').click();
    await expect(page.locator('.radar-offer-row').first()).toBeVisible({ timeout: 12000 });
    await expect(page.locator('.radar-error-banner')).toHaveCount(0);
    await expect(page.locator('app-radar-opportunity-ticker .ticker-bar')).toBeVisible();

    for (const theme of THEMES) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `Mobile 390 overflow in theme ${theme}`).toBeLessThanOrEqual(0);
    }

    const scanBtnBox = await page.getByTestId('radar-scan-btn').boundingBox();
    expect(scanBtnBox).not.toBeNull();
    expect(scanBtnBox!.height).toBeGreaterThanOrEqual(44);

    const tickerBar = page.locator('app-radar-opportunity-ticker .ticker-bar');
    const bottomNav = page.locator('.mobile-bottom-nav');
    if ((await tickerBar.isVisible()) && (await bottomNav.isVisible())) {
      await tickerBar.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const tBox = await tickerBar.boundingBox();
      const navBox = await bottomNav.boundingBox();
      if (tBox && navBox) {
        expect(tBox.y + tBox.height).toBeLessThanOrEqual(navBox.y + 2);
      }
    }
  });
});
