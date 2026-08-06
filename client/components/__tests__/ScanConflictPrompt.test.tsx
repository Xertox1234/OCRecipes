// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
// Repo convention: renderComponent wraps RTL-for-web + QueryClient (jsdom).
// Do NOT import @testing-library/react-native — the repo does not use it
// (not even installed; only @testing-library/react is a dependency).
import { renderComponent } from "../../../test/utils/render-component";
import { ScanConflictPrompt } from "@/components/ScanConflictPrompt";
// Type-only import of the SERVER's union. It is the definition the wire format
// carries and the thing `FIELD_LABEL` has to stay total over, so importing it
// here is what makes the exhaustiveness check below mean anything — a local
// copy would just be a second list to forget to update. `import type` is erased
// at build, so no server module is pulled into the client bundle.
import type { ConflictField } from "../../../server/services/label-override";

const db = { productName: "Cherry Coke", calories: 39, sugar: 11 } as any;
const label = { productName: "Cherry Coke", calories: 150, sugar: 39 } as any;

describe("ScanConflictPrompt", () => {
  it("renders both values for each conflicting field, label selected by default", () => {
    const { getByText, getAllByText, getByLabelText } = renderComponent(
      <ScanConflictPrompt
        conflictFields={["calories", "sugar"]}
        labelNutrition={label}
        dbNutrition={db}
        activeSource="label"
        onChoose={() => {}}
      />,
    );
    expect(getByText("150")).toBeTruthy(); // label calories
    // "39" is db calories AND label sugar — two distinct nodes by design
    // (getByText would throw "multiple elements"; getAllByText asserts both).
    expect(getAllByText("39")).toHaveLength(2);
    // label option announces selection for screen readers
    expect(getByLabelText(/label.*selected/i)).toBeTruthy();
  });

  it("calls onChoose('database') when the database option is tapped", () => {
    const onChoose = vi.fn();
    const { getByLabelText } = renderComponent(
      <ScanConflictPrompt
        conflictFields={["calories"]}
        labelNutrition={label}
        dbNutrition={db}
        activeSource="label"
        onChoose={onChoose}
      />,
    );
    fireEvent.click(getByLabelText(/use database/i));
    expect(onChoose).toHaveBeenCalledWith("database");
  });

  it("calls onChoose('label') when the label option is tapped", () => {
    const onChoose = vi.fn();
    const { getByLabelText } = renderComponent(
      <ScanConflictPrompt
        conflictFields={["calories"]}
        labelNutrition={label}
        dbNutrition={db}
        activeSource="database"
        onChoose={onChoose}
      />,
    );
    fireEvent.click(getByLabelText(/use label/i));
    expect(onChoose).toHaveBeenCalledWith("label");
  });

  it("gives every server ConflictField a human label — saturatedFat is not shown as a raw key", () => {
    // `conflictFields` crosses the wire as `string[]`, so a member of the
    // server's `ConflictField` union that is missing from `FIELD_LABEL` is not
    // a type error — it falls through to `?? f` and puts the camelCase key
    // both on screen and inside the radio's accessibilityLabel. Assert the
    // rendered text and the a11y label, not just "it rendered".
    const satLabel = { ...label, saturatedFat: 6.3 };
    const satDb = { ...db, saturatedFat: 0.6 };
    const { getByText, queryByText, getByLabelText, queryByLabelText } =
      renderComponent(
        <ScanConflictPrompt
          conflictFields={["saturatedFat"]}
          labelNutrition={satLabel}
          dbNutrition={satDb}
          activeSource="label"
          onChoose={() => {}}
        />,
      );
    expect(queryByText(/saturatedFat/)).toBeNull();
    expect(queryByLabelText(/saturatedFat/)).toBeNull();
    // Two columns (label + database), each printing the field name.
    expect(getByText("6.3")).toBeTruthy();
    expect(getByText("0.6")).toBeTruthy();
    expect(getByLabelText(/Saturated Fat \(g\) 6\.3/)).toBeTruthy();
  });

  it("renders a human label for EVERY member of the server's ConflictField union", () => {
    // The generalisation of the test above, and the reason `REQUIRED` exists.
    //
    // `saturatedFat` nearly reached the screen — and VoiceOver — as a raw
    // camelCase key, because nothing connects the server's union to the
    // client's `FIELD_LABEL` map: `conflictFields` crosses the wire as
    // `string[]`, so `tsc` cannot see a missing entry and the component falls
    // through to `?? f`. A per-field runtime warning in the render path was
    // rejected as the fix — it would fire once per field per column per
    // render.
    //
    // `REQUIRED` closes it at COMPILE time instead: it is a total
    // `Record<ConflictField, true>`, so adding a fifth member to the union
    // upstream makes this file fail `tsc` until the member is listed here, and
    // the loop below then fails until `FIELD_LABEL` has copy for it.
    const REQUIRED: Record<ConflictField, true> = {
      calories: true,
      sugar: true,
      fat: true,
      saturatedFat: true,
    };
    const fields = Object.keys(REQUIRED) as ConflictField[];

    const { queryByText } = renderComponent(
      <ScanConflictPrompt
        conflictFields={fields}
        labelNutrition={label}
        dbNutrition={db}
        activeSource="label"
        onChoose={() => {}}
      />,
    );
    // Exact-text queries: "Calories" is not "calories", so a hit here means the
    // raw union key itself was rendered.
    for (const f of fields) expect(queryByText(f)).toBeNull();
  });

  it("follows activeSource in both directions — database selected flips which column reports selected", () => {
    const { getByLabelText } = renderComponent(
      <ScanConflictPrompt
        conflictFields={["calories"]}
        labelNutrition={label}
        dbNutrition={db}
        activeSource="database"
        onChoose={() => {}}
      />,
    );
    expect(getByLabelText(/database.*selected/i)).toBeTruthy();
    expect(getByLabelText(/label.*not selected/i)).toBeTruthy();
  });
});
