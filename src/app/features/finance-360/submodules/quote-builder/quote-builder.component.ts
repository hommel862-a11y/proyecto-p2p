import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Finance360Service } from '../../../../core/finance-360.service';
import { ToastService } from '../../../../core/toast.service';
import {
  computeProratedQuoteLines,
  generateFinanceId,
  roundMoney,
  todayVetIso,
  type AssetVault,
  type BudgetQuote,
  type ProratedQuoteResult,
  type QuoteItemCategory,
  type QuoteLineItem,
  type QuoteType,
} from '../../../../core/models/finance-360.models';

export const QUOTE_LABOR_TYPE = {
  PROJECT_FIXED: 'project_fixed',
  COMMISSION: 'commission',
  M2_RATE: 'm2_rate',
  DAILY_FIXED: 'daily_fixed',
  HOURLY_RATE: 'hourly_rate',
  UNIT_MARKUP: 'unit_markup',
} as const;
export type QuoteLaborType = (typeof QUOTE_LABOR_TYPE)[keyof typeof QUOTE_LABOR_TYPE];

export const QUOTE_STATUS = {
  DRAFT: 'draft',
  SENT: 'sent',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  COMPLETED: 'completed',
} as const;
export type QuoteStatus = (typeof QUOTE_STATUS)[keyof typeof QUOTE_STATUS];

export const QUOTE_PREVIEW_MODE = {
  CLIENT: 'client',
  INTERNAL: 'internal',
} as const;
export type QuotePreviewMode = (typeof QUOTE_PREVIEW_MODE)[keyof typeof QUOTE_PREVIEW_MODE];

export interface IndustryPreset {
  readonly id: QuoteType;
  readonly label: string;
  readonly badge: string;
  readonly subtitle: string;
  readonly defaultTitle: string;
  readonly defaultWastePct: number;
  readonly defaultProfitPct: number;
  readonly defaultAdvancePct: number;
  readonly scopePlaceholder: string;
  readonly sampleItems: readonly Omit<QuoteLineItem, 'id'>[];
}

export interface LaborTypeOption {
  readonly value: QuoteLaborType;
  readonly label: string;
  readonly unitLabel: string;
  readonly rateLabel: string;
  readonly usesQuantity: boolean;
}

export interface QuotePreviewViewModel {
  readonly quoteNumber: string;
  readonly issuedDate: string;
  readonly clientName: string;
  readonly clientDoc: string;
  readonly clientPhone: string;
  readonly sectorLabel: string;
  readonly description: string;
  readonly scopeText: string;
  readonly laborTypeLabel: string;
  readonly prorated: ProratedQuoteResult;
  readonly wastePct: number;
  readonly profitPct: number;
  readonly discountPct: number;
  readonly ivaPct: number;
  readonly igtfPct: number;
  readonly advancePct: number;
  readonly advanceUsd: number;
  readonly advanceVes: number;
  readonly bcvRate: number;
  readonly totalVes: number;
}

interface ElectronPdfExportBridge {
  exportPdf?: (request: {
    html: string;
    filename?: string;
  }) => Promise<{ ok: boolean; base64?: string; filename?: string; error?: string }>;
}

interface WindowWithElectronPdf {
  electron?: {
    finance360?: ElectronPdfExportBridge;
  };
}

export const QUOTE_UNIT_OPTIONS: readonly string[] = [
  'unid',
  'piezas',
  'm²',
  'horas',
  'días',
  'jornadas',
  'kg',
  'lote',
  'mes',
  'platos',
  'viaje',
  'envío',
  'global',
];

export const LABOR_TYPE_OPTIONS: readonly LaborTypeOption[] = [
  {
    value: QUOTE_LABOR_TYPE.PROJECT_FIXED,
    label: 'Tarifa fija por partidas en tabla',
    unitLabel: '',
    rateLabel: '',
    usesQuantity: false,
  },
  {
    value: QUOTE_LABOR_TYPE.COMMISSION,
    label: 'Comisión % sobre materiales',
    unitLabel: '%',
    rateLabel: 'Porcentaje sobre materiales (%)',
    usesQuantity: false,
  },
  {
    value: QUOTE_LABOR_TYPE.M2_RATE,
    label: 'Tarifa por metro cuadrado (m²)',
    unitLabel: 'm²',
    rateLabel: 'Tarifa por m² (USD)',
    usesQuantity: true,
  },
  {
    value: QUOTE_LABOR_TYPE.DAILY_FIXED,
    label: 'Tarifa por jornada diaria',
    unitLabel: 'jornadas',
    rateLabel: 'Tarifa por jornada (USD)',
    usesQuantity: true,
  },
  {
    value: QUOTE_LABOR_TYPE.HOURLY_RATE,
    label: 'Tarifa por hora técnica',
    unitLabel: 'horas',
    rateLabel: 'Tarifa por hora (USD)',
    usesQuantity: true,
  },
  {
    value: QUOTE_LABOR_TYPE.UNIT_MARKUP,
    label: 'Recargo por unidad producida',
    unitLabel: 'unid',
    rateLabel: 'Tarifa por unidad (USD)',
    usesQuantity: true,
  },
];

