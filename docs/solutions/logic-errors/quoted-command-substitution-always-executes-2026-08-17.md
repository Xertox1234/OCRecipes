---
title: "\$(...)/backtick command substitution always executes regardless of surrounding quotes — a quote-blanking or word-rendering scanner must not treat its contents as inert"
track: bug
category: logic-errors
tags: [harness, security, shell-quoting, false-negative]
module: server
applies_to: [".claude/hooks/**"]
symptoms: ["A quote-aware command scanner blanks or neutralizes the CONTENTS of a double-quoted (or backtick) span uniformly, without special-casing $(...) or backtick substitution", "A dangerous command wrapped in ordinary double quotes as a command substitution (echo \"$(eas update ...)\") is silently treated as inert text/data by the scanner", "The identical unquoted command is correctly detected/denied, isolating the gap to quoting specifically, not a missing pattern"]
created: 2026-08-17
last_updated: 2026-09-02
severity: critical
---

# \$(...)/backtick command substitution always executes regardless of quoting

## Problem

`.claude/hooks/lib/cmd-detect.sh`'s two quote-scanning renderers (`cmd_bare`,
`cmd_words`) treat the CONTENTS of a quoted span as inert data whenever they're inside
`"..."` (or backticks) — including when that content is itself a `$(...)` or backtick
command substitution. But bash ALWAYS executes `$(...)`/backticks, regardless of what
quoting surrounds them; quoting only affects how the substitution's OUTPUT is
word-split, never whether the substitution itself runs. A command like
`echo "$(eas update --branch preview --platform all)"` genuinely publishes a live OTA
update — and every guard keyed on this scanner's output missed it, because the scanner
collapsed the quoted span (substitution included) into an opaque, neutralized token.

## Symptoms

- `echo "$(eas update --branch preview --platform all)"` → the OTA-publish guard
  returns exit 0, no deny. The unquoted form (`eas update --branch preview
  --platform all`) is correctly denied by the same guard — proving the gap is
  specifically about the quoting, not a missing verb pattern.
- The same shape bypasses a `--admin` carve-out check (`echo "$(gh pr merge --admin
  42)"`), a mutating-HTTP-method check (`echo "$(gh api -X POST repos/o/r/merges)"`),
  and a PR-creation preflight-stamp gate (`echo "$(gh pr create --fill)"`) — the gap is
  in the shared scanning primitive, so it silently defeats every consumer.
- No exotic crafting is required — this is ordinary double-quote syntax, not an ANSI-C
  `$'...'` trick or a mid-word empty-quote split. Any user or agent who happens to wrap
  a command in `"$(...)"` for a completely unrelated reason (e.g. to capture its
  output) triggers the bypass as a side effect.

## Root Cause

Inside a quoted span, the scanner's `neutral()` character class (the set of characters
that get replaced with a placeholder rather than passed through) includes `(`, `)`,
backtick, and whitespace — the exact characters that make up a `$(...)`/backtick
substitution's syntax. The scanner has no concept of "this text, even though it's
inside quotes, is not DATA — it's a nested command that will execute." It treats
`"$(eas update ...)"` exactly like it would treat `"some literal string"`: opaque
content whose internal structure doesn't matter to the surrounding argv.

## Solution

**Fixed, in two sessions.** The design question this section originally left open
(options a/b/c below) was resolved 2026-08-29 by explicit user decision: option (c),
adopt a different detection mechanism — but a genuinely different MECHANISM, not
necessarily an off-the-shelf tokenizer (see Prevention for why that specific sub-choice
changed again on 2026-09-02).

- (a) special-case `$(...)`/backtick spans so their CONTENTS are still scanned by the
  per-hook matchers even when the span itself is quoted (recursing the scanner into
  the substitution),
- (b) treat ANY command containing `$(...)`/backtick as automatically triggering the
  fail-closed/crude-smell-test path regardless of what's inside, or
- (c) adopt a different detection mechanism for this class entirely.

