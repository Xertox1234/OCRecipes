---
title: A grep-retrieved corpus needs a write-time format lint once its parsing layer is deleted
track: knowledge
category: conventions
module: shared
tags: [knowledge-base, lint-staged, frontmatter, grep-retrieval, validation, harness]
applies_to: [scripts/check-solution-frontmatter.js, .claude/hooks/inject-patterns.sh, .claude/hooks/session-recent-issues.sh]
created: '2026-07-03'
---

# A grep-retrieved corpus needs a write-time format lint once its parsing layer is deleted

## Rule

When a store's parsed/validating layer is retired and line-anchored greps become
the ONLY retrieval mechanism, the format invariants that layer used to normalize
MUST move to a write-time lint (lint-staged / CI on the changed files). Prose
("keep arrays single-line") is not enforcement — a violating file is silently
invisible to retrieval, with no error anywhere, forever.

## Why

The 2026-07 markdown-canonical cutover (PR #491) deleted the `ocrecipes_solutions`
DB whose ingest (`gray-matter` + zod) validated every solution at write time.
After the cutover, `inject-patterns.sh` (`^tags:` grep) and
`session-recent-issues.sh` (frontmatter awk) were the sole retrieval paths — and
the corpus ALREADY contained the failure class the review predicted: 1 file with
no `tags:` line (permanently invisible to injection), 4 dateless filenames
(mis-sorted by the newest-first filename sort), and 5 more missing
schema-required fields. All were CI-green. The fix that closed the gap is
`scripts/check-solution-frontmatter.js` in lint-staged: required keys per track,
single-line inline-flow arrays, ISO `created`, dated filename, `category` ==
parent dir, and no column-0 `tags:`/`applies_to:` body decoys.

The general shape: **a parser tolerates format variance; a grep does not.**
Deleting the parser converts every tolerated variance into a silent retrieval
miss, so the contract has to be re-imposed where files are written.

## Examples

- `scripts/check-solution-frontmatter.js` + the `docs/solutions/**/*.md`
  lint-staged entry in `package.json` — the write-time replacement for the
  retired ingest validation.
- The invariant statement in `docs/solutions/README.md` (schema authority) and
  the `docs/solutions/` entry in `.prettierignore` (Prettier would re-wrap long
  inline arrays past the line-anchored grep).

## Exceptions

- A one-off scratch corpus nobody greps programmatically needs no lint.
- Do not build the lint speculatively while a validating write path still
  exists — this rule fires at the moment the parser is deleted, not before
  (the repo's deletion bias is correct; the lint earns its keep only against a
  demonstrated silent-failure class).

## Related Files

- `scripts/check-solution-frontmatter.js`
- `.claude/hooks/inject-patterns.sh`
- `.claude/hooks/session-recent-issues.sh`
- `docs/solutions/README.md`
- `.prettierignore`

## See Also

- [machine-routed-values-need-enum-not-prose](machine-routed-values-need-enum-not-prose-2026-07-02.md) — sibling rule: values consumed by machinery need enforcement, not prose
- [prettier-wraps-fixture-tags-breaks-hook-equiv-grep](../logic-errors/prettier-wraps-fixture-tags-breaks-hook-equiv-grep-2026-06-21.md) — the original wrapped-array failure this lint now guards against
- [hash-normalized-projection-not-bytes-for-regenerated-mirror](hash-normalized-projection-not-bytes-for-regenerated-mirror-2026-06-14.md) — format-contract thinking from the retired dual-store era
