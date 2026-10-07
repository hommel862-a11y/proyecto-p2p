/**
 * Universal AI Gateway for P2P Decisor.
 * Executes completions and structured function-calling across:
 * - Google Gemini (REST v1beta)
 * - OpenAI (ChatGPT / GPT-4o)
 * - Anthropic (Claude 3.5 Sonnet)
 * - DeepSeek (DeepSeek-V3 / DeepSeek-R1 via OpenAI-compatible REST)
 * - Qwen / OpenRouter (Qwen 2.5 72B)
 */

import type {
  AiProviderType,
  UniversalToolDefinition,
  ChatMessage,
  AiCompletionResult,
  ToolCallRequest,
  AiGatewayConfig,
  GroundingSource,
} from './types';

export const DEFAULT_PROVIDER_MODELS: Record<AiProviderType, string> = {
  gemini: 'gemini-2.0-flash',
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-20241022',
  deepseek: 'deepseek-chat',
  qwen: 'qwen/qwen-2.5-72b-instruct',
};

export class UniversalAiGateway {
  /**
   * Dispatches a single chat completion step to the configured AI provider.
   */
  async complete(
    config: AiGatewayConfig,
    messages: ChatMessage[],
    tools: UniversalToolDefinition[] = [],
  ): Promise<AiCompletionResult> {
    const provider = config.provider;
    const model = config.model || DEFAULT_PROVIDER_MODELS[provider] || 'gemini-2.0-flash';

    switch (provider) {
      case 'gemini':
        return this.completeGemini(config.apiKey, model, messages, tools, config.temperature);
      case 'openai':
      case 'deepseek':
      case 'qwen':
        return this.completeOpenAiCompatible(provider, config.apiKey, model, messages, tools, config);
      case 'anthropic':
        return this.completeAnthropic(config.apiKey, model, messages, tools, config.temperature);
      default:
        throw new Error(`Proveedor de IA no reconocido: ${provider}`);
    }
  }

  /**
   * Tests connectivity and credential validity for a selected provider.
   */
  async testConnection(
    provider: AiProviderType,
    apiKey: string,
    model?: string,
    customEndpoint?: string,
  ): Promise<{ success: boolean; model: string; message: string }> {
    const effectiveModel = model || DEFAULT_PROVIDER_MODELS[provider];

    try {
      if (provider === 'gemini') {
        const url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1';
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
        });
        if (res.ok) {
          return {
            success: true,
            model: effectiveModel,
            message: `¡Conexión validada con Google Gemini (${effectiveModel})!`,
          };
        }
        const err = await res.text();
        return {
          success: false,
          model: effectiveModel,
          message: `Error de Google Gemini (HTTP ${res.status}): ${err}`,
        };
      }