**What was actually built**: a genuinely recursive, stack-based awk scanner,
`cmd_extract_substitutions` (`.claude/hooks/lib/cmd-detect.sh`) — an explicit
per-nesting-level quote-state array, unlike `cmd_bare`/`cmd_words`'s flat single-state
machine — that finds every `$(...)`/backtick substitution in a LIVE quote context
(unquoted or double-quoted; single-quoted and `$'...'` stay correctly inert) and
returns each one's raw body text. Two combinators consume it: `cmd_words_deep`
(unions `cmd_words` of the command with `cmd_words` of every extracted body — wired
into 5 of 6 `cmd_is_*` predicates and `guard-outward-cli.sh`'s deny-shaped matchers)
and `cmd_bare_deep` (the same shape built on `cmd_bare`, added 2026-09-02 for
`pr-verify.sh`'s two consumer functions — see below). This is option (a) implemented
via a structurally new mechanism, which is what satisfies the "different mechanism"
half of the 2026-08-29 decision without requiring delegation to bash's own parser
(see Prevention for why that stayed out of reach).

**Rollout, closing every consumer named in scope**:
- 2026-08-29→09-02 (first resumption): `guard-outward-cli.sh`'s deny-shaped matchers
  and 5 of 6 `cmd_is_*` predicates migrated onto `cmd_words_deep`. Two CRITICALs found
  and fixed in review: an ANSI-C quote sigil mid-word inside an already-open
  double-quoted span masked a genuinely live following substitution; the `--auto`
  carve-out's shallow `$WORDS` CLAUSE extraction could be forged by a substitution
  carrying its own internal double-quoted argument (fixed by denying whenever
  `CLAUSE` contains a literal `$`, and by keeping that ONE grant-shaped read
  deliberately shallow — see the "boolean vs. value" rule in Prevention).
- 2026-09-02 (second resumption): the one remaining named consumer,
  `.claude/hooks/pr-verify.sh`, migrated. Its two functions,
  `cmd_gh_pr_write_subcommand` (boolean) and `cmd_gh_pr_ref` (value-returning),
  needed different treatment — see Prevention's new rule, which exists because
  treating them the same shipped a CRITICAL on the first attempt. A SECOND
  CRITICAL then shipped inside the boolean function itself, on the very next
  review round — see Prevention's refinement of that same rule below.
- **`cmd_is_git_branch_create` deliberately stays shallow** (documented residual, not
  a gap): making it deep was measured to have no observable effect, since its
  companion `cmd_git_branch_create_segment` (a separate clause-splitting scan) is the
  actual bottleneck and would need its own, larger rework to see inside a
  substitution — out of scope for this fix.

## Prevention

**On the top-level mechanism choice** — this is the concrete instance of a broader
signal worth naming: when a hand-rolled quote/escape scanner has accumulated MULTIPLE
(this codebase: six) separate CRITICAL bypass fixes across one review cycle, each
closed by adding another special case to the same state machine, treat that pattern
itself as evidence the mechanism may be undersized for the job — not just as "one more
bug to patch." The instinct is to reach for a REAL shell tokenizer (delegating
word-splitting/quoting/substitution semantics to bash's own parser, under appropriate
sandboxing) to get this whole CLASS of bug closed for free. **Evaluate that
explicitly, with cause, before assuming it's available** — on this project's actual
`#!/usr/bin/env bash` runtime (macOS system bash 3.2.57), it was evaluated and
rejected three ways (2026-09-02, verified by direct probing, not assumed):
  - bash's own DEBUG-trap (`set -T`) + `extdebug` "veto the pending command" trick has
    no effect on this runtime — a `touch` inside a "vetoed" `$(...)` still ran when
    probed directly.
  - the `shell-quote` npm package (already a project dependency) does not interpret
    `$(...)`/backtick substitution at all — it renders identically for single- and
    double-quoted `$(...)`, losing exactly the live/inert distinction this fix depends
    on.
  - the `bash-parser` npm package builds a real AST but is unmaintained since
    2022-06-13, built on the deprecated `babylon` parser, with 21 transitive deps — an
    unacceptable supply-chain addition for a security-critical local guard.
  When no real tokenizer is reachable, a properly RECURSIVE (stack-based) hand-written
  extractor — reusing the existing scanner's own proven quote-state conventions rather
  than bolting a 7th case onto the flat state machine — is the fallback, but ship it
  expecting the same review scrutiny a brand-new security mechanism gets: it produced
  its own CRITICAL on first review (see below), found by a reviewer, not by the
  implementer's own corpus or mutation testing, despite substantial effort on both.

**On applying a widened detection API to its consumers** — a rule this file's own
history had to learn the hard way, twice: **a rendering primitive proven safe for
BOOLEAN mention-detection is not thereby proven safe for POSITIONAL VALUE
extraction.** Widening a boolean predicate's input can only ADD a true positive — a
wider match still just means "yes, mentioned somewhere," which stays correct even if
exactly WHERE it was found is imprecise. Widening a VALUE-returning function's input
can change WHICH VALUE comes back, because `cmd_extract_substitutions`'s own
documented contract is NOT a faithful, order-preserving reconstruction of the source
text (a nested substitution leaves a "hole" — zero characters, not a placeholder —
where the nested part was; an embedded quote or backslash-escape gets blanked to
whitespace by `cmd_bare`, corrupting whatever positional token boundary the value
extractor depends on). `pr-verify.sh`'s `cmd_gh_pr_ref` (a `$NF`/`$(NF-1)`
token-position extractor) was rewired onto the same `*_deep` idiom as its boolean
sibling `cmd_gh_pr_write_subcommand` on the assumption that "safe for one caller"
meant "safe for both" — it shipped a CRITICAL on first review: three independent,
constructed-and-run mechanisms (a nested substitution, an embedded quote, an embedded
backslash) each turned a should-be "could not verify" into a CONFIDENTLY WRONG PR
number. Before applying a `*_deep`/widened rendering to a NEW consumer, ask
specifically: does this consumer return a boolean (safe to widen) or a value (needs
its own dedicated safety guard, scoped to the specific corruption mechanisms a widened
render can introduce — not a blanket "trust it" carried over from a sibling)?

