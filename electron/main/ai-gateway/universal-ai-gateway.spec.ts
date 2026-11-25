import { describe, it, expect } from 'vitest';
import { UniversalAiGateway } from './universal-ai-gateway';
import type { UniversalToolDefinition } from './types';

describe('UniversalAiGateway Schema Sanitizer & Multi-Provider Normalization', () => {
  it('handles union nullable types (["string", "null"]) and nested array items without crashing', () => {
    const gateway = new UniversalAiGateway() as any;

    const rawProps: Record<string, any> = {
      full_name: {
        type: ['string', 'null'],
        description: 'Nombre completo del prospecto o null si no se conoce',
      },
      bant_patch: {
        type: 'object',
        description: 'Datos BANT extraídos',
        properties: {
          budget: { type: ['string', 'null'], description: 'Presupuesto declarado' },
        },
        required: ['budget'],
      },
      items: {
        type: 'array',
        description: 'Líneas de cotización',
        items: {
          type: 'object',
          properties: {
            sku: { type: 'string', description: 'SKU oficial del catálogo' },
            qty: { type: 'integer', description: 'Cantidad' },
          },
          required: ['sku', 'qty'],
        },
      },
    };

    const openAiCleaned = gateway.cleanOpenAiSchemaProperties(rawProps);
    expect(openAiCleaned.full_name.type).toEqual(['string', 'null']);
    expect(openAiCleaned.bant_patch.properties.budget.type).toEqual(['string', 'null']);
    expect(openAiCleaned.items.type).toBe('array');
    expect(openAiCleaned.items.items).toBeDefined();
    expect(openAiCleaned.items.items.properties.sku.type).toBe('string');

    const geminiCleaned = gateway.cleanGeminiSchemaProperties(rawProps);
    expect(geminiCleaned.full_name.type).toBe('STRING');
    expect(geminiCleaned.full_name.nullable).toBe(true);
    expect(geminiCleaned.items.type).toBe('ARRAY');
    expect(geminiCleaned.items.items).toBeDefined();
    expect(geminiCleaned.items.items.properties.sku.type).toBe('STRING');
  });

  it('normalizes openrouter provider alias to qwen/OpenRouter endpoint', () => {
    const gateway = new UniversalAiGateway() as any;
    const endpoint = gateway.resolveEndpoint('openrouter');
    expect(endpoint).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('omits googleSearch grounding in completeGemini when enableGoogleSearch is false', async () => {
    const gateway = new UniversalAiGateway();
    let capturedBody: any = null;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: any, init: any) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Routed OK' }] } }],
        }),
      } as any;
    }) as any;

    try {
      await gateway.complete(
        {
          provider: 'gemini',
          apiKey: 'test-key',
          model: 'gemini-3.7-flash',
          enableGoogleSearch: false,
        },
        [{ role: 'user', content: 'Hola' }],
        [
          {
            name: 'route_conversation',
            description: 'Route',
            parameters: {
              type: 'OBJECT',
              properties: { target_role: { type: 'STRING', description: 'Role' } },
              required: ['target_role'],
            },
          },
        ],
      );

      expect(capturedBody).not.toBeNull();
      const hasGoogleSearch = (capturedBody.tools || []).some((t: any) => 'googleSearch' in t);
      expect(hasGoogleSearch).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('validates the exact target Gemini model endpoint in testConnection and returns false on 404', async () => {
    const gateway = new UniversalAiGateway();
    const origFetch = globalThis.fetch;
    let requestedUrl = '';

    globalThis.fetch = (async (url: string) => {
      requestedUrl = url;
      return {
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: { message: 'Model not found' } }),
      } as any;
    }) as any;

    try {
      const res = await gateway.testConnection('gemini', 'test-key', 'gemini-nonexistent-99');
      expect(requestedUrl).toContain('/v1beta/models/gemini-nonexistent-99');
      expect(res.success).toBe(false);
      expect(res.message).toContain('HTTP 404');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
