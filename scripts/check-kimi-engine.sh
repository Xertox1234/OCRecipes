#!/usr/bin/env bash
# Drift check: vendored scripts/kimi-review.py must match the canonical engine
# (modulo the shebang line). Skips silently when the canonical is absent (CI,
# other machines); enforces when present (developer machines).
set -euo pipefail

CANON="${KIMI_ENGINE_CANONICAL:-$HOME/.local/share/claude-coworker/tools/kimi-review}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDORED="$REPO_ROOT/scripts/kimi-review.py"

if [ ! -f "$CANON" ]; then
  echo "[kimi:engine:check] canonical engine absent — skipping drift check."
  exit 0
fi

if diff <(tail -n +2 "$CANON") <(tail -n +2 "$VENDORED") >/dev/null 2>&1; then
  echo "[kimi:engine:check] vendored scripts/kimi-review.py matches canonical."
  exit 0
fi

echo "[kimi:engine:check] scripts/kimi-review.py is STALE vs canonical." >&2
echo "Run 'npm run kimi:engine:sync' and commit the result." >&2
exit 1
