export interface TelegramConfig {
  botToken: string;
  chatId?: string;
  enabled: boolean;
  alertsOnRisk: boolean;
  alertsOnFavorable: boolean;
  alertsOnAccountLimit: boolean;
}

export interface RuleAlertEvent {
  type:
    | 'risk_deny'
    | 'risk_pause'
    | 'favorable_spread'
    | 'account_limit'
    | 'account_warning'
    | 'session_start'
    | 'session_end';
  title: string;
  details: string;
  value?: string | number;
  timestamp?: string;
}

export function formatTelegramMessage(event: RuleAlertEvent): string {
  let header = '';
  switch (event.type) {
    case 'risk_deny':
    case 'risk_pause':
      header = '🚨 <b>ALERTA DE RIESGO</b>';
      break;
    case 'favorable_spread':
      header = '⚡ <b>OPORTUNIDAD DE SPREAD</b>';
      break;
    case 'account_limit':
      header = '⚠️ <b>LÍMITE DE CUENTA</b>';
      break;
    case 'account_warning':
      header = '🔔 <b>AVISO DE CUENTA</b>';
      break;
    case 'session_start':
      header = '▶️ <b>SESION INICIADA</b>';
      break;
    case 'session_end':
      header = '⏹️ <b>SESION FINALIZADA</b>';
      break;
  }

  const parts = [
    header,
    `<b>${event.title}</b>`,
    event.details,
  ];

  if (event.value !== undefined && event.value !== null && event.value !== '') {
    parts.push(`Valor: <code>${event.value}</code>`);
  }

  if (event.timestamp) {
    parts.push(`📅 <code>${event.timestamp}</code>`);
  }

  return parts.join('\n\n');
}

export async function sendTelegramAlert(
  config: TelegramConfig,
  event: RuleAlertEvent,
  fetchFn?: typeof fetch
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  // Validación de configuración básica (compatibilidad con v1)
  if (!config.enabled || !config.botToken || !config.chatId) {
    return { success: false, error: 'Telegram no configurado' };
  }

  // Validación de permisos de alerta por tipo de evento
  const enabled =
    event.type === 'risk_deny' && config.alertsOnRisk ||
    event.type === 'risk_pause' && config.alertsOnRisk ||
    event.type === 'favorable_spread' && config.alertsOnFavorable ||
    event.type === 'account_limit' && config.alertsOnAccountLimit ||
    event.type === 'account_warning' && config.alertsOnAccountLimit ||
    event.type === 'session_start' && config.alertsOnRisk ||
    event.type === 'session_end' && config.alertsOnRisk;

  if (!enabled) {
    return { success: false, error: 'Telegram no configurado para este tipo de alerta' };
  }

  const fetchImpl = fetchFn || globalThis.fetch;
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const text = formatTelegramMessage(event);

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: 'HTML',
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return {
        success: true,
        messageId: data.result?.message_id,
      };
    }

    try {
      const data = await res.json();
      if (data && data.description) {
        return {
          success: false,
          error: data.description,
        };
      }
    } catch {
      // JSON parsing failed for error response
    }

    return {
      success: false,
      error: `HTTP ${res.status}: ${res.statusText || 'Error'}`,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || String(err) || 'Error de red',
    };
  }
}
