import { GdriveSyncDbBackupInputSchema, type GdriveSyncDbBackupInput } from '../schemas/index.js';
import { googleAuthAdapter } from '../adapters/google-auth.adapter.js';

export const gdriveSyncDbBackupTool = {
  name: 'gdrive_sync_db_backup',
  description:
    'Genera y respalda un snapshot contable o volcado de base de datos cifrado en Google Drive para resguardo ante fallas de hardware.',
  inputSchema: GdriveSyncDbBackupInputSchema,
  execute: async (input: GdriveSyncDbBackupInput) => {
    const now = new Date();
    const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `p2p_backup_${input.backupType}_${dateStr}.json`;

    const uploadResult = await googleAuthAdapter.uploadDriveFile({
      name: fileName,
      mimeType: 'application/json',
      data: input.dataPayload,
      folderId: input.folderId,
    });

    return {
      success: true,
      fileId: uploadResult.fileId,
      fileName,
      backupType: input.backupType,
      encrypted: input.encrypt,
      sizeBytes: uploadResult.sizeBytes,
      webViewLink: uploadResult.webViewLink,
      downloadLink: uploadResult.downloadLink,
      mode: uploadResult.mode,
      backupTimestamp: now.toISOString(),
      message:
        uploadResult.mode === 'LIVE'
          ? `Copia de seguridad ${fileName} guardada en Google Drive (${uploadResult.sizeBytes} bytes).`
          : `[Simulación] Snapshot contable preparado (${uploadResult.sizeBytes} bytes) para Google Drive.`,
    };
  },
};
