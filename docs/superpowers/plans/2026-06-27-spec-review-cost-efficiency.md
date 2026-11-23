# Spec-Review Cost-Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the per-run token cost of the `spec-review` skill by delegating prior-spec reading to a cheap worker and scoping the specialist pass, without changing the review's lenses, verdict, or output.

**Architecture:** Three behavior-preserving edits to one tracked Markdown file, `.claude/skills/spec-review/SKILL.md`. (1) Rewrite Step 1 so prior-spec _selection_ stays inline but their _contents_ are read by `ask-kimi` (DeepSeek V4 Flash) — Explore subagent fallback — returning a compact calibration brief; this also collapses Step 1's triplicated search strategy. (2) Trim Step 4's duplicate calibration paragraph (its concrete heuristic moves into Step 1). (3) Rewrite the specialist pass to dispatch ≤3 scoped specialists that return deltas, not full re-reviews.

**Tech Stack:** Markdown (the skill file); `ask-kimi` (local script → OpenRouter → `deepseek/deepseek-v4-flash`); `Explore` subagent; git / `gh`; `npm run preflight` (CI parity gate before PR).

## Global Constraints

Every task's requirements implicitly include these (copied verbatim from the spec):

- The verdict, the lens analysis, and prior-spec **selection** stay **inline in the expensive model** — never delegated.
- The `ask-kimi --paths` list contains **only prior-spec/plan files** — never `docs/rules/*` or `.github/copilot-instructions.md`.
- `docs/rules/<domain>.md` + `.github/copilot-instructions.md` are read **inline, verbatim** (they are the contract the verdict enforces). This already happens in Step 4 — do not move it.
- **No `extract-chat`** on `ask-kimi` output (`extract-chat` parses Claude Code `.jsonl` transcripts; `ask-kimi` already prints a clean ≤800-word structured-bullet summary).
- The 6 review lenses, the 5-value verdict taxonomy (`approve` / `approve-with-edits` / `revise` / `split` / `reject`), and the `## Output Format` section are **untouched**.
- The specialist pass is capped at **≤3** specialists; each is dispatched **scoped** and returns **deltas**.
- **No edits** to `scripts/lib/path-domains.ts`, `docs/rules/*`, or `.github/copilot-instructions.md`.
- `.claude/skills/spec-review/SKILL.md` is **git-tracked**: work on a branch off `main`; `npm run preflight` must pass before opening a PR.
- There are **no unit tests** for a prose skill file. "Verification" in this plan means concrete `grep`/`read` checks with expected output — do not fabricate Vitest tests.

---

## File Structure

| File                                                                      | Responsibility                           | Action                                                            |
| ------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| `.claude/skills/spec-review/SKILL.md`                                     | The spec-review skill prose              | Modify (3 regions: Step 1, Step 4 tail, Optional Specialist Pass) |
| `docs/superpowers/specs/2026-06-27-spec-review-cost-efficiency-design.md` | Approved design (local-only, gitignored) | Read-only reference                                               |

All three edits are in one file. They are split into tasks because a reviewer could meaningfully approve the gather rewrite while rejecting the specialist rewrite (and vice versa).

---

### Task 1: Rewrite Step 1 (delegated gather + dedup) and trim Step 4's duplicate calibration paragraph

**Files:**

- Modify: `.claude/skills/spec-review/SKILL.md` (Step 1 = lines 46-85; Step 4 tail = line 133)

**Interfaces:**

- Consumes: the `ask-kimi --paths <files...> --question "..."` CLI (verified flags); the `Explore` agent type; `docs/superpowers/specs/` and `docs/superpowers/plans/` listings.
- Produces: a Step 1 that yields a "calibration brief" consumed by Step 2 ("Use the prior-spec sample…") and the Output Format's calibration citation — the brief is the new form of "the prior-spec sample".

- [ ] **Step 1: Create the working branch off `main`**

```bash
cd /Users/williamtower/projects/OCRecipes
git fetch origin main
git switch -c chore/spec-review-cost-efficiency origin/main
git branch --show-current   # expect: chore/spec-review-cost-efficiency
```

- [ ] **Step 2: Confirm the `ask-kimi` contract before encoding it**

Run:

```bash
command -v ask-kimi && ask-kimi --help 2>&1 | head -5 || \
  grep -nE -- '--paths|--question' "$(command -v ask-kimi)"
```

Expected: `ask-kimi` resolves on PATH and exposes `--paths` (nargs, required) and `--question` (required). If it does NOT resolve, the fallback path (Explore subagent) becomes the primary — note that in the rewrite but keep the `ask-kimi` block as written (it is correct when present).

