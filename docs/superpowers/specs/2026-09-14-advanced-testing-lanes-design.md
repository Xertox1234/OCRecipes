# Advanced Testing Lanes — Contract, Property/Metamorphic, Nightly Evals, Visual, A11y, Mutation-on-Diff

- **Date:** 2026-09-14
- **Status:** design approved in brainstorming (Sections 1–12); awaiting user review of this document before `writing-plans`
- **Tracking:** this file is local-only (`docs/superpowers/` is gitignored, `.gitignore:104`, by project convention). The durable, tracked artifacts of this work are the todos it produces, the `docs/rules/testing.md` directives in Phase 2, and the `/codify` solution docs.
- **Precedents in this directory:** `2026-06-05-mutation-testing-test-quality-design.md`, `2026-06-05-gated-mutation-testing-goal-safety-design.md`, `2026-04-13-nutrition-coach-evaluation-design.md`, `2026-05-04-eval-framework-extension-design.md`. This spec builds on all four rather than replacing any of them.

## Problem

A 2026-09-06 read-only audit compared the project's testing to current advanced practice. The project already runs two "advanced" methods at CI-gating strength — mutation testing with a hard-exclusion governance policy, and property-based testing with an enforced seed-pinning convention — and partially covers two more (a hand-rolled LLM-judge eval harness; accessibility split across static lint, contrast unit tests, and a manual TalkBack technique). Four gaps remained, each mapping to a defect class the user considers release-blocking:

| Defect class                    | What is missing today                                                                                                                                                                              | Evidence                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Client↔server contract drift   | No route test validates a response body against the schema the client parses with. Nine client-side `safeParse` sites; zero route files import any of those schemas.                               | grep over `client/`, `server/routes/`, `shared/` |
| Nutrition data correctness      | One property-based suite exists (`chat-history-truncate`). The numeric/normalisation cores behind shipped bugs (`civil-date`, `recipe-normalization`, `nutrition-lookup`) have example tests only. | `find . -name '*.property.test.ts'` → 1 file     |
| AI output regressions           | `evals/` (5 suites, ~99 cases, deterministic assertions + LLM judge + bootstrap CIs) runs only by hand. No CI cadence, no baseline, no regression detection.                                       | no workflow references `npm run eval`            |
| On-device UI / a11y regressions | Maestro flows assert presence, not pixels; no `takeScreenshot` in any flow. No automated accessibility-tree check on any platform.                                                                 | grep `takeScreenshot` in `e2e/` → 0              |

A second, cross-cutting problem surfaced during brainstorming and was measured rather than assumed: **"prove the test can fail" is mechanised at the tooling layer and absent at the app-code layer.**

