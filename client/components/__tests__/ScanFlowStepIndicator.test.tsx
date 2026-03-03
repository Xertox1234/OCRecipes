// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { ScanFlowStepIndicator } from "../ScanFlowStepIndicator";

describe("ScanFlowStepIndicator", () => {
  it("renders with correct accessibility label", () => {
    renderComponent(<ScanFlowStepIndicator currentStep={2} totalSteps={3} />);
    expect(screen.getByLabelText("Scan flow: step 2 of 3")).toBeDefined();
  });

  it("renders as progressbar role", () => {
    renderComponent(<ScanFlowStepIndicator currentStep={1} totalSteps={3} />);
    expect(screen.getByRole("progressbar")).toBeDefined();
  });
});
