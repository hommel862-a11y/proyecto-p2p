/**
 * Electron Quick-Overlay - Atajos Globales y Widget Flotante
 * Proyecto: P2P Decisor - Nivel Avanzado
 * 
 * Funcionalidad:
 - Atajo global Ctrl+Shift+P para abrir widget de cálculo de spread
 - Widget flotante transparente siempre visible sobre otras ventanas
 - Cálculo instantáneo de spread, PnL, comisiones sin minimizar pantalla principal
 - Comunicación IPC con proceso principal de Electron
 - Persistencia de posición y configuración del widget
 */

export interface QuickOverlayConfig {
  enabled: boolean;
  shortcut: string;              // e.g., 'CommandOrControl+Shift+P'
  position: { x: number; y: number };
  size: { width: number; height: number };
  opacity: number;               // 0.1 - 1.0
  alwaysOnTop: boolean;
  theme: 'light' | 'dark' | 'system';
  autoHide: boolean;             // Ocultar al perder foco
  showOnStartup: boolean;
}

export interface SpreadCalculationInput {
  price: number;                 // Precio actual VES/USDT
  amountVes?: number;            // Monto en VES
  amountUsdt?: number;           // Monto en USDT
  feeRatePct: number;            // Tasa de comisión %
  isBuy: boolean;                // true = compra, false = venta
}

export interface SpreadCalculationResult {
  spreadPct: number;             // Spread %
  netPrice: number;              // Precio neto tras comisiones
  netAmountVes: number;          // Monto neto VES
  netAmountUsdt: number;         // Monto neto USDT
  feeVes: number;                // Comisión en VES
  feeUsdt: number;               // Comisión en USDT
  pnlVes: number;                // PnL estimado en VES
  breakEvenPrice: number;        // Precio de equilibrio
  amountVes: number;             // Monto VES calculado
  amountUsdt: number;            // Monto USDT calculado
}

export type QuickOverlayEvent = 
  | { type: 'SHOW'; payload?: { x?: number; y?: number } }
  | { type: 'HIDE' }
  | { type: 'TOGGLE' }
  | { type: 'CALCULATE'; payload: SpreadCalculationInput }
  | { type: 'RESULT'; payload: SpreadCalculationResult }
  | { type: 'POSITION_CHANGED'; payload: { x: number; y: number } }
  | { type: 'CONFIG_CHANGED'; payload: Partial<QuickOverlayConfig> }
  | { type: 'READY' };

/**
 * Calcula spread, PnL y comisiones para operación P2P
 */
export function calculateSpread(input: SpreadCalculationInput): SpreadCalculationResult {
  const { price, amountVes, amountUsdt, feeRatePct, isBuy } = input;
  
  // Validar que tenemos al menos precio y uno de los montos
  if (!price || price <= 0) {
    throw new Error('Precio debe ser mayor a 0');
  }
  
  // Calcular monto faltante
  const calcAmountVes = amountVes ?? (amountUsdt !== undefined ? amountUsdt * price : 0);
  const calcAmountUsdt = amountUsdt ?? (amountVes !== undefined ? amountVes / price : 0);
  
  // Validar que tenemos al menos un monto
  if (!calcAmountVes || calcAmountVes <= 0) {
    throw new Error('Debe proporcionar amountVes o amountUsdt mayor a 0');
  }
  
  // Comisiones
  const feeVes = calcAmountVes * (feeRatePct / 100);
  const feeUsdt = feeVes / price;
  
  // Montos netos
  const netAmountVes = calcAmountVes - feeVes;
  const netAmountUsdt = (calcAmountUsdt || calcAmountVes / price) - feeUsdt;
  
  // Precio neto efectivo
  const netPrice = netAmountVes / (calcAmountUsdt || calcAmountVes / price);
  
  // Spread % = tasa de comisión (el spread real es la comisión)
  const spreadPct = feeRatePct;
  
  // PnL: para compra = -fee (costo), para venta = +fee (ingreso neto - costo base)
  // En compra: pagas fee extra, tu costo neto es mayor
  // En venta: recibes menos por las comisiones
  const pnlVes = isBuy ? -feeVes : feeVes;
  
  // Break-even: precio donde PnL = 0 (sin considerar spread de mercado)
  const breakEvenPrice = price * (1 - feeRatePct / 100);
  
  return {
    spreadPct: Math.round(spreadPct * 100) / 100,
    netPrice: Math.round(netPrice * 100) / 100,
    netAmountVes: Math.round(netAmountVes * 100) / 100,
    netAmountUsdt: Math.round(netAmountUsdt * 10000) / 10000,
    feeVes: Math.round(feeVes * 100) / 100,
    feeUsdt: Math.round(feeUsdt * 10000) / 10000,
    pnlVes: Math.round(pnlVes * 100) / 100,
    breakEvenPrice: Math.round(breakEvenPrice * 100) / 100,
    amountVes: Math.round(calcAmountVes * 100) / 100,
    amountUsdt: Math.round(calcAmountUsdt * 10000) / 10000,
  };
}

