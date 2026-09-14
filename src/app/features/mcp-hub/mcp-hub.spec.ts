import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { McpHub } from './mcp-hub';
import { McpService, FALLBACK_MCP_SERVERS } from '../../core/mcp.service';

describe('McpHub Component', () => {
  let fixture: ComponentFixture<McpHub>;
  let component: McpHub;
  let service: McpService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [McpHub],
      providers: [McpService],
    }).compileComponents();

    fixture = TestBed.createComponent(McpHub);
    component = fixture.componentInstance;
    service = TestBed.inject(McpService);
    fixture.detectChanges();
  });

  it('should initialize with servers tab active by default', () => {
    expect(component.activeTab()).toBe('servers');
    expect(component.selectedCategory()).toBe('all');
  });

  it('should list all registered MCP servers and tools', () => {
    expect(component.filteredServers().length).toBe(FALLBACK_MCP_SERVERS.length);
    expect(component.allTools().length).toBeGreaterThanOrEqual(8);
  });

  it('should filter servers by category', () => {
    component.setCategory('tasas');
    expect(component.selectedCategory()).toBe('tasas');
    const filtered = component.filteredServers();
    expect(filtered.every((s) => s.category === 'tasas')).toBe(true);
  });

  it('should select tool and populate sample payload', () => {
    component.selectTool({ name: 'calculate_spread', description: 'desc' });
    expect(component.selectedTool()?.name).toBe('calculate_spread');
    expect(component.toolArgsJson()).toContain('buyPrice');
  });

  it('should execute tool in sandbox and return result', async () => {
    component.selectTool({ name: 'calculate_spread', description: 'desc' });
    await component.runToolTest();
    expect(component.testExecutionResult()).toBeTruthy();
    expect(component.testExecutionResult()?.success).toBe(true);
  });

  it('should generate valid JSON configuration snippet for Antigravity and Claude', () => {
    const antigravityCfg = service.generateConfigSnippet('antigravity');
    const claudeCfg = service.generateConfigSnippet('claude');

    expect(JSON.parse(antigravityCfg).mcpServers['p2p-decisor']).toBeDefined();
    expect(JSON.parse(claudeCfg).mcpServers['p2p-decisor']).toBeDefined();
  });
});
