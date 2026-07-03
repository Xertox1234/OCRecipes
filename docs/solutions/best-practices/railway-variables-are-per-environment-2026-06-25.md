---
title: Railway variables are per-environment — verify the scope before trusting a dashboard delete
track: knowledge
category: best-practices
module: server
tags: [railway, environment-variables, deployment, ops, prod-config]
created: '2026-06-25'
---

# Railway variables are per-environment — verify the scope before trusting a dashboard delete

## When this applies

Any time you add, change, or delete an environment variable on Railway and then
need the change to take effect for `railway run` or the deployed service — and
especially when a variable change "doesn't seem to take" (the app keeps using
the old value even though the dashboard shows it changed).

## Smell patterns

- You deleted a variable in the Railway dashboard, but `railway run --service X`
  (or the live app) still reports the old value.
- "I already deleted that, I don't know why you're seeing it."
- A config fix appears applied in the UI but the running process disagrees.

## Why

Railway scopes variables **per environment** (`production`, `staging`, ephemeral
PR envs, …). The dashboard's environment selector and the CLI's linked
environment are **independent controls**: a delete made while the dashboard is on
a non-`production` env leaves `production` untouched. A variable can also be a
**project-level shared variable** referenced by the service, which a
service-level delete won't remove.

`railway status` is the source of truth for which environment the CLI (and thus
`railway run`, and the matching deploy) actually reads. Two further wrinkles seen
together in one incident:

- `railway run` layers the service's remote vars **on top of your local shell
  env** — so if the remote var is gone but the same name is exported locally,
  the local value leaks through. (Check `printenv NAME` and your shell rc files.)
- A `--watch`/long-poll CLI call can exit `0` on a transient network reset
  without the checks actually completing — re-confirm state with a fresh
  non-watch query.

## Examples

Diagnose and fix authoritatively from the CLI (it can't pick the wrong env tab):

```bash
railway status                                   # confirm Environment: production
railway variables --service OCRecipes --kv | grep -i SOME_VAR   # what the linked env actually has
railway variables delete SOME_VAR --service OCRecipes           # delete in the linked env
# or override (wins over service- AND shared-level values, lands in the linked env):
railway variables --set "SOME_VAR=correct-value" --service OCRecipes
```

Setting a value is more robust than deleting when a delete "won't stick": a
service-level `--set` always wins precedence regardless of whether the bad value
is service- or shared-scoped.

## Exceptions

- `--skip-deploys` suppresses the auto-redeploy a variable change triggers — omit
  it when you _want_ the deployed app to pick up the change.
- For values identical to a library default (e.g. `OPENAI baseURL =
  https://api.openai.com/v1`), setting the default is functionally equivalent to
  deleting and avoids the scope-hunt entirely.

## Related Files

- (Ops-only; no repo files. `railway status` / `railway variables` are the tools.)

## See Also

- [../runtime-errors/openrouter-base-url-with-openai-key-401-2026-06-25.md](../runtime-errors/openrouter-base-url-with-openai-key-401-2026-06-25.md) — the incident where a prod var "wouldn't delete" because the dashboard was on the wrong environment.
