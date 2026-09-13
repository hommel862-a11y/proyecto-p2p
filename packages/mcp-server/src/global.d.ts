/**
 * Global type declarations for MCP server runtime context.
 */

interface McpToolCaller {
  callTool: (name: string, args: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>;
}

declare global {
  var mcp: McpToolCaller | undefined;
}

export {};