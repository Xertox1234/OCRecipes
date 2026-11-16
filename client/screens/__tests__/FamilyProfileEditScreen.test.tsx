// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../test/utils/render-component";
import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";
import { HEALTH_CONSENT_PROMPT } from "@/lib/health-consent";
import FamilyProfileEditScreen from "../FamilyProfileEditScreen";

const {
  mockGoBack,
  mockConfirm,
  mockCreate,
  mockUpdate,
  mockGrant,
  mockToast,
  mockNotification,
  state,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockConfirm: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockGrant: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  mockNotification: vi.fn(),
  state: {
    params: undefined as { profileId?: number } | undefined,
    profiles: [] as unknown[],
    isLoading: false,
    isError: false,
    consented: true,
  },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: vi.fn() }),
  useRoute: () => ({ params: state.params }),
}));
vi.mock("@/components/ConfirmationModal", () => ({
  useConfirmationModal: () => ({
    confirm: mockConfirm,
    ConfirmationModal: () => null,
    behindContentA11yProps: {},
    isOpen: false,
  }),
}));
// react-native-keyboard-controller ships untransformed native source — passthrough.
vi.mock("react-native-keyboard-controller", () => ({
  KeyboardAwareScrollView: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/components/InlineError", () => ({
  InlineError: ({
    message,
    shakeKey,
  }: {
    message?: string | null;
    shakeKey?: number;
  }) =>
    message ? (
      <div role="alert" data-shake-key={shakeKey}>
        {message}
      </div>
    ) : null,
}));
vi.mock("@/hooks/useFamily", () => ({
  useFamilyProfilesList: () => ({
    profiles: state.profiles,
    isLoading: state.isLoading,
    isError: state.isError,
    refetch: vi.fn(),
  }),
  useCreateFamilyProfile: () => ({ mutateAsync: mockCreate }),
  useUpdateFamilyProfile: () => ({ mutateAsync: mockUpdate }),
}));
vi.mock("@/hooks/useHealthConsent", () => ({
  useHealthConsent: () => ({ consented: state.consented, grant: mockGrant }),
}));
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: mockNotification,
    selection: vi.fn(),
  }),
}));
vi.mock("@/context/ToastContext", () => ({ useToast: () => mockToast }));

function typeName(value: string) {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value } });
}
function pickAllergen(label: string, severity: RegExp) {
  fireEvent.click(screen.getByRole("checkbox", { name: label }));
  fireEvent.click(screen.getByRole("button", { name: severity }));
}
const save = () => screen.getByRole("button", { name: "Save" });

beforeEach(() => {
  vi.clearAllMocks();
  state.params = undefined;
  state.profiles = [];
  state.isLoading = false;
  state.isError = false;
  state.consented = true;
  mockCreate.mockResolvedValue({});
  mockUpdate.mockResolvedValue({});
  mockGrant.mockResolvedValue(undefined);
});

