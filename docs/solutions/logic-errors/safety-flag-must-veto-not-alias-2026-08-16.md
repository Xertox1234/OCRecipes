---
title: A safety flag treated as a no-op alias resolves the conflict cell in the dangerous direction — make it a veto
track: bug
category: logic-errors
tags: [harness, testing, cli-flags, dry-run, destructive-scripts]
module: server
applies_to: ["scripts/**", "server/scripts/**"]
symptoms: ["--commit --dry-run (either order) deletes for real while the docstring calls --dry-run 'the safe failure direction'", "Flag tests cover each flag alone but never the intersection", "A docstring's safety claim is only true when the other flag is absent"]
created: 2026-08-16
severity: medium
---

# A safety flag treated as a no-op alias resolves the conflict cell in the dangerous direction — make it a veto

## Problem

After flipping the cleanup-junk scripts to dry-run-by-default,
`parseCleanupFlags` kept `--dry-run` as a "no-op alias" for stale invocations:
`commit: argv.includes("--commit")`. The docstring called this "the safe
failure direction" — but `--commit --dry-run` (either order) resolved to
`commit: true` and deleted for real, on unscoped cross-user deletion scripts.
An operator keeping a habitual `--dry-run` in a saved command while adding
`--commit` plausibly believes the safety flag still protects them.

## Symptoms

- Each flag is tested alone; the intersection cell — the only cell where the
  safety claim can break — has no test.
- The docstring's claim ("keeps previewing") holds on the tested axes and is
  false exactly where untested.
- Review probe: run the parser with both flags; the output contradicts the
  comment above it.

## Root Cause

"Alias" framing makes the safety flag inert — it contributes nothing once the
arming flag is present, so the conflict resolves to whatever the arming flag
says. A two-flag space is a 2×2; axis-only tests cover three cells and the
dangerous corner is the fourth. For a {arming, safety} pair the only safe
conflict resolution is that safety WINS: a contradictory command line means
operator confusion, and confusion must preview, not delete.

## Solution

```ts
return { commit: argv.includes("--commit") && !argv.includes("--dry-run") };
```

Plus a both-orders regression test:

```ts
expect(parseCleanupFlags(["node", "s", "--commit", "--dry-run"])).toEqual({ commit: false });
expect(parseCleanupFlags(["node", "s", "--dry-run", "--commit"])).toEqual({ commit: false });
```

## Prevention

- For any {arming flag, safety flag} pair, enumerate the full 2×2 and write
  the conflict-cell test first — it is the cell where docstring claims break.
- The word "alias" in a safety-flag docstring is the smell: an alias is inert;
  a safety flag must be a veto.

## Related Files

- `scripts/cleanup-junk-mealplan-recipes-utils.ts`, `scripts/cleanup-junk-recipes-utils.ts` — the veto (PR #825).
- `scripts/__tests__/cleanup-junk-mealplan-recipes-utils.test.ts` — the conflict-cell tests.

## See Also

- [Mutual exclusion proven per call site can co-occur across invocations](../conventions/mutual-exclusion-proven-per-call-site-can-co-occur-across-invocations-2026-08-06.md) — the same "untested intersection" geometry, for call sites.
- [A gate test must be two-sided](../conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md) — the general controls discipline; the conflict cell is the second side of a flag gate.
