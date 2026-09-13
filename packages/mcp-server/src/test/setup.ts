// packages/mcp-server/src/test/setup.ts
// Test setup for Vitest - mocks Engram, Gentle AI, Electron IPC

import { vi, beforeEach, expect } from 'vitest';
import type { Mock } from 'vitest';

// Mock global mcp tool caller
const mockMcpCallTool: Mock = vi.fn();

globalThis.mcp = {
  callTool: mockMcpCallTool,
};

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
  mockMcpCallTool.mockReset();
});

// Helper to mock successful tool calls
export function mockToolSuccess<T>(toolName: string, data: T) {
  mockMcpCallTool.mockImplementation(async (name: string, args: unknown) => {
    if (name === toolName) {
      return { success: true, data };
    }
    return { success: true, data: {} };
  });
}

// Helper to mock tool failures
export function mockToolFailure(toolName: string, error: string) {
  mockMcpCallTool.mockImplementation(async (name: string) => {
    if (name === toolName) {
      return { success: false, error };
    }
    return { success: true, data: {} };
  });
}

// Helper to assert tool was called
export function expectToolCalled(toolName: string, expectedArgs?: Record<string, unknown>) {
  const calls = mockMcpCallTool.mock.calls.filter(([name]: unknown[]) => name === toolName);
  expect(calls.length).toBeGreaterThan(0);
  if (expectedArgs) {
    const firstCallArgs = calls[0]?.[1];
    expect(firstCallArgs).toMatchObject(expectedArgs);
  }
  return calls;
}