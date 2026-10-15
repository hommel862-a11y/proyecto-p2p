# PLAN MAESTRO DE EJECUCIÓN: PORTAFOLIO FINANCIERO, PYME & PRESUPUESTOS 360
## Arquitectura Limpia, Ergonomía Móvil 9:16, IA Multimodal y Aislamiento P2P

Este plan maestro establece la hoja de ruta en **6 fases secuenciales** para construir e integrar el módulo de **Finanzas 360** en la suite Homel. Incorpora **Inteligencia Artificial Multimodal**, un **Escuadrón de Agentes Especializados**, diseño ergonómico de **Revelación Progresiva (Progressive Disclosure)** para Android vertical 9:16 y el cumplimiento estricto de la **Regla de Oro de Aislamiento con la Mesa P2P**.

---

## 1. VALOR ESTRATÉGICO Y BENEFICIOS DE LA INTELIGENCIA ARTIFICIAL (IA)

El principal motivo por el que las aplicaciones financieras fallan es la **fricción en la carga manual de datos**: anotar cada café, tornillo o transferencia bancaria cansa al usuario en pocos días. La integración de IA en Homel 360 resuelve este problema de raíz:

| Capacidad de IA | Beneficio Operativo | Impacto en la Experiencia |
| :--- | :--- | :--- |
| **Visión Multimodal (Gemini Vision)** | Extracción instantánea de datos desde fotos de facturas arrugadas, recibos de puntos de venta, captures bancarios nacionales y capturas de cuotas de Cashea. | Cero tipeo manual. La IA extrae monto, fecha, comercio, categoría y tasa de cambio. |
| **Dictado por Voz (Voice-to-Ledger)** | El usuario envía o graba una nota de voz ("Gasté 15 dólares en gasolina pagando en bolívares por Pago Móvil") y el agente genera el asiento contable. | Carga de gastos en 3 segundos mientras se conduce o se trabaja en el taller. |
| **Categorización y Detección de Fugas** | Algoritmo predictivo que detecta consumos anómalos o incrementos injustificados de precios de insumos/proveedores. | Alertas proactivas: *"Tus compras de pintura subieron 22% este mes frente al promedio"*. |
| **Asesor de Tesorería & Runway** | Proyección inteligente de caja que cruza sueldo fijo, ventas Pyme y profit P2P contra el calendario de cuotas Cashea y proveedores. | Evita quiebres de liquidez: advierte 5 días antes si no habrá fondos para pagar una cuota. |
| **Cotizador Automatizado (Obras / Taller)** | Deducción inteligente de recetas de materiales a partir de medidas (m²) o piezas de carrocería dañadas, calculando un 10% de merma técnica. | Genera presupuestos profesionales y presupuestos internos de rentabilidad en segundos. |

---

## 2. FILOSOFÍA DE INTERFAZ: LIMPIA, MINIMALISTA Y ERGONÓMICA (ANDROID 9:16)

Para evitar la sobrecarga visual, el desorden o el efecto "sopa de números" en teléfonos móviles, la interfaz se rige por el principio de **Revelación Progresiva (Progressive Disclosure)**:

```
┌────────────────────────────────────────────────────────┐
│  HOMEL 360 ── MODO [ 🌐 Todos | 👤 Personal | 🏢 Pyme ]│  <- Selector Camaleónico
├────────────────────────────────────────────────────────┤
│  [ TARJETA MAESTRA: PATRIMONIO CONSOLIDADO ]           │
│   $ 4,850.00 USD  /  Bs 218,250.00 (Tasa BCV en vivo)  │
│   Semáforo de Salud a 14 Días: 🟢 LIQUIDEZ BLINDADA    │
├────────────────────────────────────────────────────────┤
│  [ PRÓXIMOS VENCIMIENTOS (Solo lo urgente) ]          │
│   • En 3 días: Cuota Cashea TV ($32.50)                │
│   • En 6 días: Proveedor Pintura ($120.00)             │
├────────────────────────────────────────────────────────┤
│  [ BENTO GRID TÁCTIL (Acceso a Sub-módulos) ]          │
│  ┌───────────────────────┐   ┌───────────────────────┐ │
│  │ 📊 Estadísticas       │   │ ⚡ Calculadora Cashea │ │
│  │    & Analítica        │   │    & Proyector        │ │
│  └───────────────────────┘   └───────────────────────┘ │
│  ┌───────────────────────┐   ┌───────────────────────┐ │
│  │ 🏢 Gestión Pyme       │   │ 📝 Generador de       │ │
│  │    (Inventario/Caja)  │   │    Presupuestos       │ │
│  └───────────────────────┘   └───────────────────────┘ │
├────────────────────────────────────────────────────────┤
│  [ ZONA DE PULGAR (Acciones Rápidas - 44px min) ]      │
│   [ + Ingreso / Sueldo ]  [ - Gasto Rápido ]  [ 🎙️ Voz ]│
└────────────────────────────────────────────────────────┘
```

