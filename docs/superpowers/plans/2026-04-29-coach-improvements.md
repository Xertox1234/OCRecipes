# Coach Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver six targeted Coach improvements — retry/regenerate (B1), block action feedback (B2), conversation management with pin + full history (B3), notebook full-CRUD UI (C1), local push notifications for commitment reminders (C2), and text input warm-up (C4).

**Architecture:** Server changes are additive (new routes on existing tables); no breaking changes to existing routes. Client adds three new screens (AllConversationsScreen, NotebookScreen, NotebookEntryScreen) registered as root-stack modals. A single schema migration adds `isPinned`/`pinnedAt` to `chat_conversations`. Push notification scheduling is entirely client-side via `expo-notifications` with IDs persisted in AsyncStorage.

**Tech Stack:** React Native/Expo SDK 54, Express.js 5, Drizzle ORM, TanStack Query v5, expo-notifications (already installed), AsyncStorage, Vitest

---

## File Map

### New files

| File                                        | Purpose                                        |
| ------------------------------------------- | ---------------------------------------------- |
| `client/screens/AllConversationsScreen.tsx` | Full history + pin management (B3)             |
| `client/screens/NotebookScreen.tsx`         | Notebook entry list with filter chips (C1)     |
| `client/screens/NotebookEntryScreen.tsx`    | Entry detail / edit / create (C1)              |
| `client/hooks/useNotebookNotifications.ts`  | Schedule/cancel local push per commitment (C2) |
| `server/routes/notebook.ts`                 | GET/POST/PATCH/DELETE /api/coach/notebook (C1) |
| `server/routes/__tests__/notebook.test.ts`  | Route tests for notebook CRUD (C1)             |

### Modified files

