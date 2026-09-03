---
title: "A shared command-position anchor's opener/closer character classes must cover every REAL bash command-position boundary, not just the operators the original author enumerated"
track: bug
category: logic-errors
tags: [harness, security, shell-quoting, false-negative, regex]
module: server
applies_to: [".claude/hooks/**"]
symptoms: ["A quote-aware command-position matcher (`${_PREFIX}verb${_SUFFIX}` shaped) fails to detect a real, executing invocation of the gated verb", "The SAME verb, unwrapped, is correctly detected — isolating the gap to the anchor's boundary character classes, not the verb pattern itself", "A brace-grouped ({ verb; }), backtick-substituted (`verb`), or !-prefixed (! verb) form of the command is silently ALLOWED by a blocking deny gate", "A verb with no whitespace before the next separator (verb;date) is silently ALLOWED even though a spaced form (verb ;date) is correctly DENIED", "A sibling anchor in the same codebase (e.g. a guard-local one) already covers the missing boundary characters, proving the gap is an under-scoped port, not a fundamental limitation"]
created: 2026-08-28
last_updated: '2026-09-02'
severity: high
---

# A shared command-position anchor's opener/closer classes must cover every REAL bash command-position boundary

## Problem

`.claude/hooks/lib/cmd-detect.sh`'s shared `_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX` — the
anchor every `cmd_is_git*`/`cmd_is_gh_pr_create` matcher wraps its verb pattern in —
only recognized four operators as valid command-position openers (`;`, `&`, `|`, `(`)
and two closers (whitespace, `)`). Real bash opens a command position after several
more characters this class omitted: `{` (a brace-group `{ ...; }` executes its body in
the **current shell**, no subshell), a backtick (a command-substitution span **always**
executes its contents, regardless of what's around it), and `!` (negates a pipeline's
exit status without preventing it from running). The closer side had the mirror gap:
`;`/`&`/`|`/backtick/`{`/`}` immediately after a verb (no trailing whitespace) were not
recognized as valid boundaries either, so `git commit;date` (no space before `;`) was
invisible while `git commit ;date` (with a space) was correctly caught.

## Symptoms

- `cmd_is_git_commit '{ git commit -m x; }'` → MISSED (control `git commit -m x` →
  DETECTED).
- `` cmd_is_git_commit '`git commit -m x`' `` → MISSED.
- `cmd_is_git_commit '! git commit -m x'` → MISSED.
- `cmd_is_gh_pr_create '{ gh pr create --fill; }'` → MISSED.
- `` cmd_is_gh_pr_create '`gh pr create --fill`' `` → MISSED.
- `cmd_is_git_commit 'git commit;date'` (no space before `;`) → MISSED (control with a
  space → DETECTED).

Every genuinely-executing form above ALLOWED through `pr-preflight-guard.sh` (no
preflight stamp demanded) and `branch-preflight.sh` (no detached-HEAD data-loss deny) —
both are blocking gates.

## Root Cause

The anchor's character classes were written against the operators the original author
enumerated when the shared lib was ported from three hooks' independent quote-strip
regexes (2026-07-18), not against bash's actual command-position grammar. A sibling
anchor in the SAME file, `guard-outward-cli.sh`'s `_OUT_POS_PREFIX`/`_OUT_POS_SUFFIX`,
already had the wider opener treatment (`{`, backtick, `!`) from its own earlier
widening — proving this was an under-scoped port of the pattern into
`lib/cmd-detect.sh`, not a fundamental parsing limitation. The renderer feeding the
anchor (`cmd_words`) was already correct — it neutralizes `{`, `}`, `!`, and backtick
INSIDE a quoted span to a placeholder, so a quoted mention of these characters was never
the gap. The gap was entirely in what the anchor, applied to the renderer's OUTPUT,
was willing to recognize as a real boundary.

## Solution

Widen both character classes to match the full real-bash command-position grammar:

