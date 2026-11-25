/**
 * AgentDaemonScheduler — Real background daemon runner & sandbox executor for Custom Agents.
 *
 * Security & Governance Guarantees:
 * - Minimum tick interval clamped to 60 seconds (prevents API hammering).
 * - Non-overlapping per-agent execution lock (skips tick if previous run is still active).
 * - Killswitch interlock: immediately blocks execution and writes `blocked_killswitch` to SQLite `agent_runs`.
 * - Per-agent daily USD budget cap: writes `blocked_budget` to `agent_runs` when 24h spend >= `dailyBudgetUsd`.
 * - Strict READ-ONLY tool enforcement for `daemon_tick` runs: strips all HITL/mutation tools so background
 *   daemons can never mutate live orders, ads, blacklists, or WhatsApp messages without human approval.
 */

import type {
  AgentRunRecord,
  AgentRunStatus,
  AgentRunToolEntry,
  AgentRunTriggerType,
  CustomAgentRecord,
  CustomAgentRepository,
} from '../db/custom-agent.repository';

export const MIN_DAEMON_INTERVAL_SEC = 60;

/**
 * Tools that mutate live financial, CRM, or operational state and MUST require Human-in-the-Loop (HITL).
 * Background `daemon_tick` executions are strictly forbidden from calling these tools.
 */
export const HITL_MUTATION_TOOLS: ReadonlySet<string> = new Set([
  'publish_ad_price',
  'toggle_ad_status',
  'trigger_killswitch',
  'dispatch_order_instructions',
  'register_blacklisted_entity',
  'add_operation_entry',
  'execute_browser_operator_task',
  'send_whatsapp_template',
  'book_appointment',
  'create_or_submit_quote',
  'transition_pipeline_stage',
  'update_lead_bant_and_profile',
  'send_multichannel_alert',
]);

export interface AgentExecutionRequest {
  agent: CustomAgentRecord;
  prompt: string;
  triggerType: AgentRunTriggerType;
  allowedSkills: string[];
  blockedSkills: string[];
  maxSteps: number;
}

export interface AgentExecutionResult {
  reply: string;
  modelUsed: string;
  providerUsed: string;
  toolsCalled: AgentRunToolEntry[];
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export type AgentExecutorFn = (req: AgentExecutionRequest) => Promise<AgentExecutionResult>;

export interface DaemonSlotStatus {
  agentId: string;
  agentName: string;
  domain: string;
  modelName: string;
  intervalSec: number;
  isRunningNow: boolean;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: AgentRunStatus | null;
  dailySpendUsd: number;
  dailyBudgetUsd: number;
}

export interface DaemonSchedulerStatusDto {
  started: boolean;
  killswitchActive: boolean;
  activeDaemonCount: number;
  runningNowCount: number;
  slots: DaemonSlotStatus[];
}

export interface AgentRunEventPayload {
  type: 'run_started' | 'run_completed' | 'daemon_reconciled';
  run?: AgentRunRecord;
  status?: DaemonSchedulerStatusDto;
  timestamp: number;
}

interface ScheduledTimerEntry {
  agentId: string;
  intervalSec: number;
  timer: ReturnType<typeof setInterval>;
  nextRunAt: number;
  lastRunAt: number | null;
  lastStatus: AgentRunStatus | null;
}

export interface AgentDaemonSchedulerOptions {
  repo: CustomAgentRepository;
  executor: AgentExecutorFn;
  isKillswitchActive: () => boolean;
  onEvent?: (event: AgentRunEventPayload) => void;
  now?: () => number;
}

export class AgentDaemonScheduler {
  private readonly repo: CustomAgentRepository;
  private readonly executor: AgentExecutorFn;
  private readonly isKillswitchActive: () => boolean;
  private readonly onEvent?: (event: AgentRunEventPayload) => void;
  private readonly now: () => number;

  private started = false;
  private readonly timers = new Map<string, ScheduledTimerEntry>();
  private readonly runningAgents = new Set<string>();

  constructor(options: AgentDaemonSchedulerOptions) {
    this.repo = options.repo;
    this.executor = options.executor;
    this.isKillswitchActive = options.isKillswitchActive;
    this.onEvent = options.onEvent;
    this.now = options.now ?? (() => Date.now());
  }

  start(): void {
    if (this.started) {
      this.reconcile();
      return;
    }
    this.started = true;
    this.reconcile();
  }

  stop(): void {
    this.started = false;
    for (const entry of this.timers.values()) {
      clearInterval(entry.timer);
    }
    this.timers.clear();
  }

