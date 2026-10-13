# LSP Utilization — Design Spec

**Date:** 2026-05-20
**Status:** Approved (design); ready for implementation plan
**Owner:** William Tower

## Problem

The `typescript-lsp` plugin is fully wired and functional, but the project uses
only a fraction of it. Verified current state:

- Plugin enabled globally; backing binary `typescript-language-server` 5.2.0 at
  `/opt/homebrew/bin/typescript-language-server`.
- `tsconfig.json` has `incremental: true`.
- Live check confirmed it works: `hover` on `withOpacity`
  (`client/constants/theme.ts:210`) returned full JSDoc; `findReferences`
  returned **542 references across 128 files** — and reproduced the cold-start
  gotcha (first call returned 1 result, the identical second call returned 542).

Gaps that leave value on the table:

1. The three highest-value ops for this codebase are effectively unused:
   `incomingCalls`/`outgoingCalls` (call hierarchy), `goToImplementation`,
   `workspaceSymbol`.
2. **Subagents never use the LSP.** Zero mentions of LSP / findReferences in any
   of the 17 agent definitions in `.claude/agents/` or in `docs/rules/`. The
   LSP-first guidance lives only in `CLAUDE.md` (main-session context), so every
   delegated symbol task falls back to grep.
3. The cold-start gotcha is undocumented outside memory and relies on the
   operator remembering to warm + re-run.

## Goals

- Make LSP the default for symbol-level work in the main session **and** in
  symbol-working subagents.
- Surface the three underused ops with OCRecipes-specific use cases.
- Eliminate the cold-start gotcha as a recurring papercut.
- Wire LSP verification into the Claude-driven review/audit pipeline.
- Add an advisory (non-blocking) nudge when grep is used for a symbol lookup.

## Non-Goals / Explicit Exclusions

- **`kimi-review` / `kimi-multi-review` are out of scope.** They are a separate
  Python/shell tool calling an external model with **no LSP access**; they stay
  diff/text-based. "LSP in the review pipeline" means **Claude-driven review
  only**: the `code-reviewer` agent and the `/audit` skill.
- `requesting-code-review` / `receiving-code-review` are superpowers **plugin**
  skills (overwritten on update) — not edited directly; covered indirectly via
  the `code-reviewer` agent.
- `Explore`, `Plan`, `feature-dev:*`, `general-purpose` are harness/plugin
  agents, not in `.claude/agents/` — their definitions are **not** edited.
  Covered via a main-session dispatch-prompt rule (Phase 3).
- The LSP tool is **navigation-only**: it has no `diagnostics` operation. Type
  errors remain the job of `tsc --noEmit` / CI. This is stated, not worked
  around.
- TypeScript-only: grep remains correct for `.sql`, config, native code, and
  plain-text/string searches.

## Architecture Constraints (discovered)

- **A SessionStart shell hook cannot call the `LSP` tool** (model-invoked, not a
  shell command). Warm-up "automation" therefore = the hook injects an
  `additionalContext` directive, and the model's first `hover` performs the
  actual warming.
- **No include mechanism for agent prompts** — each `.claude/agents/*.md` is
  standalone static text. The canonical LSP block is authored once and pasted
  verbatim into each target agent (deliberate duplication; do not DRY).
- `inject-patterns.sh` already emits an always-on DISCIPLINE preamble on every
  Edit/Write/MultiEdit (`.claude/hooks/inject-patterns.sh:117`). That preamble —
  not a new per-domain doc — is the low-noise vehicle for an edit-time LSP
  reminder.
- `CLAUDE.md` is gitignored/untracked in this repo, so its edits are local-only
  (intentional; it is still the right place for main-session guidance).

## Delivery Approach

Paste a canonical LSP block verbatim into each symbol-working **repo** agent
(Approach A), and layer a dispatch-prompt rule on top for the agents that cannot
be edited (Approach C). Rejected: a shared snippet that agents are told to read
(weaker than inline directives); CLAUDE.md-only (misses agent-spawned agents).

## Phases

One spec, five phases. Phases 1–4 are low-risk docs/prompts. Phase 5 (nudge
hook) is the only piece with false-positive tuning risk and is sequenced last so
its necessity can be judged after the foundation lands.

### Phase 1 — Knowledge base (foundation)

- **New `docs/rules/lsp.md`** (canonical binding doc), containing:
  - LSP-first rule: prefer LSP over grep for find-references, go-to-definition,
    rename-safety, implementation lookup, and symbol navigation.
  - When-to-use table for all 9 ops.
  - Spotlight on the 3 underused ops with OCRecipes use cases:
    - `incomingCalls`/`outgoingCalls` → impact analysis across the
      `routes → services → storage → db` layering.
    - `goToImplementation` → interface → concrete impls for the 20-module
      storage facade (`server/storage/index.ts`).
    - `workspaceSymbol` → jump-to-symbol across the ~981-file tree.
  - Cold-start discipline: warm with a throwaway `hover`; re-run a query once if
    a result looks impossibly small. Positions are 1-based.
  - The ceiling: navigation-only (no diagnostics → `tsc`/CI own type errors);
    TS-only (grep still correct for `.sql`/config/native/strings).
  - When grep is still the right tool.
- **Expand the LSP bullet in `CLAUDE.md`** to point at `docs/rules/lsp.md`, name
  the underused ops, and state the dispatch-prompt rule for non-editable agents.
