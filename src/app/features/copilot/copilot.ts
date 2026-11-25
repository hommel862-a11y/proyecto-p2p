import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import type {
  CopilotContextScope,
  CopilotStreamEvent,
  CopilotThreadDto,
  CopilotUsageSummaryDto,
  StrategyPlanCard,
} from '../../../../electron/shared/types';
import { AccountsService, type TreasurySnapshot } from '../../core/accounts.service';
import { AgentStudioService } from '../../core/agent-studio.service';
import { SpotMarketService } from '../../core/spot-market.service';
import { TriangulationIntelligenceService } from '../../core/triangulation-intelligence.service';
import { VoiceSpeechService, normalizeVoicePrompt } from '../../core/voice-speech.service';
import {
  AI_MODELS_BY_PROVIDER,
  ApiSettingsModalComponent,
} from '../../shared/components/api-settings-modal.component';
import { CopilotGovernanceDashboardComponent } from './components/governance-dashboard.component';
import { CopilotHitlInspectorComponent } from './components/hitl-inspector.component';
import type {
  AgentHealthStatusDto,
  AlphaWatcherStatusDto,
  ChatMessageView,
  CopilotSlashCommand,
  CopilotViewMode,
  ElectronCopilotBridge,
  EngramObservationDto,
  RadarAlertItem,
} from './models/copilot.models';

@Component({
  selector: 'app-copilot',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CopilotHitlInspectorComponent,
    CopilotGovernanceDashboardComponent,
    ApiSettingsModalComponent,
  ],
  templateUrl: './copilot.html',
  styleUrl: './copilot.scss',
})
export class Copilot implements OnInit, OnDestroy {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly voiceService = inject(VoiceSpeechService);
  readonly accountsService = inject(AccountsService);
  readonly triangulationService = inject(TriangulationIntelligenceService);
  readonly spotMarketService = inject(SpotMarketService);
  readonly agentStudioService = inject(AgentStudioService);

  @ViewChild('chatScrollContainer') chatScrollContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('chatInputField') chatInputField?: ElementRef<HTMLInputElement>;

  // Primary 2-mode navigation: Tactical Workbench vs AI Governance Dashboard
  readonly activeView = signal<CopilotViewMode>('workbench');
  readonly sidebarCollapsed = signal<boolean>(false);
  readonly showApiSettingsModal = signal<boolean>(false);

  // Persistent threads & chat messages
  readonly threads = signal<CopilotThreadDto[]>([]);
  readonly activeThreadId = signal<string | null>(null);
  readonly messages = signal<ChatMessageView[]>([]);
  readonly userInput = signal<string>('');
  readonly isTyping = signal<boolean>(false);
  readonly activeRequestId = signal<string | null>(null);
  readonly streamStatus = signal<CopilotStreamEvent | null>(null);
  readonly expandedTraces = signal<Record<string, boolean>>({});
  readonly webSessionApiKey = signal<string>('');

  // Grounding scope & agent selection
  readonly contextScope = signal<CopilotContextScope>({
    orderbook: true,
    treasury: true,
    orders: true,
    finance360: true,
  });
  readonly selectedAgentId = signal<string | null>(null);
  readonly registeredAgents = signal<
    { id: string; name: string; role: string; enabled: boolean }[]
  >([]);

  // Provider / Model status (populated from Electron DPAPI config, never localStorage)
  readonly activeProvider = signal<string>('gemini');
  readonly activeModel = signal<string>('gemini-3.8-flash');
  readonly isConnected = signal<boolean>(false);
  readonly isElectron = computed(() => Boolean(this.getElectronCopilot()));

  // Real-time operational state (Zero-Seed: empty until real backend responds)
  readonly plans = signal<StrategyPlanCard[]>([]);
  readonly selectedPlan = signal<StrategyPlanCard | null>(null);
  readonly executingPlan = signal<boolean>(false);
  readonly executionError = signal<string | null>(null);
  readonly showActionLauncher = signal<boolean>(false);
  readonly launchedPlan = signal<StrategyPlanCard | null>(null);
  readonly actionSuccessNotice = signal<string | null>(null);
  readonly engramObservations = signal<EngramObservationDto[]>([]);
  readonly swarmHealth = signal<AgentHealthStatusDto[]>([]);
  readonly usageSummary = signal<CopilotUsageSummaryDto | null>(null);
  readonly radarAlerts = signal<RadarAlertItem[]>([]);
  readonly watcherStatus = signal<AlphaWatcherStatusDto>({
    enabled: false,
    pollIntervalSeconds: 30,
    minNetSpreadPct: 0.7,
    scanCount: 0,
    lastOpportunity: null,
  });

