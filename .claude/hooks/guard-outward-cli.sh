#!/usr/bin/env bash
# PreToolUse(Bash) — structural deny for outward-facing CLI mutations: eas
# update/publish/submit (incl. mutating update:*/channel:*/branch:* colon
# subcommands and `eas build --auto-submit`), mutating railway verbs (incl.
# `railway run` and variable/service/environment sub-subcommands), npm publish,
# this repo's OWN `npm run update:preview|update:production` OTA scripts, and
# mutating gh subcommands (incl. `gh api` with a mutating HTTP method, and any
# gh PR write retargeted at another repo via --repo/-R). Hardens the prose-only
# mitigation in
# docs/solutions/conventions/never-execute-an-outward-facing-cli-fragment-in-review-2026-08-16.md
# after the 2026-08-16 accidental-OTA incident (a subagent ran a real `eas
# update` fragment while probing a PATH-stub hypothesis during a code review).
#
# SCOPE — this hook only sees the Bash tool's `tool_input.command` string. It
# does NOT cover the equivalent MCP tools available in some environments
# (`mcp__github__merge_pull_request`, `mcp__claude_ai_Railway__redeploy`,
# `mcp__claude_ai_Railway__create-deployment`, `mcp__claude_ai_Railway__set-variables`,
# …) — those bypass this hook entirely. The prose rule (code-reviewer.md
# contract + the conventions doc above) remains the only control for those
# paths. This is a Bash-only structural backstop, not a full sandbox — never
# cite it as covering the MCP surface.
#
# COMMAND-POSITION ANCHORS ARE GUARD-LOCAL. This hook uses its OWN
# `_OUT_POS_PREFIX`/`_OUT_POS_SUFFIX`, which STARTED (review round 3,
# 2026-08-16) as a deliberately widened fork of lib/cmd-detect.sh's
# `_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX`. Both sides have since evolved
# independently, so "deliberately WIDER" no longer holds across the board:
#   * suffix — the lib's `_CMD_POS_SUFFIX` was narrower at review round 3
#     (`([[:space:]]|[)]|$)`, missing `;`/`&`/`|`, never matching a verb that
#     is the TERMINAL token of its clause — `npm publish;`, `eas update;`,
#     `railway up&`, `eas update|cat` and `gh pr merge;` were all ALLOWED,
#     which is why this hook forked its own widened `_OUT_POS_SUFFIX`), but
#     the lib has since grown PAST it in four closers: `{`, `}`, `<`, `>`.
#     All four are now fixed here too: `{`/`}` are a LIVE bypass, not the
#     cosmetic gap an earlier version of this comment claimed — a COMMA-form
#     brace span glued to a verb (`merge{,x}`) is real bash brace EXPANSION
#     and places a standalone `merge` token in command position; a NO-comma/
#     NO-range span (`merge{x}`) genuinely stays one word and was never the
#     issue. `_OUT_POS_SUFFIX` now includes `{`/`}` (fixed 2026-09-02, see
#     the "2026-09-02 FIX" regression test in test-guard-outward-cli.sh). The
#     remaining two, `<`/`>`, are REAL redirect operators whose absence here
#     was ALSO a live, confirmed bypass — FIXED 2026-09-05
#     (outward-CLI-guard-folded-repair, finding A; see the full breakdown at
#     this file's `gh pr merge` CLAUSE= assignment below, search
#     `_OUT_POS_SUFFIX` past the occurrence-count check). `_OUT_POS_SUFFIX`
#     is now byte-identical to the lib's `_CMD_POS_SUFFIX`;
#   * prefix — opener class (backtick, `{`, `!`) is now IDENTICAL between the
#     two. The lib's redirect-absorption alternative (`_CMD_REDIR`, added
#     2026-09-01) was the one remaining guard-local GAP — a leading
#     `2>/dev/null`-shaped prefix before the verb was invisible to this
#     hook's own `_OUT_POS_PREFIX` — FIXED 2026-09-05
#     (outward-CLI-guard-folded-repair, finding B): `_OUT_POS_PREFIX` now
#     carries the same `_CMD_REDIR` alternative, referenced by variable, not
#     duplicated as a second literal pattern (`_OUT_POS_PREFIX`'s own
#     definition was relocated to follow the lib source so that reference
#     resolves). What remains guard-local in the OTHER direction —
#     the KEYWORD absorption (`then|do|else|elif|time`) — has no lib
#     equivalent and is not a gap. Full comparison in
#     test-guard-outward-cli.sh's comment above the backtick/brace/keyword
#     assertion block (search "STALE AS OF" there).
# The widening lives HERE, not in lib/cmd-detect.sh, because that lib feeds
# seven hooks (git-safety.sh, core-bare-guard.sh, pr-preflight-guard.sh,
# commit-verify.sh, pr-verify.sh, drift-detect*.sh) whose gates are outside
# this hook's scope contract. Widening an anchor can only ever ADD matches, so
# for THIS deny-only hook it is a strict superset — but for a lib shared with
# gates that *permit* on a match it is not, hence the local copy.
#
# CAVEAT (2026-09-02, round 3) — the "can only ever ADD matches" argument
# above is about the ANCHOR deciding WHETHER a verb is in command position at
# all, and is safe in the DENY-direction: this hook only ever widens toward
# more denies, never grants a carve-out. It does NOT extend automatically to
# what a downstream CLAUSE-CUT does with the text it captures once a match is
# found — the `gh pr merge` CLAUSE= assignment below was a working FALSE
# ALLOW for exactly this reason (a swallowing clause-cut over-captured into
# an unrelated glued-on command's decoy `--auto`), even though the anchor
# widening itself stayed safe. This is a SEPARATE axis from the (now-fixed,
# 2026-09-05) `<`/`>` detection gap disclosed at that same CLAUSE=
# assignment below (search "STRENGTHENED 2026-09-02") — that one was a
# missing boundary character causing total non-detection, not a
# capture-direction issue. See
# the CLAUSE= assignment's own comments and
# docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md's
# "clause-cut that DECIDES AN ALLOW" section for the full account of both.
#
# ROUND 4 (2026-09-02, independent PR #910 review) — a THIRD, still-open
# gap, same total-non-detection family the (now-fixed) `<`/`>` gap above was
# in, but a different trigger, and NOT closed by the 2026-09-05 `<`/`>` fix
# (nor by the same date's finding-B leading-redirect-absorption fix — a
# DIFFERENT axis, closed at `_OUT_POS_PREFIX`'s own definition): neither
# _OUT_POS_SUFFIX nor _OUT_POS_PREFIX
# nor _OUT_POS_SUFFIX_MERGE_CLAUSE treats a bash sigil that
# expands to nothing ($VAR unset, $(...)/${...} empty) as a boundary, even
# though real bash word-splitting collapses it away — `eas update$(true)
# --branch preview` and `gh pr merge 42$UNSET_VAR` are bash-identical to the
# spaced form but silently ALLOWED, verified live with paired deny controls.
# The suffix side looks like one added character; the prefix side is not
# (bash consumes the whole balanced sigil, leaving no single boundary byte to
# match on) — see the solution doc's own "second, distinct still-open gap"
# section for why this is disclosed whole rather than half-fixed. Still a
# human decision, still out of this repair's scope.
#
# MATCHING IS CASE-INSENSITIVE for the command words (`-i` on every verb grep,
# and on the necessary-substring fast path via `nocasematch`). macOS APFS is
# case-insensitive, so `EAS update`, `GH pr merge 42` and `RAILWAY down` all
# resolve to the real binaries; case-sensitive matching ALLOWED every one of
# them (review round 3). FLAG detection (`--admin`, `--repo`/`-R`,
# `--auto-submit`) stays case-SENSITIVE: gh/eas flag parsing is case-sensitive,
# so `--ADMIN` is not a real flag, and a case-insensitive `-R` would false-match
# the `-r` inside `--remove-reviewer`.
#
# `gh pr merge` CARVE-OUT — bare/immediate `gh pr merge` DENIES, but
# `gh pr merge --auto ...` stays ALLOWED (unless `--admin` or `--repo`/`-R` is
# also present — see below): arming GitHub's native auto-merge does not merge
# until required checks pass, on a branch-protected target — it is NOT a
# "nothing happens synchronously" carve-out (on a PR whose required checks have
# already passed, GitHub merges within seconds), it is a "the same gate a human
# would wait for still applies" carve-out. This repo's own sanctioned /todo
# automerge mechanism (scripts/todo-automerge-guard.sh +
# .claude/agents/todo-executor.md Step 10) calls exactly
# `gh pr merge <n> --auto --squash --delete-branch` for guard-eligible PRs.
# Denying that by default would break the pipeline, and todo-executor.md is out
# of this hook's Scope Contract, so the carve-out is done here instead. More
# than one `gh pr merge` occurrence in the same command is ambiguous — DENY
# (the safe direction for a deny gate; mirrors cmd_gh_pr_ref's identical
# multi-occurrence refusal in lib/cmd-detect.sh).
# `--admin` ("use administrator privileges to merge a PR that does not meet
# requirements") contradicts the carve-out's own premise (that branch
# protection still gates the merge) — DENY regardless of --auto when present.
#
# `gh pr create`/`gh pr comment` are deliberately NOT denied — outward but
# routine (this repo's PR-creation and review-request flow uses them; see the
# todo's own Implementation Notes carve-out) — EXCEPT when `--repo`/`-R` is
# present. That flag retargets the write at an ARBITRARY GitHub repository with
# the user's PAT, which is unbounded egress, not routine workflow:
# `gh pr comment --repo other/org --body "$(cat .env)"` was ALLOWED (review
# round 3). lib/cmd-detect.sh:242 already treats `--repo`/`-R` in any spelling
# as disqualifying for the same reason; this follows that precedent. The
# routine flow never passes `--repo`, so the carve-out is unaffected. The same
# applies to `gh pr merge --repo other/org 42 --auto`, which arms auto-merge on
# someone else's PR.
#
# DOCUMENTED RESIDUALS (guardrail, not a sandbox — a determined bypass is
# always possible; ALLOW_OUTWARD_CLI=1 is the intentional escape hatch):
#   * A global flag before the verb (`npm --registry=x publish`, `eas
#     --non-interactive update`) defeats command-position anchoring — same
#     documented class as cmd-detect.sh's own arg-taking-wrapper residual.
#   * `npx eas update` / `npx gh pr merge` are not recognized: `npx` takes an
#     argument, so it is not a zero-arg runner word _OUT_POS_PREFIX skips (by
#     design — see lib/cmd-detect.sh's header). `bunx`/`bun run` likewise.
#   * `eas publish` does not exist in the installed eas-cli (20.1.0 at time of
#     writing) — the pattern is kept anyway per the acceptance criteria's
#     literal wording and to catch an older/different CLI version; a no-op
#     today, not a false sense of coverage.
#   * A verb split across a shell line-continuation (`eas \<newline>update`) IS
#     covered on all three paths as of review round 3 — cmd_bare collapses the
#     backslash+newline to spaces on the precise path, and
#     crude_smells_outward() now normalizes both a real 0x0A byte and the JSON
#     `\n` escape token to a space on the two degraded paths (previously the
#     escape's literal `n` broke the `[^a-zA-Z]+` separator class and grep's
#     line-orientation split the two tokens — both fallbacks ALLOWED every verb
#     family). What is still NOT recognized is a genuinely MULTI-LINE compound
#     (a real newline with no continuation backslash) on the PRECISE path,
#     where grep -E cannot span the newline: that fails toward DENY for
#     `gh pr merge` (the `--auto` carve-out cannot be seen on another line), the
#     safe direction.
#   * `bash -c "…"` / `sh -c '…'` / `eval "…"` / any interpreter `-c` wrapper
#     (also: `timeout 30 eas update`, `sudo railway up`) hides or shifts the
#     outward command out of command position — the wrapper-word case is the
#     same documented arg-taking-wrapper residual as above; the quoted-`-c`
#     case blanks via `cmd_bare` (the same primitive that stops `git commit
#     -m "mentions eas update"` from a false-positive deny) — same accepted
#     residual class as git-safety.sh's own sudo/env/command/xargs/subshell/
#     eval wrapper note.
#   * A command whose ENTIRE text is quoted (`'eas update'`) blanks to nothing
#     under cmd_bare, which the awk-broken detector below cannot distinguish
#     from "the blanking primitive failed" — it therefore routes to the crude
#     smell test and DENIES. Over-denial on a shape no real caller writes; the
#     safe direction.
#   * Absolute/relative-path invocation (`/usr/local/bin/eas update`,
#     `./node_modules/.bin/eas update`) does not match the literal
#     `eas`/`railway`/`npm`/`gh` command word.
#   * `gh workflow run`, `gh secret set`, `gh variable set` and other gh
#     namespaces beyond `pr`/`release`/`repo`/`api` are not covered — the
#     todo scoped this to "verb-scoped, not exhaustive"; `gh api` itself IS
#     covered (mutating -X/--method only) because it can reach the identical
#     `pr merge` action this hook already gates, via a different subcommand.
#   * The eas `update:*` colon namespace is PARTIALLY covered: the mutating
#     forms verified against `eas update --help` (eas-cli 20.1.0) —
#     update:delete, update:edit, update:republish,
#     update:revert-update-rollout, update:roll-back-to-embedded,
#     update:rollback — are denied explicitly below; `update:list`,
#     `update:view`, `update:insights` are the verified-read-only set that
#     stays allowed. An `eas` CLI version that adds a NEW mutating `update:*`
#     subcommand not in this list is not covered until this list is updated.
#     The `channel:`/`branch:` namespaces are covered for the mutating verbs
#     create|edit|delete|rename only (review round 3 found `eas channel:edit`
#     and `eas branch:delete` ALLOWED with effects identical to already-denied
#     commands); their read-only `:list`/`:view` forms stay allowed, and any
#     OTHER `eas` namespace (`eas device:*`, `eas credentials`, `eas env:*`,
#     `eas metadata:push`, …) is explicitly OUT OF SCOPE — not covered.
#     (`gh api -X "POST" …`, a QUOTED HTTP method value, WAS listed here as an
#     accepted residual while the check ran on `$BARE`. It is caught now — the
#     check reads `$WORDS`, where the quote characters are already gone, so
#     `-X "PUT"`, `--method "PUT"` and `-X"PUT"` all read as their unquoted
#     spellings. Pinned in test-guard-outward-cli.sh.)
#   * `npm run update:preview|update:production` IS covered (see below), as are
#     the `yarn`/`pnpm` bare-script equivalents, and — since the _OUT_FLAG_RUN
#     fix — every FLAG spelling between the runner, `run`, and the script name
#     (`-s`, `--silent`, `--flag=value`, and `--flag value` with a
#     space-separated value). `bunx`/a shell alias/`corepack npm run …`/a direct
#     `sh -c "$(node -p 'require("./package.json").scripts["update:preview"]')"`
#     are not.
#   * QUOTED COMMAND WORDS — FIXED 2026-08-16, previously bypassed every check
#     in this file. `cmd_bare` BLANKS quoted spans, but the shell word-splits
#     `eas "update"` and concatenates `eas up"date"` into the argv `eas update`,
#     so the verb was erased before any pattern ran. Every INVOCATION pattern now
#     matches `$WORDS` (lib/cmd-detect.sh's `cmd_words`), which reproduces argv:
#     quote characters deleted, separators inside a span neutralised so
#     `git commit -m "chore; eas update"` still ALLOWS. The two carve-out blocks
#     (`gh pr merge`'s --auto, `gh api`'s method) both DETECT and VERIFY on
#     `$WORDS`: a quoted span is exactly one word there, so a quoted `--auto`
#     decoy (`-b "use --auto next time"`) becomes part of a larger token and
#     still cannot grant the carve-out. An earlier revision counted on both
#     renderings and denied when they disagreed; that was strictly worse, because
#     equal counts never proved the two had found the SAME occurrence.
#     Residual, BACKSLASH forms only: a verb split by a backslash (`e\as
#     update`) or prefixed by one (`\gh pr merge` — the alias-bypass idiom) is
#     still missed, because the renderings hide an escaped character rather than
#     unescaping it. The QUOTED flag forms are covered: quoted flag VALUES
#     (`gh api -X "PUT"`) via the $WORDS clause, and quoted flag NAMES
#     (`--ad"min"`, `--auto-"submit"`) because the two deny-only flag checks scan
#     raw `$CMD` AND `$WORDS`, fed to grep separated by a NEWLINE (never
#     concatenated — the seam would spell flags present in neither). They can only
#     ADD a deny, never grant a carve-out, so reading both renderings is free. Pinned in test-guard-outward-cli.sh under
#     "QUOTED COMMAND WORDS".
#   * SCOPE, stated so it is not inferred: `update:preview`/`update:production`
#     are the only package.json scripts covered. `migrate:images-r2` and
#     `backfill:recipe-images` also mutate production Cloudflare R2 in place
#     (CLAUDE.md notes a real backfill run needs a CDN purge afterwards) and are
#     deliberately NOT covered here.
#   * A verb GLUED TO A REDIRECT, no space required, on EITHER side — two
#     DIFFERENT mechanisms, both LIVE bypasses of this hook as of 2026-09-02,
#     both already closed in the shared lib (commit 33baffea, 2026-09-01):
#       - trailing: a redirect right after the verb (`eas update` + a `<`/
#         `>`) was invisible because `_OUT_POS_SUFFIX`'s closer alternation
#         did not include `<`/`>` as characters — the lib's `_CMD_POS_SUFFIX`
#         did. FIXED 2026-09-05 (outward-CLI-guard-folded-repair, finding A):
#         `_OUT_POS_SUFFIX` now carries `<`/`>` and is byte-identical to
#         `_CMD_POS_SUFFIX`. `_OUT_POS_SUFFIX_MERGE_CLAUSE`'s branch 2 (the
#         positive closer class) also carries `<`/`>`, for the same
#         anchor-closer reason; branch 2 alone is sufficient here because a
#         verb glued directly to a bare redirect (`gh pr merge>log`, no
#         further args) never enters branch 1's capture at all — see the
#         ACCEPTED OVER-DENIAL residual above for why branch 1 does NOT
#         carry `<`/`>` (a ROUND 2 revert, after a CRITICAL bypass). See
#         test-guard-outward-cli.sh's "2026-09-05: finding A" and "... ROUND
#         2" blocks.
#       - leading: a redirect right before the verb (a leading `2>/dev/null`
#         + the verb) was invisible for a DIFFERENT reason — it is not about
#         boundary characters at all: `_OUT_POS_PREFIX`'s absorber run (the
#         part that skips env-assignments and zero-arg runner words before
#         the verb) had no redirect-token alternative, so it could not skip
#         PAST a leading redirect to reach the verb. The lib's
#         `_CMD_POS_PREFIX` gained exactly that alternative (`_CMD_REDIR`, in
#         lib/cmd-detect.sh) on 2026-09-01; this hook's own copy was never
#         given one. FIXED 2026-09-05 (outward-CLI-guard-folded-repair,
#         finding B): `_OUT_POS_PREFIX` now carries the SAME `_CMD_REDIR`
#         alternative, referenced by variable (not a duplicated literal
#         pattern) — which is why the whole "command-position anchors"
#         definition block had to move to follow the lib source further down
#         in this file (interpolating `$_CMD_REDIR` before the lib is sourced
#         is an unbound-variable error under `set -u` — the hook aborts, so
#         no deny is emitted and the bypass is open, but LOUDLY: stderr is
#         dirtied and the suite goes 53/495. Corrected 2026-09-07; this used
#         to claim a silent empty expansion). This also closes a related
#         multi-occurrence undercount:
#         `gh pr merge 42 --auto ; 2>/dev/null gh pr merge 7` used to see
#         only the FIRST occurrence (the second's leading redirect hid it
#         from the count) and ALLOWED on the strength of the first's real
#         `--auto` while the second, --auto-less merge ran unconditionally —
#         now both are counted and the ambiguous-occurrence DENY fires
#         correctly. NEW ACCEPTED OVER-DENIAL as a side effect (deny
#         direction, never a bypass): because the absorbed leading redirect
#         is now part of the `gh pr merge` CLAUSE= capture, a leading
#         redirect that itself contains a `$` (`2>$LOGFILE gh pr merge 42
#         --auto`) trips the existing "any `$` in CLAUSE is unverifiable"
#         guard and denies a real, uncorrupted `--auto` — the same
#         documented over-broad-in-the-safe-direction behavior the CLAUSE=
#         assignment's own comment already discloses for a `$VAR` mention
#         elsewhere in the clause, now also reachable via the prefix.
#         Regression tests in test-guard-outward-cli.sh's "2026-09-05:
#         finding B" block.
#     See the COMMAND-POSITION ANCHORS header above and
#     test-guard-outward-cli.sh's "STALE AS OF 2026-09-02" comment (now
#     updated to reflect the finding-B fix) for the confirmed repro and the
#     full anchor-by-anchor comparison. (A THIRD, related `_OUT_POS_SUFFIX`
#     gap — `{`/`}`, real bash brace expansion, not a redirect — WAS fixed
#     the same review round: see the "2026-09-02 FIX" comment at this file's
#     `gh pr merge` CLAUSE= assignment.)
#   * ACCEPTED OVER-DENIAL (ruled 2026-09-05, outward-CLI-guard-folded-repair
#     finding A, ROUND 2) — a `gh pr merge` clause is DENIED, not allowed,
#     when a real, standalone `--auto` is GLUED directly to a trailing
#     redirect with NO space in between (`gh pr merge 42 --auto>/dev/null`
#     is the canonical shape — real bash argv, once the redirect is
#     stripped, is `pr merge 42 --auto`, a genuine armed automerge that this
#     over-denies). This is the pre-Task-2 behavior, NOT a new gap: it is
#     what `_OUT_POS_SUFFIX_MERGE_CLAUSE` already did before finding A, and
#     is restored here on purpose. A ROUND-1 attempt widened branch 1 (the
#     negated clause-cut class that decides how far the CLAUSE capture
#     runs) to stop at the same `<`/`>` boundary branch 2 uses, which DID
#     allow this glued shape — but a security review found that the SAME
#     widening also truncated the CLAUSE before a LATER `$`-bearing sigil on
#     constructions where a redirect lands between `--auto` and that sigil
#     (`gh pr merge 42 --auto >anyfile ${x:---admin}`), hiding the sigil
#     from the co-mask-c1 unverifiability guard at this file's CLAUSE=
#     assignment and SILENTLY ALLOWING a real administrator-override merge —
#     a live, CRITICAL bypass, not a theoretical one. ROUND 2 reverted
#     branch 1's `<`/`>` addition (branch 2 keeps it — a genuinely different,
#     closer-position role, unaffected by this revert) to close that bypass,
#     accepting this narrower over-denial instead: `<`/`>` are real bash
#     redirects that do not end the CLAUSE the way `;`/`&`/`|` do (bash
#     strips the redirect and keeps reading the words after it as the same
#     invocation), but branch 1's job is "keep capturing the rest of this
#     clause" — teaching it to STOP at a redirect anyway is exactly the
#     tradeoff that reopened the bypass, so it stays narrow. NEVER a bypass:
#     an over-deny here can only cost someone the escape hatch
#     (`ALLOW_OUTWARD_CLI=1`), never grant one. Two OTHER shapes were
#     checked and are UNAFFECTED: the realistic ordering a real user
#     writes, redirect last WITH a space (`gh pr merge 42 --auto
#     >/dev/null`), still correctly ALLOWS — `--auto` is already bounded by
#     real whitespace on both sides before the redirect is ever reached, so
#     branch 1's behavior at the redirect is irrelevant to that shape — and
#     a redirect landing BETWEEN the verb and a later real `--auto`
#     (`gh pr merge >/dev/null 42 --auto`) now correctly ALLOWS too (ROUND
#     1's over-denial on that shape no longer exists after this revert).
#     CANDIDATE IMPROVEMENT, explicitly NOT taken here (out of finding A's
#     scope, which is the closer class, not the grant-shaped `--auto` field
#     scan): keep branch 1 narrow AND teach the `--auto` field scan itself
#     to treat `<`/`>` as token boundaries, which would allow the glued
#     form too while keeping the CLAUSE intact for the `$`-guard. All four
#     constructions pinned in test-guard-outward-cli.sh's "2026-09-05:
#     finding A follow-up, ROUND 2" block, plus a corpus row
#     (`co-redir-mask`); full evidence in task-2-report.md.
#   * UNHANDLED GAP, CONFIRMED LIVE (labeled a gap, not an accepted cost —
#     this is a limitation, not a deliberate tradeoff), found and verified by
#     construction while documenting this residual, 2026-09-05: the `gh api`
#     unreadable-method check (C2) reads for a surviving `$` or backtick as
#     evidence a method value is not literal text. A plain ANSI-C-quoted
#     value (`-X $'POST'`) or locale-translated string (`-X $"POST"`) with NO
#     escape sequence inside is harmless — this hook's word-splitting strips
#     the sigil and quotes down to the bare literal text, so it still matches
#     the pre-existing literal-method check and correctly denies. The GAP is
#     an ANSI-C ESCAPE SEQUENCE inside the `$'...'` form: `-X
#     $'\x50\x4f\x53\x54'` is real bash for the literal string "POST" — CONFIRMED
#     (`VAL=$'\x50\x4f\x53\x54'; echo "$VAL"` prints `POST`) — but this
#     hook's word-splitting renders each `\xNN` escape as an alphanumeric
#     placeholder instead of either the escaped byte OR a surviving `$`/
#     backtick, so the clause contains neither the literal method text nor
#     either covered sigil. CONFIRMED a live, silent ALLOW against the real
#     hook (`gh api repos/o/r -X $'\x50\x4f\x53\x54'` → exit 0, empty output).
#     Octal (`\NNN`) and unicode (`\uHHHH`/`\UHHHHHHHH`) ANSI-C escapes are
#     the same mechanism and were not individually re-verified but have no
#     reason to render differently. NOT fixed here: the placeholder rendering
#     is produced by lib/cmd-detect.sh's shared word-splitting, which is
#     off-limits for this task's scope, and a guard-outward-cli.sh-only
#     workaround (detecting the placeholder's own text as a THIRD
#     "unreadable" signal) was not attempted — it would need its own
#     dedicated design and false-positive review, not a same-commit patch.
#     CLOSED — and this entry said otherwise for a day. It read "RE-CONFIRMED
#     STILL OPEN 2026-09-06 ... one of that file's three deliberate remaining
#     gaps". Measured 2026-09-07 against BOTH `origin/main` and this branch,
#     the corpus row reports:
#
#       c2-ansic-hex | DENY | DENY | DENY | DENY | DENY | ok
#
#     DENY on all five paths, identically on both trees, via C2's own "method
#     flag whose value is not literal text" branch. PR #929 closed it and swept
#     the corpus's NOTE6 (which records it CLOSED 2026-09-06 and counts it among
#     the 60) without sweeping THIS entry — so the two artifacts contradicted
#     each other for a day, and the DOCUMENTED RESIDUALS list, the one a reader
#     consults to learn what is still broken, held the wrong half.
#
#     "Three deliberate remaining gaps" was stale the same way: the file reports
#     31. A residual entry that names a COUNT takes on a dependency on that
#     count; prefer naming the row.
#
#     Kept rather than deleted, per this section's append-don't-delete rule. The
#     original measurement stands: the rendering is `-X xx50xx4fxx53xx54`, with
#     no surviving sigil for C2's "not literal text" branch and no literal POST
#     for the method branch — that reasoning was right about the RENDERING and
#     wrong about the DECISION, because a different branch catches it.
#
#   * CLOSED 2026-09-07 (todos/archive/P0-2026-09-06-outward-cli-guard-interior-
#     redirect-defeats-every-family.md). Kept in full, amended rather than
#     deleted, because the entry's own history is the lesson: it was rescoped
#     TWICE while open, and one of its measurements was wrong.
#
#     WHAT CLOSED IT: `_OUT_SEP` (defined below, next to the other anchors) —
#     ONE interior absorber, `([[:space:]]*$_CMD_REDIR)*[[:space:]]+`, reusing
#     the lib's `_CMD_REDIR` and applied UNIFORMLY to all 30 tool->verb and
#     namespace->verb separator slots in one change, detectors AND clause cuts.
#     At zero iterations it is byte-identical to the `[[:space:]]+` it replaces,
#     so only redirect-bearing commands can change decision at all. Measured on
#     the whole corpus: 59 rows closed, **0 opened**, per-ID, on the precise
#     path; 23 closed / 0 opened all-path. The two clause CUTS had to move with
#     the detectors — `gh_pr_clause_has_repo` and `_GH_API_CUT` both treat an
#     EMPTY clause as "nothing to deny", so a widened detector with a narrow cut
#     would have re-opened cross-repo PAT egress and the mutating-method check
#     while looking fixed.
#
#     ORIGINAL ENTRY, 2026-09-06, retained verbatim below except where marked:
#     An INTERIOR redirect, glued where the anchors
#     require whitespace between two words, silently ALLOWS **every gated
#     family measured**, not one corner of the file:
#       eas>/dev/null update --branch preview        -> ALLOW  (OTA publish —
#                                                     the 2026-08-16 incident's
#                                                     own command class)
#       npm>/dev/null publish                        -> ALLOW
#       railway>/dev/null up                         -> ALLOW
#       gh>/dev/null api repos/o/r -X POST           -> ALLOW
#       gh pr>/dev/null merge 42                     -> ALLOW
#       gh pr>/dev/null comment ... --repo other/org -> ALLOW
#       gh release>/dev/null create v1.0             -> ALLOW
#       gh repo>/dev/null delete o/r                 -> ALLOW
#       railway variable>/dev/null set K=V           -> ALLOW
#       railway service>/dev/null delete svc         -> ALLOW
#     Each spaced baseline correctly DENIES, so every row above is a total
#     detection failure, not an ungated verb — no check runs at all, which
#     is why even the --repo cross-repo egress check is skipped. Measured
#     2026-09-06 against the live hook.
#     CORRECTED 2026-09-07 — the sentence that stood here said "the
#     output-redirect, fd-duplicating (`2>&1`-shaped) and input-redirect forms
#     were each measured and each ALLOWS". IT CONFLATED A GUARD VERDICT WITH A
#     BYPASS, and one of its three forms was not a bypass at all: in the GLUED
#     fd spelling (`eas2>&1 update`) bash takes an fd number only when the
#     characters before the operator are ALL DIGITS, so `eas2` is the COMMAND
#     WORD — a different, non-existent binary. Nothing gated runs, and ALLOW was
#     the CORRECT answer, not a miss. This entry is careful about that
#     distinction two lines above ("the spaced baselines prove each verb is
#     gated at all") and lost it here. The fd form IS a real vector, but only
#     SPACE-SEPARATED (`eas 2>&1 update`) — which is the likelier vector of the
#     two, because unlike the glued spelling it is ordinary shell that nobody
#     writes with evasion in mind. Both gluings are now pinned in
#     test-guard-outward-cli.sh and generated as corpus axes.
#     CORRECTION: an earlier version of this entry described the gap as
#     specific to a `gh` NAMESPACE word before a multi-word verb. That was
#     written before the cross-family measurement and UNDERSTATED it — the
#     tool->verb position (`eas>/dev/null update`) is affected identically.
#     This is NOT finding A (a redirect closing the VERB's own boundary,
#     fixed) nor finding B (a redirect BEFORE the command, fixed): those are
#     BOUNDARY problems, where the verb is present next to an unaccepted
#     character. This is a SEPARATOR problem — two required-adjacent words
#     pushed apart by a token the pattern does not model — so no character
#     class widening reaches it. The ANCHOR does not cover it either:
#     _CMD_POS_PREFIX absorbs _CMD_REDIR only in the PREFIX run before the
#     command word. The vanished rendering deliberately does not reach it —
#     a redirect is not a provably-empty expansion and must never be deleted
#     as if it were. Closing it needs ONE interior absorber applied
#     uniformly, which the folded repair's Scope Contract does not
#     authorise. Tracked:
#     todos/archive/P0-2026-09-06-outward-cli-guard-interior-redirect-defeats-every-family.md
#     CORRECTED 2026-09-07 — that sentence read "The LIB does not cover it
#     either", which is true of the ANCHOR (`_CMD_POS_PREFIX`, as stated) and
#     FALSE of the lib: `_CMD_GIT_GLOBALS` (lib/cmd-detect.sh:151) has carried
#     `([[:space:]]*$_CMD_REDIR)` — an INTERIOR absorber, in the run between
#     `git` and its subcommand — since 2026-09-01, with `[[:space:]]*` rather
#     than `+` for exactly the glued-redirect reason. The claim mattered
#     practically, not just pedantically: it read as "nothing in this repo
#     models this position", when in fact the shape to generalise was already
#     written, tested and shipped one file away. `_OUT_SEP` is that shape
#     generalised, not a second redirect pattern invented alongside it.
#     Corpus rows `nssufx-ghmerge`/`nssufx-ghcomment` cover only two of the
#     ten families above — do not read the corpus gap count as this gap's size.
#
#   * OPEN (2026-09-07) — A REDIRECT ADJACENT TO A FLAG, in the ONE reader of
#     that shape which is GRANT-shaped. The other three readers were fixed in
#     this same PR (the `_OUT_FLAG_RUN` value sub-group, the `gh api` method
#     separator, and both clause bodies' `&` exclusion), because all three are
#     deny-shaped and widening them is monotone. `HAS_REAL_AUTO`'s awk scan is
#     not: it GRANTS the `--auto` carve-out, so a change there can convert a
#     DENY into an ALLOW, which is precisely how this PR introduced its own
#     CRITICAL. It needs paired over-granting controls and its own review round.
#
#     The scan splits on WHITESPACE and has no notion that `<`/`>` are token
#     boundaries in bash, so it is wrong in BOTH directions — it reads a
#     redirect TARGET as a real flag, and it fails to recognise a real flag
#     carrying a glued redirect. Seven positions measured live, all ALLOW on
#     `origin/main` and on this branch (so none is a regression):
#
#       gh pr merge 42 > --auto        argv: gh pr merge 42        (merges NOW)
#       gh pr merge 42 2> --auto       argv: gh pr merge 42
#       gh pr merge 42 >> --auto       argv: gh pr merge 42
#       > --auto gh pr merge 42        argv: gh pr merge 42        (via the
#                                      PREFIX absorber, a different code path)
#       gh pr merge 42 -b>x --auto     argv: gh pr merge 42 -b --auto
#       gh pr merge 42 --body-file>x --auto
#       gh pr merge 42 -t>x --auto     argv: gh pr merge 42 -t --auto
#
#     In the last three the `--auto` is REAL and reaches gh — but bash gives it
#     to `-b`/`-t`/`--body-file` as that flag's VALUE, so no auto-merge flag
#     survives and the PR merges immediately. `GH_MERGE_VALUE_FLAGS` exists to
#     catch exactly this and fails because `prev` reads `-b>x`, which does not
#     match `^-b$`. The glued `>--auto` (one awk field, not equal to `--auto`)
#     correctly denies and is the attribution control. Tracked, with the full
#     measured table:
#     todos/P0-2026-09-07-outward-cli-guard-space-separated-redirect-target-forges-auto.md
#
#   * NEVER LIVE, not a gap — recorded so it is not "fixed" into a
#     regression: `${#x}`-glued forms (`gh pr ${#x}merge`). `${#x}` always
#     yields a non-empty digit string, so that command runs `0merge`, which
#     is not an invocation at all. It is excluded from cmd_words_vanished's
#     allow-list precisely because INCLUDING it would MANUFACTURE a false
#     match — the 2026-09-02 regression that got an earlier deletion pass
#     reverted. Nothing is missed by excluding it.
#
#   * UNHANDLED (2026-09-06): a NESTED expansion (`${a:-${b}}`) fails
#     cmd_words_vanished's grammar test and is left verbatim. A safe MISS —
#     the brace bytes survive in the rendering, so no two halves of a split
#     verb can rejoin through it. Never a false match.
#
#   * UNHANDLED (2026-09-06): flag SYNTHESIS, as opposed to the flag-text
#     DONATION that C1 closed — a substitution supplies part or all of a flag
#     NAME. The 2026-09-03 narrow-deny rule targets VERBS, not flags, so this is
#     a residual that ruling creates rather than one it closes.
#
#     EXAMPLE CORRECTED 2026-09-06 (security RE-review). This entry used to
#     illustrate the class with `${x:-$(printf -- --repo)}`, which DENIES —
#     measured, both spellings: `gh pr merge 42 --auto ${x:-$(printf --
#     --admin)}` and the --repo equivalent both deny, because the flag is
#     spelled literally with a space before it and so satisfies _OUT_FLAG_LEAD.
#     A residual whose own example is caught is worse than no example: it tells
#     a reader the class is theoretical. The spellings that actually ESCAPE use
#     a NON-EMPTY substitution to COMPLETE a flag name, so the flag text exists
#     in no rendering:
#         gh pr merge 42 --auto --ad`printf min`              -> ALLOW
#         gh pr comment 5 --body hi --re`printf po` other/org -> ALLOW
#     Real argv is `--admin` (an administrator merge bypassing branch
#     protection) and `--repo other/org` (unbounded PAT egress) respectively —
#     the same effects C4 and C3 closed for the EMPTY-span spellings. Empty
#     spans vanish and rejoin, so cmd_words_vanished reconstructs the flag;
#     a non-empty body is DELETED by that same rendering, leaving `--ad`, and
#     WORDS_DEEP keeps the body's literal text but not the fused word. So the
#     flag appears in none of the FOUR renderings scan_renderings reads.
#     Pre-existing and not a regression (base ALLOWs identically). NOT fixed
#     here, and deliberately not patched: the one-line move (widening the merge
#     CLAUSE's `grep -qF '$'` to the `$`+backtick class its gh api sibling
#     already uses) does NOT work, because branch 1 of
#     _OUT_POS_SUFFIX_MERGE_CLAUSE excludes backtick from its continuation class
#     and truncates the clause to `gh pr merge 42 --auto --ad` before the mask
#     ever runs. A real fix is a narrow-deny decision about substitutions glued
#     into flag-shaped tokens inside a gated clause, with its own ruling.
#
#   * ACCEPTED OVER-DENIAL (2026-09-06, degraded paths only): the
#     degraded-path mirror in crude_smells_outward denies any command whose
#     segment names a gated binary AND contains a `$` or backtick, so
#     `npm run test -- $ARGS` DENIES on the no-jq/no-lib/no-awk paths while
#     the precise path allows it. Deliberate: those paths only run when jq,
#     awk, or the lib is already broken, their contract is to fail closed,
#     and they already deny quoted mentions and read-only forms the precise
#     path allows. Consistent with that posture, not a new class.
#
#     SCOPE CORRECTED 2026-09-06 (security review of PR #926): the sentence
#     above described the over-denial as reaching commands that INVOKE a gated
#     binary, and it is wider than that in two ways, both measured.
#       - READ-ONLY invocations of a gated binary: `gh pr view $NUM`,
#         `eas update:list --branch $BRANCH`, `gh api repos/o/r` with a split
#         verb and no method flag.
#       - Commands that invoke NO gated CLI AT ALL. The mirror's `gh` alternative
#         needs only a non-letter before it, which any path separator supplies,
#         so `sed -i "" "s/gh/$NEW/" docs/gh-actions.md` denies on the strength
#         of the `/gh` inside a FILENAME. This shape is the one the original
#         wording did not cover; it is the same fail-closed trade (the mirror is
#         deliberately neither quote- nor grammar-aware and cannot tell a
#         filename from a command word), but a reader must not have to discover
#         it from a denial.
#     All of these were verified DENY on both the pre-fix and fixed trees — the
#     span-deleting pass added for finding C1 widened NONE of them (measured
#     across both degraded paths on read-only and no-gated-CLI shapes; zero
#     decision flips).
#
#   * UNHANDLED, NEW (2026-09-06, degraded paths only): the span-deleting pass
#     `_out_crude_vanish` that the degraded mirror unions in is a character
#     scan with no quote- or depth-awareness, and it fails in TWO separate
#     ways. Both are stated here because an earlier revision collapsed them
#     into one sentence and the second is much the wider of the two.
#       (a) SPAN END MISJUDGED. It closes each span at the FIRST closer, so a
#           nested or quoted closer ends it early and the deletion is WRONG,
#           not merely absent:
#             e$(: $(:))as update --branch preview   -> ALLOW on all 3 degraded
#           Blast radius: that one span.
#       (b) SCAN ABANDONED AT AN UNTERMINATED OPENER. An opener with no closer
#           after it stops the loop and appends the whole remainder verbatim,
#           so EVERY later span goes undeleted. No real substitution is needed
#           to trigger it — an INERT opener inside quotes is enough, because
#           the scan cannot see quotes:
#             : '$(' ; e${UNSET}as update --branch preview
#                                                    -> ALLOW on all 3 degraded
#           while the same command without the leading `: '$('` DENIES on all
#           four. Blast radius: everything after the first unterminated opener.
#           Also reachable with no quoting at all if a JSON envelope field
#           ordered before `command` contains a lone `$(`.
#     Precise path is unaffected in both — it uses the lib's stateful scanner.
#     NOT FIXED, deliberately: teaching this loop to skip an unterminated
#     opener would be a FOURTH attempt to decide span boundaries from raw text
#     at a point where the stateful scanner is unavailable, and the first three
#     each shipped and were each defeated by a construction the enumeration had
#     not anticipated. See the comment above `_out_crude_vanish`.
#
#   * ACCEPTED OVER-DENIAL, NEW (2026-09-06, precise path): a `gh api` clause
#     that is readable ONLY after deleting an expansion, WITH a method flag
#     present, denies even when the method value itself is literal and
#     read-only. Measured: `${X} gh api repos/o/r -X GET` denies (it allowed
#     before), because a leading `${X}` leaves the deep cut empty — `}` is not a
#     command-position opener — so the clause survives only in the vanished
#     rendering, and a clause reconstructed by deletion cannot be verified.
#     This is the mechanism that closes finding C2 and it is not narrowable
#     without re-deriving the method value's own token boundary a second time,
#     which the C2 block below explicitly refuses (a boundary bug in that second
#     derivation would silently reopen the gap). It is the SAME accepted trade
#     that block already documents for `gh api repos/o/r -X GET -f note=$SOME`
#     — an unrelated sigil elsewhere in the clause — just reached by deletion
#     instead of by a surviving character. Bounded by the method-flag gate: a
#     read with no `-X`/`--method` is untouched (`${X} gh api repos/o/r` and
#     `${X} gh api repos/o/r --jq .name` both still ALLOW, pinned).
#
#   * UNHANDLED, DEGRADED PATHS ONLY (2026-09-06, round 3): a NESTED or
#     QUOTED-CLOSER span defeats crude_smells_outward's span-deleting rendering,
#     so on no-jq / no-lib / no-awk these are ALLOWED:
#         e$(: $(:))as update --branch preview          (an OTA publish)
#         g$(: "x)y")h pr merge 42
#         e$(: '"' "a)b" )as update --branch preview
#     The PRECISE path denies all of them. This is disclosed rather than fixed
#     because the previous round's fix for it — a GREEDY rendering deleting from
#     the first opener to the LAST closer — was itself unsound: greedy was the
#     ONLY rendering reconstructing the needle, so its over-deletion WAS the
#     miss, and any `)` after the verb (`&& (echo done)`) defeated it. A union
#     cannot restore what no rendering holds. Ending a span correctly needs the
#     depth- and quote-stateful scanner in lib/cmd-detect.sh, which these paths
#     exist precisely because they cannot reach. Corpus rows toolvnest-*,
#     toolvdqclose-*, toolvsqclose-*, toolvmixq-* keep this reporting every run.
#
#   * PARTLY CLOSED 2026-09-06/07 — READ THIS BEFORE TRUSTING THE HALF THAT IS
#     STILL OPEN. This entry originally read "UNHANDLED, ALL PATHS" for BOTH a
#     bare `(` subshell and a `case` arm's `)` inside `$(...)`, on the measurement
#     that `cmd_words_vanished 'e$( (:) )as update'` renders `e )as update`.
#
#     THE BARE-PAREN HALF IS CLOSED. That measurement is `main`'s output; the
#     scanner now carries a per-level paren counter and renders `eas update`, so
#     `e$( (echo) )as update --branch preview` DENIES here (it ALLOWs on `main`).
#     The CLOSED entry ~90 lines below is the authority; this text contradicted it
#     for one review round, which is exactly the comment-drift class this file's
#     own header names as its dominant defect. Corpus rows toolvbareparen-* now
#     report `ok`.
#
#     THE `case`-ARM HALF IS STILL OPEN and unchanged:
#         e$(case x in a) : ;; esac)as update --branch preview   -> ALLOW
#     That `)` has no matching opener, so no depth arithmetic reaches it. Corpus
#     rows toolvcasearm-*/verbvcasearm-*/flagvcasearm-* stay GAPs by design. Filed:
#     todos/P2-2026-09-06-cmd-detect-case-arm-paren-closes-substitution-early.md
#     The bare-paren todo is archived at
#     todos/archive/P0-2026-09-06-cmd-detect-bare-paren-subshell-breaks-substitution-scanners.md
#
#   * SIDE EFFECT OF DECLINING, and it is a CORRECTNESS GAIN, not just a cost
#     (2026-09-06, round 3): the 2026-09-03 narrow-deny rule denies an expansion
#     in COMMAND POSITION followed by a gated verb (`${TOOL} run build`,
#     `${PKG} publish`) — real bash executes the expansion's OUTPUT as the
#     command, so it cannot be verified read-only. The fast path was silently
#     exempting that whole class: with no gated needle in the raw text it took
#     the cheap exit and the rule never ran. Declining lets the rule apply as it
#     was ruled. Measured on 4,525 historical span-carrying commands: exactly ONE
#     decision flip, allow -> deny, and it is this shape. NOT REPRODUCIBLE FROM
#     THIS REPO — the population was harvested from local Claude Code transcript
#     .jsonl files, which are not tracked here, so treat the 4,525 denominator
#     and the "exactly one" uniqueness as a dated one-off measurement rather than
#     a standing invariant. To redo it: extract every Bash `command` field from
#     the transcripts, keep those containing `${`, `$(` or a backtick, and run
#     each through the old and new hook, diffing the decisions. What IS pinned in
#     this repo, and re-checkable, is the SHAPE of the flip and its bounds —
#     test-guard-outward-cli.sh asserts all six rows below. Correctly narrow —
#     `echo ${TOOL} run build` and `foo ${TOOL} run build` (not command position)
#     and `${TOOL} test` / `${TOOL} lint` (not gated verbs) all still ALLOW.
#
#   * UNHANDLED, PRE-EXISTING AND UNCHANGED (recorded 2026-09-06 while measuring
#     the above): a BARE `$name` in command position escapes the same rule —
#     `$RUNNER up` ALLOWS, before and after. The stage-3 decline keys on the
#     three digraphs `${`, `$(` and a backtick, and a bare `$name` has none of
#     them, so it still takes the cheap exit.
#
#     CORRECTION, 2026-09-06 round 4. An earlier revision of this entry (and the
#     commit message that introduced it) justified not widening by asserting that
#     a bare `$name` is "a shape that cannot split a token mid-word anyway —
#     it greedily consumes following alphanumerics, so it cannot rejoin two
#     halves of a verb". THAT IS FALSE, and it is false for the whole family of
#     SPECIAL parameters, which are one character long and therefore terminate
#     against a following letter instead of absorbing it: `$!`, `$@`, `$*`, `$?`,
#     `$$`, `$#` and `$1`..`$9`. Each can expand to empty, so each rejoins the
#     halves exactly the way `${UNSET}` does. The greedy-absorption argument
#     holds only for an ORDINARY identifier (`$RUNNER`), and I generalised it to
#     a syntax class it does not cover. Measured, this hook, round 4:
#
#       eas up$!date --branch preview   precise=ALLOW  nojq/nolib/noawk=DENY
#       gh pr me$!rge 42                precise=ALLOW  nojq/nolib/noawk=DENY
#       npm pub$1lish                   precise=ALLOW  nojq/nolib/noawk=DENY
#       e$!as update --branch preview   ALLOW on ALL FOUR paths
#       e$1as update --branch preview   ALLOW on ALL FOUR paths
#       g$1h pr merge 42                ALLOW on ALL FOUR paths
#
#     Controls: `eas up${UNSET}date` and `eas up$'d'ate` DENY on precise, and
#     `e${UNSET}as update` / `e$'a's update` DENY on all four — so the mechanism
#     is the SPELLING of the vanishing expansion, not the position.
#
#     Two things in that table are worth stating outright rather than leaving to
#     be inferred. First, the VERB rows INVERT this file's usual asymmetry: the
#     PRECISE path is WEAKER than the three degraded ones, because the degraded
#     mirror keys on a gated binary near a `$` sigil and the precise path has no
#     equivalent — every previous finding in this chain went the other way, so
#     "degraded is the fail-closed direction" is not a safe default here. Second,
#     the TOOL rows allow on all four, which is a live outward-CLI bypass.
#
#     CLOSED 2026-09-06 (todos/archive/P0-2026-09-06-cmd-detect-bare-paren-subshell-
#     breaks-substitution-scanners.md). Every construction in the table above now
#     DENIES on the precise path, each attributed to the intended
#     command-position check rather than to an ambiguity fallback.
#
#     THE FIX WAS IN TWO PLACES AND THE PREVIOUS REVISION OF THIS ENTRY NAMED
#     ONLY ONE. It said "the fix is in lib/cmd-detect.sh's allow-list". That was
#     necessary and NOT sufficient, and the missing half was in this very file:
#     the STAGE 3 decline keyed on `${`, `$(` and a backtick, none of which a
#     special parameter or an ANSI-C respelling carries, so
#     `e$1as update --branch preview` missed stages 1 and 2 and took the CHEAP
#     EXIT — $WORDS_VANISHED was never computed, and no allow-list change could
#     have been reached. A correct fix in the right file is still unreachable
#     when a prefilter upstream of it declines on a NARROWER signal than the
#     fix's own grammar. Both halves landed in one change:
#       * lib/cmd-detect.sh — cmd_words_vanished now deletes `$!`, `$@`, `$*` and
#         `$1`..`$9` (each PROVABLY capable of expanding to empty) and DECODES
#         ANSI-C escapes. `$?`, `$$`, `$#`, `$0` and `$-` are deliberately NEVER
#         deleted: none can be empty, and deleting a never-empty form
#         manufactures a clean match for text that never executes.
#       * this file — the STAGE 3 decline set was widened, on a MEASURED cost of
#         +0.8% of Bash tool calls moving to the slow path (the block itself
#         carries the harvest and the numbers).
#
#     A bare `$name` (`$RUNNER up`) remains an ACCEPTED residual and still takes
#     the cheap exit. The greedy-absorption argument that was wrongly
#     generalised to the whole syntax class is TRUE of an ordinary identifier:
#     `$RUNNERup` is one variable name, so it cannot rejoin two halves of a verb.
#
#   * BARE-PAREN SUBSHELL — CLOSED 2026-09-06, same change. lib/cmd-detect.sh's
#     shared substitution scanner counted depth for `$(` but not for a bare `(`,
#     so the first `)` of an inner subshell closed the OUTER construct early:
#     `e$( (:) )as update --branch preview` rendered as `e )as update …`, the
#     verb never re-formed, and all four paths ALLOWED an OTA publish. Both
#     functions sharing that scanner shape — cmd_extract_substitutions and
#     cmd_words_vanished — now carry a per-level paren counter, fixed in ONE
#     change rather than one function at a time.
#
#     ARITHMETIC EXPANSION had to be exempted in the same edit, and that is a
#     consequence of the counter rather than a separate concern: with paren depth
#     tracked, `$((expr))` otherwise reads as a substitution level whose body
#     happens to balance, and would be DELETED — but it always evaluates to a
#     number, so deleting it manufactures `foo` from `f$((1+2))oo`, whose real
#     argv is `f3oo`. It is copied verbatim instead, exactly like `${#x}`.
#
#   * A `case` ARM'S `)` IS THE SAME SYMPTOM AND IS STILL OPEN.
#     `e$(case x in a) : ;; esac)as update --branch preview` ALLOWS on all four.
#     A paren counter cannot reach it: that `)` has no matching opener, so no
#     depth arithmetic can distinguish it from the construct's real closer.
#     Deliberately NOT fixed by tracking the `case`/`esac` keywords — a naive
#     tracker is a deny→ALLOW regression generator, because `e$(echo case)as
#     update` DENIES today and would leave the depth permanently open, emptying
#     the rendering and silently losing that coverage. Tracked at
#     todos/P2-2026-09-06-cmd-detect-case-arm-paren-closes-substitution-early.md
#     and measured every run by this repo's corpus (`toolvcasearm-*`).
#
#   * UNHANDLED, PRE-EXISTING (round 4, same measurement session): BRACE RANGE
#     expansion splits a token with NO `$` and NO backtick anywhere in the
#     command, so no sigil-keyed decline can ever see it —
#     `{e..e}as update --branch preview`, `eas up{d..d}ate --branch preview` and
#     `gh pr me{r..r}ge 42` all ALLOW on ALL FOUR paths. The control
#     `gh pr merge{1..3} 42` DENIES, because there the verb is intact and the
#     brace only follows it. This is why enumerating `$`-spellings at the fast
#     path can never be complete: it is not a missing spelling, it is a second
#     expansion mechanism. Closing it needs a narrow deny on a brace RANGE that
#     shares a token with a gated binary or verb — NOT another deleting
#     rendering, which would re-open the span-end problem round 3 closed.
#
#   * ACCEPTED COST, not a gap (2026-09-06, round 3): the fast path DECLINES its
#     cheap exit for any command containing `${`, `$(` or a backtick, so those
#     run the full guard. Measured ~16 ms -> ~105-125 ms per call; span-carrying
#     commands are ~16% of this project's harvested history, so roughly +16 ms on
#     the average Bash tool call. Commands with no span are unaffected. Three
#     attempts to decide reliability cheaply here each shipped a live bypass —
#     see the STAGE 3 block for the sequence. Revisiting the cost is an owner's
#     decision; the sound direction is to make the lib's real scanner reachable
#     from the fast path, not to re-derive its grammar in `case` patterns.
#
#   * ATTRIBUTION RESIDUAL (2026-09-06): `gh pr merge 42 --auto --ad${UNSET}min`
#     DENIES — the decision is correct — but for "without a REAL --auto flag",
#     not for `--admin`. Any literal `$` in the merge CLAUSE trips that check
#     first, so the `--admin` check never runs for that spelling. The backtick
#     spelling (no `$`) does reach it and reports the `--admin` reason. Fixing
#     the attribution means reordering this file's most heavily pinned branch,
#     which is its own decision with its own mutation evidence — deliberately
#     NOT bundled into the C4 fix. A DENY is not evidence the intended check
#     fired; that is exactly why this is written down rather than left to be
#     rediscovered by someone reading a green corpus row.
#
# Escape: `ALLOW_OUTWARD_CLI=1 <command>` as an INLINE prefix on the one Bash
# command (recognized from the command string itself — see the case
# statement below the CMD extraction for why this differs from an exported
# env var), OR export `ALLOW_OUTWARD_CLI=1` ambiently for the rest of the
# session (broader-scoped; prefer the inline form).
# Tests: .claude/hooks/test-guard-outward-cli.sh
set -uo pipefail

