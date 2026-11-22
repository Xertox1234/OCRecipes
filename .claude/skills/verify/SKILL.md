---
name: verify
description: Use when a change touches server/ or shared/ code and you need to confirm it works at runtime, not just in unit tests — a new or changed Express route, storage function, middleware, or shared schema — or when asked to "verify", "check it works" or "prove it" for a server change. Not for client screens (use verify-ui).
---

# verify — runtime check for server changes

Unit tests prove the pieces; this proves the running server. You boot the Express server
**from this working tree**, call each changed route, and report what came back.

**Evidence, not claims.** The report is a table of real requests and real responses. "The tests
pass, so it works" is not a verify result.

## The steps, in order

### 1. Find what changed

Collect changed `server/` and `shared/` files from all three sources — any one alone misses work:

```bash
{ git diff --name-only HEAD; git diff --name-only main...HEAD; git ls-files --others --exclude-standard; } \
  | grep -E '^(server|shared)/' | sort -u
```

Asked to verify a specific commit (already merged, or someone else's)? Use
`git show --name-only --format= <sha>` as the list instead.

From those files, list the routes they register or reach (grep `server/routes/` for the changed
service's callers). Nothing in `server/` or `shared/` → report `nothing server-side to verify`
and stop.

### 2. Run the co-located tests

Run only the test files next to the changed files: `npx vitest run <file> <file>`.
Never `npm run test:run`, `check:types` or `lint` (CLAUDE.md → Checks). A test fails → fix the
source, not the test.

### 3. Check the database is local

Calling routes writes rows. Read only the **host** of `DATABASE_URL`; never print the URL:

```bash
node -e 'const l=require("fs").readFileSync(".env","utf8").split("\n").find(x=>/^\s*(export\s+)?DATABASE_URL=/.test(x));if(!l){console.log("host: none");process.exit()}const v=l.split("=").slice(1).join("=").trim().replace(/^["\x27]|["\x27]$/g,"");try{console.log("host:",new URL(v).hostname)}catch(e){console.log("host: unparseable")}'
```

Host is not `localhost` or `127.0.0.1` (or none/unparseable) → report **BLOCKED (non-local DB)**
and stop. Do not "just try a read-only route".

### 4. Start your own server from this tree

Other worktrees run their own dev servers. **`:3000` is never yours** — not to call, not to stop,
even when it answers `/api/health`, because it may be running another branch's code.

1. Pick the first free port from 3101–3109: `lsof -nP -iTCP:3101 -sTCP:LISTEN` prints nothing →
   free. All taken → **BLOCKED (no free port)**.
2. From the worktree root, start it **in the background** (Bash `run_in_background`), with the
   port written literally: `PORT=3101 npm run server:dev`
3. Wait for health with curl's own retry (no `sleep` loop needed):

   ```bash
   curl -s --retry 30 --retry-delay 1 --retry-connrefused -o /dev/null -w '%{http_code}\n' localhost:3101/api/health
   ```

   Not `200` → read the server output's last error line and report **BLOCKED (server did not
   start: <line>)**. `503` means the database is unreachable: **BLOCKED**, never PASS.

### 5. Log in only if a changed route needs auth

Use the local demo account. Its username and password are in this project's auto-memory file
`user_test_account.md`; if it isn't there, ask the owner. **This repo is public:** the password
never appears in a command line, the report or a commit. Create the JSON body file in the
session scratchpad with the **Write tool** (not `printf`/`echo`/heredoc — those put the password
on a command line), send it, keep `token` from the response, and delete the file when done:

```bash
curl -s -X POST localhost:3101/api/auth/login -H 'Content-Type: application/json' -d @<that file>
```

The response has no `token` (a two-step email-code challenge instead) → report **BLOCKED (demo
account has two-step on)**. Do not try to complete the code step.

### 6. Call each changed route

One request on the normal path and one on an error path (bad input, missing auth, wrong owner).
Record method, path, status and a body excerpt of ≤200 chars. More than one request? Put them
in a script file and run it with `bash <file>` — the Bash tool's shell is zsh, which does not
word-split `$VAR`, so inline helpers with optional arguments silently send the wrong request.

**Paid calls — ask the owner before sending.** These routes spend money on AI providers: coach
chat, photo/label/receipt analysis, recipe generation, recipe import that parses with AI, and any
recipe create for a premium user when `RUNWARE_API_KEY` is set (it starts image generation; a
client-sent `imageUrl` does not stop it, because the schema nulls any URL outside our own
storage). Ask with the exact request. If you cannot ask (you are a subagent, or the owner said not
now), do not send it — mark the row **SKIPPED (paid)**.

Every success path of a route is paid and skipped → its error-path rows still count, but the
route's verdict is **PARTIAL (success path not exercised: paid)**, never PASS.

### 7. Stop the server you started

Stop the background task you started in step 4 with `TaskStop` and its task id (load it with
`ToolSearch` `select:TaskStop` if it is deferred). Confirm nothing listens on your port any
more (the step 4 `lsof` command prints nothing). Leave every other server running.
Do not run `npm run cleanup:seeds` or any bulk delete; if your requests created rows, delete
those exact rows through the API's own DELETE route, or list their ids in the report.

### 8. Report

| route | request | expected | actual | result |
| ----- | ------- | -------- | ------ | ------ |

`result` is PASS, FAIL, BLOCKED or SKIPPED (paid); a route-level verdict may also be PARTIAL
(step 6). Above the table: the port used and the commit
(`git rev-parse --short HEAD`, plus "+ uncommitted" if step 1 found working-tree changes).
A check still failing after 3 fix attempts → stop and explain what you tried.

## Red flags — stop and re-read the step

| Thought                                        | Reality                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| "A server is already up on :3000, I'll use it" | It may be another branch's code. Step 4: start your own on 3101+.        |
| "The DB check is overkill for a GET"           | Middleware writes too (sessions, rate limits, audit rows). Step 3 first. |
| "Tests pass and the code looks right — PASS"   | That is not a verify result. Call the route or report BLOCKED.           |
| "It's one cheap AI call"                       | The owner approves spend. Ask, or SKIPPED (paid).                        |
| "I'll clean up with cleanup:seeds"             | That deletes rows you didn't create. Delete your own ids only.           |
