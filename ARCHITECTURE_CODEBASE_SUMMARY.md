# P2P DECISOR SUITE — RESUMEN MAESTRO DE ARQUITECTURA Y CÓDIGO
> **Documento de Contexto Técnico para Modelos de Inteligencia Artificial (Google Gemini / LLMs)**  
> **Versión**: 2.4 (Enterprise Edition)  
> **Área de Dominio**: Arbitraje Financiero P2P, Criptoactivos, Corredores Cambiarios LATAM (VES, COP, USD, USDT, USDC), Detección de Bots y Gestión de Tesorería.

---

## 1. PROPÓSITO GENERAL DEL SISTEMA

**P2P Decisor** (también denominado institucionalmente *Skalix* en web/PWA y *Homel* en móvil Android) es una suite de software financiero de nivel institucional diseñada para operadores de arbitraje Peer-to-Peer (P2P), mesas de cambio OTC y gestores de tesorería multimoneda en América Latina (con enfoque primario en Venezuela y Colombia).

La plataforma resuelve los problemas más críticos del mercado:
1. **Detección de Bots y Guerra de Centavos (Penny Wars)**: Filtra anuncios falsos (*spoofed ads*), señuelos sin liquidez real y patrones de alta frecuencia que distorsionan el spread real.
2. **Arbitraje Triangular y de Rieles Bancarios**: Modela ciclos de 3 tramos (ej. `USDT ➔ USDC (Spot) ➔ VES (P2P) ➔ USDT` o `VES (Transf) ➔ USDT ➔ COP ➔ VES`) deduciendo con rigor comisiones de exchange e impuestos financieros (como el Gravamen a Movimientos Financieros 4x1000 en Colombia).
3. **Contabilidad FIFO y Valoración Mark-to-Market (MtM)**: Lleva un libro mayor (*ledger*) en tiempo real que calcula costo base ponderado, PnL realizado/no realizado y reconciliación de inventario abierto.
4. **Protección Macro y Cobertura Delta-Neutral**: Modela el calendario de subastas e intervención cambiaria del Banco Central de Venezuela (BCV) y recomienda ratios de cobertura corta (*short*) en futuros de USDT para evitar devaluaciones intradiarias.

---

## 2. ARQUITECTURA DE SOFTWARE (MONORREPOSITORIO)

El proyecto sigue una **Clean Architecture (Arquitectura Hexagonal / Separación Estricta de Dominio)** organizada como monorrepositorio Angular CLI / TypeScript:

```
proyecto-p2p/
├── projects/
│   └── core/                     # NÚCLEO PURO DE DOMINIO (Framework-Agnostic)
│       └── src/lib/              # Motores matemáticos, lógica pura, sin Angular ni DOM
├── src/                          # CAPA DE APLICACIÓN Y PRESENTACIÓN (Angular 19)
│   ├── app/
│   │   ├── core/                 # Servicios globales (reactividad, MCP, APIs, storage)
│   │   ├── features/             # Módulos funcionales (vistas y cockpits interactivos)
│   │   ├── shared/               # Componentes UI reutilizables, pipes, directivas
│   │   └── app.routes.ts         # Enrutador principal de la aplicación
├── electron/                     # CONTENEDOR DE ESCRITORIO
│   └── main/index.ts             # Proceso principal Electron (Node.js, SQLite, System Tray)
├── android/                      # CAPA MÓVIL (Capacitor)
│   └── app/                      # Proyecto nativo Android generado (Homel v1.5)
├── extensions/                   # EXTENSIONES DE NAVEGADOR (Chrome MV3)
│   └── p2p-radar-hud/            # Inyección de HUD táctico sobre Binance P2P vía BroadcastChannel
└── .mcp.json                     # Definición de servidores Model Context Protocol (MCP)
```

