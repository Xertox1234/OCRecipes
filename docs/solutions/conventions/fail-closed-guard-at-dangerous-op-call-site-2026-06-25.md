---
title: Fence a prod-dangerous operation at its call site with a fail-closed target check (defense in depth)
track: knowledge
category: conventions
module: server
tags: [scripts, prod-safety, fail-closed, defense-in-depth, database-url, security, seed]
created: '2026-06-25'
---

# Fence a prod-dangerous operation at its call site with a fail-closed target check (defense in depth)

## Rule

When a prod-capable script contains a single irreversible/dangerous operation —
creating a privileged or test account, dropping data — gate **that operation**
with its own guard at the call site, keyed on a **trustworthy property of the
target** (e.g. the `DATABASE_URL` host), and make it **fail-closed**. This is a
second layer _in addition to_ the entry-point flag guard (see See Also), not a
replacement: the flag authorizes the run; this guard makes the dangerous action
structurally impossible against the wrong target even if every upstream gate is
bypassed.

"Fail-closed" means the guard refuses unless the target is _explicitly_ known to
be safe: an absent / unparseable / non-local value ⇒ refuse; only a recognized
local host allows it.

## Smell patterns

- The only thing standing between a forgotten flag and a destructive prod write
  is the entry-point flag check — a single point of failure.
- A "create demo/test user" helper with no internal check, reachable on a code
  path that can point at a remote DB.
- Guard logic that lists the _unsafe_ hosts (deny-list) instead of the _safe_
  ones (allow-list) — a new prod host then slips through.

## Why

The entry flag can be forgotten and the env signal (`NODE_ENV`) may be absent
under `railway run`. In PR #455 the demo-account path could still be reached on
the live DB through that gap. Adding `assertLocalDbForDemoAccount()` as the
**first statement** of `ensureDemoUser()` closed it: the account is now
impossible on a non-local DB regardless of flags or env. Because the guard is a
fail-closed allow-list, a misconfiguration (unset/garbled `DATABASE_URL`) refuses
rather than proceeds — the safe direction. The decision lives in a **pure helper**
so it's unit-tested exhaustively; the script's module-load `main()` can't be
imported, so the testable logic must sit outside it.

## Examples

```ts
const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '']);
export function isLocalDbHost(url: string | undefined): boolean {
  if (!url) return false; // fail closed: unset ⇒ non-local
  try {
    // new URL("postgresql://[::1]/db").hostname === "[::1]" (WITH brackets) —
    // strip them or a bare "::1" allow-list silently never matches IPv6 loopback.
    return LOCAL_DB_HOSTS.has(new URL(url).hostname.replace(/^\[|\]$/g, ''));
  } catch {
    return false; // fail closed: unparseable ⇒ non-local
  }
}
export function assertLocalDbForDemoAccount(url: string | undefined): void {
  if (!isLocalDbHost(url)) throw new Error(`Refusing demo account against non-local DB host.`);
}

async function ensureDemoUser() {
  assertLocalDbForDemoAccount(process.env.DATABASE_URL); // FIRST statement, before any DB I/O
  /* ...create the account... */
}
```

Verify the guarantee by its **observable proof**, not by trusting the guard —
e.g. assert `select count(*) from users = 0` after a platform-owned prod seed.

## Exceptions

- The safe path stays convenient: a local `DATABASE_URL` ⇒ the operation is
  allowed (dev/simulator login still works).
- For non-DB targets, pick the equivalent trustworthy property to key on (bucket
  name, account id) — the principle is "guard on the target, fail closed," not
  "always check the DB host."

## Related Files

- `server/scripts/seed-recipes-utils.ts` — `isLocalDbHost`, `assertLocalDbForDemoAccount` (pure, unit-tested).
- `server/scripts/seed-recipes.ts` — `ensureDemoUser()` calls the guard first.
- `server/scripts/__tests__/seed-recipes-utils.test.ts` — pins the fail-closed cases incl. IPv6 `[::1]`.

## See Also

- [Guard one-shot prod-ops scripts on an explicit flag, not NODE_ENV](prod-ops-script-guard-on-flag-not-node-env-2026-06-20.md) — the entry-point flag layer this guard complements.
- [../runtime-errors/openrouter-base-url-with-openai-key-401-2026-06-25.md](../runtime-errors/openrouter-base-url-with-openai-key-401-2026-06-25.md) — same session; another local-vs-prod environment divergence.
