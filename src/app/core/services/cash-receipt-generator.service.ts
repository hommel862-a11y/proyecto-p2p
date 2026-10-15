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

@Injectable({ providedIn: 'root' })
export class CashReceiptGeneratorService {
  /**
   * Generates a unique sequential receipt number: REC-YYYYMMDD-XXXX
   */
  generateReceiptNumber(): string {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `REC-${today}-${rand}`;
  }

  /**
   * Builds an institutional, print-ready HTML template formatted for
   * both mobile screens and A4/Letter thermal/desk printers.
   */
  generateReceiptHtml(data: CashReceiptData): string {
    const formattedUsd = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(data.amountUsd);

    const formattedVes = new Intl.NumberFormat('es-VE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(data.amountVes);

    return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Comprobante de Pago - ${data.receiptNumber}</title>
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
      margin-bottom: 32px;
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
        <h3>${data.receiptNumber}</h3>
        <p>Fecha: ${data.date}</p>
      </div>
    </div>

    <div class="amount-banner">
      <div class="amount-main">${formattedUsd}</div>
      <div class="amount-secondary">Equivalente: Bs ${formattedVes} (Tasa BCV: ${data.bcvRateApplied.toFixed(2)})</div>
    </div>

    <div class="grid">
      <div>
        <div class="item-label">Pagador / Cliente</div>
        <div class="item-value">${data.payerName} ${data.payerIdDoc ? `(CI/RIF: ${data.payerIdDoc})` : ''}</div>
      </div>
      <div>
        <div class="item-label">Beneficiario / Receptor</div>
        <div class="item-value">${data.receiverName} ${data.receiverIdDoc ? `(CI/RIF: ${data.receiverIdDoc})` : ''}</div>
      </div>
      <div>
        <div class="item-label">Método de Pago</div>
        <div class="item-value">${data.paymentMethod}</div>
      </div>
      <div>
        <div class="item-label">Entidad / Comercio</div>
        <div class="item-value">${data.businessName || 'Transacción Particular'}</div>
      </div>
    </div>

    <div class="concept-box">
      <div class="item-label">Concepto del Pago</div>
      <div class="concept-text">${data.concept}</div>
    </div>

    <div class="signatures">
      <div>
        <div class="sig-line">Firma de Quien Entrega</div>
      </div>
      <div>
        <div class="sig-line">Firma de Quien Recibe Conforme</div>
      </div>
    </div>

    <div class="footer">
      Documento probatorio interno emitido por Homel Suite 360 • Fecha de emisión: ${new Date().toLocaleString()}
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Opens the print dialog for this receipt.
   */
  printReceipt(data: CashReceiptData): void {
    const html = this.generateReceiptHtml(data);
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 250);
    }
  }
}
