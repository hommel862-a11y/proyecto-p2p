import {
  Component,
  signal,
  OnInit,
  OnDestroy,
  computed,
  ViewChild,
  ElementRef,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VoiceSpeechService, normalizeVoicePrompt } from '../../core/voice-speech.service';
import { StorageService } from '../../core/storage';
import {
  type CopilotChatMessage,
  type StrategyPlanCard,
  type CopilotResponse,
  getBcvMarketIntelligence,
  type BcvMarketIntelligence,
  optimizeIdleCapitalSimpleEarn,
  calculateEarnYieldVsP2pHurdleRate,
  optimizeLockedVsFlexibleLiquidityLadder,
  type SimpleEarnOptimizationResult,
  type EarnHurdleRateResult,
  type LiquidityLadderResult,
  auditSopComplianceEnforcement,
  triageIncidentAndEscalate,
  qualifyDirectLeadAndClose,
  monitorServiceHealthAndFallback,
  forecastCashFlowAndReconciliation,
  type SopAuditResult,
  type IncidentTriageResult,
  type DirectLeadQualificationResult,
  type ServiceHealthResult,
  type CashFlowForecastResult,
} from '@p2p/core';

export interface AlphaWatcherStatusDto {
  enabled: boolean;
  pollIntervalSeconds: number;
  minNetSpreadPct: number;
  scanCount: number;
  lastOpportunity: { time: number; netSpreadPct: number; route: string } | null;
}

export interface EngramObservationDto {
  id?: number;
  topicKey: string;
  type: 'discovery' | 'decision' | 'architecture' | 'pattern' | 'bugfix' | 'preference';
  scope?: string;
  what: string;
  why: string;
  whereAffected: string;
  learned: string;
  confidenceScore: number;
  status: 'active' | 'needs_review';
  createdAt?: number;
  updatedAt?: number;
}

export interface AgentHealthStatusDto {
  role: string;
  name: string;
  status: 'ONLINE' | 'STANDBY' | 'BUSY' | 'DEGRADED';
  lastActiveTime: number;
  opsProcessed: number;
  description: string;
}

export interface MarketLearningRecord {
  id?: number;
  topicKey: string;
  category:
    | 'SPREAD_CYCLE'
    | 'BCV_IMPACT'
    | 'OPERATOR_PERFORMANCE'
    | 'COUNTERPARTY_BEHAVIOR'
    | 'TRIANGULATION_ROUTE'
    | string;
  insight: string;
  confidenceScore?: number;
  sampleCount?: number;
  dataPayload?: unknown;
  createdAt?: number;
  updatedAt?: number;
}

interface ElectronCopilotBridge {
  sendMessage(params: { prompt: string; history?: CopilotChatMessage[] }): Promise<CopilotResponse>;
  transcribeAudio?(params: {
    audioBase64: string;
    mimeType: string;
  }): Promise<{ text: string; error?: string }>;
  executePlan(params: { planId: string }): Promise<{ success: boolean; error?: string }>;
  getPlans(params?: { limit?: number }): Promise<StrategyPlanCard[]>;
  getLearnings(params?: { category?: string; limit?: number }): Promise<MarketLearningRecord[]>;
  getEngramObservations?(params?: {
    filter?: { topicKey?: string; type?: string; status?: string };
    limit?: number;
  }): Promise<EngramObservationDto[]>;
  setApiKey(params: { apiKey: string }): Promise<boolean>;
  testConnection(): Promise<{ success: boolean; model: string; message: string }>;
  getWatcherStatus(): Promise<AlphaWatcherStatusDto>;
  setWatcherConfig(
    params: Partial<{ enabled: boolean; minNetSpreadPct: number; pollIntervalSeconds: number }>,
  ): Promise<boolean>;
  runSwarmAnalysis?(): Promise<{
    riskVerdict: {
      status: string;
      riskScore: number;
      recommendedAction: string;
      vetoReason?: string;
    };
    sentinelSignal: { netSpreadPct: number };
    strategistProposal?: { rationale: string };
    suggestedPlan?: StrategyPlanCard;
    executionSummary: string;
  }>;
  getSwarmHealth?(): Promise<AgentHealthStatusDto[]>;
  triggerProactiveEval?(params?: {
    parallelRate?: number;
    bcvRate?: number;
    spotUsdt?: number;
  }): Promise<{
    macroAlert: ProactiveEventAlertDto | null;
    depegAlert: ProactiveEventAlertDto | null;
  }>;
  assessCounterparty?(params: {
    alias: string;
    realName: string;
    documentId?: string;
    bankPayerName?: string;
  }): Promise<{
    isSafe: boolean;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    warning?: string;
    isThirdPartyPayment: boolean;
    riskScore: number;
    reputation: string;
    profile: CounterpartyProfileDto | null;
  }>;
  recordCounterpartyTrade?(params: {
    alias: string;
    realName: string;
    documentId: string;
    volumeUsdt: number;
    bankPayerName: string;
    hadTriangulationAttempt: boolean;
  }): Promise<{ success: boolean }>;
  listCounterparties?(params?: { limit?: number }): Promise<CounterpartyProfileDto[]>;
}

