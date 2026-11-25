import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { CustomAgentRepository } from '../db/custom-agent.repository';
import { AgentDaemonScheduler, HITL_MUTATION_TOOLS } from './daemon-scheduler';

describe('AgentDaemonScheduler', () => {
  let db: DatabaseSync;
  let repo: CustomAgentRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    const schemaSql = fs.readFileSync(path.resolve(__dirname, '../db/schema.sql'), 'utf8');
    db.exec(schemaSql);
    repo = new CustomAgentRepository(db);
    repo.seedDefaultsIfEmpty();
  });

  afterEach(() => {
    db.close();
  });

  it('blocks execution and logs blocked_killswitch when killswitch is active', async () => {
    const executor = vi.fn();
    const scheduler = new AgentDaemonScheduler({
      repo,
      executor,
      isKillswitchActive: () => true,
    });

    const run = await scheduler.runNow('ad-repricing-desk', 'Check ads');
    expect(run.status).toBe('blocked_killswitch');
    expect(executor).not.toHaveBeenCalled();

    const stored = repo.listRuns({ agentId: 'ad-repricing-desk' });
    expect(stored.length).toBe(1);
    expect(stored[0].status).toBe('blocked_killswitch');
  });

  it('blocks execution and logs blocked_budget when 24h spend reaches dailyBudgetUsd', async () => {
    repo.updateAgent('ad-repricing-desk', { dailyBudgetUsd: 0.1 });
    const prev = repo.createRun({
      agentId: 'ad-repricing-desk',
      triggerType: 'daemon_tick',
      promptInput: 'prev',
      modelUsed: 'gemini-3.5-flash-lite',
    });
    repo.completeRun(prev.id, { status: 'success', costUsd: 0.12, latencyMs: 100 });

    const executor = vi.fn();
    const scheduler = new AgentDaemonScheduler({
      repo,
      executor,
      isKillswitchActive: () => false,
    });

    const run = await scheduler.runNow('ad-repricing-desk', 'Check ads again');
    expect(run.status).toBe('blocked_budget');
    expect(executor).not.toHaveBeenCalled();
  });

  it('strips HITL mutation tools during sandbox_test and passes READ-ONLY tools only', async () => {
    const executor = vi.fn(async (req) => ({
      reply: `Allowed: ${req.allowedSkills.join(',')} | Blocked: ${req.blockedSkills.join(',')}`,
      modelUsed: req.agent.modelName,
      providerUsed: req.agent.modelProvider,
      toolsCalled: [{ name: 'audit_ad_competitiveness', ok: true, latencyMs: 42 }],
      tokensIn: 120,
      tokensOut: 40,
      costUsd: 0.0004,
    }));

    const scheduler = new AgentDaemonScheduler({
      repo,
      executor,
      isKillswitchActive: () => false,
    });

    const run = await scheduler.runSandbox('ad-repricing-desk', 'Evalúa mi anuncio Top 3', {
      overrideModel: 'gemini-3.8-flash',
    });

    expect(run.status).toBe('success');
    expect(run.triggerType).toBe('sandbox_test');
    expect(run.modelUsed).toBe('gemini-3.8-flash');
    expect(executor).toHaveBeenCalledTimes(1);

    const callArg = executor.mock.calls[0][0];
    expect(callArg.blockedSkills).toContain('publish_ad_price');
    expect(callArg.blockedSkills).toContain('toggle_ad_status');
    for (const allowed of callArg.allowedSkills) {
      expect(HITL_MUTATION_TOOLS.has(allowed)).toBe(false);
    }

    // Verify sandbox override did NOT mutate persisted agent record
    const persisted = repo.getAgentById('ad-repricing-desk');
    expect(persisted?.modelName).toBe('gemini-3.5-flash-lite');
  });

  it('reconciles active daemons and stops cleanly', () => {
    const scheduler = new AgentDaemonScheduler({
      repo,
      executor: vi.fn(),
      isKillswitchActive: () => false,
    });

    scheduler.start();
    const status = scheduler.getStatus();
    expect(status.started).toBe(true);
    expect(status.activeDaemonCount).toBeGreaterThanOrEqual(4); // ad-repricing-desk, treasury-macro-cfo, risk-gatekeeper, arm-followup-daemon
    expect(status.slots.every((s) => s.intervalSec >= 60)).toBe(true);

    repo.toggleAgent('ad-repricing-desk', false);
    const afterToggle = scheduler.reconcile();
    expect(afterToggle.slots.some((s) => s.agentId === 'ad-repricing-desk')).toBe(false);

    scheduler.stop();
    expect(scheduler.getStatus().started).toBe(false);
  });
});
