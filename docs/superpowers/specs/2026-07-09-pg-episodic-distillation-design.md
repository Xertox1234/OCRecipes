# PG Lab: Episodic Transcript Distillation Experiment vs /codify — Design

**Date:** 2026-07-09
**Status:** Draft — pending user review + `/spec-review`
**Todo:** `todos/P3-2026-07-05-pg-episodic-distillation.md`
**Basis:** `docs/research/2026-07-04-postgres-memory-for-claude-code.md` (R3, open question #4) + `docs/research/2026-07-05-pg-lab-roadmap.md` (Phase D). Prior art: daringanitch/claude-memory's `distill_sessions.py` + `behavioral_pass.py` (pipeline shape only — not ported wholesale).

## Question the experiment answers

Does automated LLM distillation of session transcripts surface durable knowledge that the manual `/codify` + memory-file workflow misses — or mostly noise those curated flows already filter? This is a **bounded experiment with a predefined verdict**, explicitly allowed to conclude "not worth it."

## Decisions (settled in brainstorming, 2026-07-09)

| Fork                   | Decision                                                                                                | Rationale                                                                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Distillation model     | **Reuse kimi-\* infra (OpenRouter, DeepSeek V4 Flash)**                                                 | Already installed/configured; zero new setup vs an Ollama install (not present on this machine). The todo pre-clears harness-side cheap-worker use. Consequence: the health-data gate below becomes load-bearing, not optional.                                                               |
| Health-data protection | **Send-time gate, fail-closed**                                                                         | Scoped entirely to this new pipeline; doesn't modify the already-merged `transcripts.sh` importer or force a `--rebuild`. The local DB at rest is no more exposed than the JSONL files already on disk — the trust boundary crossed is the external API call, so the gate sits exactly there. |
| Candidate schema       | **Map directly to existing taxonomies** (`target_store: memory\|solution` + that store's real subtypes) | Apples-to-apples comparison against what `/codify` and manual memory-writing actually produce; accepted candidates route unambiguously. daringanitch's behavior/preference/pattern triad would add a translation step at accept time.                                                         |
| Cadence                | **Manual/batch `--distill` over a date window**                                                         | No unattended cron before the pipeline has proven any value. Same comparison data, far less operational commitment. A cron is a possible _outcome_ of a keep verdict, never a precondition.                                                                                                   |
| Window + threshold     | **2 weeks; keep iff automation-only findings ≥ 2/week (≥ 4 total)**                                     | Matches the todo's own example duration; threshold predefined here per its AC.                                                                                                                                                                                                                |
| Comparison method      | **Near-dup-assisted human review** (reuse `codify-neardup.sh`'s pg_trgm mechanism)                      | Proven, already-shipped matching infra; human makes every final call. An LLM-judge variant was rejected: automation grading automation undercuts the experiment's question, and doubles external exposure.                                                                                    |
| Cost ceiling           | **$5 hard cap for the whole window**                                                                    | Required by the todo's Risks section for any API-model variant. Generous at DeepSeek pricing — hitting it is itself a mis-sizing signal.                                                                                                                                                      |

## Architecture

### New script: `scripts/pg-lab/distill.sh`

Follows the `transcripts.sh` conventions (fail-silent on unreachable `ocrecipes_lab`, `LAB_DATABASE_URL` env var, same shell+embedded-Python shape where useful).

```
scripts/pg-lab/distill.sh --window <start-date> <end-date>   # distill sessions in window
scripts/pg-lab/distill.sh --review                           # interactive queue review (see Comparison)
scripts/pg-lab/distill.sh --report                           # four-bucket tallies + spend + gate stats
```

Pipeline per run:

1. **Select** `harness.transcript_messages` rows in the window whose sessions have no row in the per-session ledger (`harness.distilled_sessions` — same incremental idea as `transcript_sessions`), so overlapping windows never re-send (or re-pay for) a session. Distillation unit = one session's user/assistant dialogue, chronological (daringanitch's granularity).
2. **Gate** each session (see Health-data send gate). Dropped sessions are logged and counted; they are never sent.
3. **Cost check** before each batch: sum `tokens_in`/`tokens_out` across `harness.distill_runs` and convert to dollars using DeepSeek V4 Flash pricing pinned as constants in `distill.sh` (captured at implementation time); refuse to start if cumulative spend ≥ $5. Cost accounting lives in the run ledger, **not** the cheap-worker `usage.jsonl` — that ledger was inspected (2026-07-09) and carries no cost field and no purpose tag, so distillation calls can't be distinguished from other `ask-kimi` uses there. `usage.jsonl` remains a coarse cross-check only.
4. **Distill** the surviving session text via `ask-kimi` with the distillation prompt (below). Interface: `ask-kimi --paths <file> --question <prompt>` (verified 2026-07-09); the gated buffer goes to the send artifact per the hygiene rules below. Token counts from the call's report are recorded into the run's `distill_runs` row. If the interface can't fit this shape, call OpenRouter directly with the same model — do not build a second worker script.
5. **Parse** the JSON candidate array from the response (tolerant: a malformed response drops that session with a logged parse-failure counter, never crashes the run). The parser also validates `subtype` against the real taxonomy values before insert — the DB `CHECK` covers only `target_store`, so an invented subtype is rejected here (counted per-candidate, doesn't fail the session).
6. **Near-dup flag** each candidate (see Comparison), then insert into `harness.memory_candidates` as `pending`.

### Schema: `scripts/pg-lab/schema/memory-candidates.sql` (owned by this item — one schema file per PG Lab item)

```sql
CREATE TABLE IF NOT EXISTS harness.memory_candidates (
    id             SERIAL PRIMARY KEY,
    created_at     TIMESTAMPTZ DEFAULT now(),
    session_id     TEXT NOT NULL,
    source_msgs    TEXT[],          -- transcript_messages.msg_uuid values, for traceability
    target_store   TEXT NOT NULL CHECK (target_store IN ('memory','solution')),
    subtype        TEXT NOT NULL,   -- memory: user|feedback|project|reference
                                    -- solution: '<track>:<category>', e.g. 'bug:logic-errors'
    title          TEXT NOT NULL,
    content        TEXT NOT NULL,
    near_dup_path  TEXT,            -- flagged existing file, if any
    near_dup_score NUMERIC,
    status         TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','accepted','rejected')),
    reviewer_note  TEXT,
    reviewed_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS harness.distill_runs (      -- append-only run stats ledger
    id             SERIAL PRIMARY KEY,
    ran_at         TIMESTAMPTZ DEFAULT now(),
    window_start   DATE NOT NULL,
    window_end     DATE NOT NULL,
    sessions_seen  INT NOT NULL,
    sessions_sent  INT NOT NULL,
    sessions_gated INT NOT NULL,   -- dropped by the health gate
    parse_failures INT NOT NULL,
    candidates     INT NOT NULL,
    tokens_in      BIGINT NOT NULL DEFAULT 0,  -- cost accounting lives here (pipeline step 3)
    tokens_out     BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS harness.distilled_sessions ( -- per-session bookmark: never re-send
    session_id     TEXT PRIMARY KEY,
    run_id         INT NOT NULL REFERENCES harness.distill_runs(id),
    outcome        TEXT NOT NULL CHECK (outcome IN ('sent','gated','parse_failed'))
);
```

**PG Lab rails compliance:** `memory_candidates` is an experiment-scoped working table (candidates + review status); `distill_runs` and `distilled_sessions` are append-only ledgers. None is a source of truth — the canonical stores remain the markdown memory directory and `docs/solutions/`. All three tables are dropped (or truncated and abandoned) when the experiment concludes; nothing else may ever read them. No hooks touch this pipeline — it is manual-invocation only, so the fail-silent-in-hooks rail applies only in the weak form of "fail-silent when `ocrecipes_lab` is unreachable."

**Accept path is manual.** Marking a candidate `accepted` does not write any markdown. The actual `docs/solutions/` or memory-file write happens by hand (user + Claude) via the existing `/codify` and memory conventions. The pipeline stops at "reviewed, typed candidate" — it never becomes a second writer into a canonical store.

## Health-data send gate (load-bearing, fail-closed)

Runs per session-batch after assembling the outbound text, before any external call. CLAUDE.md's cheap-worker health-data exclusion is absolute; this gate is what makes the external-model choice compatible with it.

**Layer 1 — pattern screen.** Regex classes for health-data shapes, enumerated from **`shared/schema.ts` as the single source of truth** — and in **both casings**: the camelCase TS property names (`servingSize`, `caloriesPerServing`, …) AND the snake_case SQL column names (`serving_size`, `calories_per_serving`, …). An implementer reading "API schemas" would enumerate camelCase JSON keys only; the Drizzle definitions carry both. Each field-name class must match in **three container shapes**, because the threat channel this gate exists for — pasted query results — is usually _not_ JSON:

1. JSON key syntax (`"calories":`)
2. psql / markdown table headers-and-rows (`serving_size | calories | protein`)
3. `key=value` / CSV-with-header lines

Additional classes: email addresses, DOB-shaped dates, weight/height-with-units patterns, and the app's user-ID formats — with false-positive containment, since dev transcripts are saturated with benign look-alikes (UUIDs in EAS config, ISO dates in filenames, bot emails in commit trailers):

- The email allowlist is a small **pinned set**, not a single address: the developer's addresses + known bot/tooling addresses (e.g. `noreply@anthropic.com`) + RFC 2606 example domains (`example.com` fixtures, demo-account addresses).
- The UUID and date classes fire **only when structurally adjacent to a matched field-name block** (within the same detected JSON object / table / key-value run), never free-floating.

A hit **drops the entire session** (no redact-and-send) and logs `skipped_health_gate` with the matched pattern _class only_ — never the matched content. Drop-not-redact is deliberate and recorded here so a future "just redact it" optimization is pre-rejected: a partial-redaction bug is a _silent_ violation of an absolute exclusion, whereas dropping converts every gate uncertainty into corpus loss, which the drop-rate kill signal already prices in.

**Any loosening of the gate** (regex, allowlist, threshold) requires re-running the synthetic fixtures in Testing/validation below — the predictable failure mode is drop-rate pressure during implementation leading to ad-hoc weakening, and the fixture suite is the rail against it.

**Layer 2 — volume guard.** Operationalized, not just a ratio: the numerator is the total characters inside **contiguous pasted-data runs ≥ 500 chars** (a run = consecutive JSON-parseable block, base64 run, or table-formatted lines), the denominator is the session's total user+assistant characters. Session dropped when the ratio exceeds **30%** — **or when any single pasted-data run ≥ 2,000 chars appears, regardless of ratio** (a pure ratio dilutes: one pasted user record in a long session sails under 30%). Rationale: the importer already excludes tool-result payloads, but debugging sessions paste query results into user messages — exactly the channel real user records would ride in. Note the assistant side is a live channel too: assistant messages that _echo_ query results are ingested by the importer, so the guard scans both roles. Thresholds are spec defaults; tuning them also requires the fixture re-run.

**Fail-closed:** any gate error (regex failure, undecodable content) skips the session. Losing a session is a rounding error; violating the exclusion is not.

**Gate-to-send buffer identity (no TOCTOU):** the gate runs on the **exact final outbound buffer**. Sessions are selected once at run start; the gated buffer is written once to the send artifact, and its SHA-256 is verified immediately before the external call. The send path never re-assembles or re-queries `harness.transcript_messages` (a concurrent `--import` can append rows mid-run) — text that was never gated must be unable to reach the API.

**Send-artifact hygiene:** the scratch file is created `0600`, inside the session scratchpad directory (never shared `/tmp`), and removed via `trap` cleanup so a crash doesn't strand post-gate dialogue on disk. Implementation must verify that `ask-kimi` and `usage.jsonl` persist call _metadata only_ — never prompt bodies — and the Risks section acknowledges the OpenRouter/DeepSeek retention posture.

**Defense-in-depth:** re-apply `transcripts.sh`'s `REDACT_PATTERNS` (secret keys, JWTs, DB URLs) to outbound text at send time, even though import already applied them.

**Gate observability:** `sessions_gated / sessions_seen` is reported by `--report`. A gate drop rate that leaves too little corpus to evaluate (e.g. most sessions dropped) is itself a kill signal — a pipeline that can't safely see the data can't be useful.

## Distillation prompt + typed output

Per-session prompt (full text authored at implementation time; shape fixed here):

- Role: extract **durable, reusable knowledge a future coding session would benefit from** — decisions with rationale, discovered constraints/gotchas, user preferences/corrections, recurring workflows.
- Output: strict JSON array; each element `{target_store, subtype, title, content, evidence_msg_uuids}`. `subtype` must be one of the real taxonomy values (memory: `user/feedback/project/reference`; solution: `<track>:<category>` from the 7 `docs/solutions/` categories).
- Noise control: explicit instruction that **an empty array is the expected common case** — most sessions contain no durable knowledge; do not manufacture candidates. No per-session quota.
- Exclusions restated in-prompt: no secrets, no personal/health data, no session-specific trivia (file paths under active edit, transient test failures).

## Preconditions (verified against the live lab DB, 2026-07-09)

`ocrecipes_lab` currently contains only `harness.injection_log` — neither the transcript corpus nor the solution-titles projection is built in this checkout. Before the first distillation run:

1. `scripts/pg-lab/transcripts.sh --import` (or `--rebuild`) — populates `harness.transcript_messages` from `~/.claude/projects/*/*.jsonl`.
2. `scripts/pg-lab/codify-neardup.sh --rebuild` — refreshes `harness.solution_titles` for the near-dup flagging step.

`--report` should surface both preconditions when their tables are empty rather than reporting a silently empty experiment.

## Testing / validation

Fixture-driven self-test following the PG Lab sibling precedent (`.claude/hooks/test-pg-lab-transcripts.sh` — 30 assertions over synthetic JSONL). The external call is stubbed in tests — no network. Minimum assertions:

- **Gate fixtures, one per pattern class** — synthetic sessions containing: a JSON-form nutrition record (camelCase keys), a psql-table paste (snake_case headers — the channel Layer 1's three container shapes exist for), a prose weight/DOB record, a non-allowlisted email, a ≥ 2,000-char pasted-data run in an otherwise long session (absolute trigger, sub-30% ratio) → each asserts `distilled_sessions.outcome = 'gated'` and the correct logged pattern class.
- **Clean session** → asserts `outcome = 'sent'` and candidates inserted as `pending`.
- **Gate exception** (undecodable/pathological content) → asserts `gated`, never `sent` (fail-closed proof).
- **Buffer identity** — the SHA-256 of the gated buffer equals the hash of the artifact the (stubbed) send consumed.
- **Parse tolerance** — malformed LLM JSON → `parse_failures` incremented, run completes; invented `subtype` → candidate rejected, session still `sent`.
- **Idempotency** — a second `--window` over the same range selects zero sessions (the `distilled_sessions` bookmark).
- **Cost cap** — with `distill_runs` seeded at the cap, a new run refuses to start.

Any change to gate regexes, the email allowlist, or the volume-guard thresholds re-runs this suite (the anti-loosening rail named in the gate section).

## Comparison protocol (run at window end)

1. `distill.sh --window <start> <end>` over the 2-week corpus → candidates in `harness.memory_candidates`, near-dup flags pre-computed:
   - `target_store='solution'` candidates → pg_trgm `similarity()` against the existing `harness.solution_titles` projection (shipped for `/codify` Step 6b; refresh via `codify-neardup.sh --rebuild` first).
   - `target_store='memory'` candidates → ad-hoc in-process pg_trgm comparison against memory-file titles/descriptions read live from `~/.claude/projects/-Users-williamtower-projects-OCRecipes/memory/` — deliberately **no persisted projection** for a bounded experiment (PG Lab anti-speculative-infra rail).
2. **Baseline build:** solutions codified in the window via `git log --since/--until -- docs/solutions/`; memory files by mtime (best-effort — the memory dir is outside the repo and unversioned, so this half of the baseline is softer, and the report must say so).
3. **Human review** (`--review`): each candidate assigned one bucket — **caught-by-both** (dup flag confirmed against a window-period file), **automation-only** (no dup + reviewer judges it genuinely worth keeping), **noise** (everything else). Then the reverse sweep: window-period codified items with no matching candidate = **codify-only** (what automation misses).
4. **Verdict:** keep iff automation-only ≥ 4 over the window (≥ 2/week). Otherwise archive the todo with the measured four-bucket verdict. Either way, the verdict + counts are appended to this spec and recorded in the todo's Updates section (its final AC).

## Success / kill criteria (predefined, per AC)

- **Keep** — automation-only ≥ 4 confirmed-useful candidates over 2 weeks → file a follow-up todo for productionizing (possible cron, review-queue UX). Not part of this experiment.
- **Kill** — below threshold → archive todo with verdict; drop the two tables; no residue.
- **Early kill** — any of: cost cap hit before the window ends; gate drop-rate so high the evaluable corpus is unrepresentative; parse-failure rate that makes candidate counts meaningless. Record which tripwire fired.

## Risks

- **Distillation noise drowning the queue** — mitigated by the empty-array-is-normal prompt stance and the predefined kill criteria; the experiment is designed to fail fast and cheap.
- **Health-data gate false confidence** — the gate is pattern-based, not semantic. Accepted residual risk is bounded by: fail-closed behavior, the volume guard catching pasted-data shape generically, dev transcripts being the corpus (not production data), and the DB/pipeline being local-only. If implementation review judges the residual risk unacceptable, the fallback is reverting the model decision to local Ollama — but that fallback is **not free**: Ollama is not installed, it means a new local call path beside the two specified ones, and the distillation prompt needs re-validation on a weaker model. It is an escape hatch with a real price, not an instant toggle.
- **Third-party retention** — outbound session text transits OpenRouter to DeepSeek; their retention posture is outside our control. Accepted for gated dev-dialogue content specifically because the gate (not this risk note) is what keeps excluded data out of that channel; the send-artifact hygiene rules keep local residue equally bounded.
- **Ledger interface drift** — `ask-kimi` and `usage.jsonl` are unversioned local scripts; the cost check and call mechanics get verified against their current shape at implementation time, with the direct-OpenRouter fallback documented above.
- **Baseline asymmetry** — the memory-file half of the codify-only sweep is mtime-based best-effort; the verdict leans on the solutions half, which is git-exact.

## Out of scope

- Any cron/LaunchAgent (batch-manual only for the experiment).
- Auto-writing accepted candidates into canonical stores.
- Recall/injection of candidates into sessions (the exemplar's SessionStart idea) — that's a productionization question gated on a keep verdict.
- Embeddings/pgvector anywhere (per R1 and the PG Lab rails).
- Modifying `transcripts.sh` or its schema.

## Deliverable boundary (per the todo)

This spec + its `/spec-review` pass is the todo's deliverable. Implementation happens in a dedicated later session via `superpowers:writing-plans` → plan execution, not from this document directly.

## VERDICT (recorded 2026-07-10) — KEEP

Experiment executed 2026-07-09/10 over window **2026-06-25 → 2026-07-08** (implementation PR #564; live-run fixes PR #566: csv field limit, volume-guard assembly-prefix false positive, --review re-prompt on stray input).

**Run stats:** 88 sessions — 77 sent, 11 gated (12.5% drop: 3× nutrition_fields, 2× email, 5× volume_guard_absolute, 1× volume_guard_ratio), 0 parse failures. Spend **$0.71 of $5 cap** (1.58M in / 201K out tokens at over-estimate pricing). No kill tripwire fired.

**Four buckets (254 candidates, human-reviewed in full):**

- **automation-only: 251** — threshold (≥ 4) met ~60× over → **KEEP**
- **caught-by-both: 0** — near-dup assist flagged 16 candidates but every flag pointed at _pre-window_ files; reviewer issued no duplicate-rejects
- **noise: 3** (1.2% as-reviewed)
- **codify-only: 74** — every window-period solution; automation matched none of them

**Honest read:** the reviewer's accept bar was inclusive (98.8% accepted across both review passes), so "accepted" here means _plausibly useful_, not _vetted for canonical writing_ — the accept path's hand-codification step is the real filter, and 251 accepts now form that backlog. The strongest result is disjointness: zero overlap between automation's 251 and /codify's 74 — the two pipelines surface different knowledge. Cost and safety both held (12.5% gate drop, $0.71 spend). Productionization should attack candidate volume (stricter prompt, per-session cap, pre-ranking) before any cron — follow-up todo filed per the Keep criterion. Tables retained until accepted candidates are triaged into canonical stores, then dropped.

### Triage close-out (2026-07-10)

The 251 accepted candidates were triaged against canon (docs/solutions × 615 files,
memory dir, CLAUDE.md/docs/rules) by 4 parallel classifier agents with per-item human
approval: 118 already covered · 73 ephemeral · 34 other-project (digest exported to the
plant_id_community checkout) · 1 rerouted to a todo · **23 kept** (9 new memory files,
8 memory appends, 5 new solution docs + 1 append — PR #568). The three experiment tables
(`harness.memory_candidates`, `harness.distill_runs`, `harness.distilled_sessions`) were
then DROPPED per the experiment-scoped rail. Experiment fully closed.

Durable design input for productionization: **~9% survival vs canon** — the
distill+review accept stream is an order of magnitude too permissive, and the
title-level near-dup assist caught almost none of the 118 conceptual duplicates.
Volume control needs a canon-aware dedup pass (semantic, not title-lexical), not just
a stricter generation prompt.
