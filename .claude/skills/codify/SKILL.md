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

| Changed path matches                                                                                                                                | Domain label(s)                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `server/middleware/auth*`, `server/middleware/rate*`                                                                                                | `security`                             |
| `server/routes/*`                                                                                                                                   | `api`, `security`, `architecture`      |
| `server/storage/*`, `shared/schema.ts`, `migrations/*`                                                                                              | `database`, `security`, `architecture` |
| `server/services/photo-analysis.ts`, `server/services/nutrition-coach.ts`, `server/services/recipe-chat.ts`, `server/services/recipe-generation.ts` | `architecture`, `ai-prompting`         |
| `server/services/*`                                                                                                                                 | `architecture`                         |
| `server/db/*`                                                                                                                                       | `performance`, `database`              |
| `**/*.test.*`, `**/*.spec.*`                                                                                                                        | `testing`                              |
| `client/screens/Scan*`, `client/components/camera/*`                                                                                                | `camera`                               |
| `client/hooks/*`                                                                                                                                    | `hooks`                                |
| `client/stores/*`, `client/context/*`                                                                                                               | `client-state`                         |
| `client/components/*`, `client/screens/*`                                                                                                           | `react-native`                         |
| `**/*.ts`, `**/*.tsx`                                                                                                                               | `typescript`                           |

Combine all matched labels. If the diff is empty, output "Nothing to codify — no changes on this branch." and stop.

## Step 2 — Map domains to specialist review agents

The domain labels from Step 1 carry forward to two places: they tell the code-reviewer subagent (Step 3) which lenses matter most, and they drive the self-improvement routing in Step 5 (which specialist agents get a new review rule). Map each label to its specialist agent(s):

| Domain label(s)                | Specialist agent(s) (self-improvement target)           |
| ------------------------------ | ------------------------------------------------------- |
| `security`                     | `security-auditor.md`, `ai-llm-specialist.md`           |
| `architecture`, `duplication`  | `architecture-specialist.md`, `api-specialist.md`       |
| `react-native`, `ui`, `camera` | `rn-ui-ux-specialist.md`, `camera-specialist.md`        |
| `performance`                  | `performance-specialist.md`, `database-specialist.md`   |
| `testing`, `test`              | `testing-specialist.md`                                 |
| `database`                     | `database-specialist.md`, `nutrition-domain-expert.md`  |
| `api`                          | `api-specialist.md`                                     |
| `hooks`                        | `rn-ui-ux-specialist.md`                                |
| `typescript`, `types`          | `typescript-specialist.md`                              |
| `client-state`                 | `rn-ui-ux-specialist.md`                                |
| `accessibility`                | `accessibility-specialist.md`, `rn-ui-ux-specialist.md` |
| _(no match)_                   | `code-reviewer.md` only                                 |

Combine targets for multiple matched domains. A finding in a touched domain that reveals a reusable review rule updates both `code-reviewer.md` and the matching specialist agent(s) (see Step 5).

## Step 3 — Review the branch diff (orchestrator-dispatched, domain-selected)

Review uses the model in `docs/AI_WORKFLOW.md` → Review Policy. You are the orchestrator.

