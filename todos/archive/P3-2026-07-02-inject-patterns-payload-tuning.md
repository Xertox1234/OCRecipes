<!-- Filename: P3-2026-07-02-inject-patterns-payload-tuning.md -->

---

title: "inject-patterns: dedup the DISCIPLINE preamble per session and split >9KB domain payloads"
status: backlog
priority: low
created: 2026-07-02
updated: 2026-07-02
assignee:
labels: [deferred, harness]
github_issue:

---

# inject-patterns: dedup the DISCIPLINE preamble per session and split >9KB domain payloads

## Summary

Two token-waste fixes in the pattern-injection hook, from the 2026-07-02 harness audit
(`docs/research/2026-07-02-harness-audit.md`).

## Background

(1) The ~1.1KB DISCIPLINE preamble (`inject-patterns.sh:93-104`) re-injects on EVERY
Edit/Write — the per-session dedup at `:279-282` covers domain payloads only. A long session
with hundreds of edits carries tens of KB of repeated preamble, which itself works against
the drift goal. (2) The two most-edited path domains exceed the 9,000-byte spill threshold
(`:319`) — client/components resolves to react-native+design-system+accessibility+performance
= 12,257B of rules; server/routes = 9,512B — so the FIRST edit in those areas truncates to a
spill file and demands an extra Read.

## Acceptance Criteria

- [ ] The DISCIPLINE preamble is injected at most once per session (reuse the existing
      dedup-state file at `/tmp/ocrecipes-pattern-inject-<session>`); subsequent edits get a
      one-line pointer at most
- [ ] A first-touch edit to `client/components/` and to `server/routes/` injects without
      hitting the spill-file truncation path (trim rules files and/or raise the cap and/or
      inject rules-per-domain incrementally — pick the simplest)
- [ ] `test-inject-patterns.sh` covers the preamble dedup behavior
- [ ] Gate C equivalence (DB path == markdown path) still holds — or is already deleted if
      P3-2026-07-02-solutions-kb-markdown-canonical landed first
- [ ] `npm run preflight` green

## Implementation Notes

Files in scope: `.claude/hooks/inject-patterns.sh`, `.claude/hooks/test-inject-patterns.sh`,
possibly `docs/rules/react-native.md` / `design-system.md` / `accessibility.md` /
`performance.md` / `security.md` / `api.md` (if trimming rules is the chosen fix).

If the solutions-kb-markdown-canonical todo lands first, this becomes a single-path edit
(markdown only) — prefer that ordering.

Executor note: touches `.claude/hooks/` — the automerge guard will correctly HOLD it for
individual review.

## Risks

- Dedup keyed on session file: verify-behavior when the temp file is missing/wiped mid-session
  (should fail open to full injection).
