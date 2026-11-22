# LSP Utilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the TypeScript LSP the default for symbol-level work across the main session and symbol-working subagents, with automated cold-start warm-up, review/audit wiring, and an advisory grep-for-symbols nudge.

**Architecture:** Docs-and-prompts foundation (Phases 1–4, zero behavior risk) plus two small shell hooks. The canonical agent guidance lives in `docs/rules/lsp.md` between `LSP-AGENT-BLOCK` markers and is duplicated verbatim into 9 agent files; a drift-check enforces parity. The advisory nudge hook (Phase 5) is sequenced last because it is the only piece with false-positive tuning risk.

**Tech Stack:** Bash hooks (Claude Code `SessionStart` / `PostToolUse`), `jq`, `awk`, markdown docs, `typescript-language-server` 5.2.0 via the `LSP` tool, GitHub Actions (`ci.yml`).

**Spec:** `docs/superpowers/specs/2026-05-20-lsp-utilization-design.md`

---

## File Structure

- `docs/rules/lsp.md` — **new.** Canonical LSP rules + the single source-of-truth agent block (between markers). Source for the agent copies and the drift-check.
- `CLAUDE.md` — **modify** (local-only; gitignored). Expand the LSP bullet to point at `docs/rules/lsp.md` + dispatch-prompt rule.
- `.claude/hooks/inject-patterns.sh` — **modify.** One LSP line in the always-on DISCIPLINE preamble.
- `.claude/hooks/lsp-warmup.sh` — **new.** SessionStart hook; emits warm-up directive as `additionalContext`.
- `.claude/hooks/lsp-nudge.sh` — **new.** PostToolUse(Bash) advisory nudge; never blocks.
- `.claude/settings.json` — **modify.** Add the warm-up SessionStart entry and the nudge PostToolUse(Bash) matcher.
- `.claude/agents/{code-reviewer,architecture-specialist,database-specialist,api-specialist,performance-specialist,typescript-specialist,security-auditor,todo-executor,todo-researcher}.md` — **modify.** Append the canonical block (with markers).
- `scripts/check-lsp-agent-block.sh` — **new.** Drift-check: agent copies must equal the canonical block.
- `package.json` — **modify.** Add `lsp:check-agent-block` script.
- `.github/workflows/ci.yml` — **modify.** Run the drift-check in the lint job.
- `.claude/skills/audit/SKILL.md` — **modify.** LSP verification step for symbol-level findings.
- Memory `project_lsp_tooling.md` — **modify.** Describe the new system.

---

## Phase 1 — Knowledge base

### Task 1: Create `docs/rules/lsp.md` (canonical doc + agent block)

**Files:**

- Create: `docs/rules/lsp.md`

- [ ] **Step 1: Write the file**

