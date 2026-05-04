# Coach — Client-Side UX & Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 client-side issues: drain speed (40 → 400 chars/sec), raw-JSON 429 error screen on CoachChat, `renderItem` rebuilding every drain tick causing jank, QuickReply chips not dismissing after tap, and double-scroll at stream end.

**Architecture:** All changes are in the client layer. The drain-speed fix is a single constant change. The 429 fix adds an error parser in `CoachChat`. The rendering fix extracts a `StreamingBubble` component so `renderItem` no longer depends on `streamingContent`. The QuickReplies fix uses a session-scoped `useRef<Set>` in `CoachChat`. The double-scroll fix removes the redundant `useEffect` scroll trigger.

**Tech Stack:** React Native 0.81, React 19, TanStack Query v5, Vitest

---

## File Map

| File                                              | Change                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `client/hooks/useCoachStream.ts`                  | Change `CHARS_PER_TICK` from 2 to 20                                                                                           |
| `client/hooks/__tests__/useCoachStream.test.ts`   | Update assertion on `CHARS_PER_TICK` value                                                                                     |
| `client/components/coach/CoachChat.tsx`           | 429 handling; remove `streamingContent` from `renderItem` deps; add `usedQuickRepliesRef`; remove redundant scroll `useEffect` |
| `client/components/coach/StreamingBubble.tsx`     | New memoized component for the stream list item                                                                                |
| `client/components/coach/blocks/QuickReplies.tsx` | Add `used` prop; return `null` when used                                                                                       |

---

## Task 1: Fix drain speed

**Files:**

- Modify: `client/hooks/useCoachStream.ts:13`
- Modify: `client/hooks/__tests__/useCoachStream.test.ts` (if it asserts the old value)

- [ ] **Step 1: Check if there is a test asserting CHARS_PER_TICK value**

```bash
grep -n "CHARS_PER_TICK" client/hooks/__tests__/useCoachStream.test.ts
```

Note the current assertion. You will update it in step 3.

- [ ] **Step 2: Change the constant**

In `client/hooks/useCoachStream.ts`, line 13:

```typescript
// Before
export const CHARS_PER_TICK = 2;

// After — 20 ticks/sec × 20 chars/tick = 400 chars/sec
export const CHARS_PER_TICK = 20;
```

- [ ] **Step 3: Update the test assertion**

In `client/hooks/__tests__/useCoachStream.test.ts`, find any test that imports and checks `CHARS_PER_TICK`. Change:

```typescript
// Before
expect(CHARS_PER_TICK).toBe(2);

// After
expect(CHARS_PER_TICK).toBe(20);
```

If the test asserts `charsToRelease` behavior with a specific tick count, recalculate: a 400-char buffer with `CHARS_PER_TICK = 20` drains in 20 ticks instead of 200. Update any tick-count expectations accordingly.

- [ ] **Step 4: Run tests**

```bash
npm run test:run -- client/hooks/__tests__/useCoachStream.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/hooks/useCoachStream.ts client/hooks/__tests__/useCoachStream.test.ts
git commit -m "fix: increase coach drain speed from 40 to 400 chars/sec"
```

---

## Task 2: Fix 429 error handling in CoachChat

**Files:**

- Modify: `client/components/coach/CoachChat.tsx:81, 124–127`

- [ ] **Step 1: Add a 429-specific state variable**

In `client/components/coach/CoachChat.tsx`, add a state variable near line 81 (alongside `streamingError`):

```typescript
const [streamingError, setStreamingError] = useState<string | null>(null);
const [isAtDailyLimit, setIsAtDailyLimit] = useState(false);
```

- [ ] **Step 2: Detect 429 in the onError callback**

Find the `useCoachStream` call with its `onError` option (around line 124):

```typescript
// Before
onError: (message) => {
  setStreamingError(message);
  setOptimisticMessage(null);
},
```

```typescript
// After
onError: (message) => {
  if (message.startsWith("429")) {
    setIsAtDailyLimit(true);
  } else {
    setStreamingError(message);
  }
  setOptimisticMessage(null);
},
```

- [ ] **Step 3: Reset isAtDailyLimit when a new stream starts**

