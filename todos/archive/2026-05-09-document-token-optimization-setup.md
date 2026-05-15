---
title: "Document token optimization setup"
status: backlog
priority: low
created: 2026-05-09
updated: 2026-05-09
assignee:
labels: [documentation, dx]
---

# Document Token Optimization Setup

## Summary

Document the token-saving infrastructure set up on 2026-05-09 so future contributors (and Claude sessions) understand why things are wired the way they are.

## Background

A series of changes were made to reduce Claude Code token consumption:

1. **GitHub Actions CI** (`.github/workflows/ci.yml`) — runs lint, type check, accessibility/color/IDOR checks, and the full test suite on every push. This removes Claude's obligation to self-verify after changes.
2. **Pre-commit slimmed** (`.husky/pre-commit`) — now runs only `lint-staged` (ESLint fix + Prettier on staged files). Removed `tsc --noEmit` and `test:unit` from the hook; CI is the quality gate.
3. **kimi-review replaces code-reviewer subagent** — `kimi-review --scope "..." --base main | grep -A2 'CRITICAL\|WARNING'` diffs only changed lines and filters to actionable findings only. SUGGESTION tier is stripped before output returns to Claude context.
4. **ask-kimi for pattern lookups** — instead of Claude reading `docs/patterns/` files directly, `ask-kimi --paths docs/patterns/[relevant].md` offloads the read.
5. **CLAUDE.md trimmed** — iOS Simulator and Physical Device Setup sections (~120 lines) replaced with a one-liner reference to `docs/DEV_SETUP.md`.
6. **Repo memory seeded** — `/memories/repo/ocrecipes-architecture.md` stores schema, nav, services, and stack facts so Claude doesn't re-read source files each session.

## Acceptance Criteria

- [ ] Add a `docs/CONTRIBUTING.md` or `docs/AI_WORKFLOW.md` explaining the CI setup and why tests aren't run locally before commits
- [ ] Document the kimi-\* tool suite (kimi-review, kimi-challenge, ask-kimi, kimi-write, extract-chat) and when to use each
- [ ] Explain the `grep -A2 'CRITICAL\|WARNING'` filter pattern and why SUGGESTION tier is excluded
- [ ] Note that CLAUDE.md is gitignored intentionally (AI instruction file, not project source)
- [ ] Reference `docs/DEV_SETUP.md` as the canonical iOS/device setup source

## Implementation Notes

A `docs/AI_WORKFLOW.md` is the right home — keeps it separate from `CONTRIBUTING.md` which is developer-facing, not AI-agent-facing.

Could also be a section in `docs/ARCHITECTURE.md` under a "Development Tooling" heading.

## Dependencies

- None — purely documentation

## Risks

- None

## Updates

### 2026-05-09

- Initial creation — deferred from token optimization session
