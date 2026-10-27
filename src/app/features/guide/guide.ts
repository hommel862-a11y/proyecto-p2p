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
  role: 'operations' | 'banking' | 'crm' | 'finance' | 'mcp';
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
  theme: string;
  avatar: string;
  roleBadge: string;
  name: string;
  quote: string;
  summary: string;
  skills: { serverId: string; detail: string }[];
}

export interface McpToolGuide {
  name: string;
  description: string;
  params: string;
  returns: string;
  useCase: string;
}

export interface McpServerGuide {
  id: string;
  name: string;
  category: string;
  icon: string;
  purpose: string;
  howItWorks: string;
  tools: McpToolGuide[];
}

export interface McpToolView {
  name: string;
  description: string;
  params: string | null;
  returns: string | null;
  useCase: string | null;
  isDocumented: boolean;
}

export interface McpServerView {
  id: string;
  name: string;
  icon: string;
  category: string;
  transport: string;
  status: string;
  toolCount: number;
  resourceCount: number;
  documentedToolCount: number;
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

export interface ParsedVoiceResult {
  action: 'COMPRA' | 'VENTA';
  amount: number | null;
  rate: number | null;
  bank: string;
  reference: string;
  counterparty: string;
  totalFiat: number | null;
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
  readonly selectedRole = signal<string>('all');

  // =========================================================================
  // MASTERY TRACKER (Persistencia en localStorage)
  // =========================================================================
  private readonly MASTERY_STORAGE_KEY = 'p2p.guide.mastery';
  readonly masterySet = signal<Set<string>>(new Set(this.loadMasteryFromStorage()));

