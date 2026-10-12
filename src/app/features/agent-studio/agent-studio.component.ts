import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  AgentStudioService,
  MCP_SKILL_CATALOG,
  type McpSkillCatalogItem,
} from '../../core/agent-studio.service';
import type {
  CustomAgentDto,
  CreateCustomAgentDto,
  UpdateCustomAgentDto,
} from '../../../../electron/shared/types';
import { UiCard } from '../../shared/ui/ui-card';

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
  skills: Set<string>;
}

@Component({
  selector: 'app-agent-studio',
  standalone: true,
  imports: [CommonModule, FormsModule, UiCard],
  templateUrl: './agent-studio.component.html',
  styleUrls: ['./agent-studio.component.scss'],
})
export class AgentStudioComponent {
  readonly studio = inject(AgentStudioService);
  private readonly router = inject(Router);

  readonly skillCatalog = MCP_SKILL_CATALOG;

  // Modal / Editor State
  readonly isEditorOpen = signal<boolean>(false);
  readonly isEditing = signal<boolean>(false);
  readonly editingAgentId = signal<string | null>(null);

  // Skill filter in editor
  readonly selectedSkillCategory = signal<'ALL' | 'TRADING' | 'RIESGO' | 'SEGURIDAD' | 'CONCILIACION'>('ALL');

  // Form State
  readonly form = signal<AgentFormState>({
    id: '',
    name: '',
    description: '',
    systemPrompt: '',
    modelProvider: 'gemini',
    modelName: 'gemini-3.7-flash',
    temperature: 0.1,
    isActive: true,
    executionMode: 'on_demand',
    scheduleIntervalSec: 300,
    skills: new Set<string>(),
  });

  // Providers & Recommended models
  readonly availableProviders = [
    { id: 'gemini', label: 'Google Gemini (Nativo)' },
    { id: 'openrouter', label: 'OpenRouter (Nous Hermes, Claude, DeepSeek)' },
    { id: 'openai', label: 'OpenAI Platform' },
    { id: 'deepseek', label: 'DeepSeek Direct' },
  ];