- [ ] **Step 3: Replace Step 1 in `SKILL.md`**

Use Edit. `old_string` is the current Step 1 block (heading `### 1. Find relevant prior specs` through `If no useful precedent exists, continue with the current document alone and say so.`, i.e. lines 46-85). Replace the entire block with:

````markdown
### 1. Gather and calibrate against prior specs

Calibrate the review bar against 2-4 of the closest prior specs/plans. **Selecting** them stays inline (filenames are nearly free and selection benefits from judgment); **reading their contents** — the bulk cost — is delegated to the worker model.

**Select (inline, filenames only).** List `docs/superpowers/specs/` and `docs/superpowers/plans/` and pick the 2-4 closest, preferring in this order:

1. Same basename across `specs/` and `plans/` (a plan + its design is a maturity pair)
2. Same subsystem/feature tokens such as `coach`, `recipe`, `camera`, `ocr`, `todo`, `audit`, `kimi`, `copilot`, `eval`, `lsp`, `eslint`, `timezone`, or `worktree`
3. Same architectural surface (client UX, client-state, routes, storage, AI workflow, review infrastructure) and same document intent (design, hardening, rollout, verification, reliability)

Heuristics: strip the leading date and trailing `-design`; split on hyphens and match the strongest nouns first; prefer exact token overlaps; prefer newer precedents when several candidates are similarly close. Filename matching is weaker than reading every candidate, but over a 2-4 shortlist it is an acceptable tradeoff — and the brief below surfaces a bad pick so it can be dropped.

**Read contents (delegated — the bulk cost).** Hand the selected prior-spec/plan paths to the worker model for a compact calibration brief:

```bash
ask-kimi --paths <prior-spec-1> <prior-spec-2> [...] \
  --question "For spec-review calibration, summarize each file in 3-5 bullets: structure, typical detail level, recurring design/review constraints, and where it was more or less precise than usual. Do NOT summarize coding rules. Output structured bullets."
```

`ask-kimi` (DeepSeek V4 Flash) returns a clean, line-cited, ≤800-word structured-bullet summary on stdout (cost report on stderr). The `--paths` list contains **only prior-spec/plan files** — never `docs/rules/*` or `.github/copilot-instructions.md` (those stay inline in Step 4, where the verdict reads them verbatim). Do **not** pipe through `extract-chat` (it parses Claude Code `.jsonl` transcripts, not `ask-kimi` output).

If `ask-kimi` exits non-zero (it prints `[ERROR …]` to stderr), dispatch a read-only **Explore** subagent with the same prior-spec paths and the same brief request.

Use the brief for calibration, not blind template enforcement. Extract the recurring structure, the typical detail level for files/decisions/risks/validation, and repeated design constraints. If similar approved specs consistently include decision tables, touched-file lists, rollout order, or explicit failure paths, treat their absence here as a stronger signal; if precedent is intentionally lightweight, do not demand ceremony the repo itself does not use. When the sample pairs a plan with its design/spec, treat the design as the bar expected before implementation and the plan as the lighter planning shape.

If no useful precedent exists, say so and continue with the current document alone.
````

