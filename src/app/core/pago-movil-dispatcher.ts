/**
 * Helper utility for assisted outgoing payments (Human-in-the-Loop) in Venezuelan retail banking.
 * Formats Pago Móvil payloads and generates instant QR codes / 1-click clipboard payloads
 * so the operator can dispatch bank transfers from their mobile banking app without typing.
 */

import QRCode from 'qrcode';

export interface PagoMovilPayload {
  bankCode: string; // 4 digits, e.g. 0105 (Mercantil), 0134 (Banesco), 0172 (Bancamiga), 0108 (Provincial), 0102 (BDV)
  bankName: string;
  phone: string; // e.g. 04141234567
  documentId: string; // e.g. V12345678
  amountVes: number;
  concept?: string;
}

export const BANK_CODES: Record<string, { code: string; name: string }> = {
  BANESCO: { code: '0134', name: 'Banesco' },
  MERCANTIL: { code: '0105', name: 'Banco Mercantil' },
  BANCAMIGA: { code: '0172', name: 'Bancamiga' },
  PROVINCIAL: { code: '0108', name: 'BBVA Provincial' },
  BDV: { code: '0102', name: 'Banco de Venezuela' },
  BANPLUS: { code: '0174', name: 'Banplus' },
};

/**
 * Builds the standard interbank string accepted by Venezuelan banking QR scanners.
 */
export function buildPagoMovilQrString(payload: PagoMovilPayload): string {
  const cleanPhone = payload.phone.replace(/[^0-9]/g, '');
  const cleanDoc = payload.documentId.toUpperCase().replace(/[\s.-]/g, '');
  const amtFormatted = payload.amountVes.toFixed(2);

  return `PAGOMOVIL;BANCO:${payload.bankCode};CI:${cleanDoc};TLF:${cleanPhone};MTO:${amtFormatted};`;
}

/**
 * Generates a local SVG QR data URI using the `qrcode` library. Fully offline: the QR is
 * rendered in-process with the requested dark/light colors, so payloads never leave the
 * device and the app keeps working inside Electron without internet access.
 */
export async function generateSimpleQrSvg(text: string): Promise<string> {
  try {
    const svg = await QRCode.toString(text, {
      type: 'svg',
      margin: 1,
      color: { dark: '#F9FAFB', light: '#111827' },
    });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } catch {
    const fallbackSvg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="132" height="132" viewBox="0 0 132 132">` +
      `<rect width="100%" height="100%" fill="#111827"/>` +
      `<text x="66" y="60" text-anchor="middle" fill="#F9FAFB" font-size="13">QR</text>` +
      `<text x="66" y="80" text-anchor="middle" fill="#F9FAFB" font-size="10">no disponible</text>` +
      `</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fallbackSvg)}`;
  }
}