### Reglas de Diseño y Rendimiento
1. **Zero Clutter (Sin Sobrecarga)**: La pantalla principal no muestra tablas interminables ni gráficos pesados. Solo saldos consolidados, salud de liquidez y accesos directos.
2. **Sección de Estadísticas Independiente**: Los gráficos de Día a Día, Semanal (Heatmap), Mensual (Burn Rate) y Trimestral se cargan de forma *Lazy Loaded* en su propio módulo analítico para mantener la navegación a 60 fps.
3. **Zona de Pulgar Optimizada**: Los botones de acción rápida (`+ Ingreso`, `- Gasto`, `🎙️ Audio`) se ubican en la parte inferior, con un área táctil mínima de 44x44px.
4. **Paleta Homel Obsidian & Champagne Gold**: Fondo obsidiana `#0E1215`, acentos en dorado `#E2B755`, superficies de vidrio esmerilado con contraste WCAG AAA.

---

## 3. ESCUADRÓN DE AGENTES ESPECIALIZADOS

Para garantizar que el sistema opere con inteligencia sin sobrecargar la interfaz, se definen 3 agentes coordinados con `AgentStudioService`:

```
                           ┌───────────────────────────────┐
                           │      USUARIO / OPERADOR       │
                           └───────────────┬───────────────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    ▼                      ▼                      ▼
         ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐
         │ 🎨 UX SENTINEL     │ │ 💼 CFO VIRTUAL     │ │ 📝 QUOTE BUILDER   │
         │    AGENT           │ │    & TESORERÍA     │ │    ARCHITECT       │
         ├────────────────────┤ ├────────────────────┤ ├────────────────────┤
         │ • Ergonomía 9:16   │ • Cruce Sueldo/Ventas│ • Recetas m² y autos │
         │ • Cero saturación  │ • Monitoreo Cashea   │ • Merma técnica 10%  │
         │ • Contraste y 60fps│ • Alertas de quiebre │ • Doble PDF (Cliente │
         │ • Micro-estados UI │ • Burn rate mensual  │   y Rentabilidad)    │
         └────────────────────┘ └────────────────────┘ └────────────────────┘
```

1. **Agente 1: UX & Design Sentinel**: Vigila activamente que la interfaz móvil se mantenga limpia, que los formularios no requieran pasos innecesarios y que cada componente respete el layout 9:16 sin desbordamientos horizontales.
2. **Agente 2: CFO Virtual & Tesorero Proyectivo**: Analiza los dos mundos de tesorería (Personal: empleo/sueldo vs. Pyme: ventas/facturación) junto al profit traído del P2P, y genera alertas tempranas para que el usuario nunca quede ilíquido ante un pago o vencimiento.
3. **Agente 3: Quote & Estimation Architect**: Agente experto en cotizaciones de talleres mecánicos/latonería y obras de construcción civil por m², asegurando cobro de anticipos blindados que cubren el 100% de los materiales.

---

## 4. REGLA DE ORO DE AISLAMIENTO: P2P VS. FINANZAS 360

```
┌───────────────────────────────────────────────┐      ┌───────────────────────────────────────────────┐
│              MESA P2P ARBITRAJE               │      │           PORTAFOLIO FINANCIERO 360           │
│                                               │      │                                               │
│ • Capital de Trabajo Rotativo ($ / Bs)        │      │ • Tesorería Personal (Sueldo, Hogar, Cashea)  │
│ • Cuentas Bancarias de Mesa Operativa         │      │ • Tesorería Pyme (Ventas, Gastos, Gavetas)    │
│ • Órdenes de Compra / Venta en Binance        │      │ • Bóvedas de Ahorro y Patrimonio Neto         │
│ • Base de datos: `p2p.operations`             │      │ • Base de datos aislada: `p2p.finance360.*`   │
└───────────────────────┬───────────────────────┘      └───────────────────────▲───────────────────────┘
                        │                                                      │
                        │       [ BOTÓN UNIDIRECCIONAL EXCLUSIVO ]             │
                        └──────────────────────────────────────────────────────┘
                                "Traer Ganancia Neta P2P del Día"
                              (Solo Profit Neto Positivo Realizado)
```

- **Aislamiento Físico y Lógico**: El módulo de Finanzas 360 **nunca** lee ni escribe transferencias individuales, pagos móviles de arbitraje ni órdenes de Binance.
- **Canal Unidireccional Controlado**: El único puente es el método `importDailyP2pProfit()`, que toma únicamente el monto de ganancia neta positiva consolidada del día y lo asienta como un ingreso limpio en Finanzas 360 bajo la categoría `Ganancia P2P Realizada`.

