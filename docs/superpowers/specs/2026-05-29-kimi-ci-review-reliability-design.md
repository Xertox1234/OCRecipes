# Kimi CI Review — Reliability Hardening Design

**Date:** 2026-05-29
**Status:** Approved (design) — pending implementation plan
**Author:** brainstorming session
**Related:** [docs/kimi-review-architecture.md](../../kimi-review-architecture.md) (single source of truth), [2026-05-18-kimi-false-positive-prevention-design.md](2026-05-18-kimi-false-positive-prevention-design.md)

---

## 1. Problem

The "Kimi Review" GitHub Actions workflow has failed repeatedly, generating
failure emails. Investigation of the recent runs shows **every failure is a tool
error (engine exit code ≠ 2), never a real CRITICAL finding (exit 2)**. The
reviewer crashed before reaching a verdict each time.

Three failures, three distinct crash points, all in the CI-only path
(`--verify agentic`, which fails **closed** in `scripts/ci-kimi-review.sh`):

| Run         | Failure message                                                  | Duration | Phase              | Engine code                                                          |
| ----------- | ---------------------------------------------------------------- | -------- | ------------------ | -------------------------------------------------------------------- |
| 26597724693 | `ran out of tokens — raise --max-tokens`                         | 56s      | **Draft**          | `kimi-review.py:591` (`if not answer`) — empty `message.content`     |
| 26601747543 | `request failed: Expecting value: line 937 column 1 (char 5148)` | 3m19s    | **Draft**          | `:582` (`except Exception`) — SDK could not JSON-parse the HTTP body |
| 26598449204 | `timed out after 300s`                                           | 5m20s    | **Agentic verify** | `ci-kimi-review.sh:135` (`timeout 300`) → exit 124                   |

### Why it only happens in CI

The two local commit gates (`.claude/hooks/kimi-review.sh`, `.husky/pre-commit`)
use `--verify deterministic` (no LLM loop) and **fail open** on any non-2 exit.
Only CI runs the slow, token-hungry `--verify agentic` loop **and** fails closed,
so transient API hiccups that are silently skipped locally become failed PRs
and emails.

### Why this is noise, not a gate

`main` is **not a protected branch**; there are no rulesets and no required
status checks. The Kimi Review job blocks zero merges. Low-priority todos merge
directly (no PR), so the **failure email is effectively the only notification
channel.** The failures are advisory noise — but the user wants the gate to keep
working as a real guardrail, not to be disabled.

### Evidence the failures are transient (retryable)

The same PR head both fails and passes across re-runs:

- DailyNutrition: 56s failure → 50s pass.
- CoachReminders: pass → 5m20s failure → 3m49s failure (and an earlier pass).

Pass-on-rerun with an unchanged SHA ⇒ transient ⇒ retryable.

---

## 2. Goal & non-goals

**Goal:** Make the CI review run **reliably to completion** so it stops crashing
on transient API behavior, while keeping the gate **strict** — a real CRITICAL
still blocks, and the user is still notified when something needs attention.

**Decision trail (user-chosen):**

1. Primary outcome = **"Make it reliable"** (harden the engine; do not disable,
   do not blanket fail-open).
2. Deadline rule = **keep-on-deadline (notify me)**: when verification cannot
   finish in time, the CRITICAL stays CRITICAL so the job fails and emails — a
   _meaningful_ "found a CRITICAL, couldn't verify it in time" signal rather than
   a random crash.

**Non-goals:**

- Not changing the exit-code contract or CI's fail-closed-on-tool-error policy
  (architecture §6). Transient failures simply stop _reaching_ the non-2 path.
- Not adding branch protection or changing the merge workflow.
- Not adding GitHub annotations / step-summary visibility (considered and
  declined for this iteration — keep-on-deadline already delivers the email
  signal the user wanted).
- Not lowering `max_turns` or capping CRITICAL count (would weaken accuracy;
  rejected as "Approach 3").

---

