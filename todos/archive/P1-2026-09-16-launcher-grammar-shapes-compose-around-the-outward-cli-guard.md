---
title: "Launcher-grammar shapes compose around guard-outward-cli.sh — a wrapper after the launcher, a stacked launcher, npm explore, and a bare pnpm/yarn dispatch all reach the real CLI"
status: done
priority: high
created: 2026-09-16
updated: 2026-09-17
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
The `main` column is re-measured with the branch column, never carried forward on the
strength of a diff being empty. An earlier revision of this paragraph justified carrying it
with "`main` advanced `af0e27b2` → `bf228799` … that diff is **empty**" — true when written
and falsified within the day, because `main` went on to `a5f507ff` via the brace-LIST work,
which touches all three hook files. A sentence whose truth depends on another branch's tip
has a shelf life; state the trigger instead, as the paragraph above now does.

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

- [x] All five shapes above DENY, and the fix is expressed as a property of the launcher grammar
      — how many launcher words may appear, in which positions, and what may sit between a
      launcher and its target — rather than as an enumeration of the five.
- [x] Two-sided: for each shape, a control that MUST keep ALLOWing. `npx prettier --write .`,
      `pnpm install`, `npm explore <pkg> -- ls` and an ordinary `npm run` script must not be
      caught. Over-denial is the failure that gets a guard switched off rather than fixed.
- [x] Corpus rows composed **combinatorially** against the existing launcher, path and prefix
      dimensions rather than appended as hand-listed cases, with a dimension assertion on the
      generated row count. Both prior axes needed this and neither had it until a live bypass
      sat behind a green pin.
- [x] `EXPECTED_PRECISE_GAPS` re-derived from a measured run, never adjusted to match a pin.

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

### 2026-09-17 - CLOSED. The grammar is now a property, and the five shapes fall out of it

- **What replaced the enumeration** (criterion 1). Four constants in `guard-outward-cli.sh`,
  each answering one of the three assumptions the old grammar made:
  `_OUT_LAUNCHER_ANY` (which words hand the next word to a real binary -- now including
  `npm explore <pkg> [--]`, which carries an ARGUMENT before its target, and a bare
  `pnpm`/`yarn` dispatch with no exec verb at all); `_OUT_LAUNCH_INTER` (what may sit BETWEEN a
  launcher and the next word -- interpolated from the same wrapper/privilege alternation
  `_OUT_POS_PREFIX_W` already admits in command position, not re-spelled, so the two cannot
  drift); `_OUT_LAUNCH_STEP` (one hop, path-qualifiable on either side); and
  `_OUT_OPT_QUAL_CH` (the optional chain). `_OUT_POS_PREFIX_LP` became
  `${_OUT_POS_PREFIX_W}((${_OUT_LAUNCH_STEP})+(PATH)?|PATH)` -- `+` not `*`, which PRESERVES the
  file's "mandatorily at least one of launcher/path" property. The repetition is unbounded, and
  a three-hop row is pinned to say so rather than the fix being special-cased at two.

- **Why it is a NEW constant and not a widening of `_OUT_LAUNCHER`** -- the decision that shaped
  the whole change, and it came from one grep, not a probe. `_OUT_POS_PREFIX_LP`'s consumers are
  all boolean `grep -Eqi`, where widening is monotone. `_OUT_OPT_QUAL`'s consumers include three
  `grep -oE` OCCURRENCE EXTRACTORS whose counts feed `*_ALREADY_HANDLED` exclusions, where
  widening is NOT monotone: a longer match absorbs what would have started a second one, so the
  count can FALL while the guard gets strictly wider. So `_OUT_OPT_QUAL` stays verbatim at the
  extractors and at the exclusion that pairs with them, and only boolean sites take `_CH`.
  **Three structural test rows assert exactly that split** -- chain-in-extractors must be 0,
  narrow-in-extractors must be >0 (non-vacuity), chain-in-booleans must be >0 (positive
  control). Measured 0 / 3 / 5.

