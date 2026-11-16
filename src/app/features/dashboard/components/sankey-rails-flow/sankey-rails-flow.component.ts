import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SpatialTilt3dDirective } from '../../../../shared/ui/spatial-tilt-3d.directive';
import {
  DEFAULT_WORKFLOW_RAIL_ORDER,
  DashboardLayoutService,
  WorkflowRailNodeId,
} from '../../services/dashboard-layout.service';

export type SankeyRailHealth = 'optimal' | 'warn' | 'danger';

export interface SankeyRailNodeDto {
  id: WorkflowRailNodeId;
  label: string;
  balanceVes: number;
  consumedPct: number;
  statusLabel: string;
  health: SankeyRailHealth;
  bankNameForOperate?: string;
}

export interface SankeyStreamGeometry {
  railId: WorkflowRailNodeId;
  path: string;
  strokeWidth: number;
  gradientId: string;
  color: string;
  pulseDelay: string;
}

const HEALTH_COLORS: Record<SankeyRailHealth, string> = {
  optimal: 'var(--accent, #2fd08f)',
  warn: 'var(--warn, #f5b84c)',
  danger: 'var(--danger, #ff5f6d)',
};

@Component({
  selector: 'app-sankey-rails-flow',
  standalone: true,
  imports: [CommonModule, SpatialTilt3dDirective],
  templateUrl: './sankey-rails-flow.component.html',
  styleUrls: ['./sankey-rails-flow.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SankeyRailsFlowComponent {
  protected readonly layoutService = inject(DashboardLayoutService);

  readonly rails = input<readonly SankeyRailNodeDto[]>([]);
  readonly netProfitUsdt = input<number>(0);
  readonly netProfitVes = input<number>(0);
  readonly roiPct = input<number>(0);

  readonly operateRail = output<string>();
  readonly injectLiquidity = output<void>();

  readonly activeRailId = signal<WorkflowRailNodeId | null>(null);
  readonly draggedRailId = signal<WorkflowRailNodeId | null>(null);
  readonly dragOverRailId = signal<WorkflowRailNodeId | null>(null);

  /**
   * Reorders input rails based on layoutService.workflowRailOrder().
   * Any rail not in workflowRailOrder is preserved at the end.
   */
  readonly orderedRails = computed<readonly SankeyRailNodeDto[]>(() => {
    const list = this.rails();
    if (!list || list.length === 0) return [];

    const order = this.layoutService.workflowRailOrder();
    const map = new Map<WorkflowRailNodeId, SankeyRailNodeDto>();
    list.forEach((r) => map.set(r.id, r));

    const result: SankeyRailNodeDto[] = [];
    const used = new Set<WorkflowRailNodeId>();

    for (const id of order) {
      const match = map.get(id);
      if (match) {
        result.push(match);
        used.add(id);
      }
    }

    for (const r of list) {
      if (!used.has(r.id)) {
        result.push(r);
      }
    }

    return result;
  });

  /**
   * Identifies whether the current rail order differs from default.
   */
  readonly isCustomOrder = computed<boolean>(() => {
    const current = this.layoutService.workflowRailOrder();
    if (current.length !== DEFAULT_WORKFLOW_RAIL_ORDER.length) return true;
    return current.some((id, idx) => id !== DEFAULT_WORKFLOW_RAIL_ORDER[idx]);
  });

  /**
   * The currently active/focused rail node (if any).
   */
  readonly activeRail = computed<SankeyRailNodeDto | undefined>(() => {
    const id = this.activeRailId();
    if (!id) return undefined;
    return this.rails().find((r) => r.id === id);
  });

  /**
   * Computes cubic Bezier Sankey streams (M x1,y1 C cx1,y1 cx2,y2 x2,y2)
   * connecting each rail node from the left to the Profit Neto orbital ring on the right.
   */
  readonly sankeyStreams = computed<readonly SankeyStreamGeometry[]>(() => {
    const ordered = this.orderedRails();
    const count = ordered.length;
    if (count === 0) return [];

    const svgHeight = 300;
    const x1 = 0;
    const x2 = 420;
    const yTargetCenter = svgHeight / 2;

    const balances = ordered.map((r) => Math.max(0, r.balanceVes));
    const maxBalance = Math.max(...balances, 1);

    const startYMin = 28;
    const startYMax = svgHeight - 28;
    const usableHeight = startYMax - startYMin;

    return ordered.map((rail, index) => {
      const y1 =
        count === 1
          ? yTargetCenter
          : startYMin + (index / (count - 1)) * usableHeight;

      // Slight vertical spread at the funnel mouth entering the orbital ring
      const y2 =
        count === 1
          ? yTargetCenter
          : yTargetCenter + (index - (count - 1) / 2) * 8;

      const cx1 = x1 + (x2 - x1) * 0.44;
      const cx2 = x2 - (x2 - x1) * 0.44;

      const path = `M ${x1.toFixed(1)},${y1.toFixed(1)} C ${cx1.toFixed(1)},${y1.toFixed(1)} ${cx2.toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;

      // Zero-balance rails receive a clean 2px hairline stream (never NaN/0)
      const ratio = Math.max(0, rail.balanceVes) / maxBalance;
      const strokeWidth = Number((2 + ratio * 14).toFixed(1));

      return {
        railId: rail.id,
        path,
        strokeWidth,
        gradientId: `stream-grad-${rail.id}`,
        color: HEALTH_COLORS[rail.health] || 'var(--gold, #d8b45c)',
        pulseDelay: `${(index * 0.35).toFixed(2)}s`,
      };
    });
  });

  selectRail(railId: WorkflowRailNodeId): void {
    this.activeRailId.update((current) => (current === railId ? null : railId));
  }

  closePopover(): void {
    this.activeRailId.set(null);
  }

  moveRailUp(railId: WorkflowRailNodeId): void {
    const order = this.layoutService.workflowRailOrder();
    const index = order.indexOf(railId);
    if (index > 0) {
      this.layoutService.moveRailNode(railId, order[index - 1]);
    }
  }

  moveRailDown(railId: WorkflowRailNodeId): void {
    const order = this.layoutService.workflowRailOrder();
    const index = order.indexOf(railId);
    if (index >= 0 && index < order.length - 1) {
      this.layoutService.moveRailNode(railId, order[index + 1]);
    }
  }

  resetRailOrder(): void {
    const defaults = [...DEFAULT_WORKFLOW_RAIL_ORDER];
    for (let i = 0; i < defaults.length; i++) {
      const targetId = defaults[i];
      const currentAtI = this.layoutService.workflowRailOrder()[i];
      if (targetId !== currentAtI) {
        this.layoutService.moveRailNode(targetId, currentAtI);
      }
    }
  }

  onDragStart(event: DragEvent, railId: WorkflowRailNodeId): void {
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', railId);
      event.dataTransfer.effectAllowed = 'move';
    }
    this.draggedRailId.set(railId);
  }

  onDragOver(event: DragEvent, railId: WorkflowRailNodeId): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    if (this.dragOverRailId() !== railId) {
      this.dragOverRailId.set(railId);
    }
  }

  onDragLeave(event: DragEvent, railId: WorkflowRailNodeId): void {
    if (this.dragOverRailId() === railId) {
      this.dragOverRailId.set(null);
    }
  }

  onDrop(event: DragEvent, targetRailId: WorkflowRailNodeId): void {
    event.preventDefault();
    const fromId =
      (event.dataTransfer?.getData('text/plain') as WorkflowRailNodeId) ||
      this.draggedRailId();

    if (fromId && fromId !== targetRailId) {
      this.layoutService.moveRailNode(fromId, targetRailId);
    }

    this.draggedRailId.set(null);
    this.dragOverRailId.set(null);
  }

  onDragEnd(): void {
    this.draggedRailId.set(null);
    this.dragOverRailId.set(null);
  }

  onOperate(rail: SankeyRailNodeDto): void {
    this.operateRail.emit(rail.bankNameForOperate || rail.label);
  }

  onInject(): void {
    this.injectLiquidity.emit();
  }

  formatVes(value: number): string {
    return Math.round(value).toLocaleString('es-VE');
  }

  formatUsd(value: number): string {
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}
