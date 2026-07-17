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
- **[native-stack-back-dispatches-pop-not-goback-2026-07-07.md](./logic-errors/native-stack-back-dispatches-pop-not-goback-2026-07-07.md)** — native-stack's back button/gesture dispatch POP, not GO_BACK
- **[beforeremove-preventdefault-desyncs-native-stack-2026-07-07.md](./logic-errors/beforeremove-preventdefault-desyncs-native-stack-2026-07-07.md)** — Hand-rolled beforeRemove + preventDefault() desyncs native-stack from JS state; use usePreventRemove
- **[always-armed-preventremove-early-return-skips-redirect-2026-07-07.md](./logic-errors/always-armed-preventremove-early-return-skips-redirect-2026-07-07.md)** — Every early-return branch in a multi-concern beforeRemove handler must reapply the same redirect condition
- **[git-diff-invisible-to-untracked-files-2026-07-15.md](./logic-errors/git-diff-invisible-to-untracked-files-2026-07-15.md)** — `git diff` structurally cannot show wholly untracked files; scoping mid-pipeline verification off it alone silently misses new files
- **[guard-script-field-quote-strip-fail-closed-2026-07-16.md](./logic-errors/guard-script-field-quote-strip-fail-closed-2026-07-16.md)** — a bash guard script must strip quotes AND fail-closed on unrecognized values for EVERY gated field, not just the one you tested
- **[nested-worktree-defeats-isolation-guard-path-math-2026-07-15.md](./logic-errors/nested-worktree-defeats-isolation-guard-path-math-2026-07-15.md)** — Creating a worktree nested inside another worktree confuses guard-worktree-isolation.sh's main-checkout path arithmetic

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
| beforeRemove back-button interception never fires on device        | [native-stack-back-dispatches-pop-not-goback-2026-07-07.md](./logic-errors/native-stack-back-dispatches-pop-not-goback-2026-07-07.md)                          |
| "[Screen] was removed natively but didn't get removed from JS state" | [beforeremove-preventdefault-desyncs-native-stack-2026-07-07.md](./logic-errors/beforeremove-preventdefault-desyncs-native-stack-2026-07-07.md)                |
| Redirect works for back-button but not after a successful save     | [always-armed-preventremove-early-return-skips-redirect-2026-07-07.md](./logic-errors/always-armed-preventremove-early-return-skips-redirect-2026-07-07.md)    |
| A cached/persisted row's serving-size label and its calorie/macro values imply different serving amounts | [persisted-label-desyncs-from-its-scaled-companion-values-2026-07-16.md](./logic-errors/persisted-label-desyncs-from-its-scaled-companion-values-2026-07-16.md) |

### By Tag

- **react**: stale-closure-callback-refs, useeffect-cleanup-memory-leak
- **hooks**: stale-closure-callback-refs, useeffect-cleanup-memory-leak, native-stack-back-dispatches-pop-not-goback-2026-07-07, beforeremove-preventdefault-desyncs-native-stack-2026-07-07, always-armed-preventremove-early-return-skips-redirect-2026-07-07
- **typescript**: unsafe-type-cast-zod-validation, react-native-style-typing
- **zod**: unsafe-type-cast-zod-validation
- **react-navigation**: native-stack-back-dispatches-pop-not-goback-2026-07-07, beforeremove-preventdefault-desyncs-native-stack-2026-07-07, always-armed-preventremove-early-return-skips-redirect-2026-07-07
- **worktree**: adhoc-worktree-missing-node-modules-symlink-2026-07-06, nested-worktree-defeats-isolation-guard-path-math-2026-07-15
- **bash / orchestrator**: orchestrator-phase-variables-dont-persist-across-bash-calls-2026-07-15, backgrounded-piped-command-exit-code-unreliable-2026-07-15, subagent-verification-must-run-synchronously-2026-07-06

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
symptoms: [Symptom 1, Symptom 2] # required for track:bug, optional for track:knowledge
created: YYYY-MM-DD
last_updated: YYYY-MM-DD # optional — set on merge updates
severity: low | medium | high | critical # required for track:bug, optional for track:knowledge
---
```

**Format invariant (load-bearing):** every frontmatter array (`tags`, `applies_to`, `symptoms`) must be a **single-line inline-flow** array (`[a, b, c]`). Retrieval is line-anchored — `inject-patterns.sh` greps `^tags:` and `session-recent-issues.sh` parses frontmatter line-by-line — so a wrapped array makes the file silently invisible to pattern injection. `docs/solutions/` is in `.prettierignore` so Prettier can't re-wrap arrays, and `scripts/check-solution-frontmatter.js` (lint-staged) enforces this plus the required fields at commit time. In body examples, never put a `tags:`/`applies_to:` line at column 0 — indent quoted frontmatter by one space so the inject grep can't mistake it for the real thing.

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

The `applies_to` field is live in the pattern-injection hook: solutions whose globs match the file being edited are promoted ahead of the date-ordered rest of their domain's matches.

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
