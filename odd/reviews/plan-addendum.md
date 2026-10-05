# Addendum al plan de remediación

Cuatro correcciones verificables al plan de implementación. Todo verificado contra el árbol, sin
modificar código.

## 1. El comando de test del core no ejercita nada

El plan propone:

```
npx vitest run projects/core
```

Pero `projects/core/src/lib/*.spec.ts` corre con `ng test` vía `@angular/build:unit-test`
(`angular.json:73` y `:109`). Vitest y el runner de Angular no comparten nada. Ese comando puede
terminar en verde sin haber ejecutado una sola aserción.

Comando correcto, el mismo que ya usamos y del que tenemos baseline conocido:

```
npx ng test core --watch=false
```

Baseline a comparar: **718 passing, 1 failing** (el fallo es `pdf-invoice-generator`, preexistente y
ajeno a este trabajo). Si el número de passing baja de 718, algo se rompió.

Nota: `vitest` sí es el runner correcto para `packages/mcp-server` (`package.json` → `"test": "vitest
run"`), solo que en otro paquete.

## 2. Falta `check:vendor` en la verificación

`projects/core` se vendoriza. El root ya tiene el atajo:

```
npm run check:vendor
```

Es `sync-vendor-core.cjs --check` y existe exactamente para esto. Si los módulos core cambian sin
re-vendorizar, `dist/` queda desincronizado y **el bundle que se despliega no es el que se testeó**.

Secuencia de verificación completa, en este orden:

```
npm run check:vendor
npm run mcp:test
npm run test:electron
npx tsc --noEmit
npx ng test core --watch=false
npm run mcp:build
npx ng build --configuration=development
```

## 3. `triangular-arbitrage.ts` tiene 580 líneas, no 644

El plan cita 644. El archivo tiene 580. No es grave por sí mismo, pero indica que la comparación de
capacidad se hizo de memoria y no leyendo el archivo. Vale la pena releer el módulo antes de
adaptarlo, sobre todo `evaluateTriangularSlippageRisk` (línea 613) y
`DEFAULT_TRIANGULAR_PRESETS` (línea 304), que son las piezas que hay que reusar.

## 4. El spec actual queda apuntando a la nada

Esto es el más importante para la verificación.

Hoy `synthetic-stable-arbitrage.spec.ts` tiene tres tests que llaman
`calculateSyntheticStableOpportunity` directamente:

```ts
const opp = calculateSyntheticStableOpportunity(quote);
expect(opp.direction).toBe('CONVERT_SPOT_AND_SELL_P2P');
expect(opp.isActionable).toBe(true);
```

Si la función se convierte en fachada y desaparece, **los tres tests se rompen o se borran**, y un
suite más chico pasa en verde. "Robustecer los tests" sin nombrar los nuevos deja la verificación
incapaz de distinguir "arreglado" de "test eliminado".

Los tres tests que tienen que existir después del refactor:

```ts
it('nunca declara isActionable sin fricción explícita', () => {
  // sin transferOrCashFrictionPct → isActionable: false, reason: 'MISSING_FRICTION_METRICS'
});

it('propaga slippage desde calculateTriangularArbitrage', () => {
  // el adaptador no puede perder el slippage guard del módulo base
});

it('no emite ningún veredicto afirmativo sin fuente real', () => {
  // ninguna ruta devuelve SAFE_TO_*, isViable ni APPROVE_*
});
```

## 5. Dos bugs vivos que no están en la lista

No son del trabajo en vuelo, pero son de la misma clase que el hallazgo 1.3 y van junto si el
objetivo es honestidad financial:

- **`/status` renderiza `0` cuando no hay libro.** `src/app/core/telegram-worker.service.ts` compone la
  línea de estado a mano con fallback a cero. La superficie hermana (`telegram-sentinel.ts`,
  `isPrintableAudit`) sí declara la ausencia con frase. Mismo defecto que el hallazgo 1.3: ausencia
  dibujada como número.
- **Los secretos cruzan el bridge.** El doc de `bybit-p2p.service.ts:36-38` declara que las
  peticiones firmadas se quedan en el proceso main. `binance-fills.service.ts:81-99` pasa
  `apiKey`/`apiSecret` por el bridge para que main firme. Contradicción abierta, no trazada hasta el
  preload.

## Lo que el plan hace bien, y conviene preservar

- El orden es correcto: fallbacks primero, porque son lo único conectado a un LLM vía
  `agent-skills.ts`. Después motores, después bundle, después tests.
- Convertir el duplicado en **adaptador** en vez de borrarlo. `synthetic-stable-arbitrage` tiene forma
  de entrada propia (`StableCrossQuote`) y cubre un caso que el otro módulo no modela: el test de
  `EURC` con `spotRate: 1.085` contra `p2pTargetRateFiat: 93.0` es una despegada real, no un caso
  inventado. La adaptación tiene fundamento.
- `MISSING_FRICTION_METRICS` como razón es la respuesta correcta al hallazgo 1.3. Que la ausencia
  bloquee en vez de asumir cero.
