// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, act } from "@testing-library/react";
import { AccessibilityInfo } from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import CookModeScreen from "../CookModeScreen";

const mocks = vi.hoisted(() => ({
  goBack: vi.fn(),
  speak: vi.fn(),
  stop: vi.fn(),
  notification: vi.fn(),
  refetch: vi.fn(),
  keepAwake: vi.fn(),
  screenReader: { on: false },
  recipe: {
    current: {} as {
      title: string | null;
      cards: unknown[];
      isLoading: boolean;
      isError: boolean;
    },
  },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ goBack: mocks.goBack }),
  useRoute: () => ({ params: { recipeId: 7, recipeType: "community" } }),
}));
vi.mock("expo-keep-awake", () => ({ useKeepAwake: mocks.keepAwake }));
vi.mock("@/hooks/useTTS", () => ({
  useTTS: () => ({
    isSpeaking: false,
    speakingMessageId: null,
    // New functions each render, as when the hook's own inputs change.
    speak: (...args: unknown[]) => mocks.speak(...args),
    stop: () => mocks.stop(),
  }),
}));
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: mocks.notification,
    selection: vi.fn(),
    disabled: false,
  }),
}));
vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => ({
    reducedMotion: false,
    screenReaderEnabled: mocks.screenReader.on,
  }),
}));
vi.mock("@/hooks/useCookRecipe", () => ({
  useCookRecipe: (id: number, type: string) => {
    expect([id, type]).toEqual([7, "community"]);
    return { ...mocks.recipe.current, refetch: mocks.refetch };
  },
}));

const CARDS = [
  { kind: "ready", ingredients: ["1 cup rice", "salt"] },
  {
    kind: "step",
    number: 1,
    text: "Rinse the rice.",
    detail: null,
    timers: [],
  },
  {
    kind: "step",
    number: 2,
    text: "Simmer for 12 minutes, then rest 5 minutes.",
    detail: "Keep the lid on.",
    timers: [
      { seconds: 720, label: "12 min" },
      { seconds: 300, label: "5 min" },
    ],
  },
];

const press = (label: string) => fireEvent.click(screen.getByLabelText(label));

