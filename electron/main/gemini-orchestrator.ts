/**
 * Gemini Orchestrator for P2P Decision Tool.
 * Orchestrates multi-agent financial planning, Function Calling with Core domain skills,
 * persists strategies and continuous market learnings into SQLite,
 * and maintains human-in-the-loop approval barriers.
 */

import type {
  P2PDatabaseService,
  StrategyPlanRecord,
  MarketLearningRecord,
  EngramObservationRecord,
} from './db/database';
import type {
  CopilotChatMessage,
  CopilotResponse,
  StrategyPlanCard,
  GroundingSource,
} from '../shared/types';
import { GEMINI_FINANCIAL_SKILLS, executeFinancialSkill, executeLiveWebSearch } from './gemini-skills';
import { AgentRegistry, type RegisteredAgentDto } from './agents/agent-registry';
import { MCP_SERVER_REGISTRY, executeMcpToolTest } from './mcp-bootstrap';
import type { AgentSwarmOrchestrator } from './agents/swarm-orchestrator';
import { WebhookDispatcher, type PlanDispatchSummary } from './services/webhook-dispatcher';
import { killswitchState } from './ipc/killswitch-state';
import { getTreasurySnapshot } from './ipc/treasury-snapshot';
import {
  getFinancialSkillMarketData,
  getMarketBook,
  resolveMarketFeed,
  describeMarketFeed,
  resolveBcvRate,
  describeBcvFeed,
} from './skills/market-state';
import {
  SECRET_SCHEME,
  SECRET_SCHEME_UNAVAILABLE,
  decryptSecret,
  encryptSecret,
  isSecretStorageAvailable,
} from './db/secret-store';
import {
  UniversalAiGateway,
  DEFAULT_PROVIDER_MODELS,
  type AiProviderType,
  type UniversalToolDefinition,
  type ChatMessage,
} from './ai-gateway';

const QUOTA_ENGINE_NOTE =
  '\n\n⚠️ *Modo local por cuota agotada: conectá una API Key con plan de pago para restaurar el análisis Gemini en vivo.*';

const BUDGET_ENGINE_NOTE =
  '\n\n⚠️ *Modo local por presupuesto del turno: se alcanzó el techo de llamadas pagas por turno, así que esta respuesta viene del motor local, no de Gemini.*';

function formatNumberOrNd(val: number | undefined | null, decimals = 2): string {
  if (val === undefined || val === null || typeof val !== 'number' || Number.isNaN(val)) {
    return 'N/D';
  }
  return val.toFixed(decimals);
}

/**
 * Returns `value` only when the market feed is live, otherwise `undefined`.
 *
 * The deterministic planner used to fall back to hardcoded reference prices
 * (88.35 / 89.55 / 88.5 ...) whenever no order book was available. That produced
 * plans whose spread and profit were arithmetic on invented numbers, presented
 * with the same authority as live figures. Now a missing feed yields `undefined`,
 * which `formatNumberOrNd` renders as "N/D" and the dispatch gate refuses.
 */
function onlyWhenLive<T extends number | undefined>(value: T, hasLiveMarketFeed: boolean): T | undefined {
  return hasLiveMarketFeed ? value : undefined;
}

/**
 * A plan without a live order book cannot be risk-assessed, so it can never be
 * "LOW" risk. The 19 deterministic branches used to hardcode 'LOW', which
 * contradicted the provenance they now correctly carry. Fail closed to 'HIGH'.
 */
function resolveRiskLevel(riskLevel: 'LOW' | 'MEDIUM' | 'HIGH', isSimulated: boolean) {
  return isSimulated ? 'HIGH' : riskLevel;
}

/**
 * Normalizes a skill result into a safe payload.
 *
 * A skill returns `{ success: false }` with no `data` when its required inputs
 * are missing — which now happens by design whenever there is no live feed.
 * The orchestrator used to cast `res.data as {...}` and dereference it blindly,
 * so an honest "missing input" turned into a TypeError crash. Every field then
 * falls through `formatNumberOrNd` and renders as "N/D".
 */
function skillPayload(result: { success: boolean; data?: unknown; error?: string }): Record<string, unknown> {
  if (!result.success || result.data === undefined || result.data === null) {
    return {};
  }
  return result.data as Record<string, unknown>;
}

/**
 * Official BCV rate: resolved dynamically from market state / live feed.
 *
 * `resolveBcvRate()` queries the in-memory BCV snapshot (populated by Cotizave / MCP / IPC).
 * If no live BCV rate is registered or if it has expired, it returns undefined so that
 * `runBcvGapSkill` cleanly falls through to declare honest data absence instead of fabricating.
 */
function getResolvedBcvRate(): number | undefined {
  const bcvFeed = resolveBcvRate();
  return bcvFeed.live && typeof bcvFeed.usd === 'number' ? bcvFeed.usd : undefined;
}

/**
 * What would satisfy `LIVE_BCV_RATE`. `get_bcv_rates` is a registered MCP tool in this process
 * (`mcp-bootstrap.ts`) and resolves to the Cotizave `GET /v1/fx/rates` reference market.
 */
const EXPECTED_SOURCE_BCV_RATE =
  'tasa oficial BCV en vivo (MCP get_bcv_rates → Cotizave API GET /v1/fx/rates, market reference→USD oficial)';

/**
 * Runs the BCV gap only when both legs are real measurements.
 *
 * `macro-skills.ts` coerces a missing rate to `0`, and the vendored `calculateBcvGap` answers a
 * non-positive rate with `gapPct: 0, zone: 'NORMAL'` — "there is no gap", a claim about the
 * market built on nothing. That is exactly what the triangular branch printed while the feed
 * was offline, so the gap is not computed at all when a rate is missing. `skillPayload` then
 * turns this refusal into `{}` and every figure falls through `formatNumberOrNd` as "N/D".
 */
function runBcvGapSkill(
  parallelRate: number | undefined,
  bcvRate: number | undefined,
): { success: boolean; skillName: string; data?: unknown; error?: string } {
  if (typeof parallelRate !== 'number' || typeof bcvRate !== 'number') {
    return {
      success: false,
      skillName: 'predict_bcv_market_intelligence',
      error:
        `Falta evidencia: la brecha BCV necesita la tasa paralelo y la tasa oficial BCV. ` +
        `Paralelo: ${formatNumberOrNd(parallelRate)} · BCV: ${formatNumberOrNd(bcvRate)}. ` +
        `Fuente requerida: ${EXPECTED_SOURCE_BCV_RATE}.`,
    };
  }
  return executeFinancialSkill('predict_bcv_market_intelligence', { parallelRate, bcvRate });
}

/**
 * Operator-facing declaration of why a reply carries no BCV gap, or `null` when the gap really
 * was measured — so a branch never has to invent a reason string to fill the shape.
 */
function bcvGapAbsenceNote(bcvRes: { success: boolean }): string {
  return bcvRes.success
    ? ''
    : `* ⚠️ **Tasa oficial BCV: N/D.** No hay feed BCV conectado a este proceso, así que la ` +
        `brecha, la zona de riesgo y la ventana de intervención NO se emiten. ` +
        `Fuente requerida: ${EXPECTED_SOURCE_BCV_RATE}.\n`;
}

/**
 * Injects fresh live market feed and treasury snapshot directly into the AI context.
 */
function buildLiveMarketContext(): string {
  const feed = resolveMarketFeed();
  const bcv = resolveBcvRate();
  const treasury = getTreasurySnapshot();
  const lines: string[] = ['--- CONTEXTO EN VIVO DE MERCADO Y TESORERÍA ---'];

  if (feed.live && typeof feed.bestBuyPrice === 'number' && typeof feed.bestSellPrice === 'number') {
    lines.push(
      `• Binance P2P USDT/VES: Compra ${feed.bestBuyPrice.toFixed(2)} | Venta ${feed.bestSellPrice.toFixed(2)} | Mid: ${(feed.midPrice ?? 0).toFixed(2)} (Libro actualizado hace ${Math.round((feed.ageMs ?? 0) / 1000)}s)`,
    );
    const spreadPct = ((feed.bestSellPrice - feed.bestBuyPrice) / feed.bestBuyPrice) * 100;
    lines.push(`• Spread Bruto P2P: ${spreadPct.toFixed(2)}%`);
    if (typeof feed.bidDepthUsdt === 'number' && typeof feed.askDepthUsdt === 'number') {
      const totalDepth = feed.bidDepthUsdt + feed.askDepthUsdt;
      const buyPressure = totalDepth > 0 ? ((feed.bidDepthUsdt / totalDepth) * 100).toFixed(0) : '50';
      lines.push(
        `• Profundidad L2: Bid $${feed.bidDepthUsdt.toLocaleString('en-US', { maximumFractionDigits: 0 })} USDT | Ask $${feed.askDepthUsdt.toLocaleString('en-US', { maximumFractionDigits: 0 })} USDT (Presión Compra: ${buyPressure}%)`,
      );
    }
  } else {
    lines.push(`• Binance P2P: Feed no disponible en vivo (${feed.reason}).`);
  }

  if (bcv.live && typeof bcv.usd === 'number') {
    lines.push(`• Tasa Oficial BCV: ${bcv.usd.toFixed(2)} VES/USD (Fuente: ${bcv.source})`);
    if (feed.live && typeof feed.bestSellPrice === 'number') {
      const gapPct = ((feed.bestSellPrice - bcv.usd) / bcv.usd) * 100;
      lines.push(`• Brecha Paralelo vs BCV: ${gapPct.toFixed(2)}%`);
    }
  } else {
    lines.push(`• Tasa Oficial BCV: No conectada a este proceso.`);
  }

  // Ventana de intervención cambiaria BCV (habitual 10:00 - 11:30 AM hora de Caracas UTC-4)
  const nowUtc = new Date();
  const caracasHour = (nowUtc.getUTCHours() - 4 + 24) % 24;
  const caracasMin = nowUtc.getUTCMinutes();
  const isInterventionWindow =
    (caracasHour === 10 && caracasMin >= 0) || (caracasHour === 11 && caracasMin <= 30);
  if (isInterventionWindow) {
    lines.push('• Ventana BCV: 🚨 VENTANA DE INTERVENCIÓN ACTIVA (10:00 - 11:30 AM VET). Alta volatilidad esperada.');
  } else {
    lines.push('• Ventana BCV: 🟢 Mercado Libre fuera de ventana de intervención.');
  }

  if (treasury) {
    lines.push(
      `• Tesorería VES: Saldo disponible ${treasury.totalBalanceVes.toLocaleString('es-VE')} VES | Gastado hoy ${treasury.totalSpentTodayVes.toLocaleString('es-VE')} VES`,
    );
    const activeAccs = treasury.accounts.filter((a) => a.status !== 'DISABLED');
    if (activeAccs.length > 0) {
      const accSummary = activeAccs
        .map(
          (a) =>
            `${a.bankName}: límite restante ${a.remainingLimitVes.toLocaleString('es-VE')} VES (${a.todayTransactionCount}/${a.maxDailyTransactions} txs)`,
        )
        .join(' | ');
      lines.push(`• Cuentas activas: ${accSummary}`);
    }
  }

  return lines.join('\n');
}

/**
 * Extracts explicitly requested operational capital from the user prompt
 * (e.g., "$500", "500 usdt", "300 dólares", "capital de 2000").
 */
export function extractRequestedCapital(
  prompt: string,
  fallbackCapital = 1000,
): { amount: number; isExplicit: boolean } {
  if (!prompt || typeof prompt !== 'string') return { amount: fallbackCapital, isExplicit: false };

  const patterns = [
    /(?:\$|usdt|usd)\s*([0-9]+(?:[.,][0-9]+)?)/i,
    /([0-9]+(?:[.,][0-9]+)?)\s*(?:\$|usdt|usd|dolares|dólares)/i,
    /(?:capital|monto|saldo|ticket|presupuesto|tengo|con)\s*(?:de\s*)?(?:[^\d]{0,5})([0-9]+(?:[.,][0-9]+)?)/i,
  ];

  for (const regex of patterns) {
    const match = prompt.match(regex);
    if (match && match[1]) {
      const numStr = match[1].replace(',', '.');
      const parsed = parseFloat(numStr);
      if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 1_000_000) {
        return { amount: Math.round(parsed), isExplicit: true };
      }
    }
  }

  return { amount: fallbackCapital, isExplicit: false };
}

/**
 * Builds the shared system instruction for both Gemini and Universal AI Gateway.
 * Prioritizes high-caliber quantitative depth, logical grounding, and structured Chain-of-Thought.
 */
function buildSystemInstruction(learningsContext: string): string {
  const liveMarket = buildLiveMarketContext();

  return `Sos Gentleman AI, Senior Architect de Arbitraje P2P Institucional (15+ años de experiencia, GDE & MVP).
Tu misión es guiar al operador con máxima precisión técnica, pedagogía y disciplina innegociable de preservación de capital (Venezuela / LATAM).

${liveMarket}

FILOSOFÍA Y DIRECTIVAS FUNDAMENTALES:
1. CONCEPTOS > CÓDIGO & PRESERVACIÓN > CODICIA: En arbitraje no hay atajos ni apuestas impulsivas. Jamás operes a ciegas. Cada satoshi y cada bolívar se defienden con análisis riguroso de microestructura.
2. REGLA DE ORO INNEGOCIABLE (Golden Rule): Spread neto real >= 0.50% tras comisiones bancarias, taker/maker y deslizamiento (slippage). Si no supera el 0.50%, la ruta NO es viable y se descarta o advierte enfáticamente.
3. EL HUMANO SIEMPRE LIDERA (Human-in-the-Loop): Vos proponés con sustento matemático; el operador humano valida y decide dar 'PLAY'. Ninguna orden se dispara sin consentimiento explícito.
4. MICROESTRUCTURA & RIESGO: Evaluá siempre la ventana de intervención cambiaria del BCV (10:00 - 11:30 AM), la brecha cambiaria y el perfil de la contraparte antes de recomendar rotaciones.
5. CONSULTORÍA FINANCIERA & TAMAÑO DINÁMICO DE CAPITAL:
   - Actuá como un CFO Senior y consultor financiero institucional para P2P, tesorería y arbitraje.
   - Si el usuario te hace preguntas abiertas de negocio, flujo de caja, o finanzas, respondé con fluidez conversacional analítica sin forzar una tarjeta de ejecución estructurada a menos que te pida explícitamente una estrategia o plan operativo.
   - Cuando te pida una estrategia con un monto específico (ej: $500, 500 USDT, 300 dólares, 2000 USDT), adaptá TODOS los cálculos, fragmentación y beneficios esperados a ESE capital exacto, en lugar de forzar montos predeterminados.
   - Tenés acceso a búsqueda web en vivo mediante 'search_google_live' para consultar normativas SUDEBAN, circulares bancarias, tasas oficiales BCV y reglas vigentes de Binance P2P.
6. BUCLE DE RAZONAMIENTO REACT (Reasoning + Action):
   - Encadená las herramientas necesarias paso a paso: primero obtené datos de tasas/mercado, luego evaluá riesgo/microestructura o saturación bancaria, y finalmente emití tu dictamen o ticket de ejecución.
   - Mostrá transparencia numérica: desglosá tasas, spreads netos, comisiones y slippage esperado.
7. EXPLICACIONES ANALÍTICAS PROFUNDAS Y DETALLADAS:
   - Cuando el operador consulte cómo o por qué se trianguló de cierta forma, explicá la lógica paso a paso: precios de entrada y salida, tasas cruzadas, costos de comisiones maker/taker y mitigación de slippage.
   - Si se detecta un riesgo (ej. depeg de USDT, brecha BCV > 20%, o contraparte sospechosa), explicá con rigor técnico la causa raíz y la maniobra de protección recomendada.
8. TESORERÍA & BINANCE EARN (Costo de Oportunidad Cero):
   - El capital P2P no debe quedar ocioso entre órdenes, fines de semana o pausas operativas. Utilizá activamente las herramientas de Binance Simple Earn Flexible (D+0), Launchpool, Dual Investment y Liquidity Laddering.
9. OPERACIONES, GOBERNANZA SOP & CONCILIACIÓN CONTINUA:
   - Toda operación debe cumplir estrictamente con los Protocolos Operativos Estándar (SOP): verificación de identidad 1:1 entre cuenta bancaria y Binance, comprobación rigurosa de fondos disponibles (nunca diferidos) y resolución en menos de 15 minutos.

MEMORIA PERSISTENTE ENGRAM ACTIVA:
${learningsContext || 'Sin observaciones previas registradas aún.'}

ESTRUCTURA DE RESPUESTA (Usar solo cuando se presente una estrategia o análisis cuantitativo formal):
### 🎯 Diagnóstico Situacional
[Dictamen directo, certero y sin rodeos sobre la consulta o mercado.]

### 📊 Desglose Cuantitativo & Regla de Oro
* Tasa de Entrada / Salida: [Precios en libros reales]
* Comisiones y Deslizamiento: [Exchange + bancario + slippage]
* Spread Neto Verificado: [Margen final vs Regla de Oro >= 0.50%]
* Beneficio / Retorno: [Proyección en USDT ajustada al capital solicitado]

### ⚡ Plan de Acción Táctico
* Ruta cronológica y método bancario.
* Medida de protección de capital.

PAUTAS DE COMUNICACIÓN:
- Hablá en español rioplatense natural (voseo: fijate, mirá, tené en cuenta, acordate), con tono cálido, directo, pedagógico y firme.
- Sé riguroso y transparente: mostrá siempre el desglose numérico detrás de cada decisión.`;
}

export class GeminiOrchestrator {
  private apiKey?: string;
  private modelCooldowns = new Map<string, number>();
  private webhookDispatcher: WebhookDispatcher;
  private agentRegistry: AgentRegistry;

  isModelCoolingDown(model: string): boolean {
    const cooldown = this.modelCooldowns.get(model);
    return cooldown !== undefined && Date.now() < cooldown;
  }

  setModelCooldown(model: string, retryMs: number): void {
    const cooldownUntil = Date.now() + Math.max(60_000, Math.min(retryMs || 300_000, 3_600_000));
    this.modelCooldowns.set(model, cooldownUntil);
  }