export const INDUSTRY_PRESETS: Record<QuoteType, IndustryPreset> = {
  automotive_bodywork: {
    id: 'automotive_bodywork',
    label: 'Automotriz y Talleres',
    badge: 'Taller Mecánico / Pintura',
    subtitle: 'Latonería, pintura bicapa 2K, mecánica preventiva y repuestos de recambio',
    defaultTitle: 'Latonería y Pintura Automotriz',
    defaultWastePct: 10,
    defaultProfitPct: 25,
    defaultAdvancePct: 50,
    scopePlaceholder: 'Describa piezas a reparar, código de pintura y observaciones técnicas...',
    sampleItems: [
      {
        category: 'material',
        name: 'Insumos de Pintura 2K y Fondo Poliuretano',
        quantity: 2,
        unit: 'piezas',
        unitCostUsd: 35,
      },
      {
        category: 'labor',
        name: 'Mano de Obra Especializada de Latonería y Pintura',
        quantity: 2,
        unit: 'piezas',
        unitCostUsd: 50,
      },
      {
        category: 'material',
        name: 'Kit Abrasivo, Desengrasante y Masilla Plástica',
        quantity: 1,
        unit: 'lote',
        unitCostUsd: 20,
      },
    ],
  },
  construction_m2: {
    id: 'construction_m2',
    label: 'Construcción y Obras',
    badge: 'Obras Civiles y Reformas',
    subtitle: 'Albañilería, acabados por m², drywall, revestimientos, plomería y pintura',
    defaultTitle: 'Remodelación y Acabados de Obra',
    defaultWastePct: 10,
    defaultProfitPct: 25,
    defaultAdvancePct: 50,
    scopePlaceholder: 'Especifique metraje, condiciones del inmueble y preparación de superficie...',
    sampleItems: [
      {
        category: 'material',
        name: 'Materiales y Revestimientos de Obra',
        quantity: 50,
        unit: 'm²',
        unitCostUsd: 5.5,
      },
      {
        category: 'labor',
        name: 'Mano de Obra Cuadrilla / Albañilería Especializada',
        quantity: 50,
        unit: 'm²',
        unitCostUsd: 6,
      },
      {
        category: 'logistics',
        name: 'Flete de Materiales y Retiro de Escombros',
        quantity: 1,
        unit: 'viaje',
        unitCostUsd: 40,
      },
    ],
  },
  tech_services: {
    id: 'tech_services',
    label: 'Tecnología y Consultoría',
    badge: 'Servicios Profesionales IT',
    subtitle: 'Desarrollo de software, consultoría técnica, diseño UI/UX y soporte',
    defaultTitle: 'Desarrollo de Software y Arquitectura IT',
    defaultWastePct: 0,
    defaultProfitPct: 35,
    defaultAdvancePct: 50,
    scopePlaceholder: 'Detalle módulos funcionales, hitos de entrega y tecnologías involucradas...',
    sampleItems: [
      {
        category: 'labor',
        name: 'Arquitectura y Desarrollo Full-Stack',
        quantity: 30,
        unit: 'horas',
        unitCostUsd: 25,
      },
      {
        category: 'labor',
        name: 'Diseño de Interfaces UI/UX y Prototipado',
        quantity: 15,
        unit: 'horas',
        unitCostUsd: 20,
      },
      {
        category: 'material',
        name: 'Infraestructura Cloud, Dominios y Servidores',
        quantity: 1,
        unit: 'mes',
        unitCostUsd: 50,
      },
    ],
  },
  commerce_retail: {
    id: 'commerce_retail',
    label: 'Comercio y Mayorista',
    badge: 'Distribución y Ventas',
    subtitle: 'Venta de lotes comerciales, distribución de mercancía, empaque y despacho',
    defaultTitle: 'Suministro y Distribución Comercial',
    defaultWastePct: 2,
    defaultProfitPct: 30,
    defaultAdvancePct: 60,
    scopePlaceholder: 'Indique especificaciones de lotes, embalaje y tiempos de despacho...',
    sampleItems: [
      {
        category: 'material',
        name: 'Lote de Mercancía / Productos Principales',
        quantity: 50,
        unit: 'unid',
        unitCostUsd: 12,
      },
      {
        category: 'material',
        name: 'Material de Empaque, Precintos y Embalaje',
        quantity: 1,
        unit: 'lote',
        unitCostUsd: 18,
      },
      {
        category: 'logistics',
        name: 'Servicio de Despacho Logístico',
        quantity: 1,
        unit: 'envío',
        unitCostUsd: 25,
      },
    ],
  },
  gastronomy_events: {
    id: 'gastronomy_events',
    label: 'Gastronomía y Eventos',
    badge: 'Catering y Banquetes',
    subtitle: 'Servicio de banquetes, insumos de cocina con merma y personal de servicio',
    defaultTitle: 'Servicio de Catering y Banquete Corporativo',
    defaultWastePct: 8,
    defaultProfitPct: 35,
    defaultAdvancePct: 50,
    scopePlaceholder: 'Describa menú seleccionado, número de comensales, montaje y duración...',
    sampleItems: [
      {
        category: 'material',
        name: 'Insumos Gastronómicos y Menú Principal',
        quantity: 40,
        unit: 'platos',
        unitCostUsd: 8.5,
      },
      {
        category: 'labor',
        name: 'Personal de Cocina, Chef y Mesoneros',
        quantity: 2,
        unit: 'jornadas',
        unitCostUsd: 40,
      },
      {
        category: 'logistics',
        name: 'Alquiler de Menaje, Cristalería y Transporte',
        quantity: 1,
        unit: 'lote',
        unitCostUsd: 60,
      },
    ],
  },
  custom_universal: {
    id: 'custom_universal',
    label: 'Presupuesto Universal',
    badge: 'Cotización Multi-Área',
    subtitle: 'Cotizador adaptable a cualquier industria, servicio técnico u oficio comercial',
    defaultTitle: 'Cotización Comercial Personalizada',
    defaultWastePct: 5,
    defaultProfitPct: 25,
    defaultAdvancePct: 50,
    scopePlaceholder: 'Describa el alcance completo de los trabajos o suministros acordados...',
    sampleItems: [
      {
        category: 'material',
        name: 'Insumos / Componentes Directos',
        quantity: 1,
        unit: 'lote',
        unitCostUsd: 80,
      },
      {
        category: 'labor',
        name: 'Servicio Técnico / Mano de Obra Especializada',
        quantity: 1,
        unit: 'global',
        unitCostUsd: 120,
      },
      {
        category: 'logistics',
        name: 'Gastos Operativos y Traslado Técnico',
        quantity: 1,
        unit: 'global',
        unitCostUsd: 30,
      },
    ],
  },
};

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Component({
  selector: 'app-quote-builder',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './quote-builder.component.html',
  styleUrls: ['./quote-builder.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.privacy-active]': 'privacyMode()',
  },
})
export class QuoteBuilderComponent {
  readonly financeService = inject(Finance360Service);
  private readonly toast = inject(ToastService);

  readonly privacyMode = input<boolean>(false);

  readonly industryPresets = INDUSTRY_PRESETS;
  readonly industryKeys: readonly QuoteType[] = [
    'automotive_bodywork',
    'construction_m2',
    'tech_services',
    'commerce_retail',
    'gastronomy_events',
    'custom_universal',
  ];
  readonly unitOptions = QUOTE_UNIT_OPTIONS;
  readonly laborTypeOptions = LABOR_TYPE_OPTIONS;
  readonly statusOptions: readonly { value: QuoteStatus; label: string }[] = [
    { value: QUOTE_STATUS.DRAFT, label: 'Borrador' },
    { value: QUOTE_STATUS.SENT, label: 'Enviado' },
    { value: QUOTE_STATUS.APPROVED, label: 'Aprobado' },
    { value: QUOTE_STATUS.REJECTED, label: 'Rechazado' },
    { value: QUOTE_STATUS.COMPLETED, label: 'Completado' },
  ];

  // Configurable Business Profile (zero hardcoded brand/RIF)
  readonly businessProfile = computed(() => this.financeService.pymeProfile());
  readonly showProfileEditor = signal<boolean>(false);
  readonly profileBusinessName = signal<string>('');
  readonly profileTaxIdRif = signal<string>('');
  readonly profilePhone = signal<string>('');
  readonly profileAddress = signal<string>('');
  readonly profileDefaultIva = signal<number>(16);
  readonly profileDefaultIgtf = signal<number>(3);

