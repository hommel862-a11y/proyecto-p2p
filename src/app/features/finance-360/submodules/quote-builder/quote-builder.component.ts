import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Finance360Service } from '../../../../core/finance-360.service';
import { ToastService } from '../../../../core/toast.service';
import {
  type BudgetQuote,
  type QuoteType,
  type QuoteLineItem,
  type QuoteItemCategory,
  computeTriMonetaryAmount,
} from '../../../../core/models/finance-360.models';

export interface IndustryPreset {
  id: QuoteType;
  label: string;
  icon: string;
  badge: string;
  subtitle: string;
  defaultTitle: string;
  defaultWastePct: number;
  defaultProfitPct: number;
  defaultAdvancePct: number;
  scopePlaceholder: string;
  sampleItems: Omit<QuoteLineItem, 'id'>[];
}

export const INDUSTRY_PRESETS: Record<QuoteType, IndustryPreset> = {
  automotive_bodywork: {
    id: 'automotive_bodywork',
    label: 'Automotriz & Talleres',
    icon: '🚗',
    badge: 'TALLER MECÁNICO / PINTURA',
    subtitle: 'Latonería, pintura bicapa 2K, mecánica preventiva y repuestos de recambio',
    defaultTitle: 'Latonería & Pintura Automotriz',
    defaultWastePct: 10,
    defaultProfitPct: 25,
    defaultAdvancePct: 50,
    scopePlaceholder: 'Describí piezas a reparar, tono de pintura y observaciones mecánicas...',
    sampleItems: [
      { category: 'material', name: 'Insumos de Pintura 2K & Fondo Poliuretano', quantity: 2, unit: 'piezas', unitCostUsd: 35 },
      { category: 'labor', name: 'Mano de Obra Especializada de Latonería y Pintura', quantity: 2, unit: 'piezas', unitCostUsd: 50 },
      { category: 'material', name: 'Kit Abrasivo, Desengrasante y Masilla Plástica', quantity: 1, unit: 'lote', unitCostUsd: 20 },
    ],
  },
  construction_m2: {
    id: 'construction_m2',
    label: 'Construcción & Obras',
    icon: '🏗️',
    badge: 'OBRAS CIVILES & REFORMAS',
    subtitle: 'Albañilería, acabados por m², drywall, revestimientos, plomería y pintura',
    defaultTitle: 'Remodelación y Acabados de Obra',
    defaultWastePct: 10,
    defaultProfitPct: 25,
    defaultAdvancePct: 50,
    scopePlaceholder: 'Especificá metraje, condiciones del inmueble, preparación de superficie...',
    sampleItems: [
      { category: 'material', name: 'Materiales & Revestimientos de Obra', quantity: 50, unit: 'm²', unitCostUsd: 5.5 },
      { category: 'labor', name: 'Mano de Obra Cuadrilla / Albañilería Especializada', quantity: 50, unit: 'm²', unitCostUsd: 6.0 },
      { category: 'logistics', name: 'Flete de Materiales y Retiro de Escombros', quantity: 1, unit: 'viaje', unitCostUsd: 40 },
    ],
  },
  tech_services: {
    id: 'tech_services',
    label: 'Tecnología & Consultoría',
    icon: '💻',
    badge: 'SERVICIOS PROFESIONALES & IT',
    subtitle: 'Desarrollo de software, consultoría técnica, diseño UI/UX, marketing y soporte',
    defaultTitle: 'Desarrollo de Software & Arquitectura IT',
    defaultWastePct: 0,
    defaultProfitPct: 35,
    defaultAdvancePct: 50,
    scopePlaceholder: 'Detallá módulos funcionales, hitos de entrega y tecnologías involucradas...',
    sampleItems: [
      { category: 'labor', name: 'Arquitectura & Desarrollo Full-Stack', quantity: 30, unit: 'horas', unitCostUsd: 25 },
      { category: 'labor', name: 'Diseño de Interfaces UI/UX & Prototipado', quantity: 15, unit: 'horas', unitCostUsd: 20 },
      { category: 'material', name: 'Infraestructura Cloud, Dominios & Servidores', quantity: 1, unit: 'mes', unitCostUsd: 50 },
    ],
  },
  commerce_retail: {
    id: 'commerce_retail',
    label: 'Comercio & Mayorista',
    icon: '📦',
    badge: 'DISTRIBUCIÓN & VENTAS',
    subtitle: 'Venta de lotes comerciales, distribución de mercancía, empaque y delivery',
    defaultTitle: 'Suministro y Distribución Comercial',
    defaultWastePct: 2,
    defaultProfitPct: 30,
    defaultAdvancePct: 60,
    scopePlaceholder: 'Indicá especificaciones de los lotes, embalaje y tiempos de despacho...',
    sampleItems: [
      { category: 'material', name: 'Lote de Mercancía / Productos Principales', quantity: 50, unit: 'unid', unitCostUsd: 12 },
      { category: 'material', name: 'Material de Empaque, Precintos y Embalaje', quantity: 1, unit: 'lote', unitCostUsd: 18 },
      { category: 'logistics', name: 'Servicio de Despacho Logístico / Delivery', quantity: 1, unit: 'envío', unitCostUsd: 25 },
    ],
  },
  gastronomy_events: {
    id: 'gastronomy_events',
    label: 'Gastronomía & Eventos',
    icon: '🍽️',
    badge: 'CATERING & BANQUETES',
    subtitle: 'Servicio de banquetes, insumos de cocina con merma de alimentos y personal',
    defaultTitle: 'Servicio de Catering & Banquete Corporativo',
    defaultWastePct: 8,
    defaultProfitPct: 35,
    defaultAdvancePct: 50,
    scopePlaceholder: 'Describí menú seleccionado, número de comensales, montaje y duración...',
    sampleItems: [
      { category: 'material', name: 'Insumos Gastronómicos & Menú Principal', quantity: 40, unit: 'platos', unitCostUsd: 8.5 },
      { category: 'labor', name: 'Personal de Cocina, Chef y Mesoneros', quantity: 2, unit: 'jornadas', unitCostUsd: 40 },
      { category: 'logistics', name: 'Alquiler de Menaje, Cristalería y Transporte', quantity: 1, unit: 'lote', unitCostUsd: 60 },
    ],
  },
  custom_universal: {
    id: 'custom_universal',
    label: 'Presupuesto Libre / Multi-Área',
    icon: '⚙️',
    badge: 'PRESUPUESTO UNIVERSAL',
    subtitle: 'Cotizador flexible y adaptable a cualquier industria, servicio u oficio comercial',
    defaultTitle: 'Cotización Comercial Personalizada',
    defaultWastePct: 5,
    defaultProfitPct: 25,
    defaultAdvancePct: 50,
    scopePlaceholder: 'Describí el alcance completo de los trabajos o suministros acordados...',
    sampleItems: [
      { category: 'material', name: 'Insumos / Componentes Directos', quantity: 1, unit: 'lote', unitCostUsd: 80 },
      { category: 'labor', name: 'Servicio Técnico / Mano de Obra Especializada', quantity: 1, unit: 'global', unitCostUsd: 120 },
      { category: 'logistics', name: 'Gastos Operativos & Traslado Técnico', quantity: 1, unit: 'global', unitCostUsd: 30 },
    ],
  },
};

