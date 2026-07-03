---
title: Use extraData (not useCallback deps) for FlatList re-renders driven by ref-based state
track: knowledge
category: conventions
module: client
tags: [react-native, flatlist, performance, memo, useCallback, useRef]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-06-03'
---

# Use extraData (not useCallback deps) for FlatList re-renders driven by ref-based state

## Rule

When a FlatList's `renderItem` reads from `useRef` collections (e.g., `useRef<Set<string>>`) and uses a version-counter `useState` to signal that the ref's contents changed, **never** include the version counter in `renderItem`'s `useCallback` deps. Pass the counters via `extraData` instead. The `data` prop change already drives re-renders for new/removed items; `extraData` drives re-renders for changed display state on existing items without destabilising the `renderItem` reference.

## Why

`renderItem` is a callback passed to FlatList. FlatList caches row components using the callback's reference identity combined with item identity. Including a version counter in `useCallback` deps creates a new `renderItem` function reference on every quick-reply tap or state change, which invalidates **all** row caches — even rows whose data didn't change. This defeats `React.memo` on child components (e.g., `ChatBubble`, `BlockRenderer`) and causes full-list re-renders on every interaction.

The correct mental model:

- **`data` changes** → FlatList detects which items changed by reference/key and re-renders only those rows using the current `renderItem` closure (stable).
- **`extraData` changes** → FlatList re-renders all visible rows using the current `renderItem` closure. Use this when existing rows need to update their display state (e.g., marking a quick reply as used) without any item being added or removed.

Because `renderItem` reads `usedQuickRepliesRef.current` and `acceptedCommitmentsRef.current` at call time (not at closure-capture time), the stable closure still returns fresh values from the refs when FlatList re-renders rows via `extraData`.

## Smell patterns

- A `useCallback` with `someVersionCounter` in its deps array, where `someVersionCounter` is only ever incremented (`setX(v => v + 1)`) and never used to compute a value — it exists only to force a new callback ref.
- Version counter state paired with a `useRef<Set>` for the same domain (e.g., `usedQuickRepliesRef` + `quickReplyVersion`).
- A FlatList without `extraData` when the component uses ref-based collections for row display state.

## Examples

```tsx
// Before: version counter in useCallback deps creates new renderItem ref on every tap
const renderItem = useCallback(
  ({ item }) => {
    const isUsed = usedQuickRepliesRef.current.has(bKey);
    return <BlockRenderer isUsed={isUsed} />;
  },
  [
    handleQuickReply,
    messageBlocks,
    quickReplyVersion,   // defeats memoization
    commitmentVersion,   // defeats memoization
  ],
);

<FlatList data={chatItems} renderItem={renderItem} />
```

```tsx
// After: stable renderItem ref + extraData drives re-renders for existing rows
const renderItem = useCallback(
  ({ item }) => {
    const isUsed = usedQuickRepliesRef.current.has(bKey);  // reads fresh at call time
    return <BlockRenderer isUsed={isUsed} />;
  },
  [
    handleQuickReply,
    messageBlocks,
    // quickReplyVersion and commitmentVersion removed
  ],
);

<FlatList
  data={chatItems}
  renderItem={renderItem}
  extraData={[quickReplyVersion, commitmentVersion]}
/>
```

## Exceptions

- If `renderItem` genuinely computes a value _from_ the counter (not just reads a ref), the counter must stay in deps.
- When all row state is derived from `data` (no ref-based collections), `extraData` is unnecessary.

## Related Files

- `client/components/coach/CoachChat.tsx` — fixed: removed `quickReplyVersion`/`commitmentVersion` from `renderItem` deps, added to `extraData`

## See Also

- [inline-arrow-functions-defeat-react-memo-2026-05-13.md](../performance-issues/inline-arrow-functions-defeat-react-memo-2026-05-13.md)
