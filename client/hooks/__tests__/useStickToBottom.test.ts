// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  useStickToBottom,
  STICK_THRESHOLD_PX,
  JUMP_BUTTON_THRESHOLD_PX,
} from "../useStickToBottom";

const LAYOUT_H = 600;
const CONTENT_H = 2000;

/** A native scroll event whose viewport bottom sits `fromBottom` px above
 *  the end of the content. */
function scrollEvent(fromBottom: number, contentHeight = CONTENT_H) {
  return {
    nativeEvent: {
      contentOffset: { x: 0, y: contentHeight - LAYOUT_H - fromBottom },
      contentSize: { width: 400, height: contentHeight },
      layoutMeasurement: { width: 400, height: LAYOUT_H },
    },
  } as unknown as Parameters<
    ReturnType<typeof useStickToBottom>["onScroll"]
  >[0];
}

describe("useStickToBottom", () => {
  const scrollToEnd = vi.fn();
  const getScrollView = () => ({ scrollToEnd });

  beforeEach(() => {
    scrollToEnd.mockClear();
  });

  function setup(reducedMotion = false) {
    return renderHook(() => useStickToBottom(getScrollView, { reducedMotion }));
  }

  /** The user drags the list so its bottom edge ends `fromBottom` px up. */
  function userScrollsTo(
    r: ReturnType<typeof setup>["result"],
    fromBottom: number,
  ) {
    act(() => {
      r.current.onScrollBeginDrag(scrollEvent(fromBottom));
      r.current.onScroll(scrollEvent(fromBottom));
      r.current.onScrollEndDrag(scrollEvent(fromBottom));
      r.current.onMomentumScrollBegin();
      r.current.onScroll(scrollEvent(fromBottom));
      r.current.onMomentumScrollEnd(scrollEvent(fromBottom));
    });
  }

  it("follows new content to the end while at the bottom", () => {
    const { result } = setup();
    act(() => result.current.onContentSizeChange(400, CONTENT_H));
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
    expect(result.current.showJumpToLatest).toBe(false);
  });

  it("stops following once the user scrolls up, and offers a jump", () => {
    const { result } = setup();
    userScrollsTo(result, 500);
    act(() => result.current.onContentSizeChange(400, CONTENT_H + 50));
    expect(scrollToEnd).not.toHaveBeenCalled();
    expect(result.current.showJumpToLatest).toBe(true);
  });

  it("keeps following when the user only scrolls a little", () => {
    const { result } = setup();
    userScrollsTo(result, STICK_THRESHOLD_PX - 10);
    act(() => result.current.onContentSizeChange(400, CONTENT_H + 50));
    expect(scrollToEnd).toHaveBeenCalled();
  });

  it("shows no jump button for a short distance up", () => {
    const { result } = setup();
    userScrollsTo(result, JUMP_BUTTON_THRESHOLD_PX - 20);
    expect(result.current.showJumpToLatest).toBe(false);
  });

  it("resumes following when the user scrolls back to the bottom", () => {
    const { result } = setup();
    userScrollsTo(result, 500);
    userScrollsTo(result, 0);
    act(() => result.current.onContentSizeChange(400, CONTENT_H + 50));
    expect(scrollToEnd).toHaveBeenCalled();
    expect(result.current.showJumpToLatest).toBe(false);
  });

  it("ignores scroll events it did not see the user start", () => {
    // Programmatic scrolls (and content shifts) fire onScroll too; only a
    // user drag may turn following off.
    const { result } = setup();
    act(() => result.current.onScroll(scrollEvent(500)));
    act(() => result.current.onContentSizeChange(400, CONTENT_H + 50));
    expect(scrollToEnd).toHaveBeenCalled();
  });

  it("jumpToLatest scrolls smoothly to the end and resumes following", () => {
    const { result } = setup();
    userScrollsTo(result, 500);
    act(() => result.current.jumpToLatest());
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: true });
    expect(result.current.showJumpToLatest).toBe(false);
    scrollToEnd.mockClear();
    act(() => result.current.onContentSizeChange(400, CONTENT_H + 50));
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
  });

  it("jumpToLatest snaps without animation under reduced motion", () => {
    const { result } = setup(true);
    userScrollsTo(result, 500);
    act(() => result.current.jumpToLatest());
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
  });

  it("a slow drag (no momentum after it) still ends the user's scroll", () => {
    // Lifting a finger with no velocity fires onScrollEndDrag but never
    // onMomentumScrollEnd. Later programmatic or layout scroll events
    // (keyboard opening, an animated jump) must not count as the user's.
    const { result } = setup();
    act(() => {
      result.current.onScrollBeginDrag(scrollEvent(0));
      result.current.onScrollEndDrag(scrollEvent(0));
    });
    act(() => result.current.onScroll(scrollEvent(500)));
    act(() => result.current.onContentSizeChange(400, CONTENT_H + 50));
    expect(scrollToEnd).toHaveBeenCalled();
    expect(result.current.showJumpToLatest).toBe(false);
  });

  it("frames of the animated jump do not turn following back off", () => {
    const { result } = setup();
    userScrollsTo(result, 500);
    act(() => result.current.jumpToLatest());
    // Mid-animation, the list is still far from the end.
    act(() => result.current.onScroll(scrollEvent(400)));
    expect(result.current.showJumpToLatest).toBe(false);
    scrollToEnd.mockClear();
    act(() => result.current.onContentSizeChange(400, CONTENT_H + 50));
    expect(scrollToEnd).toHaveBeenCalled();
  });

  it("momentum that does not follow a drag is not the user's", () => {
    // Android can emit momentum events for a programmatic smooth scroll.
    const { result } = setup();
    act(() => {
      result.current.onMomentumScrollBegin();
      result.current.onScroll(scrollEvent(500));
      result.current.onMomentumScrollEnd(scrollEvent(500));
    });
    act(() => result.current.onContentSizeChange(400, CONTENT_H + 50));
    expect(scrollToEnd).toHaveBeenCalled();
  });

  it("followLatest (a message just sent) resumes following", () => {
    const { result } = setup();
    userScrollsTo(result, 500);
    act(() => result.current.followLatest());
    expect(result.current.showJumpToLatest).toBe(false);
    act(() => result.current.onContentSizeChange(400, CONTENT_H + 50));
    expect(scrollToEnd).toHaveBeenCalled();
  });
});
