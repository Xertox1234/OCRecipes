<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "contract-shape.ts duplicates EMAIL_RE/UUID_RE instead of importing a shared constant"
status: done
priority: low
created: 2026-07-08
updated: 2026-07-09
assignee:
labels: [deferred, server]
github_issue:

---

# contract-shape.ts duplicates EMAIL_RE/UUID_RE instead of importing a shared constant

## Summary

`DYNAMIC_KEY_PATTERNS` in `server/lib/contract-shape.ts` re-declares an email regex identical
to `EMAIL_RE` in `client/components/ChangeEmailModal.tsx`, and a UUID regex identical to
`UUID_RE` in `server/index.ts` — both character-for-character duplicates, with no shared
constant either file could import from instead.

## Background

Found during code review of PR #544, confirmed both duplications are exact today. The UUID
case is structurally unavoidable as-is (`server/index.ts`'s `UUID_RE` isn't exported), so the
actionable fix is promoting one or both patterns to a shared `shared/`-level constant both
files import, not a one-line "import instead." Low severity: a future edit to either original
regex would silently desync from these copies with no compiler/lint signal, but nothing is
broken today.

## Acceptance Criteria

- [ ] A single shared, exported email-validation regex used by both `ChangeEmailModal.tsx` and
      `contract-shape.ts`.
- [ ] A single shared, exported UUID-validation regex used by both `server/index.ts` and
      `contract-shape.ts`.

## Implementation Notes

- `server/lib/contract-shape.ts` — `DYNAMIC_KEY_PATTERNS`.
- `client/components/ChangeEmailModal.tsx` — `EMAIL_RE`.
- `server/index.ts` — `UUID_RE` (currently module-local, not exported).
- Likely destination: a small `shared/` constants module both client and server code can import.

## Dependencies

- None.

## Risks

- Low — pure refactor, verify existing tests for both original call sites still pass.

## Updates

### 2026-07-08

- Filed during code review of PR #544 (merged as 137b746e).

### 2026-07-09

- Archived as a duplicate. Independently re-discovered the exact same finding
  `P3-2026-07-07-contract-shape-regex-dedup.md` already tracked (both trace to PR #544's
  `DYNAMIC_KEY_PATTERNS`), caught during a `/todo` triage pass. The duplicate's acceptance
  criteria are fully satisfied by [PR #557](https://github.com/Xertox1234/OCRecipes/pull/557),
  which centralized `UUID_RE` into `server/lib/identifier-patterns.ts` and `EMAIL_SHAPE_RE` into
  `shared/constants/email-patterns.ts`. No separate implementation needed.