  /**
   * Synchronizes active timers with SQLite `custom_agents` (`is_active = 1 AND execution_mode = 'ambient_daemon'`).
   * Safe to call after any create/update/toggle/delete mutation.
   */
  reconcile(): DaemonSchedulerStatusDto {
    const activeDaemons = this.started
      ? this.repo.listAgents({ activeOnly: true, mode: 'ambient_daemon' })
      : [];
    const desiredIds = new Set(activeDaemons.map((a) => a.id));

    // Remove timers for deactivated, switched-to-on_demand, or deleted agents
    for (const [agentId, entry] of this.timers.entries()) {
      if (!desiredIds.has(agentId)) {
        clearInterval(entry.timer);
        this.timers.delete(agentId);
      }
    }

    // Add or update timers for active daemons
    for (const agent of activeDaemons) {
      const intervalSec = Math.max(MIN_DAEMON_INTERVAL_SEC, agent.scheduleIntervalSec ?? 300);
      const existing = this.timers.get(agent.id);
      if (existing && existing.intervalSec === intervalSec) {
        continue;
      }
      if (existing) {
        clearInterval(existing.timer);
      }

      const intervalMs = intervalSec * 1000;
      const entry: ScheduledTimerEntry = {
        agentId: agent.id,
        intervalSec,
        nextRunAt: this.now() + intervalMs,
        lastRunAt: existing?.lastRunAt ?? null,
        lastStatus: existing?.lastStatus ?? null,
        timer: setInterval(() => {
          const current = this.timers.get(agent.id);
          if (current) {
            current.nextRunAt = this.now() + intervalMs;
          }
          void this.executeAgent(agent.id, {
            triggerType: 'daemon_tick',
            prompt: this.buildDefaultDaemonPrompt(agent),
          });
        }, intervalMs),
      };
      // Prevent timers from blocking Node/Vitest process exit
      if (typeof entry.timer.unref === 'function') {
        entry.timer.unref();
      }
      this.timers.set(agent.id, entry);
    }

    const status = this.getStatus();
    this.emit({ type: 'daemon_reconciled', status, timestamp: this.now() });
    return status;
  }

  async runNow(agentId: string, promptOverride?: string): Promise<AgentRunRecord> {
    const agent = this.repo.getAgentById(agentId);
    if (!agent) {
      throw new Error(`Agente no encontrado: ${agentId}`);
    }
    const prompt = promptOverride?.trim() || this.buildDefaultDaemonPrompt(agent);
    return this.executeAgent(agentId, { triggerType: 'manual_run', prompt });
  }

  async runSandbox(
    agentId: string,
    prompt: string,
    options?: { overrideSystemPrompt?: string; overrideSkills?: string[]; overrideModel?: string },
  ): Promise<AgentRunRecord> {
    const agent = this.repo.getAgentById(agentId);
    if (!agent) {
      throw new Error(`Agente no encontrado: ${agentId}`);
    }
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      throw new Error('El prompt de prueba en Sandbox no puede estar vacío.');
    }

    const sandboxAgent: CustomAgentRecord = {
      ...agent,
      systemPrompt: options?.overrideSystemPrompt?.trim() || agent.systemPrompt,
      skills: options?.overrideSkills ?? agent.skills,
      modelName: options?.overrideModel?.trim() || agent.modelName,
    };

    return this.executeAgent(agentId, {
      triggerType: 'sandbox_test',
      prompt: cleanPrompt,
      agentOverride: sandboxAgent,
    });
  }

  getStatus(): DaemonSchedulerStatusDto {
    const activeDaemons = this.repo.listAgents({ activeOnly: true, mode: 'ambient_daemon' });
    const nowMs = this.now();
    const slots: DaemonSlotStatus[] = activeDaemons.map((agent) => {
      const entry = this.timers.get(agent.id);
      return {
        agentId: agent.id,
        agentName: agent.name,
        domain: agent.domain,
        modelName: agent.modelName,
        intervalSec: entry?.intervalSec ?? Math.max(MIN_DAEMON_INTERVAL_SEC, agent.scheduleIntervalSec ?? 300),
        isRunningNow: this.runningAgents.has(agent.id),
        nextRunAt: entry?.nextRunAt ?? null,
        lastRunAt: entry?.lastRunAt ?? null,
        lastStatus: entry?.lastStatus ?? null,
        dailySpendUsd: this.repo.getAgentDailySpendUsd(agent.id, nowMs),
        dailyBudgetUsd: agent.dailyBudgetUsd,
      };
    });

    return {
      started: this.started,
      killswitchActive: this.isKillswitchActive(),
      activeDaemonCount: activeDaemons.length,
      runningNowCount: this.runningAgents.size,
      slots,
    };
  }

