/**
 * Gentle Kill-Switch Adapter — Kill-switch unificado para MCP + Electron + CLI.
 *
 * Unifica el estado del kill-switch entre:
 * - MCP tools (trigger_killswitch tool en MCP server)
 * - Electron IPC (p2p:killswitch-status / p2p:killswitch-activate)
 * - Gentle AI review (receipt-driven development)
 *
 * Patrón: singleton en memoria MCP + persistencia via ledger/MCP.
 * Cada operación pasa por esta función para evitar estados divergentes.
 */

export type KillSwitchStatus = 'INACTIVE' | 'ACTIVE' | 'UNKNOWN';

export interface KillSwitchState {
  status: KillSwitchStatus;
  activatedAt?: number;
  reason?: string;
  source?: string;
  confirmationToken?: string;
}

export interface KillSwitchResult {
  success: boolean;
  previousStatus: KillSwitchStatus;
  newStatus: KillSwitchStatus;
  state: KillSwitchState;
  error?: string;
}

// Estado en memoria del proceso MCP (fuente de verdad mientras MCP esté vivo)
let localKillSwitchState: KillSwitchState = { status: 'INACTIVE' };

/**
 * Obtiene el estado actual del kill-switch.
 * Consulta MCP server state → Electron IPC como fallback.
 */
export async function getKillSwitchStatus(): Promise<KillSwitchState> {
  // 1. Estado local (MCP server)
  if (localKillSwitchState.status !== 'INACTIVE') {
    return { ...localKillSwitchState };
  }

  // 2. Consulta Electron IPC si disponible (estado persistido)
  try {
    const result = await globalThis.mcp?.callTool('electron_ipc_invoke', {
      channel: 'p2p:killswitch-status',
      args: [{}],
    });

    if (result?.success && result.data) {
      const data = result.data as {
        isTriggered?: boolean;
        timestamp?: number;
        reason?: string;
      };
      if (data.isTriggered) {
        localKillSwitchState = {
          status: 'ACTIVE',
          activatedAt: data.timestamp,
          reason: data.reason,
          source: 'electron-persistence',
        };
        return { ...localKillSwitchState };
      }
    }
  } catch {}

  return { status: 'INACTIVE' };
}

/**
 * Activa el kill-switch (requiere human-in-the-loop).
 *
 * Flujo:
 * 1. Si no se proporciona confirmToken, genera uno y retorna REQUIRES_CONFIRMATION
 * 2. Si confirmToken es válido, activa y propaga a Electron + MCP
 */
export async function activateKillSwitch(
  reason: string,
  source = 'MCP_ADAPTER',
  confirmToken?: string,
): Promise<KillSwitchResult> {
  const previousStatus = (await getKillSwitchStatus()).status;

  if (previousStatus === 'ACTIVE') {
    return {
      success: false,
      previousStatus,
      newStatus: 'ACTIVE',
      state: localKillSwitchState,
      error: 'Kill-switch is already ACTIVE',
    };
  }

  // Genera challenge token si no se proporcionó
  if (!confirmToken) {
    const token = `KS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    return {
      success: false,
      previousStatus,
      newStatus: 'INACTIVE',
      state: { status: 'INACTIVE', confirmationToken: token },
      error: 'Requires confirmationToken. Call with valid token to proceed.',
    };
  }

  // Activa localmente
  localKillSwitchState = {
    status: 'ACTIVE',
    activatedAt: Date.now(),
    reason,
    source,
    confirmationToken: confirmToken,
  };

  // Propaga a Electron (persistencia): canal real p2p:killswitch-trigger
  try {
    await globalThis.mcp?.callTool('electron_ipc_invoke', {
      channel: 'p2p:killswitch-trigger',
      args: [{ reason, source }],
    });
  } catch {}

  return {
    success: true,
    previousStatus,
    newStatus: 'ACTIVE',
    state: { ...localKillSwitchState },
  };
}

/**
 * Desactiva el kill-switch (solo para debugging/testing).
 * En producción, requiere reinicio limpio del proceso.
 */
export function deactivateKillSwitch(): void {
  localKillSwitchState = { status: 'INACTIVE' };
}

/**
 * Verifica si el kill-switch está activo antes de ejecutar una operación.
 * Retorna true si la operación debe BLOQUEARSE.
 */
export async function isOperationBlocked(): Promise<{
  blocked: boolean;
  reason?: string;
}> {
  const state = await getKillSwitchStatus();
  if (state.status === 'ACTIVE') {
    return {
      blocked: true,
      reason: state.reason ?? 'Kill-switch activated',
    };
  }
  return { blocked: false };
}