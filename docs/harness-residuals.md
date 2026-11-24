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

### HIT IN REAL USE 2026-11-04 — auto mode gives "no verdict" on every hook-rewritten call, so each short-form review dispatch costs two calls and one executor stopped (#1738–#1746)

Observed in one auto-mode session (`/todo` run plus PR review). The review-dispatch mod
(`.claude/mods/review-dispatch/hooks/register.ts`, ~line 298) expands a one-line `REVIEW-DISPATCH …`
prompt into the full AI_WORKFLOW contract. It does this by returning a changed input
(`{ ...e, prompt: decision.prompt }`). The auto-mode classifier then refuses the call with "a hook changed
this call's input after auto mode reviewed it, so the review does not cover what would run". The refusal
quotes the expanded input and asks for it to be reissued, exactly, in a response of its own. A reissue of
the full prompt passes, because the mod returns an unchanged input (`e`) when the prompt already equals its
expansion.

What it hit:

- All 10 short-form reviewer dispatches in the session were refused, then accepted on the exact reissue
  (10/10): #1738 ×2, the storage split, #1743's confirmation, 4 parallel domain reviewers (#1741, #1743,
  #1744, #1745), #1746 ×2. Each refusal carries the ~8 KB expanded prompt, so every dispatch costs two
  calls and the prompt twice.
- "Put nothing else in that response" turns a parallel batch into a second all-reissue turn. The 4 domain
  reviewers needed two turns.
