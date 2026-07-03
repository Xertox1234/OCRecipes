---
title: Running DB + embedding-backed correctness gates in CI (fixture corpus + stub embedder)
track: knowledge
category: best-practices
module: scripts
tags: [ci, solutions-db, embeddings, testing, gates, stub, fixtures, openai]
applies_to: [scripts/solutions-db/**/*.ts, .github/workflows/*.yml]
created: '2026-06-20'
---

# Running DB + embedding-backed correctness gates in CI (fixture corpus + stub embedder)

## When this applies

You have a feature whose correctness gates need a populated Postgres + embeddings (e.g. the
`solutions-db` parity / round-trip / hook-equivalence gates), and you want them to run in CI
without an OpenAI key, without API cost, and without the operator-only local setup. Trigger:
any edit to the parser/serializer/hook code those gates protect, or wiring a new gate of this
shape into a workflow.

## Why

CI green ≠ gates green. The pure-lib unit tests collect with zero side effects (per the lazy-init
convention), so they pass with no DB and no key — but they do **not** run the gates, so a
regression to `parse.ts` / `serialize.ts` / `inject-patterns.sh` can pass CI while silently
breaking parity / round-trip / hook-equivalence. The fix is to run the actual gate scripts in CI.
Three obstacles and their resolutions:

1. **Embeddings need a key.** They don't, for these gates: parity only asserts `nullEmbeddings=0`
   (any non-null vector satisfies it); round-trip and hook-equivalence never touch vectors. So a
   deterministic **stub embedder** (a hashed fixed-length vector) is sufficient — no key, no cost.

2. **The stub must go in `getClient()`, NOT in `embedBatch`.** `embedBatch(texts, client = getClient())`
   evaluates its default param at call time, and the real caller (`upsertSolutions`) calls
   `embedBatch(...)` with **no** client. A body-level `if (STUB)` branch inside `embedBatch` is
   therefore reached only *after* `getClient()` already threw `"AI_INTEGRATIONS_OPENAI_API_KEY not set"`.
   Put the env gate at the top of `getClient()` so it returns a fake `Pick<OpenAI,"embeddings">`
   before the key check. Keep it env-gated (`SOLUTIONS_EMBED_STUB=1`) so the real ingest path is
   untouched. Have the fake's `create` carry a per-request `index` on each item, so `embedBatch`'s
   index-based mapping is exercised exactly as for a real response.

3. **The gitignored corpus is absent in CI.** `docs/solutions/` is gitignored, and both the gate
   scripts (`SOLUTIONS_ROOT`) and the inject hook (`SOLUTIONS_DIR`) read that **hardcoded** path —
   no env override exists, and the bash hook can't be redirected anyway. So commit a small
   **fixture corpus** under a tracked path (`scripts/solutions-db/__fixtures__/solutions/`) and have
   the CI job copy it into `docs/solutions/` before ingest. Use **real** corpus files, not synthetic
   ones: real files parse/round-trip cleanly (this codec produced them), and you must pick them to
   span the inject-hook probe domains with one domain exceeding `SOLUTIONS_PER_DOMAIN` — otherwise
   hook-equivalence compares two empty ref-lists, agrees trivially, and passes while testing nothing
   (the "all gates green" trap of an independent-reader gate).

## Examples

CI job skeleton (`.github/workflows/ci.yml`):

```yaml
solutions-db-gates:
  services:
    solutions_pg:
      image: pgvector/pgvector:pg16      # ships `vector`; `pg_trgm` is bundled contrib
      env: { POSTGRES_USER: solutions, POSTGRES_PASSWORD: solutions, POSTGRES_DB: ocrecipes_solutions }
      ports: ["5432:5432"]
  env:
    SOLUTIONS_DATABASE_URL: postgresql://solutions:solutions@localhost:5432/ocrecipes_solutions
    SOLUTIONS_DB_READONLY_URL: postgresql://solutions_ro:solutions_ro@localhost:5432/ocrecipes_solutions
    SOLUTIONS_EMBED_STUB: "1"
  steps:
    - run: npm run solutions:db:init                   # schema.sql: extensions + table + solutions_ro role
    - run: |                                           # guard against a vacuous pass
        [ "$(find scripts/solutions-db/__fixtures__/solutions -name '*.md' | wc -l)" -gt 0 ] || exit 1
        mkdir -p docs/solutions && cp -R scripts/solutions-db/__fixtures__/solutions/. docs/solutions/
    - run: npm run solutions:db:ingest                 # stub embedder, no key
    - run: npm run solutions:db:parity                 # Gate A
    - run: npm run solutions:db:export -- --verify     # Gate B
    - run: npm run solutions:db:hook-check             # Gate C
```

`POSTGRES_DB: ocrecipes_solutions` is load-bearing: `schema.sql`'s `GRANT … ON DATABASE
ocrecipes_solutions` only resolves if that DB name exists. Both URLs are needed — the superuser
(`SOLUTIONS_DATABASE_URL`, = `POSTGRES_USER`) for init/ingest/parity, and the `solutions_ro` role
(`SOLUTIONS_DB_READONLY_URL`, created by `schema.sql`) for the Gate C inject-hook path.

Verifying locally without polluting live data: the worktree's `docs/solutions/` **symlinks to the
real corpus**, so never `cp` fixtures into it or run ingest against it. Instead copy the tree into a
temp dir (the symlink is gitignored so it won't follow), point both URLs at a throwaway DB, and run
init → fixtures → ingest → the three gates there.

## Exceptions

- If a gate's correctness genuinely depends on real embedding *values* (semantic ranking), a stub
  cannot validate it — that needs an end-to-end assertion with real vectors, which is out of scope
  for a key-free CI gate. The three gates here deliberately don't depend on vector values.
- A round-trip/parity gate still only catches *drift* and serializer faults; it is blind to bugs in
  the shared parser both sides call. Keep at least one independent-reader gate (Gate C: raw grep vs
  parsed DB) and treat any residual diff as a finding, not noise.

## Related Files

- `scripts/solutions-db/lib/embeddings.ts` — `getClient()` stub branch + `stubVector`
- `scripts/solutions-db/__fixtures__/solutions/` — committed real-corpus fixtures (probe-domain spanning)
- `scripts/solutions-db/parity-check.ts`, `scripts/solutions-db/export.ts`, `scripts/solutions-db/hook-equivalence-check.ts` — the three gates
- `.github/workflows/ci.yml` — the `solutions-db-gates` job

## See Also

- [../conventions/lazy-init-db-pool-and-api-client-in-test-imported-modules-2026-06-13.md](../conventions/lazy-init-db-pool-and-api-client-in-test-imported-modules-2026-06-13.md) — why the stub goes in the lazy client, keeping import side-effect-free
- [../conventions/gate-over-two-derivations-of-same-function-is-blind-2026-06-14.md](../conventions/gate-over-two-derivations-of-same-function-is-blind-2026-06-14.md) — why hook-equivalence must be non-vacuous to be worth running
- [../logic-errors/openai-batch-embeddings-map-by-response-index-2026-06-14.md](../logic-errors/openai-batch-embeddings-map-by-response-index-2026-06-14.md) — the stub carries `index` per item to exercise the same mapping
