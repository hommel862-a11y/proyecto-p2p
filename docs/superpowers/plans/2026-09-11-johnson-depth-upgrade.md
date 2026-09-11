# Upgrade del Plugin Johnson Market Depth — Plan de Implementación v2 (integración con motores existentes)

> **Para agentes de trabajo (Antigravity/agentic):** Ejecutar el plan tarea por tarea. Cada tarea es autocontenida con ciclo TDD (test → ver fallo → implementar → ver pasar → commit). Usar checkbox (`- [ ]`) para tracking. No saltarse pasos. No "optimizar" la API pública definida sin cambiar este documento primero.
>
> **REGLA DE ORO — NO ROMPER LO EXISTENTE:** este plan **solo crea 4 archivos nuevos** (`johnson-depth.ts`, `johnson-depth.spec.ts`, `johnson-depth-rate-window.ts`, `johnson-depth-rate-window.spec.ts`), **solo modifica 2** (`public-api.ts` añadiendo 2 exports, `plugins/johnson-depth/plugin.ts` reescrito). **NUNCA modificar** los módulos que se consumen: `spread-quality.ts`, `cotizave.ts`, `triangular-arbitrage.ts`, `operator-manager.ts`, `accounts.ts`, `binance-p2p.ts`, `money.ts`. Los 289 tests existentes y el build deben seguir pasando igual al final.

**Goal:** Convertir el plugin `johnson-depth` de un boceto roto a un motor funcional de análisis de mercado: scoring de calidad corregido, **ganancia NETA por banco** (reutilizando `computeArbitrageCycle` + `VENEZUELAN_BANK_FEES`), profundidad volumétrica con filtros anti-manipulación, y ventana de arbitraje BCV/paralelo construida sobre `computeTriangulationGap` — todo como lógica pura testeable en `@p2p/core` con un adaptador delgado como plugin.

**Architecture:** Toda la lógica vive en `projects/core/src/lib/` como módulos TypeScript puros, framework-agnostic (patrón del repo). El plugin `plugins/johnson-depth/plugin.ts` queda como capa delgada (consumo de `@p2p/core`, contrato `cleanup()` del registry, enforcement de `maxConsecutiveErrors`). Corrección de raíz de los 4 bugs del plugin actual: `context` fuera de scope, campos inexistentes, `marketDepth.subscribe()` inexistente, dependencia de `PluginAutoLoaderService` inexistente.

**Tech Stack:** TypeScript strict (Angular 22), `@p2p/core` (librería pure), `@angular/build:unit-test` (vitest), `roundMoney` de `./money` (verificado línea 28), `computeArbitrageCycle`/`VENEZUELAN_BANK_FEES` de `./spread-quality`, `BankCode` de `./accounts`, `MINIMUM_VIABLE_NET_SPREAD_PCT` de `./operator-manager` (0.50), `computeTriangulationGap` de `./cotizave`, `BinanceP2pMarketDepth`/`BinanceOfferSummary`/`BINANCE_PAY_METHODS` de `./binance-p2p`.

**Spec:** Este plan ES la especificación. Referencias: `projects/core/references/plugin-registry-pattern.md`, plugin actual `plugins/johnson-depth/plugin.ts`, registry `projects/core/src/lib/plugin-registry.ts` (líneas 188-202 ejecutan `module.cleanup()` al descargar).

---

## Global Constraints

- **Solo crear 4 archivos, modificar 2.** Ver REGLA DE ORO arriba. Cualquier otro archivo que parezca necesitarse → STOP, preguntar.
- **Sin Angular en el core:** los módulos de `projects/core/src/lib/` NO importan Angular, solo TypeScript puro. Cero decoradores, cero `inject`.
- **`computeArbitrageCycle` LANZA excepción** si `capitalUsdt <= 0 || buyPrice <= 0 || sellPrice <= 0` — SIEMPRE guardar antes de llamarlo (nunca llamar sin verificar `fillableUsdt > 0`, `buy.price > 0`, `sell.price > 0`).
- **Tests obligatorios:** cada función nueva vive junto a su `*.spec.ts`. Los pasos TDD no son opcionales.
- **TypeScript strict:** campos opcionales requieren manejo explícito (`?? 0`, guardas). No usar `any` en firmas públicas (en tests sí está permitido para fixtures con `as any`).
- **`roundMoney` existente:** importar de `'./money'` para todo redondeo monetario.
- **No tocar el preload de Electron** con `tsc` directo — nunca. Si hubiera algún cambio de preload (no debería), usar `node electron/build-preload.cjs`.
- **Nada visual cambia:** este plan NO toca la UI. La única tarea que tocaría la app (`spread-monitor`) es la Task 7 y está marcada **opcional con aprobación previa obligatoria**.
- **Commits frecuentes:** un commit por tarea, mensajes estilo repo (`feat:`, `fix:`, `refactor:`).
- **Rama de trabajo:** `feat/p2p-decision-tool-mvp` (la actual). No crear ramas nuevas sin aprobación.

---

## Decisiones arquitectónicas (leer antes de empezar)

D1. **johnson-depth vs `computeSpreadQualityScore` (spread-quality.ts):** son COMPLEMENTARIOS, no rivales. `computeSpreadQualityScore` evalúa inputs de operación amplios (margen neto, velocidad de banco, límites de cuenta). `calculateDepthQuality` evalúa microestructura del libro EN VIVO (profundidad por lado, spread del momento). **No acoplar** uno al otro en este plan; `spread-quality.ts` no se modifica. Unificación futura = fuera de alcance.

D2. **Fuente de verdad del gap P2P-vs-paralelo:** `computeTriangulationGap` (cotizave.ts línea 121). `johnson-depth-rate-window.ts` **lo reutiliza** y solo añade lo que no existe: momentum temporal de la tasa y dirección de señal. No duplicar la fórmula.

D3. **`triangular-arbitrage.ts` existe** y está exportado en public-api (línea 34). Antes de implementar Task 4 hay que leer su API: si ya expone una señal de ventana/divergencia equivalente, preferirla y NO crear `detectRateDivergence` (solo documentar el mapping). Paso de verificación obligatorio en Task 4 Step 1.

D4. **Banco vs método de pago:** `BINANCE_PAY_METHODS` (filtro de ofertas P2P) y `BankCode` (tabla de fees) son dominios distintos. Claves de banco válidas para fees: `BANESCO`, `MERCANTIL`, `BDV`, `BANCAMIGA`, `PROVINCIAL`, `OTRO`. `'ALL'` y `'PAGO_MOVIL'` **no son bancos**: `computeBankProfits` los mapea a `OTRO` para fees (conservador) y `'ALL'`/`OTRO` sin filtro de payMethod (todas las ofertas).

D5. **Roles Binance P2P TAKER por defecto:** al analizar el libro existente se TOMAN ofertas (TAKER, fee Binance 0%), no se crean anuncios (MAKER 0.25%). Los roles son configurables como input del motor.

---

## File Structure

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `projects/core/src/lib/johnson-depth.ts` | Motor: profundidad volumétrica + anti-manipulación, scoring, ganancia NETA por banco, quality agregado | **Crear** |
| `projects/core/src/lib/johnson-depth.spec.ts` | Tests del motor | **Crear** |
| `projects/core/src/lib/johnson-depth-rate-window.ts` | Ventana de arbitraje sobre `computeTriangulationGap` + momentum | **Crear** |
| `projects/core/src/lib/johnson-depth-rate-window.spec.ts` | Tests de la ventana | **Crear** |
| `projects/core/src/public-api.ts` | Añadir 2 exports nuevos (los demás ya están) | **Modificar** |
| `plugins/johnson-depth/plugin.ts` | Adaptador delgado: consume `@p2p/core`, `cleanup()`, `maxConsecutiveErrors` | **Reescribir** |

**NUNCA tocar:** `spread-quality.ts`, `cotizave.ts`, `triangular-arbitrage.ts`, `operator-manager.ts`, `accounts.ts`, `binance-p2p.ts`, `money.ts`, `spread-monitor.*`, ni configs.

---

## Task 0: Verificación de entorno (5 min, evita el primer muro)

**Files:** ninguno (solo comandos de lectura).

- [x] **Step 1: Confirmar el comando de test por archivo**

Decisión: Usar `npx vitest run <archivo>` (ejecuta en ~50ms de forma nativa).

- [x] **Step 2: Confirmar que `roundMoney` y `BankCode` son importables**

