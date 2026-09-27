import { execFile } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { BacktestRunRequest, BacktestRunResult } from '../../shared/types';

/**
 * Fixed location of the historical simulation harness, relative to the app root.
 * The renderer never supplies this path: a main-process constant is the only way to
 * reach a script, so no renderer string can ever choose what gets executed.
 */
export const HARNESS_RELATIVE_PATH = ['scripts', 'backtest.cjs'] as const;

/** Where the harness writes its Markdown/JSON reports, relative to the app root. */
export const HARNESS_OUTPUT_DIR = ['docs', 'backtesting'] as const;

/** Captured process output is telemetry, not a payload: keep it bounded. */
const OUTPUT_LIMIT = 4000;

/** The harness rebuilds the full local dataset, so it can legitimately take minutes. */
const HARNESS_TIMEOUT_MS = 10 * 60 * 1000;

export interface HarnessProcess {
  stdout: string;
  stderr: string;
  code: number;
}

export interface HarnessExecOptions {
  cwd: string;
  env: Record<string, string | undefined>;
}

export type HarnessExecutor = (
  file: string,
  args: string[],
  options: HarnessExecOptions,
) => Promise<HarnessProcess>;

export function resolveHarnessScript(appRoot: string): string {
  return join(appRoot, ...HARNESS_RELATIVE_PATH);
}

/**
 * Real directory backing `app.getAppPath()`.
 *
 * In a packaged app that path points inside `app.asar`, an archive the harness cannot be
 * spawned from, so it is redirected to the sibling `app.asar.unpacked` directory. The
 * match is anchored to a whole path segment, so a directory that merely starts with the
 * same characters is left untouched.
 */
export function resolveAppRoot(appPath: string): string {
  return appPath.replace(/app\.asar(?=$|[\\/])/, 'app.asar.unpacked');
}

/**
 * Latest `report-*.json` in the harness output directory.
 *
 * Recency comes from the date in the filename, because the harness names every report by
 * day and several runs can land inside the same filesystem timestamp tick — mtime alone
 * would order them arbitrarily. mtime only breaks ties between same-dated reports.
 * Returning null when nothing is readable lets the caller report an honest failure
 * instead of inventing a result.
 */
export function findLatestSummary(outDir: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(outDir);
  } catch {
    return null;
  }

  const dated = entries
    .filter((name) => /^report-.*\.json$/i.test(name))
    .map((name) => {
      const match = /(\d{4}-\d{2}-\d{2})/.exec(name);
      return { file: join(outDir, name), day: match?.[1] ?? '' };
    })
    .filter(({ file }) => {
      try {
        return statSync(file).isFile();
      } catch {
        return false;
      }
    });

  if (dated.length === 0) return null;

  return dated.sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? 1 : -1;
    return statSync(b.file).mtimeMs - statSync(a.file).mtimeMs;
  })[0]?.file ?? null;
}

function bounded(value: unknown): string {
  return String(value ?? '').slice(0, OUTPUT_LIMIT);
}

/**
 * Executes the harness as a Node child of the Electron binary. `ELECTRON_RUN_AS_NODE`
 * is what makes `process.execPath` behave as Node, so the same code path works in dev
 * and in a packaged app without shipping a second runtime. The harness path is passed as
 * the first argument to that interpreter, never as the executable to run directly.
 */
export function createNodeExecutor(
  execPath: string = process.execPath,
  execFileImpl: typeof execFile = execFile,
): HarnessExecutor {
  return (file, args, options) =>
    new Promise<HarnessProcess>((resolvePromise) => {
      execFileImpl(
        execPath,
        [file, ...args],
        {
          cwd: options.cwd,
          env: { ...process.env, ...options.env, ELECTRON_RUN_AS_NODE: '1' },
          windowsHide: true,
          timeout: HARNESS_TIMEOUT_MS,
          maxBuffer: 8 * 1024 * 1024,
          encoding: 'utf8',
        },
        (error, stdout, stderr) => {
          const exitCode = (error as (Error & { code?: number | string }) | null)?.code;
          resolvePromise({
            stdout: bounded(stdout),
            stderr: bounded(stderr),
            code: typeof exitCode === 'number' ? exitCode : error ? 1 : 0,
          });
        },
      );
    });
}

export interface BacktestRunnerDeps {
  /** App root in dev (checkout) or in a packaged app (unpacked resources). */
  appRoot: string;
  execute: HarnessExecutor;
}

/**
 * Runs the harness once and reports what actually happened.
 *
 * `req` is accepted and intentionally ignored: the harness takes its dataset and
 * parameters from local files and exposes no pair/timeframe selector, so the pair and
 * timeframe the operator picked in Telegram are disclosure labels only. Forwarding them
 * as arguments would be a lie the report could not support.
 */
export async function runBacktest(
  req: BacktestRunRequest,
  deps: BacktestRunnerDeps,
): Promise<BacktestRunResult> {
  const scriptPath = resolveHarnessScript(deps.appRoot);

  if (!existsSync(scriptPath)) {
    return {
      ok: false,
      error: 'El harness de backtesting no está presente en esta instalación.',
    };
  }

  let child: HarnessProcess;
  try {
    child = await deps.execute(scriptPath, [], { cwd: deps.appRoot, env: {} });
  } catch (err: unknown) {
    return {
      ok: false,
      error: `No se pudo ejecutar el harness: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Bounded here as well as in the executor: the cap is part of what the renderer
  // receives, not an implementation detail of one particular executor.
  const stdout = bounded(child.stdout);
  const stderr = bounded(child.stderr);
  const code = child.code;

  if (code !== 0) {
    return {
      ok: false,
      stdout,
      stderr,
      error: `El harness terminó con código ${code}.`,
    };
  }

  const summaryPath = findLatestSummary(join(deps.appRoot, ...HARNESS_OUTPUT_DIR));
  if (!summaryPath) {
    return {
      ok: false,
      stdout,
      stderr,
      error: 'El harness terminó sin dejar un resumen legible.',
    };
  }

  let summary: unknown;
  try {
    summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  } catch (err: unknown) {
    return {
      ok: false,
      stdout,
      stderr,
      summaryPath,
      error: `El resumen del backtest no se pudo leer: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  return { ok: true, stdout, stderr, summaryPath, summary };
}
