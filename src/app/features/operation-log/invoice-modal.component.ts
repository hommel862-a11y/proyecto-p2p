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
import { ToastService } from '../../core/toast.service';
import {
  type Operation,
  type GeneratedInvoice,
  type IssuerProfile,
  type InvoiceTemplateType,
  COMPLIANT_SERVICE_CONCEPTS,
  generateInvoicesFromAppOperations,
  generateInvoicesFromTransactions,
  parseBinanceP2pCsv,
  generateInvoicePdf,
  generateInvoiceBatchZip,
} from '@p2p/core';

const ISSUER_STORAGE_KEY = 'p2p.invoice_engine.issuer_profile';

@Component({
  selector: 'app-invoice-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div
      class="modal-backdrop"
      (click)="$event.target === $event.currentTarget && close.emit()"
      (keydown.escape)="close.emit()"
      tabindex="0"
      role="button"
      aria-label="Cerrar modal de facturación">
      <div
        class="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-inv-title"
        style="max-width: 950px; width: 95vw; max-height: 90vh; overflow-y: auto;">
        
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; border-bottom: 1px solid var(--border); padding-bottom: 10px;">
          <div>
            <h3 id="modal-inv-title" style="margin: 0; display: flex; align-items: center; gap: 8px;">
              <span>🛡️</span> Facturación Fiscal y Blindaje Bancario (Invoice Engine)
            </h3>
            <p style="margin: 4px 0 0; font-size: 0.8rem; color: var(--muted);">
              Genera facturas PDF en lote por servicios intangibles (Marketing, IT, Consultoría) sin referencias cripto para justificar fondos ante bancos y neobancos (Banesco, Mercantil Panamá, Simly, Facebank).
            </p>
          </div>
          <button type="button" class="btn btn-ghost" (click)="close.emit()" style="padding: 2px 8px; font-size: 1.1rem;">✕</button>
        </div>

        <!-- Mode selector: App operations vs CSV Upload -->
        <div style="display: flex; gap: 8px; margin-bottom: 14px;">
          <button
            type="button"
            class="btn"
            [class.btn-primary]="sourceMode() === 'app'"
            [class.btn-secondary]="sourceMode() !== 'app'"
            (click)="setSourceMode('app')">
            📂 Desde Operaciones Registradas ({{ sellOperations().length }} Ventas)
          </button>
          <button
            type="button"
            class="btn"
            [class.btn-primary]="sourceMode() === 'csv'"
            [class.btn-secondary]="sourceMode() !== 'csv'"
            (click)="setSourceMode('csv')">
            📑 Cargar CSV de Binance P2P
          </button>
        </div>

        <!-- Template Style Selector -->
        <div style="background: rgba(30, 41, 59, 0.4); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; margin-bottom: 16px;">
          <div style="font-size: 0.78rem; font-weight: 700; color: var(--accent); text-transform: uppercase; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
            <span>Plantilla de Facturación y Destino Bancario</span>
            <span style="font-size: 0.72rem; color: var(--muted); font-weight: normal;">Selecciona el formato según la entidad receptora</span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px;">
            <button
              type="button"
              class="btn"
              [style.background]="selectedTemplate() === 'NEOBANK_USD' ? 'rgba(56, 189, 248, 0.2)' : 'var(--panel-2)'"
              [style.borderColor]="selectedTemplate() === 'NEOBANK_USD' ? '#38bdf8' : 'var(--border)'"
              [style.color]="selectedTemplate() === 'NEOBANK_USD' ? '#38bdf8' : 'var(--text)'"
              style="text-align: left; padding: 10px; display: flex; flex-direction: column; gap: 4px;"
              (click)="selectedTemplate.set('NEOBANK_USD')">
              <div style="font-weight: 600; font-size: 0.85rem; display: flex; align-items: center; gap: 6px;">
                <span>🌐</span> Neobancos USD / EUR
              </div>
              <div style="font-size: 0.72rem; color: var(--muted);">
                Simly, Banesco Panamá, Facebank, Wise. Factura intangible con liquidación en divisas.
              </div>
            </button>

            <button
              type="button"
              class="btn"
              [style.background]="selectedTemplate() === 'LOCAL_VES' ? 'rgba(234, 179, 8, 0.2)' : 'var(--panel-2)'"
              [style.borderColor]="selectedTemplate() === 'LOCAL_VES' ? '#eab308' : 'var(--border)'"
              [style.color]="selectedTemplate() === 'LOCAL_VES' ? '#eab308' : 'var(--text)'"
              style="text-align: left; padding: 10px; display: flex; flex-direction: column; gap: 4px;"
              (click)="selectedTemplate.set('LOCAL_VES')">
              <div style="font-weight: 600; font-size: 0.85rem; display: flex; align-items: center; gap: 6px;">
                <span>🇻🇪</span> Banca Local VES
              </div>
              <div style="font-size: 0.72rem; color: var(--muted);">
                Banesco, Mercantil, BDV. Comprobante en Bs con ref. Pago Móvil / Banco nacional.
              </div>
            </button>

            <button
              type="button"
              class="btn"
              [style.background]="selectedTemplate() === 'CORPORATE_BRANDED' ? 'rgba(16, 185, 129, 0.2)' : 'var(--panel-2)'"
              [style.borderColor]="selectedTemplate() === 'CORPORATE_BRANDED' ? '#10b981' : 'var(--border)'"
              [style.color]="selectedTemplate() === 'CORPORATE_BRANDED' ? '#10b981' : 'var(--text)'"
              style="text-align: left; padding: 10px; display: flex; flex-direction: column; gap: 4px;"
              (click)="selectedTemplate.set('CORPORATE_BRANDED')">
              <div style="font-weight: 600; font-size: 0.85rem; display: flex; align-items: center; gap: 6px;">
                <span>🏛️</span> Corporativo Institucional
              </div>
              <div style="font-size: 0.72rem; color: var(--muted);">
                Con sello/monograma corporativo, RIF/EIN y notas fiscales estrictas.
              </div>
            </button>
          </div>
        </div>

        <!-- CSV File Input when in CSV mode -->
        @if (sourceMode() === 'csv') {
          <div style="background: var(--panel-2); border: 2px dashed var(--line-strong); border-radius: var(--radius); padding: 16px; text-align: center; margin-bottom: 16px;">
            <p style="margin: 0 0 8px; font-size: 0.85rem; color: var(--text);">
              Selecciona o arrastra el reporte CSV exportado de Binance P2P
            </p>
            <input
              #csvInput
              type="file"
              accept=".csv,text/csv"
              (change)="onCsvSelected($event)"
              style="display: none;"
            />
            <button type="button" class="btn btn-secondary" (click)="csvInput.click()">
              📁 Explorar archivo CSV...
            </button>
            @if (csvFileName()) {
              <span style="margin-left: 10px; font-size: 0.8rem; color: var(--accent);">
                ✔ {{ csvFileName() }} ({{ csvRowsCount() }} órdenes detectadas)
              </span>
            }
          </div>
        }

        <!-- Issuer Profile Configuration -->
        <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; margin-bottom: 16px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <div style="font-size: 0.78rem; font-weight: 700; color: var(--gold); text-transform: uppercase;">
              Datos del Emisor Comercial (Tus datos fiscales)
            </div>
            <!-- Logo upload trigger -->
            <div style="display: flex; align-items: center; gap: 8px;">
              @if (issuer().logoDataUrl) {
                <img
                  [src]="issuer().logoDataUrl"
                  alt="Logo Corporativo"
                  style="max-height: 24px; max-width: 60px; object-fit: contain; border-radius: 3px; background: white; padding: 2px;"
                />
                <button
                  type="button"
                  class="btn btn-ghost"
                  style="padding: 2px 6px; font-size: 0.7rem; color: var(--danger);"
                  (click)="removeLogo()"
                  title="Eliminar logotipo">
                  ✕ Quitar logo
                </button>
              }
              <input
                #logoInput
                type="file"
                accept="image/*"
                (change)="onLogoSelected($event)"
                style="display: none;"
              />
              <button
                type="button"
                class="btn btn-secondary"
                style="padding: 2px 8px; font-size: 0.72rem;"
                (click)="logoInput.click()">
                🖼️ {{ issuer().logoDataUrl ? 'Cambiar Logo' : 'Cargar Logo Empresa' }}
              </button>
            </div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
            <div>
              <label class="terminal-label"><span>Razón Social / Nombre</span></label>
              <input
                type="text"
                class="terminal-input"
                [value]="issuer().businessName"
                (input)="updateIssuerField('businessName', $any($event.target).value)"
                placeholder="Ej: Soluciones Digitales C.A."
              />
            </div>
            <div>
              <label class="terminal-label"><span>RIF / ID Fiscal</span></label>
              <input
                type="text"
                class="terminal-input"
                [value]="issuer().taxId"
                (input)="updateIssuerField('taxId', $any($event.target).value)"
                placeholder="Ej: J-50123456-7"
              />
            </div>
            <div>
              <label class="terminal-label"><span>Dirección Fiscal</span></label>
              <input
                type="text"
                class="terminal-input"
                [value]="issuer().address"
                (input)="updateIssuerField('address', $any($event.target).value)"
                placeholder="Ej: Caracas, Venezuela"
              />
            </div>
            <div>
              <label class="terminal-label"><span>Concepto de Servicio</span></label>
              <select
                class="terminal-select"
                [value]="selectedConceptId()"
                (change)="selectedConceptId.set($any($event.target).value)">
                <option value="">Rotación Inteligente (Recomendado)</option>
                @for (c of availableConcepts; track c.id) {
                  <option [value]="c.id">{{ c.serviceTitle }}</option>
                }
              </select>
            </div>
          </div>
        </div>

        <!-- Preview Table -->
        <div style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; color: var(--muted);">
              Vista Previa del Lote ({{ previewInvoices().length }} Facturas a Emitir)
            </span>
            <span style="font-size: 0.82rem; color: var(--gold); font-weight: 600;">
              Total Facturado: {{ totalBatchAmount() | number:'1.2-2' }} {{ batchCurrency() }}
            </span>
          </div>

          @if (previewInvoices().length === 0) {
            <div style="padding: 24px; text-align: center; color: var(--muted); font-size: 0.85rem; border: 1px solid var(--border); border-radius: var(--radius);">
              No hay operaciones de venta registradas para facturar. Realiza ventas o importa un CSV de Binance.
            </div>
          } @else {
            <div style="max-height: 250px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius);">
              <table style="width: 100%; border-collapse: collapse; font-size: 0.78rem; text-align: left;">
                <thead style="background: var(--panel-2); position: sticky; top: 0;">
                  <tr style="border-bottom: 1px solid var(--border);">
                    <th style="padding: 6px 10px;">Factura #</th>
                    <th style="padding: 6px 10px;">Fecha</th>
                    <th style="padding: 6px 10px;">Cliente</th>
                    <th style="padding: 6px 10px;">Concepto Intangible</th>
                    <th style="padding: 6px 10px;">Canal / Destino</th>
                    <th style="padding: 6px 10px; text-align: right;">Total</th>
                    <th style="padding: 6px 10px; text-align: center;">Ticket</th>
                    <th style="padding: 6px 10px; text-align: center;">PDF</th>
                  </tr>
                </thead>
                <tbody>
                  @for (inv of previewInvoices(); track inv.invoiceNumber) {
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                      <td style="padding: 6px 10px; font-family: monospace; color: var(--gold);">{{ inv.invoiceNumber }}</td>
                      <td style="padding: 6px 10px;">{{ inv.issueDate }}</td>
                      <td style="padding: 6px 10px; font-weight: 500;">{{ inv.client.name }}</td>
                      <td style="padding: 6px 10px; color: var(--muted); max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        {{ inv.items[0].description }}
                      </td>
                      <td style="padding: 6px 10px; font-size: 0.72rem; color: var(--accent);">
                        {{ inv.paymentMethodOrBank || inv.templateType }}
                      </td>
                      <td style="padding: 6px 10px; text-align: right; font-weight: 600;">
                        {{ inv.currency }} {{ inv.total | number:'1.2-2' }}
                      </td>
                      <td style="padding: 6px 10px; text-align: center;">
                        <span
                          class="badge"
                          [style.background]="inv.ticketTier === 'LOW' ? 'rgba(56, 189, 248, 0.2)' : inv.ticketTier === 'MID' ? 'rgba(234, 179, 8, 0.2)' : 'rgba(168, 85, 247, 0.2)'"
                          [style.color]="inv.ticketTier === 'LOW' ? '#38bdf8' : inv.ticketTier === 'MID' ? '#eab308' : '#c084fc'">
                          {{ inv.ticketTier }}
                        </span>
                      </td>
                      <td style="padding: 6px 10px; text-align: center;">
                        <button
                          type="button"
                          class="btn btn-ghost"
                          style="padding: 2px 6px; font-size: 0.72rem;"
                          (click)="downloadSinglePdf(inv)"
                          title="Descargar este PDF individual">
                          📄 PDF
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>

        <!-- Footer Actions -->
        <div class="modal-actions" style="display: flex; justify-content: space-between; align-items: center;">
          <button type="button" class="btn btn-ghost" (click)="close.emit()">
            Cerrar
          </button>
          <div style="display: flex; gap: 8px;">
            <button
              type="button"
              class="btn btn-primary"
              [disabled]="previewInvoices().length === 0 || isGenerating()"
              (click)="downloadBatchZip()">
              {{ isGenerating() ? '⏳ Generando Lote...' : '📦 Descargar Lote Completo en ZIP' }}
            </button>
          </div>
        </div>

      </div>
    </div>
  `,
})
export class InvoiceModalComponent {
  readonly operations = input<readonly Operation[]>([]);
  readonly close = output<void>();

  private readonly toast = inject(ToastService);

  readonly availableConcepts = COMPLIANT_SERVICE_CONCEPTS;

  readonly sourceMode = signal<'app' | 'csv'>('app');
  readonly selectedTemplate = signal<InvoiceTemplateType>('NEOBANK_USD');
  readonly selectedConceptId = signal<string>('');
  readonly isGenerating = signal<boolean>(false);

  readonly csvFileName = signal<string>('');
  readonly csvParsedRows = signal<any[]>([]);

  readonly issuer = signal<IssuerProfile>(this.loadIssuerProfile());

  readonly sellOperations = computed(() =>
    this.operations().filter((op) => op.type === 'sell' && op.vesAmount > 0),
  );

  readonly previewInvoices = computed<GeneratedInvoice[]>(() => {
    const iss = this.issuer();
    const conceptId = this.selectedConceptId() || undefined;
    const template = this.selectedTemplate();

    if (this.sourceMode() === 'app') {
      return generateInvoicesFromAppOperations(this.sellOperations(), iss, {
        customServiceConceptId: conceptId,
        invoicePrefix: 'FAC',
        templateType: template,
      });
    } else {
      return generateInvoicesFromTransactions(this.csvParsedRows(), iss, {
        customServiceConceptId: conceptId,
        invoicePrefix: 'FAC',
        templateType: template,
      });
    }
  });

  readonly csvRowsCount = computed(() => this.csvParsedRows().length);

  readonly totalBatchAmount = computed(() =>
    this.previewInvoices().reduce((acc, inv) => acc + inv.total, 0),
  );

  readonly batchCurrency = computed(() =>
    this.previewInvoices().length > 0 ? this.previewInvoices()[0].currency : 'VES',
  );

  setSourceMode(mode: 'app' | 'csv'): void {
    this.sourceMode.set(mode);
  }

  updateIssuerField(field: keyof IssuerProfile, value: string): void {
    const updated = { ...this.issuer(), [field]: value };
    this.issuer.set(updated);
    this.persistIssuerProfile(updated);
  }

  onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (dataUrl) {
        this.updateIssuerField('logoDataUrl', dataUrl);
        this.toast.success('Logotipo corporativo cargado y guardado.');
      }
    };
    reader.readAsDataURL(file);
  }

  removeLogo(): void {
    this.updateIssuerField('logoDataUrl', '');
    this.toast.info('Logotipo eliminado.');
  }

  onCsvSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.csvFileName.set(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) {
        const rows = parseBinanceP2pCsv(text);
        this.csvParsedRows.set(rows);
        this.toast.info(`CSV procesado: ${rows.length} órdenes detectadas.`);
      }
    };
    reader.readAsText(file);
  }

  downloadSinglePdf(invoice: GeneratedInvoice): void {
    try {
      const pdfBytes = generateInvoicePdf(invoice);
      const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${invoice.invoiceNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 2500);
      this.toast.info(`Factura ${invoice.invoiceNumber}.pdf descargada.`);
    } catch (err: any) {
      console.error('[InvoiceModal] Error generando PDF:', err);
      this.toast.error(`Error generando PDF: ${err.message}`);
    }
  }

  downloadBatchZip(): void {
    const invoices = this.previewInvoices();
    if (invoices.length === 0) return;

    this.isGenerating.set(true);
    try {
      const zipBytes = generateInvoiceBatchZip(invoices);
      const blob = new Blob([zipBytes as unknown as BlobPart], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const today = new Date().toISOString().split('T')[0];
      a.download = `facturas_fiscales_lote_${today}.zip`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 2500);
      this.toast.info(`Lote descargado: ${invoices.length} facturas en formato ZIP.`);
    } catch (err: any) {
      console.error('[InvoiceModal] Error al empaquetar lote ZIP:', err);
      this.toast.error(`Error al empaquetar lote ZIP: ${err.message}`);
    } finally {
      this.isGenerating.set(false);
    }
  }

  private loadIssuerProfile(): IssuerProfile {
    try {
      const raw = localStorage.getItem(ISSUER_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // fallback
    }
    return {
      businessName: 'Servicios Digitales y Consultoría C.A.',
      taxId: 'J-50123456-7',
      address: 'Caracas, Venezuela',
      email: 'facturacion@serviciosdigitales.com',
    };
  }

  private persistIssuerProfile(profile: IssuerProfile): void {
    try {
      localStorage.setItem(ISSUER_STORAGE_KEY, JSON.stringify(profile));
    } catch {
      // ignore
    }
  }
}