Find the `startStream` call (it is triggered from `handleSend`). Add a reset before it:

```typescript
const handleSend = useCallback(
  async (text: string) => {
    // ... existing guard logic ...
    setStreamingError(null);
    setIsAtDailyLimit(false);  // ← add this reset
    setOptimisticMessage(text);
    startStream(...);
  },
  [...existing deps...],
);
```

- [ ] **Step 4: Render the upgrade prompt when at daily limit**

Find where `streamingError` is used in the return JSX (passed to `CoachChatBase` as `streamingError` prop or rendered inline). Add the upgrade prompt adjacent to it:

```typescript
// In the return JSX, inside CoachChatBase or directly in the FlatList content area:
{isAtDailyLimit && (
  <View style={styles.limitBanner}>
    <Text style={[styles.limitText, { color: theme.textSecondary }]}>
      You've reached today's coaching limit.
    </Text>
    <Pressable
      onPress={() => navigation.navigate("Subscription")}
      accessibilityRole="button"
      accessibilityLabel="Upgrade to Coach Pro"
    >
      <Text style={[styles.limitCta, { color: theme.link }]}>
        Upgrade to Coach Pro
      </Text>
    </Pressable>
  </View>
)}
```

Add styles:

```typescript
limitBanner: {
  padding: Spacing.md,
  alignItems: "center",
  gap: 4,
},
limitText: { fontSize: 14, textAlign: "center" },
limitCta: { fontSize: 14, fontWeight: "600" },
```

Verify `"Subscription"` is the correct screen name in your navigation. Check `client/types/navigation.ts` for the root stack param list — look for the subscription or paywall screen name and use that exact string.

- [ ] **Step 5: Run tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add client/components/coach/CoachChat.tsx
git commit -m "fix: show upgrade prompt on 429 in CoachChat instead of raw JSON error"
```

---

## Task 3: Extract StreamingBubble to stop renderItem rebuilding on every drain tick

**Files:**

- Create: `client/components/coach/StreamingBubble.tsx`
- Modify: `client/components/coach/CoachChat.tsx:371–464`

- [ ] **Step 1: Create StreamingBubble component**

Create `client/components/coach/StreamingBubble.tsx`:

```typescript
import React, { memo } from "react";
import { View } from "react-native";
import { ChatBubble } from "@/components/ChatBubble";
import BlockRenderer from "@/components/coach/blocks";
import { CoachStatusRow } from "@/components/coach/CoachStatusRow";
import { useTTS } from "@/hooks/useTTS";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

interface Props {
  streamingContent: string;
  statusText: string;
  isStreaming: boolean;
  streamBlocks: CoachBlock[];
  onBlockAction: (action: { type: string; [key: string]: unknown }) => void;
  onQuickReply: (message: string) => void;
  onCommitmentAccept: (title: string, followUpDate: string) => void;
}

const StreamingBubble = memo(function StreamingBubble({
  streamingContent,
  statusText,
  isStreaming,
  streamBlocks,
  onBlockAction,
  onQuickReply,
  onCommitmentAccept,
}: Props) {
  const { ttsSpeak, speakingMessageId, isSpeaking } = useTTS();

  return (
    <View>
      {isStreaming && streamingContent && (
        <ChatBubble
          role="assistant"
          content={streamingContent}
          onSpeak={() => ttsSpeak(-1, streamingContent)}
          isSpeaking={speakingMessageId === -1 && isSpeaking}
        />
      )}
      {streamBlocks.map((block, i) => (
        <BlockRenderer
          key={`stream-block-${i}`}
          block={block}
          onAction={onBlockAction}
          onQuickReply={onQuickReply}
          onCommitmentAccept={onCommitmentAccept}
        />
      ))}
      {isStreaming && !streamingContent && statusText ? (
        <CoachStatusRow statusText={statusText} />
      ) : null}
    </View>
  );
});

