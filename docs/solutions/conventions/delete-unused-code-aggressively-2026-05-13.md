---
title: "Delete Unused Code Aggressively — Git History Is Your Safety Net"
track: knowledge
category: conventions
tags: [simplification, yagni, cleanup, code-review, dead-code]
module: shared
applies_to: ["**/*.ts", "**/*.tsx"]
created: 2026-05-13
---

# Delete Unused Code Aggressively — Git History Is Your Safety Net

## Rule

If code isn't used **right now**, delete it. Don't keep it "just in case." Git
history preserves the bytes if you need them back.

## Smell patterns

- Components, hooks, or modules with zero imports anywhere in the tree.
- "We might use this later" feature scaffolding that's been sitting unused for
  more than one release cycle.
- Commented-out blocks and `console.log` statements left in for "debugging."
- Web-platform-only branches in an app that no longer ships a web target.
- Schema definitions for features that were never built.
- Unused exports from utility modules.

## Why

Unused code carries real cost:

- **Maintenance.** Every dependency upgrade requires verifying the unused code
  still compiles, even though nothing depends on it.
- **Cognitive load.** Readers ask "Is this used? Should I update it?" — and
  must search to answer.
- **False signal.** Unused code looks like it's part of the system. New
  developers extend it, build on it, refactor it.
- **YAGNI.** You Aren't Gonna Need It. When the feature actually arrives, you
  will write the code differently than the speculative version anyway.

Git history is the safety net. `git log -- path/to/deleted-file.ts` and
`git show <sha>:path/to/deleted-file.ts` recover any historic version exactly.

## Examples

### Single code-cleanup pass

A code-review pass on OCRecipes removed:

- ~600 LOC of unused web support (landing page, web-specific hooks).
- An unused `Spacer` component.
- An unused chat schema.
- Debug `console.log` statements.
- Several commented-out code blocks.

Recovered later if needed via `git show 390c6d9 -- <path>`.

### Decision rubric

Before deleting, ask:

1. **Is it imported anywhere right now?** `grep -r "import .* from '...'"` —
   if zero hits, delete.
2. **Was the deletion already discussed?** If the team explicitly decided to
   keep the code for a planned feature with a written timeline, leave it.
   Otherwise, delete.
3. **Is the file load-bearing for tooling?** (e.g., an `index.ts` re-export
   barrel). If so, just remove the unused export; keep the file.

## Exceptions

- **Public-API surface.** Library entry points keep exports stable for
  consumers even if no internal call site uses them.
- **Documented planned work.** A todo file (`todos/...md`) or an open issue
  referencing the code, with a near-term timeline, is enough justification to
  leave a stub.
- **Recently extracted utility.** If you split a utility out specifically so
  multiple call sites could share it, and the migration is still in progress,
  keep it until the migration completes.

## Related Files

- `390c6d9` — example commit that removed ~600 LOC of unused web support.

## See Also

- [replace-any-with-proper-types](replace-any-with-proper-types-2026-05-13.md) — the
  other simplification principle from the same review pass.