[ -n "${ALLOW_OUTWARD_CLI:-}" ] && exit 0

# COMMAND-POSITION ANCHORS: defined AFTER lib/cmd-detect.sh is sourced (below),
# because _OUT_POS_PREFIX interpolates the lib's $_CMD_REDIR. Defining them here
# would reference an UNSET variable under this file's `set -u`, which is a hard
# error, not an empty expansion: the hook aborts with empty stdout and a dirtied
# stderr, and the suite goes 53/495. (Corrected 2026-09-07 — this used to read
# "the empty string — no error, suite green", inherited prose that had never been
# run. The bypass-open conclusion survives; the silent mechanism does not.)
# See the definitions further down.

# Leading boundary for the three DENY-ONLY flag checks (this file's --repo/-R,
# --auto-submit, and --admin scans). Two alternatives:
#   1. `^` or a character that is not part of a flag token — the original class.
#   2. A default-value parameter expansion's operator. Bash's `:-` and bare `-`
#      each consume exactly one literal `-` from the source text and leave the
#      REST of the word as the expansion, so `${x:---repo}` places a literal
#      `-` immediately before a real, functioning two-dash `--repo` — argv
#      genuinely carries the flag, but the original class (which rejects a
#      preceding dash) never matches it (finding C1,
#      outward-CLI-guard-folded-repair, 2026-09-05).
# Alternative 2 covers every bash `${PARAM:-...}`/`${PARAM-...}` PARAM shape
# that (a) is valid syntax immediately before `:-`/bare `-` and (b) can
# plausibly expand via that operator (i.e. PARAM can be unset or null),
# enumerated by grammar, not by the handful of examples an earlier revision
# happened to try — a per-example patch leaves whatever spelling wasn't
# tried:
#   - a NAME (`${x:-`), same as always.
#   - a positional parameter, one or more digits, single- or multi-digit
#     (`${1:-`, `${10:-`) — real bash, verified: unset positional params
#     default exactly like an unset NAME.
#   - indirect expansion, `!` followed by a NAME or a digit sequence
#     (`${!v:-`, `${!1:-`) — verified live: `${!1:-word}` really does fire
#     when $1 is unset, not just `${!v:-word}` for a NAME target.
#   - an array element or the array-KEYS-listing form, either bare or
#     bang-prefixed, with any bracket contents (`${a[0]:-`, `${a[@]:-`,
#     `${!a[@]:-`) — the bracket contents are never inspected; anything
#     without a literal `]` closes it.
#   - the "all positional parameters" specials, `@` and `*` (`${@:-`,
#     `${*:-`) — verified live: these DO default via `:-`/bare `-` when
#     there are zero positional parameters, exactly like a NAME.
#   - bare `!` alone (`${!:-`) — the last-background-PID special parameter,
#     commonly unset (nothing has ever been backgrounded) — DISTINCT from
#     indirect expansion, which needs a NAME/digit after the `!`.
# Deliberately excluded, each verified rather than assumed:
#   - `${?:-`, `${#:-`, `${$:-`, `${-:-` — $?, $#, $$, and $- are each
#     ALWAYS set to a non-empty string (verified: `0`, `0`, a PID, and a
#     flag string respectively, live), so `:-`/bare `-` never fires; none is
#     attacker-controlled either.
#   - `${#x:-` (the LENGTH operator) — not valid bash syntax at all when
#     combined with `:-`/bare `-` (verified: "bad substitution"), so it
#     cannot be swept in regardless of what this alternative matches.
#   - `${!prefix*}`/`${!prefix@}` (the variable-NAME-matching forms) — also
#     not valid bash syntax combined with `:-`/bare `-` (verified: "bad
#     substitution"); excluded structurally, not by omission.
#   - `:+` and `:=` are NOT covered by this alternative at all: `+`/`=`
#     already satisfy alternative 1, so a default-value OR assign-default
#     expansion using either operator already denies today, on every PARAM
#     shape, without needing a PARAM-aware alternative here.
# SAFE ONLY BECAUSE ALL THREE CONSUMERS ARE DENY-SHAPED — an added alternative
# here can only ever ADD a deny, never grant a carve-out. Verified by reading
# the call sites, not assumed: `scan_renderings`'s own precondition comment restricts
# it to deny-shaped callers, and `gh_pr_clause_has_repo`'s own comment states
# "`--repo`/`-R` only ever ADDS a deny, it never grants a carve-out" — its two
# callers both call `deny()` on a true result and do nothing on false.
# Anchoring the flag match immediately after the consumed operator also keeps
# this precise, not just wider, for every PARAM shape uniformly (not per-form
# special-casing): none of them can consume more than the operator's single
# mandatory `-`, so `${x:----admin}`, `${1:----admin}`, `${!v:----admin}`,
# `${a[0]:----admin}`, `${@:----admin}`, and `${!:----admin}` all leave a
# leftover bare dash before the flag text, which the class still rejects —
# verified live for each, not just the plain-NAME case.
_OUT_FLAG_LEAD='(^|[^-A-Za-z0-9]|\$\{(!([A-Za-z_][A-Za-z0-9_]*|[0-9]+)(\[[^]]*\])?|!|[A-Za-z_][A-Za-z0-9_]*(\[[^]]*\])?|[0-9]+|[@*]):?-)'

