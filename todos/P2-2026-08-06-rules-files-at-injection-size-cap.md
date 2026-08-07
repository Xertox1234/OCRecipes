---
title: "security.md and accessibility.md are at the 6500 B injection cap — no new rule can be codified in either"
status: backlog
blocked_reason: "Editing `docs/rules/security.md` means editing binding IDOR / JWT / rate-limiting / SSRF rules, but no mechanism enforces a security review bar on it: `scripts/todo-automerge-guard.sh` short-circuits its sensitive-path check for every `docs/*.md` (they pass on `SAFE_ALLOWLIST` alone and never reach `SENSITIVE_OVERRIDE`), and `security` is absent from `SENSITIVE_INTENT_KEYWORDS`, so neither gate trips. A PR from this todo would be batch-automerge eligible and could land overnight unreviewed — exactly what the Risks section forbids. A human must drive the trim and sign off on the before/after rule inventory."
human_led: true
priority: medium
created: 2026-08-06
updated: 2026-08-06
assignee:
labels: [deferred, harness]
github_issue:
---

# Rules files at the injection size cap

## Summary

`docs/rules/security.md` has **9 bytes** of headroom and `docs/rules/accessibility.md` has **21**, under the CI-enforced 6500 B cap in `scripts/check-rules-file-size.js`. Neither file can accept a new rule today — promoting a solution into a binding `docs/rules/` entry has nowhere to put it, and `check-rules-file-size.js` rejects it at both gates: lint-staged at commit time (`package.json` → `"docs/rules/*.md"`) and again in CI on push.

## Background

Found during the 2026-08-04/06 knowledgebase health assessment (`docs/audits/2026-08-04-knowledgebase-health-assessment.md`, gitignored/local-only).

Measured headroom against `MAX_BYTES = 6500` (`GRANDFATHERED` is currently empty, so the cap is uniform):

| file             | bytes | headroom |
| ---------------- | ----- | -------- |
| security.md      | 6491  | **9**    |
| accessibility.md | 6479  | **21**   |
| client-state.md  | 6390  | 110      |
| database.md      | 6351  | 149      |

The cap is not arbitrary and should not simply be raised without analysis: `docs/rules/*.md` are injected **whole** before every edit in their domain, and the header of `check-rules-file-size.js` derives ~6850 B as the maximum that leaves room for solution refs on a single-domain first touch. Two domains share one `DOMAIN_BUDGET` (8600 B), so an oversized rules file forces its co-matched domain into deferral.

