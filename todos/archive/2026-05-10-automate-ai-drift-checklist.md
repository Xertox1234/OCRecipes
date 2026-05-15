---
title: "Automate AI drift checklist checks"
status: backlog
priority: medium
created: 2026-05-10
updated: 2026-05-10
assignee:
labels: [docs, tooling, automation]
github_issue:
---

# Automate AI drift checklist checks

## Summary

Create a cron-friendly checker for the saved AI drift checklist so periodic workflow-drift checks can run automatically instead of relying on manual review.

## Background

The repo now has a canonical drift checklist at `docs/AI_DRIFT_CHECKLIST.md` with stable IDs, intervals, and automation-friendly checks. The next useful step is a lightweight script or workflow that can read those rows, run the corresponding checks, and report or update status for items like pinned researcher tool bindings, PR tooling drift, retired-agent tombstones, and review-policy inconsistencies.

## Acceptance Criteria

- [ ] Add a documented implementation plan for a checker that reads `docs/AI_DRIFT_CHECKLIST.md` and evaluates rows by stable `id`
- [ ] Define the output/report format for each check result, including `id`, `status`, `checked_at`, `triggering_files`, and `summary`
- [ ] Decide whether the first version should only report results or also update `status`, `last_checked`, `next_check`, and `notes` in `docs/AI_DRIFT_CHECKLIST.md`
- [ ] Cover the pinned researcher binding check for `.claude/agents/todo-researcher.md` as one of the first automated checks
- [ ] Document how the checker should be run on a schedule (for example via cron, GitHub Actions, or another scheduler)

## Implementation Notes

- Prefer a small, deterministic checker over a broad agentic workflow.
- Treat `docs/AI_DRIFT_CHECKLIST.md` as the source of truth for row IDs and intervals.
- The first iteration can be report-only if automatic file edits make scheduling or review too noisy.
- At minimum, support `DRIFT-001` (todo researcher pinned docs bindings) and make it easy to add more checks later.
- Keep the checker aligned with the currently pinned researcher tools: `fetch_webpage`, `github_text_search`, `github_repo`, and `mcp_github_search_code`.

## Dependencies

- `docs/AI_DRIFT_CHECKLIST.md` exists and should remain the canonical checklist
- `.claude/agents/todo-researcher.md` is currently pinned to exact tool names
- No blocking code dependencies yet; implementation approach still needs to be chosen

## Risks

- Tool surfaces may drift again, so the checker itself must avoid baking in fragile assumptions without a clear maintenance path.
- Auto-editing the checklist on a schedule may create noisy diffs if status churn is too frequent.
- Some rows may require manual judgment, so the checker should support `manual-review` outcomes instead of forcing binary pass/fail.

## Updates

### 2026-05-10

- Initial creation
- Created after adding `docs/AI_DRIFT_CHECKLIST.md` and pinning the todo researcher tool bindings

## Copilot Delegation

Eligible low/deferred docs, tests, code-quality, simple performance, and simple refactor todos can be delegated to GitHub Copilot after safety checks:

```bash
npm run copilot:delegate:dry-run -- todos/2026-05-10-automate-ai-drift-checklist.md
npm run copilot:delegate -- todos/2026-05-10-automate-ai-drift-checklist.md
```

When delegation succeeds, paste the created GitHub Issue URL into `github_issue`. Copilot must work by pull request only; do not auto-merge or allow direct commits to `main`.

Do not delegate todos involving JWT/auth, IAP receipt validation, secrets, health-data boundaries, goal-safety behavior, schema/migrations, production data handling, or broad architecture without a human-approved plan.
