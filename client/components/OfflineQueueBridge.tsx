import { useEffect } from "react";
import { subscribeToQueueDrainErrors } from "@/lib/offline-queue-drain";
import { subscribeToQueueEvictions } from "@/lib/offline-queue";
import { useToast } from "@/context/ToastContext";

function evictionMessage(count: number): string {
  return count === 1
    ? "An offline item couldn't be synced in time and was discarded."
    : `${count} offline items couldn't be synced in time and were discarded.`;
}

export function OfflineQueueBridge(): null {
  const toast = useToast();

  useEffect(() => {
    // Background replay failure, not a reply to a tap — no haptic.
    const offDrain = subscribeToQueueDrainErrors((message) => {
      toast.error(message, { haptic: false });
    });
    // Queued writes dropped unsynced by the depth cap or the TTL (R18).
    const offEvictions = subscribeToQueueEvictions((count) => {
      toast.error(evictionMessage(count), { haptic: false });
    });
    return () => {
      offDrain();
      offEvictions();
    };
  }, [toast]);

  return null;
}