```bash
_CMD_POS_PREFIX='(^|[;&|(`{!])[[:space:]]*(([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*|env|command|builtin|exec|nohup|setsid)[[:space:]]+)*'
_CMD_POS_SUFFIX='([[:space:]]|[);&|`{}]|$)'
```

The suffix's `{`/`}` are wider than the sibling `_OUT_POS_SUFFIX` (which has backtick
but not `{`/`}`) — a deliberate AC-driven choice for defense-in-depth, not a live gap:
bash requires a preceding `;`/newline before a REAL brace-group close, so `}` can never
sit directly after a matched verb in practice, but including it costs nothing and closes
the class symmetrically with the opener side.

**Known accepted residual:** combining `{` (opener) with `}` (closer) also satisfies a
bash parameter expansion whose variable name equals a matched verb, e.g. `${git}` or
`${git commit}`, even though the expansion merely reads a variable — it does not invoke
anything by itself, and `${verb subcommand}` is not even valid parameter-expansion
syntax to begin with, so this never corresponds to a real invocation. This is **not**
limited to `cmd_is_git` (an initial writeup of this fix claimed it was — a second review
round falsified that by reproducing the same false match on `cmd_is_git_commit`,
`cmd_is_git_head_mover`, and `cmd_is_gh_pr_create` too; the anchor matches rendered TEXT,
not valid bash syntax, so every anchored matcher is equally susceptible). It stays
harmless for every DENY-shaped consumer (`pr-preflight-guard.sh`, `branch-preflight.sh`
check 1 — over-triggering on non-executing text is the safe direction for a deny gate)
and for `core-bare-guard.sh`'s `cmd_is_git` (advisory-only, always exits 0). One
consumer is neither: `drift-detect-update.sh`'s `cmd_is_git_head_mover` call WRITES a
HEAD baseline on a match rather than denying, so a spurious match there is SUPPRESSIVE
(can narrow the window in which a genuinely external drift would be noticed) —
low-severity since it requires literal `${verb subcommand}`-shaped text with no real
invocation, but stated explicitly rather than folded into "every consumer is safe."

A second, related lesson surfaced by the SAME review round on a related regex in the
same file: `cmd_git_branch_create_segment`'s own terminator class (used by
`cmd_is_git_branch_create` and `branch-preflight.sh`'s start-point extraction) is a
DIFFERENT regex from `_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX`, answering a different
question — it closes a multi-token ARGUMENT span (the branch/ref name), not a
single-token VERB boundary. A first-attempt fix widened it by literally copying
`_CMD_POS_SUFFIX`'s new closer set wholesale ("stay in sync" framing), which correctly
added backtick (never valid unquoted ref-name content) but ALSO added `{`/`}` — which
CAN be valid unquoted ref-name content (`git check-ref-format --branch 'foo{bar}'` exits
0), so a real branch name like `feature/six{seven}` got truncated, silently dropping a
real explicit start-point and flipping the consuming loop's decision the other way. The
fix required DERIVING each character's membership independently ("can this character
ever be real unquoted payload for THIS span" — no for backtick, yes for `{`/`}`) rather
than assuming two regexes serving related but distinct purposes should mirror each
other's character class just because they widened in the same commit.

## Prevention

When a shared regex-anchor is ported from N independent call sites (or split into a
shared lib), audit it against the FULL real grammar of the thing it's anchoring on —
not just the specific operators the seed implementation happened to enumerate. A sibling
anchor doing the same job with a wider character class (as `_OUT_POS_PREFIX`/
`_OUT_POS_SUFFIX` were here) is a free audit: diff the two classes explicitly and
justify every character present in one but not the other, rather than assuming the
narrower one was scoped deliberately. Before shipping a widening, enumerate its full
downstream consumer list and check whether each is a BLOCKING gate (a false positive
there causes over-denial, a real but lower-severity regression), ADVISORY/self-healing
(a false positive there is free), or a BASELINE-WRITING consumer (a false positive there
can be suppressive, not safe-direction) — the same asymmetry applies in the other
direction to under-widening a DENY-shaped anchor, which is the security-relevant failure
this fix closes. And when a widening touches more than one regex in the same commit,
"mirror the sibling's character class" is the wrong default — each regex answers its own
question about what a boundary character means for ITS span, and two regexes that widen
together are not automatically the same regex.

## Unresolved (surfaced, not fixed — out of scope)

~~The SAME review round found `cmd_git_branch_create_segment`'s terminator class also
omits `<`, `>`, and `#`~~ — **RESOLVED 2026-09-01**, and the fix earned two new lessons of
its own. See "Fixing the `<`/`>`/`#` gap taught the rule twice more" below.

