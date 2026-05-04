# Coach — Data Integrity & Idempotency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 data integrity issues: assistant messages can be duplicated on client retry (no idempotency key), CommitmentCard acceptance is ephemeral state never persisted to the server, `saveRecipeFromChat` can create duplicate recipe rows on retry, and the response cache is written before the DB write.

**Architecture:** The assistant-message idempotency fix adds a `turnKey` column to `chatMessages` and a client-generated UUID on each send. The CommitmentCard fix adds a `POST /api/chat/commitments/:notebookEntryId/accept` route and wires the client callback. The recipe-from-chat fix adds an `onConflictDoNothing` keyed on `sourceMessageId`. The cache ordering fix moves the `fireAndForget` call after the DB write.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, Express.js 5, React Native

---

## File Map

| File                                                | Change                                                                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `shared/schema.ts`                                  | Add `turnKey` column to `chatMessages`; add unique partial index; add unique constraint on `communityRecipes.sourceMessageId` |
| `server/storage/chat.ts`                            | Update `createChatMessage` to accept and write `turnKey`; add `getChatMessageByTurnKey` lookup                                |
| `server/services/coach-pro-chat.ts`                 | Check `turnKey` before assistant write; move cache `fireAndForget` after DB write                                             |
| `server/routes/chat.ts`                             | Accept `turnKey` from request body                                                                                            |
| New: `server/routes/coach-commitments.ts`           | `POST /api/chat/commitments/:notebookEntryId/accept`                                                                          |
| `server/routes.ts`                                  | Register the new commitments route                                                                                            |
| `server/storage/recipe-from-chat.ts`                | Add `onConflictDoNothing` on `sourceMessageId`                                                                                |
| `client/hooks/useCoachStream.ts`                    | Generate and send `turnKey` per stream request                                                                                |
| `client/components/coach/CoachChat.tsx`             | Implement `handleCommitmentAccept`; track accepted IDs in `useRef<Set>`                                                       |
| `client/components/coach/blocks/CommitmentCard.tsx` | Accept `isAccepted` prop; controlled accepted state                                                                           |
| `shared/schemas/coach-blocks.ts`                    | Add `notebookEntryId` to CommitmentCard block schema                                                                          |

---

## Task 1: Add turnKey to chatMessages schema

**Files:**

- Modify: `shared/schema.ts`

- [ ] **Step 1: Add turnKey column and unique partial index to chatMessages**

In `shared/schema.ts`, find the `chatMessages` table. Add the `turnKey` column and index:

```typescript
// Add to chatMessages column definitions:
turnKey: text("turn_key"),

// Add to chatMessages index definitions (inside the second pgTable argument):
turnKeyUniqueIdx: uniqueIndex("chat_messages_turn_key_idx")
  .on(table.turnKey)
  .where(sql`${table.turnKey} IS NOT NULL`),
```

This ensures `onConflictDoNothing` keyed on `turnKey` will work, while NULL-keyed historical rows don't conflict with each other.

- [ ] **Step 2: Add unique constraint to communityRecipes.sourceMessageId**

Find the `communityRecipes` table in `shared/schema.ts`. Add a unique partial index:

```typescript
// In communityRecipes index definitions:
sourceMessageIdUniqueIdx: uniqueIndex("community_recipes_source_msg_idx")
  .on(table.sourceMessageId)
  .where(sql`${table.sourceMessageId} IS NOT NULL`),
```

If `sourceMessageId` column does not exist on `communityRecipes`, add it first:

```typescript
sourceMessageId: integer("source_message_id"),
```

- [ ] **Step 3: Push schema to database**

```bash
npm run db:push
```

Expected: Drizzle applies the new column and indexes without errors.