---

## 5. ESTRUCTURA DE TESORERÍA DUAL: PERSONAL VS. PYME

El selector camaleónico permite alternar entre:

### A. Tesorería Personal
- **Ingresos**: Sueldo fijo de empleo (quincenal/mensual), honorarios independientes, ganancias transferidas del P2P.
- **Gastos Fijos**: Vivienda, servicios públicos, alimentación, salud, compromisos familiares.
- **Financiamientos Personales**: Monitoreo de cuotas Cashea (nivel y porcentaje inicial) y compras a plazos.
- **Fondo de Reserva**: Bóveda protegida para emergencias personales.

### B. Tesorería Pyme / Comercial
- **Ingresos**: Ventas de mostrador, cobro de presupuestos cerrados, abonos de clientes.
- **Gastos Operativos**: Pago de nómina a empleados/ayudantes, alquiler del local, reposición de insumos.
- **Directorio de Proveedores**: Facturas por pagar con fecha límite y abonos parciales.
- **Cortafuegos de 3 Gavetas**:
  1. *Gaveta 1 (Reposición de Mercancía)*: Intocable para asegurar que nunca falte stock.
  2. *Gaveta 2 (Operativa y Nómina)*: Para sueldos, servicios y mantenimiento.
  3. *Gaveta 3 (Utilidad Neta / Mejoras)*: Ganancia limpia y fondo de reinversión/CAPEX.

---

## 6. HOJA DE RUTA DE EJECUCIÓN EN 6 FASES SECUENCIALES

### FASE 1: DOMINIO, MODELOS TRI-MONETARIOS Y ALMACENAMIENTO AISLADO
- **Objetivo**: Diseñar los modelos de datos en TypeScript para los 4 Pilares, sub-módulos y el puente P2P, garantizando persistencia en clave independiente `p2p.finance360.ledger`.
- **Archivos a Crear**:
  1. `src/app/core/models/finance-360.models.ts`: Modelos de `AssetVault`, `LiabilityItem`, `IncomeEntry`, `ExpenseEntry`, `CasheaPlan`, `PymeProvider`, `PymeInventoryItem`, `PymeDrawerAllocation`, `BudgetQuote`.
  2. `src/app/core/finance-360.service.ts`: Store reactivo basado en Angular Signals con métodos CRUD y la función `importDailyP2pProfit()`.
  3. `src/app/core/finance-360.service.spec.ts`: Suite de pruebas unitarias verificando la contabilidad bimonetaria y el aislamiento total con el P2P.
- **Archivos a Conectar**:
  - `src/app/core/accounts.service.ts`: Lectura segura del resumen diario de ganancia P2P.
  - `src/app/core/cotizave.service.ts`: Consulta de tasas oficiales y paralelas al momento del registro.

### FASE 2: MOTOR DE INGESTIÓN MULTIMODAL IA (VISIÓN, VOZ Y RECIBOS EN EFECTIVO)
- **Objetivo**: Habilitar la digitalización automática sin fricción manual: escaneo con Gemini Vision, transcripción de notas de voz a asientos contables y generación de recibos en efectivo.
- **Archivos a Crear**:
  1. `src/app/core/services/finance-ai-ingestor.service.ts`: Integración con Gemini Multimodal para procesar imágenes de facturas y audio de notas de voz.
  2. `src/app/core/services/cash-receipt-generator.service.ts`: Generador de comprobantes internos en PDF para operaciones en efectivo sin comprobante bancario.
  3. `src/app/core/services/cash-receipt-generator.service.spec.ts`: Pruebas de renderizado de comprobantes.
- **Archivos a Conectar**:
  - `src/app/features/receipt-scanner/receipt-scanner.html` & `.ts`: Switch selector `[ Mesa P2P ]` vs. `[ Portafolio 360 ]` con categorización automática asistida por IA.

### FASE 3: INTERFAZ BENTO GRID 9:16 MINIMALISTA & MODO CAMALEÓNICO
- **Objetivo**: Construir la pantalla principal con diseño limpio, ergonómico y ordenado, supervisado por el *UX Sentinel Agent*.
- **Archivos a Crear**:
  1. `src/app/features/finance-360/finance-360.component.ts`: Controlador principal con selector `[ Todos | Personal | Pyme ]` y modales de carga rápida.
  2. `src/app/features/finance-360/finance-360.component.html`: Bento Grid ultra-limpio (Patrimonio, Semáforo de Liquidez a 14 Días, Próximos Vencimientos y Zona de Pulgar).
  3. `src/app/features/finance-360/finance-360.component.scss`: Estilos oscuros institucionales Homel con micro-animaciones a 60fps y adaptación vertical 9:16 estricta.
  4. `src/app/features/finance-360/components/quick-transaction-modal.component.ts` (.html, .scss): Modal táctil de carga rápida en 2 toques.
