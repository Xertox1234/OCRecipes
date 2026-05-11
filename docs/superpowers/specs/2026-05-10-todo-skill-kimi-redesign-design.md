---
title: "Todo Skill Redesign: kimi-review integration, inline codifier, and gap fixes"
status: approved
created: 2026-05-10
---

# Todo Skill Redesign: Approach B

## Summary

Remove all superpowers-agent dependencies from the `/todo` skill. Replace the `code-reviewer` subagent with `kimi-review` CLI calls. Inline the pattern codifier (eliminating `pattern-codifier.md` as an active agent). Fix three bugs, fill three design gaps, and add two enhancements.

## Scope

| File                                 | Change                                                              |
| ------------------------------------ | ------------------------------------------------------------------- |
| `.claude/skills/todo/SKILL.md`       | kimi-review env preflight (Phase 1), `git worktree prune` (Phase 5) |
| `.claude/agents/todo-executor.md`    | Steps 2, 3, 6, 7, 9, Failure Path, Key Files                        |
| `.claude/agents/todo-researcher.md`  | D3: import-statement fallback when no table match                   |
| `.claude/agents/pattern-codifier.md` | Deprecation notice — logic inlined in executor Step 9               |

**Net result:** 5-file skill system → 4 active files (codifier retired).

---

## Changes: SKILL.md (Orchestrator)

### Phase 1 — New step 5: kimi-review preflight

After the executor-file check, add:

```bash
if [[ -z "${WORKER_API_KEY:-}" && -z "${MOONSHOT_API_KEY:-}" ]]; then
  echo "missing"
else
  echo "found"
fi
```

If `missing`, stop immediately: "Cannot run kimi-review — neither WORKER_API_KEY nor MOONSHOT_API_KEY is set. Export one and retry."

### Phase 5 — Worktree cleanup (E2)

After the final `npm run test:run / check:types / lint` block, add:

```bash
git worktree prune
```

This removes stale worktree entries left behind by crashed or cancelled executor agents.

---

## Changes: todo-executor.md

### Step 2 — Preflight: add env check

Before marking a todo in-progress, check the kimi env:

```bash
if [[ -z "${WORKER_API_KEY:-}" && -z "${MOONSHOT_API_KEY:-}" ]]; then
  # report blocked: kimi tools unavailable
fi
```

Report `blocked` with reason "kimi tools require WORKER_API_KEY or MOONSHOT_API_KEY — set one and retry."

### Step 3 — D1: Lightweight path for docs/config-only todos

Before spawning the researcher, check whether ALL affected files are documentation or configuration:

- Paths under: `docs/`, `todos/`
- Extensions: `.md`, `.json`, `.yaml`, `.yml`, `.toml`, `.*rc`, `.*ignore`

If ALL match, skip the researcher entirely. Read the affected files directly with the Read tool and proceed to Step 4.

### Step 6 — Replace superpowers agent with kimi-review (B2 + E3)

**Remove** the `Agent({ subagent_type: "superpowers:code-reviewer", ... })` call entirely.

**Replace with:**

1. Build the `--patterns` value from the todo's labels using this table:

   | Todo label(s)                 | --patterns value                       |
   | ----------------------------- | -------------------------------------- |
   | `security`                    | `security`                             |
   | `architecture`, `duplication` | `architecture`                         |
   | `ui`, `remix`                 | `react-native,design-system,animation` |
   | `performance`                 | `performance`                          |
   | `testing`, `test`             | `testing`                              |
   | `database`                    | `database`                             |
   | `api`                         | `api`                                  |
   | `hooks`                       | `hooks`                                |
   | `typescript`, `types`         | `typescript`                           |
   | `client-state`                | `client-state`                         |
   | _(no match)_                  | _(omit `--patterns` flag)_             |

   Use the first matching row. If multiple labels match different rows, combine: `--patterns react-native,security`.

2. Run kimi-review and capture output:

   ```bash
   REVIEW_OUTPUT=$(kimi-review \
     --base <BASE_BRANCH> \
     --scope "<todo title>" \
     --patterns <mapped-patterns> \
     --tiers CRITICAL,WARNING,SUGGESTION)
   echo "$REVIEW_OUTPUT"
   ```

   > **Implementation note:** The final executor uses `git diff HEAD -- .` piped via stdin rather than `--base`, because Step 6 runs before Step 8 (commit) and `--base` only sees committed history. See `todo-executor.md` Step 6 for the actual invocation.

   If no patterns mapped, omit `--patterns`. `REVIEW_OUTPUT` carries forward to Step 9.

