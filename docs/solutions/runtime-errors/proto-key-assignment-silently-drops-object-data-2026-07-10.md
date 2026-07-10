---
title: Assigning a dynamic "__proto__" key via bracket assignment silently corrupts the object
track: bug
category: runtime-errors
module: server
severity: high
tags: [javascript, proto, prototype-pollution, dynamic-keys, object-fromentries, data-loss, security]
symptoms: ['A key present in the input vanishes from Object.keys() and JSON.stringify() output', 'An object built from user-supplied key names silently loses one entry with no error thrown']
applies_to: [server/**/*.ts, shared/**/*.ts]
created: '2026-07-10'
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

## Related Files

- `server/lib/contract-shape.ts` — the dynamic-key site this was found in
- `server/lib/__tests__/contract-shape.test.ts`

## See Also

- [redact dynamic object keys, not just values](../conventions/redact-dynamic-object-keys-not-just-values-2026-07-07.md) — the sibling finding from the same contract-shape hardening arc