| File                                            | What changes                                                                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/schema.ts`                              | Add `isPinned`, `pinnedAt` to `chatConversations`                                                                                               |
| `server/storage/chat.ts`                        | Add `deleteChatMessage`, `pinChatConversation`; extend `getChatConversations` with pagination + search                                          |
| `server/storage/coach-notebook.ts`              | Add `getNotebookEntries`, `updateNotebookEntry`, `deleteNotebookEntry`                                                                          |
| `server/storage/index.ts`                       | Export new storage functions                                                                                                                    |
| `server/routes/chat.ts`                         | Add `DELETE /api/chat/messages/:id`; add `PATCH /api/chat/conversations/:id/pin`; extend `GET /api/chat/conversations` with `?search` + `?page` |
| `server/routes.ts`                              | Register notebook routes                                                                                                                        |
| `server/routes/__tests__/chat.test.ts`          | Add test cases for new routes                                                                                                                   |
| `server/__tests__/factories/chat.ts`            | Add `isPinned`/`pinnedAt` to mock factory                                                                                                       |
| `client/hooks/useCoachWarmUp.ts`                | Add `sendTextWarmUp` (3-char threshold)                                                                                                         |
| `client/hooks/useChat.ts`                       | Add `isPinned`/`pinnedAt` to `ChatConversation` interface; add `usePinConversation`, `useDeleteChatMessage` mutations                           |
| `client/components/coach/blocks/ActionCard.tsx` | Add `onPressAsync` prop + idle/loading/success/error state machine                                                                              |
| `client/components/coach/CoachChat.tsx`         | Add `handleRetry` + retry button; wire `sendTextWarmUp` to `onChangeText`                                                                       |
| `client/screens/CoachProScreen.tsx`             | Add pin indicators + "See all" tile to thread bar; add Notebook header button                                                                   |
| `client/navigation/RootStackNavigator.tsx`      | Register `AllConversations`, `NotebookScreen`, `NotebookEntryScreen`                                                                            |
| `client/types/navigation.ts`                    | Add navigation prop types for new screens                                                                                                       |

---

## Task 1: Schema — add isPinned and pinnedAt to chatConversations

**Files:**

- Modify: `shared/schema.ts`
- Modify: `server/__tests__/factories/chat.ts`
- Run: `npm run db:push`

- [ ] **Step 1: Add columns to schema**

In `shared/schema.ts`, locate the `chatConversations` table definition (around line 880). Add two columns after `metadata`:

```typescript
// Add these two lines after the metadata column:
isPinned: boolean("is_pinned").default(false).notNull(),
pinnedAt: timestamp("pinned_at"),
```

The full column block becomes:

```typescript
export const chatConversations = pgTable(
  "chat_conversations",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    type: text("type").notNull().default("coach"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    isPinned: boolean("is_pinned").default(false).notNull(),
    pinnedAt: timestamp("pinned_at"),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  // ... existing indexes unchanged
```

- [ ] **Step 2: Push schema to database**

```bash
npm run db:push
```

Expected: Drizzle prints the ALTER TABLE statement and completes without error.

- [ ] **Step 3: Update factory defaults**

In `server/__tests__/factories/chat.ts`, add `isPinned: false, pinnedAt: null` to `chatConversationDefaults`:

```typescript
const chatConversationDefaults: ChatConversation = {
  id: 1,
  userId: "1",
  title: "Test Conversation",
  type: "coach",
  metadata: null,
  isPinned: false,
  pinnedAt: null,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};
```

- [ ] **Step 4: Verify types compile**

```bash
npm run check:types
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add shared/schema.ts server/__tests__/factories/chat.ts
git commit -m "feat: add isPinned/pinnedAt columns to chat_conversations"
```

---

## Task 2: C4 — Text warm-up

**Files:**

- Modify: `client/hooks/useCoachWarmUp.ts`
- Modify: `client/components/coach/CoachChat.tsx`
- Test: `client/hooks/__tests__/useCoachWarmUp.test.ts` (existing file — add cases)

- [ ] **Step 1: Write the failing test**

In `client/hooks/__tests__/useCoachWarmUp.test.ts`, add these two test cases (find the existing describe block and append):

```typescript
describe("sendTextWarmUp", () => {
  it("does not fire for text shorter than 3 chars", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCoachWarmUp(42));
    act(() => {
      result.current.sendTextWarmUp("hi");
    });
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(apiRequest).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("fires warm-up after 3+ chars and 500ms debounce", async () => {
    vi.useFakeTimers();
    vi.mocked(apiRequest).mockResolvedValue({
      json: async () => ({ warmUpId: "test-id" }),
    } as unknown as Response);
    const { result } = renderHook(() => useCoachWarmUp(42));
    act(() => {
      result.current.sendTextWarmUp("hel");
    });
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/coach/warm-up", {
      conversationId: 42,
      interimTranscript: "hel",
    });
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:run -- client/hooks/__tests__/useCoachWarmUp.test.ts
```

Expected: FAIL — `sendTextWarmUp is not a function`

- [ ] **Step 3: Add sendTextWarmUp to the hook**

In `client/hooks/useCoachWarmUp.ts`, add the new function after `sendWarmUp`:

```typescript
const sendTextWarmUp = useCallback(
  async (text: string) => {
    if (!conversationId || pendingRef.current) return;
    if (text.length < 3) return;
    if (text === lastTranscriptRef.current) return;

    lastTranscriptRef.current = text;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      pendingRef.current = true;
      try {
        const res = await apiRequest("POST", "/api/coach/warm-up", {
          conversationId,
          interimTranscript: text,
        });
        const data = await res.json();
        warmUpIdRef.current = data.warmUpId;
      } catch {
        warmUpIdRef.current = null;
      } finally {
        pendingRef.current = false;
      }
    }, 500);
  },
  [conversationId],
);
```

Update the return statement:

```typescript
return { sendWarmUp, sendTextWarmUp, getWarmUpId, reset };
```

- [ ] **Step 4: Wire into CoachChat.tsx**

In `client/components/coach/CoachChat.tsx`, find the `TextInput` `onChangeText` handler (line ~557):

```typescript
onChangeText = { setInputText };
```

Replace with:

```typescript
onChangeText={(text) => {
  setInputText(text);
  if (isCoachPro) warmUpHook.sendTextWarmUp(text);
}}
```

- [ ] **Step 5: Run tests and verify they pass**

```bash
npm run test:run -- client/hooks/__tests__/useCoachWarmUp.test.ts
```

Expected: All tests pass including new cases.

- [ ] **Step 6: Commit**

```bash
git add client/hooks/useCoachWarmUp.ts client/components/coach/CoachChat.tsx client/hooks/__tests__/useCoachWarmUp.test.ts
git commit -m "feat: text input warm-up pre-fetch for Coach Pro (C4)"
```

---

## Task 3: B2 — ActionCard async feedback states

**Files:**

- Modify: `client/components/coach/blocks/ActionCard.tsx`
- Test: `client/components/coach/blocks/__tests__/ActionCard.test.tsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `client/components/coach/blocks/__tests__/ActionCard.test.tsx`:

```typescript
import React from "react";
import { render, fireEvent, act, waitFor } from "@testing-library/react-native";
import { describe, it, expect, vi } from "vitest";
import ActionCard from "../ActionCard";
import type { ActionCard as ActionCardType } from "@shared/schemas/coach-blocks";

const mockBlock: ActionCardType = {
  type: "action_card",
  title: "Log breakfast",
  subtitle: "500 calories",
  actionLabel: "Log",
  action: { type: "log_food", description: "oats" },
};

describe("ActionCard", () => {
  it("calls onAction when no onPressAsync is provided", () => {
    const onAction = vi.fn();
    const { getByRole } = render(
      <ActionCard block={mockBlock} onAction={onAction} />,
    );
    fireEvent.press(getByRole("button"));
    expect(onAction).toHaveBeenCalledWith(mockBlock.action);
  });

  it("shows success state after onPressAsync resolves", async () => {
    const onPressAsync = vi.fn().mockResolvedValue(undefined);
    const { getByRole, getByText } = render(
      <ActionCard block={mockBlock} onPressAsync={onPressAsync} />,
    );
    await act(async () => { fireEvent.press(getByRole("button")); });
    await waitFor(() => expect(getByText("Done")).toBeTruthy());
  });

  it("shows error state after onPressAsync rejects", async () => {
    const onPressAsync = vi.fn().mockRejectedValue(new Error("fail"));
    const { getByRole, getByText } = render(
      <ActionCard block={mockBlock} onPressAsync={onPressAsync} />,
    );
    await act(async () => { fireEvent.press(getByRole("button")); });
    await waitFor(() => expect(getByText("Failed")).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:run -- client/components/coach/blocks/__tests__/ActionCard.test.tsx
```

Expected: FAIL — `onPressAsync is not a prop`

- [ ] **Step 3: Rewrite ActionCard with state machine**

Replace `client/components/coach/blocks/ActionCard.tsx` entirely:

```typescript
import React, { useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { ActionCard as ActionCardType } from "@shared/schemas/coach-blocks";

type FeedbackState = "idle" | "loading" | "success" | "error";

interface Props {
  block: ActionCardType;
  onAction?: (action: Record<string, unknown>) => void;
  onPressAsync?: () => Promise<void>;
}

export default function ActionCard({ block, onAction, onPressAsync }: Props) {
  const { theme } = useTheme();
  const [state, setState] = useState<FeedbackState>("idle");

  const handlePress = useCallback(async () => {
    if (state !== "idle") return;
    if (onPressAsync) {
      setState("loading");
      try {
        await onPressAsync();
        setState("success");
        setTimeout(() => setState("idle"), 1500);
      } catch {
        setState("error");
        setTimeout(() => setState("idle"), 1500);
      }
    } else {
      onAction?.(block.action as Record<string, unknown>);
    }
  }, [state, onPressAsync, onAction, block.action]);

  const label =
    state === "success" ? "Done" :
    state === "error" ? "Failed" :
    block.actionLabel;

  const buttonBg =
    state === "success" ? "#008A38" :
    state === "error" ? theme.error :
    theme.link;

  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}
      accessible={false}
    >
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>{block.title}</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          {block.subtitle}
        </Text>
      </View>
      <Pressable
        style={[styles.button, { backgroundColor: buttonBg }]}
        onPress={handlePress}
        disabled={state === "loading"}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {state === "loading" ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>{label}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  content: { flex: 1, marginRight: 12 },
  title: { fontSize: 14, fontWeight: "600" },
  subtitle: { fontSize: 12, marginTop: 2 },
  button: {
    minHeight: 44,
    minWidth: 64,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
});
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npm run test:run -- client/components/coach/blocks/__tests__/ActionCard.test.tsx
```

Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/components/coach/blocks/ActionCard.tsx client/components/coach/blocks/__tests__/ActionCard.test.tsx
git commit -m "feat: ActionCard async feedback states (B2)"
```

---

## Task 4: B1 — Delete message storage + route

**Files:**

- Modify: `server/storage/chat.ts`
- Modify: `server/storage/index.ts`
- Modify: `server/routes/chat.ts`
- Modify: `server/routes/__tests__/chat.test.ts`

- [ ] **Step 1: Write the failing route tests**

In `server/routes/__tests__/chat.test.ts`, add `deleteChatMessage: vi.fn()` to the storage mock object (find the `vi.mock("../../storage", ...)` block and add it), then add this describe block:

```typescript
describe("DELETE /api/chat/messages/:id", () => {
  beforeEach(() => {
    vi.mocked(storage.getChatConversation).mockResolvedValue(
      createMockChatConversation({ id: 1, userId: "test-user" }),
    );
  });

  it("deletes a message and returns 204", async () => {
    vi.mocked(storage.deleteChatMessage).mockResolvedValue(true);
    const res = await request(app)
      .delete("/api/chat/messages/5")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(204);
    expect(storage.deleteChatMessage).toHaveBeenCalledWith(5, "test-user");
  });

  it("returns 404 when message not found or not owned", async () => {
    vi.mocked(storage.deleteChatMessage).mockResolvedValue(false);
    const res = await request(app)
      .delete("/api/chat/messages/999")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid message id", async () => {
    const res = await request(app)
      .delete("/api/chat/messages/abc")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).delete("/api/chat/messages/5");
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:run -- server/routes/__tests__/chat.test.ts --reporter=verbose 2>&1 | grep "DELETE /api/chat/messages"
```

Expected: FAIL — route does not exist.

- [ ] **Step 3: Add deleteChatMessage to storage**

In `server/storage/chat.ts`, add after `deleteChatConversation`:

```typescript
export async function deleteChatMessage(
  messageId: number,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(chatMessages)
    .where(
      and(
        eq(chatMessages.id, messageId),
        inArray(
          chatMessages.conversationId,
          db
            .select({ id: chatConversations.id })
            .from(chatConversations)
            .where(eq(chatConversations.userId, userId)),
        ),
      ),
    )
    .returning({ id: chatMessages.id });
  return result.length > 0;
}
```

Note: `inArray` is already imported at the top of the file.

- [ ] **Step 4: Export from storage index**

In `server/storage/index.ts`, find the section that exports chat storage functions and add:

```typescript
deleteChatMessage: chat.deleteChatMessage,
```

- [ ] **Step 5: Add the route**

In `server/routes/chat.ts`, add after the `DELETE /api/chat/conversations/:id` route (around line 513):

```typescript
// DELETE /api/chat/messages/:id
app.delete(
  "/api/chat/messages/:id",
  requireAuth,
  chatRateLimit,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = parsePositiveIntParam(req.params.id);
      if (!id)
        return sendError(
          res,
          400,
          "Invalid message ID",
          ErrorCode.VALIDATION_ERROR,
        );
      const deleted = await storage.deleteChatMessage(id, req.userId);
      if (!deleted)
        return sendError(res, 404, "Message not found", ErrorCode.NOT_FOUND);
      res.status(204).send();
    } catch (error) {
      handleRouteError(res, error, "delete chat message");
    }
  },
);
```

- [ ] **Step 6: Run tests and verify they pass**

```bash
npm run test:run -- server/routes/__tests__/chat.test.ts
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/storage/chat.ts server/storage/index.ts server/routes/chat.ts server/routes/__tests__/chat.test.ts
git commit -m "feat: add DELETE /api/chat/messages/:id route (B1)"
```

---

## Task 5: B1 — Retry UI in CoachChat

**Files:**

- Modify: `client/components/coach/CoachChat.tsx`
- Modify: `client/hooks/useChat.ts`

- [ ] **Step 1: Add useDeleteChatMessage hook**

In `client/hooks/useChat.ts`, add after `useCreateConversation`:

```typescript
export function useDeleteChatMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (messageId: number) => {
      await apiRequest("DELETE", `/api/chat/messages/${messageId}`);
    },
    onSuccess: (_data, _vars, context) => {
      // Intentionally no cache invalidation — CoachChat manages
      // message state directly during retry to avoid UI flicker.
    },
  });
}
```

- [ ] **Step 2: Add handleRetry to CoachChat**

In `client/components/coach/CoachChat.tsx`:

1. Import the new hook at the top:

```typescript
import {
  useChatMessages,
  useDeleteChatMessage,
  type ChatMessage,
} from "@/hooks/useChat";
```

2. Inside the `CoachChat` component, add after the `warmUpHook` destructure:

```typescript
const deleteChatMessage = useDeleteChatMessage();
```

3. Add `handleRetry` after `handleSend`:

```typescript
const handleRetry = useCallback(async () => {
  if (!messages || messages.length < 2 || isStreaming) return;
  const lastMsg = messages[messages.length - 1];
  if (lastMsg.role !== "assistant") return;
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMsg) return;

  try {
    // Delete assistant then user message (in order — each was "most recent" at time of delete)
    await deleteChatMessage.mutateAsync(lastMsg.id);
    await deleteChatMessage.mutateAsync(lastUserMsg.id);
  } catch {
    setStreamingError("Retry failed. Check your connection and try again.");
    return;
  }
  handleSend(lastUserMsg.content);
}, [messages, isStreaming, deleteChatMessage, handleSend]);
```

4. Add a `lastAssistantMessageId` derived value (for rendering the retry button):

```typescript
const lastAssistantMessageId = useMemo(() => {
  if (!messages || messages.length === 0) return null;
  const last = messages[messages.length - 1];
  return last.role === "assistant" ? last.id : null;
}, [messages]);
```

5. In `renderItem`, after rendering the assistant `ChatBubble` (inside the `item.type === "message"` branch), add the retry button. Replace the message render block:

```typescript
if (item.type === "message") {
  const msg = item.message;
  const isRetryTarget =
    !isStreaming &&
    msg.role === "assistant" &&
    msg.id === lastAssistantMessageId;
  return (
    <View>
      <ChatBubble
        role={msg.role as "user" | "assistant"}
        content={msg.content}
      />
      {messageBlocks.get(msg.id)?.map((block, i) => (
        <BlockRenderer
          key={`${msg.id}-block-${i}`}
          block={block}
          onAction={handleBlockAction}
          onQuickReply={handleQuickReply}
          onCommitmentAccept={handleCommitmentAccept}
        />
      ))}
      {isRetryTarget && (
        <Pressable
          onPress={handleRetry}
          style={styles.retryButton}
          accessibilityRole="button"
          accessibilityLabel="Regenerate response"
        >
          <Text style={[styles.retryText, { color: theme.textSecondary }]}>
            ↺ Regenerate
          </Text>
        </Pressable>
      )}
    </View>
  );
}
```

6. Add styles at the bottom of the `StyleSheet.create` block:

```typescript
retryButton: {
  alignSelf: "flex-start",
  paddingVertical: 4,
  paddingHorizontal: Spacing.sm,
  marginTop: 2,
},
retryText: { fontSize: 12 },
```

7. Update the `renderItem` deps array to include `lastAssistantMessageId` and `handleRetry`:

```typescript
[
  handleBlockAction,
  handleCommitmentAccept,
  handleQuickReply,
  handleRetry,
  isStreaming,
  lastAssistantMessageId,
  messageBlocks,
  streamBlocks,
  streamingContent,
  theme.textSecondary,
];
```

- [ ] **Step 3: Type-check**

```bash
npm run check:types
```

Expected: No errors.

- [ ] **Step 4: Run full test suite**

```bash
npm run test:run
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/components/coach/CoachChat.tsx client/hooks/useChat.ts
git commit -m "feat: retry/regenerate button on last Coach response (B1)"
```

---

## Task 6: B3 — Pin storage + routes

**Files:**

- Modify: `server/storage/chat.ts`
- Modify: `server/storage/index.ts`
- Modify: `server/routes/chat.ts`
- Modify: `server/routes/__tests__/chat.test.ts`

- [ ] **Step 1: Write failing tests**

In `server/routes/__tests__/chat.test.ts`, add to the storage mock:

```typescript
pinChatConversation: vi.fn(),
```

Then add these describe blocks:

```typescript
describe("PATCH /api/chat/conversations/:id/pin", () => {
  it("pins a conversation and returns the updated row", async () => {
    const updated = createMockChatConversation({
      id: 1,
      isPinned: true,
      pinnedAt: new Date(),
    });
    vi.mocked(storage.pinChatConversation).mockResolvedValue(updated);
    const res = await request(app)
      .patch("/api/chat/conversations/1/pin")
      .send({ isPinned: true })
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.isPinned).toBe(true);
  });

  it("returns 404 when conversation not owned", async () => {
    vi.mocked(storage.pinChatConversation).mockResolvedValue(undefined);
    const res = await request(app)
      .patch("/api/chat/conversations/999/pin")
      .send({ isPinned: true })
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid body", async () => {
    const res = await request(app)
      .patch("/api/chat/conversations/1/pin")
      .send({ isPinned: "yes" })
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/chat/conversations with pagination + search", () => {
  it("passes search and page params to storage", async () => {
    vi.mocked(storage.getChatConversations).mockResolvedValue([]);
    await request(app)
      .get("/api/chat/conversations?type=coach&search=breakfast&page=2")
      .set("Authorization", "Bearer valid-token");
    expect(storage.getChatConversations).toHaveBeenCalledWith(
      "test-user",
      expect.any(Number),
      "coach",
      expect.objectContaining({ search: "breakfast", page: 2 }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:run -- server/routes/__tests__/chat.test.ts 2>&1 | grep -E "PATCH.*pin|GET.*pagination"
```

Expected: FAIL.

- [ ] **Step 3: Add pinChatConversation storage function**

In `server/storage/chat.ts`, add after `updateChatConversationTitle`:

```typescript
export async function pinChatConversation(
  id: number,
  userId: string,
  isPinned: boolean,
): Promise<ChatConversation | undefined> {
  const [updated] = await db
    .update(chatConversations)
    .set({
      isPinned,
      pinnedAt: isPinned ? new Date() : null,
    })
    .where(
      and(eq(chatConversations.id, id), eq(chatConversations.userId, userId)),
    )
    .returning();
  return updated || undefined;
}
```

- [ ] **Step 4: Update getChatConversations signature**

Replace the existing `getChatConversations` function in `server/storage/chat.ts`:

```typescript
export async function getChatConversations(
  userId: string,
  limit = 50,
  type?: "coach" | "recipe" | "remix",
  opts?: { search?: string; page?: number },
): Promise<ChatConversation[]> {
  const page = opts?.page ?? 1;
  const offset = (page - 1) * limit;
  const conditions = [eq(chatConversations.userId, userId)];
  if (type) conditions.push(eq(chatConversations.type, type));
  if (opts?.search) {
    conditions.push(
      sql`lower(${chatConversations.title}) like ${"%" + opts.search.toLowerCase() + "%"}`,
    );
  }
  return db
    .select()
    .from(chatConversations)
    .where(and(...conditions))
    .orderBy(
      desc(chatConversations.isPinned),
      desc(chatConversations.updatedAt),
    )
    .limit(limit)
    .offset(offset);
}
```

- [ ] **Step 5: Export new function from storage index**

In `server/storage/index.ts`, add:

```typescript
pinChatConversation: chat.pinChatConversation,
```

- [ ] **Step 6: Add routes**

In `server/routes/chat.ts`, update the `GET /api/chat/conversations` handler to pass `opts`:

```typescript
app.get(
  "/api/chat/conversations",
  requireAuth,
  chatRateLimit,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const limit = parseQueryInt(req.query.limit, { default: 20, max: 50 });
      const page = parseQueryInt(req.query.page, { default: 1, max: 100 });
      const typeParam = req.query.type as string | undefined;
      const type =
        typeParam === "coach" || typeParam === "recipe" || typeParam === "remix"
          ? typeParam
          : undefined;
      const search =
        typeof req.query.search === "string"
          ? req.query.search.trim()
          : undefined;
      const conversations = await storage.getChatConversations(
        req.userId,
        limit,
        type,
        { search, page },
      );
      res.json(conversations);
    } catch (error) {
      handleRouteError(res, error, "list conversations");
    }
  },
);
```

Then add the pin route after the existing DELETE conversation route:

```typescript
// PATCH /api/chat/conversations/:id/pin
const pinSchema = z.object({ isPinned: z.boolean() });

app.patch(
  "/api/chat/conversations/:id/pin",
  requireAuth,
  chatRateLimit,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const id = parsePositiveIntParam(req.params.id);
      if (!id)
        return sendError(
          res,
          400,
          "Invalid conversation ID",
          ErrorCode.VALIDATION_ERROR,
        );
      const parsed = pinSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(
          res,
          400,
          formatZodError(parsed.error),
          ErrorCode.VALIDATION_ERROR,
        );
      const updated = await storage.pinChatConversation(
        id,
        req.userId,
        parsed.data.isPinned,
      );
      if (!updated)
        return sendError(
          res,
          404,
          "Conversation not found",
          ErrorCode.NOT_FOUND,
        );
      res.json(updated);
    } catch (error) {
      handleRouteError(res, error, "pin conversation");
    }
  },
);
```

- [ ] **Step 7: Run tests and verify they pass**

```bash
npm run test:run -- server/routes/__tests__/chat.test.ts
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add server/storage/chat.ts server/storage/index.ts server/routes/chat.ts server/routes/__tests__/chat.test.ts
git commit -m "feat: pin conversation + paginated search for GET conversations (B3)"
```

---

## Task 7: B3 — Thread bar pin UI + AllConversationsScreen

**Files:**

- Modify: `client/hooks/useChat.ts`
- Modify: `client/screens/CoachProScreen.tsx`
- Create: `client/screens/AllConversationsScreen.tsx`
- Modify: `client/navigation/RootStackNavigator.tsx`
- Modify: `client/types/navigation.ts`

- [ ] **Step 1: Update ChatConversation interface and add usePinConversation**

In `client/hooks/useChat.ts`, update `ChatConversation`:

```typescript
export interface ChatConversation {
  id: number;
  userId: string;
  title: string;
  type: string;
  isPinned: boolean;
  pinnedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Add `usePinConversation` after `useDeleteChatMessage`:

```typescript
export function usePinConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isPinned }: { id: number; isPinned: boolean }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/chat/conversations/${id}/pin`,
        { isPinned },
      );
      return (await res.json()) as ChatConversation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    },
  });
}
```

- [ ] **Step 2: Add AllConversations to RootStackParamList**

In `client/navigation/RootStackNavigator.tsx`, add to the `RootStackParamList` type:

```typescript
AllConversations: undefined;
```

- [ ] **Step 3: Add AllConversationsNavigationProp type**

In `client/types/navigation.ts`, add:

```typescript
export type AllConversationsNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "AllConversations"
>;
```

- [ ] **Step 4: Create AllConversationsScreen**

Create `client/screens/AllConversationsScreen.tsx`:

```typescript
import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import {
  useChatConversations,
  usePinConversation,
  type ChatConversation,
} from "@/hooks/useChat";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { AllConversationsNavigationProp } from "@/types/navigation";