export interface CounterpartyProfileDto {
  id: string;
  alias: string;
  realName: string;
  documentId: string;
  phone?: string;
  reputation: 'TRUSTED' | 'VERIFIED' | 'NORMAL' | 'SUSPICIOUS' | 'BLOCKED';
  riskScore: number;
  successfulTradesCount: number;
  triangulationIncidentsCount: number;
  totalVolumeUsdt: number;
  notes?: string;
  lastTradeTimestamp?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProactiveEventAlertDto {
  id: string;
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
  data: Record<string, unknown>;
  timestamp: number;
  recommendedAction?: string;
  autoKillswitch?: boolean;
}

function getElectronCopilot(): ElectronCopilotBridge | undefined {
  if (typeof window !== 'undefined') {
    return (window as unknown as { electron?: { copilot?: ElectronCopilotBridge } }).electron
      ?.copilot;
  }
  return undefined;
}

@Component({
  selector: 'app-copilot',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './copilot.html',
  styleUrls: ['./copilot.scss'],
})
export class Copilot implements OnInit, OnDestroy {
  @ViewChild('messagesViewport') messagesViewportRef?: ElementRef<HTMLDivElement>;

  readonly voiceService = inject(VoiceSpeechService);
  private readonly storage = inject(StorageService);

  sidebarCollapsed = signal<boolean>(false);

  toggleSidebar(): void {
    this.sidebarCollapsed.update((v) => !v);
  }

  async toggleVoiceDictation(): Promise<void> {
    if (this.voiceService.isListening()) {
      this.voiceService.stopListening();
      return;
    }

    // Direct hardware MediaRecorder capture for 100% reliable local recording without Google Speech network errors
    await this.voiceService.startMediaRecording(async (audio) => {
      await this.processRecordedAudio(audio);
    });
  }

  private async processRecordedAudio(audio: { base64: string; mimeType: string }): Promise<void> {
    if (!audio.base64) return;
    this.actionSuccessNotice.set('⏳ Transcribiendo mensaje de voz con Gemini Flash...');

    try {
      const copilot = getElectronCopilot();
      let res: { text: string; error?: string };

      if (copilot?.transcribeAudio) {
        try {
          res = await copilot.transcribeAudio({
            audioBase64: audio.base64,
            mimeType: audio.mimeType,
          });
        } catch (ipcErr: unknown) {
          const ipcMsg = ipcErr instanceof Error ? ipcErr.message : String(ipcErr);
          if (ipcMsg.includes('not allow-listed')) {
            console.warn(
              '[Copilot] IPC bridge channel not allow-listed in current cached window. Seamlessly using direct Gemini web transcription.',
            );
            res = await this.transcribeAudioWeb(audio);
          } else {
            throw ipcErr;
          }
        }
      } else {
        res = await this.transcribeAudioWeb(audio);
      }

      if (res.text) {
        const normalized = normalizeVoicePrompt(res.text);
        const current = this.inputPrompt().trim();
        this.inputPrompt.set(current ? `${current} ${normalized}` : normalized);
        this.actionSuccessNotice.set('✓ Audio transcripto exitosamente.');
        setTimeout(() => this.actionSuccessNotice.set(null), 2500);

        if (this.voiceService.autoSendOnSilence()) {
          void this.sendPrompt();
        }
      } else if (res.error) {
        this.voiceService.lastError.set(res.error);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.voiceService.lastError.set(`Error al transcribir audio: ${msg}`);
    }
  }

  private async transcribeAudioWeb(audio: {
    base64: string;
    mimeType: string;
  }): Promise<{ text: string; error?: string }> {
    const apiKey = this.storage.get<string>('p2p.gemini.apiKey') || this.apiKeyInput().trim();
    if (!apiKey) {
      return {
        text: '',
        error:
          'Para transcribir audio por voz, configurá tu API Key de Gemini en la pestaña "Conexión Gemini".',
      };
    }

    const candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    const cleanMime = audio.mimeType.split(';')[0] || 'audio/webm';

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
                data: audio.base64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 250,
      },
    };

    let lastErrorDetail = '';

    for (const model of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
        lastErrorDetail = errMsg;

        if (res.status === 400 && errMsg.includes('API key not valid')) {
          return {
            text: '',
            error:
              'API Key inválida: Verificá que la clave de Gemini esté bien copiada en la pestaña "Conexión Gemini".',
          };
        }
        if (res.status === 403) {
          return {
            text: '',
            error: `Permiso denegado por Google (${errMsg}). Verificá tu API Key.`,
          };
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        lastErrorDetail = msg;
        console.warn(`[transcribeAudioWeb] Error on model ${model}:`, err);
      }
    }

    return {
      text: '',
      error: `Error al transcribir con Gemini: ${lastErrorDetail || 'Verificá tu conexión y la API Key.'}`,
    };
  }

  scrollToBottom(): void {
    setTimeout(() => {
      if (this.messagesViewportRef?.nativeElement) {
        const el = this.messagesViewportRef.nativeElement;
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      }
    }, 60);
  }

  messages = signal<CopilotChatMessage[]>([
    {
      role: 'assistant',
      content:
        '¡Hola! Soy **Gentleman AI**, tu Senior Architect y Copiloto P2P. Estoy auditando en tiempo real las directivas de tesorería del BCV, spreads triangulares y la microestructura de los libros bajo rigurosa disciplina institucional. Acordate: los fundamentos y la preservación de capital van antes que la velocidad. ¿Qué par o estrategia querés que analicemos?',
      timestamp: Date.now(),
    },
  ]);

  inputPrompt = signal<string>('');
  isLoading = signal<boolean>(false);
  activeTab = signal<
    'chat' | 'plans' | 'earn' | 'operations' | 'memory' | 'counterparties' | 'config'
  >('chat');

