---
title: "Diagnose the iOS Simulator dev loop: RN surface teardown leaves a permanently frozen app"
status: backlog
priority: medium
created: 2026-07-27
updated: 2026-07-27
assignee:
labels: [deferred, tooling, react-native]
github_issue:
---

# Diagnose the iOS Simulator dev loop: RN surface teardown leaves a permanently frozen app

## Summary

A fast-refresh reload in the iOS Simulator can destroy the React Native Fabric surface without rebuilding one, leaving the app showing the native launch image forever while the process stays alive. This made in-session visual verification impossible on 2026-07-27 and cost roughly an hour before the work was rerouted to a physical device.

## Background

While verifying the floating-label fix (PR #730), the simulator app became unusable. The failure is worth diagnosing because the **symptoms actively mislead**:

- Screenshots showed only the native launch image, indefinitely.
- `snapshot_ui` simultaneously returned a **full, populated accessibility tree** (225 elements, Home screen), and a tap against it appeared to navigate (`screenHash` changed). That tree was **stale** — cached from before the teardown.
- Two independent capture paths (XcodeBuildMCP `screenshot` and `xcrun simctl io booted screenshot`) agreed on the launch image, which is what finally established the screenshots were truthful and the a11y tree was not.

The app runtime log (XcodeBuildMCP `runtimeLogPath`) held the decisive evidence:

```
19:26:11  W Scheduler::~Scheduler() was called
19:26:11  W UIManagerBinding::~UIManagerBinding() was called
19:26:11  W UIManager::~UIManager() was called
19:29:32  W Couldn't connect to packager, will silently retry
```

Those are **destructors**: the Fabric surface was torn down and never rebuilt. The process stayed alive (`launchctl list` still showed it), so it read as "frozen" rather than "crashed".

A restart of Metro plus `simctl terminate` + relaunch recovered rendering — the new process log had **zero** teardown lines. But the app then sat on its loading spinner and never reached Home, which was not diagnosed.

This todo is diagnosis, not a known fix.

## Acceptance Criteria

- [ ] Reproduce the surface teardown deliberately (edit a client file with the app running and Metro attached) and confirm the `~Scheduler` / `~UIManager` log signature
- [ ] Determine whether the trigger is the `node_modules`/branch version mismatch (leading hypothesis below), the `--clear` Metro restart, an `expo-dev-client` reload path, or something else
- [ ] Determine why the recovered app then hangs on the loading spinner despite the bundle inlining a reachable `EXPO_PUBLIC_DOMAIN` and the backend answering `/api/health` with 200
- [ ] Either land a fix, or document a reliable recovery procedure and add the failure signature to the `verify-ui` skill so a future session recognises it in minutes instead of an hour
- [ ] Confirm the resulting dev loop can reach the Cookbook create screen and produce a usable screenshot

## Implementation Notes

**Leading hypothesis — JS/native version mismatch.** During the incident, `node_modules` held `react-native-vision-camera@5.1.1` (left over from the blocked `feat/visioncamera-511-mlkit-9` branch) while the checked-out branch pinned **5.0.11**, and the installed simulator binary was built from a third, unknown commit. A native module whose JS and native halves disagree is a plausible cause of a surface that tears down and cannot re-create. Test by running `npm ci` to resync, rebuilding the app natively, and retrying the edit-and-reload cycle.

Note this is expensive to test: `npm ci` replaces whatever the current branch needs, and a native rebuild is several minutes. Do it in a dedicated worktree if the main checkout's `node_modules` is in use.

**Diagnostic techniques that worked — reuse these:**

- **Frozen vs. loading:** capture two screenshots ~2s apart and compare `md5`. Identical = not animating; differing = render loop is live. This is what proved recovery had actually worked.
- **Trust the screenshot over the a11y tree.** Cross-check with a second capture path before believing either.
- **Read `runtimeLogPath`**, returned by `launch_app_sim`. The teardown is invisible everywhere else — no redbox, no crash report, no Metro error.
- **Confirm which domain is really in the bundle** rather than assuming the shell override won: `curl "http://localhost:8081/index.bundle?platform=ios&dev=true" | grep -o '.\{110\}localhost:3000.\{60\}'` shows the inlined `process.env` block.

**Known-good recovery (unblocks a session, does not fix the cause):** restart Metro → `xcrun simctl terminate booted com.williamtower.ocrecipes` → `launch_app_sim` → verify the new log has zero `~Scheduler`/`~UIManager` lines.

**Environment note.** `.env` had a stale `EXPO_PUBLIC_DOMAIN=http://192.168.0.145:3000` while the machine was on `192.168.0.103`. That is a **separate**, already-known issue ([[reference_sim_dev_loop_gotchas]] item 1) and was worked around with a shell override — do not conflate it with the teardown.

**Cheaper alternative to keep in mind.** For a pure client-UI change, publishing to the `preview` EAS channel and checking on a physical device tests against the LIVE backend and bypasses Metro, `.env`, and the LAN IP entirely. That is how PR #730 was ultimately verified. This todo should not turn into a prerequisite for shipping UI work.

## Scope Contract

- **Mechanisms to use:** existing tooling only — XcodeBuildMCP, `xcrun simctl`, Metro, `npm ci`. No new scripts or harness abstractions.
- **Files in scope:** `.claude/skills/verify-ui/SKILL.md` (documenting the signature), `docs/solutions/**` (if a codifiable root cause emerges). Touch `package.json` / `node_modules` only to test the version-mismatch hypothesis.
- No changes to client runtime code unless the root cause is genuinely in it.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None blocking. Independent of the Cookbook/TextInput work (PRs #730, #731 — both landed).

## Risks

- **May not reproduce.** The teardown happened during an unusual sequence (Metro restart with `--clear`, dev-client reconnect, several relaunches). If it can't be reproduced deliberately, prefer documenting the signature and recovery over open-ended investigation.
- **Environment-specific.** Tied to this machine's iOS 26.5 / iPhone 17 simulator and a possibly stale locally-built binary; may not generalise.
- **Time sink risk.** This already consumed most of one session. Timebox it, and treat "documented signature + reliable recovery" as a legitimate completion, not a consolation prize.

## Updates

### 2026-07-27

- Initial creation, filed at the user's request after the incident during PR #730 verification.
- Evidence captured above from the live session; recovery confirmed working, root cause NOT established.
