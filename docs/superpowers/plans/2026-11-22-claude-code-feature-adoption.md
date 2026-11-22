# Claude Code feature adoption: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended here) or superpowers:subagent-driven-development to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the four Claude Code features from the 2026-11-22 research that fit OCRecipes:

- pinned reviewer effort;
- property tests on serving scaling and unit conversion;
- a server-side `/verify` skill;
- a trial of the out-of-tree write block.

**Status:** this file is untracked on `main`. Commit it as the first commit on PR A's branch.

**Architecture:** There are three independent deliverables.

- **PR A (harness):** Tasks 1 and 4. Agent frontmatter, plus a project skill at `.claude/skills/verify/SKILL.md`. That path is where Claude Code's bundled `/verify` keeps a project's recipe.
- **PR B (tests plus client behaviour changes):** Tasks 2 and 3. fast-check property files. Task 2 also changes what the app shows: it tightens `parseFraction` and `scaleIngredientQuantity` and makes `formatAsFraction` consistent. It reaches phones only through an OTA, and only when the owner asks.
- **Task 5:** a user-settings change with no PR, trialled in one session.

**Tech stack:** Vitest, fast-check (already a dependency), Claude Code 2.1.330 agent and skill frontmatter.

**Spec:** none. The research summary below is the source.

- Verification guide: https://claude.dev/blog/how-the-claude-code-team-thinks-about-verification/
- Bundled `/verify`: https://code.claude.com/docs/en/commands.md
- Subagent effort: https://code.claude.com/docs/en/model-config.md#effort-level-of-subagents-and-teammates. "On another model, that level doesn't apply. To pick a subagent's level, set `effort` in its definition." Sonnet 5.5 and Opus 5.5 both default to `medium`. The docs don't say which level such a subagent falls back to. The model default (medium) is likely, so pinning medium is likely to leave behaviour unchanged, but that is unconfirmed.
- Write block: https://code.claude.com/docs/en/settings-reference.md, under `permissions.blockWritesOutsideWorkingDirectories`.

## Global Constraints

- CLAUDE.md "Checks": no ad hoc `test:run`, `check:types` or `lint`. Red/green runs are single-file only: `npx vitest run <file>`.
- Property tests pin a seed (`{ seed: <yyyymmdd>, numRuns: 100 }`). Keep them out of every Stryker `testInclude`. See `docs/solutions/conventions/fast-check-property-tests-pin-seed-not-in-mutation-testinclude-2026-07-12.md`.
- A property file opens with a `RELATIONS` header, as in `server/lib/__tests__/civil-date.property.test.ts`.
- A SKILL.md body must not contain `$0`–`$9` or `$ARGUMENTS`. The loader substitutes them, inside code fences too, and `scripts/check-skill-positional-params.js` enforces it.
- Reviewer effort: **owner confirmed 2026-11-22.** Pin `medium` on all five Sonnet agents, `todo-researcher` included. Execution is **native**, through superpowers:executing-plans.
- Feature branch and PR for each of PR A and PR B. One review pass per PR, from the roster in `docs/AI_WORKFLOW.md` → Review Policy.
- Task 2 changes client code, so it ships to phones only with an OTA. Publish that OTA only when the owner asks.

## Review Focus

1. `parseFraction` gets `"Infinity"`, `"1e3"`, `"0x10"`, `"-1"` or `"5."`. Probed 2026-11-22: today they return `Infinity`, `1000`, `16`, `-1` and `5`. Expected: `null` (not a quantity). Pinned in Task 2.
2. `scaleIngredientQuantity` gets a negative, `NaN` or `Infinity` number, or a finite input whose scaled result overflows. Probed: `(1e308, 2)` and a 400-digit string both give `"Infinity"` today. Expected: `{ scaled: null, isNumeric: false }`. Pinned in Task 2.
3. `/verify` runs while `:3000` is held by a server from another worktree. Eight worktrees exist. Expected: the skill never reuses or kills that server. It starts its own from the current tree on its own `PORT`; `server/index.ts:350` honours `PORT`. Pinned in Task 4's scenario B.
4. `/verify` runs while Postgres is down, `.env` is missing, or `DATABASE_URL` is not local. Expected: report **BLOCKED** with the reason. Never report "pass", and never fall back to "tests passed, so it works". Pinned in Task 4's scenario C.
5. The write block refuses a needed write, for example in the U34Bolt worktree, or in a memory file that is not `.md`. Expected: the U34Bolt write succeeds through `additionalDirectories`, and the failure is logged as a trial result. Pinned in Task 5's step 3.

---

## PR A: harness

### Task 1: Pin `effort: medium` on the Sonnet agents

**Files:**

- Create: `scripts/__tests__/agent-effort.test.ts`
- Modify: frontmatter of `.claude/agents/{code-reviewer,server-reviewer,mobile-reviewer,ai-reviewer,todo-researcher}.md`