Verificado:
- `projects/core/src/lib/money.ts`: `roundMoney` ✓
- `projects/core/src/lib/accounts.ts`: `BankCode` ✓
- `projects/core/src/lib/operator-manager.ts`: `MINIMUM_VIABLE_NET_SPREAD_PCT = 0.50` ✓

- [x] **Step 3: Confirmar inclusión de `plugins/` en algún tsconfig**

Verificado: `plugins/` no está en tsconfig. Se usará verificación manual en Task 6 Step 2 sin modificar configs.

- [x] **Step 4: Registrar el estado base (para no romper nada)**

Verificado: working tree limpio (solo docs/), 311 tests de core pasando, build EXIT 0.

- [x] **Step 5: Commit (solo si algo del paso 4 reveló un cambio no intencionado — normalmente NO hay nada que commitear)**

---

## Task 1: `computeVolumeWeightedPrice` — profundidad volumétrica + filtros anti-manipulación

**Files:**
- Create: `projects/core/src/lib/johnson-depth.ts` (algunas interfaces de `BinanceOfferSummary`/`BinanceP2pMarketDepth` se importan de `./binance-p2p`)
- Test: `projects/core/src/lib/johnson-depth.spec.ts`

**Interfaces:**
- Produces: `JohnsonDepthOptions` (abajo) y `computeVolumeWeightedPrice(offers, side, targetUsdt, options?) → { price, fillableUsdt }`

Concepto clave de dirección (para no equivocarse):
- `depth.sellOffers` = ofertas de VENTA de USDT (vendedores) → contra-partes para **COMPRAR** USDT (lado `'BUY'`). Mejor precio = el **más bajo**.
- `depth.buyOffers` = ofertas de COMPRA de USDT (compradores) → contra-partes para **VENDER** USDT (lado `'SELL'`). Mejor precio = el **más alto**.

- [x] **Step 1: Escribir el test que falla**
- [x] **Step 2: Correr el test y verificar que falla**
- [x] **Step 3: Implementación mínima**
- [x] **Step 4: Correr el test y verificar que pasa**
- [x] **Step 5: Commit**

```ts
// projects/core/src/lib/johnson-depth.spec.ts
import { describe, it, expect } from 'vitest';
import { computeVolumeWeightedPrice } from './johnson-depth';
import type { BinanceOfferSummary } from './binance-p2p';

function makeOffers(prices: number[], maxVesEach: number, finishRate = 100): BinanceOfferSummary[] {
  return prices.map((price, i) => ({
    advNo: `adv-${i}`,
    price,
    merchantName: `M${i}`,
    finishRatePct: finishRate,
    orderCount: 10,
    minVes: 100,
    maxVes: maxVesEach,
    payMethods: ['Banesco'],
  }));
}

describe('computeVolumeWeightedPrice', () => {
  it('compra: pondera por volumen disponible y usa el mejor precio primero', () => {
    const offers = makeOffers([800, 820], 500 * 800); // 2 vendedores: 500 y 500 USDT
    const res = computeVolumeWeightedPrice(offers, 'BUY', 600);
    expect(res.fillableUsdt).toBe(600);
    expect(res.price).toBeCloseTo(803.33, 2);
  });

  it('venta: usa el precio más alto primero (compradores)', () => {
    const offers = makeOffers([800, 825], 500 * 800);
    const res = computeVolumeWeightedPrice(offers, 'SELL', 300);
    expect(res.fillableUsdt).toBe(300);
    expect(res.price).toBe(825);
  });

  it('si no alcanza el objetivo, devuelve el fillable real (liquidez insuficiente)', () => {
    const offers = makeOffers([800], 100 * 800);
    const res = computeVolumeWeightedPrice(offers, 'BUY', 500);
    expect(res.fillableUsdt).toBe(100);
    expect(res.price).toBe(800);
  });

  it('con ofertas vacías devuelve price 0 y fillable 0', () => {
    const res = computeVolumeWeightedPrice([], 'BUY', 500);
    expect(res.price).toBe(0);
    expect(res.fillableUsdt).toBe(0);
  });

  it('respeta maxVes por oferta (no sobrepasa el tope de cada comerciante)', () => {
    const many = Array.from({ length: 4 }, (_, i) => ({
      advNo: `a${i}`,
      price: 800,
      merchantName: `M${i}`,
      finishRatePct: 100,
      orderCount: 5,
      minVes: 50,
      maxVes: 50 * 800,
      payMethods: ['Banesco'],
    }));
    const res = computeVolumeWeightedPrice(many, 'BUY', 500);
    expect(res.fillableUsdt).toBe(200); // 4 ofertas * 50 USDT
  });

  it('rechaza ofertas con precio outlier (anti-manipulación)', () => {
    // 2 ofertas normales + 1 absurda (precio 10x) que no debe distorsionar
    const offers = [...makeOffers([800, 810], 500 * 800), makeOffers([8000], 50 * 8000)[0]];
    const res = computeVolumeWeightedPrice(offers, 'BUY', 900);
    expect(res.fillableUsdt).toBe(900); // la outlier queda fuera por filtro de mediana
    expect(res.price).toBeGreaterThan(800);
    expect(res.price).toBeLessThan(810); // el precio promedio no se infla a miles
  });

  it('filtra por finishRatePct mínimo (anti-fake) cuando se pide', () => {
    const buenos = makeOffers([810, 820], 500 * 810, 98);
    const malos = makeOffers([800], 500 * 800, 40); // barato pero con 40% de culminación
    const offers = [...buenos, ...malos];
    const sinFiltro = computeVolumeWeightedPrice(offers, 'BUY', 1000, {});
    const conFiltro = computeVolumeWeightedPrice(offers, 'BUY', 1000, { minFinishRatePct: 90 });
    expect(sinFiltro.fillableUsdt).toBe(1000);
    expect(conFiltro.fillableUsdt).toBe(1000); // mismo volumen total...
    expect(conFiltro.price).toBeGreaterThan(sinFiltro.price); // ...pero el barato fake ya no pesa
    expect(conFiltro.price).toBeCloseTo((500 * 810 + 500 * 820) / 1000, 2);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx ng test --include projects/core/src/lib/johnson-depth.spec.ts`
Expected: FAIL — `Cannot find module './johnson-depth'`.

- [ ] **Step 3: Implementación mínima**

```ts
// projects/core/src/lib/johnson-depth.ts
/**
 * Johnson Market Depth — motor de análisis de profundidad para P2P Decisor.
 * Lógica pura, framework-agnostic. Consume los shapes reales de ./binance-p2p.
 * SOLO este archivo y su spec se crean en esta Task; el resto de funciones llegan en Tasks 2-3.
 */
import {
  BINANCE_PAY_METHODS,
  type BinanceOfferSummary,
  type BinanceP2pMarketDepth,
} from './binance-p2p';
import { roundMoney } from './money';

export interface JohnsonDepthOptions {
  /** Ofertas con precio fuera de [mediana / factor, mediana * factor] se ignoran (anti-manipulación). Default 3. */
  maxPriceDeviationFactor?: number;
  /** Ofertas con finishRatePct < umbral se ignoran (anti-fake). Default 0 = sin filtro. */
  minFinishRatePct?: number;
}

/**
 * Calcula el precio promedio ponderado por volumen que realmente obtendrías
 * al operar `targetUsdt`, consumiendo ofertas del mejor precio hacia abajo,
 * tras descartar outliers de precio y ofertas de reputación baja.
 * @param offers Ofertas del lado correcto (sellOffers para comprar, buyOffers para vender)
 * @param side 'BUY' compras USDT (vendedores, precio menor primero); 'SELL' vendes USDT (compradores, precio mayor primero)
 * @param targetUsdt USDT objetivo
 * @param options Filtros anti-manipulación opcionales
 */
export function computeVolumeWeightedPrice(
  offers: readonly BinanceOfferSummary[],
  side: 'BUY' | 'SELL',
  targetUsdt: number,
  options: JohnsonDepthOptions = {},
): { price: number; fillableUsdt: number } {
  const maxDeviation = options.maxPriceDeviationFactor ?? 3;
  const minFinishRate = options.minFinishRatePct ?? 0;

  if (!offers || offers.length === 0 || targetUsdt <= 0) {
    return { price: 0, fillableUsdt: 0 };
  }

  // 1) Filtro base: precio y volumen positivos + reputación mínima
  let candidates = offers.filter(
    (o) => o.price > 0 && o.maxVes > 0 && o.finishRatePct >= minFinishRate,
  );
  if (candidates.length === 0) return { price: 0, fillableUsdt: 0 };

  // 2) Anti-manipulación: descartar outliers de precio por desviación de la mediana
  if (candidates.length >= 3 && maxDeviation > 1) {
    const prices = candidates.map((o) => o.price).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    if (median > 0) {
      candidates = candidates.filter(
        (o) => o.price >= median / maxDeviation && o.price <= median * maxDeviation,
      );
    }
  }
  if (candidates.length === 0) return { price: 0, fillableUsdt: 0 };

  const sorted = [...candidates].sort((a, b) =>
    side === 'BUY' ? a.price - b.price : b.price - a.price,
  );

  let remaining = targetUsdt;
  let totalVes = 0;
  let fillable = 0;

  for (const offer of sorted) {
    if (remaining <= 0) break;
    const maxUsdtThisOffer = offer.maxVes > 0 ? offer.maxVes / offer.price : 0;
    if (maxUsdtThisOffer <= 0) continue;
    const usdtAtLevel = Math.min(maxUsdtThisOffer, remaining);
    totalVes += usdtAtLevel * offer.price;
    fillable += usdtAtLevel;
    remaining -= usdtAtLevel;
  }

  const price = fillable > 0 ? totalVes / fillable : 0;
  return { price: roundMoney(price, 2), fillableUsdt: Math.round(fillable * 100) / 100 };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx ng test --include projects/core/src/lib/johnson-depth.spec.ts`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add projects/core/src/lib/johnson-depth.ts projects/core/src/lib/johnson-depth.spec.ts
