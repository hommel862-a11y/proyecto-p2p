import { describe, it, expect } from 'vitest';
import {
  createFsmOrder,
  transitionOrderFsm,
  hydrateFsmContext,
  type InboundBankDetails,
} from './fsm';

describe('P2P Order Finite State Machine (FSM)', () => {
  const initialParams = {
    orderId: 'ORD-100200',
    side: 'BUY' as const,
    asset: 'USDT',
    fiat: 'VES',
    amountCrypto: 100,
    amountFiat: 6500,
    price: 65,
    counterpartyName: 'Juan Carlos Perez',
    counterpartyIdDoc: 'V-19876543',
    timestamp: 1700000000000,
  };

  it('should initialize a valid order in ORDER_DETECTED state with audit log', () => {
    const order = createFsmOrder(initialParams);

    expect(order.currentState).toBe('ORDER_DETECTED');
    expect(order.orderId).toBe('ORD-100200');
    expect(order.history.length).toBe(1);
    expect(order.history[0].event).toBe('ORDER_CONFIRMED');
    expect(order.flags).toEqual([]);
  });

  it('should advance order through BUY happy path to COMPLETED', () => {
    let order = createFsmOrder(initialParams);

    // 1. ORDER_CONFIRMED -> PAYMENT_PENDING
    let res = transitionOrderFsm(order, { type: 'ORDER_CONFIRMED' });
    expect(res.success).toBe(true);
    expect(res.context.currentState).toBe('PAYMENT_PENDING');
    order = res.context;

    // 2. BANK_PAYMENT_DETECTED -> BANK_EVENT_RECEIVED
    const bankPayment: InboundBankDetails = {
      bank: 'Banesco',
      reference: '00987123',
      payerName: 'Juan Carlos Perez',
      payerIdDoc: 'V-19876543',
      amountFiat: 6500,
      timestamp: 1700000010000,
    };
    res = transitionOrderFsm(order, {
      type: 'BANK_PAYMENT_DETECTED',
      payload: { bankPayment },
    });
    expect(res.success).toBe(true);
    expect(res.context.currentState).toBe('BANK_EVENT_RECEIVED');
    expect(res.context.bankPayment).toEqual(bankPayment);
    order = res.context;

    // 3. IDENTITY_CHECK_PASSED -> IDENTITY_VERIFIED
    res = transitionOrderFsm(order, { type: 'IDENTITY_CHECK_PASSED' });
    expect(res.success).toBe(true);
    expect(res.context.currentState).toBe('IDENTITY_VERIFIED');
    order = res.context;

    // 4. RELEASE_AUTHORIZED -> COMPLETED (BUY order goes directly to completed)
    res = transitionOrderFsm(order, { type: 'RELEASE_AUTHORIZED' });
    expect(res.success).toBe(true);
    expect(res.context.currentState).toBe('COMPLETED');
    expect(res.context.history.length).toBe(5);
  });

  it('should branch to SUSPECTED_TRIANGULATION when identity check fails', () => {
    let order = createFsmOrder(initialParams);

    order = transitionOrderFsm(order, { type: 'ORDER_CONFIRMED' }).context;
    order = transitionOrderFsm(order, {
      type: 'BANK_PAYMENT_DETECTED',
      payload: {
        bankPayment: {
          bank: 'Mercantil',
          reference: '123456',
          payerName: 'Maria Rodriguez Inconsistente',
          amountFiat: 6500,
          timestamp: 1700000020000,
        },
      },
    }).context;

    // Falla la comprobación de identidad
    const failRes = transitionOrderFsm(order, {
      type: 'IDENTITY_CHECK_FAILED',
      payload: {
        fraudScore: 85,
        flags: ['THIRD_PARTY_PAYER', 'NAME_MISMATCH'],
        reason: 'Nombre bancario no coincide con titular Binance',
      },
    });

    expect(failRes.success).toBe(true);
    expect(failRes.context.currentState).toBe('SUSPECTED_TRIANGULATION');
    expect(failRes.context.fraudScore).toBe(85);
    expect(failRes.context.flags).toContain('SUSPECTED_TRIANGULATION_FLAG');
    expect(failRes.context.flags).toContain('THIRD_PARTY_PAYER');

    // Debe permitir transicionar a DISPUTED
    const disputeRes = transitionOrderFsm(failRes.context, {
      type: 'DISPUTE_TRIGGERED',
      payload: { reason: 'Estafa triangular detectada por el operador' },
    });
    expect(disputeRes.success).toBe(true);
    expect(disputeRes.context.currentState).toBe('DISPUTED');
  });

  it('should detect amount discrepancy during BANK_PAYMENT_DETECTED and flag it', () => {
    let order = createFsmOrder(initialParams);
    order = transitionOrderFsm(order, { type: 'ORDER_CONFIRMED' }).context;

    const res = transitionOrderFsm(order, {
      type: 'BANK_PAYMENT_DETECTED',
      payload: {
        bankPayment: {
          bank: 'BDV',
          reference: '998877',
          payerName: 'Juan Carlos Perez',
          amountFiat: 6000, // Menos de los 6500 acordados
          timestamp: 1700000030000,
        },
      },
    });

    expect(res.success).toBe(true);
    expect(res.context.currentState).toBe('BANK_EVENT_RECEIVED');
    expect(res.context.flags.some((f) => f.includes('AMOUNT_MISMATCH'))).toBe(true);
  });

  it('should reject invalid transition and retain previous state unchanged', () => {
    const order = createFsmOrder(initialParams);

    // Intentar saltar directamente a RELEASE_AUTHORIZED desde ORDER_DETECTED
    const res = transitionOrderFsm(order, { type: 'RELEASE_AUTHORIZED' });
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
    expect(res.context.currentState).toBe('ORDER_DETECTED');
  });

  it('should require bankPayment payload when emitting BANK_PAYMENT_DETECTED', () => {
    let order = createFsmOrder(initialParams);
    order = transitionOrderFsm(order, { type: 'ORDER_CONFIRMED' }).context;

    const res = transitionOrderFsm(order, { type: 'BANK_PAYMENT_DETECTED' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('requiere bankPayment');
  });

  it('should allow operator override from any state', () => {
    const order = createFsmOrder(initialParams);

    const overrideRes = transitionOrderFsm(order, {
      type: 'OPERATOR_OVERRIDE',
      payload: { reason: 'DISPUTED' },
    });

    expect(overrideRes.success).toBe(true);
    expect(overrideRes.context.currentState).toBe('DISPUTED');
    expect(overrideRes.context.flags.some((f) => f.includes('OPERATOR_OVERRIDE'))).toBe(true);
  });

  it('should hydrate context properly from raw SQLite records', () => {
    const raw = {
      orderId: 'ORD-555',
      side: 'SELL' as const,
      asset: 'USDT',
      fiat: 'VES',
      amountCrypto: 50,
      amountFiat: 3250,
      price: 65,
      counterpartyName: 'Carlos Gomez',
      counterpartyIdDoc: 'V-20111222',
      currentState: 'AWAITING_RELEASE' as const,
      bankPaymentJson: JSON.stringify({
        bank: 'Banesco',
        reference: '778899',
        amountFiat: 3250,
        timestamp: 1700000000000,
      }),
      fraudScore: 10,
      flagsJson: JSON.stringify(['SAFE_HISTORY']),
      historyJson: JSON.stringify([
        {
          fromState: 'ORDER_DETECTED',
          toState: 'PAYMENT_PENDING',
          event: 'ORDER_CONFIRMED',
          timestamp: 1,
        },
      ]),
      createdAt: 1700000000000,
      updatedAt: 1700000050000,
    };

    const hydrated = hydrateFsmContext(raw);

    expect(hydrated.orderId).toBe('ORD-555');
    expect(hydrated.currentState).toBe('AWAITING_RELEASE');
    expect(hydrated.bankPayment?.reference).toBe('778899');
    expect(hydrated.flags).toEqual(['SAFE_HISTORY']);
    expect(hydrated.history.length).toBe(1);
  });
});
