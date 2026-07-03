---
title: CodeQL js/missing-rate-limiting can't trace the _rate-limiters.ts createRateLimiter factory
track: knowledge
category: conventions
module: server
tags: [codeql, code-scanning, rate-limiting, express-rate-limit, false-positive, security]
applies_to: [server/routes/**/*.ts, server/index.ts]
created: '2026-06-26'
---

# CodeQL js/missing-rate-limiting can't trace the _rate-limiters.ts createRateLimiter factory

## When this applies

A CodeQL `js/missing-rate-limiting` (high-severity) alert fires on an Express
route that **does** apply a rate limiter from `server/routes/_rate-limiters.ts`
(`mealPlanRateLimit`, `crudRateLimit`, or a file-local
`const x = createRateLimiter({...})`). The route is genuinely bounded, yet CodeQL
reports it as un-rate-limited.

## Why

`js/missing-rate-limiting` recognizes a rate limiter only when it sees a direct
`rateLimit({...})` call (from `express-rate-limit`) in the route's middleware
chain. Every limiter in this repo is built by the `createRateLimiter()` factory,
assigned to a `const`, and imported at the route. At the
`app.get(path, requireAuth, someRateLimit, handler)` call site CodeQL sees an
opaque imported identifier — not a `rateLimit()` call — and its dataflow does not
bridge the factory return. So it false-positives on the route.

This is **systemic**: as of 2026-06-26 it fired on ~160 routes across `auth.ts`,
`recipes.ts`, `verification.ts`, `meal-plan.ts`, `recipe-catalog.ts`, etc. —
essentially every authenticated route. They do not block PRs (they aren't "new"),
but each new factory-limited route regenerates one.

## Examples

**Existing route flagged → verify the limiter is real, then dismiss as a false
positive.** Never blind-dismiss: confirm the route's middleware window actually
references a `_rate-limiters.ts` limiter (an imported export **or** a file-local
`const x = createRateLimiter(...)` — both are untraceable to CodeQL). A route with
no limiter anywhere is a **real** finding — fix or surface it, never dismiss.

```bash
gh api -X PATCH repos/<owner>/<repo>/code-scanning/alerts/<id> \
  -f state=dismissed -f dismissed_reason='false positive' \
  -f dismissed_comment='Route applies <limiter> (createRateLimiter factory); CodeQL cannot trace the re-exported factory-built limiter.'
```

(The PR-diff "CodeQL" check is scoped to `refs/pull/<n>/merge`, not the branch
head ref — query alerts on the merge ref, and confirm the alert's
`most_recent_instance.commit_sha` matches your latest commit, before concluding
anything. An empty `?ref=refs/heads/<branch>` query means "no analysis on that
ref," not "clean.")

**New route where you want the alert to NOT appear → inline the `rateLimit()` at
the route** so CodeQL can trace it. Reuse the shared `ipKeyGenerator` for correct
X-Real-IP/Railway keying:

```ts
import { rateLimit } from "express-rate-limit";
import { ipKeyGenerator } from "./routes/_rate-limiters";

app.get(
  "/api/health",
  rateLimit({
    windowMs: 60_000,
    max: 600,
    keyGenerator: ipKeyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "...", code: "RATE_LIMITED" },
  }),
  handler,
);
```

The inline form is traced → the alert self-clears on the next scan (verified:
PR #460 cleared alert #10 to `fixed`). The dominant codebase convention is still
the factory + dismiss-FP; reserve inline for the rare route where a clean CodeQL
baseline matters (e.g. a deploy-critical public endpoint).

## Exceptions

- An alert on a route with **no** rate limiter at all is NOT this false positive —
  it is a real finding (e.g. a public endpoint doing DB work). Fix it, don't
  dismiss. (That was alert #10, `GET /api/health`, fixed in PR #460.)
- Prefer **per-alert** dismissal over a blanket CodeQL query-suppression: it keeps
  the rule live to catch the next genuinely un-limited route. Blanket suppression
  would hide real gaps.
- A "false positive" dismissal is only honest if the limiter genuinely exists —
  it suppresses a tracing gap, not a missing guard.

## Related Files

- `server/routes/_rate-limiters.ts` — the `createRateLimiter` factory + the
  shared `ipKeyGenerator` (X-Real-IP/Railway keying)
- `server/index.ts` — `/api/health` inline-limiter example (commit `56225036`)

## See Also

- _(none yet)_
