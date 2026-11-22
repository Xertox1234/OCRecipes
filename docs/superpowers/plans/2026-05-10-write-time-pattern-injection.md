# Write-Time Pattern Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface relevant patterns, rules, and project gotchas to Claude before every file write — not after kimi-review catches the violation at commit.

**Architecture:** Three layers: (1) `docs/rules/` per-domain markdown rule files seeded from audit history; (2) a `PreToolUse` hook on Edit/Write that injects rules + pattern excerpts + learnings into context; (3) `todo-executor` Step 3b that supplements label-based pattern lookup with file-path detection. Codification pipelines in both the audit skill and todo-executor grow the rules automatically from CRITICAL/HIGH findings.

**Tech Stack:** Bash (hook script), jq (JSON parsing), Markdown (rule files), JSON (settings.json wiring)

**Spec:** `docs/superpowers/specs/2026-05-10-pattern-injection-write-time-design.md`

---

### Task 1: Seed docs/rules/ — server-side domains

**Files:**

- Create: `docs/rules/database.md`
- Create: `docs/rules/security.md`
- Create: `docs/rules/api.md`
- Create: `docs/rules/architecture.md`

- [ ] **Step 1: Create docs/rules/ directory and database.md**

```bash
mkdir -p docs/rules
```

Create `docs/rules/database.md`:

```markdown
# Database Rules

- Never use `onConflictDoNothing({ target })` with partial unique indexes — omit the target arg entirely (PG rejects at runtime; causes live test failures)
- Use `onConflictDoUpdate` for cache tables, not `onConflictDoNothing` — the latter silently skips expired-entry updates, causing `!`-assertion crashes on the stale row
- Always pair `.default([])` with `.notNull()` on array columns — `.default([])` alone keeps the TS type `T[] | null` and crashes on legacy NULLs
- Polymorphic FK always requires a discriminator column (e.g., `recipeType`) alongside the FK — never a bare `recipeId` without type context
- Never store large blobs (images, receipts > 1 KB) in DB columns — use file/object storage (Cloudflare R2)
- Multi-phase background jobs: design the eligibility query to catch phase-1-complete + phase-2-incomplete as a retriable state, not a dead end
- Always use `Promise.all` for parallel queries inside transactions — never sequential `await` (causes N sequential round-trips)
- Never re-query after an insert to build the response — construct from insert params + returned id in-memory
- Polymorphic batch fetch: collect IDs first, batch with `.inArray()`, resolve with `Map` lookup — never loop-query
```

- [ ] **Step 2: Create docs/rules/security.md**

```markdown
# Security Rules

- IDOR: every resource lookup must scope by `userId` AND visibility (`eq(t.isPublic, true)` or `eq(t.authorId, userId)`) — this applies to reads, not just mutations
- Storage update functions must accept an explicit field whitelist — never `Partial<User>` or spread of arbitrary input (enables mass-assignment)
- Sanitize ALL prompt roles (`user`, `assistant`, `system`) before sending to OpenAI — never only `user` role
- Rate-limit all AI/OpenAI endpoints — every new AI route needs a rate limiter from `server/middleware/rate-limiter.ts`
- Premium-gate BOTH read AND write endpoints for premium features — gating only the write path leaves data readable for free
- Never trust parameters that "look server-generated" in AI prompt inputs — always sanitize at the prompt boundary
- All route request bodies must be Zod-validated before any field access — never `req.body.x` without a schema parse
- `req.userId` is a string (UUID) — never parse with `parseInt` (returns NaN, bypasses ownership checks silently)
```

- [ ] **Step 3: Create docs/rules/api.md**

```markdown
# API Rules

- All catch blocks must use `handleRouteError(res, error)` — never custom `res.status(500).json(...)` responses
- All route module exports must be named `register` — not `registerXRoutes` or `registerXHandlers` (breaks grep across 50+ route modules)
- All request bodies must be Zod-validated before field access — use `const parsed = schema.safeParse(req.body)`
- `req.userId` is a UUID string — never `parseInt(req.userId)` (returns NaN for UUIDs)
- New endpoints that call OpenAI or run expensive compute must have a rate limiter applied before the handler
- When adding a premium-gated write endpoint, always check whether the corresponding read endpoint also needs gating
```

