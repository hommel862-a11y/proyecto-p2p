/**
 * Sentinel Agent (Agente Centinela)
 * 24/7 background monitor for market microstructure, orderbook depth and BCV rates.
 * Operates at zero LLM token cost using pure domain heuristics.
 */

import type { SentinelSignal, AgentHealthStatus } from './types';
import { AGENT_MCP_DOMAINS, AGENT_ASSIGNED_SKILLS } from './types';
import { executeFinancialSkill } from '../gemini-skills';

export class SentinelAgent {
  readonly role = 'SENTINEL' as const;
  readonly name = 'Centinela Microestructura';
  readonly assignedMcpDomains = AGENT_MCP_DOMAINS['SENTINEL'];
  readonly assignedSkills = AGENT_ASSIGNED_SKILLS['SENTINEL'];

  private opsProcessed = 0;
  private lastActive = Date.now();

  getHealth(): AgentHealthStatus {
    return {
      role: this.role,
      name: this.name,
      status: 'ONLINE',
      lastActiveTime: this.lastActive,
      opsProcessed: this.opsProcessed,
      description:
        'Monitoreo 24/7 de libros P2P, brecha cambiaria BCV y paridades cripto sin costo de tokens.',
      assignedMcpDomains: this.assignedMcpDomains,
      assignedSkills: this.assignedSkills,
    };
  }

  /**
   * Runs an integrated diagnostic across all assigned MCP domains and skills.
   */
  runMarketDiagnostic(): {
    bankingNetworkOperational: boolean;
    bcvInterventionRisk: string;
    flowToxicityRisk: string;
  } {
    const bankRes = executeFinancialSkill('check_bank_operational_status', {});
    const bankData = bankRes.data as
      { networkStatus?: string; pauseTradingDirective?: boolean } | undefined;

    // DECLARED ABSENCE — the BCV leg is not computed.
    //
    // This method takes no inputs and no BCV rate is bridged into the Electron process:
    // `resolveMarketFeed` carries Binance P2P book figures only, and `skills/market-state.ts`
    // never fetches a BCV official rate. So the `parallelRate: 88.5 / bcvRate: 72.0` pair used
    // here was not a fallback for a missing reading — it was a full 22.9% gap that the skill
    // computed and `?? 'NORMAL'` then published as an observed intervention zone. Worse, the
    // skill coerces both legs to `0` and the vendored `calculateBcvGap` answers a non-positive
    // rate with `gapPct: 0`, so removing the constants without guarding the call would trade
    // one invented rate for an invented "no gap". The zone is therefore not computed at all:
    // no rate is passed, so the honest answer is UNAVAILABLE, not NORMAL.
    const bcvInterventionRisk = 'UNAVAILABLE';

    const vpinRes = executeFinancialSkill('estimate_adverse_selection_vpin', {
      buckets: [],
    });
    const vpinData = vpinRes.data as { toxicityZone?: string } | undefined;

    return {
      bankingNetworkOperational: !bankData?.pauseTradingDirective,
      bcvInterventionRisk,
      flowToxicityRisk: vpinData?.toxicityZone ?? 'LOW',
    };
  }

