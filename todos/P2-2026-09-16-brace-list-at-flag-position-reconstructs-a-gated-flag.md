---
title: "A brace LIST at FLAG position reconstructs a gated flag on a PR-merge command — ALLOW on main today"
status: backlog
priority: medium
created: 2026-09-16
updated: 2026-09-16
assignee:
labels: [deferred, harness, security]
github_issue:
---

# A brace LIST at FLAG position reconstructs a gated flag

## Summary

`guard-outward-cli.sh` models brace LIST expansion at VERB position (closed 2026-09-16,
PR #982) and discloses TOOL and NESTED positions as open residuals. There is a fourth
position — FLAG — which is reachable, unclosed, and was unnamed until PR #982 documented
it. A whole-flag brace list reconstructs a gated flag the guard denies when spelled
literally.

## Background

Measured 2026-09-16 during the merge-gate security review of PR #982, against BOTH the
PR branch and `origin/main`, with a positive control (a literal gated flag → DENY) and a
negative control (the sanctioned automerge spelling → ALLOW) both behaving in the same
run:

    <pr-merge-command> 42 --auto --delete-branch --{admin,squash}     → ALLOW on both trees

Bash expands that to `--auto --delete-branch --admin --squash`. Both reconstructed words
are genuine flags of that subcommand, so the construction needs no repeated-flag or
spare-positional tolerance to be well-formed. The guard denies the same flag spelled
literally.

**Pre-existing, not a regression.** It allows on `main` too, so PR #982 neither introduced
nor widened it. PR #982 only documented it (see `guard-outward-cli.sh`'s DOCUMENTED
RESIDUALS entry, search "BRACE LIST expansion", FLAG-position paragraph).

**The residual is wider than the whole-flag form, and the alternative count is not the
discriminator.** Re-measured with the base command `gh pr merge 42 --auto --delete-branch`
held CONSTANT and only the trailing flag's spelling varied (positive control `--admin` →
DENY, no-extra-flag control → ALLOW, both behaving, zero void rows), on both trees:

| spelling            | verdict   | expands to                                |
| ------------------- | --------- | ----------------------------------------- |
| `--admin`           | DENY      | `--admin`                                 |
| `{--admin,--admin}` | DENY      | `--admin --admin`                         |
| `--{admin,squash}`  | **ALLOW** | `--admin --squash`                        |
| `--ad{m,m}in`       | **ALLOW** | `--admin --admin`                         |
| `--ad{m..m}in`      | **ALLOW** | `--admin` (one word, no extra positional) |

The in-word RANGE form is the cleanest bypass of the set. What separates DENY from ALLOW is
whether the literal substring `--admin` survives in the RAW command text: `scan_renderings`
never brace-expands, so any spelling that breaks that substring passes, and any spelling
that leaves it intact is caught by the literal check. Generalise from that, not from the
alternative count.

**Correction on the record.** An earlier revision of this todo claimed the in-word spellings
were measured DENY. That was wrong. The probe behind it varied the flag spelling and the
presence of `--auto`/`--delete-branch` simultaneously, so those rows sat in an
already-denied regime and the flag dimension was masked. A control only validates the path
it actually runs through.

### Why this is `medium` and not `high`

The harm this flag exists to cause is independently blocked by a second layer. Measured
via a read-only API read rather than recalled: `enforce_admins: true` and 9 required
status checks. Because admin enforcement is on, GitHub refuses an administrator override
regardless of whether the local guard lets the command run, so a PR with failing or
incomplete required checks cannot be forced past them through this path. What is lost is
the guard's completeness, not the branch's integrity.

Be precise about which layer stops what: `required_approving_review_count` reads **0**, so
required approvals are NOT part of that protection, and this path does not make an
unreviewed merge newly possible — an unreviewed merge is already reachable through the
sanctioned `--auto` route by design. The only thing `--admin` would defeat is the 9
required checks. An earlier revision of this section listed "required reviews" among the
layers and concluded "nothing reaches `main` unreviewed through this path"; both
overstated the protection and are corrected here. Confirming that a settings object
exists is not confirming its value.

It is also not reachable by accident: an agent intending to force a merge types the flag
literally, which is denied. The brace form only appears when someone is deliberately
probing the guard.

## Acceptance Criteria

- [ ] `<pr-merge-command> 42 --auto --delete-branch --{admin,squash}` measures DENY on the
      precise path, with the deny reason attributable to a named check (not a generic
      fail-closed smell).
- [ ] The in-word spellings `--ad{m,m}in` and `--ad{m..m}in` also measure DENY. They are
      part of this residual, NOT already closed — the range form reconstructs a bare
      `--admin` with no extra word, so any fix keyed on a spare positional misses it.
- [ ] `{--admin,--admin}` and a literal `--admin` still DENY, with attribution unchanged —
      no credit stolen from the literal check that already catches them.
- [ ] The sanctioned automerge spelling (`--auto --squash --delete-branch`) still ALLOWs.
      This is the negative control and it must be asserted in the same run, not assumed.