  // ---------------------------------------------------------------------------
  // Binance Earn & Passive Treasury Reactive State (10 Quantitative Skills)
  // ---------------------------------------------------------------------------
  earnCapitalUsdt = signal<number>(5000);
  earnT1AprPct = signal<number>(10.0);
  earnT2AprPct = signal<number>(2.5);
  earnHurdleGrossSpreadPct = signal<number>(1.6);
  earnTradeCycleHours = signal<number>(2);

  earnSimpleResult = computed<SimpleEarnOptimizationResult>(() => {
    return optimizeIdleCapitalSimpleEarn({
      capitalUsdt: this.earnCapitalUsdt(),
      tier1LimitUsdt: 500,
      tier1AprPct: this.earnT1AprPct(),
      tier2AprPct: this.earnT2AprPct(),
      holdingDays: 30,
    });
  });

  earnHurdleResult = computed<EarnHurdleRateResult>(() => {
    return calculateEarnYieldVsP2pHurdleRate({
      grossP2pSpreadPct: this.earnHurdleGrossSpreadPct(),
      platformFeePct: 0.1,
      bankingRiskPremiumPct: 0.2,
      fxDevaluationRiskPct: 0.3,
      averageTradeCycleHours: this.earnTradeCycleHours(),
      simpleEarnAprPct: this.earnSimpleResult().effectiveBlendedAprPct,
    });
  });

  earnLadderResult = computed<LiquidityLadderResult>(() => {
    return optimizeLockedVsFlexibleLiquidityLadder({
      totalTreasuryUsdt: this.earnCapitalUsdt(),
      dailyP2pVolumeUsdt: this.earnCapitalUsdt() * 0.4,
      p2pTurnoverDays: 1,
      flexibleAprPct: this.earnSimpleResult().effectiveBlendedAprPct,
      locked30dAprPct: 5.5,
      locked60dAprPct: 8.0,
      safetyBufferPct: 30,
    });
  });

  askEarnRecommendation(topic: string): void {
    let prompt = '';
    const cap = this.earnCapitalUsdt();
    if (topic === 'simple_earn') {
      prompt = `Tengo $${cap} USDT disponibles en tesorería. ¿Cómo optimizo la colocación entre el tramo Tier 1 y Tier 2 de Binance Simple Earn Flexible para maximizar el yield sin bloquear liquidez de órdenes P2P?`;
    } else if (topic === 'hurdle_rate') {
      prompt = `Con un spread P2P de ${this.earnHurdleGrossSpreadPct()}% y un ciclo de ${this.earnTradeCycleHours()} horas, ¿supera la Hurdle Rate de Binance Simple Earn (${this.earnSimpleResult().effectiveBlendedAprPct}% APR) o conviene estacionar fondos?`;
    } else if (topic === 'ladder') {
      prompt = `Diseñá una escalera de liquidez (Liquidity Laddering) para $${cap} USDT que mantenga un buffer D+0 para rotar en Banesco y asigne el excedente a locked 30d/60d con mayor APR.`;
    }
    this.activeTab.set('chat');
    this.sendPrompt(prompt);
  }

  // ---------------------------------------------------------------------------
  // Operations Workflow, SOP Governance & Live Ledger (10 Quantitative Skills)
  // ---------------------------------------------------------------------------
  sopOrderId = signal<string>('ORD-SOP-LIVE');
  sopHolderMatches = signal<boolean>(true);
  sopBalanceConfirmed = signal<boolean>(true);
  sopResponseMinutes = signal<number>(4);
  sopFundsReleasedEarly = signal<boolean>(false);

  triageIncidentType = signal<
    'BANK_ACCOUNT_HOLD' | 'THIRD_PARTY_PAYMENT' | 'PARTIAL_PAYMENT_FRAUD' | 'APP_LATENCY_DELAY'
  >('BANK_ACCOUNT_HOLD');
  triageAmountUsdt = signal<number>(1500);

  leadChannel = signal<'WHATSAPP' | 'TELEGRAM' | 'INSTAGRAM_DM'>('WHATSAPP');
  leadWeeklyVolume = signal<number>(5000);
  leadKyc = signal<boolean>(true);

  wsLatencyMs = signal<number>(120);
  bankUptimePct = signal<number>(99.5);

  sopAuditResult = computed<SopAuditResult>(() => {
    return auditSopComplianceEnforcement({
      orderId: this.sopOrderId(),
      accountHolderMatchesDocument: this.sopHolderMatches(),
      bankBalanceConfirmedInAvailableFunds: this.sopBalanceConfirmed(),
      responseTimeMinutes: this.sopResponseMinutes(),
      fundsReleasedBeforeBankVerification: this.sopFundsReleasedEarly(),
    });
  });

  triageResult = computed<IncidentTriageResult>(() => {
    return triageIncidentAndEscalate({
      incidentType: this.triageIncidentType(),
      amountAtRiskUsdt: this.triageAmountUsdt(),
      orderId: this.sopOrderId(),
    });
  });

  leadQualificationResult = computed<DirectLeadQualificationResult>(() => {
    return qualifyDirectLeadAndClose({
      leadChannel: this.leadChannel(),
      estimatedWeeklyVolumeUsdt: this.leadWeeklyVolume(),
      paymentMethodPreferred: 'Pago Móvil / Banesco',
      isKycVerified: this.leadKyc(),
      primaryConcern: 'SPEED',
      currentParallelRate: 85.0,
    });
  });