- [ ] **Step 4: Create docs/rules/architecture.md**

```markdown
# Architecture Rules

- Storage modules > 500 lines must be split by sub-domain — use a thin re-export facade to preserve existing import paths
- Routes that make 3+ parallel storage calls AND compute derived values inline must extract a service function (pattern: `server/services/coach-context-builder.ts`)
- Never import from a service inside a storage module — dependency direction is always service → storage
- MiniSearch index mutations must be outside `db.transaction` — in-transaction index mutations desync state on rollback
- Route exports must be named `register` for consistent grep — not `registerXRoutes`
- `server/storage/chat.ts` and `server/storage/community.ts` are approaching the 500-line threshold — avoid adding new functions; prefer splitting
```

- [ ] **Step 5: Verify files exist with correct content**

```bash
ls docs/rules/
# Expected: api.md  architecture.md  database.md  security.md

head -3 docs/rules/database.md
# Expected: # Database Rules
```

- [ ] **Step 6: Commit**

```bash
git add docs/rules/database.md docs/rules/security.md docs/rules/api.md docs/rules/architecture.md
git commit -m "docs(rules): seed server-side domain rules from audit history"
```

---

### Task 2: Seed docs/rules/ — client-side domains

**Files:**

- Create: `docs/rules/react-native.md`
- Create: `docs/rules/accessibility.md`
- Create: `docs/rules/hooks.md`
- Create: `docs/rules/client-state.md`
- Create: `docs/rules/design-system.md`

- [ ] **Step 1: Create docs/rules/react-native.md**

```markdown
# React Native Rules

- Never pass functions or callbacks as route params — use event params or navigate + read-and-clear in `useEffect` (non-serializable params break state persistence and deep links)
- Always call `navigation.goBack()` immediately after `navigation.navigate()` when dismissing a `fullScreenModal` — `navigate()` alone leaves the modal on the stack
- Touch targets must be ≥ 44pt — add `hitSlop` for small controls (e.g., `hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}`)
- Always add `insets.bottom + Spacing.X` to the last-item padding in scrollable lists — bare `Spacing.X` clips content behind the home indicator on notched devices
- `KeyboardAvoidingView` behavior: `"padding"` on iOS, `"height"` on Android — never `undefined`
- Always spread `FLATLIST_DEFAULTS` from `@/constants/performance` on every `FlatList` component
- Camera: always set `isActive={isFocused}` on `CameraView` — stops the camera when navigating away
- Mic: always call `stopListening()` in session reset/cleanup — leaving it open mutates state after the component is gone
- `Alert.prompt` is iOS-only — always guard with `Platform.OS === "ios"` and provide a `TextInput` fallback for Android
```

- [ ] **Step 2: Create docs/rules/accessibility.md**

```markdown
# Accessibility Rules

- All `fullScreenModal` and `modal` screens must have `accessibilityViewIsModal={true}` on the root container — VoiceOver navigates behind the modal without it
- Decorative icons inside labeled Pressables must have `accessible={false}` — VoiceOver double-focuses on icon + container otherwise
- `disabled` Pressable must set both `disabled={true}` and `accessibilityState={{ disabled: true }}` — TalkBack ignores the `disabled` prop alone
- Error messages must use `accessibilityLiveRegion="assertive"` not `"polite"` — use `InlineError` component, not `Alert.alert()`
- Async state transitions (success, error, limit-reached) must call `AccessibilityInfo.announceForAccessibility` on iOS, paired with `accessibilityLiveRegion="assertive"` on Android
- Radio buttons: use `accessibilityState={{ selected: bool }}` not `{{ checked: bool }}` — `checked` maps to checkbox semantics on TalkBack
- Radio chip rows need a `role="radiogroup"` wrapper `View`
- Progress bars need `accessibilityRole="progressbar"` + `accessibilityValue={{ min: 0, max: 100, now: value }}`
- Decorative emoji must be wrapped in a `Text` with `accessible={false}` — VoiceOver announces them literally otherwise
- `accessibilityLiveRegion` is Android-only — always pair with `AccessibilityInfo.announceForAccessibility()` for iOS coverage
- Badges that are purely decorative inside a parent with an `accessibilityLabel` need `accessible={false}` — prevents double-announcement
```