**`_CMD_POS_PREFIX` still omits shell-keyword command positions** (`if`/`then`,
`for`/`do`, `while`/`do`, `case`, etc.) — found by `security-auditor` during PR #874's
own review round (2026-08-29), verified live against the actual hook: the bare
`gh pr create --fill` correctly denies via `pr-preflight-guard.sh`, but
`if true; then gh pr create --fill; fi` emits no decision object at all (silent allow,
no fresh-stamp demand) — the same bypass CLASS this fix set out to close, just a
different opener shape. Explicitly disclosed in the anchor's own header comment
(`_CMD_POS_PREFIX`'s definition, `.claude/hooks/lib/cmd-detect.sh:84-86`) and out of this
PR's Scope Contract, so it did not block the PR's verdict. `guard-outward-cli.sh`'s
sibling `_OUT_POS_PREFIX` already absorbs `then|do|else|elif|time` as runner words — the
lib's shared anchor does not. Not filed as a todo (High-severity Deferred Item Todos
policy: surface for a human decision, don't auto-file) — flag for the user to decide
whether this warrants its own dedicated fix, folding into a future widening pass, or
accepting as a known residual.

**`branch-preflight.sh`'s lib-unsourceable fallback (`GIT_COMMIT_RE`/`COMPOUND_COMMIT_RE`)
was found narrower than the primary path for these same brace/backtick/bang shapes** —
found by `code-reviewer` on the same PR #874 review round, reproduced live under the
`NOLIB` harness (`test-branch-preflight.sh` Test 10's pattern): a brace-grouped,
backtick-substituted, or `!`-prefixed detached-HEAD commit was silently allowed through
`branch-preflight.sh`'s Check 1 — a BLOCKING gate — when the lib was unsourceable. Unlike
the two gaps above, this one **was fixed** as part of the same review-repair cycle rather
than left unresolved: both fallback regexes now recognize `` ` ``/`{`/`!` as valid
openers, with a two-sided regression test (Test 10b, confirmed RED against the pre-fix
regex and GREEN after). See `todos/P3-2026-08-28-cmd-pos-anchor-widening-stale-comments.md`'s
Updates for the full account — that todo's own AC had mischaracterized this gap as a
"deliberate" divergence needing only a comment, which this fix and the todo's correction
both supersede.

**A second, independent review round (`code-reviewer` + `security-auditor`, 2026-08-29)
found the fallback still short of parity with the primary path**, beyond the
brace/backtick/bang shapes already closed above: a bare `(` subshell, a newline-separated
compound (`[[ =~ ]]` has no per-line `^` the way the primary path's `grep -E` does), a
runner-word wrapper (`env`/`command`/`exec`/etc.), and, on `COMPOUND_COMMIT_RE`
specifically, a missing `-c key=value` group. All four confirmed pre-existing (identical
against the merge-base copy of the file) and live-reproduced under the `NOLIB` harness —
same risk class and same "lib unsourceable" precondition as the already-accepted `|` gap.
Unlike the brace/backtick/bang fix, these were left as a documented residual rather than
closed in-PR (out of `#874`'s Scope Contract) — the fallback's comment now names all five
gaps explicitly rather than implying `|` is the only one. Tracked as a Medium-severity
follow-up todo (see `todos/`) rather than fixed here.

**`cmd_bare`/`cmd_words`'s quote-state scanner misses a live nested command
substitution inside double quotes** — a double-quoted string containing a backtick span
(e.g. an `echo` whose argument reads `note` followed by a backtick-wrapped
`git commit -m pwned`) actually executes that backtick span (bash evaluates a
backtick command substitution regardless of the enclosing double quotes), but the
scanner blanks the whole double-quote span, so every anchored matcher
(`cmd_is_git_commit`, `cmd_is_gh_pr_create`, `cmd_is_git_head_mover`, `cmd_is_git`)
misses it. Found by `code-reviewer` during this same second review round;
confirmed pre-existing (identical false negative against the merge-base copy) and outside
this fix's scope — `cmd_bare`/`cmd_words`'s awk engine is untouched by this PR. Already
tracked: `todos/P1-2026-08-17-quoted-command-substitution-inert.md` (backlog, high
priority) documents this exact mechanism with near-identical repro shapes.

## Fixing the `<`/`>`/`#` gap taught the rule twice more (2026-09-01)

The gap in Unresolved above was closed on 2026-09-01. Closing it produced **two deny→allow
regressions in the very gate being hardened**, both caught by review rather than by tests,
and both are the same rule this document already states — arriving in shapes that did not
look like a character class at all.

### 1. Injecting a terminator at a computed offset IS a class widening

The first fix avoided widening the terminator class (having read the `{`/`}` lesson above)
and instead rewrote a redirect to `;`, reasoning: *"the extraction regex itself is unchanged,
so the brace/backtick reasoning above it keeps holding."* That sentence is false, and it
reads perfectly reasonable, which is why it survived authoring and a self-review.

Bash permits a redirection **anywhere** in a simple command, including between the
subcommand and the create flag:

```bash
$ printf '[%s]' checkout 2>/dev/null -b foo
[checkout][-b][foo]          # a real branch create
```

Rewriting the redirect to `;` produced `checkout ;/dev/null -b foo`. Extraction stopped at
the injected `;` — **before** `-b` — so no create flag was found, `cmd_is_git_branch_create`
returned "not a create", and the check never ran at all. Strictly worse than the leak being
fixed.

**The generalisation:** a terminator does not have to be a literal character in a class to
be a terminator. Anything that *introduces* one — a rewrite, a substitution, a normalisation
pass — widens the class at a computed offset and inherits every hazard above. The correct
mechanism for a token that is not a boundary but noise is to **delete** it, not to terminate
on it.

### 2. A rewrite that depends on quote state must run where quote state still exists

The second fix rewrote a word-start `#` to a terminator, having verified that bash only
treats `#` as a comment at word start. True — but the rewrite ran on `cmd_words` output,
where **quote characters have already been deleted**, and `cmd_words`' `neutral()` set did
not cover `#`, `<`, `>`. So a *quoted* `#` was byte-identical to a real comment by the time
the rewrite saw it, and the greedy `#.*$` discarded the rest of the line — including a later
real create:

```
git commit -m "#123 fix the thing" && git checkout -b feature/x   → NOT DETECTED
```

That is ordinary usage — a commit message beginning with an issue reference. The mirrored
harm also existed: a legal quoted ref name (`git checkout -b foo ">bar"`, and `>bar` passes
`git check-ref-format --branch`) was clipped and lost its start point.

**The generalisation:** before treating a character as syntax, ask *where in the pipeline is
quoting still knowable?* Quote state is destroyed early here by design. Any character that
becomes boundary-significant downstream must be added to `neutral()` **in the same change** —
that set's contract is "everything a quoted span must not be able to emit", so widening what
counts as a boundary without widening `neutral()` breaks its invariant by construction.

### 3. A same-direction suite cannot detect a REMOVED detection

The suite was **833 assertions green over both live bypasses**. The count was accurate and
carried no information, because every new pin placed the redirect *after* the create flag and
every `#` case was trailing-unquoted or mid-word — neither failure mode was representable in
the matrix.

The artefact that finds this class is a **differential**: replay one corpus through the
pre-change and post-change matcher and assert no `DETECTED → NOT-DETECTED` transition. It
found 9 regressions in seconds, and it is the thing that should be built *first* whenever a
matcher's grammar changes, because the invariant being protected is a superset relation, not
a set of examples. Its durable form is a block of detection pins asserting that every
create-shaped command in the corpus is still detected.

### 4. A deletion's stop-set is COUPLED to the downstream terminator class — the opposite of lesson 2 above, ten lines away

Repairing lesson 1 (delete the redirect rather than terminate on it) produced a bigger
regression than the one it fixed: **240 deny→allow transitions over a 2189-input corpus**
(10 redirect forms × 4 unspaced separators × 6 verb-mismatched pairs), against 9 over the
25-input hand-listed corpus used on the original. Both numbers are properties of their
corpora — see clause 4 of the probe convention doc, which this pairing is the evidence for.

The deletion's target word was written `[^[:space:]]*` — excluding only whitespace. So it also
consumed `;`, `&`, `|`, `)` and backtick: exactly the characters the extractor immediately
below uses as its segment boundary. When a redirect ended a clause with **no space** before
the separator, the separator was deleted and the two clauses fused into one segment. The
`case` dispatch then keyed on the merged segment's first verb and never searched for the
second:

```
git checkout main 2>/dev/null;git switch -c foo
  → checkout main  switch -c foo      # one segment; greps for -[bB], finds none
  → NOT a create — though it really creates a branch
```

**The rule: a pass that DELETES text must not consume any character its downstream matcher
needs as a boundary. Its stop-set is the downstream terminator class ∪ whitespace — coupled
by construction, not derived independently.**

And here is the trap worth the entry: that is the **exact opposite** of the coupling in the
Solution section above, which says `_CMD_POS_SUFFIX` and this extractor's terminator "must be
derived independently, not mirrored". Both rules are correct; they govern different pairs.
They sit about ten lines apart in the same function, and the terminator class has already
changed twice (backtick added; `{`/`}` tried and rejected). A maintainer who over-applies the
independence lesson to the deletion pair will desync them and revive the merge silently.
**When one file carries two couplings that run in opposite directions, each must name the
other**, or the more memorable one gets applied to both.

## A "verified inert" claim about `{`/`}` was itself wrong — comma-form brace is EXPANSION, not grouping (2026-09-02)

A comment-accuracy-only todo against `guard-outward-cli.sh`'s OWN `_OUT_POS_SUFFIX`
(the guard-local sibling of `_CMD_POS_SUFFIX` documented above) produced a THIRD instance
of this document's central rule, in a shape sharp enough to record on its own: the fix
under review was itself re-broken by its own corrective comment, twice, before landing.

**Round 1** (executor draft): a comment lumped all four of the lib's extra suffix closers
(`{`, `}`, `<`, `>`) under one "don't sync any of these" verdict. Review found `<`/`>` are
REAL bash redirect operators — a verb glued to a trailing redirect (`update>log`) word-splits
exactly like the spaced form, a live bypass — while `{`/`}` were (at that point) genuinely
believed inert. Split the framing accordingly: `<`/`>` disclosed as a live gap, `{`/`}` kept
as "don't sync, harmless."

**Round 2** (a second review pass, same PR): the "`{`/`}` are inert" half of round 1's split
was ITSELF false. The verification behind it tested exactly one shape — a lone brace span
with no comma or range (`update{42}`) — and confirmed, correctly, that it stays glued as one
bash word. It generalized "inert" from that one case to the whole `{`/`}` character pair. But
`{`/`}` is not one property; it is two, gated by a single distinguishing feature bash actually
checks for — a comma or range inside the braces:

```bash
$ for w in gh pr merge{,x} 42; do printf '[%s]\n' "$w"; done
[gh] [pr] [merge] [mergex] [42]
```

`merge{,x}` is brace **expansion**, not a literal glued suffix — bash expands it to the two
separate words `merge` and `mergex` before the command ever runs, placing a real, standalone
`merge` token in command position. Reproduced live against `guard-outward-cli.sh`:
`gh pr merge{,x} 42`, `npm publish{,x}`, `eas update{,x} ...`, `railway up{,x}` and
`eas build{,x} --auto-submit` were all SILENTLY ALLOWED where the bare/spaced form correctly
denied — the exact same class of bypass this document's `<`/`>`/`#` section above already
describes, found by the SAME mechanism (construct the input, run it, don't reason about the
regex text) that this document's Prevention section already prescribes and that round 1 of
this very review had just failed to apply to its own "inert" claim.

**The generalization**: a character class is not one property just because it is written as
one bracket expression. `{`/`}` alone means three different things to bash depending on
what's inside — a literal character (`foo{bar}`, inert), a compound-command GROUP
(`{ foo; }`, spaced, unrelated construct), and EXPANSION (`foo{a,b}` / `foo{1..3}`, real,
pre-execution word-splitting). A probe that varies "brace present vs. absent" but never
varies "comma present vs. absent" tests only the first meaning and silently assumes the
answer generalizes to the third. The fix that closed this (mirroring the lib's own already-
verified widening): `_OUT_POS_SUFFIX` gained `{`/`}` as closers
(`([[:space:]]|[);&|`]|$)` → `([[:space:]]|[);&|`{}]|$)`), with a two-sided regression test
— RED against the pre-fix regex, GREEN after, confirmed at five call sites (this file's own
`gh pr merge` CLAUSE=, `npm publish`, `eas update`, `railway up`, `eas build
--auto-submit`), plus a negative control on a DIFFERENT, unrelated read-only verb (`eas
whoami{x}`) glued the same no-comma way.

**CORRECTED 2026-09-02 (PR #910 post-merge review) — two claims in the paragraph above
were wrong, not just incomplete:**

1. "confirmed at five separate `_OUT_POS_SUFFIX` call sites" was read (including in this
   document's own PR body and in `guard-outward-cli.sh`'s comments) as covering every
   consumer of the widened suffix. It did not: `GH_API_CLAUSE` —
   `guard-outward-cli.sh`'s `gh api` clause-cut, a SIXTH site gated by the same
   `_OUT_POS_SUFFIX`-family detector — was never migrated and stayed hardcoded to a
   literal `[[:space:]]`. Its sibling `GH_API_RE` (the occurrence counter for the SAME
   check, a few lines above it) WAS migrated, so `gh api{,x} -X POST .../merge` still
   counted as exactly one occurrence, but the clause-cut then matched nothing — an empty
   `$GH_API_CLAUSE` short-circuited the mutating-method scan and the deny never fired.
   Confirmed SILENTLY ALLOWED live (both the comma-brace form and the pre-existing
   backtick-glued form `gh api\`x\` -X POST ...`), by constructing the input and running
   it — not by re-deriving from the regex text — until fixed the same review round that
   found it. This is the SAME bug class this document's own **Occurrence-ambiguity guard
   applied selectively** sibling lesson (linked below) already documents: a detector
   widened without its sibling consumer.
2. The negative control does NOT pin that "the genuinely-inert no-comma case still
   allows" in general — it pins only that a DIFFERENT verb (`whoami`, never matched by the
   `eas update|publish|submit` regex to begin with) stays allowed; mutation-confirmed:
   reverting `_OUT_POS_SUFFIX` to its pre-fix form leaves that one assertion green,
   meaning it is not sensitive to the `{`/`}` widening at all. On the SAME verb, a
   no-comma/no-range glued span (`merge{x}`, `merge{1..3}`) ALSO denies under the shipped
   fix, because `_OUT_POS_SUFFIX` makes no comma/no-comma distinction — any literal `{` is
   now an unconditional boundary character. That shape genuinely stays one bash word and
   never brace-expands (a true fact about bash), but the code does not preserve that
   distinction — deliberate conservatism, not a bug, though several in-code comments
   originally implied the code DID preserve it. Corrected in `guard-outward-cli.sh` and
   `test-guard-outward-cli.sh` the same round.

Per this document's own Prevention section, widening a DENY-only anchor's closer class can
only ever ADD matches, so the DIRECTION was always safe — the defect above was in
COMPLETENESS (one consumer missed), not in the widening itself being unsafe.

**Where this differs from every other lesson in this document**: the earlier sections are
about a widening that was never attempted, or a widening whose collateral damage went
unmeasured. This one is about a CORRECTIVE COMMENT — written specifically to stop a future
reader from mis-syncing an anchor — that asserted a safety property the author had not
actually established, using confident language ("INERT here," "verified") that made the
claim harder to doubt on a second read, not easier. The fix for that failure mode is not
"write more careful prose" — it is the same fix this document already prescribes for the
regex itself: construct the input that would falsify the claim, and run it, before writing
the sentence.

## A clause-cut that DECIDES AN ALLOW is a different risk class from one that decides a DENY — same widening, opposite consequence (2026-09-02, round 3)

Every widening analyzed above — brace/backtick/bang openers, `{`/`}` closers, the round-2
`GH_API_CLAUSE` fix — shares one safety argument, repeated throughout this document: a
DENY-only anchor can only ever ADD matches, so widening its boundary class can only ADD
denies, never remove one. That argument is correct for every check in
`guard-outward-cli.sh` **except one**, and this document itself did not notice the
exception until a PR #910 post-merge review was specifically asked to probe the
false-positive direction of the round-2 fix.

**The mechanism.** A clause-cut built as `${_OUT_POS_SUFFIX}[^;&|]*` is SWALLOWING: it
consumes whichever character closed the verb match, then keeps capturing past it. This is
correct when that character is whitespace — more of the SAME clause legitimately follows
(`merge 42 --auto`). It is wrong when the verb is glued DIRECTLY to a hard
separator/bracket with no argument in between (`merge;`, `merge&`, `merge|`,
`(merge)`) — the suffix consumes the separator itself, and `[^;&|]*` then captures straight
into an UNRELATED, following command, picking up whatever flags THAT command happens to
carry as if they belonged to the first clause.

**Why this was safe everywhere else and dangerous exactly once.** For every other
`_OUT_POS_SUFFIX`-family clause-cut in this file — `GH_API_CLAUSE` (denies on a mutating
`-X`/`--method` found in the clause), `gh_pr_clause_has_repo` (denies on `--repo`/`-R`
found in the clause) — the downstream check DENIES when it finds the flag. An over-captured
clause can only find MORE things to deny on, never fewer: false positives (over-strict),
never false negatives. `guard-outward-cli.sh`'s `gh pr merge` `CLAUSE=` is the ONE
consumer that inverts this: it ALLOWS when it finds `--auto` in the clause (subject to the
`--repo`/`--admin` checks elsewhere). Feed that same over-capture a DECOY `--auto` from an
unrelated, glued-on command, and the direction inverts too — the widening that was
provably safe everywhere else became a working FALSE ALLOW here, on the one check whose
entire purpose is preventing an immediate, non-automerge `gh pr merge`:

```
gh pr merge;curl --auto
gh pr merge&curl --auto
gh pr merge|curl --auto
$(gh pr merge)curl --auto
```

All four were confirmed SILENTLY ALLOWED before this fix (construct-and-run against the
live hook, not regex-reading) — `gh_pr_clause_has_repo`, checked with the analogous glued
shape (`gh pr create;curl --repo evil/evil`), was confirmed NOT vulnerable.

**CORRECTED 2026-09-02 (round 5) — the reason given above for why
`gh_pr_clause_has_repo` is safe was wrong, only its conclusion was right.** An independent
baseline-reviewer SUGGESTION, verified construct-and-run: `gh_pr_clause_has_repo` DOES
over-capture through the identical glued boundary — `grep -oiE "gh[[:space:]]+pr[[:space:]]+($1)[^;&|]*"`
is itself an unbounded, swallowing pattern (no `_OUT_POS_SUFFIX`-family boundary class in
front of `[^;&|]*` at all, so it never stops at `)`/backtick/`{`/`}` either). Verified live:
`$(gh pr create --title x --body y)curl --repo evil/org` correctly DENIES — the decoy
`--repo` from the unrelated glued-on `curl` command IS picked up by the over-capture, exactly
like the merge-clause bug. It is safe not because the capture mechanism differs, but for the
same reason `GH_API_CLAUSE` is safe: the **downstream decision direction** is deny-on-presence,
so an over-captured clause can only find MORE to deny on. Restating the reasoning correctly
matters because a future reader who "fixes" `gh_pr_clause_has_repo`'s pattern shape believing
it lacks a swallow mechanism would be solving a problem that was never the risk — the check
that needs the non-swallowing treatment is identified by its decision direction, not by
which literal pattern shape it happens to use.

**The generalization.** "A DENY-only anchor's widening can only ever add matches" is true
of the ANCHOR — the character class that decides where a clause STARTS and ENDS. It is not
automatically true of what the clause-cut DOES with the text it captures. The moment a
clause's content is read to grant an allow rather than to trigger a deny, the same widening
argument that makes every sibling check safer makes this one check exploitable — the
direction of the downstream decision, not the direction of the widening, is what determines
whether over-capture is safe. Before applying "widening a boundary class can only add
matches" to a NEW clause-cut, check which way ITS OWN downstream decision runs, not just
which way the anchor's character class grew.

**Fix.** A second, non-swallowing suffix variant,
`_OUT_POS_SUFFIX_MERGE_CLAUSE='([[:space:]][^;&|]*|[);&|`{}]|$)'`, defined next to
`_OUT_POS_SUFFIX` in `guard-outward-cli.sh`: continue capturing ONLY after a whitespace
boundary; a hard separator/bracket or end-of-string ends the clause immediately, with
nothing captured past it — this matches real bash command-position semantics exactly (a
verb glued to a hard separator has no arguments of its own; anything after belongs to a
different command or construct). Verified: the sanctioned `gh pr merge --auto` / `gh pr
merge 42 --auto` paths still allow; all four decoy shapes above — three glued hard
separators plus a `$(...)` close-paren, a structurally different construct sharing only
the boundary character class, not the "two commands glued together" mechanism — now deny; the
already-correctly-bounded `gh pr merge 42;curl --auto` (an argument token between verb and
separator) is unaffected by the change. Regression tests:
`test-guard-outward-cli.sh`'s "2026-09-02 FIX (round 3)" block, mutation-tested (RED
against the pre-fix swallowing pattern — exactly the 4 decoy assertions failed, the
sanctioned-allow and already-correct-deny controls unaffected — GREEN after restoring).

