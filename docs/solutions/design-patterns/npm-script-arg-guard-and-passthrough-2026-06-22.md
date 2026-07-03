---
title: Guarding and forwarding npm-run args in a package.json script (sh -c '...' --)
track: knowledge
category: design-patterns
module: shared
tags: [npm, package-json, shell, eas, tooling, devops]
applies_to: [package.json]
created: '2026-06-22'
last_updated: '2026-06-22'
---

# Guarding and forwarding npm-run args in a package.json script (`sh -c '...' --`)

## When this applies

You are wrapping a CLI in an npm script (`package.json` `scripts`) and need to
**both validate the user's forwarded arguments and pass them through** to the
wrapped command — e.g. require a `--message`, reject a dangerous override, then
hand the rest to the real tool. This came up wrapping `eas update` in
`update:preview` / `update:production` so an OTA publish "can't be done wrong"
(required `--message`, locked `--platform all`).

The non-obvious part: a plain command string in a script **cannot inspect**
forwarded args. `npm run foo -- --message "x"` appends the args to the very end
of the command string; inside that string `"$@"` is empty. You can forward args
(they land at the end) but you cannot guard them.

## Smell patterns

- An operator npm script that wraps a CLI with a required flag, but nothing stops
  a caller from omitting it (e.g. publishing an unlabeled OTA update).
- Reaching for `cross-env` or a separate `scripts/*.sh` file when the whole thing
  fits in one `package.json` line.
- Using `--platform ios --platform android` for a tool whose `--platform` is a
  single-value enum (last flag wins → only one platform publishes silently).

## Why

`npm run <script> -- <args>` **appends** `<args>` to the end of the resolved
command string; it does not pass them as positional parameters. So a guard placed
anywhere in a plain string sees nothing. Wrapping the body in `sh -c '<body>' --`
fixes this: npm appends `<args>` after the `--`, `sh` assigns them to positional
parameters, and inside `<body>`:

- `"$*"` (joined) is what you **inspect** in a `case` guard.
- `"$@"` (preserved tokens) is what you **forward** — a multi-word
  `--message "fix login screen"` survives as one argument, not three.

The inline `KEY=value ... sh -c '...'` env prefix matches the project's existing
scripts (`server:dev`, `server:prod`, `eval:recipe-generation`); no `cross-env`.
For `eas update`, `EXPO_PUBLIC_*` must be set in the **shell** at publish time —
`eas update` does not read `eas.json`'s build `env` — and `CI=1` (not
`--non-interactive`) is the proven non-interactive mode.

## Examples

A guarded, forwarding publish script (the EAS Update case):

```json
{
  "scripts": {
    "update:preview": "CI=1 EXPO_PUBLIC_DOMAIN=https://api.ocrecipes.com EXPO_PUBLIC_SENTRY_DSN=https://...sentry.io/... sh -c 'case \"$*\" in *--message*) ;; *) echo \"error: --message is required\" >&2; exit 1 ;; esac; case \"$*\" in *--platform*) echo \"error: do not pass --platform; this script always publishes both native targets via --platform all\" >&2; exit 1 ;; esac; exec eas update --branch preview --platform all \"$@\"' --"
  }
}
```

- `case "$*" in *--message*) ;; *) ... exit 1 ;; esac` — refuse to publish an
  unlabeled update.
- `case "$*" in *--platform*) ... exit 1 ;; esac` — `eas update --platform` is a
  single-value enum, so a forwarded `--platform ios` would last-win and silently
  publish only one target; reject it and keep the locked `--platform all`.
- `exec eas update ... "$@"` — forward the validated args; `exec` replaces the
  shell so the exit code is `eas`'s.

Verify behavior without authenticating by shimming the wrapped binary on `PATH`
with a stub that prints `"$@"`, then run the real npm script:

```sh
PATH="$PWD/.tmp-bin:$PATH" npm run --silent update:preview -- --message "fix login"
# stub sees: update --branch preview --platform all --message "fix login"  (one message arg)
```

## Exceptions

- If you only need to **forward** args (no validation), you don't need the wrapper
  — plain `"<cmd>"` already gets the appended args.
- `"$*"` substring matching is a coarse guard: `*--message*` also matches
  `--message=foo` (fine) and would match a literal `--message` inside another
  value. For operator scripts with a known downstream consumer this is acceptable;
  anchor with `printf '%s\n' "$@" | grep -q '^--message'` if you need precision.
- `--platform all` is only correct here because `app.json` lists
  `platforms: ["ios","android"]` (web removed, PR #426) so the web export is
  excluded. If web is re-added, `--platform all` will try to bundle web and fail.

## Related Files

- `package.json` — the `update:preview` / `update:production` scripts.
- `eas.json` — `preview` / `production` build profiles + channels (the
  `EXPO_PUBLIC_*` values mirrored inline in the scripts).
- `app.json` — `platforms: ["ios","android"]` makes `--platform all` exclude web.

## See Also

- Auto-memory `reference_eas_update_ota` — the three `eas update` footguns
  (inline `EXPO_PUBLIC_*`, no `--platform all` with web, `CI=1` not
  `--non-interactive`).
