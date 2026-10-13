# Solutions Database — SP2 (Enforcement Cut-over) Design

**Date:** 2026-06-13
**Status:** Approved (brainstorming) — ready for implementation planning
**Author:** brainstorming session (Claude + xertox1234)
**Tracking:** This is **Sub-project 2 of 2.** SP1 (data layer) shipped in PR #397 and is live:
`ocrecipes_solutions` exists, 487 rows, all embedded. This spec makes the DB **canonical** and
turns the markdown files into a regenerated mirror.

---

## 1. Goal & context

SP1 built the `ocrecipes_solutions` Postgres DB _alongside_ the markdown files (files canonical,
DB a secondary search index). SP2 **flips the canonical switch**: the injection hook reads from
the DB, `/codify` writes to the DB, and `docs/solutions/*.md` becomes a **regenerated read-only
mirror** kept in sync DB → file.

### The data-flow inversion (the heart of SP2)

- **Today:** `markdown → ingest.ts → DB`. Files are canonical; `ingest.ts` is an ongoing sync.
- **After SP2:** `DB → (optionally) markdown`. The DB is canonical; `ingest.ts` becomes a
  one-time historical importer; a new `solutions:db:export` regenerates the mirror; a new
  `solutions:db:add` is the single write path.

### File topology — regenerable export-mirror (decided)

The 491 markdown files are **never deleted.** At cut-over, DB and disk are proven semantically
identical (the parity gate). From then on, files are _regenerated_ from the DB instead of
hand-authored — they change role from "source" to "output." Because the mirror is always present
on disk, the hook gets a **free fallback**: query the DB first; if Postgres is unreachable, fall
back to the existing grep-over-markdown path. Enforcement never has a gap. `docs/solutions/`
stays **gitignored** (per the 2026-05-21 decision to untrack it from GitHub); durable backup is
the DB plus the on-disk mirror plus optional `pg_dump`.

### Why this is safe to do now

SP1 earned trust: the DB is populated and embedded, and the export-mirror topology means SP2 has
**no irreversible step.** Every stage is reversible by `git revert` or by the
`PATTERN_INJECT_SOURCE=markdown` kill-switch. A 4-file drift exists (disk 491 vs DB 487 — the
SP1-codified docs were added after ingestion); the precondition re-ingest clears it.

### Blast radius (verified by a repo-wide sweep)

| Surface                | Files                                                                              | Change                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Injection hook (reads) | `.claude/hooks/inject-patterns.sh`                                                 | swap solution-ref block markdown→DB; keep markdown fallback                                     |
| Write skills           | `.claude/skills/codify/SKILL.md`, `audit/SKILL.md`, `todo/SKILL.md`                | route writes through `solutions:db:add`; DB-based overlap-check                                 |
| Agent prose refs       | 11 `.claude/agents/*.md`                                                           | redirect "look in `docs/solutions/`" → MCP `search_solutions`/`get_solution`; mirror = fallback |
| Core docs              | `docs/PATTERNS.md`, `CLAUDE.md`, `docs/AI_DRIFT_CHECKLIST.md`, `docs/DEV_SETUP.md` | describe DB-canonical model + `SOLUTIONS_DB_READONLY_URL` setup                                 |
| SP1 module             | `scripts/solutions-db/`                                                            | add `export`/`add`/`parity`; redefine `content_hash`; add `extra_fields`                        |

**Untouched (verified):** `docs/rules/*.md` (rules stay markdown, injected from disk as today);
`.github/copilot-instructions.md` generation (reads `docs/rules` + `docs/legacy-patterns`, never
`docs/solutions`); all CI workflows (none reference solutions/inject/codify). `todos/archive/*`
and incidental code-comment references are frozen history — not in scope.

---

## 2. Decisions log (from brainstorming, 2026-06-13)

