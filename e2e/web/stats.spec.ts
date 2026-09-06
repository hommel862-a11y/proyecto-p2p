import { test, expect } from '@playwright/test';

const OPS_KEY = 'p2p.operations';
const SESSIONS_KEY = 'p2p.sessions';

const SAMPLE_OP = {
  id: 'e2e-stat-001',
  type: 'buy',
  pair: 'USDT',
  vesAmount: 5000,
  usdtAmount: 12.5,
  price: 400,
  fees: 0,
  errorFree: true,
  merchantNote: 'e2e stats test',
  timestamp: new Date().toISOString(),
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem(OPS_KEY);
    localStorage.removeItem(SESSIONS_KEY);
    localStorage.removeItem('p2p.risk-config');
  });
});

async function goToStats(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.locator('a[routerlink="/stats"][routerlinkactive]').click();
}

test('page loads with Estadísticas header', async ({ page }) => {
  await goToStats(page);
  await expect(page.locator('h1')).toContainText('Estadísticas');
});

test('period selector buttons are visible (day/month/quarter/session)', async ({ page }) => {
  await goToStats(page);

  await expect(page.getByRole('button', { name: 'Día' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trimestre' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sesiones' })).toBeVisible();
});

test('default period is Día and is visually active', async ({ page }) => {
  await goToStats(page);

  const dayBtn = page.getByRole('button', { name: 'Día' });
  await expect(dayBtn).toHaveClass(/active/);
});

test('switching to Mes period updates the display', async ({ page }) => {
  await goToStats(page);

  await page.getByRole('button', { name: 'Mes' }).click();
  await expect(page.getByRole('button', { name: 'Mes' })).toHaveClass(/active/);
  await expect(page.getByRole('button', { name: 'Día' })).not.toHaveClass(/active/);
});

test('switching to Sesiones shows session history section', async ({ page }) => {
  await goToStats(page);

  await page.getByRole('button', { name: 'Sesiones' }).click();
  await expect(page.locator('.section-eyebrow', { hasText: 'Historial de Jornadas Operativas' })).toBeVisible();
});

test('pair filter dropdown is present with All/USDT/VES options', async ({ page }) => {
  await goToStats(page);

  const pairSelect = page.locator('label.inline select');
  await expect(pairSelect).toBeVisible();
  await expect(pairSelect).toHaveValue('all');
  // Check available options.
  const options = pairSelect.locator('option');
  await expect(options).toHaveCount(3);
  await expect(options.nth(0)).toHaveText('Todos');
  await expect(options.nth(1)).toHaveValue('USDT');
  await expect(options.nth(2)).toHaveValue('EUR');
});

test('empty state shows message when no operations exist', async ({ page }) => {
  await goToStats(page);

  await expect(page.getByText('Aún no hay operaciones registradas')).toBeVisible();
});

test('empty session state shows message when no sessions exist', async ({ page }) => {
  await goToStats(page);

  await page.getByRole('button', { name: 'Sesiones' }).click();
  await expect(page.getByText('No se han registrado sesiones de trading aún')).toBeVisible();
});

test('after adding an operation via localStorage, stats update', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((ops) => {
    localStorage.setItem('p2p.operations', JSON.stringify(ops));
  }, [SAMPLE_OP]);
  await page.reload();

  await page.locator('a[routerlink="/stats"]').click();

  // Totals should show 1 operation.
  const tiles = page.locator('.stat-grid .stat-tile');
  await expect(tiles.nth(0).locator('.stat-value')).toContainText('1');
  // PnL for a buy of 5000 VES with no sell = −5000
  await expect(tiles.nth(1).locator('.stat-value')).toContainText('-5.000');
  // Volume
  await expect(tiles.nth(2).locator('.stat-value')).toContainText('USDT');
});

test('detail table appears after adding operations', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((ops) => {
    localStorage.setItem('p2p.operations', JSON.stringify(ops));
  }, [SAMPLE_OP]);
  await page.reload();

  await page.locator('a[routerlink="/stats"]').click();

  await expect(page.locator('.section-eyebrow', { hasText: 'Detalle por Período' })).toBeVisible();
  const table = page.locator('.corporate-table');
  await expect(table.locator('tbody tr').first()).toBeVisible();
});

test('compliance report button is visible', async ({ page }) => {
  await goToStats(page);

  await expect(page.getByRole('button', { name: 'Informe de Cumplimiento' })).toBeVisible();
});

test('filtering by USDT pair after adding mixed operations', async ({ page }) => {
  await page.goto('/');
  const ops = [
    { ...SAMPLE_OP, id: 'e2e-1', pair: 'USDT', vesAmount: 5000 },
    { ...SAMPLE_OP, id: 'e2e-2', pair: 'EUR', vesAmount: 3000 },
  ];
  await page.evaluate((o) => {
    localStorage.setItem('p2p.operations', JSON.stringify(o));
  }, ops);
  await page.reload();

  await page.locator('a[routerlink="/stats"]').click();

  // Initially shows total operations = 2.
  await expect(page.locator('.stat-grid .stat-tile').nth(0).locator('.stat-value')).toContainText('2');

  // Filter to USDT only → 1 operation.
  await page.locator('label.inline select').selectOption('USDT');
  await expect(page.locator('.stat-grid .stat-tile').nth(0).locator('.stat-value')).toContainText('1');
});
