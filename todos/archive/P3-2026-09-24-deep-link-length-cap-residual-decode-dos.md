---
title: "Cap deep-link length before getStateFromPath — decode-uri-component 0.5.0 is still quadratic on distinct malformed runs"
status: done
priority: low
created: 2026-09-24
updated: 2026-09-24
assignee:
labels: [deferred, react-native, security]
github_issue:
---

# Cap deep-link length before getStateFromPath

## Summary

PR #1054 bumped `decode-uri-component` to 0.5.0 (GHSA-vcc3-ghjq-m6fr), which closes the advisory's repeated-`%C0` shape. But 0.5.0 is still super-linear on many _distinct_ partially-decodable percent runs. A deep link of roughly 100–200 KB can still stall the JS thread for a second or more.

## Background

Found by the security review of #1054 and reproduced independently. In upstream `customDecodeURIComponent`, each distinct malformed run adds one `replaceMap` entry, and then the code runs `input.replace(new RegExp(key,'g'))` over the whole input once per entry. That is O(entries × length).

The measurement used patched `query-string.parse("token=" + v)` under Node v24.20.0 (V8 JIT; Hermes will be slower). Each input is `n` runs shaped `"%C0%" + hex(a) + "%" + hex(b) + "%" + hex(c) + "x"`, with distinct a/b/c. The control is the same length but repeats a single run:

| n     | length  | distinct | control |
| ----- | ------- | -------- | ------- |
| 4000  | 52,000  | 95 ms    | 26 ms   |
| 8000  | 104,000 | 277 ms   | 51 ms   |
| 16000 | 208,000 | 1492 ms  | 100 ms  |

The flaw is upstream and outside #1054's scope. It was deferred as low severity because it needs an unusually large link, only affects the device that opens it, and exposes no data.

## Acceptance Criteria

- [x] Deep links whose path+query exceed a cap (for example 8 KB) are rejected before `getStateFromPath` decodes them: the app stays on its current screen and does not stall.
- [x] A test in `client/navigation/__tests__/linking.test.ts` feeds the distinct-run payload (n=16000) through the linking entry point and asserts it returns quickly. It must fail without the cap.
- [x] Normal deep links (`recipe/:id`, `verify-email?token=…`, `scan?mode=…`) still parse; the existing linking tests stay green.

## Implementation Notes

- Add a `getStateFromPath` to the `linking` config in `client/navigation/linking.ts`. It returns `undefined` when `path.length` exceeds the cap and otherwise delegates to `getStateFromPath` from `@react-navigation/native`.
- Check the size of real links (for example the verify-email token) so the cap cannot reject a legitimate link.
- Optionally report the O(entries × length) replace loop upstream to `SamVerschueren/decode-uri-component`.

## Scope Contract

- **Mechanisms to use:** React Navigation's `linking.getStateFromPath` option — nothing new.
- **Files in scope:** `client/navigation/linking.ts`, `client/navigation/__tests__/linking.test.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- #1054 merged (the 0.5.0 bump).

## Risks

- A cap set too low would silently drop legitimate long links. Measure the real link sizes first.

## Updates

### 2026-09-24

- Initial creation from the #1054 security review (the residual was reproduced).

### 2026-09-25

- Implemented: `client/navigation/linking.ts` adds a `getStateFromPath` override on the `linking` config (`MAX_DEEP_LINK_PATH_LENGTH = 8 * 1024`) that rejects any path+query over the cap before delegating to the real parser (imported from `@react-navigation/core`, not `@react-navigation/native`, to avoid pulling React Native sources into the Vitest node env).
- Coverage verified by reading source, not assumed: `NavigationContainer.js` spreads this app's `linking` object (including the override) into `useLinking`'s options, and `useLinking.native.js`'s single internal `getStateFromURL` calls the (possibly overridden) `getStateFromPath` for BOTH `getInitialState` (covers `Linking.getInitialURL()` and the notification `data.url`/entryId-derived fallback) and the `subscribe` listener (covers live `Linking` events and the pending-hold `flushPendingNotificationUrl` replay, since that calls the exact same `listener`). All three reviewers independently traced this and also confirmed the `UNSTABLE_routeNamesChangeBehavior="lastUnhandled"` replay rehydrates an already-computed state object rather than re-parsing the raw path, so there is no second, uncapped entry point.
- Measured, not assumed: an uncapped 208,019-char / 16,000-distinct-run payload (the todo's own shape) took ~1.5-1.8s on the implementer's machine, 1145ms and 6148ms on two reviewers' machines, and "several seconds" on a third — timings vary by machine/Node build but all confirm the multi-second stall is real. The worst payload the cap still allows (628 distinct runs, 8,183 chars) parses in ~6ms on every machine that measured it. The longest real link (verify-email token) measured 374-427 chars depending on email length, ~19-22x under the 8KB cap.
- Carry-over fix (separate commit `561e71b9`, orchestrator-directed from #1082's review, not tied to this todo's acceptance criteria): relabeled a stale code sample in `docs/solutions/design-patterns/deep-linking-configuration-2026-05-13.md` that had drifted from the real `linking.ts` (it omitted `clearLastNotificationResponse`/`consumeNotificationUrl` and the `isReady()`/pending-hold logic) as the vanilla React Navigation example instead of rewriting it to duplicate the correct block already below it; added a "verified by reading source, not on a device" hedge; and added `linking.test.ts` coverage for `extractNotificationUrl`'s entryId parsing (`"12abc"` rejected, `1.5` rejected, `"12"` accepted) plus a negative control that `clearLastNotificationResponse` is not called when no URL is derived.
- Review: `code-reviewer` + `mobile-reviewer` + `security-auditor` (security-labelled todo, per user ruling). mobile-reviewer and security-auditor: no findings. code-reviewer: one WARNING — `@react-navigation/core` is now imported directly in production code but isn't a declared `package.json` dependency (only a transitive dep of `@react-navigation/native`); deferred rather than fixed here since adding it would touch `package.json`, outside this todo's Scope Contract and not needed for any acceptance criterion.
- Hedge: the cap's behavior, timing, and the URL-source funnel are verified under Node 24/Vitest and by reading `useLinking.native.js`/`NavigationContainer.js` source — not exercised on Hermes or a device.

### 2026-09-25 (orchestrator repair)

- The length cap imports `getStateFromPath` from `@react-navigation/core`, which was not a declared dependency (only a transitive of `@react-navigation/native`, hoisted today). A future nesting change would break every deep link with no install/tsc/lint signal. Declared `"@react-navigation/core": "^7.13.5"` (the version already resolved; the lockfile gains only the root declaration).
