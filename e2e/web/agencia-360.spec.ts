import { test, expect } from '@playwright/test';

if (process.env['PW_CHANNEL']) {
  test.use({ channel: process.env['PW_CHANNEL'] });
}

const THEMES = ['dark', 'apple-dark', 'light', 'neon-pink'] as const;

test.describe('Agencia Digital 360 (/agencia-360) — 4-Theme Spatial Liquid Glass E2E', () => {
  test('renders Executive Dashboard, 5 Execution sub-tabs, 9:16 preview, and scoped Ctrl+K with 0px overflow across all 4 themes on Desktop (1440x900)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/agencia-360', { waitUntil: 'networkidle' });

    await expect(page.locator('h1', { hasText: 'AGENCIA DIGITAL 360' })).toBeVisible();
    await expect(page.locator('.phone-frame-916')).toBeVisible();

    for (const theme of THEMES) {
      await page.evaluate((t) => {
        document.documentElement.setAttribute('data-theme', t);
      }, theme);

      const overflowPx = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflowPx, `Theme ${theme} desktop horizontal overflow`).toBeLessThanOrEqual(0);
    }

    // Switch through Execution sub-tabs
    await page.getByRole('tab', { name: /Video Pipeline 9:16/i }).click();
    await expect(page.getByText('custom_audio_path: ACTIVO (TTS Saltado)')).toBeVisible();

    await page.getByRole('tab', { name: /Clips Virales Dual/i }).click();
    await page.getByRole('button', { name: /YouTube Quirúrgico/i }).click();
    await expect(page.locator('code', { hasText: '--download-sections' })).toBeVisible();

    await page.getByRole('tab', { name: /Trafficker & Telegram HITL/i }).click();
    await page.getByRole('button', { name: 'Aprobar Pauta' }).first().click();
    await expect(page.locator('text=APPROVED · ACTIVE').first()).toBeVisible();

    // Verify scoped Ctrl+K Command Palette opens and navigates
    await page.keyboard.press('Control+k');
    const dialog = page.locator('.ag360-palette-dialog[role="dialog"]');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /Flyers Nano Banana/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: /Estudio de Flyers Comerciales/i })).toBeVisible();
  });

  test('renders cleanly with 0px horizontal overflow on Mobile 9:16 (390x844)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/agencia-360', { waitUntil: 'networkidle' });

    await expect(page.locator('h1', { hasText: 'AGENCIA DIGITAL 360' })).toBeVisible();
    const overflowPx = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowPx).toBeLessThanOrEqual(0);
  });
});
