import { test, expect } from '@playwright/test';

// Web-shell happy path (E2): open spread-monitor, enter buy 800 / sell 820 /
// 25 USDT, assert the displayed gain equals +500 Bs.
test('spread-monitor shows +500 Bs for buy 800 / sell 820 / 25 USDT', async ({ page }) => {
  await page.goto('/');
  // Angular RouterLink renders anchors without an `href` attribute, so target
  // the directive attribute directly rather than relying on the link role.
  await page.locator('a[routerlink="/spread"]').click();

  // Labels match the Spanish (es-VE) UI. The gain value goes through the
  // `| ves` pipe (Intl.NumberFormat('es-VE')) → decimal comma: "500,00 Bs".
  await page.getByLabel('Precio de compra (VES/USDT)').fill('800');
  await page.getByLabel('Precio de venta (VES/USDT)').fill('820');
  await page.getByLabel('Monto').fill('25');
  // Defaults: unit = USDT, commission = 0 → gain = (sell - buy) * amount = 20 * 25 = 500 Bs.

  const gain = page
    .locator('div.out div', { hasText: 'Ganancia de spread' })
    .locator('dd');
  await expect(gain).toHaveText('500,00 Bs');
});
