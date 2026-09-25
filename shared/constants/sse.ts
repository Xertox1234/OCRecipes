/**
 * Server-Sent Events (SSE) timeout ceilings shared between the server route
 * that enforces them and the client hook that must stay ordered beneath them.
 *
 * `SSE_TIMEOUT_MS` is the server's own cap on a coach chat SSE connection
 * (`server/routes/chat.ts`). It must stay below `client/hooks/useCoachStream.ts`'s
 * `STREAM_INACTIVITY_MS`, which must stay below its `XHR_TIMEOUT_MS` — on a
 * live connection the server's own graceful `{ error: "Response timeout" }`
 * always arrives first, and the client ceilings only fire on a dead or
 * half-open connection. Importing this constant on both sides (instead of
 * hand-copying the literal) keeps that ordering from silently drifting apart
 * if the server value ever changes.
 */
export const SSE_TIMEOUT_MS = 120_000; // 2 minutes max per SSE connection
