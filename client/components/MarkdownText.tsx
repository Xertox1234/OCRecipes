import React from "react";
import {
  Text,
  View,
  StyleSheet,
  type TextStyle,
  type StyleProp,
} from "react-native";
import { FontFamily } from "@/constants/theme";
import {
  parseInline,
  BULLET_REGEX,
  NUMBERED_REGEX,
  IMAGE_REGEX,
  type InlineSegment,
} from "@/components/markdown-text-utils";

interface MarkdownTextProps {
  children: string;
  style?: StyleProp<TextStyle>;
}

function InlineText({
  segments,
  style,
}: {
  segments: InlineSegment[];
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text style={style}>
      {segments.map((seg, i) => {
        const segStyle: TextStyle = {};
        if (seg.bold) segStyle.fontFamily = FontFamily.bold;
        if (seg.italic) segStyle.fontStyle = "italic";

        return Object.keys(segStyle).length > 0 ? (
          <Text key={i} style={segStyle}>
            {seg.text}
          </Text>
        ) : (
          <Text key={i}>{seg.text}</Text>
        );
      })}
    </Text>
  );
}

/**
 * Lightweight markdown renderer for chat messages.
 * Supports: **bold**, *italic*, bullet lists (- / *), numbered lists (1.), line breaks.
 * Images (`![alt](url)`) are dropped entirely — a line containing only an
 * image disappears. Links (`[text](url)`) render as plain, non-tappable
 * `text` with the URL omitted.
 *
 * Known limitations:
 * - Nested bold+italic (***text***) is not supported
 * - `* text` (asterisk + space) is treated as a bullet, not emphasis
 */
export function MarkdownText({ children, style }: MarkdownTextProps) {
  // Strip markdown images before line classification. A line that was only
  // an image (nothing else on it) disappears entirely — no line, no spacer.
  const lines: string[] = [];
  for (const rawLine of children.split("\n")) {
    const withoutImages = rawLine.replace(IMAGE_REGEX, "");
    if (withoutImages !== rawLine && withoutImages.trim() === "") {
      continue;
    }
    lines.push(withoutImages);
  }
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const bulletMatch = line.match(BULLET_REGEX);
    const numberedMatch = line.match(NUMBERED_REGEX);

    if (bulletMatch) {
      // Collect consecutive bullet items
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(BULLET_REGEX);
        if (!m) break;
        items.push(m[2]);
        i++;
      }
      elements.push(
        <View key={`bl-${i}`} style={styles.listContainer}>
          {items.map((item, j) => (
            <View key={j} style={styles.listItem}>
              <Text style={[style, styles.bullet]}>{"\u2022"}</Text>
              <InlineText
                segments={parseInline(item)}
                style={[style, styles.listItemText]}
              />
            </View>
          ))}
        </View>,
      );
    } else if (numberedMatch) {
      // Collect consecutive numbered items
      const items: { num: string; text: string }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(NUMBERED_REGEX);
        if (!m) break;
        items.push({ num: m[2], text: m[3] });
        i++;
      }
      elements.push(
        <View key={`nl-${i}`} style={styles.listContainer}>
          {items.map((item, j) => (
            <View key={j} style={styles.listItem}>
              <Text style={[style, styles.numberedBullet]}>{item.num}.</Text>
              <InlineText
                segments={parseInline(item.text)}
                style={[style, styles.listItemText]}
              />
            </View>
          ))}
        </View>,
      );
    } else {
      // Regular line — empty lines become spacing
      if (line.trim() === "") {
        elements.push(<View key={`sp-${i}`} style={styles.spacer} />);
      } else {
        elements.push(
          <InlineText
            key={`p-${i}`}
            segments={parseInline(line)}
            style={style}
          />,
        );
      }
      i++;
    }
  }

  return <View>{elements}</View>;
}

const styles = StyleSheet.create({
  listContainer: {
    marginVertical: 2,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginVertical: 1,
  },
  bullet: {
    width: 16,
    textAlign: "center",
  },
  numberedBullet: {
    width: 20,
    textAlign: "right",
    marginRight: 4,
  },
  listItemText: {
    flex: 1,
  },
  spacer: {
    height: 8,
  },
});