  serviceHealthResult = computed<ServiceHealthResult>(() => {
    return monitorServiceHealthAndFallback({
      webSocketLatencyMs: this.wsLatencyMs(),
      bankApiUptimePct: this.bankUptimePct(),
      dbQueryResponseTimeMs: 15,
      unresolvedErrorsCount: 0,
    });
  });

  cashFlowResult = computed<CashFlowForecastResult>(() => {
    return forecastCashFlowAndReconciliation({
      fiatBankBalancesTotalUsdtEquiv: 1500,
      cryptoExchangeBalancesUsdt: 5000,
      pendingUnsettledOrdersUsdt: 500,
      dailyProjectedVolumeUsdt: 2500,
      averageOperationalExpensesDailyUsdt: 30,
    });
  });

  askOperationsRecommendation(topic: string): void {
    let prompt = '';
    if (topic === 'sop_audit') {
      prompt = `Audita el cumplimiento SOP de la orden ${this.sopOrderId()}: titular verificado (${this.sopHolderMatches()}), fondos en disponible (${this.sopBalanceConfirmed()}), tiempo de atención ${this.sopResponseMinutes()} min. ¿Hay riesgo de sanción o desvío de protocolo?`;
    } else if (topic === 'incident_triage') {
      prompt = `Activa el triaje de incidencia para ${this.triageIncidentType()} con $${this.triageAmountUsdt()} USDT en riesgo. ¿Cuál es el SLA máximo, el protocolo de aislamiento y las acciones de remediación?`;
    } else if (topic === 'lead_closing') {
      prompt = `Califica un prospecto comercial que ingresa por ${this.leadChannel()} con volumen estimado de $${this.leadWeeklyVolume()} USDT/semana (KYC: ${this.leadKyc() ? 'Sí' : 'No'}). Generá la cotización institucional y el guión de cierre.`;
    } else if (topic === 'ledger_reconciliation') {
      prompt = `Generá el reporte de conciliación contable y sincronización con Google Sheets para la sesión actual, incluyendo proyección de runway de tesorería y validación de comisiones bancarias.`;
    }
    this.activeTab.set('chat');
    this.sendPrompt(prompt);
  }

  plans = signal<StrategyPlanCard[]>([]);
  counterparties = signal<CounterpartyProfileDto[]>([
    {
      id: 'CP-1',
      alias: 'BanescoFast_P2P',
      realName: 'Carlos Eduardo Mendoza',
      documentId: 'V-19842103',
      phone: '0414-2394102',
      reputation: 'TRUSTED',
      riskScore: 5,
      successfulTradesCount: 48,
      triangulationIncidentsCount: 0,
      totalVolumeUsdt: 58400,
      notes: 'Comerciante verificado. Pago Móvil inmediato sin terceros.',
      lastTradeTimestamp: Date.now() - 3600000,
      createdAt: Date.now() - 86400000 * 30,
      updatedAt: Date.now() - 3600000,
    },
    {
      id: 'CP-2',
      alias: 'Perez_Exchanger',
      realName: 'José Gregorio Pérez',
      documentId: 'V-23114502',
      phone: '0424-9182341',
      reputation: 'SUSPICIOUS',
      riskScore: 80,
      successfulTradesCount: 3,
      triangulationIncidentsCount: 1,
      totalVolumeUsdt: 1200,
      notes:
        'Intentó pagar desde cuenta de un familiar ("María Pérez"). Retención preventiva aplicada.',
      lastTradeTimestamp: Date.now() - 7200000,
      createdAt: Date.now() - 86400000 * 5,
      updatedAt: Date.now() - 7200000,
    },
  ]);
  learnings = signal<MarketLearningRecord[]>([]);
  engramObservations = signal<EngramObservationDto[]>([
    {
      id: 1,
      topicKey: 'triangulation/ves-usdt-btc',
      type: 'discovery',
      scope: 'project',
      what: 'Triangulación táctica VES->USDT->BTC genera 1.35% neto con ticket de 1000 USDT.',
      why: 'Brecha cambiaria en 22.9% con liquidez profunda en Banesco previo a ventana de intervención cambiaria.',
      whereAffected: 'Banesco Pago Móvil / Binance P2P VES-USDT',
      learned:
        'La regla de oro (>=0.50%) se cumple holgadamente (1.35%). Operar preferentemente antes del mediodía.',
      confidenceScore: 0.95,
      status: 'active',
      createdAt: Date.now() - 3600000,
      updatedAt: Date.now() - 3600000,
    },
    {
      id: 2,
      topicKey: 'risk/bcv-intervention-window',
      type: 'pattern',
      scope: 'project',
      what: 'Ventana de inyección de divisas BCV activa entre 10:00 y 11:30 AM.',
      why: 'Presión a la baja en la tasa paralela genera contracción transitoria de spreads.',
      whereAffected: 'Mesa de cambio y libros P2P VES',
      learned:
        'Asegurar inventario en USDT antes de las 10:00 AM y esperar estabilización del mediodía.',
      confidenceScore: 0.92,
      status: 'active',
      createdAt: Date.now() - 7200000,
      updatedAt: Date.now() - 7200000,
    },
  ]);
  engramFilterType = signal<string>('ALL');

