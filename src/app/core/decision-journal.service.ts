import { Injectable } from '@angular/core';
import type {
  CloseDecisionCycleInput,
  DecisionCycle,
  DecisionCyclesFilter,
  DecisionJournalRepository,
  DecisionOutcome,
  DecisionPerformanceFilter,
  DecisionPerformanceRow,
  MarketSnapshot,
  OpenDecisionCycleInput,
  RecordDecisionInput,
  RecordMarketSnapshotInput,
  RecordOutcomeInput,
  RepricerDecisionRecord,
  VerificationSummary,
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
type DecisionJournalOp =
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
interface DecisionJournalBridge {
  invoke: (op: DecisionJournalOp, payload?: unknown) => Promise<unknown>;
}

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
  private readonly bridge: DecisionJournalBridge = resolveJournalBridge();

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
 * Resolves the bridge from the preload API, asserting the one member `ElectronAPI` does
 * not declare.
 *
 * `electron/shared/types.ts` is outside this change's ownership, so `decisionJournal`
 * cannot be added to the shared `ElectronAPI` type. Rather than sprinkling `as any`
 * through the app, the missing member is asserted ONCE here, at the seam, and
 * everything downstream keeps real types. `ElectronAPI` itself is left untouched, so no
 * other consumer is affected.
 *
 * A missing bridge throws rather than degrading to a no-op: a journal that cannot write
 * must not look like a journal that decided not to.
 */
function resolveJournalBridge(): DecisionJournalBridge {
  const candidate = (globalThis as { p2p?: { decisionJournal?: unknown } }).p2p?.decisionJournal;

  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof (candidate as DecisionJournalBridge).invoke !== 'function'
  ) {
    throw new Error(
      'DecisionJournalService: the Electron preload bridge does not expose ' +
        '`decisionJournal`, so the renderer cannot reach the journal.',
    );
  }

  return candidate as DecisionJournalBridge;
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
