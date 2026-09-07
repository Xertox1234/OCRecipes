---
title: "guard-outward-cli.sh: a redirect glued between the tool word and the verb silently ALLOWS every gated family"
status: done
priority: critical
created: 2026-09-06
updated: 2026-09-07
assignee:
labels: [security, harness]
github_issue:
---

# An interior redirect defeats every gated verb family

## Summary

A redirect operator glued between a gated tool word and its verb (`eas>/dev/null update
--branch preview`) is a real, executing invocation that `guard-outward-cli.sh` silently
**ALLOWS**. It is not scoped to one family or to multi-word verbs: **every gated family
measured is defeated by it**, including the `eas update` OTA-publish path that caused this
repo's real 2026-08-16 incident.

## Background

Found 2026-09-06 while closing the folded repair (PR #926). That work fixed two redirect
positions — finding A (a redirect CLOSING the verb, `merge>log`) and finding B (a redirect
PRECEDING the command, `2>/dev/null gh pr merge`). This is a **third position** neither
reaches, and it is the broadest of the three.

**Why no boundary widening reaches it.** A/B, `{`/`}` and backtick were all _boundary_
problems: the verb was present, adjacent to a character the class did not accept. This is a
_separator_ problem — the anchors require `[[:space:]]+` between the tool word and the verb,
and a redirect is not whitespace, so the verb pattern simply never matches. The detection
failure is total: no check runs at all, so even the `--repo` cross-repo egress check is
skipped.

The shared ANCHOR does not cover it either — `_CMD_POS_PREFIX` absorbs `_CMD_REDIR` only as
part of the _prefix_ run before the command word (`.claude/hooks/lib/cmd-detect.sh:118`).
This is not a case of the guard lagging the lib.

> **CORRECTED 2026-09-07 — this sentence said "the shared LIB does not cover it either",
> which is false.** True of the ANCHOR, as stated; false of the LIB. `_CMD_GIT_GLOBALS`
> (`lib/cmd-detect.sh:151`) has carried `([[:space:]]*$_CMD_REDIR)` — an INTERIOR absorber,
> in the run between `git` and its subcommand — since 2026-09-01, deliberately with
> `[[:space:]]*` rather than `+` so a glued redirect has no hole. The error was not
> pedantic: written this way it read as _nothing in this repo models this position_, when the
> shape to generalise was already written, tested and shipped one file away. The same
> sentence was in `guard-outward-cli.sh`'s DOCUMENTED RESIDUALS and in
> `docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md`;
> all three were swept, and a repo-wide grep for the fingerprint found no fourth copy.

Verified undocumented before 2026-09-06: `git show main:.claude/hooks/guard-outward-cli.sh`
has no residual describing a redirect between tool and verb.

### Measured matrix

Every row run against the live hook, JSON envelope built with `jq -cn --arg` exactly as
`test-guard-outward-cli.sh`'s own harness does. No outward-facing CLI was executed — the hook
only reads text. The spaced baselines are included to prove each verb is gated at all, so an
ALLOW below is a detection failure and not an ungated verb.

| construction                                   | spaced baseline          | with interior redirect |
| ---------------------------------------------- | ------------------------ | ---------------------- |
| `eas … update --branch preview`                | DENY (OTA publish)       | **ALLOW**              |
| `npm … publish`                                | DENY                     | **ALLOW**              |
| `railway … up`                                 | DENY                     | **ALLOW**              |
| `gh … api repos/o/r -X POST`                   | DENY (mutating method)   | **ALLOW**              |
| `gh pr … merge 42`                             | DENY                     | **ALLOW**              |
| `gh pr … comment 5 --body hi --repo other/org` | DENY (cross-repo egress) | **ALLOW**              |
| `gh release … create v1.0`                     | DENY                     | **ALLOW**              |
| `gh repo … delete o/r`                         | DENY                     | **ALLOW**              |
| `railway variable … set K=V`                   | DENY                     | **ALLOW**              |
| `railway service … delete svc`                 | DENY                     | **ALLOW**              |

In each "with interior redirect" row the redirect is glued directly after the word preceding
the verb, with no space before it.

**Not redirect-syntax-specific.** The output-redirect form, the fd-duplicating form
(`2>&1`-shaped) and the input-redirect form were each measured and each ALLOWS. Any
redirection token bash strips from argv should be assumed to work.

> **CORRECTED 2026-09-07 — the sentence above conflates an ALLOW with a bypass, and one of
> its three forms is not a bypass at all.** See the "Re-measurement" section below. The same
> sentence was written into `guard-outward-cli.sh`'s DOCUMENTED RESIDUALS and into
> `docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md`;
> both must be swept when this todo is worked.

**Why these are real invocations.** Bash tokenizes a redirect out of argv wherever it sits, so
`eas>/dev/null update --branch preview` yields argv `(eas, update, --branch, preview)` with
stdout redirected — bash-identical to the spaced form this guard correctly denies.

### Severity

`critical`, on this repo's own standard that a silent ALLOW in this gate is treated as
critical rather than theoretical, because the gate exists in response to a real incident
(`project_ota_accidental_publish_2026_08_16`) — and the `eas update` row above **is** that
incident's exact command class.

Two honest qualifiers for whoever prioritises this: the construction is not one an agent
writes by accident, and the guard's own header states it is a guardrail, not a sandbox. It
is filed critical for blast radius (every family, total detection failure), not for
likelihood of accidental triggering.

## Acceptance Criteria

- [ ] Reproduced first against unmodified `main` — construct each input, run the hook, record
      its actual exit code. If any row does not reproduce, that is a finding: report it
      rather than fixing something that is not broken.
- [ ] The interior-redirect absorber is applied **uniformly** to every gated family in one
      change. A per-regex patch is the failure mode here: this file has already paid three
      times for the `occurrence-ambiguity-guard-applied-selectively-not-uniformly` shape
      (`GH_API_CLAUSE`, then `gh_pr_clause_has_repo`, then a structural test's own `grep -m1`).
      Enumerate every consumer of any construct you widen before changing it.
- [ ] Both the tool→verb gap **and** the namespace→verb gap are closed (`eas … update` and
      `gh pr … merge` are different positions in the same pattern).
- [ ] Every fix carries a **two-sided** regression test in `test-guard-outward-cli.sh`: a
      positive that fails without the fix, and a negative control that would catch
      over-matching. A control that stays green under mutation is not a control.
- [ ] **Mutation-tested per row, not in aggregate**: revert/stub the fix, confirm the named
      assertions FAIL, restore, confirm they pass. Quote before/after counts.
- [ ] **Deny reasons asserted on every new row.** A DENY is not evidence the intended check
      fired — several of these families have a coarser guard that can deny first for an
      unrelated reason.
- [ ] **False-positive population measured by execution, not estimated.** A "decline to act"
      branch is only safe for inputs the OLD code did not act on — run the old code to learn
      that set. Harvest real historical commands and diff decisions between the pre- and
      post-change hooks; validate the harness against a known flip before trusting a zero.
      At minimum confirm ordinary redirect use stays allowed (`grep -r foo . >/dev/null 2>&1`,
      `npm run build > build.log`, `cat < input.txt`).
- [ ] The corpus rows `nssufx-ghmerge` / `nssufx-ghcomment` in
      `.claude/hooks/repro-outward-cli-corpus.sh` flip from GAP to `ok`, and rows are ADDED
      for the families this todo newly measured, so the fixture covers the real blast radius
      rather than the two rows that happened to exist.
- [ ] Full `.claude/hooks/test-guard-outward-cli.sh` and `scripts/run-hook-tests.sh` pass;
      real counts quoted.
- [ ] The guard's `DOCUMENTED RESIDUALS` entry for this gap is updated from "unhandled, out
      of scope" to closed — append/amend, never silently delete a prior claim. Same for
      `NOTE6` in the corpus and the "A THIRD redirect position" section of
      `docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md`.

## Implementation Notes

- The likely shape is **one interior absorber**, defined once and interpolated wherever the
  patterns currently hardcode `[[:space:]]+` between two required-adjacent words — reusing
  the lib's existing `_CMD_REDIR` rather than hand-rolling a second redirect pattern. A
  hand-rolled copy diverging from the shared one is exactly how `GH_API_CLAUSE` came to be
  missed.
- **Ordering trap, already paid for once:** the anchor definitions were relocated below the
  lib source during finding B precisely because interpolating `$_CMD_REDIR` before the lib is
  sourced expands to the empty string — no error, suite green, bypass open. Anything new that
  interpolates a lib construct must stay below that source, and it is worth proving the
  interpolation is non-empty at definition time.
- Consider whether the _clause-cut_ patterns need the same treatment as the _detector_
  patterns. The detector deciding a verb is present is not the same as the clause cut
  capturing the flags that follow it, and this file's history is a series of exactly that
  mismatch.
- Watch the `gh pr merge --auto` carve-out specifically. It is the file's **one grant-shaped
  read**: widening what its clause captures can turn a deny into an allow, unlike every other
  check here where widening only adds denies.
- Never execute a real outward-facing CLI. Use argv-printing stubs on `PATH`; shadow a binary
  rather than stripping `PATH`.
- Writing about these constructions trips the guard's own heredoc-prose false positive
  (`todos/P3-2026-08-16-command-guards-fire-on-heredoc-prose.md`), and `ALLOW_OUTWARD_CLI=1`
  clears only the single check that fired. Use file tools, not shell command strings.

## Scope Contract

- **Mechanisms to use:** one interior-redirect absorber, defined once, reusing the lib's
  existing `_CMD_REDIR`. No new parsing layer, no expansion evaluation, no new dependency.
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/test-guard-outward-cli.sh`, `.claude/hooks/repro-outward-cli-corpus.sh`,
  the disclosure sites named in the Acceptance Criteria, and `.claude/hooks/lib/cmd-detect.sh`
  only if the shared absorber genuinely needs to change.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- **Land PR #926 first**, then rebase. It touches every file in scope here, and its corpus is
  the fixture this todo's acceptance criteria measure against.

## Risks

- **Over-denial is the real risk, not under-denial.** An absorber placed where whitespace is
  currently required loosens a pattern used by every gated family at once — the widest blast
  radius of any change made to this file so far. Measure the false-positive population by
  execution; this repo has previously lost 144 real denies to one unverified "the old code
  did not act on this" claim.
- Ordinary redirect use is extremely common in this repo's own command history, so a careless
  absorber could deny routine work. The negative controls are the deliverable as much as the
  positives.

## Re-measurement, 2026-09-07 (AC #1 satisfied, plus two corrections)

Reproduced against unmodified `main` (`b01fcff2`). **All 10 rows of the matrix reproduce**:
every spaced baseline DENIES and every glued interior-redirect form ALLOWS. Ground truth taken
with PATH-shadowed argv-printing stubs, with a positive and a negative control passing in the
same run.

**Harness note, because it lied first.** The stub originally reported on STDOUT — which these
constructions redirect to `/dev/null`. Every row read "not invoked", i.e. reassuring and wrong.
The stub must write to a sentinel FILE that no redirect in the construction can reach.

### Correction 1 — `eas2>&1 update` is NOT a bypass, and the ALLOW is correct

The "not redirect-syntax-specific" sentence lists the fd-duplicating form as one of three
measured bypasses. Measured with a working ground truth:

```
eas2>&1 update --branch preview     ALLOW   ->  real argv: eas2 (update --branch preview)
```

Bash takes an fd number only when the characters before the operator are ALL digits. `eas2` is
not, so `eas2` is the COMMAND WORD — a different, non-existent binary. Nothing gated runs, so
ALLOW is the right answer. **The original sentence measured guard verdicts and reported them as
bypasses**; the todo is careful about that distinction elsewhere ("the spaced baselines are
included to prove each verb is gated at all") and lost it here.

The fd-duplicating form IS a real vector — but only SPACED, which is correction 2.

### Correction 2 — the SPACE-separated interior redirect is the bigger and far likelier vector

The matrix varies the redirect SPELLING while holding the gluing fixed. Varying the gluing
instead: **a space-separated interior redirect defeats the guard identically, and is ordinary
shell that carries no evasion intent at all.** All ALLOW on `main`, all confirmed real
invocations:

| construction                              | real argv                       |
| ----------------------------------------- | ------------------------------- |
| `eas >/dev/null update --branch preview`  | `eas (update --branch preview)` |
| `eas 2>&1 update --branch preview`        | `eas (update --branch preview)` |
| `eas 2>/dev/null update --branch preview` | `eas (update --branch preview)` |
| `gh pr >/dev/null merge 42`               | `gh (pr merge 42)`              |
| `gh pr 2>&1 merge 42`                     | `gh (pr merge 42)`              |
| `gh 2>&1 api repos/o/r -X POST`           | `gh (api repos/o/r -X POST)`    |
| `npm >/dev/null publish`                  | `npm (publish)`                 |
| `railway 2>&1 up`                         | `railway (up)`                  |

**This materially changes the severity argument.** The todo's own qualifier says "the
construction is not one an agent writes by accident" — true of `eas>/dev/null update`, and
**false of `eas 2>&1 update`**, which is a shape someone types without thinking. Of the open
P0s on this guard, this is the only one reachable without deliberate construction, and it is
the one whose originating incident class (an accidental plain `eas update`) it actually
resembles.

Any fix must therefore absorb the redirect at the tool→verb and namespace→verb positions with
the separator OPTIONAL on both sides, not just glued.

## Resolution, 2026-09-07 — CLOSED

Fixed by **one interior absorber, `_OUT_SEP`**, defined once next to the other command-position
anchors (below the lib source, so `$_CMD_REDIR` interpolates) and applied to **all 30**
tool→verb and namespace→verb separator slots in a single change:

```sh
_OUT_SEP='([[:space:]]*'"$_CMD_REDIR"')*[[:space:]]+'
```

At zero iterations this is byte-identical to the `[[:space:]]+` it replaces, so only
redirect-bearing commands can change decision at all. It generalises
`lib/cmd-detect.sh:151`'s `_CMD_GIT_GLOBALS`, which has shipped the same shape for the git
family since 2026-09-01 — see the correction below.

**Every acceptance criterion met:**

- **AC1 reproduced against `main` first.** All 10 matrix rows reproduce, plus the
  space-separated variants and four families the matrix did not list. Ground truth by
  EXECUTION with PATH-shadowed argv-printing stubs writing to a sentinel FILE.
- **Applied uniformly**, detectors AND clause cuts. The two DENY-shaped cuts
  (`gh_pr_clause_has_repo`, `_GH_API_CUT`) were not optional: both treat an EMPTY clause as
  "nothing to deny", so widening detectors alone would have left cross-repo PAT egress and
  the mutating-method check open while looking fixed.
- **The grant-shaped merge CLAUSE was widened too**, on the user's ruling, and the safety
  argument was verified rather than asserted: the set the widened detector newly matches is
  exactly the set that ALLOWed before, so no command that denied before can flip.
- **Two-sided, reason-asserted tests:** +41 assertions (494 → 535), every deny attributed to
  its own family's reason string.
- **Mutation-tested per row.** Reverting `_OUT_SEP` to a bare `[[:space:]]+` turns 30
  named assertions RED — 27 family denies, the occurrence-counter gain, the no-`--auto`
  grant deny, and the structural shape check. (This read "exactly 29" when written, which
  was accurate before the structural pair was added two commits later and stale after;
  corrected rather than left standing, since a superseded number survives in every artifact
  nobody greps.) A second mutation to the looser `([[:space:]]|REDIR)+` form turns exactly one
  control RED — which **corrected a claim this work wrote**: `eas > update` does NOT
  discriminate between the two absorber forms (`_CMD_REDIR`'s target class greedily absorbs
  `update` as the filename), only `eas>/dev/nullupdate` does. Both comments were fixed.
- **Corpus:** +51 GENERATED rows across 11 families × {glued, spaced-output, spaced-fd} at
  both slots. Per-ID `comm` against the pre-change tree: **precise-path 84 → 31, 53 closed,
  0 opened; all-path 171 → 154, 17 closed, 0 newly dirty.**
- **False positives measured by execution, both directions.** 31,382 distinct Bash commands
  harvested from local transcripts; 14,151 are redirect-bearing. That filter is a **census,
  not a sample** — a command with no `<`/`>` cannot flip, because `_OUT_SEP` at zero
  iterations is byte-identical to what it replaced. Result: **0 ALLOW→DENY and 0 DENY→ALLOW**,
  with the harness validated against a known flip first.

**A gain no single-invocation row could see:** `gh pr merge 42 --auto; gh pr 2>&1 merge 43`
was ALLOWED. The second merge was invisible to the detector, so the count stayed 1 and the
first invocation's real `--auto` granted the carve-out for both — while the second merged
immediately with no `--auto` reaching gh. Now denied as ambiguous. This is finding B's
recorded multi-occurrence gain reappearing at the interior position.

**Two corrections shipped with the fix** (swept repo-wide, three sites, no fourth copy):

1. The "fd-duplicating form ALLOWS" sentence — see this file's own 2026-09-07 CORRECTED note,
   which was right.
2. **"The lib does not cover it either" is false.** True of the ANCHOR (`_CMD_POS_PREFIX`),
   false of the LIB: `_CMD_GIT_GLOBALS` has modelled the interior position for git since
   2026-09-01, deliberately with `[[:space:]]*` rather than `+`. The claim mattered
   practically — it read as "nothing here models this position" when the shape to generalise
   was already written and tested one file away. This todo's Background carried the same
   sentence.

**Two adjacent, pre-existing defects surfaced and filed** (measured identical on `main` and
on the fix branch, so neither is caused by this change):

- `todos/P0-2026-09-07-outward-cli-guard-space-separated-redirect-target-forges-auto.md`
- `todos/P1-2026-09-07-outward-cli-guard-narrow-deny-shape-b-closer-misses-redirect.md`

## Updates

### 2026-09-06

- Filed at the user's request after PR #926's final verification surfaced it. Found while
  investigating why two corpus rows (`nssufx-*`) remained GAPs.
- **Initial scoping was too narrow and is corrected here.** It was first described as
  affecting the namespace→verb position for multi-word `gh pr` verbs. Measurement across
  families showed it also defeats the tool→verb position for every single-word-verb family —
  `eas update`, `npm publish`, `railway up`, `gh api` — i.e. the entire guard, not a corner
  of it. The narrower framing was written into several artifacts before being measured and
  had to be swept; treat the matrix above as the authority.
