---
title: 'Prettier wraps committed solutions-db fixtures, breaking the grep-based markdown inject path (Gate C)'
track: bug
category: logic-errors
module: shared
severity: medium
tags: [ci, prettier, solutions-db, inject-patterns, yaml-frontmatter, grep, fixtures, hook-equivalence]
symptoms: ['CI ''Solutions-DB gates'' job fails at Gate C with ''GATE C FAILED: N/M probes diverged.''', hook-equivalence-check.ts reports 'MISMATCH for <file> (md=0 db=2)' with the same solution listed twice under db-only, A solution the DB inject path surfaces is invisible to the markdown fallback path (md=0) even though its tags clearly match the domain, The divergence is on exactly one fixture; the other probes pass]
applies_to: [.prettierignore, docs/solutions/**/*.md, .claude/hooks/inject-patterns.sh, .gitignore]
created: '2026-06-21'
last_updated: '2026-07-03'
---

# Prettier wraps committed solutions-db fixtures, breaking the grep-based markdown inject path (Gate C)

## Problem

The pattern-injection hook (`.claude/hooks/inject-patterns.sh`) has two code paths
that MUST emit identical solution references: a DB path (`solutions_from_db`,
queries the `ocrecipes_solutions` Postgres) and a markdown-fallback path
(`solutions_from_markdown`, reads `docs/solutions/*.md`). Gate C
(`npm run solutions:db:hook-check`) proves they agree across representative probe
files. It runs against a **committed fixture corpus**
(`scripts/solutions-db/__fixtures__/solutions/`) because the real `docs/solutions/`
is gitignored.

Gate C failed on `main` for ~6 days (since the gate was added) with `md=0 db=2`
divergences on 4 `client/**` probes — all caused by a single fixture.

## Symptoms

- `GATE C FAILED: 4/11 probes diverged.`
- `MISMATCH for client/screens/HomeScreen.tsx (md=0 db=2)` — the DB path emits the
  same solution twice (once per matching domain), the markdown path emits it zero
  times.

## Root Cause

The markdown path matches a solution to a domain by grepping the file's tag line:

```bash
grep -rl --include='*.md' -E "^tags:.*${tag_pattern}" "$SOLUTIONS_DIR"
```

This only works when the tag is on the **same physical line** as `tags:`. But the
fixture file is **committed**, so `lint-staged` runs Prettier on it, and Prettier
wraps any YAML-frontmatter array longer than `printWidth` (80) onto multiple lines:

```yaml
tags:
  [
    accessibility,
    react-native,    # <- now on a continuation line; ^tags:.* can never see it
    ...
  ]
```

So `solutions_from_markdown` found the solution **0** times (`md=0`), while
`solutions_from_db` — querying a properly-parsed `tags` array with
`EXISTS (unnest(tags) WHERE t ~ ...)` — matched it under **both** the
`react-native` and `accessibility` domains (`db=2`, undeduped). Divergence.

The real mirror files this fixture is supposed to imitate are produced by
`scripts/solutions-db/export.ts`, are **gitignored** (so Prettier never touches
them), and use **single-line inline-flow arrays**. The committed fixture had been
silently reformatted into a shape production never has — the gate was testing an
unreal input.

`prettier --check` reported the multi-line file as already conformant, so
re-flattening the array by hand would not stick: the next commit's `lint-staged`
re-wraps it.

## Solution

Make the committed fixtures match the canonical, never-Prettier'd real-file format:

1. Exempt the fixture corpus in `.prettierignore` so Prettier (and lint-staged)
   never re-wrap its arrays:

   ```
   scripts/solutions-db/__fixtures__/solutions/
   ```

2. Un-wrap the offending fixture's `tags:` back to a single line:

   ```yaml
   tags: [accessibility, react-native, voiceover, talkback, inline-error, announceForAccessibility]
   ```

Verify: `prettier --check <fixture>` now skips it; `grep -E "^tags:.*\breact-native\b"`
matches; `gray-matter` still parses `tags`/`applies_to`; CI Gate C goes green.

## Prevention

- **Any committed file that must stay byte-identical to a generated/gitignored
  artifact belongs in `.prettierignore`.** The repo already does this for
  `.github/copilot-instructions.md` (generated) and `package-lock.json`. Fixtures
  that mirror `export.ts` output are the same class of file.
- **Line-oriented `grep` parsing of YAML assumes single-line values.** If a hook
  or script greps `^key:.*value`, the inputs it reads must be guaranteed
  single-line — either by generating them that way or by exempting them from any
  formatter that re-wraps. Prefer a real YAML parser when the input format is not
  under your control.
- A green pure-lib unit test does not prove inject equivalence — Gate C is the
  only check that exercises the hook's two real paths end-to-end. Keep it green.
- **Un-gitignoring a tree is a behavior change, not just git bookkeeping: every
  staged-file hook (lint-staged patterns, pre-commit checks) suddenly applies to
  it.** Audit the lint-staged globs against the tree's format invariants and add
  the ignore-file entries BEFORE the mass `git add` — ordering is load-bearing,
  because the reformat happens at commit time and is silent. This trap recurred
  2026-07-03 when the whole `docs/solutions/` corpus (572 files) became tracked
  for the markdown-canonical cutover; `docs/solutions/` went into
  `.prettierignore` first, and a post-commit assertion verified every committed
  `tags:` array was still single-line.

## Update (2026-07-03)

The solutions DB, Gate C, and the fixture corpus described above were retired by
the markdown-canonical cutover (`docs/solutions/` is now the tracked canonical
store; PR #491). The Root Cause mechanics and Prevention rules remain current —
the hook's `^tags:` grep is now the ONLY inject path, so a wrapped array no
longer causes a divergence; it silently drops the solution from injection.

## Related Files

- `.prettierignore` — `docs/solutions/` exemption + rationale comment (fixture-corpus entry retired 2026-07)
- `.claude/hooks/inject-patterns.sh` — `solutions_from_markdown` (the sole inject path since 2026-07)
- `.gitignore` — where `docs/solutions/` was un-ignored in the cutover

## See Also

- [zod-array-string-drops-yaml-scalar-tags](zod-array-string-drops-yaml-scalar-tags-2026-06-14.md) — another YAML-shape gotcha in the solutions-db pipeline
- [gray-matter-throws-synchronously-on-malformed-yaml](../runtime-errors/gray-matter-throws-synchronously-on-malformed-yaml-2026-06-13.md) — frontmatter-parsing failure mode in the same tooling
