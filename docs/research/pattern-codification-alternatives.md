---
title: "Pattern Codification — Alternative Architectures"
status: research
created: 2026-05-11
audience: future agents working on the pattern/codify/hook system
tags: [meta, patterns, codify, hook, context-injection]
---

# Pattern Codification — Alternative Architectures

This is a research note, not a plan. It exists so a future agent (or the human, William) can pick the path forward without re-doing this survey. It records: what the current system looks like by the numbers, the three families of alternatives in the Claude Code ecosystem, what's worth stealing from each, and a concrete recommendation grounded in what OCRecipes has _already_ built.

Read this end-to-end before touching `.claude/hooks/inject-patterns.sh`, the `codify` skill, or any of the codification targets.

## TL;DR

The current pattern system is **two overlapping codification stores**, only one of which is actively written to, and the one being written to is the one with the bloat problem:

- `docs/patterns/*.md` (915 KB, 16 files, monolithic per-domain) — written by `codify` skill, injected (head -80) by the pre-tool-use hook
- `docs/LEARNINGS.md` (217 KB, 4,007 lines, 78 sections, monolithic) — also written by `codify` skill, grep-searched by the hook
- `docs/solutions/` (one-file-per-fix, frontmatter-indexed, 4 documented fixes so far) — built but underused, structure already mirrors the compound-engineering plugin

The recommendation is **not to introduce a new system**. It is to (a) make `docs/solutions/` the canonical codification target, (b) move the pre-tool-use hook from "head -80 + grep" to a frontmatter-aware grep over `docs/solutions/`, (c) keep `docs/rules/*.md` as the binding short-list it already is, and (d) retire `docs/LEARNINGS.md` and the bulky `docs/patterns/*.md` files via a one-shot decomposition (or by demoting them to read-on-demand references that the hook never injects).

The "buy" alternatives — the official Every plugin `EveryInc/compound-engineering-plugin` and `alirezarezvani/claude-skills`' self-improving-agent — are not direct drop-ins, but each contributes ideas worth borrowing piecemeal.

## 1. Current system — what it actually is

### 1.1 The hook (`.claude/hooks/inject-patterns.sh`)

PreToolUse on Edit/Write/MultiEdit. Path-to-domain mapping (hard-coded `case` rows). For each matched domain it injects:

- **Full `docs/rules/<domain>.md`** (avg ~1.2 KB, ceiling enforced by being "short by design")
- **First 80 lines of `docs/patterns/<domain>.md`**
- **Grep -Fwi against `docs/LEARNINGS.md`** by file basename (skipped for generic names like `index`, `types`, `utils`)

Output cap is ~10 KB. When exceeded, the hook spills overflow to `/tmp/ocrecipes-injection-context.md` and tells the agent to read it. This spill triggers routinely on multi-domain matches (e.g. any `client/screens/*` file inherits `react-native + design-system + accessibility`).

### 1.2 The codify skill (`.claude/skills/codify/SKILL.md`)

Session-end ritual: run `kimi-review` on the branch diff, then for each CRITICAL/WARNING finding append to `docs/patterns/<domain>.md` (per the domain table) or `docs/LEARNINGS.md` if no domain matches. There is **no growth control**: no overlap check, no dedup, no archival, no per-section size cap, no demotion.

### 1.3 The bloat, by the numbers

| File / Dir                      | Size    | Lines  | Sections | Trend                                    |
| ------------------------------- | ------- | ------ | -------- | ---------------------------------------- |
| `docs/patterns/react-native.md` | 151 KB  | 3,869  | 48+      | grows every codify pass                  |
| `docs/patterns/database.md`     | 113 KB  | 2,746  | 30+      | grows every codify pass                  |
| `docs/patterns/api.md`          | 109 KB  | 2,724  | —        | grows every codify pass                  |
| `docs/patterns/testing.md`      | 95 KB   | 2,061  | —        | grows every codify pass                  |
| `docs/patterns/security.md`     | 83 KB   | 1,881  | —        | grows every codify pass                  |
| `docs/patterns/*` total         | 915 KB  | 22,435 | —        | unbounded                                |
| `docs/rules/*` total            | 15 KB   | 118    | —        | flat by design — keep                    |
| `docs/LEARNINGS.md`             | 217 KB  | 4,007  | 78       | unbounded; recently 6 entries in one day |
| `docs/solutions/`               | trivial | —      | 4 files  | underused — only 4 docs in 3 categories  |

