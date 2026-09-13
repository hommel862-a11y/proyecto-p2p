import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { CopilotChatMessage, StrategyPlanCard, CopilotResponse } from '@p2p/core';

interface ElectronCopilotBridge {
  sendMessage(params: { prompt: string; history?: CopilotChatMessage[] }): Promise<CopilotResponse>;
  executePlan(params: { planId: string }): Promise<{ success: boolean; error?: string }>;
  getPlans(params?: { limit?: number }): Promise<StrategyPlanCard[]>;
  getLearnings(params?: { category?: string; limit?: number }): Promise<unknown[]>;
  setApiKey(params: { apiKey: string }): Promise<boolean>;
  testConnection(): Promise<{ success: boolean; model: string; message: string }>;
}

function getElectronCopilot(): ElectronCopilotBridge | undefined {
  if (typeof window !== 'undefined') {
    return (window as unknown as { electron?: { copilot?: ElectronCopilotBridge } }).electron?.copilot;
  }
  return undefined;
}

@Component({
  selector: 'app-copilot',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './copilot.html',
  styleUrls: ['./copilot.scss'],
})
export class Copilot implements OnInit {
  messages = signal<CopilotChatMessage[]>([
    {
      role: 'assistant',
      content:
        '¡Hola! Soy tu **Agente Estratega P2P**. Estoy monitoreando en tiempo real las directivas de tesorería del BCV, spreads triangulares y la liquidez de los libros. ¿Qué estrategia o par querés que analicemos hoy?',
      timestamp: Date.now(),
    },
  ]);

  inputPrompt = signal<string>('');
  isLoading = signal<boolean>(false);
  activeTab = signal<'chat' | 'plans' | 'memory' | 'config'>('chat');
  plans = signal<StrategyPlanCard[]>([]);
  learnings = signal<Array<{ id?: number; topicKey: string; category: string; insight: string; confidenceScore: number }>>([]);
  actionSuccessNotice = signal<string | null>(null);

  connectionStatus = signal<{ connected: boolean; model: string; message: string }>({
    connected: false,
    model: 'gemini-3.6-flash',
    message: 'Verificando conexión...',
  });
  apiKeyInput = signal<string>('');
  isTestingConnection = signal<boolean>(false);

  async ngOnInit(): Promise<void> {
    await this.refreshData();
    await this.checkConnection();
  }

