<!-- Filename: P3-2026-07-09-transcripts-test-pipefail-epipe-flake.md -->

---

title: "test-pg-lab-transcripts.sh assert helpers can flake under pipefail (printf | grep -q EPIPE)"
status: backlog
priority: low
created: 2026-07-09
updated: 2026-07-09
assignee:
labels: [deferred, testing]
github_issue:

---

# test-pg-lab-transcripts.sh assert helpers can flake under pipefail

## Summary

`.claude/hooks/test-pg-lab-transcripts.sh` uses `printf '%s' "$2" | grep -qF -- "$3"` in its
`assert_contains` helper under `set -uo pipefail`. When `grep -q` finds its match early it
exits immediately, the still-writing `printf` takes EPIPE and returns 1, and `pipefail`
reports the pipeline failed — a FOUND needle intermittently asserts as "missing".

## Background

The same latent bug was observed live in `test-pg-lab-distill.sh` on 2026-07-09 (the
`report: spend line` assertion flaked ~1 in 6 runs with `printf: write error: Broken pipe`
in the output) and fixed there by switching the helpers to herestrings
(`grep -qF -- "$3" <<<"$2"`), which the shell fully buffers before grep runs, so there is no
writer left to break. See commit e7c7623 on branch `pg-lab/episodic-distillation`.
The transcripts test copied the same helper shape and is equally exposed; larger captured
outputs make the race more likely, not less.

## Acceptance Criteria

- [ ] `assert_contains` (and any `assert_not_contains`) in `test-pg-lab-transcripts.sh` no
      longer pipes `printf` into `grep -q` (herestring or pure-bash `case` match instead)
- [ ] Full test file passes: `bash .claude/hooks/test-pg-lab-transcripts.sh`
- [ ] Grep the other `.claude/hooks/test-*.sh` files for the same `printf ... | grep -q`
      pattern under pipefail and fix any other instances in the same PR

## Implementation Notes

- Exact fix shape (from test-pg-lab-distill.sh):
  `assert_contains() { if grep -qF -- "$3" <<<"$2"; then echo "ok: $1"; else echo "FAIL: $1 — missing: $3"; FAIL=1; fi; }`
- Files in scope: `.claude/hooks/test-pg-lab-transcripts.sh` line 19 (helper definition);
  sweep the rest of `.claude/hooks/test-*.sh` per AC3.
- One-line mechanical change per file; no behavior change to what is asserted.

## Dependencies

- None.

## Risks

- Herestrings append a trailing newline — irrelevant for `-q` substring checks, but do not
  reuse the pattern for exact-match (`grep -qx`) assertions without checking.

## Updates

### 2026-07-09

- Initial creation (observed live in the distill test during pg-lab/episodic-distillation work; fixed there, sibling left for this todo).
