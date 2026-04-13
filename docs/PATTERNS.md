# Development Patterns

This document captures established patterns for the OCRecipes codebase. Follow these patterns for consistency across features.

Patterns are organized into domain-specific files under `docs/patterns/`:

| Domain        | File                                          | Description                                                                                                                                    |
| ------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Security      | [security.md](patterns/security.md)           | IDOR protection, SSRF, token versioning, AI input sanitization, rate limiting, fail-closed, sensitive logging                                  |
| TypeScript    | [typescript.md](patterns/typescript.md)       | Type guards, Zod schemas, shared types, discriminated unions                                                                                   |
| API           | [api.md](patterns/api.md)                     | Error responses, auth, env validation, service availability guards, graceful shutdown, rate limiters, external API handling, AsyncLocalStorage |
| Database      | [database.md](patterns/database.md)           | Drizzle ORM, caching, soft delete, transactions, TOCTOU prevention, two-phase limit checks, batch CASE/WHEN, CHECK constraints, JSONB safety   |
| Client State  | [client-state.md](patterns/client-state.md)   | In-memory caching, auth headers, TanStack Query, optimistic mutations, smart retry                                                             |
| React Native  | [react-native.md](patterns/react-native.md)   | Navigation, safe areas, accessibility, forms, progressive disclosure, skeleton loaders                                                         |
| Animation     | [animation.md](patterns/animation.md)         | Reanimated configs, SVG arcs, volume-reactive, layout animations, gestures                                                                     |
| Performance   | [performance.md](patterns/performance.md)     | React.memo, FlatList optimization, FlatList defaults, useMemo, TTL caches, promise memo, serial queue                                          |
| Design System | [design-system.md](patterns/design-system.md) | Color opacity, semantic theme values, border radius naming                                                                                     |
| Architecture  | [architecture.md](patterns/architecture.md)   | Storage module decomposition, route registration, service patterns, storage layer purity, structured logging conventions                       |
| Hooks         | [hooks.md](patterns/hooks.md)                 | TanStack Query CRUD modules, FormData uploads, SSE streaming                                                                                   |
| AI Prompting  | [ai-prompting.md](patterns/ai-prompting.md)   | Pre-compute context, few-shot examples, safety refusals, completion budget, markdown restrictions                                              |
| Testing       | [testing.md](patterns/testing.md)             | Pure function extraction, vi.resetModules, pre-commit hooks, ESLint rules, LLM evals                                                           |
| Documentation | [documentation.md](patterns/documentation.md) | Todo structure, design decisions, form state hooks, bottom-sheet lifecycle                                                                     |

**Before implementing:** Check if a pattern exists in the relevant file above.
**After implementing:** Consider if your solution should become a pattern.