git commit -m "feat(johnson-depth): volumen ponderado con filtros anti-manipulacion"
```

---

## Task 2: Scoring de calidad, liquidez y señal (corregidos contra el shape real)

**Files:**
- Modify: `projects/core/src/lib/johnson-depth.ts` (agregar funciones — mismo archivo, ya existe)
- Modify: `projects/core/src/lib/johnson-depth.spec.ts` (agregar tests)

**Interfaces:**
- Produces:
  - `export interface JohnsonDepthRequirements { minSpread: number; minLiquidityUsdt: number; targetUsdt: number; maxConsecutiveErrors: number; }`
  - `export const DEFAULT_JOHNSON_REQUIREMENTS: JohnsonDepthRequirements`
  - `calculateDepthQuality(depth, req): number` (0-100)
  - `calculateLiquidityScore(depth, req): number` (0-100)
  - `determineSignal(depth, qualityScore, liquidityScore, req): 'STRONG_BUY' | 'BUY' | 'CAUTION' | 'AVOID'`

**Corrección clave:** el plugin original usaba `context` (fuera de scope) y campos inexistentes. Aquí `requirements` es parámetro explícito y la profundidad se mide con volumen real. Ver decisión D1 (complementario a `computeSpreadQualityScore`, sin acoplamiento).

- [x] **Step 1: Escribir los tests que fallan**

```ts
// Agregar a projects/core/src/lib/johnson-depth.spec.ts
import {
  computeVolumeWeightedPrice,
  calculateDepthQuality,
  calculateLiquidityScore,
  determineSignal,
  DEFAULT_JOHNSON_REQUIREMENTS,
} from './johnson-depth';

const REQUIRED = DEFAULT_JOHNSON_REQUIREMENTS;

function makeDepth(bestBuy: number, bestSell: number, buyVolUsdt: number, sellVolUsdt: number) {
  return {
    asset: 'USDT',
    fiat: 'VES',
    bestBuyPrice: bestBuy,
    bestSellPrice: bestSell,
    spreadVes: bestSell - bestBuy,
    spreadPct: ((bestSell - bestBuy) / bestBuy) * 100,
    updatedAt: new Date().toISOString(),
    buyOffers: [
      { advNo: 'b0', price: bestBuy, merchantName: 'B0', finishRatePct: 100, orderCount: 5, minVes: 100, maxVes: buyVolUsdt * bestBuy, payMethods: ['Banesco'] },
    ],
    sellOffers: [
      { advNo: 's0', price: bestSell, merchantName: 'S0', finishRatePct: 100, orderCount: 5, minVes: 100, maxVes: sellVolUsdt * bestSell, payMethods: ['Banesco'] },
    ],
  } as const as any;
}

describe('calculateDepthQuality', () => {
  it('mercado equilibrado y rentable => score alto', () => {
    const depth = makeDepth(800, 825, 1000, 1000);
    expect(calculateDepthQuality(depth, REQUIRED)).toBeGreaterThanOrEqual(80);
  });

  it('sin precios => score 0', () => {
    const depth = makeDepth(0, 0, 1000, 1000);
    expect(calculateDepthQuality(depth, REQUIRED)).toBe(0);
  });

  it('spread enorme castiga el score', () => {
    const good = makeDepth(800, 805, 1000, 1000);
    const bad = makeDepth(800, 900, 1000, 1000);
    expect(calculateDepthQuality(bad, REQUIRED)).toBeLessThan(calculateDepthQuality(good, REQUIRED));
  });
});

describe('calculateLiquidityScore', () => {
  it('liquidez abundante => 100', () => {
    const depth = makeDepth(800, 825, 2000, 2000);
    expect(calculateLiquidityScore(depth, REQUIRED)).toBe(100);
  });

  it('liquidez nula => 0', () => {
    const depth = makeDepth(800, 825, 0, 0);
    expect(calculateLiquidityScore(depth, REQUIRED)).toBe(0);
  });
});

describe('determineSignal', () => {
  it('spread menor al mínimo => AVOID siempre', () => {
    const depth = makeDepth(800, 800.1, 5000, 5000);
    expect(determineSignal(depth, 95, 100, REQUIRED)).toBe('AVOID');
  });

  it('calidad alta + spread sano + liquidez => STRONG_BUY', () => {
    const depth = makeDepth(800, 825, 2000, 2000);
    expect(determineSignal(depth, 90, 100, REQUIRED)).toBe('STRONG_BUY');
  });

  it('calidad media => BUY', () => {
    const depth = makeDepth(800, 825, 2000, 2000);
    expect(determineSignal(depth, 65, 100, REQUIRED)).toBe('BUY');
  });

  it('liquidez insuficiente => AVOID', () => {
    const depth = makeDepth(800, 825, 0, 0);
    expect(determineSignal(depth, 90, 0, REQUIRED)).toBe('AVOID');
  });
});
```

- [x] **Step 2: Correr los tests y verificar que fallan**

Run: `npx ng test --include projects/core/src/lib/johnson-depth.spec.ts`
Expected: FAIL — funciones no exportadas.

- [x] **Step 3: Implementación**

```ts
// Agregar a projects/core/src/lib/johnson-depth.ts
export interface JohnsonDepthRequirements {
  /** Spread mínimo en VES para activar señales positivas */
  minSpread: number;
  /** Liquidez mínima en USDT (por lado) para considerar el mercado opertable */
  minLiquidityUsdt: number;
  /** Tamaño típico de operación en USDT usado para medir profundidad */
  targetUsdt: number;
  /** Máximo de errores consecutivos antes de pausar (gobernanza) */
  maxConsecutiveErrors: number;
}

export const DEFAULT_JOHNSON_REQUIREMENTS: JohnsonDepthRequirements = {
  minSpread: 0.3,
  minLiquidityUsdt: 500,
  targetUsdt: 500,
  maxConsecutiveErrors: 2,
};

export function calculateDepthQuality(
  depth: BinanceP2pMarketDepth,
  req: JohnsonDepthRequirements,
): number {
  if (!depth.bestBuyPrice || !depth.bestSellPrice) return 0;

  const buyUsdt = computeVolumeWeightedPrice(depth.buyOffers, 'SELL', req.targetUsdt).fillableUsdt;
  const sellUsdt = computeVolumeWeightedPrice(depth.sellOffers, 'BUY', req.targetUsdt).fillableUsdt;

  // 1. Ratio de balance buy/sell (50%)
  const total = buyUsdt + sellUsdt;
  const volumeRatio = total > 0
    ? Math.min(Math.min(buyUsdt, sellUsdt) / Math.max(total / 2, 1), 1) * 100
    : 50;

  // 2. Profundidad relativa al spread (30%) — spread alto castiga
  const spreadDepthRatio =
    depth.spreadVes !== undefined && depth.spreadVes !== null
      ? Math.max(0, 100 - Math.abs(depth.spreadVes) * 10)
      : 50;

  // 3. Precio dentro de rango viable (20%)
  const priceInRange = depth.bestBuyPrice > 0 && depth.bestSellPrice > 0 ? 100 : 0;

  const quality = volumeRatio * 0.5 + spreadDepthRatio * 0.3 + priceInRange * 0.2;
  return Math.round(Math.max(0, Math.min(100, quality)));
}

