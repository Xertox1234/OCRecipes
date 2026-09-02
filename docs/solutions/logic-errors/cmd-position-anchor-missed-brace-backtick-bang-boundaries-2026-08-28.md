---
title: "A shared command-position anchor's opener/closer character classes must cover every REAL bash command-position boundary, not just the operators the original author enumerated"
track: bug
category: logic-errors
tags: [harness, security, shell-quoting, false-negative, regex]
module: server
applies_to: [".claude/hooks/**"]
symptoms: ["A quote-aware command-position matcher (`${_PREFIX}verb${_SUFFIX}` shaped) fails to detect a real, executing invocation of the gated verb", "The SAME verb, unwrapped, is correctly detected — isolating the gap to the anchor's boundary character classes, not the verb pattern itself", "A brace-grouped ({ verb; }), backtick-substituted (`verb`), or !-prefixed (! verb) form of the command is silently ALLOWED by a blocking deny gate", "A verb with no whitespace before the next separator (verb;date) is silently ALLOWED even though a spaced form (verb ;date) is correctly DENIED", "A sibling anchor in the same codebase (e.g. a guard-local one) already covers the missing boundary characters, proving the gap is an under-scoped port, not a fundamental limitation"]
created: 2026-08-28
last_updated: '2026-09-01'
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
  ports into the shared lib.

## See Also

- [Quote-strip escape glue hides real command](quote-strip-escape-glue-hides-real-command-2026-07-18.md) — the original context-sensitive quote scan this anchor sits downstream of.
- [Occurrence-ambiguity guard applied selectively](occurrence-ambiguity-guard-applied-selectively-not-uniformly-2026-08-17.md) — a sibling finding from the same PR #850 follow-up review round, same scanner family.
- [../best-practices/broadened-matcher-needs-new-input-regression-tests-2026-07-20.md](../best-practices/broadened-matcher-needs-new-input-regression-tests-2026-07-20.md) — the general rule this fix's test additions follow: pin the newly-matched inputs, not just the cases that motivated the widening.
