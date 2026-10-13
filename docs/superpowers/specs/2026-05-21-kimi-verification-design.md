# Kimi Verification Layer — Design

**Date:** 2026-05-21
**Status:** Approved for planning
**Author:** brainstorming session
**Related:** [2026-05-18-kimi-false-positive-prevention-design.md](2026-05-18-kimi-false-positive-prevention-design.md), [docs/kimi-review-architecture.md](../../kimi-review-architecture.md)

## Problem

Every Kimi surface is a single `client.chat.completions.create(...)` call:
build a prompt (diff + patterns + rules + `<changed-files>`), send it, filter the
prose response, print findings. `kimi-multi-review` is not agentic either — it is
a parallel fan-out of N independent single-shot calls, one per domain, then a
dedup. There is no loop, no tool use, no iteration.

The consequence the user has hit in practice: **hallucinated findings**. The
reviewer asserts things about the code that are not true ("guard X is missing",
"line 42 does Y") because it reasons over a partial diff and has **no way to
check its own claim against the real codebase**.

The prior false-positive-prevention work (`--function-context`,
`<changed-files>` manifest, `temperature=0`, three-dot merge-base) all attacked
this by feeding the model _more context up front_. It never gave the model a way
to _verify_. That prior design's own framing said it best: the reviewer "is asked
to be a hard quality gate but given a keyhole view, so it hallucinates absences …
it lacks the evidence to confirm the rules are met." This design closes that gap:
instead of only feeding evidence in, we let the pipeline **go get evidence** and
verify findings before they are reported or used to block.

### Capability is not the blocker

`deepseek/deepseek-v4-flash` (the worker model, via OpenRouter) lists `tools`,
`tool_choice`, `structured_outputs`, and prompt caching in its supported
parameters (confirmed via the OpenRouter `/models` API, 2026-05-21). Pricing is
$0.112/M input, $0.224/M output, with cache reads at $0.022/M, 1M-token context.
An agentic, tool-using reviewer is therefore viable at the cheap tier. The real
constraint is **latency on the every-commit gate**, not model capability.

## Goal & non-goal

- **Goal:** every finding that survives the pipeline is _true_. Eliminate
  hallucinated findings.
- **Non-goal:** finding _more_ issues (false negatives / wider coverage). We are
  not changing what classes of problems the reviewer looks for. The complaint is
  truth, not recall. Keeping this out of scope avoids reintroducing noise and
  keeps the build tight.

## The three hallucination classes

Verification capability differs by class, and this difference drives the
two-tier design:

| Class                    | Example                                                                                           | Catchable by                 |
| ------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------- |
| (a) **Absent-symbol**    | "guard `requireOwner` is missing" — it exists                                                     | deterministic `grep`         |
| (b) **Line-assertion**   | "`auth.ts:42` does X" — line 42 does not say that                                                 | deterministic read + compare |
| (c) **Semantic misread** | cites a _real_ line/symbol but misreads behavior ("this regex allows injection" when it does not) | agentic tier only            |

Classes (a) and (b) are _referential_ — the claim points at code that can be
mechanically located and compared. Class (c) is _semantic_ — the reference is
correct but the interpretation is wrong; only a reviewer that can read
surrounding context and reason about it can refute it.

Per the prior post-mortems, (a) and (b) are the dominant documented classes.

## Architecture: a two-phase pipeline

Both tiers share one shape. Phase 1 is unchanged in spirit (a single-shot
draft); Phase 2 is new (verification), with two implementations selected by
surface.

### Phase 1 — Draft (all surfaces)

Today's single-shot review, with one change: it returns **structured JSON** via
`structured_outputs` instead of prose. Each finding carries:

```
{
  tier:       "CRITICAL" | "WARNING" | "SUGGESTION",
  claim_type: "absent_symbol" | "line_assertion" | "semantic",
  file:       "server/routes/foo.ts",
  line:       42,            // null when not line-anchored
  symbol:     "requireOwner",// the asserted-absent / asserted-present identifier; null for semantic
  detail:     "one-to-two sentence explanation"
}
```

