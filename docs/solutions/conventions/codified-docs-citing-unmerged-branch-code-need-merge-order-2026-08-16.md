---
title: A codified doc citing unmerged-branch code is an injection-eligible instruction against code that isn't on main — state the merge order
track: knowledge
category: conventions
tags: [harness, testing, codify, merge-order, knowledge-base]
module: shared
applies_to: ["docs/solutions/**", "todos/**"]
created: 2026-08-16
---

# A codified doc citing unmerged-branch code is an injection-eligible instruction against code that isn't on main — state the merge order

## Rule

When codifying from a session whose implementation lives on UNMERGED branches,
every path or symbol a solution doc cites must either (a) already exist on
`main`, or (b) the docs PR must carry an explicit, prominent merge-order
dependency ("merge #X/#Y first") and be held until those PRs land — with the
cited paths spot-checked against `main` at merge time. Actionable Solution
sections are the sharpest edge: an instruction like "delete the lookalike and
its suite" must never be able to reach an editor of a tree where the
replacement does not exist.

## Smell patterns

- A solution doc's Related Files lists a `-utils.ts` or test file that
  `git cat-file -e origin/main:<path>` cannot resolve.
- The docs PR and the code PRs it describes are siblings off `main`, none
  merged, and the docs PR body says nothing about ordering.
- A code snippet in the doc matches a sibling branch byte-for-byte but not
  `main`.

## Why

Solution docs here are not passive prose: `tags` + `applies_to` make them
**injection-eligible** — the pattern hook delivers them, whole, into the
context of the next agent editing a matching path. A doc that says "use
`buildJunkRecipeWhere`, delete `isJunkRecipeName`" injects identically whether
or not the branch that created `buildJunkRecipeWhere` ever merged. If the docs
PR lands first (or the code PR is closed unmerged), the knowledge base
actively instructs deleting a live test suite in favor of a function that
does not exist. Found in review of PR #827, whose four docs all cited code
existing only on open sibling PRs #822/#824/#825. Todos avoid this
structurally — the template's `## Dependencies` section names the blocking PR
— but the solution-doc schema has no such field, so the PR body must carry it.

## Examples

- PR #827's fix: a bold "MERGE ORDER: merge #822, #824, #825 first" section
  appended to the PR body, plus a merge-time checklist item to re-verify each
  cited path against `origin/main`.
- Verification one-liner per cited path:
  `git cat-file -e origin/main:server/scripts/cleanup-seed-recipes-utils.ts && echo on-main`.

## Exceptions

- Historical narrative (an incident description, a "the old code did X"
  root-cause section) may reference code that never merges — only
  *actionable* references (Solution/Examples/Related Files) need to resolve.
- See Also links between docs inside the same PR are fine — they merge
  atomically together.

## Related Files

- `docs/solutions/code-quality/lookalike-test-of-a-reimplemented-predicate-guards-nothing-2026-08-16.md` — the doc whose Solution section made this rule concrete.
- `todos/TEMPLATE.md` — the `## Dependencies` section that gives todos this property for free.

## See Also

- [Deleting a branch that is an open PR's head closes the PR unmerged](delete-branch-only-after-confirming-pr-merged-2026-07-06.md) — the sibling ordering hazard on the branch side.
- [A stated invariant is not an enforced one](a-stated-invariant-is-not-an-enforced-one-2026-08-06.md) — the general principle; the merge-order dependency must be stated where the merger will see it, not assumed.
