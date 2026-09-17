---
title: "Launcher-grammar shapes compose around guard-outward-cli.sh — a wrapper after the launcher, a stacked launcher, npm explore, and a bare pnpm/yarn dispatch all reach the real CLI"
status: backlog
priority: high
created: 2026-09-16
updated: 2026-09-16
assignee:
labels: [deferred, harness, security]
github_issue:
---

# The launcher grammar admits exactly one launcher, in one position, with nothing after it

## What this todo is now, and what it is no longer

It was filed as "a privilege or wrapper prefix before a launcher defeats the guard". **That half
is closed**, across PR #980's rounds 5-7: the command-position PREFIX became a property of
every deny decision rather than a per-binary patch, so `sudo`/`doas`/`corepack` (flags included,
via `_OUT_PRIV_WORD`) and any path-qualified wrapper word now deny in front of a bare gated
binary, in front of a launcher, and at the seven `gh`/expansion-token/brace-range anchors round 4
had left behind. `_OUT_POS_PREFIX_LP` is derived from `_OUT_POS_PREFIX_W`, so the launcher family
inherits it, and the corpus gained a prefix dimension so a regression moves a number.
Round 6 then added `_OUT_OPT_QUAL` so a path or launcher may qualify the COMMAND at the three
anchors with no `_LP` sibling, and round 7 gave the wrapper arm the same `_OUT_FLAG_RUN` the
privilege arm already had, so a single real option (`-u`, `-i`, `-p`, `-a`, `--`) on a wrapper
word no longer terminates the prefix match. Each of those three rounds found its own axis by
the same route: the previous round closed the spellings it had enumerated, and the next
sibling was the same pieces varied along a dimension nobody had listed.

What remains is a different axis that happens to live next door: the LAUNCHER GRAMMAR itself.
It admits exactly one launcher word, in one position, immediately followed by the gated target.
Every shape below steps outside one of those three assumptions.

## Measured, not inferred

2026-09-16, bash 5.3.15. PreToolUse envelopes fed to the hook on stdin; **nothing was executed**.
Measured on `origin/main` and on PR #980's branch with the same harness, so each row is a
two-tree comparison rather than a single reading.

**Re-measured whenever the constants these shapes depend on change**, rather than cited
against one tree sha — the sha went stale three rounds running, which is its own small
lesson: an attribution that must be hand-bumped every round will not be. The trigger is
mechanical: re-run the probe if `_OUT_LAUNCHER`, `_OUT_POS_PREFIX`, `_OUT_POS_PREFIX_W`
or `_OUT_POS_PREFIX_LP` changed. Last re-measured on the #982 merge, and independently
reproduced by the round-10 security review: all five shapes still ALLOW, the `sudo npx`
control still main=ALLOW/branch=DENY, all over-denial controls still ALLOW. Rounds 6 and 7 both changed
`_OUT_POS_PREFIX_W`, which `_OUT_POS_PREFIX_LP` derives from — so the launcher prefix moved
underneath this table twice after it was first written, and a residual list republished
without re-measuring would have been a claim about a tree that no longer existed. All five
still ALLOW; all four closed shapes still DENY; all eight over-denial controls still ALLOW.
The `main` column is carried forward unchanged and is still current: `main` advanced
`af0e27b2` → `bf228799` while this PR was open, and
`git diff --name-only af0e27b2..origin/main -- .claude/hooks/ scripts/` is **empty**.

| command shape                                  | origin/main | #980 round-7 branch |
| ---------------------------------------------- | ----------- | ------------------- |
| bare `eas` + the OTA verb _(control)_          | DENY        | DENY                |
| `sudo npx` + `eas` + the OTA verb _(control)_  | ALLOW       | **DENY** ← closed   |
| a wrapper word AFTER the launcher              | ALLOW       | ALLOW               |
| a stacked launcher                             | ALLOW       | ALLOW               |
| `npm explore <pkg> --` + the gated command     | ALLOW       | ALLOW               |
| `pnpm`/`yarn` dispatching a local binary       | ALLOW       | ALLOW               |
| a launcher in front of the package-dir clauses | ALLOW       | ALLOW               |

The two controls bracket the result in the same run, so the harness renders both verdicts rather
than one for everything. The second control is the one that moved: it is the evidence that the
prefix axis really closed, and that these five rows are therefore a **separate** gap rather than
the same one re-measured.

Every row is pre-existing on `main` and is **not** a regression from #980.

