import { useEffect } from "react";

import { onAiSharingRequired } from "@/lib/ai-sharing-events";
import { navigationRef } from "@/navigation/navigationRef";
import { openAiSharing } from "@/navigation/openAiSharing";
import { shouldReask } from "@/navigation/ai-sharing-gate-utils";

/**
 * Opens the AI-sharing question when the server refuses an AI request because
 * sharing is off (privacy audit H3) — one listener for every AI feature,
 * instead of a check on each screen.
 */
export function useAiSharingReask(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    return onAiSharingRequired(() => {
      if (!navigationRef.isReady()) return;
      if (!shouldReask(navigationRef.getCurrentRoute()?.name)) return;
      openAiSharing();
    });
  }, [enabled]);
}
