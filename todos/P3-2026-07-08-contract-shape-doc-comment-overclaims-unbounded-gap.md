<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "contract-shape.ts doc comment overclaims the primitive-value redaction gap is unbounded"
status: backlog
priority: low
created: 2026-07-08
updated: 2026-07-08
assignee:
labels: [deferred, server]
github_issue:

---

# contract-shape.ts doc comment overclaims the primitive-value redaction gap is unbounded

## Summary

The doc comment above `hasUniformNonPrimitiveValueShape()` in `server/lib/contract-shape.ts`
claims an all-primitive-valued dynamic-keyed object "is caught by NEITHER signal, at ANY entry
count." This is inaccurate: `looksDynamicallyKeyed()`'s `keys.length > MAX_STATIC_OBJECT_KEYS`
(50) check fires independently of value type, so the real gap is bounded to 2-50 entries, not
unbounded.

## Background

Found during code review of PR #544, confirmed via live trace: a 60-entry all-primitive-valued
object with free-text keys IS redacted by `looksDynamicallyKeyed` alone (60 > 50), contradicting
the comment. Low severity — pure documentation-accuracy fix, no behavior change — but worth
correcting since a future maintainer relying on this comment to reason about the guard's real
coverage could misjudge the attack surface for a security-sensitive redaction path.

## Acceptance Criteria

- [ ] Doc comment above `hasUniformNonPrimitiveValueShape()` accurately states the primitive-
      value gap is bounded to 2-50 entries (not "ANY entry count").

## Implementation Notes

`server/lib/contract-shape.ts` — the comment block directly above `hasUniformNonPrimitiveValueShape`.

## Dependencies

- None.

## Risks

- None — comment-only change.

## Updates

### 2026-07-08

- Filed during code review of PR #544 (merged as 137b746e).
