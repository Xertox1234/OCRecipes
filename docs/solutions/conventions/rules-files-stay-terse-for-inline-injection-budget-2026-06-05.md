---
title: docs/rules/*.md must stay terse — the inject hook embeds them inline under a byte cap
track: knowledge
category: conventions
module: shared
tags: [docs-rules, pattern-injection, hook-scripts, context-budget, maintainability]
applies_to: [docs/rules/*.md, .claude/hooks/inject-patterns.sh]
created: '2026-06-05'
last_updated: '2026-07-03'
---

# docs/rules/*.md must stay terse — the inject hook embeds them inline under a byte cap

## When this applies

Whenever you add to or edit a file under `docs/rules/`. These files are the **binding,
inline** tier of the knowledge base: `inject-patterns.sh` `cat`s the *entire* matched
`docs/rules/<domain>.md` into the PreToolUse `additionalContext` before every Edit/Write.
That output shares a hard ~8800 B inline cap with the discipline preamble (~1005 B), the
other matched domains, and solution references. Anything over the cap spills to a temp file
the agent must choose to re-read.

## Smell patterns

- A rules bullet has grown into a multi-sentence paragraph with failure-mode narrative,
  "wrong twice over" explanations, or worked examples.
- A rule FAMILY restates the same exception under multiple bullets. `accessibility.md`'s
  announcement family (iOS announce vs Android live region) carried the InlineError
  exception twice, the iOS-gating condition three times, and one precedent twice —
  consolidating the family into one cluster took the file 6,547 → 4,582 B with every
  binding rule preserved (verified bullet-by-bullet at review, 2026-07-03). Repetition
  across bullets is the dominant bloat mechanism; consolidation, not deletion, is the trim.
- A single `docs/rules/<domain>.md` is more than ~4–5 KB (run `wc -c docs/rules/*.md`).
- A multi-domain edit (e.g. a storage file → database+security+architecture) routinely
  spills, and the highest-stakes domain is the one getting truncated.

## Why

A rules file is delivered by **embedding**, not by reference (that is what distinguishes it
from a `docs/solutions/` file, which the hook lists as path+title only). `security.md` had
drifted to 8000 B — on its own it exceeded the inline cap once the preamble was added, so it
was always the most-truncated domain, and on a storage edit only ~27% of it survived inline.
Trimming it to ~4.8 KB (binding directives only; rationale moved to `docs/solutions/`)
restored it to 100% inline. The constraint is structural: **rules-file size is context cost
paid on every single edit in that domain.**

`copilot-instructions.md` does NOT inline rules (it references them by path), so a bloated
rules file is invisible there — the cost only shows up through the inject hook. Don't let
"copilot is fine" mask the inline-budget problem.

## Examples

Keep the directive + load-bearing specifics (helper names, exact values, precedent paths,
exemptions); move the prose to a solution doc the hook auto-surfaces:

```md
<!-- docs/rules/security.md — terse, binding -->
- Never index `TIER_FEATURES[tier]` with the raw stored `users.subscriptionTier`
  (not reset on expiry → lapsed users keep paid features). Use
  `storage.getEffectiveTierForUser(userId)` ... EXEMPTION: B2B `ApiTier` has no expiry.
```

```md
<!-- docs/solutions/best-practices/security-rules-extended-rationale-...md — the "why" -->
### Effective tier (never index features by the raw stored tier)
[full failure-mode walkthrough, cache-trap details, call-site list]
```

## Exceptions

- If a rule's *operational specifics* (a helper name, an exact ReDoS bound like
  `[\s\S]{0,2000}`, a fail-safe SQL note) are what make it actionable, keep them inline —
  those are the directive, not rationale. Don't trim below the point of being actionable just
  to hit a size number; the goal is "no silent truncation of high-stakes rules," not a round KB.
- After editing any `docs/rules/*.md` mapping, regeneration of copilot-instructions is only
  needed when the path→domain table or rule *set* changes, not when prose inside a file shrinks.

## Related Files

- `.claude/hooks/inject-patterns.sh` — embeds rules inline; ~8800 B cap; since 2026-07 an
  over-budget domain is DEFERRED to the session's next edit (one-line pointer, not recorded
  in the dedup state) rather than spilled — spill remains the session-less backstop.
- `docs/rules/security.md` — the file that drifted to 8 KB and was trimmed to ~4.8 KB.
- `docs/rules/accessibility.md` — the announcement-family consolidation precedent (6.5 → 4.6 KB).
- `scripts/check-rules-file-size.js` — since 2026-07-03 lint-staged ENFORCES a 6,500 B cap
  on `docs/rules/*.md` (budget derivation in its header); regrowth now fails at commit time.
- `docs/rules/client-state.md` — the last over-cap file (~8.4 KB, frozen grandfather cap);
  trim tracked in `todos/P3-2026-07-03-client-state-rules-trim.md`.

## See Also

- [Priority-order and never half-emit when injecting shared context under a size cap](../design-patterns/priority-order-context-injection-under-size-cap-2026-06-05.md) — how the hook chooses what spills when a file is over budget.
- [jq -r emits the literal string "null" for an absent key](../logic-errors/jq-r-emits-literal-null-for-absent-key-2026-06-05.md) — another gotcha in the same hook.
