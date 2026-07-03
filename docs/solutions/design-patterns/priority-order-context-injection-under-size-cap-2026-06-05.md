---
title: Priority-order and never half-emit when injecting shared context under a size cap
track: knowledge
category: design-patterns
module: shared
tags: [hook-scripts, pattern-injection, context-budget, truncation, claude-code]
applies_to: [.claude/hooks/*.sh]
created: '2026-06-05'
last_updated: '2026-07-03'
---

# Priority-order and never half-emit when injecting shared context under a size cap

## When this applies

Any hook (or tool) that assembles context from several independent sources into one output
that has a hard size cap — Claude Code hook `additionalContext` (~10 KB), an LLM system
prompt, a status line, etc. `inject-patterns.sh` is the worked example: it concatenates the
discipline preamble + N matched domains' rules + solution refs, and the total routinely
exceeds the inline cap.

## Smell patterns

- The order sources are emitted is incidental (glob/match order, dictionary order) rather
  than chosen — so *which* source gets truncated is an accident.
- The output is hard-cut at a raw byte offset (`head -c N`), slicing a source mid-content.
- A source that overflowed is silently dropped or half-included with no breadcrumb.
- The most important source is, by bad luck, the one that gets cut.

## Why

When the budget is exceeded, *something* must be dropped — the only real decision is **which**,
and **whether the consumer knows**. Two principles:

1. **Rank by stakes, emit highest-first.** Assign each source an explicit priority and sort
   before emission, so the budget fills with the most important content and the *least*
   important source is the one that spills. In `inject-patterns.sh`, `domain_rank()` puts
   `security` first and `architecture`/`typescript` last; on a storage edit security went
   from ~27% inline (truncated by accident of match order) to 100%.

2. **Spill whole units with a pointer; never half-emit silently.** A source that doesn't fit
   should go to a stable, re-readable location (a temp file, or the canonical source path)
   with an explicit "read this" note — not be sliced mid-sentence. A complete-with-pointer
   spill is strictly better than a silent partial, because the consumer can recover the full
   content and *knows* it needs to.

3. **Defer whole units when the consumer is stateful.** (2026-07) When delivery recurs and
   per-consumer state exists (the hook's per-session dedup file), an over-budget source
   needn't spill at all: emit a one-line pointer now and deliver it in full on the next
   event — implemented by simply NOT recording the source as delivered. Guard against
   starvation by always emitting the first not-yet-delivered source regardless of size
   (spill stays as its backstop); every source then converges within a bounded number of
   events. In `inject-patterns.sh`, a first-touch `client/components` edit went from
   9,007 B byte-truncated + spill to 7,041 B fully inline, with the three lower-priority
   domains arriving whole on the following edits.

The payoff is determinism: the truncation victim is principled and predictable, and the
consumer is never misled into acting on a fragment it thinks is complete.

## Examples

```bash
# 1. Rank, then sort matched sources highest-priority-first (bash 3.2 safe — no mapfile).
domain_rank() { case "$1" in security) echo 10;; architecture) echo 130;; *) echo 75;; esac; }
# shellcheck disable=SC2207
DOMAIN_LIST=($(for d in "${DOMAIN_LIST[@]}"; do printf '%s\t%s\n' "$(domain_rank "$d")" "$d"; done | sort -n | cut -f2))

# 2. Over cap → copy the FULL content to a stable path, then point at it.
if [ "$(wc -c < "$TMPFILE")" -gt "$THRESHOLD" ]; then
  cp "$TMPFILE" "$SPILL_FILE"
  printf '\n[TRUNCATED — full context written to %s. Read it before editing.]\n' "$SPILL_FILE" >> "$INLINE"
fi
```

For the source-keep-it-small half of the same problem, see the rules-files convention link below.

## Exceptions

- If every source comfortably fits under the cap, ranking is moot — don't add machinery for a
  budget you never hit. This pattern earns its keep only when overflow is routine.
- `bash` on macOS is 3.2 by default — avoid `mapfile`/`readarray`; use the
  `$(... | sort | cut)` array idiom (word-split is safe for whitespace-free tokens).

## Related Files

- `.claude/hooks/inject-patterns.sh` — `domain_rank()`, priority sort, session-stateful
  deferral (2026-07), spill-with-pointer backstop.
- `.claude/hooks/test-inject-patterns.sh` — asserts the highest-stakes domain stays inline,
  first-touch payloads fit without spill, and deferred domains catch up on the next edit.

## See Also

- [docs/rules/*.md must stay terse for the inline injection budget](../conventions/rules-files-stay-terse-for-inline-injection-budget-2026-06-05.md) — keep each source small so fewer must spill.
- [jq -r emits the literal string "null" for an absent key](../logic-errors/jq-r-emits-literal-null-for-absent-key-2026-06-05.md) — a bug in the session-dedup half of this hook.
