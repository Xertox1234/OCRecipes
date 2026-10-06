import { useEffect } from "react";
import { subscribeToQueueDrainErrors } from "@/lib/offline-queue-drain";
import { useToast } from "@/context/ToastContext";

export function OfflineQueueBridge(): null {
  const toast = useToast();

  useEffect(() => {
    return subscribeToQueueDrainErrors((message) => {
      // Background replay failure, not a reply to a tap — no haptic.
      toast.error(message, { haptic: false });
    });
  }, [toast]);

  return null;
}
