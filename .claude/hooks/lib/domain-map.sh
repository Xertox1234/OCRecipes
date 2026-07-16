#!/usr/bin/env bash
# GENERATED FILE — do not edit by hand.
# Regenerate with: npm run build:domain-map
# Source of truth: scripts/lib/path-domains.ts (rules-domains only; routing-only
# labels such as 'camera' are intentionally NOT emitted here).
#
# Shared path-to-domain mapping, currently consumed by inject-patterns.sh.
# Source this file — do NOT execute directly. (Consumer-agnostic: define your
# own _add() adapter before sourcing, so additional consumers can reuse it.)
#
# USAGE:
#   Define _add() as an adapter for your accumulator before sourcing, then call
#   apply_domain_map for each file path.
#
# DESIGN NOTES:
#   - Uses independent [[...]] blocks so multiple domains can match one file.
#   - Matches both absolute (leading wildcard) and relative paths so callers
#     that have either form don't need to normalise first.
#   - Typescript handling is intentionally EXCLUDED as a blanket .ts policy; each
#     consumer applies its own (inject-patterns adds typescript only when no
#     other domain matched). Per-rule typescript (config files, client/lib) is
#     part of the canonical mapping and IS emitted below.

apply_domain_map() {
  local f="$1"

  [[ "$f" == */server/routes/* || "$f" == server/routes/* ]] && { _add api; _add security; _add architecture; }
  [[ "$f" == */server/storage/* || "$f" == server/storage/* ]] && { _add database; _add security; _add architecture; }
  [[ "$f" == */shared/schema.ts || "$f" == shared/schema.ts ]] && { _add database; _add security; _add architecture; }
  [[ "$f" == */migrations/* || "$f" == migrations/* ]] && { _add database; _add security; _add architecture; }
  [[ "$f" == */server/middleware/* || "$f" == server/middleware/* ]] && { _add security; _add api; }
  [[ "$f" == */server/services/* || "$f" == server/services/* ]] && { _add architecture; }
  [[ "$f" == */client/screens/* || "$f" == client/screens/* ]] && { _add react-native; _add design-system; _add accessibility; }
  [[ "$f" == */client/components/* || "$f" == client/components/* ]] && { _add react-native; _add design-system; _add accessibility; _add performance; }
  [[ "$f" == */client/camera/* || "$f" == client/camera/* ]] && { _add react-native; }
  [[ "$f" == */client/camera/components/* || "$f" == client/camera/components/* ]] && { _add react-native; _add design-system; _add accessibility; _add performance; }
  [[ "$f" == */client/camera/hooks/* || "$f" == client/camera/hooks/* ]] && { _add hooks; _add client-state; _add react-native; _add accessibility; }
  [[ "$f" == */client/camera/reducers/* || "$f" == client/camera/reducers/* ]] && { _add client-state; }
  [[ "$f" == */client/navigation/* || "$f" == client/navigation/* ]] && { _add react-native; _add accessibility; }
  [[ "$f" == */client/hooks/* || "$f" == client/hooks/* ]] && { _add hooks; _add client-state; _add react-native; _add accessibility; }
  [[ "$f" == */client/context/* || "$f" == client/context/* ]] && { _add client-state; }
  [[ "$f" == */client/lib/* || "$f" == client/lib/* ]] && { _add typescript; _add client-state; }
  [[ "$f" == */client/constants/theme.ts || "$f" == client/constants/theme.ts ]] && { _add design-system; }
  [[ "$f" == */design_guidelines.md || "$f" == design_guidelines.md ]] && { _add design-system; }
  [[ "$f" == */evals/* || "$f" == evals/* ]] && { _add ai-prompting; _add testing; }
  [[ "$f" == */__tests__/* || "$f" == __tests__/* || "$f" == *.test.ts || "$f" == *.test.tsx || "$f" == *.spec.ts || "$f" == *.spec.tsx ]] && { _add testing; }
  [[ "$f" == */.github/workflows/* || "$f" == .github/workflows/* ]] && { _add architecture; _add testing; }
  [[ "$f" == */vitest.config.* || "$f" == vitest.config.* || "$f" == */eslint.config.* || "$f" == eslint.config.* ]] && { _add testing; _add typescript; }
  [[ "$f" == */server/services/canonical-enrichment.ts || "$f" == server/services/canonical-enrichment.ts || "$f" == */server/services/coach-pro-chat.ts || "$f" == server/services/coach-pro-chat.ts || "$f" == */server/services/coach-tools.ts || "$f" == server/services/coach-tools.ts || "$f" == */server/services/cooking-session.ts || "$f" == server/services/cooking-session.ts || "$f" == */server/services/food-nlp.ts || "$f" == server/services/food-nlp.ts || "$f" == */server/services/front-label-analysis.ts || "$f" == server/services/front-label-analysis.ts || "$f" == */server/services/image-art-direction.ts || "$f" == server/services/image-art-direction.ts || "$f" == */server/services/ingredient-substitution.ts || "$f" == server/services/ingredient-substitution.ts || "$f" == */server/services/meal-suggestions.ts || "$f" == server/services/meal-suggestions.ts || "$f" == */server/services/menu-analysis.ts || "$f" == server/services/menu-analysis.ts || "$f" == */server/services/notebook-extraction.ts || "$f" == server/services/notebook-extraction.ts || "$f" == */server/services/nutrition-coach.ts || "$f" == server/services/nutrition-coach.ts || "$f" == */server/services/pantry-meal-plan.ts || "$f" == server/services/pantry-meal-plan.ts || "$f" == */server/services/photo-analysis.ts || "$f" == server/services/photo-analysis.ts || "$f" == */server/services/receipt-analysis.ts || "$f" == server/services/receipt-analysis.ts || "$f" == */server/services/recipe-chat.ts || "$f" == server/services/recipe-chat.ts || "$f" == */server/services/recipe-generation.ts || "$f" == server/services/recipe-generation.ts || "$f" == */server/services/suggestion-generation.ts || "$f" == server/services/suggestion-generation.ts || "$f" == */server/services/voice-transcription.ts || "$f" == server/services/voice-transcription.ts ]] && { _add ai-prompting; }
}
