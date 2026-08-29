import { ipcMain, app, type IpcMainInvokeEvent } from 'electron';
import type { P2PIpcChannels } from '../../shared/types';

/**
 * Typed, allow-listed IPC handlers.
 * For the MVP the only channel is `app:get-version`; everything else
 * (spread/income/rules/operation-log) runs in the renderer against @p2p/core
 * and Web Storage — the main process never touches persistence or math.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle('app:get-version', (_event: IpcMainInvokeEvent): string => {
    return app.getVersion();
  });
}

// Compile-time guarantee that the handler map matches the channel contract.
export type RegisteredChannels = keyof P2PIpcChannels;
