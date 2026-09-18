---
title: "A field-based `gh api` mutation at the merge endpoint passes BOTH local guards — the merge-review gate never fires"
status: done
priority: high
created: 2026-09-16
updated: 2026-09-18
assignee:
labels: [deferred, harness, security]
github_issue:
---

# A field-based `gh api` merge passes both `guard-outward-cli.sh` and `merge-review-guard.sh`

## Summary

`gh api -f merge_method=squash /repos/o/r/pulls/42/merge` is ALLOWED by **both**
`guard-outward-cli.sh` and `merge-review-guard.sh` on unmodified `main` today. It is a real
merge route. The merge-review gate — the local policy requiring a recorded review before any
merge — never fires on it.

## Background

Measured 2026-09-16 against `origin/main`'s unmodified hooks, both guards, with controls
passing in the same run and zero void rows:

| command                                                                | `guard-outward-cli` | `merge-review-guard` |
| ---------------------------------------------------------------------- | ------------------- | -------------------- |
| `gh pr merge 42 --squash` (control)                                    | n/a                 | **DENY**             |
| `gh api --method PUT /repos/o/r/pulls/42/merge -f merge_method=squash` | **DENY**            | **DENY**             |
| `gh api -X POST /repos/o/r/pulls/42/merge`                             | **DENY**            | —                    |
| `gh api -f merge_method=squash /repos/o/r/pulls/42/merge`              | **ALLOW**           | **ALLOW**            |
| `gh api /repos/o/r/pulls/42` (read-only control)                       | ALLOW               | ALLOW                |
| `ls -la` (control)                                                     | ALLOW               | ALLOW                |

**The discriminator is the explicit method, not the process substitution.** Both guards key on
a spelled-out method (`-X`, `--method`). `gh` infers `POST` from the presence of `-f`
field arguments, so the `-f`-only form is a POST that never says so. Adding root flags or a
process substitution before the verb changes nothing — the plainest spelling already allows.

### This was mis-attributed when first reported

