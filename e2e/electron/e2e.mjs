import * as pw from 'playwright';
import path from 'node:path';
import { strict as assert } from 'node:assert';

// Playwright exposes the Electron launcher as `_electron` (underscore-prefixed).
const electron = pw._electron;

// Electron-shell happy path (E2): launch the packaged-ish Electron app
// (electron/dist/main/index.js) and verify the same spread-monitor gain.
// No separate browser download required — Playwright drives Electron's own runtime.
const mainPath = path.join(process.cwd(), 'electron/dist/main/index.js');

const electronApp = await electron.launch({ args: [mainPath] });
const page = await electronApp.firstWindow();
await page.waitForLoadState('domcontentloaded');

// Angular RouterLink renders anchors without an `href` attribute, so target
// the directive attribute directly rather than relying on the link role.
await page.locator('a[routerlink="/spread"]').click();
await page.getByLabel('Precio de compra (VES/USDT)').fill('800');
await page.getByLabel('Precio de venta (VES/USDT)').fill('820');
await page.getByLabel('Monto').fill('25');

const gain = page.locator('dl.out div', { hasText: 'Ganancia de spread' }).locator('dd');
await gain.waitFor();
const text = (await gain.textContent())?.trim();
assert.strictEqual(text, '500,00 Bs', `Expected gain 500,00 Bs, got "${text}"`);

console.log('ELECTRON E2E PASS: spread gain =', text);
await electronApp.close();
