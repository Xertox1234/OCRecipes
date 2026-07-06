---
title: A test asserting a size-threshold crossing must clear it with a wide margin, not a few hundred bytes
track: knowledge
category: best-practices
module: shared
tags: [testing, hook-scripts, pattern-injection, context-budget, test-fragility, fixtures]
applies_to: [.claude/hooks/test-*.sh]
created: '2026-07-05'
---

# A test asserting a size-threshold crossing must clear it with a wide margin, not a few hundred bytes

## When this applies

Any test that asserts behavior conditioned on a byte-size (or similarly
measured) threshold being crossed — a truncation cap, a defer/spill decision,
a pagination cutoff — where the fixture's measured size is derived from real,
independently-editable content (a docs file, a rules file, a generated
payload) rather than a value the test controls directly.

## Smell patterns

- The fixture's margin over (or under) the threshold, when you actually
  compute it, is a few hundred bytes or less against a budget in the
  thousands.
- The test's PASS/FAIL branch depends on the current byte count of a file
  nobody thinks of as "test infrastructure" (a rules doc, a schema file, a
  generated report) — so a content edit to that unrelated file can flip the
  test without anyone touching the test itself.
- Nobody re-derives the margin when the underlying content changes; it was
  computed once at authoring time and never revisited.

## Why

A size-threshold test is a proxy: it wants to verify a *behavior* (defer vs.
inline, truncate vs. pass-through), but it does so by picking a fixture whose
*measured size* happens to land on the correct side of the threshold today.
If that margin is thin, the proxy is fragile in a way that is invisible from
reading the test — the test still compiles, still has a clear assertion, and
still looks correct. The failure mode is **silent drift**: an editor trims a
rules file for terseness (an explicitly encouraged, unrelated, and entirely
legitimate edit — see the sibling convention that keeps `docs/rules/*.md`
terse for the inline injection budget), the fixture's real size drops below
the threshold, and the test starts exercising the *other* branch. It may
still pass (for the wrong reason) or fail (with a diff that looks unrelated
to the size threshold at all) — either way, the person debugging it has no
signal pointing at "the margin evaporated."

Concrete case: `.claude/hooks/test-inject-patterns.sh`'s `itest-defer` case
asserted that the `api` domain gets deferred by `inject-patterns.sh`'s
pre-estimate check (`rules-so-far + this domain's rules > DOMAIN_BUDGET`).
The fixture (`server/routes/recipes.ts`, which maps to the `api` domain)
worked — but the actual numbers were `tmp=7724 + block=1050 = 8774` against a
`DOMAIN_BUDGET` of `8600`: a **~174-byte** margin, because `docs/rules/api.md`
is only ~1KB (the smallest rules file in the corpus). Any future trim to
`docs/rules/api.md`, `docs/rules/security.md` (emitted just before it), or the
discipline preamble could have erased that margin and flipped the test to the
inline-emit branch without an obvious cause.

## Examples

```bash
# Fragile — margin is a rounding error away from flipping
# api.md (~1KB) + already-emitted security payload just barely exceeds budget
DEFER_SESS='{"session_id":"itest-defer","tool_name":"Edit",
  "tool_input":{"file_path":"server/routes/recipes.ts"}}'   # api domain, ~174B margin

# Robust — pick the fixture/domain combination with the widest natural margin
# database.md (~6.3KB) overflows the remaining budget by ~5.5KB
DEFER_SESS='{"session_id":"itest-defer","tool_name":"Edit",
  "tool_input":{"file_path":"shared/schema.ts"}}'            # database domain, ~5.5KB margin
```

When picking the fixture, actually compute the margin (don't estimate) and
prefer the *widest* available option among fixtures that exercise the same
generic mechanism — the size-threshold logic under test is almost always
domain-agnostic, so which specific domain/file supplies the oversized content
is an implementation detail, not part of the test's intent.

## Exceptions

- If the threshold-crossing behavior can only be exercised by a specific,
  narrow fixture (no wide-margin alternative exists), don't force a fake one —
  instead make the assertion tolerant of small threshold-relative shifts, or
  add a comment documenting the known fragility and why it can't be widened,
  so a future reader isn't debugging blind.
- Don't manufacture an artificially oversized fixture that no longer
  resembles real content just to inflate the margin — that trades one
  fragility (thin margin) for another (an unrealistic fixture, per the
  sibling "fixtures must reproduce real output" convention). Prefer a fixture
  that is already comfortably over/under the threshold using real content.

## Related Files

- `.claude/hooks/test-inject-patterns.sh` — `itest-defer` case, widened from
  the `api` domain (~174B margin) to the `database` domain (~5.5KB margin) via
  `shared/schema.ts`; `itest-preest` case, the original wide-margin
  `server/storage/recipes.ts` example this fix was modeled on.
- `.claude/hooks/inject-patterns.sh` — `DOMAIN_BUDGET`, the pre-estimate defer
  check this class of test exercises.

## See Also

- [Priority-order and never half-emit when injecting shared context under a size cap](../design-patterns/priority-order-context-injection-under-size-cap-2026-06-05.md) — the mechanism this margin fragility affects.
- [Regression-test fixtures must reproduce the real dependency's output verbatim](test-fixture-must-match-real-dependency-output-2026-05-15.md) — the sibling constraint that keeps a widened fixture honest (real content, not a manufactured one).
