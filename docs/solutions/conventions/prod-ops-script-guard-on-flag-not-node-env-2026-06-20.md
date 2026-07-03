---
title: 'Guard one-shot prod-ops scripts on an explicit flag, not NODE_ENV (railway run does not set it)'
track: knowledge
category: conventions
module: server
tags: [scripts, ops, railway, guard, prod-safety, node-env, backfill, idempotency]
applies_to: [server/scripts/**/*.ts, scripts/**/*.ts]
created: '2026-06-20'
---

# Guard one-shot prod-ops scripts on an explicit flag, not NODE_ENV (railway run does not set it)

## Rule

A one-shot operational script that performs a **destructive or irreversible write to the prod DB** (e.g. `UPDATE users SET ...`, a backfill, a column drop) must gate that write behind an **explicit opt-in CLI flag** the operator passes (`--allow-prod-backfill`, mirroring `seed-recipes.ts`'s `--allow-prod-seed`). Make the flag **unconditional** — do NOT couple the refusal to `process.env.NODE_ENV === "production"`.

Reason: these scripts are run against the live DB via `railway run --service Postgres -- sh -c '...'`, and that context does **not** reliably set `NODE_ENV=production`. A `seed`-style "refuse only when NODE_ENV=production, else allow" guard therefore **never fires on the real run path** and silently allows the write with no confirmation — the exact opposite of the intended safety. The flag is the single source of authorization; the env is not a trustworthy signal here.

Also:

- **Idempotency is in the WHERE clause, not a separate check.** Scope the UPDATE to the rows that still need changing (`WHERE email_verified = false`), so a re-run is a no-op. This works only when the column is `NOT NULL DEFAULT <x>` — a nullable column needs the third state handled explicitly. Use `.returning({ id })` and report `.length` as the affected-row count; a second run reports 0.
- **Print the (redacted) target before the write** so the operator can confirm which DB was hit. Parse `DATABASE_URL` with `new URL()` and log only `hostname:port/dbName` — never the credentials.
- **Document the run command with the public-URL override.** The internal Railway host won't resolve from a laptop, so the command must override `DATABASE_URL="$DATABASE_PUBLIC_URL"` (see `project_railway_autodeploy_migrate_ordering`).

## When this applies

Any `server/scripts/*.ts` or `scripts/*.ts` that writes to prod data on demand (backfills, gate-flip prep, retention sweeps with destructive intent). Not for read-only reports or dev/test-only seeders (those correctly gate on `NODE_ENV=production` to *refuse* in prod — the inverse operation).

## Why

The trap is pattern-matching a prod-write script to the dev-seeder it superficially resembles and copying the `NODE_ENV`-keyed guard. `seed-recipes.ts` is a **dev** op that is dangerous in prod, so it refuses *when* prod. A backfill is a **prod** op invoked via `railway run`, where `NODE_ENV` is unset — copying the env check yields a guard that is structurally present but operationally dead. Authorization must come from a signal that is actually present on the run path: an explicit flag the operator types.

## Examples

```ts
// GOOD — unconditional flag guard; fires on the real `railway run` path.
export const ALLOW_FLAG = "--allow-prod-backfill";
export function isBackfillAuthorized(argv: readonly string[]): boolean {
  return argv.includes(ALLOW_FLAG);
}
// in main():
if (!isBackfillAuthorized(process.argv)) {
  console.error(REFUSAL_MESSAGE); // names the flag + the destructive statement
  process.exit(1);               // pool is lazy/untouched — nothing to close
}

// BAD — never fires under `railway run` (NODE_ENV unset), so the write runs unguarded.
if (process.env.NODE_ENV === "production" && !process.argv.includes(ALLOW_FLAG)) {
  process.exit(1);
}
```

Idempotent write + affected count:

```ts
const updated = await db
  .update(users)
  .set({ emailVerified: true })
  .where(eq(users.emailVerified, false)) // re-run = no-op
  .returning({ id: users.id });
console.log(`Updated ${updated.length} user(s).`);
```

Keep `main()` from auto-running on import (so tests can import the exported helpers without tripping the guard or opening a connection) with an `isMain` check, mirroring `cleanup-retention.ts`:

```ts
const isMain = (() => {
  try {
    return Boolean(process.argv[1]?.includes("backfill-email-verified"));
  } catch {
    return false;
  }
})();
if (isMain) void main();
```

## Exceptions

- Read-only scripts need no flag.
- Dev/test seeders correctly invert the guard (refuse *in* prod) — that env check is appropriate there because the danger is the opposite direction.
- A script wired into boot/cron (not run on demand) gates differently — see `cleanup-retention.ts`'s `RETENTION_CLEANUP_ENABLED` env gate, which is appropriate because the cron host *does* set the env.

## Related Files

- `server/scripts/backfill-email-verified.ts`
- `server/scripts/backfill-email-verified-utils.ts`
- `server/scripts/seed-recipes.ts`
- `server/scripts/cleanup-retention.ts`
- `docs/DEV_SETUP.md`

## See Also

- [Lazy-initialize DB pools and API clients in modules that tests import](lazy-init-db-pool-and-api-client-in-test-imported-modules-2026-06-13.md)
- [Fail-fast environment variable validation at module load](fail-fast-environment-validation-2026-05-13.md)
