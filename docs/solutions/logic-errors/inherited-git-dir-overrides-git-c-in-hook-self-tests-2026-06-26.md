---
title: 'Inherited absolute GIT_DIR overrides `git -C`, corrupting the real repo from a hook self-test'
track: bug
category: logic-errors
module: shared
severity: high
tags: [git, hooks, test-isolation, git-dir, hermetic-tests, tooling, worktree]
symptoms: ['A shell/git hook self-test silently mutates the REAL repo: bogus user.email/user.name in .git/config, a phantom staged file, or uncommitted tracked-file edits reverted (HEAD detached/switched)', 'Corruption reproduces only locally (under VS Code''s integrated terminal or a git worktree), never in CI', The test passes its own assertions while clobbering the caller's working tree]
applies_to: [.claude/hooks/test-*.sh, scripts/run-hook-tests.sh, scripts/preflight.sh]
created: '2026-06-26'
---

# Inherited absolute GIT_DIR overrides `git -C`, corrupting the real repo from a hook self-test

## Problem

A hook self-test that builds its fixture with `git -C "$TMPREPO" <cmd>` is **not** hermetic. If an **absolute** `GIT_DIR` (and/or `GIT_WORK_TREE`) is present in the environment when the test runs, those env vars **override `-C`** for repository resolution — so every "temp-repo" setup command actually runs against whatever `GIT_DIR` points at: the developer's real checkout.

`.claude/hooks/test-branch-preflight.sh` did exactly this — `git -C "$REPO" config user.email "t@t"`, `git -C "$REPO" add x.txt`, and `git -C "$REPO" checkout --detach`/`switch`. Under an inherited absolute `GIT_DIR`, those wrote `t@t`/`T` into the real `.git/config`, staged a phantom `x.txt`, and moved the real HEAD (reverting uncommitted edits).

## Symptoms

- Bogus `user.email=t@t` / `user.name=T` in the real local `.git/config` (mis-authors any commit made while active).
- Phantom staged `x.txt` (one-byte `x`) appearing as an add-then-delete (`AD`).
- Uncommitted tracked-file edits reverted to HEAD before they could be committed — silent work loss.
- Reproduces only locally (VS Code terminal / worktree injects the env); passes clean in CI.

## Root Cause

`git -C <path>` changes the working directory **before** repo discovery — but an explicitly-set `GIT_DIR` env var **skips discovery entirely** and is used verbatim. So `GIT_DIR` wins over `-C`, and the *absolute-vs-relative* form decides the outcome:

- **Absolute** `GIT_DIR=/abs/real/.git` → `git -C "$TMP" config …` writes to `/abs/real/.git/config`. **Corrupts.**
- **Relative** `GIT_DIR=.git` → `-C "$TMP"` makes git resolve `.git` *under* `$TMP` → the temp repo. **Clean.**

The trigger is an environment that exports an **absolute** `GIT_DIR` (VS Code's Git integration, or a git-worktree context) — **not** the git hook machinery itself: a real `pre-push` hook receives `GIT_DIR` *unset*. Verified by reproduction against the actual script — corrupts a throwaway repo under absolute `GIT_DIR`, stays clean under relative.

## Solution

Clear inherited git env at the very top of the test, before the first `git`:

```bash
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null  # never read/write the user's real config
```

Add an end-of-run guard that proves the caller's repo is byte-for-byte untouched (defense-in-depth — fails loud in CI if a future edit reintroduces a leak):

```bash
CALLER_EMAIL_BEFORE=$(git config user.email 2>/dev/null || true)
CALLER_HEAD_BEFORE="$(git rev-parse HEAD 2>/dev/null||true)|$(git symbolic-ref --short HEAD 2>/dev/null||true)"
CALLER_STATUS_BEFORE=$(git status --porcelain 2>/dev/null || true)
# … run tests against the temp repo …
# assert each *_AFTER == *_BEFORE, else FAIL loudly
```

Protect the invocation point too — strip git env around the whole loop so every hook test is covered regardless of its own hygiene:

```bash
run env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_COMMON_DIR bash "$t"
```

## Prevention

- Any shell test that drives git in a temp repo must `unset GIT_DIR GIT_WORK_TREE …` first. Neither `git -C` nor `cd` protects you from an inherited `GIT_DIR`.
- Add a caller-untouched assertion (email + HEAD + porcelain) so a leak can never pass silently.
- Don't trust "it passes in CI" for isolation claims — CI runs with a clean env; this corruption only manifests where an absolute `GIT_DIR` is injected (VS Code terminal, worktrees).

## Extension (2026-08-28): the leak doesn't need an EXTERNAL source — a test's OWN export can leak into its OWN helpers

The original incident's trigger was an environment-inherited absolute `GIT_DIR` (VS Code, a
worktree) leaking into a test that never expected it. A second, distinct trigger surfaced
while extending `test-branch-preflight.sh` and `test-pr-preflight-guard.sh` with a fake
`origin` remote: the test **itself** deliberately `export`s `GIT_DIR`/`GIT_WORK_TREE`
pointing at its own primary fixture repo (`$REPO`), for the large majority of the file where
every git call should target that fixture — then, later in the SAME script, a helper function
(`advance_remote`/`advance_origin`) needs to create and mutate DIFFERENT repos (a bare
`origin`, a throwaway clone) to simulate work landing upstream. Every `git -C "$clone" ...`
call inside that helper silently ran against the fixture repo pointed to by the still-exported
`GIT_DIR`/`GIT_WORK_TREE`, not the clone — `git clone -q "$BAREORIGIN" "$clone"` failed with
"repository does not exist", and downstream commands failed in increasingly confusing ways,
because `-C` was being overridden exactly as this doc already describes, just by the test's
**own earlier line**, not by anything inherited from outside the process.

The "unset once at the top" solution in this doc's own Solution section does not cover this
case — the test *needs* `GIT_DIR`/`GIT_WORK_TREE` set for most of its duration, so unsetting
once at the top would break the tests those vars exist to enable. **The rule generalizes**:
`GIT_DIR`/`GIT_WORK_TREE`, however they got set — inherited from the launching environment OR
deliberately exported earlier in the same script — override `-C` for every subsequent `git`
call in that process, with no exception for "but I meant this one for a different repo."
Any git call inside a test-owned helper function that targets a DIFFERENT repo than the one
those vars currently point at needs its OWN `env -u GIT_DIR -u GIT_WORK_TREE` prefix, every
time, including calls that already use `-C` (which does nothing to protect against this).

## Related Files

- `.claude/hooks/test-branch-preflight.sh` — the fixed self-test (unset + caller-untouched guard); its `advance_remote` helper now prefixes every git call with `env -u GIT_DIR -u GIT_WORK_TREE`.
- `.claude/hooks/test-pr-preflight-guard.sh` — `advance_origin`, the same helper pattern for a second hook's hermetic fixture.
- `.claude/hooks/test-core-bare-guard.sh` — sibling test written hermetic from the start.
- `scripts/run-hook-tests.sh` — owns the five-var env-strip around the `.claude/hooks/test-*.sh` loop; called by both `scripts/preflight.sh` (full mode) and `.github/workflows/ci.yml`.
- `.claude/hooks/core-bare-guard.sh` — companion PreToolUse guard for the related `core.bare` flip symptom.
