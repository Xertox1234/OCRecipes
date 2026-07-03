---
title: 'Parallel agent development: shared file ownership creates merge conflicts'
track: knowledge
category: best-practices
module: shared
tags: [process, architecture, parallel-agents, merge-conflicts, planning]
applies_to: [shared/schema.ts, server/storage.ts, server/routes.ts, shared/types/premium.ts]
created: '2026-05-13'
---

# Parallel agent development: shared file ownership creates merge conflicts

## When this applies

When planning multi-feature work executed in parallel by separate agents (or contributors). Especially relevant when each feature must touch the same canonical files — schema, storage interface, route registry, feature-flag tables.

## Smell patterns

- Multiple feature branches all adding entries to the same file (`shared/schema.ts`, `server/storage.ts`, `shared/types/premium.ts`).
- Three-way merges where each agent's diff inserts at a different line in the same object literal.
- Feature flag tables, route registries, or storage interfaces that grow with every new feature.

## Why

Concurrent edits to canonical files are not a code-quality problem — they are a coordination problem. Three patterns observed during Phases 8-11 of the premium-tier rollout, where four agents added `glp1Companion`, `menuScanner`, `micronutrientTracking`, and `culturalFoodRecognition` features in parallel:

1. **`shared/schema.ts`** — Each agent added new tables. Inserting at arbitrary positions produced overlapping edits.
2. **`server/storage.ts`** — Each phase added new storage methods. The interface declaration and implementation grew independently, so conflicts appeared twice per method.
3. **`shared/types/premium.ts`** — Each phase added a feature flag to `TIER_FEATURES`. Conflicts were shallow but blocked every merge.

## Examples

### Mitigations that worked

1. **Additive-only changes** — Append to the end of files rather than inserting at semantically "natural" positions. Reduces three-way merges to mostly-resolvable adjacent additions.
2. **Route-module-per-feature pattern** — Each phase's routes lived in their own file (`medication.ts`, `menu.ts`, `micronutrients.ts`). Only a single line was added to `server/routes.ts` to register each module.
3. **Feature-flag isolation by property** — `TIER_FEATURES` conflicts were two agents adding _different_ boolean fields to the same object. Shallow conflicts, easy to resolve manually.

### What to do differently next time

1. **Schema changes first, in sequence** — Land all schema migrations as a single ordered batch before parallel feature work starts. Or use per-feature migration files so each migration is independent.
2. **Generate the storage interface** — Consider deriving the storage interface from the schema to eliminate manual dual-maintenance. Removes one of the three conflict-prone files entirely.
3. **Feature flags as plugin registrations** — Instead of one monolithic `TIER_FEATURES` object, let each feature module register its own flag. Trades centralisation for diff isolation.

## Exceptions

For solo work or strictly sequential agent dispatches, the overhead of plugin-style registration or pre-staged schema migrations is not worth it. The rule applies specifically when you expect ≥3 concurrent feature branches.

## Related Files

- `shared/schema.ts` — table registry across all phases
- `server/storage.ts` — storage interface + implementation
- `server/routes.ts` — route module registrations
- `shared/types/premium.ts` — `TIER_FEATURES` flag table

## See Also

- [Simplicity review for fresh implementation](simplicity-review-fresh-implementation-2026-05-13.md) — sibling process learning from Phases 8-11