(The replacement drops the redundant "Prefer the closest precedents first" 3-bullet block — it restated the search order — and absorbs the concrete heuristic from Step 4's tail paragraph, removed in Step 4 below.)

- [ ] **Step 4: Remove Step 4's duplicate calibration paragraph**

Use Edit. `old_string` (note the leading blank line, line 132-133):

```

Let the precedent sample adjust that bar too. If similar approved specs in this repo consistently include decision tables, touched-file lists, rollout order, or explicit failure paths, treat their absence in the current doc as a stronger signal. If the historical precedent is intentionally lightweight, do not demand ceremony that the repo itself does not use.
```

`new_string`: empty (delete the paragraph). If the Edit tool rejects an empty replacement, set `new_string` to a single newline. The preceding paragraph ("Let the spec drive the depth of the review. …") stays and becomes the section's last paragraph.

- [ ] **Step 5: Verify the gather edit — no stale prose, delegate boundary intact**

Run:

```bash
cd /Users/williamtower/projects/OCRecipes
f=.claude/skills/spec-review/SKILL.md
echo "== removed-redundancy check (expect NO match) =="
grep -nE 'Prefer the closest precedents first|Let the precedent sample adjust that bar too' "$f"
echo "== delegate boundary present (expect matches) =="
grep -nE 'ask-kimi --paths|only prior-spec/plan files|read-only \*\*Explore\*\*|Do \*\*not\*\* pipe through `extract-chat`' "$f"
echo "== rules still read inline in Step 4 (expect match) =="
grep -nE '`docs/rules/<domain>.md` for each affected domain' "$f"
```

Expected: first grep prints nothing (exit 1); second and third print matches. If the first grep matches, the old prose was not fully removed — fix before committing.

- [ ] **Step 6: Confirm no accidental change to lenses / verdict / output**

Run:

```bash
git -C /Users/williamtower/projects/OCRecipes diff --unified=0 .claude/skills/spec-review/SKILL.md | \
  grep -E '^\+|^-' | grep -iE 'approve-with-edits|## Output Format|### 5\. Run the review lenses|Correctness and architecture' || echo "OK: protected sections untouched"
```

Expected: prints `OK: protected sections untouched`. Any hit means an edit strayed into a protected region — revert that hunk.

- [ ] **Step 7: Commit**

```bash
cd /Users/williamtower/projects/OCRecipes
git add .claude/skills/spec-review/SKILL.md
git commit -m "refactor(spec-review): delegate prior-spec gather to ask-kimi; dedup Step 1"
```

---

### Task 2: Rewrite the Optional Specialist Pass as scoped, delta-returning dispatch

**Files:**

- Modify: `.claude/skills/spec-review/SKILL.md` (`## Optional Specialist Pass`, last section of the file)

**Interfaces:**

- Consumes: the preliminary findings produced by the inline lens pass (Step 5) and the calibration brief / Step 4 rules (for the per-domain rule summary handed to each specialist).
- Produces: specialist **deltas** (confirm / refute / net-new) that feed the inline verdict (Step 7) — they do not replace it.

- [ ] **Step 1: Replace the specialist section**

Use Edit. `old_string` is the current `## Optional Specialist Pass` block (heading through `Use specialists to deepen the review, not to replace the core verdict.`). Replace with:

```markdown
## Optional Specialist Pass

If the spec spans multiple risky domains, dispatch up to **3** targeted specialists after the initial inline pass. Dispatch them **scoped** — never "go review the whole spec," which makes each specialist re-read everything.

Give each specialist only:

- the relevant spec excerpt(s),
- the preliminary findings already raised in its domain,
- the per-domain binding-rule summary (from the calibration brief / Step 4),
- this instruction: _"Do not broad-read the repo. Confirm or refute the findings above and add only domain-specific risks. Read a specific file only to verify a named claim."_

Each specialist returns **deltas** — confirm / refute / net-new findings — not a fresh full review. Pick at most 3 from:

- `api` or route-heavy spec -> `api-specialist`
- storage, schema-adjacent, or data-integrity-heavy spec -> `database-specialist`
- cross-layer ownership or service-boundary changes -> `architecture-specialist`
- AI, evals, or prompt-safety changes -> `ai-llm-specialist`
- React Native interaction or navigation changes -> `rn-ui-ux-specialist`
- verification or test-strategy questions -> `testing-specialist`
- security-sensitive surfaces -> `security-auditor`

Use specialists to deepen the review, not to replace the core verdict.
```

- [ ] **Step 2: Verify the specialist edit**

Run:

```bash
cd /Users/williamtower/projects/OCRecipes
f=.claude/skills/spec-review/SKILL.md
echo "== scoped-dispatch markers (expect matches) =="
grep -nE 'up to \*\*3\*\* targeted specialists|Dispatch them \*\*scoped\*\*|returns \*\*deltas\*\*|Do not broad-read the repo' "$f"
echo "== all 7 specialist mappings preserved (expect 7) =="
grep -cE '^- `[a-z]+`.*-> `[a-z-]+`|^- .*-> `(security-auditor|rn-ui-ux-specialist|testing-specialist)`' "$f"
```

Expected: first grep prints 4 marker matches; second prints `7`. If the count is not 7, a mapping line was dropped in the rewrite.

- [ ] **Step 3: Commit**

```bash
cd /Users/williamtower/projects/OCRecipes
git add .claude/skills/spec-review/SKILL.md
git commit -m "refactor(spec-review): scope specialist pass to ≤3 delta-returning dispatches"
```

---

### Task 3: Final consistency check, preflight, and PR

**Files:**

- Read-only: `.claude/skills/spec-review/SKILL.md`, the design spec

**Interfaces:**

- Consumes: the committed edits from Tasks 1-2.
- Produces: a green `preflight` and an open PR for human decision (this is not a `/todo`; do not enable `--auto`).

- [ ] **Step 1: Whole-file consistency read**

Read the full `.claude/skills/spec-review/SKILL.md` top to bottom. Confirm:

- Step 2 still references "the prior-spec sample" coherently (now the brief).
- No section promises a behavior the rewrite removed (e.g. "read each prior spec in full").
- The `### 1.` heading renumbering did not orphan a cross-reference (Step 3 still says "Step 4 reads `docs/rules/<domain>.md`").

- [ ] **Step 2: Global stale-claim + guardrail scan**

Run:

```bash
cd /Users/williamtower/projects/OCRecipes
f=.claude/skills/spec-review/SKILL.md
echo "== guardrail: ask-kimi must NOT be told to read rules (expect NO match) =="
grep -nE 'ask-kimi.*(docs/rules|copilot-instructions)' "$f"
echo "== guardrail: no extract-chat misuse on kimi output (expect NO 'pipe'/'extract-chat' near kimi) =="
grep -nE 'ask-kimi.*extract-chat|extract-chat.*ask-kimi' "$f"
echo "== verdict taxonomy intact (expect 5 values) =="
grep -oE '`(approve|approve-with-edits|revise|split|reject)`' "$f" | sort -u | wc -l
```

Expected: first two greps print nothing (exit 1); the third prints `5`.

- [ ] **Step 3: Run the CI-parity gate**

Run:

```bash
cd /Users/williamtower/projects/OCRecipes
npm run preflight
```

Expected: exits 0 (full CI parity incl. coverage). A Markdown-only change should not affect lint/types/tests; if something fails, it is pre-existing or environmental — inspect `npm run ci:failed-logs` only for the failed step, do not dump full logs.

- [ ] **Step 4: Push and open the PR (no auto-merge)**

```bash
cd /Users/williamtower/projects/OCRecipes
git push -u origin chore/spec-review-cost-efficiency
gh pr create --title "refactor(spec-review): delegate prior-spec gather + scope specialist pass" \
  --body "Implements docs/superpowers/specs/2026-06-27-spec-review-cost-efficiency-design.md (local-only spec). Behavior-preserving: lenses, verdict taxonomy, and output format unchanged; prior-spec contents now read by ask-kimi (Explore fallback); specialist pass scoped to ≤3 delta dispatches; Step 1 redundancy removed."
```

Expected: PR opens. Do **not** add `--auto` — this is a manual change, surface it for review. After `gh pr create`, the repo's `pr-verify` hook reports live PR state; cite that, not this plan.

- [ ] **Step 5: Report**

Report the live PR number/URL (from a fresh `gh pr view --json number,url`), the `preflight` exit code, and confirm the three protected invariants held (lenses, verdict taxonomy, output format unchanged).

---

## Self-Review

**1. Spec coverage** — each spec element maps to a task:

- Change 1 (delegated gather, ask-kimi, Explore fallback, brief, no extract-chat) → Task 1 Steps 2-5.
- Change 1 (rules read inline / not delegated) → preserved (Step 4 untouched) + verified in Task 1 Step 5 and Task 3 Step 2.
- Change 2 (scoped specialists, ≤3, deltas) → Task 2.
- Change 3 (remove Step 1 redundancy; fold scattered calibration prose) → Task 1 Step 3 (dedup) + Step 4 (Step 4 tail removal).
- "Filename selection weaker than content-aware" acknowledgement → in the Task 1 Step 3 replacement prose.
- Quality guardrails (lenses/verdict/output untouched) → enforced by Task 1 Step 6 + Task 3 Step 2.
- Verification (flags confirmed, no dangling refs, doc-only) → Task 1 Step 2/5/6, Task 3 Steps 1-3.

**2. Placeholder scan** — `<prior-spec-1>` etc. are deliberate CLI-template tokens inside the skill prose being written (the skill's user fills them per-review), not plan placeholders; every plan step has a concrete command or exact text.

**3. Type/identifier consistency** — the rewrite renames `### 1. Find relevant prior specs` → `### 1. Gather and calibrate against prior specs`; Task 3 Step 1 explicitly checks no cross-reference to the old heading/behavior survives. The term "prior-spec sample" (Step 2) and "calibration brief" (Step 1) are reconciled in the Step 1 prose ("the brief … the sample").

No gaps found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-27-spec-review-cost-efficiency.md` (local-only; `docs/superpowers/` is gitignored). Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks, fast iteration.
2. **Inline Execution** — execute the tasks in this session with checkpoints for review.

Which approach?