**Interfaces:** none. Frontmatter only.

- [ ] **Step 1: Write the failing test.** Read every `.claude/agents/*.md` (reuse the `AGENTS_DIR` approach from `agent-dispatch-types.test.ts`). Parse the frontmatter between the first two `---` lines. Two tests:
  - `it("every agent pinned to a non-inherit model declares an effort")`. For each file whose `model:` is present and not `inherit`, expect `effort:` to be one of `low|medium|high|xhigh|max`. The failure message names the file.
  - `it("Sonnet reviewers run at medium")`. Expect `effort` to equal `"medium"` for the five agents listed above.
- [ ] **Step 2: Run it and confirm it fails.** Run `npx vitest run scripts/__tests__/agent-effort.test.ts`. Expected: FAIL, with five files named.
- [ ] **Step 3:** Add `effort: medium` on the line after `model: sonnet` in each of the five files.
- [ ] **Step 4: Run it and confirm it passes.** Same command. Expected: PASS, 2 tests.
- [ ] **Step 5: Commit.** `chore(agents): pin effort medium on Sonnet agents`. The commit body quotes the docs line about subagents on another model.

### Task 4: Server-side `/verify` skill

The project skill is named `verify`, so it becomes the recipe that the bundled `/verify` uses. It covers `server/` and `shared/` changes only. Client screens stay with `verify-ui`, Maestro and XcodeBuildMCP.

**Files:**

- Create: `.claude/skills/verify/SKILL.md`
- Modify: none. CLAUDE.md gets a one-line pointer only if the owner approves it in the PR, as `Server change → /verify`.

**Interfaces:** none.

- [ ] **Step 1: Load `superpowers:writing-skills`.** It sets the red/green method for skills.
- [ ] **Step 2: Baseline (red).** Pick a recent merged server change, for example #1966's meal-plan recipe route. Dispatch a `general-purpose` subagent with no skill: "Confirm this change works: <diff summary>." Record whether it:
  - runs the full suite or `check:types`, which CLAUDE.md forbids;
  - starts the server;
  - calls the route;
  - reports evidence or just a claim.

  Save the notes to the scratchpad.

- [ ] **Step 3: Write `SKILL.md`.** Frontmatter:
  - `name: verify`
  - `description: Use after changing server/ or shared/ code to confirm it works at runtime by booting the local Express server and calling the changed routes; not for client screens (use verify-ui).`
  - No `allowed-tools` line, matching `verify-ui`. The skill edits source when a check fails.

  The body is these steps, in this order:
  1. **Find the changed files.** List changed `server/` and `shared/` files from three sources: `git diff --name-only HEAD` (uncommitted), `git diff --name-only main...HEAD` (committed on the branch), and `git ls-files --others --exclude-standard` (new). Then list the routes those files register. If there are none, stop and report "nothing server-side to verify".
  2. **Run the co-located tests.** Run only the test files next to the changed files, with `npx vitest run <files>`. Never `test:run`, `check:types` or `lint`. On a failure, fix the source, never the test.
  3. **Check the database is local.** Read the host of `DATABASE_URL` from `.env` without printing the value. If the host isn't `localhost` or `127.0.0.1`, report **BLOCKED (non-local DB)** and stop. Calling routes writes rows.
  4. **Start a server from this tree.** Start `PORT=3101 npm run server:dev` in the background from the current worktree root. Poll `localhost:3101/api/health` for up to 30 s. Never reuse or stop a server on `:3000`. If 3101 is taken, try 3102–3109. If the server won't come up, report **BLOCKED** with its last error line and stop.
  5. **Log in only if needed.** If a changed route needs auth, log in through `POST /api/auth/login` with the local demo account. Its credentials are in the session's memory file `user_test_account.md`, or ask the owner. This repo is public, so never write a credential into the skill, the report or a commit.
  6. **Call each changed route.** Send one request on the normal path and one on the error path. Record the method, path, status and a ≤200-char body excerpt. **Ask the owner first** before any route that calls a paid AI provider: coach chat, photo or label analysis, recipe generation, image generation. Those calls spend money.
  7. **Stop the server** that step 4 started.
  8. **Report** a table with columns route | request | expected | actual | PASS/FAIL/BLOCKED. If a check still fails after 3 fix attempts, stop and explain.

  Use no `$0`–`$9` anywhere in the file. Write `PORT=3101` literally, never as a shell variable reference.

- [ ] **Step 4: Check positional parameters.** Run `node scripts/check-skill-positional-params.js .claude/skills/verify/SKILL.md`. Expected: no findings.
- [ ] **Step 5: Green run.** Rerun step 2's scenario with a subagent told to follow `.claude/skills/verify/SKILL.md`. Expected:
  - only single-file vitest runs;
  - the server's health is checked;
  - the route is called;
  - the report is an evidence table.