## 3. Approach (selected: "Approach 2 + keep-on-deadline")

A single global deadline plus a deadline-aware retry layer:

- **(0) One global deadline** (engine-start + budget) — the spine both other
  pieces check, so the total wall-clock can never exceed budget + one in-flight
  call.
- **(a) Deadline-aware retry layer** around every model call — absorbs the
  transient draft crashes (empty content, malformed body) without ever
  overrunning the budget.
- **(b) Verify phase bound to the global deadline** with keep-on-deadline —
  absorbs the SIGTERM by producing a graceful verdict before the external
  timeout.
- **(c) Client tuning** — engine-owned retries; per-call timeout unchanged.

All engine logic changes land in the shared canonical engine
(`~/.local/share/claude-coworker/tools/kimi-review`), so they also affect other
consumers (plant_id, `kimi-multi-review`). With the per-call timeout left at 90s
(see 4c), these changes only ever turn _failures_ into _successes_ — they add no
new way for a previously-passing call to fail — so the cross-project effect is
safe. It is still called out as a known cross-project change in §7.

---

## 4. Components

### 4(0) One global deadline (the spine of the budget)

A **single monotonic deadline** is computed once at engine start, immediately
after arg-parse:

```python
# budget_seconds = int(os.environ.get("KIMI_REVIEW_BUDGET_SECONDS", "330"))
deadline = time.monotonic() + budget_seconds
```

It governs **both** the draft and the verify phase — one shared wall clock.
This is deliberate: a _per-phase_ verify budget (computed from verify-start) lets
a slow, retry-heavy draft push the verify deadline arbitrarily late and overrun
the external backstop (review blocker A). A global deadline means time the draft
spends on retries simply shrinks the verify window; the total can never exceed
`budget_seconds` + one in-flight call. The deadline is threaded into every place
a model call can happen (4a) and every loop boundary (4b).

### 4(a) `call_with_retry(client, *, validate, deadline=None, retries=2, base_delay=1.0, **kwargs)`

New wrapper around `client.chat.completions.create`. **Deadline-aware** (blocker
A): before each attempt it checks `if deadline and time.monotonic() >= deadline:
raise BudgetExceeded(...)` — so a retry sequence cannot run past the global
budget. Retries on:

1. **Exceptions** — connection/timeout/5xx/429 (SDK subclasses of `Exception`)
   **and** the malformed-200-body `JSONDecodeError` that produced the
   `Expecting value…` crash.
2. **Empty content** — via a `validate(resp)` predicate that returns `None` when
   acceptable or a reason string otherwise. **Truncation (`finish_reason ==
"length"`) is NOT retried** (blocker C): `:588` already fast-fails it, every
   retry re-bills the full 131072-token input, and no observed failure was a
   `length` truncation — so retrying it spends the most budget/money on the
   least-recoverable, unobserved case.

Backoff is `base_delay * (2 ** attempt)`. After `retries` attempts (or a
`BudgetExceeded`) the error propagates; the caller decides what it means.
`base_delay` is a parameter so tests inject `0` and never sleep.

Call sites and their validators:

| Call site                                            | `validate` / on-failure                                                            | Effect                                                                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Draft call (`main`, `:569`)                          | reject **empty content only**; `length` falls through to existing `:588` fast-fail | empty draft now **retries**; if retries/budget exhausted → existing non-2 exit (CI fails closed — correct for a persistent failure) |
| Verify-verdict call (`verify_one_agentic`, `:458`)   | reject empty content                                                               | transient empty verdict retries; any unrecoverable failure → caught by `verify_one_agentic` → `keep_unverified` (see 4b)            |
| Verify tool-loop turn (`verify_one_agentic`, `:439`) | `None` (accept any success)                                                        | empty content **with** `tool_calls` is legitimate and must not be treated as a failure                                              |

`max_retries=0` on the client (see 4c) means this wrapper is the sole retry
layer; it preserves the SDK's former connection/5xx coverage (those raise
`Exception` subclasses the wrapper catches) and adds empty-content coverage the
SDK never had.

