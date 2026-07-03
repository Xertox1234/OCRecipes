---
title: 'Exclude web from `eas update --platform all` via the `platforms` array, not the `web` config block'
track: knowledge
category: conventions
module: client
tags: [expo, eas-update, app-json, platforms, web, ota, build, mobile-only]
applies_to: [app.json]
created: '2026-06-22'
---

# Exclude web from `eas update --platform all` via the `platforms` array, not the `web` config block

## Rule

To stop `eas update --platform all` (and `expo export`) from attempting a **web** bundle in this mobile-only app, set an explicit `platforms` array in `app.json`:

```json
"platforms": ["ios", "android"]
```

Do **not** rely on removing the `expo.web` config block (`output`, `favicon`) to exclude web — that block does not control which platforms `--platform all` targets. Removing it is harmless cleanup, but on its own it leaves web in the target set and the update still fails with:

```
It looks like you're trying to use web support but don't have the required
dependencies installed. Install react-native-web@^0.21.0 ...
```

`react-native-web` is intentionally absent here (mobile-only; removed in archived todo `009-remove-web-support`), so web must be excluded at the config level rather than installed.

## Why

From the Expo CLI source (`node_modules/expo/node_modules/@expo/cli/build/src`):

- `start/server/platformBundlers.js` → `getPlatformBundlers()` **always** returns `web` in the bundler map (defaulting to `'metro'` when `@expo/webpack-config` is absent). `exp.web?.bundler` only overrides the bundler *name*; the absence of the `web` block does **not** drop web from the map.
- `export/resolveOptions.js` → `resolvePlatformOption()` expands `--platform all` to the platforms where `bundler === 'metro' && exp.platforms?.includes(platform)`. The selector is **`exp.platforms`**, not `exp.web`.
- `start/doctor/web/WebSupportProjectPrerequisite.js` states it directly: the warning reads *"remove the `web` string from the platforms array in the project Expo config,"* and `isWebPlatformExcluded()` detects exclusion **only** by inspecting the `platforms` array.

When `platforms` is omitted from `app.json`, Expo's config defaults fill it to include web. Verified locally with `@expo/config` `getConfig`: pre-edit `exp.platforms === ["ios","android","web"]`; after adding `"platforms": ["ios","android"]`, `exp.platforms === ["ios","android"]`.

## Examples

Local verification path (no `eas update` round-trip needed — settles the lever empirically):

```bash
node -e "const {getConfig}=require(require.resolve('@expo/config',{paths:[process.cwd()]})); \
  console.log(JSON.stringify(getConfig(process.cwd(),{skipPlugins:true,skipSDKVersionRequirement:true}).exp.platforms))"
# expect ["ios","android"] after the platforms-array edit
```

## Exceptions

- When the web client is actually built, add `"web"` back to the `platforms` array **and** install `react-native-web` (+ `react-dom`) — both are required together; the array alone re-introduces the missing-dependency failure.
- The publish scripts can sidestep this entirely by passing explicit native platforms (`eas update --platform ios`, `--platform android`) instead of relying on `--platform all`.
- End-to-end confirmation still requires running `eas update --platform all`; the `getConfig` check verifies the config lever, not the full OTA path.

## Related Files

- `app.json`
- `todos/archive/009-remove-web-support.md`

## See Also

- [EAS Update platform flag](https://docs.expo.dev/eas-update/getting-started/)
- [Expo app config `platforms`](https://docs.expo.dev/versions/latest/config/app/#platforms)
