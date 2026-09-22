/**
 * Pure Deterministic Finite State Machine (FSM) for P2P Order Lifecycle.
 * Enforces strict transactional state guards, anti-triangulation branching,
 * and immutable transition audit logs.
 * Framework-agnostic, zero external dependencies.
 */

export type P2POrderState =
  | 'ORDER_DETECTED'
  | 'PAYMENT_PENDING'
  | 'BANK_EVENT_RECEIVED'
  | 'IDENTITY_VERIFIED'
  | 'SUSPECTED_TRIANGULATION'
  | 'AWAITING_RELEASE'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'CANCELLED';

export type FsmEventType =
  | 'ORDER_CONFIRMED'
  | 'BANK_PAYMENT_DETECTED'
  | 'IDENTITY_CHECK_PASSED'
  | 'IDENTITY_CHECK_FAILED'
  | 'RELEASE_AUTHORIZED'
  | 'DISPUTE_TRIGGERED'
  | 'ORDER_CANCELLED'
  | 'OPERATOR_OVERRIDE';

export interface InboundBankDetails {
  bank: string;
  reference: string;
  payerName?: string;
  payerIdDoc?: string;
  amountFiat: number;
  timestamp: number;
}

export interface FsmAuditRecord {
  fromState: P2POrderState;
  toState: P2POrderState;
  event: FsmEventType;
  timestamp: number;
  reason?: string;
}

export interface FsmOrderContext {
  orderId: string;
  side: 'BUY' | 'SELL';
  asset: string;
  fiat: string;
  amountCrypto: number;
  amountFiat: number;
  price: number;
  counterpartyName: string;
  counterpartyIdDoc?: string;
  currentState: P2POrderState;
  bankPayment?: InboundBankDetails;
  fraudScore?: number;
  flags: string[];
  history: FsmAuditRecord[];
  createdAt: number;
  updatedAt: number;
}

export interface FsmEvent {
  type: FsmEventType;
  payload?: {
    bankPayment?: InboundBankDetails;
    reason?: string;
    fraudScore?: number;
    flags?: string[];
    operatorId?: string;
  };
  timestamp?: number;
}

export interface FsmTransitionResult {
  success: boolean;
  context: FsmOrderContext;
  error?: string;
}

/**
 * Matrix of valid deterministic transitions.
 * Terminal states (COMPLETED, DISPUTED, CANCELLED) require OPERATOR_OVERRIDE.
 */
const VALID_TRANSITIONS: Record<P2POrderState, FsmEventType[]> = {
  ORDER_DETECTED: ['ORDER_CONFIRMED', 'ORDER_CANCELLED', 'OPERATOR_OVERRIDE'],
  PAYMENT_PENDING: ['BANK_PAYMENT_DETECTED', 'ORDER_CANCELLED', 'OPERATOR_OVERRIDE'],
  BANK_EVENT_RECEIVED: [
    'IDENTITY_CHECK_PASSED',
    'IDENTITY_CHECK_FAILED',
    'DISPUTE_TRIGGERED',
    'ORDER_CANCELLED',
    'OPERATOR_OVERRIDE',
  ],
  IDENTITY_VERIFIED: ['RELEASE_AUTHORIZED', 'DISPUTE_TRIGGERED', 'OPERATOR_OVERRIDE'],
  SUSPECTED_TRIANGULATION: ['DISPUTE_TRIGGERED', 'OPERATOR_OVERRIDE'],
  AWAITING_RELEASE: ['RELEASE_AUTHORIZED', 'DISPUTE_TRIGGERED', 'OPERATOR_OVERRIDE'],
  COMPLETED: ['OPERATOR_OVERRIDE'],
  DISPUTED: ['OPERATOR_OVERRIDE'],
  CANCELLED: ['OPERATOR_OVERRIDE'],
};

/**
 * Initializes a new clean FSM Order context.
 */
