---
title: "Quoted-span stripping without an escape pre-pass glues spans together and hides a real command from a matcher hook"
track: bug
category: logic-errors
tags: [bash, hooks, awk, quote-aware, quote-stripping, tokenizer, command-matcher, pr-gate, fail-closed, regex, testing, typescript]
module: shared
applies_to: [".claude/hooks/**/*.sh", "scripts/**/*.sh", "scripts/**/*.ts"]
symptoms: ["A command-matching hook that strips quoted spans before matching silently allows or ignores a REAL invocation when an earlier argument contains a backslash-escaped quote or a bare apostrophe inside a double-quoted word", "Independent per-quote-type span substitutions pair a quote inside one argument with the quote opening a LATER argument and delete the separator and command between them", "A deny gate falls through its final match-or-exit-0 line on input that visibly contains the gated command", "A single backreference regex meant to detect one string literal instead spans from one string's closing quote to a LATER string's opening quote of the same type, incorrectly flagging or matching the code in between as if it were inside a literal"]
created: 2026-07-18
last_updated: 2026-08-16
severity: high
---

# Quoted-span stripping without an escape pre-pass glues spans together and hides a real command from a matcher hook

## Problem

Command-matching hooks (`pr-preflight-guard.sh`, `commit-verify.sh`,
`pr-verify.sh`) strip quoted spans before matching, so a command merely
*mentioned* inside a quoted argument never false-matches. The original strip
used two independent per-quote-type substitutions:

```bash
CMD_BARE=$(printf '%s' "$CMD" | sed "s/'[^']*'//g; s/\"[^\"]*\"//g")
```

This misses in several ways that all end the same: a REAL command gets deleted
and the gate falls through `|| exit 0` — a **silent allow on the PR gate** (and
a silently skipped verification in the two advisory hooks):

- **Escaped-quote glue.** In `echo "escaped \" quote" && gh pr create --title "x"`
  the `\"` pairs with the quote *opening* `--title`'s argument; the strip
  deletes everything between — the `&&` and the literal `gh pr create` included.
- **Apostrophe glue.** In `echo "don't" && gh pr create --title 'fix'` the bare
  `'` inside the double-quoted word `"don't"` is a *literal*, but `s/'…'//g`
  treats it as a delimiter and pairs it with the opening `'` of `'fix'`,
  deleting the `&& gh pr create --title ` between them.

Found by the 2026-07-18 harness audit (Phase 6 review caught the escaped-quote
class; the follow-up `/code-review` of PR #662 caught the apostrophe class and
proved the first attempted fix was incomplete).

## Symptoms

- A deny gate lets through an input that visibly contains the gated command.
- A PostToolUse verifier stays silent on a real, matching command.
- Repro shape: any command where one quoted argument contains a `\"`, a `\'`,
  or a bare apostrophe, with the gated command *after* it and another
  same-type quote later in the line.

## Root Cause

**Shell quoting is context-sensitive; a chain of independent regex
substitutions is context-free — the two can never be equivalent.** Whether a
given `'` is a delimiter depends on whether the scanner is currently inside a
`"…"` span (there it is a literal), and whether a `"` is a delimiter depends on
whether it is inside a `'…'` span or backslash-escaped. Two separate
substitutions (`s/'…'//g` then `s/"…"//g`) each run blind to the other's state,
so they mis-pair quotes across the real command. No amount of *additional*
regex legs (an escape pre-pass, more anchors) fixes this — it is the wrong
altitude. The first fix attempt (adding `s/\\\\[\"']//g` before the strip)
closed only the escaped-quote case and left the apostrophe case fully open,
because it was still three context-free passes.

## Solution

