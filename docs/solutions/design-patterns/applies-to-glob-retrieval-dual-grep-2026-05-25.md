---
title: 'Two-stage file→applies_to glob retrieval (dual-grep, then case-match)'
track: knowledge
category: design-patterns
module: shared
tags: [docs-solutions, glob-matching, grep, retrieval, agent-workflow, codify]
applies_to: [.claude/agents/todo-executor.md, .claude/agents/todo-researcher.md, .claude/hooks/inject-patterns.sh]
created: '2026-05-25'
---

# Two-stage file→applies_to glob retrieval (dual-grep, then case-match)

## When this applies

Any time you need to select, from the ~420 `docs/solutions/` files, the few whose
`applies_to:` glob list covers a given set of changed/affected source files —
without reading every file. The executor's verified-solution read-back uses this;
a future `inject-patterns` hook that scopes retrieval by `applies_to` (the field
`docs/solutions/README.md` calls "forward-looking") will need the identical shape.

Generalizes to: "match concrete paths against a corpus of glob-pattern frontmatter,
cheaply, at scale."

## Smell patterns

- A single `grep` for one path prefix (e.g. `client/components`) used as the whole
  matcher. It **silently** returns a plausible-looking subset while dropping every
  solution whose glob is the broad top-level form — no error, just missing hits.
- Reading every candidate file's frontmatter to glob-match, with no cheap pre-filter
  (the full-corpus scan that caused the documented agent slowdown).

## Why

Two independent traps make the naive approach wrong:

1. **`applies_to` is written in two granularities.** Most files scope narrowly
   (`server/storage/**/*.ts`), but ~30 use the broad top-level form
   (`client/**/*.tsx`, `server/**/__tests__/**/*.ts`). A grep keyed on the
   two-segment prefix (`client/components`) matches the narrow globs but the broad
   `client/**` string does **not** contain `client/components`, so those solutions
   vanish from the candidate set. The failure is silent because grep still returns
   *something*. You must **union two greps per affected file**: narrow
   (`<2-seg-prefix>`) + broad (`<top-seg>/\*\*`).

2. **Precise glob evaluation is too expensive to run on 420 files** but trivial on a
   pre-filtered handful. So split it: a cheap, lossy `grep` filter to cut 420 → a
   handful, then precise matching only on survivors. For the precise step, a POSIX
   shell `case "$file" in $glob)` test is deterministic and treats `*` and `**`
   identically (both span `/`), so it errs toward **inclusion**, never exclusion —
   the right bias when the result feeds a ranker + top-N cap, because over-inclusion
   is pruned downstream while a missed match is unrecoverable.

The throughline: **when a filter feeds a ranker, bias the filter toward recall.** A
lossy pre-filter is only safe if it never drops a true positive; the dual grep and
the permissive `case` test are both expressions of that rule.

## Examples

Stage 1 — cheap candidate set (union narrow + broad, per affected file):

```bash
# affected file: server/storage/cookbooks.ts  → 2-seg "server/storage", top "server"
grep -rlE "^applies_to:.*server/storage" docs/solutions --include='*.md' | grep -v _manifests
grep -rlE "^applies_to:.*\bserver/\*\*"  docs/solutions --include='*.md' | grep -v _manifests
```

Stage 2 — precise match on candidates only, then rank + cap:

```bash
# keep a candidate if any of its applies_to globs matches a full affected path
case "client/components/Foo.tsx" in client/**/*.tsx) echo match ;; esac
```

Rank survivors by: (1) `applies_to` glob hit, (2) `tags ∩ labels` overlap,
(3) `symptoms`/title keyword overlap. Read the full body of the **top 3** only.

## Exceptions

- **Top-level affected files** (e.g. `shared/schema.ts`) have no two-segment dir —
  grep the filename plus the top segment instead.
- **Empty affected-file set** (a no-file todo): glob matching is impossible; fall
  back to `tags`/keyword matching with a stricter threshold (≥2 tag overlaps + a
  keyword hit) to avoid noise.
- **Stale globs**: a matched solution may reference a renamed/removed file. Verify
  its `Related Files` still exist before treating it as authoritative; otherwise it
  is advisory only.

## Related Files

- `.claude/agents/todo-executor.md` — Step 3 "Verified-solution read-back" implements this pattern; Step 9 dedup writes back through it.
- `docs/solutions/README.md` — `applies_to` schema and the "forward-looking hook" note.

## See Also

- [README schema](../README.md) — `applies_to` field and frontmatter contract.
