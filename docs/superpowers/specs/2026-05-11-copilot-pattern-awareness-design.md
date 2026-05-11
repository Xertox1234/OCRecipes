# Copilot Pattern Awareness — Design

**Date:** 2026-05-11
**Topic:** Make GitHub Copilot pattern/rule-aware when implementing delegated Issues
**Status:** Reviewed; awaiting final approval before implementation plan

## Revision history

- 2026-05-11 (v1): initial draft.
- 2026-05-11 (v2): incorporated review feedback — todo-file insertion anchor
  changed from a non-existent `## Files In Scope` heading to a real anchor
  priority chain; `server/services/**` mapping split into base + LLM-touching
  enumeration; back-fill mechanism made explicit (`gh issue comment`);
  Open Questions 1 & 3 resolved (TS authoritative + CI drift check;
  8 KT cap); CLAUDE.md AC clarified as a local-only note; domain detection
  scoping documented.

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

  | Path pattern                                                                                                       | Domains                                                 |
  | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
  | `server/routes/**/*.ts` (non-auth)                                                                                 | api, security, architecture                             |
  | `server/storage/**/*.ts` (non-auth)                                                                                | database, security, architecture                        |
  | `server/services/**/*.ts`                                                                                          | architecture                                            |
  | `server/services/{coach-,nutrition-coach,recipe-chat,recipe-generation,photo-analysis,menu-,receipt-analysis}*.ts` | architecture, ai-prompting (LLM-touching services)      |
  | `client/**/*.tsx`, `client/**/*.ts`                                                                                | react-native, design-system, accessibility              |
  | `client/components/**`                                                                                             | react-native, design-system, accessibility, performance |
  | `client/screens/**`                                                                                                | react-native, design-system, accessibility              |
  | `client/hooks/**`                                                                                                  | hooks, client-state                                     |
  | `client/context/**`                                                                                                | client-state                                            |
  | `client/lib/**`                                                                                                    | typescript, client-state                                |
  | `evals/**`                                                                                                         | ai-prompting, testing                                   |
  | `*test*.ts`, `*test*.tsx`, `__tests__/**`                                                                          | testing                                                 |
  | `.github/workflows/**`                                                                                             | architecture, testing                                   |
  | `vitest.config.ts`, `eslint.config.*`                                                                              | testing, typescript                                     |

- **Hard exclusions reminder** — even though the eligibility filter already
  rejects these paths, restate them so Copilot knows why a particular
  acceptance criterion shouldn't be expanded into auth/IAP/secrets/health-data/
  schema/migration territory.
- **PR-only, no auto-merge** — reaffirm the safety boilerplate already in
  Issue bodies.

Size budget: ~2–4 KB. GitHub's documented soft limit for repo-level Copilot
custom instructions is 8,000 tokens (~32 KB), so our target has comfortable
headroom (see Resolved Decision 3).

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
`## Project Rules` section back into `todos/YYYY-MM-DD-<slug>.md`. The
insertion is done by anchor, in this priority order:

1. If the todo has a `## Updates` heading, insert immediately **before** it.
2. Else if the todo has a `## Risks` heading, insert immediately **after** it.
3. Else if the todo has a `## Dependencies` heading, insert immediately **after** it.
4. Else if the todo has a `## Implementation Notes` heading, insert immediately **after** it (and after any content that follows it, up to EOF or the next `## ` heading).
5. Else append at end of file.

Note: real todos do NOT have a `## Files In Scope` heading — file paths
live as plain text inside `## Implementation Notes` (typically as a
`Files in scope:` sub-block). The anchor above respects that. The Issue
body, by contrast, DOES have a `## Files In Scope` heading because
`buildIssueBody` generates it from `referencedFiles` — that's where the
between-Files-In-Scope-and-Implementation-Notes insertion in §2 applies.

Two reasons to write the section back into the local todo:

- The todo becomes self-contained — anyone reading the local todo sees the
  same rules Copilot saw, so review can verify against the same context.
- If the Issue is closed/deleted on GitHub, the local todo retains the
  delegation context.

If no insertion anchor matches and the todo is malformed (no recognized
top-level sections), fall back to appending at EOF with a leading
blank line. The script does NOT abort on this case — losing the rules
back-fill is preferable to refusing to delegate.

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

**Scoping note:** `referencedFiles` is extracted from
`scopedText = [acceptanceSection, implementationNotes].join("\n\n")` only —
file paths mentioned in `## Background`, `## Summary`, etc. are deliberately
excluded. This matches the existing eligibility check's scope; domain
detection inherits the same boundary. If a todo author needs a file to
contribute to domain detection, it must appear in Acceptance Criteria or
Implementation Notes.

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

1. Define `PATH_TO_DOMAINS` constant in `scripts/delegate-copilot-issue.ts`
   as the authoritative mapping (see Resolved Decision 1). Add unit tests
   for each row.
2. Add `npm run build:copilot-instructions` script that reads
   `PATH_TO_DOMAINS` and writes `.github/copilot-instructions.md` with the
   stack overview, mandatory workflow paragraph, generated mapping table,
   and hard exclusions reminder.
3. Run the script once and commit the generated `.github/copilot-instructions.md`
   as a real file (not gitignored generated artifact).
4. Add a CI check (e.g., in `.github/workflows/ci.yml`) that runs
   `npm run build:copilot-instructions -- --check` and fails if the
   committed file differs from what the script would generate. Pattern
   matches how generated type files are typically validated.
5. Add `detectedDomains(referencedFiles, labels)` function.
6. Add `buildProjectRulesSection(domains)` that reads
   `docs/rules/<domain>.md` for each detected domain, concatenates with
   `### <domain>` subheadings, and appends pattern URLs.
