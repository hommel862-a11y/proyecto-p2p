/**
 * @file arm-orchestration-engine.ts
 * @description Pure Domain Engine for Multi-Workspace ARM (Agentic Relationship Management).
 * Enforces strict silo isolation across ARM_B2B, P2P_DESK, and FINANCE_360, deterministic
 * BANT scoring, FSM stage transitions, Risk Gate (Human-in-the-Loop), Outbound DLP,
 * Multimodal/Anti-Ghosting HSM rules, Closer Post-Call Intelligence, Shadow Learning,
 * and $0-Cost Sandbox Simulation.
 *
 * Architecture: Hexagonal / Clean Architecture (100% pure TypeScript, zero Angular/DOM imports).
 */

import { evaluateMeta24hFreeWindow } from './crm-omnichannel-billing';

// =============================================================================
// 1. MULTI-WORKSPACE DOMAIN TYPES & ENUMS
// =============================================================================

export type ArmWorkspaceId = 'ARM_B2B' | 'P2P_DESK' | 'FINANCE_360';

export type ArmAgentRole =
  | 'ROUTER'
  | 'SDR_QUALIFIER'
  | 'QUOTER'
  | 'SCHEDULER'
  | 'FOLLOW_UP';

export type ArmActorType = 'AGENT' | 'HUMAN' | 'SYSTEM';

export type ArmConversationStatus =
  | 'AUTOPILOT'
  | 'HUMAN_TAKEOVER'
  | 'WAITING_APPROVAL'
  | 'CLOSED';

export type ArmApprovalStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'EDITED_AND_APPROVED'
  | 'REJECTED'
  | 'EXPIRED';

export type ArmApprovalActionType =
  | 'SEND_QUOTE'
  | 'APPLY_DISCOUNT'
  | 'SEND_FOLLOWUP'
  | 'BOOK_CUSTOM_MEETING'
  | 'STAGE_OVERRIDE'
  | 'P2P_SETTLEMENT_RELEASE';

export type ArmMemoryType = 'PAIN_POINT' | 'OBJECTION' | 'PREFERENCE' | 'TECH_STACK';

export type ArmSentiment = 'POSITIVE' | 'NEUTRAL' | 'URGENT' | 'FRUSTRATED';

export interface ArmBantData {
  budget: string | null;
  authority: string | null;
  need_pain_point: string | null;
  timeline: string | null;
}

export interface ArmWorkspaceConfig {
  id: ArmWorkspaceId;
  displayName: string;
  accentColorHex: string;
  defaultCurrency: 'USD' | 'USDT' | 'VES' | 'COP';
  debounceWindowMs: number;
  dailyAiBudgetUsd: number;
  maxAutoDiscountPct: number;
  maxAutoQuoteAmount: number;
  requireHumanForSettlement: boolean;
  maxFollowupAttempts: number;
}

export interface ArmPipelineStageConfig {
  slug: string;
  name: string;
  workspaceId: ArmWorkspaceId;
  position: number;
  colorHex: string;
  isTerminal: boolean;
  requiresQuote?: boolean;
  requiresAppointment?: boolean;
  requiresHumanApproval?: boolean;
}

export interface ArmAgentDefinition {
  id: string;
  workspaceId: ArmWorkspaceId;
  name: string;
  role: ArmAgentRole;
  llmProvider: 'gemini' | 'openai' | 'anthropic' | 'deepseek' | 'qwen';
  llmModel: string;
  temperature: number;
  confidenceThreshold: number;
  enabledTools: string[];
  systemPrompt: string;
}

export interface ArmCatalogItem {
  sku: string;
  workspaceId: ArmWorkspaceId;
  desc: string;
  unitPrice: number;
  currency: 'USD' | 'USDT' | 'VES' | 'COP';
  billingCycle: 'MONTHLY' | 'ANNUAL' | 'ONE_TIME';
}

export interface ArmLeadProfile {
  id: string;
  workspaceId: ArmWorkspaceId;
  fullName: string | null;
  companyName: string | null;
  phoneWhatsapp: string | null;
  email: string | null;
  currentStageSlug: string;
  qualificationScore: number;
  isQualified: boolean | null;
  substantiveTurnsCount: number;
  bantData: ArmBantData;
  aiExecutiveSummary: string;
  estimatedDealValue: number;
  currency: string;
  recommendedStageSlug?: string;
}

export interface ArmApprovalQueueItem {
  id: string;
  workspaceId: ArmWorkspaceId;
  idempotencyKey: string;
  leadId: string;
  leadName: string;
  requestedByRole: ArmAgentRole;
  toolName: string;
  actionType: ArmApprovalActionType;
  title: string;
  agentReasoning: string;
  riskRuleTriggered: string;
  proposedPayload: Record<string, unknown>;
  finalApprovedPayload?: Record<string, unknown>;
  saveAsExample?: boolean;
  confidenceScore: number;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  status: ArmApprovalStatus;
  createdAt: number;
}

export interface ArmAutonomousFeedEvent {
  id: string;
  workspaceId: ArmWorkspaceId;
  agentRole: ArmAgentRole;
  agentName: string;
  leadId: string;
  leadName: string;
  toolName: string;
  summary: string;
  latencyMs: number;
  timestamp: number;
  isSandbox?: boolean;
}

export interface ArmShadowExample {
  id: string;
  workspaceId: ArmWorkspaceId;
  agentRole: ArmAgentRole;
  actionType: ArmApprovalActionType;
  proposedText: string;
  approvedText: string;
  createdAt: number;
}

// =============================================================================
// 2. ISOLATED WORKSPACE REGISTRIES (ARM_B2B | P2P_DESK | FINANCE_360)
// =============================================================================

export const ARM_WORKSPACES: Record<ArmWorkspaceId, ArmWorkspaceConfig> = {
  ARM_B2B: {
    id: 'ARM_B2B',
    displayName: 'ARM Comercial B2B',
    accentColorHex: '#30D158',
    defaultCurrency: 'USD',
    debounceWindowMs: 3000,
    dailyAiBudgetUsd: 15,
    maxAutoDiscountPct: 0,
    maxAutoQuoteAmount: 1500,
    requireHumanForSettlement: true,
    maxFollowupAttempts: 3,
  },
  P2P_DESK: {
    id: 'P2P_DESK',
    displayName: 'Mesa P2P & Liquidez',
    accentColorHex: '#0A84FF',
    defaultCurrency: 'USDT',
    debounceWindowMs: 2000,
    dailyAiBudgetUsd: 15,
    maxAutoDiscountPct: 0,
    maxAutoQuoteAmount: 500,
    requireHumanForSettlement: true,
    maxFollowupAttempts: 2,
  },
  FINANCE_360: {
    id: 'FINANCE_360',
    displayName: 'Finanzas & PyME 360',
    accentColorHex: '#FFD60A',
    defaultCurrency: 'USD',
    debounceWindowMs: 3000,
    dailyAiBudgetUsd: 15,
    maxAutoDiscountPct: 5,
    maxAutoQuoteAmount: 1200,
    requireHumanForSettlement: true,
    maxFollowupAttempts: 3,
  },
};

const WORKSPACE_STAGES: Record<ArmWorkspaceId, ArmPipelineStageConfig[]> = {
  ARM_B2B: [
    { slug: 'nuevo', name: 'Nuevo', workspaceId: 'ARM_B2B', position: 1, colorHex: '#0A84FF', isTerminal: false },
    { slug: 'en-descubrimiento', name: 'En Descubrimiento', workspaceId: 'ARM_B2B', position: 2, colorHex: '#5E5CE6', isTerminal: false },
    { slug: 'calificado', name: 'Calificado (BANT >= 70)', workspaceId: 'ARM_B2B', position: 3, colorHex: '#30D158', isTerminal: false },
    { slug: 'no-calificado', name: 'No Calificado', workspaceId: 'ARM_B2B', position: 4, colorHex: '#FF453A', isTerminal: true },
    { slug: 'cotizacion-enviada', name: 'Cotización Enviada', workspaceId: 'ARM_B2B', position: 5, colorHex: '#FFD60A', isTerminal: false, requiresQuote: true },
    { slug: 'sesion-agendada', name: 'Sesión Agendada', workspaceId: 'ARM_B2B', position: 6, colorHex: '#00E676', isTerminal: false, requiresAppointment: true },
  ],
  P2P_DESK: [
    { slug: 'STAGE_1_NEW', name: '1. Cotizado / Nuevo', workspaceId: 'P2P_DESK', position: 1, colorHex: '#0A84FF', isTerminal: false },
    { slug: 'STAGE_2_TRANSIT', name: '2. En Tránsito (Cupo)', workspaceId: 'P2P_DESK', position: 2, colorHex: '#FF9F0A', isTerminal: false },
    { slug: 'STAGE_3_VERIFY', name: '3. Verificando Ref OCR', workspaceId: 'P2P_DESK', position: 3, colorHex: '#5E5CE6', isTerminal: false },
    { slug: 'STAGE_4_CLOSED', name: '4. Liquidado / Cerrado', workspaceId: 'P2P_DESK', position: 4, colorHex: '#30D158', isTerminal: true, requiresHumanApproval: true },
  ],
  FINANCE_360: [
    { slug: 'solicitud-360', name: 'Solicitud Comercial', workspaceId: 'FINANCE_360', position: 1, colorHex: '#0A84FF', isTerminal: false },
    { slug: 'presupuestado-360', name: 'Presupuestado PyME', workspaceId: 'FINANCE_360', position: 2, colorHex: '#FFD60A', isTerminal: false, requiresQuote: true },
    { slug: 'por-cobrar-360', name: 'Por Cobrar / Abono', workspaceId: 'FINANCE_360', position: 3, colorHex: '#FF9F0A', isTerminal: false },
    { slug: 'facturado-360', name: 'Facturado (50/30/20)', workspaceId: 'FINANCE_360', position: 4, colorHex: '#30D158', isTerminal: true },
  ],
};

