// First-run teaching for the scan camera: the one-time tips carousel, then
// the step's example card for the first 3 scans of a flow (counted when it
// appears), and the card again on demand through "?" (never counted).
// Nothing shows until the saved counts have loaded, and each card shows at
// most once per visit, so neither flashes nor repeats.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  hasSeenTip,
  incrementExampleViewCount,
  isFeatureTipsReady,
  markTipSeen,
  onFeatureTipsReady,
  shouldShowExampleCard,
  type ScanExampleKey,
} from "@/lib/feature-tips-storage";

const CAROUSEL_TIP = "scan-tips-carousel";

type CarouselState = "loading" | "unseen" | "seen";

// Primitive snapshots (not objects) so useSyncExternalStore compares them by
// value. Re-read on every render, so a mark made this visit is picked up.
function readCarouselState(): CarouselState {
  if (!isFeatureTipsReady()) return "loading";
  return hasSeenTip(CAROUSEL_TIP) ? "seen" : "unseen";
}

interface ScanOnboarding {
  carouselVisible: boolean;
  onCarouselDone: () => void;
  /** The example card to show now, or null. */
  exampleCardKey: ScanExampleKey | null;
  onExampleDismiss: () => void;
  /** "Show the example again →": shows this step's card, uncounted. */
  showExample: (key: ScanExampleKey) => void;
}

export function useScanOnboarding({
  exampleKey,
  examplesEnabled,
}: {
  /** The current step's example card (null on steps without one). */
  exampleKey: ScanExampleKey | null;
  /** False in flows that have no example cards yet (the generic flow). */
  examplesEnabled: boolean;
}): ScanOnboarding {
  const carouselState = useSyncExternalStore(
    onFeatureTipsReady,
    readCarouselState,
  );
  const autoShow = useSyncExternalStore(onFeatureTipsReady, () =>
    exampleKey && examplesEnabled ? shouldShowExampleCard(exampleKey) : null,
  );
  // This visit's dismissals: a card never comes back on a retake or a redo.
  const [dismissed, setDismissed] = useState<ScanExampleKey[]>([]);
  // Cards this visit has shown unasked. Once shown, a card stays up until
  // dismissed: counting it (below) can reach the limit and flip autoShow.
  const [shown, setShown] = useState<ScanExampleKey[]>([]);
  const [forcedKey, setForcedKey] = useState<ScanExampleKey | null>(null);
  const [carouselDone, setCarouselDone] = useState(false);
  const countedRef = useRef(new Set<ScanExampleKey>());

  const carouselVisible = carouselState === "unseen" && !carouselDone;

  const autoKey =
    !carouselVisible &&
    carouselState !== "loading" &&
    exampleKey &&
    !dismissed.includes(exampleKey) &&
    (shown.includes(exampleKey) || autoShow === true)
      ? exampleKey
      : null;
  // React's "adjust state while rendering" pattern: latch the showing in the
  // same commit it first appears.
  if (autoKey && !shown.includes(autoKey)) {
    setShown([...shown, autoKey]);
  }
  const exampleCardKey: ScanExampleKey | null = forcedKey ?? autoKey;

  // An unasked-for showing counts when it first appears (closing the camera
  // with ✕ still spends one of the first 3); a card asked for through "?"
  // never does.
  useEffect(() => {
    for (const key of shown) {
      if (!countedRef.current.has(key)) {
        countedRef.current.add(key);
        void incrementExampleViewCount(key);
      }
    }
  }, [shown]);

  const onCarouselDone = useCallback(() => {
    setCarouselDone(true);
    void markTipSeen(CAROUSEL_TIP);
  }, []);

  const onExampleDismiss = useCallback(() => {
    if (!exampleCardKey) return;
    setForcedKey(null);
    const key = exampleCardKey;
    setDismissed((prev) => (prev.includes(key) ? prev : [...prev, key]));
  }, [exampleCardKey]);

  const showExample = useCallback((key: ScanExampleKey) => {
    setForcedKey(key);
  }, []);

  return {
    carouselVisible,
    onCarouselDone,
    exampleCardKey,
    onExampleDismiss,
    showExample,
  };
}
