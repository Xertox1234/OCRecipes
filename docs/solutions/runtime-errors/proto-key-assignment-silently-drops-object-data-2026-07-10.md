---
title: Assigning a dynamic "__proto__" key via bracket assignment silently corrupts the object
track: bug
category: runtime-errors
module: server
severity: high
tags: [javascript, proto, prototype-pollution, dynamic-keys, object-fromentries, data-loss, security]
symptoms: ['A key present in the input vanishes from Object.keys() and JSON.stringify() output', 'An object built from user-supplied key names silently loses one entry with no error thrown', 'A lookup function typed to return string (or string | null) instead returns a function or an object for a specific input']
applies_to: [server/**/*.ts, shared/**/*.ts]
created: '2026-07-10'
last_updated: '2026-09-28'
---

# Assigning a dynamic "__proto__" key via bracket assignment silently corrupts the object

## Problem

Building an object with bracket assignment from dynamic key names (`obj[key] = value`) breaks when `key === "__proto__"`: the assignment triggers `Object.prototype`'s legacy `__proto__` setter instead of creating an own property.

## Symptoms

- The key is absent from `Object.keys()` and `JSON.stringify()` output — the object silently loses data, no error thrown.
- If the value is an object, the target's prototype is replaced (prototype-pollution adjacent).

## Root Cause

`__proto__` is an accessor property inherited from `Object.prototype`. Plain bracket/dot assignment on a normal object invokes that setter — which sets the prototype rather than defining an own property. Only keys routed through own-property definition (`Object.defineProperty`, `Object.fromEntries`, computed keys in object literals) escape the setter.

## Solution

Build objects with dynamic keys via `Object.fromEntries()` (or `Object.defineProperty`, or a `Map` if keys stay internal):

```ts
const safe = Object.fromEntries(entries); // defines own properties, setter never runs
```

Found in `server/lib/contract-shape.ts`, where dynamic keys derived from user data could be `__proto__` (fixed alongside the P1 dynamic-key redaction work, 2026-07-08).

## Prevention

- Any `obj[k] = v` where `k` originates from user input or external data is suspect — prefer `Object.fromEntries`, or create the target with `Object.create(null)`.
- Test with the literal key `"__proto__"` when writing dynamic-key handling: assert the key round-trips through `Object.keys` and `JSON.stringify`.

### Read-side variant: `map[key] ?? fallback` also leaks a prototype member

The write-side bug above is not the only shape. A **read** of a plain-object map with a
nullish-coalescing fallback — `MAP[key] ?? fallback` — has the identical exposure, for a
different reason: `Object.prototype.constructor` and `Object.prototype.__proto__` (via the
inherited getter) are both **truthy**, so `??` never falls through to `fallback` when `key` is
`"constructor"` or `"__proto__"`. The lookup returns the inherited function/object instead of a
string, even though the function's return type says `string` (or `string | null`).

`"constructor"` and `"__proto__"` are the **only two** `Object.prototype` member names that
survive `.toLowerCase()` — every other one (`toString`, `hasOwnProperty`, `__defineGetter__`,
…) contains an uppercase letter, so a two-case test (`"constructor"`, `"__proto__"`) is
exhaustive for a lowercased-key lookup, not a sample.

Found twice in `server/lib/recipe-normalization.ts`: `normalizeUnit`'s `UNIT_MAP[lower] ??
lower` (fixed 2026-09-28,
`todos/archive/P3-2026-09-27-normalize-unit-returns-prototype-members.md`), and the sibling
`normalizeDifficulty`'s `DIFFICULTY_MAP[key] ?? null` (same file, same shape, flagged but
**not yet fixed** — reachable via `POST /api/meal-plan/recipes`, bounded to the requester
corrupting their own `difficulty` field). Also present as a **chained** variant in
`server/services/canonical-enrichment.ts`'s `normalizeUnit`, which has two `??`-joined lookups
(`UNIT_NORMALIZATION_MAP[lower] ?? UNIT_NORMALIZATION_MAP[singular] ?? unit`) — both links in
the chain need their own guard, not just the first.

**Fix**: guard with `Object.hasOwn(MAP, key)` before indexing, never `MAP[key] ?? fallback`:

```ts
return Object.hasOwn(MAP, key) ? MAP[key] : fallback;
```

Established convention in this repo (three prior sites, same shape): `server/services/cooking-session.ts:183,186`
(`if (Object.hasOwn(GRAMS_PER_UNIT, unit))`) and `client/components/recipe-allergen-label-utils.ts`.
Prefer `Object.hasOwn` over converting the map to a `Map` — it matches these existing sites.

## Related Files

- `server/lib/contract-shape.ts` — the dynamic-key site this was found in
- `server/lib/__tests__/contract-shape.test.ts`
- `server/lib/recipe-normalization.ts` — read-side variant (`normalizeUnit`, fixed;
  `normalizeDifficulty`, same defect, open)
- `server/lib/__tests__/recipe-normalization.test.ts` — `normalizeUnit` prototype-member test
- `server/services/canonical-enrichment.ts` — read-side variant, chained-lookup form (fixed)
- `server/services/cooking-session.ts` — the `Object.hasOwn` convention this fix follows

## See Also

- [redact dynamic object keys, not just values](../conventions/redact-dynamic-object-keys-not-just-values-2026-07-07.md) — the sibling finding from the same contract-shape hardening arc
