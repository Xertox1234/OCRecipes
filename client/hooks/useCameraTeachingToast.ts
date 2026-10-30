import { useCallback } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useToast } from "@/context/ToastContext";
import { useCanScanToday } from "@/hooks/usePremiumFeatures";
import { claimTipSlot, releaseTipSlot } from "@/hooks/useFeatureTip";
import {
  hasSeenTip,
  hasUsedFeature,
  incrementTypedLogCount,
  markTipSeen,
} from "@/lib/feature-tips-storage";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

/** The typed log after which the camera is suggested (spec S1). */
const TYPED_LOGS_BEFORE_TIP = 3;

/**
 * Returns a callback for a successful (or offline-queued) Quick Log. After the
 * person's third food logged by typing, suggests the camera once — unless they
 * already use it, have no scans left today, or another tip is on screen.
 */
export function useCameraTeachingToast(): (
  items: readonly { sourceType?: string }[],
) => Promise<void> {
  const toast = useToast();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { canScan } = useCanScanToday();

  return useCallback(
    async (items) => {
      if (items.length === 0 || !items.every((i) => i.sourceType === "text")) {
        return;
      }
      const count = await incrementTypedLogCount();
      if (count < TYPED_LOGS_BEFORE_TIP || !canScan) return;
      if (hasUsedFeature("scan") || hasSeenTip("toast-camera")) return;
      if (!claimTipSlot("toast-camera")) return;
      void markTipSeen("toast-camera");
      toast.info("Logging is faster with the camera", {
        action: { label: "Try it", onPress: () => navigation.navigate("Scan") },
      });
      // The toast manages its own lifetime; the slot only guards the moment
      // of choosing, so a tooltip can't appear in the same instant.
      releaseTipSlot("toast-camera");
    },
    [canScan, navigation, toast],
  );
}