This is a **recurring squeeze, not a one-off**: `accessibility.md` was already trimmed once (6547 → 4582 B in PR #492) and has since regrown to 6479. Codification adds; nothing prunes. Whatever is done here should reduce the rate of regrowth, not just buy headroom once.

Related codified context: `docs/solutions/conventions/rules-files-stay-terse-for-inline-injection-budget-2026-06-05.md`.

## Acceptance Criteria

- [ ] `security.md` and `accessibility.md` are each **≤ 5,700 B** — i.e. ≥ 800 B under `MAX_BYTES = 6500`, which itself already holds ~350 B of margin below the ~6,850 B single-domain-first-touch ceiling derived in `check-rules-file-size.js`
- [ ] **No binding rule is lost.** Every rule present before the change is still discoverable — either still in the rules file, or moved into `docs/solutions/` with the rules file retaining a one-line pointer
- [ ] A before/after inventory of rule bullets is included in the PR body so a reviewer can verify nothing was silently dropped
- [ ] `node scripts/check-rules-file-size.js` passes for all files
- [ ] `bash .claude/hooks/test-inject-patterns.sh` still passes, including the inline-budget assertions
- [ ] Injected byte size is **measured** before and after for a `client/screens/*.tsx` edit and a `server/routes/*.ts` edit — not estimated
- [ ] A note on why regrowth recurs (and any guard against it) is captured, so this todo does not simply reopen in three months

## Implementation Notes

Three approaches, in rough order of preference:

1. **Relocate depth, keep the rule.** Several bullets in both files carry multi-sentence rationale that belongs in a solution file. Keep the binding imperative in `docs/rules/`, move the explanation to `docs/solutions/` and cite it. This is what PR #492 did and it is the approach most consistent with the "rules are short by design" convention.
2. **Split by sub-surface.** e.g. an `a11y-announcements` domain distinct from `accessibility`. Costs a new `RulesDomain` (see PR #767 for the full checklist — `path-domains.ts`, generated artifacts, the domain-count test, `domain_rank`, `domain_tag_pattern`, routing tables). Only worth it if the split is semantically real, not just size-driven.
3. **Raise `MAX_BYTES`.** Cheapest, but it moves the failure from a CI error to silent deferral/truncation at injection time — strictly worse feedback. If chosen, re-derive the number from the actual `DOMAIN_BUDGET`/`THRESHOLD` arithmetic and record the derivation.

Useful measurement command (post-#762 the hook selects relevance-first, so re-measure rather than reusing older numbers):

```bash
printf '{"session_id":"m1","tool_name":"Edit","tool_input":{"file_path":"'"$PWD"'/client/screens/NutritionDetailScreen.tsx"}}' \
  | PATTERN_INJECT_NO_LOG=1 bash .claude/hooks/inject-patterns.sh \
  | jq -r '.hookSpecificOutput.additionalContext' | wc -c
```

Use a **fresh `session_id` for every data point** — a repeat under the same session takes the dedup/pointer path and collapses already-injected domains to a one-line pointer (measured 8,881 → 7,196 B on byte-identical input), which reads as a successful trim when nothing was trimmed. A result of `0` means the hook exited early (non-Edit `tool_name`, unparsable stdin), not a zero-byte injection.

## Scope Contract

- **Mechanisms to use:** editorial restructuring of existing rules files, plus (optionally) new `docs/solutions/` files to hold relocated rationale. No new hook behaviour, no change to `MAX_BYTES` without recording the derivation.
- **Files in scope:** `docs/rules/security.md`, `docs/rules/accessibility.md`, new files under `docs/solutions/`, and — only if approach 3 is chosen — `scripts/check-rules-file-size.js`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None blocking. PR #767 (harness domain) touches `docs/rules/` only by adding `harness.md`; no conflict with these two files.

## Risks

- **Editing `security.md` means editing binding security rules.** A careless trim can silently drop a real control (the file covers IDOR, JWT, rate limiting, SSRF, upload validation). Treat rule loss as a blocking defect, not a formatting nit — hence the before/after inventory in the acceptance criteria. This todo is deliberately **not** labelled `security` because it is a size/packaging issue rather than a vulnerability, but the review bar for the content edit itself should be the same.
- `accessibility.md` is the highest-traffic rules file in the corpus; changing it changes what is injected on nearly every client screen and component edit.
- Trimming to fit without addressing regrowth just resets the clock — see the PR #492 precedent above.

## Updates

### 2026-08-06

- Initial creation. Headroom measured at security.md 9 B, accessibility.md 21 B against `MAX_BYTES = 6500`.
- **External review before merge — gated `human_led: true`.** The Risks section asks for a security-grade review bar on the `security.md` edit, but nothing enforced it: `scripts/todo-automerge-guard.sh` exempts every `docs/*.md` from its sensitive-path check, and `security` is not in `SENSITIVE_INTENT_KEYWORDS` — so a PR from this todo was batch-automerge eligible and could have landed overnight with no individual review. `human_led: true` now removes it from any autonomous `/todo` batch.
- Accuracy fixes from the same review: `/codify` only ever writes `docs/solutions/`, so the trigger is a **manual** promotion into `docs/rules/`, not an automated one; AC #1 restated as a mechanically checkable `≤ 5,700 B`; the size guard noted as lint-staged **and** CI; the measurement command caveated for the session-dedup pointer path. (The review flagged a `jq -r` literal-`null` hazard here — verified **not applicable**: the hook has a single emission site binding `--arg ctx`, so `additionalContext` is always a string; the real trap is session reuse.)
