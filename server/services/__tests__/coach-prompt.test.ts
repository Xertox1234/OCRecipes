import { describe, it, expect } from "vitest";
import { getSystemPromptTemplateVersion } from "../coach-prompt";

describe("coach-prompt template version", () => {
  // The hash feeds coach cache keys. A pure module move must not change it;
  // an intentional prompt edit updates this pin on purpose.
  it("is byte-identical to the pre-split value", () => {
    expect(getSystemPromptTemplateVersion()).toBe("b28e7ee438e62ac8");
  });
});
