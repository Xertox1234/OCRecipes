// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { Alert } from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import SettingsScreen from "../SettingsScreen";

const { mockConfirm, mockLogout } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
  mockLogout: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));

vi.mock("@react-navigation/bottom-tabs", () => ({
  useBottomTabBarHeight: () => 80,
}));

vi.mock("expo-application", () => ({
  nativeApplicationVersion: "1.0.0",
  nativeBuildVersion: "1",
}));

vi.mock("expo-clipboard", () => ({
  setStringAsync: vi.fn().mockResolvedValue(true),
}));

vi.mock("expo-updates", () => ({
  runtimeVersion: "1.0.0",
  channel: null,
  updateId: null,
  createdAt: null,
  isEmbeddedLaunch: true,
  isEnabled: false,
  isEmergencyLaunch: false,
  emergencyLaunchReason: null,
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: vi.fn(),
    selection: vi.fn(),
    disabled: false,
  }),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({
    logout: mockLogout,
    deleteAccount: vi.fn(),
    changeEmail: vi.fn(),
    updateUser: vi.fn().mockResolvedValue(undefined),
    user: { id: 1, username: "testuser", measurementUnit: "metric" },
  }),
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({ isPremium: false }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: vi.fn(),
}));

// Sibling modals are exercised by their own suites — stub to keep this render
// focused on the settings list itself.
vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: () => null,
}));
vi.mock("@/components/DeleteAccountModal", () => ({
  DeleteAccountModal: () => null,
}));
vi.mock("@/components/ChangeEmailModal", () => ({
  ChangeEmailModal: () => null,
}));

vi.mock("@/components/ConfirmationModal", () => ({
  useConfirmationModal: () => ({
    confirm: mockConfirm,
    ConfirmationModal: () => null,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SettingsScreen sign-out confirmation", () => {
  // The sign-out confirm must be the in-app ConfirmationModal sheet, NEVER the
  // native Alert.alert: on the CI iOS simulator the UIAlertController renders
  // on screen but is intermittently ABSENT from the accessibility hierarchy
  // for 30s+ (issue #908, run 33935553286 attempt-1 dump: screenshot shows the
  // alert, the hierarchy dump has no alert nodes), so neither Maestro nor
  // assistive tech can reliably drive it. The in-app sheet lives in the app's
  // own view tree and is always exposed.
  it("opens the in-app confirmation sheet instead of a native alert", () => {
    renderComponent(<SettingsScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Sign Out",
        message: "Are you sure you want to sign out?",
        confirmLabel: "Yes, Sign Out",
        destructive: true,
      }),
    );
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("logs out only when the sheet's confirm action fires", () => {
    renderComponent(<SettingsScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));

    expect(mockLogout).not.toHaveBeenCalled();

    const options = mockConfirm.mock.calls[0]?.[0] as
      | { onConfirm: () => void }
      | undefined;
    expect(options).toBeDefined();
    options?.onConfirm();

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