- [ ] **Step 3: Create docs/rules/hooks.md**

```markdown
# Hooks Rules

- Destructure `.mutate` (not the whole mutation object) for `useCallback` deps — the full mutation object is a new ref every render, defeating memoization
- Never list streaming state (`streamingContent`, `statusText`, `streamBlocks`) in `FlatList` `renderItem` `useCallback` deps — use `ListFooterComponent` instead; streaming deps cause full FlatList re-render on every token (~20×/sec)
- Values that change over time (phase, reducedMotion, etc.) used inside a zero-dep `useCallback` must be mirrored to a ref: `const fooRef = useRef(foo); useEffect(() => { fooRef.current = foo; }, [foo]);`
- Effect cleanup must capture timer/subscription refs at cleanup time (inside the effect return), not at setup time — closures capture stale values
- `cancelAnimation` must be called when `reducedMotion` toggles at runtime — `withRepeat` animations don't stop on their own; use `else` (not `else if`) for the cancel branch to avoid dead zones
```

- [ ] **Step 4: Create docs/rules/client-state.md**

```markdown
# Client State Rules

- Always use `apiRequest()` from `@/lib/query-client` for all server communication — never raw `fetch()` in components or hooks
- Always use the `Authorization` header for auth tokens — never cookies
- Import `withOpacity` from `@/constants/theme` only — the version in `@/lib/colors` was deleted; any import from that path will fail at runtime
```

- [ ] **Step 5: Create docs/rules/design-system.md**

```markdown
# Design System Rules

- Import `withOpacity` from `@/constants/theme` (scale 0–1) — the deleted `@/lib/colors` version used a 0–100 scale and no longer exists
- Never define color dictionaries with raw hex values in component files — use `useTheme()` tokens; raw hex bypasses dark mode
- `theme.buttonText` is `#FFFFFF` in both light and dark modes — safe for white-on-colored-button text in either mode
- Static `StyleSheet.create` blocks cannot use `useTheme()` values — only computed/dynamic styles can; raw `#FFFFFF` in static camera overlay styles is intentional
```

- [ ] **Step 6: Verify**

```bash
ls docs/rules/
# Expected: api.md  architecture.md  accessibility.md  client-state.md  database.md  design-system.md  hooks.md  react-native.md  security.md
```

- [ ] **Step 7: Commit**

```bash
git add docs/rules/react-native.md docs/rules/accessibility.md docs/rules/hooks.md docs/rules/client-state.md docs/rules/design-system.md
git commit -m "docs(rules): seed client-side domain rules from audit history"
```

---

### Task 3: Seed docs/rules/ — cross-cutting domains

**Files:**

- Create: `docs/rules/typescript.md`
- Create: `docs/rules/performance.md`
- Create: `docs/rules/testing.md`
- Create: `docs/rules/ai-prompting.md`

- [ ] **Step 1: Create docs/rules/typescript.md**

```markdown
# TypeScript Rules

- Never use `as` cast on a bare `text` DB column to derive a discriminated type — use a type guard (`function isFoo(x: string): x is Foo`) or Zod enum `.parse()`
- Never cast navigation types with `as never` or `as unknown` — define `CompositeNavigationProp` in `client/types/navigation.ts` for 3-level stack → tab → root composites
- JSONB columns typed with `$type<MyType>()` hint in the schema — don't add redundant `as MyType` casts on top of them
- `Partial<User>` in storage update functions enables mass-assignment — always use an explicit field whitelist type instead
- `Drizzle .default([])` does NOT make the TypeScript type non-nullable — the inferred type stays `T[] | null`; add `.notNull()` alongside
- PostgreSQL decimal aggregates (SUM, AVG) return strings via Drizzle — always `parseFloat()` or `Number()` the result
```

- [ ] **Step 2: Create docs/rules/performance.md**

```markdown
# Performance Rules