  async checkConnection(): Promise<void> {
    const copilot = getElectronCopilot();
    if (copilot) {
      try {
        const res = await copilot.testConnection();
        this.connectionStatus.set({
          connected: res.success,
          model: res.model,
          message: res.message,
        });
      } catch (err: unknown) {
        this.connectionStatus.set({
          connected: false,
          model: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      this.connectionStatus.set({
        connected: false,
        model: 'simulated',
        message: 'Modo navegador web (simulación local)',
      });
    }
  }

  async saveApiKey(): Promise<void> {
    const key = this.apiKeyInput().trim();
    if (!key) return;

    const copilot = getElectronCopilot();
    if (copilot) {
      await copilot.setApiKey({ apiKey: key });
      this.actionSuccessNotice.set('¡API Key guardada en SQLite exitosamente!');
      setTimeout(() => this.actionSuccessNotice.set(null), 4000);
      await this.checkConnection();
      this.activeTab.set('chat');
    }
  }

  async testConnectionAction(): Promise<void> {
    this.isTestingConnection.set(true);
    await this.checkConnection();
    this.isTestingConnection.set(false);
  }

  async refreshData(): Promise<void> {
    const copilot = getElectronCopilot();
    if (copilot) {
      try {
        const plans = await copilot.getPlans({ limit: 20 });
        this.plans.set(plans);
        const rawLearnings = await copilot.getLearnings({ limit: 50 });
        this.learnings.set(rawLearnings as any);
      } catch (err) {
        console.warn('Error loading copilot data from Electron IPC:', err);
      }
    }
  }

  async sendPrompt(text?: string): Promise<void> {
    const promptToSend = text || this.inputPrompt().trim();
    if (!promptToSend || this.isLoading()) return;

    this.inputPrompt.set('');
    this.messages.update((msgs) => [
      ...msgs,
      { role: 'user', content: promptToSend, timestamp: Date.now() },
    ]);

    this.isLoading.set(true);

    try {
      const copilot = getElectronCopilot();
      if (copilot) {
        const response = await copilot.sendMessage({
          prompt: promptToSend,
          history: this.messages(),
        });

        this.messages.update((msgs) => [
          ...msgs,
          {
            role: 'assistant',
            content: response.reply,
            plan: response.suggestedPlan,
            timestamp: Date.now(),
          },
        ]);

        if (response.suggestedPlan) {
          this.plans.update((p) => [response.suggestedPlan!, ...p.filter((x) => x.id !== response.suggestedPlan!.id)]);
        }
      } else {
        // Fallback demo for standalone web browser mode
        setTimeout(() => {
          const fallbackPlan: StrategyPlanCard = {
            id: `WEB-${Date.now().toString(36).toUpperCase()}`,
            title: 'Triangulación Táctica VES -> USDT -> BTC',
            route: 'VES (Pago Móvil) -> USDT -> BTC -> VES',
            capitalRequiredUsdt: 1000,
            expectedNetSpreadPct: 1.45,
            expectedProfitUsdt: 14.5,
            riskLevel: 'LOW',
            assignedOperatorName: 'Operador Principal',
            rationale: 'Spread neto 1.45% validado por la regla de oro (>0.50%) con libro de órdenes sanitizado.',
            status: 'PROPOSED',
          };
          this.messages.update((msgs) => [
            ...msgs,
            {
              role: 'assistant',
              content:
                'He analizado la microestructura del mercado P2P. Detecté una oportunidad de arbitraje triangular superior a la regla de oro (0.50% neto). Podés revisar la ficha y darle PLAY cuando quieras despacharla.',
              plan: fallbackPlan,
              timestamp: Date.now(),
            },
          ]);
          this.plans.update((p) => [fallbackPlan, ...p]);
        }, 800);
      }
    } catch (err: unknown) {
      this.messages.update((msgs) => [
        ...msgs,
        {
          role: 'assistant',
          content: `Hubo un error al consultar el servicio de orquestación: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      this.isLoading.set(false);
      await this.refreshData();
    }
  }

  async executePlan(plan: StrategyPlanCard): Promise<void> {
    if (plan.status === 'APPROVED' || plan.status === 'EXECUTED') return;

    const copilot = getElectronCopilot();
    if (copilot) {
      const res = await copilot.executePlan({ planId: plan.id });
      if (res.success) {
        plan.status = 'APPROVED';
        this.actionSuccessNotice.set(`¡Estrategia ${plan.id} APROBADA y delegada al operador con éxito!`);
        setTimeout(() => this.actionSuccessNotice.set(null), 4000);
        await this.refreshData();
      }
    } else {
      plan.status = 'APPROVED';
      this.actionSuccessNotice.set(`¡Estrategia ${plan.id} APROBADA en modo simulación web!`);
      setTimeout(() => this.actionSuccessNotice.set(null), 4000);
    }
  }

  quickPrompt(type: string): void {
    if (type === 'triangulacion') {
      this.sendPrompt('Analizá oportunidades de arbitraje triangular entre VES, USDT y divisas alternativas.');
    } else if (type === 'bcv') {
      this.sendPrompt('¿Cuál es la brecha cambiaria actual con el BCV y qué directiva de tesorería recomendás?');
    } else if (type === 'operadores') {
      this.sendPrompt('Diseñá un plan de asignación de capital para 2 operadores con $5,000 de capital total.');
    } else if (type === 'cobertura') {
      this.sendPrompt('Audita la exposición actual en VES y proponé una cobertura delta-neutral con derivados para mitigar devaluación.');
    } else if (type === 'volatilidad') {
      this.sendPrompt('Pronosticá la volatilidad y deriva del spread para las próximas 2 horas y sugerí ajustes de markup de compra y venta.');
    } else if (type === 'disputa') {
      this.sendPrompt('Generá un expediente arbitral formal para una orden con sospecha de pago de terceros no autorizados.');
    }
  }
}
