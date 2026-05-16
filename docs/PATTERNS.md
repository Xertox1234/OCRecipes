# Development Patterns

This document is the entry point for OCRecipes' codified knowledge. Follow these patterns and conventions for consistency across features.

As of the Phase 2 pattern-codification refactor (2026-05), the monolithic `docs/patterns/*.md` files have been decomposed into one-file-per-solution under `docs/solutions/`. Knowledge now lives as small, frontmatter-indexed files the write-time hook can grep and inject selectively.

## Where knowledge lives

| Source                      | What it holds                                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/solutions/`           | One file per solution — bug post-mortems and reusable knowledge. **Primary source. Start here.**                                                                     |
| `docs/rules/<domain>.md`    | Binding, short "always do X / never do Y" rules per domain. Auto-injected at write time.                                                                             |
| `docs/legacy-patterns/*.md` | The 16 retired monolithic pattern files. Frozen archive — kept because audits and specialist agents deep-link to specific named sections. Not a codification target. |

## Solution categories (`docs/solutions/`)

Solutions are split into two tracks via the `track:` frontmatter field. See `docs/solutions/README.md` for the full schema and finding-aids.

### Bug track (`track: bug`)

| Category                                               | What it holds                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| [`logic-errors/`](solutions/logic-errors/)             | Code runs but produces incorrect behavior (off-by-one, race, stale state). |
| [`runtime-errors/`](solutions/runtime-errors/)         | Crashes or uncaught exceptions at runtime.                                 |
| [`code-quality/`](solutions/code-quality/)             | Type-safety / DX / maintainability smells (no behavior bug).               |
| [`performance-issues/`](solutions/performance-issues/) | Speed, memory, N+1, wasted work.                                           |

### Knowledge track (`track: knowledge`)

| Category                                         | What it holds                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| [`conventions/`](solutions/conventions/)         | Project rules: "always do X / never do Y."                              |
| [`design-patterns/`](solutions/design-patterns/) | Reusable structural patterns — composable code shapes.                  |
| [`best-practices/`](solutions/best-practices/)   | Procedural checklists triggered by an event (migration, rebrand, etc.). |

Decomposition manifests (extracted / merged / pruned outcomes) live under [`solutions/_manifests/`](solutions/_manifests/).

## Domain → rules / archive mapping

Each retired `docs/patterns/<domain>.md` monolith maps to the binding `docs/rules/<domain>.md` rules file plus solution files spread across the categories above. Use the domain to locate the rules file; use the symptom to locate solution files. The frozen monolith is kept for deep-linked named sections (audits, specialist-agent `(Ref: ...)` citations).

| Domain        | Rules file                              | Frozen archive                                                       |
| ------------- | --------------------------------------- | -------------------------------------------------------------------- |
| Security      | [security](rules/security.md)           | [legacy-patterns/security.md](legacy-patterns/security.md)           |
| TypeScript    | [typescript](rules/typescript.md)       | [legacy-patterns/typescript.md](legacy-patterns/typescript.md)       |
| API           | [api](rules/api.md)                     | [legacy-patterns/api.md](legacy-patterns/api.md)                     |
| Database      | [database](rules/database.md)           | [legacy-patterns/database.md](legacy-patterns/database.md)           |
| Client State  | [client-state](rules/client-state.md)   | [legacy-patterns/client-state.md](legacy-patterns/client-state.md)   |
| React Native  | [react-native](rules/react-native.md)   | [legacy-patterns/react-native.md](legacy-patterns/react-native.md)   |
| Accessibility | [accessibility](rules/accessibility.md) | [legacy-patterns/accessibility.md](legacy-patterns/accessibility.md) |
| Performance   | [performance](rules/performance.md)     | [legacy-patterns/performance.md](legacy-patterns/performance.md)     |
| Design System | [design-system](rules/design-system.md) | [legacy-patterns/design-system.md](legacy-patterns/design-system.md) |
| Architecture  | [architecture](rules/architecture.md)   | [legacy-patterns/architecture.md](legacy-patterns/architecture.md)   |
| Hooks         | [hooks](rules/hooks.md)                 | [legacy-patterns/hooks.md](legacy-patterns/hooks.md)                 |
| AI Prompting  | [ai-prompting](rules/ai-prompting.md)   | [legacy-patterns/ai-prompting.md](legacy-patterns/ai-prompting.md)   |
| Testing       | [testing](rules/testing.md)             | [legacy-patterns/testing.md](legacy-patterns/testing.md)             |
| Animation     | _(covered by `react-native` rules)_     | [legacy-patterns/animation.md](legacy-patterns/animation.md)         |
| Agents        | _(no rules file — see solutions)_       | [legacy-patterns/agents.md](legacy-patterns/agents.md)               |
| Documentation | _(no rules file — see solutions)_       | [legacy-patterns/documentation.md](legacy-patterns/documentation.md) |

**Before implementing:** Check `docs/solutions/` (by symptom or category) and the relevant `docs/rules/<domain>.md`.
**After implementing:** Codify new reusable knowledge as a solution file — see `.claude/skills/codify/SKILL.md`.
