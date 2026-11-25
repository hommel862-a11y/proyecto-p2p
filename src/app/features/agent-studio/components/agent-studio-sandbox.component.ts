import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AgentStudioService,
  MCP_SKILL_CATALOG,
  getSkillRiskTier,
  type McpSkillCatalogItem,
} from '../../../core/agent-studio.service';
import type {
  AgentDomainDto,
  AgentRunDto,
  CreateCustomAgentDto,
  CustomAgentDto,
  UpdateCustomAgentDto,
} from '../../../../../electron/shared/types';

interface AgentFormState {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  modelProvider: string;
  modelName: string;
  temperature: number;
  isActive: boolean;
  executionMode: 'on_demand' | 'ambient_daemon';
  scheduleIntervalSec: number;
  domain: AgentDomainDto;
  dailyBudgetUsd: number;
  maxSteps: number;
  promptVersion: number;
  skills: string[];
}

const DEFAULT_FORM: AgentFormState = {
  id: '',
  name: '',
  description: '',
  systemPrompt:
    'Eres un agente institucional especializado de la mesa P2P y Finanzas 360. Emite veredictos basados estrictamente en datos en vivo; nunca inventes cifras si falta un feed.',
  modelProvider: 'gemini',
  modelName: 'gemini-3.8-flash',
  temperature: 0.1,
  isActive: true,
  executionMode: 'on_demand',
  scheduleIntervalSec: 300,
  domain: 'P2P_DESK',
  dailyBudgetUsd: 1.5,
  maxSteps: 6,
  promptVersion: 1,
  skills: [],
};

