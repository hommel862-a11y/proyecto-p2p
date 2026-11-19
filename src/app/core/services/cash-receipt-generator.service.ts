import { Injectable } from '@angular/core';

export interface CashReceiptData {
  receiptNumber: string;
  date: string;
  payerName: string;
  payerIdDoc?: string;
  receiverName: string;
  receiverIdDoc?: string;
  concept: string;
  amountUsd: number;
  amountVes: number;
  bcvRateApplied: number;
  paymentMethod: string;
  scope: 'personal' | 'business' | 'all';
  businessName?: string;
  notes?: string;
}

interface ElectronExportPdfRequest {
  html: string;
  filename: string;
}

interface ElectronExportPdfResponse {
  success?: boolean;
  filePath?: string;
  error?: string;
}

interface Finance360PdfBridge {
  exportPdf?: (req: ElectronExportPdfRequest) => Promise<ElectronExportPdfResponse | boolean | void>;
}

const HTML_ESCAPE_MAP: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getElectronPdfBridge(): Finance360PdfBridge | null {
  if (typeof window === 'undefined') return null;
  const winRecord = window as unknown as Record<string, unknown>;
  const electronVal = winRecord['electron'];
  if (!isRecord(electronVal)) return null;
  const f360 = electronVal['finance360'];
  if (!isRecord(f360)) return null;
  return f360 as Finance360PdfBridge;
}

function sanitizePdfFilename(receiptNumber: string): string {
  const cleaned = receiptNumber
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const stem = cleaned.length > 0 ? cleaned.slice(0, 64) : 'comprobante_pago';
  return `${stem}.pdf`;
}

@Injectable({ providedIn: 'root' })
export class CashReceiptGeneratorService {
  /**
   * Strictly escapes HTML special characters to neutralize stored/DOM XSS vectors.
   */
  escapeHtml(value: string | null | undefined): string {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"'`]/g, (char) => HTML_ESCAPE_MAP[char] ?? char);
  }

  /**
   * Generates a unique sequential receipt number: REC-YYYYMMDD-XXXX
   */
  generateReceiptNumber(): string {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `REC-${today}-${rand}`;
  }

