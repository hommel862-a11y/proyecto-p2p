/**
 * Gentle AI Review Gate — Puente MCP ↔ Gentle AI review system.
 *
 * Consulta el estado del receipt-driven development (RDD) gate antes de cada
 * commit, push o PR para validar si la revisión nativa ha aprobado o bloqueado
 * el cambio.
 *
 * Patrón: el agente llama a gentle-ai review status, obtiene next_transition,
 * y este adaptador lo interpreta en un veredicto simple para el agente.
 */

export type ReviewGateVerdict =
  | 'ALLOW'       // Receipt aprobado, entregar bajo policy
  | 'BLOCKED'     // Hay un bloqueo que requiere acción humana
  | 'UNMANAGED'   // RDD desactivado, entregar bajo policy normal
  | 'UNKNOWN';    // No se pudo determinar (error, timeout)

export interface ReviewGateResult {
  verdict: ReviewGateVerdict;
  reason?: string;
  nextTransition?: string;
  lineageId?: string;
  rawStatus?: Record<string, unknown>;
}

/**
 * Consulta el review gate de Gentle AI para un candidato dado.
 *
 * @param repoPath - Ruta al repo (use el cwd del MCP server / Electron)
 * @param contract - Contrato de revisión (default: gentle-ai.review-integration/v2)
 * @param agent - Agente que ejecuta (opencode, claude-code, codex)
 */
export async function gentleReviewGate(
  repoPath: string,
  contract = 'gentle-ai.review-integration/v2',
  agent = 'opencode',
): Promise<ReviewGateResult> {
  const result = await globalThis.mcp?.callTool('mcp__gentle-ai__review_status', {
    cwd: repoPath,
    contract,
    agent,
    nextTransition: true,
  });

  if (!result?.success) {
    return {
      verdict: 'UNKNOWN',
      reason: result?.error ?? 'gentle-ai review status failed',
      rawStatus: result?.data as Record<string, unknown>,
    };
  }

  const data = result.data as {
    next_transition?: { operation?: string };
    reason_code?: string;
    lineage_id?: string;
    reviewGate?: string;
  };

  const nextOp = data?.next_transition?.operation;

  // Interpretar el next_transition del lifecycle
  if (nextOp === 'stop' || data?.reason_code) {
    return {
      verdict: 'BLOCKED',
      reason: data?.reason_code ?? 'review stopped',
      nextTransition: nextOp,
      lineageId: data?.lineage_id,
      rawStatus: result.data as Record<string, unknown>,
    };
  }

  if (nextOp === 'execute' || data?.reviewGate === 'allow') {
    return {
      verdict: 'ALLOW',
      nextTransition: nextOp,
      lineageId: data?.lineage_id,
      rawStatus: result.data as Record<string, unknown>,
    };
  }

  // RDD desactivado o review no iniciado para este candidato
  if (data?.reviewGate === 'disabled/unmanaged' || !data?.reviewGate) {
    return {
      verdict: 'UNMANAGED',
      nextTransition: nextOp,
      rawStatus: result.data as Record<string, unknown>,
    };
  }

  return {
    verdict: 'UNKNOWN',
    reason: `unexpected reviewGate: ${String(data?.reviewGate)}`,
    rawStatus: result.data as Record<string, unknown>,
  };
}

/**
 * Verifica si el review gate permite un commit/push/PR.
 * Retorna true si ALLOW o UNMANAGED (entrega bajo policy normal).
 * Retorna false si BLOCKED o UNKNOWN.
 */
export async function canDeliver(
  repoPath: string,
): Promise<{ allowed: boolean; verdict: ReviewGateResult }> {
  const result = await gentleReviewGate(repoPath);
  const allowed = result.verdict === 'ALLOW' || result.verdict === 'UNMANAGED';
  return { allowed, verdict: result };
}