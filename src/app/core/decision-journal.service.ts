import { Injectable } from '@angular/core';
import {
  buildDecisionSelfAudit,
  realizedCycleFigures,
  InMemoryDecisionJournalRepository,
  type CloseDecisionCycleInput,
  type DecisionCycle,
  type DecisionCyclesFilter,
  type DecisionJournalRepository,
  type DecisionOutcome,
  type DecisionPerformanceFilter,
  type DecisionPerformanceRow,
  type DecisionSelfAudit,
  type MarketSnapshot,
  type OpenDecisionCycleInput,
  type RecordDecisionInput,
  type RecordMarketSnapshotInput,
  type RecordOutcomeInput,
  type RepricerDecisionRecord,
  type VerificationSummary,
} from '@p2p/core';

/**
 * The operations the journal accepts over its single IPC channel.
 *
 * This mirrors `DecisionJournalOp` in `electron/main/db/decision-journal.repository.ts`.
 * The duplication is deliberate: the renderer is a web bundle and must not import from
 * `electron/`, while the main process must not import from the preload (that edge pulls
 * the untyped preload into the typechecked main program). Neither side can own the
 * shared vocabulary, so it is declared on both and the main process rejects any unknown
 * op at runtime with a `decision_journal:` error, so a drift here fails loudly instead
 * of silently doing nothing.
 */
export type DecisionJournalOp =
  | 'appendMarketSnapshot'
  | 'openCycle'
  | 'closeCycle'
  | 'getCycle'
  | 'listCycles'
  | 'appendDecision'
  | 'getDecision'
  | 'listDecisionsByCycle'
  | 'appendOutcome'
  | 'listOutcomesByDecision'
  | 'getDecisionPerformance'
  | 'getVerificationSummary'
  | 'purgeMarketSnapshotsBefore';

/**
 * The journal seam as the preload exposes it: one function, an opaque payload and an
 * opaque result. Intentionally untyped in both directions — the real types are the
 * domain types applied by this service, and duplicating them in the bridge would create
 * a second source of truth that could drift from core.
 */
export interface DecisionJournalBridge {
  invoke: (op: DecisionJournalOp, payload?: unknown) => Promise<unknown>;
}

/**
 * Which journal the app is really talking to, in a form a consumer can act on.
 *
 * The bridge is resolved once, in a field initializer, so this never changes for the
 * lifetime of the service: it is data, not a state machine, and it is a plain readonly
 * value rather than a signal because nothing can move it.
 */
export interface JournalAvailability {
  /**
   * `true` when the app fell back to an in-memory journal because the Electron bridge
   * was absent. Every call still succeeds, which is precisely the problem: RAM dies
   * with the process and the operator cannot tell that apart from a persisted read.
   */
  readonly degraded: boolean;
  /**
   * Why the journal is degraded, in words a human can act on. Empty while healthy: a
   * healthy journal has nothing to explain.
   */
  readonly reason: string;
}

/**
 * The degradation reason, in the user's language because it is meant to be SHOWN.
 * Exported so a UI does not have to re-invent the sentence next to the `true`.
 */
export const IN_MEMORY_JOURNAL_REASON =
  'El puente de Electron no está disponible en este entorno: el journal está en memoria ' +
  'y todo lo que se registre se pierde al cerrar la aplicación.';

const HEALTHY_JOURNAL: JournalAvailability = Object.freeze({ degraded: false, reason: '' });

const DEGRADED_JOURNAL: JournalAvailability = Object.freeze({
  degraded: true,
  reason: IN_MEMORY_JOURNAL_REASON,
});

/**
 * Renderer-side seam for the Decision Journal.
 *
 * This is the only place that knows the bridge is untyped, and the only place that
 * casts. Everything else in the app talks to the journal through the domain types from
 * `@p2p/core`, so a journal API change breaks the build here instead of quietly becoming
 * `any` at every call site.
 *
 * The journal is a PORT with two implementations — the in-memory one and the SQLite one
 * behind IPC. The main process owns the SQLite adapter; the renderer never sees SQL, and
 * this service does not re-implement the port. It presents the port's shape over the
 * bridge and nothing more.
 */
@Injectable({ providedIn: 'root' })
export class DecisionJournalService {
  // Field initializers run in declaration order, so `resolved` comes first: the bridge
  // and the availability below are two views of that one decision, not two decisions.
  private readonly resolved = resolveJournalBridge();
  private readonly bridge: DecisionJournalBridge = this.resolved.bridge;

