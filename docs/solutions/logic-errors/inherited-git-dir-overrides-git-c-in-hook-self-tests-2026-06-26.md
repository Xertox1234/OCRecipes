---
title: 'Inherited absolute GIT_DIR overrides `git -C`, corrupting the real repo from a hook self-test'
track: bug
category: logic-errors
module: shared
severity: high
tags: [git, hooks, test-isolation, git-dir, hermetic-tests, tooling, worktree]
symptoms: ['A shell/git hook self-test silently mutates the REAL repo: bogus user.email/user.name in .git/config, a phantom staged file, or uncommitted tracked-file edits reverted (HEAD detached/switched)', 'Corruption reproduces only locally (under VS Code''s integrated terminal or a git worktree), never in CI', The test passes its own assertions while clobbering the caller's working tree]
applies_to: [.claude/hooks/test-*.sh, scripts/preflight.sh]
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

## Related Files

- `.claude/hooks/test-branch-preflight.sh` — the fixed self-test (unset + caller-untouched guard).
- `.claude/hooks/test-core-bare-guard.sh` — sibling test written hermetic from the start.
- `scripts/preflight.sh` — env-strip around the `test-*.sh` loop.
- `.claude/hooks/core-bare-guard.sh` — companion PreToolUse guard for the related `core.bare` flip symptom.
