# Outward-CLI Guard Folded Repair — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close 28 measured live bypasses of `.claude/hooks/guard-outward-cli.sh` across six mechanism families, satisfying three ruled P0 todos in one change with one generated corpus.

**Architecture:** Four families are fixed by widening existing regexes in place (a closer character class, a prefix absorber, a flag-boundary alternative, an "unverifiable ⇒ deny" branch). The fifth needs one new derived _rendering_ of the command text — expansions that can provably be empty are deleted, so a verb split by a vanishing sigil rejoins — consumed on a split surface so occurrence counters never double-count. The sixth is a narrow-deny predicate plus its degraded-path mirror.

**Tech Stack:** Bash 3.2 (macOS system bash), POSIX `awk`, `grep -E`, `jq`. No new dependencies. Tests are the repo's existing shell harnesses.

**Spec:** `docs/superpowers/specs/2026-09-05-outward-cli-guard-folded-repair-design.md` — read it before Task 1. It carries the measured baseline, the four corrections to the todos, and the three scope amendments this plan implements.

## Global Constraints

- **Never execute an outward-facing CLI**, including `--help` or `--version`. Constructions are passed to the hook as JSON strings; the hook only reads text. Where real argv must be proven, shadow a binary with an argv-printing stub on `PATH` — never strip `PATH`.
- **Never commit or push to `main`.** Branch: `todo/P0-2026-09-05-outward-cli-guard-folded-repair`, base `main`.
- **Commit messages go through `Write` + `git commit -F <file>`**, never `-m`. Backticks in `-m` execute, and the command guard reads heredoc bodies.
- **Writing files that quote these constructions trips the guard's own heredoc-prose false positive.** Use file tools (`Write`/`Edit`), never route trigger text through a shell command string. `ALLOW_OUTWARD_CLI=1` clears only the single check that fired.
- **Deny-shaped consumers only.** Any new rendering feeds deny-shaped or occurrence-counting checks. `$WORDS` stays byte-identical — it has one grant-shaped consumer (the `gh pr merge --auto` carve-out clause at `:891`).
- **Baseline to quote from:** `Results: 280 passed, 0 failed`, exit 0 (`bash .claude/hooks/test-guard-outward-cli.sh`).
- **Every new deny assertion carries its reason substring.** A deny is not evidence the intended check fired — see spec §2.1.
- **Do not run `test:run` / `check:types` / `lint` ad-hoc.** CI is the source of truth. The hook suites (`scripts/run-hook-tests.sh`) are the exception — they are this change's unit tests.

---

## File Structure

| File                                                                                                  | Responsibility                                                                                                                                                                                                                         | Tasks     |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `.claude/hooks/repro-outward-cli-corpus.sh`                                                           | **Create.** Generated-from-dimensions corpus; runs every construction against the live hook on all four execution paths and prints a decision matrix with deny-reason attribution. The durable fixture all three todos record as lost. | 1         |
| `.claude/hooks/guard-outward-cli.sh`                                                                  | **Modify.** All guard-side fixes: anchors, flag boundary, `gh api` unverifiable branch, rendering composition, narrow deny, degraded-path mirror, residuals.                                                                           | 2–5, 7–11 |
| `.claude/hooks/lib/cmd-detect.sh`                                                                     | **Modify.** Adds one new function, `cmd_words_vanished`. Modifies no existing function.                                                                                                                                                | 6         |
| `.claude/hooks/test-guard-outward-cli.sh`                                                             | **Modify.** Two-sided regression assertions for every fix.                                                                                                                                                                             | 2–5, 7–11 |
| `.claude/hooks/test-cmd-detect.sh`                                                                    | **Modify.** Unit + differential coverage for `cmd_words_vanished`.                                                                                                                                                                     | 6         |
| `todos/P0-2026-09-02-outward-cli-guard-boundary-and-absorber-bypasses.md`                             | **Modify.** Retractions, corrected matrix, lifted fence.                                                                                                                                                                               | 10        |
| `todos/P0-2026-09-02-outward-cli-guard-vanishing-sigil-boundary-decision.md`                          | **Modify.** Close-out.                                                                                                                                                                                                                 | 10        |
| `todos/P0-2026-09-02-outward-cli-guard-command-position-expansion-decision.md`                        | **Modify.** Close-out.                                                                                                                                                                                                                 | 10        |
| `docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md` | **Modify.** Round-4 disclosure amendment.                                                                                                                                                                                              | 10        |

---

### Task 1: Durable corpus generator and reproduction baseline

Establishes the measured "before" state every later task mutation-tests against, and satisfies AC #1 of all three todos ("reproduced first against unmodified `main`"). No behaviour change.

**Files:**

- Create: `.claude/hooks/repro-outward-cli-corpus.sh`

**Interfaces:**

- Produces: an executable script taking no arguments, printing a fixed-width matrix (`ID | EXPECT | PRECISE | NOJQ | NOLIB | NOAWK | note`) and a trailing deny-reason attribution block. Exit 0 always; it reports, it does not gate.

- [ ] **Step 1: Create the branch**

```bash
git checkout -b todo/P0-2026-09-05-outward-cli-guard-folded-repair
git status --short
```

Expected: on the new branch, clean tree.

- [ ] **Step 2: Write the corpus generator**

Create `.claude/hooks/repro-outward-cli-corpus.sh` with the content below. Note the corpus is **generated by crossing axes**, not hand-listed, and that co-occurrence rows are appended deliberately — a cross product picks one value per axis, so a check that fires only on co-occurrence is never reached and passes by agreeing.

