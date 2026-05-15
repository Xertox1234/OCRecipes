---
title: "Pattern injection spills to /tmp on 4-domain edits"
status: backlog
priority: low
created: 2026-05-12
updated: 2026-05-12
assignee:
labels: [deferred, hooks, infrastructure]
github_issue:
---

# Pattern injection spills to /tmp on 4-domain edits

## Summary

`.claude/hooks/inject-patterns.sh` overflows its 9KB threshold and spills to `/tmp/ocrecipes-injection-context.md` on virtually every realistic file edit, because most files match 4 domains (the matched-domain TOCs plus rules-files baseline of ~5.4 KB consistently exceed the budget).

## Background

After the Phase 1 hook refactor (commit `8fa374d3`, 2026-05-12), the hook:

- Removed the LEARNINGS.md basename-grep block (pure noise removal).
- Replaced `head -n 80` pattern excerpts with a line-numbered TOC of first 12 + last 13 subsection headings per matched domain.

These were strict improvements over the prior state, but they did **not** eliminate the spill behavior. Almost every file edit in this repo triggers 4 domains:

- `client/screens/*.tsx` → react-native + design-system + accessibility + typescript
- `server/routes/*.ts` → api + security + architecture + typescript
- `client/hooks/*.ts` → hooks + client-state + react-native + typescript
- `server/storage/*.ts` → database + security + architecture + typescript

The four rules files alone consume ~5,400 bytes (60% of the 9,000-byte threshold) before any TOC content is injected. Output therefore truncates to 8,800 bytes with a `TRUNCATED` marker pointing Claude to the spill file.

**Why deferred:** Phase 2 of the research doc (`docs/research/pattern-codification-alternatives.md`) decomposes `docs/patterns/*.md` and `docs/LEARNINGS.md` into `docs/solutions/<category>/`. Once the hook injects solution frontmatter instead of multiple full rules files + TOCs, the byte budget is no longer pressured and this problem dissolves structurally. Engineering local fixes to a system that's about to be replaced is wasted effort.

**Trigger conditions for picking this up:**

- (a) Phase 2 gets cancelled or significantly delayed
- (b) The spill mechanism causes real problems in practice (Claude failing to follow the spill marker; serial Read storms on the spilled content; etc.)

## Acceptance Criteria

- [ ] Decision documented for which mitigation option to apply (see Implementation Notes for the (a)-(d) menu)
- [ ] If picked up: hook output stays under 9000 bytes on the four representative file paths above (no `TRUNCATED` marker present)
- [ ] Spill mechanism preserved as a fallback for genuine overflow edge cases (rules growth, future domain stacking)

## Implementation Notes

Options surveyed in the 2026-05-11/12 session:

- **(a) Suppress `typescript` domain stacking when any other domain matched.** Cleanest immediate win — typescript rules are mostly general knowledge anyway; project-specific TS conventions are covered by more-specific domains. One-line change in the path-to-domain mapping (currently lines 84-86 of `inject-patterns.sh`). Typescript domain still injects when no other domain matched (e.g. pure type-utility files in `shared/`).
- **(b) Tighten TOC to 10 entries (head 5 + tail 5) instead of 25.** Smaller information surface — loses meaningful subsections from both ends.
- **(c) Raise threshold from 9000 to 14000.** ⚠ **Unsafe — do not pursue.** Claude Code's hard hook-output cap is ~10K. Raising threshold past that pushes truncation from clean-script-side to dirty-platform-side (silent clipping).
- **(d) Do nothing — let Phase 2 supersede.** **Current choice as of 2026-05-12.**

Files in scope: `.claude/hooks/inject-patterns.sh` only.

If trigger (b) fires (the spill mechanism is shown to cause failures in practice), default to option (a).

## Dependencies

- Phase 2 of pattern codification work (`docs/research/pattern-codification-alternatives.md` Section 4 Phase 2). If Phase 2 is on track, this todo stays parked.

## Risks

- Option (a) might surface rare cases where typescript-specific rules were the only relevant guidance for a `.ts`/`.tsx` file that doesn't match any other domain. Mitigation: keep typescript as the fallback when no other domain matched (already implicit in the proposal).
- Underlying assumption: Phase 2 actually happens. If Phase 2 is indefinitely parked (e.g. for cost or curation reasons), this todo should be promoted to in-progress within ~30 days.

## Updates

### 2026-05-12

- Initial creation. Spill problem identified during Phase 1 hook refactor (commit `8fa374d3`). Options (a)-(d) surveyed; (d) chosen for now pending Phase 2.
