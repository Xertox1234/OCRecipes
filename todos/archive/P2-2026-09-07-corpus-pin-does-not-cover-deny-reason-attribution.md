---
title: "The corpus pin compares verdicts and per-path outcomes, but never deny-REASON attribution — a row can start denying from the wrong check and the gate stays green"
status: done
priority: medium
created: 2026-09-07
updated: 2026-09-08
assignee:
labels: [deferred, harness, testing, security]
github_issue:
---

# A green pin is not evidence the intended check fired

## Summary

`.claude/hooks/repro-outward-cli-corpus.sh` now pins three things: row count, the two gap
totals, and per-ID manifests carrying each dirty row's four per-path verdicts. It pins
**nothing about _why_ a row denied.**

`reason()` (same file) already computes the deny-reason fingerprint for every DENY row, and
the script prints a whole `=== deny-reason attribution (which check actually fired) ===`
section from it. The pin never reads those strings. So a refactor that keeps every verdict
identical while making a row deny through a **different check** leaves
`rows=427  precise-path gaps=31  all-path gaps=164` and both manifests byte-identical — green.

## Background

Filed 2026-09-07 from the code review of PR #933 (the PR that added the pin), **merged
2026-09-08 as `e0e6e886`** — that commit is the baseline for this work. Raised independently by
`code-reviewer`; not a defect that PR introduced — the previous state pinned nothing at all —
but a gap the new pin's own framing could hide.

**Still open, and confirmed so by a second review round.** PR #933's follow-up review re-examined
this deliberately: the reviewer endorsed disclosure-plus-todo over fixing it in that PR, on the
grounds that the two costs named under Implementation Notes below (`reason()` re-invocation, and
the `cut -c1-72` collision risk) make a rushed fix either wrong or runtime-doubling for a gate
whose whole value is being cheap enough that nobody disables it. Nothing here is superseded.

This is the hazard the corpus file already documents in prose and has been bitten by before.
Its `co-mask-c1` note says it outright: _"on the pre-fix tree this row DENIES, but for an
unrelated reason … Read this row's ATTRIBUTION line, never its verdict alone."_ The same
caveat is repeated for `flagvcasearm-ghadmin`, which reports `ok` while denying from the "no
REAL `--auto`" rule rather than the check its family name implies. Both are cases where the
verdict was right and the attribution was the only thing that revealed what was actually
happening.

The pin as shipped therefore encodes an assurance the file's own notes tell you not to make.
The `HOW TO BUMP` block now says so explicitly, so this is disclosed rather than silent — but
disclosure is not coverage.

## Acceptance Criteria

- [x] The pin fails when a row's deny-reason fingerprint changes while its verdict does not.
- [x] The expected attribution is stored in the same "deliberate, dated, reviewable diff"
      style as the existing manifests — a reviewer must be able to read _which_ check each
      row is expected to fire, not confirm an opaque hash.
- [x] Mutation-verified: change one row's deny path (not its verdict) and show the gate goes
      RED. Assumed-correct is not acceptable here — that is the whole point of the file.
- [x] The runtime cost is measured and stated. `reason()` re-invokes the guard per DENY row,
      so a naive implementation could add a large multiple to the ~2m10s CI run.

## Implementation Notes

The cheap shape is to extend the existing all-path manifest entries, which already carry
per-path verdicts, with the precise-path reason fingerprint — the same `id p=.. j=.. l=.. a=..`
line gaining a reason field. Watch out for two things:

1. **Reason strings are truncated to 72 chars by `reason()` (`cut -c1-72`).** Two different
   checks whose messages share a long prefix would collapse to the same fingerprint. Verify
   the current reason set is distinguishable at 72 chars before pinning it, or widen the cut.
2. **Cost.** The main loop already calls `decide` 4x per row (1708 invocations). Adding a
   `reason` call per DENY row is a real increase; the file's existing attribution section
   already pays it once, so consider capturing the reason during the existing pass rather
   than re-invoking.