  // Killswitch & Treasury snapshot (real store only)
  readonly killSwitchArmed = signal<boolean>(false);
  readonly killSwitchHoldProgress = signal<number>(0);
  private killSwitchTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: (() => void)[] = [];

  // Voice & TTS
  readonly isVoiceRecording = signal<boolean>(false);
  readonly isTranscribing = signal<boolean>(false);
  readonly voiceError = signal<string | null>(null);

  // Slash command palette
  readonly showSlashPopup = signal<boolean>(false);
  readonly slashCommands: CopilotSlashCommand[] = [
    {
      command: '/spread',
      label: 'Auditar Spread Neto',
      description: 'Calcula margen neto real contra libro Binance P2P y Regla de Oro (>=0.50%).',
      template: '/spread Analiza el spread neto actual en Binance P2P para 1000 USDT por Banesco.',
    },
    {
      command: '/riesgo',
      label: 'Evaluar Cupos & Riesgo',
      description: 'Verifica impacto de orden en límites diarios VES y saturación SUDEBAN.',
      template: '/riesgo Evalúa la saturación bancaria VES actual y qué cuenta conviene usar.',
    },
    {
      command: '/bcv',
      label: 'Brecha BCV vs Paralelo',
      description: 'Consulta brecha cambiaria y ventana de intervención BCV.',
      template: '/bcv ¿Cuál es la brecha cambiaria BCV vs paralelo y el riesgo de intervención?',
    },
    {
      command: '/tesoreria',
      label: 'Resumen Tesorería & Earn',
      description: 'Revisa liquidez disponible, bóvedas Finance 360 y rendimiento ocioso.',
      template: '/tesoreria Resume el saldo disponible en tesorería y sugiere asignación óptima.',
    },
  ];

  readonly filteredSlashCommands = computed(() => {
    const val = this.userInput().trim().toLowerCase();
    if (!val.startsWith('/')) return [];
    return this.slashCommands.filter((c) => c.command.startsWith(val));
  });

  // Real Market & Treasury Telemetry (Zero-Seed)
  readonly liveParallelRate = computed<number | null>(() => {
    const snap = this.triangulationService.liveRates();
    const parallel =
      snap.parallelAvg?.status === 'live'
        ? snap.parallelAvg.value
        : snap.binanceVesSell?.status === 'live'
          ? snap.binanceVesSell.value
          : null;
    return typeof parallel === 'number' && Number.isFinite(parallel) && parallel > 0
      ? parallel
      : null;
  });

  readonly liveBcvRate = computed<number | null>(() => {
    const bcv = this.triangulationService.liveRates().bcvUsd;
    const r = bcv?.status === 'live' ? bcv.value : null;
    return typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : null;
  });

  readonly liveBcvGapPct = computed<number | null>(() => {
    const p = this.liveParallelRate();
    const b = this.liveBcvRate();
    if (p === null || b === null) return null;
    return ((p - b) / b) * 100;
  });

  readonly treasurySnapshot = computed<TreasurySnapshot>(() =>
    this.accountsService.buildTreasurySnapshot(),
  );

  readonly sudebanCapPct = computed<number | null>(() => {
    const snap = this.treasurySnapshot();
    if (!snap || snap.totalDailyLimitVes <= 0) return null;
    return Math.min(100, Math.max(0, (snap.totalSpentTodayVes / snap.totalDailyLimitVes) * 100));
  });

  readonly treasuryMetrics = computed(() => ({
    killSwitchActive: this.killSwitchArmed(),
    totalBalanceVes: this.treasurySnapshot().totalBalanceVes,
    totalDailyLimitVes: this.treasurySnapshot().totalDailyLimitVes,
    sudebanCapPct: this.sudebanCapPct(),
  }));

  readonly availableModelOptions = computed(() => {
    return AI_MODELS_BY_PROVIDER[this.activeProvider()] ?? AI_MODELS_BY_PROVIDER['gemini'];
  });