- **Archivos a Conectar**:
  - `src/app/app.routes.ts`: Registro de la ruta `/finanzas-360` con carga perezosa (*lazy loading*).
  - `src/app/app.html`: Integración limpia en la barra de navegación móvil y menú lateral.

### FASE 4: MOTOR DE ESTADÍSTICAS EN 4 HORIZONTES & ASESOR CFO
- **Objetivo**: Desarrollar el panel de análisis profundo separado de la vista diaria, con métricas de rendimiento, Burn Rate y cono predictivo.
- **Archivos a Crear**:
  1. `src/app/features/finance-360/components/finance-analytics.component.ts` (.html, .scss): Vistas de Día a Día, 7 Días (Heatmap), 12 Meses (Velocímetro de Gasto) y 90 Días (Detector de Inflación).
  2. `src/app/core/services/finance-forecaster.service.ts`: Algoritmos predictivos de flujo de caja, simulación "¿Qué pasa si...?" y alertas del CFO Virtual.
- **Archivos a Conectar**:
  - `src/app/core/market-history.service.ts`: Comparación contra el histórico inflacionario.

### FASE 5: SUB-MÓDULOS ESPECIALIZADOS (CASHEA, GESTIÓN PYME & PRESUPUESTOS)
- **Objetivo**: Implementar las herramientas de negocio con recetas automáticas y control de cuotas quincenales.
- **Archivos a Crear**:
  1. `src/app/features/finance-360/submodules/cashea-calculator/cashea-calculator.component.ts` (.html, .scss): Motor de cuotas cada 14 días con alertas de colisión de sueldos y simulador de compras a crédito vs. ahorro contado.
  2. `src/app/features/finance-360/submodules/pyme-manager/pyme-manager.component.ts` (.html, .scss): Directorio de proveedores, inventario semáforo y regla de las 3 gavetas intocables.
  3. `src/app/features/finance-360/submodules/quote-builder/quote-builder.component.ts` (.html, .scss): Cotizador de taller de latonería/pintura y obras por m² con +10% de merma técnica y exportador de Doble PDF (Cliente e Interno).
- **Archivos a Conectar**:
  - `src/app/core/agent-studio.service.ts`: Registro del Agente de Cotizaciones y el Escuadrón Pyme.

### FASE 6: CONEXIÓN CON TELEGRAM Y SINCRONIZACIÓN GOOGLE DRIVE / SHEETS
- **Objetivo**: Automatizar el flujo exterior mediante el bot de Telegram y asegurar respaldo automático estructurado en la nube.
- **Archivos a Crear**:
  1. `src/app/core/services/finance-telegram-bridge.service.ts`: Enrutamiento inteligente de audios, fotos y notas enviadas por Telegram (`#gasto`, `#ingreso`, `#cashea`, `#presupuesto`).
  2. `src/app/core/services/finance-drive-sync.service.ts`: Organización en Google Drive por `/Finanzas_360/Año/Mes/Categoría/` y actualización del Libro Maestro en Excel (.xlsx).
- **Archivos a Conectar**:
  - `src/app/core/telegram-worker.service.ts`: Captura de eventos entrantes de Telegram.
  - `src/app/core/mcp.service.ts`: Llamadas a herramientas MCP de Google Drive y Sheets.

---

## 7. MATRIZ DE RIESGO Y CONTROL ARQUITECTÓNICO

| Riesgo Identificado | Estrategia de Mitigación |
| :--- | :--- |
| **Contaminación del flujo P2P con gastos cotidianos** | Almacenamiento en clave `p2p.finance360.ledger`. Ninguna transacción P2P entra automáticamente; solo existe el botón de ganancia neta diaria consolidada. |
| **Sobrecarga visual y lentitud en Android 9:16** | Principio de Revelación Progresiva: la vista inicial es un resumen ejecutivo liviano. Estadísticas, Cashea y Pyme son rutas *lazy loaded*. Formatos táctiles de mínimo 44x44px. |
| **Devaluación monetaria entre presupuestos y cobranzas** | Registro tri-monetario: cada movimiento guarda monto en Bs, tasa BCV, tasa paralela y contravalor exacto en USD congelado en el momento. |
| **Colisión quincenal de cuotas Cashea con pagos fijos** | Semáforo de alerta temprana cuando las cuotas de los próximos 14 días superen el 35% del ingreso proyectado. |
| **Pérdida de comprobantes o desorden contable** | Clasificación jerárquica en Drive con enlaces directos desde cada registro en la aplicación. |