- **One `/todo` executor stopped** (storage split, #1744). Its `code-reviewer` dispatch was refused. It
  retried with its own short form, not the quoted expansion, was refused again, and stopped before pushing,
  as the error tells it to. The orchestrator then ran the review and resumed it. A later executor, told in
  its dispatch prompt to reissue the quoted input, got through (#1743).
- The same family hit Bash calls that the RTK hook rewrites (a plain read or filter rewritten to its `rtk`
  form): "no verdict", and once a second, untouched call in the same response was voided with "another call
  in this response was changed by a hook". The exact reissue passed each time.
- Prose in a Bash heredoc also tripped `guard-outward-cli` ("verb is not literal text") while this entry was
  being written. The text was appended with the Edit tool instead.

Not the cause: the classifier never judged a call unsafe. Every refusal was the "no verdict" kind, and no
review was skipped.

**Option 1 SHIPPED 2026-11-04 (owner: "Option 1").** `todo-executor.md` Step 6 item 3 (the review dispatch)
and Step 10 item 7b (the confirmation dispatch) now say to reissue the quoted input and never stop on this
refusal. Not yet verified in a fresh `/todo` run: agent files load on
session start. Options 2 and 3 stay open.

**Option 2 SHIPPED 2026-11-04 (owner: "option 2").** The mod no longer changes the call. A
`REVIEW-DISPATCH` line is refused with the filled contract between `----- BEGIN PROMPT -----` and
`----- END PROMPT -----` lines, and the caller reissues that text as the whole prompt. The reissue goes on
as it came (`next(e)`), so auto mode has nothing to refuse, and Option 1's executor wording was replaced by
the reissue rule. A refused line records no baseline; the reissued full prompt does. A full prompt carrying
the uncommitted sentence keeps the `mode=uncommitted` baseline exemption. Measured: 13/13 mod tests; a
headless `claude -p` probe with only this mod loaded received the 9,911-character expansion and wrote it
back byte-identical. Cost: every short-form dispatch now takes two calls in every session, auto mode or not,
because the mod cannot see the permission mode. Before, that was only in auto mode. Not yet seen in a fresh
`/todo` run: mods and agent files load at session start. Option 3 stays open.

First check if reopened (pick one):

1. One line in `.claude/agents/todo-executor.md` Step 6: "If the dispatch is refused with 'a hook changed
   this call's input', reissue the Agent call with exactly the quoted input." No CI time; fixes the stopped
   executor.
2. Have the mod DENY with the expanded prompt in the reason instead of rewriting. The agent sends the full
   prompt once, so the classifier reviews what actually runs. Still one wasted call, but no "no verdict" and
   no executor stop.
3. An auto-mode allow rule for `Agent` calls to the roster reviewers (read-only agents). This needs the
   owner's settings change, not a repo edit.

### Constructed 2026-11-10 — the pg-lab distill gate's email allowlist names the developer's address (privacy audit 2026-11-10, L9)

`scripts/pg-lab/distill-gate.py` (`EMAIL_ALLOWLIST`) and its test `.claude/hooks/test-pg-lab-distill.sh`
carry the developer's personal address in a tracked file of a public repo. It is a working allowlist
entry, not a fixture: the gate lets that address through in distilled transcripts, and the test asserts
it. The three test fixtures that used the address now use `example.com`; these two were left alone
because changing the entry changes gate verdicts.

If reopened: read the address from git config (`user.email`) at run time instead of pinning it, and have
the test set it. The address also stays in git history either way.

### HIT IN REAL USE 2026-11-16 — one new solution title broke the inject hook's first-touch byte budget for `server/routes/**` (#1896)

`.claude/hooks/test-inject-patterns.sh` requires a first touch of `server/routes/recipes.ts` to fit
inline under the hook's `THRESHOLD` (9000 B) with no `TRUNCATED` marker. A new solution with
`applies_to: ["server/routes/**/*.ts"]` and a 150-character title made that injection truncate, and the
"Lint · Types · Patterns" job failed on a docs-only PR. Shortening the title to 88 characters passed
at 8984 B, so the headroom on that path is under 20 bytes: the next solution that routes to
`security`, `api` or `architecture` and applies to `server/routes/**` can fail the same test with any
title of ordinary length. `client/components/**` has about 200 bytes left (8795 B).

The local gates do not catch it: `preflight:fast` does not run the hook self-tests for a `docs/`
change, and `check-solution-frontmatter` does not look at title length.

If reopened: cap the title length the hook prints per solution line (or the number of solution lines
per domain), so the payload size no longer depends on how long a new title is; and run
`test-inject-patterns.sh` in the pre-push gate when `docs/solutions/**` changes.

Hit again 2026-11-19 (#1933): a 184-character title put the same path at 9032 B; shortened to 129
characters it passes at 8976 B (24 bytes of headroom).

### Constructed 2026-11-17 — the todo-verifier record is enforced at the auto-merge guard, not at the merge hook (verifier Phase 2)

`scripts/todo-automerge-guard.sh` now HOLDs a low todo PR without a passing `todo-verifier` record
(written by `.claude/hooks/todo-verifier-record-writer.sh` from the verifier's own reply). Three gaps
are left open on purpose:

1. **The arming is still the executor's.** `merge-review-guard.sh` stage 1 runs the full guard on a
   `todo/*` branch, but when that HOLDs, stage 2 (`--paths-only`) still exempts a PR whose files are
   all on the allowlist. So an executor that ignores the guard's exit code and runs
   `gh pr merge --auto` gets through. The same is true today of a priority or keyword HOLD. What
   Phase 2 changed is where the verdict comes from (the hook's record, not the executor's relay),
   not who arms the merge. If reopened: in stage 1, deny an `--auto` merge of a `todo/*` branch
   whose full guard returns 1.
2. **Commits after the verified one are not re-verified.** The verifier runs at executor Step 6;
   Steps 7–9 can commit review fixes, the archive ticks and codify docs. The newest commit with a
   record governs, and `verifier-record-status.sh` prints how many commits came after it
   (`later_commits=`). Of the last 20 merged `todo/*` PRs, 9 had more than one commit and at least 5
   had a code fix after the first, so holding on any later commit would have held about a quarter
   or more of them.
3. **The record is an unprotected file** under the review-stamp directory, like the reviewers'
   records (review-stamp-writer.sh header): a fabricated record passes. It closes the honest
   failure (a verifier that never ran, or a misread verdict), not a deliberate forgery.

### HIT IN REAL USE 2026-11-16 — the advisory Mutation-on-diff check cannot mutate a module whose co-located test needs Postgres, and a green run can leave a module out (#1892, #1895, #1897)

Found 2026-11-19 while reading the runs for the coach grocery and pantry card PRs. The check is
advisory, so nothing was blocked; what it cost is that `server/services/write-cards/grocery.ts` and
`pantry.ts` were never mutated in CI across three PRs that changed them.

1. **A module whose co-located test opens a real database transaction gets no score.**
   `mutation-on-diff.yml` has no Postgres service on purpose (its own comment: a set `DATABASE_URL`
   is enough to import `server/db.ts`, and a test that does query "fails fast with ECONNREFUSED").
   For such a module Stryker's initial test run fails (`connect ECONNREFUSED ::1:5432`), the row
   reads `⚠️ explore exited 1`, and the job goes red as a harness failure. Runs `43960275874`
   (#1892, `grocery.ts`) and `43978622572` (#1897, `grocery.ts` and `pantry.ts`). The red job reads
   like "mutants survived" unless the summary table is opened.
2. **A green run does not mean every changed module ran.** Selection is alphabetical and stops at
   `MAX_FILES = 6`. On #1895 (run `43974398073`) six `client/lib` and `server/services/*.ts` modules
   filled the cap; `write-cards/grocery.ts`, `index.ts`, `pantry.ts`, `tool-args.ts` and
   `shared/lib/coach-write-card-math.ts` are listed under "Over the cap, not run", and the job was
   green.

Not changed here. The two files were mutated locally instead, where Postgres exists
(`npm run mutation:explore -- <module> <test>`, about a minute each). If reopened: give the job a
Postgres service, or select DB-backed tests out with their own summary note instead of a red row;
and order the cap by something other than path so one directory is not always the one left out.

### HIT IN REAL USE 2026-11-22 — merge-review-guard cannot merge a PR over 20,000 diff lines, from any session (#1974)

`.claude/hooks/merge-review-guard.sh` reads the whole PR diff with `gh pr diff <n>` for the
real-platform check, before either stage can allow. GitHub refuses a diff over 20,000 lines
(`HTTP 406: Sorry, the diff exceeded the maximum number of lines (20000)`, `PullRequest.diff
too_large`), so the guard denies fail-closed. #1974 (tracking ~150k lines of plan docs) was
reviewed and green on all 16 checks and still could not be merged by the agent. The only bypass,
`SKIP_MERGE_REVIEW=1`, has to be set in the shell that launched Claude Code, so the owner merged
it in the browser. `gh pr diff --name-only` fails the same way, so the review-stamp digest path
may hit it too.

Not changed here. If reopened: feed `platform-scope.sh` a diff assembled locally
(`git diff origin/<base>...<head sha>` after a fetch) or a per-file list from
`GET /pulls/<n>/files` (paginated, 3,000-file cap) when `gh pr diff` returns `too_large`, and keep
denying on any other gh error.

**FIXED 2026-11-22 (branch `fix/merge-guard-large-diff`).** `pr_diff` in the guard falls back to a
local `git diff base...head` on `PullRequest.diff too_large` only, for both the platform check and
the digest. It fetches `refs/pull/<n>/head` plus the base branch into `refs/merge-review-guard/`
(deleted after use), refuses unless the fetched head is the PR's head sha, and pins diff
prefixes/colour/ext-diff/textconv against user config, plus `--text` so a `-diff`/`binary`
attribute cannot collapse a file to "Binary files … differ" and hide its upload lines (security
review, row L6). The per-file API was not used: its `patch`
fields are truncated on large files, which would let an upload line slip past platform-scope.sh.
Rows L1-L6 in `test-merge-review-guard.sh`; checked live against #1974 (allow, no refs left).

**FIXED 2026-11-24, reviewer side.** The review-dispatch mod's `pr=<n>` form and
`scripts/review-record-status.sh` read the file list with `gh pr diff --name-only`, which failed
the same way on a too-large PR. On the `too_large` answer only:

- the mod lists the worktree's files against `base=` (`git diff --name-only <base>...HEAD`), which
  every `pr=` directive also carries;
- the script reads the names from `GET /pulls/<n>/files` (paged). Names have no line cap and the
  truncated `patch` fields do not matter for a name list. A list of 3,000 files (GitHub's cap) is
  not trusted and exits 3.

Any other `gh` failure still refuses the dispatch or exits 3. Checked live: for #1974 the
script's digest equals the one from the guard's local diff (`2f3371bd5006d6cb`, 123 files).
If the REST list and the guard's local diff ever name a rename differently, the digests differ and
`match=` is empty, which sends the caller to a fresh review.

### Review-record digest sorts the file list in the caller's locale (constructed 2026-11-23, not hit by the guard)

`.claude/hooks/review-stamp-writer.sh` and `.claude/hooks/merge-review-guard.sh` both hash the
changed-file list after a bare `sort -u`, so the digest depends on `LC_COLLATE`. Measured on this
machine: `printf 'b\nB\na\n_x\n' | sort -u` gives `_x a b B` under `en_CA.UTF-8` and
`B _x a b` under `LC_ALL=C`. A list with mixed-case names or names starting with `_` or `.`
therefore hashes to two different values.

The writer and the guard have so far run in the same shell environment, so their digests agree and
no merge was denied. Where it did bite: a by-hand recompute of the digest with `LC_ALL=C sort`
while checking the records for #1988–#1990 did not match the stored value, and looked like a
scope mismatch. If the two hooks ever ran under different locales (a remote session, a CI
shell), every gated merge would deny. That is fail-closed: it cannot let an unreviewed file
through.

**FIXED 2026-11-24.** `LC_ALL=C` is on the `sort` in the writer, the guard and
`scripts/review-record-status.sh`, changed together. To recompute by hand:
`… | sed '/^$/d' | LC_ALL=C sort -u | shasum | cut -c1-16`. Each suite has a row that runs the hook
with a stand-in `sort` that reverses its output unless `LC_ALL=C` is set, because CI and the cloud
container have only C locales installed and cannot reproduce a real collation difference.

One-time cost: a record written before this change, under a non-C locale, for a file list that
sorts differently in byte order (mixed case, or a name starting with `_` or `.` beside lower-case
ones), no longer matches. The guard then denies and asks for a re-review of that head.

### HIT IN REAL USE 2026-11-23 — merge-review-guard cannot read any PR from a Claude Code cloud session (#1985)

`.claude/hooks/merge-review-guard.sh` read the PR's head and base with `gh pr view <n> --json …`.
`gh pr view` goes through GraphQL, and a cloud session is refused it
(`HTTP 403: GitHub GraphQL is not available from Claude Code sessions; use the REST API`), so the
guard denied every merge fail-closed as "could not read PR". #1985 was reviewed on its final head
and green on all checks, the owner had said "merge them", and the agent still could not merge it;
the owner merged in the browser. REST (`gh api repos/{owner}/{repo}/…`) and `gh pr diff` both
answer from a cloud session (measured the same day).

**FIXED 2026-11-23 (branch `claude/kind-babbage-8av10x`).** The three `gh pr view` reads on the
merge path retry once over the REST PR resource (`gh api repos/{owner}/{repo}/pulls/<n>`): head
ref, head sha and base ref, and the PR body for the platform check, in the guard; the declared
changed-file count (`.changed_files`) in `scripts/todo-automerge-guard.sh`. Same PR, same
repository (the placeholders resolve from cwd as `gh pr view` does); both routes failing still
denies. Rows G1-G7 in `test-merge-review-guard.sh` and three cases in
`scripts/__tests__/todo-automerge-guard.test.ts`; checked live from a cloud session against #1986
(the guard reads the PR and reaches a verdict).

FIXED 2026-11-24, the four other callers, none of them on the merge path: `pr-verify.sh` (its
"could not verify PR state" warning fired after every PR creation and merge in a cloud session),
`git-safety.sh`'s merged-PR lookup before a branch deletion (every deletion read as "FAILED (gh
unavailable/network)"), `scripts/review-record-status.sh` and `scripts/verify-branch-merged.sh`.
Each still tries `gh pr view --json` first and, when that fails, retries through one shared helper,
`.claude/hooks/lib/gh-pr-rest.sh`, which reads the REST API and answers in `gh pr view`'s field
names and states. The helper keeps "no PR" (rc 1) apart from "could not look" (rc 2), so no caller's
fail-closed path changed. Tests: `test-gh-pr-rest.sh` and new cloud rows in each caller's suite.

FIXED 2026-11-24: the helper read only the first 100 PRs GitHub lists for a branch name, so a
branch with more PRs than that could miss its open PR and answer with a closed one. It now reads
every page (`gh api --paginate`) when the first page is full, after the head-filter check has passed on
that first page.

Still open, by design: a PR whose head lives in a fork is never matched by branch name (the
lookup asks for this repository's owner and rejects a row from another repository), so it reads as
"no PR" or "could not look"; this repository takes no fork PRs.

FIXED 2026-11-24: `merge-review-guard.sh` and `scripts/todo-automerge-guard.sh` kept their own
inline REST retry from #1987. Both now retry through the helper, which also returns
`headRefName`, `baseRefName`, `body` and `changedFiles` (the count is null for a branch ref, since
GitHub's PR list omits it; both callers ask by number). No verdict changes: a helper that cannot
be sourced is the same deny as both routes failing (row G8 in `test-merge-review-guard.sh`).
Open (found by that review, older than the change): the hook sources its `lib/` files at top
level, so a lib file that is present but calls `exit 0` would end the hook with no decision, which
is an allow. All four sourcing sites share this (`fastpath-filter.sh`, `cmd-detect.sh`,
`review-stamp-path.sh`, `gh-pr-rest.sh`). Reaching it needs a change to a reviewed file under
`.claude/hooks/lib/`. The fix would be to probe each lib in a subshell first.

Found alongside, also fixed on that branch: `test-git-safety.sh`'s "unenterable folder (chmod 000)"
row asserted a deny that cannot happen for root, and cloud sessions run as root, so
`scripts/run-hook-tests.sh` failed there and `preflight:fast` could not stamp any hook change. The
row now asserts the verdict that is true for the running user (allow for root, deny otherwise).
