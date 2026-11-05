---
title: "finderBlock-from-metadata parser duplicated client and server"
status: done
priority: low
created: 2026-11-05
updated: 2026-11-05
assignee: claude
labels: [audit, maintainability, shared]
github_issue:
---

# finderBlock-from-metadata parser duplicated client and server

## Summary

M7: `client/components/recipe-finder/recipe-finder-utils.ts` `finderBlockFromMessageMetadata` and `server/services/recipe-finder/entry.ts` `finderBlockFromMetadata` are byte-identical parsers of the stored message-metadata contract.

## Acceptance Criteria

- [x] One `finderBlockFromMetadata` in `shared/schemas/recipe-finder.ts` next to `finderBlockSchema`
- [x] Client + server import it (keep existing export names as re-exports only if callers need them)
- [x] Existing tests pass; a shared test covers both stored shapes

## Scope Contract

- **Files in scope:** the two files above, `shared/schemas/recipe-finder.ts`, their tests