const MAX_PINNED = 3;

function formatRelativeDate(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function AllConversationsScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<AllConversationsNavigationProp>();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const { data: conversations = [], isLoading } = useChatConversations("coach");
  const pinConversation = usePinConversation();

  const deleteConversation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/chat/conversations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    },
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, search]);

  const pinned = filtered.filter((c) => c.isPinned);
  const unpinned = filtered.filter((c) => !c.isPinned);

  const handleTogglePin = useCallback(
    async (conv: ChatConversation) => {
      const pinnedCount = conversations.filter((c) => c.isPinned).length;
      if (!conv.isPinned && pinnedCount >= MAX_PINNED) {
        Alert.alert(
          "Pin limit reached",
          "Unpin an existing conversation first.",
        );
        return;
      }
      await pinConversation.mutateAsync({ id: conv.id, isPinned: !conv.isPinned });
    },
    [conversations, pinConversation],
  );

  const handleDelete = useCallback((conv: ChatConversation) => {
    Alert.alert("Delete conversation", `Delete "${conv.title}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteConversation.mutate(conv.id),
      },
    ]);
  }, [deleteConversation]);

  const renderRow = useCallback(
    (conv: ChatConversation) => (
      <Pressable
        key={conv.id}
        style={[styles.row, { borderBottomColor: theme.border }]}
        onPress={() => {
          navigation.goBack();
          // Parent screen picks up the selected conversation via query cache
        }}
        accessibilityRole="button"
        accessibilityLabel={`Open conversation: ${conv.title}`}
      >
        <View style={styles.rowContent}>
          <Text
            numberOfLines={1}
            style={[styles.rowTitle, { color: theme.text }]}
          >
            {conv.title || "Coach conversation"}
          </Text>
          <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
            {formatRelativeDate(conv.updatedAt)}
          </Text>
        </View>
        <View style={styles.rowActions}>
          <Pressable
            onPress={() => handleTogglePin(conv)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={conv.isPinned ? "Unpin conversation" : "Pin conversation"}
          >
            <Feather
              name="bookmark"
              size={18}
              color={conv.isPinned ? theme.link : theme.textSecondary}
            />
          </Pressable>
          <Pressable
            onPress={() => handleDelete(conv)}
            hitSlop={12}
            style={{ marginLeft: Spacing.sm }}
            accessibilityRole="button"
            accessibilityLabel="Delete conversation"
          >
            <Feather name="trash-2" size={18} color={theme.textSecondary} />
          </Pressable>
        </View>
      </Pressable>
    ),
    [handleDelete, handleTogglePin, navigation, theme],
  );

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.backgroundDefault, paddingTop: insets.top },
      ]}
    >
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>
          All Conversations
        </Text>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Feather name="x" size={24} color={theme.text} />
        </Pressable>
      </View>

      <View style={[styles.searchBar, { backgroundColor: theme.backgroundSecondary }]}>
        <Feather name="search" size={16} color={theme.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: theme.text }]}
          placeholder="Search conversations…"
          placeholderTextColor={theme.textSecondary}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          accessibilityLabel="Search conversations"
        />
      </View>

      {isLoading ? (
        <ActivityIndicator style={styles.loading} color={theme.link} />
      ) : (
        <FlatList
          data={[]}
          keyExtractor={() => ""}
          ListHeaderComponent={
            <>
              {pinned.length > 0 && (
                <>
                  <Text style={[styles.sectionLabel, { color: theme.link }]}>
                    PINNED
                  </Text>
                  {pinned.map(renderRow)}
                </>
              )}
              {unpinned.length > 0 && (
                <>
                  <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
                    CONVERSATIONS
                  </Text>
                  {unpinned.map(renderRow)}
                </>
              )}
              {filtered.length === 0 && (
                <Text style={[styles.empty, { color: theme.textSecondary }]}>
                  No conversations found
                </Text>
              )}
            </>
          }
          renderItem={null}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    margin: Spacing.md,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  searchInput: { flex: 1, fontSize: 14 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowContent: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: "500" },
  rowMeta: { fontSize: 12, marginTop: 2 },
  rowActions: { flexDirection: "row", alignItems: "center" },
  loading: { marginTop: Spacing.xl },
  empty: { textAlign: "center", marginTop: Spacing.xl, fontSize: 14 },
});
```

- [ ] **Step 5: Register AllConversationsScreen in RootStackNavigator**

In `client/navigation/RootStackNavigator.tsx`, add the import:

```typescript
import AllConversationsScreen from "@/screens/AllConversationsScreen";
```

Then add the screen registration inside the navigator (after `FastingModal`):

```typescript
<Stack.Screen
  name="AllConversations"
  component={AllConversationsScreen}
  options={{
    headerShown: false,
    presentation: "fullScreenModal",
    animation: reducedMotion ? "none" : "slide_from_bottom",
  }}
/>
```

- [ ] **Step 6: Update CoachProScreen thread bar**

In `client/screens/CoachProScreen.tsx`:

1. Add imports:

```typescript
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { usePinConversation } from "@/hooks/useChat";
import type { CoachChatNavigationProp } from "@/types/navigation";
```

2. Inside the component, add:

```typescript
const navigation = useNavigation<CoachChatNavigationProp>();
const pinConversation = usePinConversation();
const pinnedConversations = useMemo(
  () => coachConversations.filter((c) => c.isPinned),
  [coachConversations],
);
const unpinnedConversations = useMemo(
  () => coachConversations.filter((c) => !c.isPinned).slice(0, 6),
  [coachConversations],
);
const threadBarConversations = useMemo(
  () => [...pinnedConversations, ...unpinnedConversations],
  [pinnedConversations, unpinnedConversations],
);
```

3. Replace the `recentConversations` useMemo (and remove the old one) and replace the thread bar ScrollView content with:

```typescript
{threadBarConversations.map((conversation) => {
  const isSelected = conversation.id === conversationId;
  return (
    <Pressable
      key={conversation.id}
      onPress={() => setConversationId(conversation.id)}
      style={[
        styles.threadChip,
        {
          borderColor: isSelected ? theme.link : theme.border,
          backgroundColor: isSelected
            ? theme.backgroundSecondary
            : theme.backgroundDefault,
        },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`Open coach conversation ${conversation.title}`}
    >
      {conversation.isPinned && (
        <Feather name="bookmark" size={10} color={theme.link} style={styles.pinIcon} />
      )}
      <Text
        numberOfLines={1}
        style={[
          styles.threadTitle,
          { color: isSelected ? theme.text : theme.textSecondary },
        ]}
      >
        {conversation.title || "Coach conversation"}
      </Text>
    </Pressable>
  );
})}
<Pressable
  onPress={() => navigation.navigate("AllConversations")}
  style={[styles.threadChip, styles.seeAllChip, { borderColor: theme.border }]}
  accessibilityRole="button"
  accessibilityLabel="See all conversations"
>
  <Text style={[styles.threadTitle, { color: theme.textSecondary }]}>
    See all ›
  </Text>
</Pressable>
```

4. Add styles:

```typescript
pinIcon: { marginRight: 3 },
seeAllChip: { width: 72 },
```

- [ ] **Step 7: Type-check and run tests**

```bash
npm run check:types && npm run test:run
```

Expected: No errors, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add client/hooks/useChat.ts client/screens/CoachProScreen.tsx client/screens/AllConversationsScreen.tsx client/navigation/RootStackNavigator.tsx client/types/navigation.ts
git commit -m "feat: conversation pin + All Conversations screen (B3)"
```

---

## Task 8: C1 — Notebook storage + routes

**Files:**

- Modify: `server/storage/coach-notebook.ts`
- Modify: `server/storage/index.ts`
- Create: `server/routes/notebook.ts`
- Create: `server/routes/__tests__/notebook.test.ts`
- Modify: `server/routes.ts`

- [ ] **Step 1: Add CRUD storage functions**

In `server/storage/coach-notebook.ts`, add after the existing functions:

```typescript
export async function getNotebookEntries(
  userId: string,
  opts?: {
    type?: string;
    status?: string;
    page?: number;
    limit?: number;
  },
): Promise<CoachNotebookEntry[]> {
  const limit = opts?.limit ?? 50;
  const page = opts?.page ?? 1;
  const offset = (page - 1) * limit;
  const conditions = [eq(coachNotebook.userId, userId)];
  if (opts?.type) conditions.push(eq(coachNotebook.type, opts.type));
  if (opts?.status) {
    conditions.push(eq(coachNotebook.status, opts.status));
  } else {
    // Default: exclude archived
    conditions.push(ne(coachNotebook.status, "archived"));
  }
  return db
    .select()
    .from(coachNotebook)
    .where(and(...conditions))
    .orderBy(desc(coachNotebook.updatedAt))
    .limit(limit)
    .offset(offset);
}

export async function updateNotebookEntry(
  id: number,
  userId: string,
  updates: {
    content?: string;
    type?: string;
    followUpDate?: Date | null;
    status?: string;
  },
): Promise<CoachNotebookEntry | undefined> {
  const [updated] = await db
    .update(coachNotebook)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(coachNotebook.id, id), eq(coachNotebook.userId, userId)))
    .returning();
  return updated || undefined;
}

export async function deleteNotebookEntry(
  id: number,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(coachNotebook)
    .where(and(eq(coachNotebook.id, id), eq(coachNotebook.userId, userId)))
    .returning({ id: coachNotebook.id });
  return result.length > 0;
}
```

Note: `ne` (not equal) must be imported. Add it to the import line at the top of the file if not already present:

```typescript
import { eq, and, desc, lte, sql, inArray, isNull, ne, or } from "drizzle-orm";
```

(`ne` is already imported per the file's current imports.)

- [ ] **Step 2: Export from storage index**

In `server/storage/index.ts`, add to the coachNotebook section:

```typescript
getNotebookEntries: coachNotebook.getNotebookEntries,
updateNotebookEntry: coachNotebook.updateNotebookEntry,
deleteNotebookEntry: coachNotebook.deleteNotebookEntry,
```

- [ ] **Step 3: Write notebook route tests**

Create `server/routes/__tests__/notebook.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";
import { register } from "../notebook";
import { createMockCoachNotebookEntry } from "../../__tests__/factories";

vi.mock("../../middleware/auth");
vi.mock("../../storage", () => ({
  storage: {
    getNotebookEntries: vi.fn(),
    createNotebookEntry: vi.fn(),
    updateNotebookEntry: vi.fn(),
    deleteNotebookEntry: vi.fn(),
  },
}));

const app = express();
app.use(express.json());
register(app);

describe("GET /api/coach/notebook", () => {
  it("returns entries for the authenticated user", async () => {
    const entries = [createMockCoachNotebookEntry({ type: "insight" })];
    vi.mocked(storage.getNotebookEntries).mockResolvedValue(entries);
    const res = await request(app)
      .get("/api/coach/notebook")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(storage.getNotebookEntries).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({}),
    );
  });
});