- [ ] **Step 4: Run tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add shared/schema.ts
git commit -m "feat: add turnKey to chatMessages and sourceMessageId unique index to communityRecipes"
```

---

## Task 2: Update createChatMessage to accept turnKey

**Files:**

- Modify: `server/storage/chat.ts`

- [ ] **Step 1: Update the createChatMessage function signature**

Find `createChatMessage` in `server/storage/chat.ts`. Add `turnKey` as an optional parameter:

```typescript
export async function createChatMessage(
  conversationId: number,
  userId: string,
  role: "user" | "assistant",
  content: string,
  metadata: Record<string, unknown> | null = null,
  turnKey?: string,
): Promise<ChatMessage> {
  const [message] = await db
    .insert(chatMessages)
    .values({
      conversationId,
      userId,
      role,
      content,
      metadata,
      ...(turnKey ? { turnKey } : {}),
    })
    .onConflictDoNothing({ target: chatMessages.turnKey })
    .returning();
  return message;
}
```

Note: `.onConflictDoNothing` with a target column returns `undefined` on conflict (Drizzle behaviour). The caller must handle `undefined`. Update the return type to `ChatMessage | undefined` and adjust all callers.

Actually, to keep the change minimal, check whether any caller needs the returned row. If no caller uses the returned `ChatMessage` from the assistant write, `undefined` on conflict is fine. If they do, use `.onConflictDoUpdate({ ... })` to return the existing row, or do a pre-check.

For simplicity, add a `getChatMessageByTurnKey` helper and use it in the assistant-write path:

```typescript
export async function getChatMessageByTurnKey(
  conversationId: number,
  turnKey: string,
): Promise<ChatMessage | undefined> {
  const [message] = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.conversationId, conversationId),
        eq(chatMessages.turnKey, turnKey),
      ),
    );
  return message;
}
```

- [ ] **Step 2: Run type check**

```bash
npm run check:types
```

Fix any callers that now receive `ChatMessage | undefined` where they expected `ChatMessage`.

- [ ] **Step 3: Run tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/storage/chat.ts
git commit -m "feat: add turnKey support to createChatMessage with conflict-skip"
```

---

## Task 3: Idempotency guard on assistant message write

**Files:**

- Modify: `server/services/coach-pro-chat.ts:545–575`
- Modify: `server/routes/chat.ts` (accept turnKey from body)

- [ ] **Step 1: Accept turnKey in the chat route request body**

In `server/routes/chat.ts`, find the Zod schema that validates the message POST body. Add `turnKey`:

```typescript
// In the message POST body schema:
turnKey: z.string().uuid().optional(),
```

Pass it through to `handleCoachChat`:

```typescript
for await (const event of handleCoachChat({
  conversationId: id,
  userId: req.userId,
  content: sanitizedContent,
  screenContext: parsed.data.screenContext,
  warmUpId: parsed.data.warmUpId,
  turnKey: parsed.data.turnKey,   // ← add
  ...
})) {
```

- [ ] **Step 2: Add turnKey to CoachChatParams**

In `server/services/coach-pro-chat.ts`, find the `CoachChatParams` interface and add:

```typescript
turnKey?: string;
```

Update `handleCoachChat` to destructure it from params.

- [ ] **Step 3: Add idempotency check before assistant write**

In `handleCoachChat` (around line 567), replace the plain `createChatMessage` call:

```typescript
// Before
if (fullResponse && !isAborted()) {
  await storage.createChatMessage(
    conversationId,
    userId,
    "assistant",
    textContent,
    blocks.length > 0 ? { blocks } : null,
  );
}
```

```typescript
// After
if (fullResponse && !isAborted()) {
  // Skip write if a message with this turnKey already exists (retry path)
  if (turnKey) {
    const existing = await storage.getChatMessageByTurnKey(
      conversationId,
      turnKey,
    );
    if (existing) {
      // Assistant message already persisted from a previous attempt — skip write
      log.info(
        { turnKey },
        "assistant message already persisted, skipping duplicate write",
      );
    } else {
      await storage.createChatMessage(
        conversationId,
        userId,
        "assistant",
        textContent,
        blocks.length > 0 ? { blocks } : null,
        turnKey,
      );
    }
  } else {
    await storage.createChatMessage(
      conversationId,
      userId,
      "assistant",
      textContent,
      blocks.length > 0 ? { blocks } : null,
    );
  }
}
```

- [ ] **Step 4: Move cache write after DB write**

Still in `handleCoachChat`, find the `fireAndForget` cache write (around line 545). Move it to AFTER the DB write block from step 3:

```typescript
// ... DB write block from step 3 ...

// Cache write after DB write (was fire-and-forget before the await — now correctly ordered)
if (questionHash && fullResponse && !isAborted()) {
  fireAndForget(
    "coach-cache-response",
    storage.setCoachCachedResponse(userId, questionHash, content, fullResponse),
  );
}
```

Delete the original cache write at line 545.

- [ ] **Step 5: Generate turnKey in useCoachStream**

In `client/hooks/useCoachStream.ts`, the `startStream` function sends the POST body. Generate a UUID per call:

```typescript
// At the top of startStream, generate a per-attempt key:
const turnKey = crypto.randomUUID();

// Add to the body:
const body: Record<string, unknown> = { content: userMessage, turnKey };
```

`crypto.randomUUID()` is available in React Native 0.73+ via the built-in `crypto` global. If not available, use a lightweight UUID library already in the project (check `package.json`).

- [ ] **Step 6: Run tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/services/coach-pro-chat.ts server/routes/chat.ts client/hooks/useCoachStream.ts
git commit -m "feat: add idempotency guard to assistant message write via turnKey"
```

---

## Task 4: Persist CommitmentCard acceptance server-side

**Files:**

- Modify: `shared/schemas/coach-blocks.ts`
- Create: `server/routes/coach-commitments.ts`
- Modify: `server/routes.ts`
- Modify: `client/components/coach/CoachChat.tsx`
- Modify: `client/components/coach/blocks/CommitmentCard.tsx`

- [ ] **Step 1: Add notebookEntryId to CommitmentCard block schema**

Find the `commitment_card` schema in `shared/schemas/coach-blocks.ts`. Add `notebookEntryId`:

```typescript
// Find the CommitmentCard schema and add:
notebookEntryId: z.number().optional(),
```

This field is populated server-side when extracting notebook entries and embedding them in blocks. Check `server/services/notebook-extraction.ts` — the extraction creates `commitment_card` blocks. Add the `notebookEntryId` from the stored notebook entry ID when building the block.

- [ ] **Step 2: Create the accept commitment route**

Create `server/routes/coach-commitments.ts`:

```typescript
import type { Express } from "express";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { sendError, handleRouteError, ErrorCode } from "../lib/errors";

export function registerCoachCommitmentsRoutes(app: Express): void {
  // POST /api/chat/commitments/:notebookEntryId/accept
  app.post(
    "/api/chat/commitments/:notebookEntryId/accept",
    requireAuth,
    async (req, res) => {
      try {
        const notebookEntryId = parseInt(req.params.notebookEntryId, 10);
        if (isNaN(notebookEntryId)) {
          return sendError(
            res,
            400,
            "Invalid notebookEntryId",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        // Verify the entry belongs to this user before updating
        const entry = await storage.getNotebookEntryById(
          notebookEntryId,
          req.userId,
        );
        if (!entry) {
          return sendError(
            res,
            404,
            "Commitment not found",
            ErrorCode.NOT_FOUND,
          );
        }

        await storage.updateNotebookEntryStatus(
          notebookEntryId,
          req.userId,
          "completed",
        );
        res.json({ ok: true });
      } catch (error) {
        handleRouteError(res, error, "accept commitment");
      }
    },
  );
}
```

- [ ] **Step 3: Add getNotebookEntryById and updateNotebookEntryStatus to storage**

In `server/storage/coach-notebook.ts`, add two functions:

```typescript
export async function getNotebookEntryById(
  id: number,
  userId: string,
): Promise<CoachNotebookEntry | undefined> {
  const [entry] = await db
    .select()
    .from(coachNotebook)
    .where(and(eq(coachNotebook.id, id), eq(coachNotebook.userId, userId)));
  return entry;
}

export async function updateNotebookEntryStatus(
  id: number,
  userId: string,
  status: "active" | "completed" | "expired" | "archived",
): Promise<void> {
  await db
    .update(coachNotebook)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(coachNotebook.id, id), eq(coachNotebook.userId, userId)));
}
```

Ensure these are exported from `server/storage/index.ts` (or wherever the storage barrel export is).

- [ ] **Step 4: Register the route**

In `server/routes.ts`, import and call the new registration function:

```typescript
import { registerCoachCommitmentsRoutes } from "./routes/coach-commitments";

