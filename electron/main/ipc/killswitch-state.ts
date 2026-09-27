/**
 * In-memory kill-switch state shared across the main process.
 *
 * `ipc/handlers.ts` exposes the kill-switch over IPC, but `gemini-orchestrator.ts` must be
 * able to read it before approving a plan. handlers.ts already imports the orchestrator to
 * build its singleton (`new GeminiOrchestrator(...)`), so importing handlers back from the
 * orchestrator would close a cycle: orchestrator -> handlers -> orchestrator. The state
 * therefore lives in this leaf module, which has no imports at all, and handlers.ts
 * re-exports both symbols so existing call sites (main/index.ts global hotkey, IPC
 * handlers, tests) keep working unchanged.
 *
 * Same pattern, same reason as `ipc/treasury-snapshot.ts`.
 */

export interface KillswitchState {
  isTriggered: boolean;
  timestamp?: number;
  reason?: string;
  source?: string;
}

/**
 * Mutable singleton on purpose: `triggerKillswitch` flips the flag in place so every module
 * holding this binding observes the same live state. Read it at call time, never cache it.
 */
export const killswitchState: KillswitchState = {
  isTriggered: false,
};

export function triggerKillswitch(reason = 'Emergencia', source = 'IPC'): boolean {
  killswitchState.isTriggered = true;
  killswitchState.timestamp = Date.now();
  killswitchState.reason = reason;
  killswitchState.source = source;
  return true;
}

/**
 * Clears the kill-switch and its metadata. Intended for main-process teardown and for tests,
 * which share the module-level state within a worker. Production code never disarms the
 * kill-switch; recovery is an operator decision.
 */
export function resetKillswitch(): void {
  killswitchState.isTriggered = false;
  delete killswitchState.timestamp;
  delete killswitchState.reason;
  delete killswitchState.source;
}
