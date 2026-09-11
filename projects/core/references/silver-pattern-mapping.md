# Silver Pattern Mapping — When External Tool Unavailable

## Guidelines for documenting gaps and implementing equivalent patterns

### WHEN TO USE THIS FILE
When a search for an external tool/plugin/application (e.g., "Silver 5Demo", "Depth Trader", "Advanced Market Analysis Tool") yields no results, use these guidelines instead of halting work.

### SEARCH DOCUMENTATION TEMPLATE

```
## Searched: [Tool/Plugin Name]
- Query: [exact search terms used]
- Date: [session date]
- Locations searched: [web, local codebase, npm, git]
- Result: [found/not found / partial match]

## Equivalent Implementation Created
- [What was implemented in P2P Decisor instead]
- Files modified/created: [list]
- Architecture pattern used: [e.g., "enhanced existing service" vs "new plugin"]

## Feature Mapping Table

| External Feature | P2P Decisor Equivalent | Location |
|------------------|------------------------|----------|
| [Feature A]      | [Component/Service X]  | [path]   |
| [Feature B]      | [Component/Service Y]  | [path]   |

## Anti-Patterns (NEVER do these)
- ✗ Fabricate features that don't exist
- ✗ Claim tool works when it doesn't
- ✗ Halt development waiting for unavailable tool
- ✗ Invent search results

## Recommended Workflow

1. **Search** — Use web/tools to locate target application
2. **Document** — If not found, record in this file using template above
3. **Map** — Identify equivalent capabilities in existing architecture
4. **Implement** — Enhance current structure with professional patterns
5. **Validate** — Run tests, verify no regressions
6. **Publish** — Document what was done for future reference