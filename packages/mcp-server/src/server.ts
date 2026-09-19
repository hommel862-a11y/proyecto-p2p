import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ALL_MCP_TOOLS, MCP_TOOLS_BY_SERVER } from './tools/index.js';
import { ALL_MCP_RESOURCES } from './resources/index.js';
import { ALL_MCP_PROMPTS } from './prompts/index.js';
import { auditService } from './policy/audit.js';
import { rateLimiter } from './policy/permissions.js';

export interface CreateMcpServerOptions {
  serverId?: string;
  name?: string;
}

export function createP2PMcpServer(options?: CreateMcpServerOptions): McpServer {
  const serverName =
    options?.name ?? (options?.serverId ? `p2p-${options.serverId}` : 'p2p-mcp-server');
  const server = new McpServer({
    name: serverName,
    version: '1.0.0',
  });

  const toolsToRegister =
    options?.serverId && MCP_TOOLS_BY_SERVER[options.serverId]
      ? MCP_TOOLS_BY_SERVER[options.serverId]
      : ALL_MCP_TOOLS;

  // 1. Register Tools with Zod schema validation & audit trail
  for (const tool of toolsToRegister) {
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema.shape,
      async (args: any, _extra: any) => {
        // Enforce rate limiting per tool (e.g. max 60 calls/min)
        if (!rateLimiter.checkLimit(tool.name, 60)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: 'RATE_LIMIT_EXCEEDED',
                  message: `Límite de solicitudes alcanzado para la herramienta ${tool.name}. Espera un momento.`,
                }),
              },
            ],
            isError: true,
          };
        }

        try {
          const validated = tool.inputSchema.parse(args);
          const result = tool.execute(validated as any);

          // Audit log
          auditService.record({
            toolName: tool.name,
            input: validated,
            output: result,
            success: true,
          });

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          auditService.record({
            toolName: tool.name,
            input: args,
            output: null,
            success: false,
            error: errorMsg,
          });

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: 'TOOL_EXECUTION_ERROR', details: errorMsg }),
              },
            ],
            isError: true,
          };
        }
      },
    );
  }

  // 2. Register Resources
  for (const res of ALL_MCP_RESOURCES) {
    server.resource(res.name, res.uri, async () => {
      const data = await res.read();
      return {
        contents: [
          {
            uri: res.uri,
            mimeType: res.mimeType,
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    });
  }

  // 3. Register Prompts
  for (const p of ALL_MCP_PROMPTS) {
    server.prompt(p.name, p.description, () => ({
      messages: [
        {
          role: 'user',
          content: { type: 'text' as const, text: p.content },
        },
      ],
    }));
  }

  return server;
}
