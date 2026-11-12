---
title: "A service's best-effort cleanup is silent success in a script run by hand — the script must check its own environment and refuse before the irreversible step"
track: bug
category: logic-errors
module: server
severity: medium
tags: [security, harness, architecture, database]
symptoms: [A by-hand script prints that it finished while stored images or third-party grants remain, A script run with only DATABASE_URL set deletes rows and skips every step that needs another setting, A service function logs a skipped step at debug level and returns normally]
applies_to: ["server/scripts/**/*.ts", "server/services/account-deletion.ts"]
created: 2026-11-12
---

# A service's best-effort cleanup is silent success in a script run by hand

## Problem

`server/scripts/delete-account.ts` deletes one account for a request that arrives by
email. It calls the same `deleteAccount` service as the app's button. Its documented
production command supplied **only the database address**. Inside `deleteAccount`, two
steps are best-effort: removing stored images (skipped when the `R2_*` settings are
absent) and revoking Sign in with Apple (skipped when the Apple settings are absent).
So the documented command deleted the rows, skipped both steps, and printed
"Deleted account …". The pictures stayed in storage and Apple still listed the app as
authorised — for a deletion the person was told was complete (security audit
2026-11-12, M3).

## Symptoms

- The script exits 0; storage still holds `recipe-images/…` objects whose rows are gone.
- After the rows are deleted there is no record left of which objects belonged to the
  account, so the miss cannot be repaired later.

## Root Cause

"Best-effort, skip when not configured" is a sound choice **inside the running server**:
its settings are checked once at boot, and a missing optional integration should not
fail a user's request. A script run by hand has no boot check. Its environment is
whatever the command line supplied, and the service's quiet skip turns a wrong command
into a wrong result with a success message.

## Solution

The script asks what the service would skip **before** the step that cannot be undone,
and refuses:

```ts
// server/scripts/delete-account.ts
export function findCleanupGaps(): string[] {
  const gaps: string[] = [];
  if (!isR2Configured()) gaps.push("stored pictures stay in storage (…)");
  if (!getSocialConfig().apple) gaps.push("Apple sign-in stays authorised (…)");
  return gaps;
}
// …
if (gaps.length > 0 && !args.allowIncomplete) {
  printGaps("This environment cannot finish the deletion:");
  return 1; // nothing was deleted
}
```

- The look step (no `--confirm-delete`) prints the same gaps, so the operator learns
  before the second command.
- `--allow-incomplete` exists for a development database with nothing in storage; when
  used, the script ends with a "Left behind:" list.
- The documented production command now runs with the server service's variables and
  takes only the database address from the Postgres service.

## Prevention

- A script that calls a service with best-effort steps lists those steps' settings and
  checks them itself. Reuse the service's own "is it configured" functions
  (`isR2Configured`, `getSocialConfig`) so the two cannot drift.
- Refuse by default; make the incomplete run an explicit flag with a printed residue.
- Not measured in this audit: whether production has all the settings (the read was
  denied). The script now fails safe either way.
- Two other scripts and `docs/DEV_SETUP.md` still show the database-only command
  pattern; check each for the same shape before relying on it.
- Open residue: `revokeAppleIdentities` swallows a decrypt failure from a wrong
  `IDENTITY_TOKEN_ENC_KEY`; the settings check cannot see a wrong value, only a missing one.

## Related Files

- `server/scripts/delete-account.ts` — `findCleanupGaps`, `runDeleteAccount`
- `server/scripts/__tests__/delete-account.test.ts`
- `server/services/account-deletion.ts` — the best-effort steps

## See Also

- [scheduled-job-ai-call-bypasses-request-context-ai-sharing-gate](scheduled-job-ai-call-bypasses-request-context-ai-sharing-gate-2026-11-10.md) — the same family: a guard that assumes a running request, called from outside one