**Refinement of that same rule, forced by a SECOND CRITICAL in the genuinely
boolean function** (`cmd_gh_pr_write_subcommand`, round-2 review of the fix
above): "returns a boolean" is a property of the function's OWN return type,
not of its CALLER's behavior — check the caller too. This function correctly
answers "was some `gh pr <verb>` mentioned" as a boolean-safe widen, but it
does not return a plain yes/no: it returns WHICH of four verbs (create,
merge, close, edit) matched first, and its one caller (`pr-verify.sh`)
branches on that choice — `create` takes a no-args lookup, the other three
take a ref-based one. Two different verbs are not interchangeable "yes"
answers when the caller treats them as selecting between different follow-up
actions; a decoy `gh pr create` mention winning `head -1` ahead of a real,
substitution-hidden `gh pr merge 42` silently swapped which PR got reported
as verified — the same "wrong value with high confidence" shape the first
CRITICAL produced in the openly value-returning sibling, just reached through
a function whose own header called it a pure boolean detector. The general
form: **before calling a multi-outcome predicate "boolean-safe to widen,"
trace what its CALLER does with each distinct outcome** — if two outcomes
route to different downstream actions (different branches, different
lookups, different consequences), a wider match changing WHICH outcome wins
is a value-extraction risk wearing a boolean function's return type, and
needs the same dedicated, mechanism-scoped guard the truly value-returning
sibling needed. The fix that generalizes correctly is scoped to the actual
dangerous transition (here: `create` racing `merge`/`close`/`edit`, since
only `create`'s branch skips the downstream ref-guard) rather than a blanket
"refuse on any two mentions of anything" — a broader guard was tried first
and reverted after it silenced five pre-existing, intentionally-passing
tests whose shape (`merge` vs `close`, no `create` involved) was ALREADY made
safe by a different, existing guard further downstream; matching a symptom
too broadly can throw away already-verified-safe information for no
corresponding safety gain.

**On finding every consumer of a widened API** — a green full test suite proves the
consumers it already covers still pass; it cannot prove every intended consumer was
actually migrated, because an unmigrated consumer just keeps passing ITS OWN
(unchanged, pre-fix) tests. The `pr-verify.sh` gap in this file's own history sat
undetected through a full green suite for exactly that reason — it was found by
re-reading the Scope Contract against the code (`grep`-enumerating every
`cmd_bare`/`cmd_words` call site and classifying each as migrated / deliberately
shallow / gap), not by running anything.

## Related Files

- `.claude/hooks/lib/cmd-detect.sh` — `cmd_bare()`/`cmd_words()` (the original gap),
  `cmd_extract_substitutions()` (the fix's recursive scanner), `cmd_words_deep()` and
  `cmd_bare_deep()` (the two consuming combinators), `cmd_gh_pr_ref()` (the
  value-extraction safety guard).
- `.claude/hooks/guard-outward-cli.sh`, `.claude/hooks/pr-preflight-guard.sh`,
  `.claude/hooks/pr-verify.sh` — the three hooks confirmed bypassable by this
  technique pre-fix, all now migrated.
- `.claude/hooks/test-cmd-detect.sh`, `.claude/hooks/test-guard-outward-cli.sh`,
  `.claude/hooks/test-pr-verify.sh` — regression coverage, including both
  CRITICALs' own pinned tests (`test-pr-verify.sh` Tests 38-40 for the
  value-extraction CRITICAL, Tests 41-43 for the boolean-caller-branching
  CRITICAL).
- `todos/archive/P1-2026-08-17-quoted-command-substitution-inert.md` — the closed
  todo, including the full design-decision history and both review rounds.

## See Also

- [Empty quote-span mid-word vs standalone](empty-quote-span-closing-check-needs-mid-word-vs-standalone-2026-08-17.md) — a sibling finding from the same review round, in the same scanner.
- [Occurrence-ambiguity guard applied selectively](occurrence-ambiguity-guard-applied-selectively-not-uniformly-2026-08-17.md) — another sibling finding, same review round.
