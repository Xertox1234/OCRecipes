---
title: "Document an intentional Expo SDK major-version skew via expo.install.exclude, not by ignoring the doctor"
track: knowledge
category: conventions
tags: [architecture, expo, dependencies, expo-doctor]
module: client
applies_to: ["package.json"]
created: 2026-09-26
---

# Document an intentional Expo SDK major-version skew via expo.install.exclude, not by ignoring the doctor

## Rule

When a dependency is deliberately kept off the version Expo's bundled-native-modules list expects
for the installed SDK (e.g. because realigning it is a native-code change that would require a new
EAS build, and OTA is the only path currently reaching a device), record that decision as a
top-level `expo.install.exclude` array in **`package.json`** — not `app.json` — naming the bare
package(s):

```json
{
  "expo": {
    "install": {
      "exclude": ["expo-notifications", "expo-application"]
    }
  }
}
```

This is the mechanism `npx expo install`, `npx expo-doctor`, and `npx expo start` all read to skip
version validation for the named packages (verified against Expo's own docs,
`docs/pages/versions/unversioned/config/package-json.mdx` on the `sdk-54` branch). Do not leave the
mismatch unexplained in `expo-doctor` output, and do not add a version override elsewhere — this is
the one sanctioned opt-out key, and it changes zero runtime/bundle/OTA behavior (it only silences a
CLI check).

Verify the fix behaviorally, not just by reading the docs: run `npx expo-doctor` before and after
and diff the specific table/line the todo names. A correct fix removes the excluded packages from
the "Major version mismatches" table and reduces "N packages out of date" by exactly the count
excluded — it does not, and should not, change the overall "N checks failed" count if other,
unrelated checks are still failing.

## Smell patterns

- A todo/PR says "expo-doctor still fails" without quoting the specific before/after table —
  that's a sign the fix wasn't verified against the actual tool output.
- Reaching for a dependency version bump, `npm install`, or editing `app.json` to solve a
  version-mismatch warning when the real intent is "keep this version on purpose."

## Why

`expo-doctor`'s "packages that should not be installed directly" check and its "packages match
versions required by installed Expo SDK" check both key off the **literal package.json
declaration** — not off whether any app file imports the package. When triaging *other*
expo-doctor findings in the same run, don't substitute a source-code import grep
(`grep -rn "from ['"]expo-modules-core"` client/...) for that: a package can show zero app-code
imports and still be a direct, intentional `dependencies` entry (e.g. because a native module the
project **does** use transitively requires that exact version pinned at the top level). Check
`package.json`'s own `dependencies`/`devDependencies` block directly before concluding a flagged
package is "transitive" or "not really a dependency" — a reviewer caught exactly this
mischaracterization in this session (the original note claimed `expo-modules-core` was a
"transitive/peer pin" based only on an app-code import grep, when it is declared directly in
`package.json`'s `dependencies` at a fixed version).

## Examples

See `docs/solutions/README.md` frontmatter and `todos/archive/P2-2026-09-23-expo-sdk54-native-module-version-skew.md`
for the worked example: keeping `expo-notifications` (`^55.0.14`) and `expo-application`
(`~55.0.10`) on SDK-55 majors while the app runs Expo SDK 54, with the decision, the
`expo.install.exclude` entry, and the before/after `npx expo-doctor` tables all recorded in the
todo's Updates section.

## Exceptions

- If the skew is a **minor/patch** mismatch rather than a major one, prefer actually aligning it
  (`npx expo install --check`) when that's low-risk — `expo.install.exclude` is for genuinely
  intentional, usually native-code-blocked, skews, not a way to silence routine drift.
- Don't add a package to `expo.install.exclude` speculatively "in case" a future skew appears —
  add it only once a skew exists and a decision to keep it has actually been made.

## Related Files

- `package.json` — the `expo.install.exclude` array lives here
- `todos/archive/P2-2026-09-23-expo-sdk54-native-module-version-skew.md` — worked example with
  before/after `expo-doctor` output

## See Also

- None yet.
