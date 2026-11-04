# Addendum: what Claude Code mods add to the fix list (2026-10-30)

Mods were added at the owner's request after the review and diagnosis. They are a new Claude Code feature: terminal v2.1.287+, this machine runs 2.1.314. This note says what mods can do that settings hooks, skills and scripts couldn't, and where that changes how an item on the [diagnosis §6 list](2026-10-30-diagnosis.md#6-re-ranked-working-list) should be built.

Sources:

- Docs: [overview](https://code.claude.com/docs/en/plugins/mods/overview), [events](https://code.claude.com/docs/en/plugins/mods/events), [reference](https://code.claude.com/docs/en/plugins/mods/reference), fetched 2026-10-30.
- The `plugin-authoring` skill's type file for build 2.1.314.

## 1. What a mod is, in one paragraph

A mod is a plugin whose `hooks/register.ts` registers JavaScript/TypeScript functions on events: `tool.call`, `tool.check`, `agent.spawn`, `prompt.submit`, `skill.prompt`, `session.compact`, `turn.complete`, `ui.render` and about 40 more, including every settings-hook event as `classic.<Event>`. Each function is middleware, `($, e, next)`. It can **observe** (return `next(e)`), **rewrite** (`next({ ...e, … })`) or **answer** (return without calling `next`, e.g. `{ deny }`).

**What it can reach.** A mod reaches the outside world only through the `$` API: `$.ui` (panes, a band above the prompt, toasts, status, a question dialog), `$.process`, `$.fs`, `$.http`, `$.model`, `$.store` (shared across sessions), `$.clock` (timers), `$.session` (usage, compact, messages) and `$.prompt.submit`.

**Where it runs.** It runs **inside the Claude Code process**, so there is no shell spawned per event.

**Tooling:**

- `claude plugin validate` lists every event a mod handles and every call it makes.
- `claude plugin test` runs event-firing tests with no session or network.

## 2. How a mod differs from our settings hooks

|                                     | Settings hook (what the harness uses now)                                                                     | Mod                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process                             | A new bash process per matching hook per call. Each Bash call starts at least 14 today.                       | A function call inside Claude Code                                                                                                                                  |
| Subagent tool calls                 | PreToolUse sees them                                                                                          | `tool.call` sees them ("including calls a subagent makes"); `tool.check` carries `e.agentId`                                                                        |
| Subagent results                    | SubagentStop plus reading `agent_transcript_path`, the source of the 2.1.308+ race                            | `turn.complete` fires for a subagent's turn with `e.agentId` and `e.answer`. A `tool.call` hook on the hand-back tool sees its input before it runs (to verify, §4) |
| Rewrite a dispatch                  | Not practical                                                                                                 | `tool.call` on `Agent` can rewrite or deny the dispatch arguments. `agent.spawn` can pick the model or deny                                                         |
| Draw in the interface               | No                                                                                                            | Pane, band above the prompt, toast, status line, spinner suffix                                                                                                     |
| Act after compaction / start a turn | No                                                                                                            | `session.compact` (observe or skip). `$.prompt.submit` can start a turn; `$.session.compact` can request a compaction                                               |
| Failure default                     | Configurable per hook (`onFailure: "block"` is v2.1.295+)                                                     | **Fails open.** A throw or timeout skips the hook. A `.catch` handler is needed to fail closed                                                                      |
| Time limit                          | Per-hook `timeout`, 600 s default                                                                             | 10 s of the hook's own work (waiting inside `next`/API calls doesn't count); 1 s for `.catch`                                                                       |
| Order                               | Project PreToolUse hooks run _after_ every mod's `tool.call` has called `next`. Managed hooks run before mods | Mods are outermost: a mod that answers without `next` stops the settings hooks from running                                                                         |
| Tests                               | 23k lines of bash hook tests                                                                                  | `claude plugin test`: fires events, stubs answers, presses buttons                                                                                                  |
| Trust                               | Runs as the user                                                                                              | Also runs as the user, **unsandboxed**: it can approve calls, read secrets and spend model usage                                                                    |
| Reach                               | Every session loading the project's `.claude/settings.json`                                                   | Sessions that load the plugin: CLI, Desktop, VS Code, `-p`; cloud sessions only if the plugin carries over                                                          |

Where managed settings or a Team/Enterprise login apply, the built-in `sec-default` guard skips `classic.*` hooks in user-installed mods. Which applies on this machine is to be checked before relying on `classic.*`.

## 3. Where mods change an item on the list

**Strong fit: a mod is the better way to build it.**

| List item (diagnosis §6)                                                        | What a mod adds                                                                                                                                                                                                       | Why it beats the current mechanism                                                                                                                                |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rank 3, N4 dispatch helper                                                      | A `tool.call` hook on `Agent`: when `subagent_type` is a reviewer, check that the prompt carries the verbatim contract (or fill it from `docs/AI_WORKFLOW.md`), and deny a review set that leaves out `code-reviewer` | Enforced at the moment of dispatch, not by asking the agent to copy a 7 KB prompt correctly. Covers `/todo`, `/todo-fast`, audits and ad-hoc reviews in one place |
| Rank 9, N5 visible nightly E2E red                                              | A band above the prompt, fed by `$.process.run(['gh','run','list',…])` at `session.start` and every N minutes, saying "Nightly E2E red for 3 nights: #<run>"                                                          | No hook can draw; a SessionStart line scrolls away. The band stays until it's fixed                                                                               |
| Item 1, metrics                                                                 | `turn.step` gives token usage per request with `e.agentId`; `tool.call` results give refusals per tool; `$.store` keeps running totals across sessions                                                                | The baseline collects itself, live, without re-mining 3.6 GB of transcripts                                                                                       |
| **New, N9:** the owner's "please continue" (35 messages) and "compact now" (85) | After a `/todo-fast` follow-up: `$.session.compact()` then `$.prompt.submit({ text: 'continue' })`. Or a band button "Compact and continue"                                                                           | Removes a mandatory owner step the diagnosis found. **Needs the owner's yes**, because it changes how runs proceed unattended                                     |

**Useful, as hardening or visibility.**

| Item                                                 | Mod option                                                                                                                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stamp writer (now 0/12 misses after the polling fix) | Write the review record synchronously from a `tool.call` hook on the hand-back tool (or `turn.complete` with `agentId`) instead of polling the transcript. **Only if a race reappears**; the current fix works                 |
| Rank 11, N8 guard exemptions visible                 | `$.ui.log`/toast when a PR is exempted by the allowlist (the #1535 misdiagnosis)                                                                                                                                               |
| Owner GitHub chores ("why am I doing github stuff?") | A pane per open PR: review record present at head? CI green on head? Merge button through `$.process`. Visibility first; merging stays behind the existing gates                                                               |
| Rank 7, memory → mechanisms                          | The zsh glob errors (148): a `tool.call` hook on Bash that catches an unquoted glob and answers with a corrected-command instruction. Same idea for "check the API IP first" (a band when `EXPO_PUBLIC_DOMAIN` doesn't answer) |

**Not a fit, or not now.**

- **Porting the 24 bash guards into a mod.** The guards are frozen except for changes that don't add CI time, they carry 23k lines of tests, and mods fail open by default. Spawn overhead alone doesn't justify the risk. New logic can be a mod; existing guards stay.
- **Rank 0, the `$0`/`$1` hazard.** Fix the root cause (move `wt_in_use` into a script). A `skill.prompt` safety net is unnecessary.
- **Rank 5, inject-patterns.** Settings PreToolUse `additionalContext` is still the mechanism for adding context per edit; fix its stdout leak.

## 4. Open questions to settle in each item's spec

1. Does a `tool.call` hook see the hand-back tool's input for a background reviewer, and does `turn.complete`'s `e.answer` carry the hand-back report or only the wrapper line? Settle it with one `claude plugin test` plus one real dispatch before the stamp writer relies on either.
2. Does the `sec-default` guard load on this machine, i.e. is there a managed settings file or a Team/Enterprise login? It decides whether `classic.*` hooks in a project mod run.
3. Where the mod lives: a project plugin in the repo (shared, reviewed like code, reaches cloud sessions if configured) or `~/.claude` (owner only). The default proposal is the repo, under `.claude/mods/<name>/`, loaded via the project's plugin settings. To be confirmed in the first mod's spec.
4. Every guard-like mod hook gets a `.catch` that fails closed, and a test that proves it.

## 5. Effect on the ranking

Mods don't move ranks 0–2: they are docs, script and preflight changes. They change **how** these are built:

- rank 3 (N4): build it as a mod
- rank 9 (N5): as a mod, and raised to follow rank 4, since a band is small and the evidence (up to 7 red nights unseen) is strong
- item 1 (metrics): collected by a mod

They also add **N9** (compact and continue), pending the owner's yes.