export default StreamingBubble;
```

Note: If `useTTS` is not available or `ttsSpeak` is passed from the parent (not a hook), adjust accordingly — look at how `CoachChat` currently calls `useTTS` and either keep the hook in the parent and pass values as props, or keep it inside `StreamingBubble`. Whichever matches the existing pattern in `CoachChat`.

- [ ] **Step 2: Use StreamingBubble in CoachChat renderItem**

In `client/components/coach/CoachChat.tsx`:

1. Import the new component:

```typescript
import StreamingBubble from "@/components/coach/StreamingBubble";
```

2. Find `renderItem` (around line 371). Remove `streamingContent` and `statusText` from its dependency array and its `stream` branch. Replace the `stream` branch:

```typescript
// Before (inside renderItem, stream branch):
return (
  <View>
    {isStreaming && streamingContent && (
      <ChatBubble
        role="assistant"
        content={streamingContent}
        onSpeak={() => ttsSpeak(-1, streamingContent)}
        isSpeaking={speakingMessageId === -1 && isSpeaking}
      />
    )}
    {streamBlocks.map((block, i) => (
      <BlockRenderer
        key={`stream-block-${i}`}
        block={block}
        onAction={handleBlockAction}
        onQuickReply={handleQuickReply}
        onCommitmentAccept={handleCommitmentAccept}
      />
    ))}
    {isStreaming && !streamingContent && statusText ? (
      <CoachStatusRow statusText={statusText} />
    ) : null}
  </View>
);

// After:
return (
  <StreamingBubble
    streamingContent={streamingContent}
    statusText={statusText}
    isStreaming={isStreaming}
    streamBlocks={streamBlocks}
    onBlockAction={handleBlockAction}
    onQuickReply={handleQuickReply}
    onCommitmentAccept={handleCommitmentAccept}
  />
);
```

3. Remove `streamingContent` and `statusText` from the `renderItem` `useCallback` deps array. The `stream` item now renders via `StreamingBubble`'s own props — `renderItem` no longer needs those values in scope.

- [ ] **Step 3: Wrap message row in React.memo**

Find the `ChatBubble` usage in the `message` branch of `renderItem`. This branch returns a `<View>` with `ChatBubble`, `BlockRenderer` instances, and optionally a retry button. Extract it into a memoized component at the bottom of the file (or a separate file if preferred):

```typescript
interface MessageRowProps {
  message: ChatMessage;
  isRetryTarget: boolean;
  messageBlocks: Map<number, CoachBlock[]>;
  onRetry: () => void;
  onBlockAction: (action: { type: string; [key: string]: unknown }) => void;
  onQuickReply: (message: string) => void;
  onCommitmentAccept: (title: string, followUpDate: string) => void;
  usedQuickReplies: Set<string>;
}

const MessageRow = memo(function MessageRow({ ... }: MessageRowProps) {
  const { ttsSpeak, speakingMessageId, isSpeaking } = useTTS();
  const { theme } = useTheme();
  // ... current message branch JSX ...
});
```

Then in `renderItem`, replace the message branch body with `<MessageRow ... />`.

- [ ] **Step 4: Run tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/components/coach/StreamingBubble.tsx client/components/coach/CoachChat.tsx
git commit -m "perf: extract StreamingBubble to stop renderItem rebuilding on every drain tick"
```

---

## Task 4: Dismiss QuickReply chips after tap

**Files:**

- Modify: `client/components/coach/blocks/QuickReplies.tsx`
- Modify: `client/components/coach/CoachChat.tsx`

- [ ] **Step 1: Add used prop to QuickReplies**

In `client/components/coach/blocks/QuickReplies.tsx`, update the Props interface and add early return:

```typescript
interface Props {
  block: QuickRepliesType;
  onSelect?: (message: string) => void;
  used?: boolean;  // ← add this
}

export default function QuickReplies({ block, onSelect, used }: Props) {
  if (used) return null;  // ← add this early return
  const { theme } = useTheme();
  // ... rest unchanged
```

- [ ] **Step 2: Track used QuickReplies in CoachChat**

In `client/components/coach/CoachChat.tsx`, add a ref near the other refs (around line 80):

```typescript
const usedQuickRepliesRef = useRef<Set<string>>(new Set());
```

- [ ] **Step 3: Update handleQuickReply to mark the key as used**

Find `handleQuickReply` (around line 364):

