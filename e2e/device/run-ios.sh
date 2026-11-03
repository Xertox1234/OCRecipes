#!/bin/bash
# Run the read-only device flows on a physical iPhone with maestro-runner.
#
#   bash e2e/device/run-ios.sh                      # every flow in e2e/device/flows
#   bash e2e/device/run-ios.sh e2e/device/flows/open-recipe.yaml
#
# Needs: the U34Bolt drive mounted (maestro-runner lives there), the iPhone
# unlocked, on the same Wi-Fi as the Mac (or cabled), signed in to the app.
# See e2e/device/README.md.
set -euo pipefail

DRIVE=/Volumes/U34Bolt
RUNNER="$DRIVE/OCRecipes/tools/maestro-runner/node_modules/.bin/maestro-runner"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

# Mount check: never `[ -d ]` — a missing mount point can still exist as a folder.
if [ "$(df -P "$DRIVE" 2>/dev/null | awk 'NR==2{print $6}')" != "$DRIVE" ]; then
  echo "U34Bolt is not mounted; maestro-runner lives there. Plug it in." >&2
  exit 1
fi
[ -x "$RUNNER" ] || { echo "maestro-runner not found at $RUNNER" >&2; exit 1; }

# The iPhone's UDID, found over usbmux (USB first, then Wi-Fi), so no device
# id is committed to this public repo. IOS_DEVICE overrides.
DEVICE="${IOS_DEVICE:-}"
if [ -z "$DEVICE" ]; then
  # Checked first: under set -e/pipefail a missing idevice_id would end the
  # script silently inside the $(…) below.
  command -v idevice_id >/dev/null ||
    { echo "idevice_id not found (brew install libimobiledevice)" >&2; exit 1; }
  DEVICE="$(idevice_id -l 2>/dev/null | head -1 || true)"
  [ -n "$DEVICE" ] || DEVICE="$(idevice_id -n 2>/dev/null | head -1 || true)"
fi
if [ -z "$DEVICE" ]; then
  echo "No iPhone visible over usbmux. Unlock it and join the Mac's Wi-Fi;" >&2
  echo "first time only: cable it, Finder → iPhone → General → 'Show this iPhone when on Wi-Fi'." >&2
  exit 1
fi

# The Apple team that signs maestro-runner's on-device helper (public in app.json).
TEAM_ID="$(node -e 'console.log(require(process.argv[1]).expo.ios.appleTeamId)' "$REPO/app.json")"

OUT="$DRIVE/OCRecipes/tmp/maestro-runs/device-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"

if [ "$#" -gt 0 ]; then FLOWS=("$@"); else FLOWS=("$REPO/e2e/device/flows"); fi

# maestro-runner sends telemetry by default; keep it off. `|| status=$?`
# keeps set -e from exiting on a failed run before the report path prints —
# a failed run is when it is needed most.
status=0
MAESTRO_RUNNER_NO_TELEMETRY=1 DO_NOT_TRACK=1 \
  "$RUNNER" --platform ios --device "$DEVICE" --team-id "$TEAM_ID" \
  test --output "$OUT" "${FLOWS[@]}" || status=$?
echo "Report: $OUT"
exit $status
