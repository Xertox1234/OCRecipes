# Coach Chat Feel & Pacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rushed, flat coach chat feel with paced streaming (40 chars/sec, 700ms hold gate), canvas-style assistant messages, and live status text tied to tool calls.

**Architecture:** A shared `useCoachStream` hook extracts the XHR SSE loop and owns all timing logic (hold gate + throttle + status state machine). Both `CoachChat.tsx` and `CoachOverlayContent.tsx` consume the hook, shedding their inline streaming code. `ChatBubble.tsx` gets a canvas layout for assistant messages (avatar dot + full-width text). The server gains a `{ type: "status" }` SSE event yielded before each Coach Pro tool call.

**Tech Stack:** React Native / Expo, React hooks, Reanimated 4, XMLHttpRequest SSE (preserved — RN ReadableStream is unreliable in modals), Vitest + `@testing-library/react`, Express SSE, OpenAI tool calling.

---

## File Map

| File                                                         | Action                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------- |
| `client/components/coach/coach-chat-utils.ts`                | Add `stripCoachBlocksFence` + `filterValidBlocks`                    |
| `client/components/coach/__tests__/coach-chat-utils.test.ts` | Add tests for new helpers                                            |
| `client/hooks/useCoachStream.ts`                             | **New** — hook + exported pure helpers                               |
| `client/hooks/__tests__/useCoachStream.test.ts`              | **New** — unit tests                                                 |
| `server/services/nutrition-coach.ts`                         | Add `onBeforeToolCalls` param to `generateCoachProResponse`          |
| `server/services/coach-pro-chat.ts`                          | Add `status` variant to `CoachChatEvent`, label map, queue-and-drain |
| `server/services/__tests__/coach-pro-chat.test.ts`           | Add status event assertion                                           |
| `client/components/ChatBubble.tsx`                           | Canvas layout for assistant messages                                 |
| `client/components/coach/CoachChat.tsx`                      | Replace inline streaming with hook, render statusText                |
| `client/components/CoachOverlayContent.tsx`                  | Replace inline streaming with hook, render statusText                |

---

## Task 1: Add `stripCoachBlocksFence` and `filterValidBlocks` to `coach-chat-utils.ts`

**Files:**

- Modify: `client/components/coach/coach-chat-utils.ts`
- Modify: `client/components/coach/__tests__/coach-chat-utils.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `client/components/coach/__tests__/coach-chat-utils.test.ts`:

```typescript
import {
  parsePlanDays,
  planBannerA11yLabel,
  stripCoachBlocksFence,
  filterValidBlocks,
} from "../coach-chat-utils";
// (update existing import line above)
```

And add these describe blocks:

````typescript
describe("stripCoachBlocksFence", () => {
  it("returns trimmed text when no fence present", () => {
    expect(stripCoachBlocksFence("  hello world  ")).toBe("hello world");
  });

  it("strips fence when only fence present (no preceding text)", () => {
    const input = '```coach_blocks\n{"type":"action_card"}\n```';
    expect(stripCoachBlocksFence(input)).toBe("");
  });

  it("preserves text before the fence and strips fence block", () => {
    const input =
      'Here is your plan.\n```coach_blocks\n{"type":"action_card"}\n```';
    expect(stripCoachBlocksFence(input)).toBe("Here is your plan.");
  });

  it("strips up to end of string when closing fence not yet arrived", () => {
    const input = 'Some text.\n```coach_blocks\n{"type":"action';
    expect(stripCoachBlocksFence(input)).toBe("Some text.");
  });

  it("handles text after closing fence", () => {
    const input = "Before.\n```coach_blocks\n{}\n```\nAfter.";
    expect(stripCoachBlocksFence(input)).toBe("Before.\nAfter.");
  });
});

describe("filterValidBlocks", () => {
  it("returns only items matching coachBlockSchema", () => {
    const valid = {
      type: "action_card",
      title: "Log Lunch",
      actionLabel: "Log it",
      action: { type: "log_food", description: "Chicken salad" },
    };
    const invalid = { type: "unknown_block", garbage: true };
    const result = filterValidBlocks([valid, invalid, null, 42]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "action_card" });
  });

  it("returns empty array when nothing passes validation", () => {
    expect(filterValidBlocks([null, undefined, {}, { type: "bad" }])).toEqual(
      [],
    );
  });
});
````

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test:run -- client/components/coach/__tests__/coach-chat-utils.test.ts
```

Expected: FAIL — `stripCoachBlocksFence` and `filterValidBlocks` not exported.

- [ ] **Step 3: Add the helpers to `coach-chat-utils.ts`**

Add imports at the top of `client/components/coach/coach-chat-utils.ts`:

```typescript
import {
  coachBlockSchema,
  type CoachBlock,
} from "@shared/schemas/coach-blocks";
```

Add these functions at the bottom of the file:

````typescript
/**
 * Strips the ```coach_blocks ... ``` fence from an accumulated streaming string.
 * Called repeatedly as chunks arrive — handles the case where the closing fence
 * has not yet arrived (strips from the open fence to end of string).
 */
export function stripCoachBlocksFence(accumulated: string): string {
  const openIdx = accumulated.indexOf("```coach_blocks\n");
  if (openIdx === -1) return accumulated.trim();
  const closeIdx = accumulated.indexOf("```", openIdx + 16);
  if (closeIdx === -1) return accumulated.slice(0, openIdx).trim();
  return (
    accumulated.slice(0, openIdx) + accumulated.slice(closeIdx + 3)
  ).trim();
}

/**
 * Filters an array of unknown values against coachBlockSchema, returning only
 * items that pass Zod validation. Safe to call with any server payload.
 */