@Component({
  selector: 'app-quote-builder',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './quote-builder.component.html',
  styleUrls: ['./quote-builder.component.scss'],
})
export class QuoteBuilderComponent {
  readonly financeService = inject(Finance360Service);
  private readonly toast = inject(ToastService);

  readonly industryPresets = INDUSTRY_PRESETS;
  readonly industryKeys: QuoteType[] = [
    'automotive_bodywork',
    'construction_m2',
    'tech_services',
    'commerce_retail',
    'gastronomy_events',
    'custom_universal',
  ];

  // Active Quote Mode
  readonly quoteType = signal<QuoteType>('automotive_bodywork');

  // Client Info
  readonly clientName = signal<string>('Carlos Rodríguez');
  readonly clientPhone = signal<string>('0412-5551234');
  readonly clientDoc = signal<string>('V-18456789');

  // General Job Title & Scope
  readonly projectTitle = signal<string>('Latonería & Pintura Automotriz');
  readonly projectScopeDetails = signal<string>('');

  // Automotive-specific attributes (shown conditionally)
  readonly vehicleModel = signal<string>('Toyota Corolla 2012');
  readonly vehicleColor = signal<string>('Gris Plata Metalizado');
  readonly vehiclePlate = signal<string>('AA123BB');

  // Dynamic Line Items Engine
  readonly lineItems = signal<QuoteLineItem[]>([
    { id: 'item-1', category: 'material', name: 'Insumos de Pintura 2K & Fondo Poliuretano', quantity: 2, unit: 'piezas', unitCostUsd: 35 },
    { id: 'item-2', category: 'labor', name: 'Mano de Obra Especializada de Latonería y Pintura', quantity: 2, unit: 'piezas', unitCostUsd: 50 },
    { id: 'item-3', category: 'material', name: 'Kit Abrasivo, Desengrasante y Masilla Plástica', quantity: 1, unit: 'lote', unitCostUsd: 20 },
  ]);

