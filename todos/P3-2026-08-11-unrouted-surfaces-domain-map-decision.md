---
title: "Decide routing for unrouted file surfaces: ios/android, package manifests, shared non-schema"
status: backlog
priority: low
created: 2026-08-11
updated: 2026-08-11
assignee:
labels: [deferred, harness]
github_issue:
human_led: true
blocked_reason: "Per-surface routing-vs-general-tier tradeoff (injection noise on package.json/ios edits vs anchored-doc value) is a human call — an unattended run would write the tradeoff into the todo as settled fact"
---

# Decide routing for unrouted file surfaces

## Summary

The 143-doc retag sweep (PR #801) surfaced file surfaces that route to NO injection domain: `ios/**`, `android/**`, `package.json`/`package-lock.json`, `app.json`, and non-schema `shared/**` (`shared/constants/**`, `shared/types/**`, `shared/lib/**`) plus `server/lib/**`. The docs anchored to these surfaces (see PR #801's body for the list) were given content-honest best-fit tags (react-native / architecture / typescript / harness), which makes them lint-clean and general-tier reachable — but their `applies_to` globs stay inert until the surfaces route somewhere. Two docs deserve explicit naming because their real content locus is `server/lib/image-store.ts` and only a `scripts/**`-catch-all sibling path keeps them lint-clean: `logic-errors/derive-storage-key-must-strip-query-before-delete-2026-06-29.md` and `conventions/overwrite-in-place-bump-version-to-bust-client-cache-2026-06-29.md` — a session editing `image-store.ts` sees neither until `server/lib/**` routes.

## Background

Same defect class as `docs/**` (fixed in PR #799), but each surface needs a real design call, not a mechanical rule. Mitigations already in place: `.ts` files on unrouted paths get the hook's typescript fallback (so `typescript`-tagged docs reach them at glob tier); the 13 docs are all lint-clean.

## Acceptance Criteria

- [ ] Per surface, decide: add a `path-domains.ts` rule (which domain?) or accept general-tier-only reach (document the decision in the rule-table comment either way)
- [ ] Candidate mapping to evaluate: `ios/**` + `android/**` → react-native; `package.json`/`package-lock.json`/`app.json` → architecture; weigh injection noise (how often are these files edited by Claude?) against the anchored docs' value
- [ ] If any rule is added: TDD in `path-domains.test.ts` (positive + decline-side cases), regenerate `domain-map.sh` + copilot-instructions, and re-check whether the affected docs' `applies_to` now activates (no tag changes should be needed — tags were chosen to match the candidate domains)

## Implementation Notes

Precedent and mechanics: PR #799 (docs/\*\* → harness) is the template — rule + rationale comment + decline-side pins. The affected docs are listed in the PR that lands the 143-doc retag (see its body). Blast-radius check per the #799 review: rules-file size and pool tiering.

## Scope Contract

- **Mechanisms to use:** `scripts/lib/path-domains.ts` rule table + generators — nothing new
- **Files in scope:** `scripts/lib/path-domains.ts`, `scripts/lib/__tests__/path-domains.test.ts`, generated `domain-map.sh` + `copilot-instructions.md`, and (only if activation warrants) the 13 docs' frontmatter
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None; PR #799 and the 143-doc retag PR are merged prerequisites (routing + tags already aligned to the candidate domains).

## Risks

- `package.json` routing injects on every Claude-driven dependency edit — verify that's signal, not noise, before adding.
- react-native rules file injecting on Podfile edits is partially off-topic; acceptable only if the harness-side native-build docs carry the real value.

## Updates

### 2026-08-11

- Initial creation (deferred from the 143-doc retag sweep; agent C's systemic observation).
