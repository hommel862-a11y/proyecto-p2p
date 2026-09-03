import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('p2p.risk-config');
    localStorage.removeItem('p2p.operations');
  });
});

async function goToRiskRules(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.locator('a[routerlink="/risk"]').click();
}

test('page loads with Reglas de Riesgo header', async ({ page }) => {
  await goToRiskRules(page);
  await expect(page.locator('h2')).toContainText('Reglas de Riesgo');
});

test('6 configurable rule inputs are visible with default values', async ({ page }) => {
  await goToRiskRules(page);

  // Spread mínimo (VES/USDT) — default 15
  await expect(page.locator('label', { hasText: 'Spread mínimo' }).locator('input[type="number"]')).toHaveValue('15');

  // Máx. operaciones concurrentes — default 3
  await expect(page.getByLabel('Máx. operaciones concurrentes')).toHaveValue('3');

  // Riesgo máx. por operación — default 1
  await expect(page.getByLabel('Riesgo máx. por operación (%)')).toHaveValue('1');

  // Tope de pérdida diaria — default 4
  await expect(page.getByLabel('Tope de pérdida diaria (%)')).toHaveValue('4');

  // Máx. errores consecutivos — default 3
  await expect(page.getByLabel('Máx. errores consecutivos')).toHaveValue('3');

  // API status — default ok
  await expect(page.getByLabel('Estado de API')).toHaveValue('ok');
});

test('pair selector toggle between USDT and EUR', async ({ page }) => {
  await goToRiskRules(page);

  const pairSelect = page.getByLabel('Par de referencia');
  await expect(pairSelect).toHaveValue('USDT');

  // The spread label changes based on the selected pair.
  await expect(page.locator('label', { hasText: 'Spread mínimo (VES/USDT)' })).toBeVisible();

  await pairSelect.selectOption('EUR');
  await expect(page.locator('label', { hasText: 'Spread mínimo (VES/EUR)' })).toBeVisible();
});

test('changing max concurrent ops and saving persists the change', async ({ page }) => {
  await goToRiskRules(page);

  await page.getByLabel('Máx. operaciones concurrentes').fill('5');
  await page.getByRole('button', { name: 'Guardar reglas' }).click();

  // Reload the page and verify the saved value persists.
  await page.reload();
  await page.locator('a[routerlink="/risk"]').click();
  await expect(page.getByLabel('Máx. operaciones concurrentes')).toHaveValue('5');
});

test('live verdict display shows PERMITIR/DENEGAR/PAUSAR', async ({ page }) => {
  await goToRiskRules(page);

  const verdict = page.locator('.verdict-card .verdict');
  await expect(verdict).toBeVisible();
  // With default sample state (spread=20 > min=15, openOps=1 < 3, etc.), verdict should be ALLOW.
  await expect(verdict).toContainText(/PERMITIR|DENEGAR|PAUSAR/);
  await expect(verdict).toContainText(/Veredicto del motor/);
});

test('reset button restores default values', async ({ page }) => {
  await goToRiskRules(page);

  // Change max concurrent ops to a non-default value.
  await page.getByLabel('Máx. operaciones concurrentes').fill('10');
  await page.getByRole('button', { name: 'Guardar reglas' }).click();

  // Now reset.
  await page.getByRole('button', { name: 'Restablecer' }).click();

  // Verify defaults are restored.
  await expect(page.getByLabel('Máx. operaciones concurrentes')).toHaveValue('3');
  await expect(page.getByLabel('Riesgo máx. por operación (%)')).toHaveValue('1');
  await expect(page.getByLabel('Tope de pérdida diaria (%)')).toHaveValue('4');
  await expect(page.getByLabel('Máx. errores consecutivos')).toHaveValue('3');
});

test('verdict label shows PERMITIR when sample state is within limits', async ({ page }) => {
  await goToRiskRules(page);

  // With default config: minSpread=15, sample state has currentSpread=20
  // → spread >= min, so ALLOW → PERMITIR
  const verdict = page.locator('.verdict-card .verdict');
  await expect(verdict).toContainText('PERMITIR');
});

test('api status dropdown can be toggled', async ({ page }) => {
  await goToRiskRules(page);

  const apiSelect = page.getByLabel('Estado de API');
  await expect(apiSelect).toHaveValue('ok');
  await apiSelect.selectOption('down');
  await expect(apiSelect).toHaveValue('down');
});
