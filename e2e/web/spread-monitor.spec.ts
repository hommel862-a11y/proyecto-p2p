import { test, expect } from '@playwright/test';

// Web-shell happy path (E2): open spread-monitor, enter buy 800 / sell 820 /
// 25 USDT, assert the displayed gain equals +500 Bs.
test('spread-monitor shows +500 Bs for buy 800 / sell 820 / 25 USDT', async ({ page }) => {
  await page.goto('/');
  // Angular RouterLink renders anchors without an `href` attribute, so target
  // the directive attribute directly rather than relying on the link role.
  await page.locator('a[routerlink="/spread"]').click();

  await page.getByLabel('Buy price (VES/USDT)').fill('800');
  await page.getByLabel('Sell price (VES/USDT)').fill('820');
  await page.getByLabel('Amount').fill('25');
  // Defaults: unit = USDT, commission = 0 → gain = (sell - buy) * amount = 20 * 25 = 500 Bs.

  const gain = page.locator('dd', { hasText: 'Bs' });
  await expect(gain).toHaveText('500 Bs');
});
