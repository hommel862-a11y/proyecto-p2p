import { describe, it, expect } from 'vitest';
import { gdriveBackupReceiptTool } from './gdrive_backup_receipt.js';
import { gsheetsSyncTradeTool } from './gsheets_sync_trade.js';
import { gdriveSyncDbBackupTool } from './gdrive_sync_db_backup.js';

describe('Google Workspace MCP Tools Suite', () => {
  it('gdrive_backup_receipt successfully formats, tags, and processes receipt upload', async () => {
    const res = await gdriveBackupReceiptTool.execute({
      tradeId: 'ORD-98214',
      counterparty: 'CryptoTrader_Vzla',
      imageData:
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      mimeType: 'image/png',
      amountVes: 15800.5,
      amountUsdt: 200,
      bank: 'Banesco',
    });

    expect(res.success).toBe(true);
    expect(res.tradeId).toBe('ORD-98214');
    expect(res.counterparty).toBe('CryptoTrader_Vzla');
    expect(res.fileId).toBeDefined();
    expect(res.webViewLink).toContain('drive.google.com');
    expect(res.folderPath).toContain('P2P_Receipts/');
  });

  it('gsheets_sync_trade correctly formats and appends trade rows to Google Sheets', async () => {
    const res = await gsheetsSyncTradeTool.execute({
      spreadsheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
      sheetName: 'Arbitraje_2026',
      trade: {
        id: 'TX-77492',
        side: 'BUY',
        bank: 'Pago Móvil BDV',
        rate: 79.25,
        vesAmount: 79250,
        usdtAmount: 1000,
        grossSpreadPct: 1.45,
        netProfitUsdt: 14.5,
        counterparty: 'MesaCambio_Caracas',
        referenceNumber: '00928174',
        status: 'COMPLETED',
      },
    });

    expect(res.success).toBe(true);
    expect(res.spreadsheetId).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz');
    expect(res.sheetName).toBe('Arbitraje_2026');
    expect(res.updatedRows).toBe(1);
    expect(res.syncedTrade.id).toBe('TX-77492');
    expect(res.syncedTrade.netProfitUsdt).toBe(14.5);
    expect(res.spreadsheetUrl).toContain(
      'docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz',
    );
  });

  it('gdrive_sync_db_backup structures JSON snapshot and computes payload size', async () => {
    const samplePayload = JSON.stringify({
      version: '1.0.0',
      totalTrades: 42,
      lastHash: '8f0a2b1c9e',
    });

    const res = await gdriveSyncDbBackupTool.execute({
      backupType: 'ledger_json',
      dataPayload: samplePayload,
      encrypt: true,
    });

    expect(res.success).toBe(true);
    expect(res.backupType).toBe('ledger_json');
    expect(res.encrypted).toBe(true);
    expect(res.sizeBytes).toBeGreaterThan(0);
    expect(res.fileName).toContain('p2p_backup_ledger_json_');
    expect(res.webViewLink).toBeDefined();
  });
});