export function calculateLiquidityScore(
  depth: BinanceP2pMarketDepth,
  req: JohnsonDepthRequirements,
): number {
  const minLiquidity = req.minLiquidityUsdt;
  const buyUsdt = computeVolumeWeightedPrice(depth.buyOffers, 'SELL', req.targetUsdt).fillableUsdt;
  const sellUsdt = computeVolumeWeightedPrice(depth.sellOffers, 'BUY', req.targetUsdt).fillableUsdt;
  const avgVolume = (buyUsdt + sellUsdt) / 2;

  if (avgVolume >= minLiquidity * 2) return 100;
  if (avgVolume >= minLiquidity) return 75;
  if (avgVolume >= minLiquidity / 2) return 50;
  if (avgVolume > 0) return 25;
  return 0;
}

export function determineSignal(
  depth: BinanceP2pMarketDepth,
  qualityScore: number,
  liquidityScore: number,
  req: JohnsonDepthRequirements,
): 'STRONG_BUY' | 'BUY' | 'CAUTION' | 'AVOID' {
  if (depth.spreadVes !== undefined && depth.spreadVes !== null && depth.spreadVes < req.minSpread) {
    return 'AVOID';
  }
  if (liquidityScore < 40) return 'AVOID';
  if (qualityScore >= 80 && depth.spreadVes >= req.minSpread) return 'STRONG_BUY';
  if (qualityScore >= 60 && depth.spreadVes >= req.minSpread) return 'BUY';
  if (qualityScore >= 40) return 'CAUTION';
  return 'AVOID';
}
```

- [x] **Step 4: Correr los tests y verificar que pasan**

Run: `npx ng test --include projects/core/src/lib/johnson-depth.spec.ts`
Expected: todos PASS (Task 1 + Task 2).

- [x] **Step 5: Commit**

```bash
git add projects/core/src/lib/johnson-depth.ts projects/core/src/lib/johnson-depth.spec.ts
git commit -m "feat(johnson-depth): scoring de calidad, liquidez y señal contra shape real"
```

---

## Task 3: Ganancia NETA por banco (reutilizando `computeArbitrageCycle` + `VENEZUELAN_BANK_FEES`)

**Files:**
- Modify: `projects/core/src/lib/johnson-depth.ts`
- Modify: `projects/core/src/lib/johnson-depth.spec.ts`

**Interfaces:**
- Consumes: `computeVolumeWeightedPrice`, `BINANCE_PAY_METHODS`; `computeArbitrageCycle`, `VENEZUELAN_BANK_FEES` de `./spread-quality`; `BankCode` de `./accounts`; `MINIMUM_VIABLE_NET_SPREAD_PCT` de `./operator-manager`.
- Produces:
  - `export interface JohnsonBankProfit { bankKey: string; bankName: string; bankCode: BankCode; buyPriceVes: number; sellPriceVes: number; fillableUsdt: number; grossProfitVes: number; binanceFeeUsdt: number; bankFeesVes: number; netGainVes: number; netGainUsd: number; roiCyclePct: number; effectiveFeeDragPct: number; isSafe: boolean; }`
  - `export interface JohnsonBankConfig { bankCodes: readonly string[]; buyRole: P2PRole; sellRole: P2PRole; isInterbank: boolean; }` (defaults: `['BANESCO','MERCANTIL','BDV','BANCAMIGA','PROVINCIAL','OTRO']`, `'TAKER'`, `'TAKER'`, `false`)
  - `computeBankProfits(depth, bankKeys, req, config?): JohnsonBankProfit[]` — ordenado por `netGainVes` descendente
  - `buildJohnsonMarketQuality(depth, bankKeys, req, config?): JohnsonMarketQuality` (amplía la del v1 con `bankProfits` usando ganancia NETA)

**Importante (contra-partes):**
- Para cada banco: `sellOffers` filtradas por `payMethods.includes(bankName)` = vendedores → COMPRAR USDT (`'BUY'`); `buyOffers` filtradas = compradores → VENDER USDT (`'SELL'`).
- `bankKey === 'ALL'` o `bankKey` sin nombre en `BINANCE_PAY_METHODS` → sin filtro de payMethod.
- Fees: ver D4 — `bankKey` no presente en `VENEZUELAN_BANK_FEES` → `OTRO` (conservador).
- **SIEMPRE guardar antes de `computeArbitrageCycle`** (lanza excepción con inputs ≤ 0): solo llamar si `fillableUsdt > 0 && buyPrice > 0 && sellPrice > 0`. Si no, fila con ceros e `isSafe: false`.
- `grossProfitVes = (sellPrice - buyPrice) * fillableUsdt`; `roiCyclePct`, `netGainVes`, `binanceFeeUsdt`, `bankFeesVes`, `effectiveFeeDragPct` vienen del ciclo.
- `isSafe = roiCyclePct >= MINIMUM_VIABLE_NET_SPREAD_PCT` (0.50, constante existente).

- [x] **Step 1: Escribir los tests que fallan**

```ts
// Agregar a projects/core/src/lib/johnson-depth.spec.ts
import { computeBankProfits, buildJohnsonMarketQuality } from './johnson-depth';

function makeBankDepth(buyPrice: number, sellPrice: number, buyVolUsdt: number, sellVolUsdt: number) {
  return {
    asset: 'USDT',
    fiat: 'VES',
    bestBuyPrice: buyPrice,
    bestSellPrice: sellPrice,
    spreadVes: sellPrice - buyPrice,
    spreadPct: ((sellPrice - buyPrice) / buyPrice) * 100,
    updatedAt: new Date().toISOString(),
    buyOffers: [
      { advNo: 'b0', price: buyPrice, merchantName: 'B0', finishRatePct: 100, orderCount: 5, minVes: 100, maxVes: buyVolUsdt * buyPrice, payMethods: ['Banesco'] },
    ],
    sellOffers: [
      { advNo: 's0', price: sellPrice, merchantName: 'S0', finishRatePct: 100, orderCount: 5, minVes: 100, maxVes: sellVolUsdt * sellPrice, payMethods: ['Banesco'] },
    ],
  } as const as any;
}

describe('computeBankProfits', () => {
  it('calcula ganancia NETA: compra 500 USDT barato y vende caro, sin fees (TAKER, mismo banco)', () => {
    const depth = makeBankDepth(800, 825, 1000, 1000);
    const profits = computeBankProfits(depth, ['ALL'], REQUIRED);
    expect(profits).toHaveLength(1);
    const [p] = profits;
    expect(p.fillableUsdt).toBe(500);               // targetUsdt default
    expect(p.grossProfitVes).toBeCloseTo(500 * 25, 0);
    expect(p.binanceFeeUsdt).toBe(0);               // TAKER
    expect(p.bankFeesVes).toBe(0);                  // mismo banco, no interbank
    expect(p.netGainVes).toBeCloseTo(500 * 25, 0);
    expect(p.roiCyclePct).toBeCloseTo((12500 / 400000) * 100, 2); // 3.125%
    expect(p.effectiveFeeDragPct).toBeCloseTo(0, 2);
    expect(p.isSafe).toBe(true);                    // >= 0.50%
  });

  it('sin input válido produce fila cero sin lanzar excepción (computeArbitrageCycle guarda)', () => {
    const depth = { ...makeBankDepth(0, 0, 0, 0), buyOffers: [], sellOffers: [] } as const as any;
    expect(() => computeBankProfits(depth, ['ALL'], REQUIRED)).not.toThrow();
    const [p] = computeBankProfits(depth, ['ALL'], REQUIRED);
    expect(p.netGainVes).toBe(0);
    expect(p.isSafe).toBe(false);
  });

  it('ordena por ganancia neta descendente', () => {
    const depth = {
      ...makeBankDepth(800, 825, 1000, 1000),
      buyOffers: [
        { advNo: 'b0', price: 800, merchantName: 'B0', finishRatePct: 100, orderCount: 5, minVes: 100, maxVes: 1000 * 800, payMethods: ['Banesco'] },
        { advNo: 'b1', price: 810, merchantName: 'B1', finishRatePct: 100, orderCount: 5, minVes: 100, maxVes: 1000 * 810, payMethods: ['PagoMovil'] },
      ],
      sellOffers: [
        { advNo: 's0', price: 825, merchantName: 'S0', finishRatePct: 100, orderCount: 5, minVes: 100, maxVes: 1000 * 825, payMethods: ['Banesco', 'PagoMovil'] },
      ],
    } as const as any;

    const profits = computeBankProfits(depth, ['BANESCO', 'PAGO_MOVIL'], REQUIRED);
    expect(profits[0].bankKey).toBe('BANESCO');    // compra 800 => mayor ganancia
    expect(profits[0].netGainVes).toBeGreaterThan(profits[1].netGainVes);
    expect(profits[1].bankCode).toBe('OTRO');      // PAGO_MOVIL no es banco -> fees OTRO (D4)
  });

  it('si no hay liquidez suficiente el fillable baja y la ganancia es proporcional', () => {
    const depth = makeBankDepth(800, 825, 100, 1000); // solo 100 USDT comprables
    const [p] = computeBankProfits(depth, ['ALL'], REQUIRED);
    expect(p.fillableUsdt).toBe(100);
  });
});

