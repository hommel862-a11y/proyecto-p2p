import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ZK_SALT_DOMAIN,
  ZkMarketMesh,
  generateBlindHash,
  normalizeIdentifier,
} from '../core/index.js';
import { consultZkMarketMeshTool } from './consult_zk_market_mesh.js';
import { generateBlindHash as coreGenerateBlindHash } from '../../../../projects/core/src/lib/zk-market-mesh.js';

describe('consult_zk_market_mesh & ZK hash parity with @p2p/core', () => {
  it('generates identical blind SHA-256 hashes as @p2p/core regardless of identifier formatting', () => {
    expect(DEFAULT_ZK_SALT_DOMAIN).toBe('p2p-ve-mesh-salt-2026');
    expect(normalizeIdentifier(' v- 18.293.041 ')).toBe('V18293041');

    const mcpHash = generateBlindHash(' v- 18.293.041 ');
    const coreHash = coreGenerateBlindHash('V-18293041');
    expect(mcpHash).toBe(coreHash);

    const toolRes = consultZkMarketMeshTool.execute({ rawIdentifier: 'V-18.293.041' });
    expect(toolRes.blindHash).toBe(coreHash);
    expect(toolRes.verdict).toBe('CLEAR_NO_FEDERATED_FLAGS');
  });

  it('scores matches on the 0..100 institutional confidence scale', () => {
    const mesh = new ZkMarketMesh('mcp-test');
    mesh.addFlaggedIdentifier('0102-0555-44-4333222111', DEFAULT_ZK_SALT_DOMAIN, {
      threatType: 'CHARGEBACK',
      severity: 'CRITICAL',
      confirmations: 2,
    });

    const hit = mesh.queryIdentifier('01020555444333222111');
    expect(hit.isMatch).toBe(true);
    expect(hit.confidenceScore).toBe(100);
  });
});
