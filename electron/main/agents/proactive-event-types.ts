/**
 * Institutional Desk - Proactive Event Engine Types
 * Handles real-time market microstructure events, BCV intervention window alerts,
 * and USDT/USD parity depeg warnings.
 */

export type ProactiveEventType =
  | 'BCV_INTERVENTION_WINDOW'
  | 'BCV_GAP_ANOMALY'
  | 'USDT_DEPEG_WARNING'
  | 'SPREAD_COMPRESSION'
  | 'SPOOF_ORDER_PURGE';

export type EventSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface ProactiveEventAlert {
  id: string;
  type: ProactiveEventType;
  severity: EventSeverity;
  title: string;
  message: string;
  data: Record<string, unknown>;
  timestamp: number;
  recommendedAction?: string;
  autoKillswitch?: boolean;
}
