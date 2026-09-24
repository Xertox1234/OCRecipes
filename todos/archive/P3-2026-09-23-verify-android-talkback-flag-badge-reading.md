---
title: "Verify on device whether TalkBack double-reads the allergen flag badges (audit claim contradicted by docs)"
status: done
priority: low
created: 2026-09-23
updated: 2026-09-24
assignee:
labels: [deferred, audit, accessibility]
github_issue:
---

# Verify on device whether TalkBack double-reads the allergen flag badges (audit claim contradicted by docs)

## Summary

The audit claimed that `accessible={true}` flag-badge containers are double-read on Android TalkBack. Research found no documentation support, so this todo is a device check, not a fix.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M12** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- Sites: `client/screens/ScanScreen.tsx:1008-1043`, `client/camera/components/ProductChip.tsx:244-268`.
- Research: RN maps `accessible` → Android focusable with a contentDescription. Verdict `contradicted ⚠`.
- A separate real concern noted by research: both sites carry `accessibilityLiveRegion`, and a live-region content swap re-reads the whole chip.
- Method: `reference_talkback_emulator_verification` memory (uiautomator dump --compressed; adb input does NOT drive TalkBack).

## Acceptance Criteria

- [x] uiautomator dump / TalkBack emulator check records whether children are separately focusable
- [x] If double-read is confirmed: hide the children (`importantForAccessibility="no-hide-descendants"` on the inner content); if not, close as verified-false
- [x] Live-region re-read behavior noted in Updates

## Implementation Notes

Verification-first todo. No code change unless the device check confirms the issue.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/screens/ScanScreen.tsx`
  - `client/camera/components/ProductChip.tsx`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Needs an Android emulator with TalkBack.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M12).

### 2026-09-24

**Verdict: verified-false.** Neither flag-badge site double-reads on Android TalkBack. No code change made (Scope Contract: no change unless confirmed).

**Method.** The shared dev emulator (`emulator-5554`, `Medium_Phone_API_36.1`, already booted) was in use by the user's own live dev session (Metro on :8081 from the main checkout, Express on :3000). To avoid touching that session, a second Metro was run from this worktree on a separate port (`npx expo start --dev-client --port 8082`), reached via `adb reverse tcp:8082 tcp:8082` and an `expo-development-client://…?url=http://localhost:8082` deep link into the already-installed dev-client APK — port 8081 was never touched. Reaching the real `ScanScreen` required login; the recorded test account (`demo`/`demo123`, `user_test_account.md` memory) returned "Incorrect username or password" (likely stale — the memory itself notes `seed:recipes` randomizes the password unless `SEED_DEMO_PASSWORD` is set), and a fresh sign-up also failed server-side. Per the project's auth-is-high-risk rule this was not debugged further. Instead, per the sanctioned "override the component's prop directly in the parent screen" harness technique (`reference_talkback_emulator_verification` memory), a throwaway root-level harness (`client/A11yHarness.tsx`, temporarily swapped in for `RootStackNavigator` in `client/App.tsx`) rendered both real sites directly — bypassing auth/onboarding/navigation/camera entirely:

- Site A: the real `ProductChip` component with `phase` forced to `{ type: "BARCODE_LOCKED", product: { topFlag: { title: "Contains Peanuts", detail: "You listed a severe peanut allergy", tier: "safety", severity: "danger", ... } } }` (client/camera/components/ProductChip.tsx:244-268).
- Site B: a verbatim copy of the `confirmFlagBadge` JSX (client/screens/ScanScreen.tsx:1008-1043) with `getConfirmFlagPresentation`'s output inlined for a safety/danger flag.

Both harness files were reverted/deleted before this commit; `git status`/`git diff --stat` confirm a clean tree apart from this todo file.

**Evidence — `adb shell uiautomator dump --compressed` (captured with both badges visibly rendered, screenshot taken first):**

Site B (`ScanScreen` confirmFlagBadge copy):

```
<node index="1" text="" class="android.widget.TextView" content-desc="Contains Peanuts. You listed a severe peanut allergy" focusable="true" focused="false" bounds="[42,210][1038,305]">
  <node index="0" text="" class="android.widget.TextView" content-desc="" focusable="false" bounds="[63,235][105,279]" />   <!-- Feather icon glyph -->
  <node index="1" text="Contains Peanuts" class="android.widget.TextView" content-desc="" focusable="false" bounds="[126,231][422,284]" />   <!-- ThemedText label -->
</node>
```

Site A (`ProductChip` topFlag):

```
<node index="2" text="" class="android.widget.TextView" content-desc="Contains Peanuts. You listed a severe peanut allergy" focusable="true" focused="false" bounds="[79,1514][1001,1594]">
  <node index="0" text="⚠ Contains Peanuts" class="android.widget.TextView" content-desc="" focusable="false" bounds="[105,1529][975,1578]" />   <!-- single Text child, emoji inline -->
</node>
```

**Reading the evidence.** At both sites the `accessible={true}` container is a single `focusable="true"` node carrying the fully-composed `content-desc` ("Contains Peanuts. You listed a severe peanut allergy"), and every descendant (`Feather` icon glyph, `ThemedText`/`Text` label) is `focusable="false"`. Per `reference_adb_input_does_not_drive_talkback` / `reference_talkback_emulator_verification`, that is the exact signature of ONE TalkBack stop, not several — the audit's M12 claim (children separately focusable → double-read) does not hold for either site as currently coded. The 2026-08-04 "3-badge group is 4 stops on Android" prior in `reference_talkback_emulator_verification` does **not** transfer here — that was a different component shape (sibling badges); this fixture-rendered dump is the evidence for this shape (simple icon+text children, no nested `Pressable`/`accessible` descendants).

**AC3 — live-region re-read behavior.** Both badges carry their own `accessibilityLiveRegion` directly on the single composed node identified above (`ScanScreen.tsx` confirmFlagBadge: `confirmFlagVisuals.liveRegion`, "assertive" for safety-tier per `getConfirmFlagPresentation`; `ProductChip.tsx` topFlag: hardcoded `"assertive"`). Because that node is confirmed to be the sole focusable/announcing unit (children non-focusable, per the dump above), a content change re-announces exactly the composed badge label as one unit — the correct, intended scope for a badge whose whole point is to speak as a single alert. This is a different case from the live region that WAS removed from the outer chip `Animated.View` wrapper (code comment at `client/camera/components/ProductChip.tsx:233-238`): that one sat on a much bigger shared subtree and re-read the ENTIRE chip (product name, buttons, spinner) on unrelated descendant changes such as the smart-confirm busy/disabled swap — confirmed via logcat 2026-06-23 per `reference_talkback_emulator_verification`. That container-level live region stays removed; the two per-badge live regions audited here are correctly scoped to the badge alone and are not re-tested via logcat (not needed — AC3 only asks the behavior be noted, and the "not a single-node problem" distinction is what M12/the research flagged as worth recording).

**Housekeeping note (not part of Scope Contract, informational only):** a throwaway signup during triage created a dev-DB test user `a11ycheck2609` / `a11ycheck2609@ocrecipes.test`. Left in place rather than deleted via raw SQL, to avoid any write against the dev auth tables outside the app's own flow; harmless disposable test data, safe to remove whenever convenient.
