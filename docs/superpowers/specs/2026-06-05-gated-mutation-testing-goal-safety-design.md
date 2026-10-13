# Gated Mutation Testing for Hard-Exclusion "Crown Jewel" Modules

**Date:** 2026-06-05
**Status:** Approved design (brainstormed, empirically grounded) — pending implementation plan
**Author:** Human-authored (the brainstorm itself satisfies the Hard-Exclusion "human-authored plan" requirement)
**First instance:** the goal-safety domain — `adaptive-goals.ts` (deep) + `goal-calculator.ts` (ride-along)
**Builds on:** `docs/superpowers/specs/2026-06-05-mutation-testing-test-quality-design.md` (the base harness),
`docs/solutions/best-practices/stryker-vitest4-mutation-testing-harness-2026-06-05.md`,
`docs/solutions/conventions/mutation-testing-suppress-only-equivalent-mutants-2026-06-05.md`

---

## Problem

The base mutation-testing harness (PR #381) deliberately **fenced off the Hard
Exclusions** (`.github/copilot-instructions.md:31-44`): auth, goal-safety, IAP,
health-data, secrets, schema/migrations. Its registry has a CI guard
(`test/stryker-targets.test.ts`) that hard-fails if any excluded path is added.
Those modules are the highest-stakes code in the app and were left unmeasured.

The brief: extend mutation testing to those crown jewels **without** violating the
policy. The policy nuance (base spec lines 59-65) is the hinge:

- Mutation testing is **read-only on production code** — Stryker mutates ephemeral
  copies in `.stryker-tmp/` and discards them; the source is never edited. So the
  policy does **not** forbid _pointing the tool_ at excluded files.
- What the policy forbids is **delegating the authorship of the killing assertions
  and the interpretation of behavior**. A wrong assertion on goal-safety code could
  lock in an _unsafe_ expectation (e.g. assert the wrong calorie floor).

This spec is the **human-authored process** that the Hard Exclusions require. It
defines a reusable, gated protocol and applies it to the first real instance.

## Empirical grounding (measured, not predicted)

Two facts were established by running the harness before this spec was written —
both corrected an initial wrong assumption that Stryker mutates numeric literals:

1. **Stryker 9.6.1 has no numeric-literal mutator.** The default set is operator /
   structure / string / boolean only (`ArithmeticOperator`, `ConditionalExpression`,
   `EqualityOperator`, `LogicalOperator`, `MethodExpression`, `ObjectLiteral`,
   `StringLiteral`, `UnaryOperator`, `UpdateOperator`, `BooleanLiteral`,
   `ArrayDeclaration`, `ArrowFunction`, `BlockStatement`, `AssignmentOperator`,
   `OptionalChaining`, `Regex`). Consequence: **the exact safety-constant magnitudes
   are structurally invisible to the tool** — `MIN_DAILY_CALORIES = 1200 → 1201`,
   `1.375 → 1.376`, `0.4 → 0.41` are **not mutants**. Mutation testing here validates
   _formula structure and operators_, not constant _values_. The constants still need
   value-pinning tests (mostly already present) and are out of Stryker's reach.

2. **Baselines (DB-free, scoped to each module's dedicated unit test):**

   | Module               | Score      | Killed | Survived | Survivor character                                                                                                                                                                                                             |
   | -------------------- | ---------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `goal-calculator.ts` | **95.24%** | 40     | **2**    | Two `ObjectLiteral` survivors only: `eat_healthier` and `manage_condition` macro-split objects → `{}` (those two goals are never passed to `calculateGoals`). Non-safety; not the floor.                                       |
   | `adaptive-goals.ts`  | **75.82%** | 116    | **37**   | Branch-and-boundary-dense, incl. safety-relevant gaps (the 10%-deviation gate, day-span/log-count guards, `determineReason` conditionals). Same goal-safety domain; **also DB-free** (its service test mocks `../../storage`). |

   This is why the first instance is **`adaptive-goals` (deep) with `goal-calculator`
   as a trivial ride-along** (close its 2 untested-goal survivors). `goal-calculator`
   alone would be ceremony around almost nothing.

## The core safety boundary: operation × rigor (READ-ONLY on excluded source)

"Hard-Exclusion" is not binary. The triage performs several operations at different
stakes. The governing rule for an **excluded** module:

| Operation                                              | Edits excluded source? | Rigor                                                                                                                                           |
| ------------------------------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Mutate ephemeral copy (Stryker dry/test run)           | No (read-only)         | Lowest — allowed freely (incl. pre-approval baseline spikes, see explore script)                                                                |
| Add / strengthen a **test** assertion                  | No (test file only)    | The gated authoring act — see triage decision-tree + double-derivation + mismatch rule                                                          |
| Suppress an "equivalent" mutant (`// Stryker disable`) | **YES**                | **BANNED** — record as accepted-equivalent in a tracked allowlist instead (below)                                                               |
| Remove "dead" code                                     | **YES**                | **BANNED in triage** — **escalate to the human as a finding**; any removal is a separate, deliberate, reviewed change outside the mutation work |

**Rule:** on a Hard-Exclusion target, _only test files change._ The source is never
edited — not even a comment — so the "read-only on production code" property that
makes this policy-permissible stays intact.

**Consequence for scoring (logical, not optional):** a _genuinely_ equivalent mutant
cannot be killed by a test (by definition) and cannot be suppressed in-source
(read-only) → it survives permanently → the target's score may legitimately be < 100%.
Therefore the CI gate compares the surviving-mutant **set**, not a bare score (see CI).

## Triage decision-tree (sized to the real survivor distribution)

The 37 `adaptive-goals` survivors bucket as follows (measured). The novel
double-derivation machinery governs only the numeric minority; ~80% is conventional
work under the **existing** integrity rules. The spec presents triage as a tree:

| Branch                                     | Survivor mutators (count)                                                             | How a survivor is killed                                                                                                                                                                                                                         | Independent check                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Boundary / conditional** (~19, ~51%)     | `EqualityOperator` (5), `ConditionalExpression` (10), `LogicalOperator` (4)           | Feed the **on-the-tie input** and assert the documented branch. E.g. exactly 10% deviation pins `< 0.1` vs `<= 0.1`; exactly 14 days pins `daySpan < 14`; exactly 4 logs pins `length < 4`; `weightChange === 0` pins `determineReason`'s `> 0`. | Existing convention (["pin boundaries with on-the-tie inputs"]). The oracle confirms _which branch_ should fire; the tie-input is self-evident. |
| **Arithmetic** (~12, ~32%)                 | `ArithmeticOperator`                                                                  | Genuinely numeric **outputs** (`daySpan`, `weeklyRate`, `deviation`, `weightTrendRate` rounding — ~6–8) get the heavy branch (double-derivation, below). The rest are operator-flips already killed by the boundary assertions.                  | **Double-derivation** for numeric outputs only.                                                                                                 |
| **Weak-assertion / structural** (~6, ~16%) | `ObjectLiteral` (2), `MethodExpression` (2), `ArrowFunction` (1), `StringLiteral` (1) | Strengthen the assertion so the derived value is actually checked (e.g. assert `currentMacros` flows into the recommendation; assert a null profile defaults to `maintain`).                                                                     | Existing convention.                                                                                                                            |

## The gated authoring act

### Double-derivation (numeric outputs only — the heavy branch)

For each numeric-output survivor:

1. **Derivation A (author, in-session):** I hand-derive the expected value from the
   documented formula, written as a **durable test comment** (matching the existing
   `// Mifflin-St Jeor: …` style).
2. **Derivation B (independent cross-check, two channels):**
   - **Second-channel oracle** (user-authorized verification-only delegation): a
     separate channel independently recomputes the value from the formula spec +
     the relayed constant — it never sees the SUT (circularity guard).
   - **Deterministic reference calc** (complement): a ≤5-line standalone snippet
     re-encoding the formula from first principles (also never imports the SUT).
     An LLM is the least reliable arithmetic checker, so this belt-and-suspenders
     calc backs it for numeric survivors.
3. **Commit only if A === B (both channels).**

### Verification chain — what each layer guarantees

- **Oracle + reference agreement** ⇒ the _arithmetic_ is correct.
- **Assertion passes against real SUT** ⇒ the _constant was relayed correctly_ and no
  defect surfaced.
- **Human / spec sign-off** ⇒ the _business-constant intent_ is correct (−500, 1200,
  the macro splits — these have **no external truth**; they are product decisions, so
  the oracle can only verify "arithmetic given X," and the human anchors X).

### The mismatch-escalation rule (centerpiece — inverts the non-excluded convention)

When an **independently-derived** assertion **disagrees with the SUT output**, the
protocol **STOPS and escalates to the human**. That disagreement is a _candidate
defect in a safety-critical module_ — the entire payoff of independent derivation.

> **Never auto-adjust the assertion to match the code.** This deliberately **inverts**
> `mutation-testing-suppress-only-equivalent-mutants`'s "if an assertion fails, the
> assertion is wrong — fix it, never the code." That rule is correct for ordinary
> modules and **backwards for crown jewels.**

(For non-numeric branches the same principle applies: if the documented branch
behavior at a boundary disagrees with the SUT, escalate — do not "discover" the
behavior from the code and assert that.)

## Components

### 1. Registry-approval gate — relax the guard without losing it (transferable)

`stryker.targets.mjs` becomes the single source of truth for **both** the target map
**and** the Hard-Exclusion gate:

- Add `HUMAN_APPROVED_EXCLUSIONS`: `modulePath → { approvedOn, planPath, note }`
  where `planPath` / `note` **must be non-empty** (fail-closed: an empty/stub entry
  does not count as approval).
- Export shared gate helpers: `isHardExclusion(path)` (the forbidden regex, lifted
  out of the test) and `assertAllowedTarget(paths)` (throws unless every excluded
  path has a non-empty approval entry).
- `test/stryker-targets.test.ts` **inverts**: instead of "forbidden ⇒ fail," it
  asserts every registry path passes `assertAllowedTarget`. An _unapproved_ excluded
  module (e.g. a delegated agent sneaking in `auth.ts`) still fails CI; a
  human-approved one passes **with provenance recorded in code**.
- `adaptive-goals` and `goal-calculator` get approval entries pointing at this spec.

### 2. Gate-respecting exploration CLI (operator UX, transferable)

`scripts/mutation-explore.mjs` + `npm run mutation:explore -- <mutate-glob> <test-glob>`
(npm script: `"mutation:explore": "tsx scripts/mutation-explore.mjs"` — `tsx` runs `.mjs`):

- **Extension is `.mjs`, not `.ts`, mirroring `stryker.conf.mjs`.** The script must
  import the **shared** gate helpers from `stryker.targets.mjs`; a `.ts` script
  importing the `.mjs` registry re-introduces the `.ts`→`.mjs` type-aware-ESLint
  "project-service" failure the base harness was engineered to avoid (base spec lines
  114-118 — the env-handoff exists precisely so no `.ts` imports the `.mjs`). `.mjs` is
  outside the `**/*.{ts,tsx}` type-aware block, so this sidesteps it; `// @ts-check`
  gives the same JSDoc-level safety the other configs use. (`tsx` runs `.mjs` natively,
  so operator UX is unchanged.)
- Validates the globs through the **shared** `isHardExclusion` / `assertAllowedTarget`
  (no drift from the registry guard).
- **Default-deny** excluded paths (honors "gate-respecting").
- **`--spike` flag**: permits a **read-only baseline** on an unapproved excluded path,
  printing a loud banner that this is _measurement only_ and that authoring tests for
  the module requires registry approval + a human plan. (Resolves the otherwise-fatal
  contradiction that a strict gate would block the very pre-approval spike that sizes
  a candidate — and it is sound because a baseline run is read-only.) Generalizes the
  throwaway `stryker.explore.mjs` used to size this spec into a committed, gated tool.

### 3. CI: required, self-scoping gate + survivor-set check (transferable)

`.github/workflows/mutation-goal-safety.yml` (or extend `mutation.yml`):

- **Required-check + skip-shim (the non-obvious part — solve it here, don't punt):**
  to _enforce_ (catch a regression), the gate must be a **required** status check. But
  a workflow-level `pull_request: paths:` filter would not run on PRs that don't touch
  the target — leaving a required check stuck on "Expected — waiting for status" and
  **deadlocking every unrelated PR** (this repo already has 5 required `ci.yml` checks
  with `strict:false`, so it _will_ hit this). Resolution: the workflow runs on **all**
  PRs (no workflow-level `paths:` filter) and **self-scopes internally** — a first step
  computes whether the target source/test changed (`dorny/paths-filter` or `git diff
--name-only origin/main`); if unchanged it **reports success immediately** (no
  Stryker run, ~seconds). The result: a single stable required check that is
  near-instant on unrelated PRs and runs Stryker only when the target actually changes.
  DB-free; ~6–10s when it runs.
- **Threshold model (reality selects):**
  - If full triage kills everything killable and leaves **zero** genuine equivalents
    → allowlist empty → plain Stryker `break = 100`. Simplest; **strongly preferred**
    (see fragility note).
  - If genuine equivalents remain → record each in
    `docs/mutation-testing/accepted-equivalents.json` (`target → [{file, line,
mutator, reason}]`) and a CI step asserts **`survivors ⊆ accepted`** (parses
    Stryker's JSON report). A _new_ survivor fails even at unchanged count; a
    _killed_ known-equivalent passes (and prunes the list). `break` is set to the
    residual score as a coarse backstop.
  - **Known fragility of the set-check (why empty is near-required):** mutant identity
    is `file:line:mutator`, and the gate fires precisely _when the source changes_ — so
    any line insertion in a future PR shifts every accepted-equivalent's line number
    and a stale allowlist yields **spurious failures**. Triage itself is read-only and
    won't shift lines, but _future_ legitimate edits will. So: kill everything killable
    and keep the allowlist empty; if an allowlist is unavoidable, it must be
    re-baselined whenever the source shifts (or adopt a more stable mutant identity
    than raw line number). This is a deliberately deferred sharp edge, named here.

### 4. Durable records (tracked source of truth)

- `docs/mutation-testing/baselines.md`: before/after rows for `adaptive-goals`; a
  single row for `goal-calculator`.
- `docs/mutation-testing/accepted-equivalents.json`: the machine-readable allowlist
  (only if non-empty).
- One `docs/solutions/` best-practice doc codifying this protocol: the
  operation × rigor matrix, the read-only rule, the mismatch-escalation rule, the
  verification chain, and the modest-reusability caveat.

## Scope boundaries (keeps the spec honest)

Reusability is **modest**. The genuinely transferable artifacts are: the
registry-approval gate (#1), the exploration CLI (#2), the CI self-scoping
required-gate + survivor-set pattern (#3), and the existing integrity rules. **Double-derivation /
oracle is a numeric-module technique** — it does **not** transfer to `auth.ts` (what
is the "independent derivation" of _returns 401 on an expired token_?) or
`receipt-validation` crypto, whose hard part is the **harness** (Express / jwt /
storage mocks, module-load side effects like the `JWT_SECRET` throw and the sweep
`setInterval`, JWS stubs). Those remain GATED; each needs its **own** human-authored
plan focused on _harness construction_, reusing only #1–#3 + the integrity rules.
This instance teaches the gate and the triage discipline, **not** the harness work
that dominates the harder modules.

## Execution model

All authoring happens in this human-supervised session (never delegated). The
second-channel oracle is verification-only (explicit user authorization, overriding
the standing "never delegate health logic" rule **for verification only**). Output is
a PR with **no auto-merge** (touches test infra + a Hard-Exclusion module's tests),
human-reviewed.

## Phasing

- **Phase A — Gate + tooling (human-authored; NOT delegatable):** extract shared gate
  helpers + `HUMAN_APPROVED_EXCLUSIONS`; invert the guard test; add the
  `mutation:explore` CLI. Add `adaptive-goals` + `goal-calculator` approval entries +
  registry targets. **The guard-test inversion is security-sensitive logic** — it
  protects _every_ Hard-Exclusion module, and a fail-_open_ mistake (the guard passing
  an unapproved excluded path) silently defeats the whole protocol — so it is authored
  in-session, never delegated. The base spec's "delegatable" phases applied only to
  _non-excluded_ modules; that label does **not** carry over to a phase that touches
  the exclusion gate.
- **Phase B — goal-calculator ride-along:** record the 95.24% baseline; add the two
  untested-goal (`eat_healthier`, `manage_condition`) test cases to kill the 2
  `ObjectLiteral` survivors; re-run → expect 100%.
- **Phase C — adaptive-goals deep (the gated act):** record the 75.82% baseline;
  triage the 37 survivors via the decision-tree (boundary inputs, assertion
  strengthening, double-derivation for the numeric minority); apply the
  mismatch-escalation rule on any disagreement; **never** edit the source. Land
  final score + accepted-equivalents (if any).
- **Phase D — CI + codify:** add the required self-scoping PR gate (`break = 100` or
  `survivors ⊆ accepted`); resolve the `dorny/paths-filter` vs `git diff --name-only
origin/main` choice for the self-scoping step here; update baselines; **update
  `docs/mutation-testing/README.md`** — it currently says "only non-excluded modules
  are targeted" and states the inline `// Stryker disable` suppression rule
  _unconditionally_, both of which contradict this protocol. The README must (a) note
  that some Hard-Exclusion modules are now targeted under approved plans, and (b)
  distinguish suppression behavior: inline `// Stryker disable` for **non-excluded**
  modules vs. the read-only `accepted-equivalents.json` allowlist for **excluded**
  modules. Write the solution doc.

## Success criteria

- Gate helpers are the single source of truth; the inverted guard test still
  fails-closed on an unapproved excluded path (proven by a test case).
- `mutation:explore` refuses an unapproved excluded path without `--spike`, and runs a
  read-only baseline with `--spike` (banner shown).
- `goal-calculator` reaches 100% by covering the two untested goals (no source edit).
- Every `adaptive-goals` survivor is either killed by a test or recorded as a
  verified accepted-equivalent; **zero source edits** to `adaptive-goals.ts`; every
  numeric assertion has both derivations agreeing; any derivation-vs-SUT mismatch was
  escalated, not silently reconciled.
- Path-filtered PR gate is green and correctly scoped (does not run on unrelated PRs).
- Baselines + (if any) accepted-equivalents + solution doc are committed.

## Validation plan

1. The inverted guard test has fixtures for **both** cases: a fake `auth.ts` entry with
   an empty `note` **fails** `assertAllowedTarget` (fail-closed, verified not assumed),
   and a fake entry with a non-empty `note` + `planPath` **passes**.
2. `mutation:explore` is exercised three ways: non-excluded path (runs), excluded path
   without `--spike` (refused), excluded path with `--spike` (read-only baseline).
3. A deliberate mismatch dry-run: temporarily assert a wrong expected value for one
   numeric survivor and confirm the protocol surfaces it as an escalation (then
   discard) — proves the mismatch rule is operative, not decorative.
4. CI gate runs DB-free and is a single **required** check that never deadlocks: on a
   PR not touching the target it self-scopes to immediate success (the required check
   still reports green in seconds); on a PR touching the target it runs Stryker. Both
   paths are exercised before the gate is marked required. An admin adds the
   required-check entry to branch protection **only after** the workflow has merged and
   reported at least once (a check cannot be marked required until it exists).
5. `npm run check:types` and `npm run lint` pass after Phase A — covering the new
   exports in `stryker.targets.mjs` and the new `scripts/mutation-explore.mjs`. (This is
   the item that would catch a `.ts`→`.mjs` regression if the CLI extension were ever
   changed back to `.ts`.)

## Notes

- This spec lives under `docs/superpowers/specs/` (gitignored, local-only by
  convention). The tracked durable records are `docs/mutation-testing/baselines.md`,
  `docs/mutation-testing/accepted-equivalents.json` (if any), and the `docs/solutions/`
  doc.
- The base-harness spec/plan and the two solution docs remain the prerequisite
  reading for the harness mechanics (config gotchas, the `mutate` vs `include` axes).
