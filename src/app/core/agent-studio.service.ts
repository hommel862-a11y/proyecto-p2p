import { Injectable, signal, computed, inject } from '@angular/core';
import type {
  CustomAgentDto,
  CreateCustomAgentDto,
  UpdateCustomAgentDto,
} from '../../../electron/shared/types';
import { ToastService } from './toast.service';

export interface McpSkillCatalogItem {
  id: string;
  name: string;
  category: 'TRADING' | 'RIESGO' | 'SEGURIDAD' | 'CONCILIACION';
  description: string;
}

export const MCP_SKILL_CATALOG: readonly McpSkillCatalogItem[] = [
  // TRADING & MERCADO
  {
    id: 'calculate_spread',
    name: 'Cálculo de Spread & ROI',
    category: 'TRADING',
    description: 'Calcula el spread neto y beneficio en USDT deduciendo comisiones taker/maker y comisiones bancarias.',
  },
  {
    id: 'get_binance_p2p_orderbook',
    name: 'Libro de Órdenes P2P en Vivo',
    category: 'TRADING',
    description: 'Obtiene el libro de órdenes P2P en tiempo real filtrado por activo (USDT/BTC), fiat (VES) y método de pago.',
  },
  {
    id: 'get_bcv_rates',
    name: 'Tasa Oficial BCV',
    category: 'TRADING',
    description: 'Consulta la tasa oficial de referencia emitida por el Banco Central de Venezuela.',
  },
  {
    id: 'get_parallel_rates',
    name: 'Tasa Paralela Venezuela',
    category: 'TRADING',
    description: 'Tasa de cotización del mercado paralelo obtenida vía agregadores en tiempo real.',
  },
  {
    id: 'calculate_rate_gap',
    name: 'Brecha Cambiaria BCV/Paralelo',
    category: 'TRADING',
    description: 'Calcula la divergencia porcentual entre la tasa oficial y el precio libre.',
  },
  {
    id: 'forecast_volatility_window',
    name: 'Ventana de Volatilidad',
    category: 'TRADING',
    description: 'Pronostica riesgo de volatilidad y deslizamiento en franjas horarias bancarias de alta liquidación.',
  },
  {
    id: 'recommend_competitive_pricing',
    name: 'Precio Óptimo Competitivo',
    category: 'TRADING',
    description: 'Sugiere precios de anuncio para ubicarse en los primeros puestos del libro P2P con margen seguro.',
  },
  {
    id: 'analyze_orderbook_pressure',
    name: 'Presión del Orderbook (OBI)',
    category: 'TRADING',
    description: 'Mide el desbalance de órdenes de compra vs venta para predecir movimientos de corto plazo.',
  },
  {
    id: 'fetch_cross_exchange_spread',
    name: 'Spread Multi-Exchange',
    category: 'TRADING',
    description: 'Analiza diferenciales de precios entre Binance, Bybit y El Dorado para arbitraje cruzado.',
  },

  // RIESGO & COMPLIANCE
  {
    id: 'evaluate_account_saturation',
    name: 'Escudo Bancario SUDEBAN',
    category: 'RIESGO',
    description: 'Audita el consumo del límite diario en VES y la velocidad de transacciones por cuenta bancaria.',
  },
  {
    id: 'evaluate_trade_risk',
    name: 'Evaluación Pre-Vuelo de Riesgo',
    category: 'RIESGO',
    description: 'Determina si una orden proyectada cumple con la Regla de Oro (>= 0.50% neto) y límites de capital.',
  },
  {
    id: 'detect_usdt_depeg',
    name: 'Monitor Global Paridad USDT',
    category: 'RIESGO',
    description: 'Vigila la paridad del USDT contra USDC y USD fiat; alerta ante desvíos mayores a 0.20%.',
  },
  {
    id: 'trigger_killswitch',
    name: 'Killswitch de Emergencia',
    category: 'RIESGO',
    description: 'Activa el interbloqueo de seguridad: frena operaciones en curso y congela anuncios ante eventos críticos.',
  },
  {
    id: 'check_bank_operational_status',
    name: 'Salud de Plataformas Bancarias',
    category: 'RIESGO',
    description: 'Verifica caídas de servicio o demoras reportadas en Pago Móvil y transferencias interbancarias.',
  },
  {
    id: 'stress_test_portfolio',
    name: 'Simulador de Estrés de Cartera',
    category: 'RIESGO',
    description: 'Evalúa escenarios de congelamiento temporal de fondos y capacidad de rotación de capital.',
  },

  // SEGURIDAD & FORENSE
  {
    id: 'audit_payment_proof_ocr',
    name: 'Auditoría OCR de Comprobante',
    category: 'SEGURIDAD',
    description: 'Extrae y valida banco, monto, fecha y número de referencia desde capturas o texto de pago.',
  },
  {
    id: 'verify_inbound_transfer',
    name: 'Cotejo Bancario en Vivo',
    category: 'SEGURIDAD',
    description: 'Compara un comprobante recibido contra la lista de eventos de pago móvil acreditados en la cuenta.',
  },
  {
    id: 'lookup_counterparty_reputation',
    name: 'Reputación de Contraparte',
    category: 'SEGURIDAD',
    description: 'Consulta porcentaje de órdenes completadas, tiempo promedio de liberación y reportes previos.',
  },
  {
    id: 'check_counterparty_blacklist',
    name: 'Verificación en Lista Negra',
    category: 'SEGURIDAD',
    description: 'Comprueba si la cédula, teléfono o cuenta bancaria está fichada por incidentes de triangulación.',
  },
  {
    id: 'register_blacklisted_entity',
    name: 'Fichar en Lista Negra',
    category: 'SEGURIDAD',
    description: 'Registra un estafador o cuenta sospechosa en la base de datos local para veto automático permanente.',
  },
  {
    id: 'screen_wallet_address',
    name: 'Screening de Billetera Cripto',
    category: 'SEGURIDAD',
    description: 'Analiza historial de transacciones en cadena para prevenir depósitos contaminados.',
  },

  // CONCILIACIÓN & CLOUD
  {
    id: 'compile_dispute_dossier',
    name: 'Expediente de Apelación P2P',
    category: 'CONCILIACION',
    description: 'Genera un documento cronológico forense con pruebas bancarias y marcas de tiempo para Binance Soporte.',
  },
  {
    id: 'gdrive_backup_receipt',
    name: 'Respaldo en Google Drive',
    category: 'CONCILIACION',
    description: 'Sube automáticamente el comprobante de pago auditado a la carpeta designada en Google Drive.',
  },
  {
    id: 'gsheets_sync_trade',
    name: 'Sincronización con Google Sheets',
    category: 'CONCILIACION',
    description: 'Asienta la ganancia neta, spread y montos de cada orden completada en la hoja contable.',
  },
  {
    id: 'autofill_trade_reference',
    name: 'Generador de Referencia Única',
    category: 'CONCILIACION',
    description: 'Genera códigos alfanuméricos únicos para solicitar en el concepto de transferencia.',
  },
  {
    id: 'send_multichannel_alert',
    name: 'Alerta Multicanal',
    category: 'CONCILIACION',
    description: 'Despacha notificaciones de alta prioridad a Telegram Bot y webhooks configurados.',
  },
];