describe("CookModeScreen", () => {
  let announce: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
    mocks.screenReader.on = false;
    mocks.recipe.current = {
      title: "Plain rice",
      cards: CARDS,
      isLoading: false,
      isError: false,
    };
    announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
  });
  afterEach(() => {
    vi.useRealTimers();
    announce.mockRestore();
  });

  it("opens on the ingredients, keeps the screen awake and reads them aloud", () => {
    renderComponent(<CookModeScreen />);
    expect(screen.getByText("Plain rice")).toBeDefined();
    expect(screen.getByText("Get ready")).toBeDefined();
    expect(screen.getByText("1 cup rice")).toBeDefined();
    expect(mocks.keepAwake).toHaveBeenCalled();
    expect(mocks.speak).toHaveBeenCalledExactlyOnceWith(
      0,
      "Get ready. You need: 1 cup rice. salt.",
    );
  });

  it("silences anything already being read before its first card", () => {
    renderComponent(<CookModeScreen />);
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.stop.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.speak.mock.invocationCallOrder[0],
    );
  });

  it("does not read a card twice when the screen re-renders", () => {
    const { rerender } = renderComponent(<CookModeScreen />);
    rerender(<CookModeScreen />);
    rerender(<CookModeScreen />);
    // A second speak with the same id would toggle the reading off.
    expect(mocks.speak).toHaveBeenCalledOnce();
  });

  it("moves forward and back one card at a time, reading each", () => {
    renderComponent(<CookModeScreen />);
    press("Next step");
    expect(screen.getByText("Step 1 of 2")).toBeDefined();
    expect(screen.getByText("Rinse the rice.")).toBeDefined();
    expect(mocks.speak).toHaveBeenLastCalledWith(
      1,
      "Step 1 of 2. Rinse the rice.",
    );
    press("Next step");
    expect(screen.getByText("Step 2 of 2")).toBeDefined();
    expect(screen.getByText("Keep the lid on.")).toBeDefined();
    press("Previous step");
    expect(screen.getByText("Step 1 of 2")).toBeDefined();
  });

  it("has no way back on the first card and finishes from the last", () => {
    renderComponent(<CookModeScreen />);
    expect(screen.queryByLabelText("Previous step")).toBeNull();
    press("Next step");
    press("Next step");
    expect(screen.queryByLabelText("Next step")).toBeNull();
    press("Finish cooking");
    expect(mocks.goBack).toHaveBeenCalledOnce();
  });

  it("stops reading when read-aloud is turned off, and reads again when it is turned on", () => {
    renderComponent(<CookModeScreen />);
    mocks.speak.mockClear();
    press("Read steps aloud");
    expect(mocks.stop).toHaveBeenCalled();
    press("Next step");
    expect(mocks.speak).not.toHaveBeenCalled();
    press("Read steps aloud");
    expect(mocks.speak).toHaveBeenCalledExactlyOnceWith(
      1,
      "Step 1 of 2. Rinse the rice.",
    );
  });

  it("leaves the reading to the screen reader when one is on", () => {
    mocks.screenReader.on = true;
    renderComponent(<CookModeScreen />);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(mocks.speak).not.toHaveBeenCalled();
    press("Next step");
    expect(mocks.speak).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith("Step 1 of 2. Rinse the rice.");
    // The switch would do nothing, so it is not offered.
    expect(screen.queryByLabelText("Read steps aloud")).toBeNull();
  });

  it("announces the first card only after the screen has opened", () => {
    mocks.screenReader.on = true;
    renderComponent(<CookModeScreen />);
    // The modal opening moves the screen reader's focus and would swallow it.
    expect(announce).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(announce).toHaveBeenCalledExactlyOnceWith(
      "Get ready. You need: 1 cup rice. salt.",
    );
  });

  it("drops the delayed first announcement when the screen closes first", () => {
    mocks.screenReader.on = true;
    const { unmount } = renderComponent(<CookModeScreen />);
    unmount();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(announce).not.toHaveBeenCalled();
  });

  it("stops its own voice when a screen reader is turned on", () => {
    const { rerender } = renderComponent(<CookModeScreen />);
    mocks.stop.mockClear();
    mocks.screenReader.on = true;
    rerender(<CookModeScreen />);
    expect(mocks.stop).toHaveBeenCalled();
  });

  it("offers a timer for each duration in the step and counts it down", () => {
    renderComponent(<CookModeScreen />);
    press("Next step");
    press("Next step");
    press("Start 12 min timer");
    expect(screen.getByText("12:00")).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByText("10:59")).toBeDefined();
    expect(screen.getByLabelText("Start 5 min timer")).toBeDefined();
  });

  it("cancels a running timer", () => {
    renderComponent(<CookModeScreen />);
    press("Next step");
    press("Next step");
    press("Start 5 min timer");
    press("Cancel 5 min timer");
    expect(screen.getByLabelText("Start 5 min timer")).toBeDefined();
    expect(screen.queryByText("5:00")).toBeNull();
  });

  it("keeps a timer running, and in view, on another step", () => {
    renderComponent(<CookModeScreen />);
    press("Next step");
    press("Next step");
    press("Start 12 min timer");
    press("Previous step");
    expect(screen.getByText("Step 1 of 2")).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("Step 2 · 11:00")).toBeDefined();
  });

  it("says, shows and buzzes when a timer ends", () => {
    renderComponent(<CookModeScreen />);
    press("Next step");
    press("Next step");
    press("Start 5 min timer");
    mocks.speak.mockClear();
    act(() => {
      vi.advanceTimersByTime(301_000);
    });
    expect(screen.getByText("Timer done: 5 min (step 2)")).toBeDefined();
    expect(mocks.notification).toHaveBeenCalledOnce();
    expect(mocks.speak).toHaveBeenCalledExactlyOnceWith(
      expect.any(Number),
      "Timer done. 5 min, step 2.",
    );
    expect(announce).toHaveBeenCalledWith("Timer done: 5 min (step 2)");
    press("Dismiss timer notice");
    expect(screen.queryByText("Timer done: 5 min (step 2)")).toBeNull();
  });

  it("still says a finished timer aloud with read-aloud off", () => {
    renderComponent(<CookModeScreen />);
    press("Read steps aloud");
    press("Next step");
    press("Next step");
    press("Start 5 min timer");
    act(() => {
      vi.advanceTimersByTime(301_000);
    });
    expect(mocks.speak).toHaveBeenLastCalledWith(
      expect.any(Number),
      "Timer done. 5 min, step 2.",
    );
  });

  it("closes from the close button and stops talking", () => {
    renderComponent(<CookModeScreen />);
    press("Close cook mode");
    expect(mocks.goBack).toHaveBeenCalledOnce();
  });

  it("shows a loading state with a way out", () => {
    mocks.recipe.current = {
      title: null,
      cards: [],
      isLoading: true,
      isError: false,
    };
    renderComponent(<CookModeScreen />);
    expect(screen.getByLabelText("Loading recipe")).toBeDefined();
    expect(mocks.speak).not.toHaveBeenCalled();
    press("Close cook mode");
    expect(mocks.goBack).toHaveBeenCalledOnce();
  });

  it("offers another try when the recipe could not be loaded", () => {
    mocks.recipe.current = {
      title: null,
      cards: [],
      isLoading: false,
      isError: true,
    };
    renderComponent(<CookModeScreen />);
    expect(screen.getByText("Couldn't load this recipe.")).toBeDefined();
    press("Try again");
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("says so when the recipe has no steps", () => {
    mocks.recipe.current = {
      title: "Mystery dish",
      cards: [],
      isLoading: false,
      isError: false,
    };
    renderComponent(<CookModeScreen />);
    expect(
      screen.getByText("This recipe has no steps to cook from."),
    ).toBeDefined();
    expect(mocks.speak).not.toHaveBeenCalled();
  });
});
