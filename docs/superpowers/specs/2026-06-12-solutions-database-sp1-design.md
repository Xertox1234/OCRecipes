# Solutions Database — SP1 (Data Layer) Design

**Date:** 2026-06-12
**Status:** Approved (brainstorming) — ready for implementation planning
**Author:** brainstorming session (Claude + xertox1234)
**Tracking:** This is **Sub-project 1 of 2**. SP2 (enforcement cut-over) is a separate spec.

---

## 1. Goal & context

Migrate the `docs/solutions/` knowledge base — **487 solution files** (500 `.md` total, minus
the root `README.md` and 12 `_manifests/` files), ~1.8 MB, ~38K lines across **7 categories**
plus `_manifests` — into a local PostgreSQL database, `ocrecipes_solutions`, with semantic
search exposed to Claude Code mid-session via a custom MCP server.

The end-state ambition (chosen by the user) is for the **database to become the canonical
store**, replacing the markdown files. Because those files are wired into live enforcement,
that ambition is split into two sub-projects:

- **SP1 (this spec) — Data layer.** Build the DB _alongside_ the files: schema, idempotent
  markdown→DB ingestion, non-destructive dedup analysis, and a read-only MCP server for
  semantic + structured search. The 487 solution files stay canonical and untouched. Zero risk to the
  editing loop. Fully testable in isolation.
- **SP2 (future spec) — Enforcement cut-over.** Once SP1's DB is proven complete and correct:
  rewrite `.claude/hooks/inject-patterns.sh` to query the DB, rewrite the `/codify` skill to
  `INSERT`, update the ~11 `.claude/agents/*.md` + `audit`/`todo` path references, then delete
  the markdown files. Irreversible steps happen last, behind a proven migration.

### Why decomposed (the binding constraint)

`docs/solutions/` is not just documentation — it is read live by
`.claude/hooks/inject-patterns.sh` on **every** `Edit`/`Write`/`MultiEdit` (date-sorted by
filename, `applies_to:` glob-matched) and written by the `/codify` skill. ~11 agent files and
the `audit`/`todo` skills reference the path. Replacing the files in one shot would rewrite the
enforcement hot path simultaneously with migrating the data — too much risk in one change. SP1
delivers immediate value (a queryable DB) with no enforcement risk; SP2 flips the canonical
switch after SP1 earns trust.

> Note: `docs/solutions/` is gitignored (`.gitignore:96`, `docs/superpowers/` likewise) — it
> already exists only on this laptop's main checkout and is **absent from git worktrees**. A
> shared local Postgres DB is reachable from every worktree equally, so DB-canonical actually
> _improves_ worktree coverage (relevant to SP2).

---

## 2. Decisions log (from brainstorming)

| #   | Question           | Decision                                                                                      |
| --- | ------------------ | --------------------------------------------------------------------------------------------- |
| 1   | DB role vs files   | **New canonical store** — but reached via SP1 (build alongside) → SP2 (cut over).             |
| 2   | "Dedupe" semantics | **Detect & report** — non-destructive; flag exact + near-duplicate clusters for manual merge. |
| 3   | Search depth       | **Semantic search now** via `pgvector` (keep `pg_trgm` for hybrid lexical signal).            |
| 4   | Embedding model    | **OpenAI `text-embedding-3-small`** (1536 dims), reuse `AI_INTEGRATIONS_OPENAI_API_KEY`.      |
| 5   | MCP layer          | **Custom thin MCP server** (Approach 1), read-only, richer toolset welcome.                   |

---

## 3. Architecture & boundaries

A self-contained module under `scripts/solutions-db/`, decoupled from the app. It does **not**
touch `shared/schema.ts` or the app's Drizzle config (those target `nutricam`); it targets
`ocrecipes_solutions` via its own database (`SOLUTIONS_DATABASE_URL` for writes,
`SOLUTIONS_DB_READONLY_URL` for the MCP reader — see §3). During SP1 the markdown files remain
canonical and untouched — this module only mirrors them.

```
scripts/solutions-db/
  schema.sql          # DDL: extensions, enums, solutions table, indexes, read-only role
  lib/parse.ts        # gray-matter frontmatter + H2 section split + content hash + zod validate
  lib/embeddings.ts   # OpenAI text-embedding-3-small wrapper (batch + retry); shared
  lib/db.ts           # pg pool from SOLUTIONS_DATABASE_URL
  ingest.ts           # walk -> parse -> validate -> upsert -> embed-on-change -> dedup report
  mcp-server.ts       # stdio MCP server, 7 read-only tools
  __tests__/          # vitest unit tests
```

