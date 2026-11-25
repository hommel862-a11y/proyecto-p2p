import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentStudioComponent } from './agent-studio.component';
import { AgentStudioService, getSkillRiskTier } from '../../core/agent-studio.service';
import type { CustomAgentDto } from '../../../../electron/shared/types';

const MOCK_AGENTS: CustomAgentDto[] = [
  {
    id: 'ad-repricing-desk',
    name: 'Mesa de Anuncios & Repricing P2P',
    description: 'Monitoreo continuo de competitividad de anuncios Binance P2P',
    systemPrompt: 'Protege spread >= 0.50% neto y exige HITL en mutaciones.',
    modelProvider: 'gemini',
    modelName: 'gemini-3.5-flash-lite',
    temperature: 0.1,
    isActive: true,
    executionMode: 'ambient_daemon',
    scheduleIntervalSec: 120,
    domain: 'P2P_DESK',
    dailyBudgetUsd: 1.5,
    maxSteps: 5,
    promptVersion: 1,
    skills: ['audit_ad_competitiveness', 'publish_ad_price', 'toggle_ad_status'],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'treasury-macro-cfo',
    name: 'Tesorero 360 & Centinela Macro BCV',
    description: 'Cruce de liquidez Finanzas 360 y ventanas BCV',
    systemPrompt: 'Monitorea liquidez 14D y cuotas Cashea.',
    modelProvider: 'gemini',
    modelName: 'gemini-3.8-flash',
    temperature: 0.1,
    isActive: true,
    executionMode: 'ambient_daemon',
    scheduleIntervalSec: 900,
    domain: 'FINANCE_360',
    dailyBudgetUsd: 2.0,
    maxSteps: 6,
    promptVersion: 1,
    skills: ['f360_get_treasury_summary', 'check_bcv_intervention_window'],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
];

describe('AgentStudioComponent (3-View Agents Platform)', () => {
  beforeEach(() => {
    if (typeof globalThis.localStorage?.setItem !== 'function') {
      const store = new Map<string, string>();
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, String(v)),
        removeItem: (k: string) => store.delete(k),
        clear: () => store.clear(),
      });
    }
    localStorage.setItem('p2p.custom_agents', JSON.stringify(MOCK_AGENTS));

    TestBed.configureTestingModule({
      imports: [AgentStudioComponent],
      providers: [provideRouter([])],
    });
  });

  it('renders 3-tab platform shell and loads agents into Fleet Dashboard', async () => {
    const fixture = TestBed.createComponent(AgentStudioComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Plataforma de Agentes & Daemons');
    expect(el.textContent).toContain('Flota & Daemons');
    expect(el.textContent).toContain('Studio & Sandbox');
    expect(el.textContent).toContain('Historial Forense');
    expect(el.textContent).toContain('Mesa de Anuncios & Repricing P2P');
    expect(el.textContent).toContain('Tesorero 360 & Centinela Macro BCV');
  });

  it('switches cleanly between fleet, studio, and ledger tabs', () => {
    const fixture = TestBed.createComponent(AgentStudioComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    expect(comp.activeTab()).toBe('fleet');

    comp.openAgentInStudio(MOCK_AGENTS[0]);
    fixture.detectChanges();
    expect(comp.activeTab()).toBe('studio');
    expect(comp.selectedAgentForStudio()?.id).toBe('ad-repricing-desk');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Live Dry-Run Sandbox');

    comp.setTab('ledger');
    fixture.detectChanges();
    expect(comp.activeTab()).toBe('ledger');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Exportar CSV');
  });

  it('navigates to /copilot with agentId and mention queryParams on openAgentInCopilot', () => {
    const fixture = TestBed.createComponent(AgentStudioComponent);
    const comp = fixture.componentInstance;
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    comp.openAgentInCopilot(MOCK_AGENTS[0]);
    expect(navSpy).toHaveBeenCalledWith(['/copilot'], {
      queryParams: { agentId: 'ad-repricing-desk', mention: '@ad-repricing-desk' },
    });
  });

  it('classifies HITL vs READ_ONLY skill tiers accurately and exports CSV', () => {
    expect(getSkillRiskTier('publish_ad_price')).toBe('HITL');
    expect(getSkillRiskTier('toggle_ad_status')).toBe('HITL');
    expect(getSkillRiskTier('trigger_killswitch')).toBe('HITL');
    expect(getSkillRiskTier('audit_ad_competitiveness')).toBe('READ_ONLY');
    expect(getSkillRiskTier('f360_get_treasury_summary')).toBe('READ_ONLY');

    const service = TestBed.inject(AgentStudioService);
    const csv = service.exportRunsCsv([
      {
        id: 'run-1',
        agentId: 'ad-repricing-desk',
        agentName: 'Mesa de Anuncios',
        triggerType: 'sandbox_test',
        status: 'success',
        promptInput: 'Test',
        responseOutput: 'OK',
        toolsCalled: [{ name: 'audit_ad_competitiveness', ok: true, latencyMs: 50 }],
        modelUsed: 'gemini-3.5-flash-lite',
        providerUsed: 'gemini',
        tokensIn: 100,
        tokensOut: 50,
        costUsd: 0.0001,
        latencyMs: 120,
        errorMessage: null,
        startedAt: 1700000000000,
        finishedAt: 1700000000120,
      },
    ]);
    expect(csv).toContain('agent_id');
    expect(csv).toContain('ad-repricing-desk');
    expect(csv).toContain('audit_ad_competitiveness');
  });
});
