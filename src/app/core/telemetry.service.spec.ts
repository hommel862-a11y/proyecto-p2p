import { TestBed } from '@angular/core/testing';
import { TelemetryService } from './telemetry.service';

describe('TelemetryService', () => {
  let service: TelemetryService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TelemetryService);
  });

  afterEach(() => {
    service.ngOnDestroy();
  });

  it('should initialize with default optimal telemetry', () => {
    expect(service).toBeTruthy();
    const t = service.telemetry();
    expect(t.overallStatus).toBeDefined();
    expect(t.ipcMs).toBeGreaterThanOrEqual(1);
    expect(t.dbMs).toBeGreaterThanOrEqual(1);
    expect(t.p2pMs).toBeGreaterThanOrEqual(1);
  });

  it('should refresh telemetry and return a snapshot', async () => {
    const snapshot = await service.refresh();
    expect(snapshot).toBeDefined();
    expect(snapshot.ipcMs).toBeGreaterThan(0);
    expect(snapshot.dbMs).toBeGreaterThan(0);
    expect(snapshot.p2pMs).toBeGreaterThan(0);
    expect(['optimal', 'moderate', 'degraded']).toContain(snapshot.overallStatus);
  });
});
