/**
 * Plugin Registry para P2P Decisor
 * Sistema de integración de herramientas cada 2 horas
 * Framework-agnostic, pure TypeScript (forma parte de @p2p/core)
 *
 * Este registry trackea plugins/ herramientas externas que se cargan
 * dinámicamente sin necesidad de reiniciar la aplicación.
 *
 * PATRÓN: Singleton
 * CARGA: Dynamic import Angular + validación de schema mínima
 */

export interface PluginMetadata {
  /** Identificador único del plugin */
  id: string;
  /** Nombre para mostrar en la UI */
  name: string;
  /** Versión semver */
  version: string;
  /** Descripción de qué hace el plugin */
  description: string;
  /** Ruta/entry point del módulo del plugin */
  entryPoint: string;
  /** Timestamp cuándo fue cargado por última vez (ms desde epoch) */
  lastLoaded: number;
  /** Estado actual del plugin */
  status: 'LOADING' | 'READY' | 'ERROR' | 'DISABLED';
  /** Requisitos opcionales que el plugin necesita para funcionar */
  requirements?: {
    /** Spread mínimo aceptable en VES */
    minSpread?: number;
    /** Liquidez mínima en USDT */
    minLiquidityUsdt?: number;
    /** Máximo de operaciones concurrentes */
    maxConcurrentOps?: number;
  };
}

export interface PluginRegistry {
  /** Mapa de todos los plugins cargados por ID */
  plugins: Map<string, PluginMetadata>;

  /**
   * Carga un plugin dinámicamente desde una ruta de módulo.
   * @param pluginId Identificador único del plugin
   * @param modulePath Ruta del módulo a importar (formato Angular compatible)
   * @returns Promise<boolean> éxito o fracaso
   */
  loadPlugin(pluginId: string, modulePath: string): Promise<boolean>;

  /**
   * Descarga/descarga un plugin cargado.
   * @param pluginId ID del plugin a descargar
   * @returns Promise<boolean> éxito o fracaso
   */
  unloadPlugin(pluginId: string): Promise<boolean>;

  /**
   * Obtiene metadata de un plugin por su ID.
   * @param pluginId ID del plugin a consultar
   * @returns PluginMetadata | undefined
   */
  getPlugin(pluginId: string): PluginMetadata | undefined;

  /**
   * Obtiene todos los plugins con estado READY.
   * @returns PluginMetadata[]
   */
  getActivePlugins(): PluginMetadata[];

  /**
   * Obtiene plugins que llevan más de 2 horas sin actualizarse
   * (útil para el auto-loader de verificaciones periódicas).
   * @returns PluginMetadata[]
   */
  getOverduePlugins(): PluginMetadata[];
}

/**
 * Implementación singleton del PluginRegistry.
 * Se exporta como PluginRegistryImpl para ser usado en todo el proyecto.
 */
