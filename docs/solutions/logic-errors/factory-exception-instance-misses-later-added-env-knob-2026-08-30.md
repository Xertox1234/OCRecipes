---
title: A raw-constructed exception to a middleware factory silently misses knobs later wired into the factory
track: bug
category: logic-errors
tags: [api, security, architecture, rate-limiting, testing]
module: server
applies_to: ["server/routes/_rate-limiters.ts", "server/routes/**/*.ts"]
symptoms: ["an env knob demonstrably works for most instances of a middleware but one endpoint still behaves at production settings", "a limiter 429s with a body byte-identical to a relaxed limiter's, making the knob look broken", "the unaffected instance is the one documented as a deliberate factory exception"]
created: 2026-08-30
severity: medium
---

# A raw-constructed exception to a middleware factory silently misses knobs later wired into the factory

## Problem

`E2E_RELAXED_RATE_LIMITS` was wired into `createRateLimiter` (`max:
resolveRateLimitMax(options.max, process.env)`), relaxing every
factory-built limiter for the E2E suite. But `loginAccountLimiter` is the
documented factory *exception* — built with raw `rateLimit()` because it
needs a body-derived `keyGenerator` — and its hardcoded `max: 10` never saw
the knob. Every E2E flow logs in as the single shared CI account, so a
failed-login flake storm (the exact modes the suite documents) would 429
every later flow's login — with a response body byte-identical to the
relaxed `loginLimiter`'s, i.e. presenting as "the relaxation knob doesn't
work" during the very diagnostic runs the knob was added to make legible.

## Symptoms

See frontmatter. The discriminator: reconstruct the store key (here
`login-account:<username>`) and check which limiter actually fired — the
identical 429 bodies (deliberate, to avoid an account-existence oracle) make
the response indistinguishable.

## Root Cause

The exception comment explained WHY the instance bypasses the factory (the
`keyGenerator`), but bypassing the factory also bypasses everything the
factory learns later. Nothing — no shared constant, no test, no comment on
the factory side — tied the exception instance to factory-level policy
changes, so the knob's author had no prompt to visit it.

## Solution

Wire the shared resolver into the raw construction directly
(`max: resolveRateLimitMax(10, process.env)`), and pin the behavior with
**endpoint-level** tests per docs/rules/testing.md: N requests pass, the
(N+1)th returns 429, for BOTH the factory path and the exception instance
(module re-import per case for the module-scoped one — fresh MemoryStore,
fresh env read). Pure-function tests of the resolver alone stay green if any
construction stops calling it.

## Prevention

When adding a knob or policy to a middleware factory, grep for raw
constructions of the same underlying middleware (here: `rateLimit(` call
sites outside the factory) and wire each one explicitly — a "documented
exception" is precisely the instance the factory change will miss. The
factory-exception comment should name what the instance must track manually.

## Related Files

- `server/routes/_rate-limiters.ts` — factory + the exception instance
- `server/routes/__tests__/_rate-limiters.test.ts` — the endpoint-level
  N+1→429 suites for both paths

## See Also

- [create-rate-limiter-factory](../design-patterns/create-rate-limiter-factory-2026-05-13.md) — the factory this instance deliberately bypasses
- [wire-optional-defense-in-depth-parameters](../conventions/wire-optional-defense-in-depth-parameters-2026-05-13.md) — the same every-call-site discipline for optional params
