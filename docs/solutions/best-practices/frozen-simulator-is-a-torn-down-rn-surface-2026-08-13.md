---
title: A frozen iOS Simulator is usually a torn-down RN surface, not a hang
track: knowledge
category: best-practices
module: client
tags: [ios-simulator, verify-ui, xcodebuildmcp, metro, expo-dev-client, react-native, fabric, debugging, tooling]
applies_to: [.claude/skills/verify-ui/**]
symptoms: [app shows only the native launch image indefinitely, snapshot_ui returns a full but stale accessibility tree, taps appear to succeed but nothing renders, process is alive but nothing draws, no redbox and no crash report]
created: '2026-08-13'
---

# A frozen iOS Simulator is usually a torn-down RN surface, not a hang

## When this applies

You are verifying an iOS screen in the Simulator (typically via the `verify-ui` skill) against a
debug build attached to Metro. The app stops rendering: every screenshot shows the **native launch
image**, indefinitely. The process is still alive — `launchctl list` still lists it and a relaunch
attempt does not cold-start it — so it reads as "frozen" rather than "crashed".

This gets its own entry because **the symptoms actively mislead**. The accessibility tree keeps
answering, and it keeps answering *correctly for a screen that is no longer on screen*.

## Smell patterns

- `screenshot` returns the launch image, but `snapshot_ui` returns a **full, populated** tree
  (hundreds of elements) describing a plausible screen.
- A `tap` against that tree appears to work — `screenHash` changes — yet the next screenshot is
  still the launch image.
- No redbox, no crash report, no Metro error, no `Unable to resolve module`. Nothing in any of the
  usual places.
- It began after a Metro restart (especially `--clear`), a dev-client reconnect, or a reload issued
  while the packager was down.

## Why

**The Fabric surface was destroyed and never rebuilt.** The evidence exists in exactly one place —
the app runtime log, whose path XcodeBuildMCP's `launch_app_sim` returns as `runtimeLogPath`:

```
19:26:11  W Scheduler::~Scheduler() was called
19:26:11  W UIManagerBinding::~UIManagerBinding() was called
19:26:11  W UIManager::~UIManager() was called
19:29:32  W Couldn't connect to packager, will silently retry
```

Those are **destructors**. Tearing the surface down is the first half of a reload; the second half
— building a new surface from a fresh bundle — never happened. The host process survives with no
renderer attached, which is why it neither crashes nor draws.

**The accessibility tree can outlive the surface.** `snapshot_ui` served a tree cached from before
the teardown, so it described the last screen that rendered — 225 elements of a Home screen that
was no longer there. That is also why the tap "worked": the targeting layer resolved against stale
coordinates. **Treat the screenshot as ground truth and the a11y tree as a cache**, and cross-check
with a second capture path before trusting either.

**Suspected trigger — UNVERIFIED.** The three-minute gap between the destructors and `Couldn't
connect to packager` fits *a reload issued while Metro was down or mid-`--clear` restart*: the
surface is torn down, then nothing arrives to replace it. This has never been reproduced
deliberately. A competing hypothesis from the original incident — a JS/native version mismatch
(`node_modules` at VisionCamera 5.1.1 against a branch pinning 5.0.11) — was neither confirmed nor
ruled out, and can no longer be tested in place because `main` has since converged on 5.1.1. To
confirm either, kill the packager with the app attached, trigger a reload, and check the log for
the destructors. Until someone does, the recovery below is reliable but the cause is **not
established**.

## Examples

**Read the runtime log — the only place the failure is visible:**

```bash
grep -nE 'Scheduler::~Scheduler|UIManagerBinding::~UIManagerBinding|UIManager::~UIManager|connect to packager' "<runtimeLogPath>"
```

`runtimeLogPath` comes back in the `launch_app_sim` result. Note it every launch — you cannot
recover it retroactively for a process that was started some other way.

**Confirm the screenshot, not the tree, is telling the truth** — use a second, independent capture
path rather than re-asking the tool that already answered:

```bash
xcrun simctl io booted screenshot /tmp/shot-a.png
```

If this agrees with `mcp__XcodeBuildMCP__screenshot` and both show the launch image while
`snapshot_ui` shows a populated screen, the tree is stale.

**Frozen vs. merely still loading** — a spinner animates, a dead surface does not:

```bash
xcrun simctl io booted screenshot /tmp/s1.png; sleep 2; xcrun simctl io booted screenshot /tmp/s2.png
md5 -q /tmp/s1.png /tmp/s2.png
```

Identical hashes = nothing is animating (frozen). Differing = the render loop is live, so you are
looking at a slow load, not a teardown.

**Known-good recovery** (unblocks the session; does not address the cause):

1. Restart Metro.
2. `xcrun simctl terminate booted com.williamtower.ocrecipes`
3. `mcp__XcodeBuildMCP__launch_app_sim` — reconnect the dev client to Metro if it lands on the
   launcher.
4. Confirm the **new** `runtimeLogPath` has **zero** `~Scheduler` / `~UIManager` lines. A surviving
   destructor line means you are reading the old log, or the teardown recurred.

## Exceptions

- **Not every stuck screen is a teardown.** If the log has no destructors, suspect
  `EXPO_PUBLIC_DOMAIN` instead. `EXPO_PUBLIC_*` values are inlined at **bundle** time, so a LAN IP
  that went stale when the machine changed networks keeps pointing at a dead host until Metro is
  restarted — screens then hang on loading skeletons with no error at all. Compare
  `ipconfig getifaddr en0` against the `.env` line, and confirm what actually reached the bundle
  rather than assuming a shell override won:
  `curl "http://localhost:8081/index.bundle?platform=ios&dev=true" | grep -o '.\{110\}localhost:3000.\{60\}'`
  A hit on the long `process.env=Object.defineProperties(...)` line is the inlined value — the
  domain the app will actually use. No output means `localhost:3000` is not inlined — either the
  override did not win, or curl never reached Metro (its connection error prints separately, so
  check for that first). The interval is
  pinned at `.\{110\}` on purpose: `getApiBaseUrl()`'s short fallback literals mention the same
  host in **every** bundle regardless of the active domain, so loosening it to `.\{0,110\}` matches
  those too and the check stops discriminating.
- **Open question — the post-recovery spinner.** In the original incident the recovered app rendered
  but then sat on its loading spinner and never reached Home, despite a reachable backend. The
  mundane explanation is that the first bundle build after `--clear` is genuinely slow; that was
  **never tested**. Run the `md5` test above before concluding there is a second defect.
- **Environment-specific.** Observed once, on iOS 26.5 / iPhone 17 against a locally built
  dev-client binary. The signature and the recovery are the durable parts; the trigger may not
  generalise.
- **Cheaper escape hatch.** For a pure client-UI change, publishing to the `preview` EAS channel and
  checking on a physical device tests against the live backend and bypasses Metro, `.env`, and the
  LAN IP entirely. Do not let simulator debugging become a prerequisite for shipping UI work.

## Related Files

- `.claude/skills/verify-ui/SKILL.md` — its `## Troubleshooting` section carries the short form of
  this signature plus the recovery
- `client/navigation/linking.ts` — the deep-link table; a deep-linkable target avoids needing a
  trustworthy a11y tree to navigate at all

## See Also

- `docs/solutions/best-practices/xcodebuildmcp-ui-automation-enable-stale-server-recovery-2026-06-23.md`
  — a different stale-thing failure in the same loop: the MCP server rather than the app
- `docs/solutions/logic-errors/two-features-reverting-at-once-implicates-one-stale-process-2026-07-28.md`
  — the backend analogue, where one stale process presented as several lost fixes
</content>
