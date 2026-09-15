/**
 * Institutional Desk - Proactive Event Engine.
 * Evaluates real-time market shifts (BCV intervention windows, exchange depegs,
 * and orderbook spoofing) to proactively dispatch alerts, advise the swarm,
 * and register actionable risk observations in Engram WAL.
 */

import { Notification } from 'electron';
import type { P2PDatabaseService } from '../db/database';
import { getBcvMarketIntelligence } from '../vendor/p2p-core/bcv-intervention-predictor';
import type { ProactiveEventAlert } from './proactive-event-types';

export function detectUsdtDepegParity(spotUsdtPrice = 1.000, thresholdPct = 0.2) {
  const deviation = ((spotUsdtPrice - 1.0) / 1.0) * 100;
  const parityDeviationPct = Math.round(deviation * 1000) / 1000;
  const absDev = Math.abs(parityDeviationPct);

  let status: 'PEGGED' | 'DEPEG_DISCOUNT' | 'DEPEG_PREMIUM' = 'PEGGED';
  let isDepegged = false;
  let riskSeverity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'NONE';
  let recommendation = 'USDT operando dentro de paridad normal ($1.000 ± 0.2%). Sin riesgo cambiario global.';

  if (parityDeviationPct < -thresholdPct) {
    status = 'DEPEG_DISCOUNT';
    isDepegged = true;
    if (absDev >= 1.0) {
      riskSeverity = 'CRITICAL';
      recommendation = `ALERTA ROJA: USDT cotizando a $${spotUsdtPrice.toFixed(4)} (-${absDev}%). Riesgo de corrida o desconfianza sistémica. Pausar operaciones.`;
    } else if (absDev >= 0.5) {
      riskSeverity = 'HIGH';
      recommendation = `DESPEGUE SIGNIFICATIVO: USDT a $${spotUsdtPrice.toFixed(4)}. Comprar USDT con descuento solo si se arbitra inmediatamente contra USD fiat.`;
    } else {
      riskSeverity = 'LOW';
      recommendation = `Desviación leve por debajo de la paridad (-${absDev}%). Oportunidad de captura de rebote a paridad.`;
    }
  } else if (parityDeviationPct > thresholdPct) {
    status = 'DEPEG_PREMIUM';
    isDepegged = true;
    riskSeverity = absDev >= 1.0 ? 'HIGH' : 'LOW';
    recommendation = `USDT con sobreprecio a $${spotUsdtPrice.toFixed(4)} (+${absDev}%). Vender USDT spot y adquirir USD para capturar la prima.`;
  }

  return {
    spotUsdtPrice,
    parityDeviationPct,
    status,
    isDepegged,
    thresholdPct,
    riskSeverity,
    recommendation,
  };
}

export class ProactiveEventEngine {
  private lastAlertTimeByEvent = new Map<string, number>();
  private readonly THROTTLE_MS = 10 * 60 * 1000; // 10 minutes debounce per alert signature

  constructor(
    private db: P2PDatabaseService,
    private notifyRenderer: (channel: string, payload: unknown) => void,
  ) {}

