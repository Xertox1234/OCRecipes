# Reliability Audit Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `reliability` named scope (a cross-cutting failure-mode lens) to the existing `/audit` skill, reusing its manifest/verify/codify/PR machinery.

**Architecture:** Three edits — (1) a new tracked checklist file enumerating 10 failure-mode classes as checks-to-verify; (2) additive edits to the audit `SKILL.md` (one mapping-table row, one dedicated dispatch subsection, and reliability entries in the Phase 2 / 2.5 / 3 / 8 per-phase tables); (3) a one-line scopes-list edit in the (gitignored) `CLAUDE.md`. No phase _logic_ changes — only dispatch _tables_ learn the new scope. No new agent and no new rules file are created.

**Tech Stack:** Markdown only. No code, no tests-as-code — verification is grep/read-back of exact inserted strings plus a consistency pass.

**Source spec:** `docs/superpowers/specs/2026-05-29-reliability-audit-scope-design.md` (gitignored, local-only).

---

## Pre-flight notes (read before starting)

- **Tracked vs. local-only:** `.claude/skills/audit/SKILL.md` and `.claude/skills/audit/reliability-checklist.md` are git-tracked (they commit). `CLAUDE.md` is **gitignored** — Task 3's edit is local-only and will NOT appear in any commit; that is expected, do not try to "fix" it.
- **The plan file** (`docs/superpowers/plans/2026-05-29-reliability-audit-scope.md`) is also gitignored — local-only.
- **No copilot-instructions rebuild:** `scripts/build-copilot-instructions.ts` reads only the `docs/rules/` domain mapping. This plan does not touch `docs/rules/`, so `npm run build:copilot-instructions` is NOT required. (Task 4 verifies this assumption.)
- **Branch/worktree:** if executing in isolation, create the worktree via `superpowers:using-git-worktrees` first. Otherwise work on a feature branch off `main` (e.g. `feat/2026-05-29-reliability-audit-scope`) — do not commit onto an unrelated branch.
- **Kimi pre-commit gate:** all changed files here are `.md`; the kimi-review hook auto-skips when no `.ts`/`.tsx` is staged, so commits won't trigger it.

## File Structure

- **Create:** `.claude/skills/audit/reliability-checklist.md` — the durable failure-mode checklist (10 classes → concrete check items). One responsibility: the canonical list of reliability checks + reporting format. Referenced by `SKILL.md`.
- **Modify:** `.claude/skills/audit/SKILL.md` — add the scope to the dispatch tables. Additive only; no existing domain or phase logic changes.
- **Modify (local-only):** `CLAUDE.md` — add `reliability` to the Code Audits scopes list.

---

## Task 1: Create the reliability checklist file

**Files:**

- Create: `.claude/skills/audit/reliability-checklist.md`

- [ ] **Step 1: Create the file with the full checklist**

Create `.claude/skills/audit/reliability-checklist.md` with exactly this content:

```markdown
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

## Cluster A — Server-side resilience

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

## Cluster B — Client-side reliability

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

## Cluster D — Detection

### Class 10 — Observability hooks in source

- A structured logger exists for both server (confirm pino) and client (currently
  absent).
- Failure/catch paths log with context (operation, ids, error) — not swallowed,
  `console`-only, or `__DEV__`-gated (zero output in prod bundles).
- An off-device error reporter is wired into `ErrorBoundary.onError` + the global
  `QueryCache.onError` + a client logger.
- Background/fire-and-forget work emits a developer signal on failure (server
  `fireAndForget` is good; client `void` work is the gap).
```

- [ ] **Step 2: Verify the file exists and contains all 10 classes**

Run: `grep -c '^### Class ' .claude/skills/audit/reliability-checklist.md`
Expected: `10`

Run: `grep -nE '^## Cluster [A-D] ' .claude/skills/audit/reliability-checklist.md`
Expected: 4 lines (Cluster A, B, C, D)

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/audit/reliability-checklist.md
git commit -m "feat(audit): add reliability failure-mode checklist"
```

---

## Task 2: Wire the reliability scope into SKILL.md

**Files:**

- Modify: `.claude/skills/audit/SKILL.md`

All edits are additive. Apply them with the Edit tool using the exact anchor strings below.

- [ ] **Step 1: Add the `reliability` row to the Specialist Agent Mapping table**

Find this line (the last/`accessibility` row of the mapping table):

```
| `accessibility`  | `accessibility-specialist` + `rn-ui-ux-specialist`                    | Modal focus trapping, VoiceOver/TalkBack announcements, touch targets, WCAG contrast, aria-invalid   |
```

Insert a new row immediately after it:

```
| `reliability`    | _cluster dispatch — see "Reliability Scope" below_                    | 10 failure-mode classes (config fail-fast, network resilience, idempotency, offline, persistence, auth lifecycle, deep links, boundary validation, time/units, observability) — `pre-launch` + standalone only, NOT `full` |
```

- [ ] **Step 2: Update the full/pre-launch batch instruction to distinguish the two**

Find this exact paragraph:

```
**For `full` or `pre-launch` scopes:** Launch **one agent invocation per domain row** (7 total). Batch in two groups — first 4 domains, then 3 — to avoid overwhelming context. The "Primary Agent(s)" column shows which agent type to use for each invocation; list both agents in the prompt when two are shown.
```

Replace it with:

```
**For `full` scope:** Launch **one agent invocation per structural domain row** (the 7 rows above `reliability`; 7 total). Batch in two groups — first 4 domains, then 3 — to avoid overwhelming context. The "Primary Agent(s)" column shows which agent type to use for each invocation; list both agents in the prompt when two are shown. `full` does **not** include `reliability`.