describe("POST /api/coach/notebook", () => {
  it("creates a user-authored entry", async () => {
    const entry = createMockCoachNotebookEntry({
      type: "goal",
      content: "Hit 120g protein",
    });
    vi.mocked(storage.createNotebookEntry).mockResolvedValue(entry);
    const res = await request(app)
      .post("/api/coach/notebook")
      .send({ type: "goal", content: "Hit 120g protein" })
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(201);
    expect(storage.createNotebookEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "1",
        type: "goal",
        content: "Hit 120g protein",
      }),
    );
  });

  it("returns 400 for invalid type", async () => {
    const res = await request(app)
      .post("/api/coach/notebook")
      .send({ type: "invalid_type", content: "Test" })
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/coach/notebook/:id", () => {
  it("updates entry content", async () => {
    const updated = createMockCoachNotebookEntry({ content: "Updated" });
    vi.mocked(storage.updateNotebookEntry).mockResolvedValue(updated);
    const res = await request(app)
      .patch("/api/coach/notebook/1")
      .send({ content: "Updated" })
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
  });

  it("returns 404 when not owned", async () => {
    vi.mocked(storage.updateNotebookEntry).mockResolvedValue(undefined);
    const res = await request(app)
      .patch("/api/coach/notebook/999")
      .send({ content: "Updated" })
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/coach/notebook/:id", () => {
  it("deletes an entry", async () => {
    vi.mocked(storage.deleteNotebookEntry).mockResolvedValue(true);
    const res = await request(app)
      .delete("/api/coach/notebook/1")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(204);
  });

  it("returns 404 when not owned", async () => {
    vi.mocked(storage.deleteNotebookEntry).mockResolvedValue(false);
    const res = await request(app)
      .delete("/api/coach/notebook/999")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
npm run test:run -- server/routes/__tests__/notebook.test.ts
```

Expected: FAIL — `register` not found / route not registered.

- [ ] **Step 5: Create notebook routes**

Create `server/routes/notebook.ts`:

```typescript
import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import {
  formatZodError,
  handleRouteError,
  parsePositiveIntParam,
  parseQueryInt,
} from "./_helpers";
import { crudRateLimit } from "./_rate-limiters";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  notebookEntryTypes,
  notebookEntryStatusValues,
} from "@shared/schemas/coach-notebook";

const createEntrySchema = z.object({
  type: z.enum(notebookEntryTypes),
  content: z.string().min(1).max(500),
  followUpDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
});

const updateEntrySchema = z.object({
  content: z.string().min(1).max(500).optional(),
  type: z.enum(notebookEntryTypes).optional(),
  followUpDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  status: z.enum(notebookEntryStatusValues).optional(),
});

export function register(app: Express): void {
  // GET /api/coach/notebook
  app.get(
    "/api/coach/notebook",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const limit = parseQueryInt(req.query.limit, { default: 50, max: 100 });
        const page = parseQueryInt(req.query.page, { default: 1, max: 100 });
        const type =
          typeof req.query.type === "string" ? req.query.type : undefined;
        const status =
          typeof req.query.status === "string" ? req.query.status : undefined;
        const entries = await storage.getNotebookEntries(req.userId, {
          type,
          status,
          page,
          limit,
        });
        res.json(entries);
      } catch (error) {
        handleRouteError(res, error, "list notebook entries");
      }
    },
  );

  // POST /api/coach/notebook
  app.post(
    "/api/coach/notebook",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = createEntrySchema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        const { type, content, followUpDate } = parsed.data;
        const entry = await storage.createNotebookEntry({
          userId: req.userId,
          type,
          content,
          status: "active",
          followUpDate: followUpDate ? new Date(followUpDate) : null,
          sourceConversationId: null,
          dedupeKey: null,
        });
        res.status(201).json(entry);
      } catch (error) {
        handleRouteError(res, error, "create notebook entry");
      }
    },
  );

  // PATCH /api/coach/notebook/:id
  app.patch(
    "/api/coach/notebook/:id",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id)
          return sendError(
            res,
            400,
            "Invalid entry ID",
            ErrorCode.VALIDATION_ERROR,
          );
        const parsed = updateEntrySchema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        const { content, type, followUpDate, status } = parsed.data;
        const updated = await storage.updateNotebookEntry(id, req.userId, {
          ...(content !== undefined && { content }),
          ...(type !== undefined && { type }),
          ...(followUpDate !== undefined && {
            followUpDate: followUpDate ? new Date(followUpDate) : null,
          }),
          ...(status !== undefined && { status }),
        });
        if (!updated)
          return sendError(res, 404, "Entry not found", ErrorCode.NOT_FOUND);
        res.json(updated);
      } catch (error) {
        handleRouteError(res, error, "update notebook entry");
      }
    },
  );

  // DELETE /api/coach/notebook/:id
  app.delete(
    "/api/coach/notebook/:id",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id)
          return sendError(
            res,
            400,
            "Invalid entry ID",
            ErrorCode.VALIDATION_ERROR,
          );
        const deleted = await storage.deleteNotebookEntry(id, req.userId);
        if (!deleted)
          return sendError(res, 404, "Entry not found", ErrorCode.NOT_FOUND);
        res.status(204).send();
      } catch (error) {
        handleRouteError(res, error, "delete notebook entry");
      }
    },
  );
}
```

- [ ] **Step 6: Register in routes.ts**

In `server/routes.ts`, add:

```typescript
import { register as registerNotebook } from "./routes/notebook";
```

Then in `registerRoutes`, add after `registerCoachContext(app)`:

```typescript
registerNotebook(app);
```

- [ ] **Step 7: Run tests and verify they pass**

```bash
npm run test:run -- server/routes/__tests__/notebook.test.ts
```

Expected: All tests pass.

- [ ] **Step 8: Confirm no metadata field in createNotebookEntry call**

The `coachNotebook` table has no `metadata` column, so `InsertCoachNotebookEntry` has no `metadata` field. Verify the `createNotebookEntry` call in `server/routes/notebook.ts` does **not** include `metadata` (the route code in Step 5 already omits it). User-authored entries are distinguishable by their null `sourceConversationId`, which is sufficient for the client to display "Added by you".

- [ ] **Step 9: Type-check**

```bash
npm run check:types
```

Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add server/storage/coach-notebook.ts server/storage/index.ts server/routes/notebook.ts server/routes/__tests__/notebook.test.ts server/routes.ts
git commit -m "feat: notebook CRUD storage + routes (C1)"
```

