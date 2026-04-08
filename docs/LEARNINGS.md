# Learnings from Code Reviews

This document captures key learnings, gotchas, and architectural decisions discovered during code reviews and refactoring sessions.

## Table of Contents

- [React Effect Cleanup Must Read Timer Refs at Cleanup Time (2026-04-07)](#react-effect-cleanup-must-read-timer-refs-at-cleanup-time-2026-04-07)
- [OCR Regex Must Account for Prefix Lines Sharing Keywords (2026-04-07)](#ocr-regex-must-account-for-prefix-lines-sharing-keywords-2026-04-07)
- [OCR Character Corrections Must Be Context-Sensitive (2026-04-07)](#ocr-character-corrections-must-be-context-sensitive-2026-04-07)
- [Unsanitized AI Prompt Parameter That Looked Server-Generated (2026-04-02)](#unsanitized-ai-prompt-parameter-that-looked-server-generated-2026-04-02)
- [RN Modal Cannot Overlay React Navigation transparentModal (2026-04-01)](#rn-modal-cannot-overlay-react-navigation-transparentmodal-2026-04-01)
- [fetch ReadableStream Fails Inside RN Modal — Use XHR (2026-04-01)](#fetch-readablestream-fails-inside-rn-modal--use-xhr-2026-04-01)
- [Mass-Assignment via Partial&lt;User&gt; in Storage Update Functions (2026-04-01)](#mass-assignment-via-partialuser-in-storage-update-functions-2026-04-01)
- [Polymorphic FK with Discriminator Column — No DB-Level Constraint (2026-04-01)](#polymorphic-fk-with-discriminator-column--no-db-level-constraint-2026-04-01)
- [CHECK Constraint vs ON DELETE SET NULL Conflict (2026-03-29)](#check-constraint-vs-on-delete-set-null-conflict-2026-03-29)
- [Avoid Re-Querying After Insert — Build History In-Memory (2026-03-29)](#avoid-re-querying-after-insert--build-history-in-memory-2026-03-29)
- [PostgreSQL Session Timezone + Drizzle UTC Mismatch (2026-03-27)](#postgresql-session-timezone--drizzle-utc-mismatch-2026-03-27)
- [JWT Types in Shared Code Bundle Into React Native Client (2026-03-27)](#jwt-types-in-shared-code-bundle-into-react-native-client-2026-03-27)
- [Launch Readiness Audit — Security and Data Integrity Findings (2026-03-27)](#launch-readiness-audit--security-and-data-integrity-findings-2026-03-27)
- [Mixing Real and Mocked Implementations in vi.mock Storage Facade (2026-03-26)](#mixing-real-and-mocked-implementations-in-vimock-storage-facade-2026-03-26)
- [React.memo + Ref-Only Props = Component That Never Updates (2026-03-25)](#reactmemo--ref-only-props--component-that-never-updates-2026-03-25)
- [accessibilityViewIsModal Placement with Portal-Rendered BottomSheetModal (2026-03-25)](#accessibilityviewismodal-placement-with-portal-rendered-bottomsheetmodal-2026-03-25)
- [useCallback vs useMemo for Hook-Returned Components (2026-03-25)](#usecallback-vs-usememo-for-hook-returned-components-2026-03-25)
- [Read-Then-Write-Then-Check: Snapshot State Before Mutation (2026-03-25)](#read-then-write-then-check-snapshot-state-before-mutation-2026-03-25)
- [NetInfo isConnected: null on Cold Start Causes False Offline State (2026-03-24)](#netinfo-isconnected-null-on-cold-start-causes-false-offline-state-2026-03-24)
- [Screen Registration Order in React Navigation Native Stacks (2026-03-24)](#screen-registration-order-in-react-navigation-native-stacks-2026-03-24)
- [Drizzle sql Template Parameterizes Column Refs in Subqueries (2026-03-23)](#drizzle-sql-template-parameterizes-column-refs-in-subqueries-2026-03-23)
- [Fasting Timer Enhancements Review (2026-03-21)](#fasting-timer-enhancements-review-2026-03-21)
- [Quick Log Enhancements Review (2026-03-21)](#quick-log-enhancements-review-2026-03-21)
- [HomeScreen Redesign Simplicity Review (2026-03-19)](#homescreen-redesign-simplicity-review-2026-03-19)
- [Allergen Substitution Safety Findings (2026-03-18)](#allergen-substitution-safety-findings-2026-03-18)
- [Receipt-to-Meal-Plan Code Review Findings (2026-03-10)](#receipt-to-meal-plan-code-review-findings-2026-03-10)
- [PostgreSQL Decimal Aggregates Return Strings via Drizzle (2026-02-24)](#postgresql-decimal-aggregates-return-strings-via-drizzle-2026-02-24)
- [Phase 0-7 Code Review Learnings (2026-02-24)](#phase-0-7-code-review-learnings-2026-02-24)
- [Phase 8-11 Code Review Learnings (2026-02-24)](#phase-8-11-code-review-learnings-2026-02-24)
- [History Item Actions Learnings (2026-02-12)](#history-item-actions-learnings-2026-02-12)
- [Architecture Decisions](#architecture-decisions)
- [React Native / Expo Go Gotchas](#react-native--expo-go-gotchas)
- [Security Learnings](#security-learnings)
- [Simplification Principles](#simplification-principles)
- [Performance Learnings](#performance-learnings)
- [Caching Learnings](#caching-learnings)
- [Subscription & Payment Learnings](#subscription--payment-learnings)
- [Data Processing Gotchas](#data-processing-gotchas)
- [Testing & Tooling Learnings](#testing--tooling-learnings)
- [Database Migration Gotchas](#database-migration-gotchas)
- [TypeScript Safety Learnings](#typescript-safety-learnings)

---

## [2026-04-07] React Effect Cleanup Must Read Timer Refs at Cleanup Time

**Category:** React Native Gotcha

**Problem:** `useScanClassification` captured `navigationTimeoutRef.current` and `resetTimeoutRef.current` in local variables at effect setup time, then cleared those variables in the cleanup function. Since the refs were `null` at mount, the timeouts set later during barcode scanning were never cleaned up on unmount.

```typescript
// Bug: captures null at setup time
useEffect(() => {
  const navTimeout = navigationTimeoutRef.current; // null at mount
  return () => {
    if (navTimeout) clearTimeout(navTimeout); // always clearing null
  };
}, []);
```

**Root cause:** The React hooks lint rule `react-hooks/exhaustive-deps` warns about reading `.current` in cleanup. The original code followed the lint rule's suggestion (capture in a variable) — but that advice is for DOM refs, not timer IDs. Timer refs change asynchronously and must be read at cleanup time.

**Fix:** Read `.current` directly inside the cleanup function:

```typescript
useEffect(() => {
  return () => {
    if (navigationTimeoutRef.current)
      clearTimeout(navigationTimeoutRef.current);
    if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
  };
}, []);
```

**Rule:** For timer/timeout refs, always read `.current` inside the cleanup function, not at setup time. Suppress the `react-hooks/exhaustive-deps` warning with a comment explaining these are timer IDs, not DOM refs.

**Audit ref:** 2026-04-07-full-2 finding M13

---

## [2026-04-07] OCR Regex Must Account for Prefix Lines Sharing Keywords

**Category:** Data Integrity Gotcha

**Problem:** The nutrition OCR parser's calories regex `/calories\s+<?(\S+)/i` matched "Calories from Fat 90" before "Calories 250" on pre-2020 US nutrition labels. Since `String.match()` returns the first match, the actual calorie count was silently dropped (captured "from" → `parseFloat("from")` → `NaN` → `null`).

**Root cause:** Pre-2020 FDA-format labels include "Calories from Fat" as a separate line _before_ the main "Calories" line. The regex had no way to distinguish between them.

**Fix:** Negative lookahead: `/calories\s+(?!from\b)<?(\S+)/i`

**Rule:** When parsing structured text with line-by-line regex, check for real-world format variants where a keyword appears in multiple contexts. Negative lookaheads (`(?!...)`) can exclude false matches without rewriting the whole pattern. For nutrition labels specifically, always test with both pre-2020 and current FDA formats.

**Audit ref:** 2026-04-07-full-2 finding M2

---

## [2026-04-07] OCR Character Corrections Must Be Context-Sensitive

**Category:** Data Integrity Gotcha

**Problem:** The `fixOCRDigits` function replaced all uppercase `S` with `5` unconditionally (`/S/g`). While `O→0` and `l→1` are reliable OCR corrections, `S→5` has a much higher false-positive rate when applied to non-numeric contexts.

**Fix:** Narrowed to context-sensitive replacement: `/(?<=\d)S|S(?=\d)/g` — only replaces `S` when adjacent to a digit (e.g., "1S0" → "150" but "Sodium" stays "Sodium").

**Rule:** OCR character corrections should use lookahead/lookbehind assertions to limit replacement to plausible contexts. The confidence level of each correction varies:

- Very reliable: `O→0`, `l→1`, `|→1` (shape similarity is high)
- Context-dependent: `S→5` (only when adjacent to digits)
- Dangerous: Any correction that could apply to label text, not just numeric fields

**Audit ref:** 2026-04-07-full-2 finding L2

---

## [2026-04-02] Unsanitized AI Prompt Parameter That Looked Server-Generated

**Category:** Security Gotcha

**Problem:** The `refineAnalysis()` function in `photo-analysis.ts` accepts a `question` parameter that was interpolated directly into the OpenAI prompt without `sanitizeUserInput()`. The parameter name and call site made it look like a server-generated string (it's called "question" and passed from the route handler), but it actually originates from the client's POST body — the user types a follow-up question about a photo analysis.

**Root cause:** The existing AI sanitization pattern documents sanitizing "user profile fields" and "user messages," but `question` didn't fit either mental category. It looked like an internal parameter because it was destructured alongside server-side values like `analysisId` and `previousResult`. The pattern's audit checklist says "trace every variable back to its source," but in practice the indirection through route handler destructuring obscured the origin.

**Fix:** Added `sanitizeUserInput(question)` before prompt interpolation.

**Rule:** When auditing AI services, do not rely on parameter names or call-site context to determine if a value is user-controlled. Trace every string variable in the prompt template back to its ultimate origin (request body, query param, DB column populated by user input). If the chain touches user input at any point, sanitize it. The audit checklist in `docs/patterns/security.md` already says this — the lesson is that it's easy to miss in practice when the variable has a "safe-looking" name.

**Audit ref:** 2026-04-02-full M1

---

## [2026-04-01] RN Modal Cannot Overlay React Navigation transparentModal

**Problem:** An RN `Modal` component rendered from a context provider at the app root opens _behind_ a React Navigation `transparentModal` screen on iOS. The user taps a button inside the `transparentModal`, the `Modal` opens, but it's invisible underneath.

**Root cause:** iOS `presentViewController:` presents on the root view controller, but React Navigation's `transparentModal` creates a separate native view controller above it. The RN Modal cannot stack on top.

**Fix:** Register the overlay as a `fullScreenModal` screen in the RootStack navigator instead. Navigation screens stack correctly on top of each other regardless of presentation mode. Use `navigation.navigate("CoachChat", { ... })` instead of context-based overlay.

**Rule:** Never use RN `Modal` or absolute-positioned Views to overlay content on screens that are themselves React Navigation modals (`transparentModal`, `modal`, `formSheet`). Use a navigation screen instead.

---

## [2026-04-01] fetch ReadableStream Fails Inside RN Modal — Use XHR

**Problem:** SSE streaming via `fetch` + `res.body.getReader()` works in regular React Native screens but silently fails inside an RN `Modal`. The `ReadableStream` reader never delivers chunks — `isStreaming` stays true but `streamingContent` stays empty.

**Root cause:** React Native's `ReadableStream` implementation does not reliably deliver chunks in all native view contexts. The Modal creates a separate native view hierarchy that disrupts the streaming.

**Fix:** Use `XMLHttpRequest` with `onreadystatechange` and `readyState >= 3` (LOADING) for SSE parsing. XHR's progressive response text works reliably everywhere in RN, including inside Modals.

```typescript
xhr.onreadystatechange = () => {
  if (xhr.readyState >= 3 && xhr.responseText) {
    const newText = xhr.responseText.slice(lastProcessedIndex);
    lastProcessedIndex = xhr.responseText.length;
    // Parse SSE lines from newText
  }
};
```

**Rule:** For SSE streaming in React Native, prefer XHR over fetch+ReadableStream. XHR is universally reliable; ReadableStream is context-dependent.

---

## [2026-04-01] Mass-Assignment via Partial<User> in Storage Update Functions

**Category:** Security Post-Mortem

### Context

The `updateUser()` storage function accepted `Partial<User>` — the full User type includes `password`, `role`, `tokenVersion`, `subscriptionTier`, `username`, and `createdAt`. Routes that called `updateUser()` passed Zod-validated input, so the route-level defense was sound. But the storage function signature itself imposed no restriction.

### Problem

`Partial<User>` is a TypeScript denylist-by-absence: every field on the `User` type is accepted. If a future route or code path passed unsanitized input to `updateUser()`, an attacker could escalate privileges (set `role`), hijack accounts (overwrite `password`), or bypass subscription checks (set `subscriptionTier: "premium"`). Drizzle's `.set()` applies whatever it receives — there is no ORM-level field filtering.

This is the classic mass-assignment vulnerability, adapted to the TypeScript/Drizzle stack where it looks deceptively type-safe because `Partial<User>` _is_ a real type. The danger is that TypeScript types don't distinguish "fields the user should control" from "fields the system should control."

### Solution

Replaced `Partial<User>` with `Partial<UpdatableUserFields>` where `UpdatableUserFields` is defined as `Pick<User, 'displayName' | 'avatarUrl' | ...>` — an explicit allowlist of fields callers may set. Sensitive columns (`password`, `role`, `tokenVersion`, `subscriptionTier`, `username`, `createdAt`) are excluded.

Used `Pick<>` (allowlist) instead of `Omit<>` (denylist) so that new columns added to the schema are excluded by default — the developer must explicitly opt them into the whitelist.

### Outcome

- TypeScript compiler now rejects `updateUser(id, { role: 'admin' })` at build time
- Sensitive fields can only be modified through dedicated storage functions (`incrementTokenVersion`, `changePassword`, receipt validation flow)
- Defense-in-depth: even if a route skips Zod validation, the storage layer prevents privilege escalation

### Takeaways

- **`Partial<T>` on a full table row type is a mass-assignment vector.** Treat it the same as accepting raw `req.body` — always narrow the type to only the fields the caller should control.
- **Use `Pick<>` (allowlist), not `Omit<>` (denylist).** Denylists fail open when new columns are added to the schema; allowlists fail closed.
- **Route-level Zod ≠ storage-level safety.** Both layers should independently reject sensitive field mutations. A Zod schema protects one route; a `Pick<>` type protects all callers.
- **Audit all `Partial<TableRow>` signatures in the storage layer.** If a function takes `Partial<InsertUserProfile>`, verify that the insert schema already omits sensitive fields, or add a `Pick<>`.

### References

- Fixed in: `server/storage/users.ts` — `UpdatableUserFields` type, `updateUser()`
- Related pattern: "Mass-Assignment Protection: Whitelist Updatable Fields" in `docs/patterns/security.md`
- OWASP reference: [Mass Assignment](https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/)

---

## [2026-04-01] Polymorphic FK with Discriminator Column — No DB-Level Constraint

**Category:** Decision (Architecture)

### Context

The `cookbookRecipes` junction table stores recipes from two different parent tables: `mealPlanRecipes` (user-generated meal plan recipes) and `communityRecipes` (shared/community recipes). A `recipeType` discriminator column (`'mealPlan'` or `'community'`) indicates which parent table the `recipeId` references.

### Problem

During a storage-layer audit, this was flagged as a potential data integrity issue because `recipeId` has no database-level foreign key constraint — an orphaned reference could exist if a parent recipe is deleted without cleaning up the junction rows.

PostgreSQL cannot enforce conditional foreign keys ("FK to table A when column X = 'a', FK to table B when column X = 'b'"). This is a known limitation of relational databases for polymorphic associations.

### Investigation

Evaluated three approaches:

1. **Separate FK columns** (`mealPlanRecipeId` + `communityRecipeId`, one nullable) with a CHECK constraint. This is the "mutually-optional FK" pattern already used in `dailyLogs`. Rejected because the cookbook recipes table would need a third discriminator anyway for display logic, and nullable FK pairs add query complexity.

2. **Single `recipeId` + `recipeType` discriminator** (current approach). No DB-level FK, but app code handles cleanup. Simple schema, simple queries, discriminator serves double duty (query filter + display hint).

3. **Shared `recipes` parent table** that both meal plan and community recipes extend. Would allow a single FK. Rejected as a major schema refactor with cascading changes across 20+ routes and storage functions.

### Solution

Kept the discriminator pattern (option 2) with these mitigations already in place:

- **Transactional cleanup:** When a `mealPlanRecipe` or `communityRecipe` is deleted, `cookbookRecipes` rows referencing it are deleted in the same transaction
- **Query-time filtering:** Cookbook recipe fetches use `LEFT JOIN` and filter out rows where the joined parent is `NULL` (orphan resilience)
- **Unique constraint:** `(cookbookId, recipeId, recipeType)` prevents duplicate additions

Reclassified the audit finding as a **false positive** — the lack of a DB-level FK is a deliberate trade-off, not an oversight.

### Outcome

No code changes needed. The finding validated that the existing mitigations are sufficient.

### Takeaways

- **Polymorphic FKs with a discriminator column are a valid pattern when the alternative (separate nullable FK columns or shared parent table) adds disproportionate complexity.** Document the decision so future auditors don't re-flag it.
- **Mitigations for missing FK constraints:** (1) transactional cleanup on parent delete, (2) query-time orphan filtering via LEFT JOIN + NULL check, (3) unique constraints to prevent duplicates.
- **The existing "CHECK Constraint for Mutually-Optional FK Pairs" pattern** (in `docs/patterns/database.md`) covers the _two nullable FK columns_ variant. The discriminator column variant is a separate approach suited for 3+ parent tables or when the discriminator serves additional purposes.
- **When an audit flags a known trade-off, document the rationale once** rather than deferring. Future audits will check LEARNINGS.md before re-flagging.

### References

- Schema: `shared/schema.ts` — `cookbookRecipes` table
- Cleanup: `server/storage/cookbooks.ts` — transactional delete on recipe removal
- Related: `docs/patterns/database.md` — "CHECK Constraint for Mutually-Optional FK Pairs" (alternative approach)
- Plan doc: `docs/plans/archived/2026-03-08-feat-cookbook-feature-homepage-redesign-plan.md`

---

## [2026-03-29] CHECK Constraint vs ON DELETE SET NULL Conflict

**Category:** Gotcha

### Context

Tables `dailyLogs` and `mealPlanItems` use a CHECK constraint requiring at least one of two nullable FK columns to be non-null (e.g., `CHECK(scannedItemId IS NOT NULL OR mealPlanRecipeId IS NOT NULL)`). The FK columns also had `ON DELETE SET NULL` referential actions.

### Problem

When the referenced parent row is deleted, PostgreSQL fires `ON DELETE SET NULL` first, setting the FK column to `NULL`. Then the CHECK constraint evaluates and rejects the mutation because both columns are now `NULL`. This means deleting a parent row (e.g., a meal plan recipe or scanned item) fails with a CHECK violation -- which also blocks user account deletion (GDPR concern) if the cascade chain passes through these tables.

The conflict is non-obvious because SET NULL and CHECK are evaluated at different stages of the same statement, and neither the FK definition nor the CHECK constraint is wrong in isolation.

### Solution

Changed the affected FK columns from `ON DELETE SET NULL` to `ON DELETE CASCADE`. When the parent is deleted, the child row is removed entirely rather than having its FK nulled, so the CHECK constraint is never violated.

### Takeaways

- When a table has a CHECK constraint involving nullable FK columns, `ON DELETE SET NULL` on those FKs can conflict with the CHECK. Prefer `ON DELETE CASCADE` or `ON DELETE RESTRICT` instead.
- Always trace the full cascade chain when adding CHECK constraints to tables with FKs -- test what happens when each referenced parent is deleted.
- This class of bug is invisible in normal CRUD testing; it only surfaces when a parent row is deleted while child rows reference it.

**Audit ref:** 2026-03-29-full H3, H4

---

## [2026-03-29] Avoid Re-Querying After Insert -- Build History In-Memory

**Category:** Performance Gotcha

### Context

The verification submit route needed the full verification history (including the just-inserted row) to detect reformulations. The original code called `getVerificationHistory()` twice: once before the insert (for pre-checks) and once after (to include the new row).

### Problem

The second query is redundant -- the only difference is the row that was just inserted, which the route already has in memory. This wastes a DB round-trip and doubles the query load for every verification submission.

### Solution

Construct the full history in-memory by prepending the newly inserted row to the first query's result:

```typescript
// Before: two DB queries
const historyBefore = await storage.getVerificationHistory(barcode);
await storage.insertVerification(newEntry);
const historyAfter = await storage.getVerificationHistory(barcode); // redundant!

// After: one DB query + in-memory construction
const historyBefore = await storage.getVerificationHistory(barcode);
const inserted = await storage.insertVerification(newEntry);
const fullHistory = [inserted, ...historyBefore];
```

### Takeaways

- When you need "all rows including the one I just inserted", build the result in-memory from the pre-insert query + the returned insert row. Don't re-query.
- This pattern applies any time a route reads, writes, then reads again with the only difference being the written row. The insert's RETURNING clause gives you the new row for free.

**Audit ref:** 2026-03-29-full M10

---

## [2026-03-27] PostgreSQL Session Timezone + Drizzle UTC Mismatch

**Category:** Gotcha

### Context

Drizzle ORM interprets `timestamp` (without timezone) columns as UTC: it appends `+0000` when reading values and sends `toISOString()` (which is UTC) when writing. This means Drizzle assumes all timestamp values in the database are UTC.

### Problem

PostgreSQL's `CURRENT_TIMESTAMP` and `now()` use the **session timezone** to produce values for `timestamp` columns. If the PostgreSQL server or the connection's session timezone is set to a non-UTC zone (e.g., `America/Toronto`), then `CURRENT_TIMESTAMP` default values will be written in local time while Drizzle reads them as UTC. This causes day-boundary queries (`getDayBounds`, `getDailyLogs`) to return wrong results: items logged at 11 PM Eastern would appear as the next UTC day.

The same issue affected `getDayBounds()` and `getMonthBounds()` helpers, which used `setHours()` (local time) instead of `setUTCHours()`. Tests passed because CI and most dev machines are in UTC, but they would fail on any machine in a non-UTC timezone.

### Solution

Two changes:

1. Force the PostgreSQL session timezone to UTC at the connection pool level:

```typescript
// server/db.ts
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: "-c timezone=UTC",
});
```

2. Convert all date helpers from local-time methods to UTC methods:

```typescript
// server/storage/helpers.ts
startOfDay.setUTCHours(0, 0, 0, 0); // was: setHours(0, 0, 0, 0)
endOfDay.setUTCHours(23, 59, 59, 999); // was: setHours(23, 59, 59, 999)
```

### Takeaways

- When using Drizzle ORM with `timestamp` (not `timestamptz`), the PostgreSQL session timezone **must** be UTC — Drizzle silently assumes this
- Use `setUTCHours`/`getUTCDate`/`Date.UTC()` everywhere in server code that computes date boundaries — `setHours()` uses the runtime's local timezone
- Tests in UTC-timezone CI environments will not catch this bug — test with `TZ=America/New_York` if timezone correctness matters
- The `options: "-c timezone=UTC"` approach sets the timezone per-connection in the pool, so it works even when the PostgreSQL server default is different

### References

- `server/db.ts` — `options: "-c timezone=UTC"` on Pool constructor
- `server/storage/helpers.ts` — `getDayBounds()`, `getMonthBounds()` now use UTC methods
- `server/storage/__tests__/helpers.test.ts` — tests updated to use UTC assertions

---

## [2026-03-27] JWT Types in Shared Code Bundle Into React Native Client

**Category:** Gotcha

### Context

The `AccessTokenPayload` interface and `isAccessTokenPayload` type guard were defined in `shared/types/auth.ts`. This file imported from the `jsonwebtoken` package to extend `JwtPayload`.

### Problem

Because `shared/` is aliased as `@shared/` and used by both the server and client, the Metro bundler followed the import chain: `shared/types/auth.ts` -> `jsonwebtoken` -> Node.js `crypto` module. This pulled the entire `jsonwebtoken` package (and its Node.js dependencies) into the React Native client bundle. While it did not crash at runtime (Metro can polyfill or stub some Node modules), it increased bundle size unnecessarily and created a confusing dependency graph.

### Solution

Moved the JWT-specific types and type guard to `server/lib/jwt-types.ts` (server-only). The `shared/types/auth.ts` file was cleaned to only export types that both client and server genuinely need (e.g., `AuthResponse`, `LoginInput`), with no `jsonwebtoken` dependency.

### Takeaways

- Files in `shared/` must never import server-only packages (`jsonwebtoken`, `bcrypt`, `pg`, etc.) — Metro will try to bundle them
- When a type extends a library-specific base type (like `JwtPayload`), that type belongs in the server, not in shared
- Watch for transitive dependencies: a single `import type` that also pulls in a runtime `import` can cascade

### References

- `server/lib/jwt-types.ts` — new home for `AccessTokenPayload` and `isAccessTokenPayload`
- `shared/types/auth.ts` — cleaned of `jsonwebtoken` dependency
- `server/middleware/auth.ts` — updated import path

---

## [2026-03-27] Launch Readiness Audit — Security and Data Integrity Findings

**Category:** Security, Data Integrity, Infrastructure

### Context

A 6-commit launch readiness audit reviewed the full server codebase for production-readiness issues. The audit covered security hardening, data integrity gaps, infrastructure reliability, and accessibility.

### Key Findings

**bcrypt cost factor was 10, now 12:**
The original `bcrypt.hash(password, 10)` used a cost factor of 10 (the minimum acceptable). Increased to 12 to stay ahead of hardware advances. Cost 12 takes ~250ms per hash — acceptable for login/register (not called in hot paths). This is a one-line change but easy to forget when copying auth code from tutorials (which universally use 10).

**CORS allowed dev tunnel origins in production:**
`localtunnel` and `ngrok` regex patterns were unconditionally included in `ALLOWED_ORIGIN_PATTERNS`. An attacker could register `*.loca.lt` or `*.ngrok.io` subdomains to bypass CORS. Fixed by conditionally including these patterns only when `NODE_ENV !== "production"`.

**Subscription purchase was two non-atomic writes:**
`createTransaction()` followed by `updateSubscription()` meant a crash between the two calls would record a payment but never upgrade the user. Merged into `createTransactionAndUpgrade()` wrapping both in `db.transaction()` with a null guard on the user update.

**`createSavedItem()` had a TOCTOU race:**
The count check and insert were separate DB calls. Two concurrent requests could both pass the count check and both insert, exceeding the tier limit. Wrapped in `db.transaction()` so the second request sees the first's insert. See the new pattern in `docs/patterns/database.md`.

**Reorder endpoint used N sequential UPDATEs:**
`reorderMealPlanItems()` ran one `UPDATE` per item inside a transaction — O(N) round-trips. Replaced with a single `UPDATE ... SET sortOrder = CASE WHEN ...` expression. See the new pattern in `docs/patterns/database.md`.

**Chat message + conversation timestamp were not atomic:**
`createChatMessage()` inserted the message then updated `chatConversations.updatedAt` in a separate query. A failure between the two would leave the conversation timestamp stale. Wrapped in `db.transaction()`.

**Rate limiter failed open on DB error:**
The API key rate limiter caught DB errors and called `next()`, letting the request through. Changed to return 503. See the new pattern in `docs/patterns/security.md`.

**No health check endpoint:**
Added `GET /api/health` with a DB ping (`SELECT 1`). Returns `{ status: "ok" }` or 503 with `{ status: "unhealthy" }`. Registered before routes for fast response without auth middleware.

**No graceful shutdown:**
`SIGTERM` from Docker/Kubernetes would kill in-flight requests. Added shutdown handler: clear intervals -> server.close -> pool.end -> exit. See the new pattern in `docs/patterns/api.md`.

**Response logs included tokens and medical data:**
The request logger captured and logged full response JSON, including JWT tokens from login/register and medication names from health endpoints. Added `SENSITIVE_PATHS` exclusion list.

**5xx errors leaked internal details:**
The global error handler returned the raw error message for all status codes, including 500s. Messages like `"relation \"users\" does not exist"` reveal database technology. Changed to return generic `"Internal Server Error"` for 5xx while preserving error messages for 4xx.

### Takeaways

- Audit storage methods for TOCTOU patterns — any "count then insert" or "check then act" should be in a transaction
- Rate limiters should fail closed (503), not fail open — an attacker who can trigger a DB error bypasses all limits
- Dev-only CORS origins must be gated on `NODE_ENV` — wildcard regex patterns are especially dangerous
- Payment flows must be atomic — a crash between "record payment" and "grant access" loses money
- Response logging needs an exclusion list from day one — tokens and medical data should never appear in log aggregators

### References

- Commits: `cb1fc6a` through `03f0485` (6 commits)
- New patterns added: `docs/patterns/database.md` (TOCTOU, CASE/WHEN batch, CHECK constraint), `docs/patterns/api.md` (env validation, AI guard, graceful shutdown), `docs/patterns/security.md` (fail-closed, sensitive logging, generic 5xx), `docs/patterns/client-state.md` (smart retry)

---

## [2026-03-26] Mixing Real and Mocked Implementations in vi.mock Storage Facade

**Category:** Gotcha

### Context

During the session store extraction (`server/storage/sessions.ts`), route tests that mock the storage facade needed to handle a mix of DB-backed functions (which should be mocked) and in-memory session functions (which should use real implementations).

### Problem

The naive approach of mocking all storage functions with `vi.fn()` means you must manually re-implement session lifecycle logic in mock return values. This is fragile, diverges from production behavior, and breaks when the real implementation changes.

### Solution

Use `vi.mock`'s async factory to dynamically import the real module and mix its exports with mocked functions:

```typescript
vi.mock("../../storage", async () => {
  const sessions = await import("../../storage/sessions");
  return {
    storage: {
      // DB-backed functions — mock
      getSubscriptionStatus: vi.fn(),
      getDailyScanCount: vi.fn(),
      // In-memory functions — use real implementation
      canCreateAnalysisSession: sessions.canCreateAnalysisSession,
      createAnalysisSession: sessions.createAnalysisSession,
      getAnalysisSession: sessions.getAnalysisSession,
      clearAnalysisSession: sessions.clearAnalysisSession,
    },
  };
});
```

**Key detail:** The factory must be `async` because `vi.mock` hoists to the top of the file, so you cannot use static imports — `await import()` is required.

### Takeaways

- When the storage facade mixes DB and in-memory modules, don't mock everything — pass through the real in-memory functions
- The `async () => { const mod = await import(...) }` pattern inside `vi.mock` is the way to reference real implementations
- Clear in-memory state in `beforeEach` (including `clearTimeout` on any timer Maps) to prevent cross-test pollution

### References

- `server/routes/__tests__/photos.test.ts` — analysis session mock wiring
- `server/routes/__tests__/verification.test.ts` — label session mock wiring
- Related pattern: `docs/patterns/testing.md` "Test Internals Export Pattern"

---

## [2026-03-25] React.memo + Ref-Only Props = Component That Never Updates

**Category:** Gotcha

### Context

Building a `useConfirmationModal()` hook that returns a `ConfirmationModal` component. The inner component receives options via a ref (for stable identity) and was wrapped in `React.memo` for performance.

### Problem

When `React.memo` wraps a component whose props are all refs (stable object references), shallow comparison sees no change on any re-render. The component never updates, even when the ref's `.current` value has changed. The confirmation dialog showed stale title/message from the previous `confirm()` call.

### Solution

Removed `React.memo` from the inner component. Instead, the hook uses a `revision` counter state that increments on each `confirm()` call, which the parent component passes as a prop to force re-renders.

```typescript
// ❌ React.memo blocks all re-renders — refs never change identity
const ConfirmationModalInner = React.memo(function Inner({
  optionsRef,
  sheetRef,
}) {
  // optionsRef.current changed, but optionsRef identity didn't → memo blocks render
});

// ✅ No memo — revision counter drives re-renders
function ConfirmationModalInner({ optionsRef, sheetRef, revision }) {
  // revision changes on each confirm() → component re-renders → reads fresh ref
}
```

### Takeaways

- `React.memo` does shallow comparison of props. Refs are stable by design — they never trigger re-renders through memo.
- When using refs for data that changes, you need an external mechanism (counter, state) to trigger re-renders.
- This is the inverse of the common "use refs to avoid re-renders" pattern — here we actually want re-renders but refs prevent them.

### References

- `client/hooks/useConfirmationModal.ts`
- Related pattern: "Hook-Returned Component Pattern for BottomSheetModal" in `docs/patterns/hooks.md`

---

## [2026-03-25] accessibilityViewIsModal Placement with Portal-Rendered BottomSheetModal

**Category:** Gotcha

### Context

Migrating destructive confirmation dialogs from `Alert.alert()` to a `ConfirmationModal` component using `@gorhom/bottom-sheet`'s `BottomSheetModal`. Some screens already had `accessibilityViewIsModal={true}` on their main container for other modals.

### Problem

`BottomSheetModal` renders via a React Native portal — its DOM node lives outside the normal component tree. When a screen's main container has `accessibilityViewIsModal={true}` and the `<ConfirmationModal />` is placed as a sibling outside that container, VoiceOver cannot reach the bottom sheet because `accessibilityViewIsModal` tells VoiceOver to ignore everything outside the container.

### Solution

Place the `<ConfirmationModal />` component **inside** the `accessibilityViewIsModal` container, not as a sibling. Even though `BottomSheetModal` portals its content elsewhere in the native view hierarchy, the React tree placement determines the accessibility tree relationship.

```typescript
// ❌ BAD — ConfirmationModal is a sibling, VoiceOver can't reach it
<View accessibilityViewIsModal>
  {/* screen content */}
</View>
<ConfirmationModal />

// ✅ GOOD — inside the modal container
<View accessibilityViewIsModal>
  {/* screen content */}
  <ConfirmationModal />
</View>
```

### Takeaways

- Portal-rendered components still respect their React tree position for accessibility purposes.
- Always test VoiceOver after adding `accessibilityViewIsModal` — it can silently hide portaled content.
- The "Modal Focus Trapping" pattern in `docs/patterns/react-native.md` has been updated with this portal caveat.

### References

- `client/hooks/useConfirmationModal.ts`
- Updated pattern: "Modal Focus Trapping" in `docs/patterns/react-native.md`

---

## [2026-03-25] useCallback vs useMemo for Hook-Returned Components

**Category:** Gotcha

### Context

The `useConfirmationModal()` hook needed to return a stable `ConfirmationModal` component. The initial implementation used `useCallback` to create the component function.

### Problem

`useCallback` returns a new function reference when its dependencies change. When the callback depended on `options` state (which changes on every `confirm()` call), React received a new component type on each call. React treats a new function reference as a new component type, unmounting the old instance and mounting a new one — losing all internal state including the `BottomSheetModal`'s presented state.

### Solution

Switched to `useMemo(() => function StableModal() { ... }, [revision])` where `revision` is a counter that only changes when `confirm()` is called. The options are stored in a ref (stable identity) and read inside the component, so the `useMemo` dependencies are minimal.

```typescript
// ❌ useCallback — new identity on every options change → remount
const ConfirmationModal = useCallback(() => {
  return <ConfirmationModalInner options={options} />;
}, [options]); // options changes every confirm() → new component identity

// ✅ useMemo — stable identity, ref for changing data
const ConfirmationModal = useMemo(
  () => function StableConfirmationModal() {
    return <ConfirmationModalInner optionsRef={optionsRef} revision={revision} />;
  },
  [revision],
);
```

### Takeaways

- `useCallback` and `useMemo` are both valid for creating functions, but for hook-returned components the distinction matters: React uses function identity to determine if a component type changed.
- When a hook returns a component, minimize the `useMemo` dependency array. Move changing data into refs and use a counter to signal when the component should re-read the ref.
- Named function expressions inside `useMemo` (`function StableModal() {}`) give better React DevTools names than anonymous arrows.

### References

- `client/hooks/useConfirmationModal.ts`
- Related pattern: "Hook-Returned Component Pattern for BottomSheetModal" in `docs/patterns/hooks.md`

---

## [2026-03-25] Read-Then-Write-Then-Check: Snapshot State Before Mutation

**Category:** Race Condition / Gotcha

### Context

The product reformulation detection feature needed to compare a barcode's nutritional data before and after a new verification submission. The detection logic checks whether the new submission diverges significantly from the existing consensus.

### Problem

The original implementation called `submitVerification()` (which mutated the DB row), then read the verification row back to compare with the new data. Since the row was already updated, the "before" and "after" values were identical, and the detection logic never triggered.

```typescript
// ❌ BAD: Reads post-mutation state — detection never fires
await submitVerification(barcode, data);
const current = await getVerification(barcode); // Already mutated!
const flags = detectReformulation(current, data); // current === data → no flags
```

### Solution

Snapshot the pre-mutation state BEFORE calling the mutating function:

```typescript
// ✅ GOOD: Snapshot before mutation
const preSubmitState = await getVerification(barcode); // Read BEFORE write
await submitVerification(barcode, data); // Mutates the row
const flags = detectReformulation(preSubmitState, data); // Compares old vs new
```

### Takeaways

- When a route handler needs to detect changes caused by its own mutation, **always read state before the write**. The variable naming convention `preSubmitX` or `snapshotX` signals this intent.
- This is distinct from optimistic locking (which prevents concurrent writes). Here, the goal is to compare previous and new values within a single request.
- The bug is invisible in happy-path testing because the detection simply produces zero flags — there is no error, no crash, just silent no-ops. Only a test that asserts "flag WAS created" would catch it.

### References

- `server/routes/verification.ts` — `preSubmitVerification` snapshot before `submitVerification()` call
- `server/services/reformulation-detection.ts` — pure detection logic that receives the snapshot

## [2026-03-24] NetInfo isConnected: null on Cold Start Causes False Offline State

**Category:** Gotcha

### Context

Implementing an offline state indicator using `@react-native-community/netinfo`. The `useNetworkStatus` hook subscribes to NetInfo's `addEventListener` callback and derives an `isOffline` boolean.

### Problem

On app cold start, the offline banner briefly flashed even when the device had connectivity. Users saw a "You're offline" banner for ~200ms before it disappeared.

### Investigation

NetInfo's initial callback fires with `isConnected: null` (not `false`) while it determines actual connectivity. The original check used a truthy/falsy pattern:

```typescript
// ❌ BAD: null is falsy, so !(null && ...) evaluates to true → "offline"
const isOffline = !(state.isConnected && state.isInternetReachable);
```

Since `null` is falsy in JavaScript, `!(null && ...)` evaluates to `true`, incorrectly signaling offline status before NetInfo has determined the actual state.

### Solution

Use explicit `=== false` checks to distinguish "unknown" (`null`) from "confirmed offline" (`false`):

```typescript
// ✅ GOOD: Only report offline when explicitly confirmed
const isOffline =
  state.isConnected === false || state.isInternetReachable === false;
```

This treats `null` (unknown) as "not yet determined" rather than "offline," preventing the false banner flash.

### Takeaways

- NetInfo's `isConnected` and `isInternetReachable` are `boolean | null`, not just `boolean` — always handle the `null` (indeterminate) state explicitly
- Truthy/falsy checks on nullable booleans are a common source of false positives — prefer `=== false` when the "unknown" state should be treated as "not triggered"
- Write a test for the `isConnected: null` initial state to catch regressions

### References

- `client/hooks/useNetworkStatus.ts` — explicit `=== false` checks
- `@react-native-community/netinfo` `NetInfoState` type definition

## [2026-03-24] Screen Registration Order in React Navigation Native Stacks

**Category:** Gotcha

### Context

Implementing the cookbook browsing feature with a `CookbookList` screen and a `CookbookCreate` screen in the same native stack navigator. The user flow is: List → tap "Create" button → Create screen.

### Problem

Navigating from `CookbookList` to `CookbookCreate` appeared to pop backwards instead of pushing forward — the Create screen had no back button, and the transition animation played in reverse. The Create screen was functionally correct but felt broken.

### Investigation

The issue was the order of `<Stack.Screen>` registration in the navigator. `CookbookCreate` was registered **before** `CookbookList`:

```typescript
// ❌ BAD: Create registered before List
<Stack.Screen name="CookbookCreate" component={CookbookCreateScreen} />
<Stack.Screen name="CookbookList" component={CookbookListScreen} />
```

React Navigation's native stack uses screen registration order to determine the "depth" of each screen. When `navigation.navigate("CookbookCreate")` is called from `CookbookList`, the navigator sees that `CookbookCreate` is at index 0 (above/before `CookbookList` at index 1) and interprets this as a "pop back" rather than a "push forward."

### Solution

Register screens in the order they will be navigated to:

```typescript
// ✅ GOOD: Screens in navigation flow order
<Stack.Screen name="CookbookList" component={CookbookListScreen} />
<Stack.Screen name="CookbookCreate" component={CookbookCreateScreen} />
```

### Outcome

Forward push animation, back button appears correctly, navigation feels natural.

### Takeaways

- Always register `Stack.Screen` components in the order they will be navigated to (parent before child, list before detail, list before create)
- If a screen navigation feels like it's going "backwards," check the registration order before investigating animation or gesture configuration
- This only affects native stack navigators — JS stack navigators don't have this behavior

### References

- React Navigation native-stack behavior with `navigate()` vs `push()`
- `client/navigation/MealPlanStackNavigator.tsx` — cookbook screen registration

---

## [2026-03-23] Drizzle sql Template Parameterizes Column Refs in Subqueries

### Correlated Subqueries with `sql` Template Return Wrong Results

**Problem:** A correlated COUNT subquery using Drizzle's `sql` template tag always returned 0, even though the same SQL run directly against PostgreSQL returned the correct count.

```typescript
// ❌ BAD: Drizzle treats ${cookbooks.id} as a bound parameter ($1), not a column reference
const rows = await db
  .select({
    recipeCount:
      sql<number>`(SELECT COUNT(*) FROM cookbook_recipes WHERE cookbook_id = ${cookbooks.id})`.as(
        "recipe_count",
      ),
  })
  .from(cookbooks);
// Generated SQL: ... WHERE cookbook_id = $1  (where $1 is the column object, not the column value)
```

**Root cause:** Drizzle's `sql` template tag treats all `${}` interpolations as **bound parameters** — it generates `$1`, `$2`, etc. and passes the values separately. This is correct for user-provided values (prevents SQL injection), but when you interpolate a Drizzle column reference like `cookbooks.id`, it serializes the column object as a parameter instead of emitting the column name in the SQL. PostgreSQL then compares `cookbook_id` against a nonsensical value, matching nothing, returning COUNT 0.

**Fix:** Use Drizzle's query builder (JOIN + `count()`) instead of raw SQL with column references:

```typescript
// ✅ GOOD: Drizzle generates correct column references in JOIN conditions
import { count } from "drizzle-orm";

const rows = await db
  .select({
    id: cookbooks.id,
    // ... other fields ...
    recipeCount: count(cookbookRecipes.id),
  })
  .from(cookbooks)
  .leftJoin(cookbookRecipes, eq(cookbookRecipes.cookbookId, cookbooks.id))
  .groupBy(cookbooks.id);
```

**Rule:** Never use `${table.column}` inside `sql` template strings to reference columns from the outer query. Use JOINs, subqueries via Drizzle's query builder, or `sql.raw()` with hardcoded column names if unavoidable.

**Severity:** HIGH — returns plausible-looking zero values instead of obviously wrong results. Passes type checking and compiles without error. Only caught during physical device testing.

---

## [2026-03-21] Fasting Timer Enhancements Review

### useRef for Scheduled Notification IDs Is Fragile

**Problem:** Stored `expo-notifications` scheduled IDs in a `useRef<string[]>([])` for cancellation on fast end. If the user navigated away from FastingScreen and returned, the ref reset to `[]` — leaving orphaned notifications that would fire after the fast ended.

**Root cause:** `useRef` state is tied to the component instance lifecycle. Unmount (navigation away) destroys the ref. Re-mount creates a new empty one.

**Fix:** Use `Notifications.cancelAllScheduledNotificationsAsync()` instead of ID-based tracking. This is a platform-level operation that survives component unmount, app backgrounding, and even force-quit recovery.

```typescript
// ❌ BAD: IDs lost on unmount — orphaned notifications
const notificationIdsRef = useRef<string[]>([]);
// ... schedule notifications, collect IDs ...
// On end-fast: cancelAllFastingNotifications(notificationIdsRef.current)

// ✅ GOOD: Platform-level cancel — always works
Notifications.cancelAllScheduledNotificationsAsync();
```

**Caveat:** `cancelAllScheduledNotificationsAsync()` cancels ALL scheduled notifications, not just fasting ones. This is fine when fasting is the only notification source. If the app adds other notification categories later, persist IDs to AsyncStorage or use notification categories/channels for selective cancellation.

**References:**

- `client/screens/FastingScreen.tsx` — `handleEndFast` uses global cancel
- PR #25 simplicity + performance review

---

## [2026-03-21] Quick Log Enhancements Review

**Category:** Code Review Findings / Runtime Safety

### Context

Added Previous Items, Camera Shortcut, and Tip Cards to the Quick Log modal. Multi-agent review (DHH, Kieran TypeScript, Simplicity) caught issues before merge.

### Key Findings

#### 1. Drizzle `sql<Date>` is a type lie — PG driver returns strings for timestamps

Used `sql<Date>\`max(${dailyLogs.loggedAt})\``in a Drizzle select, then called`.toISOString()`on the result. This compiles fine but crashes at runtime because node-postgres returns timestamp values as ISO strings, not Date objects.`sql<T>` is a compile-time type assertion only — it does not coerce values.

**Fix:** Use `sql<string>` for timestamp aggregations. See `docs/patterns/database.md` for the full reference table.

**Severity:** Critical — silent compile, runtime crash on first real request.

#### 2. `navigation.goBack()` + `navigate()` is a race condition

Calling `goBack()` to dismiss a modal then immediately calling `navigate("Scan")` fires the second navigation against a stale navigator state. The modal dismissal animation hasn't completed, so React Navigation may not process the navigate correctly.

**Fix:** Use `InteractionManager.runAfterInteractions()` between the two calls. See `docs/patterns/react-native.md` for the "Dismiss-then-Navigate" pattern.

#### 3. `navigation.replace()` in modals is fragile

Plan originally proposed `navigation.replace("Scan")` to swap one modal for another. This couples behavior to stack state assumptions and has undefined presentation behavior when the replaced screen and replacement have different `presentation` modes (`modal` vs `fullScreenModal`).

**Fix:** Dismiss explicitly then navigate. Two explicit steps beat one clever one.

#### 4. Module-level mutable state is a React smell

A `let tipCounter = 0` at module level persists across Fast Refresh in dev (stale counter) and is shared mutable state outside React's control. For non-critical UI cycling, `Math.random()` inside `useState` initializer is simpler and has no side effects.

---

## [2026-03-19] HomeScreen Redesign Simplicity Review

**Category:** Simplification / Code Review Post-Mortem

### Context

Redesigned the HomeScreen from a recipe-focused page into a quick actions hub with 16 actions across 4 collapsible sections, a recent actions row, and a ScanFAB speed dial. A simplicity review was run immediately after the initial implementation to catch over-engineering before merge.

### Problems Found (6 issues, ~25% of new code was removable)

**1. Near-identical component copy (`ScanMenu` vs `SpeedDial`)**

A new `ScanMenu` component was created that was a line-for-line copy of the existing `SpeedDial` component. Both rendered a backdrop + animated action buttons. The duplication happened because the implementer searched for "menu" components instead of checking what the existing `SpeedDial` already did.

**Fix:** Deleted `ScanMenu`, reused `SpeedDial` in `ScanFAB.tsx`.

**2. Two components with 80% shared code (`ActionRow` + `FeatureCard`)**

`ActionRow` rendered a plain pressable row; `FeatureCard` rendered a card with a subtitle. Both had the same icon circle, label, chevron, press animation, accessibility props, and lock badge. The only difference was the subtitle line and card background.

**Fix:** Merged into a single `ActionRow` component with an optional `subtitle` prop. When `subtitle` is present, card styling applies automatically.

**3. Two hooks that independently initialized the same cache**

`useSectionState` and `useRecentActions` both called `initHomeActionsCache()` in their `useEffect`. When HomeScreen used both hooks, the init ran twice. The two hooks also shared the same storage file.

**Fix:** Merged into a single `useHomeActions` hook with one `initHomeActionsCache()` call.

**4. Copy-pasted JSX blocks instead of `.map()`**

HomeScreen had 4 nearly identical `<Animated.View>` + `<CollapsibleSection>` blocks — one per section — differing only in the section key, title, and animation delay. Each was ~12 lines.

**Fix:** Defined a `SECTIONS` config array and replaced the 4 blocks with a single `.map()`.

**5. Duplicated navigation targets**

`ScanFAB` hardcoded the same `navigation.navigate("Scan")` calls that already existed in `action-config.ts`'s `navigateAction()`. If a navigation target changed, two files needed updating.

**Fix:** `ScanFAB` now calls `navigateAction()` from the shared config.

**6. Dead code: unused `type` field, unused `getActionById`, premature `ready` state**

- An action `type` field was defined in the interface and populated on every action but never read.
- A `getActionById()` lookup function was exported but had zero consumers.
- A `ready` boolean state tracked cache initialization but was never exposed or consumed.

**Fix:** All three removed (YAGNI).

### Takeaways

- **Check for existing components before creating new ones.** The `ScanMenu`/`SpeedDial` duplication would have been caught by searching the codebase for "backdrop" or "speed dial" before writing a new component. When you need a menu/popup/overlay, first search for existing overlay components.
- **If two components differ by one optional prop, merge them.** The `ActionRow`/`FeatureCard` split added a whole file for one `subtitle` line. An optional prop on the existing component is almost always simpler than a new component with shared code.
- **Multiple hooks for the same storage module is a smell.** If two hooks import from the same storage file, consider whether they should be one hook. Separate hooks make sense when they have independent consumers; when a single screen always uses both, merge them.
- **`.map()` over config arrays, not copy-paste JSX.** When you see 3+ JSX blocks that differ only in props, extract the varying parts into a config array and `.map()` it. This was the difference between 48 lines of JSX and 12.
- **YAGNI applies to fresh code, not just old code.** The review caught an unused `type` field, unused utility function, and unused `ready` state — all written in the same session. The urge to "add it while I'm here" is strongest during initial implementation. Resist it; add things when they have a consumer.
- **Run a simplicity review after every feature implementation, not just on old code.** The ~25% reduction came from a fresh implementation, not legacy cleanup. Reviewing for duplication and dead code immediately after writing is more effective than discovering it months later.

### References

- Pattern: [Config-Driven Screen Rendering](patterns/react-native.md#config-driven-screen-rendering)
- Files: `client/components/home/action-config.ts`, `client/components/home/ActionRow.tsx`, `client/hooks/useHomeActions.ts`, `client/screens/HomeScreen.tsx`, `client/components/ScanFAB.tsx`

---

## [2026-03-18] Allergen Substitution Safety Findings

**Category:** Security / Bug Post-Mortem

### Context

Building the "Intelligent Allergy-Aware Ingredient Substitution" feature across 3 phases. The feature adds allergen detection, severity-aware warnings, and substitution suggestions across recipe, grocery, and catalog surfaces. Three code review cycles uncovered safety-critical bugs and several non-obvious gotchas.

### Problems Found

**1. Cross-allergy safety bug: AI substitutions recommend user's own allergens**

The ingredient substitution service could suggest "almond flour" as a wheat substitute to a user with a tree-nut allergy. The static lookup table, Spoonacular API, and AI all operated independently without cross-referencing the user's allergy list. AI exclusion prompts ("do NOT suggest nuts") were insufficient — the model occasionally ignored them.

**2. Unsafe fallback fabricating allergen data (`?? "milk"`)**

When enriching substitution suggestions with allergen context, the code used `match?.allergenId ?? "milk"` as a fallback when a Map lookup failed. This fabricated a "milk" allergen attribution for unrelated substitutions, potentially causing false warnings that erode user trust.

**3. JSONB `as` cast hides runtime type mismatch**

`profile.allergies` is a JSONB column typed as `unknown` by Drizzle. The code cast it with `as { name: string; severity: string }[]` in 4 locations, providing zero runtime safety. If the column contained null, a bare string, or objects with missing fields, the code would crash with unhelpful errors.

### Solutions

1. **Cross-allergy filter:** Added `filterSafeSubstitutions()` that passes ALL suggestions (from all 3 tiers) through `detectAllergens()` against the user's allergy list before returning results. Also added `buildExclusionList()` for the AI prompt as a first line of defense.

2. **Skip instead of fabricate:** Replaced the `?? "milk"` fallback with a Map lookup that uses `continue` to skip unresolvable entries entirely.

3. **Per-element Zod validation:** Replaced `as` casts with `parseAllergies()` using `allergySchema.safeParse()` per element, skipping invalid entries gracefully.

### Takeaways

- **AI exclusion prompts are defense-in-depth, not sole protection.** Always validate AI output programmatically against user restrictions. The AI is a suggestion source, not a safety gate.
- **Never use a domain-meaningful value as a fallback default.** If a lookup fails, skip or log — don't fabricate data. `?? "milk"` silently creates false allergen attributions.
- **When a Zod schema exists for a JSONB element, use it.** Per-element `safeParse()` + skip is strictly better than `as` casts or whole-array validation because it recovers from partial corruption.
- **Safety-critical filter functions need dedicated unit tests.** `filterSafeSubstitutions` and `buildExclusionList` were initially untest — review caught this and tests were added.
- **Multi-tier pipelines need the safety filter applied to combined output, not per-tier.** Static, Spoonacular, and AI tiers each have different blind spots — only the final combined output should be filtered.

### References

- Pattern: [Cross-Allergy Safety Filter](patterns/security.md#cross-allergy-safety-filter-for-aiexternal-suggestions)
- Pattern: [Zod safeParse per JSONB Element](patterns/database.md#zod-safeparse-per-jsonb-element)
- Files: `server/services/ingredient-substitution.ts`, `server/routes/allergen-check.ts`, `shared/constants/allergens.ts`

---

## [2026-03-10] Receipt-to-Meal-Plan Code Review Findings

**Category:** Bug Post-Mortem

### Context

PR #13 added a receipt-to-meal-plan generation feature: after scanning a grocery receipt and adding items to pantry, users can generate an AI-powered multi-day meal plan. The code review found three bugs in the new code — one client-side, two server-side.

### Problems Found

**1. Dead error handling in mutation hooks (`client/hooks/useGenerateMealPlan.ts`)**

Both `useGenerateMealPlanFromPantry` and `useSaveGeneratedMealPlan` checked `if (!res.ok)` after calling `apiRequest()`. But `apiRequest()` internally calls `throwIfResNotOk()` which throws _before_ returning a non-OK response. The `if (!res.ok)` branches were dead code, and the custom user-friendly error messages ("Meal plan generation failed", "Save failed") were never shown. Users would instead see the raw `"500: {\"error\":\"...\"}"` format from `throwIfResNotOk`.

**2. Internal `error.message` leaked to client (`server/routes/meal-plan.ts:639`)**

The `generate-from-pantry` catch block forwarded `error.message` directly to the client in the 500 response. Every other 500 handler in the file (11 of them) uses a fixed generic string. This could leak internal service details (OpenAI error messages, database error text, etc.) to end users.

**3. Batch save without transaction (`server/routes/meal-plan.ts:710-748`)**

The `save-generated` endpoint created recipes and meal plan items in a sequential loop without `db.transaction()`. If item 5 of 10 failed, items 1-4 would be permanently saved while the client received a 500 error. Retrying would duplicate those items. This violated the documented "Inline Transactions for Multi-Table Operations" pattern in PATTERNS.md.

### Solution

1. Removed dead `if (!res.ok)` blocks — mutations now just call `apiRequest()` and `return res.json()`
2. Replaced dynamic `error.message` with fixed string `"Failed to generate meal plan"`
3. Wrapped the batch save loop in `db.transaction(async (tx) => {...})` with direct drizzle operations (matching the pattern used in `nutrition.ts`, `cooking.ts`, `photos.ts`, and `profile.ts`)

### Takeaways

- **`apiRequest` is throw-on-error** — never re-check `res.ok` after calling it. This is the most common trap for new mutation hooks. A new pattern was added to PATTERNS.md to make this explicit.
- **500 catch blocks must use fixed strings** — the PATTERNS.md checklist item for "generic 500 response" was clarified with an explicit note to never forward `error.message`.
- **Multi-table writes need transactions** — the "Inline Transactions" pattern already existed but wasn't followed. When a route loop calls multiple `storage.*` methods per iteration, refactor to use `db.transaction()` with direct `tx.insert()` calls instead.

### References

- PR: #13 (`feat/receipt-meal-plan-generation`)
- New pattern: PATTERNS.md > Client Hook Patterns > [`apiRequest` Never Returns Non-OK](#apirequest-never-returns-non-ok----dont-re-check-resok)
- Existing pattern: PATTERNS.md > Database Patterns > [Inline Transactions for Multi-Table Operations](#inline-transactions-for-multi-table-operations)
- Existing pattern: PATTERNS.md > Route Module Blueprint > Checklist item #7 (generic 500 response)

---

## [2026-02-24] PostgreSQL Decimal Aggregates Return Strings via Drizzle

**Category:** Gotcha

### Context

The `getDailySummary` method in `server/storage.ts` uses `sql<number>` tagged templates with `SUM(...CAST...AS DECIMAL)` to aggregate nutrition totals (calories, protein, carbs, fat). The protein-suggestions route in `server/routes/medication.ts` consumed `dailySummary.totalProtein` directly in arithmetic to calculate the remaining protein needed for the day.

### Problem

Drizzle's `sql<number>` generic parameter is a compile-time type annotation only -- it tells TypeScript the value is a `number`, but does not coerce the runtime value. PostgreSQL's `pg` driver returns DECIMAL/NUMERIC column results as JavaScript strings to avoid floating-point precision loss. So `dailySummary.totalProtein` could be `"45.5"` (string) instead of `45.5` (number) at runtime.

The expression `proteinGoal - dailySummary.totalProtein` would then produce string concatenation (`"80-45.5"` -> `NaN` or unexpected results) instead of the expected arithmetic subtraction.

### Investigation

1. Noticed the protein-suggestions route used `dailySummary.totalProtein` in arithmetic without wrapping it
2. Checked the `getDailySummary` storage method -- uses `sql<number>\`SUM(CAST(... AS DECIMAL))\``
3. Confirmed via PostgreSQL documentation and the `pg` driver source that DECIMAL/NUMERIC types are always returned as strings
4. Verified that Drizzle's `sql<T>` generic is purely a TypeScript-level annotation with no runtime coercion

### Solution

Wrap all `sql<number>` results with `Number()` when using them in arithmetic:

```typescript
// ❌ Bad: totalProtein is actually a string at runtime
const remaining = proteinGoal - dailySummary.totalProtein;

// ✅ Good: Explicit coercion to number
const remaining = proteinGoal - Number(dailySummary.totalProtein);
```

Alternative approach: use `::integer` or `::float` casts in the SQL instead of `::decimal` to get numeric values from the driver:

```sql
-- Returns string: SUM(CAST(column AS DECIMAL))
-- Returns number: SUM(CAST(column AS FLOAT))
-- Returns number: SUM(CAST(column AS INTEGER))
```

### Outcome

The protein-suggestions route now correctly computes the remaining protein gap as a number. Without the fix, users could have received nonsensical protein suggestions based on `NaN` arithmetic.

### Takeaways

- Drizzle's `sql<T>` generic parameter is TypeScript-only; it does not coerce the runtime value
- PostgreSQL DECIMAL/NUMERIC types always return as strings through the `pg` driver (to preserve precision)
- Always wrap `sql<number>` results with `Number()` when using them in arithmetic
- Alternative: use `::integer` or `::float` casts in SQL instead of `::decimal` if precision loss is acceptable
- This is a general gotcha for any ORM or query builder that uses tagged templates with type annotations -- the type parameter is a developer hint, not a runtime guarantee

### References

- `server/storage.ts` — `getDailySummary()` method (SUM with DECIMAL casts)
- `server/routes/medication.ts` — protein-suggestions route
- [Drizzle ORM sql tagged template docs](https://orm.drizzle.team/docs/sql)
- [node-postgres type parsing](https://node-postgres.com/features/types) — NUMERIC (OID 1700) parsed as string by default
- Related pattern: "IDOR Protection" in PATTERNS.md (same storage method involved)

---

## Phase 0-7 Code Review Learnings (2026-02-24)

### TDEE Back-Calculation: The Adaptive Goals Algorithm

**Category:** Domain Knowledge / Algorithm

**Context:** Phase 5 (Adaptive Goals) computes personalized calorie recommendations by reverse-engineering the user's actual Total Daily Energy Expenditure (TDEE) from their weight change and intake data over 2-4 weeks.

**The Algorithm:**

```
actualTDEE = averageIntake - (weightChangeKg * 7700 / days)
```

Where:

- `averageIntake` is the user's average daily caloric intake over the measurement period
- `weightChangeKg` is `lastWeight - firstWeight` over the period
- `7700` is the approximate calories in 1 kg of body weight (accepted exercise science constant)
- `days` is the number of days in the measurement period

**Implementation details from `server/services/adaptive-goals.ts`:**

1. **Minimum data requirement:** At least 4 weight entries spanning at least 14 days. Less data produces unreliable TDEE estimates.
2. **Significance threshold:** Only recommend changes when deviation exceeds 10% from current goals. Small adjustments cause user fatigue.
3. **Safety bounds:** Clamp recommended calories to 1200-5000 kcal range regardless of calculation. Prevents dangerous recommendations.
4. **Macro ratio preservation:** When adjusting calories, maintain the user's current protein/carbs/fat ratio rather than recalculating from scratch. This respects intentional macro splits.
5. **Goal-aware adjustment:** Apply a fixed modifier after TDEE calculation based on user's primary goal:
   - Lose weight: -500 kcal/day (~0.5 kg/week deficit)
   - Gain weight/build muscle: +300 kcal/day (lean bulk surplus)
   - Maintain: no adjustment

**Why this matters:** The naive approach would be to use a static formula (Mifflin-St Jeor or Harris-Benedict) and never update. But metabolic rates vary widely between individuals and change over time due to metabolic adaptation, activity changes, and body composition shifts. The back-calculation approach uses the user's own data as ground truth, producing significantly better estimates after 2+ weeks of tracking.

**Lesson:** When building adaptive systems, prefer empirical measurement over theoretical models. The Mifflin-St Jeor formula is accurate within ~10% for most people, but 10% of 2000 kcal is 200 kcal/day, which is the difference between losing and maintaining weight. The back-calculation eliminates this systematic error.

**File:** `server/services/adaptive-goals.ts`

---

### Whisper Prompt Engineering for Domain-Specific Transcription

**Category:** AI Integration

**Context:** Phase 3 (Voice Food Logging) uses OpenAI's Whisper API to transcribe audio of users describing what they ate. Initial testing showed frequent misrecognitions of food-specific vocabulary.

**Solution:** Pass a domain-specific `prompt` parameter to the Whisper transcription call:

```typescript
const transcription = await openai.audio.transcriptions.create({
  file,
  model: "whisper-1",
  language: "en",
  prompt: "Food and nutrition logging. The user is describing what they ate.",
});
```

**Why the prompt helps:** Whisper's `prompt` parameter biases the model toward vocabulary and topics that match the prompt. For food logging, this means:

- "quinoa" is transcribed correctly instead of "keenwa" or similar phonetic guesses
- "acai" is recognized as a food item rather than being misheard
- Measurement words ("tablespoon", "ounces", "grams") are preferred over phonetically similar non-food words
- Common food compound words ("peanut butter", "greek yogurt") are kept together

**Lesson:** When using Whisper for domain-specific applications, always provide a prompt that sets the topical context. The prompt does not need to be long or detailed -- a single sentence describing the domain is sufficient. Do NOT include the actual expected transcript (that would be cheating); instead describe the domain so the language model's word-choice priors are shifted appropriately.

**File:** `server/services/voice-transcription.ts`

---

### Fixed Path Routes Must Be Registered Before Parameterized Routes

**Category:** Express.js Gotcha

**Context:** Phase 1 (Weight Tracking) and Phase 2 (Exercise Tracking) both have fixed-path routes (e.g., `/api/weight/trend`, `/api/exercises/summary`) alongside parameterized routes (e.g., `/api/weight/:id`, `/api/exercises/:id`).

**Problem:** Express matches routes in registration order. If `/api/weight/:id` is registered before `/api/weight/trend`, then a GET request to `/api/weight/trend` matches `:id = "trend"`, which fails with "Invalid weight log ID" because `parseInt("trend")` returns `NaN`.

**Solution:** Register fixed-path routes BEFORE parameterized routes within the same `register()` function:

```typescript
export function register(app: Express): void {
  // Fixed path FIRST — must come before :id route
  // NOTE: This must be registered BEFORE /api/weight/:id to avoid route conflict
  app.get("/api/weight/trend", requireAuth, async (req, res) => {
    /* ... */
  });

  // Parameterized route SECOND
  app.delete("/api/weight/:id", requireAuth, async (req, res) => {
    /* ... */
  });
}
```

The weight route file includes an explicit comment: `// NOTE: This must be registered BEFORE /api/weight/:id to avoid route conflict`.

**Lesson:** In Express route modules, always register routes in this order:

1. Collection routes (`GET /api/resource`)
2. Fixed sub-path routes (`GET /api/resource/trend`, `GET /api/resource/summary`)
3. Parameterized routes (`GET /api/resource/:id`, `DELETE /api/resource/:id`)

This is especially easy to forget when using the route module pattern where routes are defined inside a `register()` function. Add a comment whenever a fixed path must come before a parameterized one.

**Files:** `server/routes/weight.ts`, `server/routes/exercises.ts`

---

### Module-Level OpenAI Client in Voice and NLP Services

**Category:** Testing / Architecture (Recurring)

**Context:** Phase 3 added `food-nlp.ts` and `voice-transcription.ts`, both of which instantiate OpenAI at module scope:

```typescript
// server/services/food-nlp.ts — top-level initialization
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});
```

**Why this keeps happening:** This is the fourth and fifth occurrence of the module-level OpenAI anti-pattern (previously documented for `meal-suggestions.ts`, `menu-analysis.ts`, and `nutrition-coach.ts`). The pattern recurs because:

1. The OpenAI SDK examples all show top-level initialization
2. It is the shortest/simplest code to write
3. The developer does not think about testability when building a new service
4. No automated check (lint rule, test) catches it

**Current state of module-level OpenAI instances in the codebase:**

| File                     | Module-Level | Lazy Singleton |
| ------------------------ | ------------ | -------------- |
| `food-nlp.ts`            | Yes          | No             |
| `voice-transcription.ts` | Yes          | No             |
| `nutrition-coach.ts`     | Yes          | No             |
| `menu-analysis.ts`       | Yes          | No             |
| `photo-analysis.ts`      | Yes          | No             |
| `meal-suggestions.ts`    | No           | Yes (fixed)    |
| `recipe-generation.ts`   | Yes          | No             |
| `routes/_helpers.ts`     | Yes          | No             |

**Recommendation:** Create an ESLint rule or a shared `getOpenAI()` lazy singleton in a utility file that all services import. The "document and hope" approach has failed 7 times; this needs a structural fix.

**Related Learning:** "Module-Level Service Client Initialization Breaks Test Imports" in LEARNINGS.md

**Files:** `server/services/food-nlp.ts`, `server/services/voice-transcription.ts`, `server/services/nutrition-coach.ts`, `server/routes/_helpers.ts`

---

### HealthKit Sync Deduplication by Time Window, Not Exact Timestamp

**Category:** Data Integration Gotcha

**Context:** Phase 4 (HealthKit Integration) syncs weight samples from Apple HealthKit to the app's database. The initial implementation checked for duplicates by exact timestamp match, but HealthKit timestamps have sub-second precision while our database stores timestamps with second precision.

**Solution:** Use a time-window check (1 minute) instead of exact match:

```typescript
// server/services/healthkit-sync.ts
const existing = await storage.getWeightLogs(userId, {
  from: new Date(sample.date),
  to: new Date(new Date(sample.date).getTime() + 60000), // 1 min window
  limit: 1,
});
if (existing.length === 0) {
  await storage.createWeightLog({
    userId,
    weight: sample.weight.toString(),
    source: "healthkit",
  });
  weightsSynced++;
}
```

**Why exact match fails:** HealthKit records timestamps with millisecond precision (e.g., `2026-02-24T10:15:23.456Z`). When stored in PostgreSQL as a `timestamp`, sub-second precision may be truncated or rounded depending on the column definition. A re-sync 5 minutes later would see a "different" timestamp and create a duplicate.

**Lesson:** When deduplicating data from external health/fitness APIs, use a time window (30s - 2min) rather than exact timestamp matching. The window should be large enough to absorb precision differences but small enough that two genuinely separate measurements (e.g., two weight readings 5 minutes apart) are not collapsed.

**File:** `server/services/healthkit-sync.ts`

---

## Phase 8-11 Code Review Learnings (2026-02-24)

### IDOR in Micronutrients and Chat Routes: Missing Ownership Checks

**Category:** Security Post-Mortem

**Context:** Phases 10-11 added micronutrient tracking and AI coach chat routes. The micronutrients route had an endpoint `GET /api/micronutrients/item/:id` that looked up a scanned item by ID. The chat route had `GET /api/chat/conversations/:id/messages` that fetched messages for a conversation by ID.

**Problem:** The initial micronutrients implementation fetched the item but did not verify that the requesting user owned it. Any authenticated user could look up any scanned item's micronutrient data by guessing item IDs.

```typescript
// Bug: IDOR — no ownership check
app.get("/api/micronutrients/item/:id", requireAuth, async (req, res) => {
  const item = await storage.getScannedItem(itemId);
  if (!item) return res.status(404).json({ error: "Item not found" });
  // Missing: item.userId !== req.userId check
  const micronutrients = await lookupMicronutrients(item.productName);
  res.json({ itemId, productName: item.productName, micronutrients });
});
```

**Fix:** Added ownership verification after fetching the resource:

```typescript
// Fixed: Check ownership
const item = await storage.getScannedItem(itemId);
if (!item) return res.status(404).json({ error: "Item not found" });
if (item.userId !== req.userId)
  return res.status(404).json({ error: "Item not found" });
```

Similarly, the chat route was fixed to pass `req.userId!` to the storage method so it could verify conversation ownership at the query level.

**Why it kept happening:** This is the third time an IDOR vulnerability was found in the codebase (previously in scanned-items and instruction-cache routes). The pattern recurs because:

1. Routes that look up resources by ID feel complete after the "does it exist?" check
2. Ownership verification is a second mental step that's easy to forget
3. When building quickly across many route modules, the focus is on feature logic, not authorization

**Prevention checklist for new routes:**

- [ ] Every `req.params.id` endpoint has both existence AND ownership checks
- [ ] Return 404 (not 403) to avoid information disclosure
- [ ] For nested resources (conversations -> messages), verify ownership of the parent resource
- [ ] Consider creating a shared `requireOwnership()` helper if the pattern recurs

**Pattern Reference:** See "IDOR Protection: Auth + Ownership Check" in PATTERNS.md

**Files:** `server/routes/micronutrients.ts`, `server/routes/chat.ts`

---

### requireAuth Middleware vs Manual Auth Checks: Consistency Matters

**Category:** Consistency / Security

**Context:** The chat routes were implemented using a manual `if (!req.userId)` check instead of the `requireAuth` middleware used everywhere else.

**Problem:** The initial chat route implementation checked for authentication manually:

```typescript
// Bad: Manual auth check — inconsistent with other routes
app.get("/api/chat/conversations", chatRateLimit, async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
  const conversations = await storage.getChatConversations(req.userId);
  res.json(conversations);
});
```

While functionally equivalent, this deviates from the established pattern of using `requireAuth` middleware. The problems with the manual approach:

1. **Easy to forget** — the check must be added to every handler individually
2. **No early termination guarantee** — if the check is placed after other middleware, unauthenticated requests may trigger rate limiting or other side effects
3. **Inconsistent error format** — the manual check might return a different error shape than `requireAuth`
4. **Review burden** — reviewers must verify the auth check in every handler instead of trusting the middleware pipeline

**Fix:** Replaced manual checks with `requireAuth` middleware:

```typescript
// Good: Middleware handles auth consistently
app.get(
  "/api/chat/conversations",
  requireAuth,
  chatRateLimit,
  async (req, res) => {
    const conversations = await storage.getChatConversations(req.userId!);
    res.json(conversations);
  },
);
```

**Lesson:** Never implement authentication checks inline in route handlers when a middleware exists. The middleware is the single source of truth for "how does this app verify authentication." If you find yourself writing `if (!req.userId)`, you have likely forgotten `requireAuth`. The only exception is when an endpoint needs to behave differently for authenticated vs. unauthenticated users (e.g., a public endpoint that shows extra data for logged-in users).

**Pattern Reference:** See "Route Module Registration Structure" in PATTERNS.md (step 4)

**File:** `server/routes/chat.ts`

---

### Unsafe JSONB Cast: Always Guard with Array.isArray()

**Category:** Type Safety / Runtime Bug

**Context:** The GLP-1 insights service reads medication logs that have a `sideEffects` column stored as JSONB. The code needs to iterate over the side effects array and count occurrences.

**Problem:** The initial implementation used a type assertion to treat the JSONB value as a string array:

```typescript
// Bug: JSONB column could be null, an object, a bare string, or an array
const effects = log.sideEffects as string[];
for (const effect of effects) {
  sideEffectCounts.set(effect, (sideEffectCounts.get(effect) || 0) + 1);
}
```

If `sideEffects` was `null` (legitimate for logs without side effects), this would throw `TypeError: Cannot read properties of null (reading 'Symbol(Symbol.iterator)')`. If it was an unexpected shape (e.g., a string instead of an array), it would iterate over characters.

**Fix:** Added `Array.isArray()` guard and element-level type check:

```typescript
// Fixed: Guard JSONB data at both array and element level
const effects = log.sideEffects;
if (Array.isArray(effects)) {
  for (const effect of effects) {
    if (typeof effect === "string") {
      sideEffectCounts.set(effect, (sideEffectCounts.get(effect) || 0) + 1);
    }
  }
}
```

**Why Drizzle makes this easy to miss:** Drizzle ORM types JSONB columns as `unknown` in the select result. Developers often cast to the expected type (`as string[]`) to satisfy TypeScript, but this provides zero runtime protection. The `as` keyword is a compile-time-only assertion.

**Lesson:** JSONB columns are the TypeScript equivalent of `any` from a runtime perspective. Always use `Array.isArray()` before iterating and `typeof` before accessing element properties. This is especially important for optional/nullable JSONB columns where `null` is a valid stored value.

**Pattern Reference:** See "Safe JSONB Array Access with Array.isArray Guard" in PATTERNS.md

**File:** `server/services/glp1-insights.ts`

---

### Module-Level OpenAI Client Initialization in menu-analysis.ts

**Category:** Testing / Architecture

**Context:** The `menu-analysis.ts` service creates an OpenAI client at module scope:

```typescript
// menu-analysis.ts — top-level initialization
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});
```

**Problem:** This is the same module-level initialization anti-pattern previously documented for `meal-suggestions.ts`. If any test imports `menu-analysis.ts` (even to test a pure helper function), the OpenAI constructor runs immediately. Without the environment variable set, it either throws or creates a client that will fail on first use.

**Current state:** As of Phase 10, `menu-analysis.ts` and `nutrition-coach.ts` still use module-level OpenAI initialization. The `meal-suggestions.ts` service was already fixed to use a lazy singleton pattern.

**What should be done:**

```typescript
// Preferred: Lazy singleton (already used in meal-suggestions.ts)
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return _openai;
}
```

**Lesson:** This is a recurring issue. Every time a new service file is created that uses an external client, the developer should check the "Module-Level Service Client Initialization Breaks Test Imports" learning (already documented) and use the lazy singleton pattern. The fact that this keeps appearing suggests the pattern needs to be enforced through code review checklists rather than just documentation.

**Related Learning:** "Module-Level Service Client Initialization Breaks Test Imports" in LEARNINGS.md

**Files:** `server/services/menu-analysis.ts`, `server/services/nutrition-coach.ts`

---

### Parallel Agent Development: Shared File Ownership Creates Merge Conflicts

**Category:** Process / Architecture

**Context:** Phases 8-11 were developed in parallel by multiple Claude Code agents, each working on a different feature. All four phases needed to modify shared files: `shared/schema.ts` (adding new tables), `server/storage.ts` (adding storage methods), `server/routes.ts` (registering route modules), and `shared/types/premium.ts` (adding feature flags).

**Problem:** When multiple agents modify the same files simultaneously, git merge conflicts are inevitable. The conflicts were particularly painful in:

1. **`shared/schema.ts`** — All four phases added new tables. Each agent added their tables at different positions, causing overlapping edits.
2. **`server/storage.ts`** — Each phase added new storage methods. The interface definition and implementation both grew independently.
3. **`shared/types/premium.ts`** — Each phase added feature flags (`glp1Companion`, `menuScanner`, `micronutrientTracking`, `culturalFoodRecognition`).

**Mitigation strategies that worked:**

1. **Additive-only changes** — Each agent appended to the end of files rather than inserting at arbitrary positions. This reduced three-way merge conflicts to mostly-resolvable additions.
2. **Route module registration pattern** — Each phase's routes lived in their own file (`medication.ts`, `menu.ts`, `micronutrients.ts`), and only a single line was added to `server/routes.ts` to register each module. This minimized shared file edits for route logic.
3. **Feature flag isolation** — While `TIER_FEATURES` needed concurrent edits, each feature flag was a new boolean property, so conflicts were shallow (two agents adding different fields to the same object).

**What should be done differently next time:**

1. **Schema changes first, in sequence** — Have one agent add all schema changes before others start, or use a schema migration file per feature
2. **Storage interface generation** — Consider generating the storage interface from the schema to avoid manual dual-maintenance
3. **Feature flags in separate files** — Instead of one `TIER_FEATURES` object, use a plugin-style registration where each feature module registers its own flags

**Lesson:** When planning parallel agent work, identify shared files upfront and either (a) serialize edits to those files, (b) use additive-only patterns that minimize conflicts, or (c) restructure the code so each feature owns its own files entirely.

---

## History Item Actions Learnings (2026-02-12)

### Soft Delete Breaks Aggregation Queries Silently

**Category:** Bug Post-Mortem

**Problem:** After implementing soft delete (discard) on scanned items, the daily summary dashboard continued to include calories from discarded items. The bug was invisible because the aggregation returned a plausible number -- just inflated. The `getDailySummary()` LEFT JOIN did not filter out discarded rows, and the fix required a compound WHERE because `scannedItemId` is nullable.

**Lesson:** When adding soft delete, grep for every query that reads from or joins against that table. Aggregation queries are the most dangerous because they silently return wrong numbers. Create a checklist of affected queries before merging.

**Pattern + fix:** See "Soft Delete with Aggregation Guard" in PATTERNS.md (includes the compound WHERE clause)

**File:** `server/storage/nutrition.ts:249` -- `getDailySummary()`

---

### Toggle Favourite Race Condition

**Category:** Bug Post-Mortem

**Problem:** Without a transaction, two rapid taps on the favourite button could both see "no existing favourite" and both insert, creating a duplicate row. Even with a unique constraint, the second request failed with a database error rather than toggling gracefully.

**Lesson:** Any check-then-write operation on a join table must be wrapped in a transaction. This applies to all toggle patterns: follow/unfollow, like/unlike, bookmark/unbookmark. The unique constraint is defense-in-depth, not a substitute for proper serialization.

**Pattern + fix:** See "Toggle via Transaction to Prevent Duplicate Inserts" in PATTERNS.md

**File:** `server/storage/nutrition.ts:143` -- `toggleFavouriteScannedItem()`

---

### Inline Arrow Functions in renderItem Defeat React.memo

**Category:** Performance

**Problem:** HistoryScreen passed inline arrow functions (e.g., `() => toggleFavourite.mutate(item.id)`) to each memoized `HistoryItem` in `renderItem`. Despite `React.memo`, every item re-rendered on every parent render because arrow function props were always new references. With 5 callbacks per item, the performance impact scaled with list length.

**Lesson:** When a `React.memo` component receives callbacks, define them in the parent with an ID parameter (`(itemId: number) => void`) rather than creating closures per item. Profile with React DevTools "Highlight updates" to verify memoization is working.

**Pattern + fix:** See "Parameterized ID Callbacks for Memoized List Items" in PATTERNS.md

**File:** `client/screens/HistoryScreen.tsx:785`

---

### Optimistic Total Must Target Correct Page

**Category:** Bug Post-Mortem

**Problem:** When optimistically removing an item from a `useInfiniteQuery` list, the initial implementation decremented `page.total` on every page, not just the page containing the discarded item. This corrupted pagination offsets, causing skipped or duplicate items on subsequent page fetches.

**Lesson:** The `total` count represents the server's total, not the page size. Decrementing it on every page breaks pagination. Always compare `filtered.length < page.items.length` to detect which page actually contained the removed item.

**Pattern + fix:** See "Optimistic Mutation on Infinite Query Pages" in PATTERNS.md (includes the per-page total correction code)

**File:** `client/hooks/useDiscardItem.ts`

---

### Favourite Icon Needs Visual State Differentiation

**Category:** Gotcha

**Context:** The favourite action button uses a heart icon that toggles between favourited and unfavourited states.

**Problem:** The initial implementation used the same icon (`heart`) with the same color for both states. Users could not tell at a glance whether an item was already favourited.

**Solution:** Used distinct visual signals for each state:

```typescript
<ActionButton
  icon="heart"
  label={isFavourited ? "Saved" : "Favourite"}
  color={isFavourited ? theme.error : theme.textSecondary}  // Red when active, muted when inactive
  accessibilityHint={isFavourited ? "Remove from favourites" : "Add to favourites"}
/>
```

**Lesson:** Toggle actions must have clearly distinct visual states. For icon buttons, change at least TWO of: icon name, color, label, or fill style. A single change (like opacity) is insufficient for accessibility and quick scanning. Always include different `accessibilityHint` text for each state so screen reader users also get the distinction.

**File:** `client/components/HistoryItemActions.tsx`

---

## Architecture Decisions

### JWT Auth Migration: Why We Left Session-Based Auth

**Problem:** Session-based authentication with `express-session` and HTTP cookies does not work reliably in React Native/Expo Go.

**Root Cause:**

- Expo Go runs in a sandboxed JavaScript environment
- HTTP cookies are not reliably persisted across app restarts
- Cookie storage is inconsistent between iOS and Android in development mode
- Set-Cookie headers from server may be ignored by the native networking layer

**Solution:** Migrate to JWT tokens stored in AsyncStorage with Authorization Bearer headers.

**Implementation:**

1. Server generates JWT tokens on login/register
2. Client stores token in AsyncStorage with in-memory caching
3. Client includes token via `Authorization: Bearer <token>` header on every request
4. Server validates token with middleware, attaches `userId` to `req`

**Key Files:**

- `/Users/williamtower/projects/OCRecipes/server/middleware/auth.ts` - JWT generation and validation
- `/Users/williamtower/projects/OCRecipes/client/lib/token-storage.ts` - Token persistence with caching
- `/Users/williamtower/projects/OCRecipes/shared/types/auth.ts` - Shared auth types

**Commit:** `8e53d96 - Migrate from session-based auth to JWT for Expo Go compatibility`

**Lesson:** When building React Native apps with Expo Go, always use stateless authentication (JWT, OAuth tokens) instead of session cookies. Cookies work in production standalone apps but fail unpredictably in development.

---

### Transaction Simplification: Inline Over Abstraction

**Before:** Created reusable `withTransaction()` helper function:

```typescript
// Over-abstracted
async function withTransaction<T>(
  callback: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return await db.transaction(callback);
}

const result = await withTransaction(async (tx) => {
  // Multi-step operation
});
```

**After:** Inline `db.transaction()` at call site:

```typescript
// Simple and clear
const result = await db.transaction(async (tx) => {
  // Multi-step operation
});
```

**Why the change?**

- The helper added zero value (just wrapped `db.transaction()`)
- Made stack traces harder to read
- Added unnecessary indirection
- No consistency benefit since transactions vary significantly

**Lesson:** Don't create abstractions unless they provide clear value:

- ✅ Reduce duplication (3+ uses)
- ✅ Encapsulate complex logic
- ✅ Enforce invariants
- ❌ "Might need it later"
- ❌ "Looks cleaner"
- ❌ One-line wrappers with no additional logic

**Commit:** `390c6d9 - Resolve code review findings: security, performance, and cleanup`

---

### Response Type Location: Inline vs Shared

**Decision:** Keep API response types inline at the call site, not in shared type files.

**Bad pattern:**

```typescript
// shared/types/models.ts
export interface ScannedItemResponse { ... }
export interface PaginatedResponse<T> { ... }
export interface DailySummaryResponse { ... }

// Becomes a dumping ground for all response shapes
```

**Good pattern:**

```typescript
// client/screens/HistoryScreen.tsx
type ScannedItemResponse = {
  id: number;
  productName: string;
  scannedAt: string;
};

type PaginatedResponse = {
  items: ScannedItemResponse[];
  total: number;
};
```

**Why?**

- Response shapes are implementation details of the consuming component
- Tight coupling between client screen and shared type file makes refactoring harder
- When response shape changes, you update it where it's used
- Easier to understand without jumping between files

**Exception:** Auth types used in multiple places (User, AuthResponse) live in `shared/types/auth.ts`.

**Commit:** `390c6d9 - Resolve code review findings` (removed `shared/types/models.ts`)

---

## React Native / Expo Go Gotchas

### React 19 useRef Requires Explicit Initial Value

**Problem:** In React 19, `useRef<T>()` without an initial value argument causes a TypeScript error. This broke during the Phase 4 snackbar timer implementation:

```typescript
// React 18: Works fine
const timerRef = useRef<ReturnType<typeof setTimeout>>();

// React 19: TypeScript error — Argument of type 'undefined' is not assignable
// Fix: Pass undefined explicitly
const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
```

**Root Cause:** React 19 changed the `useRef` type signatures. In React 18, `useRef<T>()` with no argument was typed as `MutableRefObject<T | undefined>`. React 19 made the no-argument overload stricter, requiring `useRef()` to be called as `useRef<T>(undefined)` or `useRef<T>(null)` depending on intent.

**Lesson:** When upgrading to React 19 (or starting a project on React 19), always pass an explicit initial value to `useRef`. For timer refs, `undefined` is the correct initial value (not `null`) since `clearTimeout(undefined)` is a safe no-op.

**Pattern Reference:** See "Auto-Dismiss Snackbar with useRef Timer" in PATTERNS.md

---

### Authorization Headers Must Be Included Everywhere

**Problem:** Initial implementation of `useAuth()` sent credentials on login/register but forgot to include Authorization header in `checkAuth()` call.

```typescript
// Bug: checkAuth() missing Authorization header
async function checkAuth() {
  const response = await fetch(`${apiUrl}/api/auth/me`);
  // Server returns 401, user gets logged out unexpectedly
}
```

**Fix:**

```typescript
async function checkAuth() {
  const response = await apiRequest("GET", "/api/auth/me");
  // apiRequest() includes Authorization header automatically
}
```

**Lesson:** Use a centralized API request helper (`apiRequest()`) that ALWAYS includes the Authorization header. Don't use raw `fetch()` for authenticated endpoints.

**Related Pattern:** Authorization Header Pattern in PATTERNS.md

---

### AsyncStorage is Slow: Cache in Memory

**Observation:** Every API request in initial implementation read token from AsyncStorage (2-10ms per read).

**Impact:**

- 10 API calls = 20-100ms wasted on storage reads
- Stuttering UI when making rapid requests
- Poor user experience on slower devices

**Solution:** In-memory cache with lazy initialization:

```typescript
let cachedToken: string | null = null;
let cacheInitialized = false;

export const tokenStorage = {
  async get(): Promise<string | null> {
    if (!cacheInitialized) {
      cachedToken = await AsyncStorage.getItem(TOKEN_KEY);
      cacheInitialized = true;
    }
    return cachedToken; // Instant return on subsequent calls
  },
  // ...
};
```

**Performance gain:** First call takes 2-10ms, all subsequent calls take <1ms.

**File:** `/Users/williamtower/projects/OCRecipes/client/lib/token-storage.ts`

---

### useEffect Cleanup Prevents Memory Leaks

**Problem:** ScanScreen used `setTimeout()` without cleanup, causing state updates on unmounted components.

**Symptom:** "Warning: Can't perform a React state update on an unmounted component"

**Fix:**

```typescript
useEffect(() => {
  const timer = setTimeout(() => {
    setShowCameraPermission(true);
  }, 1000);

  return () => clearTimeout(timer); // Cleanup
}, []);
```

**Lesson:** ALWAYS return cleanup functions from useEffect hooks that set up:

- Timers (setTimeout, setInterval)
- Event listeners
- Subscriptions
- Animation frames

---

### Stale Closures in Callbacks: State vs Refs

**Problem:** During camera migration, `handleBarcodeScanned` callback checked `isScanning` state to debounce rapid scans, but the check always passed (never blocked duplicate scans).

**Root Cause:** The callback was created with `useCallback` and captured the `isScanning` value at creation time. Even when `isScanning` was updated to `true`, the callback still had the old `false` value in its closure.

```typescript
// Bug: isScanning is always the initial false value
const handleBarcodeScanned = useCallback(
  (barcode: string) => {
    if (isScanning) return; // Never true!
    setIsScanning(true);
    // Process barcode...
  },
  [isScanning],
);
```

**Why adding dependency didn't help:** Adding `isScanning` to the dependency array recreates the callback when state changes, but the check still happens against the captured snapshot. The real issue is that state updates are asynchronous - multiple rapid events can all see `isScanning = false` before any update takes effect.

**Solution:** Use `useRef` for synchronous mutable checks:

```typescript
const isScanningRef = useRef(false);
const [isScanning, setIsScanning] = useState(false);

const handleBarcodeScanned = useCallback((barcode: string) => {
  if (isScanningRef.current) return; // Synchronous check works!
  isScanningRef.current = true;
  setIsScanning(true);
  // Process barcode...
}, []); // No dependencies needed for refs
```

**Key insight:** Use both state AND ref:

- `useRef` for synchronous logic (debouncing, rate limiting)
- `useState` for reactive UI updates (showing loading indicator)

**File:** `/Users/williamtower/projects/OCRecipes/client/camera/hooks/useCamera.ts`

**Pattern:** See "useRef for Synchronous Checks in Callbacks" in PATTERNS.md

---

### Camera Library Migration: expo-camera to react-native-vision-camera

**Context:** Migrated from expo-camera to react-native-vision-camera for better performance and ML Kit support.

**Key discoveries during migration:**

1. **Stale closure bug** (see above) - The old expo-camera code worked differently; vision-camera's callback pattern exposed the closure issue.

2. **Cleanup is critical** - The debounce timeout for scan cooldown must be cleaned up on unmount to prevent memory leaks and "state update on unmounted component" warnings.

3. **Style prop typing** - Vision camera components need `StyleProp<ViewStyle>` instead of generic `object` type for proper TypeScript support.

4. **Permission handling differs** - Vision camera has its own permission API; don't mix with Expo's permission system.

**Lesson:** When migrating between libraries with similar APIs, don't assume patterns that worked before will work identically. The underlying callback/event model may differ enough to expose latent bugs.

---

## Security Learnings

### IDOR: Authentication ≠ Authorization

**Vulnerability Found:** GET `/api/scanned-items/:id` had authentication but no ownership check.

```typescript
// IDOR vulnerability - user can access ANY item by guessing IDs
app.get("/api/scanned-items/:id", requireAuth, async (req, res) => {
  const item = await storage.getScannedItem(req.params.id);
  res.json(item); // No check if item.userId === req.userId
});
```

**Fix:** Add ownership verification:

```typescript
app.get("/api/scanned-items/:id", requireAuth, async (req, res) => {
  const item = await storage.getScannedItem(req.params.id);

  if (!item || item.userId !== req.userId) {
    return res.status(404).json({ error: "Item not found" });
  }

  res.json(item);
});
```

**Lesson:** For single-resource endpoints (GET /resource/:id), always check:

1. Resource exists
2. Current user owns the resource

Return 404 (not 403) to avoid information disclosure about what IDs exist.

**Pattern:** IDOR Protection in PATTERNS.md

---

### CORS Wildcard is Dangerous

**Before:** `res.header("Access-Control-Allow-Origin", "*")`

**Problem:**

- Allows ANY website to make authenticated requests to your API
- Credentials can be stolen if user visits malicious site
- No protection against CSRF attacks

**Fix:** Pattern-based origin checking:

```typescript
const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^exp:\/\/.+$/,
  /^https:\/\/.+\.loca\.lt$/,
];

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // Mobile apps have no origin
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}
```

**Lesson:** Never use `Access-Control-Allow-Origin: *` in production. Whitelist specific origins or patterns.

---

### Input Validation Prevents Multiple Attack Vectors

**Added:** Zod validation to all API endpoints.

**Benefits:**

1. **Injection prevention:** Malformed data caught before DB queries
2. **Type safety:** Numbers are numbers, strings are strings
3. **Business logic:** Username regex, min/max lengths enforced
4. **Clear errors:** Users get actionable feedback

**Example Attack Prevented:**

```typescript
// Without validation:
POST /api/auth/register
{ "username": "admin'--", "password": "x" }
// Could lead to SQL injection or logic errors

// With validation:
const registerSchema = z.object({
  username: z.string().regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8),
});
// Request rejected before reaching database
```

**Commit:** `390c6d9 - Add Zod input validation to all API endpoints`

---

### URL Injection via Unencoded Path Segments

**Category:** Security

**Problem:** The initial Google Play receipt validation built a URL by interpolating `purchaseToken` directly into a path segment without encoding:

```typescript
// Bug: purchaseToken could contain /, ?, # or other URL-significant characters
const url = `https://androidpublisher.googleapis.com/.../tokens/${purchaseToken}`;
```

If `purchaseToken` contained path traversal characters (e.g., `../` or `?injected=param`), the request would be sent to an unintended URL. This is a URL injection / SSRF-adjacent vulnerability.

**Fix:** Apply `encodeURIComponent()` to all user-supplied values embedded in URL paths:

```typescript
const url = `https://androidpublisher.googleapis.com/.../tokens/${encodeURIComponent(purchaseToken)}`;
```

**Lesson:** Always `encodeURIComponent()` values interpolated into URL path segments or query parameters. This is easy to forget because template literals make string interpolation feel safe. The rule: if the value comes from the client (request body, params, headers) or from an external source, it must be encoded before embedding in a URL.

**Existing examples in codebase:**

- `server/services/nutrition-lookup.ts` — encodes query params for USDA and API Ninjas
- `server/services/receipt-validation.ts` — encodes `packageName` and `purchaseToken` in Google API URL

**File:** `server/services/receipt-validation.ts`

---

### Deferred JWS Signature Verification: Risk-Based Security Decisions

**Category:** Security / Decision

**Context:** The Apple receipt validation decodes JWS (JSON Web Signature) payloads from App Store Server API v2. Full security requires verifying the JWS signature against Apple's root certificate chain (Apple Root CA - G3), which involves x5c certificate chain validation.

**Decision:** Deferred cryptographic signature verification with a documented SECURITY TODO, rather than blocking the feature or implementing a partial solution.

**Rationale:**

1. **Complexity:** Apple JWS verification requires downloading Apple's root certificate, parsing the x5c header, building the certificate chain, and verifying each step. This is a non-trivial cryptographic operation.
2. **Mitigation:** Server-side transaction lookups via the App Store Server API provide an alternative verification path for high-value purchases.
3. **Risk assessment:** Forging a valid-looking JWS payload requires knowledge of the expected schema and bundle ID. The attack surface is limited to users who can craft valid-looking but unsigned payloads.
4. **Pragmatism:** Shipping real receipt validation for Google (which was fully implemented) plus basic Apple validation was better than blocking the entire feature.

**Lesson:** When a security measure is complex to implement and has reasonable mitigations, it is acceptable to defer it with a clearly documented SECURITY TODO that includes:

- What exactly is missing (signature verification against Apple Root CA - G3)
- Why it matters (prevents forged receipts)
- What mitigations exist (server-side transaction lookups)
- A link to the relevant documentation

Do NOT defer without documentation. A bare `// TODO: verify signature` will be forgotten. Include enough context that a future developer can implement it without re-researching the problem.

**File:** `server/services/receipt-validation.ts` (see `decodeAppleJWS` SECURITY TODO comment)

---

## Simplification Principles

### Delete Code Aggressively

**Removed in code review:**

- ~600 LOC of unused web support (landing page, web-specific hooks)
- Unused Spacer component
- Unused chat schema
- Debug console.log statements
- Commented-out code

**Why delete instead of "keep for later"?**

- Unused code has maintenance cost (must be updated when dependencies change)
- Creates confusion ("Is this used? Should I update it?")
- Git history preserves deleted code if you need it back
- YAGNI: You Aren't Gonna Need It

**Lesson:** If code isn't used NOW, delete it. Git history is your safety net.

**Commit:** `390c6d9 - Code cleanup (~600 LOC removed)`

---

### Replace `any` with Proper Types

**Before:**

```typescript
function handleSubmit(data: any) {
  navigation.navigate("NextScreen", { data });
}
```

**After:**

```typescript
import type { HomeScreenNavigationProp } from "@/types/navigation";

function handleSubmit(data: { username: string; password: string }) {
  navigation.navigate("NextScreen", { data });
}
```

**Benefits:**

- Autocomplete in IDE
- Compile-time error checking
- Refactoring safety
- Self-documenting code

**Lesson:** Using `any` is a code smell. If you don't know the type, use `unknown` and narrow with type guards. If you do know the type, define it properly.

---

## Performance Learnings

### Database Indexes Are Not Optional

**Added indexes to:**

- `scannedItems.userId` - Filtered on every query
- `scannedItems.scannedAt` - Sorted on every history query
- `dailyLogs.userId` - Filtered on every query
- `dailyLogs.loggedAt` - Filtered by date range

**Query performance improvement:**

- Before: Full table scan on 10k+ items = ~500ms
- After: Index scan = ~5ms

**Rule of thumb:** Add indexes to columns used in:

- WHERE clauses (especially foreign keys)
- ORDER BY clauses
- JOIN conditions

**Warning:** Too many indexes slow down writes. Only index columns you actually query on.

**File:** `/Users/williamtower/projects/OCRecipes/shared/schema.ts`

---

### Pagination Prevents OOM Crashes

**Before:** Loaded ALL scanned items in one query:

```typescript
app.get("/api/scanned-items", async (req, res) => {
  const items = await storage.getAllScannedItems(req.userId);
  res.json(items); // Could be 10,000+ items
});
```

**Problem:**

- Large JSON responses (>10MB) crash mobile devices
- Slow network transfers
- UI freezes rendering huge lists

**After:** Pagination with useInfiniteQuery:

```typescript
app.get("/api/scanned-items", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;
  const result = await storage.getScannedItems(req.userId, limit, offset);
  res.json(result);
});
```

**Client-side:** FlatList virtualization + infinite scroll prevents rendering all items at once.

**Lesson:** ALWAYS paginate list endpoints. Default page size 20-50, max 100. Let clients request more via offset/cursor.

---

### Dynamic Imports in Hot Paths Add Latency

**Problem:** The initial receipt-validation implementation used `const crypto = await import("crypto")` inside the `getGoogleAccessToken()` function. Every call to this function paid the dynamic import overhead, even though the `crypto` module is a Node.js built-in that never changes.

```typescript
// Bad: Dynamic import in a function called on every Google receipt validation
async function getGoogleAccessToken(): Promise<string> {
  const crypto = await import("crypto"); // ~1-5ms overhead per call
  const sign = crypto.createSign("RSA-SHA256");
  // ...
}

// Good: Static import at module top level
import crypto from "crypto";

async function getGoogleAccessToken(): Promise<string> {
  const sign = crypto.createSign("RSA-SHA256"); // Instant, already loaded
  // ...
}
```

**Why it happened:** The developer may have been following a pattern from ESM modules where dynamic `import()` is used to conditionally load heavy dependencies. For Node.js built-ins like `crypto`, `fs`, and `path`, static imports are always preferred because:

1. Built-ins are already loaded by the Node.js runtime
2. Static imports are resolved at module load time (once), not per-call
3. Dynamic imports prevent bundlers from tree-shaking

**Lesson:** Use static `import` for Node.js built-in modules and lightweight dependencies. Reserve dynamic `import()` for conditional loading of heavy optional dependencies (e.g., only loading a PDF parser when the user requests PDF import). If a module is used every time a function runs, it should be a static import.

**File:** `server/services/receipt-validation.ts`

---

### Fetch Without Timeout Hangs Indefinitely

**Problem:** The receipt-validation Google API calls (`fetch("https://oauth2.googleapis.com/token", ...)` and `fetch("https://androidpublisher.googleapis.com/...", ...)`) had no timeout. If the Google API was slow or unresponsive, the Express request handler would hang indefinitely, consuming a server connection.

**Why it matters:** Node.js `fetch` has no default timeout. Unlike browsers (which typically timeout after 30-60 seconds), Node.js will keep the connection open until the OS TCP timeout (often 2+ minutes on Linux, longer on macOS). During this time:

- The Express request connection is held open
- The user's upgrade flow appears frozen
- Server connection pool can be exhausted under load

**Fix:** Add `AbortSignal.timeout()` to every outbound fetch:

```typescript
const FETCH_TIMEOUT_MS = 10_000;

const response = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
});
```

**Audit note:** Several other server services (`nutrition-lookup.ts`, `recipe-catalog.ts`) also use `fetch` without timeouts. The `recipe-import.ts` service already uses `AbortSignal.timeout()` via its `safeFetch` wrapper. Consider adding timeouts to all outbound fetches.

**Lesson:** Always add `AbortSignal.timeout()` to outbound `fetch()` calls. Make the timeout a named constant at the module level so it is easy to find and adjust. 10 seconds is a reasonable default for API calls.

**Pattern Reference:** See "Fetch Timeout with AbortSignal for External APIs" in PATTERNS.md

**File:** `server/services/receipt-validation.ts`

---

### N+1 Query in Aggregation Endpoints

**Problem:** The `/api/micronutrients/daily` endpoint looped over daily log entries, executing one `getScannedItem()` DB query and one USDA API call per log entry. For a user with 10 logged items in a day, this meant 10 sequential DB queries + 10 sequential API calls, resulting in response times scaling linearly with item count.

**Root Cause:** The endpoint was written as a straightforward loop — get logs, iterate, fetch each item, look up each item's nutrients. This is the classic N+1 pattern: 1 query for the list + N queries for related records.

**Fix (three layers):**

1. **Batch DB query** — replaced N individual `getScannedItem(id)` calls with a single `getScannedItemsByIds(ids, userId)` using Drizzle's `inArray()` operator. Deduplicated IDs with `new Set()` first to avoid fetching the same item twice when multiple logs reference it.

2. **Cached API wrapper** — wrapped the USDA API call in `lookupMicronutrientsWithCache()` that checks a DB cache table before calling the external API. Made the uncached function private to prevent bypass.

3. **Parallel execution** — used `Promise.all(foodNames.map(lookupMicronutrientsWithCache))` so cache hits and cache misses resolve concurrently instead of sequentially.

**Before:** O(N) DB queries + O(N) sequential API calls
**After:** 1 DB query + O(M) parallel cached lookups (M = unique food names, most served from cache)

**Code Review Refinements:**

- Hit count updates in cache reads were `await`ed unnecessarily — changed to fire-and-forget since hit counts are analytics, not critical path
- Cache writes after USDA lookup were `await`ed — changed to fire-and-forget since the response data is already in memory
- Added optional `userId` parameter to `getScannedItemsByIds()` for IDOR defense-in-depth

**Lesson:** When writing aggregation endpoints, ask: "Am I querying inside a loop?" If yes, refactor to batch-fetch all related records first, then process in memory. The pattern is: get list, extract unique IDs, batch fetch by IDs, map results.

**Pattern References:**

- "Batch Fetch with `inArray` to Fix N+1 Queries" in PATTERNS.md
- "Private Raw Function with Public Cached Wrapper" in PATTERNS.md
- "Fire-and-Forget for Non-Critical Background Operations" in PATTERNS.md

**Files:**

- `server/routes/micronutrients.ts` — refactored daily endpoint
- `server/storage.ts` — `getScannedItemsByIds()`
- `server/services/micronutrient-lookup.ts` — cached wrapper + batch lookup

---

## Caching Learnings

### PostgreSQL Caching for AI-Generated Content

**Context:** Implemented server-side caching for OpenAI-generated suggestions and instructions to reduce API costs.

**Key Decisions:**

| Decision              | Choice                                        | Rationale                                                              |
| --------------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| Cache storage         | PostgreSQL table                              | Persistence across restarts, easy querying, cascade deletes            |
| Cache key             | (itemId, userId, profileHash)                 | Unique per user per item, invalidates on profile change                |
| TTL                   | 30 days                                       | AI content doesn't change; long TTL maximizes hit rate                 |
| Expiry check          | Inline in query (`gt(expiresAt, new Date())`) | Single round-trip, no separate cleanup job needed                      |
| Hit tracking          | Fire-and-forget                               | Doesn't block response, failure is non-critical                        |
| Invalidation strategy | Hash-based + eager delete                     | Hash detects content-affecting changes; eager delete on profile update |

**Schema Design:**

```typescript
// Parent cache: indexed on composite key (itemId + userId)
export const suggestionCache = pgTable(
  "suggestion_cache",
  {
    id: serial("id").primaryKey(),
    scannedItemId: integer("scanned_item_id").notNull(),
    userId: varchar("user_id").notNull(),
    profileHash: varchar("profile_hash", { length: 64 }).notNull(),
    suggestions: jsonb("suggestions").notNull(),
    hitCount: integer("hit_count").default(0),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => ({
    itemUserIdx: index().on(table.scannedItemId, table.userId),
    expiresAtIdx: index().on(table.expiresAt),
  }),
);

// Child cache: cascade delete from parent
export const instructionCache = pgTable("instruction_cache", {
  suggestionCacheId: integer("suggestion_cache_id")
    .references(() => suggestionCache.id, { onDelete: "cascade" })
    .notNull(),
  // ...
});
```

**Security Consideration - IDOR in Cache Lookups:**

The initial implementation had an IDOR vulnerability in the instruction cache lookup:

```typescript
// ❌ BAD: No authorization check - any user could access cached instructions
const cachedInstruction = await storage.getInstructionCache(
  cacheId,
  suggestionIndex,
);
if (cachedInstruction) {
  return res.json({ instructions: cachedInstruction.instructions });
}
```

**Fix:** Verify the parent suggestion cache belongs to the requesting user:

```typescript
// ✅ GOOD: Verify ownership through parent cache
if (cacheId) {
  const parentCache = await storage.getSuggestionCacheById(cacheId);
  if (parentCache && parentCache.userId === req.userId!) {
    const cachedInstruction = await storage.getInstructionCache(
      cacheId,
      suggestionIndex,
    );
    if (cachedInstruction) {
      return res.json({ instructions: cachedInstruction.instructions });
    }
  }
}
```

**Lesson:** Cache entries that derive from user-specific data must include authorization checks, not just authentication. The cache key alone (numeric ID) is not sufficient authorization.

**Performance Results:**

- Cache hit: ~5ms (database lookup)
- Cache miss: ~2000-3000ms (OpenAI API call)
- Cache hit rate after 1 week: ~85% for returning users

**File References:**

- `/Users/williamtower/projects/OCRecipes/shared/schema.ts` - Cache table definitions
- `/Users/williamtower/projects/OCRecipes/server/storage.ts` - Cache storage methods
- `/Users/williamtower/projects/OCRecipes/server/utils/profile-hash.ts` - Profile hash utility

---

## Subscription & Payment Learnings

### Stub Services Must Fail-Safe in Production

**Vulnerability Found:** Receipt validation stub was initially implemented to auto-approve all receipts unconditionally:

```typescript
// DANGEROUS: Auto-approves in all environments including production
export async function validateReceipt(receipt: string): Promise<Result> {
  // TODO: implement real validation
  return { valid: true, expiresAt: oneYearFromNow() };
}
```

**Impact:** If deployed, any user could upgrade to premium for free by sending any string as a receipt.

**Fix:** Two-layer environment gating:

```typescript
const STUB_MODE = !process.env.APPLE_SHARED_SECRET;

export async function validateReceipt(receipt: string, platform: Platform) {
  if (STUB_MODE) {
    if (process.env.NODE_ENV === "production") {
      console.error("Receipt validation stubbed in production — rejecting.");
      return { valid: false, errorCode: "NOT_IMPLEMENTED" };
    }
    console.warn("Receipt validation stubbed — auto-approving in dev.");
    return { valid: true, expiresAt: oneYearFromNow() };
  }
  // Real validation...
}
```

**Lesson:** Stubs that grant access (payment, auth, permissions) must **always** reject in production. Use credential presence (`!process.env.X`) as the stub trigger rather than a manual boolean, so production with credentials works and dev without credentials stubs safely. Add a second layer (`NODE_ENV` check) as defense in depth.

**Pattern:** See "Stub Service with Production Safety Gate" in PATTERNS.md

**File:** `/Users/williamtower/projects/OCRecipes/server/services/receipt-validation.ts`

---

### API Response Consistency: Match Existing Conventions

**Problem:** The `sendError()` utility initially included `success: false` in error responses:

```typescript
// Initial implementation
export function sendError(res: Response, status: number, error: string) {
  res.status(status).json({ success: false, error }); // Extra field
}
```

**Issue:** Every other error response in the codebase uses `{ error: "..." }` without a `success` field. Adding `success: false` to subscription endpoints created an inconsistency that clients would need to handle differently.

**Fix:** Removed `success: false` to match the established convention:

```typescript
// Fixed: Matches existing pattern
export function sendError(
  res: Response,
  status: number,
  error: string,
  options?: ErrorOptions,
) {
  const body: Record<string, unknown> = { error };
  if (options?.code) body.code = options.code;
  res.status(status).json(body);
}
```

**Lesson:** Before introducing a helper that standardizes responses, check the existing response format. A utility that deviates from the established convention creates more inconsistency than it solves. When in doubt, grep for `res.status(` and `res.json({` to see the existing pattern.

**Related:** Also caught `UpgradeResponseSchema` using `z.string()` for the tier field instead of the domain-specific `subscriptionTierSchema`. When referencing a constrained value in a Zod schema, always reuse the existing domain schema rather than a generic `z.string()`. This ensures client-side validation catches invalid values the same way the server does.

---

### Restore Endpoints Need the Same Rigor as Purchase Endpoints

**Problem:** The upgrade endpoint had Zod validation, rate limiting, and transaction logging, but the restore endpoint was implemented with manual field checks and no transaction logging.

**Root Cause:** Restore feels "less important" than purchase since it doesn't charge the user. This creates a false sense that it needs less protection.

**Why it matters:**

- A restore without Zod validation accepts malformed data that could cause downstream errors
- A restore without transaction logging creates a gap in the audit trail
- A restore without rate limiting can be abused to probe for valid receipts

**Fix:** Applied identical safeguards to the restore endpoint: `RestoreRequestSchema.safeParse()`, `subscriptionRateLimit`, and `createTransaction()` call.

**Lesson:** When building paired endpoints (create/restore, subscribe/unsubscribe, save/delete), apply the same validation, rate limiting, and logging to both. The "less important" endpoint is often the one attackers target because developers protect it less.

---

### Hardcoded Tier Limits Silently Drift from Centralized Config

**Problem:** The saved items limit was hardcoded as `6` in `storage.ts`, `SavedItemsScreen.tsx`, and `SaveButton.tsx`, while `TIER_FEATURES` in `shared/types/premium.ts` was the intended single source of truth for all tier-dependent limits.

**How it happened:** When the saved items feature was first built, `TIER_FEATURES` didn't have a `maxSavedItems` property yet. The developer used a literal `6` as a quick implementation. Later, `TIER_FEATURES` became the canonical config for tier limits (scans, suggestions, recipes), but the saved items limit was never migrated. The hardcoded `6` continued to work correctly — it just wasn't connected to the config system.

**Why it's dangerous:** If someone later changed the free tier's saved items limit in `TIER_FEATURES`, the config change would have no effect because the actual enforcement was hardcoded elsewhere. The code would appear to respect the config (since `TIER_FEATURES` existed) but silently ignore it.

**Fix:** Added `maxSavedItems` to the `PremiumFeatures` interface and `TIER_FEATURES` config, then replaced all hardcoded `6` references with `features.maxSavedItems` (server) and `features.maxSavedItems` via `usePremiumContext()` (client).

**Lesson:** When adding a new tier-dependent limit, always follow the full path: add to `PremiumFeatures` interface -> set per-tier value in `TIER_FEATURES` -> consume via `features.X`. Never use a magic number as a "temporary" solution — it becomes permanent the moment someone else reads the code and assumes the config is authoritative. Grep for literal numbers when reviewing tier-related code.

**Pattern Reference:** See "Tier-Gated Route Guards" in PATTERNS.md (key element #5)

---

## Data Processing Gotchas

### Longest-Keyword-Match Prevents False Category Assignment

**Problem:** Ingredient auto-categorization used first-match substring search. "Ground cumin" matched the keyword "ground" in the meat category before reaching "cumin" in spices, causing cumin to appear in the meat aisle of grocery lists.

**Root Cause:** The original loop broke on the first keyword match. Generic keywords like "ground" (meat), "cream" (dairy), and "white" (other) are substrings of many compound ingredient names ("ground cumin", "cream of tartar", "white wine vinegar").

**Solution:**

```typescript
// Before (first-match — bug)
for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
  for (const kw of keywords) {
    if (lower.includes(kw)) return category; // "ground" matches first!
  }
}

// After (longest-match — correct)
let bestMatch: { category: string; length: number } | null = null;
for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
  for (const kw of keywords) {
    if (lower.includes(kw) && (!bestMatch || kw.length > bestMatch.length)) {
      bestMatch = { category, length: kw.length };
    }
  }
}
return bestMatch?.category ?? "other";
```

Additionally, removed ambiguous single-word keywords ("ground", "cream") from category lists and replaced them with specific compound terms ("ground beef", "ground pork", "cream cheese", "sour cream").

**Lesson:** When categorizing text with keyword lists, always use longest-match to resolve ambiguity. Short generic keywords are especially dangerous — prefer specific compound terms over single words that appear in many contexts.

**File:** `server/services/grocery-generation.ts`

---

### Truthy Default Values Bypass Fallback Logic

**Problem:** Ingredients from the database had `category: "other"` (the default column value). The grocery list aggregator intended to re-categorize uncategorized ingredients, but the `||` fallback never ran because `"other"` is truthy:

```typescript
// Bug: "other" is truthy, so categorizeIngredient() never runs
category: ing.category || categorizeIngredient(normalized);
```

**Fix:** Explicitly check for the sentinel value:

```typescript
// Correct: treat "other" as uncategorized
category: ing.category && ing.category !== "other"
  ? ing.category
  : categorizeIngredient(normalized);
```

**Lesson:** When a database column has a default string value that represents "unset" (e.g., `"other"`, `"none"`, `"default"`), JavaScript's `||` operator will treat it as a valid value. Always check for the sentinel explicitly: `value && value !== "sentinel"`. This is a common trap when database defaults are truthy strings rather than `null`.

**File:** `server/services/grocery-generation.ts`

---

## Testing & Tooling Learnings

### Module-Level Service Client Initialization Breaks Test Imports

**Problem:** `meal-suggestions.ts` instantiated the OpenAI client at the top of the module:

```typescript
// Before: top-level — breaks any test that imports this module
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, // undefined in test env
});
```

Any test file that imported the module (even to test a pure helper function exported from the same file) crashed because `AI_INTEGRATIONS_OPENAI_API_KEY` was not set in the test environment.

**Solution:** Lazy singleton initialization:

```typescript
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return _openai;
}
```

The client is only instantiated when a function that actually calls the API is invoked, not when the module is imported.

**Lesson:** Never instantiate external service clients (OpenAI, Stripe, AWS SDK, etc.) at module scope if the module exports any functions that tests might import. Use a lazy getter function instead. This applies to all server services — note that `photo-analysis.ts`, `recipe-generation.ts`, and `routes.ts` still use module-level initialization and would break if their exports were tested directly.

**File:** `server/services/meal-suggestions.ts`

---

### Vitest Cannot Import React Native Modules

**Problem:** Tests for `usePurchase` hook initially imported the hook directly. Vitest (which uses Vite/Rollup under the hood) failed with parse errors on React Native's JSX runtime and native module bindings.

**Error (abbreviated):**

```
SyntaxError: Unexpected token
 > import { Platform } from "react-native";
              ^

[vite] Pre-transform error: Failed to resolve import "react-native"
```

**Root Cause:** Vitest runs in Node.js, not in a Metro bundler environment. React Native modules (`react-native`, `expo-haptics`, `expo-iap`, etc.) contain native bindings and JSX that Vite's Rollup-based transform pipeline cannot parse. Unlike Jest (which can be configured with `react-native` presets and module mappers), Vitest has no built-in RN transform support.

**Solution:** Extract all testable business logic into pure `*-utils.ts` files that import **only** from `@shared/` or plain TypeScript modules. Test those files instead of the hooks.

```
# Testable (no RN imports)
client/lib/iap/purchase-utils.ts         → mapIAPError, buildReceiptPayload, isSupportedPlatform
client/components/upgrade-modal-utils.ts → BENEFITS, getCtaLabel, isCtaDisabled

# Not directly testable in Vitest (imports RN)
client/lib/iap/usePurchase.ts
client/components/UpgradeModal.tsx
```

**Lesson:** In a Vitest + React Native project, draw a hard boundary: pure logic in `*-utils.ts` (testable), React/RN-dependent code in hooks/components (tested via simulator or integration tests). Do not try to mock `react-native` in Vitest -- it leads to fragile mocks that break on RN upgrades.

**Pattern:** See "Pure Function Extraction for Vitest Testability" in PATTERNS.md

---

### `__DEV__` Conditional Require for Mock/Real Module Switching

**Decision:** The IAP (In-App Purchase) module needs a mock implementation in development and the real `expo-iap` library in production native builds. We chose `__DEV__` (Metro's build-time global) with `require()` rather than environment variables or other approaches.

**Implementation:**

```typescript
// client/lib/iap/index.ts
const USE_MOCK = __DEV__;

let _useIAP: () => UseIAPResult;

if (USE_MOCK) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mock = require("./mock-iap");
  _useIAP = mock.useIAP;
} else {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const expoIap = require("expo-iap");
  _useIAP = expoIap.useIAP;
}

export const useIAP: () => UseIAPResult = _useIAP;
```

**Why `__DEV__` over `.env` variables:**

| Approach                        | Pros                                                                                            | Cons                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `__DEV__`                       | Automatically correct in dev vs prod; no config needed; Metro strips dead branch in prod builds | Requires `eslint-disable` for `require()`                                              |
| `EXPO_PUBLIC_USE_MOCK_IAP=true` | Standard env pattern                                                                            | Easy to misconfigure; env vars persist across builds; developer must remember to unset |
| Dynamic import `await import()` | No `require()`                                                                                  | Async at module level; complicates hook initialization                                 |

**Key details:**

1. The `_useIAP` variable must be explicitly typed as `() => UseIAPResult` to avoid `any` (code review finding H1)
2. The `require()` calls need `eslint-disable` comments since our ESLint config forbids CommonJS require (code review finding H2)
3. Both branches must conform to the same `UseIAPResult` interface -- the type contract is the abstraction boundary

**Lesson:** When a module needs a dev stub that cannot coexist with the real implementation (because the real module only loads on native builds), use `__DEV__` conditional require with a shared type interface. This is the React Native equivalent of the server-side "Stub Service with Production Safety Gate" pattern.

**File:** `client/lib/iap/index.ts`

---

### Mounted Ref Guard for Async Hooks

**Problem:** The `usePurchase` hook runs async operations (IAP purchase, server receipt validation, subscription refresh) that may complete after the component unmounts. Calling `setState` on an unmounted component causes React warnings and can mask bugs.

**Solution:** A `mountedRef` + `safeSetState` wrapper:

```typescript
export function usePurchase() {
  const [state, setState] = useState<PurchaseState>({ status: "idle" });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const safeSetState = useCallback((newState: PurchaseState) => {
    if (mountedRef.current) {
      setState(newState);
    }
  }, []);

  // All async flows use safeSetState instead of setState
  const purchase = useCallback(async () => {
    safeSetState({ status: "loading" });
    try {
      // ... long async chain
      safeSetState({ status: "success" });
    } catch (error) {
      safeSetState({ status: "error", error: mapIAPError(error) });
    }
  }, [safeSetState]);
}
```

**Why not just useEffect cleanup with AbortController?** The IAP purchase flow spans multiple async steps (store purchase, server validation, transaction finish) from different libraries. An AbortController cannot cancel a store dialog or a `finishTransaction` call. The mounted ref is a simpler guard that lets the async chain complete but silently drops the state update if the component is gone.

**Lesson:** For hooks with multi-step async flows that cross library boundaries, a mounted ref guard is simpler and more reliable than trying to cancel each step. Use `safeSetState` consistently throughout the hook -- never call raw `setState` in an async callback.

**File:** `client/lib/iap/usePurchase.ts`

---

## Database Migration Gotchas

### ADD COLUMN with `.default()` Leaves Existing Rows NULL

**Category:** Gotcha

**Problem:** When adding a new JSONB column `mealTypes` to `mealPlanRecipes` with `.default([])` in the Drizzle schema, all existing rows received NULL instead of the empty array default. Queries that filtered with `WHERE mealTypes::jsonb = '[]'::jsonb` found zero rows to backfill, and storage queries that checked `mealTypes = '[]'` to treat unclassified recipes as universal silently missed all legacy recipes.

**Root Cause:** Drizzle's `.default([])` sets a `DEFAULT` constraint on the column, which only applies to future `INSERT` statements that omit the column. PostgreSQL's `ALTER TABLE ADD COLUMN ... DEFAULT` does apply the default to existing rows in PostgreSQL 11+, but only for non-volatile defaults. Drizzle's `db push` migration strategy may not always produce the exact `ALTER TABLE` form that triggers this behavior, and in practice existing rows ended up with NULL.

**Key insight:** `column = '[]'` and `column IS NULL` are completely different in PostgreSQL. `NULL = '[]'` evaluates to `NULL` (not `FALSE`), so `WHERE` clauses using equality silently skip NULL rows. This is a fundamental SQL three-valued logic issue, but it bites hardest after schema migrations where you expect the default value to be present.

**Fix:** Always pair equality checks with `IS NULL` when querying columns that may contain legacy NULL rows:

```typescript
// ❌ Bad: Misses rows where mealTypes is NULL (all pre-migration rows)
.where(sql`${table.mealTypes}::jsonb = '[]'::jsonb`)

// ✅ Good: Catches both empty arrays AND NULL (legacy rows)
.where(sql`${table.mealTypes}::jsonb = '[]'::jsonb OR ${table.mealTypes} IS NULL`)
```

**Prevention checklist for new columns:**

1. Write backfill queries with `OR column IS NULL` — never assume the default was applied to existing rows
2. If the column must never be NULL, add `.notNull()` to the schema AND run a backfill migration before deploying queries that depend on the value
3. When writing storage queries that filter on the new column, add a safety-net fallback for NULL (e.g., treat NULL the same as the default value)

**Lesson:** When adding a new column with a default value, always assume existing rows have NULL until a backfill confirms otherwise. The `.default()` in Drizzle's schema is an INSERT-time convenience, not a retroactive data migration.

**Files:**

- `shared/schema.ts` — `mealTypes: jsonb("meal_types").$type<string[]>().default([])`
- `server/services/meal-type-inference.ts` — `backfillMealTypes()` query with `OR ... IS NULL`
- `server/storage/meal-plans.ts` — `getUnifiedRecipes()` filter with `OR ... IS NULL`

---

### getDailySummary LEFT JOIN Rewrite: When Nullable FKs Break INNER JOINs

**Problem:** The `getDailySummary()` storage method used INNER JOIN on `scannedItems` to aggregate daily nutrition. When Phase 4 added meal plan confirmation (creating `dailyLogs` with `scannedItemId: null` and `recipeId` pointing to a meal plan recipe), all confirmed meal plan items became invisible in the daily summary.

**Root Cause:** INNER JOIN drops rows where the join key is NULL. Before Phase 4, every daily log had a non-null `scannedItemId`, so INNER JOIN worked. Making `scannedItemId` nullable (to support meal confirmation logs that reference recipes instead of scanned items) silently broke the aggregation.

```typescript
// Before (Phase 3): INNER JOIN — worked because scannedItemId was always non-null
const result = await db
  .select({ totalCalories: sql`SUM(${scannedItems.calories} * ...)` })
  .from(dailyLogs)
  .innerJoin(scannedItems, eq(dailyLogs.scannedItemId, scannedItems.id));
// Meal plan confirmation logs with scannedItemId=null are silently dropped!

// After (Phase 4): LEFT JOINs with COALESCE fallback chain
const result = await db
  .select({
    totalCalories: sql`COALESCE(SUM(
      COALESCE(CAST(${scannedItems.calories} AS DECIMAL),
               CAST(${mealPlanRecipes.caloriesPerServing} AS DECIMAL), 0)
      * CAST(${dailyLogs.servings} AS DECIMAL)
    ), 0)`,
  })
  .from(dailyLogs)
  .leftJoin(scannedItems, eq(dailyLogs.scannedItemId, scannedItems.id))
  .leftJoin(mealPlanRecipes, eq(dailyLogs.recipeId, mealPlanRecipes.id));
```

**Key details:**

1. The nested `COALESCE` tries `scannedItems.calories` first, falls back to `mealPlanRecipes.caloriesPerServing`, then to `0`
2. The outer `COALESCE(..., 0)` handles the case where SUM returns NULL (no rows for the day)
3. All string-stored numbers need `CAST(... AS DECIMAL)` for arithmetic

**Lesson:** When making a previously non-null foreign key nullable, audit all queries that JOIN on that column. INNER JOINs silently drop rows with NULL keys. This is especially dangerous in aggregation queries because the result looks correct (it's a valid number) — you just don't notice the missing rows.

**File:** `/Users/williamtower/projects/OCRecipes/server/storage.ts` — `getDailySummary()`

**Pattern Reference:** See "LEFT JOIN with COALESCE for Nullable Foreign Keys" in PATTERNS.md

---

## TypeScript Safety Learnings

### Unsafe `as` Casts Hide Runtime Bugs in Tier Lookups

**Problem:** The grocery list deductPantry route used `as SubscriptionTier` to cast the subscription tier string before indexing into `TIER_FEATURES`:

```typescript
// Bug: tier could be any string from the database
const tier = subscription?.tier || "free";
const features = TIER_FEATURES[tier as SubscriptionTier];
// If tier is not in TIER_FEATURES (e.g., "premium_legacy"), features is undefined
// Subsequent features.pantryTracking throws: Cannot read property 'pantryTracking' of undefined
```

**Root Cause:** Drizzle's `text()` columns return `string`, not the union type. The `as SubscriptionTier` cast tells TypeScript the value is valid without performing any runtime check. If the database ever contains a value not in the `subscriptionTiers` tuple (from a migration, manual edit, or future tier rename), the code silently produces `undefined` instead of a valid features object.

**Fix:** Replace the cast with a type guard:

```typescript
function isValidSubscriptionTier(tier: string): tier is SubscriptionTier {
  return (subscriptionTiers as readonly string[]).includes(tier);
}

const tier = subscription?.tier || "free";
const features = TIER_FEATURES[isValidSubscriptionTier(tier) ? tier : "free"];
// Invalid tiers safely fall back to "free"
```

**Lesson:** `as TypeName` is a compile-time-only assertion. It should never be used on data from external sources (database, API, user input) because it provides zero runtime safety. Always use a type guard that performs an actual `includes()` or `in` check, with a safe fallback for invalid values. The one-time cost of writing the guard prevents an entire class of "undefined is not an object" runtime errors.

**Pattern Reference:** See "Type Guard Over `as` Cast for Runtime Safety" in PATTERNS.md

---

### `as` Casts on External API Responses Mask Breaking Changes

**Problem:** The initial receipt-validation implementation used `as` casts to type external API response data:

```typescript
// Bad: Trusts Google's response shape at compile time only
const data = (await response.json()) as {
  access_token: string;
  expires_in: number;
};
const token = data.access_token; // undefined if Google changes the response
```

This was done in three places: the Google OAuth token response, the Google subscription status response, and the decoded Apple JWS payload.

**Why `as` is especially dangerous for external APIs:**

- You don't control the API — the provider can change response shapes in minor updates
- API documentation may be inaccurate or outdated
- Different API versions may return different shapes
- Error responses often have completely different shapes than success responses
- The failure mode is silent: `data.access_token` evaluates to `undefined`, which propagates until it causes a confusing error far from the source

**Fix:** Replace each `as` cast with a Zod schema + `safeParse()`:

```typescript
const googleOAuthResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});

const raw = await response.json();
const parsed = googleOAuthResponseSchema.safeParse(raw);
if (!parsed.success) {
  console.error("Unexpected Google OAuth response:", parsed.error);
  throw new Error("Invalid Google OAuth response");
}
const token = parsed.data.access_token; // Guaranteed to be a string
```

**Key distinction from the existing "Unsafe `as` Casts" learning:** That learning covers `as` on database values (internal data with known schema). This learning extends the principle to external API responses, where the risk is higher because you have zero control over the data source.

**Lesson:** When integrating with any external API, define a Zod schema for each response shape you consume. Use `safeParse()` and handle the failure case explicitly. This creates a clear validation boundary between "untrusted external data" and "validated internal data". Three `as` casts were replaced with three schemas in receipt-validation.ts; the same pattern was already used in recipe-catalog.ts and nutrition-lookup.ts.

**Pattern Reference:** See "Zod safeParse for External API Responses" in PATTERNS.md

**File:** `server/services/receipt-validation.ts`

---

## Key Takeaways

1. **Security:** Authentication + Authorization + Input Validation on every endpoint
2. **React Native:** JWT over cookies, in-memory caching over storage, cleanup over leaks
3. **Simplicity:** Delete unused code, inline over abstraction, explicit over clever
4. **Performance:** Index foreign keys, paginate lists, memoize renders
5. **Types:** Inline response types, proper navigation types, no `any`
6. **Caching:** Fire-and-forget for non-critical ops, hash-based invalidation for user-dependent content
7. **Stubs & Mocks:** Services that grant access must fail-safe in production; derive stub mode from credential presence, not manual flags
8. **Paired Endpoints:** Apply identical safeguards (validation, rate limiting, logging) to both sides of a paired operation (purchase/restore, create/delete)
9. **Testing:** Extract pure functions from RN hooks/components into `*-utils.ts` files for Vitest testability; Vitest cannot parse React Native imports
10. **Data Processing:** Use longest-match for keyword categorization; treat truthy sentinel defaults (`"other"`, `"none"`) as unset with explicit checks
11. **Service Initialization:** Lazy-init external clients (OpenAI, Stripe) to keep modules importable by tests without credentials
12. **Type Safety:** Never use `as` casts on external data — use type guards with safe fallbacks. `as` hides runtime bugs that only surface in production.
13. **Schema Migrations:** When making a FK nullable, audit all JOINs on that column — INNER JOINs silently drop NULL rows, breaking aggregations
14. **External API Safety:** Validate external API responses with Zod `safeParse()`, not `as` casts. External APIs can change without warning; `as` provides zero runtime protection.
15. **Fetch Timeouts:** Always add `AbortSignal.timeout()` to outbound `fetch()` calls. Node.js fetch has no default timeout; hung connections consume server resources indefinitely.
16. **URL Encoding:** Always `encodeURIComponent()` user-supplied values interpolated into URL paths. Template literals make unencoded interpolation feel safe, but it enables URL injection.
17. **Static Imports:** Use static `import` for Node.js built-ins and lightweight dependencies. Dynamic `import()` in hot-path functions adds per-call overhead for no benefit.
18. **Soft Delete:** When adding soft delete, audit ALL queries that read from or join against the table. Aggregation queries are the most dangerous because they return plausible-looking but inflated numbers.
19. **Toggle Transactions:** Check-then-write operations on join tables (favourite, follow, like) must be wrapped in `db.transaction()`. Unique constraints are defense-in-depth, not a substitute for serialization.
20. **Memoized Callbacks:** Inline arrow functions in `renderItem` defeat `React.memo`. Use parameterized ID callbacks `(itemId: number) => void` defined in the parent so the reference is stable.
21. **Optimistic Pagination:** When optimistically removing items from infinite query pages, only decrement `total` on the page that actually contained the item. Decrementing all pages corrupts pagination offsets.
22. **Toggle Icon States:** Toggle action icons must have clearly distinct visual states — change at least color AND label to be accessible.
23. **IDOR Recurrence:** Ownership checks are forgotten more than any other security control. Every `:id` endpoint must verify `resource.userId === req.userId`. Consider a shared `requireOwnership()` helper.
24. **Middleware Consistency:** Use `requireAuth` middleware, not manual `if (!req.userId)` checks. Manual checks are easy to forget, produce inconsistent error formats, and bypass middleware ordering guarantees.
25. **JSONB Safety:** Always `Array.isArray()` before iterating JSONB data and `typeof` before accessing element properties. Drizzle types JSONB as `unknown`, and `as` casts give zero runtime protection.
26. **Parallel Development:** When multiple agents modify shared files (`schema.ts`, `storage.ts`, `premium.ts`), serialize schema changes and use additive-only patterns to minimize merge conflicts.
27. **Adaptive TDEE:** Back-calculate actual TDEE from intake + weight change (`actualTDEE = avgIntake - weightChangeKg * 7700 / days`) rather than relying on static formulas. Empirical measurement over 2+ weeks is significantly more accurate than Mifflin-St Jeor alone.
28. **Whisper Domain Prompts:** Always provide a domain-context prompt to Whisper transcription calls. A single sentence about the topic (e.g., "Food and nutrition logging") dramatically improves accuracy for domain-specific vocabulary.
29. **Express Route Ordering:** Register fixed-path routes (`/api/resource/trend`) before parameterized routes (`/api/resource/:id`) within the same route module. Express matches in registration order, and `:id` greedily captures "trend" as a parameter.
30. **OpenAI Client Initialization Recurrence:** Module-level `new OpenAI()` keeps appearing in new service files (7 out of 8 services). "Document and hope" has failed; this needs a structural fix (shared lazy singleton or lint rule).
31. **Time-Window Dedup for Health APIs:** When deduplicating data from external health/fitness APIs (HealthKit, Google Fit), use a time window (30s-2min) rather than exact timestamp matching. Precision differences between systems cause false negatives with exact matching.
32. **Drizzle `sql<number>` is TypeScript-only:** PostgreSQL DECIMAL/NUMERIC types return as strings through the `pg` driver. Always wrap `sql<number>` results with `Number()` before arithmetic, or use `::float`/`::integer` casts instead of `::decimal` in SQL.
33. **ADD COLUMN defaults are INSERT-time only:** Drizzle's `.default()` sets a DEFAULT constraint for new INSERTs, but existing rows get NULL after `ALTER TABLE ADD COLUMN`. Always write backfill queries with `OR column IS NULL`, and treat NULL as equivalent to the default in storage queries.

---

## Contributing to This Document

When you discover a non-obvious learning during development:

1. Add it to the appropriate section
2. Include code examples showing before/after
3. Explain WHY, not just WHAT
4. Link to relevant commits or files
5. Focus on things that surprised you or weren't obvious
