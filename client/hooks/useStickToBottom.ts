import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

/** Within this many points of the end, the list counts as "at the bottom"
 *  and keeps following new content. */
export const STICK_THRESHOLD_PX = 100;
/** Scrolled up further than this, a "jump to latest" control is offered. */
export const JUMP_BUTTON_THRESHOLD_PX = 200;

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

  const onScrollEndDrag = track;

  const onMomentumScrollEnd = useCallback(
    (e: ScrollEvent) => {
      track(e);
      userScrollingRef.current = false;
    },
    [track],
  );

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
    onMomentumScrollEnd,
    onContentSizeChange,
    showJumpToLatest,
    jumpToLatest,
    followLatest,
  };
}
