#!/usr/bin/env bash
# PreToolUse(Bash) — structural deny for outward-facing CLI mutations: eas
# update/publish/submit (incl. mutating update:* colon subcommands), mutating
# railway verbs (incl. variable/service/environment sub-subcommands), npm
# publish, and mutating gh subcommands (incl. `gh api` with a mutating HTTP
# method). Hardens the prose-only mitigation in
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
# `gh pr merge` CARVE-OUT — bare/immediate `gh pr merge` DENIES, but
# `gh pr merge --auto ...` stays ALLOWED (unless `--admin` is also present —
# see below): arming GitHub's native auto-merge does not mutate anything
# synchronously (CI + branch protection gate the actual merge later), and
# this repo's own sanctioned /todo automerge mechanism
# (scripts/todo-automerge-guard.sh + .claude/agents/todo-executor.md Step 10)
# calls exactly `gh pr merge <n> --auto --squash --delete-branch` for
# guard-eligible PRs. Denying that by default would break the pipeline, and
# todo-executor.md is out of this hook's Scope Contract, so the carve-out is
# done here instead. More than one `gh pr merge` occurrence in the same
# command is ambiguous — DENY (the safe direction for a deny gate; mirrors
# cmd_gh_pr_ref's identical multi-occurrence refusal in lib/cmd-detect.sh).
# `--admin` ("use administrator privileges to merge a PR that does not meet
# requirements") contradicts the --auto carve-out's own premise — DENY
# regardless of --auto when present in the same clause.
#
# `gh pr create`/`gh pr comment` are deliberately NOT denied — outward but
# routine (this repo's PR-creation and review-request flow uses them; see the
# todo's own Implementation Notes carve-out).
#
# DOCUMENTED RESIDUALS (guardrail, not a sandbox — a determined bypass is
# always possible; ALLOW_OUTWARD_CLI=1 is the intentional escape hatch):
#   * A global flag before the verb (`npm --registry=x publish`, `eas
#     --non-interactive update`) defeats command-position anchoring — same
#     documented class as cmd-detect.sh's own arg-taking-wrapper residual.
#   * `npx eas update` / `npx gh pr merge` are not recognized: `npx` takes an
#     argument, so it is not a zero-arg runner word _CMD_POS_PREFIX skips (by
#     design — see lib/cmd-detect.sh's header).
#   * `eas publish` does not exist in the installed eas-cli (20.1.0 at time of
#     writing) — the pattern is kept anyway per the acceptance criteria's
#     literal wording and to catch an older/different CLI version; a no-op
#     today, not a false sense of coverage.
#   * A `gh pr merge`/`--auto` split across a shell line-continuation is not
#     recognized (grep -E does not span newlines) — this fails toward DENY,
#     the safe direction.
#   * `bash -c "…"` / `sh -c '…'` / `eval "…"` / any interpreter `-c` wrapper
#     (also: `timeout 30 eas update`, `sudo railway up`) hides or shifts the
#     outward command out of command position — the wrapper-word case is the
#     same documented arg-taking-wrapper residual as above; the quoted-`-c`
#     case blanks via `cmd_bare` (the same primitive that stops `git commit
#     -m "mentions eas update"` from a false-positive deny) — same accepted
#     residual class as git-safety.sh's own sudo/env/command/xargs/subshell/
#     eval wrapper note.
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
#   * `gh api -X "POST" ...` (a QUOTED HTTP method value) is not recognized:
#     the gh-api check runs on `$BARE`, and `cmd_bare` blanks quoted CONTENT
#     — the same primitive that stops a quoted MENTION elsewhere in this
#     hook from a false-positive deny also removes a genuinely quoted flag
#     value from view. The unquoted form (`-X POST`, the common real-world
#     spelling) is caught.
#
# Escape: `ALLOW_OUTWARD_CLI=1 <command>` as an INLINE prefix on the one Bash
# command (recognized from the command string itself — see the case
# statement below the CMD extraction for why this differs from an exported
# env var), OR export `ALLOW_OUTWARD_CLI=1` ambiently for the rest of the
# session (broader-scoped; prefer the inline form).
# Tests: .claude/hooks/test-guard-outward-cli.sh
set -uo pipefail

[ -n "${ALLOW_OUTWARD_CLI:-}" ] && exit 0

