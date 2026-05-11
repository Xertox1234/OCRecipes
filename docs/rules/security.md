# Security Rules

- IDOR: every resource lookup must scope by `userId` AND visibility (`eq(t.isPublic, true)` or `eq(t.authorId, userId)`) — this applies to reads, not just mutations
- isPublic guard must appear on BOTH the read path AND the write path of storage functions that accept user-supplied IDs — a write path that inserts without filtering can associate private resources with a user, leaking their metadata (title, cuisine, imageUrl) via the subsequent read
- Storage update functions must accept an explicit field whitelist — never `Partial<User>` or spread of arbitrary input (enables mass-assignment)
- Sanitize ALL prompt roles (`user`, `assistant`, `system`) before sending to OpenAI — never only `user` role
- Rate-limit all AI/OpenAI endpoints — every new AI route needs a rate limiter from `server/middleware/rate-limiter.ts`
- Premium-gate BOTH read AND write endpoints for premium features — gating only the write path leaves data readable for free
- Never trust parameters that "look server-generated" in AI prompt inputs — always sanitize at the prompt boundary
- All route request bodies must be Zod-validated before any field access — never `req.body.x` without a schema parse
- `req.userId` is a string (UUID) — never parse with `parseInt` (returns NaN, bypasses ownership checks silently)
