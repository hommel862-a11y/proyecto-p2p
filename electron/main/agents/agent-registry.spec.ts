import { describe, it, expect } from 'vitest';
import { AgentRegistry, DEFAULT_BUILTIN_AGENTS } from './agent-registry';

describe('AgentRegistry (Finanzas 360 CFO, Quote Architect & 4 Pyme AI Agents)', () => {
  it('configures finance-cfo and quote-architect with f360_* institutional tools', () => {
    const registry = new AgentRegistry();

    const cfo = registry.getAgent('finance-cfo');
    expect(cfo).toBeDefined();
    expect(cfo?.tools).toEqual(
      expect.arrayContaining([
        'f360_get_treasury_summary',
        'f360_analyze_cashea_capacity',
        'f360_audit_overdue_and_runway',
        'gdrive_sync_db_backup',
      ]),
    );

    const quoter = registry.getAgent('quote-architect');
    expect(quoter).toBeDefined();
    expect(quoter?.tools).toEqual(
      expect.arrayContaining([
        'f360_generate_quote_estimate',
        'f360_check_pyme_drawers_and_stock',
      ]),
    );
  });

  it('registers all 4 built-in Pyme AI Agents with exact roles and f360_* tool bindings', () => {
    const registry = new AgentRegistry();

    const payroll = registry.getAgent('pyme-payroll-agent');
    expect(payroll).toBeDefined();
    expect(payroll?.name).toBe('Agente de Nómina y Gaveta 2');
    expect(payroll?.role).toBe('PYME_PAYROLL');
    expect(payroll?.tools).toEqual([
      'f360_check_pyme_drawers_and_stock',
      'f360_audit_overdue_and_runway',
    ]);
    expect(payroll?.isCustom).toBe(false);

    const providers = registry.getAgent('pyme-providers-agent');
    expect(providers).toBeDefined();
    expect(providers?.name).toBe('Agente de Proveedores CxP y Gaveta 1');
    expect(providers?.role).toBe('PYME_PROVIDERS');
    expect(providers?.tools).toEqual([
      'f360_check_pyme_drawers_and_stock',
      'f360_get_treasury_summary',
    ]);

    const stock = registry.getAgent('pyme-stock-agent');
    expect(stock).toBeDefined();
    expect(stock?.name).toBe('Agente de Inventario y Mercancía Fría');
    expect(stock?.role).toBe('PYME_STOCK');
    expect(stock?.tools).toEqual([
      'f360_check_pyme_drawers_and_stock',
      'f360_generate_quote_estimate',
    ]);

    const capex = registry.getAgent('pyme-capex-agent');
    expect(capex).toBeDefined();
    expect(capex?.name).toBe('Agente de Utilidad, CAPEX y Cashea Aliado');
    expect(capex?.role).toBe('PYME_CAPEX');
    expect(capex?.tools).toEqual([
      'f360_simulate_cashea_ally_margin',
      'f360_check_pyme_drawers_and_stock',
      'f360_get_treasury_summary',
    ]);

    expect(DEFAULT_BUILTIN_AGENTS.length).toBeGreaterThanOrEqual(12);
  });

  it('preserves built-in protection while allowing toggle and custom agent lifecycle', () => {
    const registry = new AgentRegistry();

    expect(registry.deleteCustomAgent('pyme-payroll-agent')).toBe(false);
    expect(registry.toggleAgent('pyme-payroll-agent', false)).toBe(true);
    expect(registry.getAgent('pyme-payroll-agent')?.enabled).toBe(false);

    const saved = registry.saveAgent({
      id: 'custom-f360-audit',
      name: 'Auditor Personalizado',
      role: 'CUSTOM_AUDITOR',
      avatar: '🧾',
      description: 'Auditor personalizado de prueba',
      tools: ['f360_get_treasury_summary'],
      systemPromptModifier: 'Audita saldos con precisión.',
      enabled: true,
    });
    expect(saved).toBe(true);
    expect(registry.deleteCustomAgent('custom-f360-audit')).toBe(true);
    expect(registry.getAgent('custom-f360-audit')).toBeUndefined();
  });
});
