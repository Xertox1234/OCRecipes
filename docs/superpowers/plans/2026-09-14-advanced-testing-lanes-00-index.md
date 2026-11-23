# Advanced Testing Lanes — Index Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six testing lanes — provider-side contract tests, property/metamorphic tests, nightly LLM evals with regression detection, visual regression, an accessibility hierarchy sweep, and per-PR mutation-on-diff — each shipped as a reusable mechanism plus one anchor, with every gating/measuring script proven able to fail.

**Architecture:** Two rails. Deterministic lanes (A, B, F) are ordinary Vitest files or a per-PR advisory job; probabilistic lanes (C, D, E) ride nightly workflows with committed baselines, an explicit tolerance, a rebaseline-by-PR flow, and the existing issue-filing failure job. No new required-check name is added anywhere.

**Tech Stack:** Vitest 4, fast-check 4, Zod, supertest, Stryker 9 (`mutation:explore`), Maestro 2.9.0 (CI) / 2.6.0 (local), `pixelmatch` + `pngjs`, GitHub Actions, `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-14-advanced-testing-lanes-design.md` (local-only; `docs/superpowers/` is gitignored)

## Execution protocol (decided 2026-09-14 — subagent-driven, compaction between tasks)

- **Mode:** `superpowers:subagent-driven-development` in an interactive session — a fresh subagent per task, two-stage review between tasks. Not `/todo` (index Task 0's lane todos are therefore optional; the two `P3` follow-up todos are still filed in Phase 2).
- **STOP after every completed task.** A task is complete when its test file is green, its commit exists, and its review passed. Then: report task id, files touched, commit hash(es), and any deviation from the plan — and **end the turn**. The user compacts the session between tasks. Never start the next task in the same turn, even if it is small.
- **Progress tracker = the `- [ ]` checkboxes in these plan files.** Check boxes as steps complete. On resume, the first unchecked task in the order below is the next task.
- **Execution order** (respects the dependency graph; one lane's branch/PR at a time):
  1. Lane A Tasks 1–2 (A0) → PR → Lane A Tasks 3–7 (A1) → PR
  2. Lane B Tasks 1, 2, 3 (one PR each, or one PR for all three), Task 4 only if time allows
  3. Lane F Tasks 1–4 (F0) → PR (replay control needs a throwaway PR — human-gated)
  4. Lane C Tasks 1–3 → PR; Tasks 4–5 are human-gated (secrets, dispatches, baseline PR merge)
  5. Lane D Tasks 1–4 → PR; Task 5 human-gated; Task 6 (D1) after D0's two stable dispatches
  6. Lane E Task 1 (E0, human-gated dispatch) → Tasks 2–4 (E1)
  7. Index Tasks I1–I3 (Phase 2) + file the two `P3` todos from Task 0
- **Human-gated steps** (stop and ask; never do them autonomously): creating repository secrets (`ANTHROPIC_API_KEY`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `BASELINE_PR_TOKEN`), dispatching workflows, merging PRs, opening throwaway PRs for controls.
- **Branches:** one feature branch per lane phase off `origin/main` (e.g. `test/lane-a0-contract-guard`, `test/lane-a1-contract-anchors`); never commit to `main`. Serialize the `package.json` touches (A1 vs D0) as the dependency graph says.

## Plan files (read the one for your lane; this index is shared context)

| Lane                                            | Plan file                                                                         |
| ----------------------------------------------- | --------------------------------------------------------------------------------- |
| A — Provider-side contract tests                | `docs/superpowers/plans/2026-09-14-advanced-testing-lanes-A-contract-tests.md`    |
| B — Property-based + metamorphic tests          | `docs/superpowers/plans/2026-09-14-advanced-testing-lanes-B-property-tests.md`    |
| C — Nightly LLM evals with regression detection | `docs/superpowers/plans/2026-09-14-advanced-testing-lanes-C-evals-nightly.md`     |
| D — Visual regression on the Maestro nightly    | `docs/superpowers/plans/2026-09-14-advanced-testing-lanes-D-visual-regression.md` |
| E — A11y hierarchy sweep                        | `docs/superpowers/plans/2026-09-14-advanced-testing-lanes-E-a11y-sweep.md`        |
| F — Mutation-on-diff                            | `docs/superpowers/plans/2026-09-14-advanced-testing-lanes-F-mutation-on-diff.md`  |

**Worktree note:** `docs/superpowers/` is gitignored and is NOT present in a `/todo` executor worktree. Read plan files from the main checkout: `/Users/williamtower/projects/OCRecipes/docs/superpowers/plans/…` (reads only — never write there from a worktree).

## Global Constraints

- **No new required-check name.** The branch-protection required-check list must be byte-identical before and after this work. New workflows are advisory. Existing required jobs (`Lint · Types · Patterns`, `Tests (shard N/3)`, `Coverage thresholds`, `Mutation (goal-safety)`, `Mutation (non-excluded)`, `Analyze (CodeQL)`, `Outward-CLI guard corpus`) are not renamed or restructured.
- **Deterministic lanes join the existing Vitest shards** (base `include: ["**/*.test.ts", "**/*.test.tsx"]`, `retry: 2`, `pool: "forks"`, coverage thresholds lines 49/42/48/40 in `vitest.config.ts`). Probabilistic lanes never block a merge.
- **Open-source only.** No Percy/Chromatic, no Braintrust/DeepEval, no Pact.
- **Prove it can fail (floor rule).** Every script that gates or measures ships with a Vitest test feeding it a bad input and asserting rejection. A test never observed red is not evidence.
- **Property tests:** file name `*.property.test.ts` inside a `__tests__/` dir; every `fc.assert(...)` passes a pinned seed (`{ seed: 20260914, numRuns: 100 }`); files open with a relations header; never added to any Stryker `testInclude`.
- **Baselines change only through a CI `rebaseline=true` dispatch that opens a PR** using the user-created fine-grained PAT secret `BASELINE_PR_TOKEN` (contents + pull-requests write, this repo only). Never `GITHUB_TOKEN` for that push/PR; never local-simulator screenshots as baselines.
- **Lane C pins:** `EVAL_JUDGE_MODEL=claude-sonnet-4-6`, `EVAL_SAMPLES_PER_CASE=1`, `EVAL_PARALLELISM=4`, `NODE_ENV` unset. Secrets `ANTHROPIC_API_KEY`, `AI_INTEGRATIONS_OPENAI_API_KEY` are user-created repository secrets.
- **Lane D:** tolerance 0.5 % mismatched pixels by default; per-screen override only via `e2e/baselines/manifest.json`; screens with AI text, relative timestamps, or live data are excluded.
- **Lane F:** advisory; cap 6 files per PR; scores under 60 flagged, never red; hard exclusions via `isHardExclusion`/`isApprovedExclusion` from `stryker.targets.mjs`, never a second regex.
- **Git:** never commit to `main`; feature branch + PR. Commit messages contain no backticks when passed with `-m` (backticks execute in the shell — if you need one, write the message to a file and use `git commit -F`). End every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Inside a `/todo` worktree use `/usr/bin/git` (the rtk guard refuses `rtk`'s git verbs there).
- **Do not run the whole suite ad hoc** (`npm run test:run`, `check:types`, `lint`) — run the single file under test with `npx vitest run <path>`; the push hook (`preflight:fast`) and CI own the full gate.
- **LSP-first** for symbol work (`findReferences` before editing a shared export). First query may be cold; re-run once.

## Dependency graph and serialization

```
A0 ──► A1
B1a  B1b  B1c            (independent of everything; may run in parallel)
C0 ──► C1
D0 ──► D1
D0 ──► E0 ──► E1          (E reuses D's flows and edits the same workflow file: D before E, always)
F0                        (independent)
{A0,C0,D0,E0,F0 merged} ──► I1 (rules directives) ──► I2 (e2e README) ──► I3 (codify)
```

Serialize these pairs because they touch the same file:

- **A1 and D0** both edit `package.json` (A1 removes `msw`; D0 adds `pixelmatch`, `pngjs`, types). Land one, rebase the other.
- **D0, D1, E0, E1** all edit `.github/workflows/e2e-regression.yml`. Strictly sequential.
- **I1** edits `docs/rules/testing.md` (6500-byte cap; `scripts/check-rules-file-size.js` enforces it) once for all lanes — do not add rules-file edits to lane PRs.

## Task 0: Materialize the todo files (run first, on a fresh docs branch)

**Files:**

- Create: `todos/P2-2026-09-14-lane-a0-contract-helper-and-coverage-guard.md`
- Create: `todos/P2-2026-09-14-lane-a1-contract-anchors-and-msw-removal.md`
- Create: `todos/P2-2026-09-14-lane-b1-property-tests-civil-date.md`
- Create: `todos/P2-2026-09-14-lane-b1-property-tests-recipe-normalization.md`
- Create: `todos/P2-2026-09-14-lane-b1-property-tests-nutrition-lookup.md`
- Create: `todos/P2-2026-09-14-lane-c0-evals-nightly-workflow-and-compare.md`
- Create: `todos/P2-2026-09-14-lane-c1-evals-nightly-cron-and-sensitivity.md`
- Create: `todos/P2-2026-09-14-lane-d0-visual-regression-mechanism-login-screen.md`
- Create: `todos/P2-2026-09-14-lane-d1-visual-regression-remaining-screens.md`
- Create: `todos/P2-2026-09-14-lane-e0-a11y-hierarchy-spike.md`
- Create: `todos/P2-2026-09-14-lane-e1-a11y-sweep-rules.md`
- Create: `todos/P2-2026-09-14-lane-f0-mutation-on-diff-workflow.md`
- Create: `todos/P2-2026-09-14-phase2-testing-rules-readme-and-codify.md`
- Create: `todos/P3-2026-09-14-generate-mutation-workflow-target-regex-from-registry.md`
- Create: `todos/P3-2026-09-14-decision-generalize-hook-deny-branch-completeness.md`

**Interfaces:**

- Consumes: `todos/TEMPLATE.md` (frontmatter fields `title/status/priority/created/updated/assignee/labels/github_issue`; sections Summary / Background / Acceptance Criteria / Implementation Notes / Scope Contract / Dependencies / Risks / Updates).
- Produces: the backlog `/todo` executes. Every todo's Acceptance Criteria are self-sufficient (an executor without the plan can still verify them); Implementation Notes point at the lane plan tasks for the code.

- [ ] **Step 1: Branch from main**

```bash
git fetch origin main
git switch -c docs/advanced-testing-lanes-todos origin/main
```

- [ ] **Step 2: Write the fifteen todo files**

Every file uses this frontmatter skeleton (fill `title`, `priority`, `labels`; `P3` files set `priority: low`):

```markdown
---
title: "<title>"
status: backlog
priority: medium
created: 2026-09-14
updated: 2026-09-14
assignee:
labels: [testing, <domain>]
github_issue:
---
```

Bodies (Summary / Background / Acceptance Criteria / Implementation Notes / Scope Contract / Dependencies / Risks / Updates), one per file:

**`P2-2026-09-14-lane-a0-contract-helper-and-coverage-guard.md`** — title "Lane A0: expectResponseToMatch helper + contract-coverage guard (allowlisted)"; labels `[testing, server]`.

- Summary: Add `test/utils/expect-response-schema.ts` and the meta-test `scripts/__tests__/contract-coverage-guard.test.ts` seeded with an allowlist of the nine current client-parsed schemas so it lands green.
- Background: No route test validates a response body against the schema the client parses with (nine `safeParse` sites, zero route imports). Spec §Lane A.
- Acceptance Criteria: `[ ]` `expectResponseToMatch(body, schema)` throws an `Error` whose message lists every Zod issue as `<path>: <message>` and returns `undefined` on success; `[ ]` its unit test includes a failing fixture (missing required field) asserting the path appears in the message; `[ ]` the guard scans `client/` for `<name>Schema.safeParse(`/`.parse(` sites and fails naming schema + client file when a name has no reference under `server/**/__tests__/` or `test/integration/`; `[ ]` the guard's own test proves it fails on a synthetic uncovered site; `[ ]` the guard is green on `main` with `CONTRACT_ALLOWLIST` holding exactly the eight schema names from the plan (nine parse sites — `tastePickCandidatesResponseSchema` is parsed in two screens); `[ ]` the receipt schema pair's location is recorded in the PR body (client-local → relocation happens in A1).
- Implementation Notes: Lane A plan Tasks 1–2. Mirror `scripts/__tests__/fast-check-property-seed-guard.test.ts` for the walker and `EXCLUDED_DIRS`.
- Scope Contract: Mechanisms: Vitest meta-test + a `test/utils` helper + a pure `scripts/lib` module. Files: `test/utils/expect-response-schema.ts`, `test/utils/__tests__/expect-response-schema.test.ts`, `scripts/lib/contract-coverage.ts`, `scripts/__tests__/contract-coverage-guard.test.ts`. No other files.
- Dependencies: none. Risks: walker misses a client dir → fails open; the walker must use a denylist like the seed guard, never an allowlist of roots.

**`P2-2026-09-14-lane-a1-contract-anchors-and-msw-removal.md`** — title "Lane A1: provider-side contract assertions on the nine client-parsed schemas; remove msw"; labels `[testing, server]`.

- Summary: Add `expectResponseToMatch` to the success-path test of each anchor route, relocate the receipt schemas to `shared/schemas/receipt.ts`, empty `CONTRACT_ALLOWLIST`, remove the unused `msw` devDependency.
- Background: Spec §Lane A anchors table; A0 landed the mechanism with an allowlist ratchet.
- Acceptance Criteria: `[ ]` `CONTRACT_ALLOWLIST` is empty and the guard is green; `[ ]` each of `recipeSearchResponseSchema`, `catalogSearchResponseSchema`, `catalogConfigResponseSchema`, `receiptAnalysisResultSchema`, `receiptConfirmResultSchema`, `tastePickCandidatesResponseSchema`, `tastePicksResponseSchema`, `coachBlockSchema` is asserted in a server test on a success path; `[ ]` `shared/schemas/receipt.ts` exports the receipt schemas and `client/hooks/useReceiptScan.ts` imports them from there (no behaviour change); `[ ]` `msw` is absent from `package.json` and `package-lock.json`; `[ ]` `npx vitest run server/routes/__tests__ scripts/__tests__/contract-coverage-guard.test.ts` passes.
- Implementation Notes: Lane A plan Tasks 3–7. Coach blocks are asserted at `validateBlocks` output in `server/services/__tests__/coach-blocks.test.ts` (SSE, no single response body).
- Scope Contract: Files: the eight test files named in the plan, `shared/schemas/receipt.ts`, `client/hooks/useReceiptScan.ts` (import swap only), `scripts/__tests__/contract-coverage-guard.test.ts` (allowlist only), `package.json`, `package-lock.json`.
- Dependencies: A0 merged. Serialize with D0 on `package.json`. Risks: a mocked storage fixture may not satisfy the schema — fix the fixture via the typed factories, never loosen the schema.

**`P2-2026-09-14-lane-b1-property-tests-civil-date.md`** — title "Lane B: property tests for server/lib/civil-date.ts (round-trip, range, monotone)"; labels `[testing, server]`.

- Summary: `server/lib/__tests__/civil-date.property.test.ts` with three named relations, pinned seed, relations header.
- Background: Spec §Lane B anchor 1 — the module behind a shipped calendar-day bug.
- Acceptance Criteria: `[ ]` file exists with a relations header naming round-trip, hour range, and midnight monotonicity; `[ ]` every `fc.assert` uses `{ seed: 20260914, numRuns: 100 }`; `[ ]` `scripts/__tests__/fast-check-property-seed-guard.test.ts` passes; `[ ]` the PR body pastes the red run against a hand-broken `civilDateToInstant` (e.g. `day + 1`) showing fast-check's shrunk counterexample; `[ ]` the file is not referenced by any Stryker `testInclude`.
- Implementation Notes: Lane B plan Task 1. Scope Contract: Files: the one new test file. Dependencies: none.

**`P2-2026-09-14-lane-b1-property-tests-recipe-normalization.md`** — title "Lane B: property tests for server/lib/recipe-normalization.ts (idempotence, quantity preservation, robustness)"; labels `[testing, server]`.

- Summary/Background: Spec §Lane B anchor 2; seven pure `normalize*` exports.
- Acceptance Criteria: `[ ]` `server/lib/__tests__/recipe-normalization.property.test.ts` exists with a relations header; `[ ]` idempotence asserted for all seven exports; `[ ]` `normalizeIngredient` quantity-preservation asserted; `[ ]` `normalizeRecipeFields` never throws over `fc.string()` inputs; `[ ]` pinned seed; seed guard green; `[ ]` PR body pastes the red run against a hand-broken `normalizeUnit`.
- Implementation Notes: Lane B plan Task 2. Scope Contract: Files: the one new test file. Dependencies: none.

**`P2-2026-09-14-lane-b1-property-tests-nutrition-lookup.md`** — title "Lane B: metamorphic property tests for nutrition-lookup (batch ≡ map, fallback order, field monotonicity)"; labels `[testing, server]`.

- Summary/Background: Spec §Lane B anchor 3 — the metamorphic anchor over the CNF→USDA→API Ninjas chain.
- Acceptance Criteria: `[ ]` `server/services/__tests__/nutrition-lookup.property.test.ts` exists with a relations header; `[ ]` batch≡map relation holds over generated item lists including empty and duplicates; `[ ]` fallback-order invariant: when CNF resolves with calories > 0, no fetch to `api.nal.usda.gov` or `api.api-ninjas.com` occurs; `[ ]` `countNonNullNutritionFields` monotone; `[ ]` pinned seed; seed guard green; `[ ]` PR body pastes the red run against a hand-broken `fetchNutritionFromSources` ordering.
- Implementation Notes: Lane B plan Task 3 (Task 4 stretch: `macro-gap-context`). Reuse the `vi.mock("../../db")` + `vi.stubGlobal("fetch")` pattern from `nutrition-lookup.test.ts`. Scope Contract: Files: the one new test file (plus the optional stretch file). Dependencies: none.

**`P2-2026-09-14-lane-c0-evals-nightly-workflow-and-compare.md`** — title "Lane C0: evals-nightly workflow (dispatch only), eval-compare with three rules, first baseline PR"; labels `[testing, evals, ci]`.

- Summary: Add `scripts/ci/eval-compare.ts` (+ test with doctored fixtures), `evals/baselines/` format, and `.github/workflows/evals-nightly.yml` on `workflow_dispatch` only; produce the initial baselines via `rebaseline=true`.
- Background: Spec §Lane C and §Shared mechanism. Evals run only by hand today.
- Acceptance Criteria: `[ ]` `eval-compare.ts` exposes `compareSuite(current, baseline)` returning `{ passed, failures[] }` and fails on each of: overall mean below baseline lower; safety mean below baseline safety lower; assertion pass rate below baseline — each proven by a separate doctored fixture in its Vitest test, with a matching fixture passing; `[ ]` `--write-baseline` writes `evals/baselines/<suite>.json` in the documented shape; `[ ]` the workflow has inputs `suite` and `rebaseline`, pins `EVAL_JUDGE_MODEL=claude-sonnet-4-6`, `EVAL_SAMPLES_PER_CASE=1`, `EVAL_PARALLELISM=4`, runs all five suites (photo included — `eval:all` omits it), uploads results + step summary, and a `notify-on-failure` job files/updates an issue labelled `evals-regression-failure`; `[ ]` a dry dispatch on a branch proves no Postgres service is needed (or the PR adds the `postgres:16` block and says why); `[ ]` a `rebaseline=true` dispatch opened a PR containing only `evals/baselines/*.json`, and that PR received its required checks (proves `BASELINE_PR_TOKEN` works); `[ ]` real spend for one full run recorded in the PR body.
- Implementation Notes: Lane C plan Tasks 1–4. Secrets must exist before the dispatch (user-created). Scope Contract: Files: `evals/lib/bootstrap.ts` (new; bootstrap moved out of `runner-core.ts`), `evals/lib/runner-core.ts` (re-export only), `evals/__tests__/bootstrap.test.ts`, `scripts/ci/eval-compare.ts`, `scripts/__tests__/eval-compare.test.ts` (fixtures built in code, no fixture files), `.github/workflows/evals-nightly.yml`, `evals/baselines/*.json` (via the rebaseline PR), `package.json` (`eval:compare` script only). Dependencies: secrets `ANTHROPIC_API_KEY`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `BASELINE_PR_TOKEN`. Risks: 12-case suites have wide bounds (handled in C1).

**`P2-2026-09-14-lane-c1-evals-nightly-cron-and-sensitivity.md`** — title "Lane C1: enable the evals nightly cron; apply the small-suite sample-count rule"; labels `[testing, evals, ci]`.

- Summary: Turn on the schedule; after five runs, apply the sensitivity decision rule for the 12-case suites.
- Acceptance Criteria: `[ ]` `schedule:` cron added (not top-of-hour, not 08:17); `[ ]` five consecutive scheduled runs green against committed baselines with zero false alarms, run URLs in the PR body; `[ ]` doctored-run check: for each 12-case suite, a results file with safety lowered by 1.0 is outside the baseline bounds — if not, `EVAL_SAMPLES_PER_CASE=3` is set for that suite only and baselines regenerated via a rebaseline PR.
- Implementation Notes: Lane C plan Task 5. Scope Contract: Files: `.github/workflows/evals-nightly.yml`, `evals/baselines/*.json` (via rebaseline PR). Dependencies: C0 merged and its baseline PR merged.

**`P2-2026-09-14-lane-d0-visual-regression-mechanism-login-screen.md`** — title "Lane D0: visual-regression mechanism (runtime pin, status-bar freeze, visual tag, visual-diff.ts) with the Login screen only"; labels `[testing, e2e, ci]`.

- Summary: `scripts/ci/visual-diff.ts` (+ test with a committed tiny PNG pair), `e2e/flows/visual/login.yaml`, workflow steps in both platform jobs, `rebaseline` dispatch input, first baseline PR.
- Background: Spec §Lane D; no `takeScreenshot` exists in any flow today.
- Acceptance Criteria: `[ ]` `diffPng(actual, expected, tolerance)` returns `{ mismatchRatio, diff }` and its test proves a shifted fixture exceeds 0.005 while an identical pair returns 0; `[ ]` CLI exits non-zero above tolerance and writes `<screen>.diff.png` + a summary table; `[ ]` the iOS job freezes the status bar via `xcrun simctl status_bar "$IOS_SIMULATOR_UDID" override …` and records the booted runtime identifier; `[ ]` `e2e/baselines/manifest.json` holds `runtime.ios` and `runtime.android` and the diff step fails loudly on a runtime mismatch; `[ ]` `maestro test --include-tags visual` runs after the regression pass on both jobs; `[ ]` a `rebaseline=true` dispatch opened a PR with `e2e/baselines/ios/login.png`, `e2e/baselines/android/login.png`, `manifest.json`, and that PR received its required checks; `[ ]` two consecutive dispatches after the baseline PR merged are pixel-stable on both platforms (run URLs in the PR body); `[ ]` positive control documented: a dispatch against a deliberately shifted baseline went red.
- Implementation Notes: Lane D plan Tasks 1–5. Android animations are already disabled by the emulator action. Scope Contract: Files: `scripts/ci/visual-diff.ts`, `scripts/__tests__/visual-diff.test.ts` (PNG fixtures synthesised in memory, none committed), `scripts/ci/visual-run.sh`, `e2e/flows/visual/login.yaml`, `e2e/baselines/**` (via rebaseline PR), `.github/workflows/e2e-regression.yml`, `package.json` (`visual:diff` script; `pixelmatch`, `pngjs`, `@types/pixelmatch`, `@types/pngjs`), `.gitignore` (`e2e/visual-out/`, `e2e/visual-diff/`). Dependencies: `BASELINE_PR_TOKEN`. Serialize with A1 on `package.json`. Risks: iOS runtime ambiguity — the manifest pin is the control.

**`P2-2026-09-14-lane-d1-visual-regression-remaining-screens.md`** — title "Lane D1: visual baselines for onboarding step 1, Home, Profile hub, Plan tab"; labels `[testing, e2e]`.

- Acceptance Criteria: `[ ]` four new `e2e/flows/visual/*.yaml` tagged `visual`, each ending in `waitForAnimationToEnd` then `takeScreenshot`; `[ ]` no chosen screen shows AI text, relative timestamps, or live data (state the check per screen in the PR body); `[ ]` per-screen tolerance overrides, if any, live only in `manifest.json` with a one-line reason each; `[ ]` rebaseline PR merged with the eight new PNGs; `[ ]` five consecutive nights pixel-stable on both platforms before the todo closes.
- Implementation Notes: Lane D plan Task 6. Scope Contract: Files: `e2e/flows/visual/*.yaml`, `e2e/baselines/**` (via rebaseline PR). Dependencies: D0 merged + its two stability dispatches green.

**`P2-2026-09-14-lane-e0-a11y-hierarchy-spike.md`** — title "Lane E0 (spike): dump maestro hierarchy on both platforms; record the attribute vocabulary; draft R1"; labels `[testing, accessibility, e2e]`.

- Summary: Add a hierarchy-dump step after each visual screenshot, upload the JSON as an artefact, and write `docs/solutions/…` notes recording the exact attributes each platform emits for interactive elements.
- Acceptance Criteria: `[ ]` the nightly uploads `e2e/a11y-out/<platform>/<screen>.json` for the Login screen on both platforms; `[ ]` a solution doc records, per platform, the attribute names present on a known button and on a known static text (verbatim from the dump); `[ ]` the solution doc's "Predicate" section states, per platform, the attribute test for "interactive" and the label key order that E1's `INTERACTIVE_PREDICATES` / `labelOf` will implement (or states that a platform cannot distinguish interactive elements); `[ ]` no rule is enforced yet and no sweep script exists yet.
- Implementation Notes: Lane E plan Task 1. Scope Contract: Files: `scripts/ci/visual-run.sh` (hierarchy dump lines), `.github/workflows/e2e-regression.yml` (artefact upload only), `.gitignore`, `docs/solutions/best-practices/<slug>.md`. Dependencies: D0 merged. Risks: iOS may not expose interactive-ness — the spike's output decides R1's iOS form.

**`P2-2026-09-14-lane-e1-a11y-sweep-rules.md`** — title "Lane E1: enforce R1 (labelled interactives) and warn on R2 (duplicate sibling labels) over the visual screens"; labels `[testing, accessibility, e2e]`.

- Acceptance Criteria: `[ ]` `sweepHierarchy(tree, platform)` returns `{ r1: Violation[], r2: Violation[] }` and its Vitest test proves an unlabelled clickable fixture yields an R1 violation while a labelled one yields none; `[ ]` CLI exits non-zero on any R1 violation, prints R2 as warnings, and writes a summary table; `[ ]` the sweep runs for every `visual` screen on both platforms; `[ ]` every R1 violation found on the five screens is fixed in-scope or filed per severity policy (list in PR body).
- Implementation Notes: Lane E plan Tasks 2–4. Scope Contract: Files: `scripts/ci/a11y-sweep.ts`, `scripts/__tests__/a11y-sweep.test.ts`, `scripts/__tests__/fixtures/a11y/*.json`, `.github/workflows/e2e-regression.yml`, `package.json` (`a11y:sweep` script). Dependencies: E0 merged.

**`P2-2026-09-14-lane-f0-mutation-on-diff-workflow.md`** — title "Lane F0: advisory mutation-on-diff workflow reusing mutation:explore"; labels `[testing, ci]`.

- Acceptance Criteria: `[ ]` `selectEligible(changedFiles, opts)` returns `{ eligible, untested, skippedRegistered, excluded, overflow }` and its Vitest test covers: hard-excluded path → `excluded`; approved exclusion → `eligible`; registered target → `skippedRegistered`; `.tsx` and test files → ignored; missing co-located test → `untested`; cap 6 → `overflow`; `[ ]` `scoreFromReport(report)` computes Stryker's score (`detected / (detected + undetected)`) from a JSON report fixture; `[ ]` `stryker.explore.conf.mjs` adds the `json` reporter only when `STRYKER_EXPLORE_JSON=1`; `[ ]` `.github/workflows/mutation-on-diff.yml` runs on `pull_request`, uses the three-dot merge-base diff (fail-loud), and writes a step-summary table with the survivor list; the job never exits non-zero on score; `[ ]` replay control: on a throwaway branch with one assertion deleted from a covered module's test, the summary shows a lower score than the intact branch (both run URLs in the PR body); `[ ]` p95 runtime over three recent PRs recorded; cap lowered if p95 > 10 min.
- Implementation Notes: Lane F plan Tasks 1–4. Scope Contract: Files: `scripts/ci/mutation-on-diff.mjs`, `scripts/__tests__/mutation-on-diff.test.ts` (report fixture built in code), `stryker.explore.conf.mjs`, `.github/workflows/mutation-on-diff.yml`. Dependencies: none.

**`P2-2026-09-14-phase2-testing-rules-readme-and-codify.md`** — title "Phase 2: three testing-rule directives, e2e README sections, codify the lane learnings"; labels `[testing, docs]`.

- Acceptance Criteria: `[ ]` `docs/rules/testing.md` gains exactly three directives (client-parsed schema ⇒ provider assertion; property files carry relations header + pinned seed; gating/measuring scripts ship a failing-fixture test and baselines change only via CI rebaseline PR) and stays under 6500 bytes (`scripts/check-rules-file-size.js` green); `[ ]` `e2e/README.md` gains "Visual regression" and "Accessibility sweep" sections plus coverage-table rows and the CI-only-baselines rule; `[ ]` `/codify` produced solution docs for the iOS runtime pin and the hierarchy vocabulary (or the PR body says why not); `[ ]` `npm run build:copilot-instructions` re-run and the regenerated file committed if `docs/rules/*.md` changed.
- Implementation Notes: Index plan Tasks I1–I3. Scope Contract: Files: `docs/rules/testing.md`, `e2e/README.md`, `docs/solutions/**` (new files), `.github/copilot-instructions.md` (regenerated). Dependencies: A0, C0, D0, E0, F0 merged.

**`P3-2026-09-14-generate-mutation-workflow-target-regex-from-registry.md`** — title "Generate mutation-non-excluded.yml's target regex from stryker.targets.mjs"; `priority: low`; labels `[testing, ci]`.

- Summary: The change-detection regex at `.github/workflows/mutation-non-excluded.yml` line 45 is hand-maintained; a future threshold on `nutrition-band-source` needs two edits. Generate it from the registry (a script under `scripts/` plus a CI drift check, mirroring `build:domain-map:check`).
- Acceptance Criteria: `[ ]` a script emits the regex from `MUTATION_TARGETS` (targets with a `breakThreshold`, plus the harness files); `[ ]` a `:check` script fails when the workflow's regex differs; `[ ]` wired into the `checks` job; `[ ]` the regex in the workflow equals the generated one.
- Scope Contract: Files: `scripts/build-mutation-target-regex.mjs`, `scripts/__tests__/build-mutation-target-regex.test.ts`, `.github/workflows/mutation-non-excluded.yml`, `.github/workflows/ci.yml`, `package.json`. Dependencies: none.

**`P3-2026-09-14-decision-generalize-hook-deny-branch-completeness.md`** — title "DECISION: generalize #935's deny-branch-completeness meta-test across the other hooks?"; `priority: low`; labels `[testing, hooks, decision]`; add `human_led: true` to the frontmatter.

- Summary: 15 of 19 hooks have a co-located self-test; deny-branch completeness is verified for one (`guard-outward-cli`). Decide whether to generalize, in its own spec — not in the advanced-testing-lanes effort.
- Acceptance Criteria: `[ ]` a human records the decision (generalize / defer / decline) and, if generalize, a new brainstorming session produces its spec.
- Scope Contract: decision only; no code. Dependencies: none.

- [ ] **Step 3: Verify the frontmatter parses and file names match priorities**

```bash
for f in todos/P2-2026-09-14-*.md todos/P3-2026-09-14-*.md; do
  head -12 "$f" | grep -qE '^priority: (medium|low)$' || { echo "bad priority: $f"; exit 1; }
  case "$f" in
    todos/P2-*) grep -q '^priority: medium$' "$f" || { echo "P2 must be medium: $f"; exit 1; } ;;
    todos/P3-*) grep -q '^priority: low$' "$f" || { echo "P3 must be low: $f"; exit 1; } ;;
  esac
done && echo OK
```

Expected: `OK`

- [ ] **Step 4: Commit and open the docs PR**

```bash
git add todos/P2-2026-09-14-*.md todos/P3-2026-09-14-*.md
git commit -m "docs(todos): file the advanced-testing-lanes backlog (A-F, phase 2, two follow-ups)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin docs/advanced-testing-lanes-todos
```

Open the PR with the GitHub MCP tool (`mcp__github__create_pull_request`), title `docs(todos): advanced testing lanes backlog`, body linking the spec path and this index. Docs PRs run the full CI gate; wait for green, then merge per the merge policy.

---

## Phase 2 tasks (run after A0, C0, D0, E0, F0 have merged)

### Task I1: Three directives in `docs/rules/testing.md`

**Files:**

- Modify: `docs/rules/testing.md` (currently 2950 bytes; cap 6500)

**Interfaces:**

- Consumes: the lane mechanisms by name (`expectResponseToMatch`, `contract-coverage-guard`, `*.property.test.ts`, rebaseline PR flow).
- Produces: binding rules injected on Edit/Write by `.claude/hooks/inject-patterns.sh` for the testing domain.

- [ ] **Step 1: Measure the current size and confirm headroom**

```bash
wc -c docs/rules/testing.md
```

Expected: a number under 5900 (leaving ≥600 bytes for the three lines below).

- [ ] **Step 2: Append exactly three directives (one line each, matching the file's existing bullet style)**

```markdown
- Any response schema the client parses with (`<name>Schema.safeParse(`/`.parse(` under `client/`) has a provider-side `expectResponseToMatch(res.body, <name>Schema)` assertion in a `server/**/__tests__/` file — enforced by `scripts/__tests__/contract-coverage-guard.test.ts`; never add a name to its allowlist to silence it.
- Property-based test files (`*.property.test.ts`) open with a relations header naming every relation asserted, pin `{ seed, numRuns }` on every `fc.assert`, and are never added to a Stryker `testInclude`.
- Any script, guard, or harness that gates or measures (`scripts/check-*.js`, `scripts/ci/*.ts`, hooks) ships with a test feeding it a failing input and asserting rejection; committed baselines (`e2e/baselines/`, `evals/baselines/`) change only through a CI `rebaseline=true` dispatch that opens a PR — never from a local run.
```

- [ ] **Step 3: Run the size check and the frontmatter/rules lint**

```bash
node scripts/check-rules-file-size.js docs/rules/testing.md && wc -c docs/rules/testing.md
```

Expected: exit 0; size under 6500.

- [ ] **Step 4: Regenerate Copilot instructions (rules changed)**

```bash
npm run build:copilot-instructions
git status --short .github/copilot-instructions.md
```

Expected: the file shows as modified (commit it in the same PR).

- [ ] **Step 5: Commit**

```bash
git add docs/rules/testing.md .github/copilot-instructions.md
git commit -m "docs(rules): contract-assertion, property-file, and prove-it-can-fail directives

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task I2: `e2e/README.md` sections

**Files:**

- Modify: `e2e/README.md` (append after the critical-flow coverage table, lines 61–75)

- [ ] **Step 1: Append the two sections and coverage rows**

```markdown
## Visual regression (`visual` tag)

Flows under `flows/visual/` end in `waitForAnimationToEnd` + `takeScreenshot` and run after the regression pass on both platform jobs (`maestro test --include-tags visual`). `scripts/ci/visual-diff.ts` compares each PNG to `e2e/baselines/<platform>/<screen>.png` (tolerance 0.5 % mismatched pixels; per-screen overrides only in `e2e/baselines/manifest.json`, each with a reason). Diff images upload as `visual-diff-<platform>` artefacts; a red night lands on the `e2e-regression-failure` issue.

**Baselines are produced only by CI.** Dispatch the workflow with `rebaseline=true`; it opens a PR containing the refreshed PNGs and the manifest. Review the diff, merge. Never commit a locally captured screenshot as a baseline — the runner's simulator/emulator is the renderer the diff runs against, and the manifest pins its runtime.

Screens: Login, Onboarding step 1, Home (seed user), Profile hub, Plan tab. Screens with AI text, relative timestamps, or live data are excluded by rule.

## Accessibility sweep

After each visual screenshot the job runs `maestro hierarchy` and `scripts/ci/a11y-sweep.ts`:

- **R1 (fails):** every interactive element has a non-empty accessibility label.
- **R2 (warns):** no two sibling interactive elements share a label.

Hierarchy dumps upload as `a11y-<platform>` artefacts (also useful for debugging selectors). The platform attribute vocabulary is recorded in `docs/solutions/best-practices/` (from the E0 spike).

| Surface           | Visual | A11y sweep |
| ----------------- | ------ | ---------- |
| Login             | ✅     | ✅         |
| Onboarding step 1 | ✅     | ✅         |
| Home              | ✅     | ✅         |
| Profile hub       | ✅     | ✅         |
| Plan tab          | ✅     | ✅         |
```

- [ ] **Step 2: Commit**

```bash
git add e2e/README.md
git commit -m "docs(e2e): visual regression and accessibility sweep sections

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task I3: Codify

- [ ] **Step 1: Run `/codify`** for the two near-certain learnings — the iOS runtime pin (device name is ambiguous across runtimes; the manifest is the pin) and the `maestro hierarchy` attribute vocabulary per platform — plus anything else the lane PRs surfaced. Each solution doc needs single-line `tags:`/`applies_to:` frontmatter (`scripts/check-solution-frontmatter.js`).

- [ ] **Step 2: Commit** the solution docs in the Phase 2 PR.

## Self-review (run once all lane plans exist)

1. **Spec coverage:** every spec section has a task: Lane A → plan A Tasks 1–7; Lane B → plan B Tasks 1–4; Lane C → plan C Tasks 1–5; Lane D → plan D Tasks 1–6; Lane E → plan E Tasks 1–4; Lane F → plan F Tasks 1–4; shared mechanism → C Task 3/4 + D Task 4/5; floor rule → each lane's first test task; Phase 2 → I1–I3; follow-ups → the two P3 todos.
2. **Placeholder scan:** `grep -nE "TBD|TODO|later|similar to Task|appropriate|handle edge" docs/superpowers/plans/2026-09-14-advanced-testing-lanes-*.md` — the only permitted hits are the literal word "todo" naming a todo file.
3. **Type consistency:** names used across plans — `expectResponseToMatch`, `CONTRACT_ALLOWLIST`, `computeCoverage`, `compareSuite`, `toBaseline`, `diffPng`, `compareDir`, `writeBaselines`, `sweepHierarchy`, `INTERACTIVE_PREDICATES`, `labelOf`, `selectEligible`, `scoreFromReport` — each defined exactly once in its lane plan and referenced by that spelling in the todos above.
