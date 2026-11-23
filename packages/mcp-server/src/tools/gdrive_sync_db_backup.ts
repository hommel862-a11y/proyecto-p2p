import { GdriveSyncDbBackupInputSchema, type GdriveSyncDbBackupInput } from '../schemas/index.js';
import { googleAuthAdapter } from '../adapters/google-auth.adapter.js';

export const gdriveSyncDbBackupTool = {
  name: 'gdrive_sync_db_backup',
  description:
    'Genera y respalda un snapshot contable o volcado de base de datos cifrado en Google Drive con resolución real de carpetas y estado honesto de sincronización.',
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
      folderPath: input.folderPath,
    });

    const isLive = uploadResult.mode === 'LIVE';
    const isSimulated = uploadResult.mode === 'SIMULATED';
    const isDisconnected = uploadResult.mode === 'DISCONNECTED';

    return {
      success: !isDisconnected,
      liveUploaded: isLive,
      simulated: isSimulated,
      fileId: uploadResult.fileId,
      fileName,
      folderPath: input.folderPath,
      resolvedFolderId: uploadResult.resolvedFolderId,
      backupType: input.backupType,
      encrypted: input.encrypt,
      sizeBytes: uploadResult.sizeBytes,
      webViewLink: uploadResult.webViewLink,
      downloadLink: uploadResult.downloadLink,
      mode: uploadResult.mode,
      error: uploadResult.error,
      backupTimestamp: now.toISOString(),
      message: isLive
        ? `Copia de seguridad ${fileName} guardada en Google Drive (${uploadResult.sizeBytes} bytes).`
        : isDisconnected
          ? `Fallo al respaldar en Google Drive: ${uploadResult.error || 'No se pudo completar la carga en vivo.'}`
          : `[Simulación] Snapshot contable preparado (${uploadResult.sizeBytes} bytes) para Google Drive (sin credenciales activas).`,
    };
  },
};
