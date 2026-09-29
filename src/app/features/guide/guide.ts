import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { McpService } from '../../core/mcp.service';

export type GuideTab = 'intro' | 'tools' | 'mcp' | 'swarm' | 'security' | 'workflow' | 'terms';

export interface DeskModuleGuide {
  id: string;
  name: string;
  route: string;
  icon: string;
  category: string;
  badge?: string;
  tagline: string;
  whyItMatters: string;
  stepByStep: string[];
  keyInputs: string[];
  keyOutputs: string[];
  commonMistakes: string;
  proTip: string;
}

export interface SwarmAgentGuide {
  id: string;
  /** Maps to the `.sentinel` / `.strategist` / `.risk` / `.dispute` theme class. */
  theme: string;
  avatar: string;
  roleBadge: string;
  name: string;
  quote: string;
  summary: string;
  /** `serverId` must be a real catalog server id, so the card cannot name a phantom. */
  skills: { serverId: string; detail: string }[];
}

export interface McpToolGuide {
  name: string;
  description: string;
  params: string;
  returns: string;
  useCase: string;
}

/**
 * Curated narrative for one MCP server.
 *
 * The shared catalog (`core/mcp/mcp-catalog.ts`) only carries `name` +
 * `description` per tool, so `params` / `returns` / `useCase` exist nowhere
 * else and live here. A server listed in this array is documented in depth; a
 * server that is absent is still shown by the Guide, but only as a catalog
 * listing. That distinction is rendered on screen, never implied.
 */
export interface McpServerGuide {
  id: string;
  name: string;
  category: string;
  icon: string;
  purpose: string;
  howItWorks: string;
  tools: McpToolGuide[];
}

/** One tool row in the MCP tab, merged from the catalog and the curated guide. */
export interface McpToolView {
  name: string;
  description: string;
  params: string | null;
  returns: string | null;
  useCase: string | null;
  /** True when this tool has a full ficha (params/returns/use case) in the guide. */
  isDocumented: boolean;
}

/** One server row in the MCP tab. Existence and counts come from the catalog. */
export interface McpServerView {
  id: string;
  name: string;
  icon: string;
  category: string;
  transport: string;
  status: string;
  /** Tool count reported by the runtime/catalog. Never a literal. */
  toolCount: number;
  resourceCount: number;
  /** How many of this server's tools carry an in-depth ficha in this guide. */
  documentedToolCount: number;
  /** True when the guide has a purpose + mechanics narrative for this server. */
  hasNarrative: boolean;
  purpose: string | null;
  howItWorks: string | null;
  tools: McpToolView[];
}

export interface InteractiveHelpScenario {
  id: string;
  question: string;
  icon: string;
  toolRoute: string;
  toolName: string;
  mcpServer: string;
  mcpTool: string;
  solution: string;
  steps: string[];
}

@Component({
  selector: 'app-guide',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './guide.html',
  styleUrl: './guide.scss',
})
export class Guide {
  readonly mcp = inject(McpService);

  readonly activeTab = signal<GuideTab>('intro');
  readonly searchQuery = signal<string>('');

  // ─── Derived counts ────────────────────────────────────────────────────────
  //
  // Every number the Guide shows the operator is read from a signal here, never
  // typed into a template. The MCP ones are the exact same reads the sibling
  // `/mcp` page performs on `McpService`, so both pages cannot disagree: change
  // the shared catalog or ship a tool and both follow on the next render.
  readonly deskModuleCount = computed(() => this.deskModuleDocs.length);
  readonly swarmAgentCount = computed(() => this.swarmAgentViews().length);
  readonly mcpServerCount = computed(() => this.mcp.servers().length);
  readonly mcpOnlineServerCount = computed(() => this.mcp.onlineCount());
  readonly mcpToolCount = computed(() => this.mcp.totalToolsCount());
  readonly mcpDocumentedServerCount = computed(
    () => this.mcpServerViews().filter((s) => s.hasNarrative).length,
  );
  readonly mcpDocumentedToolCount = computed(() =>
    this.mcpServerViews().reduce((acc, s) => acc + s.documentedToolCount, 0),
  );

  readonly tabs = computed<{ id: GuideTab; label: string; icon: string; badge: string }[]>(() => [
    { id: 'intro', label: '1. P2P Desde Cero', icon: '📚', badge: 'Fundamentos' },
    { id: 'tools', label: '2. Herramientas del Desk', icon: '🛠️', badge: `${this.deskModuleCount()} Módulos` },
    { id: 'mcp', label: '3. Servidores MCP', icon: '🔌', badge: `${this.mcpServerCount()} Dominios / ${this.mcpToolCount()} Tools` },
    { id: 'swarm', label: '4. Enjambre Multi-Agente', icon: '🤖', badge: `${this.swarmAgentCount()} Agentes` },
    { id: 'security', label: '5. Blindaje Bancario & SUDEBAN', icon: '🛡️', badge: 'Seguridad' },
    { id: 'workflow', label: '6. Checklist Paso a Paso', icon: '🎯', badge: 'Rutina SOP' },
    { id: 'terms', label: '7. Términos & Privacidad', icon: '⚖️', badge: 'Legal' },
  ]);

  // =========================================================================
  // SIMULADOR INTERACTIVO DE SPREAD BRUTO VS NETO (Pestaña Intro)
  // =========================================================================
  readonly calcBuyPrice = signal<number>(88.5);
  readonly calcSellPrice = signal<number>(90.0);
  readonly applyMakerFee = signal<boolean>(true);
  readonly applyBankFee = signal<boolean>(true);

  readonly calcGrossSpread = computed(() => {
    const buy = this.calcBuyPrice();
    const sell = this.calcSellPrice();
    if (buy <= 0 || sell <= 0) return 0;
    return ((sell - buy) / buy) * 100;
  });

  readonly calcTotalFeePct = computed(() => {
    let fee = 0;
    if (this.applyMakerFee()) fee += 0.25; // Binance Maker Fee
    if (this.applyBankFee()) fee += 0.3; // Fricción Pago Móvil (0.30%)
    return fee;
  });

  readonly calcNetSpread = computed(() => {
    return this.calcGrossSpread() - this.calcTotalFeePct();
  });

  readonly isGoldenRuleMet = computed(() => {
    return this.calcNetSpread() >= 0.5;
  });

  // =========================================================================
  // HERRAMIENTAS DEL DESK (módulos del Desk)
  // =========================================================================
  //
  // `deskModuleDocs` is the hand-written source of truth for the module list.
  // The mcp-hub entry intentionally carries no literal counts: its badge,
  // tagline and first step are rewritten below from the live McpService
  // signals, so a new tool or server can never leave the copy lying again.
  readonly selectedToolId = signal<string>('spread');

