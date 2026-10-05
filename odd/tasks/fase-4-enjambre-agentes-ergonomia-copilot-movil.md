# Fase 4: Sincronización del Enjambre de Agentes & Ergonomía del Copiloto en Teléfono

## Objetivo

Consolidar la arquitectura multi-agente y la interacción táctil en dispositivos móviles (Capacitor/Android/iOS):
1. **Ejecución Completa del Enjambre de 4 Agentes en Modo Autónomo / Standalone**:
   - Actualmente, `triggerSwarmAnalysis()` en `src/app/features/copilot/copilot.ts` solo ejecuta el enjambre completo cuando el bridge de Electron está presente; en móviles o web solo mostraba un mensaje simulado sin ejecutar el pipeline.
   - Implementar el motor de enjambre multi-agente en el cliente frontend cuando no hay puente Electron:
     - **Sentinel Stage**: Audita tasas en vivo de `TriangulationIntelligenceService`, calcula spread bruto y neto (restando comisiones y fricciones).
     - **Strategist Stage (Gentleman AI)**: Evalúa la ruta táctica de arbitraje y formula la propuesta algorítmica.
     - **Risk Gatekeeper Stage**: Audita el snapshot real de tesorería de `AccountsService` y aplica veto unilateral institucional (`overLimit`, `disabled`, `saturated`, o regla de oro de spread < 0.50% neto o kill-switch activo).
     - **Dispute & Proof Auditor Stage**: Verifica estado de mediaciones o contrapartes.
     - **Generación de Plan SOP**: Crea la tarjeta de estrategia interactiva (`StrategyPlanCard`) con desglose de 3 pasos, VaR estocástico y desglose financiero.
     - **Actualización de Telemetría**: Actualiza `swarmHealth` (ops procesadas, estado) y publica el dictamen en el feed de chat.
2. **Ergonomía Móvil y Manejo de Teclado**:
   - Asegurar que la barra de input (`.input-container`) y el botón táctil de voz (`.btn-mic`) mantengan accesibilidad táctil fluida (mínimo 44px de área de toque) con auto-scroll reactivo al enfocar el input (`focus`).
   - Sincronización con el Drawer de Acciones Rápidas y Métricas (`mobileSheetOpen`).

## Criterios de Aceptación y Pruebas

- Pruebas unitarias de `copilot.spec.ts` cubriendo la ejecución de `triggerSwarmAnalysis` tanto en entorno con Electron como en entorno standalone (móvil/web) con verificación de veto por tesorería y aprobación con spread favorable.
- 100% de tests pasando en Angular (`npm test -- --watch=false`).
- 100% de tests pasando en Electron (`npm run test:electron`).
- 25/25 archivos sincronizados en `npm run check:vendor`.
- Cero errores de compilación TypeScript (`tsconfig.app.json` y `tsconfig.spec.json`).