```markdown
# LSP Rules

Binding rules for the TypeScript LSP (`LSP` tool) in OCRecipes. The backing
server is `typescript-language-server` 5.2.0; `tsconfig.json` has
`incremental: true`.

## Always

- Prefer the `LSP` tool over `grep` for find-references, go-to-definition,
  rename-safety, implementation lookup, and symbol-by-name search. It matches
  semantic identity and resolves the `@/` and `@shared/` path aliases; `grep`
  matches text (comments, strings, unrelated same-name identifiers).
- Warm the server with a throwaway `hover` as the first LSP action of a session.
  If any result looks impossibly small (e.g. `findReferences` returns only the
  definition), re-run the same query once — the second call is correct. Positions
  are 1-based (line and character).
- Use call hierarchy (`incomingCalls` / `outgoingCalls`) for impact analysis
  across the `routes → services → storage → db` layering — more precise than a
  flat `findReferences` list.
- Use `goToImplementation` for interface → concrete-impl on the storage facade
  (`server/storage/index.ts`).
- Use `workspaceSymbol` to jump to a symbol by name across the tree.

## Never

- Never rely on `grep` alone to assert a symbol is unused, or that a rename /
  signature change is safe — confirm with `findReferences` / call-hierarchy.
- Never treat the LSP as a type checker — it has no diagnostics operation. Type
  errors come from `npm run check:types` / CI.

## When grep is still correct

Plain-text / string searches, and `.sql`, config, and native (non-TypeScript)
files. The LSP is TypeScript-only.

## Delegating to non-editable agents

`Explore`, `Plan`, and `feature-dev:*` live in the plugin/harness layer and their
definitions cannot be edited. When dispatching symbol work to them, include the
LSP-first directive and the cold-start warm-up note in the dispatch prompt.

## Canonical agent block

The block below is the single source of truth, duplicated verbatim into each
symbol-working agent in `.claude/agents/`. **Edit it HERE only.** The drift-check
(`npm run lsp:check-agent-block`) fails if any agent copy diverges.

<!-- LSP-AGENT-BLOCK:START -->

## Tooling: LSP-First Symbol Navigation

This repo has the TypeScript LSP wired into the `LSP` tool. For any symbol-level
work, prefer it over `grep` — it matches semantic identity and resolves the `@/`
and `@shared/` path aliases; `grep` matches text (comments, strings, unrelated
same-name identifiers).

- **Find usages / rename-safety:** `findReferences` (not grep).
- **Jump to a definition:** `goToDefinition`.
- **Find interface implementations:** `goToImplementation` — e.g. the storage
  facade interface in `server/storage/index.ts` → its concrete modules.
- **Impact analysis across layers:** `incomingCalls` / `outgoingCalls` (call
  hierarchy) — trace `routes → services → storage → db` precisely instead of a
  flat reference list.
- **Locate a symbol by name across the repo:** `workspaceSymbol`.

**Cold-start gotcha:** the FIRST LSP query in a session often returns degraded
results (e.g. `findReferences` returns only the definition). Warm the server with
a throwaway `hover` first; if any result looks impossibly small, re-run the same
query once — the second call is correct. Positions are 1-based.

**Ceiling:** the LSP tool is navigation-only — no diagnostics operation, so type
errors still come from `npm run check:types` / CI. It is TypeScript-only: keep
using `grep` for `.sql`, config, native code, and plain-text searches.

<!-- LSP-AGENT-BLOCK:END -->
```

- [ ] **Step 2: Verify the file and markers exist**

Run: `awk '/LSP-AGENT-BLOCK:START/{f=1;next}/LSP-AGENT-BLOCK:END/{f=0}f' docs/rules/lsp.md | head -3`
Expected: prints the first lines of the block (`## Tooling: LSP-First Symbol Navigation` ...), non-empty.

- [ ] **Step 3: Commit**

```bash
git add docs/rules/lsp.md
git commit -m "docs: add docs/rules/lsp.md (LSP rules + canonical agent block)"
```

### Task 2: Wire CLAUDE.md + inject-patterns DISCIPLINE preamble

**Files:**

- Modify: `CLAUDE.md` (local-only; gitignored — do not expect it in `git status`)
- Modify: `.claude/hooks/inject-patterns.sh:117-124`

- [ ] **Step 1: Expand the LSP bullet in `CLAUDE.md`**

Find the existing bullet that begins "Prefer the `LSP` tool (TypeScript LSP plugin) over `grep`…" and append to it:

```
  See `docs/rules/lsp.md` for the full rules. Reach for the underused ops:
  `incomingCalls`/`outgoingCalls` (impact analysis across routes→services→storage→db),
  `goToImplementation` (storage-facade interface→impls), and `workspaceSymbol`
  (symbol-by-name). When delegating symbol work to non-editable agents (`Explore`,
  `Plan`, `feature-dev:*`), include the LSP-first + warm-up directive in the
  dispatch prompt. The LSP is navigation-only (no diagnostics) and TS-only.
```

- [ ] **Step 2: Add one LSP line to the DISCIPLINE preamble**

In `.claude/hooks/inject-patterns.sh`, inside the heredoc at lines 117–124, add a fifth bullet after the "Goal-driven execution." line (before the closing `EOF`):

```bash
- LSP-first. Before editing a shared symbol, check its blast radius with the LSP tool (findReferences / call-hierarchy), not grep — it resolves @/ and @shared/ aliases. See docs/rules/lsp.md.
```

- [ ] **Step 3: Verify the hook still emits valid JSON**

Run:

```bash
echo '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/foo.ts"}}' | bash .claude/hooks/inject-patterns.sh | jq -e '.hookSpecificOutput.additionalContext | contains("LSP-first")'
```