@Injectable({
  providedIn: 'root',
})
export class AgentStudioService {
  private readonly toast = inject(ToastService);

  private readonly _agents = signal<CustomAgentDto[]>([]);
  private readonly _loading = signal<boolean>(false);
  private readonly _filterMode = signal<'all' | 'on_demand' | 'ambient_daemon'>('all');
  private readonly _searchQuery = signal<string>('');

  readonly agents = computed(() => this._agents());
  readonly loading = computed(() => this._loading());
  readonly filterMode = computed(() => this._filterMode());
  readonly searchQuery = computed(() => this._searchQuery());

  readonly filteredAgents = computed(() => {
    let list = this._agents();
    const mode = this._filterMode();
    if (mode !== 'all') {
      list = list.filter((a) => a.executionMode === mode);
    }
    const query = this._searchQuery().trim().toLowerCase();
    if (query) {
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(query) ||
          a.description.toLowerCase().includes(query) ||
          a.modelName.toLowerCase().includes(query) ||
          a.skills.some((s) => s.toLowerCase().includes(query)),
      );
    }
    return list;
  });

  readonly totalCount = computed(() => this._agents().length);
  readonly activeCount = computed(() => this._agents().filter((a) => a.isActive).length);
  readonly daemonsCount = computed(
    () => this._agents().filter((a) => a.executionMode === 'ambient_daemon').length,
  );

  constructor() {
    void this.loadAgents();
  }

  setFilterMode(mode: 'all' | 'on_demand' | 'ambient_daemon'): void {
    this._filterMode.set(mode);
  }

  setSearchQuery(query: string): void {
    this._searchQuery.set(query);
  }

  async loadAgents(): Promise<void> {
    this._loading.set(true);
    try {
      if (typeof window !== 'undefined' && window.electron?.agents) {
        const result = await window.electron.agents.list();
        this._agents.set(result);
      } else {
        // Fallback para navegador web sin runtime de Electron
        const stored = localStorage.getItem('p2p.custom_agents');
        if (stored) {
          try {
            this._agents.set(JSON.parse(stored));
          } catch {
            this._agents.set([]);
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al cargar agentes';
      this.toast.error(`Fallo al leer Agent Studio: ${msg}`);
    } finally {
      this._loading.set(false);
    }
  }

  async createAgent(dto: CreateCustomAgentDto): Promise<CustomAgentDto | null> {
    this._loading.set(true);
    try {
      if (typeof window !== 'undefined' && window.electron?.agents) {
        const created = await window.electron.agents.create(dto);
        await this.loadAgents();
        this.toast.success(`Agente "${created.name}" creado con éxito.`);
        return created;
      } else {
        const now = Date.now();
        const created: CustomAgentDto = {
          id: dto.id ?? `agent-${now}`,
          name: dto.name,
          description: dto.description ?? '',
          systemPrompt: dto.systemPrompt,
          modelProvider: dto.modelProvider ?? 'gemini',
          modelName: dto.modelName ?? 'gemini-3.7-flash',
          temperature: dto.temperature ?? 0.1,
          isActive: dto.isActive !== false,
          executionMode: dto.executionMode ?? 'on_demand',
          scheduleIntervalSec: dto.scheduleIntervalSec,
          skills: dto.skills ?? [],
          createdAt: now,
          updatedAt: now,
        };
        const current = [...this._agents(), created];
        this._agents.set(current);
        localStorage.setItem('p2p.custom_agents', JSON.stringify(current));
        this.toast.success(`Agente "${created.name}" guardado localmente.`);
        return created;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al crear agente';
      this.toast.error(msg);
      return null;
    } finally {
      this._loading.set(false);
    }
  }

  async updateAgent(id: string, dto: UpdateCustomAgentDto): Promise<CustomAgentDto | null> {
    this._loading.set(true);
    try {
      if (typeof window !== 'undefined' && window.electron?.agents) {
        const updated = await window.electron.agents.update(id, dto);
        await this.loadAgents();
        if (updated) {
          this.toast.info(`Agente "${updated.name}" actualizado.`);
        }
        return updated;
      } else {
        const current = this._agents().map((a) => {
          if (a.id === id) {
            return {
              ...a,
              ...dto,
              skills: dto.skills ?? a.skills,
              updatedAt: Date.now(),
            };
          }
          return a;
        });
        this._agents.set(current);
        localStorage.setItem('p2p.custom_agents', JSON.stringify(current));
        this.toast.info('Agente actualizado localmente.');
        return current.find((a) => a.id === id) ?? null;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al actualizar agente';
      this.toast.error(msg);
      return null;
    } finally {
      this._loading.set(false);
    }
  }

  async toggleAgent(id: string, active?: boolean): Promise<void> {
    try {
      if (typeof window !== 'undefined' && window.electron?.agents) {
        await window.electron.agents.toggle(id, active);
        await this.loadAgents();
      } else {
        const current = this._agents().map((a) => {
          if (a.id === id) {
            const nextActive = active !== undefined ? active : !a.isActive;
            return { ...a, isActive: nextActive, updatedAt: Date.now() };
          }
          return a;
        });
        this._agents.set(current);
        localStorage.setItem('p2p.custom_agents', JSON.stringify(current));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al cambiar estado';
      this.toast.error(msg);
    }
  }

  async deleteAgent(id: string): Promise<boolean> {
    this._loading.set(true);
    try {
      if (typeof window !== 'undefined' && window.electron?.agents) {
        const ok = await window.electron.agents.delete(id);
        await this.loadAgents();
        this.toast.warn('Agente eliminado del sistema.');
        return ok;
      } else {
        const current = this._agents().filter((a) => a.id !== id);
        this._agents.set(current);
        localStorage.setItem('p2p.custom_agents', JSON.stringify(current));
        this.toast.warn('Agente eliminado localmente.');
        return true;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al eliminar agente';
      this.toast.error(msg);
      return false;
    } finally {
      this._loading.set(false);
    }
  }
}