```typescript
// Before
const handleQuickReply = useCallback(
  (message: string) => {
    handleSend(message);
  },
  [handleSend],
);
```

The `BlockRenderer` calls `onQuickReply` with just the message string. To key the block, `BlockRenderer` needs to pass the `messageId` and block index. Look at how `BlockRenderer` is called in the message row — it receives `key={`${msg.id}-block-${i}`}`. We can form the key as `${messageId}-${blockIndex}`.

Update `handleQuickReply` to receive `(message: string, blockKey: string)`:

```typescript
const handleQuickReply = useCallback(
  (message: string, blockKey?: string) => {
    if (blockKey) {
      usedQuickRepliesRef.current = new Set([
        ...usedQuickRepliesRef.current,
        blockKey,
      ]);
    }
    handleSend(message);
  },
  [handleSend],
);
```

- [ ] **Step 4: Pass the blockKey from BlockRenderer call sites**

In the message row JSX where `BlockRenderer` is rendered:

```typescript
{messageBlocks.get(msg.id)?.map((block, i) => (
  <BlockRenderer
    key={`${msg.id}-block-${i}`}
    block={block}
    onAction={handleBlockAction}
    onQuickReply={(message) => handleQuickReply(message, `${msg.id}-${i}`)}
    onCommitmentAccept={handleCommitmentAccept}
  />
))}
```

- [ ] **Step 5: Pass used prop to QuickReplies via BlockRenderer**

`BlockRenderer` renders `QuickReplies`. It needs to forward a `used` prop. In `client/components/coach/blocks/index.tsx` (or wherever `BlockRenderer` is defined), find the `quick_replies` case and add `used` to the props. `BlockRenderer` will need to accept `blockKey` or `used` as a prop.

Check `client/components/coach/blocks/index.tsx` first to understand the current `BlockRenderer` signature:

```bash
grep -n "BlockRenderer\|QuickReplies\|used" client/components/coach/blocks/index.tsx | head -20
```

Then update `BlockRenderer` to accept an `isUsed?: boolean` prop and forward it to `QuickReplies`. Pass it from the call site in the message row:

```typescript
<BlockRenderer
  ...
  isUsed={usedQuickRepliesRef.current.has(`${msg.id}-${i}`)}
/>
```

Note: `usedQuickRepliesRef.current` is a ref — it does not cause re-renders when mutated. To force re-render after a quick reply, trigger a local state increment (a counter) in `handleQuickReply`:

```typescript
const [quickReplyVersion, setQuickReplyVersion] = useState(0);

const handleQuickReply = useCallback(
  (message: string, blockKey?: string) => {
    if (blockKey) {
      usedQuickRepliesRef.current = new Set([
        ...usedQuickRepliesRef.current,
        blockKey,
      ]);
      setQuickReplyVersion((v) => v + 1); // trigger re-render
    }
    handleSend(message);
  },
  [handleSend],
);
```

Add `quickReplyVersion` to `renderItem`'s dependency array so the message rows re-render after a tap.

- [ ] **Step 6: Run tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add client/components/coach/blocks/QuickReplies.tsx \
        client/components/coach/CoachChat.tsx \
        client/components/coach/blocks/index.tsx
git commit -m "fix: dismiss QuickReply chips after tap using session-scoped ref"
```

---

## Task 5: Fix double scroll-to-bottom at stream end

**Files:**

- Modify: `client/components/coach/CoachChat.tsx:500–503`

- [ ] **Step 1: Remove the redundant scroll useEffect**

In `client/components/coach/CoachChat.tsx`, find the `useEffect` that calls `scrollToEnd` on `messages` change (around line 500):

```typescript
// Remove this:
useEffect(() => {
  listRef.current?.scrollToEnd({ animated: false });
}, [messages]);
```

The `onContentSizeChange` handler on the `FlatList` (line 525–527) already calls `scrollToEnd` whenever content changes — this covers both streaming updates and new committed messages. The `useEffect` fires a second time immediately after, causing the double-scroll.

- [ ] **Step 2: Run tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add client/components/coach/CoachChat.tsx
git commit -m "fix: remove duplicate scroll-to-bottom useEffect, rely on onContentSizeChange"
```
