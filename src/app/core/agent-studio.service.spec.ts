import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AgentStudioService, MCP_SKILL_CATALOG } from './agent-studio.service';
import { ToastService } from './toast.service';

describe('AgentStudioService', () => {
  let service: AgentStudioService;
  let toast: ToastService;

  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map<string, string>();
    (globalThis as Record<string, unknown>)['localStorage'] = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;

    TestBed.configureTestingModule({
      providers: [AgentStudioService, ToastService],
    });
    service = TestBed.inject(AgentStudioService);
    toast = TestBed.inject(ToastService);
  });

  afterEach(() => {
    store?.clear();
  });

  it('should be created and expose complete MCP skill catalog', () => {
    expect(service).toBeTruthy();
    expect(MCP_SKILL_CATALOG.length).toBeGreaterThan(15);
    const tradingSkills = MCP_SKILL_CATALOG.filter((s) => s.category === 'TRADING');
    const riskSkills = MCP_SKILL_CATALOG.filter((s) => s.category === 'RIESGO');
    expect(tradingSkills.length).toBeGreaterThan(0);
    expect(riskSkills.length).toBeGreaterThan(0);
  });

  it('should create and retrieve custom agents in localStorage fallback', async () => {
    const created = await service.createAgent({
      id: 'test-agent-1',
      name: 'Agente de Prueba',
      description: 'Descripción de prueba',
      systemPrompt: 'Prompt de prueba',
      modelProvider: 'gemini',
      modelName: 'gemini-3.7-flash',
      skills: ['calculate_spread', 'get_bcv_rates'],
    });

    expect(created).toBeTruthy();
    expect(created?.id).toBe('test-agent-1');
    expect(service.totalCount()).toBe(1);
    expect(service.activeCount()).toBe(1);

    const fetched = service.agents().find((a) => a.id === 'test-agent-1');
    expect(fetched?.skills).toEqual(['calculate_spread', 'get_bcv_rates']);
  });

  it('should filter agents by execution mode and search query', async () => {
    await service.createAgent({
      id: 'agent-on-demand',
      name: 'Estratega On-Demand',
      description: 'Arbitraje manual',
      systemPrompt: 'Prompt 1',
      executionMode: 'on_demand',
      skills: ['calculate_spread'],
    });

    await service.createAgent({
      id: 'agent-daemon',
      name: 'Centinela Daemon',
      description: 'Vigilancia continua',
      systemPrompt: 'Prompt 2',
      executionMode: 'ambient_daemon',
      scheduleIntervalSec: 60,
      skills: ['evaluate_account_saturation'],
    });

    expect(service.totalCount()).toBe(2);

    service.setFilterMode('ambient_daemon');
    expect(service.filteredAgents().length).toBe(1);
    expect(service.filteredAgents()[0].id).toBe('agent-daemon');

    service.setFilterMode('all');
    service.setSearchQuery('Centinela');
    expect(service.filteredAgents().length).toBe(1);
    expect(service.filteredAgents()[0].id).toBe('agent-daemon');

    service.setSearchQuery('');
    expect(service.filteredAgents().length).toBe(2);
  });

  it('should toggle and delete custom agents cleanly', async () => {
    await service.createAgent({
      id: 'agent-to-toggle',
      name: 'Agente Toggle',
      systemPrompt: 'Prompt',
      isActive: true,
    });

    await service.toggleAgent('agent-to-toggle', false);
    let agent = service.agents().find((a) => a.id === 'agent-to-toggle');
    expect(agent?.isActive).toBe(false);

    await service.deleteAgent('agent-to-toggle');
    agent = service.agents().find((a) => a.id === 'agent-to-toggle');
    expect(agent).toBeUndefined();
    expect(service.totalCount()).toBe(0);
  });
});
