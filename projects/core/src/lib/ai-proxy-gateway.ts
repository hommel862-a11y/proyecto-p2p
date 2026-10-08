/**
 * Centralized AI Proxy Gateway with Semantic Caching & Multi-Provider Fallback.
 * Normalizes queries, caches frequent market & operational lookups to save token costs,
 * and seamlessly fails over between AI providers (Gemini, OpenAI, DeepSeek, Anthropic, Qwen).
 * Pure domain logic, deterministic, framework-agnostic.
 */

export type AiProviderName = 'gemini' | 'openai' | 'deepseek' | 'anthropic' | 'qwen';

export interface SemanticCacheEntry {
  canonicalKey: string;
  originalPrompt: string;
  response: string;
  createdAt: number;
  expiresAt: number;
  ttlMs: number;
  estimatedTokensSaved: number;
  hitCount: number;
}

export interface SemanticCacheStats {
  totalEntries: number;
  totalHits: number;
  totalMisses: number;
  hitRatioPct: number;
  estimatedTokensSaved: number;
}

export interface AiProviderConfig {
  provider: AiProviderName;
  apiKey: string;
  model?: string;
  priority?: number; // Lower number = higher priority
  baseUrl?: string;
}

export interface AiGatewayRequest {
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  maxTokens?: number;
  forceRefresh?: boolean;
}

export interface AiGatewayResponse {
  content: string;
  providerUsed: AiProviderName | 'cache' | 'none';
  modelUsed: string;
  cached: boolean;
  latencyMs: number;
  fallbackChain?: AiProviderName[];
  tokensEstimated?: number;
}

/**
 * Normalizes prompt to canonical form for semantic matching.
 * Removes conversational stop words, excessive whitespace, punctuation, and unifies terms.
 */
export function normalizeSemanticPrompt(prompt: string): string {
  if (!prompt) return '';

  let norm = prompt
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[¿?¡!.,:;()\[\]{}"'_#+\-*\/\\|]/g, ' ')
    .trim();

  // Replace common conversational stop phrases
  const stopWords = [
    /\b(hola|por favor|buenas|dime|cual es|como esta|que es|explicame|quiero saber)\b/g,
    /\b(hoy|ahora|actualmente|en este momento|a ver)\b/g,
  ];
  for (const sw of stopWords) {
    norm = norm.replace(sw, ' ');
  }

  // Canonicalize common P2P financial aliases
  norm = norm
    .replace(/\b(dolar|dolares|usd|tether)\b/g, 'usdt')
    .replace(/\b(bolivar|bolivares|bs|bsf|bss)\b/g, 'ves')
    .replace(/\b(brecha|diferencia|gap bcv)\b/g, 'gap_bcv')
    .replace(/\b(tasa oficial|bcv)\b/g, 'bcv')
    .replace(/\b(tasa paralela|paralelo|monitor)\b/g, 'paralelo')
    .replace(/\b(libro de ordenes|profundidad|orderbook)\b/g, 'orderbook')
    .replace(/\b(margen|spread|ganancia)\b/g, 'spread')
    .replace(/\s+/g, ' ')
    .trim();

  return norm;
}

export class SemanticCache {
  private entries: Map<string, SemanticCacheEntry> = new Map();
  private maxEntries: number;
  private defaultTtlMs: number;
  private hits = 0;
  private misses = 0;
  private tokensSaved = 0;

  constructor(maxEntries = 500, defaultTtlMs = 60_000) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
  }

  public get(prompt: string): SemanticCacheEntry | null {
    const key = normalizeSemanticPrompt(prompt);
    if (!key) {
      this.misses++;
      return null;
    }

    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.entries.delete(key);
      this.misses++;
      return null;
    }

    entry.hitCount++;
    this.hits++;
    this.tokensSaved += entry.estimatedTokensSaved;
    return entry;
  }

  public set(
    prompt: string,
    response: string,
    ttlMs: number = this.defaultTtlMs,
    estimatedTokens = 150,
  ): void {
    const key = normalizeSemanticPrompt(prompt);
    if (!key || !response) return;

    // Evict oldest if capacity exceeded (FIFO)
    if (this.entries.size >= this.maxEntries) {
      const firstKey = this.entries.keys().next().value;
      if (firstKey) this.entries.delete(firstKey);
    }

    const now = Date.now();
    const entry: SemanticCacheEntry = {
      canonicalKey: key,
      originalPrompt: prompt,
      response,
      createdAt: now,
      expiresAt: now + ttlMs,
      ttlMs,
      estimatedTokensSaved: estimatedTokens,
      hitCount: 0,
    };

    this.entries.set(key, entry);
  }

  public getStats(): SemanticCacheStats {
    const totalRequests = this.hits + this.misses;
    const hitRatioPct =
      totalRequests > 0 ? Number(((this.hits / totalRequests) * 100).toFixed(2)) : 0;

    return {
      totalEntries: this.entries.size,
      totalHits: this.hits,
      totalMisses: this.misses,
      hitRatioPct,
      estimatedTokensSaved: this.tokensSaved,
    };
  }

  public clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
    this.tokensSaved = 0;
  }
}

/**
 * Multi-Provider Failover Router with Automatic Circuit Breaker.
 */
export class AiProviderRouter {
  private providers: AiProviderConfig[] = [];
  private cooldowns: Map<AiProviderName, number> = new Map();
  private readonly cooldownDurationMs = 30_000;

  constructor(providers: AiProviderConfig[] = []) {
    this.setProviders(providers);
  }

  public setProviders(providers: AiProviderConfig[]): void {
    this.providers = [...providers].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  }

  public getAvailableProviders(): AiProviderConfig[] {
    const now = Date.now();
    return this.providers.filter((p) => {
      const cd = this.cooldowns.get(p.provider) || 0;
      return now >= cd;
    });
  }

  public tripProviderCooldown(provider: AiProviderName): void {
    this.cooldowns.set(provider, Date.now() + this.cooldownDurationMs);
  }

  public resetCooldowns(): void {
    this.cooldowns.clear();
  }

  public async executeWithFallback(
    request: AiGatewayRequest,
    callerFn: (config: AiProviderConfig, req: AiGatewayRequest) => Promise<string>,
  ): Promise<AiGatewayResponse> {
    const start = Date.now();
    const available = this.getAvailableProviders();
    const fallbackChain: AiProviderName[] = [];

    if (available.length === 0) {
      return {
        content: '⚠️ No hay proveedores de IA configurados o disponibles en este momento.',
        providerUsed: 'none',
        modelUsed: 'none',
        cached: false,
        latencyMs: Date.now() - start,
      };
    }

    for (const config of available) {
      fallbackChain.push(config.provider);
      try {
        const result = await callerFn(config, request);
        return {
          content: result,
          providerUsed: config.provider,
          modelUsed: config.model || 'default',
          cached: false,
          latencyMs: Date.now() - start,
          fallbackChain: fallbackChain.length > 1 ? fallbackChain : undefined,
          tokensEstimated: Math.round((request.prompt.length + result.length) / 4),
        };
      } catch (err) {
        console.warn(`[AiProviderRouter] Fallo en proveedor ${config.provider}:`, err);
        this.tripProviderCooldown(config.provider);
        // Continue loop to next fallback provider
      }
    }

    return {
      content: '❌ Todos los proveedores de IA configurados fallaron en procesar la solicitud.',
      providerUsed: 'none',
      modelUsed: 'none',
      cached: false,
      latencyMs: Date.now() - start,
      fallbackChain,
    };
  }
}
