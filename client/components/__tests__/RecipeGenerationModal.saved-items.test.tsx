// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderComponent } from "../../../test/utils/render-component";
import { apiRequest } from "@/lib/query-client";
import { RecipeGenerationModal } from "../RecipeGenerationModal";

vi.mock("@/lib/query-client", () => ({ apiRequest: vi.fn() }));

// The server adds a generated recipe to Saved items, so the list and its
// count must refetch or the new recipe stays hidden until a restart.
describe("RecipeGenerationModal — Saved items refresh", () => {
  it("invalidates the saved-items list and count after generating", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      json: async () => ({ id: 2, title: "Pasta Bowl" }),
    } as Response);
    const spy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const onComplete = vi.fn();
    renderComponent(
      <RecipeGenerationModal
        visible
        onClose={vi.fn()}
        onComplete={onComplete}
        productName="Oats"
      />,
    );
    fireEvent.click(screen.getByLabelText("Generate recipe"));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith({ queryKey: ["/api/saved-items"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["/api/saved-items/count"] });
    spy.mockRestore();
  });
});