- **Two-sided, measured** (criterion 2). The evidence that SHIPS is the suite block, and the
  count below is derived from it rather than from a scratchpad probe -- an earlier revision of
  this bullet cited "26 rows" and four example commands (`npx tsc --noEmit`, `pnpm add lodash`,
  `yarn add lodash`, `npm exec prettier -- --check .`) that came from an ad-hoc two-sided probe
  and were never in `test-guard-outward-cli.sh` at all. The round-1 code review caught it by
  grepping for the cited strings and finding none. **A measurement that is not in the tree is
  not evidence a reader can check**, so the rule this leaves behind is: cite the shipped rows,
  and derive the count with grep at the moment you write it.
  The shipped block pins every one of the five shapes and their path / wrapper / privilege /
  expansion compositions as DENY, and pairs them with over-denial controls that must keep
  ALLOWing -- including `npx prettier --write .`, `pnpm install`, `yarn install`,
  `npm run lint`, `pnpm run build`, `npm explore some-pkg -- ls`, `yarn dlx tsc --noEmit`,
  `pnpm why lodash`, `yarn info lodash`, ordinary `yarn workspace <ws> <script>` usage, and
  rows that merely NAME a gated command in prose. `pnpm run eas` is ALLOW and pinned for the
  same reason: the word after a bare `pnpm` is a package-manager verb there, not a gated
  binary.

- **Combinatorial, with the dimension asserted** (criterion 3). 192 corpus rows =
  4 targets x 6 chain forms x 4 path forms x 2 inter forms, with a FATAL if the loop
  iterates short. (It closed at 128 / 4 chain forms; the two yarn workspace-scope forms the
  round-1 security review found were added in round 2, and this number is restated here rather
  than left at the round-1 figure -- a `status: done` todo that disagrees with the tree is a
  worse artefact than no todo, and nothing marks a paragraph as historical for a reader.) Cardinality is deliberately small: crossing the chain with all 14 launcher
  forms would take the file past 7000 rows and a ~17-minute required check into hours. The
  `lnchr` form is the built-in control, not padding -- its 16 `noint` rows deny on the pre-fix
  tree too, so a run where those also flip means the baseline was not what it claimed.

- **Pins re-derived from a measured run, never adjusted to match** (criterion 4). The run
  moved exactly one pin: deny-reason attribution 1597 -> 1725, `+128` with **zero removals and
  zero ids in both lists** -- so nothing closed and no pre-existing row kept its verdict while
  rerouting to a different check. That reroute is the specific risk of widening a
  command-position anchor, and the attribution manifest is what makes it visible; a bare moving
  total cannot. `EXPECTED_PRECISE_GAPS` and `EXPECTED_ALLPATH_GAPS` were re-derived from the
  same run and **held at 62 and 358** with no membership drift in either manifest: the 128 new
  rows deny on the precise path and on all three degraded paths alike. `EXPECTED_EMIT_SITES`
  and the attributed-rows-vs-DENY-verdicts denominator both held. Suite: 1104 passed, 0 failed —
  it read "1022" for ten rounds after later commits raised it, because the pin is enforced by
  the suite and a sentence quoting the pin is not. Check `EXPECTED_TOTAL`, not this line.

- **DOCUMENTED RESIDUAL, named by row rather than stated as a property** -- 9 launcher-CHAIN x
  BRACE-token spellings stay ALLOW, because every brace arm reaches its qualifier through one
  of those `grep -oE` extractors. Listed verbatim beside `_OUT_OPT_QUAL_CH` in the guard.
  Three near-misses that DENY today (a bare `pnpm` or `npx` in front of a brace-range or
  brace-list token glued to the binary name) are listed with them, so a later widener
  re-measures instead of trusting the list: a SINGLE launcher in front of a brace token is
  already covered, it is the CHAIN that is not.

- **THE CRUDE PATH'S FLAG ABSORBER, closed where this arm reaches and NAMED where it does not.**
  The bounded span first absorbed BARE flags only, so `yarn workspace api --cwd packages/api run
<otascript>` slipped on the degraded paths. Two things about that are worth more than the fix.
  First, the bug's SHAPE: `--jobs 4 run <otascript>` denied anyway, because a digit is
  non-alphabetic and `[^a-zA-Z]+` swallows it -- a flag-with-a-value test using a numeric value
  would have passed and proved nothing, so the value must contain a LETTER. Second, the root
  cause is an ASYMMETRY BETWEEN THE TWO PATHS, not anything about workspaces: the precise
  path's `_OUT_FLAG_RUN` has always absorbed flag+value pairs and this crude mirror never did.
  `yarn --cwd packages/api run <otascript>`, with no workspace word at all, is ALLOW on
  `origin/main` and on every revision of this branch -- so the class predates this PR and is
  wider than the workspace arm. It is now pinned as an ALLOW residual so it is visible rather
  than rediscovered. Accepted trade, measured: `<pm> workspace <ws> --flag <oneword>
<otascript>` now denies, because that is the same token shape as
  `<pm> workspace <ws> --silent <otascript>`, which should.

