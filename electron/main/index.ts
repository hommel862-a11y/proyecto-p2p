import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { SECURE_WEB_PREFERENCES } from './window-config';
import { registerIpcHandlers } from './ipc/handlers';

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
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
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
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
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
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });
}

async function createWindow(): Promise<void> {
  const port = await startStaticServer();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: true,
    center: true,
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });

  registerIpcHandlers();
  await mainWindow.loadURL(`http://localhost:${port}/`);
  mainWindow.show();
  mainWindow.focus();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

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