Do the strip with **one left-to-right scan that tracks quote state**, owned by
a single shared helper — not re-derived (and re-broken) per hook.
`.claude/hooks/lib/cmd-detect.sh` exposes `cmd_bare` (an `awk` state machine:
`OUT` / `IN_SINGLE` / `IN_DOUBLE`, blanking quoted content and escaped chars,
state carried across newlines) plus the matcher predicates
(`cmd_is_gh_pr_create`, `cmd_is_git_commit`, `cmd_gh_pr_write_subcommand`, `cmd_gh_pr_ref`). Each hook sources the helper and calls a predicate; the
quote grammar lives in exactly one place.

```bash
# in a hook:
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if . "$HERE/lib/cmd-detect.sh" 2>/dev/null && declare -F cmd_is_gh_pr_create >/dev/null; then
  cmd_is_gh_pr_create "$CMD" || exit 0
else
  case "$CMD" in *gh*pr*create*) : ;; *) exit 0 ;; esac   # BLOCKING guard: fail toward DENY
fi
```

**Fail-safe direction is hook-specific and must be explicit.** The sourced
helper is a new dependency: if it is missing, the naive
`CMD_BARE=$(… | cmd_bare)` yields empty and the matcher passes — a *reintroduced
fail-open*. Encode the fallback: the blocking gate matches the raw command
(fail toward DENY, without blocking unrelated Bash); the two advisory hooks
`exit 0` (silence — matching raw would fire false context on quoted mentions).
Test it: run a copy of the hook from a dir with no `lib/` and assert the
fallback direction (see `test-pr-preflight-guard.sh` #14).

### When the extracted value can itself be quoted: tokenize, don't just blank

`cmd_bare` **blanks** all quoted content — the right primitive when you only need to
know *whether* a command word is present (the PR/commit matchers). git-safety's
write-shaped branch (`emit_write_targets`) has the harder job: it must **reject** a
write operator/command that is quoted (a `>` or `tee` inside a commit message) *while
still* **reading** a write TARGET that is quoted (`> "/main/out"`, `rm "/main/x"` — the
agent-default style). The two quoted spans need OPPOSITE treatment based on grammatical
role, so no single transform works: blanking (`cmd_bare`) drops the target with the
message; the old `tr -d '\042\047'` (delete quote chars, keep content) did the reverse
and mined the message → the CONFIRMED false-DENY. The fix is one shell-aware
**tokenizer**: quote delimiters drop, quoted content stays inside its word, and
`>`/`>>`/`|`/`;`/`&` are operators only when UNQUOTED. A write is then real iff its
operator/command word is *untainted by quotes*; the target path may be quoted.
**Rule of thumb: detect *presence* with the quote-aware blank scan, but if the VALUE
you extract can itself be legitimately quoted, you need tokenization (role-aware), not
blanking (presence-only).**

**A greedy "last-match" extraction over a mixed command+message string is
BIDIRECTIONALLY unsafe — not only a false-positive.** git-safety's `-C` extractor
(`git_c_target`, the sibling that reads the effective repo of a mutating `git`) used
`tr -d '\042\047' | sed 's/.*git…-C ([^ ]+)/\1/'` — greedy `.*` grabs the *last*
`git -C` anywhere in the string. A commit *message* mentioning `git -C <path>` is
therefore read as a real `-C` override, and the direction of harm depends on what the
message names: a **main-checkout** path fabricates a violation (false-DENY), but a
**registered-worktree** path SUBSTITUTES for the real target and launders a genuine
main-checkout mutation past the gate (false-NEGATIVE / BYPASS — e.g.
`git commit -m "ref git -C <worktree>"` run in the main checkout). The tokenizer fix
emits only the FIRST command-position `git`'s `-C` argument (flag untainted, value may
be quoted), so a quoted message — one atomic token — can neither fabricate nor
substitute a target. Lesson: on a gate, a decoy in free-text isn't just noise that
adds a false-positive; "last match wins" lets the decoy REPLACE the real value, which
is the bypass direction. Test both directions (see `test-git-safety.sh`: main-decoy →
must-ALLOW, worktree-decoy → must-DENY).

### An extractor's empty return can be overloaded between two different meanings — and ERE has no negative lookahead to fix it