describe('buildJohnsonMarketQuality', () => {
  it('integra scoring + mejor banco (neto) + timestamp', () => {
    const depth = makeBankDepth(800, 825, 2000, 2000);
    const q = buildJohnsonMarketQuality(depth, ['BANESCO', 'ALL'], REQUIRED);
    expect(q.depthScore).toBeGreaterThan(0);
    expect(q.liquidityScore).toBeGreaterThan(0);
    expect(q.spreadVes).toBe(25);
    expect(q.spreadPct).toBeGreaterThan(0);
    expect(q.bestBank).not.toBeNull();
    expect(q.bankProfits.length).toBeGreaterThan(0);
    expect(q.bankProfits[0].netGainVes).toBeGreaterThan(0);
    expect(q.timestamp).toBeGreaterThan(0);
  });

  it('con depth vacío la recomendación es AVOID y no lanza', () => {
    const depth = { ...makeBankDepth(0, 0, 0, 0), buyOffers: [], sellOffers: [] } as const as any;
    const q = buildJohnsonMarketQuality(depth, ['ALL'], REQUIRED);
    expect(q.recommendation).toBe('AVOID');
    expect(q.bankProfits[0].netGainVes).toBe(0);
  });
});
```

- [x] **Step 2: Correr los tests y verificar que fallan**

Run: `npx ng test --include projects/core/src/lib/johnson-depth.spec.ts`
Expected: FAIL — `computeBankProfits`/`buildJohnsonMarketQuality` no exportadas.

- [x] **Step 3: Implementación**

```ts
// Agregar encabezados a projects/core/src/lib/johnson-depth.ts
import {
  computeArbitrageCycle,
  VENEZUELAN_BANK_FEES,
  type P2PRole,
} from './spread-quality';
import { type BankCode } from './accounts';
import { MINIMUM_VIABLE_NET_SPREAD_PCT } from './operator-manager';

export interface JohnsonBankProfit {
  bankKey: string;
  bankName: string;
  bankCode: BankCode;
  buyPriceVes: number;
  sellPriceVes: number;
  fillableUsdt: number;
  grossProfitVes: number;      // (sell - buy) * fillable — bruto, sin fees
  binanceFeeUsdt: number;
  bankFeesVes: number;
  netGainVes: number;          // ganancia neta tras fees
  netGainUsd: number;
  roiCyclePct: number;         // sobre capital invertido
  effectiveFeeDragPct: number; // % del spread nominal perdido en fees
  isSafe: boolean;             // roiCyclePct >= MINIMUM_VIABLE_NET_SPREAD_PCT
}

export interface JohnsonBankConfig {
  bankCodes: readonly string[];
  buyRole: P2PRole;
  sellRole: P2PRole;
  isInterbank: boolean;
}

export const DEFAULT_JOHNSON_BANK_CONFIG: JohnsonBankConfig = {
  bankCodes: ['BANESCO', 'MERCANTIL', 'BDV', 'BANCAMIGA', 'PROVINCIAL', 'OTRO'],
  buyRole: 'TAKER',
  sellRole: 'TAKER',
  isInterbank: false,
};

export function computeBankProfits(
  depth: BinanceP2pMarketDepth,
  bankKeys: readonly string[],
  req: JohnsonDepthRequirements,
  config: JohnsonBankConfig = DEFAULT_JOHNSON_BANK_CONFIG,
): JohnsonBankProfit[] {
  const results: JohnsonBankProfit[] = [];

  for (const bankKey of bankKeys) {
    const bankName = BINANCE_PAY_METHODS[bankKey] ?? '';
    const filter = (o: BinanceOfferSummary) => (bankName ? o.payMethods.includes(bankName) : true);

    const sellers = depth.sellOffers.filter(filter); // vendedores -> comprar USDT
    const buyers = depth.buyOffers.filter(filter);   // compradores -> vender USDT

    const buy = computeVolumeWeightedPrice(sellers, 'BUY', req.targetUsdt);
    const sell = computeVolumeWeightedPrice(buyers, 'SELL', req.targetUsdt);

    const fillableUsdt = Math.min(buy.fillableUsdt, sell.fillableUsdt);
    const grossProfitVes = (sell.price - buy.price) * fillableUsdt;

    // Guarda obligatoria: computeArbitrageCycle lanza excepción con inputs <= 0
    if (fillableUsdt <= 0 || buy.price <= 0 || sell.price <= 0) {
      results.push({
        bankKey,
        bankName: bankName || bankKey,
        bankCode: (bankKey in VENEZUELAN_BANK_FEES ? bankKey : 'OTRO') as BankCode,
        buyPriceVes: buy.price,
        sellPriceVes: sell.price,
        fillableUsdt,
        grossProfitVes: roundMoney(grossProfitVes, 2),
        binanceFeeUsdt: 0,
        bankFeesVes: 0,
        netGainVes: 0,
        netGainUsd: 0,
        roiCyclePct: 0,
        effectiveFeeDragPct: 0,
        isSafe: false,
      });
      continue;
    }

    const bankCode = (bankKey in VENEZUELAN_BANK_FEES ? bankKey : 'OTRO') as BankCode;
    const cycle = computeArbitrageCycle({
      capitalUsdt: fillableUsdt,
      buyPrice: buy.price,
      sellPrice: sell.price,
      buyRole: config.buyRole,
      sellRole: config.sellRole,
      sourceBank: bankCode,
      targetBank: bankCode,
      isInterbank: config.isInterbank,
    });

    results.push({
      bankKey,
      bankName: bankName || bankCode,
      bankCode,
      buyPriceVes: buy.price,
      sellPriceVes: sell.price,
      fillableUsdt,
      grossProfitVes: roundMoney(grossProfitVes, 2),
      binanceFeeUsdt: roundMoney(cycle.binanceFeeUsdt, 4),
      bankFeesVes: roundMoney(cycle.bankFeesVes, 2),
      netGainVes: roundMoney(cycle.netGainVes, 2),
      netGainUsd: roundMoney(cycle.netGainUsd, 2),
      roiCyclePct: roundMoney(Math.max(0, cycle.roiCyclePct), 2),
      effectiveFeeDragPct: roundMoney(cycle.effectiveFeeDragPct, 2),
      isSafe: cycle.roiCyclePct >= MINIMUM_VIABLE_NET_SPREAD_PCT,
    });
  }

  return results.sort((a, b) => b.netGainVes - a.netGainVes);
}

export interface JohnsonMarketQuality {
  depthScore: number;
  liquidityScore: number;
  spreadVes: number;
  spreadPct: number;
  recommendation: 'STRONG_BUY' | 'BUY' | 'CAUTION' | 'AVOID';
  bestBank: string | null;
  bankProfits: JohnsonBankProfit[];
  timestamp: number;
}

