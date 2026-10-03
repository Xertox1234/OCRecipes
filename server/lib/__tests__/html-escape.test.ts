import { describe, it, expect } from "vitest";
import { escapeHtml } from "../html-escape";

describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;",
    );
  });
  it("leaves plain text untouched", () => {
    expect(escapeHtml("alice_99")).toBe("alice_99");
  });
});
