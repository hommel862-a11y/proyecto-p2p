import { test, expect } from '@playwright/test';

if (process.env['PW_CHANNEL']) {
  test.use({ channel: process.env['PW_CHANNEL'] as 'chrome' | 'msedge' });
}

const THEMES = ['dark', 'apple-dark', 'light', 'neon-pink'] as const;
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

test.describe('Finanzas 360 Institutional UI — 4 Themes, Desktop & Mobile 9:16', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('p2p.finance360.ledger');
      localStorage.removeItem('p2p.finance360.privacy_mode');
    });
  });

  test('desktop 1440x900 renders all 5 tabs across 4 themes with zero overflow, zero emojis and zero console errors', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore offline/network proxy errors in isolated static bundle preview
        if (!text.includes('Failed to fetch') && !text.includes('ERR_CONNECTION_REFUSED')) {
          errors.push(`console.error: ${text}`);
        }
      }
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/finanzas-360');
    await expect(page.locator('app-f360-command-header')).toBeVisible();
    await expect(page.locator('app-f360-overview')).toBeVisible();

    const bodyText = (await page.locator('app-finance-360').innerText()) ?? '';
    expect(bodyText).not.toMatch(EMOJI_PATTERN);

    for (const theme of THEMES) {
      await page.evaluate((t) => {
        document.documentElement.setAttribute('data-theme', t);
      }, theme);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `Desktop overflow in theme ${theme}`).toBeLessThanOrEqual(1);
    }

    // Walk all 5 navigation tabs + Pyme/Quotes subtabs
    await page.getByTestId('nav-tab-vaults').click();
    await expect(page.locator('app-f360-vaults-ledger')).toBeVisible();

    await page.getByTestId('nav-tab-analytics').click();
    await expect(page.locator('app-finance-analytics')).toBeVisible();

    await page.getByTestId('nav-tab-cashea').click();
    await expect(page.locator('app-cashea-calculator')).toBeVisible();
    await expect(page.locator('app-cashea-calculator')).toContainText('Araguaney');

    await page.getByTestId('nav-tab-pyme_quotes').click();
    await expect(page.locator('app-pyme-manager')).toBeVisible();

    await page.getByTestId('subtab-quotes').click();
    await expect(page.locator('app-quote-builder')).toBeVisible();

    const finalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(finalOverflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test('scoped Ctrl+K overrides global palette without collision and typed RESET guards destructive wipe', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/finanzas-360');
    await expect(page.locator('app-f360-command-header')).toBeVisible();

    // Scoped Ctrl+K
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('f360-scoped-palette')).toBeVisible();
    await expect(page.locator('.palette-backdrop')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('f360-scoped-palette')).toHaveCount(0);

    // Open overflow menu -> Load Demo -> Open Reset modal -> verify typed RESET guard
    await page.getByTestId('f360-overflow-trigger').click();
    await page.getByTestId('overflow-action-load_demo').click();

    await page.getByTestId('nav-tab-vaults').click();
    await expect(page.locator('[data-testid^="vault-card-"]').first()).toBeVisible();

    await page.getByTestId('f360-overflow-trigger').click();
    await page.getByTestId('overflow-action-request_reset').click();
    await expect(page.getByTestId('f360-reset-modal')).toBeVisible();

    const confirmBtn = page.getByTestId('f360-reset-confirm-btn');
    await expect(confirmBtn).toBeDisabled();

    await page.getByTestId('f360-reset-input').fill('RESET');
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    await expect(page.getByTestId('f360-reset-modal')).toHaveCount(0);
    await expect(page.getByTestId('vaults-zero-seed-empty')).toBeVisible();
  });

  test('mobile 9:16 (390x844) keeps zero horizontal overflow and clears .mobile-bottom-nav without FAB overlap', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/finanzas-360');
    await expect(page.locator('app-f360-command-header')).toBeVisible();

    for (const theme of THEMES) {
      await page.evaluate((t) => {
        document.documentElement.setAttribute('data-theme', t);
      }, theme);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `Mobile overflow in theme ${theme}`).toBeLessThanOrEqual(1);
    }

    const fab = page.getByTestId('f360-mobile-fab');
    await expect(fab).toBeVisible();
    const fabBox = await fab.boundingBox();
    expect(fabBox).not.toBeNull();
    expect(fabBox!.width).toBeGreaterThanOrEqual(44);
    expect(fabBox!.height).toBeGreaterThanOrEqual(44);

    const bottomNav = page.locator('.mobile-bottom-nav');
    if (await bottomNav.isVisible()) {
      const navBox = await bottomNav.boundingBox();
      expect(navBox).not.toBeNull();
      expect(fabBox!.y + fabBox!.height).toBeLessThan(navBox!.y);
    }

    await fab.click();
    await expect(page.getByRole('menuitem', { name: /Gasto rápido/i })).toBeVisible();
  });
});
