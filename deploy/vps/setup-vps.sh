#!/bin/bash
# =================================================================
# SCRIPT DE INSTALACIÓN AUTOMÁTICA EN VPS LINUX (UBUNTU / DEBIAN / ORACLE)
# P2P Decisor — Telegram Sentinel 2.0 24/7 Cloud Daemon
# =================================================================

set -e

echo "═══════════════════════════════════════════════════════════════════════"
echo "  INSTALANDO TELEGRAM SENTINEL 2.0 (MODO 24/7 CLOUD VPS)"
echo "═══════════════════════════════════════════════════════════════════════"

# 1. Actualizar repositorios e instalar paquetes base
echo "[1/4] Actualizando sistema y paquetes base..."
sudo apt update -y && sudo apt upgrade -y
sudo apt install -y curl git ufw build-essential

# 2. Instalar Node.js 20 LTS si no existe
if ! command -v node &> /dev/null; then
    echo "[2/4] Instalando Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "[2/4] Node.js ya está instalado: $(node -v)"
fi

# 3. Instalar PM2 para gestión de procesos 24/7 con reinicio automático
if ! command -v pm2 &> /dev/null; then
    echo "[3/4] Instalando PM2 (Process Manager)..."
    sudo npm install -g pm2
fi

# 4. Configurar variables de entorno si no existe .env
if [ ! -f .env ]; then
    echo "[4/4] Creando archivo de configuración .env..."
    cp .env.example .env
    echo "⚠️ Por favor editá el archivo .env con tus credenciales: nano .env"
fi

# 5. Compilar e iniciar el daemon con PM2
echo "═══════════════════════════════════════════════════════════════════════"
echo "  COMPILANDO Y DESPLEGANDO EL SERVICIO..."
echo "═══════════════════════════════════════════════════════════════════════"

npm install
npm run telegram:daemon:build

pm2 stop p2p-telegram-sentinel 2>/dev/null || true
pm2 start packages/telegram-daemon/dist/index.js --name "p2p-telegram-sentinel"
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME || true

echo "═══════════════════════════════════════════════════════════════════════"
echo "  ¡DESPLIEGUE EXITOSO! Tu bot ya está corriendo 24/7 en la nube."
echo "  Ver logs en vivo con: pm2 logs p2p-telegram-sentinel"
echo "═══════════════════════════════════════════════════════════════════════"
