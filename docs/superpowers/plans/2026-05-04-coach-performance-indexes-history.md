# Coach — Performance, Indexes & History Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 missing database indexes (including a partial index that eliminates a full-table-scan on every cron tick), order notebook entries by recency before the 100-entry cap, extend history truncation to prune system and user messages, document a per-conversation message soft cap, and improve token estimation for CJK/emoji content.

**Architecture:** Schema changes (new indexes) are committed first, then applied with `db:push`. History truncation changes are pure functions — TDD applies cleanly. The notebook recency ordering is a one-line change to an existing query. The per-conversation cap is a documentation + warning-signal change only (no hard archival in this plan).

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL (pg_trgm extension), Vitest

---

## File Map

| File                                                 | Change                                                                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `shared/schema.ts`                                   | Add 3 indexes: partial commitment index, `(userId, status)` notebook index, GIN trigram on `chatConversations.title` |
| `server/lib/chat-history-truncate.ts`                | Fix `estimateTokens` for CJK/emoji; add phase 3 (system) and phase 4 (user) pruning; add over-budget warning         |
| `server/lib/__tests__/chat-history-truncate.test.ts` | Add tests for CJK estimation, system pruning, user pruning                                                           |
| `server/storage/coach-notebook.ts`                   | Add `ORDER BY updatedAt DESC` to `getActiveNotebookEntries` (already present — verify)                               |
| `docs/patterns/architecture.md`                      | Document per-conversation message soft cap pattern                                                                   |

---

## Task 1: Add the three missing database indexes

**Files:**

- Modify: `shared/schema.ts`

- [ ] **Step 1: Add partial index for getDueCommitmentsAllUsers**

In `shared/schema.ts`, find the `coachNotebook` table's index definitions (around line 1536). Add:

```typescript
// Partial index for the cross-user commitment scheduler query.
// getDueCommitmentsAllUsers filters on (type='commitment', status='active', followUpDate ≤ now)
// with no userId constraint, making all existing userId-leading indexes useless.
dueCommitmentsIdx: index("coach_notebook_due_commitments_idx")
  .on(table.followUpDate)
  .where(
    sql`${table.type} = 'commitment' AND ${table.status} = 'active'`,
  ),
```

- [ ] **Step 2: Add (userId, status) index for getActiveNotebookEntries**

In the same `coachNotebook` index block, add:

```typescript
userStatusIdx: index("coach_notebook_user_status_idx").on(
  table.userId,
  table.status,
),
```

- [ ] **Step 3: Add GIN trigram index on chatConversations.title**

Find the `chatConversations` table in `shared/schema.ts` (around line 918). Add to its index definitions:

```typescript
titleTrgmIdx: index("chat_conversations_title_trgm_idx")
  .using("gin", sql`${table.title} gin_trgm_ops`),
```

This follows the same pattern already used on `communityRecipes.title` (line 570). The `pg_trgm` extension is already enabled (verify by checking other trgm indexes in the schema).

- [ ] **Step 4: Push to database**

```bash
npm run db:push
```

Expected: 3 new indexes applied. No data changes.

- [ ] **Step 5: Run tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add shared/schema.ts
git commit -m "perf: add 3 missing indexes — commitment scheduler, notebook status, chat title trigram"
```

---

## Task 2: Verify notebook entry ordering

**Files:**

- Verify: `server/storage/coach-notebook.ts:26–32`

- [ ] **Step 1: Confirm orderBy is already present**

```bash
grep -n "orderBy\|updatedAt" server/storage/coach-notebook.ts | head -10
```

The `getActiveNotebookEntries` function should already have `.orderBy(desc(coachNotebook.updatedAt))`. This was confirmed during code review.

- [ ] **Step 2: If orderBy is missing, add it**

If the query is missing the order clause, add it:

```typescript
return db
  .select()
  .from(coachNotebook)
  .where(and(...conditions))
  .orderBy(desc(coachNotebook.updatedAt)) // most recent entries first
  .limit(100);
```

- [ ] **Step 3: Commit only if changed**

If no change was needed, skip this commit. If the orderBy was added:

```bash
git add server/storage/coach-notebook.ts
git commit -m "fix: order active notebook entries by recency before 100-entry cap"
```

---

## Task 3: Fix token estimation for CJK/emoji content

**Files:**

- Modify: `server/lib/chat-history-truncate.ts:21–34`
- Modify: `server/lib/__tests__/chat-history-truncate.test.ts`

- [ ] **Step 1: Write failing tests for CJK estimation**

In `server/lib/__tests__/chat-history-truncate.test.ts`, add:

```typescript
import { estimateTokens } from "../chat-history-truncate";

