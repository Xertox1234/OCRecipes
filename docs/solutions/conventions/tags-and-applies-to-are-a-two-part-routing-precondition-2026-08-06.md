---
title: 'tags and applies_to are a two-part precondition — a precise glob over an unrouted path is inert'
track: knowledge
category: conventions
module: shared
tags: [inject-patterns, applies_to, tags, path-domains, routing, harness, tooling, codify]
applies_to: [docs/solutions/**/*.md, scripts/lib/path-domains.ts, .claude/hooks/inject-patterns.sh, .claude/skills/**]
symptoms: [An applies_to glob names exactly the right files and the solution still never appears, A solution is added to the corpus and the injected set for its own domain does not change, A glob points at a directory that maps to no domain at all]
created: '2026-08-06'
---

# `tags` and `applies_to` are a two-part precondition — a precise glob over an unrouted path is inert

## Rule

Retrieval selects by **`tags` first**, then partitions the survivors by `applies_to`. So an
`applies_to` glob only ever fires for a file whose **routed domains intersect that same solution's
`tags`**. Before writing a glob, check what the target path actually routes to:

```bash
npx tsx scripts/lib/path-domains.ts <path>          # the domains this file will match
```

Both halves must line up. Either add the routed domain to `tags`, or point the glob at paths that
route to a domain the solution already carries.

## Smell patterns

- An `applies_to` entry naming a directory the solution's `tags` have no domain in common with —
  e.g. `tags: [database]` with `applies_to: [server/routes/**/*.ts]`, when `server/routes/**`
  routes to `api, security, architecture` and never `database`.
- Verifying a glob by checking it resolves to real **files** (`ls`) and stopping there. File
  existence and domain routing are different questions; the first can pass while the second fails.
- An `applies_to` glob for a path with **no** `PATH_TO_DOMAINS` rule at all. Those are doubly
  inert: no domain matches, so no tag can intersect.

## Why

`solutions_from_markdown` builds its candidate set with
`grep -rl "^tags:.*<domain-pattern>"` for each domain the edited file routed to, and only then
looks at `applies_to`. A solution the tag-grep never returned is not in the room when relevance is
considered — no glob, however exact, can pull it back in.

This is easy to get wrong from both directions, and both were found in review of the same
codebase on the same day:

- **Glob right, tag missing.** Three solutions were backfilled with accurate `applies_to` globs;
  two carried tags (`database`, `typescript`) that the named paths never route to, so five of the
  eight new entries were dead on arrival. The globs had been verified to resolve to real files —
  which is exactly the check that does not catch this.
- **Tag right, path unrouted.** Five corpus solutions already declared `.husky/**` in
  `applies_to`, but no `PATH_TO_DOMAINS` rule matched `.husky/**`, so editing the repo's actual
  commit/push gate injected nothing at all. The corpus was expressing an expectation the routing
  table did not implement.

## Examples

(Frontmatter keys below are indented by one space on purpose — a column-0 `tags:` or
`applies_to:` in a body example decoys the hook's line-anchored grep, which is why
`scripts/check-solution-frontmatter.js` rejects it.)

```yaml
# INERT — server/routes/** routes to api,security,architecture; never `database`.
 tags: [timezone, database, nutrition]
 applies_to: [server/routes/**/*.ts, server/storage/**/*.ts]

# LIVE — add the domains those paths actually route to.
 tags: [timezone, database, api, architecture, nutrition]
 applies_to: [server/routes/**/*.ts, server/storage/**/*.ts]
```

Widening `tags` is the better fix when the solution genuinely governs those paths. Narrowing the
glob instead can leave the frontmatter accurate but useless — pointing at some other directory the
solution has nothing to do with, just because that one happens to route correctly.

## Exceptions

Post-relevance-fix (see See Also), adding a tag is comparatively safe: a tagged solution surfaces
where its globs match rather than diluting its domain's pool by date. Before that fix, a broad tag
was a real cost. Do not carry the old caution forward without re-measuring.

## Related Files

- `.claude/hooks/inject-patterns.sh` — `solutions_from_markdown`, `domain_tag_pattern`
- `scripts/lib/path-domains.ts` — the single source of truth for path → domain routing
- `docs/solutions/README.md` — states this precondition with a worked inert example

## See Also

- [truncate-before-rank discards the best candidates](../logic-errors/truncate-before-rank-discards-best-candidates-2026-08-06.md) — the selection-order half
- [mirror inject-patterns applies_to matching](mirror-inject-patterns-applies-to-with-bash-glob-not-globstar-2026-06-13.md) — the glob-semantics half