export const PluginRegistryImpl: PluginRegistry = {
  plugins: new Map(),

  /**
   * Carga un plugin dinámicamente. Pasos:
   * 1. Validar que no esté ya cargado
   * 2. Importar el módulo usando Angular's lazy import syntax
   * 3. Validar metadata mínima (id y name obligatorios)
   * 4. Registrar en el mapa con status LOADING
   * 5. Ejecutar module.init() si existe, pasando adapters del sistema
   * 6. Actualizar status a READY u ERROR
   */
  async loadPlugin(pluginId: string, modulePath: string): Promise<boolean> {
    // 1. Verificar que no ya esté cargado
    if (this.plugins.has(pluginId)) {
      console.log(`[plugin-registry] ${pluginId} ya está cargado. Retornando true.`);
      return true;
    }

    try {
      // 2. Cargar módulo dinámicamente
      // Nota: En Angular, el pattern !raw-loader! no siempre aplica.
      // Usamos import() estándar con ruta relativa resolvida por el builder
      const module: any = await import(modulePath);

      // 3. Validar metadata mínima requerida
      const metadata: PluginMetadata = module.pluginMetadata;
      if (!metadata?.id || !metadata?.name) {
        throw new Error(`Plugin ${pluginId} missing required metadata (id/name)`);
      }

      // 4. Registrar entrada en el mapa con estado inicial
      const pluginEntry: PluginMetadata = {
        ...metadata,
        lastLoaded: Date.now(),
        status: 'LOADING',
      };

      this.plugins.set(pluginId, pluginEntry);
      console.log(`[plugin-registry] ${pluginId} marcado como LOADING`);

      // 5. Ejecutar función init si el plugin la provee
      if (module && typeof module.init === 'function') {
        try {
          // Pasar adaptadores del sistema para que el plugin se integre
          await module.init({
            storage: {
              get: (key: string) =>
                localStorage.getItem(key) ? JSON.parse(localStorage.getItem(key)!) : null,
              set: (key: string, value: any) => localStorage.setItem(key, JSON.stringify(value)),
              remove: (key: string) => localStorage.removeItem(key),
              exportAll: () => {
                /* serializar localStorage actual */
              },
              importAll: (_json: string) => {
                /* importar desde JSON */
              },
            },
            rules: {
              evaluate: (_ctx: any) => {
                /* usar rules.ts del core */
              },
              ALLOW: 'ALLOW',
              DENY: 'DENY',
              PAUSE: 'PAUSE',
            },
            marketDepth: {/* source from spread-monitor service */},
            setMarketQuality: (_q: any) => {
              /* actualizar calidad de mercado */
            },
          });
          console.log(`[plugin-registry] ${pluginId}.init() ejecutado exitosamente`);
        } catch (initError) {
          console.error(`[plugin-registry] Error ejecutando init() de ${pluginId}:`, initError);
          // No matamos el plugin si init falla, solo advertimos
        }
      }

      // 6. Actualizar estado a READY
      pluginEntry.status = 'READY';
      this.plugins.set(pluginId, pluginEntry);

      console.log(
        `[plugin-registry] ${pluginId} cargado y listo. Total plugins: ${this.plugins.size}`,
      );
      return true;
    } catch (error: any) {
      console.error(`[plugin-registry] Error crítico cargando ${pluginId}:`, error);

      // Marcar como ERROR si no ya está marcado
      if (this.plugins.has(pluginId)) {
        this.plugins.get(pluginId)!.status = 'ERROR';
      } else {
        // Crear entry de error aunque no esté completamente registrado
        const errorEntry: PluginMetadata = {
          id: pluginId,
          name: pluginId,
          version: '0.0.0',
          description: 'Falló al cargarse',
          entryPoint: modulePath,
          lastLoaded: Date.now(),
          status: 'ERROR',
        };
        this.plugins.set(pluginId, errorEntry);
      }

      return false;
    }
  },

  /**
   * Descarga/remueve un plugin del registry.
   * @param pluginId ID del plugin a descargar
   * @returns Promise<boolean> éxito
   */
  async unloadPlugin(pluginId: string): Promise<boolean> {
    if (!this.plugins.has(pluginId)) {
      console.warn(`[plugin-registry] ${pluginId} no está cargado, nada que descargar`);
      return false;
    }

    const entry = this.plugins.get(pluginId)!;
    // Ejecutar cleanup si el plugin lo provee
    const maybeModule = (entry as unknown as Record<string, unknown>)?.['module'] as
      { cleanup?: () => Promise<void> } | undefined;
    if (maybeModule && typeof maybeModule.cleanup === 'function') {
      try {
        await maybeModule.cleanup();
        console.log(`[plugin-registry] ${pluginId}.cleanup() ejecutado`);
      } catch (cleanupError) {
        console.error(`[plugin-registry] Error en cleanup() de ${pluginId}:`, cleanupError);
      }
    }

    this.plugins.delete(pluginId);
    console.log(
      `[plugin-registry] ${pluginId} descargado. Quedan ${this.plugins.size} plugins activos`,
    );
    return true;
  },

  /**
   * Obtiene metadata de un plugin por ID.
   * @param pluginId ID del plugin
   * @returns PluginMetadata | undefined
   */
  getPlugin(pluginId: string): PluginMetadata | undefined {
    return this.plugins.get(pluginId);
  },

  /**
   * Obtiene todos los plugins con estado READY (activos).
   * @returns PluginMetadata[] lista de plugins activos
   */
  getActivePlugins(): PluginMetadata[] {
    return Array.from(this.plugins.values()).filter((p) => p.status === 'READY');
  },

  /**
   * Obtiene plugins sobrecargados (lleva >2 horas sin actualizarse).
   * Esto es útil para el auto-loader que verifica cada 2 horas.
   * @returns PluginMetadata[] plugins overdue
   */
  getOverduePlugins(): PluginMetadata[] {
    const now = Date.now();
    const twoHoursMs = 2 * 60 * 60 * 1000; // 7200000 ms
    return Array.from(this.plugins.values()).filter((p) => {
      // Un plugin es "overdue" si fue cargado hace más de 2h y aún tiene status READY
      // (significa no ha sido verificado/recargado desde entonces)
      return p.lastLoaded < now - twoHoursMs && p.status === 'READY';
    });
  },
};

