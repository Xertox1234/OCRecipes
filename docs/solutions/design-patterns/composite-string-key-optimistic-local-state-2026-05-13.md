---
title: Composite string key for optimistic local state (server ID arrives async)
track: knowledge
category: design-patterns
module: client
tags: [react-native, optimistic-ui, state, composite-key, async]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
---

# Composite string key for optimistic local state (server ID arrives async)

## When this applies

When a UI action (Accept, Dismiss, Use) must be reflected immediately but the server-assigned ID isn't available yet — because it comes from an async extraction step — use a composite string key instead of waiting.

## Examples

The problem: A commitment block is displayed during streaming. The user taps "Accept." `block.notebookEntryId` is `undefined` — notebook extraction runs asynchronously after the stream ends. Gating the UI update on `if (!notebookEntryId) return` makes the button a no-op.

The fix: derive a synthetic key from stable block fields:

```typescript
const key: number | string = notebookEntryId ?? `${title}::${followUpDate}`;

acceptedCommitmentsRef.current = new Set([
  ...acceptedCommitmentsRef.current,
  key,
]);
setCommitmentVersion((v) => v + 1); // trigger re-render
if (!notebookEntryId) return; // only skip the API call
try {
  await apiRequest("POST", `/api/chat/commitments/${notebookEntryId}/accept`);
} catch {
  /* non-fatal — local state already updated */
}
```

Reading back — the lookup must use the same composite formula:

```typescript
const isAccepted = acceptedCommitmentsRef.current.has(
  block.notebookEntryId ?? `${block.title}::${block.followUpDate}`,
);
```

## Why

**Key design:**

- Use `::` as separator (double colon is unlikely to appear in user-generated field values)
- Include enough fields to make collisions impossible for the feature (title + date is sufficient for commitments)
- The ref type widens to `Set<number | string>` — both types are valid Set members

## Exceptions

When to use: any optimistic UI where the server ID arrives asynchronously (AI extraction, background job) but the user action must register immediately.

## Related Files

- `client/components/coach/CoachChat.tsx` (`handleCommitmentAccept`, `acceptedCommitmentsRef`)
