---
title: 'Run solutions:db:add with a worktree-relative path, never an absolute $MAIN_CHECKOUT path'
track: knowledge
category: conventions
module: shared
tags: [solutions-db, codify, worktree, path-guard, todo-executor, tooling]
created: '2026-06-18'
source: 2026-06-18 todo P3-2026-06-13-todo-executor-codify-mechanics-db-cutover
---

## Rule

When an agent runs `npm run solutions:db:add -- <file>` from inside a git
worktree (e.g. a `/todo` executor in `.claude/worktrees/agent-*`), pass the
**worktree-relative** path `docs/solutions/<category>/<slug>.md` — **never** an
absolute `$MAIN_CHECKOUT/docs/solutions/...` path. The same rule applies to the
file write that precedes it: write the solution at the worktree-relative path,
then register that same path.

## Why

`add.ts` derives `SOLUTIONS_ROOT` from its own `__dirname`
(`scripts/solutions-db/lib/files.ts` → `<repo>/docs/solutions`). When run from
a worktree, `__dirname` resolves under the worktree, so `SOLUTIONS_ROOT` is the
worktree's `docs/solutions`. The script then guards the target with a **lexical**
check:

```ts
if (!resolve(abs).startsWith(resolve(SOLUTIONS_ROOT) + "/")) {
  console.error(`refusing to write outside solutions root: ${sourcePath}`);
  process.exit(1);
}
```

`resolve()` does **not** follow symlinks, so:

- A worktree-relative `docs/solutions/...` path → `abs` is under the worktree's
  `docs/solutions` → **passes** the guard. The worktree's `docs/solutions` is a
  symlink into the main checkout (created by `.husky/post-checkout`), so the
  write lands in the real tree and survives `git worktree remove`.
- An absolute `$MAIN_CHECKOUT/docs/solutions/...` path → does **not** start with
  `resolve(<worktree>/docs/solutions)` → **rejected** with "refusing to write
  outside solutions root", even though it points at the same real file.

So the worktree-relative form is both the only form the guard accepts *and* the
form that satisfies the worktree-survival concern (the symlink writes through to
the main checkout).

## Examples

```bash
# CORRECT — run from inside the worktree
npm run solutions:db:add -- docs/solutions/conventions/my-rule-2026-06-18.md

# WRONG — rejected by the path guard when cwd is a worktree
npm run solutions:db:add -- /Users/me/projects/OCRecipes/docs/solutions/conventions/my-rule-2026-06-18.md
```

Correct codify order in a worktree (todo-executor Step 9): kimi-write the file
at the worktree-relative path → `solutions:db:add -- <file> --dry-run`
(advisory overlap check; the file must already exist on disk because `add.ts`
reads it to embed) → 6b sanity-check (delete on failure) → real
`solutions:db:add -- <file>` registration. Register **after** the sanity-check,
never before — a 6b deletion of an already-registered file leaves an orphaned DB
row that `rm` cannot undo.

## Exceptions

The `$MAIN_CHECKOUT` absolute form is still correct for filesystem-existence
checks that are **not** passed to `solutions:db:add` — e.g. `test -e
"$MAIN_CHECKOUT/<related-file>"` when validating a solution's `## Related Files`
section, since those resolve repo-root paths through the symlink for a plain
existence test. The rule is specific to the path argument given to
`solutions:db:add` (and to the file write it registers).

## Related Files

- `scripts/solutions-db/add.ts` — the path guard and `--dry-run` near-dup check
- `scripts/solutions-db/lib/files.ts` — `SOLUTIONS_ROOT` from `__dirname`
- `.claude/agents/todo-executor.md` — Step 9 codify procedure (uses this rule)
- `.claude/skills/codify/SKILL.md` — `/codify` Steps 6b/6c/7 (canonical wording)

## See Also

- [a11y-hide-visually-hidden-surfaces](a11y-hide-visually-hidden-surfaces-2026-06-10.md) — another conventions-track rule about a non-obvious tooling/runtime behavior
