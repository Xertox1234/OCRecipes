---
title: "Custom ESLint rules in `eslint-plugin-ocrecipes` for server-side patterns"
track: knowledge
category: best-practices
tags: [eslint, server, routes, custom-rules, automated-enforcement]
module: server
applies_to: ["eslint.config.js", "server/routes/**/*.ts"]
created: 2026-05-13
---

# Custom ESLint rules in `eslint-plugin-ocrecipes` for server-side patterns

## When this applies

When a codebase pattern needs more context than `no-restricted-syntax` AST selectors can express (e.g., "ban `parseInt` only when called on `req.params.*`/`req.query.*`"), write a custom ESLint rule in `eslint-plugin-ocrecipes/index.js`. These rules apply to `server/routes/**/*.ts` via `eslint.config.js`.

## Why

A single AST-selector rule cannot match "function call where the argument starts with `req.params.` or `req.query.`" — that requires walking the argument expression. Custom rules give full programmatic AST access while staying inside the standard ESLint workflow (in-editor squiggles, CI failures, pre-commit hooks).

## Examples

Three custom rules in `eslint-plugin-ocrecipes/index.js`:

| Rule                               | Enforces                                | Error Flagged                                       |
| ---------------------------------- | --------------------------------------- | --------------------------------------------------- |
| `ocrecipes/no-bare-error-response` | `sendError()` pattern                   | `res.status(4xx/5xx).json({ error: ... })`          |
| `ocrecipes/no-parseint-req`        | `parsePositiveIntParam`/`parseQueryInt` | `parseInt(req.params.*)` or `parseInt(req.query.*)` |
| `ocrecipes/no-as-string-req`       | `parseQueryString`/`parseStringParam`   | `req.params.* as string` or `req.query.* as string` |

## When to use

- Enforcing a codebase-specific helper-utility pattern (sendError, parseQueryInt, etc.)
- Banning a specific argument shape on a known function call
- Any pattern that requires AST traversal beyond a single selector

## Exceptions

- Patterns reliably detected by a single AST node (use `no-restricted-syntax` instead — less code)
- Cross-file invariants (use a custom lint script — `scripts/check-*.js`)

## Related Files

- `eslint-plugin-ocrecipes/index.js` — rule implementations
- `eslint.config.js` — plugin registration and scope to `server/routes/**/*.ts`

## See Also

- [ESLint ban on `as never` in tests](eslint-ban-as-never-in-tests-2026-05-13.md)
- [Custom lint scripts for accessibility and hardcoded colors](custom-lint-scripts-accessibility-colors-2026-05-13.md)