  readonly deskModuleDocs: DeskModuleGuide[] = [
    {
      id: 'dashboard',
      name: 'Dashboard Central',
      route: '/dashboard',
      icon: '📊',
      category: 'Control Maestro',
      badge: 'Kill-Switch',
      tagline: 'Centro de comando con visión situacional instantánea y parada de emergencia.',
      whyItMatters:
        'En los mercados de alta volatilidad no puedes perder tiempo navegando menús. El Dashboard sintetiza tu capital expuesto en bolívares, el estado macro del BCV y te da acceso al Kill-Switch de un solo clic.',
      stepByStep: [
        'Inspecciona el indicador de Kill-Switch: debe estar en estado ARMADO (verde).',
        'Revisa el widget de alerta macro del BCV y la brecha cambiaria en tiempo real.',
        'Observa la distribución de inventario fiduciario vs cripto antes de iniciar la jornada.',
      ],
      keyInputs: ['Monitoreo pasivo (consume telemetría interna y cotizaciones de mercado).'],
      keyOutputs: ['Nivel de riesgo general', 'Capital en riesgo', 'Botón de parada de emergencia global'],
      commonMistakes:
        'Ignorar el Kill-Switch cuando se reporta una caída bancaria masiva (ej. Banesco o BDV fuera de servicio).',
      proTip: 'Usa el atajo Esc en cualquier pantalla de escritorio para disparar el Kill-Switch inmediato.',
    },
    {
      id: 'spread',
      name: 'Monitor de Spread',
      route: '/spread',
      icon: '📈',
      category: 'Motor Cuantitativo',
      badge: 'SQS & Libros',
      tagline: 'Radar en vivo de libros de compra y venta con cálculo de margen neto real.',
      whyItMatters:
        'Calcular mal el margen significa regalar dinero a comisiones o quedar atrapado con bolívares que se devalúan. El monitor analiza la profundidad de Binance y calcula el Spread Quality Score (SQS).',
      stepByStep: [
        'Ingresa tu precio objetivo de compra y venta para anuncios Maker.',
        'Observa el cálculo automático de comisiones Binance (0.25%) y fricción bancaria.',
        'Verifica que el Spread Neto supere el 0.50% (Regla de Oro institucional).',
        'Revisa el puntaje SQS (> 65 puntos) antes de publicar en el libro de Binance.',
      ],
      keyInputs: ['Precio de compra (VES/USDT)', 'Precio de venta (VES/USDT)', 'Volumen por ciclo'],
      keyOutputs: ['Spread Bruto (%)', 'Spread Neto (%)', 'Punto de equilibrio', 'Puntaje SQS (0-100)'],
      commonMistakes:
        'Fijarse solo en la diferencia nominal sin deducir el 0.30% del Pago Móvil interbancario.',
      proTip: 'Presiona F2 en el escritorio para sincronizar instantáneamente el radar con el libro de Binance.',
    },
    {
      id: 'income',
      name: 'Calculadora de Ingresos',
      route: '/income',
      icon: '🧮',
      category: 'Planificación Financiera',
      badge: 'Rotación APR',
      tagline: 'Planificación de metas diarias en USD, capital necesario y velocidad de rotación.',
      whyItMatters:
        'El trading P2P profesional se basa en la velocidad de rotación, no en márgenes abusivos. Esta herramienta te dice cuántas veces debes rotar tu dinero para lograr tu meta mensual.',
      stepByStep: [
        'Define tu meta de ganancia diaria en dólares (ej. $30 USD/día).',
        'Ingresa tu capital de trabajo disponible (ej. $1,000 USDT).',
        'Ajusta tu margen neto promedio esperado (ej. 0.80%).',
        'La calculadora proyecta cuántos ciclos de compra-venta debes completar por día.',
      ],
      keyInputs: ['Meta diaria ($)', 'Capital disponible ($)', 'Margen neto estimado (%)'],
      keyOutputs: ['Rotaciones diarias necesarias', 'Volumen transaccional requerido', 'Proyección mensual y APR'],
      commonMistakes:
        'Querer ganar $100 diarios con solo $200 de capital sin entender que exigiría 50 rotaciones al día.',
      proTip: 'Rotar $1,000 USDT 3 veces al día al 0.8% neto produce $24 diarios ($720/mes) con riesgo controlado.',
    },
    {
      id: 'triangulation',
      name: 'Triangulación Multidivisa',
      route: '/triangulation',
      icon: '🔄',
      category: 'Arbitraje de Divisas',
      badge: 'Cotizave & Pares',
      tagline: 'Detección de arbitraje entre cotizaciones paralelas, oficiales y divisas cruzadas.',
      whyItMatters:
        'Cuando el dólar oficial y el paralelo divergen, surgen ineficiencias de precio explotables comprando en un par y vendiendo en otro (VES -> USDT -> COP o EUR -> VES).',
      stepByStep: [
        'Consulta el alimentador en vivo de Cotizave y tasas BCV.',
        'Compara la brecha porcentual entre la tasa oficial y las plataformas P2P.',
        'Identifica oportunidades de triangulación cuando la brecha supere el 15%.',
      ],
      keyInputs: ['Tasas oficiales BCV', 'Cotizaciones P2P Binance', 'Tasas cruzadas COP/EUR'],
      keyOutputs: ['Brecha cambiaria (%)', 'Ruta triangular más rentable', 'Margen neto del tramo'],
      commonMistakes:
        'No considerar el tiempo que tarda la liquidación entre diferentes monedas o bancos.',
      proTip: 'Las mañanas de intervención bancaria del BCV suelen crear los spreads triangulares más jugosos.',
    },
    {
      id: 'remittances',
      name: 'Cotizador Comercial de Remesas',
      route: '/remittances',
      icon: '💸',
      category: 'Negocio Cambiario',
      badge: 'Comercial & Delivery',
      tagline: 'Cotizaciones instantáneas para remesas familiares y comerciales con spread protegido.',
      whyItMatters:
        'Muchos operadores complementan el P2P atendiendo remesas directas desde Colombia, Chile, España o EE.UU. Este cotizador calcula comisiones de pasarela y monto neto exacto a despachar.',
      stepByStep: [
        'Selecciona el país o moneda de origen (COP, CLP, EUR, USD Zelle/PayPal).',
        'Ingresa el monto enviado por el cliente.',
        'Aplica el margen comercial de tu mesa (ej. 2.5% a 4.0%).',
        'El sistema desglosa comisiones de envío, costo de despacho y monto final en Pago Móvil.',
      ],
      keyInputs: ['Monto origen', 'Moneda/Pasarela', 'Margen comercial', 'Costo de transferencia bancaria'],
      keyOutputs: ['Bolívares a transferir', 'Ganancia neta en USD', 'Resumen listo para compartir al cliente'],
      commonMistakes:
        'Olvidar la comisión que cobra la pasarela receptora (ej. PayPal cobra 5.4% + comisión fija).',
      proTip: 'Copia el desglose transparente generado con un clic y envíaselo al cliente por WhatsApp.',
    },
    {
      id: 'copilot',
      name: 'Copiloto Estratega IA',
      route: '/copilot',
      icon: '🤖',
      category: 'Inteligencia Artificial',
      badge: 'SOP & Prompting',
      tagline: 'Asistente senior para consultar dudas tácticas, redactar apelaciones y generar SOPs.',
      whyItMatters:
        'Tener un arquitecto cuantitativo sentado a tu lado. Le preguntas en lenguaje natural sobre regímenes de volatilidad o cómo proceder ante un usuario sospechoso y te da un plan estructurado.',
      stepByStep: [
        'Escribe tu consulta en lenguaje natural o presiona un prompt sugerido.',
        'El copiloto consulta las herramientas MCP y el estado actual de tus libros.',
        'Recibe una directiva táctica ejecutiva con pasos numerados y advertencias de riesgo.',
      ],
      keyInputs: ['Preguntas de mercado', 'Dudas operativas', 'Contexto de disputas'],
      keyOutputs: ['Planes de acción SOP', 'Directivas de fijación de precios', 'Memoria táctica'],
      commonMistakes:
        'Esperar que el copiloto opere por ti; recuerda que es un asesor consultivo, tú tienes el control.',
      proTip: 'Pídele que redacte tu texto de apelación en Binance si un usuario marca pagado sin enviar dinero.',
    },
    {
      id: 'receipts',
      name: 'Escáner Forense de Comprobantes',
      route: '/receipts',
      icon: '🔍',
      category: 'Seguridad Antifraude',
      badge: 'OCR Tesseract',
      tagline: 'Peritaje óptico de capturas de Pago Móvil para erradicar estafas de triangulación.',
      whyItMatters:
        'La estafa #1 en Venezuela es la falsificación digital de comprobantes y la triangulación de pagos de terceros. El escáner lee con OCR la cédula, monto y referencia directamente de la imagen.',
      stepByStep: [
        'Arrastra o sube la captura de pantalla que te envió la contraparte por el chat de Binance.',
        'El motor OCR extrae texto: Banco emisor, Cédula del pagador, Monto en Bs y Referencia.',
        'El sistema coteja que la cédula coincida con el nombre verificado de Binance.',
        'Verifica en tu app bancaria que el dinero esté efectivamente en saldo disponible.',
      ],
      keyInputs: ['Imagen JPG/PNG de captura bancaria', 'Cédula/Nombre verificado en Binance'],
      keyOutputs: ['Datos extraídos OCR', 'Veredicto de concordancia (MATCH / FRAUDE)', 'Hash criptográfico SHA-256'],
      commonMistakes:
        'Liberar criptomonedas confiando únicamente en la captura sin revisar la cuenta bancaria propia.',
      proTip: 'Si el nombre del comprobante no coincide con Binance, rechaza el pago y abre apelación de inmediato.',
    },
    {
      id: 'log',
      name: 'Registro Contable (Ledger)',
      route: '/log',
      icon: '📑',
      category: 'Contabilidad y Auditoría',
      badge: 'PnL Real',
      tagline: 'Libro mayor de operaciones completadas con deducción automática de fricciones.',
      whyItMatters:
        'Lo que no se mide no se puede mejorar. Cada trade debe registrarse con sus costos exactos para saber tu ganancia real neta al final del día y cumplir con la contabilidad.',
      stepByStep: [
        'Al cerrar una orden en Binance, registra la compra o venta en el Ledger.',
        'El sistema computa el PnL neto en USD y en VES, descontando fees bancarios.',
        'Filtra por fecha o contraparte para auditar tu rendimiento semanal.',
        'Exporta tu respaldo JSON o sincroniza con Google Sheets periódicamente.',
      ],
      keyInputs: ['Tipo (Compra/Venta)', 'Monto USDT', 'Tasa ejecutada', 'Banco utilizado', 'Contraparte'],
      keyOutputs: ['PnL Neto por orden', 'Ganancia acumulada del día', 'Histórico auditable'],
      commonMistakes:
        'Dejar el registro para el final de la semana; anota cada trade en caliente para no olvidar referencias.',
      proTip: 'Puedes usar el botón de exportación para guardar un backup de tu base contable en un pendrive.',
    },
    {
      id: 'risk',
      name: 'Reglas de Riesgo Institucional',
      route: '/risk',
      icon: '⚖️',
      category: 'Gobernanza Financiera',
      badge: 'ALLOW / DENY',
      tagline: '6 barreras automáticas que impiden operar cuando el riesgo supera tu tolerancia.',
      whyItMatters:
        'El peor enemigo del trader es la emoción (codicia o revancha tras perder). El motor de riesgo impone reglas inquebrantables: spread mínimo, pérdida diaria máxima y límite de exposición.',
      stepByStep: [
        'Configura tu spread neto mínimo tolerable (mínimo recomendado: 0.50%).',
        'Establece tu límite de pérdida diaria máxima permitida (ej. $50 USD).',
        'Define el máximo de órdenes consecutivas negativas antes del bloqueo de descanso.',
        'Si una orden viola las políticas, el sistema emite veredicto DENY o PAUSE.',
      ],
      keyInputs: ['Parámetros de tolerancia al riesgo de tu mesa'],
      keyOutputs: ['Veredicto (ALLOW / PAUSE / DENY)', 'Alertas de violación de límites', 'Protección de drawdown'],
      commonMistakes:
        'Aumentar los límites de riesgo cuando vas perdiendo para "recuperar rápido" (típica conducta de ludopatía).',
      proTip: 'Respeta las órdenes de PAUSA; cuando el mercado entra en pánico es mejor apagar la pantalla 1 hora.',
    },
    {
      id: 'stats',
      name: 'Estadísticas & Métricas',
      route: '/stats',
      icon: '📉',
      category: 'Analítica Cuantitativa',
      badge: 'KPIs & Ratios',
      tagline: 'Análisis de rendimiento histórico, tasa de acierto, comisiones acumuladas y volumen.',
      whyItMatters:
        'Permite entender tus patrones: qué días de la semana ganas más, con qué bancos tienes menos incidencias y cuál es tu verdadero margen neto después de comisiones.',
      stepByStep: [
        'Revisa el gráfico de PnL acumulado diario y mensual.',
        'Inspecciona el desglose de volumen por moneda y banco (Banesco vs Mercantil vs BDV).',
        'Analiza la relación entre comisiones pagadas y ganancia neta obtenida.',
      ],
      keyInputs: ['Historial consolidado del Registro de Operaciones'],
      keyOutputs: ['Tasa de acierto (Win Rate)', 'Sharpe Ratio estimado', 'Total fees pagados'],
      commonMistakes:
        'Celebrar un volumen transaccionado alto si el margen neto resultante fue insignificante.',
      proTip: 'Un operador profesional busca maximizar el margen por hora trabajada, no mover volumen por vanidad.',
    },
    {
      id: 'mcp-hub',
      name: 'Centro de Servidores MCP',
      route: '/mcp',
      icon: '🔌',
      category: 'Suite de Conectores',
      badge: '',
      tagline: '',
      whyItMatters:
        'Es el corazón de interoperabilidad del sistema. Permite a agentes de IA y entornos como Antigravity o Claude invocar herramientas deterministas en tu PC sin tocar tus fondos.',
      stepByStep: [
        '',
        'Explora las herramientas disponibles y prueba argumentos en el Playground JSON.',
        'Copia los snippets de configuración para integrarlos en tu IDE o agente.',
        'Audita el log de llamadas y telemetría de ejecución en tiempo real.',
      ],
      keyInputs: ['Llamadas JSON-RPC de clientes MCP o pruebas manuales en UI'],
      keyOutputs: ['Estado de conectores', 'Tiempo de respuesta en milisegundos', 'Telemetría de auditoría'],
      commonMistakes:
        'Pensar que el MCP transfiere dinero; todas las herramientas de escritura son estrictamente Human-in-the-Loop.',
      proTip: 'Puedes probar la herramienta calculate_spread directamente desde el playground para validar precios.',
    },
  ];