# `--repo`/`-R` in any spelling gh's flag parser accepts (`--repo v`,
# `--repo=v`, `"--repo" v`, `-R v`, `-Rv`). Case-SENSITIVE on purpose — see
# the header. Boundary class is "not a word/dash character" (plus the
# default-value-expansion alternative in `_OUT_FLAG_LEAD`) rather than
# strictly whitespace, exactly like the `--admin` check below, so a QUOTED
# flag name is still seen; `--repo`'s trailing boundary keeps a hypothetical
# `--repository` from matching, while `-R` deliberately has none so the glued
# `-Rowner/repo` form is caught.
_OUT_REPO_FLAG_RE="${_OUT_FLAG_LEAD}"'(--repo([^-A-Za-z0-9]|$)|-R)'

# gh_pr_clause_has_repo <subcommand-alternation> → exit 0 if the first
# `gh pr <sub>` clause in ANY of the three renderings (deep, vanished, blind) carries
# --repo/-R. (Said "$WORDS_DEEP" only until 2026-09-06; the fix for finding C3
# rewrote every comment INSIDE the function and left this summary one paragraph
# above it untouched — the exact comment-drift class this file's whole defect
# history is made of, caught in the same review round. See the function body.)
#
# CLAUSE-SCOPED, unlike the `--admin` check below: `--admin` survives a whole-command
# scan because it is a rare token, but `-R` is `cp -R`, `grep -R`, `ls -R`,
# `rsync -R`. A whole-$CMD scan denied `cp -R src dst && gh pr create --title
# x --body y` — i.e. this repo's own PR-creation pipeline (caught in review
# before it shipped). lib/cmd-detect.sh:242, the precedent this check follows,
# is likewise clause-scoped: it applies the identical regex to `$full_match`,
# never to the whole command.
# The caller has already established from $WORDS that a COMMAND-POSITION
# `gh pr <sub>` exists AND that there is EXACTLY ONE such occurrence — every
# call site denies outright on >1 occurrence before ever reaching this
# function (see GH_PR_MERGE_OCCURRENCES above and GH_PR_CREATE_OCCURRENCES
# below), so `head -1` here only ever sees the single real clause, never
# chooses among several. This was NOT always true for create/comment: an
# earlier revision counted occurrences for merge/api only, leaving `head -1`
# free to silently inspect a benign FIRST create/comment clause while a
# malicious `--repo` clause sat unexamined in a second one — unbounded PAT
# egress (review round 4, 2026-08-17).
# Cuts from $WORDS_DEEP (not raw $CMD) so the clause is found for the SAME
# spellings the caller's occurrence count matches, INCLUDING one hidden inside
# a live command substitution. Left on raw $CMD it silently returned an empty
# clause — and therefore ALLOWED — for `gh pr "create" --repo other/org`,
# unbounded PAT egress to an arbitrary repo (review, 2026-08-16). $WORDS_DEEP
# loses nothing this check needs: quote characters are already deleted, so a
# quoted `"--repo"` or `-R "other/org"` is still visible, while a MENTION
# inside a span collapses to one token (`--title usex--repoxcarefully`) whose
# `--repo` no longer sits at a token boundary and so cannot false-match. Deep,
# not shallow, is SAFE here (unlike the `gh pr merge --auto` CLAUSE below):
# `--repo`/`-R` only ever ADDS a deny, it never grants a carve-out.
gh_pr_clause_has_repo() {
  # CLAUSE BODY ADMITS AN fd-DUPLICATING `&` (2026-09-07). Same defect, same fix
  # and same justification as _GH_API_CUT below: `[^;&|]` excluded `&` to stop the
  # clause running past a command separator, but `2>&1`'s `&` is part of a
  # REDIRECT, so the clause truncated mid-token and the --repo flag was never
  # reached. Found by extending the gh api fix's own row set to this function
  # rather than assuming the two cuts differed. PRE-EXISTING on main:
  #
  #   gh pr comment 5 --body hi 2>&1 --repo other/org   -> ALLOWED on main
  #   gh pr create --title t 2>&1 --repo o/r            -> ALLOWED on main
  #
  # Both build a real cross-repo argv (argv-stub confirmed) -- PAT egress to an
  # arbitrary repository, the same class as this function's original CRITICAL.
  # `gh pr merge` masked the defect: it denies anyway when no --auto is present,
  # so only comment/create expose it.
  #
  # WHICH `&`s ARE ADMITTED, and the honest version of why. The admitted set is
  # the `&`-bearing REDIRECT operators: `&[0-9-]`, `&[<>]` and `[<>]&`. A bare
  # `&` stays excluded, so `&&` and a backgrounding `& ` still end the clause.
  #
  # An earlier revision justified this as "bash takes an fd only when a digit or
  # `-` follows, so a flag belonging to the NEXT command cannot be pulled in".
  # BOTH HALVES WERE WRONG, and security review constructed each:
  #   * the redirect-both operator is a redirect whose `&` is followed by
  #     neither a digit nor `-` -- which is how that spelling stayed ALLOWED
  #     after the first fix while its fd-duplicating twin denied.
  #   * a backgrounding `&` DOES pull the next command in when that command's
  #     NAME starts with a digit: bash backgrounds, the digit is the next
  #     command name, and its arguments follow. It over-DENIES.
  # So the true invariant is narrower: a following command can be absorbed only
  # when its name begins with a digit, `-`, `<` or `>`. That is an over-denial,
  # never a bypass, and this check is deny-shaped -- but the reason is recorded
  # accurately now, because on this file the next editor builds on the stated
  # invariant, not on the measurement.
  #
  # Monotone -- both call sites deny on true, so a longer clause can only ADD a
  # deny.
  #
  # (`local clause` was dropped here at the same time: the multi-clause rewrite
  # moved to `clauses`, declared at its own use site, and left the singular name
  # declared but unread -- a name a future assignment could silently reuse.)
  local rendering re="gh${_OUT_SEP}pr${_OUT_SEP}($1)([^;&|]|&[0-9-]|&[<>]|[<>]&|&?[<>]+&?[|!])*"
  # ADDED 2026-09-05 (vanishing sigil): both occurrence counters that gate this
  # function now read a per-rendering MAXIMUM, so the count can be 1 because
  # the VANISHED rendering saw a NAMESPACE-glued sigil (`gh pr${UNSET} comment`)
  # that WORDS_DEEP cannot see. In exactly that case this cut returns empty and
  # the --repo egress goes unexamined — the merge family closed while the
  # create/comment family stayed open, which is the selectively-applied-guard
  # defect in
  # docs/solutions/logic-errors/occurrence-ambiguity-guard-applied-selectively-not-uniformly-2026-08-17.md.
  # Detector and consumer move together. Each call site deny()s on a true result
  # with no carve-out branch, so an extra clause can only ever ADD a deny —
  # re-verified at BOTH call sites, not taken from this function's own comment.
  #
  # FIXED 2026-09-06 (security review of PR #926, finding C3). This was written
  # as "deep, ELSE vanished", gated `if [ -z "$clause" ]`. That gate made the
  # vanished rendering reachable ONLY when the deep cut came back empty — i.e.
  # only when the VERB was split. With a literal verb and a split FLAG the deep
  # cut is non-empty, so the fallback never ran, even though $WORDS_VANISHED for
  # that input is exactly `gh pr comment 5 --body hi --repo other/org`. MEASURED
  # ALLOW before this fix: `gh pr comment 5 --body hi --re${UNSET}po other/org`,
  # and the same shape on `gh pr create` — unbounded PAT egress to an arbitrary
  # repository, the precise bug this function exists to stop. The guard computed
  # the answer and then discarded it.
  #
  # THE RULE, and the one idea behind three of that review's four findings: a
  # SUBTRACTIVE rendering must be UNIONED IN, never SUBSTITUTED FOR, the deep
  # one. `if [ -z "$deep" ]; then use_vanished; fi` is substitution wearing a
  # fallback's clothes. cmd_words_deep APPENDS, so "a wider rendering can only
  # ADD a deny" is sound for it; cmd_words_vanished DELETES, and deletion
  # DISARMS any check whose trigger is a token's PRESENCE (`--repo` here, and
  # `--admin` / a literal HTTP method at the other two sites). Evaluate the
  # WHOLE predicate against EACH rendering and OR the results — never pick one.
  #
  # THE UNION EXTENDS TO CLAUSES, NOT JUST RENDERINGS — fixed 2026-09-07
  # (security review of the interior-redirect change). The previous line was
  # `grep -oiE "$re" | head -1`, defended by this claim:
  #
  #     "Per-rendering `head -1` stays correct: both call sites gate on an
  #      occurrence count that is already a per-rendering MAXIMUM, so reaching
  #      here means each rendering holds at most one clause."
  #
  # THAT CLAIM WAS FALSE, and the reason is a one-word difference nobody read:
  # the occurrence counters run the ANCHORED `GH_PR_MERGE_RE`/`GH_PR_CREATE_RE`
  # (both carry `${_OUT_POS_PREFIX}`), while `$re` here is the file's ONLY cut
  # with NO anchor at all. "Exactly one COMMAND-POSITION occurrence" and
  # "exactly one extractable clause" were therefore never the same quantity, and
  # a mention that is not in command position adds a clause the counter cannot
  # see. `head -1` then examines the DECOY and the real clause goes unexamined.
  #
  # MEASURED, this branch, before the fix — real argv taken from PATH-shadowed
  # argv-printing stubs, so these genuinely execute:
  #     echo gh >x pr merge && gh pr merge 42 --auto --repo o/r      -> ALLOW
  #     echo gh >x pr comment && gh pr comment 5 --body hi --repo o/r -> ALLOW
  #     echo gh >x pr create && gh pr create --title t --repo o/r     -> ALLOW
  # Each is unbounded PAT egress to an ARBITRARY repository — precisely what
  # this function exists to stop. The decoy needs no redirect to work at all
  # (`echo gh pr create && gh pr create --title t --repo o/r` allows on `main`
  # too, so the root cause PREDATES the absorber); widening `_OUT_SEP` merely
  # enlarged the set of decoy spellings from plain-spaced to every redirect
  # form, which is what turned specific `main` DENYs into ALLOWs.
  #
  # WHY THIS FILE'S OWN DEFENCES MISSED IT. The loop below already unions over
  # RENDERINGS, and that rule ("UNION, never SUBSTITUTE") was satisfied — every
  # rendering independently picked the same wrong clause, so no amount of
  # rendering-level unioning could help. The leftmost-selection defect lives
  # INSIDE a rendering. A union has to cover every axis on which the check can
  # pick one candidate out of several, and "which clause" was an axis nobody had
  # named.
  #
  # Scanning EVERY clause is monotone in the safe direction: this function's
  # result is consumed by two call sites that deny() on true with no carve-out
  # branch, so examining more text can only ever ADD a deny. That is the same
  # argument the vanished-rendering union rests on, applied one axis over.
  #
  # CAPTURE FIRST, THEN TEST — not `grep -oiE … | grep -Eq …`. This file runs
  # under `set -uo pipefail`, and an early-exiting reader makes the pipeline
  # report failure when `grep -q` stops at its first match and the writer takes
  # SIGPIPE (docs/rules/harness.md). Written as a pipeline this check would fail
  # OPEN on exactly the inputs it is supposed to catch.
  local clauses
  for rendering in "$WORDS_DEEP" "$WORDS_VANISHED" "$WORDS_VANISHED_BLIND"; do
    clauses=$(printf '%s' "$rendering" | grep -oiE "$re")
    [ -n "$clauses" ] || continue
    # grep is line-oriented and `grep -o` puts each clause on its own line, so a
    # `--repo` cannot be forged across the seam between two clauses.
    grep -Eq "$_OUT_REPO_FLAG_RE" <<< "$clauses" && return 0
  done
  return 1
}

