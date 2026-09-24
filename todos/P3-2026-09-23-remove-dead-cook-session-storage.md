---
title: "Remove client/lib/cook-session-storage.ts — it has no consumers"
status: backlog
priority: low
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, code-quality]
github_issue:
---

# Remove client/lib/cook-session-storage.ts — it has no consumers

## Summary

`saveCookSessionBackup` / `loadCookSessionBackup` / `clearCookSessionBackup` have no consumers anywhere in `client/`.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **L13** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- `client/lib/cook-session-storage.ts` — the reliability reviewer found zero consumers. Its corrupt-JSON handling is correct, so this is dead code rather than a live defect.
- Confirm with LSP findReferences (not grep) before deleting, per docs/rules/lsp.md. Also check whether any persisted AsyncStorage key it wrote needs a one-time cleanup.

## Acceptance Criteria

- [ ] LSP findReferences confirms zero consumers for each export
- [ ] The file and its tests are deleted; knip/type-check clean
- [ ] Decide whether the orphaned AsyncStorage key needs clearing (note the decision)

## Implementation Notes

Deletion-only change.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/lib/cook-session-storage.ts`
  - its `__tests__/` file
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- If a cook-session backup feature is planned, confirm with the owner before deleting.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (L13).