Surfaced by the `two-token-gh-needles` executor (PR #985) as a psub-before-verb ordering
bypass. Re-measurement shows ordering is irrelevant: `gh api -f a=b /…/merge` with no psub
and no root flags allows identically. Do not spend time on the process-substitution angle.

### Why nothing is tracking it

`test-guard-outward-cli.sh` deliberately pins the allow:

    # The one-command mutating form is ALLOW on main too — pinned so a reader does not
    # mistake the rows above for a claim that this change closed it. It is the P2
    # gh-api-route todo's.
    assert_allow "the ONE-command -f mutation is allowed here, as it is on main (pre-existing)"

The todo it defers to is `todos/archive/P2-2026-09-12-merge-review-guard-does-not-model-the-gh-api-merge-route.md`,
which is `status: done`. That file's line 39 states:

> `guard-outward-cli.sh` denies both today, so this is **not** currently a live bypass.

**That sentence is false as of 2026-09-16** and is retracted in the same change that files this
todo. It was true of the construction that todo measured (`--method PUT`, an explicit method)
and does not hold for the `-f`-only form. The pin therefore defers to a closed todo that
disclaims the very thing the pin is pinning, and the gap fell between them.

### Severity

`high`, and deliberately higher than
`P2-2026-09-16-brace-list-at-flag-position-reconstructs-a-gated-flag.md`. That one is stopped
by GitHub (`enforce_admins: true`), so the harm cannot land. **This one is stopped by nothing
local.**

Bounded by the 9 required status checks, and by nothing else on the approvals axis. Measured
via a read-only API read rather than recalled: `enforce_admins: true`, 9 required checks,
`strict: false`, `required_approving_review_count: 0`, `require_code_owner_reviews: false`.

**Required approvals are NOT a layer here — zero are required.** An unreviewed merge is
already reachable through the sanctioned `--auto` path by design, so do not justify this
todo's priority on an approvals bypass. What this route defeats is the LOCAL merge-review
gate, which requires a recorded reviewer verdict for the head sha before any merge. That
control is purely local, has no server-side counterpart, and this route walks past it in
silence. GitHub's 9 checks still stand, so a PR with failing CI cannot be merged this way.

Noted separately, out of scope, pre-existing, so it is not lost: `allow_force_pushes` reads
`true` on `main` — a different vector entirely.

## Acceptance Criteria

- [x] `gh api -f merge_method=squash /repos/o/r/pulls/42/merge` is DENIED by
      `merge-review-guard.sh` when no valid review record exists for the head sha.
- [x] The same command is DENIED by `guard-outward-cli.sh`, or a written decision records why
      one layer is deliberately sufficient.
- [x] The `ALLOW_OUTWARD_CLI=1`-prefixed form is also denied by the merge gate — the merge gate
      must not inherit the sibling guard's escape.
- [x] Two-sided control asserted in the same run: an ordinary read-only `gh api` call still
      passes silently, and prose merely naming the endpoint is not denied.
- [x] `test-guard-outward-cli.sh`'s existing `assert_allow` pin for the one-command `-f`
      mutation is UPDATED (it currently asserts the bug), and its comment no longer defers to a
      closed todo.
- [x] `repro-outward-cli-corpus.sh` passes with per-path verdicts and deny attribution
      unchanged, or the pin is re-derived from a real run with the delta explained.
- [x] Mutation-verified: reverting the new branch leaves the suite red.

## Implementation Notes

**Read first:** `todos/P1-2026-09-12-merge-review-guard-extractor-miss-is-a-silent-allow.md`
→ "Prior Attempt — READ BEFORE WRITING CODE". PR #941 carried a miss-detection branch that was
WITHDRAWN in `22b88513` after three rounds proved it unshippable — it denied ordinary prose
every time it was tightened. The false-positive boundary is the hard part here, not the
detection.

**Most of the mechanism already exists — do NOT build a second needle and deny pair.** An
earlier revision of this note repeated the archived todo's "add a fast-path needle" suggestion
and cited `merge-review-guard.sh:172-181` as the deny path. That citation was wrong (those
lines are unrelated comment prose) and the suggestion is obsolete. Verified against
`origin/main`:

- the fast-path needle **already includes** the gh-api-merge pattern —
  `cmd_fastpath_has "$CMD" '*gh*pr*merge*' '*gh*api*merge*'` at `merge-review-guard.sh:108`;
- the precise gh-api detector spans `:341-397` and already sets `PR=""` on a hit (`:397`);
- that routes into the unresolvable-ref deny at `:499-517`, whose message text (`:516`)
  already names "a merge attempted via `gh api` against the raw REST route".

So the explicit-method case is fully handled today. **The single missing piece is the method
conjunct.** Both guards require a literal `-X`/`--method` token:

- `MRG_API_M` at `merge-review-guard.sh:358`, consumed at `:376`
- `_GH_API_M` at `guard-outward-cli.sh:3783`, consumed at `:3830`

Each needs to treat the PRESENCE of `-f`/`-F`/`--field`/`--raw-field`/`--input` as the
implicit POST that `gh` actually sends — which `merge-review-guard.sh`'s own comment at
`:295-325` already prescribes. Widening those two conjuncts is the change; re-deriving a
duplicate needle+deny pair on this file is the failure mode its history warns about.

**Do not key the fix on an explicit method.** That is exactly the assumption that produced this
gap. `gh` infers the method from the argument shape: `-f`/`-F`/`--field`/`--raw-field` imply
POST. Enumerate from `gh api --help`, not from the spellings that come to mind — see
`docs/solutions/logic-errors/an-invented-enumeration-is-not-the-space-ask-the-tool-2026-09-13.md`.

**Measurement harness.** Both guards need a JSON envelope on stdin:

    {"tool_name":"Bash","tool_input":{"command":"..."}}

Bare command text fails envelope parsing and returns a fail-closed deny whose reason contains
`could not be read`. That looks exactly like a real verdict. Three probe attempts during the
2026-09-16 investigation were void this way before the failure mode was noticed. Detect that
string explicitly and treat such a run as VOID. Every probe needs a positive control (the
classic `gh pr merge` spelling, which must DENY) and a negative control (a read-only `gh api`,
which must ALLOW) in the SAME run; without the negative control the whole family denies for
unrelated reasons and the method-specific dimension is masked.

**Never execute the construction** — feed the guard the string and read the verdict. An active
outward-CLI guard also refuses a Bash command whose own text contains such fragments, so probe
strings belong in a FILE that is then run, never inlined on the command line.

`.claude/hooks/**` feeds main's REQUIRED Outward-CLI guard corpus check; a careless edit wedges
every open PR. Mutation-verify against the merge result (branch ⊕ main), never the bare tip.

## Scope Contract

- **Mechanisms to use:** the existing fast-path needle + unresolvable-ref deny path in
  `merge-review-guard.sh`, and the existing method-detection in `guard-outward-cli.sh`. No new
  hook, no new scanner.
- **Files in scope:** `.claude/hooks/merge-review-guard.sh`,
  `.claude/hooks/test-merge-review-guard.sh`, `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/test-guard-outward-cli.sh`, `.claude/hooks/repro-outward-cli-corpus.sh`,
  possibly `.claude/hooks/lib/fastpath-filter.sh` / `lib/cmd-detect.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Serialize against any open PR touching `guard-outward-cli.sh` or
  `repro-outward-cli-corpus.sh`. As of 2026-09-16 that is #980, #982, #983 and #985. They all
  collide on the same four pin constants, and those pins are NOT reconcilable arithmetically —
  whichever lands later must re-derive from a measured run rather than hand-resolving.
- `todos/P1-2026-09-12-merge-review-guard-extractor-miss-is-a-silent-allow.md` covers the same
  hook and the same false-positive boundary. Consider closing both in one change rather than
  twice through the same risky file.

## Risks

- The withdrawn PR #941 attempt shows this hook punishes over-broad matching: every tightening
  round denied ordinary prose. A needle matching `merge` anywhere in a command will do it again.
- Widening a matcher is monotone on a BOOLEAN read but NOT on a COUNT — a longer match absorbs
  what would have started a second one. Verify per deny SITE and per alternation BRANCH.

## Updates

### 2026-09-16

- Filed after measurement during the P2 batch run. Surfaced by the `two-token-gh-needles`
  executor (PR #985) as a process-substitution ordering bypass; re-measurement with controls
  showed ordering is irrelevant and the real discriminator is the absent explicit method.
- Retracted the false "not currently a live bypass" line in
  `todos/archive/P2-2026-09-12-merge-review-guard-does-not-model-the-gh-api-merge-route.md`
  in the same change.

### 2026-09-18 - CLOSED. gh's implicit POST, modelled from the CLI's source

- **The rule, not the spellings.** `gh api --help` says the method "defaults to GET normally and
  POST if any parameters were added", which leaves `--input` ambiguous. The CLI's source does
  not: cli/cli `pkg/cmd/api/api.go:329-330` reads
  `if !opts.RequestMethodPassed && (len(params) > 0 || opts.RequestInputFile != "") { method = "POST" }`,
  and `RequestInputFile` IS `--input` (api.go:301). So the condition implemented in both guards
  is **a field parameter or `--input`, AND no method flag anywhere** — gh's own predicate, not a
  list of flags someone thought of. This todo's own file had already settled that half against
  the source; the fix is the settlement applied.

- **BOTH HALVES OF THE CONDITION ARE LOAD-BEARING, and only one is obvious.** Keying on "a field
  is present" alone would deny `gh api -X GET /repos/o/r/pulls/42/merge -f foo=bar` — an
  EXPLICIT READ, because `RequestMethodPassed` is true and gh's switch never fires. A merge gate
  that denies reads is the failure that gets a guard switched off rather than fixed, so both
  guards anchor on the ABSENCE of a method token exactly as gh anchors on `!RequestMethodPassed`.
  Pinned on both sides.

- **The two guards needed DIFFERENT SCOPES for identical input**, which is easy to get backwards
  in either direction. `gh api /repos/o/r/issues -f title=hello` is not a merge (merge gate:
  ALLOW) but IS a mutating gh call (outward guard: DENY, matching what its explicit `-X POST`
  twin already did). A merge gate denying issue creation, or an outward guard permitting it,
  would each have been a defect.

- **Spellings closed, measured:** `-f`, `-F`, `--field`, `--raw-field`, the glued `--field=k=v`
  form, and `--input`. The todo's table named only `-f`; `-F`/`--raw-field`/`--input` and the
  glued form were found by constructing the space rather than by reading the table.

- **THE PIN THAT ASSERTED THE BUG, and why it survived so long.** `test-guard-outward-cli.sh`
  carried `assert_allow "the ONE-command -f mutation is allowed here, as it is on main
(pre-existing)"`, deferring to `todos/archive/P2-2026-09-12-merge-review-guard-does-not-model-
the-gh-api-merge-route.md` — a CLOSED todo whose own line 39 read "guard-outward-cli.sh denies
  both today, so this is not currently a live bypass", which is false for the `-f`-only form.
  The pin pointed at the todo, the todo pointed away, and the gap lived between them. **A pin
  that defers to a document, and a document that disclaims the pin, is a gap nothing can see.**

- **THREE ROWS THE SUITE FLIPPED WERE NOT ABOUT THIS BEHAVIOUR AT ALL**, and converting them to
  bare denies would have kept the suite green while deleting three checks. They test that a
  `- post` VALUE is not read as a forged `-X`, that `--methodology` is not mistaken for
  `--method`, and that a markdown backtick is not read as a substitution. All three are genuine
  implicit POSTs so denying them is correct — but each now asserts the IMPLICIT-POST REASON, so
  a guard that forged `-X` from a value, or misread `--methodology`, would fail the row by
  denying for the wrong reason. The property is preserved against the mechanism that now carries
  it.

- **The corpus expectation change, stated so it is checkable rather than trusted.** Three rows
  (`apicolfp-oneshot`, `c2-fp-methodology`, `c2-fp-backtick`) moved `want` from ALLOW to DENY.
  Moving a `want` is also how one would bury a real over-denial, so: each is a field-parameter
  call with no method flag, hence a POST by api.go:329-330; and the corpus's own per-path tuples
  show every one reading `p=ALLOW j=DENY l=DENY a=DENY` before and DENY on all four paths after.
  **The three DEGRADED paths were already denying them** — the precise path was brought into
  agreement with its own fail-closed mirror. Three independent mechanisms converged on the same
  three ids (the suite, the precise-gap list, the all-path dirty list), which is what makes the
  change a convergence rather than moved goalposts. The `fp` in each id is kept on purpose so the
  move stays visible.

- **Pins re-derived from real runs, with the delta explained:** `EXPECTED_ALLPATH_GAPS`
  358 -> 355 (-3, those rows stop being dirty — a DECREASE, which is the unusual direction and
  is annotated in place), `EXPECTED_DENY_ATTRIB_ROWS` 1789 -> 1792 (+3, they now attribute to
  the new deny), `EXPECTED_EMIT_SITES` 42 -> 43 (one new message), `EXPECTED_PRECISE_GAPS`
  unchanged at 62 once the expectations were corrected. Zero unexplained movement, and NO id in
  both the added and removed lists — so no pre-existing row kept its verdict while rerouting.

- **Mutation-verified (criterion 7):** with both guards reverted to the base commit and the new
  test files kept, the suites go red — 11 failures in the outward suite and 20 in the merge
  gate's. The rows assert the fix rather than passing incidentally.

- Suites: `test-guard-outward-cli.sh` 1116 passed / 0 failed; `test-merge-review-guard.sh`
  146 passed / 0 failed. Corpus: `rows=2031 precise-path gaps=62 all-path gaps=355; all 1792
deny reasons attributed to the same checks as the pin`.