**A separate, still-open gap this fix does NOT close.** `_OUT_POS_SUFFIX`'s pre-existing
missing `<`/`>` — disclosed since round 1, still deliberately unfixed here (out of scope) —
is worse than its original "silently allowed where the spaced form denies" description let
on. Re-verified against the merge clause specifically: `gh pr merge>log` (no `--auto` at
all, no decoy, nothing to find) is silently ALLOWED, because `>` glued directly after
`merge` makes the DETECTOR (`GH_MERGE_RE`) itself fail to match — the whole `gh pr merge`
check block never runs, `CLAUSE` is never even computed. This is a DIFFERENT root cause
from the fix above (that one computed a wrong clause from a valid match; this one never
matches at all) and `_OUT_POS_SUFFIX_MERGE_CLAUSE` does not touch it. Still a human
decision, still genuinely out of this repair's scope — but the disclosure now says what it
actually is: a total bypass of this check via one glued character, not a partial one.

**A second, distinct still-open gap found by independent PR #910 review (2026-09-02,
round 4 — disclosure only, deliberately not fixed).** Neither `_OUT_POS_SUFFIX` nor
`_OUT_POS_PREFIX` (nor the new `_OUT_POS_SUFFIX_MERGE_CLAUSE`) treats a bash sigil that
expands to nothing (`$VAR` for an unset/empty `VAR`, `$(...)`/`${...}` whose expansion is
empty) as a command-position boundary. In real bash, word-splitting collapses the glued
verb-plus-vanishing-sigil back into the identical plain-verb token — `eas
update$(true)` and `eas update` run the exact same command — but the guard's regex classes
have no `$` in either the opener or closer alternation, so the per-verb `_RE` detector
(`GH_MERGE_RE`, `GH_API_RE`, the `eas update` / `npm publish` checks, etc.) fails to match
at all at that position: not a wrong-capture like the round-3 swallowing bug, a total
non-match like the `<`/`>` gap above. Independently reproduced and control-verified (paired
deny-then-allow, same invocation) for both sides:

