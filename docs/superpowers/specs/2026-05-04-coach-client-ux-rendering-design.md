---
title: Coach — Client-Side UX & Rendering
date: 2026-05-04
status: approved
plan: 2 of 5 (Coach deep-dive review)
---

## Overview

This plan fixes client-side issues with the AI Coach: the drain speed is far too slow (40 chars/sec), the 429 error screen for premium users shows raw JSON instead of an upgrade prompt, `renderItem` rebuilds on every drain tick causing jank, QuickReply chips persist after being tapped, and there is a double scroll-to-bottom at stream end.

## Scope

Files: `client/hooks/useCoachStream.ts`, `client/components/coach/CoachChat.tsx`, `client/components/coach/blocks/QuickReplies.tsx`

## Issue Inventory

### 1. Drain speed far too slow (HIGH)

**Location:** `client/hooks/useCoachStream.ts:13`

**Problem:** `CHARS_PER_TICK = 2` with `DRAIN_INTERVAL_MS = 50` yields 40 chars/sec. A typical 400-char response takes 10 seconds to animate after the server already delivered it. ChatGPT-equivalent is 300–500 chars/sec.

**Fix:** Increase `CHARS_PER_TICK` to a value that yields 300–500 chars/sec. At `DRAIN_INTERVAL_MS = 50ms` (20 ticks/sec), each tick should release ~15–25 chars: set `CHARS_PER_TICK = 20` (400 chars/sec). The `HOLD_GATE_MS = 700` buffer period remains unchanged — this gives the server time to deliver the full response before the drain begins, which is especially important for the standard (non-streaming) path.

`CHARS_PER_TICK` is exported and tested; update the export value and update any unit tests that assert against the old value.

### 2. 429 handling in CoachChat shows raw JSON (HIGH)

**Location:** `client/components/coach/CoachChat.tsx:124–127`

**Problem:** When a Coach Pro user hits their daily message limit (HTTP 429), `useCoachStream`'s `onError` callback receives the raw server response string (`"429: {"error":"…"}"`) and sets it as `streamingError`. `CoachChat` renders this string directly via `InlineError`, with no actionable path. The free-tier `ChatScreen` handles 429 correctly with an upgrade prompt.

**Fix:** In `useCoachStream`'s `onError` handler in `CoachChat`, detect 429 by inspecting the error string for a leading `"429"`. When detected:

- Do not display the raw JSON as an error
- Instead, show an inline upgrade prompt matching the free-tier pattern: a message like "You've reached today's coaching limit" with a "Upgrade" CTA button that navigates to the subscription screen.

The detection should be a simple `message.startsWith("429")` check in the `onError` callback, keeping the existing `InlineError` for all other error codes.

### 3. renderItem rebuilds every drain tick (MEDIUM)

**Location:** `client/components/coach/CoachChat.tsx:371–464`

**Problem:** `renderItem` has `streamingContent` in its dependency array. Since `streamingContent` changes every drain tick (20×/sec), `renderItem` is recreated 20 times per second. Every historical message in the `FlatList` gets a new render function reference, causing unnecessary re-renders during streaming.

**Fix:** Split the stream item out of `renderItem` into a separate memoized component (`StreamingBubble`) that accepts `streamingContent`, `statusText`, and `isStreaming` as props. The main `renderItem` only handles `"message"` and `"optimistic"` types and no longer depends on `streamingContent`. This means historical messages are not re-rendered during the drain.

The `FlatList` renders the stream item as the last entry in `chatItems` (already done via `{ type: "stream" }`); `renderItem` for `type === "stream"` renders the new `<StreamingBubble>` component.

Wrap individual message row components with `React.memo` to prevent re-renders when unrelated props change.

### 4. QuickReplies chips not dismissed after tap (MEDIUM)

**Location:** `client/components/coach/blocks/QuickReplies.tsx:12–42`

**Problem:** After a user taps a QuickReply chip, the chip remains visible under the message across all subsequent messages. The block is re-rendered from persisted `messageBlocks` on every refresh, so the "used" state is lost.

**Fix:** Track which QuickReplies blocks have been used via a `Set` stored in a `useRef` in `CoachChat`. Key each block by `messageId + blockIndex`. When `handleQuickReply` fires, add the key to the set. Pass a `used` prop to `QuickReplies`; when `used === true`, render nothing (return `null`). The ref persists across renders within the session but resets on navigation, which is appropriate — tapped chips should disappear for the session.

### 5. Double scroll-to-bottom at stream end (LOW)

**Location:** `client/components/coach/CoachChat.tsx:500–503, 525–527`

**Problem:** Two triggers fire simultaneously at stream end: a `useEffect` watching `messages` and an `onContentSizeChange` handler. Both call `scrollToEnd`, causing a brief visible double-scroll.

**Fix:** Deduplicate by removing one of the two triggers. The `onContentSizeChange` handler is the correct mechanism for scrolling as content appears; remove the `useEffect`-on-messages scroll call. If keeping `useEffect`, gate it with a `isStreaming` flag so it only fires when a new non-streaming message arrives (i.e., after the stream commit, not during).

## Testing

- Update `useCoachStream` unit tests that assert `CHARS_PER_TICK === 2` to assert `CHARS_PER_TICK === 20`.
- Manual test: send a message, verify text appears at a comfortable reading pace (~300 chars/sec).
- Manual test (429): simulate a 429 response (or mock in test) and verify upgrade prompt appears, not raw JSON.
- Existing tests must pass: `npm run test:run`.

## Files Changed (expected)

- `client/hooks/useCoachStream.ts`
- `client/components/coach/CoachChat.tsx`
- `client/components/coach/blocks/QuickReplies.tsx`
- New component: `client/components/coach/StreamingBubble.tsx` (or inline in CoachChat)
- Corresponding `__tests__` files
