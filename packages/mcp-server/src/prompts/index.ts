/**
 * Prompts MCP — Plantillas versionadas para análisis, auditoría y toma de decisiones.
 * Patrón simple: array estático consumido directamente por server.ts.
 */

export interface McpPrompt {
  name: string;
  description: string;
  content: string;
}

export const ALL_MCP_PROMPTS: McpPrompt[] = [
  {
    name: 'daily-p2p-audit',
    description: 'Auditoría diaria completa de actividad P2P (PnL, riesgo, fills, alertas)',
    content: `# Auditoría Diaria P2P

## Tu Tarea
Genera un reporte ejecutivo de auditoría diaria para el trader P2P (VES/USDT, Venezuela). Incluye:

1. **Resumen Ejecutivo** (3 líneas máx): PnL neto, status de riesgo, alertas críticas.
2. **PnL Detallado**: Bruto, neto (después de fees), por banco, por contraparte.
3. **Análisis de Riesgo**: Exposición actual vs límites, racha actual, win rate 7d, reglas cerca de romperse.
4. **Calidad de Fills**: Tiempo promedio, slippage, fills fallidos, disputas.
5. **Anomalías Detectadas**: Spoofing, liquidez fantasma, spread anómalo, intervención BCV inminente.
6. **Acciones Recomendadas**: Ajustes de tamaño, cambio de banco, pausa, aumento de exposición.

Formato: Markdown estructurado, listo para copiar a Notion/Obsidian.`,
  },
  {
    name: 'weekly-risk-review',
    description: 'Revisión semanal profunda de riesgo, exposición y ajustes de parámetros',
    content: `# Revisión Semanal de Riesgo

## Análisis Requerido

1. **Exposición vs Límites**: ¿Se acercaron o rompieron límites? ¿Cuántas veces?
2. **Rachas**: ¿Hubo racha de pérdidas? ¿Cuánto duró? ¿Se recuperó?
3. **Win Rate**: Evolución día a día. ¿Hubo día crítico?
4. **Distribución por Banco**: ¿Hay banco con fills consistentemente lentos o disputas?
5. **Contrapartes**: ¿Nuevas contrapartes? ¿Alguna con dispute rate > 10%?
6. **Anomalías de Mercado**: ¿Spoofing/liquidez fantasma?
7. **Contexto Macro**: ¿Intervención BCV? ¿Spread anormal?

## Ajustes Propuestos
- ¿Subir/bajar maxExposure?
- ¿Ajustar maxDailyLoss?
- ¿Modificar maxLossStreak?
- ¿Cambiar minWinRate?

## Plan de Acción Próxima Semana
- 3 acciones concretas prioritarias.`,
  },
  {
    name: 'monthly-apr-target',
    description: 'Tracking de objetivo APR mensual vs real, análisis de desviaciones',
    content: `# Tracking APR Mensual

## Cálculo APR
- Capital inicial mes: [extraer de ledger]
- PnL neto mes: [extraer]
- APR realizado: (PnL / Capital) × 12 × 100%
- Objetivo: 15% mensual

## Análisis de Desviación
- ¿Cumplió objetivo? ¿Por cuánto?
- Drivers: Más volumen? Mejor spread? Menos disputas?

## Atribución
- Por banco: ¿Qué banco aportó más alpha?
- Por contraparte: Top 3 por PnL
- Por horario: ¿Qué franja horaria rindió más?

## Lecciones y Ajustes
- 3 cosas que funcionaron → replicar.
- 3 cosas que fallaron → evitar.`,
  },
  {
    name: 'pre-trade-checklist',
    description: 'Checklist conversacional pre-trade (validación de riesgo, sizing, contraparte)',
    content: `# Checklist Pre-Trade

## Verificaciones
1. □ Verdict = ALLOW (no DENY/PAUSE)
2. □ Tamaño ≤ recommendedSize del motor
3. □ No rompe EXPOSURE_CAP ni DAILY_LOSS_LIMIT
4. □ Contraparte trustScore > 0.7 (si aplica)
5. □ Banco sin anomalía de liquidez
6. □ Spread actual > fee + slippage estimado
7. □ Kill-switch INACTIVO
8. □ Horario dentro de ventana óptima (09:00-18:00 VET)
9. □ No hay alerta CRITICAL activa
10. □ Capital disponible para cubrir disputa potencial

## Decisión Final
- Si TODAS SÍ → EJECUTAR
- Si alguna NO → REVISAR/BLOQUEAR

## Output Requerido
- DECISIÓN: EJECUTAR / REVISAR / BLOQUEAR
- RAZÓN: Una frase.
- SIZING FINAL: Monto exacto.`,
  },
  {
    name: 'dispute-preparation',
    description: 'Guía paso a paso para preparar evidencia y abrir disputa en Binance',
    content: `# Preparación de Disputa Binance

## Pasos Requeridos

### 1. Clasificación
- Tipo: No pago / Pago parcial / Pago falso / Reverso / Otro
- Monto en disputa
- Tiempo transcurrido

### 2. Evidencia Requerida
- [ ] Captura de chat Binance (timestamps visibles)
- [ ] Comprobante bancario (PDF oficial)
- [ ] Captura de orden Binance
- [ ] Captura de perfil contraparte
- [ ] Hash SHA256 de cada archivo

### 3. Narrativa para Binance
> Asunto: Disputa [orden] — [tipo]
> Resumen: [vendedor/comprador] no [pagó/liberó] [monto] en [tiempo].
> Evidencia adjunta: [archivos con hashes]
> Solicitud: Liberación/reembolso + penalización contraparte.

### 4. Timeline
- T+0: Abrir disputa (botón "Apelar")
- T+15min: Adjuntar evidencia
- T+1h: Seguimiento chat
- T+24h: Si sin respuesta → Escalar soporte Binance
- T+72h: Si sin resolución → Reporte legal

### 5. Post-Disputa
- [ ] Registrar outcome en ledger
- [ ] Actualizar trustScore de contraparte
- [ ] Documentar lección en memoria`,
  },
  {
    name: 'bcv-gap-arbitrage-audit',
    description:
      'Auditoría macroeconómica y cambiaria de brecha BCV vs Paralelo para arbitraje institucional en Venezuela',
    content: `# Auditoría de Brecha Cambiaria BCV vs. Paralelo (Venezuela)

## Contexto Operativo
Evalúa las condiciones cambiarias en Venezuela analizando la brecha entre la tasa oficial del BCV y los monitores paralelos (Binance P2P, CotizaVe, EnParaleloVzla).

## Directivas Requeridas:
1. **Métricas Clave**:
   - Tasa Oficial BCV vigente (USD/EUR)
   - Tasa Promedio Paralela y dispersión inter-monitores
   - Brecha porcentual actual y zona de clasificación (COMPRESSED / NORMAL / ELEVATED / CRITICAL_DISPERSION)
2. **Ventana de Intervención Cambiaria**:
   - Fase estimada del ciclo de intervención del BCV (horario bancario 09:00 - 13:00 VET)
   - Probabilidad estimada de colocación de divisas e impacto esperado en el paralelo
3. **Estrategia de Tesorería e Inventario**:
   - Recomendación táctica (DEFENSIVE_HEDGE, ACCUMULATE_VES_HIGH, BUY_USDT_DIP, AGGRESSIVE_CYCLE_VES)
   - Límites máximos sugeridos de exposición en bolívares (VES)
4. **Parámetros de Pricing para Anuncios P2P**:
   - Precios sugeridos de compra y venta de USDT con margen objetivo aplicado`,
  },
  {
    name: 'crypto-orderbook-pressure-audit',
    description:
      'Auditoría de microestructura, desbalance de órdenes y pricing competitivo para el libro P2P de Binance',
    content: `# Auditoría de Microestructura y Presión de Libro P2P (Binance VES/USDT)

## Contexto de Operación
Evalúa la microestructura del mercado P2P para detectar desbalances de liquidez, presión direccional, riesgo de spoofing y determinar el posicionamiento óptimo de anuncios Maker.

## Directivas Requeridas:
1. **Inspección de Profundidad**:
   - Snapshot actual de mejores ofertas de compra (bids) y venta (asks)
   - Spread nominal en VES y porcentual
   - Volumen acumulado disponible por lado
2. **Análisis de Presión y Desbalance**:
   - Ratio de desbalance (Bid vs Ask)
   - Régimen de mercado (BULLISH_LOCAL_DEMAND / BEARISH_LOCAL_SUPPLY / BALANCED_LIQUIDITY)
   - Detección de órdenes señuelo (spoofing) o liquidez fantasma
3. **Estrategia de Pricing Competitivo**:
   - Posición objetivo recomendada (TOP_1 / TOP_2 / MATCH)
   - Precio exacto sugerido para anuncio Maker (BUY / SELL)
   - Margen proyectado neto y cumplimiento estricto del piso break-even
4. **Verificación de Paridad Global**:
   - Confirmación del estado de paridad del USDT (PEGGED vs DEPEG)`,
  },
  {
    name: 'portfolio-risk-rebalance-audit',
    description:
      'Auditoría integral de gestión de portafolio, pruebas de estrés cambiario, asignación bancaria y crecimiento compuesto',
    content: `# Auditoría de Gestión de Portafolio y Riesgo Cambiario (Venezuela P2P)

## Contexto Operativo
Evalúa la salud financiera del inventario de capital, la exposición ante saltos devaluatorios del bolívar, la concentración de contrapartes y la capacidad bancaria instalada.

## Directivas Requeridas:
1. **Prueba de Estrés Cambiario**:
   - Capital expuesto en bolívares (VES) y porcentaje sobre el patrimonio total
   - Simulación de pérdidas ante devaluación del 5%, 10% y 20%
   - Tamaño requerido de cobertura corta Delta-Neutral en futuros/spot
2. **Rebalanceo de Custodia y Bancos**:
   - Distribución porcentual entre Binance P2P, Banesco, Mercantil y fondos de reserva
   - Ajuste de tickets dinámicos (anti-pitufeo) según el horario y régimen de mercado
3. **Auditoría de Contrapartes y Triangulación**:
   - Concentración máxima por contraparte individual (límite institucional < 20%)
   - Identificación de discrepancias de titularidad bancaria vs KYC
4. **Proyección de Crecimiento Compuesto y Runway**:
   - Estimación de capital final a 30, 60 y 90 días
   - Detección del "muro de capacidad bancaria" (día en que el volumen diario supera el límite bancario)
   - Cobertura de costos fijos mensuales`,
  },
];

// ─── Registro en servidor (compatibilidad) ─────────────────────────────────────

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Registra prompts directamente en el servidor MCP.
 * Útil si se usa index.ts en vez de server.ts.
 */
export function registerPrompts(server: McpServer) {
  for (const p of ALL_MCP_PROMPTS) {
    server.prompt(p.name, p.description, () => ({
      messages: [
        {
          role: 'user',
          content: { type: 'text' as const, text: p.content },
        },
      ],
    }));
  }
}
