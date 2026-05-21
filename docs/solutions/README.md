# Solutions Documentation

This directory contains documented solutions to problems and codified conventions encountered during development. Each file captures one self-contained piece of knowledge so the team can quickly resolve similar issues or look up project rules in the future.

Solutions are split into two **tracks**, distinguished by the `track:` frontmatter field:

- **Bug track** (`track: bug`) — incidents where code crashed, produced incorrect behavior, or otherwise failed. Captures problem, root cause, and fix.
- **Knowledge track** (`track: knowledge`) — conventions, design patterns, and procedural best-practices that apply pre-emptively. Captures the rule, the reason, and worked examples.

## Categories

### Bug-track

#### [logic-errors/](./logic-errors/)

Issues where code runs but produces incorrect behavior.

- **[stale-closure-callback-refs.md](./logic-errors/stale-closure-callback-refs.md)** — Using refs instead of state for synchronous checks in callbacks
- **[useeffect-cleanup-memory-leak.md](./logic-errors/useeffect-cleanup-memory-leak.md)** — Cleaning up timers and subscriptions on unmount

#### [runtime-errors/](./runtime-errors/)

Issues that cause crashes or exceptions at runtime.

- **[unsafe-type-cast-zod-validation.md](./runtime-errors/unsafe-type-cast-zod-validation.md)** — Validating external data with Zod instead of `as` casts

#### [code-quality/](./code-quality/)

Issues that affect maintainability, DX, or type safety.

- **[react-native-style-typing.md](./code-quality/react-native-style-typing.md)** — Using proper React Native style types

### Knowledge-track

#### [conventions/](./conventions/)

Project rules: "always do X / never do Y." Cover utility-preference, naming, type-discipline, and similar coding conventions specific to this codebase.

#### [design-patterns/](./design-patterns/)

Reusable structural implementation patterns. Cover how to compose components, layouts, and APIs to solve recurring design problems.

#### [best-practices/](./best-practices/)

Procedural checklists and workflow reminders. Trigger on a specific kind of change (e.g., a rebrand, a schema migration) and tell you what to re-verify.

## Manifests

Decomposition manifests live under [`_manifests/`](./_manifests/) (prefixed `_` so glob walks over category directories skip them). Each manifest records the extracted / merged / pruned outcome for one source pattern file or LEARNINGS.md migration batch.

## Finding Solutions

### By Symptom (bug-track)

| Symptom                                                           | Solution                                                                                                                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate callbacks firing                                        | [stale-closure-callback-refs.md](./logic-errors/stale-closure-callback-refs.md)                                                                                 |
| UI render branch always shows the fallback / data never appears   | [dead-ui-branch-from-duplicated-context-types-2026-05-16.md](./logic-errors/dead-ui-branch-from-duplicated-context-types-2026-05-16.md)                         |
| "Can't perform state update on unmounted component"               | [useeffect-cleanup-memory-leak.md](./logic-errors/useeffect-cleanup-memory-leak.md)                                                                             |
| Loading spinner stuck forever after the screen regains focus      | [abort-on-blur-strands-loading-state-2026-05-20.md](./logic-errors/abort-on-blur-strands-loading-state-2026-05-20.md)                                           |
| Dairy-free / gluten-free recipes wrongly flagged or over-excluded | [allergen-keyword-matcher-plant-substitute-false-positive-2026-05-20.md](./logic-errors/allergen-keyword-matcher-plant-substitute-false-positive-2026-05-20.md) |
| Runtime type errors from database                                 | [unsafe-type-cast-zod-validation.md](./runtime-errors/unsafe-type-cast-zod-validation.md)                                                                       |
| No style autocomplete                                             | [react-native-style-typing.md](./code-quality/react-native-style-typing.md)                                                                                     |

### By Tag

- **react**: stale-closure-callback-refs, useeffect-cleanup-memory-leak
- **hooks**: stale-closure-callback-refs, useeffect-cleanup-memory-leak
- **typescript**: unsafe-type-cast-zod-validation, react-native-style-typing
- **zod**: unsafe-type-cast-zod-validation

## YAML Frontmatter Schema

Each solution file uses YAML frontmatter for searchability:

```yaml
---
title: "Human-readable title"
track: bug | knowledge # discriminator — see field table below
category: <one value from category list> # see field table for valid values per track
tags: [tag1, tag2, tag3]
module: camera | server | client | shared
applies_to: ["client/**/*.tsx", "..."] # optional — glob patterns where this binds (hook routing)
symptoms: # required for track:bug, optional for track:knowledge
  - "Symptom 1"
  - "Symptom 2"
created: YYYY-MM-DD
last_updated: YYYY-MM-DD # optional — set on merge updates
severity: low | medium | high | critical # required for track:bug, optional for track:knowledge
---
```

### Field requirements by track

| Field          | bug-track                                                                 | knowledge-track                                      |
| -------------- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| `title`        | required                                                                  | required                                             |
| `track`        | required (`bug`)                                                          | required (`knowledge`)                               |
| `category`     | `logic-errors` / `runtime-errors` / `code-quality` / `performance-issues` | `conventions` / `design-patterns` / `best-practices` |
| `tags`         | required                                                                  | required                                             |
| `module`       | required                                                                  | required                                             |
| `applies_to`   | optional                                                                  | optional — captured for the Phase 3 hook             |
| `symptoms`     | required                                                                  | optional — "smell patterns" if present               |
| `created`      | required                                                                  | required                                             |
| `last_updated` | optional                                                                  | optional                                             |
| `severity`     | required                                                                  | optional                                             |

The `applies_to` field is forward-looking: it will eventually let the pattern-injection hook scope retrieval to files matching the glob. Capture it now so the eventual hook rewrite doesn't need a backfill pass.

## Body Template

Both tracks share the same file shape; section headings adapt to the content:

| Section             | bug-track heading  | knowledge-track heading             |
| ------------------- | ------------------ | ----------------------------------- |
| H1 title            | `# <title>`        | `# <title>`                         |
| Statement           | `## Problem`       | `## Rule` or `## When this applies` |
| Symptoms / triggers | `## Symptoms`      | `## Smell patterns` (optional)      |
| Explanation         | `## Root Cause`    | `## Why`                            |
| Resolution          | `## Solution`      | `## Examples`                       |
| Edge cases          | (n/a)              | `## Exceptions`                     |
| Prevention          | `## Prevention`    | (subsumed into Why / Exceptions)    |
| Cross-refs          | `## Related Files` | `## Related Files`                  |
| External links      | `## See Also`      | `## See Also`                       |

## Contributing

When documenting a new solution:

1. Decide on track: did something break (`bug`), or is this a rule/pattern you want consistent going forward (`knowledge`)?
2. Choose the appropriate category directory.
3. Use the filename format: `<slug>-<YYYY-MM-DD>.md` for new files (existing pre-2026-05-12 files have no date suffix; backfill is not required).
4. Include YAML frontmatter with all required fields for the track.
5. Document the body per the template above.
6. Link to related files and external resources.
7. Update this README with the new solution if it adds a new symptom or tag worth indexing.

## Related Documentation

- [PATTERNS.md](../PATTERNS.md) — Established patterns to follow
- [LEARNINGS.md](../LEARNINGS.md) — Lessons learned from the codebase
- [research/pattern-codification-alternatives.md](../research/pattern-codification-alternatives.md) — The plan this directory implements
