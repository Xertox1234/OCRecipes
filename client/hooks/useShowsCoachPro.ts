import { usePremiumContext } from "@/context/PremiumContext";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { showsCoachPro } from "@/navigation/coachConversationRoute";

/**
 * Whether Coach routes go to CoachPro for the current user: Coach Pro, or a
 * plan that is not known yet (see showsCoachPro).
 */
export function useShowsCoachPro(): boolean {
  const { isPremiumResolved } = usePremiumContext();
  const isCoachPro = usePremiumFeature("coachPro");
  return showsCoachPro(isCoachPro, isPremiumResolved);
}
