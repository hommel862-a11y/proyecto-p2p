#!/usr/bin/env node
'use strict';

/**
 * Sync / check del vendor Electron de motores de dominio — Work Unit
 * "Deuda técnica: vendor p2p-core byte-idéntico".
 *
 * `electron/main/vendor/p2p-core/` contiene una copia byte-idéntica (pin
 * técnico) de 19 motores de `projects/core/src/lib/*.ts`, compilada por el
 * copiloto de Electron porque `electron/tsconfig.json` usa `rootDir: "."`
 * (tsc TS6059) y `@p2p/core` no es consumible como paquete. Esto evita el
 * doble mantenimiento manual: todo cambio en `projects/core/src/lib/<X>.ts`
 * se propaga con un solo comando.
 *
 * SOLO gestiona los 19 archivos del grafo de cierre. Nunca toca
 * `README.md` (salvo --update-readme) ni borra archivos extra del vendor.
 *
 * Usage:
 *   node scripts/sync-vendor-core.cjs                  # sync (default): copia byte-idéntica origen->destino
 *   node scripts/sync-vendor-core.cjs --check          # compara SHA-256 sin escribir nada
 *   node scripts/sync-vendor-core.cjs --update-readme  # actualiza fingerprint + fecha en el README del vendor
 *   node scripts/sync-vendor-core.cjs --check --update-readme
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SRC_DIR = 'projects/core/src/lib';
const DST_DIR = 'electron/main/vendor/p2p-core';
const README_PATH = path.join(DST_DIR, 'README.md');

// Grafo de cierre del copiloto de Electron (orden estable, igual al README del vendor).
const VENDOR_NAMES = [
  'money',
  'log',
  'operator-manager',
  'accounts',
  'johnson-depth',
  'orderbook-microstructure',
  'binance-p2p',
  'backup-encryption',
  'triangular-arbitrage',
  'bcv-intervention-predictor',
  'delta-neutral-hedge',
  'volatility-forecaster',
  'zk-market-mesh',
  'fsm',
  'receipt-ocr',
  'fraud-shield',
  'dispute-copilot',
  'trade-impact-simulator',
  'spread-quality',
];

// ---------------------------------------------------------------------------
// Paths / validation
// ---------------------------------------------------------------------------
function requireRepoRoot() {
  const root = process.cwd();
  const pkg = path.join(root, 'package.json');
  const src = path.join(root, SRC_DIR);
  const dst = path.join(root, DST_DIR);
  if (!fs.existsSync(pkg) || !fs.statSync(pkg).isFile() ||
      !fs.existsSync(src) || !fs.statSync(src).isDirectory() ||
      !fs.existsSync(dst) || !fs.statSync(dst).isDirectory()) {
    console.error(`Error: el cwd '${root}' no parece ser la raiz del repo p2p.`);
    console.error(`Esperaba encontrar: ${SRC_DIR}, ${DST_DIR} y package.json`);
    process.exit(2);
  }
  return root;
}

function buildPairs(root) {
  return VENDOR_NAMES.map((name) => ({
    name,
    src: path.join(root, SRC_DIR, `${name}.ts`),
    dst: path.join(root, DST_DIR, `${name}.ts`),
  }));
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// ---------------------------------------------------------------------------
// Sync (default)
// ---------------------------------------------------------------------------
function runSync(pairs) {
  console.log('=== sync-vendor-core: sync ===');
  let changed = 0;
  let noop = 0;
  let missing = 0;
  for (const p of pairs) {
    if (!fs.existsSync(p.src)) {
      console.error(`  FALTA origen: ${p.src}`);
      missing++;
      continue;
    }
    if (fs.existsSync(p.dst)) {
      if (sha256(p.src) === sha256(p.dst)) {
        console.log(`  ok ${p.name}: identico (sin cambios)`);
        noop++;
        continue;
      }
      fs.copyFileSync(p.src, p.dst);
      changed++;
      console.log(`  ${p.name}: re-sincronizado (origen cambiado)`);
    } else {
      fs.copyFileSync(p.src, p.dst);
      changed++;
      console.log(`  ${p.name}: copiado (faltaba en destino)`);
    }
  }
  console.log(`Resultado: ${VENDOR_NAMES.length - missing} archivos gestionados, ` +
    `${changed} copiados/actualizados, ${noop} ya identicos, ${missing} origen(es) faltante(s)`);
  return missing === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------
function runCheck(pairs) {
  console.log('=== sync-vendor-core: check ===');
  let identical = 0;
  const bad = [];
  for (const p of pairs) {
    if (!fs.existsSync(p.src) && !fs.existsSync(p.dst)) {
      console.log(`  ${p.name}: \u2717 FALTA (origen y destino)`);
      bad.push(p.name);
    } else if (!fs.existsSync(p.src)) {
      console.log(`  ${p.name}: \u2717 FALTA (origen)`);
      bad.push(p.name);
    } else if (!fs.existsSync(p.dst)) {
      console.log(`  ${p.name}: \u2717 FALTA (destino)`);
      bad.push(p.name);
    } else if (sha256(p.src) === sha256(p.dst)) {
      console.log(`  ${p.name}: \u2713 IDENTICO`);
      identical++;
    } else {
      console.log(`  ${p.name}: \u2717 DIFF`);
      bad.push(p.name);
    }
  }
  const total = VENDOR_NAMES.length;
  if (bad.length) {
    console.log(`Resultado: ${identical}/${total} identicos | diferencias: ${bad.join(', ')}`);
    return 1;
  }
  console.log(`Resultado: ${identical}/${total} identicos`);
  return 0;
}

// ---------------------------------------------------------------------------
// README status (idempotente)
// ---------------------------------------------------------------------------
function localStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fingerprint(pairs) {
  const hash = crypto.createHash('sha256');
  for (const p of pairs) hash.update(fs.readFileSync(p.dst));
  return hash.digest('hex');
}

function runUpdateReadme(root, pairs) {
  const readme = path.join(root, README_PATH);
  if (!fs.existsSync(readme)) {
    console.error(`Error: no existe ${README_PATH} en la raiz del repo.`);
    return 1;
  }
  const stamp = localStamp();
  const fp = fingerprint(pairs);
  const section = [
    '## Estado de sincronizacion',
    '',
    `- Ultima verificacion: ${stamp} (local)`,
    `- Fingerprint SHA-256 (contenido concatenado de los ${VENDOR_NAMES.length} archivos vendored): \`${fp}\``,
    '- Recordatorio: `npm run check:vendor` compara copia vs original; `npm run sync:vendor` re-copia.',
    '',
  ].join('\n');

  const existing = fs.readFileSync(readme, 'utf8');
  const marker = /^## Estado de sincronizacion\s*$/m;
  let next;
  if (marker.test(existing)) {
    next = existing.slice(0, existing.search(marker)).replace(/\s+$/, '') + '\n\n' + section;
  } else {
    next = existing.replace(/\s+$/, '') + '\n\n' + section;
  }
  fs.writeFileSync(readme, next, 'utf8');
  console.log(`=== sync-vendor-core: update-readme ===`);
  console.log(`README actualizado: ${README_PATH}`);
  console.log(`Fecha: ${stamp} | fingerprint: ${fp}`);
  return 0;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------
function usage() {
  console.log('');
  console.log('Uso:');
  console.log('  node scripts/sync-vendor-core.cjs                  # sync (default)');
  console.log('  node scripts/sync-vendor-core.cjs --check          # check sin escribir');
  console.log('  node scripts/sync-vendor-core.cjs --update-readme  # fingerprint + fecha en el README');
  console.log('  node scripts/sync-vendor-core.cjs --check --update-readme');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const root = requireRepoRoot();
  const pairs = buildPairs(root);
  const argv = process.argv.slice(2);
  const wantsCheck = argv.includes('--check');
  const wantsUpdateReadme = argv.includes('--update-readme');
  const unknown = argv.filter((a) => a !== '--check' && a !== '--update-readme');
  if (unknown.length) {
    console.error(`Error: argumentos desconocidos: ${unknown.join(' ')}`);
    usage();
    return 2;
  }

  let exitCode = 0;
  if (wantsCheck) exitCode = runCheck(pairs);
  if (wantsUpdateReadme) exitCode = runUpdateReadme(root, pairs) || exitCode;
  if (!wantsCheck && !wantsUpdateReadme) exitCode = runSync(pairs);

  usage();
  return exitCode;
}

process.exit(main());