---
title: Narrowing what an env-derived flag accepts breaks tests elsewhere that leaned on the local .env — they pass locally and fail only on CI
track: bug
category: logic-errors
module: server
severity: low
tags: [testing, api, ci, dotenv, process-env, test-isolation]
applies_to: [server/routes/__tests__/*.test.ts, server/lib/__tests__/env.test.ts, server/lib/openai.ts, server/lib/ai-config.ts, server/lib/env.ts]
symptoms: [Full local suite green but CI test shards red right after a config-flag change, Route tests far from the changed file get 503 on CI, An "expect no warnings" env test catches a new warning on CI only, The failing tests are not in the diff]
created: '2026-11-19'
---

# Narrowing what an env-derived flag accepts breaks tests elsewhere that leaned on the local .env

## Problem

Reliability audit M-rel-3 (PR #1934) changed `isAiConfigured` from "an OpenAI key
is set" to "an AI chat route exists" (OpenRouter, or the full Vertex set). The full
local suite passed: 17026 tests. On CI, 18 tests in three files the PR had barely
touched failed:

- `meal-plan.test.ts` and `recipe-generate.test.ts`: every request got 503 from
  `checkAiConfigured`;
- `env.test.ts`: two IAP tests that expect no `APPLE_|GOOGLE_` warnings caught the
  new "no AI route" warning, because it names `GOOGLE_VERTEX_*`.

## Root Cause

`test/setup.ts` loads `dotenv/config`, so every local test sees the developer's
`.env`, which sets `OPENROUTER_API_KEY` and the Vertex variables. CI sets only
`AI_INTEGRATIONS_OPENAI_API_KEY: sk-stub`. Under the old meaning both satisfied the
flag; under the new one only the laptop did. The tests never set the flag
themselves. They passed because the machine running them happened to qualify, so
the change's own test run could not show the break.

The env test had a second link: its warning filter matches on a name prefix
(`GOOGLE_`) that two unrelated features share (Play IAP and Vertex).

## Solution

Make each test set the flag it depends on instead of reading the machine:

```ts
vi.mock("../../lib/openai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/openai")>()),
  isAiConfigured: true,
}));
```

In `env.test.ts`, set the route in the block's `beforeEach`
(`process.env.OPENROUTER_API_KEY = "sk-or-test"`), since `validateEnv` reads
`process.env` directly. The flag's own rule stays tested where it lives
(`server/lib/__tests__/openai.test.ts`, which re-imports the module per case).

## Prevention

- **When a change narrows an env-derived flag, run the suite with the inputs it now
  requires blanked** before pushing, e.g.
  `OPENROUTER_API_KEY= GOOGLE_VERTEX_PROJECT= GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL= GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY= npx vitest run <files>`.
  Blank them, don't unset them: dotenv never overrides a variable that's already
  set, even to an empty value. Here that reproduced CI's exact 18 failures.
- Find the tests to run by the flag's consumers, not the diff: grep for the guard
  helper (`checkAiConfigured`) and the flag across `__tests__/`.
- A test that reaches an env-derived gate pins it (mock at the module boundary, or
  set `process.env` in the test). A green local run proves nothing about a test
  that reads the machine.

## Related Files

- `server/lib/openai.ts`, `server/lib/ai-config.ts`: `isAiConfigured`, `hasAiChatRoute`
- `server/routes/_helpers.ts`: `checkAiConfigured`, the 503 gate
- `test/setup.ts`: the dotenv load
- `.github/workflows/ci.yml`: the test jobs' env

## See Also

- [CI job without DATABASE_URL cannot import db.ts](../runtime-errors/ci-job-without-database-url-cannot-import-db-ts-2026-11-06.md): the same dotenv masking, for an import-time throw; origin of the blank-don't-unset trick
- [An uncontrolled ambient input makes the check agree with what it checks](an-uncontrolled-ambient-input-makes-the-check-agree-with-what-it-checks-2026-08-31.md): the general principle