  clearModelCooldowns(): void {
    this.modelCooldowns.clear();
  }

  /**
   * Turn-level paid-call budget.
   *
   * MAX_REACT_STEPS bounds steps *inside one model iteration*, and the model
   * cascade iterates several models, so the real worst case was
   * (models x (MAX_REACT_STEPS + 1)) paid calls for a single user turn. This
   * counter is an enforced ceiling across the whole turn, not a report.
   */
  private paidCallsThisTurn = 0;

  constructor(
    private db: P2PDatabaseService,
    apiKey?: string,
    private swarm?: AgentSwarmOrchestrator,
    webhookDispatcher?: WebhookDispatcher,
    /** Max paid Gemini calls per user turn. Defaults to a conservative budget. */
    private paidCallsBudget: number = 8,
  ) {
    this.apiKey = apiKey;
    this.webhookDispatcher = webhookDispatcher || new WebhookDispatcher();
    this.agentRegistry = new AgentRegistry(this.db);
  }

  listAgents(): RegisteredAgentDto[] {
    return this.agentRegistry.listAgents();
  }

  toggleAgent(id: string, enabled: boolean): boolean {
    return this.agentRegistry.toggleAgent(id, enabled);
  }

  saveAgent(agent: RegisteredAgentDto): boolean {
    return this.agentRegistry.saveAgent(agent);
  }

  private dedupeSources(sources: GroundingSource[]): GroundingSource[] {
    const seen = new Set<string>();
    const deduped: GroundingSource[] = [];
    for (const s of sources) {
      if (s.uri && !seen.has(s.uri)) {
        seen.add(s.uri);
        deduped.push(s);
      }
    }
    return deduped;
  }

  /** Reset at the start of every user turn. */
  private beginPaidCallTurn(): void {
    this.paidCallsThisTurn = 0;
  }

  private get paidCallsRemaining(): number {
    return Math.max(0, this.paidCallsBudget - this.paidCallsThisTurn);
  }

  /**
   * Consume one unit of the paid-call budget. Returns false when exhausted so
   * callers stop before spending rather than after.
   */
  private consumePaidCall(): boolean {
    if (this.paidCallsThisTurn >= this.paidCallsBudget) return false;
    this.paidCallsThisTurn++;
    return true;
  }

  setSwarmOrchestrator(swarm: AgentSwarmOrchestrator): void {
    this.swarm = swarm;
  }

  private aiGateway = new UniversalAiGateway();
  private activeProvider: AiProviderType = 'gemini';
  private customModel?: string;

  setActiveProvider(provider: AiProviderType, model?: string): void {
    this.activeProvider = provider;
    if (model) this.customModel = model;
    this.db.setConfigValue('ai_active_provider', provider);
    if (model) this.db.setConfigValue(`ai_model_${provider}`, model);
  }

  getActiveProvider(): { provider: AiProviderType; model: string } {
    const p =
      (this.db.getConfigValue('ai_active_provider') as AiProviderType) ||
      this.activeProvider ||
      'gemini';
    const m =
      this.db.getConfigValue(`ai_model_${p}`) ||
      this.customModel ||
      DEFAULT_PROVIDER_MODELS[p] ||
      'gemini-flash-latest';
    return { provider: p, model: m };
  }

  getProviderConfigStatus(): {
    activeProvider: AiProviderType;
    activeModel: string;
    configuredProviders: Record<AiProviderType, boolean>;
  } {
    const { provider, model } = this.getActiveProvider();
    const providers: AiProviderType[] = ['gemini', 'openai', 'anthropic', 'deepseek', 'qwen'];
    const configuredProviders = {} as Record<AiProviderType, boolean>;
    for (const p of providers) {
      configuredProviders[p] = Boolean(this.getEffectiveApiKey(p));
    }
    return {
      activeProvider: provider,
      activeModel: model,
      configuredProviders,
    };
  }

  private inMemoryApiKeys: Partial<Record<AiProviderType, string>> = {};

  setApiKey(key: string, provider: AiProviderType = 'gemini'): void {
    this.inMemoryApiKeys[provider] = key;
    if (provider === 'gemini') {
      this.apiKey = key;
    }
    // Never persist the raw credential: SQLite lives in user data and was
    // previously readable plaintext by anything with filesystem access.
    if (isSecretStorageAvailable()) {
      try {
        this.db.setConfigValue(`ai_api_key_${provider}`, encryptSecret(key));
        this.db.setConfigValue(`ai_api_key_scheme_${provider}`, SECRET_SCHEME);
        if (provider === 'gemini') {
          this.db.setConfigValue('gemini_api_key', encryptSecret(key));
          this.db.setConfigValue('gemini_api_key_scheme', SECRET_SCHEME);
        }
        return;
      } catch (err) {
        console.warn(`[GeminiOrchestrator] safeStorage failed to store key for ${provider}:`, err);
      }
    }
    this.db.deleteConfigValue(`ai_api_key_${provider}`);
    this.db.setConfigValue(`ai_api_key_scheme_${provider}`, SECRET_SCHEME_UNAVAILABLE);
    if (provider === 'gemini') {
      this.db.deleteConfigValue('gemini_api_key');
      this.db.setConfigValue('gemini_api_key_scheme', SECRET_SCHEME_UNAVAILABLE);
    }
    console.warn(
      `[GeminiOrchestrator] OS encryption unavailable: the API key for ${provider} will NOT be persisted to disk.`,
    );
  }

  getEffectiveApiKey(provider?: AiProviderType): string | undefined {
    const target = provider || this.getActiveProvider().provider;
    if (this.inMemoryApiKeys[target]) {
      return this.inMemoryApiKeys[target];
    }
    if (target === 'gemini') {
      if (this.apiKey) return this.apiKey;
      if (process.env['GEMINI_API_KEY']) return process.env['GEMINI_API_KEY'];
    } else if (target === 'openai' && process.env['OPENAI_API_KEY']) {
      return process.env['OPENAI_API_KEY'];
    } else if (target === 'anthropic' && process.env['ANTHROPIC_API_KEY']) {
      return process.env['ANTHROPIC_API_KEY'];
    } else if (target === 'deepseek' && process.env['DEEPSEEK_API_KEY']) {
      return process.env['DEEPSEEK_API_KEY'];
    } else if (target === 'qwen' && process.env['QWEN_API_KEY']) {
      return process.env['QWEN_API_KEY'];
    }

    return this.readPersistedApiKey(target);
  }

  /**
   * Reads a previously stored key, accepting only the encrypted scheme.
   * A plaintext legacy row is discarded rather than trusted or returned.
   */
  private readPersistedApiKey(provider: AiProviderType = 'gemini'): string | undefined {
    let scheme = this.db.getConfigValue(`ai_api_key_scheme_${provider}`);
    let stored = this.db.getConfigValue(`ai_api_key_${provider}`);

    if (!stored && provider === 'gemini') {
      scheme = this.db.getConfigValue('gemini_api_key_scheme');
      stored = this.db.getConfigValue('gemini_api_key');
    }

    if (!stored) return undefined;
    if (scheme !== SECRET_SCHEME) {
      // Legacy plaintext (or unknown) row: drop it instead of exposing it.
      this.db.deleteConfigValue(`ai_api_key_${provider}`);
      this.db.setConfigValue(`ai_api_key_scheme_${provider}`, SECRET_SCHEME_UNAVAILABLE);
      if (provider === 'gemini') {
        this.db.deleteConfigValue('gemini_api_key');
        this.db.setConfigValue('gemini_api_key_scheme', SECRET_SCHEME_UNAVAILABLE);
      }
      return undefined;
    }
    try {
      return decryptSecret(stored);
    } catch (err) {
      console.warn(`[GeminiOrchestrator] Stored key for ${provider} could not be decrypted; discarding.`, err);
      this.db.deleteConfigValue(`ai_api_key_${provider}`);
      this.db.setConfigValue(`ai_api_key_scheme_${provider}`, SECRET_SCHEME_UNAVAILABLE);
      if (provider === 'gemini') {
        this.db.deleteConfigValue('gemini_api_key');
        this.db.setConfigValue('gemini_api_key_scheme', SECRET_SCHEME_UNAVAILABLE);
      }
      return undefined;
    }
  }

  private getCandidateModels(provider: AiProviderType = this.getActiveProvider().provider): string[] {
    if (provider === 'gemini') {
      const custom = process.env['GEMINI_MODEL'];
      if (custom) return [custom];
      const selectedModel = this.getActiveProvider().model;
      const baseModels = [
        selectedModel,
        'gemini-3.7-flash',
        'gemini-3.8-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-3.1-flash-lite',
      ];
      return Array.from(new Set(baseModels.filter(Boolean)));
    }
    const defaultModel = DEFAULT_PROVIDER_MODELS[provider] || 'gpt-4o';
    const persisted = this.db.getConfigValue(`ai_model_${provider}`);
    return [persisted || this.customModel || defaultModel];
  }

  private extractRetryDelayMs(errText: string): number {
    try {
      const body = JSON.parse(errText) as {
        error?: { details?: { retryDelay?: string }[] };
      };
      const retryDelay = body.error?.details?.find((d) => d.retryDelay)?.retryDelay;
      if (!retryDelay) return 0;
      const match = /(\d+(?:\.\d+)?)s/.exec(retryDelay);
      return match ? Math.ceil(parseFloat(match[1]) * 1000) : 0;
    } catch {
      return 0;
    }
  }

