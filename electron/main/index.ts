import { app, BrowserWindow, globalShortcut, net, shell } from 'electron';
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
// Renderer crashes reportados en Windows (Electron 44, Chromium 140) tras
// ~30-70s de vida; fallback a rasterización por software estabiliza el
// renderer en equipos con drivers GPU problemáticos.
app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;

// Marca temporal del último 'unresponsive' del renderer y ventana de tolerancia
// para el auto-reload acotado (ver listener en createWindow).
let lastUnresponsiveAt = 0;
const UNRESPONSIVE_RELOAD_WINDOW_MS = 60_000;

/**
 * Recupera la ventana principal si sigue viva o la recrea si el renderer
 * murió. Sin esto, un renderer caído dejaba el proceso vivo con el
 * single-instance lock tomado y la app "no abría" en silencio.
 */
async function ensureMainWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const wc = mainWindow.webContents;
    if (wc.isDestroyed() || wc.isCrashed()) {
      try {
        wc.reload();
      } catch {
        // webContents destruido: recrear la ventana entera.
      }
    } else {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    return;
  }
  await createWindow();
}

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

  // Puente CORS local: la build de navegador (localhost:4200) llama a
  // /api/cotizave/rates y /api/binance/p2p en este servidor cuando su fetch
  // directo al proveedor es bloqueado por CORS. El puente hace de proxy a
  // través de net.fetch de Electron (CORS no aplica dentro de la app de
  // escritorio) y refleja el origen del navegador solo si es uno de los
  // orígenes propios de la app (sin `*`).
  const BRIDGE_ALLOWED_ORIGINS = new Set([
    'http://localhost:4200',
    'http://127.0.0.1:4200',
    'http://localhost:51857',
    'http://127.0.0.1:51857',
  ]);

  function applyBridgeCors(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    allowMethods: string,
    allowHeaders: string,
  ): void {
    const origin = req.headers.origin;
    if (origin && BRIDGE_ALLOWED_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', allowHeaders);
      res.setHeader('Access-Control-Allow-Methods', allowMethods);
      res.setHeader('Access-Control-Max-Age', '600');
    }
  }

  function writeBridgeJson(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    status: number,
    body: unknown,
    allowMethods: string,
    allowHeaders: string,
  ): void {
    applyBridgeCors(req, res, allowMethods, allowHeaders);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  const COTIZAVE_CORS = ['GET, OPTIONS', 'x-api-key, accept, content-type'] as const;
  const BINANCE_CORS = ['POST, OPTIONS', 'content-type'] as const;

  async function handleCotizaveBridge(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    endpoint: string,
  ): Promise<void> {
    if (req.method === 'OPTIONS') {
      applyBridgeCors(req, res, COTIZAVE_CORS[0], COTIZAVE_CORS[1]);
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== 'GET') {
      writeBridgeJson(req, res, 405, { error: 'Method not allowed' }, COTIZAVE_CORS[0], COTIZAVE_CORS[1]);
      return;
    }
    if (endpoint !== 'rates') {
      writeBridgeJson(req, res, 404, { error: 'Unknown endpoint' }, COTIZAVE_CORS[0], COTIZAVE_CORS[1]);
      return;
    }
    const rawKey = req.headers['x-api-key'];
    const apiKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!apiKey || apiKey.trim().length === 0) {
      writeBridgeJson(
        req,
        res,
        400,
        { error: 'Cotizave API key is required' },
        COTIZAVE_CORS[0],
        COTIZAVE_CORS[1],
      );
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
        writeBridgeJson(
          req,
          res,
          response.status,
          { error: `Cotizave HTTP Error ${response.status}` },
          COTIZAVE_CORS[0],
          COTIZAVE_CORS[1],
        );
        return;
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        writeBridgeJson(
          req,
          res,
          502,
          { error: 'Cotizave returned non-JSON response' },
          COTIZAVE_CORS[0],
          COTIZAVE_CORS[1],
        );
        return;
      }
      const data = await response.json();
      writeBridgeJson(req, res, 200, data, COTIZAVE_CORS[0], COTIZAVE_CORS[1]);
    } catch {
      writeBridgeJson(
        req,
        res,
        502,
        { error: 'Servidor Cotizave no accesible' },
        COTIZAVE_CORS[0],
        COTIZAVE_CORS[1],
      );
    }
  }

  async function handleBinanceBridge(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (req.method === 'OPTIONS') {
      applyBridgeCors(req, res, BINANCE_CORS[0], BINANCE_CORS[1]);
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      writeBridgeJson(req, res, 405, { error: 'Method not allowed' }, BINANCE_CORS[0], BINANCE_CORS[1]);
      return;
    }
    let payload: unknown;
    try {
      const raw = await new Promise<string>((resolve, reject) => {
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
          if (body.length > 64 * 1024) {
            reject(new Error('Payload demasiado grande'));
          }
        });
        req.on('end', () => resolve(body));
        req.on('error', reject);
      });
      payload = JSON.parse(raw);
    } catch {
      writeBridgeJson(req, res, 400, { error: 'Invalid JSON body' }, BINANCE_CORS[0], BINANCE_CORS[1]);
      return;
    }
    try {
      const response = await net.fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        writeBridgeJson(
          req,
          res,
          response.status,
          { error: `Binance HTTP Error ${response.status}` },
          BINANCE_CORS[0],
          BINANCE_CORS[1],
        );
        return;
      }
      const data = await response.json();
      writeBridgeJson(req, res, 200, data, BINANCE_CORS[0], BINANCE_CORS[1]);
    } catch {
      writeBridgeJson(
        req,
        res,
        502,
        { error: 'Servidor Binance no accesible' },
        BINANCE_CORS[0],
        BINANCE_CORS[1],
      );
    }
  }

  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);

    if (urlPath.startsWith('/api/cotizave/')) {
      const endpoint = decodeURIComponent(urlPath.slice('/api/cotizave/'.length));
      void handleCotizaveBridge(req, res, endpoint);
      return;
    }

    if (urlPath.startsWith('/api/binance/')) {
      void handleBinanceBridge(req, res);
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
      "connect-src 'self' https://api.telegram.org https://p2p.binance.com https://api.cotizave.com http://127.0.0.1:51857 http://localhost:51857 data: blob:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ');

    fs.readFile(filePath, (err, data) => {
      if (err) {
        // El fallback SPA solo aplica a rutas de navegación SIN extensión de
        // archivo. Un asset faltante (main-*.js, chunk-*.js, styles-*.css, ...)
        // debe responder 404 real y NUNCA index.html: servir HTML con 200 en
        // lugar del módulo pedido produce "Failed to fetch dynamically
        // imported module" y enmascara builds obsoletas cacheadas.
        const requestedExt = path.extname(urlPath);
        if (requestedExt) {
          res.writeHead(404, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          res.end('Not found');
          return;
        }
        fs.readFile(path.join(root, 'index.html'), (e2, html) => {
          if (e2) {
            res.writeHead(404, {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store',
            });
            res.end('Not found');
          } else {
            res.writeHead(200, {
              'Content-Type': 'text/html',
              'Content-Security-Policy': CSP,
              // El index no tiene hash en el nombre: una build nueva debe
              // llegar SIEMPRE al renderer, nunca una copia vieja del disco
              // de Chromium (causa de chunks huérfanos tipo chunk-DSekyxvb.js).
              'Cache-Control': 'no-store',
            });
            res.end(html);
          }
        });
        return;
      }
      const ext = path.extname(filePath);
      // Los bundles con hash en el nombre (main-*.js, chunk-*.js, styles-*.css)
      // son inmutables: una vez servidos se cachean agresivamente. Todo lo
      // demás (index, manifest, 3rdpartylicenses) va con no-store.
      const hashedAsset = /[.-][A-Za-z0-9_-]{8,}\.(?:js|css|woff2?)$/.test(filePath);
      res.writeHead(200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Content-Security-Policy': CSP,
        'Cache-Control': hashedAsset ? 'public, max-age=31536000, immutable' : 'no-store',
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
  // El servidor estático se levanta SIEMPRE: además de servir la SPA cuando no
  // hay dev server, expone el puente CORS de Cotizave y Binance
  // (127.0.0.1:51857) para que la build de navegador use la app de escritorio
  // como proxy local.
  const port = await startStaticServer();

  let targetUrl = `http://localhost:${port}/#/spread`;
  try {
    const isLocalhostUp = await checkUrl('http://localhost:4200/');
    const isIpUp = !isLocalhostUp && (await checkUrl('http://127.0.0.1:4200/'));
    if (isLocalhostUp || isIpUp) {
      targetUrl = 'http://localhost:4200/#/spread';
    }
  } catch {
    // fallback to static server
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

  // Renderer colgado (modal bloqueante, bucle infinito) sin crashear: el evento
  // 'unresponsive' del webContents cubre lo que 'render-process-gone' no ve.
  // El reload se acota con una ventana de 60s: si se vuelve a colgar enseguida
  // se loguea pero NO se recarga, para evitar un bucle infinito de recargas.
  mainWindow.webContents.on('unresponsive', () => {
    const now = Date.now();
    console.error('[p2p] renderer unresponsive');
    if (now - lastUnresponsiveAt < UNRESPONSIVE_RELOAD_WINDOW_MS) {
      console.error('[p2p] unresponsive reciente, se omite reload para evitar bucles');
      return;
    }
    lastUnresponsiveAt = now;
    const wc = mainWindow?.webContents;
    if (wc && !wc.isDestroyed() && !wc.isCrashed()) {
      wc.reload();
    } else {
      void ensureMainWindow();
    }
  });

  mainWindow.webContents.on('responsive', () => {
    console.log('[p2p] renderer responsive de nuevo');
  });

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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:') || url.startsWith('tg:')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
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
    console.log('[p2p] second-instance: revivir ventana principal');
    void ensureMainWindow();
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

process.on('uncaughtException', (err) => {
  console.error('[p2p] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[p2p] unhandledRejection:', reason);
});
app.on('render-process-gone', (_event, webContents, details) => {
  // Auto-recovery del renderer: sin esto, un crash deja el proceso vivo con
  // el single-instance lock tomado y la app "no abre" en silencio.
  if (details.reason === 'crashed' || details.reason === 'killed' || details.reason === 'oom') {
    console.error('[p2p] renderer gone, reason:', details.reason, '— recargando');
    if (webContents.isDestroyed() || webContents.isCrashed()) {
      void ensureMainWindow();
    } else {
      webContents.reload();
    }
  }
});
