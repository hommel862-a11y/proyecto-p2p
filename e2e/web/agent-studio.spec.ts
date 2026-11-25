import { test, expect } from '@playwright/test';

test.describe('Agents Platform (/agents) — 3-View Overhaul', () => {
  test('renders Fleet Dashboard, switches to Studio & Sandbox and Forensic Ledger', async ({ page }) => {
    await page.goto('/agents');

    await expect(page.getByRole('heading', { name: /Plataforma de Agentes/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Flota & Daemons/i })).toHaveAttribute('aria-selected', 'true');

    // Switch to Studio & Sandbox
    await page.getByRole('tab', { name: /Studio & Sandbox/i }).click();
    await expect(page.getByText('Live Dry-Run Sandbox')).toBeVisible();
    await expect(page.getByText('READ-ONLY ENFORCED')).toBeVisible();

    // Switch to Forensic Ledger
    await page.getByRole('tab', { name: /Historial Forense/i }).click();
    await expect(page.getByRole('button', { name: /Exportar CSV/i })).toBeVisible();
  });
});
