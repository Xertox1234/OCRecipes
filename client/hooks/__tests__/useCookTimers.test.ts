// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useCookTimers } from "../useCookTimers";

describe("useCookTimers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = () => {
    const onDone = vi.fn();
    const hook = renderHook(() => useCookTimers(onDone));
    return { ...hook, onDone };
  };
  const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  it("starts with none running", () => {
    const { result } = setup();
    expect(result.current.timers).toEqual([]);
  });

  it("counts a started timer down by the clock", () => {
    const { result } = setup();
    act(() =>
      result.current.start("2:0", { seconds: 600, label: "10 min" }, 2),
    );
    expect(result.current.timers).toEqual([
      { id: "2:0", label: "10 min", stepNumber: 2, remaining: 600 },
    ]);
    tick(61_000);
    expect(result.current.timers[0].remaining).toBe(539);
  });

  it("reports a finished timer once and drops it", () => {
    const { result, onDone } = setup();
    act(() => result.current.start("2:0", { seconds: 30, label: "30 sec" }, 2));
    tick(29_000);
    expect(onDone).not.toHaveBeenCalled();
    tick(2_000);
    expect(onDone).toHaveBeenCalledExactlyOnceWith({
      id: "2:0",
      label: "30 sec",
      stepNumber: 2,
    });
    expect(result.current.timers).toEqual([]);
    tick(60_000);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("is right after a long gap with no ticks (the app was in the background)", () => {
    const { result, onDone } = setup();
    act(() => result.current.start("1:0", { seconds: 300, label: "5 min" }, 1));
    // The clock moves on; no interval fired meanwhile.
    vi.setSystemTime(new Date("2026-11-25T12:10:00Z"));
    tick(1_000);
    expect(onDone).toHaveBeenCalledOnce();
    expect(result.current.timers).toEqual([]);
  });

  it("runs several at once and finishes each on its own time", () => {
    const { result, onDone } = setup();
    act(() => result.current.start("1:0", { seconds: 60, label: "1 min" }, 1));
    act(() => result.current.start("3:0", { seconds: 120, label: "2 min" }, 3));
    tick(61_000);
    expect(onDone).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "1:0" }),
    );
    expect(result.current.timers.map((t) => t.id)).toEqual(["3:0"]);
    tick(60_000);
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it("cancels a timer without reporting it", () => {
    const { result, onDone } = setup();
    act(() => result.current.start("1:0", { seconds: 60, label: "1 min" }, 1));
    act(() => result.current.cancel("1:0"));
    expect(result.current.timers).toEqual([]);
    tick(120_000);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("restarts a timer that is started again", () => {
    const { result } = setup();
    act(() => result.current.start("1:0", { seconds: 60, label: "1 min" }, 1));
    tick(30_000);
    act(() => result.current.start("1:0", { seconds: 60, label: "1 min" }, 1));
    expect(result.current.timers).toHaveLength(1);
    expect(result.current.timers[0].remaining).toBe(60);
  });

  it("stops ticking when it goes away", () => {
    const { result, onDone, unmount } = setup();
    act(() => result.current.start("1:0", { seconds: 60, label: "1 min" }, 1));
    unmount();
    vi.advanceTimersByTime(120_000);
    expect(onDone).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
