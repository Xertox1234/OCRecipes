# Railway Infrastructure as Code

`railway.ts` holds the API service's build and deploy settings. It replaces the repo-root
`railway.json`, which Railway stops reading on **2026-12-01**.

## Things to know before running anything

- **Railway does not read this folder during deploys.** A setting changes only when someone
  runs `railway config apply`. Merging a change here deploys nothing by itself.
- **`railway.json` is the only place the start and build commands live today.** The live
  service has none in its dashboard settings, and `package.json` has no `start` or `build`
  script for Railway to fall back on. If `railway.json` disappears from `main` before this file
  is applied, the next auto-deploy has no start command and fails. Keep `railway.json` until
  step 5 below.
- **This file is a named partial (`OCRecipes`).** It owns only the `OCRecipes` service. The
  `Postgres` service is deliberately absent. Never add `postgres(...)` here: once a partial owns
  a database, removing that line deletes it.
- Variable values stay on Railway. Every `preserve()` line means "keep what is set".

## One-time migration (owner)

Run these steps in one sitting from an up-to-date `main` checkout, with no merges to `main` in
between. Step 4 may start a redeploy. That is safe while `railway.json` is still on `main`,
because it holds the same settings.

1. **Install the SDK.** Run `npm install` once nothing else is using the shared
   `node_modules`, then `railway login` and `railway link` (project `OCRecipes`, environment
   `production`).

2. **Let the CLI write its own version over the draft:**

   ```bash
   railway config migrate --apply --force
   git diff .railway/railway.ts
   ```

   `--apply` also clears the service's "Config File" setting, without which `plan` refuses to
   run. If the diff shows more than formatting, stop and share it. Keep whichever version is
   right, but it must keep `export const partial = "OCRecipes"` and leave out Postgres.

3. **Preview:**

   ```bash
   railway config plan --verbose
   ```

   Go on to step 4 only if every line below is true:
   - The plan says **`0 to destroy`**.
   - It touches only `service.OCRecipes`. Nothing for `Postgres`, and no new services.
   - No variable is removed or changed.
   - No change to the source (`Xertox1234/OCRecipes`, branch `main`) or the domain
     `api.ocrecipes.com`.
   - Any changes are limited to the build command, start command, healthcheck path and timeout,
     restart policy, and replicas. "Already up to date" is also fine.

   If `plan` says the service is still managed by `railway.json`, stop. Do not delete
   `railway.json` to get past it; share the message instead.

4. **Apply:** run `railway config apply`. Confirm only if it shows the same changes as step 3.

5. **Check, then remove `railway.json`.** Confirm (or ask Claude to confirm) that the service's
   live settings now show the start command, build command, healthcheck and restart policy.
   Only then merge the follow-up PR that deletes `railway.json`.

6. **Watch that deploy.** It must succeed, and `https://api.ocrecipes.com/api/health` must
   answer. If it fails, Railway keeps the previous deployment running; roll back from the
   dashboard and share the build log.

## Later changes

Edit `railway.ts`, run `railway config plan`, and apply only after the plan reads as intended.
The same "0 to destroy" rule applies.