export function filterValidBlocks(raw: unknown[]): CoachBlock[] {
  const valid: CoachBlock[] = [];
  for (const b of raw) {
    const result = coachBlockSchema.safeParse(b);
    if (result.success) valid.push(result.data);
  }
  return valid;
}
````

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test:run -- client/components/coach/__tests__/coach-chat-utils.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/components/coach/coach-chat-utils.ts client/components/coach/__tests__/coach-chat-utils.test.ts
git commit -m "$(cat <<'EOF'
refactor: extract stripCoachBlocksFence and filterValidBlocks to coach-chat-utils

These will be shared by the useCoachStream hook in the next task.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create `useCoachStream` hook

**Files:**

- Create: `client/hooks/useCoachStream.ts`

The hook owns: XHR SSE loop, 700ms hold gate, 40 chars/sec throttle, status text state machine.

- [ ] **Step 1: Create the hook file**

Create `client/hooks/useCoachStream.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import {
  stripCoachBlocksFence,
  filterValidBlocks,
} from "@/components/coach/coach-chat-utils";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

// Exported so tests can import and verify against them
export const HOLD_GATE_MS = 700;
export const DRAIN_INTERVAL_MS = 50;
export const CHARS_PER_TICK = 2;

/**
 * Pure helper — returns the slice of buffer to release this drain tick.
 * Returns "" when the hold gate has not elapsed yet.
 */
export function charsToRelease(
  buffer: string,
  elapsedMs: number,
  holdGateMs: number,
  charsPerTick: number,
): string {
  if (elapsedMs < holdGateMs) return "";
  return buffer.slice(0, charsPerTick);
}

interface UseCoachStreamOptions {
  onDone?: (fullText: string, blocks?: CoachBlock[]) => void;
  onError?: (msg: string) => void;
}

interface UseCoachStreamReturn {
  startStream: (
    conversationId: number,
    userMessage: string,
    extras?: { warmUpId?: string | null; screenContext?: string },
  ) => void;
  abortStream: () => void;
  streamingContent: string;
  statusText: string;
  isStreaming: boolean;
}

export function useCoachStream({
  onDone,
  onError,
}: UseCoachStreamOptions): UseCoachStreamReturn {
  const [streamingContent, setStreamingContent] = useState("");
  const [statusText, setStatusText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  // Callback refs — keep latest values without triggering re-renders
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Mutable refs — no re-renders needed for these internal values
  const bufferRef = useRef(""); // chars waiting to be drained to screen
  const isDoneRef = useRef(false); // true when server sent data.done
  const startedAtRef = useRef(0); // Date.now() when startStream was called
  const accumulatedRef = useRef(""); // full raw text from server (may contain fence)
  const displayedLengthRef = useRef(0); // chars of stripped text already pushed to buffer
  const firstCharDrainedRef = useRef(false); // cleared status on first drain?
  const fullTextRef = useRef(""); // fence-stripped text to pass to onDone
  const blocksRef = useRef<CoachBlock[]>([]);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const drainIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopDrain = useCallback(() => {
    if (drainIntervalRef.current !== null) {
      clearInterval(drainIntervalRef.current);
      drainIntervalRef.current = null;
    }
  }, []);

  const startDrain = useCallback(() => {
    if (drainIntervalRef.current !== null) return; // already running
    drainIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      const chunk = charsToRelease(
        bufferRef.current,
        elapsed,
        HOLD_GATE_MS,
        CHARS_PER_TICK,
      );

      if (chunk.length === 0) {
        // Nothing to drain this tick
        if (isDoneRef.current && bufferRef.current.length === 0) {
          // Buffer exhausted and server is done — finish
          stopDrain();
          setIsStreaming(false);
          setStatusText("");
          onDoneRef.current?.(
            fullTextRef.current,
            blocksRef.current.length > 0 ? blocksRef.current : undefined,
          );
        }
        return;
      }

      bufferRef.current = bufferRef.current.slice(chunk.length);

      if (!firstCharDrainedRef.current) {
        firstCharDrainedRef.current = true;
        setStatusText(""); // clear status as text starts appearing
      }
      setStreamingContent((prev) => prev + chunk);
    }, DRAIN_INTERVAL_MS);
  }, [stopDrain]);

  const abortStream = useCallback(() => {
    xhrRef.current?.abort();
    xhrRef.current = null;
    stopDrain();
    bufferRef.current = "";
    isDoneRef.current = false;
    accumulatedRef.current = "";
    displayedLengthRef.current = 0;
    firstCharDrainedRef.current = false;
    setIsStreaming(false);
    setStatusText("");
    setStreamingContent("");
  }, [stopDrain]);

  // Abort XHR and drain interval on unmount
  useEffect(() => {
    return () => {
      xhrRef.current?.abort();
      stopDrain();
    };
  }, [stopDrain]);

  const startStream = useCallback(
    (
      conversationId: number,
      userMessage: string,
      extras?: { warmUpId?: string | null; screenContext?: string },
    ) => {
      // Reset all state for a fresh stream
      bufferRef.current = "";
      isDoneRef.current = false;
      accumulatedRef.current = "";
      displayedLengthRef.current = 0;
      firstCharDrainedRef.current = false;
      fullTextRef.current = "";
      blocksRef.current = [];
      startedAtRef.current = Date.now();

      setStreamingContent("");
      setStatusText("Thinking…");
      setIsStreaming(true);

      tokenStorage.get().then((token) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        const url = `${getApiUrl()}/api/chat/conversations/${conversationId}/messages`;
        xhr.open("POST", url, true);
        xhr.setRequestHeader("Content-Type", "application/json");
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

        let lastProcessedIndex = 0;

        xhr.onreadystatechange = () => {
          if (xhr.readyState >= 3 && xhr.responseText) {
            const newText = xhr.responseText.slice(lastProcessedIndex);
            lastProcessedIndex = xhr.responseText.length;

            for (const line of newText.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              try {
                const data = JSON.parse(line.slice(6)) as Record<
                  string,
                  unknown
                >;
                if (data.error) {
                  stopDrain();
                  setIsStreaming(false);
                  setStatusText("");
                  onErrorRef.current?.(String(data.error));
                  return;
                }
                if (typeof data.status === "string") {
                  setStatusText(data.status);
                }
                if (typeof data.content === "string") {
                  accumulatedRef.current += data.content;
                  const stripped = stripCoachBlocksFence(
                    accumulatedRef.current,
                  );
                  const newChars = stripped.slice(displayedLengthRef.current);
                  displayedLengthRef.current = stripped.length;
                  bufferRef.current += newChars;
                }
                if (data.blocks && Array.isArray(data.blocks)) {
                  blocksRef.current = filterValidBlocks(data.blocks);
                }
                if (data.done) {
                  isDoneRef.current = true;
                  fullTextRef.current = stripCoachBlocksFence(
                    accumulatedRef.current,
                  );
                }
              } catch {
                // Ignore incomplete JSON chunks
              }
            }
          }

          if (xhr.readyState === 4 && xhr.status >= 400) {
            stopDrain();
            setIsStreaming(false);
            setStatusText("");
            onErrorRef.current?.(`${xhr.status}: ${xhr.responseText}`);
          }
        };

        xhr.onerror = () => {
          stopDrain();
          setIsStreaming(false);
          setStatusText("");
          onErrorRef.current?.("Network error");
        };

        startDrain();

        const body: Record<string, unknown> = { content: userMessage };
        if (extras?.warmUpId) body.warmUpId = extras.warmUpId;
        if (extras?.screenContext) body.screenContext = extras.screenContext;
        xhr.send(JSON.stringify(body));
      });
    },
    [startDrain, stopDrain],
  );

  return {
    startStream,
    abortStream,
    streamingContent,
    statusText,
    isStreaming,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run check:types 2>&1 | grep useCoachStream
```