**For `pre-launch` scope:** Launch the 7 structural-domain invocations as for `full`, **plus** the `reliability` scope's 4 cluster dispatches (see "Reliability Scope" below) — 11 invocations total, batched 4+4+3.
```

- [ ] **Step 3: Add the named-scope exception for reliability**

Find this exact line:

```
**For named scopes:** Launch only the primary agent(s) for that domain.
```

Replace it with:

```
**For named scopes:** Launch only the primary agent(s) for that domain. **Exception:** `reliability` is dispatched per *cluster* (4 dispatches), not per single domain — see "Reliability Scope" below.
```

- [ ] **Step 4: Insert the dedicated "Reliability Scope" subsection before Phase 1**

Find this exact line (start of Phase 1):

```
## Phase 1: Setup
```

Insert the following block immediately BEFORE it:

```markdown
## Reliability Scope (cross-cutting failure-mode lens)

`reliability` is an _operational_ lens (does the code survive bad conditions?),
orthogonal to the seven _structural_ domains above. Its discovery is dispatched per
**cluster** (4 dispatches), not per single domain. It is a standalone named scope
and is included in `pre-launch`, but **not** in `full`.

Each cluster dispatch uses the standard discovery prompt template (see above) plus:
"apply `.claude/skills/audit/reliability-checklist.md` classes [N-M]", the
genuine-empty-vs-error caveat, and the reachability requirement (trace the consumer;
demote latent/dead findings).

| Cluster                   | Classes | Agent(s)                                                                    |
| ------------------------- | ------- | --------------------------------------------------------------------------- |
| Server resilience         | 1-3     | `api-specialist` + `security-auditor` + `architecture-specialist`           |
| Client reliability        | 4-7     | `rn-ui-ux-specialist` + `typescript-specialist`                             |
| Cross-cutting correctness | 8-9     | `database-specialist` + `nutrition-domain-expert` + `typescript-specialist` |
| Detection / observability | 10      | `architecture-specialist` + `quality-specialist`                            |

**Human-in-the-loop:** findings in classes 3 (idempotency/money) and 6 (auth
lifecycle) touch IAP/auth — never auto-fix; surface for manual, fully-verified
handling per the never-delegate rule.

**Dedup note:** dedup Class 9 timezone findings against
`docs/superpowers/specs/2026-05-16-timestamp-timezone-consistency-design.md` and the
audit CHANGELOG before reporting — that work may already partially address the
day-boundary issue.

**No new infrastructure:** reliability reuses the existing specialist agents and the
13 `docs/rules/` files. It does **not** add a `reliability-specialist` agent or a
`docs/rules/reliability.md`.
```

- [ ] **Step 5: Add reliability handling to the Phase 2 dispatch list**

Find this exact bullet inside Phase 2 step 1:

```
   - Named scope (e.g., `security`): launch only the primary agent(s) for that domain
```

Replace it with:

```
   - Named scope (e.g., `security`): launch only the primary agent(s) for that domain
   - `reliability` scope: launch the 4 cluster dispatches from the "Reliability Scope" section (not per-domain); each prompt names the checklist classes for that cluster
```

- [ ] **Step 6: Add reliability handling to the Phase 2.5 researcher dispatch**

Find this exact bullet inside Phase 2.5 step 1:

```
   - Named scope: launch one `docs-researcher` for that domain
```

Replace it with:

```
   - Named scope: launch one `docs-researcher` for that domain
   - `reliability` scope: launch one `docs-researcher` per *cluster* that has findings (1-4 researchers), batched the same way
```

- [ ] **Step 7: Add reliability cluster rows to the Phase 3 `--patterns` mapping**

Find this exact table row (the last row of the Phase 3 patterns table):

```
   | accessibility  | `react-native`     |
```

Insert immediately after it:

```
   | reliability — server resilience (1-3)        | `security,architecture` |
   | reliability — client reliability (4-7)       | `react-native`          |
   | reliability — cross-cutting correctness (8-9)| `typescript,database`   |
   | reliability — detection/observability (10)   | `architecture`          |
