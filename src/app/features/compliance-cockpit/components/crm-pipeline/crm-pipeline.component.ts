import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import type {
  ArmApprovalQueueItem,
  ArmAutonomousFeedEvent,
  ArmCloserPreCallBriefing,
  ArmKanbanCardVm,
  ArmPipelineStageConfig,
  ArmReplayComparisonResult,
  ArmSandboxPersonaId,
  ArmWorkspaceId,
  PipelineDeal,
} from '../../crm-ui.models';

export const PIPELINE_MODES = {
  LEGACY_BOARD: 'LEGACY_BOARD',
  ARM_AUTOPILOT: 'ARM_AUTOPILOT',
} as const;

export type CrmPipelineMode = (typeof PIPELINE_MODES)[keyof typeof PIPELINE_MODES];

export interface PipelineKanbanColumnInput {
  readonly stage: string;
  readonly label: string;
  readonly deals: readonly PipelineDeal[];
  readonly totalVolumeUsdt: number;
}

interface FilterOption {
  readonly id: string;
  readonly label: string;
}

interface PersonaOption {
  readonly id: ArmSandboxPersonaId;
  readonly label: string;
}

const DEAL_FILTER_OPTIONS: readonly FilterOption[] = [
  { id: 'ALL', label: 'Todos' },
  { id: 'EXPIRED', label: 'Tasa Vencida' },
  { id: 'WITH_REF', label: 'Con Referencia' },
  { id: 'HIGH_VALUE', label: 'Alto Valor (+$500)' },
];

const SANDBOX_PERSONAS: readonly PersonaOption[] = [
  { id: 'SKEPTICAL_DISCOUNT_30', label: 'B2B Descuento 30%' },
  { id: 'URGENT_DECISION_MAKER', label: 'Decisor Urgente' },
  { id: 'P2P_SPOOFED_RECEIPT', label: 'P2P Recibo Alterado' },
  { id: 'PYME_SPLIT_PAYMENT', label: 'PyME Pago Parcial' },
];

const NEXT_STAGE_MAP: Record<string, string | null> = {
  STAGE_1_NEW: 'STAGE_2_TRANSIT',
  STAGE_2_TRANSIT: 'STAGE_3_VERIFY',
  STAGE_3_VERIFY: 'STAGE_4_CLOSED',
  STAGE_4_CLOSED: null,
};

const PREV_STAGE_MAP: Record<string, string | null> = {
  STAGE_1_NEW: null,
  STAGE_2_TRANSIT: 'STAGE_1_NEW',
  STAGE_3_VERIFY: 'STAGE_2_TRANSIT',
  STAGE_4_CLOSED: null,
};

const PRIMARY_ACTION_LABELS: Record<string, string> = {
  STAGE_1_NEW: 'En Tránsito',
  STAGE_2_TRANSIT: 'Verificar Ref',
  STAGE_3_VERIFY: 'Liquidar',
};

