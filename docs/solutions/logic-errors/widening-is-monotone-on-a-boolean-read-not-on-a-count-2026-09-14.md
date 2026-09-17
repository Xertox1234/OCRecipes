---
title: "Widening a matcher is monotone on a BOOLEAN read and not on a COUNT — a longer match absorbs what would have started a second one"
track: bug
category: logic-errors
tags: [harness, hooks, safety-gate, bash, security, testing]
module: shared
applies_to: [".claude/hooks/*.sh", "scripts/**/*.sh"]
symptoms: ["A guard widened to close a bypass starts ALLOWING a command its previous version denied, on a DENY-shaped consumer", "An occurrence count drops from 2 to 1 after a pattern was made more permissive", "A multi-occurrence ambiguity refusal silently stops firing", "The argument 'widening only ever adds matches, so it can only add denies' was applied to a consumer that counts rather than tests", "Only one member of a needle family regresses and the others are structurally immune"]
created: 2026-09-14
last_updated: '2026-09-17'
severity: critical
---

# Widening is monotone on a boolean read, not on a count

## Problem

The standard safety argument for widening a matcher is that it **grows the language** — every
string that matched before still matches — so on a deny gate it can only ever ADD denies. That
argument is sound, and it is scoped to a kind of read it never names: a **boolean** one.

An **occurrence count** is not a boolean read, and it is not monotone in the language. A longer
match absorbs text that would otherwise have begun a **second** match, so growing the language
can **lower** the count. If a check refuses when the count exceeds one, widening switches it off.

Measured 2026-09-13 on `.claude/hooks/guard-outward-cli.sh`. A grammar arm gained an optional
value token so a root-position flag could consume its argument. The value token excluded only
whitespace, so it swallowed a separator and the command behind it:

```
gh -a api -c x;gh api /a/b
  before  [gh -a api ] [;gh api ]      COUNT=2  -> ambiguity DENY
  after   [gh -a api -c x;gh api ]     COUNT=1  -> silently ALLOWED   (` -c` ate ` x;gh`)
```

Five shapes went main-DENY → branch-ALLOW, across all three separators, with in-band controls
(`echo hello` ALLOW, `gh api /repos/o/r` ALLOW, `gh api -X POST …` DENY) firing correctly. The
companion "mutating HTTP method" check did not compensate: real `gh` sends POST when `-f` fields
are present, so `gh -a api -c x;gh api -f a=b /repos/o/r/merges` carries no method token at all.

## Symptoms

- A change argued as "strictly more permissive, therefore safe on a deny gate" produces a
  deny→allow flip, on a consumer that genuinely does deny.
- A count-derived refusal (ambiguity, "more than one occurrence", "cannot verify each") stops
  firing while every boolean needle behaves as intended.
- Only one member of a needle family regresses. The others look immune, and are — for a reason
  that is a property of their shape, not of the counter.
- The regression is invisible to a large generated corpus, because no dimension varied the
  thing that causes it.

## Root Cause

**The effect of a widening is a property of the CONSUMER, and "deny-shaped vs grant-shaped" is
not the only way consumers differ.** A sibling lesson in this repo classifies consumers by
direction — safe at a deny-shaped read, a false grant at an allow-shaped one. That classification
is correct and incomplete: the counter here IS a deny-shaped read, and widening made it less safe.
The missing axis is **arity**:

| consumer         | reads                        | monotone in the language? |
| ---------------- | ---------------------------- | ------------------------- |
| boolean          | "does any match exist?"      | **yes** — more matches can only satisfy it |
| count            | "how many matches exist?"    | **no** — a longer match can consume a second one |
| extraction / cut | "what text did it match?"    | no — the span itself moves |

Why one needle and not the others: `gh api` was the only **single-token** needle in that file.
Every other family is two-token (`pr merge`, `pr create`, `release …`, `repo …`), and they are
immune because **each globals arm carries at most ONE optional value slot**: a needle's first
token can be eaten as a value, but its second can then neither open a fresh arm (it is not a
dash token) nor be consumed (the slot is spent), so no single match absorbs a whole second
occurrence. Measured: ` -a pr` matches, ` -a pr merge` refuses, and ` -a pr -b merge` matches —
the slot is the limit, not the token's shape.

An earlier version of this paragraph said the immunity was that "the second token is not a dash
token and so can never be a flag's value". That is **backwards** — a non-dash token is exactly what
qualifies as a value — and it is the kind of error that propagates, because a maintainer applying
the wrong test would widen the value arm or add a needle on a false guarantee. The immunity is
real; only the reason was wrong.

**A partial flip reads as confirmation.** The first repair narrowed the wrong constant and three
of seven probe rows flipped to DENY. That looked like the fix working. The four that did not flip
were the ones that actually execute — a process substitution. Printing the actual matched spans,
rather than reasoning about which constant was responsible, moved the fix from the wrong constant
to the right one in one command.

## Solution

**Classify every consumer of a shared matcher by BOTH axes before widening it** — direction
(deny/grant) and arity (boolean/count/extraction). A widening needs a separate argument for each
non-boolean consumer; the language-growth argument does not carry.