@Component({
  selector: 'app-agent-studio-sandbox',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="studio-split">
      <!-- LEFT: Immutable Agent Builder -->
      <section class="builder-pane">
        <div class="pane-head">
          <div>
            <h3>{{ isEditing() ? 'Editar Agente' : 'Crear Nuevo Agente' }}</h3>
            <span class="ver-pill">Prompt v{{ form().promptVersion }}</span>
          </div>
          <div class="head-actions">
            <select
              class="select-sm"
              [ngModel]="selectedAgentId() ?? ''"
              (ngModelChange)="onSelectExisting($event)"
              aria-label="Seleccionar agente para editar"
            >
              <option value="">+ Nuevo Agente en Blanco</option>
              @for (a of studio.agents(); track a.id) {
                <option [value]="a.id">{{ a.name }} ({{ a.domain ?? 'P2P_DESK' }})</option>
              }
            </select>
          </div>
        </div>

        <div class="form-grid">
          <label class="field">
            <span>Nombre del Agente</span>
            <input
              type="text"
              [ngModel]="form().name"
              (ngModelChange)="patchForm({ name: $event })"
              placeholder="Ej. Mesa de Anuncios & Repricing P2P"
            />
          </label>

          <label class="field">
            <span>Dominio Operativo</span>
            <select
              [ngModel]="form().domain"
              (ngModelChange)="patchForm({ domain: $event })"
            >
              <option value="P2P_DESK">Mesa P2P (Trading & Spread)</option>
              <option value="FINANCE_360">Finanzas 360 & Macro BCV</option>
              <option value="SECURITY">Seguridad, Riesgo & Forense</option>
              <option value="ARM_B2B">ARM Omnichannel CRM</option>
            </select>
          </label>

          <label class="field full">
            <span>Descripción Operativa</span>
            <input
              type="text"
              [ngModel]="form().description"
              (ngModelChange)="patchForm({ description: $event })"
              placeholder="Qué problema resuelve este agente..."
            />
          </label>

          <label class="field">
            <span>Proveedor IA</span>
            <select
              [ngModel]="form().modelProvider"
              (ngModelChange)="onProviderChange($event)"
            >
              @for (p of availableProviders; track p.id) {
                <option [value]="p.id">{{ p.label }}</option>
              }
            </select>
          </label>

          <label class="field">
            <span>Modelo (Catálogo Vigente)</span>
            <select
              [ngModel]="form().modelName"
              (ngModelChange)="patchForm({ modelName: $event })"
            >
              @for (m of modelsForProvider(); track m.id) {
                <option [value]="m.id">{{ m.name }}</option>
              }
            </select>
          </label>

          <label class="field">
            <span>Modo de Ejecución</span>
            <select
              [ngModel]="form().executionMode"
              (ngModelChange)="patchForm({ executionMode: $event })"
            >
              <option value="on_demand">Bajo Demanda (On-Demand)</option>
              <option value="ambient_daemon">Daemon Background 24/7 (READ-ONLY)</option>
            </select>
          </label>

          <label class="field">
            <span>Intervalo Daemon (mín. 60s)</span>
            <input
              type="number"
              min="60"
              step="30"
              [disabled]="form().executionMode !== 'ambient_daemon'"
              [ngModel]="form().scheduleIntervalSec"
              (ngModelChange)="patchForm({ scheduleIntervalSec: clampInterval($event) })"
            />
          </label>

          <label class="field">
            <span>Tope Diario USD</span>
            <input
              type="number"
              min="0.1"
              step="0.25"
              [ngModel]="form().dailyBudgetUsd"
              (ngModelChange)="patchForm({ dailyBudgetUsd: clampBudget($event) })"
            />
          </label>

          <label class="field">
            <span>Temperatura ({{ form().temperature | number: '1.1-1' }}) · Max Steps</span>
            <div class="dual-inline">
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                [ngModel]="form().temperature"
                (ngModelChange)="patchForm({ temperature: +$event })"
              />
              <input
                type="number"
                min="1"
                max="15"
                class="steps-input"
                [ngModel]="form().maxSteps"
                (ngModelChange)="patchForm({ maxSteps: clampSteps($event) })"
              />
            </div>
          </label>

          <label class="field full">
            <span>System Prompt (v{{ form().promptVersion }})</span>
            <textarea
              rows="5"
              [ngModel]="form().systemPrompt"
              (ngModelChange)="patchForm({ systemPrompt: $event })"
              placeholder="Instrucciones deterministas y guardrails del agente..."
            ></textarea>
          </label>
        </div>

        <!-- Skill Matrix with READ-ONLY vs HITL badges -->
        <div class="skills-section">
          <div class="skills-head">
            <h4>Matriz de Skills MCP ({{ form().skills.length }} seleccionadas)</h4>
            <div class="cat-pills">
              @for (c of skillCategories; track c) {
                <button
                  type="button"
                  class="cat-pill"
                  [class.active]="selectedSkillCategory() === c"
                  (click)="selectedSkillCategory.set(c)"
                >
                  {{ c }}
                </button>
              }
            </div>
          </div>

          <div class="skills-list">
            @for (skill of filteredSkills(); track skill.id) {
              <label class="skill-row" [class.selected]="hasSkill(skill.id)">
                <input
                  type="checkbox"
                  [checked]="hasSkill(skill.id)"
                  (change)="toggleSkill(skill.id)"
                />
                <div class="skill-info">
                  <div class="skill-title">
                    <strong>{{ skill.name }}</strong>
                    <span class="tier-badge" [class.hitl]="isHitl(skill.id)">
                      {{ isHitl(skill.id) ? 'HITL' : 'READ-ONLY' }}
                    </span>
                  </div>
                  <small>{{ skill.description }}</small>
                </div>
              </label>
            }
          </div>
        </div>

        <footer class="builder-footer">
          <button type="button" class="btn-save" [disabled]="!canSave()" (click)="saveAgent()">
            {{ isEditing() ? '💾 Guardar Cambios y Reconciliar' : '✨ Crear Agente en SQLite' }}
          </button>
        </footer>
      </section>

      <!-- RIGHT: Live Dry-Run Sandbox -->
      <section class="sandbox-pane">
        <div class="pane-head">
          <div>
            <h3>Live Dry-Run Sandbox</h3>
            <p class="sandbox-sub">Prueba el prompt y skills actuales sin mutar anuncios ni dinero (tools HITL bloqueadas).</p>
          </div>
          <span class="badge-ro">READ-ONLY ENFORCED</span>
        </div>

        <div class="quick-prompts">
          @for (qp of quickPrompts; track qp.label) {
            <button type="button" class="qp-chip" (click)="sandboxPrompt.set(qp.prompt)">
              {{ qp.label }}
            </button>
          }
        </div>

        <textarea
          rows="4"
          class="sandbox-input"
          [ngModel]="sandboxPrompt()"
          (ngModelChange)="sandboxPrompt.set($event)"
          placeholder="Escribe un escenario de prueba real para este agente..."
        ></textarea>

        <button
          type="button"
          class="btn-run-sandbox"
          [disabled]="!canRunSandbox() || studio.runningSandbox()"
          (click)="executeSandbox()"
        >
          {{ studio.runningSandbox() ? '⏳ Ejecutando Dry-Run...' : '▶ Ejecutar Prueba en Vivo (Sandbox)' }}
        </button>

        @if (sandboxResult(); as res) {
          <div class="sandbox-output">
            <div class="out-meta">
              <span class="status-pill" [attr.data-status]="res.status">{{ res.status }}</span>
              <span>{{ res.modelUsed }}</span>
              <span>{{ res.latencyMs }} ms</span>
              <span>{{ res.tokensIn }}/{{ res.tokensOut }} tok</span>
              <span>\${{ res.costUsd | number: '1.5-5' }}</span>
            </div>

            @if (res.toolsCalled.length > 0) {
              <div class="out-tools">
                @for (t of res.toolsCalled; track t.name) {
                  <span class="tool-pill" [class.fail]="!t.ok">
                    {{ t.ok ? '✓' : '✕' }} {{ t.name }}
                  </span>
                }
              </div>
            }

            @if (res.errorMessage) {
              <div class="out-error">{{ res.errorMessage }}</div>
            }
            @if (res.responseOutput) {
              <pre class="out-body">{{ res.responseOutput }}</pre>
            }
          </div>
        } @else {
          <div class="sandbox-empty">
            Selecciona un agente guardado y dispara un Dry-Run para inspeccionar latencia, trazas MCP y costo real antes de activarlo en producción.
          </div>
        }
      </section>
    </div>
  `,
  styles: [
    `
      .studio-split { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 1rem; align-items: start; color: var(--text); }
      @media (max-width: 1080px) { .studio-split { grid-template-columns: 1fr; } }
      .builder-pane, .sandbox-pane { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius-lg, 18px); padding: 1.05rem; display: flex; flex-direction: column; gap: 0.85rem; }
      .pane-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; }
      .pane-head h3 { margin: 0; font-size: 1rem; color: var(--text); }
      .ver-pill { display: inline-block; margin-top: 0.2rem; font-size: 0.7rem; font-weight: 700; padding: 0.12rem 0.5rem; border-radius: 999px; background: color-mix(in srgb, var(--gold) 16%, transparent); color: var(--gold); }
      .badge-ro { font-size: 0.68rem; font-weight: 700; padding: 0.22rem 0.6rem; border-radius: 999px; background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); white-space: nowrap; }
      .sandbox-sub { margin: 0.2rem 0 0; font-size: 0.76rem; color: var(--muted); }
      .select-sm, .field input, .field select, .field textarea, .sandbox-input { background: var(--panel-2); border: 1px solid var(--line-strong); color: var(--text); border-radius: 10px; padding: 0.5rem 0.7rem; font-size: 0.82rem; font-family: inherit; }
      .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.65rem; }
      .field { display: flex; flex-direction: column; gap: 0.25rem; }
      .field.full { grid-column: 1 / -1; }
      .field span { font-size: 0.73rem; color: var(--muted); }
      .dual-inline { display: flex; align-items: center; gap: 0.5rem; }
      .dual-inline input[type='range'] { flex: 1; }
      .steps-input { width: 64px; }
      .skills-section { display: flex; flex-direction: column; gap: 0.5rem; }
      .skills-head { display: flex; flex-direction: column; gap: 0.45rem; }
      .skills-head h4 { margin: 0; font-size: 0.85rem; color: var(--text); }
      .cat-pills { display: inline-flex; flex-wrap: wrap; gap: 4px; padding: 4px; border-radius: 999px; background: var(--panel-2); border: 1px solid var(--line); }
      .cat-pill { font-size: 0.68rem; font-weight: 600; padding: 0.22rem 0.6rem; border-radius: 999px; border: none; background: transparent; color: var(--muted); cursor: pointer; }
      .cat-pill.active { background: var(--text); color: var(--bg-0); font-weight: 700; }
      .skills-list { max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.35rem; padding-right: 0.25rem; }
      .skill-row { display: flex; align-items: flex-start; gap: 0.55rem; padding: 0.5rem 0.65rem; border-radius: 10px; border: 1px solid var(--line); background: var(--panel-2); cursor: pointer; }
      .skill-row.selected { border-color: color-mix(in srgb, var(--gold) 45%, var(--line)); background: color-mix(in srgb, var(--gold) 10%, var(--panel-2)); }
      .skill-info { display: flex; flex-direction: column; gap: 0.1rem; flex: 1; }
      .skill-title { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; font-size: 0.78rem; color: var(--text); }
      .skill-info small { font-size: 0.71rem; color: var(--muted); }
      .tier-badge { font-size: 0.63rem; font-weight: 700; padding: 0.1rem 0.45rem; border-radius: 999px; background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
      .tier-badge.hitl { background: color-mix(in srgb, var(--gold) 18%, transparent); color: var(--gold); }
      .builder-footer { display: flex; justify-content: flex-end; }
      .btn-save { background: var(--text); color: var(--bg-0); border: none; border-radius: 999px; padding: 0.55rem 1.15rem; font-size: 0.82rem; font-weight: 800; cursor: pointer; }
      .btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
      .quick-prompts { display: flex; flex-wrap: wrap; gap: 0.35rem; }
      .qp-chip { font-size: 0.72rem; font-weight: 600; padding: 0.28rem 0.65rem; border-radius: 999px; border: 1px solid var(--line-strong); background: var(--panel-2); color: var(--text); cursor: pointer; }
      .btn-run-sandbox { background: var(--accent); color: var(--bg-0); border: none; border-radius: 999px; padding: 0.58rem 1.15rem; font-size: 0.82rem; font-weight: 800; cursor: pointer; }
      .btn-run-sandbox:disabled { opacity: 0.5; cursor: not-allowed; }
      .sandbox-output { background: var(--panel-2); border: 1px solid var(--line-strong); border-radius: 12px; padding: 0.8rem; display: flex; flex-direction: column; gap: 0.55rem; }
      .out-meta { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; font-size: 0.73rem; color: var(--muted); }
      .status-pill { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; padding: 0.14rem 0.5rem; border-radius: 999px; background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
      .status-pill[data-status='error'] { background: color-mix(in srgb, var(--danger) 18%, transparent); color: var(--danger); }
      .status-pill[data-status='blocked_killswitch'], .status-pill[data-status='blocked_budget'] { background: color-mix(in srgb, var(--gold) 20%, transparent); color: var(--gold); }
      .out-tools { display: flex; flex-wrap: wrap; gap: 0.3rem; }
      .tool-pill { font-size: 0.7rem; padding: 0.14rem 0.5rem; border-radius: 999px; background: color-mix(in srgb, var(--gold) 14%, transparent); color: var(--gold); }
      .tool-pill.fail { background: color-mix(in srgb, var(--danger) 16%, transparent); color: var(--danger); }
      .out-error { font-size: 0.78rem; color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); padding: 0.5rem; border-radius: 10px; }
      .out-body { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 0.78rem; color: var(--text); max-height: 300px; overflow-y: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .sandbox-empty { padding: 1.5rem 1rem; text-align: center; font-size: 0.79rem; color: var(--muted); border: 1px dashed var(--line-strong); border-radius: 12px; }
    `,
  ],
})
export class AgentStudioSandboxComponent implements OnChanges {
  readonly studio = inject(AgentStudioService);
  @Input() activeAgent: CustomAgentDto | null = null;
  @Output() readonly saved = new EventEmitter<CustomAgentDto>();

  readonly selectedAgentId = signal<string | null>(null);
  readonly isEditing = computed(() => Boolean(this.selectedAgentId()));
  readonly form = signal<AgentFormState>({ ...DEFAULT_FORM });
  readonly selectedSkillCategory = signal<
    'ALL' | 'TRADING' | 'RIESGO' | 'SEGURIDAD' | 'CONCILIACION' | 'FINANCE_360' | 'ARM_CRM'
  >('ALL');

  readonly sandboxPrompt = signal<string>(
    'Audita el estado operativo actual con tus herramientas autorizadas y resume hallazgos concretos.',
  );
  readonly sandboxResult = signal<AgentRunDto | null>(null);

  readonly skillCategories: Array<
    'ALL' | 'TRADING' | 'RIESGO' | 'SEGURIDAD' | 'CONCILIACION' | 'FINANCE_360' | 'ARM_CRM'
  > = ['ALL', 'TRADING', 'RIESGO', 'SEGURIDAD', 'CONCILIACION', 'FINANCE_360', 'ARM_CRM'];

  readonly availableProviders = [
    { id: 'gemini', label: 'Google Gemini (Nativo)' },
    { id: 'openrouter', label: 'OpenRouter' },
    { id: 'openai', label: 'OpenAI' },
    { id: 'deepseek', label: 'DeepSeek' },
  ];

  readonly recommendedModels: Record<string, { id: string; name: string }[]> = {
    gemini: [
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Operativo Balanceado)' },
      { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite (Daemons 24/7 Bajo Costo)' },
      { id: 'gemini-4-argon', name: 'Gemini 4 Argon (Riesgo & Compliance)' },
      { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon (Auditoría Forense Compleja)' },
      { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite' },
    ],
    openrouter: [
      { id: 'nousresearch/hermes-3-llama-3.1-405b', name: 'Nous Hermes 3 405B' },
      { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet' },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1' },
    ],
    openai: [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    ],
    deepseek: [
      { id: 'deepseek-chat', name: 'DeepSeek V3' },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1' },
    ],
  };

  readonly quickPrompts = [
    {
      label: 'Competitividad Anuncios',
      prompt: 'Audita competitividad de anuncios P2P y presión de libro. ¿Conviene ajustar precio o pausar?',
    },
    {
      label: 'Liquidez 14D & BCV',
      prompt: 'Cruza liquidez Finanzas 360 a 14 días, cuotas Cashea próximas y riesgo de intervención BCV.',
    },
    {
      label: 'Escudo SUDEBAN',
      prompt: 'Verifica saturación diaria de cuentas bancarias VES y estado de paridad USDT.',
    },
  ];

  readonly modelsForProvider = computed(() => {
    const provider = this.form().modelProvider;
    return this.recommendedModels[provider] ?? this.recommendedModels['gemini'];
  });

  readonly filteredSkills = computed<readonly McpSkillCatalogItem[]>(() => {
    const cat = this.selectedSkillCategory();
    if (cat === 'ALL') return MCP_SKILL_CATALOG;
    return MCP_SKILL_CATALOG.filter((s) => s.category === cat);
  });

  readonly canSave = computed(() => {
    const f = this.form();
    return f.name.trim().length >= 2 && f.systemPrompt.trim().length >= 10;
  });

  readonly canRunSandbox = computed(() => {
    return Boolean(this.selectedAgentId()) && this.sandboxPrompt().trim().length > 0;
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['activeAgent']) {
      if (this.activeAgent) {
        this.loadAgentIntoForm(this.activeAgent);
      }
    }
  }

  onSelectExisting(agentId: string): void {
    if (!agentId) {
      this.selectedAgentId.set(null);
      this.form.set({ ...DEFAULT_FORM, skills: [] });
      this.sandboxResult.set(null);
      return;
    }
    const found = this.studio.agents().find((a) => a.id === agentId);
    if (found) {
      this.loadAgentIntoForm(found);
    }
  }

  private loadAgentIntoForm(agent: CustomAgentDto): void {
    this.selectedAgentId.set(agent.id);
    this.form.set({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      modelProvider: agent.modelProvider,
      modelName: agent.modelName === 'gemini-3.7-flash' ? 'gemini-3.8-flash' : agent.modelName,
      temperature: agent.temperature,
      isActive: agent.isActive,
      executionMode: agent.executionMode,
      scheduleIntervalSec: Math.max(60, agent.scheduleIntervalSec ?? 300),
      domain: agent.domain ?? 'P2P_DESK',
      dailyBudgetUsd: agent.dailyBudgetUsd ?? 1.5,
      maxSteps: agent.maxSteps ?? 6,
      promptVersion: agent.promptVersion ?? 1,
      skills: [...agent.skills],
    });
  }

  patchForm(patch: Partial<AgentFormState>): void {
    this.form.update((prev) => ({ ...prev, ...patch }));
  }

  onProviderChange(provider: string): void {
    const list = this.recommendedModels[provider] ?? this.recommendedModels['gemini'];
    this.patchForm({ modelProvider: provider, modelName: list[0]?.id ?? 'gemini-3.8-flash' });
  }

  hasSkill(skillId: string): boolean {
    return this.form().skills.includes(skillId);
  }

  isHitl(skillId: string): boolean {
    return getSkillRiskTier(skillId) === 'HITL';
  }

  toggleSkill(skillId: string): void {
    this.form.update((prev) => {
      const exists = prev.skills.includes(skillId);
      const nextSkills = exists
        ? prev.skills.filter((s) => s !== skillId)
        : [...prev.skills, skillId];
      return { ...prev, skills: nextSkills };
    });
  }

  clampInterval(val: number): number {
    const n = Number(val);
    return Number.isFinite(n) ? Math.max(60, Math.round(n)) : 60;
  }

  clampBudget(val: number): number {
    const n = Number(val);
    return Number.isFinite(n) ? Math.max(0.05, Number(n.toFixed(2))) : 1.5;
  }

  clampSteps(val: number): number {
    const n = Number(val);
    return Number.isFinite(n) ? Math.max(1, Math.min(20, Math.round(n))) : 6;
  }

  async saveAgent(): Promise<void> {
    if (!this.canSave()) return;
    const f = this.form();
    const editingId = this.selectedAgentId();

    if (editingId) {
      const dto: UpdateCustomAgentDto = {
        name: f.name.trim(),
        description: f.description.trim(),
        systemPrompt: f.systemPrompt.trim(),
        modelProvider: f.modelProvider,
        modelName: f.modelName,
        temperature: f.temperature,
        isActive: f.isActive,
        executionMode: f.executionMode,
        scheduleIntervalSec: f.executionMode === 'ambient_daemon' ? Math.max(60, f.scheduleIntervalSec) : undefined,
        domain: f.domain,
        dailyBudgetUsd: f.dailyBudgetUsd,
        maxSteps: f.maxSteps,
        skills: [...f.skills],
      };
      const updated = await this.studio.updateAgent(editingId, dto);
      if (updated) {
        this.loadAgentIntoForm(updated);
        this.saved.emit(updated);
      }
    } else {
      const dto: CreateCustomAgentDto = {
        name: f.name.trim(),
        description: f.description.trim(),
        systemPrompt: f.systemPrompt.trim(),
        modelProvider: f.modelProvider,
        modelName: f.modelName,
        temperature: f.temperature,
        isActive: f.isActive,
        executionMode: f.executionMode,
        scheduleIntervalSec: f.executionMode === 'ambient_daemon' ? Math.max(60, f.scheduleIntervalSec) : undefined,
        domain: f.domain,
        dailyBudgetUsd: f.dailyBudgetUsd,
        maxSteps: f.maxSteps,
        skills: [...f.skills],
      };
      const created = await this.studio.createAgent(dto);
      if (created) {
        this.loadAgentIntoForm(created);
        this.saved.emit(created);
      }
    }
  }

  async executeSandbox(): Promise<void> {
    const agentId = this.selectedAgentId();
    if (!agentId) return;
    const f = this.form();
    const res = await this.studio.runSandbox({
      agentId,
      prompt: this.sandboxPrompt(),
      overrideSystemPrompt: f.systemPrompt,
      overrideSkills: f.skills,
      overrideModel: f.modelName,
    });
    if (res) {
      this.sandboxResult.set(res);
    }
  }
}
