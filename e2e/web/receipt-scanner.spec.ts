import { test, expect } from '@playwright/test';

if (process.env['PW_CHANNEL']) {
  test.use({ channel: process.env['PW_CHANNEL'] as 'chrome' | 'msedge' });
}

const THEMES = ['dark', 'apple-dark', 'light', 'neon-pink'] as const;
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

test.describe('Comprobantes & OCR Forense — 4 Themes, Split-View, Ctrl+K & Mobile 9:16', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('p2p.receipt_scanner.session.v1');
      localStorage.removeItem('p2p.operations');
    });
  });

  test('desktop 1440x900 renders modular Liquid Glass cockpit across 4 themes with zero overflow, zero emojis and zero console errors', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('Failed to fetch') && !text.includes('ERR_CONNECTION_REFUSED')) {
          errors.push(`console.error: ${text}`);
        }
      }
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/receipts');

    await expect(page.locator('app-ocr-command-header')).toBeVisible();
    await expect(page.locator('app-ocr-kpi-strip')).toBeVisible();
    await expect(page.locator('app-ocr-ingestion-bento')).toBeVisible();

    const bodyText = (await page.locator('app-receipt-scanner').innerText()) ?? '';
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

    expect(errors).toEqual([]);
  });

  test('ingests SMS receipt text, opens Split-View Forensic Inspector, edits inline with live recalculation, and handles scoped Ctrl+K', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/receipts');
    await expect(page.locator('app-ocr-ingestion-bento')).toBeVisible();

    // 1. Ingest SMS text
    const smsBox = page.locator('app-ocr-ingestion-bento textarea').first();
    await smsBox.fill(
      'Banesco Pago Movil recibido Bs 2450,00 Ref 88442211 Pagador: Maria Alejandra Rodriguez CI V-21334556',
    );
    await page
      .locator('app-ocr-ingestion-bento button', { hasText: /Procesar|Analizar/i })
      .first()
      .click();

    await expect(page.locator('.ocr-table tbody tr').first()).toBeVisible();
    await expect(page.locator('.ocr-table tbody tr').first()).toContainText('88442211');

    // 2. Open Split-View Inspector & edit inline
    await page
      .locator('.ocr-table tbody tr')
      .first()
      .getByRole('button', { name: 'Inspeccionar' })
      .click();
    await expect(page.locator('app-ocr-forensic-inspector')).toBeVisible();

    const refInput = page.locator('app-ocr-forensic-inspector input[name="reference"]');
    await refInput.fill('99112233');
    await expect(page.locator('.ocr-table tbody tr').first()).toContainText('99112233');

    // Close inspector on Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('app-ocr-forensic-inspector')).toHaveCount(0);

    // 3. Scoped Ctrl+K overrides global palette
    await page.keyboard.press('Control+k');
    await expect(page.locator('.ocr-palette-overlay')).toBeVisible();
    await expect(page.locator('.palette-backdrop')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(page.locator('.ocr-palette-overlay')).toHaveCount(0);
  });

  test('mobile 390x844 renders zero horizontal overflow across 4 themes and clears .mobile-bottom-nav with FAB', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/receipts');
    await expect(page.locator('app-ocr-command-header')).toBeVisible();

    const fab = page.locator('.ocr-mobile-fab');
    await expect(fab).toBeVisible();

    for (const theme of THEMES) {
      await page.evaluate((t) => {
        document.documentElement.setAttribute('data-theme', t);
      }, theme);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `Mobile overflow in theme ${theme}`).toBeLessThanOrEqual(1);
    }

    const bottomNav = page.locator('.mobile-bottom-nav');
    if ((await bottomNav.count()) > 0 && (await bottomNav.isVisible())) {
      const fabBox = await fab.boundingBox();
      const navBox = await bottomNav.boundingBox();
      expect(fabBox).not.toBeNull();
      expect(navBox).not.toBeNull();
      if (fabBox && navBox) {
        expect(fabBox.y + fabBox.height).toBeLessThanOrEqual(navBox.y);
      }
    }
  });
});
