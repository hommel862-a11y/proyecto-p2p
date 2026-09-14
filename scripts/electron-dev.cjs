const http = require('node:http');
const { spawn } = require('node:child_process');

const PORT = 4200;
const URL = `http://localhost:${PORT}/`;
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
  console.log('[electron:dev] Compilando TypeScript de Electron...');
  execSync('npx tsc -p electron/tsconfig.json', { stdio: 'inherit' });
  console.log('[electron:dev] Empaquetando preload bundle...');
  execSync('node electron/build-preload.cjs', { stdio: 'inherit' });
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
      if (devServerProc) devServerProc.kill();
      process.exit(1);
    }
  }

  const electronProc = launchElectron();

  electronProc.on('exit', (code) => {
    console.log(`[electron:dev] Electron cerrado con código ${code}`);
    if (devServerProc) {
      console.log('[electron:dev] Deteniendo servidor de desarrollo...');
      devServerProc.kill();
    }
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error('[electron:dev] Error inesperado:', err);
  process.exit(1);
});