**npm scripts:**

- `solutions:db:init` — apply `schema.sql`. **Run as a Postgres superuser** — `CREATE EXTENSION vector` and `CREATE ROLE solutions_ro` require it. All other scripts then use least-privilege roles.
- `solutions:db:ingest` — run ingestion (idempotent); connects with write access as the DB owner (`SOLUTIONS_DATABASE_URL`).
- `solutions:db:dedup` — produce dedup report (reads via `SOLUTIONS_DATABASE_URL`).
- `solutions:db:check` — standalone integration check (see §9); refuses to run without `SOLUTIONS_DATABASE_URL`.

**Environment variables — two URLs (the ingest _writer_ and the MCP _reader_ cannot share one role):**

- `SOLUTIONS_DATABASE_URL` — owner/write role; used by `:init`, `:ingest`, `:dedup`, `:check`. e.g. `postgresql://localhost/ocrecipes_solutions`.
- `SOLUTIONS_DB_READONLY_URL` — connects as `solutions_ro` (SELECT-only); used **only** by the MCP server.
- `AI_INTEGRATIONS_OPENAI_API_KEY` / `AI_INTEGRATIONS_OPENAI_BASE_URL` — embeddings (ingest + MCP query-time).

**Dependencies already in the repo:** `pg`, the OpenAI SDK, `zod`, `vitest`, `tsx`, `dotenv`.
**New packages to add:** `gray-matter` (frontmatter parsing) and `@modelcontextprotocol/sdk`
(the MCP server runtime) — both standard and maintained.

---

## 4. Data model — single `solutions` table

Denormalized single table (normalizing tags/symptoms into side tables is YAGNI at 500 rows —
Postgres arrays + GIN indexes handle containment queries well).

| Column            | Type                                 | Notes                                                                                                                                                                |
| ----------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | `uuid` PK (`gen_random_uuid()`)      |                                                                                                                                                                      |
| `source_path`     | `text` UNIQUE NOT NULL               | e.g. `logic-errors/retry-delay-…-2026-06-12.md` — canonical key / upsert key                                                                                         |
| `slug`            | `text` NOT NULL                      | filename stem minus date + `.md`, e.g. `retry-delay-array-index-underflow-zero-attempts` — human handle                                                              |
| `title`           | `text` NOT NULL                      | when frontmatter `title` is absent, **derived from the filename stem** (like `slug`) so tolerant ingestion never fails the insert; fallback recorded in `warnings[]` |
| `track`           | `track_enum` NOT NULL                | `bug` / `knowledge` — **directory-derived, reliable**                                                                                                                |
| `category`        | `category_enum` NOT NULL             | the 7 categories — directory-derived                                                                                                                                 |
| `module`          | `text`                               | author-entered; **validated, not enum** (tolerate drift)                                                                                                             |
| `severity`        | `text`                               | author-entered; validated                                                                                                                                            |
| `tags`            | `text[]` NOT NULL DEFAULT '{}'       | GIN-indexed                                                                                                                                                          |
| `symptoms`        | `text[]` DEFAULT '{}'                | GIN-indexed                                                                                                                                                          |
| `applies_to`      | `text[]` DEFAULT '{}'                | glob patterns; used by `find_by_applies_to`                                                                                                                          |
| `created`         | `date` NOT NULL                      |                                                                                                                                                                      |
| `last_updated`    | `date`                               |                                                                                                                                                                      |
| `body`            | `text` NOT NULL                      | full markdown below frontmatter                                                                                                                                      |
| `sections`        | `jsonb`                              | parsed H2 map: `{"Problem": "...", "Root Cause": "..."}`                                                                                                             |
| `content_hash`    | `text` NOT NULL                      | sha256(normalized frontmatter+body) — exact-dup key + re-embed trigger                                                                                               |
| `embedding`       | `vector(1536)`                       | nullable until embedded                                                                                                                                              |
| `embedding_model` | `text`                               | so later re-embeds are targeted                                                                                                                                      |
| `tsv`             | `tsvector` GENERATED ALWAYS … STORED | `to_tsvector('english', title ‖ ' ' ‖ body)`                                                                                                                         |
| `warnings`        | `text[]` DEFAULT '{}'                | validation issues — nothing silently dropped                                                                                                                         |
| `ingested_at`     | `timestamptz` DEFAULT now()          |                                                                                                                                                                      |