`claim_type` is the **linchpin** of the whole design — it is what routes Phase 2
(`absent_symbol → grep`, `line_assertion → read+compare`,
`semantic → reason/escalate`). It is a schema prerequisite, not a nice-to-have.

Structured output **retires** the brittle prose machinery in the current engine:
the `_FILE_REF_RE` regex, the `filter_review` placeholder heuristic, and the
empty-tier-placeholder problem all disappear because findings arrive as typed
data, not bracketed text.

### Phase 2 — Verify

Routed by `claim_type`. Two implementations:

#### Tier A — cheap gate verify (commit gate: Husky + Claude-Code hook)

Deterministic. **No extra LLM call**, so commit latency stays essentially as it
is today (clean commits with no findings do no verification at all).

- `absent_symbol` → `git grep` the **staged tree** for `symbol`; if found, the
  "missing" claim is false → downgrade.
- `line_assertion` → read the cited `file:line` from the **staged tree**; if the
  finding's quoted snippet is not present there → downgrade.
- `semantic` → cannot be checked deterministically → fail-safe policy (below).

**Tree discipline:** Tier A reads the **staged tree** (`git show :path`,
`git grep --cached`), never the working tree. Reading the wrong tree would itself
manufacture new hallucinations (the diff describes staged content).

**Fail-safe policy (decision F2):** when verification is _uncertain_ or the
finding is _semantic_, a CRITICAL is **downgraded to WARNING** — it still prints,
but it does not block the commit. It is never silently dropped, and never left to
block on an unverifiable claim. This delivers the "never falsely blocked"
property while real semantic issues still surface and get caught one tier up.

**Expectations (decision F1):** Tier A kills referential hallucinations (a) and
(b). Semantic misreads (c) are _not_ caught at commit time by design — chasing
them at the gate is exactly what would cost latency. They are caught in Tier B
(deep / CI). An occasional (c)-class finding reaching the gate is expected
behavior, not a failed build; under F2 it is downgraded to a non-blocking
WARNING.

#### Tier B — agentic deep verify (kimi-multi-review + CI PR review)

Per-finding agentic loop. For each draft finding, the reviewer model is given
**read-only tools** (`read_file`, `grep`), runs a **bounded 3–5 turns** at
`temperature=0`, investigates whether the claim holds, and returns a structured
verdict:

```
{ verdict: "verified" | "refuted" | "uncertain", corrected_detail, confidence }
```

This tier catches class (c): it can read the cited code _and its context_ and
reason about whether the asserted behavior is real. Per-finding verifications run
in parallel, reusing `kimi-multi-review`'s existing `ThreadPoolExecutor` shape.

**CI security invariant (preserved):** in the `pull_request_target` CI job the
agentic reviewer gets **read-only text tools only** — read file content, grep
text. It **never executes PR-head code** (no test runner, no building, no
importing, no shell-of-project-code). Reading text and filenames from the PR head
is explicitly safe under the existing invariant in
`docs/kimi-review-architecture.md` §6; _running_ PR-head code while repository
secrets are in scope is the line that is never crossed.

**Tree discipline by surface:** gate → staged tree; CI → PR-head (read-only);
manual `kimi-multi-review` → working tree / base ref as today.

## The safety invariant (headline property)

**Verification is monotonic: Phase 2 only ever removes or downgrades findings. It
can never invent, promote, or escalate a finding into a blocking CRITICAL.**

Consequence: although the agentic loop reintroduces some nondeterminism (tool-call
ordering can vary run to run), the gate _cannot_ blow up on a phantom. The worst
case under flake is that a finding which should have been downgraded occasionally
survives — i.e., the system fails _toward_ keeping you informed, never toward a
false block. This is the direct answer to "doesn't an agentic loop undo the
`temperature=0` determinism the prevention work fought for?": determinism of the
_draft_ still matters and is preserved (`temperature=0`); the _verify_ pass is
allowed to be nondeterministic precisely because it is monotonic.

## Consolidation (build first — decision F3)

The engine exists as two hand-synced copies (`~/.local/bin/kimi-review`,
unversioned; `scripts/kimi-review.py`, in git) that already differ in four
documented ways (`docs/kimi-review-architecture.md` §3). Bolting an agentic loop
— tool definitions, a turn loop, verification state, a JSON schema — onto a
hand-synced pair multiplies the drift hazard. So consolidation comes first.

