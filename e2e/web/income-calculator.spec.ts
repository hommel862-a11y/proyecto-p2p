import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('p2p.operations');
  });
});

async function goToIncomeCalculator(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.locator('a[routerlink="/income"]').click();
}

test('page loads with default values and header', async ({ page }) => {
  await goToIncomeCalculator(page);
  await expect(page.locator('h2')).toContainText('Calculadora de Ingresos');
  // Default values: targetUsd=20, aprPct=10, daysPerYear=365, rate=800
  await expect(page.getByLabel('Meta diaria (USD)')).toHaveValue('20');
  await expect(page.getByLabel('Tasa anual (APR) (%)')).toHaveValue('10');
});

test('result section shows capital and annual income with default inputs', async ({ page }) => {
  await goToIncomeCalculator(page);

  const result = page.locator('.section-group .out').first();
  await expect(result.locator('dt', { hasText: 'Ingreso anual' })).toBeVisible();
  await expect(result.locator('dt', { hasText: 'Capital requerido' })).toBeVisible();
  await expect(result.locator('dt', { hasText: 'Capital en Bs' })).toBeVisible();
  // With defaults: annual = 20 * 365 = 7300, capital = 7300 / 0.10 = 73000
  await expect(
    result.locator('dd', { hasText: 'Capital requerido' }).locator('..').locator('dd').last(),
  ).toContainText('USDT');
});

test('changing target USD updates calculated capital', async ({ page }) => {
  await goToIncomeCalculator(page);

  await page.getByLabel('Meta diaria (USD)').fill('50');
  const capitalDd = page
    .locator('dt', { hasText: 'Capital requerido' })
    .locator('..')
    .locator('dd');
  // With target=50, apr=10%, days=365: capital = (50*365)/0.10 = 182500
  await expect(capitalDd).toContainText('182.500');
});

test('changing APR updates calculated capital', async ({ page }) => {
  await goToIncomeCalculator(page);

  await page.getByLabel('Tasa anual (APR) (%)').fill('20');
  const capitalDd = page
    .locator('dt', { hasText: 'Capital requerido' })
    .locator('..')
    .locator('dd');
  // With target=20, apr=20%, days=365: capital = (20*365)/0.20 = 36500
  await expect(capitalDd).toContainText('36.500');
});

test('VES conversion shows non-zero values', async ({ page }) => {
  await goToIncomeCalculator(page);

  const capitalBs = page.locator('dt', { hasText: 'Capital en Bs' }).locator('..').locator('dd');
  // With rate=800 and capital≈73000: Bs ≈ 58,400,000
  await expect(capitalBs).toContainText('Bs');
  await expect(capitalBs).not.toHaveText('0,00 Bs');
});

test('comparison table renders with rows for each target and columns for each APR band', async ({
  page,
}) => {
  await goToIncomeCalculator(page);

  await expect(page.locator('.section-eyebrow', { hasText: 'Tabla Comparativa' })).toBeVisible();
  const table = page.locator('.corporate-table');
  // Header row should contain 8%, 10%, 15% columns
  const headers = table.locator('thead th');
  await expect(headers).toHaveCount(4); // Meta/día + 3 bands
  await expect(headers.nth(1)).toContainText('8%');
  await expect(headers.nth(2)).toContainText('10%');
  await expect(headers.nth(3)).toContainText('15%');
  // 3 target rows (1, 5, 20 USDT)
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(3);
});

test('zero target shows error message instead of result', async ({ page }) => {
  await goToIncomeCalculator(page);

  await page.getByLabel('Meta diaria (USD)').fill('0');
  await expect(page.getByRole('alert')).toContainText('Ingresa una meta diaria y un APR positivos');
});

test('days per year input is present and editable', async ({ page }) => {
  await goToIncomeCalculator(page);

  const daysInput = page.getByLabel('Días / año');
  await expect(daysInput).toBeVisible();
  await expect(daysInput).toHaveValue('365');
  await daysInput.fill('360');
  await expect(daysInput).toHaveValue('360');
});

test('VES/USDT rate input is present', async ({ page }) => {
  await goToIncomeCalculator(page);

  const rateInput = page.getByLabel('Tasa VES/USDT (opcional)');
  await expect(rateInput).toBeVisible();
  await expect(rateInput).toHaveValue('800');
});