### Reglas de Arquitectura Inviolables:
- **`projects/core` es puro y aislado**: NO importa nada de `@angular/*`, ni `window`, ni `document`, ni hace peticiones `fetch`/`http` directas. Solo maneja estructuras de datos inmutables, matemáticas financieras redondeadas (`roundMoney`), y lógica de negocio testeable con Vitest.
- **`src/app` es reactivo moderno (Angular 19 Signals)**: No usa librerías pesadas externas para estado global; utiliza Angular Signals (`signal`, `computed`), componentes standalone y `inject()`.
- **Invariante de Veracidad en Datos**: Nunca inventar datos de mercado. Si una tasa no está disponible en la API o herramienta MCP, se representa como `unavailableRate` (`value: null`) con motivo explícito, evitando caídas silenciosas a cero o tasas inventadas.

---

## 3. MOTORES DE DOMINIO PRINCIPALES (`projects/core/src/lib/`)

### 3.1. Arbitraje Triangular (`triangular-arbitrage.ts`)
Modela rutas de conversión de 3 tramos (Leg 1, Leg 2, Leg 3) garantizando el cierre de ciclo:
- **`simulateLeg(amount, leg)`**: Convierte el capital del tramo calculando:
  1. Conversión bruta según dirección (`isDivision ? amount / price : amount * price`).
  2. Comisión porcentual de plataforma (`feePct`).
  3. Fricción bancaria porcentual y fija (`bankingFeePct`, `bankingFixedFee`), como el 4x1000 GMF.
  4. Deducción de comisiones fijas del exchange.
  5. Cálculo de tasa efectiva neta.
- **`calculateTriangularArbitrage(...)`**:
  - Calcula el PnL neto (`finalAmount - initialAmount`) y ROI % del ciclo.
  - **Breakeven Goal-Seek**: Deduce exactamente a qué precio mínimo debe ejecutarse el Tramo 3 para no entrar en pérdida, considerando las comisiones acumuladas.
  - **Tolerancia a Deslizamiento (*Slippage Tolerance %*)**: Margen de variación de precio antes de que la operación sea negativa.
- **Presets Oficiales Calibrados**:
  1. `route-usdt-usdc-ves`: Arbitraje sintético (`USDT ➔ USDC Spot 1:1 ➔ VES P2P ➔ USDT`).
  2. `route-usdt-usd-ves`: Billeteras digitales (`USDT ➔ Zinli/Wally USD ➔ VES ➔ USDT`).
  3. `route-ves-usdt-cop`: Corredor transfronterizo (`VES ➔ USDT ➔ COP Bancolombia ➔ VES`).
  4. `route-ves-transf-usdt-pm`: Spread de rieles bancarios (`VES Transf ➔ USDT ➔ USDC ➔ VES Pago Móvil`).
  5. `route-cop-nequi-usdt-ves`: Corredor de remesas (`COP Nequi ➔ USDT ➔ VES Pago Móvil`).

### 3.2. Radar de Spread Limpio y Detección de Bots (`p2p-radar-*.ts`)
- **`p2p-radar-clean-mode.ts`**: Limpia el libro de órdenes P2P descartando órdenes atípicas, límites mínimos inaccesibles para el operador o creadas por cuentas fraudulentas.
- **`p2p-radar-bot-detector.ts`**: Identifica patrones predatorios en los libros de Binance P2P:
  - *Penny Wars*: Anuncios que se adelantan por $0.001$ o $0.01$ VES de forma algorítmica constante.
  - *Rate Spoofing*: Anuncios en top de libro con volúmenes mínimos irreales para manipular el precio de referencia.
- **`p2p-radar-spread-engine.ts`**: Calcula márgenes según modalidad de ejecución:
  - `DOBLE_MAKER`: Colocar anuncio de compra y anuncio de venta (máximo margen, mayor tiempo de rotación).
  - `MAKER_COMPRA_TAKER_VENTA`: Comprar barato con anuncio pasivo y liquidar de inmediato tomando órdenes activas.
  - `TAKER_COMPRA_MAKER_VENTA`: Tomar inventario rápido y vender pasivamente con sobreprecio.

