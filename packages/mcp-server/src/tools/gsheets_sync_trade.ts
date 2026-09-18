import { GsheetsSyncTradeInputSchema, type GsheetsSyncTradeInput } from '../schemas/index.js';
import { googleAuthAdapter } from '../adapters/google-auth.adapter.js';

export const gsheetsSyncTradeTool = {
  name: 'gsheets_sync_trade',
  description:
    'Sincroniza una operación del Ledger en tiempo real en una hoja de cálculo maestra de Google Sheets para control contable y de flujo de caja.',
  inputSchema: GsheetsSyncTradeInputSchema,
  execute: async (input: GsheetsSyncTradeInput) => {
    const t = input.trade;
    const spreadsheetId = input.spreadsheetId || '1p2p_Ledger_Master_Spreadsheet';
    const sheetName = input.sheetName || 'Operaciones P2P';

    const rowValues: (string | number | null)[] = [
      t.timestamp || new Date().toISOString(),
      t.id,
      t.side,
      t.bank,
      t.referenceNumber || 'N/A',
      Number(t.rate.toFixed(2)),
      Number(t.vesAmount.toFixed(2)),
      Number(t.usdtAmount.toFixed(2)),
      t.grossSpreadPct !== undefined ? Number(t.grossSpreadPct.toFixed(2)) : 0,
      t.netProfitUsdt !== undefined ? Number(t.netProfitUsdt.toFixed(2)) : 0,
      t.counterparty,
      t.status,
    ];

    const result = await googleAuthAdapter.appendSheetRows({
      spreadsheetId,
      sheetName,
      values: [rowValues],
    });

    return {
      success: true,
      spreadsheetId: result.spreadsheetId,
      sheetName,
      updatedRange: result.updatedRange,
      updatedRows: result.updatedRows,
      spreadsheetUrl: result.spreadsheetUrl,
      mode: result.mode,
      syncedTrade: {
        id: t.id,
        side: t.side,
        rate: t.rate,
        usdtAmount: t.usdtAmount,
        vesAmount: t.vesAmount,
        netProfitUsdt: t.netProfitUsdt ?? 0,
        counterparty: t.counterparty,
      },
      message:
        result.mode === 'LIVE'
          ? `Operación ${t.id} registrada en Google Sheets en ${result.updatedRange}`
          : `[Simulación] Operación ${t.id} registrada en hoja "${sheetName}". Defina credenciales para sincronización en tiempo real.`,
    };
  },
};
