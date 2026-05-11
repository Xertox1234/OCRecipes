# Copilot Pattern Awareness — Design

**Date:** 2026-05-11
**Topic:** Make GitHub Copilot pattern/rule-aware when implementing delegated Issues
**Status:** Draft for user review

## Goal

When `delegate-copilot-issue.ts` creates a GitHub Issue and assigns it to
`@copilot`, Copilot should receive the same imperative rules and pattern
pointers that govern Claude's own work in this repo — scoped to the domains
of the files actually in the Issue's scope. Today Copilot writes code blind:
the Issue body has no link to `docs/patterns/` or `docs/rules/`, so violations
of well-established conventions surface only at PR review time.

## Non-Goals

- Inlining the long-form `docs/patterns/*.md` content (collectively ~970 KB —
  impractical and unnecessary, since the rules files distill them).
- Letting Copilot touch critical/high-priority work. The eligibility filter
  in `scripts/delegate-copilot-issue.ts` already restricts delegation to
  `priority: low` or `labels: [deferred]`; the path-based blocks reject
  auth/IAP/health/secrets/schema/migration paths. This design assumes
  Copilot only sees domains it can legitimately work in.
- Adding new pattern docs. The existing 13-domain split (`docs/rules/` and
  `docs/patterns/`) is the source of truth.
- Cross-repo / multi-project: this is OCRecipes-specific.

## Background

### What exists already

- `docs/patterns/*.md` — 16 long-form pattern files (`react-native.md` is 150 KB,
  `database.md` is 113 KB, `api.md` is 109 KB, etc.). Tracked on git, accessible
  to Copilot from its repo checkout.
- `docs/rules/*.md` — 13 imperative-rule files. Total 112 lines across all
  files. Same domain names as patterns. These are the actionable do/don'ts.
- A write-time hook system (see `2026-05-10-pattern-injection-write-time-design.md`)
  that injects `[RULES — <domain>]` + `[PATTERNS — <domain> (excerpt)]` +
  `[LEARNINGS — matches]` blocks into Claude's Edit-tool pre-write context.
- `delegate-copilot-issue.ts` — generates Issue bodies with Source, Summary,
  Background, Acceptance Criteria, Files In Scope, Implementation Notes,
  Dependencies, Risks, Safety. No pattern/rule injection.
- `CLAUDE.md` (gitignored, local-only) — documents the path → domain mapping
  used for `kimi-review --patterns`.

### Why now

The 2026-05-11 delegation session created 9 GitHub Issues assigned to Copilot
across testing, performance, and CI/code-quality work. None of the Issue bodies
reference `docs/patterns/` or `docs/rules/`. The user surfaced the gap: Copilot
is writing code blind. The infrastructure (rules files, pattern files, path-to-domain
mapping) all exist; the connecting wire to Copilot doesn't.

## Architecture

Three components, each tracked on git so Copilot can see them:

### 1. `.github/copilot-instructions.md` (new, tracked)

GitHub Copilot's canonical instructions file. Loaded automatically into every
Copilot agent invocation in this repo. Contents:

- **One-paragraph stack orientation** — Expo SDK 54, React Native 0.81, React 19,
  TanStack Query v5, Express 5, Drizzle ORM + PostgreSQL, JWT auth, TypeScript.
- **Mandatory workflow** — "When the Issue body contains a `## Project Rules`
  section, every rule is binding. If a rule conflicts with an acceptance
  criterion, raise it in a PR comment rather than silently violating it.
  If the rule isn't clear, open the referenced `docs/patterns/<domain>.md`
  for full context."
- **Path → domain mapping** (the same one CLAUDE.md uses for `kimi-review --patterns`):

  | Path pattern                              | Domains                                                 |
  | ----------------------------------------- | ------------------------------------------------------- |
  | `server/routes/**/*.ts` (non-auth)        | api, security, architecture                             |
  | `server/storage/**/*.ts` (non-auth)       | database, security, architecture                        |
  | `server/services/**/*.ts`                 | architecture (plus domain-specific based on content)    |
  | `client/**/*.tsx`, `client/**/*.ts`       | react-native, design-system, accessibility              |
  | `client/components/**`                    | react-native, design-system, accessibility, performance |
  | `client/screens/**`                       | react-native, design-system, accessibility              |
  | `client/hooks/**`                         | hooks, client-state                                     |
  | `client/context/**`                       | client-state                                            |
  | `client/lib/**`                           | typescript, client-state                                |
  | `evals/**`                                | ai-prompting, testing                                   |
  | `*test*.ts`, `*test*.tsx`, `__tests__/**` | testing                                                 |
  | `.github/workflows/**`                    | architecture, testing                                   |
  | `vitest.config.ts`, `eslint.config.*`     | testing, typescript                                     |

- **Hard exclusions reminder** — even though the eligibility filter already
  rejects these paths, restate them so Copilot knows why a particular
  acceptance criterion shouldn't be expanded into auth/IAP/secrets/health-data/
  schema/migration territory.