When an extractor's "nothing found" return means two DIFFERENT things to its caller — "legitimately nothing to extract" (e.g. `gh pr create` genuinely has no ref yet) vs. "extraction failed on input that DOES have the target" (e.g. an unresolvable branch/URL ref) — a caller that branches only on emptiness cannot tell them apart. In this codebase's `pr-verify.sh`, the caller was ALREADY correct here: it branches on `SUBCOMMAND == "create"` (the true "nothing to extract" case) rather than on `PR_REF` being empty, specifically so the two meanings are pulled apart at the call site rather than conflated at the extractor. The pattern: disambiguate at the CALL SITE when the caller has independent information (here, which subcommand was invoked) that the extractor itself lacks.

POSIX extended regular expressions (ERE — the `grep -E` / `sed -E` dialect used throughout this file's examples) have no negative lookahead, so a pattern cannot directly express "match X only if Y does NOT follow". Concretely: `cmd_gh_pr_ref` (in `cmd-detect.sh`) needs to treat a value-taking flag (`--title`, `--milestone`, etc.) as consuming its own next token as a VALUE, never as a ref — but when that flag+value pair is the LAST thing on the line, the only complete match the regex engine can find AT ALL is the one that misreads the flag as boolean and the value as the ref (`gh pr edit --title Fixed` → wrongly resolves `Fixed`). The regex cannot forbid this parse from the inside — ERE has no way to say "only match this shape if nothing legitimate remains after it." The fix pattern: let the regex both under- and over-match, then apply a cheap POST-hoc filter on the captured result using information the regex itself couldn't reason about — here, checking whether the token immediately BEFORE the extracted ref is itself a known value-flag name, and rejecting the match if so, rather than trying to force the exclusion into the pattern.

**Rule of thumb:** When an ERE's only successful parse of some input is the WRONG parse, don't fight the engine for a lookahead it doesn't have — accept the over-match and filter the result afterward with information the pattern couldn't express.

### A single backreference regex can glue two SEPARATE literals together, not just two quotes inside one argument

The bash cases above are a *chain* of context-free substitutions misreading
one command string. The same root cause — treating "next same-type quote
character" as sufficient proof of "closes THIS literal" — also breaks a
*single* regex with **no chained passes at all**, in a non-shell, non-security
context.

`scripts/coverage-ratchet.ts` needed to detect an **unbalanced** brace
accidentally placed inside a JSON-ish config string literal — the shape that
desyncs its brace-counting block locator. (A *balanced* brace-expansion glob
key such as `"client/{screens,components}/**"` is vitest-native, is already the
house style in the repo's own `coverage.include`, and parses correctly: the
pair self-corrects the depth counter 1→2→1 before any real metric is reached.
An early version of this check rejected *any* brace in a literal and so broke
that working input — see "Narrow the predicate to the shape that actually
breaks" below.) A candidate check used:

```ts
/(["'`])[^"'`]*?[{}][^"'`]*?\1/
```

— capture a quote char, lazily consume non-quote characters, require a brace,
lazily consume more non-quote characters, then require the *same* quote
character to close. On a config with two adjacent, well-formed per-glob
entries:

```ts
"client/**": { lines: 80, functions: 70, branches: 60, statements: 80 },
"server/**": { lines: 70, functions: 60, branches: 50, statements: 70 },
```

the engine fails starting at `"client/**"`'s opening quote (no brace before
its own closing quote), then retries starting at `"client/**"`'s **closing**
quote: group 1 = `"`, the lazy non-quote class consumes `: `, matches the
per-glob value object's real `{`, keeps consuming non-quote characters
(`}` is not excluded — only quote characters are) through ` lines: 80 },\n`,
and closes on `"server/**"`'s **opening** quote. The match spans a real,
legal `{ ... }` value object between two separate string literals and
false-positives on valid config — verified empirically (`buggy.test(twoGlobs)
=== true`).

**Fix:** stop trying to bound "a literal" by searching for the next same-type
quote character from an arbitrary starting position. Enumerate actual,
self-contained literals instead — each one anchored at its own open quote and
required to close before any unescaped newline or its own quote type reopens:

```ts
const STRING_LITERAL =
  /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
```

then test each individually-matched literal's content for the disallowed
character (here, `{`/`}`), never the raw text between two arbitrary quote
positions. This is the JS/TS analog of `cmd-detect.sh`'s shared scanner: don't
chain or single-shot a quote-boundary regex over the whole string; enumerate
complete, self-delimited tokens and inspect each one's own content.

A related trap in the same fix: comments can contain apostrophes. `// don't
use {invalid}, that's the point` has two apostrophes straddling a brace —
even the correct per-literal regex above will treat `'t use {invalid}, that'`
as a matched single-quote literal if line comments aren't accounted for.

**A comment-strip PRE-PASS is the wrong fix, and was shipped before being
caught.** `block.replace(/\/\/[^\n]*/g, "")` is not literal-aware, so it
breaks the opposite direction: a literal that legitimately contains `//`
(`"https://example.com/{a"`) is truncated to `"https`, which then matches no
complete literal at all and the check **silently does not fire**. Comments and
literals are mutually exclusive *at a given scan position*, so resolve both in
one left-to-right alternation instead of two ordered passes:

```ts
const STRING_LITERAL_OR_LINE_COMMENT =
  /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*/g;
```

`matchAll`, skip any match starting with `//`, inspect the rest. At the `"` of
a URL the literal alternative wins and eats its `//`; at the `//` of a comment
the comment alternative wins and eats both apostrophes. Neither direction can
corrupt the other, because there is only one pass.

### Narrow the predicate to the shape that actually breaks

The first shipped version of this check rejected **any** brace inside a
literal. That is strictly wider than the failure, and the excess was a real
regression: `"client/{screens,components}/**"` — the check's own cited
example, and legal vitest syntax — extracts correctly, because the balanced
pair returns the depth counter to where it started before any real metric is
reached. Rejecting it hard-failed `readCurrentThresholds` and `--apply` on a
config that had worked.

Worse, the widened check was justified by a claim nobody ran: that the input
"would silently desync depth tracking instead of failing loudly." Executing
the shipped locator against that exact input returned the **correct** values.
And the genuinely dangerous shape — an unbalanced brace — was **already**
failing loudly before the check existed, as a downstream
`Could not parse threshold for "lines"`. So the check's real value was never
"prevents a silent failure"; it was "replaces a misleading error message with
an accurate one." Sizing the guard to that honest value shrinks it from
"any brace" to "net brace delta ≠ 0".

**Rule of thumb:** before writing a guard, *run* the unguarded code against
the input you are about to reject. If it produces the right answer, the guard
is a regression, not a safety net. If it already fails, you are improving an
error message — scope the guard to that, and say so.

A residual worth documenting rather than hiding: only a `{`-first imbalance
reaches the check. A literal whose first unmatched brace is `}` drives the
depth counter to 0 and truncates the block *mid-literal*, so no complete
literal is ever scanned and the pre-existing `Could not parse threshold` error
surfaces instead. Documented in the function, not papered over with an
untestable branch.

## Prevention

- **Detect commands with the shared scanner, never a bespoke per-hook quote
  strip.** A new matcher hook sources `cmd-detect.sh`; if it needs a new target,
  add a predicate there. Any hand-rolled `s/'…'//g; s/"…"//g` in a hook is the
  smell.
- **Never bound "a string literal" by searching for the next same-type quote
  character from an arbitrary position — in bash OR in a regex engine.** The
  smell generalizes past shell: `/(["'`])[^"'`]*?…\1/`-shaped patterns (open
  quote … same close quote, excluding only quote chars in between) can span
  across two SEPARATE literals whenever nothing but non-quote characters lies
  between them. Enumerate complete, self-delimited literals
  (`"(?:[^"\\\n]|\\.)*"` per quote type) and inspect each match's own content;
  never test the raw span between two matched quote positions. Write the
  fixture with TWO adjacent quoted values of the target shape as the
  regression test — a single-literal fixture cannot distinguish a correct
  per-literal check from a quote-spanning one. (Caveat learned later in
  `coverage-ratchet.ts`: once its predicate narrowed from "any brace" to
  "unbalanced brace", its own two-adjacent-keys fixture stopped
  discriminating, because the span a quote-spanning regex would capture
  between the two keys is itself brace-balanced. Narrowing a predicate can
  silently retire the test that pinned it — recheck each guard fixture's
  discriminating power against the NEW predicate, and downgrade the comment
  honestly when it no longer discriminates.)
