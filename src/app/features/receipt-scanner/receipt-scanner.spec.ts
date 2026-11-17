import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { ReceiptScanner } from './receipt-scanner';
import { P2P_STORAGE } from '../../core/storage';
import { MemoryStorage } from '../../core/memory-storage';
import { CotizaveService } from '../../core/cotizave.service';
import type { BankReceiptRecord, Operation } from '@p2p/core';

const OPS_KEY = 'p2p.operations';

describe('ReceiptScanner settleToLedger', () => {
  let mem: MemoryStorage;

  beforeEach(() => {
    mem = new MemoryStorage();
    TestBed.configureTestingModule({
      imports: [ReceiptScanner],
      providers: [{ provide: P2P_STORAGE, useValue: mem }],
    });
  });

  it('appends settled VES receipt with matched bankAccountId, receiptReference, payerName, and live rate conversion', () => {
    const existing: Operation = {
      id: 'older-op',
      timestamp: '2026-10-01T10:00:00Z',
      type: 'buy',
      pair: 'USDT',
      vesAmount: 8000,
      usdtAmount: 10,
      price: 800,
      merchantNote: 'prior',
      fees: 0,
      notes: '',
      errorFree: true,
    };
    mem.setItem(OPS_KEY, JSON.stringify([existing]));

    const cotizave = TestBed.inject(CotizaveService);
    cotizave.ratesProvenance.set('live');
    cotizave.ratesByMarket.set({
      binance: {
        market: 'binance',
        type: 'p2p',
        ask: 800,
        bid: 800,
        mid: 800,
      },
    });

    const fixture = TestBed.createComponent(ReceiptScanner);
    const rec: BankReceiptRecord = {
      id: 'r-1',
      reference: '88991122',
      amount: 16000,
      currency: 'VES',
      bank: 'BANESCO',
      bankDisplayName: 'Banesco Banco Universal',
      payerName: 'Carlos Mendoza',
      payerId: 'V-12345678',
      rawText: 'Transferencia Banesco Ref 88991122 Bs 16.000,00',
      confidenceScore: 0.92,
      antiTriangulationAlert: false,
      isDuplicate: false,
    };

    fixture.componentInstance.settleToLedger(rec);

    const saved = JSON.parse(mem.getItem(OPS_KEY) || '[]') as Operation[];
    expect(saved).toHaveLength(2);
    expect(saved[0].id).toBe('older-op');
    expect(saved[1].receiptReference).toBe('88991122');
    expect(saved[1].payerName).toBe('Carlos Mendoza');
    expect(saved[1].bankAccountId).toBeTruthy();
    expect(saved[1].price).toBe(800);
    expect(saved[1].usdtAmount).toBe(20);
  });
});
