# Despliegue de P2P Decisor Cloud Sentinel en VPS (4 Módulos 24/7)

Esta suite transforma tu servidor VPS en un centro neurálgico institucional que corre **24 horas al día, 7 días a la semana, incluso con tu computadora apagada**.

---

## 🚀 Capacidades Desplegadas en el Servidor

1. **🔥 Data Lake de Microestructura & Heatmap 24/7 (Fase 1)**
   - Ingesta de ticks cada 15 segundos y cálculo de estacionalidad horaria de arbitraje.
   - Comandos Telegram: `/heatmap`, `/horarios`.
   - REST API: `GET /api/market/heatmap`, `GET /api/market/stats`.

2. **⚡ Motor de Reprecio Autónomo & Circuit Breaker (Fase 2)**
   - Anclaje dinámico de posturas L2 según régimen de volatilidad y saturación bancaria.
   - Pausa de seguridad automática ante compresión de spread o alertas SUDEBAN.
   - Comandos Telegram: `/autoreprice on`, `/autoreprice off`, `/autoreprice status`, `/autoreprice config <estrategia> <minSpread>`.
   - REST API: `GET /api/repricer/status`, `POST /api/repricer/toggle`.

3. **🧠 Gateway Centralizado de IA & Caché Semántico L2 (Fase 3)**
   - Respuestas instantáneas y ahorro de tokens mediante indexación de consultas frecuentes.
   - Failover multi-proveedor automático: Gemini 2.0 Flash $\rightarrow$ OpenAI $\rightarrow$ DeepSeek $\rightarrow$ Claude.
   - Comandos Telegram: `/ask <pregunta>`, `/ai <pregunta>`.
   - REST API: `POST /api/ai/chat`, `GET /api/ai/stats`, `POST /api/ai/cache/clear`.

4. **🔄 Hub de Sincronización Cifrada E2E Multi-Dispositivo (Fase 4)**
   - Cifrado Zero-Knowledge AES-256-GCM y resolución de conflictos mediante CRDT (Last-Write-Wins).
   - Comandos Telegram: `/sync`, `/sincronizar`.
   - REST API: `GET /api/sync/status`, `POST /api/sync/push`, `GET /api/sync/pull`.

---

## 1. Opción Gratuita Recomendada: Oracle Cloud Always Free

Oracle Cloud Infrastructure (OCI) ofrece instancias de cómputo **100% gratuitas de por vida** (Always Free):
* **Recursos:** Hasta 4 núcleos ARM Ampere + 24 GB de RAM (o instancias AMD micro).
* **Consumo del Daemon:** Menos de **50 MB de RAM**.
* **Costo:** $0 / mes para siempre.

---

## 2. Despliegue en 3 Pasos en tu Servidor Linux (Ubuntu / Debian / Oracle Linux)

Conectate a tu VPS por SSH desde tu terminal o PowerShell:

```bash
ssh -i tu_clave_ssh.key ubuntu@TU_IP_PUBLICA
```

### Paso A: Clonar o Subir el Proyecto
```bash
git clone https://github.com/tu-usuario/proyecto-p2p.git
cd proyecto-p2p
```

### Paso B: Configurar Credenciales
```bash
cd deploy/vps
cp .env.example .env
nano .env
```
Completá tus credenciales en el archivo `.env`:
* `TELEGRAM_BOT_TOKEN`: Tu token obtenido de `@BotFather`.
* `TELEGRAM_CHAT_ID`: Tu Chat ID personal de Telegram.
* `COTIZAVE_API_KEY`: Tu API Key de CotizaVe.
* `GEMINI_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY`: Opcionales para el Proxy de IA.

*(Presioná `Ctrl + O` y luego `Enter` para guardar, y `Ctrl + X` para salir de nano).*

### Paso C: Ejecutar el Script de Instalación Automática
```bash
chmod +x setup-vps.sh
./setup-vps.sh
```

El script instalará automáticamente Node.js 20 LTS, compilará el daemon de TypeScript y lo dejará corriendo en segundo plano con **PM2** (con auto-reinicio si el servidor se reinicia).

---

## 3. Alternativa con Docker / Docker Compose

Si preferís desplegar con Docker:

```bash
cd deploy/vps
docker compose up -d --build
```

---

## 4. Comandos de Monitoreo y Mantenimiento

* **Ver logs del bot en vivo:**
  ```bash
  pm2 logs p2p-telegram-sentinel
  ```
* **Ver estado de los 4 servicios y consumo de RAM:**
  ```bash
  pm2 status
  ```
* **Reiniciar el servicio:**
  ```bash
  pm2 restart p2p-telegram-sentinel
  ```
* **Detener el servicio:**
  ```bash
  pm2 stop p2p-telegram-sentinel
  ```