```

- [ ] **Step 8: Add the reliability routing note to the Phase 8 codify table**

Find this exact table row (the last row of the Phase 8 "Finding Domain → Update Agent(s)" table):

```
   | Accessibility  | `accessibility-specialist.md`, `rn-ui-ux-specialist.md`                      |
```

Insert immediately after it:

```
   | Reliability    | route by cluster to the agents in the "Reliability Scope" table (no `reliability-specialist`); rules go to the matching existing `docs/rules/{domain}.md` (e.g. Class 8 → `typescript.md`/`database.md`, Class 9 → `database.md`, Class 6 → `security.md`) — never a new `reliability.md` |
```

- [ ] **Step 9: Verify all SKILL.md edits landed and are self-consistent**

Run: `grep -c 'reliability' .claude/skills/audit/SKILL.md`
Expected: at least `9` (mapping row, pre-launch para, named-scope exception, subsection heading + body refs, Phase 2 bullet, Phase 2.5 bullet, 4 Phase 3 rows, Phase 8 row)

Run: `grep -n '## Reliability Scope' .claude/skills/audit/SKILL.md`
Expected: exactly one match.

Run: `grep -ni 'reliability-specialist\|rules/reliability.md' .claude/skills/audit/SKILL.md`
Expected: matches ONLY inside the "No new infrastructure" / Phase 8 lines that say these are NOT created — confirm there is no line that _assigns_ a `reliability-specialist` or creates `docs/rules/reliability.md`.

- [ ] **Step 10: Commit**

```bash
git add .claude/skills/audit/SKILL.md
git commit -m "feat(audit): add reliability scope dispatch to audit skill"
```

---

## Task 3: Add `reliability` to the CLAUDE.md scopes list (local-only)

**Files:**

- Modify (gitignored, local-only): `CLAUDE.md`

- [ ] **Step 1: Update the scopes line**

Find this exact line under the "Code Audits" section:

```
Scopes: `full`, `pre-launch`, `security`, `performance`, `data-integrity`, `architecture`, `code-quality`
```

Replace it with:

```
Scopes: `full`, `pre-launch`, `security`, `performance`, `data-integrity`, `architecture`, `code-quality`, `reliability`
```

- [ ] **Step 2: Verify the edit**

Run: `grep -n 'Scopes:.*reliability' CLAUDE.md`
Expected: one match showing `reliability` appended to the scopes line.

- [ ] **Step 3: No commit**

`CLAUDE.md` is gitignored — there is nothing to stage. Do not attempt to commit it. (Confirm with `git status --short CLAUDE.md` → no output.)

---

## Task 4: Final consistency verification

**Files:** none modified — verification only.

- [ ] **Step 1: Confirm the checklist reference resolves**

Run: `grep -n 'reliability-checklist.md' .claude/skills/audit/SKILL.md`
Expected: at least one reference, and the file exists:
Run: `test -f .claude/skills/audit/reliability-checklist.md && echo OK`
Expected: `OK`

- [ ] **Step 2: Confirm `full` was NOT given a reliability dispatch**

Run: `grep -n 'full.*does \*\*not\*\* include' .claude/skills/audit/SKILL.md`
Expected: one match (the full-scope paragraph stating it excludes reliability).

- [ ] **Step 3: Confirm copilot-instructions is unaffected**

Run: `npm run build:copilot-instructions:check`
Expected: PASS / no diff — because `docs/rules/` and the path→domain map were not touched. (If it fails, something unintended changed `docs/rules/` — investigate; do NOT regenerate as a workaround.)

- [ ] **Step 4: Confirm the two tracked commits exist and CLAUDE.md is unstaged**

Run: `git log --oneline -2`
Expected: the two `feat(audit):` commits from Tasks 1 and 2.

Run: `git status --short`
Expected: no `.claude/skills/audit/` files pending; `CLAUDE.md` not listed (gitignored).

---

## Done criteria

- `.claude/skills/audit/reliability-checklist.md` exists, tracked, committed, lists all 10 classes in 4 clusters.
- `SKILL.md` has: the reliability mapping row; the split full/pre-launch instruction; the named-scope exception; the "Reliability Scope" subsection with the cluster→agents table; and reliability entries in the Phase 2, 2.5, 3, and 8 tables. Committed.
- `CLAUDE.md` scopes list includes `reliability` (local-only, uncommitted by design).
- No `reliability-specialist` agent and no `docs/rules/reliability.md` were created.
- `npm run build:copilot-instructions:check` passes (nothing in `docs/rules/` changed).
- The four Criticals from the dry run remain tracked in `todos/2026-05-29-critical-reliability-findings.md` (on branch `chore/2026-05-29-reliability-findings`) for triage via the first `/audit reliability` run.
