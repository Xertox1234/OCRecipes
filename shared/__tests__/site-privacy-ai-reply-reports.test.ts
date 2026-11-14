import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { CHAT_MESSAGE_REPORT_REASONS } from "../constants/chat-message-report";

// Privacy audit 2026-11-10, G7: the app lets a person report an AI reply.
// Acting on a report means someone reads that reply, so the policy must say
// what a report saves, who may read the reply, and when the report goes.
describe("site: privacy policy covers reports on AI replies", () => {
  const page = fs.readFileSync("site/privacy/index.html", "utf8");

  it("says what a report saves and that the text is not copied", () => {
    expect(page).toContain("<strong>Reports on AI replies.</strong>");
    expect(page).toContain("We do not save a copy of the reply.");
  });

  it("says who may read a reported reply", () => {
    expect(page).toContain("our Privacy Officer may read that reply");
  });

  it("says when a report is deleted", () => {
    expect(page).toContain(
      "<strong>Reports on AI replies:</strong> deleted when the reply or its chat is deleted, or when you delete your account.",
    );
  });
});

// The database CHECK is written by hand in the migration; a reason added to
// the shared list without it would be refused by the database at runtime.
describe("chat message report reasons", () => {
  it("match the database CHECK in migration 0046 and in the schema", () => {
    const ids = CHAT_MESSAGE_REPORT_REASONS.map((r) => `'${r.id}'`).join(", ");
    for (const file of [
      "migrations/0046_chat_message_reports.sql",
      "shared/schema.ts",
    ]) {
      expect(fs.readFileSync(file, "utf8")).toContain(`IN (${ids})`);
    }
  });
});