const WORKSPACE_CATALOGS: Record<ArmWorkspaceId, ArmCatalogItem[]> = {
  ARM_B2B: [
    { sku: 'PLAN-STARTER', workspaceId: 'ARM_B2B', desc: 'Licencia Semestral Starter (Hasta 5 usuarios)', unitPrice: 600, currency: 'USD', billingCycle: 'ANNUAL' },
    { sku: 'PLAN-PRO', workspaceId: 'ARM_B2B', desc: 'Licencia Anual Pro Multi-Agente (Hasta 20 usuarios)', unitPrice: 1200, currency: 'USD', billingCycle: 'ANNUAL' },
    { sku: 'PLAN-ENTERPRISE', workspaceId: 'ARM_B2B', desc: 'Suite Enterprise Multi-Sede + API Dedicada', unitPrice: 2400, currency: 'USD', billingCycle: 'ANNUAL' },
  ],
  P2P_DESK: [
    { sku: 'OTC-USDT-LOT', workspaceId: 'P2P_DESK', desc: 'Bloque Liquidez Mayorista USDT/VES', unitPrice: 1, currency: 'USDT', billingCycle: 'ONE_TIME' },
  ],
  FINANCE_360: [
    { sku: 'PYME-PACK-DIST', workspaceId: 'FINANCE_360', desc: 'Lote Distribución Comercial PyME', unitPrice: 950, currency: 'USD', billingCycle: 'ONE_TIME' },
    { sku: 'PYME-SERV-360', workspaceId: 'FINANCE_360', desc: 'Servicio Integral de Gestión & Facturación', unitPrice: 1850, currency: 'USD', billingCycle: 'ONE_TIME' },
  ],
};

const WORKSPACE_AGENTS: Record<ArmWorkspaceId, ArmAgentDefinition[]> = {
  ARM_B2B: [
    {
      id: 'b2b-router',
      workspaceId: 'ARM_B2B',
      name: 'Router & Triage Coordinator',
      role: 'ROUTER',
      llmProvider: 'gemini',
      llmModel: 'gemini-3.7-flash',
      temperature: 0.0,
      confidenceThreshold: 90,
      enabledTools: ['route_conversation'],
      systemPrompt:
        'Analiza el mensaje entrante, el perfil del lead (current_stage_slug, bant_data) y delega inmediatamente la sesión usando route_conversation. Nunca inventes precios ni horarios.',
    },
    {
      id: 'b2b-sdr',
      workspaceId: 'ARM_B2B',
      name: 'Meteor SDR Qualifier (BANT)',
      role: 'SDR_QUALIFIER',
      llmProvider: 'gemini',
      llmModel: 'gemini-3.7-flash',
      temperature: 0.3,
      confidenceThreshold: 85,
      enabledTools: [
        'update_lead_bant_and_profile',
        'transition_pipeline_stage',
        'save_lead_memory_fact',
        'search_lead_memories',
        'route_conversation',
      ],
      systemPrompt:
        'Conversa por WhatsApp con máximo 2-3 oraciones y una sola pregunta por turno. Extrae variables BANT silenciosamente e invoca update_lead_bant_and_profile.',
    },
    {
      id: 'b2b-quoter',
      workspaceId: 'ARM_B2B',
      name: 'Agente Cotizador & Gobernanza',
      role: 'QUOTER',
      llmProvider: 'gemini',
      llmModel: 'gemini-3.7-flash',
      temperature: 0.1,
      confidenceThreshold: 90,
      enabledTools: ['get_catalog_items', 'create_or_submit_quote', 'route_conversation'],
      systemPrompt:
        'Estructura cotizaciones formales basadas estrictamente en el catálogo oficial consultando get_catalog_items y ejecutando create_or_submit_quote.',
    },
    {
      id: 'b2b-scheduler',
      workspaceId: 'ARM_B2B',
      name: 'Agente Scheduler & Closer Briefing',
      role: 'SCHEDULER',
      llmProvider: 'gemini',
      llmModel: 'gemini-3.7-flash',
      temperature: 0.2,
      confidenceThreshold: 85,
      enabledTools: ['check_calendar_slots', 'book_appointment', 'transition_pipeline_stage'],
      systemPrompt:
        'Ejecuta siempre check_calendar_slots antes de ofrecer horarios, propone 2 opciones concretas y al confirmar ejecuta book_appointment con briefing_for_human.',
    },
    {
      id: 'b2b-followup',
      workspaceId: 'ARM_B2B',
      name: 'Agente Anti-Ghosting Follow-Up',
      role: 'FOLLOW_UP',
      llmProvider: 'gemini',
      llmModel: 'gemini-3.7-flash',
      temperature: 0.2,
      confidenceThreshold: 85,
      enabledTools: ['search_lead_memories', 'send_whatsapp_template'],
      systemPrompt:
        'Reactiva conversaciones estancadas usando el dolor guardado en lead_memories y plantillas HSM fuera de la ventana de 24h.',
    },
  ],
  P2P_DESK: [
    {
      id: 'p2p-router',
      workspaceId: 'P2P_DESK',
      name: 'P2P Triage & Rate Desk',
      role: 'ROUTER',
      llmProvider: 'gemini',
      llmModel: 'gemini-3.7-flash',
      temperature: 0.0,
      confidenceThreshold: 95,
      enabledTools: ['route_conversation'],
      systemPrompt: 'Clasifica solicitudes de cambio P2P, reserva de cupo y comprobantes bancarios sin inventar tasas.',
    },
    {
      id: 'p2p-quoter',
      workspaceId: 'P2P_DESK',
      name: 'P2P OCR & Settlement Shield',
      role: 'QUOTER',
      llmProvider: 'gemini',
      llmModel: 'gemini-3.7-flash',
      temperature: 0.1,
      confidenceThreshold: 95,
      enabledTools: ['transition_pipeline_stage', 'create_or_submit_quote'],
      systemPrompt: 'Verifica comprobantes bancarios por OCR y exige aprobación humana antes de STAGE_4_CLOSED.',
    },
  ],
  FINANCE_360: [
    {
      id: 'f360-router',
      workspaceId: 'FINANCE_360',
      name: 'Router Comercial PyME 360',
      role: 'ROUTER',
      llmProvider: 'gemini',
      llmModel: 'gemini-3.7-flash',
      temperature: 0.0,
      confidenceThreshold: 90,
      enabledTools: ['route_conversation'],
      systemPrompt: 'Coordina solicitudes de presupuestos PyME, facturación y cobranza.',
    },
    {
      id: 'f360-quoter',
      workspaceId: 'FINANCE_360',
      name: 'Cotizador & Cobranza 360',
      role: 'QUOTER',
      llmProvider: 'gemini',
      llmModel: 'gemini-3.7-flash',
      temperature: 0.1,
      confidenceThreshold: 90,
      enabledTools: ['get_catalog_items', 'create_or_submit_quote', 'transition_pipeline_stage'],
      systemPrompt: 'Genera presupuestos PyME unificados y escala planes de pago fraccionados a approval_queue.',
    },
  ],
};

export function getWorkspaceStages(workspaceId: ArmWorkspaceId): ArmPipelineStageConfig[] {
  return [...(WORKSPACE_STAGES[workspaceId] || [])];
}

export function getWorkspaceAgents(workspaceId: ArmWorkspaceId): ArmAgentDefinition[] {
  return [...(WORKSPACE_AGENTS[workspaceId] || [])];
}

export function getWorkspaceCatalog(workspaceId: ArmWorkspaceId): ArmCatalogItem[] {
  return [...(WORKSPACE_CATALOGS[workspaceId] || [])];
}

// =============================================================================
// 3. UNIFIED TOOL-CALLING JSON SCHEMAS (10 STRICT CONTRACTS)
// =============================================================================

export interface ArmToolJsonSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    strict: boolean;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
  };
}