- Streaming bubble components must be in `ListFooterComponent`, not `renderItem` — streaming deps in `renderItem` re-render all visible FlatList rows on every token
- Inline `withOpacity` calls inside high-frequency animated components (>10 renders/sec) should be extracted to module-level constants — allocates new strings each tick
- `React.memo` with ref-only props creates a component that never updates — always include state or callback props that actually change in the comparison
- FlatList components must spread `FLATLIST_DEFAULTS` from `@/constants/performance` — missing `removeClippedSubviews`, `maxToRenderPerBatch`, `windowSize` degrades scroll performance
- Mutations objects passed as `useCallback` deps are new refs every render — destructure `.mutate`, `.isPending`, `.isError` individually
- Expensive derived values computed inside render (not memoized) at high tick rates (30s interval, streaming) should be wrapped in `useMemo`
```

- [ ] **Step 3: Create docs/rules/testing.md**

```markdown
# Testing Rules

- Every storage function that applies an IDOR ownership filter (`userId` scope) must have a "wrong userId returns undefined/null" test alongside the happy path
- Dual-Assertion IDOR test pattern: (1) assert correct user gets data, (2) assert different user gets nothing — both in the same test suite
- Never mix real and mocked implementations in `vi.mock` of the storage facade — mock all or mock none; partial mocks hide coupling
- Tests that verify a rate limiter must call the endpoint N+1 times and assert the (N+1)th call returns 429
```

- [ ] **Step 4: Create docs/rules/ai-prompting.md**

```markdown
# AI Prompting Rules

- Sanitize ALL prompt roles (`user`, `assistant`, `system`) — never sanitize only the `user` role; recipe/community content in `system` or `assistant` roles is still adversarial
- OpenAI tool schema and handler parameter names must be identical — a mismatch causes phantom parameters that OpenAI ignores silently, breaking tool execution
- Never embed unsanitized user-provided content in `system` role messages — recipe ingredients, instructions, and user-authored text can contain injections
- `cacheAffectingFields` must stay in sync with `calculateProfileHash` — adding a profile field without updating the cache key serves stale responses to new configurations
```

- [ ] **Step 5: Verify all 13 rule files exist**

```bash
ls docs/rules/ | sort
# Expected (13 files):
# accessibility.md
# ai-prompting.md
# api.md
# architecture.md
# client-state.md
# database.md
# design-system.md
# hooks.md
# performance.md
# react-native.md
# security.md
# testing.md
# typescript.md
```

- [ ] **Step 6: Commit**

```bash
git add docs/rules/typescript.md docs/rules/performance.md docs/rules/testing.md docs/rules/ai-prompting.md
git commit -m "docs(rules): seed cross-cutting domain rules from audit history"
```

---

### Task 4: Implement inject-patterns.sh with tests

**Files:**

- Create: `.claude/hooks/test-inject-patterns.sh`
- Create: `.claude/hooks/inject-patterns.sh`

- [ ] **Step 1: Create the test script**

Create `.claude/hooks/test-inject-patterns.sh`:

```bash
#!/usr/bin/env bash
# Tests for inject-patterns.sh — run from project root
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/inject-patterns.sh"
PASS=0; FAIL=0

check() {
  local name="$1" input="$2" pattern="$3"
  local output
  output=$(echo "$input" | bash "$HOOK" 2>/dev/null || true)
  if echo "$output" | grep -q "$pattern"; then
    echo "PASS: $name"; PASS=$((PASS + 1))
  else
    echo "FAIL: $name"; echo "  expected to find: $pattern"; FAIL=$((FAIL + 1))
  fi
}

check_empty() {
  local name="$1" input="$2"
  local output
  output=$(echo "$input" | bash "$HOOK" 2>/dev/null || true)
  if [ -z "$output" ]; then
    echo "PASS: $name"; PASS=$((PASS + 1))
  else
    echo "FAIL: $name (expected empty)"; echo "  got: $(echo "$output" | head -3)"; FAIL=$((FAIL + 1))
  fi
}

