<!-- Filename: P3-2026-07-03-solutions-stale-homerecipecard-refs.md -->

---

title: "Fix 3 stale HomeRecipeCard pointers in the live docs/solutions corpus (orphaned by PR #494)"
status: done
priority: low
created: 2026-07-03
updated: 2026-07-03
assignee:
labels: [deferred, docs]
github_issue:

---

# Fix 3 stale HomeRecipeCard pointers in the live docs/solutions corpus

## Summary

PR #494 deleted `client/components/HomeRecipeCard.tsx` (+ test). Its wide-deletion sweep
trimmed `docs/FRONTEND.md` but missed three **live** `docs/solutions/` files that still point
at the deleted component. All three were CONFIRMED by the #494 review workflow (13 agents,
adversarially verified). Docs-hygiene only — no code defect.

## Background

The `docs/solutions/` corpus is the live, auto-injected knowledge store — its `applies_to:`
frontmatter is retrieval metadata read by `.claude/hooks/inject-patterns.sh`, and its
"Related Files" entries are finding-aids future sessions actively follow. Unlike prose
`file:line` citations (allowed to age per
`docs/solutions/conventions/cross-reference-code-by-stable-name-not-line-numbers-2026-07-03.md`,
solutions files are point-in-time documents), retrieval metadata and finding-aid pointers to
now-deleted files actively misdirect.

Explicitly EXEMPT (verified, do not edit): `docs/legacy-patterns/react-native.md:3206`
(frozen archive by design per `docs/PATTERNS.md`) and six `todos/archive/*.md` references
(historical records, no path-resolving consumers).

## Acceptance Criteria

- [ ] `docs/solutions/logic-errors/decorative-badge-double-announcement-2026-05-13.md`:
      drop `client/components/HomeRecipeCard.tsx` from `applies_to:` (keep the
      `client/components/**/*Card.tsx` glob — 12+ live Card components still match); REMOVE
      the "Related Files → fixed implementation" entry (line ~64) entirely — do NOT repoint
      it (verified 2026-07-03: no surviving component demonstrates the two-part fix; the
      solution's inline code block is the canonical example, and the See Also pattern docs
      stay); adjust the line-17 prose that names HomeRecipeCard as the live implementation
      (past-tense/point-in-time wording is fine). `applies_to:` must stay single-line
      inline-flow.
- [ ] `docs/solutions/conventions/react-import-in-vi-mock-factory-require-vs-esm-2026-06-22.md`:
      remove the line-59 citation of the deleted `HomeRecipeCard.test.tsx` precedent — the
      adjacent line already cites `client/camera/components/__tests__/CameraView.test.tsx`,
      verified to demonstrate the same top-level-ESM form at PR head.
- [ ] `docs/solutions/conventions/dynamic-type-overflow-prevention-2026-05-13.md`: remove
      "HomeRecipeCard difficulty badge" from the line-39 "Where it's applied" enumeration
      (the other entries — Tab bar labels, CalorieBudgetBar, Chip, VerificationBadge — remain
      valid).
- [ ] `grep -rn "HomeRecipeCard" docs/solutions/` returns zero hits afterward.
- [ ] No edits to `docs/legacy-patterns/` or `todos/archive/` (frozen/historical).

## Implementation Notes

- Files in scope: exactly the three `docs/solutions/` files above. `docs/solutions/` is in
  `.prettierignore`; `scripts/check-solution-frontmatter.js` (lint-staged) validates
  frontmatter — keep arrays inline-flow.
- Bump each file's `last_updated:` if the schema carries it (check `docs/solutions/README.md`);
  do not change `created:`.
- Evidence trail: PR #494 review workflow verdicts (2026-07-03, this session's review run).

## Dependencies

- None. PR #494 is merged (`775c2b5a`); this is pure docs cleanup.

## Risks

- Trivial. Only risk is over-cleaning: leave the frozen archive and todos/archive untouched.

## Updates

### 2026-07-03

- Initial creation. Filed from the PR #494 review (wide-deletion-sweep lens): the sweep
  reached docs/FRONTEND.md but not the docs/solutions corpus — 3 CONFIRMED stale pointers.
- Re-spec before dispatch (plan review): AC #1 originally said to repoint the "fixed
  implementation" entry at `client/components/home/CarouselRecipeCard.tsx` ("same badge
  pattern"). Verification showed that component's remix badge exhibits the documented
  ANTI-pattern — the badge `View` carries its own `accessibilityLabel="Remixed recipe"`
  (line 169) and the parent Pressable label (line 100) has no badge prefix — and no
  surviving component demonstrates the fix. User chose docs-only: drop the pointer
  entirely; the CarouselRecipeCard a11y defect is surfaced separately, not fixed here.
