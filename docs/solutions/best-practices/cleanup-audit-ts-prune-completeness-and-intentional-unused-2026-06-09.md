---
title: 'Cleanup audits: ts-prune completeness backstop + the intentional-unused-export caveat'
track: knowledge
category: best-practices
module: shared
severity: medium
tags: [audit, dead-code, ts-prune, lsp, cleanup, kimi-review]
applies_to: [client/**/*.ts, client/**/*.tsx, server/**/*.ts, shared/**/*.ts]
created: '2026-06-09'
---

# Cleanup audits: ts-prune completeness + intentional-unused caveat

Codified from the 2026-06-09 cleanup `/audit` (loose-ends / dead-code scope). The fixes were
easy; the *method* lessons are the reusable part.

## When this applies

Any "find dead code / loose ends / unfinished" audit, or any time you're about to delete an
export because "nothing uses it."

## Rule

1. **Don't trust agent eyeballing for completeness.** Specialist agents reading files in
   isolation reliably find the dead code they *open* and miss the rest. For a cleanup scope,
   completeness IS the deliverable — run a deterministic backstop: `npx ts-prune` (not installed
   in this repo; `npx --yes` it). It walks the whole TS project graph and lists every export with
   zero importers. In the 2026-06-09 run, agents found 4 server items; ts-prune surfaced **8 more
   client exports they'd missed** (6 label maps, `useSuccessFlash`, `throwStatusError`).

2. **ts-prune is noisy — filter the known false-positive classes before triaging:**
   - **Default-export components/screens** — ts-prune can't trace default imports; almost always live.
   - **`shared/` contract types** (`shared/types/*`, `shared/schemas/*` inferred aliases like
     `AuthResponse`, `BlockAction`, `CatalogSearchParams`) — deliberate client↔server (and planned
     web-frontend / Verified Product API) surface. Not dead.
   - **Test / eval / config scaffolding** (`__mocks__/`, `test/mocks/`, `evals/`, `drizzle.config.ts`).

3. **LSP-verify every surviving candidate** (`findReferences`, not grep — alias-aware). A 2-ref
   result can still be dead if the second ref is *in the same file* (e.g. a type used only by
   another type in the module) — read the ref locations, don't just count.

4. **THE CAVEAT — a zero-caller export is not always deletable.** Before deleting, cross-check
   against `docs/rules/` and `docs/solutions/`. Some unused exports are **deliberately-kept
   rule-prescribed helpers**. In this run, `throwStatusError` (`client/lib/throw-status-error.ts`)
   had 0 callers per ts-prune + LSP + grep — all correct about the *mechanics* — yet
   `docs/rules/client-state.md` **explicitly prescribes it** as the canonical helper for upgrading
   a bare-status query-fn throw to a code-carrying `ApiError`. It's unused only because no query fn
   yet needs it (a "ready-when-needed" migration target). Deleting it would have orphaned a binding
   rule's instruction. Static analysis sees "unused"; it can't see "kept on purpose."
   - The **write-time `inject-patterns.sh` hook** is what caught this: editing in the consuming
     dir injected the client-state rule that names the helper. Trust the injected rules over the
     static-analysis verdict when deciding *intent*.

## Companion lesson — kimi-review has no LSP, so it false-CRITICALs on dead-code removal

kimi-review cannot resolve references, so on a dead-code-removal diff it cannot verify "zero
callers" and tends to invent a regression. In this run it flagged removing the dead
`invalidateApiKeyCache` as CRITICAL ("revoked keys honored until TTL") — false on three counts:
(1) the fn had zero callers; (2) the revoke route already calls `clearApiKeyCache()`
(`server/routes/admin-api-keys.ts:129` + `:177`), so revoked keys are purged immediately; (3) it
hallucinated a "15-minute" TTL (actual `API_KEY_CACHE_TTL_MS = 60_000`, 60s). It also misread a
deletion `-` line as "still present." Disprove kimi dead-code CRITICALs with LSP `findReferences`
+ reading the actual call site; for auth-touching diffs, never let kimi's verdict stand over your
own analysis (never-delegate) — confirm with an LSP-capable `code-reviewer` subagent instead.

## Process checklist (dead-code / cleanup audit)

- [ ] Deterministic marker sweep first (TODO/FIXME, `console.*`, commented-out code) — cheap, grounds the scope.
- [ ] `npx --yes ts-prune` → filter the 3 FP classes above → LSP-verify each survivor.
- [ ] Before deleting any "unused" export: grep `docs/rules/` + `docs/solutions/` for it; if a rule names it, KEEP (false-positive).
- [ ] After deletion: `findReferences` (0 stale), `npm run check:types` (no dangling import), targeted tests.
- [ ] Treat kimi CRITICALs on dead-code diffs as suspect; disprove with LSP, not vibes.

## Related Files

- `client/lib/throw-status-error.ts` — the rule-prescribed helper that looked dead but must stay.
- `docs/rules/client-state.md` — the rule that prescribes it (the intent static analysis can't see).
- `server/middleware/api-key-auth.ts` / `server/routes/admin-api-keys.ts` — the kimi false-CRITICAL site.

## See Also

- `docs/rules/lsp.md` — LSP-first for symbol/dead-code work.
- `.claude/skills/audit/SKILL.md` — Phase 2 step 3 (LSP-confirm before manifesting a "dead" finding).
