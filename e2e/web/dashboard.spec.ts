import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('p2p.operations');
    localStorage.removeItem('p2p.sessions');
    localStorage.removeItem('p2p.risk-config');
  });
});

async function goToDashboard(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.locator('a[routerlink="/dashboard"]').click();
}

test('page loads and shows Centro de Control header', async ({ page }) => {
  await goToDashboard(page);
  await expect(page.locator('h2')).toContainText('Centro de Control');
});

test('KPI tiles are visible with today\'s performance', async ({ page }) => {
  await goToDashboard(page);

  const out = page.locator('.section-group .out').first();
  await expect(out.locator('dt', { hasText: 'Ganancia Neta (VES)' })).toBeVisible();
  await expect(out.locator('dt', { hasText: 'Ganancia Neta (USDT)' })).toBeVisible();
  await expect(out.locator('dt', { hasText: 'Operaciones Hoy' })).toBeVisible();
  await expect(out.locator('dt', { hasText: 'Meta Diaria' })).toBeVisible();
});

test('risk verdict card is displayed', async ({ page }) => {
  await goToDashboard(page);

  const verdict = page.locator('.dashboard-verdict');
  await expect(verdict).toBeVisible();
  await expect(verdict.locator('strong')).toContainText(/PERMITIR|DENEGAR|PAUSAR/);
});

test('7-day activity chart section exists', async ({ page }) => {
  await goToDashboard(page);

  await expect(page.locator('.section-eyebrow', { hasText: 'Actividad Últimos 7 Días' })).toBeVisible();
  const chart = page.locator('.dashboard-chart');
  await expect(chart).toBeVisible();
  // The chart should have 7 columns (one per day of the week).
  const cols = chart.locator('.dashboard-chart-col');
  await expect(cols).toHaveCount(7);
});

test('session management section shows start button when no active session', async ({ page }) => {
  await goToDashboard(page);

  await expect(page.getByText('Sin Jornada Activa')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar Jornada' })).toBeVisible();
});

test('last 3 operations section exists', async ({ page }) => {
  await goToDashboard(page);

  await expect(page.locator('.section-eyebrow', { hasText: 'Últimas Operaciones' })).toBeVisible();
  // With no ops, the empty state message appears.
  await expect(page.getByText('No hay operaciones registradas aún')).toBeVisible();
});

test('last 3 operations table renders rows when operations exist', async ({ page }) => {
  await page.goto('/');
  const ops = [];
  for (let i = 1; i <= 4; i++) {
    ops.push({
      id: `e2e-dash-${i}`,
      type: i % 2 === 0 ? 'sell' : 'buy',
      pair: 'USDT',
      vesAmount: 1000 * i,
      usdtAmount: 25 * i,
      price: 40,
      fee: 0,
      hasError: false,
      merchantNote: `dash row ${i}`,
      timestamp: new Date(Date.now() - i * 3600_000).toISOString(),
    });
  }
  await page.evaluate((o) => {
    localStorage.setItem('p2p.operations', JSON.stringify(o));
  }, ops);
  await page.reload();

  await page.locator('a[routerlink="/dashboard"]').click();

  // Only the latest 3 operations should be shown (4 exist in storage).
  const table = page.locator('.corporate-table[aria-label="Últimas 3 operaciones"]');
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(3);
});

test('dashboard links navigate to risk rules', async ({ page }) => {
  await goToDashboard(page);

  await page.locator('.dashboard-link', { hasText: 'Configurar reglas' }).click();
  await expect(page.locator('h2')).toContainText('Reglas de Riesgo');
});

test('dashboard links navigate to statistics', async ({ page }) => {
  await goToDashboard(page);

  await page.locator('.dashboard-link', { hasText: 'Ver estadísticas' }).click();
  await expect(page.locator('h1')).toContainText('Estadísticas');
});

test('dashboard links navigate to operation log', async ({ page }) => {
  await goToDashboard(page);

  // Empty state link points to the operation log.
  await page.locator('a[routerlink="/log"]', { hasText: 'Registrar primera operación' }).click();
  await expect(page.locator('h2')).toContainText('Registro de Operaciones');
});

test('lifetime stats section shows total operations, streak, and exposure', async ({ page }) => {
  await goToDashboard(page);

  const section = page.locator('.dashboard-stats-mini');
  await expect(section).toBeVisible();
  await expect(section.locator('.stat-label', { hasText: 'Total Operaciones' })).toBeVisible();
  await expect(section.locator('.stat-label', { hasText: 'Racha Cero Errores' })).toBeVisible();
  await expect(section.locator('.stat-label', { hasText: 'Exposición Neta' })).toBeVisible();
});

test('treasury section is visible with Liquidez Total label', async ({ page }) => {
  await goToDashboard(page);

  await expect(page.getByText('Tesorería & Cupos Bancarios')).toBeVisible();
  await expect(page.getByText('Liquidez Total Estimada')).toBeVisible();
});