## Background

Surfaced across PR #980's seven review rounds, which produced twenty-one CRITICALs in total
(4 + 2 + 4 + 2 + 4 + 4 + 1). The pattern worth carrying forward: each round closed the spellings
someone had thought of, and the next round found a sibling composed from the same pieces in a
different order. Rounds 5, 6 and 7 each broke that cycle for one axis — the command-position
prefix, the command qualifier, the wrapper flag — by making it a DIMENSION with its own
combinatorial corpus rows and a short-iteration `FATAL` guard, rather than another alternation.
**These five shapes need the same treatment, and for the same reason — not five more names in
five more alternations.**

Worth stating plainly for whoever picks this up: three consecutive rounds each believed they
had closed the axis, and each was wrong about the SCOPE rather than the mechanism. The fix
direction was sound every time. What kept failing was the sentence describing how far it
reached. Enumerate the dimensions the claim ranges over and construct a one-token-different
pair per cell BEFORE writing that the axis is closed.

## Acceptance Criteria

- [ ] All five shapes above DENY, and the fix is expressed as a property of the launcher grammar
      — how many launcher words may appear, in which positions, and what may sit between a
      launcher and its target — rather than as an enumeration of the five.
- [ ] Two-sided: for each shape, a control that MUST keep ALLOWing. `npx prettier --write .`,
      `pnpm install`, `npm explore <pkg> -- ls` and an ordinary `npm run` script must not be
      caught. Over-denial is the failure that gets a guard switched off rather than fixed.
- [ ] Corpus rows composed **combinatorially** against the existing launcher, path and prefix
      dimensions rather than appended as hand-listed cases, with a dimension assertion on the
      generated row count. Both prior axes needed this and neither had it until a live bypass
      sat behind a green pin.
- [ ] `EXPECTED_PRECISE_GAPS` re-derived from a measured run, never adjusted to match a pin.

## Implementation Notes

- **Do NOT widen `_OUT_WRAPPER_WORD`.** It feeds `_OUT_POS_PREFIX`, which both
  `_OUT_POS_PREFIX_W` and `_OUT_POS_PREFIX_LP` derive from, so a widening there lands on every
  command-position deny decision at once — including the count and `grep -oE` extraction
  consumers, where widening is not monotone-safe. Its definition line is pinned by hash in
  `test-guard-outward-cli.sh`, so such an edit reddens rather than moving silently.
- **Add a privilege-style word to `_OUT_PRIV_WORD`, not to the wrapper list.** `_OUT_PRIV_WORD`
  is defined after `_OUT_FLAG_RUN` and therefore absorbs the flagged spelling too. This is
  measured, not assumed: the bare-word version of the round-5 privilege fix closed
  `sudo` + the OTA verb while its `-E` and `-u <user>` siblings stayed ALLOW, and was rewritten
  for exactly that reason.
- **The launcher work belongs in `_OUT_LAUNCHER` / `_OUT_POS_PREFIX_LP`,** whose consumers are
  boolean `grep -Eqi` deny sites. If a change reaches a count or extraction consumer, move that
  count and its extractor together and preserve the anchor's polarity — `gh pr merge`'s clause
  cut is grant-shaped (an empty clause DENIES), `gh api`'s is allow-by-default (an empty clause
  ALLOWS). Getting this backwards on `gh pr merge` would deny the repo's own sanctioned
  `/todo` automerge.
- Do not quote a use-site count from memory or from an older revision of a comment. Two such
  numbers ("roughly 24", then "28") were each invalidated by the round that wrote them. Derive
  it with grep at the moment you need it.
- Prove any refactor of `_OUT_POS_PREFIX` leaves its expansion byte-identical, as #980 did by
  comparing `shasum` of the expanded value on both sides.
- `xargs`-constructed arguments were also observed ALLOW in the same review. That is a different
  mechanism — the gated text never appears in the command at all — and is almost certainly not
  closeable by a text matcher. Record it as a residual rather than attempting it here.

## Scope Contract

- **Mechanisms to use:** the existing launcher/prefix constants in `guard-outward-cli.sh` and the
  existing generated corpus. No new gate, no new file, no new classification concept.
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/test-guard-outward-cli.sh`, `.claude/hooks/repro-outward-cli-corpus.sh`.
- **Out of scope:** the command-position prefix (closed in #980 round 5), and the MCP surface,
  which this hook cannot see at all.
