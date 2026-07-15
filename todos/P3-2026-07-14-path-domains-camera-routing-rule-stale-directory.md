<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "path-domains.ts's camera routing rule matches a nonexistent directory — client/camera/\*\* has zero domain coverage"
status: backlog
priority: low
created: 2026-07-14
updated: 2026-07-14
assignee:
labels: [tooling, codify, review-routing]
github_issue:

---

# path-domains.ts's camera routing rule matches a nonexistent directory — client/camera/\*\* has zero domain coverage

## Summary

`scripts/lib/path-domains.ts`'s `PATH_TO_DOMAINS` table has a `routingLabels: ["camera"]` rule matching `client/components/camera/**` — a directory that does not exist. The actual camera feature code lives at `client/camera/**` (`components/`, `hooks/`, `reducers/`, `types/`), which has no rule of its own and gets zero domain-routing coverage: it only ever picks up the `camera` label incidentally, when a diff also happens to touch a `client/screens/Scan*` file (the other camera rule). A diff touching only `client/camera/**` files gets no domain label at all beyond `typescript` (if `--typescript-crosscut` is passed).

## Background

Discovered mid-`/codify` while resolving the domain label for the zoom/black-preview fix commit (`1647390a`, 3 files under `client/camera/components/` and `client/camera/hooks/`). Running `git diff 1647390a^ 1647390a --name-only | xargs npx tsx scripts/lib/path-domains.ts --routing --typescript-crosscut` returned only `typescript` — no `camera` or `react-native` label — despite the diff being 100% camera-feature code. Verified via `ls -d client/components/camera` → "No such file or directory"; `ls -d client/camera` → exists.

This under-routes review dispatch: `/codify` Step 2 and `.claude/skills/audit/SKILL.md`/`.claude/agents/todo-executor.md` all key off this CLI's output to decide which domain reviewer(s) (`mobile-reviewer`, etc.) to add to `code-reviewer`'s baseline. A camera-only diff currently gets `code-reviewer` alone, silently skipping `mobile-reviewer`'s camera/vision-specific checks unless the diff also touches `ScanScreen.tsx` or a related `client/screens/Scan*` file.

## Acceptance Criteria

- [ ] `git diff --name-only` on a diff touching only `client/camera/**` files, piped through `scripts/lib/path-domains.ts --routing`, returns at least `camera` (and any other applicable rules-domains, e.g. `react-native`)
- [ ] The fix does not merely rename the stale rule's `dir` from `client/components/camera` to `client/camera` — per investigation, the two existing camera rules are routing-only overlays that rely on a broader parent rule (`client/components/**` / `client/screens/**`) to supply rules-domains (react-native, accessibility, performance, etc.); `client/camera/**` has no such parent rule today, so a bare rename would still leave it with zero rules-domains and zero pattern-injection coverage. Design a proper rule (or extend an existing recursive-dir rule) that gives `client/camera/**` the same rules-domains coverage as sibling client feature directories, not just the `camera` routing label
- [ ] Regenerate/verify the derived artifacts this file feeds (`.github/copilot-instructions.md`, `.claude/hooks/lib/domain-map.sh` per `docs/PATTERNS.md`) via whatever build/check script keeps them in sync (e.g. `build:copilot-instructions:check`) — don't hand-edit the generated files
- [ ] Spot-check that `client/screens/Scan*` and `client/components/camera/**` (if genuinely still referenced anywhere) keep working as before — this is an additive fix, not a rename-in-place

## Dependencies

- None known

## Risks

- This is `scripts/lib/path-domains.ts` itself — a generated-artifact source with a CI drift-check (per project memory: `.github/copilot-instructions.md` + `domain-map.sh` are generated from it). An edit that isn't paired with regenerating those artifacts will fail the pre-push gate on the next push touching either generated file
- Not a quick one-line fix: the correct shape requires deciding how `client/camera/**` should compose with the existing rule table (new standalone rule vs. broadening an existing recursive-dir rule) — see Acceptance Criteria note above

## Updates

### 2026-07-14

- Filed during `/codify` after discovering the stale routing rule while resolving domain labels for the zoom/black-preview fix commit; not fixed — deferred per explicit scoping decision (out of `/codify`'s remit, and the correct fix needs a design call, not a guess)
