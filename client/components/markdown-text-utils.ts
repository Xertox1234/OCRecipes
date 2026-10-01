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

/**
 * Split a message into lines with markdown images removed. A line that was
 * only an image — including a list item whose only content was an image
 * ("- ![alt](url)", "1. ![alt](url)") — is dropped entirely, not left as a
 * blank line or a bare marker. Shared by MarkdownText (what is shown) and
 * spokenMarkdown (what is spoken) so the two cannot drift apart.
 */
export function stripImageLines(text: string): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    let withoutImages = rawLine.replace(IMAGE_REGEX, "");
    if (withoutImages !== rawLine) {
      if (/^\s*(?:[-*]|\d+\.)?\s*$/.test(withoutImages)) {
        continue;
      }
      // Collapse the double space an image leaves behind mid-line.
      withoutImages = withoutImages.replace(/ {2,}/g, " ");
    }
    lines.push(withoutImages);
  }
  return lines;
}

/**
 * The text a screen reader or read-aloud should speak for a message, built
 * from the same pieces MarkdownText renders with (stripImageLines, the list
 * regexes, parseInline), so it matches the screen: no `![alt](url)`, URLs,
 * list markers or bold/italic markers read aloud.
 */
export function spokenMarkdown(text: string): string {
  return stripImageLines(text)
    .map((line) => {
      const bullet = line.match(BULLET_REGEX);
      const numbered = line.match(NUMBERED_REGEX);
      const body = bullet ? bullet[2] : numbered ? numbered[3] : line;
      return parseInline(body.trim())
        .map((segment) => segment.text)
        .join("")
        .trim();
    })
    .join("\n")
    .trim();
}
