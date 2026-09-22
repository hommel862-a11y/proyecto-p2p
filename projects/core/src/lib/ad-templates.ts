export type AdType = 'BUY' | 'SELL';
export type AdStatus = 'draft' | 'active' | 'paused' | 'archived';

export interface AdTemplateVariable {
  key: string;
  label: string;
  type: 'number' | 'string' | 'currency' | 'percentage' | 'bank';
  required: boolean;
  defaultValue?: string | number;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    maxLength?: number;
  };
  description: string;
}

export interface AdTemplate {
  id: string;
  name: string;
  type: AdType;
  status: AdStatus;
  version: number;
  title: string;
  terms: string;
  autoReply: string;
  variables: AdTemplateVariable[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  metadata: {
    minSpread?: number;
    maxSpread?: number;
    preferredBanks?: string[];
    paymentMethods?: string[];
    timeWindow?: { start: string; end: string };
  };
}

export interface AdPreviewData {
  precio: number;
  spread: number;
  limiteMin: number;
  limiteMax: number;
  banco: string;
  metodoPago: string;
  usuario: string;
  referencia: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export const DEFAULT_AD_VARIABLES: AdTemplateVariable[] = [
  {
    key: 'precio',
    label: 'Precio VES/USDT',
    type: 'currency',
    required: true,
    description: 'Precio actual del anuncio',
  },
  {
    key: 'spread',
    label: 'Spread %',
    type: 'percentage',
    required: true,
    description: 'Porcentaje de ganancia sobre precio de mercado',
  },
  {
    key: 'limiteMin',
    label: 'Límite mínimo',
    type: 'currency',
    required: true,
    defaultValue: 100,
    description: 'Monto mínimo de transacción',
  },
  {
    key: 'limiteMax',
    label: 'Límite máximo',
    type: 'currency',
    required: true,
    defaultValue: 50000,
    description: 'Monto máximo de transacción',
  },
  {
    key: 'banco',
    label: 'Banco preferido',
    type: 'bank',
    required: false,
    defaultValue: 'Banesco',
    description: 'Banco para recibir/enviar pagos',
  },
  {
    key: 'metodoPago',
    label: 'Método de pago',
    type: 'string',
    required: false,
    defaultValue: 'Pago Móvil',
    description: 'Pago Móvil, Transferencia, etc.',
  },
  {
    key: 'usuario',
    label: 'Nombre de usuario',
    type: 'string',
    required: true,
    description: 'Tu nombre en Binance',
  },
  {
    key: 'referencia',
    label: 'Referencia',
    type: 'string',
    required: false,
    description: 'Referencia de pago (opcional)',
  },
];

export const BUILT_IN_TEMPLATES: Omit<
  AdTemplate,
  'id' | 'version' | 'createdAt' | 'updatedAt' | 'createdBy'
>[] = [
  {
    name: 'Compra Estándar Pago Móvil',
    type: 'BUY',
    status: 'active',
    title: '⚡ Compra USDT | {{precio}} Bs | {{spread}}% | {{banco}}',
    terms:
      '📋 TÉRMINOS Y CONDICIONES:\n\n✅ Pago por {{metodoPago}} a {{banco}}\n💰 Límite: {{limiteMin}} - {{limiteMax}} Bs\n⏱️ Tiempo de pago: 15 minutos\n📱 Referencia: {{referencia}}\n\n⚠️ REGLAS:\n• Solo pagos desde TU cuenta bancaria\n• No acepto pagos de terceros (anti-triangulación)\n• Comprobante obligatorio al pagar\n• Liberación inmediata al verificar\n\n🤝 Gracias por operar con {{usuario}}',
    autoReply:
      '¡Hola! Gracias por elegir mi anuncio. Por favor realiza el pago por {{metodoPago}} a {{banco}} y envía el comprobante. Libero USDT al verificar ✅',
    variables: DEFAULT_AD_VARIABLES,
    tags: ['compra', 'pago-movil', 'estandar'],
    metadata: {
      minSpread: 0.5,
      maxSpread: 5,
      preferredBanks: ['Banesco', 'Mercantil', 'Bancamiga', 'Provincial', 'BDV'],
      paymentMethods: ['Pago Móvil', 'Transferencia'],
      timeWindow: { start: '07:00', end: '22:00' },
    },
  },
  {
    name: 'Venta Estándar Pago Móvil',
    type: 'SELL',
    status: 'active',
    title: '💰 Venta USDT | {{precio}} Bs | {{spread}}% | {{banco}}',
    terms:
      '📋 TÉRMINOS Y CONDICIONES:\n\n✅ Recibes USDT tras pago confirmado\n💰 Límite: {{limiteMin}} - {{limiteMax}} Bs\n⏱️ Tiempo de pago: 15 minutos\n🏦 Pago a: {{banco}} ({{metodoPago}})\n\n⚠️ REGLAS:\n• Pago desde TU cuenta (anti-triangulación)\n• Comprobante = liberación inmediata\n• No cancelar orden sin avisar\n• Datos bancarios en chat privado\n\n🤝 Operación segura con {{usuario}}',
    autoReply:
      '¡Hola! Para comprar mis USDT, transfiere {{limiteMin}}-{{limiteMax}} Bs por {{metodoPago}} a {{banco}}. Envía comprobante y libero al instante 🚀',
    variables: DEFAULT_AD_VARIABLES,
    tags: ['venta', 'pago-movil', 'estandar'],
    metadata: {
      minSpread: 0.5,
      maxSpread: 5,
      preferredBanks: ['Banesco', 'Mercantil', 'Bancamiga', 'Provincial', 'BDV'],
      paymentMethods: ['Pago Móvil', 'Transferencia'],
      timeWindow: { start: '07:00', end: '22:00' },
    },
  },
  {
    name: 'Compra Rápida High Volume',
    type: 'BUY',
    status: 'draft',
    title: '🚀 COMPRA RÁPIDA USDT | {{precio}} Bs | {{banco}} | 24/7',
    terms:
      '⚡ COMPRA EXPRESS - ALTO VOLUMEN\n\n💰 Límites: {{limiteMin}} - {{limiteMax}} Bs\n🏦 {{banco}} | {{metodoPago}}\n⏱️ Liberación < 5 min tras comprobante\n\n📋 REGLAS:\n✅ Pago propio únicamente\n✅ Comprobante obligatorio\n✅ Sin terceros (verificación cédula)\n❌ Sin cancelaciones unilaterales\n\n🤖 {{usuario}} - Operador verificado',
    autoReply:
      '⚡ COMPRA RÁPIDA: Paga por {{metodoPago}} a {{banco}}, envía comprobante, libero en < 5 min. Límite {{limiteMax}} Bs.',
    variables: DEFAULT_AD_VARIABLES.filter((v) => v.key !== 'spread'),
    tags: ['compra', 'high-volume', 'express', '24/7'],
    metadata: {
      minSpread: 0.2,
      maxSpread: 2,
      preferredBanks: ['Banesco', 'Mercantil', 'Bancamiga', 'Provincial', 'BDV', 'Banplus'],
      paymentMethods: ['Pago Móvil'],
      timeWindow: { start: '00:00', end: '23:59' },
    },
  },
];

export function renderTemplate(template: string, data: Partial<AdPreviewData>): string {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(placeholder, String(value));
  }
  const missingVars = result.match(/\{\{(\w+)\}\}/g);
  if (missingVars) {
    for (const mv of missingVars) {
      const key = mv.slice(2, -2);
      const defVar = DEFAULT_AD_VARIABLES.find((v) => v.key === key);
      if (defVar?.defaultValue !== undefined) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(defVar.defaultValue));
      } else {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), `[${key}]`);
      }
    }
  }
  return result;
}

