import { describe, it, expect, vi } from 'vitest';
import {
  normalizeSemanticPrompt,
  SemanticCache,
  AiProviderRouter,
  type AiProviderConfig,
  type AiGatewayRequest,
} from './ai-proxy-gateway';

describe('Centralized AI Proxy Gateway & Semantic Caching Engine', () => {
  describe('normalizeSemanticPrompt', () => {
    it('normalizes casing, punctuation, and removes conversational fillers', () => {
      const p1 = 'Hola! Por favor dime, ¿cuál es la brecha del BCV hoy?';
      const norm = normalizeSemanticPrompt(p1);
      expect(norm).toContain('gap_bcv');
      expect(norm).toContain('bcv');
      expect(norm).not.toContain('hola');
      expect(norm).not.toContain('dime');
      expect(norm).not.toContain('hoy');
    });

    it('canonicalizes financial terms (dólares -> usdt, bolívares -> ves, spread -> spread)', () => {
      const p = '¿Cuál es el margen entre dólares y bolívares en el libro de órdenes?';
      const norm = normalizeSemanticPrompt(p);
      expect(norm).toBe('spread entre usdt y ves en el orderbook');
    });
  });

  describe('SemanticCache', () => {
    it('stores and retrieves cached responses on semantic matches', () => {
      const cache = new SemanticCache(100, 60_000);
      cache.set('¿Cuál es la brecha del BCV hoy?', 'La brecha BCV es del 14.5%.');

      // Semantic variant
      const hit = cache.get('Buenas, dime cual es la brecha bcv por favor');
      expect(hit).not.toBeNull();
      expect(hit?.response).toBe('La brecha BCV es del 14.5%.');

      const stats = cache.getStats();
      expect(stats.totalHits).toBe(1);
      expect(stats.totalMisses).toBe(0);
      expect(stats.hitRatioPct).toBe(100);
    });

    it('expires entries after TTL', () => {
      const cache = new SemanticCache(100, -1000); // already expired
      cache.set('Precio USDT', '95.50 VES');

      const miss = cache.get('Precio USDT');
      expect(miss).toBeNull();
      expect(cache.getStats().totalMisses).toBe(1);
    });

    it('evicts oldest entry when max capacity is reached', () => {
      const cache = new SemanticCache(2, 60_000);
      cache.set('q1', 'r1');
      cache.set('q2', 'r2');
      cache.set('q3', 'r3'); // triggers eviction of q1

      expect(cache.get('q1')).toBeNull();
      expect(cache.get('q2')).not.toBeNull();
      expect(cache.get('q3')).not.toBeNull();
    });
  });

  describe('AiProviderRouter', () => {
    const providers: AiProviderConfig[] = [
      { provider: 'gemini', apiKey: 'key-gemini', priority: 1, model: 'gemini-2.0-flash' },
      { provider: 'openai', apiKey: 'key-openai', priority: 2, model: 'gpt-4o-mini' },
      { provider: 'deepseek', apiKey: 'key-deepseek', priority: 3, model: 'deepseek-chat' },
    ];

    it('uses primary provider when it succeeds', async () => {
      const router = new AiProviderRouter(providers);
      const req: AiGatewayRequest = { prompt: 'Analizar riesgo de spread' };

      const mockCaller = vi.fn().mockResolvedValueOnce('Análisis completado exitosamente.');
      const response = await router.executeWithFallback(req, mockCaller);

      expect(response.providerUsed).toBe('gemini');
      expect(response.content).toBe('Análisis completado exitosamente.');
      expect(response.fallbackChain).toBeUndefined();
    });

    it('fails over to secondary provider when primary throws error', async () => {
      const router = new AiProviderRouter(providers);
      const req: AiGatewayRequest = { prompt: 'Analizar riesgo de spread' };

      const mockCaller = vi
        .fn()
        .mockRejectedValueOnce(new Error('HTTP 429 Too Many Requests on Gemini'))
        .mockResolvedValueOnce('Respuesta provista por OpenAI');

      const response = await router.executeWithFallback(req, mockCaller);

      expect(response.providerUsed).toBe('openai');
      expect(response.content).toBe('Respuesta provista por OpenAI');
      expect(response.fallbackChain).toEqual(['gemini', 'openai']);
    });

    it('returns structured error when all providers fail', async () => {
      const router = new AiProviderRouter(providers);
      const req: AiGatewayRequest = { prompt: 'Test fail' };

      const mockCaller = vi.fn().mockRejectedValue(new Error('Network failure'));
      const response = await router.executeWithFallback(req, mockCaller);

      expect(response.providerUsed).toBe('none');
      expect(response.content).toContain('fallaron');
      expect(response.fallbackChain).toEqual(['gemini', 'openai', 'deepseek']);
    });
  });
});
