---
title: 'ESLint Flat Config: Scope Plugin Rule Overrides to the Plugin''s Registration Glob'
track: knowledge
category: conventions
module: client
tags: [eslint, flat-config, plugin, testing, typescript]
applies_to: [eslint.config.js]
created: '2026-06-03'
---

# ESLint Flat Config: Scope Plugin Rule Overrides to the Plugin's Registration Glob

## Rule

When adding a test-file (or any) override that turns off rules from a custom plugin, the `files` glob in the override block must be scoped to exactly where the plugin is registered — never repo-wide (`**`).

## Why

ESLint flat config builds a merged config per-file by unioning all matching blocks. If a block references a plugin namespace (e.g. `ocrecipes/no-error-message-in-ui`) for a file that was never covered by the plugin's registration block, ESLint throws:

```
Could not find plugin 'ocrecipes'
```

This fails `npm run lint` entirely on CI.

The `@typescript-eslint` built-in plugin is safe to override with `**` because it is registered for all `*.{ts,tsx}` files globally. Custom plugins like `ocrecipes` are registered only for a subset.

## Examples

**Wrong — glob is repo-wide but plugin is only registered for `client/**`:**

```js
// eslint.config.js
{
  files: ["**/*.test.{ts,tsx}"],   // ← matches server/__tests__/, shared/__tests__/ too
  rules: {
    "ocrecipes/no-dead-apiRequest-guard": "off",
    "ocrecipes/no-error-message-in-ui": "off",
  },
},
```

`server/__tests__/` files match the override, but `ocrecipes` was never registered there → lint crashes.

**Correct — glob matches plugin registration scope:**

```js
// eslint.config.js
{
  files: ["client/**/*.test.{ts,tsx}"],  // ← scoped to where ocrecipes is registered
  rules: {
    "ocrecipes/no-dead-apiRequest-guard": "off",
    "ocrecipes/no-error-message-in-ui": "off",
  },
},
```

## Exceptions

Globally-registered plugins (`@typescript-eslint`, `react-hooks`) may use `**` in override globs because their registration already covers the full repo.

## Related Files

- `eslint.config.js` — plugin registration at lines 102–111; test-file override immediately after
- `eslint-plugin-ocrecipes/index.js` — custom plugin implementation

## See Also

- [double-talkback-announcements-live-region](../logic-errors/double-talkback-announcements-live-region-2026-05-13.md) — separate accessibility-plugin pattern