  /**
   * Module view: the hand-written docs with the MCP module's volatile copy
   * resolved against the live service. Only the mcp-hub entry is rewritten —
   * every other module is static by nature and keeps its literal text.
   */
  readonly deskModules = computed<DeskModuleGuide[]>(() =>
    this.deskModuleDocs.map((doc) => {
      if (doc.id !== 'mcp-hub') return doc;
      return {
        ...doc,
        badge: `${this.mcpServerCount()} Servidores`,
        tagline: `Panel de supervisión, catálogo de ${this.mcpToolCount()} tools, ejecutor de pruebas y playground JSON.`,
        stepByStep: doc.stepByStep.map((step, i) =>
          i === 0
            ? `Verifica que los ${this.mcpOnlineServerCount()} servidores MCP en línea estén en estado ONLINE.`
            : step,
        ),
      };
    }),
  );

  readonly activeToolGuide = computed(() => {
    return this.deskModules().find((m) => m.id === this.selectedToolId()) || this.deskModules()[1];
  });

  // =========================================================================
  // ENJAMBRE MULTI-AGENTE (SWARM AI)
  // =========================================================================
  //
  // The dossier is data, not markup, so the "N agentes" claim in the tab badge
  // and in the lead paragraph is `swarmAgentViews().length` — the number of
  // agents that still have at least one live MCP server behind them.
  readonly swarmAgents: SwarmAgentGuide[] = [
    {
      id: 'sentinel',
      theme: 'sentinel',
      avatar: '🛡️',
      roleBadge: 'Vigía 24/7',
      name: 'Agente Centinela',
      quote: '"Monitoreo incansable de la microestructura a costo cero de tokens."',
      summary:
        'Vigila en tiempo real los libros de órdenes, la brecha cambiaria oficial del BCV y la latencia de acreditación en la banca venezolana antes de que comiences a operar.',
      skills: [
        { serverId: 'p2p-macro-predictor', detail: 'Tasas BCV y brecha oficial/paralelo.' },
        { serverId: 'p2p-bank-sentinel', detail: 'Estado de Pago Móvil y bancos.' },
        { serverId: 'p2p-multi-exchange', detail: 'Libros en vivo y detección de depeg.' },
      ],
    },
    {
      id: 'strategist',
      theme: 'strategist',
      avatar: '🧠',
      roleBadge: 'Estratega Cuántico',
      name: 'Agente Estratega',
      quote: '"Concepts > Code: Preservación de capital y optimización de rutas."',
      summary:
        'Modela rutas de arbitraje triangular (VES → USDT → BTC → VES), calcula el precio medio ponderado por volumen (VWAP) y simula el deslizamiento en cola para maximizar la velocidad de rotación de tu capital.',
      skills: [
        { serverId: 'p2p-decisor', detail: 'Triangulación y márgenes netos.' },
        { serverId: 'p2p-multi-exchange', detail: 'Modelo de precios Avellaneda-Stoikov.' },
        { serverId: 'p2p-portfolio-risk', detail: 'Proyecciones de interés compuesto.' },
      ],
    },
    {
      id: 'risk',
      theme: 'risk',
      avatar: '🛑',
      roleBadge: 'Veto Innegociable',
      name: 'Oficial de Riesgo',
      quote: '"Poder de veto unilateral para blindar el patrimonio."',
      summary:
        'Guardián estricto de la política institucional. Aplica la Regla de Oro (margen neto ≥ 0.50%). Si una propuesta viola los límites de SUDEBAN, o si la contraparte está marcada por triangulación, veta la orden de inmediato.',
      skills: [
        { serverId: 'p2p-aml-forensics', detail: 'Blacklists de cédulas y screening crypto.' },
        { serverId: 'p2p-portfolio-risk', detail: 'Delta neutral y Criterio de Kelly.' },
        { serverId: 'p2p-sudeban-radar', detail: 'Control de saturación bancaria.' },
      ],
    },
    {
      id: 'dispute',
      theme: 'dispute',
      avatar: '🔍',
      roleBadge: 'Perito Forense',
      name: 'Auditor de Disputas',
      quote: '"Pruebas técnicas irrefutables con sellado criptográfico."',
      summary:
        'Interviene cuando surge una discordancia de pago. Analiza los metadatos de la captura bancaria con OCR y construye un expediente formal con hash SHA-256 en español e inglés para ganar apelaciones en Binance.',
      skills: [
        { serverId: 'p2p-dispute-dossier', detail: 'Expediente arbitral en PDF.' },
        { serverId: 'p2p-bank-sentinel', detail: 'Peritaje OCR anti-triangulación.' },
        { serverId: 'p2p-google-workspace', detail: 'Sincronización de evidencias en la nube.' },
      ],
    },
  ];