export function buildJohnsonMarketQuality(
  depth: BinanceP2pMarketDepth,
  bankKeys: readonly string[],
  req: JohnsonDepthRequirements,
  config: JohnsonBankConfig = DEFAULT_JOHNSON_BANK_CONFIG,
): JohnsonMarketQuality {
  const depthScore = calculateDepthQuality(depth, req);
  const liquidityScore = calculateLiquidityScore(depth, req);
  const bankProfits = computeBankProfits(depth, bankKeys, req, config);
  const recommendation = determineSignal(depth, depthScore, liquidityScore, req);
  const bestBank = bankProfits.length > 0 && bankProfits[0].netGainVes > 0 ? bankProfits[0].bankKey : null;
  const spreadPct = depth.bestBuyPrice > 0 ? (depth.spreadVes / depth.bestBuyPrice) * 100 : 0;

  return {
    depthScore,
    liquidityScore,
    spreadVes: roundMoney(depth.spreadVes ?? 0, 2),
    spreadPct: roundMoney(spreadPct, 2),
    recommendation,
    bestBank,
    bankProfits,
    timestamp: Date.now(),
  };
}
```

- [x] **Step 4: Correr los tests y verificar que pasan**

Run: `npx ng test --include projects/core/src/lib/johnson-depth.spec.ts`
Expected: todos PASS (Tasks 1-3).

- [x] **Step 5: Commit**

```bash
git add projects/core/src/lib/johnson-depth.ts projects/core/src/lib/johnson-depth.spec.ts
git commit -m "feat(johnson-depth): ganancia neta por banco con cascade de fees reales"
```

---

## Task 4: Ventana de arbitraje BCV/paralelo (sobre `computeTriangulationGap`)

**Files:**
- Create: `projects/core/src/lib/johnson-depth-rate-window.ts`
- Test: `projects/core/src/lib/johnson-depth-rate-window.spec.ts`

**Interfaces:**
- Consumes: `computeTriangulationGap` de `./cotizave` (NO duplicar su fórmula, ver D2 y D3).
- Produces:
  - `detectRateDivergence(input: { depth: BinanceP2pMarketDepth; bcvRate: number; parallelRate: number; parallelRateBefore?: number; windowMinutes: number; }): { gapVes: number | null; gapPct: number | null; rateMomentumPct: number; signal: 'SELL_WINDOW' | 'BUY_WINDOW' | 'NEUTRAL'; }`

Reglas del negocio:
- Usar `computeTriangulationGap({ bid: depth.bestSellPrice }, { ask: parallelRate })`:
  - `binance.bid` = bestSellPrice = lo que pagas al comprar USDT en Binance P2P (ask del vendedor más bajo).
  - `other.ask` = parallelRate = lo que te pagarían al vender USDT en el mercado paralelo (bid del comprador más alto).
  - `gapPct` positivo → el paralelo paga más que lo que Binance cobra → conviene comprar en Binance y vender fuera → **SELL_WINDOW**.
- `rateMomentumPct = parallelRateBefore > 0 ? ((parallelRate / parallelRateBefore) - 1) * 100 : 0`.
- Señal (solo si `gapPct != null`): `gapPct >= 2` → `SELL_WINDOW`; `gapPct <= -2` → `BUY_WINDOW`; si `rateMomentumPct > 0.5 && gapPct < 1` → `BUY_WINDOW` (rezago: la tasa subió y el P2P no ajustó); resto `NEUTRAL`.
- `bcvRate` y `windowMinutes` se reciben por compatibilidad futura (no alteran la señal v1). Si el lint exige uso, agregar `void bcvRate; void windowMinutes;`.

- [x] **Step 1: Verificación anti-duplicación (D3) — leer `triangular-arbitrage.ts`**

Leer `projects/core/src/lib/triangular-arbitrage.ts` (solo lectura).
- Si YA expone una función equivalente a "ventana/divergencia P2P vs otra fuente con señal direccional": NO crear `detectRateDivergence`. Documentar en un comentario del módulo cómo usar la función existente y saltar a Step 5 con un commit de documentación/mapping.
- Si NO la expone (solo gap/arbitraje estático sin momentum): continuar con Step 2.

- [x] **Step 2: Escribir los tests que fallan**

```ts
// projects/core/src/lib/johnson-depth-rate-window.spec.ts
import { describe, it, expect } from 'vitest';
import { detectRateDivergence } from './johnson-depth-rate-window';
import type { BinanceP2pMarketDepth } from './binance-p2p';

function midDepth(p2pBuy: number, p2pSell: number): BinanceP2pMarketDepth {
  return {
    asset: 'USDT',
    fiat: 'VES',
    bestBuyPrice: p2pBuy,
    bestSellPrice: p2pSell,
    spreadVes: p2pSell - p2pBuy,
    spreadPct: 0.25,
    updatedAt: new Date().toISOString(),
    buyOffers: [],
    sellOffers: [],
  };
}

describe('detectRateDivergence', () => {
  it('Binance cobra menos que el paralelo paga => SELL_WINDOW', () => {
    // compras USDT a 100; el paralelo te paga 103 => gapPct +3
    const res = detectRateDivergence({ depth: midDepth(99, 100), bcvRate: 102, parallelRate: 103, windowMinutes: 5 });
    expect(res.gapPct).toBeCloseTo(3, 1);
    expect(res.signal).toBe('SELL_WINDOW');
  });

  it('Binance cobra más que el paralelo paga => BUY_WINDOW', () => {
    const res = detectRateDivergence({ depth: midDepth(99, 100), bcvRate: 98, parallelRate: 97, windowMinutes: 5 });
    expect(res.gapPct).toBeCloseTo(-3, 1);
    expect(res.signal).toBe('BUY_WINDOW');
  });

  it('dentro de rango => NEUTRAL', () => {
    const res = detectRateDivergence({ depth: midDepth(99, 100), bcvRate: 100, parallelRate: 100.5, windowMinutes: 5 });
    expect(res.signal).toBe('NEUTRAL');
  });

  it('tasa sube y el P2P no ajusta => BUY_WINDOW por rezago', () => {
    const res = detectRateDivergence({
      depth: midDepth(100, 101),
      bcvRate: 102,
      parallelRate: 102,
      parallelRateBefore: 100,
      windowMinutes: 5,
    });
    expect(res.rateMomentumPct).toBeCloseTo(2, 1);
    expect(res.signal).toBe('BUY_WINDOW');
  });

  it('depth vacío => NEUTRAL seguro (computeTriangulationGap devuelve null)', () => {
    const res = detectRateDivergence({ depth: midDepth(0, 0), bcvRate: 100, parallelRate: 100, windowMinutes: 5 });
    expect(res.gapPct).toBeNull();
    expect(res.signal).toBe('NEUTRAL');
  });
});
```

- [x] **Step 3: Correr el test y verificar que falla**

Run: `npx ng test --include projects/core/src/lib/johnson-depth-rate-window.spec.ts`
Expected: FAIL — módulo no existe.

- [x] **Step 4: Implementación mínima**

```ts
// projects/core/src/lib/johnson-depth-rate-window.ts
import type { BinanceP2pMarketDepth } from './binance-p2p';
import { computeTriangulationGap } from './cotizave';
import { roundMoney } from './money';

export interface RateDivergenceInput {
  depth: BinanceP2pMarketDepth;
  bcvRate: number;
  parallelRate: number;
  parallelRateBefore?: number;
  windowMinutes: number;
}

export interface RateDivergenceResult {
  gapVes: number | null;
  gapPct: number | null;
  rateMomentumPct: number;
  signal: 'SELL_WINDOW' | 'BUY_WINDOW' | 'NEUTRAL';
}

/**
 * Ventana de arbitraje P2P vs mercado paralelo.
 * Reutiliza computeTriangulationGap (fuente de verdad del gap, cotizave.ts)
 * y añade el momentum temporal de la tasa paralela (rezago).
 */
