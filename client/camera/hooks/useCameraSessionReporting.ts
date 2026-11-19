import { useCallback, useRef } from "react";

import { logger } from "@/lib/logger";

interface UseCameraSessionReportingOptions {
  /**
   * An error that is routine on this platform (e.g. CameraX cancelling a
   * control call that raced session start). It is warned about once and
   * leaves the error latch for a real failure.
   */
  isBenignError?: (error: unknown) => boolean;
}

/** Backgrounding the app mid-scan fires this; it is routine, not a failure. */
const ROUTINE_INTERRUPTION = "video-device-not-available-in-background";

/**
 * The `<Camera>` session callbacks both platform views share, reporting to
 * error tracking without flooding it:
 * - the first camera error per mount;
 * - each interruption reason once (a shared latch would let the first, often
 *   routine, reason hide a later diagnostic one), and exactly one end report
 *   per reported start — a background interruption arriving mid-episode
 *   doesn't swallow it.
 */
export function useCameraSessionReporting({
  isBenignError,
}: UseCameraSessionReportingOptions = {}) {
  const cameraErrorReportedRef = useRef(false);
  const benignWarnedRef = useRef(false);
  const reportedInterruptionReasonsRef = useRef(new Set<string>());
  const awaitingInterruptionEndRef = useRef(false);

  const onError = useCallback(
    (error: unknown) => {
      if (isBenignError?.(error)) {
        if (!benignWarnedRef.current) {
          benignWarnedRef.current = true;
          logger.warn("[CameraView] Camera control cancelled", error);
        }
        return;
      }
      if (cameraErrorReportedRef.current) return;
      cameraErrorReportedRef.current = true;
      logger.error("[CameraView] Camera error", error);
    },
    [isBenignError],
  );

  const onInterruptionStarted = useCallback((reason: string) => {
    if (reason === ROUTINE_INTERRUPTION) return;
    const reported = reportedInterruptionReasonsRef.current;
    if (reported.has(reason)) return;
    reported.add(reason);
    awaitingInterruptionEndRef.current = true;
    logger.error(`[CameraView] Camera session interrupted (${reason})`);
  }, []);

  const onInterruptionEnded = useCallback(() => {
    if (!awaitingInterruptionEndRef.current) return;
    awaitingInterruptionEndRef.current = false;
    logger.error("[CameraView] Camera session interruption ended");
  }, []);

  return { onError, onInterruptionStarted, onInterruptionEnded };
}
