---
title: "An allowlist inside a deny predicate fails open — a narrowed deny predicate is a regression until measured against the broad one in both directions"
track: bug
category: logic-errors
tags: [harness, hooks, security, testing, safety-gate, bash]
module: shared
applies_to: [".claude/hooks/**/*.sh", ".claude/hooks/lib/*.sh"]
symptoms: ["a deny gate that used to block a command spelling now allows it, with green CI and every count pin reconciled", "the new predicate is more specific and better commented than the one it replaced, and the PR fixes a real over-denial", "review keeps finding one more spelling the pattern misses, and each fix's own comment declares the class closed", "an argument that the pattern is exhaustive cites a grammar (RFC, CLI help) rather than the exact string the code consumes"]
created: 2026-09-19
severity: critical
---

# An allowlist inside a deny predicate fails open

## Problem

A deny gate decides "this text is a merge / a publish / a mutation" and blocks it. A predicate
inside such a gate that is written as an **allowlist of shapes** — an enumerated character class,
a fixed count of path segments, a closed set of trailing characters — has the property that every
shape its author did not enumerate is an **ALLOW**. Narrowing the predicate therefore moves inputs
from deny to allow silently, and the narrower version always _looks_ better: it is more specific,
it is better commented, and it usually fixes a genuine over-denial that motivated it.

PR #995 replaced main's merge-endpoint substring test `pulls.*merge` in `merge-review-guard.sh`
with an anchored path pattern, to stop a field _value_ quoting the endpoint from reading as a
merge. Across four review rounds the replacement failed open **five** ways, every one measured
main DENY / branch ALLOW — an unreviewed PR merge the gate on `main` would have stopped:

| attempt                                    | what it enumerated                    | what escaped                                                        |
| ------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------- |
| `[A-Za-z0-9._{}-]+` per segment            | the characters a segment may contain  | `$` (`repos/$OWNER/$REPO/…`) and `:` (a full `https://` endpoint)   |
| `(\?[^[:space:]]*)?` tail                  | what may follow the endpoint          | `#fragment`                                                         |
| `([?#][^[:space:]]*)?` tail                | same, "exhaustive by RFC 3986"        | a QUOTED `#` — see Root Cause                                       |
| `merge/?`                                  | how many trailing slashes             | `merge//` (an empty segment is more path, not trailing content)     |
| `/pulls/[^[:space:]/]+/merge[^[:space:]]*` | exactly one segment before `/merge`   | `pulls//42/merge`, `pulls/42//merge`                                |

The fifth was found by _reading_ the regex after four rounds of measurement. The class is
structural, not bad luck.

## Symptoms

See frontmatter. The distinguishing tell: **green CI and reconciled pins say nothing.** In this
repo the combinatorial corpus (`repro-outward-cli-corpus.sh`) pins `guard-outward-cli.sh` only;
its sibling `merge-review-guard.sh` has a hand-written suite whose rows are the author's own
guesses — and every row in the block under review used a bare, unquoted token, so the suite went
green on precisely the spellings that regressed.

## Root Cause

Two mechanisms, and the second is the one worth remembering.

**1. Enumeration in a deny predicate is an allowlist.** Each attempt listed what a legal
endpoint _looks like_; every character, count or terminator not on the list became a fall-through
to `continue`, which is ALLOW. Main's substring test models no path at all, so it has no segments
to get wrong and cannot regress against itself.

**2. The "exhaustive" proof was about a layer the code does not read.** RFC 3986 really does
permit only `?query` or `#fragment` after a path, so `[?#]` is exhaustive over URIs. But the
predicate never sees a URI — it sees the `cmd_words_deep` rendering, in which a `#` inside a
_quoted_ span is replaced by the placeholder character, so `"…/merge#frag"` renders `…/mergexfrag`
and matches nothing, while argv is byte-identical to the bare form under bash 3.2, bash 5.3 and
zsh. On a self-generated 6-prefix × 8-trailing × 3-quoting corpus, 60 of 144 rows were main DENY /
head ALLOW, **48 of them quoted**. A correct argument about the wrong string is worth nothing.

## Solution