### 1.4 Where signal-to-noise breaks

1. **`head -80` of a 3,869-line file is ~2% of the content.** For react-native that's the first one or two pattern subsections out of 48+. Whether those are the relevant ones for the file being edited is essentially random.
2. **LEARNINGS.md grep matches by basename word.** The basename `nutrition-coach` will pull in any line mentioning "nutrition" or "coach" anywhere in 4,000 lines. Filenames like `ScanScreen` get nothing useful; filenames like `useAuth` will collide with unrelated entries.
3. **Multi-domain stacking overflows the 10 KB cap.** A `client/screens/Scan*.tsx` edit injects react-native + design-system + accessibility patterns AND rules AND LEARNINGS — routinely spilling to `/tmp`.
4. **No relevance ranking.** Subsections live in arbitrary file order; the most recent codification ends up at the bottom, never injected.
5. **The codify step keeps writing.** Even with the existing problem, every `kimi-review` finding adds another subsection.

### 1.5 The half-built rescue: `docs/solutions/`

`docs/solutions/` already exists with the right structure: one file per problem, YAML frontmatter with `title / category / tags / module / symptoms / created / severity`, and category subdirectories (`logic-errors/`, `runtime-errors/`, `code-quality/`). The README already documents the schema. **Only the codify skill doesn't write here** — it routes everything to the monolithic patterns/LEARNINGS files instead.

This is the single most important fact in this document.

## 2. Alternatives surveyed

Three families. I evaluated them on five axes: storage model, retrieval mechanism, codification trigger, growth management, infrastructure cost.

### 2.1 Family A — Filesystem + Frontmatter (Every's `compound-engineering-plugin`)

**Repo:** `EveryInc/compound-engineering-plugin`
**Storage:** `docs/solutions/<category>/<slug>-<date>.md`. One file per learning. YAML frontmatter as the index. Two tracks discriminated by `problem_type`: bug-track (9 enum values: `build_error`, `test_failure`, `runtime_error`, `performance_issue`, `database_issue`, `security_issue`, `ui_bug`, `integration_issue`, `logic_error`) and knowledge-track (8: `architecture_pattern`, `design_pattern`, `tooling_decision`, `convention`, `workflow_issue`, `developer_experience`, `documentation_gap`, `best_practice`).

**Retrieval:** Grep-first against frontmatter only, not full-text. A dedicated `ce-learnings-researcher` subagent is invoked by `/ce-plan`, `/ce-code-review`, `/ce-optimize`, `/ce-ideate` (not by an Edit/Write hook). It runs parallel `rg` patterns over `title:`, `tags:`, `module:`, `problem_type:` fields, targets 5–20 candidates, reads only the first 30 lines (frontmatter) of each candidate, scores strong/moderate/weak, and full-reads only strong+moderate matches.

**Codification trigger:** `/ce-compound` command. Three parallel subagents (Context Analyzer, Solution Extractor, Related Docs Finder). Overlap-scoring before write: the Related Docs Finder compares the new doc to existing docs across 5 dimensions (problem, root cause, solution, files, prevention). High overlap (4–5) → **update existing doc**, don't create new. Moderate overlap → write but flag for refresh.

**Growth management:** Separate `/ce-compound-refresh` skill, triggered selectively by `/ce-compound` itself with a narrow scope hint. Five outcomes per doc: **Keep / Update / Consolidate / Replace / Delete** with explicit "git is the archive" rule. Does document-set analysis (overlap, supersession, canonical-doc-per-cluster) — evaluates docs against each _other_, not just against reality.

**Infrastructure cost:** Zero beyond markdown + `rg`. No DB, no vector store, no service.

**What's worth stealing:**

