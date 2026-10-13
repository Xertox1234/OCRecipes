# Merge review gate — design (rev 2)

**Status:** design, not approved for implementation
**Date:** 2026-09-08 · **rev 2** after review (12 findings, verdict _revise_)
**Origin:** `todos/archive/P3-2026-08-16-agent-restriction-session-line-is-a-misconfiguration.md` (merged as #938).

> **Location.** `docs/superpowers/` is gitignored (`.gitignore:100`) — this file is local-only and cannot be committed. `todos/` is the nearest tracked home if it should be.

---

## 1. Problem, and whether this design addresses it

An agent is supposed to dispatch code reviewers before merging. It can silently skip that. Three occurrences: 2026-08-05, 2026-08-15, 2026-09-03. Text mitigation has already failed **while loaded** — on 2026-08-15 the memory carrying the override was in context and the restriction was applied anyway.

The failure has a measured shape: arXiv 2607.07405 finds **78% of agent policy failures are "silent wrong-state failures"** — the agent reasons about the policy and violates it anyway, no error raised.

### 1.1 Does the classifier gate the incidents that motivated it?

Measured 2026-09-08 by running the PATH GATE's own `SAFE_ALLOWLIST` / `SENSITIVE_OVERRIDE` constants (sourced from the script, not retyped) against each PR's real file list.

| PR   | Branch                                | Stage 1                                       | Stage 2 verdict                                         | Gated?  |
| ---- | ------------------------------------- | --------------------------------------------- | ------------------------------------------------------- | ------- |
| #819 | `fix/effective-per100g-null-basis`    | not `todo/*`                                  | HOLD — `useNutritionLookup.ts` + its test are sensitive | **YES** |
| #820 | `docs/codify-null-guard-placement`    | not `todo/*`                                  | OK — one `docs/solutions/*.md` file                     | **no**  |
| #821 | `todo/saved-item-gram-basis-decision` | `todo/*`, full guard **HOLDs** → no exemption | HOLD — `useNutritionLookup.ts` sensitive                | **YES** |
| #823 | `docs/codify-premise-refresh`         | not `todo/*`                                  | HOLD — `useNutritionLookup.ts` sensitive                | **YES** |

**3 of 4 gated.** The miss (#820) is a documentation-only solution codification with no product code. Every incident PR that touched product logic is gated.

#821 also demonstrates stage 1 does not shortcut: a `todo/*` branch whose paths are sensitive still falls through to stage 2.

**Not checkable:** the 2026-08-05 incident records "two open PRs" with no numbers; they cannot be identified. The 2026-09-03 occurrence was loss-free (reviews were dispatched), so it is not a coverage miss — the gate would have been redundant there.

---

## 2. What the research changed

Three premises this design originally rested on were wrong.

### 2.1 "Hooks can only deny, never compel" — FALSE

Claude Code exposes 33 hook events. `Stop` and `TaskCompleted` fire on completion and can block (`decision:"continue"` / `decision:"deny"`).

**Precision (rev 2):** `SubagentStop` is _not_ in that category. Its documented exit-2 semantics are "show stderr to subagent and continue having it run" — it **re-prompts the subagent; it does not block an action.** Harmless here, because this design's `SubagentStop` hook only writes a file.

**`Stop` is turn-end, not task-end**, and does not fire on user interrupt. If the merge already happened this turn, `Stop` fires after the irreversible act. `PreToolUse` on the merge call remains the only preventer.

### 2.2 "A locally written stamp is adequate evidence" — FALSE

A stamp the agent writes about its own work is **SLSA Build L1** — the spec calls it _"trivial to bypass or forge."_

The trap is recursive: _if a hook writes the stamp because the agent told it a review happened, the trust boundary moved and the vulnerability is intact._ RFC 9334 §12.1.1 requires the Attesting Environment to be isolated from the Target so the Target "cannot forge Evidence about itself," collecting claims by **taking measurements**.

The escape needs a second _domain_, not a second organisation — RFC 9334 allows the isolating environment to be "a process," both co-located. A `SubagentStop` hook is invoked by the harness, receives the reviewer's own output, and the agent cannot invoke or suppress it.

**Two limits discovered in review — both in §6.2, and the second is the larger one.** (1) The hook has no trustworthy cwd, so it cannot _measure_ repository state; it can only bind what the reviewer asserted. (2) The isolation above is of the **writer**, not of the **record**: the agent cannot invoke or suppress the hook, but the file the hook produces is unprotected on disk, so the RFC 9334 "cannot forge Evidence about itself" property is **not** achieved. Read §6.2 before quoting this section's framing.

### 2.3 "A path allowlist is the right primary classifier" — WEAKENED

Meta's RADAR (arXiv 2605.30208; 535K+ diffs reviewed, 331K+ landed) classifies _"each diff by **authorship and source type**, applies eligibility gates, static heuristics, a machine-learned Diff Risk Score…"_ Its exemption is scoped to _"changes from automated sources."_ **Path allowlisting is nowhere in its primary funnel.**

Path lists fail silently toward _less_ review. Git: _"It is not possible to re-include a file if a parent directory of that file is excluded."_ No numeric drift evidence exists in the literature; the one concrete observed instance is this repo's `test-*.sh` glob, which matched nothing for months while reporting green.

---

## 3. Decisions

| #   | Decision                                                          | Rationale                                           |
| --- | ----------------------------------------------------------------- | --------------------------------------------------- |
| D1  | Gate at `PreToolUse` on the merge call                            | Only event that prevents rather than detects (§2.1) |
| D2  | Trigger: source type first, path gate second                      | RADAR's funnel order (§2.3)                         |
| D3  | Evidence written by a `SubagentStop` hook, never by the agent     | Removes forgery (§2.2)                              |
| D4  | Stamp fields are **asserted-and-bound**, not measured             | The writer has no trustworthy cwd (§6.2)            |
| D5  | Reuse the PATH GATE via `--paths-only`                            | Avoids a second allowlist that would drift          |
| D6  | Stamp is a **directory keyed by head SHA**, one file per reviewer | Survives parallel dispatch (§6.3)                   |

---

## 4. Architecture

**New**

| File                                        | Role                                                                                                                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/hooks/review-stamp-writer.sh`      | `SubagentStop` hook, registered with an `agent_type` matcher limited to roster reviewers. Reads **`last_assistant_message`** (primary) or **`agent_transcript_path`** (fallback) and writes one stamp file. |
| `.claude/hooks/merge-review-guard.sh`       | `PreToolUse` hook on the merge call.                                                                                                                                                                        |
| `.claude/hooks/lib/review-stamp-path.sh`    | Single source of truth for the stamp directory, sourced by writer and reader.                                                                                                                               |
| `.claude/hooks/test-merge-review-guard.sh`  | Self-test.                                                                                                                                                                                                  |
| `.claude/hooks/test-review-stamp-writer.sh` | Self-test.                                                                                                                                                                                                  |

**Edited**

| File                                             | Change                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/todo-automerge-guard.sh`                | Add `--paths-only`: run PATH GATE (lines 252-295), skip TODO GATE (lines 191-250). Default behaviour byte-identical.                                                                                                                                                                                                                                                                                                           |
| `scripts/__tests__/todo-automerge-guard.test.ts` | Cover the flag; assert default still HOLDs a no-todo PR.                                                                                                                                                                                                                                                                                                                                                                       |
| **`docs/AI_WORKFLOW.md:49`**                     | **Extend the reviewer output contract.** Today it mandates `[CRITICAL] file:line — description` … `No findings` — which carries severity and file but **no SHA and no file-list digest**. The reviewer prompt must additionally require echoing the `git -C "$WORKTREE" rev-parse HEAD` it already runs (`:44` mandates the tree check) and the changed-file list it was given. Without this the stamp has nothing to bind on. |
| `.claude/settings.json`                          | Register both hooks. **Must use the absolute `$CLAUDE_PROJECT_DIR` form** — enforced by `.claude/hooks/test-settings-hook-paths.sh`.                                                                                                                                                                                                                                                                                           |

### Why `--paths-only` is required

`todo-automerge-guard.sh:199` HOLDs any PR with no `todos/archive/*.md` in the diff. Inverting the guard wholesale would demand evidence for nearly every ordinary code PR. Its TODO GATE answers _"is this a low-priority todo eligible for unattended batch-merge?"_ — a different question. Only the PATH GATE answers ours.

---

## 5. Decision flow

```
PreToolUse fires (matchers: Bash, mcp__github__merge_pull_request)
│
├─ 0. FAST-PATH EXIT — mandatory, this hook sees EVERY Bash call
│     Bash: raw-text filter '*gh*pr*merge*' via lib/fastpath-filter.sh
│           → no match: exit 0 before any fork or network
│     Precedent: pr-preflight-guard.sh lines 40-50
│
├─ SKIP_MERGE_REVIEW=1 read from the HOOK PROCESS ENVIRONMENT ONLY ....... exit 0
│     NEVER parsed out of .tool_input.command — otherwise the agent
│     self-authorizes by prefixing the env var. Precedent: pr-preflight-guard.sh:12
│
├─ resolve the merge command and PR ref
│     MCP path : .tool_input.pullNumber
│     Bash path: cmd_gh_pr_write_subcommand()  (lib/cmd-detect.sh:1830)
│                cmd_gh_pr_ref()               (lib/cmd-detect.sh:2007)
│     DO NOT re-derive positional extraction. cmd_gh_pr_ref's header documents three
│     construction-proven CRITICAL fixes (2026-09-02) for nested substitution, embedded
│     quotes and backslash escapes — `gh pr merge 4$(echo 9)2` resolves to 492, where
│     naive cmd_words-style extraction returned 42.
│     lib unsourceable, or ref unresolvable ............................. DENY (fail-closed)
│
├─ STAGE 1 — source type
│     head branch matches `todo/*` AND full guard (both gates) exits 0 ... ALLOW ungated
│     otherwise ........................................................ stage 2
│
├─ STAGE 2 — content risk
│     todo-automerge-guard.sh --paths-only <pr>
│       exit 0  paths safe .............................................. ALLOW, no stamp
│       exit 1  HOLD ..................................................... require stamp
│       exit 2  tooling error (gh rate-limit / network) ................. require stamp (fail-closed)
│
└─ STAGE 3 — stamp check   (directory for the PR's head SHA)
      no stamp file present ............................................. DENY
      reviewed_files_digest ≠ digest of the PR's changed-file list ....... DENY
      any stamp is not verdict `clean` with an EMPTY `unresolved` ....... DENY
      else .............................................................. ALLOW
```

**Which Bash form actually reaches here.** `guard-outward-cli.sh` (lines 111-120) already DENIES bare `gh pr merge` and ALLOWs `gh pr merge --auto`. So the surviving Bash form is the `--auto` arming call — the hardest case, and exactly why the shared detection library is mandatory rather than optional.

### Stage 1's signal

`.claude/agents/todo-executor.md:474`: _"The branch name MUST be exactly `todo/<todo filename minus .md>`"_ — already load-bearing for the executor's batch-merge skip and collision triage.

The name alone is insufficient (anyone can name a branch `todo/x`), so stage 1 also requires the full guard to pass: **the name selects the policy, the guard enforces it.** Verified by #821 (§1.1), where a `todo/*` branch with sensitive paths correctly failed to exempt.

Counter-example confirming the classifier: PR #938 was an interactive-session PR that _did_ contain `todos/archive/*.md`, but its branch was `chore/close-agent-restriction-todo`. A naive "contains a todo file" test misclassifies it; the branch test does not.

---

## 6. The stamp

### 6.1 Content

```json
{
  "head_sha":              "<sha the reviewer reported via rev-parse HEAD>",
  "reviewed_files_digest": "<digest of the sorted changed-file list given to the reviewer>",
  "agent_type":            "code-reviewer",
  "verdict":               "clean" | "findings",
  "unresolved":            [{ "severity": "CRITICAL", "file": "…:…", "description": "…" }],
  "written_by":            "review-stamp-writer.sh",
  "written_at":            "<iso8601>"
}
```

`pr` is **dropped** (rev 2). Review frequently predates the PR, nothing supplies the number, and no stage read it. A field no stage reads is decorative.

### 6.2 Asserted-and-bound, not measured — the correction that matters

`docs/AI_WORKFLOW.md:40` (_"Working-tree safety — critical, do not skip"_): a dispatched reviewer **does not inherit the orchestrator's worktree cwd**; its git commands hit the main checkout unless given `git -C "$WORKTREE"`. **The `SubagentStop` hook fires in that same ambient context.**

So a writer that ran `git rev-parse HEAD` itself would read the _main checkout's_ HEAD — plausible-looking and silently wrong. That is precisely the failure AI_WORKFLOW's section exists to prevent (reviewer sees an empty diff, returns "No findings", gate passes unreviewed code).

**Consequence:** `head_sha` and `reviewed_files_digest` can only come from the reviewer's own output. They are **asserted by the reviewer and bound by the gate's comparison** — not measured. The gate's comparison still does real work: it makes a _stale_ or _mis-scoped_ review detectable. It does not make a _fabricated_ one detectable.

**Honest tier (rev 3 — corrected against the implementation).** Rev 2 said "forgery-by-the-orchestrator is removed, because the orchestrator neither writes nor invokes the writer." **That is false as implemented.** Not invoking the writer is not the same as being unable to produce its output. The record is an unprotected JSON file at a path derivable in one command (`.claude/hooks/lib/review-stamp-path.sh` prints it; the live directory for this repo exists on disk), and nothing guards that directory — `grep -rln 'review-stamps\|review_stamp' .claude/hooks/ scripts/` returns only this feature's own files. Every ALLOW in the implementation review's probe was satisfied by a record written with `cat >`.

State the tier plainly instead:

- **The gate converts silent _omission_ into a visible DENY.** A review never dispatched, dispatched against an earlier commit, or given a different file set now blocks the merge with a message naming which of the three it was. That is the PR #626 incident this was built for, and it is real.
- **The gate does not resist a _deliberate_ orchestrator.** An agent that decides to fabricate a record can, in one shell redirection. Nothing here raises that cost.

**No guard on the record directory is proposed.** A path check is one `node -e` away from bypass — a residual class this repo already documents — so it would buy a claim rather than a property, and an accurate sentence is worth more than a mitigation with a known hole. This is **weaker than SLSA L2**: the control plane transports the evidence, does not generate its substantive fields, and does not protect them at rest. Calling it "L2-shaped" in rev 1 was an overclaim; rev 2's forgery claim was a second, larger one.

### 6.3 Path and keying

Rev 1 mirrored `preflight-stamp-path.sh`, which is keyed to the repo only. That collapses here:

- `docs/AI_WORKFLOW.md:21` dispatches `code-reviewer` **plus 1-2 domain reviewers in parallel**. Two or three `SubagentStop`s fire near-simultaneously; one path means last-writer-wins, and the plural `reviewers` array of rev 1 is not producible without a racy read-modify-write.
- `/todo` runs up to 4 concurrent executors, each with its own reviewers, sharing one repo key. Stage 1 exempts `todo/*` PRs from _reading_ the stamp, but the writer still fires — so a background executor's reviewers clobber an interactive session's freshly-earned stamp. Fail-closed then means DENY → re-dispatch → clobber again.

The preflight stamp tolerates last-writer-wins because re-earning it is one `npm run preflight`. Here re-earning it is a full reviewer dispatch.

**Design:** a directory, one file per reviewer, no shared mutable file.

```
/tmp/ocrecipes-review-stamps-<repokey>/<head_sha>/<agent_type>.json
```

`<repokey>` from `git rev-parse --git-common-dir` canonicalised and hashed, exactly as `preflight-stamp-path.sh` does — cwd-invariant across worktrees, per-repo isolated, env-overridable so tests never touch a real stamp. Linked worktrees share `--git-common-dir`, so an executor's reviewers land under the same repo key; the **`<head_sha>` segment** is what keeps them from colliding.

Each writer creates its own file. No read-modify-write, so no race.

**Gate aggregation:** require **≥1** stamp file under the PR's head SHA whose digest matches, and DENY if _any_ of them is not `verdict: clean` with an **empty** `unresolved` list. There is no "warnings are tolerated" tier: `unresolved` holds every line that triggered the findings verdict (bracketed, agent-definition-shaped, or prose), and a review whose findings were all WARNING/SUGGESTION writes **no record at all**, so it denies as "no record" rather than passing.

**Acknowledged weakness:** ≥1 is weaker than requiring the roster `AI_WORKFLOW.md:21` mandates. The gate cannot know which domain reviewers a given diff warranted — that judgement is content-based and lives in the orchestrator. Requiring the full roster is a possible tightening, deferred rather than assumed.

### 6.4 Review timing

The stamp binds `head_sha`, so **the review must run against the final commit.** The repo's only codified ordering is `todo-executor.md` Step 6 review → Step 7 address feedback → Step 8 commit — i.e. reviewed state is _pre-commit_. That path is stage-1 exempt so the stamp is never read there, but the interactive path this gate targets inherits the same habit.

**Cost, stated plainly:** any fix made in response to findings invalidates the stamp and forces a re-dispatch against the new HEAD. That is a real workflow cost, not a check that always fails.

---

## 7. Guarantees

**Provides — within the gated set only**

- For a PR that reaches stage 3, a merge cannot proceed without a stamp bound to that exact head SHA and file scope. The orchestrating agent cannot **invoke** or **suppress** the writer — but it **can write the file itself** (§6.2), so this is a guarantee about **omission**, not about **intent**: a review that was skipped, stale, or mis-scoped is caught; one that was deliberately fabricated is not.
- Stale reviews are caught: a stamp for an earlier SHA does not satisfy a later one.
- Mis-scoped reviews are caught: `reviewed_files_digest` binds _which_ files were reviewed, which `head_sha` alone does not.
- Merging over a review that is not **literally clean** is blocked. Stage 3 requires the matching record to read `verdict: clean` AND carry an empty `unresolved` — both, because `.unresolved` absent gives `length` 0 and a truncated record would otherwise read as clean. A WARNING-only review writes no record at all, so it denies as "no record". Pinned in `.claude/hooks/test-merge-review-guard.sh` from both directions: _verdict=findings with empty unresolved denies_ and _verdict=clean with a non-empty unresolved denies_.

**Carve-outs — both of them, with the denominator**

1. `SKIP_MERGE_REVIEW=1` (§5) bypasses everything.
2. Stage 1 and stage 2 exempt PRs before any stamp is required.

Measured 2026-09-08 over the last 50 commits on `main`, using the PATH GATE's own constants: **32 GATED / 18 ALLOWED / 50 — 64% coverage.** The ungated 36% is not all trivia; it includes substantive product work — `9eb1c6ab` (grocery-list and receipt-meal-plan device-local date basis), `2f2acd2c` (coach "Add to Plan"), `9a6d1034` (coach plan-slot in-flight-mutation fix), `3bd43677` (notebook extractor date anchor).

Naming one residual and not the other is a documented failure mode in this repo; both are named.

**Does not provide**

- **Sincerity — and stage 3 actively pressures against it.** The agent chooses both the reviewer and its prompt. Stage 3 requires a literally-clean record — `verdict: clean` with an empty `unresolved` — so the only path past a `[CRITICAL]`, or past a WARNING (which writes no record), is a review that reports neither. That is a _consequence of stage 3_, not a generic caveat: the gate creates positive pressure toward dispatching a compliant reviewer.
- **Protection against a fabricated record** — not merely against fabricated field values. The record file itself is unprotected on disk at a derivable path, and no guard watches that directory (§6.2). The gate raises the cost of _forgetting_ to review; it raises no cost on _choosing_ not to.
- **Protection against user interrupts** — `Stop`-class hooks do not fire on them.
- **Task-level enforcement** — `Stop` is turn-end.

---

## 8. Merge-path coverage

| Path                              | Handling                                                     |
| --------------------------------- | ------------------------------------------------------------ |
| `mcp__github__merge_pull_request` | Covered — new matcher                                        |
| `gh pr merge` (bare)              | Already DENIED by `guard-outward-cli.sh`; unchanged          |
| `gh pr merge --auto`              | Hook fires at **arm** time; GitHub merges later, server-side |

**Corrected justification (rev 2).** Rev 1 claimed the `--auto` row was safe "by construction, because auto-merge is only ever armed for PRs the guard classifies eligible." That invariant is **executor convention** — the layer §1 establishes is not the enforcement layer. `guard-outward-cli.sh` ALLOWs `gh pr merge --auto` generally (only `--admin` / `--repo` deny), so an interactive agent can arm auto-merge on a risky PR.

The path **is** covered — but by stages 2-3 running at arm time, not by construction. A future reader who changes stage 1 must not inherit a belief in an invariant that was never enforced.

**Genuine residual:** a PR armed for auto-merge, then pushed to with risky files, carries a stale arm-time verdict. Narrow — the executor never force-pushes and CI re-runs — but real.

---

## 9. Testing

**The test filename is load-bearing.** `scripts/run-hook-tests.sh:24` discovers via `for t in .claude/hooks/test-*.sh`; line 32 errors only if the glob matches _nothing_. A file named anything else is silently never executed — how this repo's outward-CLI corpus went unrun for months while reporting green.

**Verify by mutation, not by green.** Break each hook deliberately and confirm the suite goes red, quoting the before/after result lines.

Cases:

- **Fast-path:** an unrelated Bash command forks nothing and makes no network call
- **Detection:** `gh pr merge 4$(echo 9)2` resolves to 492; `cmd-detect.sh` unsourceable → DENY
- **Self-authorization:** `SKIP_MERGE_REVIEW=1 gh pr merge …` inside `.tool_input.command` must **not** bypass
- **Stage 1:** `todo/*` + guard-pass → ALLOW; `todo/*` + guard-HOLD → must NOT shortcut (the #821 shape); non-`todo/*` carrying `todos/archive/` (the #938 shape)
- **Stage 2:** guard exits 0 / 1 / 2
- **Stage 3:** no stamp; wrong SHA directory; mismatched `reviewed_files_digest`; unresolved findings; clean; **two reviewers' stamps coexisting under one SHA** (§6.3)
- **Writer:** empty/unparseable reviewer output refuses to write; non-reviewer `agent_type` produces no stamp
- **Regression:** the four §1.1 incident file-lists produce the recorded verdicts
- **TS:** `--paths-only` skips the TODO GATE; default still HOLDs a no-todo PR
- **Settings:** `test-settings-hook-paths.sh` passes with both new registrations

**Audit gate precision.** arXiv 2607.07405 reports one deployed gate at 100% precision over 161 fires and another at 5% — _"gate precision must itself be audited."_ Log every fire with its verdict and review the distribution.

---

## 10. Risks

- **`.claude/hooks/**`feeds`Outward-CLI guard corpus`, a required check on `main`.\*\* A careless edit wedges every PR. Mutation-verify before pushing.
- **Stage 2 exit 2 has a painful recovery.** A `gh` rate-limit or network blip → require stamp → DENY. The only bypass is `SKIP_MERGE_REVIEW=1` in the **launch environment**, which means **restarting the session**, because the MCP merge path has no per-command escape. This is the most likely source of real friction.
- **This is a tenth gate.** The documented failure mode of a stuck required check is a PR landable only by manually bypassing branch protection.
- **`--paths-only` edits a security-relevant 295-line classifier** whose comments encode hard-won history. Byte-identical default behaviour is the mitigation; the TS test must assert it.
- **The allowlist will rot** toward less review (§2.3). Stage 2 is a narrowing, not a guarantee.
- **64% coverage** (§7) — this design does not gate a third of merges, by intent.

---

## 11. Open items

1. ~~Does `SubagentStop` identify which agent type stopped?~~ **RESOLVED.** `SubagentStop` declares `matcherMetadata: { fieldToMatch: "agent_type" }` in 2.1.266, so the writer registers with an `agent_type` matcher. (`values: []` is the settings-UI completion list, not a matching constraint — compare `PreCompact`'s `values: ["manual","auto"]`; agent types are open-ended.) The SubagentStop-specific payload adds `agent_id`, `agent_transcript_path`, `agent_type`, `last_assistant_message`, `background_tasks`, `stop_hook_active` on top of the base fields.
2. **Whether `last_assistant_message` alone suffices.** Its describe string — _"Avoids the need to read and parse the transcript file"_ — is written for exactly this use, but a reviewer whose final message is truncated or reformatted would need the transcript fallback. Decide at implementation; both are in the payload.
3. **Unverified research claims**, flagged rather than relied upon: GitHub ships path-scoped required review (reportedly teams-only); Copilot can count as an approver (opt-in). Neither is load-bearing.
4. **Should stage 3 require the full roster** rather than ≥1 stamp (§6.3)? Deferred.

---

## 12. References

- Claude Code hooks — https://code.claude.com/docs/en/hooks
- SLSA requirements / levels / threats — https://slsa.dev/spec/v1.0/requirements
- RFC 9334 (RATS), §3.1, §7.4, §12.1.1 — https://www.rfc-editor.org/rfc/rfc9334.html
- in-toto v1.0 specification — https://github.com/in-toto/specification/blob/v1.0/in-toto-spec.md
- RADAR (Meta, 2026) — https://arxiv.org/abs/2605.30208
- Deterministic pre-execution gates — https://arxiv.org/abs/2607.07405
- τ-bench — https://arxiv.org/abs/2406.12045
- OWASP AISVS Appendix C — https://github.com/OWASP/AISVS/blob/main/1.0/en/0x92-Appendix-C_AI_for_Code_Generation.md
- Local research notes — `scratchpad/self-attestation-prior-art.md`
