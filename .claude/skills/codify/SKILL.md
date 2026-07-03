---
name: codify
description: Use at the end of any session to extract and preserve patterns, learnings, and review rules discovered during the session's implementation work
---

You are running the codify workflow. Codify patterns, learnings, and agent rules from the current branch's implementation work. **Never skip steps.**

## Step 1 — Resolve the diff range, then assess it

`/codify` codifies a **diff range**. Resolve it **once**, here, then every
downstream command (the path-domains feed in this step, the Step 3 review
dispatch and confirm-check) references **the resolved range** — never a literal
`main...HEAD`. The resolved range is a value you **carry in context**, not a
shell variable (shell vars do not persist between Bash calls — see the note in
Step 3, same as `review_output`).

Pick the range by this precedence (first match wins):

1. **Explicit argument.** If the caller invoked `/codify <sha>` or
   `/codify <range>` (e.g. `d2f29da2^ d2f29da2`, `abc123..def456`) or
   `/codify --since <ref>` (resolves to `<ref>..HEAD`), use that. An explicit
   argument **overrides** the `main...HEAD` default — this is the named-range
   escape hatch. Skip to "Assess the resolved range" below.
2. **Live feature branch.** Otherwise run `git diff main...HEAD --stat`. If it is
   **non-empty**, the resolved range is `main...HEAD` (the normal on-branch flow).