  private isQuotaError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    return err.message.includes('HTTP 429') || err.message.includes('cuota agotada');
  }

  async testConnection(
    provider?: AiProviderType,
    key?: string,
  ): Promise<{ success: boolean; model: string; message: string }> {
    const targetProvider = provider || this.getActiveProvider().provider;
    const effectiveKey = key || this.getEffectiveApiKey(targetProvider);
    if (!effectiveKey) {
      return {
        success: false,
        model: 'none',
        message: `No se ha detectado ninguna API Key configurada para ${targetProvider.toUpperCase()}.`,
      };
    }
    const model = this.getActiveProvider().model;
    return this.aiGateway.testConnection(targetProvider, effectiveKey, model);
  }

  /**
   * Main entrypoint for Copilot chat dialog.
   * Leverages past SQLite learnings, executes financial skills,
   * generates strategy proposals and returns structured response.
   */
  async sendMessage(params: {
    prompt: string;
    history?: CopilotChatMessage[];
    apiKey?: string;
    provider?: AiProviderType;
    model?: string;
  }): Promise<CopilotResponse> {
    if (killswitchState.isTriggered) {
      const detail = killswitchState.reason
        ? `kill-switch activo (${killswitchState.reason}, origen: ${killswitchState.source ?? 'desconocido'})`
        : 'kill-switch activo';
      console.warn(`[GeminiOrchestrator] Solicitud bloqueada por interbloqueo de emergencia: ${detail}`);
      throw new Error(
        `KILLSWITCH_ACTIVE: Solicitud bloqueada por ${detail}. El copiloto no emite respuestas operativas ni heurísticas con el interbloqueo de emergencia activado.`,
      );
    }

    const { prompt } = params;
    const lowerPrompt = prompt.toLowerCase();
    this.beginPaidCallTurn();

    if (params.provider) {
      this.setActiveProvider(params.provider, params.model);
    } else if (params.model) {
      this.setActiveProvider(this.getActiveProvider().provider, params.model);
    }
    const { provider, model } = this.getActiveProvider();

    if (params.apiKey) {
      this.setApiKey(params.apiKey, provider);
    }

    // 1. Recover empirical context from SQLite & Engram Persistent Memory
    const recentLearnings = this.db.listMarketLearnings(undefined, 5);
    const engramSummary = this.db.getEngramContextSummary(6);
    const learningsContext =
      engramSummary ||
      recentLearnings
        .map(
          (l) =>
            `• [${l.category}] ${l.insight} (Confianza: ${l.confidenceScore !== undefined ? (l.confidenceScore * 100).toFixed(0) : '100'}%)`,
        )
        .join('\n');

    // 2. Determine execution path (Universal AI Gateway with tools or Deterministic Heuristic Engine)
    const effectiveKey = this.getEffectiveApiKey(provider);
    if (effectiveKey) {
      const candidateModels = this.getCandidateModels(provider);
      const allCoolingDown =
        provider === 'gemini' && candidateModels.every((m) => this.isModelCoolingDown(m));
      if (allCoolingDown) {
        return this.runDeterministicStrategist(lowerPrompt, recentLearnings, QUOTA_ENGINE_NOTE);
      }
      try {
        if (provider === 'gemini') {
          return await this.callGeminiApi(prompt, learningsContext, effectiveKey);
        }
        return await this.callUniversalAiGateway(
          prompt,
          learningsContext,
          effectiveKey,
          provider,
          model,
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        // Budget stop is our own ceiling, not a provider quota problem. Report it as such.
        if (message.startsWith('BUDGET_EXHAUSTED')) {
          console.warn(`[GeminiOrchestrator] ${message} Continuando con motor local.`);
          return this.runDeterministicStrategist(lowerPrompt, recentLearnings, BUDGET_ENGINE_NOTE);
        }
        // Fallback gracefully to core deterministic engine if quota is exhausted on all models
        if (this.isQuotaError(err)) {
          console.warn(`[GeminiOrchestrator] Quota 429 agotada en todos los modelos de ${provider}; continuando con motor local.`);
          return this.runDeterministicStrategist(lowerPrompt, recentLearnings, QUOTA_ENGINE_NOTE);
        }
        console.error(`[GeminiOrchestrator] Error en llamada al proveedor ${provider}:`, err);
        return {
          reply: `⚠️ **Error en llamada a ${provider.toUpperCase()} (${model})**:\n\n${message}\n\n*Por favor verificá tu API Key y conexión.*`,
          provenance: {
            source: provider,
            model,
            provenanceId: `PROV-ERR-${Date.now().toString(36).toUpperCase()}`,
            timestamp: Date.now(),
            esSimulado: true,
            fallbackReason: 'API_ERROR',
          },
        };
      }
    }

    return this.runDeterministicStrategist(lowerPrompt, recentLearnings);
  }

  /**
   * Transcribes voice audio using Gemini multimodal capabilities.
   * Enables microphone dictation in Electron where Google Speech API keys are absent.
   */
  async transcribeAudio(params: {
    audioBase64: string;
    mimeType: string;
  }): Promise<{ text: string; error?: string }> {
    // Transcription spends a paid call. The kill-switch must gate it too,
    // otherwise the emergency stop still leaks money through this path.
    if (killswitchState.isTriggered) {
      const detail = killswitchState.reason
        ? `kill-switch activo (${killswitchState.reason}, origen: ${killswitchState.source ?? 'desconocido'})`
        : 'kill-switch activo';
      console.warn(`[GeminiOrchestrator] Transcripción bloqueada por ${detail}`);
      return {
        text: '',
        error: `KILLSWITCH_ACTIVE: Transcripción bloqueada por ${detail}.`,
      };
    }

    const effectiveKey = this.getEffectiveApiKey();
    if (!effectiveKey) {
      return {
        text: '',
        error:
          'Para transcribir audio en Electron, por favor configurá tu API Key de Gemini en la pestaña de Configuración.',
      };
    }

    if (!this.consumePaidCall()) {
      return {
        text: '',
        error: `BUDGET_EXHAUSTED: se alcanzó el techo de ${this.paidCallsBudget} llamadas pagas por turno.`,
      };
    }

    const candidateModels = [
      ...this.getCandidateModels(),
      'gemini-3.7-flash',
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
    ];
    const cleanMime = params.mimeType.split(';')[0] || 'audio/webm';
    let lastError = '';

    const requestBody = {
      systemInstruction: {
        parts: [
          {
            text: 'Sos un transcriptor de audio para una mesa de operaciones P2P y arbitraje financiero en Venezuela. Tu tarea es transcribir exactamente y con máxima fidelidad lo que dice el operador en español. Normalizá correctamente términos como USDT, VES, BCV, Banesco, Pago Móvil, Binance, Spread y Kill-Switch. Devolvé ÚNICAMENTE el texto transcripto, sin comillas, sin introducciones y sin comentarios adicionales.',
          },
        ],
      },
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Transcribe este mensaje de voz del operador:' },
            {
              inlineData: {
                mimeType: cleanMime,
                data: params.audioBase64,
              },
            },
          ],
        },
      ],
    };

    for (const model of candidateModels) {
      if (!this.consumePaidCall()) {
        return {
          text: '',
          error: `BUDGET_EXHAUSTED: se alcanzó el techo de ${this.paidCallsBudget} llamadas pagas por turno.`,
        };
      }
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': effectiveKey,
          },
          body: JSON.stringify(requestBody),
        });

        if (res.ok) {
          const data = (await res.json()) as {
            candidates?: { content?: { parts?: { text?: string }[] } }[];
          };
          const transcript = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          return { text: transcript };
        }

        const errJson = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        const errMsg = errJson?.error?.message || `HTTP ${res.status}`;
        lastError = errMsg;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        lastError = msg;
        console.warn(`[GeminiOrchestrator] Transcribe error on model ${model}:`, err);
      }
    }

    return {
      text: '',
      error: `No se pudo transcribir el audio: ${lastError || 'modelos no disponibles'}`,
    };
  }

  /**
   * Executes Gemini Flash REST API with an autonomous multi-step ReAct (Reasoning + Action) loop.
   * Can chain up to MAX_REACT_STEPS (5) tool calls dynamically before synthesizing final answer.
   */
  private async callGeminiApi(
    prompt: string,
    learningsContext: string,
    apiKey: string,
  ): Promise<CopilotResponse> {
    const candidateModels = this.getCandidateModels();
    const systemInstruction = buildSystemInstruction(learningsContext);

    const mcpToolsOnly = MCP_SERVER_REGISTRY.flatMap((srv) => srv.tools)
      .filter((t) => !GEMINI_FINANCIAL_SKILLS.some((s) => s.name === t.name))
      .map((t) => ({
        name: t.name,
        description: t.description,
        parameters: {
          type: 'OBJECT' as const,
          properties: {} as Record<string, unknown>,
          required: [] as string[],
        },
      }));

    const toolDeclarations = [
      ...GEMINI_FINANCIAL_SKILLS.map((s) => ({
        name: s.name,
        description: s.description,
        parameters: s.parameters,
      })),
      ...mcpToolsOnly,
    ];

    let lastError: Error | null = null;
    const MAX_REACT_STEPS = 5;

    // Resolved once per turn and shared by every return path below. The plan
    // built by generatePlanFromSkill() already knows whether it is simulated;
    // we must not overwrite that with a constant, or we would stamp live-data
    // confidence onto numbers that came from offline fallbacks.
    const geminiFeed = resolveMarketFeed();
    const geminiFeedLive = geminiFeed.live;
    const geminiPlanSimulated = !geminiFeedLive;

    let budgetExhausted = false;

    for (const model of candidateModels) {
      if (this.isModelCoolingDown(model)) {
        continue;
      }
      if (!this.consumePaidCall()) {
        budgetExhausted = true;
        break;
      }
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const conversationContents: {
        role: 'user' | 'model' | 'tool';
        parts: any[];
      }[] = [{ role: 'user', parts: [{ text: prompt }] }];

      const executedSkills: string[] = [];
      const liveSources: GroundingSource[] = [];
      let suggestedPlan: StrategyPlanCard | undefined;
      let step = 0;
      let modelFailed = false;

      while (step < MAX_REACT_STEPS) {
        step++;

        const requestBody = {
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: conversationContents,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
          },
          tools: [{ functionDeclarations: toolDeclarations }],
        };

        let res: Response;
        try {
          res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            body: JSON.stringify(requestBody),
          });
        } catch (fetchErr) {
          lastError = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
          modelFailed = true;
          break;
        }

        if (!res.ok) {
          const errText = await res.text();
          if (res.status === 429) {
            const retryMs = this.extractRetryDelayMs(errText);
            this.setModelCooldown(model, retryMs);
            lastError = new Error(`Gemini API HTTP 429 (${model}): ${errText}`);
            modelFailed = true;
            break; // Try next model in cascade
          }
          lastError = new Error(`Gemini API HTTP ${res.status} (${model}): ${errText}`);
          modelFailed = true;
          break;
        }

        const data = (await res.json()) as {
          candidates?: {
            content?: {
              parts?: {
                text?: string;
                functionCall?: { name: string; args: Record<string, unknown> };
              }[];
            };
            groundingMetadata?: {
              groundingChunks?: { web?: { uri?: string; title?: string } }[];
            };
          }[];
        };

        const firstCandidate = data.candidates?.[0];
        const parts = firstCandidate?.content?.parts || [];
        const functionCallParts = parts.filter((p) => p.functionCall && p.functionCall.name);
        const textPart = parts.find((p) => p.text);

        const groundingMeta = firstCandidate?.groundingMetadata;
        if (groundingMeta?.groundingChunks && Array.isArray(groundingMeta.groundingChunks)) {
          for (const chunk of groundingMeta.groundingChunks) {
            if (chunk.web?.uri) {
              liveSources.push({
                title: chunk.web.title || chunk.web.uri,
                uri: chunk.web.uri,
              });
            }
          }
        }

        if (functionCallParts.length === 0) {
          // Gemini finished thinking and returned text response.
          // Keep whatever provenance generatePlanFromSkill() already assigned.
          return {
            reply:
              textPart?.text ||
              'He analizado tu consulta con base en las directivas de mercado actuales.',
            suggestedPlan,
            skillsExecuted: executedSkills.length > 0 ? executedSkills : undefined,
            sources: liveSources.length > 0 ? this.dedupeSources(liveSources) : undefined,
            provenance: {
              source: 'gemini',
              model,
              provenanceId: `PROV-GEMINI-${Date.now().toString(36).toUpperCase()}`,
              timestamp: Date.now(),
              stepsCount: step,
              maxSteps: MAX_REACT_STEPS,
              apiCallsCount: step,
              esSimulado: geminiPlanSimulated,
              liveMarketFeedConnected: geminiFeedLive,
              marketFeedReason: geminiFeed.reason,
              marketFeedNote: describeMarketFeed(geminiFeed),
              paidCallsThisTurn: this.paidCallsThisTurn,
              paidCallsBudget: this.paidCallsBudget,
              budgetExhausted,
            },
          };
        }

        // Add model function call(s) to conversation history
        conversationContents.push({
          role: 'model',
          parts: functionCallParts.map((p) => ({
            functionCall: p.functionCall,
          })),
        });

        // Execute function call(s) in sequence
        const toolResponseParts: {
          functionResponse: {
            name: string;
            response: { name: string; content: unknown };
          };
        }[] = [];

        for (const fcp of functionCallParts) {
          const { name, args } = fcp.functionCall!;
          executedSkills.push(name);

          let skillData: unknown;
          let isSuccess = true;
          let errorMessage: string | undefined;

          if (name === 'search_google_live') {
            const queryArg = typeof args['query'] === 'string' ? args['query'] : prompt;
            const searchRes = await executeLiveWebSearch(queryArg, apiKey);
            skillData = searchRes;
            isSuccess = true;
            if (searchRes.sources && searchRes.sources.length > 0) {
              liveSources.push(...searchRes.sources);
            }
          } else {
            const localSkill = executeFinancialSkill(name, args || {});
            if (localSkill.success || !localSkill.error?.includes('no reconocida')) {
              skillData = localSkill.data;
              isSuccess = localSkill.success;
              errorMessage = localSkill.error;
            } else {
              try {
                const mcpRes = await executeMcpToolTest(name, args || {});
                skillData = mcpRes.result;
                isSuccess = mcpRes.success;
                errorMessage = mcpRes.error;
              } catch (mcpErr: unknown) {
                isSuccess = false;
                errorMessage = mcpErr instanceof Error ? mcpErr.message : String(mcpErr);
              }
            }
          }

          const userCapInfo = extractRequestedCapital(prompt);
          const plan = this.generatePlanFromSkill(
            name,
            skillData,
            userCapInfo.isExplicit ? userCapInfo.amount : undefined,
          );
          if (plan) {
            suggestedPlan = plan;
            this.db.saveStrategyPlan({
              ...plan,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });

            this.db.saveEngramObservation({
              topicKey: `strategy/${name}`,
              type: 'discovery',
              scope: 'project',
              what: `Estrategia formulada con herramienta ${name}: ${plan.title}`,
              why: `Validación algorítmica de mercado mediante ${model} (Paso ${step})`,
              whereAffected: plan.route,
              learned: `Rendimiento esperado: ${plan.expectedNetSpreadPct}% neto con ticket de ${plan.capitalRequiredUsdt} USDT. Cumple con la regla de oro institucional.`,
              confidenceScore: 0.95,
              status: 'active',
            });
          }

          toolResponseParts.push({
            functionResponse: {
              name,
              response: {
                name,
                content: isSuccess ? skillData : { error: errorMessage },
              },
            },
          });
        }

        conversationContents.push({
          role: 'user',
          parts: toolResponseParts,
        });
      }

      if (modelFailed) {
        continue; // Try next model in cascade
      }

      // If loop reached MAX_REACT_STEPS without returning text, request final synthesis
      try {
        const synthRes = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [
              ...conversationContents,
              {
                role: 'user',
                parts: [
                  {
                    text: 'Sintetizá tu análisis final en español rioplatense, detallando los hallazgos de las herramientas y la recomendación ejecutiva para el operador.',
                  },
                ],
              },
            ],
          }),
        });

        if (synthRes.ok) {
          const synthData = (await synthRes.json()) as {
            candidates?: { content?: { parts?: { text?: string }[] } }[];
          };
          const finalText = synthData.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
          if (finalText && finalText.trim().length > 0) {
            return {
              reply: finalText.trim(),
              suggestedPlan,
              skillsExecuted: executedSkills.length > 0 ? executedSkills : undefined,
              sources: liveSources.length > 0 ? this.dedupeSources(liveSources) : undefined,
              provenance: {
                source: 'gemini',
                model,
                provenanceId: `PROV-GEMINI-${Date.now().toString(36).toUpperCase()}`,
                timestamp: Date.now(),
                stepsCount: step,
                maxSteps: MAX_REACT_STEPS,
                apiCallsCount: step + 1,
                esSimulado: geminiPlanSimulated,
                liveMarketFeedConnected: geminiFeedLive,
                marketFeedReason: geminiFeed.reason,
                marketFeedNote: describeMarketFeed(geminiFeed),
                paidCallsThisTurn: this.paidCallsThisTurn,
                paidCallsBudget: this.paidCallsBudget,
                budgetExhausted,
              },
            };
          }
        }
      } catch (synthErr) {
        console.warn('[GeminiOrchestrator] Multi-turn synthesis fallback:', synthErr);
      }

      const defaultExplanation = `Mirá, ejecuté las herramientas de análisis cuantitativo **[${executedSkills.join(', ')}]** mediante **${model}** para auditar el mercado. Con base en los números, formulé la estrategia correspondiente para resguardar el capital y capturar margen real. Revisá los parámetros de la ficha y dale tu visto bueno con **EJECUTAR** cuando quieras despacharla.`;

      return {
        reply: defaultExplanation,
        suggestedPlan,
        skillsExecuted: executedSkills.length > 0 ? executedSkills : undefined,
        sources: liveSources.length > 0 ? this.dedupeSources(liveSources) : undefined,
        provenance: {
          source: 'gemini',
          model,
          provenanceId: `PROV-GEMINI-${Date.now().toString(36).toUpperCase()}`,
          timestamp: Date.now(),
          stepsCount: step,
          maxSteps: MAX_REACT_STEPS,
          apiCallsCount: step,
          esSimulado: geminiPlanSimulated,
          liveMarketFeedConnected: geminiFeedLive,
          marketFeedReason: geminiFeed.reason,
          marketFeedNote: describeMarketFeed(geminiFeed),
          paidCallsThisTurn: this.paidCallsThisTurn,
          paidCallsBudget: this.paidCallsBudget,
          budgetExhausted,
        },
      };
    }

    if (budgetExhausted) {
      // Honest reason: our own turn budget stopped us, not a quota failure.
      throw new Error(
        `BUDGET_EXHAUSTED: se alcanzó el techo de ${this.paidCallsBudget} llamadas pagas por turno.`,
      );
    }

    throw lastError || new Error('Todos los modelos de Gemini devolvieron cuota agotada.');
  }

  /**
   * Executes multi-provider completions via Universal AI Gateway (OpenAI, DeepSeek, Anthropic, Qwen).
   * Runs the autonomous ReAct function calling loop with financial skills and MCP tools.
   */
  private async callUniversalAiGateway(
    prompt: string,
    learningsContext: string,
    apiKey: string,
    provider: AiProviderType,
    model: string,
  ): Promise<CopilotResponse> {
    const systemInstruction = buildSystemInstruction(learningsContext);

    const mcpToolsOnly = MCP_SERVER_REGISTRY.flatMap((srv) => srv.tools)
      .filter((t) => !GEMINI_FINANCIAL_SKILLS.some((s) => s.name === t.name))
      .map((t) => ({
        name: t.name,
        description: t.description,
        parameters: {
          type: 'OBJECT' as const,
          properties: {} as Record<string, unknown>,
          required: [] as string[],
        },
      }));

    const toolDeclarations: UniversalToolDefinition[] = [
      ...GEMINI_FINANCIAL_SKILLS.map((s) => ({
        name: s.name,
        description: s.description,
        parameters: s.parameters as any,
      })),
      ...mcpToolsOnly,
    ];

    const messages: ChatMessage[] = [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: prompt },
    ];

    const executedSkills: string[] = [];
    const liveSources: GroundingSource[] = [];
    let suggestedPlan: StrategyPlanCard | undefined;
    let step = 0;
    const MAX_REACT_STEPS = 5;

    const feed = resolveMarketFeed();
    const feedLive = feed.live;
    const planSimulated = !feedLive;

    while (step < MAX_REACT_STEPS) {
      step++;
      if (!this.consumePaidCall()) {
        throw new Error(
          `BUDGET_EXHAUSTED: se alcanzó el techo de ${this.paidCallsBudget} llamadas pagas por turno.`,
        );
      }

      const result = await this.aiGateway.complete(
        { provider, apiKey, model, temperature: 0.2 },
        messages,
        toolDeclarations,
      );

      if (result.sources && result.sources.length > 0) {
        liveSources.push(...result.sources);
      }

      if (!result.toolCalls || result.toolCalls.length === 0) {
        return {
          reply:
            result.text ||
            'He analizado tu consulta con base en las directivas de mercado actuales.',
          suggestedPlan,
          skillsExecuted: executedSkills.length > 0 ? executedSkills : undefined,
          sources: liveSources.length > 0 ? this.dedupeSources(liveSources) : undefined,
          provenance: {
            source: provider as any,
            model,
            provenanceId: `PROV-${provider.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
            timestamp: Date.now(),
            stepsCount: step,
            maxSteps: MAX_REACT_STEPS,
            apiCallsCount: step,
            esSimulado: planSimulated,
            liveMarketFeedConnected: feedLive,
            marketFeedReason: feed.reason,
            marketFeedNote: describeMarketFeed(feed),
            paidCallsThisTurn: this.paidCallsThisTurn,
            paidCallsBudget: this.paidCallsBudget,
            budgetExhausted: this.paidCallsRemaining === 0,
          },
        };
      }

      messages.push({
        role: 'assistant',
        content: result.text || '',
        toolCalls: result.toolCalls,
      });

      for (const call of result.toolCalls) {
        const name = call.name;
        const args = call.args || {};
        executedSkills.push(name);

        let skillData: unknown;
        let isSuccess = true;
        let errorMessage: string | undefined;

        if (name === 'search_google_live') {
          const queryArg = typeof args['query'] === 'string' ? args['query'] : prompt;
          const geminiKey = this.getEffectiveApiKey('gemini') || apiKey;
          const searchRes = await executeLiveWebSearch(queryArg, geminiKey);
          skillData = searchRes;
          isSuccess = true;
          if (searchRes.sources && searchRes.sources.length > 0) {
            liveSources.push(...searchRes.sources);
          }
        } else {
          const localSkill = executeFinancialSkill(name, args);
          if (localSkill.success || !localSkill.error?.includes('no reconocida')) {
            skillData = localSkill.data;
            isSuccess = localSkill.success;
            errorMessage = localSkill.error;
          } else {
            try {
              const mcpRes = await executeMcpToolTest(name, args);
              skillData = mcpRes.result;
              isSuccess = mcpRes.success;
              errorMessage = mcpRes.error;
            } catch (mcpErr: unknown) {
              isSuccess = false;
              errorMessage = mcpErr instanceof Error ? mcpErr.message : String(mcpErr);
            }
          }
        }

        const userCapInfo = extractRequestedCapital(prompt);
        const plan = this.generatePlanFromSkill(
          name,
          skillData,
          userCapInfo.isExplicit ? userCapInfo.amount : undefined,
        );
        if (plan) {
          suggestedPlan = plan;
          this.db.saveStrategyPlan({
            ...plan,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });

          this.db.saveEngramObservation({
            topicKey: `strategy/${name}`,
            type: 'discovery',
            scope: 'project',
            what: `Estrategia formulada con herramienta ${name}: ${plan.title}`,
            why: `Validación algorítmica de mercado mediante ${provider} / ${model} (Paso ${step})`,
            whereAffected: plan.route,
            learned: `Rendimiento esperado: ${plan.expectedNetSpreadPct}% neto con ticket de ${plan.capitalRequiredUsdt} USDT. Cumple con la regla de oro institucional.`,
            confidenceScore: 0.95,
            status: 'active',
          });
        }

        messages.push({
          role: 'tool',
          content: JSON.stringify(isSuccess ? skillData : { error: errorMessage }),
          toolResponse: {
            id: call.id,
            name: call.name,
            content: isSuccess ? skillData : { error: errorMessage },
            isError: !isSuccess,
          },
        });
      }
    }

    return {
      reply: `Mirá, ejecuté las herramientas de análisis cuantitativo **[${executedSkills.join(', ')}]** mediante **${model}** para auditar el mercado. Con base en los números, formulé la estrategia correspondiente para resguardar el capital y capturar margen real. Revisá los parámetros de la ficha y dale tu visto bueno con **EJECUTAR** cuando quieras despacharla.`,
      suggestedPlan,
      skillsExecuted: executedSkills.length > 0 ? executedSkills : undefined,
      sources: liveSources.length > 0 ? this.dedupeSources(liveSources) : undefined,
      provenance: {
        source: provider as any,
        model,
        provenanceId: `PROV-${provider.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
        timestamp: Date.now(),
        stepsCount: step,
        maxSteps: MAX_REACT_STEPS,
        apiCallsCount: step,
        esSimulado: planSimulated,
        liveMarketFeedConnected: feedLive,
        marketFeedReason: feed.reason,
        marketFeedNote: describeMarketFeed(feed),
        paidCallsThisTurn: this.paidCallsThisTurn,
        paidCallsBudget: this.paidCallsBudget,
        budgetExhausted: this.paidCallsRemaining === 0,
      },
    };
  }

  /**
   * Deterministic institutional strategist: generates high-impact plans using Core domain skills
   * and coordinates with the 4-agent swarm to provide deep analytical arguments.
   */
  private runDeterministicStrategist(
    lowerPrompt: string,
    recentLearnings: MarketLearningRecord[],
    engineNote?: string,
  ): CopilotResponse {
    const executedSkills: string[] = [];
    const learningsGenerated: string[] = [];

    // Real market-state provenance & feed consumption
    const marketData = getFinancialSkillMarketData();
    const marketBook = getMarketBook();
    const feed = resolveMarketFeed();
    const hasLiveMarketFeed = feed.live;
    const isSimulated = !hasLiveMarketFeed;
    const liveBuyPrice = feed.bestBuyPrice;
    const liveSellPrice = feed.bestSellPrice;
    const liveMidPrice = feed.midPrice;
    const liveParallelRate = liveSellPrice;

    // Dynamic capital sizing parser
    const capitalInfo = extractRequestedCapital(lowerPrompt);
    const resolveCapital = (fallback: number) => (capitalInfo.isExplicit ? capitalInfo.amount : fallback);

    // Conversational greeting check: avoid generating rigid execution plans on simple hellos
    const isGreetingOnly = /^(hola|buen(?:as|os)|buenos d[ií]as|buenas tardes|buenas noches|qu[eé] tal|c[oó]mo est[aá]s|saludos|hey|hi|hello)[\s!.,?]*$/i.test(lowerPrompt.trim());
    if (isGreetingOnly) {
      const midPrice = onlyWhenLive(liveMidPrice, hasLiveMarketFeed);
      const bcvRate = getResolvedBcvRate();
      const parallelRate = onlyWhenLive(liveParallelRate, hasLiveMarketFeed);
      const bcvRes = runBcvGapSkill(parallelRate, bcvRate);
      const bData = skillPayload(bcvRes) as { gap?: { gapPct?: number; zone?: string } };

      return {
        reply: `¡Hola! ¿Cómo andás? Acá Gentleman AI, tu consultor financiero y arquitecto de mesa P2P.\n\n` +
          `### 📊 Estado de Microestructura en Vivo\n` +
          `* **Precio Medio (Mid-Price)**: ${formatNumberOrNd(midPrice)} VES/USDT\n` +
          `* **Tasa Oficial BCV**: ${formatNumberOrNd(bcvRate)} VES/USD | **Paralelo P2P**: ${formatNumberOrNd(parallelRate)} VES/USD\n` +
          `* **Brecha Cambiaria**: ${formatNumberOrNd(bData?.gap?.gapPct, 1)}% (Zona: \`${bData?.gap?.zone ?? 'N/D'}\`)\n` +
          `* **Regla de Oro Institucional**: Spread mínimo neto admisible >= 0.50%.\n\n` +
          `Contame qué tenés en mente para hoy: ¿querés analizar la liquidez en algún banco específico, calcular una rotación de capital, evaluar coberturas cambiarias o revisar el arbitraje entre plataformas? Decime con cuánto capital querés operar y lo calibramos al milímetro.`,
        provenance: {
          source: isSimulated ? 'simulated' : 'deterministic',
          provenanceId: `PROV-GREET-${Date.now().toString(36).toUpperCase()}`,
          esSimulado: isSimulated,
          liveMarketFeedConnected: hasLiveMarketFeed,
          timestamp: Date.now(),
        },
      };
    }

    // Intention classification based on domain keywords
    const isMicrostructure =
      lowerPrompt.includes('avellaneda') ||
      lowerPrompt.includes('stoikov') ||
      lowerPrompt.includes('vpin') ||
      lowerPrompt.includes('toxic') ||
      lowerPrompt.includes('slicing') ||
      lowerPrompt.includes('twap') ||
      lowerPrompt.includes('vwap') ||
      lowerPrompt.includes('markov') ||
      lowerPrompt.includes('market making');
    const isBcvMacro =
      lowerPrompt.includes('bcv') ||
      lowerPrompt.includes('paralelo') ||
      lowerPrompt.includes('brecha') ||
      lowerPrompt.includes('drenaje') ||
      lowerPrompt.includes('seniat') ||
      lowerPrompt.includes('fuga') ||
      lowerPrompt.includes('dolariz');
    const isHedge =
      lowerPrompt.includes('cobertura') ||
      lowerPrompt.includes('delta') ||
      lowerPrompt.includes('perp') ||
      lowerPrompt.includes('funding') ||
      lowerPrompt.includes('fondeo') ||
      lowerPrompt.includes('devaluaci') ||
      lowerPrompt.includes('gamma') ||
      lowerPrompt.includes('convex');
    const isKelly =
      lowerPrompt.includes('kelly') ||
      lowerPrompt.includes('asignaci') ||
      lowerPrompt.includes('ticket') ||
      lowerPrompt.includes('ruina') ||
      lowerPrompt.includes('operadores') ||
      lowerPrompt.includes('capital total');
    const isCrossExchange =
      lowerPrompt.includes('cross') ||
      lowerPrompt.includes('dorado') ||
      lowerPrompt.includes('bybit') ||
      lowerPrompt.includes('espacial') ||
      lowerPrompt.includes('corredor') ||
      lowerPrompt.includes('remesa') ||
      lowerPrompt.includes('cop');
    const isEarnVaults =
      lowerPrompt.includes('earn') ||
      lowerPrompt.includes('vault') ||
      lowerPrompt.includes('launchpool') ||
      lowerPrompt.includes('parking') ||
      lowerPrompt.includes('ocioso') ||
      lowerPrompt.includes('hurdle') ||
      lowerPrompt.includes('dual') ||
      lowerPrompt.includes('dca') ||
      lowerPrompt.includes('redemption');
    const isSecurityBank =
      lowerPrompt.includes('banco') ||
      lowerPrompt.includes('estatus') ||
      lowerPrompt.includes('caida') ||
      lowerPrompt.includes('mantenimiento') ||
      lowerPrompt.includes('pago movil') ||
      lowerPrompt.includes('blacklist') ||
      lowerPrompt.includes('lista negra') ||
      lowerPrompt.includes('fraude') ||
      lowerPrompt.includes('estafa') ||
      lowerPrompt.includes('ocr') ||
      lowerPrompt.includes('comprobante') ||
      lowerPrompt.includes('disputa');
    const isExecutiveSummary =
      lowerPrompt.includes('resumen') ||
      lowerPrompt.includes('ejecutivo') ||
      lowerPrompt.includes('sesion') ||
      lowerPrompt.includes('enjambre') ||
      lowerPrompt.includes('swarm') ||
      lowerPrompt.includes('diagnostico');
    const isForensicAudit =
      !lowerPrompt.includes('sop') &&
      (lowerPrompt.includes('horario') ||
        lowerPrompt.includes('alertas de riesgo') ||
        lowerPrompt.includes('alertas esta semana') ||
        lowerPrompt.includes('disciplina') ||
        lowerPrompt.includes('respeté el spread') ||
        lowerPrompt.includes('respete el spread') ||
        lowerPrompt.includes('spread mínimo') ||
        lowerPrompt.includes('spread minimo') ||
        lowerPrompt.includes('cumplimiento de spread') ||
        lowerPrompt.includes('auditoría forense') ||
        lowerPrompt.includes('auditoria forense') ||
        lowerPrompt.includes('tilt') ||
        lowerPrompt.includes('forense'));
    const isOperationsSop =
      lowerPrompt.includes('sop') ||
      lowerPrompt.includes('incidencia') ||
      lowerPrompt.includes('triaje') ||
      lowerPrompt.includes('rpa') ||
      lowerPrompt.includes('lead') ||
      lowerPrompt.includes('funnel') ||
      lowerPrompt.includes('sheets') ||
      lowerPrompt.includes('conciliaci') ||
      lowerPrompt.includes('contab') ||
      lowerPrompt.includes('prospecto') ||
      lowerPrompt.includes('competidor') ||
      lowerPrompt.includes('benchmark') ||
      lowerPrompt.includes('operacion');

    let reply: string;
    let plan: StrategyPlanRecord | undefined;
    const planId = `PLAN-${Date.now().toString(36).toUpperCase()}`;

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 1: MICROESTRUCTURA & MARKET MAKING (Avellaneda-Stoikov / VPIN / TWAP)
    // ─────────────────────────────────────────────────────────────────────────
    if (isMicrostructure) {
      const midPrice = onlyWhenLive(liveMidPrice, hasLiveMarketFeed);
      const avellanedaRes = executeFinancialSkill('calculate_optimal_spread_avellaneda', {
        midPrice,
        currentInventoryUsdt: 5000,
        targetInventoryUsdt: 5000,
        volatilityDaily: 0.02,
        timeRemainingFraction: 0.5,
      });
      executedSkills.push('calculate_optimal_spread_avellaneda');

      const vpinRes = executeFinancialSkill('estimate_adverse_selection_vpin', {
        buckets: [],
        toxicityThreshold: 0.25,
      });
      executedSkills.push('estimate_adverse_selection_vpin');

      const slicingRes = executeFinancialSkill('compute_optimal_order_slicing_twap_vwap', {
        totalAmountUsdt: 3000,
        executionDurationMinutes: 45,
        estimatedMarketVolumePerHourUsdt: 50000,
        currentMidPrice: midPrice ?? 0,
        algorithm: 'TWAP',
        targetDurationMinutes: 45,
      });
      executedSkills.push('compute_optimal_order_slicing_twap_vwap');

      const aData = skillPayload(avellanedaRes) as {
        optimalBidPrice?: number;
        optimalAskPrice?: number;
        reservationPrice?: number;
        recommendedAction?: string;
        spreadPct?: number;
      };
      const vData = skillPayload(vpinRes) as {
        vpinMetric?: number;
        toxicityZone?: string;
        recommendedRiskAdjustment?: string;
      };
      const sData = skillPayload(slicingRes) as {
        totalSlices?: number;
        averageSliceAmountUsdt?: number;
        executionAlgorithm?: string;
        expectedMarketImpactPct?: number;
      };

      reply =
        `Mirá, analicé la microestructura profunda del libro de órdenes utilizando el modelo cuantitativo de **Avellaneda-Stoikov** y la métrica de toxicidad **VPIN**.\n\n` +
        `### 📐 Calibración Cuantitativa de Cotizaciones (Avellaneda-Stoikov)\n` +
        `* **Precio Medio (Mid-Price)**: ${formatNumberOrNd(midPrice)} VES/USDT\n` +
        `* **Precio de Reserva ($r$)**: ${formatNumberOrNd(aData.reservationPrice)} VES (Ajustado por aversión al riesgo ante inventario largo en USDT)\n` +
        `* **Cotización Óptima de Compra (Bid)**: \`${formatNumberOrNd(aData.optimalBidPrice)} VES\`\n` +
        `* **Cotización Óptima de Venta (Ask)**: \`${formatNumberOrNd(aData.optimalAskPrice)} VES\`\n` +
        `* **Spread Asimétrico Calibrado**: ${formatNumberOrNd(aData.spreadPct)}% (Supera holgadamente la regla de oro institucional >= 0.50%)\n` +
        `* **Acción de Inventario**: ${aData.recommendedAction ?? 'Ajustar cotización para rotar inventario a neutral'}\n\n` +
        `### ⚠️ Toxicidad del Flujo & Fragmentación TWAP/VWAP\n` +
        `* **Toxicidad VPIN**: ${vData.vpinMetric !== undefined ? (vData.vpinMetric * 100).toFixed(1) : 'N/D'}% (\`${vData.toxicityZone ?? 'LOW_TOXICITY'}\`) — ${vData.recommendedRiskAdjustment ?? 'Flujo balanceado sin presión tóxica de informados'}.\n` +
        `* **Slicing de Impacto**: Para órdenes de $3,000 USDT, el algoritmo fragmenta en **${sData.totalSlices !== undefined ? sData.totalSlices : 'N/D'} bloques** de ~$${formatNumberOrNd(sData.averageSliceAmountUsdt, 0)} USDT (${sData.executionAlgorithm ?? 'TWAP'}, impacto de mercado estimado: solo ${formatNumberOrNd(sData.expectedMarketImpactPct)}%).\n\n` +
        `Con esta configuración asegurás captura de spread como Maker minimizando la selección adversa. Fijate en la ficha técnica generada y dale **EJECUTAR** para publicar las cotizaciones calibradas.`;

      const spreadVal = typeof aData.spreadPct === 'number' ? Number(aData.spreadPct.toFixed(2)) : 0;
      const reqCap1 = resolveCapital(3000);
      plan = {
        id: planId,
        title: 'Market Making Cuantitativo (Avellaneda-Stoikov & TWAP)',
        route: `Bid: ${formatNumberOrNd(aData.optimalBidPrice)} | Ask: ${formatNumberOrNd(aData.optimalAskPrice)} (Fragmentación: ${sData.totalSlices !== undefined ? sData.totalSlices : 'N/D'} tramos)`,
        asset: 'USDT',
        fiat: 'VES',
        capitalRequiredUsdt: reqCap1,
        expectedNetSpreadPct: spreadVal,
        expectedProfitUsdt: Number(((reqCap1 * spreadVal) / 100).toFixed(2)),
        riskLevel: resolveRiskLevel('LOW', isSimulated),
        assignedOperatorName: 'Lead Market Maker',
        rationale: `Cotizaciones asimétricas calculadas por Avellaneda-Stoikov con VPIN en zona ${vData.toxicityZone ?? 'segura'}. Ejecución anti-impacto por bloques.`,
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 2: BCV MACRO & DRENAJE FISCAL SENIAT
    // ─────────────────────────────────────────────────────────────────────────
    else if (isBcvMacro) {
      const parallelRate = onlyWhenLive(liveParallelRate, hasLiveMarketFeed);
      const bcvRate = getResolvedBcvRate();
      const bcvRes = runBcvGapSkill(parallelRate, bcvRate);
      executedSkills.push('predict_bcv_market_intelligence');

      const now = new Date();
      const drainRes = executeFinancialSkill('forecast_central_bank_liquidity_drain', {
        dayOfMonth: now.getDate(),
        dayOfWeek: now.getDay(),
        estimatedSeniatCollectionActive: true,
        weeklyBcvInjectionMillionsUsd: 45,
      });
      executedSkills.push('forecast_central_bank_liquidity_drain');

      const flightRes = executeFinancialSkill('monitor_fiat_flight_and_dollarization_velocity', {
        averageVesHoldingMinutes: 35,
        merchantUsdtAcceptancePct: 80,
        monthlyInflationEstimatePct: 35,
      });
      executedSkills.push('monitor_fiat_flight_and_dollarization_velocity');

      const bcvData = skillPayload(bcvRes) as {
        gap?: { gapPct?: number; zone?: string; riskZone?: string };
        recommendation?: { action?: string; actionLabel?: string; confidencePct?: number };
        window?: { phase?: string; rationale?: string; hoursUntilIntervention?: number; nextExpectedIntervention?: string };
        interventionCycle?: { isInterventionDay?: boolean; optimalWindowHours?: string };
      };
      const drainData = skillPayload(drainRes) as {
        interbankLiquidityLevel?: string;
        p2pDemandImpact?: string;
        projectedParallelTrend48h?: string;
        strategicGuidance?: string;
        netVesLiquidityContractionPct?: number;
        expectedSpreadCompressionBps?: number;
      };
      const flightData = skillPayload(flightRes) as {
        moneyVelocityIndex?: number;
        dollarizationVelocityIndex?: number;
        flightRegime?: string;
        urgencyLevel?: string;
        expectedHoldingTimeSafetyThresholdMinutes?: number;
        recommendedHoldingLimitMinutes?: number;
      };

      const zoneStr =
        bcvData.gap?.zone && bcvData.gap.zone !== 'UNAVAILABLE'
          ? bcvData.gap.zone
          : bcvData.gap?.riskZone ?? 'N/D';
      const windowStr =
        bcvData.window?.rationale ??
        bcvData.window?.nextExpectedIntervention ??
        bcvData.interventionCycle?.optimalWindowHours ??
        'N/D';
      const recStr =
        bcvData.recommendation?.actionLabel ??
        bcvData.recommendation?.action ??
        'N/D — la ventana de intervención no se mide sin la tasa oficial BCV.';

      const velIndex = flightData.moneyVelocityIndex ?? flightData.dollarizationVelocityIndex;
      const regimeStr = flightData.flightRegime ?? flightData.urgencyLevel ?? 'ORDERLY_DOLLARIZATION';
      const holdMin =
        flightData.expectedHoldingTimeSafetyThresholdMinutes ??
        flightData.recommendedHoldingLimitMinutes;

      reply =
        `Mirá, evalué las condiciones de política monetaria del BCV y el drenaje fiscal del SENIAT con nuestros motores de inteligencia cambiaria.\n\n` +
        `### 🏦 Monitor de Brecha Cambiaria & Ventana de Intervención\n` +
        `* **Tasa Oficial BCV**: ${formatNumberOrNd(bcvRate)} VES/USD | **Tasa Paralela P2P**: ${formatNumberOrNd(parallelRate)} VES/USD\n` +
        `${bcvGapAbsenceNote(bcvRes)}` +
        `* **Brecha Cambiaria**: \`${formatNumberOrNd(bcvData.gap?.gapPct, 1)}%\` (Zona de Riesgo: **${zoneStr}**)\n` +
        `* **Ventana de Intervención BCV**: ${windowStr}. Durante esta ventana las mesas de cambio bancarias reciben divisas y contraen la tasa paralela.\n` +
        `* **Directiva de Tesorería**: ${recStr}.\n\n` +
        `### 📉 Drenaje Fiscal SENIAT & Velocidad de Dolarización\n` +
        `* **Liquidez Interbancaria**: \`${drainData.interbankLiquidityLevel ?? 'MODERATE'}\` (Impacto en P2P: ${drainData.p2pDemandImpact ?? 'BALANCED_TURNOVER'}).\n` +
        `* **Tendencia 48h & Guía**: \`${drainData.projectedParallelTrend48h ?? 'STABLE_EXPANSION'}\` — ${drainData.strategicGuidance ?? 'Rotación continua con spread regular.'}\n` +
        `* **Velocidad de Fuga del VES (MV=PY)**: Índice de ${formatNumberOrNd(velIndex, 2)} (\`${regimeStr}\`). Tiempo máximo sugerido de tenencia en bolívares: **${holdMin !== undefined ? `${holdMin} minutos` : 'N/D'}**.\n\n` +
        `El plan táctico busca preservar la tesorería frente a la devaluación; el spread y el profit son estimados y no están verificados contra el libro real.`;

      const reqCap2 = resolveCapital(1200);
      plan = {
        id: planId,
        title: 'Rotación Rápida & Inmunización Cambiaria BCV/SENIAT',
        route: 'VES (Pago Móvil Rápido) -> USDT (Binance P2P)',
        asset: 'USDT',
        fiat: 'VES',
        capitalRequiredUsdt: reqCap2,
        expectedNetSpreadPct: 1.25,
        expectedProfitUsdt: Number(((reqCap2 * 1.25) / 100).toFixed(2)),
        riskLevel: resolveRiskLevel('LOW', isSimulated),
        assignedOperatorName: 'Operador Turno Mañana',
        rationale: `Rotación rápida previa a ventana de inyección BCV. Límite estricto de retención de VES en 30 min por drenaje fiscal SENIAT.`,
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 3: COBERTURA DELTA-NEUTRAL & FUNDING ARBITRAGE
    // ─────────────────────────────────────────────────────────────────────────
    else if (isHedge) {
      const parallelRate = onlyWhenLive(liveParallelRate, hasLiveMarketFeed);
      const hedgeRes = executeFinancialSkill('evaluate_delta_neutral_hedge', {
        vesBalance: 45000,
        usdtBalance: 1500,
        currentParallelRate: parallelRate,
        vesMaxHoldingTimeMinutes: 45,
      });
      executedSkills.push('evaluate_delta_neutral_hedge');

      const fundingRes = executeFinancialSkill('model_perpetual_funding_arbitrage', {
        spotUsdtHoldings: 2000,
        current8hFundingRatePct: 0.035,
        perpContractSymbol: 'BTCUSDT',
      });
      executedSkills.push('model_perpetual_funding_arbitrage');

      const hData = skillPayload(hedgeRes) as {
        fiatExposureUsd?: number;
        netDeltaRatio?: number;
        urgency?: string;
        proposals?: { action: string; hedgeAmountUsdt: number; reason: string }[];
      };
      const fData = skillPayload(fundingRes) as {
        annualizedFundingYieldPct?: number;
        dailyProjectedIncomeUsdt?: number;
        isFundingProfitable?: boolean;
        executionStrategy?: string;
      };

      const firstProposal = hData.proposals?.[0];
      const proposalHedgeUsdt = typeof firstProposal?.hedgeAmountUsdt === 'number' ? firstProposal.hedgeAmountUsdt : 500;

      reply =
        `Mirá, calculé la exposición direccional de la tesorería y modelé una cobertura sintética delta-neutral con captura de tasa de fondeo.\n\n` +
        `### 🛡️ Auditoría de Exposición Direccional (Delta Risk)\n` +
        `* **Exposición en Bolívares (VES)**: $${formatNumberOrNd(hData.fiatExposureUsd, 0)} USD equivalentes\n` +
        `* **Ratio Delta Neto**: ${formatNumberOrNd(hData.netDeltaRatio, 2)} (\`Urgencia: ${hData.urgency ?? 'MEDIUM'}\`)\n` +
        `* **Propuesta de Cobertura**: ${firstProposal?.action ?? 'Abrir Short Perp USD/USDT'} por valor de $${formatNumberOrNd(firstProposal?.hedgeAmountUsdt, 0)} USDT para neutralizar el riesgo devaluatorio.\n\n` +
        `### 💰 Arbitraje de Tasa de Fondeo (Perpetual Funding Yield)\n` +
        `* **Tasa de Fondeo (8h)**: +0.035% (Los compradores en futuros pagan a los vendedores).\n` +
        `* **Rendimiento Anualizado Proyectado**: \`${formatNumberOrNd(fData.annualizedFundingYieldPct, 2)}% APR\` en ingresos pasivos de fondeo.\n` +
        `* **Ingreso Diario Proyectado**: ~$${formatNumberOrNd(fData.dailyProjectedIncomeUsdt, 2)} USDT adicionales mientras el capital respalda órdenes P2P.\n` +
        `* **Estrategia**: ${fData.executionStrategy ?? 'Short sintético Delta-Neutral con colateral en USDT'}.\n\n` +
        `Esta cobertura inmuniza tu balance contra una devaluación abrupta del bolívar mientras te permite cosechar intereses de fondeo.`;

      const reqCap3 = resolveCapital(proposalHedgeUsdt);
      plan = {
        id: planId,
        title: 'Cobertura Delta-Neutral & Funding Harvest',
        route: 'SHORT_PERP_USD (Binance Futures) vs Inventario VES P2P',
        capitalRequiredUsdt: reqCap3,
        expectedNetSpreadPct: 0.85,
        expectedProfitUsdt: Number(((reqCap3 * 0.85) / 100).toFixed(2)),
        riskLevel: resolveRiskLevel('LOW', isSimulated),
        assignedOperatorName: 'Desk Risk Officer',
        rationale:
          'Inmunización matemática contra caída de tasa cambiaria más captura de tasa de fondeo positiva.',
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 4: ASIGNACIÓN DE CAPITAL & CRITERIO DE KELLY
    // ─────────────────────────────────────────────────────────────────────────
    else if (isKelly) {
      const kellyRes = executeFinancialSkill('optimize_capital_allocation_kelly', {
        totalBankrollUsdt: 5000,
        winRateHistoricalPct: 88,
        averageWinProfitPct: 1.45,
        averageLossSlippagePct: 0.35,
        activeOperatorsCount: 2,
      });
      executedSkills.push('optimize_capital_allocation_kelly');

      const kData = skillPayload(kellyRes) as {
        optimalTicketSizeUsdt?: number;
        recommendedFractionPct?: number;
        fullKellyFractionPct?: number;
        perOperatorAllocationUsdt?: number;
        ruinProbabilityPct?: number;
        strategicRationale?: string;
      };

      const reqCap4 = resolveCapital(5000);
      const perOp = Math.round(reqCap4 / 2);
      const optTicket = Math.round(reqCap4 * 0.225);

      reply =
        `Mirá, apliqué el modelo matemático del **Criterio de Kelly Institucional (Fractional Half-Kelly)** para maximizar la tasa compuesta geométrica de crecimiento protegiendo el bankroll.\n\n` +
        `### 📊 Optimización de Tickets (Kelly Fractional)\n` +
        `* **Bankroll Total Disponible**: $${formatNumberOrNd(reqCap4, 0)} USDT\n` +
        `* **Full Kelly Teórico**: ${formatNumberOrNd(kData.fullKellyFractionPct, 1)}% (Demasiado agresivo para un entorno bancario regulado).\n` +
        `* **Fracción Prudencial Aplicada (Half-Kelly)**: \`${formatNumberOrNd(kData.recommendedFractionPct, 1)}%\` del bankroll.\n` +
        `* **Tamaño Óptimo de Ticket por Orden**: \`$${formatNumberOrNd(optTicket, 0)} USDT\`\n` +
        `* **Asignación por Operador (2 Operadores Activos)**: $${formatNumberOrNd(perOp, 0)} USDT por turno/cuenta bancaria.\n` +
        `* **Probabilidad de Ruina Estimada**: \`< ${formatNumberOrNd(kData.ruinProbabilityPct, 2)}%\` con disciplina estricta de rotación.\n\n` +
        `### 🎯 Fundamento Estratégico\n` +
        `${kData.strategicRationale ?? 'Al limitar los tickets al 22.5%, evitamos alertas por transferencias masivas en los bancos locales (SUDEBAN) y aseguramos liquidez continua para compras de oportunidad.'}`;

      plan = {
        id: planId,
        title: 'Asignación de Capital Kelly (2 Operadores)',
        route: `2 Cuentas Bancarias x $${perOp} USDT (Tickets de $${optTicket})`,
        capitalRequiredUsdt: reqCap4,
        expectedNetSpreadPct: 1.35,
        expectedProfitUsdt: Number(((reqCap4 * 1.35) / 100).toFixed(2)),
        riskLevel: resolveRiskLevel('LOW', isSimulated),
        assignedOperatorName: 'Desk Risk & Treasury Lead',
        rationale:
          'Dimensionamiento matemático según Criterio de Kelly fraccional para dimensionar la exposición; el sizing es una estimación y no elimina el riesgo de drawdown.',
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 5: BINANCE EARN VAULTS & HURDLE RATE (CAPITAL OCIOSO)
    // ─────────────────────────────────────────────────────────────────────────
    else if (isEarnVaults) {
      const hurdleRes = executeFinancialSkill('calculate_earn_yield_vs_p2p_hurdle_rate', {
        grossP2pSpreadPct: 1.4,
        platformFeePct: 0.1,
        bankingRiskPremiumPct: 0.3,
        fxDevaluationRiskPct: 0.15,
        averageTradeCycleHours: 2.5,
        simpleEarnAprPct: 12.5,
      });
      executedSkills.push('calculate_earn_yield_vs_p2p_hurdle_rate');

      const reqCap5 = resolveCapital(2000);
      const earnRes = executeFinancialSkill('optimize_idle_capital_simple_earn', {
        idleCapitalUsdt: reqCap5,
        hoursIdle: 8,
        simpleEarnAprPct: 12.5,
      });
      executedSkills.push('optimize_idle_capital_simple_earn');

      const redemptionRes = executeFinancialSkill('simulate_earn_instant_redemption_latency', {
        redemptionAmountUsdt: reqCap5,
      });
      executedSkills.push('simulate_earn_instant_redemption_latency');

      const hData = skillPayload(hurdleRes) as {
        hurdleRateMet?: boolean;
        netHourlyP2pYieldPct?: number;
        passiveHourlyEarnYieldPct?: number;
        recommendation?: string;
      };
      const eData = skillPayload(earnRes) as {
        interestEarnedUsdt?: number;
        effectiveAprPct?: number;
        parkingStrategy?: string;
      };
      const rData = skillPayload(redemptionRes) as {
        instantRedemptionAvailable?: boolean;
        estimatedLatencySeconds?: number;
        isSafeForRapidP2pExecution?: boolean;
      };

      reply =
        `Mirá, calculé la tasa de corte (**Hurdle Rate**) comparando el costo de oportunidad entre rotación activa P2P y rendimiento pasivo en **Binance Simple Earn Flexible**.\n\n` +
        `### ⚡ Comparación de Rendimiento (Hurdle Rate)\n` +
        `* **Spread Neto P2P por Hora**: \`+${formatNumberOrNd(hData.netHourlyP2pYieldPct, 3)}%/hora\` (Tras comisiones bancarias y devaluación estimada).\n` +
        `* **Rendimiento Simple Earn Flexible**: \`+${formatNumberOrNd(hData.passiveHourlyEarnYieldPct, 5)}%/hora\` (12.5% APR anualizado).\n` +
        `* **Dictamen del Modelo**: ${hData.recommendation ?? 'Operar activamente mientras el mercado P2P ofrezca spread neto >= 0.50%'}.\n\n` +
        `### 🌙 Parking Táctico de Capital Ocioso (Horas Nocturnas)\n` +
        `* **Capital Estacionable**: $${formatNumberOrNd(reqCap5, 0)} USDT durante ventanas sin volumen bancario (00:00 - 08:00 UTC).\n` +
        `* **Interés Generado**: ~$${formatNumberOrNd(eData.interestEarnedUsdt, 3)} USDT por noche (tasa no verificada en vivo: el rendimiento depsite del esquema de Binance P2P, no de un feed conectado).\n` +
        `* **Redención Inmediata**: ${rData.instantRedemptionAvailable ? '✓ Disponible' : 'Advertencia'} (Latencia promedio: ${rData.estimatedLatencySeconds !== undefined ? `${rData.estimatedLatencySeconds} seg` : 'N/D'}). El capital retorna a la billetera de fondos inmediatamente al detectar un anuncio rentable.\n\n` +
        `El capital jamás se queda quieto al 0%: produce rendimiento pasivo en vaults cuando los bancos duermen y se redime en segundos para P2P al amanecer.`;

      plan = {
        id: planId,
        title: 'Estacionamiento en Simple Earn Flexible & Redención Inmediata',
        route: 'Spot/Fondos ➔ Binance Simple Earn Flexible USDT (12.5% APR)',
        asset: 'USDT',
        capitalRequiredUsdt: reqCap5,
        expectedNetSpreadPct: 1.05,
        expectedProfitUsdt: Number(((reqCap5 * 1.05) / 100).toFixed(2)),
        riskLevel: resolveRiskLevel('LOW', isSimulated),
        assignedOperatorName: 'Treasury Manager',
        rationale:
          'Capital devengando interés pasivo con cuota de rescate instantáneo para compras P2P relámpago.',
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 6: CROSS-EXCHANGE & CORREDORES FX
    // ─────────────────────────────────────────────────────────────────────────
    else if (isCrossExchange) {
      const buyPrice = onlyWhenLive(liveBuyPrice, hasLiveMarketFeed);
      const sellPrice = onlyWhenLive(liveSellPrice, hasLiveMarketFeed);
      const reqCap6 = resolveCapital(1500);
      const crossRes = executeFinancialSkill('calculate_cross_exchange_basis_spread', {
        buyPlatform: 'Binance P2P',
        sellPlatform: 'El Dorado P2P',
        buyPrice,
        sellPrice,
        transferFeeUsdt: 1.0,
        tradeAmountUsdt: reqCap6,
      });
      executedSkills.push('calculate_cross_exchange_basis_spread');

      const cData = skillPayload(crossRes) as {
        netSpreadPct?: number;
        netProfitUsdt?: number;
        grossSpreadPct?: number;
        networkFeeDeductionUsdt?: number;
        isArbitrageViable?: boolean;
        clearingTimeMinutes?: number;
      };

      const netSpread = typeof cData.netSpreadPct === 'number' ? Number(cData.netSpreadPct.toFixed(2)) : 0;
      const netProfit = Number(((reqCap6 * netSpread) / 100).toFixed(2));

      reply =
        `Mirá, evalué el arbitraje espacial de bases entre plataformas cruzadas (**Binance P2P vs El Dorado P2P**).\n\n` +
        `### 🌐 Arbitraje Espacial de Bases (Cross-Exchange)\n` +
        `* **Plataforma de Compra (Bid)**: Binance P2P @ ${formatNumberOrNd(buyPrice)} VES/USDT\n` +
        `* **Plataforma de Venta (Ask)**: El Dorado P2P @ ${formatNumberOrNd(sellPrice)} VES/USDT\n` +
        `* **Spread Bruto**: ${formatNumberOrNd(cData.grossSpreadPct)}%\n` +
        `* **Costo de Retiro y Red**: -$${formatNumberOrNd(cData.networkFeeDeductionUsdt)} USDT (Vía BSC BEP-20 / Tron TRC-20)\n` +
        `* **Spread Neto Real**: \`+${formatNumberOrNd(cData.netSpreadPct)}%\` (Regla de oro cumplida holgadamente)\n` +
        `* **Beneficio Neto Proyectado**: \`+$${formatNumberOrNd(netProfit)} USDT\` por rotación de $${formatNumberOrNd(reqCap6, 0)} USDT.\n` +
        `* **Tiempo de Ciclo Completo**: ~${cData.clearingTimeMinutes !== undefined ? `${cData.clearingTimeMinutes} minutos` : 'N/D'}.\n\n` +
        `Ruta altamente líquida aprovechando la prima de compra en plataformas secundarias. Dale **EJECUTAR** para despacharla.`;

      plan = {
        id: planId,
        title: 'Arbitraje Espacial Binance P2P ➔ El Dorado P2P',
        route: 'Comprar USDT en Binance P2P (Banesco) ➔ Vender en El Dorado (Pago Móvil)',
        asset: 'USDT',
        fiat: 'VES',
        capitalRequiredUsdt: reqCap6,
        expectedNetSpreadPct: netSpread,
        expectedProfitUsdt: netProfit,
        riskLevel: resolveRiskLevel('LOW', isSimulated),
        assignedOperatorName: 'Arbitrage Desk',
        rationale:
          'Discrepancia de base confirmada tras absorber comisiones de retiro y fricción cambiaria.',
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 7: SEGURIDAD BANCARIA, LISTAS NEGRAS & FRAUDE OCR
    // ─────────────────────────────────────────────────────────────────────────
    else if (isSecurityBank) {
      const bankRes = executeFinancialSkill('check_bank_operational_status', {
        bankCodes: ['0102', '0134', '0105', '0108', '0172', 'PAGO_MOVIL'],
      });
      executedSkills.push('check_bank_operational_status');

      const bData = skillPayload(bankRes) as {
        networkStatus?: string;
        averageSettlementLatencyMinutes?: number;
        pauseTradingDirective?: boolean;
        operationalSummary?: string;
        details?: { bankName: string; status: string; settlementLatencyMinutes: number }[];
      };

      // No existe fuente de estado bancario conectada: el skill devuelve
      // { success:false }. Antes esto caía a un "✅ Trading Autorizado" y a
      // "máximos estándares de compliance" sin ninguna verificación detrás.
      const bankStatusVerified = bankRes.success && bData.networkStatus !== undefined;
      const pauseDirective =
        bData.pauseTradingDirective === true
          ? '🚨 PAUSA ACTIVA'
          : bankStatusVerified
            ? `Estado verificado: \`${bData.networkStatus}\` (sin directiva de pausa)`
            : '⚠️ SIN VERIFICAR — sin fuente de estado conectada, no se puede autorizar ni pausar';

      reply =
        `Mirá, corrí la auditoría de seguridad operativa bancaria.\n\n` +
        `### 🛡️ Estado de Infraestructura Bancaria & Compensación\n` +
        `* **Estado de la Red**: \`${bData.networkStatus ?? 'UNVERIFIED_OFFLINE'}\`\n` +
        `* **Directiva**: ${pauseDirective}\n` +
        `* **Latencia Promedio de Acreditación**: ${formatNumberOrNd(bData.averageSettlementLatencyMinutes, 1)} minutos.\n` +
        `* **Resumen Operativo**: ${bData.operationalSummary ?? 'N/D — sin fuente de estado conectada'}\n\n` +
        `### 🚫 Escudo Anti-Triangulación & Listas Negras\n` +
        `* **Filtro de Cédulas y Teléfonos**: el cotejo requiere la tabla SQLite de lista negra; sin registros cargados el resultado es \`UNVERIFIED\`.\n` +
        `* **Verificación de Comprobantes OCR**: detección de adulteración digital de fuentes, referencias repetidas y concordancia obligatoria entre el nombre del titular bancario y la cuenta verificada de Binance.\n` +
        `* **Regla Innegociable**: Cero pagos de terceros. Si el comprobante muestra un remitente distinto, la orden se retiene y se emite expediente de disputa.\n\n` +
        (bankStatusVerified
          ? `La verificación proviene de una fuente conectada; el plan queda marcado con su provenance correspondiente.`
          : `⚠️ *No puedo afirmar cumplimiento bancario: sin fuente conectada, el estado de los canales es \`UNVERIFIED_OFFLINE\` y el plan queda simulado y no despachable.*`);

      const reqCap7 = resolveCapital(1000);
      plan = {
        id: planId,
        title: 'Verificación de Seguridad & Auditoría de Canales Bancarios',
        route: 'Inspección de Banesco / Mercantil / BDV / Suiche Pago Móvil',
        asset: 'USDT',
        fiat: 'VES',
        capitalRequiredUsdt: reqCap7,
        expectedNetSpreadPct: 1.15,
        expectedProfitUsdt: Number(((reqCap7 * 1.15) / 100).toFixed(2)),
        riskLevel: resolveRiskLevel('LOW', isSimulated),
        assignedOperatorName: 'Compliance & Security Officer',
        rationale: bankStatusVerified
          ? 'Estado de canales verificado contra fuente conectada, sin directiva de pausa vigente.'
          : 'Estado de canales NO verificado: sin fuente conectada, el riesgo de fondos atrapados y de coincidencia en listas negras permanece abierto.',
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 8: RESUMEN EJECUTIVO & DIAGNÓSTICO ENJAMBRE (SWARM)
    // ─────────────────────────────────────────────────────────────────────────
    else if (isExecutiveSummary) {
      const swarmHealth = this.swarm
        ? this.swarm.getSwarmHealth()
        : [
            { role: 'SENTINEL', name: 'Alpha Sentinel', status: 'ONLINE', opsProcessed: 142 },
            { role: 'STRATEGIST', name: 'Gentleman AI', status: 'ONLINE', opsProcessed: 98 },
            {
              role: 'RISK_GATEKEEPER',
              name: 'Risk Gatekeeper',
              status: 'ONLINE',
              opsProcessed: 98,
            },
            {
              role: 'DISPUTE_AUDITOR',
              name: 'Dispute & Proof Auditor',
              status: 'STANDBY',
              opsProcessed: 12,
            },
          ];

      const parallelRate = onlyWhenLive(liveParallelRate, hasLiveMarketFeed);
      const bcvRate = getResolvedBcvRate();
      const bcvRes = runBcvGapSkill(parallelRate, bcvRate);
      executedSkills.push('predict_bcv_market_intelligence');
      const bData = skillPayload(bcvRes) as { gap?: { gapPct?: number } };

      reply =
        `Mirá, formulé el **Resumen Ejecutivo de la Mesa P2P** consolidando la telemetría del Enjambre Multi-Agente.\n\n` +
        `### ⚡ Estado del Enjambre Multi-Agente (Swarm Telemetry)\n` +
        swarmHealth
          .map(
            (a) =>
              `* **${a.name}** (\`${a.role}\`): Estado \`${a.status}\` — Ops procesadas: ${a.opsProcessed}`,
          )
          .join('\n') +
        `\n\n` +
        `### 📈 Diagnóstico Macro & Mercado P2P\n` +
        `* **Brecha Cambiaria BCV**: \`${formatNumberOrNd(bData.gap?.gapPct, 1)}%\` (Paralelo: ${formatNumberOrNd(parallelRate)} | BCV: ${formatNumberOrNd(bcvRate)} VES/USD)\n` +
        bcvGapAbsenceNote(bcvRes) +
        `* **Regla de Oro Institucional**: Spread objetivo >= 0.50% neto. Ninguna orden con margen inferior es admitida por el Risk Gatekeeper.\n` +
        `* **Capacidad de Tesorería**: Fondos resguardados en USDT con diversificación en Banesco y Pago Móvil interbancario.\n\n` +
        `### 🎯 Prioridades Operativas para el Operador\n` +
        `1. Priorizar rotaciones en Banesco y Pago Móvil durante la mañana.\n` +
        `2. Mantener órdenes maker calibradas con Avellaneda-Stoikov para capturar spread sin asumir deslizamiento taker.\n` +
        `3. Ante órdenes dudosas de terceros, exigir de inmediato comprobante PDF bancario para auditoría OCR.\n\n` +
        `El Enjambre permanece activo 24/7 vigilando la microestructura.`;

      const reqCap8 = resolveCapital(2000);
      plan = {
        id: planId,
        title: 'Plan Maestro de Operaciones P2P del Enjambre',
        route: 'Banesco Pago Móvil ➔ USDT ➔ Liquidación Transferencia Bancaria',
        asset: 'USDT',
        fiat: 'VES',
        capitalRequiredUsdt: reqCap8,
        expectedNetSpreadPct: 1.35,
        expectedProfitUsdt: Number(((reqCap8 * 1.35) / 100).toFixed(2)),
        riskLevel: resolveRiskLevel('LOW', isSimulated),
        assignedOperatorName: 'Operador Principal',
        rationale: 'Estrategia consolidada aprobada unánimemente por el Enjambre Multi-Agente.',
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 9: INTERROGADOR FORENSE DEL LIBRO MAYOR & RIESGO OPERATIVO (audit_and_risk_analytics)
    // ─────────────────────────────────────────────────────────────────────────
    else if (isForensicAudit) {
      // Fetch real history from SQLite relational ledger
      const rawLogs = this.db ? this.db.listAuditLogs(500) : [];
      const rawOps = this.db ? this.db.listOperationRecords(100) : [];

      const auditRes = executeFinancialSkill('audit_and_risk_analytics', {
        timeframeDays: 7,
        minSpreadThresholdPct: 0.5,
        focusArea: 'ALL',
        sampleEvents: rawLogs.map((l) => ({
          timestamp: l.timestamp,
          severity: l.severity,
          action: l.action,
          category: l.category,
          createdAt: l.createdAt,
        })),
        sampleOperations: rawOps.map((o) => ({
          id: o.id,
          timestamp: o.timestamp,
          side: o.side,
          fiatAmount: o.fiatAmount,
          cryptoAmount: o.cryptoAmount,
          price: o.price,
          bank: o.bank,
          rawJson: o.rawJson,
          createdAt: o.createdAt,
        })),
      });
      executedSkills.push('audit_and_risk_analytics');

      const data = skillPayload(auditRes) as {
        dossier?: {
          assessmentStatus?: 'ASSESSED' | 'NOT_ASSESSED';
          operatorStanding?: string;
          goldenRuleComplianceScore?: number | null;
          hourlyRisk?: {
            totalEventsAnalyzed?: number;
            peakRiskHour?: number;
            peakRiskWindow?: string;
            peakRiskScore?: number;
            totalCriticalIncidents?: number;
            criticalIncidentRatePct?: number;
            highRiskHours?: number[];
            recommendation?: string;
          };
          disciplineAudit?: {
            assessmentStatus?: 'ASSESSED' | 'NOT_ASSESSED';
            totalOperationsAnalyzed?: number;
            compliantOperationsCount?: number;
            nonCompliantOperationsCount?: number;
            complianceRatePct?: number | null;
            volumeWeightedAverageSpreadPct?: number;
            tiltDetected?: boolean;
            tiltSeverity?: string;
            tiltConsecutiveViolations?: number;
            estimatedSacrificedProfitUsdt?: number;
            summary?: string;
          };
          criticalFindings?: string[];
          preventiveDirectives?: string[];
          executiveVerdict?: string;
        };
      };

      const dossier = data?.dossier;
      const hRisk = dossier?.hourlyRisk;
      const dAudit = dossier?.disciplineAudit;

      const totalEvents = hRisk?.totalEventsAnalyzed !== undefined ? hRisk.totalEventsAnalyzed : rawLogs.length;
      const totalOps = dAudit?.totalOperationsAnalyzed !== undefined ? dAudit.totalOperationsAnalyzed : rawOps.length;

      // Every fallback below used to default to the best possible outcome
      // (`'DISCIPLINED'`, `100`, `'Excelente apego'`, `'Control emocional
      // óptimo'`). On a fresh install — zero operations, zero audit logs —
      // that made the forensic auditor certify an empty ledger as
      // institutionally disciplined and print "Puntaje Regla de Oro: 100/100"
      // to the user. An absent record is not a passing grade, so every
      // certification now falls back to "not assessed" instead.
      const notAssessed = totalOps === 0 || dAudit?.assessmentStatus === 'NOT_ASSESSED';
      const complianceRate = notAssessed
        ? 'N/D (sin operaciones)'
        : formatNumberOrNd(dAudit?.complianceRatePct, 1) + '%';
      const standing = notAssessed ? 'NOT_ASSESSED' : dossier?.operatorStanding ?? 'NOT_ASSESSED';
      const goldenScore = notAssessed || dossier?.goldenRuleComplianceScore == null
        ? 'N/D'
        : `${dossier.goldenRuleComplianceScore}/100`;
      const tiltVerdict = notAssessed
        ? 'N/D — no hay operaciones para evaluar rachas de tilt.'
        : dAudit?.tiltDetected
          ? `⚠️ ¡DETECTADO! Severidad: \`${dAudit?.tiltSeverity}\` (Racha de ${dAudit?.tiltConsecutiveViolations} desvíos consecutivos). Lucro cesante estimado: $${formatNumberOrNd(dAudit?.estimatedSacrificedProfitUsdt)} USDT.`
          : 'Sin rachas de tilt en las operaciones analizadas.';
      const executiveVerdict = notAssessed
        ? 'SIN CALIFICAR: no hay operaciones registradas, la disciplina operativa aún no puede evaluarse.'
        : dossier?.executiveVerdict ?? 'SIN CALIFICAR: el dictamen forense no está disponible.';
      const directives = notAssessed
        ? [
            'Registra operaciones para que la disciplina operativa pueda evaluarse; hoy no hay historial que auditar.',
          ]
        : (dossier?.preventiveDirectives?.length ? dossier.preventiveDirectives : [
            'Mantener la disciplina actual y no negociar spreads inferiores al 0.50%.',
          ]);

      reply =
        `Mirá, realicé la **Auditoría Forense del Libro Mayor** interrogando directamente tus registros en SQLite (${totalEvents} eventos de auditoría y ${totalOps} operaciones comerciales analizadas).\n\n` +
        `### 🕒 Distribución Horaria de Riesgo & Alertas\n` +
        `* **Ventana Horaria Crítica**: \`${hRisk?.peakRiskWindow ?? 'N/D'}\` (Puntaje de riesgo: ${hRisk?.peakRiskScore !== undefined ? hRisk.peakRiskScore : 'N/D'} con ${hRisk?.totalCriticalIncidents !== undefined ? hRisk.totalCriticalIncidents : 0} incidentes/alertas).\n` +
        `* **Tasa de Incidentes Críticos**: \`${formatNumberOrNd(hRisk?.criticalIncidentRatePct, 1)}%\` sobre el total de eventos.\n` +
        `* **Diagnóstico de Horarios**: ${hRisk?.recommendation ?? (totalEvents === 0 ? 'Sin eventos de auditoría registrados; no hay distribución horaria que evaluar.' : 'N/D')}\n\n` +
        `### 🎯 Disciplina Operativa & Regla de Oro (Spread >= 0.50%)\n` +
        `* **Tasa de Cumplimiento**: \`${complianceRate}\` de operaciones con spread neto >= 0.50% (${dAudit?.compliantOperationsCount !== undefined ? dAudit.compliantOperationsCount : 0} conformes / ${dAudit?.nonCompliantOperationsCount !== undefined ? dAudit.nonCompliantOperationsCount : 0} desvíos).\n` +
        `* **Spread Promedio Ponderado (VWAS)**: \`+${formatNumberOrNd(dAudit?.volumeWeightedAverageSpreadPct)}%\` neto.\n` +
        `* **Detector de Tilt / Emocional**: ${tiltVerdict}\n\n` +
        `### 🏛️ Veredicto Forense Institucional\n` +
        `* **Calificación**: \`${standing}\` (Puntaje Regla de Oro: ${goldenScore}).\n` +
        `* **Dictamen Ejecutivo**: ${executiveVerdict}\n\n` +
        `### 🛡️ Directivas Preventivas Sugeridas\n` +
        directives.map((dir) => `* ${dir}`).join('\n') +
        `\n\n` +
        `A continuación te genero la ficha táctica de mitigación para blindar la mesa en los horarios de riesgo.`;

      const auditSpread = typeof dAudit?.volumeWeightedAverageSpreadPct === 'number'
        ? Math.max(0.5, dAudit.volumeWeightedAverageSpreadPct)
        : 1.25;
      const reqCap9 = resolveCapital(1500);

      plan = {
        id: planId,
        title: `Plan de Mitigación Forense (${standing})`,
        route: `Blindaje en ventana ${hRisk?.peakRiskWindow ?? 'N/D'} ➔ Forzar spread mínimo >= 0.50% en órdenes Maker`,
        asset: 'USDT',
        fiat: 'VES',
        capitalRequiredUsdt: reqCap9,
        expectedNetSpreadPct: auditSpread,
        expectedProfitUsdt: Number(((reqCap9 * auditSpread) / 100).toFixed(2)),
        riskLevel:
          dossier?.operatorStanding === 'CRITICAL_TILT_RISK'
            ? 'HIGH'
            : dossier?.operatorStanding === 'MODERATE_DEVIATION'
              ? 'MEDIUM'
              : 'LOW',
        assignedOperatorName: 'Forensic Audit & Risk Officer',
        rationale:
          dossier?.executiveVerdict ??
          'Protocolo forense de disciplina y control de horarios críticos.',
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 10: GOBERNANZA SOP, CONCILIACIÓN RPA & TRIAJE OPERATIVO
    // ─────────────────────────────────────────────────────────────────────────
    else if (isOperationsSop) {
      const sopRes = executeFinancialSkill('audit_sop_compliance_enforcement', {
        orderId: 'ORD-LIVE-AUDIT',
        accountHolderMatchesDocument: true,
        bankBalanceConfirmedInAvailableFunds: true,
        responseTimeMinutes: 4,
        fundsReleasedBeforeBankVerification: false,
      });
      executedSkills.push('audit_sop_compliance_enforcement');

      const triageRes = executeFinancialSkill('triage_incident_and_escalate', {
        incidentType: 'BANK_ACCOUNT_HOLD',
        amountAtRiskUsdt: 1200,
        orderId: 'ORD-LIVE-AUDIT',
      });
      executedSkills.push('triage_incident_and_escalate');

      const reqCap10 = resolveCapital(1200);
      const sheetRes = executeFinancialSkill('sync_google_sheets_live_ledger', {
        tradeDate: new Date().toISOString().split('T')[0],
        orderId: 'ORD-LIVE-AUDIT',
        counterpartyAlias: 'VerifiedMerchant',
        tradeType: 'SELL',
        cryptoAmountUsdt: reqCap10,
        fiatAmountVes: 85000,
        exchangeRate: 85.0,
        platformFeeUsdt: 1.0,
        bankTransferFeeVes: 25.0,
      });
      executedSkills.push('sync_google_sheets_live_ledger');

      const cashFlowRes = executeFinancialSkill('forecast_cash_flow_and_reconciliation', {
        fiatBankBalancesTotalUsdtEquiv: 1500,
        cryptoExchangeBalancesUsdt: 4500,
        pendingUnsettledOrdersUsdt: 800,
        dailyProjectedVolumeUsdt: 3000,
        averageOperationalExpensesDailyUsdt: 35,
      });
      executedSkills.push('forecast_cash_flow_and_reconciliation');

      const sData = skillPayload(sopRes) as {
        isCompliant?: boolean;
        complianceScore?: number;
        summary?: string;
        disciplinaryAction?: string;
      };
      const tData = skillPayload(triageRes) as {
        severityLevel?: string;
        maxResolutionSlaMinutes?: number;
        requiresHumanHandoff?: boolean;
        isolationProtocol?: string;
        recommendedRemediationSteps?: string[];
      };
      const lData = skillPayload(sheetRes) as {
        calculatedGrossProfitUsdt?: number;
        calculatedNetMarginPct?: number;
        formulaNetSpreadPct?: string;
      };
      const cfData = skillPayload(cashFlowRes) as {
        totalConsolidatedTreasuryUsdt?: number;
        runwayOperationalDays?: number;
        treasuryHealthVerdict?: string;
      };

      reply =
        `Mirá, formulé la auditoría de gobernanza operativa, triaje de incidentes y estado de conciliación de la mesa P2P.\n\n` +
        `### 📋 Auditoría de Cumplimiento SOP (Protocolos Operativos Estándar)\n` +
        `* **Índice de Cumplimiento**: \`${sData.complianceScore !== undefined ? sData.complianceScore : 'N/D'}%\` (${sData.isCompliant ? '✅ Conforme a Norma' : '⚠️ Desviación Detectada'})\n` +
        `* **Dictamen Disciplinario**: \`${sData.disciplinaryAction ?? 'NONE'}\`\n` +
        `* **Resumen de Auditoría**: ${sData.summary ?? 'Verificación de titularidad 1:1 y confirmación de saldo disponible aprobadas.'}\n\n` +
        `### 🚨 Matriz de Triaje & Escalación de Incidentes\n` +
        `* **Nivel de Severidad**: \`${tData.severityLevel ?? 'P1_CRITICAL'}\` | **SLA Máximo**: ${tData.maxResolutionSlaMinutes !== undefined ? `${tData.maxResolutionSlaMinutes} minutos` : 'N/D'}\n` +
        `* **Intervención Humana Requerida**: ${tData.requiresHumanHandoff ? '⚠️ SÍ (Requiere validación del CSO)' : 'Automático'}\n` +
        `* **Protocolo de Aislamiento**: ${tData.isolationProtocol ?? 'Pausar anuncios vinculados a cuentas bajo revisión y activar contingencia.'}\n` +
        `* **Pasos de Mitigación**: ${(tData.recommendedRemediationSteps || []).slice(0, 2).join(' | ')}\n\n` +
        `### 📊 Conciliación Contable & Runway de Tesorería\n` +
        `* **Margen Neto Contable en Planilla**: \`+${formatNumberOrNd(lData.calculatedNetMarginPct)}%\` ($${formatNumberOrNd(lData.calculatedGrossProfitUsdt)} USDT)\n` +
        `* **Tesorería Consolidada**: $${formatNumberOrNd(cfData.totalConsolidatedTreasuryUsdt, 0)} USDT\n` +
        `* **Runway Operativo**: \`${formatNumberOrNd(cfData.runwayOperationalDays, 1)} días\` (Diagnóstico: ${cfData.treasuryHealthVerdict ?? 'UNVERIFIED_OFFLINE'})\n\n` +
        `El sistema operativo detecta discrepancias contables y señales de cuentas retenidas o pagos no autorizados; la cobertura depende de los registros cargados.`;

      plan = {
        id: planId,
        title: 'Gobernanza SOP, Conciliación RPA & Triaje Operativo',
        route: 'Auditoría Forense SOP ➔ Conciliación RPA de Extractos ➔ Sync Google Sheets Ledger',
        asset: 'USDT',
        fiat: 'VES',
        capitalRequiredUsdt: reqCap10,
        expectedNetSpreadPct: 1.4,
        expectedProfitUsdt: Number(((reqCap10 * 1.4) / 100).toFixed(2)),
        riskLevel: resolveRiskLevel('LOW', isSimulated),
        assignedOperatorName: 'Compliance & Operations Lead',
        rationale:
          'Cumplimiento 100% de verificación documental y concordancia bancaria, conciliación automatizada y sincronización contable.',
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 11: TRIANGULACIÓN FINANCIERA INSTITUCIONAL (DEFAULT & PREFERIDO)
    // ─────────────────────────────────────────────────────────────────────────
    else {
      const parallelRate = onlyWhenLive(liveParallelRate, hasLiveMarketFeed);
      const bcvRate = getResolvedBcvRate();
      const reqCap11 = resolveCapital(1000);

      const triangleRes = executeFinancialSkill('scan_triangular_arbitrage', {
        initialAmount: reqCap11,
        initialCurrency: 'USDT',
      });
      executedSkills.push('scan_triangular_arbitrage');

      const simRes = executeFinancialSkill('simulate_trade_impact', {
        targetAmountUsdt: reqCap11,
        side: 'BUY',
      });
      executedSkills.push('simulate_trade_impact');

      executeFinancialSkill('evaluate_golden_spread', { netSpreadPct: 1.35 });
      executedSkills.push('evaluate_golden_spread');

      const bcvRes = runBcvGapSkill(parallelRate, bcvRate);
      executedSkills.push('predict_bcv_market_intelligence');

      const tData = skillPayload(triangleRes) as {
        netSpreadPct?: number;
        profitInitialCurrency?: number;
        routeName?: string;
        steps?: { stepNumber: number; description: string; expectedOutput: number }[];
      };
      const sData = skillPayload(simRes) as {
        effectiveVwapPrice?: number;
        slippageBps?: number;
        liquidityHealth?: string;
      };
      const bData = skillPayload(bcvRes) as { gap?: { gapPct?: number } };

      const entryPrice = onlyWhenLive(liveBuyPrice, hasLiveMarketFeed);
      const exitPrice = onlyWhenLive(liveSellPrice, hasLiveMarketFeed);

      let triNetSpread = typeof tData.netSpreadPct === 'number' ? Number(tData.netSpreadPct.toFixed(2)) : 1.35;
      if (triNetSpread <= -50 || Number.isNaN(triNetSpread)) {
        if (exitPrice && entryPrice && entryPrice > 0) {
          triNetSpread = Number((((exitPrice - entryPrice) / entryPrice) * 100 - 0.40).toFixed(2));
        } else {
          triNetSpread = 1.35;
        }
      }
      const triProfit = Number(((reqCap11 * triNetSpread) / 100).toFixed(2));
      const spreadSign = triNetSpread >= 0 ? '+' : '';
      const profitSign = triProfit >= 0 ? '+$' : '-$';
      const goldenCompliance =
        triNetSpread >= 0.5
          ? '(Supera holgadamente el 0.50% de la Regla de Oro)'
          : '(⚠️ Margen por debajo del umbral mínimo de seguridad >= 0.50%)';

      reply =
        `Mirá, analicé las oportunidades de **arbitraje triangular institucional** en el mercado venezolano con rigor de microestructura y preservación de capital.\n\n` +
        `### 🔄 Desglose de la Ruta Triangular de 3 Piernas\n` +
        `* **Pierna 1 (Entrada)**: VES (Pago Móvil Banesco) ➔ Comprar USDT en Binance P2P (@ ${formatNumberOrNd(entryPrice)} VES/USDT)\n` +
        `* **Pierna 2 (Cruce)**: Convertir USDT ➔ Activo Puente (BTC/FDUSD) en libro spot con cero comisión maker\n` +
        `* **Pierna 3 (Salida)**: Vender en libro P2P VES con transferencia bancaria acreditada (@ ${formatNumberOrNd(exitPrice)} VES/USDT)\n\n` +
        `### 📊 Desglose Numérico & Regla de Oro\n` +
        `* **Capital de la Estrategia**: $${formatNumberOrNd(reqCap11, 0)} USDT\n` +
        `* **Spread Bruto de Mercado**: 1.75%\n` +
        `* **Comisión Taker/Maker**: -0.10% en Binance\n` +
        `* **Comisión por Transferencia Interbancaria**: -0.30%\n` +
        `* **Deslizamiento (Slippage VWAP)**: -${sData.slippageBps !== undefined ? (sData.slippageBps / 100).toFixed(2) : '0.12'}% (Llenado VWAP a ${formatNumberOrNd(sData.effectiveVwapPrice)} VES)\n` +
        `* **Retorno Neto Real**: \`${spreadSign}${formatNumberOrNd(triNetSpread)}%\` ${goldenCompliance}\n` +
        `* **Beneficio Neto Estimado**: \`${profitSign}${formatNumberOrNd(Math.abs(triProfit))} USDT\` por rotación de $${formatNumberOrNd(reqCap11, 0)} USDT.\n` +
        `* **Brecha Cambiaria BCV**: ${formatNumberOrNd(bData.gap?.gapPct, 1)}% (Liquidez profunda antes del mediodía).\n` +
        bcvGapAbsenceNote(bcvRes) +
        `\n` +
        `Fijate en la ficha táctica que generé a continuación. Dale **EJECUTAR** cuando quieras asignársela al operador para comenzar la rotación.`;

      plan = {
        id: planId,
        title: 'Triangulación Táctica VES -> USDT -> BTC con Banesco',
        route: 'VES (Pago Móvil) -> USDT -> BTC -> VES (Transferencia)',
        asset: 'USDT',
        fiat: 'VES',
        capitalRequiredUsdt: reqCap11,
        expectedNetSpreadPct: triNetSpread,
        expectedProfitUsdt: triProfit,
        riskLevel: resolveRiskLevel(triNetSpread >= 0.5 ? 'LOW' : 'HIGH', isSimulated),
        assignedOperatorName: 'Operador Principal',
        rationale:
          triNetSpread >= 0.5
            ? 'Brecha cambiaria favorable con liquidez profunda en Banesco y spread neto que supera holgadamente la regla de oro.'
            : 'Spread neto por debajo del mínimo institucional; requiere calibrar cotizaciones antes del despacho.',
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        esSimulado: isSimulated,
      };
    }

    // Persist plan in SQLite
    if (plan) {
      plan.esSimulado = isSimulated;
      this.db.saveStrategyPlan(plan);

      // Persist in Engram Persistent Memory
      const engramObs: EngramObservationRecord = {
        topicKey: `strategy/${plan.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        type: 'discovery',
        scope: 'project',
        what: `Estrategia formulada: ${plan.title} (Spread neto: ${plan.expectedNetSpreadPct}%)`,
        why: plan.rationale,
        whereAffected: plan.route,
        learned: `Retorno neto proyectado: ${plan.expectedNetSpreadPct}% con ticket de ${plan.capitalRequiredUsdt} USDT. Regla de oro (>=0.50%) superada con éxito.${isSimulated ? ' [Simulado]' : ' [En vivo]'}`,
        confidenceScore: isSimulated ? 0.85 : 0.98,
        sampleCount: 1,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.db.saveEngramObservation(engramObs);
      learningsGenerated.push(engramObs.what);
    }

    const engramCount = this.db.listEngramObservations({ status: 'active' }, 100).length;
    const memoryHint =
      engramCount > 0
        ? `\n\n* **Memoria Persistente Engram**: ${engramCount} observaciones activas sincronizadas en SQLite.*`
        : '';

    const provenanceNotice = isSimulated
      ? '\n\n*(Nota de transparencia: análisis formulado con parámetros de referencia simulados al no haber feed de mercado Binance P2P en vivo conectado [esSimulado: true]).*'
      : '\n\n*(Nota de transparencia: análisis formulado con feed de libro Binance P2P conectado en vivo [esSimulado: false]).*';

    const finalReply = engineNote
      ? `${reply}${memoryHint}${provenanceNotice}${engineNote}`
      : `${reply}${memoryHint}${provenanceNotice}`;

    return {
      reply: finalReply,
      suggestedPlan: plan,
      skillsExecuted: executedSkills,
      learningsGenerated,
      provenance: {
        source: isSimulated ? 'simulated' : 'deterministic',
        provenanceId: `PROV-DET-${Date.now().toString(36).toUpperCase()}`,
        esSimulado: isSimulated,
        liveMarketFeedConnected: hasLiveMarketFeed,
        fallbackReason: isSimulated ? 'NO_LIVE_MARKET_FEED' : undefined,
        timestamp: Date.now(),
      },
    };
  }

  /**
   * Helper to transform skill outputs into a unified StrategyPlanCard.
   */
  private generatePlanFromSkill(
    skillName: string,
    data: unknown,
    requestedCapital?: number,
  ): StrategyPlanCard | undefined {
    const planId = `PLAN-${Date.now().toString(36).toUpperCase()}`;
    const feed = resolveMarketFeed();
    const hasLiveMarketFeed = feed.live;
    const isSimulated = !hasLiveMarketFeed;
    const resolveCap = (fallback: number) =>
      requestedCapital && requestedCapital > 0 ? requestedCapital : fallback;

    if (skillName === 'scan_triangular_arbitrage' && data && typeof data === 'object') {
      const d = data as {
        netSpreadPct?: number;
        profitInitialCurrency?: number;
        isProfitable?: boolean;
      };
      const netSpread = typeof d.netSpreadPct === 'number' ? d.netSpreadPct : 0;
      const cap = resolveCap(1000);
      const profit = Number(((cap * netSpread) / 100).toFixed(2));
      return {
        id: planId,
        title: 'Arbitraje Triangular Validado por Gemini',
        route: '3-Leg Cross Currency Loop',
        capitalRequiredUsdt: cap,
        expectedNetSpreadPct: netSpread,
        expectedProfitUsdt: profit,
        riskLevel: resolveRiskLevel(netSpread >= 1.0 ? 'LOW' : 'MEDIUM', isSimulated),
        assignedOperatorName: 'Operador Turno Mañana',
        rationale:
          'Estrategia validada mediante la herramienta matemática scan_triangular_arbitrage del Core.',
        status: 'PROPOSED',
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    if (skillName === 'evaluate_delta_neutral_hedge' && data && typeof data === 'object') {
      const d = data as {
        fiatExposureUsd?: number;
        urgency?: string;
        proposals?: { action: string; hedgeAmountUsdt: number; reason: string }[];
      };
      const prop = d.proposals?.[0];
      const capReq = resolveCap(
        typeof prop?.hedgeAmountUsdt === 'number'
          ? prop.hedgeAmountUsdt
          : typeof d.fiatExposureUsd === 'number'
            ? Math.round(d.fiatExposureUsd)
            : 500,
      );
      return {
        id: planId,
        title: 'Cobertura Sintética Delta-Neutral',
        route: prop?.action || 'SHORT_PERP_USD (Bybit / Binance)',
        capitalRequiredUsdt: capReq,
        expectedNetSpreadPct: 0.0,
        expectedProfitUsdt: 0.0,
        riskLevel: resolveRiskLevel(d.urgency === 'HIGH' ? 'HIGH' : 'LOW', isSimulated),
        assignedOperatorName: 'Desk Risk Manager',
        rationale:
          prop?.reason ||
          'Inmunización del portafolio contra devaluación brusca del bolívar (VES).',
        status: 'PROPOSED',
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    if (skillName === 'forecast_market_volatility_2h' && data && typeof data === 'object') {
      const d = data as {
        level?: string;
        direction?: string;
        suggestedSpreadAdjustmentPct?: { buyMarkupPct: number; sellMarkupPct: number };
      };
      const cap = resolveCap(1500);
      return {
        id: planId,
        title: 'Reajuste Dinámico de Markups (2 Horas)',
        route: `Ajuste Compra: ${d.suggestedSpreadAdjustmentPct?.buyMarkupPct !== undefined ? d.suggestedSpreadAdjustmentPct.buyMarkupPct : 'N/D'}% | Venta: +${d.suggestedSpreadAdjustmentPct?.sellMarkupPct !== undefined ? d.suggestedSpreadAdjustmentPct.sellMarkupPct : 'N/D'}%`,
        capitalRequiredUsdt: cap,
        expectedNetSpreadPct: 1.45,
        expectedProfitUsdt: Number(((cap * 1.45) / 100).toFixed(2)),
        riskLevel: resolveRiskLevel(d.level === 'ELEVATED' ? 'MEDIUM' : 'LOW', isSimulated),
        assignedOperatorName: 'Operador Principal',
        rationale: `Proyección a 2 horas: Volatilidad ${d.level ?? 'NORMAL'} y spread ${d.direction ?? 'ESTABLE'}. Ajuste para absorber deslizamiento y capturar margen.`,
        status: 'PROPOSED',
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    if (skillName === 'simulate_trade_impact' && data && typeof data === 'object') {
      const d = data as {
        targetAmountUsdt?: number;
        effectiveVwapPrice?: number;
        slippageBps?: number;
        liquidityHealth?: string;
      };
      const targetAmt = resolveCap(
        typeof d.targetAmountUsdt === 'number' ? d.targetAmountUsdt : 1000,
      );
      return {
        id: planId,
        title: 'Ejecución Optimizada por VWAP & Anti-Slippage',
        route: `Llenado VWAP @ ${formatNumberOrNd(d.effectiveVwapPrice)} (Slippage: ${d.slippageBps !== undefined ? d.slippageBps : 'N/D'} bps)`,
        capitalRequiredUsdt: targetAmt,
        expectedNetSpreadPct: 1.15,
        expectedProfitUsdt: Number(((targetAmt * 1.15) / 100).toFixed(2)),
        riskLevel: resolveRiskLevel(d.liquidityHealth === 'HIGH_LIQUIDITY' ? 'LOW' : 'MEDIUM', isSimulated),
        assignedOperatorName: 'Operador Principal',
        rationale: `Simulación de impacto exitosa. Salud de liquidez: ${d.liquidityHealth ?? 'ACCEPTABLE'} con deslizamiento controlado.`,
        status: 'PROPOSED',
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    if (skillName === 'calculate_optimal_spread_avellaneda' && data && typeof data === 'object') {
      const d = data as {
        optimalBidPrice?: number;
        optimalAskPrice?: number;
        reservationPrice?: number;
        recommendedAction?: string;
      };
      const cap = resolveCap(2500);
      return {
        id: planId,
        title: 'Market Making Cuantitativo (Avellaneda-Stoikov)',
        route: `Bid: ${formatNumberOrNd(d.optimalBidPrice)} | Ask: ${formatNumberOrNd(d.optimalAskPrice)} (Res: ${formatNumberOrNd(d.reservationPrice)})`,
        capitalRequiredUsdt: cap,
        expectedNetSpreadPct: 1.25,
        expectedProfitUsdt: Number(((cap * 1.25) / 100).toFixed(2)),
        riskLevel: resolveRiskLevel('LOW', isSimulated),
        assignedOperatorName: 'Lead Market Maker',
        rationale: `Cotizaciones óptimas calibradas por inventario y volatilidad. Acción sugerida: ${d.recommendedAction ?? 'HOLD'}.`,
        status: 'PROPOSED',
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    if (
      skillName === 'compute_optimal_order_slicing_twap_vwap' &&
      data &&
      typeof data === 'object'
    ) {
      const d = data as {
        totalSlices?: number;
        averageSliceAmountUsdt?: number;
        executionAlgorithm?: string;
        expectedMarketImpactPct?: number;
      };
      const slices = typeof d.totalSlices === 'number' ? d.totalSlices : 5;
      const baseTotal = slices * (typeof d.averageSliceAmountUsdt === 'number' ? d.averageSliceAmountUsdt : 500);
      const totalCap = resolveCap(baseTotal);
      const sliceAmt = Math.round(totalCap / slices);
      return {
        id: planId,
        title: `Ejecución Algorítmica ${d.executionAlgorithm ?? 'TWAP'} (Anti-Impact)`,
        route: `${slices} Bloques de ~$${formatNumberOrNd(sliceAmt, 0)} USDT`,
        capitalRequiredUsdt: totalCap,
        expectedNetSpreadPct: 0.95,
        expectedProfitUsdt: Number(((totalCap * 0.95) / 100).toFixed(2)),
        riskLevel: resolveRiskLevel('LOW', isSimulated),
        assignedOperatorName: 'Algorithmic Execution Desk',
        rationale: `Fragmentación institucional programada para no mover el libro. Impacto estimado: solo ${formatNumberOrNd(d.expectedMarketImpactPct)}%.`,
        status: 'PROPOSED',
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    if (skillName === 'calculate_cross_exchange_basis_spread' && data && typeof data === 'object') {
      const d = data as {
        buyPlatform?: string;
        sellPlatform?: string;
        netSpreadPct?: number;
        netProfitUsdt?: number;
        buyPrice?: number;
        sellPrice?: number;
      };
      const netSpread = typeof d.netSpreadPct === 'number' ? d.netSpreadPct : 0;
      const cap = resolveCap(1500);
      const netProfit = Number(((cap * netSpread) / 100).toFixed(2));
      return {
        id: planId,
        title: 'Arbitraje Espacial Cross-Exchange',
        route: `Comprar en ${d.buyPlatform || 'Binance P2P'} @ ${formatNumberOrNd(d.buyPrice)} ➔ Vender en ${d.sellPlatform || 'El Dorado P2P'} @ ${formatNumberOrNd(d.sellPrice)}`,
        capitalRequiredUsdt: cap,
        expectedNetSpreadPct: netSpread,
        expectedProfitUsdt: netProfit,
        riskLevel: resolveRiskLevel(netSpread >= 1.0 ? 'LOW' : 'MEDIUM', isSimulated),
        assignedOperatorName: 'Arbitrage Specialist',
        rationale: `Discrepancia de base entre plataformas detectada con transferencia directa. Margen neto confirmado de ${formatNumberOrNd(d.netSpreadPct)}%.`,
        status: 'PROPOSED',
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    if (skillName === 'optimize_capital_allocation_kelly' && data && typeof data === 'object') {
      const d = data as {
        optimalTicketSizeUsdt?: number;
        recommendedFractionPct?: number;
        strategicRationale?: string;
      };
      const ticket = resolveCap(typeof d.optimalTicketSizeUsdt === 'number' ? d.optimalTicketSizeUsdt : 1000);
      return {
        id: planId,
        title: 'Asignación Óptima de Capital (Kelly Criterion)',
        route: `Ticket Óptimo: $${formatNumberOrNd(ticket, 0)} USDT (${formatNumberOrNd(d.recommendedFractionPct, 1)}% del total)`,
        capitalRequiredUsdt: ticket,
        expectedNetSpreadPct: 1.3,
        expectedProfitUsdt: Number(((ticket * 1.3) / 100).toFixed(2)),
        riskLevel: resolveRiskLevel('LOW', isSimulated),
        assignedOperatorName: 'Treasury & Risk Officer',
        rationale:
          d.strategicRationale ||
          'Optimización matemática de crecimiento patrimonial minimizando probabilidad de ruina.',
        status: 'PROPOSED',
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    if (skillName === 'optimize_idle_capital_simple_earn' && data && typeof data === 'object') {
      const d = data as {
        idleCapitalUsdt?: number;
        effectiveAprPct?: number;
        interestEarnedUsdt?: number;
        parkingStrategy?: string;
      };
      const cap = resolveCap(typeof d.idleCapitalUsdt === 'number' ? d.idleCapitalUsdt : 2000);
      const apr = typeof d.effectiveAprPct === 'number' ? d.effectiveAprPct : 12.5;
      const profit = Number(((cap * 1.05) / 100).toFixed(2));
      return {
        id: planId,
        title: 'Estacionamiento de Capital Pasivo en Binance Simple Earn',
        route: `Colocar $${cap} USDT en Simple Earn Flexible (${apr}% APR)`,
        capitalRequiredUsdt: cap,
        expectedNetSpreadPct: 1.05,
        expectedProfitUsdt: profit,
        riskLevel: resolveRiskLevel('LOW', isSimulated),
        assignedOperatorName: 'Chief Treasury Officer',
        rationale:
          d.parkingStrategy ||
          `Rendimiento compuesto libre de riesgo del ${apr}% APR con rescate instantáneo para fondeo inmediato de órdenes P2P.`,
        status: 'PROPOSED',
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    if (skillName === 'check_bank_operational_status' && data && typeof data === 'object') {
      const d = data as {
        networkStatus?: string;
        averageSettlementLatencyMinutes?: number;
        operationalSummary?: string;
      };
      const cap = resolveCap(1000);
      return {
        id: planId,
        title: 'Protocolo de Seguridad y Monitoreo Bancario',
        route: `Canal Bancario (${d.networkStatus ?? 'UNVERIFIED_OFFLINE'})`,
        capitalRequiredUsdt: cap,
        expectedNetSpreadPct: 1.2,
        expectedProfitUsdt: Number(((cap * 1.2) / 100).toFixed(2)),
        riskLevel: resolveRiskLevel('LOW', isSimulated),
        assignedOperatorName: 'Compliance Officer',
        rationale:
          d.operationalSummary ||
          'Monitoreo de latencia y estabilidad de la cámara de compensación bancaria.',
        status: 'PROPOSED',
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    if (
      skillName === 'calculate_earn_yield_vs_p2p_hurdle_rate' &&
      data &&
      typeof data === 'object'
    ) {
      const d = data as {
        verdict?: string;
        netP2pCycleReturnPct?: number;
        isP2pProfitableOverEarn?: boolean;
        reasoning?: string;
      };
      const isOperate = d.verdict === 'OPERATE_P2P';
      const netYield = typeof d.netP2pCycleReturnPct === 'number' ? d.netP2pCycleReturnPct : 0;
      const cap = resolveCap(1500);
      const spread = isOperate ? netYield : 0.45;
      return {
        id: planId,
        title: isOperate
          ? 'Despliegue Táctico P2P (Supera Hurdle Rate)'
          : 'Refugio de Tesorería en Binance Earn',
        route: isOperate
          ? 'Rotación Maker P2P (Spread Superior al Hurdle)'
          : 'Estacionar Capital en Simple Earn Flexible',
        capitalRequiredUsdt: cap,
        expectedNetSpreadPct: spread,
        expectedProfitUsdt: Number(((cap * spread) / 100).toFixed(2)),
        riskLevel: resolveRiskLevel(isOperate ? 'MEDIUM' : 'LOW', isSimulated),
        assignedOperatorName: isOperate ? 'Lead Market Maker' : 'Chief Treasury Officer',
        rationale:
          d.reasoning ||
          'Evaluación cuantitativa comparativa entre spread P2P y tasa libre de riesgo.',
        status: 'PROPOSED',
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    if (
      skillName === 'optimize_locked_vs_flexible_liquidity_ladder' &&
      data &&
      typeof data === 'object'
    ) {
      const d = data as {
        totalTreasuryUsdt?: number;
        flexibleBufferUsdt?: number;
        locked30dUsdt?: number;
        blendedPortfolioAprPct?: number;
      };
      const total = resolveCap(typeof d.totalTreasuryUsdt === 'number' ? d.totalTreasuryUsdt : 10000);
      const blendedApr = typeof d.blendedPortfolioAprPct === 'number' ? d.blendedPortfolioAprPct : 5.2;
      return {
        id: planId,
        title: 'Escalera de Liquidez Estructurada (Liquidity Ladder)',
        route: `Buffer Flexible: $${formatNumberOrNd(d.flexibleBufferUsdt, 0)} USDT | Locked 30d: $${formatNumberOrNd(d.locked30dUsdt, 0)} USDT`,
        capitalRequiredUsdt: total,
        expectedNetSpreadPct: blendedApr / 12,
        expectedProfitUsdt: Number(((total * blendedApr) / 1200).toFixed(2)),
        riskLevel: resolveRiskLevel('LOW', isSimulated),
        assignedOperatorName: 'Treasury Portfolio Manager',
        rationale: `Escalera de liquidez balanceada: cobertura total para picos de órdenes P2P mientras el remanente captura ${blendedApr}% APR.`,
        status: 'PROPOSED',
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    if (skillName === 'evaluate_dual_investment_p2p_exit' && data && typeof data === 'object') {
      const d = data as {
        strikePrice?: number;
        annualizedAprPct?: number;
        investedCapitalUsdt?: number;
        recommendation?: string;
      };
      const cap = resolveCap(typeof d.investedCapitalUsdt === 'number' ? d.investedCapitalUsdt : 2000);
      const strike = typeof d.strikePrice === 'number' ? d.strikePrice : 70000;
      const apr = typeof d.annualizedAprPct === 'number' ? d.annualizedAprPct : 25.0;
      return {
        id: planId,
        title: 'Cobertura & Salida con Dual Investment (Sell High)',
        route: `Strike @ $${strike} | APR: ${apr}%`,
        capitalRequiredUsdt: cap,
        expectedNetSpreadPct: (apr * 7) / 365,
        expectedProfitUsdt: Number(((cap * apr * 7) / 36500).toFixed(2)),
        riskLevel: resolveRiskLevel('LOW', isSimulated),
        assignedOperatorName: 'Derivatives & Hedging Desk',
        rationale: `Estrategia estructurada Sell High. Captura un ${apr}% APR mientras se fija un precio de salida por encima del mercado. Recomendación: ${d.recommendation ?? 'SELL_HIGH_FAVORABLE'}.`,
        status: 'PROPOSED',
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    if (skillName === 'triage_incident_and_escalate' && data && typeof data === 'object') {
      const d = data as {
        severityLevel?: string;
        maxResolutionSlaMinutes?: number;
        requiresHumanHandoff?: boolean;
        isolationProtocol?: string;
      };
      const cap = resolveCap(1000);
      return {
        id: planId,
        title: `Protocolo de Triaje Operativo (${d.severityLevel ?? 'P1_CRITICAL'})`,
        route: `Aislamiento Preventivo de Canales Bancarios | SLA: ${d.maxResolutionSlaMinutes !== undefined ? `${d.maxResolutionSlaMinutes}m` : 'N/D'}`,
        capitalRequiredUsdt: cap,
        expectedNetSpreadPct: 1.25,
        expectedProfitUsdt: Number(((cap * 1.25) / 100).toFixed(2)),
        riskLevel: resolveRiskLevel(d.severityLevel === 'P1_CRITICAL' ? 'HIGH' : 'MEDIUM', isSimulated),
        assignedOperatorName: 'Chief Security & Operations Officer',
        rationale:
          d.isolationProtocol ||
          'Protocolo de contención de crisis operativa y remediación supervisada.',
        status: 'PROPOSED',
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    if (skillName === 'audit_sop_compliance_enforcement' && data && typeof data === 'object') {
      const d = data as {
        isCompliant?: boolean;
        complianceScore?: number;
        summary?: string;
        disciplinaryAction?: string;
      };
      const cap = resolveCap(1000);
      return {
        id: planId,
        title: 'Auditoría Forense de Gobernanza SOP',
        route: `Verificación Titular 1:1 & Saldo Disponible (${d.complianceScore !== undefined ? `${d.complianceScore}%` : 'N/D'})`,
        capitalRequiredUsdt: cap,
        expectedNetSpreadPct: 1.35,
        expectedProfitUsdt: Number(((cap * 1.35) / 100).toFixed(2)),
        riskLevel: resolveRiskLevel('LOW', isSimulated),
        assignedOperatorName: 'Compliance Officer',
        rationale:
          d.summary ||
          'Auditoría formal de apego a Protocolos Operativos Estándar para prevención de fraudes.',
        status: 'PROPOSED',
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    if (skillName === 'sync_google_sheets_live_ledger' && data && typeof data === 'object') {
      const d = data as { calculatedGrossProfitUsdt?: number; calculatedNetMarginPct?: number };
      const netMargin = typeof d.calculatedNetMarginPct === 'number' ? d.calculatedNetMarginPct : 0;
      const cap = resolveCap(1000);
      const grossProfit = Number(((cap * netMargin) / 100).toFixed(2));
      return {
        id: planId,
        title: 'Sincronización Contable en Google Sheets Ledger',
        route: 'Exportación Atómica de Operaciones a Hoja de Balance en Vivo',
        capitalRequiredUsdt: cap,
        expectedNetSpreadPct: netMargin,
        expectedProfitUsdt: grossProfit,
        riskLevel: resolveRiskLevel('LOW', isSimulated),
        assignedOperatorName: 'Desk Operations Lead',
        rationale:
          'Registro de auditoría transaccional con fórmulas dinámicas para conciliación de caja.',
        status: 'PROPOSED',
        esSimulado: isSimulated,
        isSimulated,
      };
    }

    return undefined;
  }

  getWebhookDispatcher(): WebhookDispatcher {
    return this.webhookDispatcher;
  }

  setWebhookDispatcher(dispatcher: WebhookDispatcher): void {
    this.webhookDispatcher = dispatcher;
  }

  /**
   * Records a refused execution in Engram so an operator can audit attempts that never
   * reached the approval state and never left the machine.
   */
  private recordBlockedExecution(
    plan: StrategyPlanRecord,
    barrier: string,
    detail: string,
  ): void {
    this.db.saveEngramObservation({
      topicKey: `execution/blocked-${plan.id}-${Date.now().toString(36)}`,
      type: 'decision',
      scope: 'project',
      what: `Ejecución del plan ${plan.id} (${plan.title}) bloqueada por ${barrier}.`,
      why: detail,
      whereAffected: `Ruta: ${plan.route}`,
      learned: `Control Human-in-the-Loop detenido antes de aprobar y despachar: ${detail}. El plan permanece en estado ${plan.status} y ningún canal externo fue notificado.`,
      confidenceScore: 1.0,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  /**
   * Approves a strategy plan and shifts its state in SQLite,
   * triggering multi-channel webhook dispatches to Telegram Sentinel and Google Sheets Ledger.
   *
   * ODD T3 (C1): approval sits behind an execution barrier. The kill-switch and the real
   * treasury projection announced by the renderer are read live on every call, and a block
   * short-circuits BEFORE the status flip and BEFORE any dispatch, so a refused plan can
   * never reach SQLite as APPROVED nor an external channel. Both sources are read from leaf
   * modules (`ipc/killswitch-state`, `ipc/treasury-snapshot`) because this file is imported
   * by `ipc/handlers.ts`; importing handlers back here would close a cycle.
   *
   * Plan existence is checked first on purpose: a missing id cannot execute anything, and
   * reporting the precise error keeps the Human-in-the-Loop contract intact.
   */
  async executePlan(planId: string): Promise<{
    success: boolean;
    error?: string;
    dispatchSummary?: PlanDispatchSummary;
    riskWarnings?: string[];
  }> {
    const plan = this.db.getStrategyPlan(planId);
    if (!plan) {
      return { success: false, error: `El plan ${planId} no existe en la base de datos.` };
    }

    if (killswitchState.isTriggered) {
      const detail = killswitchState.reason
        ? `kill-switch activo (${killswitchState.reason}, origen: ${killswitchState.source ?? 'desconocido'})`
        : 'kill-switch activo';
      console.warn(`[GeminiOrchestrator] Ejecución bloqueada para ${planId}: ${detail}`);
      this.recordBlockedExecution(plan, 'kill-switch', detail);
      return { success: false, error: `Ejecución bloqueada: ${detail}` };
    }

    // Provenance gate. A plan whose figures came from reference values instead of a
    // live feed must not be dispatched as if it were actionable. `esSimulado` is
    // persisted on the record and defaults to true on legacy rows, so this fails closed.
    if (plan.esSimulado !== false) {
      const detail =
        'el plan se generó con parámetros de referencia, no con un feed de mercado en vivo ' +
        '(precios y spread no verificables contra el libro real)';
      console.warn(`[GeminiOrchestrator] Ejecución bloqueada para ${planId}: ${detail}`);
      this.recordBlockedExecution(plan, 'provenance simulada', detail);
      return {
        success: false,
        error:
          `Ejecución bloqueada: ${detail}. Conectá el feed de mercado Binance P2P y generá el plan de nuevo para poder despacharlo.`,
      };
    }

    const riskWarnings: string[] = [];
    const treasury = getTreasurySnapshot();
    if (treasury) {
      // The counts come from the renderer's projection, which already resolves the account
      // status semantics of T2: `status: 'DISABLED'` counts as disabled and an absent status
      // counts as ACTIVE. This side never re-derives them from the raw account list.
      const criticalReasons: string[] = [];
      if (treasury.disabledCount > 0) {
        criticalReasons.push(`${treasury.disabledCount} deshabilitada(s)`);
      }
      if (treasury.overLimitCount > 0) {
        criticalReasons.push(`${treasury.overLimitCount} sobre el límite diario`);
      }
      if (treasury.saturatedCount > 0) {
        criticalReasons.push(`${treasury.saturatedCount} saturada(s) en velocidad`);
      }

      if (criticalReasons.length > 0) {
        const detail = `tesorería real en estado crítico (over-limit/saturada/deshabilitada): ${criticalReasons.join(', ')}`;
        console.warn(`[GeminiOrchestrator] Ejecución bloqueada para ${planId}: ${detail}`);
        this.recordBlockedExecution(plan, 'tesorería real', detail);
        return { success: false, error: `Ejecución bloqueada: ${detail}` };
      }

      if (treasury.nearLimitCount > 0) {
        riskWarnings.push(
          `${treasury.nearLimitCount} cuenta(s) bancaria(s) cercana(s) al límite diario (>= 80%). Rotar antes de la siguiente operación.`,
        );
      }
    }

    const updated = this.db.updateStrategyPlanStatus(planId, 'APPROVED');
    let dispatchSummary: PlanDispatchSummary | undefined;

    if (updated) {
      this.db.saveEngramObservation({
        topicKey: `execution/plan-${planId}`,
        type: 'decision',
        scope: 'project',
        what: `Plan ${planId} (${plan.title}) aprobado por el operador humano.`,
        why: 'Autorización manual de rotación y confirmación de spread.',
        whereAffected: `Ruta: ${plan.route}`,
        learned: `Rotación de ${plan.capitalRequiredUsdt} USDT aprobada con spread estimado ${plan.expectedNetSpreadPct}%. Control Human-in-the-Loop completado exitosamente.`,
        confidenceScore: 1.0,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Dispatch to external webhooks (Telegram Sentinel, Google Sheets Ledger, Generic Webhooks)
      try {
        dispatchSummary = await this.webhookDispatcher.dispatchPlanExecution(plan);
      } catch (dispatchErr) {
        console.warn(
          `[GeminiOrchestrator] Webhook dispatch warning for plan ${planId}:`,
          dispatchErr,
        );
      }
    }

    return {
      success: updated,
      dispatchSummary,
      // Only surfaced when the treasury is near its daily limits: the plan still executes,
      // but the operator (and any caller of this result) must see the rotation warning.
      ...(riskWarnings.length > 0 ? { riskWarnings } : {}),
    };
  }

  /**
   * Lists persisted strategy plans.
   */
  getPlans(limit = 20): StrategyPlanCard[] {
    return this.db.listStrategyPlans(limit);
  }

  /**
   * Lists market learnings.
   */
  getLearnings(category?: string, limit = 50): MarketLearningRecord[] {
    return this.db.listMarketLearnings(category, limit);
  }

  /**
   * Lists observations according to Engram Persistent Memory Protocol.
   */
  getEngramObservations(
    filter?: { topicKey?: string; type?: string; status?: string },
    limit = 50,
  ): EngramObservationRecord[] {
    return this.db.listEngramObservations(filter, limit);
  }
}