1. `problem_type` → directory mapping is deterministic and machine-validated.
2. Overlap-scoring at write time with the "update existing rather than create new" branch — directly prevents the proliferation OCRecipes is suffering.
3. The refresh skill with a `Delete` outcome.
4. Grep-first retrieval against frontmatter only.

### 2.2 Family B — Progressive disclosure + promotion ladder (`alirezarezvani/claude-skills` self-improving-agent)

**Repo:** `alirezarezvani/claude-skills` (`engineering-team/self-improving-agent/`)
**Storage:** Three tiers in increasing enforcement strength:

1. **Auto-memory** — `~/.claude/projects/<url-encoded-cwd>/memory/MEMORY.md` (first 200 lines auto-loaded per session). Format is literally `- {{concise fact}}` — no frontmatter, no tags, no recurrence counter.
2. **Project rule** — `./CLAUDE.md` (always loaded) OR `.claude/rules/<topic>.md` with YAML `paths:` glob frontmatter (loaded only when matching files are open).
3. **Portable skill** — freestanding `SKILL.md` with `name + description` frontmatter; installable into other projects.

**Retrieval:** Auto-memory is always loaded (first 200 lines). Rules with `paths:` glob frontmatter are loaded only when an edited file matches the glob. Skills use **progressive disclosure**: Claude Code preloads only the skill's `name + description` (~100 tokens each), and the full body loads only after Claude decides the description matches the user's intent.

**Codification trigger:** `/si:remember` (write to MEMORY.md), `/si:review` (LLM-judge recurrence and promotion candidacy), `/si:promote` (move from MEMORY to CLAUDE.md or `.claude/rules/`), `/si:extract` (export a recurring pattern as a portable skill).

**Growth management:** Capacity thresholds enforced via `/si:status` — Healthy <120 lines, Warning 120–180, Critical >180. Promotion **removes** the source MEMORY.md entry. Recurrence is judged by an `memory-analyst` LLM subagent that looks for semantic restatements, not a counter.

**Infrastructure cost:** Zero. All markdown + glob frontmatter + skill descriptions.

**What's worth stealing:**

1. **`paths:` glob frontmatter on rules** — solves the multi-domain stacking problem. A rule only loads when the edited file matches its glob, not because the hook decided the domain matches.
2. **Progressive disclosure via skill description** — instead of injecting the body of a pattern every time, just inject the _catalog_ (titles + one-line descriptions) and let Claude pull the body on demand. This is the single biggest context-cost reduction available.
3. **Promotion-removes-the-source** — auto-memory stays small because promoted entries leave it.

**What doesn't apply:** The 200-line MEMORY.md cap assumes the starting state is small. OCRecipes is already past where this skill's tooling expects to start. You'd need to do an aggressive consolidation pass before this model fits.

### 2.3 Family C — RAG / embeddings (`rag-cli`, `ClawMem`, `memsearch`, `claude-memory-compiler`)

**Repos:** `ItMeDiaTech/rag-cli`, `yoloshii/ClawMem`, `zilliztech/memsearch`, `coleam00/claude-memory-compiler`.

**Storage:** Markdown source + ChromaDB / Milvus / FAISS index. Embeddings via Sentence Transformers (e.g. `all-MiniLM-L6-v2`). Some add hybrid retrieval: dense vector + BM25 sparse + RRF reranking + cross-encoder rerank + query expansion + recency decay + content-type half-lives.

**Retrieval:** Vector + BM25 hybrid, top-K with reranking. Surfaced through hooks (some) or MCP (most). Some (`claude-memory-compiler`) auto-capture entire Claude Code sessions and have an LLM compile them into structured knowledge articles overnight.

**Codification trigger:** Mostly automatic — session transcripts get ingested by hooks or by a daily compile step. LLM extraction of decisions/lessons → daily logs → compiled knowledge articles.

**Growth management:** Inherent in the architecture — vector retrieval ranks by similarity rather than position. Some implement recency half-lives and confidence decay so old/superseded entries naturally drop in rank.

