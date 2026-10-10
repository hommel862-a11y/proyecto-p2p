import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { CustomAgentRepository, DEFAULT_SWARM_AGENTS } from './custom-agent.repository';

describe('CustomAgentRepository', () => {
  let db: DatabaseSync;
  let repo: CustomAgentRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    const schemaSql = fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf8');
    db.exec(schemaSql);
    repo = new CustomAgentRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('seeds default swarm agents when database is empty', () => {
    repo.seedDefaultsIfEmpty();
    const agents = repo.listAgents();
    expect(agents.length).toBe(DEFAULT_SWARM_AGENTS.length);
    expect(agents.map((a) => a.id)).toContain('arbitrage-strategist');
    expect(agents.map((a) => a.id)).toContain('security-sentinel');
    expect(agents.map((a) => a.id)).toContain('risk-gatekeeper');
    expect(agents.map((a) => a.id)).toContain('dispute-auditor');
  });

  it('does not duplicate seeds when called multiple times', () => {
    repo.seedDefaultsIfEmpty();
    repo.seedDefaultsIfEmpty();
    const agents = repo.listAgents();
    expect(agents.length).toBe(DEFAULT_SWARM_AGENTS.length);
  });

  it('creates, retrieves, and lists custom agents with assigned skills', () => {
    const created = repo.createAgent({
      id: 'market-sniper',
      name: 'Sniper de Liquidez P2P',
      description: 'Caza anuncios de compra con alto volumen',
      systemPrompt: 'Prioriza órdenes con más de 500 USDT y reputación > 98%',
      modelProvider: 'openrouter',
      modelName: 'nousresearch/hermes-3-llama-3.1-405b',
      temperature: 0.2,
      isActive: true,
      executionMode: 'ambient_daemon',
      scheduleIntervalSec: 120,
      skills: ['get_binance_p2p_orderbook', 'calculate_spread'],
    });

    expect(created.id).toBe('market-sniper');
    expect(created.name).toBe('Sniper de Liquidez P2P');
    expect(created.modelProvider).toBe('openrouter');
    expect(created.modelName).toBe('nousresearch/hermes-3-llama-3.1-405b');
    expect(created.skills).toEqual(['calculate_spread', 'get_binance_p2p_orderbook']);
    expect(created.isActive).toBe(true);

    const fetched = repo.getAgentById('market-sniper');
    expect(fetched).not.toBeNull();
    expect(fetched?.systemPrompt).toBe('Prioriza órdenes con más de 500 USDT y reputación > 98%');
  });

  it('updates agent properties and replaces skills', () => {
    repo.createAgent({
      id: 'agent-to-update',
      name: 'Agente Inicial',
      systemPrompt: 'Prompt inicial',
      skills: ['calculate_spread'],
    });

    const updated = repo.updateAgent('agent-to-update', {
      name: 'Agente Modificado',
      temperature: 0.5,
      skills: ['get_bcv_rates', 'calculate_rate_gap'],
    });

    expect(updated?.name).toBe('Agente Modificado');
    expect(updated?.temperature).toBe(0.5);
    expect(updated?.skills).toEqual(['calculate_rate_gap', 'get_bcv_rates']);
  });

  it('toggles agent active status correctly', () => {
    repo.createAgent({
      id: 'toggle-agent',
      name: 'Toggle Test',
      systemPrompt: 'Test',
      isActive: true,
    });

    const deactivated = repo.toggleAgent('toggle-agent', false);
    expect(deactivated?.isActive).toBe(false);

    const toggled = repo.toggleAgent('toggle-agent');
    expect(toggled?.isActive).toBe(true);
  });

  it('deletes agent and cascades removal of linked skills', () => {
    repo.createAgent({
      id: 'delete-me',
      name: 'Delete Test',
      systemPrompt: 'Test',
      skills: ['calculate_spread'],
    });

    expect(repo.getAgentById('delete-me')).not.toBeNull();
    const deleted = repo.deleteAgent('delete-me');
    expect(deleted).toBe(true);
    expect(repo.getAgentById('delete-me')).toBeNull();

    const skillsInDb = db.prepare('SELECT * FROM custom_agent_skills WHERE agent_id = ?').all('delete-me');
    expect(skillsInDb.length).toBe(0);
  });

  it('filters agents by active status and execution mode', () => {
    repo.createAgent({
      id: 'agent-1',
      name: 'Agent 1',
      systemPrompt: 'Prompt 1',
      isActive: true,
      executionMode: 'on_demand',
    });
    repo.createAgent({
      id: 'agent-2',
      name: 'Agent 2',
      systemPrompt: 'Prompt 2',
      isActive: false,
      executionMode: 'ambient_daemon',
    });

    const activeOnly = repo.listAgents({ activeOnly: true });
    expect(activeOnly.map((a) => a.id)).toEqual(['agent-1']);

    const daemonOnly = repo.listAgents({ mode: 'ambient_daemon' });
    expect(daemonOnly.map((a) => a.id)).toEqual(['agent-2']);
  });
});