  /**
   * Agents whose backing MCP servers are all still live. A skill pointing at a
   * server that left the catalog is dropped instead of being advertised, and an
   * agent left with no live skill stops being counted as an agent at all.
   */
  readonly swarmAgentViews = computed(() => {
    const liveServerIds = new Set(this.mcpServerViews().map((s) => s.id));
    return this.swarmAgents
      .map((agent) => ({
        ...agent,
        skills: agent.skills.filter((s) => liveServerIds.has(s.serverId)),
      }))
      .filter((agent) => agent.skills.length > 0);
  });

  // =========================================================================
  // SERVIDORES MCP: GUÍA EN PROFUNDIDAD + CATÁLOGO EN VIVO
  // =========================================================================
  //
  // Durable rule for this tab: the shared catalog decides *what exists*, the
  // curated guide below only decides *what is explained in depth*. Rendering is
  // driven by the merge in `mcpServerViews`, never by hand-written totals.
  readonly selectedMcpCategory = signal<string>('all');
  readonly selectedMcpServerId = signal<string>('p2p-decisor');

  /**
   * In-depth documentation. Keys must match catalog server ids and catalog tool
   * names — `mcpServerViews` joins on them and silently drops anything that no
   * longer exists, so dead documentation cannot be shown as a live capability.
   */
  readonly mcpServersGuideDetailed: McpServerGuide[] = [
    {
      id: 'p2p-decisor',
      name: 'P2P Decisor — Gateway Maestro',
      category: 'master',
      icon: '👑',
      purpose:
        'Servidor maestro que concentra las funciones nucleares de cálculo de márgenes, evaluación de riesgo de operaciones y control de parada de emergencia.',
      howItWorks:
        'Actúa como el árbitro central. Cuando un agente de IA propone una orden, este servidor evalúa los precios, deduce comisiones fijas y porcentuales, y rechaza cualquier operación que no cumpla la Regla de Oro (margen >= 0.50%).',
      tools: [
        {
          name: 'calculate_spread',
          description: 'Calcula el spread bruto, deducción de comisiones Binance y banco, y margen neto real.',
          params: '{ buyPrice: number, sellPrice: number, makerFeePct?: number, bankFeePct?: number }',
          returns: '{ grossSpreadPct: number, netSpreadPct: number, isProfitable: boolean, breakevenSell: number }',
          useCase: 'Llamado antes de abrir cualquier anuncio para asegurar rentabilidad real.',
        },
        {
          name: 'evaluate_trade_risk',
          description: 'Evalúa una propuesta de trade frente a las 6 políticas institucionales inquebrantables.',
          params: '{ tradeAmountUsdt: number, proposedNetSpread: number, currentLossTodayUsdt: number }',
          returns: '{ verdict: "ALLOW" | "PAUSE" | "DENY", reason: string, riskScore: number }',
          useCase: 'Veta trades impulsivos o que sobrepasen el drawdown diario.',
        },
        {
          name: 'trigger_killswitch',
          description: 'Detiene inmediatamente todas las operaciones y activa el modo seguro.',
          params: '{ reason: string, operatorId?: string }',
          returns: '{ status: "HALTED", timestamp: string, affectedBots: number }',
          useCase: 'Emergencia bancaria o caída abrupta de conectividad.',
        },
        {
          name: 'simulate_trade_impact',
          description: 'Simula el impacto de una orden en la liquidez disponible y en el cupo bancario diario.',
          params: '{ bankCode: string, amountVes: number }',
          returns: '{ newSaturationPct: number, exceedsDailyThreshold: boolean }',
          useCase: 'Evita saturar una cuenta con transferencias muy seguidas.',
        },
      ],
    },
    {
      id: 'p2p-macro-predictor',
      name: 'Monitor Macro & Dólar Venezuela',
      category: 'tasas',
      icon: '🇻🇪',
      purpose:
        'Monitorea la cotización del Banco Central de Venezuela (BCV), los índices paralelos y la brecha cambiaria.',
      howItWorks:
        'Extrae cotizaciones oficiales y calcula el diferencial porcentual. Conoce los horarios de intervención bancaria del BCV (09:00 a 13:00 VET) para anticipar momentos de alta volatilidad.',
      tools: [
        {
          name: 'get_bcv_rates',
          description: 'Retorna las tasas oficiales del BCV (USD, EUR) y la fecha de valor vigente.',
          params: '{}',
          returns: '{ usdRate: number, eurRate: number, valueDate: string }',
          useCase: 'Base de comparación para arbitraje oficial vs paralelo.',
        },
        {
          name: 'calculate_rate_gap',
          description: 'Calcula la brecha cambiaria entre la tasa oficial BCV y el promedio P2P Binance.',
          params: '{ p2pRate: number, bcvRate?: number }',
          returns: '{ gapPercentage: number, riskLevel: "BAJO" | "MEDIO" | "CRITICO" }',
          useCase: 'Alerta cuando la brecha supera el 20%, señal de devaluación inminente.',
        },
        {
          name: 'check_bcv_intervention_window',
          description: 'Verifica si el mercado está dentro del horario crítico de inyección de divisas del BCV.',
          params: '{}',
          returns: '{ isInterventionWindow: boolean, currentHourVet: number, directive: string }',
          useCase: 'Ajusta la velocidad de rotación durante las mañanas de subasta.',
        },
      ],
    },
    {
      id: 'p2p-multi-exchange',
      name: 'Multi-Exchange P2P & Microestructura',
      category: 'mercado',
      icon: '🌐',
      purpose:
        'Inspecciona libros de órdenes en tiempo real entre múltiples exchanges (Binance, Bybit, OKX, KuCoin).',
      howItWorks:
        'Analiza la profundidad de mercado, detecta si USDT pierde su paridad de $1.00 USD (depeg) y recomienda el precio exacto para posicionar tu anuncio entre los primeros 3 lugares con margen seguro.',
      tools: [
        {
          name: 'get_binance_p2p_orderbook',
          description: 'Obtiene las mejores 10 ofertas de compra y venta del libro P2P Binance en VES.',
          params: '{ asset: "USDT", fiat: "VES", tradeType: "BUY" | "SELL" }',
          returns: '{ bestPrice: number, top5Average: number, totalVolumeAvailable: number }',
          useCase: 'Conocer la competencia exacta antes de publicar precio.',
        },
        {
          name: 'recommend_competitive_pricing',
          description: 'Recomienda el precio óptimo Maker para maximizar velocidad de venta sin perder margen.',
          params: '{ targetMarginPct: number, costBasis: number }',
          returns: '{ suggestedPrice: number, rankPosition: number, expectedClearanceMinutes: number }',
          useCase: 'Garantiza vender rápido sin participar en guerras de precios absurdas.',
        },
        {
          name: 'detect_usdt_depeg',
          description: 'Monitorea si el valor internacional de USDT se desvía del dólar (< 0.998 o > 1.002).',
          params: '{}',
          returns: '{ isDepegDetected: boolean, currentUsdtUsd: number, alertLevel: string }',
          useCase: 'Evita comprar USDT si la moneda estable tiene problemas de solvencia.',
        },
      ],
    },
    {
      id: 'p2p-bank-sentinel',
      name: 'Conciliación Bancaria & Webhook',
      category: 'bancos',
      icon: '🏦',
      purpose:
        'Supervisa el estado de la banca venezolana (Banesco, Mercantil, BDV) y concilia pagos entrantes.',
      howItWorks:
        'Monitorea la latencia de acreditación de Pago Móvil y transferencias. Si un banco presenta fallas técnicas masivas, emite una orden de PAUSA para no aceptar pagos por ese canal.',
      tools: [
        {
          name: 'check_bank_operational_status',
          description: 'Evalúa la salud operativa de cada banco local y latencia de Pago Móvil.',
          params: '{ bankCode: string }',
          returns: '{ status: "OPERATIVO" | "LENTO" | "CAIDO", avgLatencySeconds: number }',
          useCase: 'Evita disputas causadas por pagos que se quedan retenidos en la cámara interbancaria.',
        },
        {
          name: 'verify_inbound_transfer',
          description: 'Concilia una transferencia entrante validando número de referencia y monto exacto.',
          params: '{ reference: string, expectedAmountVes: number, bankCode: string }',
          returns: '{ verified: boolean, creditedAmount: number, matchedOrder: boolean }',
          useCase: 'Garantiza que el dinero está en tu cuenta antes de liberar.',
        },
        {
          name: 'audit_payment_proof_ocr',
          description: 'Audita comprobantes mediante peritaje OCR validando titular y cédula del emisor.',
          params: '{ imageBase64: string, expectedTitularCedula: string }',
          returns: '{ isAuthentic: boolean, matchScore: number, extractedData: object }',
          useCase: 'Detecta capturas de pantalla editadas con Photoshop o Canva.',
        },
      ],
    },
    {
      id: 'p2p-sudeban-radar',
      name: 'Radar Anti-SUDEBAN & Velocidad',
      category: 'compliance',
      icon: '🛡️',
      purpose:
        'Controla la velocidad transaccional y los límites regulatorios para prevenir bloqueos bancarios preventivos.',
      howItWorks:
        'Registra el acumulado diario de bolívares movidos en cada cuenta bancaria. Aplica la matriz 40/35/25 para distribuir el dinero entre Banesco, Mercantil y BDV, alertando antes de rozar los topes que disparan alertas de lavado de dinero (pitufeo).',
      tools: [
        {
          name: 'evaluate_account_saturation',
          description: 'Calcula el porcentaje de saturación de la cuenta según límites SUDEBAN y de la entidad.',
          params: '{ bankCode: string, currentDailyVes: number }',
          returns: '{ saturationPct: number, remainingQuotaVes: number, shouldRotateAccount: boolean }',
          useCase: 'Te indica el momento exacto en que debes rotar a otra cuenta bancaria.',
        },
      ],
    },
    {
      id: 'p2p-dispute-dossier',
      name: 'Dossier Forense & Apelaciones AI',
      category: 'legal',
      icon: '⚖️',
      purpose:
        'Compila expedientes probatorios irrefutables con hash SHA-256 para ganar apelaciones en Binance.',
      howItWorks:
        'Cuando una contraparte actúa de mala fe (marca pagado sin pagar o envía pago de un tercero), este servidor genera un informe formal en PDF y texto con sellos de tiempo, extracto bancario y marco normativo.',
      tools: [
        {
          name: 'compile_dispute_dossier',
          description: 'Genera el expediente formal con hash criptográfico para adjuntar en la apelación de Binance.',
          params: '{ orderId: string, counterpartyName: string, reason: string, bankEvidence: string }',
          returns: '{ dossierText: string, sha256Hash: string, pdfUrl: string }',
          useCase: 'Permite ganar el 100% de las apelaciones legítimas ante el soporte de Binance.',
        },
      ],
    },
    {
      id: 'p2p-portfolio-risk',
      name: 'Gestión de Portafolio & Coberturas',
      category: 'portafolio',
      icon: '💼',
      purpose:
        'Gestiona coberturas cortas (delta neutral) y modelado cuantitativo de preservación de capital.',
      howItWorks:
        'Si te quedas con un inventario alto de bolívares al final del día y no puedes recomprar USDT inmediatamente, calcula coberturas sintéticas en futuros o recomienda el reparto óptimo según el Criterio de Kelly.',
      tools: [
        {
          name: 'calculate_delta_neutral_hedge',
          description: 'Calcula el tamaño de cobertura necesario para neutralizar la devaluación del bolívar.',
          params: '{ inventoryVes: number, expectedDevaluationPct: number }',
          returns: '{ shortHedgeUsdt: number, recommendedLeverage: number }',
          useCase: 'Protege tu capital si debes quedarte con bolívares un fin de semana.',
        },
        {
          name: 'stress_test_portfolio',
          description: 'Ejecuta simulaciones de estrés ante saltos devaluatorios repentinos del 10%, 20% o 50%.',
          params: '{ totalCapitalUsdt: number, vesExposurePct: number }',
          returns: '{ maximumDrawdownUsdt: number, survivalScore: number }',
          useCase: 'Evalúa si tu mesa sobreviviría a un salto violento del dólar.',
        },
        {
          name: 'project_compound_runway',
          description: 'Proyecta el crecimiento del capital reinvirtiendo ganancias con interés compuesto.',
          params: '{ initialCapital: number, monthlyYieldPct: number, months: number }',
          returns: '{ finalCapital: number, compoundMultiplier: number }',
          useCase: 'Planificación patrimonial a 6 y 12 meses.',
        },
      ],
    },
    {
      id: 'p2p-omnichannel',
      name: 'Concierge Omnicanal & OTC',
      category: 'operaciones',
      icon: '💬',
      purpose:
        'Despacha coordenadas de pago seguras y alertas críticas a Telegram y WhatsApp.',
      howItWorks:
        'Automatiza el envío de datos bancarios con formato profesional y envía notificaciones push al teléfono del operador cuando surge una orden VIP o una señal de riesgo.',
      tools: [
        {
          name: 'dispatch_order_instructions',
          description: 'Envía los datos de Pago Móvil o cuenta de forma limpia y segura a la contraparte.',
          params: '{ channel: "telegram" | "whatsapp", recipient: string, bankDetails: object }',
          returns: '{ delivered: boolean, messageId: string }',
          useCase: 'Evita errores de tipeo de cédula o número de teléfono al cobrar.',
        },
        {
          name: 'send_multichannel_alert',
          description: 'Envía alerta prioritaria al operador ante disparos del Kill-Switch o precios anómalos.',
          params: '{ severity: "CRITICAL" | "WARNING", message: string }',
          returns: '{ dispatchedCount: number }',
          useCase: 'Te avisa al teléfono aunque estés lejos del computador.',
        },
      ],
    },
    {
      id: 'p2p-google-workspace',
      name: 'Google Workspace & Cloud Vault',
      category: 'cloud',
      icon: '☁️',
      purpose:
        'Respaldo transparente y sincronización contable directa en tu propio Google Drive y Sheets personal.',
      howItWorks:
        'Cumple con la soberanía total de datos: utiliza tus propias credenciales OAuth personales. Cada comprobante escaneado se archiva en una carpeta organizada por mes en tu Google Drive y cada trade se escribe en tu hoja de cálculo.',
      tools: [
        {
          name: 'gdrive_backup_receipt',
          description: 'Sube y clasifica comprobantes de pago en una carpeta segura de tu Google Drive personal.',
          params: '{ imageBase64: string, tradeReference: string, date: string }',
          returns: '{ fileId: string, webViewLink: string }',
          useCase: 'Archivo digital organizado para cualquier consulta contable futura.',
        },
        {
          name: 'gsheets_sync_trade',
          description: 'Añade una fila en tiempo real a tu hoja de cálculo de Google Sheets con el PnL del trade.',
          params: '{ tradeData: object }',
          returns: '{ updatedRow: number, spreadsheetId: string }',
          useCase: 'Control financiero compartido con tu contador o socio.',
        },
        {
          name: 'gdrive_sync_db_backup',
          description: 'Genera un snapshot cifrado de la base de datos local y lo respalda en Google Drive.',
          params: '{}',
          returns: '{ backupTimestamp: string, sizeBytes: number }',
          useCase: 'Protección contra pérdida o formateo del computador.',
        },
      ],
    },
    {
      id: 'p2p-aml-forensics',
      name: 'AML & On-Chain Forensics',
      category: 'seguridad',
      icon: '🔬',
      purpose:
        'Inspección de billeteras cripto y listas negras locales para evitar fondos contaminados.',
      howItWorks:
        'Examina si una dirección USDT (TRC20 o BEP20) ha estado vinculada a hackeos, estafas o mixers. Consulta la base de datos local SQLite con hashes ciegos para alertar si el número de cédula o teléfono de la contraparte tiene reportes previos.',
      tools: [
        {
          name: 'screen_wallet_address',
          description: 'Evalúa el nivel de riesgo AML de una dirección de depósito o retiro.',
          params: '{ address: string, chain: "TRC20" | "ERC20" | "BEP20" }',
          returns: '{ riskScore: number, isSanctioned: boolean, flags: string[] }',
          useCase: 'Evita que Binance congele tu cuenta por recibir USDT contaminados.',
        },
        {
          name: 'check_counterparty_blacklist',
          description: 'Verifica si la cédula o cuenta bancaria está en la lista negra local anti-fraude.',
          params: '{ identifier: string }',
          returns: '{ isBlacklisted: boolean, incidentsCount: number, reason?: string }',
          useCase: 'Filtra estafadores seriales antes de iniciar la transacción.',
        },
        {
          name: 'register_blacklisted_entity',
          description: 'Registra un estafador o cuenta sospechosa en la base local (Human-in-the-Loop).',
          params: '{ identifier: string, reason: string, proofHash: string }',
          returns: '{ saved: boolean, id: string }',
          useCase: 'Construir memoria institucional para blindar tu mesa a futuro.',
        },
      ],
    },
  ];

