import { describe, it, expect } from 'vitest';
import {
  renderTemplate,
  generateAdPreview,
  validateAd,
  createAdTemplate,
  cloneTemplate,
  filterTemplates,
  DEFAULT_AD_VARIABLES,
  BUILT_IN_TEMPLATES,
  type AdTemplate,
  type AdPreviewData,
} from './ad-templates';

describe('ad-templates', () => {
  describe('DEFAULT_AD_VARIABLES', () => {
    it('contiene variables requeridas', () => {
      const keys = DEFAULT_AD_VARIABLES.map((v) => v.key);
      expect(keys).toContain('precio');
      expect(keys).toContain('spread');
      expect(keys).toContain('limiteMin');
      expect(keys).toContain('limiteMax');
      expect(keys).toContain('banco');
      expect(keys).toContain('metodoPago');
      expect(keys).toContain('usuario');
      expect(keys).toContain('referencia');
    });

    it('variables requeridas tienen required: true', () => {
      const required = DEFAULT_AD_VARIABLES.filter((v) => v.required);
      expect(required.map((v) => v.key)).toContain('precio');
      expect(required.map((v) => v.key)).toContain('spread');
      expect(required.map((v) => v.key)).toContain('limiteMin');
      expect(required.map((v) => v.key)).toContain('limiteMax');
      expect(required.map((v) => v.key)).toContain('usuario');
    });
  });

  describe('BUILT_IN_TEMPLATES', () => {
    it('tiene 3 plantillas base', () => {
      expect(BUILT_IN_TEMPLATES).toHaveLength(3);
    });

    it('incluye compra estándar, venta estándar y compra high volume', () => {
      const names = BUILT_IN_TEMPLATES.map((t) => t.name);
      expect(names).toContain('Compra Estándar Pago Móvil');
      expect(names).toContain('Venta Estándar Pago Móvil');
      expect(names).toContain('Compra Rápida High Volume');
    });

    it('tipos correctos', () => {
      const types = BUILT_IN_TEMPLATES.map((t) => t.type);
      expect(types).toContain('BUY');
      expect(types).toContain('SELL');
    });
  });

  describe('renderTemplate', () => {
    it('sustituye variables correctamente', () => {
      const template = 'Precio: {{precio}} Bs, Spread: {{spread}}%';
      const data = { precio: 20.5, spread: 2.5 };

      const result = renderTemplate(template, data);

      expect(result).toBe('Precio: 20.5 Bs, Spread: 2.5%');
    });

    it('maneja múltiples ocurrencias de la misma variable', () => {
      const template = '{{banco}} - {{banco}} - {{banco}}';
      const data = { banco: 'Banesco' };

      const result = renderTemplate(template, data);

      expect(result).toBe('Banesco - Banesco - Banesco');
    });

    it('usa valores por defecto para variables faltantes', () => {
      const template = 'Banco: {{banco}}, Método: {{metodoPago}}';
      const data = { banco: 'Mercantil' }; // metodoPago faltante

      const result = renderTemplate(template, data);

      expect(result).toContain('Mercantil');
      expect(result).toContain('Pago Móvil'); // default de metodoPago
    });

    it('marca variables sin default como [key]', () => {
      const template = 'Referencia: {{referencia}}';
      const data = {}; // sin referencia

      const result = renderTemplate(template, data);

      expect(result).toBe('Referencia: [referencia]');
    });
  });

  describe('generateAdPreview', () => {
    const template: AdTemplate = {
      id: 'test-1',
      name: 'Test Template',
      type: 'BUY',
      status: 'active',
      version: 1,
      title: 'Compra USDT a {{precio}} Bs | {{banco}}',
      terms: 'Pago por {{metodoPago}} a {{banco}}. Límite {{limiteMin}}-{{limiteMax}}',
      autoReply: 'Hola, paga a {{banco}} por {{metodoPago}}',
      variables: DEFAULT_AD_VARIABLES,
      tags: ['test'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'test',
      metadata: {},
    };

    const data: Partial<AdPreviewData> = {
      precio: 21.5,
      spread: 3.0,
      limiteMin: 100,
      limiteMax: 10000,
      banco: 'Banesco',
      metodoPago: 'Pago Móvil',
      usuario: 'TestUser',
      referencia: 'REF123',
    };

    it('genera preview con title, terms y autoReply', () => {
      const preview = generateAdPreview(template, data);

      expect(preview.title).toContain('21.5');
      expect(preview.title).toContain('Banesco');
      expect(preview.terms).toContain('Pago Móvil');
      expect(preview.terms).toContain('Banesco');
      expect(preview.autoReply).toContain('Banesco');
    });
  });

  describe('validateAd', () => {
    it('aprueba anuncio válido', () => {
      const result = validateAd(
        'Compra USDT a 20 Bs',
        'Términos de prueba cortos',
        'Auto reply corto',
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rechaza título vacío', () => {
      const result = validateAd('', 'Términos válidos', 'Reply');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Título es obligatorio');
    });

    it('rechaza título muy largo', () => {
      const longTitle = 'A'.repeat(60);
      const result = validateAd(longTitle, 'Términos', 'Reply');

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('excede'))).toBe(true);
    });

    it('rechaza términos vacíos', () => {
      const result = validateAd('Título válido', '', 'Reply');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Términos son obligatorios');
    });

    it('advierte sobre auto-reply largo', () => {
      const longReply = 'A'.repeat(600);
      const result = validateAd('Título', 'Términos', longReply);

      expect(result.valid).toBe(true); // warning no invalida
      expect(result.warnings.some((w) => w.includes('excede'))).toBe(true);
    });

    it('advierte sobre palabras prohibidas', () => {
      const result = validateAd('Título', 'Pago por WhatsApp', 'Reply');

      expect(result.warnings.some((w) => w.includes('whatsapp'))).toBe(true);
    });

    it('advierte sobre variables sin resolver', () => {
      const result = validateAd('Precio {{precio}}', 'Términos {{banco}}', 'Reply {{usuario}}');

      expect(result.warnings.some((w) => w.includes('sin resolver'))).toBe(true);
    });

    it('respeta configuración de límites personalizados', () => {
      const result = validateAd('T'.repeat(30), 'Términos', 'Reply', { maxTitleLength: 20 });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('excede 20'))).toBe(true);
    });
  });

  describe('createAdTemplate', () => {
    it('crea plantilla con valores por defecto', () => {
      const template = createAdTemplate({
        name: 'Mi Plantilla',
        type: 'BUY',
        title: 'Título {{precio}}',
        terms: 'Términos',
        autoReply: 'Reply',
      });

      expect(template.id).toMatch(/^tpl_\d+_/);
      expect(template.name).toBe('Mi Plantilla');
      expect(template.type).toBe('BUY');
      expect(template.status).toBe('draft');
      expect(template.version).toBe(1);
      expect(template.variables).toEqual(DEFAULT_AD_VARIABLES);
      expect(template.createdAt).toBeDefined();
      expect(template.updatedAt).toBeDefined();
    });

    it('permite sobrescribir status y variables', () => {
      const template = createAdTemplate({
        name: 'Custom',
        type: 'SELL',
        status: 'active',
        title: 'T',
        terms: 'T',
        autoReply: 'R',
        variables: [
          { key: 'custom', label: 'Custom', type: 'string', required: false, description: 'Test' },
        ],
      });

      expect(template.status).toBe('active');
      expect(template.variables).toHaveLength(1);
      expect(template.variables[0].key).toBe('custom');
    });
  });

  describe('cloneTemplate', () => {
    it('clona incrementando versión y cambiando status a draft', () => {
      const original: AdTemplate = {
        id: 'tpl_original',
        name: 'Original',
        type: 'BUY',
        status: 'active',
        version: 3,
        title: 'T',
        terms: 'T',
        autoReply: 'R',
        variables: DEFAULT_AD_VARIABLES,
        tags: ['tag1'],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        createdBy: 'user',
        metadata: {},
      };

      const clone = cloneTemplate(original);

      expect(clone.id).not.toBe(original.id);
      expect(clone.name).toBe('Original (copia)');
      expect(clone.version).toBe(4);
      expect(clone.status).toBe('draft');
      expect(clone.createdAt).not.toBe(original.createdAt);
      expect(clone.updatedAt).not.toBe(original.updatedAt);
    });

    it('permite nombre personalizado en clon', () => {
      const original: AdTemplate = {
        id: 'tpl_1',
        name: 'Orig',
        type: 'BUY',
        status: 'active',
        version: 1,
        title: 'T',
        terms: 'T',
        autoReply: 'R',
        variables: DEFAULT_AD_VARIABLES,
        tags: [],
        createdAt: '',
        updatedAt: '',
        createdBy: '',
        metadata: {},
      };

      const clone = cloneTemplate(original, 'Mi Clon Personalizado');

      expect(clone.name).toBe('Mi Clon Personalizado');
    });
  });

  describe('filterTemplates', () => {
    const templates: AdTemplate[] = [
      {
        id: '1',
        name: 'Compra 1',
        type: 'BUY',
        status: 'active',
        version: 1,
        title: '',
        terms: '',
        autoReply: '',
        variables: [],
        tags: ['pago-movil'],
        createdAt: '',
        updatedAt: '',
        createdBy: '',
        metadata: {},
      },
      {
        id: '2',
        name: 'Venta 1',
        type: 'SELL',
        status: 'active',
        version: 1,
        title: '',
        terms: '',
        autoReply: '',
        variables: [],
        tags: ['pago-movil'],
        createdAt: '',
        updatedAt: '',
        createdBy: '',
        metadata: {},
      },
      {
        id: '3',
        name: 'Compra 2',
        type: 'BUY',
        status: 'draft',
        version: 1,
        title: '',
        terms: '',
        autoReply: '',
        variables: [],
        tags: ['high-volume'],
        createdAt: '',
        updatedAt: '',
        createdBy: '',
        metadata: {},
      },
      {
        id: '4',
        name: 'Venta 2',
        type: 'SELL',
        status: 'paused',
        version: 1,
        title: '',
        terms: '',
        autoReply: '',
        variables: [],
        tags: ['pago-movil', 'high-volume'],
        createdAt: '',
        updatedAt: '',
        createdBy: '',
        metadata: {},
      },
    ];

    it('filtra por tipo', () => {
      const buy = filterTemplates(templates, { type: 'BUY' });
      expect(buy).toHaveLength(2);
      expect(buy.every((t) => t.type === 'BUY')).toBe(true);
    });

    it('filtra por estado', () => {
      const active = filterTemplates(templates, { status: 'active' });
      expect(active).toHaveLength(2);
      expect(active.every((t) => t.status === 'active')).toBe(true);
    });

    it('filtra por tags (al menos uno)', () => {
      const highVol = filterTemplates(templates, { tags: ['high-volume'] });
      expect(highVol).toHaveLength(2);
      expect(highVol.every((t) => t.tags.includes('high-volume'))).toBe(true);
    });

    it('combina filtros', () => {
      const activeBuy = filterTemplates(templates, { type: 'BUY', status: 'active' });
      expect(activeBuy).toHaveLength(1);
      expect(activeBuy[0].name).toBe('Compra 1');
    });

    it('sin filtros retorna todos', () => {
      const all = filterTemplates(templates, {});
      expect(all).toHaveLength(4);
    });
  });
});
