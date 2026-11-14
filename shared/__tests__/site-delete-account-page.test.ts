import { describe, it, expect } from "vitest";
import fs from "node:fs";

// Google Play asks for a web page where someone can start deleting their
// account without opening the app (privacy audit 2026-11-10, G7). Its URL is
// typed into Play Console by hand, so the page must keep existing and keep
// saying these things.
describe("site: delete-account page", () => {
  const page = fs.readFileSync("site/delete-account/index.html", "utf8");

  it("names the app and the developer", () => {
    expect(page).toContain("OCRecipes");
    expect(page).toContain("Family Meal Planning Services");
  });

  it("gives a way to ask without the app", () => {
    expect(page).toContain("mailto:support@ocrecipes.com");
  });

  it("says what is deleted and what is kept", () => {
    expect(page).toMatch(/<h2>What is deleted<\/h2>/);
    expect(page).toMatch(/<h2>What we keep<\/h2>/);
  });

  it("is linked from the homepage and the privacy policy", () => {
    for (const file of ["site/index.html", "site/privacy/index.html"]) {
      expect(fs.readFileSync(file, "utf8")).toContain('href="/delete-account"');
    }
  });
});
