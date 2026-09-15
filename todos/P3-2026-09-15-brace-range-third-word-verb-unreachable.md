---
title: "Brace-range denial reaches the first verb word and `gh pr <verb>` only, so a third-word verb is unreachable and unmeasured"
status: backlog
priority: low
created: 2026-09-15
updated: 2026-09-15
assignee:
labels: [deferred, harness, security]
github_issue:
---

# A range glued into a THIRD-word verb is structurally out of reach

## Summary

`guard-outward-cli.sh`'s brace-range block has three trigger arms. They reach a range token
in the word immediately after the binary, `gh pr <word>` (arm 2 spells the literal `pr`,
with no namespace alternation), and a range token at command position. Any gated
construction whose verb is the **third** word is unreachable by construction.

**Pre-existing, not opened by the brace-range change** — every shape below also allows on
`origin/main`, and that change is a strict improvement: it closes the second-word forms
main allows. This is the owner's Model B ruling residual
(`todos/archive/P2-2026-09-06-outward-cli-guard-brace-range-splits-token-with-no-sigil.md`,
RECLASSIFIED 2026-09-07). Filed so the bound is visible rather than inferred from the word
"CLOSED".

## Measured

Each row's brace-free form DENIES, so the control is the same command without the range.
All four ALLOW at both `origin/main` and the brace-range head; probes ran under
`bash 5.3.15(1)-release`, asserted in the probe's own output, and were handed to the guard
as hook input rather than executed.

| construction                                   | bash expands to            | verdict |
| ---------------------------------------------- | -------------------------- | ------- |
| `npm run update:prev{i..i}ew -- --message x`   | the OTA publish path       | ALLOW   |
| `gh repo dele{t..t}e o/r`                      | `gh repo delete o/r`       | ALLOW   |
| `gh release up{l..l}oad v1 f.zip`              | `gh release upload …`      | ALLOW   |
| `railway variable se{t..t} K=V`                | `railway variable set K=V` | ALLOW   |
| `gh api repos/o/r -X POS{T..T}`                | `gh api … -X POST`         | ALLOW   |
| `gh pr create --re{p..p}o other/org --title t` | `--repo other/org`         | ALLOW   |
| `gh pr merge 42 --auto --adm{i..i}n`           | `--auto --admin`           | ALLOW   |

Controls in the same run, all DENY: the three literal forms, plus `gh pr me{r..r}ge 42` and
`eas up{d..d}ate --branch preview` (second-word verbs, which arms 1 and 2 do reach).

The first row is the one that decides priority if this is ever promoted: it reconstructs
this repo's own documented OTA publish command, which is the 2026-08-16 incident class.

**The scope is wider than this todo's title says, and the `-X` row is why.** The last three
rows are not third-word verbs at all — they are FLAG-NAME and FLAG-VALUE positions, which the
three arms never look at. The `-X` one is the sharpest, because that position has its own
dedicated check: measured, it denies the literal `POST` **and all three sigil spellings of
it** — `${M}`, `$M`, and the ANSI-C form — while letting `POS{T..T}` through. That is exactly
the thesis of `docs/solutions/conventions/brace-range-is-a-second-expansion-mechanism-not-a-sigil-spelling-2026-09-14.md`
reappearing one position over: a sigil-keyed check cannot see a brace range, because a brace
range is not a sigil. Treat "third-word verb" as one instance of the class rather than its
definition, and re-title when picking this up.

## Not measured by anything

`repro-outward-cli-corpus.sh`'s `r4brange-verb-*` axis generates from `FAM_IDS`, which
carries no third-word family — so no row moves if this regresses further, and no pin
records the cost.

## Acceptance Criteria

- [ ] Either generalize arm 2 beyond the hardcoded `pr` (a namespace alternation:
      `pr|repo|release|run|variable|vars|var|channel:|branch:`), or add a fourth arm of the
      form `${_OUT_POS_PREFIX}${_OUT_GATED_BIN}${_OUT_SEP}[^[:space:];&|]+${_OUT_SEP}${_OUT_BR_RANGE_TOKEN}`.
- [ ] Add a corpus family whose verb is the THIRD word, so the axis can see this class at
      all. Generate it, do not hand-list it — NOTE6's rule.
- [ ] Re-measure the four rows above plus their controls; every control must still DENY.
- [ ] Compare per-ID across all four paths for DENY->ALLOW, never by subtracting totals.
- [ ] Narrow or remove the residual wording in `guard-outward-cli.sh` once the bound moves.

## Two further unmeasured costs found in the same review

Separate from the gap above, both fail-closed, both currently invisible to every row:

- **Arm 3 over-deny.** Arm 3 fires on a non-gated command-position token whose next word
  merely happens to be in `_OUT_GATED_VERB` (which includes `run`, `build`, `up`, `rm`,
  `delete`, `remove`), provided another clause supplies a gated-binary needle so the fast
  path does not cheap-exit. Measured base->head: `npm ci && ./bin/t{1..2} build` and
  `gh pr list && kubectl{1..2} delete pod x` both went ALLOW->DENY. Bypassable with
  `ALLOW_OUTWARD_CLI=1`, and the arm's own comment calls it defense-in-depth — but no row
  pins the cost, so a developer meets it mid-task instead of reading it here.
- **A brace in the FIRST-WORD flag slot over-denies a read-only command.** Arm 1 reaches a
  flag when it is the first word after the binary, and does not check whether the command is
  mutating. Measured: `gh --repo other/org pr list` ALLOWs, while
  `gh --re{p..p}o other/org pr list` DENYs — `gh pr list` is read-only, so the brace alone
  turns an allowed command into a denied one. Fail-closed and bypassable with
  `ALLOW_OUTWARD_CLI=1`, same class as the arm-3 over-deny above, and equally unpinned.
- **Degraded mirror is not glue-anchored.** A benign range anywhere in the same segment
  after a gated binary now denies on all three degraded paths:
  `npm run build -- --out dist/file{1..3}.js` and `yarn test spec/a{a..c}.ts` both went
  ALLOW/ALLOW/ALLOW/ALLOW -> ALLOW/DENY/DENY/DENY. Consistent with established posture,
  not new behaviour in kind: the control `npm run build -- --out $DIR/x.js` already denies
  on those same three paths on main, via the existing dollar-or-backtick alternative in the
  same mirror. The degraded path only runs when jq, awk or the lib is already broken. The
  corpus's only range-bearing ALLOW row, `fp-forloop`, carries no gated binary and therefore
  cheap-exits, so it cannot pin this.

Both want one EXPECTED row each so the cost shows on every run.

## Risks

- Widening arm 2 or adding a fourth arm touches a REQUIRED check; a careless edit wedges
  every PR in the repo. Mutation-verify against branch ⊕ main, never the bare tip.
- Arm 3's class is already wide; generalizing arm 2 must not widen it further by accident.

## Updates

### 2026-09-15

- Filed from the verification pass on the brace-range PR. Scoped out of it because the gap
  is pre-existing, owner-ruled, and closing it means changing a required check's matcher.

### 2026-09-15 (later)

- Three flag-position rows added after review: the class is not limited to third-word verbs.
  The `gh api -X` row matters most — that position has a dedicated check which denies every
  sigil spelling of the value and misses the brace-range one.
