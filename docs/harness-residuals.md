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

## Kept open at the freeze (both since shipped)

- Corpus latency: SHIPPED in #1016 (sharded + relevance-gated, 7m48s measured on a hook PR; skipped on others).

- Executor committing after its review (every `/todo` PR reached the merge gate unstamped):
  SHIPPED in #1005 (the executor binds a review record to the PR head) and closed by #1061
  (accepts an advisory record). Todo archived as
  `todos/archive/P2-2026-09-20-todo-executor-commits-after-review-…`.

## Frozen (archived 2026-09-22, full analysis in `todos/archive/<file>`)

### Bypass shapes (constructed, not seen in real use)

| Todo                                                                                      | Gap                                                                                        |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| P1-2026-09-12-merge-review-guard-extractor-miss-is-a-silent-allow                         | Unparseable `gh pr merge` spellings are silently allowed by the merge gate                 |
| P1-2026-09-15-a-root-flag-whose-value-is-a-bare-dash-hides-the-namespace-from-both-guards | A root flag with a bare-dash value hides the namespace from both merge guards              |
| P1-2026-09-16-redirect-in-arg-taking-global-value-slot-defeats-both-git-safety-layers     | A parameter expansion in the fd slot defeats the git-safety matcher (shape 2)              |
| P2-2026-09-16-brace-list-at-flag-position-reconstructs-a-gated-flag                       | A brace list at flag position rebuilds a gated flag on PR merge                            |
| P2-2026-09-13-post-verb-flag-walker-still-enumerates-and-keeps-two-copies-of-the-list     | Post-verb flag walker hand-enumerates gh flags, twice; one real flag missing               |
| P3-2026-09-15-brace-range-third-word-verb-unreachable                                     | Brace-range denial never reaches a third-word verb                                         |
| P3-2026-09-18-gh-api-endpoint-check-should-key-on-argv-position                           | Endpoint check keys on path shape, not argv position                                       |
| P3-2026-09-22-a-later-objection-cannot-retract-an-earlier-clean-record-at-the-same-head   | A later objection from one reviewer cannot retract its earlier clean record                |
| P3-2026-09-22-guard-c-passes-the-delivered-text-as-one-argv-string-so-a-1mib-delivery-…   | A delivery above 1 MiB makes guard (c) write no record (fail-closed)                       |
| _(no todo — #1436 confirmation review, 2026-10-13)_                                       | PR guard head pick scans the whole command: `echo --head X; gh pr create …` uses X's stamp |

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

`.claude/hooks/checkpoint.sh`, found 2026-09-27 (no todo filed): the Bash trigger uses
`cmd_git_work_discarder_verb`, which inherits the shared `_CMD_POS_PREFIX` grammar and so only
matches a literal `git` in command position. `/usr/bin/git checkout -- .` (the spelling agents
use inside worktrees to bypass RTK) takes **no** checkpoint. The Agent/Task trigger still fires
before any subagent dispatch, which covers the #956 reviewer case. Reopen if a work loss is
traced to an absolute-path git discard.

`.claude/hooks/lib/write-targets.sh --relative`, found 2026-09-27 (no todo filed): known
fail-open / spurious shapes. `cp -t DIR`/`--target-directory` reports the wrong destination,
same as default mode. `rm -- -weird` is missed (no `--` end-of-options handling). `sed -i
--expression=… f.ts` consumes `f.ts` as the script (target missed; only the two-token
`-e`/`--expression VALUE` form is skipped). `xargs rm` is missed (targets come on stdin, not
argv). An unquoted `cd`/`pushd` word anywhere suppresses ALL relative output; a quoted `"cd"`
does not. `npm rm pkg` is a spurious match. `~` and `$VAR` are never expanded — joined to `cwd`
exactly as spelled.

lint-staged stash vs. the shared stash stack, found 2026-09-29 (#1172, no todo filed): an
executor's archive commit recorded its todo at `status: in-progress` although the working tree
held `status: done` at commit time; the code files in the same commit were byte-identical to the
tree. Not root-caused. Suspected mechanism: lint-staged's own stash/restore runs against the git
stash stack that every worktree shares, while other sessions had live entries on it (one was
`wip-quicklogdrawer-red-check-…`). The next commit on that branch corrected the file. Reopen if a
commit is again seen recording content different from the staged tree.

`guard-outward-cli.sh` `gh api` inside a quoted command substitution, found 2026-10-11 (PR #1385
security review, no todo filed): a lone call whose method comes from backticks, a nested `$(`,
or a split verb with an unreadable method -- e.g. ``echo "$(gh api r -X `echo POST`)"`` --
allows; the cut clause loses the marker the unreadable-method check keys on. Before #1385 a
SECOND `gh api` in the same command hid this behind the group refusal; #1385 checks each call
on its own, so 16 two-call rows of a 2380-row generated probe (all in the
`echo "$(<read>) $(<mutation>)"` shape) moved DENY -> ALLOW. No new route: each is beaten by
the single-call spelling main already allowed. Fix shapes if reopened: keep the marker in the
cut clause, or keep the group refusal when an occurrence sits inside a command substitution.

`.claude/hooks/lib/write-targets.sh` unexpanded `$VAR/<file>` write target, found 2026-10-17 (a
`/todo` run, no todo filed -- hook-lib finding): a redirect, `rm`, or `cat >` whose target is a
shell variable spelled in the command text (`rm -f "${TODO_TMP:?}/open-prs.txt"`,
`cat > "$TODO_TMP/scheduler-state.json"`) is emitted as the literal, unexpanded token. The header
already notes `${…}` is unmodeled and that over-split is a false POSITIVE, not a bypass; this
records the cost. `scripts/pg-lab/session-coord.sh` (record/consult) stores and matches that
token as a file path, so two sessions whose commands carry the same `$TODO_TMP/<name>` text are
read as editing ONE file -- even though `/todo` keys `TODO_TMP` by session id precisely so the
real paths differ (#1485). Observed twice in one autonomous run: "Blocked once: another Claude
session is working on this file. Session d8c6c4af … edited $TODO_TMP/open-prs.txt 8 min ago" and
the same for `$TODO_TMP/scheduler-state.json`, each an "ask the user" stop with no user present;
the other session had no `/tmp/todo-d8c6c4af\*`directory, so the retry was taken. Writing the
expanded path literally avoids it. Fix shapes if reopened: drop a target whose first segment
starts with`$` (git-safety.sh already does this for branch names -- "could not resolve a literal
branch name … looks like an unexpanded shell variable"), or expand `$CLAUDE_CODE_SESSION_ID`-keyed
spellings before storing. No new route: the real files were never shared.

### HIT IN REAL USE 2026-10-22 — merge gate allowed an unstamped MCP merge (#1535)

Observed, not constructed; root cause not investigated (harness frozen). Context: the laptop rebooted
mid-session, which cleared `/tmp` (and with it any earlier review record for #1535's head), and Claude Code
resumed under a new session id. A `code-reviewer` confirmation pass was then dispatched at head
`29cfb753b47fbc2abe3cea6a0dbeb0758136fd54` with the AI_WORKFLOW dispatch prompt verbatim and the file list from
`gh pr diff 1535 --name-only` (12 files); it handed back a well-formed report ending `No findings.`. Two hooks
then misbehaved:

- `review-stamp-writer.sh` (SubagentStop, `code-reviewer` matcher) wrote nothing:
  `/tmp/ocrecipes-review-stamps-07d4e12e42b1/29cfb753…/` did not exist afterwards, checked both inside and
  outside the command sandbox, and no `ocrecipes-review-stamps-*` directory existed at all.
- `merge-review-guard.sh` (PreToolUse, `mcp__github__merge_pull_request` matcher) then ALLOWED
  `merge_pull_request` for #1535 (owner/repo given, `expectedHeadSha` = that head); it merged as `400e6762`.

The merge itself was sound (a full review before the reboot and a clean confirmation at the exact head), so
nothing unreviewed landed. Unknown: whether either hook ran at all in the resumed session, and whether the
reboot (missing stamp root) or the hand-back delivery path is the trigger. First check if reopened: dispatch a
reviewer, then `ls` the stamp dir; then pipe a `merge_pull_request` payload for an open, unreviewed PR into the
guard by hand and read its decision.
