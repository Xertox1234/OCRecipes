import { AccessibilityInfo } from "react-native";

/**
 * VoiceOver does not queue announcements: a second one made in the same
 * moment cuts the first off. Components that announce on mount and can mount
 * in the same render (a spent recovery code's card next to an error) route
 * through here, so everything said in one tick goes out as ONE announcement.
 * `first` messages lead — the one the person must not miss.
 */
let pending: { first: string[]; rest: string[] } | null = null;

export function announceTogether(
  message: string,
  { first = false }: { first?: boolean } = {},
): void {
  if (!pending) {
    pending = { first: [], rest: [] };
    setTimeout(() => {
      const { first: lead, rest } = pending!;
      pending = null;
      AccessibilityInfo.announceForAccessibility([...lead, ...rest].join(" "));
    }, 0);
  }
  (first ? pending.first : pending.rest).push(message);
}
