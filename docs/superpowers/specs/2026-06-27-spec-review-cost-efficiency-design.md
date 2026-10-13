# Spec-Review Cost-Efficiency Refactor — Design

**Date:** 2026-06-27
**Status:** Approved (design); pending implementation plan
**Target file:** `.claude/skills/spec-review/SKILL.md` (tracked — change goes through CI on its own branch)
**This spec:** local-only (`docs/superpowers/specs/` is gitignored, like all 61 existing specs)

## Goal

Cut the per-run token cost of the `spec-review` skill — which fires both its
calibration pass and its specialist pass on most non-trivial specs — **without**
weakening review quality and **without** delegating any security / auth /
architecture _verdict_ to a cheaper model.

## Problem (measured, not assumed)

The skill runs **inline** in the main conversation. Three properties make that expensive:

1. **Inline reads persist.** Every file the skill reads stays in the main context
   window for the rest of the session, not just for the review turn.
2. **Calibration reads full prior specs.** Step 1 pulls 2-4 prior specs to set the
   review bar. Average spec is ~226 lines (`13836` lines across `61` files); several
   exceed 400. That is ~450-900 lines of raw doc text loaded inline per review.
3. **The specialist pass re-reads from scratch.** Each specialist subagent (`api`,
   `database`, `security-auditor`, etc.) re-reads the spec and supporting context
   independently, multiplying cost when 2-3 fire.

Notably, the **binding context is _not_ the cost driver**: `.github/copilot-instructions.md`
is 54 lines, and all 14 `docs/rules/*.md` files total 251 lines (~18 each). The
skill's own prose is a secondary cost — 250 lines, with Step 1 stating its search
strategy three different ways.

The skill never delegates the bulk reading, despite the global
`CLAUDE.md` rule _"Reading 3+ files for analysis → ask-kimi"_.

## Decisions (resolved during brainstorming)

| Decision      | Choice                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Usage reality | Both calibration **and** specialist passes fire regularly and add value → optimize, do not cut.                                               |
| Architecture  | **Delegate the I/O, keep the verdict inline.** Bulk reading moves off the inline thread; lens analysis + verdict stay in the expensive model. |
| Gather worker | **`ask-kimi` (DeepSeek V4 Flash)**, with an **Explore subagent fallback** if `ask-kimi` errs.                                                 |

## Constraint (hard line)

`CLAUDE.md` forbids delegating security / auth / architecture **judgment**. A
spec-review verdict _is_ that judgment, on specs that routinely touch
routes/storage/auth. Therefore:

- **Delegate only the I/O** — gather + summarize prior specs and the rules pack into
  a compact calibration brief.
- **Keep the verdict, the lens analysis, and prior-spec _selection_ inline** in the
  expensive model.

This matches the CLAUDE.md line exactly: "reading 3+ files → ask-kimi" is an
explicit AUTO-delegate; security/architecture decisions are NEVER-delegate.

## The three changes

### Change 1 — Delegated gather → compact calibration brief

Split Step 1 (calibration) and Step 4 (binding context) into a cheap/inline boundary:

**Inline & cheap (stays in expensive model):**

- Select the 2-4 closest prior specs **by filename only** — `ls docs/superpowers/specs/`
  - `ls docs/superpowers/plans/` and the existing match heuristics (strip leading
    date and trailing `-design`, split on hyphens, match strongest nouns, prefer newer).
    Filenames are nearly free and selection benefits from the model's judgment. Filename
    matching is weaker than content-aware similarity (you can't see a doc's true overlap
    from its name), but over a 2-4-candidate shortlist it is an acceptable tradeoff, and
    the returned brief surfaces a bad pick so it can be discarded.
- Run `npx tsx scripts/lib/path-domains.ts <files…>` to resolve affected rules-domains
  (cheap; prints the domain union).
- **Read the binding context inline, verbatim** — each resolved `docs/rules/<domain>.md`
  - `.github/copilot-instructions.md`. These total ~305 lines (cheap) **and** they are
    the contract the verdict enforces; the judgment must reason against the rule text, not
    a summary of it. They are deliberately **not** delegated.

**Delegated (one `ask-kimi` call) — prior-spec contents only:**

- Verified invocation shape: `ask-kimi --paths <prior-spec-path…> --question "<…>"`
  (`--paths` is `nargs="+"`, required; `--question` required; model defaults to
  `deepseek/deepseek-v4-flash` via `WORKER_MODEL`).
