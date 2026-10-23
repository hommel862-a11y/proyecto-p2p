#!/usr/bin/env node
'use strict';

/**
 * Workspace-wide TypeScript type-check gate.
 * Validates:
 * 1. projects/core/tsconfig.lib.json (Pure domain library)
 * 2. tsconfig.app.json (Angular application)
 * 3. tsconfig.spec.json (Angular application specs)
 * 4. projects/core/tsconfig.spec.json (Core library unit specs)
 */

const { spawnSync } = require('child_process');
const path = require('path');

const TARGETS = [
  { name: 'core:lib', config: 'projects/core/tsconfig.lib.json' },
  { name: 'app:main', config: 'tsconfig.app.json' },
  { name: 'app:spec', config: 'tsconfig.spec.json' },
  { name: 'core:spec', config: 'projects/core/tsconfig.spec.json' },
];

console.log('[typecheck] Running workspace-wide type check across all project targets...');
let hasError = false;

for (const target of TARGETS) {
  const start = Date.now();
  process.stdout.write(`  -> Checking ${target.name} (${target.config})... `);
  
  const result = spawnSync('npx', ['tsc', '-p', target.config, '--noEmit'], {
    shell: true,
    encoding: 'utf-8',
    cwd: path.resolve(__dirname, '..'),
  });

  const durationMs = Date.now() - start;
  if (result.status === 0) {
    console.log(`OK (${durationMs}ms)`);
  } else {
    console.log(`FAILED (${durationMs}ms)`);
    if (result.stdout) console.log(result.stdout.trim());
    if (result.stderr) console.error(result.stderr.trim());
    hasError = true;
  }
}

if (hasError) {
  console.error('\n[typecheck] FAILED: Type errors detected in one or more targets.');
  process.exit(1);
} else {
  console.log('\n[typecheck] PASSED: All 4 targets typechecked cleanly.');
  process.exit(0);
}
