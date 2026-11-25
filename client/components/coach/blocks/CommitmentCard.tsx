import React, { useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  AccessibilityInfo,
} from "react-native";
import Animated from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { PressableScale } from "@/components/PressableScale";
import { useSuccessPop } from "@/hooks/useSuccessAnimation";
import { useCoachNotesOff } from "@/hooks/useHealthConsent";
import { useAcceptCommitment, useNotebookEntries } from "@/hooks/useNotebook";
import { useToast } from "@/context/ToastContext";
import { insightKey, sameTip } from "@shared/lib/coach-stats";
import type { CommitmentCard as CommitmentCardType } from "@shared/schemas/coach-blocks";

interface Props {
  block: CommitmentCardType;
}

const NOTES_OFF_TEXT =
  "Coach's notes are off, so this check-in can't be saved.";

const CommitmentCard = React.memo(function CommitmentCard({ block }: Props) {
  const { theme } = useTheme();
  const { trigger: triggerCheckPop, animatedStyle: checkPopStyle } =
    useSuccessPop(1.4);
  const toast = useToast();
  const accept = useAcceptCommitment();
  // A commitment the user accepted earlier, matched the way the server does.
  const { data: notes } = useNotebookEntries();
  const key = insightKey(block.title);
  const alreadySaved = !!notes?.some(
    (n) =>
      n.type === "commitment" &&
      (n.status === "active" || n.status === "completed") &&
      n.confirmedAt !== null &&
      sameTip(insightKey(n.content), key),
  );
  const [dismissed, setDismissed] = useState(false);
  // A card drawn before the health consent was withdrawn: Coach's notes are
  // off now, so accepting would save nothing. Read here, not passed down:
  // the card is memoised and sits three layers under the chat.
  const notesOff = useCoachNotesOff();

  const accepted = accept.isSuccess || alreadySaved;

  // Set at the tap: `isPending` turns true only on the next render, so two
  // quick taps would both send.
  const sendingRef = useRef(false);
  const handleAccept = () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    accept.mutate(
      { title: block.title, followUpDate: block.followUpDate },
      {
        onSuccess: () => {
          // The pop fires its own Success haptic.
          triggerCheckPop();
          // Announce acceptance to screen readers. Android picks this up
          // via re-render; iOS needs the explicit announce call.
          AccessibilityInfo.announceForAccessibility("Commitment accepted");
        },
        onError: () =>
          toast.error("Couldn't save this commitment. Please try again."),
        onSettled: () => {
          sendingRef.current = false;
        },
      },
    );
  };

  if (dismissed) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: theme.backgroundSecondary, opacity: 0.5 },
        ]}
      >
        <Text style={[styles.title, { color: theme.textSecondary }]}>
          {block.title}
        </Text>
        <Text style={[styles.dismissed, { color: theme.textSecondary }]}>
          Dismissed
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}
      role="group"
      accessibilityLabel={`${accepted ? "Accepted commitment" : "Commitment"}: ${block.title}. ${block.followUpText}${!accepted && notesOff ? ` ${NOTES_OFF_TEXT}` : ""}`}
    >
      <View style={styles.header}>
        {/*
         * Visual-only state indicator. The accepted/not-accepted state is
         * conveyed to assistive tech via the parent group's accessibilityLabel
         * above; applying `accessibilityRole="checkbox"` here would mislead
         * screen-reader users into expecting a toggle gesture since the View
         * has no onPress (the Accept Pressable below is the actual control).
         */}
        <Animated.View style={checkPopStyle}>
          <View
            style={[
              styles.checkbox,
              accepted
                ? { backgroundColor: theme.success }
                : { borderColor: theme.link, borderWidth: 2 },
            ]}
            accessible={false}
            importantForAccessibility="no"
          >
            {accepted && (
              <Text style={styles.checkmark} accessible={false}>
                {"✓"}
              </Text>
            )}
          </View>
        </Animated.View>
        <Text style={[styles.title, { color: theme.text }]}>{block.title}</Text>
      </View>
      <Text style={[styles.followUp, { color: theme.textSecondary }]}>
        {block.followUpText}
      </Text>
      {!accepted && notesOff && (
        <Text style={[styles.followUp, { color: theme.textSecondary }]}>
          {NOTES_OFF_TEXT}
        </Text>
      )}
      {!accepted && !notesOff && (
        <View style={styles.actions}>
          <PressableScale
            style={[
              styles.acceptBtn,
              {
                backgroundColor: theme.accentSolid,
                opacity: accept.isPending ? 0.6 : 1,
              },
            ]}
            onPress={handleAccept}
            disabled={accept.isPending}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Accept commitment"
            accessibilityState={{
              disabled: accept.isPending,
              busy: accept.isPending,
            }}
          >
            <Text style={[styles.acceptText, { color: theme.buttonText }]}>
              Accept
            </Text>
          </PressableScale>
          <Pressable
            style={({ pressed }) => [
              styles.dismissBtn,
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => setDismissed(true)}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss commitment"
          >
            <Text style={[styles.dismissText, { color: theme.textSecondary }]}>
              Dismiss
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
});

export default CommitmentCard;

const styles = StyleSheet.create({
  container: { borderRadius: 12, padding: 12, marginTop: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  checkmark: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" }, // hardcoded
  title: { fontSize: 14, fontWeight: "600", flex: 1 },
  followUp: { fontSize: 12, marginTop: 4, marginLeft: 28 },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 10,
    marginLeft: 28,
  },
  acceptBtn: {
    minHeight: 44,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptText: { fontSize: 13, fontWeight: "600" },
  dismissBtn: {
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  dismissText: { fontSize: 13 },
  dismissed: { fontSize: 12, marginTop: 4, fontStyle: "italic" },
});
