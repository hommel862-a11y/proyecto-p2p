import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  L2RadarGaugeComponent,
  SWARM_AGENT_STATUS,
  type SwarmAgentNode,
} from './l2-radar-gauge.component';

const MOCK_AGENTS: readonly SwarmAgentNode[] = [
  {
    name: 'Sentinel-L2',
    role: 'OrderBook Imbalance Guard',
    status: SWARM_AGENT_STATUS.ONLINE,
    lastPingMs: 28,
    decisionsCount: 142,
    icon: '🛰️',
    description: 'Monitorea muros de liquidez y detecta spoofing en Binance P2P.',
  },
  {
    name: 'BCV-Macro',
    role: 'Rate Gap & Intervention Analyst',
    status: SWARM_AGENT_STATUS.DEGRADED,
    lastPingMs: 184,
    decisionsCount: 67,
    icon: '🏦',
    description: 'Evalúa brecha oficial/paralelo y ventanas de intervención cambiaria.',
  },
  {
    name: 'Arb-Executor',
    role: 'Spread Capture Router',
    status: SWARM_AGENT_STATUS.OFFLINE,
    lastPingMs: 0,
    decisionsCount: 19,
    icon: '⚡',
    description: 'Calcula rutas óptimas de rebalanceo entre rieles bancarios.',
  },
];

@Component({
  standalone: true,
  imports: [L2RadarGaugeComponent],
  template: `
    <app-l2-radar-gauge
      [pressureScore]="pressureScore()"
      [pressureLabel]="pressureLabel()"
      [spreadPct]="spreadPct()"
      [bcvGapPct]="bcvGapPct()"
      [isBcvWindowOpen]="isBcvWindowOpen()"
      [swarmAgents]="swarmAgents()"
      (refreshSwarm)="refreshCount.set(refreshCount() + 1)"
      (openRadar)="openRadarCount.set(openRadarCount() + 1)"
      (openAgents)="openAgentsCount.set(openAgentsCount() + 1)"
    />
  `,
})
class TestHostComponent {
  readonly pressureScore = signal<number>(78);
  readonly pressureLabel = signal<string>('ÓPTIMO');
  readonly spreadPct = signal<number>(1.45);
  readonly bcvGapPct = signal<number>(12.8);
  readonly isBcvWindowOpen = signal<boolean>(true);
  readonly swarmAgents = signal<readonly SwarmAgentNode[]>(MOCK_AGENTS);

  readonly refreshCount = signal<number>(0);
  readonly openRadarCount = signal<number>(0);
  readonly openAgentsCount = signal<number>(0);
}

describe('L2RadarGaugeComponent', () => {
  it('creates with default inputs and applies 3D spatial depth layers', async () => {
    await TestBed.configureTestingModule({
      imports: [L2RadarGaugeComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(L2RadarGaugeComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const root = fixture.nativeElement as HTMLElement;

    expect(component).toBeTruthy();
    expect(component.pressureScore()).toBe(65);
    expect(component.pressureLabel()).toBe('ÓPTIMO');
    expect(component.spreadPct()).toBe(0);
    expect(component.bcvGapPct()).toBe(0);
    expect(component.isBcvWindowOpen()).toBe(false);
    expect(component.swarmAgents()).toEqual([]);

    expect(root.querySelectorAll('.spatial-tilt-3d').length).toBeGreaterThanOrEqual(1);
    expect(root.querySelector('.spatial-z-mid')).not.toBeNull();
    expect(root.querySelector('.spatial-z-float')).not.toBeNull();
    expect(root.textContent).toContain('65');
  });

  it('renders semicircular gauge SVG, clamps extreme scores, and displays L2 & BCV pills', async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('svg.l2-gauge-svg path.gauge-progress')).not.toBeNull();
    expect(el.querySelector('svg.l2-gauge-svg .gauge-needle')).not.toBeNull();
    expect(el.querySelector('.gauge-score-value.font-mono')?.textContent).toContain('78');
    expect(el.textContent).toContain('ÓPTIMO');
    expect(el.textContent).toContain('Spread L2');
    expect(el.textContent).toContain('1.45%');
    expect(el.textContent).toContain('Brecha BCV');
    expect(el.textContent).toContain('12.80%');
    expect(el.textContent).toContain('Ventana BCV Abierta');

    // Clamp out-of-bounds score & update label / window state
    fixture.componentInstance.pressureScore.set(145);
    fixture.componentInstance.pressureLabel.set('RIESGO BCV');
    fixture.componentInstance.isBcvWindowOpen.set(false);
    fixture.detectChanges();

    expect(el.querySelector('.gauge-score-value.font-mono')?.textContent).toContain('100');
    expect(el.textContent).toContain('RIESGO BCV');
    expect(el.textContent).toContain('Ventana Cerrada');

    fixture.componentInstance.pressureScore.set(-20);
    fixture.detectChanges();
    expect(el.querySelector('.gauge-score-value.font-mono')?.textContent).toContain('0');
  });

  it('renders Swarm orbital radar nodes and elevates selectedAgent on click or hover', async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const gaugeComp = fixture.debugElement.children[0]
      .componentInstance as L2RadarGaugeComponent;

    expect(el.querySelector('svg.swarm-radar-svg .radar-sweep')).not.toBeNull();
    const blips = el.querySelectorAll('button.agent-blip');
    expect(blips.length).toBe(3);

    // Click second agent node
    (blips[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(gaugeComp.selectedAgent()?.name).toBe('BCV-Macro');
    expect(blips[1].classList.contains('is-selected')).toBe(true);

    const detailCard = el.querySelector('.swarm-detail-card');
    expect(detailCard?.textContent).toContain('BCV-Macro');
    expect(detailCard?.textContent).toContain('Rate Gap & Intervention Analyst');
    expect(detailCard?.textContent).toContain('184 ms');
    expect(detailCard?.textContent).toContain('67');
    expect(detailCard?.textContent).toContain(
      'Evalúa brecha oficial/paralelo y ventanas de intervención cambiaria.',
    );

    // Hover third agent node
    blips[2].dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();

    expect(gaugeComp.selectedAgent()?.name).toBe('Arb-Executor');
    expect(blips[2].classList.contains('is-selected')).toBe(true);
    expect(el.querySelector('.swarm-detail-card')?.textContent).toContain('Arb-Executor');
  });

  it('emits refreshSwarm, openRadar, and openAgents on user interactions', async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const host = fixture.componentInstance;

    const refreshBtn = el.querySelector('button.btn-swarm-diagnose') as HTMLButtonElement;
    const openRadarBtn = el.querySelector('button.btn-open-radar') as HTMLButtonElement;
    const openAgentsBtn = el.querySelector('button.btn-open-agents') as HTMLButtonElement;

    expect(refreshBtn?.textContent).toContain('Ejecutar Diagnóstico Swarm');
    expect(openRadarBtn).not.toBeNull();
    expect(openAgentsBtn).not.toBeNull();

    refreshBtn.click();
    openRadarBtn.click();
    openAgentsBtn.click();
    fixture.detectChanges();

    expect(host.refreshCount()).toBe(1);
    expect(host.openRadarCount()).toBe(1);
    expect(host.openAgentsCount()).toBe(1);
  });
});