**First, reuse existing review signal.** If reviewers already ran earlier in this session (e.g. the todo-executor's Step 6, or a manual review), their findings are your `review_output` — do not re-review. Skip the dispatch below and go to Step 4.

Otherwise, confirm there is a diff to review:

```bash
git diff main...HEAD --stat
```

If the diff is empty, set `review_output=""` and proceed to Step 4. Otherwise:

1. You already have the touched **domain labels** from Step 1 and their **specialist agents** from the Step 2 mapping. Select the relevant reviewer subagents for the branch — typically **2–4** (a branch usually spans more domains than a single todo). Use content as well as paths (a JWT/ownership change → `security-auditor` even if Step 1 didn't tag it). If no specific domain dominates, fall back to the `code-reviewer` generalist.
2. **Dispatch the selected reviewers in parallel** (one Agent call each, in a single message), using the Review-Policy dispatch prompt with `git diff main...HEAD` as the diff command and the branch name as the context label. **Working-tree safety:** capture `WORKTREE=$(git rev-parse --show-toplevel)` + the current branch/HEAD in your own cwd and require each reviewer to use `git -C "$WORKTREE"` (not `cd`) + a tree check at the start of its prompt (per Review Policy → "Working-tree safety") — a reviewer must be on this branch in this tree or it diffs the wrong `main...HEAD`. Each reviews ONLY the branch changes through its lens and returns `[CRITICAL]/[WARNING]/[SUGGESTION] file:line — description`, or `No findings`.
3. **Merge** all reviewers' findings (dedupe overlaps), noting which agent reported each.

**Store the merged findings in working context as `review_output`.** Shell variables do not persist between Bash invocations — keep this in your context.

Also check the current conversation for any reviewer findings from earlier in this session. Union both sources for Step 4.

## Step 4 — Apply codification criteria

**Codify if any one is true:**

- The diff contains a workaround or constraint not currently documented in `docs/legacy-patterns/`
- The diff reveals a library gotcha or platform-specific behavior
- `review_output` contains a CRITICAL or WARNING finding — even if the fix is already in the diff (a finding that required a repair is exactly the kind of rule worth preserving)

**Skip if all are true:**

- The diff is a straightforward application of existing documented patterns
- All `review_output` findings are SUGGESTION-only
- The only changes are UI text, config values, or copy with no structural lesson

If nothing qualifies, output: "Nothing to codify from this session." and stop.

## Step 5 — Route each candidate

For each codification candidate, classify by **nature of the finding**, not by review tier — a `CRITICAL` can be a knowledge-track convention; a `WARNING` can be a runtime-errors crash. Pick exactly one **solution target** from the 7-way table below.

**Solution target** — directory under `docs/solutions/`:

| Finding nature                                                        | Track       | Destination dir       |
| --------------------------------------------------------------------- | ----------- | --------------------- |
| Crash / uncaught exception / throws                                   | `bug`       | `runtime-errors/`     |
| Wrong behavior, no crash (off-by-one, race, stale-state, etc.)        | `bug`       | `logic-errors/`       |
| Type-safety / DX / maintainability smell (no behavior bug)            | `bug`       | `code-quality/`       |
| Speed / memory / N+1 / wasted work                                    | `bug`       | `performance-issues/` |
| "Always do X / never do Y" project rule                               | `knowledge` | `conventions/`        |
| Reusable structural pattern (composable code shape)                   | `knowledge` | `design-patterns/`    |
| Procedural checklist triggered by an event (migration, rebrand, etc.) | `knowledge` | `best-practices/`     |

**Tie-break — apply in this order if a finding fits multiple rows:**

1. If the finding documents a fix to a defect that was in the diff → **bug-track** (the user needs the symptom + root-cause + fix shape).
2. If the finding documents a rule the diff complied with, or a pattern the diff exemplifies → **knowledge-track** (the user needs the rule + why + examples shape).
3. Within bug-track, prefer the more specific category (`runtime-errors` > `logic-errors` > `code-quality`). A crash is also a logic error, but `runtime-errors` is the more useful surface for retrieval.

**Agent update target** (self-improvement — only when the finding reveals a reusable review rule). A single candidate may update both a solution file and one or more agents.

| Finding domain | Update agent(s)                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Security       | `.claude/agents/security-auditor.md`, `.claude/agents/ai-llm-specialist.md`                                               |
| Performance    | `.claude/agents/performance-specialist.md`, `.claude/agents/database-specialist.md`                                       |
| Data integrity | `.claude/agents/database-specialist.md`, `.claude/agents/nutrition-domain-expert.md`                                      |
| Architecture   | `.claude/agents/architecture-specialist.md`, `.claude/agents/api-specialist.md`                                           |
| Code quality   | `.claude/agents/quality-specialist.md`, `.claude/agents/typescript-specialist.md`, `.claude/agents/testing-specialist.md` |
| Camera/vision  | `.claude/agents/camera-specialist.md`, `.claude/agents/rn-ui-ux-specialist.md`                                            |
| Accessibility  | `.claude/agents/accessibility-specialist.md`, `.claude/agents/rn-ui-ux-specialist.md`                                     |

## Step 6 — Overlap-check, then write one file per finding

Write one file per finding at `docs/solutions/<category>/<slug>-<YYYY-MM-DD>.md`. Do **not** append to `docs/legacy-patterns/*.md` or `docs/LEARNINGS.md` — those monoliths are a frozen archive (retired in the Phase 2 pattern-codification refactor, `docs/research/pattern-codification-alternatives.md`) and are no longer codification targets.

### 6a. Compute the slug

Kebab-case the finding's intended title; cap at ~60 characters. Avoid generic words like `error`, `bug`, `fix` that don't aid disambiguation.

### 6b. Overlap-check (advisory, within-category only)

Scope the search to the target category directory. Full-corpus Jaccard scans caused the agent slowdown documented in `docs/solutions/_manifests/2026-05-13-learnings.md` — do not repeat it. Cross-category overlap is handled by `## See Also` links, not by reclassifying the file.

```bash
# Search ONLY the target category, not all of docs/solutions/
rg -l "^title:" "docs/solutions/<category>/" | head -50
```

For each candidate, `head -n 20` the frontmatter and compute:

- **Title Jaccard** — bag-of-words overlap between candidate `title:` and the new title.
- **Tag Jaccard** — overlap between candidate `tags:` and the new tags.

If **both ≥ 0.7**, print `near-duplicate: <path>` to stdout before writing. **Advisory only — write the new file anyway.** Surfacing the duplicate lets the user manually merge or set `last_updated:` on the existing file if they choose. (Steps 1-3 of the Phase 2 refactor recorded 0 merges across 366 files using a similar rubric; strict-block-on-overlap would have added friction with no benefit.)

### 6c. Write the file

Frontmatter — match `docs/solutions/README.md` schema exactly. Required fields per track:

| Field        | bug-track                                                                    | knowledge-track                                      |
| ------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| `title`      | required                                                                     | required                                             |
| `track`      | `bug`                                                                        | `knowledge`                                          |
| `category`   | `logic-errors` / `runtime-errors` / `code-quality` / `performance-issues`    | `conventions` / `design-patterns` / `best-practices` |
| `tags`       | required (list)                                                              | required (list)                                      |
| `module`     | `camera` / `server` / `client` / `shared`                                    | same                                                 |
| `applies_to` | optional — glob list (e.g. `["server/storage/**/*.ts"]`) for the future hook | same                                                 |
| `symptoms`   | required (bulleted list)                                                     | optional ("smell patterns")                          |
| `created`    | today's ISO date (`YYYY-MM-DD`)                                              | same                                                 |
| `severity`   | required: `low` / `medium` / `high` / `critical`                             | omit                                                 |

Body — match the section template from `docs/solutions/README.md`:

| Section        | bug-track heading  | knowledge-track heading             |
| -------------- | ------------------ | ----------------------------------- |
| H1 title       | `# <title>`        | `# <title>`                         |
| Statement      | `## Problem`       | `## Rule` or `## When this applies` |
| Symptoms       | `## Symptoms`      | `## Smell patterns` (optional)      |
| Explanation    | `## Root Cause`    | `## Why`                            |
| Resolution     | `## Solution`      | `## Examples`                       |
| Edge cases     | (n/a)              | `## Exceptions`                     |
| Prevention     | `## Prevention`    | (subsumed into Why / Exceptions)    |
| File pointers  | `## Related Files` | `## Related Files`                  |
| Outbound links | `## See Also`      | `## See Also`                       |

Cross-link convention for `## See Also`:

- **Same category** → bare slug: `- [other slug](other-slug-2026-05-15.md) — one-liner`
- **Cross category** → `../<target-cat>/<slug>.md` prefix: `- [cross-link](../conventions/some-rule-2026-05-15.md) — one-liner`

(The 5 broken-link fixes in Step 2 batch 1 of the Phase 2 refactor codified this rule — same-category writes are routinely mis-typed with a `../` prefix.)

## Step 7 — Commit

Stage each new solution file explicitly (and any agent files you also updated). Do not `git add` the whole directory.

```bash
# Example — substitute the actual files you wrote:
git add docs/solutions/conventions/<slug-1>-YYYY-MM-DD.md \
        docs/solutions/runtime-errors/<slug-2>-YYYY-MM-DD.md \
        .claude/agents/security-auditor.md
git commit -m "docs(solutions): codify findings from $(git branch --show-current)"
```

Use `docs(solutions):` as the conventional-commit type — matches Step 2-3 commits from the Phase 2 refactor (e.g. `88c16a6e`, `247eacd9`). The pre-commit hook runs `lint-staged` only (ESLint fix + Prettier on staged files); the full lint/type/test gate is enforced by CI on push.