**Infrastructure cost:** Real. A local vector DB, an embedding model, an MCP server or hooks pipeline, a re-index step when content changes. Adds an operational layer that has to be kept healthy.

**When this is worth it:** Probably above ~50,000 codified entries, or when you genuinely need cross-codebase memory (multiple projects sharing a knowledge store), or when you want zero-curation continuous learning from transcripts.

**For OCRecipes today:** Overkill. The corpus is on the order of low-hundreds of patterns once decomposed. Markdown + frontmatter grep handles that with budget to spare. **Defer this family** until either (a) the decomposed corpus passes a few thousand entries, or (b) you start sharing patterns across multiple repos.

## 3. Comparison at a glance

| Axis            | Current (OCRecipes)            | A — Compound-Eng                               | B — Self-Improving Agent                            | C — RAG/Embedding             |
| --------------- | ------------------------------ | ---------------------------------------------- | --------------------------------------------------- | ----------------------------- |
| Storage         | Monolithic per-domain markdown | One file per fix + frontmatter                 | Tiered: MEMORY → rules → skill                      | Markdown + vector DB          |
| Retrieval       | head -80 + basename grep       | rg over frontmatter, score, full-read top hits | Auto-load + path-glob load + progressive disclosure | Hybrid vector + BM25 + rerank |
| Codify trigger  | `codify` skill at branch end   | `/ce-compound` w/ overlap scoring              | `/si:remember`, `/si:review`, `/si:promote`         | Auto from transcripts         |
| Growth mgmt     | None                           | `/ce-compound-refresh` 5 outcomes incl. Delete | Capacity thresholds + promote-removes-source        | Recency decay + rerank        |
| Surfaced via    | PreToolUse hook                | Subagent on demand                             | Skill descriptions + path globs                     | MCP / hooks                   |
| Infrastructure  | bash + jq                      | bash + rg                                      | none beyond Claude Code                             | vector DB + embedder          |
| Effort to adopt | —                              | Medium (already half-built)                    | Medium-high (consolidate first)                     | High                          |

## 4. Recommendation

Three phases. Each is independently shippable and reversible.

### Phase 1 — Stop the bleeding (smallest possible change)

**Goal:** Bring context-injection back under the 10 KB cap reliably, without changing any file the codify skill writes to yet.

1. **Cap pattern injection at 30 lines, not 80** in `inject-patterns.sh`. This trades less-relevant content for fewer overflows. (Acceptance: edit a `client/screens/*.tsx` file, no spill-to-temp in five out of five samples.)
2. **Remove the basename grep against LEARNINGS.md** from the hook. False-positive rate is too high; the cost is currently more confusion than signal. (Acceptance: hook output never contains a `[LEARNINGS — matches for ...]` block.)
3. **Add a one-line catalog injection** per matched domain instead: `grep -E '^### ' docs/patterns/<domain>.md` to inject just the subsection titles (typically <50 lines per file). This is poor-man's progressive disclosure — Claude sees the table of contents and can read specific subsections on demand.

That alone should bring routine injection under 5 KB even for triple-domain matches.

### Phase 2 — Decompose into `docs/solutions/`

**Goal:** Migrate `docs/patterns/*.md` and `docs/LEARNINGS.md` to the per-file frontmatter store that already exists at `docs/solutions/`.

