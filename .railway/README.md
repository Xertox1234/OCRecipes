# Railway Infrastructure as Code

`railway.ts` holds the API service's build and deploy settings: build and start commands, the
healthcheck, the restart limit, placement, domain and variable names. It replaced the
repo-root `railway.json` on 2026-10-09.

## Things to know before running anything

- **Railway does not read this folder during deploys.** A setting changes only when someone
  runs `railway config apply`. Merging a change here deploys nothing by itself, but the
  Railway settings stay as they were until the apply.
- **This file is a named partial (`OCRecipes`).** It owns only the `OCRecipes` service. The
  `Postgres` service is deliberately absent. Never add `postgres(...)` here: once a partial owns
  a database, removing that line deletes it.
- Variable values stay on Railway. Every `preserve()` line means "keep what is set". A new
  variable needs a new `preserve()` line, or a plan will show it as removed.
- `restartPolicyType` is deliberately left out. `ON_FAILURE` is Railway's default, which
  Railway stores as empty, so declaring it shows as a change on every plan.
- Do **not** run `railway config migrate`. With no `railway.json` it has nothing to migrate,
  and from a worktree it names the service after the folder.

## Changing a setting

1. Install the SDK: `npm install`, then `railway login` and `railway link` (project
   `OCRecipes`, environment `production`).
2. Edit `railway.ts`.
3. Preview with `railway config plan --verbose`. Apply only if every line below is true:
   - The plan says **`0 to destroy`**.
   - It touches only `service.OCRecipes`, with nothing for `Postgres`.
   - It shows only the change you made.
4. Run `railway config apply`. Do not pass `--confirm-destructive`, so a destructive change is
   refused rather than applied.
5. Run `railway config plan` again. It should report "already up to date".
