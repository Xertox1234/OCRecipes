---
title: "A privilege or wrapper binary in front of a launcher defeats guard-outward-cli.sh — a sudo- or corepack-prefixed launcher reaches the real CLI"
status: backlog
priority: high
created: 2026-09-16
updated: 2026-09-16
assignee:
labels: [deferred, harness, security]
github_issue:
---

# A privilege/wrapper prefix in front of a launcher is invisible to the guard

## Summary

`guard-outward-cli.sh` absorbs a fixed set of wrapper words before the command word
(`env|command|builtin|exec|nohup|setsid|…`, plus inline assignments and redirects). A binary that
is not in that set but which _execs its argument_ — `sudo`, `corepack` — is neither absorbed nor
treated as the command word, so everything after it is invisible to every detector.

## Measured, not inferred

2026-09-16, bash 5.3.15. PreToolUse envelopes fed to the hook on stdin; **nothing was executed**.
Command strings below are described rather than spelled where they name a gated verb, because this
repo's own guard refuses to let such text through in command position — see
`todos/P3-2026-08-16-command-guards-fire-on-heredoc-prose.md`.

| command shape                             | origin/main | PR #980 branch |
| ----------------------------------------- | ----------- | -------------- |
| bare `eas` + the OTA verb _(control)_     | DENY        | DENY           |
| `ls -la` _(control)_                      | ALLOW       | ALLOW          |
| `npm exec` + `eas` + the OTA verb         | ALLOW       | DENY           |
| **`sudo npx` + `eas` + the OTA verb**     | **ALLOW**   | **ALLOW**      |
| **`corepack npx` + `eas` + the OTA verb** | **ALLOW**   | **ALLOW**      |

Both controls bracket the result in the same run, so the harness renders both verdicts rather than
one for everything. This is **pre-existing and not a regression** — the two rows measure identically
on `main` and on the branch — but it is the same shape as the launcher gap PR #980 closes, and it
reaches the same sink: a real OTA publish.

## Background

Surfaced by the security review of PR #980 and filed rather than folded in, at the user's
direction, so that PR stays scoped to what it measured.

`corepack` ships with Node and is on PATH here. `sudo` is universal. Neither needs installing for
this to be reachable.

## Acceptance Criteria

- [ ] A `sudo`-prefixed and a `corepack`-prefixed launcher invocation of a gated verb both DENY.
- [ ] The fix is expressed as a PROPERTY, not as a longer list of binary names. The launcher work
      in #980 took six CRITICALs precisely because each round enumerated the spellings someone
      happened to think of; a seventh wrapper name will exist. Prefer "a word that execs its
      argument is a prefix, so keep scanning" over a name alternation.
- [ ] If an enumeration genuinely cannot be avoided, derive it from an authority and say which —
      the way #980's `npm (exec|x)` and `(run-script|run|rum|urn)` were taken from npm's own
      `lib/utils/cmd-list.js` rather than from memory.
- [ ] Two-sided controls in the same run: a gated command still DENIES **and** an ordinary safe
      command (`sudo ls`, `corepack --version`) still ALLOWS. Over-denying `sudo` wholesale would
      break routine use and get the guard switched off, which is the worst outcome available.
- [ ] Corpus rows added for the new prefix position, composed **combinatorially** with the existing
      launcher and path dimensions rather than appended as hand-listed cases. PR #980 had to add a
      composition-order dimension for exactly this reason: its grid could not express a
      path-qualified launcher, so an unchanged gap pin read as closure while measuring nothing.

## Implementation Notes

- **Do NOT widen `_OUT_WRAPPER_WORD`.** It looks like the home and is the wrong one: it feeds
  `_OUT_POS_PREFIX`, so every widening also reaches that constant's `grep -oE` extraction and
  count consumers, where a widening skews a result rather than merely denying more. There is no
  way to scope a widening of it to a boolean reader. Its definition line is pinned by hash in
  `test-guard-outward-cli.sh`, so such an edit reddens rather than silently moving 28 use sites.
  Widen `_OUT_POS_PREFIX_W` (command-position anchors) or `_OUT_POS_PREFIX_LP` (launcher/path)
  instead — both are consumed exclusively by boolean deny sites by construction. Widening that
  constant reaches `_OUT_POS_PREFIX`, which has roughly 24 consumers **including
  count/extraction/exclusion** ones — a widening there is NOT monotone-safe. `_OUT_POS_PREFIX_LP`
  has only boolean `grep -Eqi` deny consumers and is the safe place to widen. Check which consumers
  a given edit actually reaches before choosing.
- Prove any refactor of `_OUT_POS_PREFIX` leaves its expansion byte-identical, as #980 did by
  comparing `shasum` of the expanded value on both sides.
- `xargs`-constructed arguments were also observed ALLOW in the same review. That is a different
  mechanism — the gated text never appears in the command at all — and is almost certainly not
  closeable by a text matcher. Record it as a residual rather than attempting it here.

## Measured siblings in the same family — close these together, as an AXIS

The PR #980 security review measured these ALLOWing on BOTH `main` and that branch. They are the
same defect shape as the `sudo`/`corepack` case above, and each was found by adding one more
spelling to a list that had already been "completed" several times. Close them by treating the
prefix as a combinatorial AXIS composed against the existing launcher and path dimensions — not by
appending these names:

- A launcher in front of the package-directory clauses (`npx node ./node_modules/<pkg>/bin/run …`,
  and the railway equivalent). Those clauses have no launcher alternative, and the launcher
  constant has no package-directory alternative, so the two closures do not compose.
- A wrapper word AFTER the launcher (`npx env …`, `npx FOO=1 …`), since the launcher grammar
  permits only an optional PATH in that slot.
- Stacked launchers (`npx npx …`, `bunx npx …`) — the grammar allows exactly one launcher
  occurrence. Note the `--`-separated form already denies, so the gap is in the second position only.
- `pnpm` and `yarn` dispatching a local binary with no subcommand.
- `npm explore <pkg> -- <gated>`.
- A path-qualified wrapper in front of a launcher — the axis of the wrapper fix composed with one.

## Scope Contract

- **Mechanisms to use:** the existing wrapper/prefix constants in `guard-outward-cli.sh` and the
  existing generated corpus. No new gate, no new file, no new classification concept.
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/test-guard-outward-cli.sh`, `.claude/hooks/repro-outward-cli-corpus.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Sequenced after PR #980 merges — it introduces `_OUT_WRAPPER_WORD` and the composition-order
  corpus dimension this work builds on. Not blocking otherwise.

## Risks

- These files feed `main`'s required `Outward-CLI guard corpus` check; a careless edit wedges every
  open PR in the repo. Mutation-verify against **branch merged with current main**, never the bare
  tip.
- Over-denial is the failure mode that gets a guard disabled. `sudo` appears in plenty of harmless
  commands; deny the _gated verb behind it_, not the prefix itself.

## Updates

### 2026-09-16

- Filed from the PR #980 security review, measured against both `main` and the branch.