Expected: no errors mentioning `useCoachStream`.

- [ ] **Step 3: Commit**

```bash
git add client/hooks/useCoachStream.ts
git commit -m "$(cat <<'EOF'
feat: add useCoachStream hook with hold gate, throttle, and status text

700ms hold gate prevents rushed responses. 40 chars/sec throttle makes
streaming feel conversational. Status text state machine shows "Thinking…"
and tool-specific labels from server data.status events.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Write `useCoachStream` tests

**Files:**

- Create: `client/hooks/__tests__/useCoachStream.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  charsToRelease,
  HOLD_GATE_MS,
  CHARS_PER_TICK,
  DRAIN_INTERVAL_MS,
} from "../useCoachStream";

// ── Pure helper tests (no timers, no XHR) ────────────────────────

describe("charsToRelease", () => {
  it("returns empty string when elapsed < holdGateMs", () => {
    expect(charsToRelease("hello world", 300, 700, 2)).toBe("");
    expect(charsToRelease("hello world", 699, 700, 2)).toBe("");
  });

  it("returns up to charsPerTick when elapsed >= holdGateMs", () => {
    expect(charsToRelease("hello world", 700, 700, 2)).toBe("he");
    expect(charsToRelease("hello world", 1500, 700, 2)).toBe("he");
  });

  it("returns entire buffer when buffer shorter than charsPerTick", () => {
    expect(charsToRelease("x", 700, 700, 2)).toBe("x");
  });

  it("returns empty string for empty buffer regardless of elapsed", () => {
    expect(charsToRelease("", 5000, 700, 2)).toBe("");
  });
});

// ── Hook behaviour tests (fake timers + XHR mock) ─────────────────

const { mockTokenStorage, mockGetApiUrl } = vi.hoisted(() => ({
  mockTokenStorage: { get: vi.fn().mockResolvedValue("test-token") },
  mockGetApiUrl: vi.fn(() => "http://localhost:3000"),
}));

vi.mock("@/lib/token-storage", () => ({ tokenStorage: mockTokenStorage }));
vi.mock("@/lib/query-client", () => ({ getApiUrl: mockGetApiUrl }));
vi.mock("@/components/coach/coach-chat-utils", () => ({
  stripCoachBlocksFence: (s: string) => s.trim(), // identity for tests
  filterValidBlocks: (arr: unknown[]) => arr,
}));

class MockXHR {
  readyState = 0;
  responseText = "";
  status = 200;
  onreadystatechange: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sentBody: string | null = null;
  aborted = false;
  headers: Record<string, string> = {};

  open = vi.fn();
  setRequestHeader = vi.fn((k: string, v: string) => (this.headers[k] = v));
  send = vi.fn((body: string) => {
    this.sentBody = body;
    this.readyState = 1;
  });
  abort = vi.fn(() => {
    this.aborted = true;
  });

  /** Simulate an SSE event arriving from the server. */
  emit(payload: object) {
    this.responseText += `data: ${JSON.stringify(payload)}\n\n`;
    this.readyState = 3;
    this.onreadystatechange?.();
  }

  /** Simulate the connection completing successfully. */
  complete() {
    this.readyState = 4;
    this.status = 200;
    this.onreadystatechange?.();
  }
}

