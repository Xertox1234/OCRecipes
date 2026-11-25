import { describe, it, expect } from "vitest";
import { mentionsHealthCondition } from "../health-note-screen";

// Owner ruling 2026-11-25: Coach's notes hold no medical conditions and no
// medications. Conditions belong in the profile; medications are not kept.
describe("mentionsHealthCondition", () => {
  it.each([
    "User is diabetic.",
    "User has type 2 diabetes and wants low-sugar meals.",
    "User was diagnosed with prediabetes last year.",
    "User has high blood pressure.",
    "User has hypothyroidism.",
    "User has celiac disease.",
    "User has IBS and avoids onions.",
    "User has Crohn's disease.",
    "User has PCOS.",
    "User is pregnant.",
    "User is breastfeeding.",
    "User used to be bulimic.",
    "User is recovering from an eating disorder.",
    "User has high cholesterol.",
    "User has kidney disease.",
    "User had gastric bypass surgery.",
    "User takes Ozempic.",
    "User is on metformin.",
    "User started Wegovy in March.",
    "User takes insulin before meals.",
    "User is on a GLP-1 medication.",
    "User takes blood pressure medication.",
    "User takes a statin.",
    "User is on antidepressants.",
    "User's doctor prescribed a low-sodium diet.",
    "your ozempic routine",
    "User has asthma.",
    "User has arthritis.",
    "User has lupus.",
    "User gets migraines.",
    "User has hypoglycemia.",
    "User has high blood sugar.",
    "User has kidney stones.",
    "User takes blood thinners.",
    "User is on warfarin.",
    "User takes lisinopril.",
    "User uses an inhaler.",
    "User is on antibiotics.",
    "User takes steroids for a flare-up.",
  ])("flags a condition or medication: %s", (text) => {
    expect(mentionsHealthCondition(text)).toBe(true);
  });

  it.each([
    "User prefers low-sugar desserts.",
    "User is cutting carbs.",
    "User eats low-carb.",
    "User wants more energy for their kids.",
    "User likes heart-healthy meals.",
    "User cooks with a pressure cooker.",
    "User wants 120 g of protein a day.",
    "User will try Sunday meal prep.",
    "User is vegetarian and dislikes mushrooms.",
    "User works night shifts, with their main meal at 2am.",
    "User wants low-sodium dinners.",
    "User is training for a 10k.",
    "User likes the bakery on the corner.",
    "User finds meal planning on weekdays stressful.",
    "User wants to gain muscle.",
    "User prefers oat milk.",
    "User avoids late snacks.",
    "User wants recipes their kids will eat.",
    "User is managing their weight with smaller portions.",
    "User loves ribs.",
  ])("keeps an ordinary note: %s", (text) => {
    expect(mentionsHealthCondition(text)).toBe(false);
  });
});
