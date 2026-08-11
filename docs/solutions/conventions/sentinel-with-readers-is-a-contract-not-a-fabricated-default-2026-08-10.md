---
title: A sentinel with readers is a contract, not a fabricated default — find the consumers before calling it a defect
track: knowledge
category: conventions
module: server
tags: [architecture, database, code-review, sentinel, third-party-api, zod, false-positive, data-integrity]
applies_to: [server/services/**/*.ts, server/storage/**/*.ts, shared/**/*.ts]
symptoms: [A review flags a magic constant (0, 100, -1, "unknown") as a fabricated default, The finding is written as "maps X to N rather than failing" without saying what failing would break, A proposed fix would make a third-party integration reject responses it currently handles, The value's definition has an explanatory comment directly above it that the finding does not mention]
created: '2026-08-10'
---

# A sentinel with readers is a contract, not a fabricated default

## Rule

Before reporting a magic constant as a fabricated default, **find its readers**. If one or
more consumers branch on that exact value, it is a protocol the codebase agreed to — not an
accident. Removing it breaks every consumer at once.

Two checks, both cheap, both mandatory before the finding is written down:

1. **Read the comment block immediately above the definition.** A deliberate adaptation is
   usually documented within three lines of itself. Reading the function body alone is how
   you miss it.
2. **Grep for consumers of the exact value.** `grep -n "=== 0\|> 0\|!== 0"` over the modules
   that receive it. Readers are the evidence: a value that is written and never branched on
   is a smell; a value that three call sites gate on is an interface.

State the answer to both in the finding itself. "This value has no readers" is a real
finding. "I did not check" is not.

## Smell patterns

Of the **misdiagnosis**, not of the code:

- The finding is phrased as *"maps X to N **rather than failing**"* — a framing that assumes
  failing is the correct alternative without establishing what currently depends on not
  failing.
- The finding cites a line range that starts at the definition, so a docblock two lines above
  was never in view.
- The constant is a round, semantically-loaded number — `0`, `100`, `-1`, `""`, `"unknown"` —
  in code that talks to a third-party API. Those APIs signal absence in-band constantly.
- The proposed fix is "reject it instead", with no statement of what share of live responses
  would then be rejected.

## Why

Measured cost, 2026-08-10. `coerceNumber` in `server/services/nutrition-lookup.ts` was
reported as a Medium data-integrity defect for mapping a string to `0`
*"rather than failing the parse"*:

```ts
const coerceNumber = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v : 0));
```

Both checks would have killed the finding in under a minute.

**Check 1 — the comment, two lines above the definition:**

```ts
// Free tier returns some fields as "Only available for premium subscribers."
// so we coerce strings to 0 for those fields.
```

**Check 2 — the readers.** Three call sites gate on the value, so `0` means "incomplete"
throughout the module: `if (cnfResult && cnfResult.calories > 0)`,
`if (result && result.calories > 0)`, `if (data && data.calories > 0)`. It is an interface,
not a leak.

The proposed "fix" — reject non-numeric strings — would have made **every free-tier API
Ninjas response fail to parse**, removing a whole nutrition source in production. The
misreading also propagated into a merged PR body and two todos before it was caught, and cost
a follow-up PR to retract from all three.

The asymmetry is the point: the cost of the two checks is a minute; the cost of skipping them
is a wrong claim in the knowledge base, which the pattern-injection hook then serves to future
sessions as fact.

## Examples

**The finding that should have been written:**

> `coerceNumber` maps non-numeric strings to `0`. Verified deliberate — the comment at `:38`
> documents API Ninjas' free tier returning gated fields as
> `"Only available for premium subscribers."`, and `:733`/`:758`/`:794` all gate on
> `calories > 0`, so `0` is the module's "incomplete" sentinel. Not a defect.
>
> Downstream consequence worth noting separately: on a free key `serving_size_g` is gated,
> so the per-100g basis is unresolvable and the source is discarded.

The second paragraph is the real finding, and it only becomes visible *after* the sentinel is
understood. Misdiagnosing the sentinel hides the actual consequence behind a false one.

## Exceptions

A sentinel with **no** readers is the opposite case and genuinely is a bug — that is
[truthy-sentinel-default-bypasses-fallback](../logic-errors/truthy-sentinel-default-bypasses-fallback-2026-05-13.md),
where `"other"` was written by a DB default and the `||` meant to re-process it never fired.
Absence of readers is the tell in that direction, which is why the reader-grep resolves both
cases rather than just this one.

Likewise, a documented sentinel can still be the **wrong design** — the point is not that
comments make code correct, only that the finding must engage with the stated intent instead
of ignoring it. Argue against the contract explicitly, with the consumer list in hand.

## Related Files

- `server/services/nutrition-lookup.ts` — `coerceNumber` (`:40-42`), its docblock (`:38`),
  and the `calories > 0` readers at `:733`, `:758`, `:794`
- `server/services/barcode-lookup.ts` — downstream consumer of the gated `serving_size_g`

## See Also

- [binding-rule-remedy-must-match-its-cited-solution](binding-rule-remedy-must-match-its-cited-solution-2026-08-06.md) — the sibling failure: getting the defect right but the remedy wrong
- [../logic-errors/truthy-sentinel-default-bypasses-fallback-2026-05-13.md](../logic-errors/truthy-sentinel-default-bypasses-fallback-2026-05-13.md) — the inverse case: a sentinel with no readers that silently defeats a fallback
- [../logic-errors/lenient-parser-makes-the-fallback-guard-unreachable-2026-08-10.md](../logic-errors/lenient-parser-makes-the-fallback-guard-unreachable-2026-08-10.md) — same session; the real defect that this false positive was found alongside