export function createFsmOrder(params: {
  orderId: string;
  side: 'BUY' | 'SELL';
  asset?: string;
  fiat?: string;
  amountCrypto: number;
  amountFiat: number;
  price: number;
  counterpartyName: string;
  counterpartyIdDoc?: string;
  timestamp?: number;
}): FsmOrderContext {
  const now = params.timestamp ?? Date.now();
  return {
    orderId: params.orderId,
    side: params.side,
    asset: params.asset ?? 'USDT',
    fiat: params.fiat ?? 'VES',
    amountCrypto: params.amountCrypto,
    amountFiat: params.amountFiat,
    price: params.price,
    counterpartyName: params.counterpartyName,
    counterpartyIdDoc: params.counterpartyIdDoc,
    currentState: 'ORDER_DETECTED',
    flags: [],
    history: [
      {
        fromState: 'ORDER_DETECTED',
        toState: 'ORDER_DETECTED',
        event: 'ORDER_CONFIRMED',
        timestamp: now,
        reason: 'Order registered in FSM Engine',
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Pure transition reducer. Evaluates event against valid state transition rules,
 * updates context fields immutably, and appends to the audit trail.
 */
export function transitionOrderFsm(ctx: FsmOrderContext, event: FsmEvent): FsmTransitionResult {
  const allowedEvents = VALID_TRANSITIONS[ctx.currentState];
  const now = event.timestamp ?? Date.now();

  if (!allowedEvents.includes(event.type)) {
    return {
      success: false,
      context: ctx,
      error: `Transición inválida: no se permite el evento "${event.type}" desde el estado "${ctx.currentState}".`,
    };
  }

  let nextState: P2POrderState = ctx.currentState;
  const nextFlags = [...ctx.flags];
  let nextBankPayment = ctx.bankPayment;
  let nextFraudScore = ctx.fraudScore;

  switch (event.type) {
    case 'ORDER_CONFIRMED':
      nextState = 'PAYMENT_PENDING';
      break;

    case 'BANK_PAYMENT_DETECTED': {
      if (!event.payload?.bankPayment) {
        return {
          success: false,
          context: ctx,
          error: 'El evento BANK_PAYMENT_DETECTED requiere bankPayment en el payload.',
        };
      }
      // Validar coincidencia de monto aproximado o exacto con tolerancia de 0.01 VES
      const diff = Math.abs(event.payload.bankPayment.amountFiat - ctx.amountFiat);
      if (diff > 0.01) {
        nextFlags.push(
          `AMOUNT_MISMATCH: esperado ${ctx.amountFiat}, recibido ${event.payload.bankPayment.amountFiat}`,
        );
      }
      nextBankPayment = event.payload.bankPayment;
      nextState = 'BANK_EVENT_RECEIVED';
      break;
    }

    case 'IDENTITY_CHECK_PASSED':
      nextState = 'IDENTITY_VERIFIED';
      break;

    case 'IDENTITY_CHECK_FAILED':
      nextFlags.push('SUSPECTED_TRIANGULATION_FLAG');
      if (event.payload?.flags) {
        nextFlags.push(...event.payload.flags);
      }
      if (event.payload?.fraudScore !== undefined) {
        nextFraudScore = event.payload.fraudScore;
      }
      nextState = 'SUSPECTED_TRIANGULATION';
      break;

    case 'RELEASE_AUTHORIZED':
      if (ctx.currentState === 'IDENTITY_VERIFIED' && ctx.side === 'BUY') {
        // En compras, release authorized pasa por AWAITING_RELEASE o directo a COMPLETED
        nextState = 'COMPLETED';
      } else {
        nextState = ctx.currentState === 'AWAITING_RELEASE' ? 'COMPLETED' : 'AWAITING_RELEASE';
      }
      break;

    case 'DISPUTE_TRIGGERED':
      nextState = 'DISPUTED';
      if (event.payload?.reason) {
        nextFlags.push(`DISPUTE: ${event.payload.reason}`);
      }
      break;

    case 'ORDER_CANCELLED':
      nextState = 'CANCELLED';
      break;

    case 'OPERATOR_OVERRIDE':
      // El operador puede mover el estado a cualquier resolución manual
      nextState = (event.payload?.reason as P2POrderState) || 'CANCELLED';
      nextFlags.push(`OPERATOR_OVERRIDE: ${event.payload?.reason || 'Intervención manual'}`);
      break;
  }

  const auditEntry: FsmAuditRecord = {
    fromState: ctx.currentState,
    toState: nextState,
    event: event.type,
    timestamp: now,
    reason: event.payload?.reason,
  };

  const updatedContext: FsmOrderContext = {
    ...ctx,
    currentState: nextState,
    flags: Array.from(new Set(nextFlags)),
    bankPayment: nextBankPayment,
    fraudScore: nextFraudScore,
    history: [...ctx.history, auditEntry],
    updatedAt: now,
  };

  return {
    success: true,
    context: updatedContext,
  };
}

/**
 * Hydrates an in-memory FSM Order context from persisted SQLite database records.
 * Ensures data integrity and reconstructs state upon application restarts.
 */
export function hydrateFsmContext(raw: {
  orderId: string;
  side: 'BUY' | 'SELL';
  asset?: string;
  fiat?: string;
  amountCrypto: number;
  amountFiat: number;
  price: number;
  counterpartyName: string;
  counterpartyIdDoc?: string;
  currentState: P2POrderState;
  bankPaymentJson?: string;
  fraudScore?: number;
  flagsJson?: string;
  historyJson?: string;
  createdAt: number;
  updatedAt: number;
}): FsmOrderContext {
  let bankPayment: InboundBankDetails | undefined;
  if (raw.bankPaymentJson) {
    try {
      bankPayment = JSON.parse(raw.bankPaymentJson) as InboundBankDetails;
    } catch {
      bankPayment = undefined;
    }
  }

  let flags: string[] = [];
  if (raw.flagsJson) {
    try {
      flags = JSON.parse(raw.flagsJson) as string[];
    } catch {
      flags = [];
    }
  }

  let history: FsmAuditRecord[] = [];
  if (raw.historyJson) {
    try {
      history = JSON.parse(raw.historyJson) as FsmAuditRecord[];
    } catch {
      history = [];
    }
  }

  return {
    orderId: raw.orderId,
    side: raw.side,
    asset: raw.asset || 'USDT',
    fiat: raw.fiat || 'VES',
    amountCrypto: raw.amountCrypto,
    amountFiat: raw.amountFiat,
    price: raw.price,
    counterpartyName: raw.counterpartyName,
    counterpartyIdDoc: raw.counterpartyIdDoc,
    currentState: raw.currentState,
    bankPayment,
    fraudScore: raw.fraudScore,
    flags,
    history,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}
