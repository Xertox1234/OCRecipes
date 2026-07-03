---
title: Enabling XcodeBuildMCP UI-automation tools and recovering from a stale MCP server
track: knowledge
category: best-practices
module: client
tags: [xcodebuildmcp, ios-simulator, ui-automation, mcp, axe, verify-ui, tooling]
applies_to: [.claude/skills/verify-ui/**, .xcodebuildmcp/**]
created: '2026-06-23'
---

# Enabling XcodeBuildMCP UI-automation tools and recovering from a stale MCP server

## When this applies

You are driving the iOS Simulator through **XcodeBuildMCP** (e.g. the `verify-ui` skill) and the
interaction tools — `tap`, `type_text`, `swipe`, `gesture`, `button` — are missing: a
`ToolSearch("select:mcp__XcodeBuildMCP__tap")` returns nothing, even though `screenshot`,
`snapshot_ui`, `launch_app_sim`, and the `session_*` tools are present.

## Smell patterns

- `snapshot_ui`'s `nextSteps` reference `tap(...)`/`batch(...)`, but those tools are absent from
  the deferred-tool list and from `ToolSearch`.
- You added/edited `.xcodebuildmcp/config.yaml` and **restarted Claude**, yet `tap` still does not
  appear.
- An auth-gated screen can't be verified because you can't log in (no `tap`/`type_text`), and a
  SpringBoard system modal can't be dismissed.

## Why

1. **UI-automation tools are off by default.** XcodeBuildMCP enables only the `simulator` workflow
   out of the box. The interaction tools live in the separate `ui-automation` workflow, which must
   be turned on explicitly. The backend (`axe`) is bundled with the package — no separate install.

2. **A running `xcodebuildmcp mcp` server persists across Claude restarts.** The server logs
   `MCP idle shutdown disabled` and stays alive. After you write the config, a Claude restart often
   **reconnects to the still-running pre-config server**, which registered its tool set *before* the
   config existed — so `ui-automation` never loads. A freshly spawned server reads the config and
   logs `Registered N tools from workflows: session-management, simulator, ui-automation`. The
   tool list the client exposes is negotiated at connect time, so the new tools only surface once a
   genuinely fresh server process is connected.

3. **The interaction engine is a bundled CLI you can call directly.** The MCP `tap`/`type` tools
   are thin wrappers over the bundled `axe` binary. When the MCP wrapper is stale, `axe` itself is
   not — it gives a zero-restart fallback. Capture (`screenshot`, `snapshot_ui`) keeps working
   through MCP the whole time.

## Examples

**Enable the workflow** (gitignore it locally — it's machine-specific dev tooling; e.g. add
`.xcodebuildmcp/` to `.git/info/exclude`):

```yaml
# .xcodebuildmcp/config.yaml
enabledWorkflows:
  - simulator
  - ui-automation
```

**Verify a fresh server actually registers the tools** (independent of the live session):

```bash
npx -y xcodebuildmcp@latest mcp --help 2>&1 | grep "Registered"
# → Registered 36 tools from workflows: session-management, simulator, ui-automation
```

**If the live session still lacks `tap` after a restart**, the connected server is stale. Either
fully quit Claude (not a window reload) so no old process is reused, or identify and kill the stale
server. It is the process whose cwd is this repo and whose pid matches the `ownerpid` in a recent
`launch_app_sim` log:

```bash
pgrep -fl 'xcodebuildmcp .* mcp'                       # list servers
lsof -a -p <pid> -d cwd -Fn | sed -n 's/^n//p'         # confirm cwd == this repo
```

**Zero-restart fallback — drive the UI with the bundled `axe` directly** (same engine the MCP
`tap` wraps); keep using MCP `screenshot`/`snapshot_ui` to capture/assert:

```bash
AXE=~/.npm/_npx/*/node_modules/xcodebuildmcp/bundled/axe   # bundled binary
UDID=<booted-sim-udid>
"$AXE" describe-ui --udid "$UDID"                          # full a11y tree incl. SpringBoard
"$AXE" tap   --label "Not Now"        --udid "$UDID"        # dismiss a SpringBoard modal
"$AXE" tap   --id input-username      --udid "$UDID"; "$AXE" type "demo"    --udid "$UDID"
"$AXE" tap   --id input-password      --udid "$UDID"; "$AXE" type "demo123" --udid "$UDID"
"$AXE" tap   --label "Sign In"        --udid "$UDID"
```

`axe tap` targets by `-x/-y`, `--id` (accessibilityIdentifier), `--label` (AXLabel), or `--value`.

## Exceptions

- **System modal blindness:** while a SpringBoard alert (e.g. an Apple-ID re-verify prompt) is up,
  `snapshot_ui` returns only the modal's elements — the app is inert/hidden from accessibility. The
  modal is independent of app auth and survives cold launch; dismiss it before capturing. `axe
  describe-ui` (unlike MCP `snapshot_ui`) does see the modal's buttons, so it can target the
  dismiss button even when the MCP snapshot is blind.
- **expo-dev-client launches to the launcher, not the app.** Connect it to Metro first:
  `xcrun simctl openurl booted "ocrecipes://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"`,
  then wait for the JS bundle to build before navigating.
- The fallback proves the *capability*; the MCP `tap` *wrapper* still needs a fresh server before
  the `verify-ui` skill runs end-to-end through MCP with no Bash.

## Related Files

- `.claude/skills/verify-ui/SKILL.md` — the skill that consumes these tools (its Prerequisites
  section summarizes the off-by-default requirement)
- `.xcodebuildmcp/config.yaml` — local, gitignored workflow config
- `~/.claude.json` → `mcpServers.XcodeBuildMCP` — the server launch entry (`npx xcodebuildmcp mcp`)

## See Also

- XcodeBuildMCP configuration docs: https://xcodebuildmcp.com/docs/configuration