### Step 7 — Update tier handling

| Old name | New name   | Action                   |
| -------- | ---------- | ------------------------ |
| Critical | CRITICAL   | Must fix                 |
| High     | WARNING    | Must fix                 |
| Medium   | SUGGESTION | Fix unless out of scope  |
| Low      | _(none)_   | No tier below SUGGESTION |

### Step 9 — Inline codifier (replaces pattern-codifier.md subagent)

**Decision criteria — codify if any one is true:**

- The implementation required a workaround or constraint not documented in `docs/patterns/`
- The implementation revealed a library gotcha or platform-specific behavior
- `$REVIEW_OUTPUT` contained a CRITICAL or WARNING finding that reveals a reusable rule

**Skip if:**

- Implementation was straightforward application of existing patterns
- All `$REVIEW_OUTPUT` findings were SUGGESTION-only or were deferred

**If codifying:**

1. Determine target file from the todo's primary label:

   | Label                         | Target file                     |
   | ----------------------------- | ------------------------------- |
   | `security`                    | `docs/patterns/security.md`     |
   | `architecture`, `duplication` | `docs/patterns/architecture.md` |
   | `ui`, `remix`                 | `docs/patterns/react-native.md` |
   | `performance`                 | `docs/patterns/performance.md`  |
   | `testing`, `test`             | `docs/patterns/testing.md`      |
   | `database`                    | `docs/patterns/database.md`     |
   | `api`                         | `docs/patterns/api.md`          |
   | `hooks`                       | `docs/patterns/hooks.md`        |
   | `typescript`, `types`         | `docs/patterns/typescript.md`   |
   | `client-state`                | `docs/patterns/client-state.md` |
   | _(no match)_                  | `docs/LEARNINGS.md`             |

2. Compose a description of what was learned — e.g., the non-obvious constraint, workaround, or pattern.

3. Run kimi-write, passing the existing file as context so it can preserve and extend:

   ```bash
   kimi-write \
     --spec "Add a new section to this patterns file documenting the following pattern discovered during implementation of '<todo title>': <describe the workaround, constraint, or reusable rule in 3-5 sentences>. Preserve all existing content exactly." \
     --context <target file> \
     --target <target file>
   ```

4. Stage and commit:

   ```bash
   git add <target file>
   git commit -m "$(cat <<'EOF'
   docs: codify pattern from <todo title>

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
   EOF
   )"
   ```

   If kimi-write fails (non-zero exit), log "codification skipped — kimi-write failed" and continue to Step 10. Codification failure is non-blocking.

### Failure Path — B3: Track todo file in revert list

In Step 4.0, when updating `status` to `in-progress`, add `todos/<filename>.md` to the tracked-files list. This ensures the status revert is included in `git checkout -- <files you modified>` if implementation fails.

### Key Files — Remove pattern-codifier reference

Remove the line:

```
- `.claude/agents/pattern-codifier.md` — Deprecated tombstone only; live codification is inline in executor Step 9
```

---

## Changes: todo-researcher.md

### Step 1 — D3: Import-statement fallback

When `Affected files` is non-empty but no paths match the library table, instead of writing "No library lookup performed":

1. Read the first 60 lines of each affected file.
2. Extract all `import ... from '...'` and `require('...')` statements.
3. Collect external package names (names that do not start with `./`, `../`, `@/`, `~/`, or the project's internal `@` aliases).
4. Use the top 3 most-referenced external packages as library families for Step 2a Context7 lookups.
5. If no external packages found after this scan, then write "No library lookup performed — no external dependencies detected in affected files." and skip Step 2a.

---

## Changes: pattern-codifier.md

Replace the entire file content with a deprecation notice. Logic is now inline in `todo-executor.md` Step 9.

---

## Risks

- `kimi-write` overwrites the target patterns file completely. If the token budget is exhausted mid-generation, the file could be truncated. Mitigation: `kimi-write` exits with a non-zero code on failure, and Step 9 treats codification as non-blocking.
- The D3 import scan adds latency to the researcher when paths don't match the table. Acceptable since this is a fallback path, not the hot path.
