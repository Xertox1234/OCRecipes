---
title: "_OUT_FLAG_RUN's value slot swallows the real command word, so an incidentally-named gated script denies — pre-existing, every anchor in guard-outward-cli.sh shares it"
status: backlog
priority: medium
created: 2026-09-17
updated: 2026-09-17
assignee:
labels: [deferred, harness]
github_issue:
---

# One flag before a command word turns an incidental script name into a deny

## Summary

`_OUT_FLAG_RUN`'s iteration is `SEP -flag (SEP value)?`. The value slot is unconditional, so a
single flag anywhere before a command word swallows that word as the flag's value. Everything
after it is then read as though the next gated-looking token were the invoked one — including a
script name that is only incidental text in a test filter, a `--grep` pattern, a `--message`
body or a commit message.

**This is a pre-existing over-denial on `origin/main`, not a regression.** It was surfaced by
PR #993's review rounds because that PR made it reachable through one more spelling (a yarn
workspace scope), and two of its instances were fixed locally there. The class itself is wider
than any of those fixes.

## Measured, not inferred

2026-09-17, bash 5.3.15, PreToolUse envelopes on stdin, nothing executed. Each pair differs by
exactly one token — the flag — which is what makes it a value-slot defect rather than anything
about the surrounding grammar.

| command                                                       | verdict  |
| ------------------------------------------------------------- | -------- |
| `yarn run test -- --grep <otascript>`                         | ALLOW    |
| `yarn run --silent test -- --grep <otascript>`                | **DENY** |
| `npm run test -- --grep <otascript>`                          | ALLOW    |
| `npm run --silent test -- --grep <otascript>`                 | **DENY** |
| `npm --workspace api run --silent test -- --grep <otascript>` | **DENY** |

All of these hold on `origin/main` today. PR #993 added the workspace-scoped siblings
(`yarn workspace api run --silent test -- --grep <otascript>`) to the same set, and pinned one
of them as an ACCEPTED over-denial rather than patching it — see that PR's round-7 notes.

## Why the obvious repair is wrong — BUILT AND PRICED, do not redo it

A value-less absorber in the post-`run` slot was constructed against a parsing candidate with a
live control and measured:

- it does **not** remove the over-denials it was proposed for; and
- it turns **`npm run --workspace api <otascript>`** and **`pnpm run --filter api <otascript>`**
  from DENY into ALLOW.

Those are the documented npm and pnpm spellings for running a workspace script — two live OTA
publish routes traded for a cosmetic over-denial. Both are now pinned as `assert_deny` in
`test-guard-outward-cli.sh`, so an attempt to narrow that slot reddens immediately.

The ambiguity is genuine: `<pm> run --flag X Y` cannot be resolved by a text matcher, because
`X` is the flag's value in one real spelling and the invoked script in another. A fix has to
distinguish them by something other than position — a known-arity flag table, or a rule that
the value slot may not consume a token when a gated name follows.

## Acceptance Criteria

- [ ] The over-denial pairs above stop denying, with each pair's one-token control still passing
      in the same run.
- [ ] `npm run --workspace api <otascript>` and `pnpm run --filter api <otascript>` still DENY —
      these are the rows the rejected repair broke, and they are already pinned.
- [ ] The corpus re-run derives its pins from the run rather than adjusting them to match, and
      the deny-reason attribution manifest shows no pre-existing row rerouting to a different
      check.
- [ ] Whatever mechanism replaces the unconditional value slot is applied to `_OUT_FLAG_RUN`
      once, not per-anchor — the per-anchor approach was tried across three of PR #993's rounds
      and each fix exposed the next slot.

## Implementation Notes

- `_OUT_FLAG_RUN` is consumed by most anchors in `guard-outward-cli.sh`, so this is a
  wide-blast-radius change: expect the corpus pins to move and budget a full re-derivation.
- **Check the CI wall clock before adding corpus rows for this.** The corpus job is a required
  check at ~17 CI-minutes against a 30-minute cap; PR #993 already raised that cap once after a
  silent `cancelled` (a timeout reports as `cancelled`, not `failure`).
- The crude degraded mirror `crude_smells_outward` has its own, separate flag absorber with
  different behaviour. Changing one does not change the other, and the two have already drifted
  apart once in this area.

## Scope Contract

- **Mechanisms to use:** `_OUT_FLAG_RUN` and the existing corpus. No new gate, no new file.
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/test-guard-outward-cli.sh`, `.claude/hooks/repro-outward-cli-corpus.sh`.
- **Out of scope:** the workspace-scope grammar (closed in #993) and the crude mirror's absorber,
  which is a separate constant with its own residuals.
