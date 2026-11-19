---
title: "A typed error that shared route code checks with instanceof must live in a module route tests don't mock"
track: knowledge
category: conventions
tags: [testing, typescript, api]
module: server
applies_to: ["server/routes/_helpers.ts", "server/storage/**/*.ts", "server/routes/**/*.ts"]
created: '2026-11-19'
---

# A typed error that shared route code checks with instanceof must live in a module route tests don't mock

## Rule

When shared error handling (`handleRouteError` in `server/routes/_helpers.ts`)
checks `error instanceof SomeStorageError`, import the class from its own small
module (`server/storage/grocery-list-errors.ts`), not through the
`server/storage/index.ts` facade.

## Why

Most route tests replace `../storage` with a factory
(`vi.mock("../../storage", () => ({ storage: { … } }))`). A class re-exported
only through that facade is `undefined` inside the mock, and
`error instanceof undefined` throws a TypeError — in the shared handler, so
every route test that reaches an error path breaks, not just the one that
exercises the new class. A dedicated module is never mocked, so the class is
the real one everywhere.

## Examples

- `GroceryListNotFoundError` (reliability audit 2026-11-19, L-obs-2): thrown by
  `insertGroceryListItemsUnderCap`, mapped to 404 in `handleRouteError`,
  imported by tests from `../../storage/grocery-list-errors`.

## Exceptions

A class used only inside one route file that its own test mocks with
`importOriginal` (spreading the real exports) can stay behind the facade, as
`BatchStorageError` and `ReservedUsernameError` do.

## Related Files

- `server/storage/grocery-list-errors.ts`
- `server/routes/_helpers.ts` — `handleRouteError`

