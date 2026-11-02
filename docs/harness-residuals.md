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

| Todo                                                                                      | Gap                                                                                                                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| P1-2026-09-12-merge-review-guard-extractor-miss-is-a-silent-allow                         | Unparseable `gh pr merge` spellings are silently allowed by the merge gate                                               |
| P1-2026-09-15-a-root-flag-whose-value-is-a-bare-dash-hides-the-namespace-from-both-guards | A root flag with a bare-dash value hides the namespace from both merge guards                                            |
| P1-2026-09-16-redirect-in-arg-taking-global-value-slot-defeats-both-git-safety-layers     | A parameter expansion in the fd slot defeats the git-safety matcher (shape 2)                                            |
| P2-2026-09-16-brace-list-at-flag-position-reconstructs-a-gated-flag                       | A brace list at flag position rebuilds a gated flag on PR merge                                                          |
| P2-2026-09-13-post-verb-flag-walker-still-enumerates-and-keeps-two-copies-of-the-list     | Post-verb flag walker hand-enumerates gh flags, twice; one real flag missing                                             |
| P3-2026-09-15-brace-range-third-word-verb-unreachable                                     | Brace-range denial never reaches a third-word verb                                                                       |
| P3-2026-09-18-gh-api-endpoint-check-should-key-on-argv-position                           | Endpoint check keys on path shape, not argv position                                                                     |
| P3-2026-09-22-a-later-objection-cannot-retract-an-earlier-clean-record-at-the-same-head   | A later objection from one reviewer cannot retract its earlier clean record                                              |
| P3-2026-09-22-guard-c-passes-the-delivered-text-as-one-argv-string-so-a-1mib-delivery-…   | A delivery above 1 MiB makes guard (c) write no record (fail-closed)                                                     |
| _(no todo — #1436 confirmation review, 2026-10-13)_                                       | PR guard head pick scans the whole command: `echo --head X; gh pr create …` uses X's stamp                               |
| _(no todo — outward-CLI false-alarm work, 2026-10-23)_                                    | FIXED 2026-10-24: a quote inside one heredoc's body threw off the quote scan, hiding a later command                     |
| _(no todo — worktree-contract false-alarm work, 2026-10-24)_                              | After an honored leading `cd <worktree> &&`, a shell function that changes folder hides it                               |
| _(no todo — found 2026-10-24, pre-existing)_                                              | `cp --target-directory=<main>/d x` is not read as a write into main                                                      |
| _(no todo — found 2026-10-24 by the #1552 review, pre-existing)_                          | `git log --output <main>/x` writes into main from any folder; neither layer reads it                                     |
| _(no todo — found 2026-11-01 by verdict-diff (N7), pre-existing)_                         | git-safety's contract check is silent on wrapped or quoted git: `sudo`/`env`/`command` prefix, `{ …; }`, `\git`, `'git'` |

The 2026-10-23 heredoc row, measured: `cmd_bare` (and the renderings built like it) scan a heredoc body
as shell text, so a lone `'` in a body flips its quote state for the rest of the command. Five lines are
enough: `cat <<'X'`, `'`, `X`, `echo 'abc`, `' ; eas update --branch production`. `guard-outward-cli.sh`
allows it (on `HEAD` before that day's change and after it), and bash runs the last line (checked with
`echo` in place of `eas`). Pinned as a KNOWN-WRONG row in `test-guard-outward-cli.sh`. The 2026-10-23
pre-pass declines whenever a command holds any other heredoc, so it neither causes nor widens this.

**Fixed 2026-10-24** (owner ruling: fix it, keep heredoc text visible). A new pass in
`guard-outward-cli.sh`, HEREDOC QUOTE CLOSE, finds each heredoc using `cmd_bare`'s own flat quote model.
When a body leaves a quote open, the pass inserts the matching closing quote just before the terminator.
Body text is unchanged, so cat, data and bash heredoc bodies stay as visible as before. The fix lives
in the guard, not in the four lib scanners, so every rendering reads the same text. Measured against main:

- **Heredoc corpus**, 6,480 rows (3 arithmetic prefixes [none, `echo $((1))`, `: $[1]`] × 8 starts ×
  9 bodies × 3 terminators × 5 after-lines × 0 or 1 extra heredoc): no row went from deny to allow. All
  1,028 rows that went from allow to deny are the bypass shape: a real heredoc whose body leaves a quote
  open, followed by a real command. That is 336 per prefix, plus 20 python heredoc rows under
  `echo $((1))`, where the inert pre-pass declines on `$(` and leaves the body visible.
- **Phantom-`<<` corpus**, 756 rows (14 `<<` contexts × 3 delimiters × 3 quote kinds × 3 finals ×
  2 joins): every row unchanged. The draft failed it. An arithmetic `$((1<<3))` was read as a heredoc,
  and a quoted line that only looked like its terminator caused a false close, so a later command went
  from deny to allow. The pass now skips a `<<` inside `((`…`))` or `$[`…`]` and a `<<` written after a
  word-start `#`. A second draft declined the whole pass on any `((`, and then one unrelated
  `echo $((1))` brought the bypass back. Pre-push review found it, and a test row now pins it.
- **The security review of #1555** found 3 more contexts that corpus lacked: `${x:-<<X}`, `${x/<<X/y}`
  and `a[1<<X]=1`. Each went from deny on main to allow on the PR, and bash ran the last line. The pass
  now also skips a `<<` inside `${…}` or inside an unclosed `[` of the current word. To stop relying on
  a hand-picked context list, a **self-grading corpus** of 1,984 rows (31 `<<` contexts × 2 delimiters ×
  2 quote kinds × 8 terminator shapes × 2 commands) checks each flip against real bash, with the
  outward command swapped for `echo RAN`. Result: 0 rows where main denied, this change allows, and bash
  runs the command. A positive control (the review's row) runs under both bash and zsh. 96 rows did go
  from deny to allow, and in every one neither bash nor zsh 5.9 runs the command. They are real
  heredocs followed by a line whose own quotes close (`' ; eas update … #'`), so the outward text is one
  quoted word, not a command. Main denied them only because of the desync.

The pass keeps its result only when every quote ends up closed. When a close would leave a quote open
to the end, the command stops at that syntax error and nothing after it runs. Main's reading of such a
command (a deny) is kept rather than flipped to allow.

Still not covered: other hooks that use `lib/cmd-detect.sh` (git-safety, merge-review-guard and others)
do not run this pass. The owner's ruling covered the outward-CLI guard only. Also still open, and present
before this change: `cmd_bare` has no comment model, so one `'` inside a `#` comment flips its quote
state. The pass follows `cmd_bare` here on purpose, because its inserted quote must match what
`cmd_bare` thinks is open, so it then misses the heredoc on the next line. Measured: `echo # '`, then
`cat <<'X'` with two `'` lines in its body, `X`, `echo 'abc`, `' ; eas update …` is ALLOW on both main
and this change. Closing it needs a comment model that all the scanners share.

The 2026-10-24 rows, measured with `git-safety.sh` before and after that day's change. **Leading cd:**
`git-safety.sh` now judges a command's git segments from the folder of one leading `cd <abs> &&`. It
does so only when the text after it holds no cd/pushd/popd/eval/source/exec/builtin/command word,
no `$`, no backtick and no dot command. A 6,500-row generated corpus (cwd × folder spelling × joiner ×
13 second stages × 5 git commands) showed no other DENY→ALLOW. What the text cannot show is a
function from the shell profile that changes folder, such as zoxide's `z`: `cd <wt> && z main &&
git commit` from a main session was DENY and is now ALLOW. From a worktree session it was already
ALLOW. **`--target-directory=`:** `cp --target-directory=<main>/d a` is ALLOW before and after; only
the separate `-t <dir>` spelling is read. Over-denial left in place: the file-tool guard
(`guard-worktree-isolation.sh`) does not share the new `.superpowers/` exemption, so a Write-tool
write there is still denied. All 5 real blocks were shell appends.

**Review fixes for #1552, same day.** The security review measured two DENY→ALLOW cases, both now closed
with test rows. (1) After `cd <missing folder> && …`, anything following `;`, a lone `&`, `||` or a
newline runs in the ORIGINAL folder. A leading cd with any of those separators is now honored only when
its folder exists. A 672-row corpus (7 cd targets × 4 middles × 6 separators × 4 finals, against the
guard before #1552) shows that missing folders now flip only in pure `&&`/`|` chains. (2) `git stash
list --output <main>/x` writes a file, so stash options now come from a closed read-only list. **`git log
--output`:** git writes the file itself, and neither the mutating-git check nor the write-target reader
sees it. `git log --output <main>/p` is ALLOW from a main or worktree cwd, both before and after #1552.
So a `stash list --output` run in a worktree after an honored cd is this same pre-existing class.

**Review fixes for #1553, same day.** The #1553 review measured two cases the list above did not cover.
(1) The Bash tool's shell is zsh, and zsh brace-expands `{-..-}-output` to `--output`. That plain-looking
argument got past the closed list, so a brace in a stash argument is now allowed only as a closing `{N}`
(`stash@{0}`, `@{1}`). This was not a regression: main allowed `--output` outright. (2) A folder that exists but
cannot be entered (`chmod 000`) also fails the cd, so the separator rule now requires `-d` and `-x`. In
a 612-row stash-argument corpus (2 verbs × 17 tokens × 18 second slots, against main), no row went from deny to allow. Every row that went from allow to deny
holds a non-`{N}` brace.

### Over-denial and friction (the guard blocks legitimate work)

| Todo                                                             | Gap                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| P2-2026-09-10-outward-cli-guard-denies-prose-naming-two-pr-verbs | Prose naming two PR verbs is denied                                |
| P2-2026-09-17-out-flag-run-value-slot-swallows-the-command-word  | An incidentally-named gated script denies                          |
| P3-2026-08-16-command-guards-fire-on-heredoc-prose               | Writing _about_ a guarded command in a commit/PR body trips guards |

Workaround for all three: commit messages and PR bodies go through the Write tool + `-F`.

Narrowed 2026-10-23 (owner ruling, `guard-outward-cli.sh` only): help-only clauses
(`railway|eas|gh <subcommand words> --help|-h`) and the body of a quoted heredoc fed to python/node
no longer deny. Of the 10 false alarms from 2026-10-12 to 2026-10-23, those two shapes were 6. The
other 4 were heredoc text written with `cat` or fed to a script as data. They stay denied under the
2026-09-22 ruling, because a heredoc written to a file and run later is an invocation.

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

`guard-outward-cli.sh` latency on `gh pr merge`, measured 2026-10-25 (#1558, no todo filed):
about 183 ms (median of 5), the slowest Bash PreToolUse hook on that payload. Claude Code runs
matching hooks in parallel, so this one hook sets that call's wall time; the other hooks finish
inside it. On `ls` and `git commit` the slowest hook is 25 ms and 50 ms. Merging the hooks into
one dispatcher would be slower (closed no-go, full table in
`todos/archive/P3-2026-10-23-single-dispatcher-for-bash-hooks.md`). Reopen only if merge calls
feel slow in real use; the lever is this guard's own work on `gh` commands, not the hook count.

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

**Resolved 2026-11-01 (harness diagnosis §2.3, item 8 + N8):** the allow was correct. All of #1535's files
are on the safe-path allowlist (`todo-automerge-guard.sh --paths-only 1535` returns 0), so no record was
needed. The guard said nothing when it exempted the PR, and that silence was misread as a miss. An exempt merge
now prints `merge-review-guard: PR #N needs no review record — …` to both the owner and the agent. The missing
record itself was the SubagentStop race, fixed separately on 10-29.

### HIT IN REAL USE 2026-10-23 — `code-reviewer` hand-backs write no review record; `mobile-reviewer` does (#1541)

Observed, not constructed; root cause not investigated (harness frozen). Three background reviewers were
dispatched at head `c00524a4db3caf5f0f86a16ba15719216b7cbbb2`, each with the AI_WORKFLOW dispatch prompt
verbatim: `mobile-reviewer` over 18 files, and `code-reviewer` over all 27 changed files, twice (the second a
fresh dispatch). All three handed back a well-formed report ending `No findings.`. Only
`/tmp/ocrecipes-review-stamps-07d4e12e42b1/c00524a4…/mobile-reviewer.json` was written (verdict clean,
digest `a310edc52ff5da85`); neither `code-reviewer` run left a file. `merge-review-guard.sh` then correctly
denied `merge_pull_request`: the one record's digest did not cover the PR's 27-file digest `94b7daa172c8abe0`.
The owner merged #1541 on GitHub.

Checked and ruled out, using `jq` on the three transcripts: each has exactly one `SubagentHandback`, none
contains any of the three severity tags, and none has a trailing text wrapper. `.claude/settings.json`'s
SubagentStop matcher includes `code-reviewer`. Differences between the passing and failing reports: the
`code-reviewer` lists include `.github/workflows/ci.yml`, `eslint.config.js` and `test/mocks/…` paths, and
their bodies quote shell commands containing `|` and `2>&1`. Together with the #1535 entry above (also
`code-reviewer`, also no record), this is the second session in a row where the baseline reviewer cannot
produce a merge record. First check if reopened: replay one of these hand-back payloads into
`review-stamp-writer.sh` with tracing on (`bash -x`) against a throwaway stamp root, and see which `exit 0`
it takes.

### HIT IN REAL USE 2026-10-28 — a hand-back with no closing text wrote no review record (#1592)

A `code-reviewer` dispatched in the background against `6993a2fd789ef004bf29ad364d8272dfa3527bfe` delivered a
well-formed report (full REVIEWED-SHA, all 9 changed files, last line `No findings.`) in ONE `SubagentHandback`
and then stopped with NO final text message. `review-stamp-writer.sh` wrote nothing: the stamp dir
`/tmp/ocrecipes-review-stamps-07d4e12e42b1/6993a2fd…/` did not exist after the task-completion notification,
and `merge-review-guard.sh` correctly DENIED the merge. A re-dispatch told to end with the plain text line
`Review complete and handed back; no blocking issues.` after the hand-back stamped `code-reviewer.json`, and
the merge went through (`9bbd3d7c`).

Not measured: why the no-wrapper shape fails. Reading the writer, an empty `last_assistant_message` should
fall to the transcript's last text (none, so empty), then the `NHB == 1` branch should substitute the
hand-back. A replay of that transcript through the writer with `REVIEW_STAMP_ROOT` in the scratchpad was
denied by auto mode, so whether the hook ran, saw a non-empty `last_assistant_message`, or read a transcript
flushed before the hand-back is open. Workaround: every reviewer dispatch asks for that closing text line.

### HIT IN REAL USE 2026-10-29 — three background reviewers in a desktop session wrote no review record (#1614)

The 2026-10-28 shape again, now with the replay that entry could not run. In a Claude desktop (Code tab)
session, `code-reviewer`, `mobile-reviewer` and `server-reviewer` were dispatched in parallel (the app runs
every subagent in the background) against `ad7babedb4fc2c4c99277b4092ab6779cbd867b4`, with the AI_WORKFLOW
prompt verbatim and the 19 files from `gh pr diff 1614 --name-only`. Each delivered one well-formed
`SubagentHandback` (full REVIEWED-SHA, all 19 files, last line `No findings.`) and stopped with no closing
text. No record was written: `/tmp/ocrecipes-review-stamps-07d4e12e42b1/ad7babed…/` did not exist, and
`merge-review-guard.sh` correctly DENIED the merge.

Measured by replaying the server reviewer's real transcript (it ends `TOOL: SubagentHandback`, no text)
through `review-stamp-writer.sh` with `REVIEW_STAMP_ROOT` in the scratchpad, run under bash:

| `last_assistant_message` in the payload                 | records | verdict |
| ------------------------------------------------------- | ------- | ------- |
| `""`                                                    | 1       | clean   |
| key absent                                              | 1       | clean   |
| `Review complete and handed back; no blocking issues.`  | 1       | clean   |
| control: same transcript, `agent_type: general-purpose` | 0       | —       |

So the writer's logic handles the no-closing-text hand-back; the 2026-10-28 "why" is not in its parsing.
What remains is outside the script: the `SubagentStop` hook did not run for these background subagents, or
ran before the transcript held the hand-back. Not measured which. Note the 10-28 workaround (ask for a
closing text line) was not in this dispatch, so it is untested here.

Landed by owner instruction ("Write the records"): the writer was run by hand on each of the three real
transcripts into the real stamp dir; all three came out `verdict: clean`, digest `87e21253048aae4f`, and the
gate then allowed the merge (`471a2e9`). First check if reopened: dispatch one background reviewer in a
desktop session with a hook that only logs (`date >> <scratchpad>/subagentstop.log`) on the same matcher, and
see whether it fires at all.

**Cause found and fixed 2026-10-30 (#1618) for the 10-28 and 10-29 shape; the 10-23 entry is likely the same race but was not re-measured.**
The hook ran EARLY. A temporary logging line in the writer caught a real background `mobile-reviewer` (Claude
Code 2.1.312) with a readable transcript holding 0 hand-backs and `last_assistant_message` null at hook time,
and the hand-back was present 3 s later. The writer now polls for the hand-back for up to 5 s
(`REVIEW_STAMP_HANDBACK_WAIT_SECS`, capped at 8 inside the 10 s hook timeout); cases 78-80 in
`test-review-stamp-writer.sh` pin it.

### Constructed 2026-11-01 — the real-platform scope check misreads a git-quoted path (#1678, review)

`scripts/harness/platform-scope.sh` (read by `merge-review-guard.sh`'s platform check and by
`todo-automerge-guard.sh`) takes the file path from `diff --git a/<old> b/<new>` by field. Git quotes
a path with spaces or non-ASCII bytes (`diff --git "a/client/a b.ts" "b/client/a b.ts"`), the fields
split inside the quotes, and an upload change in such a file reads as not in scope (reviewer measured
rc 1). No such path exists under `client/`, `patches/`, `plugins/` or `modules/` today. First check if
reopened: read the path from the `+++ b/…` line (or `git diff --no-prefix -z`) instead of the header.