  // Real Vaults for Quote Approvals & Final Settlements
  readonly liquidVaults = computed<readonly AssetVault[]>(() =>
    this.financeService.state().assets.filter((v) => v.channel !== 'receivable'),
  );

  readonly selectedSettlementVaultId = linkedSignal<readonly AssetVault[], string>({
    source: this.liquidVaults,
    computation: (vaults, prev) => {
      if (prev?.value && vaults.some((v) => v.id === prev.value)) {
        return prev.value;
      }
      const businessVault = vaults.find((v) => v.scope === 'business');
      return businessVault?.id ?? vaults[0]?.id ?? '';
    },
  });

  // Active Quote Form State
  readonly editingQuoteId = signal<string | null>(null);
  readonly editingQuoteNumber = signal<string | null>(null);
  readonly editingQuoteVersion = signal<number>(1);

  readonly quoteType = signal<QuoteType>('automotive_bodywork');
  readonly clientName = signal<string>('');
  readonly clientPhone = signal<string>('');
  readonly clientDoc = signal<string>('');
  readonly projectTitle = signal<string>(INDUSTRY_PRESETS.automotive_bodywork.defaultTitle);
  readonly projectScopeDetails = signal<string>('');

  // Automotive conditional fields
  readonly vehicleModel = signal<string>('');
  readonly vehicleColor = signal<string>('');
  readonly vehiclePlate = signal<string>('');

  // Dynamic Line Items Engine (immutable signal updates only)
  readonly lineItems = signal<readonly QuoteLineItem[]>(
    INDUSTRY_PRESETS.automotive_bodywork.sampleItems.map((item, idx) => ({
      ...item,
      id: `item-init-${idx + 1}`,
    })),
  );

  // Dual Labor Engine
  readonly laborType = signal<QuoteLaborType>(QUOTE_LABOR_TYPE.PROJECT_FIXED);
  readonly laborUnits = signal<number>(1);
  readonly laborRateValue = signal<number>(25);

  // Financial Parameters & Tax Toggles
  readonly technicalWastePercent = signal<number>(10);
  readonly profitMarginPercent = signal<number>(25);
  readonly advancePercent = signal<number>(50);
  readonly discountPercent = signal<number>(0);
  readonly applyIva = signal<boolean>(false);
  readonly ivaPercent = signal<number>(this.financeService.pymeProfile().defaultIvaPercent ?? 16);
  readonly applyIgtf = signal<boolean>(false);
  readonly igtfPercent = signal<number>(this.financeService.pymeProfile().defaultIgtfPercent ?? 3);

  // Saved Quotes Filter & Preview Modal
  readonly savedQuoteFilter = signal<'all' | QuoteType>('all');
  readonly previewModalOpen = signal<boolean>(false);
  readonly previewMode = signal<QuotePreviewMode>(QUOTE_PREVIEW_MODE.CLIENT);
  readonly previewSavedQuote = signal<BudgetQuote | null>(null);

  readonly currentPreset = computed<IndustryPreset>(
    () => this.industryPresets[this.quoteType()] ?? this.industryPresets.custom_universal,
  );

  readonly activeLaborMeta = computed<LaborTypeOption>(
    () =>
      this.laborTypeOptions.find((opt) => opt.value === this.laborType()) ??
      this.laborTypeOptions[0],
  );

  /**
   * Resolves effective line items feeding `computeProratedQuoteLines`.
   * In `project_fixed`, uses the table's labor rows directly.
   * In parametric modes, replaces table labor rows with the deterministic labor engine calculation.
   */
  readonly effectiveLineItems = computed<readonly QuoteLineItem[]>(() => {
    const items = this.lineItems();
    const mode = this.laborType();
    if (mode === QUOTE_LABOR_TYPE.PROJECT_FIXED) {
      return items;
    }

    const nonLaborItems = items.filter((it) => it.category !== 'labor');
    const rawMaterials = nonLaborItems
      .filter((it) => it.category === 'material')
      .reduce((sum, it) => sum + Math.max(0, it.quantity) * Math.max(0, it.unitCostUsd), 0);

    const rate = Math.max(0, Number(this.laborRateValue() ?? 0));
    const units = Math.max(0, Number(this.laborUnits() ?? 0));

    let laborItem: QuoteLineItem;
    if (mode === QUOTE_LABOR_TYPE.COMMISSION) {
      const commissionCost = roundMoney((rawMaterials * rate) / 100);
      laborItem = {
        id: 'labor-engine-auto',
        category: 'labor',
        name: `Mano de Obra Técnica (Comisión ${rate}%)`,
        quantity: 1,
        unit: 'global',
        unitCostUsd: commissionCost,
      };
    } else if (mode === QUOTE_LABOR_TYPE.M2_RATE) {
      laborItem = {
        id: 'labor-engine-auto',
        category: 'labor',
        name: 'Mano de Obra Especializada por m²',
        quantity: units,
        unit: 'm²',
        unitCostUsd: rate,
      };
    } else if (mode === QUOTE_LABOR_TYPE.DAILY_FIXED) {
      laborItem = {
        id: 'labor-engine-auto',
        category: 'labor',
        name: 'Mano de Obra por Jornada Técnica',
        quantity: units,
        unit: 'jornadas',
        unitCostUsd: rate,
      };
    } else if (mode === QUOTE_LABOR_TYPE.HOURLY_RATE) {
      laborItem = {
        id: 'labor-engine-auto',
        category: 'labor',
        name: 'Honorarios Técnicos por Hora',
        quantity: units,
        unit: 'horas',
        unitCostUsd: rate,
      };
    } else {
      laborItem = {
        id: 'labor-engine-auto',
        category: 'labor',
        name: 'Mano de Obra por Unidad Producida',
        quantity: units,
        unit: 'unid',
        unitCostUsd: rate,
      };
    }

    return [...nonLaborItems, laborItem];
  });

  readonly activeIvaPercent = computed<number>(() =>
    this.applyIva() ? Math.max(0, Number(this.ivaPercent() ?? 0)) : 0,
  );

  readonly activeIgtfPercent = computed<number>(() =>
    this.applyIgtf() ? Math.max(0, Number(this.igtfPercent() ?? 0)) : 0,
  );

  /** Single Source of Truth Financial & Prorated Commercial Engine */
  readonly proratedQuote = computed<ProratedQuoteResult>(() =>
    computeProratedQuoteLines(
      this.effectiveLineItems(),
      Math.max(0, Number(this.technicalWastePercent() ?? 0)),
      Math.max(0, Number(this.profitMarginPercent() ?? 0)),
      Math.max(0, Math.min(100, Number(this.discountPercent() ?? 0))),
      this.activeIvaPercent(),
      this.activeIgtfPercent(),
    ),
  );