/**
 * Configuración por defecto del overlay
 */
export const DEFAULT_QUICK_OVERLAY_CONFIG: QuickOverlayConfig = {
  enabled: true,
  shortcut: 'CommandOrControl+Shift+P',
  position: { x: 100, y: 100 },
  size: { width: 320, height: 400 },
  opacity: 0.95,
  alwaysOnTop: true,
  theme: 'system',
  autoHide: false,
  showOnStartup: false,
};

/**
 * Guarda configuración en localStorage (renderer process)
 */
export function saveQuickOverlayConfig(config: QuickOverlayConfig): void {
  try {
    localStorage.setItem('quick-overlay-config', JSON.stringify(config));
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Carga configuración desde localStorage
 */
export function loadQuickOverlayConfig(): QuickOverlayConfig {
  try {
    const stored = localStorage.getItem('quick-overlay-config');
    if (stored) {
      return { ...DEFAULT_QUICK_OVERLAY_CONFIG, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_QUICK_OVERLAY_CONFIG;
}

/**
 * IPC Channel names para comunicación main/renderer
 */
export const QUICK_OVERLAY_IPC_CHANNELS = {
  SHOW: 'quick-overlay:show',
  HIDE: 'quick-overlay:hide',
  TOGGLE: 'quick-overlay:toggle',
  CALCULATE: 'quick-overlay:calculate',
  RESULT: 'quick-overlay:result',
  POSITION_CHANGED: 'quick-overlay:position-changed',
  CONFIG_CHANGED: 'quick-overlay:config-changed',
  GET_CONFIG: 'quick-overlay:get-config',
  SET_CONFIG: 'quick-overlay:set-config',
} as const;

/**
 * Type-safe IPC message types
 */
export type QuickOverlayIpcMessage = 
  | { channel: typeof QUICK_OVERLAY_IPC_CHANNELS.SHOW; payload?: { x?: number; y?: number } }
  | { channel: typeof QUICK_OVERLAY_IPC_CHANNELS.HIDE }
  | { channel: typeof QUICK_OVERLAY_IPC_CHANNELS.TOGGLE }
  | { channel: typeof QUICK_OVERLAY_IPC_CHANNELS.CALCULATE; payload: SpreadCalculationInput }
  | { channel: typeof QUICK_OVERLAY_IPC_CHANNELS.RESULT; payload: SpreadCalculationResult }
  | { channel: typeof QUICK_OVERLAY_IPC_CHANNELS.POSITION_CHANGED; payload: { x: number; y: number } }
  | { channel: typeof QUICK_OVERLAY_IPC_CHANNELS.CONFIG_CHANGED; payload: Partial<QuickOverlayConfig> }
  | { channel: typeof QUICK_OVERLAY_IPC_CHANNELS.GET_CONFIG }
  | { channel: typeof QUICK_OVERLAY_IPC_CHANNELS.SET_CONFIG; payload: QuickOverlayConfig };

/**
 * Valida configuración del overlay
 */
export function validateQuickOverlayConfig(config: Partial<QuickOverlayConfig>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (config.shortcut && !isValidShortcut(config.shortcut)) {
    errors.push('Atajo inválido. Formato: "CommandOrControl+Shift+P"');
  }
  
  if (config.opacity !== undefined && (config.opacity < 0.1 || config.opacity > 1)) {
    errors.push('Opacidad debe estar entre 0.1 y 1');
  }
  
  if (config.size) {
    if (config.size.width < 200 || config.size.width > 800) {
      errors.push('Ancho debe estar entre 200 y 800px');
    }
    if (config.size.height < 150 || config.size.height > 600) {
      errors.push('Alto debe estar entre 150 y 600px');
    }
  }
  
  if (config.position) {
    if (config.position.x < 0 || config.position.y < 0) {
      errors.push('Posición no puede ser negativa');
    }
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Valida formato de atajo de teclado Electron
 */
function isValidShortcut(shortcut: string): boolean {
  // Formato Electron: "CommandOrControl+Shift+P", "Alt+F4", etc.
  const parts = shortcut.split('+');
  if (parts.length < 2) return false;
  
  const validModifiers = ['Command', 'Control', 'CommandOrControl', 'Alt', 'Shift', 'Super', 'Meta'];
  const validKeys = [
    'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
    '0','1','2','3','4','5','6','7','8','9',
    'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
    'Space','Tab','Enter','Escape','Backspace','Delete','Insert','Home','End','PageUp','PageDown',
    'Up','Down','Left','Right',
  ];
  
  const modifiers = parts.slice(0, -1);
  const key = parts[parts.length - 1];
  
  return modifiers.every(m => validModifiers.includes(m)) && validKeys.includes(key);
}

/**
 * Formatea resultado para display en widget
 */
export function formatSpreadResult(result: SpreadCalculationResult): {
  spread: string;
  netPrice: string;
  netAmountVes: string;
  netAmountUsdt: string;
  feeVes: string;
  feeUsdt: string;
  pnlVes: string;
  breakEven: string;
} {
  // Use en-US locale for consistent decimal separator (.)
  const fmt = (val: number, decimals: number) => val.toLocaleString('en-US', { 
    minimumFractionDigits: decimals, 
    maximumFractionDigits: decimals 
  });
  
  return {
    spread: `${result.spreadPct >= 0 ? '+' : ''}${result.spreadPct.toFixed(2)}%`,
    netPrice: `${fmt(result.netPrice, 2)} Bs/USDT`,
    netAmountVes: `${fmt(result.netAmountVes, 2)} Bs`,
    netAmountUsdt: `${fmt(result.netAmountUsdt, 4)} USDT`,
    feeVes: `${fmt(result.feeVes, 2)} Bs`,
    feeUsdt: `${fmt(result.feeUsdt, 4)} USDT`,
    pnlVes: `${result.pnlVes >= 0 ? '+' : ''}${fmt(result.pnlVes, 2)} Bs`,
    breakEven: `${fmt(result.breakEvenPrice, 2)} Bs/USDT`,
  };
}

/**
 * Hook personalizado para uso en componentes React/Vue/Angular (renderer)
 * Proporciona API reactiva para el widget
 */
export function createQuickOverlayController() {
  let config = loadQuickOverlayConfig();
  let isVisible = config.showOnStartup;
  let position = config.position;
  
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  
  function emit(event: string, payload?: unknown) {
    listeners.get(event)?.forEach(cb => cb(payload));
  }
  
  return {
    // Estado
    get config() { return config; },
    get visible() { return isVisible; },
    get position() { return position; },
    
    // Acciones
    show: (x?: number, y?: number) => {
      isVisible = true;
      if (x !== undefined && y !== undefined) position = { x, y };
      emit('show', { x: position.x, y: position.y });
    },
    
    hide: () => {
      isVisible = false;
      emit('hide');
    },
    
    toggle: () => {
      isVisible ? isVisible = false : isVisible = true;
      emit(isVisible ? 'show' : 'hide');
    },
    
    calculate: (input: SpreadCalculationInput): SpreadCalculationResult => {
      const result = calculateSpread(input);
      emit('result', result);
      return result;
    },
    
    setPosition: (x: number, y: number) => {
      position = { x, y };
      config = { ...config, position };
      saveQuickOverlayConfig(config);
      emit('position_changed', position);
    },
    
    updateConfig: (newConfig: Partial<QuickOverlayConfig>) => {
      const validation = validateQuickOverlayConfig(newConfig);
      if (!validation.valid) throw new Error(validation.errors.join(', '));
      
      config = { ...config, ...newConfig };
      saveQuickOverlayConfig(config);
      emit('config_changed', config);
    },
    
    // Eventos
    on: (event: string, callback: (payload: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(callback);
      return () => listeners.get(event)?.delete(callback);
    },
    
    off: (event: string, callback: (payload: unknown) => void) => {
      listeners.get(event)?.delete(callback);
    },
    
    // IPC helpers (para usar con electron.ipcRenderer)
    ipc: {
      sendCalculate: (input: SpreadCalculationInput) => {
        // window.electron.ipcRenderer.invoke(QUICK_OVERLAY_IPC_CHANNELS.CALCULATE, input)
      },
      onResult: (callback: (result: SpreadCalculationResult) => void) => {
        // window.electron.ipcRenderer.on(QUICK_OVERLAY_IPC_CHANNELS.RESULT, callback)
      },
    },
  };
}