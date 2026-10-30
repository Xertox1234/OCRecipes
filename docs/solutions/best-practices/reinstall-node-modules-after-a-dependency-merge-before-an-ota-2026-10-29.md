---
title: "Run npm ci in the main checkout after a merge changes a native dependency, before publishing an OTA — the update bundles the local node_modules"
track: knowledge
category: best-practices
tags: [harness, architecture, react-native]
module: client
applies_to: ["package.json", "package-lock.json"]
symptoms: ["check:types fails in the main checkout on code that is green in CI", "node -p \"require('<pkg>/package.json').version\" prints the old version after pulling main"]
created: 2026-10-29
---

# Run npm ci in the main checkout after a merge changes a native dependency, before publishing an OTA — the update bundles the local node_modules

## When this applies

After pulling `main` into the main checkout when the merged change bumped a package version, especially a package with native code (expo-iap, an Expo SDK step, VisionCamera), and before running `npm run update:preview` or `update:production` from that checkout.

## Rule

1. `git pull` brings the new `package.json` and `package-lock.json`. It doesn't change `node_modules`.
2. Run `npm ci` (not `--ignore-scripts`, because `postinstall` applies the patch-package patches). Never do this while another session or executor is using the same checkout's `node_modules`.
3. Confirm the version: `node -p "require('expo-iap/package.json').version"`.
4. Only then publish the OTA.

## Why

`eas update` bundles JavaScript from the **local** `node_modules`. EAS builds install from the lockfile on EAS's servers, so the phone's native code has the new version. An OTA published from a stale checkout pairs that native code with the old package's JavaScript, and the JS-to-native calls may not match.

On 2026-10-29, after #1561 (expo-iap 3.4.8 → 6.3.0), the main checkout still had 3.4.8. `preflight:fast` caught it first, because `check:types` failed on the `client/lib/iap` code, so no OTA went out.

## Exceptions

- Worktrees made by `scripts/oc-worktree.sh` get their own install, so they don't go stale this way.
- A merge that changes only JS in this repo needs no reinstall. Pulling `main` before an OTA is still required (see the pull-main-before-OTA rule in memory).

## Related Files

- `package.json` (`update:preview`, `update:production`)
- `patches/` (applied by `postinstall`)

## See Also

- [ad-hoc worktree missing node_modules symlink](../conventions/adhoc-worktree-missing-node-modules-symlink-2026-07-06.md) — the other way a checkout's node_modules is wrong
