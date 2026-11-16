import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { SpatialTilt3dDirective } from '../../../../shared/ui/spatial-tilt-3d.directive';

export const SWARM_AGENT_STATUS = {
  ONLINE: 'ONLINE',
  DEGRADED: 'DEGRADED',
  OFFLINE: 'OFFLINE',
} as const;

export type SwarmAgentStatus = (typeof SWARM_AGENT_STATUS)[keyof typeof SWARM_AGENT_STATUS];

export interface SwarmAgentNode {
  name: string;
  role: string;
  status: SwarmAgentStatus;
  lastPingMs: number;
  decisionsCount: number;
  icon: string;
  description: string;
}

export interface RadarOrbitNode {
  agent: SwarmAgentNode;
  svgX: number;
  svgY: number;
  leftPct: number;
  topPct: number;
  statusTone: 'online' | 'degraded' | 'offline';
}

const GAUGE_RADIUS = 96;
const GAUGE_CENTER_X = 130;
const GAUGE_CENTER_Y = 130;
const RADAR_VIEW_SIZE = 240;
const RADAR_CENTER = 120;

@Component({
  selector: 'app-l2-radar-gauge',
  standalone: true,
  imports: [DecimalPipe, SpatialTilt3dDirective],
  templateUrl: './l2-radar-gauge.component.html',
  styleUrl: './l2-radar-gauge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class L2RadarGaugeComponent {
  private static nextInstanceId = 0;

  readonly uid = ++L2RadarGaugeComponent.nextInstanceId;
  readonly gaugeArcLength = Math.PI * GAUGE_RADIUS;

  readonly pressureScore = input<number>(65);
  readonly pressureLabel = input<string>('ÓPTIMO');
  readonly spreadPct = input<number>(0);
  readonly bcvGapPct = input<number>(0);
  readonly isBcvWindowOpen = input<boolean>(false);
  readonly swarmAgents = input<readonly SwarmAgentNode[]>([]);

  readonly refreshSwarm = output<void>();
  readonly openRadar = output<void>();
  readonly openAgents = output<void>();

  readonly selectedAgent = signal<SwarmAgentNode | null>(null);

  readonly clampedScore = computed<number>(() => {
    const raw = this.pressureScore();
    if (!Number.isFinite(raw)) {
      return 0;
    }
    return Math.round(Math.max(0, Math.min(100, raw)));
  });

  readonly gaugeDashOffset = computed<number>(
    () => this.gaugeArcLength * (1 - this.clampedScore() / 100),
  );

  readonly needleDeg = computed<number>(() => (this.clampedScore() / 100) * 180 - 90);

  readonly gaugeTip = computed<{ x: number; y: number }>(() => {
    const alpha = (1 - this.clampedScore() / 100) * Math.PI;
    return {
      x: Number((GAUGE_CENTER_X + GAUGE_RADIUS * Math.cos(alpha)).toFixed(2)),
      y: Number((GAUGE_CENTER_Y - GAUGE_RADIUS * Math.sin(alpha)).toFixed(2)),
    };
  });

  readonly pressureTone = computed<'optimal' | 'caution' | 'danger'>(() => {
    const label = this.pressureLabel().toUpperCase();
    if (label.includes('RIESGO') || label.includes('CRÍT') || label.includes('CRIT')) {
      return 'danger';
    }
    if (label.includes('CAUTELA') || label.includes('ALERT')) {
      return 'caution';
    }
    const score = this.clampedScore();
    if (score < 40) {
      return 'danger';
    }
    if (score < 68) {
      return 'caution';
    }
    return 'optimal';
  });

  readonly orbitNodes = computed<readonly RadarOrbitNode[]>(() => {
    const agents = this.swarmAgents();
    const count = agents.length;
    if (count === 0) {
      return [];
    }

    return agents.map((agent, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
      const radius = count > 4 && index % 2 === 1 ? 92 : 78;
      const svgX = Number((RADAR_CENTER + radius * Math.cos(angle)).toFixed(2));
      const svgY = Number((RADAR_CENTER + radius * Math.sin(angle)).toFixed(2));

      return {
        agent,
        svgX,
        svgY,
        leftPct: Number(((svgX / RADAR_VIEW_SIZE) * 100).toFixed(2)),
        topPct: Number(((svgY / RADAR_VIEW_SIZE) * 100).toFixed(2)),
        statusTone: this.resolveStatusTone(agent.status),
      };
    });
  });

  readonly activeAgent = computed<SwarmAgentNode | null>(() => {
    const current = this.selectedAgent();
    if (!current) {
      return null;
    }
    return this.swarmAgents().find((item) => item.name === current.name) ?? current;
  });

  readonly onlineCount = computed<number>(
    () => this.swarmAgents().filter((a) => a.status === SWARM_AGENT_STATUS.ONLINE).length,
  );

  readonly totalDecisions = computed<number>(() =>
    this.swarmAgents().reduce((acc, item) => acc + item.decisionsCount, 0),
  );

  selectAgent(agent: SwarmAgentNode): void {
    this.selectedAgent.set(agent);
  }

  onRefreshSwarm(): void {
    this.refreshSwarm.emit();
  }

  onOpenRadar(): void {
    this.openRadar.emit();
  }

  onOpenAgents(): void {
    this.openAgents.emit();
  }

  private resolveStatusTone(status: SwarmAgentStatus): 'online' | 'degraded' | 'offline' {
    switch (status) {
      case SWARM_AGENT_STATUS.ONLINE:
        return 'online';
      case SWARM_AGENT_STATUS.DEGRADED:
        return 'degraded';
      case SWARM_AGENT_STATUS.OFFLINE:
        return 'offline';
    }
  }
}
