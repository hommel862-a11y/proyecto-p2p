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

## 3. Alternativa con Docker / Docker Compose (Incluye PostgreSQL 17 + pgvector)

El archivo `docker-compose.yml` aprovisiona tres servicios coordinados:
1. `telegram-sentinel`: Bot de alertas, data lake y monitoreo 24/7 en el puerto `3000`.
2. `postgres` (`pgvector/pgvector:pg17-alpine`): Base de datos relacional y vectorial con volumen persistente `pg_arm_data`, healthcheck `pg_isready`, aislamiento estricto por silo mediante Row-Level Security (`ARM_B2B`, `P2P_DESK`, `FINANCE_360`) y carga automática de las migraciones `001_init_arm_schema.sql` y `002_crm_unification_and_hardening.sql`.
3. `inbound-gateway`: Pasarela omnicanal en el puerto `3030` con espera automática (`condition: service_healthy`), escucha en tiempo real `LISTEN/NOTIFY` sobre `arm_outbox_channel` hacia SSE (`/api/events`) y verificación anti-replay de comprobantes (`POST /api/arm/receipts/verify`, `GET /api/arm/health/storage`). Si `DATABASE_URL` no está configurado, opera automáticamente en modo `MEMORY_FALLBACK`.

Para desplegar con Docker Compose:

```bash
cd deploy/vps
cp .env.example .env
# Edita .env con tus credenciales reales (incluyendo POSTGRES_PASSWORD y DATABASE_URL)
docker compose up -d --build
```

Para verificar el estado de PostgreSQL y la salud de almacenamiento del gateway:

```bash
docker compose ps
curl -s http://localhost:3030/api/arm/health/storage
```

---

## 4. Alternativa Sin Docker — Opción B (Node Local / PM2 + Supabase o Neon)

Si no tenés Docker ni `psql` instalados (por ejemplo en Windows o un VPS ligero), podés correr el gateway directo en Node conectado a un **PostgreSQL 17 + `pgvector` administrado** (Supabase o Neon):

1. **Configurá `DATABASE_URL`** en el `.env` raíz o en `deploy/vps/.env` usando la URL **Direct / Session (puerto `5432`)** con TLS activo.
   - Evitá el Transaction Pooler (puerto `6543` / `pgbouncer=true`) porque interrumpe `LISTEN arm_outbox_channel` para SSE.
   - Si el proveedor usa un certificado de pooler propio, configurá `DATABASE_SSL_CA_PATH` (recomendado) o `sslmode=no-verify`.
2. **Compilá, verificá requisitos y aplicá las migraciones sin `psql`:**
   ```bash
   npm run inbound:build
   npm run inbound:check:db
   npm run inbound:migrate
   ```
   *(El runner registra cada archivo aplicado en `public.arm_schema_migrations`, adopta automáticamente `001_init_arm_schema.sql` si la base ya existía y acepta `--only=001,002` si querés limitar migraciones).*
3. **Levantá el gateway con reconexión automática (`startOutboxListener` con backoff exponencial):**
   ```bash
   npm run inbound:start
   ```
   O en VPS Linux con PM2 junto al bot:
   ```bash
   pm2 start packages/inbound-gateway/dist/index.js --name "p2p-inbound-gateway"
   pm2 save
   ```
4. **Comprobá salud, RLS, `pgvector` y estado del listener:**
   ```bash
   curl -s "http://127.0.0.1:3030/api/arm/health/storage?verbose=1"
   ```

---

## 5. Comandos de Monitoreo y Mantenimiento

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