**Identifier semantics:** `source_path` is the canonical, guaranteed-unique key. `slug` is a
convenience handle for mid-session references; it is **not** guaranteed unique across categories,
so the `get_solution`/`related_solutions` tools resolve a `slug` to its row(s) and fall back to
requiring `source_path` if a slug is ambiguous.

**Enums** (`track_enum`, `category_enum`) only where the **directory guarantees** the value.
`module`/`severity` are author-typed; across 487 accreted files they will have drift, so making
them enums would hard-fail ingestion on a typo. They are `text` + validated, with problems
collected into `warnings[]` and the report. Tolerant ingestion beats a brittle schema for a
migration.

**Indexes:**

- `UNIQUE (source_path)`
- HNSW on `embedding` (`vector_cosine_ops`) — **optional / not load-bearing.** At 500 rows a flat
  cosine scan is sub-millisecond and _exact_; the index is forward-looking for growth. Spec
  permits omitting it for exact results with zero index-tuning.
- GIN on `tsv` (full-text)
- GIN on `tags`, `symptoms` (array containment)
- GIN trigram (`gin_trgm_ops`) on `title` (and optionally `body`) for fuzzy lexical match
- btree on `track`, `category`, `module`, `created`

**Extensions:** `vector` (pgvector), `pg_trgm`. Created by `schema.sql` in the new DB — these and
the `solutions_ro` role require running `solutions:db:init` as a **superuser** (see §3).

---

## 5. Ingestion flow (`ingest.ts`, idempotent)

1. Walk `docs/solutions/**/*.md`, skipping `_manifests/` and `README.md`.
2. Parse frontmatter (`gray-matter`) + split body into H2 sections; validate against a zod schema
   mirroring `docs/solutions/README.md`'s field table → collect `warnings[]` (never hard-skip a
   file). Derivable required fields are backfilled and the substitution logged to `warnings[]`:
   `title` ← filename stem when absent; `track`/`category` ← directory path (cross-checked against
   frontmatter). Non-derivable missing required fields are flagged but never block the insert.
3. Compute `content_hash` over normalized (frontmatter + body). Upsert on `source_path`.
4. **Re-embed only when `content_hash` changed** (or `embedding` is NULL) → re-runs cost ~$0 and
   take seconds.
5. Embedding input = `title + "\n\n" + body`, truncated to the model's token limit (most files
   fit whole). Batched requests via `lib/embeddings.ts`.
6. Optional `--prune` flag: delete rows whose `source_path` no longer exists on disk (off by
   default — safe).

**One-time cost:** ~487 files × ~1K tokens ≈ ~490K tokens ≈ **$0.01** at
`text-embedding-3-small` rates. Per-query: fractions of a cent.

---

## 6. Dedup — detect & report (non-destructive)

`solutions:db:dedup` produces `docs/solutions/_manifests/<date>-dedup-report.md` — a **new**
file joining the 12 existing manifests there (and skipped by ingestion), per the established
`_manifests/` convention. This adds to the tree but modifies none of the 487 content files:

- **Exact:** group by `content_hash`.
- **Near:** for each row, cosine neighbors ≥ threshold (default **0.88**, configurable),
  transitively clustered. Each cluster lists file paths, titles, categories, pairwise similarity,
  and a suggested action (merge / keep-distinct / add `## See Also` link). A similarity histogram
  is included so the threshold can be tuned.