  /**
   * Whether the app is persisting to SQLite or answering from RAM.
   *
   * Exposed because the fallback is silent otherwise: a `console.warn` nobody reads
   * leaves the UI rendering decisions as persisted while they live in a store that
   * dies with the process. A consumer that shows real state has to be able to ask.
   */
  readonly availability: JournalAvailability = this.resolved.availability;

  // --- writes -----------------------------------------------------------------

  appendMarketSnapshot(input: RecordMarketSnapshotInput): Promise<MarketSnapshot> {
    return this.call('appendMarketSnapshot', input);
  }

  openCycle(input: OpenDecisionCycleInput): Promise<DecisionCycle> {
    return this.call('openCycle', input);
  }

  closeCycle(cycleId: string, input: CloseDecisionCycleInput): Promise<DecisionCycle> {
    return this.call('closeCycle', { cycleId, input });
  }

  appendDecision(input: RecordDecisionInput): Promise<RepricerDecisionRecord> {
    return this.call('appendDecision', input);
  }

  appendOutcome(input: RecordOutcomeInput): Promise<DecisionOutcome> {
    return this.call('appendOutcome', input);
  }

  // --- reads ------------------------------------------------------------------

  getCycle(cycleId: string): Promise<DecisionCycle | null> {
    return this.call('getCycle', cycleId);
  }

  listCycles(filter?: DecisionCyclesFilter): Promise<DecisionCycle[]> {
    return this.call('listCycles', filter);
  }

  getDecision(decisionId: number): Promise<RepricerDecisionRecord | null> {
    return this.call('getDecision', decisionId);
  }

  listDecisionsByCycle(cycleId: string): Promise<RepricerDecisionRecord[]> {
    return this.call('listDecisionsByCycle', cycleId);
  }

  listOutcomesByDecision(decisionId: number): Promise<DecisionOutcome[]> {
    return this.call('listOutcomesByDecision', decisionId);
  }

  getDecisionPerformance(filter?: DecisionPerformanceFilter): Promise<DecisionPerformanceRow[]> {
    return this.call('getDecisionPerformance', filter);
  }

  getVerificationSummary(filter?: DecisionPerformanceFilter): Promise<VerificationSummary> {
    return this.call('getVerificationSummary', filter);
  }

  // --- derived views ----------------------------------------------------------
  //
  // `closeCycle` above is the raw port, and it is kept raw on purpose: it persists
  // the figures the caller gives it and never aggregates them behind the caller's
  // back. These two methods are the ones that do the aggregating, so a caller that
  // wants a `CLOSED` cycle with honest numbers has exactly one path to get them.

  /**
   * Closes a cycle as `CLOSED` with the figures its own recorded outcomes justify.
   *
   * The figures are computed with `realizedCycleFigures`, the same aggregation the
   * read model applies, so the cycle totals can never disagree with the decision
   * rows that produced them.
   *
   * Refuses — loudly, and without writing anything — when the cycle does not exist
   * or when its outcomes cannot justify a `CLOSED` status: no outcomes, or no
   * outcome reporting a realized spread or a realized profit. Zero is a plausible
   * realized profit, so the refusal exists to stop "we closed it" from silently
   * becoming "we invented a break-even result". Use {@link abandonCycle} for those
   * cycles: `ABANDONED` is the honest terminal status for a cycle whose execution
   * was never verified.
   *
   * Note this is the case in production today: the ad publisher records attempts
   * with `filledAmountUsdt: 0` and reports no figures, so until a verified fill is
   * recorded, this method refuses and `abandonCycle` is the only way out.
   */
  async closeCycleWithRealizedFigures(cycleId: string, reason: string): Promise<DecisionCycle> {
    const cycle = await this.getCycle(cycleId);
    if (cycle === null) {
      throw new Error(
        `DecisionJournalService: el ciclo "${cycleId}" no existe; no se puede cerrar.`,
      );
    }

    const decisions = await this.listDecisionsByCycle(cycleId);
    const outcomeGroups = await Promise.all(
      decisions.map((decision) => this.listOutcomesByDecision(decision.id)),
    );
    const outcomes: readonly DecisionOutcome[] = outcomeGroups.flat();

    const figures = realizedCycleFigures(outcomes);
    if (figures === null) {
      const reportingSpread = outcomes.filter((outcome) => outcome.realizedSpreadPct !== null).length;
      const reportingProfit = outcomes.filter(
        (outcome) => outcome.realizedProfitUsdt !== null,
      ).length;
      throw new Error(
        `DecisionJournalService: el ciclo "${cycleId}" tiene ${outcomes.length} outcome(s) registrados ` +
          `(${reportingSpread} con spread realizado, ${reportingProfit} con profit realizado) y ` +
          'eso no justifica un cierre CLOSED. Cerralo como ABANDONED con abandonCycle(): un ' +
          'intento de publicación no es una ejecución verificada.',
      );
    }

    return this.closeCycle(cycleId, {
      status: 'CLOSED',
      closeReason: reason,
      realizedProfitUsdt: figures.realizedProfitUsdt,
      realizedSpreadPct: figures.realizedSpreadPct,
    });
  }

