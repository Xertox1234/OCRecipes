import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { LabelCompareBlock } from "@shared/schemas/coach-blocks";
import { compareRows, compareSpoken, servingLine } from "./label-compare-utils";

interface Props {
  block: LabelCompareBlock;
}

/**
 * Two scanned products side by side (Coach roadmap T4), each per its own
 * serving: the servings can differ, so both are named under the products and
 * nothing is scaled. The server built it from the scans, so every number is
 * the stored one. One accessible element that speaks both columns.
 */
const LabelCompare = React.memo(function LabelCompare({ block }: Props) {
  const { theme } = useTheme();
  const [a, b] = block.items;
  const rows = compareRows(block.items);
  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}
      accessible={true}
      accessibilityLabel={compareSpoken(block.items)}
      testID="label-compare"
    >
      <View style={styles.row}>
        <View style={styles.labelCol} />
        {[a, b].map((item, i) => (
          <View key={i} style={styles.valueCol}>
            <Text
              maxFontSizeMultiplier={1.2}
              style={[styles.name, { color: theme.text }]}
              numberOfLines={2}
            >
              {item.name}
            </Text>
            {item.brand ? (
              <Text
                maxFontSizeMultiplier={1.2}
                style={[styles.meta, { color: theme.textSecondary }]}
                numberOfLines={1}
              >
                {item.brand}
              </Text>
            ) : null}
            <Text
              maxFontSizeMultiplier={1.2}
              style={[styles.meta, { color: theme.textSecondary }]}
              numberOfLines={3}
            >
              {servingLine(item)}
            </Text>
          </View>
        ))}
      </View>
      {rows.map((row) => (
        <View
          key={row.label}
          style={[styles.row, styles.dataRow, { borderTopColor: theme.border }]}
        >
          <Text
            style={[styles.label, { color: theme.textSecondary }]}
            maxFontSizeMultiplier={1.2}
          >
            {row.label}
          </Text>
          <Text
            style={[styles.value, { color: theme.text }]}
            maxFontSizeMultiplier={1.2}
          >
            {row.a}
          </Text>
          <Text
            style={[styles.value, { color: theme.text }]}
            maxFontSizeMultiplier={1.2}
          >
            {row.b}
          </Text>
        </View>
      ))}
      <Text
        style={[styles.caption, { color: theme.textSecondary }]}
        maxFontSizeMultiplier={1.2}
      >
        Each per its own serving
      </Text>
    </View>
  );
});

export default LabelCompare;

const styles = StyleSheet.create({
  container: { borderRadius: 12, padding: 12, marginTop: 8 },
  row: { flexDirection: "row", alignItems: "flex-start" },
  dataRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    alignItems: "center",
  },
  labelCol: { flex: 1 },
  valueCol: { flex: 1.2, paddingBottom: 8, paddingHorizontal: 4 },
  name: { fontSize: 13, fontWeight: "600" },
  meta: { fontSize: 11, marginTop: 2 },
  label: { flex: 1, fontSize: 12 },
  value: {
    flex: 1.2,
    fontSize: 13,
    fontWeight: "600",
    paddingHorizontal: 4,
  },
  caption: { fontSize: 11, marginTop: 8, textAlign: "center" },
});