  readonly isBelowCost = computed<boolean>(() => {
    const q = this.proratedQuote();
    return q.subtotalCostUsd > 0 && q.totalUsd < q.subtotalCostUsd;
  });

  readonly belowCostLossUsd = computed<number>(() => {
    const q = this.proratedQuote();
    return Math.max(0, roundMoney(q.subtotalCostUsd - q.totalUsd));
  });

  /** Real Anticipo Blindado: minimum advance required to cover base operational costs */
  readonly costCoveringAdvanceUsd = computed<number>(
    () => this.proratedQuote().subtotalCostUsd,
  );

  readonly costCoveringAdvancePercent = computed<number>(() => {
    const q = this.proratedQuote();
    if (q.totalUsd <= 0) return 0;
    return Math.min(100, Math.ceil((q.subtotalCostUsd / q.totalUsd) * 100));
  });

  readonly currentQuoteTotals = computed(() => {
    const q = this.proratedQuote();
    const wastePct = Math.max(0, Number(this.technicalWastePercent() ?? 0));
    const profitPct = Math.max(0, Number(this.profitMarginPercent() ?? 0));
    const discountPct = Math.max(0, Math.min(100, Number(this.discountPercent() ?? 0)));
    const advancePct = Math.max(0, Math.min(100, Number(this.advancePercent() ?? 0)));
    const ivaPct = this.activeIvaPercent();
    const igtfPct = this.activeIgtfPercent();

    const advanceUsd = roundMoney((q.totalUsd * advancePct) / 100);
    const bcv = this.financeService.currentBcvRate();
    const totalVes = bcv > 0 ? roundMoney(q.totalUsd * bcv) : 0;
    const advanceVes = bcv > 0 ? roundMoney(advanceUsd * bcv) : 0;

    return {
      rawMaterials: q.rawMaterialsUsd,
      waste: q.wasteUsd,
      wastePct,
      totalMaterials: q.totalMaterialsUsd,
      totalLabor: q.totalLaborUsd,
      totalLogistics: q.totalLogisticsUsd,
      subtotal: q.subtotalCostUsd,
      profit: q.profitUsd,
      profitPct,
      grossTotal: q.grossTotalUsd,
      discount: q.discountUsd,
      discountPct,
      netBeforeTax: q.netBeforeTaxUsd,
      ivaPct,
      ivaUsd: q.ivaUsd,
      igtfPct,
      igtfUsd: q.igtfUsd,
      totalUsd: q.totalUsd,
      advanceUsd,
      advancePct,
      totalVes,
      advanceVes,
      bcv,
      coversBaseCosts: advanceUsd >= q.subtotalCostUsd,
    };
  });

  readonly savedQuotes = computed<readonly BudgetQuote[]>(
    () => this.financeService.state().quotes,
  );

  readonly filteredSavedQuotes = computed<readonly BudgetQuote[]>(() => {
    const list = this.savedQuotes();
    const filter = this.savedQuoteFilter();
    if (filter === 'all') return list;
    return list.filter((q) => q.type === filter);
  });

  /** Active Preview Model (handles both live draft and frozen saved quote snapshots) */
  readonly activePreview = computed<QuotePreviewViewModel>(() => {
    const saved = this.previewSavedQuote();
    if (saved) {
      const items: readonly QuoteLineItem[] =
        saved.lineItems && saved.lineItems.length > 0
          ? saved.lineItems
          : [
              ...saved.materials.map((m, idx) => ({
                id: `saved-m-${idx}`,
                category: 'material' as const,
                name: m.name,
                quantity: m.quantity,
                unit: m.unit,
                unitCostUsd: m.unitCostUsd,
              })),
              ...(saved.laborCostUsd > 0
                ? [
                    {
                      id: 'saved-labor',
                      category: 'labor' as const,
                      name: 'Mano de Obra Técnica',
                      quantity: 1,
                      unit: 'global',
                      unitCostUsd: saved.laborCostUsd,
                    },
                  ]
                : []),
            ];

      const wastePct = saved.technicalWastePercent ?? 0;
      const profitPct = saved.profitMarginPercent ?? 0;
      const discountPct = saved.discountPercent ?? 0;
      const ivaPct = saved.ivaPercent ?? 0;
      const igtfPct = saved.igtfPercent ?? 0;
      const prorated = computeProratedQuoteLines(
        items,
        wastePct,
        profitPct,
        discountPct,
        ivaPct,
        igtfPct,
      );
      const advancePct = saved.advancePercent ?? 0;
      const advanceUsd = saved.minimumAdvanceUsd ?? 0;
      const bcvRate = saved.bcvRateApplied;
      const totalVes = bcvRate > 0 ? roundMoney(prorated.totalUsd * bcvRate) : saved.totalPriceVes;
      const advanceVes = bcvRate > 0 ? roundMoney(advanceUsd * bcvRate) : 0;
      const scopeText =
        typeof saved.scopeDetails?.['scopeText'] === 'string'
          ? (saved.scopeDetails['scopeText'] as string)
          : '';

      return {
        quoteNumber: saved.quoteNumber,
        issuedDate: saved.createdAt.slice(0, 10),
        clientName: saved.clientName,
        clientDoc: saved.clientDoc || 'No especificado',
        clientPhone: saved.clientPhone || 'No especificado',
        sectorLabel: this.getSectorLabel(saved.type),
        description: saved.description,
        scopeText,
        laborTypeLabel: this.getLaborTypeLabel(saved.laborType),
        prorated,
        wastePct,
        profitPct,
        discountPct,
        ivaPct,
        igtfPct,
        advancePct,
        advanceUsd,
        advanceVes,
        bcvRate,
        totalVes,
      };
    }

    const totals = this.currentQuoteTotals();
    const prorated = this.proratedQuote();
    const quoteNumber =
      this.editingQuoteNumber() ??
      `COT-${this.quoteType().slice(0, 3).toUpperCase()}-V${this.editingQuoteVersion()}`;

    return {
      quoteNumber,
      issuedDate: todayVetIso(),
      clientName: this.clientName().trim() || 'Cliente por definir',
      clientDoc: this.clientDoc().trim() || 'No especificado',
      clientPhone: this.clientPhone().trim() || 'No especificado',
      sectorLabel: this.currentPreset().label,
      description: this.projectTitle().trim() || this.currentPreset().defaultTitle,
      scopeText: this.projectScopeDetails().trim(),
      laborTypeLabel: this.activeLaborMeta().label,
      prorated,
      wastePct: totals.wastePct,
      profitPct: totals.profitPct,
      discountPct: totals.discountPct,
      ivaPct: totals.ivaPct,
      igtfPct: totals.igtfPct,
      advancePct: totals.advancePct,
      advanceUsd: totals.advanceUsd,
      advanceVes: totals.advanceVes,
      bcvRate: totals.bcv,
      totalVes: totals.totalVes,
    };
  });