  ngOnInit(): void {
    this.scrubLegacyPlaintextKeys();
    this.bindIpcPushListeners();
    this.applyIncomingAgentQueryParams();
    void this.loadInitialState();

    this.refreshTimer = setInterval(() => {
      void this.refreshOperationalData();
    }, 15_000);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.killSwitchTimer) clearInterval(this.killSwitchTimer);
    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch {
        // Ignore unsubscribe error on teardown
      }
    }
    this.unsubscribers = [];
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardShortcuts(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      this.setView(this.activeView() === 'workbench' ? 'dashboard' : 'workbench');
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (this.activeView() !== 'workbench') this.setView('workbench');
      this.userInput.set('/');
      this.showSlashPopup.set(true);
      setTimeout(() => this.chatInputField?.nativeElement?.focus(), 0);
    } else if (event.key === 'Escape' && this.isTyping()) {
      event.preventDefault();
      void this.cancelCurrentTurn();
    }
  }

  setView(mode: CopilotViewMode): void {
    this.activeView.set(mode);
    if (mode === 'dashboard') {
      void this.refreshOperationalData();
    }
  }

  toggleSidebar(): void {
    this.sidebarCollapsed.update((v) => !v);
  }

  openAiSettingsModal(): void {
    this.showApiSettingsModal.set(true);
  }

  closeAiSettingsModal(): void {
    this.showApiSettingsModal.set(false);
    void this.syncProviderConfig();
  }

  navigateTo(path: string): void {
    void this.router.navigateByUrl(path);
  }

  private applyIncomingAgentQueryParams(): void {
    const qp = this.route.snapshot?.queryParamMap;
    if (!qp) return;
    const agentId = qp.get('agentId')?.trim();
    const mention = qp.get('mention')?.trim();
    if (agentId) {
      this.selectedAgentId.set(agentId);
      this.activeView.set('workbench');
    }
    if (mention && !this.userInput().trim()) {
      this.userInput.set(`${mention} `);
      setTimeout(() => this.chatInputField?.nativeElement?.focus(), 80);
    }
  }

  toggleContextScope(key: keyof CopilotContextScope): void {
    this.contextScope.update((curr) => ({ ...curr, [key]: !curr[key] }));
  }

  onInputChange(val: string): void {
    this.userInput.set(val);
    this.showSlashPopup.set(val.trim().startsWith('/') && this.filteredSlashCommands().length > 0);
  }

  applySlashCommand(cmd: CopilotSlashCommand): void {
    this.userInput.set(cmd.template);
    this.showSlashPopup.set(false);
    this.chatInputField?.nativeElement?.focus();
  }

  quickPrompt(
    key: 'explicar_triangulacion' | 'resumen_ejecutivo' | 'riesgo_bcv' | 'tesoreria',
  ): void {
    const prompts: Record<typeof key, string> = {
      explicar_triangulacion:
        'Explícame paso a paso la ruta de arbitraje P2P más viable hoy con spread neto, comisiones y cupos VES.',
      resumen_ejecutivo:
        'Genera un resumen ejecutivo de la sesión actual: feed en vivo, tesorería disponible y planes propuestos.',
      riesgo_bcv:
        '¿Cuál es el riesgo actual de intervención del BCV y cómo afecta la brecha cambiaria?',
      tesoreria:
        'Analiza el saldo disponible en tesorería VES/USDT y sugiere si conviene operar o esperar.',
    };
    void this.sendPrompt(prompts[key]);
  }

  async newThread(): Promise<void> {
    const bridge = this.getElectronCopilot();
    if (bridge?.createThread) {
      const created = await bridge.createThread({ title: 'Nueva conversación táctica' });
      this.threads.update((list) => [created, ...list]);
      this.activeThreadId.set(created.id);
    } else {
      this.activeThreadId.set(null);
    }
    this.messages.set([]);
    this.selectedPlan.set(null);
    this.executionError.set(null);
  }

  async selectThread(threadId: string): Promise<void> {
    this.activeThreadId.set(threadId);
    const bridge = this.getElectronCopilot();
    if (!bridge?.getThreadMessages) return;
    try {
      const rows = await bridge.getThreadMessages({ threadId, limit: 50 });
      this.messages.set(
        rows.map((r) => ({
          id: r.id,
          role: r.role,
          content: r.content,
          timestamp: r.createdAt,
          provenance: r.provenance ?? undefined,
          toolTraces: r.toolTraces ?? undefined,
        })),
      );
      this.scrollToBottom();
    } catch {
      this.messages.set([]);
    }
  }

  async deleteThread(threadId: string, event?: Event): Promise<void> {
    event?.stopPropagation();
    const bridge = this.getElectronCopilot();
    if (bridge?.deleteThread) {
      await bridge.deleteThread({ threadId });
    }
    this.threads.update((list) => list.filter((t) => t.id !== threadId));
    if (this.activeThreadId() === threadId) {
      this.activeThreadId.set(null);
      this.messages.set([]);
    }
  }

  async sendPrompt(overridePrompt?: string): Promise<void> {
    const text = (overridePrompt ?? this.userInput()).trim();
    if (!text || this.isTyping()) return;

    if (!overridePrompt) {
      this.userInput.set('');
    }
    this.showSlashPopup.set(false);
    this.executionError.set(null);

    const requestId = `REQ-${Date.now().toString(36).toUpperCase()}`;
    this.activeRequestId.set(requestId);
    this.isTyping.set(true);
    this.streamStatus.set({
      requestId,
      phase: 'started',
      message: 'Enviando consulta al orquestador...',
      timestamp: Date.now(),
    });

    const userMsg: ChatMessageView = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    this.messages.update((m) => [...m, userMsg]);
    this.scrollToBottom();

    try {
      const bridge = this.getElectronCopilot();
      if (bridge?.sendMessage) {
        const threadId = this.activeThreadId() ?? 'new';
        const res = await bridge.sendMessage({
          prompt: text,
          history: this.messages().slice(-16),
          threadId,
          agentId: this.selectedAgentId() ?? undefined,
          contextScope: this.contextScope(),
          requestId,
        });

        if (res.threadId && res.threadId !== this.activeThreadId()) {
          this.activeThreadId.set(res.threadId);
          void this.refreshThreads();
        }

        const assistantMsg: ChatMessageView = {
          role: 'assistant',
          content: res.reply,
          timestamp: Date.now(),
          plan: res.suggestedPlan,
          provenance: res.provenance,
          sources: res.sources,
          toolTraces: res.toolTraces,
          usage: res.usage,
          requestId: res.requestId,
          cancelled: res.cancelled,
        };
        this.messages.update((m) => [...m, assistantMsg]);

        if (res.suggestedPlan) {
          this.selectedPlan.set(res.suggestedPlan);
          this.plans.update((list) => [
            res.suggestedPlan!,
            ...list.filter((p) => p.id !== res.suggestedPlan!.id),
          ]);
        }
        void this.refreshUsageSummary();
      } else {
        // Pure browser mode without Electron IPC: honest single-turn Gemini or offline notice
        const key = this.webSessionApiKey().trim();
        if (!key) {
          this.messages.update((m) => [
            ...m,
            {
              role: 'assistant',
              content:
                'Modo web sin puente Electron IPC ni clave de sesión configurada. Abre el cliente de escritorio para usar herramientas MCP, SQLite y bóveda DPAPI, o configura una clave temporal de sesión.',
              timestamp: Date.now(),
            },
          ]);
        } else {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.activeModel())}:generateContent`;
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text }] }],
            }),
            signal: AbortSignal.timeout(30_000),
          });
          const data = (await resp.json()) as {
            candidates?: { content?: { parts?: { text?: string }[] } }[];
            error?: { message?: string };
          };
          const replyText =
            data.candidates?.[0]?.content?.parts?.[0]?.text ||
            data.error?.message ||
            `HTTP ${resp.status}`;
          this.messages.update((m) => [
            ...m,
            { role: 'assistant', content: replyText, timestamp: Date.now() },
          ]);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.messages.update((m) => [
        ...m,
        {
          role: 'assistant',
          content: `Error al procesar la consulta: ${msg}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      this.isTyping.set(false);
      this.activeRequestId.set(null);
      this.streamStatus.set(null);
      this.scrollToBottom();
    }
  }

  async cancelCurrentTurn(): Promise<void> {
    const reqId = this.activeRequestId();
    const bridge = this.getElectronCopilot();
    if (bridge?.cancelTurn && reqId) {
      await bridge.cancelTurn({ requestId: reqId });
    }
    this.isTyping.set(false);
    this.streamStatus.set(null);
  }

  async executePlan(plan: StrategyPlanCard): Promise<void> {
    this.executionError.set(null);
    this.executingPlan.set(true);
    try {
      const bridge = this.getElectronCopilot();
      if (!bridge?.executePlan) {
        this.executionError.set(
          'Ejecución bloqueada: requiere puente Electron IPC y Gatekeeper activo.',
        );
        return;
      }

      const res = await bridge.executePlan({ planId: plan.id });
      if (!res?.success) {
        // CRITICAL: Never copy ticket or open modal on backend rejection.
        this.executionError.set(res?.error || 'Ejecución rechazada por el Risk Gatekeeper.');
        return;
      }

      const updated: StrategyPlanCard = { ...plan, status: 'APPROVED' };
      this.selectedPlan.set(updated);
      this.plans.update((list) => list.map((p) => (p.id === plan.id ? updated : p)));
      this.launchedPlan.set(updated);
      this.showActionLauncher.set(true);
      this.actionSuccessNotice.set(`Plan ${plan.id} aprobado por Gatekeeper y listo para operar.`);

      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(
            `TICKET ${plan.id} | ${plan.route} | ${plan.capitalRequiredUsdt} USDT | Spread +${plan.expectedNetSpreadPct}%`,
          );
        }
      } catch {
        // Ignore clipboard errors in restricted environments
      }
    } finally {
      this.executingPlan.set(false);
    }
  }

  async rejectPlan(plan: StrategyPlanCard): Promise<void> {
    const bridge = this.getElectronCopilot();
    if (bridge?.rejectPlan) {
      await bridge.rejectPlan({ planId: plan.id, reason: 'Rechazado por operador HITL' });
    }
    const updated: StrategyPlanCard = { ...plan, status: 'REJECTED' };
    this.plans.update((list) => list.map((p) => (p.id === plan.id ? updated : p)));
    if (this.selectedPlan()?.id === plan.id) {
      this.selectedPlan.set(updated);
    }
  }

  async reviewEngramObservation(ev: { id: number; action: 'approve' | 'discard' }): Promise<void> {
    const bridge = this.getElectronCopilot();
    if (bridge?.reviewEngramObservation) {
      await bridge.reviewEngramObservation(ev);
    }
    if (ev.action === 'approve') {
      this.engramObservations.update((list) =>
        list.map((o) => (o.id === ev.id ? { ...o, status: 'active' } : o)),
      );
    } else {
      this.engramObservations.update((list) => list.filter((o) => o.id !== ev.id));
    }
  }

  async toggleWatcher(): Promise<void> {
    const bridge = this.getElectronCopilot();
    const next = !this.watcherStatus().enabled;
    if (bridge?.setWatcherConfig) {
      await bridge.setWatcherConfig({ enabled: next });
    }
    this.watcherStatus.update((s) => ({ ...s, enabled: next }));
  }

  async triggerKillSwitch(): Promise<void> {
    if (this.killSwitchArmed()) {
      this.actionSuccessNotice.set(
        'KILL-SWITCH YA ACTIVO: Las operaciones automáticas permanecen detenidas.',
      );
      return;
    }
    const win = window as unknown as {
      electron?: { killswitch?: { trigger?: (p: { reason: string; source: string }) => Promise<boolean> } };
    };
    if (win.electron?.killswitch?.trigger) {
      await win.electron.killswitch.trigger({
        reason: 'Activado manualmente desde Copiloto Táctico',
        source: 'COPILOT_UI',
      });
    }
    this.killSwitchArmed.set(true);
    this.actionSuccessNotice.set(
      'KILL-SWITCH ACTIVADO: Todas las ejecuciones del Copiloto han sido bloqueadas.',
    );
  }

  startKillSwitchHold(): void {
    this.killSwitchHoldProgress.set(0);
    if (this.killSwitchTimer) clearInterval(this.killSwitchTimer);
    this.killSwitchTimer = setInterval(() => {
      const next = this.killSwitchHoldProgress() + 20;
      this.killSwitchHoldProgress.set(next);
      if (next >= 100) {
        this.cancelKillSwitchHold();
        void this.triggerKillSwitch();
      }
    }, 150);
  }

  cancelKillSwitchHold(): void {
    if (this.killSwitchTimer) {
      clearInterval(this.killSwitchTimer);
      this.killSwitchTimer = null;
    }
    this.killSwitchHoldProgress.set(0);
  }

  async toggleVoiceDictation(): Promise<void> {
    this.voiceError.set(null);
    if (this.voiceService.isListening()) {
      this.voiceService.stopListening();
      this.isVoiceRecording.set(false);
      return;
    }
    this.isVoiceRecording.set(true);
    const started = await this.voiceService.startMediaRecording(({ base64, mimeType }) => {
      void this.handleRecordedAudio(base64, mimeType);
    });
    if (!started) {
      this.isVoiceRecording.set(false);
      this.voiceError.set('No se pudo acceder al micrófono.');
    }
  }

  private async handleRecordedAudio(audioBase64: string, mimeType: string): Promise<void> {
    this.isVoiceRecording.set(false);
    const bridge = this.getElectronCopilot();
    if (!bridge?.transcribeAudio) return;
    this.isTranscribing.set(true);
    try {
      const res = await bridge.transcribeAudio({ audioBase64, mimeType });
      if (res.text) {
        this.userInput.set(normalizeVoicePrompt(res.text));
      } else if (res.error) {
        this.voiceError.set(res.error);
      }
    } finally {
      this.isTranscribing.set(false);
    }
  }

  analyzeRadarAlert(alert: RadarAlertItem): void {
    if (alert.plan) {
      this.selectedPlan.set(alert.plan);
    }
    void this.sendPrompt(`Analiza esta alerta en vivo: ${alert.title} — ${alert.message}`);
  }

  toggleTraceExpanded(key: string): void {
    this.expandedTraces.update((curr) => ({ ...curr, [key]: !curr[key] }));
  }

  renderMarkdown(raw: string): SafeHtml {
    const escaped = (raw || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const formatted = escaped
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br />');
    return this.sanitizer.bypassSecurityTrustHtml(formatted);
  }

  private scrubLegacyPlaintextKeys(): void {
    try {
      localStorage.removeItem('p2p.gemini.apiKey');
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('p2p.ai.key.')) {
          toRemove.push(k);
        }
      }
      for (const k of toRemove) {
        localStorage.removeItem(k);
      }
    } catch {
      // Ignore storage access errors in headless tests
    }
  }

  private bindIpcPushListeners(): void {
    const bridge = this.getElectronCopilot();
    if (!bridge) return;

    if (bridge.onAlphaOpportunity) {
      this.unsubscribers.push(
        bridge.onAlphaOpportunity((data) => {
          this.radarAlerts.update((list) => [
            {
              id: `ALPHA-${Date.now().toString(36)}`,
              kind: 'ALPHA',
              title: `Spread +${data.plan.expectedNetSpreadPct.toFixed(2)}% detectado`,
              message: data.plan.route,
              timestamp: data.detectedAt || Date.now(),
              plan: data.plan,
            },
            ...list.slice(0, 9),
          ]);
        }),
      );
    }

    if (bridge.onProactiveAlert) {
      this.unsubscribers.push(
        bridge.onProactiveAlert((payload: any) => {
          if (!payload) return;
          this.radarAlerts.update((list) => [
            {
              id: payload.id || `MACRO-${Date.now().toString(36)}`,
              kind: 'MACRO',
              title: String(payload.title || 'Alerta Proactiva'),
              message: String(payload.message || ''),
              timestamp: Number(payload.timestamp || Date.now()),
            },
            ...list.slice(0, 9),
          ]);
        }),
      );
    }

    if (bridge.onStreamEvent) {
      this.unsubscribers.push(
        bridge.onStreamEvent((ev) => {
          if (ev.requestId === this.activeRequestId()) {
            this.streamStatus.set(ev);
          }
        }),
      );
    }
  }

  private async loadInitialState(): Promise<void> {
    await this.syncProviderConfig();
    await this.refreshThreads();
    await this.refreshOperationalData();
  }

  private async syncProviderConfig(): Promise<void> {
    const bridge = this.getElectronCopilot();
    if (!bridge?.getProviderConfig) return;
    try {
      const cfg = await bridge.getProviderConfig();
      if (cfg) {
        this.activeProvider.set(cfg.activeProvider || 'gemini');
        this.activeModel.set(cfg.activeModel || 'gemini-3.8-flash');
        this.isConnected.set(Boolean(cfg.configuredProviders?.[cfg.activeProvider]));
      }
    } catch {
      // Ignore IPC config lookup error
    }
  }

  private async refreshThreads(): Promise<void> {
    const bridge = this.getElectronCopilot();
    if (!bridge?.listThreads) return;
    try {
      const list = await bridge.listThreads({ limit: 25 });
      this.threads.set(Array.isArray(list) ? list : []);
    } catch {
      this.threads.set([]);
    }
  }

  private async refreshUsageSummary(): Promise<void> {
    const bridge = this.getElectronCopilot();
    if (!bridge?.getUsageSummary) return;
    try {
      this.usageSummary.set(await bridge.getUsageSummary({ windowHours: 24 }));
    } catch {
      // Ignore missing ledger
    }
  }

  private async refreshOperationalData(): Promise<void> {
    const bridge = this.getElectronCopilot();
    if (!bridge) return;

    try {
      const [plans, engram, watcher, swarm, agents, usage] = await Promise.all([
        bridge.getPlans?.({ limit: 30 }) ?? Promise.resolve([]),
        bridge.getEngramObservations?.({ limit: 40 }) ?? Promise.resolve([]),
        bridge.getWatcherStatus?.() ?? Promise.resolve(this.watcherStatus()),
        bridge.getSwarmHealth?.() ?? Promise.resolve([]),
        bridge.listAgents?.() ?? Promise.resolve([]),
        bridge.getUsageSummary?.({ windowHours: 24 }) ?? Promise.resolve(null),
      ]);

      this.plans.set(Array.isArray(plans) ? plans : []);
      this.engramObservations.set(Array.isArray(engram) ? engram : []);
      this.watcherStatus.set(watcher);
      this.swarmHealth.set(Array.isArray(swarm) ? swarm : []);
      this.registeredAgents.set(Array.isArray(agents) ? agents : []);
      if (usage) this.usageSummary.set(usage);

      // Sync real Killswitch state
      const win = window as unknown as {
        electron?: { killswitch?: { getStatus?: () => Promise<{ isTriggered: boolean }> } };
      };
      const ks = await win.electron?.killswitch?.getStatus?.();
      if (ks && typeof ks.isTriggered === 'boolean') {
        this.killSwitchArmed.set(ks.isTriggered);
      }

      // Only trigger proactive macro evaluation when real measured rates exist (never fake 64.8/78.4/1.0)
      const pRate = this.liveParallelRate();
      const bRate = this.liveBcvRate();
      const usdcSpot = this.spotMarketService.usdcTicker()?.lastPrice;
      const realSpotUsdt =
        typeof usdcSpot === 'number' && Number.isFinite(usdcSpot) && usdcSpot > 0 && usdcSpot !== 1.0
          ? usdcSpot
          : undefined;
      if ((pRate !== null && bRate !== null) || realSpotUsdt !== undefined) {
        const triggerFn = (bridge as unknown as {
          triggerProactiveEval?: (p: {
            parallelRate?: number;
            bcvRate?: number;
            spotUsdt?: number;
          }) => Promise<unknown>;
        }).triggerProactiveEval;
        await triggerFn?.({
          ...(pRate !== null ? { parallelRate: pRate } : {}),
          ...(bRate !== null ? { bcvRate: bRate } : {}),
          ...(realSpotUsdt !== undefined ? { spotUsdt: realSpotUsdt } : {}),
        });
      }
    } catch {
      // Keep UI responsive on partial IPC failure
    }
  }

  private getElectronCopilot(): ElectronCopilotBridge | null {
    const win = window as unknown as {
      electron?: { copilot?: ElectronCopilotBridge };
      p2p?: { copilot?: ElectronCopilotBridge };
    };
    return win.electron?.copilot ?? win.p2p?.copilot ?? null;
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const el = this.chatScrollContainer?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 30);
  }
}
