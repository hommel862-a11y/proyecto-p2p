import { app, BrowserWindow, globalShortcut, net } from 'electron';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { SECURE_WEB_PREFERENCES } from './window-config';
import {
  registerIpcHandlers,
  triggerKillswitch,
  getDbService,
  setAlphaWatcher,
  setClipboardWatcher,
} from './ipc/handlers';
import { bootstrapMcpServer } from './mcp-bootstrap';
import { AlphaWatcher } from './alpha-watcher';
import { ClipboardWatcherService } from './services/clipboard-watcher';

app.setName('p2p-decisor');
try {
  const customUserData = path.join(app.getPath('appData'), 'p2p-decisor-desktop');
  app.setPath('userData', customUserData);
} catch {
  // Ignore fallback
}
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

let mainWindow: BrowserWindow | null = null;

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/**
 * Minimal static server for the built Angular bundle. The Electron shell only
 * HOSTS the web app — no domain logic, no node fs access from the renderer.
 * SPA fallback rewrites unknown routes to index.html.
 */
function startStaticServer(): Promise<number> {
  const root = path.resolve(__dirname, '../../../dist/p2p/browser');

  // Puente CORS de Cotizave: la build de navegador (localhost:4200) llama a
  // /api/cotizave/rates en este servidor cuando su fetch directo a
  // api.cotizave.com es bloqueado por CORS. El puente hace de proxy a través de
  // net.fetch de Electron (CORS no aplica dentro de la app de escritorio) y
  // refleja el origen del navegador solo si es uno de los orígenes propios de
  // la app (sin `*`).
  const COTIZAVE_BRIDGE_PREFIX = '/api/cotizave/';
  const COTIZAVE_ALLOWED_ORIGINS = new Set([
    'http://localhost:4200',
    'http://127.0.0.1:4200',
    'http://localhost:51857',
    'http://127.0.0.1:51857',
  ]);

  function applyCotizaveCors(req: http.IncomingMessage, res: http.ServerResponse): void {
    const origin = req.headers.origin;
    if (origin && COTIZAVE_ALLOWED_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'x-api-key, accept, content-type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
  }

  function writeCotizaveJson(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    status: number,
    body: unknown,
  ): void {
    applyCotizaveCors(req, res);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  async function handleCotizaveBridge(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    endpoint: string,
  ): Promise<void> {
    if (req.method === 'OPTIONS') {
      applyCotizaveCors(req, res);
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== 'GET') {
      writeCotizaveJson(req, res, 405, { error: 'Method not allowed' });
      return;
    }
    if (endpoint !== 'rates') {
      writeCotizaveJson(req, res, 404, { error: 'Unknown endpoint' });
      return;
    }
    const rawKey = req.headers['x-api-key'];
    const apiKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!apiKey || apiKey.trim().length === 0) {
      writeCotizaveJson(req, res, 400, { error: 'Cotizave API key is required' });
      return;
    }
    try {
      const response = await net.fetch(`https://api.cotizave.com/v1/fx/${endpoint}`, {
        method: 'GET',
        signal: AbortSignal.timeout(15000),
        headers: {
          'X-API-Key': apiKey,
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        writeCotizaveJson(req, res, response.status, {
          error: `Cotizave HTTP Error ${response.status}`,
        });
        return;
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        writeCotizaveJson(req, res, 502, { error: 'Cotizave returned non-JSON response' });
        return;
      }
      const data = await response.json();
      writeCotizaveJson(req, res, 200, data);
    } catch {
      writeCotizaveJson(req, res, 502, { error: 'Servidor Cotizave no accesible' });
    }
  }

  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);

    if (urlPath.startsWith(COTIZAVE_BRIDGE_PREFIX)) {
      const endpoint = decodeURIComponent(urlPath.slice(COTIZAVE_BRIDGE_PREFIX.length));
      void handleCotizaveBridge(req, res, endpoint);
      return;
    }

    const filePath = path.resolve(root, urlPath.replace(/^[/\\]+/, '') || 'index.html');
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    /**
     * Strict Content-Security-Policy for the Electron shell. The app keeps all
     * scripts/styles in same-origin bundles and never touches remote origins.
     */
    const CSP = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self' https://api.telegram.org https://p2p.binance.com https://api.cotizave.com data: blob:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ');

    fs.readFile(filePath, (err, data) => {
      if (err) {
        fs.readFile(path.join(root, 'index.html'), (e2, html) => {
          if (e2) {
            res.writeHead(404);
            res.end('Not found');
          } else {
            res.writeHead(200, {
              'Content-Type': 'text/html',
              'Content-Security-Policy': CSP,
            });
            res.end(html);
          }
        });
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Content-Security-Policy': CSP,
      });
      res.end(data);
    });
  });
  // Fixed port keeps the renderer origin stable so localStorage (e.g. Telegram
  // config) persists across relaunches. Falls back to ephemeral if occupied.
  const PREFERRED_STATIC_PORT = 51857;
  return new Promise((resolve) => {
    server.once('error', () => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });
    server.listen(PREFERRED_STATIC_PORT, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });
}

async function checkUrl(url: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      resolve(res.statusCode === 200 || res.statusCode === 304);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function createWindow(): Promise<void> {
  let targetUrl = '';
  try {
    const isLocalhostUp = await checkUrl('http://localhost:4200/');
    const isIpUp = !isLocalhostUp && (await checkUrl('http://127.0.0.1:4200/'));
    if (isLocalhostUp || isIpUp) {
      targetUrl = 'http://localhost:4200/#/spread';
    }
  } catch {
    // fallback to static server
  }

  if (!targetUrl) {
    const port = await startStaticServer();
    targetUrl = `http://localhost:${port}/#/spread`;
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: true,
    center: true,
    title: 'P2P Decisor — Mesa de Operaciones Arbitraje',
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });

  registerIpcHandlers();

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.maximize();
    mainWindow?.focus();

    // Register Dual Kill-Switch Global OS Hotkey (Ctrl+Alt+Shift+K)
    globalShortcut.register('CommandOrControl+Alt+Shift+K', () => {
      triggerKillswitch('Emergencia: Atajo global de SO accionado', 'OS_GLOBAL_HOTKEY');
      mainWindow?.webContents.send('p2p:killswitch-triggered', {
        timestamp: Date.now(),
        source: 'OS_GLOBAL_HOTKEY',
        reason: 'Atajo global de teclado (Ctrl+Alt+Shift+K)',
      });
      if (mainWindow && !mainWindow.isFocused()) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  });

  void mainWindow.loadURL(targetUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

let alphaWatcher: AlphaWatcher | null = null;
let clipboardWatcher: ClipboardWatcherService | null = null;

// Enforce a single app instance. Two renderers polling the same Telegram bot
// used to answer commands from a stale bundle with cached market data.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    await bootstrapMcpServer();
    await createWindow();

    // Start Autonomous Continuous Alpha Watcher
    alphaWatcher = new AlphaWatcher(getDbService(), () => mainWindow);
    setAlphaWatcher(alphaWatcher);
    alphaWatcher.start();

    // Start Autonomous Background Clipboard Watcher
    clipboardWatcher = new ClipboardWatcherService(getDbService(), () => mainWindow);
    setClipboardWatcher(clipboardWatcher);
    clipboardWatcher.start();
  });
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
