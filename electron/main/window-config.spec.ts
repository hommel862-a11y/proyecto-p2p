import { describe, it, expect } from 'vitest';
import { SECURE_WEB_PREFERENCES } from './window-config';

describe('Electron BrowserWindow security (design #301 D3)', () => {
  it('enforces contextIsolation and disables nodeIntegration', () => {
    expect(SECURE_WEB_PREFERENCES.contextIsolation).toBe(true);
    expect(SECURE_WEB_PREFERENCES.nodeIntegration).toBe(false);
    expect(SECURE_WEB_PREFERENCES.sandbox).toBe(true);
  });
});
