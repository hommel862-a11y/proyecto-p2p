import path from 'node:path';

export interface McpBootstrapStatus {
  enabled: boolean;
  started: boolean;
  error?: string;
}

let mcpStatus: McpBootstrapStatus = {
  enabled: false,
  started: false,
};

/**
 * Initializes the embedded P2P MCP server if MCP_ENABLED=1 or --enable-mcp flag is passed.
 * Does not block Electron application startup if disabled or fails.
 */
export async function bootstrapMcpServer(): Promise<McpBootstrapStatus> {
  const isEnabled = process.env['MCP_ENABLED'] === '1' || process.argv.includes('--enable-mcp');
  mcpStatus.enabled = isEnabled;

  if (!isEnabled) {
    return mcpStatus;
  }

  try {
    const mcpDistPath = path.resolve(__dirname, '../../../packages/mcp-server/dist/index.js');
    const fileUrl = new URL(`file:///${mcpDistPath.replace(/\\/g, '/')}`).href;

    // Use dynamic import to load ESM package from CommonJS Electron runtime
    const importEsm = new Function('specifier', 'return import(specifier)');
    const mcpModule = await importEsm(fileUrl);

    if (mcpModule && typeof mcpModule.createP2PMcpServer === 'function') {
      const server = mcpModule.createP2PMcpServer();
      mcpStatus.started = Boolean(server);
      console.log('🚀 [MCP Bootstrap] P2P MCP Server successfully initialized inside Electron.');
    } else {
      throw new Error('createP2PMcpServer not found in bundle');
    }
    return mcpStatus;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('⚠️ [MCP Bootstrap] Could not initialize embedded MCP server:', msg);
    mcpStatus.error = msg;
    return mcpStatus;
  }
}

export function getMcpStatus(): McpBootstrapStatus {
  return mcpStatus;
}