Expected: `true`

- [ ] **Step 4: Commit**

```bash
git add .claude/hooks/inject-patterns.sh
git commit -m "feat: add LSP-first reminder to edit-time discipline preamble"
```

(`CLAUDE.md` is gitignored; its edit is local-only and is not staged.)

---

## Phase 2 — Warm-up automation

### Task 3: SessionStart warm-up hook

**Files:**

- Create: `.claude/hooks/lsp-warmup.sh`
- Modify: `.claude/settings.json` (SessionStart array)

- [ ] **Step 1: Create the hook script**

```bash
#!/usr/bin/env bash
# SessionStart hook — inject a directive to warm the TypeScript LSP before first
# use. A shell hook cannot call the model-invoked LSP tool, so this automates the
# instruction; the model's first hover does the actual warming.
set -uo pipefail

MSG=$(cat <<'EOF'
[LSP warm-up] Your FIRST LSP action this session should be a throwaway `hover` on
a stable TypeScript symbol (e.g. a method in server/storage/index.ts, or
client/constants/theme.ts:210 withOpacity) to build the tsserver project graph.
The first findReferences/call-hierarchy is otherwise unreliable — if a result
looks impossibly small, re-run it once. Prefer the LSP tool over grep for symbol
work (see docs/rules/lsp.md).
EOF
)

jq -n --arg ctx "$MSG" \
  '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":$ctx}}'
```

- [ ] **Step 2: Make it executable and verify output**

Run:

```bash
chmod +x .claude/hooks/lsp-warmup.sh && bash .claude/hooks/lsp-warmup.sh | jq -e '.hookSpecificOutput.additionalContext | contains("warm-up")'
```

Expected: `true`

- [ ] **Step 3: Register the hook in settings.json**

In `.claude/settings.json`, append a third object to the `hooks.SessionStart` array (after the existing `worktree-deps.sh` entry):

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "bash .claude/hooks/lsp-warmup.sh",
      "timeout": 10,
      "statusMessage": "Priming LSP warm-up directive..."
    }
  ]
}
```

- [ ] **Step 4: Verify settings.json is valid JSON and contains the entry**

Run: `jq -e '.hooks.SessionStart[].hooks[].command | select(. == "bash .claude/hooks/lsp-warmup.sh")' .claude/settings.json`
Expected: prints the command string (non-error exit).

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/lsp-warmup.sh .claude/settings.json
git commit -m "feat: add SessionStart LSP warm-up directive hook"
```

---

## Phase 3 — Symbol-working agent prompts + drift-check

### Task 4: Append canonical block to the 9 symbol-working agents

**Files:**

- Modify: `.claude/agents/code-reviewer.md`, `architecture-specialist.md`, `database-specialist.md`, `api-specialist.md`, `performance-specialist.md`, `typescript-specialist.md`, `security-auditor.md`, `todo-executor.md`, `todo-researcher.md`

- [ ] **Step 1: Extract the canonical block (with markers) into a temp file**

Run:

```bash
awk '/<!-- LSP-AGENT-BLOCK:START -->/{f=1} f{print} /<!-- LSP-AGENT-BLOCK:END -->/{f=0}' docs/rules/lsp.md > /tmp/lsp-block.md
test -s /tmp/lsp-block.md && echo OK
```

Expected: `OK` (block including both marker lines captured).

- [ ] **Step 2: Append the block to each of the 9 agent files**

Run:

```bash
for a in code-reviewer architecture-specialist database-specialist api-specialist performance-specialist typescript-specialist security-auditor todo-executor todo-researcher; do
  printf '\n\n' >> ".claude/agents/$a.md"
  cat /tmp/lsp-block.md >> ".claude/agents/$a.md"
done
```

- [ ] **Step 3: Add the review-specific line to code-reviewer and security-auditor**

For `.claude/agents/code-reviewer.md` and `.claude/agents/security-auditor.md`, append immediately after the `<!-- LSP-AGENT-BLOCK:END -->` line (outside the markers, so the drift-check ignores it):

```markdown
**For review:** before flagging a symbol as unused, or asserting a rename / signature change is safe, confirm the blast radius with `findReferences` / call-hierarchy — do not rely on grep.
```

