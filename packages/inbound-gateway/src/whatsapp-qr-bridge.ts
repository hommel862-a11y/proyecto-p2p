import fs from 'node:fs';
import path from 'node:path';
import type { InboundNormalizedMessage } from './types.js';

export type WhatsAppQrConnectionStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'QR_READY'
  | 'CONNECTED'
  | 'ERROR';

export interface WhatsAppQrBridgeState {
  status: WhatsAppQrConnectionStatus;
  qrDataUrl: string | null;
  connectedPhone: string | null;
  connectedName: string | null;
  lastError: string | null;
  updatedAt: number;
}

export interface WhatsAppQrSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface WhatsAppQrBridgeOptions {
  authDir: string;
  onInboundMessage?: (msg: InboundNormalizedMessage) => void | Promise<void>;
  onStateChange?: (state: WhatsAppQrBridgeState) => void;
}

/**
 * Normalize a phone number or JID into a WhatsApp 1:1 JID (`<digits>@s.whatsapp.net`).
 */
export function normalizePhoneToJid(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.includes('@')) {
    return trimmed;
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return `${digits}@s.whatsapp.net`;
}

/**
 * Format a Baileys JID (`584247723783:12@s.whatsapp.net`) into `+584247723783`.
 */
export function formatJidToPhone(jid: string | undefined | null): string | null {
  if (!jid) return null;
  const userPart = jid.split('@')[0]?.split(':')[0] ?? '';
  const digits = userPart.replace(/\D/g, '');
  if (!digits) return null;
  return `+${digits}`;
}

/**
 * Extract readable text (or attachment fallback) from a Baileys `WAMessage.message` object.
 */
export function extractBaileysTextContent(
  message: Record<string, unknown> | null | undefined,
): { text: string; mediaType?: 'image' | 'audio' | 'document' | 'text' } | null {
  if (!message || typeof message !== 'object') return null;

  // Unwrap ephemeral / viewOnce wrappers if present
  const ephemeral = (message['ephemeralMessage'] as Record<string, unknown> | undefined)?.[
    'message'
  ] as Record<string, unknown> | undefined;
  const viewOnce = (message['viewOnceMessage'] as Record<string, unknown> | undefined)?.[
    'message'
  ] as Record<string, unknown> | undefined;
  const inner = ephemeral || viewOnce || message;

  if (typeof inner['conversation'] === 'string' && inner['conversation'].trim()) {
    return { text: inner['conversation'].trim(), mediaType: 'text' };
  }

  const extended = inner['extendedTextMessage'] as Record<string, unknown> | undefined;
  if (extended && typeof extended['text'] === 'string' && extended['text'].trim()) {
    return { text: extended['text'].trim(), mediaType: 'text' };
  }

  const imageMsg = inner['imageMessage'] as Record<string, unknown> | undefined;
  if (imageMsg) {
    const caption = typeof imageMsg['caption'] === 'string' ? imageMsg['caption'].trim() : '';
    return {
      text: caption || '[Imagen Adjunta - WhatsApp QR]',
      mediaType: 'image',
    };
  }

  const docMsg = inner['documentMessage'] as Record<string, unknown> | undefined;
  if (docMsg) {
    const caption = typeof docMsg['caption'] === 'string' ? docMsg['caption'].trim() : '';
    const fileName = typeof docMsg['fileName'] === 'string' ? docMsg['fileName'].trim() : '';
    return {
      text: caption || (fileName ? `[Documento: ${fileName}]` : '[Documento Adjunto - WhatsApp QR]'),
      mediaType: 'document',
    };
  }

  const audioMsg = inner['audioMessage'] as Record<string, unknown> | undefined;
  if (audioMsg) {
    return { text: '[Nota de Voz - WhatsApp QR]', mediaType: 'audio' };
  }

  const videoMsg = inner['videoMessage'] as Record<string, unknown> | undefined;
  if (videoMsg) {
    const caption = typeof videoMsg['caption'] === 'string' ? videoMsg['caption'].trim() : '';
    return { text: caption || '[Video Adjunto - WhatsApp QR]', mediaType: 'document' };
  }

  return null;
}

interface BaileysSocketLike {
  user?: { id?: string; name?: string };
  ev: {
    on: (event: string, listener: (...args: any[]) => void) => void;
  };
  sendMessage: (jid: string, content: { text: string }) => Promise<{ key?: { id?: string } } | undefined>;
  logout: () => Promise<void>;
  end: (error?: Error) => void;
}

export class WhatsAppQrBridge {
  private readonly authDir: string;
  private readonly onInboundMessage?: (msg: InboundNormalizedMessage) => void | Promise<void>;
  private readonly onStateChange?: (state: WhatsAppQrBridgeState) => void;

