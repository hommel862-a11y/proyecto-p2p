# Plan de Evolución Arquitectónica — Fase 2 (Resiliencia, Riesgo y UX)

## 1. Fundamentos Conceptuales de las Mejoras

### A. Resiliencia de Red: Circuit Breaker + Exponential Backoff con Jitter
- **El Problema**: En redes inestables o con alta latencia (escenario habitual en conexiones locales hacia APIs internacionales como Binance P2P o Cotizave), los reintentos lineales inmediatos saturan los sockets y disparan rate limits (429/403). Si el proveedor está caído, la app se congela esperando timeouts repetidos.
- **La Solución Arquitectónica**:
  - **Circuit Breaker (Máquina de Estados Finita)**:
    - `CLOSED`: Operación normal. Si los fallos superan un umbral (ej. 5 seguidos), el circuito se abre.
    - `OPEN`: Rechazo inmediato durante un tiempo de enfriamiento (ej. 30s) devolviendo datos cacheados (*stale-while-revalidate*) sin enviar paquetes inútiles a la red.
    - `HALF_OPEN`: Permite una petición de prueba. Si responde con éxito, se restablece a `CLOSED`; si falla, vuelve a `OPEN`.
  - **Exponential Backoff con Full Jitter**:
    - Retardo exponencial: `delay = Math.min(maxDelay, baseDelay * 2^attempt)`.
    - Jitter aleatorio: Rompe la sincronización de peticiones en ráfagas concurrentes evitando el efecto manada (*thundering herd*).

### B. Gestión Dinámica de Riesgo por Portafolio
- **El Problema**: Las reglas actuales en `@p2p/core/rules.ts` son estáticas (ej. "spread mínimo >= 0.5%"). No dimensionan el riesgo en proporción al balance total del operador: arriesgar 2.000 USD en una sola contraparte es irrelevante para una tesorería de 50.000 USD, pero catastrófico para una de 3.000 USD.
- **La Solución Arquitectónica**:
  - Evaluación contextual de concentración: `Riesgo = Monto_Operacion / Capital_Total_Consolidado`.
  - Si supera el umbral configurado (ej. 10% del portafolio en una sola transacción o 25% acumulado en un mismo banco), el motor de reglas emite `WARN_CONCENTRATION` o `DENY_OVEREXPOSURE`.

### C. Motor de Backtesting Puro en `@p2p/core`
- **El Problema**: El operador define umbrales de spread a ciegas o por intuición. `scripts/backtest.cjs` existe como script aislado de consola, inaccesible desde la interfaz de usuario.
- **La Solución Arquitectónica**:
  - Un módulo funcional puro en `@p2p/core`: `simulateStrategy(history: MarketPoint[], strategyConfig: StrategyParams): BacktestSummary`.
  - Calcula métricas cuantitativas clave: Win Rate, PnL simulado, Drawdown máximo, y tiempo promedio por ciclo.
  - Exposición en el frontend para optimizar parámetros antes de arriesgar dinero real.

### D. Auditoría de Accesibilidad (a11y) en CI
- **El Problema**: En interfaces financieras densas, la falta de navegación por teclado y contraste adecuado genera fatiga y errores operativos graves bajo estrés (ej. disparar una confirmación errónea sin foco visible).
- **La Solución Arquitectónica**:
  - Reglas de axe-core ejecutadas en la suite E2E de Playwright sobre flujos críticos (cambio de estado de órdenes, confirmación de pagos, alertas de riesgo).
  - Bloqueo en CI (GitHub Actions) si se introducen regresiones de accesibilidad (violaciones WCAG 2.1 AA).

### E. Onboarding y Ergonomía Cognitiva para Usuarios No Técnicos
- **El Problema**: El sistema cuenta con decenas de herramientas MCP, centinela de Telegram y semáforos de riesgo; un usuario no técnico puede sentirse abrumado e ignorar alertas vitales.
- **La Solución Arquitectónica**:
  - Tooltips contextuales ligeros y un asistente guiado no invasivo que desmitifica los conceptos (ej. qué significa el gap cambiario BCV vs Paralelo y cómo actuar ante un arbitraje triangular).

---

## 2. Plan de Implementación por Fases

| Fase | Alcance | Entregables Principales | Impacto |
|---|---|---|---|
| **Fase 1** | **Resiliencia de Red** | Módulo puro `CircuitBreaker` en `@p2p/core`, wrappers con backoff + jitter para Binance/Cotizave en Angular y Electron bridge, pruebas unitarias exhaustivas. | Inmediato (Cero cuelgues por cortes de red). |
| **Fase 2** | **Riesgo por Portafolio** | Ampliación de `rules.ts` con reglas dinámicas basadas en `CapitalAllocator`, alertas de concentración en UI y bot Telegram. | Alto (Protección del capital del trader). |
| **Fase 3** | **Motor de Backtesting** | Migración de la lógica de `backtest.cjs` a motor tipado en `@p2p/core`, panel visual de simulación en la app. | Estratégico (Optimización cuantitativa de spreads). |
| **Fase 4** | **a11y en CI & Onboarding** | Integración de `@axe-core/playwright` en CI, tooltips interactivos y micro-guías en componentes clave. | Calidad & Usabilidad (Reducción de error humano). |