- **PR-only, no auto-merge** — reaffirm the safety boilerplate already in
  Issue bodies.

Size budget: ~2–4 KB. GitHub Copilot's instructions file has documented soft
limits (need to verify exact figure before merging, but our target is well
under any plausible cap).

### 2. Auto-injected `## Project Rules` section in Issue body

`delegate-copilot-issue.ts` gains a domain-detection step:

1. Compute `detectedDomains` from `referencedFiles` using the same mapping
   that lives in `.github/copilot-instructions.md` (single source of truth —
   the script reads the mapping from the instructions file at runtime, or
   the mapping is defined once in the script and referenced from the file).
2. For each detected domain, inline the full content of
   `docs/rules/<domain>.md` under a `### <domain>` subheading.
3. List `docs/patterns/<domain>.md` GitHub URLs as further-reading pointers
   under "Further context (read if a rule is unclear):".
4. Insert the whole block between `## Files In Scope` and
   `## Implementation Notes` so it's read before Copilot starts planning
   its changes.

#### Example Issue body fragment

```markdown
## Files In Scope

- client/components/coach/blocks/ActionCard.tsx
- client/components/coach/blocks/QuickReplies.tsx
- (5 more)

## Project Rules

The rules below are binding. If any conflict with the acceptance criteria,
raise it in a PR comment rather than silently violating. Open the linked
pattern file for full context if a rule isn't clear.

### react-native

(inlined content of docs/rules/react-native.md — ~12 lines)

### design-system

(inlined content of docs/rules/design-system.md — ~6 lines)

### accessibility

(inlined content of docs/rules/accessibility.md — ~14 lines)

### performance

(inlined content of docs/rules/performance.md — ~8 lines)

Further context (open the URL if a rule above isn't clear):

- https://github.com/Xertox1234/OCRecipes/blob/main/docs/patterns/react-native.md
- https://github.com/Xertox1234/OCRecipes/blob/main/docs/patterns/design-system.md
- https://github.com/Xertox1234/OCRecipes/blob/main/docs/patterns/accessibility.md
- https://github.com/Xertox1234/OCRecipes/blob/main/docs/patterns/performance.md

## Implementation Notes

...
```

Sizing for a typical 1–3 domain Issue: ~40–60 lines of inlined rules + 1–3
pattern URLs ≈ 1.5–3 KB body growth. Issue #130's current body is ~2 KB; the
post-injection body is ~4–5 KB. Well within GitHub Issue limits.

### 3. Same `## Project Rules` block written into the local todo file

When the script delegates a todo successfully, it also writes the same
`## Project Rules` section back into `todos/YYYY-MM-DD-<slug>.md`, inserted
between `## Files In Scope` and `## Implementation Notes`. Two reasons:

- The todo becomes self-contained — anyone reading the local todo sees the
  same rules Copilot saw, so review can verify against the same context.
- If the Issue is closed/deleted on GitHub, the local todo retains the
  delegation context.

Trade-off: the todo template grows by 1–3 KB per delegation. Acceptable —
todos are local and gitignored, and the growth happens automatically.

## Domain Detection

`detectedDomains(referencedFiles: string[], labels: string[]): string[]`
(new function in `scripts/delegate-copilot-issue.ts`):

1. For each file in `referencedFiles`, match against the path-pattern table
   from `.github/copilot-instructions.md`.
2. Collect all matching domains.
3. Augment from labels: if `labels` contains `testing` (or `test`), force-add
   `testing` even if no `__tests__/` paths matched. Same for `performance` →
   `performance`. Other allowed labels (`code-quality`, `docs`, `refactor`,
   `simple-refactor`) don't correspond to rules files and are skipped.
4. Deduplicate.
5. Always include `typescript` if any `.ts` or `.tsx` file is in scope
   (typescript rules apply to every TS file regardless of domain).

Returns the deduplicated list. Order is stable (alphabetical) so the
injected section is deterministic. The intent signal from labels matters
because `referencedFiles` only captures _files explicitly mentioned in
the body_ — a fixture-update todo or a config-only todo may legitimately
have no domain-matching paths even though the work is clearly testing
or performance flavored.

### Edge cases

- **No domains detected** (e.g., only `*.md` or `.github/workflows/*.yml` in
  scope): inject only `typescript` if applicable; otherwise insert a
  minimal block saying "No domain rules apply to this scope. Follow the
  acceptance criteria and conventional best practice."
- **File spans multiple domains** (e.g., `client/screens/coach/CoachChat.tsx`
  → react-native, design-system, accessibility, performance, AND client-state
  if it imports hooks): take the union, don't pick one. Inlining 4 small
  rules files is still ~50 lines.
- **Missing rule file** (someone deletes `docs/rules/X.md`): the script
  fails fast with a clear error — "rule file docs/rules/X.md is missing
  for detected domain X; either restore the file or remove X from the
  mapping." Never silently skip.

## Hard Exclusions

