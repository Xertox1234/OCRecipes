---
title: A dependency version held only by the lockfile is not pinned — put a deliberate hold in package.json
track: knowledge
category: conventions
tags: [dependencies, npm, semver, lockfile, dependabot, cocoapods, native-build, version-pinning]
module: shared
applies_to: ["package.json", "package-lock.json"]
symptoms: ["A dependency you deliberately held back reappears at the newer version after an unrelated npm install", "A native build breaks with a pod/gradle conflict that npm install reported no problem with", "A Dependabot PR crosses a version boundary a todo said not to cross", "Nobody can reconstruct why a version was being held"]
created: '2026-07-25'
---

# A dependency version held only by the lockfile is not pinned — put a deliberate hold in package.json

## Rule

When you deliberately hold a dependency **below** an available version, the
hold has to live in `package.json` — an exact version or an `overrides` entry —
not in `package-lock.json` alone. A caret range that already admits the version
you are avoiding is not a hold; it is a coincidence that survives only until
the next resolution.

Whenever a todo, comment, or PR says "we can't move to X yet", check the
declared range. If the range already permits X, fix the range in the same
change that documents the constraint.

## Smell patterns

- A todo or comment explaining why version X is blocked, while `package.json`
  declares `^Y` with `Y < X` in the same major — the caret already permits X.
- "The npm side is clean" as a conclusion, when what was verified was that the
  *installed* tree is correct rather than that the *declared* range is.
- A constraint that only manifests in `Podfile.lock` / `build.gradle`
  resolution, with nothing in the JS-side manifest recording it.

## Why

`npm install` honours `package-lock.json` when it is consistent, so a hold that
exists only there **looks** stable during ordinary work — which is exactly what
makes it fail later. Any of these silently crosses the line:

- Dependabot opening a bump within the declared range
- `npm update`, or `npm install <unrelated-package>` triggering re-resolution
- Regenerating or resolving a conflict in the lockfile
- A fresh `npm install` on a machine or CI runner without the lockfile honoured

The damage is proportional to **how late the failure surfaces**. Concretely
(2026-07-25): `package.json` declared

```json
"react-native-vision-camera": "^5.0.11",
"react-native-vision-camera-barcode-scanner": "^5.0.11",
```

while 5.1.1 was published and known to be **unusable** — it requires
`GoogleMLKit/BarcodeScanning = 9.0.0`, which conflicts irreconcilably with
`@react-native-ml-kit/text-recognition`'s hard pin at `8.0.0`. The caret already
permitted 5.1.1. Only `package-lock.json` was holding the line.

Had anything re-resolved, `npm install` would have succeeded silently and the
break would have appeared later at `pod install` — a CocoaPods resolution error
with no connection back to the npm change that caused it, and no record in the
repo of why 5.0.11 was deliberate. **The loudness of the eventual failure is not
protection when it fires in a different tool, at a different layer, days after
the change.**

## Examples

```jsonc
// ✗ Declared range admits the version you are avoiding
"react-native-vision-camera": "^5.0.11",   // 5.1.1 exists and is blocked

// ✓ Exact pin — simplest, and shows intent at the point of declaration
"react-native-vision-camera": "5.0.11",

// ✓ Or an overrides entry when the constraint is transitive
"overrides": { "react-native-vision-camera": "5.0.11" }
```

Either way, leave a pointer to *why* — a comment in the todo/PR that pins it is
not discoverable from `package.json`. Whoever hits the pin next needs the
reason, not just the number.

Never reach for `npm audit fix` while resolving any of this; use `overrides` —
see the Dependabot remediation convention in the project memory.

## Exceptions

- Ranges you *want* to float (most dev tooling, type packages) stay as ranges —
  this rule is only about a **deliberate** hold.
- A hold that is genuinely enforced elsewhere and verified in CI (e.g. a
  committed native lockfile that CI regenerates and diff-checks) can stay
  declarative — but confirm that check exists rather than assuming it.

## Related Files

- `package.json` — where a deliberate hold belongs
- `ios/Podfile.lock` — where this particular constraint actually bites
- `todos/P2-2026-07-25-mlkit-9-unblock-visioncamera-511.md` — the blocked upgrade that surfaced it

## See Also

- [Verify lockfile churn semantically, never by git diff line count](verify-lockfile-churn-semantically-not-by-diff-line-count-2026-06-23.md) — the sibling lockfile trap, on the reviewing side
- [A todo needing human judgment must carry human_led](todo-needing-human-judgment-must-carry-human-led-gate-2026-07-25.md) — the other finding from the same review
- [A library's auto-capability default can fail the whole operation](../logic-errors/library-auto-capability-default-fails-whole-operation-2026-07-25.md) — the defect whose root fix this pin is blocking
