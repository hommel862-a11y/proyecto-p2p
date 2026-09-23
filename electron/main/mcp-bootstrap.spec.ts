import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  resolveMcpDistPath,
  getMcpStatus,
  getMcpFullStatus,
  executeMcpToolTest,
} from './mcp-bootstrap';

describe('mcp-bootstrap', () => {
  it('resolves mcp bundle path correctly', () => {
    const resolved = resolveMcpDistPath();
    expect(resolved).toBeTruthy();
    expect(resolved.endsWith(path.join('packages', 'mcp-server', 'dist', 'index.js'))).toBe(true);
  });

  it('provides valid initial status', () => {
    const status = getMcpStatus();
    expect(status).toHaveProperty('enabled');
    expect(status).toHaveProperty('started');
    expect(status).toHaveProperty('startTime');
    expect(status).toHaveProperty('totalCalls');
  });

  it('provides full status with 5 registered MCP servers', () => {
    const full = getMcpFullStatus();
    expect(full.servers.length).toBeGreaterThanOrEqual(5);
    const serverIds = full.servers.map((s) => s.id);
    expect(serverIds).toContain('p2p-decisor');
    expect(serverIds).toContain('p2p-aml-forensics');
    expect(serverIds).toContain('p2p-multi-exchange');
    expect(serverIds).toContain('p2p-bank-sentinel');
    expect(serverIds).toContain('p2p-portfolio-risk');
  });

  it('executes calculate_spread tool via executeMcpToolTest', async () => {
    const res = await executeMcpToolTest('calculate_spread', {
      buyPrice: 800,
      sellPrice: 810,
      exchangeFeePct: 0.1,
    });
    expect(res.success).toBe(true);
    expect(res.executionTimeMs).toBeGreaterThanOrEqual(0);
    expect(res.result).toBeDefined();
  }, 15000);

  it('returns appropriate error when tool is not found', async () => {
    const res = await executeMcpToolTest('non_existent_tool_xyz', {});
    expect(res.success).toBe(false);
    expect(res.error).toContain('no encontrada');
  }, 15000);
});
