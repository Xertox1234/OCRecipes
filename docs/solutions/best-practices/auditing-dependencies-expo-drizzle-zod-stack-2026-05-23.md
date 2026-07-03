---
title: Auditing dependencies in the Expo + drizzle + zod stack
track: knowledge
category: best-practices
module: shared
tags: [dependencies, expo, upgrades, npm, drizzle, zod, gotchas]
applies_to: [package.json]
created: '2026-05-23'
---

# Auditing dependencies in the Expo + drizzle + zod stack

## When this applies

Any "update the dependencies" / "are we up to date" task. This stack has several traps that
make a blanket `npm update` or `npm audit fix --force` actively harmful. Run a phased,
hand-picked audit instead.

## Examples

**1. `npm outdated`'s "Latest" lies for Expo-managed packages.** It shows the version from
the *next* SDK (e.g. SDK 56 while you're on 54), not what's compatible. The authoritative
source is `npx expo install --check`. Bump Expo packages with `npx expo install <pkg…>`
(pins to SDK-correct versions), never to npm "latest".

**2. Distinguish intentional forward-pins from drift.** `expo install --check` can ask you
to *downgrade* (e.g. it wanted `react-native-svg@15.12.1`, `@react-native-community/slider@5.0.1`,
`expo-notifications@~0.32.17` against installed 55.x). Confirm with `git log -p -- package.json`:
if a human deliberately bumped the constraint, it's a forward-pin — **leave it alone**, do not
run a blanket `npx expo install`. Pass an explicit package list so pins are untouched.

**3. Check `peerDependencies` before bumping — runtime-compatible ≠ type-compatible.**
`drizzle-zod@0.8` declares `zod: "^3.25.0 || ^4.0.0"` (so it *installs* under zod 3) but emits
**zod-4-shaped types** that fail `tsc` against the codebase's zod-3 schemas. The `||` was the
tell. See [[project-drizzle-zod-zod4-coupling]].

**4. Exact version pins (no `^`/`~`) are deliberate.** `prettier` was pinned to `3.6.2`
exactly — bumping it risks codebase-wide format churn failing CI `check:format`. `npm install
pkg@x` silently rewrites an exact pin to `^x`; diff the **pin style**, not just the number,
after bulk installs and restore intentional exact pins.

**5. ORM / library major bumps break *error-shape contracts*, not just type APIs.**
`drizzle-orm@0.45` was type-clean but wrapped driver errors in `DrizzleQueryError`, breaking 6
unique-violation handlers. `tsc` can't see it (catch errors are `unknown`). **Always run the
DB-backed runtime suite after an ORM bump**, not just the typecheck.

**6. Never `npm audit fix --force`.** Its "fixes" here downgrade `drizzle-kit` to 0.18
(a regression via the old `@esbuild-kit` chain) and jump `expo` to SDK 56. Use bare
`npm audit fix` for transitive deps, then re-run `npx expo install --check` to confirm no pin
was disturbed.

**7. Native-module bumps need a native rebuild.** After bumping `expo-image`, `-image-picker`,
`-haptics`, `-speech`, vision-camera, etc., Metro reload won't pick up the new native code —
run `npx expo run:ios` (triggers pod reinstall) to actually test it.

## Exceptions

- Transitive vulns buried in the Expo CLI toolchain (`postcss`, `uuid`, `esbuild`,
  `brace-expansion` under `@expo/*`) often can't be cleared without moving to the next SDK.
  Document them as "needs SDK NN" rather than forcing a fix.

## Related Files

- `package.json` — note the exact-pinned deps (`prettier`, `@types/node`, `react`,
  `react-native`) and the Expo forward-pins (`react-native-svg`, slider, `expo-notifications`)
- `todos/2026-05-23-drizzle-orm-0.45-migration.md` — worked example of a deferred breaking bump

## See Also

- [Detect Postgres error codes via err.cause, not message text](../conventions/detect-pg-error-code-via-cause-not-message-2026-05-23.md)
- [iOS native asset sync via persistent ios directory](ios-native-asset-sync-persistent-ios-directory-2026-05-13.md)
