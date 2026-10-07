# Multi-stage lightweight Dockerfile for Telegram Sentinel 2.0 Daemon
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root and package descriptors
COPY package*.json ./
COPY packages/telegram-daemon/package*.json ./packages/telegram-daemon/
COPY projects/core ./projects/core

# Install dependencies and build
RUN npm install
COPY packages/telegram-daemon ./packages/telegram-daemon
RUN npm run telegram:daemon:build

# Production runner image (under 80MB)
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/packages/telegram-daemon/dist/index.js ./index.js
COPY --from=builder /app/package.json ./package.json

# Run as non-root user for security
USER node

CMD ["node", "index.js"]
