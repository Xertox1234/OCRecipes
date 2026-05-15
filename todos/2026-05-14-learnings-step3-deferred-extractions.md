---
title: "Phase 2 Step 3 follow-up: 28 deferred LEARNINGS.md extractions"
status: in-progress
priority: low
created: 2026-05-14
updated: 2026-05-14
assignee:
labels: [deferred, docs, codification, phase-2]
github_issue:
---

# Phase 2 Step 3 follow-up: 28 deferred LEARNINGS.md extractions

## Summary

Phase 2 Step 3 (LEARNINGS.md decomposition) shipped 66 of ~94 planned solution files. 28 entries were planned by an extraction agent but not written before a stall. The dispositions are fully specified in the Step 3 root manifest; this todo is execution-only.

## Background

Three of four agents stalled while processing `docs/LEARNINGS.md` (4,007 lines, 78 sections):

- Original agent: crashed at section 22 (socket timeout, 100 min)
- Agent A (sections 23-50): completed cleanly
- Agent B (sections 51-78): stalled at section 63 (600 s watchdog) but produced a complete disposition manifest before stalling — 19 of its 48 planned files written, 28 unwritten, 1 mis-counted
- Agent C (fill-in for the 28): stalled before any writes (600 s watchdog)

The completed corpus (66 new files) is sufficient to unblock Phase 2 Steps 4-6 (codify-skill rewrite, hook rewrite, monolith retirement). The 28 deferred files are valuable but not load-bearing. Picking them up later under conditions that avoid the stall pattern (smaller scope per agent, manifest-before-files) is the right move.

## Acceptance Criteria

- [ ] All 28 destination files exist at the paths listed in `docs/solutions/_manifests/2026-05-13-learnings.md` "Deferred items" table
- [ ] Each file has valid bug-track or knowledge-track frontmatter per `docs/solutions/README.md`
- [ ] Each file's `created:` matches the incident date from its LEARNINGS section title (e.g., `[2026-03-25]` → `created: 2026-03-25`); for the themed roll-ups (#69-#75) where no incident date applies, `created: 2026-05-13` (the migration batch date)
- [ ] Cross-category `## See Also` links use `../<target-cat>/<slug>.md` prefix
- [ ] Step 3 root manifest updated to reflect completion (status changes from "partial" to "complete")
- [ ] kimi-review on the diff returns no CRITICAL findings; WARNING findings addressed before commit

## Implementation Notes

### Recommended sequencing

1. **Read the spec**: `docs/solutions/_manifests/2026-05-13-learnings.md` "Deferred items" table lists all 28 destination paths and source section search strings. `docs/solutions/_manifests/2026-05-13-learnings-51-78.md` has the full disposition rationale per section.
2. **Read source content per section**: open `docs/LEARNINGS.md` and grep for the search string per row. Each section is typically 30-150 lines.
3. **Use existing files as templates**: any 2026-05-13 file at `docs/solutions/<cat>/` shows the established shape; `docs/solutions/conventions/use-withopacity-for-color-opacity-2026-05-12.md` for knowledge-track, `docs/solutions/runtime-errors/unsafe-type-cast-zod-validation.md` for bug-track.
4. **Cross-link liberally**: many of these files relate to other Step 1-3 conventions. Use `## See Also` with the proper relative-path prefix.

### Stall-resistance notes for next-session agents

The original Step 3 agent slowdown was caused by per-file merge-Jaccard scans across the entire growing corpus (300+ files). The lean Agent A prompt that completed cleanly skipped that scan and defaulted to extract; that approach is the recommended pattern. Do not have the next agent do full Jaccard merge checks.

Scope to ≤10 files per agent. Write manifests _before_ files so stalls preserve maximum recovery value.

### Reference files

- `docs/solutions/_manifests/2026-05-13-learnings.md` — Step 3 root manifest (this is the spec)
- `docs/solutions/_manifests/2026-05-13-learnings-23-50.md` — Agent A's sub-manifest (template)
- `docs/solutions/_manifests/2026-05-13-learnings-51-78.md` — Agent B's full disposition plan (source of dispositions for the 28 deferred items)
- `docs/LEARNINGS.md` — the source to extract from (do NOT edit it)
- `docs/solutions/README.md` — schema

## Dependencies

- None. Step 4-6 of Phase 2 do not require these 28 files to be written first; they operate on the schema and corpus shape, both of which are validated.

## Risks

- **Section content may have inherited bugs** — Step 1 found 1 (WCAG 4.48), Step 2 found 6 (across batches). Run `kimi-review` per ≤10-file batch and address WARNING findings before commit.
- **Cross-link rot** — if future Steps 4-6 rename or reorganize existing files before these 28 are written, the `## See Also` targets in Agent B's plan may stale. Re-verify slugs at write time.

## Updates

### 2026-05-14

- Initial creation. Captures the 28 deferred extractions from Phase 2 Step 3 LEARNINGS.md decomposition. See `docs/solutions/_manifests/2026-05-13-learnings.md` for the canonical disposition spec.
