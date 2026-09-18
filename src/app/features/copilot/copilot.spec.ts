import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Copilot } from './copilot';

describe('Copilot', () => {
  let fixture: ComponentFixture<Copilot>;
  let component: Copilot;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Copilot],
    }).compileComponents();

    fixture = TestBed.createComponent(Copilot);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the copilot component', () => {
    expect(component).toBeTruthy();
    expect(component.activeTab()).toBe('chat');
  });

  it('should toggle sidebar correctly', () => {
    expect(component.sidebarCollapsed()).toBe(false);
    component.toggleSidebar();
    expect(component.sidebarCollapsed()).toBe(true);
    component.toggleSidebar();
    expect(component.sidebarCollapsed()).toBe(false);
  });

  it('should toggle kill switch state in treasury metrics', () => {
    expect(component.treasuryMetrics().killSwitchActive).toBe(false);
    component.triggerKillSwitch();
    expect(component.treasuryMetrics().killSwitchActive).toBe(true);
    expect(component.actionSuccessNotice()).toContain('KILL-SWITCH ACTIVADO');
    component.triggerKillSwitch();
    expect(component.treasuryMetrics().killSwitchActive).toBe(false);
    expect(component.actionSuccessNotice()).toContain('KILL-SWITCH DESACTIVADO');
  });

  it('should dispatch quick prompt for explicar_triangulacion', () => {
    const sendPromptSpy = vi
      .spyOn(component, 'sendPrompt')
      .mockImplementation(() => Promise.resolve());
    component.quickPrompt('explicar_triangulacion');
    expect(sendPromptSpy).toHaveBeenCalledWith(
      expect.stringContaining('Explicame en detalle cómo funciona la triangulación financiera'),
    );
  });

  it('should dispatch quick prompt for resumen_ejecutivo', () => {
    const sendPromptSpy = vi
      .spyOn(component, 'sendPrompt')
      .mockImplementation(() => Promise.resolve());
    component.quickPrompt('resumen_ejecutivo');
    expect(sendPromptSpy).toHaveBeenCalledWith(
      expect.stringContaining('Generá un resumen ejecutivo de la sesión actual de trading'),
    );
  });

  it('should dispatch quick prompt for riesgo_bcv', () => {
    const sendPromptSpy = vi
      .spyOn(component, 'sendPrompt')
      .mockImplementation(() => Promise.resolve());
    component.quickPrompt('riesgo_bcv');
    expect(sendPromptSpy).toHaveBeenCalledWith(
      expect.stringContaining('¿Cuál es el riesgo actual de intervención del BCV'),
    );
  });
});
