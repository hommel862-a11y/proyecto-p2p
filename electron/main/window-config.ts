import type { WebPreferences } from 'electron';

/**
 * Security-hardened BrowserWindow preferences (design #301, Decision 3).
 * These flags are asserted by `window-config.spec.ts` and consumed by
 * `main/index.ts`. They MUST NOT be weakened; the preload relies on
 * contextIsolation + nodeIntegration:false + sandbox to stay safe.
 */
export const SECURE_WEB_PREFERENCES: WebPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
};
