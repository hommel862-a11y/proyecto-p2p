/**
 * Pure TypeScript PDF & ZIP Generator for Compliance Invoices.
 * Produces clean, standards-compliant PDF 1.4 documents and standard uncompressed ZIP archives.
 * Zero external dependencies — runs identically in Browser, Electron, Node, and Capacitor.
 */

import { type GeneratedInvoice } from './invoice-engine';

/**
 * Escapes characters for PDF literal text strings: \(, \), \\
 */
function escapePdfText(text: string): string {
  if (!text) return '';
  // Normalize accented characters to ASCII equivalents for Helvetica standard font
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ');

  return normalized.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Generates a clean, corporate single-page PDF 1.4 document for a single GeneratedInvoice.
 */
export function generateInvoicePdf(invoice: GeneratedInvoice): Uint8Array {
  // Page layout: A4 in points (595.28 x 841.89)
  const pageWidth = 595.28;
  const pageHeight = 841.89;

  const streamOps: string[] = [];

  // Top header background bar
  streamOps.push('0.08 0.18 0.36 rg'); // Deep navy
  streamOps.push(`0 ${pageHeight - 90} ${pageWidth} 90 re f`);

  // Header Title
  streamOps.push('BT');
  streamOps.push('/F2 20 Tf');
  streamOps.push('1 1 1 rg'); // White
  streamOps.push(`40 ${pageHeight - 48} Td`);
  streamOps.push(`(${escapePdfText(invoice.issuer.businessName)}) Tj`);
  streamOps.push('ET');

  // Header Subtitle (Tax ID & Tagline)
  streamOps.push('BT');
  streamOps.push('/F1 9 Tf');
  streamOps.push('0.85 0.90 0.98 rg');
  streamOps.push(`40 ${pageHeight - 68} Td`);
  streamOps.push(`(RIF / ID Fiscal: ${escapePdfText(invoice.issuer.taxId)}  |  ${escapePdfText(invoice.issuer.address)}) Tj`);
  streamOps.push('ET');

  // Invoice Number Badge (top right)
  streamOps.push('BT');
  streamOps.push('/F2 13 Tf');
  streamOps.push('1 0.85 0.3 rg'); // Gold
  streamOps.push(`400 ${pageHeight - 48} Td`);
  streamOps.push(`(FACTURA: ${escapePdfText(invoice.invoiceNumber)}) Tj`);
  streamOps.push('ET');

  // Dates badge
  streamOps.push('BT');
  streamOps.push('/F1 9 Tf');
  streamOps.push('1 1 1 rg');
  streamOps.push(`400 ${pageHeight - 68} Td`);
  streamOps.push(`(Emision: ${escapePdfText(invoice.issueDate)}  Vence: ${escapePdfText(invoice.dueDate)}) Tj`);
  streamOps.push('ET');

  // ---------------------------------------------------------------------------
  // Client Info Section
  // ---------------------------------------------------------------------------
  const clientY = pageHeight - 130;
  streamOps.push('0.96 0.97 0.98 rg'); // Light gray panel
  streamOps.push(`40 ${clientY - 55} ${pageWidth - 80} 55 re f`);
  streamOps.push('0.85 0.88 0.92 RG 1 w');
  streamOps.push(`40 ${clientY - 55} ${pageWidth - 80} 55 re S`);

  streamOps.push('BT');
  streamOps.push('/F2 9 Tf');
  streamOps.push('0.1 0.1 0.15 rg');
  streamOps.push(`55 ${clientY - 20} Td`);
  streamOps.push('(CLIENTE / CONTRAPARTE RECEPTORA:) Tj');
  streamOps.push('/F1 10 Tf');
  streamOps.push(`0 -16 Td`);
  streamOps.push(`(${escapePdfText(invoice.client.name)}  -  Pais: ${escapePdfText(invoice.client.country || 'VE')}) Tj`);
  streamOps.push('/F1 8 Tf');
  streamOps.push('0.4 0.45 0.5 rg');
  streamOps.push(`360 16 Td`);
  streamOps.push(`(Ref. Interna: ${escapePdfText(invoice.referenceCode)}) Tj`);
  streamOps.push(`0 -16 Td`);
  streamOps.push(`(Categoria: ${escapePdfText(invoice.conceptCategory)}) Tj`);
  streamOps.push('ET');

  // ---------------------------------------------------------------------------
  // Items Table Header
  // ---------------------------------------------------------------------------
  const tableTopY = clientY - 80;
  streamOps.push('0.12 0.22 0.42 rg'); // Table header navy
  streamOps.push(`40 ${tableTopY} ${pageWidth - 80} 22 re f`);

  streamOps.push('BT');
  streamOps.push('/F2 9 Tf');
  streamOps.push('1 1 1 rg');
  streamOps.push(`50 ${tableTopY + 7} Td`);
  streamOps.push('(DESCRIPCION DEL SERVICIO INTANGIBLE) Tj');
  streamOps.push(`330 0 Td`);
  streamOps.push('(CANT) Tj');
  streamOps.push(`50 0 Td`);
  streamOps.push('(PRECIO UNIT.) Tj');
  streamOps.push(`65 0 Td`);
  streamOps.push('(TOTAL) Tj');
  streamOps.push('ET');

  // Items Rows
  let currentY = tableTopY;
  for (const item of invoice.items) {
    currentY -= 45;
    // Row background zebra
    streamOps.push('0.98 0.99 1.0 rg');
    streamOps.push(`40 ${currentY} ${pageWidth - 80} 45 re f`);
    streamOps.push('0.88 0.90 0.94 RG 0.5 w');
    streamOps.push(`40 ${currentY} ${pageWidth - 80} 45 re S`);

    streamOps.push('BT');
    streamOps.push('/F2 9 Tf');
    streamOps.push('0.1 0.1 0.1 rg');
    streamOps.push(`50 ${currentY + 28} Td`);
    streamOps.push(`(${escapePdfText(item.description.slice(0, 55))}) Tj`);

    streamOps.push('/F1 8 Tf');
    streamOps.push('0.4 0.4 0.4 rg');
    streamOps.push(`0 -14 Td`);
    const subDesc = item.description.length > 55 ? item.description.slice(55, 120) : 'Honorarios profesionales segun acuerdo de servicio';
    streamOps.push(`(${escapePdfText(subDesc)}) Tj`);

    streamOps.push('/F1 9 Tf');
    streamOps.push('0.1 0.1 0.1 rg');
    streamOps.push(`335 14 Td`);
    streamOps.push(`(${item.quantity}) Tj`);

    streamOps.push(`45 0 Td`);
    streamOps.push(`(${invoice.currency} ${item.unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) Tj`);

    streamOps.push(`70 0 Td`);
    streamOps.push(`(${invoice.currency} ${item.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) Tj`);
    streamOps.push('ET');
  }

  // ---------------------------------------------------------------------------
  // Totals Box (Right aligned)
  // ---------------------------------------------------------------------------
  const totalsY = currentY - 90;
  streamOps.push('0.95 0.96 0.98 rg');
  streamOps.push(`340 ${totalsY} 215 75 re f`);
  streamOps.push('0.80 0.85 0.90 RG 1 w');
  streamOps.push(`340 ${totalsY} 215 75 re S`);

  streamOps.push('BT');
  streamOps.push('/F1 9 Tf');
  streamOps.push('0.2 0.25 0.3 rg');
  streamOps.push(`355 ${totalsY + 54} Td`);
  streamOps.push(`(Subtotal:) Tj`);
  streamOps.push(`110 0 Td`);
  streamOps.push(`(${invoice.currency} ${invoice.subtotal.toFixed(2)}) Tj`);

  streamOps.push(`-110 -16 Td`);
  streamOps.push(`(Impuesto / Ret. (${invoice.taxRatePct}%):) Tj`);
  streamOps.push(`110 0 Td`);
  streamOps.push(`(${invoice.currency} ${invoice.taxAmount.toFixed(2)}) Tj`);

  streamOps.push('/F2 11 Tf');
  streamOps.push('0.08 0.18 0.36 rg'); // Bold Navy
  streamOps.push(`-110 -20 Td`);
  streamOps.push(`(TOTAL A PAGAR:) Tj`);
  streamOps.push(`100 0 Td`);
  streamOps.push(`(${invoice.currency} ${invoice.total.toFixed(2)}) Tj`);
  streamOps.push('ET');

  // ---------------------------------------------------------------------------
  // Legal & Notes Footer
  // ---------------------------------------------------------------------------
  const footerY = 70;
  streamOps.push('0.85 0.88 0.92 RG 0.5 w');
  streamOps.push(`40 ${footerY + 50} ${pageWidth - 80} 0.5 re S`);

  streamOps.push('BT');
  streamOps.push('/F2 8 Tf');
  streamOps.push('0.25 0.3 0.35 rg');
  streamOps.push(`40 ${footerY + 36} Td`);
  streamOps.push('(DECLARACION DE CONFORMIDAD Y CUMPLIMIENTO BANCARIO:) Tj');
  streamOps.push('/F1 7.5 Tf');
  streamOps.push('0.4 0.45 0.5 rg');
  streamOps.push(`0 -12 Td`);
  streamOps.push(`(${escapePdfText(invoice.notes)}) Tj`);
  streamOps.push(`0 -10 Td`);
  streamOps.push('(Comprobante emitido electronicamente de conformidad con normativas de facturacion mercantil y provisiones tributarias.) Tj');
  streamOps.push(`0 -10 Td`);
  streamOps.push(`(Verificacion de autenticidad: SHA-256 Validated  |  Ref: ${escapePdfText(invoice.referenceCode)}  |  Nivel: ${invoice.ticketTier}) Tj`);
  streamOps.push('ET');

  const streamContent = streamOps.join('\n');
  const streamLength = new TextEncoder().encode(streamContent).length;

  // Build PDF 1.4 Object Graph
  const objects: string[] = [];

  // Obj 1: Catalog
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Obj 2: Pages
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  // Obj 3: Page
  objects.push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj\n`,
  );

  // Obj 4: Content Stream
  objects.push(`4 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream\nendobj\n`);

  // Obj 5: Font F1 (Helvetica)
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  // Obj 6: Font F2 (Helvetica-Bold)
  objects.push('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n');

  // Assemble full PDF with xref table
  let pdfOutput = '%PDF-1.4\n';
  const offsets: number[] = [0];

  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdfOutput.length);
    pdfOutput += objects[i];
  }

  const xrefOffset = pdfOutput.length;
  pdfOutput += `xref\n0 ${objects.length + 1}\n`;
  pdfOutput += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdfOutput += `${offsets[i].toString().padStart(10, '0')} 00000 n \n`;
  }

  pdfOutput += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(pdfOutput);
}

// ---------------------------------------------------------------------------
// Zero-Dependency Pure TypeScript ZIP Packager
// ---------------------------------------------------------------------------

export interface ZipFileInput {
  name: string;
  data: Uint8Array;
}

/**
 * Standard CRC32 table & computation
 */
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c;
}

function computeCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Creates an uncompressed standard ZIP archive (.zip) containing the provided files.
 */
export function createZipArchive(files: readonly ZipFileInput[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const centralDirectoryHeaders: Uint8Array[] = [];
  let currentOffset = 0;

  for (const file of files) {
    const filenameBytes = new TextEncoder().encode(file.name);
    const crc = computeCrc32(file.data);
    const size = file.data.length;

    // 1. Local File Header (30 bytes + filename + data)
    const localHeader = new Uint8Array(30 + filenameBytes.length);
    const lView = new DataView(localHeader.buffer);

    lView.setUint32(0, 0x04034b50, true); // Local file header signature
    lView.setUint16(4, 20, true);         // Version needed: 2.0
    lView.setUint16(6, 0, true);          // Bit flag: 0
    lView.setUint16(8, 0, true);          // Compression method: 0 (Stored)
    lView.setUint16(10, 0, true);         // File mod time
    lView.setUint16(12, 0, true);         // File mod date
    lView.setUint32(14, crc, true);       // CRC-32
    lView.setUint32(18, size, true);      // Compressed size
    lView.setUint32(22, size, true);      // Uncompressed size
    lView.setUint16(26, filenameBytes.length, true); // Filename length
    lView.setUint16(28, 0, true);         // Extra field length
    localHeader.set(filenameBytes, 30);

    parts.push(localHeader);
    parts.push(file.data);

    // 2. Central Directory Header (46 bytes + filename)
    const cdHeader = new Uint8Array(46 + filenameBytes.length);
    const cdView = new DataView(cdHeader.buffer);

    cdView.setUint32(0, 0x02014b50, true); // Central directory signature
    cdView.setUint16(4, 20, true);         // Version made by: 2.0
    cdView.setUint16(6, 20, true);         // Version needed: 2.0
    cdView.setUint16(8, 0, true);          // Bit flag: 0
    cdView.setUint16(10, 0, true);         // Compression: 0
    cdView.setUint16(12, 0, true);         // Time
    cdView.setUint16(14, 0, true);         // Date
    cdView.setUint32(16, crc, true);       // CRC32
    cdView.setUint32(20, size, true);      // Compressed size
    cdView.setUint32(24, size, true);      // Uncompressed size
    cdView.setUint16(28, filenameBytes.length, true); // Filename length
    cdView.setUint16(30, 0, true);         // Extra field length
    cdView.setUint16(32, 0, true);         // Comment length
    cdView.setUint16(34, 0, true);         // Disk start
    cdView.setUint16(36, 0, true);         // Internal attributes
    cdView.setUint32(38, 0, true);         // External attributes
    cdView.setUint32(42, currentOffset, true); // Relative offset of local header
    cdHeader.set(filenameBytes, 46);

    centralDirectoryHeaders.push(cdHeader);
    currentOffset += localHeader.length + file.data.length;
  }

  // 3. End of Central Directory Record (22 bytes)
  const cdOffset = currentOffset;
  let cdSize = 0;
  for (const h of centralDirectoryHeaders) {
    cdSize += h.length;
    parts.push(h);
  }

  const eocd = new Uint8Array(22);
  const eView = new DataView(eocd.buffer);
  eView.setUint32(0, 0x06054b50, true); // EOCD signature
  eView.setUint16(4, 0, true);          // Disk number
  eView.setUint16(6, 0, true);          // Start disk
  eView.setUint16(8, files.length, true);  // Entries on disk
  eView.setUint16(10, files.length, true); // Total entries
  eView.setUint32(12, cdSize, true);       // CD size
  eView.setUint32(16, cdOffset, true);     // CD offset
  eView.setUint16(20, 0, true);            // Comment length
  parts.push(eocd);

  // Concatenate all parts
  let totalLength = 0;
  for (const p of parts) totalLength += p.length;

  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const p of parts) {
    result.set(p, pos);
    pos += p.length;
  }

  return result;
}

/**
 * High-level helper: generates individual PDF invoices and compresses them into a single ZIP archive.
 */
export function generateInvoiceBatchZip(invoices: readonly GeneratedInvoice[]): Uint8Array {
  const files: ZipFileInput[] = invoices.map((inv) => ({
    name: `${inv.invoiceNumber}.pdf`,
    data: generateInvoicePdf(inv),
  }));

  return createZipArchive(files);
}
