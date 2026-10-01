import {
  parseInline,
  BULLET_REGEX,
  NUMBERED_REGEX,
  spokenMarkdown,
} from "../markdown-text-utils";

describe("parseInline", () => {
  it("returns plain text unchanged", () => {
    expect(parseInline("hello world")).toEqual([{ text: "hello world" }]);
  });

  it("returns empty array for empty string", () => {
    expect(parseInline("")).toEqual([]);
  });

  it("parses **bold** text", () => {
    expect(parseInline("this is **bold** text")).toEqual([
      { text: "this is " },
      { text: "bold", bold: true },
      { text: " text" },
    ]);
  });

  it("parses *italic* text", () => {
    expect(parseInline("this is *italic* text")).toEqual([
      { text: "this is " },
      { text: "italic", italic: true },
      { text: " text" },
    ]);
  });

  it("parses multiple bold segments", () => {
    expect(parseInline("**a** and **b**")).toEqual([
      { text: "a", bold: true },
      { text: " and " },
      { text: "b", bold: true },
    ]);
  });

  it("parses mixed bold and italic", () => {
    expect(parseInline("**bold** and *italic*")).toEqual([
      { text: "bold", bold: true },
      { text: " and " },
      { text: "italic", italic: true },
    ]);
  });

  it("handles bold at start of string", () => {
    expect(parseInline("**start** rest")).toEqual([
      { text: "start", bold: true },
      { text: " rest" },
    ]);
  });

  it("handles bold at end of string", () => {
    expect(parseInline("rest **end**")).toEqual([
      { text: "rest " },
      { text: "end", bold: true },
    ]);
  });

  it("handles unclosed bold as plain text", () => {
    expect(parseInline("this is **unclosed")).toEqual([
      { text: "this is **unclosed" },
    ]);
  });

  it("handles unclosed italic as plain text", () => {
    expect(parseInline("this is *unclosed")).toEqual([
      { text: "this is *unclosed" },
    ]);
  });

  it("handles text with no markers", () => {
    expect(parseInline("plain text only")).toEqual([
      { text: "plain text only" },
    ]);
  });

  it("handles bold wrapping multiple words", () => {
    expect(parseInline("**multiple words here**")).toEqual([
      { text: "multiple words here", bold: true },
    ]);
  });

  it("handles adjacent bold and italic without space", () => {
    expect(parseInline("**bold***italic*")).toEqual([
      { text: "bold", bold: true },
      { text: "italic", italic: true },
    ]);
  });

  it("renders a markdown link as its plain text, dropping the URL", () => {
    expect(parseInline("Check out [this recipe](https://example.com)")).toEqual(
      [{ text: "Check out this recipe" }],
    );
  });

  it("still applies bold/italic markers inside link-stripped text", () => {
    expect(parseInline("[**bold link**](https://example.com)")).toEqual([
      { text: "bold link", bold: true },
    ]);
  });
});

describe("BULLET_REGEX", () => {
  it("matches dash bullet", () => {
    const match = "- item text".match(BULLET_REGEX);
    expect(match).not.toBeNull();
    expect(match![2]).toBe("item text");
  });

  it("matches asterisk bullet", () => {
    const match = "* item text".match(BULLET_REGEX);
    expect(match).not.toBeNull();
    expect(match![2]).toBe("item text");
  });

  it("matches indented bullet", () => {
    const match = "  - indented item".match(BULLET_REGEX);
    expect(match).not.toBeNull();
    expect(match![2]).toBe("indented item");
  });

  it("does not match italic (*word*)", () => {
    const match = "*italic*".match(BULLET_REGEX);
    expect(match).toBeNull();
  });

  it("does not match dash in middle of text", () => {
    const match = "some - text".match(BULLET_REGEX);
    expect(match).toBeNull();
  });

  it("does not match empty line with dash", () => {
    const match = "- ".match(BULLET_REGEX);
    expect(match).toBeNull();
  });
});

describe("NUMBERED_REGEX", () => {
  it("matches numbered item", () => {
    const match = "1. first item".match(NUMBERED_REGEX);
    expect(match).not.toBeNull();
    expect(match![2]).toBe("1");
    expect(match![3]).toBe("first item");
  });

  it("matches multi-digit numbers", () => {
    const match = "10. tenth item".match(NUMBERED_REGEX);
    expect(match).not.toBeNull();
    expect(match![2]).toBe("10");
    expect(match![3]).toBe("tenth item");
  });

  it("matches indented numbered item", () => {
    const match = "  2. second".match(NUMBERED_REGEX);
    expect(match).not.toBeNull();
    expect(match![2]).toBe("2");
    expect(match![3]).toBe("second");
  });

  it("does not match number without period", () => {
    const match = "1 item".match(NUMBERED_REGEX);
    expect(match).toBeNull();
  });

  it("does not match number in middle of text", () => {
    const match = "see item 1. here".match(NUMBERED_REGEX);
    expect(match).toBeNull();
  });

  it("does not match period without space after", () => {
    const match = "1.item".match(NUMBERED_REGEX);
    expect(match).toBeNull();
  });
});

describe("spokenMarkdown", () => {
  it("drops images, keeps link text without the URL, and collapses the gap", () => {
    expect(
      spokenMarkdown(
        "See ![pic](https://a.test/p.png) and [the recipe](https://b.test) now",
      ),
    ).toBe("See and the recipe now");
  });

  it("leaves plain text unchanged", () => {
    expect(spokenMarkdown("Eat more greens.")).toBe("Eat more greens.");
  });

  // The coach prompt asks for bold/italic and bullet lists, and MarkdownText
  // renders those without their markers — the spoken text must match.
  it("drops bold/italic markers and list markers, like MarkdownText renders", () => {
    expect(spokenMarkdown("This is **great** and *easy* advice.")).toBe(
      "This is great and easy advice.",
    );
    expect(spokenMarkdown("Snacks:\n- Almonds\n* Greek yogurt")).toBe(
      "Snacks:\nAlmonds\nGreek yogurt",
    );
    expect(spokenMarkdown("1. First step\n2. Second step")).toBe(
      "First step\nSecond step",
    );
  });

  it("drops an image-only line entirely, leaving no blank line behind", () => {
    expect(
      spokenMarkdown(
        "Here is a picture:\n![cat](https://c.test/c.png)\nIsn't it cute?",
      ),
    ).toBe("Here is a picture:\nIsn't it cute?");
    expect(spokenMarkdown("- ![cat](https://c.test/c.png)")).toBe("");
  });
});
