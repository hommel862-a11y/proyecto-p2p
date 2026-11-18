import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  buildCopyableBankBubbles,
  calculateBillingDocumentTotals,
  evaluateMeta24hFreeWindow,
  formatFiatNumber,
} from '@p2p/core';
import type {
  AiOperatingMode,
  AiTriageResult,
  ArmWorkspaceId,
  BillingLineItem,
  CopyableBankBubbles,
  CrmBankAccount,
  CrmBillingDocument,
  CrmContact,
  CrmDocumentType,
  FiatCurrency,
  GeminiOcrParsedResult,
  OmnichannelConversation,
} from '../../crm-ui.models';

type LineCategory = BillingLineItem['category'];

export const INBOX_STUDIO_SUB_TAB = {
  INBOX: 'INBOX',
  STUDIO: 'STUDIO',
  CONFIG: 'CONFIG',
} as const;

export type InboxStudioSubTab =
  (typeof INBOX_STUDIO_SUB_TAB)[keyof typeof INBOX_STUDIO_SUB_TAB];

export const SEND_MESSAGE_MODE = {
  DISPATCH: 'DISPATCH',
  WHATSAPP_DIRECT: 'WHATSAPP_DIRECT',
  COPY: 'COPY',
} as const;

export type SendMessageMode =
  (typeof SEND_MESSAGE_MODE)[keyof typeof SEND_MESSAGE_MODE];

export const EXPORT_PNG_MODE = {
  COPY: 'COPY',
  DOWNLOAD: 'DOWNLOAD',
} as const;

export type ExportPngMode =
  (typeof EXPORT_PNG_MODE)[keyof typeof EXPORT_PNG_MODE];

export interface SendMessageCommand {
  mode: SendMessageMode;
}

export interface InboxOmnichannelConfig {
  aiMode: AiOperatingMode;
  businessDisplayName: string;
  welcomeTemplateP2p: string;
  welcomeTemplate360: string;
  geminiApiKey?: string;
  whatsappPhoneNumberId?: string;
  instagramAccountId?: string;
  metaAccessToken?: string;
}

export interface InboxStudioState {
  docType: CrmDocumentType;
  contactId: string;
  docNumber: string;
  fiatCurrency: FiatCurrency;
  exchangeRate: number;
  discountUsdt: number;
  taxPct: number;
  bankAccountId: string;
  bankRefId: string;
  paymentInstructions: string;
  items: BillingLineItem[];
  totalUsdt: number;
  totalFiat: number;
}

const DOC_TYPE_TITLES: Record<CrmDocumentType, string> = {
  PRESUPUESTO_QUOTE: 'Presupuesto / Cotización',
  FACTURA_INVOICE: 'Factura Comercial',
  COMPROBANTE_P2P: 'Comprobante Liquidación P2P',
};

const DEFAULT_CONFIG: InboxOmnichannelConfig = {
  aiMode: 'COPILOT_DRAFT',
  businessDisplayName: 'P2P Quant Treasury',
  welcomeTemplateP2p: '',
  welcomeTemplate360: '',
};

const DEFAULT_STUDIO_STATE: InboxStudioState = {
  docType: 'PRESUPUESTO_QUOTE',
  contactId: '',
  docNumber: '',
  fiatCurrency: 'VES',
  exchangeRate: 1,
  discountUsdt: 0,
  taxPct: 0,
  bankAccountId: '',
  bankRefId: '',
  paymentInstructions: '',
  items: [],
  totalUsdt: 0,
  totalFiat: 0,
};

@Component({
  selector: 'app-crm-inbox-studio',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './crm-inbox-studio.component.html',
  styleUrl: './crm-inbox-studio.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.silo-b2b]': "activeSilo() === 'ARM_B2B'",
    '[class.silo-p2p]': "activeSilo() === 'P2P_DESK'",
    '[class.silo-360]': "activeSilo() === 'FINANCE_360'",
    '[class.privacy-active]': 'privacyMode()',
  },
})
export class CrmInboxStudioComponent {
  readonly activeSilo = input<ArmWorkspaceId>('P2P_DESK');
  readonly subTab = input<InboxStudioSubTab>('INBOX');
  readonly conversations = input<OmnichannelConversation[]>([]);
  readonly selectedConversation = input<OmnichannelConversation | null>(null);
  readonly chatSearch = input<string>('');
  readonly chatDraft = input<string>('');
  readonly testInboundText = input<string>('');
  readonly aiTriage = input<AiTriageResult | null>(null);
  readonly banks = input<CrmBankAccount[]>([]);
  readonly contacts = input<CrmContact[]>([]);
  readonly selectedBankIdForBubbles = input<string>('');
  readonly isAnalyzingOcr = input<boolean>(false);
  readonly ocrResult = input<GeminiOcrParsedResult | null>(null);
  readonly invoicesOrQuotes = input<CrmBillingDocument[]>([]);
  readonly omnichannelConfig = input<InboxOmnichannelConfig>(DEFAULT_CONFIG);
  readonly studioState = input<InboxStudioState>(DEFAULT_STUDIO_STATE);
  readonly freeWindowRemainingLabel = input<string>('Ventana Cerrada');
  readonly freeWindowIsOpen = input<boolean>(false);
  readonly privacyMode = input<boolean>(false);

