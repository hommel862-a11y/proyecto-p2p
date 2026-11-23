import { TestBed } from '@angular/core/testing';
import { Agencia360Component } from './agencia-360.component';
import { AG360_CLIP_SOURCE, AG360_SUB_TAB } from './agencia-360.models';

describe('Agencia360Component (Sprint 5 Spatial Liquid Glass Execution Module)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Agencia360Component],
    }).compileComponents();
  });

  it('renders the Executive Dashboard and 5 Execution sub-tabs with isolated brand vaults', () => {
    const fixture = TestBed.createComponent(Agencia360Component);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    expect(comp.subTabs.length).toBe(6);
    expect(comp.activeSubTab()).toBe(AG360_SUB_TAB.OVERVIEW);
    expect(comp.activeBrand().id).toBe('brd_cashea_01');
    expect(comp.workerConcurrencyLimit).toBe(1);
    expect(comp.customAudioPatchEnabled()).toBe(true);
    expect(comp.activeBrandRoas()).toBeCloseTo(4.85, 2);
  });

  it('switches isolated brand assets without cross-brand leakage and flags 20% low-balance warning', () => {
    const fixture = TestBed.createComponent(Agencia360Component);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    expect(comp.isLowBalanceAlert20Pct()).toBe(false);

    // Switch to brd_b2b_03 which has $1,210 spent out of $1,500 spend cap (19.33% remaining <= 20%)
    comp.selectBrand('brd_b2b_03');
    fixture.detectChanges();

    expect(comp.activeBrand().id).toBe('brd_b2b_03');
    expect(comp.activeBrand().metaAdAccountId).toBe('act_77102938');
    expect(comp.remainingSpendCapRatioPct()).toBeLessThanOrEqual(20);
    expect(comp.isLowBalanceAlert20Pct()).toBe(true);
  });

  it('switches across the 5 Execution sub-tabs and updates the 9:16 vertical hook preview', () => {
    const fixture = TestBed.createComponent(Agencia360Component);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    comp.selectSubTab(AG360_SUB_TAB.VIDEO_PIPELINE);
    comp.selectHookVariant('HOOK_B');
    fixture.detectChanges();

    expect(comp.activeSubTab()).toBe(AG360_SUB_TAB.VIDEO_PIPELINE);
    expect(comp.selectedHook().variant).toBe('HOOK_B');
    expect(comp.selectedHook().retentionScore).toBe(89);

    comp.selectSubTab(AG360_SUB_TAB.VIRAL_CLIPS);
    comp.setViralClipSourceMode(AG360_CLIP_SOURCE.YOUTUBE_SURGICAL);
    fixture.detectChanges();

    expect(comp.viralClipSourceMode()).toBe(AG360_CLIP_SOURCE.YOUTUBE_SURGICAL);
    expect(comp.surgicalYtDlpPreviewCommand()).toContain('--download-sections');
  });

  it('enforces Human-in-the-Loop (HITL) approval and rejection on staged ad campaigns', () => {
    const fixture = TestBed.createComponent(Agencia360Component);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    const pendingBefore = comp.pendingHitlCount();
    expect(pendingBefore).toBeGreaterThan(0);

    comp.approveHitlProposal('hitl_ag360_02');
    fixture.detectChanges();

    const updated = comp.hitlProposals().find((p) => p.approvalId === 'hitl_ag360_02');
    expect(updated?.hitlStatus).toBe('APPROVED');
    expect(updated?.campaignStatus).toBe('ACTIVE');
  });

  it('toggles the scoped Ctrl+K command palette and executes navigation commands', () => {
    const fixture = TestBed.createComponent(Agencia360Component);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    expect(comp.scopedPaletteOpen()).toBe(false);
    comp.toggleScopedPalette();
    expect(comp.scopedPaletteOpen()).toBe(true);

    const flyerCmd = comp.filteredCommands().find((c) => c.tabTarget === AG360_SUB_TAB.FLYER_STUDIO);
    expect(flyerCmd).toBeDefined();
    if (flyerCmd) {
      comp.executeCommand(flyerCmd);
    }
    expect(comp.activeSubTab()).toBe(AG360_SUB_TAB.FLYER_STUDIO);
    expect(comp.scopedPaletteOpen()).toBe(false);
  });
});