describe("FamilyProfileEditScreen — adding", () => {
  it("rejects a blank name with a message, a shake and the error haptic, and sends nothing", () => {
    renderComponent(<FamilyProfileEditScreen />);
    typeName("   ");
    fireEvent.click(save());

    expect(screen.getByRole("alert").textContent).toBe(
      "Enter a name for this person.",
    );
    const first = screen.getByRole("alert").getAttribute("data-shake-key");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockNotification).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );

    fireEvent.click(save());
    // A second reject shakes again: the key moves on.
    expect(screen.getByRole("alert").getAttribute("data-shake-key")).not.toBe(
      first,
    );
  });

  it("saves the trimmed name, the allergies and a null note, then closes with a success moment", async () => {
    renderComponent(<FamilyProfileEditScreen />);
    typeName("  Ivy ");
    pickAllergen("Peanuts", /^Severe:/);
    fireEvent.click(save());

    await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith({
      name: "Ivy",
      allergies: [{ name: "peanuts", severity: "severe" }],
      note: null,
    });
    expect(mockNotification).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
    expect(mockToast.success).toHaveBeenCalledWith(
      "Saved Ivy",
      expect.objectContaining({ haptic: false }),
    );
  });

  it("asks for the health-data consent before saving allergies, then grants it and saves", async () => {
    state.consented = false;
    renderComponent(<FamilyProfileEditScreen />);
    typeName("Ivy");
    pickAllergen("Peanuts", /^Mild:/);
    fireEvent.click(save());

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    const options = mockConfirm.mock.calls[0][0];
    expect(options.title).toBe(HEALTH_CONSENT_PROMPT.title);
    expect(options.confirmLabel).toBe("Agree");

    await act(async () => options.onConfirm());
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockGrant.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreate.mock.invocationCallOrder[0],
    );
  });

  it("asks for consent before saving a note too", () => {
    state.consented = false;
    renderComponent(<FamilyProfileEditScreen />);
    typeName("Ivy");
    fireEvent.change(screen.getByLabelText("Note (optional)"), {
      target: { value: "Likes plain pasta" },
    });
    fireEvent.click(save());
    expect(mockConfirm).toHaveBeenCalledTimes(1);
  });

  it("needs no consent for a name alone", async () => {
    state.consented = false;
    renderComponent(<FamilyProfileEditScreen />);
    typeName("Ivy");
    fireEvent.click(save());
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it("does not save when the consent could not be recorded", async () => {
    state.consented = false;
    mockGrant.mockRejectedValue(new Error("offline"));
    renderComponent(<FamilyProfileEditScreen />);
    typeName("Ivy");
    pickAllergen("Peanuts", /^Mild:/);
    fireEvent.click(save());
    await act(async () => mockConfirm.mock.calls[0][0].onConfirm());

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).not.toMatch(/offline/);
  });

  it("a second press while saving sends nothing more, and Save shows its loading state", async () => {
    let finish!: () => void;
    mockCreate.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    renderComponent(<FamilyProfileEditScreen />);
    typeName("Ivy");
    const button = save();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Saving/ })).toBeTruthy(),
    );

    await act(async () => finish());
    await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  });

  it("a rejected save keeps the draft and says why in plain words", async () => {
    mockCreate.mockRejectedValue(
      new ApiError("409: raw", ErrorCode.LIMIT_REACHED, 409),
    );
    renderComponent(<FamilyProfileEditScreen />);
    typeName("Ivy");
    fireEvent.click(save());

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toBe(
      "You can add up to 8 people.",
    );
    expect(mockGoBack).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Ivy",
    );
    expect(mockNotification).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
  });
});

describe("FamilyProfileEditScreen — editing", () => {
  const ivy = {
    id: 3,
    userId: "u",
    name: "Ivy",
    allergies: [{ name: "milk", severity: "mild" }],
    note: "Plain pasta",
  };

  it("prefills from the saved profile and updates it by id", async () => {
    state.params = { profileId: 3 };
    state.profiles = [ivy];
    renderComponent(<FamilyProfileEditScreen />);

    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Ivy",
    );
    expect(
      screen
        .getByRole("checkbox", { name: "Dairy/Milk" })
        .getAttribute("aria-checked"),
    ).toBe("true");

    typeName("Ivy R");
    fireEvent.click(save());
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith({
      id: 3,
      input: {
        name: "Ivy R",
        allergies: [{ name: "milk", severity: "mild" }],
        note: "Plain pasta",
      },
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("has no form while the list failed to load, so a blank draft can never overwrite", () => {
    state.params = { profileId: 3 };
    state.isError = true;
    renderComponent(<FamilyProfileEditScreen />);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByRole("button", { name: "Try Again" })).toBeTruthy();
  });

  it("says so when the person is gone", () => {
    state.params = { profileId: 99 };
    state.profiles = [ivy];
    renderComponent(<FamilyProfileEditScreen />);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText("This person isn't here anymore")).toBeTruthy();
  });
});