```bash
#!/usr/bin/env bash
# Reproduction + regression corpus for guard-outward-cli.sh.
#
# SAFETY: no outward-facing CLI is ever executed. Every construction is passed
# to the hook as a JSON *string*; the hook reads text and prints a decision.
#
# The three P0 todos this serves each record that their reproduction fixtures
# "lived in a session scratchpad and are NOT durable". This file is the
# replacement: regenerate the matrix by running it.
#
# Usage: bash .claude/hooks/repro-outward-cli-corpus.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/guard-outward-cli.sh"

# ---- degraded-path fixtures (same shape as test-guard-outward-cli.sh) -------
NOJQ_BIN=$(mktemp -d)
for b in bash cat grep; do ln -s "$(command -v "$b")" "$NOJQ_BIN/$b"; done
NOLIB_DIR=$(mktemp -d); cp "$HOOK" "$NOLIB_DIR/guard-outward-cli.sh"
NOAWK_BIN=$(mktemp -d)
for b in bash cat grep sed jq wc tr head env dirname; do
  ln -s "$(command -v "$b")" "$NOAWK_BIN/$b" 2>/dev/null
done
trap 'rm -rf "$NOJQ_BIN" "$NOLIB_DIR" "$NOAWK_BIN"' EXIT

envelope() { jq -cn --arg cmd "$1" '{tool_name:"Bash",tool_input:{command:$cmd}}'; }

decide() {  # $1=mode $2=command -> DENY|ALLOW
  local mode="$1" env_json out
  env_json=$(envelope "$2")
  case "$mode" in
    precise) out=$(printf '%s' "$env_json" | bash "$HOOK" 2>/dev/null) ;;
    nojq)    out=$(printf '%s' "$env_json" | env PATH="$NOJQ_BIN" "$NOJQ_BIN/bash" "$HOOK" 2>/dev/null) ;;
    nolib)   out=$(printf '%s' "$env_json" | bash "$NOLIB_DIR/guard-outward-cli.sh" 2>/dev/null) ;;
    noawk)   out=$(printf '%s' "$env_json" | env PATH="$NOAWK_BIN" "$NOAWK_BIN/bash" "$HOOK" 2>/dev/null) ;;
  esac
  grep -q '"permissionDecision":[[:space:]]*"deny"' <<< "$out" && echo DENY || echo ALLOW
}

reason() {  # $1=command -> deny reason fingerprint (attribution matters: a
            # deny is not evidence the INTENDED check fired -- see spec 2.1)
  local o; o=$(printf '%s' "$(envelope "$1")" | bash "$HOOK" 2>/dev/null)
  grep -q permissionDecision <<< "$o" || { printf '%s' '(allowed)'; return; }
  tr '\n' ' ' <<< "$o" | sed -E 's/.*guard-outward-cli: //; s/ Bypass:.*//' | cut -c1-72
}

# ---- axes ------------------------------------------------------------------
# A row is: ID @@ EXPECTED @@ COMMAND. EXPECTED is what the guard SHOULD say
# once this plan is complete; the matrix's job is to show which are not there
# yet. Generated rows come first, deliberate co-occurrence rows after.

ROWS=()
add() { ROWS+=("$1 @@ $2 @@ $3"); }

# axis: verb family -> a literal, known-denying invocation of each
FAM_IDS=(easupd easbld npmpub railup ghmerge ghcomment ghapi)
FAM_CMDS=(
  'eas update --branch preview'
  'eas build --platform ios --auto-submit'
  'npm publish'
  'railway up'
  'gh pr merge 42'
  'gh pr comment 5 --body hi --repo other/org'
  'gh api repos/o/r -X POST'
)
# axis: glue mechanism applied to the VERB position of each family
for i in "${!FAM_IDS[@]}"; do
  id=${FAM_IDS[$i]}; cmd=${FAM_CMDS[$i]}
  add "lit-$id"    DENY "$cmd"
  add "sufx-$id"   DENY "$(sed -E 's/^([a-z]+ [a-z:]+)/\1>\/dev\/null/' <<< "$cmd")"
  add "pref-$id"   DENY "2>/dev/null $cmd"
  add "vsub-$id"   DENY "$(sed -E 's/^([a-z]+ [a-z:]+)/\1$()/' <<< "$cmd")"
  add "vvar-$id"   DENY "$(sed -E 's/^([a-z]+ [a-z:]+)/\1${UNSET}/' <<< "$cmd")"
done

# axis: flag-boundary donation (C1) -- families with NO masking guard, so the
# assertion is anchored to the C1 mechanism and not to an unrelated branch.
add c1-submit-lit    DENY  'eas build --platform ios --auto-submit'
add c1-submit-colon  DENY  'eas build --platform ios ${x:---auto-submit}'
add c1-submit-bare   DENY  'eas build --platform ios ${x---auto-submit}'
add c1-submit-plus   DENY  'eas build --platform ios ${x:+--auto-submit}'
add c1-repo-lit      DENY  'gh pr comment 5 --body hi --repo other/org'
add c1-repo-colon    DENY  'gh pr comment 5 --body hi ${x:---repo} other/org'
add c1-repo-short    DENY  'gh pr comment 5 --body hi ${x:--R} other/org'
add c1-create-colon  DENY  'gh pr create --title t --body b ${x:---repo} other/org'
add c1-threedash     ALLOW 'gh pr merge 42 --auto ${x:----admin}'

# axis: gh api method value (C2)
add c2-lit           DENY  'gh api repos/o/r -X POST'
add c2-expand        DENY  'gh api repos/o/r -X ${x:-POST}'
add c2-dynamic       DENY  'gh api repos/o/r -X $METHOD'
add c2-readonly      ALLOW 'gh api repos/o/r'
add c2-dynpath       ALLOW 'gh api repos/$OWNER/$REPO'

# axis: mid-token sigil (no boundary exists; only the vanished rendering reaches these)
add mid-backtick     DENY  'gh pr me``rge 42'
add mid-sub          DENY  'gh pr me$()rge 42'
add mid-var          DENY  'gh pr me${UNSET}rge 42'
add mid-eas          DENY  'eas up${UNSET}date --branch preview'

# axis: verb synthesis (verb text never appears literally)
add syn-default      DENY  'gh pr ${v:-merge} 42'
add syn-nocolon      DENY  'gh pr ${v-merge} 42'
add syn-indirect     DENY  'gh pr ${!ind} 42'
add syn-cmdsub       DENY  'gh pr $(printf merge) 42'
add syn-binary       DENY  '${e:-eas} update --branch preview'

# CO-OCCURRENCE rows -- constructed deliberately. A cross product picks ONE
# value per axis, so a guard that fires only when two mechanisms co-occur is
# never reached and passes by AGREEING with the expected result.
add co-pref-sufx     DENY  '2>/dev/null eas update>/dev/null'
add co-sigil-c1      DENY  'eas bu${UNSET}ild --platform ios ${x:---auto-submit}'
add co-mask-c1       DENY  'gh pr merge 42 --auto ${x:---admin}'   # see NOTE below
add co-two-api       DENY  'gh api repos/o/r && gh api -X PUT repos/o/r/pulls/1/merge'
add co-nested-brace  ALLOW 'echo ${a:-${b}}'

# FALSE-POSITIVE controls -- everyday idioms that MUST stay allowed. A control
# that stays green under mutation is not a control; these are re-checked after
# every widening.
add fp-mkdir         ALLOW 'mkdir -p dir/{a,b,c}'
add fp-cpbak         ALLOW 'cp file.txt{,.bak}'
add fp-eslint        ALLOW 'eslint --fix client/src/*.{ts,tsx}'
add fp-forloop       ALLOW 'for i in {1..3}; do echo $i; done'
add fp-redir         ALLOW 'grep -r foo . >/dev/null 2>&1'
add fp-var           ALLOW 'echo ${HOME:-/tmp}'
add fp-ghread        ALLOW 'gh pr view 42'
add fp-ghlist        ALLOW 'gh pr list --limit 5'
add fp-easread       ALLOW 'eas update:list --branch preview'
add fp-npmrun        ALLOW 'npm run build'
add fp-mention       ALLOW 'git commit -m "chore: mentions eas update and gh pr merge"'
add fp-quotedall     ALLOW 'echo "gh pr merge 42"'
add fp-automerge     ALLOW 'gh pr merge 42 --auto'

printf '%-18s | %-6s | %-7s | %-6s | %-6s | %-6s | %s\n' \
  ID EXPECT PRECISE NOJQ NOLIB NOAWK NOTE
printf '%s\n' '-------------------+--------+---------+--------+--------+--------+------'

GAPS=0
for row in "${ROWS[@]}"; do
  id=$( awk -F' @@ ' '{print $1}' <<< "$row")
  exp=$(awk -F' @@ ' '{print $2}' <<< "$row")
  cmd=$(awk -F' @@ ' '{print $3}' <<< "$row")
  p=$(decide precise "$cmd"); j=$(decide nojq "$cmd")
  l=$(decide nolib "$cmd");   a=$(decide noawk "$cmd")
  if [ "$p" = "$exp" ]; then note='ok'; else note="GAP (want $exp)"; GAPS=$((GAPS+1)); fi
  printf '%-18s | %-6s | %-7s | %-6s | %-6s | %-6s | %s\n' "$id" "$exp" "$p" "$j" "$l" "$a" "$note"
done

echo ""
echo "rows=${#ROWS[@]}  precise-path gaps=$GAPS"
echo ""
echo "=== deny-reason attribution (which check actually fired) ==="
for row in "${ROWS[@]}"; do
  id=$( awk -F' @@ ' '{print $1}' <<< "$row")
  cmd=$(awk -F' @@ ' '{print $3}' <<< "$row")
  [ "$(decide precise "$cmd")" = "DENY" ] || continue
  printf '%-18s : %s\n' "$id" "$(reason "$cmd")"
done

# NOTE on co-mask-c1: on the pre-fix tree this row DENIES, but for an unrelated
# reason -- any `$` in the merge clause makes --auto unverifiable at :928, so
# the --admin check at :965 never runs. Controls proving this:
#   gh pr merge 42 --auto $UNRELATED   -> same reason
#   gh pr merge 42 --auto ${x:-hello}  -> same reason
# Read this row's ATTRIBUTION line, never its verdict alone.
```

- [ ] **Step 3: Make it executable and run it — this is the baseline**

```bash
chmod +x .claude/hooks/repro-outward-cli-corpus.sh
bash .claude/hooks/repro-outward-cli-corpus.sh | tee /tmp/guard-baseline.txt
tail -3 /tmp/guard-baseline.txt
```

Expected: a `rows=N precise-path gaps=M` line with **M greater than 20**. Record the exact `rows=` and `gaps=` values — every later task quotes the movement in `gaps` as its evidence.

If `gaps=0`, stop and report: the premise does not hold and nothing should be fixed.

- [ ] **Step 4: Confirm the existing suites are green before any change**

```bash
bash .claude/hooks/test-guard-outward-cli.sh | tail -2
bash scripts/run-hook-tests.sh 2>&1 | tail -2
```

Expected: `Results: 280 passed, 0 failed` and `✓ 34 hook self-tests passed`.

- [ ] **Step 5: Commit**

Write the message to a file first (backticks in `-m` execute):

```bash
git add .claude/hooks/repro-outward-cli-corpus.sh
git commit -F /tmp/commit-msg-1.txt
```

with `/tmp/commit-msg-1.txt` containing:

```
test(hooks): add the durable outward-CLI reproduction corpus

All three folded P0 todos record that their reproduction fixtures lived in a
session scratchpad and were not durable. This regenerates them: every gated
verb family crossed with every glue mechanism, on all four execution paths,
with deny-reason attribution because a deny is not evidence the intended
check fired.

No behaviour change.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QCm3P7qcu1EeVxmnuaM1iG
```

---

### Task 2: Finding A — closer-class parity on both suffix anchors

**Files:**

- Modify: `.claude/hooks/guard-outward-cli.sh:267`, `:315`
- Test: `.claude/hooks/test-guard-outward-cli.sh`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `_OUT_POS_SUFFIX` and `_OUT_POS_SUFFIX_MERGE_CLAUSE` with `<` and `>` in their closer sets. Later tasks read both unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `.claude/hooks/test-guard-outward-cli.sh`, immediately before the `# ---------- jq-missing fallback` banner (so it stays on the precise-path side of the file):

```bash
# ---------- 2026-09-05: finding A — _OUT_POS_SUFFIX closes on < and > --------
# A redirect operator tokenizes regardless of adjacent whitespace, so a verb
# glued directly to one is a real invocation. The lib's _CMD_POS_SUFFIX has
# always included `<`/`>`; this hook's copy did not. Both branches of
# _OUT_POS_SUFFIX_MERGE_CLAUSE move in the same change — fixing one branch of a
# two-branch boundary check and not the other is the round-3/round-5 defect
# that recurred twice inside the PR #910 repair chain.
assert_deny "eas update glued to a trailing redirect denies" \
  "$(json 'eas update>/dev/null')" "eas update/publish/submit"
assert_deny "npm publish glued to a trailing redirect denies" \
  "$(json 'npm publish>/dev/null')" "npm publish"
assert_deny "railway up glued to a trailing redirect denies" \
  "$(json 'railway up>/dev/null')" "railway up/deploy"
assert_deny "gh pr merge glued to a trailing output redirect denies" \
  "$(json 'gh pr merge>/dev/null')" "without a REAL --auto flag"
assert_deny "gh pr merge glued to a trailing input redirect denies" \
  "$(json 'gh pr merge</dev/null')" "without a REAL --auto flag"
assert_deny "eas build glued to a redirect still sees --auto-submit" \
  "$(json 'eas build>/dev/null --auto-submit')" "eas build --auto-submit"
# Negative controls: widening a closer class must not swallow ordinary text.
assert_allow "a redirect not fronting a gated verb stays allowed" \
  "$(json 'grep -r foo . >/dev/null 2>&1')"
assert_allow "a read-only eas colon form glued to a redirect stays allowed" \
  "$(json 'eas update:list>/dev/null')"
assert_allow "the automerge carve-out survives the widened merge clause" \
  "$(json 'gh pr merge 42 --auto')"
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bash .claude/hooks/test-guard-outward-cli.sh 2>&1 | grep -E '^(FAIL|Results)'
```

Expected: six `FAIL:` lines (the six `assert_deny` rows), three passes among the new controls, and a `Results:` line showing `286 passed, 0 failed` minus the six — i.e. `283 passed, 6 failed`.