- [ ] **Step 4: Verify the block is present in all 9 files**

Run:

```bash
for a in code-reviewer architecture-specialist database-specialist api-specialist performance-specialist typescript-specialist security-auditor todo-executor todo-researcher; do
  grep -q "LSP-First Symbol Navigation" ".claude/agents/$a.md" && echo "$a OK" || echo "$a MISSING"
done
```

Expected: all 9 print `OK`.

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/code-reviewer.md .claude/agents/architecture-specialist.md .claude/agents/database-specialist.md .claude/agents/api-specialist.md .claude/agents/performance-specialist.md .claude/agents/typescript-specialist.md .claude/agents/security-auditor.md .claude/agents/todo-executor.md .claude/agents/todo-researcher.md
git commit -m "feat: add canonical LSP block to symbol-working agents"
```

### Task 5: Drift-check script + npm + CI wiring

**Files:**

- Create: `scripts/check-lsp-agent-block.sh`
- Modify: `package.json` (scripts)
- Modify: `.github/workflows/ci.yml` (lint job)

- [ ] **Step 1: Write the drift-check script**

```bash
#!/usr/bin/env bash
# Fails if any symbol-working agent's LSP block diverges from the canonical copy
# in docs/rules/lsp.md (compared between the LSP-AGENT-BLOCK markers).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/docs/rules/lsp.md"
AGENTS=(code-reviewer architecture-specialist database-specialist api-specialist \
        performance-specialist typescript-specialist security-auditor \
        todo-executor todo-researcher)

extract() {
  awk '/<!-- LSP-AGENT-BLOCK:START -->/{f=1;next} /<!-- LSP-AGENT-BLOCK:END -->/{f=0} f' "$1"
}

BLOCK="$(extract "$SRC")"
if [ -z "$BLOCK" ]; then
  echo "ERROR: canonical LSP block not found in $SRC" >&2
  exit 1
fi

FAIL=0
for a in "${AGENTS[@]}"; do
  FILE="$ROOT/.claude/agents/$a.md"
  if [ ! -f "$FILE" ]; then
    echo "DRIFT: $a.md not found" >&2; FAIL=1; continue
  fi
  if [ "$(extract "$FILE")" != "$BLOCK" ]; then
    echo "DRIFT: $a.md LSP block missing or divergent — re-sync from docs/rules/lsp.md" >&2
    FAIL=1
  fi
done

[ "$FAIL" -eq 0 ] && echo "LSP agent block: all 9 in sync"
exit $FAIL
```

- [ ] **Step 2: Make executable; run it (should pass after Task 4)**

Run: `chmod +x scripts/check-lsp-agent-block.sh && bash scripts/check-lsp-agent-block.sh`
Expected: `LSP agent block: all 9 in sync` and exit 0.

- [ ] **Step 3: Prove the check catches drift (negative test)**

Run:

```bash
cp .claude/agents/api-specialist.md /tmp/api-spec.bak
printf 'X' >> .claude/agents/api-specialist.md   # not inside markers — should still pass
bash scripts/check-lsp-agent-block.sh; echo "exit=$?"
# now corrupt inside the block:
sed -i.bak 's/LSP-First Symbol Navigation/LSP-First Symbol Nav DRIFT/' .claude/agents/api-specialist.md
bash scripts/check-lsp-agent-block.sh; echo "exit=$?"
cp /tmp/api-spec.bak .claude/agents/api-specialist.md; rm -f .claude/agents/api-specialist.md.bak
```

Expected: first run `exit=0`; second run prints `DRIFT: api-specialist.md ...` and `exit=1`; file restored.

- [ ] **Step 4: Add the npm script**

In `package.json`, add to `"scripts"`:

```json
"lsp:check-agent-block": "bash scripts/check-lsp-agent-block.sh"
```

- [ ] **Step 5: Wire into CI lint job**

In `.github/workflows/ci.yml`, in the job that runs `npm run lint`, add a step immediately after the lint step:

```yaml
- name: Check LSP agent block parity
  run: npm run lsp:check-agent-block