# server/routes → api + security + architecture + typescript
check "server/routes → api rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}' \
  "RULES — api"

check "server/routes → security rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}' \
  "RULES — security"

check "server/routes → typescript rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}' \
  "RULES — typescript"

check "server/routes → pattern excerpt" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}' \
  "PATTERNS — api"

# client/screens → react-native + accessibility + design-system
check "client/screens → accessibility rules" \
  '{"tool_name":"Write","tool_input":{"file_path":"client/screens/HomeScreen.tsx"}}' \
  "RULES — accessibility"

check "client/screens → react-native rules" \
  '{"tool_name":"Write","tool_input":{"file_path":"client/screens/HomeScreen.tsx"}}' \
  "RULES — react-native"

# server/storage → database
check "server/storage → database rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/storage/recipes.ts"}}' \
  "RULES — database"

# client/hooks → hooks + client-state
check "client/hooks → hooks rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"client/hooks/useRecipes.ts"}}' \
  "RULES — hooks"

# Output is valid JSON
check "output is valid JSON with hookSpecificOutput" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}' \
  "hookSpecificOutput"

# Read tool → no output (not Edit or Write)
check_empty "Read tool → no output" \
  '{"tool_name":"Read","tool_input":{"file_path":"server/routes/recipes.ts"}}'

# Missing file_path → no output (graceful degradation)
check_empty "missing file_path → no output" \
  '{"tool_name":"Edit","tool_input":{}}'

# File with no domain match → no output
check_empty "package.json → no output" \
  '{"tool_name":"Edit","tool_input":{"file_path":"package.json"}}'

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
```

```bash
chmod +x .claude/hooks/test-inject-patterns.sh
```

- [ ] **Step 2: Run the test to confirm it fails (inject-patterns.sh doesn't exist yet)**

```bash
cd /Users/williamtower/projects/OCRecipes && bash .claude/hooks/test-inject-patterns.sh || true
```

Expected: most tests report FAIL (hook script missing), `check_empty` tests may pass since missing script produces empty output.

- [ ] **Step 3: Create .claude/hooks/inject-patterns.sh**

```bash
mkdir -p .claude/hooks
```

Create `.claude/hooks/inject-patterns.sh`:

```bash
#!/usr/bin/env bash
# PreToolUse hook — inject relevant patterns, rules, and learnings before Edit/Write
# Reads tool event JSON from stdin; outputs additionalContext JSON or exits 0 silently.
set -uo pipefail

INPUT=$(cat)

# Extract tool name and file path; exit silently on parse failure
TOOL_NAME=$(echo "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
FILE_PATH=$(echo "$INPUT" | jq -re '.tool_input.file_path' 2>/dev/null) || exit 0

# Only inject for Edit and Write tool calls
[[ "$TOOL_NAME" == "Edit" || "$TOOL_NAME" == "Write" ]] || exit 0

# Resolve paths relative to project root (two levels up from .claude/hooks/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PATTERNS_DIR="$PROJECT_ROOT/docs/patterns"
RULES_DIR="$PROJECT_ROOT/docs/rules"
LEARNINGS_FILE="$PROJECT_ROOT/docs/LEARNINGS.md"

# Map file path to domains
DOMAINS=""
add_domain() {
  case ",$DOMAINS," in
    *,"$1",*) ;;
    *) DOMAINS="${DOMAINS:+$DOMAINS,}$1" ;;
  esac
}

