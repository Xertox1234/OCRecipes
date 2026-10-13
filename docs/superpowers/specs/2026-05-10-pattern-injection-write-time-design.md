# Write-Time Pattern Injection Design

**Date:** 2026-05-10
**Status:** approved

## Problem

Patterns, rules, and learnings are collected through audits and codification but ignored during implementation. Claude writes code that violates them, kimi-review catches the violation at commit, the fix gets codified — and the cycle repeats. The feedback loop closes too late.

## Goal

Surface relevant patterns, rules, and project-specific gotchas to Claude _before_ code is written, not after it is reviewed.

## Architecture

Five components that work together across the full implementation lifecycle:

```
Design → Plan → Write → Commit
   ↑        ↑      ↑        ↑
brainstorm todo  PreTool  kimi-review
(existing) (exists) hook   (existing)
              +3b   (NEW)
```

1. **PreToolUse hook** — injects rules + pattern excerpts + learnings before every Edit/Write
2. **todo-executor Step 3b** — supplements label-based pattern lookup with file-path detection
3. **`docs/rules/`** — per-domain markdown rule files seeded from audit history
4. **Codification pipeline update** — automatically grows rules from CRITICAL/HIGH findings
5. **Initial seeding** — mines CHANGELOG.md + audit manifests + LEARNINGS.md on day one

---

## Component 1: PreToolUse Hook

**Location:** `.claude/hooks/inject-patterns.sh` (called from project `.claude/settings.json`)

**Trigger:** `PreToolUse` on `Edit` and `Write` tool calls.

**Behaviour:**

1. Extract `file_path` from tool input (stdin JSON)
2. Map path → domains using the table below
3. For each matched domain: read `docs/rules/{domain}.md` (full) + first 80 lines of `docs/patterns/{domain}.md`
4. Grep `docs/LEARNINGS.md` for the file's basename (first 20 matching lines)
5. Inject as `additionalContext` in hook output — always exits 0 (never blocks)

**Domain mapping:**

| File path pattern                                                                                                                                              | Domains                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `server/routes/*`                                                                                                                                              | api, security, architecture                |
| `server/storage/*`, `shared/schema.ts`, `migrations/*`                                                                                                         | database, security, architecture           |
| `server/middleware/*`                                                                                                                                          | security, api                              |
| `server/services/photo-analysis.ts`, `server/services/nutrition-coach.ts`, `server/services/recipe-chat.ts`, `server/services/recipe-generation.ts`, `evals/*` | ai-prompting, security                     |
| `server/services/*`                                                                                                                                            | architecture                               |
| `client/screens/*`, `client/components/*`                                                                                                                      | react-native, design-system, accessibility |
| `client/navigation/*`                                                                                                                                          | react-native, accessibility                |
| `client/hooks/*`                                                                                                                                               | hooks, client-state, react-native          |
| `client/context/*`, `client/lib/*`                                                                                                                             | client-state                               |
| `client/constants/theme.ts`, `design_guidelines.md`                                                                                                            | design-system                              |
| `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`, `*/__tests__/*`                                                                                          | testing                                    |
| `*.ts`, `*.tsx`                                                                                                                                                | typescript (always added)                  |

**Output format injected into context:**

```
=== Pre-write context for {file_path} ===

[RULES — {domain}]
{full contents of docs/rules/{domain}.md}

[PATTERNS — {domain} (excerpt)]
{first 80 lines of docs/patterns/{domain}.md}

[LEARNINGS — matches for "{basename}"]
{grep matches from docs/LEARNINGS.md, or "(none)" if no matches}
```

**Graceful degradation:** if `docs/rules/` or `docs/patterns/` don't exist, or a specific file is missing, skip silently and continue. Never block an edit.

---

## Component 2: todo-executor Step 3b

**Location:** `.claude/agents/todo-executor.md` — added as sub-step after existing Step 3 researcher/fallback.

**Text to add:**

> **3b — File-path pattern + rules supplement:** Apply the domain mapping from the PreToolUse hook (see docs/superpowers/specs/2026-05-10-pattern-injection-write-time-design.md) to the source file paths extracted in Step 3. Read `docs/rules/{domain}.md` (full) and first 80 lines of `docs/patterns/{domain}.md` for any domain not already covered by the label-based lookup. This ensures correct patterns are loaded even when todo labels are incomplete or missing.

This is additive — it does not replace the existing label-based lookup, it supplements it.

---

## Component 3: `docs/rules/` Directory

**Structure:** one markdown file per domain, matching `docs/patterns/` names.

```
docs/rules/
  database.md
  security.md
  api.md
  react-native.md
  accessibility.md
  typescript.md
  hooks.md
  client-state.md
  architecture.md
  performance.md
  design-system.md
  testing.md
  ai-prompting.md
```

**Format:** short imperative bullet list, no prose, no explanation. One rule per line.

```markdown
# {Domain} Rules

- Never do X
- Always do Y when Z
- Use A not B (reason in one clause maximum)
```

**Rule criteria:** a finding becomes a rule if:

- It is "never do X" class (not a preference or style choice)
- It can be stated in one bullet
- Severity was CRITICAL or HIGH

**Initial seeding sources:**

- `docs/audits/CHANGELOG.md` — recurring CRITICAL/HIGH findings across multiple audits
- Individual audit manifests in `docs/audits/` — any finding marked CRITICAL
- `docs/LEARNINGS.md` — entries that map cleanly to a prohibition
- `memory/MEMORY.md` — project gotchas already captured (withOpacity source, Alert.prompt iOS-only, aria-invalid, nav type casting, etc.)

---

## Component 4: Codification Pipeline Updates

Both codification paths gain a new routing target: `docs/rules/{domain}.md`.

**audit Phase 8** — add after pattern/learning update:

> Evaluate whether the finding warrants a `docs/rules/{domain}.md` entry. Criteria: CRITICAL or HIGH severity, "never do X" class, stateable in one bullet. If all three — append bullet to matching rules file and include in the codification commit.

**todo-executor Step 9** — add after `kimi-write` updates pattern file:

> Same evaluation. If rule entry warranted, append to `docs/rules/{domain}.md` and include in the codification commit.

**Domain routing** for rules files mirrors patterns routing (same label → file mapping already in todo-executor Step 9).

---

## What Is Not Changing

- Pre-commit kimi-review hook — unchanged, remains the last gate before commit
- Pattern docs (`docs/patterns/*.md`) — format and content unchanged; rules are a separate layer
- Audit skill — only Phase 8 gains a new routing target
- Brainstorming and todo skill pattern injection (separate improvement to those skills) — unchanged; this design complements that work at the write-time layer

---

## Success Criteria

- Patterns, rules, and relevant learnings appear in Claude's context before every Edit/Write on a matched file path
- todo-executor loads file-path-matched patterns even when todo labels are incomplete
- `docs/rules/` is seeded with rules from audit history before the hook goes live
- Rules grow automatically from CRITICAL/HIGH audit and todo findings without manual curation
- No measurable increase in false-positive kimi-review findings (rules injection catches issues earlier, not creates new ones)
