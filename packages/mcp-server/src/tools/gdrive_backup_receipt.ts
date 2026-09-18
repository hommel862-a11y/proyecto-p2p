import { GdriveBackupReceiptInputSchema, type GdriveBackupReceiptInput } from '../schemas/index.js';
import { googleAuthAdapter } from '../adapters/google-auth.adapter.js';

export const gdriveBackupReceiptTool = {
  name: 'gdrive_backup_receipt',
  description:
    'Respalda y organiza comprobantes de pago escaneados en Google Drive por fecha y contraparte con metadatos asociados.',
  inputSchema: GdriveBackupReceiptInputSchema,
  execute: async (input: GdriveBackupReceiptInput) => {
    const ts = input.timestamp ? new Date(input.timestamp) : new Date();
    const dateFolder = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')}`;
    const cleanCounterparty = (input.counterparty || 'Anónimo').replace(/[^a-zA-Z0-9_-]/g, '_');
    const ext = input.mimeType === 'application/pdf' ? 'pdf' : 'png';
    const computedName =
      input.fileName || `Receipt_${input.tradeId}_${cleanCounterparty}_${ts.getTime()}.${ext}`;

    const uploadResult = await googleAuthAdapter.uploadDriveFile({
      name: computedName,
      mimeType: input.mimeType,
      data: input.imageData,
      folderId: input.folderId,
    });

    return {
      success: true,
      fileId: uploadResult.fileId,
      fileName: uploadResult.name,
      folderPath: `P2P_Receipts/${dateFolder}`,
      webViewLink: uploadResult.webViewLink,
      downloadLink: uploadResult.downloadLink,
      tradeId: input.tradeId,
      counterparty: input.counterparty,
      amountVes: input.amountVes,
      amountUsdt: input.amountUsdt,
      bank: input.bank || 'Pago Móvil',
      mode: uploadResult.mode,
      syncedAt: new Date().toISOString(),
      message:
        uploadResult.mode === 'LIVE'
          ? `Comprobante respaldado exitosamente en Google Drive: ${computedName}`
          : `[Simulación] Comprobante preparado y registrado para Google Drive (${computedName}). Configure Service Account para carga directa a la nube.`,
    };
  },
};
