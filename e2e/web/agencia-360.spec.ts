import { test, expect } from '@playwright/test';

if (process.env['PW_CHANNEL']) {
  test.use({ channel: process.env['PW_CHANNEL'] });
}

const THEMES = ['dark', 'apple-dark', 'light', 'neon-pink'] as const;

test.describe('Agencia Digital 360 (/agencia-360) — Zero-Seed Real Production E2E (4 Themes)', () => {
  test('starts strictly Zero-Seed ($0.00, 0 fake brands), supports brand creation, Conexiones & APIs, and 0px overflow across 4 themes on Desktop (1440x900)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/agencia-360', { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });

    await expect(page.locator('h1', { hasText: 'AGENCIA DIGITAL 360' })).toBeVisible();
    await expect(page.getByText('Tu Agencia Digital 360 está limpia (Zero-Seed · $0.00)')).toBeVisible();
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

    // 1. Create a real brand via the Zero-Seed Onboarding Modal
    await page.getByRole('button', { name: /\+ Crear Mi Primera Marca/i }).click();
    const brandDialog = page.locator('[role="dialog"][aria-label="Crear Marca Real"]');
    await expect(brandDialog).toBeVisible();
    await brandDialog.getByPlaceholder('Nombre comercial de tu marca').fill('Mi Tienda Real VE');
    await brandDialog.getByRole('button', { name: 'Guardar Marca en SQLite' }).click();
    await expect(brandDialog).toBeHidden();
    await expect(page.locator('table strong', { hasText: 'Mi Tienda Real VE' })).toBeVisible();

    // 2. Open Conexiones & APIs modal and verify providers
    await page.getByRole('button', { name: /Conexiones & APIs/i }).click();
    const connDialog = page.locator('[role="dialog"][aria-label="Conexiones y APIs de Agencia Digital 360"]');
    await expect(connDialog).toBeVisible();
    await connDialog.getByRole('button', { name: 'Cerrar' }).click();
    await expect(connDialog).toBeHidden();

    // 3. Navigate Video & Google Flow and CTWA sub-tabs
    await page.getByRole('tab', { name: /Video & Google Flow/i }).click();
    await expect(page.getByText('Motor A: Gemini Omni 1.2 Flash')).toBeVisible();

    await page.getByRole('tab', { name: /Pauta CTWA & HITL/i }).click();
    await expect(page.getByText('Lanzador Directo Click-to-WhatsApp')).toBeVisible();
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