@Component({
  selector: 'app-crm-pipeline',
  standalone: true,
  imports: [],
  templateUrl: './crm-pipeline.component.html',
  styleUrl: './crm-pipeline.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.silo-b2b]': "activeSilo() === 'ARM_B2B'",
    '[class.silo-p2p]': "activeSilo() === 'P2P_DESK'",
    '[class.silo-360]': "activeSilo() === 'FINANCE_360'",
    '[class.privacy-active]': 'privacyMode()',
  },
})
export class CrmPipelineComponent {
  readonly activeSilo = input<ArmWorkspaceId>('P2P_DESK');
  readonly pipelineMode = input<CrmPipelineMode>('LEGACY_BOARD');
  readonly deals = input<PipelineDeal[]>([]);
  readonly kanbanColumns = input<PipelineKanbanColumnInput[]>([]);
  readonly armStages = input<ArmPipelineStageConfig[]>([]);
  readonly armCards = input<ArmKanbanCardVm[]>([]);
  readonly armApprovals = input<ArmApprovalQueueItem[]>([]);
  readonly armFeed = input<ArmAutonomousFeedEvent[]>([]);
  readonly armShadowCount = input<number>(0);
  readonly selectedArmCard = input<ArmKanbanCardVm | null>(null);
  readonly briefing = input<ArmCloserPreCallBriefing | null>(null);
  readonly replayResult = input<ArmReplayComparisonResult | null>(null);
  readonly selectedSandboxPersona = input<ArmSandboxPersonaId>('SKEPTICAL_DISCOUNT_30');
  readonly dealFilter = input<string>('ALL');
  readonly dealSearch = input<string>('');
  readonly compactView = input<boolean>(false);
  readonly editingApprovalId = input<string | null>(null);
  readonly editingApprovalText = input<string>('');
  readonly editingSaveAsExample = input<boolean>(false);
  readonly closerLeadName = input<string>('');
  readonly closerTranscript = input<string>('');
  readonly privacyMode = input<boolean>(false);

  readonly modeChange = output<CrmPipelineMode>();
  readonly filterChange = output<string>();
  readonly searchChange = output<string>();
  readonly compactToggle = output<void>();
  readonly newDeal = output<void>();
  readonly advanceDeal = output<{ dealId: string; targetStage: string }>();
  readonly settleDeal = output<string>();
  readonly deleteDeal = output<string>();
  readonly openDealChat = output<PipelineDeal>();
  readonly selectArmLead = output<string>();
  readonly moveArmStage = output<{ cardId: string; stageSlug: string }>();
  readonly runSandbox = output<ArmSandboxPersonaId>();
  readonly runReplay = output<void>();
  readonly runAntiGhosting = output<void>();
  readonly syncLocal = output<void>();
  readonly openPalette = output<void>();
  readonly approveItem = output<{ id: string; text?: string; saveAsExample: boolean }>();
  readonly rejectItem = output<string>();
  readonly startEditApproval = output<ArmApprovalQueueItem>();
  readonly cancelEditApproval = output<void>();
  readonly editApprovalTextChange = output<string>();
  readonly editSaveAsExampleChange = output<boolean>();
  readonly generateBriefing = output<void>();
  readonly submitCloserNote = output<void>();
  readonly closerLeadNameChange = output<string>();
  readonly closerTranscriptChange = output<string>();
  readonly sandboxPersonaChange = output<ArmSandboxPersonaId>();

  protected readonly filterOptions = DEAL_FILTER_OPTIONS;
  protected readonly sandboxPersonas = SANDBOX_PERSONAS;
  protected readonly openCardMenuId = signal<string | null>(null);
  protected readonly draggingDealId = signal<string | null>(null);

  protected readonly totalDealsCount = computed<number>(() => {
    const rawCount = this.deals().length;
    if (rawCount > 0) return rawCount;
    return this.kanbanColumns().reduce((sum, col) => sum + col.deals.length, 0);
  });

