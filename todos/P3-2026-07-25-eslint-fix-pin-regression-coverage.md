---
title: "Assert the eslint-fix relative-path pin, and tidy two test-hygiene nits in test-pr-preflight-guard.sh"
status: backlog
priority: low
created: 2026-07-25
updated: 2026-07-25
assignee:
labels: [deferred, testing, hooks]
github_issue:
---

# Assert the eslint-fix relative-path pin, and tidy two test-hygiene nits in test-pr-preflight-guard.sh

## Summary

Three non-blocking findings from the pre-merge review of PR #718 (merged as `4e5074a4`).
The load-bearing one: `eslint-fix.sh`'s new relative-path pin guards a **write** path and
has zero regression coverage — removing it entirely leaves the suite green.

## Background

PR #718 made `.claude/settings.json` register hooks by absolute path, and moved
`eslint-fix.sh`'s `npx eslint --fix` into a `cd` to the project root so the eslint binary
and flat config are discovered from the project rather than the agent's cwd.

That `cd` changed what a _relative_ `file_path` resolves against, so the commit added:

```bash
case "$FILE" in /*) ;; *) FILE="$PWD/$FILE" ;; esac
```

The reviewer verified empirically that reverting `eslint-fix.sh` to its pre-pin version
still yields **8 passed, 0 failed** in `test-eslint-fix.sh`. The line executes on every
test case, but its _effect_ is never asserted: `test-eslint-fix.sh:66` looks for the needle
`server/foo.ts`, which matches as a suffix of the absolute path either way.

PR #718 exists partly because a test silently stopped testing its own claim
(`test-pr-preflight-guard.sh` test 13). Shipping that fix alongside a new unasserted
write-path behavior is the same footgun one level down — hence this todo.

## Acceptance Criteria

- [ ] `test-eslint-fix.sh` gains a case whose stub `npx` echoes `"$@"`, invoked from a
      **subdirectory** with `file_path: "foo.ts"`, asserting the eslint argument is
      `<subdir>/foo.ts` and NOT `<project-root>/foo.ts`
- [ ] That assertion is mutation-checked: reverting `eslint-fix.sh:30`'s pin turns it RED
      (the whole point — the current suite does not)
- [ ] `test-pr-preflight-guard.sh` test 14's comment corrected — it claims the fixture
      keeps "git + stamp helper still resolve", but since `ROOT` became
      `${BASH_SOURCE[0]}`-derived the `NOLIB` copy's root is the `mktemp` dir's grandparent,
      which has no stamp helper. The DENY still proves "no fail-OPEN on an unsourceable
      lib" but no longer attributes the denial to the lib alone. Documentation accuracy
      only — verified not to be a coverage hole (the fail-open mutation still turns it red).
- [ ] `test-pr-preflight-guard.sh` `EXIT` trap extended to clean `HELPER_T` and `NOLIB`
      (currently inline-only, so an interrupted/SIGTERM'd run leaks two `mktemp -d` trees):
      `trap 'rm -f "$STAMP_FILE"; rm -rf "${HELPER_T:-}" "${NOLIB:-}"' EXIT`, with both vars
      pre-initialized empty near the top to satisfy `set -u`
- [ ] Full `bash scripts/run-hook-tests.sh` green

## Implementation Notes

- Files in scope: `.claude/hooks/test-eslint-fix.sh`, `.claude/hooks/test-pr-preflight-guard.sh`.
  No change to `eslint-fix.sh` itself is expected — the pin is correct, it is only unasserted.
- `test-eslint-fix.sh` already stubs `npx` on PATH (`make_stub_npx`, line ~11) and is
  hermetic; the new case extends that stub to echo its arguments rather than adding a
  new mechanism.
- Keep bash-3.2 compatible (macOS ships 3.2) — no `mapfile`/`declare -A`.
- The convention this enforces is codified in
  `docs/solutions/conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md`.

## Dependencies

- None. PR #718 is merged (`4e5074a4`).

## Risks

- Low. Test-only changes; no runtime hook behavior is modified.

## Updates

### 2026-07-25

- Filed from the pre-merge review of PR #718. All three findings were rated non-blocking
  by the reviewer, which is why #718 merged without them.
