import { test, expect } from '@playwright/test';

if (process.env['PW_CHANNEL']) {
  test.use({ channel: process.env['PW_CHANNEL'] });
}

test.describe('Copiloto Táctico (/copilot) — 2-Mode Workbench & Governance Dashboard E2E', () => {
  test('renders Zero-Seed 2-mode Workbench and Governance Dashboard with 0px horizontal overflow on Desktop & Mobile', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/copilot', { waitUntil: 'networkidle' });

    await expect(page.locator('h2', { hasText: 'Copiloto Táctico' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Workbench' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dashboard IA' })).toBeVisible();

    // Verify Zero-Seed: no fake client personas or fake 64.8/78.4 rates
    await expect(page.locator('body')).not.toContainText('Carlos Eduardo Mendoza');
    await expect(page.locator('body')).toContainText('SIN DATO');

    // Switch to Mode 2: AI Governance Dashboard
    await page.getByRole('button', { name: 'Dashboard IA' }).click();
    await expect(page.getByText('COLA DE PLANES TÁCTICOS Y AUDITORÍA HITL')).toBeVisible();
    await expect(page.getByText('GOBERNANZA DE MEMORIA (CUARENTENA ENGRAM)')).toBeVisible();

    const desktopOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(desktopOverflow).toBeLessThanOrEqual(0);

    // Switch back to Workbench and verify Mobile 390x844
    await page.getByRole('button', { name: 'Workbench' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('h2', { hasText: 'Copiloto Táctico' })).toBeVisible();
    const mobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(mobileOverflow).toBeLessThanOrEqual(0);
  });
});
