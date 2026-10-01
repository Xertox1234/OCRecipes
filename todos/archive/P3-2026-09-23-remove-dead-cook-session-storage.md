---
title: "Remove client/lib/cook-session-storage.ts — it has no consumers"
status: done
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

- [x] LSP findReferences confirms zero consumers for each export (LSP was non-functional this session — hover/documentSymbol/findReferences returned empty even on known-good symbols like `withOpacity`; fell back to exhaustive repo-wide grep, `git log -S`, and reading candidate files per the fallback instruction — see Updates)
- [x] The file and its tests are deleted; knip/type-check clean (no `knip` tool/config exists in this repo; `npm run check:types` is the applicable substitute)
- [x] Decide whether the orphaned AsyncStorage key needs clearing (note the decision) — see Updates: no cleanup needed

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

### 2026-09-24 — Executed

- **LSP status**: non-functional this session (hover on the canonical warm-up symbol `withOpacity` in `client/constants/theme.ts` and `documentSymbol` on both that file and `cook-session-storage.ts` all returned empty, even though both files are non-trivial and well-formed — a false "zero" from a broken server would be indistinguishable from a true zero). Fell back to an exhaustive repo-wide grep per the fallback instruction: unfiltered `grep -rn "cook-session-storage" .` (excluding `node_modules`/`.git`), a named-export grep (`saveCookSessionBackup`/`loadCookSessionBackup`/`clearCookSessionBackup`), an AsyncStorage-key-string grep (`cook_session_backup`), and `git log -S <symbol>` for full-history confirmation (not just working-tree grep).
- **Consumers found**: none in production code. Two non-production hits, both handled:
  - `client/lib/__tests__/cook-session-storage.test.ts` — the file's own test; deleted alongside it.
  - `scripts/__tests__/todo-automerge-guard.test.ts:552` — a string fixture asserting the automerge guard's path-classification regex does NOT flag `client/lib/cook-session-storage.ts` as sensitive (a false-positive regression test for the "session-storage" naming pattern). It never touches the filesystem, so it still passes after deletion. Left as-is — editing `scripts/` is outside this todo's Scope Contract and would flip the PR to `SENSITIVE_OVERRIDE` HOLD for no benefit. Flagged as a likely reviewer SUGGESTION, not a fix.
- **`git log -S` full-history check**: `saveCookSessionBackup`/`cook-session-storage`/`cook_session_backup` each appear only in `145893a8` (file added, part of "Cook & Track client screens and tests") and `2305e1e4` (added the 194-line test file only — `git show --stat` confirms no production file in that commit imports it). No commit ever wired this module into a consumer. It was dead on arrival, not a regression.
- **AsyncStorage key decision**: **no cleanup needed.** `saveCookSessionBackup` (the only writer of the `cook_session_backup` key) was never called from any shipped code path in this repo's history, so the key was never written to any real device's AsyncStorage. There is nothing to clear.
- **Planned-feature check** (Risks section): searched `todos/`, `todos/archive/`, and `docs/` for any plan depending on this module.
  - `todos/archive/cook-session-race-condition-tests.md` (created 2026-03-09, frontmatter still says `status: backlog` despite being physically archived) names `cook-session-storage.ts`'s "debounce" as a test target alongside `CookSessionCaptureScreen.tsx`/`useCookSession.ts`. Its premise doesn't match the code: the file has no debounce (plain `AsyncStorage.setItem`/`getItem`), and neither `useCookSession.ts` nor `CookSessionCaptureScreen.tsx` reference backup/resume/AsyncStorage at all (verified by grep). This todo was effectively superseded/abandoned without being wired up — not an active plan.
  - `docs/mutation-testing/{README,baselines}.md` reference `cook-session-merge`, a _different_, server-side module (`server/lib/cook-session-merge.ts`) — unrelated to this client file. No mutation-testing target depends on the deleted file.
  - No other `docs/` hit referenced the AsyncStorage-backed backup/resume mechanism.
  - Conclusion: no cook-session backup feature is currently planned. Safe to delete.
- **Solutions read-back**: `docs/solutions/best-practices/cleanup-audit-ts-prune-completeness-and-intentional-unused-2026-06-09.md` (broad-glob match, not a tight short-circuit match) explicitly warns that a zero-caller export can still be a deliberately-kept, rule-prescribed helper. Checked `docs/rules/client-state.md`, `docs/rules/testing.md`, `docs/rules/typescript.md` (the domains this file maps to) — none names `cook-session-storage.ts` or its exports. Not a rule-prescribed helper.
- Files deleted: `client/lib/cook-session-storage.ts`, `client/lib/__tests__/cook-session-storage.test.ts` (10 `it()` blocks removed).