- **ACCEPTED, NOT FIXED, AND PRICED BEFORE ACCEPTING:** the post-`run` value slot. The final
  review round found that `_OUT_FLAG_RUN`'s value slot sits after the `run` literal too, so
  `<pm> <scope> run --flag <word> <otascript>` denies even when `<word>` is the real command and
  the script name is incidental -- 240 measured rows. The symmetric repair was BUILT and PRICED
  against a parsing candidate with a live control, and rejected on the measurement: it does not
  remove those denials, and it turns `npm run --workspace api <otascript>` and
  `pnpm run --filter api <otascript>` from DENY into ALLOW -- the documented npm and pnpm
  spellings for running a workspace script, i.e. two live OTA routes traded for a cosmetic
  over-denial. Both are now pinned as `assert_deny`, so an attempt to narrow that slot reddens
  first. The unscoped forms already deny on `origin/main`, so this is a pre-existing class
  reached through one more spelling; it is filed as
  `todos/P2-2026-09-17-out-flag-run-value-slot-swallows-the-command-word.md`, where it belongs,
  because a fix has to happen once at `_OUT_FLAG_RUN` rather than per-anchor. **Three of this
  PR's rounds each patched one slot and each exposed the next**, which is the evidence that
  per-anchor was the wrong shape.

- **THE COMMENT BLOCK STATES ROWS AND NO UNIVERSALS, and that is a correction too.** Three
  revisions of it asserted a general rule about these patterns and all three were refuted by one
  command: "never an arbitrary word gap" (a sibling uses one), "a flag cannot collide with
  prose" (a commit message naming `eas build --auto-submit` denies on the degraded path), and
  "no value slot reaches past `run`" (the anchors carry a second `_OUT_FLAG_RUN`). Each was
  written to help the next reader and each would have misled them. The block now lists what was
  measured and says to run the pair before writing down a rule.

- **OUTSIDE THE SCOPE CONTRACT, named rather than slipped in:** `.github/workflows/ci.yml`.
  The contract lists three hook files. The corpus job's `timeout-minutes` had to move because
  the in-scope row growth killed it -- a required check that dies takes every PR with it -- so
  this is a consequence of the in-scope change rather than new mechanism, but it is a fourth
  file and a reviewer is entitled to see it declared instead of discovering it.

- **Not attempted, and why -- stated at the width the code actually has.**
  `_OUT_LAUNCHER_AMBIG_FLAG`'s call site is still anchored on a SINGLE launcher hop, so the
  whole chain slips it, not merely the bare package-manager arm. Measured ALLOW on both trees:
  `npx npm exec -c '<otaverb>'`, `npx env npx -c '<otaverb>'`, `npx pnpm dlx npx -c '<otaverb>'`,
  `npm explore some-pkg -- npx -c '<otaverb>'`, `pnpm npx -c '<otaverb>'`, and the
  `--package=eas-cli` siblings of the first two. DENY on both trees, which is what makes the
  gap specifically the CHAIN: `npx -c '<otaverb>'`, `npm exec -c '<otaverb>'`,
  `npx --package=eas-cli -- tsc --version`, `yarn dlx --package=eas-cli -- tsc --version`, and
  the discriminator `sudo npx -c '<otaverb>'` -- the already-closed command-position PREFIX axis
  reaches that site, so the missing dimension is the chain and nothing else.
  **The `yarn -p ...` over-denial cost is real but covers only ONE of the three pieces** -- the
  bare `(pnpm|yarn)` arm. A stacked launcher or a wrapper word after a launcher is not ordinary
  developer typing, so that cost argument does not reach them, and an earlier revision of this
  bullet implied it did. Closing them needs a chain variant WITHOUT the bare package-manager
  alternative, which is a new constant for one deny site; filed rather than built here.
  The `xargs`-constructed shape this todo already recorded stays a residual too: the
  gated text never appears in the command, so no text matcher reaches it.