```

- [ ] **Step 6: Verify npm script runs**

Run: `npm run -s lsp:check-agent-block`
Expected: `LSP agent block: all 9 in sync`

- [ ] **Step 7: Commit**

```bash
git add scripts/check-lsp-agent-block.sh package.json .github/workflows/ci.yml
git commit -m "feat: add LSP agent-block drift-check (npm + CI)"
```

---

## Phase 4 — Review/audit pipeline (Claude-driven only)

### Task 6: Add LSP verification step to the audit skill

**Files:**

- Modify: `.claude/skills/audit/SKILL.md` (Phase 2 step 3, around lines 79–82)

- [ ] **Step 1: Augment Phase 2 step 3**

Find the "For each **genuinely new finding**, verify it exists in the current code:" block (it lists "Read the file…", "Grep for the pattern…"). Add a third sub-bullet:

```markdown
- For **symbol-level findings** (unused export, dead code, signature-change or
  rename impact), confirm with the LSP tool (`findReferences` / call-hierarchy),
  not grep — it resolves `@/` and `@shared/` aliases and avoids false
  "unused"/"safe to change" verdicts. (`kimi-review` / `kimi-multi-review` are
  an external model with no LSP access; this applies to Claude-driven
  verification only.) See `docs/rules/lsp.md`.
```

- [ ] **Step 2: Verify the edit is present**

Run: `grep -c "no LSP access" .claude/skills/audit/SKILL.md`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/audit/SKILL.md
git commit -m "feat: require LSP verification of symbol-level audit findings"
```

---

## Phase 5 — Nudge hook (advisory; FP-risk; last)

> **Output channel note (verify during Step 4):** an exit-0 PostToolUse hook's
> stderr is NOT fed back to the model; only `hookSpecificOutput.additionalContext`
> (exit 0) or stderr-on-exit-2 reaches it. The Bash command has already run, so
> neither blocks. This plan uses `additionalContext` (exit 0). If that channel is
> not surfaced in the installed Claude Code version, switch the final emit to
> `echo "$MSG" >&2; exit 2` (still non-blocking — the tool already executed).

### Task 7: PostToolUse advisory nudge hook

**Files:**

- Create: `.claude/hooks/lsp-nudge.sh`
- Create: `.claude/hooks/__tests__/lsp-nudge.test.sh` (fixture test)
- Modify: `.claude/settings.json` (PostToolUse array)

- [ ] **Step 1: Write the fixture test (it fails until the hook exists)**

```bash
#!/usr/bin/env bash
# Fixture tests for lsp-nudge.sh. A "nudge" = output contains "symbol search".
set -uo pipefail
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lsp-nudge.sh"
PASS=0; FAIL=0
run() { # $1=json  -> echoes hook stdout
  printf '%s' "$1" | bash "$HOOK" 2>/dev/null
}
expect_nudge() { # $1=desc $2=json
  if run "$2" | grep -q "symbol search"; then echo "ok: $1"; PASS=$((PASS+1));
  else echo "FAIL (expected nudge): $1"; FAIL=$((FAIL+1)); fi
}
expect_quiet() { # $1=desc $2=json
  if run "$2" | grep -q "symbol search"; then echo "FAIL (expected quiet): $1"; FAIL=$((FAIL+1));
  else echo "ok: $1"; PASS=$((PASS+1)); fi
}
exit0() { # $1=desc $2=json — hook must always exit 0
  printf '%s' "$2" | bash "$HOOK" >/dev/null 2>&1
  if [ $? -eq 0 ]; then echo "ok(exit0): $1"; PASS=$((PASS+1));
  else echo "FAIL(exit0): $1"; FAIL=$((FAIL+1)); fi
}

S='"session_id":"TESTSESSION"'
expect_nudge "camelCase grep on ts" "{$S,\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"grep -rn 'getUserById' server/ --include='*.ts'\"}}"
expect_quiet "plain text phrase"     "{$S,\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"grep -rn 'TODO fix later' server/\"}}"
expect_quiet "fixed-string -F"        "{$S,\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"grep -F 'getUserById' notes.txt\"}}"
expect_quiet "regex metachars"        "{$S,\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"grep -rn 'get.*ById' server/\"}}"
expect_quiet "non-Bash tool"          "{$S,\"tool_name\":\"Read\",\"tool_input\":{\"command\":\"grep getUserById\"}}"
expect_quiet "ci infra"               "{$S,\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"npm run ci:failed-logs\"}}"
exit0 "always exit 0 on nudge"        "{$S,\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"grep -rn 'parseRecipe' client/ --include='*.tsx'\"}}"

echo "---"; echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run the test — verify it fails (hook missing)**

Run: `chmod +x .claude/hooks/__tests__/lsp-nudge.test.sh && bash .claude/hooks/__tests__/lsp-nudge.test.sh; echo "exit=$?"`
Expected: failures / `exit=1` (hook does not exist yet).

- [ ] **Step 3: Write the hook**

```bash
#!/usr/bin/env bash
# PostToolUse(Bash) advisory — nudge toward the LSP for symbol searches.
# NEVER blocks: always exits 0. Throttled once-per-session-per-pattern.
set -uo pipefail

