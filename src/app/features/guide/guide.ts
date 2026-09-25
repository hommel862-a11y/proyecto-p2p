import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

export type GuideTab = 'intro' | 'tools' | 'swarm' | 'mcp' | 'security' | 'workflow' | 'terms';

@Component({
  selector: 'app-guide',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './guide.html',
  styleUrl: './guide.scss',
})
export class Guide {
  readonly activeTab = signal<GuideTab>('intro');

  readonly tabs: { id: GuideTab; label: string; icon: string; badge?: string }[] = [
    { id: 'intro', label: '1. P2P Desde Cero', icon: '📚' },
    { id: 'tools', label: '2. Herramientas del Desk', icon: '🛠️', badge: '10 Módulos' },
    { id: 'swarm', label: '3. Enjambre Multi-Agente', icon: '🤖', badge: 'Swarm AI' },
    { id: 'mcp', label: '4. Servidores MCP', icon: '🔌', badge: '10 Dominios' },
    { id: 'security', label: '5. Blindaje Bancario & SUDEBAN', icon: '🛡️' },
    { id: 'workflow', label: '6. Checklist Paso a Paso', icon: '🎯' },
    { id: 'terms', label: '7. Términos & Privacidad', icon: '⚖️', badge: 'Legal' },
  ];

  setTab(tab: GuideTab): void {
    this.activeTab.set(tab);
  }
}
