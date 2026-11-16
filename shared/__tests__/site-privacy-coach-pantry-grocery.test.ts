import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { AI_SHARED_DATA } from "../lib/ai-sharing";

// Coach's tools read the pantry and the grocery lists and send what they read
// to the AI providers. The in-app disclosure and the policy must both say so.
describe("site: privacy policy covers the pantry and grocery lists Coach reads", () => {
  const page = fs.readFileSync("site/privacy/index.html", "utf8");

  it("says the AI coach receives pantry items and grocery list items", () => {
    expect(page).toContain(
      "When it looks at them to answer you, the AI coach also receives your pantry items and the items on your grocery lists",
    );
  });

  it("matches the in-app disclosure", () => {
    expect(AI_SHARED_DATA.join(" ")).toMatch(/pantry items and grocery lists/);
  });
});