  private async executeAgent(
    agentId: string,
    opts: {
      triggerType: AgentRunTriggerType;
      prompt: string;
      agentOverride?: CustomAgentRecord;
    },
  ): Promise<AgentRunRecord> {
    const agent = opts.agentOverride ?? this.repo.getAgentById(agentId);
    if (!agent) {
      throw new Error(`Agente no encontrado: ${agentId}`);
    }

    const startedAt = this.now();

    // Non-overlapping lock for background ticks
    if (opts.triggerType === 'daemon_tick' && this.runningAgents.has(agentId)) {
      const skipped = this.repo.createRun({
        agentId: agent.id,
        triggerType: opts.triggerType,
        status: 'error',
        promptInput: opts.prompt,
        modelUsed: agent.modelName,
        providerUsed: agent.modelProvider,
        startedAt,
      });
      const completed =
        this.repo.completeRun(skipped.id, {
          status: 'error',
          errorMessage: 'Tick omitido: la ejecución anterior de este daemon aún sigue en curso.',
          latencyMs: 0,
          finishedAt: this.now(),
        }) ?? skipped;
      this.recordSlotOutcome(agent.id, completed);
      this.emit({ type: 'run_completed', run: completed, timestamp: this.now() });
      return completed;
    }

    // 1. Killswitch interlock (fail closed)
    if (this.isKillswitchActive()) {
      const run = this.repo.createRun({
        agentId: agent.id,
        triggerType: opts.triggerType,
        status: 'blocked_killswitch',
        promptInput: opts.prompt,
        modelUsed: agent.modelName,
        providerUsed: agent.modelProvider,
        startedAt,
      });
      const completed =
        this.repo.completeRun(run.id, {
          status: 'blocked_killswitch',
          errorMessage: 'Ejecución bloqueada por Killswitch de emergencia activo.',
          latencyMs: 0,
          finishedAt: this.now(),
        }) ?? run;
      this.recordSlotOutcome(agent.id, completed);
      this.emit({ type: 'run_completed', run: completed, timestamp: this.now() });
      return completed;
    }

    // 2. Daily USD budget cap (fail closed)
    const dailySpend = this.repo.getAgentDailySpendUsd(agent.id, startedAt);
    if (dailySpend >= agent.dailyBudgetUsd) {
      const run = this.repo.createRun({
        agentId: agent.id,
        triggerType: opts.triggerType,
        status: 'blocked_budget',
        promptInput: opts.prompt,
        modelUsed: agent.modelName,
        providerUsed: agent.modelProvider,
        startedAt,
      });
      const completed =
        this.repo.completeRun(run.id, {
          status: 'blocked_budget',
          errorMessage: `Tope diario alcanzado: $${dailySpend.toFixed(4)} / $${agent.dailyBudgetUsd.toFixed(2)} USD en 24h.`,
          latencyMs: 0,
          finishedAt: this.now(),
        }) ?? run;
      this.recordSlotOutcome(agent.id, completed);
      this.emit({ type: 'run_completed', run: completed, timestamp: this.now() });
      return completed;
    }

    // 3. Enforce strict READ-ONLY skill filtering on background daemon ticks & sandbox dry-runs
    const enforceReadOnly = opts.triggerType === 'daemon_tick' || opts.triggerType === 'sandbox_test';
    const allowedSkills: string[] = [];
    const blockedSkills: string[] = [];
    for (const skill of agent.skills) {
      if (enforceReadOnly && HITL_MUTATION_TOOLS.has(skill)) {
        blockedSkills.push(skill);
      } else {
        allowedSkills.push(skill);
      }
    }

    const run = this.repo.createRun({
      agentId: agent.id,
      triggerType: opts.triggerType,
      status: 'running',
      promptInput: opts.prompt,
      modelUsed: agent.modelName,
      providerUsed: agent.modelProvider,
      startedAt,
    });
    this.emit({ type: 'run_started', run, timestamp: startedAt });

    this.runningAgents.add(agent.id);
    try {
      const result = await this.executor({
        agent,
        prompt: opts.prompt,
        triggerType: opts.triggerType,
        allowedSkills,
        blockedSkills,
        maxSteps: agent.maxSteps,
      });

      const finishedAt = this.now();
      const completed =
        this.repo.completeRun(run.id, {
          status: 'success',
          responseOutput: result.reply,
          toolsCalled: result.toolsCalled,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          costUsd: result.costUsd,
          latencyMs: Math.max(0, finishedAt - startedAt),
          finishedAt,
        }) ?? run;

      this.recordSlotOutcome(agent.id, completed);
      this.emit({ type: 'run_completed', run: completed, timestamp: finishedAt });
      return completed;
    } catch (err) {
      const finishedAt = this.now();
      const message = err instanceof Error ? err.message : String(err);
      const completed =
        this.repo.completeRun(run.id, {
          status: 'error',
          errorMessage: message,
          latencyMs: Math.max(0, finishedAt - startedAt),
          finishedAt,
        }) ?? run;

      this.recordSlotOutcome(agent.id, completed);
      this.emit({ type: 'run_completed', run: completed, timestamp: finishedAt });
      return completed;
    } finally {
      this.runningAgents.delete(agent.id);
    }
  }

  private recordSlotOutcome(agentId: string, run: AgentRunRecord): void {
    const entry = this.timers.get(agentId);
    if (entry) {
      entry.lastRunAt = run.finishedAt ?? run.startedAt;
      entry.lastStatus = run.status;
    }
  }

  private buildDefaultDaemonPrompt(agent: CustomAgentRecord): string {
    return `[DAEMON TICK READ-ONLY] Ejecuta tu chequeo periódico de monitoreo para ${agent.name} (${agent.domain}). Usa únicamente herramientas de lectura autorizadas y reporta hallazgos accionables o anomalías reales. No ejecutes mutaciones sin aprobación humana (HITL).`;
  }

  private emit(event: AgentRunEventPayload): void {
    try {
      this.onEvent?.(event);
    } catch {
      // Never let listener errors crash scheduler loop
    }
  }
}