  /**
   * The single merge point for the MCP tab.
   *
   * Left side: the runtime catalog from `McpService` — the same signal the
   * sibling `/mcp` page reads, so it decides existence, naming, status and
   * counts. Right side: `mcpServersGuideDetailed`, which only supplies the
   * params/returns/use-case narrative the catalog cannot carry.
   *
   * Consequences that matter:
   *  - a server or tool added to the catalog appears here automatically;
   *  - documentation that drifts away from the catalog is dropped instead of
   *    advertising a capability that no longer exists;
   *  - catalog-only entries are rendered with an explicit "no ficha" state, so
   *    a richer tool count is never dressed up as deeper documentation.
   */
  readonly mcpServerViews = computed<McpServerView[]>(() => {
    const detailed = new Map(this.mcpServersGuideDetailed.map((s) => [s.id, s]));

    return this.mcp.servers().map((catalogServer) => {
      const doc = detailed.get(catalogServer.id);

      const tools: McpToolView[] = catalogServer.tools.map((catalogTool) => {
        const toolDoc = doc?.tools.find((t) => t.name === catalogTool.name);
        return {
          name: catalogTool.name,
          description: toolDoc?.description ?? catalogTool.description,
          params: toolDoc?.params ?? null,
          returns: toolDoc?.returns ?? null,
          useCase: toolDoc?.useCase ?? null,
          isDocumented: Boolean(toolDoc),
        };
      });

      return {
        id: catalogServer.id,
        name: doc?.name ?? catalogServer.name,
        icon: doc?.icon ?? '🔌',
        category: catalogServer.category,
        transport: catalogServer.transport,
        status: catalogServer.status,
        // Runtime truth, not the curated narrative: use the catalog total so a
        // server that gained tools without a guide update cannot under-report.
        toolCount: catalogServer.toolCount || tools.length,
        resourceCount: catalogServer.resourceCount,
        documentedToolCount: tools.filter((t) => t.isDocumented).length,
        hasNarrative: Boolean(doc),
        purpose: doc?.purpose ?? null,
        howItWorks: doc?.howItWorks ?? null,
        tools,
      };
    });
  });

