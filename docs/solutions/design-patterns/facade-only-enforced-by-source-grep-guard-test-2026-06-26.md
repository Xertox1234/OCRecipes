---
title: Enforce a single-front-door facade with a source-grep guard test (call-shape regex + definer allowlist)
track: knowledge
category: design-patterns
module: server
tags: [facade, architecture-enforcement, guard-test, source-grep, single-entry-point, notifications, refactor]
applies_to: [server/services/**/__tests__/*facade*.test.ts, server/services/notifications/**/*.ts]
created: '2026-06-26'
---

# Enforce a single-front-door facade with a source-grep guard test (call-shape regex + definer allowlist)

## When this applies

You have just funnelled several callers through one facade (a single `notify()` / `enqueue()` / `publish()` front door) and want to keep it that way — a new producer six months from now must not quietly call the low-level sender again. A unit test can't catch this (it tests behavior, not "who is allowed to call X"). A **source-grep guard test** can: it walks the source tree and fails CI if any non-allowlisted file calls the low-level primitive directly.

## Why

The facade's value (governance, routing, accounting) only holds if it is the *sole* path. Enforcement by convention or code review erodes; enforcement by a test is permanent and self-documenting. Two design choices make the guard precise rather than brittle:

1. **Match call-shape, not the bare name.** Use a regex like `/\bsendPushToUser\s*\(/` — name followed by `(`. This catches actual calls (`sendPushToUser(`, `sendPushToUser (`) while letting documentation and JSDoc reference the primitive by name in prose without tripping the guard. (In this change, the scheduler's header comment still says "...`sendPushToUser` returns false..." and "`createPendingReminder` uses `onConflictDoNothing`" — both legitimately survive the guard.)
2. **Allowlist only the definer files**, not whole directories. The allowlist is the facade itself plus the modules that *define* the primitives (the push service, the storage module). Keeping it to 3 files means a too-broad allowlist can't hide a real offender.

A failed guard names the offending file: route it through the facade and the guard goes green again.

## Examples

`server/services/notifications/__tests__/facade-only.test.ts`:

```ts
const ALLOWLIST = [
  "server/services/notifications/notify.ts",   // the facade
  "server/services/push-notifications.ts",     // defines sendPushToUser
  "server/storage/reminders.ts",               // defines createPendingReminder
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") return [];
      return walk(p);
    }
    return p.endsWith(".ts") ? [p] : [];
  });
}

it("no producer calls sendPushToUser or createPendingReminder directly", () => {
  const files = walk("server").filter((f) => !ALLOWLIST.some((a) => f.endsWith(a)));
  const offenders = files.filter((f) => {
    const src = readFileSync(f, "utf8");
    return /\bsendPushToUser\s*\(/.test(src) || /\bcreatePendingReminder\s*\(/.test(src);
  });
  expect(offenders).toEqual([]);
});
```

**Make the pass non-vacuous:** the walk must actually find files (skip `__tests__`/`node_modules`, collect `.ts`), so an empty `offenders` reflects a real scan, not an empty file list. Verify once with an independent `find ... | xargs grep -lE '\bname\s*\('` that the tree truly has zero offenders before trusting the green.

## Exceptions

- Sequence the guard **after** the refactor that removes the last direct call — it asserts an end-state, so it will (correctly) fail until every producer is routed through the facade.
- If the primitive is also called legitimately by a sibling at the same layer (not just its definer), add that file to the allowlist with a comment explaining why — but treat each allowlist entry as a small architectural concession, not a convenience.
- A bare-substring match (no `\(`) would flag prose mentions and re-exports; always use the call-shape form.

## Related Files

- `server/services/notifications/__tests__/facade-only.test.ts` — the guard test
- `server/services/notifications/notify.ts` — the facade it protects
- `server/services/notification-scheduler.ts` — the producers routed through the facade

## See Also

- [Tz-local dedup pre-check → UTC-day unique index is safe only at ≤1 fire/day](../conventions/tz-local-dedup-to-utc-day-index-safe-only-once-per-day-2026-06-26.md) — a companion refactor in the same facade migration
