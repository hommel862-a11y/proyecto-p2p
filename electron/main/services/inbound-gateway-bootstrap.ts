import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export interface InboundGatewayBootstrapResult {
  status: 'ALREADY_RUNNING' | 'STARTED' | 'ENTRY_NOT_FOUND' | 'FAILED';
  port: number;
  entryPath?: string;
  error?: string;
}

export interface InboundGatewayBootstrapOptions {
  port?: number;
  searchRoots?: string[];
  startupWaitMs?: number;
  healthChecker?: (port: number) => Promise<boolean>;
}

let managedChild: ChildProcess | null = null;
let isStopping = false;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 3;

export function checkGatewayHealth(port = 3030, timeoutMs = 1200): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

export function resolveInboundGatewayEntry(searchRoots?: string[]): string | null {
  const roots =
    searchRoots && searchRoots.length > 0
      ? searchRoots
      : [
          path.resolve(__dirname, '../../../..'),
          path.resolve(__dirname, '../../..'),
          process.cwd(),
          ...(process.resourcesPath ? [process.resourcesPath] : []),
        ];

  for (const root of roots) {
    const direct = path.join(root, 'packages', 'inbound-gateway', 'dist', 'index.js');
    if (fs.existsSync(direct)) {
      return direct;
    }
    const unpacked = path.join(root, 'app.asar.unpacked', 'packages', 'inbound-gateway', 'dist', 'index.js');
    if (fs.existsSync(unpacked)) {
      return unpacked;
    }
  }
  return null;
}

function readConfiguredGatewayPort(entryPath: string): number {
  const envPort = Number(process.env['INBOUND_GATEWAY_PORT'] || process.env['GATEWAY_PORT'] || 0);
  if (Number.isFinite(envPort) && envPort > 0) {
    return envPort;
  }
  try {
    const repoRoot = path.resolve(path.dirname(entryPath), '../../..');
    const envFile = path.join(repoRoot, '.env');
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf8');
      const match = content.match(/^\s*INBOUND_GATEWAY_PORT\s*=\s*(\d+)/m);
      if (match) {
        const parsed = Number(match[1]);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      }
    }
  } catch {
    // Ignore .env read errors; default to 3030
  }
  return 3030;
}

async function waitForGatewayReady(
  port: number,
  maxWaitMs: number,
  healthChecker: (p: number) => Promise<boolean>,
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (await healthChecker(port)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  return healthChecker(port);
}

export async function ensureInboundGatewayRunning(
  options: InboundGatewayBootstrapOptions = {},
): Promise<InboundGatewayBootstrapResult> {
  isStopping = false;
  const healthChecker = options.healthChecker ?? checkGatewayHealth;
  const entryPath = resolveInboundGatewayEntry(options.searchRoots);
  const port = options.port ?? (entryPath ? readConfiguredGatewayPort(entryPath) : 3030);

  if (await healthChecker(port)) {
    return { status: 'ALREADY_RUNNING', port, ...(entryPath ? { entryPath } : {}) };
  }

  if (!entryPath) {
    console.warn('[p2p] inbound-gateway dist/index.js not found; skipping desktop auto-start');
    return { status: 'ENTRY_NOT_FOUND', port };
  }

  if (managedChild && managedChild.exitCode === null && !managedChild.killed) {
    const ready = await waitForGatewayReady(port, options.startupWaitMs ?? 3500, healthChecker);
    return { status: ready ? 'STARTED' : 'ALREADY_RUNNING', port, entryPath };
  }

  const gatewayDir = path.resolve(path.dirname(entryPath), '..');
  try {
    const child = spawn(process.execPath, [entryPath], {
      cwd: gatewayDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    managedChild = child;

    child.stdout?.on('data', (chunk: Buffer) => {
      const line = chunk.toString('utf8').trim();
      if (line) console.log(`[inbound-gateway] ${line}`);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString('utf8').trim();
      if (line) console.warn(`[inbound-gateway] ${line}`);
    });

    child.once('exit', (code) => {
      if (managedChild === child) {
        managedChild = null;
      }
      if (!isStopping && code !== 0 && restartAttempts < MAX_RESTART_ATTEMPTS) {
        restartAttempts++;
        const delayMs = 2000 * restartAttempts;
        console.warn(
          `[p2p] inbound-gateway exited (code ${String(code)}); restarting in ${delayMs}ms (${restartAttempts}/${MAX_RESTART_ATTEMPTS})`,
        );
        setTimeout(() => {
          if (!isStopping) {
            void ensureInboundGatewayRunning({ ...options, port });
          }
        }, delayMs);
      }
    });

    const ready = await waitForGatewayReady(port, options.startupWaitMs ?? 4000, healthChecker);
    if (ready) {
      restartAttempts = 0;
    }
    return {
      status: ready ? 'STARTED' : 'FAILED',
      port,
      entryPath,
      ...(ready ? {} : { error: 'GATEWAY_HEALTH_TIMEOUT' }),
    };
  } catch (err: unknown) {
    return {
      status: 'FAILED',
      port,
      entryPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function stopManagedInboundGateway(): void {
  isStopping = true;
  if (!managedChild) return;
  const child = managedChild;
  managedChild = null;
  try {
    if (child.exitCode === null && !child.killed) {
      child.kill('SIGTERM');
    }
  } catch {
    // Ignore shutdown errors
  }
}