# Crude, non-quote-aware smell test shared by ALL THREE fail-closed fallback
# paths below (no-jq; jq-envelope-unparseable; jq-present-but-lib-unsourceable
# or cmd_bare-broken). Kept in sync with the precise per-predicate patterns
# further down MANUALLY — every verb added to one list must be added to the
# other, or the fallback path is weaker than the precise path. $1 is raw,
# unblanked text (either the whole JSON envelope or an already-extracted
# command string — both are fine, this only greps for substrings).
#
# NEWLINE NORMALIZATION (review round 3): a shell line-continuation split the
# verb from its subcommand and defeated BOTH degraded paths for EVERY verb
# family. Two distinct mechanisms: the no-jq path scans the RAW, still-encoded
# JSON where a newline is the two-character escape `\n` — the literal byte `n`
# is a letter, so it breaks the `[^a-zA-Z]+` separator class; the other paths
# scan a DECODED string containing a real 0x0A, and grep is line-oriented, so
# the two tokens never share a line. Normalize both representations to a space
# BEFORE matching. Pure parameter expansion, NOT `tr`/`sed`: the no-jq path
# runs in an environment where those may be absent (its own test fixture links
# only bash/cat/grep), and depending on a tool that can be missing is precisely
# the bug C4 below fixes. Order matters — `\\n` (the raw envelope's escaped
# backslash + escaped newline) has `\n` as its tail, so the single `\n`
# substitution handles both spellings.
# Span-deleting rendering for the DEGRADED paths — the fail-closed mirror of
# lib/cmd-detect.sh:cmd_words_vanished, which those paths cannot reach (two of
# the three run precisely BECAUSE the lib or awk is unavailable). Sets the
# global $_OUT_CRUDE_VANISHED; bash 3.2 has no nameref and a command
# substitution would fork, so a global is the calling convention.
#
# ONE CALLER, AND THAT IS LOAD-BEARING: crude_smells_outward, which UNIONS this
# rendering with the untouched original. Every safety claim below depends on
# that union, so it is stated as a property of the caller and not of this
# function. (2026-09-06: a second caller was added in the fast path, inherited
# this function's safety sentences, and the sentences were false for it. The
# second caller has been removed. If you add one, re-derive every claim here
# against ITS contract — that inheritance is the exact defect that produced
# three rounds of CRITICALs on this file.)
#
# PURE PARAMETER EXPANSION, deliberately: no awk, no sed, no tr. The no-jq
# path's own test fixture links only bash/cat/grep, and depending on a tool
# that can be absent is precisely the failure class these fallbacks exist for
# (the same reason the newline normalization above is `${t//...}` and not `tr`).
#
# CRUDE, AND KNOWN-INCOMPLETE. It ends a span at the FIRST closer character. That
# is wrong whenever a closer sits INSIDE the span, and the output is then not a
# wider deletion but a WRONG one — a strict prefix removed, its tail left wedged
# between the two halves that were supposed to rejoin:
#
#   in    : e$(: $(:))as update --branch preview
#   crude : e)as update --branch preview      <- stray `)`, no `eas` needle
#   awk   : eas update --branch preview       <- cmd_words_vanished, correct
#
# THREE REVIEW ROUNDS ESTABLISHED THAT THIS CANNOT BE PATCHED HERE, and the
# history is recorded because the next reader's first instinct will be to try
# again. Three successive attempts to decide reliability from the text —
# "superset deletion", then "any quote is ambiguous", then "an ODD quote count
# is ambiguous" — each looked sound, each shipped, and each was defeated by a
# construction the enumeration had not anticipated: a nested `$( )`, then a
# quote of one type nested inside the other (`e$(: '"' "a)b" )as update`, whose
# quote counts are both EVEN while the closer is genuinely inside quotes), then
# constructs carrying NO sigil digraph at all — a bare `(` subshell
# (`e$( (echo) )as update`) and a `case` arm's `)`
# (`e$(case x in a) : ;; esac)as update`). Every one of those was a live ALLOW
# of a real OTA publish. The pattern is not bad luck: deciding where a span ends
# requires the depth- and quote-stateful scanner in lib/cmd-detect.sh, and this
# function runs where that lib is by definition unavailable.
#
# So this function makes NO reliability claim, and no caller may infer one. Its
# output is a HINT that is unioned in, never a rendering anything is decided
# from. The fast path does not consult it at all — see the STAGE 3 block, which
# declines outright rather than trusting any answer from here.
#
# WHAT THIS COSTS, stated rather than hidden. TWO DISTINCT residuals, not one —
# they were collapsed into a single sentence until round 4 and they have
# different mechanisms and different blast radii:
#
#   (a) SPAN-END MISJUDGED. A nested or quoted-closer span ends at the wrong
#       `)`, so the deletion is wrong rather than merely absent:
#       `e$(: $(:))as update --branch preview` is ALLOWED on the three degraded
#       paths. Scope: the one malformed span.
#
#   (b) SCAN ABANDONED. An opener with NO closer anywhere after it hits the
#       `*) s="$rest"; break` arm, which appends the entire remainder verbatim
#       and stops looking. Every later span — however well-formed — goes
#       undeleted. This scan is character-based and has no quote awareness, so
#       an INERT opener inside quotes is enough to trigger it:
#
#         in : `: '$(' ; e${UNSET}as update --branch preview`
#         out: `: '' ; e${UNSET}as update --branch preview`   <- ${UNSET} intact
#
#       so `eas` never forms and the command ALLOWS on all three degraded paths,
#       while the same command without the leading `: '$('` DENIES on all four.
#       Scope: the whole rest of the command, which is why it is worth naming
#       separately — (a) loses one span, (b) loses every span after the first
#       unterminated opener. Also reachable without any quoting via the JSON
#       envelope, if a field ordered before `command` happens to contain a lone
#       `$(`.
#
# Those paths run only when jq, awk, or the lib is already broken. Deliberately
# NOT fixed here: making the loop skip an unterminated opener and keep scanning
# is a fourth attempt to decide span boundaries from text alone, and the first
# three each shipped and were each defeated. Documented in DOCUMENTED RESIDUALS
# rather than papered over — claiming closure this function does not have is
# what made three review rounds block.
#
# THE CAP IS DERIVED FROM THE INPUT, not a magic number. It was a fixed 200, and
# that was itself a live bypass with a sharp edge: 199 leading `${z}` spans
# before `g${x}h pr merge 42` DENIED (200 spans, all processed) and 200 ALLOWED
# (201 spans, the last one unreached). Every successful iteration consumes at
# least TWO characters — an opener and its closer — so `length + 8` cannot be
# reached by any input and the cap is a non-termination backstop rather than a
# limit on what is scanned. (Stated as "the two-character opener" until
# 2026-09-06: wrong for the backtick arm, whose opener is one character. The
# bound is unaffected — it rests on opener+closer, not on the opener alone.)
_out_crude_vanish() {
  local s="$1" out="" x rest close best kind n=0 pb pp pt
  local cap=$(( ${#1} + 8 ))
  while [ "$n" -lt "$cap" ]; do
    n=$((n + 1))
    pb=-1; pp=-1; pt=-1
    # `${s%%pat*}` keeps the text before the FIRST occurrence, so its length is
    # that occurrence's offset. Three separate `case` tests, not one regex:
    # this must run where `grep` is the only external binary available.
    case "$s" in *'${'*) x=${s%%'${'*}; pb=${#x} ;; esac
    case "$s" in *'$('*) x=${s%%'$('*}; pp=${#x} ;; esac
    case "$s" in *'`'*)  x=${s%%'`'*};  pt=${#x} ;; esac
    best=-1; kind=
    [ "$pb" -ge 0 ] && { best=$pb; kind=b; }
    [ "$pp" -ge 0 ] && { [ "$best" -lt 0 ] || [ "$pp" -lt "$best" ]; } && { best=$pp; kind=p; }
    [ "$pt" -ge 0 ] && { [ "$best" -lt 0 ] || [ "$pt" -lt "$best" ]; } && { best=$pt; kind=t; }
    [ "$best" -ge 0 ] || break
    case "$kind" in
      b) rest=${s#*'${'}; close='}' ;;
      p) rest=${s#*'$('}; close=')' ;;
      t) rest=${s#*'`'};  close='`' ;;
    esac
    out="$out${s:0:$best}"
    case "$rest" in
      *"$close"*) s=${rest#*"$close"} ;;
      # Unterminated opener: nothing to delete, so keep the remainder and stop.
      *) s="$rest"; break ;;
    esac
  done
  _OUT_CRUDE_VANISHED="$out$s"
}

crude_smells_outward() {
  local t=${1//$'\n'/ }
  t=${t//\\n/ }
  # Strip quote/backslash/$ characters (review round 4, 2026-08-17): this is a
  # non-quote-aware smell test by design, but leaving these characters in
  # place let a $-sigil-split verb (`e$'a's update`, which cmd_words itself
  # reconstructs to `eas update`) hide from every regex below, all of which
  # require the verb's letters adjacent. Stripping only ever REMOVES
  # punctuation, never letters, so it can only make this fail-closed check
  # fire MORE often, never less — the safe direction for a fallback that only
  # runs when everything else (jq, awk, or the lib itself) is already broken.
  # Degraded-path mirror of the precise narrow-deny rule, and it MUST run here
  # — before the `$` strip on the next line, which is the only reason the sigil
  # is still visible at all. Without this the narrow deny would exist only on
  # the precise path, leaving the degraded path exactly as open as the ruling's
  # rejected option (b); the verified cause of that fail-open is the LETTERS
  # INSIDE an expansion (`${v:-merge}`) breaking the `[^a-zA-Z]+` separator
  # class every pattern below relies on.
  #
  # This function is deliberately neither quote- nor grammar-aware, so it
  # cannot tell WHICH expansion supplies WHAT — but a gated binary name sharing
  # a command segment with an expansion sigil is unverifiable HERE by
  # construction, and this path's whole contract is to fail CLOSED (it only
  # runs when jq, awk, or the lib is already broken). That posture is already
  # established: it denies every `gh api` and every `gh pr merge` regardless of
  # flags, and denies quoted mentions the precise path allows.
  #
  # The `[^;&|]*` segment class keeps it inside ONE command, so an unrelated
  # `$VAR` after a `&&` cannot reach back to an earlier gated binary.
  #
  # BOTH sigils, not just `$`. A backtick substitution carries no `$` at all,
  # so a `$`-only class left `gh pr me``rge 42` ALLOWED on all three degraded
  # paths while the precise path denied it — measured, not predicted, via
  # repro-outward-cli-corpus.sh's `mid-backtick` row, which was the single
  # remaining degraded ALLOW after the `$` mirror landed. Adding one character
  # to the class closes it, in the same fail-closed direction as everything
  # else in this function.
  grep -Eq '(^|[^a-zA-Z])(eas|railway|npm|pnpm|yarn|gh)[^;&|]*[$`]' <<< "$t" && return 0
  # ADDED 2026-09-06 (security review of PR #926, finding C1 — the DEGRADED
  # half). The mirror just above requires the gated binary NAME to survive
  # intact, with a sigil somewhere after it. That covers a split VERB
  # (`eas up${UNSET}date` — `eas` is intact, `$` follows) but is structurally
  # unable to cover a split BINARY NAME: `e${UNSET}as update` contains no
  # literal `eas` at all, so no pattern anchored on the name can fire, and the
  # character strip on the next line cannot help either — it removes the `$`
  # and yields `e{UNSET}as`, never `eas`. Rejoining a name split by a span
  # requires deleting the SPAN, which is a strictly larger operation than
  # deleting characters. Measured before this fix: `e${UNSET}as update
  # --branch preview` (an OTA publish to end users), `n${UNSET}pm publish`,
  # `g${UNSET}h pr merge 42`, `g${UNSET}h api repos/o/r -X POST` and
  # `rail${UNSET}way up` all ALLOWED on all three degraded paths, while the
  # precise path denied them — the exact "fixed on one path only" shape the
  # mirror above was itself added to prevent.
  #
  # UNIONED IN, NOT SUBSTITUTED FOR the original — the rule the whole review
  # turns on. The renderings are newline-joined and grep is line-oriented, so
  # each is matched independently and the seam cannot spell a verb present in
  # neither (the same construction, and the same reason, as scan_renderings
  # below). Substituting would trade this family for the ones the untouched
  # rendering catches.
  # UNIONED IN, never SUBSTITUTED FOR the original. The renderings are
  # newline-joined and grep is line-oriented, so each is matched independently
  # and the seam cannot spell a verb present in neither — the same construction
  # and the same reason as scan_renderings below.
  #
  # SIMPLIFIED 2026-09-06 (round-3 review). Two additions from the previous round
  # were REMOVED rather than repaired, because both were unsound in the same way:
  #   - A GREEDY second rendering (first opener to LAST closer, in one bite). It
  #     was justified as "over-deletion, which is the safe direction, and harmless
  #     because it is unioned". False: for a nested span greedy was the ONLY
  #     rendering that reconstructed the needle, so its over-deletion WAS the
  #     miss — any `)` occurring after the verb swallowed it, and
  #     `e$(: $(:))as update --branch preview && (echo done)` ALLOWED on all
  #     three degraded paths while the version without the trailing subshell
  #     denied. A union cannot restore what no rendering holds.
  #   - A crude JSON-envelope trim, to stop the envelope's own trailing `"}}`
  #     from being the last closer greedy found. It was measured against this
  #     project's real transcripts afterwards: 247/247 real Bash envelopes carry
  #     a `description` (and often a `timeout`) AFTER `command`, so the `"}}`
  #     anchor only ever fired for the TEST HARNESS's envelope shape. It was
  #     tuned to the fixture, not to production. (That 247/247 came from local
  #     transcript .jsonl files, which this repo does not track — dated evidence
  #     for a mechanism now DELETED, not a claim anyone need re-verify. The
  #     conclusion it supported stands on its own: the anchor assumed `command`
  #     was the envelope's last key, and the harness was the only place that
  #     was true.)
  # Neither is replaced with a third hand-rolled scanner. The residuals — a
  # misjudged span end (a), and a scan abandoned at an unterminated opener (b),
  # both on the degraded paths — are recorded in DOCUMENTED RESIDUALS and above
  # _out_crude_vanish instead. A stated residual is honest; a
  # scanner that looks sound until someone constructs the case it missed is what
  # three review rounds have now shown this position cannot support.
  if case "$t" in *'${'*|*'$('*|*'`'*) true ;; *) false ;; esac; then
    _out_crude_vanish "$t"
    [ "$_OUT_CRUDE_VANISHED" = "$t" ] || t="$t
$_OUT_CRUDE_VANISHED"
  fi
  t=${t//\'/}; t=${t//\"/}; t=${t//\\/}; t=${t//\$/}
  # Command-word patterns — case-INSENSITIVE (macOS APFS resolves `EAS`).
  grep -Eqi 'eas[^a-zA-Z]+(update|publish|submit)|eas[^a-zA-Z]+update:(delete|edit|republish|revert-update-rollout|roll-back-to-embedded|rollback)|eas[^a-zA-Z]+(channel|branch):(create|edit|delete|rename)|eas[^a-zA-Z]+build[^;&|]*--auto-submit|railway[^a-zA-Z]+(up|deploy|redeploy|restart|down|delete|remove|rm|run)|railway[^a-zA-Z]+(variable|variables|vars|var)[^a-zA-Z]+(set|delete)|railway[^a-zA-Z]+(service|environment)[^a-zA-Z]+delete|npm[^a-zA-Z]+publish|(npm|pnpm|yarn)([^a-zA-Z]+-{1,2}[^[:space:]]*)*[^a-zA-Z]+(run-script|run)([^a-zA-Z]+-{1,2}[^[:space:]]*)*[^a-zA-Z]+update:(preview|production)|(yarn|pnpm)([^a-zA-Z]+-{1,2}[^[:space:]]*)*[^a-zA-Z]+update:(preview|production)|gh[^a-zA-Z]+pr[^a-zA-Z]+(merge|close|edit|ready|reopen|review|lock|unlock|update-branch|revert)|gh[^a-zA-Z]+release[^a-zA-Z]+(create|delete|delete-asset|edit|upload)|gh[^a-zA-Z]+repo[^a-zA-Z]+(create|delete|archive|unarchive|edit|rename|sync|fork)|gh[^a-zA-Z]+api[^a-zA-Z]' <<< "$t" && return 0
  # Flag-correlated patterns — case-SENSITIVE (a case-insensitive `-R` would
  # false-match the `-r` inside `--remove-reviewer`).
  grep -Eq 'gh[^a-zA-Z]+pr[^a-zA-Z]+(create|comment)([^;&|]|&[0-9-]|&[<>]|[<>]&|&?[<>]+&?[|!])*(--repo|-R)' <<< "$t" && return 0
  return 1
}

# Raw-envelope form of the inline "ALLOW_OUTWARD_CLI=1 <command>" bypass, for
# the paths that never obtain a decoded $CMD (no-jq; jq-extraction failure).
raw_inline_bypass() {
  case "$1" in *'"command":"ALLOW_OUTWARD_CLI=1 '*) return 0 ;; esac
  return 1
}

# Without jq we cannot parse the envelope or run the precise matcher. Fail
# CLOSED only for a raw payload that plausibly names one of the outward verbs
# above (mirrors git-safety.sh's own no-jq fallback) — an unrelated Bash call
# with none of these substrings is unaffected.
if ! command -v jq >/dev/null 2>&1; then
  INPUT=$(cat)
  # Inline "ALLOW_OUTWARD_CLI=1 <command>" prefix — see the note below the
  # jq-available branch for why this is a SEPARATE check from the ambient
  # env-var one above.
  raw_inline_bypass "$INPUT" && exit 0
  if grep -Eq '"tool_name"[[:space:]]*:[[:space:]]*"Bash"' <<< "$INPUT" \
     && crude_smells_outward "$INPUT"; then
    printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"guard-outward-cli: jq unavailable - failing closed for a command that looks like an outward-facing CLI mutation. Bypass: ALLOW_OUTWARD_CLI=1."}}'
  fi
  exit 0
fi

# Defined BEFORE the envelope extraction below so the jq-failure fallbacks can
# use it. Safe: jq is confirmed present at this point (the no-jq branch above
# already returned), and this function is never reached from that branch.
deny() {
  jq -n --arg r "$1" \
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":$r}}'
  exit 0
}

INPUT=$(cat)
# A jq EXTRACTION failure is not the same as "no jq". The previous version
# spelled both as `|| exit 0` — so malformed JSON, an absent `tool_name`, or a
# renamed envelope field ALLOWED everything, while the no-jq path fails CLOSED
# on the identical input. Fall back to the same crude smell test instead.
if ! TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null); then
  raw_inline_bypass "$INPUT" && exit 0
  if crude_smells_outward "$INPUT"; then
    deny "guard-outward-cli: the hook envelope's .tool_name could not be read (malformed JSON or a changed envelope shape) - failing closed via the crude smell test for a payload that looks like an outward-facing CLI mutation. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
  fi
  exit 0
fi
[ "$TOOL" = "Bash" ] || exit 0
if ! CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null); then
  raw_inline_bypass "$INPUT" && exit 0
  if crude_smells_outward "$INPUT"; then
    deny "guard-outward-cli: the hook envelope's .tool_input.command could not be read (malformed JSON or a changed envelope shape) - failing closed via the crude smell test for a payload that looks like an outward-facing CLI mutation. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
  fi
  exit 0
fi

# Inline "ALLOW_OUTWARD_CLI=1 <command>" prefix — the documented single-command
# escape hatch. This is a SEPARATE check from the ambient `[ -n "$ALLOW_OUTWARD_CLI" ]`
# ambient bypass above: a PreToolUse hook runs in its OWN process, spawned
# BEFORE the gated command's own shell ever executes — so a `VAR=val cmd`
# assignment typed as a prefix on the Bash tool_input.command string never
# reaches this hook's environment; it only takes effect once (if) the
# command itself runs, which is too late for a check that must run first.
# Recognizing the literal prefix in the command STRING is the only way to
# honor it as "one command" (mirrors git-safety.sh's INLINE_BYPASS pattern
# for SKIP_WORKTREE_CONTRACT=1).
case "$CMD" in "ALLOW_OUTWARD_CLI=1 "*) exit 0 ;; esac

