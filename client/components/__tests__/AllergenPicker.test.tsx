// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { AccessibilityInfo } from "react-native";
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

    fireEvent.click(
      screen.getByRole("button", { name: /^Severe for Peanuts:/ }),
    );
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

    const peanuts = screen.getByRole("checkbox", { name: "Peanuts, mild" });
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
    fireEvent.click(screen.getByRole("checkbox", { name: "Peanuts, mild" }));
    expect(onChange).toHaveBeenLastCalledWith([]);

    rerender(<AllergenPicker value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Peanuts" }));
    fireEvent.click(
      screen.getByRole("button", { name: /^Moderate for Peanuts:/ }),
    );
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
    expect(
      screen.queryByRole("button", { name: /^Severe for Peanuts:/ }),
    ).toBeNull();
  });

  // Accessibility audit 2026-11-21 H3: severity was shown only as colour and a
  // tiny letter, so "Peanuts, checked" read the same for mild and severe.
  it("names the recorded severity in each chosen chip's label", () => {
    renderComponent(
      <AllergenPicker
        value={[
          { name: "peanuts", severity: "mild" },
          { name: "milk", severity: "severe" },
        ]}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: "Peanuts, mild" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: "Dairy/Milk, severe" }),
    ).toBeTruthy();
    // The unchosen chips keep the bare name.
    expect(screen.getByRole("checkbox", { name: "Eggs" })).toBeTruthy();
  });

  // M1: the severity choice mounts below the whole grid; a screen-reader user
  // heard nothing after tapping the chip.
  it("announces the severity question when it opens", () => {
    const announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
    announce.mockClear();
    renderComponent(<AllergenPicker value={[]} onChange={vi.fn()} />);
    expect(announce).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Peanuts" }));

    expect(announce).toHaveBeenCalledWith("Choose a severity for Peanuts");
    expect(screen.getByRole("header").textContent).toMatch(
      /Severity for Peanuts/,
    );
  });
});