- [ ] **Step 3: Widen `_OUT_POS_SUFFIX`**

Edit `.claude/hooks/guard-outward-cli.sh:267`:

```bash
_OUT_POS_SUFFIX='([[:space:]]|[);&|`{}]|$)'
```

to:

```bash
_OUT_POS_SUFFIX='([[:space:]]|[);&|`{}<>]|$)'
```

This is now byte-identical to the lib's `_CMD_POS_SUFFIX` (`lib/cmd-detect.sh:126`) — an invariant that can be checked rather than remembered.

- [ ] **Step 4: Widen BOTH branches of `_OUT_POS_SUFFIX_MERGE_CLAUSE`**

Edit `.claude/hooks/guard-outward-cli.sh:315`:

```bash
_OUT_POS_SUFFIX_MERGE_CLAUSE='([[:space:]][^;&|)`{}]*|[);&|`{}]|$)'
```

to:

```bash
_OUT_POS_SUFFIX_MERGE_CLAUSE='([[:space:]][^;&|)`{}<>]*|[);&|`{}<>]|$)'
```

Branch 1 is a negated class (stop capturing at a redirect); branch 2 is a positive class (accept a redirect as a closer). Both must carry the same seven-plus-two characters or the two branches disagree again.

- [ ] **Step 5: Verify the two closer sets now match the lib**

```bash
grep -n '_OUT_POS_SUFFIX=' .claude/hooks/guard-outward-cli.sh
grep -n '_CMD_POS_SUFFIX=' .claude/hooks/lib/cmd-detect.sh
```

Expected: the two right-hand sides are identical strings.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
bash .claude/hooks/test-guard-outward-cli.sh 2>&1 | tail -2
```

Expected: `Results: 289 passed, 0 failed`.

- [ ] **Step 7: Mutation-test the new assertions (both sides)**

```bash
sed -i.bak "s/{}<>\]|\\\$)'/{}]|\$)'/" .claude/hooks/guard-outward-cli.sh
bash .claude/hooks/test-guard-outward-cli.sh 2>&1 | tail -2
```

Expected: exactly the six new `assert_deny` rows fail — `283 passed, 6 failed`. If a _different_ count fails, the assertions are not anchored to this mechanism.

Restore and re-confirm:

```bash
mv .claude/hooks/guard-outward-cli.sh.bak .claude/hooks/guard-outward-cli.sh
bash .claude/hooks/test-guard-outward-cli.sh 2>&1 | tail -2
```

Expected: back to `Results: 289 passed, 0 failed`.

- [ ] **Step 8: Re-run the corpus and record the movement**

```bash
bash .claude/hooks/repro-outward-cli-corpus.sh | tail -3
```

Expected: `gaps` drops by the number of `sufx-*` rows. Record the before/after numbers.

- [ ] **Step 9: Re-run the §2.1 attribution probe — this can move**

Widening the merge clause changes what `:928`'s `$` test sees, which is the masking mechanism spec §2.1 rests on. Check it now, not at the end:

```bash
bash .claude/hooks/repro-outward-cli-corpus.sh | grep -E 'co-mask-c1'
```

Expected: still DENY. Read its **attribution** line in the trailing block. If the reason changed from `without a REAL --auto flag` to `uses administrator privileges`, the masking is gone and Task 5's test family choice must be revisited before Task 5 is written. Record which.

- [ ] **Step 10: Commit**

```bash
git add .claude/hooks/guard-outward-cli.sh .claude/hooks/test-guard-outward-cli.sh
git commit -F /tmp/commit-msg-2.txt
```

Message body: `fix(hooks): close finding A — _OUT_POS_SUFFIX and the merge clause now close on < and >`, plus the mutation counts from Step 7 and the corpus movement from Step 8.

---

### Task 3: Finding B — prefix redirect absorption, and the ordering trap

**Files:**

- Modify: `.claude/hooks/guard-outward-cli.sh:266` (relocated), `:315` (relocated)
- Test: `.claude/hooks/test-guard-outward-cli.sh`

**Interfaces:**

- Consumes: `_OUT_POS_SUFFIX` / `_OUT_POS_SUFFIX_MERGE_CLAUSE` as widened in Task 2.
- Produces: `_OUT_POS_PREFIX` absorbing a leading redirect, defined _after_ `lib/cmd-detect.sh` is sourced.

> **The trap this task exists to avoid:** `_OUT_POS_PREFIX` is defined at `:266`; the lib is sourced at `:520`. Interpolating `$_CMD_REDIR` at `:266` expands to the **empty string** — no error (`set -uo pipefail`, no `-e`), the suite stays green, and the bypass stays open. The definitions must move below the source.

- [ ] **Step 1: Write the failing tests**

Append to `.claude/hooks/test-guard-outward-cli.sh` after Task 2's block:

```bash
# ---------- 2026-09-05: finding B — _OUT_POS_PREFIX absorbs a leading redirect
# Bash permits a redirect ANYWHERE in a simple command, including before the
# command word. The lib's _CMD_POS_PREFIX gained a redirect alternative on
# 2026-09-01 (_CMD_REDIR); this hook's copy never did. Reused BY REFERENCE —
# a second, subtly-different redirect pattern is a fresh instance of the same
# bug surface (lib/cmd-detect.sh:113-116).
assert_deny "leading 2>/dev/null before eas update denies" \
  "$(json '2>/dev/null eas update --branch preview')" "eas update/publish/submit"
assert_deny "leading >/dev/null before npm publish denies" \
  "$(json '>/dev/null npm publish')" "npm publish"
assert_deny "leading 2>/dev/null before railway up denies" \
  "$(json '2>/dev/null railway up')" "railway up/deploy"
assert_deny "leading >/dev/null before gh pr merge denies" \
  "$(json '>/dev/null gh pr merge 42')" "without a REAL --auto flag"
# Negative controls.
assert_allow "a leading redirect before a benign command stays allowed" \
  "$(json '2>/dev/null ls -la')"
assert_allow "a leading redirect before a read-only gh call stays allowed" \
  "$(json '2>/dev/null gh pr view 42')"
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bash .claude/hooks/test-guard-outward-cli.sh 2>&1 | grep -E '^(FAIL|Results)'
```

Expected: four `FAIL:` lines, `Results: 291 passed, 4 failed`.

- [ ] **Step 3: Relocate the anchor definitions below the lib source**

Cut lines `266-267` (the `_OUT_POS_PREFIX` / `_OUT_POS_SUFFIX` pair, with the comment block that documents them) and line `315` (`_OUT_POS_SUFFIX_MERGE_CLAUSE`) from their current positions. Leave a pointer comment at each original site:

```bash
# COMMAND-POSITION ANCHORS: defined AFTER lib/cmd-detect.sh is sourced (below),
# because _OUT_POS_PREFIX interpolates the lib's $_CMD_REDIR. Defining them here
# would interpolate an UNSET variable to the empty string — no error, suite
# green, bypass open. See the definitions further down.
```

Paste the definitions immediately after the lib-source guard's closing `fi` (currently `:525`), with this header:

```bash
# --- command-position anchors (must follow the lib source: _CMD_REDIR) -------
```

- [ ] **Step 4: Add the redirect alternative to `_OUT_POS_PREFIX`**

At its new location, change:

```bash
_OUT_POS_PREFIX='(^|[;&|(`{!])[[:space:]]*(([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*|env|command|builtin|exec|nohup|setsid|then|do|else|elif|time)[[:space:]]+)*'
```

to:

```bash
_OUT_POS_PREFIX='(^|[;&|(`{!])[[:space:]]*(([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*|env|command|builtin|exec|nohup|setsid|then|do|else|elif|time|'"$_CMD_REDIR"')[[:space:]]+)*'
```

The guard keeps its own extra keywords (`then|do|else|elif|time`), which the lib's copy does not have; only the redirect alternative is borrowed, and by reference.

- [ ] **Step 5: Prove the interpolation is non-empty at definition time**

This is the whole point of the relocation, so assert it rather than assume it:

```bash
grep -n 'cmd-detect.sh' .claude/hooks/guard-outward-cli.sh | head -1
grep -n '_OUT_POS_PREFIX=' .claude/hooks/guard-outward-cli.sh
grep -c '0-9\]\*|&' .claude/hooks/guard-outward-cli.sh
```

Expected: the source line number is **smaller** than the `_OUT_POS_PREFIX=` line number, and the third command returns at least 1 (the `_CMD_REDIR` text is present, meaning the definition line is not the only reference).

- [ ] **Step 6: Confirm no consumer runs before the new definition**

```bash
grep -n '_OUT_POS_PREFIX' .claude/hooks/guard-outward-cli.sh | grep -v '^[0-9]*: *#' | head -20
```

Expected: the definition line is the lowest-numbered non-comment occurrence. If any consumer has a lower line number, it would read an empty anchor — stop and report.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
bash .claude/hooks/test-guard-outward-cli.sh 2>&1 | tail -2
```

Expected: `Results: 295 passed, 0 failed`.

- [ ] **Step 8: Mutation-test**

Temporarily remove `|'"$_CMD_REDIR"'` from `_OUT_POS_PREFIX`, re-run, confirm exactly the four new `assert_deny` rows fail (`291 passed, 4 failed`), restore, confirm `295 passed, 0 failed`. Quote all three `Results:` lines.

- [ ] **Step 9: Run the full hook suite — this touches a shared anchor**

```bash
bash scripts/run-hook-tests.sh 2>&1 | tail -2
```

Expected: `✓ 34 hook self-tests passed`. A failure in `test-cmd-detect.sh`, `test-branch-preflight.sh`, `test-commit-verify.sh`, or `test-drift-detect.sh` would mean the relocation disturbed a shared symbol — investigate before continuing.

- [ ] **Step 10: Commit**

```bash
git add .claude/hooks/guard-outward-cli.sh .claude/hooks/test-guard-outward-cli.sh
git commit -F /tmp/commit-msg-3.txt
```

Message body: `fix(hooks): close finding B — _OUT_POS_PREFIX absorbs a leading redirect`, and record explicitly that the anchor definitions were relocated below the lib source because interpolating `_CMD_REDIR` before it is sourced fails silently open.

---

### Task 4: C1 — a default-value expansion must not donate the flag's boundary

**Files:**

- Modify: `.claude/hooks/guard-outward-cli.sh` — new constant near `:320`, and `:324`, `:653`, `:965`
- Test: `.claude/hooks/test-guard-outward-cli.sh`

**Interfaces:**

- Consumes: `scan_both` (`:621`), `gh_pr_clause_has_repo` (`:357`).
- Produces: `_OUT_FLAG_LEAD` — a shared leading-boundary alternation used by all three flag checks. Later tasks do not read it.

> **Test-family constraint, from spec §2.1.** Do **not** write these assertions on `gh pr merge`. Any `$` in the merge clause makes `--auto` unverifiable at `:928` and denies before `:965` runs, so a merge-family assertion passes without this fix. Use `eas build --auto-submit` and `gh pr create|comment --repo`.

- [ ] **Step 1: Write the failing tests**

```bash
# ---------- 2026-09-05: C1 — default-value expansion donates the boundary ----
# `${x:---repo}` is `${x:-` followed by a REAL two-dash `--repo`. The `-` that
# the `:-` operator contributes sits immediately before the flag, so a boundary
# class rejecting a preceding dash never matches — while argv genuinely carries
# the flag. `${x:+...}` and `${x:=...}` are unaffected: `+` and `=` already pass
# the class, which is what isolates the default-value operator family as the
# cause rather than leaving it a regex-reading guess.
#
# NOT written on the `gh pr merge` family ON PURPOSE: any `$` in the merge
# clause denies at :928 before the --admin check at :965 runs, so a merge-family
# assertion here would pass WITHOUT the fix and pin nothing.
assert_deny "eas build --auto-submit via \${x:-} denies" \
  "$(json 'eas build --platform ios ${x:---auto-submit}')" "eas build --auto-submit"
assert_deny "eas build --auto-submit via the no-colon form denies" \
  "$(json 'eas build --platform ios ${x---auto-submit}')" "eas build --auto-submit"
assert_deny "gh pr comment --repo via \${x:-} denies" \
  "$(json 'gh pr comment 5 --body hi ${x:---repo} other/org')" "--repo/-R writes to a DIFFERENT"
assert_deny "gh pr comment -R via \${x:-} denies" \
  "$(json 'gh pr comment 5 --body hi ${x:--R} other/org')" "--repo/-R writes to a DIFFERENT"
assert_deny "gh pr create --repo via \${x:-} denies" \
  "$(json 'gh pr create --title t --body b ${x:---repo} other/org')" "--repo/-R writes to a DIFFERENT"
# Negative controls — the alternative must be precise, not just wider.
assert_allow "a three-dash remainder is NOT the gated flag" \
  "$(json 'gh pr comment 5 --body hi ${x:----repo} other/org')"
assert_allow "an ordinary default-value expansion stays allowed" \
  "$(json 'echo ${HOME:-/tmp}')"
assert_allow "a default-value expansion of an unrelated flag stays allowed" \
  "$(json 'eslint ${FIX:---quiet} client/src')"
```

- [ ] **Step 2: Run the tests to verify they fail**

Expected: five `FAIL:` lines, `Results: 298 passed, 5 failed`.

- [ ] **Step 3: Add the shared leading-boundary constant**

Insert immediately before `_OUT_REPO_FLAG_RE` (currently `:324`):

```bash
# Leading boundary for the three DENY-ONLY flag checks. Two alternatives:
#   1. `^` or a character that is not part of a flag token — the original class.
#   2. A default-value parameter expansion's operator. Bash's `:-` and bare `-`
#      each consume one `-` from the source and leave the rest of the word as
#      the expansion, so `${x:---repo}` puts a literal `-` immediately before a
#      real `--repo`. `:+`, `:=` and `${#x}` are NOT here: `+`/`=` already pass
#      alternative 1, and `${#x}` never yields the flag at all.
# SAFE ONLY BECAUSE ALL THREE CONSUMERS ARE DENY-SHAPED. An added alternative
# can only ADD a deny; it can never grant a carve-out. Verified: scan_both's
# precondition (deny-shaped callers only) and gh_pr_clause_has_repo's own note
# ("--repo/-R only ever ADDS a deny"), whose two callers both call deny().
_OUT_FLAG_LEAD='(^|[^-A-Za-z0-9]|\$\{[A-Za-z_][A-Za-z0-9_]*:?-)'
```

- [ ] **Step 4: Route all three flag checks through it**

`:324`:

```bash
_OUT_REPO_FLAG_RE="${_OUT_FLAG_LEAD}"'(--repo([^-A-Za-z0-9]|$)|-R)'
```

`:653`:

```bash
   && scan_both "${_OUT_FLAG_LEAD}"'--auto-submit'; then
```

`:965`:

```bash
  if scan_both "${_OUT_FLAG_LEAD}"'--admin([^-A-Za-z0-9]|$)'; then
```

- [ ] **Step 5: Verify no fourth copy of the old class survives**

```bash
grep -n '(\^|\[\^-A-Za-z0-9\])' .claude/hooks/guard-outward-cli.sh
```

Expected: only the `_OUT_FLAG_LEAD` definition line. Any other hit is a site that was missed — widening a detector and leaving a consumer behind is this file's documented recurring defect.

- [ ] **Step 6: Run the tests to verify they pass**

Expected: `Results: 303 passed, 0 failed`.

- [ ] **Step 7: Mutation-test**

Revert `_OUT_FLAG_LEAD` to the bare `'(^|[^-A-Za-z0-9])'`, re-run, confirm exactly the five new `assert_deny` rows fail (`298 passed, 5 failed`), restore, confirm `303 passed, 0 failed`. Quote all three `Results:` lines.

- [ ] **Step 8: Commit**

`fix(hooks): close C1 — a default-value expansion no longer donates a flag boundary`, noting in the body that the merge family is deliberately not used for these assertions and why.

---

### Task 5: C2 — an unreadable `gh api` method denies

**Files:**

- Modify: `.claude/hooks/guard-outward-cli.sh` — insert before `:1103`
- Test: `.claude/hooks/test-guard-outward-cli.sh`

**Interfaces:**

- Consumes: `GH_API_CLAUSE` (`:1091`).
- Produces: no new symbols.

> **Ruled by the repository owner, 2026-09-05:** a non-literal method is unverifiable and denies. This block **allows by default** (an empty or unreadable clause silently allows), the opposite of the merge block, so the new branch must deny explicitly rather than fall through.

- [ ] **Step 1: Write the failing tests**

```bash
# ---------- 2026-09-05: C2 — a non-literal gh api method is unverifiable -----
# The method check requires the LITERAL text POST/PUT/PATCH/DELETE after the
# flag. An expansion is not that literal text, so `-X ${x:-POST}` fell through
# to this block's ALLOW default. Reuses the house rule already at :928 for the
# merge clause: a surviving `$` means the token cannot be read statically.
# Scoped to CO-OCCURRENCE with a method flag, so a dynamic ROUTE (no -X) is
# unaffected — the narrowing is the deliverable, not an afterthought.
assert_deny "gh api -X via a default-value expansion denies" \
  "$(json 'gh api repos/o/r -X ${x:-POST}')" "not literal text"
assert_deny "gh api -X via a bare variable denies" \
  "$(json 'gh api repos/o/r -X $METHOD')" "not literal text"
assert_deny "gh api --method via a substitution denies" \
  "$(json 'gh api repos/o/r --method $(printf PUT)')" "not literal text"
# Negative controls — this is the change's largest new over-denial surface.
assert_allow "read-only gh api with no method flag stays allowed" \
  "$(json 'gh api repos/o/r')"
assert_allow "gh api with a dynamic ROUTE but no method flag stays allowed" \
  "$(json 'gh api repos/$OWNER/$REPO')"
assert_allow "gh api -X GET stays allowed" \
  "$(json 'gh api repos/o/r -X GET')"
```

- [ ] **Step 2: Run the tests to verify they fail**

Expected: three `FAIL:` lines, `Results: 306 passed, 3 failed`.

- [ ] **Step 3: Insert the unverifiable-method branch**

Immediately before the existing `_GH_API_M='...'` line (`:1102`):

```bash
  # A method token that is not literal text cannot be read statically, and this
  # block ALLOWS by default — so an unreadable method must deny EXPLICITLY
  # rather than fall through. Same "cannot verify -> deny" rule the `gh pr
  # merge` CLAUSE applies at its own `$` test above.
  #
  # NARROWED to co-occurrence with a method FLAG on purpose. A bare `$` in the
  # clause is ordinary (`gh api repos/$OWNER/$REPO` is a read-only call with a
  # variable route); it is the combination of "a method flag is present" and
  # "something here is unreadable" that cannot be cleared.
  if grep -Eq '(^|[[:space:]])(-X|--method)' <<< "$GH_API_CLAUSE" \
     && printf '%s' "$GH_API_CLAUSE" | grep -qF '$'; then
    deny "guard-outward-cli: command-position 'gh api' with a method flag whose value is not literal text (an expansion or substitution) cannot be verified read-only — denying, the same 'cannot verify -> deny' rule the 'gh pr merge' --auto check applies. Read-only 'gh api' with no -X/--method is unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
  fi
```

- [ ] **Step 4: Run the tests to verify they pass**

Expected: `Results: 309 passed, 0 failed`.

- [ ] **Step 5: Mutation-test**

Comment out the new `if` block, re-run, confirm exactly the three new `assert_deny` rows fail (`306 passed, 3 failed`), restore, confirm `309 passed, 0 failed`.

- [ ] **Step 6: Commit**

`fix(hooks): close C2 — an unreadable gh api method denies`.

---

### Task 6: `cmd_words_vanished` — the vanished rendering (lib only)

**Files:**

- Modify: `.claude/hooks/lib/cmd-detect.sh` — add one function after `cmd_words_deep` (`:624`)
- Test: `.claude/hooks/test-cmd-detect.sh`

**Interfaces:**

- Consumes: `cmd_words` (lib `:278`).
- Produces: `cmd_words_vanished "$cmd"` → stdout, one line: the command text with every provably-empty-capable expansion deleted, then passed through `cmd_words`. Task 7 is its only caller.

> **Scope note (simplifies spec §7.2):** `cmd_extract_substitutions` is **not modified**. The deletable allow-list contains no braces by construction, so a scan-to-the-next-`}` plus a grammar test is provably sufficient — no balanced `${…}` walker is needed. The new function reuses the extractor's _state-machine shape_ (same four quote states, same depth stack), and a differential test in Step 5 pins the two scanners to the same notion of which spans are live.

- [ ] **Step 1: Write the failing tests**

Append to `.claude/hooks/test-cmd-detect.sh`, following the file's existing helper style. Add this helper first if the file has no equivalent:

```bash
# ---------- 2026-09-05: cmd_words_vanished -----------------------------------
van() {  # $1=name $2=input $3=expected output
  local got; got=$(cmd_words_vanished "$2")
  if [ "$got" = "$3" ]; then echo "PASS: $1"; PASS=$((PASS+1))
  else echo "FAIL: $1"; echo "  in:  $2"; echo "  got: $got"; echo "  want: $3"; FAIL=$((FAIL+1)); fi
}

# Deletable: forms PROVABLY capable of expanding to the empty string.
van 'bare parameter vanishes'        'gh pr me${UNSET}rge 42' 'gh pr merge 42'
van 'empty substitution vanishes'    'gh pr me$()rge 42'      'gh pr merge 42'
van 'empty backticks vanish'         'gh pr me``rge 42'       'gh pr merge 42'
van 'indirect parameter vanishes'    'gh pr me${!i}rge 42'    'gh pr merge 42'
van 'empty default vanishes'         'gh pr me${x:-}rge 42'   'gh pr merge 42'
van 'empty no-colon default vanishes' 'gh pr me${x-}rge 42'   'gh pr merge 42'
van 'prefix sigil vanishes'          '${UNSET} gh pr merge'   ' gh pr merge'
van 'suffix sigil vanishes'          'eas update$() --branch p' 'eas update --branch p'
van 'non-empty substitution body goes too' 'gh pr me$(printf x)rge' 'gh pr merge'

# NOT deletable — an expansion form must be PROVEN capable of evaluating to
# empty before it may be neutralized, not merely opened with `${`
# (lib/cmd-detect.sh's cmd_git_branch_create_segment residual item 4). Deleting
# a never-empty form MANUFACTURES a clean match for text that never executes.
van 'length expansion is never empty' 'gh pr ${#x}merge'      'gh pr ${#x}merge'
van 'non-empty default is never empty' 'gh api -X ${x:-POST}' 'gh api -X ${x:-POST}'
van 'nested braces are left verbatim' 'gh pr ${a:-${b}}merge' 'gh pr ${a:-}merge'

# Quote state must be respected: an INERT span is not a live expansion, and
# deleting one would manufacture a verb the shell never builds.
van 'single-quoted sigil is inert'   "echo 'me\${x}rge'"      "echo me\${x}rge"
van 'single-quoted substitution inert' "echo 'me\$()rge'"     "echo me\$()rge"
van 'double-quoted substitution is LIVE' 'echo "me$()rge"'    'echo merge'

# Unbalanced input must not over-delete: emit nothing rather than swallow.
van 'unbalanced substitution emits nothing' 'gh pr merge $(foo' ''
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bash .claude/hooks/test-cmd-detect.sh 2>&1 | grep -E '^(FAIL|Results)' | head -20
```

Expected: every new row fails with `cmd_words_vanished: command not found`. Record the `Results:` line.

- [ ] **Step 3: Implement `cmd_words_vanished`**

Add after `cmd_words_deep` (lib `:624`):

```bash
# cmd_words_vanished <cmd> -- a rendering in which every construct PROVABLY
# capable of expanding to the empty string is DELETED, so a verb split by a
# vanishing sigil rejoins into the word bash actually builds. Closes the
# mid-token case (`me` + vanishing sigil + `rge` -> argv `merge`), which no
# boundary character class can reach because the verb is SPLIT, not bounded.
#
# DENY-SHAPED CONSUMERS ONLY. Over-deletion here produces an over-DENIAL (a
# `${x}` that is actually set renders a word the shell would not build), which
# is the safe direction for a deny gate and the unsafe direction for a segment
# extractor -- which is why this is a separate rendering and not a change to
# cmd_words.
#
# THE ALLOW-LIST IS THE POINT. An expansion form must be proven capable of
# evaluating to EMPTY before it may be deleted, not merely opened with `${`
# (see cmd_git_branch_create_segment's KNOWN RESIDUALS item 4: a pass that
# deleted `${#x}` -- always a non-empty digit string -- manufactured a clean
# boundary for text that can never execute, and was reverted). Deletable:
#   ${name}  ${!name}  ${name:-}  ${name-}  ${name:+}  ${name+}  ${name:=}
#   ${name=}  $(...)  `...`
# Left verbatim: everything else, ${#name} foremost.
#
# NO BALANCED-BRACE WALK IS NEEDED, and that is not an oversight: every
# deletable body above is brace-free by construction, so scanning to the next
# `}` and testing the body against the grammar is provably sufficient. A nested
# form (`${a:-${b}}`) fails the grammar test and is left alone -- a safe MISS,
# never a false match.
#
# ORDER IS LOAD-BEARING: `${...}` is tested BEFORE the `$(...)` walk descends,
# never after. Reversed, `${x:-$(echo hi)}` -- which can never be empty -- has
# its inner substitution deleted first, leaving `${x:-}`, which then matches the
# empty-default grammar and is deleted too. Two individually-correct passes
# composing into exactly the regression this allow-list exists to prevent.
#
# Quote states mirror cmd_extract_substitutions exactly (0 unquoted, 1 single,
# 2 double, 3 ANSI-C): a substitution inside single quotes is INERT and must
# survive, or the rendering forges a verb the shell never builds.
cmd_words_vanished() {
  printf '%s' "$1" | awk '
    BEGIN { SQ = sprintf("%c", 39); DQ = "\""; BS = "\\"; BT = sprintf("%c", 96) }
    { buf = buf $0 "\n" }
    END {
      n = length(buf); depth = 0; state[0] = 0; out = ""
      for (i = 1; i <= n; i++) {
        c = substr(buf, i, 1); d = depth; s = state[d]
        if (s == 0 || s == 2) {
          if (c == BS) {
            if (d == 0) out = out c
            i++
            if (i <= n && d == 0) out = out substr(buf, i, 1)
            continue
          }
          if (c == "$" && i < n && substr(buf, i+1, 1) == "{") {
            j = index(substr(buf, i+2), "}")
            if (j > 0) {
              body = substr(buf, i+2, j-1)
              if (body ~ /^!?[A-Za-z_][A-Za-z0-9_]*$/ || \
                  body ~ /^[A-Za-z_][A-Za-z0-9_]*(:?[-+=])?$/) {
                i = i + 1 + j
                continue
              }
            }
            if (d == 0) out = out c
            continue
          }
          if (c == "$" && i < n && substr(buf, i+1, 1) == "(") {
            depth++; state[depth] = 0; kind[depth] = "P"; i++
            continue
          }
          if (c == BT) {
            if (d >= 1 && kind[d] == "B") depth--
            else { depth++; state[depth] = 0; kind[depth] = "B" }
            continue
          }
          if (c == ")" && d >= 1 && kind[d] == "P") { depth--; continue }
        }
        if (s == 0) {
          if (c == "$" && i < n && (substr(buf, i+1, 1) == SQ || substr(buf, i+1, 1) == DQ)) {
            if (substr(buf, i+1, 1) == SQ) state[d] = 3; else state[d] = 2
            if (d == 0) out = out c substr(buf, i+1, 1)
            i++
          }
          else if (c == SQ) { state[d] = 1; if (d == 0) out = out c }
          else if (c == DQ) { state[d] = 2; if (d == 0) out = out c }
          else { if (d == 0) out = out c }
        }
        else if (s == 1) { if (d == 0) out = out c; if (c == SQ) state[d] = 0 }
        else if (s == 3) {
          if (c == BS) {
            if (d == 0) out = out c
            i++
            if (i <= n && d == 0) out = out substr(buf, i, 1)
          }
          else if (c == SQ) { state[d] = 0; if (d == 0) out = out c }
          else { if (d == 0) out = out c }
        }
        else {
          if (c == DQ) { state[d] = 0; if (d == 0) out = out c }
          else { if (d == 0) out = out c }
        }
      }
      # Unbalanced input swallowed the tail. Over-deletion is the direction that
      # MANUFACTURES matches, so emit nothing rather than a truncated rendering.
      if (depth >= 1) exit
      sub(/\n$/, "", out)
      printf "%s", out
    }' | cmd_words
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
bash .claude/hooks/test-cmd-detect.sh 2>&1 | tail -2
```

Expected: all new rows pass; `Results:` total up by 17, 0 failed.

- [ ] **Step 5: Add the differential test against the existing scanner**

The one real risk in this task is a second scanner drifting from the shared one — "precisely how `GH_API_CLAUSE` came to be missed." Pin them to the same notion of liveness:

```bash
# Differential pin: cmd_words_vanished and cmd_extract_substitutions must agree
# on WHICH substitution spans are live. If the extractor emits a body, the
# vanisher must have deleted that span (the body text is gone from its output);
# if the extractor emits nothing, the vanisher must not have deleted one.
diff_live() {  # $1=name $2=input $3=yes|no (extractor sees a live span)
  local bodies got
  bodies=$(printf '%s' "$2" | cmd_extract_substitutions | tr -d '\n')
  got=$(cmd_words_vanished "$2")
  if [ "$3" = yes ] && [ -n "$bodies" ] && [ "${got#*"$bodies"}" = "$got" ]; then
    echo "PASS: $1"; PASS=$((PASS+1))
  elif [ "$3" = no ] && [ -z "$bodies" ]; then
    echo "PASS: $1"; PASS=$((PASS+1))
  else
    echo "FAIL: $1"; echo "  bodies: [$bodies]"; echo "  vanished: [$got]"; FAIL=$((FAIL+1))
  fi
}
diff_live 'live substitution: both scanners agree'   'gh pr me$(printf x)rge' yes
diff_live 'inert substitution: both scanners agree'  "echo 'me\$(printf x)rge'" no
diff_live 'double-quoted substitution is live in both' 'echo "me$(printf x)rge"' yes
```

Run and confirm three more passes.

- [ ] **Step 6: Confirm no existing pin moved**

`test-cmd-detect.sh:625`, `:627` and `:629` pin the _reverted_ deletion pass's safe-miss behaviour on `cmd_is_git_branch_create` / `cmd_git_branch_create_segment`, which read plain `cmd_words`. Adding a new function must not touch them:

```bash
bash .claude/hooks/test-cmd-detect.sh 2>&1 | grep -E '^FAIL' || echo "no failures"
bash scripts/run-hook-tests.sh 2>&1 | tail -2
```

Expected: `no failures` and `✓ 34 hook self-tests passed`. **If a `${x}checkout` / `${#x}` / `${a:-${b}}` pin flips, stop.** That is a decision about the reverted pass's safe-miss behaviour, not a fix to absorb here — report it.

- [ ] **Step 7: Commit**

`feat(hooks): add cmd_words_vanished, a rendering with provably-empty expansions deleted`.

---

### Task 7: Wire the vanished rendering into the guard, on a split surface

**Files:**

- Modify: `.claude/hooks/guard-outward-cli.sh:591` (renderings), the boolean matchers, `:742`, `:992`, `:1041` (counters), `:1091` (api clause)
- Test: `.claude/hooks/test-guard-outward-cli.sh`

**Interfaces:**

- Consumes: `cmd_words_vanished` from Task 6.
- Produces: `$WORDS_VANISHED`, `$WORDS_SCAN`, and `_out_max_count <regex>`.

> **Why the surface is split.** Each of `GH_PR_MERGE_OCCURRENCES` (`:742`), `GH_PR_CREATE_OCCURRENCES` (`:992`) and `GH_API_OCCURRENCES` (`:1041`) gates a `>1 ⇒ deny` ambiguity branch. Appending a whole-command rendering to `$WORDS_DEEP` would double every verb occurrence, so an ordinary single invocation would count 2 and deny — a mass over-denial. But the counters cannot be skipped either: the merge and `gh api` blocks are _gated behind_ them, so a mid-token verb only the vanished rendering can see must still raise its block's count from 0 to 1. Hence: boolean matchers read the union; counters take the maximum of per-rendering counts.

- [ ] **Step 1: Write the failing tests**

```bash
# ---------- 2026-09-05: vanishing sigil, all three positions -----------------
# Ruled 2026-09-03, option (a): close suffix, prefix AND mid-token. Suffix is a
# closer-class widening (Task 2 above). Prefix and mid-token are not — bash
# consumes the whole balanced sigil, and mid-token SPLITS the verb, so there is
# no boundary to widen. Closed by the vanished rendering instead.
assert_deny "mid-token backtick pair denies" \
  "$(json 'gh pr me``rge 42')" "without a REAL --auto flag"
assert_deny "mid-token empty substitution denies" \
  "$(json 'gh pr me$()rge 42')" "without a REAL --auto flag"
assert_deny "mid-token unset parameter denies" \
  "$(json 'gh pr me${UNSET}rge 42')" "without a REAL --auto flag"
assert_deny "mid-token split in an eas verb denies" \
  "$(json 'eas up${UNSET}date --branch preview')" "eas update/publish/submit"
assert_deny "prefix vanishing substitution denies" \
  "$(json '$() gh pr merge 42')" "without a REAL --auto flag"
assert_deny "prefix vanishing parameter denies" \
  "$(json '${UNSET} gh pr merge 42')" "without a REAL --auto flag"
assert_deny "mid-token split reaches the gh api block" \
  "$(json 'gh a${UNSET}pi repos/o/r -X POST')" "mutating HTTP method"
# Counter controls — the union must NOT reach the occurrence counters.
assert_allow "a single ordinary gh api call is still counted once" \
  "$(json 'gh api repos/o/r')"
assert_allow "a single automerge call is still counted once" \
  "$(json 'gh pr merge 42 --auto')"
assert_allow "a single gh pr create is still counted once" \
  "$(json 'gh pr create --title t --body b')"
assert_deny "two gh api occurrences still read as ambiguous" \
  "$(json 'gh api repos/o/r && gh api -X PUT repos/o/r/pulls/1/merge')" "more than one command-position 'gh api'"
```

- [ ] **Step 2: Run the tests to verify they fail**

Expected: seven `FAIL:` lines (the seven new `assert_deny` rows), four passes among the controls.

- [ ] **Step 3: Add the rendering and the union**

After `:591` (`WORDS_DEEP=$(cmd_words_deep "$CMD")`):

```bash
# A THIRD rendering: every construct provably capable of expanding to empty is
# DELETED, so a verb split by a vanishing sigil rejoins (`me` + sigil + `rge`
# -> `merge`). This is the INVERSE of cmd_words_deep, which APPENDS substitution
# bodies so a verb hiding inside one is seen. Both are needed and they must stay
# separate lines — collapsing one into the other loses a whole family.
WORDS_VANISHED=$(cmd_words_vanished "$CMD")

# Union, for BOOLEAN detection only. The occurrence counters below must NOT
# read this: appending a whole-command rendering doubles every verb occurrence,
# so an ordinary single invocation would count 2 and trip the ">1 is ambiguous"
# deny. They use _out_max_count instead.
WORDS_SCAN="$WORDS_DEEP
$WORDS_VANISHED"

# Occurrence count across both renderings, taking the LARGER. Preserves the
# ambiguity semantics (two real invocations still count 2) while letting a verb
# only the vanished rendering can see raise its block's count from 0 to 1 —
# without which the merge and gh api blocks, both gated behind their counters,
# are never entered at all.
_out_max_count() {  # $1=regex
  local a b
  a=$(printf '%s' "$WORDS_DEEP"     | grep -oiE "$1" | wc -l | tr -d '[:space:]')
  b=$(printf '%s' "$WORDS_VANISHED" | grep -oiE "$1" | wc -l | tr -d '[:space:]')
  if [ "${a:-0}" -ge "${b:-0}" ]; then printf '%s' "${a:-0}"; else printf '%s' "${b:-0}"; fi
}
```

- [ ] **Step 4: Convert the boolean matchers to the union**

Enumerate them first — a naive grep also matches `_OUT_POS_SUFFIX_MERGE_CLAUSE`, and the detector/consumer pair at `:1032`/`:1091` is where a previous round already went wrong:

```bash
grep -n 'grep -Eqi .* <<< "\$WORDS_DEEP"' .claude/hooks/guard-outward-cli.sh
```

Replace `<<< "$WORDS_DEEP"` with `<<< "$WORDS_SCAN"` on **only** the lines that command lists — the `grep -Eqi` boolean forms. Leave every `grep -oiE … | wc -l` (counters) and every clause extraction alone.

- [ ] **Step 5: Convert the three counters to `_out_max_count`**

`:742`:

```bash
GH_PR_MERGE_OCCURRENCES=$(_out_max_count "$GH_PR_MERGE_RE")
```

`:992`:

```bash
GH_PR_CREATE_OCCURRENCES=$(_out_max_count "$GH_PR_CREATE_RE")
```

`:1041`:

```bash
GH_API_OCCURRENCES=$(_out_max_count "$GH_API_RE")
```

- [ ] **Step 6: Give the `gh api` clause a vanished fallback**

The `gh api` block allows by default when its clause is empty, so a mid-token verb that only raised the count via the vanished rendering would fall straight through to ALLOW. At `:1091`, after the existing assignment:

```bash
  # The count may have come from the vanished rendering (a split verb), in which
  # case the deep rendering yields no clause and this ALLOW-by-default block
  # would fall through. Retry on the vanished rendering. Safe because this
  # clause is DENY-shaped: over-capture can only ever ADD a deny.
  if [ -z "$GH_API_CLAUSE" ]; then
    GH_API_CLAUSE=$(printf '%s' "$WORDS_VANISHED" | grep -oiE "${_OUT_POS_PREFIX}gh[[:space:]]+api${_OUT_POS_SUFFIX}[^;&|]*" | head -1)
  fi
```

- [ ] **Step 7: Run the tests to verify they pass**

Expected: all new rows pass, 0 failed.

- [ ] **Step 8: Prove the counters did not start double-counting**

This is the specific mass-over-denial this task's design exists to avoid, so measure it rather than trust it:

```bash
bash .claude/hooks/repro-outward-cli-corpus.sh | grep -E '^fp-'
```

Expected: every `fp-*` row still reads `ALLOW` with note `ok`. A single `fp-*` flip to DENY means the union reached a counter.

- [ ] **Step 9: Mutation-test, both mechanisms separately**

First the rendering: stub `cmd_words_vanished` to `printf ''`, re-run, confirm the seven new `assert_deny` rows fail, restore.

Then the `max()`: change `_out_max_count` to return only `${a:-0}`, re-run, confirm the merge/api mid-token rows fail while the rest hold, restore. Quote every `Results:` line.

- [ ] **Step 10: Commit**

`fix(hooks): close the vanishing-sigil class at all three positions`.

---

### Task 8: Narrow deny for a synthesized verb (precise path)

**Files:**

- Modify: `.claude/hooks/guard-outward-cli.sh` — new block after the last invocation matcher
- Test: `.claude/hooks/test-guard-outward-cli.sh`

**Interfaces:**

- Consumes: `$WORDS_SCAN`, `_OUT_POS_PREFIX`.
- Produces: `_OUT_EXPANSION_TOKEN`.

> **Ruled 2026-09-03, option (c):** deny only when an expansion sits in command position **and** the surrounding shape already smells outward-facing (a gated binary name is present but the verb is not literal). The ruling is explicit that **where the line falls is the deliverable**, not settled by the ruling. Never evaluate the expansion.

- [ ] **Step 1: Write the failing tests**

```bash
# ---------- 2026-09-05: narrow deny — a synthesized verb ---------------------
# The guard is a static-text matcher; the shell produces the real token at
# expansion time. No boundary widening reaches this: the verb text simply is
# not present. Ruled option (c): deny only where a gated BINARY is present and
# the VERB is not literal. A bare expansion in command position is NOT denied.
assert_deny "gh pr with a default-value verb denies" \
  "$(json 'gh pr ${v:-merge} 42')" "verb is not literal"
assert_deny "gh pr with a no-colon default verb denies" \
  "$(json 'gh pr ${v-merge} 42')" "verb is not literal"
assert_deny "gh pr with an indirect verb denies" \
  "$(json 'gh pr ${!ind} 42')" "verb is not literal"
assert_deny "gh pr with a substituted verb denies" \
  "$(json 'gh pr $(printf merge) 42')" "verb is not literal"
assert_deny "a synthesized eas binary denies" \
  "$(json '${e:-eas} update --branch preview')" "verb is not literal"
assert_deny "eas with a synthesized subcommand denies" \
  "$(json 'eas ${v:-update} --branch preview')" "verb is not literal"
# Negative controls — the NARROWING is the deliverable.
assert_allow "a bare expansion in command position stays allowed" \
  "$(json '${EDITOR:-vim} notes.txt')"
assert_allow "an expansion as an ARGUMENT stays allowed" \
  "$(json 'gh pr view ${NUM:-42}')"
assert_allow "npm run with a variable script name stays allowed" \
  "$(json 'npm run ${SCRIPT:-build}')"
assert_allow "a for-loop variable near a read-only verb stays allowed" \
  "$(json 'for b in preview; do gh pr view $b; done')"
```

- [ ] **Step 2: Run the tests to verify they fail**

Expected: six `FAIL:` lines.

- [ ] **Step 3: Implement the predicate**

Add after the last existing invocation matcher, before the `gh pr merge` block:

```bash
# --- narrow deny: a gated binary with a NON-LITERAL verb ---------------------
# Ruled 2026-09-03 (option c). Two shapes, both requiring the outward-facing
# smell to already be present — a bare expansion in command position is NOT
# denied, which is what makes this narrow rather than deny-by-default:
#   (a) a gated BINARY in command position, immediately followed by an
#       expansion where the verb belongs;
#   (b) an expansion in command position, immediately followed by a gated VERB.
# Never evaluates the expansion — that mechanism is ruled out in both sibling
# todos and would itself be the vulnerability.
_OUT_EXPANSION_TOKEN='(\$\{[^}]*\}|\$\([^)]*\)|`[^`]*`|\$[A-Za-z_][A-Za-z0-9_]*)'
_OUT_GATED_BIN='(eas|railway|npm|pnpm|yarn|gh)'
_OUT_GATED_VERB='(update|publish|submit|build|up|deploy|redeploy|restart|down|delete|remove|rm|run|pr|release|repo|api)'
if grep -Eq "${_OUT_POS_PREFIX}${_OUT_GATED_BIN}[[:space:]]+${_OUT_EXPANSION_TOKEN}" <<< "$WORDS_SCAN" \
   || grep -Eq "${_OUT_POS_PREFIX}${_OUT_GATED_BIN}[[:space:]]+pr[[:space:]]+${_OUT_EXPANSION_TOKEN}" <<< "$WORDS_SCAN" \
   || grep -Eq "${_OUT_POS_PREFIX}${_OUT_EXPANSION_TOKEN}[[:space:]]+${_OUT_GATED_VERB}([[:space:]]|$)" <<< "$WORDS_SCAN"; then
  deny "guard-outward-cli: an outward-facing CLI is named in command position but the verb is not literal text (an expansion or substitution supplies it), so this hook cannot tell a read-only call from a mutating one — denying, per the 2026-09-03 narrow-deny ruling. A literal verb is unaffected. Bypass: ALLOW_OUTWARD_CLI=1 (one command)."
fi
```

- [ ] **Step 4: Run the tests to verify they pass**

Expected: all rows pass, 0 failed.

- [ ] **Step 5: Measure the false-positive population by execution**

The ruling requires this and forbids estimating it. Harvest real historical commands, run both hooks, diff the decisions:

```bash
git stash
jq -r 'select(.message.content[]?.name == "Bash") | .message.content[]?.input.command // empty' \
  ~/.claude/projects/-Users-williamtower-projects-OCRecipes/*.jsonl 2>/dev/null \
  | sort -u > /tmp/harvest-old.txt
wc -l < /tmp/harvest-old.txt
```

Record the harvested count. Then run every harvested command against the pre-change hook (stashed tree) and the post-change hook, and diff:

```bash
while IFS= read -r c; do
  printf '%s\t%s\n' "$(jq -cn --arg cmd "$c" '{tool_name:"Bash",tool_input:{command:$cmd}}' | bash .claude/hooks/guard-outward-cli.sh 2>/dev/null | grep -c deny)" "$c"
done < /tmp/harvest-old.txt > /tmp/decisions-old.txt
git stash pop
while IFS= read -r c; do
  printf '%s\t%s\n' "$(jq -cn --arg cmd "$c" '{tool_name:"Bash",tool_input:{command:$cmd}}' | bash .claude/hooks/guard-outward-cli.sh 2>/dev/null | grep -c deny)" "$c"
done < /tmp/harvest-old.txt > /tmp/decisions-new.txt
diff /tmp/decisions-old.txt /tmp/decisions-new.txt | head -40
```

Report **every** command whose decision flips, with counts. State the harvested total.

**A corpus containing zero instances of a construct is evidence about that construct's frequency, not about the fix's safety.** If the harvest yields no `gh api … -X $VAR`, record that the over-denial is accepted on "this shape does not occur in practice here" grounds — explicitly, in the residuals — rather than as a measured-zero false-positive rate. This position was approved 2026-09-05.

- [ ] **Step 6: Mutation-test**

Comment out the new `if`, re-run, confirm exactly the six new `assert_deny` rows fail, restore.

- [ ] **Step 7: Commit**

`fix(hooks): narrow deny when a gated binary's verb is not literal`.

---

### Task 9: Close the degraded-path fail-open

**Files:**

- Modify: `.claude/hooks/guard-outward-cli.sh:384-402` (`crude_smells_outward`)
- Test: `.claude/hooks/test-guard-outward-cli.sh`

**Interfaces:**

- Consumes: nothing from earlier tasks (this function runs before the lib is sourced).
- Produces: no new symbols.

> The expansion ruling hardens the todo's disjunctive AC into a requirement: _"The no-`jq` degraded path must be closed too… A narrow deny that exists only on the precise path leaves the degraded path exactly as open as option (b) would have."_ The verified cause is that letters inside an expansion break the `[^a-zA-Z]+` separator class at `:397`.

- [ ] **Step 1: Write the failing tests**

Append inside the degraded-path section, after the existing `no-jq:` rows. **Assert reasons on the new rows** — `check`'s deny branch matches only the generic marker, so a deny for the wrong reason passes:

```bash
# ---------- 2026-09-05: degraded path must not fail open on an expansion -----
# crude_smells_outward()'s [^a-zA-Z]+ separator class is broken by the letters
# INSIDE an expansion, so the fallback that exists precisely to fail closed did
# not catch a synthesized verb. Verified fail-open, 2026-09-02.
check "no-jq: synthesized gh pr verb fails closed" \
  deny "$(nojq_hook "$(json 'gh pr ${v:-merge} 42')")"
check "no-jq: substituted gh pr verb fails closed" \
  deny "$(nojq_hook "$(json 'gh pr $(printf merge) 42')")"
check "no-jq: mid-token split verb fails closed" \
  deny "$(nojq_hook "$(json 'gh pr me${UNSET}rge 42')")"
check "no-lib: synthesized gh pr verb fails closed" \
  deny "$(nolib_hook "$(json 'gh pr ${v:-merge} 42')")"
check "no-awk: synthesized gh pr verb fails closed" \
  deny "$(noawk_hook "$(json 'gh pr ${v:-merge} 42')")"
# Negative controls — the degraded path is already stricter than the precise
# one, so a widening here must not reach ordinary commands.
check "no-jq: a benign command with a variable stays allowed" \
  allow "$(nojq_hook "$(json 'echo ${HOME:-/tmp}')")"
check "no-jq: git commit with a variable message stays allowed" \
  allow "$(nojq_hook "$(json 'git commit -m "$MSG"')")"
check "no-jq: ls with a variable path stays allowed" \
  allow "$(nojq_hook "$(json 'ls -la $DIR')")"
```

- [ ] **Step 2: Run the tests to verify they fail**

Expected: five `FAIL:` lines among the new `deny` rows; the three `allow` controls pass.

- [ ] **Step 3: Add the degraded-path mirror**

Insert into `crude_smells_outward`, **before** the existing `t=${t//\$/}` strip on `:395` (the `$` must still be present to be seen):

```bash
  # Degraded-path mirror of the precise narrow-deny rule. This function is
  # deliberately not quote- or grammar-aware, so it cannot tell WHICH expansion
  # supplies WHAT — but a gated binary name sharing a segment with an expansion
  # sigil is unverifiable here by construction, and this path's contract is to
  # fail CLOSED. Consistent with its existing posture, which already denies
  # every `gh api` and every `gh pr merge` regardless of flags.
  #
  # Runs BEFORE the `$` strip below, which is the only reason it can see the
  # sigil at all. The segment class [^;&|]* keeps it inside one command, so an
  # unrelated `$VAR` after a `&&` does not reach back to an earlier binary.
  grep -Eq '(^|[^a-zA-Z])(eas|railway|npm|pnpm|yarn|gh)[^;&|]*\$' <<< "$t" && return 0
```

- [ ] **Step 4: Run the tests to verify they pass**

Expected: all new rows pass, 0 failed.

- [ ] **Step 5: Confirm the two degraded-path states stay distinct**

The fail-open is verified for the **expansion** mechanism only. The sigil todo makes no such claim, and measurement agrees: boundary sigil forms already denied on all three degraded paths while mid-token forms allowed. Do not let one verified fail-open become a blanket claim:

```bash
bash .claude/hooks/repro-outward-cli-corpus.sh | grep -E '^(vsub|vvar|mid|syn)-'
```

Expected: NOJQ/NOLIB/NOAWK columns now all read DENY for the `syn-*` and `mid-*` rows. Record which were already denying before this task (from the Task 1 baseline) and which this task moved.

- [ ] **Step 6: Mutation-test**

Comment out the new `grep -Eq`, re-run, confirm exactly the five new degraded `deny` rows fail, restore.

- [ ] **Step 7: Commit**

`fix(hooks): close the crude_smells_outward fail-open on expansions`.

---

### Task 10: Disclosure sweep and todo amendments

**Files:**

- Modify: `.claude/hooks/guard-outward-cli.sh:227-248` and the `DOCUMENTED RESIDUALS` header
- Modify: `.claude/hooks/test-guard-outward-cli.sh:423-431`, `:465-471`
- Modify: `docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md`
- Modify: the three `todos/P0-2026-09-02-outward-cli-guard-*.md` files
- External: PR #910's body, gap #6

**Interfaces:** none — documentation only.

> One retraction, five sites, four artifacts, plus three todos. **Grep the claim; do not edit only the copy in front of you.**

- [ ] **Step 1: Find every copy before editing any**

```bash
grep -rn 'NOT fixed' .claude/hooks/ | head
grep -rn 'flagged for a human decision\|flagged 2026-09-02' .claude/hooks/ | head
grep -rn 'STALE AS OF 2026-09-02' .claude/hooks/ | head
```

Record the full list. Any site found here that is not in this task's file list is an additional copy — add it.

- [ ] **Step 2: Amend the guard's residuals bullet (`:227-248`)**

Change the two sub-bullets from "LIVE bypasses… NOT fixed here" to closed, keeping the historical account. Append, never delete:

```
#   * A verb GLUED TO A REDIRECT, no space required, on EITHER side — two
#     DIFFERENT mechanisms, both closed 2026-09-05 (previously live, and
#     previously recorded here as awaiting a human decision):
#       - trailing: `_OUT_POS_SUFFIX` and BOTH branches of
#         `_OUT_POS_SUFFIX_MERGE_CLAUSE` now include `<`/`>`, matching the
#         lib's `_CMD_POS_SUFFIX` exactly.
#       - leading: `_OUT_POS_PREFIX` now absorbs a leading redirect via the
#         lib's `_CMD_REDIR`, BY REFERENCE. The anchor definitions were
#         relocated below the lib source: interpolating `_CMD_REDIR` before
#         the source expands it to the empty string, which fails silently
#         OPEN with the suite still green.
```

- [ ] **Step 3: Add the new residuals**

Label each entry with **why** it is excluded — "excluded because never live" and "excluded because unhandled" read identically in a list and only one is safe:

```
#   * NEVER LIVE, not a gap: `${#x}`-glued forms. `${#x}` always yields a
#     non-empty digit string, so `gh pr ${#x}merge` runs `0merge` and is not an
#     invocation at all. It is excluded from cmd_words_vanished's allow-list
#     because INCLUDING it would manufacture a false match — the exact 2026-09-02
#     regression that got a deletion pass reverted. Nothing is missed here.
#   * UNHANDLED: a nested expansion (`${a:-${b}}`) fails the vanish allow-list's
#     grammar test and is left verbatim — a safe MISS, never a false match.
#   * UNHANDLED, NEW: flag SYNTHESIS as opposed to flag-text donation
#     (`${x:-$(printf -- --repo)}`). The narrow-deny rule targets VERBS; the
#     analogous flag case is a residual this change creates.
```

- [ ] **Step 4: Amend the two test-file prose blocks**

`test-guard-outward-cli.sh:423-431` and `:465-471` both describe the redirect gaps as live and unfixed. Rewrite both to point at the assertions that now cover them, and delete the "STALE AS OF 2026-09-02" marker only if the text it marks is genuinely gone.

- [ ] **Step 5: Amend the solutions-doc round-4 section**

Add a dated closing note to `docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md` recording that the `<`/`>` and leading-redirect gaps it disclosed were closed 2026-09-05, and by which mechanism.

- [ ] **Step 6: Amend the three todos — this is the binding record**

`docs/superpowers/` is gitignored, so the spec does not survive. These files do.

In `todos/P0-2026-09-02-outward-cli-guard-boundary-and-absorber-bypasses.md`:

- Retract the Impact sentence claiming a silent ALLOW for an administrator-override merge. Record that it now denies via the `$`-unverifiable guard at `:928`, with the two control commands that prove the attribution.
- Correct the Summary's claim that none of the four appears in `DOCUMENTED RESIDUALS`.
- Correct the Risk paragraph's claim that C1 touches a shared construct used by every flag check.
- Record that the "Do not fix the suffix side as part of this todo" fence was **lifted by the repository owner on 2026-09-05** when the three todos were folded.
- Set `status: done`.

In both decision todos: record the implementing branch, that all three sigil positions and the narrow-deny rule landed together under one corpus, and set `status: done`.

- [ ] **Step 7: Update PR #910's body**

Editing a merged PR body is a GitHub write and will meet this guard. Use the MCP tool, not a CLI:

```
mcp__github__update_pull_request  (load its schema with ToolSearch first)
```

Amend gap #6 to record closure and point at the new PR.

- [ ] **Step 8: Verify no stale copy survives**

```bash
grep -rn 'NOT fixed here' .claude/hooks/ || echo "clean"
grep -rn 'may never land' todos/P0-2026-09-02-outward-cli-guard-*.md || echo "clean"
```

Expected: `clean` for both.

- [ ] **Step 9: Commit**

`docs(hooks): sweep every copy of the retracted residual claims`.

---

### Task 11: Full verification and PR

**Files:** none modified.

- [ ] **Step 1: Run the complete corpus**

```bash
bash .claude/hooks/repro-outward-cli-corpus.sh | tail -3
```

Expected: `gaps=0`. Any remaining gap is either a fix that did not land or a row whose expectation was wrong — resolve it, do not explain it away.

- [ ] **Step 2: Run every hook suite**

```bash
bash .claude/hooks/test-guard-outward-cli.sh | tail -2
bash .claude/hooks/test-cmd-detect.sh | tail -2
bash scripts/run-hook-tests.sh 2>&1 | tail -2
```

Expected: 0 failed in each; `✓ 34 hook self-tests passed`. Quote the real `Results:` lines — the final guard-suite total should be roughly `280 + 60`.

- [ ] **Step 3: Pin the assertion total**

The suite's count is not pinned anywhere, so a silently-skipped assertion produces no failure. Add at the end of `test-guard-outward-cli.sh`, before the summary:

```bash
# Pin the total. Without this, an assertion that is silently skipped (a helper
# rename, an early return, a truncated file) produces no FAIL and the mutation
# evidence above rests on a number nothing defends. Update deliberately when
# adding assertions.
EXPECTED_TOTAL=<the real number from Step 2>
if [ $((PASS + FAIL)) -ne "$EXPECTED_TOTAL" ]; then
  echo "FAIL: assertion total is $((PASS + FAIL)), expected $EXPECTED_TOTAL — an assertion was skipped"
  FAIL=$((FAIL+1))
fi
```

Re-run and confirm still 0 failed.

- [ ] **Step 4: Push (the pre-push gate runs `preflight:fast` and writes the stamp)**

```bash
git push -u origin todo/P0-2026-09-05-outward-cli-guard-folded-repair
```

- [ ] **Step 5: Open the PR**

Use `mcp__github__create_pull_request`. The body must carry: the before/after corpus `gaps` numbers, every mutation `Results:` line, the harvested false-positive count from Task 8 Step 5 with every flipped decision, the three scope amendments, and the fact that the boundary todo's fence was lifted by the owner rather than contradicted.

This PR is `security`-labelled and must **not** be auto-merged. Surface it for individual review.

---

## Self-Review

**Spec coverage.** §2.1–2.4 corrections → Task 10 Step 6. §4.1 → Task 1. §4.2 → Tasks 2 and 3. §4.3 → Task 4. §4.4 → Task 5. §4.5 → Tasks 6 and 7. §4.6 → Tasks 8 and 9. §4.7 → Task 10. §5 corpus dimensions → Task 1 Step 2. §6 mutation/FP/pin → Tasks 2–9 mutation steps, Task 8 Step 5, Task 11 Step 3. §7.1–7.3 → Task 6 header note, Task 6 Step 6, Task 10 Step 6. §9 residuals → Task 10 Step 3.

**Spec amendment produced by this plan:** §7.2 committed to extending `cmd_extract_substitutions`. Task 6 does not — the deletable allow-list is brace-free by construction, so no balanced `${…}` walk is needed and the extractor is untouched. That is a strictly smaller scope amendment; update §7.2 to match.

**Type/name consistency.** `cmd_words_vanished` (Task 6) is called by that exact name in Task 7 Steps 3 and 9. `_out_max_count` (Task 7 Step 3) is used in Steps 5 and 9. `_OUT_FLAG_LEAD` (Task 4 Step 3) is used in Step 4 and mutated in Step 7. `$WORDS_SCAN` (Task 7 Step 3) is used in Task 7 Step 4 and Task 8 Step 3. `$WORDS_VANISHED` is used in Task 7 Steps 3, 5, 6 and Task 9 Step 5.

**Known open item, deliberately not resolved here:** Task 8's `_OUT_GATED_VERB` list is a starting predicate. The ruling states that where "already smells outward-facing" is drawn is engineering work it does not settle, so Task 8 Step 5's measured false-positive population is what refines it — the predicate is not final until that measurement runs.
