import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { InlineError } from "@/components/InlineError";
import { Spacing } from "@/constants/theme";
import {
  useMedicationLogs,
  useMedicationInsights,
  useLogMedication,
} from "@/hooks/useMedication";
import MedicationLogCard from "@/components/MedicationLogCard";
import AppetiteTracker from "@/components/AppetiteTracker";
import { HighProteinSuggestions } from "@/components/HighProteinSuggestions";

const COMMON_MEDICATIONS = [
  { name: "semaglutide", brands: ["Ozempic", "Wegovy", "Rybelsus"] },
  { name: "tirzepatide", brands: ["Mounjaro", "Zepbound"] },
  { name: "liraglutide", brands: ["Saxenda", "Victoza"] },
  { name: "dulaglutide", brands: ["Trulicity"] },
];

const COMMON_SIDE_EFFECTS = [
  "Nausea",
  "Vomiting",
  "Diarrhea",
  "Constipation",
  "Headache",
  "Fatigue",
  "Dizziness",
  "Bloating",
  "Acid reflux",
  "Loss of appetite",
];

export default function GLP1CompanionScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { data: logs, isLoading, refetch } = useMedicationLogs();
  const { data: insights } = useMedicationInsights();
  const logMedication = useLogMedication();

  const [showLogModal, setShowLogModal] = useState(false);
  const [selectedMedication, setSelectedMedication] = useState("");
  const [selectedBrand, setSelectedBrand] = useState("");
  const [dosage, setDosage] = useState("");
  const [appetiteLevel, setAppetiteLevel] = useState<number | undefined>();
  const [selectedSideEffects, setSelectedSideEffects] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setSelectedMedication("");
    setSelectedBrand("");
    setDosage("");
    setAppetiteLevel(undefined);
    setSelectedSideEffects([]);
    setNotes("");
    setValidationError(null);
  }, []);

  const handleLogDose = useCallback(async () => {
    if (!selectedMedication || !dosage) {
      setValidationError(
        !selectedMedication
          ? "Please select a medication."
          : "Please enter a dosage.",
      );
      return;
    }
    setValidationError(null);
    await logMedication.mutateAsync({
      medicationName: selectedMedication,
      brandName: selectedBrand || undefined,
      dosage,
      sideEffects:
        selectedSideEffects.length > 0 ? selectedSideEffects : undefined,
      appetiteLevel,
      notes: notes || undefined,
    });
    resetForm();
    setShowLogModal(false);
  }, [
    selectedMedication,
    selectedBrand,
    dosage,
    appetiteLevel,
    selectedSideEffects,
    notes,
    logMedication,
    resetForm,
  ]);

  const toggleSideEffect = useCallback((effect: string) => {
    setSelectedSideEffects((prev) =>
      prev.includes(effect)
        ? prev.filter((e) => e !== effect)
        : [...prev, effect],
    );
  }, []);

  const insightsCards = useMemo(() => {
    if (!insights) return null;
    return (
      <View style={[styles.insightsGrid, { gap: Spacing.sm }]}>
        <View
          style={[
            styles.insightCard,
            {
              backgroundColor: theme.backgroundSecondary,
              borderRadius: 12,
              padding: Spacing.md,
            },
          ]}
        >
          <ThemedText style={[styles.insightValue, { color: theme.link }]}>
            {insights.totalDoses}
          </ThemedText>
          <ThemedText
            style={[styles.insightLabel, { color: theme.textSecondary }]}
          >
            Total Doses
          </ThemedText>
        </View>
        {insights.daysSinceStart != null && (
          <View
            style={[
              styles.insightCard,
              {
                backgroundColor: theme.backgroundSecondary,
                borderRadius: 12,
                padding: Spacing.md,
              },
            ]}
          >
            <ThemedText style={[styles.insightValue, { color: theme.link }]}>
              {insights.daysSinceStart}
            </ThemedText>
            <ThemedText
              style={[styles.insightLabel, { color: theme.textSecondary }]}
            >
              Days on GLP-1
            </ThemedText>
          </View>
        )}
        {insights.averageAppetiteLevel != null && (
          <View
            style={[
              styles.insightCard,
              {
                backgroundColor: theme.backgroundSecondary,
                borderRadius: 12,
                padding: Spacing.md,
              },
            ]}
          >
            <ThemedText style={[styles.insightValue, { color: theme.link }]}>
              {insights.averageAppetiteLevel}/5
            </ThemedText>
            <ThemedText
              style={[styles.insightLabel, { color: theme.textSecondary }]}
            >
              Avg Appetite
            </ThemedText>
          </View>
        )}
        {insights.weightChangeSinceStart != null && (
          <View
            style={[
              styles.insightCard,
              {
                backgroundColor: theme.backgroundSecondary,
                borderRadius: 12,
                padding: Spacing.md,
              },
            ]}
          >
            <ThemedText
              style={[
                styles.insightValue,
                {
                  color:
                    insights.weightChangeSinceStart <= 0
                      ? theme.success
                      : theme.error,
                },
              ]}
            >
              {insights.weightChangeSinceStart > 0 ? "+" : ""}
              {insights.weightChangeSinceStart} kg
            </ThemedText>
            <ThemedText
              style={[styles.insightLabel, { color: theme.textSecondary }]}
            >
              Weight Change
            </ThemedText>
          </View>
        )}
      </View>
    );
  }, [insights, theme]);

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <ScrollView
        contentContainerStyle={{
          padding: Spacing.md,
          paddingBottom: insets.bottom + Spacing.xl,
        }}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} />
        }
      >
        {insightsCards}

        {insights?.commonSideEffects &&
          insights.commonSideEffects.length > 0 && (
            <View style={{ marginTop: Spacing.md }}>
              <ThemedText type="h4" style={styles.sectionTitle}>
                Common Side Effects
              </ThemedText>
              {insights.commonSideEffects.map((effect) => (
                <View
                  key={effect.name}
                  style={[styles.sideEffectRow, { marginTop: Spacing.xs }]}
                >
                  <ThemedText
                    style={[styles.sideEffectName, { color: theme.text }]}
                  >
                    {effect.name}
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.sideEffectCount,
                      { color: theme.textSecondary },
                    ]}
                  >
                    {effect.count}x
                  </ThemedText>
                </View>
              ))}
            </View>
          )}

        <HighProteinSuggestions />

        <View style={{ marginTop: Spacing.md }}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Dose History
          </ThemedText>
          {logs?.map((log) => (
            <View key={log.id} style={{ marginTop: Spacing.sm }}>
              <MedicationLogCard
                medicationName={log.medicationName}
                brandName={log.brandName}
                dosage={log.dosage}
                takenAt={log.takenAt}
                appetiteLevel={log.appetiteLevel}
                sideEffects={log.sideEffects || []}
              />
            </View>
          ))}
          {(!logs || logs.length === 0) && (
            <ThemedText
              style={[
                styles.emptyText,
                { color: theme.textSecondary, marginTop: Spacing.md },
              ]}
            >
              No doses logged yet. Tap + to log your first dose.
            </ThemedText>
          )}
        </View>
      </ScrollView>

      <Pressable
        onPress={() => setShowLogModal(true)}
        accessibilityLabel="Log new dose"
        accessibilityRole="button"
        style={[
          styles.fab,
          {
            backgroundColor: theme.link,
            bottom: insets.bottom + Spacing.md,
            right: Spacing.md,
          },
        ]}
      >
        <Ionicons name="add" size={28} color={theme.buttonText} />
      </Pressable>

      <Modal
        visible={showLogModal}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <View
          style={[styles.modal, { backgroundColor: theme.backgroundRoot }]}
          accessibilityViewIsModal={true}
        >
          <View style={[styles.modalHeader, { padding: Spacing.md }]}>
            <Pressable
              onPress={() => {
                resetForm();
                setShowLogModal(false);
              }}
              accessibilityLabel="Cancel"
              accessibilityRole="button"
            >
              <ThemedText style={{ color: theme.link, fontSize: 16 }}>
                Cancel
              </ThemedText>
            </Pressable>
            <ThemedText style={[styles.modalTitle, { color: theme.text }]}>
              Log Dose
            </ThemedText>
            <Pressable
              onPress={handleLogDose}
              disabled={!selectedMedication || !dosage}
              accessibilityLabel="Save dose"
              accessibilityRole="button"
            >
              <ThemedText
                style={{
                  color:
                    selectedMedication && dosage
                      ? theme.link
                      : theme.textSecondary,
                  fontSize: 16,
                  fontWeight: "600",
                }}
              >
                Save
              </ThemedText>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ padding: Spacing.md }}
            keyboardDismissMode="on-drag"
          >
            <ThemedText
              style={[
                styles.formLabel,
                {
                  color: theme.textSecondary,
                  marginBottom: Spacing.xs,
                },
              ]}
            >
              Medication
            </ThemedText>
            <View accessibilityRole="radiogroup">
              {COMMON_MEDICATIONS.map((med) => (
                <Pressable
                  key={med.name}
                  onPress={() => {
                    setSelectedMedication(med.name);
                    setSelectedBrand(med.brands[0]);
                  }}
                  accessibilityLabel={`Select ${med.name}`}
                  accessibilityRole="radio"
                  accessibilityState={{
                    selected: selectedMedication === med.name,
                  }}
                  style={[
                    styles.medicationOption,
                    {
                      backgroundColor:
                        selectedMedication === med.name
                          ? theme.link
                          : theme.backgroundSecondary,
                      borderColor:
                        selectedMedication === med.name
                          ? theme.link
                          : theme.border,
                      borderRadius: Spacing.sm,
                      padding: Spacing.sm,
                      marginBottom: Spacing.xs,
                    },
                  ]}
                >
                  <ThemedText
                    style={{
                      color:
                        selectedMedication === med.name
                          ? theme.buttonText
                          : theme.text,
                      fontWeight: "600",
                    }}
                  >
                    {med.name}
                  </ThemedText>
                  <ThemedText
                    style={{
                      color:
                        selectedMedication === med.name
                          ? theme.buttonText
                          : theme.textSecondary,
                      fontSize: 12,
                    }}
                  >
                    {med.brands.join(", ")}
                  </ThemedText>
                </Pressable>
              ))}
            </View>

            {selectedMedication && (
              <>
                <ThemedText
                  style={[
                    styles.formLabel,
                    {
                      color: theme.textSecondary,
                      marginTop: Spacing.md,
                      marginBottom: Spacing.xs,
                    },
                  ]}
                >
                  Brand
                </ThemedText>
                <View
                  style={[styles.brandRow, { gap: Spacing.xs }]}
                  accessibilityRole="radiogroup"
                >
                  {COMMON_MEDICATIONS.find(
                    (m) => m.name === selectedMedication,
                  )?.brands.map((brand) => (
                    <Pressable
                      key={brand}
                      onPress={() => setSelectedBrand(brand)}
                      accessibilityLabel={`Select brand ${brand}`}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: selectedBrand === brand }}
                      style={[
                        styles.brandOption,
                        {
                          backgroundColor:
                            selectedBrand === brand
                              ? theme.link
                              : theme.backgroundSecondary,
                          borderColor:
                            selectedBrand === brand ? theme.link : theme.border,
                          borderRadius: Spacing.xs,
                          paddingHorizontal: Spacing.sm,
                          paddingVertical: Spacing.xs,
                        },
                      ]}
                    >
                      <ThemedText
                        style={{
                          color:
                            selectedBrand === brand
                              ? theme.buttonText
                              : theme.text,
                          fontSize: 13,
                        }}
                      >
                        {brand}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <ThemedText
              style={[
                styles.formLabel,
                {
                  color: theme.textSecondary,
                  marginTop: Spacing.md,
                  marginBottom: Spacing.xs,
                },
              ]}
            >
              Dosage
            </ThemedText>
            <TextInput
              value={dosage}
              onChangeText={setDosage}
              placeholder="e.g., 0.25mg"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel="Dosage"
              style={[
                styles.input,
                {
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: theme.border,
                  color: theme.text,
                  borderRadius: Spacing.sm,
                  padding: Spacing.sm,
                },
              ]}
            />

            <InlineError
              message={validationError}
              style={{ marginTop: Spacing.sm }}
            />

            <View style={{ marginTop: Spacing.md }}>
              <AppetiteTracker
                value={appetiteLevel}
                onChange={setAppetiteLevel}
              />
            </View>

            <ThemedText
              style={[
                styles.formLabel,
                {
                  color: theme.textSecondary,
                  marginTop: Spacing.md,
                  marginBottom: Spacing.xs,
                },
              ]}
            >
              Side Effects
            </ThemedText>
            <View
              role="group"
              accessibilityLabel="Side effects"
              style={[styles.sideEffectsGrid, { gap: Spacing.xs }]}
            >
              {COMMON_SIDE_EFFECTS.map((effect) => (
                <Pressable
                  key={effect}
                  onPress={() => toggleSideEffect(effect)}
                  accessibilityLabel={effect}
                  accessibilityRole="checkbox"
                  accessibilityState={{
                    checked: selectedSideEffects.includes(effect),
                  }}
                  style={[
                    styles.sideEffectOption,
                    {
                      backgroundColor: selectedSideEffects.includes(effect)
                        ? `${theme.error}18`
                        : theme.backgroundSecondary,
                      borderColor: selectedSideEffects.includes(effect)
                        ? theme.error
                        : theme.border,
                      borderRadius: Spacing.xs,
                      paddingHorizontal: Spacing.sm,
                      paddingVertical: Spacing.xs,
                    },
                  ]}
                >
                  <ThemedText
                    style={{
                      color: selectedSideEffects.includes(effect)
                        ? theme.error
                        : theme.text,
                      fontSize: 13,
                    }}
                  >
                    {effect}
                  </ThemedText>
                </Pressable>
              ))}
            </View>

            <ThemedText
              style={[
                styles.formLabel,
                {
                  color: theme.textSecondary,
                  marginTop: Spacing.md,
                  marginBottom: Spacing.xs,
                },
              ]}
            >
              Notes (optional)
            </ThemedText>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Any additional notes..."
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel="Notes"
              multiline
              numberOfLines={3}
              style={[
                styles.input,
                styles.textArea,
                {
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: theme.border,
                  color: theme.text,
                  borderRadius: Spacing.sm,
                  padding: Spacing.sm,
                },
              ]}
            />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  insightsGrid: { flexDirection: "row", flexWrap: "wrap" },
  insightCard: { width: "48%", alignItems: "center" },
  insightValue: { fontSize: 24, fontWeight: "700" },
  insightLabel: { fontSize: 12, marginTop: 2 },
  sectionTitle: { marginBottom: 8 },
  sideEffectRow: { flexDirection: "row", justifyContent: "space-between" },
  sideEffectName: { fontSize: 14 },
  sideEffectCount: { fontSize: 14 },
  emptyText: { textAlign: "center", fontSize: 14 },
  fab: {
    position: "absolute",
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000", // hardcoded
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  modal: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalTitle: { fontSize: 17, fontWeight: "600" },
  formLabel: { fontSize: 14, fontWeight: "500" },
  medicationOption: { borderWidth: 1, minHeight: 44 },
  brandRow: { flexDirection: "row", flexWrap: "wrap" },
  brandOption: { borderWidth: 1, minHeight: 44 },
  input: { borderWidth: 1, fontSize: 15 },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  sideEffectsGrid: { flexDirection: "row", flexWrap: "wrap" },
  sideEffectOption: { borderWidth: 1 },
});
