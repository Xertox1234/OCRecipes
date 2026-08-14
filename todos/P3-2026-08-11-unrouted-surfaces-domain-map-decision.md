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

### 2026-08-13

- The `ios/**` surface (one of the four listed in this todo's scope) was decided
  and shipped **separately**, in `todos/archive/P3-2026-07-26-ios-path-domain-mapping-gap-and-doc-nits.md`:
  the human made the call in-session (`ios/** → react-native`, expressed as
  `{ kind: "recursive-dir", dir: "ios" }` — the `Matcher` vocabulary has no way
  to scope more narrowly than a directory name, so the accepted over-match is
  `(^|/)ios/`, matching any directory literally named `ios` including
  `node_modules/**/ios/**`). Injection noise on unrelated native edits (asset
  catalogs, `Info.plist`) was weighed and accepted in favour of one simple
  rule — recorded inline as a comment on the rule in `scripts/lib/path-domains.ts`.
  Verified empirically: editing `ios/Podfile` now injects up to 4
  `react-native`-tagged solution docs (capped by `SOLUTIONS_PER_DOMAIN`,
  newest-first).
- **The other three surfaces in this todo's scope remain OPEN and undecided**:
  `android/**`, package manifests (`package.json`/`package-lock.json`/`app.json`),
  and non-schema `shared/**` + `server/lib/**`. This todo stays `backlog` /
  `human_led: true` for those.
- Evidence migrated from the closed `ios/**` todo — the six `docs/solutions`
  files whose `applies_to` named `ios/**`/`ios/Podfile` and were inert before
  this rule landed (five already carried a `react-native` tag; the sixth,
  `in-place-dep-patch-survives-reinstall-teardown-false-green-2026-07-26.md`,
  needed the tag added — done in the same PR):
  - `docs/solutions/logic-errors/in-place-dep-patch-survives-reinstall-teardown-false-green-2026-07-26.md`
  - `docs/solutions/code-quality/vision-camera-ocr-plus-v5-cpp-interop-2026-06-02.md`
  - `docs/solutions/code-quality/vision-camera-v4-to-v5-migration-2026-05-13.md`
  - `docs/solutions/code-quality/xcode-ambiguous-deps-alwaysoutofdate-committed-pbxproj-2026-06-23.md`
  - `docs/solutions/best-practices/visioncamera-5-upgrade-ios-xcode26-build-2026-06-02.md`
  - `docs/solutions/best-practices/ios-native-asset-sync-persistent-ios-directory-2026-05-13.md`
  - Observed empirically (2026-08-13, by running the hook — before: preamble
    only, 1155 B; after: 6063 B with a `[RULES — react-native]` block and 4
    solution refs). Only **3 of these 6** surface on an `ios/Podfile` edit. The
    `SOLUTIONS_PER_DOMAIN=4` cap fills newest-first, so the 4 delivered slots
    are `podfile-lock-snapshot-…-2026-07-27` (**not** one of the six),
    `in-place-dep-patch-…-2026-07-26`, `xcode-ambiguous-deps-…-2026-06-23`, and
    `vision-camera-ocr-plus-…-2026-06-02`. The **3** displaced are
    `visioncamera-5-upgrade-…-2026-06-02` (same date as the one above it — ties
    break reverse-lexicographically on path, so `code-quality/` won over
    `best-practices/`), `vision-camera-v4-to-v5-migration-2026-05-13`, and
    `ios-native-asset-sync-…-2026-05-13`.
  - Read that as **signal, not noise**, when deciding `android/**`: the
    non-listed doc that took a slot is about `Podfile.lock` update cascades —
    more on-point for a Podfile edit than the two 2026-05-13 migration docs it
    displaced. Routing is correctly wired; this is ordinary newest-first
    truncation, not a bug. The lesson for the remaining surfaces is that
    _adding a route does not guarantee any specific doc is delivered_ — only
    that the pool becomes reachable. Verify by running the hook, never by
    reading the mapping table.

### 2026-08-11

- Initial creation (deferred from the 143-doc retag sweep; agent C's systemic observation).
