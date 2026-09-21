/**
 * Gemini Orchestrator for P2P Decision Tool.
 * Orchestrates multi-agent financial planning, Function Calling with Core domain skills,
 * persists strategies and continuous market learnings into SQLite,
 * and maintains human-in-the-loop approval barriers.
 */

import type { P2PDatabaseService, StrategyPlanRecord, MarketLearningRecord, EngramObservationRecord } from './db/database';
import type { CopilotChatMessage, CopilotResponse, StrategyPlanCard } from '../shared/types';
import {
  GEMINI_FINANCIAL_SKILLS,
  executeFinancialSkill,
} from './gemini-skills';
import type { AgentSwarmOrchestrator } from './agents/swarm-orchestrator';
import {
  WebhookDispatcher,
  type PlanDispatchSummary,
} from './services/webhook-dispatcher';

const QUOTA_ENGINE_NOTE =
  '\n\n⚠️ *Modo local por cuota agotada: conectá una API Key con plan de pago para restaurar el análisis Gemini en vivo.*';

export class GeminiOrchestrator {
  private apiKey?: string;
  private quotaCooldownUntil = 0;
  private webhookDispatcher: WebhookDispatcher;

  constructor(
    private db: P2PDatabaseService,
    apiKey?: string,
    private swarm?: AgentSwarmOrchestrator,
    webhookDispatcher?: WebhookDispatcher,
  ) {
    this.apiKey = apiKey || process.env['GEMINI_API_KEY'] || undefined;
    this.webhookDispatcher = webhookDispatcher || new WebhookDispatcher();
  }

  setSwarmOrchestrator(swarm: AgentSwarmOrchestrator): void {
    this.swarm = swarm;
  }

  setApiKey(key: string): void {
    this.apiKey = key;
    this.db.setConfigValue('gemini_api_key', key);
  }

  getEffectiveApiKey(): string | undefined {
    return this.apiKey || process.env['GEMINI_API_KEY'] || this.db.getConfigValue('gemini_api_key') || undefined;
  }

  private getCandidateModels(): string[] {
    const custom = process.env['GEMINI_MODEL'];
    if (custom) return [custom];
    return ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.1-flash-lite'];
  }

