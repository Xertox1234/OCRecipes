// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { MAX_FAMILY_PROFILES } from "@shared/types/family";
import FamilyProfilesScreen from "../FamilyProfilesScreen";

const { mockNavigate, mockConfirm, mockDeleteMutate, mockToast, state } =
  vi.hoisted(() => ({
    mockNavigate: vi.fn(),
    mockConfirm: vi.fn(),
    mockDeleteMutate: vi.fn(),
    mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
    state: {
      profiles: [] as unknown[],
      isLoading: false,
      isError: false,
      premium: true,
      planUnknown: false,
      deleting: null as number | null,
    },
  }));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));
vi.mock("@/components/ConfirmationModal", () => ({
  useConfirmationModal: () => ({
    confirm: mockConfirm,
    ConfirmationModal: () => null,
    behindContentA11yProps: {},
    isOpen: false,
  }),
}));
vi.mock("@/hooks/useFamily", () => ({
  useFamilyProfilesList: () => ({
    profiles: state.profiles,
    isLoading: state.isLoading,
    isError: state.isError,
    refetch: vi.fn(),
  }),
  useDeleteFamilyProfile: () => ({
    mutate: mockDeleteMutate,
    isPending: state.deleting !== null,
    variables: state.deleting ?? undefined,
  }),
}));
vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: () => state.premium,
}));
vi.mock("@/hooks/usePlanCheck", () => ({
  usePlanCheck: () => ({
    planUnknown: state.planUnknown,
    recheckPlan: vi.fn(),
  }),
}));
vi.mock("@/context/ToastContext", () => ({ useToast: () => mockToast }));

const person = (id: number, name: string, allergies = [] as unknown[]) => ({
  id,
  userId: "u",
  name,
  allergies,
  note: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  state.profiles = [];
  state.isLoading = false;
  state.isError = false;
  state.premium = true;
  state.planUnknown = false;
  state.deleting = null;
});

describe("FamilyProfilesScreen", () => {
  it("lists each person with an allergy summary as a button that opens their form", () => {
    state.profiles = [
      person(1, "Ivy", [{ name: "peanuts", severity: "severe" }]),
      person(2, "Sam"),
    ];
    renderComponent(<FamilyProfilesScreen />);

    expect(screen.getByText("Ivy")).toBeTruthy();
    expect(screen.getByText("Peanuts")).toBeTruthy();
    expect(screen.getByText("No allergies listed")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Ivy. Peanuts" }));
    expect(mockNavigate).toHaveBeenCalledWith("FamilyProfileEdit", {
      profileId: 1,
    });
  });

  it("Add a family member opens an empty form", () => {
    state.profiles = [person(1, "Ivy")];
    renderComponent(<FamilyProfilesScreen />);
    fireEvent.click(
      screen.getByRole("button", { name: "Add a family member" }),
    );
    expect(mockNavigate).toHaveBeenCalledWith("FamilyProfileEdit", {});
  });

  it("shows an empty state with an add action when there is nobody yet", () => {
    renderComponent(<FamilyProfilesScreen />);
    expect(screen.getByText("No one added yet")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Add a family member" }),
    );
    expect(mockNavigate).toHaveBeenCalledWith("FamilyProfileEdit", {});
  });

  it("at the limit, hides Add and says why", () => {
    state.profiles = Array.from({ length: MAX_FAMILY_PROFILES }, (_, i) =>
      person(i + 1, `Person ${i + 1}`),
    );
    renderComponent(<FamilyProfilesScreen />);
    expect(
      screen.queryByRole("button", { name: "Add a family member" }),
    ).toBeNull();
    expect(
      screen.getByText(`You can add up to ${MAX_FAMILY_PROFILES} people`),
    ).toBeTruthy();
  });

  it("delete names the person, asks with the exact message, and deletes only on confirm", () => {
    state.profiles = [person(7, "Ivy")];
    renderComponent(<FamilyProfilesScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Ivy" }));

    expect(mockDeleteMutate).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    const options = mockConfirm.mock.calls[0][0];
    expect(options.message).toBe(
      "This removes Ivy and the meals planned just for them. Meals for everyone stay.",
    );
    expect(options.destructive).toBe(true);

    options.onConfirm();
    expect(mockDeleteMutate).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );

    mockDeleteMutate.mock.calls[0][1].onError();
    expect(mockToast.error).toHaveBeenCalledWith(
      "Couldn't remove Ivy. Please try again.",
    );
    mockDeleteMutate.mock.calls[0][1].onSuccess();
    expect(mockToast.success).toHaveBeenCalledWith("Removed Ivy");
  });

  it("a lapsed user can only delete: no Add, rows do not open the form", () => {
    state.premium = false;
    state.profiles = [person(1, "Ivy")];
    renderComponent(<FamilyProfilesScreen />);

    expect(
      screen.queryByRole("button", { name: "Add a family member" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /^Ivy\./ })).toBeNull();
    expect(
      screen.getByText(/no longer includes family profiles/i),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove Ivy" }));
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("an unknown plan is neutral: the editing controls stay", () => {
    state.premium = false;
    state.planUnknown = true;
    state.profiles = [person(1, "Ivy")];
    renderComponent(<FamilyProfilesScreen />);
    expect(
      screen.getByRole("button", { name: "Add a family member" }),
    ).toBeTruthy();
    expect(screen.queryByText(/no longer includes/i)).toBeNull();
  });

  it("a failed load offers Try Again and no Add (an unseen list could be full)", () => {
    state.isError = true;
    renderComponent(<FamilyProfilesScreen />);
    expect(screen.getByRole("button", { name: "Try Again" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Add a family member" }),
    ).toBeNull();
  });

  it("disables a row's controls while it is being removed", () => {
    state.profiles = [person(1, "Ivy")];
    state.deleting = 1;
    renderComponent(<FamilyProfilesScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Ivy" }));
    expect(mockConfirm).not.toHaveBeenCalled();
  });
});
