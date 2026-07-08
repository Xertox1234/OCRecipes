# Overnight Todo Automation Runbook (`/goal` + `/todo`)

How to let Claude Code work through the `todos/` backlog with minimal supervision —
guard-eligible todos merge themselves once CI is green, and everything else is left
open for your morning review.

> **Model note (2026-07-06, restored):** guard-eligible PRs auto-merge. The `/todo`
> executor opens a PR for **every** priority, runs `scripts/todo-automerge-guard.sh`,
> and on a `low`/`medium`, non-`security` PR that clears the guard (both the TODO gate
> and the PATH gate), it immediately runs `gh pr merge --auto --squash --delete-branch` —
> GitHub's native auto-merge, which arms the PR to land itself the instant required CI
> checks pass. No human or orchestrator step is needed for those. `held` / `unknown` /
> `review-required` PRs stay open for individual review, exactly as before.
> (History: 2026-06-26 PR #465 first added this self-merge path → removed 2026-07-02
> after a harness sweep tightened the policy to "no PR ever auto-merges" → restored
> 2026-07-06 after the fully-manual model cost ~3 hours to review and merge 10
> low-severity PRs, which was redundant given the PR is already gated by the
> `code-reviewer`/domain-reviewer pass during execution, full CI, and this same
> fail-closed guard. The guard itself is unchanged — only what happens on a pass.)

`/goal` is a **native Claude Code CLI command**: you set a completion condition and
Claude keeps working across turns until it's met, with a live elapsed/turns/tokens
overlay. `/todo` is the worker it drives (worktree-isolated executors).
`/goal` is the supervisor loop; `/todo` does the work.

## The safety model

No sleeping human is in the loop, so code CAN reach `main` while you sleep now — but
only through the guard, never unconditionally. The filters:

1. **Merges are guard-gated, not human-gated** — a PR only auto-merges if it is
   `low`/`medium` priority, non-`security`, and every changed file is on the guard's
   safe-path allowlist. Anything else — `high`/`critical`, `security`-labelled, guard
   HOLD, or guard-unknown — is structurally incapable of auto-merging and sits open for
   you. The worst overnight outcome for a guard-eligible PR is a bad-but-CI-passing
   change landing on `main`; the worst outcome for everything else is unchanged — a
   stack of bad open PRs you decline in the morning.
2. **CI (required)** — `main` physically refuses any PR whose 8 required checks aren't
   green (Lint·Types·Patterns, Tests 1-3/3, Coverage, Mutation goal-safety, CodeQL
   Analyze, Mutation non-excluded). No human approval is required by branch protection —
   only green CI. That
   is the repo's hard merge bar, and it's the ONLY thing standing between an armed
   auto-merge and landing on `main` — there is no human checkpoint after the guard
   passes.