- [ ] Corpus rows added for FLAG position across the r4brlist family, generated from the
      dimension rather than hand-listed, following the existing `TOOL_MIDS`/`SPAN2_IDS`
      convention. The corpus currently generates only 2 of its own 3 position members for
      this family, which is why the gap is invisible on every run.
- [ ] All four `EXPECTED_*` pins in `repro-outward-cli-corpus.sh` re-derived from a real
      run, never hand-incremented, and the prose decompositions next to each pin updated
      in the same change.
- [ ] `test-guard-outward-cli.sh` passes with no reduction in count; the corpus pins
      exactly and exits 0.
- [ ] The FLAG-position paragraph in the DOCUMENTED RESIDUALS entry updated to reflect
      whatever closes (or is deliberately left open).

## Implementation Notes

The guard already models FLAG position for four other mechanisms
(`flagvarithsep-*`, `flagvbareparen-*`, `flagvcasearm-*`, `flagvcasecomment-*`), so the
shape to copy exists — this is not a new scanner.

**Measurement harness.** The guard requires a JSON envelope on stdin:

    {"tool_name":"Bash","tool_input":{"command":"..."}}

Bare command text fails envelope parsing and returns a fail-closed deny whose reason
contains "could not be read". That looks exactly like a real verdict and is not. Three
separate probe attempts during the 2026-09-16 investigation were void this way. Detect
that string explicitly and treat such a run as VOID. `test-guard-outward-cli.sh`'s
`run_hook` builds the envelope correctly — reuse it rather than re-rolling one.

**Controls are mandatory.** Every probe needs a positive control (a literal gated flag
that MUST deny) and a negative control (the sanctioned automerge spelling that MUST
allow) in the SAME run. The negative control is the one that matters here: without it,
every row on a PR-merge command comes back DENY for an unrelated reason and the
flag-specific dimension is masked. That is how the first void run nearly produced a false
"no bypass exists" conclusion.

**Differential against main.** Extract main's guard and `lib/` with
`git show origin/main:<path>` into a temp dir. `lib/cmd-detect.sh` was byte-identical
between main and the PR-#982 branch as of 2026-09-16 — verify that rather than assuming
it, since a differing lib silently changes what you are comparing.

**Never execute the construction.** Feed the guard the string and read its verdict. Note
also that an active outward-CLI guard refuses a Bash command whose own text contains such
fragments, so probe strings belong in a FILE that is then run, not inlined on the command
line.

`.claude/hooks/**` feeds main's REQUIRED Outward-CLI guard corpus check, so a careless
edit wedges every open PR in the repo. Mutation-verify against the merge result
(branch ⊕ main), never the bare branch tip. Note the corpus derives
`EXPECTED_EMIT_SITES` from a grep pipeline over `guard-outward-cli.sh`, so even added
COMMENT text can move that pin — re-run the corpus after any edit to that file.

## Scope Contract

- **Mechanisms to use:** the existing `_OUT_BR_LIST_*` narrow-deny block and the existing
  `TOOL_MIDS`/`SPAN2_IDS` corpus-variant convention. No new scanner, no new files.
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/repro-outward-cli-corpus.sh`, `.claude/hooks/test-guard-outward-cli.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- PR #982 (brace LIST at VERB position) must land first — it introduces the
  `_OUT_BR_LIST_*` block this todo extends, and the DOCUMENTED RESIDUALS entry this todo
  updates.
- Serialize against any other open PR touching `repro-outward-cli-corpus.sh`. As of
  2026-09-16 that is PR #982, PR #983, and PR #980; all four collide on the same four pin
  constants, and those pins are NOT reconcilable arithmetically — whichever lands later
  must re-derive from a measured run rather than hand-resolving the conflict.

## Risks

- Widening the flag-position item class risks stealing attribution from the literal check
  that catches `--admin` and `{--admin,--admin}`. Widening a matcher is monotone on a BOOLEAN read
  but NOT on a COUNT — a longer match absorbs what would have started a second one, so
  verify per deny SITE and per alternation BRANCH, not per file.
- The composition space is open-ended. Measuring and closing FLAG position for this one
  mechanism is worth more than an attempt to close "all positions x all mechanisms",
  which is how this axis got over-scoped before.

## Updates

### 2026-09-16

- Filed after measurement during PR #982's merge-gate review. Found by `security-auditor`;
  the core finding was confirmed by independent re-measurement. Documented in the guard's
  residual entry by PR #982; this todo tracks closing it.
- CORRECTED the same day, before merge. The first revision claimed the two in-word spellings
  were refuted and measured DENY. They are not — a re-review caught it, and a controlled
  re-measurement (base command held constant, positive and negative controls both behaving)
  confirmed both ALLOW on both trees, with the range form the cleanest bypass of the set.
  The original security report was right about them; the refutation was the error. Cause:
  the refuting probe varied two dimensions at once, so the flag dimension was masked by an
  unrelated deny. The guard's own residual entry carries the same retraction.