### 3.3. Predicción Macro Cambiaria e Intervención BCV (`macro-bcv-intelligence.ts`)
- Detecta el estado del calendario de intervención bancaria del Banco Central de Venezuela (BCV).
- Durante las ventanas de subasta (habitualmente lunes y jueves por la mañana), el ingreso de divisas a la banca comercial comprime la brecha y deprime temporalmente la tasa paralela. El motor emite banderas de alerta de riesgo extremo (`inWindow: true`) para pausar compras agresivas de inventario en VES.

### 3.4. Cobertura Delta-Neutral (`delta-neutral-hedge.ts`)
- Si un operador mantiene inventario en bolívares (VES) por más de 40 minutos o durante noches/fines de semana, calcula la posición corta requerida en futuros USDT para neutralizar el riesgo cambiario sin liquidar su capital operativo.

### 3.5. Contabilidad de Inventario y FIFO (`inventory-accounting.ts`, `fifo-pnl.ts`)
- Agrupa todas las compras de USDT y realiza el apareamiento (*matching*) con las ventas en estricto orden cronológico First-In, First-Out (FIFO).
- Calcula la ganancia realizada por operación, el costo promedio del inventario remanente y la curva de equidad acumulada.

---

## 4. SERVICIOS CLAVE DE LA APLICACIÓN (`src/app/core/`)

1. **`TriangulationIntelligenceService`**:
   - Consolida cotizaciones vivas mediante llamadas al servidor MCP:
     - `get_binance_p2p_orderbook` (fiat: VES, COP; asset: USDT).
     - `get_bcv_rates` (tasas oficiales USD/EUR del BCV).
     - `get_parallel_rates` (promedio paralelo monitoreado).
     - `SpotMarketService` (WebSocket y bookTicker público para `USDCUSDT` y `EURUSDT`).
   - Mapea de forma segura los precios en vivo a los tramos de cada ruta triangular mediante `applyLiveRatesToLegs()`.

2. **`P2pRadarService`**:
   - Mantiene la ingesta en memoria de libros de órdenes para múltiples métodos de pago en simultáneo (Pago Móvil, Banesco, Provincial, Mercantil, Bancolombia, Nequi).
   - Comunica las alertas y oportunidades en tiempo real a la extensión de Chrome mediante la API nativa de `BroadcastChannel`.

3. **`AccountsService`**:
   - Controla las cuentas bancarias y billeteras del operador (Banesco VES, Provincial VES, Binance Spot USDT, Binance P2P USDT, Bancolombia COP, Zinli USD, Efectivo).
   - Administra el libro contable de operaciones (`OperationLog`) y actualiza en tiempo real los balances, volúmenes diarios, metas de ganancia y métricas financieras.

4. **`McpService`**:
   - Conector con el ecosistema Model Context Protocol (servidor `p2p-decisor`), permitiendo ejecutar herramientas analíticas avanzadas, consultas de libros y sincronización con bases de datos locales o remotas.

---

## 5. MÓDULOS DE INTERFAZ Y EXPERIENCIA DE USUARIO (`src/app/features/`)

1. **`/triangulation` (Triangulación y Arbitraje Institucional)**:
   - **Radar Scanner de Rutas**: Matriz comparativa de todas las rutas simultáneas mostrando ROI %, velocidad de rotación (%/h), duración y nivel de riesgo.
   - **Corredor de Conversión Visual (3 Nodos)**: Diagrama interactivo de flujo de capital que muestra el tránsito entre divisas y plataformas.
   - **Cascada Didáctica de Costos (Waterfall)**: Gráfico de barras que desglosa visualmente el Margen Bruto, Comisiones de Plataforma, Fricción Bancaria (4x1000) y la Ganancia Neta Real con su precio de breakeven.
   - **Slider Dinámico de Capital**: Ajuste de monto con presets adaptativos según la divisa inicial (USDT, VES o COP).
   - **Cotizador WhatsApp para Clientes / OTC**: Generador con 1-click de cotizaciones comerciales formateadas con validez temporal (15 min) para enviar a clientes de remesas o contrapartes.
   - **Asentamiento en Bitácora (1-Click)**: Inserta los 3 tramos ejecutados directamente en el libro contable.