  readonly subTabChange = output<InboxStudioSubTab>();
  readonly selectConversation = output<string>();
  readonly newChat = output<void>();
  readonly chatSearchChange = output<string>();
  readonly chatDraftChange = output<string>();
  readonly sendMessage = output<SendMessageCommand>();
  readonly testInboundChange = output<string>();
  readonly simulateInboundTriage = output<void>();
  readonly applyTriageAction = output<void>();
  readonly dismissTriage = output<void>();
  readonly selectBankForBubbles = output<string>();
  readonly generateBankBubbles = output<string>();
  readonly ocrPasteFile = output<File | string>();
  readonly insertDocInChat = output<string>();
  readonly studioFieldChange = output<Record<string, unknown>>();
  readonly addStudioItem = output<void>();
  readonly removeStudioItem = output<string>();
  readonly saveStudioDoc = output<boolean>();
  readonly exportStudioPng = output<ExportPngMode>();
  readonly loadSavedDoc = output<CrmBillingDocument>();
  readonly deleteSavedDoc = output<string>();
  readonly updateConfig = output<Record<string, unknown>>();

  readonly filteredConversations = computed<OmnichannelConversation[]>(() => {
    const query = this.chatSearch().trim().toLowerCase();
    const list = this.conversations();
    if (!query) return list;
    return list.filter(
      (conv) =>
        conv.contactName.toLowerCase().includes(query) ||
        conv.recipientPhoneOrIgId.toLowerCase().includes(query),
    );
  });

  readonly bubblePreview = computed<CopyableBankBubbles | null>(() => {
    const bankId = this.selectedBankIdForBubbles();
    if (!bankId) return null;
    const bank = this.banks().find((b) => b.id === bankId);
    if (!bank) return null;
    return buildCopyableBankBubbles(bank);
  });

  readonly studioSelectedContact = computed<CrmContact | null>(() => {
    const id = this.studioState().contactId;
    if (!id) return null;
    return this.contacts().find((c) => c.id === id) ?? null;
  });

  readonly studioSelectedBank = computed<CrmBankAccount | null>(() => {
    const id = this.studioState().bankAccountId;
    if (!id) return null;
    return this.banks().find((b) => b.id === id) ?? null;
  });

  readonly studioComputedTotals = computed(() => {
    const s = this.studioState();
    const calc = calculateBillingDocumentTotals(
      s.items,
      s.discountUsdt,
      s.taxPct,
      s.exchangeRate,
    );
    return {
      subtotalUsdt: calc.subtotalUsdt,
      discountUsdt: calc.discountUsdt,
      taxOrFeeUsdt: calc.taxOrFeeUsdt,
      totalUsdt: s.items.length > 0 ? calc.totalUsdt : s.totalUsdt,
      totalFiat: s.items.length > 0 ? calc.totalFiat : s.totalFiat,
    };
  });

  readonly docTypeTitle = computed<string>(
    () => DOC_TYPE_TITLES[this.studioState().docType] ?? 'Comprobante',
  );

  formatWindowBadge(lastInboundTimestamp: number | null): {
    isOpen: boolean;
    label: string;
  } {
    const evaluation = evaluateMeta24hFreeWindow(lastInboundTimestamp);
    if (!evaluation.isOpen) {
      return { isOpen: false, label: 'Ventana Cerrada' };
    }
    const hours = Math.floor(evaluation.remainingMinutes / 60);
    const mins = evaluation.remainingMinutes % 60;
    return { isOpen: true, label: `24h Gratis: ${hours}h ${mins}m ($0.00)` };
  }

  formatFiat(amount: number): string {
    return formatFiatNumber(amount);
  }

  getInputValue(event: Event): string {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    return target.value;
  }

  onStudioTextField(field: string, event: Event): void {
    this.studioFieldChange.emit({ [field]: this.getInputValue(event) });
  }

  onStudioNumberField(field: string, event: Event): void {
    const num = Number(this.getInputValue(event));
    this.studioFieldChange.emit({ [field]: Number.isFinite(num) ? num : 0 });
  }

  onStudioItemField(
    index: number,
    field: 'description' | 'quantity' | 'unitPriceUsdt' | 'category',
    event: Event,
  ): void {
    const raw = this.getInputValue(event);
    const items = this.studioState().items.map((item, idx) => {
      if (idx !== index) return item;
      if (field === 'quantity' || field === 'unitPriceUsdt') {
        const numeric = Number(raw);
        return { ...item, [field]: Number.isFinite(numeric) ? numeric : 0 };
      }
      if (field === 'category') {
        return { ...item, category: raw as LineCategory };
      }
      return { ...item, description: raw };
    });
    this.studioFieldChange.emit({ items });
  }

  onConfigField(field: keyof InboxOmnichannelConfig, event: Event): void {
    this.updateConfig.emit({ [field]: this.getInputValue(event) });
  }

  onChatPaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (items) {
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            this.ocrPasteFile.emit(file);
            return;
          }
        }
      }
    }
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (text.startsWith('data:image/')) {
      event.preventDefault();
      this.ocrPasteFile.emit(text);
    }
  }

  onOcrFileSelected(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    if (file) {
      this.ocrPasteFile.emit(file);
      inputEl.value = '';
    }
  }

  onInsertDocClick(docId: string): void {
    if (!docId) return;
    this.insertDocInChat.emit(docId);
  }

  triageActionLabel(action: AiTriageResult['recommendedKanbanAction']): string {
    const labels: Record<AiTriageResult['recommendedKanbanAction'], string> = {
      CREATE_P2P_DEAL: 'Crear Trato P2P en Kanban',
      CREATE_360_QUOTE_DEAL: 'Crear Cotización 360',
      ATTACH_PAYMENT_REF: 'Adjuntar Ref y Avanzar Trato',
      NONE: 'Sin acción Kanban',
    };
    return labels[action];
  }
}
