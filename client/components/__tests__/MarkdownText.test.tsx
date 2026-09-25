// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { MarkdownText } from "../MarkdownText";

describe("MarkdownText", () => {
  it("drops a standalone markdown image line and renders a markdown link as plain, non-tappable text", () => {
    const content = [
      "Sauteed Italian Eggplant",
      "![Sauteed Italian Eggplant](https://img.spoonacular.com/recipes/648118-312x231.jpg)",
      "[View recipe](https://example.com/recipe)",
    ].join("\n");

    renderComponent(<MarkdownText>{content}</MarkdownText>);

    // The line's own text survives.
    expect(screen.getByText("Sauteed Italian Eggplant")).toBeDefined();
    // The link's visible text survives as plain text.
    expect(screen.getByText("View recipe")).toBeDefined();

    // No raw markdown image/link syntax or URL text is ever rendered.
    expect(screen.queryByText(/!\[/)).toBeNull();
    expect(screen.queryByText(/\]\(/)).toBeNull();
    expect(screen.queryByText(/https:\/\//)).toBeNull();
  });

  it("drops an image-only bulleted or numbered list item entirely, leaving no stray marker", () => {
    const content = [
      "Here are some recipes:",
      "- ![Recipe 1](https://img.spoonacular.com/1.jpg)",
      "1. ![Recipe 2](https://img.spoonacular.com/2.jpg)",
      "Enjoy!",
    ].join("\n");

    renderComponent(<MarkdownText>{content}</MarkdownText>);

    expect(screen.getByText("Here are some recipes:")).toBeDefined();
    expect(screen.getByText("Enjoy!")).toBeDefined();
    expect(screen.queryByText(/!\[/)).toBeNull();
    expect(screen.queryByText(/^-\s*$/)).toBeNull();
    expect(screen.queryByText(/^1\.\s*$/)).toBeNull();
  });

  it("collapses the double space left when an image is removed from the middle of a line", () => {
    renderComponent(
      <MarkdownText>
        {"Here's the label ![alt](https://example.com/a.jpg) for reference"}
      </MarkdownText>,
    );

    expect(screen.getByText("Here's the label for reference")).toBeDefined();
  });
});