| #   | Question                       | Decision                                                                                                                              |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fate of the 491 markdown files | **Regenerable export-mirror** — DB canonical; files regenerated, never deleted; gitignored.                                           |
| 2   | Overall shape                  | **Bash-hybrid, full cut-over** — keep hook in bash, `psql` tag-query + reuse existing bash `applies_to` glob code; markdown fallback. |
| 3   | Fail-open behavior             | **DB-first, markdown-mirror fallback** (free, given the topology); `PATTERN_INJECT_SOURCE` kill-switch.                               |
| 4   | Write path                     | **`solutions:db:add` CLI** (MCP server stays read-only — `solutions_ro` is a real boundary).                                          |
| 5   | `content_hash` definition      | **Redefine to normalized-projection hash** — raw-bytes hash is incompatible with a regenerated mirror.                                |
| 6   | Unknown frontmatter keys       | **`extra_fields jsonb`** column + variant normalization (`date→created`, `updated→last_updated`).                                     |
| 7   | Hook ordering                  | **Sort by the `YYYY-MM-DD` in `source_path`** (matches today's filename-date sort exactly), not the `created` column.                 |

---

## 3. Architecture & data flow

```
codify / audit / todo ──> solutions:db:add ──> DB (canonical, embedded)
                                                │  ▲
        inject hook ── psql tag/glob query ─────┘  │ pg_dump (optional offsite backup)
             │                                       │
             └─ DB down / flag=markdown ─> grep ──> docs/solutions/*.md (mirror)
                                            ▲
                            solutions:db:export (DB → file, recovery/regenerate)
```

A self-contained extension of the existing `scripts/solutions-db/` module. It does **not** touch
the app DB (`nutricam`) or `shared/schema.ts`. New scripts reuse SP1's `lib/parse.ts`,
`lib/db.ts`, `lib/embeddings.ts`, `lib/globs.ts`.

**Read-only boundary preserved.** The MCP server keeps its `solutions_ro` SELECT-only role and
its 7 read tools — SP2 adds **no** write tools to it. All writes go through `solutions:db:add`,
which connects as the owner role (`SOLUTIONS_DATABASE_URL`).

---

## 4. Data model changes

SP1's schema and the populated DB stay; SP2 makes three surgical changes.

### 4.1 New column — `extra_fields jsonb NOT NULL DEFAULT '{}'`

Captures any frontmatter key outside the known set so export is **lossless**. The pre-spec scan
of all 491 files found exactly these out-of-schema keys today:

- `source:` (6 files) — provenance, e.g. `"2026-06-10 security audit (S1/S2/S3)"`. **Genuinely
  extra** → stored in `extra_fields`.
- `date:` (6 files) / `updated:` (1 file) — **variant spellings** → normalized (see 4.3), not
  stored as extras.

Migration (idempotent, for the existing DB):

```sql
ALTER TABLE solutions ADD COLUMN IF NOT EXISTS extra_fields jsonb NOT NULL DEFAULT '{}';
```

`schema.sql` also gains the column in its `CREATE TABLE` for fresh installs. `solutions:db:init`
runs both (the `ALTER … IF NOT EXISTS` is a no-op on a fresh table).

### 4.2 Redefined `content_hash` — normalized projection, not raw bytes

SP1's `computeContentHash(raw)` = `sha256(raw.trim())` — hashes the entire raw file verbatim.
That is correct only while files are never regenerated. Under a regenerated mirror an exported
file is never byte-identical to the hand-authored original, so a raw-bytes hash would make parity
fail spuriously. SP2 redefines it as a **serialization-independent** hash:

```
content_hash = sha256(
  canonicalProjection(fields, extra_fields) + "\n" + body.trim()
)
```

`canonicalProjection` builds a deterministic JSON string with a **fixed key order**
(`title, track, category, module, severity, tags, symptoms, applies_to, created, last_updated`,
then `extra` = extra_fields with **sorted keys**), all known fields present (explicit `null` when
absent, `[]` for absent arrays), **array element order preserved** (author order is meaningful;
reordering tags is a real change). `body` is the trimmed markdown below the frontmatter.

**One function, never reimplemented.** `computeContentHash` lives in `lib/parse.ts` and is
imported by `ingest.ts`, `add.ts`, `export.ts`, `parity.ts`, and the round-trip test. (Same
discipline as `globs.ts` mirroring the bash matcher — but here there is no reason to mirror, so
there is exactly one copy.)

**Migration consequence:** redefining the hash changes every row's `content_hash`. The
precondition re-ingest recomputes all 491 and re-embeds them once (re-embed is keyed on
`content_hash` change). Cost ≈ **$0.01**, ~1–2 min. One-time.

**Side benefit:** the normalized hash makes exact-dup detection (`dedup` "group by content_hash")
catch semantically-identical-but-reformatted files that the raw-bytes hash missed.

### 4.3 Variant-key normalization on ingest/parse

In `parse.ts`, before building columns:

- `date:` → `created` (when `created`/frontmatter date absent), recorded in `warnings[]`.
- `updated:` → `last_updated`, recorded in `warnings[]`.
- Every remaining frontmatter key not in the known set → `extra_fields` (verbatim value).

So the 6 `date:` + 1 `updated:` files round-trip cleanly (variant spelling normalized away,
value preserved in the canonical column) and `source:` survives in `extra_fields`.

---

## 5. New components

### 5.1 `solutions:db:export` (DB → markdown)

`tsx scripts/solutions-db/export.ts`. Reconstructs canonical-form markdown for a row (or all
rows) at its `source_path`: serializes known frontmatter fields + spreads `extra_fields`, then
the body. Two modes:

- `solutions:db:export -- <source_path>` — regenerate one file (used by `add`).
- `solutions:db:export -- --all` — rebuild the entire mirror (recovery from a `pg_dump` restore).

**It does not re-write existing files at cut-over** — they already hash-match their rows (parity
gate). Export writes only for rows created/changed afterward, so there is no 491-file reformatting
churn. The exported form is guaranteed faithful by the round-trip gate (§9).

### 5.2 `solutions:db:add` (the single write path)

`tsx scripts/solutions-db/add.ts`. Reuses `ingest.ts`'s parse → validate → embed → upsert
machinery on **one** file:

```
solutions:db:add -- <path-to-markdown>     # parse → near-dup check → embed → upsert → export mirror
solutions:db:add -- <path> --dry-run        # near-dup + validation report, no write
```

Runs the same cosine near-dup check `dedup-report.ts` uses; prints advisory `near-duplicate: <path>`
lines (preserves `/codify`'s advisory-not-blocking behavior). Connects as the owner role. After a
successful upsert it calls `export` for that `source_path` so the mirror stays current.

### 5.3 `solutions:db:parity` (the cut-over gate)

`tsx scripts/solutions-db/parity.ts`. Hard gate before flipping `PATTERN_INJECT_SOURCE` to `db`:

1. **Count parity** — DB `COUNT(*)` == non-`_manifests`, non-`README` `.md` files on disk.
2. **Per-file content-hash parity** — for every disk file, recompute the normalized
   `content_hash` (via the shared function) and assert a row with that `source_path` has the same
   hash. Any mismatch/missing row → **fail, names the file.**
3. **Embedding completeness** — zero rows with `NULL embedding`.

Exit non-zero on any failure. This is "DB == disk, content-verified," not "looks populated."

---

## 6. The hook cut-over (`inject-patterns.sh`)

**Unchanged:** discipline preamble, `domain-map.sh`, per-session dedup, spill logic, and the full
`docs/rules/<domain>.md` injection (read from disk as today). Only the solution-ref block
(~lines 142–207) changes.

**New structure** — extract three bash units:

- `solutions_from_db <domain> <tag_pattern>` — runs the `psql` query, feeds rows into the
  (unchanged) glob-promotion loop.
- `solutions_from_markdown <domain> <tag_pattern>` — today's grep block, **verbatim**, kept as
  fallback.
- Dispatcher — use DB iff `PATTERN_INJECT_SOURCE != markdown` **and** the `psql` query exits 0;
  else markdown. DB-down and manual-revert share one path; `PATTERN_INJECT_SOURCE=markdown` is the
  kill-switch.

**The query** (read-only role, tab-separated, candidates newest-first by **filename date**):

```sql
SELECT source_path, title, array_to_string(applies_to, '|')
FROM solutions
WHERE tags && ARRAY[<domain-tag-variants>]::text[]          -- ai-prompting also: OR EXISTS(unnest(tags) t WHERE t LIKE 'ai-%')
ORDER BY substring(source_path from '(\d{4}-\d{2}-\d{2})\.md$') DESC NULLS LAST
LIMIT 40;                                                    -- candidate pool; bash glob-promotes then takes top SOLUTIONS_PER_DOMAIN
```

Ordering by the `source_path` filename date (not the `created` column) reproduces today's
`sed`-extracted filename-date sort exactly, even where frontmatter `created`/`date` diverges from
the filename suffix.

**The glob code does not move.** The existing bash `applies_to` glob-promotion loop stays where it
is; it now reads each candidate's `applies_to` from the **psql row** (third tab-separated column,
split on `|`) instead of grepping the file. The `[[ "$_FILE_REL" == $_pat ]]` matching is
byte-unchanged — so the live hook and the `find_by_applies_to` MCP tool (which `globs.ts` mirrors)
stay provably aligned. **Zero new divergence surface.**

**Requirement:** `SOLUTIONS_DB_READONLY_URL` in the hook environment (same var `.mcp.json` uses,
from `~/.zshenv`). Absent → `psql` fails → markdown fallback fires automatically. No hard
dependency.

**Cost:** `psql` cold-start ~20–50 ms + sub-ms query at ~491 rows; per-session dedup means it runs
at most once per domain per session. Negligible on the Edit/Write hot path.

---

## 7. Write-path cut-over (`codify` / `audit` / `todo`)

`/codify` changes in three steps; the rest of the skill is unchanged:

- **Step 6b (overlap-check):** replace `rg` over the category directory with the DB near-dup check
  (semantic, catches paraphrased duplicates the bag-of-words Jaccard misses) — via
  `solutions:db:add --dry-run` or folded into the add step.
- **Step 6c (write):** compose the markdown as today, then hand it to `solutions:db:add` instead of
  writing the file directly. The DB row becomes canonical; the exported mirror replaces what
  codify would have written.
- **Step 7 (commit):** `docs/solutions/` is already gitignored, so there was never a solution file
  to commit — the step only ever committed agent files. It shrinks to "commit any agent-file
  updates." The DB write is intentionally outside git; the DB (+ `pg_dump`) is the durable record.

`/audit` and `/todo` each have a codification step that delegates to this flow → point them at
`solutions:db:add`.

---

## 8. Prose refs (11 agents + 4 core docs)

These contain _instructions_ (read/write that location), so each is read and rewritten, not
string-substituted.

- **11 `.claude/agents/*.md`:** replace "patterns are codified in `docs/solutions/`" with
  _"Knowledge lives in the solutions DB — query it mid-session via the MCP `search_solutions` /
  `get_solution` tools. `docs/solutions/_.md` is a regenerated read-only mirror (fallback only)."\*
- **`docs/PATTERNS.md`:** update the knowledge-base layout to describe the DB as canonical and the
  markdown as a mirror.
- **`CLAUDE.md`:** update the "Key Patterns" description of the injection hook (DB-backed, markdown
  fallback) and the codify destination.
- **`docs/AI_DRIFT_CHECKLIST.md`:** reflect DB-canonical in any solutions-related checks.
- **`docs/DEV_SETUP.md`:** add the `SOLUTIONS_DB_READONLY_URL` env var and the
  `solutions:db:init` + `:ingest` setup steps so a fresh checkout knows the hook needs the DB
  (and that the markdown fallback covers its absence).

---

## 9. Gates & rollout order

Each step is independently shippable and reversible.

1. **Schema + trust instruments.** Add `extra_fields`; redefine `content_hash`; build
   `solutions:db:export` + `solutions:db:parity`. **Re-ingest all 491** (clears the drift,
   recomputes hashes, re-embeds once).
   - **Gate A — parity:** `solutions:db:parity` green (491==491, every file hash-matches, zero
     NULL embeddings).
   - **Gate B — full-corpus round-trip:** for **all 491 rows**, `row → serialize (in-memory, via
the export serializer — does not overwrite the mirror) → re-parse → identical content_hash`.
     This is the real fidelity proof; parity alone is green-by-construction post-ingest and does not
     prove export faithfulness. Round-trip is a **gate step**, not just an acceptance bullet.
2. **Write path.** Build `solutions:db:add` + unit tests.
3. **Hook cut-over.** Add `solutions_from_db` + dispatcher; ship with `PATTERN_INJECT_SOURCE`
   defaulting to **`markdown`** (no behavior change).
   - **Gate C — equivalence:** a **full diff across every domain** (plus a sample of real edited
     paths) showing `solutions_from_db` emits the same refs as `solutions_from_markdown`. Then flip
     the default to **`db`**.
4. **Write skills.** Point `codify`/`audit`/`todo` at `solutions:db:add`.
5. **Prose.** Update 11 agents + 4 core docs.

---

## 10. Testing (Vitest, CI-safe)

Per SP1's precedent: pure libs with lazy-init DB/clients (no connection at import), standalone
integration script (CI never collects it), no `skipIf`.

**Unit (DB + OpenAI mocked):**

- `computeContentHash` determinism + serialization-independence (same projection, different key
  order / quoting → same hash; reordered tags → different hash).
- `canonicalProjection` shape: fixed key order, sorted `extra_fields`, null/empty handling.
- Variant normalization: `date→created`, `updated→last_updated`, unknown→`extra_fields`.
- `export` round-trip on fixtures: `row → markdown → re-parse → identical hash`, incl. a row with
  `extra_fields`.
- `parity` comparison logic on fixtures (match, hash-mismatch, missing-row, NULL-embedding).
- Hook domain-tag → SQL builder as a pure function (including the `ai-prompting` `ai-*` case).

**Integration (`solutions:db:check`, extended — standalone, env-gated):**

- ingest → export → re-ingest yields identical hashes.
- `parity` reports green against the live DB.
- full-corpus round-trip across all rows.
- a sample `solutions_from_db`-shaped query returns the expected refs for a known path.

---

## 11. Acceptance criteria

- [ ] `extra_fields jsonb` exists; `source:` is preserved through ingest→export; `date:`/`updated:`
      normalize to `created`/`last_updated` with a recorded warning.
- [ ] `content_hash` is the normalized-projection hash from the single shared function; re-ingest
      recomputed all 491 and left zero NULL embeddings.
- [ ] **Gate A** `solutions:db:parity` passes (491==491, per-file hash match, zero NULL embeddings).
- [ ] **Gate B** full-corpus round-trip passes across all 491 rows.
- [ ] `solutions:db:export` regenerates any single file and the whole mirror; the MCP server remains
      read-only (no write tools added).
- [ ] `solutions:db:add` inserts+embeds+exports one file; `codify`/`audit`/`todo` use it.
- [ ] **Gate C** hook on `PATTERN_INJECT_SOURCE=db` emits the same solution refs as the markdown
      path across every domain; `=markdown` reverts to today's behavior byte-for-byte; DB-down
      auto-falls-back to markdown.
- [ ] 11 agents + 4 core docs redirect to the DB/MCP with mirror-as-fallback wording.
- [ ] `docs/rules/*.md`, `.github/copilot-instructions.md` generation, and CI are untouched
      (verified).
- [ ] Unit tests green in CI without a DB or API key; integration check green locally behind the env
      gate.

---

## 12. Explicitly out of scope

- Byte-identical reformatting of the existing 491 files (normalized content-hash parity supersedes
  it; existing files are left as-is until re-codified).
- Write-path MCP tools (the server stays read-only; writes go through the `add` CLI).
- Committing the mirror to git (stays gitignored per the 2026-05-21 decision).
- Scheduled `pg_dump` backups (manual for now).
- Deleting `ingest.ts` (kept as the one-time historical importer / bulk re-ingest tool).
