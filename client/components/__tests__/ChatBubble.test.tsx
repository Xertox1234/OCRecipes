// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import {
  FadeIn,
  FadeInUp,
  SlideInLeft,
  SlideInRight,
} from "react-native-reanimated";
import { chatReplyTextFadeMs, chatSentEntrance } from "@/constants/animations";
import { ChatBubble } from "../ChatBubble";

const { a11y } = vi.hoisted(() => ({ a11y: { reducedMotion: false } }));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => a11y,
}));

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

  // The screen strips markdown images and shows links as plain text; the
  // spoken label must match what is on screen, not read raw syntax or URLs.
  it("speaks the same cleaned text the screen shows: no image syntax, link text without its URL", () => {
    renderComponent(
      <ChatBubble
        role="assistant"
        content={
          "Try this ![bowl](https://x.test/b.jpg) from [Bon Appetit](https://ba.test/r)."
        }
      />,
    );
    expect(
      screen.getByLabelText("NutriCoach: Try this from Bon Appetit."),
    ).toBeDefined();
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

describe("ChatBubble — entrance", () => {
  type Spied = { duration: () => unknown; springify: () => unknown };
  let sentFade: ReturnType<typeof vi.spyOn>;
  let replyFade: ReturnType<typeof vi.spyOn>;
  let slides: ReturnType<typeof vi.spyOn>[];
  beforeEach(() => {
    a11y.reducedMotion = false;
    sentFade = vi.spyOn(FadeInUp as unknown as Spied, "duration");
    replyFade = vi.spyOn(FadeIn as unknown as Spied, "duration");
    slides = [
      vi.spyOn(SlideInRight as unknown as Spied, "springify"),
      vi.spyOn(SlideInLeft as unknown as Spied, "springify"),
    ];
  });
  afterEach(() => {
    sentFade.mockRestore();
    replyFade.mockRestore();
    slides.forEach((s) => s.mockRestore());
  });

  // Positive controls: a live copy (just sent, or the reply streaming in)
  // settles in quietly — a short fade, not a slide across the screen.
  it("fades a live user message up into place", () => {
    renderComponent(<ChatBubble role="user" content="Hi" animateEntry />);
    expect(sentFade).toHaveBeenCalledWith(chatSentEntrance.duration);
    for (const s of slides) expect(s).not.toHaveBeenCalled();
  });

  it("fades a live reply's text in, without sliding the row", () => {
    renderComponent(
      <ChatBubble role="assistant" content="Hello" animateEntry />,
    );
    expect(replyFade).toHaveBeenCalledWith(chatReplyTextFadeMs);
    for (const s of slides) expect(s).not.toHaveBeenCalled();
  });

  // Saved messages (history load, scrolling back, the swap once a reply is
  // saved) appear in place instead of replaying the entrance.
  it("does not animate by default", () => {
    renderComponent(<ChatBubble role="assistant" content="Hello" />);
    renderComponent(<ChatBubble role="user" content="Hi" />);
    expect(sentFade).not.toHaveBeenCalled();
    expect(replyFade).not.toHaveBeenCalled();
  });

  it("does not animate under reduced motion", () => {
    a11y.reducedMotion = true;
    renderComponent(<ChatBubble role="user" content="Hi" animateEntry />);
    renderComponent(
      <ChatBubble role="assistant" content="Hello" animateEntry />,
    );
    expect(sentFade).not.toHaveBeenCalled();
    expect(replyFade).not.toHaveBeenCalled();
    expect(screen.getByText("Hi")).toBeDefined();
    expect(screen.getByText("Hello")).toBeDefined();
  });
});