  /**
   * Closes a cycle as `ABANDONED`: the cycle is over and it is explicitly NOT a
   * verified result.
   *
   * The `realized*` columns are not nullable, so they get the figures the recorded
   * outcomes justify, and zero when nothing was recorded. Zeros here mean "nothing
   * was verified", which is what the status already says; they never mean a
   * break-even result. The `reason` is mandatory so the row explains itself to
   * whoever reads it later.
   */
  async abandonCycle(cycleId: string, reason: string): Promise<DecisionCycle> {
    const decisions = await this.listDecisionsByCycle(cycleId);
    const outcomeGroups = await Promise.all(
      decisions.map((decision) => this.listOutcomesByDecision(decision.id)),
    );
    const figures = realizedCycleFigures(outcomeGroups.flat());

    return this.closeCycle(cycleId, {
      status: 'ABANDONED',
      closeReason: reason,
      realizedProfitUsdt: figures?.realizedProfitUsdt ?? 0,
      realizedSpreadPct: figures?.realizedSpreadPct ?? 0,
    });
  }

  /**
   * The journal's self-audit, typed: modeled vs realized spread per side, how much
   * is backed by a recorded attempt, and how much was taken on stale data.
   *
   * Both reads use the SAME filter, which is what lets the pure builder cross-check
   * that the rows and the summary describe the same set of decisions. Rates are
   * 0..1 ratios. `decisionsWithRecordedAttempt` counts publication attempts, not
   * fills — see `DecisionSelfAudit` in core.
   */
  async getSelfAudit(filter?: DecisionPerformanceFilter): Promise<DecisionSelfAudit> {
    const [rows, summary] = await Promise.all([
      this.getDecisionPerformance(filter),
      this.getVerificationSummary(filter),
    ]);
    return buildDecisionSelfAudit(rows, summary);
  }

  // --- maintenance ------------------------------------------------------------

  /**
   * Prunes market snapshots older than `cutoff`. Not part of the port: purging is a
   * storage-maintenance concern, not a journal operation, so it is exposed here but not
   * imposed on every implementation of `DecisionJournalRepository`.
   */
  purgeMarketSnapshotsBefore(cutoff: number): Promise<number> {
    return this.call('purgeMarketSnapshotsBefore', cutoff);
  }

  /**
   * The single cast. The op vocabulary and the request shape are established in the main
   * process, where the payload and result are `unknown` by necessity; this re-attaches
   * the domain types to a single generic call, so the cast exists once instead of
   * thirteen times.
   */
  private call<T>(op: DecisionJournalOp, payload?: unknown): Promise<T> {
    return this.bridge.invoke(op, payload) as Promise<T>;
  }
}

/**
 * The in-memory journal, used when the Electron bridge is absent: the web build, and
 * every runtime that never ran the preload.
 *
 * It is a real implementation and not a no-op — every read and every write succeeds —
 * which is exactly why the degradation has to be REPORTED instead of thrown. A caller
 * that cannot tell this apart from the SQLite bridge reads a tidy summary of rows that
 * will be gone with the process, and a journal that cannot write ends up looking like a
 * journal that decided not to write. `resolveJournalBridge` pairs this bridge with
 * {@link JournalAvailability} so that difference is visible to whoever renders state.
 */
