// @vitest-environment jsdom
import React from "react";
import { act, screen, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import LabelAnalysisScreen from "../LabelAnalysisScreen";

const {
  mockGoBack,
  mockPop,
  mockNavigate,
  mockReplace,
  mockApiRequest,
  mockUpload,
  mockDeleteAsync,
  mockRoute,
  capturedPressProps,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockPop: vi.fn(),
  mockNavigate: vi.fn(),
  mockReplace: vi.fn(),
  mockApiRequest: vi.fn(),
  mockUpload: vi.fn(),
  mockDeleteAsync: vi.fn().mockResolvedValue(undefined),
  mockRoute: { params: {} as Record<string, unknown> },
  // Keyed by accessibilityLabel — see the react-native mock override below.
  capturedPressProps: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    pop: mockPop,
    navigate: mockNavigate,
    replace: mockReplace,
  }),
  useRoute: () => mockRoute,
}));

vi.mock("@react-navigation/elements", () => ({
  useHeaderHeight: () => 0,
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/lib/query-client", () => ({ apiRequest: mockApiRequest }));

vi.mock("@/lib/photo-upload", () => ({
  uploadLabelForAnalysis: mockUpload,
  confirmLabelAnalysis: vi.fn(),
}));

vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: mockDeleteAsync,
}));

// Captures the raw props (style/hitSlop) each labeled Pressable receives, for
// the P2-2026-09-23 touch-target tests below — the shared react-native mock's
// Pressable drops `style` before rendering to the DOM (test/mocks/react-native.ts),
// so asserting on the rendered node can't see it. Forwards to the real
// (mocked) Pressable afterwards, so every other test in this file renders
// unaffected.
vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const CapturingPressable = React.forwardRef<unknown, Record<string, unknown>>(
    (props, ref) => {
      const label = props.accessibilityLabel as string | undefined;
      if (label) capturedPressProps[label] = props;
      return React.createElement(
        actual.Pressable as React.ComponentType<Record<string, unknown>>,
        { ...props, ref },
      );
    },
  );
  CapturingPressable.displayName = "Pressable";
  return { ...actual, Pressable: CapturingPressable };
});

const BARCODE = "0778918011332";
const IMAGE_URI = "file:///label-capture.jpg";

describe("LabelAnalysisScreen — captured temp photo cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteAsync.mockResolvedValue(undefined);
    mockRoute.params = { imageUri: IMAGE_URI, barcode: BARCODE };
    mockUpload.mockResolvedValue({
      sessionId: "session-1",
      labelData: {
        servingSize: "1 cup",
        servingsPerContainer: 2,
        calories: 250,
        totalFat: 10,
        saturatedFat: 2,
        transFat: 0,
        cholesterol: 5,
        sodium: 300,
        totalCarbs: 30,
        dietaryFiber: 3,
        totalSugars: 12,
        addedSugars: 5,
        protein: 8,
        vitaminD: null,
        calcium: null,
        iron: null,
        potassium: null,
        confidence: 0.9,
      },
    });
  });

  // Reproduces audit finding L2: capturePhotoToFile writes to the OS temp
  // dir and nothing ever deletes it. Fails on main (deleteAsync is never
  // imported/called by this screen).
  it("deletes the captured photo file once the screen unmounts", async () => {
    const { unmount } = renderComponent(<LabelAnalysisScreen />);

    await waitFor(() => expect(mockUpload).toHaveBeenCalled());
    expect(mockDeleteAsync).not.toHaveBeenCalled();

    await act(async () => {
      unmount();
    });

    expect(mockDeleteAsync).toHaveBeenCalledWith(IMAGE_URI, {
      idempotent: true,
    });
  });

  // Negative control: while the screen is still mounted and a retry can
  // still re-read imageUri, the file must survive — cleanup is unmount-only,
  // never a focus-based effect (docs/solutions comment in the source: the
  // front-label CTA keeps this screen on the stack for pop(2), and the
  // upload effect re-reads imageUri on retryToken).
  it("does not delete the file while the screen is still mounted", async () => {
    renderComponent(<LabelAnalysisScreen />);

    await waitFor(() => expect(mockUpload).toHaveBeenCalled());
    expect(mockDeleteAsync).not.toHaveBeenCalled();
  });
});

