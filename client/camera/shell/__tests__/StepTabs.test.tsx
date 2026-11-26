// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as RN from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { StepTabs } from "../StepTabs";
import type { StepTabView } from "../barcode-flow";

// The shared Pressable mock drops `style`, which would hide the tabs'
// 44pt minHeight. Render PressableScale as the TouchableOpacity mock (keeps
// style) with its style flattened.
vi.mock("@/components/PressableScale", async () => {
  const RN = await import("react-native");
  const flat = (s: unknown): unknown =>
    Array.isArray(s) ? Object.assign({}, ...s.map(flat).filter(Boolean)) : s;
  return {
    PressableScale: ({
      style,
      scaleTo: _scaleTo,
      ...props
    }: Record<string, unknown>) => (
      <RN.TouchableOpacity
        {...props}
        style={flat(style) as StyleProp<ViewStyle>}
      />
    ),
  };
});

const selection = vi.fn();
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ selection }),
}));

const tabs = (
  b: StepTabView["state"],
  n: StepTabView["state"],
  f: StepTabView["state"],
): StepTabView[] => [
  { id: "barcode", label: "Barcode", state: b, tappable: b === "done" },
  { id: "nutrition", label: "Nutrition", state: n, tappable: n === "done" },
  {
    id: "front",
    label: "Front",
    sublabel: "optional",
    state: f,
    tappable: false,
  },
];

describe("StepTabs", () => {
  const originalOS = RN.Platform.OS;
  let announceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    selection.mockClear();
    announceSpy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
  });
  afterEach(() => {
    RN.Platform.OS = originalOS;
    announceSpy.mockRestore();
  });

  it("renders one tab per StepTabView with its label and sublabel", () => {
    render(
      <StepTabs
        tabs={tabs("active", "upcoming", "upcoming")}
        onRedo={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getByText("Barcode")).toBeTruthy();
    expect(screen.getByText("Nutrition")).toBeTruthy();
    expect(screen.getByText("Front")).toBeTruthy();
    expect(screen.getByText("optional")).toBeTruthy();
  });

  it("active tab has accessibilityState selected", () => {
    render(
      <StepTabs
        tabs={tabs("active", "upcoming", "upcoming")}
        onRedo={vi.fn()}
      />,
    );
    const [barcode, nutrition] = screen.getAllByRole("button");
    expect(barcode.getAttribute("aria-selected")).toBe("true");
    expect(nutrition.getAttribute("aria-selected")).not.toBe("true");
  });

  it('done tab label reads "Barcode, done"', () => {
    render(
      <StepTabs tabs={tabs("done", "active", "upcoming")} onRedo={vi.fn()} />,
    );
    expect(screen.getByLabelText("Barcode, done")).toBeTruthy();
  });

  it("tapping a tappable done tab calls onRedo with its id and gives selection haptic", () => {
    const onRedo = vi.fn();
    render(<StepTabs tabs={tabs("done", "done", "active")} onRedo={onRedo} />);
    fireEvent.click(screen.getByLabelText("Nutrition, done"));
    expect(onRedo).toHaveBeenCalledWith("nutrition");
    expect(selection).toHaveBeenCalledTimes(1);
  });

  it("a non-tappable tab is disabled and its press does nothing", () => {
    const onRedo = vi.fn();
    render(
      <StepTabs
        tabs={tabs("active", "upcoming", "upcoming")}
        onRedo={onRedo}
      />,
    );
    const barcode = screen.getAllByRole("button")[0];
    expect(barcode.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(barcode);
    expect(onRedo).not.toHaveBeenCalled();
    expect(selection).not.toHaveBeenCalled();
  });

  it("each tab's min height is at least 44", () => {
    render(
      <StepTabs tabs={tabs("done", "active", "upcoming")} onRedo={vi.fn()} />,
    );
    for (const btn of screen.getAllByRole("button")) {
      expect(parseFloat(btn.style.minHeight)).toBeGreaterThanOrEqual(44);
    }
  });

  it('announces "<label> step complete" when a tab turns done (iOS)', () => {
    RN.Platform.OS = "ios";
    const { rerender } = render(
      <StepTabs
        tabs={tabs("active", "upcoming", "upcoming")}
        onRedo={vi.fn()}
      />,
    );
    announceSpy.mockClear();
    rerender(
      <StepTabs tabs={tabs("done", "active", "upcoming")} onRedo={vi.fn()} />,
    );
    expect(announceSpy).toHaveBeenCalledWith("Barcode step complete");
  });

  it("does not announce on Android", () => {
    RN.Platform.OS = "android";
    const { rerender } = render(
      <StepTabs
        tabs={tabs("active", "upcoming", "upcoming")}
        onRedo={vi.fn()}
      />,
    );
    rerender(
      <StepTabs tabs={tabs("done", "active", "upcoming")} onRedo={vi.fn()} />,
    );
    expect(announceSpy).not.toHaveBeenCalled();
  });
});
