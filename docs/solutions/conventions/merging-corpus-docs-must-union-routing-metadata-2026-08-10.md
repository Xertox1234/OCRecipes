---
title: Merging corpus docs must union the loser's routing metadata into the survivor
track: knowledge
category: conventions
module: shared
tags: [knowledge-base, frontmatter, grep-retrieval, dedup, tags, injection, harness]
applies_to: [docs/solutions/**/*.md]
created: '2026-08-10'
---

# Merging corpus docs must union the loser's routing metadata into the survivor

## Rule

When two `docs/solutions/` docs merge, folding the loser's **prose** into the survivor is only half the merge. The loser's `tags:` and `applies_to:` are **routing metadata** — the inject hook selects docs by a whole-word grep on the `^tags:` line (a missing domain tag is a hard exclusion from that domain's pool, not a demotion), and `applies_to` globs decide ranking tier. Union both into the survivor's frontmatter, or the merged lesson goes dark in exactly the injection contexts the deleted doc used to serve.

## Why

A merge that is content-complete can still be retrieval-incomplete. The PR #795 dedup pass proved this three times in one review:

- The deleted `drizzle-sql-template-bound-parameters` was the only `database`-tagged carrier of the `${column}`-binds-a-parameter gotcha; the surviving bug doc lacked the tag, so `server/storage/**` edits stopped surfacing the lesson entirely.
- The deleted fire-and-forget doc carried the `api` tag — the load-bearing domain tag for route files (`routes` is not a registered domain and has no mechanical effect) — which the surviving helper doc lacked; route-file sessions, the pattern's primary audience, lost it.
- The deleted `fail-fast-environment-validation` carried `applies_to: [server/**/*.ts]`; the Zod survivor listed only three exact env files, dropping the folded startup-not-request-time rule from glob tier to general tier for every other server file.

**Reach note:** `docs/solutions/**` and `docs/rules/**` route to the `harness` domain (rule added 2026-08-11, after this doc's own review flagged that no `docs/**` path routed anywhere), so harness-tagged lessons — this one included — inject while you edit corpus docs, with `applies_to` ranking within that pool. Still treat the checklist below as part of the merge procedure itself rather than relying on the reminder.

## Checklist for a corpus-doc merge

1. Fold the loser's unique prose into the survivor.
2. **Diff the two `tags:` lines** — union them, dropping a loser tag only when it is wrong for the merged content. Do NOT filter by "is this a domain name": `domain_tag_pattern` matches alternations, not just literal domain names (`tooling`/`pg-lab`/`worktree`/`agents` all select the `harness` pool; any `ai-*` tag selects `ai-prompting`).
3. **Diff the two `applies_to:` lines** — carry over any glob that widens the survivor's reach to files the loser covered.
4. Repoint inbound See-Also links, delete the loser.
5. Keep the frontmatter arrays single-line inline-flow (`scripts/check-solution-frontmatter.js` enforces this).

## Exceptions

Don't union a loser tag that is wrong for the merged content (e.g. a tag that only described the loser's now-removed example). The test is: would a session editing files in that domain still want this lesson injected?

## Related Files

- `.claude/hooks/inject-patterns.sh` — the `^tags:` whole-word domain grep and `applies_to` tier ranking this rule protects
- `scripts/check-solution-frontmatter.js` — write-time frontmatter lint

## See Also

- [A grep-retrieved corpus needs a write-time format lint once its parsing layer is deleted](grep-retrieved-corpus-needs-write-time-format-lint-2026-07-03.md) — the sibling rule: frontmatter format is load-bearing for the same grep layer
