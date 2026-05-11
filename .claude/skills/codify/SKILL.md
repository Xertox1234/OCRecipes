---
name: codify
description: Use at the end of any session to extract and preserve patterns, learnings, and review rules discovered during the session's implementation work
---

You are running the codify workflow. Codify patterns, learnings, and agent rules from the current branch's implementation work. **Never skip steps.**

## Step 1 — Assess the branch diff

Run:

```bash
git diff main...HEAD --stat
```

Build a list of changed file domains using this table (read top-to-bottom, first match per path wins):

| Changed path matches                                 | Domain label(s)           |
| ---------------------------------------------------- | ------------------------- |
| `server/middleware/auth*`, `server/middleware/rate*` | `security`                |
| `server/services/*`, `server/storage/*`              | `architecture`            |
| `server/db/*`                                        | `performance`, `database` |
| `**/*.test.*`, `**/*.spec.*`                         | `testing`                 |
| `client/screens/Scan*`, `client/components/camera/*` | `camera`                  |
| `client/hooks/*`                                     | `hooks`                   |
| `client/stores/*`, `client/contexts/*`               | `client-state`            |
| `server/routes/*`                                    | `api`                     |
| `client/components/*`, `client/screens/*`            | `react-native`            |
| `**/*.ts`, `**/*.tsx`                                | `typescript`              |

Combine all matched labels. If the diff is empty, output "Nothing to codify — no changes on this branch." and stop.

## Step 2 — Map domains to kimi-review patterns

| Domain label(s)                | `--patterns` value |
| ------------------------------ | ------------------ |
| `security`                     | `security`         |
| `architecture`, `duplication`  | `architecture`     |
| `react-native`, `ui`, `camera` | `react-native`     |
| `performance`                  | `performance`      |
| `testing`, `test`              | `testing`          |
| `database`                     | `database`         |
| `api`                          | `api`              |
| `hooks`                        | `hooks`            |
| `typescript`, `types`          | `typescript`       |
| `client-state`                 | `client-state`     |
| _(no match)_                   | _(omit flag)_      |

Combine values for multiple matches, e.g. `--patterns react-native,security`.

## Step 3 — Run kimi-review on the branch diff

```bash
git diff main...HEAD | kimi-review --scope "session: $(git branch --show-current)" --patterns <mapped-patterns>
```

**Store the full output in working context as `review_output`.** Shell variables do not persist between Bash invocations — keep this in your context.

Also check the current conversation for any kimi-review output from earlier in this session. Union both sources for Step 4.

## Step 4 — Apply codification criteria

**Codify if any one is true:**

- The diff contains a workaround or constraint not currently documented in `docs/patterns/`
- The diff reveals a library gotcha or platform-specific behavior
- `review_output` contains a CRITICAL or WARNING finding — even if the fix is already in the diff (a finding that required a repair is exactly the kind of rule worth preserving)

**Skip if all are true:**

- The diff is a straightforward application of existing documented patterns
- All `review_output` findings are SUGGESTION-only
- The only changes are UI text, config values, or copy with no structural lesson

If nothing qualifies, output: "Nothing to codify from this session." and stop.

## Step 5 — Route each candidate

For each codification candidate, determine both targets:

**Pattern target** (reusable implementation rule):

| Primary domain                 | Target file                     |
| ------------------------------ | ------------------------------- |
| `security`                     | `docs/patterns/security.md`     |
| `architecture`, `duplication`  | `docs/patterns/architecture.md` |
| `react-native`, `ui`, `camera` | `docs/patterns/react-native.md` |
| `performance`                  | `docs/patterns/performance.md`  |
| `testing`, `test`              | `docs/patterns/testing.md`      |
| `database`                     | `docs/patterns/database.md`     |
| `api`                          | `docs/patterns/api.md`          |
| `hooks`                        | `docs/patterns/hooks.md`        |
| `typescript`, `types`          | `docs/patterns/typescript.md`   |
| `client-state`                 | `docs/patterns/client-state.md` |
| _(no match)_                   | `docs/LEARNINGS.md`             |

**Agent update target** (self-improvement — only when the finding reveals a reusable review rule):

| Finding domain | Update agent(s)                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Security       | `.claude/agents/security-auditor.md`, `.claude/agents/ai-llm-specialist.md`                                               |
| Performance    | `.claude/agents/performance-specialist.md`, `.claude/agents/database-specialist.md`                                       |
| Data integrity | `.claude/agents/database-specialist.md`, `.claude/agents/nutrition-domain-expert.md`                                      |
| Architecture   | `.claude/agents/architecture-specialist.md`, `.claude/agents/api-specialist.md`                                           |
| Code quality   | `.claude/agents/quality-specialist.md`, `.claude/agents/typescript-specialist.md`, `.claude/agents/testing-specialist.md` |
| Camera/vision  | `.claude/agents/camera-specialist.md`, `.claude/agents/rn-ui-ux-specialist.md`                                            |
| Accessibility  | `.claude/agents/accessibility-specialist.md`, `.claude/agents/rn-ui-ux-specialist.md`                                     |

A single candidate may update both a pattern doc and one or more agents.

## Step 6 — Write additions

Read the target file first. Write each addition directly to the target file — one rule, the rationale, and an example or constraint when useful. Do not duplicate entries already present.

## Step 7 — Commit

Only stage files you actually modified — list them explicitly, not whole directories:

```bash
# Example — substitute the actual files you changed:
git add docs/patterns/security.md docs/LEARNINGS.md .claude/agents/security-auditor.md
git commit -m "docs: codify patterns and learnings from $(git branch --show-current) session"
```

Using `git add docs/patterns/` would stage everything in that directory, including files you didn't touch. Name each file.
