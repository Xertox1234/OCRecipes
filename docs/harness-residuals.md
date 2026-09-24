# Harness Residuals — known gaps, frozen

**Ruling (user, 2026-09-22):** guard/hook hardening is **frozen**. The command guards in
`.claude/hooks/` exist to stop an agent from _accidentally_ running an outward-facing command
(the 2026-08-16 OTA incident). They are not, and cannot be, a complete parser of adversarial
shell. Each fix closed one family and review found the next one, so the backlog kept growing.
In September, 35 of 45 archived todos were harness work, and 15 of the 18 open harness todos
had come out of reviewing an earlier harness PR.

So a **constructible** bypass or over-denial in a guard is recorded here, **not** filed as a
todo. Reopen an entry only when it has actually been hit in real use (an accidental command got
through, or real work was blocked). Promote it then by moving its archived todo back into
`todos/`.

Review findings against `.claude/hooks/**` go to this list (see `docs/AI_WORKFLOW.md` →
Review Policy → One review pass per PR).

## Still open as todos (not frozen, they cost time on every PR)

- Corpus latency: SHIPPED in #1016 (sharded + relevance-gated, 7m48s measured on a hook PR; skipped on others).

- `todos/P2-2026-09-20-todo-executor-commits-after-review-…`: forces a confirmation review on
  every `/todo` PR.

## Frozen (archived 2026-09-22, full analysis in `todos/archive/<file>`)

### Bypass shapes (constructed, not seen in real use)

| Todo                                                                                      | Gap                                                                           |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| P1-2026-09-12-merge-review-guard-extractor-miss-is-a-silent-allow                         | Unparseable `gh pr merge` spellings are silently allowed by the merge gate    |
| P1-2026-09-15-a-root-flag-whose-value-is-a-bare-dash-hides-the-namespace-from-both-guards | A root flag with a bare-dash value hides the namespace from both merge guards |
| P1-2026-09-16-redirect-in-arg-taking-global-value-slot-defeats-both-git-safety-layers     | A parameter expansion in the fd slot defeats the git-safety matcher (shape 2) |
| P2-2026-09-16-brace-list-at-flag-position-reconstructs-a-gated-flag                       | A brace list at flag position rebuilds a gated flag on PR merge               |
| P2-2026-09-13-post-verb-flag-walker-still-enumerates-and-keeps-two-copies-of-the-list     | Post-verb flag walker hand-enumerates gh flags, twice; one real flag missing  |
| P3-2026-09-15-brace-range-third-word-verb-unreachable                                     | Brace-range denial never reaches a third-word verb                            |
| P3-2026-09-18-gh-api-endpoint-check-should-key-on-argv-position                           | Endpoint check keys on path shape, not argv position                          |
| P3-2026-09-22-a-later-objection-cannot-retract-an-earlier-clean-record-at-the-same-head   | A later objection from one reviewer cannot retract its earlier clean record   |
| P3-2026-09-22-guard-c-passes-the-delivered-text-as-one-argv-string-so-a-1mib-delivery-…   | A delivery above 1 MiB makes guard (c) write no record (fail-closed)          |

### Over-denial and friction (the guard blocks legitimate work)

| Todo                                                             | Gap                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| P2-2026-09-10-outward-cli-guard-denies-prose-naming-two-pr-verbs | Prose naming two PR verbs is denied                                |
| P2-2026-09-17-out-flag-run-value-slot-swallows-the-command-word  | An incidentally-named gated script denies                          |
| P3-2026-08-16-command-guards-fire-on-heredoc-prose               | Writing _about_ a guarded command in a commit/PR body trips guards |

Workaround for all three: commit messages and PR bodies go through the Write tool + `-F`.

Review-stamp writer, recorded from the #1019 review (no todo filed):

- The top severity word as the FIRST word of a prose line, followed by a space or period, still
  records `findings` (`_CRIT_TAG` accepts any non-alphanumeric after the word). The
  NARROWED comment in `review-stamp-writer.sh` lists only `[TAG]`, `**TAG**` and `TAG:`, so it
  describes less than the code counts. The error is deny-only. Workaround: don't open a prose
  line with the word (the dispatch prompt already says not to use it in prose).

### Structural / hygiene

| Todo                                                                 | Gap                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------- |
| P1-2026-09-07-outward-cli-path-wrapper                               | PATH-wrapper defence in depth (design ruled #952; proof only) |
| P3-2026-09-14-site-upd-cb-verbs-still-hand-listed-not-extracted      | Two verb lists hand-listed rather than extracted              |
| P3-2026-09-15-corpus-row-count-prose-drifted-from-an-earlier-pin     | Corpus prose quotes stale row counts                          |
| P3-2026-09-15-git-safety-outcome-clauses-still-hardcode-branch-nouns | Six outcome clauses still hardcode branch nouns               |
| P3-2026-09-20-scope-contract-forbade-the-only-workable-fix           | Scope contracts name files too narrowly                       |

`test-preflight-output.sh`, found 2026-09-23 (no todo filed):

- Its "quiet mode" assertions (`assert_not ... "NPM_NOISE_LINE" ...` and the `✗` marker check)
  never `unset PREFLIGHT_VERBOSE` before invoking the real `scripts/preflight.sh` under test. If
  the _calling_ shell already exports `PREFLIGHT_VERBOSE=1` (e.g. a human or agent streaming
  `preflight.sh --fast --uncommitted` for its own debugging visibility) AND the diff also touches
  `scripts/*.sh`/`.claude/hooks/**`/`.husky/**` (so `run-hook-tests.sh` actually runs), the leaked
  env var flips the nested preflight.sh into verbose mode mid-self-test, producing 2 false FAILs
  ("quiet: npm noise suppressed on success", "fail: shows a failure marker"). Reproduced 3x: fails
  every time under `PREFLIGHT_VERBOSE=1 scripts/preflight.sh --fast --uncommitted` when
  `scripts/preflight.sh` itself is the changed file; passes every time (`bash
.claude/hooks/test-preflight-output.sh` standalone, `bash scripts/run-hook-tests.sh` standalone,
  and `scripts/preflight.sh --fast --uncommitted` with no env override — the documented Step 5a
  invocation and what CI/the real gate always uses). Non-blocking: CI and the documented executor
  invocation never set `PREFLIGHT_VERBOSE`, so this never fires in practice — only when someone
  passes the env var by hand into a diff that also touches hook/script files. Workaround: don't
  pass `PREFLIGHT_VERBOSE=1` to an outer preflight run whose diff also triggers
  `run-hook-tests.sh`; run the hook suite standalone instead (`bash scripts/run-hook-tests.sh`).

`test-inject-patterns.sh`, found 2026-09-24, source PR #1039 review (no todo filed):

- Its routing assertion at ~lines 225-226 (`check "vitest.config.ts → testing rules" ...`)
  asserts pattern-injection routing against the literal fixture `"vitest.config.ts"` and never
  exercises `"vitest.config.mts"`, though the real config file was renamed to `.mts` in #1039
  (Vite native-config-loader migration). `scripts/lib/path-domains.ts`'s `config-file` matcher
  currently matches ANY extension on the basename, so nothing is broken today — but the self-test
  gives no regression coverage if that matcher were ever narrowed to `.ts`-only. Frozen harness →
  residual only, no fix.
