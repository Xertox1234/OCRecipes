---
title: "A CI stand-in for the AI is wired to one route (an env base URL); a PR that changes which route a call takes silently cuts the stub off — wire it to the route every call tries first, and check stubs whenever routing changes"
track: bug
category: logic-errors
module: server
tags: [testing, harness, ai-prompting, e2e]
applies_to: [server/lib/ai-client.ts, server/lib/ai-models.ts, scripts/ci/stub-openai.mjs, .github/workflows/e2e-regression.yml]
symptoms: ["A nightly E2E flow that depends on a stubbed AI answer ends on its error / \"Try again\" state after an AI-routing PR", "The stub log shows no request for the feature, although the upload reached the server", "Unit tests and the PR's own CI are green: the E2E workflow is schedule-only and never ran on the PR"]
created: '2026-11-03'
severity: high
---

# A CI AI stub is cut off when routing changes

## Problem

The nightly `receipt-upload` Maestro flow gets its AI answer from
`scripts/ci/stub-openai.mjs`. The E2E server had **no OpenRouter key**, so
`receipt-scan` went straight to the OpenAI-direct fallback client, whose
`AI_INTEGRATIONS_OPENAI_BASE_URL` pointed at the stub. That wiring was implicit:
nothing said "this flow depends on receipt-scan taking the OpenAI-direct path".

#1714 moved receipt-scan's backup from OpenAI direct to Vertex direct. With no
OpenRouter key, the call now went to the Vertex backup. The E2E server has no
Vertex credentials, so it threw "no AI route" and the flow would end on "Try again".
That is the same signal the flow uses for a broken upload. #1715 then removed the
OpenAI-direct route entirely. Every unit test and both PRs' CI were green: the
E2E workflow runs on `schedule` / `workflow_dispatch` only. Caught while wrapping
up, before the first nightly run.

## Symptoms

- After a routing PR, a stub-dependent E2E flow fails at its AI step.
- The stub's log shows no request for that feature.
- The PR's CI is green, because the E2E job is not part of it.

## Root Cause

The stub was keyed to a **route** (one client's base URL), and the routing table
decides which route a call takes. Changing a row's backup kind changed the route
under the stub, with no test linking the two.

## Solution (#1716)

- Wire the stub to the route **every** call tries first: the E2E env sets
  `OPENROUTER_API_KEY: sk-stub` and `OPENROUTER_BASE_URL: http://127.0.0.1:4010/v1`.
  The stub matches on request content (receipt prompt + image), so the route
  doesn't matter to it.
- `openRouterBaseUrl(env)` in `server/lib/ai-client.ts` honours the override only
  when NODE_ENV is **explicitly** `development` or `test`. That is an allowlist, as
  with `E2E_RELAXED_RATE_LIMITS`: an unset NODE_ENV (a `railway run`) keeps the
  real host.
- Proved locally with the real stub and no Vertex credentials. With no override,
  "Failed to analyze receipt photo". With the override, "E2E Avocado Nine" via
  OpenRouter. With NODE_ENV unset, the override is ignored.

## Prevention

A PR that changes which client or route an AI call takes (a row's model, backup
kind, or a removed path) greps `scripts/ci/`, `.github/workflows/*e2e*` and
`e2e/flows/` for stand-ins keyed to the old route, and proves the stubbed flow's
call still reaches the stub (stub log line). A schedule-only workflow will not
tell you on the PR.

## Related Files

- `server/lib/ai-client.ts` (`openRouterBaseUrl`), `server/lib/__tests__/ai-client.test.ts`
- `scripts/ci/stub-openai.mjs`, `.github/workflows/e2e-regression.yml`, `e2e/flows/plan/receipt-upload.yaml`

## See Also

- [stub service with a production safety gate](../design-patterns/stub-service-production-safety-gate-2026-05-13.md) — the gate shape the override follows
- [E2E photo picker: select by CI label](e2e-system-photo-picker-select-by-ci-label-not-position-2026-11-01.md) — the same nightly upload flow
