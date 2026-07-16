export function evaluateSwipeThresholdCrossing(
  translationValue: number,
  threshold: number,
  direction: "left" | "right",
  alreadyFired: boolean,
): { shouldFireHaptic: boolean; nextFired: boolean } {
  "worklet";
  const crossed =
    direction === "right"
      ? translationValue >= threshold
      : translationValue <= -threshold;

  if (!crossed) {
    return { shouldFireHaptic: false, nextFired: false };
  }
  return { shouldFireHaptic: !alreadyFired, nextFired: true };
}
