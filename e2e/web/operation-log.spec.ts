import { test, expect } from '@playwright/test';

// The ledger persists under a single localStorage key. Wipe it before every test so
// each case starts from a clean slate regardless of what earlier runs left behind.
// Runs in the page's own origin before app code, so the app reads an empty store.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('p2p.operations'));
});

// Navigate to the operations ledger the same way the app shell does: the Angular
// RouterLink renders anchors WITHOUT an `href`, so target the directive attribute.
async function openLedger(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.locator('a[routerlink="/log"][routerlinkactive]').click();
}

// Helper that fills the CRUD form and submits. Labels match the Spanish (es-VE) UI;
// the note doubles as a unique row anchor for later locators.
async function addOperation(
  page: import('@playwright/test').Page,
  opts: { ves: string; usdt: string; price: string; note: string },
): Promise<void> {
  await page.getByLabel('Monto en VES').fill(opts.ves);
  await page.getByLabel('Monto en USDT').fill(opts.usdt);
  await page.getByLabel('Precio Pactado (VES/USDT)').fill(opts.price);
  await page.getByLabel('Notas del Comercio / Referencia').fill(opts.note);
  await page.getByRole('button', { name: 'Registrar operación' }).click();
}

test('add operation shows a formatted row and updates the ledger summary', async ({ page }) => {
  await openLedger(page);

  await addOperation(page, { ves: '1000', usdt: '25', price: '40', note: 'compra e2e' });

  // Values pass through the `| ves`, `| usdt` and `| num` pipes (Intl.NumberFormat('es-VE'))
  // → decimal comma: "1.000,00 Bs", "25,00 USDT", "40,00". Anchor the row on the note.
  const row = page.locator('tr', { hasText: 'compra e2e' });
  await expect(row).toContainText('compra');
  await expect(row).toContainText('USDT');
  await expect(row).toContainText('1.000,00 Bs');
  await expect(row).toContainText('25,00 USDT');
  await expect(row).toContainText('40,00');

  // The summary block counts operations and reflects the es-VE formatted money. A lone buy
  // of 1.000 VES with no matching sell yields PnL = sell(0) − buy(1000) − fees(0) = −1000.
  const summary = page.locator('div.out');
  await expect(summary.locator('dd').first()).toHaveText('1');
  await expect(summary.locator('dd').nth(1)).toHaveText('-1.000,00 Bs');
});

test('export CSV downloads a file with the es-VE header and the added row', async ({ page }) => {
  await openLedger(page);
  await addOperation(page, { ves: '1000', usdt: '25', price: '40', note: 'csv e2e' });

  // downloadCsv() builds a Blob → object URL → anchor click, which Playwright surfaces
  // as a download event.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exportar CSV (Excel)' }).click(),
  ]);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const csv = Buffer.concat(chunks).toString('utf8');

  // buildOperationsCsv() emits a UTF-8 BOM then a `;`-delimited es-VE header.
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv).toContain(
    'Fecha/Hora;Tipo;Par;Monto VES;Monto USDT;Precio;Comisiones;Sin errores;Comercio;Notas',
  );
  expect(csv).toContain(';compra;USDT;1000;25;40;0;no;csv e2e;');
  expect(download.suggestedFilename()).toMatch(/^p2p-operaciones-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('backup / import round-trip restores a deleted operation', async ({ page }) => {
  await openLedger(page);
  await addOperation(page, { ves: '2500', usdt: '60', price: '41.67', note: 'backup e2e' });

  const row = page.locator('tr', { hasText: 'backup e2e' });
  await expect(row).toContainText('backup e2e');

  // Download the JSON backup so we can re-import the exact same payload.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exportar respaldo JSON' }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const backupJson = Buffer.concat(chunks).toString('utf8');
  expect(download.suggestedFilename()).toMatch(/^p2p-operaciones-\d{4}-\d{2}-\d{2}\.json$/);

  // Delete the row, then confirm the confirmation modal, then assert it is gone.
  await row.getByRole('button', { name: 'Eliminar registro' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.locator('tr', { hasText: 'backup e2e' })).toHaveCount(0);

  // Re-import via the hidden file input (setInputFiles works on hidden inputs). The
  // component reads the file with FileReader, validates, and STAGES it — then shows a
  // confirmation modal before replacing the ledger.
  await page.locator('input[type="file"]').setInputFiles({
    name: 'p2p-operaciones.json',
    mimeType: 'application/json',
    buffer: Buffer.from(backupJson, 'utf8'),
  });

  await page.getByRole('dialog').getByRole('button', { name: 'Restaurar e Importar' }).click();

  const restored = page.locator('tr', { hasText: 'backup e2e' });
  await expect(restored).toContainText('2.500,00 Bs');
  await expect(restored).toContainText('60,00 USDT');
});