Nothing is auto-merged. The report is the input the user (or, later, SP2's `/codify`) acts on.
Overlap pairs are also queryable in-DB via the `find_duplicates` MCP tool.

---

## 7. MCP server — 7 read-only tools (`mcp-server.ts`)

stdio MCP server built on `@modelcontextprotocol/sdk`.

| Tool                 | Signature                                                  | Purpose                                                                            |
| -------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `search_solutions`   | `(query, k=8, {track?,category?,module?,tags?,severity?})` | embed query → filtered cosine search → top-k with snippet + similarity             |
| `get_solution`       | `(slug \| source_path)`                                    | full row incl. body + sections                                                     |
| `related_solutions`  | `(slug, k=5)`                                              | nearest neighbors of an existing solution (semantic "see also")                    |
| `find_by_applies_to` | `(file_path)`                                              | solutions whose `applies_to` globs match a path — **previews SP2's hook behavior** |
| `find_duplicates`    | `(threshold=0.88, category?)`                              | near-dup clusters on demand                                                        |
| `stats`              | `()`                                                       | counts by track/category/module/severity, date range, # embedded, # flagged        |
| `sql`                | `(query)`                                                  | arbitrary **read-only** SELECT for structured/aggregate queries                    |

**Read-only enforced two ways (defense in depth):**

1. The server connects as a dedicated `solutions_ro` Postgres role with `SELECT`-only grants.
2. The `sql` tool guards each statement: reject non-`SELECT`/DDL/DML, wrap in
   `SET TRANSACTION READ ONLY`, cap result rows, apply a statement timeout.

The OpenAI key is read from `AI_INTEGRATIONS_OPENAI_API_KEY` (+ `AI_INTEGRATIONS_OPENAI_BASE_URL`)
in the server's environment — **never** stored in `.mcp.json` or the database.

**Wiring:** `.mcp.json` does not exist yet — create it at the repo root and **commit it** (it is
not gitignored and holds no secrets, only env-var references), so every git worktree picks up the
server. Its entry launches `mcp-server.ts` (via `tsx`/node) connecting as the read-only role via
`SOLUTIONS_DB_READONLY_URL`, with `AI_INTEGRATIONS_OPENAI_API_KEY` / `AI_INTEGRATIONS_OPENAI_BASE_URL`
passed through the environment (never written as literals in the file).

---

## 8. Error handling

- **Bad/missing frontmatter** → recorded in `warnings[]` + report; row still ingested (visible,
  not lost).
- **Embedding API failure** → retry with backoff; on persistent failure leave `embedding` NULL
  (row still findable via FTS/trigram); report unembedded count; next run retries.
- **Missing DB** → fail fast with a message pointing to `solutions:db:init`.
- **Query-embedding failure (MCP)** → `search_solutions`/`related_solutions` return a clear error;
  `sql`/`stats`/`get_solution`/`find_by_applies_to` still work without network.

---

## 9. Testing (Vitest, repo standard)

**Unit (DB + OpenAI mocked, CI-safe):**

- `parse.ts` — frontmatter parse, H2 section split, content hashing on fixtures.
- `find_by_applies_to` glob matching.
- read-only `sql` guard — rejects INSERT/UPDATE/DELETE/DDL, accepts SELECT/CTE.
- dedup transitive clustering on a synthetic similarity matrix.
- embedding-text builder + truncation boundary.

**Integration check — a standalone CLI script, not a Vitest file** (`scripts/solutions-db/integration-check.ts`,
run via `npm run solutions:db:check`). The repo has **zero** `skipIf` usage; env-/resource-gated
checks follow the `evals/runner-*.ts` precedent — standalone scripts CI never collects. The script
connects to the real local DB, runs an ingest + a sample `search_solutions`, asserts the results,
and refuses to run without `SOLUTIONS_DATABASE_URL`. A standalone script also avoids the
import-time DB connection a collected `*.test.ts` would open during CI test collection (before any
`skipIf` could short-circuit it).

---

## 10. SP1 acceptance criteria

- [ ] `ocrecipes_solutions` DB exists with `vector` + `pg_trgm` extensions and the `solutions`
      schema applied via `solutions:db:init`.
- [ ] `solutions:db:ingest` loads all 487 solution files idempotently; re-run embeds nothing new and is fast.
- [ ] Every ingested row has a non-empty `body`, valid `track`/`category`, and either an embedding
      or a recorded reason it lacks one; validation issues surfaced in `warnings[]`.
- [ ] `solutions:db:dedup` produces a dated report under `_manifests/` with exact + near clusters.
- [ ] The MCP server exposes all 7 tools; `search_solutions` returns relevant top-k for a
      natural-language query; the `sql` tool rejects all writes.
- [ ] Unit tests pass in CI without a DB or API key; integration test passes locally behind the env gate.
- [ ] The 487 solution **content** files are unchanged (verified) — the only tree addition is the
      new dedup report under `_manifests/`; SP1 is otherwise DB-only and additive.

## 11. Explicitly out of scope (deferred to SP2)

- Rewriting `inject-patterns.sh` to query the DB.
- Rewriting `/codify` to `INSERT` instead of writing files.
- Updating agent/skill path references.
- Deleting the markdown files / making the DB canonical.
- Any write-path MCP tools.
