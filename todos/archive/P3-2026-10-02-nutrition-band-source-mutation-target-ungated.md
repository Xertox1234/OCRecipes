---
title: "nutrition-band-source is a registered Stryker target that no mutation workflow runs, and no test ties stryker.targets.mjs to the required gates' hard-coded regexes"
status: done
priority: low
created: 2026-10-02
updated: 2026-10-02
assignee:
labels: [deferred, testing, ci]
github_issue:
---

# nutrition-band-source is a registered mutation target no gate runs

## Summary

`stryker.targets.mjs:102-113` registers `nutrition-band-source`, but neither required mutation gate names it — `.github/workflows/mutation-non-excluded.yml:45` hard-codes the other eight non-excluded targets and `.github/workflows/mutation-goal-safety.yml:44` names only `goal-calculator` — and the advisory mutation-on-diff job never selects it either, so a PR that weakens `client/components/nutrition/__tests__/nutrition-band-source.test.ts` gets mutation signal from no workflow. Wire the target into the non-excluded gate with a measured `breakThreshold`, and add a drift test that fails CI whenever a registry entry is not wired into exactly one gate (Detect pattern + step).

## Background

- Found 2026-10-02 by the deferred-warnings verification run itself (workflow wf_7d969d8d-ce1) while it verified the `/todo` sweep's #1224 mutation-on-diff warnings — not by an executor; confirmed by the orchestrator with grep and re-verified against main `ec26b972`. Deferred because it was outside #1224's scope (that PR changed the advisory job's install gating, not the required gates) and the fix edits a branch-protection workflow and needs a local Stryker baseline run — its own reviewed PR.
- How it drifted: #747 (`3ef9b00d`, 2026-07-31) registered `nutrition-bands` and edited `mutation-non-excluded.yml` in the same commit; #753 (`f921f8ff`, 2026-08-07) added the 12-line `nutrition-band-source` entry with no workflow change. Nothing failed because nothing compares the two: `test/stryker-targets.test.ts` (128 lines) covers `resolveTarget` and the Hard-Exclusion approval gate only, and no file under `scripts/` or `test/` names either gate workflow (`grep -rln -E 'mutation-non-excluded\.yml|mutation-goal-safety\.yml' scripts test` → nothing). `docs/mutation-testing/README.md:36-42` already concedes its hand list "has drifted from the workflow before".
- Measured at `ec26b972` (in-memory probe, nothing written): each registered target's `mutate` + `testInclude` paths fed to each gate's Detect ERE through `grep -qE` — the command the Detect step runs (JS `RegExp` agreed on all 40 path×gate rows). 9 of 10 targets are matched by exactly one gate that also has their `MUTATION_TARGET=<name>` step; `nutrition-band-source` is matched by neither gate and has no step anywhere.
- Correction to the triage wording: the finding cited the registered-target skip at `scripts/ci/mutation-on-diff.mjs:89-92`, but this file never reaches it. `isCandidate` (`:50-58`) admits only `ELIGIBLE_DIRS` (`:41-46`: `server/lib/`, `server/services/`, `shared/lib/`, `client/lib/`) or `client/**/*-utils.ts`, so `:88` drops `client/components/nutrition/nutrition-band-source.ts` first. Probe: `selectEligible([that file])` returns all five buckets empty both as-is and with `registeredMutatePaths` emptied, while the control `shared/lib/nutrition-bands.ts` lands in `skippedRegistered` as-is and in `eligible` with the skip removed. The net stands: no workflow gives this module mutation signal.
- Low severity: nothing is broken today and the unit test itself runs on every PR in the normal shards (`vitest.config.mts:25`); what is missing is the score floor that fails a PR which weakens that test. The registry comment (`stryker.targets.mjs:110-112`) names what the floor would catch — a branch inversion (`itemId === undefined` the wrong way round, or `valuesArePer100` flipped) "which coarse fixtures cannot see" — in the module that selects which values the nutrient bands are computed from.

## Acceptance Criteria

- [ ] **Red first.** A drift block (spec in Implementation Notes) is added to `test/stryker-targets.test.ts` — or, if `scripts/__tests__/mutation-required-gates.test.ts` is on main when work starts, to that file instead; one home, not both — and FAILS on unmodified main with a message naming `nutrition-band-source`. The failing output is quoted in the PR body; it passes after the gate edit.
- [ ] **Parsing and controls.** For each gate file the block asserts exactly one `grep -qE '<ERE>' <<< "$CHANGED"` line and collects its `run: MUTATION_TARGET=<name> npm run test:mutation` steps; it decides a path by spawning `grep -qE <ERE>` with `input: path + "\n"` and asserts the exit status is 0 or 1 (an invalid ERE exits 2 and must fail the test). Controls: `stryker.targets.mjs` matches in both gates (exit 0); `client/components/nutrition/not-a-registered-target.ts` (a path string only — no such file) matches in neither (exit 1).
- [ ] **Per-target invariant.** For every `MUTATION_TARGETS` entry (count checked equals `Object.keys(MUTATION_TARGETS).length`, 10 at `ec26b972`, not hard-coded): every `mutate` + `testInclude` path is matched by exactly one gate, the same gate for all of them; that gate has the target's step and the other gate has neither; a target with any `isHardExclusion` path is routed to `mutation-goal-safety.yml`, every other target to `mutation-non-excluded.yml`; and every step in either gate names a registered target.
- [ ] **Baseline and threshold.** `MUTATION_TARGET=nutrition-band-source npm run test:mutation` is run locally; its score and killed/survived/no-coverage/timeout counts go in a new row of `docs/mutation-testing/baselines.md`; `stryker.targets.mjs:102-113` gets a numeric `breakThreshold` 2-3 points below the achieved score (or 100 when nothing survives, as for `verification-consensus` and `cook-session-merge` at `:32`/`:37`), and the comment at `:107-112` is rewritten with the achieved score and whether the two predicted branch-inversion mutants were killed. An entry left without `breakThreshold` inside a required gate does not satisfy this criterion.
- [ ] **Gate wiring.** `.github/workflows/mutation-non-excluded.yml:45` matches both `nutrition-band-source` paths; a `Mutation test (nutrition-band-source, break=N)` step gated `if: steps.changed.outputs.run == 'true'` like its neighbours follows the `nutrition-bands` step (`:96-98`); the "Run all eight" comment (`:65-67`) and the "pure server/lib modules" header (`:3-4`) are corrected; the drift block passes; `mutation-goal-safety.yml` is unchanged.
- [ ] **Evidence.** `actionlint .github/workflows/mutation-non-excluded.yml` is clean, and the PR's own `Mutation (non-excluded)` run (it takes `run=true` because `stryker.targets.mjs` changes) shows the new step executed and passed, not skipped — `gh run view <id>` output in the PR body. Existing `test/stryker-targets.test.ts`, `scripts/__tests__/mutation-on-diff.test.ts` and `scripts/__tests__/mutation-on-diff-select-only.test.ts` still pass.
- [ ] **Coordination with the gate-polarity test.** If `scripts/__tests__/mutation-required-gates.test.ts` is on main when the PR is opened, its pinned count of `steps.changed.outputs.run == 'true'` in `mutation-non-excluded.yml` goes 11 → 12 in this PR; if it is not, the PR body states the count is now 12 so whichever lands second pins it.
- [ ] **One list, not two.** The dated hand list in `docs/mutation-testing/README.md:36-42` is replaced by one sentence: the non-excluded gate covers every registered target without a Hard-Exclusion path, enforced by the drift block (name its file).

## Implementation Notes

- **Why the gate route, not mutation-on-diff (the triage's alternative).** Removing the skip at `mutation-on-diff.mjs:89-92` does not select this file — `:88`'s `isCandidate` drops it first. Widening `ELIGIBLE_DIRS` would change what the advisory job runs on every `client/components/` PR, the job is "Never red on score" (`:3-6`), and the drift invariant would then fail for this target by construction unless the test carried an exemption list — a second hand-maintained list, the thing that drifted. Once the drift block lands, `mutation-on-diff.mjs:70-72` ("Registered targets are skipped first (their required gates cover them)") is true by construction, so that file needs no edit.
- **Detect-step format (what the test must model).** Detect builds `CHANGED` from `git diff --name-only "$BASE...$HEAD"` (`mutation-non-excluded.yml:37`, goal-safety `:34`) — repo-root-relative paths, one per line, no `./` — and tests the whole list with `grep -qE '^(…)$' <<< "$CHANGED"` (`:45` / `:44`), so a path counts when one line matches an anchored alternative. Registry paths use the same repo-root-relative form (`stryker.targets.mjs:25-105`), so `grep -qE <ERE>` on `path + "\n"` (a here-string adds the newline) reproduces Detect's decision for that path.
- **Drift block sketch** (`REPO_ROOT` as in `scripts/__tests__/mutation-on-diff-select-only.test.ts:39-47`; `MUTATION_TARGETS` and `isHardExclusion` are already imported at `test/stryker-targets.test.ts:2-10`):

  ```ts
  import { spawnSync } from "node:child_process";
  import { readFileSync } from "node:fs";
  import path from "node:path";

  const REPO_ROOT = path.resolve(__dirname, "..");
  const GATES = ["mutation-non-excluded.yml", "mutation-goal-safety.yml"];

  function readGate(file: string) {
    const yml = readFileSync(
      path.join(REPO_ROOT, ".github", "workflows", file),
      "utf8",
    );
    const detect = [...yml.matchAll(/grep -qE '([^']+)' <<< "\$CHANGED"/g)];
    expect(detect, `${file}: Detect grep lines`).toHaveLength(1);
    const steps = [
      ...yml.matchAll(/run: MUTATION_TARGET=([\w-]+) npm run test:mutation/g),
    ].map((m) => m[1]);
    return { file, ere: detect[0][1], steps };
  }

  /** Detect's own decision for one path: grep, not a JS RegExp. Exit 2 = broken ERE. */
  function matches(ere: string, p: string): boolean {
    const r = spawnSync("grep", ["-qE", ere], { input: `${p}\n` });
    expect([0, 1], `grep exit for ${p}`).toContain(r.status);
    return r.status === 0;
  }
  ```

  The per-target loop collects the gates where any path matches and asserts exactly one with `name` in the message (that is what makes it red on main naming `nutrition-band-source`), then that every path matches in that gate, the routing rule, and step presence per gate; the inverse walks every gate's `steps` against `Object.keys(MUTATION_TARGETS)`. Put the controls in their own `it` so a broken oracle reports separately from a wiring gap.

- **Why the exit-status assertion matters.** Inside `if grep …; then`, `set -e` does not fire: an unbalanced ERE makes grep exit 2, the `else` branch writes `run=false`, and the gate self-scopes green for all nine targets on every PR. Reproduced locally: `bash -c 'set -euo pipefail; … if grep -qE "^(shared/lib/nutrition-bands\.ts$" <<< …'` printed `grep: parentheses not balanced`, then `run=false`, and exited 0.
- **Gate edit, exact text.** In the `:45` ERE insert `client/components/nutrition/nutrition-band-source\.ts|client/components/nutrition/__tests__/nutrition-band-source\.test\.ts|` immediately before `stryker\.(conf|targets|explore\.conf)\.mjs`. After `:96-98` add:

  ```yaml
  - name: Mutation test (nutrition-band-source, break=N)
    if: steps.changed.outputs.run == 'true'
    run: MUTATION_TARGET=nutrition-band-source npm run test:mutation
  ```

  Keep the `== 'true'` polarity — the triage's L2 finding advises against flipping required gates to `!= 'false'` (a typo would then run every target on every PR). Header `:3-4` "(the pure server/lib modules)" has been stale since `server/services/` and `shared/lib/` targets joined; say "every registered target that is not a Hard Exclusion".

- **Baseline.** Use `MUTATION_TARGET=nutrition-band-source npm run test:mutation` (README `:9`) — the exact command the gate runs, with the gate's own `stryker.conf.mjs` — rather than the `mutation:explore` form the registry comment suggests (`:107-109`). Threshold precedent, achieved → break: `chat-history-truncate` 90.58 → 88 (`stryker.targets.mjs:42`), `notebook-budget` 90.91 → 88 (`:49`), `carousel-builder` 93.15 → 90 (`:56`), `nutrition-bands` 88.89 → 85 (`:83`); margin because timeouts vary across runners (`:42-44`). Without a threshold `stryker.conf.mjs:49-51` emits no `thresholds` and the step can never fail on score — a required check that cannot go red. Killing survivors is out of scope (the test file is not in the contract): record any surviving branch-inversion mutants in the registry comment and PR body; the floor ratchets today's score.
- **First `client/` target in the harness.** `vitest.mutation.config.mts:19-29` spreads `vitest.config.mts` (node environment `:24`, `./test/setup.ts` `:115`, aliases) and only narrows `include`, so the test's `@/`/`@shared/` imports resolve as in CI. The module's value-import chain mentions `react-native` nowhere: `NutritionPanel-utils.ts` → `badge-severity-visuals.ts` (no imports), plus `shared/lib/nutrition-bands.ts`, itself gated at break=85. If the Stryker dry run still fails, stop and report — do not edit the harness config (out of contract).

## Scope Contract

- **Mechanisms to use:** the existing Detect-ERE + per-target step pattern in `mutation-non-excluded.yml`; the registry's `breakThreshold` field (applied by `stryker.conf.mjs:49-51`); a yml-text Vitest assertion in the style of `scripts/__tests__/mutation-on-diff-select-only.test.ts:313-329`, with `grep` via `spawnSync` as the oracle. Nothing new in the harness.
- **Files in scope:** `.github/workflows/mutation-non-excluded.yml`, `stryker.targets.mjs`, `test/stryker-targets.test.ts`, `docs/mutation-testing/baselines.md`, `docs/mutation-testing/README.md`. Only if it is on main: `scripts/__tests__/mutation-required-gates.test.ts` (count bump, or the drift block's home per the first criterion).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None blocking; #1224 is merged.
- Soft ordering with the triage code bundle (`chore/triage-code-fixes-2026-10-02`, finding L2), which plans `scripts/__tests__/mutation-required-gates.test.ts` pinning 11 `== 'true'` gates in this workflow. At `ec26b972` that file is on neither main nor the branch; whichever PR lands second pins 12.

## Risks

- YAML/indentation error in the new step: the workflow file is invalid, the required `Mutation (non-excluded)` check never reports, and every open PR blocks until a forward fix. actionlint 1.7.12 is installed locally (`/opt/homebrew/bin/actionlint`); no hook, lint-staged entry or CI job runs it (`git grep -i actionlint` over `package.json .lintstagedrc* .husky .github scripts .claude/hooks` → exit 1).
- ERE edit error: the gate fails open silently (above); the drift block's exit-status assertion is the catch.
- Over-broad alternative: the gate runs all nine Stryker targets on unrelated PRs (minutes, and red risk for any target near its floor); the negative control catches a catch-all.
- Threshold set at the achieved score: flaky red on harness-touching PRs; keep the margin.
- Cost: every gate trigger (any harness edit) now runs one more Stryker target.
- Not auto-merged: `.github/` is in the auto-merge guard's `SENSITIVE_OVERRIDE` (`scripts/todo-automerge-guard.sh:181`), so the PR is held for human review despite `priority: low` — the right outcome for a required-gate edit.

## Updates

### 2026-10-02

- Filed from the 2026-10-02 deferred-warnings triage of the /todo sweep (#1213–#1226); claim verified against main ec26b972 by workflow wf_7d969d8d-ce1 and upheld by an adversarial re-check; filing approved by the owner 2026-10-02.
