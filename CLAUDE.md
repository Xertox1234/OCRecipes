# CLAUDE.md

<!--
Admission test (harness item 7, 2026-11-02; evidence: docs/harness/2026-11-01-claude-md-research.md).
A line stays only if it is (1) a command or check, (2) a place the code misleads, (3) a decision not
written in the repo, or (4) a correction given twice — and no hook already enforces it with its own
message. One stated exception: Git Workflow stays as the owner's standing rule. Put the "why" and
owner-ruling dates in HTML comments like this one: they are stripped before the file reaches Claude.
scripts/check-claude-md-budget.js warns past 10 KB (comments excluded).
-->

OCRecipes: a mobile nutrition tracker — Expo/React Native client (`client/`), Express server (`server/`), shared Drizzle schema (`shared/`). Users scan barcodes and labels, log intake, plan meals and chat with an AI nutrition coach.

## Git workflow

- Never commit or push to `main`: feature branch and PR, even for small changes.
- Never `git reset --hard` or `rm -rf`; use `--mixed` resets and read-only inspection unless explicitly authorized.

## Working rules

- Strict TDD: a failing test first, then the implementation; tests pass before the PR.
- Ad-hoc worktree (outside `/todo`, `/todo-fast`, `/audit`): run `bash scripts/declare-worktree.sh "$(git rev-parse --show-toplevel)"` after entering it, and release with `--remove`/`--clear` when done. Write output files (reports, trends) inside the worktree. Guards then deny out-of-contract writes; bypass one command with `SKIP_WORKTREE_CONTRACT=1`. Coverage limits: `docs/superpowers/specs/2026-07-17-git-guardrails-design.md`.
- After a code review, check for emergent patterns and codify them (`/codify`). Memory marked RESOLVED/SHIPPED/MERGED is reduced to a one-paragraph takeaway or deleted at codify time.
- Review policy (one pass, plus at most one confirmation pass after in-place fixes) and the reviewer roster: `docs/AI_WORKFLOW.md` → Review Policy. A portable skill's review step goes to that roster, not `general-purpose`; implementation subagents stay `general-purpose`.
- Push after a clean review cycle unless told otherwise.

## Checks

- CI is the source of truth (8 required checks on `main`). Don't run `test:run`, `check:types` or `lint` ad hoc to self-verify. Sanctioned exceptions: the `/todo` executor's Step 5b full-suite run and the code-reviewer's schema-change full run.
  <!-- owner ruling 2026-10-02 -->
- Commits run lint-staged only. Every push runs `preflight:fast` and stamps HEAD; `npm run preflight` (full CI parity) is on demand. Gate details: `docs/AI_WORKFLOW.md` → Local gates.
- PR creation refused for a missing pass-stamp → run `npm run preflight:fast`. A PR touching a guard listed in `scripts/harness/verdict-diff/targets.tsv` also needs `bash scripts/harness/verdict-diff.sh`, with its lists pasted under `## Verdict changes`.
- CI failed → `npm run ci:failed-logs [-- <run-id>]`; never dump full workflow logs.
- Before reporting a PR number, sha, merge state or test count, verify it with a fresh call, and confirm exit codes are real (not a trailing `echo`).
- At most 4 parallel Bash calls per response; re-run alone anything that looks inconsistent.

## Tools

- Symbol work: the `LSP` tool before grep; the first query can come back cold — re-run once. When delegating symbol work to read-only agents, include that directive. Rules: `docs/rules/lsp.md`.
- GitHub: prefer `mcp__github__*` tools (deferred — load with `ToolSearch` `select:`) over `gh`; keep `gh` for CI logs.
- Code review: the `code-reviewer` subagent or `/code-review`, never a kimi script. Kimi scripts only on explicit request or the sanctioned embeds in `docs/AI_WORKFLOW.md` → Cheap-Worker Delegation; never on JWT auth, IAP receipt validation or user health data.

## Knowledge base

- `docs/rules/<domain>.md` (binding) and `docs/solutions/*.md` are injected on Edit/Write by `.claude/hooks/inject-patterns.sh`. If the injection spills to a temp file, read it. Layout: `docs/PATTERNS.md`.
- Solution frontmatter `tags:` must stay a single-line inline array (the hook greps `^tags:`; `scripts/check-solution-frontmatter.js` enforces it).
- `.claude/hooks/lib/domain-map.sh` is generated from `scripts/lib/path-domains.ts` — never hand-edit.
- Changing `docs/rules/*.md` or the path→domain map → run `npm run build:copilot-instructions` and commit the result (CI checks it).

## Findings and todos

- High/Critical defect found mid-task: fix it if in scope; otherwise one line in the reply (severity, path) and let the user decide — never auto-file.
- Medium/Low: fix if in scope, otherwise auto-file a todo per `todos/README.md` → Deferred findings, and name the path in the reply.
- Findings against `.claude/hooks/**` go to `docs/harness-residuals.md`, never a todo.

## Commands (footguns only — the full list is `package.json`)

```bash
# Dev loop: npm run server:dev (Express :3000) + npx expo run:ios (simulator, native modules).
# Expo Go (npm run expo:dev) has NO camera support — camera features need the dev-client build.

npm run db:push       # Drizzle schema push; first time only:
                      #   psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
npm run seed:recipes  # dev/test only — refuses NODE_ENV=production without --allow-prod-seed.
                      #   SEED_DEMO_PASSWORD=... for a reproducible demo login (default: random, printed once)
npm run cleanup:seeds # removes seed + test recipes (orphan/demo-authored ONLY)
npm run backfill:recipe-images   # overwrites our AI hero images in place (R2 keys); -- --dry-run spends nothing.
                                 #   After a real run, purge the Cloudflare cache for recipe-images/*.

# EAS Update — --message is REQUIRED; the scripts set CI=1, EXPO_PUBLIC_DOMAIN, EXPO_PUBLIC_SENTRY_DSN
# and --platform all. Never pass --platform yourself (the script rejects it).
npm run update:preview -- --message "fix login"
npm run update:production -- --message "ship it"
```

## Pointers

- Tests: Vitest, co-located in `__tests__/`; pure logic extracted from components into `client/components/*-utils.ts` so Vitest can cover it.
- Environment variables: `server/CLAUDE.md` (loads when you work in `server/`).
- iOS Simulator and device setup: `docs/DEV_SETUP.md`.
- Structured audits: `/audit [scope]`.
