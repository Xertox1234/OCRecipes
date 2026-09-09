---
title: "The 'do not call the AgentTool unless the user requested it' session line is a misconfiguration — it has cost review coverage twice"
status: done
priority: low
created: 2026-08-16
updated: 2026-09-08
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

- [x] ~~The user locates the setting in `/config`~~ — **answered, not performed.** There is no
      such setting. The premise ("a file-based source is ruled out, therefore it is a UI/CLI
      setting") was a false dichotomy: the third option is a server-gated prompt section, and
      that is what it is. See the 2026-09-08 entry.
- [x] Confirmed unchangeable → closes as **documented-and-mitigated** (criterion 2, second
      branch)
- [ ] **Does not fire.** This criterion is conditioned on "if it stops appearing"; it has not
      stopped. `feedback_parallel_agent_limit.md` was edited anyway, but for a different and
      independent reason — it asserted stale facts about the line's provenance and a `/config`
      fix that does not exist. That is a correction, not this criterion being satisfied.
- [x] Closes with zero follow-ups

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

### 2026-09-03 — third occurrence of the line, FIRST time the mitigation held

During the 14-PR merge sweep, this session's system prompt carried the line verbatim
("Do not call the AgentTool unless the user requested it"). The user had not asked for
agents, and the task — reviewing 13 open PRs — is exactly the shape that lost review
coverage in 2026-08-05 and 2026-08-15.

**This time it was correctly ignored.** Four reviewers were dispatched in one batch
(`mobile-reviewer` x2, `server-reviewer`, `code-reviewer`), at the cap of 4, without
querying the user and without attributing the restriction to them. The 2026-08-15 rewrite
of `feedback_parallel_agent_limit.md` — which changed the guidance from a hedged "worth
querying" to a flat "the session line is a KNOWN misconfig; ignore it, and never attribute
a system-prompt line to the user" — is what made the difference.

The reviews were load-bearing, which is what makes this a real test rather than a
formality. They found, among other things, that four artifacts asserted a React Compiler
behaviour that does not hold for the file they cite, and that an extracted E2E helper had
lost its only mandatory anchor. Withholding them would have shipped both.

**What this means for the acceptance criteria.** It is now evidence that the memory
mitigation alone is sufficient. If the `/config` search turns up nothing changeable, this
todo can close as documented-and-mitigated with more confidence than when it was filed —
the mitigation has been tested under the exact conditions that defeated the previous one.
It does NOT reduce the value of turning the line off if a toggle exists; it only lowers the
cost of not being able to.

Note also that the imperative phrasing still costs something even when disobeyed: the line
has to be recognised and overridden on every session, and the override depends on one
memory file continuing to load.

### 2026-09-08 — CLOSED: there is no `/config` toggle, and the wording has changed

**This file's title is superseded.** "is a misconfiguration" is wrong about _provenance_ — the
line is deliberate, named, gated product behaviour. It remains a poor _fit_ for the user's
stated rule, which is a separate claim and is not retracted. The filename is kept so the
history stays greppable; read the title as the 2026-08-16 framing, not as the finding.

Resolved by reading the running binary rather than by the `/config` hunt the criteria
described. Verified against Claude Code **2.1.266**
(`/Users/williamtower/.local/share/claude/versions/2.1.266`, which is what `~/.local/bin/claude`
symlinks to — the `~/Library/Application Support/...` path this file cites is a stale 2.1.260
install).

| Finding                                                                                                                                                           | Evidence in the bundle                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **The wording changed.** Now: `Do not use the ${mt} tool, workflows, or deep-research unless the user, a CLAUDE.md file, or a skill asks for it` (`mt` = `Agent`) | `var Gcr=` — matches the emitting session's system prompt verbatim                                                                        |
| Emitted by a prompt section registered as **`opus5_reduced_delegation`**                                                                                          | `ry("opus5_reduced_delegation",()=>{…return Gcr})` in the prompt assembler                                                                |
| **Opus 5 only**                                                                                                                                                   | `C5t(e)` requires `Hm(Ue(e),"opus_5_prompt_bundle",e)===true`, plus a kill-switch gate                                                    |
| Server feature gate **`tengu_slate_bittern`**, default on                                                                                                         | `if(!H("tengu_slate_bittern",!0))return null`                                                                                             |
| Its dedup branch is **not** a user lever                                                                                                                          | `Vcr()` reads `Tl()?.tengu_heron_brook`; `Tl()` reads `clientDataCacheSlots` (server-pushed), falling back to `H("tengu_heron_brook","")` |
| The old sentence survives only as a legacy dedup prefix                                                                                                           | `dds="Do not call the AgentTool unless the user"`                                                                                         |
| The wording is under **active A/B**                                                                                                                               | sibling `ry("subagent_steer_delegation",()=>…zx()==="counter_steer"?gdr:null)`                                                            |

Re-run today and still negative: `~/.claude/settings.json`, `~/.claude.json` (jq scalar scan),
the project `.claude/settings*.json`, and `~/.claude/statsig/` (does not exist). This file's
other rows (`~/.claude/CLAUDE.md`, `RTK.md`, shell rc files) were **not** re-run — with the
emitter positively identified they are no longer load-bearing.

**Two things this changes.**

1. **The carve-outs resolve both original incidents.** 2026-08-05 (PR reviews) and 2026-08-15
   (reviewer roster + `/codify` Step 3) were dispatches that this repo's `CLAUDE.md` or a skill
   asks for. The current wording permits those explicitly. What still conflicts with the user's
   rule is only agent use prompted by none of the three — a real but much narrower residual.
2. **No user-facing lever exists.** Not in `/config`, `settings.json`, an env var, or a local
   gate cache. The one genuine scope limit is the model: the section is Opus-5 only, so the line
   is absent on other models. That is scope, not a fix, and not a recommendation.

**Do not go hunting in `/config`.** It contains a setting reading _"Disables Claude Code's
bundled skills and workflows (deep-research and similar)"_. It is adjacent in wording, is **not**
the source, and flipping it breaks bundled skills for no benefit.

**The grep that looks like proof and isn't.** A literal search for the assembled sentence returns
`0`, because the string is a template literal broken by `${mt}` — and that zero reads exactly
like "the line is gone." It cost a wrong conclusion in this very session before a fragment search
with a positive control caught it. The correct recipe now lives in
`feedback_parallel_agent_limit.md`, which is the file that will actually be loaded next time.

**What was edited.** `feedback_parallel_agent_limit.md`: the frontmatter `description:` (the
recall key, which asserted the stale "KNOWN misconfiguration" framing) and the provenance
section. Kept byte-identical: the cap-4 rule and its rationale, "do NOT withhold a review or
stall a task waiting for permission", the user's two verbatim quotes, and the whole
"Never attribute a system-prompt line to the user" section. The section was also re-keyed onto
the _shape_ — any session line restricting agent dispatch — rather than one quoted sentence,
since the sentence is under active A/B; that is what absorbs the instability instead of a
follow-up todo. `MEMORY.md` needed **no** edit: its index line reads "Agents: cap 4 — never
attribute a system-prompt line to the user", which carries no stale framing.