- Suffix: `eas update --branch preview` denies (control); `eas update$(true) --branch
  preview` silently ALLOWS — bash itself confirms the two are identical
  (`bash -c 'set -x; : eas update$(true) --branch preview'` traces to `+ : eas update
  --branch preview`). Also reproduced on `gh pr merge$UNSET_VAR 42`, `npm
  publish$UNSET_VAR_XYZ`, and `gh api$UNSET_VAR_XYZ -X POST repos/o/r/pulls/1/merge`.
- Prefix: `gh pr merge 42` denies (control); `$()gh pr merge 42` silently ALLOWS — bash
  confirms equivalence (`bash -c 'set -x; : $()gh pr merge 42'` traces to `+ : gh pr merge
  42`).

**Why this is disclosed whole, not half-fixed.** The suffix side looks like a one-character
fix (`$` added to the closer class), but the prefix side is not: real bash consumes an
entire balanced `$(...)`/`${...}` sigil with no single boundary byte left behind for a
char-class match — `_OUT_POS_PREFIX` would need a new alternative matching a leading
sigil through to its balanced closer, not a single added character. Landing only the
one-character suffix fix would put `$` inside `_OUT_POS_SUFFIX`'s closer class while
`_OUT_POS_PREFIX` still misses it entirely, and a future reader would reasonably (and
wrongly) infer the `$` class is handled — the exact overclaiming-by-implication defect this
whole repair chain exists to correct. Disclosing the gap whole, on both sides, is more
honest than closing half of it. Root cause pinned in `.claude/hooks/lib/cmd-detect.sh`'s
`cmd_words`, which documents (and preserves) a bare `$` sigil unmodified in `$WORDS`/`$BARE`
— this is a missing character in the anchor classes, not a `$WORDS`-construction defect.
Still a human decision, still out of this repair's scope.

