import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AgentStudioService } from '../../core/agent-studio.service';
import type { CustomAgentDto } from '../../../../electron/shared/types';
import { AgentFleetDashboardComponent } from './components/agent-fleet-dashboard.component';
import { AgentStudioSandboxComponent } from './components/agent-studio-sandbox.component';
import { AgentRunsLedgerComponent } from './components/agent-runs-ledger.component';

export type AgentPlatformTab = 'fleet' | 'studio' | 'ledger';

@Component({
  selector: 'app-agent-studio',
  standalone: true,
  imports: [
    CommonModule,
    AgentFleetDashboardComponent,
    AgentStudioSandboxComponent,
    AgentRunsLedgerComponent,
  ],
  templateUrl: './agent-studio.component.html',
  styleUrls: ['./agent-studio.component.scss'],
})
export class AgentStudioComponent implements OnInit {
  readonly studio = inject(AgentStudioService);
  private readonly router = inject(Router);

  readonly activeTab = signal<AgentPlatformTab>('fleet');
  readonly selectedAgentForStudio = signal<CustomAgentDto | null>(null);
  readonly pendingDeleteAgent = signal<CustomAgentDto | null>(null);
  readonly showTemplatesDrawer = signal<boolean>(false);
  readonly seedingPresets = signal<boolean>(false);

  ngOnInit(): void {
    void this.studio.loadAgents();
    void this.studio.loadFleetTelemetry();
  }

  setTab(tab: AgentPlatformTab): void {
    this.activeTab.set(tab);
    if (tab === 'fleet' || tab === 'ledger') {
      void this.studio.loadFleetTelemetry();
    }
  }

  openNewAgentInStudio(): void {
    this.selectedAgentForStudio.set(null);
    this.activeTab.set('studio');
  }

  openAgentInStudio(agent: CustomAgentDto): void {
    this.selectedAgentForStudio.set(agent);
    this.activeTab.set('studio');
  }

  openAgentInCopilot(agent: CustomAgentDto): void {
    void this.router.navigate(['/copilot'], {
      queryParams: {
        agentId: agent.id,
        mention: `@${agent.id}`,
      },
    });
  }

  requestDelete(agent: CustomAgentDto): void {
    this.pendingDeleteAgent.set(agent);
  }

  cancelDelete(): void {
    this.pendingDeleteAgent.set(null);
  }

  async confirmDelete(): Promise<void> {
    const target = this.pendingDeleteAgent();
    if (!target) return;
    await this.studio.deleteAgent(target.id);
    if (this.selectedAgentForStudio()?.id === target.id) {
      this.selectedAgentForStudio.set(null);
    }
    this.pendingDeleteAgent.set(null);
  }

  async seedArmPresets(): Promise<void> {
    this.seedingPresets.set(true);
    try {
      await this.studio.seedArmSpecialistPresets();
      this.showTemplatesDrawer.set(false);
    } finally {
      this.seedingPresets.set(false);
    }
  }

  async seedFinance360Presets(): Promise<void> {
    this.seedingPresets.set(true);
    try {
      await this.studio.seedFinance360SpecialistPresets();
      this.showTemplatesDrawer.set(false);
    } finally {
      this.seedingPresets.set(false);
    }
  }
}