  // Financial Parameters
  readonly technicalWastePercent = signal<number>(10);
  readonly profitMarginPercent = signal<number>(25);
  readonly advancePercent = signal<number>(50);
  readonly discountPercent = signal<number>(0);

  // Saved Quotes Filter
  readonly savedQuoteFilter = signal<'all' | QuoteType>('all');

  // Modal Dual PDF Preview State
  readonly previewModalOpen = signal<boolean>(false);
  readonly previewMode = signal<'client' | 'internal'>('client');

  /** Current active preset configuration */
  readonly currentPreset = computed<IndustryPreset>(() => {
    return this.industryPresets[this.quoteType()] ?? this.industryPresets.custom_universal;
  });

  /** Real-time Universal Financial Engine */
  readonly currentQuoteTotals = computed(() => {
    const items = this.lineItems();
    const wastePct = Math.max(0, this.technicalWastePercent());
    const profitPct = Math.max(0, this.profitMarginPercent());
    const advancePct = Math.max(0, Math.min(100, this.advancePercent()));
    const discountPct = Math.max(0, Math.min(100, this.discountPercent()));

    let rawMaterials = 0;
    let totalLabor = 0;
    let totalLogistics = 0;

    for (const item of items) {
      const lineCost = (item.quantity || 0) * (item.unitCostUsd || 0);
      if (item.category === 'material') {
        rawMaterials += lineCost;
      } else if (item.category === 'labor') {
        totalLabor += lineCost;
      } else {
        totalLogistics += lineCost;
      }
    }

    const waste = Number(((rawMaterials * wastePct) / 100).toFixed(2));
    const totalMaterials = Number((rawMaterials + waste).toFixed(2));
    const subtotal = Number((totalMaterials + totalLabor + totalLogistics).toFixed(2));
    const profit = Number(((subtotal * profitPct) / 100).toFixed(2));
    const grossTotal = Number((subtotal + profit).toFixed(2));
    const discount = Number(((grossTotal * discountPct) / 100).toFixed(2));
    const totalUsd = Math.max(0, Number((grossTotal - discount).toFixed(2)));
    const advanceUsd = Math.round(totalUsd * (advancePct / 100) * 100) / 100;

    const bcv = this.financeService.currentBcvRate();
    const totalVes = Number((totalUsd * bcv).toFixed(2));
    const advanceVes = Number((advanceUsd * bcv).toFixed(2));

    return {
      rawMaterials,
      waste,
      wastePct,
      totalMaterials,
      totalLabor,
      totalLogistics,
      subtotal,
      profit,
      profitPct,
      grossTotal,
      discount,
      discountPct,
      totalUsd,
      advanceUsd,
      advancePct,
      totalVes,
      advanceVes,
      bcv,
    };
  });

  /** Saved quotes list */
  readonly savedQuotes = computed<BudgetQuote[]>(() => {
    return this.financeService.state().quotes;
  });

  /** Filtered saved quotes by industry */
  readonly filteredSavedQuotes = computed<BudgetQuote[]>(() => {
    const list = this.savedQuotes();
    const filter = this.savedQuoteFilter();
    if (filter === 'all') return list;
    return list.filter((q) => q.type === filter);
  });

  // -------------------------------------------------------------
  // INDUSTRY & PRESET SWITCHER
  // -------------------------------------------------------------

  switchIndustry(type: QuoteType): void {
    this.quoteType.set(type);
    const preset = this.industryPresets[type];
    if (!preset) return;

    this.projectTitle.set(preset.defaultTitle);
    this.technicalWastePercent.set(preset.defaultWastePct);
    this.profitMarginPercent.set(preset.defaultProfitPct);
    this.advancePercent.set(preset.defaultAdvancePct);
    this.discountPercent.set(0);

    // Re-seed default items for this industry
    const newItems: QuoteLineItem[] = preset.sampleItems.map((item, idx) => ({
      ...item,
      id: `item-${Date.now()}-${idx}`,
    }));
    this.lineItems.set(newItems);
  }

  // -------------------------------------------------------------
  // DYNAMIC LINE ITEMS MANAGEMENT
  // -------------------------------------------------------------

