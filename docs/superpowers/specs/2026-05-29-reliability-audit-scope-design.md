# Design: `reliability` Audit Scope (Failure-Mode Lens)

> **Date:** 2026-05-29
> **Trigger:** A production-class silent failure was found and fixed by hand. Investigation revealed the 2026-05-28 silent-failures sweep covered only ONE habitat of silent failure — client-side error _surfacing_. A 4-cluster research dry run against the current code confirmed nine more failure-mode classes, each producing real, reachable findings (several Critical). The existing `/audit` skill's 7 domains are _structural_ lenses and systematically miss the _operational_ lens of "does this survive bad conditions?"

## Problem

"Silent failure" — an operation that fails while giving the user no visible error and no recovery, or (worse) confident wrong data — has more habitats than the 2026-05-28 sweep addressed. That sweep was scoped to client-side error surfacing (queries/mutations not rendering errors, swallowed catches, routes returning HTTP 200 on error). It resolved 46 findings but did not touch the failure modes that only bite under conditions absent from happy-path dev: a missing env var in prod, a third-party API returning an unexpected shape, a network blip, a replayed purchase webhook, a meal logged on the wrong side of midnight.

The existing `/audit` skill has seven domains — `security`, `performance`, `data-integrity`, `architecture`, `code-quality`, `camera`, `accessibility`. These ask _"is the code shaped right?"_ (a structural lens). Failure modes ask _"does the code survive bad conditions?"_ (an operational lens). The two are orthogonal: a finding can be architecturally clean and still fail silently in production. That orthogonality is exactly why these slip through every existing audit.

### The 10 failure-mode classes

Grouped into four clusters, mapped against existing audit coverage:

**Server-side resilience**

1. **Config / env fail-fast** — missing env var silently _degrades_ instead of failing loudly at boot. _(Gap)_
2. **Outbound network resilience** — no timeout (hang forever), no backoff, no 429/quota handling; fallback returns empty. _(Gap)_
3. **Idempotency & money correctness** — duplicate request / webhook replay → double entitlement or double-charge. _(Partial: security)_

**Client-side reliability (mobile-specific)** 4. **Network-state transitions** — offline→online resume, request queueing, NetInfo not handled. _(Gap)_ 5. **State persistence & migration** — AsyncStorage/SecureStore read/write failure or schema drift across app updates. _(Gap)_ 6. **Session/auth lifecycle edges** — token expiry mid-action, 401 cleanup, logout races. _(Partial: security covers JWT validity, not lifecycle UX)_ 7. **Deep-link edge cases** — invalid IDs, unauthenticated entry, malformed URLs. _(Gap)_

**Cross-cutting correctness** 8. **External boundary validation** — trusting third-party/OCR/barcode shapes → confident _wrong_ data. _(Partial: data-integrity)_ 9. **Time / locale / units** — timezone & midnight-boundary bugs, float macro math, unit conversion. _(Partial: data-integrity = nutrition accuracy)_

**Cross-cutting detection** 10. **Observability hooks in source** — can a failure even be detected? Structured logging on failure paths, error-reporter wiring, log levels. _(Gap — scoped to source presence, not live prod telemetry)_

### Dry-run evidence (research validated every class)

A 4-agent read-only research pass against the current code confirmed the lens is real, not theoretical. Summary of the highest-severity confirmed findings (full list in the Appendix — these become the seed findings for the first formal run):

- **Critical** — IAP restore mints a random `transactionId`, never binds `originalTransactionId` → one Apple subscription claimable by unlimited accounts (`server/routes/subscription.ts:202-215`).
- **Critical** — Meal logging uses server-UTC `loggedAt` + `setUTCHours` day bounds; client never sends timezone → non-UTC evening meals count toward the wrong day, today (`server/storage/nutrition.ts:327`, `server/storage/helpers.ts:14`, `client/hooks/useDailyBudget.ts:11`).
- **Critical** — No off-device error reporter anywhere; `ErrorBoundary` mounted with no `onError` → 100% of prod client failures invisible (`client/App.tsx:95`, `package.json`).
- **Critical (latent)** — No Apple S2S / Google RTDN handlers → refunds/cancellations never revoke entitlement (`server/routes/`).
- **High** — `EXPO_ACCESS_TOKEN` outside the env schema → silent push disable, the original burn (`server/services/push-notifications.ts:27`).
- **High** — No global 401→logout interceptor + no `AppState` re-check → expired token fails silently app-wide (`client/lib/query-client.ts`).
- **High** — Unvalidated CNF + Open Food Facts ingestion → dirty upstream data becomes the user's macros, cached + served via the monetized API (`server/services/nutrition-lookup.ts:235,386,873`).

