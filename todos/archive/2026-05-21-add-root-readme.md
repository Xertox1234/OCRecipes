---
title: "Add a tracked root README.md"
status: done
priority: low
created: 2026-05-21
updated: 2026-05-21
assignee:
labels: [deferred, docs]
github_issue:
---

# Add a tracked root README.md

## Summary

The repo has no tracked root `README.md`, so the GitHub repo landing page is blank. Add a concise README that orients a reader (and Copilot) to the project.

## Background

Surfaced on 2026-05-21 while untracking ~107K lines of AI-workflow docs from GitHub (commit `fc979a8f`). With the repo now leaner on GitHub, the empty landing page is more noticeable. `git ls-files README.md` returns nothing — confirmed there is no tracked root README.

## Acceptance Criteria

- [ ] `README.md` exists at repo root and is tracked in git
- [ ] Covers: one-line product description, stack summary, quick-start (server + Expo) commands, and links to the still-tracked reference docs
- [ ] Links point only to docs that remain on GitHub (e.g. `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`, `docs/DEV_SETUP.md`) — do NOT link `docs/solutions/`, `docs/superpowers/`, `docs/audits/`, `docs/research/`, or `docs/LEARNINGS.md`, which are now gitignored/local-only
- [ ] Renders cleanly on GitHub

## Implementation Notes

- Pull the product/stack blurb from `CLAUDE.md` "Project Overview" and `docs/ARCHITECTURE.md` rather than writing from scratch.
- Quick-start commands live in `CLAUDE.md` "Development Commands" (`npm run server:dev`, `npx expo run:ios`, `npm run db:push`).
- Keep it short — a landing page, not a manual. Deep content already lives in `docs/`.
- Confirm linked doc paths are tracked (`git ls-files <path>`) before referencing them, since the local-only docs are gitignored. See memory `project_docs_local_only.md` for the tracked/untracked split.

## Risks

- Linking a now-untracked doc would create a dead link on GitHub — verify each link target is tracked.

## Updates

### 2026-05-21

- Initial creation (deferred followup from the docs-untracking change).
