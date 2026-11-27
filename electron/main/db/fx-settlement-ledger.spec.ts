import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { P2PDatabaseService } from './database';
import {
  isAllowedExternalUrl,
  validateOrchestratorMutationRequest,
  validateTelegramFileDownloadParams,
} from '../security/bridge-guards';

describe('Sprint 2 — FX Settlement SQLite Ledger & Electron Security Shield', () => {
  let tmpDir: string;
  let db: P2PDatabaseService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-fx-ledger-'));
    db = new P2PDatabaseService(path.join(tmpDir, 'test.sqlite'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists FX settlements with a verifiable SHA-256 hash chain and blocks replay via idempotency_key', () => {
    const first = db.saveFxSettlementRecord({
      id: 'fx-bancamiga-1',
      idempotencyKey: 'nonce-bancamiga-001',
      timestamp: '2026-11-26T13:41:08.000Z',
      vetDateKey: '2026-11-26',
      bankId: 'BANCAMIGA',
      bankName: 'Bancamiga Banco Universal',
      accountId: 'acc-8841',
      accountName: 'Bancamiga Transferencia',
      modality: 'MENUDEO_BCV',
      purchasedUsd: 1500,
      bcvRateVes: 62.45,
      principalVes: 93675,
      bankFeePct: 0.25,
      bankFeeVes: 234.19,
      totalDebitVes: 93909.19,
      exitRail: 'INTL_DEBIT_CARD',
      igtfPct: 3.0,
      igtfUsd: 45,
      railFeePct: 1.5,
      railFeeUsd: 22.5,
      netUsdt: 1432.5,
      channel: 'DESKTOP_UI',
    });

    expect(first.saved).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(first.rowHash).toMatch(/^[a-f0-9]{64}$/);

    // Replay with the exact same idempotencyKey must be rejected without duplicating
    const replay = db.saveFxSettlementRecord({
      id: 'fx-bancamiga-replay',
      idempotencyKey: 'nonce-bancamiga-001',
      timestamp: '2026-11-26T13:41:10.000Z',
      vetDateKey: '2026-11-26',
      bankId: 'BANCAMIGA',
      bankName: 'Bancamiga Banco Universal',
      accountId: 'acc-8841',
      accountName: 'Bancamiga Transferencia',
      modality: 'MENUDEO_BCV',
      purchasedUsd: 1500,
      bcvRateVes: 62.45,
      principalVes: 93675,
      bankFeePct: 0.25,
      bankFeeVes: 234.19,
      totalDebitVes: 93909.19,
      exitRail: 'INTL_DEBIT_CARD',
      igtfPct: 3.0,
      igtfUsd: 45,
      railFeePct: 1.5,
      railFeeUsd: 22.5,
      netUsdt: 1432.5,
      channel: 'TELEGRAM_CALLBACK',
    });
    expect(replay.saved).toBe(false);
    expect(replay.duplicate).toBe(true);

    const second = db.saveFxSettlementRecord({
      id: 'fx-bdv-2',
      idempotencyKey: 'nonce-bdv-002',
      timestamp: '2026-11-26T13:55:00.000Z',
      vetDateKey: '2026-11-26',
      bankId: 'BDV',
      bankName: 'Banco de Venezuela (BDV)',
      accountId: 'acc-1092',
      accountName: 'BDV Transferencia',
      modality: 'MENUDEO_BCV',
      purchasedUsd: 1000,
      bcvRateVes: 62.45,
      principalVes: 62450,
      bankFeePct: 0.25,
      bankFeeVes: 156.13,
      totalDebitVes: 62606.13,
      exitRail: 'INTERNAL_USD_P2P',
      igtfPct: 3.0,
      igtfUsd: 30,
      railFeePct: 1.2,
      railFeeUsd: 12,
      netUsdt: 958,
      channel: 'TELEGRAM_CALLBACK',
    });
    expect(second.saved).toBe(true);
    expect(second.prevHash).toBe(first.rowHash);

    const rows = db.listFxSettlementRecords(10);
    expect(rows.length).toBe(2);
    const verification = db.verifyFxSettlementChain();
    expect(verification.valid).toBe(true);
    expect(verification.checkedRows).toBe(2);
  });

  it('normalizes renderer Operation objects in saveOperationRecord without NOT NULL SQLite crashes', () => {
    const legacyOp = {
      id: 'fx-banesco-legacy',
      timestamp: '2026-11-26T14:00:00.000Z',
      type: 'buy',
      pair: 'USDT',
      vesAmount: 74940,
      usdtAmount: 1146,
      price: 65.39,
      merchantNote: 'MESA_BCV:Banesco:USD=1200',
      fees: 187.35,
      notes: 'Compra Mesa Cambiaria Banesco',
      errorFree: true,
      bankAccountId: 'acc-4821',
    };

    const ok = db.saveOperationRecord(legacyOp as unknown as Parameters<typeof db.saveOperationRecord>[0]);
    expect(ok).toBe(true);

    const saved = db.listOperationRecords(5);
    expect(saved.length).toBe(1);
    expect(saved[0].side).toBe('BUY');
    expect(saved[0].fiatAmount).toBe(74940);
    expect(saved[0].cryptoAmount).toBe(1146);
    expect(saved[0].bank).toContain('Banesco');
  });

  it('blocks cross-origin no-cors CSRF and enforces JSON + token/origin on orchestrator HTTP mutations', () => {
    const sessionToken = 'a'.repeat(64);
    const allowedOrigins = new Set(['http://127.0.0.1:51857', 'http://localhost:4200']);

    // 1. Cross-origin website drive-by POST
    const csrfCrossOrigin = validateOrchestratorMutationRequest(
      {
        origin: 'https://evil-attacker.example',
        'sec-fetch-site': 'cross-site',
        'content-type': 'text/plain',
      },
      allowedOrigins,
      sessionToken,
    );
    expect(csrfCrossOrigin.allowed).toBe(false);
    expect(csrfCrossOrigin.statusCode).toBe(403);

    // 2. Same-origin or null-origin no-cors text/plain POST without application/json
    const noCorsPlain = validateOrchestratorMutationRequest(
      {
        'content-type': 'text/plain',
      },
      allowedOrigins,
      sessionToken,
    );
    expect(noCorsPlain.allowed).toBe(false);
    expect(noCorsPlain.statusCode).toBe(415);

    // 3. Invalid X-P2P-Bridge-Token
    const badToken = validateOrchestratorMutationRequest(
      {
        origin: 'http://127.0.0.1:51857',
        'content-type': 'application/json',
        'x-p2p-bridge-token': 'wrong-token',
      },
      allowedOrigins,
      sessionToken,
    );
    expect(badToken.allowed).toBe(false);
    expect(badToken.statusCode).toBe(401);

    // 4. Missing X-P2P-Bridge-Token MUST be rejected (401), never optional
    const missingToken = validateOrchestratorMutationRequest(
      {
        origin: 'http://127.0.0.1:51857',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      allowedOrigins,
      sessionToken,
    );
    expect(missingToken.allowed).toBe(false);
    expect(missingToken.statusCode).toBe(401);

    // 5. Arbitrary chrome-extension:// origins MUST be rejected (403)
    const extOrigin = validateOrchestratorMutationRequest(
      {
        origin: 'chrome-extension://malicious-ext-id',
        'content-type': 'application/json',
        'x-p2p-bridge-token': sessionToken,
      },
      allowedOrigins,
      sessionToken,
    );
    expect(extOrigin.allowed).toBe(false);
    expect(extOrigin.statusCode).toBe(403);

    // 6. Legitimate same-origin JSON request WITH valid X-P2P-Bridge-Token
    const validSameOrigin = validateOrchestratorMutationRequest(
      {
        origin: 'http://127.0.0.1:51857',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json; charset=utf-8',
        'x-p2p-bridge-token': sessionToken,
      },
      allowedOrigins,
      sessionToken,
    );
    expect(validSameOrigin.allowed).toBe(true);
  });

  it('prevents path traversal on Telegram file proxy and restricts shell.openExternal to safe domains', () => {
    const traversal = validateTelegramFileDownloadParams(
      '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ123456',
      '../../bot999/getUpdates',
    );
    expect(traversal.valid).toBe(false);

    const validFile = validateTelegramFileDownloadParams(
      '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ123456',
      'photos/file_42.jpg',
    );
    expect(validFile.valid).toBe(true);

    expect(isAllowedExternalUrl('https://www.banesconline.com/mantis/WebSite/login.aspx')).toBe(true);
    expect(isAllowedExternalUrl('https://bdvenlinea.banvenez.com/')).toBe(true);
    expect(isAllowedExternalUrl('https://www.100x100banco.com/')).toBe(true);
    expect(isAllowedExternalUrl('https://t.me/my_sentinel_bot')).toBe(true);
    expect(isAllowedExternalUrl('tg://resolve?domain=my_sentinel_bot')).toBe(true);
    expect(isAllowedExternalUrl('tg://unsafe-arbitrary-action')).toBe(false);
    expect(isAllowedExternalUrl('https://evil-malware.ru/steal')).toBe(false);
    expect(isAllowedExternalUrl('http://bdvenlinea.banvenez.com/')).toBe(false); // HTTP cleartext blocked!
  });
});