---

## Task 9: C1 — NotebookScreen + NotebookEntryScreen

**Files:**

- Modify: `client/navigation/RootStackNavigator.tsx`
- Modify: `client/types/navigation.ts`
- Create: `client/screens/NotebookScreen.tsx`
- Create: `client/screens/NotebookEntryScreen.tsx`

- [ ] **Step 0: Add notebook navigation types (required before screen creation)**

In `client/navigation/RootStackNavigator.tsx`, add to `RootStackParamList`:

```typescript
NotebookScreen: undefined;
NotebookEntry: { entryId?: number };
```

In `client/types/navigation.ts`, add:

```typescript
export type NotebookScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "NotebookScreen"
>;

export type NotebookEntryNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "NotebookEntry"
>;
```

- [ ] **Step 1: Create client notebook hook**

Add to `client/hooks/useChat.ts`:

```typescript
// ---- NOTEBOOK ----

export interface NotebookEntry {
  id: number;
  userId: string;
  type: string;
  content: string;
  status: string;
  followUpDate: string | null;
  sourceConversationId: number | null;
  dedupeKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export function useNotebookEntries(opts?: { type?: string; status?: string }) {
  const params = new URLSearchParams();
  if (opts?.type) params.set("type", opts.type);
  if (opts?.status) params.set("status", opts.status);
  const query = params.toString();
  return useQuery<NotebookEntry[]>({
    queryKey: ["/api/coach/notebook", opts],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/coach/notebook${query ? `?${query}` : ""}`,
      );
      return res.json();
    },
  });
}

