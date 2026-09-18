/**
 * Engram Adapter — Puente MCP ↔ Engram (memoria persistente).
 *
 * Expone funciones TypeScript que llaman las tools MCP del servidor Engram
 * a través del canal IPC de Electron o del MCP globalThis.
 *
 * Uso en agente:
 *   1. Agente ejecuta `mcp__engram__mem_save` vía su MCP client
 *   2. Este adaptador abstrae los helpers para uso interno del MCP server
 */

export interface EngramContext {
  project: string;
  sessionId?: string;
}

export interface SaveObservation {
  title: string;
  content: string;
  type?: 'decision' | 'bugfix' | 'architecture' | 'discovery' | 'pattern' | 'config';
  topicKey?: string;
}

export interface SearchResult {
  id: number;
  title: string;
  content: string;
  score: number;
  project: string;
}

// ─── API wrapper functions ────────────────────────────────────────────────────

/**
 * Guarda una observación en Engram vía MCP tool call.
 */
export async function engramSave(
  ctx: EngramContext,
  obs: SaveObservation,
): Promise<{ id: number; success: boolean; error?: string }> {
  const result = await globalThis.mcp?.callTool('mcp__engram__mem_save', {
    project: ctx.project,
    title: obs.title,
    content: obs.content,
    type: obs.type ?? 'manual',
    topicKey: obs.topicKey,
    session_id: ctx.sessionId,
    capture_prompt: false,
  });

  if (result?.success) {
    const data = result.data as { id?: number };
    return { id: data?.id ?? 0, success: true };
  }
  return { id: 0, success: false, error: result?.error ?? 'engram-save failed' };
}

/**
 * Busca observaciones en Engram por query semántico.
 */
export async function engramSearch(
  ctx: EngramContext,
  query: string,
  limit = 10,
): Promise<SearchResult[]> {
  const result = await globalThis.mcp?.callTool('mcp__engram__mem_search', {
    project: ctx.project,
    query,
    limit,
    scope: 'project',
  });

  if (result?.success && result.data) {
    const data = result.data as { results?: SearchResult[] };
    return data?.results ?? [];
  }
  return [];
}

/**
 * Obtiene contexto reciente de sesiones anteriores.
 */
export async function engramContext(
  ctx: EngramContext,
): Promise<{ sessions: number; observations: number }> {
  const result = await globalThis.mcp?.callTool('mcp__engram__mem_context', {
    project: ctx.project,
    scope: 'project',
  });

  if (result?.success && result.data) {
    const data = result.data as { sessions?: number; observations?: number };
    return {
      sessions: data?.sessions ?? 0,
      observations: data?.observations ?? 0,
    };
  }
  return { sessions: 0, observations: 0 };
}

/**
 * Obtiene el contenido completo de una observación por ID.
 */
export async function engramGetObservation(
  id: number,
): Promise<{ title: string; content: string; type: string } | null> {
  const result = await globalThis.mcp?.callTool('mcp__engram__mem_get_observation', {
    id,
  });

  if (result?.success && result.data) {
    const data = result.data as { title?: string; content?: string; type?: string };
    return {
      title: data?.title ?? '',
      content: data?.content ?? '',
      type: data?.type ?? 'manual',
    };
  }
  return null;
}

/**
 * Guarda un resumen de sesión vía Engram.
 */
export async function engramSessionSummary(
  ctx: EngramContext,
  content: string,
): Promise<{ success: boolean; error?: string }> {
  const result = await globalThis.mcp?.callTool('mcp__engram__mem_session_summary', {
    project: ctx.project,
    session_id: ctx.sessionId,
    content,
  });

  return {
    success: result?.success ?? false,
    error: result?.error,
  };
}
