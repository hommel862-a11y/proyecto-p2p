/**
 * Types and interfaces for the Universal AI Gateway.
 * Supports Google Gemini, OpenAI (ChatGPT), Anthropic (Claude), DeepSeek, and Qwen/OpenRouter.
 */

export type AiProviderType = 'gemini' | 'openai' | 'anthropic' | 'deepseek' | 'qwen';

export interface UniversalToolProperty {
  type: 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY' | 'OBJECT';
  description: string;
  enum?: string[];
  items?: Record<string, unknown>;
  properties?: Record<string, UniversalToolProperty>;
  required?: string[];
}

export interface UniversalToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'OBJECT';
    properties: Record<string, UniversalToolProperty>;
    required: string[];
  };
}

export interface ToolCallRequest {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolCallResponse {
  id?: string;
  name: string;
  content: unknown;
  isError?: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCallRequest[];
  toolResponse?: ToolCallResponse;
}

export interface AiGatewayConfig {
  provider: AiProviderType;
  apiKey: string;
  model?: string;
  customEndpoint?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AiCompletionResult {
  text: string;
  toolCalls?: ToolCallRequest[];
  provider: AiProviderType;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface AiProviderConfigStatus {
  activeProvider: AiProviderType;
  activeModel: string;
  configuredProviders: Record<AiProviderType, boolean>;
}
