<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Brief descriptive title"
status: backlog
priority: low
created: YYYY-MM-DD
updated: YYYY-MM-DD
assignee:
labels: []
github_issue:

# Optional — only add these when this todo carries a machine-checkable do-not-touch gate.

# See "Date & Human-Led Gates" in todos/README.md for the full convention and semantics.

# blocked_until: YYYY-MM-DD

# blocked_reason: "why, and what to re-check before unblocking"

# human_led: true

---

# Title

## Summary

A brief 1-2 sentence description of what needs to be done and why.

## Background

Context and motivation for this work. Why is it needed? What problem does it solve?

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Implementation Notes

Technical details, approach suggestions, or constraints to consider.

## Scope Contract

<!-- Optional but recommended. The executor stays inside the stated contract. A file
     outside it is a CRITICAL (blocking) finding unless an acceptance criterion genuinely
     needs it AND it is disclosed under an "Out of contract" heading in the PR body with
     that reason — see docs/AI_WORKFLOW.md → Tier handling. Delete this section only if
     scope is genuinely open-ended. -->

- **Mechanisms to use:** <e.g. "the standard `blocked_until` frontmatter gate — nothing new">
- **Files in scope:** <exact paths or narrow globs>
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- List any blocking dependencies
- External services or APIs needed
- Other todos that must be completed first

## Risks

- Potential issues or challenges
- Areas of uncertainty

## Updates

### YYYY-MM-DD

- Initial creation

<!--
Add dated entries as work progresses:
### 2026-01-15
- Started implementation
- Discovered issue with X, need to research Y
-->