  readonly recommendedModels: Record<string, { id: string; name: string }[]> = {
    gemini: [
      { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash (Recomendado / Veloz)' },
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
      { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash' },
      { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
      { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite (Baja Latencia)' },
    ],
    openrouter: [
      { id: 'nousresearch/hermes-3-llama-3.1-405b', name: 'Nous Hermes 3 405B (Especialista en Agentes)' },
      { id: 'nousresearch/hermes-3-llama-3.1-70b', name: 'Nous Hermes 3 70B' },
      { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet (Razonamiento Híbrido)' },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1 (Lógica Cuantitativa)' },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 (Económico)' },
    ],
    openai: [
      { id: 'gpt-4o', name: 'GPT-4o Omnimodal' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'o3-mini', name: 'o3-mini (Razonamiento)' },
    ],
    deepseek: [
      { id: 'deepseek-chat', name: 'DeepSeek V3' },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1' },
    ],
  };

  readonly filteredSkillsInEditor = computed(() => {
    const cat = this.selectedSkillCategory();
    if (cat === 'ALL') {
      return this.skillCatalog;
    }
    return this.skillCatalog.filter((s) => s.category === cat);
  });

  openCreateModal(): void {
    this.isEditing.set(false);
    this.editingAgentId.set(null);
    this.form.set({
      id: '',
      name: '',
      description: '',
      systemPrompt:
        'Eres un agente institucional especializado para arbitraje y control de riesgo P2P en Venezuela. Tu tarea es analizar libros de mercado, proteger la tesorería y emitir veredictos basados estrictamente en datos numéricos.',
      modelProvider: 'gemini',
      modelName: 'gemini-3.7-flash',
      temperature: 0.1,
      isActive: true,
      executionMode: 'on_demand',
      scheduleIntervalSec: 300,
      skills: new Set<string>(['calculate_spread', 'get_binance_p2p_orderbook', 'get_bcv_rates']),
    });
    this.isEditorOpen.set(true);
  }

  openEditModal(agent: CustomAgentDto): void {
    this.isEditing.set(true);
    this.editingAgentId.set(agent.id);
    this.form.set({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      modelProvider: agent.modelProvider,
      modelName: agent.modelName,
      temperature: agent.temperature,
      isActive: agent.isActive,
      executionMode: agent.executionMode,
      scheduleIntervalSec: agent.scheduleIntervalSec ?? 300,
      skills: new Set<string>(agent.skills),
    });
    this.isEditorOpen.set(true);
  }

  closeModal(): void {
    this.isEditorOpen.set(false);
  }

  onProviderChange(newProvider: string): void {
    const models = this.recommendedModels[newProvider];
    const defaultModel = models && models.length > 0 ? models[0].id : 'gemini-3.7-flash';
    this.form.update((f) => ({
      ...f,
      modelProvider: newProvider,
      modelName: defaultModel,
    }));
  }

  toggleSkillInForm(skillId: string): void {
    this.form.update((f) => {
      const nextSkills = new Set(f.skills);
      if (nextSkills.has(skillId)) {
        nextSkills.delete(skillId);
      } else {
        nextSkills.add(skillId);
      }
      return { ...f, skills: nextSkills };
    });
  }

  selectAllCategorySkills(): void {
    const currentCategory = this.selectedSkillCategory();
    const targetSkills =
      currentCategory === 'ALL'
        ? this.skillCatalog
        : this.skillCatalog.filter((s) => s.category === currentCategory);

    this.form.update((f) => {
      const next = new Set(f.skills);
      for (const s of targetSkills) {
        next.add(s.id);
      }
      return { ...f, skills: next };
    });
  }

  deselectAllCategorySkills(): void {
    const currentCategory = this.selectedSkillCategory();
    const targetSkills =
      currentCategory === 'ALL'
        ? this.skillCatalog
        : this.skillCatalog.filter((s) => s.category === currentCategory);

    this.form.update((f) => {
      const next = new Set(f.skills);
      for (const s of targetSkills) {
        next.delete(s.id);
      }
      return { ...f, skills: next };
    });
  }

  async saveAgent(): Promise<void> {
    const state = this.form();
    if (!state.name.trim()) {
      return;
    }
    if (!state.systemPrompt.trim()) {
      return;
    }

    const skillsArray = Array.from(state.skills);

    if (this.isEditing() && this.editingAgentId()) {
      const dto: UpdateCustomAgentDto = {
        name: state.name.trim(),
        description: state.description.trim(),
        systemPrompt: state.systemPrompt.trim(),
        modelProvider: state.modelProvider,
        modelName: state.modelName,
        temperature: state.temperature,
        isActive: state.isActive,
        executionMode: state.executionMode,
        scheduleIntervalSec:
          state.executionMode === 'ambient_daemon' ? state.scheduleIntervalSec : undefined,
        skills: skillsArray,
      };
      await this.studio.updateAgent(this.editingAgentId()!, dto);
    } else {
      const dto: CreateCustomAgentDto = {
        id: state.id.trim() ? state.id.trim() : undefined,
        name: state.name.trim(),
        description: state.description.trim(),
        systemPrompt: state.systemPrompt.trim(),
        modelProvider: state.modelProvider,
        modelName: state.modelName,
        temperature: state.temperature,
        isActive: state.isActive,
        executionMode: state.executionMode,
        scheduleIntervalSec:
          state.executionMode === 'ambient_daemon' ? state.scheduleIntervalSec : undefined,
        skills: skillsArray,
      };
      await this.studio.createAgent(dto);
    }

    this.closeModal();
  }

  async confirmDelete(agent: CustomAgentDto): Promise<void> {
    const ok = window.confirm(
      `¿Confirmas la eliminación del agente "${agent.name}"? Esta acción removerá sus permisos de skills.`,
    );
    if (ok) {
      await this.studio.deleteAgent(agent.id);
    }
  }

  goToCopilotWithAgent(agent: CustomAgentDto): void {
    void this.router.navigate(['/copilot'], {
      queryParams: { mention: `@${agent.id}` },
    });
  }

  getSkillBadgeName(skillId: string): string {
    const found = this.skillCatalog.find((s) => s.id === skillId);
    return found ? found.name : skillId;
  }
}
