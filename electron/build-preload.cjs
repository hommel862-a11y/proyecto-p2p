/**
 * Builds the Electron preload as a single self-contained CJS file.
 *
 * WHY: Electron loads preloads with `sandbox: true`, which forbids
 * `require()` of local files (only `electron`, `events`, `timers`, `url`
 * are allowed). A plain tsc compile emits `require("./api")` and the
 * preload silently dies at runtime, leaving `window.electron` undefined.
 *
 * esbuild `--bundle` inlines ./api into index.js, so the emitted preload
 * has no local requires and works under sandbox. The source modules remain
 * the single source of truth (and stay unit-testable under Vitest).
 */
const esbuild = require('esbuild');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outfile = path.join(root, 'electron/dist/preload/index.js');

esbuild
  .build({
    entryPoints: [path.join(root, 'electron/preload/index.ts')],
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    target: ['es2022'],
    outfile,
    external: ['electron'],
    sourcemap: false,
  })
  .then(() => {
    console.log(`Preload bundled -> ${path.relative(root, outfile)}`);
  })
  .catch((err) => {
    console.error('Preload bundle failed:', err.message);
    process.exit(1);
  });