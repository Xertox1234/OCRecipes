import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { MEAL_AUDIENCES } from "../types/family";

// Family profiles hold details about other people, some of them children,
// entered by the account holder. Both policies must say what is kept, that it
// is not sent to AI providers, and how it is cleared.
describe("site: privacy policy covers family profiles", () => {
  const page = fs.readFileSync("site/privacy/index.html", "utf8");

  it("says what a family profile holds and who creates it", () => {
    expect(page).toContain("<h3>People you plan meals for</h3>");
    expect(page).toContain(
      "a name, and if you choose to add them, their allergies and a short note",
    );
    expect(page).toContain("They do not have accounts");
  });

  it("says family profiles are not sent to AI providers", () => {
    expect(page).toContain(
      "Family profiles are not sent to the companies that run our AI.",
    );
  });

  it("says how family profile details are cleared", () => {
    expect(page).toContain(
      "If you withdraw your consent to our use of health information, the allergies and notes on every family profile are deleted",
    );
    expect(page).toContain(
      "<strong>Family profiles:</strong> deleted when you delete them or delete your account.",
    );
  });
});

describe("site: health data policy covers family profiles", () => {
  const page = fs.readFileSync("site/health-privacy/index.html", "utf8");

  it("lists family members' allergies as a category it collects", () => {
    expect(page).toContain("<td>Family members’ allergies</td>");
    expect(page).toContain("We do not share this category with anyone.");
  });

  it("names you as the source", () => {
    expect(page).toContain(
      "including the family profiles you create for people you plan meals for",
    );
  });
});

// The database CHECK is written by hand in the migration; an audience added to
// the shared list without it would be refused by the database at runtime.
describe("meal audiences", () => {
  it("match the database CHECK in migration 0047 and in the schema", () => {
    const ids = MEAL_AUDIENCES.map((a) => `'${a}'`).join(", ");
    for (const file of [
      "migrations/0047_family_profiles.sql",
      "shared/schema.ts",
    ]) {
      expect(fs.readFileSync(file, "utf8")).toContain(`IN (${ids})`);
    }
  });
});