# Fork-free: a $(cd ...) subshell here would be the ENTIRE added cost of reaching the shared
# fast-path helper below (measured ~1.9ms/call; sourcing itself is free) — this HERE now runs
# on every Bash tool call, not just ones that already matched the old inline filter. The
# */*) arm is load-bearing: a bare "${BASH_SOURCE[0]%/*}" returns the filename unchanged when
# invoked with no slash, the source below then fails, and (absent the fall-through design
# below) could silently skip this DENY gate.
case "${BASH_SOURCE[0]}" in */*) HERE="${BASH_SOURCE[0]%/*}" ;; *) HERE=. ;; esac

# Necessary-substring fast path via the shared helper (lib/fastpath-filter.sh)
# (project_per_bash_hook_overhead). This hook runs on EVERY Bash tool call, so it must reject
# the common case before doing any real work — before sourcing cmd-detect.sh and before
# either awk pass.
#
# TWO STAGES, and the second one is why this is correct. The single-stage raw
# `case "$CMD"` this replaces was justified as "cmd_bare only BLANKS characters,
# never inserts/moves them, so this is a strict superset". That was true of
# cmd_bare and FALSE of cmd_words, which DELETES quote characters and therefore
# synthesises needles absent from raw text: `e"a"s update` contains no `eas`, so
# the filter exited 0 and the verb published an OTA (review, 2026-08-16).
# See lib/fastpath-filter.sh for the full two-stage soundness argument.
#
# Matched under `nocasematch` because the predicates below are case-insensitive: a
# case-SENSITIVE fast path would exit 0 on `EAS update` before any of them ran. The shopt
# bracketing stays tightly scoped to just this call — lib/fastpath-filter.sh's
# cmd_fastpath_has does not (and, in bash 3.2, cannot) toggle it itself. (`pnpm` needs no
# entry of its own — it contains `npm`.)
#
# If the helper is unsourceable, do NOT exit here — fall through to the lib/cmd-detect.sh
# check below, which already has its own tested fail-closed handling (crude_smells_outward);
# losing the cheap pre-filter only costs performance in that (broken-install) case, never a
# decision.
if . "$HERE/lib/fastpath-filter.sh" 2>/dev/null && declare -F cmd_fastpath_has >/dev/null; then
  shopt -s nocasematch
  cmd_fastpath_has "$CMD" '*eas*' '*railway*' '*npm*' '*yarn*' '*gh*'
  # _OUT_FP_RC is an EXIT-STATUS capture (0 = matched), not a boolean "found" flag — code
  # review, 2026-09-02: the old inline filter's `_OUT_FASTPATH=1` meant "matched"; this is
  # `$?` from cmd_fastpath_has, where 0 means "matched" — same polarity as the check below,
  # but the inverted-from-before meaning is a misreading trap for the next editor if the name
  # still reads as a boolean.
  _OUT_FP_RC=$?
  shopt -u nocasematch
  # STAGE 3, guard-local (2026-09-06, security review of PR #926, finding C1).
  # DECLINE TO DECIDE rather than widen the strip. The helper's own two-stage
  # soundness argument is TYPED: "cmd_words only ever deletes those CHARACTERS
  # or inserts the placeholder letter `x` ... so stage 2 is a superset of what
  # cmd_words can produce BY CONSTRUCTION" (lib/fastpath-filter.sh:24-31, which
  # explicitly demands "re-verify this claim whenever cmd_words' character set
  # changes"). This hook now also reads $WORDS_VANISHED, which deletes whole
  # SPANS — a strictly larger operation than deleting characters — so stage 2
  # stopped being a superset the moment that rendering was wired in, and the
  # re-audit the header demands was not performed. MEASURED CONSEQUENCE:
  # `e${UNSET}as update --branch preview` reduces under stage 2 to `e{UNSET}as`,
  # never yields the `eas` needle, and exited HERE — before $WORDS_VANISHED was
  # ever computed. Silently ALLOWED; real argv is an OTA publish to end users,
  # the exact 2026-08-16 incident class. Same for `n${UNSET}pm publish` and
  # `g${UNSET}h pr merge 42`. Attribution control that isolates it to THIS line:
  # `cd gh-notes && e${UNSET}as update --branch preview` DENIES, differing only
  # by an unrelated literal `gh` substring restoring the stage-1 needle.
  #
  # WHY A RAW-TEXT SIGIL TEST IS A COMPLETE SUPERSET, not an approximation:
  # cmd_words_vanished's awk neutralises a construct only where one of the
  # sigils below appears in its input buffer, which is the RAW $CMD (it is
  # called as `cmd_words_vanished "$CMD"`, not through cmd_words) — and real
  # bash likewise requires those bytes ADJACENT and UNESCAPED in source text for
  # a live expansion at all (`e"$"{U}as` is the literal string `e${U}as`, not an
  # expansion; the awk's own backslash arm emits `\$` verbatim). So no
  # neutralisable construct can exist without one of them appearing literally
  # here. Over-broad only on inert spellings (an escaped or single-quoted
  # `${`), which is the deny-monotone direction.
  #
  # THE SET GREW ON 2026-09-06 and the reason is worth stating, because the
  # entry in DOCUMENTED RESIDUALS above previously asserted the fix for this
  # class lived entirely in lib/cmd-detect.sh's allow-list. THAT WAS NECESSARY
  # BUT NOT SUFFICIENT, and the lib fix was unreachable without this line:
  # `$!`, `$@`, `$*`, `$1`..`$9` and the ANSI-C `$'…'` respelling carry NONE of
  # the three original digraphs, so `e$1as update --branch preview` — an OTA
  # publish — missed stage 1 and stage 2 and took the cheap exit HERE, before
  # $WORDS_VANISHED was ever computed. Measured on this tree by running the real
  # cmd_fastpath_has and this very `case`, not inferred.
  #
  # THE COST WAS THE ONLY REASON NOT TO, and it is now measured rather than
  # asserted. The old entry declined on the grounds that "`$` alone appears in a
  # large share of real commands" — true of a bare `$`, false of this narrow
  # set. Over 28,469 real Bash tool calls harvested from this project's own
  # transcripts: the three original digraphs match 3,709 (13.0%); these
  # additions match 333 (1.2%); and only 238 (0.8%) are NEWLY pushed onto the
  # slow path, i.e. roughly +0.7 ms on the average Bash tool call. A bare
  # `$name` still takes the cheap exit and is still a documented residual — it
  # cannot split a token, because an ordinary identifier greedily absorbs the
  # following alphanumerics. That absorption argument is TRUE HERE and false for
  # the special parameters above, which is exactly the over-generalisation this
  # widening repairs.
  #
  # NOT pushed into cmd_fastpath_has: the other six hooks that share it read
  # only cmd_bare/cmd_words, so their superset claim still holds, and widening
  # the shared helper would move every one of them onto the slow path too.
  #
  # IT DECLINES. IT DOES NOT PARSE. If $CMD contains any of these sigils, this
  # hook does not take the cheap exit — full stop, no analysis of what the
  # constructs are or where they end.
  #
  # THREE ATTEMPTS TO BE CLEVERER THAN THIS EACH SHIPPED A LIVE OTA-PUBLISH
  # BYPASS, and the sequence is recorded because the next reader's instinct will
  # be to try a fourth. Each attempt deleted the spans and re-tested the needles,
  # trusting a text-only judgement about where each span ended:
  #   1. "deletes a SUPERSET of the spans cmd_words_vanished deletes, so it can
  #      only over-PASS" — defeated by a NESTED span, `e$(: $(:))as update
  #      --branch preview`. The argument reasoned about letters DESTROYED (which
  #      stage 1 does cover) while the failure is letters that FAIL TO REJOIN — a
  #      needle in no rendering stages 1-2 can see, because it never exists in
  #      raw text at all.
  #   2. "any quote inside the span body is ambiguous" — sound, and rejected for
  #      cost, which was the mistake.
  #   3. "an ODD count of a quote is ambiguous" — defeated by a quote of one type
  #      nested inside the other: in `e$(: '"' "a)b" )as update --branch preview`
  #      both counts are EVEN while the closer genuinely sits inside quotes. And
  #      defeated again by constructs carrying no sigil digraph at all, which no
  #      digraph-based enumeration can ever see: a bare `(` subshell
  #      (`e$( (echo) )as update`) and a `case` arm's `)`
  #      (`e$(case x in a) : ;; esac)as update`).
  # Composing (3)'s two gaps produced one command ALLOWED on all four execution
  # paths. The pattern is structural, not bad luck: deciding where a span ends
  # needs the depth- and quote-stateful scanner in lib/cmd-detect.sh, and this
  # code runs BEFORE that lib is sourced, by design. Any enumeration written here
  # is a guess about a grammar this position cannot read.
  #
  # THE COST IS REAL AND IS THE POINT. Measured: a span-carrying command goes
  # from ~16 ms to ~105-125 ms, and span-carrying commands are ~16% of this
  # project's harvested history — roughly +16 ms on the average Bash tool call,
  # on a hook that runs on every one of them (project_per_bash_hook_overhead).
  # Commands with NO span are untouched at ~16 ms. That is the price of not
  # guessing, and it is an owner's cost decision to revisit, not something to
  # optimize away a fourth time. If it must come down, the sound direction is to
  # make lib/cmd-detect.sh's real scanner reachable from here — not to
  # re-derive its grammar in `case` patterns.
  #
  # The OR composition still holds and is what keeps this local to reason about:
  # stage 3 runs only after 1 and 2 have both missed, so declining can only ever
  # ADD work and denies, never remove a pass they already found.
  if [ "$_OUT_FP_RC" != 0 ]; then
    case "$CMD" in
      *'${'*|*'$('*|*'`'*) : ;;   # a span may build a needle we cannot see here
      # A SPECIAL parameter or an ANSI-C respelling may do the same (2026-09-06).
      # Each is ONE character long, so it terminates against a following letter
      # instead of absorbing it, and each can expand to empty or respell a
      # character -- so each can rejoin two halves of a binary name or verb that
      # no needle in stage 1 or 2 can see. `$?`, `$$` and `$#` are deliberately
      # ABSENT: each is always set to a non-empty string, so cmd_words_vanished
      # leaves it verbatim by its own allow-list criterion and declining here
      # would buy nothing. `$0` is swept in by the digit class and is likewise
      # never deleted downstream -- declining on it costs a slow path, not a
      # verdict.
      *'$!'*|*'$@'*|*'$*'*|*'$'"'"*|*'$'[0-9]*) : ;;
      *) exit 0 ;;
    esac
  fi
fi
# If the shared lib is unsourceable (broken install), jq IS available here
# (the no-jq branch above already returned) and deny() is already defined —
# fall back to the SAME crude smell test used by the no-jq path, applied to
# the already-extracted CMD, rather than silently allowing every command.
# (A previous version of this hook exited 0 here on the false premise that
# "the no-jq path already covers this" — jq-present + lib-missing is a
# DIFFERENT condition the no-jq branch never runs for, so nothing covered it.)
if ! . "$HERE/lib/cmd-detect.sh" 2>/dev/null || ! declare -F cmd_bare >/dev/null; then
  if crude_smells_outward "$CMD"; then
    deny "guard-outward-cli: lib/cmd-detect.sh is unsourceable (broken install) - failing closed via the crude smell test for a command that looks like an outward-facing CLI mutation. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
  fi
  exit 0
fi

# --- command-position anchors (must follow the lib source: _CMD_REDIR) -------
# Command-position building blocks — GUARD-LOCAL widened copies of
# lib/cmd-detect.sh's `_CMD_POS_*`. See the header's "COMMAND-POSITION ANCHORS
# ARE GUARD-LOCAL" note for why these are not upstreamed. `!` is deliberately
# NOT first in the prefix bracket class (a leading `!`/`^` reads as negation to
# some bracket-expression implementations); a backtick inside a single-quoted
# shell string is literal, so no escaping is needed for either constant.
_OUT_POS_PREFIX='(^|[;&|(`{!])[[:space:]]*(([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*|env|command|builtin|exec|nohup|setsid|then|do|else|elif|time|'"$_CMD_REDIR"')[[:space:]]+)*'
_OUT_POS_SUFFIX='([[:space:]]|[);&|`{}<>]|$)'
# NON-SWALLOWING variant for a clause-cut whose downstream check DECIDES AN
# ALLOW on flag presence (currently: the `gh pr merge` --auto clause below —
# see its CLAUSE= comment for the full account of why this exists). Plain
# `${_OUT_POS_SUFFIX}[^;&|]*` CONSUMES the boundary character and then keeps
# capturing past it: when that boundary is whitespace this is correct and
# intended (more of the SAME clause follows, e.g. `merge 42 --auto`), but
# when the boundary is a hard separator/bracket (`;`,`&`,`|`,`)`,backtick,
# `{`,`}`) the verb's own clause has NO more of its own arguments — anything
# after that character belongs to a DIFFERENT command or construct, and must
# not be captured into THIS clause. This variant only continues capturing
# after WHITESPACE; a hard-separator or end-of-string boundary ends the
# clause immediately, with nothing captured past it — mirroring real bash
# command-position semantics exactly (verified: `gh pr merge;curl --auto`
# treats `curl` as a wholly separate command bash-side too).
#
# ROUND 5 (2026-09-02, independent baseline-reviewer finding on round 3's own
# fix): branch 1's continuation-stop class `[^;&|]*` only excluded `;`/`&`/`|`
# — it did NOT match branch 2's own boundary set (`)`,backtick,`{`,`}`), so
# once ANY argument preceded the boundary (branch 1 fires instead of branch
# 2), the swallow reopened for those four characters. Live, verified bypass
# for two of them: `$(gh pr merge 42)curl --auto` and `` `gh pr merge 42`curl
# --auto `` both silently ALLOWED — real bash executes `gh pr merge 42`
# UNCONDITIONALLY as the command-substitution subprocess, with no --auto
# reaching it at all, before ever getting to the `curl --auto` half; verified
# with a paired deny control and traced to the same CLAUSE=[...] literal the
# round-3 comment above describes. `{`/`}` in this same arg-present position
# are DIFFERENT: verified via `bash -c 'for w in ...; do printf "[%s]\n"
# "$w"; done'` that `gh pr merge 42{,x}curl --auto` real-bash-expands to
# `--auto` as a genuine SEPARATE argument of the SAME `gh pr merge` command
# (comma-brace-expansion splits words, it does not glue two commands
# together), and a bare `}` (no matching `{`, so no expansion at all) simply
# stays glued into the preceding argument token with `--auto` following as a
# normal, space-separated, genuine argument — in both cases `--auto`
# genuinely reaches `gh`, so ALLOW was never actually wrong for `{`/`}` here.
# Branch 1 is widened to the full `)`,backtick,`{`,`}` set anyway, matching
# branch 2 exactly on principle (the two branches partition one boundary
# concept and must not silently diverge again) and erring toward the
# established deny-conservative precedent for `{`/`}` set by round 1's fix to
# `_OUT_POS_SUFFIX` itself — this denies two more, harmless-but-bizarre
# shapes (a literal `}`/comma-brace glued straight onto a merge argument) as
# a side effect, never removes a real ALLOW: the sanctioned
# `gh pr merge --auto` / `gh pr merge 42 --auto --squash --delete-branch`
# paths contain none of `;&|)`{}` before `--auto` and are unaffected. Full
# 16-shape {zero-arg,arg-present}×{;,&,|,),backtick,{,},EOS} sweep and
# mutation evidence in
# docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md's
# "round 5" section.
_OUT_POS_SUFFIX_MERGE_CLAUSE='([[:space:]][^;&|)`{}]*|[);&|`{}<>]|$)'

# INTERIOR SEPARATOR — the drop-in replacement for a bare `[[:space:]]+` between
# two REQUIRED-ADJACENT words (tool->verb, namespace->verb). Bash tokenizes a
# redirect out of argv WHEREVER it sits, including between a tool word and its
# verb, so `eas>/dev/null update`, `eas >/dev/null update` and `eas 2>&1 update`
# all build the SAME argv as the plain spaced form this guard correctly denies
# (verified by execution with PATH-shadowed argv-printing stubs, not by reading).
# Before this constant every such slot hardcoded `[[:space:]]+`, and a redirect is
# not whitespace, so the verb pattern never matched AT ALL — a TOTAL detection
# failure for every gated family, which is why even the --repo cross-repo egress
# check was skipped. No character-class widening could reach it: findings A (a
# redirect closing the VERB) and B (a redirect BEFORE the command) were BOUNDARY
# problems, where the verb sits next to an unaccepted character; this is a
# SEPARATOR problem, where the two words are pushed apart by a token the pattern
# does not model.
#
# THE SHAPE IS NOT INTERCHANGEABLE WITH THE OBVIOUS ALTERNATIVE:
#   * At ZERO iterations it reduces to EXACTLY `[[:space:]]+`. So the only inputs
#     whose decision can change are those carrying a redirect operator between two
#     required-adjacent words; every redirect-free command decides byte-identically
#     to before. That is the monotonicity argument this change rests on, and it is
#     what makes the false-positive population ENUMERABLE rather than merely
#     sampled — a command containing no `<`/`>` cannot flip, so the harvest is a
#     census, not a survey.
#   * The MANDATORY TRAILING `[[:space:]]+` is load-bearing, not tidiness. The
#     looser `([[:space:]]|REDIR)+` form additionally matches `eas>/dev/nullupdate`
#     — which REAL BASH DOES NOT RUN as the invocation it resembles: it redirects
#     to a file named `/dev/nullupdate`, and (measured with argv stubs) bash cannot
#     create that file, so it never execs `eas` at all. That row is pinned in
#     test-guard-outward-cli.sh and is the only CONTROL ROW that goes RED on a
#     "simplification" to the looser form — confirmed by running that mutation,
#     not assumed. (Corrected 2026-09-07: this said "is the ONE that goes RED",
#     which is false — the mutation turns TWO assertions red, that control plus
#     the structural shape check added later. Third instance in this PR of a
#     count going stale because a structural assertion was added after the
#     sentence was written; the qualifier "control row" is what makes it durable.)
#     `eas > update` is NOT such a discriminator, and an earlier revision of this
#     comment wrongly claimed it was: under BOTH forms `_CMD_REDIR`'s target class
#     greedily absorbs `update` as the redirect's FILENAME, leaving no verb to
#     match, so both correctly allow. It is kept as a plain false-positive control
#     (real bash runs `eas` with NO arguments there), not as mutation evidence.
#   * `[[:space:]]*` INSIDE the group and `+` outside, so a GLUED redirect has no
#     hole. This is precisely the shape lib/cmd-detect.sh's `_CMD_GIT_GLOBALS`
#     (:151) has already shipped for the git family — see its own comment for the
#     identical `*`-vs-`+` reasoning. Generalised here, deliberately NOT reinvented:
#     a second, subtly-different redirect pattern in this codebase is exactly how
#     `GH_API_CLAUSE` came to be missed.
#
# MUST STAY BELOW THE LIB SOURCE: it interpolates `$_CMD_REDIR`.
#
# THE FAILURE MODE IS LOUD, NOT SILENT — corrected 2026-09-07 after MEASURING it.
# Every copy of this warning in this file, the corpus and the test suite used to
# say a misordered definition "expands to the empty string — no error, suite
# green, bypass open". That was inherited prose, never run. This file sets
# `set -uo pipefail`, and nothing defines `_CMD_REDIR` except the lib, so above
# the source it is UNBOUND, not empty. Measured by moving the definition to
# immediately above the source and changing nothing else:
#
#   stderr: guard-outward-cli.sh: line 1453: _CMD_REDIR: unbound variable
#   stdout: (empty)                       suite: 53 passed, 495 failed
#
# The CONSEQUENCE the old wording named is still right — a hook that aborts with
# no JSON emits no deny, so the bypass is open — but it gets there by crashing,
# not by silently degrading. Worth the correction because a maintainer reasoning
# from "no error, suite green" would conclude the ordering constraint is
# untestable, when in fact any test at all catches it.
#
# Pinned by BEHAVIOUR rather than a `[ -n ]` assertion: 495 of 559 assertions go
# RED on the misordering, and the structural shape check below fails too.
#
# COST, MEASURED rather than assumed (project_per_bash_hook_overhead). This is a
# NESTED quantifier — `(...)*` followed by `+` — interpolated at 30 separator
# slots across 20 distinct patterns in
# a hook that runs on EVERY Bash tool call, which is the shape that produces
# catastrophic backtracking when it produces it at all. It does not here: macOS
# grep -E runs these as a DFA. Before/after, 10 invocations each, several runs:
# a command with no gated needle takes the fast-path exit at ~11 ms UNCHANGED
# (the overwhelming majority of calls); gated paths track their own baseline
# within run-to-run noise. Inputs shaped to punish a backtracking engine — 400
# spaces after a gated tool word, 120 chained redirects before the verb, 300 bare
# `>` glued to one — cost the SAME as an ordinary gated command, not more. If this
# constant is ever rewritten, re-measure that third row: it is the one that would
# expose a quadratic form.
#
# DELIBERATELY NOT APPLIED to crude_smells_outward's degraded mirror (search this
# file for `[^a-zA-Z]+`). That function runs on the no-jq and no-lib paths, which
# reach it BEFORE/WITHOUT the lib source, so `$_CMD_REDIR` there WOULD be the empty
# string — the same ordering trap in a new location, and under `set -u` it would
# also dirty stderr and break every allow assertion. Its `[^a-zA-Z]+` separator
# already absorbs letter-FREE redirects (`2>&1`) but not letter-bearing ones
# (`>/dev/null` — the `dev` breaks the class); that asymmetry is recorded in
# DOCUMENTED RESIDUALS rather than papered over.
_OUT_SEP='([[:space:]]*'"$_CMD_REDIR"')*[[:space:]]+'

BARE=$(printf '%s' "$CMD" | cmd_bare)
# WORDS is the argv-faithful rendering (lib/cmd-detect.sh): quote characters
# deleted so `eas "update"` / `eas up"date"` read as the `eas update` the shell
# actually builds, with separators INSIDE a span neutralised so a `;` in a commit
# message still cannot open a command position. $BARE survives for exactly ONE
# job, in the blank-rendering detector just below: a wholly-quoted command
# (`'eas update'`) BLANKS to nothing under cmd_bare while cmd_words renders it as
# a single word, and that difference is what routes it to the crude smell test
# instead of the precise matchers. Nothing else reads $BARE — do not delete it
# without deleting that detector's $BARE half too, and see the
# "wholly-quoted command" assertions in test-guard-outward-cli.sh, which exist
# precisely so that deletion goes red.
#
# UPDATED (todo P1-2026-08-17-quoted-command-substitution-inert, archived):
# every INVOCATION pattern below now matches $WORDS_DEEP (defined further
# down, right after this file's own broken-awk empty check), NOT plain
# $WORDS — $WORDS_DEEP additionally surfaces a verb hidden inside a LIVE
# command substitution, which plain cmd_words still (correctly, for its OTHER
# consumers) renders as an opaque quoted token. The ONE exception is the
# `gh pr merge --auto` carve-out's $CLAUSE extraction, which deliberately
# stays on plain $WORDS — see the CLAUSE assignment's own comment.
WORDS=$(printf '%s' "$CMD" | cmd_words)

# `declare -F cmd_bare` above proves the function is DEFINED, not that it
# WORKS. cmd_bare is implemented in awk; with jq/grep/sed present but awk
# ABSENT from PATH the lib sources cleanly, `declare -F` succeeds, the
# lib-unsourceable branch above is skipped — and cmd_bare then emits NOTHING,
# so every `grep -Eq … <<< "$BARE"` below finds nothing and this hook falls
# through to `exit 0` with ZERO fallback protection. Reproduced in review round
# 3 with a plain, unsplit `eas update --branch preview --platform all`, plus
# `npm publish` and `gh pr merge 42` — all ALLOWED, no crafting needed. Treat
# an all-blank $BARE from a non-blank $CMD as "the blanking primitive failed"
# and degrade to the crude smell test, mirroring the two branches above.
# Checked for BOTH renderings: cmd_words shares cmd_bare's awk backend, so a
# broken awk blanks them together — but asserting only one of the two would let a
# future divergence (a cmd_words-specific breakage) fall through silently.
if { [[ ! "$BARE" =~ [^[:space:]] ]] || [[ ! "$WORDS" =~ [^[:space:]] ]]; } \
   && [[ "$CMD" =~ [^[:space:]] ]]; then
  if crude_smells_outward "$CMD"; then
    deny "guard-outward-cli: the quote-aware rendering came back empty for a non-empty command - either its awk backend is missing/broken, or the command's entire text is quoted - so the precise matchers below cannot see it. Failing closed via the crude smell test for a command that looks like an outward-facing CLI mutation. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
  fi
  exit 0
fi

# WORDS_DEEP additionally surfaces a verb hidden inside a LIVE (unquoted or
# double-quoted) $(...)/backtick command substitution — see lib/cmd-detect.sh's
# cmd_words_deep for the mechanism and
# docs/solutions/logic-errors/quoted-command-substitution-always-executes-2026-08-17.md
# for the bug this closes: `echo "$(eas update --branch preview --platform
# all)"` genuinely executes regardless of the surrounding double quotes, and
# plain $WORDS blanked it to an opaque token, same as any other quoted DATA.
#
# COMPUTED AFTER the empty-rendering check above, deliberately: WORDS_DEEP's
# own emptiness is not independently checked here — it is derived from the
# SAME awk backend already proven working by that check (cmd_words_deep calls
# plain cmd_words first, unconditionally), so a broken awk is already caught
# before this line ever runs.
#
# USED ONLY BY DENY-SHAPED / OCCURRENCE-COUNTING checks below, never by
# $WORDS's ONE grant-shaped consumer (the `gh pr merge --auto` carve-out's
# $CLAUSE extraction, further down) — see lib/cmd-detect.sh's cmd_words_deep
# header for why unioning substitution content into a GRANT-shaped read would
# be a deny→allow regression worse than the bug being fixed. $WORDS itself
# stays completely unmodified so that one read keeps its existing contract.
WORDS_DEEP=$(cmd_words_deep "$CMD")

# A THIRD rendering, and the INVERSE operation to WORDS_DEEP: every construct
# PROVABLY capable of expanding to the empty string is DELETED, so a verb SPLIT
# by a vanishing sigil rejoins into the word bash actually builds (`me` +
# `${UNSET}` + `rge` -> `merge`). WORDS_DEEP APPENDS substitution bodies so a
# verb HIDING INSIDE one is seen; this one DELETES them so a verb SPLIT BY one
# is seen. Neither subsumes the other and they must stay separate lines --
# collapsing either into the other loses a whole family. The suffix position is
# a closer-class widening handled at _OUT_POS_SUFFIX instead. No boundary class
# can reach the mid-token case at all: the verb is SPLIT, not bounded, so there
# is no boundary byte to add.
#
# WHAT THIS RENDERING ACTUALLY CLOSES, corrected 2026-09-06 after the security
# review of PR #926 found the earlier wording false. It said "closes the prefix
# and mid-token positions of the vanishing-sigil class" (ruled 2026-09-03,
# option (a)) — a claim about the CLASS, made from a corpus that only ever
# varied the sigil MECHANISM at the VERB position. The class also has a TOOL
# position and a FLAG position, and both were open:
#   - TOOL  (`e${UNSET}as update`): the fast-path prefilter exit 0'd before this
#     line ever ran, on all four execution paths — see the STAGE 3 block at the
#     prefilter for the fix and the reasoning.
#   - FLAG  (`--re${UNSET}po`, `--ad``min`): the consumers read this rendering
#     as a FALLBACK (`if [ -z "$deep" ]`) or not at all, so a literal verb kept
#     it from ever being consulted — see gh_pr_clause_has_repo, the GH_API_CLAUSE
#     loop, and scan_renderings.
# Assigning this variable is NECESSARY for those positions and was never
# SUFFICIENT for them. The corpus now generates the position axis explicitly so
# a claim like the original one cannot be made from a corpus blind to it.
# See lib/cmd-detect.sh:cmd_words_vanished for the allow-list and why a
# construct must be PROVEN able to evaluate to empty before it may be deleted.
WORDS_VANISHED=$(cmd_words_vanished "$CMD")
# The paren-BLIND half of the vanishing rendering, kept in its OWN variable so
# every consumer below counts it as a rendering of its own. The bare-paren
# counter cannot read a `(` inside a shell COMMENT, so it over-counts, the
# substitution level never closes, and $WORDS_VANISHED comes back EMPTY —
# `e$(: # (` newline `)as update --branch preview` was a DENY→ALLOW regression
# on a real OTA publish (PATH-stubbed ground truth). This rendering reproduces
# the pre-counter close semantics, so the two are UNIONED rather than one
# substituted for the other.
#
# NOT folded into $WORDS_VANISHED as a second line, which was tried and measured
# wrong: `_out_max_count` COUNTS occurrences across a rendering, so two lines
# carrying the same `gh api` turned ONE occurrence into two and tripped the
# ">1 occurrence → ambiguous" deny on a genuine read-only call. Separate
# variables keep "the larger of the per-rendering counts" meaning what it says.
#
# SKIPPED ENTIRELY WHEN $CMD HOLDS NO `(`, and that is provable rather than a
# heuristic: the ONLY branch the `pcount` flag gates is `parens[d]++` (`c == "("`),
# which requires a literal `(` byte — so with none present the two passes are
# byte-identical by construction and the second awk fork buys nothing. (This read
# "the ONLY two branches … the arithmetic arm and `parens[d]++`" until the
# arithmetic arm was deleted on 2026-09-07; the skip is sound a fortiori with one
# gated branch instead of two, but a stale count here is the same drift class this
# file's header names as its dominant defect, so it is corrected rather than left.) This hook runs on EVERY Bash
# tool call and most commands contain no `(` at all, so the common case now costs
# one fork instead of two. The equality de-dup below still runs for the commands
# that DO contain one — it is what keeps a consumer from scanning the same
# rendering twice.
if case "$CMD" in *'('*) true ;; *) false ;; esac; then
  WORDS_VANISHED_BLIND=$(cmd_words_vanished_blind "$CMD")
  [ "$WORDS_VANISHED_BLIND" = "$WORDS_VANISHED" ] && WORDS_VANISHED_BLIND=""
else
  WORDS_VANISHED_BLIND=""
fi

# Union, for BOOLEAN detection ONLY. Every consumer switched to this is of the
# form `if grep -Eqi ... ; then deny`, so over-matching can only ever ADD a
# deny -- the safe direction, and the same monotonicity argument WORDS_DEEP
# already rests on. Two kinds of reader must NEVER be pointed at it:
#   1. The occurrence COUNTERS. Appending a whole-command rendering doubles
#      every verb occurrence, so an ordinary single invocation would count 2
#      and trip the ">1 is ambiguous" deny -- a mass over-denial of routine
#      sanctioned work. They use _out_max_count below instead.
#   2. $WORDS's one GRANT-shaped consumer (the `gh pr merge --auto` carve-out
#      $CLAUSE extraction further down). A split `--a${UNSET}uto` deleted into
#      a literal `--auto` would GRANT the carve-out on a flag the user never
#      passed -- a bypass strictly worse than the one this rendering closes.
#      $WORDS stays byte-identical; the two GRANT INVERSION assertions in
#      test-guard-outward-cli.sh pin that it does.
WORDS_SCAN="$WORDS_DEEP
$WORDS_VANISHED
$WORDS_VANISHED_BLIND"

# Occurrence count across all THREE renderings, taking the LARGEST rather than
# counting the union. Preserves the ambiguity semantics exactly (two real
# invocations still count 2, one still counts 1) while letting a verb that only
# the vanished rendering can see raise its block's count from 0 to 1 -- without
# which the merge and gh api blocks, both GATED BEHIND their counters, are
# never entered at all and a mid-token split falls straight through to ALLOW.
_out_max_count() {  # $1=regex -> largest per-rendering match count
  # THREE renderings, each counted SEPARATELY and the largest returned — never
  # counted over a concatenation. That distinction is the whole point of this
  # helper and it was re-learned the hard way: folding the paren-blind rendering
  # into $WORDS_VANISHED as a second LINE made one `gh api` count as two and
  # denied a genuine read-only call as "ambiguous". Counting per rendering keeps
  # the ambiguity semantics exact (two real invocations still count 2, one still
  # counts 1) no matter how many renderings are added here.
  local r n best=0
  for r in "$WORDS_DEEP" "$WORDS_VANISHED" "$WORDS_VANISHED_BLIND"; do
    [ -n "$r" ] || continue
    n=$(printf '%s' "$r" | grep -oiE "$1" | wc -l | tr -d '[:space:]')
    [ "${n:-0}" -gt "$best" ] && best=${n:-0}
  done
  printf '%s' "$best"
}

# Multi-rendering flag scan, for DENY-ONLY checks. One pattern, every rendering,
# because each hides a spelling the others show: a quoted VALUE (`--auto
# "--admin"`) survives only in raw $CMD, a quoted-split NAME (`--ad"min"`) is
# reconstructed only in $WORDS, and a SPAN-split name (`--ad``min`,
# `--ad${UNSET}min`) only in $WORDS_VANISHED. Reading all of them is free HERE
# and only here — a deny-only check can ADD a deny but can never grant a
# carve-out, so its false positives fall on the safe side. Do NOT reuse this for
# a check that GRANTS a carve-out: there, reading more renderings widens what
# gets waved through.
#
# RENAMED from `scan_both` 2026-09-06 (security review of PR #926, finding C4).
# It reads FOUR renderings now (a fourth joined 2026-09-07), and a name asserting a count while the body
# reads three is the kind of drift this file has been bitten by before.
#
# $WORDS_VANISHED ADDED in the same change, and this was an effective GRANT, not
# merely a missed deny: `gh pr merge 42 --auto --ad``min` was ALLOWED. Real argv
# is `--auto --admin`, an administrator merge that bypasses branch protection —
# so with no --admin deny, the --auto carve-out proceeded and waved through the
# exact thing the carve-out's own stated premise (that branch protection still
# gates the merge) depends on NOT happening. Neither $CMD nor $WORDS contains
# `--admin` for that spelling, and an empty backtick pair carries no `$`, so the
# CLAUSE `$`-mask that catches the `${UNSET}` spelling never fired either.
# `eas build --platform ios --auto-su``bmit` (a store submission) was the same
# gap at the sibling call site. UNION, not substitution: $WORDS_VANISHED is
# ADDED to the existing two, never swapped in — deletion disarms exactly the
# presence checks this helper performs, so it must never be the only rendering
# a flag name is looked for in.
#
# The renderings are joined by NEWLINES and MUST stay that way. Concatenated,
# a seam spells flags present in NO string — end-of-$CMD `--ad` plus
# start-of-$WORDS `min` reads as `--admin` — and grep being line-oriented is the
# only thing making a boundary-spanning match impossible. The two
# "the $CMD/$WORDS seam cannot forge ..." assertions in
# test-guard-outward-cli.sh go RED if this is ever "simplified" to "$CMD$WORDS";
# the third rendering adds a second seam with the identical hazard and its own
# assertion. A FOURTH rendering ($WORDS_VANISHED_BLIND) joined on 2026-09-06 and
# introduces a THIRD seam, which is NOT yet pinned — the sentence above claimed
# each new rendering brings its own assertion, and that stopped being true at the
# fourth. Not live (newline-joined, grep is line-oriented), so this is a
# mutation-detection gap rather than a bypass: "simplifying" the join would go
# undetected at that seam specifically.
#
# Case-SENSITIVE by design — no `-i`, unlike the invocation matchers below.
# These patterns match flag NAMES, which the target CLIs themselves treat
# case-sensitively: `--ADMIN` is not a real flag, and a case-insensitive `-R`
# would false-match ordinary text. See the header's FLAG-detection note.
#
# PRECONDITION: call only AFTER `$CMD` (from the jq extraction), `$WORDS`, `$WORDS_VANISHED`
# and `$WORDS_VANISHED_BLIND`
# are assigned, and only from a DENY-shaped check — never to GRANT a carve-out. Extracting this
# helper removed the last per-call-site reminder of both, so they are stated here, on the
# code that depends on them. An early call does NOT abort: `set -uo pipefail` has no `-e`, so
# the unbound-variable message goes to stderr and `grep`'s failure is swallowed by the `if`
# — the check silently reports "no match" and the guard FAILS OPEN. That is the shape the
# four degraded exit-early paths above (no-jq, jq-extraction failure, lib unsourceable,
# blank rendering) would create if one ever grew a flag scan.
scan_renderings() { grep -Eq "$1" <<< "$CMD
$WORDS
$WORDS_VANISHED
$WORDS_VANISHED_BLIND"; }

# Necessary-substring fast path (project_per_bash_hook_overhead): a command
# without ANY of these literal substrings cannot match any predicate below.

# --- eas -------------------------------------------------------------------
# eas update/publish/submit (space-separated subcommand).
if grep -Eqi "${_OUT_POS_PREFIX}eas${_OUT_SEP}(update|publish|submit)${_OUT_POS_SUFFIX}" <<< "$WORDS_SCAN"; then
  deny "guard-outward-cli: command-position 'eas update/publish/submit' publishes an OTA update or app-store submission — the exact class of the 2026-08-16 accidental-OTA incident. Read-only forms (eas update:list, eas update:view, eas whoami, ...) are unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi
# eas update:* MUTATING colon subcommands — verified against `eas update
# --help` (eas-cli 20.1.0); see the header's DOCUMENTED RESIDUALS entry for
# the verified-read-only counterpart (update:list/view/insights, unaffected
# by this pattern since the colon puts them outside this alternation).
if grep -Eqi "${_OUT_POS_PREFIX}eas${_OUT_SEP}update:(delete|edit|republish|revert-update-rollout|roll-back-to-embedded|rollback)${_OUT_POS_SUFFIX}" <<< "$WORDS_SCAN"; then
  deny "guard-outward-cli: command-position 'eas update:delete/edit/republish/revert-update-rollout/roll-back-to-embedded/rollback' mutates what OTA update end users receive — the same incident class as bare 'eas update'. Read-only colon forms (eas update:list, eas update:view, eas update:insights) are unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi
# eas channel:*/branch:* MUTATING colon subcommands — a channel repoint or a
# branch delete changes which update end users receive, an effect identical to
# the already-denied `eas update:*` forms (review round 3 found all of these
# ALLOWED). Read-only `:list`/`:view` forms stay allowed.
if grep -Eqi "${_OUT_POS_PREFIX}eas${_OUT_SEP}(channel|branch):(create|edit|delete|rename)${_OUT_POS_SUFFIX}" <<< "$WORDS_SCAN"; then
  deny "guard-outward-cli: command-position 'eas channel:/branch: create/edit/delete/rename' repoints or deletes the channel/branch that decides which OTA update end users receive — the same effect class as 'eas update'. Read-only forms (eas channel:list, eas branch:view, ...) are unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi
# `eas build --auto-submit` (and --auto-submit-with-profile) submits the
# resulting binary to the store as soon as the build finishes — a store
# mutation wearing a build command's name. Plain `eas build` stays allowed.
# Flag scan via scan_renderings (see its definition for why all four renderings are read
# and why they must stay newline-joined). No trailing boundary, so
# `--auto-submit-with-profile` is caught by the same pattern. Leading boundary
# is `_OUT_FLAG_LEAD` (see its own definition) so a default-value expansion
# (`${x:---auto-submit}`) cannot donate the flag's boundary.
if grep -Eqi "${_OUT_POS_PREFIX}eas${_OUT_SEP}build${_OUT_POS_SUFFIX}" <<< "$WORDS_SCAN" \
   && scan_renderings "${_OUT_FLAG_LEAD}"'--auto-submit'; then
  deny "guard-outward-cli: command-position 'eas build --auto-submit' submits the finished binary to the app store — an outward mutation, not just a build. Plain 'eas build' is unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi

# --- railway -----------------------------------------------------------------
# `run` is included: `railway run <cmd>` executes an ARBITRARY command with the
# live service's env injected — including the production DATABASE_URL (this
# repo's own prod backfill/seed docs use exactly that shape), so it is at least
# as outward as `railway up`.
if grep -Eqi "${_OUT_POS_PREFIX}railway${_OUT_SEP}(up|deploy|redeploy|restart|down|delete|remove|rm|run)${_OUT_POS_SUFFIX}" <<< "$WORDS_SCAN"; then
  deny "guard-outward-cli: command-position 'railway up/deploy/redeploy/restart/down/delete/remove/rm/run' mutates a live Railway service ('railway run' executes an arbitrary command with the LIVE service env, incl. the production DATABASE_URL). Read-only forms (railway status, railway logs, railway whoami, ...) are unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi
# railway variable set/delete (production secrets/env vars) and
# service/environment delete — a level deeper than the top-level verbs
# above, and at least as dangerous (an overwritten secret or a deleted
# service/environment is not recoverable by a redeploy the way up/down are).
if grep -Eqi "${_OUT_POS_PREFIX}railway${_OUT_SEP}(variable|variables|vars|var)${_OUT_SEP}(set|delete)${_OUT_POS_SUFFIX}" <<< "$WORDS_SCAN"; then
  deny "guard-outward-cli: command-position 'railway variable/vars/var set/delete' mutates a live service's environment variables (may include production secrets). Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi
if grep -Eqi "${_OUT_POS_PREFIX}railway${_OUT_SEP}(service|environment)${_OUT_SEP}delete${_OUT_POS_SUFFIX}" <<< "$WORDS_SCAN"; then
  deny "guard-outward-cli: command-position 'railway service/environment delete' deletes a live Railway service or environment. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi

# --- npm publish -------------------------------------------------------------
if grep -Eqi "${_OUT_POS_PREFIX}npm${_OUT_SEP}publish${_OUT_POS_SUFFIX}" <<< "$WORDS_SCAN"; then
  deny "guard-outward-cli: command-position 'npm publish' pushes a package to the registry. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi

# --- this repo's OWN OTA publish scripts -------------------------------------
# `npm run update:preview` / `npm run update:production` exec
# `eas update --branch preview|production --platform all` against
# https://api.ocrecipes.com — a real OTA to real users, i.e. EXACTLY the
# incident class this hook exists for, reached through a command word the
# `npm publish` and `eas update` patterns above both miss. Review round 3
# found both ALLOWED, while this hook's own deny message and self-tests
# asserted they were safe. The sanctioned flow is now
# `ALLOW_OUTWARD_CLI=1 npm run update:preview -- --message "…"`.
# `run-script` is npm's alias for `run`; it is listed FIRST so leftmost-longest
# alternation cannot settle on the `run` prefix. `pnpm`/`yarn` are spelled out
# in the ANCHORED alternation — "pnpm contains npm" only helps the unanchored
# crude test; a command-position anchor sees the `p` before `npm` and misses it
# (caught by this file's own `pnpm run update:preview` case). The bare-script
# spelling that yarn/pnpm accept WITHOUT `run` gets its own pattern.
#
# FLAG RUNS: the first shape of this pattern required the script name to sit
# IMMEDIATELY after `run`, so any flag between them walked straight through —
# `npm run --silent update:preview`, `npm run -s update:preview`, and
# `npm --loglevel=error run update:preview` all ALLOWED, on the exact command
# class this block exists for. That is this repo's own
# `deny-gate-flag-presence-check-needs-raw-text-and-every-spelling` lesson
# recurring inside its own fix: matching the bare spelling of a command is not
# matching the command. `_OUT_FLAG_RUN` absorbs zero-or-more `-`/`--` flag words
# (with or without `=value`) in BOTH positions — before `run` (npm global flags)
# and after it (npm run flags). It deliberately does NOT absorb a non-flag word,
# so `npm run build update:preview` still does not match: only flags may
# intervene, never another script name.
# The optional trailing `([[:space:]]+[^-[:space:]][^[:space:]]*)?` absorbs a
# SPACE-SEPARATED flag value (`--loglevel error`, `-C /tmp`, `-w pkg`). Without
# it the run broke at the mandatory trailing space and `npm run --loglevel error
# update:preview`, `npm -C /tmp run update:preview` and `yarn --loglevel error
# update:preview` all ALLOWED — the first version of this fix closed only the
# single-token spellings (`-s`, `--silent`, `--flag=value`) while its own doc
# claimed "every spelling", which is the same overclaim one layer down.
# COST, accepted deliberately: the value-absorption is greedy-with-backtracking,
# so a command that runs a DIFFERENT script with a flag AND names update:preview
# as a later argument (`npm run --silent build update:preview`) now denies. That
# is fail-CLOSED on a command essentially nobody writes, and the plain
# no-flag form (`npm run build update:preview`) still ALLOWS — pinned both ways.
# INTERIOR REDIRECTS, 2026-09-07: both SEPARATOR slots here take `$_OUT_SEP` —
# the one before each flag word and the mandatory trailing one before the next
# real word. Two distinct bypasses, not one: the trailing slot covers
# `npm>/dev/null run update:preview` and `npm run 2>&1 update:preview`, and the
# flag-leading slot covers `npm >/dev/null --silent run update:preview`, which the
# trailing fix ALONE still allowed (the flag group demands `-` right after its
# whitespace, so a redirect before a FLAG kept the whole run from matching).
# Both build the real OTA-publish argv.
#
# THE FLAG-VALUE SUB-GROUP TAKES THE ABSORBER TOO (2026-09-07, security review).
# An earlier revision of this comment declined that slot: "it separates a flag
# from its VALUE, not two required-adjacent command words, so it is not this
# absorber's job." That reasoned about the slot's SEMANTICS and never measured
# its EFFECT, and the effect was a live bypass of exactly the incident class this
# check exists for:
#
#   npm --loglevel silent run update:preview        -> DENY
#   npm --loglevel 2>&1 silent run update:preview   -> ALLOWED
#
# Both build the identical real argv (`npm --loglevel silent run update:preview`,
# confirmed with a PATH-shadowed argv stub) -- an OTA publish to real users. The
# mechanism needs a VALUE-TAKING flag: `npm --silent 2>&1 run update:preview`
# correctly DENIES, because a boolean flag lets the value sub-group absorb the
# redirect as its optional value. That control is what makes this precise rather
# than a guess, and it is pinned below.
#
# Deny-shaped, so the widening is monotone: `$_OUT_SEP` at zero iterations is
# byte-identical to the `[[:space:]]+` it replaces, so only redirect-bearing
# commands can change decision, and this check's only outcome is `deny`.
#
# Single-quoted so that the LITERAL TEXT `$_OUT_SEP` never survives into the
# pattern: each occurrence is expanded at assignment time and spliced between the
# single-quoted fragments. It is defined above (below the lib source), which is
# what makes that legal here.
_OUT_FLAG_RUN='('"$_OUT_SEP"'-{1,2}[^[:space:]]*('"$_OUT_SEP"'[^-[:space:]][^[:space:]]*)?)*'"$_OUT_SEP"
if grep -Eqi "${_OUT_POS_PREFIX}(npm|pnpm|yarn)${_OUT_FLAG_RUN}(run-script|run)${_OUT_FLAG_RUN}update:(preview|production)${_OUT_POS_SUFFIX}" <<< "$WORDS_SCAN" \
   || grep -Eqi "${_OUT_POS_PREFIX}(yarn|pnpm)${_OUT_FLAG_RUN}update:(preview|production)${_OUT_POS_SUFFIX}" <<< "$WORDS_SCAN"; then
  deny "guard-outward-cli: command-position 'npm run update:preview/update:production' (and the yarn/pnpm bare-script equivalents) execs 'eas update --branch preview|production --platform all' against the production domain — a real OTA to real users, the exact class of the 2026-08-16 incident. Every OTHER 'npm run <script>' is unaffected. Bypass: ALLOW_OUTWARD_CLI=1 npm run update:preview -- --message \"...\" (one command)."
fi

# --- narrow deny: a gated binary whose VERB is not literal text --------------
# Ruled 2026-09-03, option (c). This guard is a static-text matcher, but the
# shell produces the real token at expansion time, so a synthesized verb is
# invisible to EVERY rendering above -- not hidden by a boundary (finding
# A/B/C1) and not split by a vanishing sigil (Task 7), simply ABSENT until the
# shell builds it. Two shapes, both requiring the outward-facing smell to be
# present ALREADY:
#   (a) a gated BINARY in command position immediately followed by an
#       expansion where the verb belongs (`eas ${v:-update}`);
#   (b) an expansion in command position immediately followed by a gated VERB
#       (`${e:-eas} update`).
# A bare expansion in command position is NOT denied (`${EDITOR:-vim} notes`),
# and neither is an expansion in ARGUMENT position (`gh pr view ${NUM:-42}`).
# That narrowing is the deliverable -- the ruling is explicit that where the
# line falls was left to this implementation, not settled by the ruling.
#
# NEVER EVALUATES THE EXPANSION. Both sibling todos rule that mechanism out;
# executing attacker-supplied text to decide whether to block it would itself
# be the vulnerability.
#
# PLACEMENT IS LOAD-BEARING, not cosmetic. This block sits AFTER every
# eas/railway/npm boolean matcher and BEFORE the gh pr merge block, because
# two Task 7 constructions (`npm ${FLAGS} publish`, `railway ${X} up`) match
# shape (a) as well as their own family's check. Placed any earlier it would
# fire first and STEAL their deny reason, turning the assertions that pin
# those families into decorations -- this repo's own
# docs/solutions/logic-errors/deny-reason-assertion-goes-stale-when-a-stricter-branch-fires-first-2026-09-03.md
# defect, which is why those two rows assert their family's reason string and
# would fail loudly if this block were moved up.
_OUT_EXPANSION_TOKEN='(\$\{[^}]*\}|\$\([^)]*\)|`[^`]*`|\$[A-Za-z_][A-Za-z0-9_]*)'
_OUT_GATED_BIN='(eas|railway|npm|pnpm|yarn|gh)'
_OUT_GATED_VERB='(update|publish|submit|build|up|deploy|redeploy|restart|down|delete|remove|rm|run|pr|release|repo|api)'
if grep -Eq "${_OUT_POS_PREFIX}${_OUT_GATED_BIN}${_OUT_SEP}${_OUT_EXPANSION_TOKEN}" <<< "$WORDS_SCAN" \
   || grep -Eq "${_OUT_POS_PREFIX}${_OUT_GATED_BIN}${_OUT_SEP}pr${_OUT_SEP}${_OUT_EXPANSION_TOKEN}" <<< "$WORDS_SCAN" \
   || grep -Eq "${_OUT_POS_PREFIX}${_OUT_EXPANSION_TOKEN}${_OUT_SEP}${_OUT_GATED_VERB}([[:space:]]|$)" <<< "$WORDS_SCAN"; then
  deny "guard-outward-cli: an outward-facing CLI is named in command position but the verb is not literal text (an expansion or substitution supplies it), so this hook cannot tell a read-only call from a mutating one — denying, per the 2026-09-03 narrow-deny ruling. A literal verb is unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi

# --- gh: bare 'gh pr merge' (see the --auto/--admin carve-out in the header) -
GH_PR_MERGE_RE="${_OUT_POS_PREFIX}gh${_OUT_SEP}pr${_OUT_SEP}merge${_OUT_POS_SUFFIX}"
# The OCCURRENCE COUNT just below is counted on $WORDS_DEEP (so a merge hidden
# inside a live substitution is not silently invisible to this whole block);
# the CLAUSE extraction feeding the --auto carve-out further down deliberately
# stays on plain $WORDS instead — see that assignment's own comment for why
# the two must diverge. $WORDS's one-quoted-span-is-one-word property is what
# makes the carve-out check safe: `-b "use --auto next time"` renders as the
# single token `usex--autoxnextxtime`, which is not `--auto`, so a quoted
# decoy cannot grant the carve-out. Reading $BARE here
# instead would make `gh pr "merge" 42` invisible; an earlier revision counted on
# both and denied when they disagreed, which was strictly worse — equal counts do
# not prove the two renderings found the SAME occurrence
# (`gh pr merge"x" 42 --auto; gh pr "merge" 99` counts 1 in each, from different
# clauses, and read --auto out of the wrong one).
GH_PR_MERGE_OCCURRENCES=$(_out_max_count "$GH_PR_MERGE_RE")
if [ "${GH_PR_MERGE_OCCURRENCES:-0}" -gt 1 ]; then
  deny "guard-outward-cli: more than one command-position 'gh pr merge' occurrence — ambiguous, cannot verify each carries --auto. Denying is the safe direction for a deny gate. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