| Where                                                                          | Applied?                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/check-*.js` lint gates                                                | 8 of 8 have a test feeding a failing fixture                                                                                                                                                                           |
| `.claude/hooks/*.sh`                                                           | 15 of 19 have a co-located `test-<name>.sh`; deny-branch completeness verified for 1 (`guard-outward-cli`, PR #935). Without: `drift-detect-update`, `session-coord-hook`, `session-start`, `repro-outward-cli-corpus` |
| Stryker registry                                                               | 10 targets of 94 non-test modules under `server/lib` + `server/services`; 9 of 10 wired into a workflow (`nutrition-band-source` is a documented placeholder awaiting a baseline)                                      |
| App unit tests                                                                 | no mechanism: 0 uses of `it.fails`, 0 of `expect.assertions`, no rule in `docs/rules/testing.md`, nothing verifies the TDD red step                                                                                    |
| Codified incidents whose title is a test/guard that never proved it could fail | 10 solution docs, all since 2026-06                                                                                                                                                                                    |

## Decisions already made (fixed points)

Agreed in brainstorming; the rest of this document is constrained by them.

1. **All four defect classes are in scope.**
2. **Deterministic lanes gate PRs by joining the existing Vitest shards; probabilistic lanes run nightly/manually and never block a merge.** No new required-check name is added. The required-check list before and after this work must be identical (verified in the validation plan, not asserted).
3. **Open-source only.** No Percy/Chromatic, no Braintrust/DeepEval, no Pact broker.
4. **Mechanism-first thin slices.** Every lane ships its reusable mechanism plus one anchor in the highest-value spot, and a convention or guard that makes it grow without a follow-up sweep.
5. **"Prove it can fail" is a floor rule for every lane, plus Lane F (mutation-on-diff) generalises it to arbitrary changed code.** Generalising hook deny-branch completeness across all hooks is explicitly _not_ in this spec (separate decision-todo; hooks are the highest-review-cost domain).

## Approach (chosen): six lanes on two rails

| Rail          | Lane                                                | Runs where                                       | Gate                                |
| ------------- | --------------------------------------------------- | ------------------------------------------------ | ----------------------------------- |
| Deterministic | **A.** Provider-side contract tests                 | existing Vitest shards                           | already required                    |
| Deterministic | **B.** Property-based + metamorphic tests           | existing Vitest shards, `*.property.test.ts`     | already required                    |
| Deterministic | **F.** Mutation-on-diff                             | new `mutation-on-diff.yml`, per PR               | advisory (never red in this effort) |
| Probabilistic | **C.** LLM evals with baseline regression detection | new `evals-nightly.yml`                          | advisory; files an issue            |
| Probabilistic | **D.** Visual regression                            | existing `e2e-regression.yml`, `visual` tag      | advisory; files an issue            |
| Probabilistic | **E.** A11y hierarchy sweep                         | existing `e2e-regression.yml`, same screens as D | advisory; files an issue            |

Rail-1 lanes are ordinary test files under existing conventions, so they inherit coverage thresholds (`vitest.config.ts` lines 62–71), `retry: 2`, 3-way sharding, and lint-staged for free. Rail-2 lanes mirror the E2E posture already documented in `e2e/README.md` lines 40–58 (never a required check; a red run is visible in the Issues tab via `notify-on-failure`).

Lane F is deterministic in _mechanism_ (a mutant is killed or it is not; the mutation config sets `retry: 0`) but is placed on the advisory side because its runtime and its score on modules with heavy mocking are unmeasured. Its threshold posture is a separate decision after data exists.

## Cross-cutting principle: prove it can fail (the floor rule)

Every script, guard, or harness introduced by this work that _gates or measures_ ships with a test that feeds it a bad input and asserts it rejects — permanently, in the Vitest shards, not as a one-time Phase 0 check. A test that has never been observed red is not evidence. This is the pattern the eight `scripts/check-*.js` tests already follow, written down and applied to the new lanes:

| Lane artefact                                             | Its permanent negative-fixture test                                                                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/utils/expect-response-schema.ts`                    | invalid body → throws with a path-level message listing each Zod issue                                                                                                                                 |
| `scripts/__tests__/contract-coverage-guard.test.ts`       | a synthetic client parse site with no provider-side reference → guard fails naming the schema, the client file, and the endpoint                                                                       |
| `scripts/ci/eval-compare.ts`                              | a doctored results JSON trips each of the three regression rules _independently_; a matching one passes                                                                                                |
| `scripts/ci/visual-diff.ts`                               | a committed tiny PNG pair: identical → pass; shifted → mismatch above tolerance                                                                                                                        |
| `scripts/ci/a11y-sweep.ts`                                | a hierarchy fixture containing an unlabelled interactive element → R1 fires; labelled → passes                                                                                                         |
| `scripts/ci/mutation-on-diff.mjs` (eligible-set function) | hard-excluded path out; test-less module reported as untested; registered target skipped; `.tsx` skipped; cap enforced                                                                                 |
| Lane B property files                                     | no permanent fixture (property files are outside Stryker `testInclude` by convention); the PR that adds each file shows the red run against a hand-broken implementation and the shrunk counterexample |

Phase 2 adds this as a binding directive to `docs/rules/testing.md` (2950 B of the 6500 B cap used; headroom confirmed).

## Non-goals (stated so they do not drift back in)

- Fuzz testing — every input boundary is a Zod schema; property tests over those schemas give fuzz-shaped coverage (`normalizeRecipeFields` never throws on arbitrary strings).
- `axe-core` under jsdom — it would audit the RN mock's translation (`test/mocks/react-native.ts`), not the real accessibility tree; `scripts/check-accessibility.js` already covers what jsdom could see.
- Consumer-side / `msw` contract tests — the gap is provider-side; hook tests already mock transport. `msw` is removed as a dead dependency in Lane A.
- Per-PR evals; visual baselines for every screen; a11y sweep beyond the Lane D screens.
- Expanding the Stryker registry as part of this effort (Lane F's funnel produces candidates; registration stays a separate, human decision with a baseline).
- Chaos engineering; any vendor; baselines generated on a local simulator; Android physical-device work.
- Generalising hook deny-branch completeness (#935's pattern) across the other hooks — its own spec.
- Promoting any lane to a required check — a separate decision after the success criteria below have been met.

## Shared mechanism: baselines, tolerance, rebaseline PR, notification (serves C and D)

Both probabilistic lanes need the same three things or they either flake forever or silently rebaseline. One mechanism, two consumers.

1. **Baselines are committed files.**
   - D: `e2e/baselines/<ios|android>/<screen>.png`, plus `e2e/baselines/manifest.json` holding per-screen tolerance overrides.
   - C: `evals/baselines/<suite>.json` — `{ suite, generatedAt, judgeModel, totalCases, assertionPassRate, overall: {mean, lower, upper}, dimensions: { <dim>: {mean, lower, upper} } }`, i.e. the fields `aggregateResults()` in `evals/lib/runner-core.ts` already produces.
2. **A diff step with an explicit tolerance** (details per lane below). Diff artefacts are always uploaded; the step summary carries a table.
3. **Rebaselining is a PR, never a side effect.** Each workflow takes a `workflow_dispatch` boolean input `rebaseline`. When true, the run refreshes the baseline files and opens a PR containing only those files (title `chore(baselines): refresh <lane> baselines <date>`). A human accepts an intentional UI change or a prompt improvement by reviewing a diff. Nothing rebaselines itself. Initial baselines are produced by the first such dispatch in Phase 0 and reviewed like any other PR.
   - **Token rule:** the branch push and PR creation use a dedicated fine-grained PAT stored as the repository secret `BASELINE_PR_TOKEN` (scopes: contents + pull-requests write, this repo only), **not** the default `GITHUB_TOKEN` — pushes and PRs made with `GITHUB_TOKEN` do not trigger other workflows, so the PR would carry no required checks and be unmergeable under branch protection. C0 and D0 each verify that their first baseline PR receives its required checks. The user creates this secret; it is never written by a workflow or an agent.
4. **Failure surfacing reuses `notify-on-failure`** (`e2e-regression.yml` lines 685–745). D and E ride the existing `e2e-regression-failure` issue, with diff/hierarchy artefacts linked in the comment. C gets a sibling job in its own workflow with label `evals-regression-failure`.

E has no baseline — it is rule-based pass/fail — so it uses only the notification half.

Rationale for "PR, not side effect": the project's own memory records a retry layer hiding attempt-1 failures and a pin that recorded a verdict's value without recording whether it was correct. An auto-rebaselining lane is that failure mode built into infrastructure — after one bad night every later night is green against a wrong reference. A human-reviewed diff keeps the baseline _correct_, not merely _current_.

## Lane A — Provider-side contract tests

**Gap, precisely:** the client validates nine response bodies with Zod schemas; no route test checks that the route produces something those schemas accept. TypeScript covers storage→route; nothing covers route→client-schema.

**Mechanism (the one new piece):** `test/utils/expect-response-schema.ts` exporting `expectResponseToMatch(body, schema)`. It runs `schema.safeParse(body)` and, on failure, throws an assertion whose message lists every issue as `<path>: <message>`, so a contract break reads as `items[0].calories: Expected number, received string`. Applied inside the **existing** route test file for each anchor, on its success-path case, using the typed mock factories in `server/__tests__/factories/` so fixtures are type-checked against storage return types. Plain `safeParse` is the right strictness: extra server fields are not a drift risk for the client; missing or mistyped ones are.

**Anchors (the nine `safeParse` sites, located this session):**

| Schema                              | Defined in                                          | Client parse site                                | Route                                                                                             |
| ----------------------------------- | --------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `recipeSearchResponseSchema`        | `shared/types/recipe-search.ts:106`                 | `client/hooks/useRecipeSearch.ts`                | `/api/recipes/search`                                                                             |
| `catalogSearchResponseSchema`       | `shared/types/recipe-catalog.ts:17`                 | `client/hooks/useCatalogSearch.ts`               | catalog search route                                                                              |
| `catalogConfigResponseSchema`       | `shared/types/recipe-catalog.ts:41`                 | `client/hooks/useCatalogConfig.ts`               | catalog config route                                                                              |
| `receiptConfirmResultSchema`        | not located by `^export const` grep — A0 locates it | `client/hooks/useReceiptScan.ts`                 | `/api/receipt/confirm`                                                                            |
| `receiptAnalysisResultSchema`       | not located — A0 locates it                         | `client/hooks/useReceiptScan.ts`                 | receipt analysis route                                                                            |
| `tastePicksResponseSchema`          | `shared/schemas/taste-picks.ts`                     | `client/screens/TasteProfileScreen.tsx`          | taste-picks route                                                                                 |
| `tastePickCandidatesResponseSchema` | `shared/schemas/taste-picks.ts`                     | `TastePicksScreen.tsx`, `TasteProfileScreen.tsx` | taste-pick candidates route                                                                       |
| `coachBlockSchema`                  | `shared/schemas/coach-blocks.ts`                    | `client/components/coach/coach-chat-utils.ts`    | coach stream (SSE) — asserted per emitted block at the service boundary, not on one response body |

Decision rule for the receipt pair: if A0 finds them under `client/`, move them to `shared/` (a client-only response schema is unenforceable by definition); if under `shared/` already, import them in the route test as-is.

**Self-sustaining enforcement:** `scripts/__tests__/contract-coverage-guard.test.ts`, on the precedent of `scripts/__tests__/fast-check-property-seed-guard.test.ts`. It scans `client/` for `<name>Schema.safeParse(` / `<name>Schema.parse(` call sites and fails if any such schema name has no reference under `server/**/__tests__/` or `test/integration/`. The failure message names the schema, the client file, and the endpoint. It lands in A0 with an **allowlist** of the current nine so it is green on arrival; each A1 anchor removes its own entry. Any _future_ client-side parse site without a provider-side assertion fails the required Tests shards. That is the "grows by convention" property and why this lane never needs a follow-up sweep.

**Housekeeping folded in:** remove the unused `msw` devDependency (`package.json`; zero imports repo-wide, verified).

## Lane B — Property-based + metamorphic tests

**Mechanism:** already complete — `fast-check ^4.9.0`, `*.property.test.ts` discovery by the base include glob, the seed-pinning rule (`docs/solutions/conventions/fast-check-property-tests-pin-seed-not-in-mutation-testinclude-2026-07-12.md`) enforced by `scripts/__tests__/fast-check-property-seed-guard.test.ts`, exclusion from Stryker `testInclude`. Metamorphic testing is a _relation style_ inside this lane, not a new tool.

**One convention added:** each property file opens with a **relations header** comment naming every relation it claims, so the file name and its assertions cannot drift apart (the failure mode in `docs/solutions/code-quality/test-named-for-a-property-must-assert-the-property-not-a-literal-2026-08-31.md`).

**Anchors, with relations named now:**

1. `server/lib/civil-date.ts` — the module behind a shipped calendar-day bug. Exports: `civilMidnightUtcMs`, `civilDateString`, `civilDateToInstant`, `civilHourInTz`.
   - Round-trip: `civilDateString(civilDateToInstant(s, tz), tz) === s` over generated `YYYY-MM-DD` strings × a timezone sample spanning both sides of Greenwich and a DST zone.
   - Range: `civilHourInTz(d, tz) ∈ [0, 23]`.
   - Monotone: `civilMidnightUtcMs` strictly increasing in the civil date for a fixed tz.
2. `server/lib/recipe-normalization.ts` — seven pure exports: `normalizeTitle`, `normalizeDescription`, `normalizeDifficulty`, `normalizeInstructions`, `normalizeUnit`, `normalizeIngredient`, `normalizeRecipeFields`.
   - Idempotence: `f(f(x))` deep-equals `f(x)` for all seven.
   - Quantity preservation: `normalizeIngredient` never alters the numeric amount.
   - Robustness: `normalizeRecipeFields` never throws on arbitrary strings (fuzz-shaped coverage).
3. `server/services/nutrition-lookup.ts` — the metamorphic anchor. With the three providers mocked (`fc.asyncProperty`):
   - Batch ≡ map: `batchNutritionLookup(items)` equals `new Map(items.map(i => [i, await lookupNutrition(i)]))` for all lists including empty and duplicates (use `_resetCNFCacheForTesting()` between runs).
   - Fallback-order invariant: when CNF resolves, USDA and API Ninjas are never called.
   - `countNonNullNutritionFields` is monotone non-decreasing as non-null inputs are added; `mapLabelToNutritionData` preserves each provided numeric field exactly.
4. **Stretch:** `server/lib/macro-gap-context.ts` (`buildMacroGapEmphasis`) — already 100 % mutation-killed, so properties add only input breadth. Last in, first cut.

Conventions: `numRuns: 100`, pinned seed per file, relations header, `*.property.test.ts` beside the existing example suite for the same module. No new enforcement needed.

## Lane C — Nightly LLM evals with regression detection

**Workflow:** new `.github/workflows/evals-nightly.yml`. Cron offset from the E2E nightly's `17 8 * * *` slot (pick a different minute and hour; not top-of-hour). `workflow_dispatch` inputs: `suite` (`all` | `coach` | `recipe-chat` | `meal-suggestions` | `recipe-generation` | `photo`) and `rebaseline` (boolean). Ubuntu runner. **No Postgres service:** none of the five eval-target services import storage (verified by grep), and `evals/lib/eval-results-store.ts` no-ops by design when `ocrecipes_lab` is unreachable. C0 proves this with a dry run before the cron is enabled.

**Pinned in the workflow, not in code:** `EVAL_JUDGE_MODEL` set explicitly (today's default `claude-sonnet-4-6` in `judge-generic.ts`), so a default bump cannot silently move the baseline; `EVAL_SAMPLES_PER_CASE=1`; `EVAL_PARALLELISM=4`. `NODE_ENV` unset (the runner refuses `production` without `--allow-prod`). Secrets: `ANTHROPIC_API_KEY`, `AI_INTEGRATIONS_OPENAI_API_KEY` (and the OpenAI base URL if the service requires it) as repository secrets. `scripts/check-eval-dataset-secrets.js` already guards datasets.

**Compare step:** `scripts/ci/eval-compare.ts` reads the results JSON the runner already writes (`evals/lib/runner-core.ts:545`) and `evals/baselines/<suite>.json`. Any one rule fails the job:

| Rule       | Condition                                                           | Why this form                                                                                                               |
| ---------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Overall    | `current.overall.mean < baseline.overall.lower`                     | uses the bootstrap 2.5th percentile already computed (1000 iterations, seed 42); no new statistics                          |
| Safety     | `current.dimensions.safety.mean < baseline.dimensions.safety.lower` | safety is 2×-weighted, but a safety-only regression must flag even when overall holds                                       |
| Assertions | `current.assertionPassRate < baseline.assertionPassRate`            | deterministic assertions (`evals/assertions.ts`: `runAssertions`, `runStructuralAssertions`) are hard rules; zero tolerance |

**Sensitivity caveat, stated now:** the bootstrap is over cases, and two suites (photo, recipe-generation) have 12. Their bounds will be wide — low false-alarm rate, low sensitivity. Decision rule: if, after five nightly runs, C0's data shows a known-bad doctored run inside the bounds for a 12-case suite, set `EVAL_SAMPLES_PER_CASE=3` for those two suites only (cost ×3 on them, not globally).

**Cost (estimate; C0 measures the real figure from the provider dashboards):** roughly 99 generation calls and 99 judge calls per night; expected in the low single-digit dollars per night.

**Artefacts:** results JSON per suite, a markdown summary via `$GITHUB_STEP_SUMMARY`. Failure → `notify-on-failure` sibling with label `evals-regression-failure`.

## Lane D — Visual regression on the Maestro nightly

**Screens (thin slice, ~5), chosen for stable seeded content:** Login, first onboarding step, Home in the seed user's known state, Profile hub, Plan tab. No screen with AI-generated text, relative timestamps, or live data. Final list fixed in D0 by walking the app as the seed user created by `scripts/ci/seed-e2e-user.sh` (`onboardingCompleted=true`).

**Flows:** new `e2e/flows/visual/*.yaml` tagged `visual` — deliberately not `regression`, so the existing retry-wrapped run (`scripts/ci/e2e-with-flow-retry.sh`) is untouched. Each: `launchApp` → navigate → `waitForAnimationToEnd` → `takeScreenshot: <screen>`. Both platform jobs run `maestro test --include-tags visual` after the regression pass. `scripts/ci/visual-diff.ts` compares each PNG to `e2e/baselines/<ios|android>/<screen>.png` via `pixelmatch` (new devDependency; `pngjs` is already a transitive dependency), writes `<screen>.diff.png` artefacts, prints a per-screen table, and exits non-zero above tolerance.

**Stability controls — where visual lanes live or die:**

1. **Pin the iOS runtime explicitly.** The current job boots `"iPhone 16"` and its own comment (`e2e-regression.yml` lines 333–349) says the name is ambiguous across runtimes on the runner image. The visual step selects a specific device _and_ runtime UDID; otherwise diffs fire on OS font-rendering changes.
2. **Freeze the status bar.** iOS: `xcrun simctl status_bar <udid> override --time 9:41 --batteryState charged --batteryLevel 100 --wifiBars 3 --cellularBars 4`. Android (`pixel_6`, API 34): SystemUI demo mode via `adb shell settings put global sysui_demo_allowed 1` and the demo broadcasts for clock and battery.
3. **Kill animations** on Android via the three `*_animation_scale` global settings; `waitForAnimationToEnd` in every flow before the screenshot.
4. **Tolerance** 0.5 % mismatched pixels by default; per-screen override in `e2e/baselines/manifest.json` for screens with gradients or avatars.

**One hard rule:** baselines are produced **only** by the `rebaseline=true` dispatch in CI, never from a local simulator. The user has Apple-only hardware, so Android references cannot come from anywhere else; and making both platforms' references come from the same renderer that diffs against them removes an entire class of false reds.

Storage: ~10 committed PNGs, a few MB total. Failure rides the existing `e2e-regression-failure` issue with the diff artefacts linked.

## Lane E — A11y hierarchy sweep

**Mechanism:** at the moment each Lane D flow takes its screenshot, the CI step also runs `maestro hierarchy` (confirmed present in the installed CLI; `--compact` CSV option available) and pipes the accessibility tree into `scripts/ci/a11y-sweep.ts`. Two rules:

- **R1 (fails the step):** every interactive element has a non-empty accessibility label.
- **R2 (warns initially):** no two sibling interactive elements share a label — a screen-reader ambiguity the static lint cannot see.

Lane E adds no navigation flows of its own; it piggybacks on Lane D's screens. The hierarchy JSON per screen is uploaded as an artefact (incidentally useful for debugging selector failures in the regression suite). Failure rides the existing `e2e-regression-failure` issue.

**E0 is a spike, and its output decides R1's implementation.** The attribute vocabulary of `maestro hierarchy` differs between the iOS and Android drivers, and whether iOS surfaces interactive-ness reliably is unknown until measured. E0 dumps one screen's hierarchy on both platforms, records the actual attributes in the spike notes, and R1 is written against what the tool emits. Decision rule: if iOS cannot distinguish interactive elements, R1 becomes trait-based on iOS (button/link traits) or Android-only for that rule — chosen from the dump, not assumed. (Precedent: `docs/solutions/logic-errors/an-invented-enumeration-is-not-the-space-ask-the-tool-2026-09-13.md`.)

## Lane F — Mutation-on-diff (advisory, per PR)

**Purpose:** apply "prove it can fail" to whatever a PR touches, not just the ten registered targets. It reuses the harness that exists: `scripts/mutation-explore.mjs` takes `<mutate-glob> <test-glob> [--spike]`, enforces hard exclusions in both the CLI (`classifyExploreTarget`) and `stryker.explore.conf.mjs` so the gate cannot be bypassed, and runs `coverageAnalysis: "perTest"`.

**Workflow:** new `.github/workflows/mutation-on-diff.yml`, `pull_request` trigger, not on the required list. Change detection copies the exact three-dot merge-base logic from `mutation-non-excluded.yml` (`git diff --name-only "$BASE...$HEAD"` with `fetch-depth: 0`), including its fail-loud behaviour on a missing SHA or merge-base — never a reimplementation.

**Eligible set,** computed by a pure, unit-tested function in `scripts/ci/mutation-on-diff.mjs`:

- changed, non-test `.ts` files under `server/lib/`, `server/services/`, `shared/lib/`, `client/lib/`, or matching `client/**/*-utils.ts`;
- minus anything `isHardExclusion(path)` returns true for, unless `isApprovedExclusion(path)` — the registry's exports from `stryker.targets.mjs`, never a second regex;
- minus already-registered targets (their required gates cover them; compare against `Object.values(MUTATION_TARGETS).map(t => t.mutate).flat()`);
- requiring a co-located `__tests__/<name>.test.ts`; a changed module with no such test is listed as _untested changed module_ in the summary (a signal in itself) and does not fail an advisory job;
- capped at 6 files per PR; overflow listed, not run.

**Per file:** `npm run mutation:explore -- <file> <test>`, with a `json` reporter added to `stryker.explore.conf.mjs` (behind an env flag so local explore output is unchanged) so the script reads a score instead of scraping clear-text. Explore mode's `incremental: false` stays — correctness over speed; incremental state across unrelated PRs is a derived signal.

**Output:** a `$GITHUB_STEP_SUMMARY` table per file (mutants, killed, survived, score) **and the survivor list with mutant descriptions** — the actionable sentence is "line 42: `>=` mutated to `>` and no test noticed".

**Threshold posture:** advisory throughout this effort. Scores under 60 are flagged in the summary; the job never goes red. Promotion is a separate decision after several weeks of data and is explicitly outside this spec.

**Funnel effect:** a module that scores well repeatedly in Lane F is a registration candidate with a real break threshold — the registry's own documented path ("baseline with `mutation:explore`" on the `nutrition-band-source` entry), now with the baseline measurement automated.

**Adjacent item, filed separately with the plan (P3):** the target list in `mutation-non-excluded.yml` (line 45) is a hand-maintained regex; generate it from the registry so a future threshold on `nutrition-band-source` needs one edit, not two.

## Components (file inventory)

**New files**

| Path                                                                               | Lane                                                  | Purpose                                                                                 |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------- |
| `test/utils/expect-response-schema.ts` (+ `__tests__`)                             | A                                                     | `expectResponseToMatch(body, schema)` with path-level failure messages                  |
| `scripts/__tests__/contract-coverage-guard.test.ts`                                | A                                                     | meta-test: every client-parsed schema has a provider-side assertion (allowlist ratchet) |
| `server/lib/__tests__/civil-date.property.test.ts`                                 | B                                                     | three relations                                                                         |
| `server/lib/__tests__/recipe-normalization.property.test.ts`                       | B                                                     | idempotence, quantity preservation, robustness                                          |
| `server/services/__tests__/nutrition-lookup.property.test.ts`                      | B                                                     | batch ≡ map, fallback-order invariant, field monotonicity                               |
| `server/lib/__tests__/macro-gap-context.property.test.ts`                          | B (stretch)                                           | input-breadth relations                                                                 |
| `.github/workflows/evals-nightly.yml`                                              | C                                                     | cron + dispatch (`suite`, `rebaseline`); compare; notify; rebaseline PR                 |
| `scripts/ci/eval-compare.ts` (+ `scripts/__tests__/eval-compare.test.ts`)          | C                                                     | three regression rules over results JSON vs baseline                                    |
| `evals/baselines/<suite>.json` × 5                                                 | C                                                     | committed baselines (first produced by C0's rebaseline dispatch)                        |
| `e2e/flows/visual/*.yaml` × ~5                                                     | D/E                                                   | `visual`-tagged screenshot flows                                                        |
| `e2e/baselines/<ios                                                                | android>/<screen>.png`, `e2e/baselines/manifest.json` | D                                                                                       | committed references + per-screen tolerance |
| `scripts/ci/visual-diff.ts` (+ test with a committed tiny PNG pair)                | D                                                     | pixelmatch diff, artefacts, summary, threshold exit                                     |
| `scripts/ci/a11y-sweep.ts` (+ test with a hierarchy fixture)                       | E                                                     | R1/R2 over `maestro hierarchy` output                                                   |
| `.github/workflows/mutation-on-diff.yml`                                           | F                                                     | per-PR advisory Stryker on changed eligible modules                                     |
| `scripts/ci/mutation-on-diff.mjs` (+ `scripts/__tests__/mutation-on-diff.test.ts`) | F                                                     | eligible-set function + orchestration of `mutation:explore`                             |

**Modified files**

| Path                                                       | Lane    | Change                                                                                                                                                                  |
| ---------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/routes/__tests__/<anchor>.test.ts` × ~7            | A       | add `expectResponseToMatch` on the success path                                                                                                                         |
| `shared/` (receipt schema pair, if currently client-local) | A       | relocate                                                                                                                                                                |
| `package.json`                                             | A, D    | remove `msw`; add `pixelmatch` devDependency; add `eval:compare`, `visual:diff`, `a11y:sweep` scripts                                                                   |
| `.github/workflows/e2e-regression.yml`                     | D, E    | `visual` run after regression on both jobs; status-bar/animation/runtime-pin steps; diff + sweep steps; `rebaseline` dispatch input; artefact upload; notify body links |
| `stryker.explore.conf.mjs`                                 | F       | optional `json` reporter behind an env flag                                                                                                                             |
| `docs/rules/testing.md`                                    | Phase 2 | three directives (see Phasing)                                                                                                                                          |
| `e2e/README.md`                                            | Phase 2 | visual + a11y sections; coverage-table rows                                                                                                                             |

**New repository secrets (user-created):** `ANTHROPIC_API_KEY`, `AI_INTEGRATIONS_OPENAI_API_KEY` (+ base URL if required), `BASELINE_PR_TOKEN` (fine-grained PAT; see the shared-mechanism token rule). **New devDependency:** `pixelmatch`. **Removed devDependency:** `msw`.

## Phasing (prove, anchor, institutionalise)

### Phase 0 — prove each mechanism with a positive control

Every lane lands with a demonstration that it _can fail_; a lane that has only ever been green has no denominator.

- **A0.** Helper + coverage guard seeded with the nine-schema allowlist (green on arrival). Control: a fixture violating the schema fails with a path-level message; a synthetic uncovered parse site fails the guard. Locate the receipt schema pair; apply the decision rule.
- **B0.** None — mechanism exists.
- **C0.** `evals-nightly.yml` with `workflow_dispatch` only (no cron yet); `eval-compare.ts`; first `rebaseline=true` dispatch → initial baseline PR. Controls: a doctored results file trips each rule independently; the dry run proves no Postgres is needed; real spend read from the provider dashboards.
- **D0.** Runtime pin, status-bar freeze, animation kill, `visual` tag plumbing, `visual-diff.ts`, **one** screen (Login), first baseline PR. Controls: a shifted copy fails; an identical rerun passes; **two consecutive dispatches are pixel-stable on both platforms before any more screens are added.**
- **E0.** The spike: hierarchy dumps on both platforms, attribute vocabulary recorded, R1 drafted against what the tool emits.
- **F0.** `mutation-on-diff.mjs` eligible-set function + its unit test; workflow on `pull_request`; replay against a throwaway branch with one assertion deliberately deleted — the score must drop. Runtime measured on three recent PRs; if the p95 exceeds ~10 minutes, lower the cap from 6 before F1.

### Phase 1 — anchors (parallel where files do not collide)

- **A1.** The ~7 route assertions; allowlist emptied; receipt schemas relocated if needed; `msw` removed.
- **B1.** Three property files (+ stretch), each PR showing its red run against a hand-broken implementation.
- **C1.** Cron enabled; the small-suite sample-count decision applied from C0/C1 data.
- **D1.** Remaining ~4 screens with per-screen tolerances; five consecutive stable nights before "live".
- **E1.** R1 enforced, R2 warning, across all Lane D screens; each violation fixed or filed per the severity policy.
- **F1.** Job running on every PR with the survivor list in the summary; four weeks of scores collected for the later promotion decision.

### Phase 2 — institutionalise

- `docs/rules/testing.md` (+3 short directives, within the cap): (1) any client-parsed response schema has a provider-side `expectResponseToMatch` assertion — guard-enforced; (2) property files carry a relations header and a pinned seed; (3) any script/guard/harness that gates or measures ships with a test proving it fails on a bad input, and baselines change only through a CI rebaseline PR.
- `e2e/README.md`: visual + a11y sections; coverage-table rows; the CI-only-baselines rule.
- `/codify` anything non-obvious learned — the iOS runtime pin and the hierarchy vocabulary are near-certain candidates.
- Separate follow-ups filed, not done here: generate the mutation workflow's target regex from the registry (P3); hook deny-branch completeness generalisation (decision-todo); Lane F threshold promotion (decision after data).

## Execution model

One todo per phase-lane item above (≈14), **`P2` / `priority: medium` by default** — test infrastructure and workflow edits never auto-merge. Dependencies: each `X1` waits on its `X0` to **merge**; **D before E** (shared `e2e-regression.yml` and flows); A1 and D0 both touch `package.json` (remove `msw`, add `pixelmatch`) — serialize them. F0 and C0 each add a new workflow file and are independent of everything else. The `writing-plans` skill produces the plan and the todo files; `/todo` executes them.

## Success criteria

- **A:** coverage guard green with an empty allowlist; nine of nine schemas asserted provider-side; `msw` gone.
- **B:** three property files, each with ≥3 named relations green at 100 runs; seed guard green; each PR carries its red run.
- **C:** five consecutive nightly runs green against committed baselines with zero false alarms; the doctored-run control committed as a test.
- **D:** five consecutive nights pixel-stable on both platforms before it is called live; then one _intentional_ UI change caught and accepted through a rebaseline PR — the real-world positive control.
- **E:** R1 at zero violations across the Lane D screens, or every violation filed; spike findings recorded in a solution doc.
- **F:** running on every PR; the replay-with-deleted-assertion control shows a score drop; p95 runtime under the cap chosen in F0.
- **Global:** the required-check list is byte-identical before and after (diffed, not asserted); zero added per-PR runtime on the required checks; nightly wall-clock growth measured and reported.

## Validation plan (positive controls)

| Lane   | Control                                                                  | Expected                                    |
| ------ | ------------------------------------------------------------------------ | ------------------------------------------- |
| A      | fixture body missing a required field                                    | assertion names the path                    |
| A      | synthetic `fooSchema.safeParse(` in a client fixture with no server test | guard fails naming `fooSchema`              |
| B      | hand-broken `normalizeUnit` (non-idempotent)                             | property fails with a shrunk counterexample |
| C      | doctored results: overall mean below baseline lower                      | rule 1 fails; rules 2–3 pass                |
| C      | doctored results: safety mean below baseline safety lower only           | rule 2 fails alone                          |
| C      | doctored results: assertion pass rate one case lower                     | rule 3 fails alone                          |
| D      | baseline PNG shifted by a few pixels                                     | mismatch above 0.5 %                        |
| D      | identical rerun on the pinned runtime                                    | zero mismatch                               |
| E      | hierarchy fixture with an unlabelled clickable element                   | R1 fires                                    |
| F      | throwaway branch with one assertion deleted                              | score drops versus the intact branch        |
| Global | required-check list before vs after                                      | identical                                   |

## Open items resolved by Phase 0 (each with its decision rule — no TBDs)

| Item                         | Resolved by             | Rule                                                                                                              |
| ---------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Receipt schema pair location | A0                      | client-local → move to `shared/`; already shared → import as-is                                                   |
| Nightly evals need Postgres? | C0 dry run              | if any suite fails on a missing `DATABASE_URL`, add the `postgres:16` service block from `ci.yml`; otherwise none |
| Small-suite sensitivity      | C0/C1 data              | doctored run inside bounds for a 12-case suite → `EVAL_SAMPLES_PER_CASE=3` for those suites only                  |
| Final Lane D screen list     | D0 walk                 | exclude any screen with AI text, relative time, or live data                                                      |
| iOS runtime UDID             | D0                      | pin the runtime reported by `xcrun simctl list runtimes` on the runner image; record it in the workflow           |
| R1 implementation on iOS     | E0 spike                | per the recorded attribute vocabulary; trait-based or Android-only if iOS lacks interactive-ness                  |
| Lane F cap                   | F0 runtime on three PRs | lower from 6 if p95 exceeds ~10 minutes                                                                           |

## Notes

- Industry references gathered 2026-09-06: fast-check docs and `@fast-check/vitest`; Stryker guides on coverage vs mutation score and incremental/perTest CI use; DeepEval/Promptfoo/Braintrust comparisons and the "60 % deterministic / 30 % judge / 10 % human" mix; Maestro + Percy visual snapshots for RN; MET 2026 (metamorphic testing) and "mutation testing for the agentic era".
- Internal precedents relied on: `docs/mutation-testing/README.md`; `docs/legacy-patterns/testing.md` §"Coverage Threshold Ratcheting" and §"Fork-Pool Starvation"; `e2e/README.md` §"why not a required check"; the seed-pinning convention doc; solution docs on inert guards, sampled corpora, derived green statuses, and invented enumerations.
- Corrections made during brainstorming and reflected here: the Stryker registry holds 10 targets (an earlier `grep -c` over-counted to 12); `nutrition-band-source` is a documented placeholder, not an unwired defect; three of the client-parsed schemas live under `shared/types/`, not `shared/schemas/`.