      if (provider === 'openai' || provider === 'deepseek' || provider === 'qwen') {
        const endpoint = this.resolveEndpoint(provider, customEndpoint);
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: effectiveModel,
            messages: [{ role: 'user', content: 'Ping' }],
            max_tokens: 5,
          }),
        });
        if (res.ok) {
          return {
            success: true,
            model: effectiveModel,
            message: `¡Conexión exitosa con ${provider.toUpperCase()} (${effectiveModel})!`,
          };
        }
        const err = await res.text();
        return {
          success: false,
          model: effectiveModel,
          message: `Error al conectar con ${provider.toUpperCase()} (HTTP ${res.status}): ${err}`,
        };
      }

      if (provider === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: effectiveModel,
            messages: [{ role: 'user', content: 'Ping' }],
            max_tokens: 5,
          }),
        });
        if (res.ok) {
          return {
            success: true,
            model: effectiveModel,
            message: `¡Conexión exitosa con Anthropic Claude (${effectiveModel})!`,
          };
        }
        const err = await res.text();
        return {
          success: false,
          model: effectiveModel,
          message: `Error con Anthropic Claude (HTTP ${res.status}): ${err}`,
        };
      }

      return {
        success: false,
        model: effectiveModel,
        message: `Proveedor ${provider} no soportado para prueba de conexión.`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        model: effectiveModel,
        message: `Error de red al conectar con ${provider}: ${msg}`,
      };
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Google Gemini Implementation
  // ───────────────────────────────────────────────────────────────────────────
  private async completeGemini(
    apiKey: string,
    model: string,
    messages: ChatMessage[],
    tools: UniversalToolDefinition[],
    temperature = 0.2,
  ): Promise<AiCompletionResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    // System instruction extraction
    const systemMsg = messages.find((m) => m.role === 'system');
    const systemInstruction = systemMsg
      ? { parts: [{ text: systemMsg.content }] }
      : undefined;

    // Convert messages to Gemini format
    const contents: Array<{
      role: 'user' | 'model';
      parts: any[];
    }> = [];

    for (const msg of messages) {
      if (msg.role === 'system') continue;

      if (msg.role === 'user') {
        contents.push({
          role: 'user',
          parts: [{ text: msg.content }],
        });
      } else if (msg.role === 'assistant') {
        const parts: any[] = [];
        if (msg.content) parts.push({ text: msg.content });
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: tc.args,
              },
            });
          }
        }
        contents.push({ role: 'model', parts });
      } else if (msg.role === 'tool' && msg.toolResponse) {
        // Function responses in Gemini are sent as role 'user' with functionResponse part
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: msg.toolResponse.name,
                response: {
                  name: msg.toolResponse.name,
                  content: msg.toolResponse.content,
                },
              },
            },
          ],
        });
      }
    }

    // Convert tools to Gemini functionDeclarations
    const functionDeclarations = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: 'OBJECT' as const,
        properties: this.cleanGeminiSchemaProperties(t.parameters.properties),
        required: t.parameters.required || [],
      },
    }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature,
        maxOutputTokens: 2048,
      },
    };

    if (systemInstruction) {
      body['systemInstruction'] = systemInstruction;
    }

    const geminiTools: any[] = [];
    if (functionDeclarations.length > 0) {
      geminiTools.push({ functionDeclarations });
    }
    // Enable real-time Google Search Grounding for live factual intelligence
    geminiTools.push({ googleSearch: {} });

    if (geminiTools.length > 0) {
      body['tools'] = geminiTools;
    }

    let res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok && res.status === 400 && functionDeclarations.length > 0) {
      // If the model variant rejects combining functionDeclarations with googleSearch, fallback cleanly
      body['tools'] = [{ functionDeclarations }];
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
      });
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API Error (HTTP ${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      candidates?: {
        content?: {
          parts?: {
            text?: string;
            functionCall?: { name: string; args: Record<string, unknown> };
          }[];
        };
        groundingMetadata?: {
          webSearchQueries?: string[];
          groundingChunks?: { web?: { uri?: string; title?: string } }[];
        };
      }[];
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };

    const firstCandidate = data.candidates?.[0];
    const parts = firstCandidate?.content?.parts || [];
    const textPart = parts.find((p) => p.text);
    const functionCalls = parts
      .filter((p) => p.functionCall && p.functionCall.name)
      .map((p) => ({
        name: p.functionCall!.name,
        args: p.functionCall!.args || {},
      }));

    const groundingMeta = firstCandidate?.groundingMetadata;
    const sources: GroundingSource[] = [];
    if (groundingMeta?.groundingChunks && Array.isArray(groundingMeta.groundingChunks)) {
      for (const chunk of groundingMeta.groundingChunks) {
        if (chunk.web?.uri) {
          sources.push({
            title: chunk.web.title || chunk.web.uri,
            uri: chunk.web.uri,
          });
        }
      }
    }
    const searchQueries = Array.isArray(groundingMeta?.webSearchQueries)
      ? groundingMeta.webSearchQueries
      : undefined;

    return {
      text: textPart?.text || '',
      toolCalls: functionCalls.length > 0 ? functionCalls : undefined,
      provider: 'gemini',
      model,
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount,
        completionTokens: data.usageMetadata?.candidatesTokenCount,
        totalTokens: data.usageMetadata?.totalTokenCount,
      },
      sources: sources.length > 0 ? sources : undefined,
      searchQueries,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. OpenAI / DeepSeek / Qwen (OpenAI Compatible)
  // ───────────────────────────────────────────────────────────────────────────
  private async completeOpenAiCompatible(
    provider: AiProviderType,
    apiKey: string,
    model: string,
    messages: ChatMessage[],
    tools: UniversalToolDefinition[],
    config: AiGatewayConfig,
  ): Promise<AiCompletionResult> {
    const endpoint = this.resolveEndpoint(provider, config.customEndpoint);

    // Convert messages to OpenAI chat format
    const formattedMessages: any[] = messages.map((m) => {
      if (m.role === 'tool' && m.toolResponse) {
        return {
          role: 'tool',
          tool_call_id: m.toolResponse.id || `call_${m.toolResponse.name}`,
          content: JSON.stringify(m.toolResponse.content),
        };
      }
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc, idx) => ({
            id: tc.id || `call_${tc.name}_${idx}`,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            },
          })),
        };
      }
      return {
        role: m.role,
        content: m.content,
      };
    });

    // Convert tools to OpenAI format
    const formattedTools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties: this.cleanOpenAiSchemaProperties(t.parameters.properties),
          required: t.parameters.required || [],
        },
      },
    }));

    const body: Record<string, unknown> = {
      model,
      messages: formattedMessages,
      temperature: config.temperature ?? 0.2,
      max_tokens: config.maxTokens ?? 2048,
    };

    if (formattedTools.length > 0) {
      body['tools'] = formattedTools;
      body['tool_choice'] = 'auto';
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`${provider.toUpperCase()} API Error (HTTP ${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: {
            id: string;
            function?: { name: string; arguments: string };
          }[];
        };
      }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const choice = data.choices?.[0]?.message;
    const text = choice?.content || '';

    let toolCalls: ToolCallRequest[] | undefined;
    if (choice?.tool_calls && choice.tool_calls.length > 0) {
      toolCalls = choice.tool_calls.map((tc) => {
        let parsedArgs = {};
        try {
          parsedArgs = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          parsedArgs = {};
        }
        return {
          id: tc.id,
          name: tc.function?.name || '',
          args: parsedArgs,
        };
      });
    }

    return {
      text,
      toolCalls,
      provider,
      model,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Anthropic Claude Implementation
  // ───────────────────────────────────────────────────────────────────────────
  private async completeAnthropic(
    apiKey: string,
    model: string,
    messages: ChatMessage[],
    tools: UniversalToolDefinition[],
    temperature = 0.2,
  ): Promise<AiCompletionResult> {
    const url = 'https://api.anthropic.com/v1/messages';

    const systemMsg = messages.find((m) => m.role === 'system');
    const systemPrompt = systemMsg ? systemMsg.content : undefined;

    // Convert messages for Anthropic
    const anthropicMessages: any[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') continue;

      if (msg.role === 'user') {
        anthropicMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const content: any[] = [];
        if (msg.content) content.push({ type: 'text', text: msg.content });
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: 'tool_use',
              id: tc.id || `call_${tc.name}`,
              name: tc.name,
              input: tc.args,
            });
          }
        }
        anthropicMessages.push({ role: 'assistant', content });
      } else if (msg.role === 'tool' && msg.toolResponse) {
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolResponse.id || `call_${msg.toolResponse.name}`,
              content: JSON.stringify(msg.toolResponse.content),
              is_error: msg.toolResponse.isError || false,
            },
          ],
        });
      }
    }

    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object',
        properties: this.cleanOpenAiSchemaProperties(t.parameters.properties),
        required: t.parameters.required || [],
      },
    }));

    const body: Record<string, unknown> = {
      model,
      messages: anthropicMessages,
      max_tokens: 2048,
      temperature,
    };

    if (systemPrompt) body['system'] = systemPrompt;
    if (anthropicTools.length > 0) body['tools'] = anthropicTools;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic Claude API Error (HTTP ${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      content?: Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
      };
    };

    let text = '';
    const toolCalls: ToolCallRequest[] = [];

    for (const part of data.content || []) {
      if (part.type === 'text' && part.text) {
        text += part.text;
      } else if (part.type === 'tool_use' && part.name) {
        toolCalls.push({
          id: part.id,
          name: part.name,
          args: part.input || {},
        });
      }
    }

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      provider: 'anthropic',
      model,
      usage: {
        promptTokens: data.usage?.input_tokens,
        completionTokens: data.usage?.output_tokens,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helper Utilities
  // ───────────────────────────────────────────────────────────────────────────
  private resolveEndpoint(provider: AiProviderType, customEndpoint?: string): string {
    if (customEndpoint) return customEndpoint;
    switch (provider) {
      case 'openai':
        return 'https://api.openai.com/v1/chat/completions';
      case 'deepseek':
        return 'https://api.deepseek.com/chat/completions';
      case 'qwen':
        return 'https://openrouter.ai/api/v1/chat/completions';
      default:
        return 'https://api.openai.com/v1/chat/completions';
    }
  }

  private cleanGeminiSchemaProperties(props: Record<string, any>): Record<string, any> {
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(props || {})) {
      clean[k] = {
        type: v.type || 'STRING',
        description: v.description || '',
      };
      if (v.enum) clean[k].enum = v.enum;
      if (v.properties) clean[k].properties = this.cleanGeminiSchemaProperties(v.properties);
    }
    return clean;
  }

  private cleanOpenAiSchemaProperties(props: Record<string, any>): Record<string, any> {
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(props || {})) {
      clean[k] = {
        type: (v.type || 'string').toLowerCase(),
        description: v.description || '',
      };
      if (v.enum) clean[k].enum = v.enum;
      if (v.properties) clean[k].properties = this.cleanOpenAiSchemaProperties(v.properties);
    }
    return clean;
  }
}