## Round 5 (2026-09-02) — round 3's OWN fix was incomplete: the arg-present case

An independent baseline-reviewer CRITICAL finding on round 3's fix itself, found by
construct-and-run testing rather than trusting round 3's own "all four decoy shapes now
deny" claim — exactly the discipline this whole repair chain exists to enforce, applied to
this chain's own most recent fix.

**The gap.** `_OUT_POS_SUFFIX_MERGE_CLAUSE='([[:space:]][^;&|]*|[);&|`{}]|$)'` (round 3) has
two branches: branch 2 (the zero-argument case — verb glued directly to a hard boundary)
correctly stops at `;`,`&`,`|`,`)`,backtick,`{`,`}`. Branch 1 (the argument-present case —
some argument text between the verb and the boundary) only stopped its continuation capture
at `;`,`&`,`|` — it did NOT match branch 2's own boundary set. The two branches partition
one boundary concept and had silently diverged. Once ANY argument preceded the boundary,
branch 1 fired instead of branch 2, and the swallow reopened for `)`,backtick,`{`,`}`.

**Full 16-shape dimensional sweep** ({zero-arg, arg-present} × {`;`,`&`,`|`,`)`,backtick,`{`,`}`,EOS}),
executed against the live hook, before and after the round-5 fix:

| boundary | zero-arg (before → after) | arg-present (before → after) |
|---|---|---|
| `;` | DENY → DENY | DENY → DENY |
| `&` | DENY → DENY | DENY → DENY |
| `\|` | DENY → DENY | DENY → DENY |
| `)` | DENY → DENY | **ALLOW → DENY** |
| backtick | DENY → DENY | **ALLOW → DENY** |
| `{` | DENY → DENY | **ALLOW → DENY** |
| `}` | DENY → DENY | **ALLOW → DENY** |
| end-of-string | DENY → DENY | DENY → DENY |