export const ARM_UNIFIED_TOOL_CONTRACTS: ArmToolJsonSchema[] = [
  {
    type: 'function',
    function: {
      name: 'route_conversation',
      description:
        'Delega el control de la conversación al agente especialista o a un humano actualizando conversations.active_agent_id y leads.assigned_agent_id.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          target_role: {
            type: 'string',
            enum: ['SDR_QUALIFIER', 'QUOTER', 'SCHEDULER', 'FOLLOW_UP', 'HUMAN_TAKEOVER'],
            description: 'Rol especialista destino dentro del mismo workspace_id.',
          },
          detected_intent: {
            type: 'string',
            enum: ['DISCOVERY_BANT', 'PRICING_QUOTE', 'BOOK_MEETING', 'PAYMENT_PROOF', 'HUMAN_ESCALATION', 'FOLLOW_UP'],
            description: 'Intención primaria detectada en el mensaje del prospecto.',
          },
          sentiment: {
            type: 'string',
            enum: ['POSITIVE', 'NEUTRAL', 'URGENT', 'FRUSTRATED'],
            description: 'Tono emocional detectado en el turno.',
          },
          handoff_context_note: {
            type: 'string',
            description: 'Nota táctica concisa para el especialista que recibe la sesión.',
          },
        },
        required: ['target_role', 'detected_intent', 'sentiment', 'handoff_context_note'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_lead_bant_and_profile',
      description:
        'Actualiza silenciosamente el perfil del lead y el objeto bant_data sin sobrescribir campos previos cuando se envía null.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          full_name: { type: ['string', 'null'], description: 'Nombre completo del contacto o null si no cambió.' },
          company_name: { type: ['string', 'null'], description: 'Empresa o clínica del prospecto o null.' },
          email: { type: ['string', 'null'], description: 'Correo electrónico corporativo o null.' },
          bant_patch: {
            type: 'object',
            description: 'Dimensiones BANT extraídas de la conversación.',
            properties: {
              budget: { type: ['string', 'null'], description: 'Presupuesto disponible declarado.' },
              authority: { type: ['string', 'null'], description: 'Rol o poder de decisión del contacto.' },
              need_pain_point: { type: ['string', 'null'], description: 'Dolor principal o problema operativo.' },
              timeline: { type: ['string', 'null'], description: 'Plazo o urgencia de implementación.' },
            },
            required: ['budget', 'authority', 'need_pain_point', 'timeline'],
            additionalProperties: false,
          },
          ai_executive_summary: {
            type: 'string',
            description: 'Resumen ejecutivo actualizado de 1 línea para mostrar en la tarjeta Kanban.',
          },
          estimated_deal_value: {
            type: 'number',
            description: 'Valor estimado del trato en la moneda del workspace.',
          },
        },
        required: ['full_name', 'company_name', 'email', 'bant_patch', 'ai_executive_summary', 'estimated_deal_value'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'transition_pipeline_stage',
      description: 'Valida en la FSM e inserta en pipeline_transitions para mover automáticamente la tarjeta en el Kanban.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          to_stage_slug: {
            type: 'string',
            enum: [
              'nuevo',
              'en-descubrimiento',
              'calificado',
              'no-calificado',
              'cotizacion-enviada',
              'sesion-agendada',
              'STAGE_1_NEW',
              'STAGE_2_TRANSIT',
              'STAGE_3_VERIFY',
              'STAGE_4_CLOSED',
              'solicitud-360',
              'presupuestado-360',
              'por-cobrar-360',
              'facturado-360',
            ],
            description: 'Slug de la etapa destino perteneciente al workspace activo.',
          },
          reasoning: {
            type: 'string',
            description: 'Justificación auditable de por qué el agente mueve la tarjeta.',
          },
        },
        required: ['to_stage_slug', 'reasoning'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_lead_memory_fact',
      description: 'Guarda un hecho atómico en lead_memories para memoria semántica de largo plazo.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          memory_type: {
            type: 'string',
            enum: ['PAIN_POINT', 'OBJECTION', 'PREFERENCE', 'TECH_STACK'],
            description: 'Categoría del hecho extraído.',
          },
          fact: {
            type: 'string',
            description: 'Oración autónoma y verificable sobre el cliente.',
          },
        },
        required: ['memory_type', 'fact'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_lead_memories',
      description: 'Consulta hechos históricos y objeciones previas del prospecto dentro del mismo workspace.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Consulta semántica o palabras clave a buscar.' },
          memory_type: {
            type: ['string', 'null'],
            enum: ['PAIN_POINT', 'OBJECTION', 'PREFERENCE', 'TECH_STACK', null],
            description: 'Filtro opcional de categoría.',
          },
        },
        required: ['query', 'memory_type'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_catalog_items',
      description: 'Consulta los SKUs, precios oficiales y reglas de descuento del catálogo del workspace activo.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          search_term: { type: ['string', 'null'], description: 'Filtro opcional por SKU o nombre.' },
        },
        required: ['search_term'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_or_submit_quote',
      description:
        'Estructura una cotización con precios oficiales del catálogo; el Risk Gate del backend decide automáticamente si requiere aprobación humana en approval_queue.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'Lista de ítems por SKU oficial y cantidad.',
            items: {
              type: 'object',
              properties: {
                sku: { type: 'string', description: 'Código SKU oficial del catálogo.' },
                qty: { type: 'integer', description: 'Cantidad solicitada (>= 1).' },
              },
              required: ['sku', 'qty'],
              additionalProperties: false,
            },
          },
          discount_pct: { type: 'number', description: 'Porcentaje de descuento solicitado (0 a 100).' },
          valid_days: { type: 'integer', description: 'Días de validez de la propuesta.' },
          proposed_whatsapp_message: {
            type: 'string',
            description: 'Mensaje propuesto para acompañar el envío al prospecto.',
          },
        },
        required: ['items', 'discount_pct', 'valid_days', 'proposed_whatsapp_message'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_calendar_slots',
      description: 'Consulta horarios libres del closer en la zona horaria del prospecto.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          start_date_iso: { type: 'string', description: 'Fecha ISO inicial (YYYY-MM-DD).' },
          days_ahead: { type: 'integer', description: 'Ventana de días a consultar (1 a 14).' },
          client_timezone: { type: 'string', description: 'Zona horaria IANA del cliente (ej. America/Caracas).' },
        },
        required: ['start_date_iso', 'days_ahead', 'client_timezone'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description: 'Crea la cita en appointments con briefing_for_human y mueve el lead a sesion-agendada.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Título de la sesión o demo.' },
          starts_at_iso: { type: 'string', description: 'Fecha/hora ISO 8601 con offset.' },
          duration_minutes: { type: 'integer', enum: [15, 30, 45, 60], description: 'Duración en minutos.' },
          attendee_email: { type: 'string', description: 'Email confirmado del invitado.' },
          client_timezone: { type: 'string', description: 'Zona horaria IANA del invitado.' },
          briefing_for_human: {
            type: 'string',
            description: 'Resumen táctico confidencial para el closer humano antes de entrar a la llamada.',
          },
        },
        required: [
          'title',
          'starts_at_iso',
          'duration_minutes',
          'attendee_email',
          'client_timezone',
          'briefing_for_human',
        ],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_whatsapp_template',
      description: 'Encola o envía una plantilla HSM aprobada por Meta cuando la ventana gratuita de 24h expiró.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          template_name: { type: 'string', description: 'Nombre oficial de la plantilla HSM aprobada.' },
          template_variables: {
            type: 'array',
            items: { type: 'string' },
            description: 'Variables posicionales {{1}}, {{2}} para personalizar el seguimiento.',
          },
          reasoning: { type: 'string', description: 'Justificación del seguimiento anti-ghosting.' },
        },
        required: ['template_name', 'template_variables', 'reasoning'],
        additionalProperties: false,
      },
    },
  },
];

// =============================================================================
// 4. DETERMINISTIC BANT SCORING & NON-DESTRUCTIVE PROFILE MERGE
// =============================================================================

export function isSubstantiveCustomerTurn(messageText: string): boolean {
  const cleaned = (messageText || '').trim().toLowerCase();
  if (cleaned.length < 6) return false;
  const trivialPattern = /^(hola+|buenas+|ok+|dale|listo|gracias|si|sí|no|👍|🙏)$/i;
  return !trivialPattern.test(cleaned);
}

export function calculateDeterministicBantScore(
  bant: ArmBantData,
  substantiveTurnsCount: number,
): {
  score: number;
  isQualified: boolean;
  filledDimensionsCount: number;
  recommendedStageSlug: 'en-descubrimiento' | 'calificado' | 'no-calificado';
} {
  let score = 0;
  let filled = 0;

  if (bant.need_pain_point && bant.need_pain_point.trim().length > 0) {
    score += 30;
    filled += 1;
  }
  if (bant.authority && bant.authority.trim().length > 0) {
    score += 20;
    filled += 1;
  }
  if (bant.timeline && bant.timeline.trim().length > 0) {
    score += 25;
    filled += 1;
  }
  if (bant.budget && bant.budget.trim().length > 0) {
    score += 25;
    filled += 1;
  }

  const isQualified = score >= 70;
  let recommendedStageSlug: 'en-descubrimiento' | 'calificado' | 'no-calificado' = 'en-descubrimiento';

  if (score >= 70) {
    recommendedStageSlug = 'calificado';
  } else if (score < 30 && substantiveTurnsCount >= 4) {
    recommendedStageSlug = 'no-calificado';
  }

  return {
    score,
    isQualified,
    filledDimensionsCount: filled,
    recommendedStageSlug,
  };
}