- [ ] **Step 6: Edge scenarios.**
  - Scenario B: leave a dev server from another checkout running on `:3000` and invoke the skill. Expected: it starts its own server on `:3101` and leaves `:3000` running.
  - Scenario C: invoke it twice, in a throwaway shell env only. First with `DATABASE_URL` pointed at a closed local port, then with a non-local host. Expected: **BLOCKED** both times, never PASS.
  - Scenario D: a diff that touches only a coach route. Expected: the skill asks before calling it.
  - Scenario E: uncommitted changes on `main`. Expected: they are found, not reported as "nothing to verify".
  - Before running any scenario, confirm that demo login completes without the email-code step against the local DB.

  Fix the wording of `SKILL.md` until all three scenarios behave.

- [ ] **Step 7: Find out whether you can invoke it.** In a fresh session, see whether `verify` shows up in the model's skill list. Changelog 2.1.215 says Claude no longer runs the bundled `/verify` on its own, so it may work only when the owner types it. Write the result in the PR body.
- [ ] **Step 8: Commit, review, PR.** `feat(skills): server-side /verify recipe`. Review it with `code-reviewer`.

---

## PR B: property tests

### Task 2: `serving-scale` properties and input tightening

**Files:**

- Create: `client/lib/__tests__/serving-scale.property.test.ts`
- Modify: `client/lib/serving-scale.ts` (`parseFraction`, `formatAsFraction`, `scaleIngredientQuantity`)
- Modify: `client/lib/__tests__/serving-scale.test.ts`, adding example cases for Review Focus 1 and 2 and the display case below

**Interfaces:**

- Produces: `parseFraction(value: string): number | null`. Returns `null` for anything that isn't a non-negative decimal, simple fraction or mixed fraction.
- Produces: `formatAsFraction(value: number): string`. A value whose 1-decimal fallback lands on a cooking fraction shows that fraction: `0.46` gives `"1/2"`, not `"0.5"`. The probe found that today `0.46` gives `"0.5"` while `0.5` gives `"1/2"`.
- Produces: `scaleIngredientQuantity`. Returns `{ scaled: null, isNumeric: false }` when the input or the scaled product is non-finite or negative.

Header, `FC_PARAMS = { seed: 20261122, numRuns: 100 }`, and these relations:

- **R1 round trip:** for `x = fc.double({ min: 0, max: 1000, noNaN: true })`, `Math.abs(parseFraction(formatAsFraction(x))! - x) <= 0.05 + 0.003`. The 0.05 is the 1-decimal fallback; the 0.003 is `FRACTION_TOLERANCE`.
- **R2 stable display:** `formatAsFraction(parseFraction(formatAsFraction(x))!) === formatAsFraction(x)`. A displayed amount, read back, shows the same. **Expected to FAIL today**: the probe found `0.46` and `1.46`.
- **R3 not a quantity:** build strings from the alphabet `0-9 . / - + e x I n f t y , space` with `fc.stringOf(fc.constantFrom(...))`, length 1–8. For each one that doesn't match `^\s*(\d+(\.\d+)?|\.\d+|\d+\/\d+|\d+\s+\d+\/\d+)\s*$`, expect `parseFraction(s) === null`. Add `examples: [["Infinity"], ["1e3"], ["0x10"], ["-1"], ["5."]]`. That alphabet makes `Number()`-accepted strings common, so R3 doesn't depend on the hand-listed examples alone.
- **R4 finite, non-negative output:** for `n = fc.double()` (NaN, ±Infinity and 1e308 included) and `r = fc.double({ min: 0, max: 100 })`, `scaleIngredientQuantity(n, r)` either returns `isNumeric: false`, or returns a `scaled` with no `-`, `NaN` or `Infinity` in it. Add `examples: [[1e308, 2]]`. The same relation runs on the string path with `"9".repeat(400)`.

There's no "scale by one" relation: it would restate the implementation.

Steps:

- [ ] **Step 1: Check the callers first.** Use LSP `findReferences` on `parseFraction`, `formatAsFraction` and `scaleIngredientQuantity`. For each caller, confirm that it renders `isNumeric: false` the way it renders "to taste" today. List every caller whose shown text will change. If any caller can't handle `null`, stop and raise it before changing behaviour.
- [ ] **Step 2: Write the property file and the example cases.** Add `it.each` cases to `serving-scale.test.ts` for Review Focus 1 and 2, and `formatAsFraction(0.46) === "1/2"`.
- [ ] **Step 3: Run both files and confirm the right failures.** Run `npx vitest run client/lib/__tests__/serving-scale.property.test.ts client/lib/__tests__/serving-scale.test.ts`. Expected: R2, R3 and R4 FAIL with a counterexample, along with the new examples, and R1 passes. If R1 fails, stop: that is a new finding.
- [ ] **Step 4: Fix the source.**
  - In `parseFraction`, replace `Number(trimmed)` with a match on `^\d+(\.\d+)?$|^\.\d+$` before converting.
  - In `formatAsFraction`, re-snap the 1-decimal fallback: format the rounded value through the same whole/fraction checks before returning a decimal.
  - In `scaleIngredientQuantity`, return the non-numeric result when the input, the parsed value or the product `parsed * ratio` is `!Number.isFinite(v) || v < 0`.
