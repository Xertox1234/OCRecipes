# /audit Skill — Review Findings Remediation Plan

## Overview

Implementation plan for the seven findings in the structured review of [.claude/skills/audit/SKILL.md](.claude/skills/audit/SKILL.md). Each finding has been verified against the actual file before inclusion.

The HIGH finding is a structural conflict between two features added at different times — git-worktree isolation (Phases 1/9) and gitignored local-only artifacts (manifest, CHANGELOG, solutions). The other six are localized inconsistencies. The plan fixes them in order of blast radius, with the HIGH fix gated as the prerequisite for several others.

All edits target [.claude/skills/audit/SKILL.md](.claude/skills/audit/SKILL.md) unless otherwise noted. No new files are introduced.

---

## Finding 1 (HIGH) — Worktree destroys all gitignored audit artifacts

### Verified mechanism

Three gitignored artifact classes are written inside the worktree, never propagate to the main checkout, and are destroyed when `git worktree remove` runs in Phase 9:

| Artifact                                                 | Where written   | Tracked?                        | Survives worktree removal? |
| -------------------------------------------------------- | --------------- | ------------------------------- | -------------------------- |
| Code fixes, `docs/rules/` edits, `.claude/agents/` edits | worktree branch | ✅ tracked                      | ✅ via pushed branch       |
| Manifest `docs/audits/YYYY-MM-DD-scope.md`               | worktree        | ❌ gitignored (`.gitignore:96`) | ❌ deleted                 |
| `docs/audits/CHANGELOG.md` append                        | worktree        | ❌ gitignored (`.gitignore:96`) | ❌ deleted                 |
| Solution files `docs/solutions/<category>/*.md`          | worktree        | ❌ gitignored (`.gitignore:95`) | ❌ deleted                 |

Verified facts:

- `.gitignore:95` excludes `docs/solutions/`, `.gitignore:96` excludes `docs/audits/`.
- A new worktree is checked out with tracked files only — gitignored files don't propagate from main.
- `git worktree remove` deletes the working directory; gitignored files are not protected by the "uncommitted tracked changes" guard and disappear silently.

Two compounding failures:

1. **Codification output disappears.** Phase 8 writes solution files to `docs/solutions/` in the worktree; Phase 9 deletes them. The spec calls codification "not optional" ([line 399](.claude/skills/audit/SKILL.md#L399)).
2. **Cross-audit dedup is silently broken.** Phase 1 step 2 reads `docs/audits/CHANGELOG.md` from the main checkout (before the worktree exists). Phase 5 appends to a fresh CHANGELOG inside the worktree. The append vanishes with the worktree. Future audits see no prior history. The failure is silent — the next audit's Phase 1 step 2 just finds nothing to dedup against.

### Fix design

Pin every gitignored artifact to the **main checkout**, not the worktree. The principle: tracked files (code fixes, `docs/rules/`, `.claude/agents/`) live in the worktree because they need branch isolation; gitignored files (manifest, CHANGELOG, solutions) live in the main checkout because they have no branch to persist on.

Concrete edits, by phase:

1. **Phase 1 reorder** ([lines 80-102](.claude/skills/audit/SKILL.md#L80-L102)). Move the worktree creation (current step 6) to happen **before** the manifest creation (current step 3). New order:
   - Capture the current branch (current step 5).
   - Create and enter the audit worktree (current step 6).
   - Run baseline tests/types/lint (current step 1) **inside the worktree**.
   - Check `docs/audits/CHANGELOG.md` for previous findings — **read from the main checkout's absolute path** (`$(git rev-parse --git-common-dir)/../docs/audits/CHANGELOG.md`, or a captured `MAIN_CHECKOUT` variable).
   - Create the new manifest at the **main checkout's** `docs/audits/YYYY-MM-DD-[scope].md` path. Document this explicitly so it can't drift.
   - Record the baseline in the manifest header.

2. **Phase 5 step 3** ([line 252](.claude/skills/audit/SKILL.md#L252)). Change the CHANGELOG append target to the main checkout's path. Spell out the absolute-path pattern.

3. **Phase 8 step 4 / line 329 / line 311** ([lines 311, 329](.claude/skills/audit/SKILL.md#L311-L329)). Change solution-file creation paths to the main checkout's `docs/solutions/<category>/`. Reuse the same `MAIN_CHECKOUT` reference.

4. **Phase 1 step 6 (now relocated)** — capture the main checkout's path **before** creating the worktree, using a worktree-aware command rather than `pwd` (which is wrong if the user invoked `/audit` from inside a non-main worktree):

   ```bash
   MAIN_CHECKOUT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
   ```

   `--git-common-dir` returns the shared `.git` directory (always under the main checkout's root regardless of which worktree the command runs from). `dirname` gives the main checkout root. All subsequent phases reference `$MAIN_CHECKOUT/docs/audits/...` and `$MAIN_CHECKOUT/docs/solutions/...` for the three gitignored artifact paths.

5. **Phase 9 step 6** ([lines 371-374](.claude/skills/audit/SKILL.md#L371-L374)). No change needed — `git worktree remove` now only destroys per-worktree state (tracked branch checkout); all gitignored artifacts live in main and survive.

### Verification

After implementation, run one full audit cycle (e.g. `/audit security` on a small scope) and confirm:

- `docs/audits/YYYY-MM-DD-security.md` exists in the **main checkout** after the run.
- `docs/audits/CHANGELOG.md` in main has one new entry from this run.
- Any solution files codified land in main's `docs/solutions/<category>/`.
- The audit worktree directory is gone.

### Key decision: reorder over copy-back

An alternative is to add a "copy-back" step before `git worktree remove` that moves the three artifact classes from worktree → main. This works but introduces a fragile in-between state (artifacts ambiguously belong to whichever copy was most recently edited). The reorder approach makes the main checkout the unambiguous source of truth from Phase 1 onward, with no split-brain.

### Risk

Phase 1 step 2's CHANGELOG check currently runs in main (before the worktree exists), which means it works correctly _by accident_. The reorder makes this explicit. Without the reorder fix, anyone modifying Phase 1 ordering could break the read silently. The fix codifies what's currently true and makes it stable.

---

## Finding 2 (MEDIUM) — Missing `maintainability` row in kimi-review `--patterns` table

### Verified

The table at [lines 205-217](.claude/skills/audit/SKILL.md#L205-L217) maps every domain except `maintainability` to a `--patterns` value. Since `maintainability` is a fixable scope (included in `pre-launch` and `code-quality`), its findings reach Phase 3 and need a kimi-review pass — but the executor has no `--patterns` value to pass.

The spec already routes maintainability codification to `docs/rules/architecture.md` and `docs/rules/typescript.md` (lines 78 and 326), establishing what domains the lens lives in.

### Fix design

Add one row to the table:

```
| maintainability | architecture,typescript |
```

This matches the codification routing — the lens overlaps with architecture (boundary/layer concerns) and typescript (type-contract simplifications).

`kimi-review` degrades gracefully when `--patterns` is omitted, so this gap fails open today. Adding the row gives kimi the right domain context for a sharper review.

### Verification

After implementation, run `/audit maintainability` on a small scope and confirm Phase 3 step 7 successfully invokes `kimi-review --patterns architecture,typescript` without falling through to the `--patterns`-less default.

---

## Finding 3 (MEDIUM) — Multi-agent rows leave `subagent_type` unspecified

### Verified

[Line 26](.claude/skills/audit/SKILL.md#L26): "list both agents in the prompt when two are shown." But the Agent tool takes a single `subagent_type`. Most rows in the mapping table list two agents (security, performance, data-integrity, etc.); `code-quality` lists three.

[Line 110](.claude/skills/audit/SKILL.md#L110): "the trio (`quality-specialist + typescript-specialist + testing-specialist`) plus the maintainability dispatch — 2 invocations in parallel" — confirms a 3-agent row collapses to one invocation, but the spec never says which agent type the invocation uses.

Practical risk: if the security row runs only as `security-auditor`, the `ai-llm-specialist`'s prompt-injection focus is underweighted unless its concerns are explicitly written into the prompt.

### Fix design

Edit [line 26](.claude/skills/audit/SKILL.md#L26) to add an explicit rule:

> Use the **first-listed agent** as `subagent_type` for the invocation. Include the remaining agents' areas of focus explicitly in the prompt body (e.g., "Apply both the security-auditor lens and the ai-llm-specialist lens — IDOR/JWT/rate-limiting AND prompt-injection/AI-safety").

This makes the agent table's column order semantically meaningful (first = primary subagent type) and forces the prompt to carry the secondary agents' concerns.

### Verification

After implementation, do a dry-run dispatch for `/audit security` and confirm:

- `subagent_type` is `security-auditor` (first-listed).
- Prompt body explicitly names both `security-auditor` and `ai-llm-specialist` concerns.

---

## Finding 4 (LOW) — Phase 5 named "Close" but isn't the close

### Verified

[Phase 5 (lines 245-259)](.claude/skills/audit/SKILL.md#L245-L259) is named "Close" but is followed by Phase 6 (Code Review), Phase 7 (Commit Fixes), Phase 8 (Codify), and Phase 9 (Push & Open PR). The name is misleading — a reader expects the audit to end at Phase 5.

### Fix design

Rename "Phase 5: Close" → "Phase 5: Verify & Summarize". This describes what the phase actually does (re-run full verification suite, update manifest summary, print final summary) without falsely implying the audit ends.

### Verification

Re-read the renamed phase against its step list to confirm the new name fits each step (it does — all five steps are verification or summary work).

---

## Finding 5 (LOW) — Phase 6 step 5 missing lint re-run

### Verified

[Phase 6 step 5 (line 286)](.claude/skills/audit/SKILL.md#L286): "Re-run `npm run test:run` and `npm run check:types` after any review fixes". Lint is missing. Phase 5 step 1 (line 250) runs all three, so the omission in Phase 6 is inconsistent.

A lint regression introduced by a Phase 6 fix escapes the audit's explicit verification and only gets caught by the lint-staged pre-commit hook in Phase 7 — which runs on staged files only and might miss broader regressions.

### Fix design

Edit [line 286](.claude/skills/audit/SKILL.md#L286) to read:

> Re-run `npm run test:run`, `npm run check:types`, and `npm run lint` after any review fixes.

Three commands, same parallel-friendly form as Phase 5 step 1.

### Verification

Confirm by inspection that Phase 6 step 5 now runs the same three commands Phase 5 step 1 runs.

---

## Finding 6 (LOW) — Phase 1 manifest created before worktree

### Verified

Phase 1 step 3 (line 87) creates the manifest. Phase 1 step 6 (line 94) creates the worktree. The manifest is born in main, then orphaned as Phases 2-8 edit it from the worktree's copy (which doesn't exist initially because gitignored files don't propagate).

### Fix design

**Resolved by Finding 1's reorder.** When Phase 1 is reordered to create the worktree first and pin gitignored artifacts to the main checkout, this LOW finding disappears as a side effect — the manifest is created with an explicit `MAIN_CHECKOUT/docs/audits/...` path and there's no ambiguity about which copy is canonical.

### Verification

If Finding 1 ships first, Finding 6 needs no separate verification — same fix.

---

## Finding 7 (Nit) — Line 66 says "13 docs/rules/" files but there are 14

### Verified

[Line 66](.claude/skills/audit/SKILL.md#L66): "reliability reuses the existing specialist agents and the 13 `docs/rules/` files."

`ls docs/rules/` returns 14 files: `accessibility.md`, `ai-prompting.md`, `api.md`, `architecture.md`, `client-state.md`, `database.md`, `design-system.md`, `hooks.md`, `lsp.md`, `performance.md`, `react-native.md`, `security.md`, `testing.md`, `typescript.md`.

The reviewer's observation is correct: `lsp.md` is the 14th file. Line 338's enumeration of 13 _codification_ domains is also correct (lsp is tooling, not a codification domain) — only line 66's file count is loose.

### Fix design

Edit [line 66](.claude/skills/audit/SKILL.md#L66) to read:

> reliability reuses the existing specialist agents and the existing `docs/rules/` files. It does **not** add a `reliability-specialist` agent or a `docs/rules/reliability.md`.

Drop the count entirely. The count adds no information and rots when files change. The semantic claim ("reuses existing rules files; doesn't add new ones") is the load-bearing part.

### Verification

`grep -n "13 docs/rules" .claude/skills/audit/SKILL.md` should return no matches after the edit.

---

## Implementation order

Ship in this order. Each PR is self-contained except where noted.

1. **Finding 1 (HIGH).** Largest change, prerequisite for others to settle. Reorder Phase 1, change three artifact paths to use `MAIN_CHECKOUT`. This single change also resolves Finding 6.
2. **Finding 2 (MEDIUM).** One-row addition to the mapping table. Independent.
3. **Finding 3 (MEDIUM).** One-paragraph clarification at line 26. Independent.
4. **Finding 5 (LOW).** One-line addition to Phase 6 step 5. Independent.
5. **Finding 4 (LOW).** One-line rename at Phase 5 heading. Independent.
6. **Finding 7 (Nit).** One-line edit at line 66. Independent.

Findings 2-7 can ship in any order or be bundled into a single "review nits" PR after Finding 1 lands. Finding 1 should ship alone — its blast radius warrants isolated review.

---

## Out of scope

- **GitHub owner casing.** The reviewer dropped this; `gh` API resolves either way. No action.
- **Adding a copy-back step (Finding 1 alternative).** The reorder is the chosen approach; copy-back is not pursued.
- **Re-evaluating the dedup-against-history mechanism itself.** The Finding 1 fix restores the mechanism; redesigning it is a separate concern.
- **Same gitignore-worktree bug in `/todo` skill.** The `/todo` executor Step 9 writes to `docs/solutions/` in its worktree too. This plan does **not** address it — Finding 1 here is scoped to `/audit`. Whether to apply the same fix pattern to `/todo`'s codify step is a separate decision (see related design `2026-05-30-todo-skill-hardening-gates-design.md` Gate 5, which is undermined by this exact bug and needs revisiting).
- **Renaming other phases.** Only Phase 5's "Close" name was flagged. Phase 6 "Code Review", Phase 7 "Commit Fixes", Phase 8 "Codify", Phase 9 "Push & Open PR" all match their content and don't need renaming.

---

## Risks

- **Pre-existing manifests in past worktrees.** If any prior `/audit` runs wrote artifacts to worktrees that have since been removed, those artifacts are already lost. No recovery — only forward-looking fix.
- **Stale CHANGELOG history from before this plan ships.** The first audit after the Finding 1 fix lands will have no prior CHANGELOG entries to dedup against (everything before was destroyed by the bug). Phase 1 step 2's dedup check will silently no-op for one cycle. Expected — not a defect.
