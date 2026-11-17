---
title: "Platform-check scope treats the server-only expo-server-sdk as an app SDK bump"
status: backlog
priority: low
created: 2026-11-17
updated: 2026-11-17
assignee:
labels: [deferred, harness]
github_issue:
---

# Platform-check scope treats the server-only expo-server-sdk as an app SDK bump

## Summary

`scripts/harness/platform-scope.sh` puts a PR in scope for a real-platform check when a
`package.json` line adds or removes an `expo*` version. `expo-server-sdk` matches that
pattern, but it is a server library (push delivery) and is never part of the app build. A PR
that only bumps it is made to run the full E2E workflow for nothing.

## Background

Found on 2026-11-17 while merging PR 1905 (`expo-server-sdk` 6.1.0 → 8.0.0 with four other
packages). The merge guard asked for an E2E run and a `## Platform check` section. The run
(44188012620) took about an hour on the free runners and exercised no changed code: the app
bundle does not contain `expo-server-sdk`.

Left alone at the time because changing a merge guard was outside a dependency-upgrade task.

- The rule: the `sdk` branch of the awk program in `scripts/harness/platform-scope.sh`
  (`"(expo[^"]*|react-native[^"]*|@expo\/[^"]*|@react-native[^"]*)"`).
- Readers: `.claude/hooks/merge-review-guard.sh` (requires the E2E run) and
  `scripts/todo-automerge-guard.sh` (holds auto-merge).
- The only importer of the package is `server/services/push-notifications.ts`.

## Acceptance Criteria

- [ ] A `package.json` diff that changes only `expo-server-sdk` exits 1 (not in scope) from
      `scripts/harness/platform-scope.sh`.
- [ ] A diff that changes `expo`, `expo-file-system`, `react-native` or an `@expo/*` package
      still exits 0 with an `sdk package.json` line.
- [ ] A diff that changes `expo-server-sdk` together with a real app SDK package still exits 0.
- [ ] Both cases are covered by a test, written to fail first.
- [ ] `docs/AI_WORKFLOW.md` → Review Policy → Real-platform check names the exclusion if it
      lists what counts as an SDK bump.

## Implementation Notes

- Keep the exclusion an explicit, short list of server-only package names (today: one). Do not
  loosen the `expo*` pattern itself: a missed app SDK bump is the failure this guard exists to
  prevent (the SDK 57 upload break, PR 1549).
- `scripts/__tests__/todo-automerge-guard.test.ts` already references the script; check
  whether it or another test file is the right home for the new cases.
- If `scripts/harness/platform-scope.sh` is listed in `scripts/harness/verdict-diff/targets.tsv`,
  the PR also needs `bash scripts/harness/verdict-diff.sh` with its lists under
  `## Verdict changes`.

## Scope Contract

- **Mechanisms to use:** an exclusion inside the existing awk rule; nothing new.
- **Files in scope:** `scripts/harness/platform-scope.sh`, one test file under
  `scripts/__tests__/`, `docs/AI_WORKFLOW.md` (only the Real-platform check paragraph).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- An exclusion that is too wide would let a real app SDK bump skip its E2E run. The
  acceptance criteria pin the cases that must stay in scope.

## Updates

### 2026-11-17

- Initial creation
