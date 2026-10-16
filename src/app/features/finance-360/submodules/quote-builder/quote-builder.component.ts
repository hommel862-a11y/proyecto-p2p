import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Finance360Service } from '../../../../core/finance-360.service';
import { ToastService } from '../../../../core/toast.service';
import {
  type BudgetQuote,
  type QuoteType,
  computeTriMonetaryAmount,
} from '../../../../core/models/finance-360.models';

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

  // Active Quote Mode
  readonly quoteType = signal<QuoteType>('automotive_bodywork');

  // Client Info
  readonly clientName = signal<string>('Carlos Rodríguez');
  readonly clientPhone = signal<string>('0412-5551234');
  readonly clientDoc = signal<string>('V-18456789');

  // Automotive Form State
  readonly vehicleModel = signal<string>('Toyota Corolla 2012');
  readonly vehicleColor = signal<string>('Gris Plata');
  readonly vehiclePlate = signal<string>('AA123BB');
  readonly selectedPiecesCount = signal<number>(2); // ej. Parachoque + Capó
  readonly costPerPieceMaterialsUsd = signal<number>(35); // Fondo, pintura, laca
  readonly laborPerPieceUsd = signal<number>(50); // Mano de obra por pieza

  // Construction Form State
  readonly projectTitle = signal<string>('Pintura Interior y Friso');
  readonly areaSquareMeters = signal<number>(65); // 65 m²
  readonly materialCostPerM2 = signal<number>(4.5); // Pintura, pasta, lijas
  readonly laborCostPerM2 = signal<number>(6.0); // Mano de obra albañil/pintor

  // Common Financials
  readonly profitMarginPercent = signal<number>(25); // 25% margen comercial
  readonly technicalWastePercent = signal<number>(10); // +10% merma técnica obligatoria

  // Modal Dual PDF Preview State
  readonly previewModalOpen = signal<boolean>(false);
  readonly previewMode = signal<'client' | 'internal'>('client');

  /** Automotive Calculation with +10% Technical Waste */
  readonly automotiveCalc = computed(() => {
    const pieces = this.selectedPiecesCount();
    const rawMaterials = pieces * this.costPerPieceMaterialsUsd();
    const waste = (rawMaterials * this.technicalWastePercent()) / 100;
    const totalMaterials = rawMaterials + waste;
    const totalLabor = pieces * this.laborPerPieceUsd();
    const subtotal = totalMaterials + totalLabor;
    const profit = (subtotal * this.profitMarginPercent()) / 100;
    const totalUsd = subtotal + profit;
    const bcv = this.financeService.currentBcvRate();

    return {
      rawMaterials,
      waste,
      totalMaterials,
      totalLabor,
      subtotal,
      profit,
      totalUsd,
      totalVes: totalUsd * bcv,
      bcv,
    };
  });

  /** Construction Calculation with +10% Technical Waste */
  readonly constructionCalc = computed(() => {
    const m2 = this.areaSquareMeters();
    const rawMaterials = m2 * this.materialCostPerM2();
    const waste = (rawMaterials * this.technicalWastePercent()) / 100;
    const totalMaterials = rawMaterials + waste;
    const totalLabor = m2 * this.laborCostPerM2();
    const subtotal = totalMaterials + totalLabor;
    const profit = (subtotal * this.profitMarginPercent()) / 100;
    const totalUsd = subtotal + profit;
    const bcv = this.financeService.currentBcvRate();

    return {
      rawMaterials,
      waste,
      totalMaterials,
      totalLabor,
      subtotal,
      profit,
      totalUsd,
      totalVes: totalUsd * bcv,
      bcv,
    };
  });

  readonly currentQuoteTotals = computed(() => {
    return this.quoteType() === 'automotive_bodywork'
      ? this.automotiveCalc()
      : this.constructionCalc();
  });

  readonly savedQuotes = computed<BudgetQuote[]>(() => {
    return this.financeService.state().quotes;
  });

  saveCurrentQuote(): void {
    const client = this.clientName().trim();
    if (!client) {
      this.toast.warn('Por favor ingresa el nombre del cliente.');
      return;
    }

    const type = this.quoteType();
    const totals = this.currentQuoteTotals();
    const description =
      type === 'automotive_bodywork'
        ? `Latonería & Pintura: ${this.vehicleModel()}`
        : `Obra ${this.areaSquareMeters()}m²: ${this.projectTitle()}`;

    const quoteNumber = `COT-${Date.now().toString().slice(-6)}`;

    const quote = this.financeService.saveQuote({
      quoteNumber,
      clientName: client,
      clientPhone: this.clientPhone().trim() || undefined,
      type,
      description,
      scopeDetails:
        type === 'automotive_bodywork'
          ? {
              vehicleModel: this.vehicleModel(),
              vehicleColor: this.vehicleColor(),
              vehiclePlate: this.vehiclePlate(),
              piecesCount: this.selectedPiecesCount(),
            }
          : {
              projectTitle: this.projectTitle(),
              areaSquareMeters: this.areaSquareMeters(),
            },
      materials: [
        {
          name:
            type === 'automotive_bodywork'
              ? 'Insumos de Latonería & Pintura 2K'
              : 'Materiales & Insumos de Obra',
          quantity:
            type === 'automotive_bodywork'
              ? this.selectedPiecesCount()
              : this.areaSquareMeters(),
          unit: type === 'automotive_bodywork' ? 'piezas' : 'm2',
          unitCostUsd:
            type === 'automotive_bodywork'
              ? this.costPerPieceMaterialsUsd()
              : this.materialCostPerM2(),
          wasteFactorPercent: this.technicalWastePercent(),
          totalCostUsd: totals.totalMaterials,
        },
      ],
      laborCostUsd: totals.totalLabor,
      laborType: type === 'automotive_bodywork' ? 'commission' : 'm2_rate',
      totalMaterialsCostUsd: totals.totalMaterials,
      subtotalCostUsd: totals.subtotal,
      profitMarginPercent: this.profitMarginPercent(),
      totalPriceUsd: totals.totalUsd,
      minimumAdvanceUsd: Math.round(totals.totalUsd * 0.5 * 100) / 100,
      bcvRateApplied: totals.bcv,
      totalPriceVes: totals.totalVes,
      status: 'draft',
    });

    this.toast.success(`Presupuesto #${quote.quoteNumber} guardado exitosamente.`);
  }

  openPreview(mode: 'client' | 'internal'): void {
    this.previewMode.set(mode);
    this.previewModalOpen.set(true);
  }

  printQuote(): void {
    window.print();
  }

  registerAdvanceDeposit(quote: BudgetQuote): void {
    const advanceUsd = Math.round(quote.totalPriceUsd * 0.5 * 100) / 100;
    const bcv = this.financeService.currentBcvRate();
    const parallel = this.financeService.currentParallelRate();
    const tri = computeTriMonetaryAmount(advanceUsd, 'USD', bcv, parallel);

    this.financeService.addIncome({
      title: `Anticipo (50%) Presupuesto: ${quote.description}`,
      scope: 'business',
      category: 'quote_advance',
      channel: 'bs_bank',
      vaultId: 'vault-pyme-caja',
      triMonetary: tri,
      date: new Date().toISOString().split('T')[0],
      notes: `Anticipo de cliente ${quote.clientName} (Presupuesto ${quote.quoteNumber})`,
    });

    this.financeService.updateQuoteStatus(quote.id, 'approved');
    this.toast.success(
      `💰 Anticipo de $${advanceUsd} USD acreditado en Caja Operativa Pyme.`,
    );
  }

  /** Settles the remaining 50% upon final job delivery using the 3-Drawer Firewall */
  settleFinalQuoteDelivery(quote: BudgetQuote): void {
    const remainingUsd = Math.round(quote.totalPriceUsd * 0.5 * 100) / 100;
    this.financeService.settlePymeSaleWithDrawers({
      title: `Liquidación Final (50%) Entrega: ${quote.description} (${quote.clientName})`,
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

  /** Copies a commercial summary ready to paste in WhatsApp or Telegram */
  async copyQuoteForWhatsApp(savedQuote?: BudgetQuote): Promise<void> {
    const bcv = this.financeService.currentBcvRate();
    const client = savedQuote ? savedQuote.clientName : this.clientName().trim() || 'Cliente';
    const desc = savedQuote
      ? savedQuote.description
      : this.quoteType() === 'automotive_bodywork'
        ? `Latonería y Pintura (${this.vehicleModel()} · ${this.selectedPiecesCount()} pzas)`
        : `Obra ${this.projectTitle()} (${this.areaSquareMeters()} m²)`;
    const totalUsd = savedQuote ? savedQuote.totalPriceUsd : this.currentQuoteTotals().totalUsd;
    const totalVes = totalUsd * bcv;
    const advanceUsd = totalUsd * 0.5;
    const quoteRef = savedQuote ? savedQuote.quoteNumber : `COT-${Date.now().toString().slice(-4)}`;

    const text = [
      `💎 *HOMEL 360 SERVICES · PRESUPUESTO ${quoteRef}*`,
      `👤 *Cliente:* ${client}`,
      `🛠️ *Servicio:* ${desc}`,
      `────────────────────`,
      `💵 *Total Final:* $${totalUsd.toFixed(2)} USD`,
      `🏛️ *Equivalente BCV (${bcv.toFixed(2)} Bs/$):* Bs ${totalVes.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      `⚡ *Anticipo 50% para iniciar:* $${advanceUsd.toFixed(2)} USD`,
      `✅ *Incluye:* Materiales de 1ra + Mano de Obra Calificada + Garantía Técnica.`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      this.toast.success('📲 Resumen comercial copiado al portapapeles (listo para WhatsApp/Telegram).');
    } catch {
      this.toast.info(`Resumen listo: Total $${totalUsd.toFixed(2)} USD`);
    }
  }
}
