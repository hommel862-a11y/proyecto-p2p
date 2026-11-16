import { Injectable, inject, signal } from '@angular/core';
import { StorageService } from '../../../core/storage';

export type DashboardSectionId =
  | 'kpis'
  | 'mesa-bcv'
  | 'tactical'
  | 'sankey'
  | 'treasury'
  | 'intelligence'
  | 'performance';

export type WorkflowRailNodeId =
  | 'BANESCO'
  | 'PAGO_MOVIL'
  | 'PROVINCIAL'
  | 'MERCANTIL'
  | 'BINANCE_SPOT';

export const DEFAULT_SECTION_ORDER: readonly DashboardSectionId[] = [
  'kpis',
  'mesa-bcv',
  'tactical',
  'sankey',
  'treasury',
  'intelligence',
  'performance',
];

export const DEFAULT_WORKFLOW_RAIL_ORDER: readonly WorkflowRailNodeId[] = [
  'BANESCO',
  'PAGO_MOVIL',
  'PROVINCIAL',
  'MERCANTIL',
  'BINANCE_SPOT',
];

interface PersistedSpatialLayout {
  sectionOrder: DashboardSectionId[];
  workflowRailOrder: WorkflowRailNodeId[];
}

const LAYOUT_STORAGE_KEY = 'p2p.dashboard.spatialLayout.v1';

/** Reorder an item before/to the target item's index while keeping the remaining items intact. */
function reorderItems<T>(items: readonly T[], fromId: T, toId: T): T[] {
  if (fromId === toId) return [...items];
  const fromIdx = items.indexOf(fromId);
  const toIdx = items.indexOf(toId);
  if (fromIdx === -1 || toIdx === -1) return [...items];

  const next = [...items];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

/** Merge persisted IDs with defaults so schema updates never drop or duplicate items. */
function sanitizeOrder<T extends string>(saved: unknown, defaults: readonly T[]): T[] {
  if (!Array.isArray(saved)) return [...defaults];
  const validSet = new Set<T>(defaults);
  const seen = new Set<T>();
  const result: T[] = [];

  for (const item of saved) {
    if (typeof item === 'string' && validSet.has(item as T) && !seen.has(item as T)) {
      seen.add(item as T);
      result.push(item as T);
    }
  }

  for (const def of defaults) {
    if (!seen.has(def)) {
      result.push(def);
    }
  }
  return result;
}

/**
 * Local signal store for customizable dashboard section order and draggable Sankey workflow nodes.
 * Persists strictly in client StorageService without mutating backend/SQLite state.
 */
@Injectable({ providedIn: 'root' })
export class DashboardLayoutService {
  private readonly storage = inject(StorageService);

  readonly organizeMode = signal<boolean>(false);
  readonly sectionOrder = signal<DashboardSectionId[]>([...DEFAULT_SECTION_ORDER]);
  readonly workflowRailOrder = signal<WorkflowRailNodeId[]>([...DEFAULT_WORKFLOW_RAIL_ORDER]);

  constructor() {
    this.hydrate();
  }

  toggleOrganizeMode(): void {
    this.organizeMode.update((v) => !v);
  }

  moveSection(fromId: DashboardSectionId, toId: DashboardSectionId): void {
    const next = reorderItems(this.sectionOrder(), fromId, toId);
    this.sectionOrder.set(next);
    this.persist();
  }

  moveRailNode(fromId: WorkflowRailNodeId, toId: WorkflowRailNodeId): void {
    const next = reorderItems(this.workflowRailOrder(), fromId, toId);
    this.workflowRailOrder.set(next);
    this.persist();
  }

  resetLayout(): void {
    this.sectionOrder.set([...DEFAULT_SECTION_ORDER]);
    this.workflowRailOrder.set([...DEFAULT_WORKFLOW_RAIL_ORDER]);
    this.storage.remove(LAYOUT_STORAGE_KEY);
  }

  private hydrate(): void {
    const saved = this.storage.get<Partial<PersistedSpatialLayout>>(LAYOUT_STORAGE_KEY);
    if (!saved) return;
    this.sectionOrder.set(sanitizeOrder(saved.sectionOrder, DEFAULT_SECTION_ORDER));
    this.workflowRailOrder.set(sanitizeOrder(saved.workflowRailOrder, DEFAULT_WORKFLOW_RAIL_ORDER));
  }

  private persist(): void {
    const payload: PersistedSpatialLayout = {
      sectionOrder: this.sectionOrder(),
      workflowRailOrder: this.workflowRailOrder(),
    };
    this.storage.set(LAYOUT_STORAGE_KEY, payload);
  }
}
