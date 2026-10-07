# Despliegue de Telegram Sentinel 2.0 en VPS / Nube Gratuita

Esta guía explica cómo desplegar el microservicio autónomo de **Telegram Sentinel 2.0** en un servidor VPS remoto (en la nube) para que el bot responda preguntas, escanee arbitraje y envíe alertas **las 24 horas del día, los 7 días de la semana, incluso con tu computadora apagada**.

---

## 1. Opción Gratuita Recomendada: Oracle Cloud Always Free

Oracle Cloud Infrastructure (OCI) ofrece instancias de cómputo **100% gratuitas de por vida** (Always Free Eligible):
* **Recursos:** Hasta 4 núcleos ARM Ampere + 24 GB de RAM (o 2 instancias micro AMD x86).
* **Dirección IP Pública:** Fija y gratuita.
* **Costo:** $0 / mes para siempre.

### Pasos para crear tu VPS en Oracle Cloud:
1. Registrate en [oracle.com/cloud/free](https://www.oracle.com/cloud/free/).
2. En la consola de Oracle, andá a **Compute > Instances > Create Instance**.
3. Seleccioná imagen **Ubuntu 22.04 LTS** o **Ubuntu 24.04**.
4. Descargá tu clave SSH privada (`.key` o `.pem`) para conectarte.
5. Hacé clic en **Create**.

---

## 2. Despliegue en 3 Pasos en tu Servidor Linux

Conectate a tu VPS por SSH desde tu terminal (o PowerShell):

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
Completá tus datos en el archivo `.env`:
* `TELEGRAM_BOT_TOKEN`: Tu token de `@BotFather`.
* `TELEGRAM_CHAT_ID`: Tu Chat ID personal de Telegram.
* `COTIZAVE_API_KEY`: Tu API Key de CotizaVe.

*(Presioná `Ctrl + O` y luego `Enter` para guardar, y `Ctrl + X` para salir de nano).*

### Paso C: Ejecutar el Script de Instalación Automática
```bash
chmod +x setup-vps.sh
./setup-vps.sh
```

El script instalará automáticamente Node.js 20 LTS, compilará el daemon de TypeScript y lo dejará corriendo en segundo plano con **PM2** (con auto-reinicio si el servidor se reinicia).

---

## 3. Alternativa con Docker / Docker Compose

Si preferís usar contenedores Docker:

```bash
cd deploy/vps
docker compose up -d --build
```

---

## 4. Comandos Útiles de Mantenimiento

* **Ver logs del bot en vivo:**
  ```bash
  pm2 logs p2p-telegram-sentinel
  ```
* **Reiniciar el bot:**
  ```bash
  pm2 restart p2p-telegram-sentinel
  ```
* **Detener el bot:**
  ```bash
  pm2 stop p2p-telegram-sentinel
  ```
* **Ver estado del proceso y consumo de RAM:**
  ```bash
  pm2 status
  ```