### 4(b) Verify phase respects the global deadline (keep-on-deadline)

The global `deadline` (4.0) is threaded into both verify functions. Two coupled
mechanisms are required — a budget on the waiter alone is meaningless because
`ThreadPoolExecutor` workers are non-daemon and block interpreter exit.

**`verify_one_agentic(finding, client, model, root, max_turns=5, tree_ref=None, deadline=None)`:**
checks the deadline at **two** points (blocker D — a single turn-top check still
lets a final turn stack the tool-call create _and_ the verdict create, ~2×timeout
of overrun):

1. at the **top of each turn** (`:438`): `if deadline and time.monotonic() >=
deadline: return "keep_unverified"`;
2. **immediately before the verdict call** (`:458`): same check.

It also wraps its model calls so **any** unrecoverable outcome — `BudgetExceeded`,
retries exhausted, or an unparseable verdict — resolves to a verdict string and
**never propagates an exception** (so `fut.result()` in 4b's waiter can't raise).
On a deadline/budget hit → `"keep_unverified"`; on a parsed refute/uncertain →
`"downgrade"`; on a non-deadline failure to verify at all → `"keep_unverified"`
(keep-on-deadline philosophy: never lose a CRITICAL to a verify error). This caps
a straggler's drain at **one** in-flight call (≤ one client timeout), not two.

**`verify_agentic(..., deadline=None)`:** replace the
`with ThreadPoolExecutor() as ex:` form (which calls `shutdown(wait=True)` on
exit and re-blocks on stragglers) with an explicit `try/finally`, and **harvest
late completions** (blocker E):

```python
ex = ThreadPoolExecutor(max_workers=max(1, jobs))
try:
    futs = {ex.submit(verify_one_agentic, findings[i], client, model, root,
                      max_turns, tree_ref, deadline): i for i in targets}
    remaining = (deadline - time.monotonic()) if deadline else None
    try:
        for fut in as_completed(futs, timeout=remaining):
            verdicts[futs[fut]] = fut.result()
    except concurrent.futures.TimeoutError:
        for fut, i in futs.items():
            # E: a future may be DONE but not yet harvested when the waiter
            # times out — take its real verdict; only un-done ones are kept.
            verdicts[i] = fut.result() if fut.done() else "keep_unverified"
finally:
    ex.shutdown(wait=False, cancel_futures=True)  # 3.9+; CI runs 3.12
return verdicts
```

`shutdown(wait=False, cancel_futures=True)` lets `verify_agentic` return
promptly; the per-turn + pre-verdict deadline checks let the worker threads exit
so the **process** can exit (see blocker F note in §7). Together they make the
global budget real.

### 4(b.1) Verdict vocabulary — three tokens

`verify_one_agentic` now returns one of:

| Verdict             | Meaning                                                                                          | `apply_downgrades` effect                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `"keep"`            | verified — claim holds                                                                           | unchanged (stays CRITICAL)                                                                      |
| `"downgrade"`       | refuted / uncertain (a _parsed_ verdict)                                                         | CRITICAL→WARNING + existing `[downgraded: unverified against code]` marker                      |
| `"keep_unverified"` | could not complete verification — deadline/budget hit, retries exhausted, or unparseable verdict | stays CRITICAL + new `[kept: verification budget exhausted — re-run or review manually]` marker |

Note: a _parsed_ refute/uncertain verdict is still a real verification result and
downgrades (monotonic, never blocks). `keep_unverified` is reserved for the case
where verification never reached a verdict at all — that one keeps + notifies.

`apply_downgrades` is extended to handle `keep_unverified`: keep the tier, append
the budget-exhausted marker. **Monotonicity is preserved** — `keep` and
`keep_unverified` never lower or raise a tier; only `downgrade` lowers. The
distinct token ensures the budget-exhausted marker is applied **only** to
deadline-hit findings, never to genuinely-verified ones.

