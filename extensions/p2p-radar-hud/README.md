# P2P Radar HUD - Tactical Terminal Overlay (Chrome Extension MV3)

Extensión ultraligera de navegador para **Google Chrome**, **Brave** y **Microsoft Edge** que inyecta un Terminal de Decisión Cuantitativa en tiempo real sobre la interfaz oficial de **Binance P2P** (`https://p2p.binance.com/*`).

---

## ⚡ Arquitectura y Flujo de Datos

```
[ P2P Decisor Web / Electron App ] (http://localhost:4200/radar)
                     │
                     ▼
       BroadcastChannel ('p2p_radar_hud_channel')
                     │
                     ▼
          [ bridge.js ] (Content Script en App Origin)
                     │
                     ▼
       [ background.js ] (Manifest V3 Service Worker)
                     │
                     ▼
          [ content.js ] (Content Script en https://p2p.binance.com/*)
                     │
                     ▼
  [ Floating Draggable HUD Widget ] (Sobre Binance P2P)
```

1. **Cero Latencia / Cero Servidores Externos**: La extensión no requiere de un proceso WebSocket o Node.js intermediario en segundo plano. Usa la API nativa `BroadcastChannel` para comunicar la app con la extensión.
2. **Payload Destilado (<3KB)**: El motor central (`buildRadarHudPayload`) envía únicamente los datos calculados necesarios (Top 3 de rutas de arbitraje, top rates limpios por banco, termómetro de tendencia y alertas de bots).
3. **No Invasivo y Reposicionable**: El widget flota sobre la esquina superior derecha de Binance P2P, se puede arrastrar con el cursor a cualquier posición de la pantalla y colapsar a un modo píldora discreto (`_`).

---

## 🛠️ Instalación en tu Navegador (Modo Desarrollador)

### 1. Abre la página de extensiones:
- **Google Chrome**: Navega a `chrome://extensions/`
- **Brave**: Navega a `brave://extensions/`
- **Microsoft Edge**: Navega a `edge://extensions/`

### 2. Activa el "Modo de desarrollador":
- En la esquina superior derecha de la pantalla de extensiones, enciende el switch **Modo de desarrollador** (Developer mode).

### 3. Carga la extensión descomprimida:
- Haz clic en el botón **Cargar descomprimida** (Load unpacked).
- Selecciona la carpeta:
  `E:\05_Proyectos\proyecto p2p\extensions\p2p-radar-hud`

---

## 🚀 Flujo de Prueba y Uso

1. **Inicia la Aplicación P2P**:
   ```bash
   npm start
   ```
   Abre [http://localhost:4200/radar](http://localhost:4200/radar).
2. **Verifica que el HUD esté activo**:
   - En la cabecera del Radar, asegúrate de que el botón diga `HUD Extension: LIVE` (verde).
3. **Abre Binance P2P**:
   - Entra en [https://p2p.binance.com/es/trade/all-payments/USDT?fiat=VES](https://p2p.binance.com/es/trade/all-payments/USDT?fiat=VES).
   - Verás el widget flotante oscuro **Radar Intel P2P** en la esquina superior derecha.
4. **Copia de Tasas Instantánea**:
   - En el widget, haz clic en **📋 Copiar Tasa** para pegar de inmediato la tasa sugerida al crear o editar tu anuncio en Binance.