  readonly mcpCategoryOptions = computed(() => [
    { id: 'all', label: 'Todos', count: this.mcpServerViews().length },
    ...this.mcpCategoryViews(),
  ]);

  /** Server categories grouped for the filter bar, with real per-category counts. */
  readonly mcpCategoryViews = computed(() => {
    const byCategory = new Map<string, { label: string; count: number }>();
    for (const server of this.mcpServerViews()) {
      const existing = byCategory.get(server.category);
      if (existing) existing.count++;
      else byCategory.set(server.category, { label: server.category, count: 1 });
    }
    return [...byCategory.entries()].map(([id, v]) => ({ id, ...v }));
  });

  readonly filteredMcpServers = computed(() => {
    const category = this.selectedMcpCategory();
    const all = this.mcpServerViews();
    return category === 'all' ? all : all.filter((s) => s.category === category);
  });

  readonly activeMcpServer = computed(() => {
    const views = this.mcpServerViews();
    return views.find((s) => s.id === this.selectedMcpServerId()) || views[0];
  });

  // =========================================================================
  // SIMULADOR / TESTER INTERACTIVO DE LLAMADA MCP (Pestaña MCP)
  // =========================================================================
  readonly simulatedToolName = signal<string>('calculate_spread');
  readonly simulatedArgsJson = signal<string>(
    '{\n  "buyPrice": 88.50,\n  "sellPrice": 90.20,\n  "makerFeePct": 0.25,\n  "bankFeePct": 0.30\n}',
  );
  readonly isRunningSim = signal<boolean>(false);
  readonly simulationResult = signal<any>(null);