3. **`scripts/todo-automerge-guard.sh`** — the executor runs this on every `low`/`medium`
   PR to classify it. It is a **fail-CLOSED allowlist** with two gates: a TODO gate
   (the archived todo's frontmatter must say priority low/medium, with no `security`
   mention and no sensitive-domain keyword — auth/admin/premium/subscription/IAP/api-key/
   credential/etc.; session/verification/receipt/secret/health are deliberately excluded
   from THIS free-text keyword list because they collide with this app's own
   recipe/nutrition vocabulary, though the path gate below still catches them by file
   name — enforced by the script itself, so even a fresh session with no overnight report
   can't batch-merge a high/security/sensitive-intent PR) and a PATH gate: `MERGE_ELIGIBLE: yes`
   only when **every** changed file is a known-safe surface (all of `client/` and
   `server/storage/` minus their sensitive files, business services, shared pure modules,
   tests, docs/todos); it HOLDs for **anything sensitive or unrecognized** — the whole
   `server/routes/` directory (held wholesale, the request/authz boundary — see below), the
   whole `server/middleware/` directory, `.github/`, `scripts/`, migrations,
   `shared/schema.ts`, secrets, plus named-sensitive files (auth/session/email-verification
   (`VerifyEmailScreen`)/admin/premium/login/api-key surfaces, IAP/health) that live inside
   the otherwise-open `client/` and `server/storage/` roots — note the unrelated Verified
   Product API (`server/storage/verification.ts`, `VerificationBadge`, barcode/nutrition-data
   verification) is NOT sensitive and stays eligible in `server/storage/`; its
   `server/routes/verification.ts` counterpart still HOLDs, but only because ALL of
   `server/routes/` does now, not because it's flagged sensitive. An UNKNOWN
   path HOLDs — so a
   mislabeled-severity todo can't get itself onto your batch-merge list. (PR #465
   revised this to fail-closed after a review found the interim denylist fail-OPEN on
   whole layers; a 2026-07-08 audit widened the allowlist from narrow subdirectories to
   whole roots and added the sensitive-intent keyword gate as a second, independent
   layer, then reverted `server/routes/` back to HOLD-by-default the same day after a
   final review found real auth-security logic — rate limiters, password-strength schemas,
   upload validation, external API-key auth — living in shared route infra whose filenames
   named no sensitive keyword, so enumerate-the-sensitive-ones was the wrong default for
   that one root. The same day, an xhigh-effort review re-ran that exact hunt across
   `client/` and `server/services/` (the roots that DID stay open) and found 15+ more
   instances — Bearer-token-attachment hooks, health-PII fields, PII-redaction and
   anti-abuse logic — closed by name in `SENSITIVE_OVERRIDE`, plus a drift-detection test
   (`scripts/__tests__/todo-automerge-guard.test.ts`) that re-runs the Bearer-token
   signature as a CI check so the next such file fails a test instead of silently
   auto-merging (health-PII wasn't automated the same way — too broad a signature for an
   app where dietary data is core product logic, not just a security concern — see the
   script's own comment). See the script's own header comment for the full model; to widen
   the pass further, add a known-safe prefix to the allowlist in the script.)
4. **Bounded stop conditions** — the `/goal` condition halts on N PRs opened / token
   cap / repeated failures, so a systemic mistake can't burn the whole backlog before
   you wake.

## Rollout: debut attended, graduate to asleep

**Do NOT make the first unattended-while-asleep run your debut.** The first run is the
one most likely to surface an unmodeled edge.

- **First runs — ATTENDED.** Run `/todo` foreground and watch. Fix whatever stumbles.
- **Graduate to unattended** only after a clean attended run **and** the gate below.

### Pre-unattended gate (all must be true)

- [ ] Guard script proven on a few real PRs (HOLDs sensitive paths, clears the rest).
- [ ] Executor permission coverage confirmed during the attended debut: `git push` of
      feature branches, `gh pr create` / `mcp__github__create_pull_request`,
      `Bash(scripts/todo-automerge-guard.sh:*)`, **and now `gh pr merge --auto --squash
--delete-branch` on a guard-cleared PR** all run without prompts. This last one is
      new since the 2026-07-06 restoration — the executor arms auto-merge itself, from
      an unattended session, before CI has gone green. Confirm the `autoMode.allow`
      entry for `gh pr merge` explicitly covers arming `--auto` pre-CI-green (not just
      merging once CI is already green) — see `.claude/settings.local.json`. If anything
      blocks while you watch, widen that entry precisely, then re-test; do NOT
      pre-widen blind.

## Morning check-in

The Phase 5 summary lists `MERGE_ELIGIBLE: yes` PRs under "Auto-merging on green CI (no
action needed)" — the executor already armed `gh pr merge --auto --squash
--delete-branch` on each when it opened the PR, so most of these have either already
merged overnight or will the moment their CI finishes. Nothing to do for that group; just
skim it for visibility. If any instead shows "Auto-merge failed to arm", the executor's
`gh pr merge --auto` call itself failed (network/auth/repo setting) — merge it by hand
with the same command, or treat it as an individual review.

`held` / `review-required` / `unknown` PRs you still review and merge individually, like
any other PR — this group is unaffected by the 2026-07-06 change.

## The `/goal` completion condition (paste this)

> Selection is by **frontmatter `priority:`**, never the filename — the `P#-` prefix is
> cosmetic and can drift. The archive move must ride **inside the PR**, or a todo
> whose archive didn't land stays "actionable" and the DONE condition loops forever.

