import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";

import { ErrorCode } from "@shared/constants/error-codes";
import { ApiError } from "@/lib/api-error";
import { useToast } from "@/context/ToastContext";
import { useHaptics } from "@/hooks/useHaptics";
import { usePlanCheck } from "@/hooks/usePlanCheck";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { dietaryProfileQueryOptions } from "@/hooks/useDietaryProfile";
import {
  familyProfilesQueryOptions,
  useSetFamilyPlanning,
} from "@/hooks/useFamily";
import { describeFamilyError } from "@/components/family-profile-utils";
import type { ProfileScreenNavigationProp } from "@/types/navigation";

/**
 * The Profile tab's "Plan for my family" switch and its "Family" link.
 *
 * - Hidden while the plan is unknown (owner ruling: an unknown plan is neutral).
 * - Free plan: the switch reads off and a press only calls `onLocked` (the
 *   upgrade prompt); nothing is sent.
 * - Premium: a press ticks, PUTs, and the switch follows the pending value
 *   until the server answers, so a failure puts it back on its own.
 * - The Family link follows the server's switch, not the plan: a lapsed user
 *   whose switch is still on must reach the list to delete profiles.
 */
export function useFamilySwitch({ onLocked }: { onLocked: () => void }) {
  const navigation = useNavigation<ProfileScreenNavigationProp>();
  const queryClient = useQueryClient();
  const haptics = useHaptics();
  const toast = useToast();
  const { planUnknown } = usePlanCheck();
  const premium = usePremiumFeature("familyProfiles");
  const { data: dietaryProfile } = useQuery(dietaryProfileQueryOptions);
  const mutation = useSetFamilyPlanning();

  const serverOn = dietaryProfile?.familyPlanningEnabled === true;
  const committed = premium && serverOn;
  const value = mutation.isPending ? (mutation.variables ?? false) : committed;

  const onToggle = (next: boolean) => {
    if (!premium) {
      onLocked();
      return;
    }
    if (mutation.isPending) return;
    haptics.selection();
    mutation.mutate(next, {
      onSuccess: () => {
        if (!next) return;
        // The list is only fetched while the switch is on, so ask once now:
        // someone turning this on for the first time has nobody to plan for.
        queryClient
          .fetchQuery({ ...familyProfilesQueryOptions, staleTime: 0 })
          .then((list) => {
            if (list.profiles.length === 0) {
              navigation.navigate("FamilyProfileEdit", {});
            }
          })
          .catch(() => {
            // The Family screen shows its own load error.
          });
      },
      onError: (err) => {
        // A stale plan: the server says no, so show the upgrade prompt.
        if (
          err instanceof ApiError &&
          err.code === ErrorCode.PREMIUM_REQUIRED
        ) {
          onLocked();
          return;
        }
        toast.error(describeFamilyError(err));
      },
    });
  };

  return {
    visible: !planUnknown,
    value,
    disabled: mutation.isPending,
    onToggle,
    showFamilyRow: !planUnknown && serverOn,
    onOpenProfiles: () => navigation.navigate("FamilyProfiles"),
  };
}
