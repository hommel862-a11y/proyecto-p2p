import type { ElectronAPI } from '../shared/types';

// Minimal, trusted subset of ipcRenderer the bridge is allowed to use.
export type IpcInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

/**
 * Pure, framework-free builder for the renderer-facing API.
 * Kept free of any `electron` import so it is unit-testable under Vitest
 * (no native binary required) and so the security surface is auditable.
 */
export function createP2PApi(ipc: IpcInvoke): ElectronAPI {
  return {
    getVersion: () => ipc('app:get-version') as Promise<string>,
    fetchBinanceP2p: (params) => ipc('p2p:fetch-binance', params) as Promise<unknown>,
  };
}

// Single source of truth for the exact method names the bridge exposes.
// Used by both the preload guard and the test to prove the surface is narrow.
export const EXPOSED_API_KEYS = ['getVersion', 'fetchBinanceP2p'] as const;

// The channels the bridge is permitted to forward. Anything else must be
// rejected so no arbitrary channel ever crosses the boundary.
export const ALLOWED_CHANNELS = ['app:get-version', 'p2p:fetch-binance'] as const;

