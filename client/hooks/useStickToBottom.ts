import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";

/** Within this many points of the end, the list counts as "at the bottom"
 *  and keeps following new content. */
export const STICK_THRESHOLD_PX = 100;
/** Scrolled up further than this, a "jump to latest" control is offered. */
export const JUMP_BUTTON_THRESHOLD_PX = 200;
/** A momentum phase starting within this long of a drag ending is that
 *  drag's fling; any other momentum is programmatic. */
const MOMENTUM_HANDOFF_MS = 100;

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

interface ScrollToEndTarget {
  scrollToEnd: (options: { animated: boolean }) => void;
}

function distanceFromBottom({
  contentOffset,
  contentSize,
  layoutMeasurement,
}: NativeScrollEvent): number {
  return contentSize.height - layoutMeasurement.height - contentOffset.y;
}

/**
 * Chat-style "stick to bottom" scrolling: the list follows new content (a
 * reply streaming in) only while the user is at the bottom. Once they drag
 * up to reread something it stops pulling them down, and offers a jump back
 * instead. Only a user drag can turn following off — the list's own
 * programmatic scrolls fire `onScroll` too and must not.
 *
 * @param getScrollView returns the native scroll view to drive (read at call
 *   time, so it may change between renders)
 */
export function useStickToBottom(
  getScrollView: () => ScrollToEndTarget | null | undefined,
  { reducedMotion }: { reducedMotion: boolean },
) {
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const stickRef = useRef(true);
  const userScrollingRef = useRef(false);
  const dragEndedAtRef = useRef(0); // Date.now() when the last drag ended
  // Last measured viewport, so a content-size change can work out how far
  // from the end the user now is without waiting for a scroll event.
  const viewportRef = useRef({ offsetY: 0, layoutHeight: 0 });

  // Read later, inside the handlers — the one-render lag is invisible there.
  const getScrollViewRef = useRef(getScrollView);
  const reducedMotionRef = useRef(reducedMotion);
  useEffect(() => {
    getScrollViewRef.current = getScrollView;
    reducedMotionRef.current = reducedMotion;
  }, [getScrollView, reducedMotion]);

  const track = useCallback((e: ScrollEvent) => {
    const n = e.nativeEvent;
    viewportRef.current = {
      offsetY: n.contentOffset.y,
      layoutHeight: n.layoutMeasurement.height,
    };
    if (!userScrollingRef.current) return;
    const distance = distanceFromBottom(n);
    stickRef.current = distance <= STICK_THRESHOLD_PX;
    setShowJumpToLatest(distance > JUMP_BUTTON_THRESHOLD_PX);
  }, []);

  const onScrollBeginDrag = useCallback(
    (e: ScrollEvent) => {
      userScrollingRef.current = true;
      track(e);
    },
    [track],
  );

  // A drag lifted with no velocity fires onScrollEndDrag but never any
  // momentum event, so the user's scroll ends here; a fling hands over to
  // momentum below. Clearing here (not only on momentum end) keeps later
  // programmatic and layout scroll events from counting as the user's.
  const onScrollEndDrag = useCallback(
    (e: ScrollEvent) => {
      track(e);
      userScrollingRef.current = false;
      dragEndedAtRef.current = Date.now();
    },
    [track],
  );

  // Momentum is the user's only when it carries on from a drag that just
  // ended — Android can also emit momentum events for a programmatic smooth
  // scroll, such as the jump's animated scrollToEnd.
  const onMomentumScrollBegin = useCallback(() => {
    if (Date.now() - dragEndedAtRef.current <= MOMENTUM_HANDOFF_MS) {
      userScrollingRef.current = true;
    }
  }, []);

  const onMomentumScrollEnd = useCallback(
    (e: ScrollEvent) => {
      track(e);
      userScrollingRef.current = false;
    },
    [track],
  );

  // The keyboard opening or closing resizes the list without any scroll
  // event; keep the viewport height current for onContentSizeChange.
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    viewportRef.current = {
      ...viewportRef.current,
      layoutHeight: e.nativeEvent.layout.height,
    };
  }, []);

  const onContentSizeChange = useCallback((_w: number, height: number) => {
    if (stickRef.current) {
      getScrollViewRef.current()?.scrollToEnd({ animated: false });
      return;
    }
    const { offsetY, layoutHeight } = viewportRef.current;
    setShowJumpToLatest(
      height - layoutHeight - offsetY > JUMP_BUTTON_THRESHOLD_PX,
    );
  }, []);

  /** Resume following (e.g. the user just sent a message). */
  const followLatest = useCallback(() => {
    stickRef.current = true;
    userScrollingRef.current = false;
    setShowJumpToLatest(false);
  }, []);

  /** The jump control: scroll to the newest message and resume following. */
  const jumpToLatest = useCallback(() => {
    followLatest();
    getScrollViewRef.current()?.scrollToEnd({
      animated: !reducedMotionRef.current,
    });
  }, [followLatest]);

  return {
    onScroll: track,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
    onLayout,
    onContentSizeChange,
    showJumpToLatest,
    jumpToLatest,
    followLatest,
  };
}