export function mergeBantAndLeadProfile(
  current: ArmLeadProfile,
  patch: {
    full_name: string | null;
    company_name: string | null;
    email: string | null;
    bant_patch: ArmBantData;
    ai_executive_summary: string;
    estimated_deal_value: number;
  },
  incomingCustomerMessage = '',
): ArmLeadProfile {
  const pickNonEmpty = (nextVal: string | null | undefined, prevVal: string | null): string | null => {
    if (typeof nextVal === 'string' && nextVal.trim().length > 0) {
      return nextVal.trim();
    }
    return prevVal;
  };

  const mergedBant: ArmBantData = {
    budget: pickNonEmpty(patch.bant_patch?.budget, current.bantData.budget),
    authority: pickNonEmpty(patch.bant_patch?.authority, current.bantData.authority),
    need_pain_point: pickNonEmpty(patch.bant_patch?.need_pain_point, current.bantData.need_pain_point),
    timeline: pickNonEmpty(patch.bant_patch?.timeline, current.bantData.timeline),
  };

  const nextTurns =
    current.substantiveTurnsCount + (isSubstantiveCustomerTurn(incomingCustomerMessage) ? 1 : 0);

  const evalResult = calculateDeterministicBantScore(mergedBant, nextTurns);

  return {
    ...current,
    fullName: pickNonEmpty(patch.full_name, current.fullName),
    companyName: pickNonEmpty(patch.company_name, current.companyName),
    email: pickNonEmpty(patch.email, current.email),
    bantData: mergedBant,
    substantiveTurnsCount: nextTurns,
    qualificationScore: evalResult.score,
    isQualified: evalResult.isQualified,
    aiExecutiveSummary:
      patch.ai_executive_summary && patch.ai_executive_summary.trim().length > 0
        ? patch.ai_executive_summary.trim()
        : current.aiExecutiveSummary,
    estimatedDealValue:
      Number.isFinite(patch.estimated_deal_value) && patch.estimated_deal_value > 0
        ? patch.estimated_deal_value
        : current.estimatedDealValue,
    recommendedStageSlug: evalResult.recommendedStageSlug,
  };
}

// =============================================================================
// 5. DETERMINISTIC PRE-ROUTER & TRIAGE ENGINE
// =============================================================================

export interface ArmPreRouterDecision {
  shouldInvokeLlm: boolean;
  targetRole: ArmAgentRole | 'HUMAN_TAKEOVER';
  detectedIntent:
    | 'DISCOVERY_BANT'
    | 'PRICING_QUOTE'
    | 'BOOK_MEETING'
    | 'PAYMENT_PROOF'
    | 'HUMAN_ESCALATION';
  sentiment: ArmSentiment;
  handoffContextNote: string;
}

export function evaluateDeterministicPreRouter(params: {
  workspaceId: ArmWorkspaceId;
  conversationStatus: ArmConversationStatus;
  currentStageSlug: string;
  bantData: ArmBantData;
  messageText: string;
}): ArmPreRouterDecision {
  if (
    params.conversationStatus === 'HUMAN_TAKEOVER' ||
    params.conversationStatus === 'WAITING_APPROVAL' ||
    params.conversationStatus === 'CLOSED'
  ) {
    return {
      shouldInvokeLlm: false,
      targetRole: 'HUMAN_TAKEOVER',
      detectedIntent: 'HUMAN_ESCALATION',
      sentiment: 'NEUTRAL',
      handoffContextNote: `Conversación en estado ${params.conversationStatus}; ejecución autónoma en pausa.`,
    };
  }

  const text = (params.messageText || '').toLowerCase();

  // 1. Human escalation / frustration guard
  if (
    /\b(humano|persona|supervisor|gerente|queja|estafa|harto|molesto|pésimo|reclamo|denuncia)\b/i.test(
      text,
    )
  ) {
    return {
      shouldInvokeLlm: false,
      targetRole: 'HUMAN_TAKEOVER',
      detectedIntent: 'HUMAN_ESCALATION',
      sentiment: 'FRUSTRATED',
      handoffContextNote: 'Frustración o solicitud explícita de atención humana detectada.',
    };
  }

  // 2. Scheduling / demo request
  if (/\b(agendar|agenda|agendemos|reunión|reunion|llamada|demo|cita|horario|mañana a las)\b/i.test(text)) {
    return {
      shouldInvokeLlm: true,
      targetRole: 'SCHEDULER',
      detectedIntent: 'BOOK_MEETING',
      sentiment: 'POSITIVE',
      handoffContextNote: 'El prospecto solicita o confirma agendar llamada/demo.',
    };
  }

  // 3. Pricing / Quote / Discount request
  if (/\b(precio|precios|cotizaci[oó]n|cotizar|cu[aá]nto cuesta|descuento|planes|propuesta)\b/i.test(text)) {
    return {
      shouldInvokeLlm: true,
      targetRole: 'QUOTER',
      detectedIntent: 'PRICING_QUOTE',
      sentiment: 'URGENT',
      handoffContextNote: 'Solicitud explícita de precios, planes o descuento comercial.',
    };
  }

  // 4. Default discovery via SDR_QUALIFIER
  return {
    shouldInvokeLlm: true,
    targetRole: 'SDR_QUALIFIER',
    detectedIntent: 'DISCOVERY_BANT',
    sentiment: 'NEUTRAL',
    handoffContextNote: 'Calificación consultiva BANT y descubrimiento de dolores.',
  };
}

// =============================================================================
// 6. DETERMINISTIC FSM PIPELINE TRANSITION VALIDATOR
// =============================================================================

export interface ArmStageTransitionValidation {
  allowed: boolean;
  rejectionCode?:
    | 'STAGE_NOT_IN_WORKSPACE'
    | 'QUOTE_REQUIRED_FOR_STAGE'
    | 'APPOINTMENT_REQUIRED_FOR_STAGE'
    | 'P2P_SETTLEMENT_REQUIRES_HUMAN_APPROVAL';
  reason: string;
}

export function validateArmStageTransition(params: {
  workspaceId: ArmWorkspaceId;
  fromStageSlug: string | null;
  toStageSlug: string;
  triggeredByType: ArmActorType;
  reasoning: string;
  hasActiveQuote?: boolean;
  hasConfirmedAppointment?: boolean;
  hasHumanSettlementApproval?: boolean;
}): ArmStageTransitionValidation {
  const stages = getWorkspaceStages(params.workspaceId);
  const targetStage = stages.find((s) => s.slug === params.toStageSlug);

  if (!targetStage) {
    return {
      allowed: false,
      rejectionCode: 'STAGE_NOT_IN_WORKSPACE',
      reason: `La etapa '${params.toStageSlug}' no existe en el silo ${params.workspaceId}.`,
    };
  }

  if (targetStage.requiresQuote && params.hasActiveQuote === false) {
    return {
      allowed: false,
      rejectionCode: 'QUOTE_REQUIRED_FOR_STAGE',
      reason: `La etapa '${params.toStageSlug}' exige una cotización registrada.`,
    };
  }

  if (targetStage.requiresAppointment && params.hasConfirmedAppointment === false) {
    return {
      allowed: false,
      rejectionCode: 'APPOINTMENT_REQUIRED_FOR_STAGE',
      reason: `La etapa '${params.toStageSlug}' exige una cita confirmada.`,
    };
  }

  // Anti-fraud rule: P2P STAGE_4_CLOSED never auto-closes by agent OCR alone
  if (
    params.workspaceId === 'P2P_DESK' &&
    params.toStageSlug === 'STAGE_4_CLOSED' &&
    !params.hasHumanSettlementApproval &&
    params.triggeredByType === 'AGENT'
  ) {
    return {
      allowed: false,
      rejectionCode: 'P2P_SETTLEMENT_REQUIRES_HUMAN_APPROVAL',
      reason:
        'Un comprobante leído por OCR nunca liquida automáticamente sin aprobación humana o conciliación bancaria.',
    };
  }

  return {
    allowed: true,
    reason: params.reasoning,
  };
}

// =============================================================================
// 7. DETERMINISTIC QUOTE ENGINE & RISK GATE (HUMAN-IN-THE-LOOP)
// =============================================================================