  // -------------------------------------------------------------
  // BUSINESS PROFILE EDITOR
  // -------------------------------------------------------------

  toggleProfileEditor(): void {
    const opening = !this.showProfileEditor();
    if (opening) {
      const prof = this.businessProfile();
      this.profileBusinessName.set(prof.businessName);
      this.profileTaxIdRif.set(prof.rif ?? '');
      this.profilePhone.set(prof.phone ?? '');
      this.profileAddress.set(prof.address ?? '');
      this.profileDefaultIva.set(prof.defaultIvaPercent ?? 16);
      this.profileDefaultIgtf.set(prof.defaultIgtfPercent ?? 3);
    }
    this.showProfileEditor.set(opening);
  }

  saveBusinessProfile(): void {
    const name = this.profileBusinessName().trim() || 'Mi Negocio';
    const nextIva = Math.max(0, Math.min(50, Number(this.profileDefaultIva() ?? 16)));
    const nextIgtf = Math.max(0, Math.min(20, Number(this.profileDefaultIgtf() ?? 3)));

    this.financeService.updatePymeProfile({
      businessName: name,
      rif: this.profileTaxIdRif().trim() || undefined,
      phone: this.profilePhone().trim() || undefined,
      address: this.profileAddress().trim() || undefined,
      defaultIvaPercent: nextIva,
      defaultIgtfPercent: nextIgtf,
    });

    this.ivaPercent.set(nextIva);
    this.igtfPercent.set(nextIgtf);
    this.showProfileEditor.set(false);
    this.toast.success(`Perfil comercial "${name}" actualizado.`);
  }

  // -------------------------------------------------------------
  // INDUSTRY PRESET & LINE ITEMS (IMMUTABLE)
  // -------------------------------------------------------------

  switchIndustry(type: QuoteType): void {
    this.quoteType.set(type);
    const preset = this.industryPresets[type];
    if (!preset) return;

    this.editingQuoteId.set(null);
    this.editingQuoteNumber.set(null);
    this.editingQuoteVersion.set(1);

    this.projectTitle.set(preset.defaultTitle);
    this.technicalWastePercent.set(preset.defaultWastePct);
    this.profitMarginPercent.set(preset.defaultProfitPct);
    this.advancePercent.set(preset.defaultAdvancePct);
    this.discountPercent.set(0);
    this.laborType.set(QUOTE_LABOR_TYPE.PROJECT_FIXED);

    const newItems: QuoteLineItem[] = preset.sampleItems.map((item) => ({
      ...item,
      id: generateFinanceId('item'),
    }));
    this.lineItems.set(newItems);
  }

  addLineItem(category: QuoteItemCategory = 'material'): void {
    const defaultUnit =
      category === 'labor' ? 'horas' : category === 'logistics' ? 'viaje' : 'unid';
    const newItem: QuoteLineItem = {
      id: generateFinanceId('item'),
      category,
      name:
        category === 'material'
          ? 'Nuevo Insumo / Material'
          : category === 'labor'
            ? 'Mano de Obra / Servicio'
            : 'Servicio Logístico / Flete',
      quantity: 1,
      unit: defaultUnit,
      unitCostUsd: 10,
    };
    this.lineItems.update((list) => [...list, newItem]);
  }

  removeLineItem(id: string): void {
    if (this.lineItems().length <= 1) {
      this.toast.warn('El presupuesto debe contener al menos una partida.');
      return;
    }
    this.lineItems.update((list) => list.filter((item) => item.id !== id));
  }

  updateItemName(item: QuoteLineItem, newName: string): void {
    this.lineItems.update((list) =>
      list.map((it) => (it.id === item.id ? { ...it, name: newName } : it)),
    );
  }

  updateItemCategory(item: QuoteLineItem, newCategory: QuoteItemCategory): void {
    this.lineItems.update((list) =>
      list.map((it) => (it.id === item.id ? { ...it, category: newCategory } : it)),
    );
  }

  updateItemUnit(item: QuoteLineItem, newUnit: string): void {
    this.lineItems.update((list) =>
      list.map((it) => (it.id === item.id ? { ...it, unit: newUnit } : it)),
    );
  }

  updateItemQty(item: QuoteLineItem, newQty: number | null): void {
    const parsed = Number(newQty ?? 0);
    const qty = Number.isFinite(parsed) && parsed > 0 ? parsed : 0.01;
    this.lineItems.update((list) =>
      list.map((it) => (it.id === item.id ? { ...it, quantity: qty } : it)),
    );
  }

  updateItemCost(item: QuoteLineItem, newCost: number | null): void {
    const parsed = Number(newCost ?? 0);
    const cost = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    this.lineItems.update((list) =>
      list.map((it) => (it.id === item.id ? { ...it, unitCostUsd: cost } : it)),
    );
  }

  applyShieldedAdvance(): void {
    this.advancePercent.set(this.costCoveringAdvancePercent());
  }

  onIvaToggle(event: Event): void {
    const el = event.target as HTMLInputElement | null;
    if (el) this.applyIva.set(el.checked);
  }

  onIgtfToggle(event: Event): void {
    const el = event.target as HTMLInputElement | null;
    if (el) this.applyIgtf.set(el.checked);
  }

  // -------------------------------------------------------------
  // SAVE, REOPEN, STATUS & AUTOMATION LIFECYCLE
  // -------------------------------------------------------------

