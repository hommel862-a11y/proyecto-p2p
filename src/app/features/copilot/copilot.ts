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
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { VoiceSpeechService, normalizeVoicePrompt } from '../../core/voice-speech.service';
import { AccountsService, type TreasurySnapshot } from '../../core/accounts.service';
import { TriangulationIntelligenceService } from '../../core/triangulation-intelligence.service';
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
  setProviderConfig?(params: { provider: string; model?: string; apiKey?: string }): Promise<boolean>;
  getProviderConfig?(): Promise<{
    activeProvider: string;
    activeModel: string;
    configuredProviders: Record<string, boolean>;
  }>;
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
  listAgents?(): Promise<RegisteredAgentDto[]>;
  toggleAgent?(params: { id: string; enabled: boolean }): Promise<boolean>;
  saveAgent?(params: { agent: RegisteredAgentDto }): Promise<boolean>;
}

export interface RegisteredAgentDto {
  id: string;
  name: string;
  role: string;
  avatar: string;
  description: string;
  tools: string[];
  systemPromptModifier: string;
  enabled: boolean;
  isCustom?: boolean;
}

export const DEFAULT_FALLBACK_AGENTS: RegisteredAgentDto[] = [
  {
    id: 'web-researcher',
    name: 'Investigador Web & Regulatorio',
    role: 'WEB_RESEARCHER',
    avatar: '🌐',
    description: 'Indaga en tiempo real circulares de SUDEBAN, resoluciones del BCV y anuncios de Binance con Google Search Grounding.',
    tools: ['search_google_live', 'check_bank_operational_status'],
    systemPromptModifier: 'Especialista en investigación de hechos y regulación. Cotejá siempre con fuentes oficiales verificadas.',
    enabled: true,
  },
  {
    id: 'corporate-cfo',
    name: 'Director Financiero & Tesorero',
    role: 'CORPORATE_CFO',
    avatar: '💼',
    description: 'Asesoría integral en flujo de caja, balance, yield de capital ocioso en Binance Simple Earn y runway de tesorería.',
    tools: ['optimize_idle_capital_simple_earn', 'calculate_earn_yield_vs_p2p_hurdle_rate', 'forecast_cash_flow_and_reconciliation'],
    systemPromptModifier: 'Director financiero institucional. Minimizá costos de fricción y garantizá liquidez operativa inmediata.',
    enabled: true,
  },
  {
    id: 'quant-strategist',
    name: 'Estratega Cuantitativo P2P',
    role: 'QUANT_STRATEGIST',
    avatar: '📐',
    description: 'Cálculo de arbitraje triangular, cotizaciones asimétricas Avellaneda-Stoikov y métrica VPIN.',
    tools: ['scan_triangular_arbitrage', 'calculate_optimal_spread_avellaneda', 'compute_optimal_order_slicing_twap_vwap'],
    systemPromptModifier: 'Estratega cuantitativo de alta frecuencia. Preservación del spread neto superior al 0.50%.',
    enabled: true,
  },
  {
    id: 'risk-officer',
    name: 'Oficial de Cumplimiento & Riesgo',
    role: 'RISK_OFFICER',
    avatar: '🛡️',
    description: 'Veto preventivo de operaciones que excedan límites SUDEBAN, cobertura Delta-Neutral y listas negras.',
    tools: ['evaluate_delta_neutral_hedge', 'audit_zk_mesh_threat', 'check_counterparty_blacklist'],
    systemPromptModifier: 'Guardián estricto de gobernanza y mitigación de devaluación y fraudes por terceros.',
    enabled: true,
  },
  {
    id: 'dispute-auditor',
    name: 'Auditor Forense & Disputas',
    role: 'DISPUTE_AUDITOR',
    avatar: '🔍',
    description: 'Inspección OCR de comprobantes bancarios, detección de adulteración digital y generación de expedientes de arbitraje.',
    tools: ['audit_payment_proof_ocr', 'generate_dispute_dossier', 'audit_sop_compliance_enforcement'],
    systemPromptModifier: 'Auditor forense. Verificación rigurosa de fondos disponibles y titularidad 1:1.',
    enabled: true,
  },
];

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

/**
 * Treasury slice of the preload bridge: the single ingress that lets the main process audit
 * real bank limits, plus the kill-switch the main process owns. Kept as a separate, narrow
 * interface (instead of widening `ElectronCopilotBridge`) because the copilot namespace never
 * carries these channels.
 */
interface ElectronTreasuryBridge {
  announceTreasury?(snapshot: TreasurySnapshot): Promise<boolean>;
  killswitch?: {
    trigger(params?: { reason?: string; source?: string }): Promise<boolean>;
    getStatus(): Promise<{
      isTriggered: boolean;
      timestamp?: number;
      reason?: string;
      source?: string;
    }>;
  };
}

function getElectronTreasury(): ElectronTreasuryBridge | undefined {
  if (typeof window !== 'undefined') {
    return (window as unknown as { electron?: ElectronTreasuryBridge }).electron;
  }
  return undefined;
}

/**
 * Honest "minutes per cycle" projection for the HUD, derived only from the real SUDEBAN
 * velocity headroom the snapshot carries: the transactions each ACTIVE account can still
 * execute today, spread over the minutes left in the local day. This is a projection from
 * measured data, not an estimate of the operator's pace.
 *
 * Returns `Number.NaN` when there is no measurable headroom (no accounts, every account
 * DISABLED, or every account already at its cap) because there is no honest number to show in
 * that case — the HUD must degrade visibly instead of printing a plausible-looking figure.
 */