let mockXhr: MockXHR;
beforeEach(() => {
  vi.useFakeTimers();
  mockXhr = new MockXHR();
  vi.stubGlobal(
    "XMLHttpRequest",
    vi.fn(() => mockXhr),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function hookWithStream() {
  const onDone = vi.fn();
  const onError = vi.fn();
  const { result } = renderHook(() => {
    const { useCoachStream } = require("../useCoachStream");
    return useCoachStream({ onDone, onError });
  });
  return { result, onDone, onError };
}

describe("useCoachStream hold gate", () => {
  it("does not render content before 700ms even if buffer fills instantly", async () => {
    const { result } = await hookWithStream();

    act(() => {
      result.current.startStream(1, "test");
    });

    // Server sends content immediately
    act(() => {
      mockXhr.emit({ content: "Hello world" });
    });

    // Advance 600ms — hold gate not elapsed
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.streamingContent).toBe("");

    // Advance past the gate
    act(() => {
      vi.advanceTimersByTime(200);
    }); // total 800ms
    expect(result.current.streamingContent.length).toBeGreaterThan(0);
  });
});

describe("useCoachStream throttle rate", () => {
  it("drains approximately CHARS_PER_TICK chars per DRAIN_INTERVAL_MS tick", async () => {
    const { result } = await hookWithStream();

    act(() => {
      result.current.startStream(1, "test");
    });
    act(() => {
      mockXhr.emit({ content: "A".repeat(100) });
    });

    // Advance past hold gate
    act(() => {
      vi.advanceTimersByTime(HOLD_GATE_MS);
    });
    // Now advance 5 drain ticks
    act(() => {
      vi.advanceTimersByTime(DRAIN_INTERVAL_MS * 5);
    });

    // Should have drained roughly 5 * CHARS_PER_TICK chars
    const expected = 5 * CHARS_PER_TICK;
    expect(result.current.streamingContent.length).toBe(expected);
  });
});

describe("useCoachStream status text", () => {
  it("shows 'Thinking…' immediately on startStream", async () => {
    const { result } = await hookWithStream();
    act(() => {
      result.current.startStream(1, "test");
    });
    expect(result.current.statusText).toBe("Thinking…");
  });

  it("updates statusText when data.status event arrives", async () => {
    const { result } = await hookWithStream();
    act(() => {
      result.current.startStream(1, "test");
    });
    act(() => {
      mockXhr.emit({ status: "Checking your pantry…" });
    });
    expect(result.current.statusText).toBe("Checking your pantry…");
  });

  it("clears statusText when first char drains", async () => {
    const { result } = await hookWithStream();
    act(() => {
      result.current.startStream(1, "test");
    });
    act(() => {
      mockXhr.emit({ content: "Hello" });
    });

    expect(result.current.statusText).toBe("Thinking…");

    act(() => {
      vi.advanceTimersByTime(HOLD_GATE_MS + DRAIN_INTERVAL_MS);
    });
    expect(result.current.statusText).toBe("");
  });
});

describe("useCoachStream abort", () => {
  it("sets isStreaming false and clears content after abortStream", async () => {
    const { result } = await hookWithStream();
    act(() => {
      result.current.startStream(1, "test");
    });
    expect(result.current.isStreaming).toBe(true);

    act(() => {
      result.current.abortStream();
    });
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingContent).toBe("");
    expect(result.current.statusText).toBe("");
    expect(mockXhr.abort).toHaveBeenCalled();
  });
});

describe("useCoachStream onDone", () => {
  it("calls onDone with full text after buffer drains", async () => {
    const { result, onDone } = await hookWithStream();
    act(() => {
      result.current.startStream(1, "test");
    });

    act(() => {
      mockXhr.emit({ content: "Hi" });
      mockXhr.emit({ done: true });
      mockXhr.complete();
    });

    // Advance past hold gate and drain all 2 chars
    act(() => {
      vi.advanceTimersByTime(HOLD_GATE_MS + DRAIN_INTERVAL_MS * 5);
    });

    expect(onDone).toHaveBeenCalledWith("Hi", undefined);
    expect(result.current.isStreaming).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm run test:run -- client/hooks/__tests__/useCoachStream.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add client/hooks/__tests__/useCoachStream.test.ts
git commit -m "$(cat <<'EOF'
test: add useCoachStream tests for hold gate, throttle, status, and abort

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add `onBeforeToolCalls` callback to `generateCoachProResponse`

**Files:**

- Modify: `server/services/nutrition-coach.ts`

This callback fires synchronously just before the parallel tool execution, giving `handleCoachChat` a hook to yield status events.

- [ ] **Step 1: Update the function signature**

In `server/services/nutrition-coach.ts`, find the `generateCoachProResponse` signature (line ~261) and add the optional parameter:

```typescript
export async function* generateCoachProResponse(
  messages: { role: "user" | "assistant" | "system"; content: string }[],
  context: CoachContext,
  userId: string,
  abortSignal?: AbortSignal,
  onBeforeToolCalls?: (toolNames: string[]) => void,
): AsyncGenerator<string> {
```

- [ ] **Step 2: Call the callback before tool execution**

In `nutrition-coach.ts`, find the comment `// Execute tool calls in parallel` (line ~408) and add the callback call immediately before `const toolResults = await Promise.all(...)`:

```typescript
    // Execute tool calls in parallel — preserve order when appending results
    onBeforeToolCalls?.(toolCallsArray.map((tc) => tc.function.name));
    const toolResults = await Promise.all(
      toolCallsArray.map(async (tc) => {
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run check:types 2>&1 | grep -E "nutrition-coach|coach-pro-chat" | head -10
```

Expected: no new errors.

- [ ] **Step 4: Run existing coach tests**

```bash
npm run test:run -- server/services/__tests__/coach-pro-chat.test.ts
```

Expected: all existing tests pass (new param is optional, existing mocks unaffected).

- [ ] **Step 5: Commit**

```bash
git add server/services/nutrition-coach.ts
git commit -m "$(cat <<'EOF'
feat: add onBeforeToolCalls callback to generateCoachProResponse

Fires with tool names just before parallel execution, enabling callers
to emit status events without changing the AsyncGenerator<string> return type.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add status events to `CoachChatEvent` and wire `handleCoachChat`

**Files:**

- Modify: `server/services/coach-pro-chat.ts`
- Modify: `server/services/__tests__/coach-pro-chat.test.ts`

- [ ] **Step 1: Add status variant and label map to `coach-pro-chat.ts`**

Find the `CoachChatEvent` type (line 129) and add the new variant:

```typescript
export type CoachChatEvent =
  | { type: "content"; content: string }
  | { type: "blocks"; blocks: CoachBlock[] }
  | { type: "status"; label: string };
```

Add the label map and helper function immediately after the type (around line 132):

```typescript
const TOOL_STATUS_LABELS: Record<string, string> = {
  lookup_nutrition: "Looking up nutrition…",
  search_recipes: "Searching recipes…",
  get_daily_log_details: "Checking today’s log…",
  log_food_item: "Logging food…",
  get_pantry_items: "Checking your pantry…",
  get_meal_plan: "Checking your meal plan…",
  add_to_meal_plan: "Planning your meals…",
  add_to_grocery_list: "Updating grocery list…",
  get_substitutions: "Finding substitutes…",
};

function getToolStatusLabel(toolName: string): string {
  return TOOL_STATUS_LABELS[toolName] ?? "Working on it…";
}
```

- [ ] **Step 2: Wire the callback in `handleCoachChat`**

In `handleCoachChat`, find the Coach Pro streaming block (around line 497):

```typescript
  } else if (isCoachPro) {
    for await (const chunk of generateCoachProResponse(
      messageHistory,
      context,
      userId,
      abortSignal,
    )) {
      if (isAborted()) break;
      fullResponse += chunk;
      yield { type: "content", content: chunk };
    }
```

Replace it with:

```typescript
  } else if (isCoachPro) {
    const pendingStatusLabels: string[] = [];
    for await (const chunk of generateCoachProResponse(
      messageHistory,
      context,
      userId,
      abortSignal,
      (toolNames) => {
        for (const name of toolNames) {
          pendingStatusLabels.push(getToolStatusLabel(name));
        }
      },
    )) {
      for (const label of pendingStatusLabels.splice(0)) {
        if (!isAborted()) yield { type: "status", label };
      }
      if (isAborted()) break;
      fullResponse += chunk;
      yield { type: "content", content: chunk };
    }
```

- [ ] **Step 3: Write a test asserting status events are emitted**

In `server/services/__tests__/coach-pro-chat.test.ts`, add inside the `describe("handleCoachChat")` block:

```typescript
describe("status events", () => {
  it("yields status events for Coach Pro tool calls before content resumes", async () => {
    // Simulate generateCoachProResponse yielding chunks and calling onBeforeToolCalls
    vi.mocked(generateCoachProResponse).mockImplementation(
      async function* (
        _messages,
        _context,
        _userId,
        _signal,
        onBeforeToolCalls,
      ) {
        yield "First chunk";
        onBeforeToolCalls?.(["search_recipes"]);
        yield "After tool";
      },
    );

    const params = makeParams({ isCoachPro: true });
    const events = await collectEvents(handleCoachChat(params));

    const statusEvents = events.filter((e) => e.type === "status");
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0]).toEqual({
      type: "status",
      label: "Searching recipes…",
    });

    // Status event appears between content chunks
    const types = events.map((e) => e.type);
    const contentIdx = types.indexOf("content");
    const statusIdx = types.indexOf("status");
    expect(statusIdx).toBeGreaterThan(contentIdx);
  });

  it("falls back to 'Working on it…' for unknown tool names", async () => {
    vi.mocked(generateCoachProResponse).mockImplementation(
      async function* (
        _messages,
        _context,
        _userId,
        _signal,
        onBeforeToolCalls,
      ) {
        onBeforeToolCalls?.(["some_future_tool"]);
        yield "Done";
      },
    );

    const events = await collectEvents(
      handleCoachChat(makeParams({ isCoachPro: true })),
    );
    const statusEvent = events.find((e) => e.type === "status");
    expect(statusEvent).toEqual({ type: "status", label: "Working on it…" });
  });
});
```

- [ ] **Step 4: Run all coach-pro-chat tests**

```bash
npm run test:run -- server/services/__tests__/coach-pro-chat.test.ts
```

Expected: all tests pass including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add server/services/coach-pro-chat.ts server/services/__tests__/coach-pro-chat.test.ts
git commit -m "$(cat <<'EOF'
feat: add status SSE events to Coach Pro tool calls

CoachChatEvent gains a status variant. handleCoachChat queues labels from
the onBeforeToolCalls callback and drains them as SSE events before each
content chunk from the next tool-call round.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Route wiring — pass status events through SSE

**Files:**

- Modify: `server/routes/chat.ts`

- [ ] **Step 1: Update the coach chat event serialization**

In `server/routes/chat.ts`, find the coach chat for-await loop (around line 461). The current serialization is:

```typescript
const eventJson = JSON.stringify(
  event.type === "content"
    ? { content: event.content }
    : { blocks: event.blocks },
);
```

Replace it with:

```typescript
let payload: object;
if (event.type === "content") {
  payload = { content: event.content };
} else if (event.type === "status") {
  payload = { status: event.label };
} else {
  payload = { blocks: event.blocks };
}
const eventJson = JSON.stringify(payload);
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run check:types 2>&1 | grep "chat.ts" | head -10
```

Expected: no new errors. (TypeScript will verify the discriminated union is exhaustively handled.)

- [ ] **Step 3: Run route tests**

```bash
npm run test:run -- server/routes/__tests__/chat.test.ts
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/routes/chat.ts
git commit -m "$(cat <<'EOF'
feat: wire status SSE events through coach chat route

Serializes the new CoachChatEvent status variant as { status: label }
so the client receives it as a data.status field.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Update `ChatBubble.tsx` for canvas layout

**Files:**

- Modify: `client/components/ChatBubble.tsx`

- [ ] **Step 1: Replace assistant bubble with canvas layout**

The full new `ChatBubble.tsx` — replace the entire file content:

```typescript
import React, { useEffect } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  cancelAnimation,
  SlideInRight,
  SlideInLeft,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { MarkdownText } from "@/components/MarkdownText";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Spacing, FontFamily, BorderRadius } from "@/constants/theme";

interface ChatBubbleProps {
  role: "user" | "assistant" | "system";
  content: string;
  isStreaming?: boolean;
  onSpeak?: () => void;
  isSpeaking?: boolean;
}

function TypingIndicator() {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const dot1 = useSharedValue(0);
  const dot2 = useSharedValue(0);
  const dot3 = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(dot1);
      cancelAnimation(dot2);
      cancelAnimation(dot3);
      dot1.value = 0;
      dot2.value = 0;
      dot3.value = 0;
      return;
    }
    dot1.value = withRepeat(withTiming(1, { duration: 600 }), -1, true);
    dot2.value = withRepeat(
      withDelay(200, withTiming(1, { duration: 600 })),
      -1,
      true,
    );
    dot3.value = withRepeat(
      withDelay(400, withTiming(1, { duration: 600 })),
      -1,
      true,
    );
  }, [dot1, dot2, dot3, reducedMotion]);

  const dot1Style = useAnimatedStyle(() => ({
    opacity: 0.3 + dot1.value * 0.7,
    transform: [{ translateY: -dot1.value * 3 }],
  }));
  const dot2Style = useAnimatedStyle(() => ({
    opacity: 0.3 + dot2.value * 0.7,
    transform: [{ translateY: -dot2.value * 3 }],
  }));
  const dot3Style = useAnimatedStyle(() => ({
    opacity: 0.3 + dot3.value * 0.7,
    transform: [{ translateY: -dot3.value * 3 }],
  }));

  const dotColor = theme.textSecondary;

  if (reducedMotion) {
    return (
      <View
        style={styles.typingContainer}
        accessibilityLabel="Coach is typing"
        accessibilityRole="text"
      >
        <ThemedText type="body" style={{ color: dotColor }}>
          ...
        </ThemedText>
      </View>
    );
  }

  return (
    <View
      style={styles.typingContainer}
      accessibilityLabel="Coach is typing"
      accessibilityRole="text"
    >
      <Animated.View style={[styles.dot, { backgroundColor: dotColor }, dot1Style]} />
      <Animated.View style={[styles.dot, { backgroundColor: dotColor }, dot2Style]} />
      <Animated.View style={[styles.dot, { backgroundColor: dotColor }, dot3Style]} />
    </View>
  );
}

export function ChatBubble({
  role,
  content,
  isStreaming,
  onSpeak,
  isSpeaking,
}: ChatBubbleProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const isUser = role === "user";

  // Typing indicator (isStreaming prop still supported for backwards compatibility)
  if (!content && isStreaming && !isUser) {
    return (
      <View
        style={[styles.bubbleRow, styles.bubbleRowAssistant]}
        accessible
        accessibilityRole="text"
      >
        <View style={[styles.avatarDot, { backgroundColor: theme.link }]} />
        <View style={styles.assistantContent}>
          <TypingIndicator />
        </View>
      </View>
    );
  }

  if (!content) return null;

  const entering = reducedMotion
    ? undefined
    : isUser
      ? SlideInRight.springify().damping(18).stiffness(150).duration(200)
      : SlideInLeft.springify().damping(18).stiffness(150).delay(100);

  if (isUser) {
    return (
      <Animated.View
        entering={entering}
        style={[styles.bubbleRow, styles.bubbleRowUser]}
        accessible
        accessibilityRole="text"
        accessibilityLabel={`You: ${content}`}
      >
        <View style={[styles.userBubble, { backgroundColor: theme.link }]}>
          <ThemedText
            type="body"
            style={[styles.userBubbleText, { color: theme.buttonText }]}
          >
            {content}
          </ThemedText>
        </View>
      </Animated.View>
    );
  }

  // Assistant — canvas layout: avatar dot + full-width text
  return (
    <Animated.View
      entering={entering}
      style={[styles.bubbleRow, styles.bubbleRowAssistant]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`NutriCoach: ${content}`}
    >
      <View style={[styles.avatarDot, { backgroundColor: theme.link }]} />
      <View style={styles.assistantContent}>
        <MarkdownText style={{ ...styles.assistantBubbleText, color: theme.text }}>
          {content}
        </MarkdownText>
        {onSpeak && (
          <Pressable
            onPress={onSpeak}
            style={styles.speakButton}
            accessibilityRole="button"
            accessibilityLabel={isSpeaking ? "Stop reading aloud" : "Read aloud"}
            accessibilityState={{ selected: isSpeaking }}
            hitSlop={8}
          >
            <Ionicons
              name={isSpeaking ? "stop-circle" : "volume-high"}
              size={16}
              color={theme.textSecondary}
            />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bubbleRow: {
    flexDirection: "row",
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  bubbleRowUser: {
    justifyContent: "flex-end",
  },
  bubbleRowAssistant: {
    justifyContent: "flex-start",
    alignItems: "flex-start",
    gap: 9,
  },
  // User bubble
  userBubble: {
    maxWidth: "80%",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderBottomRightRadius: BorderRadius.xs,
  },
  userBubbleText: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: FontFamily.regular,
  },
  // Assistant canvas
  avatarDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginTop: 2,
    flexShrink: 0,
  },
  assistantContent: {
    flex: 1,
  },
  assistantBubbleText: {
    fontSize: 15,
    lineHeight: 25,
    fontFamily: FontFamily.regular,
  },
  // Shared
  typingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: Spacing.xs,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  speakButton: {
    alignSelf: "flex-end",
    marginTop: Spacing.xs,
    padding: 2,
  },
});
```

- [ ] **Step 2: Run TypeScript check**

```bash
npm run check:types 2>&1 | grep ChatBubble | head -10
```

Expected: no errors.

- [ ] **Step 3: Run all tests**

```bash
npm run test:run 2>&1 | tail -20
```

Expected: all pass (ChatBubble snapshot/unit tests may need updating if they exist — check the output).

- [ ] **Step 4: Commit**

```bash
git add client/components/ChatBubble.tsx
git commit -m "$(cat <<'EOF'
feat: canvas layout for assistant chat messages

Removes assistant bubble background/border/maxWidth. Adds 22px avatar dot
(theme.link colour) + full-width text at lineHeight 25 (≈1.65 ratio).
User bubbles unchanged. TypingIndicator gains avatar dot alignment.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire `CoachChat.tsx` to use `useCoachStream`

**Files:**

- Modify: `client/components/coach/CoachChat.tsx`

- [ ] **Step 1: Update imports — add hook, remove unused**

At the top of `CoachChat.tsx`, add the import:

```typescript
import { useCoachStream } from "@/hooks/useCoachStream";
```

Keep the existing `coach-chat-utils` import as-is (only `parsePlanDays` / `planBannerA11yLabel` are needed here — `filterValidBlocks` is now used internally by the hook, not in this file):

```typescript
import {
  parsePlanDays,
  planBannerA11yLabel,
} from "@/components/coach/coach-chat-utils";
```

Add a type import for `CoachBlock` (used in the `onDone` callback type):

```typescript
import type { CoachBlock } from "@shared/schemas/coach-blocks";
```

Remove from imports (no longer used in this file):

- `filterValidBlocks` local function definition (lines 65–72 — delete entirely)
- `sendMessageStreaming` function definition (lines 74–150 — delete entirely)

- [ ] **Step 2: Replace inline state + refs with hook**

Remove these state declarations (they are now provided by the hook):

```typescript
// DELETE these lines:
const [isStreaming, setIsStreaming] = useState(false);
const [streamingContent, setStreamingContent] = useState("");
```

Remove these refs (no longer needed):

```typescript
// DELETE these lines:
const abortRef = useRef<AbortController | null>(null);
const pendingStreamingDisplayRef = useRef("");
const streamingFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Add the hook call immediately after `const prevStreamingRef = useRef(false);`:

```typescript
const { startStream, abortStream, streamingContent, statusText, isStreaming } =
  useCoachStream({
    onDone: useCallback((_fullText: string, blocks?: CoachBlock[]) => {
      setOptimisticMessage(null);
      if (blocks && blocks.length > 0) setStreamBlocks(blocks);
    }, []),
    onError: useCallback((msg: string) => {
      setStreamingError(msg);
    }, []),
  });
```

- [ ] **Step 3: Update `handleSend` to use `startStream`**

Replace the `handleSend` body. The full updated function:

```typescript
const handleSend = useCallback(
  async (text?: string) => {
    const content = (text || inputText).trim();
    if (!content || isStreaming) return;

    setInputText("");
    setOptimisticMessage(content);
    setStreamBlocks([]);
    setStreamingError(null);
    ttsStop();

    let convId = conversationId;
    if (!convId) {
      try {
        convId = await onCreateConversation();
      } catch {
        setOptimisticMessage(null);
        return;
      }
    }

    const currentWarmUpId = isCoachPro ? warmUpHook.getWarmUpId() : null;
    startStream(convId, content, { warmUpId: currentWarmUpId });
    warmUpHook.reset();
  },
  [
    inputText,
    isStreaming,
    conversationId,
    onCreateConversation,
    warmUpHook,
    isCoachPro,
    ttsStop,
    startStream,
  ],
);
```

- [ ] **Step 4: Remove the `streamingFlushRef` cleanup effect**

Delete the entire `useEffect` block that cleans up `streamingFlushRef` (currently around line 588):

```typescript
// DELETE this entire block:
useEffect(() => {
  return () => {
    if (streamingFlushRef.current) {
      clearTimeout(streamingFlushRef.current);
      streamingFlushRef.current = null;
    }
  };
}, []);
```

- [ ] **Step 5: Update the `stream` render item to show `statusText`**

Find the `stream` item render (the `return (...)` block for `item.type === "stream"`, currently around line 544). Replace the `ActivityIndicator` loading state with status text:

```typescript
      // stream item (current user message sent, coach responding)
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
            <View style={styles.statusRow}>
              <View
                style={[styles.statusDot, { backgroundColor: theme.link }]}
              />
              <Text
                style={[
                  styles.statusText,
                  { color: theme.textSecondary },
                ]}
              >
                {statusText}
              </Text>
            </View>
          ) : null}
        </View>
      );
```

- [ ] **Step 6: Add new styles**

In the `StyleSheet.create` block, add:

```typescript
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  statusDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    flexShrink: 0,
  },
  statusText: {
    fontSize: 14,
    fontFamily: FontFamily.regular,
    fontStyle: "italic",
  },
```

Also remove the now-unused `typing` style.

- [ ] **Step 7: Add `FontFamily` to imports if not already present**

Ensure `FontFamily` is in the `@/constants/theme` import:

```typescript
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";
```

- [ ] **Step 8: Run TypeScript check and tests**

```bash
npm run check:types 2>&1 | grep CoachChat | head -10
npm run test:run -- client/components/coach/
```

Expected: no new errors, all tests pass.

- [ ] **Step 9: Commit**

```bash
git add client/components/coach/CoachChat.tsx
git commit -m "$(cat <<'EOF'
feat: wire CoachChat to useCoachStream hook

Removes 150-line inline XHR streaming function. Hook provides isStreaming,
streamingContent, statusText. Status text (italic, with avatar dot) replaces
ActivityIndicator while coach thinks.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Wire `CoachOverlayContent.tsx` to use `useCoachStream`

**Files:**

- Modify: `client/components/CoachOverlayContent.tsx`

- [ ] **Step 1: Update imports**

Add imports:

```typescript
import { useCoachStream } from "@/hooks/useCoachStream";
import { FontFamily } from "@/constants/theme";
```

(The `FontFamily` import is needed for the status text style.)

Remove `tokenStorage` and `getApiUrl` from imports — they are no longer used directly in this file after removing `sendMessageStreaming`.

- [ ] **Step 2: Delete `sendMessageStreaming` and inline state**

Delete the entire `sendMessageStreaming` function (lines 49–123).

Remove these state declarations:

```typescript
// DELETE:
const [isStreaming, setIsStreaming] = useState(false);
const [streamingContent, setStreamingContent] = useState("");
```

Remove the `abortRef`:

```typescript
// DELETE:
const abortRef = useRef<AbortController | null>(null);
```

- [ ] **Step 3: Add `useCoachStream` hook call**

Add immediately after `const queryClient = useQueryClient();`:

```typescript
const { startStream, abortStream, streamingContent, statusText, isStreaming } =
  useCoachStream({
    onDone: useCallback(async () => {
      await queryClient.invalidateQueries({
        queryKey: [`/api/chat/conversations/${conversationId}/messages`],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/chat/conversations"],
      });
    }, [queryClient, conversationId]),
    onError: useCallback(() => {
      setStreamError(true);
    }, []),
  });
```

- [ ] **Step 4: Update the initial send effect**

Find the `useEffect` that sends the initial question (around line 168). Replace the `sendMessageStreaming(...)` call with:

```typescript
useEffect(() => {
  if (!conversationId || didSendRef.current) return;
  didSendRef.current = true;

  startStream(conversationId, question.question, { screenContext });

  return () => {
    abortStream();
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [conversationId]);
```

- [ ] **Step 5: Update `handleSend`**

Replace the `handleSend` function body:

```typescript
const handleSend = useCallback(() => {
  if (!inputText.trim() || isStreaming || !conversationId) return;
  const text = inputText.trim();
  setInputText("");
  startStream(conversationId, text);
}, [inputText, isStreaming, conversationId, startStream]);
```

- [ ] **Step 6: Remove the unmount cleanup effect**

Delete the effect that called `abortRef.current?.abort()` on unmount — the hook handles cleanup internally.

- [ ] **Step 7: Update `displayMessages` and add status text row**

The `displayMessages` array currently adds a streaming bubble for `isStreaming && streamingContent`. This still works with the hook. Keep it as-is — the hook's `streamingContent` drops in as a direct replacement.

Inside the `<ScrollView>`, after `{displayMessages.map(...)}` and before `{streamError && ...}`, add the status text row:

```typescript
          {isStreaming && !streamingContent && statusText ? (
            <View style={styles.statusRow}>
              <View
                style={[styles.statusDot, { backgroundColor: theme.link }]}
              />
              <ThemedText
                style={[styles.statusText, { color: theme.textSecondary }]}
              >
                {statusText}
              </ThemedText>
            </View>
          ) : null}
```

- [ ] **Step 8: Add new styles**

Add to the `StyleSheet.create` block in `CoachOverlayContent.tsx`:

```typescript
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingVertical: Spacing.sm,
  },
  statusDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    flexShrink: 0,
  },
  statusText: {
    fontSize: 14,
    fontFamily: FontFamily.regular,
    fontStyle: "italic",
  },
```

- [ ] **Step 9: Run full TypeScript check and all tests**

```bash
npm run check:types
npm run test:run
```

Expected: TypeScript clean, all tests pass.

- [ ] **Step 10: Commit**

```bash
git add client/components/CoachOverlayContent.tsx
git commit -m "$(cat <<'EOF'
feat: wire CoachOverlayContent to useCoachStream hook

Removes 75-line inline XHR streaming function. Status text row renders
below messages when coach is thinking. onDone invalidates the messages
query so the saved assistant message loads immediately after streaming.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Final check

- [ ] **Run full test suite**

```bash
npm run test:run
```

Expected: all existing tests pass, new tests in `useCoachStream.test.ts` and `coach-pro-chat.test.ts` pass.

- [ ] **Run TypeScript**

```bash
npm run check:types
```

Expected: clean.

- [ ] **Run lint**

```bash
npm run lint
```

Expected: clean.