  saveCurrentQuote(): void {
    const client = this.clientName().trim();
    if (!client) {
      this.toast.warn('Ingrese el nombre del cliente o razón social.');
      return;
    }

    const type = this.quoteType();
    const totals = this.currentQuoteTotals();
    const preset = this.currentPreset();
    const title = this.projectTitle().trim() || preset.defaultTitle;
    const effectiveItems = this.effectiveLineItems();

    const description =
      type === 'automotive_bodywork' && this.vehicleModel().trim()
        ? `${title}: ${this.vehicleModel().trim()} (${this.vehicleColor().trim() || 'Color original'})`
        : title;

    const isRevision = this.editingQuoteId() !== null;
    const nextVersion = isRevision ? this.editingQuoteVersion() + 1 : 1;
    const baseQuoteNumber =
      this.editingQuoteNumber() ??
      `COT-${generateFinanceId('q').slice(-6).toUpperCase()}`;

    const quote = this.financeService.saveQuote({
      quoteNumber: isRevision ? `${baseQuoteNumber}-R${nextVersion}` : baseQuoteNumber,
      clientName: client,
      clientPhone: this.clientPhone().trim() || undefined,
      clientDoc: this.clientDoc().trim() || undefined,
      type,
      description,
      scopeDetails: {
        sector: preset.label,
        scopeText: this.projectScopeDetails().trim() || undefined,
        vehicleModel: type === 'automotive_bodywork' ? this.vehicleModel().trim() || undefined : undefined,
        vehicleColor: type === 'automotive_bodywork' ? this.vehicleColor().trim() || undefined : undefined,
        vehiclePlate: type === 'automotive_bodywork' ? this.vehiclePlate().trim() || undefined : undefined,
        laborRateValue: this.laborRateValue(),
        laborUnits: this.laborUnits(),
      },
      materials: effectiveItems
        .filter((it) => it.category === 'material')
        .map((it) => ({
          name: it.name,
          quantity: it.quantity,
          unit: it.unit,
          unitCostUsd: it.unitCostUsd,
          wasteFactorPercent: totals.wastePct,
          totalCostUsd: roundMoney(it.quantity * it.unitCostUsd),
        })),
      lineItems: effectiveItems.map((it) => ({ ...it })),
      laborCostUsd: totals.totalLabor,
      logisticsCostUsd: totals.totalLogistics,
      laborType: this.laborType(),
      totalMaterialsCostUsd: totals.totalMaterials,
      subtotalCostUsd: totals.subtotal,
      profitMarginPercent: totals.profitPct,
      technicalWastePercent: totals.wastePct,
      discountPercent: totals.discountPct,
      ivaPercent: totals.ivaPct,
      igtfPercent: totals.igtfPct,
      ivaAmountUsd: totals.ivaUsd,
      igtfAmountUsd: totals.igtfUsd,
      totalPriceUsd: totals.totalUsd,
      minimumAdvanceUsd: totals.advanceUsd,
      advancePercent: totals.advancePct,
      bcvRateApplied: totals.bcv,
      totalPriceVes: totals.totalVes,
      status: QUOTE_STATUS.DRAFT,
      version: nextVersion,
    });

    this.editingQuoteId.set(quote.id);
    this.editingQuoteNumber.set(baseQuoteNumber);
    this.editingQuoteVersion.set(nextVersion);

    this.toast.success(`Presupuesto #${quote.quoteNumber} guardado en historial.`);
  }

  reopenSavedQuote(quote: BudgetQuote): void {
    this.editingQuoteId.set(quote.id);
    this.editingQuoteNumber.set(quote.quoteNumber.replace(/-R\d+$/, ''));
    this.editingQuoteVersion.set(quote.version ?? 1);

    this.quoteType.set(quote.type);
    this.clientName.set(quote.clientName);
    this.clientPhone.set(quote.clientPhone ?? '');
    this.clientDoc.set(quote.clientDoc ?? '');
    this.projectTitle.set(quote.description);

    const scopeDetails = quote.scopeDetails ?? {};
    this.projectScopeDetails.set(
      typeof scopeDetails['scopeText'] === 'string' ? scopeDetails['scopeText'] : '',
    );
    this.vehicleModel.set(
      typeof scopeDetails['vehicleModel'] === 'string' ? scopeDetails['vehicleModel'] : '',
    );
    this.vehicleColor.set(
      typeof scopeDetails['vehicleColor'] === 'string' ? scopeDetails['vehicleColor'] : '',
    );
    this.vehiclePlate.set(
      typeof scopeDetails['vehiclePlate'] === 'string' ? scopeDetails['vehiclePlate'] : '',
    );

    this.laborType.set(quote.laborType ?? QUOTE_LABOR_TYPE.PROJECT_FIXED);
    if (typeof scopeDetails['laborRateValue'] === 'number') {
      this.laborRateValue.set(scopeDetails['laborRateValue']);
    }
    if (typeof scopeDetails['laborUnits'] === 'number') {
      this.laborUnits.set(scopeDetails['laborUnits']);
    }

    if (quote.lineItems && quote.lineItems.length > 0) {
      this.lineItems.set(quote.lineItems.map((it) => ({ ...it })));
    } else if (quote.materials.length > 0) {
      this.lineItems.set(
        quote.materials.map((m) => ({
          id: generateFinanceId('item'),
          category: 'material' as const,
          name: m.name,
          quantity: m.quantity,
          unit: m.unit,
          unitCostUsd: m.unitCostUsd,
        })),
      );
    }

    this.technicalWastePercent.set(quote.technicalWastePercent ?? 0);
    this.profitMarginPercent.set(quote.profitMarginPercent ?? 25);
    this.discountPercent.set(quote.discountPercent ?? 0);

    const ivaPct = quote.ivaPercent ?? 0;
    this.applyIva.set(ivaPct > 0);
    if (ivaPct > 0) this.ivaPercent.set(ivaPct);

    const igtfPct = quote.igtfPercent ?? 0;
    this.applyIgtf.set(igtfPct > 0);
    if (igtfPct > 0) this.igtfPercent.set(igtfPct);

    // Strictly preserve 0% advance without 50% fallback
    this.advancePercent.set(quote.advancePercent ?? 0);

    this.toast.info(`Cotización #${quote.quoteNumber} cargada en el editor.`);
  }

  updateSavedQuoteStatus(quote: BudgetQuote, status: QuoteStatus): void {
    this.financeService.updateQuoteStatus(quote.id, status);
    this.toast.info(`Estado de #${quote.quoteNumber} actualizado a "${this.getStatusLabel(status)}".`);
  }

  approveAndAutomateQuote(quote: BudgetQuote): void {
    const vaultId = this.selectedSettlementVaultId() || undefined;
    const res = this.financeService.approveQuoteAndTriggerAutomations(quote.id, vaultId);
    if (!res.success) {
      this.toast.warn(
        res.alreadyApproved
          ? `La cotización #${quote.quoteNumber} ya fue aprobada anteriormente.`
          : 'No se encontró la cotización para aprobar.',
      );
      return;
    }

    const parts: string[] = [];
    if (res.advanceIncomeId) parts.push('anticipo acreditado');
    if (res.receivableUsd > 0) parts.push(`CxC $${res.receivableUsd.toFixed(2)}`);
    if (res.deductedInventory.length > 0) {
      parts.push(`${res.deductedInventory.length} insumo(s) descontado(s)`);
    }
    if (res.payrollLiabilityId) parts.push('nómina agendada');

    this.toast.success(
      `Presupuesto #${quote.quoteNumber} aprobado y automatizado (${parts.join(' · ') || 'estado actualizado'}).`,
    );
  }

