import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import {
  HARNESS_OUTPUT_DIR,
  HARNESS_RELATIVE_PATH,
  createNodeExecutor,
  findLatestSummary,
  resolveAppRoot,
  resolveHarnessScript,
  runBacktest,
  type HarnessProcess,
} from './backtest-runner';

/**
 * The renderer has no Node access, so this main-process module is the only path to
 * `scripts/backtest.cjs`. These tests use a real temp directory as the app root so the
 * filesystem contract (script location, report discovery) is exercised for real, and an
 * injected executor so no simulation is actually spawned.
 */
describe('backtest-runner', () => {
  let appRoot: string;

  beforeEach(() => {
    appRoot = mkdtempSync(join(tmpdir(), 'p2p-backtest-'));
    mkdirSync(join(appRoot, ...HARNESS_RELATIVE_PATH, '..'), { recursive: true });
    writeFileSync(resolveHarnessScript(appRoot), '// harness placeholder\n', 'utf8');
    mkdirSync(join(appRoot, ...HARNESS_OUTPUT_DIR), { recursive: true });
  });

  afterEach(() => {
    rmSync(appRoot, { recursive: true, force: true });
  });

  function writeReport(file: string, body: unknown): string {
    const outDir = join(appRoot, ...HARNESS_OUTPUT_DIR);
    const target = join(outDir, file);
    writeFileSync(target, typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    return target;
  }

  function executorReturning(result: Partial<HarnessProcess>) {
    return vi.fn(async () => ({ stdout: '', stderr: '', code: 0, ...result }));
  }

  it('resolves the harness to a fixed path inside the app root', () => {
    expect(HARNESS_RELATIVE_PATH).toEqual(['scripts', 'backtest.cjs']);
    expect(resolveHarnessScript(appRoot)).toBe(join(appRoot, 'scripts', 'backtest.cjs'));
  });

  it('runs the harness with no renderer-controlled arguments', async () => {
    // The pair and timeframe are operator labels: the harness reads its own local
    // dataset, so passing them through would imply a selection it never performed.
    const execute = executorReturning({ code: 0 });

    await runBacktest({ pair: 'usdt_ves', timeframe: '1h' }, { appRoot, execute });

    expect(execute).toHaveBeenCalledTimes(1);
    const [file, args, options] = execute.mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string; env: Record<string, string | undefined> },
    ];
    expect(args).toEqual([]);
    expect(options.cwd).toBe(appRoot);
    expect(file).toBeTruthy();
  });

  it('reads back the newest harness summary after a successful run', async () => {
    const summary = { operations: 7, spreadEngine: { aciertoNetoPct: 62.5 } };
    const newest = writeReport('report-2026-09-27.json', summary);
    writeReport('report-2026-01-01.json', { operations: 1 });

    const result = await runBacktest({}, { appRoot, execute: executorReturning({ code: 0 }) });

    expect(result.ok).toBe(true);
    expect(result.summaryPath).toBe(newest);
    expect(result.summary).toEqual(summary);
  });

  it('fails honestly when the harness exits non-zero', async () => {
    const result = await runBacktest(
      {},
      { appRoot, execute: executorReturning({ code: 3, stderr: 'boom' }) },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('3');
    expect(result.stderr).toBe('boom');
    expect(result.summary).toBeUndefined();
  });

  it('fails honestly when the run produced no readable summary', async () => {
    const result = await runBacktest({}, { appRoot, execute: executorReturning({ code: 0 }) });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/resumen|summary/i);
  });

  it('fails honestly when the summary file is not valid JSON', async () => {
    writeReport('report-2026-09-27.json', 'not json at all');

    const result = await runBacktest({}, { appRoot, execute: executorReturning({ code: 0 }) });

    expect(result.ok).toBe(false);
    expect(result.summary).toBeUndefined();
  });

  it('reports a missing harness instead of spawning anything', async () => {
    rmSync(resolveHarnessScript(appRoot));

    const execute = executorReturning({ code: 0 });
    const result = await runBacktest({}, { appRoot, execute });

    expect(execute).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/harness/i);
  });

  it('survives an executor that throws', async () => {
    const execute = vi.fn(async () => {
      throw new Error('spawn ENOENT');
    });

    const result = await runBacktest({}, { appRoot, execute });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('spawn ENOENT');
  });

  it('bounds the captured process output', async () => {
    const result = await runBacktest(
      {},
      { appRoot, execute: executorReturning({ code: 1, stdout: 'x'.repeat(50_000) }) },
    );

    expect(result.stdout?.length).toBeLessThanOrEqual(4000);
  });

  it('finds no summary in a directory that does not exist', () => {
    expect(findLatestSummary(join(appRoot, 'does', 'not', 'exist'))).toBeNull();
  });

  it('uses the checkout itself as the app root outside a package', () => {
    expect(resolveAppRoot('/home/dev/p2p')).toBe('/home/dev/p2p');
  });

  it('points at the unpacked resources when running from inside app.asar', () => {
    expect(resolveAppRoot('/opt/p2p/resources/app.asar')).toBe(
      '/opt/p2p/resources/app.asar.unpacked',
    );
  });

  it('keeps any path nested under app.asar when unpacking it', () => {
    expect(resolveAppRoot('/opt/p2p/resources/app.asar/scripts')).toBe(
      '/opt/p2p/resources/app.asar.unpacked/scripts',
    );
  });

  it('leaves a directory that merely looks like app.asar alone', () => {
    expect(resolveAppRoot('/opt/app.asar.backup')).toBe('/opt/app.asar.backup');
  });
});

describe('createNodeExecutor', () => {
  it('runs the harness with the Electron binary in Node mode, from the app root', async () => {
    const execFileImpl = vi.fn(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, 'out', '');
        return {} as never;
      },
    );

    const execute = createNodeExecutor('/opt/p2p/p2p', execFileImpl as never);
    const result = await execute('/app/scripts/backtest.cjs', [], {
      cwd: '/app',
      env: { PATH: '/usr/bin' },
    });

    const [file, args, options] = execFileImpl.mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string; env: Record<string, string | undefined>; windowsHide: boolean; timeout: number },
    ];
    expect(file).toBe('/opt/p2p/p2p');
    expect(args).toEqual(['/app/scripts/backtest.cjs']);
    // The renderer never supplies the interpreter or the script path; the harness
    // needs no arguments at all, and it must not flash a console window.
    expect(options.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(options.env.PATH).toBe('/usr/bin');
    expect(options.cwd).toBe('/app');
    expect(options.windowsHide).toBe(true);
    expect(options.timeout).toBeGreaterThan(0);
    expect(result).toEqual({ stdout: 'out', stderr: '', code: 0 });
  });

  it('reports the exit code when the child fails', async () => {
    const execFileImpl = vi.fn(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: (Error & { code?: number }) | null, stdout: string, stderr: string) => void,
      ) => {
        const error = Object.assign(new Error('failed'), { code: 2 });
        callback(error, '', 'nope');
        return {} as never;
      },
    );

    const execute = createNodeExecutor('electron', execFileImpl as never);
    const result = await execute('/app/scripts/backtest.cjs', [], { cwd: '/app', env: {} });

    expect(result).toEqual({ stdout: '', stderr: 'nope', code: 2 });
  });
});
