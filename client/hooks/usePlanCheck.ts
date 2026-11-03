import { useCallback } from "react";

import { usePremiumContext } from "@/context/PremiumContext";
import { useToast } from "@/context/ToastContext";

export const PLAN_CHECKING_MESSAGE =
  "Checking your plan. Try again in a moment.";

/**
 * While the subscription status is loading or failed, PremiumContext's
 * features fall back to the free tier — so a premium-gated control would wall
 * a user who may be paying. Owner ruling 2026-11-02: an unknown plan is
 * neutral. Show no lock or upsell while `planUnknown`; a tap that would spend
 * a premium feature calls `recheckPlan()` instead.
 *
 * Its own file (not usePremiumFeatures.ts) because tests mock that module
 * wholesale.
 */
export function usePlanCheck(): {
  planUnknown: boolean;
  recheckPlan: () => void;
} {
  const { isPremiumResolved, refreshSubscription } = usePremiumContext();
  const toast = useToast();

  const recheckPlan = useCallback(() => {
    void refreshSubscription();
    toast.info(PLAN_CHECKING_MESSAGE);
  }, [refreshSubscription, toast]);

  return { planUnknown: !isPremiumResolved, recheckPlan };
}
