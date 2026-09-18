import {
  Component,
  signal,
  OnInit,
  OnDestroy,
  computed,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  type CopilotChatMessage,
  type StrategyPlanCard,
  type CopilotResponse,
  getBcvMarketIntelligence,
  type BcvMarketIntelligence,
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

  sidebarCollapsed = signal<boolean>(false);

  toggleSidebar(): void {
    this.sidebarCollapsed.update((v) => !v);
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
  activeTab = signal<'chat' | 'plans' | 'memory' | 'counterparties' | 'config'>('chat');
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
      this.connectionStatus.set({
        connected: false,
        model: 'simulated',
        message: 'Modo navegador web (simulación local)',
      });
    }
  }

  async saveApiKey(): Promise<void> {
    const key = this.apiKeyInput().trim();
    if (!key) return;

    const copilot = getElectronCopilot();
    if (copilot) {
      await copilot.setApiKey({ apiKey: key });
      this.actionSuccessNotice.set('¡API Key guardada en SQLite exitosamente!');
      setTimeout(() => this.actionSuccessNotice.set(null), 4000);
      await this.checkConnection();
      this.activeTab.set('chat');
    }
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
          this.messages.update((msgs) => [
            ...msgs,
            {
              role: 'assistant',
              content:
                'He analizado la microestructura del mercado P2P. Detecté una oportunidad de arbitraje triangular superior a la regla de oro (0.50% neto). Podés revisar la ficha y darle PLAY cuando quieras despacharla.',
              plan: fallbackPlan,
              timestamp: Date.now(),
            },
          ]);
          this.plans.update((p) => [fallbackPlan, ...p]);
          this.scrollToBottom();
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
    } else if (type === 'riesgo_bcv') {
      this.sendPrompt(
        '¿Cuál es el riesgo actual de intervención del BCV en mesas de cambio, cómo afecta la brecha cambiaria al inventario en bolívares y cuál es la estrategia de salida rápida?',
      );
    } else if (type === 'triangulacion') {
      this.sendPrompt(
        'Analizá oportunidades de arbitraje triangular entre VES, USDT y divisas alternativas.',
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