2. **`/p2p-radar` y `/spread` (Monitor de Mercado y Radar P2P)**:
   - Cockpit financiero en modo oscuro de alta densidad informativa.
   - Profundidad de mercado bid/ask, detección visual de bots (etiquetas amarillas/rojas), y radar de divergencia cambiaria entre bancos.

3. **`/operations` (Centro de Operaciones y Bitácora)**:
   - Registro de transacciones con filtros avanzados, cálculo automático de PnL por FIFO, auditoría de contrapartes y reconciliación de cuentas.

4. **`/finance-360` (Finanzas 360 y Portafolio)**:
   - Vista patrimonial integral del operador, flujos de caja, cuentas por cobrar, proyecciones de interés compuesto y sincronización con Google Drive / Sheets.

5. **`/copilot` (Copiloto Inteligente)**:
   - Interfaz conversacional conectada a los motores del core para responder preguntas tácticas del operador, analizar comprobantes de pago por OCR y sugerir precios competitivos de publicación.

---

## 6. TECNOLOGÍAS, LIBRERÍAS Y ENTORNO

- **Lenguaje**: TypeScript 5.6+ (Strict Mode activado).
- **Frontend Framework**: Angular 19.2 (Standalone Components, Signals, Zoneless reactive architecture).
- **Testing**: Vitest 4.1 (Unit tests ultrarrápidos para motores del core), Playwright (E2E).
- **Desktop Runtime**: Electron 34+ con empaquetado para Windows (`.exe` instalador y portable).
- **Mobile Runtime**: Capacitor 7+ (compilación nativa de APKs para Android).
- **Diseño Visual**: CSS/SCSS personalizado inspirado en terminales financieras profesionales (Bloomberg / TradingView Dark Mode), paleta de colores de alto contraste:
  - Verde Esmeralda (`#10b981`): Ganancia, ROI positivo, órdenes seguras.
  - Azul Eléctrico (`#0a84ff`): Datos en vivo, sincronización MCP, flujo primario.
  - Rojo Carmín (`#ef4444`): Pérdidas, ventanas críticas del BCV, advertencia de slippage.
  - Ámbar Cálido (`#f59e0b`): Detección de bots, fricción intermedia.
  - Obsidiana / Carbón (`#121214`, `#1c1c1e`): Fondo de alta legibilidad para evitar fatiga visual.

---

## 7. CÓMO DEBE TRABAJAR GEMINI CON ESTE PROYECTO

Cuando uses este archivo como contexto para pedirle cambios o nuevas funciones a Google Gemini:
1. **Mantener la pureza de `@p2p/core`**: Cualquier nuevo cálculo financiero, regla de riesgo o fórmula de arbitraje debe programarse primero en `projects/core/src/lib/` con sus respectivos tests en `.spec.ts`, completamente agnóstico de Angular.
2. **Respetar la reactividad de Signals en Angular**: En `src/app`, utilizar `signal()`, `computed()` y `toSignal()`. No usar `BehaviorSubject` ni observables de RxJS innecesarios salvo que se trate de streams de eventos externos o WebSockets.
3. **No romper bucles triangulares**: En triangulación, `legs[0].fromCurrency` debe coincidir siempre con `legs[2].toCurrency` para que el ciclo sea cerrado y el retorno medible.
4. **Respetar las convenciones de commit**: Usar Conventional Commits (`feat(...)`, `fix(...)`, `refactor(...)`) sin atribución artificial.