1. **Add knowledge-track categories** to `docs/solutions/`: `architecture-patterns/`, `design-patterns/`, `conventions/`, `tooling-decisions/`, `performance-patterns/`, `security-patterns/`, etc. (Follow `compound-engineering-plugin`'s problem_type→directory mapping for the schema.)
2. **Decompose the largest pattern files first** — react-native.md, database.md, api.md, testing.md, security.md. Each `### ` subsection becomes one file with frontmatter pulled from the heading + tags inferred from the body. This is a one-shot decomposition; a script can do 80% of it.
3. **Migrate LEARNINGS.md** the same way. Each `## ` section becomes a file in the appropriate bug-track directory (`logic-errors/`, `runtime-errors/`, etc.). Use the date in the heading as `created:`.
4. **Update `codify` skill** to write to `docs/solutions/<category>/<slug>-<date>.md` instead of appending to `docs/patterns/*.md` or `docs/LEARNINGS.md`. Add an overlap check (rg the title/tags before writing — if a high-overlap doc exists, update its `last_updated:` instead of creating new). Borrow the 5-dimension overlap rubric from compound-engineering's Related Docs Finder.
5. **Retire the monolithic files** — leave them as historical artifacts (`docs/legacy-patterns/`) or delete (git is the archive).

### Phase 3 — Better retrieval

**Goal:** Hook injects the _relevant_ solutions, not the first 30 lines of a domain pile.

1. **Frontmatter-grep retrieval in the hook.** For each matched domain, `rg -l 'tags:.*<domain>' docs/solutions/` produces a candidate list. Limit to ~10 most recently `created:` or `last_updated:`. Inject just titles + one-line descriptions.
2. **Optional: tag-by-file-path.** When the edited file is `server/services/photo-analysis.ts`, prefer solutions tagged with `photo-analysis` over generic `ai-prompting` ones.
3. **Optional: progressive disclosure via a skill.** Wrap solution lookup in a `.claude/skills/lookup-solution` skill so any subagent can pull a specific solution by slug without needing the hook to inject it preemptively.

### Phase 4 (deferred) — Move to RAG

Don't. Until the decomposed corpus is multiple thousands of entries or you want cross-repo memory. Markdown + frontmatter grep is sufficient at OCRecipes' scale and stays maintainable. Re-evaluate when `docs/solutions/` exceeds ~2,000 files.

## 5. Open questions for the human

These are decisions that should not be made by an agent without William's input:

1. **Hard delete vs. archive for the monolithic pattern files?** Compound-engineering says "git is the archive, delete." But these files are referenced from `CLAUDE.md`, `docs/PATTERNS.md`, several skills, and the hook. Hard delete is more invasive than it looks.
2. **Should `docs/rules/*.md` stay as it is?** Recommendation says yes — they're already short and binding. But if Phase 2 produces `convention/` and `best-practice/` solutions, there will be overlap. Worth deciding upfront whether rules become a stable subset of solutions or remain separately authored.
3. **Auto-overlap-score on write — strict or advisory?** Strict (block create, force update of existing) is the compound-engineering default. Advisory (warn but let it through) is gentler. Advisory is safer to roll out; strict prevents drift.
4. **Do we still need `kimi-review` driving codification?** The current `codify` skill is tightly coupled to it. Compound-engineering's `/ce-compound` is review-agnostic — it works from the branch diff alone. Decoupling would let codification happen even when review is skipped.

## 6. Sources

The mechanics in this note come from reading the actual source of each system, not just READMEs. Specific files:

- `EveryInc/compound-engineering-plugin` — `plugins/compound-engineering/skills/ce-compound/SKILL.md`, `references/schema.yaml`, `references/yaml-schema.md`, `plugins/compound-engineering/skills/ce-compound-refresh/SKILL.md`, `plugins/compound-engineering/agents/ce-learnings-researcher.agent.md`
- `alirezarezvani/claude-skills` — `engineering-team/self-improving-agent/SKILL.md` and the `/si:remember`, `/si:review`, `/si:promote`, `/si:extract` sub-skill files
- `anthropics/skills` — README for the progressive-disclosure / frontmatter contract
- `mbiskach/compounding-engineering-plugin` — older fork of Every's plugin; nothing materially different
- `ItMeDiaTech/rag-cli`, `yoloshii/ClawMem`, `zilliztech/memsearch`, `coleam00/claude-memory-compiler` — for Family C
- `lethain.com/everyinc-compound-engineering/` — analysis post; confirms the structured-codification + selective-refresh + grep-frontmatter retrieval is the actual novelty

## 7. Existing OCRecipes artifacts worth knowing about

For the agent reading this and deciding what to touch:

- `.claude/hooks/inject-patterns.sh` — the bloat-amplifier
- `.claude/skills/codify/SKILL.md` — drives writes; rewriting its targets is most of Phase 2
- `docs/PATTERNS.md` — index/landing page for `docs/patterns/*.md`; will need rewriting in Phase 2
- `docs/solutions/README.md` — already documents the target schema; canonical reference
- `docs/rules/*.md` — keep as-is in all phases
- `docs/audits/` — separate system (the `/audit` skill); out of scope

## 8. Implementation Status (as of 2026-05-12)

### Phase 1 — Partially implemented

**Done** (commit `8fa374d3` on branch `todo/2026-05-11-pragma-lint-check`, pushed):

- Removed the LEARNINGS.md basename-grep block from `.claude/hooks/inject-patterns.sh` (single-word grep against 4,007 lines was near-100% false-positive on common basenames).
- Replaced `head -n 80` pattern excerpts with a line-numbered TOC: first 12 + last 13 subsection headings per matched domain, with an explicit omission marker pointing Claude to `Read` the file for the middle. Preserves foundational top-of-file entries (e.g. `### Deep Linking Configuration`) and recent codifications (the tail) without losing either.
- Dropped the now-unused `LEARNINGS_FILE` variable.

**Diverged from the Section 4 Phase 1 recommendation:**

- Step 1 (cap excerpt at 30 lines) was _not_ applied. Argued away in-session as a bandaid that treats the symptom (excerpt too long) rather than the root cause (head-N is the wrong retrieval mechanism). The cap-vs-TOC trade-off was resolved in favor of TOC injection — poor-man's progressive disclosure.
- Step 3 (catalog injection) was implemented as `head 12 + tail 13` of `grep -nE '^(### |#### )'` instead of the proposed "subsection titles, typically <50 lines per file." This addresses a freshness-inversion problem the original doc did not call out: codify appends to file bottoms, so head-only retrieval systematically hides the newest entries.

**Deferred** (tracked in `todos/2026-05-12-pattern-injection-spill-on-multi-domain-edits.md`):

Spill to `/tmp/ocrecipes-injection-context.md` still occurs on 4-domain edits because the rules-files baseline alone (~5.4 KB on a typical multi-domain match) consistently exceeds the 9 KB threshold before any TOC is added. Mitigation options (a)-(d) — typescript-stacking suppression, TOC tightening, threshold raise (unsafe), do-nothing — surveyed in the session. **Chose (d)** on the grounds that Phase 2 eliminates the byte pressure structurally; engineering local fixes to a soon-to-be-replaced retrieval mechanism is wasted effort.

### Phase 2 — Pending

Tracked in `todos/2026-05-12-phase-2-pattern-decomposition.md`. Approach: parallel-subagent-per-file with overlap-check + prune-or-extract rubric per subsection. Start with smallest file (`docs/patterns/design-system.md`, ~266 lines) as proof-of-concept before parallelizing across the top-5 fattest. Codify-skill rewrite + LEARNINGS.md migration follow in subsequent steps.

### Phase 3 — Not yet started

Better retrieval (frontmatter grep, tag-by-file-path, lookup-solution skill). Re-evaluate after Phase 2 lands content in `docs/solutions/`.

### Phase 4 — Deferred indefinitely

Per the doc's recommendation; revisit only if corpus exceeds ~2,000 entries or cross-repo memory becomes desired.

### Session learnings worth carrying forward

Beyond the original doc's analysis, the implementation session surfaced:

1. **Recency ≠ relevance.** Pure `tail -n N` over-corrects the freshness-inversion problem by hiding foundational early sections. `head N + tail M` is the cheap fix; structural fix is Phase 2.
2. **Parallel review across independent contexts is high-leverage.** A `kimi-review` + two subagent reviewers running concurrently surfaced a convergent finding (foundational-loss bias from `tail -n 25`) before commit. The convergence across three independent reviewers was strong signal — single-reviewer feedback would have been easier to dismiss.
3. **The codify trigger itself is part of the problem** — it only fires on `kimi-review` CRITICAL/WARNING, biasing the corpus toward defects rather than positive patterns. Phase 2 should consider decoupling the codify trigger from the review-result gate.