export function generateAdPreview(
  template: AdTemplate,
  data: Partial<AdPreviewData>,
): { title: string; terms: string; autoReply: string } {
  return {
    title: renderTemplate(template.title, data),
    terms: renderTemplate(template.terms, data),
    autoReply: renderTemplate(template.autoReply, data),
  };
}

export function validateAd(
  title: string,
  terms: string,
  autoReply: string,
  config?: { maxTitleLength?: number; maxTermsLength?: number; maxAutoReplyLength?: number },
): ValidationResult {
  const maxTitle = config?.maxTitleLength || 50;
  const maxTerms = config?.maxTermsLength || 2000;
  const maxAutoReply = config?.maxAutoReplyLength || 500;
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!title.trim()) {
    errors.push('Título es obligatorio');
  } else if (title.length > maxTitle) {
    errors.push(`Título excede ${maxTitle} caracteres (actual: ${title.length})`);
  }
  if (!terms.trim()) {
    errors.push('Términos son obligatorios');
  } else if (terms.length > maxTerms) {
    errors.push(`Términos exceden ${maxTerms} caracteres (actual: ${terms.length})`);
  }
  if (autoReply.length > maxAutoReply) {
    warnings.push(`Auto-reply excede ${maxAutoReply} caracteres (actual: ${autoReply.length})`);
  }
  const forbiddenWords = ['whatsapp', 'telegram', 'email', 'correo', 'fuera de binance', 'externo'];
  const allText = (title + ' ' + terms + ' ' + autoReply).toLowerCase();
  for (const word of forbiddenWords) {
    if (allText.includes(word)) {
      warnings.push(`Posible violación TOS: detectada palabra "${word}"`);
    }
  }
  const unresolved = (title + terms + autoReply).match(/\{\{(\w+)\}\}/g);
  if (unresolved) {
    warnings.push(`Variables sin resolver: ${unresolved.join(', ')}`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function createAdTemplate(
  data: Partial<AdTemplate> & { name: string; type: AdType },
): AdTemplate {
  const now = new Date().toISOString();
  return {
    id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    name: data.name,
    type: data.type,
    status: data.status || 'draft',
    version: 1,
    title: data.title || '',
    terms: data.terms || '',
    autoReply: data.autoReply || '',
    variables: data.variables || DEFAULT_AD_VARIABLES,
    tags: data.tags || [],
    createdAt: now,
    updatedAt: now,
    createdBy: data.createdBy || 'system',
    metadata: data.metadata || {},
  };
}

export function cloneTemplate(template: AdTemplate, newName?: string): AdTemplate {
  return {
    ...template,
    id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    name: newName || `${template.name} (copia)`,
    version: template.version + 1,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function filterTemplates(
  templates: AdTemplate[],
  filters: { type?: AdType; status?: AdStatus; tags?: string[] } = {},
): AdTemplate[] {
  return templates.filter((t) => {
    if (filters.type && t.type !== filters.type) return false;
    if (filters.status && t.status !== filters.status) return false;
    if (filters.tags?.length && !filters.tags.some((tag) => t.tags.includes(tag))) return false;
    return true;
  });
}