- **FOUND IN REVIEW AND CLOSED IN THE SAME PR -- the yarn WORKSPACE SCOPE.** The round-1
  security review measured `yarn workspace <ws> <cmd>` and `yarn workspaces foreach exec <cmd>`
  reaching the OTA sink on `origin/main` AND on this branch's first revision, while the comment
  beside `_OUT_LAUNCHER_ANY` claimed it covered `every spelling that hands the NEXT word to a
real binary`. That is the same argument-taking class as `npm explore`, of which exactly one
  spelling had been implemented -- so the universal was false and the residual block, which
  covers brace tokens only, read as exhaustive over a live route. `_OUT_WS_SCOPE` now closes it
  in both roles the shape needs (a launcher arm, and an absorber at the four OTA-script
  anchors), and the comment is enumerated rather than universal.
  **THAT SENTENCE WAS NOT TRUE WHEN IT WAS WRITTEN, and took two further rounds to become
  true -- which is the durable lesson of this bullet, not the fix it describes.** Round 2
  measured two more members of the same class still ALLOW on this branch and on main: a
  REPEATED scope hop (`yarn workspace <ws> workspace <ws2> <cmd>`, which needs no second `yarn`
  literal because yarn re-dispatches the remainder through its own top level) and yarn's `run`
  step (`yarn run <gated> <verb>`, which npm and pnpm do not have because their `run` is
  script-only). Round 3 measured a third: `yarn workspaces run <cmd>`, yarn CLASSIC's forwarding
  spelling of the same selector. Each round closed the rows it had been shown and restated the
  class as closed; each following round found another spelling. The arm is now written as the
  FORWARDING PROPERTY -- exactly `run` and `foreach`, because `info`/`list`/`focus` forward
  nothing and cannot reach a sink -- and the corpus axis generates all three chain forms rather
  than pinning remembered rows, so a fourth spelling would have to be a new yarn feature. Read
  the trajectory before trusting any "closed" claim in this file: three consecutive rounds found
  a live route that a careful reading of the same code had just declared covered. 13 deny rows and 10
  over-denial controls pin it on the normal path, and the corpus manifest moved by exactly the
  64 new rows with zero removals and no id in both lists -- which is the evidence that no
  pre-existing row silently rerouted. An earlier revision of this sentence cited "the 49-row
  invariant set", which HAS NO REFERENT IN THE TREE: it is a scratchpad row file, so a reader
  cannot check it. The criterion-2 bullet in this same closure section was rewritten to cure
  exactly that defect, and the very commit carrying that cure reintroduced it here -- so the
  rule is not "cite carefully", it is **cite something the reader can open**. Two drafts of
  THIS sentence then failed the same way: both located the other bullet by position ("two
  paragraphs later", then "above"), and `scripts/check-claim-staleness.js` rejected each,
  because an offset stops being true the moment anything is inserted near it. Name the
  referent -- `criterion 2` is a label and survives; a count is not.

  The crude fastpath also gained a `workspaces?` alternative, and what it is FOR was stated
  wrongly at first: the round-2 review mutation-tested each claimed role, removed just that
  alternative, and measured zero normal-path movement -- because `crude_smells_outward` has
  four call sites and all four are DEGRADED entry points (no jq, jq extraction failure, lib
  unsourceable, blanking returned empty). It is load-bearing on those three paths only, where
  both OTA-script rows go base ALLOW / with-alternative DENY / without-alternative ALLOW.
  **Nothing pinned it there** -- the two normal-path rows would have passed with the line
  deleted -- so thirty `nojq_hook`/`nolib_hook`/`noawk_hook` rows now COVER it. **That is a raw row count, not
  a discrimination count, and the distinction matters because the sentence it sits in is about
  what would redden if the line were deleted.** Round 3's "ten" WAS a discrimination count,
  verified by mutation; updating the number without re-checking what the number meant silently
  changed the claim, and a review caught it by re-running the mutation over all thirty rows --
  fewer than half of them flip. The count is re-derived with grep at the moment of writing
  rather than carried forward, which fixes staleness but not this: **a number can be freshly
  derived and still answer a different question than the sentence asks.**, and the reason is
  restated in the guard beside the regex. The lesson is sharper than the bug: a comment that
  justifies a line with a reason the suite can disprove makes that line EASIER to delete than
  no comment would. I applied four edits at once and measured the whole; isolating each role
  by mutation is what found it, and that is the test I should have run.