  filteredEngramObservations = computed(() => {
    const filter = this.engramFilterType();
    const list = this.engramObservations();
    if (filter === 'ALL') return list;
    return list.filter((item) => item.type.toUpperCase() === filter.toUpperCase());
  });
  actionSuccessNotice = signal<string | null>(null);
  expandedBreakdownPlanIds = signal<Set<string>>(new Set());

  toggleBreakdown(planId: string): void {
    const current = new Set(this.expandedBreakdownPlanIds());
    if (current.has(planId)) {
      current.delete(planId);
    } else {
      current.add(planId);
    }
    this.expandedBreakdownPlanIds.set(current);
  }

  isBreakdownOpen(planId: string): boolean {
    return this.expandedBreakdownPlanIds().has(planId);
  }

  connectionStatus = signal<{ connected: boolean; model: string; message: string }>({
    connected: false,
    model: 'gemini-3.6-flash',
    message: 'Verificando conexión...',
  });

  // Institutional Multi-Agent Swarm (4-Agent Desk Swarm)
  swarmHealth = signal<AgentHealthStatusDto[]>([
    {
      role: 'SENTINEL',
      name: 'Alpha Sentinel',
      status: 'ONLINE',
      lastActiveTime: 0,
      opsProcessed: 0,
      description: 'Monitoreo 24/7 de microestructura, orderbook L2 y brecha BCV.',
    },
    {
      role: 'STRATEGIST',
      name: 'Gentleman AI (Estratega)',
      status: 'ONLINE',
      lastActiveTime: 0,
      opsProcessed: 0,
      description: 'Modelado de arbitraje triangular, VWAP y slippage tolerado.',
    },
    {
      role: 'RISK_GATEKEEPER',
      name: 'Risk Gatekeeper',
      status: 'ONLINE',
      lastActiveTime: 0,
      opsProcessed: 0,
      description: 'Veto unilateral ante spread <0.50%, límites bancarios o contrapartes.',
    },
    {
      role: 'DISPUTE_AUDITOR',
      name: 'Dispute & Proof Auditor',
      status: 'STANDBY',
      lastActiveTime: 0,
      opsProcessed: 0,
      description: 'Auditoría forense de comprobantes OCR y expedientes de mediación.',
    },
  ]);
  isSwarmAnalyzing = signal<boolean>(false);
  activeAlerts = signal<ProactiveEventAlertDto[]>([]);

  dismissAlert(alertId: string): void {
    this.activeAlerts.update((list) => list.filter((a) => a.id !== alertId));
  }

  apiKeyInput = signal<string>('');
  isTestingConnection = signal<boolean>(false);

  // Institutional Treasury HUD Metrics
  treasuryMetrics = signal<{
    totalEquityUsd: number;
    cryptoRatioPct: number;
    fiatRatioPct: number;
    dailyAccumulatedProfitUsdt: number;
    avgCycleVelocityMinutes: number;
    killSwitchActive: boolean;
  }>({
    totalEquityUsd: 12500,
    cryptoRatioPct: 88,
    fiatRatioPct: 12,
    dailyAccumulatedProfitUsdt: 142.5,
    avgCycleVelocityMinutes: 14,
    killSwitchActive: false,
  });

  // Centinela Autónomo (Alpha Watcher) state
  watcherStatus = signal<AlphaWatcherStatusDto>({
    enabled: true,
    pollIntervalSeconds: 30,
    minNetSpreadPct: 1.15,
    scanCount: 0,
    lastOpportunity: null,
  });

  async toggleWatcher(): Promise<void> {
    const copilot = getElectronCopilot();
    const current = this.watcherStatus();
    const newEnabled = !current.enabled;
    this.watcherStatus.update((s) => ({ ...s, enabled: newEnabled }));
    if (copilot) {
      await copilot.setWatcherConfig({ enabled: newEnabled });
    }
    this.actionSuccessNotice.set(
      newEnabled
        ? '🟢 CENTINELA AUTÓNOMO ACTIVADO: Escaneando libro cada 30s.'
        : '⏸ CENTINELA PAUSADO: Monitoreo en segundo plano detenido.',
    );
    setTimeout(() => this.actionSuccessNotice.set(null), 4000);
  }

  async setWatcherMinSpread(threshold: number): Promise<void> {
    const copilot = getElectronCopilot();
    this.watcherStatus.update((s) => ({ ...s, minNetSpreadPct: threshold }));
    if (copilot) {
      await copilot.setWatcherConfig({ minNetSpreadPct: threshold });
    }
    this.actionSuccessNotice.set(`🎯 Umbral de Centinela ajustado a spread neto >= ${threshold}%`);
    setTimeout(() => this.actionSuccessNotice.set(null), 3000);
  }

  // BCV Macro Intelligence & Gap Monitor
  bcvRates = signal<{ bcv: number; parallel: number }>({
    bcv: 64.8,
    parallel: 78.4,
  });

  bcvIntelligence = computed<BcvMarketIntelligence>(() => {
    const { bcv, parallel } = this.bcvRates();
    return getBcvMarketIntelligence(parallel, bcv);
  });

  // Action Launcher (Play modal & quick ticket)
  selectedActionPlan = signal<StrategyPlanCard | null>(null);
  ticketCopiedNotice = signal<boolean>(false);

  openActionLauncher(plan: StrategyPlanCard): void {
    this.selectedActionPlan.set(plan);
  }

  closeActionLauncher(): void {
    this.selectedActionPlan.set(null);
  }