/**
 * Utilidad: Formatea la metadata de un plugin a string legible
 * @param metadata PluginMetadata a formatear
 * @returns string formateado
 */
export function formatPluginMetadata(metadata: PluginMetadata): string {
  return `[${metadata.id}] ${metadata.name} v${metadata.version} | ${metadata.description} | Status: ${metadata.status} | Loaded: ${new Date(metadata.lastLoaded).toLocaleString()}`;
}

/**
 * Utilidad: Verifica si un plugin cumple sus requisitos mínimos
 * @param metadata PluginMetadata a verificar
 * @param ctx Contexto actual del sistema (spread, liquidez, etc.)
 * @returns boolean true si cumple requisitos
 */
export function checkPluginRequirements(
  metadata: PluginMetadata,
  ctx: {
    currentSpread?: number;
    bestBuyVolume?: number;
    bestSellVolume?: number;
  },
): boolean {
  const { requirements = {} } = metadata;

  if (requirements.minSpread !== undefined && ctx.currentSpread !== undefined) {
    if (ctx.currentSpread < requirements.minSpread) {
      return false;
    }
  }

  if (requirements.minLiquidityUsdt !== undefined) {
    const avgVolume = ((ctx.bestBuyVolume ?? 0) + (ctx.bestSellVolume ?? 0)) / 2;
    if (avgVolume < requirements.minLiquidityUsdt) {
      return false;
    }
  }

  // maxConcurrentOps se manejaría a nivel de motor de reglas, aquí solo retornamos true
  // si passed los demás checks

  return true;
}

/* ============================= EXAMPLE USAGE =============================
// Cómo usar en un componente Angular:

/*
import { PluginRegistryImpl, formatPluginMetadata, checkPluginRequirements } from '@p2p/core';
import { PluginAutoLoaderService } from '../plugins/auto-loader.service';

// En el constructor o ngOnInit:
const registry = PluginRegistryImpl;

// Cargar un plugin ejemplo:
registry.loadPlugin('advanced-depth', './plugins/advanced-depth/plugin.ts')
  .then(success => {
    if (success) {
      const plugin = registry.getPlugin('advanced-depth');
      console.log(formatPluginMetadata(plugin!));
      
      // Verificar si cumple requisitos actuales
      const cumple = checkPluginRequirements(plugin!, {
        currentSpread: 1.5,
        bestBuyVolume: 5000,
        bestSellVolume: 4800,
      });
      console.log('Cumple requisitos:', cumple);
    }
  });

// Ver plugins activos en la UI:
const activos = registry.getActivePlugins();
// Mostrar en HTML con *ngFor
*/
// ===========================================================================