3. **Post-merge fallback (default branch, empty `main...HEAD`).** If
   `main...HEAD` is empty **and** you are on the default branch
   (`git branch --show-current` is `main` or `master`), the branch was just
   squash/merged and `HEAD` is the merge/squash commit. Resolve the range to
   `HEAD^ HEAD` (the
   most-recently-merged change). **Confirm before codifying — do not jump
   silently** (per the todo's Risks note): echo HEAD's subject so the unit is
   visible, and treat it as the codify target only if it is the intended
   just-merged work (it matches the session's merged PR when known, or is
   otherwise recent):

   ```bash
   git log -1 --format='%h %s' HEAD   # the unit about to be codified — confirm this is the just-merged change
   ```

   If it is **not** the intended commit, ask the caller for an explicit
   `<sha>` / `<range>` (path 1) instead of codifying the wrong commit.

**Nothing-to-codify early-exit.** Output "Nothing to codify — no changes on this
branch." and stop **only when BOTH** are genuinely empty: `main...HEAD` is empty
**and** the fallback range is also empty (no explicit arg, and either not on the
default branch or `HEAD^ HEAD` produces no diff — e.g. an empty/root commit).

### Assess the resolved range

Display the diff stat for the resolved range:

```bash
git diff <resolved-range> --stat   # e.g. main...HEAD, HEAD^ HEAD, or the explicit <sha>/<range>
```

Then derive the domain/routing labels for the changed files from the single
source of truth — do **not** maintain an inline mapping table (it drifts). Feed
the **resolved range** into `--name-only`:

```bash
git diff <resolved-range> --name-only | xargs npx tsx scripts/lib/path-domains.ts --routing
```

This prints the comma-separated union of **routing labels** (rules-domains plus
routing-only labels such as `camera`, used by Step 2 to pick domain reviewers)
across all changed files. The mapping is defined once in
`scripts/lib/path-domains.ts` — the same source the generated
`.github/copilot-instructions.md` and `.claude/hooks/lib/domain-map.sh` derive
from. **In addition, include `typescript` whenever any changed file is a `.ts`
or `.tsx` file** (a cross-cutting policy the CLI does not add).

## Step 2 — Map domains to review agents

> **Canonical routing tables.** This table and the Step 5 agent-update table are the single
> source of truth for domain→reviewer routing. Other surfaces (`.claude/skills/audit/SKILL.md`,
> `.claude/agents/todo-executor.md`) point here — never restate these tables elsewhere.

The domain labels from Step 1 carry forward to two places: they tell the reviewers (Step 3) which lenses matter most, and they drive the self-improvement routing in Step 5 (which reviewer file owns a new review rule). Map each label to the reviewer(s) to dispatch:

| Domain label(s)                | Reviewer(s) to dispatch                                    |
| ------------------------------ | ---------------------------------------------------------- |
| `security`                     | `security-auditor`                                         |
| `architecture`, `duplication`  | `server-reviewer`                                          |
| `api`                          | `server-reviewer`                                          |
| `database`                     | `server-reviewer` (+ `ai-reviewer` for nutrition data)     |
| `react-native`, `ui`, `camera` | `mobile-reviewer`                                          |
| `hooks`, `client-state`        | `mobile-reviewer`                                          |
| `accessibility`                | `mobile-reviewer`                                          |
| `performance`                  | `mobile-reviewer` (client) / `server-reviewer` (server/DB) |
| `ai`, `llm`                    | `ai-reviewer`                                              |
| `testing`, `test`              | `code-reviewer`                                            |
| `typescript`, `types`          | `code-reviewer`                                            |
| _(no match)_                   | `code-reviewer` only                                       |

Combine dispatch targets for multiple matched domains — dispatching several reviewers over one branch is normal. Rule _ownership_ is different: a finding that reveals a reusable review rule updates exactly **one** owning reviewer file (see Step 5 — single-write rule).

## Step 3 — Review the branch diff (orchestrator-dispatched, domain-selected)

Review uses the model in `docs/AI_WORKFLOW.md` → Review Policy. You are the orchestrator.

**First, reuse existing review signal.** If reviewers already ran earlier in this session (e.g. the todo-executor's Step 6, or a manual review), their findings are your `review_output` — do not re-review. Skip the dispatch below and go to Step 4.

Otherwise, confirm there is a diff to review — using **the resolved range from
Step 1** (`main...HEAD`, `HEAD^ HEAD`, or the explicit `<sha>`/`<range>`), not a
literal `main...HEAD`:

```bash
git diff <resolved-range> --stat
```

If the diff is empty, set `review_output=""` and proceed to Step 4. Otherwise:

1. **Always include `code-reviewer`** (cross-cutting baseline). Then add the relevant domain reviewers for the branch — you already have the touched **domain labels** from Step 1 and their **reviewers** from the Step 2 mapping — typically **1–2 domain reviewers** on top (a branch usually spans more domains than a single todo). Use content as well as paths (a JWT/ownership change → add `security-auditor` even if Step 1 didn't tag it).
2. **Dispatch the selected reviewers in parallel** (one Agent call each, in a single message), using the Review-Policy dispatch prompt with `git diff <resolved-range>` as the diff command (the **same resolved range from Step 1** — on the post-merge path this is `HEAD^ HEAD`, **not** `main...HEAD`, or the dispatched reviewers diff an empty range and falsely return "No findings") and the branch name as the context label. **Working-tree safety:** capture `WORKTREE=$(git rev-parse --show-toplevel)` + the current branch/HEAD in your own cwd and require each reviewer to use `git -C "$WORKTREE"` (not `cd`) + a tree check at the start of its prompt (per Review Policy → "Working-tree safety") — a reviewer must be on this branch in this tree or it diffs the wrong range. Each reviews ONLY the changes in the resolved range through its lens and returns `[CRITICAL]/[WARNING]/[SUGGESTION] file:line — description`, or `No findings`.
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

**Agent update target** (self-improvement — only when the finding reveals a reusable review rule). A single candidate may update a solution file and one agent.

**Single-write rule:** a review rule lands in exactly **ONE** owning reviewer file — never dual-written into a second agent. If a finding spans two domains, pick the row matching its root cause. (This table is the canonical routing home — see the Step 2 note.)

| Finding domain                        | Owning agent file                    |
| ------------------------------------- | ------------------------------------ |
| Security                              | `.claude/agents/security-auditor.md` |
| API / architecture / data integrity   | `.claude/agents/server-reviewer.md`  |
| Server or DB performance              | `.claude/agents/server-reviewer.md`  |
| Client performance                    | `.claude/agents/mobile-reviewer.md`  |
| UI/UX / camera/vision / accessibility | `.claude/agents/mobile-reviewer.md`  |
| AI/LLM / nutrition domain             | `.claude/agents/ai-reviewer.md`      |
| Code quality / TypeScript / testing   | `.claude/agents/code-reviewer.md`    |

## Step 6 — Overlap-check, then write one file per finding

Write one file per finding at `docs/solutions/<category>/<slug>-<YYYY-MM-DD>.md`. Do **not** append to `docs/legacy-patterns/*.md` or `docs/LEARNINGS.md` — those monoliths are a frozen archive (retired in the Phase 2 pattern-codification refactor, `docs/research/pattern-codification-alternatives.md`) and are no longer codification targets.

### 6a. Compute the slug

Kebab-case the finding's intended title; cap at ~60 characters. Avoid generic words like `error`, `bug`, `fix` that don't aid disambiguation.

### 6b. Overlap-check (advisory, semantic)

Run the built-in near-duplicate check before writing:

```bash
npm run solutions:db:add -- <draft-file> --dry-run
```

This embeds the draft and reports `near-duplicate: <path> (cosine …)` for any existing solution at cosine ≥ 0.88. The semantic check catches paraphrased duplicates that lexical Jaccard misses — and avoids the full-corpus scan that caused the agent slowdown documented in `docs/solutions/_manifests/2026-05-13-learnings.md`. Cross-category overlap is still handled by `## See Also` links, not by reclassifying the file.

**Advisory only — proceed regardless.** Surfacing the duplicate lets the user manually merge or set `last_updated:` on the existing file if they choose. (Steps 1-3 of the Phase 2 refactor recorded 0 merges across 366 files using a similar rubric; strict-block-on-overlap would have added friction with no benefit.)

### 6c. Write the file, then register it in the DB

Compose the solution markdown and write it to `docs/solutions/<category>/<slug>-<YYYY-MM-DD>.md`. Then run:

```bash
npm run solutions:db:add -- docs/solutions/<category>/<slug>-<YYYY-MM-DD>.md
```

This inserts/embeds the row into the canonical DB and re-exports the file in canonical form. The DB is the source of truth; the file is its regenerated mirror.

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

Solution content now lives in the DB and `docs/solutions/` is gitignored — there is nothing to `git add` there. Only stage `.claude/agents/*.md` files that were also updated in Step 6.

```bash
# Example — substitute the actual agent files you updated (if any):
git add .claude/agents/security-auditor.md
git commit -m "docs(solutions): codify findings from $(git branch --show-current)"
```

If no agent files were updated (only solution files were written), there is no commit — the solution persists by living in the DB and its `docs/solutions/` mirror.

Use `docs(solutions):` as the conventional-commit type — matches Step 2-3 commits from the Phase 2 refactor (e.g. `88c16a6e`, `247eacd9`). The pre-commit hook runs `lint-staged` only (ESLint fix + Prettier on staged files); the full lint/type/test gate is enforced by CI on push.
