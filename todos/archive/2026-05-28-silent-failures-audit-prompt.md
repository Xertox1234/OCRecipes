---
title: "Audit prompt: comprehensive silent-failure sweep"
status: done
priority: medium
created: 2026-05-28
updated: 2026-05-28
assignee:
labels: [audit, error-handling, client-state]
github_issue:
---

# Audit prompt: comprehensive silent-failure sweep

This is the saved kickoff prompt for a full `/audit` of silent failures, expanding
the scoped 2026-05-28 investigation. Paste the block below as your message to
launch the audit skill. (Saved in `todos/` because `docs/audits/` is gitignored.)

```
/audit silent-failures

GOAL: Systematically find every "silent failure" in the app — any operation that
can fail while giving the user NO visible error and NO retry affordance (blank
screen, infinite spinner, empty state indistinguishable from "no data", or —
worst — confident WRONG data). This expands a scoped 2026-05-28 investigation
into a complete, tracked pass.

STRUCTURAL ROOT (already known): client/lib/query-client.ts:124 builds the
QueryClient with no global QueryCache/MutationCache onError, so every screen must
surface its own errors and many don't.

ALREADY FILED — dedup against these, do NOT re-report them:
- todos/2026-05-28-daily-nutrition-detail-silent-query-failure.md
- todos/2026-05-28-home-screen-silent-query-failure.md
- todos/2026-05-28-data-hooks-hide-query-error.md  (useProfileData, useHistoryData)
- todos/2026-05-28-coach-reminders-phantom-state-on-read-failure.md
- todos/2026-05-28-coach-chat-blank-thread-on-history-failure.md
- todos/2026-05-28-global-query-error-handler.md
- todos/2026-05-28-nutrition-lookup-infinite-spinner-dead-branch.md
- todos/2026-05-28-scan-ocr-swallow-and-vestigial-params.md

COVER SYSTEMATICALLY (the gaps the scoped pass did NOT exhaust):
1. Every useQuery/useInfiniteQuery CONSUMER (screens + components). For each,
   confirm it renders a visible error/retry on failure — not merely that it
   references isError. The ~30 hooks flagged NO-ERR-REF were not each opened;
   open them. Explicitly include DiscoveryCarousel (client/components/home/).
2. Data hooks that STRIP isError/error from their return object, forcing every
   consumer to be silent (the most corrosive class).
3. Every useMutation: confirm onError produces USER-VISIBLE feedback, not just
   haptics/console. (~91 onError handlers were counted, not individually checked.)
4. Swallowed errors: empty catches, catch-then-console-only, .catch(()=>{}),
   __DEV__-gated catches (zero output in production), and fire-and-forget
   `void promise` / unhandled rejections where failure should be visible.
5. Optimistic updates with no rollback on failure.
6. Fallback chains that return empty/undefined instead of erroring.
7. SERVER routes: any catch that returns 200 / empty array / empty object instead
   of a 4xx/5xx (client sees "success", user sees nothing). The server looked
   well-disciplined from a SAMPLE only — verify route-by-route. Also check SSE/
   streaming error propagation and fire-and-forget background work.

FOR EACH FINDING, RECORD:
- file:line, severity, and a one-line "what the user sees on failure".
- REACHABILITY: trace the CONSUMER and confirm it can actually fire today vs.
  latent. (In the prior pass, tracing consumers correctly demoted two
  scary-looking findings — a swallowed OCR catch whose output was discarded, and
  an infinite-spinner branch with no caller. Do the same; don't report on the
  catch/missing-isError alone.)
- The genuine-empty-vs-error caveat: distinguish "0 / empty because there's truly
  no data" from "0 / empty because the fetch failed" — the naive fix mislabels a
  legitimate empty state as an error.

PROCESS (per the audit skill): serialize every finding to
docs/audits/2026-05-28-silent-failures.md; verify each item by re-reading code
(and running tests where relevant) before marking it; dedup against
docs/audits/CHANGELOG.md AND the 8 todos above; close with zero open findings
(each verified, deferred-with-todo, or marked false-positive). Do NOT apply fixes
in this pass — this is discovery + manifest only.
```

## Updates

### 2026-05-28

- Saved the audit kickoff prompt so it survives across sessions.
- Audit ran (discovery-only): 46 findings in `docs/audits/2026-05-28-silent-failures.md`,
  deferred into 5 cluster todos. All 5 clusters + the 8 originally-filed todos are now
  `status: done` and archived (commits #253–#266). Closing this kickoff prompt — its
  purpose is fully served.
