import { describe, it, expect, vi } from "vitest";

import {
  getSpeakAccessibilityActions,
  handleSpeakAccessibilityAction,
} from "../chat-bubble-utils";

// Accessibility audit 2026-11-21 M3: the assistant row is one `accessible`
// element, which on iOS swallows its children — the nested "Read aloud"
// button was unreachable under VoiceOver. Speaking is now a custom action on
// the row itself.
describe("chat bubble speak action", () => {
  it("offers a Read aloud action, or Stop while speaking", () => {
    expect(getSpeakAccessibilityActions(true, false)).toEqual([
      { name: "speak", label: "Read aloud" },
    ]);
    expect(getSpeakAccessibilityActions(true, true)).toEqual([
      { name: "speak", label: "Stop reading aloud" },
    ]);
  });

  it("offers no action when the bubble cannot speak", () => {
    expect(getSpeakAccessibilityActions(false, false)).toBeUndefined();
  });

  it("runs onSpeak for the speak action only", () => {
    const onSpeak = vi.fn();
    handleSpeakAccessibilityAction("activate", onSpeak);
    expect(onSpeak).not.toHaveBeenCalled();
    handleSpeakAccessibilityAction("speak", onSpeak);
    expect(onSpeak).toHaveBeenCalledOnce();
  });
});