function createInMemoryBridge(): DecisionJournalBridge {
  const repo = new InMemoryDecisionJournalRepository();
  return {
    invoke: async (op: DecisionJournalOp, payload?: unknown) => {
      switch (op) {
        case 'appendMarketSnapshot':
          return repo.appendMarketSnapshot(payload as RecordMarketSnapshotInput);
        case 'openCycle':
          return repo.openCycle(payload as OpenDecisionCycleInput);
        case 'closeCycle': {
          const { cycleId, input } = payload as { cycleId: string; input: CloseDecisionCycleInput };
          return repo.closeCycle(cycleId, input);
        }
        case 'getCycle':
          return repo.getCycle(payload as string);
        case 'listCycles':
          return repo.listCycles(payload as DecisionCyclesFilter | undefined);
        case 'appendDecision':
          return repo.appendDecision(payload as RecordDecisionInput);
        case 'getDecision':
          return repo.getDecision(payload as number);
        case 'listDecisionsByCycle':
          return repo.listDecisionsByCycle(payload as string);
        case 'appendOutcome':
          return repo.appendOutcome(payload as RecordOutcomeInput);
        case 'listOutcomesByDecision':
          return repo.listOutcomesByDecision(payload as number);
        case 'getDecisionPerformance':
          return repo.getDecisionPerformance(payload as DecisionPerformanceFilter | undefined);
        case 'getVerificationSummary':
          return repo.getVerificationSummary(payload as DecisionPerformanceFilter | undefined);
        case 'purgeMarketSnapshotsBefore':
          return 0;
        default:
          throw new Error(`decision_journal: unknown in-memory op "${op}"`);
      }
    },
  };
}

/**
 * Resolves the bridge from the preload API, asserting the one member `ElectronAPI` does
 * not declare.
 *
 * `electron/shared/types.ts` is outside this change's ownership, so `decisionJournal`
 * cannot be added to the shared `ElectronAPI` type. Rather than sprinkling `as any`
 * through the app, the missing member is asserted ONCE here, at the seam, and
 * everything downstream keeps real types. `ElectronAPI` itself is left untouched, so no
 * other consumer is affected.
 *
 * A missing bridge does NOT throw. Throwing here took the whole terminal down over one
 * optional data source, and the operator lost the panel he already had open — losing a
 * data source must never cost the message that reports on the others. It degrades to an
 * in-memory journal and DECLARES it: the fallback returns `availability.degraded` with
 * a reason, so a journal that cannot persist can never be mistaken for a journal that
 * decided not to write. The `console.warn` below is only the echo of that declaration —
 * it was the only report before, and a log line nobody reads is not a report.
 */
function resolveJournalBridge(): {
  bridge: DecisionJournalBridge;
  availability: JournalAvailability;
} {
  const host = globalThis as {
    electron?: { decisionJournal?: unknown };
    p2p?: { decisionJournal?: unknown };
  };
  const candidate = host.p2p?.decisionJournal ?? host.electron?.decisionJournal;

  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as DecisionJournalBridge).invoke === 'function'
  ) {
    return { bridge: candidate as DecisionJournalBridge, availability: HEALTHY_JOURNAL };
  }

  console.warn(
    '[DecisionJournalService] Bridge de Electron no disponible en este entorno; utilizando almacén en memoria.',
  );
  return { bridge: createInMemoryBridge(), availability: DEGRADED_JOURNAL };
}

/**
 * Compile-time proof that this service still covers the port's whole surface: every
 * operation `DecisionJournalRepository` declares must exist here with a compatible
 * signature. If the port gains, renames, or re-signs an operation, this stops
 * typechecking — which is the point, because the service claims to present the port.
 *
 * It is a real gate, not decoration: the mapped type resolves to `true` for every key
 * only if the signatures line up, and `AssertAllTrue<T extends true>` turns a single
 * `false` into a compile error. (A mapped type that merely resolved to a per-key
 * *message* would typecheck happily, which is why the boolean is required here.)
 */
type AssertAllTrue<T extends Record<PropertyKey, true>> = T;

export type JournalSurfaceParity = AssertAllTrue<{
  [TOp in keyof DecisionJournalRepository]-?: DecisionJournalService extends {
    [TKey in TOp]: (
      ...args: Parameters<DecisionJournalRepository[TKey]>
    ) => ReturnType<DecisionJournalRepository[TKey]>;
  }
    ? true
    : false;
}>;