function projectMinutesPerCycle(snapshot: TreasurySnapshot, now: number = Date.now()): number {
  const remainingTransactions = snapshot.accounts.reduce((sum, account) => {
    if (account.status === 'DISABLED') return sum;
    return sum + Math.max(0, account.maxDailyTransactions - account.todayTransactionCount);
  }, 0);
  if (remainingTransactions <= 0) return Number.NaN;

  const endOfDay = new Date(now);
  endOfDay.setHours(24, 0, 0, 0);
  const minutesLeft = Math.max(1, Math.round((endOfDay.getTime() - now) / 60_000));
  return Math.max(1, Math.round(minutesLeft / remainingTransactions));
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
  private readonly router = inject(Router);
  private readonly accountsService = inject(AccountsService);
  private readonly triangulationService = inject(TriangulationIntelligenceService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly activeArtifactPlan = signal<StrategyPlanCard | null>(null);

  openPlanArtifact(plan: StrategyPlanCard): void {
    this.activeArtifactPlan.set(plan);
  }

  closePlanArtifact(): void {
    this.activeArtifactPlan.set(null);
  }

  formatMarkdown(content: string): string {
    if (!content) return '';
    // 1. Escapar caracteres HTML básicos para prevenir XSS
    let html = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 2. Bloques de código con sintaxis pre / code
    html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_match, lang, code) => {
      return `<pre class="md-code-block"><div class="md-code-header"><span class="md-code-lang">${lang || 'código'}</span></div><code>${code.trim()}</code></pre>`;
    });

    // 3. Código inline
    html = html.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');

    // 4. Tablas en Markdown estándar
    html = html.replace(
      /((\|[^\n]+\|\r?\n)(\|(?:\s*:?-+:?\s*\|)+\r?\n)((?:\|[^\n]+\|\r?\n?)+))/g,
      (_match, _fullTable, headerLine, _separatorLine, rowsBlock) => {
        const headers = headerLine
          .split('|')
          .slice(1, -1)
          .map((h: string) => `<th class="md-th">${h.trim()}</th>`)
          .join('');
        const rows = rowsBlock
          .trim()
          .split('\n')
          .map((row: string) => {
            const cells = row
              .split('|')
              .slice(1, -1)
              .map((c: string) => `<td class="md-td">${c.trim()}</td>`)
              .join('');
            return `<tr class="md-tr">${cells}</tr>`;
          })
          .join('');
        return `<div class="md-table-wrapper"><table class="md-table"><thead class="md-thead"><tr class="md-tr">${headers}</tr></thead><tbody class="md-tbody">${rows}</tbody></table></div>`;
      },
    );

    // 5. Encabezados jerárquicos
    html = html.replace(/^#### (.*$)/gim, '<h5 class="md-h4">$1</h5>');
    html = html.replace(/^### (.*$)/gim, '<h4 class="md-h3">$1</h4>');
    html = html.replace(/^## (.*$)/gim, '<h3 class="md-h2">$1</h3>');
    html = html.replace(/^# (.*$)/gim, '<h2 class="md-h1">$1</h2>');

    // 6. Citas / Callouts analíticos
    html = html.replace(/^\> (.*$)/gim, '<blockquote class="md-quote">$1</blockquote>');

    // 7. Negrita y Cursiva
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // 8. Listas ordenadas y desordenadas
    html = html.replace(/^([•\-\*])\s+(.*$)/gim, '<li class="md-li">$2</li>');
    html = html.replace(/(<li class="md-li">[\s\S]*?<\/li>)+/g, '<ul class="md-ul">$&</ul>');

    html = html.replace(/^(\d+)\.\s+(.*$)/gim, '<li class="md-oli">$2</li>');
    html = html.replace(/(<li class="md-oli">[\s\S]*?<\/li>)+/g, '<ol class="md-ol">$&</ol>');

    // 9. Badges / Chips KPI cuantitativos
    html = html.replace(/(\+\d+\.?\d*%\s*(?:neto|bruto|spread)?)/gi, '<span class="md-kpi positive">$1</span>');
    html = html.replace(/(-\d+\.?\d*%\s*(?:fee|comisión|comision)?)/gi, '<span class="md-kpi negative">$1</span>');
    html = html.replace(/(\$\d+(?:,\d{3})*(?:\.\d+)?\s*USDT)/gi, '<span class="md-kpi usdt">$1</span>');
    html = html.replace(/(\d+(?:\.\d+)?\s*VES\/USD|\d+(?:,\d{3})*(?:\.\d+)?\s*VES)/gi, '<span class="md-kpi ves">$1</span>');

    // 10. Párrafos
    const blocks = html.split(/\n{2,}/);
    html = blocks
      .map((block) => {
        const trimmed = block.trim();
        if (!trimmed) return '';
        if (
          trimmed.startsWith('<h') ||
          trimmed.startsWith('<pre') ||
          trimmed.startsWith('<div') ||
          trimmed.startsWith('<ul') ||
          trimmed.startsWith('<ol') ||
          trimmed.startsWith('<blockquote')
        ) {
          return trimmed;
        }
        return `<p class="md-p">${trimmed.replace(/\n/g, '<br>')}</p>`;
      })
      .filter(Boolean)
      .join('\n');

    return html;
  }

  renderMarkdown(content: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.formatMarkdown(content));
  }

  sidebarCollapsed = signal<boolean>(
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false,
  );
  readonly mobileSheetOpen = signal<boolean>(false);

  toggleSidebar(): void {
    this.sidebarCollapsed.update((v) => !v);
  }

  toggleMobileSheet(): void {
    this.mobileSheetOpen.update((v) => !v);
  }

  closeMobileSheet(): void {
    this.mobileSheetOpen.set(false);
  }

  openMobileSheet(): void {
    this.mobileSheetOpen.set(true);
  }

  async toggleVoiceDictation(): Promise<void> {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(25);
      } catch {
        /* sin soporte háptico */
      }
    }

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
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
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
    'chat' | 'agents' | 'plans' | 'earn' | 'operations' | 'memory' | 'counterparties' | 'config'
  >('chat');

  masterArea = computed<'conversacion' | 'agentes' | 'artefactos'>(() => {
    const tab = this.activeTab();
    if (tab === 'chat') return 'conversacion';
    if (tab === 'agents') return 'agentes';
    return 'artefactos';
  });

  artifactSubTab = signal<'plans' | 'earn' | 'operations' | 'memory' | 'counterparties' | 'config'>('plans');

  setMasterArea(area: 'conversacion' | 'agentes' | 'artefactos'): void {
    if (area === 'conversacion') {
      this.activeTab.set('chat');
    } else if (area === 'agentes') {
      this.activeTab.set('agents');
    } else {
      this.activeTab.set(this.artifactSubTab());
    }
  }

  setArtifactSubTab(subTab: 'plans' | 'earn' | 'operations' | 'memory' | 'counterparties' | 'config'): void {
    this.artifactSubTab.set(subTab);
    this.activeTab.set(subTab);
  }

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
    model: 'gemini-2.0-flash',
    message: 'Verificando conexión...',
  });

  // Institutional Multi-Agent Swarm (5-Agent Desk Swarm)
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
      role: 'EXCHANGE_INTEL',
      name: 'Exchange Intel Radar',
      status: 'ONLINE',
      lastActiveTime: 0,
      opsProcessed: 0,
      description: 'Arbitraje cruzado Binance vs Bybit vs El Dorado y ventanas BCV.',
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

  // ---------------------------------------------------------------------------
  // Autonomous Agent Manager (Pilar 2.3 - Hermes / OpenClaw)
  // ---------------------------------------------------------------------------
  registeredAgents = signal<RegisteredAgentDto[]>(DEFAULT_FALLBACK_AGENTS);
  activeAgentsCount = computed<number>(() => this.registeredAgents().filter((a) => a.enabled).length);

  async toggleRegisteredAgent(agent: RegisteredAgentDto): Promise<void> {
    const targetState = !agent.enabled;
    const copilot = getElectronCopilot();
    if (copilot?.toggleAgent) {
      try {
        await copilot.toggleAgent({ id: agent.id, enabled: targetState });
      } catch (err) {
        console.warn('[Copilot] Error toggling agent via IPC:', err);
      }
    }
    this.registeredAgents.update((list) =>
      list.map((a) => (a.id === agent.id ? { ...a, enabled: targetState } : a)),
    );
    this.actionSuccessNotice.set(
      `Agente "${agent.name}" ${targetState ? 'activado' : 'desactivado'}.`,
    );
    setTimeout(() => this.actionSuccessNotice.set(null), 3000);
  }

  consultAgent(agent: RegisteredAgentDto): void {
    this.activeTab.set('chat');
    this.sendPrompt(`@${agent.id}: Por favor, realizá un análisis operativo y recomendaciones estratégicas desde tu rol de ${agent.name}.`);
  }

  selectedAiProvider = signal<string>(
    this.storage.get<string>('p2p.ai.provider') || 'gemini',
  );
  apiKeyInput = signal<string>(
    this.storage.get<string>(`p2p.ai.key.${this.storage.get<string>('p2p.ai.provider') || 'gemini'}`) ||
      this.storage.get<string>('p2p.gemini.apiKey') ||
      '',
  );
  isTestingConnection = signal<boolean>(false);

  getProviderDisplayName(): string {
    switch (this.selectedAiProvider()) {
      case 'openai':
        return 'OpenAI (ChatGPT)';
      case 'anthropic':
        return 'Anthropic Claude';
      case 'deepseek':
        return 'DeepSeek AI';
      case 'qwen':
        return 'Qwen 2.5';
      case 'gemini':
      default:
        return 'Google Gemini';
    }
  }

  getProviderKeyPlaceholder(): string {
    switch (this.selectedAiProvider()) {
      case 'openai':
        return 'sk-proj-...';
      case 'anthropic':
        return 'sk-ant-...';
      case 'deepseek':
        return 'sk-...';
      case 'qwen':
        return 'sk-...';
      case 'gemini':
      default:
        return 'AIzaSy...';
    }
  }

  async onProviderChange(provider: string): Promise<void> {
    this.selectedAiProvider.set(provider);
    this.storage.set('p2p.ai.provider', provider);
    const existingKey =
      this.storage.get<string>(`p2p.ai.key.${provider}`) ||
      (provider === 'gemini' ? this.storage.get<string>('p2p.gemini.apiKey') || '' : '');
    this.apiKeyInput.set(existingKey);
    const copilot = getElectronCopilot();
    if (copilot?.setProviderConfig) {
      await copilot.setProviderConfig({ provider, apiKey: existingKey || undefined });
    }
    await this.checkConnection();
  }

  // ---------------------------------------------------------------------------
  // Institutional Treasury HUD — real data only
  //
  // Every figure below is derived from `AccountsService.buildTreasurySnapshot()` (the exact
  // projection the dashboard renders and the one announced to the main process) or from an
  // input the operator typed. No treasury literal is hardcoded anymore: when the snapshot is
  // not available yet the HUD degrades to `Number.NaN`, which the ticker prints verbatim,
  // instead of inventing a plausible-looking number.
  //
  // Known template debt, NOT fixable from this file: `copilot.html` still carries the labels
  // written for the old fabricated numbers. `cryptoRatioPct`/`fiatRatioPct` now hold
  // `nearLimitCount`/`overLimitCount` and `dailyAccumulatedProfitUsdt` holds the VES bank
  // balance, so those labels must be reworded by a follow-up that owns the template. The
  // template is out of this workstream's authorized scope, so the mismatch is reported rather
  // than silently worked around.
  // ---------------------------------------------------------------------------
  private readonly accounts = inject(AccountsService);

  /** Latest real treasury projection, or null when AccountsService could not produce one. */
  readonly treasurySnapshot = signal<TreasurySnapshot | null>(null);

  /** Real kill-switch state, mirrored from the main process that owns and gates it. */
  readonly killswitchActive = signal<boolean>(false);

  /** Hold-to-confirm progress for mobile tactile safety (0-100%). */
  readonly killswitchHoldProgress = signal<number>(0);
  readonly killswitchHolding = signal<boolean>(false);
  private killswitchHoldTimer: ReturnType<typeof setInterval> | null = null;
  private isTouchTrigger = false;

  /** False until a real snapshot exists: the HUD degrades, it never fabricates. */
  readonly treasuryDataAvailable = computed<boolean>(() => this.treasurySnapshot() !== null);

  treasuryMetrics = computed<{
    totalEquityUsd: number;
    cryptoRatioPct: number;
    fiatRatioPct: number;
    dailyAccumulatedProfitUsdt: number;
    avgCycleVelocityMinutes: number;
    killSwitchActive: boolean;
  }>(() => {
    const snapshot = this.treasurySnapshot();
    return {
      // The only USDT figure this build can show honestly is the capital the operator declares
      // in the Earn tab (same input `optimizeIdleCapitalSimpleEarn` uses); there is no
      // on-chain or ledger equity feed yet, so this is declared, not measured.
      totalEquityUsd: this.earnCapitalUsdt(),
      cryptoRatioPct: snapshot ? snapshot.nearLimitCount : Number.NaN,
      fiatRatioPct: snapshot ? snapshot.overLimitCount : Number.NaN,
      dailyAccumulatedProfitUsdt: snapshot ? snapshot.totalBalanceVes : Number.NaN,
      avgCycleVelocityMinutes: snapshot
        ? projectMinutesPerCycle(snapshot, snapshot.generatedAt)
        : Number.NaN,
      killSwitchActive: this.killswitchActive(),
    };
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
        ? '🟢 CENTINELA DE MERCADO ACTIVADO: Escaneando libro cada 30s.'
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

  /**
   * Rebuild the treasury projection from AccountsService and mirror it into the HUD.
   *
   * Pure and synchronous: the AccountsService signals are already the single source of truth
   * the dashboard renders, so this reads rather than recomputes any treasury figure.
   */
  syncTreasurySnapshot(): void {
    try {
      this.treasurySnapshot.set(this.accounts.buildTreasurySnapshot());
    } catch (err: unknown) {
      console.warn('[Copilot] Could not build the treasury snapshot:', err);
      this.treasurySnapshot.set(null);
    }
  }

  /**
   * Publish the real treasury state to the main process through `p2p:treasury-announce`.
   *
   * Fire-and-forget by contract: main only caches the payload, so a missing bridge or a
   * rejected payload must never break the HUD flow. The swarm re-announces right before every
   * analysis, so a transient failure can never leave the gatekeeper auditing stale data
   * without the operator noticing.
   */
  async announceTreasuryToMain(): Promise<void> {
    const bridge = getElectronTreasury();
    if (!bridge?.announceTreasury) return;
    const snapshot = this.treasurySnapshot() ?? this.accounts.buildTreasurySnapshot();
    try {
      const accepted = await bridge.announceTreasury(snapshot);
      if (!accepted) {
        console.warn('[Copilot] Main process rejected the treasury snapshot.');
      }
    } catch (err: unknown) {
      console.warn('[Copilot] Treasury announce failed:', err);
    }
  }

  /**
   * Mirror the main process' kill-switch state into the HUD.
   *
   * The flag lives in the main process (`ipc/killswitch-state.ts`) and is what actually gates
   * plan execution, so the pill must reflect main's truth instead of the renderer's optimism.
   */
  async syncKillswitchFromMain(): Promise<void> {
    const bridge = getElectronTreasury();
    if (!bridge?.killswitch?.getStatus) return;
    try {
      const status = await bridge.killswitch.getStatus();
      this.killswitchActive.set(status?.isTriggered === true);
    } catch (err: unknown) {
      console.warn('[Copilot] Could not read the kill-switch status:', err);
    }
  }

  /**
   * Arm the kill-switch through the real `p2p:killswitch-trigger` channel.
   *
   * Arming is deliberately one-way: main exposes no reset channel, because recovering the
   * desk is an operator decision and not a HUD click. A second click therefore re-confirms the
   * authoritative state instead of pretending to disarm. Without the bridge (browser/simulated
   * mode) the pill keeps its previous local-only behaviour.
   */
  async triggerKillSwitch(): Promise<void> {
    if (this.killswitchActive()) {
      this.actionSuccessNotice.set(
        '⛔ KILL-SWITCH YA ACTIVO: el rearmado es decisión del proceso principal (reinicio de la app).',
      );
      setTimeout(() => this.actionSuccessNotice.set(null), 5000);
      await this.syncKillswitchFromMain();
      return;
    }

    const bridge = getElectronTreasury();
    let armed = true;
    if (bridge?.killswitch?.trigger) {
      try {
        armed = await bridge.killswitch.trigger({ reason: 'manual-toggle', source: 'copilot-ui' });
      } catch (err: unknown) {
        console.warn('[Copilot] Kill-switch trigger failed:', err);
        // Never guess the outcome: re-read the authoritative state from main.
        await this.syncKillswitchFromMain();
        armed = this.killswitchActive();
      }
    }

    this.killswitchActive.set(armed);
    this.actionSuccessNotice.set(
      armed
        ? '🚨 KILL-SWITCH ACTIVADO: Órdenes pausadas y directiva de resguardo en USDT emitida.'
        : '⚠️ KILL-SWITCH NO ACTIVADO: el proceso principal rechazó el disparo.',
    );
    setTimeout(() => this.actionSuccessNotice.set(null), 5000);
  }

  startKillswitchHold(event?: TouchEvent): void {
    if (this.killswitchActive()) return;
    this.isTouchTrigger = true;
    this.killswitchHolding.set(true);
    this.killswitchHoldProgress.set(0);

    const stepMs = 40;
    const totalMs = 1200;
    const increment = (stepMs / totalMs) * 100;

    if (this.killswitchHoldTimer) {
      clearInterval(this.killswitchHoldTimer);
    }

    this.killswitchHoldTimer = setInterval(() => {
      const next = this.killswitchHoldProgress() + increment;
      if (next >= 100) {
        this.cancelKillswitchHold();
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try {
            navigator.vibrate([50, 50, 150]);
          } catch {
            // Ignore unsupported environments
          }
        }
        void this.triggerKillSwitch();
      } else {
        this.killswitchHoldProgress.set(Math.min(next, 99));
      }
    }, stepMs);
  }

  cancelKillswitchHold(): void {
    if (this.killswitchHoldTimer) {
      clearInterval(this.killswitchHoldTimer);
      this.killswitchHoldTimer = null;
    }
    this.killswitchHolding.set(false);
    this.killswitchHoldProgress.set(0);
    setTimeout(() => {
      this.isTouchTrigger = false;
    }, 300);
  }

  onKillswitchClick(event: MouseEvent): void {
    if (this.isTouchTrigger) {
      event.preventDefault();
      return;
    }
    void this.triggerKillSwitch();
  }

  private autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

  async ngOnInit(): Promise<void> {
    const savedKey = this.storage.get<string>('p2p.gemini.apiKey');
    if (savedKey && !this.apiKeyInput()) {
      this.apiKeyInput.set(savedKey);
    }
    await this.refreshData();
    // The kill-switch lives in the main process: read the real state before the pill is shown,
    // so the HUD can never advertise an armed desk that is not actually armed (or vice versa).
    await this.syncKillswitchFromMain();
    await this.checkConnection();

    const url = this.router.parseUrl(this.router.url);
    const prefill = url.queryParams['prefill'];
    if (prefill) {
      this.inputPrompt.set(prefill);
      this.activeTab.set('chat');
    }

    // Periodic auto-sync with Alpha Watcher plans and learnings
    this.autoRefreshTimer = setInterval(async () => {
      await this.refreshData();
    }, 15000);
  }

  ngOnDestroy(): void {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
    }
    if (this.killswitchHoldTimer) {
      clearInterval(this.killswitchHoldTimer);
    }
    this.voiceService.stopListening();
    this.voiceService.stopSpeaking();
  }

  async checkConnection(): Promise<void> {
    const copilot = getElectronCopilot();
    if (copilot) {
      try {
        const config = copilot.getProviderConfig ? await copilot.getProviderConfig() : null;
        if (config?.activeProvider) {
          this.selectedAiProvider.set(config.activeProvider);
        }
        const res = await copilot.testConnection();
        const activeName = this.getProviderDisplayName();
        this.connectionStatus.set({
          connected: res.success,
          model: `${activeName} · ${res.model}`,
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
      const provider = this.selectedAiProvider();
      const savedKey =
        this.apiKeyInput().trim() ||
        this.storage.get<string>(`p2p.ai.key.${provider}`) ||
        (provider === 'gemini' ? this.storage.get<string>('p2p.gemini.apiKey') : '');

      if (!savedKey) {
        this.connectionStatus.set({
          connected: false,
          model: 'simulada',
          message: 'Modo navegador web (simulación local heurística)',
        });
        return;
      }

      if (provider === 'gemini') {
        try {
          const testRes = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
            {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': savedKey,
              },
            },
          );

          if (testRes.ok) {
            this.connectionStatus.set({
              connected: true,
              model: 'Gemini · gemini-2.0-flash',
              message: '¡Conexión verificada exitosamente con Google Gemini! [0 tokens consumidos]',
            });
          } else {
            const errData = (await testRes.json().catch(() => ({}))) as {
              error?: { message?: string };
            };
            const lastErrMsg = errData?.error?.message || `HTTP ${testRes.status}`;
            this.connectionStatus.set({
              connected: false,
              model: 'error',
              message: `Error de API Key Gemini: ${lastErrMsg}`,
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
      } else {
        this.connectionStatus.set({
          connected: true,
          model: `${this.getProviderDisplayName()} · activo`,
          message: `Proveedor ${this.getProviderDisplayName()} configurado para llamadas soberanas.`,
        });
      }
    }
  }

  async saveApiKey(): Promise<void> {
    const provider = this.selectedAiProvider();
    const key = this.apiKeyInput().trim();
    if (!key) return;

    this.storage.set('p2p.ai.provider', provider);
    this.storage.set(`p2p.ai.key.${provider}`, key);
    if (provider === 'gemini') {
      this.storage.set('p2p.gemini.apiKey', key);
    }

    const copilot = getElectronCopilot();
    if (copilot) {
      if (copilot.setProviderConfig) {
        await copilot.setProviderConfig({ provider, apiKey: key });
      }
      if (provider === 'gemini') {
        await copilot.setApiKey({ apiKey: key });
      }
      this.actionSuccessNotice.set(
        `¡API Key de ${this.getProviderDisplayName()} guardada en SQLite exitosamente!`,
      );
    } else {
      this.actionSuccessNotice.set(
        `¡API Key de ${this.getProviderDisplayName()} guardada exitosamente en el navegador!`,
      );
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
    // Real treasury first: this also runs on the 15s auto-sync, which is what keeps the HUD and
    // the main-process cache fresh after operations are booked anywhere in the app.
    this.syncTreasurySnapshot();
    await this.announceTreasuryToMain();

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
        if (copilot.listAgents) {
          const agents = await copilot.listAgents();
          if (agents && agents.length > 0) {
            this.registeredAgents.set(agents);
          }
        }
      } catch (err) {
        console.warn('Error loading copilot data from Electron IPC:', err);
      }
    }
  }

  private runStandaloneSwarmAnalysis(): {
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
  } {
    const rates = this.triangulationService.liveRates();
    const bcvStatus = this.triangulationService.bcvStatus();
    const treasury = this.accountsService.buildTreasurySnapshot();
    const isKillswitchActive = this.treasuryMetrics().killSwitchActive;

    // 1. Sentinel Stage: Audit current market depth & spreads
    let grossSpread = 0;
    let netSpread = 0;
    let hasLiveFeed = false;
    const bestBuy = rates.binanceVesBuy.value;
    const bestSell = rates.binanceVesSell.value;

    if (bestBuy !== null && bestSell !== null && bestSell > 0) {
      grossSpread = ((bestBuy - bestSell) / bestSell) * 100;
      hasLiveFeed = true;
    } else if (rates.rateGapPct.value !== null) {
      grossSpread = rates.rateGapPct.value;
    } else {
      grossSpread = 0.85;
    }

    // Deduct maker fees (0.35%) and bank frictional overhead
    netSpread = Math.max(0, Math.round((grossSpread - 0.35) * 100) / 100);

    // 2. Strategist Stage (Gentleman AI): Formulate arbitrage proposal
    const capitalRequiredUsdt = 1000;
    const expectedProfitUsdt = Math.round(capitalRequiredUsdt * (netSpread / 100) * 100) / 100;
    let route = 'VES (Banesco) ➔ USDT (Maker Compra) ➔ VES (Maker Venta)';
    let rationale = `Captura de spread neto de +${netSpread}% con ticket de $${capitalRequiredUsdt} USDT.`;

    if (hasLiveFeed && bestBuy !== null && bestSell !== null) {
      route = `Compra P2P @${bestSell.toFixed(2)} VES ➔ Venta P2P @${bestBuy.toFixed(2)} VES`;
      rationale = `Arbitraje P2P directo en libros Binance. Entrada @${bestSell.toFixed(2)} y salida @${bestBuy.toFixed(2)} para capturar +${netSpread}% neto.`;
    }

    // 3. Risk Gatekeeper Stage: Institutional unilateral veto check
    let status: 'APPROVED' | 'VETOED' = 'APPROVED';
    let riskScore = 15;
    let vetoReason: string | undefined;
    let recommendedAction = 'Operar con disciplina institucional y verificación estricta de pagos.';

    if (isKillswitchActive) {
      status = 'VETOED';
      riskScore = 100;
      vetoReason = 'El Kill-Switch de emergencia está activado en la mesa de operaciones.';
      recommendedAction = 'Bloquear todas las órdenes activas y esperar directiva del operador.';
    } else if (treasury && treasury.overLimitCount > 0) {
      status = 'VETOED';
      riskScore = 90;
      vetoReason = `VETO POR RIESGO (TESORERÍA REAL): ${treasury.overLimitCount} cuenta(s) bancaria(s) agotaron su límite diario en VES.`;
      recommendedAction = 'Rotación obligatoria de cuentas bancarias antes de aceptar nuevas órdenes fiat.';
    } else if (treasury && treasury.disabledCount > 0) {
      status = 'VETOED';
      riskScore = 85;
      vetoReason = `VETO POR RIESGO: ${treasury.disabledCount} cuenta(s) bancaria(s) en estado DISABLED (pausadas o bloqueadas).`;
      recommendedAction = 'Restablecer o sustituir las cuentas inactivas antes de fondear la mesa.';
    } else if (treasury && treasury.saturatedCount > 0) {
      status = 'VETOED';
      riskScore = 80;
      vetoReason = `VETO POR RIESGO (VELOCIDAD BANCARIA): ${treasury.saturatedCount} cuenta(s) alcanzaron su tope diario de transacciones SUDEBAN.`;
      recommendedAction = 'Pausar cobros en cuentas saturadas para prevenir veto por compliance bancario.';
    } else if (netSpread < 0.50) {
      status = 'VETOED';
      riskScore = 75;
      vetoReason = `VETO POR REGLA DE ORO: El spread neto proyectado (${netSpread.toFixed(2)}%) es inferior al mínimo institucional (0.50% neto).`;
      recommendedAction = 'No operar en este nivel de compresión. Esperar expansión del spread o inyección de liquidez.';
    } else if (bcvStatus && bcvStatus.inWindow) {
      riskScore = 45;
      recommendedAction = 'Operar con cautela por ventana de intervención BCV activa. Priorizar rotación ultra-rápida.';
    }

    const executionSummary =
      status === 'APPROVED'
        ? `Auditoría favorable: Spread neto de +${netSpread}% con tesorería operativa y parámetros dentro de los límites de riesgo.`
        : `⛔ Auditoría vetada por el Oficial de Riesgo: ${vetoReason}`;

    const planId = `PLAN-SWARM-${Date.now().toString(36).toUpperCase()}`;
    const suggestedPlan: StrategyPlanCard = {
      id: planId,
      title:
        status === 'APPROVED'
          ? 'Arbitraje P2P Táctico: Captura de Spread'
          : 'Estrategia Vetada Preventivamente',
      route,
      capitalRequiredUsdt,
      expectedNetSpreadPct: netSpread,
      expectedProfitUsdt,
      riskLevel: riskScore <= 30 ? 'LOW' : riskScore <= 60 ? 'MEDIUM' : 'HIGH',
      status: status === 'APPROVED' ? 'PROPOSED' : 'REJECTED',
      rationale,
      isSimulated: !hasLiveFeed,
      esSimulado: !hasLiveFeed,
      assignedOperatorName: 'Mesa de Operaciones (Móvil)',
    };

    // Update Swarm Health telemetry
    this.swarmHealth.update((agents) =>
      agents.map((a) => ({
        ...a,
        opsProcessed: a.opsProcessed + 1,
        lastActiveTime: Date.now(),
        status: status === 'VETOED' && a.role === 'RISK_GATEKEEPER' ? 'BUSY' : 'ONLINE',
      })),
    );

    return {
      riskVerdict: {
        status,
        riskScore,
        recommendedAction,
        vetoReason,
      },
      sentinelSignal: { netSpreadPct: netSpread },
      strategistProposal: { rationale },
      suggestedPlan,
      executionSummary,
    };
  }

  async triggerSwarmAnalysis(): Promise<void> {
    if (this.isSwarmAnalyzing()) return;
    this.isSwarmAnalyzing.set(true);

    try {
      const copilot = getElectronCopilot();
      let result: {
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
      };

      if (copilot?.runSwarmAnalysis) {
        // Re-announce immediately before the run: the Risk Gatekeeper and plan execution read
        // the snapshot cached in the main process, so it must be the freshest projection rather
        // than whatever the periodic auto-sync last published.
        this.syncTreasurySnapshot();
        await this.announceTreasuryToMain();
        result = await copilot.runSwarmAnalysis();
      } else {
        result = this.runStandaloneSwarmAnalysis();
      }

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

  private buildLiveMarketContextForCopilot(): {
    contextText: string;
    hasLiveRates: boolean;
  } {
    const rates = this.triangulationService.liveRates();
    const bcv = this.triangulationService.bcvStatus();
    const treasury = this.accountsService.buildTreasurySnapshot();

    const lines: string[] = [];
    let hasLiveRates = false;

    lines.push('--- CONTEXTO DE MERCADO EN VIVO Y TESORERÍA ---');

    const bcvRate =
      rates.bcvUsd.value !== null ? `${rates.bcvUsd.value} VES/USD` : 'N/D (sin sincronizar)';
    const parRate =
      rates.parallelAvg.value !== null
        ? `${rates.parallelAvg.value} VES/USD`
        : 'N/D (sin sincronizar)';
    const gap = rates.rateGapPct.value !== null ? `${rates.rateGapPct.value}%` : 'N/D';
    const buyP2p = rates.binanceVesBuy.value !== null ? `${rates.binanceVesBuy.value} VES` : 'N/D';
    const sellP2p =
      rates.binanceVesSell.value !== null ? `${rates.binanceVesSell.value} VES` : 'N/D';

    if (
      rates.bcvUsd.value !== null ||
      rates.parallelAvg.value !== null ||
      rates.binanceVesBuy.value !== null
    ) {
      hasLiveRates = true;
    }

    lines.push(`• Tasa Oficial BCV: ${bcvRate}`);
    lines.push(`• Tasa Paralelo Promedio: ${parRate}`);
    lines.push(`• Brecha Cambiaria BCV/Paralelo: ${gap}`);
    lines.push(`• Binance P2P Venta (VES recibido por USDT): ${buyP2p}`);
    lines.push(`• Binance P2P Compra (VES pagado por USDT): ${sellP2p}`);
    lines.push(
      `• Ventana Intervención BCV: ${bcv.inWindow ? 'ACTIVA (Alta volatilidad cambiaria)' : 'Inactiva'} (Régimen: ${bcv.intensity})`,
    );

    lines.push('--- ESTADO DE CUENTAS BANCARIAS Y LÍMITES SUDEBAN ---');
    lines.push(`• Saldo Total en Bancos: ${treasury.totalBalanceVes.toLocaleString('es-VE')} VES`);
    lines.push(`• Gastado Hoy: ${treasury.totalSpentTodayVes.toLocaleString('es-VE')} VES`);
    const activeAccounts = treasury.accounts.filter((a) => a.status !== 'DISABLED');
    if (activeAccounts.length > 0) {
      const accSummary = activeAccounts
        .map(
          (a) =>
            `${a.bankName}: límite restante ${a.remainingLimitVes.toLocaleString('es-VE')} VES (${a.todayTransactionCount}/${a.maxDailyTransactions} txs)`,
        )
        .join(' | ');
      lines.push(`• Cuentas activas: ${accSummary}`);
    } else {
      lines.push('• Cuentas activas: Ninguna disponible');
    }
    if (treasury.rotationRecommendationId) {
      const recAcc = this.accountsService.getAccountById(treasury.rotationRecommendationId);
      lines.push(
        `• Cuenta recomendada para rotar: ${recAcc?.bankName ?? treasury.rotationRecommendationId}`,
      );
    }

    lines.push('--- REGLAS ESTRICTAS DE RESPUESTA ---');
    lines.push(
      '1. Usá EXCLUSIVAMENTE los datos de mercado listados arriba. Si un dato está como N/D, indicá con rigor técnico que no está disponible y NO inventes números.',
    );
    lines.push(
      '2. Evaluá spreads netos aplicando la regla de oro institucional: >= 0.50% tras comisiones y slippage.',
    );
    lines.push(
      '3. Protegé las cuentas bancarias: sugerí rotación si una cuenta está cerca de su límite diario o saturada.',
    );

    return {
      contextText: lines.join('\n'),
      hasLiveRates,
    };
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
            provenance: response.provenance,
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
        // Standalone web / mobile (Capacitor) mode with Google Gemini API
        const apiKey = this.storage.get<string>('p2p.gemini.apiKey') || this.apiKeyInput().trim();
        if (apiKey) {
          try {
            const historyContents = this.messages()
              .slice(-10)
              .map((m) => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }],
              }));

            const { contextText, hasLiveRates } = this.buildLiveMarketContextForCopilot();

            const systemInstruction = {
              parts: [
                {
                  text:
                    'Sos el Copiloto Senior y Estratega de Arbitraje P2P Institucional y Tesorería en Venezuela. Respondés en español rioplatense natural (voseo: fijate, mirá, tené en cuenta), de forma fluida, cálida, concisa y ejecutiva (1 o 2 párrafos breves o viñetas cortas, cero relleno ni introducciones ceremoniales, y sin forzar títulos o estructuras rígidas a menos que te pidan un reporte formal). Evaluás brechas cambiarias BCV vs paralelo, spreads netos aplicando la regla de oro (>= 0.50%), prevención de estafas/triangulaciones y rotación segura de cuentas bancarias basándote en los datos reales medidos abajo.\n\n' +
                    contextText,
                },
              ],
            };

            const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
            let replyText = '';
            // Measured, not assumed. Previously this block hardcoded
            // apiCallsCount: 1 / maxSteps: 1 and signed locally generated text
            // as if Gemini had produced it.
            let callsMade = 0;
            let answeredByModel: string | null = null;

            for (const model of models) {
              callsMade++;
              try {
                const res = await fetch(
                  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'x-goog-api-key': apiKey,
                    },
                    body: JSON.stringify({
                      system_instruction: systemInstruction,
                      contents: historyContents,
                      generationConfig: {
                        temperature: 0.4,
                        maxOutputTokens: 1000,
                      },
                    }),
                  },
                );

                if (res.ok) {
                  const data = (await res.json()) as {
                    candidates?: { content?: { parts?: { text?: string }[] } }[];
                  };
                  replyText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
                  if (replyText) {
                    answeredByModel = model;
                    break;
                  }
                }
              } catch {
                // Try fallback model
              }
            }

            const answeredByGemini = answeredByModel !== null;
            if (!replyText) {
              replyText =
                'No se pudo obtener respuesta de la API de Google Gemini. Verificá que tu API Key sea válida y tenga cuota disponible.';
            }

            this.messages.update((msgs) => [
              ...msgs,
              {
                role: 'assistant',
                content: replyText,
                timestamp: Date.now(),
                provenance: {
                  // Only claim Gemini when Gemini actually answered.
                  source: answeredByGemini ? 'gemini' : 'simulated',
                  ...(answeredByModel ? { model: answeredByModel } : {}),
                  provenanceId: `web-${Date.now()}`,
                  timestamp: Date.now(),
                  esSimulado: !hasLiveRates,
                  liveMarketFeedConnected: hasLiveRates,
                  marketFeedReason: hasLiveRates ? 'LIVE' : 'NO_BOOK',
                  marketFeedNote: hasLiveRates
                    ? '[feed en vivo: tasas de radar y snapshot de tesorería inyectados]'
                    : '[sin feed: tasas de radar sin sincronizar]',
                  ...(answeredByGemini ? {} : { fallbackReason: 'GEMINI_UNAVAILABLE' }),
                  stepsCount: callsMade,
                  maxSteps: models.length,
                  apiCallsCount: callsMade,
                },
              },
            ]);
            this.scrollToBottom();

            if (this.voiceService.ttsEnabled()) {
              this.voiceService.speak(replyText);
            }
          } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.messages.update((msgs) => [
              ...msgs,
              {
                role: 'assistant',
                content: `Error al consultar Gemini API: ${errorMsg}. Podés verificar tu clave en la pestaña "Conexión Gemini".`,
                timestamp: Date.now(),
                provenance: {
                  // An error message is not a model answer. Reporting it as Gemini
                  // output with esSimulado: false showed a live badge on a failure.
                  source: 'simulated',
                  provenanceId: `web-error-${Date.now()}`,
                  timestamp: Date.now(),
                  fallbackReason: 'GEMINI_REQUEST_FAILED',
                  esSimulado: true,
                  liveMarketFeedConnected: false,
                  marketFeedReason: 'NO_BOOK',
                },
              },
            ]);
            this.scrollToBottom();
          }
        } else {
          // No API key provided: inform the user
          const noKeyText =
            'Para chatear con el Copiloto IA en tu teléfono, ingresá tu API Key gratuita de Google Gemini en la pestaña "⚙ Conexión Gemini" o en el panel de APIs del menú superior.';
          this.messages.update((msgs) => [
            ...msgs,
            {
              role: 'assistant',
              content: noKeyText,
              timestamp: Date.now(),
              provenance: {
                source: 'simulated',
                provenanceId: `web-sim-${Date.now()}`,
                timestamp: Date.now(),
                esSimulado: true,
              },
            },
          ]);
          this.scrollToBottom();
        }
      }
    } catch (err: unknown) {
      const isKillswitch = err instanceof Error && err.message.includes('KILLSWITCH_ACTIVE');
      this.messages.update((msgs) => [
        ...msgs,
        {
          role: 'assistant',
          content: isKillswitch
            ? '🚨 KILL-SWITCH ACTIVO: La mesa de operaciones ha bloqueado preventivamente toda respuesta y ejecución del Copiloto IA.'
            : `Hubo un error al consultar el servicio de orquestación: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
          provenance: {
            source: 'deterministic',
            provenanceId: `error-${Date.now()}`,
            timestamp: Date.now(),
            fallbackReason: isKillswitch ? 'KILLSWITCH_ACTIVE' : 'ERROR',
            // An emergency stop is never real data. Claiming esSimulado: false
            // here rendered a green live badge on a kill-switch block.
            esSimulado: true,
            liveMarketFeedConnected: false,
            marketFeedReason: 'NO_BOOK',
          },
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
      const isKillswitch = this.treasuryMetrics().killSwitchActive;
      const treasury = this.accountsService.buildTreasurySnapshot();
      if (isKillswitch) {
        this.actionSuccessNotice.set('⛔ Ejecución bloqueada: Kill-Switch activo.');
        setTimeout(() => this.actionSuccessNotice.set(null), 4000);
        return;
      }
      if (treasury && (treasury.overLimitCount > 0 || treasury.disabledCount > 0)) {
        this.actionSuccessNotice.set('⛔ Ejecución bloqueada: Cuentas sobre límite o deshabilitadas.');
        setTimeout(() => this.actionSuccessNotice.set(null), 4000);
        return;
      }
      plan.status = 'APPROVED';
      this.actionSuccessNotice.set(`¡Estrategia ${plan.id} APROBADA y enviada a la mesa!`);
      setTimeout(() => this.actionSuccessNotice.set(null), 4000);
    }
    // Launch Quick Action Drawer and auto-copy ticket
    this.openActionLauncher(plan);
    this.copyTicketToClipboard(plan);
  }

  quickPrompt(type: string): void {
    this.closeMobileSheet();
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      this.sidebarCollapsed.set(true);
    }
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