[ "${LSP_NUDGE_OFF:-0}" = "1" ] && exit 0

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0
SESSION=$(printf '%s' "$INPUT" | jq -re '.session_id' 2>/dev/null || echo nosess)

# Must invoke grep or rg.
printf '%s' "$CMD" | grep -Eq '(^|[|&; ])(grep|rg)([[:space:]]|$)' || exit 0
# Skip fixed-string/text intent and infra contexts.
printf '%s' "$CMD" | grep -Eq -- '(-F|--fixed-strings)' && exit 0
printf '%s' "$CMD" | grep -Eq 'ci:failed-logs|npm run |node_modules|[[:space:]]gh[[:space:]]' && exit 0

# Extract a quoted single-token pattern after grep/rg.
PATTERN=$(printf '%s' "$CMD" \
  | grep -Eo "(grep|rg)[^|]*" \
  | grep -Eo "([\"'])[A-Za-z_][A-Za-z0-9_]{2,}\1" \
  | head -n1 | tr -d "\"'")
[ -n "$PATTERN" ] || exit 0
# Pattern must contain no regex metacharacters (single bare token already, but guard).
printf '%s' "$PATTERN" | grep -Eq '[][().*+?^$\\|{}]' && exit 0
# Must look like a code identifier (camelCase / PascalCase / snake_case).
printf '%s' "$PATTERN" | grep -Eq '([a-z][A-Z]|_|^[A-Z][a-z])' || exit 0
# Must target TypeScript or be repo-wide (-r / no path).
printf '%s' "$CMD" | grep -Eq '\.tsx?|include=[^ ]*ts|-g [^ ]*ts|(^|[[:space:]])-r([[:space:]]|$)|-rn?' || exit 0

# Throttle: once per session per pattern.
STATE="/tmp/ocrecipes-lsp-nudge-${SESSION}"
touch "$STATE"
grep -qxF "$PATTERN" "$STATE" 2>/dev/null && exit 0
printf '%s\n' "$PATTERN" >> "$STATE"

jq -n --arg p "$PATTERN" '{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": ("Looks like a symbol search for `" + $p + "`. For accurate, alias-aware results prefer the LSP tool (findReferences / workspaceSymbol) over grep — see docs/rules/lsp.md.")
  }
}'
exit 0
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `chmod +x .claude/hooks/lsp-nudge.sh && bash .claude/hooks/__tests__/lsp-nudge.test.sh; echo "exit=$?"`
Expected: `PASS=7 FAIL=0` and `exit=0`.

- [ ] **Step 5: Verify the throttle suppresses a repeat**

Run:

```bash
rm -f /tmp/ocrecipes-lsp-nudge-THROT
J='{"session_id":"THROT","tool_name":"Bash","tool_input":{"command":"grep -rn '\''getUserById'\'' server/ --include='\''*.ts'\''"}}'
echo "$J" | bash .claude/hooks/lsp-nudge.sh | grep -c "symbol search"   # first: 1
echo "$J" | bash .claude/hooks/lsp-nudge.sh | grep -c "symbol search"   # repeat: 0
```

Expected: first prints `1`, second prints `0`.

- [ ] **Step 6: Register in settings.json PostToolUse**

In `.claude/settings.json`, add to the `hooks.PostToolUse` array a new matcher object (the array already has an `EnterWorktree` matcher):