Where a count must survive a widening, **count under both grammars and take the maximum**:

```sh
_n_wide=$(count "$NEEDLE_WIDE")
_n_narrow=$(count "$NEEDLE_NARROW")   # the same needle, boundary characters excluded
OCCURRENCES=$(( _n_wide > _n_narrow ? _n_wide : _n_narrow ))
```

Max rather than a swap, and the reason is directional rather than about what either grammar can
"see": the two disagree wherever the wide form spans a boundary character, and which count is
higher **depends on what follows**. The narrow count is higher when a second occurrence sits
behind that boundary, and LOWER when nothing does — so a swap would drop the count to zero on a
legitimate single command and skip the block entirely. Max takes whichever grammar saw more
invocations and therefore only ever adds denies, and it requires no claim about either grammar's
reach, which is the property that makes it safe to state.

**Derive the narrow grammar's excluded set from where a SECOND COMMAND MAY BEGIN, not from the
separators.** In a shell guard that set is the command-position anchor class — here
`[;&|(` + backtick + `{!]` — and it is strictly larger than `;&|`. A first attempt excluded only
the three separators and a process substitution opening at `(` walked straight through, collapsing
both counts together so the max restored nothing. Narrow the token classes, the redirect arm, AND
the inter-token separator: the crossing happened in the separator, not in the token arms, so
narrowing the arms alone flipped the bare openers and left the executing spellings live.

## Prevention

- **Before widening a shared pattern, grep for every consumer and label each `boolean` /
  `count` / `extraction`.** The count and extraction consumers are where the safety argument
  has to be rebuilt from scratch.
- **When a family is claimed immune, name the property that makes it immune** and check it is a
  property of the family rather than of the mechanism you happened to test. "Two-token needles
  cannot collapse" was true of one collapse mechanism and false of another.
- **When a fix flips some probes and not others, stop and print the intermediate value** — the
  matched span, the count, the captured clause. A partial flip is weaker evidence than no flip,
  because it reads as progress.
- **Add the regression axis to the generated corpus keyed on the THREAT, not on the fix.** An
  axis that varies exactly the characters the fix excludes can only confirm the fix; see the
  companion note in the See Also below.

### The ordering axis: psub-after-verb is countable, psub-before-verb is not (2026-09-16)

Measured while attempting the follow-on todo for the two-token families
(`pr merge`/`pr create|comment`). The SEPSAFE template (a separator-safe grammar, max()'d
against the wide count) is **not a general fix for "a process substitution defeats the
count"** — it only works when the FIRST occurrence can complete as a short, self-contained
match BEFORE the separator reaches the psub:

- **Psub AFTER a complete first occurrence** (`gh -a api -c <(gh api ...)`, or the two-token
  analogue `gh pr merge 7 -c <(gh pr merge 42)`): the first match ends cleanly right at its
  own verb, the psub becomes unconsumed trailing text, and a FRESH match starts at the `(`
  opener. Both the wide grammar and SEPSAFE correctly count 2 here (measured: the two-token
  case counts 2 under the **wide grammar alone** — SEPSAFE adds nothing, because a two-token
  verb's globals arm has only one value slot and cannot also swallow past the psub the way a
  single-token verb's can; see this doc's own Root Cause).
- **Psub BEFORE the verb** (`gh -a -c <(gh pr merge 7) pr merge 42`): the outer "gh" cannot reach its
  OWN verb tokens without first passing through the nested invocation's text, and grep -o's
  non-overlapping matching commits to using that outer "gh" for whichever match it finds
  first. **This is unfixable by narrowing the separator grammar** — both the wide and the
  separator-safe grammar land on the SAME nested tokens (measured on the two-token case:
  wide=1, sepsafe=1, both matching only the inner decoy's own "gh pr merge 7"; the outer,
  really-executing verb has no separate "gh" of its own to anchor a second match under any
  grammar).

  **CORRECTED 2026-09-17: do NOT generalise this to `gh api`.** An earlier revision claimed
  the same ordering explained a `gh api` field-based merge bypass. It does not. That bypass
  reproduces with NO process substitution and NO occurrence ambiguity at all — the plainest
  spelling allows — because the mutating-method check only recognises a literal
  `-X`/`--method` token and is blind to field-bearing requests, which `gh` sends as POST
  automatically. Different mechanism, different fix, tracked separately as a P1. Reaching for
  occurrence counting or grammar narrowing there is a dead end; this paragraph's reasoning
  applies to the two-token families only.

