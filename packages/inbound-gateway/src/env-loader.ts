import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export interface LoadGatewayEnvOptions {
  cwd?: string;
  repoRoot?: string;
  targetEnv?: Record<string, string | undefined>;
}

export interface LoadGatewayEnvResult {
  repoRoot: string;
  loadedFiles: string[];
}

export function findMonorepoRoot(startDir: string): string {
  let current = resolve(startDir);
  for (let depth = 0; depth < 8; depth += 1) {
    const pkgPath = join(current, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: unknown };
        if (raw.name === 'p2p') {
          return current;
        }
      } catch {
        // Keep walking upwards
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(startDir);
}

/**
 * Loads environment files in deterministic priority without overriding pre-set env vars:
 * process.env / ENV_FILE > <cwd>/.env > <repoRoot>/.env > <repoRoot>/deploy/vps/.env.
 */
export function loadGatewayEnv(options: LoadGatewayEnvOptions = {}): LoadGatewayEnvResult {
  const cwd = resolve(options.cwd ?? process.cwd());
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(options.repoRoot ?? findMonorepoRoot(moduleDir));
  const targetEnv = options.targetEnv ?? process.env;

  const explicitEnvFile = targetEnv['ENV_FILE']?.trim();
  const candidates: string[] = [];
  if (explicitEnvFile) {
    candidates.push(isAbsolute(explicitEnvFile) ? explicitEnvFile : resolve(cwd, explicitEnvFile));
  }
  candidates.push(join(cwd, '.env'));
  candidates.push(join(repoRoot, '.env'));
  candidates.push(join(repoRoot, 'deploy', 'vps', '.env'));

  const seen = new Set<string>();
  const loadedFiles: string[] = [];

  for (const candidate of candidates) {
    const normalized = resolve(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    if (!existsSync(normalized)) continue;
    const parsed = dotenv.parse(readFileSync(normalized, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (targetEnv[key] === undefined) {
        targetEnv[key] = value;
      }
    }
    loadedFiles.push(normalized);
  }

  return { repoRoot, loadedFiles };
}
