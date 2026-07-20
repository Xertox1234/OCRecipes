---
title: "inject-patterns.sh: extract an append_log_record() helper for the 4 duplicated LOG_TSV printf sites; consolidate the agent_id contract prose"
status: backlog
priority: low
created: 2026-07-20
updated: 2026-07-20
assignee:
labels: [deferred, harness, injection]
github_issue:
---

# Extract append_log_record() and consolidate the telemetry-contract prose

## Summary

PR #673's review (2026-07-20) confirmed two maintainability items that were deferred
from its fix round as refactor-grade rather than defects:

1. The `\x1f`-delimited LOG_TSV record printf now exists as 4 mechanically identical
   copies in `.claude/hooks/inject-patterns.sh` (pointer / pre-estimate deferred /
   exact-size deferred / injected call sites), all sharing 5 context-fixed fields
   (`$SESSION $TOOL_NAME $FILE_PATH $DOMAIN ... $AGENT_ID`), varying only in
   (action, bytes, doc_ids). This was the second lockstep field sweep (doc_paths was
   the first); the next one is another 4-site edit where a single transposed argument
   writes misaligned rows into an append-only, fail-silent ledger.
2. The agent_id/8-field contract prose is restated in ~4 places (log-injection.sh
   header — the canonical owner — plus schema comment, session-recent-issues.sh
   comment, and test comments), which will drift on the next field addition.

## Acceptance Criteria

- [ ] A single `append_log_record <action> <bytes> <doc_ids>` helper in
      `.claude/hooks/inject-patterns.sh` replaces the 4 printf call sites (verified
      safe under `set -uo pipefail`; all fixed fields are initialized before the
      domain loop and the calls sit directly in the loop body — no subshells).
      `session-recent-issues.sh`'s copy stays independent (separate process, different
      fixed fields).
- [ ] Contract prose consolidated: full wire-format contract lives only in
      `scripts/pg-lab/log-injection.sh`'s header; other sites keep one line of
      site-specific rationale plus a pointer to it.
- [ ] `.claude/hooks/test-inject-patterns.sh` (incl. the injected-path AND
      pointer-path producer-wiring asserts) and
      `.claude/hooks/test-pg-lab-log-injection.sh` stay green — they are the
      regression net proving the helper emits byte-identical records.

## Implementation Notes

- `.claude/hooks/inject-patterns.sh` — LOG_TSV call sites (locate via
  `grep -n 'LOG_TSV=' .claude/hooks/inject-patterns.sh`); helper shape validated by
  the 2026-07-20 review verifier (dynamic scoping of `$DOMAIN` from the loop body is
  fine; command-substitution args evaluate at call time in the caller).
- `scripts/pg-lab/log-injection.sh` — header comment is the contract owner; leave it.
- `scripts/pg-lab/schema/injection-log.sql`, `.claude/hooks/session-recent-issues.sh`,
  `.claude/hooks/test-pg-lab-log-injection.sh` — trim restated contract prose to
  pointer + one site-specific line.

## Dependencies

- None (PR #673 merged with the review fixes; this is pure refactor on top).

## Risks

- Behavior-neutral refactor of a live hot-path hook — the byte-identical
  on/off/DB-down assertion and both producer-wiring asserts in
  `test-inject-patterns.sh` are the guardrails; do not change record content.
