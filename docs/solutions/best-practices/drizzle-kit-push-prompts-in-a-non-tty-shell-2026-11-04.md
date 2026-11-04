---
title: 'drizzle-kit push from an agent shell: no TTY, and --force skips only the data-loss prompt'
track: knowledge
category: best-practices
module: shared
tags: [database, tooling, drizzle, migrations]
applies_to: [shared/schema.ts, drizzle.config.ts]
created: '2026-11-04'
---

# drizzle-kit push from an agent shell: no TTY, and --force skips only the data-loss prompt

## When this applies

Running `npm run db:push` (`drizzle-kit push`) against the **local dev** database from a non-interactive shell (an agent's Bash tool, CI, a pipe).

## Rule

1. **Read `DATABASE_URL` first.** Confirm the host is local before any push.
2. **Expect it to fail with `Interactive prompts require a TTY terminal`** as soon as drizzle wants to ask anything. Two prompts exist, and they behave differently:
   - **Truncate-before-unique-constraint** ("Do you want to truncate `<table>`?") appears when a new unique constraint goes onto a non-empty table. It is asked **even with `--force`**. Index 0, the default, is "No, add the constraint without truncating".
   - **Data-loss confirmation** ("Found data-loss statements… Do you still want to push changes?") lists dropped tables and columns. `--force` skips it. Index 0 is "No, abort".
3. **Never answer the data-loss prompt for the owner.** Show them the listed drops and ask. A dev database that drifted from the schema usually holds leftovers of a removed feature (here: TOTP tables, after two-step became email-code only).
4. Once the drops are approved: `(sleep 30; printf '\r'; sleep 40) | script -q /dev/null npx drizzle-kit push --force`. `script` provides the TTY, and the single Enter picks "No" on the truncate prompt. If no truncate prompt appears, the stray Enter is harmless.
5. **Verify through `information_schema`**, not from drizzle's "Changes applied" line: check the added column exists, the approved drops are gone, and the row counts of any table it offered to truncate.

## Why

Piping keystrokes blindly is unsafe because the prompt order depends on the diff. One Enter sent to the data-loss prompt aborts the push (safe), but an arrow key followed by Enter executes it. Reading the prompt code first (`node_modules/drizzle-kit/bin.cjs`, `pgSuggestions` and `pgPush`) showed that `--force` gates only the data-loss branch (`if (!force && shouldAskForApprove)`), while the truncate `Select` has no `force` check.

## Exceptions

- **Production:** never `db:push`. Prod schema changes go through the migration path and the to_regclass verification.

## Related Files

- `drizzle.config.ts`
- `shared/schema.ts`

## See Also

- [text-over-pgenum-for-enum-columns](../conventions/text-over-pgenum-for-enum-columns-2026-05-13.md): another db:push behaviour to know
