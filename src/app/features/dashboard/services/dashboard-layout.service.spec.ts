import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { P2P_STORAGE } from '../../../core/storage';
import { MemoryStorage } from '../../../core/memory-storage';
import {
  DEFAULT_SECTION_ORDER,
  DEFAULT_WORKFLOW_RAIL_ORDER,
  DashboardLayoutService,
} from './dashboard-layout.service';

describe('DashboardLayoutService', () => {
  let mem: MemoryStorage;

  beforeEach(() => {
    mem = new MemoryStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: P2P_STORAGE, useValue: mem }],
    });
  });

  it('initializes with default section and workflow rail orders', () => {
    const service = TestBed.inject(DashboardLayoutService);
    expect(service.sectionOrder()).toEqual(DEFAULT_SECTION_ORDER);
    expect(service.workflowRailOrder()).toEqual(DEFAULT_WORKFLOW_RAIL_ORDER);
    expect(service.organizeMode()).toBe(false);
  });

  it('reorders sections and persists layout in StorageService', () => {
    const service = TestBed.inject(DashboardLayoutService);
    service.moveSection('sankey', 'kpis');

    expect(service.sectionOrder()[0]).toBe('sankey');
    expect(service.sectionOrder()).toContain('kpis');

    // Re-instantiate via fresh TestBed to confirm persistence
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: P2P_STORAGE, useValue: mem }],
    });
    const rehydrated = TestBed.inject(DashboardLayoutService);
    expect(rehydrated.sectionOrder()[0]).toBe('sankey');
  });

  it('reorders workflow rail nodes and resets back to defaults', () => {
    const service = TestBed.inject(DashboardLayoutService);
    service.moveRailNode('BINANCE_SPOT', 'BANESCO');
    expect(service.workflowRailOrder()[0]).toBe('BINANCE_SPOT');

    service.resetLayout();
    expect(service.sectionOrder()).toEqual(DEFAULT_SECTION_ORDER);
    expect(service.workflowRailOrder()).toEqual(DEFAULT_WORKFLOW_RAIL_ORDER);
  });
});