**Restore the broad predicate and take the over-denial.** After the fifth shape the user chose to
revert the line to main's `pulls.*merge` byte-for-byte; the three prose spellings that now deny are
pinned as `ACCEPTED OVER-DENIAL` rows so a future re-narrowing has to say so in the suite. The
correct discriminator — an endpoint is a _positional_ argv token, a field value follows `-f` — is
filed as `todos/archive/P3-2026-09-18-gh-api-endpoint-check-should-key-on-argv-position.md`, because it is
parser work with its own review, not round six of this one.

How the decision was made measurable rather than argued, which is the reusable part:

```bash
# main's guard, with its own lib/, in a matching relative layout so sourcing resolves
git archive origin/main .claude/hooks | tar -x -C "$(mktemp -d)"
# same payload, same run, both versions; GENERATE the corpus from its dimensions
for cmd in …generated (prefix × trailing × quoting)…; do
  jq -cn --arg cmd "$cmd" '{tool_name:"Bash",tool_input:{command:$cmd}}' | bash "$MAIN_GUARD"
  jq -cn --arg cmd "$cmd" '{tool_name:"Bash",tool_input:{command:$cmd}}' | bash "$HEAD_GUARD"
done
# report BOTH directions: main-DENY/head-ALLOW (fail-open) AND main-ALLOW/head-DENY (over-denial)
```

with a **mutation control** — the same corpus run against a throwaway copy carrying the shipped
predicate must reproduce a non-zero fail-open count, or the corpus discriminates nothing. (The
first version of that control passed a _directory_ to `bash` and read 144/144 because every row
errored; a control that cannot fail correctly proves nothing.)

## Prevention

- **A diff that narrows, anchors, or "makes precise" any deny-shaped predicate is a regression
  candidate.** The only thing that settles it is running base and head on the same generated
  corpus, both directions, with a mutation control. Reading the new pattern and agreeing it is more
  precise is not evidence — precision is exactly what removes coverage.
- **Before claiming a pattern exhaustive, name the exact string the code consumes.** Print the
  rendering (`cmd_words_deep`, the vanished rendering, whichever the predicate greps) for the
  inputs in question; do not reason from the grammar of the thing the string was derived from.
- **Generate the corpus from its dimensions; never hand-list it.** A hand-listed corpus
  reproduces its author's blind spot — here, quoting — and returns a reassuring answer. Quoting is
  always a dimension for anything read through a rendering.
- **When the same deny predicate has failed open more than twice, stop improving it.** The fix is
  to restore the broad predicate and document the over-denial; a sixth "precise" attempt is a
  sixth allowlist. Four rounds of real findings in one line is evidence the line was under-tested
  when written, not that one more pass finishes it.
- **Coverage asymmetry between sibling guards is itself a security property.** Ask which file a
  change lands in and whether that file has a corpus behind it; a hand-written suite protects only
  the spellings someone thought of.

## Related Files

- `.claude/hooks/merge-review-guard.sh` — the endpoint check, now main's substring test, with all
  five shapes recorded in the comment above it and an instruction not to re-narrow without the
  positional model
- `.claude/hooks/test-merge-review-guard.sh` — blocks `3a-quinquies` / `3a-sexies`: 18 deny rows,
  4 allow controls, 1 pinned over-denial; the quoting axis is generated there, not sampled
- `.claude/hooks/lib/cmd-detect.sh` — `cmd_words_deep`, the rendering the predicate actually reads
- `.claude/hooks/repro-outward-cli-corpus.sh` — pins `guard-outward-cli.sh` only (`HOOK=`), which
  is why the sibling's regression was invisible to CI

## See Also

- [Widening is monotone on a boolean read, not on a count](widening-is-monotone-on-a-boolean-read-not-on-a-count-2026-09-14.md) — the same file's opposite-direction lesson: widening a matcher is safe for a deny-shaped consumer and unsafe for an extractor
- [A clean merge leaves a stale count pin](../code-quality/a-clean-merge-leaves-a-stale-count-pin-2026-09-14.md) — the other lesson from the same PR: the pin both sides moved to the same number merged with no conflict marker
- [Widening an allowlist root creates a hand-maintained denylist](../best-practices/widening-allowlist-root-creates-hand-maintained-denylist-2026-07-08.md) — the allow-side mirror: an allowlist is only as safe as its author's enumeration in either direction