# Crude, non-quote-aware smell test shared by BOTH fail-closed fallback paths
# below (no-jq, and jq-present-but-lib-unsourceable). Kept in sync with the
# precise per-predicate patterns further down MANUALLY — every verb added to
# one list must be added to the other, or the fallback path is weaker than
# the precise path. $1 is raw, unblanked text (either the whole JSON envelope
# or an already-extracted command string — both are fine, this only greps
# for substrings).
crude_smells_outward() {
  grep -Eq 'eas[^a-zA-Z]+(update|publish|submit)|eas[^a-zA-Z]+update:(delete|edit|republish|revert-update-rollout|roll-back-to-embedded|rollback)|railway[^a-zA-Z]+(up|deploy|redeploy|restart|down|delete|remove|rm)|railway[^a-zA-Z]+(variable|variables|vars|var)[^a-zA-Z]+(set|delete)|railway[^a-zA-Z]+(service|environment)[^a-zA-Z]+delete|npm[^a-zA-Z]+publish|gh[^a-zA-Z]+pr[^a-zA-Z]+(merge|close|edit|ready|reopen|review|lock|unlock|update-branch|revert)|gh[^a-zA-Z]+release[^a-zA-Z]+(create|delete|delete-asset|edit|upload)|gh[^a-zA-Z]+repo[^a-zA-Z]+(create|delete|archive|unarchive|edit|rename|sync|fork)|gh[^a-zA-Z]+api[^a-zA-Z]' <<< "$1"
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
  case "$INPUT" in *'"command":"ALLOW_OUTWARD_CLI=1 '*) exit 0 ;; esac
  if grep -Eq '"tool_name"[[:space:]]*:[[:space:]]*"Bash"' <<< "$INPUT" \
     && crude_smells_outward "$INPUT"; then
    printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"guard-outward-cli: jq unavailable - failing closed for a command that looks like an outward-facing CLI mutation. Bypass: ALLOW_OUTWARD_CLI=1."}}'
  fi
  exit 0
fi

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0

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

deny() {
  jq -n --arg r "$1" \
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":$r}}'
  exit 0
}

# Necessary-substring fast path (project_per_bash_hook_overhead): a command
# without ANY of these literal substrings cannot match any predicate below —
# cmd_bare only BLANKS characters, never inserts/moves them, so this is a
# strict superset of the precise matcher, never a bypass.
case "$CMD" in
  *eas*|*railway*|*npm*|*gh*) : ;;
  *) exit 0 ;;
esac

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

# --- eas -------------------------------------------------------------------
# eas update/publish/submit (space-separated subcommand).
if grep -Eq "${_CMD_POS_PREFIX}eas[[:space:]]+(update|publish|submit)${_CMD_POS_SUFFIX}" <<< "$BARE"; then
  deny "guard-outward-cli: command-position 'eas update/publish/submit' publishes an OTA update or app-store submission — the exact class of the 2026-08-16 accidental-OTA incident. Read-only forms (eas update:list, eas update:view, eas whoami, ...) are unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi
# eas update:* MUTATING colon subcommands — verified against `eas update
# --help` (eas-cli 20.1.0); see the header's DOCUMENTED RESIDUALS entry for
# the verified-read-only counterpart (update:list/view/insights, unaffected
# by this pattern since the colon puts them outside this alternation).
if grep -Eq "${_CMD_POS_PREFIX}eas[[:space:]]+update:(delete|edit|republish|revert-update-rollout|roll-back-to-embedded|rollback)${_CMD_POS_SUFFIX}" <<< "$BARE"; then
  deny "guard-outward-cli: command-position 'eas update:delete/edit/republish/revert-update-rollout/roll-back-to-embedded/rollback' mutates what OTA update end users receive — the same incident class as bare 'eas update'. Read-only colon forms (eas update:list, eas update:view, eas update:insights) are unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi

# --- railway -----------------------------------------------------------------
if grep -Eq "${_CMD_POS_PREFIX}railway[[:space:]]+(up|deploy|redeploy|restart|down|delete|remove|rm)${_CMD_POS_SUFFIX}" <<< "$BARE"; then
  deny "guard-outward-cli: command-position 'railway up/deploy/redeploy/restart/down/delete/remove/rm' mutates a live Railway service. Read-only forms (railway status, railway logs, railway whoami, ...) are unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi
# railway variable set/delete (production secrets/env vars) and
# service/environment delete — a level deeper than the top-level verbs
# above, and at least as dangerous (an overwritten secret or a deleted
# service/environment is not recoverable by a redeploy the way up/down are).
if grep -Eq "${_CMD_POS_PREFIX}railway[[:space:]]+(variable|variables|vars|var)[[:space:]]+(set|delete)${_CMD_POS_SUFFIX}" <<< "$BARE"; then
  deny "guard-outward-cli: command-position 'railway variable/vars/var set/delete' mutates a live service's environment variables (may include production secrets). Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi
if grep -Eq "${_CMD_POS_PREFIX}railway[[:space:]]+(service|environment)[[:space:]]+delete${_CMD_POS_SUFFIX}" <<< "$BARE"; then
  deny "guard-outward-cli: command-position 'railway service/environment delete' deletes a live Railway service or environment. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi

# --- npm publish -------------------------------------------------------------
if grep -Eq "${_CMD_POS_PREFIX}npm[[:space:]]+publish${_CMD_POS_SUFFIX}" <<< "$BARE"; then
  deny "guard-outward-cli: command-position 'npm publish' pushes a package to the registry. 'npm run <script>' (e.g. update:preview/update:production) is a different command word entirely and is unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi

# --- gh: bare 'gh pr merge' (see the --auto/--admin carve-out in the header) -
GH_PR_MERGE_RE="${_CMD_POS_PREFIX}gh[[:space:]]+pr[[:space:]]+merge${_CMD_POS_SUFFIX}"
GH_PR_MERGE_OCCURRENCES=$(printf '%s' "$BARE" | grep -oE "$GH_PR_MERGE_RE" | wc -l | tr -d '[:space:]')
if [ "${GH_PR_MERGE_OCCURRENCES:-0}" -gt 1 ]; then
  deny "guard-outward-cli: more than one command-position 'gh pr merge' occurrence — ambiguous, cannot verify each carries --auto. Denying is the safe direction for a deny gate. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
elif [ "${GH_PR_MERGE_OCCURRENCES:-0}" -eq 1 ]; then
  CLAUSE=$(printf '%s' "$BARE" | grep -oE "${_CMD_POS_PREFIX}gh[[:space:]]+pr[[:space:]]+merge${_CMD_POS_SUFFIX}[^;&|]*" | head -1)
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
    deny "guard-outward-cli: command-position 'gh pr merge' without a REAL --auto flag merges a PR immediately. A '--auto' token consumed as the VALUE of a preceding value-taking flag (--body/-b, --body-file/-F, --subject/-t, --author-email/-A, --match-head-commit/-c, --repo/-R, ...) does not count as --auto. 'gh pr merge --auto ...' (this repo's sanctioned /todo automerge mechanism) stays allowed — CI + branch protection gate the actual merge. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
  fi
  # --admin ("use administrator privileges to merge a PR that does not meet
  # requirements") contradicts the --auto carve-out's own premise (that CI +
  # branch protection still gate the merge) — deny regardless of --auto. A
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
    deny "guard-outward-cli: command-position 'gh pr merge --admin' uses administrator privileges to merge a PR that may not meet requirements — this contradicts the --auto carve-out's premise (CI + branch protection gating). Denying regardless of --auto. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
  fi
fi

# --- gh: other mutating subcommands (pr create/comment deliberately allowed,
#     see the header) ---------------------------------------------------------
GH_MUTATING_RE="${_CMD_POS_PREFIX}gh[[:space:]]+(pr[[:space:]]+(close|edit|ready|reopen|review|lock|unlock|update-branch|revert)|release[[:space:]]+(create|delete|delete-asset|edit|upload)|repo[[:space:]]+(create|delete|archive|unarchive|edit|rename|sync|fork))${_CMD_POS_SUFFIX}"
if grep -Eq "$GH_MUTATING_RE" <<< "$BARE"; then
  deny "guard-outward-cli: command-position mutating 'gh pr/release/repo' subcommand. Read-only forms (gh pr view/checks/list, gh release view/list, gh repo view/list, ...) are unaffected; gh pr create/comment are deliberately allowed (routine PR workflow). Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
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
GH_API_RE="${_CMD_POS_PREFIX}gh[[:space:]]+api${_CMD_POS_SUFFIX}"
GH_API_OCCURRENCES=$(printf '%s' "$BARE" | grep -oE "$GH_API_RE" | wc -l | tr -d '[:space:]')
if [ "${GH_API_OCCURRENCES:-0}" -gt 1 ]; then
  deny "guard-outward-cli: more than one command-position 'gh api' occurrence — ambiguous, cannot verify each is read-only. Denying is the safe direction for a deny gate. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
elif [ "${GH_API_OCCURRENCES:-0}" -eq 1 ]; then
  GH_API_CLAUSE=$(printf '%s' "$BARE" | grep -oE "${_CMD_POS_PREFIX}gh[[:space:]]+api[[:space:]][^;&|]*" | head -1)
  # Matches BOTH the spaced/`=` form (-X POST, -X=POST, --method POST,
  # --method=POST) AND the glued short-flag form (-XPOST — the common
  # curl-style spelling; found bypassing a separator-only pattern in review
  # round 2), case-insensitively.
  if [ -n "$GH_API_CLAUSE" ] && grep -Eqi '(^|[[:space:]])(-X(post|put|patch|delete)([[:space:]]|$)|(-X|--method)([[:space:]]+|=)(post|put|patch|delete)([[:space:]]|$))' <<< "$GH_API_CLAUSE"; then
    deny "guard-outward-cli: command-position 'gh api' with a mutating HTTP method (-X/--method POST/PUT/PATCH/DELETE, spaced/=/glued) can invoke an arbitrary GitHub REST mutation — including a PR merge via a different subcommand than the dedicated 'gh pr merge' check above. Read-only 'gh api' (GET, the default with no -X/--method) is unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
  fi
fi

exit 0
