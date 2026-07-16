---
title: "@react-navigation/elements's .png asset crashes Vitest collection at full-shard scale"
track: bug
category: runtime-errors
module: client
tags: [testing, vitest, vite, react-navigation, ci-only-flake]
symptoms: ["TypeError: Unknown file extension \".png\" for node_modules/@react-navigation/elements/lib/module/assets/back-icon.png thrown while collecting a test file that never imports @react-navigation/elements itself", "Failure only reproduces at full CI shard scale (~140+ files); isolated or small-batch local runs of the same file pass clean", "3/3 identical reproduction on the same commit — not explainable as ordinary CPU-contention flake"]
created: '2026-07-16'
severity: low
---

# @react-navigation/elements's .png asset crashes Vitest collection at full-shard scale

## Problem

Any component that transitively reaches `useHeaderHeight` from `@react-navigation/elements` (directly, or via `client/hooks/useHeaderContentInset.ts`) can trip a Vitest test-file collection crash: `TypeError: Unknown file extension ".png"` pointing at the package's `back-icon.png` header asset. The failing test file is often an innocent bystander with no import relationship to `@react-navigation/elements` at all — the crash surfaces on whichever file happens to be collecting when Vite's SSR module runner falls through to Node's native ESM loader for that asset instead of transforming it.

The failure is scale-dependent: it did not reproduce in isolation, in a small hand-picked batch of the package's known real importers, or in a full local 422-file/6250-test run against a bare branch head — but reproduced 3/3 times in CI and 3/3 times in a local rebuild of CI's actual `refs/pull/N/merge` artifact (~145-file shard).

## Root Cause

`@react-navigation/elements` ships a `.png` asset as part of its module graph. Every other native/asset-bearing dependency in this project (`react-native-svg`, `react-native-reanimated`, `react-native-gesture-handler`, `@expo/vector-icons`, `@gorhom/bottom-sheet`, `expo-haptics`, `@sentry/react-native`, `expo-blur`, `expo-linear-gradient`, `@react-native-community/netinfo`) is aliased in `vitest.config.ts` to a hand-written mock under `test/mocks/` — `@react-navigation/elements` was the one gap in that convention.

The blamed test file (`ChatScreen.test.tsx` here) is very likely an innocent bystander, not the trigger: Vitest attributes a shared-module-runner crash to whichever file happens to be mid-collection when it fires. The actual trigger is almost certainly a *different* file in the same shard that imports `@react-navigation/elements` for real (unmocked) and hits the asset at the wrong moment in Vite's dependency-optimization lifecycle. It didn't reproduce at small scale not because of file *count* per se, but because the specific real importer that triggers it wasn't co-located with the blamed file in any of the smaller local scenarios tried.

## Solution

Alias `@react-navigation/elements` to a mock in `vitest.config.ts`'s `resolve.alias`, matching every sibling native package:

```ts
"@react-navigation/elements": path.resolve(
  __dirname,
  "./test/mocks/react-navigation-elements.ts",
),
```

`test/mocks/react-navigation-elements.ts` only needs to export `useHeaderHeight` — grep every real (non-test) importer first to confirm no other export is in use before assuming this is sufficient elsewhere:

```ts
export const useHeaderHeight = () => 88;
```

(`88` matches the value `client/hooks/__tests__/useHeaderContentInset.test.ts`'s own local `vi.mock` already used for the same export — keep them consistent.)

## Prevention

When adding a new `react-native`/`@react-navigation/*`/Expo package to real source code, check whether it ships non-JS assets (icons, fonts, images) before assuming Vitest will transform it correctly at CI scale. If it does, alias it to a mock up front rather than waiting for an intermittent, hard-to-reproduce CI crash — see the "See Also" link below for how this one was actually diagnosed.

## Related Files

- `vitest.config.ts` — `resolve.alias` block
- `test/mocks/react-navigation-elements.ts`
- `client/hooks/useHeaderContentInset.ts` — the project's own real consumer of `useHeaderHeight`

## See Also

- [mock-native-svg-flow-syntax-transform-failure](mock-native-svg-flow-syntax-transform-failure-2026-07-12.md) — same class of gap, different package/symptom
- [CI failure must reproduce against merge ref, not branch head](../conventions/ci-failure-must-reproduce-against-merge-ref-not-branch-head-2026-07-16.md) — the debugging methodology that found this
