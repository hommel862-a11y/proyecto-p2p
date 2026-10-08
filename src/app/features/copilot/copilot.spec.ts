import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Copilot } from './copilot';
import { AccountsService, type TreasurySnapshot } from '../../core/accounts.service';

describe('Copilot', () => {
  let fixture: ComponentFixture<Copilot>;
  let component: Copilot;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Copilot],
    }).compileComponents();

    fixture = TestBed.createComponent(Copilot);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the copilot component', () => {
    expect(component).toBeTruthy();
    expect(component.activeTab()).toBe('chat');
  });

  it('should toggle sidebar correctly', () => {
    expect(component.sidebarCollapsed()).toBe(false);
    component.toggleSidebar();
    expect(component.sidebarCollapsed()).toBe(true);
    component.toggleSidebar();
    expect(component.sidebarCollapsed()).toBe(false);
  });

  it('should manage 3 master areas and artifact sub-tabs cleanly', () => {
    expect(component.masterArea()).toBe('conversacion');
    expect(component.activeTab()).toBe('chat');

    component.setMasterArea('agentes');
    expect(component.masterArea()).toBe('agentes');
    expect(component.activeTab()).toBe('agents');

    component.setMasterArea('artefactos');
    expect(component.masterArea()).toBe('artefactos');
    expect(component.activeTab()).toBe('plans');

    component.setArtifactSubTab('earn');
    expect(component.masterArea()).toBe('artefactos');
    expect(component.activeTab()).toBe('earn');

    component.setMasterArea('conversacion');
    expect(component.masterArea()).toBe('conversacion');
    expect(component.activeTab()).toBe('chat');
  });

  it('should arm the kill-switch pill when no Electron bridge is present', async () => {
    expect(component.treasuryMetrics().killSwitchActive).toBe(false);
    await component.triggerKillSwitch();
    expect(component.treasuryMetrics().killSwitchActive).toBe(true);
    expect(component.actionSuccessNotice()).toContain('KILL-SWITCH ACTIVADO');

    // Arming is one-way: the main process owns the flag and exposes no reset channel, so a
    // second click re-confirms the state instead of pretending to disarm.
    await component.triggerKillSwitch();
    expect(component.treasuryMetrics().killSwitchActive).toBe(true);
    expect(component.actionSuccessNotice()).toContain('KILL-SWITCH YA ACTIVO');
  });

  it('should dispatch quick prompt for explicar_triangulacion', () => {
    const sendPromptSpy = vi
      .spyOn(component, 'sendPrompt')
      .mockImplementation(() => Promise.resolve());
    component.quickPrompt('explicar_triangulacion');
    expect(sendPromptSpy).toHaveBeenCalledWith(
      expect.stringContaining('Explicame en detalle cómo funciona la triangulación financiera'),
    );
  });

  it('should dispatch quick prompt for resumen_ejecutivo', () => {
    const sendPromptSpy = vi
      .spyOn(component, 'sendPrompt')
      .mockImplementation(() => Promise.resolve());
    component.quickPrompt('resumen_ejecutivo');
    expect(sendPromptSpy).toHaveBeenCalledWith(
      expect.stringContaining('Generá un resumen ejecutivo de la sesión actual de trading'),
    );
  });

  it('should dispatch quick prompt for riesgo_bcv', () => {
    const sendPromptSpy = vi
      .spyOn(component, 'sendPrompt')
      .mockImplementation(() => Promise.resolve());
    component.quickPrompt('riesgo_bcv');
    expect(sendPromptSpy).toHaveBeenCalledWith(
      expect.stringContaining('¿Cuál es el riesgo actual de intervención del BCV'),
    );
  });

  it('should toggle voice dictation through voiceService', async () => {
    const startSpy = vi
      .spyOn(component.voiceService, 'startMediaRecording')
      .mockResolvedValue(true);
    const stopSpy = vi.spyOn(component.voiceService, 'stopListening');

    await component.toggleVoiceDictation();
    expect(startSpy).toHaveBeenCalled();

    // Mock listening state
    (component.voiceService.isListening as unknown as { set: (v: boolean) => void }).set(true);
    await component.toggleVoiceDictation();
    expect(stopSpy).toHaveBeenCalled();
  });
});

