# Plugin Registry Pattern — 2-Hour Tool Integration

## Architecture Overview

This pattern enables loading new tools/plugins every 2 hours without restarting the P2P Decisor application. Based on the `PluginRegistryImpl` in `projects/core/src/lib/plugin-registry.ts`.

### Core Interfaces

#### PluginMetadata
```typescript
export interface PluginMetadata {
  id: string;                    // Unique identifier
  name: string;                  // Display name
  version: string;               // Semver version
  description: string;           // What the plugin does
  entryPoint: string;            // Module path for dynamic import
  lastLoaded: number;            // Timestamp (ms since epoch)
  status: 'LOADING' | 'READY' | 'ERROR' | 'DISABLED';
  requirements?: {
    minSpread?: number;          // Minimum spread VES to activate
    minLiquidityUsdt?: number;   // Minimum liquidity in USDT
    maxConcurrentOps?: number;   // Max concurrent operations
  };
}
```

#### PluginRegistry Interface
Key methods:
- `loadPlugin(pluginId: string, modulePath: string): Promise<boolean>`
  - Dynamic import of module
  - Validates `module.pluginMetadata` exists with `id` and `name`
  - Sets status to `LOADING` initially
  - Executes `module.init(context)` if provided, passing:
    - `storage` adapter (localStorage/WebStorage)
    - `rules` context (evaluate function + constants)
    - `marketDepth` signal
    - `setMarketQuality` callback
  - Updates status to `READY` on success, `ERROR` on failure
  
- `unloadPlugin(pluginId: string): Promise<boolean>`
  - Calls `module.cleanup()` if available
  - Removes from internal Map
  
- `getActivePlugins(): PluginMetadata[]`
  - Returns all plugins with status `READY`
  
- `getOverduePlugins(): PluginMetadata[]`
  - Returns plugins not checked in >2 hours AND status `READY`
  - Used by auto-loader to trigger re-verification

### Auto-Loader Service Pattern

The `PluginAutoLoaderService` checks every 2 hours (`CHECK_INTERVAL = 2 * 60 * 60 * 1000`):
1. HTTP GET to `/api/plugins/available` endpoint
2. Filters plugins not already in registry
3. For each new plugin:
   - Downloads module from `downloadUrl`
   - Validates integrity (recommended: SHA256 hash)
   - Calls `registry.loadPlugin(id, downloadUrl)`
   - Logs success/failure

### Integration with Rule Engine

New 7th rule: `evaluateDepthQuality(ctx: ExtendedRuleContext): RuleVerdict`
- Checks `marketQuality.depthScore >= minDepthScore` (default: 50)
- Checks `marketQuality.liquidityScore >= 40` (default)
- Returns `DENY` with reason `depth_poor` or `depth_insufficient`
- Returns `ALLOW` if both thresholds met

### File Structure (after implementation)

```
projects/core/src/lib/
  plugin-registry.ts        ← Registry + metadata interfaces
  plugin-auto-loader.service.ts ← Angular service, checks every 2h
  public-api.ts             ← Exports PluginRegistry + types

projects/core/references/
  plugin-registry-pattern.md ← This file — architecture documentation
  silver-pattern-mapping.md ← Gap documentation when tools unavailable

plugins/                  ← Directory for downloaded plugins (git-ignored)
  advanced-depth/
    plugin.ts             ← Example plugin structure
    index.ts              ← Entry point with pluginMetadata + init()
```

### Usage Example in Angular Component

```typescript
import { PluginRegistryImpl, formatPluginMetadata } from '@p2p/core';

// Load a plugin dynamically
registry.loadPlugin('advanced-depth', './plugins/advanced-depth/plugin.ts')
  .then(success => {
    if (success) {
      const plugin = registry.getPlugin('advanced-depth');
      console.log(formatPluginMetadata(plugin!));
      
      // Plugin is now active and enhancing the system
      // - marketDepth signal enhanced
      // - marketQuality updated with new scores
      // - New recommendations possible
    }
  });
```

### Pitfalls & Gotchas

#### ❌ Loading Already-Cached Plugin
- `loadPlugin()` returns `true` immediately if plugin already in registry
- Use `unloadPlugin()` first if you want to reload a new version

#### ❌ Plugin init() Failures
- If `module.init()` throws, plugin status becomes `ERROR`
- The system continues functioning without that plugin
- Check browser console logs for init error details

#### ❌ Memory Leak Risk
- Always ensure plugins can `cleanup()` on unload
- The registry does NOT auto-unload stale plugins
- Manual management required via `unloadPlugin()` or admin UI

#### ❌ Requirements Not Met
- `checkPluginRequirements()` can validate minSpread, minLiquidity before allowing
- Use `getOverduePlugins()` to identify candidates for re-verification
- Never force-enable a plugin whose requirements aren't satisfied by current market conditions

### Related Support Files

- `references/silver-pattern-mapping.md` — Documentation when target tool unavailable
- `scripts/calculate-quality.js` — Node script for calculating quality scores