elif [ "${GH_PR_MERGE_OCCURRENCES:-0}" -eq 1 ]; then
  # `--repo`/`-R` retargets the merge at an ARBITRARY repository — the --auto
  # carve-out is scoped to THIS repo's own sanctioned automerge pipeline, which
  # never passes it. Checked FIRST so it wins regardless of --auto.
  if gh_pr_clause_has_repo 'merge'; then
    deny "guard-outward-cli: 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with the user's PAT — outside the --auto carve-out, which exists only for this repo's own /todo automerge pipeline (it never passes --repo). Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
  fi
  # DELIBERATELY reads plain $WORDS here, not $WORDS_DEEP, even though the
  # occurrence count just above is deep — this is the ONE grant-shaped read in
  # this file (HAS_REAL_AUTO below GRANTS the carve-out on a real --auto, it
  # does not just add a deny), and cmd_words_deep's own header documents why a
  # grant-shaped check must never read it: a decoy substitution manufacturing
  # `--auto` as an unrelated invocation's own token must never be read as
  # satisfying THIS command's carve-out. Net effect when the one counted
  # occurrence is itself hidden inside a substitution: CLAUSE comes back empty
  # (nothing on the shallow line matches "gh pr merge"), HAS_REAL_AUTO stays
  # "no", and the merge is denied — the safe direction, not a bypass. A
  # substitution-hidden `gh pr merge <n> --auto` (a genuinely self-contained,
  # really-executing invocation that DOES carry a real --auto) is therefore a
  # documented, conservative residual: denied rather than allowed, same as
  # every other "cannot verify --auto" case this check already denies today.
  #
  # MERGE RESOLUTION 2026-09-03 (integration of PR #910 with PR #912): both
  # PRs rewrote this CLAUSE line. They AGREE on the source (`$WORDS`, shallow
  # — for the grant-shaped reason documented immediately above, which PR #910
  # did not change) and differ only in the clause-cut suffix, where PR #910's
  # `_OUT_POS_SUFFIX_MERGE_CLAUSE` supersedes the older swallowing
  # `${_OUT_POS_SUFFIX}[^;&|]*` form. Both comment blocks are kept because
  # they document orthogonal properties of the same line: WHICH TEXT is
  # scanned (this block) vs. WHERE THE CAPTURED CLAUSE STOPS (the block
  # below). Contrast GH_API_CLAUSE further down, where the same two PRs
  # collided on BOTH axes and the resolution had to combine them.
  # `_OUT_POS_SUFFIX` closes the 'merge' match here. It gained `{`/`}` as
  # closers on 2026-09-02 (previously it did not) — the same two closers the
  # lib's `_CMD_POS_SUFFIX` already had (see the COMMAND-POSITION ANCHORS
  # header near the top of this file). `{`/`}` are a REAL bypass here, not
  # the cosmetic gap an earlier version of this comment claimed: a COMMA-form
  # brace span glued to a verb (`merge{,x}`) is real bash brace EXPANSION —
  # `merge{,x}` expands to the two separate words `merge` and `mergex`,
  # placing a standalone, real `merge` token in command position — while a
  # NO-comma/NO-range span (`merge{x}`) genuinely stays one bash WORD and was
  # never the issue FOR BASH'S OWN word-splitting; the earlier version of
  # this comment tested only that case and wrongly generalized "inert" to
  # both. CORRECTION (2026-09-02, round 2): that "never the issue" framing is
  # true of bash, but NOT of the regex shipped here — `_OUT_POS_SUFFIX` makes
  # no comma/no-comma distinction, so ANY literal `{` glued to `merge` is now
  # an unconditional boundary and DENIES, comma or not (`gh pr merge{x} 42`
  # and `gh pr merge{1..3} 42` both deny, verified directly against the
  # hook). That is deliberate conservatism (a DENY-only anchor can only ever
  # ADD matches, see below), not a security regression — but the code does
  # not preserve the bash-level distinction this comment originally implied
  # it did. Confirmed live before the fix: `gh pr merge{,x} 42` was SILENTLY
  # ALLOWED where the bare/spaced form correctly denies (same bypass
  # reproduced at the `eas update`, `npm publish`, `railway up`, `eas build
  # --auto-submit` call sites, and at GH_API_RE, the gh-api occurrence
  # counter — six sites, not "every `_OUT_POS_SUFFIX`-gated check" as an
  # earlier version of this comment claimed). CORRECTION (2026-09-02, round
  # 2): that completeness claim was also false — GH_API_CLAUSE, the gh-api
  # CLAUSE-CUT gating the same mutating-HTTP-method check a few lines below
  # GH_API_RE, kept a hardcoded literal space and was missed by this
  # widening (a detector widened without its sibling consumer — the same
  # class
  # docs/solutions/logic-errors/occurrence-ambiguity-guard-applied-selectively-not-uniformly-2026-08-17.md
  # already documents). Now fixed at that assignment (search this file for
  # `GH_API_CLAUSE=`); regression tests in test-guard-outward-cli.sh's
  # "2026-09-02 FIX (round 2)" block.
  # Two-sided regression test: test-guard-outward-cli.sh's "2026-09-02 FIX"
  # block (RED against the pre-fix suffix, GREEN after; a negative control
  # pins that a DIFFERENT, unrelated read-only verb glued the same no-comma
  # way still allows — that control tests verb identity, not the
  # comma/no-comma split, which the code does not preserve).
  #
  # Widening a single-character suffix alternation cannot shorten this
  # CLAUSE: the trailing `[^;&|]*` capture below is a SEPARATE class,
  # untouched by what `_OUT_POS_SUFFIX` itself matches, so this fix can only
  # ever ADD matches (extend which 'gh pr merge' SHAPES this pattern
  # recognizes at all), never truncate an already-matched clause —
  # differentially tested 2026-09-02 across 9 constructed shapes, no
  # truncation in any of them. This directly answers a PR #874
  # security-auditor finding, carried forward unverified by a prior version
  # of this comment (per the todo that corrected it:
  # todos/archive/P3-2026-08-28-cmd-pos-anchor-widening-stale-comments.md),
  # that widening this suffix would TRUNCATE the CLAUSE before a real --auto
  # is reached — that specific mechanism could not be reproduced and is
  # understood to be structurally impossible for this pattern shape, which is
  # exactly what makes this fix safe. See
  # docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md's
  # Prevention section for the broader "two anchors that widened together are
  # not automatically the same anchor" rule this residual disagreement is one
  # instance of.
  #
  #   `<`/`>` are REAL bash redirect operators and DO split a glued verb into
  #   its own word (verified: a verb glued to a redirect word-splits exactly
  #   like the spaced form). Their absence from `_OUT_POS_SUFFIX` WAS a LIVE
  #   bypass of this hook, not a cosmetic gap — confirmed directly: a
  #   redirect glued onto 'gh pr merge' was SILENTLY ALLOWED here where the
  #   spaced/bare form correctly denied.
  #
  #   STRENGTHENED 2026-09-02 (round 3): re-verified against THIS clause
  #   specifically, and the severity was worse than "silently allowed where
  #   the spaced form denies" states — it was a TOTAL detection failure, not
  #   merely a clause-capture issue. `gh pr merge>log` (no `--auto` at all,
  #   no decoy, nothing to find) was silently ALLOWED, because `>` right
  #   after `merge` made GH_MERGE_RE itself fail to match — the whole `gh
  #   pr merge` check block never ran, CLAUSE was never even computed. This
  #   was a DIFFERENT root cause from the round-3 swallowing-clause fix just
  #   below (that one computed a wrong CLAUSE from a valid match; this one
  #   never got a match at all).
  #
  #   FIXED 2026-09-05 (outward-CLI-guard-folded-repair, finding A):
  #   `_OUT_POS_SUFFIX` now includes `<`/`>` in its closer alternation, so
  #   GH_MERGE_RE now matches `gh pr merge>log` at all. `_OUT_POS_SUFFIX_MERGE_CLAUSE`'s
  #   branch 2 (the positive closer class) also carries `<`/`>`, so the
  #   CLAUSE cut recognizes the `>` right after `merge` as a valid closer
  #   too (branch 1, the negated clause-cut class, never engages for this
  #   bare shape — the character right after `merge` is `>`, not a space,
  #   so branch 1's space-anchored alternative does not apply here at all).
  #   `gh pr merge>log` (bare, no decoy) now DENIES; regression tests in
  #   test-guard-outward-cli.sh's "2026-09-05: finding A" block.
  #   ROUND 2 (2026-09-05, same repair, after a CRITICAL security review):
  #   branch 1's OWN `<`/`>` addition — a SEPARATE change from the two
  #   above, needed only for a DIFFERENT shape (`gh pr merge 42
  #   --auto>/dev/null`, a redirect glued to a LATER flag inside the
  #   clause, not to the verb itself) — was REVERTED after it was found to
  #   also truncate the CLAUSE ahead of a later `$`-bearing sigil
  #   (`gh pr merge 42 --auto >anyfile ${x:---admin}`), hiding the `$` from
  #   the unverifiability guard just below and silently allowing a real
  #   administrator-override merge. See the ACCEPTED OVER-DENIAL residual
  #   in the COMMAND-POSITION ANCHORS header above for the full account;
  #   branch 1 is narrow again as of ROUND 2 and this bare-shape fix
  #   (which never depended on branch 1) is unaffected.
  #   The `_OUT_POS_PREFIX` leading-redirect gap noted in the
  #   COMMAND-POSITION ANCHORS header above was a SEPARATE mechanism (this fix
  #   only closed the trailing/suffix side) — FIXED SEPARATELY 2026-09-05
  #   (outward-CLI-guard-folded-repair, finding B; see the DOCUMENTED
  #   RESIDUALS section's "leading:" bullet for the full account, including a
  #   new accepted over-denial that fix introduces: a leading redirect that
  #   itself carries a `$` now also trips this file's `printf '%s' "$CLAUSE"
  #   | grep -qF '$'` unverifiability check, because the absorbed prefix is
  #   part of this CLAUSE capture).
  #
  # FIXED 2026-09-02 (round 3, PR #910 post-merge review): this used to read
  # `${_OUT_POS_SUFFIX}[^;&|]*` — a SWALLOWING pattern that consumes the
  # boundary character and keeps capturing past it regardless of what that
  # boundary was. That is correct when the boundary is whitespace (more of
  # the SAME clause follows), but when `merge` is glued DIRECTLY to a hard
  # separator with no argument in between — `gh pr merge;curl --auto`,
  # `gh pr merge&curl --auto`, `gh pr merge|curl --auto`, `$(gh pr
  # merge)curl --auto` (a close-paren closing the `$(...)` the verb sits
  # inside) — the suffix consumed the separator itself and
  # `[^;&|]*` then captured straight into the UNRELATED following command,
  # picking up its `--auto` as a DECOY. Because this is the ONE
  # `_OUT_POS_SUFFIX`-family clause-cut whose downstream check decides an
  # ALLOW on flag presence (every sibling — `GH_API_CLAUSE`,
  # `gh_pr_clause_has_repo` — DENIES on presence, so their over-capture can
  # only ever ADD a deny), this was a working FALSE ALLOW of an immediate,
  # non-automerge `gh pr merge` — exactly what this check exists to block.
  # Confirmed silently ALLOWED before this fix for all four forms above —
  # three glued hard separators plus the `$(...)` close-paren, a
  # structurally different construct sharing only the boundary CHARACTER
  # class, not the "two commands glued together" mechanism (construct-and-
  # run, not regex-reading); confirmed a real,
  # sanctioned `gh pr merge 42 --auto` still allows and `gh pr merge
  # 42;curl --auto` (an arg token between verb and separator) still
  # correctly denied both before and after — that shape was never affected.
  # Fixed with `_OUT_POS_SUFFIX_MERGE_CLAUSE` (defined next to
  # `_OUT_POS_SUFFIX` above): captures further clause text ONLY after a
  # whitespace boundary; a hard separator/bracket or end-of-string ends the
  # clause immediately with nothing captured past it. Two-sided regression
  # test: test-guard-outward-cli.sh's "2026-09-02 FIX (round 3)" block.
  CLAUSE=$(printf '%s' "$WORDS" | grep -oiE "${_OUT_POS_PREFIX}gh${_OUT_SEP}pr${_OUT_SEP}merge${_OUT_POS_SUFFIX_MERGE_CLAUSE}" | head -1)
  # A naive "--auto present" substring check is bypassable: several of `gh pr
  # merge`'s own flags (and the cross-subcommand --repo/-R every gh command
  # accepts) are VALUE-TAKING, so the token immediately after one of them is
  # consumed as its VALUE, not read as a separate flag — `gh pr merge 42
  # --body --auto` merges IMMEDIATELY, with "--auto" as the commit body text;
  # gh never sees a real --auto flag. Reuse the exact value-flag set
  # lib/cmd-detect.sh's own cmd_gh_pr_ref already established for this
  # subcommand family (derived against `gh pr merge|close|edit --help`,
  # deliberately kept as the FULL merge|close|edit union rather than a
  # merge-only subset — over-inclusion here only tightens the check, it
  # cannot create a bypass) and reject an --auto match whose PRECEDING
  # token is one of them.
  GH_MERGE_VALUE_FLAGS='^(--author-email|--body-file|--body|--match-head-commit|--subject|--comment|--add-assignee|--add-label|--add-project|--add-reviewer|--base|--milestone|--remove-assignee|--remove-label|--remove-project|--remove-reviewer|--title|--repo|-A|-b|-F|-t|-c|-B|-R)$'
  # CLAUSE's "one quoted span = one word" invariant — the premise the --auto
  # scan below depends on — is FALSE when a quoted VALUE contains its own
  # internal quoting: `-b "$(printf %s "AAA "--auto" BBB")"` renders (via
  # unmodified cmd_words, which tracks quote state as ONE flat toggle with no
  # concept that $(...) opens an independent quoting namespace in real bash)
  # as `-b $xprintfx%sxAAA --auto BBBx` — the internal `"..."` pairs flip that
  # flat toggle back to "unquoted" mid-span, so the literal spaces around
  # --auto survive as REAL word boundaries, manufacturing a free-standing
  # --auto token that is NOT a real argv word (confirmed: `gh(){ for a in
  # "$@"; do echo "[$a]"; done; }` on the identical string shows the whole
  # thing as ONE argv element, "AAA --auto BBB", with no standalone --auto —
  # bug found by security review, 2026-09-02). Detecting the general case
  # exactly is out of scope for this fix (it needs cmd_words itself to become
  # nesting-aware, a materially larger change than this todo's Scope
  # Contract's narrow substitution-liveness fix) — so, matching this whole
  # check's existing "cannot verify -> deny" default, ANY literal `$`
  # surviving in CLAUSE (a legitimate `"$MESSAGE"` variable reference renders
  # the identical way, since cmd_words never touches a bare `$` either) makes
  # --auto unverifiable and denies, rather than trusting a token boundary that
  # may not correspond to a real one. Over-broad in the safe direction: a
  # real, uncorrupted --auto with a co-occurring unrelated $VAR mention
  # elsewhere in the same clause now also denies, in exchange for closing the
  # forged-token bypass. Pinned in test-guard-outward-cli.sh.
  if printf '%s' "$CLAUSE" | grep -qF '$'; then
    HAS_REAL_AUTO=no
  else
    HAS_REAL_AUTO=$(awk -v flags="$GH_MERGE_VALUE_FLAGS" '
      { prev = ""
        for (i = 1; i <= NF; i++) {
          if ($i == "--auto" && prev !~ flags) { print "yes"; exit }
          prev = $i
        }
      }' <<< "$CLAUSE")
  fi
  if [ "$HAS_REAL_AUTO" != "yes" ]; then
    deny "guard-outward-cli: command-position 'gh pr merge' without a REAL --auto flag merges a PR immediately. A '--auto' token consumed as the VALUE of a preceding value-taking flag (--body/-b, --body-file/-F, --subject/-t, --author-email/-A, --match-head-commit/-c, --repo/-R, ...) does not count as --auto. 'gh pr merge --auto ...' (this repo's sanctioned /todo automerge mechanism) stays allowed — branch protection still gates the actual merge. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
  fi
  # --admin ("use administrator privileges to merge a PR that does not meet
  # requirements") contradicts the --auto carve-out's own premise (that branch
  # protection still gates the merge) — deny regardless of --auto. A
  # false-positive deny here (--admin appearing only as some OTHER flag's
  # value, or mentioned in an unrelated clause) is the safe direction, so no
  # value-flag predecessor check or clause-scoping is needed the way --auto's
  # decoy check above needs one: this check can only ever ADD a deny, never
  # grant a carve-out. DELIBERATELY avoids $BARE/$CLAUSE (see below for which
  # renderings it scans instead): `--admin` is a genuine, functioning argv
  # token whether or not the shell quoted it (quotes affect word-splitting,
  # not what gh actually receives —
  # `gh pr merge 42 --auto "--admin"` passes the literal string `--admin`,
  # identically to the unquoted form), so relying on cmd_bare here — which
  # deliberately blanks quoted CONTENT to avoid false-positiving on a quoted
  # MENTION elsewhere in this hook — would make a quoted --admin invisible
  # and silently grant the very carve-out this check exists to deny (found in
  # review round 2: `gh pr merge 42 --auto "--admin"` and
  # `gh pr merge 42 --auto --admin=true` both slipped past a $CLAUSE-based
  # whitespace-only check). The boundary class is "not a word/dash character"
  # rather than strictly whitespace, so it also catches `--admin=true`,
  # `--admin=1`, and a trailing quote/comma/etc.
  # Flag scan via scan_renderings — see its definition for why all four renderings are read
  # and why they must stay newline-joined (this check is the seam example there).
  # Leading boundary is `_OUT_FLAG_LEAD` (see its own definition) so a
  # default-value expansion (`${x:---admin}`) cannot donate the flag's
  # boundary.
  #
  # CORRECTED 2026-09-06 (security review of PR #926, finding C4). This comment
  # used to say the check was "NOT independently regression-tested on this
  # family", on the reasoning that any literal `$` in CLAUSE already denies
  # earlier at the "without a REAL --auto flag" check, so no assertion here
  # could pin anything. That reasoning holds ONLY for `$`-carrying spellings.
  # An empty BACKTICK pair carries no `$` at all: `gh pr merge 42 --auto
  # --ad``min` sailed past the `$`-mask, reached this line with `--admin`
  # invisible to both $CMD and $WORDS, and was ALLOWED — an effective GRANT of
  # an administrator merge that bypasses branch protection, since the --auto
  # carve-out then proceeded. This check IS now independently pinned, by
  # test-guard-outward-cli.sh's "C4: --admin split by an empty backtick pair"
  # assertion, which fails on the pre-fix tree and passes here with THIS
  # check's own reason string.
  #
  # The `${UNSET}` spelling still denies for "without a REAL --auto flag"
  # instead — correct decision, wrong attribution. Recorded as an attribution
  # residual in this file's DOCUMENTED RESIDUALS block rather than fixed by
  # reordering, which would move this file's most heavily pinned branch and
  # needs its own mutation evidence.
  if scan_renderings "${_OUT_FLAG_LEAD}"'--admin([^-A-Za-z0-9]|$)'; then
    deny "guard-outward-cli: command-position 'gh pr merge --admin' uses administrator privileges to merge a PR that may not meet requirements — this contradicts the --auto carve-out's premise (branch protection gating). Denying regardless of --auto. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
  fi
fi

# --- gh: other mutating subcommands (pr create/comment allowed only without
#     --repo/-R, see the header) -------------------------------------------
GH_MUTATING_RE="${_OUT_POS_PREFIX}gh${_OUT_SEP}(pr${_OUT_SEP}(close|edit|ready|reopen|review|lock|unlock|update-branch|revert)|release${_OUT_SEP}(create|delete|delete-asset|edit|upload)|repo${_OUT_SEP}(create|delete|archive|unarchive|edit|rename|sync|fork))${_OUT_POS_SUFFIX}"
if grep -Eqi "$GH_MUTATING_RE" <<< "$WORDS_SCAN"; then
  deny "guard-outward-cli: command-position mutating 'gh pr/release/repo' subcommand. Read-only forms (gh pr view/checks/list, gh release view/list, gh repo view/list, ...) are unaffected; gh pr create/comment are deliberately allowed (routine PR workflow) unless retargeted with --repo/-R. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi

# --- gh pr create/comment: routine carve-out, but NOT at another repo --------
# `--repo`/`-R` turns the routine carve-out into unbounded egress to an
# arbitrary GitHub repository with the user's PAT (`gh pr comment --repo
# other/org --body "$(cat .env)"` was ALLOWED, review round 3). Same treatment
# lib/cmd-detect.sh:242 already gives the flag, and this repo's own PR flow
# never passes it. Clause-scoped $WORDS_DEEP flag scan — see gh_pr_clause_has_repo.
#
# COUNTED, matching the gh pr merge treatment above (review round 4,
# 2026-08-17): gh_pr_clause_has_repo's `head -1` only ever inspects the FIRST
# create/comment clause, and unlike `merge` this family had no occurrence-
# count backstop of its own — a benign first clause let a malicious second
# clause's --repo/-R sail through unexamined (`gh pr create --fill && gh pr
# create --repo other/org --title x` was ALLOWED). Deny outright on >1
# occurrence rather than guess which clause to inspect.
GH_PR_CREATE_RE="${_OUT_POS_PREFIX}gh${_OUT_SEP}pr${_OUT_SEP}(create|comment)${_OUT_POS_SUFFIX}"
GH_PR_CREATE_OCCURRENCES=$(_out_max_count "$GH_PR_CREATE_RE")
if [ "${GH_PR_CREATE_OCCURRENCES:-0}" -gt 1 ]; then
  deny "guard-outward-cli: more than one command-position 'gh pr create/comment' occurrence — ambiguous, cannot verify each is free of --repo/-R. Denying is the safe direction for a deny gate. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
elif [ "${GH_PR_CREATE_OCCURRENCES:-0}" -eq 1 ] && gh_pr_clause_has_repo 'create|comment'; then
  deny "guard-outward-cli: 'gh pr create/comment' with --repo/-R writes to a DIFFERENT GitHub repository with the user's PAT — unbounded egress, outside the routine-workflow carve-out these two subcommands get. Without --repo/-R they stay allowed. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi

# --- gh api: mutating HTTP method -------------------------------------------
# `gh api` can invoke an ARBITRARY GitHub REST mutation, including the exact
# PR-merge action the dedicated clause above gates, via a different
# subcommand (`gh api -X PUT repos/.../pulls/42/merge`). Key the deny on the
# HTTP method, not the subcommand: this repo has legitimate READ-ONLY `gh
# api` usage (scripts/todo-automerge-guard.sh, .claude/skills/land/SKILL.md —
# both GET, gh api's own default with no -X/--method), which a blanket `gh
# api` deny would break.
# NOTE: this block reads $WORDS_DEEP throughout — occurrence count AND clause
# cut. It used to read $BARE, where a QUOTED method value (`gh api -X "POST"
# …`) was invisible because cmd_bare blanks quoted CONTENT; that was a
# documented residual and is now closed, since $WORDS_DEEP has already dropped
# the quote characters. Do NOT "fix" this by scanning raw $CMD: that was tried
# and it loses BOTH the command-position anchor and the separator
# neutralisation with it, so `echo "gh api docs" && gh api -X POST …` cut its
# clause from the decoy and `-f 'title=a|b'` truncated the clause at a quoted
# pipe — each an ALLOW on a production merge.
# DEEP, not shallow ($WORDS), is required here (unlike the `gh pr merge --auto`
# CLAUSE above): this block ALLOWS by default and only denies on affirmative
# evidence of a mutating method, so an EMPTY clause would silently ALLOW — the
# opposite failure mode from the merge block's "empty clause denies" shape. A
# `gh api -X POST …` hidden inside a live command substitution would have an
# empty clause on plain $WORDS and slip through undenied unless the clause
# cut, not just the occurrence count, also reads the deep union. Safe to
# widen regardless: this method scan is pure DENY-shaped (no flag here GRANTS
# anything), so it carries none of the grant-shaped hazard the CLAUSE comment
# above documents.
# More than one command-position `gh api` occurrence is ambiguous — the
# ORIGINAL round-2 version used `head -1` and silently ignored every
# occurrence after the first, which let a read-only first call shadow a
# mutating second one (`gh api repos/x/y && gh api -X PUT .../merge` was
# ALLOWED). Deny on >1, mirroring the identical multi-occurrence safe
# direction the `gh pr merge` check above already takes.
GH_API_RE="${_OUT_POS_PREFIX}gh${_OUT_SEP}api${_OUT_POS_SUFFIX}"
# Counted AND clause-scoped on $WORDS_DEEP (unlike the `gh pr merge` block
# above, whose CLAUSE stays shallow — see that block's own comment for why).
# This check ALLOWS by default (a read-only `gh api` is fine) and only denies
# once it reads a mutating method out of the clause, so a quoted command word
# (`gh "api" -X PUT …`) invisible to the rendering would fall through to ALLOW.
# Reading $WORDS_DEEP makes the quoted spellings AND a live-substitution-hidden
# occurrence visible, without resorting to raw $CMD, which would lose the
# command-position anchor and the separator neutralisation with it.
GH_API_OCCURRENCES=$(_out_max_count "$GH_API_RE")
if [ "${GH_API_OCCURRENCES:-0}" -gt 1 ]; then
  deny "guard-outward-cli: more than one command-position 'gh api' occurrence — ambiguous, cannot verify each is read-only. Denying is the safe direction for a deny gate. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
elif [ "${GH_API_OCCURRENCES:-0}" -eq 1 ]; then
  # Cut from $WORDS_DEEP, keeping the command-position ANCHOR and the
  # `[^;&|]*` clause bound. $WORDS_DEEP is what makes the quoted-flag-value
  # spellings visible WITHOUT resorting to raw $CMD: the quote characters are
  # already gone, so
  # `-X "PUT"` reads as `-X PUT` and `-X"PUT"` as `-XPUT`, both matched by the
  # existing pattern. An earlier revision scanned raw $CMD instead and lost both
  # the anchor and the separator-neutralisation with it — `echo "gh api docs" &&
  # gh api -X POST …` cut its clause from the decoy inside the echo, and
  # `-f 'title=a|b'` truncated the clause at a quoted pipe. Both ALLOWED a
  # production merge. Raw text is the right source for a flag check only when
  # the clause boundary does not also come from it (cf. the --admin check
  # below, which needs no clause).
  #
  # FIXED 2026-09-02 (round 2): this used to hardcode a literal
  # `[[:space:]]` after `api` instead of `${_OUT_POS_SUFFIX}`, unlike
  # GH_API_RE just above (the occurrence counter for this SAME check), which
  # was correctly migrated when `_OUT_POS_SUFFIX` gained `{`/`}` closers
  # (round 1, see the `gh pr merge` CLAUSE= comment above for the full
  # `{`/`}` story). Consequence: a comma-brace-glued `gh api{,x} -X POST
  # ...` counted as exactly one occurrence (GH_API_RE matched, using the
  # widened suffix) but this clause-cut then matched NOTHING (no literal
  # space after `api{,x}`), so $GH_API_CLAUSE was empty, the `-X`/`--method`
  # scan below short-circuited false, and the mutating-HTTP-method deny
  # never fired — SILENTLY ALLOWED before this fix (confirmed live, as was
  # the pre-existing backtick-glued form `gh api\`x\` -X POST ...`). Same
  # class as
  # docs/solutions/logic-errors/occurrence-ambiguity-guard-applied-selectively-not-uniformly-2026-08-17.md:
  # a detector widened without its sibling consumer. Two-sided regression
  # test: test-guard-outward-cli.sh's "2026-09-02 FIX (round 2)" block (RED
  # against the pre-fix literal-space clause regex, GREEN after).
  #
  # MERGE RESOLUTION 2026-09-03 (integration of PR #910 with PR #912): these
  # two PRs each changed THIS ONE LINE, on different axes, and neither side
  # alone is correct:
  #   - PR #912 changed the SOURCE `$WORDS` -> `$WORDS_DEEP` (deep
  #     substitution scan), which is what the unconflicted comment block
  #     immediately above already documents this cut as reading.
  #   - PR #910 changed the SUFFIX literal `[[:space:]]` -> `${_OUT_POS_SUFFIX}`
  #     (the round-2 fix described just above).
  # Taking PR #910's line verbatim would have silently reverted #912's deep
  # read while the comment above still claimed it; taking #912's line verbatim
  # would have silently reverted the `{`/`}` boundary fix and reopened the
  # confirmed-live `gh api{,x} -X POST` bypass. Both changes are kept. This is
  # safe for THIS clause specifically because it is DENY-shaped (over-capture
  # can only ever ADD a deny) — unlike the grant-shaped `gh pr merge` CLAUSE
  # above, which must stay on shallow `$WORDS` for the reason documented there.
  # THE CLAUSE BODY ADMITS AN fd-DUPLICATING `&` (2026-09-07, security review).
  # `[^;&|]*` excludes `&` because `&&` and a bare trailing `&` are COMMAND
  # SEPARATORS and must not be captured past. But `2>&1` carries a `&` that is
  # part of a REDIRECT, not a separator, so the body truncated mid-token and the
  # method never reached either check:
  #
  #   gh api repos/o/r -X DELETE        -> DENY
  #   gh api repos/o/r -X 2>&1 DELETE   -> ALLOWED   (clause cut at `2>`)
  #
  # Identical real argv, argv-stub confirmed. Widening the SEPARATOR at the
  # method check alone closed the `>/dev/null`, `>x` and `--method >x` spellings
  # but NOT these two, because the truncation happens earlier, here.
  #
  # THE ADMITTED SET IS THE `&`-BEARING REDIRECT OPERATORS, enumerated from the
  # grammar rather than from one operator family: `&[0-9-]`, `&[<>]` and `[<>]&`.
  # A bare `&` stays excluded, so `&&` and a backgrounding `& ` still end the
  # clause -- the false positive this exclusion exists to prevent, pinned with
  # its own control.
  #
  # THE FIRST VERSION ADMITTED ONLY `&[0-9-]` AND CLAIMED THE CLASS WAS CLOSED.
  # It was not. The redirect-both operators are redirects whose `&` is followed
  # by neither a digit nor `-`, so a mutating method behind one stayed ALLOWED
  # while the fd-duplicating spelling of the identical row denied. Deriving the
  # admission from ONE operator family instead of the grammar is the same defect
  # this file keeps paying for -- and note `_CMD_REDIR`, which `_OUT_SEP`
  # already interpolates, matches all three spellings: the SEPARATOR understood
  # them the whole time while the CLAUSE BODY did not. Exactly the detector/cut
  # asymmetry the block above warns about, reintroduced one line later.
  #
  # MEASURED 2026-09-10 (PR #939). What stood here claimed the appending
  # redirect-both spelling was UNMEASURED because it "is a syntax error on this
  # machine's bash 3.2, so no argv could be produced for it". THAT PREMISE WAS
  # NEVER TRUE OF THE THING IT GOVERNED. This hook is always launched as
  # `bash <this file>` to do TEXT ANALYSIS; it never executes the candidate. The
  # shell that executes the candidate -- and so decides whether an operator can
  # produce argv at all -- is the interactive shell, which here is zsh 5.9.
  # Reasoning about reachability from the hook's OWN interpreter was a category
  # error, and it is the reason the `|` family below went unnoticed for months.
  #
  # DO NOT restate this as "all three shells agree". They do not. On
  # REACHABILITY they disagree -- zsh 5.9 and bash 5.3.15 parse `&>>` and yield
  # the mutating argv; /bin/bash 3.2.57 syntax-errors on it and yields none. The
  # thing that IS invariant is EXTRACTION: the cut is `grep -oiE`, an external
  # binary, so which shell runs the hook cannot change what the regex matches.
  # Two different predicates; only the second is shell-independent.
  #
  # WHAT THE TAIL CLASS ADMITS. `&?[<>]+&?[|!]` -- a redirect operator that may
  # carry an fd-duplicating `&` on EITHER side, and either of the two trailing
  # modifiers zsh has: `|` (clobber-override) and `!` (its exact synonym). The
  # class it replaced ended with `|` excluded, so `>|`, `>>|`, `&>|`, `&>>|` and
  # `N>|` cut the clause AT the operator, the method / `--repo` flag was never
  # reached, and BOTH checks fell through to allow-by-default. Measured as a
  # SILENT ALLOW against a `&>`-spelled control that denied, with argv
  # byte-identical to that control -- a live path to arbitrary REST mutation and
  # cross-repo PAT egress.
  #
  # THE FIRST ATTEMPT AT THIS FIX WROTE `&?[<>]+[|!]` AND CLAIMED, IN THIS VERY
  # COMMENT, TO BE "KEYED ON THE GRAMMAR, NOT A FAMILY". It was not. Putting the
  # optional `&` only BEFORE the operator expressed half the family; `>&|`,
  # `>>&|`, `N>&|` and `N>>&|` stayed ALLOWED. That was the fourth consecutive
  # extension of this class to close one half and read as closed, and the third
  # to say so in a comment. Read that as the file's actual failure mode, not as
  # history: the claim of completeness has been wrong every time it was made.
  #
  # AND THE TAIL CLASS IS NOT THE ONLY GRAMMAR. `_CMD_REDIR` (lib/cmd-detect.sh)
  # backs the -X/--method redirect-skip, and its trailing class was `[&|]?` --
  # exactly ONE of `&` or `|` -- so it could not express `>&|` at all, and its fd
  # prefix `([0-9]*|&)` could not express zsh's NAMED descriptors (`{n}>out`,
  # `{fd}&>out`). Widening either grammar ALONE leaves the other's spellings
  # live. Both were proven load-bearing by mutation: reverting _CMD_REDIR alone
  # reopens 9 corpus rows, reverting the tail class's `&`-after alone reopens 8.
  #
  # `!` IS COVERED TWICE, AND THAT IS WHY THESE ROWS ARE WEAKER THAN A
  # PREVIOUS VERSION OF THIS COMMENT CLAIMED. It is matched by the new
  # alternative AND, independently, by the co-resident `[^;&|]` branch accepting
  # it as an ordinary character. So narrowing the new alternative alone --
  # including a wholesale swap to `_CMD_REDIR`'s grammar, whose own target class
  # `[^[:space:];&|)`]+` also accepts `!` -- leaves c9-bang-* GREEN. MEASURED:
  # that exact mutation was constructed and the corpus passed unchanged.
  # What those rows DO catch is the SIMULTANEOUS narrowing of both branches
  # (`[|!]`->`[|]` together with `[^;&|]`->`[^;&|!]`), which reopens FIVE rows,
  # not the three an earlier draft said "exactly": c9-bang-api, c9-bang-comment,
  # c9-bangboth-api, and also c1g-barebang-lit and c1g-ind-lit, whose `!` is an
  # INDIRECT-EXPANSION sigil consumed by the same `[^;&|]` branch. The word
  # "exactly" was wrong in a sentence whose whole purpose was correcting an
  # overclaim about these rows. State the guarantee at its real strength.
  #
  # RESIDUAL, STATED AS A BOUND AND NOT AS A PROOF. This is still an ENUMERATION
  # of operator shapes, not a parse of zsh's redirect grammar -- and round 3
  # proved that costs more than tidiness. The `{name}` fd prefix admitted here
  # was written GLUED to the operator; zsh binds a `{name}` prefix ACROSS
  # whitespace (a numeric one does not), so one space defeated the entire
  # admission on every path, for every gated binary. Whitespace tolerance now
  # lives INSIDE the `{name}` alternative; row c9-numfd-bind pins the boundary
  # that stops it being hoisted. What was actually measured after the fix: `<>`, `>&-`, `2>&-`, `{n}>&-`, `<<<`, `2>&1-`,
  # `{n}<>` and `&>>|` all DENY, and process substitution DENIES in every
  # placement that leaves `-X DELETE` intact (`>(cat)` binding to `-X` itself
  # correctly ALLOWS -- there the method really is the /dev/fd path, not DELETE,
  # which is also why row c9-nfd-bind is pinned ALLOW). That is a BOUNDED PROBE
  # of the forms someone thought to try, which is exactly what the four previous
  # "closed" claims also were. Do not upgrade it to closure.
  #
  # The honest next step, if a fifth extension is ever needed here, is a
  # tokenizer over zsh redirect syntax rather than a sixth alternative. The whole
  # family is pinned in repro-outward-cli-corpus.sh (axis c9) -- the REQUIRED
  # check -- so a silent revert trips CI rather than a local test.
  #
  # Monotone -- but state the consumers exhaustively, because an UNNAMED consumer
  # of a widened value is the precise shape that produced this PR's CRITICAL.
  # There are THREE, not the two an earlier draft of this comment named:
  #   1. the mutating-method check below            -- deny-shaped
  #   2. the unreadable-method check below          -- deny-shaped
  #   3. the equality dedup at the CLAUSE_VANISHED / CLAUSE_BLIND assignments,
  #      which BLANKS a rendering whose clause equals DEEP's, after which
  #      `[ -n "$GH_API_CLAUSE" ] || continue` SKIPS it. That one can REMOVE a
  #      check, so "deny-shaped" is not an argument about it.
  # (3) is safe, and the reason is worth writing down rather than assuming: this
  # widening only ever EXTENDS a clause that was already being cut, and the
  # extension is a function of the same input text, so two renderings whose
  # clauses differed before cannot become equal after -- unequal prefixes stay
  # unequal when both are extended by their own suffixes. A rendering that was
  # previously checked therefore cannot newly collapse into DEEP and vanish.
  _GH_API_CUT="${_OUT_POS_PREFIX}gh${_OUT_SEP}api${_OUT_POS_SUFFIX}([^;&|]|&[0-9-]|&[<>]|[<>]&|&?[<>]+&?[|!])*"
  GH_API_CLAUSE_DEEP=$(printf '%s' "$WORDS_DEEP" | grep -oiE "$_GH_API_CUT" | head -1)
  # ADDED 2026-09-05 (vanishing sigil, Task 7): the occurrence count above is
  # now a MAXIMUM across all three renderings, so it can be 1 because the VANISHED
  # rendering saw a split verb (`gh a${UNSET}pi ...`) that WORDS_DEEP cannot
  # see. In exactly that case the cut just above yields an EMPTY clause — and
  # this block ALLOWS by default on an empty clause (unlike the `gh pr merge`
  # CLAUSE, which denies by default), so the deny would fall straight through
  # and the raised count would buy nothing. Retry the identical cut on the
  # vanished rendering. This is the "widen the detector AND its consumers in
  # ONE change" rule that
  # docs/solutions/logic-errors/occurrence-ambiguity-guard-applied-selectively-not-uniformly-2026-08-17.md
  # exists for: GH_API_RE (via _out_max_count) and this cut are a
  # detector/consumer pair and must move together.
  #
  # FIXED 2026-09-06 (security review of PR #926, findings C2 and C3). This was
  # written as "deep, ELSE vanished", gated `if [ -z "$GH_API_CLAUSE" ]`, and
  # justified with "over-capture can only ever ADD a deny, the same argument the
  # WORDS_DEEP cut above already rests on". THAT TRANSFER IS INVALID and it cost
  # two live bypasses. cmd_words_deep APPENDS text, so a wider rendering really
  # can only add matches. cmd_words_vanished DELETES spans — and both checks
  # below trigger on the PRESENCE of a token in this clause (a method FLAG, then
  # either a `$`/backtick or a literal POST/PUT/PATCH/DELETE). Deleting text
  # DISARMS a presence check. Two distinct measured ALLOWs:
  #   C2  `gh a${UNSET}pi repos/o/r -X ${METHOD}` — the deep cut is empty (split
  #       verb) so the fallback ran, but the SAME deletion that rejoined `api`
  #       also deleted `${METHOD}`, erasing the very `$` the unreadable-method
  #       check keys on. Controls prove it is the COMBINATION: `gh api ... -X
  #       ${METHOD}` denies (the check works) and `gh a${UNSET}pi ... -X POST`
  #       denies (the cut works). Only together did they cancel.
  #   C3  `gh api repos/o/r -${UNSET}X POST` and `--met${UNSET}hod POST` — a
  #       LITERAL verb, so the deep cut was non-empty and the vanished cut never
  #       ran at all, even though it holds exactly `gh api repos/o/r -X POST`.
  #
  # THE RULE: a SUBTRACTIVE rendering is UNIONED IN, never SUBSTITUTED FOR, the
  # deep one — see gh_pr_clause_has_repo's own note, which fixes the same defect
  # at the --repo site. Both cuts are computed unconditionally and BOTH checks
  # below run against EACH, inside one loop. The loop is what keeps each check's
  # internal conjunction ("a method flag AND something unreadable") scoped to a
  # SINGLE rendering: newline-joining the two clauses into one string would let
  # the flag come from one rendering and the `$` from the other, denying on a
  # combination present in neither — the seam-forging hazard scan_renderings
  # documents. deny() exits, so no input can be denied twice.
  GH_API_CLAUSE_VANISHED=$(printf '%s' "$WORDS_VANISHED" | grep -oiE "$_GH_API_CUT" | head -1)
  [ "$GH_API_CLAUSE_VANISHED" = "$GH_API_CLAUSE_DEEP" ] && GH_API_CLAUSE_VANISHED=""
  # The paren-BLIND vanishing rendering is a third cut for the same reason the
  # vanished one is a second: it is the only rendering that survives a `(` inside
  # a shell comment, where the paren-counting pass returns nothing at all. It is
  # span-derived exactly like the vanished cut, so it carries the same marker.
  # De-duplicated against BOTH earlier cuts so the common case still costs one pass.
  GH_API_CLAUSE_BLIND=$(printf '%s' "$WORDS_VANISHED_BLIND" | grep -oiE "$_GH_API_CUT" | head -1)
  { [ "$GH_API_CLAUSE_BLIND" = "$GH_API_CLAUSE_DEEP" ] || \
    [ "$GH_API_CLAUSE_BLIND" = "$GH_API_CLAUSE_VANISHED" ]; } && GH_API_CLAUSE_BLIND=""
  # BOTH checks below run once per rendering (the empty entry is skipped, and an
  # identical vanished cut was blanked just above so the common case still costs
  # one pass). $GH_API_CLAUSE is the loop variable; nothing after `done` reads
  # it.
  #
  # $_GH_API_SPAN_DERIVED marks the vanished pass, and it is what actually
  # closes C2 — the union alone does NOT. C3's two spellings were "the guard
  # computed the answer and discarded it", which unioning fixes. C2 is a
  # different shape: for `gh a${UNSET}pi repos/o/r -X ${METHOD}`, NEITHER
  # rendering ever holds both halves of the evidence. The deep cut is empty
  # (the verb is split), and the one deletion that rejoins `api` in the vanished
  # cut ALSO deletes `${METHOD}`, so the surviving clause is a clean, literal
  # `gh api repos/o/r -X ` with no sigil left to find. Reading both renderings
  # and OR-ing still ALLOWS it.
  #
  # The resolution is that a clause which exists ONLY in the vanished rendering
  # is ITSELF the missing evidence: it could not have been reconstructed without
  # deleting an expansion from this command, so its text is unverifiable by
  # construction — precisely the condition the literal-`$` test exists to detect,
  # just detected structurally instead of by a surviving character. Gated on a
  # method flag exactly as the `$` test is, so the documented narrowing holds:
  # a split-verb READ (`gh a${UNSET}pi repos/o/r`, `--jq`, `--paginate`, a
  # dynamic route) has no method flag and stays allowed.
  for _GH_API_WHICH in deep vanished blind; do
  case "$_GH_API_WHICH" in
    deep)     GH_API_CLAUSE="$GH_API_CLAUSE_DEEP";     _GH_API_SPAN_DERIVED=no  ;;
    vanished) GH_API_CLAUSE="$GH_API_CLAUSE_VANISHED"; _GH_API_SPAN_DERIVED=yes ;;
    blind)    GH_API_CLAUSE="$GH_API_CLAUSE_BLIND";    _GH_API_SPAN_DERIVED=yes ;;
  esac
  [ -n "$GH_API_CLAUSE" ] || continue
  # FIXED 2026-09-05 (C2): a method value that is not literal text (an
  # expansion or substitution, e.g. `-X ${x:-POST}`, `-X $METHOD`, `--method
  # $(printf PUT)`) never matches the literal POST/PUT/PATCH/DELETE text the
  # check below reads for, so it fell through UNDENIED. This block ALLOWS by
  # default (see the GH_API_CLAUSE= assignment's own comment: an empty or
  # unreadable clause is the opposite failure mode from the `gh pr merge`
  # CLAUSE, which DENIES by default) — so an unreadable method must be its
  # own EXPLICIT, unconditional
  # deny here, placed before the literal-value check ever runs, rather than an
  # extra alternative folded into that check's condition: a value that never
  # satisfies the literal match would otherwise still fall through to this
  # block's allow-by-default. Same "cannot verify -> deny" rule the `gh pr
  # merge` CLAUSE applies at its own `printf '%s' "$CLAUSE" | grep -qF '$'`
  # check above (this file's C1 neighbourhood) — ruled by the repository
  # owner, 2026-09-05: never evaluate the expansion to try to read its value;
  # unreadable means deny.
  #
  # NARROWED to co-occurrence with a method FLAG on purpose, not "any `$` or
  # backtick anywhere in GH_API_CLAUSE": a bare `$` in the clause is ordinary
  # and common with no method flag present at all — `gh api repos/$OWNER/$REPO`
  # (a dynamic route) and `gh api repos/o/r --jq '.[] | .name'` (a --jq
  # filter) are both routine read-only calls that must stay allowed. It is
  # the COMBINATION of "a method flag is present" and "something in this
  # clause is unreadable" that cannot be cleared: once a method flag exists,
  # its value is what decides whether the call mutates, and an unreadable
  # clause means that value cannot be confirmed literal.
  #
  # DESIGN CHOICE, accepted over-denial: the unreadability test below reads
  # the WHOLE clause, not just the -X/--method value's own token — matching
  # this file's existing `gh pr merge` CLAUSE precedent for the identical
  # shape (its own `printf '%s' "$CLAUSE" | grep -qF '$'` check, named a few
  # lines up in this same comment block). A real
  # `gh api repos/o/r -X GET -f note=$SOMETHING` (a literal GET, an unrelated
  # `$` elsewhere in the same clause) also denies
  # under this choice. Re-deriving the value's own token boundary a SECOND
  # time (glued -XPOST vs spaced -X POST vs `=`-joined --method=POST) in a
  # DIFFERENT regex than the literal-value check below already uses would
  # narrow this, but a boundary bug in that second derivation would silently
  # reopen exactly the gap this fix closes — and reasoning harder about the
  # expansion's shape is the mechanism the 2026-09-05 ruling forbids.
  # Measured against this repo's OWN `gh api` usage
  # (scripts/todo-automerge-guard.sh, .claude/skills/land/SKILL.md): neither
  # passes -X/--method at all, so this over-denial has no production surface
  # today. Checked against a false-positive corpus of read-only/benign gh api
  # idioms with no method flag at all — a bare read, --paginate, --jq, a -f
  # field on an explicit GET, a -H header — every one of which this
  # co-occurrence gate leaves untouched; pinned in test-guard-outward-cli.sh's
  # own "C2" assertion block.
  #
  # Flag detection stays case-SENSITIVE (`-X`, `--method`), matching the
  # policy the `_GH_API_M`-consuming mutating-method value check states for
  # itself (the `-x`/`- post` collision, review 2026-08-16) — a
  # case-insensitive `-x` would match the
  # alphanumeric placeholder cmd_words can insert for an unrelated quoted
  # value. A non-word trailing boundary (`[^-A-Za-z0-9]` or end-of-string)
  # after each flag spelling rejects an unrelated longer flag sharing the same
  # prefix (`--methodology`) while still admitting every real spelling this
  # check must catch: a space or `=` after either flag, and a glued `$`
  # immediately after `-X` (`-X${x:-POST}`, `-X$METHOD` — `$` is not in
  # `[A-Za-z0-9-]`, so the boundary is satisfied without a space).
  # FIXED 2026-09-05 (still C2, a second unreadable-value spelling found by
  # constructing the legacy command-substitution form): the `$` test alone
  # missed a backtick command substitution supplying the method
  # (`-X \`printf POST\``) — WORDS_DEEP keeps a NON-empty backtick pair's
  # literal text intact (unlike an EMPTY backtick pair, which vanishes and
  # fuses the surrounding text — that is what "mid-backtick" a few checks
  # above in this file exploits, a DIFFERENT mechanism), so no `$` character
  # is ever present and this check's own `$`-only test fell through UNDENIED.
  # Confirmed a live, silent ALLOW at HEAD 9c9ba75b (predates this task).
  # Same ruling as the `$` case: a backtick substitution is exactly as
  # unreadable as a `$` one, so it denies the same way — reading FOR a
  # second character class, not trying to read WHAT is inside either one.
  if grep -Eq '(^|[[:space:]])(-X|--method)([^-A-Za-z0-9]|$)' <<< "$GH_API_CLAUSE" \
     && { [ "$_GH_API_SPAN_DERIVED" = yes ] \
          || printf '%s' "$GH_API_CLAUSE" | grep -qE '[$`]'; }; then
    deny "guard-outward-cli: command-position 'gh api' with a method flag (-X/--method) whose value is not literal text (an expansion or substitution, or a clause only readable after deleting one) cannot be verified read-only — denying, the same 'cannot verify -> deny' rule the 'gh pr merge' --auto check applies. Read-only 'gh api' with no -X/--method is unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
  fi
  # Matches BOTH the spaced/`=` form (-X POST, -X=POST, --method POST,
  # --method=POST) AND the glued short-flag form (-XPOST — the common
  # curl-style spelling; found bypassing a separator-only pattern in review
  # round 2), case-insensitively.
  # The FLAG is matched case-SENSITIVELY (`-X`, `--method`) and only the VALUE
  # case-insensitively, per this file's stated flag-detection policy. A blanket
  # `grep -Eqi` made `-X` also match `-x`, which collides with the alphanumeric
  # placeholder cmd_words inserts: `gh api repos/o/r -f "- post"` rendered as
  # `-xpost` and falsely denied (review, 2026-08-16). `-X post` is a real
  # spelling, so the value must stay case-insensitive.
  _GH_API_M='([Pp][Oo][Ss][Tt]|[Pp][Uu][Tt]|[Pp][Aa][Tt][Cc][Hh]|[Dd][Ee][Ll][Ee][Tt][Ee])'
  # FIXED 2026-09-05 (found by this task's own mandated finding-A
  # co-occurrence test; distinct from the unreadable-method check on
  # GH_API_CLAUSE — the value here is fully literal, no `$`/backtick
  # involved): the trailing boundary after the method literal was hardcoded
  # to `([[:space:]]|$)`, so a literal method glued directly to a trailing
  # redirect — `gh api repos/o/r -X POST>/dev/null` — never matched: the
  # character right after "POST" is `>`, neither whitespace nor
  # end-of-string. Real bash still tokenizes "POST" as its own complete argv
  # word (a redirect operator terminates a word without needing whitespace);
  # gh genuinely receives `-X POST`. Confirmed a live, silent ALLOW at HEAD
  # 9c9ba75b (pre-Task-5). Reusing `${_OUT_POS_SUFFIX}` here (rather than
  # inventing a second closer class) is the same fix `GH_API_RE`'s own
  # `${_OUT_POS_SUFFIX}` already gives the VERB's own trailing boundary —
  # this hardcoded copy was simply never migrated to it. This is a
  # closer-position ASSERTION inside a boolean `grep -Eq`, not a CAPTURE
  # bound, so the round-2 CRITICAL (a wide capture-bounding branch 1
  # truncating a CLAUSE before a later `$`) does not apply here — nothing here
  # shortens what GH_API_CLAUSE itself captures. Safe to widen: this whole
  # check is DENY-shaped (see the GH_API_CLAUSE= assignment's own comment),
  # so a broader boundary can only ever ADD a deny. Two-sided regression
  # test: test-guard-outward-cli.sh's "CO-OCCURRENCE ... glued to a trailing
  # redirect (same regression guard, finding A axis)" row.
  # The `[ -n "$GH_API_CLAUSE" ]` conjunct is now redundant — the enclosing loop
  # already `continue`s on an empty clause, so this is always true here. Kept
  # rather than removed (code review, 2026-09-06): it predates the loop, it
  # costs nothing, and it keeps this check independently correct if it is ever
  # lifted back out of the loop. Noted so the next reader does not have to work
  # out whether it is load-bearing. The sibling unreadable-method check above
  # carries no such guard, for the same reason.
  # THE FLAG->VALUE SEPARATOR TAKES THE ABSORBER (2026-09-07, security review).
  # This separator was hand-spelled `([[:space:]]+|=)` and lagged the 2026-09-07
  # interior-redirect widening, leaving a live bypass:
  #
  #   gh api repos/o/r -X DELETE        -> DENY
  #   gh api repos/o/r -X 2>&1 DELETE   -> ALLOWED
  #
  # Identical real argv (`gh api repos/o/r -X DELETE`, argv-stub confirmed) --
  # arbitrary destructive GitHub REST with the user's PAT. `--method 2>&1 POST`
  # was live the same way. Deny-shaped, so widening is monotone: `$_OUT_SEP`
  # reduces to `[[:space:]]+` at zero iterations, so `(${_OUT_SEP}|=)` matches a
  # strict superset of `([[:space:]]+|=)`. Only the SEPARATOR widens -- the
  # method class and the closer are untouched -- so the only reachable change is
  # a command that already carried a mutating method starting to deny.
  # NOTE the block above already migrated the CLOSER to ${_OUT_POS_SUFFIX} on
  # 2026-09-05; the SEPARATOR is what was missed. Third instance of the same
  # "a hand-spelled class lagged a widening" defect this file keeps paying for.
  if [ -n "$GH_API_CLAUSE" ] && grep -Eq "(^|[[:space:]])(-X${_GH_API_M}${_OUT_POS_SUFFIX}|(-X|--method)(${_OUT_SEP}|=)${_GH_API_M}${_OUT_POS_SUFFIX})" <<< "$GH_API_CLAUSE"; then
    deny "guard-outward-cli: command-position 'gh api' with a mutating HTTP method (-X/--method POST/PUT/PATCH/DELETE, spaced/=/glued) can invoke an arbitrary GitHub REST mutation — including a PR merge via a different subcommand than the dedicated 'gh pr merge' check above. Read-only 'gh api' (GET, the default with no -X/--method) is unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
  fi
  done
fi

exit 0