  addLineItem(category: QuoteItemCategory = 'material'): void {
    const defaultUnit = category === 'labor' ? 'horas' : category === 'logistics' ? 'viaje' : 'unid';
    const newItem: QuoteLineItem = {
      id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      category,
      name: category === 'material' ? 'Nuevo Insumo / Material' : category === 'labor' ? 'Mano de Obra / Honorario' : 'Servicio Logístico / Transporte',
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
    const qty = Math.max(0.01, newQty ?? 1);
    this.lineItems.update((list) =>
      list.map((it) => (it.id === item.id ? { ...it, quantity: qty } : it)),
    );
  }

  updateItemCost(item: QuoteLineItem, newCost: number | null): void {
    const cost = Math.max(0, newCost ?? 0);
    this.lineItems.update((list) =>
      list.map((it) => (it.id === item.id ? { ...it, unitCostUsd: cost } : it)),
    );
  }

  // -------------------------------------------------------------
  // SAVE, WHATSAPP EXPORT & DUAL PDF
  // -------------------------------------------------------------

  saveCurrentQuote(): void {
    const client = this.clientName().trim();
    if (!client) {
      this.toast.warn('Por favor ingresa el nombre del cliente o empresa.');
      return;
    }

    const type = this.quoteType();
    const totals = this.currentQuoteTotals();
    const preset = this.currentPreset();
    const title = this.projectTitle().trim() || preset.defaultTitle;

    const description =
      type === 'automotive_bodywork' && this.vehicleModel()
        ? `${title}: ${this.vehicleModel()} (${this.vehicleColor() || 'Color original'})`
        : title;

    const quoteNumber = `COT-${Date.now().toString().slice(-6)}`;

    const quote = this.financeService.saveQuote({
      quoteNumber,
      clientName: client,
      clientPhone: this.clientPhone().trim() || undefined,
      clientDoc: this.clientDoc().trim() || undefined,
      type,
      description,
      scopeDetails: {
        sector: preset.label,
        scopeText: this.projectScopeDetails().trim() || undefined,
        vehicleModel: type === 'automotive_bodywork' ? this.vehicleModel() : undefined,
        vehicleColor: type === 'automotive_bodywork' ? this.vehicleColor() : undefined,
        vehiclePlate: type === 'automotive_bodywork' ? this.vehiclePlate() : undefined,
      },
      materials: this.lineItems()
        .filter((it) => it.category === 'material')
        .map((it) => ({
          name: it.name,
          quantity: it.quantity,
          unit: it.unit,
          unitCostUsd: it.unitCostUsd,
          wasteFactorPercent: totals.wastePct,
          totalCostUsd: Number((it.quantity * it.unitCostUsd).toFixed(2)),
        })),
      lineItems: this.lineItems(),
      laborCostUsd: totals.totalLabor,
      logisticsCostUsd: totals.totalLogistics,
      laborType: 'project_fixed',
      totalMaterialsCostUsd: totals.totalMaterials,
      subtotalCostUsd: totals.subtotal,
      profitMarginPercent: totals.profitPct,
      technicalWastePercent: totals.wastePct,
      discountPercent: totals.discountPct,
      totalPriceUsd: totals.totalUsd,
      minimumAdvanceUsd: totals.advanceUsd,
      advancePercent: totals.advancePct,
      bcvRateApplied: totals.bcv,
      totalPriceVes: totals.totalVes,
      status: 'draft',
    });

    this.toast.success(`Presupuesto #${quote.quoteNumber} (${preset.label}) guardado exitosamente.`);
  }

  openPreview(mode: 'client' | 'internal'): void {
    this.previewMode.set(mode);
    this.previewModalOpen.set(true);
  }

  printQuote(): void {
    window.print();
  }

  registerAdvanceDeposit(quote: BudgetQuote): void {
    const advanceUsd = quote.minimumAdvanceUsd || Math.round(quote.totalPriceUsd * 0.5 * 100) / 100;
    const bcv = this.financeService.currentBcvRate();
    const parallel = this.financeService.currentParallelRate();
    const tri = computeTriMonetaryAmount(advanceUsd, 'USD', bcv, parallel);

    this.financeService.addIncome({
      title: `Anticipo (${quote.advancePercent || 50}%) Presupuesto: ${quote.description}`,
      scope: 'business',
      category: 'quote_advance',
      channel: 'bs_bank',
      vaultId: 'vault-pyme-caja',
      triMonetary: tri,
      date: new Date().toISOString().split('T')[0],
      notes: `Anticipo de cliente ${quote.clientName} (Presupuesto ${quote.quoteNumber})`,
    });

    this.financeService.updateQuoteStatus(quote.id, 'approved');
    this.toast.success(`💰 Anticipo de $${advanceUsd} USD acreditado en Caja Operativa Pyme.`);
  }

  settleFinalQuoteDelivery(quote: BudgetQuote): void {
    const advanceUsd = quote.minimumAdvanceUsd || Math.round(quote.totalPriceUsd * 0.5 * 100) / 100;
    const remainingUsd = Math.max(0, Math.round((quote.totalPriceUsd - advanceUsd) * 100) / 100);

    this.financeService.settlePymeSaleWithDrawers({
      title: `Liquidación Final (${quote.description}) - Cliente: ${quote.clientName}`,
      totalUsd: remainingUsd,
      vaultId: 'vault-pyme-caja',
      drawer1Usd: Number((remainingUsd * 0.5).toFixed(2)),
      drawer2Usd: Number((remainingUsd * 0.3).toFixed(2)),
      drawer3Usd: Number((remainingUsd * 0.2).toFixed(2)),
    });

    this.financeService.updateQuoteStatus(quote.id, 'completed');
    this.toast.success(
      `🏁 Entrega final liquidada (+$${remainingUsd} USD) en Caja Operativa Pyme con partición de 3 Gavetas.`,
    );
  }

  async copyQuoteForWhatsApp(savedQuote?: BudgetQuote): Promise<void> {
    const bcv = this.financeService.currentBcvRate();
    const client = savedQuote ? savedQuote.clientName : this.clientName().trim() || 'Cliente';
    const quoteRef = savedQuote ? savedQuote.quoteNumber : `COT-${Date.now().toString().slice(-4)}`;
    const type = savedQuote ? savedQuote.type : this.quoteType();
    const preset = this.industryPresets[type] || this.industryPresets.custom_universal;
    const desc = savedQuote ? savedQuote.description : this.projectTitle().trim() || preset.defaultTitle;
    const totalUsd = savedQuote ? savedQuote.totalPriceUsd : this.currentQuoteTotals().totalUsd;
    const totalVes = Number((totalUsd * bcv).toFixed(2));
    const advanceUsd = savedQuote ? savedQuote.minimumAdvanceUsd : this.currentQuoteTotals().advanceUsd;
    const advancePct = savedQuote ? (savedQuote.advancePercent || 50) : this.currentQuoteTotals().advancePct;

    const items = savedQuote?.lineItems && savedQuote.lineItems.length > 0
      ? savedQuote.lineItems
      : this.lineItems();

    const itemsSummary = items
      .map((it) => `  • ${it.name} (${it.quantity} ${it.unit})`)
      .slice(0, 6)
      .join('\n');

    const text = [
      `💎 *HOMEL 360 SERVICES · PRESUPUESTO OFICIAL ${quoteRef}*`,
      `🏢 *Área de Negocio:* ${preset.icon} ${preset.label}`,
      `👤 *Cliente:* ${client}`,
      `🛠️ *Servicio / Proyecto:* ${desc}`,
      `📋 *Partidas Principales:*`,
      itemsSummary,
      `────────────────────────────`,
      `💵 *Total Final:* $${totalUsd.toFixed(2)} USD`,
      `🏛️ *Equivalente Oficial BCV (${bcv.toFixed(2)} Bs/$):* Bs ${totalVes.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      `⚡ *Anticipo Requerido (${advancePct}%):* $${advanceUsd.toFixed(2)} USD`,
      `✅ *Garantía:* Materiales de primera calidad, mano de obra calificada y respaldo técnico.`,
      `⏳ *Validez:* 7 días continuos a partir de la emisión.`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      this.toast.success('📲 Resumen comercial multi-área copiado (listo para WhatsApp/Telegram).');
    } catch {
      this.toast.info(`Resumen preparado: Total $${totalUsd.toFixed(2)} USD`);
    }
  }

  deleteSavedQuote(quote: BudgetQuote): void {
    this.financeService.deleteQuote(quote.id);
    this.toast.info(`Cotización #${quote.quoteNumber} eliminada.`);
  }

  getSectorIcon(type: QuoteType): string {
    return this.industryPresets[type]?.icon || '📝';
  }

  getSectorLabel(type: QuoteType): string {
    return this.industryPresets[type]?.label || 'General';
  }
}