describe("estimateTokens", () => {
  it("estimates ASCII text at 4 chars per token", () => {
    const msg = { role: "user" as const, content: "hello world" }; // 11 chars → ceil(11/4) = 3
    expect(estimateTokens(msg)).toBe(3);
  });

  it("estimates CJK text at 1 char per token (Korean)", () => {
    // 한글 텍스트 = 6 Korean chars, each ≈ 1 token
    const msg = { role: "user" as const, content: "한글 텍스트" };
    // 4 Korean chars + 1 space + 3 Korean chars = 7 chars; CJK = 7 tokens
    expect(estimateTokens(msg)).toBeGreaterThanOrEqual(6);
    expect(estimateTokens(msg)).toBeLessThanOrEqual(8);
  });

  it("estimates emoji-heavy text more aggressively than 4 chars per token", () => {
    // Each emoji is typically 2 chars (surrogate pair) but 1–4 tokens
    const msg = { role: "user" as const, content: "🍎🍊🍋🍇" }; // 4 emoji × 2 chars = 8 chars
    // Pure 4-char estimate = 2 tokens; emoji-aware should be higher
    expect(estimateTokens(msg)).toBeGreaterThan(2);
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
npm run test:run -- server/lib/__tests__/chat-history-truncate.test.ts
```

Expected: CJK and emoji tests fail (current implementation uses flat 4 chars/token).

- [ ] **Step 3: Implement heuristic estimateTokens**

In `server/lib/chat-history-truncate.ts`, replace the `estimateTokens` function:

```typescript
/** Characters per token for ASCII/Latin text. */
const CHARS_PER_TOKEN_ASCII = 4;

/**
 * Estimate token count for a message using a heuristic that accounts for
 * CJK characters (≈1 char/token) and emoji (≈2 chars/token) to avoid
 * silent context-window overflow for non-ASCII conversations.
 */
export function estimateTokens(message: HistoryMessage): number {
  const text = message.content;
  let cjkChars = 0;
  let emojiChars = 0;

  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    // CJK Unified Ideographs, Hangul, Hiragana, Katakana ranges
    if (
      (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified
      (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Extension A
      (cp >= 0xac00 && cp <= 0xd7af) || // Hangul syllables
      (cp >= 0x3040 && cp <= 0x30ff) || // Hiragana + Katakana
      (cp >= 0xff00 && cp <= 0xffef) // Fullwidth/Halfwidth forms
    ) {
      cjkChars++;
    } else if (cp > 0xffff) {
      // Supplementary planes (most emoji live here)
      emojiChars++;
    }
  }

  const otherChars = text.length - cjkChars - emojiChars * 2; // emoji are 2 JS chars
  const cjkTokens = cjkChars; // 1 char ≈ 1 token
  const emojiTokens = emojiChars * 2; // 1 emoji ≈ 2 tokens
  const asciiTokens = Math.ceil(
    Math.max(otherChars, 0) / CHARS_PER_TOKEN_ASCII,
  );

  return Math.max(1, cjkTokens + emojiTokens + asciiTokens);
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test:run -- server/lib/__tests__/chat-history-truncate.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/lib/chat-history-truncate.ts server/lib/__tests__/chat-history-truncate.test.ts
git commit -m "fix: improve token estimation for CJK and emoji content in history truncation"
```

---

## Task 4: Extend history truncation to prune system and user messages

**Files:**

- Modify: `server/lib/chat-history-truncate.ts:51–95`
- Modify: `server/lib/__tests__/chat-history-truncate.test.ts`

- [ ] **Step 1: Write failing tests for system and user message pruning**

Add to `server/lib/__tests__/chat-history-truncate.test.ts`:

```typescript
describe("truncateHistoryToBudget", () => {
  // ... existing tests ...

  it("prunes system messages when tool and assistant pruning is insufficient", () => {
    // Budget: 5 tokens. System message alone is 10 tokens.
    const messages: HistoryMessage[] = [
      { role: "system", content: "a".repeat(40) }, // 40 chars ≈ 10 tokens
      { role: "user", content: "hi" }, // 2 chars ≈ 1 token
    ];
    const result = truncateHistoryToBudget(messages, 5);
    // System message should be pruned; most-recent user message preserved
    expect(result.find((m) => m.role === "system")).toBeUndefined();
    expect(result.find((m) => m.role === "user")).toBeDefined();
  });

  it("prunes old user messages when system pruning is still insufficient", () => {
    const messages: HistoryMessage[] = [
      { role: "user", content: "a".repeat(80) }, // old large user message, ~20 tokens
      { role: "user", content: "hi" }, // most-recent user message, ~1 token
    ];
    const result = truncateHistoryToBudget(messages, 3);
    // Old user message pruned; most-recent preserved
    const userMsgs = result.filter((m) => m.role === "user");
    expect(userMsgs.length).toBe(1);
    expect(userMsgs[0].content).toBe("hi");
  });

  it("always preserves the most-recent user message even when over budget", () => {
    const hugeUser = { role: "user" as const, content: "a".repeat(10000) }; // way over budget
    const result = truncateHistoryToBudget([hugeUser], 5);
    // Cannot prune the only user message
    expect(result).toContain(hugeUser);
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
npm run test:run -- server/lib/__tests__/chat-history-truncate.test.ts
```

Expected: system-prune and user-prune tests fail.

- [ ] **Step 3: Add phase 3 (system) and phase 4 (user) pruning**

In `server/lib/chat-history-truncate.ts`, after phase 2 (assistant pruning), add:

```typescript
// Phase 3 — prune system messages oldest-first (keep the most-recent system message).
let lastSystemIdx = -1;
for (let i = slots.length - 1; i >= 0; i--) {
  if (slots[i]?.role === "system") {
    lastSystemIdx = i;
    break;
  }
}
for (let i = 0; i < slots.length && remaining > tokenBudget; i++) {
  const msg = slots[i];
  if (msg !== null && msg.role === "system" && i !== lastSystemIdx) {
    remaining -= estimateTokens(msg);
    slots[i] = null;
  }
}

// Phase 4 — prune user messages oldest-first (always preserve the most-recent user message).
for (let i = 0; i < slots.length && remaining > tokenBudget; i++) {
  const msg = slots[i];
  if (msg !== null && msg.role === "user" && i !== lastUserIdx) {
    remaining -= estimateTokens(msg);
    slots[i] = null;
  }
}

// Dev/test warning if still over budget after all pruning phases
if (process.env.NODE_ENV !== "production" && remaining > tokenBudget) {
  console.warn(
    `[chat-history-truncate] History still over budget (${remaining} > ${tokenBudget}) ` +
      "after all pruning phases — most-recent user message exceeds budget alone.",
  );
}
```

Update the JSDoc:

```typescript
 * Pruning order (oldest-first within each tier):
 *   1. Tool result messages  (`role: "tool"`)
 *   2. Assistant messages    (`role: "assistant"`)
 *   3. System messages       (`role: "system"`, most-recent preserved)
 *   4. User messages         (`role: "user"`, most-recent always preserved)
```

- [ ] **Step 4: Run tests**

```bash
npm run test:run -- server/lib/__tests__/chat-history-truncate.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/lib/chat-history-truncate.ts server/lib/__tests__/chat-history-truncate.test.ts
git commit -m "fix: extend history truncation to prune system and user messages when over budget"
```

---

## Task 5: Document per-conversation message soft cap

**Files:**

- Modify: `docs/patterns/architecture.md`

- [ ] **Step 1: Add soft-cap documentation**

Open `docs/patterns/architecture.md` and add a new section:

```markdown
## Per-Conversation Message Depth

Chat conversations grow indefinitely — the daily message limit controls volume but not depth. Long-lived conversations stress history truncation and increase DB row counts over time.

**Soft cap:** 500 messages per conversation is the intended threshold. Above this, clients should surface a "Start a new conversation" prompt rather than continuing indefinitely.

**How to detect:** Add a `getConversationMessageCount(conversationId, userId)` call when fetching a conversation. If count > 500, include a `nearLimit: true` flag in the GET /api/chat/conversations/:id response. The client shows a banner: "This conversation is getting long. Starting a new one gives the Coach fresher context."

**Hard archival:** Out of scope for this plan. Triggered by a future scaling incident or user complaint, not pre-emptively.
```

- [ ] **Step 2: Implement the count warning in the GET conversation route**

In `server/routes/chat.ts`, find the `GET /api/chat/conversations/:id` handler. After fetching the conversation, add a message count check:

```typescript
const messageCount = await storage.getChatMessageCount(id, req.userId);
res.json({
  ...conversation,
  messageCount,
  nearLimit: messageCount > 500,
});
```

Add `getChatMessageCount` to `server/storage/chat.ts`:

```typescript
export async function getChatMessageCount(
  conversationId: number,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatMessages)
    .innerJoin(
      chatConversations,
      and(
        eq(chatMessages.conversationId, chatConversations.id),
        eq(chatConversations.userId, userId),
      ),
    )
    .where(eq(chatMessages.conversationId, conversationId));
  return row?.count ?? 0;
}
```

- [ ] **Step 3: Run tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add docs/patterns/architecture.md server/routes/chat.ts server/storage/chat.ts
git commit -m "docs: document per-conversation message soft cap; add count to conversation response"
```