```
/goal Drive every actionable todo with frontmatter `priority: low` or `priority: medium`
in todos/ to an open-PR state (ignore the filename prefix; read the priority field). Run the
/todo skill; its worktree-isolated executors do ALL the PR work themselves — implement
the todo, archive it inside the same commit, open a PR, run
scripts/todo-automerge-guard.sh to classify it (MERGE_ELIGIBLE), and — ONLY when the
guard passes (low/medium, non-security, safe-path-only) — arm
`gh pr merge --auto --squash --delete-branch` themselves so it lands on its own once CI
is green. You (the orchestrator) never call `gh pr merge` yourself; that call belongs to
the executor and only fires on a guard pass. Your job: dispatch /todo, watch the
results, and enforce the stop conditions. A guard HOLD (path or todo-frontmatter gate)
is a valid terminal state, not a failure.
DONE when: every actionable low/medium todo appears in SOME listing group of the latest
accumulated /todo Phase 5 summary, or as blocked-with-reason, or as a `failed` row in
the Phase 5 table — AND the latest /todo Phase 5 verification line is green. Every Phase
5 listing group is a terminal state for the night (the skill guarantees this — the list
below mirrors the exact headings in `.claude/skills/todo/SKILL.md` Phase 5 step 4; if you
rename a heading there, update this enumeration too, and vice versa): "Awaiting merge",
"Gated on a pending PR", "Gated on a dependency (not yet implemented)", "Stale branch —
self-clears next run", "Auto-merging on green CI (no action needed)", "Auto-merge failed
to arm" (needs manual `gh pr merge --auto`, or individual review), "Needs individual
review" (held/unknown/review-required PRs), "Skipped — quality flags" (that one needs MY
re-authoring), and "Blocked — needs a one-time manual fix" (this one also forces a STOP
EARLY below, so it won't co-occur with a clean DONE). ("Deferred warnings" lists review
findings, not todo outcomes, so it is not one of these groups.) A failed todo is
terminal for the night too — leave it for my morning review. Never re-dispatch a listed
or failed todo hoping its outcome changes. Evaluate
DONE from the Phase 5 reports you already hold; do NOT re-run test:run / check:types /
lint yourself and do NOT re-query GitHub per todo (one final batched `gh pr list` sweep
to confirm PR states before reporting DONE is fine) — /todo already verified and
classified everything once per dispatch.
STOP EARLY and wait for me if: 10 PRs opened, OR 1.5M output tokens, OR 2 STATUS:
failed reports accumulated across the night — two different todos, or the same todo
failing in two dispatches (each report already represents the executor's two internal
attempts), OR any todo blocks with REASON_CODE: ORPHAN_BRANCH, PR_CHECK_FAILED,
or PR_CLOSED_UNMERGED — the ACTION NEEDED codes (an orphan branch, an unverifiable PR
state, or a PR closed without merging — each needs my one-time decision; an open-PR
collision is just "awaiting merge or review, per its eligibility", not a stop
condition), OR an executor reports `MERGE_ELIGIBLE: yes (auto-merge enable FAILED ...)` —
that means `gh pr merge --auto` itself errored (likely a permission prompt or repo
setting) and needs my attention, not a silent retry.
```

## Launch

```bash
cd /Users/williamtower/projects/OCRecipes

# Attended debut (recommended first):
claude            # then run:  /todo   (watch it; fix stumbles)

# Unattended, after the gate above is satisfied:
claude --bg       # background session — survives sleep, shows in `claude agents`
#   then paste the /goal block above
# morning:  claude agents     # elapsed / turns / tokens; then check auto-merge status + review any held/review-required PRs
```
