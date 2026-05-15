---
title: "Fix sourceType provenance in logAllMutation (not always 'voice')"
status: done
priority: low
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, code-quality]
---

# Fix sourceType provenance in logAllMutation

## Summary

`logAllMutation.mutationFn` always sets `sourceType: "voice"` regardless of whether items came from voice, typed text, or chip tap — corrupting provenance analytics.

## Background

Deferred from 2026-05-02 full audit (finding L5). `client/hooks/useQuickLogSession.ts` line 119. The hook does not currently track _how_ items were parsed. A `ParsedFoodItem.sourceType` field could be added at parse time and forwarded through to the mutation.

## Acceptance Criteria

- [ ] `ParsedFoodItem` has an optional `sourceType: "voice" | "text" | "chip"` field
- [ ] `handleTextSubmit` tags items as `"text"`, voice auto-parse tags as `"voice"`, chip press tags as `"chip"`
- [ ] `logAllMutation` uses the item's `sourceType` (falling back to `"voice"` for legacy items)

## Implementation Notes

`ParsedFoodItem` is defined in `useQuickLogSession.ts` (imported from `useFoodParse`). May need to propagate the field through the parse response or enrich it client-side after parsing based on which trigger fired.

## Dependencies

- None critical; affects analytics only

## Risks

- Requires coordinating changes across parse trigger points

## Updates

### 2026-05-02

- Initial creation (deferred from audit L5)