export function useCreateNotebookEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      type: string;
      content: string;
      followUpDate?: string | null;
    }) => {
      const res = await apiRequest("POST", "/api/coach/notebook", data);
      return (await res.json()) as NotebookEntry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/coach/notebook"] });
    },
  });
}

export function useUpdateNotebookEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: number;
      content?: string;
      type?: string;
      followUpDate?: string | null;
      status?: string;
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/coach/notebook/${id}`,
        updates,
      );
      return (await res.json()) as NotebookEntry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/coach/notebook"] });
    },
  });
}

export function useDeleteNotebookEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/coach/notebook/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/coach/notebook"] });
    },
  });
}
```

- [ ] **Step 2: Create NotebookScreen**

Create `client/screens/NotebookScreen.tsx`:

```typescript
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  Alert,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import {
  useNotebookEntries,
  useUpdateNotebookEntry,
  useDeleteNotebookEntry,
  type NotebookEntry,
} from "@/hooks/useChat";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { NotebookScreenNavigationProp } from "@/types/navigation";

const TYPE_COLORS: Record<string, string> = {
  commitment: "#f59e0b",
  insight: "#7c6dff",
  goal: "#008A38",
  preference: "#06b6d4",
  coaching_strategy: "#06b6d4",
  motivation: "#ec4899",
  emotional_context: "#ec4899",
  conversation_summary: "#888888",
};

const FILTERS = ["all", "commitment", "insight", "goal", "archived"] as const;
type Filter = (typeof FILTERS)[number];

function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? "#888888";
}

export default function NotebookScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NotebookScreenNavigationProp>();
  const [filter, setFilter] = useState<Filter>("all");

  const queryOpts =
    filter === "all"
      ? undefined
      : filter === "archived"
      ? { status: "archived" }
      : { type: filter };

  const { data: entries = [], isLoading } = useNotebookEntries(queryOpts);
  const updateEntry = useUpdateNotebookEntry();
  const deleteEntry = useDeleteNotebookEntry();

  const handleArchive = useCallback(
    (entry: NotebookEntry) => {
      Alert.alert("Archive entry", "Move this entry to archive?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          onPress: () => updateEntry.mutate({ id: entry.id, status: "archived" }),
        },
      ]);
    },
    [updateEntry],
  );

  const handleDelete = useCallback(
    (entry: NotebookEntry) => {
      Alert.alert("Delete entry", "Permanently delete this entry?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteEntry.mutate(entry.id),
        },
      ]);
    },
    [deleteEntry],
  );

  const renderEntry = useCallback(
    ({ item }: { item: NotebookEntry }) => {
      const color = typeColor(item.type);
      const isCompleted = item.status === "completed";
      return (
        <Pressable
          style={[styles.entryCard, { backgroundColor: theme.backgroundSecondary }]}
          onPress={() => navigation.navigate("NotebookEntry", { entryId: item.id })}
          accessibilityRole="button"
          accessibilityLabel={`${item.type}: ${item.content.slice(0, 60)}`}
        >
          <View style={styles.entryRow}>
            <View style={[styles.typeDot, { backgroundColor: color }]} />
            <View style={styles.entryBody}>
              <Text style={[styles.typeLabel, { color }]}>
                {item.type.replace(/_/g, " ").toUpperCase()}
                {isCompleted ? " · DONE" : ""}
              </Text>
              <Text
                numberOfLines={2}
                style={[
                  styles.entryContent,
                  { color: isCompleted ? theme.textSecondary : theme.text },
                  isCompleted && styles.strikethrough,
                ]}
              >
                {item.content}
              </Text>
              {item.followUpDate && !isCompleted && (
                <Text style={[styles.dueDate, { color: color }]}>
                  📅 {new Date(item.followUpDate).toLocaleDateString()}
                </Text>
              )}
            </View>
            <View style={styles.entryActions}>
              <Pressable
                onPress={() => handleArchive(item)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Archive entry"
              >
                <Feather name="archive" size={16} color={theme.textSecondary} />
              </Pressable>
              <Pressable
                onPress={() => handleDelete(item)}
                hitSlop={12}
                style={{ marginTop: Spacing.xs }}
                accessibilityRole="button"
                accessibilityLabel="Delete entry"
              >
                <Feather name="trash-2" size={16} color={theme.textSecondary} />
              </Pressable>
            </View>
          </View>
        </Pressable>
      );
    },
    [handleArchive, handleDelete, navigation, theme],
  );

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.backgroundDefault, paddingTop: insets.top },
      ]}
    >
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>
          My Notebook
        </Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => navigation.navigate("NotebookEntry", {})}
            style={[styles.newBtn, { backgroundColor: theme.link }]}
            accessibilityRole="button"
            accessibilityLabel="Create new notebook entry"
          >
            <Text style={styles.newBtnText}>+ New</Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={{ marginLeft: Spacing.sm }}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Feather name="x" size={24} color={theme.text} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {FILTERS.map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[
              styles.filterChip,
              {
                backgroundColor:
                  filter === f ? theme.link : theme.backgroundSecondary,
              },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f }}
          >
            <Text
              style={[
                styles.filterText,
                { color: filter === f ? "#FFFFFF" : theme.textSecondary },
              ]}
            >
              {f === "all"
                ? "All"
                : f === "coaching_strategy"
                ? "Strategy"
                : f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {isLoading ? (
        <ActivityIndicator style={styles.loading} color={theme.link} />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => String(e.id)}
          renderItem={renderEntry}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: theme.textSecondary }]}>
              No entries yet
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  headerActions: { flexDirection: "row", alignItems: "center" },
  newBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
  },
  newBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  filterRow: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  filterChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
  },
  filterText: { fontSize: 13, fontWeight: "500" },
  list: { padding: Spacing.md, gap: Spacing.sm },
  entryCard: {
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  entryRow: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.sm },
  typeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
    flexShrink: 0,
  },
  entryBody: { flex: 1 },
  typeLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.5, marginBottom: 3 },
  entryContent: { fontSize: 14, lineHeight: 20 },
  strikethrough: { textDecorationLine: "line-through" },
  dueDate: { fontSize: 12, marginTop: 4 },
  entryActions: { alignItems: "center", gap: 4 },
  loading: { marginTop: Spacing.xl },
  empty: { textAlign: "center", marginTop: Spacing.xl, fontSize: 14 },
});
```

- [ ] **Step 3: Create NotebookEntryScreen**

Create `client/screens/NotebookEntryScreen.tsx`:

```typescript
import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Alert,
  StyleSheet,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useTheme } from "@/hooks/useTheme";
import {
  useNotebookEntries,
  useCreateNotebookEntry,
  useUpdateNotebookEntry,
  type NotebookEntry,
} from "@/hooks/useChat";
import { Spacing, BorderRadius } from "@/constants/theme";
import { notebookEntryTypes } from "@shared/schemas/coach-notebook";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { NotebookEntryNavigationProp } from "@/types/navigation";

type RouteProps = RouteProp<RootStackParamList, "NotebookEntry">;

const TYPE_LABELS: Record<string, string> = {
  commitment: "Commitment",
  insight: "Insight",
  goal: "Goal",
  preference: "Preference",
  coaching_strategy: "Strategy",
  motivation: "Motivation",
  emotional_context: "Emotional",
  conversation_summary: "Summary",
};

const TYPE_COLORS: Record<string, string> = {
  commitment: "#f59e0b",
  insight: "#7c6dff",
  goal: "#008A38",
  preference: "#06b6d4",
  coaching_strategy: "#06b6d4",
  motivation: "#ec4899",
  emotional_context: "#ec4899",
  conversation_summary: "#888888",
};

export default function NotebookEntryScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NotebookEntryNavigationProp>();
  const route = useRoute<RouteProps>();
  const entryId = route.params?.entryId;
  const isCreate = !entryId;

  const { data: allEntries = [] } = useNotebookEntries();
  const entry: NotebookEntry | undefined = allEntries.find((e) => e.id === entryId);

  const [type, setType] = useState(entry?.type ?? "insight");
  const [content, setContent] = useState(entry?.content ?? "");
  const [followUpDate, setFollowUpDate] = useState<string | null>(
    entry?.followUpDate
      ? new Date(entry.followUpDate).toISOString().slice(0, 10)
      : null,
  );

  useEffect(() => {
    if (entry) {
      setType(entry.type);
      setContent(entry.content);
      setFollowUpDate(
        entry.followUpDate
          ? new Date(entry.followUpDate).toISOString().slice(0, 10)
          : null,
      );
    }
  }, [entry?.id]);

  const createEntry = useCreateNotebookEntry();
  const updateEntry = useUpdateNotebookEntry();
  const isSaving = createEntry.isPending || updateEntry.isPending;

  const isDirty = isCreate
    ? content.trim().length > 0
    : content !== entry?.content ||
      type !== entry?.type ||
      followUpDate !==
        (entry?.followUpDate
          ? new Date(entry.followUpDate).toISOString().slice(0, 10)
          : null);

  const handleSave = useCallback(async () => {
    if (!content.trim()) return;
    if (isCreate) {
      await createEntry.mutateAsync({ type, content: content.trim(), followUpDate });
    } else if (entryId) {
      await updateEntry.mutateAsync({
        id: entryId,
        type,
        content: content.trim(),
        followUpDate,
      });
    }
    navigation.goBack();
  }, [isCreate, entryId, type, content, followUpDate, createEntry, updateEntry, navigation]);

  const handleMarkComplete = useCallback(() => {
    if (!entryId) return;
    Alert.alert("Mark complete", "Mark this entry as completed?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Complete",
        onPress: async () => {
          await updateEntry.mutateAsync({ id: entryId, status: "completed" });
          navigation.goBack();
        },
      },
    ]);
  }, [entryId, updateEntry, navigation]);

  const handleArchive = useCallback(() => {
    if (!entryId) return;
    Alert.alert("Archive entry", "Move this entry to archive?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Archive",
        onPress: async () => {
          await updateEntry.mutateAsync({ id: entryId, status: "archived" });
          navigation.goBack();
        },
      },
    ]);
  }, [entryId, updateEntry, navigation]);

  const sourceLabel = isCreate
    ? "Added by you"
    : entry?.sourceConversationId
    ? "Extracted by Coach"
    : "Added by you";

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundDefault }]}
      contentContainerStyle={{
        paddingTop: insets.top + Spacing.md,
        paddingBottom: insets.bottom + Spacing.xl,
        paddingHorizontal: Spacing.md,
      }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={[styles.back, { color: theme.link }]}>← Back</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={!isDirty || isSaving || !content.trim()}
          accessibilityRole="button"
          accessibilityLabel="Save entry"
        >
          <Text
            style={[
              styles.saveBtn,
              {
                color:
                  isDirty && content.trim() ? theme.link : theme.textSecondary,
              },
            ]}
          >
            {isSaving ? "Saving…" : "Save"}
          </Text>
        </Pressable>
      </View>

      {/* Type selector */}
      <View style={styles.section}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>TYPE</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.typeRow}>
            {notebookEntryTypes.map((t) => (
              <Pressable
                key={t}
                onPress={() => setType(t)}
                style={[
                  styles.typeChip,
                  {
                    backgroundColor:
                      type === t ? TYPE_COLORS[t] : theme.backgroundSecondary,
                  },
                ]}
                accessibilityRole="radio"
                accessibilityState={{ checked: type === t }}
                accessibilityLabel={TYPE_LABELS[t] ?? t}
              >
                <Text
                  style={[
                    styles.typeChipText,
                    { color: type === t ? "#FFFFFF" : theme.textSecondary },
                  ]}
                >
                  {TYPE_LABELS[t] ?? t}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* Content */}
      <View style={styles.section}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>CONTENT</Text>
        <TextInput
          style={[
            styles.contentInput,
            { backgroundColor: theme.backgroundSecondary, color: theme.text },
          ]}
          value={content}
          onChangeText={setContent}
          multiline
          maxLength={500}
          placeholder="Enter content…"
          placeholderTextColor={theme.textSecondary}
          accessibilityLabel="Entry content"
        />
        <Text style={[styles.charCount, { color: theme.textSecondary }]}>
          {content.length}/500
        </Text>
      </View>

      {/* Follow-up date (commitments only) */}
      {type === "commitment" && (
        <View style={styles.section}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>
            FOLLOW-UP DATE
          </Text>
          <TextInput
            style={[
              styles.dateInput,
              { backgroundColor: theme.backgroundSecondary, color: theme.text },
            ]}
            value={followUpDate ?? ""}
            onChangeText={(v) => setFollowUpDate(v || null)}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.textSecondary}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
            accessibilityLabel="Follow-up date in YYYY-MM-DD format"
          />
        </View>
      )}

      {/* Source */}
      <View style={styles.section}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>SOURCE</Text>
        <Text style={[styles.sourceText, { color: theme.textSecondary }]}>
          {sourceLabel}
        </Text>
      </View>

      {/* Actions (edit mode only) */}
      {!isCreate && entry?.status === "active" && (
        <View style={styles.actionRow}>
          {(entry.type === "commitment" || entry.type === "goal") && (
            <Pressable
              style={[styles.actionBtn, { backgroundColor: "#008A38" }]}
              onPress={handleMarkComplete}
              accessibilityRole="button"
              accessibilityLabel="Mark complete"
            >
              <Text style={styles.actionBtnText}>Mark Complete</Text>
            </Pressable>
          )}
          <Pressable
            style={[
              styles.actionBtn,
              { backgroundColor: theme.backgroundSecondary },
            ]}
            onPress={handleArchive}
            accessibilityRole="button"
            accessibilityLabel="Archive entry"
          >
            <Text style={[styles.actionBtnText, { color: theme.textSecondary }]}>
              Archive
            </Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  back: { fontSize: 14 },
  saveBtn: { fontSize: 14, fontWeight: "600" },
  section: { marginBottom: Spacing.lg },
  label: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  typeRow: { flexDirection: "row", gap: Spacing.xs },
  typeChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
  },
  typeChipText: { fontSize: 12, fontWeight: "600" },
  contentInput: {
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 100,
    textAlignVertical: "top",
  },
  charCount: { fontSize: 11, textAlign: "right", marginTop: 4 },
  dateInput: {
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: 14,
  },
  sourceText: { fontSize: 13 },
  actionRow: { flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.md },
  actionBtn: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
  },
  actionBtnText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
});
```

- [ ] **Step 4: Type-check**

```bash
npm run check:types
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add client/screens/NotebookScreen.tsx client/screens/NotebookEntryScreen.tsx client/hooks/useChat.ts
git commit -m "feat: NotebookScreen + NotebookEntryScreen (C1)"
```

---

## Task 10: C1 — Navigation wiring + CoachProScreen entry point

**Files:**

- Modify: `client/navigation/RootStackNavigator.tsx`
- Modify: `client/types/navigation.ts`
- Modify: `client/screens/CoachProScreen.tsx`

- [ ] **Step 1: Verify RootStackParamList entries exist (done in Task 9 Step 0)**

`NotebookScreen: undefined` and `NotebookEntry: { entryId?: number }` were added to `RootStackParamList` in Task 9 Step 0. Confirm they are present before proceeding.

- [ ] **Step 2: Register screens in RootStackNavigator**

Add imports:

```typescript
import NotebookScreen from "@/screens/NotebookScreen";
import NotebookEntryScreen from "@/screens/NotebookEntryScreen";
```

Register after the `AllConversations` screen:

```typescript
<Stack.Screen
  name="NotebookScreen"
  component={NotebookScreen}
  options={{
    headerShown: false,
    presentation: "fullScreenModal",
    animation: reducedMotion ? "none" : "slide_from_bottom",
  }}
/>
<Stack.Screen
  name="NotebookEntry"
  component={NotebookEntryScreen}
  options={{
    headerShown: false,
    presentation: "modal",
  }}
/>
```

- [ ] **Step 3: Verify navigation prop types exist (done in Task 9 Step 0)**

`NotebookScreenNavigationProp` and `NotebookEntryNavigationProp` were added to `client/types/navigation.ts` in Task 9 Step 0. Confirm they are present before proceeding.

- [ ] **Step 4: Add Notebook button to CoachProScreen**

In `client/screens/CoachProScreen.tsx`, the screen renders inside a `<View style={styles.container}>`. Add a header row above the `CoachDashboard` (after the loading/error blocks, inside the `{context && ...}` block):

```typescript
{context && (
  <>
    <View style={[styles.notebookHeader, { borderBottomColor: theme.border }]}>
      <Pressable
        onPress={() => navigation.navigate("NotebookScreen")}
        style={[styles.notebookBtn, { borderColor: theme.border }]}
        accessibilityRole="button"
        accessibilityLabel="Open notebook"
      >
        <Feather name="book-open" size={16} color={theme.textSecondary} />
        <Text style={[styles.notebookBtnText, { color: theme.textSecondary }]}>
          Notebook
        </Text>
      </Pressable>
    </View>
    <CoachDashboard
      context={context}
      onSuggestionPress={handleSuggestionPress}
    />
  </>
)}
```

