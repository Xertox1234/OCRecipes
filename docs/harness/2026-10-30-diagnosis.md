# Where the problems come from: agent, harness or outside? (diagnosis, 2026-10-10 → 10-30)

Companion to [`2026-10-30-harness-review.md`](2026-10-30-harness-review.md). That review compared the harness with
current practice. This one looks at the last 20 days of history to see what actually went wrong, and
uses that to re-rank the review's 12-item fix list (§6). The re-ranked list is the working order from here:
one item at a time, spec → execute → compact → next.

**Owner's pains going in:**

- Poor code gets written, then caught, then repaired, then something new is found ("up to 5 review rounds").
- Process steps don't happen (review stamps not applied).

**Owner's finish line:**

- At most 2 review rounds per PR.
- Harness steps happen every time.
- Todo spawning is mostly fixed (owner).

## 1. The short answer

1. **The 5-round review loop is gone from the last 20 days. In its place:**
   - Review rounds are mostly made by the harness itself.
   - The "each fix finds something new" pattern has moved into **chains of follow-up PRs**.
   - Of 288 reviewed pieces of work, **84% had one round and no real PR had more than 3** (§2.1).
   - **No round in the sample was caused by a CRITICAL finding.**
   - **Many "second rounds" are the designed confirmation pass** that binds the review record to the final head. They all came back clean. Whether those count toward the owner's two-round limit is the owner's call (§6).
   - Of the 57 follow-up PRs (37.5%), **35 are the one-review-pass rule working as designed**: a WARNING is found, the PR merges unchanged, and a follow-up PR fixes it. That is a trade the rule makes, not a sign quality got worse.
2. **Extra rounds come mainly from the harness:**
   - Commits the workflow requires after review (archive, codify, merging main) force a confirmation pass.
   - **The WARNING rule contradicts itself across four documents**, so agents fix WARNINGs and re-review.
   - **`preflight:fast` skips checks that CI runs**, so CI moves the head after review.
3. **Defects in the code itself come mainly from the agent:**
   - Gaps where a new flow doesn't match its sibling screens.
   - Claims made without checking them.
   - New regressions introduced while fixing the last finding.
   - Platform breaks that mocked tests and iOS-only checks can't see.
4. **The stamp failures were mostly a Claude Code change.** Reviewers on 2.1.305 lost 0 of 50 stamps; on 2.1.308–2.1.312 they lost 11 of 46 outright (§2.3). Our hook assumed the old event order. That was fixed 10-30, and 0 of 12 have been missed since. Some smaller harness gaps remain.
5. **The guards mostly cause friction.** About 72% of 163 real guard denials were false positives or friction; about 25% were correct catches.
6. **Writing rules into memory doesn't stop repeat mistakes.** Every repeat mistake that already had a memory rule happened again in this window.

## 2. Findings by area

Four read-only agents classified about 206 incidents with evidence. The record files are in this session's scratchpad (§7). Every number marked **(R)** I re-checked myself. The rest are the agents' figures.

### 2.1 Review rounds (16 units read in depth; all 288 counted)

**Rounds per piece of work** (R): 242 had 1 round, 38 had 2, 6 had 3, 1 had 4, 1 had 5.

- About 28% of reviewer runs lacked an extractable head, so the counts could be slightly low.
- Reading the 8 units with 3 or more rounds showed that the 4- and 5-round units were several pieces of work merged together by my grouping. **No real PR had more than 3 rounds.**

**Why rounds happened** (29 rounds read):

| Reason                                                                                                                                   | Rounds |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| A harness-required commit moved the head (archive, codify, merge main, audit phase), so a confirmation pass ran, and all came back clean | 15     |
| Real defect in the first version                                                                                                         | 8      |
| Should have been caught earlier (reviewer inconsistency)                                                                                 | 4      |
| Owner changed scope                                                                                                                      | 1      |
| Introduced by the previous repair                                                                                                        | 1      |
| False positive                                                                                                                           | 0      |

**Findings:**

- **A-G1, HARNESS, high: the WARNING rule contradicts itself** (R).
  - `docs/AI_WORKFLOW.md:29` says WARNING means "do **not** fix-and-re-review".
  - `docs/AI_WORKFLOW.md:107` says "fix inline if clearly in-scope and small".
  - `.claude/agents/todo-executor.md:337-346` says fix inline, then "run Step 6 again (second review round)" with a cap of 2, then the Step 10 confirmation pass, which allows 3.
  - The audit skill (`:304`) says fix inline and re-run.
  - Agents fixed WARNINGs and re-reviewed in #1368, #1629, #1436, #1389 and #1429. In #1389, the one PR that showed the owner's loop in its pure form, every round was a WARNING re-review the written rule prohibits.
