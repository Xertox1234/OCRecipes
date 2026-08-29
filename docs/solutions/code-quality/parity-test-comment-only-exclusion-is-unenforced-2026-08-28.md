---
title: "A parity/symmetry test's excluded edge case, documented only in a comment, is unenforced and traps the next contributor"
track: bug
category: code-quality
module: shared
severity: low
tags: [harness, testing, parity, regex, bash, config-file, path-domains]
applies_to: [scripts/lib/__tests__/path-domains.test.ts]
symptoms: [a corpus/table-driven test has a comment saying "do NOT add path X here" instead of a code branch that recognizes X as a known exception, adding the excluded path anyway is an easy accidental next edit since an identical string may already exist a few lines away in a sibling assertion table, the failure when someone does add it gives no indication it is a KNOWN accepted asymmetry — it just looks like a regression]
created: '2026-08-28'
last_updated: '2026-08-28'
---

# A parity/symmetry test's excluded edge case, documented only in a comment, is unenforced and traps the next contributor

## Problem

`scripts/lib/__tests__/path-domains.test.ts`'s `regex<->bash-glob parity` test asserts that every
`Matcher`'s compiled TS regex and generated bash glob agree on every path in `PARITY_CORPUS`, with
exactly one code-enforced exception (`isTestExcludingServerDir`, for the documented
`server/routes`/`server/storage` `__tests__`-descendant asymmetry). When a second, genuinely
different asymmetry was found in the `config-file` `Matcher` kind (its TS regex is root-anchored,
`^...$`, but the generated bash form's `*/${b}.*` variant matches at any depth), it was excluded
from `PARITY_CORPUS` with a comment — "Do NOT add a nested package.json/app.json path here" —
instead of a second code-enforced allowance clause.

## Root Cause

A comment is advisory; nothing in the test file stops the next contributor from adding the
excluded path anyway — and the identical string was already sitting twelve lines away in the
`cases` table's own decline-side pin for the same new rule, making it an unusually easy accident.
Had it been added to `PARITY_CORPUS`, the parity test would have failed with
`expect(false).toBe(true)` and given no indication that this was a known, accepted divergence
rather than a real regression — exactly the ambiguity the existing `isTestExcludingServerDir`
clause was written to avoid for its own case.

## Solution

Give every known, accepted asymmetry its own boolean predicate in the parity test, exactly like
the existing one:

```ts
const isConfigFileDepthMismatch = rule.match.kind === "config-file";
// ...
expect(
  (isTestExcludingServerDir && p.includes("/__tests__/") && shMatch && !tsMatch) ||
    (isConfigFileDepthMismatch && shMatch && !tsMatch),
).toBe(true);
```

Then ADD the previously-excluded paths to the corpus (`client/lib/package.json`,
`assets/app.json`) — a corpus entry that isn't exercised by anything doesn't guard against a
regression in the allowance predicate itself, so leaving the exclusion comment-only AND the paths
absent from the corpus means the asymmetry is documented nowhere the test suite can check.

A `code-reviewer` pass caught this before merge in
`todos/archive/P3-2026-08-11-unrouted-surfaces-domain-map-decision.md`'s implementation
(PR #865) — not by trusting the comment's claim, but by exercising
`compileToRegExp`/`compileToBashConditions` directly against the excluded path from a throwaway
script and confirming the mismatch was real.

## Prevention

When a symmetry/invariant test needs to exclude a known edge case, ask: "if someone adds this case
to the corpus anyway, does the test tell them it's a KNOWN exception, or does it just fail?" If the
latter, the exclusion isn't actually documented in the place that matters — the assertion logic
itself, not a comment next to it.

## Decision record (2026-08-28 follow-up)

The underlying `config-file` depth asymmetry itself — not just the parity test's handling of it —
was later evaluated for a permanent resolution (`todos/archive/P3-2026-08-28-config-file-matcher-
depth-parity-gap.md`). Two behavior-changing fixes were considered and declined in favor of
accepting and documenting the divergence:

- **Root-anchor the bash form** (`compileToBashConditions`'s `config-file` case, dropping the
  `*/${b}.*` leading-wildcard variant) — would make the shell form match TS exactly, but is a
  behavior change to a generated artifact (`domain-map.sh`) for a gap whose only practical effect
  is a benign shell-side over-match (extra pattern-injection noise on a nested config file), never
  a missed injection in the `rulesDomainsForPath` (TS) direction that actually matters.
- **Relax the TS regex to match at depth** (e.g. `` `(^|/)${basename}\.[^/]+$` ``) — would make
  `rulesDomainsForPath` start matching nested `package.json`/`app.json` occurrences (e.g. under
  `node_modules/**`), which is the wrong direction entirely; the root anchor on the TS side is
  deliberate (see the rule's own comment in `path-domains.ts`), not an oversight.

Accepted instead: the asymmetry is permanent, by design. **Precision note (2026-08-29):** the
`isConfigFileDepthMismatch` predicate *permits* this specific mismatch to pass without failing the
parity test — it does not *enforce* the asymmetry's continued existence, and nothing in the test
suite structurally re-opens this decision if a future edit to `compileToRegExp`/
`compileToBashConditions`'s `config-file` case removes the mismatch (that edit would simply make
`isConfigFileDepthMismatch` never trigger, and the test would pass via the ordinary symmetric
branch with no signal either way). Same resolution shape as `TS_TEST_EXCLUDING_DIRS`/
`isTestExcludingServerDir`. A future editor of that `config-file` case is the trigger for
re-reading this doc — there is no automated one. See `path-domains.test.ts`'s
`"config-file's bash form deliberately over-matches at depth vs the root-anchored TS regex"`
test for a positive pin of the current over-match, which WOULD go red if this asymmetry were
ever closed.

## Related Files

- `scripts/lib/__tests__/path-domains.test.ts` — `isTestExcludingServerDir` /
  `isConfigFileDepthMismatch` predicates
- `scripts/lib/path-domains.ts` — `compileToRegExp` / `compileToBashConditions`, the source of the
  asymmetry

## See Also

- [documented-mirror-invariant-desyncs-when-only-one-side-is-edited](../logic-errors/documented-mirror-invariant-desyncs-when-only-one-side-is-edited-2026-08-16.md) — same shape: a comment states an invariant that nothing in the code actually enforces
