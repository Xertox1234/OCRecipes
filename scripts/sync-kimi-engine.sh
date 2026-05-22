#!/usr/bin/env bash
# Sync the canonical kimi engine into the repo's vendored copy.
# Canonical lives outside the repo (cross-project home); this copies it in so CI
# can run it. The vendored kimi-profiles.json is hand-maintained (OCRecipes-only)
# and intentionally NOT overwritten here.
set -euo pipefail

CANON="${KIMI_ENGINE_CANONICAL:-$HOME/.local/share/claude-coworker/tools/kimi-review}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDORED="$REPO_ROOT/scripts/kimi-review.py"

if [ ! -f "$CANON" ]; then
  echo "Error: canonical engine not found at $CANON" >&2
  exit 1
fi

# Replace the coworker-venv shebang with a portable one for CI.
{
  echo '#!/usr/bin/env python3'
  tail -n +2 "$CANON"
} > "$VENDORED"

echo "Synced $CANON -> $VENDORED"
