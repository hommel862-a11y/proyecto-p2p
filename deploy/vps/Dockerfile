# Multi-stage lightweight Dockerfile for VPS services (telegram-sentinel & inbound-gateway)
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root, tsconfig and workspace package descriptors
COPY package*.json ./
COPY tsconfig*.json ./
COPY packages/telegram-daemon/package*.json ./packages/telegram-daemon/
COPY packages/inbound-gateway/package*.json ./packages/inbound-gateway/
COPY projects/core ./projects/core

# Install dependencies and build both VPS workers
RUN npm install
COPY packages/telegram-daemon ./packages/telegram-daemon
COPY packages/inbound-gateway ./packages/inbound-gateway
RUN npm run telegram:daemon:build && npm run inbound:build

# Target 1: Telegram Sentinel 2.0 Daemon
FROM node:20-alpine AS telegram-sentinel

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/packages/telegram-daemon/dist/index.js ./index.js
COPY --from=builder /app/package.json ./package.json

USER node

CMD ["node", "index.js"]

# Target 2: Inbound Gateway (PostgreSQL 17 + pgvector + Meta/SSE)
FROM node:20-alpine AS inbound-gateway

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/packages/inbound-gateway/dist/index.js ./packages/inbound-gateway/dist/index.js
COPY --from=builder /app/packages/inbound-gateway/package.json ./packages/inbound-gateway/package.json
COPY --from=builder /app/package.json ./package.json

USER node

CMD ["node", "packages/inbound-gateway/dist/index.js"]