- **Never ship a guard without running the unguarded code against the input it
  rejects.** Both halves of the justification must be executed, not asserted:
  that the input really breaks, and that it breaks *silently*. In
  `coverage-ratchet.ts` neither held — the cited input parsed correctly, and
  the genuinely broken input already threw. A guard whose stated value is
  "prevents a silent failure" but whose real value is "improves an error
  message" will be sized for the wrong job and reject working inputs.
- **Two ordered passes over the same text (strip, then scan) is a smell when
  the two grammars are mutually exclusive.** Whichever runs first corrupts
  input for the second in the direction it does not model — a comment strip
  breaks `"https://…"`, a literal scan breaks `// don't … that's`. Put both
  alternatives in ONE left-to-right alternation and discard the matches you
  do not care about.
- **The regex "matcher recipe" is necessary but NOT sufficient.** Command-position
  legs still matter *after* the quote-aware strip — separator class `(^|[;&|(])`
  (else compound `git add -A && git commit` slips), env-assignment prefix with
  value class `*` not `+` (quote-blanking can leave `FOO= `), a bare
  command-position runner-word alternation (`env`/`command`/`builtin`/`exec`/
  `nohup`/`setsid`, else `env NAME=v gh pr create` slips), and trailing anchor
  `([[:space:]]|[)]|$)`. But these legs on top of a *context-free* strip are what
  gave false confidence before: the pre-fix hook had all four legs and still
  had two live bypasses. Correct strip first, then position anchors.
