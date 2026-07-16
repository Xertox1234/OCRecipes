<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "path-domains.ts's camera routing rule matches a nonexistent directory — client/camera/\*\* has zero domain coverage"
status: done
priority: low
created: 2026-07-14
updated: 2026-07-16
assignee:
labels: [tooling, codify, review-routing]
github_issue:

---

# path-domains.ts's camera routing rule matches a nonexistent directory — client/camera/\*\* has zero domain coverage

## Summary

`scripts/lib/path-domains.ts`'s `PATH_TO_DOMAINS` table has a `routingLabels: ["camera"]` rule matching `client/components/camera/**` — a directory that does not exist. The actual camera feature code lives at `client/camera/**` (`components/`, `hooks/`, `reducers/`, `types/`, `utils/`, plus root `index.ts`/`types.ts`), which has no rule of its own and gets zero domain-routing coverage: it only ever picks up the `camera` label incidentally, when a diff also happens to touch a `client/screens/Scan*` file (the other camera rule). A diff touching only `client/camera/**` files gets no domain label at all beyond `typescript` (if `--typescript-crosscut` is passed).

## Background

Discovered mid-`/codify` while resolving the domain label for the zoom/black-preview fix commit (`1647390a`, 3 files under `client/camera/components/` and `client/camera/hooks/`). Running `git diff 1647390a^ 1647390a --name-only | xargs npx tsx scripts/lib/path-domains.ts --routing --typescript-crosscut` returned only `typescript` — no `camera` or `react-native` label — despite the diff being 100% camera-feature code. Verified via `ls -d client/components/camera` → "No such file or directory"; `ls -d client/camera` → exists (re-verified 2026-07-16).

This under-routes review dispatch: `/codify` Step 2 and `.claude/skills/audit/SKILL.md`/`.claude/agents/todo-executor.md` all key off this CLI's output to decide which domain reviewer(s) (`mobile-reviewer`, etc.) to add to `code-reviewer`'s baseline. A camera-only diff currently gets `code-reviewer` alone, silently skipping `mobile-reviewer`'s camera/vision-specific checks unless the diff also touches `ScanScreen.tsx` or a related `client/screens/Scan*` file. It also under-injects: the `.claude/hooks/inject-patterns.sh` write-time hook reads the generated `domain-map.sh`, so edits under `client/camera/**` receive no `docs/rules/*.md` injection (no react-native, accessibility, design-system, or performance rules) — sibling client feature files all do.

## Acceptance Criteria

- [ ] TDD: failing tests first in `scripts/lib/__tests__/path-domains.test.ts` asserting `routingLabelsForPath` / `rulesDomainsForPath` for representative paths per the rule design below (at minimum: a `client/camera/components/*.tsx` file, a `client/camera/hooks/*.ts` file, a `client/camera/reducers/*.ts` file, and root `client/camera/index.ts`)
- [ ] The four new rules from Implementation Notes added to `PATH_TO_DOMAINS`; the stale `client/components/camera` rule **removed** (directory verified nonexistent 2026-07-14 and again 2026-07-16 — a rule matching a nonexistent directory is exactly the confusion that caused this todo)
- [ ] The `client/screens/Scan*` file-prefix rule is untouched and still yields the `camera` routing label (existing tests keep passing)
- [ ] Both derived artifacts regenerated and committed — `npm run build:copilot-instructions` and `npm run build:domain-map` — with their `:check` variants passing (CI enforces `build:copilot-instructions:check`); never hand-edit the generated files
- [ ] End-to-end CLI check: a file list containing only `client/camera/**` paths piped through `npx tsx scripts/lib/path-domains.ts --routing` returns `camera` plus the expected rules-domains (the original repro command from Background now yields `camera, react-native, …` instead of nothing)

## Implementation Notes

**Rule design (decided 2026-07-16, re-authoring):** mirror the table's existing sibling-directory precedent — role-specific domain sets per subdirectory, not one union rule — plus a feature-wide baseline that guarantees no camera file has zero coverage. `rulesDomainsForPath` unions across all matching rules, so the baseline and subrules compose naturally:

```ts
{
  match: { kind: "recursive-dir", dir: "client/camera" },
  domains: ["react-native"], // baseline: root files, types/, utils/
  routingLabels: ["camera"],
  description: "`client/camera/**`",
},
{
  match: { kind: "recursive-dir", dir: "client/camera/components" },
  domains: ["react-native", "design-system", "accessibility", "performance"], // mirrors client/components/**
  description: "`client/camera/components/**`",
},
{
  match: { kind: "recursive-dir", dir: "client/camera/hooks" },
  domains: ["hooks", "client-state", "react-native", "accessibility"], // mirrors client/hooks/**
  description: "`client/camera/hooks/**`",
},
{
  match: { kind: "recursive-dir", dir: "client/camera/reducers" },
  domains: ["client-state"], // mirrors client/context/**
  description: "`client/camera/reducers/**`",
},
```

Rationale for this shape over the two alternatives considered:

- **Not a bare rename** of the stale rule's `dir` (`client/components/camera` → `client/camera`): that rule is routing-only (`domains: []`) and relied on parent `client/components/**` for rules-domains; `client/camera/**` has no parent rule, so a rename would leave zero rules-domains and zero pattern injection (the original filing's explicit warning).
- **Not one union rule** (`client/camera/**` → all six domains): would inject six `docs/rules/*.md` files on every camera edit regardless of file role, against the table's precedent of role-scoped sets (components vs hooks vs state get different domains everywhere else) and against the injection hook's short-by-design budget.

Notes for the implementer:

- Unlike the two existing camera rules (routing-only overlays with `domains: []`), the new baseline rule carries BOTH real domains and the routing label — that's already supported (`routingLabels` is additive on top of `domains`, see `routingLabelsForPath`).
- The camera `routingLabels` entry only needs to be on the baseline rule — subrule matches always also match the baseline (they're descendants), so the label unions in.
- `scripts/lib/__tests__/path-domains.test.ts` contains a TS/shell parity test and a drift-detection test; new `recursive-dir` rules are the table's most common kind and should pass both without special-casing, but run that file first.
- Derived-artifact consumers: `.github/copilot-instructions.md` (via `scripts/build-copilot-instructions.ts`) and `.claude/hooks/lib/domain-map.sh` (via `scripts/build-domain-map.ts`). The pre-push gate runs `build:copilot-instructions:check`, so an unregenerated doc fails before it ever reaches CI.

## Dependencies

- None known

## Risks

- Low. The additions are ordinary `recursive-dir` rules; the one deletion targets a rule that cannot match any existing file. Blast radius is review-routing and pattern injection (more coverage, not less) plus two regenerated derived artifacts whose drift-checks gate the change anyway.

## Updates

### 2026-07-14

- Filed during `/codify` after discovering the stale routing rule while resolving domain labels for the zoom/black-preview fix commit; not fixed — deferred per explicit scoping decision (out of `/codify`'s remit, and the correct fix needs a design call, not a guess)

### 2026-07-16

- Re-authored at user request after being quality-flagged (thin-IN) by a `/todo` run: made the design call (baseline + role-scoped subrules mirroring sibling precedent, stale rule deleted), added Implementation Notes with the concrete rule shapes, and tightened Acceptance Criteria to TDD + regeneration + end-to-end CLI verification. Re-verified `client/components/camera` absent and inventoried `client/camera/**` contents.
- Implemented per the locked design: failing tests written first in `scripts/lib/__tests__/path-domains.test.ts` (confirmed RED), then the stale `client/components/camera` rule removed from `PATH_TO_DOMAINS` and replaced with the four rules from Implementation Notes (baseline `client/camera/**` + role-scoped `components`/`hooks`/`reducers` subrules). Tests confirmed GREEN (100/100 across the three affected test files). Both derived artifacts regenerated (`npm run build:copilot-instructions`, `npm run build:domain-map`) and their `:check` variants pass. Ran the literal Background repro command (`git diff 1647390a^ 1647390a --name-only | xargs npx tsx scripts/lib/path-domains.ts --routing --typescript-crosscut`) — now yields `accessibility, camera, client-state, design-system, hooks, performance, react-native, typescript` instead of just `typescript`. `code-reviewer` returned no findings (0 review rounds). One unrelated pre-existing test failure (`server/lib/__tests__/error-reporter.test.ts` Sentry drift guard) confirmed via `git stash` to predate this change — a worktree-local `node_modules` layout quirk, not a regression.
