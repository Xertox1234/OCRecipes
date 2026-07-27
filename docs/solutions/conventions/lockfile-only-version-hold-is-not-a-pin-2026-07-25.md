---
title: A dependency version held only by the lockfile is not pinned — put a deliberate hold in package.json
track: knowledge
category: conventions
tags: [dependencies, npm, semver, lockfile, dependabot, cocoapods, native-build, version-pinning]
module: shared
applies_to: ["package.json", "package-lock.json"]
symptoms: ["A dependency you deliberately held back reappears at the newer version after an unrelated npm install", "A native build breaks with a pod/gradle conflict that npm install reported no problem with", "A Dependabot PR crosses a version boundary a todo said not to cross", "Nobody can reconstruct why a version was being held", "A hold is set at the version named in the resolver error, and a slightly older release in the same series is equally broken"]
created: '2026-07-25'
last_updated: '2026-07-26'
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
- A hold whose boundary is quoted from a resolver error message, with no check
  of whether the preceding release carries the same constraint.
- An exact pin landed as the whole mitigation, with `.github/dependabot.yml`
  untouched — or `open-pull-requests-limit: 0` cited as if it also stopped
  security updates.

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

while the 5.1.x series was published and known to be **unusable** — it requires
`GoogleMLKit/BarcodeScanning = 9.0.0`, which conflicts irreconcilably with
`@react-native-ml-kit/text-recognition`'s hard pin at `8.0.0`. The caret already
permitted 5.1.x. Only `package-lock.json` was holding the line.

Had anything re-resolved, `npm install` would have succeeded silently and the
break would have appeared later at `pod install` — a CocoaPods resolution error
with no connection back to the npm change that caused it, and no record in the
repo of why 5.0.11 was deliberate. **The loudness of the eventual failure is not
protection when it fires in a different tool, at a different layer, days after
the change.**

### Set the boundary from the manifest, not from the resolver transcript

The version named in a resolution error is the version that **happened to
resolve** — not the lower bound of the broken range. Read the actual constraint
out of the published manifest for each candidate release.

Concretely (2026-07-26): the `pod install` transcript named **5.1.1**, and both
the todo and the first draft of this rule recorded 5.1.1 as the blocked version.
But the published **5.1.0** podspec already declares

```ruby
s.dependency 'GoogleMLKit/BarcodeScanning', '9.0.0'
```

so 5.1.0 is equally unusable and there is no safe intermediate step. A hold
inferred from the transcript (`>=5.1.1`, or an exact pin justified as "5.1.1 is
the bad one") leaves a hole at exactly 5.1.0. Cheap to check:

```bash
TB=$(npm view <pkg>@<candidate> dist.tarball)
curl -sL "$TB" | tar -xzO 'package/*.podspec' | grep -i dependency
```

### Cover the bot-config layer too — a PR limit of 0 does not stop security bumps

An exact pin in `package.json` closes `npm update` and lockfile regeneration,
but **not** a bot that edits `package.json` itself. In this repo
`.github/dependabot.yml` sets `open-pull-requests-limit: 0`, which disables
**version** updates — and it is tempting to stop there. Security updates
**bypass that limit by design**: they fire on any CVE and bump to the minimum
patched version, which can sit on the far side of your boundary.

So a deliberate hold needs an `ignore` entry as well, banded to the whole
unusable series rather than a single release:

```yaml
- dependency-name: "react-native-vision-camera"
  versions: [">=5.1.0"] # NOT >=5.1.1 — see the boundary note above
```

Band it no wider than the real constraint, so an in-series security patch
(5.0.12) can still land. And where a family is version-locked as a set — the
VisionCamera pods share generated Nitro specs — every member needs its own
entry, or the set desynchronizes.

**Why this layer matters more than it looks:** CI has no native build step, so a
bump across this boundary passes every required check and only fails on an EAS
Build. When the authoritative gate is blind to the failure, config is the only
guard; review vigilance is not a substitute.

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
- `.github/dependabot.yml` — the second layer; `ignore` entries, because security updates bypass `open-pull-requests-limit: 0`
- `ios/Podfile.lock` — where this particular constraint actually bites
- `todos/P2-2026-07-25-mlkit-9-unblock-visioncamera-511.md` — the blocked upgrade that surfaced it (PR #724 applied the pin + ignore entries as a holding measure; both revert with the real upgrade)

## See Also

- [Verify lockfile churn semantically, never by git diff line count](verify-lockfile-churn-semantically-not-by-diff-line-count-2026-06-23.md) — the sibling lockfile trap, on the reviewing side
- [`Podfile.lock` is a snapshot constraint that REFUSES a native-major bump](../best-practices/podfile-lock-snapshot-refuses-native-major-pod-update-cascades-2026-07-27.md) — the mirror image: the CocoaPods lockfile is a *strong* hold that blocks a bump you meant to make, where `package-lock.json` is a *weak* one that yields to a bump you meant to block
- [A todo needing human judgment must carry human_led](todo-needing-human-judgment-must-carry-human-led-gate-2026-07-25.md) — the other finding from the same review
- [A library's auto-capability default can fail the whole operation](../logic-errors/library-auto-capability-default-fails-whole-operation-2026-07-25.md) — the defect whose root fix this pin is blocking
