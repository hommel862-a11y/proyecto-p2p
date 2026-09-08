/**
 * Shared storage keys (framework-agnostic).
 * Centralizes magic string keys so features reference one constant instead of
 * hardcoding identical values in several places.
 */

/** Primary key under which the operation ledger is persisted. */
export const OPS_KEY = 'p2p.operations';
