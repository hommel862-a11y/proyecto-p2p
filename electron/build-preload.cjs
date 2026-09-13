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
 *
 * Guard (regression guard): after bundling we (a) delete stale TSC multi-file
 * siblings (e.g. api.js) that tsc may have left in dist/preload, and (b) assert
 * the bundle contains NO local require() — sandbox:true forbids them. If a
 * stale multi-file bundle survives, the build exits nonzero so `electron:build`
 * / CI cannot ship a broken preload.
 */
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

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
    // Guard (a): remove stale TSC multi-file siblings (api.js, shared/*.js …)
    const preloadDir = path.dirname(outfile);
    for (const file of fs.readdirSync(preloadDir)) {
      if (file === path.basename(outfile)) continue;
      fs.unlinkSync(path.join(preloadDir, file));
    }
    // Guard (b): assert no local require() — sandbox violation if present.
    const src = fs.readFileSync(outfile, 'utf8');
    const localRequires = src.match(/require\(\s*["']\.\.?\//g);
    if (localRequires) {
      console.error('Preload bundle contains local require() — sandbox violation:', localRequires);
      process.exit(1);
    }
    console.log(`Preload bundled (guarded) -> ${path.relative(root, outfile)}`);
  })
  .catch((err) => {
    console.error('Preload bundle failed:', err.message);
    process.exit(1);
  });
