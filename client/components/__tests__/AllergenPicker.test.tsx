// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../test/utils/render-component";
import { AllergenPicker } from "../AllergenPicker";

describe("AllergenPicker", () => {
  it("picking an allergen asks for its severity, then reports the new list", () => {
    const onChange = vi.fn();
    renderComponent(<AllergenPicker value={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Peanuts" }));
    // Nothing is reported until the severity is chosen.
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^Severe:/ }));
    expect(onChange).toHaveBeenCalledWith([
      { name: "peanuts", severity: "severe" },
    ]);
  });

  it("shows a chosen allergen as checked, and tapping it removes it", () => {
    const onChange = vi.fn();
    renderComponent(
      <AllergenPicker
        value={[
          { name: "peanuts", severity: "mild" },
          { name: "milk", severity: "severe" },
        ]}
        onChange={onChange}
      />,
    );

    const peanuts = screen.getByRole("checkbox", { name: "Peanuts" });
    expect(peanuts.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(peanuts);
    expect(onChange).toHaveBeenCalledWith([
      { name: "milk", severity: "severe" },
    ]);
  });

  it("changes a severity by removing the allergen and picking it again", () => {
    const onChange = vi.fn();
    const { rerender } = renderComponent(
      <AllergenPicker
        value={[{ name: "peanuts", severity: "mild" }]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Peanuts" }));
    expect(onChange).toHaveBeenLastCalledWith([]);

    rerender(<AllergenPicker value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Peanuts" }));
    fireEvent.click(screen.getByRole("button", { name: /^Moderate:/ }));
    expect(onChange).toHaveBeenLastCalledWith([
      { name: "peanuts", severity: "moderate" },
    ]);
  });

  it("ticks once per pick and does nothing while disabled", () => {
    const onChange = vi.fn();
    vi.mocked(Haptics.selectionAsync).mockClear();
    renderComponent(<AllergenPicker value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Peanuts" }));
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it("ignores taps while disabled", () => {
    const onChange = vi.fn();
    renderComponent(<AllergenPicker value={[]} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Peanuts" }));
    expect(screen.queryByRole("button", { name: /^Severe:/ })).toBeNull();
  });
});