Sanctioned `gh pr merge --auto` and `gh pr merge 42 --auto --squash --delete-branch` stayed
ALLOW throughout (both sweeps).

**Not every ALLOW→DENY cell was a live bypass.** `)` and backtick ARE: real bash executes
the command-substitution/backtick subprocess (`gh pr merge 42`) UNCONDITIONALLY, with no
`--auto` reaching it, before the outer glued command runs — confirmed with
`bash -c 'set -x; ...'` tracing and a paired deny control, same methodology as every other
finding in this file. `{`/`}` are NOT live bypasses in this position — verified with
`bash -c 'for w in gh pr merge 42{,x}curl --auto; do printf "[%s]\n" "$w"; done'` →
`[42curl] [42xcurl] [--auto]`, and the analogous bare-`}` form → `[42}curl] [--auto]`: in
both cases `--auto` reaches `gh pr merge` as a genuine, separate argument of the SAME
command; no second command is glued on. They are denied anyway — matching branch 2's
existing `{`/`}` treatment and round 1's established deliberate-conservatism precedent — but
this is fail-safe caution, not a closed exploit.

**False-positive check** (the `cmd_words` quote-neutralization claim, verified end-to-end
through the fixed hook, not assumed from the transform alone):
`gh pr merge 42 --body "fix (#123)" --auto` and
`gh pr merge 42 --auto --body "see {issue} (#123) done"` both stay ALLOWED — quoted
parens/braces inside real argument content never reach this clause-cut as literal boundary
characters.

