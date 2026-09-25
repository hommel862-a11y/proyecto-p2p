import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { Guide } from './guide';

describe('Guide', () => {
  let fixture: ComponentFixture<Guide>;
  let component: Guide;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [Guide] });
    fixture = TestBed.createComponent(Guide);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the usage-guide module and intro tab by default', () => {
    expect(fixture.nativeElement.textContent).toContain('Guía de uso');
    expect(fixture.nativeElement.textContent).toContain('¿Qué es P2P Decisor?');
    expect(component.activeTab()).toBe('intro');
  });

  it('explains the manual/no-API nature of the tool in intro', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('no se conecta a Binance');
    expect(text).toContain('no opera por ti');
  });

  it('navigates to tools tab and documents each feature module', () => {
    component.setTab('tools');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Monitor de Spread');
    expect(text).toContain('Calculadora de Ingresos');
    expect(text).toContain('Registro de Operaciones');
    expect(text).toContain('Reglas de Riesgo');
    expect(text).toContain('Estadísticas');
  });

  it('navigates to swarm tab and explains AI agents', () => {
    component.setTab('swarm');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Agente Centinela');
    expect(text).toContain('Agente Estratega');
    expect(text).toContain('Oficial de Riesgo');
    expect(text).toContain('Auditor de Disputas');
  });

  it('navigates to mcp tab and explains MCP architecture', () => {
    component.setTab('mcp');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Model Context Protocol');
    expect(text).toContain('p2p-decisor');
  });

  it('navigates to security tab and details anti-triangulation, SUDEBAN rules and backup guidance', () => {
    component.setTab('security');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Blindaje y Seguridad Bancaria');
    expect(text).toContain('TRIANGULACIÓN');
    expect(text).toContain('SUDEBAN');
    expect(text).toContain('Respaldo de datos');
    expect(text).toContain('exportar');
  });

  it('navigates to workflow tab and displays tactical checklist', () => {
    component.setTab('workflow');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Checklist Operativo Paso a Paso');
    expect(text).toContain('La Rutina del Trader');
  });

  it('navigates to terms tab and displays sovereign privacy and risk policy', () => {
    component.setTab('terms');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Términos de Uso, Privacidad Soberana & Gestión de Riesgo');
    expect(text).toContain('Cero Telemetría');
    expect(text).toContain('Naturaleza Jurídica del Software');
  });
});