Add styles:

```typescript
notebookHeader: {
  flexDirection: "row",
  justifyContent: "flex-end",
  paddingHorizontal: Spacing.md,
  paddingVertical: Spacing.xs,
  borderBottomWidth: StyleSheet.hairlineWidth,
},
notebookBtn: {
  flexDirection: "row",
  alignItems: "center",
  gap: 4,
  paddingHorizontal: Spacing.sm,
  paddingVertical: 6,
  borderRadius: BorderRadius.sm,
  borderWidth: 1,
},
notebookBtnText: { fontSize: 13 },
```

- [ ] **Step 5: Type-check**

```bash
npm run check:types
```

Expected: No errors.

- [ ] **Step 6: Run full tests**

```bash
npm run test:run
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add client/navigation/RootStackNavigator.tsx client/types/navigation.ts client/screens/CoachProScreen.tsx
git commit -m "feat: register notebook screens + CoachProScreen entry point (C1)"
```

---

## Task 11: C2 — Local push notifications

**Files:**

- Create: `client/hooks/useNotebookNotifications.ts`
- Modify: `client/screens/NotebookEntryScreen.tsx`
- Modify: `client/screens/CoachProScreen.tsx`

- [ ] **Step 1: Create useNotebookNotifications hook**

Create `client/hooks/useNotebookNotifications.ts`:

```typescript
import { useCallback } from "react";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "COACH_NOTIFICATION_IDS";

async function getNotificationMap(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function setNotificationMap(map: Record<string, string>): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function useNotebookNotifications() {
  const requestPermission = useCallback(async (): Promise<boolean> => {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === "granted";
  }, []);

  const scheduleCommitmentReminder = useCallback(
    async (
      entryId: number,
      content: string,
      followUpDate: string,
    ): Promise<void> => {
      const granted = await requestPermission();
      if (!granted) return;

      // Cancel any existing notification for this entry
      const map = await getNotificationMap();
      const existing = map[String(entryId)];
      if (existing) {
        await Notifications.cancelScheduledNotificationAsync(existing).catch(
          () => {},
        );
      }

      // Schedule for 9:00 AM on the followUpDate
      const [year, month, day] = followUpDate.split("-").map(Number);
      const fireDate = new Date(year, month - 1, day, 9, 0, 0);
      if (fireDate <= new Date()) return; // Past dates: skip

      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: "Coach reminder",
          body: content.slice(0, 100),
          data: { entryId },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: fireDate,
        },
      });

      map[String(entryId)] = id;
      await setNotificationMap(map);
    },
    [requestPermission],
  );

  const cancelCommitmentReminder = useCallback(
    async (entryId: number): Promise<void> => {
      const map = await getNotificationMap();
      const id = map[String(entryId)];
      if (id) {
        await Notifications.cancelScheduledNotificationAsync(id).catch(
          () => {},
        );
        const updated = { ...map };
        delete updated[String(entryId)];
        await setNotificationMap(updated);
      }
    },
    [],
  );

  const cancelStaleReminders = useCallback(
    async (activeEntryIds: number[]): Promise<void> => {
      const map = await getNotificationMap();
      const activeSet = new Set(activeEntryIds.map(String));
      const toCancel = Object.keys(map).filter((id) => !activeSet.has(id));
      await Promise.all(
        toCancel.map((id) =>
          Notifications.cancelScheduledNotificationAsync(map[id]).catch(
            () => {},
          ),
        ),
      );
      if (toCancel.length > 0) {
        const updated = { ...map };
        toCancel.forEach((id) => delete updated[id]);
        await setNotificationMap(updated);
      }
    },
    [],
  );

  return {
    scheduleCommitmentReminder,
    cancelCommitmentReminder,
    cancelStaleReminders,
  };
}
```

- [ ] **Step 2: Wire scheduling into NotebookEntryScreen**

In `client/screens/NotebookEntryScreen.tsx`, add the import:

```typescript
import { useNotebookNotifications } from "@/hooks/useNotebookNotifications";
```

Inside the component, add after the mutation hooks:

```typescript
const { scheduleCommitmentReminder, cancelCommitmentReminder } =
  useNotebookNotifications();
```

Update `handleSave` to schedule/cancel notifications:

```typescript
const handleSave = useCallback(async () => {
  if (!content.trim()) return;
  let savedEntry: NotebookEntry | undefined;
  if (isCreate) {
    savedEntry = await createEntry.mutateAsync({
      type,
      content: content.trim(),
      followUpDate,
    });
  } else if (entryId) {
    savedEntry = await updateEntry.mutateAsync({
      id: entryId,
      type,
      content: content.trim(),
      followUpDate,
    });
  }
  if (savedEntry && savedEntry.type === "commitment") {
    if (savedEntry.followUpDate) {
      await scheduleCommitmentReminder(
        savedEntry.id,
        savedEntry.content,
        new Date(savedEntry.followUpDate).toISOString().slice(0, 10),
      );
    } else {
      await cancelCommitmentReminder(savedEntry.id);
    }
  }
  navigation.goBack();
}, [
  isCreate,
  entryId,
  type,
  content,
  followUpDate,
  createEntry,
  updateEntry,
  scheduleCommitmentReminder,
  cancelCommitmentReminder,
  navigation,
]);
```

Update `handleMarkComplete` and `handleArchive` to cancel notifications:

```typescript
const handleMarkComplete = useCallback(() => {
  if (!entryId) return;
  Alert.alert("Mark complete", "Mark this entry as completed?", [
    { text: "Cancel", style: "cancel" },
    {
      text: "Complete",
      onPress: async () => {
        await updateEntry.mutateAsync({ id: entryId, status: "completed" });
        await cancelCommitmentReminder(entryId);
        navigation.goBack();
      },
    },
  ]);
}, [entryId, updateEntry, cancelCommitmentReminder, navigation]);

const handleArchive = useCallback(() => {
  if (!entryId) return;
  Alert.alert("Archive entry", "Move this entry to archive?", [
    { text: "Cancel", style: "cancel" },
    {
      text: "Archive",
      onPress: async () => {
        await updateEntry.mutateAsync({ id: entryId, status: "archived" });
        await cancelCommitmentReminder(entryId);
        navigation.goBack();
      },
    },
  ]);
}, [entryId, updateEntry, cancelCommitmentReminder, navigation]);
```

- [ ] **Step 3: Wire foreground cleanup in CoachProScreen**

In `client/screens/CoachProScreen.tsx`, add imports:

```typescript
import { useEffect } from "react";
import { AppState } from "react-native";
import { useNotebookNotifications } from "@/hooks/useNotebookNotifications";
import { useNotebookEntries } from "@/hooks/useChat";
```

Inside the component, add after the existing hooks:

```typescript
const { cancelStaleReminders } = useNotebookNotifications();
const { data: notebookEntries = [] } = useNotebookEntries({ status: "active" });

useEffect(() => {
  const activeIds = notebookEntries
    .filter((e) => e.type === "commitment")
    .map((e) => e.id);
  cancelStaleReminders(activeIds);

  const sub = AppState.addEventListener("change", (state) => {
    if (state === "active") cancelStaleReminders(activeIds);
  });
  return () => sub.remove();
}, [notebookEntries, cancelStaleReminders]);
```

- [ ] **Step 4: Type-check**

```bash
npm run check:types
```

Expected: No errors. (If `SchedulableTriggerInputTypes` is not found, add `import * as Notifications from "expo-notifications"` and verify expo-notifications v55 exports it.)

- [ ] **Step 5: Run full test suite**

```bash
npm run test:run
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add client/hooks/useNotebookNotifications.ts client/screens/NotebookEntryScreen.tsx client/screens/CoachProScreen.tsx
git commit -m "feat: local push notifications for commitment reminders (C2)"
```

---

## Post-implementation checklist

- [ ] Run `npm run lint:fix` and fix any remaining issues
- [ ] Run `npm run test:coverage` — verify coverage hasn't dropped significantly
- [ ] Run `npm run check:types` — clean
- [ ] Start the app (`npm run server:dev` + `npx expo run:ios`) and manually verify each feature end-to-end:
  - [ ] B1: Type a message, get response, tap ↺ Regenerate — see fresh response, no duplicate user messages
  - [ ] B2: Trigger an `add_grocery_list` or `set_goal` action — see spinner → checkmark → reset
  - [ ] B3: Pin a conversation from thread bar — see pin icon, "See all" opens full list
  - [ ] B3: Search conversations in AllConversationsScreen
  - [ ] C1: Open Notebook from CoachProScreen → create, edit, archive entry
  - [ ] C2: Create a commitment with a future follow-up date → verify notification is scheduled
  - [ ] C4: Start typing in coach input — confirm warm-up fires (check server logs for `POST /api/coach/warm-up`)
- [ ] Final commit if lint fixes were needed
