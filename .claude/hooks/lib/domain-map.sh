#!/usr/bin/env bash
# Shared path-to-domain mapping for inject-patterns, kimi-review, and pre-commit.
# Source this file — do NOT execute directly.
#
# USAGE:
#   Define _add() as an adapter for your accumulator before sourcing, then call
#   apply_domain_map for each file path:
#
#     _add() { add_domain "$1"; }        # inject-patterns.sh
#     _add() { add_pattern "$1"; }       # kimi-review.sh / pre-commit
#     source ".../lib/domain-map.sh"
#     apply_domain_map "$FILE_PATH"      # single file (inject-patterns)
#     while IFS= read -r f; do apply_domain_map "$f"; done <<< "$FILES"
#
# DESIGN NOTES:
#   - Uses independent [[...]] blocks so multiple domains can match one file.
#   - Matches both absolute (*/) and relative (no leading /) paths so callers
#     that have either form don't need to normalise first.
#   - Typescript handling is intentionally EXCLUDED. Each consumer applies its
#     own policy:
#       inject-patterns: adds typescript only when no other domain matched
#       kimi-review / pre-commit: adds typescript unconditionally for .ts/.tsx
#   - vitest.config.* and eslint.config.* map to testing+typescript here because
#     all three consumers share that policy.

apply_domain_map() {
  local f="$1"

  [[ "$f" == */server/routes/* || "$f" == server/routes/* ]] && \
    { _add api; _add security; _add architecture; }

  [[ "$f" == */server/storage/* || "$f" == server/storage/* || \
     "$f" == */shared/schema.ts  || "$f" == shared/schema.ts  || \
     "$f" == */migrations/*      || "$f" == migrations/* ]] && \
    { _add database; _add security; _add architecture; }

  [[ "$f" == */server/middleware/* || "$f" == server/middleware/* ]] && \
    { _add security; _add api; }

  [[ "$f" == */server/services/photo-analysis.ts    || \
     "$f" == */server/services/nutrition-coach.ts   || \
     "$f" == */server/services/recipe-chat.ts       || \
     "$f" == */server/services/recipe-generation.ts || \
     "$f" == server/services/photo-analysis.ts      || \
     "$f" == server/services/nutrition-coach.ts     || \
     "$f" == server/services/recipe-chat.ts         || \
     "$f" == server/services/recipe-generation.ts ]] && \
    _add ai-prompting

  [[ "$f" == */evals/* || "$f" == evals/* ]] && \
    { _add ai-prompting; _add testing; }

  # All server/services get architecture (including the AI ones above, deduped)
  [[ "$f" == */server/services/* || "$f" == server/services/* ]] && \
    _add architecture

  [[ "$f" == */client/screens/*    || "$f" == client/screens/*    || \
     "$f" == */client/components/* || "$f" == client/components/* ]] && \
    { _add react-native; _add design-system; _add accessibility; }

  [[ "$f" == */client/components/* || "$f" == client/components/* ]] && \
    _add performance

  # Navigation files: react-native + accessibility only (no design-system —
  # they define route configs, not UI components)
  [[ "$f" == */client/navigation/* || "$f" == client/navigation/* ]] && \
    { _add react-native; _add accessibility; }

  [[ "$f" == */client/hooks/* || "$f" == client/hooks/* ]] && \
    { _add hooks; _add client-state; _add react-native; _add accessibility; }

  [[ "$f" == */client/context/* || "$f" == client/context/* || \
     "$f" == */client/lib/*     || "$f" == client/lib/* ]] && \
    _add client-state

  [[ "$f" == */client/constants/theme.ts || "$f" == client/constants/theme.ts || \
     "$f" == */design_guidelines.md      || "$f" == design_guidelines.md ]] && \
    _add design-system

  [[ "$f" == */.github/workflows/* || "$f" == .github/workflows/* ]] && \
    { _add architecture; _add testing; }

  [[ "$f" == */vitest.config.* || "$f" == vitest.config.* || \
     "$f" == */eslint.config.* || "$f" == eslint.config.* ]] && \
    { _add testing; _add typescript; }

  # Test files accumulate testing regardless of enclosing directory
  [[ "$f" == */__tests__/* || "$f" == __tests__/* || \
     "$f" == *.test.ts     || "$f" == *.test.tsx  || \
     "$f" == *.spec.ts     || "$f" == *.spec.tsx ]] && \
    _add testing
}