The path-based blocks added in `93c6a606` already prevent Copilot from
receiving Issues that touch `server/middleware/auth.ts`,
`server/services/receipt-validation.*`, `server/services/healthkit*`,
`server/storage/health.ts`, `shared/schema.ts`, `migrations/`, and JWT
library files. That stays unchanged.

This design adds rules+patterns ONLY for domains Copilot is allowed to work
in. There is no codepath that injects auth/IAP/health-data/secrets/migration
rules into a Copilot Issue, because no Issue can ever reach this codepath
without those file paths being blocked upstream.

The `.github/copilot-instructions.md` should still restate the hard exclusion
list — it's defense in depth, so Copilot knows the boundary even when working
on adjacent code.

## Implementation Plan

1. Create `.github/copilot-instructions.md` with the stack overview, mandatory
   workflow paragraph, path → domain mapping table, and hard exclusions.
2. Add `PATH_TO_DOMAINS` constant in `scripts/delegate-copilot-issue.ts`
   defining the same mapping as the instructions file. (Single source of
   truth question: do we duplicate it, generate one from the other, or
   parse one from the other at runtime? See Open Question 1.)
3. Add `detectedDomains(referencedFiles)` function.
4. Add `buildProjectRulesSection(domains)` that reads
   `docs/rules/<domain>.md` for each detected domain, concatenates with
   subheadings, and appends pattern URLs.
5. Modify `buildIssueBody` to insert the section between Files In Scope and
   Implementation Notes.
6. After successful delegation, also write the same block into the local
   todo file (between the same headings).
7. Tests:
   - `detectedDomains` returns expected domains for each path-pattern row
   - `detectedDomains` returns `["typescript"]` for a `.ts`-only Issue
   - Multi-file Issues return deduplicated union
   - Missing rule file throws clear error
   - `buildProjectRulesSection` produces expected markdown
   - `buildIssueBody` includes the section in the correct position
   - End-to-end: `evaluateEligibility` + `buildIssueBody` for a sample
     RN testing todo includes react-native, testing, typescript rules
8. Verify on a real delegation (dry-run new + redelegate one of the recent
   Issues if convenient).

## Open Questions

### 1. Single source of truth for the path→domain mapping

Two reasonable answers:

- **(a)** Define mapping in the TypeScript script (typed, testable), and
  GENERATE `.github/copilot-instructions.md` from it via a `npm run
build:copilot-instructions` script. The instructions file is then a
  committed artifact, but the script is authoritative.
- **(b)** Define mapping in `.github/copilot-instructions.md` as a parseable
  table, and parse it at script runtime. Instructions file is authoritative.

I recommend (a). The script needs typed access for detection logic, and
Markdown parsing in a TypeScript script is fragile.

### 2. Should LEARNINGS be injected too?

The write-time hook also surfaces `[LEARNINGS — matches for "<title>"]` from
`docs/LEARNINGS.md`. Could be added here as well — a "Known gotchas" section.
LEARNINGS is 30+ KB though, so we'd need keyword/title matching rather than
inlining all of it. **Recommend: defer to v2.** Rules + patterns get us most
of the way; LEARNINGS is a nice-to-have if Copilot still drifts.

### 3. `.github/copilot-instructions.md` size discovery

GitHub's documented soft limit for this file. Before committing the
instructions file, I'll web-fetch GitHub's docs to confirm the cap and
adjust accordingly. Our planned size (~3 KB) is almost certainly safe but
verifying is cheap.

## Acceptance Criteria

- [ ] `.github/copilot-instructions.md` created, committed, contains stack
      overview, mandatory workflow paragraph, path→domain table, hard
      exclusions.
- [ ] `delegate-copilot-issue.ts` injects `## Project Rules` section between
      Files In Scope and Implementation Notes when at least one domain is
      detected.
- [ ] Section content includes inlined `docs/rules/<domain>.md` for each
      detected domain, with `### <domain>` subheadings.
- [ ] Section includes pattern URLs as further-reading pointers.
- [ ] Local todo file is also updated with the same `## Project Rules` section
      after successful delegation.
- [ ] Domain detection includes `typescript` whenever a `.ts`/`.tsx` file is
      in scope.
- [ ] Missing rule file fails the delegation with a clear error (no silent
      skip).
- [ ] Tests cover detection, section building, body insertion, and the
      missing-rule-file failure path.
- [ ] One existing Issue (e.g., #130 or #142) re-receives the rules via a
      manual GitHub comment, as a sanity check that the inlined format is
      readable in the GitHub UI.
- [ ] CLAUDE.md updated to mention `.github/copilot-instructions.md` as the
      Copilot equivalent of the local MUST CHECK gates.

## Out of Scope (deferred to v2)

- LEARNINGS keyword-matched injection.
- Auto-updating Issue bodies on closed Issues when rules files change. Once
  the Issue is filed, its body is a snapshot.
- GitHub Actions workflow that post-comments rule reminders on Copilot PRs.
- Inlining anything from `docs/patterns/*.md` (still pointers only).
