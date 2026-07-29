---
title: "No ios/ path→domain mapping — six iOS solution docs never inject; plus two doc-precision nits from the PR #725 review"
status: backlog
priority: low
created: 2026-07-26
updated: 2026-07-26
assignee:
labels: [deferred, ios, native-build, tooling, docs]
github_issue:
---

# No `ios/` path→domain mapping — six iOS solution docs never inject

## Summary

`scripts/lib/path-domains.ts` has no entry for `ios/**`, so editing an iOS
native file (`ios/Podfile`, `ios/*.pbxproj`, the podspecs) fires **zero**
pattern injection. Six `docs/solutions` files already declare
`applies_to: [ios/...]`; all six are inert. Plus two small precision fixes in
material written during the PR #725 review.

## Background

Deferred from the `/code-review medium` pass on PR #725 (merged as `ca246e25`).
All three items were **SUGGESTION**-tier — none blocked the merge — but the
first is a genuine infrastructure gap rather than a nit.

The injection hook (`.claude/hooks/inject-patterns.sh`) maps a changed file's
path to domains via the generated `.claude/hooks/lib/domain-map.sh`, which is
built from `scripts/lib/path-domains.ts`. Verified 2026-07-26: neither the
source nor the generated map contains any `ios/` or `Podfile` entry. Every
`react-native` domain hit in that file is a `client/**` path.

Consequence: the moment someone edits `ios/Podfile` — exactly when the
accumulated native-build knowledge is most needed — none of it surfaces. The
`applies_to` frontmatter _looks_ like it wires this up, which is likely why the
gap went unnoticed.

Currently-inert `applies_to: ios/...` declarations:

- `docs/solutions/logic-errors/in-place-dep-patch-survives-reinstall-teardown-false-green-2026-07-26.md`
- `docs/solutions/code-quality/vision-camera-ocr-plus-v5-cpp-interop-2026-06-02.md`
- `docs/solutions/code-quality/vision-camera-v4-to-v5-migration-2026-05-13.md`
- `docs/solutions/code-quality/xcode-ambiguous-deps-alwaysoutofdate-committed-pbxproj-2026-06-23.md`
- `docs/solutions/best-practices/visioncamera-5-upgrade-ios-xcode26-build-2026-06-02.md`
- `docs/solutions/best-practices/ios-native-asset-sync-persistent-ios-directory-2026-05-13.md`

## Acceptance Criteria

- [ ] A decision is recorded on whether `ios/**` gets its own domain (e.g.
      `native-build`) or maps onto an existing one — adding a **new** domain
      label means a new `docs/rules/<domain>.md` and touches the
      copilot-instructions generator, so this is a real design choice, not a
      one-line addition
- [ ] `scripts/lib/path-domains.ts` maps `ios/**` (at minimum `ios/Podfile`,
      `ios/*.podspec`, `ios/**/*.pbxproj`) to the chosen domain(s)
- [ ] `.claude/hooks/lib/domain-map.sh` regenerated via `npm run build:domain-map`
      and committed — `build:domain-map:check` must pass in CI (never hand-edit
      the generated file)
- [ ] If a new domain label was introduced: `npm run build:copilot-instructions`
      re-run and `.github/copilot-instructions.md` committed, or the change is
      confirmed not to affect it
- [ ] Verified empirically that editing `ios/Podfile` now injects the iOS
      solutions — not merely that the mapping table contains the path
- [ ] `docs/solutions/logic-errors/in-place-dep-patch-survives-reinstall-teardown-false-green-2026-07-26.md`
      — split the two verification checks in the `## Solution` recipe. Silent
      `pod install` output proves non-re-extraction; `grep -c … # expect 1`
      proves only non-duplication and is **not** independently sufficient. As
      written a skimming reader could treat the `grep -c` line as the proof,
      which is the exact "a check that can't fail" failure the doc's own thesis
      warns against
- [ ] `ios/Podfile` — tighten the new `else`-branch comment. It lists four
      causes that could move `Pods/fmt/include/fmt/base.h`; only **pod rename**
      and **RN vendoring fmt elsewhere** actually relocate the sandbox
      extraction path. `use_frameworks!` and a modular-headers change alter
      linkage, module maps, and how targets import headers — not
      `installer.sandbox.root/<pod>/…`, which the podspec's own
      `source`/`header_dir` fixes. Leaving them listed sends a future reader
      chasing a red herring when the warning fires

## Implementation Notes

- The mapping source is `scripts/lib/path-domains.ts`; `.claude/hooks/lib/domain-map.sh`
  and `.github/copilot-instructions.md` are **generated** from it. CI drift-checks
  both (`build:domain-map:check`, `build:copilot-instructions:check`).
- Prefer reusing an existing domain if one fits — a new domain label obligates a
  new `docs/rules/<domain>.md`, and `docs/rules/` files are binding and
  short-by-design. Do not create an empty one just to satisfy the mapping.
- The two doc/comment items are independent of the mapping work and can land
  separately if the domain decision stalls.
- Verify injection by actually triggering it (edit `ios/Podfile` and observe the
  hook output), not by reading the generated table — the whole point of this
  todo is that a table that looks right delivered nothing.

## Scope Contract

- **Mechanisms to use:** the existing path→domain mapping and its generators —
  no new injection mechanism, no changes to `inject-patterns.sh` itself.
- **Files in scope:** `scripts/lib/path-domains.ts`,
  `.claude/hooks/lib/domain-map.sh` (regenerated only),
  `.github/copilot-instructions.md` (regenerated only), a new
  `docs/rules/<domain>.md` only if a new domain is chosen,
  `docs/solutions/logic-errors/in-place-dep-patch-survives-reinstall-teardown-false-green-2026-07-26.md`,
  `ios/Podfile` (comment text only — no behavior change to the fmt hook).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. PR #725 (`ca246e25`) and PR #724 (`1238b92c`) are both merged.

## Risks

- Adding a domain that maps broadly over `ios/**` could inject the iOS corpus on
  unrelated native edits (asset catalogs, `Info.plist`), which is noise rather
  than help. Scope the globs to the files where the knowledge actually applies.
- The `ios/Podfile` comment edit changes a file whose hook is load-bearing for
  every native build. It must stay comment-only — re-run `ruby -c ios/Podfile`
  and confirm `Podfile.lock`'s `PODFILE CHECKSUM` is the only lock change.

## Updates

### 2026-07-26

- Initial creation. Deferred from the `/code-review medium` pass on PR #725; all
  three items were SUGGESTION-tier and did not block that merge. The `ios/`
  mapping gap was verified directly against `scripts/lib/path-domains.ts` and
  the generated `domain-map.sh` (no `ios`/`Podfile` entry in either), and the
  six inert `applies_to` declarations were enumerated by grep.