  /**
   * Evaluates macroeconomic BCV window conditions and gap anomaly.
   */
  evaluateBcvMacroEvent(parallelRate: number, bcvRate: number, now = new Date()): ProactiveEventAlert | null {
    const intel = getBcvMarketIntelligence(parallelRate, bcvRate, now);
    const gapPct = intel.gap.gapPct;
    const phase = intel.window.phase;

    // 1. Critical BCV intervention active alert
    if (phase === 'INTERVENTION_ACTIVE') {
      const key = `BCV_WINDOW_${phase}`;
      if (this.shouldTrigger(key)) {
        const alert: ProactiveEventAlert = {
          id: `EVT-${Date.now().toString(36).toUpperCase()}`,
          type: 'BCV_INTERVENTION_WINDOW',
          severity: 'CRITICAL',
          title: '🚨 INTERVENCIÓN CAMBIARIA BCV EN CURSO',
          message: `El Banco Central está inyectando divisas activamente. Brecha actual: ${gapPct}%. Se prevé volatilidad y caída temporal del paralelo.`,
          data: { gapPct, phase, bcvRate, parallelRate },
          timestamp: Date.now(),
          recommendedAction: 'Detener órdenes de compra agresivas y esperar estabilización del precio antes del mediodía.',
          autoKillswitch: false,
        };

        this.persistAndBroadcast(alert, 'bcv/intervention-active', 'Ventana de inyección de divisas BCV en curso.');
        return alert;
      }
    }

    // 2. Pre-intervention compression warning
    if (phase === 'PRE_INTERVENTION_COMPRESSION') {
      const key = `BCV_PRE_COMPRESSION`;
      if (this.shouldTrigger(key)) {
        const alert: ProactiveEventAlert = {
          id: `EVT-${Date.now().toString(36).toUpperCase()}`,
          type: 'BCV_INTERVENTION_WINDOW',
          severity: 'WARNING',
          title: '⏳ FASE PRE-INTERVENCIÓN BCV',
          message: `Faltan aproximadamente ${intel.window.hoursUntilIntervention} horas para la ventana bancaria del BCV.`,
          data: { gapPct, phase, hoursUntil: intel.window.hoursUntilIntervention },
          timestamp: Date.now(),
          recommendedAction: 'Acelerar el ciclo de rotación y mantener inventario resguardado en USDT.',
        };

        this.persistAndBroadcast(alert, 'bcv/pre-intervention', 'Fase pre-intervención BCV detectada.');
        return alert;
      }
    }

    // 3. Extreme Gap Dispersion (>28%)
    if (gapPct >= 28) {
      const key = `BCV_GAP_CRITICAL`;
      if (this.shouldTrigger(key)) {
        const alert: ProactiveEventAlert = {
          id: `EVT-${Date.now().toString(36).toUpperCase()}`,
          type: 'BCV_GAP_ANOMALY',
          severity: 'CRITICAL',
          title: '⚠️ BRECHA CAMBIARIA CRÍTICA (>28%)',
          message: `La brecha entre el paralelo (${parallelRate}) y el BCV (${bcvRate}) alcanzó ${gapPct}%. Dispersión extrema.`,
          data: { gapPct, bcvRate, parallelRate },
          timestamp: Date.now(),
          recommendedAction: 'Reducir saldo operativo en moneda fiat a menos del 10% del capital total.',
        };

        this.persistAndBroadcast(alert, 'macro/gap-dispersion', `Brecha cambiaria en nivel crítico (${gapPct}%).`);
        return alert;
      }
    }

    return null;
  }

  /**
   * Evaluates global USDT parity vs USD ($1.000).
   */
  evaluateUsdtDepegEvent(spotUsdtPrice: number): ProactiveEventAlert | null {
    const depegResult = detectUsdtDepegParity(spotUsdtPrice, 0.2);

    if (depegResult.isDepegged) {
      const key = `USDT_DEPEG_${depegResult.status}`;
      if (this.shouldTrigger(key)) {
        const severity = depegResult.riskSeverity === 'CRITICAL' ? 'CRITICAL' : 'WARNING';
        const alert: ProactiveEventAlert = {
          id: `EVT-${Date.now().toString(36).toUpperCase()}`,
          type: 'USDT_DEPEG_WARNING',
          severity,
          title: depegResult.riskSeverity === 'CRITICAL' ? '🚨 DEPEG CRÍTICO DE USDT' : '⚠️ DESVÍO DE PARIDAD EN USDT',
          message: depegResult.recommendation,
          data: {
            spotUsdtPrice,
            deviationPct: depegResult.parityDeviationPct,
            status: depegResult.status,
          },
          timestamp: Date.now(),
          recommendedAction: depegResult.recommendation,
          autoKillswitch: depegResult.riskSeverity === 'CRITICAL',
        };

        this.persistAndBroadcast(
          alert,
          'risk/usdt-depeg',
          `Desvío de paridad en USDT de ${depegResult.parityDeviationPct}% (${depegResult.status}).`
        );
        return alert;
      }
    }

    return null;
  }

  /**
   * Persists alert in Engram observations and broadcasts via IPC and OS notifications.
   */
  private persistAndBroadcast(alert: ProactiveEventAlert, topicKey: string, what: string): void {
    // 1. Record Engram Observation
    this.db.saveEngramObservation({
      topicKey,
      type: alert.severity === 'CRITICAL' ? 'decision' : 'pattern',
      scope: 'project',
      what,
      why: alert.message,
      whereAffected: 'Mesa de operaciones / Libros P2P',
      learned: alert.recommendedAction ?? 'Monitorear microestructura y resguardar capital.',
      confidenceScore: 0.95,
      status: 'active',
    });

    // 2. Send IPC to Renderer
    this.notifyRenderer('copilot:proactive-event-alert', alert);

    // 3. Native OS Notification (guarded for non-GUI or test environments)
    try {
      if (typeof Notification !== 'undefined' && Notification?.isSupported?.()) {
        new Notification({
          title: alert.title,
          body: `${alert.message} Acción: ${alert.recommendedAction ?? ''}`,
        }).show();
      }
    } catch {
      // Ignore notification failures in test or unsupported platforms
    }
  }

  private shouldTrigger(key: string): boolean {
    const now = Date.now();
    const last = this.lastAlertTimeByEvent.get(key);
    if (!last || now - last > this.THROTTLE_MS) {
      this.lastAlertTimeByEvent.set(key, now);
      return true;
    }
    return false;
  }
}