- **Add one line to the DISCIPLINE preamble** in `inject-patterns.sh`: an
  edit-time rename-safety nudge ("before editing a shared symbol, check its blast
  radius via LSP findReferences/call-hierarchy"). Single line, not a per-domain
  dump.

### Phase 2 — Warm-up automation

- **New `.claude/hooks/lsp-warmup.sh`**, added as a third `SessionStart` entry in
  `.claude/settings.json`.
- Emits `additionalContext` JSON instructing: "Your first LSP action this session
  should be a throwaway `hover` on an architectural target (a facade method in
  `server/storage/index.ts`) to build the tsserver project graph. If a
  `findReferences` result looks impossibly small, re-run once."
- Pure side-effect-free context injection; safe to no-op if the project root is
  not a TS project.

### Phase 3 — Symbol-working agent prompts

- **Canonical LSP block** authored once and version-controlled. Its single
  authoritative copy lives verbatim in `docs/rules/lsp.md` (a clearly delimited
  "Canonical agent block" section, e.g. fenced between
  `<!-- LSP-AGENT-BLOCK:START -->` / `<!-- LSP-AGENT-BLOCK:END -->` markers). The
  agent-file copies are derived from it and must match byte-for-byte; the
  drift-check below enforces this. Block content: LSP-first directive + cold-start
  warm-up/re-run + the 3 underused ops as one-liners with use cases.
- Pasted verbatim into these 9 repo agents:
  `code-reviewer`, `architecture-specialist`, `database-specialist`,
  `api-specialist`, `performance-specialist`, `typescript-specialist`,
  `security-auditor`, `todo-executor`, `todo-researcher`.
  - Deferred candidates (add only if requested): `camera-specialist`,
    `ai-llm-specialist`, `quality-specialist`, `testing-specialist`.
  - Out of scope (not symbol-working): `accessibility-specialist`,
    `rn-ui-ux-specialist`, `docs-researcher`, `nutrition-domain-expert`.
- `code-reviewer` and `security-auditor` additionally get one review-specific
  line: verify impact / rename-safety with `findReferences` / call-hierarchy
  before flagging.
- **Dispatch-prompt rule** (documented in `docs/rules/lsp.md` + `CLAUDE.md`): when
  the main session delegates symbol work to `Explore`/`Plan`/`feature-dev:*`,
  include the LSP-first + warm-up directive in the dispatch prompt, since their
  definitions cannot be edited.

### Phase 4 — Review/audit pipeline (Claude-driven only)

- **`.claude/skills/audit/SKILL.md`**: add a verification step — symbol-level
  findings (unused export, dead code, signature-change or rename impact) must be
  confirmed with LSP `findReferences` / call-hierarchy before being reported or
  fixed.
- Restate the `kimi-review` exclusion inline so it is unambiguous.

### Phase 5 — Nudge hook (last; FP-risk)

- **New `.claude/hooks/lsp-nudge.sh`**, `PostToolUse` matcher on `Bash`.
- **Advisory only**: prints a one-line reminder to stderr and **exits 0 — never
  blocks**. (This is a hard requirement given the project's documented allergy to
  false-positive-blocking gates.)
- Heuristic — fire only on high-confidence symbol searches:
  - command is `grep` or `rg`,
  - pattern is a bare identifier (`camelCase` / `PascalCase` / `snake_case`),
    contains no regex metacharacters and no `-F`/fixed-string text intent,
  - target is `.ts`/`.tsx` or repo-wide (no path).
- **Throttle once-per-session-per-pattern** via a temp state file keyed by
  session id.
- Exclusions: skip when invoked from npm-script/CI infra contexts; honor an
  `LSP_NUDGE_OFF=1` opt-out.
- Message: "Looks like a symbol search — LSP `findReferences`/`workspaceSymbol`
  gives accurate, alias-aware results."
- Built only after Phases 1–4 land, so its necessity can be measured.

### Cross-cutting

- Update the `project_lsp_tooling.md` memory to describe the new system
  (warm-up hook, nudge hook, `docs/rules/lsp.md`, agent coverage).

## Risks & Mitigations

- **Nudge false positives** → advisory-only + conservative identifier heuristic +
  per-session throttle + opt-out env var; deferred to the last phase.
- **Agent block drift** (9 copies) → the authoritative copy is version-controlled
  in `docs/rules/lsp.md` between the `LSP-AGENT-BLOCK` markers; agent copies are
  derived from it and a drift-check (see Verification) fails CI/pre-commit if any
  copy diverges. Block changes are rare and edited in `docs/rules/lsp.md` first.
- **Warm-up directive ignored** → it is also embedded in agent prompts and
  `docs/rules/lsp.md`, so the discipline survives even if the SessionStart
  directive is skipped.

## Verification

- Phase 1–4: re-read each edited file; confirm `docs/rules/lsp.md` renders and is
  referenced from `CLAUDE.md`; spot-check that the agent block is present in all 9
  files (`grep -l` for a sentinel phrase).
- Phase 2: start a fresh session and confirm the warm-up `additionalContext`
  appears; confirm a first-call `findReferences` is reliable after the directed
  `hover`.
- Phase 5: unit-style checks of the heuristic against a fixtures list (symbol-like
  patterns fire; text/regex/`-F`/non-TS patterns do not); confirm exit code is
  always 0 and the throttle suppresses repeats.
- Agent-block drift-check: a script (run in pre-commit and/or CI) extracts the
  canonical block from `docs/rules/lsp.md` (the `LSP-AGENT-BLOCK` markers) and
  fails if any of the 9 agent files is missing it or has a divergent copy.

## Follow-up (post-Phase 5)

- Run a dedicated `/audit` once the nudge hook has been live for a representative
  period to measure its effectiveness: nudge fire rate, the share of fires that
  led to an LSP call (effectiveness), and the false-positive rate (fires on
  legitimate text searches). Use the findings to tighten the heuristic, adjust the
  throttle, or remove the hook if it is net-negative.