// Regression coverage for todos/archive/P2-2026-09-23-touch-targets-regressed-below-44pt.md
// (M13, 2026-09-23 front-end audit): the servings +/- buttons fell below the
// 44pt platform minimum. Reads the RAW props each Pressable receives
// (captured above) rather than the rendered DOM node — the shared mock drops
// Pressable's `style` before rendering, so a DOM-based assertion can't see it
// either way.
function flattenStyle(
  style: unknown,
  pressed = false,
): Record<string, unknown> {
  if (typeof style === "function") {
    return flattenStyle(
      (style as (state: { pressed: boolean }) => unknown)({ pressed }),
    );
  }
  if (Array.isArray(style)) {
    return style.reduce(
      (acc: Record<string, unknown>, s) => ({ ...acc, ...flattenStyle(s) }),
      {},
    );
  }
  return (style as Record<string, unknown> | null | undefined) ?? {};
}

function flattenHitSlop(hitSlop: unknown): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  if (typeof hitSlop === "number") {
    return { top: hitSlop, bottom: hitSlop, left: hitSlop, right: hitSlop };
  }
  if (hitSlop && typeof hitSlop === "object") {
    const h = hitSlop as Record<string, number>;
    return {
      top: h.top ?? 0,
      bottom: h.bottom ?? 0,
      left: h.left ?? 0,
      right: h.right ?? 0,
    };
  }
  return { top: 0, bottom: 0, left: 0, right: 0 };
}

/** visual box size (explicit width/height, or minWidth/minHeight, or the
 * given fallback) PLUS hitSlop on each axis — hitSlop always adds to the
 * visual box, it never gets shadowed by an explicit size. */
function effectiveTouchSize(
  props: Record<string, unknown> | undefined,
  fallbackVisualSize: number,
): { width: number; height: number } {
  const style = flattenStyle(props?.style);
  const hitSlop = flattenHitSlop(props?.hitSlop);
  const visualWidth =
    typeof style.width === "number"
      ? style.width
      : typeof style.minWidth === "number"
        ? style.minWidth
        : fallbackVisualSize;
  const visualHeight =
    typeof style.height === "number"
      ? style.height
      : typeof style.minHeight === "number"
        ? style.minHeight
        : fallbackVisualSize;
  return {
    width: visualWidth + hitSlop.left + hitSlop.right,
    height: visualHeight + hitSlop.top + hitSlop.bottom,
  };
}

describe("LabelAnalysisScreen — touch targets meet the 44pt minimum (P2-2026-09-23, M13)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteAsync.mockResolvedValue(undefined);
    mockRoute.params = { imageUri: IMAGE_URI, barcode: BARCODE };
    mockUpload.mockResolvedValue({
      sessionId: "session-1",
      labelData: {
        servingSize: "1 cup",
        servingsPerContainer: 2,
        calories: 250,
        totalFat: 10,
        saturatedFat: 2,
        transFat: 0,
        cholesterol: 5,
        sodium: 300,
        totalCarbs: 30,
        dietaryFiber: 3,
        totalSugars: 12,
        addedSugars: 5,
        protein: 8,
        vitaminD: null,
        calcium: null,
        iron: null,
        potassium: null,
        confidence: 0.9,
      },
    });
    for (const key of Object.keys(capturedPressProps)) {
      delete capturedPressProps[key];
    }
  });

  // NOTE: this assertion reads the raw hitSlop/style PROPS the Pressable
  // receives — it proves the numbers add up to >=44, but RN also clips
  // hitSlop to the parent view's bounds, which this jsdom mock does not
  // model. styles.servingControls (LabelAnalysisScreen.tsx) carries
  // `padding: Spacing.xs` (4) specifically so the +/- buttons' hitSlop={4}
  // has real room to expand into on every axis — verified by inspection, not
  // by this test. A future edit that shrinks/removes that padding would pass
  // this test while still clipping the touch target on-device.
  it("Decrease/Increase servings buttons reach 44pt on both axes (visual 36x36 + hitSlop)", async () => {
    renderComponent(<LabelAnalysisScreen />);

    await screen.findByLabelText("Decrease servings");

    // styles.servingButton (LabelAnalysisScreen.tsx) is a fixed 36x36 box.
    const decrease = effectiveTouchSize(
      capturedPressProps["Decrease servings"],
      36,
    );
    const increase = effectiveTouchSize(
      capturedPressProps["Increase servings"],
      36,
    );
    expect(decrease.width).toBeGreaterThanOrEqual(44);
    expect(decrease.height).toBeGreaterThanOrEqual(44);
    expect(increase.width).toBeGreaterThanOrEqual(44);
    expect(increase.height).toBeGreaterThanOrEqual(44);
  });
});
