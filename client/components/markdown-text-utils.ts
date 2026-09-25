export interface InlineSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

/**
 * Match a standalone markdown image: `![alt](url)`. Callers strip these
 * entirely — never rendered, alt text included — since the chat renderer
 * has no image support.
 */
export const IMAGE_REGEX = /!\[([^\]]*)\]\([^)]*\)/g;

/**
 * Match a markdown link: `[text](url)`. `parseInline` replaces every match
 * with its plain `text` — no tap target, no URL shown. Only meaningful once
 * images have already been stripped (an unstripped `![alt](url)` also
 * contains a `[alt](url)` substring this would otherwise match).
 */
const LINK_REGEX = /\[([^\]]*)\]\([^)]*\)/g;

/**
 * The text a screen reader should speak for a message: images dropped and
 * links reduced to their text, matching what MarkdownText shows, so
 * VoiceOver/TalkBack never read raw `![alt](url)` syntax or URLs aloud.
 * Collapses the double space a mid-sentence image leaves behind.
 */
export function spokenMarkdown(text: string): string {
  return text
    .replace(IMAGE_REGEX, "")
    .replace(LINK_REGEX, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** Parse inline bold/italic markers into styled segments. */
export function parseInline(text: string): InlineSegment[] {
  // Render a markdown link as its plain text — not tappable, no URL shown.
  const withoutLinks = text.replace(LINK_REGEX, "$1");
  const segments: InlineSegment[] = [];
  // Match **bold**, *italic* (but not ** inside bold).
  // Note: nested bold+italic (e.g. ***text***) is not supported — the outer
  // ** match consumes the content, leaving a stray *. This is an acceptable
  // limitation for a lightweight chat renderer.
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(withoutLinks)) !== null) {
    // Push text before this match
    if (match.index > lastIndex) {
      segments.push({ text: withoutLinks.slice(lastIndex, match.index) });
    }

    if (match[2]) {
      // **bold**
      segments.push({ text: match[2], bold: true });
    } else if (match[3]) {
      // *italic*
      segments.push({ text: match[3], italic: true });
    }

    lastIndex = match.index + match[0].length;
  }

  // Push remaining text
  if (lastIndex < withoutLinks.length) {
    segments.push({ text: withoutLinks.slice(lastIndex) });
  }

  return segments;
}

/**
 * Match a bullet list line (- item or * item).
 * Note: `* text` (asterisk + space) is treated as a bullet per standard
 * markdown rules, not as italic emphasis. `*text*` (no space) is italic.
 */
export const BULLET_REGEX = /^(\s*)[-*]\s+(.+)/;

/** Match a numbered list line (1. item). */
export const NUMBERED_REGEX = /^(\s*)(\d+)\.\s+(.+)/;