Do not pin a digest of the attribution section: an opaque hash cannot be confirmed by a
reviewer reading the diff, which is the property the pin convention exists for.

Related: `todos/archive/P3-2026-09-07-corpus-note6-allgaps-explanation-is-wrong.md` (same file,
comment accuracy).

## Updates

### 2026-09-08 — implemented; the pin's fourth check

Shipped on `fix/corpus-pin-deny-reason-attribution`, baseline `cf516c3f`.

**What landed.** `DENY_ATTRIB` is collected in the main verdict loop (the same branch that
computes `p`), pinned as `EXPECTED_DENY_ATTRIB` — 356 lines of `id : <first 72 chars of the
deny reason>` — and asserted with the existing `_pin_count` + `_pin_members` helpers. No new
comparison machinery: the printed `deny-reason attribution` section IS the manifest now, so
regenerating the pin is a copy of that block rather than a transcription of it.

**AC1 + AC3 — mutation-verified, and the mutation is one the guard itself nominated.**
`guard-outward-cli.sh` records, above its `--admin` check, that the `${UNSET}` spelling
"denies for 'without a REAL --auto flag' instead — correct decision, wrong attribution …
rather than fixed by reordering, which … needs its own mutation evidence". That reorder is
the mutation: defer the no-REAL-`--auto` deny to the `--admin` deny three lines below it
whenever the `--admin` scan matches. Both branches DENY, so no verdict can move — and none
did. Measured over a full run:

    verdict-table lines differing (427 rows x 4 paths)      0
    attribution lines differing                            14  (7 rows)
    FAIL lines in the pin                                   1  (attribution only)

The seven: `co-mask-c1`, `co-redir-mask`, and five `flagv*-ghadmin` (arithsep, bareparen,
comment, sub, var). `c1-threedash` did **not** move — `${x:----admin}` leaves three dashes and
`_OUT_FLAG_LEAD` correctly refuses that as a flag boundary. A first guess at this set named
`c1-threedash` and missed four of the seven, which is the reason the file now carries the
measured list and not a derivation.

**AC4 — the runtime cost is negative.** The attribution section used to re-walk `ROWS` and
re-run `decide precise` 427 times purely to re-derive a verdict the main loop already had.
Capturing in that loop deletes those 427 guard invocations. Interleaved on this box, same
conditions:

    baseline  127s / 138s
    pinned     99s / 103s      (~25% faster)

So the concern in Implementation Notes #2 inverts: pinning attribution made a now-REQUIRED
check cheaper. Total guard invocations per run fall from ~2500 to ~2070.

**AC2 + Implementation Notes #1 — the 72-char fingerprint does not collide.** Measured by
widening `cut -c1-72` to 400 and re-running: **17 distinct fingerprints at 72 chars and the
same 17 at 400**, over all 356 DENY rows. No widening needed, and the manifest stays prose a
reviewer can read. No digest, per the note at the bottom of this file.

**Two things found on the way that were not in the plan:**

1. **The manifest cannot live in `$(cat <<'EOF' … )`.** bash counts parentheses _through_ a
   quoted heredoc body, and `cut -c1-72` truncates two of the 17 messages mid-parenthetical
   (`(and the yar`, `(-X/--method POST/`). Inside a command substitution those unmatched `(`
   desync the parser and the whole file dies at PARSE time with ``unexpected EOF while looking
for matching `)'`` — no test reaches it. Same scanner-desync family as `dd45ef3e`. The
   manifest is emitted from a plain function body instead, which is never scanned that way.
2. **41 of the 356 fingerprints end in a trailing space**, because the 72-char cut lands
   mid-sentence. A trailing space is invisible in a diff and stripped on save by most editors —
   on a required check that is a red gate with no visible cause. Both sides are now rtrimmed at
   the single point that produces them.

**Also corrected in passing:** the collection-site comment still described the counts as "only
a faster error message", the exact phrasing the pin block below it says was disowned for
inviting the edit that reopens the empty-run hole. It now states they are the denominator
assertion.
