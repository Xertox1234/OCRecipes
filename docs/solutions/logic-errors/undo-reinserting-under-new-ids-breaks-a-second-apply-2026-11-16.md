---
title: "Undo that re-inserts deleted rows under new ids breaks a second apply when the undone thing names rows by id — restore the original ids"
track: bug
category: logic-errors
tags: [database, architecture, undo, write-cards, pantry]
module: server
applies_to: ["server/services/write-cards/**/*.ts", "server/storage/pantry.ts"]
symptoms: ["a card saved, undone and saved again skips every remove row", "after Undo the rows are back but their ids differ from the ones the payload holds", "a 'changed since' check reports rows as gone that the user can see", "tests cover save and undo separately but never save, undo, save"]
created: 2026-11-16
severity: medium
---

# Undo that re-inserts deleted rows under new ids breaks a second apply

## Problem

The pantry card's Undo put deleted rows back with a plain insert, so they got
new ids. Undo also returns the card to `live`, and the card's payload names
pantry rows by id. A second save looked each row up by its old id, found
nothing, and skipped it as "changed since".

## Symptoms

- Save, Undo, Save on a card with a remove row: the second save reports the
  row skipped and the item stays in the pantry.
- Every reviewer and the spec accepted "re-inserted rows get new ids" because
  each step was correct on its own.

## Root Cause

Two true statements that only fail together: Undo makes the action repeatable,
and the action refers to rows by identity. Restoring content without identity
is not a restore for anything that holds the id.

## Solution

Re-insert under the original id (`restorePantryItemsUnderCap`): an explicit id
with `onConflictDoNothing` on the primary key, under the same lock and cap as
any insert. A serial sequence never hands an id out twice, so the only way the
id is taken is that the row is already back; that row is left alone.

## Prevention

- When Undo returns something to a state where it can be applied again, test
  apply, undo, apply as one path.
- Ask of any restore: who else holds this row's id? A stored payload, a foreign
  key and a client cache all count.
- Take the owner from the record doing the restore (the card's `userId`), never
  from the stored copy.

## Related Files

- `server/storage/pantry.ts` — `restorePantryItemsUnderCap`
- `server/services/write-cards/pantry.ts` — `revertPantrySave`
- `server/services/write-cards/__tests__/pantry.test.ts` — "saved, undone and saved again"

## See Also

- [an unreadable amount is dropped](an-unreadable-amount-widened-to-the-destructive-default-2026-11-16.md) — the other pantry card defect found after merge