  private loadMasteryFromStorage(): string[] {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    try {
      const raw = localStorage.getItem(this.MASTERY_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  toggleMastery(id: string): void {
    const current = new Set(this.masterySet());
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    this.masterySet.set(current);
    try {
      localStorage.setItem(this.MASTERY_STORAGE_KEY, JSON.stringify([...current]));
    } catch {
      /* sin persistencia */
    }
  }

  isMastered(id: string): boolean {
    return this.masterySet().has(id);
  }

  readonly totalMasterableItems = computed(() => this.deskModules().length + 5);
  readonly masteryCount = computed(() => this.masterySet().size);
  readonly masteryPercentage = computed(() => {
    const total = this.totalMasterableItems();
    if (total === 0) return 0;
    return Math.min(100, Math.round((this.masteryCount() / total) * 100));
  });

  // =========================================================================
  // ROLES & FILTROS RÁPIDOS
  // =========================================================================
  readonly roleOptions = [
    { id: 'all', label: 'Todos', icon: '🌐' },
    { id: 'operations', label: '⚡ Operativa Diaria P2P', icon: '⚡' },
    { id: 'banking', label: '🛡️ Bancos & Anti-Estafa', icon: '🛡️' },
    { id: 'crm', label: '💬 CRM, WhatsApp & Facturas', icon: '💬' },
    { id: 'finance', label: '🏛️ Finanzas 360', icon: '🏛️' },
    { id: 'mcp', label: '🤖 Enjambre & Centinelas', icon: '🤖' },
  ];

  setRoleFilter(role: string): void {
    this.selectedRole.set(role);
  }

  // =========================================================================
  // SIMULADOR INTERACTIVO DE VOZ Y SMS (Sandbox en tiempo real)
  // =========================================================================
  readonly sandboxInput = signal<string>(
    'Venta de 450 USDT a 36.85 por Banesco referencia 984512 cliente Carlos',
  );

  readonly parsedVoice = computed<ParsedVoiceResult>(() => {
    const text = this.sandboxInput().toLowerCase();

    // Action
    let action: 'COMPRA' | 'VENTA' = 'VENTA';
    if (
      text.includes('compra') ||
      text.includes('compre') ||
      text.includes('recibí pago') ||
      text.includes('pago móvil recibido')
    ) {
      action = 'COMPRA';
    } else if (
      text.includes('venta') ||
      text.includes('vendí') ||
      text.includes('vendi') ||
      text.includes('envío') ||
      text.includes('despacho')
    ) {
      action = 'VENTA';
    }

    // Numbers
    const allNums = [...text.matchAll(/\b\d+(?:[.,]\d+)?\b/g)].map((m) =>
      parseFloat(m[0].replace(',', '.')),
    );

    let amount: number | null = null;
    let rate: number | null = null;

    if (allNums.length > 0) {
      amount = allNums[0];
    }

    const rateMatch = text.match(/(?:tasa|precio|a|en)\s*(\d+(?:[.,]\d+)?)/i);
    if (rateMatch && rateMatch[1]) {
      rate = parseFloat(rateMatch[1].replace(',', '.'));
    } else if (allNums.length > 1) {
      rate = allNums[1];
    }

    // Bank
    let bank = 'General / Interbancario';
    if (text.includes('banesco')) bank = 'Banesco';
    else if (text.includes('mercantil')) bank = 'Mercantil';
    else if (text.includes('bdv') || text.includes('venezuela')) bank = 'Banco de Venezuela';
    else if (text.includes('provincial')) bank = 'BBVA Provincial';
    else if (text.includes('bancolombia')) bank = 'Bancolombia';
    else if (text.includes('binance') || text.includes('pay')) bank = 'Binance Pay';
    else if (text.includes('zinli')) bank = 'Zinli';
    else if (text.includes('wally')) bank = 'Wally Tech';

    // Reference
    let reference = 'No detectada';
    const refMatch = text.match(/(?:ref(?:erencia)?\.?|recibo|comprobante|#)\s*([a-z0-9_-]{4,12})/i);
    if (refMatch && refMatch[1]) {
      reference = refMatch[1].toUpperCase();
    } else {
      const longNum = allNums.find((n) => n >= 1000 && n !== amount && n !== rate);
      if (longNum) reference = String(Math.round(longNum));
    }

    // Counterparty
    let counterparty = 'Sin asignar';
    const clientMatch = text.match(
      /(?:cliente|usuario|persona|contraparte|para|de)\s+([a-záéíóúñ]+)/i,
    );
    if (clientMatch && clientMatch[1]) {
      const candidate = clientMatch[1].trim();
      const ignoreWords = ['usdt', 'bs', 'bolivares', 'tasa', 'banco', 'banesco', 'mercantil', 'referencia'];
      if (!ignoreWords.includes(candidate)) {
        counterparty = candidate.charAt(0).toUpperCase() + candidate.slice(1);
      }
    }

    return {
      action,
      amount,
      rate,
      bank,
      reference,
      counterparty,
      totalFiat: amount && rate ? amount * rate : null,
    };
  });

  setSandboxPreset(phrase: string): void {
    this.sandboxInput.set(phrase);
  }

  // =========================================================================
  // SIMULADOR VISUAL DE LIQUIDACIÓN FIFO & BREAK-EVEN
  // =========================================================================
  readonly fifoLot1Qty = signal<number>(300);
  readonly fifoLot1Price = signal<number>(36.2);
  readonly fifoLot2Qty = signal<number>(500);
  readonly fifoLot2Price = signal<number>(36.8);

  readonly fifoTotalInventory = computed(() => this.fifoLot1Qty() + this.fifoLot2Qty());
  readonly fifoTotalCost = computed(
    () => this.fifoLot1Qty() * this.fifoLot1Price() + this.fifoLot2Qty() * this.fifoLot2Price(),
  );
  readonly fifoVwap = computed(() => {
    const qty = this.fifoTotalInventory();
    return qty > 0 ? this.fifoTotalCost() / qty : 0;
  });
  readonly fifoSafeBreakEven = computed(() => this.fifoVwap() * 1.01); // VWAP + 1%

  // =========================================================================
  // DECK TÁCTICO DE ATremote / TECLADO
  // =========================================================================
  readonly simulatedHotkey = signal<string | null>(null);

  triggerHotkeyFeedback(key: string): void {
    this.simulatedHotkey.set(key);
    setTimeout(() => {
      if (this.simulatedHotkey() === key) {
        this.simulatedHotkey.set(null);
      }
    }, 1800);
  }

  // =========================================================================
  // DERIVED COUNTS & TABS
  // =========================================================================
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
    { id: 'intro', label: '1. P2P Desde Cero & Sandbox', icon: '📚', badge: 'Fundamentos & Voz' },
    { id: 'tools', label: '2. Herramientas del Desk', icon: '🛠️', badge: `${this.deskModuleCount()} Módulos` },
    { id: 'mcp', label: '3. Servidores MCP', icon: '🔌', badge: `${this.mcpServerCount()} Dominios / ${this.mcpToolCount()} Tools` },
    { id: 'swarm', label: '4. Enjambre Multi-Agente', icon: '🤖', badge: `${this.swarmAgentCount()} Agentes` },
    { id: 'security', label: '5. Blindaje Bancario & SUDEBAN', icon: '🛡️', badge: 'Seguridad' },
    { id: 'workflow', label: '6. Checklist Paso a Paso', icon: '🎯', badge: 'Protocolo SOP' },
    { id: 'terms', label: '7. Términos & Privacidad', icon: '⚖️', badge: 'Legal' },
  ]);

  // =========================================================================
  // SIMULADOR INTERACTIVO DE SPREAD BRUTO VS NETO
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
    if (this.applyMakerFee()) fee += 0.25;
    if (this.applyBankFee()) fee += 0.3;
    return fee;
  });

  readonly calcNetSpread = computed(() => {
    return this.calcGrossSpread() - this.calcTotalFeePct();
  });

  readonly isGoldenRuleMet = computed(() => {
    return this.calcNetSpread() >= 0.5;
  });

  // =========================================================================
  // HERRAMIENTAS DEL DESK (Catálogo Completo de 16 Módulos)
  // =========================================================================
  readonly selectedToolId = signal<string>('spread');

  readonly deskModuleDocs: DeskModuleGuide[] = [
    {
      id: 'p2p-radar',
      name: 'Radar de Inteligencia P2P L2',
      route: '/radar',
      icon: '🛰️',
      category: 'Inteligencia de Mercado',
      role: 'operations',
      badge: 'Bots & BCV',
      tagline: 'Profundidad de libro Nivel 2, detección de Penny War y ventana de intervención cambiaria del BCV.',
      whyItMatters:
        'En mercados de alta competencia, los bots bajan el precio 0.001 Bs para acaparar el primer lugar sin volumen real. El radar filtra el ruido, muestra la liquidez institucional real y te avisa si el Banco Central está inyectando divisas.',
      stepByStep: [
        'Activa el filtro "Clean Mode" para ocultar bots con órdenes insignificantes (< 50 USDT).',
        'Monitorea el indicador de Presión de Libro (Bid vs Ask Imbalance).',
        'Revisa la Brecha BCV vs Paralelo y la ventana de intervención cambiaria oficial.',
        'Establece alertas audibles de depeg o roturas de soporte.',
      ],
      keyInputs: ['Libro de órdenes Binance P2P L2', 'Tasas BCV oficiales', 'Historial de micro-spreads'],
      keyOutputs: ['Profundidad neta real', 'Presión de mercado (%)', 'Alerta de intervención BCV'],
      commonMistakes:
        'Pelear la guerra del centavo contra un bot automatizado que te arrastra a operar a pérdida.',
      proTip:
        'Si el BCV inyecta divisas por la mañana, la tasa paralela tiende a frenarse o caer temporalmente. Reduce tu stock fiduciario.',
    },
    {
      id: 'log',
      name: 'Registro Contable (Ledger) & Operaciones v4.0',
      route: '/log',
      icon: '📑',
      category: 'Centro de Operaciones',
      role: 'operations',
      badge: 'Voz & FIFO',
      tagline: 'Terminal de trading con dictado por voz, ingestión de SMS, 3 ranuras en paralelo y liquidación FIFO.',
      whyItMatters:
        'La velocidad de carga y la precisión contable deciden la rentabilidad del trader. Puedes dictar órdenes con voz natural, liquidar lotes antiguos con 1 clic protegiendo el Break-Even (VWAP + 1%) y estacionar hasta 3 trades en paralelo.',
      stepByStep: [
        'Presiona Alt + V o el botón del micrófono y dicta tu orden (ej. "Venta 450 USDT tasa 36.85 por Banesco").',
        'Usa el botón Click-to-Liquidate en los lotes FIFO para auto-completar el formulario de venta.',
        'Si tienes varias órdenes activas, conmuta entre las ranuras 1, 2 y 3 sin perder datos.',
        'Fija la plantilla (Pin Template) para cargar múltiples operaciones del mismo banco sin reescribir.',
      ],
      keyInputs: ['Dictado de voz / SMS', 'Lotes de compra FIFO', 'Comprobante y referencia bancaria'],
      keyOutputs: ['PnL Neto por orden', 'Ganancia acumulada del día', 'Inventario FIFO actualizado'],
      commonMistakes:
        'Promediar a ciegas cuando el mercado baja; usa siempre el botón Click-to-Liquidate al precio VWAP + 1%.',
      proTip:
        'La tecla Enter confirma y guarda el trade inmediatamente sin necesidad de tocar el ratón.',
    },
    {
      id: 'compliance-cockpit',
      name: 'CRM & Contrapartes (KYC)',
      route: '/compliance-cockpit',
      icon: '👥',
      category: 'Cumplimiento & Bóvedas',
      role: 'crm',
      badge: 'Doble Bóveda',
      tagline: 'Bóveda P2P Desk vs Finanzas 360, Kanban de 4 etapas, copiado en 3 burbujas y facturación PNG.',
      whyItMatters:
        'El mayor peligro en P2P es la triangulación de pagos y mezclar el capital de trabajo con el dinero de tu vida personal o pyme. Este CRM aísla tus contrapartes, califica su riesgo y genera facturas comerciales.',
      stepByStep: [
        'Selecciona la bóveda activa: "⚡ MESA P2P" para trading o "🏛️ FINANZAS 360" para tesorería/pyme.',
        'Mueve las tarjetas por el Kanban: Cotizado -> En Tránsito -> Verificando Ref -> Liquidado.',
        'Usa el botón "Copiar 3 Burbujas" para enviar Cédula, Teléfono y Monto por separado a WhatsApp.',
        'Genera un comprobante o factura en imagen PNG de alta definición con código QR con 1 clic.',
      ],
      keyInputs: ['Datos del cliente (Cédula/RIF, Banco, Teléfono)', 'Etapa del trato', 'Monto y divisa'],
      keyOutputs: ['Tarjeta Kanban con estado de reserva', 'Comprobante PNG descargable', 'Historial KYC'],
      commonMistakes:
        'Enviar todos los datos bancarios en un solo párrafo largo donde el cliente copia y pega mal los números.',
      proTip:
        'El sistema en 3 burbujas reduce los errores de transferencia de clientes en un 95%.',
    },
    {
      id: 'finance-360',
      name: 'Finanzas 360 & Pyme',
      route: '/finanzas-360',
      icon: '🏛️',
      category: 'Tesorería & Patrimonio',
      role: 'finance',
      badge: 'Runway & PnL',
      tagline: 'Cortafuegos financiero: barrido de utilidades netas, cálculo de Runway y asignación patrimonial.',
      whyItMatters:
        'Un trader que no separa su capital de trabajo de sus utilidades termina quebrado o gastándose el inventario. Finanzas 360 ejecuta el Corte de Turno diario trasvasando únicamente las ganancias netas.',
      stepByStep: [
        'Al cerrar tu jornada en la Mesa P2P, presiona "Corte de Turno (Profit Sweep)".',
        'El sistema transfiere únicamente el beneficio neto positivo a la Bóveda Pyme.',
        'Monitorea el Runway operativo (meses de supervivencia con gastos fijos cubiertos).',
        'Visualiza la distribución de activos: Capital P2P, Caja Operativa y Ganancias Acumuladas.',
      ],
      keyInputs: ['PnL neto diario acumulado', 'Costos fijos mensuales', 'Asignación de cuentas'],
      keyOutputs: ['Cálculo de Runway en meses', 'Gráfico de torta patrimonial', 'Bitácora de cortes de turno'],
      commonMistakes:
        'Gastar dinero de la cuenta operativa creyendo que todo el saldo en cuenta es ganancia propia.',
      proTip:
        'Mantén al menos 6 meses de Runway en la Bóveda Pyme antes de retirar utilidades personales.',
    },
    {
      id: 'spread',
      name: 'Monitor de Spread',
      route: '/spread',
      icon: '📈',
      category: 'Motor Cuantitativo',
      role: 'operations',
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
      proTip:
        'Presiona F2 en el escritorio para sincronizar instantáneamente el radar con el libro de Binance.',
    },
    {
      id: 'income',
      name: 'Calculadora de Ingresos',
      route: '/income',
      icon: '🧮',
      category: 'Planificación Financiera',
      role: 'finance',
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
      proTip:
        'Rotar $1,000 USDT 3 veces al día al 0.8% neto produce $24 diarios ($720/mes) con riesgo controlado.',
    },
    {
      id: 'triangulation',
      name: 'Triangulación Multidivisa',
      route: '/triangulation',
      icon: '🔄',
      category: 'Arbitraje de Divisas',
      role: 'operations',
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
      proTip:
        'Las mañanas de intervención bancaria del BCV suelen crear los spreads triangulares más jugosos.',
    },
    {
      id: 'remittances',
      name: 'Cotizador Comercial de Remesas',
      route: '/remittances',
      icon: '💸',
      category: 'Negocio Cambiario',
      role: 'crm',
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
      proTip:
        'Copia el desglose transparente generado con un clic y envíaselo al cliente por WhatsApp.',
    },
    {
      id: 'copilot',
      name: 'Copiloto Estratega IA',
      route: '/copilot',
      icon: '🤖',
      category: 'Inteligencia Artificial',
      role: 'mcp',
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
      proTip:
        'Pídele que redacte tu texto de apelación en Binance si un usuario marca pagado sin enviar dinero.',
    },
    {
      id: 'receipts',
      name: 'Escáner Forense de Comprobantes',
      route: '/receipts',
      icon: '🔍',
      category: 'Seguridad Antifraude',
      role: 'banking',
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
      proTip:
        'Si el nombre del comprobante no coincide con Binance, rechaza el pago y abre apelación de inmediato.',
    },
    {
      id: 'risk',
      name: 'Reglas de Riesgo Institucional',
      route: '/risk',
      icon: '⚖️',
      category: 'Gobernanza Financiera',
      role: 'banking',
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
      proTip:
        'Respeta las órdenes de PAUSA; cuando el mercado entra en pánico es mejor apagar la pantalla 1 hora.',
    },
    {
      id: 'stats',
      name: 'Estadísticas & Métricas',
      route: '/stats',
      icon: '📉',
      category: 'Analítica Cuantitativa',
      role: 'finance',
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
      proTip:
        'Un operador profesional busca maximizar el margen por hora trabajada, no mover volumen por vanidad.',
    },
    {
      id: 'agent-studio',
      name: 'Estudio de Agentes Autónomos',
      route: '/agents',
      icon: '🧪',
      category: 'Automatización',
      role: 'mcp',
      badge: 'Centinelas MCP',
      tagline: 'Diseño, inspección y orquestación de agentes especializados y centinelas remotos.',
      whyItMatters:
        'Permite configurar los parámetros operativos de tus centinelas de Telegram, definir reglas de disparo automático y probar las capacidades de cada modelo.',
      stepByStep: [
        'Selecciona el agente que deseas auditar (Centinela, Estratega, Riesgo o Disputas).',
        'Ajusta la sensibilidad de las alertas y el canal de despacho (Telegram / Notificaciones locales).',
        'Verifica los permisos y herramientas MCP asignadas a cada perfil.',
      ],
      keyInputs: ['Parámetros de disparo', 'Tokens y configuraciones de agentes'],
      keyOutputs: ['Estado de conectividad', 'Registro de decisiones tomadas'],
      commonMistakes:
        'Otorgar permisos de ejecución sin supervisión humana (Human-in-the-Loop).',
      proTip:
        'Vincula el bot de Telegram para recibir alertas en tu teléfono cuando estés lejos de la pantalla.',
    },
    {
      id: 'mcp-hub',
      name: 'Centro de Servidores MCP',
      route: '/mcp',
      icon: '🔌',
      category: 'Suite de Conectores',
      role: 'mcp',
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
      keyOutputs: ['Estado de conectividad', 'Tiempo de respuesta en milisegundos', 'Telemetría de auditoría'],
      commonMistakes:
        'Pensar que el MCP transfiere dinero; todas las herramientas de escritura son estrictamente Human-in-the-Loop.',
      proTip:
        'Puedes probar la herramienta calculate_spread directamente desde el playground para validar precios.',
    },
    {
      id: 'dashboard',
      name: 'Dashboard Central',
      route: '/dashboard',
      icon: '📊',
      category: 'Control Maestro',
      role: 'operations',
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
      proTip:
        'Usa el atajo Esc en cualquier pantalla de escritorio para disparar el Kill-Switch inmediato.',
    },
    {
      id: 'growth-projector',
      name: 'Proyector de Crecimiento',
      route: '/growth-projector',
      icon: '🚀',
      category: 'Planificación Financiera',
      role: 'finance',
      badge: 'Interés Compuesto',
      tagline: 'Simulación montecarlo y proyección exponencial de capital reinvertido.',
      whyItMatters:
        'Visualiza el efecto multiplicador de la reinversión constante de utilidades vs la extracción de capital en escenarios conservadores, moderados y agresivos.',
      stepByStep: [
        'Ingresa tu capital inicial de trabajo.',
        'Configura el porcentaje de reinversión diaria de tus márgenes P2P.',
        'Proyecta tu balance a 3, 6 y 12 meses visualizando la curva de interés compuesto.',
      ],
      keyInputs: ['Capital base', 'Tasa de reinversión', 'Horizonte temporal'],
      keyOutputs: ['Curva de crecimiento de balance', 'Retiro acumulado estimado'],
      commonMistakes:
        'Asumir un 100% de reinversión sin presupuestar gastos operativos fijos ni impuestos.',
      proTip:
        'Un retiro del 30% de ganancias para la Bóveda Pyme y un 70% de reinversión en P2P garantiza estabilidad.',
    },
  ];

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

  readonly filteredDeskModules = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const role = this.selectedRole();
    let list = this.deskModules();

    if (role !== 'all') {
      list = list.filter((m) => m.role === role);
    }

    if (q) {
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.category.toLowerCase().includes(q) ||
          m.tagline.toLowerCase().includes(q) ||
          m.whyItMatters.toLowerCase().includes(q) ||
          m.proTip.toLowerCase().includes(q),
      );
    }
    return list;
  });

  readonly activeToolGuide = computed(() => {
    return this.deskModules().find((m) => m.id === this.selectedToolId()) || this.deskModules()[0];
  });

  // =========================================================================
  // ENJAMBRE MULTI-AGENTE (SWARM AI)
  // =========================================================================
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

  readonly swarmAgentViews = computed(() => {
    const onlineServerIds = new Set(this.mcp.servers().map((s) => s.id));
    return this.swarmAgents
      .map((agent) => ({
        ...agent,
        skills: agent.skills.filter((s) => onlineServerIds.has(s.serverId)),
      }))
      .filter((agent) => agent.skills.length > 0);
  });

  readonly selectedAgentId = signal<string>('sentinel');
  readonly activeAgent = computed(() => {
    const list = this.swarmAgentViews();
    return list.find((a) => a.id === this.selectedAgentId()) || list[0] || this.swarmAgents[0];
  });

  // =========================================================================
  // SERVIDORES MCP & PLAYGROUND
  // =========================================================================
  readonly selectedMcpCategory = signal<string>('all');
  readonly selectedMcpServerId = signal<string>('p2p-decisor');

  readonly mcpServerGuides: McpServerGuide[] = [
    {
      id: 'p2p-decisor',
      name: 'p2p-decisor',
      category: 'Core Cuantitativo',
      icon: '⚡',
      purpose: 'Motor de cálculo de spreads netos, fricciones y verificación de la Regla de Oro.',
      howItWorks: 'Recibe precios de compra/venta y calcula el spread real deduciendo comisiones y fees bancarios.',
      tools: [
        {
          name: 'calculate_spread',
          description: 'Calcula el spread bruto y neto entre órdenes P2P con deducción de comisiones.',
          params: 'buyPrice, sellPrice, makerFeePct, bankFeePct',
          returns: 'grossSpreadPct, netSpreadPct, isGoldenRuleMet, breakEvenSellPrice',
          useCase: 'Verificar rentabilidad antes de publicar un anuncio Maker.',
        },
      ],
    },
    {
      id: 'p2p-macro-predictor',
      name: 'p2p-macro-predictor',
      category: 'Macroeconomía & BCV',
      icon: '🏦',
      purpose: 'Monitoreo de intervención cambiaria del Banco Central de Venezuela y brechas de divisas.',
      howItWorks: 'Monitorea las inyecciones de divisas del BCV para alertar sobre caídas de spread.',
      tools: [
        {
          name: 'check_bcv_intervention_window',
          description: 'Indica si el mercado está dentro de una ventana de intervención bancaria del BCV.',
          params: 'none',
          returns: 'isInterventionActive, windowEndEstimate, volatilityRiskLevel',
          useCase: 'Reducir tamaño de posición fiduciaria durante mañanas de inyección de divisas.',
        },
      ],
    },
  ];

  readonly mcpServerViews = computed<McpServerView[]>(() => {
    const catalogServers = this.mcp.servers();
    const guidesById = new Map<string, McpServerGuide>(this.mcpServerGuides.map((g) => [g.id, g]));

    return catalogServers.map((cat) => {
      const doc = guidesById.get(cat.id);
      return {
        id: cat.id,
        name: cat.name || cat.id,
        icon: doc?.icon || '🔌',
        category: doc?.category || cat.category || 'Servicio MCP',
        transport: cat.transport || 'stdio',
        status: cat.status || 'ONLINE',
        toolCount: cat.toolCount || 0,
        resourceCount: cat.resourceCount || 0,
        documentedToolCount: doc?.tools.length || 0,
        hasNarrative: Boolean(doc),
        purpose: doc?.purpose ?? 'Servidor de herramientas deterministas para agentes autónomos.',
        howItWorks: doc?.howItWorks ?? 'Expone endpoints JSON-RPC locales en tu equipo.',
        tools: (cat.tools || []).map((t) => {
          const docTool = doc?.tools.find((dt) => dt.name === t.name);
          return {
            name: t.name,
            description: t.description,
            params: docTool?.params ?? null,
            returns: docTool?.returns ?? null,
            useCase: docTool?.useCase ?? null,
            isDocumented: Boolean(docTool),
          };
        }),
      };
    });
  });

  readonly mcpCategoryOptions = computed(() => [
    { id: 'all', label: 'Todos', count: this.mcpServerViews().length },
    ...this.mcpCategoryViews(),
  ]);

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

  readonly simulatedToolName = signal<string>('calculate_spread');
  readonly simulatedArgsJson = signal<string>(
    '{\n  "buyPrice": 88.50,\n  "sellPrice": 90.20,\n  "makerFeePct": 0.25,\n  "bankFeePct": 0.30\n}',
  );
  readonly isRunningSim = signal<boolean>(false);
  readonly simulationResult = signal<any>(null);

  selectQuickSimTool(
    tool: 'calculate_spread' | 'evaluate_trade_risk' | 'get_bcv_rates' | 'check_bcv_intervention_window',
  ): void {
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
  // ASISTENTE "¿QUÉ HERRAMIENTA NECESITO?"
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
