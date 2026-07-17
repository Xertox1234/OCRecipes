---
title: Vitest resolves a Metro platform-suffixed file via an explicit import — only the extensionless form needs the platform resolver
track: knowledge
category: conventions
module: client
tags: [testing, vitest, react-native, platform-extension, camera, vision-camera]
applies_to:
  [
    "client/**/*.ios.test.tsx",
    "client/**/*.android.test.tsx",
    "client/**/*.ios.tsx",
    "client/**/*.android.tsx",
  ]
created: '2026-07-17'
---

# Vitest resolves a Metro platform-suffixed file via an explicit import — only the extensionless form needs the platform resolver

## When this applies

Writing (or deciding whether you even need to write) a Vitest config change to
get test coverage on a Metro platform-extension file — `Foo.ios.tsx`,
`Foo.android.tsx` — that currently has zero dedicated tests because a sibling
test file only imports the extensionless `../Foo` and silently resolves to
the default/cross-platform variant.

## Smell patterns

- A todo or comment asserts "Vitest/Vite doesn't support `.ios.tsx`
  resolution" or "would need `moduleFileExtensions`/a resolve alias" as the
  blocker for testing a platform-specific file, proposed alongside a
  fallback of extracting the file's logic to a `*-utils.ts` file just to
  dodge the resolution question.
- A test file imports a component via the bare, extensionless specifier
  (`from "../CameraView"`) and a comment nearby notes it "resolves to the
  Android/default variant" — true for that specific import, but easy to
  over-generalize into "Vitest can't handle this extension at all."

## Why

Metro (React Native's bundler) implements platform-extension resolution as a
purely additive step on TOP of normal extension resolution: for an
extensionless specifier, it tries `Foo.<platform>.tsx` before falling back to
`Foo.tsx`. Vite/Vitest's resolver has no knowledge of that convention — for
an extensionless specifier it only ever tries the plain extensions
(`.tsx`, `.ts`, …), landing on `Foo.tsx`, never `Foo.ios.tsx`. That is a real,
permanent gap, and it's exactly what a comment like "importing `../Foo`
resolves to `Foo.tsx`" is correctly describing.

But that gap is scoped to the *extensionless* form. `Foo.ios.tsx` is,
structurally, just a file whose name happens to end in `.tsx` — nothing
about the `.ios` segment is special to Vite's transform pipeline (esbuild/oxc
picks a loader off the trailing extension, and `"Foo.ios.tsx".endsWith(".tsx")`
is `true`). An **explicit** import that names the file —
`from "../Foo.ios"` — never touches Metro's platform-resolution step at all;
it's answered by Vite's completely ordinary "try appending each configured
extension" resolution, the same mechanism that resolves any other filename.
No `moduleFileExtensions` list, no `resolve.alias`, no per-file Vitest
project is needed — proceed straight to writing the test file with a
platform-qualified import.

The one thing that DOES need the platform module's own dependencies mocked:
if the platform file imports platform-only APIs (`useObjectOutput`,
`isScannedCode` — iOS-only, throw on Android per `docs/LEARNINGS.md`), the
test's `vi.mock(...)` factory must supply every export that specific file's
import list needs, not just what the sibling cross-platform file needs.

## Examples

```typescript
// CameraView.test.tsx — extensionless import; Metro-equivalent resolution
// is unavailable, so this ALWAYS resolves to the cross-platform file:
import { CameraView } from "../CameraView"; // -> CameraView.tsx, never CameraView.ios.tsx

// CameraView.ios.test.tsx — explicit import; ordinary extension resolution,
// no config changes needed:
import { CameraView } from "../CameraView.ios"; // -> CameraView.ios.tsx
```

```typescript
// vi.mock factory must cover the PLATFORM FILE's own import list —
// useObjectOutput/isScannedCode exist only on the iOS import graph:
vi.mock("react-native-vision-camera", () => ({
  Camera: vi.fn(/* ... */),
  useCameraDevice: vi.fn(),
  usePhotoOutput: vi.fn(() => ({})),
  useObjectOutput: vi.fn(() => ({})), // iOS-only export
  isScannedCode: vi.fn(() => true), // iOS-only export
}));
```

Verified empirically (not just reasoned about) before committing to this
approach: a minimal throwaway `.ios.tsx` fixture with JSX + generics
transformed and imported cleanly via an explicit path with zero config
changes; the earlier failure while probing the *real* `CameraView.ios.tsx`
turned out to be an unmocked native package import, not a resolution or
transform failure of the `.ios.tsx` extension itself.

## Exceptions

If the goal is coverage of code reachable ONLY via the extensionless,
Metro-resolved import path (e.g. asserting that `ScanScreen`'s own
`import CameraView from "./CameraView"` — no platform suffix — really does
receive the platform build at runtime), that is a Metro/bundler concern, not
something Vitest can exercise either way; don't chase a Vitest config fix for
it. The extraction-to-`*-utils.ts` fallback still has independent value when
the platform file's dependencies are too heavy/native to mock cheaply — it's
just not required merely to unblock resolution.

## Related Files

- `client/camera/components/__tests__/CameraView.ios.test.tsx` — the first
  test file using this pattern
- `client/camera/components/__tests__/CameraView.test.tsx` — the sibling
  whose header comment describes the (accurate, but easy to over-generalize)
  extensionless-import limitation
- `client/camera/components/CameraView.ios.tsx` — the AVFoundation
  `useObjectOutput` platform file under test
- `vitest.config.ts` — deliberately left untouched; no
  `moduleFileExtensions`/resolve-alias change was needed

## See Also

- [../logic-errors/visioncamera-v5-output-identity-and-callback-staleness-2026-07-17.md](../logic-errors/visioncamera-v5-output-identity-and-callback-staleness-2026-07-17.md) — the VisionCamera v5 attach-time behavior this test suite's memoization/wiring assertions pin
- [../best-practices/extract-pure-functions-for-vitest-testability-2026-05-13.md](../best-practices/extract-pure-functions-for-vitest-testability-2026-05-13.md) — the `*-utils.ts` extraction fallback this solution shows is not always necessary just to unblock resolution
- [pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md](pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md) — why testing through the real component (as done here) covers wiring that an extracted-function-only test would miss
