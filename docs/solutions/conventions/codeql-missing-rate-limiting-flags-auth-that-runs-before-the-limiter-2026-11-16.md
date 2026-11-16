---
title: CodeQL missing-rate-limiting flags requireAuth before the limiter — a false positive
track: knowledge
category: conventions
tags: [security, api, codeql, rate-limiting, ci]
module: server
applies_to: ["server/routes/**/*.ts"]
created: 2026-11-16
---

# CodeQL's missing-rate-limiting alert points at requireAuth when the limiter runs after it

## Rule

A new authenticated route gets its limiter built inline with `rateLimit({...})` after `requireAuth`, keyed by user with the IP fallback. If CodeQL still raises `js/missing-rate-limiting` on it, do not restructure the route: confirm the alert's line is the `requireAuth` line, then ask the owner to dismiss it as a false positive (or dismiss it on their instruction). Never describe the CodeQL check as optional.

## Smell patterns

- The alert text is "This route handler performs authorization, but is not rate-limited", and its line number is the `requireAuth,` line of a route that has a limiter two lines below.
- The same alert reappears after moving a limiter from the `_rate-limiters` factory to an inline `rateLimit({...})`.

## Why

The query wants a limiter before the handler that performs authorization. The house pattern puts the limiter after `requireAuth` on purpose, so `keyGenerator` can use `req.userId`. Inlining the limiter makes it visible to the query's dataflow, which matters for the handler that follows it, but it does not change the ordering the alert is about.

Moving the limiter ahead of `requireAuth` would satisfy the query and silently key every request by IP (`req.userId` is not set yet), so users behind one address would share one budget.

The "CodeQL" results check fails on any new open alert. `Analyze (javascript-typescript)` is the analysis job and passes regardless. Dismissing the alerts turns the results check green without a new push.

## Examples

Dismissed on the same grounds: alerts on `coach-write-cards.ts`, `ai-sharing.ts`, `profile.ts`, `coach-context.ts`, and 330–334 on `server/routes/family.ts` (2026-11-16).

Dismissing takes one mutating GitHub API call per alert: a PATCH to `repos/<owner>/<repo>/code-scanning/alerts/<n>` with `state=dismissed`, `dismissed_reason="false positive"` and a `dismissed_comment` saying why. The outward-CLI guard requires its bypass variable as the first text of the command, so a loop over several alerts goes in a script file that is run with the bypass in front of `bash`, not typed as an inline loop.

## Exceptions

A route with no limiter at all, or an unauthenticated route: the alert is real. Add the limiter.

## Related Files

- `server/routes/family.ts`, `server/routes/coach-write-cards.ts` — the inline pattern
- `server/routes/_rate-limiters.ts` — `ipKeyGenerator`, `resolveRateLimitMax`

## See Also

- [CodeQL clear-text logging on error-code names](codeql-clear-text-logging-flags-error-code-names-2026-10-11.md) — another CodeQL false-positive class
