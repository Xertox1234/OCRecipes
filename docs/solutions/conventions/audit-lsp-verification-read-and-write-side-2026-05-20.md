---
track: knowledge
category: conventions
tags:
  - lsp
  - code-audit
  - verification
  - review-workflow
  - tooling
module: shared
applies_to:
  - .claude/skills/audit/SKILL.md
  - docs/rules/lsp.md
created: 2026-05-20
---

# Audit LSP Verification Must Cover Both Read Side and Write Side

## Rule

When you wire the TypeScript LSP into a multi-phase audit or review workflow, apply it on **both** sides of the workflow — not just discovery:

- **Read side (finding verification).** Before _reporting_ a symbol-level finding (unused export, dead code, "safe to rename / change this signature"), confirm it with `findReferences` / call-hierarchy. This stops a grep-only false positive from reaching the findings table.
- **Write side (fix verification).** Before _making_ a symbol-changing fix (rename, signature change, removed or altered export), map the blast radius with `findReferences` / call-hierarchy; after the fix, re-run `findReferences` to confirm the change reached every call site with no stale callers.

A workflow that LSP-checks only discovery is half-wired: it hardens what you _report_ but leaves what you _ship_ on grep.

## Why

Both failure modes — a false "unused" verdict (read side) and a missed caller after a rename (write side) — come from the **same** root cause: grep matches text, so it cannot resolve the `@/` and `@shared/` path aliases and cannot distinguish a same-named-but-unrelated identifier. `findReferences` matches semantic identity and resolves the aliases.

The asymmetry that makes the write side easy to overlook: discovery is read-only and low-stakes (a false finding is triaged away by the user), but the fix phase **mutates code**, so a missed alias-resolved reference there is what actually ships a regression. The higher-risk half is the one most likely to be forgotten when retrofitting the tooling.

This was discovered when PR #233 ("Maximize LSP utilization") added LSP verification to the audit skill at exactly one place — Phase 2 discovery verification — and stopped there. Phase 2.5 (researcher-surfaced candidates) literally said "same discipline as Phase 2 step 3" yet listed only Read + grep, and the entire Phase 3 fix loop verified fixes with "grep/read the fixed code to confirm the change is present" — which proves the edit landed but not that every caller was updated. The follow-up extended the identical `findReferences` / call-hierarchy discipline to Phase 2.5 and to Phase 3 steps 2 (pre-fix blast radius) and 6 (post-fix propagation check).

## Examples

- **Read side — don't report a false positive.** An agent reports "exported `getUserById` is unused." A grep on the bare name can miss call sites imported via `@/` aliases; `findReferences` resolves them and shows live callers → the finding is a false positive and is dropped, not reported.
- **Write side — don't ship a missed caller.** An audit fix renames `getUserById` → `findUserById`. `grep "findUserById"` confirms the edit is present but says nothing about old callers; `findReferences` on the symbol confirms no stale references remain across `routes → services → storage → db`.

## Exceptions

- grep stays correct for `.sql`, config, native (non-TypeScript) code, and plain-text / string searches — the LSP is TypeScript-only.
- The LSP is navigation-only (no diagnostics); type errors still come from `npm run check:types` / CI.
- External diff-based reviewers (`kimi-review` / `kimi-multi-review`) have **no LSP access**, so this convention applies to Claude-driven verification only.

## Related Files

- `.claude/skills/audit/SKILL.md` — Phases 2, 2.5, and 3 carry the read-side and write-side LSP verification steps
- `docs/rules/lsp.md` — canonical LSP rules + the agent block duplicated into symbol-working agents

## See Also

- [docs/rules/lsp.md](../../rules/lsp.md) — LSP-first binding rules and the underused ops (`incomingCalls`/`outgoingCalls`, `goToImplementation`, `workspaceSymbol`)