```json
{
  "matcher": "Bash",
  "hooks": [
    {
      "type": "command",
      "command": "bash .claude/hooks/lsp-nudge.sh",
      "timeout": 10,
      "statusMessage": ""
    }
  ]
}
```

- [ ] **Step 7: Verify settings.json validity**

Run: `jq -e '.hooks.PostToolUse[] | select(.matcher=="Bash") | .hooks[].command | select(.=="bash .claude/hooks/lsp-nudge.sh")' .claude/settings.json`
Expected: prints the command string (non-error exit).

- [ ] **Step 8: Commit**

```bash
git add .claude/hooks/lsp-nudge.sh .claude/hooks/__tests__/lsp-nudge.test.sh .claude/settings.json
git commit -m "feat: add advisory LSP nudge hook for symbol greps"
```

---

## Phase 6 — Memory + branch review

### Task 8: Update memory and run full branch review

**Files:**

- Modify: `/Users/williamtower/.claude/projects/-Users-williamtower-projects-OCRecipes/memory/project_lsp_tooling.md`

- [ ] **Step 1: Update the LSP tooling memory**

Append a section to `project_lsp_tooling.md` summarizing: `docs/rules/lsp.md` is the canonical doc + agent-block source; 9 symbol-working agents carry the block (drift-checked via `npm run lsp:check-agent-block` + CI); SessionStart `lsp-warmup.sh` injects the warm-up directive; PostToolUse `lsp-nudge.sh` is an advisory, non-blocking grep-for-symbols nudge (opt-out `LSP_NUDGE_OFF=1`); audit skill verifies symbol-level findings via LSP; `kimi-review` excluded (no LSP access).

- [ ] **Step 2: Run the full branch review (per CLAUDE.md)**

Run:

```bash
kimi-review --scope "LSP utilization: docs/rules/lsp.md, warm-up + nudge hooks, agent blocks, drift-check, audit wiring" --base main --tiers CRITICAL,WARNING --profile ocrecipes
```

Expected: review output; resolve any CRITICAL before considering the branch done.

- [ ] **Step 3: Run drift-check + JSON validity as a final gate**

Run:

```bash
npm run -s lsp:check-agent-block && jq -e '.' .claude/settings.json >/dev/null && echo "FINAL OK"
```

Expected: `LSP agent block: all 9 in sync` then `FINAL OK`.

---

## Self-Review (against the spec)

- **Phase 1 (knowledge base):** Task 1 (`docs/rules/lsp.md` with all op guidance, cold-start, ceiling), Task 2 (CLAUDE.md bullet + DISCIPLINE line). ✔
- **Phase 2 (warm-up):** Task 3 (`lsp-warmup.sh` + SessionStart registration); honors the "shell can't call LSP → inject directive" constraint. ✔
- **Phase 3 (agents):** Task 4 (block into 9 agents + review line for code-reviewer/security-auditor), Task 5 (drift-check + npm + CI). Canonical block version-controlled in `docs/rules/lsp.md` with drift enforcement — matches the spec amendment. ✔
- **Phase 4 (review/audit):** Task 6 (audit skill LSP verification + explicit `kimi-review` exclusion). ✔
- **Phase 5 (nudge):** Task 7 (advisory, never-blocks, identifier heuristic, per-session-per-pattern throttle, `LSP_NUDGE_OFF` opt-out, infra skips), sequenced last. ✔
- **Cross-cutting:** Task 8 (memory update + branch review). ✔
- **Follow-up audit (post-Phase-5):** out of scope for this plan by design — it runs after the hook has been live (spec "Follow-up" section). Not a task here. ✔
- **Dispatch-prompt rule for non-editable agents:** documented in Task 1 (`docs/rules/lsp.md`) and Task 2 (CLAUDE.md). ✔
- **Placeholder scan:** all code/commands are concrete; no TBD/TODO. ✔
- **Naming consistency:** marker `LSP-AGENT-BLOCK`, script `scripts/check-lsp-agent-block.sh`, npm `lsp:check-agent-block`, hooks `lsp-warmup.sh` / `lsp-nudge.sh`, state file `/tmp/ocrecipes-lsp-nudge-<session>` — used identically across tasks. ✔

```

```
