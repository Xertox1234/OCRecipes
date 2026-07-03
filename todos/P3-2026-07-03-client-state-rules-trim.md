<!-- Filename: P3-2026-07-03-client-state-rules-trim.md -->

---

title: "Trim docs/rules/client-state.md under the 6,500B injection cap, then remove its grandfather entry"
status: backlog
priority: low
created: 2026-07-03
updated: 2026-07-03
assignee:
labels: [deferred, harness, client-state]
github_issue:

---

# Trim docs/rules/client-state.md under the 6,500B injection cap, then remove its grandfather entry

## Summary

`client-state.md` (8,443B) is the last rules file too large for whole-unit injection: it
alone plus the DISCIPLINE preamble exceeds the 9,000B threshold, so a fresh-session
first-touch edit of any client-state-only path (`client/context/*`, `client/lib/*`)
byte-truncates to the spill file today — the PR #492 deferral mechanism cannot help because
the first matched domain always emits. From the PR #492 review (altitude finding 2).

## Background

`scripts/check-rules-file-size.js` (landed on PR #492) caps `docs/rules/*.md` at 6,500B via
lint-staged, derived from: THRESHOLD 9,000 − preamble ~1,290 − block header + solution refs
~840. `client-state.md` carries a FROZEN grandfather cap of 8,500B in that script — it may
shrink but not grow — pending this trim.

Precedent: `accessibility.md` went 6,547 → 4,582B by consolidating a rule family that
restated shared exceptions 2-3× across bullets, with a reviewer verifying zero binding rules
lost (PR #492). Expect the same mechanism here: look for repeated exceptions/precedents
across the TanStack Query bullets. The trim doc is
`docs/solutions/conventions/rules-files-stay-terse-for-inline-injection-budget-2026-06-05.md`.

## Acceptance Criteria

- [ ] `docs/rules/client-state.md` ≤ 6,500 bytes with every binding rule, exception, and
      actionable nuance preserved (verify old→new statement-by-statement, ideally via
      mobile-reviewer — client-state is its lane)
- [ ] The `GRANDFATHERED` entry for client-state.md removed from
      `scripts/check-rules-file-size.js`; `node scripts/check-rules-file-size.js` green
- [ ] Fresh-session first-touch edit of a `client/context/*` path injects without the
      TRUNCATED marker (measure with the hook directly)
- [ ] `bash .claude/hooks/test-inject-patterns.sh` green
- [ ] `npm run preflight` green

## Implementation Notes

Files in scope: `docs/rules/client-state.md`, `scripts/check-rules-file-size.js`.
Optionally add a first-touch no-truncation test for a client-state-only path to
`test-inject-patterns.sh` once it fits.

Measure before/after: `printf '{"session_id":"x","tool_name":"Edit","tool_input":{"file_path":"client/context/AuthContext.tsx"}}' | bash .claude/hooks/inject-patterns.sh | jq -r '.hookSpecificOutput.additionalContext' | wc -c`

Executor note: touches `docs/rules/` — content-sensitive; the trim is consolidation, not
deletion. Run `npm run build:copilot-instructions` after (currently a no-op for rule bodies,
but CI checks it).

## Risks

- Losing a binding nuance in consolidation — mitigate with a statement-by-statement
  old→new trace at review, as done for accessibility.md.