  @HostListener('document:keydown', ['$event'])
  onDocumentKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.openCardMenuId.set(null);
      return;
    }

    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }

    const firstPending = this.armApprovals()[0];
    if (!firstPending || this.editingApprovalId()) return;

    const lower = event.key.toLowerCase();
    if (lower === 'a') {
      event.preventDefault();
      this.approveItem.emit({ id: firstPending.id, saveAsExample: false });
    } else if (lower === 'e') {
      event.preventDefault();
      this.startEditApproval.emit(firstPending);
    } else if (lower === 'h') {
      event.preventDefault();
      this.rejectItem.emit(firstPending.id);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target || !target.closest('.card-overflow-anchor')) {
      this.openCardMenuId.set(null);
    }
  }

  protected formatNum(value: number, decimals = 2): string {
    return value.toFixed(decimals);
  }

  protected nextStageFor(stage: string): string | null {
    return NEXT_STAGE_MAP[stage] ?? null;
  }

  protected primaryAdvanceLabel(stage: string): string {
    return PRIMARY_ACTION_LABELS[stage] ?? 'Avanzar';
  }

  protected stageToneClass(index: number): string {
    const tones = ['tone-quoted', 'tone-transit', 'tone-verify', 'tone-won'];
    return tones[index] ?? 'tone-quoted';
  }

  protected stageCardCount(slug: string): number {
    return this.armCards().filter((card) => card.stageSlug === slug).length;
  }

  protected onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.searchChange.emit(target?.value ?? '');
  }

  protected onSandboxPersonaSelect(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    if (target?.value) {
      this.sandboxPersonaChange.emit(target.value as ArmSandboxPersonaId);
    }
  }

  protected onArmStageChange(cardId: string, event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    if (target?.value) {
      this.moveArmStage.emit({ cardId, stageSlug: target.value });
    }
  }

  protected onEditApprovalInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement | null;
    this.editApprovalTextChange.emit(target?.value ?? '');
  }

  protected onEditSaveExampleToggle(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.editSaveAsExampleChange.emit(Boolean(target?.checked));
  }

  protected onCloserLeadInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.closerLeadNameChange.emit(target?.value ?? '');
  }

  protected onCloserTranscriptInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement | null;
    this.closerTranscriptChange.emit(target?.value ?? '');
  }

  protected toggleCardMenu(dealId: string): void {
    this.openCardMenuId.update((current) => (current === dealId ? null : dealId));
  }

  protected handleAdvanceDeal(deal: PipelineDeal): void {
    const targetStage = this.nextStageFor(deal.stage);
    if (!targetStage) return;
    if (targetStage === 'STAGE_4_CLOSED') {
      this.settleDeal.emit(deal.id);
      return;
    }
    this.advanceDeal.emit({ dealId: deal.id, targetStage });
  }

  protected handleOpenChat(deal: PipelineDeal): void {
    this.openCardMenuId.set(null);
    this.openDealChat.emit(deal);
  }

  protected handleDeleteDeal(dealId: string): void {
    this.openCardMenuId.set(null);
    this.deleteDeal.emit(dealId);
  }

  protected onDragStart(event: DragEvent, dealId: string): void {
    this.draggingDealId.set(dealId);
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', dealId);
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  protected onDrop(event: DragEvent, targetStage: string): void {
    event.preventDefault();
    const dealId = this.draggingDealId();
    this.draggingDealId.set(null);
    if (!dealId) return;
    if (targetStage === 'STAGE_4_CLOSED') {
      this.settleDeal.emit(dealId);
      return;
    }
    this.advanceDeal.emit({ dealId, targetStage });
  }

  protected onDealCardKeyDown(event: KeyboardEvent, deal: PipelineDeal): void {
    if (event.target !== event.currentTarget) return;

    const key = event.key;
    if (key === 'ArrowRight') {
      event.preventDefault();
      this.handleAdvanceDeal(deal);
    } else if (key === 'ArrowLeft') {
      const prev = PREV_STAGE_MAP[deal.stage];
      if (prev) {
        event.preventDefault();
        this.advanceDeal.emit({ dealId: deal.id, targetStage: prev });
      }
    } else if (key === '1') {
      event.preventDefault();
      this.advanceDeal.emit({ dealId: deal.id, targetStage: 'STAGE_1_NEW' });
    } else if (key === '2') {
      event.preventDefault();
      this.advanceDeal.emit({ dealId: deal.id, targetStage: 'STAGE_2_TRANSIT' });
    } else if (key === '3') {
      event.preventDefault();
      this.advanceDeal.emit({ dealId: deal.id, targetStage: 'STAGE_3_VERIFY' });
    } else if (key === '4') {
      event.preventDefault();
      this.settleDeal.emit(deal.id);
    } else if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault();
      this.deleteDeal.emit(deal.id);
    }
  }
}