  copyTicketToClipboard(plan: StrategyPlanCard): void {
    const lines = [
      `⚡ ORDEN P2P: ${plan.title}`,
      `• Ruta: ${plan.route}`,
      `• Ticket: $${plan.capitalRequiredUsdt} USDT`,
      `• Spread Esperado: +${plan.expectedNetSpreadPct}%`,
      `• Beneficio Estimado: +$${plan.expectedProfitUsdt} USDT`,
      `• Directiva: ${plan.rationale}`,
    ].join('\n');

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(lines);
      this.ticketCopiedNotice.set(true);
      setTimeout(() => this.ticketCopiedNotice.set(false), 2500);
    }
  }

  openBinanceP2pPortal(): void {
    const url = 'https://p2p.binance.com/es/trade/all-payments/USDT?fiat=VES';
    if (typeof window !== 'undefined') {
      window.open(url, '_blank');
    }
  }

  triggerKillSwitch(): void {
    const current = this.treasuryMetrics();
    const newState = !current.killSwitchActive;
    this.treasuryMetrics.update((m) => ({ ...m, killSwitchActive: newState }));
    if (newState) {
      this.actionSuccessNotice.set(
        '🚨 KILL-SWITCH ACTIVADO: Órdenes pausadas y directiva de resguardo en USDT emitida.',
      );
    } else {
      this.actionSuccessNotice.set(
        '✅ KILL-SWITCH DESACTIVADO: Mesa de operaciones en modo normal.',
      );
    }
    setTimeout(() => this.actionSuccessNotice.set(null), 5000);
  }

  private autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

  async ngOnInit(): Promise<void> {
    const savedKey = this.storage.get<string>('p2p.gemini.apiKey');
    if (savedKey && !this.apiKeyInput()) {
      this.apiKeyInput.set(savedKey);
    }
    await this.refreshData();
    await this.checkConnection();

    // Periodic auto-sync with Alpha Watcher plans and learnings
    this.autoRefreshTimer = setInterval(async () => {
      await this.refreshData();
    }, 15000);
  }

  ngOnDestroy(): void {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
    }
    this.voiceService.stopListening();
    this.voiceService.stopSpeaking();
  }

  async checkConnection(): Promise<void> {
    const copilot = getElectronCopilot();
    if (copilot) {
      try {
        const res = await copilot.testConnection();
        this.connectionStatus.set({
          connected: res.success,
          model: res.model,
          message: res.message,
        });
      } catch (err: unknown) {
        this.connectionStatus.set({
          connected: false,
          model: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      const savedKey = this.storage.get<string>('p2p.gemini.apiKey') || this.apiKeyInput().trim();
      if (!savedKey) {
        this.connectionStatus.set({
          connected: false,
          model: 'simulated',
          message: 'Modo navegador web (simulación local sin API Key)',
        });
        return;
      }

      try {
        const testRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${savedKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }] }),
          },
        );
        if (testRes.ok) {
          this.connectionStatus.set({
            connected: true,
            model: 'gemini-2.5-flash',
            message: '¡Conexión verificada exitosamente con Gemini API!',
          });
        } else {
          const errData = (await testRes.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          const errMsg = errData?.error?.message || `HTTP ${testRes.status}`;
          this.connectionStatus.set({
            connected: false,
            model: 'error',
            message: `Error de API Key: ${errMsg}`,
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.connectionStatus.set({
          connected: false,
          model: 'error',
          message: `Error de red al conectar: ${msg}`,
        });
      }
    }
  }

  async saveApiKey(): Promise<void> {
    const key = this.apiKeyInput().trim();
    if (!key) return;

    this.storage.set('p2p.gemini.apiKey', key);
    const copilot = getElectronCopilot();
    if (copilot) {
      await copilot.setApiKey({ apiKey: key });
      this.actionSuccessNotice.set('¡API Key guardada en SQLite exitosamente!');
    } else {
      this.actionSuccessNotice.set('¡API Key guardada exitosamente en el navegador!');
    }
    setTimeout(() => this.actionSuccessNotice.set(null), 4000);
    await this.checkConnection();
    this.activeTab.set('chat');
  }

  async testConnectionAction(): Promise<void> {
    this.isTestingConnection.set(true);
    await this.checkConnection();
    this.isTestingConnection.set(false);
  }

  async refreshData(): Promise<void> {
    const copilot = getElectronCopilot();
    if (copilot) {
      try {
        const plans = await copilot.getPlans({ limit: 20 });
        this.plans.set(plans);
        const rawLearnings = await copilot.getLearnings({ limit: 50 });
        this.learnings.set(rawLearnings);
        if (copilot.getEngramObservations) {
          const obs = await copilot.getEngramObservations({ limit: 50 });
          if (obs && obs.length > 0) {
            this.engramObservations.set(obs);
          }
        }
        if (copilot.getWatcherStatus) {
          const watcher = await copilot.getWatcherStatus();
          if (watcher) {
            this.watcherStatus.set(watcher);
          }
        }
        if (copilot.getSwarmHealth) {
          const health = await copilot.getSwarmHealth();
          if (health && health.length > 0) {
            this.swarmHealth.set(health);
          }
        }
        if (copilot.triggerProactiveEval) {
          const evalRes = await copilot.triggerProactiveEval({
            parallelRate: this.bcvRates().parallel,
            bcvRate: this.bcvRates().bcv,
            spotUsdt: 1.0,
          });
          const newAlerts: ProactiveEventAlertDto[] = [];
          if (evalRes.macroAlert) newAlerts.push(evalRes.macroAlert);
          if (evalRes.depegAlert) newAlerts.push(evalRes.depegAlert);
          if (newAlerts.length > 0) {
            this.activeAlerts.set(newAlerts);
          }
        }
        if (copilot.listCounterparties) {
          const profiles = await copilot.listCounterparties({ limit: 50 });
          if (profiles && profiles.length > 0) {
            this.counterparties.set(profiles);
          }
        }
      } catch (err) {
        console.warn('Error loading copilot data from Electron IPC:', err);
      }
    }
  }

  async triggerSwarmAnalysis(): Promise<void> {
    if (this.isSwarmAnalyzing()) return;
    this.isSwarmAnalyzing.set(true);

    try {
      const copilot = getElectronCopilot();
      if (copilot?.runSwarmAnalysis) {
        const result = await copilot.runSwarmAnalysis();
        const statusBadge =
          result.riskVerdict.status === 'VETOED' ? '⛔ VETADO POR RIESGO' : '🛡 APROBADO POR RIESGO';
        const vetoReason = result.riskVerdict.vetoReason
          ? ` (Motivo: ${result.riskVerdict.vetoReason})`
          : '';
        const rationale = result.strategistProposal?.rationale ?? 'Sin propuesta viable';

        const lines = [
          '### ⚡ Análisis del Enjambre Multi-Agente Completado',
          `**Estado de Auditoría:** \`${statusBadge}\` (Score de Riesgo: ${result.riskVerdict.riskScore}/100)`,
          '',
          `• **Centinela:** Spread neto preliminar de ${result.sentinelSignal.netSpreadPct}%`,
          `• **Estratega (Gentleman AI):** ${rationale}`,
          `• **Risk Gatekeeper:** ${result.riskVerdict.recommendedAction}${vetoReason}`,
          '',
          `*${result.executionSummary}*`,
        ];

        this.messages.update((msgs) => [
          ...msgs,
          {
            role: 'assistant',
            content: lines.join('\n'),
            plan: result.suggestedPlan,
            timestamp: Date.now(),
          },
        ]);
        this.scrollToBottom();

        if (result.suggestedPlan) {
          const newPlan = result.suggestedPlan;
          this.plans.update((p) => [newPlan, ...p.filter((x) => x.id !== newPlan.id)]);
        }

        this.actionSuccessNotice.set(
          `Enjambre de 4 Agentes ejecutado: ${result.riskVerdict.status}`,
        );
        setTimeout(() => this.actionSuccessNotice.set(null), 4000);
      } else {
        this.actionSuccessNotice.set('⚡ Auditoría de Enjambre completada en modo simulación.');
        setTimeout(() => this.actionSuccessNotice.set(null), 3000);
      }
    } catch (err: unknown) {
      console.error('Error running swarm analysis:', err);
      const msg = err instanceof Error ? err.message : String(err);
      this.actionSuccessNotice.set(`Error en Swarm: ${msg}`);
      setTimeout(() => this.actionSuccessNotice.set(null), 4000);
    } finally {
      this.isSwarmAnalyzing.set(false);
      await this.refreshData();
    }
  }

  async sendPrompt(text?: string): Promise<void> {
    const promptToSend = text || this.inputPrompt().trim();
    if (!promptToSend || this.isLoading()) return;

    this.inputPrompt.set('');
    this.messages.update((msgs) => [
      ...msgs,
      { role: 'user', content: promptToSend, timestamp: Date.now() },
    ]);
    this.scrollToBottom();

    this.isLoading.set(true);

    try {
      const copilot = getElectronCopilot();
      if (copilot) {
        const response = await copilot.sendMessage({
          prompt: promptToSend,
          history: this.messages(),
        });

        this.messages.update((msgs) => [
          ...msgs,
          {
            role: 'assistant',
            content: response.reply,
            plan: response.suggestedPlan,
            timestamp: Date.now(),
          },
        ]);
        this.scrollToBottom();

        if (response.suggestedPlan) {
          this.plans.update((p) => [
            response.suggestedPlan!,
            ...p.filter((x) => x.id !== response.suggestedPlan!.id),
          ]);
        }

        if (this.voiceService.ttsEnabled()) {
          this.voiceService.speak(response.reply);
        }
      } else {
        // Fallback demo for standalone web browser mode
        setTimeout(() => {
          const fallbackPlan: StrategyPlanCard = {
            id: `WEB-${Date.now().toString(36).toUpperCase()}`,
            title: 'Triangulación Táctica VES -> USDT -> BTC',
            route: 'VES (Pago Móvil) -> USDT -> BTC -> VES',
            capitalRequiredUsdt: 1000,
            expectedNetSpreadPct: 1.45,
            expectedProfitUsdt: 14.5,
            riskLevel: 'LOW',
            assignedOperatorName: 'Operador Principal',
            rationale:
              'Spread neto 1.45% validado por la regla de oro (>0.50%) con libro de órdenes sanitizado.',
            status: 'PROPOSED',
          };
          const fallbackText =
            'He analizado la microestructura del mercado P2P. Detecté una oportunidad de arbitraje triangular superior a la regla de oro (0.50% neto). Podés revisar la ficha y darle PLAY cuando quieras despacharla.';
          this.messages.update((msgs) => [
            ...msgs,
            {
              role: 'assistant',
              content: fallbackText,
              plan: fallbackPlan,
              timestamp: Date.now(),
            },
          ]);
          this.plans.update((p) => [fallbackPlan, ...p]);
          this.scrollToBottom();

          if (this.voiceService.ttsEnabled()) {
            this.voiceService.speak(fallbackText);
          }
        }, 800);
      }
    } catch (err: unknown) {
      this.messages.update((msgs) => [
        ...msgs,
        {
          role: 'assistant',
          content: `Hubo un error al consultar el servicio de orquestación: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
        },
      ]);
      this.scrollToBottom();
    } finally {
      this.isLoading.set(false);
      await this.refreshData();
    }
  }

  async executePlan(plan: StrategyPlanCard): Promise<void> {
    const copilot = getElectronCopilot();
    if (copilot) {
      const res = await copilot.executePlan({ planId: plan.id });
      if (res.success) {
        plan.status = 'APPROVED';
        this.actionSuccessNotice.set(
          `¡Estrategia ${plan.id} APROBADA y delegada al operador con éxito!`,
        );
        setTimeout(() => this.actionSuccessNotice.set(null), 4000);
        await this.refreshData();
      }
    } else {
      plan.status = 'APPROVED';
      this.actionSuccessNotice.set(`¡Estrategia ${plan.id} APROBADA en modo simulación web!`);
      setTimeout(() => this.actionSuccessNotice.set(null), 4000);
    }
    // Launch Quick Action Drawer and auto-copy ticket
    this.openActionLauncher(plan);
    this.copyTicketToClipboard(plan);
  }

  quickPrompt(type: string): void {
    if (type === 'explicar_triangulacion') {
      this.sendPrompt(
        'Explicame en detalle cómo funciona la triangulación financiera en el mercado P2P venezolano (fiat VES -> USDT -> divisa alternativa -> VES), cuáles son los cuellos de botella de liquidez bancaria y qué precauciones matemáticas debemos tomar según la regla de oro.',
      );
    } else if (type === 'resumen_ejecutivo') {
      this.sendPrompt(
        'Generá un resumen ejecutivo de la sesión actual de trading: estado del capital, directiva de tesorería, spreads capturados, y recomendaciones prioritarias para el operador.',
      );
    } else if (type === 'forensic_audit') {
      this.sendPrompt(
        '¿En qué horarios tuve más alertas de riesgo esta semana y respeté el spread mínimo en mis operaciones?',
      );
    } else if (type === 'riesgo_bcv') {
      this.sendPrompt(
        '¿Cuál es el riesgo actual de intervención del BCV en mesas de cambio, cómo afecta la brecha cambiaria al inventario en bolívares y cuál es la estrategia de salida rápida?',
      );
    } else if (type === 'triangulacion') {
      this.sendPrompt(
        'Analizá oportunidades de arbitraje triangular entre VES, USDT y divisas alternativas.',
      );
    } else if (type === 'microestructura') {
      this.sendPrompt(
        'Calibrá las cotizaciones de compra y venta según el modelo cuantitativo de Avellaneda-Stoikov, evaluá la toxicidad VPIN del libro y diseñá un plan de slicing TWAP/VWAP.',
      );
    } else if (type === 'seguridad_bancos') {
      this.sendPrompt(
        'Audita el estado operativo en tiempo real de la red bancaria (Banesco, Mercantil, BDV, Pago Móvil), cotejá listas negras de fraude y verificá directivas de pausa.',
      );
    } else if (type === 'cross_exchange') {
      this.sendPrompt(
        'Calculá el arbitraje espacial de bases cross-exchange entre Binance P2P y El Dorado P2P, deduciendo comisiones de retiro y tiempos de compensación.',
      );
    } else if (type === 'earn_idle') {
      this.sendPrompt(
        'Tengo capital ocioso en la cuenta. ¿Cómo lo optimizo en Binance Simple Earn Flexible aprovechando los tramos de APR sin inmovilizar liquidez para las órdenes P2P entrantes?',
      );
    } else if (type === 'earn_hurdle') {
      this.sendPrompt(
        '¿Cuál es la tasa de corte (Hurdle Rate) hoy entre el rendimiento neto de hacer arbitraje P2P y la tasa libre de riesgo de Binance Simple Earn? ¿Conviene operar o parquear fondos?',
      );
    } else if (type === 'earn_ladder') {
      this.sendPrompt(
        'Diseñá una escalera de liquidez estructurada (Liquidity Laddering) dividiendo el capital entre Simple Earn Flexible D+0 para atender compras P2P y tramos locked a 30/60 días.',
      );
    } else if (type === 'bcv') {
      this.sendPrompt(
        '¿Cuál es la brecha cambiaria actual con el BCV y qué directiva de tesorería recomendás?',
      );
    } else if (type === 'operadores') {
      this.sendPrompt(
        'Diseñá un plan de asignación de capital para 2 operadores con $5,000 de capital total.',
      );
    } else if (type === 'cobertura') {
      this.sendPrompt(
        'Audita la exposición actual en VES y proponé una cobertura delta-neutral con derivados para mitigar devaluación.',
      );
    } else if (type === 'volatilidad') {
      this.sendPrompt(
        'Pronosticá la volatilidad y deriva del spread para las próximas 2 horas y sugerí ajustes de markup de compra y venta.',
      );
    } else if (type === 'disputa') {
      this.sendPrompt(
        'Generá un expediente arbitral formal para una orden con sospecha de pago de terceros no autorizados.',
      );
    }
  }
}