**Fix.** Branch 1 widened from `[^;&|]*` to `` [^;&|)`{}]* ``, matching branch 2's boundary
set exactly — the fix is "the two branches must agree," not a new mechanism.

**Regression tests and mutation evidence.** 6 new assertions in `test-guard-outward-cli.sh`
("2026-09-02 FIX (round 5)" block): 2 live-bypass denies (close-paren, backtick), 2
conservative-not-exploitable denies (`{`, `}`), 2 false-positive allow controls (quoted
parens/braces in `--body`). Also renamed the round-3 regression-pin test that had overclaimed
its own scope (`"...(arg-token case, already-correct)..."` implied the WHOLE arg-present
class was already correct; it covered only `;`/`&`/`|`) to state its actual scope explicitly.
Mutation-tested: reverting only the round-5 branch-1 widening took the suite from 268/268 to
264 passed/4 failed — exactly the 4 new live/conservative deny assertions went RED (the 2
false-positive allow controls and everything else stayed green); restoring returned 268/268.
`bash scripts/run-hook-tests.sh` re-run green after restoring.

**Also corrected in this round**: the doc's own earlier claim that `gh_pr_clause_has_repo`
"was never at risk of this exact defect... never used the swallowing shape to begin with"
was reasoning-wrong (see the CORRECTED 2026-09-02 (round 5) note above, inline in the
"Why this was safe everywhere else" section) — it DOES over-capture through the identical
glued boundary; it is safe by decision-direction, not by pattern shape.

## Related Files

- `.claude/hooks/lib/cmd-detect.sh` — `_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX`, both widened.
- `.claude/hooks/test-cmd-detect.sh` — regression pins for all six reproduction cases
  plus the `{`/`}` closer, a backtick-as-closer no-args form, and negative controls
  (quoted mentions must stay undetected).
- `.claude/hooks/test-pr-preflight-guard.sh`, `.claude/hooks/test-branch-preflight.sh` —
  end-to-end reproductions through the live blocking hooks.
- `.claude/hooks/core-bare-guard.sh` — one consumer of `cmd_is_git`; confirmed advisory-only.
- `.claude/hooks/drift-detect-update.sh` — the baseline-writing consumer of
  `cmd_is_git_head_mover`; a spurious match here is suppressive, not safe-direction.
- `.claude/hooks/guard-outward-cli.sh` — the reference implementation whose
  `_OUT_POS_PREFIX`/`_OUT_POS_SUFFIX` already had the wider opener treatment this fix
  ports into the shared lib; as of 2026-09-02 also carries the `_OUT_POS_SUFFIX`
  comma-brace-expansion fix described above (its own suffix's `{`/`}` closers), and two
  disclosed-but-unfixed live gaps (`_OUT_POS_SUFFIX` still lacks `<`/`>`;
  `_OUT_POS_PREFIX` still lacks the lib's `_CMD_REDIR` absorption). A later same-day
  PR #910 post-merge review found the initial `{`/`}` fix had missed `GH_API_CLAUSE` (the
  `gh api` clause-cut) — search this file for `GH_API_CLAUSE=` for the fixed line and its
  "FIXED 2026-09-02 (round 2)" comment.
- `.claude/hooks/test-guard-outward-cli.sh` — the two-sided regression test for the
  2026-09-02 `{`/`}` fix (search "2026-09-02 FIX"), plus the disclosure comments for the
  two remaining unfixed gaps (search "STALE AS OF 2026-09-02"). The round-2
  `GH_API_CLAUSE` regression tests are in the "2026-09-02 FIX (round 2)" block.

## See Also

- [Quote-strip escape glue hides real command](quote-strip-escape-glue-hides-real-command-2026-07-18.md) — the original context-sensitive quote scan this anchor sits downstream of.
- [Occurrence-ambiguity guard applied selectively](occurrence-ambiguity-guard-applied-selectively-not-uniformly-2026-08-17.md) — a sibling finding from the same PR #850 follow-up review round, same scanner family.
- [../best-practices/broadened-matcher-needs-new-input-regression-tests-2026-07-20.md](../best-practices/broadened-matcher-needs-new-input-regression-tests-2026-07-20.md) — the general rule this fix's test additions follow: pin the newly-matched inputs, not just the cases that motivated the widening.