- **A-G2, HARNESS, high: `preflight:fast` is missing checks CI runs** (R: `scripts/preflight.sh:51-148`).
  - The fast path runs eslint on changed files, tsc, the hook tests and related vitest only.
  - It does not run the React Compiler bailout check (only inside `npm run lint`), accessibility, hardcoded colours, IDOR or the jsdom-pragma checks, or formatting.
  - CI-only catches moved the head after review in 6 of the 16 sampled units: #1494, #1622, #1429, #1546, #1370, #1357.
- **A-G3: no extra round was caused by a CRITICAL finding** (about 120 reviewer reports).
- **A-G4, AGENT: what the agent gets wrong first time.** Out of 26 round-1 findings:
  - wrong behaviour 14, mostly a new flow not matching an existing sibling screen (recovery codes, ResetPassword, PasswordConfirmModal)
  - docs or comment drift 5
  - accessibility 3
  - layout 2
  - convention 1
  - security 1
  - none for tests, type safety or overbuilding
- **AGENT: the agent skipped the required code-reviewer baseline in round 1** (#1629, #1622). In #1622 it said it would dispatch code-reviewer and sent only security-auditor. The later confirmation code-reviewer was then the first real baseline look, and in #1629 it found a real bug.
- **Is reviewer size to blame?** Not supported by this sample. The 4 "should have caught earlier" rounds look like normal run-to-run variation; nothing ties them to prompt length.

### 2.2 Rework: defects that needed a later PR (104 merges read: all 58 `fix…` plus 46 repair-like)

- **Escape rate:**
  - 22 of 152 feature+fix PRs (14.5%) shipped a defect review didn't catch.
  - Counting review findings fixed in a follow-up PR, total rework is **57 of 152 (37.5%)**.
  - The denominator was filtered by hand (±5).
- **Causes of the 22 escapes:** AGENT 12, MIXED 8 (primary: 3 harness, 3 external, 2 agent), EXTERNAL 2.
- **Who found the escapes:** agents through sim, tests or evals 9; the owner on a device 6 (4 of them after the Android phone arrived on 10-27); nightly CI 3; audit or ultrareview 4.
- Of the 22, reviewers should have caught 4 and partly 8; 9 were not reasonably catchable in review.

**Patterns:**

1. **Platform breaks get past mocked tests and iOS-only checks.**
   - The SDK 57 upgrade (#1549) broke three photo uploads on both platforms for 4 days. Jsdom's FormData and a mocked fetch can't see how the file part is sent.
   - Similar iOS-only fixes broke on Android: #1589, #1595, #1585.
   - Mainly AGENT/EXTERNAL: the upgrade PR never ran a real upload.
2. **Nightly E2E stayed red for days without anyone noticing** (R for #1439).
   - The breach check (#1368) made the seed password invalid: red for 3 nights.
   - A rename (#1512) broke an E2E assertion: red for 7 nights.
   - HARNESS: there is no mechanism that makes a red nightly visible.
3. **Fix chains, where each fix brings the next finding.** This is where "each round finds something new" lives now:
   - 1552 → 1553 → 1554 (worktree guard)
   - 1490 → 1491 → 1499: 1491's new keyword regex caused the "free-range" bug; consistent with the commit bodies (R)
   - 1476 → 1478 → 1479, 1545 → 1548, 1592 → 1606 → 1610
   - AGENT: regressions introduced while fixing. On guard and regex work the author doesn't run a generated test set before review, so the reviewer ends up doing the measuring.
4. **Auth races survive many reviewers.** #1370 had 17 reviewer runs, yet an audit found sessions issued without checking the token version. Ultrareview of #1371 found the same shape 10 days later. More reviewer text doesn't fix this; a mechanical check (a test or a type) would.
5. **Shipped before a sim or eval check.** #1505 and #1424 were found by a sim check after merge. #1464 and #1461 shipped while an eval was already failing.
6. **Harness rules that caused bugs** (classed not-rework):
   - `docs/rules/database.md` required `Promise.all` inside transactions, which caused the pg@9 bug (#1481).
   - The interaction-feel skill claimed every input got the focus border, which wasn't true (#1537).
   - Guard and hook bugs: #1436, #1557, #1385, #1555.

- **Where the code was written also matters.** Some chain PRs (#1491, #1499) were written by Sonnet 5.5 in claude.ai cloud sessions, not by the local Opus session (R). What harness ran there is unverified: the project hooks and skills are in the repo and would load, but user-level pieces (RTK, auto-memory, `~/.claude` settings) would not. Keep the model and environment in mind when judging "agent quality".

### 2.3 Process failures: stamps and gates (30 records)

- **Stamp misses** (stamps on disk only from about 10-26, because /tmp is cleaned):
  - Of 97 reviewer runs that carried the full contract before the fix, 24 got no record of their own. Of those, 11 were never written, 8 were written by hand on owner instruction, and 5 were covered by a re-dispatch.
  - Split by version (R): 2.1.305 stamped 50/50; 2.1.308–2.1.312 stamped 35, never stamped 11. In one session the misses began right after a switch from 2.1.305 to 2.1.312.
  - Every miss has the SubagentStop-before-hand-back race signature.
  - Since the fix landed in the main checkout (10-29 22:20 MDT): 0 of 12 missed.
  - **MIXED: primary EXTERNAL** (a platform change), **secondary HARNESS** (the hook read the transcript once and didn't poll).
  - **It took 8 days to diagnose.** Residual entries said "not investigated (harness frozen)" and auto mode denied the replay, so the owner merged on GitHub (#1541, #1621).
- **The 83 reviewer runs with no `REVIEWED-SHA` line:**
  - 81 prompts never asked for one. No reviewer left the contract out when asked.
  - About 55 were not merge reviews.
  - About 22 were audit Phase 3/6 reviews: HARNESS, because the audit skill's reviewer prompt has no contract, so #1621 needed an extra confirmation round.
  - 4 were ad-hoc prompts: AGENT, against the memory rule "dispatch prompt verbatim".
- **PRs merged without a record:** 10 of 46 since 10-27, all explained (allowlisted paths, or the owner merging after the race). None was an unreviewed merge of risky files.
  - **The "#1535 unstamped merge" residual is a misdiagnosis.** All its files are allowlisted and `todo-automerge-guard.sh --paths-only 1535` returns 0.
  - The guard is silent when it exempts a PR, which invited the wrong conclusion. HARNESS.
- **Guard denials** (163 unique, each judged against the hook source):

  | Guard             | Correct catch | Friction / false positive |
  | ----------------- | ------------- | ------------------------- |
  | pr-preflight      | 4             | 35                        |
  | worktree contract | 7             | 48                        |
  | branch-preflight  | 3             | 5                         |
  | outward-CLI       | 21            | 28                        |
  | merge-review      | 5             | 1 (+4 race, 1 stale diff) |
  - Overall: about 25% correct, about 72% friction.
  - Many of the false positives were fixed mid-window (#1436, the outward-CLI narrowing, the hooks-path fix). Outward-CLI blocks fell from 30 to 2 per 5-day period, a harness fix that clearly worked.
  - Still live: cleanup commands that release the contract in the same command, cd/heredoc/`cp` parse errors, contracts shared across parallel subagent worktrees, read-only multi-call `gh api`, and data heredocs.

- **`inject-patterns.sh` "stdio went quiet":** 25 blocked edits, mostly 10-19 and 10-30.
  - Likely cause, inferred and not reproduced: the PG Lab telemetry runs in a background subshell whose redirect sits on the inner command, not the group, so it keeps the hook's stdout open.
  - The retry succeeds because session dedup skips the background child.
  - MIXED: primary HARNESS, secondary EXTERNAL (the platform got stricter around 10-19).
- **Smaller misfires:**
  - pr-verify reports the wrong PR after an MCP PR creation from a worktree (one confirmed case).
  - session-coord matched an unexpanded `$TODO_TMP/…` path across two sessions.

### 2.4 Friction, owner corrections, mistakes the agent caught itself, compaction, todo spawning (39 records)

**Errored tool calls:** 2,673 of 67,246.

| Cause    | Errors    | Biggest contributors                                                                                                                                                                                                        |
| -------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Benign   | about 860 | Compound commands whose last `grep` found nothing, so the command exited 1                                                                                                                                                  |
| EXTERNAL | about 888 | Claude Code's built-in worktree isolation 516, sim/device 249 (188 from one QA sweep), auto-mode classifier 79                                                                                                              |
| HARNESS  | about 415 | Our guards and hooks (this row also holds 112 permission denials from Claude Code's own permission system, 72 of them in background subagents; strictly those are platform behaviour, though the conclusion doesn't change) |
| AGENT    | about 412 | zsh glob/syntax 148, Edit before Read 84, wrong path 76, inline python 38, foreground sleep 31                                                                                                                              |

**Worktree isolation is the largest error bucket, and it is flat over time.**

- Of the 516 refusals, 459 are in subagents.
- Only 194 involve RTK. Another 120 are plain git commands in a compound form, and 202 aren't git at all (`bash -c`, sourced libraries, `$(…)` values).
- **Fix item 2 as written covers less than half of it.** The rest needs isolation-safe command forms in the skill and executor snippets.

**Memory rules don't stop repeats.** These all happened again despite an existing memory rule:

- zsh glob errors in every period (148 errors across 35 sessions)
- owner-facing instructions called unusable (4 times)
- asking the owner to run checks the agent could do itself
- offering redesigns a day after the "keep the design" ruling
- wrong counts despite "a clean zero needs its denominator"
- treating the whole harness as frozen. This one is HARNESS: the MEMORY.md index said "harness FROZEN" until 10-30.

**Unchecked claims are the main kind of agent mistake.**

- 15 of 40 self-caught mistakes were claims about code, libraries or config that were never checked.
- They include comments a reviewer then flagged, each costing a follow-up PR (#1586).

**The owner absorbs work:**

- "auto mode is off, try again" typed 11 times.
- Prod commands, restarts and merges done by hand.
- Classifier blocks fell from 41 per period to 1–5 once modes were switched per task.

**Compaction:**

- No case found, across 182 compactions, of a step lost, work repeated or a contradiction after compaction. `/todo-fast` re-reads its skill file and state file.
- The cost is the owner's instead: 85 owner messages mention compacting and 35 say "please continue". `/todo-fast` requires a `/compact` after every follow-up.

**Todo spawning: the fix held.**

- Non-audit todos created per 5-day period: 29, 21, 9, 10, 0. Archiving outpaced creation in every period.
- 7 of 74 todo-closing PRs added any new todo.
- New todos now mostly come from audits and reviews, which is by design.

**Background subagents hit permission denials:** 72 of 112 denials, because they can't prompt. Typical commands are `rm -rf` of scratch folders and commands that begin with a variable assignment.

## 3. Cause tally

Counts by primary cause; MIXED records are split by their primary.

| Area                                                  | AGENT     | HARNESS   | EXTERNAL  |
| ----------------------------------------------------- | --------- | --------- | --------- |
| Review rounds (33 records)                            | 17        | 15        | 1         |
| Rework escapes (22)                                   | 14        | 3         | 5         |
| Review follow-ups (35)                                | 35        | 0         | 0         |
| Process and stamps (30)                               | 10        | 16        | 4         |
| Friction and mistakes (39)                            | 23        | 10        | 6         |
| Errored tool calls by volume (about 1,715 non-benign) | about 412 | about 415 | about 888 |

**How to read it:**

- **Code defects are mostly agent-caused.** The answer is checks that catch them before review (preflight parity, real-platform checks, generated test sets on regex and guard work, consistency checks against sibling screens), not more reviewer text.
- **Rounds and process failures are mostly harness-caused, and they are the cheapest to fix.**
- **Error volume is mostly external.** Claude Code's worktree isolation and the simulator lead, and the fix is to adapt how we issue commands.

## 4. What this says about the original 12 items

| #   | Item                                 | Evidence from the diagnosis                                               | New standing                                  |
| --- | ------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | Metrics baseline                     | This diagnosis _is_ the baseline. The scripts exist and only need saving. | Fold into the first fix                       |
| 2   | RTK × worktree rewrite               | Covers 194 of 516 isolation refusals                                      | Broaden to isolation-safe command forms       |
| 3   | inject-patterns fail-open            | 25 blocked edits; likely stdout held by a background subshell             | Fix the root cause, keep fail-open            |
| 4   | Slim code-reviewer                   | No sign that size causes inconsistent findings; still costly              | Cost item; lower priority                     |
| 5   | Slim other agents                    | Same as 4                                                                 | Lower                                         |
| 6   | Split todo/audit skills              | No compaction step-loss found                                             | Lower, except the `$0`/`$1` hazard (§5)       |
| 7   | Slim CLAUDE.md/MEMORY.md             | The stale "harness FROZEN" line misled agents; index near its cap         | Keep, medium                                  |
| 8   | Hook `if:` / delete preference hooks | 72% guard friction; specific live false positives listed                  | Keep, reshape around the live false positives |
| 9   | Memory → mechanisms                  | Strongly supported (every memory-ruled mistake repeated)                  | Raise                                         |
| 10  | Sandbox / blockWrites                | 72 permission denials in background subagents                             | Keep, medium                                  |
| 11  | Path-scoped rules pilot              | No evidence either way                                                    | Lower                                         |
| 12  | Frontmatter pass                     | No evidence either way                                                    | Lower                                         |

**New items the diagnosis surfaced:**

- **N1. One WARNING rule, stated the same way in all four places** (AI_WORKFLOW ×2, todo-executor, audit skill, plus the memory line). **Which rule is the owner's call:**
  - (a) _Follow-up PR:_ keep today's written rule. A WARNING never gets fixed on the branch; it goes to a follow-up PR. In the window that meant 35 extra PRs, each with its own review, archive and codify.
  - (b) _Fix small ones in place:_ small, in-scope WARNINGs get fixed on the branch, followed by the one confirmation pass. That means about 35 extra confirmation rounds instead, within the owner's "a second round is fine". Bigger WARNINGs still go to a follow-up.
  - Either way the contradictory text goes.
- **N2. `preflight:fast` parity with cheap CI checks:** the bailout check, accessibility, colours, IDOR, jsdom pragma and formatting on changed files, plus a whole-repo lint when the eslint config or its dependencies change. This adds local seconds, not CI time.
- **N3. Remove the avoidable head-movers:**
  - Run the pr-preflight overlap check before review, not at PR creation.
  - Merge main or rebase before review where possible.
  - Codify stays after review, because it captures what review taught. Its confirmation pass is the designed cost.
- **N4. A dispatch helper** that always includes code-reviewer and produces the verbatim contract prompt, used by `/todo`, `/todo-fast` and the audit Phase 3/6 reviews.
- **N5. A red nightly E2E run becomes visible** (surfaced at session start or filed automatically).
- **N6. Real-platform checks** for SDK, native and upload changes: a real upload or E2E run before merge, and Android as well as iOS.
- **N7. Generated test sets for regex and guard changes,** run by the author before review. This stops fix chains.
- **N8. Make guard exemptions visible:** when a guard exempts a PR, say so (the #1535 misdiagnosis).

## 5. High-severity finding for the owner to decide (not filed)

**The `$1`/`$0` substitution in `.claude/skills/todo/SKILL.md` can turn the worktree-in-use check into "safe to remove".**

- The `wt_in_use` function (lines 17–50 and again at about 482) starts `w="$1"` and later uses awk `$0`. The skill loader replaces `$N` with the invocation's arguments (documented, and `docs/solutions/logic-errors/skill-argument-substitution-…-2026-10-26.md`).
- **Confirmed live in the rendered skill text (R).** `/todo` is often run with arguments (dozens of runs pass a todo path).
- **With one argument,** the loader replaced awk's `$0` with the todo path, so the awk line is invalid. That turns off signal 3, the process-cwd check; signals 1 and 2 still work. 8 such runs were checked.
- **With two or more words of arguments,** it also replaced `$1`. The rendered function read `w="unattended"` in the overnight sweep (session 9ca0bd2d) and `w="P2-2026-10-26-scan-screen-decomposition"` in session 14ef3823. Then `[ -d "$w" ] || return 1` answers "safe to remove" for **every** leftover worktree, and Phase 0 would force-remove worktrees other sessions are using. That deletes their uncommitted work: the PR #980 near-miss class.
- **No damage observed.** In both runs the removals were the run's own executor worktrees, named by explicit path; no Phase 0 sweep calling `wt_in_use` was seen.
- The fix is small: move `wt_in_use` into a script file the skill calls (`scripts/…`), so the loader never sees `$1`/`$0`. A script is never substituted. Whether `${1}` survives the loader is undocumented, so don't rely on it.

## 6. Re-ranked working list

Each item gets spec → execute → compact → next. The ranking weighs evidence strength, then cost (smallest first), then risk.

| Rank | Item                                                                                  | Why here                                                                           |
| ---- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 0    | §5 `$0`/`$1` worktree hazard                                                          | High severity, confirmed live in the rendered text, small; **owner decides first** |
| 1    | N1: one WARNING rule (owner picks (a) or (b))                                         | Direct cause of re-review rounds; a docs-only change                               |
| 2    | N2: preflight:fast parity                                                             | 6 of 16 sampled units got a CI-only catch after review                             |
| 3    | N4: dispatch helper (code-reviewer always, verbatim contract; audit too)              | Missed baseline, missing contracts, ad-hoc prompts                                 |
| 4    | N3: avoidable head-movers (overlap check before review, merge main before review)     | Confirmation passes are clean and cheap; the remaining churn is small              |
| 5    | Item 3: inject-patterns root cause                                                    | 25 blocked edits; small                                                            |
| 6    | Item 2 (broadened): isolation-safe command forms + RTK skip in worktrees              | Largest error bucket, flat over time                                               |
| 7    | Item 9: memory → mechanisms, starting with zsh glob, "denominator", "run it yourself" | Every memory-ruled mistake repeated                                                |
| 8    | N7: generated test sets for regex and guard changes                                   | Stops fix chains                                                                   |
| 9    | N5: visible nightly E2E red                                                           | Up to 7 nights unseen                                                              |
| 10   | N6: real-platform checks for SDK/native/upload changes                                | 4 days of broken uploads                                                           |
| 11   | Item 8 (reshaped) + N8: live guard false positives, exemption messages                | About 72% friction                                                                 |
| 12   | Item 7: slim CLAUDE.md / MEMORY.md, remove stale lines                                | Misled agents; near the cap                                                        |
| 13   | Item 10: sandbox / permissions for background subagents                               | 72 subagent denials                                                                |
| 14   | Items 4/5: slim reviewer and executor definitions                                     | Cost, not quality                                                                  |
| 15   | Items 6, 11, 12: skill split, rules pilot, frontmatter                                | Low evidence                                                                       |
| —    | Item 1: metrics                                                                       | Save the diagnosis scripts with rank 1's PR; re-run after rank 4 and rank 6        |

### Baseline: the numbers every item is re-measured against (window 10-10 → 10-30)

| Metric                          | Baseline                                                                      | Source   |
| ------------------------------- | ----------------------------------------------------------------------------- | -------- |
| Review rounds per piece of work | 1: 242 · 2: 38 · 3: 6 · 4: 1 · 5: 1 (288 units; real PRs ≤3)                  | §2.1 (R) |
| Follow-up PR rate               | 57 / 152 feature+fix PRs (22 escaped + 35 review findings deferred by design) | §2.2     |
| Stamp misses by version         | 2.1.305: 0/50 · 2.1.308–312: 11/46 never written · since fix: 0/12            | §2.3 (R) |
| Guard-denial friction           | about 117 / 163 friction or false positive (about 72%)                        | §2.3     |
| Worktree-isolation refusals     | 516 in 20 days (459 in subagents)                                             | §2.4     |

Re-measure the relevant row after each item with the same window length. Keep an item if its row moves the right way and the follow-up rate doesn't rise.

## 7. Method, denominators and limits

- **Window:** 2026-10-10 → 10-30, the transcripts available locally (owner's choice). That is 71 main sessions, about 1,300 subagent runs, 680 reviewer runs and 273 merges on main.
- **Agents and samples:**
  - A: review rounds, 16 units.
  - B: stamps and guards. 673 reviewer runs scanned; 163 denials judged.
  - C: rework, 104 merges.
  - D: errors, corrections and compaction. 2,673 errors, 766 owner messages, 40 self-caught mistakes, 182 compactions.
- **Re-checked here (R):**
  - The rounds distribution.
  - The WARNING-rule contradiction lines.
  - The preflight:fast step list.
  - The stamp-by-version table.
  - #1439, and the 1491/1499 commit bodies.
  - The `$1`/`$0` rendering in a real skill load.
- **Not re-checked:** the other agents' counts, especially the friction categories (regex buckets), the rework escape rate (hand-filtered denominator) and the inject-patterns root cause (inferred).
- **Raw records:** `diag-A-rounds.jsonl`, `diag-B-process.jsonl`, `diag-C-rework.jsonl`, `diag-D-friction.jsonl`, `reviews.jsonl`, `units_merged.json` and the scripts that built them are copied outside the repo to `~/.local/share/ocrecipes-harness-diagnosis/2026-10-30/`.
  - They are not committed: this is a public repo, and the records hold paraphrased owner messages and transcript paths.
  - The extraction scripts are to be cleaned and committed with the metrics item.