  settleFinalQuoteDelivery(quote: BudgetQuote): void {
    const advanceUsd = quote.minimumAdvanceUsd ?? 0;
    const remainingUsd = Math.max(0, roundMoney(quote.totalPriceUsd - advanceUsd));
    const vaultId = this.selectedSettlementVaultId() || undefined;
    const prof = this.businessProfile();
    const pctSum =
      prof.defaultDrawer1Percent + prof.defaultDrawer2Percent + prof.defaultDrawer3Percent || 100;
    const d1 = roundMoney((remainingUsd * prof.defaultDrawer1Percent) / pctSum);
    const d2 = roundMoney((remainingUsd * prof.defaultDrawer2Percent) / pctSum);
    const d3 = roundMoney(remainingUsd - d1 - d2);

    if (remainingUsd > 0) {
      this.financeService.settlePymeSaleWithDrawers({
        title: `Liquidación Final ${quote.quoteNumber}: ${quote.description}`,
        totalUsd: remainingUsd,
        vaultId,
        drawer1Usd: d1,
        drawer2Usd: d2,
        drawer3Usd: d3,
      });
    }

    this.financeService.updateQuoteStatus(quote.id, QUOTE_STATUS.COMPLETED);
    this.toast.success(
      `Entrega final liquidada ($${remainingUsd.toFixed(2)} USD) y distribuida en las 3 Gavetas.`,
    );
  }

  deleteSavedQuote(quote: BudgetQuote): void {
    this.financeService.deleteQuote(quote.id);
    if (this.editingQuoteId() === quote.id) {
      this.editingQuoteId.set(null);
      this.editingQuoteNumber.set(null);
      this.editingQuoteVersion.set(1);
    }
    this.toast.info(`Cotización #${quote.quoteNumber} eliminada.`);
  }

  // -------------------------------------------------------------
  // DUAL PDF PREVIEW, ELECTRON IPC EXPORT & WHATSAPP COPY
  // -------------------------------------------------------------

  openPreview(mode: QuotePreviewMode): void {
    this.previewSavedQuote.set(null);
    this.previewMode.set(mode);
    this.previewModalOpen.set(true);
  }

  openSavedQuotePreview(quote: BudgetQuote, mode: QuotePreviewMode = QUOTE_PREVIEW_MODE.CLIENT): void {
    this.previewSavedQuote.set(quote);
    this.previewMode.set(mode);
    this.previewModalOpen.set(true);
  }

  closePreview(): void {
    this.previewModalOpen.set(false);
    this.previewSavedQuote.set(null);
  }

  printQuote(): void {
    try {
      window.print();
    } catch {
      this.toast.warn('La impresión nativa no está disponible en este entorno.');
    }
  }

