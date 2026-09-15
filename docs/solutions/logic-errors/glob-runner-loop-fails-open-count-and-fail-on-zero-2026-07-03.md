---
title: A glob-driven runner loop passes green when the glob matches nothing — count runs and fail on zero
track: bug
category: logic-errors
module: shared
severity: medium
tags: [bash, shell, glob, nullglob, ci, github-actions, hooks, set-e, fail-open, arithmetic, harness, alternation, corpus-generation]
symptoms: [A CI or gate step that "runs everything matching a glob" goes green having executed zero items after a rename or relocation, Step log shows none of the per-item markers yet the step exits 0, An existence guard with continue silently converts an unmatched literal glob pattern into "nothing to do", A glob runner reports a healthy non-zero count while a specific fixture you believe it covers has never been in its namespace, A file that looks like part of a suite is never named by any runner and its numbers drift into prose nobody executes, A deny check's alternation has one branch with a corpus row and the rest have none while every pin check stays green, A corpus row count or membership manifest is unchanged after deleting one branch from a multi-branch regex the gate matches on]
applies_to: [.claude/hooks/**, scripts/**/*.sh, .github/workflows/*.yml, .husky/**]
created: '2026-07-03'
last_updated: '2026-09-14'
---

# A glob-driven runner loop passes green when the glob matches nothing — count runs and fail on zero

## Problem

PR #495 replaced CI's five hand-listed hook-test steps with a glob loop
(`for t in .claude/hooks/test-*.sh`). With `nullglob` unset (bash default), an unmatched
glob stays a literal string; the `[ -f "$t" ] || continue` guard skips it; the loop ends;
the step exits 0. If the hook tests are ever renamed, relocated, or the directory dropped,
the entire 15-test suite silently vanishes from CI while the required check stays green —
the exact silent-coverage-loss class the loop was introduced to prevent. The old
hand-listed steps failed loudly (exit 127) on a missing file; the glob form removed that
invariant.

## Symptoms

- A "runs everything matching X" gate goes green with no per-item output in its log.
- Coverage loss is only discovered later, when a hook regression ships that the suite
  would have caught.

## Root Cause

Two composed defaults fail open: bash leaves an unmatched glob as literal text instead of
an empty list, and the existence guard turns "nothing matched" into "nothing to do". A
zero-iteration loop is indistinguishable from a fully-passing run unless something counts.
Same family as probes that signal absence by empty output: absence of work and absence of
the work-source share one success channel.

## Solution

Count executed items and fail the step when the count is zero (or below a known floor):

```bash
ran=0
for t in .claude/hooks/test-*.sh; do
  [ -f "$t" ] || continue
  echo "▶ $t"
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_COMMON_DIR bash "$t" || exit 1
  ran=$((ran+1))
done
if [ "$ran" -eq 0 ]; then
  echo "::error::.claude/hooks/test-*.sh matched no files — hook self-test suite did not run"
  exit 1
fi
echo "✓ $ran hook self-tests passed"
```

**Counter trap:** increment with `ran=$((ran+1))`, never `((ran++))`. Arithmetic commands
return non-zero when the expression evaluates to 0, and `((ran++))` post-increment yields
the pre-increment value — so at `ran=0` it exits 1, and under `set -e` (GitHub Actions'
default `run:` shell) it kills the step on the very first iteration. An assignment with
arithmetic expansion always exits 0. Verified on bash 3.2 (macOS) and 5.2.37 (the
ubuntu-latest runner): happy path exit 0, empty glob exit 1 with the error line, mid-loop
test failure fail-fasts before the guard.

## The zero-count guard's blind spot: a non-zero count proves the RUNNER ran, not that YOUR file was in it (2026-09-07)

The guard above answers "did the loop execute anything?" It cannot answer "did it execute
the thing I care about?" — and those come apart the moment a file that *belongs* to a suite
is not **named** by the glob.

`.claude/hooks/repro-outward-cli-corpus.sh` is the executable ground truth for the
outward-CLI security guard: 427 adversarial constructions x 4 execution paths. Its filename
does not match `test-*.sh`, so it was never a candidate. `scripts/run-hook-tests.sh` ran, hit
34 files, printed `✓ 34 hook self-tests passed`, and satisfied the zero-count guard on every
push for months — while the corpus executed **nowhere**, in CI or locally. Worse, the corpus
had no pin of its own: it printed three totals and exited `0` under any drift. Three of the
twelve confirmed findings in one security review were stale numbers in that file's own prose,
describing a program nothing ran.

**The count guard was working perfectly and was never going to see this.** `34` is not `0`, and
even a known-minimum floor of `30` would have passed. A membership question cannot be answered
by a cardinality assertion — the same reason a pinned total of "31 gaps" stays green when one
gap closes and a different one opens.

Two distinct assertions, and a suite needs both:

| Question | Assertion | Catches |
| --- | --- | --- |
| Did the runner run? | count > 0 (or ≥ floor) | rename, relocation, dropped directory |
| Did it run *this*? | the file is named, or its own pin fails | a file that was never a candidate |

**What to do instead.** For a fixture deliberately kept outside the suite's glob — here for a
real reason, the corpus is ~2m10s and the whole 34-test suite is ~2m18s, so folding it into the
per-push gate would roughly double it — the runner cannot be the thing that guarantees it runs.
Give it (a) its own named invocation, and (b) its own self-contained pin, so that running it
without checking it is impossible:

```bash
# .github/workflows/ci.yml — named, always-on, no path filter
# (a path-filtered job reports "skipped", which is a permanently-pending required check)
- name: Guard corpus + pin
  run: bash .claude/hooks/repro-outward-cli-corpus.sh   # exits 1 on drift
```

And pin **membership, not just totals** — the manifests must be collected in the *same branch*
that increments the counter, so a count and its ID list cannot encode different definitions.

**Then go one step further, because membership is itself a summary.** A manifest of bare IDs
records one OR-collapsed bit per row ("dirty on some path"), and that bit cannot express a row
getting *worse inside its own category*. The corpus above evaluates each construction on four
execution paths; a row already dirty on one path that degrades to three keeps identical
membership *and* identical totals. That is not hypothetical — it is what the file's own
round-3 correction records, and the first version of this pin cited that very incident as proof
its mechanism worked while being unable to catch it. Pin the **components**, not the OR:

```bash
# not:  DIRTY_IDS+=("$id")
DIRTY_IDS+=("$id p=$p j=$j l=$l a=$a")
```

Rule of thumb: if a check reduces N observations to one boolean, the pin should store the N.

**And add at least one assertion the bump itself cannot silence.** Every pin above compares a
run against numbers a human edits, so "re-pin to whatever it emits now" turns them all green —
including a bump that is laundering a regression. An assertion over the run's *internal*
consistency has no such knob. Here that is "the precise-gap set is a subset of the all-path
dirty set": narrow the collection condition and re-pin the totals and manifests to match, and
the count and membership checks go green while the subset check stays red.
Verified by mutation: renaming one gapping row's ID left `rows=427 precise-path gaps=31
all-path gaps=164` — every total identical to the pin — and only the per-ID `comm` diff went
red. A count-only pin is **green** on that mutation.

**Last step: an OUTCOME is not a CAUSE.** Everything above pins *what the run decided* — how
many, which ones, on which paths. None of it records *why*. In a gate with several branches that
produce the same outcome, a refactor can move a row from the branch meant to protect it onto an
incidental one, and every count, every membership set and every per-path tuple stays
byte-identical. The corpus above documents three rows that already deny for a reason unrelated to
the mechanism their name implies, each with a note saying to read the attribution and never the
verdict alone — so the file was carrying, in prose, the reason not to trust its own pin.

If the gate can say *why*, pin the why:

```bash
# in the SAME branch that records the verdict, not a second pass:
if [ "$p" = DENY ]; then DENY_ATTRIB+=("$id : $(reason precise "$cmd")"); fi
```

Verified by mutation, and the mutation is the one to reach for in this class: find two branches
that both produce the same outcome and change which one wins. Deferring one deny to another deny
three lines below it cannot move any verdict — so all four of `rows`, both gap totals, both
manifests and the subset invariant stayed green, 0 of 427x4 verdict cells changed, and seven rows
silently changed which check was protecting them. Only the attribution list went red.

Two things made it nearly free, and both generalise:

- **Collect in the loop that already has the data.** The attribution section had been re-walking
  the rows and re-invoking the gate 427 times purely to re-derive a value the main loop already
  held. Capturing there removed those invocations: the run got ~25% FASTER (127-138s -> 99-103s)
  while gaining a pin. "Pinning more costs more" is worth measuring before believing.
- **Print the manifest, then pin what you printed.** The gate's own output section IS the pinned
  block now, so regenerating the pin is a copy rather than a transcription.

**Then notice what a pin over ROWS still cannot see: a BRANCH with no rows.** Attribution
catches a row moving between checks. It has nothing to say about a check no row is attributed to
— there is no row to move, so the branch can be deleted and every count, every membership set,
every per-path tuple and every attribution string stays byte-identical. Measured, not supposed:
neutering three such branches in the gate above produced `exit 0` with **zero** diff lines while
five real commands flipped from denied to allowed.

Adding rows closes today's hole and nothing else. The durable form asserts **coverage of the
emitters**, read out of the source rather than out of a run:

```bash
# every message the gate can EMIT, extracted exactly the way a live decision is
ACTUAL_EMIT_SITES=$(grep -oE 'deny "prefix: .*' "$GATE" | sed -E 's/^.*prefix: //; s/ suffix.*//' | ...)
# must each be reached by a row, or named in an exempt list WITH ITS REASON
```

Validate the extractor by set-comparison before trusting it — every fingerprint the run reaches
must match a source-derived site exactly, with no leftovers on either side. And keep the exempt
list explicit: "unreachable" is a claim that needs a reason written next to it, and an exempt
list is how someone will eventually try to make a red gate green.

**Locale and shell matter for anything pinned that must agree between a dev box and the runner** —
and this is broader than it first looks. It is not only the ORDER of the lines:

- **Sort both sides with `LC_ALL=C`** (glibc's UTF-8 collation ignores `-`, so `flagadjfd-*` and
  `flagadjfp-*` interleave differently).
- **Force the same collation on `comm`, not just on `sort`.** `comm` is a merge that assumes its
  inputs are ordered the way *it* compares; GNU comm compares with the locale's collation. Feeding
  it C-sorted input under a UTF-8 locale lets the merge desync and report lines as unique-to-each
  that are present in both. Forcing the sort and not the comparison closes half the divergence.
- **The CONTENT of a pinned line can be locale-dependent too.** `cut -c` counts *characters* under
  a UTF-8 locale on BSD and *bytes* under `LC_ALL=C`, and GNU coreutils chooses again. A pinned
  fingerprint truncated with `cut -c1-72` from a message containing an em-dash before column 72
  came out 74 bytes on one locale and 72 on another — the *same tree, same gate, different pin*.
  Harmless for as long as nothing compared those strings; a wedged required check the moment
  something did. A pin must be a function of the thing under test, not of the environment reading
  it: force byte semantics, and REGENERATE the manifest from a run rather than hand-editing the
  lines that moved.
- **Guard empty-array expansion**, because macOS bash 3.2 errors on `"${arr[@]}"` for an empty
  array under `set -u` while bash 5 does not.
- **Scope the locale forcing to your own text handling.** If the harness invokes the thing under
  test as a subprocess, an exported `LC_ALL` reaches it and can change the very behaviour being
  measured. Prefix the individual tools, do not export.

**Then notice what emitter-coverage itself cannot see: a BRANCH INSIDE one regex with no row
(2026-09-14).** `_pin_sites` proves every deny MESSAGE the gate can emit is reached by some row.
A single check is not one message, though — most deny sites are an alternation,
`(up|deploy|redeploy|restart|down|delete|remove|rm|run)`, and `_pin_sites` is satisfied the
moment ANY ONE branch has a row. The other eight can be narrowed out invisibly, because a
sibling branch still reaches the identical message: the count holds, the membership manifests
hold, the per-path tuples hold, attribution holds (a DIFFERENT branch of the SAME check is still
what fires), and `_pin_sites` holds (the message is still reached) — five independent checks,
all blind to the same deletion, for the same reason they were each blind to the rung above it:
they observe the SET OF ROWS THAT EXIST, and a branch with no row is not a member of that set to
begin with.

Measured on `.claude/hooks/repro-outward-cli-corpus.sh`, 2026-09-14: 4 command-position deny
regexes span 18 alternation branches between them, of which only 5 had a row — `railway up`
(1 of 9 branches), `eas update` (1 of 3), the `railway variable|variables|vars|var set/delete`
family (**2** of 4), and `railway service delete` (1 of 2). That leaves 18 − 5 = 13 branches
with no row, including `railway run`, which the gate's own message calls
as dangerous as `railway up`
("executes an arbitrary command with the LIVE service env, incl. the production DATABASE_URL").
Deleting `run` from that alternation in a scratch guard copy and running the then-current,
602-row corpus against it: **0 of the 602 rows moved on any of the 4 execution paths** — the
exact "exit 0, zero diff lines" shape the branch-with-no-row incident above already produced one
level up, reproduced one level down inside a single check.

The fix is the SAME durable form, one level deeper — read the alternation out of the source
instead of hand-listing it, so the check self-updates instead of needing to be remembered:

```bash
# EXACTLY one line must define this alternation, or the extraction itself is wrong
hit=$(grep -oE 'railway\$\{_OUT_SEP\}\([a-z|]+\)\$\{_OUT_POS_SUFFIX\}' "$GATE")
[ "$(grep -c . <<< "$hit")" -eq 1 ] || { echo "FATAL: pattern matched $(grep -c . <<< "$hit") lines, expected 1" >&2; exit 1; }
IFS='|' read -ra BRANCHES <<< "$(sed -E 's/^railway\$\{_OUT_SEP\}\(//; s/\)\$\{_OUT_POS_SUFFIX\}$//' <<< "$hit")"
for v in "${BRANCHES[@]}"; do add "site-$v" DENY "railway $v"; done   # one row per branch, not one row for the site
```

Two things about this shape are worth being deliberate about:

- **The extraction's OWN failure mode must be loud, and it must be a bare statement.** `$(fn)`
  suspends `errexit` for everything inside `fn` (see the locale section above and the general
  rule this doc already carries), so an `exit 1` written inside a function that is itself called
  as `x=$(fn)` never reaches the top level — it prints to stderr and the caller receives an empty
  string, silently generating zero rows for that family while the corpus still reports a clean
  run. Call the extractor bare (`_alt_or_die '...'; ALT=$(sed ... <<< "$_ALT_HIT")` — two
  statements, not one), so a broken pattern kills the whole run instead of degrading to the exact
  silent-empty-family shape this file opened with.
- **In ordinary same-commit operation, the failure signature this produces is a ROW-COUNT
  drift, not a verdict flip — and that is a WEAKER red than it first sounds, not a stronger
  one.** Because extraction re-reads whichever guard file it is colocated with, a branch
  removed from the real guard also vanishes from the corpus's own generated row set —
  `EXPECTED_ROWS` reds and the membership manifest shows `-site-run` REMOVED, rather than an
  existing `site-run` row flipping DENY→ALLOW. Verified by mutation: running the (now
  branch-aware) corpus, unmodified, against a guard copy with `run` deleted from the
  alternation produced `rows is 622, expected 623` and `-siterailverb-run : ...` in the
  membership diff, exit 1. That IS a required, un-silenceable pin failure — but it is the
  SAME shape a typo in the extraction pattern produces, and "the count moved, bump the pin"
  is a more attractive rubber-stamp for a reviewer than a specific command going from denied
  to allowed would be. Do not describe it as the stronger signal; say what it actually is.
  **The genuine verdict-flip is a different, decoupled test**, needed to show the row-based
  mechanism itself is sound rather than assume it: hold row GENERATION on the real (unmutated)
  guard — so `siterailverb-run` still exists as a row — while pointing ONLY precise-path
  verdict-testing at the mutant. That produced `precise-path gaps is 32, expected 31` with
  `+siterailverb-run` (want DENY, got ALLOW) in the gap manifest, and `-siterailverb-run`
  dropping out of attribution because it stopped denying — a genuine DENY→ALLOW gap on an
  EXISTING row, the semantic signal a hand-written row would give directly. It only requires
  this decoupling because generation and testing share one guard file in real CI; that is not
  a workaround, it is the honest way to test the mechanism separately from the coincidence
  that same-commit operation currently keeps them together. A negative control on the SAME
  mutation against the PRE-fix, 602-row corpus (no per-branch rows yet) confirmed 0 mismatches
  across the 602 existing rows first — the same before/after pairing PR #935's `_pin_sites`
  incident used.

**Scope this closes, and scope it does not.** This closes exactly the branches enumerable as a
flat `(a|b|c)` alternation next to `${_OUT_SEP}`/`${_OUT_POS_PREFIX}`. Counted at the source
rather than estimated: **ten such regex lines here, of which four are extracted** — the six left
hand-listed are the two `eas` site-verb regexes, the two OTA-script regexes, `GH_MUTATING_RE` and
`GH_PR_CREATE_RE`. An earlier revision of this sentence read "four such regexes here", which
silently equated _extracted_ with _extractable_ and hid six candidates from every future reader —
and this file is auto-injected on `.claude/hooks/**` edits, so a wrong figure here propagates.
It does not extend to checks shaped some other way (an interior-redirect scan, a flag-adjacent
regex, a decoy-clause union) — those genuinely are not branch lists, and
building a branch-style extractor for each of THEIR shapes is the "enumerate every mechanism x
every branch" cross product a corpus this size cannot afford. **A shared building block's OWN literal branch list is in scope too**, not just alternations
adjacent to one. The census above is scoped to alternations sitting next to
`${_OUT_SEP}`/`${_OUT_POS_PREFIX}`, which excludes `_OUT_POS_PREFIX`'s own 11 command-prefix
literals — and those are individually deletable: removing `nohup` alone was measured to open
four deny families (eas update, railway up, npm publish, gh api -X POST) while the corpus
stayed byte-identical. A group qualifies if ANY branch is a deletable literal; "every branch
is a literal" excludes the mixed shape by construction. Nor does it cover narrowing that is
not branch deletion — tightening `${_OUT_SEP}` itself, or narrowing a character class inside one
branch rather than removing the branch whole. Name what remains in the pin's own residual prose
rather than letting the closed instance read as though the whole class closed with it.

## Prevention

- Any gate loop of the shape "run everything matching `<glob>`" needs a floor assertion —
  fail on zero at minimum; a known-minimum count is stronger.
- **A floor is still only a cardinality assertion.** Before trusting a glob runner to cover a
  file, check that the file's NAME matches the glob — `ls <glob>` and look for it. A suite's
  green count is not evidence of any particular member. If the file is deliberately outside the
  glob, it needs its own named invocation and its own pin.
- When replacing hand-listed invocations with a glob (to kill membership drift), notice
  the invariant the hand-list gave for free: each named file's existence was asserted by
  the failing exit of a missing file. Re-establish it explicitly.
- **Ask what the pin is blind to, and write the answer down where the pin is defined.** Each
  rung above was found by someone asking that about the rung below it. A residual list that
  names one residual is worth checking: the one it omits is usually the live one.
- **If a check reduces N observations to one boolean, pin the N — and if it can report WHY it
  decided, pin that too.** A pin over outcomes cannot see a reroute between two branches that
  produce the same outcome. Mutate accordingly: the sharpest mutation in this class is one that
  provably cannot change any outcome.
- **A pin's value is a function of two things, and only one of them is under test.** Before
  trusting a pinned string, ask what produced it — truncation width, sort order, collation, tool
  version, padding. Anything the environment can move belongs nailed down before the pin becomes
  a required check, because at that point a portability defect is not a red test, it is a blocked
  repository.
- Both callers now single-source the loop through `scripts/run-hook-tests.sh` (extraction
  landed 2026-07-03), so this guard is carried to `scripts/preflight.sh` full mode and CI
  alike — there is no longer a twin loop to drift.
- **A regex is not one thing to cover — its alternation is a set of things.** "Every deny site
  has a row" and "every branch of every deny site's alternation has a row" are different claims;
  only the second one survives someone narrowing a sibling branch out. When a corpus adds
  coverage for a check shaped as `(a|b|c)`, generate one row per branch from the check's own
  source text, not one row for the check.
- **Prefer letting the check self-update over remembering to update it.** Extracting the branch
  list from the guard's live source (rather than transcribing it into the corpus by hand) means a
  branch added later grows the row count and reds the pin on its own; a branch removed shrinks it
  the same way. Guard the extraction itself with a match-count assertion (`exit 1` on anything but
  exactly one match, called as a bare statement so the exit actually propagates) — an extractor
  that silently matches zero lines is the same failure this whole file is about, one layer deeper.

## Related Files

- `scripts/run-hook-tests.sh` — single source for the loop, counter, and zero-count guard (both callers invoke it)
- `.claude/hooks/repro-outward-cli-corpus.sh` — `_alt_or_die` + the "DENY-SITE COVERAGE,
  ALTERNATION BRANCHES" axis; extracts each alternation from `guard-outward-cli.sh`'s own source
  and generates one row per branch
- `todos/archive/P2-2026-09-08-corpus-covers-deny-sites-but-not-their-alternation-branches.md` —
  measured the 13 uncovered branches, the mutation evidence, and the negative control this rung
  is built from
- `.github/workflows/ci.yml` — "Hook self-tests" step calls `scripts/run-hook-tests.sh`
- `scripts/preflight.sh` — full mode calls `scripts/run-hook-tests.sh` (now guarded too, no longer fails open)
- `.claude/hooks/repro-outward-cli-corpus.sh` — the fixture the glob never named; now carries its own
  pin (rows, two gap totals, and a per-ID manifest for each) and exits 1 on drift
- `.github/workflows/ci.yml` — `outward-cli-corpus` job, the named always-on invocation for it

## See Also

- [empty probe output needs exit-code check](empty-probe-output-needs-exit-code-check-2026-07-02.md) — same fail-open family: absence and failure sharing one channel
- [pipefail grep condition fails open via SIGPIPE](pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md) — another silent shell fail-open in the same toolchain
- [A verification that scans ZERO inputs is green and meaningless](../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md) — later incident of the same rule (macOS /var symlink variant); assert the count, not just the exit code
- [A summary count cannot express a row getting strictly worse](../code-quality/summary-count-cannot-express-a-row-getting-strictly-worse-2026-09-06.md) — the same count-vs-membership gap one level down: pin the per-ID set, diff with `comm`, never subtract totals
- [bash counts parentheses THROUGH a quoted heredoc body inside $( )](../runtime-errors/heredoc-in-command-substitution-counts-parens-2026-09-08.md) — how a 356-line generated manifest kills the script at parse time, found building the attribution pin above
- [A fixture stops guarding the moment you fix the defect it documents](../conventions/fixture-stops-guarding-when-its-defect-is-fixed-2026-08-05.md) — the other way a fixture quietly stops carrying signal
