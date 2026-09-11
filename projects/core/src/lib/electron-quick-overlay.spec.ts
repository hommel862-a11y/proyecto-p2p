import { describe, it, expect, vi } from 'vitest';
import {
  calculateSpread,
  validateQuickOverlayConfig,
  formatSpreadResult,
  createQuickOverlayController,
  DEFAULT_QUICK_OVERLAY_CONFIG,
  QUICK_OVERLAY_IPC_CHANNELS,
  type QuickOverlayConfig,
  type SpreadCalculationInput,
  type SpreadCalculationResult,
} from './electron-quick-overlay';

describe('electron-quick-overlay', () => {
  describe('calculateSpread', () => {
    it('calcula spread para compra (spread = fee rate)', () => {
      const input: SpreadCalculationInput = {
        price: 800,
        amountVes: 80000,
        amountUsdt: 100,
        feeRatePct: 0.5,
        isBuy: true,
      };
      
      const result = calculateSpread(input);
      
      // Spread = fee rate
      expect(result.spreadPct).toBe(0.5);
      // netPrice = price * (1 - fee/100)
      expect(result.netPrice).toBe(796);
      // feeVes = amountVes * feeRate/100
      expect(result.feeVes).toBe(400);
      expect(result.feeUsdt).toBe(0.5);
      // netAmount = amount - fee
      expect(result.netAmountVes).toBe(79600);
      expect(result.netAmountUsdt).toBe(99.5);
      // Compra: PnL negativo = costo de comisión
      expect(result.pnlVes).toBe(-400);
      // breakEven = price * (1 - fee/100)
      expect(result.breakEvenPrice).toBe(796);
      // Montos calculados incluidos en resultado
      expect(result.amountVes).toBe(80000);
      expect(result.amountUsdt).toBe(100);
    });

    it('calcula spread para venta', () => {
      const input: SpreadCalculationInput = {
        price: 800,
        amountVes: 80000,
        amountUsdt: 100,
        feeRatePct: 0.5,
        isBuy: false,
      };
      
      const result = calculateSpread(input);
      
      // Venta: PnL positivo = ganancia neta de comisión (simplificado)
      expect(result.pnlVes).toBe(400);
      expect(result.breakEvenPrice).toBe(796);
    });

    it('calcula monto faltante cuando solo se da VES', () => {
      const input: SpreadCalculationInput = {
        price: 800,
        amountVes: 40000,
        feeRatePct: 1,
        isBuy: true,
      };
      
      const result = calculateSpread(input);
      
      expect(result.amountUsdt).toBe(50); // 40000 / 800
      expect(result.netAmountVes).toBe(39600); // 40000 - 400 fee
    });

    it('calcula monto faltante cuando solo se da USDT', () => {
      const input: SpreadCalculationInput = {
        price: 800,
        amountUsdt: 50,
        feeRatePct: 1,
        isBuy: true,
      };
      
      const result = calculateSpread(input);
      
      expect(result.amountVes).toBe(40000); // 50 * 800
      expect(result.netAmountUsdt).toBe(49.5); // 50 - 0.5 fee
    });

    it('lanza error si precio es 0 o negativo', () => {
      expect(() => calculateSpread({
        price: 0,
        amountVes: 1000,
        feeRatePct: 0.5,
        isBuy: true,
      })).toThrow('Precio debe ser mayor a 0');
    });

    it('lanza error si no se proporciona monto', () => {
      expect(() => calculateSpread({
        price: 800,
        feeRatePct: 0.5,
        isBuy: true,
      })).toThrow('Debe proporcionar amountVes o amountUsdt mayor a 0');
    });
  });

  describe('validateQuickOverlayConfig', () => {
    it('acepta configuración válida', () => {
      const result = validateQuickOverlayConfig({
        shortcut: 'CommandOrControl+Shift+P',
        opacity: 0.9,
        size: { width: 320, height: 400 },
        position: { x: 100, y: 100 },
      });
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rechaza atajo inválido', () => {
      const result = validateQuickOverlayConfig({
        shortcut: 'InvalidShortcut',
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Atajo'))).toBe(true);
    });

    it('rechaza opacidad fuera de rango', () => {
      const result = validateQuickOverlayConfig({ opacity: 1.5 });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Opacidad debe estar entre 0.1 y 1');
      
      const result2 = validateQuickOverlayConfig({ opacity: 0.05 });
      expect(result2.valid).toBe(false);
    });

    it('rechaza tamaño fuera de rango', () => {
      const result = validateQuickOverlayConfig({ size: { width: 100, height: 400 } });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Ancho debe estar entre 200 y 800px');
    });

    it('rechaza posición negativa', () => {
      const result = validateQuickOverlayConfig({ position: { x: -10, y: 100 } });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Posición no puede ser negativa');
    });
  });

  describe('formatSpreadResult', () => {
    it('formatea resultado para display con separador decimal punto', () => {
      const result: SpreadCalculationResult = {
        spreadPct: 0.5,
        netPrice: 796,
        netAmountVes: 79600,
        netAmountUsdt: 99.5,
        feeVes: 400,
        feeUsdt: 0.5,
        pnlVes: -400,
        breakEvenPrice: 796,
        amountVes: 80000,
        amountUsdt: 100,
      };
      
      const formatted = formatSpreadResult(result);
      
      expect(formatted.spread).toBe('+0.50%');
      expect(formatted.netPrice).toContain('796.00');
      expect(formatted.netAmountVes).toContain('79,600.00'); // en-US uses comma for thousands
      expect(formatted.pnlVes).toBe('-400.00 Bs');
      expect(formatted.breakEven).toContain('796.00');
    });

    it('maneja PnL positivo', () => {
      const result: SpreadCalculationResult = {
        spreadPct: 0.5,
        netPrice: 796,
        netAmountVes: 80400,
        netAmountUsdt: 100.5,
        feeVes: 400,
        feeUsdt: 0.5,
        pnlVes: 400,
        breakEvenPrice: 796,
        amountVes: 80000,
        amountUsdt: 100,
      };
      
      const formatted = formatSpreadResult(result);
      expect(formatted.pnlVes).toBe('+400.00 Bs');
    });
  });

  describe('createQuickOverlayController', () => {
    it('crea controlador con configuración por defecto', () => {
      const controller = createQuickOverlayController();
      
      expect(controller.config).toEqual(DEFAULT_QUICK_OVERLAY_CONFIG);
      expect(controller.visible).toBe(false);
      expect(controller.position).toEqual({ x: 100, y: 100 });
    });

    it('show/hide/toggle actualizan visibilidad', () => {
      const controller = createQuickOverlayController();
      
      controller.show();
      expect(controller.visible).toBe(true);
      
      controller.hide();
      expect(controller.visible).toBe(false);
      
      controller.toggle();
      expect(controller.visible).toBe(true);
      
      controller.toggle();
      expect(controller.visible).toBe(false);
    });

    it('calculate delega a calculateSpread', () => {
      const controller = createQuickOverlayController();
      
      const result = controller.calculate({
        price: 800,
        amountVes: 80000,
        feeRatePct: 0.5,
        isBuy: true,
      });
      
      expect(result.spreadPct).toBe(0.5);
      expect(result.netPrice).toBe(796);
    });

    it('setPosition actualiza posición y config', () => {
      const controller = createQuickOverlayController();
      
      controller.setPosition(200, 300);
      
      expect(controller.position).toEqual({ x: 200, y: 300 });
      expect(controller.config.position).toEqual({ x: 200, y: 300 });
    });

    it('updateConfig valida y actualiza', () => {
      const controller = createQuickOverlayController();
      
      controller.updateConfig({ opacity: 0.8, autoHide: true });
      
      expect(controller.config.opacity).toBe(0.8);
      expect(controller.config.autoHide).toBe(true);
    });

    it('updateConfig lanza error si configuración inválida', () => {
      const controller = createQuickOverlayController();
      
      expect(() => controller.updateConfig({ opacity: 2 })).toThrow();
    });

    it('on/off manejan eventos', () => {
      const controller = createQuickOverlayController();
      const callback = vi.fn();
      
      const unsubscribe = controller.on('show', callback);
      controller.show();
      expect(callback).toHaveBeenCalled();
      
      unsubscribe();
      controller.hide();
      controller.show();
      expect(callback).toHaveBeenCalledTimes(1); // No llamado después de unsubscribe
    });

    it('ipc expone canales correctos', () => {
      const controller = createQuickOverlayController();
      
      expect(QUICK_OVERLAY_IPC_CHANNELS.CALCULATE).toBe('quick-overlay:calculate');
      expect(QUICK_OVERLAY_IPC_CHANNELS.RESULT).toBe('quick-overlay:result');
      expect(QUICK_OVERLAY_IPC_CHANNELS.SHOW).toBe('quick-overlay:show');
    });
  });

  describe('DEFAULT_QUICK_OVERLAY_CONFIG', () => {
    it('tiene valores por defecto sensatos', () => {
      expect(DEFAULT_QUICK_OVERLAY_CONFIG.enabled).toBe(true);
      expect(DEFAULT_QUICK_OVERLAY_CONFIG.shortcut).toBe('CommandOrControl+Shift+P');
      expect(DEFAULT_QUICK_OVERLAY_CONFIG.opacity).toBe(0.95);
      expect(DEFAULT_QUICK_OVERLAY_CONFIG.alwaysOnTop).toBe(true);
      expect(DEFAULT_QUICK_OVERLAY_CONFIG.size.width).toBe(320);
    });
  });

  describe('QUICK_OVERLAY_IPC_CHANNELS', () => {
    it('define todos los canales necesarios', () => {
      expect(QUICK_OVERLAY_IPC_CHANNELS.SHOW).toBe('quick-overlay:show');
      expect(QUICK_OVERLAY_IPC_CHANNELS.HIDE).toBe('quick-overlay:hide');
      expect(QUICK_OVERLAY_IPC_CHANNELS.TOGGLE).toBe('quick-overlay:toggle');
      expect(QUICK_OVERLAY_IPC_CHANNELS.CALCULATE).toBe('quick-overlay:calculate');
      expect(QUICK_OVERLAY_IPC_CHANNELS.RESULT).toBe('quick-overlay:result');
      expect(QUICK_OVERLAY_IPC_CHANNELS.POSITION_CHANGED).toBe('quick-overlay:position-changed');
      expect(QUICK_OVERLAY_IPC_CHANNELS.CONFIG_CHANGED).toBe('quick-overlay:config-changed');
      expect(QUICK_OVERLAY_IPC_CHANNELS.GET_CONFIG).toBe('quick-overlay:get-config');
      expect(QUICK_OVERLAY_IPC_CHANNELS.SET_CONFIG).toBe('quick-overlay:set-config');
    });
  });

  describe('validateQuickOverlayConfig', () => {
    it('acepta configuración válida', () => {
      const result = validateQuickOverlayConfig({
        shortcut: 'CommandOrControl+Shift+P',
        opacity: 0.9,
        size: { width: 320, height: 400 },
        position: { x: 100, y: 100 },
      });
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rechaza atajo inválido', () => {
      const result = validateQuickOverlayConfig({
        shortcut: 'InvalidShortcut',
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Atajo'))).toBe(true);
    });

    it('rechaza opacidad fuera de rango', () => {
      const result = validateQuickOverlayConfig({ opacity: 1.5 });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Opacidad debe estar entre 0.1 y 1');
      
      const result2 = validateQuickOverlayConfig({ opacity: 0.05 });
      expect(result2.valid).toBe(false);
    });

    it('rechaza tamaño fuera de rango', () => {
      const result = validateQuickOverlayConfig({ size: { width: 100, height: 400 } });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Ancho debe estar entre 200 y 800px');
    });

    it('rechaza posición negativa', () => {
      const result = validateQuickOverlayConfig({ position: { x: -10, y: 100 } });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Posición no puede ser negativa');
    });
  });
});