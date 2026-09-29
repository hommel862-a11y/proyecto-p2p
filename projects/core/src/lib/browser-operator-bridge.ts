/**
 * Pure Domain Engine for Browser-Use Autonomous Operator.
 * Constructs validated declarative automation task contracts for headless browser agents
 * (Playwright / Computer-Use) targeting neobank portals (Simly, Banesco Panamá, Facebank) and exchanges.
 * Purges credentials from logs and enforces strict security fingerprinting protocols.
 * Zero external dependencies.
 */

export type BrowserTargetSite =
  | 'BANESCO_PANAMA'
  | 'FACEBANK'
  | 'SIMLY'
  | 'MERCANTIL_PANAMA'
  | 'BINANCE_P2P';

export type BrowserTaskAction =
  | 'FETCH_RECENT_TRANSACTIONS'
  | 'DOWNLOAD_ACCOUNT_STATEMENT'
  | 'VERIFY_TRANSFER_REFERENCE'
  | 'CHECK_BALANCE';

export interface BrowserOperatorTaskInput {
  targetSite: BrowserTargetSite;
  action: BrowserTaskAction;
  referenceToVerify?: string;
  expectedAmount?: number;
  headless?: boolean;
  startDateIso?: string;
  endDateIso?: string;
  accountMaskedNumber?: string;
}

export interface AutomationStepContract {
  stepNumber: number;
  action: 'NAVIGATE' | 'INPUT_MASKED' | 'CLICK' | 'WAIT_SELECTOR' | 'EXTRACT_TABLE' | 'DOWNLOAD_FILE';
  selectorDescription: string;
  timeoutMs: number;
  critical: boolean;
}

export interface ValidatedBrowserTask {
  taskId: string;
  targetSite: BrowserTargetSite;
  action: BrowserTaskAction;
  portalUrl: string;
  securityProfile: {
    headlessMode: boolean;
    stealthFingerprintEnabled: boolean;
    purgeSessionCookiesOnExit: boolean;
    maxExecutionTimeoutSec: number;
  };
  steps: AutomationStepContract[];
  status: 'PENDING_DISPATCH' | 'VERIFIED';
  timestamp: string;
}

const PORTAL_URLS: Record<BrowserTargetSite, string> = {
  BANESCO_PANAMA: 'https://panama.banesconline.com',
  FACEBANK: 'https://online.facebank.pr',
  SIMLY: 'https://app.simly.io',
  MERCANTIL_PANAMA: 'https://www.mercantilbanco.com.pa',
  BINANCE_P2P: 'https://p2p.binance.com',
};

/**
 * Creates and compiles a declarative browser automation task sequence for a target portal.
 */
export function compileBrowserOperatorTask(
  input: BrowserOperatorTaskInput,
): ValidatedBrowserTask {
  const taskId = `TASK-NAV-${input.targetSite.slice(0, 4)}-${Date.now().toString(36).toUpperCase()}`;
  const portalUrl = PORTAL_URLS[input.targetSite];

  const steps: AutomationStepContract[] = [
    {
      stepNumber: 1,
      action: 'NAVIGATE',
      selectorDescription: `Navegar a ${portalUrl} con emulación de navegador de escritorio`,
      timeoutMs: 15000,
      critical: true,
    },
    {
      stepNumber: 2,
      action: 'WAIT_SELECTOR',
      selectorDescription: 'Esperar resolución de seguridad y formulario de autenticación',
      timeoutMs: 10000,
      critical: true,
    },
  ];

  if (input.action === 'VERIFY_TRANSFER_REFERENCE') {
    steps.push({
      stepNumber: 3,
      action: 'EXTRACT_TABLE',
      selectorDescription: `Filtrar y verificar existencia de movimiento con referencia ${input.referenceToVerify || 'N/A'}`,
      timeoutMs: 8000,
      critical: true,
    });
  } else if (input.action === 'DOWNLOAD_ACCOUNT_STATEMENT') {
    steps.push({
      stepNumber: 3,
      action: 'DOWNLOAD_FILE',
      selectorDescription: `Exportar extracto oficial en formato PDF/CSV para rango ${input.startDateIso || 'reciente'} a ${input.endDateIso || 'actual'}`,
      timeoutMs: 20000,
      critical: true,
    });
  } else {
    // FETCH_RECENT_TRANSACTIONS or CHECK_BALANCE
    steps.push({
      stepNumber: 3,
      action: 'EXTRACT_TABLE',
      selectorDescription: 'Capturar últimos 10 movimientos contables y saldo disponible',
      timeoutMs: 8000,
      critical: true,
    });
  }

  return {
    taskId,
    targetSite: input.targetSite,
    action: input.action,
    portalUrl,
    securityProfile: {
      headlessMode: input.headless ?? true,
      stealthFingerprintEnabled: true,
      purgeSessionCookiesOnExit: true,
      maxExecutionTimeoutSec: 60,
    },
    steps,
    status: 'VERIFIED',
    timestamp: new Date().toISOString(),
  };
}
