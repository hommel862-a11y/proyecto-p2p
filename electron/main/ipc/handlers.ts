import { ipcMain, app, type IpcMainInvokeEvent } from 'electron';
import type { P2PIpcChannels, BinanceSearchParams } from '../../shared/types';

/**
 * Typed, allow-listed IPC handlers.
 * `p2p:fetch-binance` allows the app to query Binance P2P public orderbook
 * bypassing any browser CORS limitations natively and securely.
 */
export function registerIpcHandlers(): void {
  ipcMain.removeHandler('app:get-version');
  ipcMain.handle('app:get-version', (_event: IpcMainInvokeEvent): string => {
    return app.getVersion();
  });

  ipcMain.removeHandler('p2p:fetch-binance');
  ipcMain.handle(
    'p2p:fetch-binance',
    async (_event: IpcMainInvokeEvent, params: BinanceSearchParams): Promise<unknown> => {
      const response = await fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: '*/*',
        },
        body: JSON.stringify({
          asset: params.asset ?? 'USDT',
          fiat: params.fiat ?? 'VES',
          tradeType: params.tradeType ?? 'BUY',
          page: 1,
          rows: params.rows ?? 10,
          payTypes: params.payTypes ?? [],
          countries: [],
          proMerchantAds: false,
          shieldMerchantAds: false,
          filterType: 'all',
          periods: [],
        }),
      });

      if (!response.ok) {
        throw new Error(`Binance P2P HTTP Error ${response.status}`);
      }

      return await response.json();
    },
  );
}


// Compile-time guarantee that the handler map matches the channel contract.
export type RegisteredChannels = keyof P2PIpcChannels;
