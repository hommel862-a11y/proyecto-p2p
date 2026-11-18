import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { CrmAuditSystemComponent } from './crm-audit-system.component';
import type { ActivityLogEntry, CrmStorageHealthTelemetry } from '../../crm-ui.models';

describe('CrmAuditSystemComponent', () => {
  let fixture: ComponentFixture<CrmAuditSystemComponent>;
  let component: CrmAuditSystemComponent;

  const sampleActivities: ActivityLogEntry[] = [
    {
      id: 'act-1',
      scope: 'P2P_DESK',
      timestamp: 1_700_000_000_000,
      type: 'DEAL_CLOSED',
      description: 'Trato #DL-101 liquidado en Banesco',
      amountUsdt: 500,
      referenceId: '99887766',
    },
    {
      id: 'act-2',
      scope: 'P2P_DESK',
      timestamp: 1_700_000_100_000,
      type: 'BANK_RECONCILED',
      description: 'Cuadre real Mercantil',
      amountUsdt: 0,
    },
  ];

  const sampleHealth: CrmStorageHealthTelemetry = {
    postgresStatus: 'CONNECTED',
    postgresDetail: 'PostgreSQL 17 + pgvector HNSW (12 ms)',
    sqliteStatus: 'SYNCED',
    sqliteDetail: 'SQLite Mirror sincronizado',
    gatewayStatus: 'CONNECTED',
    gatewayDetail: 'SSE activo en :3030',
    dailyBudgetUsedUsd: 4.5,
    dailyBudgetCapUsd: 10,
  };

  const setup = (
    overrides: Partial<{
      smsInput: string;
      parsedSmsPreview: { bank?: string; reference?: string; amount?: number; confidence?: number } | null;
      refVerifyInput: string;
      refVerifyResult: { checked: boolean; isUnique: boolean; message: string } | null;
      auditSearch: string;
      auditTypeFilter: string;
    }> = {},
  ) => {
    TestBed.configureTestingModule({
      imports: [CrmAuditSystemComponent],
    });
    fixture = TestBed.createComponent(CrmAuditSystemComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('activeSilo', 'P2P_DESK');
    fixture.componentRef.setInput('activities', sampleActivities);
    fixture.componentRef.setInput('storageHealth', sampleHealth);
    fixture.componentRef.setInput('smsInput', overrides.smsInput ?? '');
    fixture.componentRef.setInput('parsedSmsPreview', overrides.parsedSmsPreview ?? null);
    fixture.componentRef.setInput('refVerifyInput', overrides.refVerifyInput ?? '');
    fixture.componentRef.setInput('refVerifyResult', overrides.refVerifyResult ?? null);
    fixture.componentRef.setInput('auditSearch', overrides.auditSearch ?? '');
    fixture.componentRef.setInput('auditTypeFilter', overrides.auditTypeFilter ?? 'ALL');
    fixture.componentRef.setInput('liveReplacementRate', 84.5);
    fixture.componentRef.setInput('importStrategy', 'MERGE');
    fixture.componentRef.setInput('csvTarget', 'CONTACTS');

    fixture.detectChanges();
    return { fixture, component };
  };

  it('renders 2x2 Bento layout with PostgreSQL 17 + pgvector telemetry & segmented LED budget meter', () => {
    const { fixture } = setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('[data-testid="audit-bento-quadrant"]').length).toBe(4);
    expect(el.textContent).toContain('PostgreSQL 17 + pgvector');
    expect(el.textContent).toContain('$4.50 / $10.00');
    const ledSegments = el.querySelectorAll('[data-testid="budget-led-segment"]');
    expect(ledSegments.length).toBeGreaterThanOrEqual(10);
  });

  it('renders UNIQUE CHECK PASS and COLLISION DETECTED banners based on refVerifyResult', () => {
    const { fixture } = setup({
      refVerifyInput: '11223344',
      refVerifyResult: {
        checked: true,
        isUnique: true,
        message: 'Referencia libre en PostgreSQL y libro local.',
      },
    });
    const passBanner = fixture.nativeElement.querySelector(
      '[data-testid="ref-verify-banner"]',
    ) as HTMLElement;
    expect(passBanner.textContent).toContain('UNIQUE CHECK PASS');

    fixture.componentRef.setInput('refVerifyResult', {
      checked: true,
      isUnique: false,
      message: 'Detectada en trato #DL-101.',
    });
    fixture.detectChanges();
    expect(passBanner.textContent).toContain('COLLISION DETECTED');
  });

  it('emits smsInputChange, extractSms, refVerifyInputChange, verifyReference and renders SMS preview', () => {
    const { fixture, component } = setup({
      smsInput: 'Banesco Pago Movil Bs 42.500,00 Ref 99887766',
      parsedSmsPreview: {
        bank: 'Banesco',
        reference: '99887766',
        amount: 42500,
        confidence: 0.96,
      },
    });

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="sms-preview-pill"]')?.textContent).toContain('99887766');

    let extracted = false;
    let verified = false;
    component.extractSms.subscribe(() => (extracted = true));
    component.verifyReference.subscribe(() => (verified = true));

    (el.querySelector('[data-testid="btn-extract-sms"]') as HTMLButtonElement).click();
    (el.querySelector('[data-testid="btn-verify-ref"]') as HTMLButtonElement).click();

    expect(extracted).toBe(true);
    expect(verified).toBe(true);
  });

  it('filters Audit Log hairline table by auditSearch & auditTypeFilter and emits changes', () => {
    const { fixture, component } = setup({
      auditSearch: '99887766',
      auditTypeFilter: 'DEAL_CLOSED',
    });
    const rows = fixture.nativeElement.querySelectorAll('[data-testid="audit-log-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('#DL-101');

    let searched = '';
    let filtered = '';
    component.auditSearchChange.subscribe((q) => (searched = q));
    component.auditTypeFilterChange.subscribe((t) => (filtered = t));

    const searchInput = fixture.nativeElement.querySelector(
      '[data-testid="audit-search-input"]',
    ) as HTMLInputElement;
    searchInput.value = 'Mercantil';
    searchInput.dispatchEvent(new Event('input'));

    const typeSelect = fixture.nativeElement.querySelector(
      '[data-testid="audit-type-select"]',
    ) as HTMLSelectElement;
    typeSelect.value = 'BANK_RECONCILED';
    typeSelect.dispatchEvent(new Event('change'));

    expect(searched).toBe('Mercantil');
    expect(filtered).toBe('BANK_RECONCILED');
  });

  it('emits 3-silo switch, rate, strategy, CSV target, exports, and JSON/CSV file imports', () => {
    const { fixture, component } = setup();
    const el = fixture.nativeElement as HTMLElement;

    const silos: string[] = [];
    let rate = 0;
    let strategy = '';
    let csvTarget = '';
    let exportedJson = false;
    let exportedCsv = false;
    let importedJson: File | null = null;
    let importedCsv: File | null = null;

    component.siloChange.subscribe((s) => silos.push(s));
    component.replacementRateChange.subscribe((r) => (rate = r));
    component.importStrategyChange.subscribe((st) => (strategy = st));
    component.csvTargetChange.subscribe((t) => (csvTarget = t));
    component.exportJson.subscribe(() => (exportedJson = true));
    component.exportCsv.subscribe(() => (exportedCsv = true));
    component.importJsonFile.subscribe((f) => (importedJson = f));
    component.importCsvFile.subscribe((f) => (importedCsv = f));

    const siloButtons = el.querySelectorAll(
      '[data-testid="audit-silo-btn"]',
    ) as NodeListOf<HTMLButtonElement>;
    expect(siloButtons.length).toBe(3);
    siloButtons[0].click();
    siloButtons[2].click();
    expect(silos).toEqual(['ARM_B2B', 'FINANCE_360']);

    const rateInput = el.querySelector('[data-testid="replacement-rate-input"]') as HTMLInputElement;
    rateInput.value = '88.2';
    rateInput.dispatchEvent(new Event('input'));
    expect(rate).toBe(88.2);

    const strategySelect = el.querySelector(
      '[data-testid="import-strategy-select"]',
    ) as HTMLSelectElement;
    strategySelect.value = 'REPLACE';
    strategySelect.dispatchEvent(new Event('change'));
    expect(strategy).toBe('REPLACE');

    const csvSelect = el.querySelector('[data-testid="csv-target-select"]') as HTMLSelectElement;
    csvSelect.value = 'BANKS';
    csvSelect.dispatchEvent(new Event('change'));
    expect(csvTarget).toBe('BANKS');

    (el.querySelector('[data-testid="btn-export-json"]') as HTMLButtonElement).click();
    (el.querySelector('[data-testid="btn-export-csv"]') as HTMLButtonElement).click();
    expect(exportedJson).toBe(true);
    expect(exportedCsv).toBe(true);

    const jsonFile = new File(['{}'], 'backup.json', { type: 'application/json' });
    const jsonInput = el.querySelector('[data-testid="import-json-input"]') as HTMLInputElement;
    Object.defineProperty(jsonInput, 'files', { value: [jsonFile] });
    jsonInput.dispatchEvent(new Event('change'));

    const csvFile = new File(['id,name'], 'contacts.csv', { type: 'text/csv' });
    const csvInput = el.querySelector('[data-testid="import-csv-input"]') as HTMLInputElement;
    Object.defineProperty(csvInput, 'files', { value: [csvFile] });
    csvInput.dispatchEvent(new Event('change'));

    expect(importedJson).toBe(jsonFile);
    expect(importedCsv).toBe(csvFile);
  });
});