  /**
   * Scans current market conditions to produce an institutional alpha signal.
   */
  scanMarket(params?: {
    asset?: string;
    fiat?: string;
    bestBid?: number;
    bestAsk?: number;
    bcvRate?: number;
    parallelRate?: number;
  }): SentinelSignal {
    this.opsProcessed++;
    this.lastActive = Date.now();

    const asset = params?.asset ?? 'USDT';
    const fiat = params?.fiat ?? 'VES';
    const bestBid = params?.bestBid ?? 88.5; // Compra P2P
    const bestAsk = params?.bestAsk ?? 89.8; // Venta P2P

    // DECLARED ABSENCE — a missing rate is `null`, never a plausible constant.
    //
    // The BCV leg of this signal is arithmetic on two inputs, and `?? 72.0 / ?? 88.5` meant a
    // caller with no rate data at all still received a 22.9% gap, a `source` reading
    // "Binance P2P + BCV Feeds", and an "Alta demanda de cobertura en dólares" note. The swarm
    // then consumed that as measured evidence and planned around it. A rate exists here only if
    // the caller measured one.
    const bcvRate = params?.bcvRate ?? null;
    const parallelRate = params?.parallelRate ?? null;

    // 1. Calculate spread directly with institutional fee model
    const grossSpreadPct = ((bestAsk - bestBid) / bestBid) * 100;
    const estimatedFeesPct = 0.4; // 0.1% taker + 0.3% bank transfer
    const netSpreadPct = grossSpreadPct - estimatedFeesPct;

    executeFinancialSkill('evaluate_golden_spread', {
      netSpreadPct,
    });

    // 2. Query BCV gap & market cycle — only when both legs are real numbers.
    //
    // Not guarded, the skill would coerce a null to 0 and the vendored `calculateBcvGap` would
    // answer `gapPct: 0, riskZone: 'NORMAL'`, i.e. a measured "no gap". The spread leg above is
    // genuinely measured from the caller's book, so only the gap is refused.
    const hasRateEvidence =
      typeof bcvRate === 'number' && typeof parallelRate === 'number';
    const bcvRes = hasRateEvidence
      ? executeFinancialSkill('predict_bcv_market_intelligence', {
          parallelRate,
          bcvRate,
        })
      : undefined;
    const bcvData = bcvRes?.data as
      | {
          gap?: { gapPct?: number; riskZone?: string };
          recommendation?: { action?: string; confidenceScore?: number };
        }
      | undefined;

    const rateGapPct =
      bcvData?.gap?.gapPct ?? (hasRateEvidence ? ((parallelRate! - bcvRate!) / bcvRate!) * 100 : null);
    const notes: string[] = [];

    // 3. Check Venezuelan banking network operational status
    const bankRes = executeFinancialSkill('check_bank_operational_status', {
      bankCodes: ['0102', '0134', '0105', '0108', '0172', 'PAGO_MOVIL'],
    });
    const bankData = bankRes.data as {
      networkStatus?: string;
      averageSettlementLatencyMinutes?: number;
      pauseTradingDirective?: boolean;
    };

    // 4. Evaluate order flow toxicity (VPIN)
    const vpinRes = executeFinancialSkill('estimate_adverse_selection_vpin', {
      buckets: [],
    });
    const vpinData = vpinRes.data as {
      vpinMetric?: number;
      toxicityZone?: string;
    };

    if (netSpreadPct >= 0.5) {
      notes.push(
        `Regla de oro alcanzada: spread neto de ${netSpreadPct.toFixed(2)}% supera el umbral de 0.50%.`,
      );
    } else {
      notes.push(
        `Spread neto de ${netSpreadPct.toFixed(2)}% por debajo del umbral institucional (0.50%).`,
      );
    }

    if (rateGapPct === null) {
      // The absence names its own remedy, so an operator can act on it instead of debugging it.
      const missing =
        bcvRate === null && parallelRate === null
          ? 'la tasa oficial BCV y la tasa paralelo'
          : bcvRate === null
            ? 'la tasa oficial BCV'
            : 'la tasa paralelo';
      notes.push(
        `Brecha BCV/Paralelo: N/D. Falta ${missing}. Fuente requerida: ` +
          `MCP get_bcv_rates (tasa oficial BCV) y MCP get_parallel_rates (tasa paralelo P2P); ` +
          `la brecha NO se estima por defecto.`,
      );
    } else if (rateGapPct > 20) {
      notes.push(
        `Brecha BCV/Paralelo elevada (${rateGapPct.toFixed(1)}%). Alta demanda de cobertura en dólares.`,
      );
    }

    if (bankData?.networkStatus) {
      notes.push(
        `Cámara Bancaria: ${bankData.networkStatus} (Latencia promedio: ${bankData.averageSettlementLatencyMinutes ?? 1.0} min).`,
      );
    }

    if (vpinData?.toxicityZone) {
      notes.push(
        `Toxicidad de flujo (VPIN): ${vpinData.toxicityZone} (${((vpinData.vpinMetric ?? 0.15) * 100).toFixed(1)}%).`,
      );
    }

    return {
      timestamp: Date.now(),
      source: 'Binance P2P + BCV Feeds',
      asset,
      fiat,
      grossSpreadPct: Number(grossSpreadPct.toFixed(2)),
      netSpreadPct: Number(netSpreadPct.toFixed(2)),
      bestBid,
      bestAsk,
      bcvRate,
      parallelRate,
      rateGapPct: rateGapPct === null ? null : Number(rateGapPct.toFixed(2)),
      isViable: netSpreadPct >= 0.5,
      notes,
    };
  }
}