export function detectRateDivergence(input: RateDivergenceInput): RateDivergenceResult {
  const { depth, bcvRate, parallelRate, parallelRateBefore, windowMinutes } = input;

  void bcvRate;
  void windowMinutes;

  // binance.bid = bestSellPrice (lo que pagas); other.ask = parallelRate (lo que te pagan)
  const gap = computeTriangulationGap(
    { bid: depth.bestSellPrice },
    { ask: parallelRate },
  );

  const rateMomentumPct =
    parallelRateBefore && parallelRateBefore > 0
      ? roundMoney((parallelRate / parallelRateBefore - 1) * 100, 2)
      : 0;

  let signal: 'SELL_WINDOW' | 'BUY_WINDOW' | 'NEUTRAL' = 'NEUTRAL';
  if (gap.gapPct !== null) {
    if (gap.gapPct >= 2) signal = 'SELL_WINDOW';
    else if (gap.gapPct <= -2) signal = 'BUY_WINDOW';
    else if (rateMomentumPct > 0.5 && gap.gapPct < 1) signal = 'BUY_WINDOW'; // rezago
  }

  return { gapVes: gap.gapVes, gapPct: gap.gapPct, rateMomentumPct, signal };
}
```

- [x] **Step 5: Correr el test y verificar que pasa**

Run: `npx ng test --include projects/core/src/lib/johnson-depth-rate-window.spec.ts`
Expected: 5 PASS.

- [x] **Step 6: Commit**

```bash
git add projects/core/src/lib/johnson-depth-rate-window.ts projects/core/src/lib/johnson-depth-rate-window.spec.ts
git commit -m "feat(johnson-depth): ventana de arbitraje sobre computeTriangulationGap + momentum"
```

---

## Task 5: Exportar ambos módulos desde `public-api.ts`

**Files:**
- Modify: `projects/core/src/public-api.ts`

**Interfaces:**
- Produces: `@p2p/core` expone `johnson-depth` y `johnson-depth-rate-window` (los demás exports ya están, incluidos spread-quality/cotizave/triangular-arbitrage — NO tocarlos).

- [x] **Step 1: Agregar los exports (al final, después de `receipt-ocr`)**

```ts
// projects/core/src/public-api.ts — agregar al final
export * from './lib/johnson-depth';
export * from './lib/johnson-depth-rate-window';
```

- [x] **Step 2: Verificar que no hay export duplicado**

Buscar en el archivo: los nombres de función exportados por los 2 módulos nuevos no deben aparecer ya en otras líneas de public-api (patrón de error rolldown "Duplicated export" si se duplica). `computeVolumeWeightedPrice`, `detectRateDivergence`, etc. son nombres nuevos → OK.

- [x] **Step 3: Verificar con la suite del core**

Run: `npx ng test --include projects/core/src/lib/johnson-depth*.spec.ts`
Expected: PASS (Tasks 1-4 juntas).

- [x] **Step 4: Verificar el build completo**

Run: `npm run build`
Expected: EXIT 0 (solo warnings pre-existentes de qrcode/scss aceptables).

- [x] **Step 5: Commit**

```bash
git add projects/core/src/public-api.ts
git commit -m "feat(core): exportar motor johnson-depth y ventana de tasa"
```

---

## Task 6: Reescritura del plugin como adaptador delgado (con `cleanup()` y `maxConsecutiveErrors`)

**Files:**
- Rewrite: `plugins/johnson-depth/plugin.ts`

**Interfaces:**
- Consumes: `@p2p/core` por ruta relativa `../../projects/core/src/public-api` (verificar en Task 0 Step 3 si el tsconfig permite alias `@p2p/core`; si el repo ya lo configura para `src/app`, usar el mismo mecanismo).
- Produces: `pluginMetadata`, `init(context)`, **`refresh(depth, ctx?)`**, `getLatestQuality()`, `getLastError()`, **`cleanup()`** (obligatorio: `PluginRegistryImpl` llama `module.cleanup()` al descargar, plugin-registry.ts líneas 188-202).
- NO usa `marketDepth.subscribe()` (el registry pasa objeto placeholder no-Signal). El integrador llama `refresh(depth)` con cada snapshot real.

Comportamiento de errores consecutivos (`maxConsecutiveErrors`):
- `refresh` con depth inválido → incrementa contador, registra `lastError`, devuelve null.
- Contador > `maxConsecutiveErrors` → publica quality degradada (recomendación `AVOID`, scores 0) vía `setMarketQuality` y continúa contando.
- `refresh` con depth válido → resetea contador y `lastError`.

- [ ] **Step 1: Reescribir el plugin**

```ts
// plugins/johnson-depth/plugin.ts
/**
 * Plugin Johnson Market Depth — adaptador delgado sobre el motor @p2p/core.
 *
 * Toda la lógica vive en projects/core/src/lib/johnson-depth.ts.
 * Este archivo solo conecta el motor con el integrador (Spread Monitor o
 * PluginRegistryImpl). No contiene fórmulas.
 *
 * Diferencias vs el v1 roto:
 * - Ya NO usa `context.marketDepth.subscribe()` (el registry pasa un objeto
 *   placeholder no-Signal). El integrador llama `refresh(depth)` con cada snapshot real.
 * - Implementa `cleanup()` porque PluginRegistryImpl.unloadPlugin() lo invoca.
 * - Implementa `maxConsecutiveErrors` (gobernanza real, no decorativa).
 */
import {
  buildJohnsonMarketQuality,
  DEFAULT_JOHNSON_REQUIREMENTS,
  computeVolumeWeightedPrice,
  type JohnsonDepthRequirements,
  type JohnsonMarketQuality,
  type JohnsonBankConfig,
  type JohnsonBankProfit,
} from '../../projects/core/src/public-api';
import type { BinanceP2pMarketDepth } from '../../projects/core/src/public-api';

export const pluginMetadata = {
  id: 'johnson-depth',
  name: 'Johnson Market Depth',
  version: '2.0.0',
  description:
    'Motor de calidad de profundidad: scoring, ganancia neta por banco y señal de operación.',
  entryPoint: './plugin.ts',
  requirements: {
    minSpread: DEFAULT_JOHNSON_REQUIREMENTS.minSpread,
    minLiquidityUsdt: DEFAULT_JOHNSON_REQUIREMENTS.minLiquidityUsdt,
    maxConsecutiveErrors: DEFAULT_JOHNSON_REQUIREMENTS.maxConsecutiveErrors,
  },
};

export interface JohnsonPluginContext {
  storage?: {
    get?: (key: string) => unknown;
    set?: (key: string, value: unknown) => void;
  };
  marketDepth?: { depth?: BinanceP2pMarketDepth | null };
  setMarketQuality?: (quality: JohnsonMarketQuality) => void;
  registerCustomMetric?: (name: string, value: unknown) => void;
  requirements?: Partial<JohnsonDepthRequirements>;
}

/** Bancos válidos (claves de BankCode con tabla de fees; D4). PAGO_MOVIL/ALL quedan fuera. */
const BANK_KEYS: readonly string[] = ['BANESCO', 'MERCANTIL', 'BDV', 'BANCAMIGA', 'PROVINCIAL'];
/** Filtros anti-fake recomendados (ver Task 1). */
const PLUGIN_OPTIONS = { minFinishRatePct: 90, maxPriceDeviationFactor: 3 } as const;

let latestQuality: JohnsonMarketQuality | null = null;
let lastError: string | null = null;
let consecutiveErrors = 0;

export function getLatestQuality(): JohnsonMarketQuality | null {
  return latestQuality;
}

export function getLastError(): string | null {
  return lastError;
}

export function refresh(
  depth: BinanceP2pMarketDepth | null | undefined,
  ctx: JohnsonPluginContext = {},
): JohnsonMarketQuality | null {
  const req: JohnsonDepthRequirements = {
    ...DEFAULT_JOHNSON_REQUIREMENTS,
    ...(ctx.requirements ?? {}),
  };
  const bankConfig: JohnsonBankConfig = {
    bankCodes: BANK_KEYS,
    buyRole: 'TAKER',
    sellRole: 'TAKER',
    isInterbank: false,
  };

  if (!depth || !depth.bestBuyPrice || !depth.bestSellPrice) {
    consecutiveErrors += 1;
    lastError = `depth inválido o vacío (error consecutivo ${consecutiveErrors})`;
    if (consecutiveErrors > req.maxConsecutiveErrors) {
      const degraded: JohnsonMarketQuality = {
        depthScore: 0,
        liquidityScore: 0,
        spreadVes: 0,
        spreadPct: 0,
        recommendation: 'AVOID',
        bestBank: null,
        bankProfits: [],
        timestamp: Date.now(),
      };
      latestQuality = degraded;
      ctx.setMarketQuality?.(degraded);
    }
    return null;
  }

  consecutiveErrors = 0;
  lastError = null;

  const quality = buildJohnsonMarketQuality(depth, BANK_KEYS, req, bankConfig);
  latestQuality = quality;

  ctx.setMarketQuality?.(quality);
  ctx.registerCustomMetric?.('johnsonDepthScore', quality.depthScore);
  ctx.registerCustomMetric?.('johnsonSignal', quality.recommendation);
  ctx.registerCustomMetric?.('johnsonBestBank', quality.bestBank ?? '');

  return quality;
}