### 4(c) Client tuning

`OpenAI(api_key=…, base_url=…, timeout=90.0, max_retries=0)`:

- `timeout` **stays 90s** (blocker B): lowering a per-call timeout is the one
  change here that can turn a slow-but-valid completion into a _failure_ — a
  regression, not "robustness." The budget is now enforced by the global deadline
  (4.0), not by shrinking the timeout, so there is no reason to lower it. Blast
  radius matters: this is the shared canonical engine, and large-diff consumers
  (plant_id, `kimi-multi-review`) are exactly the ones a 60s cap would start
  failing.
- `max_retries` (default 2) → 0: disable the SDK's hidden retries so they don't
  compound latency; `call_with_retry` owns retry now.

### 4(d) CI hard-timeout headroom

In `scripts/ci-kimi-review.sh`, raise the default
`KIMI_REVIEW_TIMEOUT_SECONDS` 300 → 480. This external `timeout` becomes a pure
backstop: the engine's internal global budget (330s, 4.0) trips **first** and
emits a real keep/`keep_unverified`/downgrade verdict + exit code, instead of the
external SIGTERM (exit 124). Typical runs (30–60s) are unaffected; only
pathological slow runs reach the budget, and they now end gracefully.

**Budget arithmetic (honest worst case).** Because the deadline is _global_ and
checked before every model call (4.0, 4a) and at every loop boundary (4b), the
worst case is no longer the sum of independent phase budgets:

```
process exits by:  budget (330s)  +  one in-flight call draining (≤ 90s timeout)
                =  ≤ 420s   <   480s external backstop      (60s margin)
```

The pre-verdict check (blocker D) is what caps the drain at **one** call (≤90s)
rather than two (≤180s). A retry-heavy draft does not blow this: time it spends
shrinks the shared verify window rather than extending the deadline (blocker A).
All values are tunable env/constants; the binding invariant is
`backstop ≥ budget + client_timeout + margin` (480 ≥ 330 + 90 + 60).

---

## 5. Error-handling contract (preserved)

The exit-code contract (architecture §6) is unchanged:

| Exit  | Meaning                                       | CI action        |
| ----- | --------------------------------------------- | ---------------- |
| `0`   | clean / non-blocking only                     | pass             |
| `2`   | a CRITICAL survived (incl. `keep_unverified`) | **fail (email)** |
| other | persistent tool error after retries           | fail closed      |

The change: transient failures no longer _reach_ the "other" path — they retry
into a clean `0`/`2`. A persistent failure (retries exhausted) still fails
closed, which is correct. Verification monotonicity is preserved.

---

## 6. Testing

Pure-function / injectable seams (no network, no API key), added to **both** test
suites — `.claude/hooks/test-kimi-review.sh` (Python heredocs) and the local
`~/.local/share/claude-coworker/tools/test-kimi-review.py`:

- `call_with_retry` retry: fake client that (i) raises then succeeds, (ii)
  returns empty content then non-empty — assert it retries and returns the good
  response; assert it raises after exhausting attempts. `base_delay=0`.
- `call_with_retry` deadline (blocker A): with `deadline` already in the past,
  assert it raises `BudgetExceeded` **without** making any client call (no retry
  sequence runs past the budget).
- `call_with_retry` does **not** retry `length` (blocker C): a response with
  `finish_reason == "length"` is accepted by the draft validator (not treated as
  empty) so it falls through to the existing `:588` fast-fail; assert no retry
  is attempted on a `length` response.
- `verify_one_agentic` deadline at turn-top: `deadline` in the past →
  `"keep_unverified"`, no model call.
- `verify_one_agentic` pre-verdict check (blocker D): a deadline that passes
  _after_ the tool-loop turn but _before_ the verdict call → `"keep_unverified"`,
  and the verdict `create` is never invoked (assert the fake client's verdict-call
  counter stays 0). This is the test that proves the drain is capped at one call.