  selectQuickSimTool(tool: 'calculate_spread' | 'evaluate_trade_risk' | 'get_bcv_rates' | 'check_bcv_intervention_window'): void {
    this.simulatedToolName.set(tool);
    if (tool === 'calculate_spread') {
      this.simulatedArgsJson.set(
        '{\n  "buyPrice": 88.50,\n  "sellPrice": 90.20,\n  "makerFeePct": 0.25,\n  "bankFeePct": 0.30\n}',
      );
    } else if (tool === 'evaluate_trade_risk') {
      this.simulatedArgsJson.set(
        '{\n  "tradeAmountUsdt": 500,\n  "proposedNetSpread": 0.85,\n  "currentLossTodayUsdt": 0\n}',
      );
    } else if (tool === 'get_bcv_rates') {
      this.simulatedArgsJson.set('{}');
    } else if (tool === 'check_bcv_intervention_window') {
      this.simulatedArgsJson.set('{}');
    }
    this.simulationResult.set(null);
  }

  async executeSimulatedMcp(): Promise<void> {
    this.isRunningSim.set(true);
    this.simulationResult.set(null);

    // No initializer on purpose: the catch below returns, so a default value
    // here could never be observed (and `no-useless-assignment` says so).
    let parsedArgs: unknown;
    try {
      parsedArgs = JSON.parse(this.simulatedArgsJson());
    } catch (e: any) {
      this.simulationResult.set({
        error: 'JSON de argumentos inválido: ' + (e?.message || String(e)),
      });
      this.isRunningSim.set(false);
      return;
    }

    try {
      const res = await this.mcp.testTool(this.simulatedToolName(), parsedArgs);
      this.simulationResult.set(res);
    } catch (err: any) {
      this.simulationResult.set({
        success: false,
        error: err?.message || String(err),
      });
    } finally {
      this.isRunningSim.set(false);
    }
  }