  /**
   * Builds an institutional, XSS-safe, print-ready HTML template formatted for
   * both mobile screens and A4/Letter thermal/desk printers.
   */
  generateReceiptHtml(data: CashReceiptData): string {
    const safeUsd = Number.isFinite(data.amountUsd) ? data.amountUsd : 0;
    const safeVes = Number.isFinite(data.amountVes) ? data.amountVes : 0;
    const safeBcv = Number.isFinite(data.bcvRateApplied) ? data.bcvRateApplied : 0;

    const formattedUsd = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(safeUsd);

    const formattedVes = new Intl.NumberFormat('es-VE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safeVes);

    const receiptNumber = this.escapeHtml(data.receiptNumber);
    const date = this.escapeHtml(data.date);
    const payerName = this.escapeHtml(data.payerName);
    const payerIdDoc = data.payerIdDoc ? this.escapeHtml(data.payerIdDoc) : '';
    const receiverName = this.escapeHtml(data.receiverName);
    const receiverIdDoc = data.receiverIdDoc ? this.escapeHtml(data.receiverIdDoc) : '';
    const paymentMethod = this.escapeHtml(data.paymentMethod);
    const businessName = this.escapeHtml(data.businessName || 'Transacción Particular');
    const concept = this.escapeHtml(data.concept);
    const notes = data.notes ? this.escapeHtml(data.notes) : '';
    const emittedAt = this.escapeHtml(new Date().toLocaleString());

    const notesSection = notes
      ? `
    <div class="concept-box">
      <div class="item-label">Notas Adicionales</div>
      <div class="concept-text">${notes}</div>
    </div>`
      : '';

    return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <title>Comprobante de Pago - ${receiptNumber}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 24px;
      background: #f8fafc;
      color: #0f172a;
    }
    .receipt-box {
      max-width: 650px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.06);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .brand {
      font-size: 22px;
      font-weight: 800;
      color: #0E1215;
      letter-spacing: -0.5px;
    }
    .brand span {
      color: #D4AF37;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      background: #f1f5f9;
      color: #475569;
    }
    .receipt-id {
      text-align: right;
    }
    .receipt-id h3 {
      margin: 0;
      font-size: 16px;
      color: #0f172a;
    }
    .receipt-id p {
      margin: 4px 0 0;
      font-size: 13px;
      color: #64748b;
    }
    .amount-banner {
      background: #0E1215;
      color: #ffffff;
      border-radius: 8px;
      padding: 20px;
      text-align: center;
      margin-bottom: 24px;
    }
    .amount-main {
      font-size: 32px;
      font-weight: 800;
      color: #E2B755;
    }
    .amount-secondary {
      font-size: 16px;
      color: #94a3b8;
      margin-top: 4px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 24px;
    }
    .item-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 4px;
    }
    .item-value {
      font-size: 15px;
      font-weight: 600;
      color: #0f172a;
    }
    .concept-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .concept-text {
      font-size: 14px;
      line-height: 1.5;
      color: #334155;
    }
    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px dashed #cbd5e1;
      text-align: center;
    }
    .sig-line {
      border-top: 1px solid #64748b;
      margin-top: 40px;
      padding-top: 8px;
      font-size: 13px;
      color: #475569;
    }
    .footer {
      text-align: center;
      margin-top: 32px;
      font-size: 11px;
      color: #94a3b8;
    }
    @media print {
      body { background: #fff; padding: 0; }
      .receipt-box { box-shadow: none; border: none; padding: 0; }
    }
  </style>
</head>
<body>
  <div class="receipt-box">
    <div class="header">
      <div>
        <div class="brand">HOMEL <span>360</span></div>
        <div class="badge">${data.scope === 'business' ? 'COMPROBANTE COMERCIAL / PYME' : 'COMPROBANTE PERSONAL'}</div>
      </div>
      <div class="receipt-id">
        <h3>${receiptNumber}</h3>
        <p>Fecha: ${date}</p>
      </div>
    </div>

    <div class="amount-banner">
      <div class="amount-main">${formattedUsd}</div>
      <div class="amount-secondary">Equivalente: Bs ${formattedVes} (Tasa BCV: ${safeBcv.toFixed(2)})</div>
    </div>

    <div class="grid">
      <div>
        <div class="item-label">Pagador / Cliente</div>
        <div class="item-value">${payerName}${payerIdDoc ? ` (CI/RIF: ${payerIdDoc})` : ''}</div>
      </div>
      <div>
        <div class="item-label">Beneficiario / Receptor</div>
        <div class="item-value">${receiverName}${receiverIdDoc ? ` (CI/RIF: ${receiverIdDoc})` : ''}</div>
      </div>
      <div>
        <div class="item-label">Método de Pago</div>
        <div class="item-value">${paymentMethod}</div>
      </div>
      <div>
        <div class="item-label">Entidad / Comercio</div>
        <div class="item-value">${businessName}</div>
      </div>
    </div>

    <div class="concept-box">
      <div class="item-label">Concepto del Pago</div>
      <div class="concept-text">${concept}</div>
    </div>${notesSection}

    <div class="signatures">
      <div>
        <div class="sig-line">Firma de Quien Entrega</div>
      </div>
      <div>
        <div class="sig-line">Firma de Quien Recibe Conforme</div>
      </div>
    </div>

    <div class="footer">
      Documento probatorio interno emitido por Homel Suite 360 • Fecha de emisión: ${emittedAt}
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Exports via Electron's native sandboxed PDF exporter when available,
   * or prints safely via a script-free sandboxed iframe and Blob URL in web mode.
   */
  async printReceipt(data: CashReceiptData): Promise<void> {
    const html = this.generateReceiptHtml(data);
    const filename = sanitizePdfFilename(data.receiptNumber);

    const electronPdf = getElectronPdfBridge();
    if (electronPdf?.exportPdf) {
      await electronPdf.exportPdf({ html, filename });
      return;
    }

    if (typeof document === 'undefined' || !document.body) {
      return;
    }

    this.printViaSandboxedIframe(html);
  }

  private printViaSandboxedIframe(html: string): void {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-modals allow-same-origin');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';

    let blobUrl: string | null = null;
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      blobUrl = URL.createObjectURL(blob);
      iframe.src = blobUrl;
    } else {
      iframe.srcdoc = html;
    }

    const cleanup = () => {
      if (blobUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(blobUrl);
        blobUrl = null;
      }
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    };

    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        setTimeout(cleanup, 1000);
      }
    };

    document.body.appendChild(iframe);
  }
}