**A follow-on "does the matched span cross a command-position boundary" check was also tried
and rejected.** The idea: if the separator run absorbed one of `_OUT_POS_PREFIX`'s own anchor
characters (`;&|(` backtick `{!`) anywhere in its middle, treat that as evidence a second
command's text was folded in. Measured against the full test suite: **it reddened 23
unrelated, already-correct assertions**, because those same anchor bytes appear in ordinary,
non-hostile constructs the guard already handles correctly through OTHER mechanisms —
`&` inside an fd-duplication redirect (`gh pr 2>&1 merge 42`), `|` inside `>|`, and `;`/`&&`/
`||` gluing an UNRELATED, verb-less preceding `gh` invocation (`gh --auto -x;gh pr merge 42`,
where the swallowed `;gh` never contains a competing `pr`/`merge` pair at all — it is
correctly denied today via the separate --auto-carve-out clause check, not via occurrence
count, and the new check could not tell that apart from the genuinely nested case). **A
"contains an anchor byte" test cannot distinguish "swallowed a nested SECOND invocation of
the same needle" from "swallowed ordinary redirect syntax or an unrelated command" — the
byte alone is not the signal.** No narrower, still-general signal was found; the shape is
denied today for a coincidental reason (the `--auto`/`--repo` carve-out finds no
authorisation in the inner decoy's clause) and is pinned as a tripwire rather than closed.

### An UNFIXED, more severe residual found while testing this (2026-09-16)

`gh -a -c <(gh api /x) api -f merge_method=squash /repos/o/r/pulls/42/merge` is **ALLOWED**
by the unmodified guard, measured in its own directory (a `/tmp` copy breaks `$HERE`-relative
`lib/` sourcing and gives a false ALLOW for the wrong reason — see the process note below).
This is a field-based (`-f`, no `-X` token) mutating call at a merge endpoint.

**CORRECTED 2026-09-17.** An earlier revision of this section said the bypass was "hidden by
the SAME psub-before-verb ordering as this doc's own two-token finding". It is NOT. The
ordering is irrelevant and this doc's mechanism does not apply to it. Re-measured twice
independently: the plainest spelling — no process substitution, no root flags, no occurrence
ambiguity at all — allows identically, and the same holds with `-F`, `--field` and
`--raw-field`, while the explicit `-X POST` spelling denies correctly in the same run. The
real mechanism is that the mutating-method check recognises only a literal `-X`/`--method`
token and is blind to field-bearing requests, which the tool sends as POST automatically.

Nor was it novel: the identical bare form is already pinned as pre-existing on `main` in
`test-guard-outward-cli.sh`, attributed there to an archived `status: done` todo about a
different hook — which is why it fell between the two records and went untracked.

It was found here, not fixed — out of scope for the todo that surfaced it. Now tracked with
the correct attribution as
`todos/P1-2026-09-16-gh-api-field-mutation-passes-both-merge-guards.md`. **Do not reach for
occurrence counting or grammar narrowing there** — that is the dead end this correction
exists to prevent.

### Process note: compare against a prior hook revision from inside its own directory

Copying a hook script to `/tmp` for an A/B comparison silently breaks `$HERE`-relative
`lib/*` sourcing (`$HERE` resolves to `/tmp`, which has no sibling `lib/`), so the copy takes
the "lib is unsourceable" fallback path instead of running the real logic — producing a
plausible-looking but WRONG verdict for the wrong reason. A "regression" measured this way
(`gh -t x pr merge 42 --auto --squash` appeared to newly deny) evaporated once the comparison
copy was placed at `.claude/hooks/guard-outward-cli.ORIGINAL.sh` (a real sibling of `lib/`)
instead. Any before/after comparison of a hook must run from inside `.claude/hooks/`.

## Related Files

- `.claude/hooks/guard-outward-cli.sh` — `_OUT_GH_GLOBALS_SEPSAFE`, `_OUT_SEP_SEPSAFE`, and the
  `max()` at the `gh api` occurrence count; the header there carries the measurement
- `.claude/hooks/repro-outward-cli-corpus.sh` — the `apicollapse-*` axis, keyed on
  command-position openers
- `.claude/hooks/test-guard-outward-cli.sh` — the process-substitution and anchor-opener rows
- `todos/P2-2026-09-14-two-token-gh-needles-miscount-occurrences-through-a-process-substitution.md`
  — status: blocked (not archived): the two-token families' psub-before-verb miscount is
  proved unfixable via occurrence counting (both the SEPSAFE template and a boundary-crossing
  check were tried and rejected, per the sections above). It separately surfaced a more
  severe residual at the REST merge route, which is NOT on this ordering axis at all — see
  the CORRECTED note above — and is now filed as
  `todos/P1-2026-09-16-gh-api-field-mutation-passes-both-merge-guards.md`

## See Also

- [Widening is safe on every deny read and a false grant at the one allow read](widening-is-safe-on-every-deny-read-and-a-false-grant-at-the-one-allow-read-2026-09-13.md) — the sibling axis (direction); this doc is the counter-example to its "every DENY-shaped read" scope
- [An invented enumeration is not the space — ask the tool](an-invented-enumeration-is-not-the-space-ask-the-tool-2026-09-13.md) — the same change's other defect, and where the corpus-axis prevention comes from
- [A guard and its mutation test can both be inert while green](../code-quality/a-guard-and-its-mutation-test-can-both-be-inert-while-green-2026-09-13.md) — what happens when the assertion meant to catch this is itself unreachable