"One source of truth" operationally means **one logical engine, with drift
mechanically detected** — not literally one file, because the global CLI is
cross-project (it carries a `plant_id` profile for a different repo, so OCRecipes
cannot be the sole physical home).

- **Canonical engine** module lives in the `claude-coworker` tools dir
  (`~/.local/share/claude-coworker/tools/`, where `extract-chat` already lives),
  versioned there. The global `~/.local/bin/kimi-review` becomes a thin shim to
  it.
- **OCRecipes vendors** a pinned copy at `scripts/kimi-review.py`, synced by a
  script and guarded by a **CI drift-check** — the exact pattern already in use
  for `build:copilot-instructions:check` (CI fails if the vendored copy is stale).
- **Project profiles** (`ocrecipes`, `plant_id`, `generic`) become **data**, so
  project-specific config never forks the engine code.

_Alternative considered and rejected for now:_ extract the engine into its own
tiny git repo and have both surfaces install it as a pinned dependency. Cleaner
conceptually, but more setup and a new repo to manage; the vendor-with-drift-check
shape reuses an accepted in-repo pattern.

## Surfaces after this change

| Surface                                           | Phase 1 (draft)                   | Phase 2 (verify)                  | Blocks?                          |
| ------------------------------------------------- | --------------------------------- | --------------------------------- | -------------------------------- |
| Claude-Code hook (`.claude/hooks/kimi-review.sh`) | structured single-shot            | Tier A deterministic, staged tree | CRITICAL blocks (post-verify)    |
| Husky pre-commit (`.husky/pre-commit`)            | structured single-shot            | Tier A deterministic, staged tree | CRITICAL blocks (post-verify)    |
| `kimi-multi-review` (manual)                      | structured single-shot ×N domains | Tier B agentic, working tree      | non-blocking (prints)            |
| CI PR review (`scripts/ci-kimi-review.sh`)        | structured single-shot            | Tier B agentic, PR head read-only | CRITICAL fails job (post-verify) |

## Side wins

- `structured_outputs` retires `_FILE_REF_RE`, `filter_review`'s placeholder
  heuristic, and the shape-based CRITICAL grep across the three wrappers — the
  gate detects a blocking finding from typed data, not regex on prose.
- Consolidation removes the standing two-copy drift hazard documented as "a real
  maintenance hazard."
- Prompt caching ($0.022/M cache reads) makes the repeated system-prompt + rules
  context cheap across the multi-review fan-out and per-finding verify calls.

## Goals (acceptance)

- Referential hallucinations (classes a, b) are refuted before a commit can be
  blocked by them.
- Semantic hallucinations (class c) reaching the gate are downgraded to
  non-blocking WARNING, and are refuted in Tier B (deep / CI).
- Phase 2 is provably monotonic (only removes/downgrades) — enforced in code and
  covered by tests.
- The commit gate's latency on a clean commit is unchanged (no findings → no
  verification → no extra work).
- One canonical engine; the OCRecipes vendored copy is guarded by a CI
  drift-check that fails when it is stale.
- CI Tier B never executes PR-head code (read-only text tools only).

## Out of scope

- Widening detection / chasing false negatives.
- Replacing the Claude deep-review subagents (`code-reviewer`, specialists).
  Those remain the top tier for architectural / cross-file audit work; this
  design makes the _cheap automatic_ tier trustworthy, it does not grow Kimi into
  that lane.
- Changing the path → domain pattern mapping or the secret-safety diff filter.

## Open questions for planning

- Exact `read_file` / `grep` tool schemas for Tier B and the per-finding turn cap
  (3 vs 5) — to be fixed in the implementation plan.
- Whether Tier A's `line_assertion` snippet match is exact-substring or
  normalized (whitespace-collapsed) — normalized is likely needed to avoid new
  false downgrades.
- Migration order: consolidate (with current single-shot logic) and prove parity
  via the existing test harness _before_ layering Phase 2, so a regression is
  attributable to one change at a time.
