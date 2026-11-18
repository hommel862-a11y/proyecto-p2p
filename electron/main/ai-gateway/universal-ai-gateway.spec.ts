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
});