  async exportQuotePdf(): Promise<void> {
    const preview = this.activePreview();
    const mode = this.previewMode();
    const html = this.buildPrintableHtml(preview, mode);
    const safeNumber = preview.quoteNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeNumber}-${mode === QUOTE_PREVIEW_MODE.CLIENT ? 'cliente' : 'auditoria'}.pdf`;

    const electronBridge = (window as unknown as WindowWithElectronPdf).electron?.finance360;
    if (typeof electronBridge?.exportPdf === 'function') {
      try {
        const res = await electronBridge.exportPdf({ html, filename });
        if (res?.ok) {
          if (res.base64) {
            this.triggerBase64Download(res.base64, res.filename || filename, 'application/pdf');
          }
          this.toast.success(`PDF "${res.filename || filename}" exportado correctamente.`);
          return;
        }
        this.toast.warn(res?.error || 'No se pudo generar el PDF vía Electron; se usará el respaldo web.');
      } catch {
        this.toast.warn('Error en puente PDF de Electron; se usará el respaldo web.');
      }
    }

    // Web / Capacitor safe fallback: standalone printable HTML Blob download + safe print
    try {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      this.triggerBlobDownload(blob, filename.replace(/\.pdf$/i, '.html'));
      this.toast.info('Documento descargado en formato imprimible.');
    } catch {
      this.printQuote();
    }
  }

  async copyQuoteForWhatsApp(savedQuote?: BudgetQuote): Promise<void> {
    const profile = this.businessProfile();
    const companyName = profile.businessName || 'Mi Negocio';
    const companyRif = profile.rif ? ` · RIF: ${profile.rif}` : '';

    // Strictly use frozen bcvRateApplied for saved quotes (zero live drift!)
    const bcv = savedQuote ? savedQuote.bcvRateApplied : this.currentQuoteTotals().bcv;
    const client = savedQuote ? savedQuote.clientName : this.clientName().trim() || 'Cliente';
    const quoteRef = savedQuote
      ? savedQuote.quoteNumber
      : this.editingQuoteNumber() ?? `COT-${todayVetIso().replace(/-/g, '')}`;
    const type = savedQuote ? savedQuote.type : this.quoteType();
    const preset = this.industryPresets[type] ?? this.industryPresets.custom_universal;
    const desc = savedQuote
      ? savedQuote.description
      : this.projectTitle().trim() || preset.defaultTitle;
    const totalUsd = savedQuote ? savedQuote.totalPriceUsd : this.currentQuoteTotals().totalUsd;
    const totalVes = savedQuote
      ? bcv > 0
        ? roundMoney(totalUsd * bcv)
        : savedQuote.totalPriceVes
      : this.currentQuoteTotals().totalVes;

    // Strictly preserve 0% advance (never fallback to 50%!)
    const advanceUsd = savedQuote
      ? (savedQuote.minimumAdvanceUsd ?? 0)
      : this.currentQuoteTotals().advanceUsd;
    const advancePct = savedQuote
      ? (savedQuote.advancePercent ?? 0)
      : this.currentQuoteTotals().advancePct;

    const items =
      savedQuote?.lineItems && savedQuote.lineItems.length > 0
        ? savedQuote.lineItems
        : this.effectiveLineItems();

    const itemsSummary = items
      .map((it) => `  - ${it.name} (${it.quantity} ${it.unit})`)
      .slice(0, 8)
      .join('\n');

    const lines = [
      `*${companyName}${companyRif} · PRESUPUESTO ${quoteRef}*`,
      `Sector: ${preset.label}`,
      `Cliente: ${client}`,
      `Servicio / Proyecto: ${desc}`,
      `Partidas principales:`,
      itemsSummary,
      `----------------------------`,
      `Total Final: $${totalUsd.toFixed(2)} USD`,
    ];

    if (bcv > 0) {
      lines.push(
        `Equivalente BCV (${bcv.toFixed(2)} Bs/$): Bs ${totalVes.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      );
    }

    lines.push(
      `Anticipo (${advancePct}%): $${advanceUsd.toFixed(2)} USD`,
      `Validez: 7 días continuos a partir de la emisión.`,
    );

    const text = lines.join('\n');

    try {
      await navigator.clipboard.writeText(text);
      this.toast.success('Resumen comercial copiado al portapapeles.');
    } catch {
      this.toast.info(`Resumen listo: Total $${totalUsd.toFixed(2)} USD.`);
    }
  }

  getSectorLabel(type: QuoteType): string {
    return this.industryPresets[type]?.label ?? 'General';
  }

  getLaborTypeLabel(type: BudgetQuote['laborType']): string {
    return (
      this.laborTypeOptions.find((opt) => opt.value === type)?.label ??
      'Tarifa fija por partidas'
    );
  }

  getStatusLabel(status: QuoteStatus): string {
    return this.statusOptions.find((s) => s.value === status)?.label ?? status;
  }

  private buildPrintableHtml(preview: QuotePreviewViewModel, mode: QuotePreviewMode): string {
    const profile = this.businessProfile();
    const companyName = escapeHtml(profile.businessName || 'Mi Negocio');
    const rifPart = profile.rif ? `RIF: ${escapeHtml(profile.rif)}` : '';
    const phonePart = profile.phone ? `Tel: ${escapeHtml(profile.phone)}` : '';
    const addrPart = profile.address ? escapeHtml(profile.address) : '';
    const metaLine = [rifPart, phonePart, addrPart].filter(Boolean).join(' · ');

    const rowsHtml =
      mode === QUOTE_PREVIEW_MODE.CLIENT
        ? preview.prorated.lines
            .map(
              (line) => `<tr>
                <td>${escapeHtml(line.name)}</td>
                <td class="num">${line.quantity}</td>
                <td class="center">${escapeHtml(line.unit)}</td>
                <td class="num">$${line.proratedUnitPriceUsd.toFixed(2)}</td>
                <td class="num"><strong>$${line.proratedTotalUsd.toFixed(2)}</strong></td>
              </tr>`,
            )
            .join('')
        : preview.prorated.lines
            .map(
              (line) => `<tr>
                <td>${escapeHtml(line.name)} (${escapeHtml(line.category)})</td>
                <td class="num">${line.quantity} ${escapeHtml(line.unit)}</td>
                <td class="num">$${line.rawUnitCostUsd.toFixed(2)}</td>
                <td class="num">$${line.rawTotalUsd.toFixed(2)}</td>
                <td class="num"><strong>$${line.proratedTotalUsd.toFixed(2)}</strong></td>
              </tr>`,
            )
            .join('');

    const tableHead =
      mode === QUOTE_PREVIEW_MODE.CLIENT
        ? '<tr><th>Concepto / Partida</th><th class="num">Cant.</th><th class="center">Unidad</th><th class="num">Precio Unit.</th><th class="num">Total USD</th></tr>'
        : '<tr><th>Partida Interna</th><th class="num">Cantidad</th><th class="num">Costo Unit.</th><th class="num">Costo Base</th><th class="num">Precio Cliente</th></tr>';

    const internalSummary =
      mode === QUOTE_PREVIEW_MODE.INTERNAL
        ? `<div class="box">
            <h3>Auditoría Interna de Costos y Margen</h3>
            <p>Materiales base: $${preview.prorated.rawMaterialsUsd.toFixed(2)} | Merma (${preview.wastePct}%): +$${preview.prorated.wasteUsd.toFixed(2)} | Mano de obra (${escapeHtml(preview.laborTypeLabel)}): $${preview.prorated.totalLaborUsd.toFixed(2)} | Logística: $${preview.prorated.totalLogisticsUsd.toFixed(2)}</p>
            <p>Subtotal costos: $${preview.prorated.subtotalCostUsd.toFixed(2)} | Margen (${preview.profitPct}%): +$${preview.prorated.profitUsd.toFixed(2)} | Descuento (${preview.discountPct}%): -$${preview.prorated.discountUsd.toFixed(2)}</p>
            ${preview.ivaPct > 0 || preview.igtfPct > 0 ? `<p>IVA (${preview.ivaPct}%): $${preview.prorated.ivaUsd.toFixed(2)} | IGTF (${preview.igtfPct}%): $${preview.prorated.igtfUsd.toFixed(2)}</p>` : ''}
          </div>`
        : `<div class="box">
            <h3>Condiciones Comerciales</h3>
            <p>Anticipo requerido (${preview.advancePct}%): $${preview.advanceUsd.toFixed(2)} USD. Validez: 7 días continuos a partir de la fecha de emisión.</p>
            ${preview.scopeText ? `<p>Alcance: ${escapeHtml(preview.scopeText)}</p>` : ''}
          </div>`;

    const bcvLine =
      preview.bcvRate > 0
        ? `<div class="ves">Equivalente oficial BCV (${preview.bcvRate.toFixed(2)} Bs/$): Bs ${preview.totalVes.toFixed(2)}</div>`
        : '';

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(preview.quoteNumber)} - ${companyName}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #111827; background: #ffffff; margin: 28px; font-size: 13px; }
  .header { display: flex; justify-content: space-between; border-bottom: 2px solid #111827; padding-bottom: 12px; margin-bottom: 18px; }
  h1 { margin: 0; font-size: 20px; }
  .meta { color: #4b5563; font-size: 12px; margin-top: 4px; }
  .badge { text-align: right; }
  .client { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; padding: 10px 12px; background: #f8fafc; border: 1px solid #e5e7eb; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 8px; text-align: left; }
  th { background: #f3f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .center { text-align: center; }
  .box { padding: 12px; border: 1px solid #d1d5db; margin-bottom: 16px; }
  .box h3 { margin: 0 0 6px; font-size: 13px; }
  .box p { margin: 4px 0; font-size: 12px; color: #374151; }
  .totals { text-align: right; border-top: 2px solid #111827; padding-top: 10px; }
  .grand { font-size: 20px; font-weight: 700; }
  .ves { font-size: 12px; color: #4b5563; margin-top: 4px; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${companyName}</h1>
      <div class="meta">${escapeHtml(preview.sectorLabel)}${metaLine ? ' · ' + metaLine : ''}</div>
    </div>
    <div class="badge">
      <div><strong>PRESUPUESTO</strong></div>
      <div>${escapeHtml(preview.quoteNumber)}</div>
      <div class="meta">Fecha: ${escapeHtml(preview.issuedDate)}</div>
    </div>
  </div>
  <div class="client">
    <div><strong>Cliente:</strong> ${escapeHtml(preview.clientName)}</div>
    <div><strong>C.I. / RIF:</strong> ${escapeHtml(preview.clientDoc)}</div>
    <div><strong>Teléfono:</strong> ${escapeHtml(preview.clientPhone)}</div>
    <div><strong>Proyecto:</strong> ${escapeHtml(preview.description)}</div>
  </div>
  <table>
    <thead>${tableHead}</thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  ${internalSummary}
  <div class="totals">
    <div class="grand">Total Final: $${preview.prorated.totalUsd.toFixed(2)} USD</div>
    ${bcvLine}
  </div>
</body>
</html>`;
  }

  private triggerBase64Download(base64: string, filename: string, mimeType: string): void {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    this.triggerBlobDownload(new Blob([bytes], { type: mimeType }), filename);
  }

  private triggerBlobDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
