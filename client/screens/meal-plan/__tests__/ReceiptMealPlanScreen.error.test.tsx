// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";

import { renderComponent } from "../../../../test/utils/render-component";
import { ApiError } from "@/lib/api-error";
import ReceiptMealPlanScreen from "../ReceiptMealPlanScreen";

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn(), goBack: vi.fn() }),
  useRoute: () => ({ params: {} }),
}));

vi.mock("@/hooks/useGenerateMealPlan", () => ({
  useGenerateMealPlanFromPantry: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: true,
    error: new ApiError(
      '400: {"error":"Add a few pantry items first"}',
      "VALIDATION_ERROR",
      400,
    ),
  }),
  useSaveGeneratedMealPlan: () => ({ mutate: vi.fn(), isPending: false }),
}));

const confirmBatch = vi.hoisted(() =>
  vi.fn(async () => ({ proceed: true, note: null })),
);
vi.mock("@/hooks/useConfirmPlanPick", () => ({
  useConfirmPlanBatch: () => confirmBatch,
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

// Accessibility audit 2026-11-21 M5: the generate-plan error (often the
// server's own reason, e.g. an empty pantry) was a plain View — no alert role,
// live region or announcement, so screen-reader users never heard it.
describe("ReceiptMealPlanScreen generate error", () => {
  it("shows the reason as an alert", () => {
    renderComponent(<ReceiptMealPlanScreen />);
    expect(screen.getByRole("alert").textContent).toContain(
      "Add a few pantry items first",
    );
  });
});
