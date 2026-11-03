---
title: "A live AI check that judges success from the reply text passes when the service turns the AI error into an apology — assert on the call records"
track: bug
category: logic-errors
module: server
tags: [ai-prompting, testing, fail-open, evals]
applies_to: [scripts/ai-backup-gate.ts, scripts/ai-smoke.ts, evals/**/*.ts, server/services/coach-pro-chat.ts, server/services/recipe-chat.ts]
symptoms: ["A live gate or smoke reports every sample clean while the provider was failing", "Reply text is a friendly apology (\"Sorry, I couldn't…\") and the check counts it as an answer", "A sample whose AI calls all failed records zero calls and still passes"]
created: '2026-11-03'
last_updated: '2026-11-03'
severity: medium
---

# A live AI check that judges success from the reply text passes when the service swallows the AI error

## Problem

`scripts/ai-backup-gate.ts` (PR #1706) runs each row's real service function through the
Vertex backup route and must fail if the backup does not work. The chat services (coach,
coach-pro, recipe chat) catch `aiChat` errors and yield apology text to the user. The first
draft of the gate passed a sample when it had non-empty text and no thrown error. Both
reviewers (code-reviewer, ai-reviewer) found that this fails open:

- A failed Vertex call produced apology text, so "has text" was true.
- A failed backup call writes **no** success record, so "every call was on Vertex"
  was vacuously true over an empty list.
- In the coach-pro switch modes, an error record has `answeredProvider: null`, and a
  "this call is not on Vertex" test is true for `null`, so a failed call counted as the
  OpenRouter leg of the route pair.

## Symptoms

- Every sample is reported clean during a provider outage.
- The sample's text is an apology rather than an answer.
- `calls` is empty, or every record has `error` set.

## Root Cause

The service boundary is designed to hide AI failures from the user, so the user-visible
output cannot tell success from a handled failure. Only the per-call records from
`withAiCallContext` keep the difference. Checks phrased as "every call…" are true over an
empty list.

## Solution

`gateProblems(sample)` reads the records, not the text. A sample fails on:

- any record with `error` (`call error: …`);
- a `length` finish, or a success record with a null `finishReason` (a cut stream);
- empty text;
- in backup mode, zero records (`no AI call recorded`) or any record not answered by
  `vertex`;
- in switch modes, no tool round, or a first/second call that is not an **error-free**
  record with a non-null provider on the intended route (`route pair wrong`).

Three tests were written failing first (the apology sample, the zero-call sample, and the
error-record route pair), then the checks were added.

### Update (PR #1711): a clean call record is not a working feature

14 of the 21 text rows catch a bad reply (unparseable JSON, a schema miss, a timeout) and
return a stand-in value: `[]`, `null`, `FALLBACK_QUESTIONS`, the deterministic art
direction, `previousResult`. When the reply arrived but failed validation, the call record
is clean (`stop`, no `error`), so record checks pass. Each driver in
`scripts/ai-backup-gate-text-rows.ts` compares the result with its service's stand-in and
sets `degraded`, which `gateProblems` reports as `fallback value: …`. It caught art
direction rejecting every Gemini answer (`too_big`) on records that looked perfect.

## Prevention

- In any live check of AI behaviour that goes through a service: require at least one
  record, reject any record with `error`, and treat a quantifier over records as failing
  when the list is empty.
- A negated provider test (`provider !== "vertex"`) also matches `null`; require a
  non-null provider before reading which one it is.
- For a service with a stand-in value, the check also compares the result with that
  stand-in (reference equality or deep-equal), not only the call records.
- Test the gate with a fabricated failing sample of each kind (apology text, no records,
  error records in the route pair), not only with real passing runs.

## Related Files

- `scripts/ai-backup-gate.ts` (`gateProblems`, `GateSample`)
- `scripts/__tests__/ai-backup-gate.test.ts`
- `server/lib/ai-call-context.ts` (`AiCallRecord`)

## See Also

- [fail-open scanner wrapper](fail-open-scanner-wrapper-error-envelope-not-clean-scan-2026-07-12.md) — the same collapse of "failed" into "clean" in a tool wrapper
- [Vertex reasoning tokens count against the cap](vertex-gemini-reasoning-tokens-count-against-completion-cap-2026-11-03.md) — the empty-reply failure this gate surfaced
