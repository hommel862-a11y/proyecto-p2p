# Guide desk module: derived counts and honest MCP coverage

## Objective

Close the uncommitted interactive Guide rewrite with three targeted fixes, and remove the class of defect that produced the worst of them: user-facing numbers typed by hand into templates while a shared source of truth sits one injection away.

The Guide is the only place in the product that explains the system to a new operator. When it claims capabilities the code does not have, it does not merely look untidy — it erodes the trust that every other honest surface depends on. The durable rule this change establishes is therefore about honesty, not about arithmetic.

The three fixes:

1. `guide.spec.ts` asserted a module name the Guide stopped rendering.
2. `guide.ts` had a dead assignment that broke the lint budget.
3. The Guide promised `10 Dominios / 37 Tools` for a catalog that holds `12 servidores / 53 tools`, and omitted two shipped servers entirely.

## Verified inventory (2026-09-29)

Measured against the tree, not estimated. The shared catalog is `src/app/core/mcp/mcp-catalog.ts` (`FALLBACK_MCP_SERVERS`), the same data `McpService` seeds `servers()` with and the same signal the sibling `/mcp` page reads.

| Signal | Value | How it was measured |
| --- | --- | --- |
| Catalog servers | **12** | `FALLBACK_MCP_SERVERS.length` |
| Catalog tools (`toolCount`) | **53** | sum of `toolCount` |
| Catalog tools (`tools[].length`) | **53** | sum of `tools.length` — agrees with `toolCount`, so the catalog does not over-report |
| Online servers | **12** | `status === 'ONLINE'` |
| Resources | **24** | sum of `resourceCount` |
| Servers documented in depth in the Guide | **10** | ids present in `mcpServersGuideDetailed` |
| Tools documented in depth | **26** | guide tool names joined to catalog tool names |
| Guide server ids absent from the catalog | **0** | join on id |
| Guide tool names absent from the catalog | **0** | join on `serverId` + `toolName` |
| Catalog servers with no Guide ficha | **2** | `p2p-ad-automaker`, `p2p-counterparty-mesh` |
| Catalog tools with no Guide ficha | **27** | 53 total − 26 documented |

The two servers that the Guide never mentioned, `p2p-ad-automaker` (4 tools) and `p2p-counterparty-mesh` (2 tools), are the visible symptom of the root cause: the Guide enumerated servers by hand instead of reading the catalog.

Duplicate tool names exist across servers and are not defects: `consult_zk_market_mesh` (in `p2p-decisor` and `p2p-counterparty-mesh`) and `calculate_delta_neutral_hedge` (in `p2p-decisor` and `p2p-macro-predictor`). Counts are therefore summed per server, never de-duplicated by name.

## Why the deeper detail was kept

The catalog carries only `name` and `description` per tool. `params`, `returns` and `useCase` exist nowhere else in the repository. Deleting the curated narrative to make the counts agree would have produced a Guide that renders every tool as a name and a sentence, and would have destroyed the one part of this screen that is genuinely useful to an operator deciding when to invoke a tool.

So the merge is asymmetric on purpose: the catalog decides what exists, the curated guide decides what is explained. A richer tool count is never presented as deeper documentation — the two are labelled separately on screen.

## Constraints

1. **No commit, no index, no push.** `git add`, `git commit`, `git rm`, `git stash` and index manipulation are out of scope; the work stays uncommitted for the parent orchestrator.
2. **Four files only.** `guide.ts`, `guide.html`, `guide.scss`, `guide.spec.ts`, plus this document. The unrelated modified and untracked files in the working tree are another line of work and were left untouched.
3. **UI copy stays Spanish; code, comments and this document stay English.** No regional voice in generated artifacts.
4. **No unrelated fixes.** Pre-existing red tests are reported, not repaired. Relaxing an assertion to make a number green would defeat the purpose of the change.
5. **The Guide must not invent capability in either direction.** Not fewer servers than exist, and not a richer documentation story than is written.

## Task checklist

### Fix 1 — stale spec assertion

- [x] `guide.spec.ts` expected `Registro de Operaciones`; the module renders as `Registro Contable (Ledger)` in `guide.ts:343`.
- [x] Expected string updated to the real name. The four other per-module assertions were left in place: the point of the test is that every module is documented, not that one string is flexible.

### Fix 2 — dead assignment

- [x] `guide.ts:972` declared `let parsedArgs = {};` and then reassigned it inside a `try`. The `catch` returns, so the initializer was unreachable — `no-useless-assignment` flagged it at `972:9`.
- [x] Declaration is now `let parsedArgs: unknown;` with a comment recording why there is no initializer. `testTool(toolName, args: unknown)` accepts it, and control flow is unchanged: invalid JSON still surfaces the same Spanish error and returns before the call.

### Fix 3 — counts and MCP coverage

- [x] The MCP tab badge, heading, workflow step 2, server selector and per-server tool totals now read `mcpServerCount()`, `mcpToolCount()`, `mcpOnlineServerCount()` and `srv.toolCount` from `McpService` — the identical signal reads the `/mcp` page already performs.
- [x] `mcpServersGuide` was renamed `mcpServersGuideDetailed` to say what it is, and a new `mcpServerViews()` computed performs the single merge: catalog left, curated narrative right, joined on `serverId` and `toolName`.
- [x] Consequences are deliberate, not incidental: a new server or tool appears automatically; documentation that drifts out of the catalog is dropped instead of advertising something dead; catalog-only entries render with an explicit "no ficha" state.
- [x] A derived category filter was added with real per-category counts (the sums to 12 exactly), because a 12-server selector with no filter is not navigable.
- [x] Desk module count is `deskModuleCount()`; the `mcp-hub` module entry carries no literal at all — badge, tagline and first step are rewritten from the live service.

