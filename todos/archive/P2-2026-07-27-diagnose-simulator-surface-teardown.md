---
title: "Diagnose the iOS Simulator dev loop: RN surface teardown leaves a permanently frozen app"
status: done
priority: medium
created: 2026-07-27
updated: 2026-08-13
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

**Environment note — do not conflate this with the teardown.** `.env` had a stale `EXPO_PUBLIC_DOMAIN=http://192.168.0.145:3000` while the machine was on `192.168.0.103`. That is a **separate and already-understood** failure: `EXPO_PUBLIC_*` values are inlined at bundle time, so whenever the machine changes networks the baked-in LAN IP goes dead and screens hang on loading skeletons with no error. Diagnose with `ipconfig getifaddr en0` vs the `.env` line; fix the IP and restart Metro. During this incident it was worked around with a shell override (`EXPO_PUBLIC_DOMAIN=http://localhost:3000 npx expo start …`) rather than editing the user's `.env`, and the override was confirmed to have won by grepping the served bundle for the inlined `process.env` block.

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

### 2026-08-13 — closed as documented, root cause still NOT established

Closed at the user's direction under this todo's own Risks clause ("treat documented signature +
reliable recovery as a legitimate completion"). **No reproduction was attempted.** The simulator,
Metro, and the backend were never started.

Landed:

- `docs/solutions/best-practices/frozen-simulator-is-a-torn-down-rn-surface-2026-08-13.md` — the
  signature, the stale-a11y-tree trap, the two-capture cross-check, the `md5` frozen-vs-loading
  test, and the known-good recovery. Tagged to route to the `harness` domain so it injects when
  the `verify-ui` skill is edited.
- `.claude/skills/verify-ui/SKILL.md` — Step 4 corrected in place (its old advice, "if the first
  snapshot comes back empty, call it once more", implied a _populated_ tree is trustworthy, which
  is precisely the trap), plus a new `## Troubleshooting` section.

Why the leading hypothesis was not tested: the JS/native mismatch it names existed **only** between
PR #724 (2026-07-26, exact-pinned VisionCamera 5.0.11) and PR #729 (2026-07-29, landed 5.1.1). The
incident falls inside that window. `main` is now uniformly 5.1.1 across `package.json`, the
lockfile, `node_modules`, `ios/Podfile.lock`, and `patches/react-native-vision-camera+5.1.1.patch`,
and `feat/visioncamera-511-mlkit-9` is deleted locally and on origin. Reproducing the mismatch would
mean fabricating it, so it is **set aside, not falsified**.

Acceptance criteria status:

- AC1 (reproduce the teardown) — **not attempted**, by decision.
- AC2 (determine the trigger) — **unresolved**. Documented as a suspected-but-unverified trigger: a
  reload issued while Metro was down or mid-`--clear` restart, tearing down the surface with nothing
  arriving to rebuild it. The 3-minute gap between the destructors and `Couldn't connect to
packager` is the supporting evidence. Confirm by killing the packager with the app attached,
  triggering a reload, and checking the log.
- AC3 (why the recovered app hung on its spinner) — **unresolved**, and not answerable from
  archaeology: the 2026-07-27 logs are gone, so it needs the recovery path re-run. Leading benign
  explanation (first bundle build after `--clear` is genuinely slow) is recorded as untested.
- AC4 (document the signature + recovery) — **done**, in both files above.
- AC5 (reach the Cookbook create screen) — **not attempted**. Noted for whoever picks this up:
  `CookbookCreate` is registered in `client/navigation/MealPlanStackNavigator.tsx` but is **absent
  from `client/navigation/linking.ts`**, so it has no deep link — reaching it needs tap-through
  (Plan → Cookbooks → New), which requires the `ui-automation` XcodeBuildMCP workflow plus a demo
  login, and therefore the backend on `:3000`.

Both open questions are recorded in the solution doc's `Exceptions` section rather than left in a
todo, so they surface at the moment someone hits this again.
