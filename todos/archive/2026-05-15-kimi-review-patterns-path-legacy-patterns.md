---
title: "kimi-review --patterns resolver still points at docs/patterns/ (now docs/legacy-patterns/)"
status: done
priority: medium
created: 2026-05-15
updated: 2026-05-16
assignee:
labels: [deferred, infrastructure, docs]
github_issue:
---

# kimi-review --patterns resolver still points at docs/patterns/

## Summary

The global `kimi-review` CLI tool resolves `--patterns <domain>` to a file path `docs/patterns/<domain>.md`. Phase 2 Step 6 moved those 16 files to `docs/legacy-patterns/`, so any `kimi-review --patterns ...` invocation now fails with `Error: pattern file not found: .../docs/patterns/<domain>.md`.

## Background

Surfaced during Phase 2 Step 6 (`todos/archive/2026-05-12-phase-2-pattern-decomposition.md`). When that PR's commit ran the repo's Kimi pre-commit gate (`.claude/hooks/kimi-review.sh`, which maps staged `.ts` files to `--patterns typescript,...`), the gate printed:

```
Error: pattern file not found: .../docs/patterns/typescript.md
```

This is a non-blocking WARNING-level failure (the gate only blocks on CRITICAL), so the commit still went through — but every `kimi-review --patterns` call is now degraded: Kimi receives no domain pattern context.

The `kimi-review` CLI is global tooling (installed on PATH, not version-controlled in this repo), so the fix is outside the OCRecipes repo. The path is hardcoded in the CLI's pattern-resolution logic.

## Acceptance Criteria

- [ ] `kimi-review --patterns <domain>` resolves to a file that exists (either `docs/legacy-patterns/<domain>.md`, or — better — the new `docs/rules/<domain>.md` + relevant `docs/solutions/` files)
- [ ] `.claude/hooks/kimi-review.sh` pre-commit gate runs without the `pattern file not found` error on a `.ts`-touching commit
- [ ] Decide whether `--patterns` should point at the frozen `docs/legacy-patterns/` archive or be re-pointed at `docs/rules/<domain>.md` (the binding, current source) — the latter is the better long-term target

## Implementation Notes

- The pattern-path constant lives in the global `kimi-review` CLI source, not in this repo. Locate it via `which kimi-review` then inspect the script.
- `.claude/hooks/kimi-review.sh` line 35 ("Map staged files to review patterns") and line 87 (`--patterns "$PATTERNS"`) are the in-repo consumers — they only pass the domain name, not a path, so no repo change is needed there once the CLI is fixed.
- Cross-reference `docs/AI_WORKFLOW.md` which documents `--patterns security,api` expanding to pattern file paths — update that doc if the resolution target changes.

## Dependencies

- None. The Phase 2 monolith move is already merged/landing; this is the cleanup of the one consumer that wasn't repo-local.

## Risks

- If `--patterns` is re-pointed at `docs/rules/<domain>.md`, the content shape changes (rules are short binding bullets, not long-form pattern catalogs) — Kimi's review context becomes terser. May be acceptable or even preferable; confirm with a test review.

## Updates

### 2026-05-15

- Initial creation. Deferred from Phase 2 Step 6 (`todos/archive/2026-05-12-phase-2-pattern-decomposition.md`).

### 2026-05-16

- Resolved. Patched `resolve_pattern_path` in the global `kimi-review` CLI (`~/.local/bin/kimi-review`) to fall back to `docs/legacy-patterns/<domain>.md` when `docs/patterns/<domain>.md` is absent. Purely additive — repos that still have `docs/patterns/` resolve unchanged; the hard-fail is retained when both dirs are missing.
- AC#3 decided in favor of `docs/legacy-patterns/` (not `docs/rules/`): `docs/AI_WORKFLOW.md:177` already documents that target, and the pre-commit hook separately passes `--rules "$PATTERNS"` → `docs/rules/`, so Kimi already receives the current binding rules. `--patterns` supplies the frozen long-form catalog; the two are complementary.
- Verified: all 13 hook-derived domains resolve to existing files under `docs/legacy-patterns/`. No repo change needed — `docs/AI_WORKFLOW.md` was already updated to reference `docs/legacy-patterns/`.