/**
 * The Treasury HUD must render the real projection built by `AccountsService` and the real
 * kill-switch state owned by the main process. The previous literals (12500 / 88 / 12 / 142.5 /
 * 14) are asserted to be gone so a regression cannot reintroduce them silently.
 */
describe('Copilot treasury HUD (real treasury projection)', () => {
  const buildFakeSnapshot = (): TreasurySnapshot => ({
    accounts: [
      {
        id: 'banesco-pm-1',
        bankName: 'Banesco Pago Móvil',
        bankCode: 'BANESCO',
        rail: 'PAGO_MOVIL',
        status: 'ACTIVE',
        dailyLimitVes: 50000,
        remainingLimitVes: 41000,
        isOverLimit: false,
        isNearLimit: false,
        todayTransactionCount: 2,
        maxDailyTransactions: 15,
        velocityHealth: 'OPTIMAL',
        isAtThreshold: false,
      },
      {
        id: 'mercantil-pm-1',
        bankName: 'Mercantil Pago Móvil',
        bankCode: 'MERCANTIL',
        rail: 'PAGO_MOVIL',
        status: 'ACTIVE',
        dailyLimitVes: 40000,
        remainingLimitVes: 9000,
        isOverLimit: false,
        isNearLimit: true,
        todayTransactionCount: 4,
        maxDailyTransactions: 15,
        velocityHealth: 'WARNING',
        isAtThreshold: false,
      },
      {
        id: 'bdv-pm-1',
        bankName: 'BDV Pago Móvil',
        bankCode: 'BDV',
        rail: 'PAGO_MOVIL',
        status: 'DISABLED',
        dailyLimitVes: 50000,
        remainingLimitVes: 0,
        isOverLimit: true,
        isNearLimit: false,
        todayTransactionCount: 15,
        maxDailyTransactions: 15,
        velocityHealth: 'SATURATED',
        isAtThreshold: true,
      },
    ],
    totalBalanceVes: 240000,
    totalSpentTodayVes: 90000,
    totalReceivedTodayVes: 150000,
    totalDailyLimitVes: 90000,
    nearLimitCount: 2,
    overLimitCount: 1,
    disabledCount: 1,
    saturatedCount: 1,
    rotationRecommendationId: 'banesco-pm-1',
    generatedAt: Date.now(),
  });

  let fixture: ComponentFixture<Copilot>;
  let component: Copilot;
  let snapshot: TreasurySnapshot;
  let announceTreasury: ReturnType<typeof vi.fn>;
  let triggerKillswitch: ReturnType<typeof vi.fn>;
  let getKillswitchStatus: ReturnType<typeof vi.fn>;
  /** Faithful stand-in for `ipc/killswitch-state.ts`: one-way flag, read back through status. */
  let mainKillswitch: {
    isTriggered: boolean;
    timestamp?: number;
    reason?: string;
    source?: string;
  };

  beforeEach(async () => {
    snapshot = buildFakeSnapshot();
    announceTreasury = vi.fn().mockResolvedValue(true);
    mainKillswitch = { isTriggered: false };
    triggerKillswitch = vi.fn().mockImplementation(() => {
      mainKillswitch = {
        isTriggered: true,
        timestamp: 1,
        reason: 'manual-toggle',
        source: 'copilot-ui',
      };
      return Promise.resolve(true);
    });
    getKillswitchStatus = vi.fn().mockImplementation(() => Promise.resolve({ ...mainKillswitch }));

    (window as unknown as { electron?: unknown }).electron = {
      announceTreasury,
      killswitch: { trigger: triggerKillswitch, getStatus: getKillswitchStatus },
    };

    await TestBed.configureTestingModule({
      imports: [Copilot],
      providers: [
        {
          provide: AccountsService,
          useValue: {
            buildTreasurySnapshot: () => snapshot,
            getAccountById: (id: string) => snapshot.accounts.find((a) => a.id === id),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Copilot);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    delete (window as unknown as { electron?: unknown }).electron;
  });

  it('degrades visibly instead of fabricating figures before the first snapshot', () => {
    expect(component.treasuryDataAvailable()).toBe(false);
    const metrics = component.treasuryMetrics();
    expect(Number.isNaN(metrics.cryptoRatioPct)).toBe(true);
    expect(Number.isNaN(metrics.fiatRatioPct)).toBe(true);
    expect(Number.isNaN(metrics.dailyAccumulatedProfitUsdt)).toBe(true);
    expect(Number.isNaN(metrics.avgCycleVelocityMinutes)).toBe(true);
  });

  it('renders the HUD from buildTreasurySnapshot instead of hardcoded literals', () => {
    component.syncTreasurySnapshot();

    expect(component.treasuryDataAvailable()).toBe(true);
    const metrics = component.treasuryMetrics();
    expect(metrics.cryptoRatioPct).toBe(snapshot.nearLimitCount);
    expect(metrics.fiatRatioPct).toBe(snapshot.overLimitCount);
    expect(metrics.dailyAccumulatedProfitUsdt).toBe(snapshot.totalBalanceVes);
    // Real SUDEBAN headroom projection, not the previous 14-minute literal.
    expect(Number.isFinite(metrics.avgCycleVelocityMinutes)).toBe(true);
    expect(metrics.avgCycleVelocityMinutes).toBeGreaterThan(0);

    expect(metrics.cryptoRatioPct).not.toBe(88);
    expect(metrics.fiatRatioPct).not.toBe(12);
    expect(metrics.dailyAccumulatedProfitUsdt).not.toBe(142.5);
    expect(metrics.avgCycleVelocityMinutes).not.toBe(14);
  });

  it('degrades the cycle projection when no transaction headroom is left', () => {
    const saturated: TreasurySnapshot = {
      ...snapshot,
      accounts: snapshot.accounts.map((a) => ({
        ...a,
        todayTransactionCount: a.maxDailyTransactions,
      })),
    };
    vi.spyOn(TestBed.inject(AccountsService), 'buildTreasurySnapshot').mockReturnValue(saturated);

    component.syncTreasurySnapshot();

    expect(Number.isNaN(component.treasuryMetrics().avgCycleVelocityMinutes)).toBe(true);
  });

  it('announces the real snapshot to the main process', async () => {
    component.syncTreasurySnapshot();
    announceTreasury.mockClear();

    await component.announceTreasuryToMain();

    expect(announceTreasury).toHaveBeenCalledTimes(1);
    expect(announceTreasury).toHaveBeenCalledWith(snapshot);
  });

  it('never breaks the flow when the announce channel rejects the payload', async () => {
    announceTreasury.mockRejectedValueOnce(new Error('not allow-listed'));
    component.syncTreasurySnapshot();

    await expect(component.announceTreasuryToMain()).resolves.toBeUndefined();
    expect(component.treasuryDataAvailable()).toBe(true);
  });

  it('mirrors the kill-switch state owned by the main process', async () => {
    mainKillswitch = {
      isTriggered: true,
      timestamp: 1234,
      reason: 'VETOED',
      source: 'risk-gatekeeper',
    };

    await component.syncKillswitchFromMain();

    expect(component.killswitchActive()).toBe(true);
    expect(component.treasuryMetrics().killSwitchActive).toBe(true);
  });

  it('arms the kill-switch through the real IPC channel and cannot fake a disarm', async () => {
    await component.triggerKillSwitch();

    expect(triggerKillswitch).toHaveBeenCalledWith({
      reason: 'manual-toggle',
      source: 'copilot-ui',
    });
    expect(component.treasuryMetrics().killSwitchActive).toBe(true);
    expect(component.actionSuccessNotice()).toContain('KILL-SWITCH ACTIVADO');

    await component.triggerKillSwitch();

    // No second trigger: main owns the flag and exposes no reset channel.
    expect(triggerKillswitch).toHaveBeenCalledTimes(1);
    expect(component.treasuryMetrics().killSwitchActive).toBe(true);
    expect(component.actionSuccessNotice()).toContain('KILL-SWITCH YA ACTIVO');
  });

  it('re-announces the snapshot right before the swarm audit runs', async () => {
    const runSwarmAnalysis = vi.fn().mockResolvedValue({
      riskVerdict: { status: 'APPROVED', riskScore: 10, recommendedAction: 'PROCEED' },
      sentinelSignal: { netSpreadPct: 1.4 },
      executionSummary: 'ok',
    });
    (window as unknown as { electron?: unknown }).electron = {
      announceTreasury,
      killswitch: { trigger: triggerKillswitch, getStatus: getKillswitchStatus },
      copilot: {
        runSwarmAnalysis,
        getPlans: vi.fn().mockResolvedValue([]),
        getLearnings: vi.fn().mockResolvedValue([]),
      },
    };
    component.syncTreasurySnapshot();
    announceTreasury.mockClear();

    await component.triggerSwarmAnalysis();

    expect(announceTreasury).toHaveBeenCalledWith(snapshot);
    expect(announceTreasury.mock.invocationCallOrder[0]).toBeLessThan(
      runSwarmAnalysis.mock.invocationCallOrder[0],
    );
  });

  describe('Mobile workspace & bottom sheet ergonomics', () => {
    it('manages mobile sheet open/close states', () => {
      expect(component.mobileSheetOpen()).toBe(false);

      component.toggleMobileSheet();
      expect(component.mobileSheetOpen()).toBe(true);

      component.closeMobileSheet();
      expect(component.mobileSheetOpen()).toBe(false);

      component.openMobileSheet();
      expect(component.mobileSheetOpen()).toBe(true);
    });

    it('closes mobile sheet and collapses sidebar on mobile when quickPrompt is selected', () => {
      component.openMobileSheet();
      expect(component.mobileSheetOpen()).toBe(true);

      const sendPromptSpy = vi
        .spyOn(component, 'sendPrompt')
        .mockImplementation(() => Promise.resolve());

      component.quickPrompt('explicar_triangulacion');

      expect(component.mobileSheetOpen()).toBe(false);
      expect(sendPromptSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Standalone web / mobile live market context injection', () => {
    it('builds live market and treasury context without inventing rates when unavailable', () => {
      const context = (component as any).buildLiveMarketContextForCopilot();
      expect(context.contextText).toContain('• Tasa Oficial BCV: N/D');
      expect(context.contextText).toContain('• Tasa Paralelo Promedio: N/D');
      expect(context.contextText).toContain('--- ESTADO DE CUENTAS BANCARIAS Y LÍMITES SUDEBAN ---');
      expect(context.hasLiveRates).toBe(false);
    });

    it('injects live rates and reports hasLiveRates: true when market rates are present', () => {
      const triangulationService = (component as any).triangulationService;
      triangulationService.liveRates.set({
        ...triangulationService.liveRates(),
        bcvUsd: { value: 85.15, status: 'live', source: 'bcv', expectedSource: 'Cotizave' },
        parallelAvg: { value: 95.5, status: 'live', source: 'parallel', expectedSource: 'Cotizave' },
        rateGapPct: { value: 12.15, status: 'live', source: 'gap', expectedSource: 'gap' },
        binanceVesBuy: { value: 96.2, status: 'live', source: 'binance', expectedSource: 'binance' },
        binanceVesSell: { value: 94.8, status: 'live', source: 'binance', expectedSource: 'binance' },
      });

      const context = (component as any).buildLiveMarketContextForCopilot();
      expect(context.contextText).toContain('• Tasa Oficial BCV: 85.15 VES/USD');
      expect(context.contextText).toContain('• Tasa Paralelo Promedio: 95.5 VES/USD');
      expect(context.contextText).toContain('• Brecha Cambiaria BCV/Paralelo: 12.15%');
      expect(context.contextText).toContain('• Binance P2P Venta (VES recibido por USDT): 96.2 VES');
      expect(context.contextText).toContain('• Binance P2P Compra (VES pagado por USDT): 94.8 VES');
      expect(context.hasLiveRates).toBe(true);
    });

    it('sends prompt with injected market context and sets provenance to LIVE when rates are active', async () => {
      delete (window as unknown as Record<string, unknown>)['electron'];
      const triangulationService = (component as any).triangulationService;
      triangulationService.liveRates.set({
        ...triangulationService.liveRates(),
        bcvUsd: { value: 85.15, status: 'live', source: 'bcv', expectedSource: 'Cotizave' },
      });

      component.apiKeyInput.set('TEST_GEMINI_KEY');

      let capturedBody: any = null;
      const fakeFetch = vi.fn().mockImplementation((_url: string, opts: any) => {
        capturedBody = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              candidates: [
                {
                  content: {
                    parts: [{ text: 'Análisis institucional completado con tasas reales.' }],
                  },
                },
              ],
            }),
        });
      });
      vi.stubGlobal('fetch', fakeFetch);

      await component.sendPrompt('¿Cómo está el spread hoy?');

      expect(fakeFetch).toHaveBeenCalled();
      expect(capturedBody.system_instruction.parts[0].text).toContain('85.15 VES/USD');

      const lastMsg = component.messages()[component.messages().length - 1];
      expect(lastMsg.role).toBe('assistant');
      expect(lastMsg.content).toBe('Análisis institucional completado con tasas reales.');
      expect(lastMsg.provenance?.liveMarketFeedConnected).toBe(true);
      expect(lastMsg.provenance?.esSimulado).toBe(false);
      expect(lastMsg.provenance?.marketFeedReason).toBe('LIVE');

      vi.unstubAllGlobals();
    });
  });

  describe('Standalone Multi-Agent Swarm execution (Mobile & Web)', () => {
    beforeEach(() => {
      delete (window as unknown as Record<string, unknown>)['electron'];
    });

    it('executes 4-agent swarm in standalone mode and approves plan when market and treasury are healthy', async () => {
      const triangulationService = (component as any).triangulationService;
      triangulationService.liveRates.set({
        ...triangulationService.liveRates(),
        binanceVesBuy: { value: 96.5, status: 'live', source: 'binance', expectedSource: 'binance' },
        binanceVesSell: { value: 94.5, status: 'live', source: 'binance', expectedSource: 'binance' },
      });

      const accountsService = (component as any).accountsService;
      vi.spyOn(accountsService, 'buildTreasurySnapshot').mockReturnValue({
        accounts: [],
        totalSpentTodayVes: 5000,
        totalDailyLimitVes: 50000,
        overLimitCount: 0,
        nearLimitCount: 0,
        disabledCount: 0,
        saturatedCount: 0,
        fiatBalanceVes: 25000,
        hasAccounts: true,
      });

      await component.triggerSwarmAnalysis();

      const lastMsg = component.messages()[component.messages().length - 1];
      expect(lastMsg.role).toBe('assistant');
      expect(lastMsg.content).toContain('Análisis del Enjambre Multi-Agente Completado');
      expect(lastMsg.content).toContain('🛡 APROBADO POR RIESGO');
      expect(lastMsg.plan).toBeDefined();
      expect(lastMsg.plan?.status).toBe('PROPOSED');
      expect(component.plans().length).toBeGreaterThan(0);
      expect(component.swarmHealth()[0].opsProcessed).toBeGreaterThan(0);
    });

    it('vetoes standalone swarm plan when an account exceeds daily limit', async () => {
      const accountsService = (component as any).accountsService;
      vi.spyOn(accountsService, 'buildTreasurySnapshot').mockReturnValue({
        accounts: [],
        totalSpentTodayVes: 50000,
        totalDailyLimitVes: 40000,
        overLimitCount: 1,
        nearLimitCount: 0,
        disabledCount: 0,
        saturatedCount: 0,
        fiatBalanceVes: 10000,
        hasAccounts: true,
      });

      await component.triggerSwarmAnalysis();

      const lastMsg = component.messages()[component.messages().length - 1];
      expect(lastMsg.content).toContain('⛔ VETADO POR RIESGO');
      expect(lastMsg.content).toContain('1 cuenta(s) bancaria(s) agotaron su límite diario en VES');
      expect(lastMsg.plan?.status).toBe('REJECTED');
    });

    it('blocks standalone plan execution when killswitch is active', async () => {
      vi.spyOn(component, 'treasuryMetrics').mockReturnValue({
        totalEquityUsd: 1000,
        dailyAccumulatedProfitUsdt: 0,
        nearLimitCount: 0,
        overLimitCount: 0,
        totalOperationsToday: 0,
        killSwitchActive: true,
      } as any);

      const samplePlan = {
        id: 'PLAN-TEST-1',
        title: 'Arbitraje Test',
        route: 'VES->USDT',
        capitalRequiredUsdt: 1000,
        expectedNetSpreadPct: 1.5,
        expectedProfitUsdt: 15,
        riskLevel: 'LOW' as const,
        status: 'PROPOSED' as const,
        rationale: 'Test',
      };

      await component.executePlan(samplePlan);
      expect(samplePlan.status).toBe('PROPOSED'); // not approved
      expect(component.actionSuccessNotice()).toContain('Kill-Switch activo');
    });
  });

  describe('Autonomous Agent Manager (Pilar 2.3)', () => {
    it('initializes registered agents with default fallback list and counts active agents', () => {
      expect(component.registeredAgents().length).toBeGreaterThanOrEqual(5);
      expect(component.activeAgentsCount()).toBe(component.registeredAgents().length);
    });

    it('toggles registered agent state and updates success notice', async () => {
      const agent = component.registeredAgents()[0];
      const initialEnabled = agent.enabled;

      await component.toggleRegisteredAgent(agent);
      const updatedAgent = component.registeredAgents().find((a) => a.id === agent.id);
      expect(updatedAgent?.enabled).toBe(!initialEnabled);
      expect(component.actionSuccessNotice()).toContain(agent.name);
    });

    it('consultAgent switches tab to chat and sends prompt directed to agent', () => {
      const sendPromptSpy = vi
        .spyOn(component, 'sendPrompt')
        .mockImplementation(() => Promise.resolve());
      const agent = component.registeredAgents()[0];

      component.setMasterArea('agentes');
      expect(component.activeTab()).toBe('agents');

      component.consultAgent(agent);
      expect(component.activeTab()).toBe('chat');
      expect(sendPromptSpy).toHaveBeenCalledWith(
        expect.stringContaining(`@${agent.id}`),
      );
    });

    it('loads registered agents via IPC listAgents during refreshData', async () => {
      const customAgents = [
        {
          id: 'custom-risk',
          name: 'Custom Risk Bot',
          role: 'CUSTOM_RISK',
          avatar: '🤖',
          description: 'Custom risk agent',
          tools: ['custom_tool'],
          systemPromptModifier: 'Audit risk strictly',
          enabled: true,
        },
      ];

      (window as any).electron = {
        copilot: {
          listAgents: vi.fn().mockResolvedValue(customAgents),
          getPlans: vi.fn().mockResolvedValue([]),
          getLearnings: vi.fn().mockResolvedValue([]),
        },
      };

      await component.refreshData();
      expect(component.registeredAgents()).toEqual(customAgents);
      expect(component.activeAgentsCount()).toBe(1);

      delete (window as any).electron;
    });

    it('renders agent cards in DOM when in agentes master area', () => {
      component.setMasterArea('agentes');
      fixture.detectChanges();

      const element: HTMLElement = fixture.nativeElement;
      const agentCards = element.querySelectorAll('.agent-manager-card');
      expect(agentCards.length).toBe(component.registeredAgents().length);
      expect(element.querySelector('.agents-meta-badge')?.textContent).toContain('activos');
    });
  });

  describe('Web Research Dossier in Canvas (Pilar 1.3)', () => {
    it('opens and closes dossier artifact mutually exclusive with plan artifact', () => {
      const samplePlan = {
        id: 'PLAN-1',
        title: 'Plan Arbitraje',
        route: 'VES->USDT',
        capitalRequiredUsdt: 1000,
        expectedNetSpreadPct: 1.2,
        expectedProfitUsdt: 12,
        riskLevel: 'LOW' as const,
        status: 'PROPOSED' as const,
        rationale: 'Rationale',
      };
      const sampleDossier = {
        id: 'DOSSIER-1',
        title: 'Dossier BCV & Circular SUDEBAN',
        query: 'circular sudeban limites p2p',
        summary: 'Resumen de normativa vigente para límites en cuentas nacionales.',
        timestamp: Date.now(),
        sources: [
          { title: 'Circular SUDEBAN 2026', uri: 'https://sudeban.gob.ve/circular-2026' },
        ],
      };

      component.openPlanArtifact(samplePlan);
      expect(component.activeArtifactPlan()).toBe(samplePlan);
      expect(component.activeArtifactDossier()).toBeNull();

      component.openDossierArtifact(sampleDossier);
      expect(component.activeArtifactDossier()).toBe(sampleDossier);
      expect(component.activeArtifactPlan()).toBeNull();

      component.closeDossierArtifact();
      expect(component.activeArtifactDossier()).toBeNull();
    });

    it('creates and opens dossier in canvas when sendMessage response includes sources', async () => {
      (window as any).electron = {
        copilot: {
          sendMessage: vi.fn().mockResolvedValue({
            reply: 'Se detectó actualización en la tasa oficial del BCV según la subasta cambiaria.',
            sources: [
              { title: 'Banco Central de Venezuela', uri: 'https://bcv.org.ve/tasas' },
            ],
            provenance: {
              source: 'gemini',
              model: 'gemini-2.0-flash',
              timestamp: Date.now(),
              esSimulado: false,
              liveMarketFeedConnected: true,
            },
          }),
        },
      };

      await component.sendPrompt('¿Qué informó el BCV hoy sobre la intervención cambiaria?');

      expect(component.activeArtifactDossier()).toBeTruthy();
      expect(component.activeArtifactDossier()?.sources.length).toBe(1);
      expect(component.activeArtifactDossier()?.sources[0].uri).toBe('https://bcv.org.ve/tasas');

      fixture.detectChanges();
      const element: HTMLElement = fixture.nativeElement;
      const dossierCanvas = element.querySelector('.dossier-canvas');
      expect(dossierCanvas).toBeTruthy();
      expect(dossierCanvas?.querySelector('h3')?.textContent).toContain('Dossier Web:');
      expect(dossierCanvas?.querySelector('.dossier-source-card')?.getAttribute('href')).toBe('https://bcv.org.ve/tasas');

      delete (window as any).electron;
    });
  });

  describe('Grounding Sources & Citations in Chat (Pilar 1.4)', () => {
    it('persists sources in assistant message and renders clickable chips in chat bubble', () => {
      component.messages.set([
        {
          role: 'assistant',
          content: 'Análisis de mercado con citas verificadas.',
          timestamp: Date.now(),
          sources: [
            { title: 'Gaceta Oficial Extraordinaria', uri: 'https://tsj.gob.ve/gaceta' },
            { title: 'Monitor Dólar Venezuela', uri: 'https://monitordolarvenezuela.com' },
          ],
        },
      ]);
      fixture.detectChanges();

      const element: HTMLElement = fixture.nativeElement;
      const sourcesContainer = element.querySelector('.grounding-sources-container');
      expect(sourcesContainer).toBeTruthy();
      expect(sourcesContainer?.textContent).toContain('Fuentes Verificadas (2)');

      const chips = element.querySelectorAll('.source-bubble-chip');
      expect(chips.length).toBe(2);
      expect(chips[0].getAttribute('href')).toBe('https://tsj.gob.ve/gaceta');
      expect(chips[1].getAttribute('href')).toBe('https://monitordolarvenezuela.com');
    });

    it('opens sources dossier in canvas when clicking Ver Dossier in chat bubble', () => {
      const msgWithSources = {
        role: 'assistant' as const,
        content: 'Informe de liquidez bancaria',
        timestamp: Date.now(),
        sources: [
          { title: 'Portal SUDEBAN', uri: 'https://sudeban.gob.ve' },
        ],
      };
      component.messages.set([msgWithSources]);
      fixture.detectChanges();

      const element: HTMLElement = fixture.nativeElement;
      const dossierBtn: HTMLButtonElement | null = element.querySelector('.btn-dossier-link');
      expect(dossierBtn).toBeTruthy();

      dossierBtn?.click();
      expect(component.activeArtifactDossier()).toBeTruthy();
      expect(component.activeArtifactDossier()?.sources[0].uri).toBe('https://sudeban.gob.ve');
    });
  });
});


