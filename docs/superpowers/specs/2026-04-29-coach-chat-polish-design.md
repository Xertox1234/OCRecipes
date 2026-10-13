# Coach Chat Feel & Pacing — Design Spec

**Date:** 2026-04-29
**Status:** Approved — ready for implementation planning
**Scope:** Feel/pacing improvements to both `CoachChat` (full-screen) and `CoachOverlayContent` (modal)

---

## Problem

The coach chat feels rushed and flat. Root causes identified:

1. API responses (sometimes <800ms) render immediately with no pacing — text appears before the brain registers a "thinking" beat
2. The typing indicator has no minimum hold — it vanishes the instant the first token arrives
3. Assistant message bubbles are capped at 80% width, making long coaching responses cramped
4. The loading state is generic dots with no information content

---

## Goals

- Make the response feel conversational, not transactional
- Make waiting feel intentional ("the coach is working") not stalled
- Make long coaching responses easier to read
- Apply both surfaces: `CoachChat` and `CoachOverlayContent`

## Non-Goals (deferred)

- Coach cold open / personality greeting
- Camera-in-chat
- Memory & context header pill
- Long-press message actions
- Component consolidation (`CoachChat` + `CoachOverlayContent` shared base — see `todos/coach-chat-shared-base-component.md`)

---

## Architecture

Four independent changes, implemented in this dependency order:

| #   | Change                       | Files                                                                       |
| --- | ---------------------------- | --------------------------------------------------------------------------- |
| 1   | Shared `useCoachStream` hook | New: `client/hooks/useCoachStream.ts`                                       |
| 2   | Server status events         | `server/services/coach-pro-chat.ts`, `nutrition-coach.ts`, `routes/chat.ts` |
| 3   | Bubble layout                | `client/components/ChatBubble.tsx`                                          |
| 4   | Component wiring             | `client/components/coach/CoachChat.tsx`, `CoachOverlayContent.tsx`          |

Steps 1 and 2 can be implemented in parallel. Step 3 is independent of both. Step 4 requires step 1.

---

## 1. `useCoachStream` Hook

### Interface

```typescript
useCoachStream(options: {
  conversationId: number
  getToken: () => string | null
  onDone?: (fullText: string, blocks?: CoachBlock[]) => void
  onError?: (msg: string) => void
}): {
  startStream: (userMessage: string, extras?: {
    warmUpId?: string
    screenContext?: string
  }) => void
  abortStream: () => void
  streamingContent: string   // throttled — what is rendered on screen
  statusText: string         // "Thinking…" / "Checking your pantry…" / ""
  isStreaming: boolean
}
```

### Internal Mechanisms

#### Hold gate (700ms minimum)

- A `startedAt` ref is set when `startStream` is called and the XHR begins
- The drain tick (see Throttle below) checks `Date.now() - startedAt >= 700` before releasing any chars to `streamingContent`
- If the full response arrives in 400ms, the buffer waits the remaining 300ms before anything renders
- This applies to both surfaces and both Pro/non-Pro

#### Char-rate throttle

- Incoming XHR chunks append to a plain `bufferRef: string` (not state — avoids re-renders on every token)
- A `setInterval` at **50ms** drains `Math.ceil(35 * 50 / 1000)` = **2 chars per tick** → ~40 chars/sec on screen
- The interval starts when `startStream` is called, clears when buffer is empty and `isDone` is true
- Only the drain tick updates `streamingContent` state and triggers a render

#### Status text state machine

| Trigger                          | `statusText` value                             |
| -------------------------------- | ---------------------------------------------- |
| `startStream` called             | `"Thinking…"`                                  |
| `data.status` SSE event received | `event.label` (e.g. `"Checking your pantry…"`) |
| First char drained from buffer   | `""` (status clears as text appears)           |
| Error                            | `""`                                           |
| Stream done                      | `""`                                           |

#### XHR extraction

The hook contains the XMLHttpRequest SSE loop currently duplicated across `CoachChat.tsx` (lines 85–149) and `CoachOverlayContent.tsx` (lines 49–123). The XHR pattern is preserved (not replaced with Fetch/ReadableStream) because RN ReadableStream has reliability issues inside modals — see existing comments.

The hook handles:

- `data.content` → append to `bufferRef`
- `data.blocks` → pass through to `onDone` callback
- `data.status` → update `statusText` state
- `data.done` → set `isDone`, call `onDone`
- `data.error` → call `onError`, clear status
- Abort via `AbortController` on `abortStream()` or unmount

---

## 2. Server Status Events

### New SSE event type

```typescript
{
  status: string;
} // e.g. { "status": "Checking your pantry…" }
```

### Non-Pro path (`generateCoachResponse`)

No server changes needed. Client sets `"Thinking…"` on `startStream` and holds it until first chars drain.

### Coach Pro path (`generateCoachProResponse` → `handleCoachChat`)

Yield a `{ type: "status", label }` event immediately before each tool invocation:

```typescript
yield { type: "status", label: toolStatusLabel(toolName) }
// then invoke the tool
```

**Label map** (lives in `server/services/coach-pro-chat.ts`):

