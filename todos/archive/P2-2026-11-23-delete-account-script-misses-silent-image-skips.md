---
title: "delete-account script can exit 0 with pictures still in storage"
status: done
priority: medium
created: 2026-11-23
updated: 2026-11-23
assignee:
labels: [reliability, privacy]
github_issue:
---

# delete-account script can exit 0 with pictures still in storage

## Summary

`deleteAccount` counts a stored-picture cleanup failure only when `deleteImage` rejects.
`deleteImage` returns without deleting, and without rejecting, in several cases, so the
delete-account script can report a clean deletion while a picture is left behind.

## Background

Found by `/code-review` on PR #1989 (pre-existing; that PR added the count and the exit code
2). In `server/lib/image-store.ts`, `deleteImage` resolves silently when:

- the key fails the per-kind prefix guard or the safe-filename guard,
- the URL matches no known base (for example an old CDN base),
- a legacy on-disk file's `unlink` fails (the error is swallowed with `.catch(() => {})`).

None of these is counted in `cleanupFailures`, so `server/scripts/delete-account.ts` prints
"Deleted account …" and exits 0. The account's rows are gone by then, so nothing else records
that the picture exists.

## Acceptance Criteria

- [x] `deleteImage` tells its caller when it did not delete (a return value, not a throw, so
      request paths keep their fire-and-forget behaviour).
- [x] `deleteAccount` with `awaitCleanup` counts those cases, and the script exits 2 for them.
- [x] A skip that is correct by design (a URL owned by another account, a null URL) is not
      counted.
- [x] Tests cover one counted skip and one not-counted skip.

## Implementation Notes

`deleteImage` has other callers (storage modules that delete R2 objects after a row write, per
the 2026-11-06 owner ruling). Check them with the LSP tool before changing its return type.

## Scope Contract

- **Mechanisms to use:** a return value on `deleteImage`; the existing `cleanupFailures` count.
- **Files in scope:** `server/lib/image-store.ts`, `server/services/account-deletion.ts`,
  `server/scripts/delete-account.ts`, and their test files.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Updates

- 2026-11-23: done. `deleteImage` returns an outcome; `deleteAccount` counts and logs `refused`, `unknown-base` and `unlink-failed`. The script needed no change: it already exits 2 on the count. `unknown-base` is judged by path shape alone.