export async function init(context: JohnsonPluginContext = {}): Promise<void> {
  console.log('[johnson-depth] init() ejecutándose (adaptador v2)');
  try {
    const initial = context.marketDepth?.depth;
    if (initial) refresh(initial, context);
  } catch (err) {
    console.warn('[johnson-depth] init() sin depth inicial; listo para refresh() manual:', err);
  }
  console.log('[johnson-depth] init() completado — usar refresh(depth) para nuevas lecturas');
}

/** Cajón de salida — obligatorio para desinstalación limpia (PluginRegistryImpl.unloadPlugin). */
export async function cleanup(): Promise<void> {
  latestQuality = null;
  lastError = null;
  consecutiveErrors = 0;
  console.log('[johnson-depth] cleanup() ejecutado — estado reseteado');
}
```

- [ ] **Step 2: Verificar que compila (tipos correctos contra `@p2p/core`)**

Según Task 0 Step 3:
- Si `plugins/` está incluido en el tsconfig de la app → `npx tsc --noEmit -p tsconfig.app.json` (o el comando de typecheck del repo).
- Si NO está incluido → compilar manualmente:
  `npx tsc --noEmit --target es2022 --moduleResolution node --skipLibCheck projects/core/src/public-api.ts plugins/johnson-depth/plugin.ts`
- Si el repo NO compila `plugins/` en absoluto y Antigravity no puede corregirlo sin tocar configs → preguntar al usuario; NO modificar tsconfigs sin aprobación.

- [ ] **Step 3: Revisión del contrato contra el registry**

Leer `projects/core/src/lib/plugin-registry.ts` y confirmar que `loadPlugin` (buscar el `init({ storage, rules, marketDepth, setMarketQuality, registerCustomMetric })`) convive con nuestro contexto tolerante y con `cleanup` exportado. No modificar el registry.

- [ ] **Step 4: Commit**

```bash
git add plugins/johnson-depth/plugin.ts
git commit -m "refactor(johnson-depth): plugin como adaptador delgado con cleanup y gobernanza"
```

---

## Task 7 (OPCIONAL — requiere aprobación explícita del usuario): Panel Johnson en el Spread Monitor

**⚠️ NO ejecutar esta tarea sin que el usuario la apruebe.** Hasta entonces, la UI no se toca (REGLA DE ORO).

**Files (solo si se aprueba):**
- Modify: `src/app/features/spread-monitor/spread-monitor.ts`
- Modify: `src/app/features/spread-monitor/spread-monitor.html`
- Modify: `src/app/features/spread-monitor/spread-monitor.scss` (clase nueva SOLO, sin tocar estilos existentes)

**Interfaces:**
- Consumes: `buildJohnsonMarketQuality` de `@p2p/core` directamente (mismo patrón que usa `binance-p2p.service`).
- Alcance: panel con `depthScore`, `liquidityScore`, `recommendation` (badge de color) y **top 3 de bancos con ganancia neta** (bankKey + netGainVes + roiCyclePct).

- [ ] Step 1: Leer el componente actual y ubicar el punto de inserción sin romper estructura.
- [ ] Step 2: Conectar en el handler de `fetchMarketDepth`: `this.johnsonQuality.set(buildJohnsonMarketQuality(depth, BANKS, DEFAULT_JOHNSON_REQUIREMENTS))`.
- [ ] Step 3: Renderizar el panel (español), clase CSS nueva.
- [ ] Step 4: Verificar `npx ng test --include src/app/features/spread-monitor` y `npm run build`.
- [ ] Step 5: Commit.

---

## Task 8: Definition of Done — cierre y verificación global (no rompimos nada)

**Files:** ninguno (solo comandos).

- [ ] **Step 1: Baseline == Final**

```bash
git status --short
npm test
npm run build
```

- `git status`: exactamente 6 archivos nuevos/modificados (`johnson-depth.ts`, `johnson-depth.spec.ts`, `johnson-depth-rate-window.ts`, `johnson-depth-rate-window.spec.ts`, `public-api.ts`, `plugins/johnson-depth/plugin.ts`). Cualquier otro archivo en el diff → STOP y revisar.
- `npm test`: todos los tests (289 originales + nuevos) en verde. Ningún test pre-existente roto.
- `npm run build`: EXIT 0 con los mismos warnings pre-existentes.

- [ ] **Step 2: Diff de sanity (nada visual tocado)**

```bash
git diff --stat
```

Confirmar que NO aparece ningún archivo de `src/app` ni de `electron/`. Si aparece (sin aprobación de Task 7) → revertir ese archivo inmediatamente.

- [ ] **Step 3: Smoke funcional de la app**

Abrir la app con el método que use el repo (en Windows: `Start-Process -FilePath "E:\05_Proyectos\proyecto p2p\node_modules\electron\dist\electron.exe" -ArgumentList "." -WorkingDirectory "E:\05_Proyectos\proyecto p2p"`).
Verificar: la ventana "Spread Monitor" abre igual que antes, los datos de Binance cargan (sin error CORS), y NO hay cambios visuales (Task 7 no aprobada = cero cambios de UI).

- [ ] **Step 4: Nota de rollback**

Si algo sale mal tras Task 8: revertir solo los commits de esta feature. En la rama `feat/p2p-decision-tool-mvp`:
```bash
git log --oneline -12   # identificar los commits feat(johnson-depth)/refactor(johnson-depth)
git revert <hash1> <hash2> ...   # o reset del rango si la rama no se ha compartido
```
El estado pre-feature es reproducible con Task 0 Step 4 (baseline: 289 tests, build EXIT 0).

- [ ] **Step 5: Resumen final (para el usuario)**

Reportar: archivos creados/modificados, nº tests nuevos y total, resultado de build, confirmación de "nada visual cambió", y el estado del plugin (`init` + `refresh` + `cleanup` funcionando contra el registry).

---

## Self-Review (cobertura del plan v2)

| Requisito | Dónde se cumple |
|---|---|
| Corregir bugs base (context fuera de scope, campos inexistentes, subscribe inexistente) | Task 2 (requirements explícitos) + Task 6 (refresh sin subscribe) |
| Profundidad volumétrica / slippage real | Task 1 |
| Anti-manipulación (outliers de precio + reputación finishRate) | Task 1 (Step 3), activado en plugin (Task 6) |
| Ganancia NETA por banco con fees reales de Binance + banca venezolana | Task 3 (reutiliza `computeArbitrageCycle` + `VENEZUELAN_BANK_FEES` + `MINIMUM_VIABLE_NET_SPREAD_PCT`) |
| Ventana BCV/paralelo SIN duplicar fórmula | Task 4 (reutiliza `computeTriangulationGap`, verifica `triangular-arbitrage`) |
| Contrato de desinstalación (`cleanup()`) | Task 6 |
| Gobernanza `maxConsecutiveErrors` real | Task 6 |
| Exposición pública en `@p2p/core` | Task 5 |
| **No romper 289 tests, build y UI** | Task 0 (baseline) + Task 8 (DoD), REGLA DE ORO |
| UI visible al usuario | Task 7 (OPCIONAL, requiere aprobación) |

**Fases futuras (fuera de alcance, NO incluir sin re-planificar):** tendencia del libro (spread-history), alertas webhooks, autocalibración de umbrales, cierre con repricer, unificación de scoring con `computeSpreadQualityScore`.

---

## Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| `computeArbitrageCycle` lanza excepción con inputs ≤ 0 | Guarda obligatoria en Task 3 Step 3 (verificada por test "sin input válido produce fila cero") |
| Deprecación silenciosa de APIs de `@p2p/core` | Solo se importan módulos ya exportados en public-api; Task 8 Step 2 confirma diff mínimo |
| Duplicación de lógica con `triangular-arbitrage` o `spread-quality` | D1/D2/D3 + Task 4 Step 1 (verificación obligatoria antes de implementar) |
| Comando `ng test --include` no soportado | Task 0 Step 1 decide y documenta el comando alternativo |
| `plugins/` fuera de tsconfig → typecheck falla | Task 0 Step 3; plan da comando manual; NO tocar configs sin aprobación |
| Ruptura visual accidental | REGLA DE ORO + Task 8 Step 2 (diff de sanity) + Task 7 requiere aprobación |