  // =========================================================================
  // ASISTENTE "¿QUÉ HERRAMIENTA NECESITO?" (Pestaña Herramientas)
  // =========================================================================
  readonly selectedScenarioId = signal<string>('pricing');

  readonly helpScenarios: InteractiveHelpScenario[] = [
    {
      id: 'pricing',
      question: '¿A qué precio debo publicar mi anuncio para vender rápido sin perder dinero?',
      icon: '🎯',
      toolRoute: '/spread',
      toolName: 'Monitor de Spread',
      mcpServer: 'p2p-multi-exchange',
      mcpTool: 'recommend_competitive_pricing',
      solution:
        'Usa el Monitor de Spread junto al MCP de fijación de precios competitivos. El sistema analiza las primeras 5 órdenes del libro Binance y calcula el precio exacto que te deja un margen neto >= 0.50% quedando visible en el Top 3.',
      steps: [
        'Ve a la pestaña Monitor de Spread.',
        'Ingresa tu costo de reposición (a cuánto compraste tus USDT).',
        'Verifica que el Spread Neto resultante sea mayor a 0.50%.',
        'Copia la tasa sugerida y colócala en tu anuncio de Binance.',
      ],
    },
    {
      id: 'fake_receipt',
      question: 'El comprador marcó la orden como "Pagado", pero sospecho del comprobante.',
      icon: '🔍',
      toolRoute: '/receipts',
      toolName: 'Escáner Forense de Comprobantes',
      mcpServer: 'p2p-bank-sentinel',
      mcpTool: 'audit_payment_proof_ocr',
      solution:
        '¡ALERTA ROJA! Nunca liberes basándote únicamente en una foto. Sube la captura al Escáner OCR para extraer la cédula y número de referencia. Luego ingresa a tu app bancaria y confirma que el dinero aparezca en saldo DISPONIBLE.',
      steps: [
        'Descarga la captura de pantalla que te mandó por el chat de Binance.',
        'Entra a la sección Comprobantes & OCR y arrastra la imagen.',
        'Verifica que la cédula extraída coincida con el nombre verificado en Binance.',
        'Si el titular no coincide o no ves el dinero en tu banco, NO LIBERES y abre apelación.',
      ],
    },
    {
      id: 'bcv_shock',
      question: 'El dólar paralelo subió de golpe o el BCV intervino la banca hoy.',
      icon: '⚡',
      toolRoute: '/triangulation',
      toolName: 'Triangulación & Macro',
      mcpServer: 'p2p-macro-predictor',
      mcpTool: 'calculate_rate_gap',
      solution:
        'En días de alta volatilidad el valor de los bolívares se desmorona rápido. Consulta la brecha oficial/paralelo en el módulo de Triangulación y reduce el tamaño de tus anuncios para rotar en ciclos cortos (15 a 30 minutos).',
      steps: [
        'Revisa la brecha en Triangulación: si supera el 20%, el mercado está presionado.',
        'Ajusta tu precio de venta en Binance cada 10 minutos para no vender barato.',
        'Recompra USDT inmediatamente después de recibir bolívares; nunca duermas con bolívares.',
      ],
    },
    {
      id: 'bank_limit',
      question: 'Muevo mucho volumen y temo que el banco o SUDEBAN me bloquee la cuenta.',
      icon: '🛡️',
      toolRoute: '/risk',
      toolName: 'Reglas de Riesgo & Saturación',
      mcpServer: 'p2p-sudeban-radar',
      mcpTool: 'evaluate_account_saturation',
      solution:
        'Aplica la regla de dispersión 40/35/25 entre Banesco, Mercantil y BDV. El módulo de riesgo audita tu velocidad transaccional y te indica cuándo rotar a otra cuenta antes de disparar las alarmas algorítmicas de SUDEBAN.',
      steps: [
        'Distribuye tu capital: 40% en Banesco, 35% en Mercantil y 25% en BDV.',
        'No hagas más de 15 operaciones de Pago Móvil al día por una misma cuenta.',
        'Al llegar al 70% del cupo diario en un banco, desactiva esa cuenta y opera con la siguiente.',
      ],
    },
    {
      id: 'remesas_client',
      question: 'Un cliente en el exterior quiere enviar una remesa familiar en bolívares.',
      icon: '💸',
      toolRoute: '/remittances',
      toolName: 'Cotizador Comercial de Remesas',
      mcpServer: 'p2p-decisor',
      mcpTool: 'route_fintech_payroll_settlement',
      solution:
        'Usa el Cotizador Comercial de Remesas. Selecciona la moneda (COP, USD, EUR), aplica tu spread comercial (ej. 3.5%) y genera un recibo instantáneo que muestra la tasa garantizada y el monto exacto a acreditar por Pago Móvil.',
      steps: [
        'Abre el Cotizador Comercial de Remesas.',
        'Ingresa el monto que envía el cliente desde su país.',
        'El cotizador descuenta fees de pasarela y calcula los bolívares exactos a pagar.',
        'Copia el recibo con un clic y compártelo por WhatsApp para cerrar el trato.',
      ],
    },
  ];

  readonly activeHelpScenario = computed(() => {
    return (
      this.helpScenarios.find((s) => s.id === this.selectedScenarioId()) ||
      this.helpScenarios[0]
    );
  });

  setTab(tab: GuideTab): void {
    this.activeTab.set(tab);
  }
}
