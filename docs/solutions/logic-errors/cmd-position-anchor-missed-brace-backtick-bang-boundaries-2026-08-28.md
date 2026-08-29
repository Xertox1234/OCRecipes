---
title: "A shared command-position anchor's opener/closer character classes must cover every REAL bash command-position boundary, not just the operators the original author enumerated"
track: bug
category: logic-errors
tags: [harness, security, shell-quoting, false-negative, regex]
module: server
applies_to: [".claude/hooks/**"]
symptoms: ["A quote-aware command-position matcher (`${_PREFIX}verb${_SUFFIX}` shaped) fails to detect a real, executing invocation of the gated verb", "The SAME verb, unwrapped, is correctly detected — isolating the gap to the anchor's boundary character classes, not the verb pattern itself", "A brace-grouped ({ verb; }), backtick-substituted (`verb`), or !-prefixed (! verb) form of the command is silently ALLOWED by a blocking deny gate", "A verb with no whitespace before the next separator (verb;date) is silently ALLOWED even though a spaced form (verb ;date) is correctly DENIED", "A sibling anchor in the same codebase (e.g. a guard-local one) already covers the missing boundary characters, proving the gap is an under-scoped port, not a fundamental limitation"]
created: 2026-08-28
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

The SAME review round found `cmd_git_branch_create_segment`'s terminator class also
omits `<`, `>`, and `#` — pre-existing, confirmed present before this todo's changes
(reproduced against `git show HEAD:.claude/hooks/lib/cmd-detect.sh` at the commit prior
to this fix). An ordinary `git checkout -b foo 2>/dev/null` (ordinary redirection, not
adversarial) leaks the redirection into the extracted segment, manufacturing a spurious
start-point token in `branch-preflight.sh`'s stale-base check. A shallow character-class
fix is NOT safe here: excluding `<`/`>` alone still leaves the fd-prefix digit (the `2`
in `2>`) as a spurious non-flag token in the consuming loop, and digits cannot be
blanket-excluded from the terminator (`release/2.0` is a real branch name) — correct
handling needs `[0-9]*[<>]` recognized as one unit, which is a new mechanism beyond a
character-class widening. Left for a human decision on scope rather than patched.

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