```typescript
const TOOL_STATUS_LABELS: Record<string, string> = {
  search_recipes: "Searching recipes…",
  log_food: "Logging food…",
  get_pantry: "Checking your pantry…",
  get_nutrition: "Looking up nutrition…",
  create_meal_plan: "Planning your meals…",
  get_daily_log: "Checking today's log…",
};
// Unknown tools fall back to: "Working on it…"
```

### Route wiring (`server/routes/chat.ts`)

Add one branch to the existing for-await loop:

```typescript
if (event.type === "status") {
  res.write(`data: ${JSON.stringify({ status: event.label })}\n\n`);
}
```

---

## 3. Bubble Layout Changes (`ChatBubble.tsx`)

### Assistant messages — new structure

```
<Row alignItems="flex-start" gap={9}>
  <AvatarDot />            // 22×22px gradient circle, theme.primary colours
  <ContentArea flex={1}>
    <MarkdownText lineHeight={1.65} />
    [TTS button, right-aligned, if onSpeak provided]
  </ContentArea>
</Row>
```

**Remove from assistant bubble:** `maxWidth: "80%"`, `backgroundColor`, `borderWidth`, `borderColor`, `borderRadius`, `padding`

**Add:** 22px avatar dot (gradient: `theme.primary` → slightly lighter variant), `gap: 9`, `alignItems: "flex-start"`, `flex: 1` on content area, `lineHeight: 1.65` on text

**User messages:** unchanged — right-aligned purple bubble, `maxWidth: 75%`

**TTS button:** moves from inside the bubble to below the text content, right-aligned within the `flex: 1` content area

**Entrance animation:** `SlideInLeft` (already in place) is preserved — applies to the whole row

### Avatar dot colour

Use `theme.primary` with a subtle gradient (`theme.primary` → `withOpacity(theme.primary, 0.7)`). Exact values to be confirmed against the theme during implementation.

### Rich block alignment

All block components (`RecipeCard`, `MealPlanCard`, `ActionCard`, `SuggestionList`, `QuickReplies`, `InlineChart`, `CommitmentCard`) render **full-width** — no avatar-column indentation.

Current behaviour: blocks are already siblings of `ChatBubble` in the message container, not children of it, and already stretch to the full container width. The canvas layout change does not affect this — blocks continue to render at full container width with no code changes required to the block components themselves.

The avatar dot appears **only on text rows** (the `<Row>` wrapping `<AvatarDot>` + `<MarkdownText>`). For messages that contain text followed by blocks, the structure is:

```
<MessageContainer>
  <Row gap={9} alignItems="flex-start">   ← avatar dot here
    <AvatarDot />
    <MarkdownText flex={1} />
  </Row>
  <BlockRenderer />                        ← full width, no indent
  <BlockRenderer />
</MessageContainer>
```

For block-only messages (no text intro), no avatar dot is rendered — the card sits at full width with no orphaned dot above it.

---

## 4. Component Wiring

### `CoachChat.tsx`

- Remove the inline XHR SSE loop (lines 74–150) — replaced by `useCoachStream`
- Remove `streamingContent` and related state — provided by hook
- Add `statusText` render: in the loading state area (currently lines 544–569), render `statusText` as italic accent-coloured text next to the avatar dot when `isStreaming && !streamingContent`
- Wire `onDone` callback to existing message persistence / block handling logic

### `CoachOverlayContent.tsx`

- Remove the inline XHR SSE loop (lines 49–123) — replaced by `useCoachStream`
- Add `statusText` render in the same position as `CoachChat` loading state
- Hook `onDone` into existing message append logic

---

## Testing

### New test file: `client/hooks/__tests__/useCoachStream.test.ts`

Extract throttle and hold gate into a pure helper function alongside the hook — test it in isolation:

| Test                 | Assertion                                                                  |
| -------------------- | -------------------------------------------------------------------------- |
| Hold gate            | No chars in `streamingContent` before 700ms even if buffer fills instantly |
| Throttle rate        | Buffer drains at ~40 chars/sec across 5 drain ticks                        |
| Status: start        | `statusText === "Thinking…"` immediately on `startStream`                  |
| Status: tool event   | `statusText === "Checking your pantry…"` after `data.status` event         |
| Status: first char   | `statusText === ""` after first char drains                                |
| Status: unknown tool | Falls back to `"Working on it…"`                                           |
| Abort                | XHR aborted and `isStreaming` false after `abortStream()`                  |

### Server: `server/services/__tests__/coach-pro-chat.test.ts`

Assert that `status` events are yielded for each known tool name before the tool result event.

---

## Files Changed Summary

| File                                            | Change type                                         |
| ----------------------------------------------- | --------------------------------------------------- |
| `client/hooks/useCoachStream.ts`                | **New**                                             |
| `client/components/ChatBubble.tsx`              | Modified — assistant bubble layout                  |
| `client/components/coach/CoachChat.tsx`         | Modified — consume hook, render statusText          |
| `client/components/CoachOverlayContent.tsx`     | Modified — consume hook, render statusText          |
| `server/routes/chat.ts`                         | Modified — add status event branch                  |
| `server/services/coach-pro-chat.ts`             | Modified — yield status events, label map           |
| `server/services/nutrition-coach.ts`            | Modified — pass status event type through generator |
| `client/hooks/__tests__/useCoachStream.test.ts` | **New**                                             |
