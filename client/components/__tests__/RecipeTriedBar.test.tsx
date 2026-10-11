// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { RecipeTriedBar } from "../RecipeTriedBar";
import { ApiError } from "@/lib/api-error";

const { mockApiRequest, mockTriggerPop, mockImpact, mockToastError } =
  vi.hoisted(() => ({
    mockApiRequest: vi.fn(),
    mockTriggerPop: vi.fn(),
    mockImpact: vi.fn(),
    mockToastError: vi.fn(),
  }));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

// The pop's own trigger fires the Success haptic: marking is one buzz (the
// pop); unmarking keeps the plain impact tap.
vi.mock("@/hooks/useSuccessAnimation", () => ({
  useSuccessPop: () => ({
    trigger: mockTriggerPop,
    animatedStyle: {},
    scale: { value: 1 },
  }),
}));
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    selection: vi.fn(),
    notification: vi.fn(),
  }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ error: mockToastError, success: vi.fn(), show: vi.fn() }),
}));

const ok = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) });
const zero = {
  triedCount: 0,
  triedByMe: false,
  favouritedCount: 0,
  variantCount: 0,
};

function serve(stats: typeof zero, write?: () => Promise<unknown>) {
  mockApiRequest.mockImplementation((method: string) =>
    method === "GET"
      ? Promise.resolve(ok(stats))
      : (write?.() ?? Promise.resolve(ok({}))),
  );
}

describe("RecipeTriedBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when the recipe is not public (404)", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiError("404: Recipe not found", "NOT_FOUND", 404),
    );
    renderComponent(<RecipeTriedBar recipeId={7} bottomInset={0} />);
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("marks as tried: PUT, one pop, optimistic caption", async () => {
    serve(zero, () => new Promise(() => {}));
    renderComponent(<RecipeTriedBar recipeId={7} bottomInset={0} />);
    await screen.findByText("Be the first to try it");

    fireEvent.click(
      screen.getByLabelText("I tried it, no one has tried this yet"),
    );

    // mutationFn runs after onMutate's awaited cancelQueries — a tick later.
    await waitFor(() =>
      expect(mockApiRequest).toHaveBeenCalledWith(
        "PUT",
        "/api/recipes/7/tried",
      ),
    );
    expect(mockTriggerPop).toHaveBeenCalledTimes(1);
    expect(mockImpact).not.toHaveBeenCalled();
    await screen.findByText("1 person tried this");
    expect(screen.getByText("Tried")).toBeTruthy();
  });

  it("unmarks with an impact tap and DELETE", async () => {
    serve({ ...zero, triedCount: 3, triedByMe: true });
    renderComponent(<RecipeTriedBar recipeId={7} bottomInset={0} />);
    await screen.findByText("3 people tried this");

    fireEvent.click(screen.getByLabelText("I tried it, 3 people tried this"));

    await waitFor(() =>
      expect(mockApiRequest).toHaveBeenCalledWith(
        "DELETE",
        "/api/recipes/7/tried",
      ),
    );
    expect(mockImpact).toHaveBeenCalledTimes(1);
    expect(mockTriggerPop).not.toHaveBeenCalled();
  });

  it("shows the error toast and reverts when saving fails", async () => {
    serve(zero, () => Promise.reject(new Error("network")));
    renderComponent(<RecipeTriedBar recipeId={7} bottomInset={0} />);
    await screen.findByText("Be the first to try it");

    fireEvent.click(
      screen.getByLabelText("I tried it, no one has tried this yet"),
    );

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith("Couldn't save — try again"),
    );
    await screen.findByText("Be the first to try it");
    expect(screen.getByText("I tried it")).toBeTruthy();
  });
});
