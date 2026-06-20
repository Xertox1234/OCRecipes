---
title: "Run solutions-db gates (parity / round-trip / hook-equivalence) in CI"
status: done
priority: low
created: 2026-06-14
updated: 2026-06-14
assignee:
labels: [deferred, testing, database]
github_issue:
---

# Run solutions-db gates (parity / round-trip / hook-equivalence) in CI

## Background

The three SP2 correctness gates are the real proof that the DB↔mirror invariant and the
inject-hook cut-over hold:

- `npm run solutions:db:parity` — DB `content_hash` == disk `content_hash` for every solution.
- `npm run solutions:db:export -- --verify` — full-corpus serialize→reparse→stored-hash round-trip.
- `npx tsx scripts/solutions-db/hook-equivalence-check.ts` — the DB-backed inject hook emits the
  same refs as the markdown-fallback path.

They are **operator-run only** — they need a populated local Postgres (`pgvector` + `pg_trgm`)
and are NOT part of CI. So **CI green ≠ gates green**: a future edit to
`scripts/solutions-db/lib/parse.ts`, `lib/serialize.ts`, or `.claude/hooks/inject-patterns.sh`
could pass CI (lint + the pure-lib unit tests) while silently breaking parity / round-trip /
hook-equivalence — with nothing automated catching it. Surfaced in the PR #398 (SP2) review as
the top residual risk.

**Feasibility insight (removes the main blocker):** the gates do NOT require _real_ embeddings.
`parity` only asserts `nullEmbeddings=0` (any non-null vector satisfies it); round-trip and
hook-equivalence don't touch embeddings at all. So a CI run can use a **deterministic stub
embedder** (a fixed/hashed vector of length `EMBED_DIMS`) — no OpenAI key, no API cost — and
still validate all three gates.

## Acceptance Criteria

- [ ] A CI job (or a documented, enforced pre-merge step) provisions Postgres with `vector` +
      `pg_trgm`, applies `schema.sql`, ingests the solutions corpus using a stub embedder (no
      OpenAI key), and runs all three gates.
- [ ] The job fails the build if any gate fails.
- [ ] No OpenAI key is required in CI (stub embedder); the stub mechanism is documented.
- [ ] If a CI Postgres service is judged too heavy, the chosen alternative — a documented,
      mandatory local pre-merge gate ritual in `DEV_SETUP.md`, referenced from the PR template —
      is written down, and this todo records the decision.

## Implementation Notes

- **Corpus availability is the main open question.** `docs/solutions/` is gitignored, so a CI
  checkout has none of the 491 files. Options: (a) commit a small **fixture corpus** (a handful of
  representative solution files under a CI-only path) to validate the gate _mechanism_ even if not
  the full corpus; (b) generate a synthetic corpus in the job; (c) reconsider whether a subset is
  enough. Resolve this first — it shapes the rest.
- **Stub embedder:** add an env-gated branch in `scripts/solutions-db/lib/embeddings.ts` (e.g.
  `SOLUTIONS_EMBED_STUB=1` → return a deterministic vector per input of length `EMBED_DIMS`), used
  ONLY in CI. Keep it out of the real ingest path (guard on the env var).
- **Postgres service:** GitHub Actions `services:` with the `pgvector/pgvector` image (ships the
  `vector` extension; `pg_trgm` is contrib). `schema.sql` needs superuser for
  `CREATE EXTENSION`/`CREATE ROLE` — the service's default superuser covers it.
- **Files in scope:** `.github/workflows/*.yml` (new job/step), `lib/embeddings.ts` (stub branch),
  a CI-specific ingest invocation. No change to the gate scripts themselves.

## Dependencies

- Builds on SP2 (PR #398). The corpus-in-CI decision is the gating sub-task.

## Risks

- Corpus availability in CI (the gitignored mirror) — likely needs a committed fixture subset.
- A Postgres service + ingest adds minutes to the pipeline.

## Updates

### 2026-06-14

- Initial creation — deferred from the PR #398 (SP2) review; the three operator gates that prove
  the DB↔mirror invariant do not run in CI, so regressions to the hash/serialize/hook code could
  pass CI undetected. Stub-embedder insight noted to make CI gating feasible without an API key.

### 2026-06-20

- **Decision (AC#4): chose the CI Postgres-service job, not the local pre-merge ritual.** A
  `pgvector/pgvector:pg16` service is already the established pattern in `ci.yml` (the test/coverage
  jobs run a `postgres:16` service), so the marginal cost is one more parallel job — the automated
  gate beats a documented-but-skippable manual ritual. The local ritual is documented in
  `DEV_SETUP.md` as a reproduction aid, but the enforced gate is the CI job.
- **Corpus resolution: committed fixture subset.** `docs/solutions/` is gitignored so CI has no
  corpus. Committed 11 real corpus files to `scripts/solutions-db/__fixtures__/solutions/`, chosen to
  span the inject-hook probe domains (api/database/security/react-native/accessibility/ai-prompting/
  testing/typescript), include both tracks, and put 5 files in the `database` domain so the hook's
  `SOLUTIONS_PER_DOMAIN`=4 cap + `reserve_bug_slot` are exercised. The CI job copies them into
  `docs/solutions/` before ingest. Using real files (not synthetic) guarantees they parse/round-trip
  cleanly and that hook-equivalence is non-vacuous (every probe matched ≥1 ref in local verification).
- **Stub embedder:** `SOLUTIONS_EMBED_STUB=1` branch in `getClient()` (not `embedBatch` — the default
  param evaluates `getClient()` before the body, so a body-level branch would throw on the missing
  key first). Returns a deterministic length-`EMBED_DIMS` hashed vector per input with the per-request
  `index` preserved. New unit tests cover it; verified end-to-end against a scratch DB (all 3 gates
  green; negative test confirmed parity exits 1 on a corrupted hash).