7. Modify `buildIssueBody` to insert the section between `## Files In Scope`
   and `## Implementation Notes` in the generated Issue body.
8. Add `writeProjectRulesSectionToTodo(todoPath, section)` that inserts
   the same block into the local todo file using the anchor priority
   defined in Architecture §3 (before `## Updates` → after `## Risks` →
   after `## Dependencies` → after `## Implementation Notes` body → EOF
   append).
9. Add an `--update-existing-issue <issueId>` flag (or a separate
   `npm run copilot:backfill -- <issueId> <todoPath>`) that posts a
   `gh issue comment <issueId> --body "<rules-section>"` for an Issue
   created before this design landed. Documented as a manual back-fill
   path, not auto-invoked. **Minimum viable**: just document the
   `gh issue comment` invocation in the AC and don't add a script flag
   in v1.
10. Tests:
    - `detectedDomains` returns expected domains for each path-pattern row
    - `detectedDomains` returns `["typescript"]` for a `.ts`-only Issue
    - `detectedDomains` adds `testing` from a `[testing]` label even with no test files in scope
    - Multi-file Issues return deduplicated union
    - Missing rule file throws clear error (no silent skip)
    - `buildProjectRulesSection` produces expected markdown
    - `buildIssueBody` includes the section in the correct position
    - `writeProjectRulesSectionToTodo` inserts at correct anchor for each
      of the 5 anchor cases (Updates / Risks / Dependencies / Impl Notes / EOF)
    - End-to-end: `evaluateEligibility` + `buildIssueBody` for a sample
      RN testing todo includes react-native, testing, typescript rules
    - `build:copilot-instructions --check` exits non-zero when the committed
      file diverges from the generated content
11. Verify on a real delegation (delegate a fresh todo, inspect the
    resulting Issue body in the GitHub UI).
12. Back-fill the 9 Issues from the 2026-05-11 session via
    `gh issue comment` — one per Issue, posting the rules block as a
    new comment so Copilot picks it up on its next read of the Issue
    thread.

## Resolved Decisions

### 1. Single source of truth for the path→domain mapping → **TypeScript authoritative**

Define mapping in `scripts/delegate-copilot-issue.ts` (typed, testable).
Generate `.github/copilot-instructions.md` from it via
`npm run build:copilot-instructions`. The instructions file IS committed as
a real tracked file (not a gitignored generated artifact) so Copilot can
read it from a fresh clone. CI verifies the committed file matches what
the script would generate (`--check` flag fails on drift), so the two
never silently diverge. Rationale: the script needs typed access for
detection logic, Markdown parsing is fragile, and CI drift-detection is
a small one-time investment.

### 3. `.github/copilot-instructions.md` size cap → **8,000 tokens (~32 KB)**

GitHub's documented soft limit for repo-level Copilot custom instructions
is 8,000 tokens (approximately 32 KB). Our planned ~3 KB is safely under,
with comfortable headroom for future expansion.

## Open Questions

### 2. Should LEARNINGS be injected too? → **Defer to v2**

The write-time hook also surfaces `[LEARNINGS — matches for "<title>"]` from
`docs/LEARNINGS.md`. Could be added here as well — a "Known gotchas" section.
LEARNINGS is 30+ KB though, so we'd need keyword/title matching rather than
inlining all of it. Rules + patterns get us most of the way; LEARNINGS is a
nice-to-have if Copilot still drifts. Will revisit if v1 quality is
insufficient.

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
      after successful delegation, using the anchor priority defined in
      Architecture §3 (before `## Updates` → after `## Risks` → after
      `## Dependencies` → after `## Implementation Notes` body → EOF append).
- [ ] Domain detection includes `typescript` whenever a `.ts`/`.tsx` file is
      in scope.
- [ ] Domain detection augments domains from intent labels (`testing` /
      `test` → testing; `performance` → performance) even when no
      domain-matching paths are referenced.
- [ ] `server/services/**` mapping is split into a base rule (architecture only)
      and an explicit LLM-touching enumeration (`coach-*`, `nutrition-coach*`,
      `recipe-chat`, `recipe-generation`, `photo-analysis`, `menu-*`,
      `receipt-analysis`) that adds `ai-prompting`. No content-based detection.
- [ ] Missing rule file fails the delegation with a clear error (no silent
      skip).
- [ ] Tests cover detection, section building, body insertion, the
      missing-rule-file failure path, and all 5 todo-file anchor cases.
- [ ] `npm run build:copilot-instructions` generates a `.github/copilot-instructions.md`
      that compiles from `PATH_TO_DOMAINS`; CI runs the same command with
      `--check` and fails on drift.
- [ ] All 9 Issues from the 2026-05-11 session (#130, #132, #134, #136, #137,
      #139, #142, #144, #146) back-filled via `gh issue comment <id> --body-file <rules>.md`,
      one per Issue. Documented in the spec as the canonical back-fill
      mechanism for now; no `--update-existing-issue` script flag added in v1.
- [ ] CLAUDE.md updated to mention `.github/copilot-instructions.md` as the
      Copilot equivalent of the local MUST CHECK gates. (CLAUDE.md is
      gitignored — this is a local note for Claude's awareness, not a
      tracked-file change. Copilot reads `.github/copilot-instructions.md`
      directly.)

## Out of Scope (deferred to v2)

- LEARNINGS keyword-matched injection.
- Auto-updating Issue bodies on closed Issues when rules files change. Once
  the Issue is filed, its body is a snapshot.
- GitHub Actions workflow that post-comments rule reminders on Copilot PRs.
- Inlining anything from `docs/patterns/*.md` (still pointers only).
