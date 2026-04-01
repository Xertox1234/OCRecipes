import React, {
  createContext,
  useContext,
  useCallback,
  useState,
  type ReactNode,
} from "react";
import { Modal, Platform } from "react-native";
import * as Haptics from "expo-haptics";

import { CoachOverlayContent } from "@/components/CoachOverlayContent";
import { UpgradeModal } from "@/components/UpgradeModal";
import { useAccessibility } from "@/hooks/useAccessibility";
import { usePremiumContext } from "@/context/PremiumContext";

export interface CoachQuestion {
  readonly text: string;
  readonly question: string;
}

interface CoachOverlayContextType {
  openCoach: (question: CoachQuestion, screenContext: string) => void;
  closeCoach: () => void;
}

const CoachOverlayContext = createContext<CoachOverlayContextType | null>(null);

export function useCoachOverlay(): CoachOverlayContextType {
  const context = useContext(CoachOverlayContext);
  if (!context) {
    throw new Error(
      "useCoachOverlay must be used within a CoachOverlayProvider",
    );
  }
  return context;
}

export function CoachOverlayProvider({ children }: { children: ReactNode }) {
  const { isPremium } = usePremiumContext();
  const { reducedMotion } = useAccessibility();

  const [isOpen, setIsOpen] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
  const [selectedQuestion, setSelectedQuestion] =
    useState<CoachQuestion | null>(null);
  const [screenContext, setScreenContext] = useState("");
  const [showUpgrade, setShowUpgrade] = useState(false);

  const openCoach = useCallback(
    (question: CoachQuestion, context: string) => {
      if (!isPremium) {
        setShowUpgrade(true);
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSessionKey((k) => k + 1);
      setSelectedQuestion(question);
      setScreenContext(context);
      setIsOpen(true);
    },
    [isPremium],
  );

  const closeCoach = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <CoachOverlayContext.Provider value={{ openCoach, closeCoach }}>
      {children}
      {isOpen && selectedQuestion && (
        <Modal
          visible
          animationType={reducedMotion ? "none" : "slide"}
          presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
          onRequestClose={closeCoach}
        >
          <CoachOverlayContent
            key={sessionKey}
            question={selectedQuestion}
            screenContext={screenContext}
            onDismiss={closeCoach}
          />
        </Modal>
      )}
      <UpgradeModal
        visible={showUpgrade}
        onClose={() => setShowUpgrade(false)}
      />
    </CoachOverlayContext.Provider>
  );
}
