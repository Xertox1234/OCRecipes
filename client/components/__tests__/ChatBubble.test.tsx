// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { ChatBubble } from "../ChatBubble";

describe("ChatBubble", () => {
  it("renders user message with correct accessibility label", () => {
    renderComponent(<ChatBubble role="user" content="Hello!" />);
    expect(screen.getByText("Hello!")).toBeDefined();
    expect(screen.getByLabelText("You: Hello!")).toBeDefined();
  });

  it("renders assistant message with correct accessibility label", () => {
    renderComponent(<ChatBubble role="assistant" content="How can I help?" />);
    expect(screen.getByText("How can I help?")).toBeDefined();
    expect(screen.getByLabelText("NutriCoach: How can I help?")).toBeDefined();
  });

  it("returns null when content is empty and not streaming", () => {
    const { container } = renderComponent(
      <ChatBubble role="assistant" content="" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("returns null when content is empty even if isStreaming is set", () => {
    const { container } = renderComponent(
      <ChatBubble role="assistant" content="" isStreaming />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders content when streaming with text", () => {
    renderComponent(
      <ChatBubble role="assistant" content="Thinking..." isStreaming />,
    );
    expect(screen.getByText("Thinking...")).toBeDefined();
  });
});
