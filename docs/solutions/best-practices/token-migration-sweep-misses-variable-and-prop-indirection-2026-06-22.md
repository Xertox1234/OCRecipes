---
title: 'Token migration: a literal sweep misses variable, prop, and ternary indirection'
track: knowledge
category: best-practices
module: client
tags: [refactoring, migration, design-system, accessibility, completeness, code-review]
created: '2026-06-22'
---

# Token migration: a literal sweep misses variable, prop, and ternary indirection

## When this applies

Migrating a value used in many places from one token to another (e.g.
`theme.link` → `theme.accentSolid` for solid fills). A `grep`/`sed` on the literal
`theme.link` catches direct uses but SILENTLY MISSES fills reached through
indirection — and for an a11y fix the survivors are exactly the bug you set out to
fix (three real white-on-`#E07050` = 3.18:1 CTAs shipped past the first sweep here,
including the core scan-flow "Log It" button).

## Checklist (run before declaring a token sweep complete)

1. **Direct literals** — `backgroundColor: theme.X` (the easy ~90%).
2. **Intermediate variables** — `const accentColor = theme.X; … backgroundColor: accentColor`.
   Grep `(const|let)\s+\w+\s*=\s*theme\.X`, AND multi-line ternary assignments
   (`const buttonBg =\n  cond ? … : theme.X` — single-line greps miss these).
3. **Color props** — `<Comp fillColor={theme.X}>` / `activeColor` / `filledColor`.
   Grep `\w*[Cc]olor=\{theme\.X\}` and check whether each receiver uses it as a fill.
4. **Ternary positions** — BOTH branches: `cond ? theme.X : …` AND `… : theme.X`, plus
   `?? theme.X`. A pattern that matched only one disabled-opacity (`withOpacity(theme.X, 0.3)`)
   misses its siblings (`0.4`, `0.12`).
5. **Near-opaque tints** — `withOpacity(theme.X, ≥0.85)` behaves as a solid fill.
6. **Classify by property, never by pattern** — the SAME `? theme.X :` shape appears under
   `backgroundColor` (migrate) AND `borderColor`/`color` (LEAVE). Blindly converting the
   pattern darkens text/borders and introduces a NEW inverse failure (a fill token as text
   = 3.23:1).
7. **Final audit (two greps)** — (a) every remaining `theme.X` reaches no fill; (b) the NEW
   token appears ONLY in `backgroundColor` — never `color`/`borderColor`/`tintColor`.

## Why

`tsc` proves the new token resolves; the full test suite proves nothing broke; neither
proves COMPLETENESS or visual correctness. Inline JSX `backgroundColor` styles have no
unit-test backstop, so adversarial review — not the tool that made the change — is what
catches indirection misses. Pair the migration with a binding rule in `docs/rules/` so the
next author can't silently reintroduce the old literal (CI cannot fail an
aesthetically-fine-looking 3.18:1 fill).

## Related Files

- `docs/rules/design-system.md` — the `link`-vs-`accentSolid` rule that backstops the migration
- `client/constants/theme.ts` — the split token definition

## See Also

- [dark-mode accent token split](../conventions/dark-mode-accent-token-foreground-vs-fill-split-2026-06-22.md) — the migration this checklist supported