- `verify_one_agentic` swallows failures: a fake client that always raises →
  returns `"keep_unverified"`, never propagates.
- `verify_agentic` deadline: a fake/slow `verify_one_agentic` (monkeypatched)
  exceeding the budget — assert unfinished CRITICALs become `"keep_unverified"`
  and the function returns promptly.
- `verify_agentic` harvest gap (blocker E): construct the race where a future is
  `done()` with a real `"downgrade"` verdict but unharvested when the waiter
  times out — assert the except branch reads `fut.result()` and the finding is
  `"downgrade"`, not left at the init `"keep"`.
- `apply_downgrades`: `keep_unverified` keeps CRITICAL and appends the
  budget-exhausted marker; `keep` leaves it unmarked; `downgrade` lowers to
  WARNING. Monotonicity assertions retained.

Re-run the existing hook harness (`bash .claude/hooks/test-kimi-review.sh`) to
confirm wrapper behavior is unchanged. Post-deploy, monitor the next CI runs (or
re-trigger a previously-failing PR) to confirm crashes no longer occur.

---

## 7. Rollout & risks

**Rollout sequence:**

1. Edit the **canonical** engine (`~/.local/share/claude-coworker/tools/kimi-review`).
2. Update both test suites; run both.
3. `npm run kimi:engine:sync` (canonical → vendored `scripts/kimi-review.py`).
4. `npm run kimi:engine:check` confirms parity (pre-commit drift gate).
5. Edit `scripts/ci-kimi-review.sh` (timeout default 300 → 480).
6. Update `docs/kimi-review-architecture.md`: new env
   `KIMI_REVIEW_BUDGET_SECONDS` (global soft budget, default 330), deadline-aware
   retry behavior, `keep_unverified` verdict + marker, two-layer timeout (480
   backstop), `max_retries=0` client tuning (timeout unchanged at 90).
7. Commit (drift check + Kimi review gate run on commit).

**Risks / known-unknowns:**

- **Cross-project effect:** the canonical engine is shared; the new
  `KIMI_REVIEW_BUDGET_SECONDS=330` default, `max_retries=0`, the deadline-aware
  retry layer, and the keep-on-deadline verify behavior all reach plant_id and
  `kimi-multi-review` too. Because the per-call `timeout` stays 90s (4c), none of
  these adds a way for a previously-passing call to fail — they only convert
  failures to successes or bound an already-runaway loop. Acceptable — noted, not
  blocked.
- **Malformed-body could be deterministic:** the `Expecting value…` crash is
  _probably_ transient, but on a very large diff the provider may truncate the
  HTTP body every time. Retry is still correct and safe; if it recurs on a single
  unchanged SHA after this lands, investigate "diff too large" separately. No
  action now.
- **keep-on-deadline false alarm:** a CRITICAL that _would_ have been refuted
  given more time can still fail a PR if verify exhausts its budget. Mitigated by
  retry + the 330s budget making budget-exhaustion rare; the finding is clearly
  marked `[kept: verification budget exhausted]` so the cause is unambiguous, and
  the run is re-runnable.
- **Process lingers briefly after the verdict prints (blocker F):**
  `shutdown(wait=False)` returns `verify_agentic` promptly, so `main()` prints the
  verdict and calls `sys.exit(2)` — but the non-daemon worker threads keep the
  _process_ alive until each one reaches its next deadline check and returns (≤ one
  in-flight call, capped by the pre-verdict check). So in a budget-exhausted run
  the job can show its verdict, then sit for up to ~90s before the process
  actually exits. This is within the 480s backstop and is expected behavior, not a
  hang — documented so a "finished but still running" job is not mistaken for a new
  bug.

---

## 8. Out of scope (future, if needed)

- GitHub annotations / `$GITHUB_STEP_SUMMARY` callouts for unverified findings
  (offered, declined this round).
- Provider pinning / `require_parameters` on OpenRouter to reduce empty-content
  responses at the source.
- Branch protection making the gate a required check.
