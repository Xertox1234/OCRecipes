// @vitest-environment jsdom
/**
 * Accessibility audit 2026-11-06 L2: text-link Pressables ("Try again",
 * "Skip for now", "Retry", "Not now") were ~24–36pt tall. Like the icon
 * buttons in client/components/__tests__/touch-targets.test.tsx, they must
 * be a real 44pt box (minWidth/minHeight 44) with no hitSlop.
 *
 * The shared react-native mock drops Pressable's `style`, so this file wraps
 * Pressable to capture its raw props, keyed by accessibilityLabel.
 */
import React from "react";
import { screen, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import TasteProfileScreen from "../TasteProfileScreen";
import TastePicksScreen from "../onboarding/TastePicksScreen";
import CoachRemindersScreen from "../CoachRemindersScreen";
import HealthDataConsentScreen from "../onboarding/HealthDataConsentScreen";

const { captured, mockApiRequest } = vi.hoisted(() => ({
  captured: {} as Record<string, Record<string, unknown>>,
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({ apiRequest: mockApiRequest }));
vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({ updateUser: vi.fn() }),
}));
vi.mock("@/context/OnboardingContext", () => ({
  useOnboarding: () => ({
    data: { dietType: null },
    updateData: vi.fn(),
    nextStep: vi.fn(),
    prevStep: vi.fn(),
  }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn(), goBack: vi.fn() }),
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const Capturing = React.forwardRef<unknown, Record<string, unknown>>(
    (props, ref) => {
      const label = props.accessibilityLabel as string | undefined;
      if (label) captured[label] = props;
      return React.createElement(
        actual.Pressable as React.ComponentType<Record<string, unknown>>,
        { ...props, ref },
      );
    },
  );
  Capturing.displayName = "Pressable";
  return { ...actual, Pressable: Capturing };
});

function flatten(style: unknown): Record<string, unknown> {
  if (typeof style === "function") {
    return flatten(
      (style as (s: { pressed: boolean }) => unknown)({ pressed: false }),
    );
  }
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, s) => ({ ...acc, ...flatten(s) }),
      {},
    );
  }
  return (style as Record<string, unknown> | null | undefined) ?? {};
}

function expectRealBox(label: string) {
  const props = captured[label];
  expect(props, `no Pressable captured for "${label}"`).toBeDefined();
  expect(props.hitSlop).toBeUndefined();
  const style = flatten(props.style);
  expect(style.minWidth).toBeGreaterThanOrEqual(44);
  expect(style.minHeight).toBeGreaterThanOrEqual(44);
}

beforeEach(() => {
  for (const k of Object.keys(captured)) delete captured[k];
  mockApiRequest.mockReset();
});

describe("text-link touch targets are a real 44pt box", () => {
  it("TasteProfile: Try again after a failed load", async () => {
    mockApiRequest.mockRejectedValue(new Error("offline"));
    renderComponent(<TasteProfileScreen />);
    await waitFor(() => screen.getByLabelText("Retry loading recipes"));
    expectRealBox("Retry loading recipes");
  });

  it("TastePicks: Try again after a failed load, and Skip for now", async () => {
    mockApiRequest.mockRejectedValue(new Error("offline"));
    renderComponent(<TastePicksScreen />);
    await waitFor(() => screen.getByLabelText("Retry loading recipes"));
    expectRealBox("Retry loading recipes");
    expectRealBox("Skip for now");
  });

  it("CoachReminders: Retry after a failed load", async () => {
    mockApiRequest.mockRejectedValue(new Error("offline"));
    renderComponent(<CoachRemindersScreen />);
    await waitFor(() =>
      screen.getByLabelText("Retry loading reminder settings"),
    );
    expectRealBox("Retry loading reminder settings");
  });

  it("HealthDataConsent: Not now", () => {
    renderComponent(<HealthDataConsentScreen />);
    expectRealBox("Not now, skip health data sharing");
  });
});