- [ ] **Step 5: Run both files and confirm they pass.** Same command. Expected: all pass.
- [ ] **Step 6: Commit.** `fix(serving-scale): reject non-decimal, negative and overflowing quantities; consistent fraction display`. The PR body lists the changed callers from step 1, says the change ships to phones only with an OTA, and says that OTA is the owner's call.

### Task 3: `units` properties

**Files:**

- Create: `shared/lib/__tests__/units.property.test.ts`

**Interfaces:** consumes `kgToLbs`, `lbsToKg`, `cmToInches`, `inchesToCm`, `weightFromKg`, `weightToKg`, `heightFromCm` and `heightToCm`, all from `shared/lib/units.ts`. No changes to them.

Relations, with `x = fc.double({ min: 0, max: 1e4, noNaN: true })`, `u = fc.constantFrom("metric", "imperial")` and `FC_PARAMS = { seed: 20261122, numRuns: 100 }`:

- **R1:** `lbsToKg(kgToLbs(x)) ≈ x` and `inchesToCm(cmToInches(x)) ≈ x`, both within `Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(x))`. That bound still works at `x = 0`.
- **R2:** `weightToKg(weightFromKg(x, u), u) ≈ x` and `heightToCm(heightFromCm(x, u), u) ≈ x`, within the same bound.
- **R3 monotone:** `a <= b` implies `kgToLbs(a) <= kgToLbs(b)`, and the same for `cmToInches`. The `≤` is deliberate: `cmToInches` multiplies by less than 1, and strict `<` can collapse to equality at subnormal values.

- [ ] **Step 1: Write the file.**
- [ ] **Step 2: Run it.** Run `npx vitest run shared/lib/__tests__/units.property.test.ts`. Expected: PASS, because the code is believed correct.
- [ ] **Step 3: Control run, to prove R1 can fail.** Temporarily change `LBS_PER_KG` to `2.2`, rerun, and confirm R1 FAILS with a counterexample. Restore the constant and rerun to PASS. Paste both outputs into the PR body. A property that has never failed doesn't prove anything.
- [ ] **Step 4: Commit and open the PR.** `test(units): property tests for conversion round trips`. Open one PR for Tasks 2 and 3, reviewed by `code-reviewer` and `mobile-reviewer` (the client file).

---

## Task 5: Write-block trial (no PR)

**Files:** `~/.claude/settings.json`. This is a user setting, so it changes **every project**, not only OCRecipes. Repo settings don't count toward the directory list. **Get the owner's explicit yes before step 1.** To revert, copy the dated backup back over the file, then restart Claude Code.

- [ ] **Step 1: Stage the file.** Per memory `feedback_config_edit_handoff`, write a corrected copy that adds the following. Validate it with `jq .`, then back up the original under a dated name and copy the new file in.
  - `permissions.blockWritesOutsideWorkingDirectories: true`
  - `permissions.additionalDirectories: ["/Volumes/U34Bolt/OCRecipes"]`
- [ ] **Step 2: Restart Claude Code.** Settings load at session start.
- [ ] **Step 3: Trial checks, one Write each.** Record each result:
  - a repo file: allowed;
  - a scratchpad file: allowed;
  - a memory `.md` file: allowed;
  - a file in `/Volumes/U34Bolt/OCRecipes/worktrees/…`: allowed;
  - `/tmp/x.txt`: refused;
  - `~/Desktop/x.txt`: refused;
  - an Edit by an `isolation: worktree` subagent, whose worktree is in `.claude/worktrees/`: allowed. The docs single this case out.
- [ ] **Step 4: Decide.** Keep the setting if every "allowed" row passed. If not, add the missing directory or remove the key. Write the outcome into a memory file.

## Separate check (not a task)

A research subagent reported, paraphrasing rather than quoting, that a top-level `effortLevel` in user settings doesn't apply to Opus 5.5. Read the "Adjust effort level" section of https://code.claude.com/docs/en/model-config.md first. Your `~/.claude/settings.json` has `effortLevel: "xhigh"`, so confirm what effort main sessions actually run at before trusting it. That needs the owner to look at the session's effort indicator, or to run `/effort`.
