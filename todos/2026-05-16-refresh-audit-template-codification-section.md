---
title: "Refresh stale paths in the audit manifest Codification section"
status: backlog
priority: low
created: 2026-05-16
updated: 2026-05-16
assignee:
labels: [deferred, docs]
github_issue:
---

# Refresh stale paths in the audit manifest Codification section

## Summary

The `## Codification` section of `docs/audits/TEMPLATE.md` still references the
deleted `docs/patterns/` directory and a "Phase 7" lifecycle that no longer
matches the audit skill. Update it to the current `docs/solutions/` knowledge-base
layout.

## Background

Surfaced during the final review of the audit-research-phase branch
(`feat/audit-research-phase`, May 2026). That branch deliberately scoped its
`TEMPLATE.md` edits to adding a `Research` column and fixing one heading, so the
stale Codification content was left untouched to keep the change surgical.

The `docs/patterns/` directory was removed in the Phase 2 pattern-codification
refactor (2026-05); codified knowledge now lives in `docs/solutions/<category>/`.
The audit skill's Phase 8 (`.claude/skills/audit/SKILL.md`) already codifies into
`docs/solutions/`, so the template's Codification tables are out of sync with the
workflow that fills them in.

## Acceptance Criteria

- [ ] `docs/audits/TEMPLATE.md` "Patterns Extracted" table no longer references
      `docs/patterns/?.md`; it points to `docs/solutions/<category>/` instead
- [ ] Any other `docs/patterns/` reference in the file is updated or removed
- [ ] The Codification section's column headings and "Added To" targets match
      what Phase 8 of the audit skill actually produces (solution files, rules
      files, agent updates)
- [ ] No findings-table or Summary content is altered — scope is the Codification
      section only

## Implementation Notes

- File in scope: `docs/audits/TEMPLATE.md` only (the Codification section,
  roughly the "## Codification (Phase 8)" block onward).
- Cross-check against `.claude/skills/audit/SKILL.md` Phase 8 and
  `.claude/skills/codify/SKILL.md` for the authoritative current routing
  (solutions categories, `docs/rules/<domain>.md`, specialist-agent updates).
- This is documentation-only; no code, no tests.

## Dependencies

- None.

## Risks

- Low. Template-only change; worst case is a slightly inaccurate template until
  corrected.

## Updates

### 2026-05-16

- Initial creation — deferred from the `feat/audit-research-phase` final review.