case "$FILE_PATH" in
  */server/routes/*)
    add_domain api; add_domain security; add_domain architecture ;;
  */server/storage/*|*/shared/schema.ts|*/migrations/*)
    add_domain database; add_domain security; add_domain architecture ;;
  */server/middleware/*)
    add_domain security; add_domain api ;;
  */server/services/photo-analysis.ts|*/server/services/nutrition-coach.ts|*/server/services/recipe-chat.ts|*/server/services/recipe-generation.ts|*/evals/*)
    add_domain ai-prompting; add_domain security ;;
  */server/services/*)
    add_domain architecture ;;
  */client/screens/*|*/client/components/*)
    add_domain react-native; add_domain design-system; add_domain accessibility ;;
  */client/navigation/*)
    add_domain react-native; add_domain accessibility ;;
  */client/hooks/*)
    add_domain hooks; add_domain client-state; add_domain react-native ;;
  */client/context/*|*/client/lib/*)
    add_domain client-state ;;
  */client/constants/theme.ts|*/design_guidelines.md)
    add_domain design-system ;;
  */__tests__/*|*.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx)
    add_domain testing ;;
esac

# Always add typescript for .ts/.tsx files
case "$FILE_PATH" in
  *.ts|*.tsx) add_domain typescript ;;
esac

# Exit silently if no domains matched
[ -n "$DOMAINS" ] || exit 0

# Build context in a temp file (avoids subshell newline stripping)
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

printf '=== Pre-write context for %s ===\n' "$FILE_PATH" >> "$TMPFILE"

IFS=',' read -ra DOMAIN_LIST <<< "$DOMAINS"
for DOMAIN in "${DOMAIN_LIST[@]}"; do
  RULES_FILE="$RULES_DIR/${DOMAIN}.md"
  PATTERNS_FILE="$PATTERNS_DIR/${DOMAIN}.md"

  # Inject full rules file (short by design)
  if [ -f "$RULES_FILE" ]; then
    printf '\n[RULES — %s]\n' "$DOMAIN" >> "$TMPFILE"
    cat "$RULES_FILE" >> "$TMPFILE"
  fi

  # Inject first 80 lines of pattern doc
  if [ -f "$PATTERNS_FILE" ]; then
    printf '\n[PATTERNS — %s (excerpt)]\n' "$DOMAIN" >> "$TMPFILE"
    head -80 "$PATTERNS_FILE" >> "$TMPFILE"
  fi
done

# Inject matching learnings (first 20 lines that mention this file's basename)
BASENAME=$(basename "$FILE_PATH")
BASENAME="${BASENAME%.*}"
if [ -f "$LEARNINGS_FILE" ] && [ -n "$BASENAME" ]; then
  printf '\n[LEARNINGS — matches for "%s"]\n' "$BASENAME" >> "$TMPFILE"
  MATCHES=$(grep -i "$BASENAME" "$LEARNINGS_FILE" 2>/dev/null | head -20 || true)
  if [ -n "$MATCHES" ]; then
    printf '%s\n' "$MATCHES" >> "$TMPFILE"
  else
    echo "(none)" >> "$TMPFILE"
  fi
fi

# Output hook response JSON
CONTEXT=$(cat "$TMPFILE")
jq -n --arg ctx "$CONTEXT" \
  '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":$ctx}}'
```

```bash
chmod +x .claude/hooks/inject-patterns.sh
```

- [ ] **Step 4: Run the tests — all should pass**

```bash
cd /Users/williamtower/projects/OCRecipes && bash .claude/hooks/test-inject-patterns.sh
```

Expected output:

```
PASS: server/routes → api rules
PASS: server/routes → security rules
PASS: server/routes → typescript rules
PASS: server/routes → pattern excerpt
PASS: client/screens → accessibility rules
PASS: client/screens → react-native rules
PASS: server/storage → database rules
PASS: client/hooks → hooks rules
PASS: output is valid JSON with hookSpecificOutput
PASS: Read tool → no output
PASS: missing file_path → no output
PASS: package.json → no output

Results: 12 passed, 0 failed
```

If any test fails, diagnose by running the hook manually:

```bash
echo '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}' | bash .claude/hooks/inject-patterns.sh | jq .
```

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/inject-patterns.sh .claude/hooks/test-inject-patterns.sh
git commit -m "feat(hooks): inject patterns/rules/learnings before Edit and Write tool calls"
```

---

### Task 5: Wire hook into settings.json

**Files:**

- Modify: `.claude/settings.json`

- [ ] **Step 1: Read current settings.json**

```bash
cat .claude/settings.json | jq '.hooks.PreToolUse | length'
# Expected: 1 (the existing Bash/kimi-review hook)
```

- [ ] **Step 2: Add Edit and Write PreToolUse entries**

Edit `.claude/settings.json` — add two new entries to the `hooks.PreToolUse` array, before the existing Bash entry:

```json
{
  "matcher": "Edit",
  "hooks": [
    {
      "type": "command",
      "command": "bash .claude/hooks/inject-patterns.sh",
      "timeout": 10,
      "statusMessage": "Loading patterns for this file..."
    }
  ]
},
{
  "matcher": "Write",
  "hooks": [
    {
      "type": "command",
      "command": "bash .claude/hooks/inject-patterns.sh",
      "timeout": 10,
      "statusMessage": "Loading patterns for this file..."
    }
  ]
},
```

The resulting `hooks.PreToolUse` array should have 3 entries: Edit, Write, and the existing Bash entry.

- [ ] **Step 3: Verify settings.json is valid JSON and has 3 PreToolUse entries**

```bash
cat .claude/settings.json | jq '.hooks.PreToolUse | length'
# Expected: 3

cat .claude/settings.json | jq '.hooks.PreToolUse[0].matcher, .hooks.PreToolUse[1].matcher, .hooks.PreToolUse[2].matcher'
# Expected: "Edit" "Write" "Bash" (or Bash last)
```

- [ ] **Step 4: Smoke-test the hook fires by simulating an Edit**

Run the hook manually with a realistic payload:

```bash
echo '{"tool_name":"Edit","tool_input":{"file_path":"client/screens/HomeScreen.tsx","old_string":"foo","new_string":"bar"}}' \
  | bash .claude/hooks/inject-patterns.sh \
  | jq -r '.hookSpecificOutput.additionalContext' \
  | head -20
```

Expected: prints the pre-write context header and at least the `[RULES — react-native]` section.

- [ ] **Step 5: Commit**

```bash
git add .claude/settings.json
git commit -m "feat(hooks): wire inject-patterns hook to Edit and Write PreToolUse events"
```

---

### Task 6: Add Step 3b to todo-executor

**Files:**

- Modify: `.claude/agents/todo-executor.md`

- [ ] **Step 1: Locate the insertion point**

```bash
grep -n "3b\|Step 3\|Lightweight path\|Regardless of" .claude/agents/todo-executor.md | head -10
```

Note the line number of `**Regardless of whether the researcher succeeded or fell back**` — Step 3b inserts after the existing Step 3 fallback block ends and before Step 4.

- [ ] **Step 2: Insert Step 3b**

Find the line in `.claude/agents/todo-executor.md` that reads:

```
**Regardless of whether the researcher succeeded or fell back**, also do:
```

Find the exact text `## Step 4 — Implement` and insert the following new section immediately before it (after the last bullet of the existing Step 3 fallback block):

```markdown
**3b — File-path pattern + rules supplement:** After the researcher returns (or fallback completes), apply the domain mapping below to the source file paths extracted above. Read `docs/rules/{domain}.md` (full) and the first 80 lines of `docs/patterns/{domain}.md` for any domain not already covered by the label-based lookup. This ensures the right patterns load even when todo labels are incomplete.

| File path pattern                                                                                                                                              | Additional domains to load                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `server/routes/*`                                                                                                                                              | api, security, architecture                |
| `server/storage/*`, `shared/schema.ts`, `migrations/*`                                                                                                         | database, security, architecture           |
| `server/middleware/*`                                                                                                                                          | security, api                              |
| `server/services/photo-analysis.ts`, `server/services/nutrition-coach.ts`, `server/services/recipe-chat.ts`, `server/services/recipe-generation.ts`, `evals/*` | ai-prompting, security                     |
| `server/services/*`                                                                                                                                            | architecture                               |
| `client/screens/*`, `client/components/*`                                                                                                                      | react-native, design-system, accessibility |
| `client/navigation/*`                                                                                                                                          | react-native, accessibility                |
| `client/hooks/*`                                                                                                                                               | hooks, client-state, react-native          |
| `client/context/*`, `client/lib/*`                                                                                                                             | client-state                               |
| `*.test.ts`, `*.test.tsx`                                                                                                                                      | testing                                    |
| `*.ts`, `*.tsx`                                                                                                                                                | typescript                                 |
```

- [ ] **Step 3: Verify the insertion**

```bash
grep -n "3b\|File-path pattern" .claude/agents/todo-executor.md
```

Expected: one match showing the new Step 3b heading on the line after the existing Step 3 fallback content.

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/todo-executor.md
git commit -m "feat(agents): add Step 3b file-path pattern supplement to todo-executor"
```

---

### Task 7: Update codification pipelines for rules routing

**Files:**

- Modify: `.claude/skills/audit/SKILL.md` (Phase 8)
- Modify: `.claude/agents/todo-executor.md` (Step 9)

- [ ] **Step 1: Update audit skill Phase 8**

In `.claude/skills/audit/SKILL.md`, find the line:

```
5. Review the codifier's output and apply changes to docs and agents
```

Before step 6 (`6. Commit documentation separately:`), insert:

```markdown
5b. **Rules routing**: For each codified finding that was CRITICAL or HIGH severity, evaluate whether it warrants a `docs/rules/{domain}.md` entry. Criteria — all three must be true:

- It is a "never do X" class (not a preference or style choice)
- It can be stated in one bullet line
- The domain has a corresponding `docs/rules/{domain}.md` file

Domain → rules file mapping mirrors the patterns routing table above. If a rule entry is warranted, append the bullet to the matching `docs/rules/{domain}.md` and include it in the codification commit.
```

- [ ] **Step 2: Verify the audit skill update**

```bash
grep -n "Rules routing\|5b" .claude/skills/audit/SKILL.md
```

Expected: one match showing the new 5b step.

- [ ] **Step 3: Update todo-executor Step 9**

In `.claude/agents/todo-executor.md`, find the Step 9 section. Locate the line:

```
5. Update the target files directly.
```

After step 5 (before step 6 `kimi-write`), insert:

```markdown
5b. **Rules routing**: If the finding was CRITICAL or HIGH severity AND is a "never do X" class that can be stated in one bullet, append the rule to `docs/rules/{domain}.md` using the same domain routing table from Step 9 item 2. Include it in the codification commit at step 7.
```

- [ ] **Step 4: Verify the todo-executor Step 9 update**

```bash
grep -n "Rules routing\|5b" .claude/agents/todo-executor.md
```

Expected: two matches — Step 3b (file-path supplement from Task 6) and the new Step 9 rules routing.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/audit/SKILL.md .claude/agents/todo-executor.md
git commit -m "feat(agents): route CRITICAL/HIGH findings to docs/rules/ in codification pipelines"
```

---

## Verification Checklist

After all tasks complete, verify end-to-end:

```bash
# 1. All 13 rule files exist
ls docs/rules/ | wc -l
# Expected: 13

# 2. Hook tests still pass
bash .claude/hooks/test-inject-patterns.sh
# Expected: 12 passed, 0 failed

# 3. settings.json has 3 PreToolUse entries
cat .claude/settings.json | jq '.hooks.PreToolUse | length'
# Expected: 3

# 4. todo-executor has both Step 3b and Step 9 rules routing
grep -c "Rules routing\|File-path pattern" .claude/agents/todo-executor.md
# Expected: 2

# 5. audit skill has rules routing
grep -c "Rules routing" .claude/skills/audit/SKILL.md
# Expected: 1

# 6. Full hook output for a server route looks correct
echo '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/auth.ts"}}' \
  | bash .claude/hooks/inject-patterns.sh \
  | jq -r '.hookSpecificOutput.additionalContext' \
  | grep -E "^\[RULES|^\[PATTERNS|^\[LEARNINGS"
# Expected: [RULES — api], [PATTERNS — api (excerpt)], [RULES — security], etc.
```
