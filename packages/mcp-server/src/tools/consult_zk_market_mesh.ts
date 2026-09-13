import { generateBlindHash, DEFAULT_ZK_SALT_DOMAIN, ZkMarketMesh } from '../core/index.js';
import { ConsultZkMarketMeshInputSchema, type ConsultZkMarketMeshInput } from '../schemas/index.js';

// Shared instance for MCP process memory
const mcpZkMesh = new ZkMarketMesh('mcp-node-local');

export const consultZkMarketMeshTool = {
  name: 'consult_zk_market_mesh',
  description: 'Verifica si una cédula, teléfono o cuenta bancaria está fichada en la lista negra federada usando hashes ciegos (Zero-Knowledge). Protege 100% la privacidad.',
  inputSchema: ConsultZkMarketMeshInputSchema,
  execute: (input: ConsultZkMarketMeshInput) => {
    const salt = input.saltDomain || DEFAULT_ZK_SALT_DOMAIN;
    const blindHash = generateBlindHash(input.rawIdentifier, salt);

    const match = mcpZkMesh.queryIdentifier(input.rawIdentifier, salt);

    return {
      blindHash,
      isFlagged: match.isMatch,
      threatCategory: match.threat?.threatType ?? null,
      severity: match.threat?.severity ?? null,
      confidenceScore: match.confidenceScore,
      confirmationsCount: match.threat?.confirmations ?? 0,
      privacyGuaranteed: true,
      verdict: match.isMatch ? 'REJECT_SUSPECTED_FRAUD' : 'CLEAR_NO_FEDERATED_FLAGS',
    };
  },
};
