# Reliability Audit Checklist (Failure-Mode Lens)

Used by the `/audit reliability` scope (see `SKILL.md` → "Reliability Scope"). Ten
failure-mode classes, grouped into four discovery clusters. Each item is phrased as
a **verification** ("confirm X"), not an assumption of absence — parts of the app
already handle these well.

For each **failed** check, record in the manifest: `file:line`, the class #,
severity (Critical/High/Medium/Low), a one-line "what the user/system experiences
when this bites", and **reachability** (can it fire today vs. latent — trace the
consumer; demote latent/dead findings).

Two standing caveats for every class:

- **Genuine-empty-vs-error:** distinguish "0/empty because there's truly no data"
  from "0/empty because the fetch failed". The naive fix mislabels a legitimate
  empty state as an error.
- **Human-in-the-loop (classes 3 & 6):** findings that touch IAP receipt validation
  or auth are never auto-fixed — surface them for manual, fully-verified handling
  per the project's never-delegate rule.

## Cluster A — Server resilience

### Class 1 — Config / env fail-fast

- Every required env var is in the startup validation schema (`server/lib/env.ts`
  `validateEnv()`) and fails fast when absent.
- No feature is silently disabled by an inline `process.env.X` read that bypasses
  the schema (e.g. `EXPO_ACCESS_TOKEN`).
- No security-relevant var has an insecure default/fallback (`JWT_SECRET`, etc.).
- Optional vars that degrade a feature log a clear startup warning naming the
  disabled capability.

### Class 2 — Outbound network resilience

- Every outbound `fetch`/SDK call sets a timeout (`AbortSignal.timeout` or SDK
  equivalent) — no call can hang forever.
- Retry/backoff exists for idempotent calls; 429/quota responses are handled
  distinctly from generic failure.
- Fallback chains signal an error state rather than returning empty/undefined as if
  it were a valid empty result.

### Class 3 — Idempotency & money correctness _(human-in-the-loop)_

- Purchase/entitlement writes are idempotent (bound to `originalTransactionId` or an
  idempotency key; protected by a unique constraint, not just a read-then-write).
- Store server notifications (Apple S2S v2 / Google RTDN) are consumed and applied
  (refund, cancel, revoke, expire) — entitlement cannot drift.

## Cluster B — Client reliability

### Class 4 — Network-state transitions

- TanStack Query `onlineManager`/reconnect refetch is wired (not display-only
  NetInfo).
- In-flight mutations on disconnect are queued or retried, not silently dropped.
- Connectivity UI ("back online") reflects real recovery (an actual refetch), not a
  cosmetic toast.

### Class 5 — State persistence & migration

- Persisted reads (token, auth, onboarding) handle missing/corrupt data without
  forcing a silent logout or crash.
- Persisted writes handle failure with a user-visible signal, not a generic error.
- Persisted keys carry a version/schema field with a migration path across app
  updates.

### Class 6 — Session/auth lifecycle edges _(human-in-the-loop)_

- A 401 triggers logout/cleanup (or a clear "session expired" affordance), not a
  suppressed 4xx that dead-ends the user.
- Auth state is re-checked on `AppState` foreground, not only on cold-start mount.
- Logout cleanly clears all persisted auth state with no race against in-flight
  requests.

### Class 7 — Deep-link edge cases

- Every deep-link param is validated; an invalid/malformed ID does not silently
  coerce to a default (e.g. `parseIntOrZero` → `0` → create-new form).
- Unauthenticated deep-link entry is queued and resumed after login, not dropped.
- Target screens guard against missing/garbage params before fetching.

## Cluster C — Cross-cutting correctness

### Class 8 — External boundary validation

- Third-party API responses (CNF, USDA, Open Food Facts, Spoonacular, API Ninjas)
  are Zod-validated/type-guarded before nested fields are read.
- OCR text and barcode payloads are validated before being treated as real
  products/numbers.
- AI/LLM JSON is `safeParse`d (confirm — currently good).
- Wrong values cannot be written to `nutritionCache` / `barcodeNutrition` (cache +
  monetized-API poisoning).

### Class 9 — Time / locale / units

- Meal/day membership is timezone-aware: the client transmits its timezone and the
  server computes day bounds in the user's tz, not server UTC.
- `loggedAt` is set explicitly (not left to a UTC DB default) where day-bucketing
  matters.
- Numeric accumulation/scaling/rounding uses the central units module; no ad-hoc
  float math; unit fields from upstream are compared, not assumed.

## Cluster D — Detection / observability

### Class 10 — Observability hooks in source

- A structured logger exists for both server (confirm pino) and client (currently
  absent).
- Failure/catch paths log with context (operation, ids, error) — not swallowed,
  `console`-only, or `__DEV__`-gated (zero output in prod bundles).
- An off-device error reporter is wired into `ErrorBoundary.onError` + the global
  `QueryCache.onError` + a client logger.
- Background/fire-and-forget work emits a developer signal on failure (server
  `fireAndForget` is good; client `void` work is the gap).
