import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Agencia360ApiService } from './agencia-360-api.service';
import { Agencia360Component } from './agencia-360.component';
import { AG360_CLIP_SOURCE, AG360_SUB_TAB, AG360_VIDEO_ENGINE } from './agencia-360.models';

describe('Agencia360Component (Zero-Seed Real Production Overhaul)', () => {
  beforeEach(async () => {
    if (typeof localStorage !== 'undefined' && typeof localStorage.removeItem === 'function') {
      localStorage.removeItem('agencia360.zero_seed.brands.v2');
      localStorage.removeItem('agencia360.zero_seed.connections.v2');
    }
    await TestBed.configureTestingModule({
      imports: [Agencia360Component],
    }).compileComponents();
    const api = TestBed.inject(Agencia360ApiService);
    vi.spyOn(api, 'checkHealth').mockResolvedValue(null);
  });

  it('enforces strict Zero-Seed on first launch (0 fake brands, $0.00 balance, 0 fake hooks/proposals)', () => {
    const fixture = TestBed.createComponent(Agencia360Component);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    expect(comp.brands().length).toBe(0);
    expect(comp.activeBrand()).toBeNull();
    expect(comp.activeBrandRoas()).toBe(0);
    expect(comp.cardKillswitchStatus()).toBe('UNFUNDED');
    expect(comp.generatedHooks().length).toBe(0);
    expect(comp.hitlProposals().length).toBe(0);
  });

  it('creates a real brand, funds its Card Mirror vault, and computes 80%/95% kill-switch states', async () => {
    const fixture = TestBed.createComponent(Agencia360Component);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    comp.newBrandName.set('Mi Comercio Real VE');
    comp.newBrandCardLabel.set('Wally Virtual USD');
    comp.newBrandCardLast4.set('4821');
    comp.newBrandSpendCap.set(200);
    comp.newBrandInitialFund.set(100);
    await comp.createRealBrand();
    fixture.detectChanges();

    expect(comp.brands().length).toBe(1);
    expect(comp.activeBrand()?.displayName).toBe('Mi Comercio Real VE');
    expect(comp.activeBrand()?.vaultBalanceUsd).toBe(100);
    expect(comp.cardKillswitchStatus()).toBe('SAFE');

    // Stage and approve a $96 CTWA campaign -> consumes 96% of card -> triggers KILLSWITCH_95PCT
    comp.ctwaCampaignName.set('Reels WhatsApp Caracas');
    comp.ctwaWhatsappPhone.set('+584121234567');
    comp.ctwaDailyBudgetUsd.set(96);
    comp.stageCtwaCampaignForHitl();
    expect(comp.pendingHitlCount()).toBe(1);

    const approvalId = comp.hitlProposals()[0].approvalId;
    comp.approveHitlProposal(approvalId);
    fixture.detectChanges();

    expect(comp.cardConsumedPct()).toBe(96);
    expect(comp.cardKillswitchStatus()).toBe('KILLSWITCH_95PCT');
  });

  it('saves encrypted API connections and supports Gemini Omni 1.2 / Google Flow / YouTube surgical modes', async () => {
    const fixture = TestBed.createComponent(Agencia360Component);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    comp.connProvider.set('GEMINI_API');
    comp.connTokenInput.set('AIzaSy_TEST_KEY_12345');
    await comp.saveApiConnection();
    expect(comp.connections().length).toBe(1);
    expect(comp.connections()[0].provider).toBe('GEMINI_API');

    comp.setVideoEngine(AG360_VIDEO_ENGINE.GOOGLE_FLOW_HYBRID);
    expect(comp.selectedVideoEngine()).toBe(AG360_VIDEO_ENGINE.GOOGLE_FLOW_HYBRID);

    comp.setViralClipSourceMode(AG360_CLIP_SOURCE.YOUTUBE_SURGICAL);
    comp.youtubeSurgicalUrl.set('https://www.youtube.com/watch?v=realVideoVE');
    comp.youtubeSurgicalRange.set('00:02:10-00:02:55');
    expect(comp.surgicalYtDlpPreviewCommand()).toContain('--download-sections "*00:02:10-00:02:55"');
  });

  it('toggles scoped Ctrl+K palette and navigates to Conexiones & APIs or sub-tabs', () => {
    const fixture = TestBed.createComponent(Agencia360Component);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    comp.toggleScopedPalette();
    expect(comp.scopedPaletteOpen()).toBe(true);

    const apiCmd = comp.filteredCommands().find((c) => c.action === 'OPEN_CONNECTIONS');
    expect(apiCmd).toBeDefined();
    if (apiCmd) comp.executeCommand(apiCmd);
    expect(comp.connectionsModalOpen()).toBe(true);

    expect(comp.handleScopedEscape()).toBe(true);
    expect(comp.connectionsModalOpen()).toBe(false);

    comp.selectSubTab(AG360_SUB_TAB.FLYER_STUDIO);
    expect(comp.activeSubTab()).toBe(AG360_SUB_TAB.FLYER_STUDIO);
  });

  it('hydrates persisted SQLite connections and WhatsApp metadata on refreshBackendStatus', async () => {
    const api = TestBed.inject(Agencia360ApiService);
    vi.spyOn(api, 'checkHealth').mockResolvedValue({
      status: 'ok',
      version: '2.0.0',
      timezone: 'America/Caracas',
      video_worker_concurrency: 1,
      arm_decoupled: true,
      ffmpeg_installed: true,
      local_inbox_dir: 'E:\\Agencia_Inbox',
      persistence_mode: 'SQLITE_LOCAL_E_DRIVE',
      genai_models_2026: {},
    });
    vi.spyOn(api, 'listBrands').mockResolvedValue([]);
    vi.spyOn(api, 'listConnections').mockResolvedValue([
      {
        scope_id: 'GLOBAL',
        provider: 'GEMINI_API',
        configured: true,
        metadata: {},
        last_test_status: 'CONNECTED',
      },
      {
        scope_id: 'GLOBAL',
        provider: 'TELEGRAM_BOT',
        configured: true,
        metadata: { whatsapp_phone: '+58 424-7723783', page_id: '102167831172469' },
        last_test_status: 'CONNECTED',
      },
    ]);

    const fixture = TestBed.createComponent(Agencia360Component);
    const comp = fixture.componentInstance;
    await comp.refreshBackendStatus();
    fixture.detectChanges();

    expect(comp.connections().some((c) => c.provider === 'GEMINI_API')).toBe(true);
    expect(comp.liveRoadmapSteps()[2].completed).toBe(true);
    expect(comp.ctwaWhatsappPhone()).toBe('+58 424-7723783');
  });
});
