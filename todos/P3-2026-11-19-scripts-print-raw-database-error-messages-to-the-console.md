---
title: "Scripts print a failed query's raw message, bound values included, to the console"
status: backlog
priority: low
created: 2026-11-19
updated: 2026-11-19
assignee:
labels: [deferred, security, privacy]
github_issue:
---

# Scripts print a failed query's raw message, bound values included, to the console

## Summary

PR 1932 keeps a failed database statement's bound values out of the pino log. Scripts that
print a caught error with `console.error` are outside pino, so they still print the raw
message. Run those messages through the same redaction.

## Background

Found by the security review of PR 1932 (2026-11-18) and left out of that PR because it is
outside the logger.

- `server/scripts/cleanup-retention.ts` (the `catch` in its main function) logs through
  `toError` and then prints `(err as Error).message` with `console.error`. For a failed
  Drizzle statement that message ends with `\nparams:` and every bound value.
- About 30 files under `server/scripts/` and `scripts/` print a caught error with
  `console.error` (`grep -rnE "console\.error\([^)]*(err|error)\b" server/scripts scripts
--include=*.ts -l`). Not each one was read; many never touch the database.
- Not checked: whether any of these scripts runs in production with its output kept. The
  scheduled retention run starts from `server/index.ts`, not from this script.
- Severity is low: it needs a database failure during a by-hand script run, and exposes the
  values only to whoever reads that terminal or its captured output.

Two notes from the same review, recorded here and not asked for: an error stored on a custom
field of another error (not `cause` or `errors`) is not redacted by `toError`; and a value that
pg prints without quotes under a Drizzle error would pass through. No producer of either was
found.

## Acceptance Criteria

- [ ] `server/scripts/cleanup-retention.ts` prints a redacted message (through `toError` or
      `redactBoundValues` from `server/lib/logger.ts`), covered by a test written to fail first.
- [ ] Every script under `server/scripts/` that runs database statements and prints a caught
      error does the same; the PR lists which scripts were changed and which were read and
      left alone.
- [ ] No new redaction logic: the scripts reuse the functions in `server/lib/logger.ts`.

## Implementation Notes

- `toError(err).message` is enough: `toError` returns a redacted copy for a failed statement
  and the same object for anything else.
- Scripts under top-level `scripts/` that do not import the server's database client can be
  skipped; say so in the PR.

## Scope Contract

- **Mechanisms to use:** `toError` / `redactBoundValues` from `server/lib/logger.ts` — nothing new.
- **Files in scope:** `server/scripts/*.ts` and their tests.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Updates

### 2026-11-19

- Filed from the security review of PR 1932.
