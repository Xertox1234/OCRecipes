import { useCallback, useEffect, useState } from "react";

import {
  hasSeenTip,
  hasUsedFeature,
  isFeatureTipsReady,
  markFeatureUsed,
  markTipSeen,
  onFeatureTipsReady,
  type TaughtFeature,
  type TipId,
} from "@/lib/feature-tips-storage";

// One tip (tooltip or teaching toast) on screen at a time, app-wide.
let activeTip: TipId | null = null;

/** Takes the single tip slot; false when another tip already holds it. */
export function claimTipSlot(id: TipId): boolean {
  if (activeTip !== null && activeTip !== id) return false;
  activeTip = id;
  return true;
}

export function releaseTipSlot(id: TipId): void {
  if (activeTip === id) activeTip = null;
}

interface FeatureTipOptions {
  /** The feature the tip teaches; once used, the tip never shows. */
  feature: TaughtFeature;
  /** The screen's own condition (right plan, control on screen, ...). */
  eligible: boolean;
  /** False while something it depends on (e.g. premium status) is loading. */
  ready?: boolean;
}

/**
 * Whether an in-context tip may show: eligible, unseen, its feature unused, and
 * no other tip on screen. A tip counts as seen the moment it appears.
 */
export function useFeatureTip(
  id: TipId,
  { feature, eligible, ready = true }: FeatureTipOptions,
): { visible: boolean; dismiss: () => void } {
  const [storageReady, setStorageReady] = useState(isFeatureTipsReady);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (storageReady) return;
    return onFeatureTipsReady(() => setStorageReady(true));
  }, [storageReady]);

  useEffect(() => {
    if (visible || dismissed || !ready || !eligible || !storageReady) return;
    if (hasSeenTip(id) || hasUsedFeature(feature)) return;
    if (!claimTipSlot(id)) return;
    setVisible(true);
    void markTipSeen(id);
  }, [id, feature, eligible, ready, storageReady, visible, dismissed]);

  useEffect(() => () => releaseTipSlot(id), [id]);

  const dismiss = useCallback(() => {
    setVisible(false);
    setDismissed(true);
    releaseTipSlot(id);
  }, [id]);

  return { visible, dismiss };
}

/** Call on a screen that IS the feature, so its tips stop showing for good. */
export function useMarkFeatureUsed(feature: TaughtFeature): void {
  useEffect(() => {
    void markFeatureUsed(feature);
  }, [feature]);
}