- The `--paths` list contains **only the selected prior-spec/plan files** — never the
  rules pack or copilot-instructions (those are read inline, above).
- Ask it to return a compact brief: per prior spec, 3-5 bullets on structure, typical
  detail level, recurring design/review constraints, and where it was more or less
  precise than usual. (The binding rules are intentionally absent — they live inline.)
- **No `extract-chat` step.** `ask-kimi` already prints a clean, line-cited,
  ≤800-word structured-bullet summary to stdout (cost report on stderr). `extract-chat`
  parses Claude Code `.jsonl` transcripts and does not apply to `ask-kimi` output.

**Fallback:** if `ask-kimi` exits non-zero (it prints `[ERROR…]` to stderr on failure),
dispatch a read-only **Explore** subagent with the same prior-spec paths and the same
brief request.

**Net effect:** ~450-900 lines of raw prior-spec text collapse to a single brief
(≤800 words / ~100 lines) in main context. The verdict reasons over that brief plus the
verbatim binding rules (read inline), not the raw prior-spec corpus.

### Change 2 — Scoped specialist dispatch

Today the specialist pass implies a full independent re-read. Replace it with a
**scoped** dispatch. Each specialist receives:

- the relevant spec excerpt(s) only,
- the preliminary findings in _its_ domain from the inline pass,
- the domain-rules summary already captured in the calibration brief,
- an explicit instruction: _"Do not broad-read the repo. Confirm or refute these
  findings and add only domain-specific risks. Read specific files only to verify a
  named claim."_

Specialists return **deltas** (confirm/refute + net-new findings), not a fresh full
review. The existing ≤3-specialist cap stays.

### Change 3 — Remove SKILL.md redundancy

Behavior-preserving prose cleanup. The target is **removing duplication**, not hitting a
line count — Changes 1-2 _add_ some mechanics (the gather command, the `ask-kimi`
invocation + fallback, the scoped-specialist instruction block), so net length may not
fall much. Do not force-cut substantive prose to chase a number.

- Collapse Step 1's triplicated search strategy (search order stated ~3 ways +
  "prefer closest precedents" block) into one ordered list + the matching heuristics.
- Fold the three scattered "calibrate against prior specs" mentions (Review Standard,
  Step 4, Heuristics) into a single reference.
- Reflect the new gather/delegate boundary in Steps 1 and 4.

Every review lens, the verdict taxonomy, and the Output Format section are **untouched**.

## Quality guardrails (non-negotiable)

- The 6-lens framework, the 5-value verdict taxonomy (`approve` / `approve-with-edits`
  / `revise` / `split` / `reject`), and the output format stay as-is.
- The **verdict and all judgment stay inline in the expensive model** — never delegated.
- Prior-spec **selection** stays inline; only their **contents** are read by the cheap worker.

## Out of scope

- No change to the lens criteria, the verdict values, or the output schema.
- No conversion of spec-review into a fully dispatched single-subagent review (considered
  and rejected: it would cost main-thread interactivity and verdict inspectability).
- No tiered lite/full triage (considered; unnecessary given both passes fire regularly
  and add value).
- No edits to `scripts/lib/path-domains.ts`, `docs/rules/*`, or `copilot-instructions.md`.

## Verification

- Re-read the edited `SKILL.md` for dangling references to removed prose and for an
  accurate `ask-kimi` invocation (flags confirmed: `--paths …`, `--question …`).
- Sanity-check the gather command against one real spec (paths exist, brief returns).
- Doc-only change to a tracked skill file; no product code, no test suite implicated.
  The edit needs its own branch off `main` (current branch `feat/mutation-scope-expansion`
  is unrelated).

## Expected outcome

- Calibration's raw prior-spec footprint in main context drops from hundreds of lines to
  a single brief (≤800 words / ~100 lines), produced on the cheapest available model.
- The verdict still reasons against the verbatim binding rules (read inline, cheap), so
  the contract it enforces is never lossily summarized.
- Specialist passes stop re-reading the full spec/context; they cost a scoped delta each.
- SKILL.md duplication is removed (net length roughly flat, since Changes 1-2 add some
  delegation mechanics); the win is clarity, not a line-count cut.
- Review quality is held constant: same lenses, same verdict taxonomy, same output, and
  the judgment never leaves the expensive model.
