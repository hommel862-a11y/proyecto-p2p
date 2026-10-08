/**
 * Cloud AI Proxy Gateway Service with Semantic Caching & Multi-Provider Fallback.
 * Serves desktop/mobile applications and Telegram bot with centralized token management.
 */

import {
  SemanticCache,
  AiProviderRouter,
  type AiProviderConfig,
  type AiGatewayRequest,
  type AiGatewayResponse,
} from '@p2p/core';

export class CloudAiProxyService {
  private cache: SemanticCache;
  private router: AiProviderRouter;

  constructor() {
    this.cache = new SemanticCache(500, 300_000); // 5 minute default TTL

    const providers: AiProviderConfig[] = [];

    if (process.env['GEMINI_API_KEY']) {
      providers.push({
        provider: 'gemini',
        apiKey: process.env['GEMINI_API_KEY'].trim(),
        model: process.env['GEMINI_MODEL']?.trim() || 'gemini-2.0-flash',
        priority: 1,
      });
    }

    if (process.env['OPENAI_API_KEY']) {
      providers.push({
        provider: 'openai',
        apiKey: process.env['OPENAI_API_KEY'].trim(),
        model: process.env['OPENAI_MODEL']?.trim() || 'gpt-4o-mini',
        priority: 2,
      });
    }

    if (process.env['DEEPSEEK_API_KEY']) {
      providers.push({
        provider: 'deepseek',
        apiKey: process.env['DEEPSEEK_API_KEY'].trim(),
        model: process.env['DEEPSEEK_MODEL']?.trim() || 'deepseek-chat',
        priority: 3,
        baseUrl: 'https://api.deepseek.com/v1',
      });
    }

    if (process.env['ANTHROPIC_API_KEY']) {
      providers.push({
        provider: 'anthropic',
        apiKey: process.env['ANTHROPIC_API_KEY'].trim(),
        model: process.env['ANTHROPIC_MODEL']?.trim() || 'claude-3-5-sonnet-20241022',
        priority: 4,
      });
    }

    this.router = new AiProviderRouter(providers);
  }

  public getCacheStats() {
    return this.cache.getStats();
  }

  public clearCache(): void {
    this.cache.clear();
  }

  public async ask(
    prompt: string,
    systemInstruction?: string,
    forceRefresh = false,
  ): Promise<AiGatewayResponse> {
    const start = Date.now();

    // 1. Check Semantic Cache if not force refreshing
    if (!forceRefresh) {
      const cached = this.cache.get(prompt);
      if (cached) {
        return {
          content: cached.response,
          providerUsed: 'cache',
          modelUsed: 'semantic-cache',
          cached: true,
          latencyMs: Date.now() - start,
          tokensEstimated: cached.estimatedTokensSaved,
        };
      }
    }

    // 2. Execute via Multi-Provider Router
    const request: AiGatewayRequest = { prompt, systemInstruction };
    const response = await this.router.executeWithFallback(request, this.callProvider.bind(this));

    // 3. Cache successful response
    if (response.providerUsed !== 'none' && response.content) {
      this.cache.set(prompt, response.content, 300_000, response.tokensEstimated || 150);
    }

    return response;
  }

  private async callProvider(config: AiProviderConfig, req: AiGatewayRequest): Promise<string> {
    const system = req.systemInstruction || 'Eres Gentleman AI, un asistente de arbitraje financiero P2P.';

    switch (config.provider) {
      case 'gemini': {
        const model = config.model || 'gemini-2.0-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${system}\n\nPregunta: ${req.prompt}` }] }],
          }),
        });
        if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
        const data = (await res.json()) as any;
        return (
          data.candidates?.[0]?.content?.parts?.[0]?.text ||
          'No se obtuvo respuesta del modelo Gemini.'
        );
      }

      case 'openai':
      case 'deepseek': {
        const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
        const model = config.model || (config.provider === 'openai' ? 'gpt-4o-mini' : 'deepseek-chat');
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: req.prompt },
            ],
            temperature: 0.2,
          }),
        });
        if (!res.ok) throw new Error(`${config.provider} HTTP ${res.status}: ${await res.text()}`);
        const data = (await res.json()) as any;
        return (
          data.choices?.[0]?.message?.content ||
          `No se obtuvo respuesta del modelo ${config.provider}.`
        );
      }

      case 'anthropic': {
        const model = config.model || 'claude-3-5-sonnet-20241022';
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            system,
            messages: [{ role: 'user', content: req.prompt }],
            max_tokens: 1000,
          }),
        });
        if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
        const data = (await res.json()) as any;
        return data.content?.[0]?.text || 'No se obtuvo respuesta del modelo Claude.';
      }

      default:
        throw new Error(`Proveedor ${config.provider} no soportado.`);
    }
  }
}