The research also confirmed what is **already handled well** (so the checklist is phrased as checks-to-verify, not assumptions of absence): OpenAI calls have tiered timeouts + backoff; `shared/lib/units.ts` unit conversion is exemplary; AI/LLM JSON is consistently Zod-validated; the server has a pino logger, `fireAndForget` helper, and process crash handlers.

## Goal

Add a **`reliability` named scope** to the existing `/audit` skill that runs the failure-mode lens as a repeatable, manifest-tracked, per-fix-verified pass — reusing Phases 1-9 of the skill unchanged. Produce a durable **Failure-Mode Checklist** (the 10 classes → concrete check items) that the scope's discovery agents apply.

## Non-Goals

- **No new skill.** This is a scope on the existing `/audit` skill, not a standalone `/reliability-audit` (would duplicate the manifest/verify/codify/PR machinery and split the audit trail).
- **No cross-cutting edit of every specialist agent.** The failure-mode checks live with the scope, not folded into all seven existing domains' agents.
- **No fixes in this spec.** The live defects the dry run found are triaged by _running_ the new scope (user's choice: build scope, then triage). Money/auth findings are human-in-the-loop, never auto-fixed.
- **Not part of routine `full` audits.** Included in `pre-launch` (launch-critical) and as a standalone scope only, to keep `full` from ballooning to 8 heavy domains.

## Scope (files that change)

1. **`.claude/skills/audit/SKILL.md`** — add a `reliability` row to the Specialist Agent Mapping table; add a "Reliability scope dispatch" subsection documenting the 4-cluster discovery model; add `reliability` to the named-scopes list; note its inclusion in `pre-launch` and exclusion from `full`.
2. **`.claude/skills/audit/reliability-checklist.md`** _(new, tracked)_ — the Failure-Mode Checklist (10 classes → check items), referenced from `SKILL.md`.
3. **`CLAUDE.md`** — add `reliability` to the audit scopes list under "Code Audits".

No other phases of the audit workflow change (setup, fix, defer, close, code review, commit, codify, PR all stay the same).

## The Failure-Mode Checklist (`reliability-checklist.md`)

Each item is phrased as a verification ("confirm X"), because parts are already handled well. For each _failed_ check, the discovering agent records: `file:line`, class #, severity, a one-line "what the user/system experiences when this bites", and **reachability** (can it fire today vs. latent).

### Class 1 — Config / env fail-fast

- Every required env var is in the startup validation schema (`server/lib/env.ts` `validateEnv()`) and fails fast when absent.
- No feature is silently disabled by an inline `process.env.X` read that bypasses the schema (e.g. `EXPO_ACCESS_TOKEN`).
- No security-relevant var has an insecure default/fallback (`JWT_SECRET`, etc.).
- Optional vars that degrade a feature log a clear startup warning naming the disabled capability.

### Class 2 — Outbound network resilience

- Every outbound `fetch`/SDK call sets a timeout (`AbortSignal.timeout` or SDK equivalent) — no call can hang forever.
- Retry/backoff exists for idempotent calls; 429/quota responses are handled distinctly from generic failure.
- Fallback chains signal an error state rather than returning empty/undefined as if it were a valid empty result.

### Class 3 — Idempotency & money correctness

- Purchase/entitlement writes are idempotent (bound to `originalTransactionId` or an idempotency key; protected by a unique constraint, not just a read-then-write).
- Store server notifications (Apple S2S v2 / Google RTDN) are consumed and applied (refund, cancel, revoke, expire) — entitlement cannot drift.
- _Human-in-the-loop flag:_ findings here touch IAP/auth → never auto-fix; surface for manual, fully-verified handling.

### Class 4 — Network-state transitions

- TanStack Query `onlineManager`/reconnect refetch is wired (not display-only NetInfo).
- In-flight mutations on disconnect are queued or retried, not silently dropped.
- Connectivity UI ("back online") reflects real recovery (an actual refetch), not a cosmetic toast.

### Class 5 — State persistence & migration

- Persisted reads (token, auth, onboarding) handle missing/corrupt data without forcing a silent logout or crash.
- Persisted writes handle failure with a user-visible signal, not a generic error.
- Persisted keys carry a version/schema field with a migration path across app updates.

### Class 6 — Session/auth lifecycle edges

- A 401 triggers logout/cleanup (or a clear "session expired" affordance), not a suppressed 4xx that dead-ends the user.
- Auth state is re-checked on `AppState` foreground, not only on cold-start mount.
- Logout cleanly clears all persisted auth state with no race against in-flight requests.
- _Human-in-the-loop flag:_ auth findings → manual handling (documented recurring weak spot).

### Class 7 — Deep-link edge cases

- Every deep-link param is validated; an invalid/malformed ID does not silently coerce to a default (e.g. `parseIntOrZero` → `0` → create-new form).
- Unauthenticated deep-link entry is queued and resumed after login, not dropped.
- Target screens guard against missing/garbage params before fetching.

### Class 8 — External boundary validation

- Third-party API responses (CNF, USDA, Open Food Facts, Spoonacular, API Ninjas) are Zod-validated/type-guarded before nested fields are read.
- OCR text and barcode payloads are validated before being treated as real products/numbers.
- AI/LLM JSON is `safeParse`d (confirm — currently good).
- Wrong values cannot be written to `nutritionCache` / `barcodeNutrition` (cache + monetized-API poisoning).

### Class 9 — Time / locale / units

- Meal/day membership is timezone-aware: the client transmits its timezone and the server computes day bounds in the user's tz, not server UTC.
- `loggedAt` is set explicitly (not left to a UTC DB default) where day-bucketing matters.
- Numeric accumulation/scaling/rounding uses the central units module; no ad-hoc float math; unit fields from upstream are compared, not assumed.

### Class 10 — Observability hooks in source

- A structured logger exists for both server (confirm pino) and client (currently absent).
- Failure/catch paths log with context (operation, ids, error) — not swallowed, `console`-only, or `__DEV__`-gated (zero output in prod bundles).
- An off-device error reporter is wired into `ErrorBoundary.onError` + the global `QueryCache.onError` + a client logger.
- Background/fire-and-forget work emits a developer signal on failure (server `fireAndForget` is good; client `void` work is the gap).

## Change 1: `SKILL.md` — mapping row + dispatch model

Add to the Specialist Agent Mapping table:

| Audit Domain          | Primary Agent(s)                                                                 | What They Check                             |
| --------------------- | -------------------------------------------------------------------------------- | ------------------------------------------- |
| `reliability` _(new)_ | 4 cluster dispatches (below) — not a single specialist; failure modes cut across | The 10 failure-mode classes (see checklist) |

Add a **"Reliability scope dispatch"** subsection. Unlike other named scopes (one domain → its primary specialists), `reliability` dispatches **four cluster investigations**, each given the relevant checklist sections plus the read-only / no-todo discovery constraints:

| Cluster                   | Classes | Agent(s)                                                                    |
| ------------------------- | ------- | --------------------------------------------------------------------------- |
| Server resilience         | 1-3     | `api-specialist` + `security-auditor` + `architecture-specialist`           |
| Client reliability        | 4-7     | `rn-ui-ux-specialist` + `typescript-specialist`                             |
| Cross-cutting correctness | 8-9     | `database-specialist` + `nutrition-domain-expert` + `typescript-specialist` |
| Detection / observability | 10      | `architecture-specialist` + `quality-specialist`                            |

The discovery prompt for each cluster: the standard discovery template, plus "apply `.claude/skills/audit/reliability-checklist.md` classes [N-M]", plus the genuine-empty-vs-error caveat and the reachability requirement (trace the consumer; demote latent/dead findings).

**Phase 2 rule exception.** The skill's current named-scope rule reads _"Named scope: launch only the primary agent(s) for that domain."_ Add an explicit exception: **`reliability` is the one scope whose discovery is dispatched per _cluster_ (4 dispatches), not per single domain** — because the failure-mode lens is cross-cutting. The phase _mechanics_ (dedup, verify-in-code, write to manifest) are identical; only the dispatch fan-out differs.

**Scope inclusion:** add `reliability` to the named-scopes list. Include it in `pre-launch` (after the 7 structural domains). Do **not** add it to `full`. `pre-launch` then runs 7 structural-domain agents + 4 reliability cluster dispatches = **11 invocations, batched 4+4+3**.

**Dedup note:** the first formal run must dedup the Class 9 timezone findings against `docs/superpowers/specs/2026-05-16-timestamp-timezone-consistency-design.md` and the audit CHANGELOG — that work may already partially address the day-boundary issue.

### Per-phase dispatch additions

The reliability scope adds a row/entry to three downstream per-phase dispatch tables (the phase _logic_ is unchanged; each table simply learns the new scope):

- **Phase 2.5 (docs-researcher).** Currently "one per domain with findings." For reliability, dispatch **one researcher per _cluster_ that has findings** (1-4 researchers), batched as the skill already batches researchers. Skip rule unchanged (a cluster with zero findings gets no researcher).
- **Phase 3 (`kimi-review --patterns`).** Add cluster-based rows to the domain→patterns mapping:

  | Reliability cluster             | `--patterns` value      |
  | ------------------------------- | ----------------------- |
  | Server resilience (1-3)         | `security,architecture` |
  | Client reliability (4-7)        | `react-native`          |
  | Cross-cutting correctness (8-9) | `typescript,database`   |
  | Detection/observability (10)    | `architecture`          |

- **Phase 8 (codify routing + rules routing).** There is **no `reliability-specialist`** and **no new `docs/rules/reliability.md`**. Reliability findings route by their _nature_ to the existing specialist agent(s) and existing rules file:
  - Codify routing: use the cluster's agent mapping already defined above (e.g. a Class 8 boundary-validation finding → `typescript-specialist`/`database-specialist`; a Class 1 env finding → `api-specialist`/`architecture-specialist`).
  - Rules routing: a codifiable "never do X" finding appends to the matching existing `docs/rules/{domain}.md` (e.g. Class 8 → `typescript.md` or `database.md`; Class 9 timezone → `database.md`; Class 6 → `security.md`). None create a new rules file.

## Change 2: `reliability-checklist.md` (new, tracked)

Create `.claude/skills/audit/reliability-checklist.md` with the checklist above. Tracked (not gitignored) so Copilot/CI and the skill can read it.

## Change 3: `CLAUDE.md` — scopes list

Add `reliability` to the "Code Audits" scopes line:

> Scopes: `full`, `pre-launch`, `security`, `performance`, `data-integrity`, `architecture`, `code-quality`, `reliability`

## Special handling rules

- **Money/auth = human-in-the-loop.** Classes 3 and 6 carry a do-not-auto-fix flag in the checklist; the fix phase surfaces them for manual, fully-verified handling per the project's never-delegate rule.
- **Genuine-empty-vs-error caveat.** Distinguish "0/empty because there's truly no data" from "0/empty because the fetch failed" — the naive fix mislabels a legitimate empty state as an error.
- **Reachability gate.** Report on a traced consumer that can fire today, not on a catch/missing-check in isolation.

## What Does Not Change

- **Phase mechanics** are unchanged: setup, dedup, verify-in-code, fix one-at-a-time, defer, close, code review, commit, codify, PR all behave exactly as today. What gains a `reliability` entry is the per-phase _dispatch tables_ (Phase 2 agent mapping, Phase 2.5 researcher dispatch, Phase 3 `--patterns` map, Phase 8 codify/rules routing) — enumerated in Change 1. No phase's logic is rewritten.
- The audit manifest template and the discovery prompt template are unchanged (the reliability scope appends checklist sections to the existing prompt, it does not replace it).
- The other seven domains and their agent mappings are untouched.
- `full` audit composition is unchanged (still 7 domains).
- No new agent (`reliability-specialist`) and no new rules file (`docs/rules/reliability.md`) are created — reliability reuses the existing 13 specialists and 13 rules files.

## Success Criteria

- `/audit reliability` launches the four cluster investigations covering classes 1-10, each applying `reliability-checklist.md`.
- `/audit pre-launch` includes the reliability scope after the seven structural domains.
- `/audit full` does **not** include reliability.
- `.claude/skills/audit/reliability-checklist.md` exists, is tracked, and is referenced from `SKILL.md`.
- `CLAUDE.md`'s scopes list includes `reliability`.
- Money/auth (classes 3, 6) findings are flagged human-in-the-loop in the checklist.
- A first formal `/audit reliability` run reproduces the Appendix seed findings (deduped against prior specs/CHANGELOG) under the manifest with per-fix verification.

## Appendix: dry-run seed findings (2026-05-29, read-only research)

Recorded here because `docs/audits/` is gitignored; these seed the first formal run's manifest. Severity in parentheses; reachability noted.

**Server resilience (1-3)**

- (Critical) IAP restore money hole — `server/routes/subscription.ts:202-215` — random `transactionId`, no `originalTransactionId` binding → one subscription claimable by N accounts. Reachable today.
- (Critical, latent) No Apple S2S / Google RTDN handlers — `server/routes/` — refunds/cancellations never revoke entitlement.
- (High) `EXPO_ACCESS_TOKEN` outside env schema — `server/services/push-notifications.ts:27` — silent push disable. Already bit.
- (Medium) CNF food-list bootstrap `fetch` has no timeout — `server/services/nutrition-lookup.ts:227-234` — first lookup can stall on a hung endpoint. Bounded.
- (Low, mitigated) Duplicate-transaction check is non-atomic TOCTOU — `server/routes/subscription.ts:118-126` — backstopped by the `transactionId` unique constraint (`shared/schema.ts:1329`).

**Client reliability (4-7)**

- (High) No `onlineManager`/reconnect refetch; mutations `retry:false`, no queue — `client/lib/query-client.ts:200-219` — in-flight scans lost on disconnect; "Back online" toast misleads (`client/components/OfflineBanner.tsx:34`).
- (High) No global 401→logout interceptor + no `AppState` re-check — `client/lib/query-client.ts`, `client/hooks/useAuth.ts:71-73` — expired token fails silently app-wide.
- (High) `parseIntOrZero` + `isCreate=!entryId` — `client/screens/NotebookEntryScreen.tsx:50-51` — invalid notebook deep link silently becomes a create-new form → duplicate entries.
- (Medium) Unauthenticated deep links dropped, not queued — `client/navigation/RootStackNavigator.tsx:175-180`.
- (Medium) Unguarded token-storage `set()`/`clear()`, no schema version on persisted keys — `client/lib/token-storage.ts:29,35`.

**Cross-cutting correctness (8-9)**

- (Critical) UTC day-boundary on meal logging — `server/storage/nutrition.ts:327`, `server/storage/helpers.ts:14-18`, `client/hooks/useDailyBudget.ts:11-14` — non-UTC evening meals land on wrong day. Fires today. _(dedup vs. 2026-05-16 timezone spec)_
- (High) Unvalidated CNF ingestion — `server/services/nutrition-lookup.ts:235-236,386`.
- (High) Unvalidated Open Food Facts ingestion (`Record<string, any>`) — `server/services/nutrition-lookup.ts:803,873-889`.
- (Medium) `lookupUSDAByUPC` bypasses the Zod schema used elsewhere — `server/services/nutrition-lookup.ts:503-538`.
- (Medium) Coach groups logs into UTC day buckets — `server/services/coach-pro-chat.ts:185`.

**Detection / observability (10)**

- (Critical) No off-device error reporter anywhere; `ErrorBoundary` mounted with no `onError` — `package.json`, `client/App.tsx:95`, `client/components/ErrorBoundary.tsx:32`.
- (High) No client logger; `console.*`/`__DEV__`-gated logs vanish in prod — e.g. `client/screens/ScanScreen.tsx:304`.
- (Medium) Global `QueryCache.onError` fires a user toast only, no log/report — `client/lib/query-client.ts:191`.
- (Medium) Client `void` background work logs nothing on failure — `client/context/BatchScanContext.tsx:136,227,281`.
- (Medium) `recipe-catalog.ts:336` `catch { return []; }` — no log; persistent failure looks like "no substitutes exist".

**Confirmed well-handled (do not re-report):** OpenAI tiered timeouts + backoff (`server/lib/openai.ts`); Google/Apple receipt-validation timeouts (`receipt-validation.ts`); Runware/Spoonacular timeouts; `DATABASE_URL`/`JWT_SECRET` fail-fast (`env.ts`); AI/LLM JSON Zod-validation (`photo-analysis.ts`, `menu-analysis.ts`, etc.); `shared/lib/units.ts` conversion; server pino logger + `fireAndForget` + process crash handlers (`server/lib/logger.ts`, `server/lib/fire-and-forget.ts`, `server/index.ts`).
