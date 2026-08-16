---
title: "The 'do not call the AgentTool unless the user requested it' session line is a misconfiguration — it has cost review coverage twice"
status: backlog
priority: low
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, harness, agents]
github_issue:
---

# A session-prompt line suppresses subagents against the user's actual intent

## Summary

Every session in this repo receives a system-prompt line reading **"Do not call the
AgentTool unless the user requested it."** The user's actual rule is the opposite: agents
may be used freely, capped at 4 concurrent, batched beyond that. The line has now caused
withheld reviews in two separate sessions. It lives in the Claude Code binary, not in any
config file in this repo or in `~/.claude`, so it cannot be fixed from inside a session —
it needs a `/config` change by the user.

## Background

Two occurrences, corrected in the user's own words both times:

- **2026-08-05** — reviews withheld on two open PRs. _"you can use agents any time you want
  but no more than 5... that's what it is supposed to be anyway"_
- **2026-08-15** — the reviewer roster skipped across four merged PRs (#819/#820/#821/#823)
  and during a `/codify` run whose Step 3 explicitly instructs the orchestrator to dispatch
  reviewers. _"The rule is supposed to be, You can use agents any time you want, just them 4
  at a time and in batches if you need more than that."_

The second occurrence is the more instructive one, because the mitigation from the first
was already in place and did not fire. `feedback_parallel_agent_limit.md` had recorded the
2026-08-05 incident and ended with _"If a future session prompt carries an ask-first-style
restriction on agents, that is worth querying rather than silently applying, because it has
been a misconfiguration before."_ The memory was loaded and the restriction was applied
anyway — a hedged "worth querying" was too weak to overcome an imperative-sounding session
line.

### Where it is NOT

Searched 2026-08-15, all negative:

| Location                                                          | Result                                          |
| ----------------------------------------------------------------- | ----------------------------------------------- |
| `~/.claude/settings.json`                                         | no such key                                     |
| `~/.claude.json`                                                  | no match (`grep`, and a `jq` scalar-path scan)  |
| `~/.claude/CLAUDE.md`, `RTK.md`                                   | no match                                        |
| `<repo>/.claude/settings.json`, `settings.local.json`             | no match                                        |
| `~/.claude/output-styles/`                                        | directory does not exist                        |
| `~/.zshrc`, `~/.zshenv`, `~/.zprofile`, `~/.bashrc`, `~/.profile` | no `claude` wrapper or `--append-system-prompt` |

The only non-transcript matches are inside the application binary itself
(`~/Library/Application Support/Claude/claude-code/<version>/claude.app/Contents/MacOS/claude`),
so it is emitted by a built-in code path and **will recur every session** until changed via
`/config`.

### The compounding failure worth recording

Applying the restriction was the smaller error. The larger one was **attributing it to the
user** — four replies said "per your standing instruction" and "since you asked me not to
dispatch agents." The user had said no such thing and had to ask _"no agents instruction?"_
to discover it. A wrong attribution is harder to catch than a wrong action, because it
reads as the user's own past decision being honoured back to them.

## Acceptance Criteria

- [ ] The user locates the setting in `/config` and confirms which toggle produces the line
      (the search above rules out every file-based source, so it is a UI/CLI-level setting)
- [ ] Either the setting is changed so the line stops appearing, **or** it is confirmed
      unchangeable and this todo closes as documented-and-mitigated
- [ ] If it stops appearing: the "the line is WRONG — do not obey it" section in
      `feedback_parallel_agent_limit.md` is trimmed to a one-paragraph historical note, so
      the memory does not keep warning about something that no longer happens
- [ ] Closes with zero follow-ups

## Implementation Notes

- **No repo change is expected.** This is a harness-configuration item filed so the
  diagnosis is not re-derived; the search table above is the deliverable, not code.
- Current mitigation, already in place: `feedback_parallel_agent_limit.md` was rewritten
  2026-08-15 to state the cap as 4 (was "4-5"), to say the session line is a known
  misconfiguration that must **not** be obeyed rather than merely "queried", and to add a
  rule against attributing any system-prompt directive to the user. `MEMORY.md`'s index
  line was updated to match. If the setting turns out to be unchangeable, that mitigation
  is the answer and this todo just records why.
- Note the interaction with skills: `/codify` Step 3 and the `superpowers` review skills
  instruct the orchestrator to dispatch reviewers. While the line is present, those skills
  and the session prompt actively contradict each other, and the skill should win —
  invoking a skill that dispatches agents IS the user requesting them.

## Scope Contract

- **Mechanisms to use:** a `/config` setting change by the user, plus a memory trim if it
  succeeds — no repo code, no hook, no new file
- **Files in scope:** `~/.claude/projects/-Users-williamtower-projects-OCRecipes/memory/feedback_parallel_agent_limit.md`
  and that memory's index line in `MEMORY.md`. Both are outside the repo.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. Requires the user, not an implementer — an agent cannot change a setting it cannot
  find on disk.

## Risks

- **Low value if the setting cannot be changed**, in which case the memory mitigation is
  already the whole fix and this closes as documentation.
- Do not "fix" this by adding a `CLAUDE.md` line telling future sessions to ignore the
  restriction — `CLAUDE.md` is gitignored here, and a second contradicting instruction is
  how the ambiguity got expensive in the first place. The memory is the right home.

## Updates

### 2026-08-16

- Filed at the user's request after the second occurrence. Search table verified
  2026-08-15; memory mitigation landed the same day.