- **Documented residuals (guardrail, not sandbox).** A regex prefix cannot parse
  each command-position wrapper's own argument grammar, so arg-taking wrappers
  are NOT skipped: `timeout 30 gh pr create`, `nice -n 10 …`, `sudo -u x …`
  still bypass. `$'…'` ANSI-C quoting is treated as a plain single-quote span
  (errs toward over-blanking = the deny side). And because the scan *blanks*
  quoted/escaped content instead of unescaping it, a keyword split mid-word
  (`g\h pr create`, `g"h" pr create`) is rejoined to `gh` by a real shell but
  missed by the matcher — the deliberate cost of suppressing the
  `echo "gh pr create"` false positive (unescaping-then-rejoining would bring it
  back). These are acceptable for a guardrail whose escape hatch is
  `SKIP_PR_PREFLIGHT=1` — document them in the helper, do not pretend a regex
  closes them.
- **Red test per class**, in the hook's `test-*.sh`: escaped-quote glue,
  apostrophe glue, env-runner-word, newline-compound, and lib-missing
  fail-safe.

## Related Files

- `.claude/hooks/lib/cmd-detect.sh` — the shared quote-aware scanner + predicates (the fix)
- `.claude/hooks/git-safety.sh` (`emit_write_targets`, `git_c_target`) — two role-aware TOKENIZER variants, same root cause (`tr -d` kept quoted content and mined a commit message) where the extracted value must survive quoting so it tokenizes instead of blanking: `emit_write_targets` for write-shaped targets (false-DENY only), `git_c_target` for the mutating-git `-C` repo override (BIDIRECTIONAL — greedy last-match also laundered a real main mutation past the gate; see the bidirectional note above)
- `.claude/hooks/git-safety.sh` (the delete-advisor's `REF` extraction, ADVISOR branch, ~line 546) — a THIRD, simpler variant of the same family: the branch-name-for-`gh pr view` extraction never stripped quotes at all (not even blank-vs-tokenize — no strip whatsoever), so `git branch -D "todo/foo"` and `git branch -D "$B"` both produced a garbled `REF` and a false "NO PR found" (2026-07-25/26, `P3-2026-07-25-git-safety-delete-advisor-quoted-ref.md`). Unlike the two TOKENIZER cases above, the fix here is the simplest member of the family — strip one MATCHED PAIR of surrounding quotes (`case "$REF" in \"*\") …; esac`), because this extractor only ever needs a single scalar ref value, not a set of paths inside a larger command. A REF that still contains `$`/backtick after stripping is reported as "unresolvable" — an honest unknown — rather than asserted as "no PR exists."
- `.claude/hooks/pr-preflight-guard.sh` — the gate (deny-side); `commit-verify.sh`, `pr-verify.sh` — advisory
- `.claude/hooks/{core-bare-guard,drift-detect,drift-detect-update,branch-preflight}.sh` — the git-state sibling hooks, ported onto the same helper (2026-07-20) so quoted mentions stop false-firing. New predicates added to `cmd-detect.sh`: `cmd_is_git`, `cmd_is_git_commit_or_push`, `cmd_is_git_head_mover` (plus the existing `cmd_is_git_commit` for branch-preflight). Fail-safe is contract-specific: the three advisory hooks fail SILENT on an unsourceable lib (a skipped heal/warning is safe — git's own errors are the backstop, and a false warning beats absorbing a real drift); the blocking `branch-preflight.sh` fails CLOSED via a retained raw-regex fallback (never fail-OPEN on the detached-HEAD deny)
- `.claude/hooks/test-pr-preflight-guard.sh` (12e–12h, 14), `test-commit-verify.sh` (7–11), `test-pr-verify.sh` (11–14) — per-class regression tests; `test-{branch-preflight,core-bare-guard,drift-detect}.sh` carry the quoted-mention + lib-missing fail-safe tests for the ported git-state hooks
- `scripts/coverage-ratchet.ts` (`assertNoUnbalancedBraceInStringLiteral`, `STRING_LITERAL_OR_LINE_COMMENT`) — a FOURTH, non-shell variant of the same family: a single backreference regex meant to flag a brace inside one glob-key string literal instead spanned across two adjacent per-glob keys' `{ ... }` value object (2026-08-16, `P3-2026-08-16-coverage-ratchet-test-residuals.md`). Fixed with per-literal enumeration instead of quote-to-quote spanning. The first fix then had TWO further defects caught in review, both corrected in the same PR: its predicate rejected *any* brace in a literal (a regression against the legal, vitest-native `"client/{a,b}/**"`, now narrowed to unbalanced-only), and its comment-strip pre-pass corrupted a literal containing `//` so the check silently no-opped (now one literal-or-comment alternation, single pass). See the dedicated subsections above.
- `scripts/__tests__/coverage-ratchet.test.ts` — the two-adjacent-glob-keys legal-config regression (no longer a discriminator against a quote-spanning implementation, see the Prevention caveat), the apostrophe-straddled-brace-in-comment test, the balanced-`{a,b}`-glob-key test asserting it PARSES and returns the flat metrics, the unbalanced-`{`-glob-key test asserting the clear message, and the `"https://…/{a"` test that pins the comment-strip defect (paired with an UNBALANCED brace on purpose — a balanced one is non-discriminating, since it parses correctly under both the broken and the fixed scan)

## See Also

- `docs/solutions/logic-errors/guard-lexer-content-predicate-needs-same-redaction-2026-07-12.md` — the sibling trap: a lexer's downstream predicate skipping the redaction
- `docs/solutions/logic-errors/lexical-prefix-path-guard-dot-segment-escape-2026-07-17.md` — same "lexical shortcut has a semantic hole" family, for paths
