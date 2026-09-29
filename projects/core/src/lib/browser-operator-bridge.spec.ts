import { describe, it, expect } from 'vitest';
import {
  compileBrowserOperatorTask,
  type BrowserOperatorTaskInput,
} from './browser-operator-bridge';

describe('BrowserOperatorBridge Engine', () => {
  it('compiles an automated task for Simly reference verification', () => {
    const input: BrowserOperatorTaskInput = {
      targetSite: 'SIMLY',
      action: 'VERIFY_TRANSFER_REFERENCE',
      referenceToVerify: 'SIM-998811',
    };

    const task = compileBrowserOperatorTask(input);
    expect(task.targetSite).toBe('SIMLY');
    expect(task.portalUrl).toContain('simly.io');
    expect(task.steps.length).toBeGreaterThanOrEqual(3);
    expect(task.securityProfile.stealthFingerprintEnabled).toBe(true);
    expect(task.steps[2].selectorDescription).toContain('SIM-998811');
  });

  it('compiles statement download task for Banesco Panamá', () => {
    const input: BrowserOperatorTaskInput = {
      targetSite: 'BANESCO_PANAMA',
      action: 'DOWNLOAD_ACCOUNT_STATEMENT',
      startDateIso: '2026-09-01',
      endDateIso: '2026-09-28',
    };

    const task = compileBrowserOperatorTask(input);
    expect(task.targetSite).toBe('BANESCO_PANAMA');
    expect(task.steps[2].action).toBe('DOWNLOAD_FILE');
  });
});
