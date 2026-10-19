// @vitest-environment jsdom
//
// RecipeCreate's "Discard changes?" guard (visual QA sweep #14). Every other
// confirm in the app goes through the shared ConfirmationModal sheet; this one
// used the native Alert, which looks different and is not themed.
import React from "react";
import { Alert } from "react-native";
import { usePreventRemove } from "@react-navigation/native";

import { renderComponent } from "../../../../test/utils/render-component";
import RecipeCreateScreen from "../RecipeCreateScreen";

const { mockDispatch, mockConfirm, wizardProps } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  mockConfirm: vi.fn(),
  wizardProps: { current: null as Record<string, unknown> | null },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    goBack: vi.fn(),
    popToTop: vi.fn(),
    dispatch: mockDispatch,
  }),
  useRoute: () => ({ params: {} }),
  usePreventRemove: vi.fn(),
}));

// The wizard itself is a separate component with its own tests; here it is a
// stub that hands back its props so the test can mark the form dirty.
vi.mock("@/components/recipe-wizard/WizardShell", () => ({
  default: (props: Record<string, unknown>) => {
    wizardProps.current = props;
    return null;
  },
}));

vi.mock("@/components/ConfirmationModal", () => ({
  useConfirmationModal: () => ({
    confirm: mockConfirm,
    ConfirmationModal: () => null,
    behindContentA11yProps: {},
  }),
}));

vi.mock("@/hooks/useFromHomeBackRedirect", () => ({
  BACK_ACTION_TYPES: new Set(["GO_BACK"]),
  redirectToHomeTab: vi.fn(),
}));

interface PreventRemoveEvent {
  preventDefault: () => void;
  data: { action: { type: string } };
}

/** Fire the back action the way React Navigation would. */
function leaveScreen() {
  const calls = vi.mocked(usePreventRemove).mock.calls;
  const handler = calls[calls.length - 1][1] as (e: PreventRemoveEvent) => void;
  handler({
    preventDefault: vi.fn(),
    data: { action: { type: "GO_BACK" } },
  });
}

function markDirty() {
  const onDirtyChange = wizardProps.current?.onDirtyChange as (
    dirty: boolean,
  ) => void;
  onDirtyChange(true);
}

describe("RecipeCreateScreen discard guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wizardProps.current = null;
  });

  it("asks through the shared sheet, not the native Alert, when the form is dirty", () => {
    renderComponent(<RecipeCreateScreen />);
    markDirty();
    leaveScreen();

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Discard changes?", destructive: true }),
    );
    expect(mockDispatch).not.toHaveBeenCalled();

    // Confirming leaves the screen the way the back action would have.
    (mockConfirm.mock.calls[0][0] as { onConfirm: () => void }).onConfirm();
    expect(mockDispatch).toHaveBeenCalledWith({ type: "GO_BACK" });
  });

  it("leaves at once when nothing changed", () => {
    renderComponent(<RecipeCreateScreen />);
    leaveScreen();

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith({ type: "GO_BACK" });
  });
});