export interface BuiltArmQuoteResult {
  quoteNumber: string;
  workspaceId: ArmWorkspaceId;
  leadId: string;
  lineItems: Array<{
    sku: string;
    desc: string;
    qty: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  subtotal: number;
  discountPct: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  requiresHumanApproval: boolean;
  status: 'SENT' | 'PENDING_APPROVAL';
  approvalEntry?: ArmApprovalQueueItem;
}

export function evaluateAndBuildArmQuote(params: {
  workspaceId: ArmWorkspaceId;
  leadId: string;
  leadName?: string;
  items: Array<{ sku: string; qty: number }>;
  discountPct: number;
  validDays: number;
  hasSpecialConditions?: boolean;
  proposedWhatsappMessage?: string;
  nowMs?: number;
}): BuiltArmQuoteResult {
  const ws = ARM_WORKSPACES[params.workspaceId];
  const catalog = getWorkspaceCatalog(params.workspaceId);
  const now = params.nowMs ?? Date.now();

  if (!params.items || params.items.length === 0) {
    throw new Error('La cotización requiere al menos un SKU válido del catálogo.');
  }

  const lineItems = params.items.map((reqItem) => {
    const found = catalog.find((c) => c.sku === reqItem.sku);
    if (!found) {
      throw new Error(`SKU '${reqItem.sku}' no existe en el catálogo oficial de ${params.workspaceId}.`);
    }
    const qty = Math.max(1, Math.floor(reqItem.qty));
    const lineTotal = Math.round(found.unitPrice * qty * 100) / 100;
    return {
      sku: found.sku,
      desc: found.desc,
      qty,
      unitPrice: found.unitPrice,
      lineTotal,
    };
  });

  const subtotal = Math.round(lineItems.reduce((acc, l) => acc + l.lineTotal, 0) * 100) / 100;
  const clampedDiscountPct = Math.max(0, Math.min(100, params.discountPct || 0));
  const discountAmount = Math.round(subtotal * (clampedDiscountPct / 100) * 100) / 100;
  const totalAmount = Math.round((subtotal - discountAmount) * 100) / 100;

  const exceedsDiscount = clampedDiscountPct > ws.maxAutoDiscountPct;
  const exceedsAmount = totalAmount > ws.maxAutoQuoteAmount;
  const requiresHumanApproval =
    exceedsDiscount || exceedsAmount || Boolean(params.hasSpecialConditions);

  const quoteNumber = `Q-${params.workspaceId.slice(0, 3)}-${String(now).slice(-5)}`;

  let approvalEntry: ArmApprovalQueueItem | undefined;
  if (requiresHumanApproval) {
    const reasons: string[] = [];
    if (exceedsDiscount) {
      reasons.push(`Descuento ${clampedDiscountPct}% > umbral autónomo (${ws.maxAutoDiscountPct}%)`);
    }
    if (exceedsAmount) {
      reasons.push(`Total $${totalAmount} > tope autónomo ($${ws.maxAutoQuoteAmount})`);
    }
    if (params.hasSpecialConditions) {
      reasons.push('Condiciones comerciales especiales de pago');
    }

    const actionType: ArmApprovalActionType = exceedsDiscount ? 'APPLY_DISCOUNT' : 'SEND_QUOTE';
    approvalEntry = {
      id: `app-${now}-${params.leadId}`,
      workspaceId: params.workspaceId,
      idempotencyKey: `quote:${params.workspaceId}:${params.leadId}:${quoteNumber}`,
      leadId: params.leadId,
      leadName: params.leadName || params.leadId,
      requestedByRole: 'QUOTER',
      toolName: 'create_or_submit_quote',
      actionType,
      title: `Cotización ${quoteNumber} • $${totalAmount} ${ws.defaultCurrency} (${clampedDiscountPct}% Dto)`,
      agentReasoning: reasons.join(' + '),
      riskRuleTriggered: reasons.join(' | '),
      proposedPayload: {
        quoteNumber,
        items: lineItems,
        subtotal,
        discountPct: clampedDiscountPct,
        totalAmount,
        currency: ws.defaultCurrency,
        proposedWhatsappMessage:
          params.proposedWhatsappMessage ||
          `Te comparto la cotización formal ${quoteNumber} por ${totalAmount} ${ws.defaultCurrency}.`,
      },
      confidenceScore: 92,
      priority: totalAmount > ws.maxAutoQuoteAmount * 1.5 ? 'HIGH' : 'NORMAL',
      status: 'PENDING',
      createdAt: now,
    };
  }

  return {
    quoteNumber,
    workspaceId: params.workspaceId,
    leadId: params.leadId,
    lineItems,
    subtotal,
    discountPct: clampedDiscountPct,
    discountAmount,
    taxAmount: 0,
    totalAmount,
    currency: ws.defaultCurrency,
    requiresHumanApproval,
    status: requiresHumanApproval ? 'PENDING_APPROVAL' : 'SENT',
    approvalEntry,
  };
}

// =============================================================================
// 8. OUTBOUND DLP GUARD (CROSS-SILO & INTERNAL PROMPT LEAK PROTECTION)
// =============================================================================

export function scanOutboundMessageDlp(params: {
  workspaceId: ArmWorkspaceId;
  outboundText: string;
}): { safe: boolean; violations: string[] } {
  const violations: string[] = [];
  const text = params.outboundText || '';

  // 1. Internal prompt/variable names must never leak to WhatsApp customers
  if (/\b(qualification_score|bant_patch|briefing_for_human|requires_human_approval|system_prompt)\b/i.test(text)) {
    violations.push('INTERNAL_METRIC_LEAK');
  }

  // 2. Cross-silo guard: B2B SaaS agents must never emit Venezuelan P2P Pago Móvil bank rails
  if (
    params.workspaceId === 'ARM_B2B' &&
    /\b(pago\s*m[oó]vil|0134-|0102-|0105-|liberar\s+usdt)\b/i.test(text)
  ) {
    violations.push('CROSS_SILO_P2P_RAIL_IN_B2B');
  }

  return {
    safe: violations.length === 0,
    violations,
  };
}

// =============================================================================
// 9. ADVANCED LAYERS: ANTI-GHOSTING HSM, CLOSER POST-CALL & SHADOW LEARNING
// =============================================================================

export function evaluateGhostingFollowUp(params: {
  workspaceId: ArmWorkspaceId;
  leadId: string;
  leadName: string;
  lastInboundTimestampMs: number;
  nowTimestampMs?: number;
  followupAttempts: number;
  painPointMemory: string;
}): {
  shouldQueueFollowUp: boolean;
  requiresHsmTemplate: boolean;
  reason: string;
  approvalEntry?: ArmApprovalQueueItem;
} {
  const now = params.nowTimestampMs ?? Date.now();
  const ws = ARM_WORKSPACES[params.workspaceId];

  if (params.followupAttempts >= ws.maxFollowupAttempts) {
    return {
      shouldQueueFollowUp: false,
      requiresHsmTemplate: false,
      reason: `Tope máximo de ${ws.maxFollowupAttempts} seguimientos alcanzado.`,
    };
  }

  const elapsedHours = (now - params.lastInboundTimestampMs) / (1000 * 3600);
  if (elapsedHours < 24) {
    return {
      shouldQueueFollowUp: false,
      requiresHsmTemplate: false,
      reason: 'El prospecto aún está dentro de las primeras 24 horas.',
    };
  }

  const windowEval = evaluateMeta24hFreeWindow(params.lastInboundTimestampMs, now);
  const requiresHsmTemplate = !windowEval.isOpen;

  const approvalEntry: ArmApprovalQueueItem = {
    id: `fup-${now}-${params.leadId}`,
    workspaceId: params.workspaceId,
    idempotencyKey: `followup:${params.workspaceId}:${params.leadId}:${params.followupAttempts + 1}`,
    leadId: params.leadId,
    leadName: params.leadName,
    requestedByRole: 'FOLLOW_UP',
    toolName: 'send_whatsapp_template',
    actionType: 'SEND_FOLLOWUP',
    title: `Reactivación ${Math.round(elapsedHours)}h • ${params.leadName} (Plantilla HSM)`,
    agentReasoning: `Inactividad de ${Math.round(elapsedHours)}h. Ventana Meta 24h cerrada (${windowEval.costStatus}); se personaliza con dolor: "${params.painPointMemory}".`,
    riskRuleTriggered: 'META_24H_WINDOW_CLOSED_HSM_REQUIRED',
    proposedPayload: {
      templateName: 'arm_contextual_followup_v1',
      variables: [params.leadName, params.painPointMemory],
      previewText: `Hola ${params.leadName}, ¿pudieron evaluar cómo resolver ${params.painPointMemory}? Te preparé un resumen de 2 minutos.`,
    },
    confidenceScore: 89,
    priority: elapsedHours >= 72 ? 'HIGH' : 'NORMAL',
    status: 'PENDING',
    createdAt: now,
  };

  return {
    shouldQueueFollowUp: true,
    requiresHsmTemplate,
    reason: approvalEntry.agentReasoning,
    approvalEntry,
  };
}

export function processCloserPostCallNote(params: {
  workspaceId: ArmWorkspaceId;
  leadId: string;
  leadName: string;
  voiceNoteTranscript: string;
  sku: string;
  nowMs?: number;
}): {
  detectedSplitPayment: boolean;
  recommendedStageSlug: string;
  executiveNotes: string;
  approvalEntry: ArmApprovalQueueItem;
} {
  const now = params.nowMs ?? Date.now();
  const transcript = params.voiceNoteTranscript || '';
  const detectedSplitPayment = /\b(2\s*partes|dos\s*partes|50\/50|mitad|fraccionado|cuotas)\b/i.test(
    transcript,
  );

  const quoteResult = evaluateAndBuildArmQuote({
    workspaceId: params.workspaceId,
    leadId: params.leadId,
    leadName: params.leadName,
    items: [{ sku: params.sku, qty: 1 }],
    discountPct: 0,
    validDays: 7,
    hasSpecialConditions: true,
    nowMs: now,
  });

  const paymentTerms = detectedSplitPayment
    ? '50% anticipo / 50% a 30 días'
    : 'Condición acordada en llamada';

  const approvalEntry: ArmApprovalQueueItem = {
    id: `closer-${now}-${params.leadId}`,
    workspaceId: params.workspaceId,
    idempotencyKey: `closer:${params.workspaceId}:${params.leadId}:${now}`,
    leadId: params.leadId,
    leadName: params.leadName,
    requestedByRole: 'QUOTER',
    toolName: 'create_or_submit_quote',
    actionType: 'SEND_QUOTE',
    title: `Post-Llamada: ${params.leadName} • ${paymentTerms} ($${quoteResult.totalAmount})`,
    agentReasoning: `Nota de voz del closer procesada ("${transcript}"). Se estructuró propuesta con ${paymentTerms}.`,
    riskRuleTriggered: 'CLOSER_POST_CALL_CUSTOM_TERMS',
    proposedPayload: {
      ...quoteResult.approvalEntry?.proposedPayload,
      paymentTerms,
      proposedWhatsappMessage: `Hola ${params.leadName}, tal como conversamos en la llamada, te adjunto la propuesta formal con el esquema ${paymentTerms}.`,
    },
    confidenceScore: 95,
    priority: 'HIGH',
    status: 'PENDING',
    createdAt: now,
  };

  return {
    detectedSplitPayment,
    recommendedStageSlug: 'cotizacion-enviada',
    executiveNotes: `Post-llamada: ${paymentTerms}`,
    approvalEntry,
  };
}

export function recordShadowLearningCorrection(
  existingStore: ArmShadowExample[],
  params: {
    workspaceId: ArmWorkspaceId;
    agentRole: ArmAgentRole;
    actionType: ArmApprovalActionType;
    proposedText: string;
    approvedText: string;
    saveAsExample: boolean;
    nowMs?: number;
  },
): ArmShadowExample[] {
  if (!params.saveAsExample || params.proposedText.trim() === params.approvedText.trim()) {
    return [...existingStore];
  }
  const entry: ArmShadowExample = {
    id: `shw-${params.nowMs ?? Date.now()}-${existingStore.length + 1}`,
    workspaceId: params.workspaceId,
    agentRole: params.agentRole,
    actionType: params.actionType,
    proposedText: params.proposedText.trim(),
    approvedText: params.approvedText.trim(),
    createdAt: params.nowMs ?? Date.now(),
  };
  return [entry, ...existingStore];
}

export function selectFewShotExamplesForAgent(
  store: ArmShadowExample[],
  workspaceId: ArmWorkspaceId,
  agentRole: ArmAgentRole,
  limit = 3,
): ArmShadowExample[] {
  return store
    .filter((item) => item.workspaceId === workspaceId && item.agentRole === agentRole)
    .slice(0, limit);
}

// =============================================================================
// 10. SANDBOX SIMULATOR ("CAMPO DE ENTRENAMIENTO" — $0 META API COST)
// =============================================================================

export type ArmSandboxPersonaId =
  | 'SKEPTICAL_DISCOUNT_30'
  | 'URGENT_DECISION_MAKER'
  | 'P2P_SPOOFED_RECEIPT'
  | 'PYME_SPLIT_PAYMENT';

export interface ArmSandboxSimulationResult {
  isSandbox: true;
  metaApiCostUsd: 0;
  workspaceId: ArmWorkspaceId;
  personaId: ArmSandboxPersonaId;
  simulatedInboundText: string;
  agentReplyText: string;
  fromStageSlug: string;
  toStageSlug: string;
  updatedScore: number;
  toolTrace: Array<{
    agentRole: ArmAgentRole;
    toolName: string;
    latencyMs: number;
    outcome: string;
  }>;
  queuedApproval?: ArmApprovalQueueItem;
}

export function runArmSandboxSimulationTurn(params: {
  workspaceId: ArmWorkspaceId;
  personaId: ArmSandboxPersonaId;
  nowMs?: number;
}): ArmSandboxSimulationResult {
  const now = params.nowMs ?? Date.now();

  if (params.personaId === 'P2P_SPOOFED_RECEIPT' || params.workspaceId === 'P2P_DESK') {
    const approval: ArmApprovalQueueItem = {
      id: `sbx-p2p-${now}`,
      workspaceId: 'P2P_DESK',
      idempotencyKey: `sbx:P2P_DESK:${now}`,
      leadId: 'sbx-lead-p2p',
      leadName: '[Sandbox] Cliente OTC Banesco',
      requestedByRole: 'QUOTER',
      toolName: 'transition_pipeline_stage',
      actionType: 'P2P_SETTLEMENT_RELEASE',
      title: '[Sandbox] Liberación 1,200 USDT • Banesco Ref #8849201',
      agentReasoning: 'Comprobante leído por OCR sin colisión, retenido por regla anti-fraude antes de STAGE_4_CLOSED.',
      riskRuleTriggered: 'P2P_SETTLEMENT_REQUIRES_HUMAN_APPROVAL',
      proposedPayload: {
        referenceId: '8849201',
        amountUsdt: 1200,
        bank: 'Banesco',
      },
      confidenceScore: 96,
      priority: 'HIGH',
      status: 'PENDING',
      createdAt: now,
    };

    return {
      isSandbox: true,
      metaApiCostUsd: 0,
      workspaceId: 'P2P_DESK',
      personaId: params.personaId,
      simulatedInboundText: '📷 [Captura Pago Móvil Banesco Ref #8849201 por 45,000 VES — Libera los 1,200 USDT]',
      agentReplyText:
        'Recibimos tu comprobante Banesco (#8849201). Nuestro equipo de tesorería está validando el ingreso en cuenta para liberar tus USDT.',
      fromStageSlug: 'STAGE_2_TRANSIT',
      toStageSlug: 'STAGE_3_VERIFY',
      updatedScore: 95,
      toolTrace: [
        { agentRole: 'ROUTER', toolName: 'route_conversation', latencyMs: 38, outcome: 'target_role=QUOTER (PAYMENT_PROOF)' },
        { agentRole: 'QUOTER', toolName: 'transition_pipeline_stage', latencyMs: 64, outcome: 'Moved to STAGE_3_VERIFY • Blocked auto-close' },
      ],
      queuedApproval: approval,
    };
  }

  if (params.personaId === 'PYME_SPLIT_PAYMENT' || params.workspaceId === 'FINANCE_360') {
    const closerRes = processCloserPostCallNote({
      workspaceId: 'FINANCE_360',
      leadId: 'sbx-lead-360',
      leadName: '[Sandbox] Distribuidora Sol',
      voiceNoteTranscript: 'Quiere el servicio integral pero pagar en 2 partes 50/50',
      sku: 'PYME-SERV-360',
      nowMs: now,
    });

    return {
      isSandbox: true,
      metaApiCostUsd: 0,
      workspaceId: 'FINANCE_360',
      personaId: params.personaId,
      simulatedInboundText: '🎤 [Audio 0:32s]: "Nos interesa el paquete de $1,850 pero pagando 50% hoy y 50% a 30 días."',
      agentReplyText:
        'Entendido. Ya envié tu solicitud de esquema 50% anticipo / 50% a 30 días a administración para enviarte el presupuesto formal.',
      fromStageSlug: 'solicitud-360',
      toStageSlug: 'presupuestado-360',
      updatedScore: 86,
      toolTrace: [
        { agentRole: 'ROUTER', toolName: 'route_conversation', latencyMs: 35, outcome: 'target_role=QUOTER (PRICING_QUOTE)' },
        { agentRole: 'QUOTER', toolName: 'get_catalog_items', latencyMs: 22, outcome: 'SKU PYME-SERV-360 ($1,850 USD)' },
        { agentRole: 'QUOTER', toolName: 'create_or_submit_quote', latencyMs: 118, outcome: 'QUEUED_HITL (50/50 Split Terms)' },
      ],
      queuedApproval: closerRes.approvalEntry,
    };
  }

  // Default ARM_B2B simulation (Skeptical buyer asking 30% discount on Enterprise plan)
  const quoteRes = evaluateAndBuildArmQuote({
    workspaceId: 'ARM_B2B',
    leadId: 'sbx-lead-b2b',
    leadName: '[Sandbox] Clínica Aurora',
    items: [{ sku: 'PLAN-ENTERPRISE', qty: 1 }],
    discountPct: 30,
    validDays: 7,
    proposedWhatsappMessage:
      'Dra. Gómez, dirección comercial revisó su caso y autorizó el descuento corporativo para el Plan Enterprise.',
    nowMs: now,
  });

  return {
    isSandbox: true,
    metaApiCostUsd: 0,
    workspaceId: 'ARM_B2B',
    personaId: params.personaId,
    simulatedInboundText:
      'Soy el director de Clínica Aurora (20 médicos). Me interesa migrar esta semana, pero solo cierro si me das 30% de descuento en el Plan Enterprise.',
    agentReplyText:
      'Gracias por los detalles. Para 20 especialistas el Plan Enterprise encaja perfecto; ya escalé su solicitud de 30% de descuento a dirección comercial para confirmación final.',
    fromStageSlug: 'en-descubrimiento',
    toStageSlug: 'calificado',
    updatedScore: 95,
    toolTrace: [
      { agentRole: 'ROUTER', toolName: 'route_conversation', latencyMs: 42, outcome: 'target_role=SDR_QUALIFIER -> QUOTER' },
      { agentRole: 'SDR_QUALIFIER', toolName: 'update_lead_bant_and_profile', latencyMs: 115, outcome: 'Score @p2p/core = 95/100 (Calificado)' },
      { agentRole: 'SDR_QUALIFIER', toolName: 'transition_pipeline_stage', latencyMs: 48, outcome: 'en-descubrimiento -> calificado' },
      { agentRole: 'QUOTER', toolName: 'create_or_submit_quote', latencyMs: 160, outcome: 'BLOCKED_BY_RISK_GATE (30% > 0% & $1,680 > $1,500)' },
    ],
    queuedApproval: quoteRes.approvalEntry,
  };
}

// =============================================================================
// 11. COST CIRCUIT-BREAKER, DETERMINISTIC PROMPT A/B REPLAY & 15M PRE-CALL BRIEFING
// =============================================================================

export interface ArmTokenCircuitBreakerResult {
  workspaceId: ArmWorkspaceId;
  maxTokensPerDealDay: number;
  dailyTokensUsed: number;
  projectedTokensTotal: number;
  remainingTokens: number;
  utilizationPct: number;
  tripped: boolean;
  fallbackRole: 'HUMAN_TAKEOVER' | null;
  reason: string;
}

const DEFAULT_MAX_TOKENS_PER_DEAL_DAY: Record<ArmWorkspaceId, number> = {
  ARM_B2B: 45_000,
  P2P_DESK: 30_000,
  FINANCE_360: 35_000,
};

export function evaluateDealTokenCircuitBreaker(params: {
  workspaceId: ArmWorkspaceId;
  dailyTokensUsed: number;
  estimatedTurnTokens: number;
  customMaxTokensPerDealDay?: number;
}): ArmTokenCircuitBreakerResult {
  const maxTokens =
    params.customMaxTokensPerDealDay && params.customMaxTokensPerDealDay > 0
      ? params.customMaxTokensPerDealDay
      : DEFAULT_MAX_TOKENS_PER_DEAL_DAY[params.workspaceId];

  const used = Math.max(0, Math.floor(params.dailyTokensUsed || 0));
  const turn = Math.max(0, Math.floor(params.estimatedTurnTokens || 0));
  const projected = used + turn;
  const tripped = projected > maxTokens;
  const remainingTokens = tripped ? 0 : Math.max(0, maxTokens - projected);
  const utilizationPct = Math.min(100, Math.round((projected / maxTokens) * 100));

  return {
    workspaceId: params.workspaceId,
    maxTokensPerDealDay: maxTokens,
    dailyTokensUsed: used,
    projectedTokensTotal: projected,
    remainingTokens,
    utilizationPct,
    tripped,
    fallbackRole: tripped ? 'HUMAN_TAKEOVER' : null,
    reason: tripped
      ? `Circuit-Breaker activado en ${params.workspaceId}: ${projected} tokens supera el límite diario por trato (${maxTokens}). Derivado a HUMAN_TAKEOVER.`
      : `Presupuesto de tokens saludable (${utilizationPct}% utilizado; restan ${remainingTokens} tokens).`,
  };
}

export interface ArmReplayComparisonResult {
  workspaceId: ArmWorkspaceId;
  leadName: string;
  agentRole: ArmAgentRole;
  historicalInboundText: string;
  metaApiCostUsd: 0;
  baselineToolCall: {
    toolName: string;
    argsPreview: string;
    proposedReply: string;
  };
  candidateToolCall: {
    toolName: string;
    argsPreview: string;
    proposedReply: string;
    injectedFewShotCount: number;
  };
  diffSummary: string;
}

export function runArmDeterministicReplayComparison(params: {
  workspaceId: ArmWorkspaceId;
  leadName: string;
  historicalInboundText: string;
  shadowStore: ArmShadowExample[];
  agentRole?: ArmAgentRole;
}): ArmReplayComparisonResult {
  const preRoute = evaluateDeterministicPreRouter({
    workspaceId: params.workspaceId,
    conversationStatus: 'AUTOPILOT',
    currentStageSlug: 'calificado',
    bantData: {
      budget: 'Confirmado',
      authority: 'Decisor',
      need_pain_point: 'Automatización comercial',
      timeline: 'Esta semana',
    },
    messageText: params.historicalInboundText,
  });

  const resolvedRole: ArmAgentRole =
    params.agentRole ??
    (preRoute.targetRole === 'HUMAN_TAKEOVER' ? 'SDR_QUALIFIER' : preRoute.targetRole);

  const fewShots = selectFewShotExamplesForAgent(
    params.shadowStore,
    params.workspaceId,
    resolvedRole,
    3,
  );

  const toolName =
    resolvedRole === 'QUOTER'
      ? 'create_or_submit_quote'
      : resolvedRole === 'SCHEDULER'
        ? 'book_appointment'
        : 'update_lead_bant_and_profile';

  const baselineReply =
    resolvedRole === 'QUOTER'
      ? `Hola ${params.leadName}, te enviamos la cotización estándar con el precio de lista oficial.`
      : `Hola ${params.leadName}, tomamos nota de tus requerimientos para avanzar con la propuesta.`;

  const candidateReply =
    fewShots.length > 0
      ? `${fewShots[0].approvedText} (${params.leadName})`
      : `${baselineReply} [Optimizado con anclaje de valor ${params.workspaceId}]`;

  return {
    workspaceId: params.workspaceId,
    leadName: params.leadName,
    agentRole: resolvedRole,
    historicalInboundText: params.historicalInboundText,
    metaApiCostUsd: 0,
    baselineToolCall: {
      toolName,
      argsPreview: `role=${resolvedRole} • few_shot=0 • mode=BASELINE`,
      proposedReply: baselineReply,
    },
    candidateToolCall: {
      toolName,
      argsPreview: `role=${resolvedRole} • few_shot=${fewShots.length} • mode=SHADOW_CURATED`,
      proposedReply: candidateReply,
      injectedFewShotCount: fewShots.length,
    },
    diffSummary:
      fewShots.length > 0
        ? `El prompt candidato inyectó ${fewShots.length} corrección(es) de Shadow Learning de ${params.workspaceId}, adoptando tu estilo de cierre ejecutivo sin gastar saldo de Meta API.`
        : `Replay Dry-Run ejecutado en ${params.workspaceId} con 0 ejemplos Few-Shot previos; se recomienda curar una aprobación con [E] Editar + Shadow Learn.`,
  };
}

export interface ArmCloserPreCallBriefing {
  workspaceId: ArmWorkspaceId;
  leadName: string;
  companyName: string;
  startsInMinutes: number;
  qualificationScore: number;
  estimatedDealValue: number;
  bantSummary: string;
  keyObjectionsAndMemories: string[];
  recommendedClosingAngle: string;
  telegramMarkdownPayload: string;
}

export function generateCloserPreCallBriefing(params: {
  workspaceId: ArmWorkspaceId;
  leadName: string;
  companyName: string;
  startsInMinutes?: number;
  qualificationScore: number;
  bantData: ArmBantData;
  memoryFacts: string[];
  estimatedDealValue: number;
}): ArmCloserPreCallBriefing {
  const ws = ARM_WORKSPACES[params.workspaceId];
  const mins = params.startsInMinutes ?? 15;
  const bantSummary = [
    `Dolor: ${params.bantData.need_pain_point || 'Por confirmar'}`,
    `Autoridad: ${params.bantData.authority || 'Por confirmar'}`,
    `Presupuesto: ${params.bantData.budget || 'Por confirmar'}`,
    `Plazo: ${params.bantData.timeline || 'Por confirmar'}`,
  ].join(' | ');

  const recommendedClosingAngle =
    params.workspaceId === 'ARM_B2B'
      ? 'Anclar ROI frente al costo operativo manual y ofrecer esquema 50/50 solo si firma esta semana.'
      : params.workspaceId === 'P2P_DESK'
        ? 'Confirmar banco emisor, titularidad KYC y ventana de bloqueo de tasa de 15 minutos.'
        : 'Presentar servicio PyME 360 llave en mano con cronograma de entregables en 2 hitos.';

  const factsBullets =
    params.memoryFacts.length > 0
      ? params.memoryFacts.map((f) => `• ${f}`).join('\n')
      : '• Sin objeciones críticas registradas.';

  const telegramMarkdownPayload = [
    `🔔 *BRIEFING EJECUTIVO (${mins}m ANTES DE REUNIÓN)*`,
    `*Silo:* \`${params.workspaceId}\` (${ws.displayName})`,
    `*Prospecto:* ${params.companyName} — ${params.leadName}`,
    `*Score BANT:* \`${params.qualificationScore}/100\` • *Valor Est.:* $${params.estimatedDealValue} ${ws.defaultCurrency}`,
    `*Radiografía BANT:* ${bantSummary}`,
    `*Memoria Semántica:* \n${factsBullets}`,
    `*Ángulo de Cierre Sugerido:* ${recommendedClosingAngle}`,
  ].join('\n');

  return {
    workspaceId: params.workspaceId,
    leadName: params.leadName,
    companyName: params.companyName,
    startsInMinutes: mins,
    qualificationScore: params.qualificationScore,
    estimatedDealValue: params.estimatedDealValue,
    bantSummary,
    keyObjectionsAndMemories: params.memoryFacts,
    recommendedClosingAngle,
    telegramMarkdownPayload,
  };
}

// =============================================================================
// 12. UNIFIED TOOL RUNNER (EXECUTOR FOR THE 10 STRICT TOOL CONTRACTS) & LOCAL MIGRATOR
// =============================================================================

export interface ArmToolExecutionResult {
  ok: boolean;
  toolName: string;
  workspaceId: ArmWorkspaceId;
  errorCode?:
    | 'UNKNOWN_TOOL'
    | 'MISSING_REQUIRED_ARGUMENT'
    | 'STAGE_TRANSITION_REJECTED'
    | 'QUOTE_VALIDATION_ERROR';
  errorMessage?: string;
  updatedLead: ArmLeadProfile;
  assignedRole?: ArmAgentRole | 'HUMAN_TAKEOVER';
  approvalEntry?: ArmApprovalQueueItem;
  outboxPayload: Record<string, unknown>;
}

export function executeArmToolCall(params: {
  workspaceId: ArmWorkspaceId;
  toolName: string;
  args: Record<string, unknown>;
  lead: ArmLeadProfile;
  nowMs?: number;
}): ArmToolExecutionResult {
  const now = params.nowMs ?? Date.now();
  const contract = ARM_UNIFIED_TOOL_CONTRACTS.find(
    (c) => c.function.name === params.toolName,
  );

  if (!contract) {
    return {
      ok: false,
      toolName: params.toolName,
      workspaceId: params.workspaceId,
      errorCode: 'UNKNOWN_TOOL',
      errorMessage: `La herramienta '${params.toolName}' no existe en ARM_UNIFIED_TOOL_CONTRACTS.`,
      updatedLead: params.lead,
      outboxPayload: {},
    };
  }

  // Validate required top-level fields from the strict JSON Schema contract
  const requiredFields = contract.function.parameters.required || [];
  for (const reqKey of requiredFields) {
    const hasNestedWhatsappMsg =
      reqKey === 'proposed_whatsapp_message' &&
      typeof (params.args['approval_request_details'] as Record<string, unknown> | undefined)?.[
        'proposed_whatsapp_message'
      ] === 'string';
    if (!(reqKey in params.args) && !hasNestedWhatsappMsg) {
      return {
        ok: false,
        toolName: params.toolName,
        workspaceId: params.workspaceId,
        errorCode: 'MISSING_REQUIRED_ARGUMENT',
        errorMessage: `Falta el parámetro obligatorio '${reqKey}' en ${params.toolName}.`,
        updatedLead: params.lead,
        outboxPayload: {},
      };
    }
  }

  switch (params.toolName) {
    case 'route_conversation': {
      const targetRole = String(params.args['target_role']) as ArmAgentRole | 'HUMAN_TAKEOVER';
      return {
        ok: true,
        toolName: params.toolName,
        workspaceId: params.workspaceId,
        updatedLead: params.lead,
        assignedRole: targetRole,
        outboxPayload: {
          targetRole,
          detectedIntent: params.args['detected_intent'],
          sentiment: params.args['sentiment'],
          handoffContextNote: params.args['handoff_context_note'],
        },
      };
    }

    case 'update_lead_bant_and_profile': {
      const bantPatch = (params.args['bant_patch'] || {}) as ArmBantData;
      const merged = mergeBantAndLeadProfile(
        params.lead,
        {
          full_name: (params.args['full_name'] as string | null) ?? null,
          company_name: (params.args['company_name'] as string | null) ?? null,
          email: (params.args['email'] as string | null) ?? null,
          bant_patch: {
            budget: bantPatch.budget ?? null,
            authority: bantPatch.authority ?? null,
            need_pain_point: bantPatch.need_pain_point ?? null,
            timeline: bantPatch.timeline ?? null,
          },
          ai_executive_summary: String(params.args['ai_executive_summary'] || ''),
          estimated_deal_value: Number(params.args['estimated_deal_value'] || 0),
        },
        String(params.args['ai_executive_summary'] || ''),
      );
      return {
        ok: true,
        toolName: params.toolName,
        workspaceId: params.workspaceId,
        updatedLead: merged,
        outboxPayload: {
          leadId: merged.id,
          qualificationScore: merged.qualificationScore,
          isQualified: merged.isQualified,
          recommendedStageSlug: merged.recommendedStageSlug,
        },
      };
    }

    case 'transition_pipeline_stage': {
      const toStageSlug = String(params.args['to_stage_slug'] || '');
      const reasoning = String(params.args['reasoning'] || '');
      const check = validateArmStageTransition({
        workspaceId: params.workspaceId,
        fromStageSlug: params.lead.currentStageSlug,
        toStageSlug,
        triggeredByType: 'AGENT',
        reasoning,
      });

      if (!check.allowed) {
        return {
          ok: false,
          toolName: params.toolName,
          workspaceId: params.workspaceId,
          errorCode: 'STAGE_TRANSITION_REJECTED',
          errorMessage: check.reason,
          updatedLead: params.lead,
          outboxPayload: { rejectionCode: check.rejectionCode, reason: check.reason },
        };
      }

      const updatedLead: ArmLeadProfile = {
        ...params.lead,
        currentStageSlug: toStageSlug,
      };
      return {
        ok: true,
        toolName: params.toolName,
        workspaceId: params.workspaceId,
        updatedLead,
        outboxPayload: {
          fromStageSlug: params.lead.currentStageSlug,
          toStageSlug,
          reasoning,
        },
      };
    }

    case 'create_or_submit_quote': {
      try {
        const rawItems = (params.args['items'] as Array<{ sku: string; qty: number }>) || [];
        const details = params.args['approval_request_details'] as Record<string, unknown> | null;
        const quote = evaluateAndBuildArmQuote({
          workspaceId: params.workspaceId,
          leadId: params.lead.id,
          leadName: params.lead.fullName || params.lead.companyName || params.lead.id,
          items: rawItems,
          discountPct: Number(params.args['discount_pct'] || 0),
          validDays: Number(params.args['valid_days'] || 7),
          hasSpecialConditions: Boolean(params.args['has_special_conditions']),
          proposedWhatsappMessage: details
            ? String(details['proposed_whatsapp_message'] || '')
            : undefined,
          nowMs: now,
        });

        return {
          ok: true,
          toolName: params.toolName,
          workspaceId: params.workspaceId,
          updatedLead: {
            ...params.lead,
            estimatedDealValue: quote.totalAmount,
          },
          approvalEntry: quote.approvalEntry,
          outboxPayload: {
            quoteNumber: quote.quoteNumber,
            totalAmount: quote.totalAmount,
            requiresHumanApproval: quote.requiresHumanApproval,
            status: quote.status,
          },
        };
      } catch (err: unknown) {
        return {
          ok: false,
          toolName: params.toolName,
          workspaceId: params.workspaceId,
          errorCode: 'QUOTE_VALIDATION_ERROR',
          errorMessage: err instanceof Error ? err.message : 'Error al construir cotización',
          updatedLead: params.lead,
          outboxPayload: {},
        };
      }
    }

    default: {
      return {
        ok: true,
        toolName: params.toolName,
        workspaceId: params.workspaceId,
        updatedLead: params.lead,
        outboxPayload: {
          executedAt: now,
          args: params.args,
        },
      };
    }
  }
}

export interface MigratedArmKanbanCard {
  id: string;
  workspaceId: ArmWorkspaceId;
  leadName: string;
  companyName: string;
  stageSlug: string;
  qualificationScore: number;
  painPointSummary: string;
  lastMessagePreview: string;
  assignedAgentRole: ArmAgentRole;
  movedByAgentBadge: string;
  dealValueLabel: string;
  freeWindowLabel: string;
  messages: Array<{ sender: 'LEAD' | 'AGENT'; text: string; mediaBadge?: string }>;
  toolTraces: Array<{ toolName: string; latencyMs: number; status: string }>;
}

export function migrateLocalCrmDealsToArmCards(
  localDeals: ReadonlyArray<{
    id: string;
    scope: 'P2P_DESK' | 'FINANCE_360';
    title: string;
    contactName: string;
    bankName: string;
    stage: string;
    cryptoAmountUsdt: number;
    totalFiatAmount: number;
    fiatCurrency: string;
    bankReferenceId?: string;
  }>,
): MigratedArmKanbanCard[] {
  return localDeals.map((d) => {
    const workspaceId: ArmWorkspaceId = d.scope === 'FINANCE_360' ? 'FINANCE_360' : 'P2P_DESK';
    const stageSlug =
      workspaceId === 'FINANCE_360'
        ? d.stage === 'STAGE_4_CLOSED'
          ? 'pagado-360'
          : 'presupuestado-360'
        : d.stage;

    return {
      id: `local-${d.id}`,
      workspaceId,
      leadName: d.contactName,
      companyName: d.bankName || d.title,
      stageSlug,
      qualificationScore: 88,
      painPointSummary: d.title,
      lastMessagePreview: d.bankReferenceId
        ? `Ref Bancaria #${d.bankReferenceId} • ${d.totalFiatAmount} ${d.fiatCurrency}`
        : `Operación local sincronizada (${d.cryptoAmountUsdt} USDT)`,
      assignedAgentRole: 'QUOTER',
      movedByAgentBadge: `Sincronizado Local (${workspaceId})`,
      dealValueLabel: `${d.cryptoAmountUsdt} USDT`,
      freeWindowLabel: 'FREE_0_USD • Activo',
      messages: [
        {
          sender: 'LEAD',
          text: `${d.title} — ${d.totalFiatAmount} ${d.fiatCurrency}`,
        },
      ],
      toolTraces: [
        {
          toolName: 'migrateLocalCrmDealsToArmCards',
          latencyMs: 4,
          status: `OK → ${workspaceId} (${stageSlug})`,
        },
      ],
    };
  });
}


