import { contextBridge, ipcRenderer } from 'electron';
import {
  createP2PApi,
  EXPOSED_API_KEYS,
  ALLOWED_CHANNELS,
  ALLOWED_LISTEN_CHANNELS,
} from './api';

const api = createP2PApi(
  (channel: string, ...args: unknown[]) => {
    if (!(ALLOWED_CHANNELS as readonly string[]).includes(channel)) {
      throw new Error(`P2P bridge: channel "${channel}" is not allow-listed`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  (channel: string, listener: (...args: unknown[]) => void) => {
    if (!(ALLOWED_LISTEN_CHANNELS as readonly string[]).includes(channel)) {
      throw new Error(`P2P bridge: listen channel "${channel}" is not allow-listed`);
    }
    const handler = (_event: unknown, ...args: unknown[]) => listener(...args);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
);

// Secure exposure: only the narrow typed API — never the raw ipcRenderer,
// never node built-ins (design #301 D3).
contextBridge.exposeInMainWorld('electron', api);

// Fail-closed guard: if the exposed shape ever drifts, refuse to start.
const exposed = Object.keys(api) as string[];
for (const key of EXPOSED_API_KEYS) {
  if (!exposed.includes(key)) {
    throw new Error(`P2P preload: expected API key "${key}" is missing`);
  }
}
for (const key of exposed) {
  if (!(EXPOSED_API_KEYS as readonly string[]).includes(key)) {
    throw new Error(`P2P preload: unexpected API key "${key}" leaked to renderer`);
  }
}
