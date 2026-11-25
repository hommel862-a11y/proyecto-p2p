import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  resolveInboundGatewayEntry,
  ensureInboundGatewayRunning,
  stopManagedInboundGateway,
} from './inbound-gateway-bootstrap';

describe('inbound-gateway-bootstrap', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    stopManagedInboundGateway();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('resolves packages/inbound-gateway/dist/index.js from search roots', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-gw-boot-'));
    tempDirs.push(tmp);
    const entry = path.join(tmp, 'packages', 'inbound-gateway', 'dist', 'index.js');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, '// stub gateway', 'utf8');

    expect(resolveInboundGatewayEntry([tmp])).toBe(entry);
    expect(resolveInboundGatewayEntry([path.join(tmp, 'missing')])).toBeNull();
  });

  it('returns ALREADY_RUNNING without spawning a duplicate process when /health is already up', async () => {
    const healthChecker = vi.fn(async () => true);
    const res = await ensureInboundGatewayRunning({
      port: 3030,
      searchRoots: [os.tmpdir()],
      healthChecker,
    });

    expect(res.status).toBe('ALREADY_RUNNING');
    expect(res.port).toBe(3030);
    expect(healthChecker).toHaveBeenCalledWith(3030);
  });

  it('returns ENTRY_NOT_FOUND cleanly when /health is down and dist/index.js is missing', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-gw-empty-'));
    tempDirs.push(tmp);
    const healthChecker = vi.fn(async () => false);
    const res = await ensureInboundGatewayRunning({
      port: 3030,
      searchRoots: [tmp],
      healthChecker,
    });

    expect(res.status).toBe('ENTRY_NOT_FOUND');
    expect(res.port).toBe(3030);
  });
});
