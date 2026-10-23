const http = require('node:http');
const { spawn } = require('node:child_process');

const PORT = 4200;
const URL = `http://localhost:${PORT}/`;
const GATEWAY_PORT = 3030;
const GATEWAY_URL = `http://localhost:${GATEWAY_PORT}/health`;
const CHECK_INTERVAL_MS = 1000;
const MAX_WAIT_SECONDS = 90;

function checkServer() {
  return new Promise((resolve) => {
    const req = http.get(URL, { timeout: 1500 }, (res) => {
      resolve(res.statusCode === 200 || res.statusCode === 304);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function checkInboundGateway() {
  return new Promise((resolve) => {
    const req = http.get(GATEWAY_URL, { timeout: 1500 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(maxSeconds = MAX_WAIT_SECONDS) {
  const start = Date.now();
  process.stdout.write(`[electron:dev] Esperando a que el servidor Angular responda en ${URL}`);
  while ((Date.now() - start) < maxSeconds * 1000) {
    const isUp = await checkServer();
    if (isUp) {
      console.log('\n[electron:dev] ¡Servidor Angular listo!');
      return true;
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, CHECK_INTERVAL_MS));
  }
  console.log('\n[electron:dev] Tiempo de espera agotado.');
  return false;
}

function buildElectronArtifacts() {
  const { execSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  console.log('[electron:dev] Compilando TypeScript de Electron...');
  execSync('npx tsc -p electron/tsconfig.json', { stdio: 'inherit' });
  console.log('[electron:dev] Empaquetando preload bundle...');
  execSync('node electron/build-preload.cjs', { stdio: 'inherit' });

  // Guarantee schema.sql is copied to dist/main/db
  const srcSchema = path.resolve(__dirname, '../electron/main/db/schema.sql');
  const destSchema = path.resolve(__dirname, '../electron/dist/main/db/schema.sql');
  if (fs.existsSync(srcSchema)) {
    fs.mkdirSync(path.dirname(destSchema), { recursive: true });
    fs.copyFileSync(srcSchema, destSchema);
    console.log('[electron:dev] schema.sql sincronizado en electron/dist/main/db/schema.sql');
  }
}

function launchElectron() {
  buildElectronArtifacts();
  console.log('[electron:dev] Lanzando Electron...');
  const electronProc = spawn('npx', ['electron', '.'], {
    stdio: 'inherit',
    shell: true,
  });

  return electronProc;
}

async function main() {
  const alreadyUp = await checkServer();
  let devServerProc = null;
  let inboundProc = null;

  // 1. Inbound Gateway Daemon (Port 3030)
  const disableGateway =
    process.env.DISABLE_INBOUND_GATEWAY === '1' ||
    process.env.DISABLE_INBOUND_GATEWAY === 'true';

  if (!disableGateway) {
    const gatewayUp = await checkInboundGateway();
    if (gatewayUp) {
      console.log(`[electron:dev] Inbound Gateway detectado activo en http://127.0.0.1:${GATEWAY_PORT}`);
    } else {
      console.log(`[electron:dev] Iniciando Inbound Gateway daemon (npm run inbound:dev)...`);
      inboundProc = spawn('npm', ['run', 'inbound:dev'], {
        stdio: 'inherit',
        shell: true,
      });
    }
  }

  // 2. Angular Dev Server (Port 4200)
  if (alreadyUp) {
    console.log(`[electron:dev] Servidor detectado activo en ${URL}`);
  } else {
    console.log(`[electron:dev] Iniciando Angular dev server (npm start)...`);
    devServerProc = spawn('npm', ['start'], {
      stdio: 'inherit',
      shell: true,
    });

    const ready = await waitForServer();
    if (!ready) {
      console.error('[electron:dev] Error: No se pudo conectar al servidor de desarrollo.');
      cleanupProcesses();
      process.exit(1);
    }
  }

  function cleanupProcesses() {
    if (inboundProc) {
      console.log('[electron:dev] Deteniendo Inbound Gateway daemon...');
      try {
        if (process.platform === 'win32' && inboundProc.pid) {
          spawn('taskkill', ['/pid', inboundProc.pid.toString(), '/T', '/F']);
        } else {
          inboundProc.kill();
        }
      } catch {
        // ignore
      }
      inboundProc = null;
    }

    if (devServerProc) {
      console.log('[electron:dev] Deteniendo servidor de desarrollo...');
      try {
        if (process.platform === 'win32' && devServerProc.pid) {
          spawn('taskkill', ['/pid', devServerProc.pid.toString(), '/T', '/F']);
        } else {
          devServerProc.kill();
        }
      } catch {
        // ignore
      }
      devServerProc = null;
    }
  }

  process.on('SIGINT', () => {
    cleanupProcesses();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cleanupProcesses();
    process.exit(0);
  });

  const electronProc = launchElectron();

  electronProc.on('exit', (code) => {
    console.log(`[electron:dev] Electron cerrado con código ${code}`);
    cleanupProcesses();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error('[electron:dev] Error inesperado:', err);
  process.exit(1);
});
