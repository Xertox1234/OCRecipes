import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { CommitmentCard as CommitmentCardType } from "@shared/schemas/coach-blocks";

interface Props {
  block: CommitmentCardType;
  onAccept?: (title: string, followUpDate: string) => void;
}

export default function CommitmentCard({ block, onAccept }: Props) {
  const { theme } = useTheme();
  const [accepted, setAccepted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return (
      <View style={[styles.container, { backgroundColor: theme.backgroundSecondary, opacity: 0.5 }]}>
        <Text style={[styles.title, { color: theme.textSecondary }]}>{block.title}</Text>
        <Text style={[styles.dismissed, { color: theme.textSecondary }]}>Dismissed</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundSecondary }]} role="group" accessibilityLabel={`Commitment: ${block.title}. ${block.followUpText}`}>
      <View style={styles.header}>
        <View style={[styles.checkbox, accepted ? { backgroundColor: theme.success } : { borderColor: theme.link, borderWidth: 2 }]}>
          {accepted && <Text style={styles.checkmark}>{"\u2713"}</Text>}
        </View>
        <Text style={[styles.title, { color: theme.text }]}>{block.title}</Text>
      </View>
      <Text style={[styles.followUp, { color: theme.textSecondary }]}>{block.followUpText}</Text>
      {!accepted && (
        <View style={styles.actions}>
          <Pressable
            style={[styles.acceptBtn, { backgroundColor: theme.link + "33" }]}
            onPress={() => { setAccepted(true); onAccept?.(block.title, block.followUpDate); }}
            accessibilityRole="button"
            accessibilityLabel="Accept commitment"
          >
            <Text style={[styles.acceptText, { color: theme.link }]}>Accept</Text>
          </Pressable>
          <Pressable onPress={() => setDismissed(true)} accessibilityRole="button" accessibilityLabel="Dismiss commitment">
            <Text style={[styles.dismissText, { color: theme.textSecondary }]}>Dismiss</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, padding: 12, marginTop: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkbox: { width: 20, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  checkmark: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  title: { fontSize: 14, fontWeight: "600", flex: 1 },
  followUp: { fontSize: 12, marginTop: 4, marginLeft: 28 },
  actions: { flexDirection: "row", gap: 12, marginTop: 10, marginLeft: 28 },
  acceptBtn: { borderRadius: 8, paddingVertical: 5, paddingHorizontal: 14 },
  acceptText: { fontSize: 13, fontWeight: "600" },
  dismissText: { fontSize: 13, paddingVertical: 5 },
  dismissed: { fontSize: 12, marginTop: 4, fontStyle: "italic" },
});