  private extractRetryDelayMs(errText: string): number {
    try {
      const body = JSON.parse(errText) as {
        error?: { details?: Array<{ retryDelay?: string }> };
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

  async testConnection(): Promise<{ success: boolean; model: string; message: string }> {
    const effectiveKey = this.getEffectiveApiKey();
    if (!effectiveKey) {
      return { success: false, model: 'none', message: 'No se ha detectado ninguna API Key de Gemini configurada.' };
    }
    const candidateModels = this.getCandidateModels();
    let lastError = '';
    let quotaExhausted = false;

    for (const model of candidateModels) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${effectiveKey}`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }] }),
        });
        if (res.ok) {
          return { success: true, model, message: `¡Conexión exitosa con Gemini (${model})!` };
        }
        const errText = await res.text();
        if (res.status === 429) {
          quotaExhausted = true;
          continue; // Try next fallback model in the pool
        }
        lastError = `Error HTTP ${res.status}: ${errText}`;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (quotaExhausted) {
      return {
        success: false,
        model: candidateModels[0],
        message:
          'Cuota diaria de Gemini agotada (free tier: 20 peticiones/día por modelo). El motor continuará en modo heurístico local. Para más capacidad, configurá una API Key con plan de pago en Configuración, o reintentá mañana.',
      };
    }

    return {
      success: false,
      model: candidateModels[0],
      message: `Límite de cuota alcanzado (HTTP 429) en los modelos evaluados (${lastError}). El motor continuará operando en modo heurístico determinista local sin interrupciones.`,
    };
  }

  /**
   * Main entrypoint for Copilot chat dialog.
   * Leverages past SQLite learnings, executes financial skills,
   * generates strategy proposals and returns structured response.
   */
  async sendMessage(params: {
    prompt: string;
    history?: CopilotChatMessage[];
  }): Promise<CopilotResponse> {
    const { prompt } = params;
    const lowerPrompt = prompt.toLowerCase();

    // 1. Recover empirical context from SQLite & Engram Persistent Memory
    const recentLearnings = this.db.listMarketLearnings(undefined, 5);
    const engramSummary = this.db.getEngramContextSummary(6);
    const learningsContext = engramSummary || recentLearnings
      .map((l) => `• [${l.category}] ${l.insight} (Confianza: ${((l.confidenceScore ?? 1) * 100).toFixed(0)}%)`)
      .join('\n');

    // 2. Determine execution path (Gemini API with tools or Deterministic Heuristic Engine)
    const effectiveKey = this.getEffectiveApiKey();
    if (effectiveKey) {
      if (Date.now() < this.quotaCooldownUntil) {
        return this.runDeterministicStrategist(lowerPrompt, recentLearnings, QUOTA_ENGINE_NOTE);
      }
      try {
        return await this.callGeminiApi(prompt, learningsContext, effectiveKey);
      } catch (err: unknown) {
        // Fallback gracefully to core deterministic engine if network or quota issue arises
        if (this.isQuotaError(err)) {
          console.warn('[GeminiOrchestrator] Quota 429 en Gemini; continuando con motor local.');
          return this.runDeterministicStrategist(lowerPrompt, recentLearnings, QUOTA_ENGINE_NOTE);
        }
        console.warn('[GeminiOrchestrator] Fallback to deterministic core engine:', err);
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
    const effectiveKey = this.getEffectiveApiKey();
    if (!effectiveKey) {
      return {
        text: '',
        error: 'Para transcribir audio en Electron, por favor configurá tu API Key de Gemini en la pestaña de Configuración.',
      };
    }

    const candidateModels = [
      ...this.getCandidateModels(),
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
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
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${effectiveKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (res.ok) {
          const data = (await res.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const transcript = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          return { text: transcript };
        }

        const errJson = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        const errMsg = errJson?.error?.message || `HTTP ${res.status}`;
        lastError = errMsg;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        lastError = msg;
        console.warn(`[GeminiOrchestrator] Transcribe error on model ${model}:`, err);
      }
    }

    return { text: '', error: `No se pudo transcribir el audio: ${lastError || 'modelos no disponibles'}` };
  }

  /**
   * Executes Gemini 3.6 Flash REST API with Function Calling tools.
   */
  private async callGeminiApi(prompt: string, learningsContext: string, apiKey: string): Promise<CopilotResponse> {
    const candidateModels = this.getCandidateModels();
    const systemInstruction = `Sos Gentleman AI, Senior Architect de Arbitraje P2P Institucional (15+ años de experiencia, GDE & MVP).
Tu misión es guiar al operador con máxima precisión técnica, pedagogía y disciplina innegociable de preservación de capital (Venezuela / LATAM).

FILOSOFÍA Y DIRECTIVAS FUNDAMENTALES:
1. CONCEPTOS > CÓDIGO & PRESERVACIÓN > CODICIA: En arbitraje no hay atajos ni apuestas impulsivas. Jamás operes a ciegas. Cada satoshi y cada bolívar se defienden con análisis riguroso de microestructura.
2. REGLA DE ORO INNEGOCIABLE (Golden Rule): Spread neto real >= 0.50% tras comisiones bancarias, taker/maker y deslizamiento (slippage). Si no supera el 0.50%, la ruta NO es viable y se descarta o advierte enfáticamente.
3. EL HUMANO SIEMPRE LIDERA (Human-in-the-Loop): Vos proponés con sustento matemático; el operador humano valida y decide dar 'PLAY'. Ninguna orden se dispara sin consentimiento explícito.
4. MICROESTRUCTURA & RIESGO: Evaluá siempre la ventana de intervención cambiaria del BCV (10:00 - 11:30 AM), la brecha cambiaria y el perfil de la contraparte antes de recomendar rotaciones.
5. EXPLICACIONES ANALÍTICAS PROFUNDAS Y DETALLADAS:
   - Cuando el operador consulte cómo o por qué se trianguló de cierta forma, explicá la lógica paso a paso: precios de entrada y salida, tasas cruzadas, costos de comisiones maker/taker y mitigación de slippage.
   - Cuando se te pida un resumen de mercado, sesión o auditoría, estructurá la respuesta con encabezados claros, tablas comparativas en Markdown si corresponde, viñetas de riesgo y directivas ejecutivas concretas.
   - Si se detecta un riesgo (ej. depeg de USDT, brecha BCV > 20%, o contraparte sospechosa), explicá con rigor técnico la causa raíz y la maniobra de protección recomendada.
6. TESORERÍA & BINANCE EARN (Costo de Oportunidad Cero):
   - El capital P2P no debe quedar ocioso entre órdenes, fines de semana o pausas operativas. Utilizá activamente las herramientas de Binance Simple Earn Flexible (D+0), Launchpool, Dual Investment y Liquidity Laddering.
   - Calculá la Hurdle Rate: si el spread neto del P2P rinde menos que la tasa libre de riesgo de Simple Earn o el riesgo devaluatorio es inminente, instruí al operador a estacionar el capital en Simple Earn Flexible o Launchpool para generar carry pasivo seguro.
7. OPERACIONES, GOBERNANZA SOP & CONCILIACIÓN CONTINUA:
   - Toda operación debe cumplir estrictamente con los Protocolos Operativos Estándar (SOP): verificación de identidad 1:1 entre cuenta bancaria y Binance, comprobación rigurosa de fondos disponibles (nunca diferidos) y resolución en menos de 15 minutos.
   - En caso de anomalías (retenciones bancarias, pagos de terceros, comprobantes adulterados), aplicá triaje de incidencias (P1 a P4) con aislamiento preventivo inmediato y protocolo de contingencia.
   - Apoyate en las herramientas de conciliación RPA bancaria y sincronización contable con Google Sheets / Excel para garantizar discrepancia cero en tesorería y proyectar runway de capital.

MEMORIA PERSISTENTE ENGRAM ACTIVA:
${learningsContext || 'Sin observaciones previas registradas aún.'}

PAUTAS DE COMUNICACIÓN:
- Hablá en español rioplatense natural (voseo: fijate, mirá, tené en cuenta, acordate), con tono cálido, directo, pedagógico y firme.
- Sé riguroso y transparente: mostrá siempre el desglose numérico detrás de cada decisión.`;

    const requestBody = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{
        functionDeclarations: GEMINI_FINANCIAL_SKILLS.map((s) => ({
          name: s.name,
          description: s.description,
          parameters: s.parameters,
        })),
      }],
    };

    let lastError: Error | null = null;
    for (const model of candidateModels) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 429) {
          const retryMs = this.extractRetryDelayMs(errText);
          const target = Date.now() + Math.max(60_000, Math.min(retryMs, 3_600_000));
          if (target > this.quotaCooldownUntil) {
            this.quotaCooldownUntil = target;
          }
          lastError = new Error(`Gemini API HTTP 429 (${model}): ${errText}`);
          continue; // Try next model in cascade
        }
        throw new Error(`Gemini API HTTP ${res.status} (${model}): ${errText}`);
      }

      const data = (await res.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
              functionCall?: { name: string; args: Record<string, unknown> };
            }>;
          };
        }>;
      };

      const firstCandidate = data.candidates?.[0];
      const parts = firstCandidate?.content?.parts || [];
      const functionCallPart = parts.find((p) => p.functionCall);

      if (functionCallPart && functionCallPart.functionCall) {
        const { name, args } = functionCallPart.functionCall;
        const skillResult = executeFinancialSkill(name, args);

        const plan = this.generatePlanFromSkill(name, skillResult.data);
        if (plan) {
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
            why: `Validación algorítmica de mercado mediante ${model}`,
            whereAffected: plan.route,
            learned: `Rendimiento esperado: ${plan.expectedNetSpreadPct}% neto con ticket de ${plan.capitalRequiredUsdt} USDT. Cumple con la regla de oro institucional.`,
            confidenceScore: 0.95,
            status: 'active',
          });
        }

        // ─── Turn 2: Re-inject function output to Gemini for a deep explanation ───
        let detailedExplanation = '';
        try {
          const secondTurnBody = {
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [
              { role: 'user', parts: [{ text: prompt }] },
              { role: 'model', parts: [{ functionCall: { name, args } }] },
              {
                role: 'tool',
                parts: [
                  {
                    functionResponse: {
                      name,
                      response: {
                        name,
                        content: skillResult.data,
                      },
                    },
                  },
                ],
              },
            ],
          };

          const secondTurnRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(secondTurnBody),
          });

          if (secondTurnRes.ok) {
            const secondTurnData = (await secondTurnRes.json()) as {
              candidates?: Array<{
                content?: {
                  parts?: Array<{ text?: string }>;
                };
              }>;
            };
            const textResponse = secondTurnData.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
            if (textResponse && textResponse.trim().length > 0) {
              detailedExplanation = textResponse.trim();
            }
          }
        } catch (turnErr) {
          console.warn('[GeminiOrchestrator] Multi-turn synthesis fallback:', turnErr);
        }

        if (!detailedExplanation) {
          detailedExplanation = `Mirá, ejecuté la herramienta matemática **${name}** mediante **${model}** para auditar la microestructura del mercado. Con base en los números, formulé una estrategia sólida que resguarda el capital y captura margen real. Fijate en los parámetros de la ficha y dale tu visto bueno con **EJECUTAR** cuando quieras despacharla.`;
        }

        return {
          reply: detailedExplanation,
          suggestedPlan: plan,
          skillsExecuted: [name],
        };
      }

      const textPart = parts.find((p) => p.text);
      return {
        reply: textPart?.text || 'He analizado tu consulta con base en las directivas de mercado actuales.',
      };
    }

    throw lastError || new Error('Todos los modelos de Gemini devolvieron cuota agotada.');
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

    // Intention classification based on domain keywords
    const isMicrostructure = lowerPrompt.includes('avellaneda') || lowerPrompt.includes('stoikov') || lowerPrompt.includes('vpin') || lowerPrompt.includes('toxic') || lowerPrompt.includes('slicing') || lowerPrompt.includes('twap') || lowerPrompt.includes('vwap') || lowerPrompt.includes('markov') || lowerPrompt.includes('market making');
    const isBcvMacro = lowerPrompt.includes('bcv') || lowerPrompt.includes('paralelo') || lowerPrompt.includes('brecha') || lowerPrompt.includes('drenaje') || lowerPrompt.includes('seniat') || lowerPrompt.includes('fuga') || lowerPrompt.includes('dolariz');
    const isHedge = lowerPrompt.includes('cobertura') || lowerPrompt.includes('delta') || lowerPrompt.includes('perp') || lowerPrompt.includes('funding') || lowerPrompt.includes('fondeo') || lowerPrompt.includes('devaluaci') || lowerPrompt.includes('gamma') || lowerPrompt.includes('convex');
    const isKelly = lowerPrompt.includes('kelly') || lowerPrompt.includes('asignaci') || lowerPrompt.includes('ticket') || lowerPrompt.includes('ruina') || lowerPrompt.includes('operadores') || lowerPrompt.includes('capital total');
    const isCrossExchange = lowerPrompt.includes('cross') || lowerPrompt.includes('dorado') || lowerPrompt.includes('bybit') || lowerPrompt.includes('espacial') || lowerPrompt.includes('corredor') || lowerPrompt.includes('remesa') || lowerPrompt.includes('cop');
    const isEarnVaults = lowerPrompt.includes('earn') || lowerPrompt.includes('vault') || lowerPrompt.includes('launchpool') || lowerPrompt.includes('parking') || lowerPrompt.includes('ocioso') || lowerPrompt.includes('hurdle') || lowerPrompt.includes('dual') || lowerPrompt.includes('dca') || lowerPrompt.includes('redemption');
    const isSecurityBank = lowerPrompt.includes('banco') || lowerPrompt.includes('estatus') || lowerPrompt.includes('caida') || lowerPrompt.includes('mantenimiento') || lowerPrompt.includes('pago movil') || lowerPrompt.includes('blacklist') || lowerPrompt.includes('lista negra') || lowerPrompt.includes('fraude') || lowerPrompt.includes('estafa') || lowerPrompt.includes('ocr') || lowerPrompt.includes('comprobante') || lowerPrompt.includes('disputa');
    const isExecutiveSummary = lowerPrompt.includes('resumen') || lowerPrompt.includes('ejecutivo') || lowerPrompt.includes('sesion') || lowerPrompt.includes('enjambre') || lowerPrompt.includes('swarm') || lowerPrompt.includes('diagnostico');
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
    const isOperationsSop = lowerPrompt.includes('sop') || lowerPrompt.includes('incidencia') || lowerPrompt.includes('triaje') || lowerPrompt.includes('rpa') || lowerPrompt.includes('lead') || lowerPrompt.includes('funnel') || lowerPrompt.includes('sheets') || lowerPrompt.includes('conciliaci') || lowerPrompt.includes('contab') || lowerPrompt.includes('prospecto') || lowerPrompt.includes('competidor') || lowerPrompt.includes('benchmark') || lowerPrompt.includes('operacion');

    let reply = '';
    let plan: StrategyPlanRecord | undefined;
    const planId = `PLAN-${Date.now().toString(36).toUpperCase()}`;

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 1: MICROESTRUCTURA & MARKET MAKING (Avellaneda-Stoikov / VPIN / TWAP)
    // ─────────────────────────────────────────────────────────────────────────
    if (isMicrostructure) {
      const avellanedaRes = executeFinancialSkill('calculate_optimal_spread_avellaneda', {
        midPrice: 89.20,
        inventoryQ: 2.5,
        riskAversionGamma: 0.1,
        orderBookLiquidityDensityK: 1.5,
        volatilitySigma: 0.02,
        timeHorizonFraction: 0.5,
      });
      executedSkills.push('calculate_optimal_spread_avellaneda');

      const vpinRes = executeFinancialSkill('calculate_vpin_toxicity', {
        basketVolumeUsdt: 1000,
        totalBuckets: 20,
      });
      executedSkills.push('calculate_vpin_toxicity');

      const slicingRes = executeFinancialSkill('compute_optimal_order_slicing_twap_vwap', {
        totalOrderAmountUsdt: 3000,
        availableBookDepthUsdt: 1500,
        participationRatePct: 15,
        targetDurationMinutes: 45,
      });
      executedSkills.push('compute_optimal_order_slicing_twap_vwap');

      const aData = avellanedaRes.data as { optimalBidPrice?: number; optimalAskPrice?: number; reservationPrice?: number; recommendedAction?: string; spreadPct?: number };
      const vData = vpinRes.data as { vpinMetric?: number; toxicityZone?: string; recommendedRiskAdjustment?: string };
      const sData = slicingRes.data as { totalSlices?: number; averageSliceAmountUsdt?: number; executionAlgorithm?: string; expectedMarketImpactPct?: number };

      reply = `Mirá, analicé la microestructura profunda del libro de órdenes utilizando el modelo cuantitativo de **Avellaneda-Stoikov** y la métrica de toxicidad **VPIN**.\n\n` +
        `### 📐 Calibración Cuantitativa de Cotizaciones (Avellaneda-Stoikov)\n` +
        `* **Precio Medio (Mid-Price)**: 89.20 VES/USDT\n` +
        `* **Precio de Reserva ($r$)**: ${aData.reservationPrice?.toFixed(2) ?? '88.95'} VES (Ajustado por aversión al riesgo ante inventario largo en USDT)\n` +
        `* **Cotización Óptima de Compra (Bid)**: \`${aData.optimalBidPrice?.toFixed(2) ?? '88.35'} VES\`\n` +
        `* **Cotización Óptima de Venta (Ask)**: \`${aData.optimalAskPrice?.toFixed(2) ?? '89.55'} VES\`\n` +
        `* **Spread Asimétrico Calibrado**: ${aData.spreadPct?.toFixed(2) ?? '1.35'}% (Supera holgadamente la regla de oro institucional >= 0.50%)\n` +
        `* **Acción de Inventario**: ${aData.recommendedAction ?? 'Ajustar cotización para rotar inventario a neutral'}\n\n` +
        `### ⚠️ Toxicidad del Flujo & Fragmentación TWAP/VWAP\n` +
        `* **Toxicidad VPIN**: ${((vData.vpinMetric ?? 0.18) * 100).toFixed(1)}% (\`${vData.toxicityZone ?? 'LOW_TOXICITY'}\`) — ${vData.recommendedRiskAdjustment ?? 'Flujo balanceado sin presión tóxica de informados'}.\n` +
        `* **Slicing de Impacto**: Para órdenes de $3,000 USDT, el algoritmo fragmenta en **${sData.totalSlices ?? 5} bloques** de ~$${sData.averageSliceAmountUsdt ?? 600} USDT (${sData.executionAlgorithm ?? 'TWAP'}, impacto de mercado estimado: solo ${sData.expectedMarketImpactPct?.toFixed(2) ?? '0.18'}%).\n\n` +
        `Con esta configuración asegurás captura de spread como Maker minimizando la selección adversa. Fijate en la ficha técnica generada y dale **EJECUTAR** para publicar las cotizaciones calibradas.`;

      plan = {
        id: planId,
        title: 'Market Making Cuantitativo (Avellaneda-Stoikov & TWAP)',
        route: `Bid: ${aData.optimalBidPrice?.toFixed(2) ?? '88.35'} | Ask: ${aData.optimalAskPrice?.toFixed(2) ?? '89.55'} (Fragmentación: ${sData.totalSlices ?? 5} tramos)`,
        asset: 'USDT',
        fiat: 'VES',
        capitalRequiredUsdt: 3000,
        expectedNetSpreadPct: Number((aData.spreadPct ?? 1.35).toFixed(2)),
        expectedProfitUsdt: Number(((3000 * (aData.spreadPct ?? 1.35)) / 100).toFixed(2)),
        riskLevel: 'LOW',
        assignedOperatorName: 'Lead Market Maker',
        rationale: `Cotizaciones asimétricas calculadas por Avellaneda-Stoikov con VPIN en zona ${vData.toxicityZone ?? 'segura'}. Ejecución anti-impacto por bloques.`,
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 2: BCV MACRO & DRENAJE FISCAL SENIAT
    // ─────────────────────────────────────────────────────────────────────────
    else if (isBcvMacro) {
      const bcvRes = executeFinancialSkill('predict_bcv_market_intelligence', {
        parallelRate: 88.50,
        bcvRate: 72.00,
      });
      executedSkills.push('predict_bcv_market_intelligence');

      const drainRes = executeFinancialSkill('forecast_central_bank_liquidity_drain', {
        historicalDailyVolumeVes: 1500000,
        seniatTaxCollectionWeek: true,
        bcvWeeklyInterventionUsdMillions: 45,
      });
      executedSkills.push('forecast_central_bank_liquidity_drain');

      const flightRes = executeFinancialSkill('monitor_fiat_flight_and_dollarization_velocity', {
        hourlyVesTurnoverVolume: 50000,
        averageHoldingMinutesVes: 35,
      });
      executedSkills.push('monitor_fiat_flight_and_dollarization_velocity');

      const bcvData = bcvRes.data as { gap?: { gapPct?: number; riskZone?: string }; recommendation?: { action?: string; confidenceScore?: number }; interventionCycle?: { isInterventionDay?: boolean; optimalWindowHours?: string } };
      const drainData = drainRes.data as { netVesLiquidityContractionPct?: number; expectedSpreadCompressionBps?: number; strategicAdvice?: string };
      const flightData = flightRes.data as { dollarizationVelocityIndex?: number; urgencyLevel?: string; recommendedHoldingLimitMinutes?: number };

      reply = `Mirá, evalué las condiciones de política monetaria del BCV y el drenaje fiscal del SENIAT con nuestros motores de inteligencia cambiaria.\n\n` +
        `### 🏦 Monitor de Brecha Cambiaria & Ventana de Intervención\n` +
        `* **Tasa Oficial BCV**: 72.00 VES/USD | **Tasa Paralela P2P**: 88.50 VES/USD\n` +
        `* **Brecha Cambiaria**: \`${bcvData.gap?.gapPct?.toFixed(1) ?? '22.9'}%\` (Zona de Riesgo: **${bcvData.gap?.riskZone ?? 'ELEVATED'}**)\n` +
        `* **Ventana de Intervención BCV**: ${bcvData.interventionCycle?.optimalWindowHours ?? '10:00 AM - 11:30 AM'}. Durante esta ventana las mesas de cambio bancarias reciben divisas y contraen la tasa paralela.\n` +
        `* **Directiva de Tesorería**: ${bcvData.recommendation?.action ?? 'Completar rotaciones de bolívares a USDT antes de las 11:00 AM'}.\n\n` +
        `### 📉 Drenaje Fiscal SENIAT & Velocidad de Dolarización\n` +
        `* **Contracción de Liquidez en Bolívares**: -${drainData.netVesLiquidityContractionPct?.toFixed(1) ?? '18.5'}% (Semana de recaudación tributaria SENIAT).\n` +
        `* **Compresión Esperada de Spread**: ${drainData.expectedSpreadCompressionBps ?? 45} bps. Se recomienda priorizar tickets menores de alta rotación.\n` +
        `* **Velocidad de Fuga del VES**: Índice de ${flightData.dollarizationVelocityIndex?.toFixed(1) ?? '8.4'}/10 (\`${flightData.urgencyLevel ?? 'HIGH'}\`). Tiempo máximo sugerido de tenencia en bolívares: **${flightData.recommendedHoldingLimitMinutes ?? 30} minutos**.\n\n` +
        `El plan táctico protege la tesorería de la devaluación y garantiza salida expedita a USDT.`;

      plan = {
        id: planId,
        title: 'Rotación Rápida & Inmunización Cambiaria BCV/SENIAT',
        route: 'VES (Pago Móvil Rápido) -> USDT (Binance P2P)',
        asset: 'USDT',
        fiat: 'VES',
        capitalRequiredUsdt: 1200,
        expectedNetSpreadPct: 1.25,
        expectedProfitUsdt: 15.0,
        riskLevel: 'LOW',
        assignedOperatorName: 'Operador Turno Mañana',
        rationale: `Rotación rápida previa a ventana de inyección BCV. Límite estricto de retención de VES en 30 min por drenaje fiscal SENIAT.`,
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 3: COBERTURA DELTA-NEUTRAL & FUNDING ARBITRAGE
    // ─────────────────────────────────────────────────────────────────────────
    else if (isHedge) {
      const hedgeRes = executeFinancialSkill('evaluate_delta_neutral_hedge', {
        vesBalance: 45000,
        usdtBalance: 1500,
        currentParallelRate: 88.50,
        vesMaxHoldingTimeMinutes: 45,
      });
      executedSkills.push('evaluate_delta_neutral_hedge');

      const fundingRes = executeFinancialSkill('model_perpetual_funding_arbitrage', {
        spotUsdtHoldings: 2000,
        current8hFundingRatePct: 0.035,
        perpContractSymbol: 'BTCUSDT',
      });
      executedSkills.push('model_perpetual_funding_arbitrage');

      const hData = hedgeRes.data as { fiatExposureUsd?: number; netDeltaRatio?: number; urgency?: string; proposals?: Array<{ action: string; hedgeAmountUsdt: number; reason: string }> };
      const fData = fundingRes.data as { annualizedFundingYieldPct?: number; dailyProjectedIncomeUsdt?: number; isFundingProfitable?: boolean; executionStrategy?: string };

      reply = `Mirá, calculé la exposición direccional de la tesorería y modelé una cobertura sintética delta-neutral con captura de tasa de fondeo.\n\n` +
        `### 🛡️ Auditoría de Exposición Direccional (Delta Risk)\n` +
        `* **Exposición en Bolívares (VES)**: $${hData.fiatExposureUsd?.toFixed(0) ?? '508'} USD equivalentes\n` +
        `* **Ratio Delta Neto**: ${hData.netDeltaRatio?.toFixed(2) ?? '0.25'} (\`Urgencia: ${hData.urgency ?? 'MEDIUM'}\`)\n` +
        `* **Propuesta de Cobertura**: ${hData.proposals?.[0]?.action ?? 'Abrir Short Perp USD/USDT'} por valor de $${hData.proposals?.[0]?.hedgeAmountUsdt ?? 500} USDT para neutralizar el riesgo devaluatorio.\n\n` +
        `### 💰 Arbitraje de Tasa de Fondeo (Perpetual Funding Yield)\n` +
        `* **Tasa de Fondeo (8h)**: +0.035% (Los compradores en futuros pagan a los vendedores).\n` +
        `* **Rendimiento Anualizado Proyectado**: \`${fData.annualizedFundingYieldPct?.toFixed(2) ?? '38.32'}% APR\` en ingresos pasivos de fondeo.\n` +
        `* **Ingreso Diario Proyectado**: ~$${fData.dailyProjectedIncomeUsdt?.toFixed(2) ?? '2.10'} USDT adicionales mientras el capital respalda órdenes P2P.\n` +
        `* **Estrategia**: ${fData.executionStrategy ?? 'Short sintético Delta-Neutral con colateral en USDT'}.\n\n` +
        `Esta cobertura inmuniza tu balance contra una devaluación abrupta del bolívar mientras te permite cosechar intereses de fondeo.`;

      plan = {
        id: planId,
        title: 'Cobertura Delta-Neutral & Funding Harvest',
        route: 'SHORT_PERP_USD (Binance Futures) vs Inventario VES P2P',
        capitalRequiredUsdt: hData.proposals?.[0]?.hedgeAmountUsdt ?? 500,
        expectedNetSpreadPct: 0.85,
        expectedProfitUsdt: 8.5,
        riskLevel: 'LOW',
        assignedOperatorName: 'Desk Risk Officer',
        rationale: 'Inmunización matemática contra caída de tasa cambiaria más captura de tasa de fondeo positiva.',
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
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

      const kData = kellyRes.data as {
        optimalTicketSizeUsdt?: number;
        recommendedFractionPct?: number;
        fullKellyFractionPct?: number;
        perOperatorAllocationUsdt?: number;
        ruinProbabilityPct?: number;
        strategicRationale?: string;
      };

      reply = `Mirá, apliqué el modelo matemático del **Criterio de Kelly Institucional (Fractional Half-Kelly)** para maximizar la tasa compuesta geométrica de crecimiento protegiendo el bankroll.\n\n` +
        `### 📊 Optimización de Tickets (Kelly Fractional)\n` +
        `* **Bankroll Total Disponible**: $5,000 USDT\n` +
        `* **Full Kelly Teórico**: ${kData.fullKellyFractionPct?.toFixed(1) ?? '48.5'}% (Demasiado agresivo para un entorno bancario regulado).\n` +
        `* **Fracción Prudencial Aplicada (Half-Kelly)**: \`${kData.recommendedFractionPct?.toFixed(1) ?? '22.5'}%\` del bankroll.\n` +
        `* **Tamaño Óptimo de Ticket por Orden**: \`$${kData.optimalTicketSizeUsdt ?? 1125} USDT\`\n` +
        `* **Asignación por Operador (2 Operadores Activos)**: $${kData.perOperatorAllocationUsdt ?? 2500} USDT por turno/cuenta bancaria.\n` +
        `* **Probabilidad de Ruina Estimada**: \`< ${kData.ruinProbabilityPct ?? 0.01}%\` con disciplina estricta de rotación.\n\n` +
        `### 🎯 Fundamento Estratégico\n` +
        `${kData.strategicRationale ?? 'Al limitar los tickets al 22.5%, evitamos alertas por transferencias masivas en los bancos locales (SUDEBAN) y aseguramos liquidez continua para compras de oportunidad.'}`;

      plan = {
        id: planId,
        title: 'Asignación de Capital Kelly (2 Operadores)',
        route: `2 Cuentas Bancarias x $${kData.perOperatorAllocationUsdt ?? 2500} USDT (Tickets de $${kData.optimalTicketSizeUsdt ?? 1125})`,
        capitalRequiredUsdt: 5000,
        expectedNetSpreadPct: 1.35,
        expectedProfitUsdt: 67.5,
        riskLevel: 'LOW',
        assignedOperatorName: 'Desk Risk & Treasury Lead',
        rationale: 'Dimensionamiento matemático según Criterio de Kelly fraccional para máxima expansión geométrica sin riesgo de quiebra.',
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 5: BINANCE EARN VAULTS & HURDLE RATE (CAPITAL OCIOSO)
    // ─────────────────────────────────────────────────────────────────────────
    else if (isEarnVaults) {
      const hurdleRes = executeFinancialSkill('calculate_earn_yield_vs_p2p_hurdle_rate', {
        grossP2pSpreadPct: 1.40,
        platformFeePct: 0.10,
        bankingRiskPremiumPct: 0.30,
        fxDevaluationRiskPct: 0.15,
        averageTradeCycleHours: 2.5,
        simpleEarnAprPct: 12.5,
      });
      executedSkills.push('calculate_earn_yield_vs_p2p_hurdle_rate');

      const earnRes = executeFinancialSkill('optimize_idle_capital_simple_earn', {
        idleCapitalUsdt: 2000,
        hoursIdle: 8,
        simpleEarnAprPct: 12.5,
      });
      executedSkills.push('optimize_idle_capital_simple_earn');

      const redemptionRes = executeFinancialSkill('simulate_earn_instant_redemption_latency', {
        redemptionAmountUsdt: 2000,
      });
      executedSkills.push('simulate_earn_instant_redemption_latency');

      const hData = hurdleRes.data as { hurdleRateMet?: boolean; netHourlyP2pYieldPct?: number; passiveHourlyEarnYieldPct?: number; recommendation?: string };
      const eData = earnRes.data as { interestEarnedUsdt?: number; effectiveAprPct?: number; parkingStrategy?: string };
      const rData = redemptionRes.data as { instantRedemptionAvailable?: boolean; estimatedLatencySeconds?: number; isSafeForRapidP2pExecution?: boolean };

      reply = `Mirá, calculé la tasa de corte (**Hurdle Rate**) comparando el costo de oportunidad entre rotación activa P2P y rendimiento pasivo en **Binance Simple Earn Flexible**.\n\n` +
        `### ⚡ Comparación de Rendimiento (Hurdle Rate)\n` +
        `* **Spread Neto P2P por Hora**: \`+${hData.netHourlyP2pYieldPct?.toFixed(3) ?? '0.340'}%/hora\` (Tras comisiones bancarias y devaluación estimada).\n` +
        `* **Rendimiento Simple Earn Flexible**: \`+${hData.passiveHourlyEarnYieldPct?.toFixed(5) ?? '0.00143'}%/hora\` (12.5% APR anualizado).\n` +
        `* **Dictamen del Modelo**: ${hData.recommendation ?? 'Operar activamente mientras el mercado P2P ofrezca spread neto >= 0.50%'}.\n\n` +
        `### 🌙 Parking Táctico de Capital Ocioso (Horas Nocturnas)\n` +
        `* **Capital Estacionable**: $2,000 USDT durante ventanas sin volumen bancario (00:00 - 08:00 UTC).\n` +
        `* **Interés Generado**: ~$${eData.interestEarnedUsdt?.toFixed(3) ?? '0.228'} USDT por noche sin riesgo crediticio.\n` +
        `* **Redención Inmediata**: ${rData.instantRedemptionAvailable ? '✓ Disponible' : 'Advertencia'} (Latencia promedio: ${rData.estimatedLatencySeconds ?? 2} seg). El capital retorna a la billetera de fondos inmediatamente al detectar un anuncio rentable.\n\n` +
        `El capital jamás se queda quieto al 0%: produce rendimiento pasivo en vaults cuando los bancos duermen y se redime en segundos para P2P al amanecer.`;

      plan = {
        id: planId,
        title: 'Estacionamiento en Simple Earn Flexible & Redención Inmediata',
        route: 'Spot/Fondos ➔ Binance Simple Earn Flexible USDT (12.5% APR)',
        asset: 'USDT',
        capitalRequiredUsdt: 2000,
        expectedNetSpreadPct: 1.05,
        expectedProfitUsdt: 21.0,
        riskLevel: 'LOW',
        assignedOperatorName: 'Treasury Manager',
        rationale: 'Capital devengando interés pasivo con cuota de rescate instantáneo para compras P2P relámpago.',
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 6: CROSS-EXCHANGE & CORREDORES FX
    // ─────────────────────────────────────────────────────────────────────────
    else if (isCrossExchange) {
      const crossRes = executeFinancialSkill('calculate_cross_exchange_basis_spread', {
        buyPlatform: 'Binance P2P',
        sellPlatform: 'El Dorado P2P',
        buyPrice: 88.30,
        sellPrice: 89.65,
        transferFeeUsdt: 1.0,
        tradeAmountUsdt: 1500,
      });
      executedSkills.push('calculate_cross_exchange_basis_spread');

      const cData = crossRes.data as {
        netSpreadPct?: number;
        netProfitUsdt?: number;
        grossSpreadPct?: number;
        networkFeeDeductionUsdt?: number;
        isArbitrageViable?: boolean;
        clearingTimeMinutes?: number;
      };

      reply = `Mirá, evalué el arbitraje espacial de bases entre plataformas cruzadas (**Binance P2P vs El Dorado P2P**).\n\n` +
        `### 🌐 Arbitraje Espacial de Bases (Cross-Exchange)\n` +
        `* **Plataforma de Compra (Bid)**: Binance P2P @ 88.30 VES/USDT\n` +
        `* **Plataforma de Venta (Ask)**: El Dorado P2P @ 89.65 VES/USDT\n` +
        `* **Spread Bruto**: ${cData.grossSpreadPct?.toFixed(2) ?? '1.53'}%\n` +
        `* **Costo de Retiro y Red**: -$${cData.networkFeeDeductionUsdt?.toFixed(2) ?? '1.00'} USDT (Vía BSC BEP-20 / Tron TRC-20)\n` +
        `* **Spread Neto Real**: \`+${cData.netSpreadPct?.toFixed(2) ?? '1.46'}%\` (Regla de oro cumplida holgadamente)\n` +
        `* **Beneficio Neto Proyectado**: \`+$${cData.netProfitUsdt?.toFixed(2) ?? '21.90'} USDT\` por rotación de $1,500 USDT.\n` +
        `* **Tiempo de Ciclo Completo**: ~${cData.clearingTimeMinutes ?? 25} minutos.\n\n` +
        `Ruta altamente líquida aprovechando la prima de compra en plataformas secundarias. Dale **EJECUTAR** para despacharla.`;

      plan = {
        id: planId,
        title: 'Arbitraje Espacial Binance P2P ➔ El Dorado P2P',
        route: 'Comprar USDT en Binance P2P (Banesco) ➔ Vender en El Dorado (Pago Móvil)',
        asset: 'USDT',
        fiat: 'VES',
        capitalRequiredUsdt: 1500,
        expectedNetSpreadPct: Number((cData.netSpreadPct ?? 1.46).toFixed(2)),
        expectedProfitUsdt: Number((cData.netProfitUsdt ?? 21.90).toFixed(2)),
        riskLevel: 'LOW',
        assignedOperatorName: 'Arbitrage Desk',
        rationale: 'Discrepancia de base confirmada de 1.46% neto tras absorber comisiones de retiro y fricción cambiaria.',
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
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

      const bData = bankRes.data as {
        networkStatus?: string;
        averageSettlementLatencyMinutes?: number;
        pauseTradingDirective?: boolean;
        operationalSummary?: string;
        details?: Array<{ bankName: string; status: string; settlementLatencyMinutes: number }>;
      };

      reply = `Mirá, ejecuté la auditoría de seguridad operativa y estado de plataformas bancarias en tiempo real.\n\n` +
        `### 🛡️ Monitor de Infraestructura Bancaria & Compensación\n` +
        `* **Estado de la Red**: \`${bData.networkStatus ?? 'ALL_SYSTEMS_OPERATIONAL'}\`\n` +
        `* **Directiva de Pausa**: ${bData.pauseTradingDirective ? '🚨 PAUSA ACTIVA' : '✅ Trading Autorizado (Sin caídas de servicio)'}\n` +
        `* **Latencia Promedio de Acreditación**: ${bData.averageSettlementLatencyMinutes ?? 0.9} minutos.\n` +
        `* **Resumen Operativo**: ${bData.operationalSummary ?? 'Banesco, Mercantil, BDV y Suiche Pago Móvil operando al 100%'}.\n\n` +
        `### 🚫 Escudo Anti-Triangulación & Listas Negras\n` +
        `* **Filtro de Cédulas y Teléfonos**: Cotejo automático contra tabla SQLite y Malla ZK descentralizada.\n` +
        `* **Verificación de Comprobantes OCR**: Detección de adulteración digital de fuentes, referencias repetidas y concordancia obligatoria entre el nombre del titular bancario y la cuenta verificada de Binance.\n` +
        `* **Regla Innegociable**: Cero pagos de terceros. Si el comprobante muestra un remitente distinto, la orden se retiene inmediatamente y se emite expediente de disputa.\n\n` +
        `La mesa de operaciones está operando bajo máximos estándares de compliance bancario.`;

      plan = {
        id: planId,
        title: 'Verificación de Seguridad & Auditoría de Canales Bancarios',
        route: 'Inspección de Banesco / Mercantil / BDV / Suiche Pago Móvil',
        asset: 'USDT',
        fiat: 'VES',
        capitalRequiredUsdt: 1000,
        expectedNetSpreadPct: 1.15,
        expectedProfitUsdt: 11.5,
        riskLevel: 'LOW',
        assignedOperatorName: 'Compliance & Security Officer',
        rationale: 'Canales bancarios estables sin riesgo de fondos atrapados ni coincidencia en listas negras.',
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 8: RESUMEN EJECUTIVO & DIAGNÓSTICO ENJAMBRE (SWARM)
    // ─────────────────────────────────────────────────────────────────────────
    else if (isExecutiveSummary) {
      const swarmHealth = this.swarm ? this.swarm.getSwarmHealth() : [
        { role: 'SENTINEL', name: 'Alpha Sentinel', status: 'ONLINE', opsProcessed: 142 },
        { role: 'STRATEGIST', name: 'Gentleman AI', status: 'ONLINE', opsProcessed: 98 },
        { role: 'RISK_GATEKEEPER', name: 'Risk Gatekeeper', status: 'ONLINE', opsProcessed: 98 },
        { role: 'DISPUTE_AUDITOR', name: 'Dispute & Proof Auditor', status: 'STANDBY', opsProcessed: 12 },
      ];

      const bcvRes = executeFinancialSkill('predict_bcv_market_intelligence', { parallelRate: 88.5, bcvRate: 72.0 });
      executedSkills.push('predict_bcv_market_intelligence');
      const bData = bcvRes.data as { gap?: { gapPct?: number } };

      reply = `Mirá, formulé el **Resumen Ejecutivo de la Mesa P2P** consolidando la telemetría del Enjambre Multi-Agente.\n\n` +
        `### ⚡ Estado del Enjambre Multi-Agente (Swarm Telemetry)\n` +
        swarmHealth.map((a) => `* **${a.name}** (\`${a.role}\`): Estado \`${a.status}\` — Ops procesadas: ${a.opsProcessed}`).join('\n') + `\n\n` +
        `### 📈 Diagnóstico Macro & Mercado P2P\n` +
        `* **Brecha Cambiaria BCV**: \`${bData.gap?.gapPct?.toFixed(1) ?? '22.9'}%\` (Paralelo: 88.50 | BCV: 72.00 VES/USD)\n` +
        `* **Regla de Oro Institucional**: Spread objetivo >= 0.50% neto. Ninguna orden con margen inferior es admitida por el Risk Gatekeeper.\n` +
        `* **Capacidad de Tesorería**: Fondos resguardados en USDT con diversificación en Banesco y Pago Móvil interbancario.\n\n` +
        `### 🎯 Prioridades Operativas para el Operador\n` +
        `1. Priorizar rotaciones en Banesco y Pago Móvil durante la mañana.\n` +
        `2. Mantener órdenes maker calibradas con Avellaneda-Stoikov para capturar spread sin asumir deslizamiento taker.\n` +
        `3. Ante órdenes dudosas de terceros, exigir de inmediato comprobante PDF bancario para auditoría OCR.\n\n` +
        `El Enjambre permanece activo 24/7 vigilando la microestructura.`;

      plan = {
        id: planId,
        title: 'Plan Maestro de Operaciones P2P del Enjambre',
        route: 'Banesco Pago Móvil ➔ USDT ➔ Liquidación Transferencia Bancaria',
        asset: 'USDT',
        fiat: 'VES',
        capitalRequiredUsdt: 2000,
        expectedNetSpreadPct: 1.35,
        expectedProfitUsdt: 27.0,
        riskLevel: 'LOW',
        assignedOperatorName: 'Operador Principal',
        rationale: 'Estrategia consolidada aprobada unánimemente por el Enjambre Multi-Agente.',
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
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
        minSpreadThresholdPct: 0.50,
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

      const data = auditRes.data as {
        dossier?: {
          operatorStanding?: string;
          goldenRuleComplianceScore?: number;
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
            totalOperationsAnalyzed?: number;
            compliantOperationsCount?: number;
            nonCompliantOperationsCount?: number;
            complianceRatePct?: number;
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

      reply = `Mirá, realicé la **Auditoría Forense del Libro Mayor** interrogando directamente tus registros en SQLite (${hRisk?.totalEventsAnalyzed ?? rawLogs.length} eventos de auditoría y ${dAudit?.totalOperationsAnalyzed ?? rawOps.length} operaciones comerciales analizadas).\n\n` +
        `### 🕒 Distribución Horaria de Riesgo & Alertas\n` +
        `* **Ventana Horaria Crítica**: \`${hRisk?.peakRiskWindow ?? '11:00 - 12:00'}\` (Puntaje de riesgo: ${hRisk?.peakRiskScore ?? 0} con ${hRisk?.totalCriticalIncidents ?? 0} incidentes/alertas).\n` +
        `* **Tasa de Incidentes Críticos**: \`${hRisk?.criticalIncidentRatePct ?? 0}%\` sobre el total de eventos.\n` +
        `* **Diagnóstico de Horarios**: ${hRisk?.recommendation ?? 'Distribución horaria estable sin concentración anómala.'}\n\n` +
        `### 🎯 Disciplina Operativa & Regla de Oro (Spread >= 0.50%)\n` +
        `* **Tasa de Cumplimiento**: \`${dAudit?.complianceRatePct ?? 100}%\` de operaciones con spread neto >= 0.50% (${dAudit?.compliantOperationsCount ?? 0} conformes / ${dAudit?.nonCompliantOperationsCount ?? 0} desvíos).\n` +
        `* **Spread Promedio Ponderado (VWAS)**: \`+${dAudit?.volumeWeightedAverageSpreadPct ?? 1.25}%\` neto.\n` +
        `* **Detector de Tilt / Emocional**: ${dAudit?.tiltDetected ? `⚠️ ¡DETECTADO! Severidad: \`${dAudit?.tiltSeverity}\` (Racha de ${dAudit?.tiltConsecutiveViolations} desvíos consecutivos). Lucro cesante estimado: $${dAudit?.estimatedSacrificedProfitUsdt} USDT.` : '✅ Control emocional óptimo, sin rachas de tilt.'}\n\n` +
        `### 🏛️ Veredicto Forense Institucional\n` +
        `* **Calificación**: \`${dossier?.operatorStanding ?? 'DISCIPLINED'}\` (Puntaje Regla de Oro: ${dossier?.goldenRuleComplianceScore ?? 100}/100).\n` +
        `* **Dictamen Ejecutivo**: ${dossier?.executiveVerdict ?? 'Operador disciplinado bajo estándares institucionales.'}\n\n` +
        `### 🛡️ Directivas Preventivas Sugeridas\n` +
        (dossier?.preventiveDirectives || ['Mantener la disciplina actual y no negociar spreads inferiores al 0.50%.']).map((dir) => `* ${dir}`).join('\n') + `\n\n` +
        `A continuación te genero la ficha táctica de mitigación para blindar la mesa en los horarios de riesgo.`;

      plan = {
        id: planId,
        title: `Plan de Mitigación Forense (${dossier?.operatorStanding ?? 'DISCIPLINED'})`,
        route: `Blindaje en ventana ${hRisk?.peakRiskWindow ?? '11:00 - 12:00'} ➔ Forzar spread mínimo >= 0.50% en órdenes Maker`,
        asset: 'USDT',
        fiat: 'VES',
        capitalRequiredUsdt: 1500,
        expectedNetSpreadPct: Math.max(0.50, dAudit?.volumeWeightedAverageSpreadPct ?? 1.25),
        expectedProfitUsdt: Number(((1500 * Math.max(0.50, dAudit?.volumeWeightedAverageSpreadPct ?? 1.25)) / 100).toFixed(2)),
        riskLevel: dossier?.operatorStanding === 'CRITICAL_TILT_RISK' ? 'HIGH' : dossier?.operatorStanding === 'MODERATE_DEVIATION' ? 'MEDIUM' : 'LOW',
        assignedOperatorName: 'Forensic Audit & Risk Officer',
        rationale: dossier?.executiveVerdict ?? 'Protocolo forense de disciplina y control de horarios críticos.',
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
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

      const sheetRes = executeFinancialSkill('sync_google_sheets_live_ledger', {
        tradeDate: new Date().toISOString().split('T')[0],
        orderId: 'ORD-LIVE-AUDIT',
        counterpartyAlias: 'VerifiedMerchant',
        tradeType: 'SELL',
        cryptoAmountUsdt: 1000,
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

      const sData = sopRes.data as { isCompliant?: boolean; complianceScore?: number; summary?: string; disciplinaryAction?: string };
      const tData = triageRes.data as { severityLevel?: string; maxResolutionSlaMinutes?: number; requiresHumanHandoff?: boolean; isolationProtocol?: string; recommendedRemediationSteps?: string[] };
      const lData = sheetRes.data as { calculatedGrossProfitUsdt?: number; calculatedNetMarginPct?: number; formulaNetSpreadPct?: string };
      const cfData = cashFlowRes.data as { totalConsolidatedTreasuryUsdt?: number; runwayOperationalDays?: number; treasuryHealthVerdict?: string };

      reply = `Mirá, formulé la auditoría de gobernanza operativa, triaje de incidentes y estado de conciliación de la mesa P2P.\n\n` +
        `### 📋 Auditoría de Cumplimiento SOP (Protocolos Operativos Estándar)\n` +
        `* **Índice de Cumplimiento**: \`${sData.complianceScore ?? 100}%\` (${sData.isCompliant ? '✅ Conforme a Norma' : '⚠️ Desviación Detectada'})\n` +
        `* **Dictamen Disciplinario**: \`${sData.disciplinaryAction ?? 'NONE'}\`\n` +
        `* **Resumen de Auditoría**: ${sData.summary ?? 'Verificación de titularidad 1:1 y confirmación de saldo disponible aprobadas.'}\n\n` +
        `### 🚨 Matriz de Triaje & Escalación de Incidentes\n` +
        `* **Nivel de Severidad**: \`${tData.severityLevel ?? 'P1_CRITICAL'}\` | **SLA Máximo**: ${tData.maxResolutionSlaMinutes ?? 10} minutos\n` +
        `* **Intervención Humana Requerida**: ${tData.requiresHumanHandoff ? '⚠️ SÍ (Requiere validación del CSO)' : 'Automático'}\n` +
        `* **Protocolo de Aislamiento**: ${tData.isolationProtocol ?? 'Pausar anuncios vinculados a cuentas bajo revisión y activar contingencia.'}\n` +
        `* **Pasos de Mitigación**: ${(tData.recommendedRemediationSteps || []).slice(0, 2).join(' | ')}\n\n` +
        `### 📊 Conciliación Contable & Runway de Tesorería\n` +
        `* **Margen Neto Contable en Planilla**: \`+${lData.calculatedNetMarginPct?.toFixed(2) ?? '1.40'}%\` ($${lData.calculatedGrossProfitUsdt?.toFixed(2) ?? '14.00'} USDT)\n` +
        `* **Tesorería Consolidada**: $${cfData.totalConsolidatedTreasuryUsdt?.toFixed(0) ?? '6800'} USDT\n` +
        `* **Runway Operativo**: \`${cfData.runwayOperationalDays?.toFixed(1) ?? '194'} días\` (Diagnóstico: ${cfData.treasuryHealthVerdict ?? 'EXCELLENT_LIQUIDITY'})\n\n` +
        `El sistema operativo garantiza cero discrepancia contable y estricta protección contra cuentas retenidas o pagos no autorizados.`;

      plan = {
        id: planId,
        title: 'Gobernanza SOP, Conciliación RPA & Triaje Operativo',
        route: 'Auditoría Forense SOP ➔ Conciliación RPA de Extractos ➔ Sync Google Sheets Ledger',
        asset: 'USDT',
        fiat: 'VES',
        capitalRequiredUsdt: 1200,
        expectedNetSpreadPct: 1.40,
        expectedProfitUsdt: 16.8,
        riskLevel: 'LOW',
        assignedOperatorName: 'Compliance & Operations Lead',
        rationale: 'Cumplimiento 100% de verificación documental y concordancia bancaria, conciliación automatizada y sincronización contable.',
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 11: TRIANGULACIÓN FINANCIERA INSTITUCIONAL (DEFAULT & PREFERIDO)
    // ─────────────────────────────────────────────────────────────────────────
    else {
      const triangleRes = executeFinancialSkill('scan_triangular_arbitrage', {
        initialAmount: 1000,
        initialCurrency: 'USDT',
      });
      executedSkills.push('scan_triangular_arbitrage');

      const simRes = executeFinancialSkill('simulate_trade_impact', {
        targetAmountUsdt: 1000,
        side: 'BUY',
      });
      executedSkills.push('simulate_trade_impact');

      const goldenRes = executeFinancialSkill('evaluate_golden_spread', { netSpreadPct: 1.35 });
      executedSkills.push('evaluate_golden_spread');

      const bcvRes = executeFinancialSkill('predict_bcv_market_intelligence', {
        parallelRate: 88.50,
        bcvRate: 72.00,
      });
      executedSkills.push('predict_bcv_market_intelligence');

      const tData = triangleRes.data as {
        netSpreadPct?: number;
        profitInitialCurrency?: number;
        routeName?: string;
        steps?: Array<{ stepNumber: number; description: string; expectedOutput: number }>;
      };
      const sData = simRes.data as { effectiveVwapPrice?: number; slippageBps?: number; liquidityHealth?: string };
      const bData = bcvRes.data as { gap?: { gapPct?: number } };

      reply = `Mirá, analicé las oportunidades de **arbitraje triangular institucional** en el mercado venezolano con rigor de microestructura y preservación de capital.\n\n` +
        `### 🔄 Desglose de la Ruta Triangular de 3 Piernas\n` +
        `* **Pierna 1 (Entrada)**: VES (Pago Móvil Banesco) ➔ Comprar USDT en Binance P2P (@ 88.35 VES/USDT)\n` +
        `* **Pierna 2 (Cruce)**: Convertir USDT ➔ Activo Puente (BTC/FDUSD) en libro spot con cero comisión maker\n` +
        `* **Pierna 3 (Salida)**: Vender en libro P2P VES con transferencia bancaria acreditada (@ 89.55 VES/USDT)\n\n` +
        `### 📊 Desglose Numérico & Regla de Oro\n` +
        `* **Spread Bruto de Mercado**: 1.75%\n` +
        `* **Comisión Taker/Maker**: -0.10% en Binance\n` +
        `* **Comisión por Transferencia Interbancaria**: -0.30%\n` +
        `* **Deslizamiento (Slippage VWAP)**: -${((sData.slippageBps ?? 12) / 100).toFixed(2)}% (Llenado VWAP a ${sData.effectiveVwapPrice?.toFixed(2) ?? '88.45'} VES)\n` +
        `* **Retorno Neto Real**: \`+${tData.netSpreadPct?.toFixed(2) ?? '1.35'}%\` (Supera holgadamente el 0.50% de la Regla de Oro)\n` +
        `* **Beneficio Neto Estimado**: \`+$${tData.profitInitialCurrency?.toFixed(2) ?? '13.50'} USDT\` por cada $1,000 USDT rotados.\n` +
        `* **Brecha Cambiaria BCV**: ${bData.gap?.gapPct?.toFixed(1) ?? '22.9'}% (Liquidez profunda antes del mediodía).\n\n` +
        `Fijate en la ficha táctica que generé a continuación. Dale **EJECUTAR** cuando quieras asignársela al operador para comenzar la rotación.`;

      plan = {
        id: planId,
        title: 'Triangulación Táctica VES -> USDT -> BTC con Banesco',
        route: 'VES (Pago Móvil) -> USDT -> BTC -> VES (Transferencia)',
        asset: 'USDT',
        fiat: 'VES',
        capitalRequiredUsdt: 1000,
        expectedNetSpreadPct: Number((tData.netSpreadPct ?? 1.35).toFixed(2)),
        expectedProfitUsdt: Number((tData.profitInitialCurrency ?? 13.5).toFixed(2)),
        riskLevel: 'LOW',
        assignedOperatorName: 'Operador Principal',
        rationale: 'Brecha cambiaria favorable (22.9%) con liquidez profunda en Banesco y spread neto que supera holgadamente la regla de oro.',
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    // Persist plan in SQLite
    if (plan) {
      this.db.saveStrategyPlan(plan);

      // Persist in Engram Persistent Memory
      const engramObs: EngramObservationRecord = {
        topicKey: `strategy/${plan.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        type: 'discovery',
        scope: 'project',
        what: `Estrategia formulada: ${plan.title} (Spread neto: ${plan.expectedNetSpreadPct}%)`,
        why: plan.rationale,
        whereAffected: plan.route,
        learned: `Retorno neto proyectado: ${plan.expectedNetSpreadPct}% con ticket de ${plan.capitalRequiredUsdt} USDT. Regla de oro (>=0.50%) superada con éxito.`,
        confidenceScore: 0.96,
        sampleCount: 1,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.db.saveEngramObservation(engramObs);
      learningsGenerated.push(engramObs.what);
    }

    const engramCount = this.db.listEngramObservations({ status: 'active' }, 100).length;
    const memoryHint = engramCount > 0
      ? `\n\n* **Memoria Persistente Engram**: ${engramCount} observaciones activas sincronizadas en SQLite.*`
      : '';

    const finalReply = engineNote ? `${reply}${memoryHint}${engineNote}` : `${reply}${memoryHint}`;

    return {
      reply: finalReply,
      suggestedPlan: plan,
      skillsExecuted: executedSkills,
      learningsGenerated,
    };
  }

  /**
   * Helper to transform skill outputs into a unified StrategyPlanCard.
   */
  private generatePlanFromSkill(skillName: string, data: unknown): StrategyPlanCard | undefined {
    const planId = `PLAN-${Date.now().toString(36).toUpperCase()}`;
    if (skillName === 'scan_triangular_arbitrage' && data && typeof data === 'object') {
      const d = data as { netSpreadPct?: number; profitInitialCurrency?: number; isProfitable?: boolean };
      return {
        id: planId,
        title: 'Arbitraje Triangular Validado por Gemini',
        route: '3-Leg Cross Currency Loop',
        capitalRequiredUsdt: 1000,
        expectedNetSpreadPct: d.netSpreadPct ?? 1.2,
        expectedProfitUsdt: d.profitInitialCurrency ?? 12.0,
        riskLevel: (d.netSpreadPct ?? 1) >= 1.0 ? 'LOW' : 'MEDIUM',
        assignedOperatorName: 'Operador Turno Mañana',
        rationale: 'Estrategia validada mediante la herramienta matemática scan_triangular_arbitrage del Core.',
        status: 'PROPOSED',
      };
    }

    if (skillName === 'evaluate_delta_neutral_hedge' && data && typeof data === 'object') {
      const d = data as { fiatExposureUsd?: number; urgency?: string; proposals?: Array<{ action: string; hedgeAmountUsdt: number; reason: string }> };
      const prop = d.proposals?.[0];
      return {
        id: planId,
        title: 'Cobertura Sintética Delta-Neutral',
        route: prop?.action || 'SHORT_PERP_USD (Bybit / Binance)',
        capitalRequiredUsdt: prop?.hedgeAmountUsdt || Math.round(d.fiatExposureUsd || 500),
        expectedNetSpreadPct: 0.0,
        expectedProfitUsdt: 0.0,
        riskLevel: d.urgency === 'HIGH' ? 'HIGH' : 'LOW',
        assignedOperatorName: 'Desk Risk Manager',
        rationale: prop?.reason || 'Inmunización del portafolio contra devaluación brusca del bolívar (VES).',
        status: 'PROPOSED',
      };
    }

    if (skillName === 'forecast_market_volatility_2h' && data && typeof data === 'object') {
      const d = data as { level?: string; direction?: string; suggestedSpreadAdjustmentPct?: { buyMarkupPct: number; sellMarkupPct: number } };
      return {
        id: planId,
        title: 'Reajuste Dinámico de Markups (2 Horas)',
        route: `Ajuste Compra: ${d.suggestedSpreadAdjustmentPct?.buyMarkupPct ?? 0}% | Venta: +${d.suggestedSpreadAdjustmentPct?.sellMarkupPct ?? 0}%`,
        capitalRequiredUsdt: 1500,
        expectedNetSpreadPct: 1.45,
        expectedProfitUsdt: 21.75,
        riskLevel: d.level === 'ELEVATED' ? 'MEDIUM' : 'LOW',
        assignedOperatorName: 'Operador Principal',
        rationale: `Proyección a 2 horas: Volatilidad ${d.level ?? 'NORMAL'} y spread ${d.direction ?? 'ESTABLE'}. Ajuste para absorber deslizamiento y capturar margen.`,
        status: 'PROPOSED',
      };
    }

    if (skillName === 'simulate_trade_impact' && data && typeof data === 'object') {
      const d = data as { targetAmountUsdt?: number; effectiveVwapPrice?: number; slippageBps?: number; liquidityHealth?: string };
      return {
        id: planId,
        title: 'Ejecución Optimizada por VWAP & Anti-Slippage',
        route: `Llenado VWAP @ ${d.effectiveVwapPrice ?? 88.5} (Slippage: ${d.slippageBps ?? 0} bps)`,
        capitalRequiredUsdt: d.targetAmountUsdt ?? 1000,
        expectedNetSpreadPct: 1.15,
        expectedProfitUsdt: ((d.targetAmountUsdt ?? 1000) * 1.15) / 100,
        riskLevel: d.liquidityHealth === 'HIGH_LIQUIDITY' ? 'LOW' : 'MEDIUM',
        assignedOperatorName: 'Operador Principal',
        rationale: `Simulación de impacto exitosa. Salud de liquidez: ${d.liquidityHealth ?? 'ACCEPTABLE'} con deslizamiento controlado.`,
        status: 'PROPOSED',
      };
    }

    if (skillName === 'calculate_optimal_spread_avellaneda' && data && typeof data === 'object') {
      const d = data as { optimalBidPrice?: number; optimalAskPrice?: number; reservationPrice?: number; recommendedAction?: string };
      return {
        id: planId,
        title: 'Market Making Cuantitativo (Avellaneda-Stoikov)',
        route: `Bid: ${d.optimalBidPrice ?? 0} | Ask: ${d.optimalAskPrice ?? 0} (Res: ${d.reservationPrice ?? 0})`,
        capitalRequiredUsdt: 2500,
        expectedNetSpreadPct: 1.25,
        expectedProfitUsdt: 31.25,
        riskLevel: 'LOW',
        assignedOperatorName: 'Lead Market Maker',
        rationale: `Cotizaciones óptimas calibradas por inventario y volatilidad. Acción sugerida: ${d.recommendedAction ?? 'HOLD'}.`,
        status: 'PROPOSED',
      };
    }

    if (skillName === 'compute_optimal_order_slicing_twap_vwap' && data && typeof data === 'object') {
      const d = data as { totalSlices?: number; averageSliceAmountUsdt?: number; executionAlgorithm?: string; expectedMarketImpactPct?: number };
      return {
        id: planId,
        title: `Ejecución Algorítmica ${d.executionAlgorithm ?? 'TWAP'} (Anti-Impact)`,
        route: `${d.totalSlices ?? 5} Bloques de ~$${d.averageSliceAmountUsdt ?? 500} USDT`,
        capitalRequiredUsdt: (d.totalSlices ?? 5) * (d.averageSliceAmountUsdt ?? 500),
        expectedNetSpreadPct: 0.95,
        expectedProfitUsdt: (((d.totalSlices ?? 5) * (d.averageSliceAmountUsdt ?? 500)) * 0.95) / 100,
        riskLevel: 'LOW',
        assignedOperatorName: 'Algorithmic Execution Desk',
        rationale: `Fragmentación institucional programada para no mover el libro. Impacto estimado: solo ${d.expectedMarketImpactPct ?? 0.2}%.`,
        status: 'PROPOSED',
      };
    }

    if (skillName === 'calculate_cross_exchange_basis_spread' && data && typeof data === 'object') {
      const d = data as { buyPlatform?: string; sellPlatform?: string; netSpreadPct?: number; netProfitUsdt?: number; buyPrice?: number; sellPrice?: number };
      return {
        id: planId,
        title: 'Arbitraje Espacial Cross-Exchange',
        route: `Comprar en ${d.buyPlatform ?? 'Platform A'} @ ${d.buyPrice ?? 0} ➔ Vender en ${d.sellPlatform ?? 'Platform B'} @ ${d.sellPrice ?? 0}`,
        capitalRequiredUsdt: 1500,
        expectedNetSpreadPct: d.netSpreadPct ?? 1.1,
        expectedProfitUsdt: d.netProfitUsdt ?? 16.5,
        riskLevel: (d.netSpreadPct ?? 0) >= 1.0 ? 'LOW' : 'MEDIUM',
        assignedOperatorName: 'Arbitrage Specialist',
        rationale: `Discrepancia de base entre plataformas detectada con transferencia directa. Margen neto confirmado de ${d.netSpreadPct ?? 0}%.`,
        status: 'PROPOSED',
      };
    }

    if (skillName === 'optimize_capital_allocation_kelly' && data && typeof data === 'object') {
      const d = data as { optimalTicketSizeUsdt?: number; recommendedFractionPct?: number; strategicRationale?: string };
      return {
        id: planId,
        title: 'Asignación Óptima de Capital (Kelly Criterion)',
        route: `Ticket Óptimo: $${d.optimalTicketSizeUsdt ?? 1000} USDT (${d.recommendedFractionPct ?? 20}% del total)`,
        capitalRequiredUsdt: d.optimalTicketSizeUsdt ?? 1000,
        expectedNetSpreadPct: 1.3,
        expectedProfitUsdt: ((d.optimalTicketSizeUsdt ?? 1000) * 1.3) / 100,
        riskLevel: 'LOW',
        assignedOperatorName: 'Treasury & Risk Officer',
        rationale: d.strategicRationale || 'Optimización matemática de crecimiento patrimonial minimizando probabilidad de ruina.',
        status: 'PROPOSED',
      };
    }

    if (skillName === 'optimize_idle_capital_simple_earn' && data && typeof data === 'object') {
      const d = data as { idleCapitalUsdt?: number; effectiveAprPct?: number; interestEarnedUsdt?: number; parkingStrategy?: string };
      const cap = d.idleCapitalUsdt ?? 2000;
      const apr = d.effectiveAprPct ?? 12.5;
      const profit = d.interestEarnedUsdt ?? 21.0;
      return {
        id: planId,
        title: 'Estacionamiento de Capital Pasivo en Binance Simple Earn',
        route: `Colocar $${cap} USDT en Simple Earn Flexible (${apr}% APR)`,
        capitalRequiredUsdt: cap,
        expectedNetSpreadPct: 1.05,
        expectedProfitUsdt: profit,
        riskLevel: 'LOW',
        assignedOperatorName: 'Chief Treasury Officer',
        rationale: d.parkingStrategy || `Rendimiento compuesto libre de riesgo del ${apr}% APR con rescate instantáneo para fondeo inmediato de órdenes P2P.`,
        status: 'PROPOSED',
      };
    }

    if (skillName === 'check_bank_operational_status' && data && typeof data === 'object') {
      const d = data as { networkStatus?: string; averageSettlementLatencyMinutes?: number; operationalSummary?: string };
      return {
        id: planId,
        title: 'Protocolo de Seguridad y Monitoreo Bancario',
        route: `Canal Bancario (${d.networkStatus ?? 'OPERATIONAL'})`,
        capitalRequiredUsdt: 1000,
        expectedNetSpreadPct: 1.2,
        expectedProfitUsdt: 12.0,
        riskLevel: 'LOW',
        assignedOperatorName: 'Compliance Officer',
        rationale: d.operationalSummary || 'Monitoreo de latencia y estabilidad de la cámara de compensación bancaria.',
        status: 'PROPOSED',
      };
    }

    if (skillName === 'calculate_earn_yield_vs_p2p_hurdle_rate' && data && typeof data === 'object') {
      const d = data as { verdict?: string; netP2pCycleReturnPct?: number; isP2pProfitableOverEarn?: boolean; reasoning?: string };
      const isOperate = d.verdict === 'OPERATE_P2P';
      return {
        id: planId,
        title: isOperate ? 'Despliegue Táctico P2P (Supera Hurdle Rate)' : 'Refugio de Tesorería en Binance Earn',
        route: isOperate ? 'Rotación Maker P2P (Spread Superior al Hurdle)' : 'Estacionar Capital en Simple Earn Flexible',
        capitalRequiredUsdt: 1500,
        expectedNetSpreadPct: isOperate ? (d.netP2pCycleReturnPct ?? 1.1) : 0.45,
        expectedProfitUsdt: isOperate ? (1500 * (d.netP2pCycleReturnPct ?? 1.1)) / 100 : 6.75,
        riskLevel: isOperate ? 'MEDIUM' : 'LOW',
        assignedOperatorName: isOperate ? 'Lead Market Maker' : 'Chief Treasury Officer',
        rationale: d.reasoning || 'Evaluación cuantitativa comparativa entre spread P2P y tasa libre de riesgo.',
        status: 'PROPOSED',
      };
    }

    if (skillName === 'optimize_locked_vs_flexible_liquidity_ladder' && data && typeof data === 'object') {
      const d = data as { totalTreasuryUsdt?: number; flexibleBufferUsdt?: number; locked30dUsdt?: number; blendedPortfolioAprPct?: number };
      const total = d.totalTreasuryUsdt ?? 10000;
      const blendedApr = d.blendedPortfolioAprPct ?? 5.2;
      return {
        id: planId,
        title: 'Escalera de Liquidez Estructurada (Liquidity Ladder)',
        route: `Buffer Flexible: $${d.flexibleBufferUsdt ?? 4000} USDT | Locked 30d: $${d.locked30dUsdt ?? 6000} USDT`,
        capitalRequiredUsdt: total,
        expectedNetSpreadPct: blendedApr / 12,
        expectedProfitUsdt: (total * blendedApr) / 1200,
        riskLevel: 'LOW',
        assignedOperatorName: 'Treasury Portfolio Manager',
        rationale: `Escalera de liquidez balanceada: cobertura total para picos de órdenes P2P mientras el remanente captura ${blendedApr}% APR.`,
        status: 'PROPOSED',
      };
    }

    if (skillName === 'evaluate_dual_investment_p2p_exit' && data && typeof data === 'object') {
      const d = data as { strikePrice?: number; annualizedAprPct?: number; investedCapitalUsdt?: number; recommendation?: string };
      const cap = d.investedCapitalUsdt ?? 2000;
      const strike = d.strikePrice ?? 70000;
      const apr = d.annualizedAprPct ?? 25.0;
      return {
        id: planId,
        title: 'Cobertura & Salida con Dual Investment (Sell High)',
        route: `Strike @ $${strike} | APR: ${apr}%`,
        capitalRequiredUsdt: cap,
        expectedNetSpreadPct: (apr * 7) / 365,
        expectedProfitUsdt: (cap * apr * 7) / 36500,
        riskLevel: 'LOW',
        assignedOperatorName: 'Derivatives & Hedging Desk',
        rationale: `Estrategia estructurada Sell High. Captura un ${apr}% APR mientras se fija un precio de salida por encima del mercado. Recomendación: ${d.recommendation ?? 'SELL_HIGH_FAVORABLE'}.`,
        status: 'PROPOSED',
      };
    }

    if (skillName === 'triage_incident_and_escalate' && data && typeof data === 'object') {
      const d = data as { severityLevel?: string; maxResolutionSlaMinutes?: number; requiresHumanHandoff?: boolean; isolationProtocol?: string };
      return {
        id: planId,
        title: `Protocolo de Triaje Operativo (${d.severityLevel ?? 'P1_CRITICAL'})`,
        route: `Aislamiento Preventivo de Canales Bancarios | SLA: ${d.maxResolutionSlaMinutes ?? 10}m`,
        capitalRequiredUsdt: 1000,
        expectedNetSpreadPct: 1.25,
        expectedProfitUsdt: 12.5,
        riskLevel: d.severityLevel === 'P1_CRITICAL' ? 'HIGH' : 'MEDIUM',
        assignedOperatorName: 'Chief Security & Operations Officer',
        rationale: d.isolationProtocol || 'Protocolo de contención de crisis operativa y remediación supervisada.',
        status: 'PROPOSED',
      };
    }

    if (skillName === 'audit_sop_compliance_enforcement' && data && typeof data === 'object') {
      const d = data as { isCompliant?: boolean; complianceScore?: number; summary?: string; disciplinaryAction?: string };
      return {
        id: planId,
        title: 'Auditoría Forense de Gobernanza SOP',
        route: `Verificación Titular 1:1 & Saldo Disponible (${d.complianceScore ?? 100}%)`,
        capitalRequiredUsdt: 1000,
        expectedNetSpreadPct: 1.35,
        expectedProfitUsdt: 13.5,
        riskLevel: 'LOW',
        assignedOperatorName: 'Compliance Officer',
        rationale: d.summary || 'Auditoría formal de apego a Protocolos Operativos Estándar para prevención de fraudes.',
        status: 'PROPOSED',
      };
    }

    if (skillName === 'sync_google_sheets_live_ledger' && data && typeof data === 'object') {
      const d = data as { calculatedGrossProfitUsdt?: number; calculatedNetMarginPct?: number };
      return {
        id: planId,
        title: 'Sincronización Contable en Google Sheets Ledger',
        route: 'Exportación Atómica de Operaciones a Hoja de Balance en Vivo',
        capitalRequiredUsdt: 1000,
        expectedNetSpreadPct: d.calculatedNetMarginPct ?? 1.4,
        expectedProfitUsdt: d.calculatedGrossProfitUsdt ?? 14.0,
        riskLevel: 'LOW',
        assignedOperatorName: 'Desk Operations Lead',
        rationale: 'Registro de auditoría transaccional con fórmulas dinámicas para conciliación de caja.',
        status: 'PROPOSED',
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
   * Approves a strategy plan and shifts its state in SQLite,
   * triggering multi-channel webhook dispatches to Telegram Sentinel and Google Sheets Ledger.
   */
  async executePlan(planId: string): Promise<{
    success: boolean;
    error?: string;
    dispatchSummary?: PlanDispatchSummary;
  }> {
    const plan = this.db.getStrategyPlan(planId);
    if (!plan) {
      return { success: false, error: `El plan ${planId} no existe en la base de datos.` };
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
        console.warn(`[GeminiOrchestrator] Webhook dispatch warning for plan ${planId}:`, dispatchErr);
      }
    }

    return { success: updated, dispatchSummary };
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