// Inside the registration block:
registerCoachCommitmentsRoutes(app);
```

- [ ] **Step 5: Wire handleCommitmentAccept in CoachChat**

In `client/components/coach/CoachChat.tsx`:

1. Add accepted commitments ref near other refs:

```typescript
const acceptedCommitmentsRef = useRef<Set<number>>(new Set());
const [commitmentVersion, setCommitmentVersion] = useState(0);
```

2. Implement `handleCommitmentAccept`:

```typescript
const handleCommitmentAccept = useCallback(
  async (
    notebookEntryId: number | undefined,
    _title: string,
    _followUpDate: string,
  ) => {
    if (!notebookEntryId) return;
    acceptedCommitmentsRef.current = new Set([
      ...acceptedCommitmentsRef.current,
      notebookEntryId,
    ]);
    setCommitmentVersion((v) => v + 1); // trigger re-render

    try {
      await apiRequest(
        "POST",
        `/api/chat/commitments/${notebookEntryId}/accept`,
      );
    } catch {
      // Non-fatal — local state already updated
    }
  },
  [],
);
```

Import `apiRequest` from `@/lib/query-client` if not already imported.

3. Pass `isAccepted` when rendering `BlockRenderer` in the message row:

```typescript
{messageBlocks.get(msg.id)?.map((block, i) => (
  <BlockRenderer
    key={`${msg.id}-block-${i}`}
    block={block}
    onAction={handleBlockAction}
    onQuickReply={(message) => handleQuickReply(message, `${msg.id}-${i}`)}
    onCommitmentAccept={(notebookEntryId, title, followUpDate) =>
      handleCommitmentAccept(notebookEntryId, title, followUpDate)
    }
    isCommitmentAccepted={
      block.type === "commitment_card" && block.notebookEntryId !== undefined
        ? acceptedCommitmentsRef.current.has(block.notebookEntryId)
        : undefined
    }
  />
))}
```

Add `commitmentVersion` to `renderItem`'s dep array to trigger re-renders.

- [ ] **Step 6: Update CommitmentCard to accept isAccepted prop**

In `client/components/coach/blocks/CommitmentCard.tsx`, update the component to be controlled when `isAccepted` is provided:

```typescript
interface Props {
  block: CommitmentCardType;
  onAccept?: (notebookEntryId: number | undefined, title: string, followUpDate: string) => void;
  isAccepted?: boolean;
}

export default function CommitmentCard({ block, onAccept, isAccepted }: Props) {
  const { theme } = useTheme();
  const [localAccepted, setLocalAccepted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Use prop (controlled) when provided; fall back to local state
  const accepted = isAccepted ?? localAccepted;

  // ... rest of component, updating the Accept button press handler:
  onPress={() => {
    setLocalAccepted(true);
    onAccept?.(block.notebookEntryId, block.title, block.followUpDate);
  }}
```

Also update `BlockRenderer` to forward `isCommitmentAccepted` and the updated `onCommitmentAccept` signature.

- [ ] **Step 7: Run tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add shared/schemas/coach-blocks.ts \
        server/routes/coach-commitments.ts \
        server/routes.ts \
        server/storage/coach-notebook.ts \
        client/components/coach/CoachChat.tsx \
        client/components/coach/blocks/CommitmentCard.tsx \
        client/components/coach/blocks/index.tsx
git commit -m "feat: persist CommitmentCard acceptance server-side via new accept endpoint"
```

---

## Task 5: Fix saveRecipeFromChat duplicate on retry

**Files:**

- Modify: `server/storage/recipe-from-chat.ts:85–119`

- [ ] **Step 1: Add idempotency check before insert**

In `server/storage/recipe-from-chat.ts`, find the `saveRecipeFromChat` function. Before the `communityRecipes` insert, add:

```typescript
// Check for existing recipe created from the same message (idempotency)
if (sourceMessageId !== undefined && sourceMessageId !== null) {
  const [existing] = await db
    .select({ id: communityRecipes.id })
    .from(communityRecipes)
    .where(eq(communityRecipes.sourceMessageId, sourceMessageId));
  if (existing) {
    return existing.id;
  }
}
```

Where `sourceMessageId` is the parameter identifying which chat message triggered this recipe save. Check the existing function signature to confirm it receives this value; if not, add it as a parameter.

Alternatively, if `communityRecipes` now has the unique partial index from Task 1 (Step 2), use `onConflictDoNothing` instead of the pre-check:

```typescript
const [inserted] = await db
  .insert(communityRecipes)
  .values({ ..., sourceMessageId })
  .onConflictDoNothing({ target: communityRecipes.sourceMessageId })
  .returning({ id: communityRecipes.id });

if (!inserted) {
  // Conflict — recipe already exists for this message. Fetch and return the existing ID.
  const [existing] = await db
    .select({ id: communityRecipes.id })
    .from(communityRecipes)
    .where(eq(communityRecipes.sourceMessageId, sourceMessageId));
  return existing?.id;
}
```

- [ ] **Step 2: Run tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/storage/recipe-from-chat.ts
git commit -m "fix: make saveRecipeFromChat idempotent via sourceMessageId conflict guard"
```
