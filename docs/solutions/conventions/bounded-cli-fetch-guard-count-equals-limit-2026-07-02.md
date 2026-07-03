---
title: A --limit-bounded CLI fetch must treat count == limit as truncated — never comment current headroom
track: knowledge
category: conventions
module: shared
tags: [gh, cli, pagination, limit, truncation, sweep, magic-constants, drift, shell]
applies_to: [.claude/skills/**/*.md, scripts/*.sh, .github/workflows/*.yml]
created: '2026-07-02'
---

# A --limit-bounded CLI fetch must treat count == limit as truncated — never comment current headroom

## Rule

When a script or agent instruction fetches with a fixed cap (`gh pr list --limit 1000`,
paged API reads), guard at runtime: **if the returned count equals the limit, the data is
truncated** — treat any decision derived from it as unreliable (skip destructive actions
for this run, surface a note). Never document the current headroom in a comment
("≈490 PRs as of 2026-07") — that constant decays silently and no one is watching it.

## Why

`gh pr list` returns newest-first, so truncation drops the **oldest** records — for a
stale-branch sweep those are exactly the merged PRs it needs, making a truncated page
indistinguishable from a complete one without the count check. The breach is silent: the
command exits 0, the output looks normal, and the sweep just stops seeing old branches.
At this repo's PR rate (~5.8/day at review time) the documented "comfortable" limit of
1000 would have been breached within months of the comment being written.

## Examples

- `.claude/skills/todo/SKILL.md` Phase 0: one fetch to `/tmp/todo-all-prs.json`, then
  `if [ "$(jq 'length' /tmp/todo-all-prs.json)" -eq 1000 ]` → skip branch deletion this
  run and note it in the Phase 5 summary. The open-PR list (recent, unaffected by
  oldest-first truncation) is still kept as best-available data.

## Exceptions

- Read-only convenience listings where truncation only costs report completeness (no
  destructive follow-up action) can log the cap without skipping anything.
- True cursor pagination that walks to exhaustion has no cap to guard — this rule is for
  single-shot bounded fetches.

## Related Files

- `.claude/skills/todo/SKILL.md` — Phase 0 sweep, count==limit guard

## See Also

- [machine-routed values need an enum](machine-routed-values-need-enum-not-prose-2026-07-02.md) — sibling finding from the same review: the fix shape is "make the mechanism self-checking, not the comment more accurate"