  private sock: BaileysSocketLike | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private stopping = false;
  private state: WhatsAppQrBridgeState = {
    status: 'DISCONNECTED',
    qrDataUrl: null,
    connectedPhone: null,
    connectedName: null,
    lastError: null,
    updatedAt: Date.now(),
  };

  constructor(options: WhatsAppQrBridgeOptions) {
    this.authDir = options.authDir;
    this.onInboundMessage = options.onInboundMessage;
    this.onStateChange = options.onStateChange;
  }

  public getState(): WhatsAppQrBridgeState {
    return { ...this.state };
  }

  public isConnected(): boolean {
    return this.state.status === 'CONNECTED' && this.sock !== null;
  }

  public hasSavedSession(): boolean {
    return fs.existsSync(path.join(this.authDir, 'creds.json'));
  }

  public async connect(): Promise<WhatsAppQrBridgeState> {
    this.stopping = false;
    if (this.state.status === 'CONNECTED' && this.sock) {
      return this.getState();
    }
    if (this.state.status === 'QR_READY' && this.state.qrDataUrl && this.sock) {
      return this.getState();
    }

    this.clearReconnectTimer();
    this.teardownSocket();
    fs.mkdirSync(this.authDir, { recursive: true });
    this.updateState({
      status: 'CONNECTING',
      qrDataUrl: null,
      lastError: null,
    });

    try {
      const baileys = await import('@whiskeysockets/baileys');
      const qrcodeMod = await import('qrcode');
      const pinoMod = await import('pino');

      const makeWASocket =
        (baileys as unknown as { default?: typeof baileys.makeWASocket; makeWASocket?: typeof baileys.makeWASocket })
          .makeWASocket ??
        (baileys as unknown as { default: typeof baileys.makeWASocket }).default;
      const useMultiFileAuthState = baileys.useMultiFileAuthState;
      const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
      const DisconnectReason = baileys.DisconnectReason;
      const QRCode =
        (qrcodeMod as unknown as { default?: typeof qrcodeMod }).default ?? qrcodeMod;
      const pino =
        (pinoMod as unknown as { default?: typeof pinoMod.pino }).default ??
        (pinoMod as unknown as typeof pinoMod.pino);

      const { state: authState, saveCreds } = await useMultiFileAuthState(this.authDir);
      let version: [number, number, number] | undefined;
      try {
        const latest = await fetchLatestBaileysVersion();
        version = latest.version;
      } catch {
        // Fallback to Baileys bundled WA Web version if offline/blocked
      }

      const logger = pino({ level: 'silent' });
      const sock = makeWASocket({
        ...(version ? { version } : {}),
        auth: authState,
        logger,
        printQRInTerminal: false,
        browser: ['P2P ARM CRM', 'Chrome', '1.5.1'],
        syncFullHistory: false,
      }) as unknown as BaileysSocketLike;

      this.sock = sock;
      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update: Record<string, unknown>) => {
        if (this.sock !== sock) return;
        const qr = typeof update['qr'] === 'string' ? update['qr'] : null;
        const connection = typeof update['connection'] === 'string' ? update['connection'] : null;
        const lastDisconnect = update['lastDisconnect'] as
          | { error?: { output?: { statusCode?: number }; message?: string } }
          | undefined;

        if (qr) {
          try {
            const qrDataUrl = await QRCode.toDataURL(qr, {
              width: 280,
              margin: 2,
              color: { dark: '#0f172a', light: '#ffffff' },
            });
            this.reconnectAttempts = 0;
            this.updateState({
              status: 'QR_READY',
              qrDataUrl,
              lastError: null,
            });
          } catch (err: unknown) {
            this.updateState({
              status: 'ERROR',
              qrDataUrl: null,
              lastError: err instanceof Error ? err.message : 'QR_RENDER_FAILED',
            });
          }
        }

        if (connection === 'open') {
          this.reconnectAttempts = 0;
          this.updateState({
            status: 'CONNECTED',
            qrDataUrl: null,
            connectedPhone: formatJidToPhone(sock.user?.id),
            connectedName: sock.user?.name || null,
            lastError: null,
          });
        } else if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          const reasonMsg = lastDisconnect?.error?.message || `Code ${statusCode ?? 'unknown'}`;

          this.sock = null;
          if (this.stopping || loggedOut) {
            if (loggedOut) {
              this.wipeAuthDir();
            }
            this.updateState({
              status: 'DISCONNECTED',
              qrDataUrl: null,
              connectedPhone: null,
              connectedName: null,
              lastError: loggedOut ? 'SESSION_LOGGED_OUT' : null,
            });
            return;
          }

          if (this.reconnectAttempts < 5) {
            this.reconnectAttempts++;
            const delayMs = Math.min(2000 * this.reconnectAttempts, 10_000);
            this.updateState({
              status: 'CONNECTING',
              qrDataUrl: null,
              lastError: `Reconectando (${this.reconnectAttempts}/5): ${reasonMsg}`,
            });
            this.reconnectTimer = setTimeout(() => {
              void this.connect();
            }, delayMs);
          } else {
            this.updateState({
              status: 'ERROR',
              qrDataUrl: null,
              lastError: `Desconectado tras reintentos: ${reasonMsg}`,
            });
          }
        }
      });

      sock.ev.on('messages.upsert', async (event: { messages?: Array<Record<string, unknown>>; type?: string }) => {
        if (event.type !== 'notify' || !Array.isArray(event.messages)) return;
        for (const raw of event.messages) {
          const key = raw['key'] as { remoteJid?: string; fromMe?: boolean; id?: string } | undefined;
          const remoteJid = key?.remoteJid || '';
          if (!remoteJid || key?.fromMe) continue;
          if (remoteJid === 'status@broadcast' || remoteJid.endsWith('@g.us')) continue;

          const extracted = extractBaileysTextContent(
            raw['message'] as Record<string, unknown> | undefined,
          );
          if (!extracted) continue;

          const phone = formatJidToPhone(remoteJid) || remoteJid;
          const pushName = typeof raw['pushName'] === 'string' ? raw['pushName'].trim() : undefined;
          const tsSec = Number(raw['messageTimestamp'] || 0);
          const timestamp = tsSec > 0 ? tsSec * 1000 : Date.now();

          const normalized: InboundNormalizedMessage = {
            eventId: key?.id || `waqr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            channel: 'WHATSAPP',
            sender: {
              id: phone,
              name: pushName,
              channel: 'WHATSAPP',
            },
            text: extracted.text,
            mediaType: extracted.mediaType,
            timestamp,
          };

          if (this.onInboundMessage) {
            try {
              await this.onInboundMessage(normalized);
            } catch (err: unknown) {
              console.warn(
                '[WA-QR-BRIDGE] Inbound handler error:',
                err instanceof Error ? err.message : String(err),
              );
            }
          }
        }
      });

      // Wait briefly (up to 4.5s) so the HTTP caller receives QR_READY or CONNECTED on the first response
      await this.waitForInitialSignal(4500);
      return this.getState();
    } catch (err: unknown) {
      this.updateState({
        status: 'ERROR',
        qrDataUrl: null,
        lastError: err instanceof Error ? err.message : String(err),
      });
      return this.getState();
    }
  }

  public async sendText(recipientPhone: string, text: string): Promise<WhatsAppQrSendResult> {
    if (!this.isConnected() || !this.sock) {
      return { ok: false, error: 'WA_QR_NOT_CONNECTED' };
    }
    const jid = normalizePhoneToJid(recipientPhone);
    if (!jid) {
      return { ok: false, error: 'INVALID_RECIPIENT_PHONE' };
    }
    try {
      const sent = await this.sock.sendMessage(jid, { text });
      return {
        ok: true,
        messageId: sent?.key?.id || `waqr-out-${Date.now()}`,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public async disconnect(clearSession = false): Promise<WhatsAppQrBridgeState> {
    this.stopping = true;
    this.clearReconnectTimer();
    const current = this.sock;
    this.sock = null;

    if (current) {
      try {
        if (clearSession && this.state.status === 'CONNECTED') {
          await current.logout();
        } else {
          current.end(undefined);
        }
      } catch {
        try {
          current.end(undefined);
        } catch {
          // ignore close errors
        }
      }
    }

    if (clearSession) {
      this.wipeAuthDir();
    }

    this.updateState({
      status: 'DISCONNECTED',
      qrDataUrl: null,
      connectedPhone: null,
      connectedName: null,
      lastError: null,
    });
    return this.getState();
  }

  public async stop(): Promise<void> {
    await this.disconnect(false);
  }

  private waitForInitialSignal(timeoutMs: number): Promise<void> {
    if (
      this.state.status === 'QR_READY' ||
      this.state.status === 'CONNECTED' ||
      this.state.status === 'ERROR'
    ) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const start = Date.now();
      const iv = setInterval(() => {
        if (
          this.state.status === 'QR_READY' ||
          this.state.status === 'CONNECTED' ||
          this.state.status === 'ERROR' ||
          Date.now() - start >= timeoutMs
        ) {
          clearInterval(iv);
          resolve();
        }
      }, 150);
    });
  }

  private updateState(partial: Partial<WhatsAppQrBridgeState>): void {
    this.state = {
      ...this.state,
      ...partial,
      updatedAt: Date.now(),
    };
    this.onStateChange?.(this.getState());
  }

  private teardownSocket(): void {
    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {
        // ignore
      }
      this.sock = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private wipeAuthDir(): void {
    try {
      if (fs.existsSync(this.authDir)) {
        fs.rmSync(this.authDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup failures
    }
  }
}
