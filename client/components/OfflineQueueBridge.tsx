import { useEffect } from "react";
import { subscribeToQueueDrainErrors } from "@/lib/offline-queue-drain";
import { useToast } from "@/context/ToastContext";

export function OfflineQueueBridge(): null {
  const toast = useToast();

  useEffect(() => {
    return subscribeToQueueDrainErrors((message) => {
      toast.error(message);
    });
  }, [toast]);

  return null;
}
