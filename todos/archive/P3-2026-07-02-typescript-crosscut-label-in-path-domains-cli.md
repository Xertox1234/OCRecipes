---
title: "Move the 'add typescript for .ts/.tsx' cross-cutting policy into path-domains.ts instead of hand-stating it in two docs"
status: done
priority: low
created: 2026-07-02
updated: 2026-07-02
assignee:
labels: [deferred, harness]
github_issue:
---

# Move the 'add typescript for .ts/.tsx' cross-cutting policy into path-domains.ts

## Summary

The cross-cutting rule "include the `typescript` domain whenever any changed file is a
`.ts`/`.tsx`" is currently hand-restated in two consumer docs instead of being applied
once by `scripts/lib/path-domains.ts` — the single source of truth those docs otherwise
defer to. Fold it into the CLI so consumers stop re-copying a policy that can drift.

## Background

Surfaced by the `/review 490` altitude angle during the reviewer-roster consolidation
(PR #490). PR #490's whole point was to kill hand-copied tables and route everything
through `scripts/lib/path-domains.ts` (e.g. it replaced the executor's drifted Step 3b
path→domain table with a CLI call). But the `typescript` cross-cutting policy was left as
a manual add-on **on top of** the CLI output, hand-stated in:

- `.claude/skills/codify/SKILL.md` Step 1 — "**In addition, include `typescript`
  whenever any changed file is a `.ts` or `.tsx` file** (a cross-cutting policy the CLI
  does not add)."
- `.claude/agents/todo-executor.md` Step 3b — "In addition, include `typescript` whenever
  any source file is a `.ts`/`.tsx` file (a cross-cutting policy the CLI does not add)."

Two hand-copies of a rule is exactly the drift surface the PR consecrated the CLI to
remove. The parenthetical "(a cross-cutting policy the CLI does not add)" is an admission
the fix belongs one level deeper.

## Acceptance Criteria

- [x] `scripts/lib/path-domains.ts` can emit `typescript` for any `.ts`/`.tsx` input via a
      dedicated, opt-in path (e.g. a `--typescript-crosscut` flag, or a documented
      `routingLabelsForPath` option) — NOT unconditionally, so existing consumers are
      unaffected.
- [x] The two docs above reference the CLI behavior instead of hand-stating the policy
      (one owning statement; the other points to it or to the CLI).
- [x] The other `path-domains.ts` consumers — the generated `.github/copilot-instructions.md`
      (`npm run build:copilot-instructions:check` stays green) and
      `.claude/hooks/lib/domain-map.sh` — are verified unchanged by the new opt-in flag.
- [x] A unit test pins the new behavior (a `.ts` input under the flag yields `typescript`
      in the label union; without the flag it does not).

## Implementation Notes

- The CLI already owns the 13 rules-domains incl. `typescript` as a _path-matched_ label
  (`shared/**` etc.); this task is specifically about the **cross-cutting "any .ts/.tsx →
  typescript"** rule, which is broader than the current path matcher and must stay opt-in
  so it doesn't leak into the copilot-instructions generation or the domain-map hook.
- Prefer a flag consumed only by the two review/codify dispatch paths over changing the
  default output. Fail-safe: if in doubt, keep the default output byte-identical and add
  behavior only behind the flag.
- Files in scope: `scripts/lib/path-domains.ts`, `.claude/skills/codify/SKILL.md`,
  `.claude/agents/todo-executor.md`, and a test under `scripts/**/__tests__/` (or wherever
  path-domains tests live).

## Dependencies

- Merges cleanly only after PR #490 (the roster consolidation) lands — it created the
  current Step 3b CLI-call wording this task edits.

## Risks

- Changing `path-domains.ts` default output would ripple into `copilot-instructions` and
  `domain-map.sh`; the CI `build:copilot-instructions:check` gate will catch an accidental
  default-output change. Keep the new behavior opt-in to avoid it entirely.

## Updates

### 2026-07-02

- Initial creation — deferred low-severity DRY/altitude finding from the `/review 490` cycle.

### 2026-07-05

- Implemented: added an opt-in `--typescript-crosscut` flag to `runCli` in
  `scripts/lib/path-domains.ts` that unions in the `typescript` label for any
  `.ts`/`.tsx` input file, on top of whatever `rulesDomainsForPath`/
  `routingLabelsForPath` already produce. Default (no-flag) output is
  byte-identical — verified via `npm run build:generated:check` (both
  `.github/copilot-instructions.md` and `.claude/hooks/lib/domain-map.sh`
  still match their generated content, since those two consumers import
  `PATH_TO_DOMAINS` directly and never pass CLI flags).
- `.claude/skills/codify/SKILL.md` Step 1 is now the owning statement
  describing the flag; `.claude/agents/todo-executor.md` Step 3b points to it.
- Added unit tests in `scripts/lib/__tests__/path-domains.test.ts` pinning:
  flag-on adds `typescript` for a `.ts` file with no other domain match,
  flag-on unions with existing domains for a `.tsx` file, flag-off leaves a
  `.ts` file with no domain match empty, flag composes with `--routing`, and
  flag-on does not add `typescript` for a non-`.ts`/`.tsx` file.
- Code review (code-reviewer, single reviewer — docs/config + tiny
  cross-cutting internal-tooling diff): no CRITICAL findings. One WARNING
  (missing negative-case test for the flag) and two SUGGESTIONs (stale
  "Four artifacts" header comment, minor prose duplication in
  todo-executor.md) — all fixed inline.
