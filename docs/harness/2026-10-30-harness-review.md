# OCRecipes harness review: how it compares with current practice (2026-10-30)

**Scope.** This review covers the Claude Code harness only: `CLAUDE.md`, auto-memory, `.claude/{skills,agents,hooks,settings.json}`, `docs/AI_WORKFLOW.md`, `docs/rules/` and `docs/harness-residuals.md`. No code, config or todos were changed. Proposed todos are listed in §7; none were filed.

**Evidence base.**

- **Git history:** 9 months, 2026-01-30 to 2026-10-30.
- **Transcripts:** 20 days, 2026-10-10 to 10-30, covering 71 main sessions and about 1,300 subagent runs. Transcripts older than that have been cleaned up.
- **Official docs:** code.claude.com, fetched today.
- **Anthropic engineering posts.**
- **Karpathy:** his primary posts, 2025–2026.
- **About 15 practitioners and 4 measured studies.**

Figures marked **(R)** I reproduced myself in this session. Figures marked **(D)** come from a delegated measurement that I have not reproduced, so they are approximate.

---

## 0. TL;DR

1. **The safety architecture is sound and matches the field.** Worktree isolation, a pass/fail preflight plus CI gate, fresh-context read-only review, TDD, and an outward-CLI guard born from a real incident are all things Karpathy, Anthropic and the strongest practitioners recommend. Keep all of it (§5).
2. **The weak point is accumulated prose, not missing process.** The reviewer and executor definitions have turned into incident logs: `code-reviewer.md` grew from 12.6 KB to 121.9 KB (R for today's size). Each dispatch pays for the whole file, plus CLAUDE.md, plus MEMORY.md (R: present in 15/15 sampled code-reviewer transcripts). Current guidance (Anthropic's context-engineering post, the best-practices doc, and Karpathy's "just the right information for the next step") all point the other way.
3. **Several rules the harness wrote for itself aren't being followed, which is the textbook sign that a prose rule should become a mechanism or be removed.**
   - 84 memory files still carry SHIPPED/RESOLVED/MERGED/DONE markers, despite the rule to reduce them at codify time (R).
   - A memory note about the RTK × worktree collision existed and about 518 refusals still happened (D; text occurrences R).
   - Repeat counters sit at 14×, 11× and 6× (R, in MEMORY.md).
4. **Skills: the two most-used skills have outgrown their own design.** `todo/SKILL.md` is about 57 KB and `audit/SKILL.md` about 53 KB. The docs say to keep SKILL.md under 500 lines and that **after compaction only the first 5,000 tokens of each skill are re-attached**, so the back half of `/todo` (about 14k tokens) is silently dropped after every `/compact` in a long `/todo` run.
5. **The hook count is at the line the official doc names.** There are 42 registrations of 24 distinct scripts (R), against the doc's own threshold: "If you ever find yourself at forty of them, most are probably preferences." Each Bash call starts 14 hook processes and each Edit starts 5 (R). They run in parallel, so the cost is process-start overhead rather than 14 delays in a row. There is now a native `if:` filter that would stop most of these from starting on calls they don't care about.

The single highest-value move is to **adopt Anthropic's March 2026 harness rule as the exit criterion for the current freeze:** "every component encodes an assumption about what the model can't do on its own". Remove one component at a time and measure. §6 proposes the three baseline metrics that make each cut a keep-or-discard decision, the same shape Karpathy uses in autoresearch.

---

## 1. What "current standard" means (Oct 2026)

### 1.1 Official Claude Code docs (fetched 2026-10-30, CLI 2.1.314)

| Topic             | What the docs say now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CLAUDE.md         | Target **under 200 lines**. "Every line in it takes a little of Claude's attention on every task." Keep only what Claude can't learn by reading the repo. **"Describe your architecture and file layout in CLAUDE.md" is in the "What you can stop doing" table**: "Claude reads the repo itself." `/doctor prompt-audit` flags stale or contradictory lines across CLAUDE.md, rules, skills and agents.                                                                                                                                                                       |
| Emphasis          | "Piling on emphasis mostly makes Claude over-apply the rule. If it's a rule that can't bend, turn it into a hook… If the line is getting lost in a long file, the file needs to be shorter." _(verified verbatim)_                                                                                                                                                                                                                                                                                                                                                             |
| Hooks             | "Keep the enforced set small… **If you ever find yourself at forty of them, most are probably preferences that Claude could have weighed on its own.**" And: "if you have hooks for things that are only preferences, **delete them and let Claude decide**." _(both verified verbatim)_                                                                                                                                                                                                                                                                                       |
| Hook `if:` field  | Permission-rule syntax such as `"Bash(git *)"`. The hook process only starts when the call matches, which is described as "avoiding the process spawn overhead". One expression per handler; it applies to tool events only. _(verified)_                                                                                                                                                                                                                                                                                                                                      |
| Path-scoped rules | `.claude/rules/*.md` with `paths:` frontmatter load "when matching files are opened" (read or edit). This is the native form of what `inject-patterns.sh` does for `docs/rules/`. _(verified)_                                                                                                                                                                                                                                                                                                                                                                                 |
| Auto memory       | The first **200 lines or 25 KB** of MEMORY.md load at startup, whichever comes first. Topic files load on demand. _(verified)_                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Skills            | Keep SKILL.md **under 500 lines** and move reference material to files read on demand. After compaction, each skill's latest invocation is re-attached, "**keeping the first 5,000 tokens of each**", within a 25k-token combined budget filled from the most recently invoked skill. _(both verified verbatim)_ The skill listing is capped at 1% of the context window, and each description is truncated at 1,536 characters _(the 1,536 figure is verified; the 1% comes from the docs agent)_. `disable-model-invocation: true` keeps a skill to manual `/name` use only. |
| Subagents         | The body becomes the system prompt and loads in full on every dispatch. There is a startup warning when **descriptions** exceed 15k tokens; no cap on body size is documented. Newer frontmatter fields include `omitClaudeMd`, `skills:`, `effort`, `maxTurns`, `isolation: worktree`, `autoCompactWindow` and `memory:`. "A fresh subagent first has to gather context your conversation already had, so it can end up _slower_." _(the last quote is verified)_                                                                                                             |
| Verification      | "Give Claude something it can run that comes back pass or fail" is the lead recommendation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### 1.2 Karpathy (primary sources, 2025–2026)

- **Context engineering (Jun 2025):** "the delicate art and science of filling the context window with _just the right information for the next step_." He adds that too much or irrelevant context raises cost _and can lower performance_.
- **Keep it on a leash (YC, Jun 2025):** "small incremental chunks". Make the generate → verify loop "go very, very fast". "Iron Man suits, not robots", with an autonomy slider.
- **Jan 26, 2026, after moving to about 80% agent coding:** agents "overcomplicate code and APIs, bloat abstractions, don't seek clarifications, … sycophantic", and "**all of this happens despite a few simple attempts to fix it via instructions in CLAUDE.md**." What works for him is plan mode, then "**Don't tell it what to do, give it success criteria and watch it go.**" He watches "like a hawk".
- **autoresearch (Mar 2026), his one published agent program:** about 1,100 words of `program.md`; **one** editable file; a read-only evaluator; **one** metric; commit-or-reset as the keep/discard step; "simpler is better". It is fully autonomous, but only because the yardstick is fully automatic and the sandbox is tiny.
- **LLM Knowledge Bases (Apr 2026):** raw sources are compiled by the LLM into a cross-linked markdown wiki, kept in shape by LLM "health checks". This is essentially what `docs/solutions/` plus its frontmatter linter is.
- **Dec 2025:** mastering "agents, subagents, prompts, contexts, memory, modes, permissions, tools, plugins, skills, hooks, MCP…" is the new skill, and failing at it is "skill issue". So he would **not** reject a heavy harness on principle. He would ask each layer to earn its context cost and be backed by a check.
- **Correction:** the viral "Karpathy guidelines" CLAUDE.md (forrestchang/andrej-karpathy-skills) is **community-written**. It inverts his Jan 2026 complaints into four rules (think first, simplicity, surgical changes, goal-driven), but he didn't write or endorse it.

### 1.3 Other practitioners and the research (condensed)

- **Boris Cherny (Claude Code lead):**
  - The team CLAUDE.md is about **2.5k tokens**, kept in git and updated after each correction.
  - Most PRs start in plan mode.
  - Verification loops are "the most important thing".
  - Anything done more than once a day becomes a skill.
  - The only hook he describes is a PostToolUse formatter.
- **Anthropic, "Harness design for long-running apps" (Mar 2026):** components encode assumptions that go stale, so remove one at a time and measure. Over model generations they _removed_ context resets, sprints and per-sprint evaluation. They kept the planner and the skeptical separate evaluator.
- **Anthropic April 2026 postmortem:** **one verbosity line in the system prompt cost 3% on coding evals.** Their remedy is to ablate prompt lines individually and run evals on every prompt change.
- **HumanLayer:**
  - Research, then plan, then implement, with intentional compaction.
  - Frontier models follow about 150–200 instructions reliably.
  - "Don't use CLAUDE.md as a linter."
  - CLAUDE.md under 60–300 lines.
- **Mitchell Hashimoto, "harness engineering":** when the agent makes a mistake, engineer it so it _never_ happens again. A line for simple cases, a tool or script for anything else.
- **Armin Ronacher:** hooks gave no efficiency gain for him. Subagents work well only for read-only investigation. Delete automation you don't use regularly.
- **Geoffrey Huntley (Ralph):** fresh context per loop. Many searchers, **only one builder**. Backpressure from tests, types and lint.
- **Peter Steinberger (light pole):** an 800-line AGENTS.md that he calls "scar tissue". No subagents. MCPs should be CLIs.
- **Measured research, mixed:**
  - _IFScale:_ the best models reach 68% accuracy at 500 instructions, with a primacy bias.
  - _Chroma, "context rot":_ focused 300-token inputs beat 113k-token full inputs, and Claude showed the largest gap.
  - _ETH 2026:_ AGENTS.md files did **not** generally improve success and **cost 20%+ more**; repository overviews were unhelpful.
  - _Lulla 2026:_ AGENTS.md was associated with faster, cheaper runs.
  - _McMillan 2026:_ across 1,650 Claude Code sessions, **file size had no detectable effect on adherence**. The biggest effect was _within_ a session (−5.6% compliance odds per extra generated function). The range of file sizes tested is unconfirmed, so it may not reach 120 KB agent bodies.

**Synthesis.** Size alone is not proven harmful. What the evidence does support:

1. Irrelevant context costs money and sometimes quality.
2. Overview or architecture prose doesn't help.
3. A rule backed by a check beats a rule backed by emphasis.
4. Harness parts should be re-tested as models improve.

---

## 2. Scorecard

| Area                  | Current standard                                                   | OCRecipes today                                                                                   | Verdict                                               |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Verification loop     | Pass/fail checks; CI as the source of truth                        | preflight:fast on push, PR stamp gate, 8 required CI checks, TDD                                  | ✅ Ahead of most                                      |
| Isolation and safety  | Worktrees, sandbox, deny the irreversible                          | Worktree contract, outward-CLI guard, branch protection, sandbox-run                              | ✅ Keep; sandbox not used for the Bash tool (see F10) |
| Fresh-context review  | Read-only reviewer, separate evaluator                             | Roster of read-only reviewers, one pass per PR                                                    | ✅ Concept right; prompt size wrong (F1)              |
| Plan before code      | Plan mode, research → plan → implement, process scaled to the task | spec-review, superpowers brainstorm/plans, /todo vs /todo-fast                                    | ✅                                                    |
| CLAUDE.md             | <200 lines, about 2.5k tokens, no architecture                     | 141 lines but **19.3 KB (~5k tokens)**; has an Architecture section and long mechanism paragraphs | ⚠️ (F4)                                               |
| Auto memory           | Index fits the limit; topic files on demand                        | 103 lines / **20.7 KB = 83% of the 25 KB cap**; 42/103 lines carry 🛑; 84 shipped-marker files    | ⚠️ (F4, F7)                                           |
| Subagent prompts      | Focused; "right altitude"; examples over edge-case lists           | 14–122 KB; incident narratives; ~490 KB across reviewers + executor                               | ❌ (F1)                                               |
| Skills                | <500 lines; progressive disclosure                                 | todo 556 lines / 57 KB; audit 469 lines / 53 KB; only audit has reference files                   | ⚠️ (F6)                                               |
| Hooks                 | Small enforced set; zero-exception rules only; `if:` filters       | 42 registrations / 24 scripts; no `if:`; ~28–33 edits blocked by inject-patterns _failing_ (D)    | ⚠️ (F3)                                               |
| Path-scoped rules     | `.claude/rules/` with `paths:`                                     | Custom injection hook (works; median 444 B per edit, D)                                           | ⚠️ (F5, low priority)                                 |
| Re-testing components | Ablate; remove one at a time and measure                           | No baseline metrics; freeze in place                                                              | ❌ (F8, §6)                                           |

---

## 3. Findings, ranked by expected value

### F1. Reviewer and executor definitions have become incident logs. **Highest value.**

**Evidence.**

- Sizes today (R): code-reviewer 121.9 KB, todo-executor 90.7, mobile-reviewer 81.1, security-auditor 54.3, ai-reviewer 53.0, server-reviewer 44.2 KB.
- `code-reviewer.md` packs 225 lines into 122 KB. Single checklist items run up to 3,600 characters, and the file carries 29 PR references and 119 dates (R). One item tells a full story about a shell-redirect normalisation bug in a hook. It gets loaded for every TypeScript review of a React screen.
- Growth (D): 12.6 KB in Feb → 48 KB in Jun → 90 KB in Sep → 122 KB in Oct. It is the most-changed harness file (109 commits, D).
- Within it (D): section 0 "CI, Hooks & Review Gates" is about 15.6 KB of shell-guard detail; the Testing section is about 55 KB.
- Dispatch volume (D): about 961 reviewer dispatches in 20 days for about 403 PRs (2.4 per PR). About 51M cache-write tokens, about 25% of all cache writes; code-reviewer alone about 30M.
- Each dispatch also carries CLAUDE.md and MEMORY.md (R: 15/15 sampled code-reviewer transcripts contain MEMORY.md text).

**Why it matters (precisely).**

- No documented cap on body size is being broken.
- Three things make this costly:
  1. Every dispatch re-writes the whole definition to cache, and each of the 109 edits invalidates any warm cache.
  2. Anthropic measured that a single added prompt line can cost 3% on evals, so a 30k-token checklist is untested prompt weight.
  3. The incident stories are already the kind of thing `docs/solutions/` exists to hold.
- The McMillan study argues against assuming size hurts _adherence_, so the main case rests on cost and on keeping each review lens relevant.

**Recommendation.**

1. **Restructure each reviewer into three tiers:**
   - (a) A short core of rules, one line each, with a `→ docs/solutions/<file>` pointer where a story exists. Target about 10–20 KB.
   - (b) Domain stories pulled in only by matching path. The reviewer greps `docs/solutions` by tag for the diff's paths, the same mechanism `inject-patterns.sh` already uses.
   - (c) Section 0, the guard checklist, moved into a separate `harness-reviewer` dispatched **only when the diff touches `.claude/hooks/**`or`scripts/_preflight_`\*\*.
2. **Rewrite the long items as "rule + why + one example".** The context-engineering post prefers a few canonical examples to long lists of edge-case rules. Most 3,000-character items shrink to about 400 characters with no loss of what to check.
3. Consider **`omitClaudeMd: true`** on the read-only reviewers. Hand each one the 3–5 CLAUDE.md facts it needs in the body, which cuts about 10k tokens per dispatch (D for the 10k). This needs a check that the review-stamp contract doesn't depend on CLAUDE.md text.
   - _Docs vs measurement:_ the docs agent read the sub-agents page as saying auto memory is **not** loaded into subagents. I measured that it is: MEMORY.md arrives in reviewer transcripts as a "Contents of …/memory/MEMORY.md" entry, in the same bundle as both CLAUDE.md files (R). `omitClaudeMd` therefore _probably_ drops MEMORY.md too, but that is unverified. Confirm with one dispatch before counting the saving.
4. **Add a growth ratchet:** a byte cap per agent file in **lint-staged** (not a new CI step), the same pattern already used for `docs/rules` (the 5,900 B cap). Without one, F1 grows back. Running it in lint-staged adds no CI time, so it is allowed under the freeze ruling.
5. Measure before and after with the §6 metrics. Keep the change only if the review catch-rate holds; replay the last 20 merged PRs' reviews as a test set.

### F2. The RTK × worktree-isolation collision is the largest single source of refused tool calls.

**Evidence.**

- About 518 refusals in 20 days, about 20% of all tool errors (D). The message text occurs about 1,180 times across main and subagent transcripts (R; it includes repeats inside one record).
- `reference_rtk_worktree_guard_blocks_git.md` records the mechanism: Claude Code's own `EnterWorktree` layer refuses `rtk git …` rewrites, but plain `/usr/bin/git` runs everything.
- That note has existed since 2026-09-13, and the refusals kept happening.

**Why it matters.** This is the clearest proof in the repo of the best-practices rule: a note doesn't change behaviour, a mechanism does. Each refusal costs a turn plus the retry.

**Recommendation (lives outside the project):**

- In the **global RTK hook** (`~/.claude/`), skip the `git → rtk git` rewrite when the hook input's `cwd` is inside a **linked worktree**. Detect that generically: `git rev-parse --git-dir` differs from `--git-common-dir`, or `.git` is a file. A path prefix would miss the U34Bolt worktrees made by `scripts/oc-worktree.sh`. That keeps the 45.5% RTK savings everywhere else and removes the collision.
- A weaker alternative, if the global hook can't be changed: a one-line `/usr/bin/git` directive in the todo-executor and worktree dispatch templates.
- Either way, keep RTK; the memory note's measured savings stand.

### F3. Hooks: classify, filter with `if:`, delete the preference hooks, and make the injector non-blocking on failure.

**Evidence (R).**

- 42 registrations of 24 distinct scripts.
- Per Bash call: 10 PreToolUse and 4 PostToolUse processes from project hooks alone, so **at least 14** (the user-level RTK hook adds more). Per Edit/Write: 3 Pre and 2 Post.
- None uses `if:`. A live example from writing this report: `inject-patterns.sh` fired on a scratchpad file outside the repo and injected the edit preamble, where it had nothing to do. `if: Write(/Users/williamtower/projects/**)`, or an early path check, would skip it.
- `inject-patterns.sh` _failing_ (stdio went quiet) blocked about 28–33 edits (D). Those blocks protect nothing.

**Proposed classification** (to confirm with the owner; my reading from names, settings and CLAUDE.md):

| Class                                    | Scripts                                                                                                                            | Proposal                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Deny guards for zero-exception rules** | git-safety, guard-outward-cli, guard-worktree-isolation, core-bare-guard, pr-preflight-guard, merge-review-guard, branch-preflight | **Keep.** These are the doc's "rules that can't have exceptions", and two came from real incidents (OTA, merge without review). Keep the full `Bash` matcher on deny guards, because an `if: Bash(git *)` filter might not catch the evasion forms these guards' parsers handle (`/usr/bin/git`, `env git`, wrappers). |
| **Verify and record (after the call)**   | commit-verify, pr-verify, drift-detect-update, review-stamp-writer, session-coord record, eslint-fix                               | **Add `if:`** wherever the hook only matters for a pattern: `Bash(git commit*)`, `Bash(git push*)`, `Bash(gh pr *)`, and so on. Each `if:` holds one expression, so a hook with two triggers needs two handlers.                                                                                                       |
| **Warn or nudge (preferences)**          | drift-detect (warn-only), nudge-dependency-add, session-recent-issues                                                              | **Candidates to delete** under "hooks for preferences: delete them and let Claude decide". Keep drift-detect if the owner values the parallel-terminal warning; it is cheap with `if: Bash(git commit*)` / `Bash(git push*)`.                                                                                          |
| **Context injection**                    | inject-patterns, session-start, session-resume-ledger, session-ledger-instruction, precompact-ledger                               | Keep, but **inject-patterns must fail open**: exit 0 with no context on an internal error, never block the edit. Session-start output re-fired 294 times, 3.4 MB in total (D), once per compaction or resume, so trim its payload (F4).                                                                                |
| **Coordination and housekeeping**        | session-coord (5 events), checkpoint (2), worktree-deps, checkpoint reap                                                           | Keep. Narrow `checkpoint.sh` on Bash with `if:` to the commands it actually snapshots.                                                                                                                                                                                                                                 |

**Ruling check.** Narrowing or removing hooks _reduces_ CI time and spawn overhead, so it falls outside "harness frozen only for changes that increase CI time" (2026-10-30). Constructible gaps in guards still go to `docs/harness-residuals.md`, not to fixes.

### F4. Always-loaded context: CLAUDE.md, MEMORY.md and the SessionStart payload.

**Evidence.**

- CLAUDE.md is 141 lines and 19.3 KB (R), about 5k tokens, roughly twice the Claude Code team's file. One "Workflow Standards" bullet on preflight mechanics runs about 1.5 KB. It has Architecture and Navigation sections, which the docs list under "stop doing".
- MEMORY.md is 103 lines and 20.7 KB (R), **83% of the 25 KB load cap.** When it passes 25 KB, the **tail is dropped silently**. The tail is "Dev Tooling", "Git Notes", "Workflow" and "Cold Topics": the operational notes.
- MEMORY.md opens with "Recently Shipped", the opposite of the CLAUDE.md rule that shipped entries are reduced at codify time.
- 42 of MEMORY.md's 103 lines carry 🛑 (R). When nearly every line is marked top priority, the marker stops ranking anything, and the docs say emphasis makes Claude over-apply rules.

**Recommendation.**

1. **CLAUDE.md to about 8 KB:**
   - Delete the Architecture and Navigation paragraphs (Claude reads the repo).
   - Move the preflight and stamp mechanics into `docs/AI_WORKFLOW.md`, leaving a one-line pointer.
   - Move the Deferred-Item-Todos block into `todos/README.md` and the hooks/harness bullets into a path-scoped rule (`paths: .claude/**, scripts/**`).
   - Keep the commands and footguns, the env-var list and the git rules.
2. **MEMORY.md:**
   - Delete the "Recently Shipped" block; each line becomes a one-paragraph durable takeaway or is removed (84 marker files to work through).
   - Keep 🛑 for about 5 truly catastrophic rules, for example never revert, the pv2$ hash rule, and RTK is load-bearing.
   - Add a CI-free local check that warns above 20 KB.
3. Run **`/doctor prompt-audit`** (new; it covers CLAUDE.md, rules, skills and agents) as the first pass. It flags stale or contradictory lines automatically.

### F5. Moving `docs/rules/` to native path-scoped rules (`.claude/rules/` + `paths:`). Medium or low priority.

- The injector works and is cheap (median 444 B per edit, D).
- Native rules would bring three gains:
  1. They load on **reads** as well as edits, so planning and investigation see the binding rules too.
  2. There is no hook process that can fail and block an edit (F3).
  3. They show up in `/doctor prompt-audit`.
- This is a **partial** replacement. The `docs/solutions/` tag-grep half has no native equivalent, so keep the hook for solutions only.
- Unverified: whether path-scoped rules load inside subagents. Check one dispatch before relying on it for reviewers.
- The generated `domain-map.sh` and Copilot instructions builder would need their sources re-pointed.

### F6. The two big skills break the 500-line, progressive-disclosure guidance and lose their tail after compaction.

**Evidence.**

- `todo/SKILL.md`: 556 lines, about 57 KB (D for bytes). Grew from 19 KB.
- `audit/SKILL.md`: 469 lines, about 53 KB; grew from 6.3 KB.
- Compaction re-attaches only **the first 5,000 tokens** of each skill (docs).
- /todo is the most-used skill (37 Skill calls + 16 slash commands in 20 days, D), and its runs are the longest, which makes them the ones most likely to compact.

**Recommendation.**

- Split each into a short orchestration spine and reference files read at the step that needs them: `phases/`, `gotchas.md`, `collision-handling.md`. Only `audit/` uses supporting files today.
- Put the steps that must survive compaction in the first 5,000 tokens.
- This is mechanical and testable: after a `/compact` mid-run, ask the session what step 5b requires.

**Usage note.** `regression-triage` had 0 uses in 20 days. It is reactive by design, so that is low signal, not a reason to retire it. `crafting-ui` stays installed per the 2026-10-29 ruling.

### F7. Memory is being used as a behaviour control, and it isn't controlling behaviour.

**Evidence (R).**

- "Structural claims go unverified" is at 14×, "a clean zero needs its denominator" at 11×, "check the API IP first" at 6×.
- 290 memory files: 143 project, 91 feedback, 46 reference (D).

**Why it matters.** This is the pattern Karpathy describes ("despite… instructions in CLAUDE.md"), and the docs' fix is direct: shorten the file, or make it a hook or check. A counter climbing past 10 means the note has stopped working.

**Recommendation.** For each counter of 5× or more, ask Hashimoto's question: what _mechanism_ makes this impossible?

- **"Check the API IP first":** make it step 1 of `verify-ui` as a script (`curl $EXPO_PUBLIC_DOMAIN/api/health` with a clear failure message), not a memory line.
- **"Clean zero needs its denominator":** a small helper that probe scripts call, which refuses to print `0` without `of N`. Or move the rule into the one skill or agent where probes are written.
- **"Structural claims go unverified":** the reviewer roster already gives fresh-context checking. Add one line to the code-reviewer core: "every count, path or 'X is unused' claim in the PR body must cite the command that produced it."
- Then delete the memory entries. A note retired into a mechanism should not stay as a second copy.

### F8. Harness engineering time and the freeze: give it an exit criterion.

**Evidence.**

- Harness commits outnumbered app commits in July (125 vs 97) and August (48 vs 40) (R).
- 69 hook files, about 44k lines of bash, of which about 23k are hook tests (D).
- Real-use guard misses still happened in late October: #1535, #1541, #1592, #1614 in `docs/harness-residuals.md` (D).

**Context.** The owner already froze guard hardening (2026-09-22, restated 2026-10-16/30). This finding explains the freeze rather than adding anything new.

**Recommendation.** Turn the freeze into a policy with a test, following the March 2026 harness post. For any harness component, state the assumption it encodes ("the model will push to main without this"), then disable it for N sessions in a worktree and compare the §6 metrics. Keep it if it measurably prevents something; otherwise remove it. This is the opposite of the residuals log's direction, which only adds.

### F9. One rule, many copies.

**Evidence (D, sampled).**

- One-review-pass appears in AI_WORKFLOW.md (:24, :81), CLAUDE.md (:115), MEMORY.md (:26, :40) and 3 memory files.
- Preflight-stamp mechanics appear in CLAUDE.md:31 plus 7 memory files.
- The REVIEWED-SHA format appears in 12 files (7× in one).
- The same merge-gate contract paragraph appears in 4 reviewer files.
- Mostly paraphrases: word-for-word shared lines across 3+ agent files total only about 9 KB.

**Recommendation.** One canonical home per rule (AI_WORKFLOW for process, the agent for its own contract) and pointers everywhere else. Paraphrased copies drift, and the drift has already produced contradictions the advisor and reviewers had to resolve. `/doctor prompt-audit` will surface some of them.

### F10. Smaller modernization items

- **Sandbox for the Bash tool.** `sandbox.enabled` (Seatbelt on macOS) is off. With `sandbox-run` and auto mode already in place, enabling it with `network.allowedDomains` would lower permission prompts without weakening the outward-CLI guard. Worth trialling. Auto mode blocked about 70 calls (D), and you had to say "auto mode is off, try again" 5+ times.
- **`permissions.blockWritesOutsideWorkingDirectories`** (2.1.314, new today) covers part of what the absolute-path worktree guard does natively. Evaluate it as a complement, not a replacement.
- **Explore and Plan get no CLAUDE.md.** CLAUDE.md already tells dispatchers to pass the LSP directive. Fine as is.
- **Manual compaction is the norm:** 159 `/compact` + 26 `/clear` in 20 days (D). That is reasonable practice (HumanLayer's intentional compaction), but it multiplies the SessionStart payload (F4) and the skill-tail loss (F6). Fixing those two makes compaction cheaper.

### F11. Frontmatter against current fields

| File                                                                    | Today                                                                                                    | Current fields that apply                                  | Proposal                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `todo`, `todo-fast`, `audit`, `audit-security`, `audit-maintainability` | `name` and `description` only                                                                            | `disable-model-invocation`, `argument-hint`                | These are workflows you start deliberately, so add **`disable-model-invocation: true`**. They stop auto-firing and stop being preloadable into subagents. Add `argument-hint` (e.g. `[todo path]`, `[scope]`). |
| `land`, `codify`, `regression-triage`, `interaction-feel`, `verify-ui`  | `name`, `description`                                                                                    | `when_to_use`, `paths` (interaction-feel → `client/**`)    | Keep model-invocable; they are built to trigger on situations. Add `paths:` to interaction-feel so it is only offered for client files.                                                                        |
| `spec-review`                                                           | has `argument-hint`, `user-invocable`                                                                    | none                                                       | Already current. Note that `argument-hint` is a hard error outside Claude Code (claude.ai / Skills API); irrelevant unless these skills are shared there.                                                      |
| Skill listing overall                                                   | 11 project skills compete with about 130 plugin skills (superpowers, expo, ui-design, anthropic-skills…) | listing budget (1% of context), `skillListingMaxDescChars` | Check that the project skills aren't being truncated out of the listing. Disable plugin bundles this project never uses (e.g. the video/image `anthropic-skills`, `expo:eas-hosting`, `expo-brownfield`).      |
| `todo-executor`                                                         | no `tools`, no `model` (inherits everything)                                                             | `model`, `effort`, `maxTurns`, `isolation: worktree`       | Consider `isolation: worktree` natively, if it fits the existing `/todo` worktree flow (check before changing). Set `maxTurns` as a runaway backstop.                                                          |
| reviewers (5)                                                           | `tools` read-only, `model: sonnet` (security-auditor inherits)                                           | `omitClaudeMd`, `effort`, `maxTurns`, `skills:`            | `omitClaudeMd` (F1), `maxTurns` backstop. Leave `memory:` off: reviewers should stay stateless, and the corpus is the memory.                                                                                  |
| `todo-researcher`                                                       | `model: sonnet`                                                                                          | `model: haiku`?                                            | It returns a brief; the best-practices page suggests haiku for simple subagents. Worth one A/B.                                                                                                                |

---

## 4. Karpathy lens: what he'd keep and what he'd cut

| He'd keep                               | Why                                                                      | OCRecipes equivalent                   |
| --------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------- |
| Automatic yardsticks                    | "Give it success criteria and watch it go"; autoresearch's single metric | preflight, CI, TDD, review stamp       |
| Small diffs and human oversight         | "small incremental chunks", "like a hawk"                                | One todo, one PR; review pass          |
| Tight write scope                       | "Modify train.py — this is the only file you edit"                       | Worktree contract                      |
| An LLM-compiled wiki with health checks | LLM Knowledge Bases (Apr 2026)                                           | `docs/solutions/` + frontmatter linter |
| Markdown skills over shell installers   | "install .md skills instead of .sh scripts"                              | Skills                                 |

The community "Karpathy guidelines" are already in the harness. The `[DISCIPLINE]` preamble that `inject-patterns.sh` prepends to every edit (think before coding, the reuse ladder, surgical changes, goal-driven; #1474) covers the same four rules. One consequence follows from his Jan 2026 observation that CLAUDE.md-style instructions didn't fix these behaviours for him: the preamble is the kind of thing to ablate (§6) rather than grow.

| He'd cut or question                 | Why                                                 | OCRecipes target                                                                                                                    |
| ------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Large always-loaded prose            | "just the right information for the next step"      | CLAUDE.md, MEMORY.md, reviewer bodies (F1, F4)                                                                                      |
| Prose fixes for behaviour            | "despite… instructions in CLAUDE.md"                | Memory counters (F7)                                                                                                                |
| Process that slows the loop          | Make generate → verify "very, very fast"            | 14 hook processes per Bash call (F3); 2.4 reviewer dispatches per PR (worth checking that domain-reviewer selection is diff-driven) |
| Unattended autonomy on judgment work | Full autonomy only where the yardstick is automatic | /todo auto-merge is already limited to low-priority, guard-safe paths ✅                                                            |

---

## 5. Do not cut

These are backed by every source, including Karpathy:

- Worktree isolation and the worktree contract.
- The outward-CLI guard (OTA incident).
- `git-safety`.
- Branch protection plus CI as the source of truth.
- The preflight pass-stamp.
- Fresh-context, read-only review with one pass per PR (Anthropic: "a fresh reviewer does help, because it hasn't seen your reasoning"; a skeptical separate evaluator beats self-critique).
- TDD.
- spec-review / plan-first for large work.
- `docs/solutions/` as a corpus loaded on demand.
- RTK.

---

## 6. Measurement plan: make each change a keep-or-discard decision

Baseline these once with the existing scratch scripts (`scan.py`, `usage.py` in this session's scratchpad), then re-run after each change over the same window length:

1. **Cache-write tokens per reviewer dispatch, per agent type.** Target: −50% after F1, with no drop in catch-rate (replay the reviews of the last 20 merged PRs and compare findings).
2. **Refused or blocked tool calls per 1,000 tool calls, by source.** Baseline 4.3% errors overall (D). Target: −20% after F2 alone.
3. **Compactions per session and SessionStart bytes per session.** Baseline about 2.5 compactions per session and 3.4 MB of re-injection over 20 days (D).

Add one quality signal: **review findings per PR that the owner accepted as real**. Without it, cutting prompt weight can't be told apart from cutting quality. This is Karpathy's autoresearch shape: one metric, commit or reset.

---

## 7. Proposed sequence (todos to file only if you approve; none filed)

| #   | Change                                                                                                                                                                         | Size   | Risk                | Ruling interaction                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------- | ---------------------------------------------------------------- |
| 1   | Baseline the §6 metrics (save scripts under `scripts/harness-metrics/`)                                                                                                        | S      | none                | none                                                             |
| 2   | Global RTK hook: skip the rewrite inside worktrees (F2)                                                                                                                        | S      | low                 | user-level config, owner applies                                 |
| 3   | `inject-patterns.sh` fails open on internal error (F3)                                                                                                                         | S      | low                 | hook change, reduces blocking; not CI time                       |
| 4   | Restructure code-reviewer: core + pointers + separate harness-reviewer; add a per-agent byte-cap ratchet (F1)                                                                  | M      | medium; replay test | allowed (no CI time increase)                                    |
| 5   | Same treatment for todo-executor, mobile-reviewer, security-auditor, ai-reviewer, server-reviewer                                                                              | M      | medium              | same                                                             |
| 6   | Split todo/ and audit/ SKILL.md into spine + reference files; compaction-survival test (F6)                                                                                    | M      | low                 | none                                                             |
| 7   | CLAUDE.md to ~8 KB; MEMORY.md prune + 🛑 diet; `/doctor prompt-audit` pass (F4, F9)                                                                                            | S–M    | low                 | memory rules allow pruning                                       |
| 8   | Hook classification sign-off → `if:` filters on verify hooks; remove preference hooks (F3)                                                                                     | S      | low–medium          | **needs owner decision** on drift-detect / nudge / recent-issues |
| 9   | Retire memory counters into mechanisms (F7)                                                                                                                                    | S each | low                 | none                                                             |
| 10  | Trial `sandbox.enabled` + `blockWritesOutsideWorkingDirectories` (F10)                                                                                                         | S      | medium              | needs owner decision                                             |
| 11  | Pilot `.claude/rules/` with `paths:` for one domain (F5)                                                                                                                       | M      | low                 | Copilot builder and domain-map re-point                          |
| 12  | Frontmatter pass: `disable-model-invocation` on the 5 manual workflows, `argument-hint`, `paths:` on interaction-feel, `maxTurns` backstops; prune unused plugin bundles (F11) | S      | low                 | none                                                             |

Steps 1–3 are independent and low-risk. Step 4 is where most of the token cost comes back. Re-measure after 4 before deciding on 5.

---

## Appendix A: how the numbers were measured

**(R), reproduced in this session:**

- Sizes: `wc -c` / `wc -l` on agents, skills, CLAUDE.md, MEMORY.md.
- Hook registrations: parsed from `.claude/settings.json` (42 registrations, 24 distinct scripts).
- July/August commit split: `/usr/bin/git log --no-merges` with harness paths vs `client server shared`.
- 84 memory files with uppercase SHIPPED/RESOLVED/MERGED/DONE (150 with a loose case-insensitive match).
- 42 🛑 lines in MEMORY.md.
- Worktree-refusal text occurrences in transcripts (~1,180).
- MEMORY.md present in 15/15 sampled code-reviewer transcripts.
- The best-practices quotes (fetched and grepped).
- The hook `if:` semantics and the memory-doc limits (fetched).

**(D), delegated and not reproduced:**

- Token and cache totals.
- Dispatch counts.
- Refusal counts by hook.
- inject-patterns failure count.
- Agent growth snapshots.
- Skill usage counts.
- Compaction counts.
- Hook-test line counts.

The transcript window is 20 days. Treat any "never used" claim as limited to that window.

## Appendix B: key sources

- Claude Code best practices: https://code.claude.com/docs/en/best-practices
- Memory: https://code.claude.com/docs/en/memory
- Hooks: https://code.claude.com/docs/en/hooks
- Skills: https://code.claude.com/docs/en/skills
- Subagents: https://code.claude.com/docs/en/sub-agents
- Effective context engineering (2025-09-29): https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Harness design for long-running apps (2026-03-24): https://www.anthropic.com/engineering/harness-design-long-running-apps
- April 2026 postmortem: https://www.anthropic.com/engineering/april-23-postmortem
- Karpathy:
  - context engineering: https://x.com/karpathy/status/1937902205765607626
  - Jan 2026 agent-coding notes: https://x.com/karpathy/status/2015883857489522876
  - agentic engineering: https://x.com/karpathy/status/2019137879310836075
  - autoresearch: https://github.com/karpathy/autoresearch
  - YC talk: https://www.youtube.com/watch?v=LCEmiRjPEtQ
  - year in review: https://karpathy.bearblog.dev/year-in-review-2025/
- Boris Cherny workflow: https://infoq.com/news/2026/01/claude-code-creator-workflow/
- HumanLayer:
  - https://www.humanlayer.dev/blog/writing-a-good-claude-md
  - https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md
- Mitchell Hashimoto: https://mitchellh.com/writing/my-ai-adoption-journey
- Armin Ronacher:
  - https://lucumr.pocoo.org/2025/7/30/things-that-didnt-work/
  - https://lucumr.pocoo.org/2026/1/31/pi/
- Geoffrey Huntley: https://ghuntley.com/ralph/
- Simon Willison: https://simonwillison.net/2025/Sep/30/designing-agentic-loops/
- Peter Steinberger: https://steipete.me/posts/just-talk-to-it
- Research:
  - IFScale arXiv 2507.11538
  - Chroma Context Rot https://www.trychroma.com/research/context-rot
  - ETH AGENTS.md arXiv 2602.11988
  - Lulla arXiv 2601.20404
  - McMillan arXiv 2605.10039