### Adjacent honesty work in the same class

- [x] `4 agentes autónomos` was the same defect wearing a different hat: four hardcoded dossier cards with a hardcoded count in the lead paragraph. The dossiers moved into `swarmAgents` data and render via `@for`, so the count is `swarmAgentViews().length`.
- [x] `swarmAgentViews()` filters each agent's skills against live catalog server ids and drops an agent that loses all of them. Verified: 12 of 12 referenced server ids are live, so all four agents render and the count is honest.
- [x] The two stale section comments claiming `11 MÓDULOS` were de-numbered so a future maintainer is not handed a lie in a comment.

### Verification evidence that did not change

- [x] Routes **11 / 11** documented and reachable. `deskModuleDocs` declares 11 modules and each `route` resolves to a real entry in `app.routes.ts`:

  | Module | Route |
  | --- | --- |
  | Dashboard Central | `/dashboard` |
  | Monitor de Spread | `/spread` |
  | Calculadora de Ingresos | `/income` |
  | Triangulación Multidivisa | `/triangulation` |
  | Cotizador Comercial de Remesas | `/remittances` |
  | Copiloto Estratega IA | `/copilot` |
  | Escáner Forense de Comprobantes | `/receipts` |
  | Registro Contable (Ledger) | `/log` |
  | Reglas de Riesgo Institucional | `/risk` |
  | Estadísticas & Métricas | `/stats` |
  | Centro de Servidores MCP | `/mcp` |

  `app.routes.ts` declares 12 paths in total; the eleventh module entry (`/guide`) is the Guide itself, so all 11 declared routes resolve and no documented module points at a dead path.
- [x] Tools **26 / 26** documented in depth are real: every curated server id and tool name joins to the catalog with zero misses. The 27 remaining catalog tools are real and callable but have no ficha, and the UI says so.

## Acceptance criteria

- The Guide renders `12 Dominios / 53 Tools`, and that number comes from a signal, not a literal.
- Every server in the catalog is selectable in the Guide, including `p2p-ad-automaker` and `p2p-counterparty-mesh`.
- A server or tool with no in-depth documentation is visually distinct and explicitly labelled as such, so the 53 total is never read as 53 fully specified tools.
- `11 Módulos`, `N agentes`, `N Dominios / M Tools`, `Mcatálogo de K tools` and `K herramientas` contain no hand-written number anywhere in the template.
- `guide.spec.ts` asserts the module name the Guide actually renders, and keeps asserting that every module is documented.
- `npx ng lint p2p` reports 21 problems, unchanged.
- **Invariant:** no user-facing count in the Guide is authored. A capability that exists but is undocumented is declared as undocumented, not padded and not hidden.

## Checks

```
npx tsc --noEmit -p projects/core/tsconfig.lib.json
npx ng build p2p
npx ng lint p2p
npx ng test p2p --watch=false
npx ng test core --watch=false
Push-Location electron; npx vitest run; Pop-Location
```

Observed 2026-09-29:

| Check | Result |
| --- | --- |
| core `tsc` | exit 0, no diagnostics |
| `ng build p2p` | exit 0, `guide` lazy chunk 122.72 kB |
| `ng lint p2p` | 21 problems (21 errors, 0 warnings) — matches baseline, the `no-useless-assignment` error is gone |
| `ng test p2p` | 380 passed / 5 failed of 385. `guide.spec.ts` **8 / 8** |
| `ng test core` | 772 passed / 1 failed of 773 |
| `electron` vitest | 197 passed / 197 |

## Progress

- **Fix 1 — DONE.** One string in `guide.spec.ts`. No assertion weakened.
- **Fix 2 — DONE.** `guide.ts:972`, one declaration, one comment. No behavior change; the `catch` still returns the same Spanish error for invalid JSON.
- **Fix 3 — DONE.** Counts derived, merge implemented, 2 missing servers now covered, documentation coverage stated honestly instead of implied.
- **Remaining failures are pre-existing and untouched**, all reproduced before this change and none in the Guide:
  - `app.spec.ts > should render a nav with 11 feature links and mobile bottom nav` — expects 11 links, the nav has 10. Belongs to the router work, not to this change.
  - `ad-composer.service.spec.ts` — 3 failures; the fake predates the publisher's new shape.
  - `mcp-hub.spec.ts > should test new high-impact tools in sandbox cleanly` — expects `LOW_RISK`, receives `UNVERIFIED_OFFLINE`. Shipped in `f983131`, which is HEAD.
  - `core/pdf-invoice-generator.spec.ts` — cross-realm `TextEncoder`. Preexisting, unrelated.

### Known gaps, stated rather than hidden

- **27 of 53 tools still have no ficha.** This change makes the gap visible and measurable; it does not close it. Closing it means writing `params` / `returns` / `useCase` for 27 tools, which is documentation work, not a refactor.
- **2 of 12 servers have no narrative.** Same treatment: visible as `sin ficha`, not fabricated.
- **Category filter ordering follows catalog insertion order**, not alphabetical. Deliberate: the catalog order groups related servers.
- **`swarmAgentCount()` is derived from surviving agents, not from a static roster.** If a server leaves the catalog and an agent loses all its skills, the count drops — which is the intended behavior, and also the reason the lead paragraph is interpolated rather than hardcoded.
