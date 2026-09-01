import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { Guide } from './guide';

describe('Guide', () => {
  let fixture: ComponentFixture<Guide>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [Guide] });
    fixture = TestBed.createComponent(Guide);
    fixture.detectChanges();
  });

  it('renders the usage-guide module', () => {
    expect(fixture.nativeElement.textContent).toContain('Guía de uso');
    expect(fixture.nativeElement.textContent).toContain('¿Qué es P2P Decisor?');
  });

  it('documents each feature module', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Monitor de Spread');
    expect(text).toContain('Calculadora de Ingresos');
    expect(text).toContain('Registro de Operaciones');
    expect(text).toContain('Reglas de Riesgo');
    expect(text).toContain('Estadísticas');
  });

  it('explains the manual/no-API nature of the tool', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('no se conecta a Binance');
    expect(text).toContain('no opera por ti');
  });

  it('includes backup guidance', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Respaldo de datos');
    expect(text).toContain('exportar');
  });
});
