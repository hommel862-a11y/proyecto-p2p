# Fase 3: Infraestructura de Red Nativa y Persistencia Móvil Robusta

## Objetivo

Eliminar la vulnerabilidad y fragilidad de red en dispositivos móviles (Capacitor/Android) y garantizar almacenamiento persistente de grado institucional:
1. Implementar `NativeHttpService` utilizando `CapacitorHttp` de `@capacitor/core`. Esto permite que la aplicación en teléfonos Android/iOS realice peticiones HTTP nativas a través del socket del sistema operativo, eliminando completamente las restricciones de CORS del WebView y la necesidad de puentes locales inexistentes (`127.0.0.1:51857`) o proxies públicos inseguros (`allorigins.win`).
2. Integrar `NativeHttpService` en los servicios centrales de mercado:
   - `BinanceP2pService`: búsqueda directa de ofertas en el libro P2P sin CORS.
   - `CotizaveService`: consulta directa de tasas BCV y Paralelo sin fallos por origen.
   - `SpotMarketService`: lectura directa de tickers Spot (BTC/USDT, USDC/USDT, etc.).
3. Robustecer `IndexedDbStorageService` para entornos móviles WebView:
   - Manejo defensivo de eventos `onblocked` y `onversionchange` de IndexedDB.
   - Resiliencia ante cierres forzados de la aplicación por el sistema operativo en segundo plano.

## Problema / Justificación

- En Android (Capacitor), la aplicación corre bajo el origen `https://localhost` o `capacitor://localhost`. Las APIs públicas de Binance y otros proveedores bloquean peticiones directas de navegadores por CORS.
- Anteriormente, el código intentaba conectarse a `http://127.0.0.1:51857`, un puerto que solo existe cuando la aplicación de escritorio de Electron está corriendo en la misma máquina, o requería activar proxies públicos de terceros, exponiendo IPs y metadatos de órdenes.
- Con `CapacitorHttp` (que ya está habilitado en `capacitor.config.ts`), las peticiones salen por la capa nativa de Android/iOS (Java HttpURLConnection / OkHttp), donde CORS no aplica.

## Plan de Verificación

- `npx vitest run src/app/core/native-http.service.spec.ts`
- `npx vitest run src/app/core/binance-p2p.service.spec.ts`
- `npx vitest run src/app/core/cotizave.service.spec.ts`
- `npx vitest run src/app/core/spot-market.service.spec.ts`
- `npx vitest run src/app/core/indexed-db-storage.service.spec.ts`
- `npm run check:vendor`
- `npm run test:electron`
- `npx tsc -p tsconfig.app.json --noEmit`
