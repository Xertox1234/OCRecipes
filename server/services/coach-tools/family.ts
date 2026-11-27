import { allergenIds } from "@shared/constants/allergens";
import { addFamilyMemberCardArgsSchema } from "../write-cards/tool-args";
import { familyCardResult } from "../write-cards/results";
import { defineTool, type CoachToolEntry } from "./types";

// add_family_member (Coach roadmap A3; owner ruling 2026-11-27) is offered,
// and run, only for an app that can draw the family card and a plan that
// has family profiles. It sees nothing of the user's stored profiles.
const addFamilyMemberTool = defineTool({
  name: "add_family_member",
  available: (opts) => !!opts.writeCards && !!opts.familyCard,
  definition: () => ({
    type: "function",
    function: {
      name: "add_family_member",
      description:
        "Show the user a card to add one person to their family profiles, the people they plan meals for. Nothing is saved until the user taps Save on the card. Call this only when the user asks to add a family member and gives their name. Use the name exactly as the user gave it. List only the allergies the user said this person has, from the nine below; the user picks each severity on the card, so never ask for or guess one. You cannot see or change the user's existing family profiles: to change or remove someone, tell them to use Profile, Family.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "The person's name, as the user gave it (1 to 50 characters).",
          },
          allergens: {
            type: "array",
            items: { type: "string", enum: [...allergenIds] },
            description:
              "The allergies the user said this person has. Leave out an allergy that is not one of these; say it can be added in Profile, Family.",
          },
        },
        required: ["name"],
      },
    },
  }),
  argsSchema: addFamilyMemberCardArgsSchema,
  run: async (args, { opts }) =>
    familyCardResult(
      await opts.onWriteCardProposal?.({ kind: "family", args }),
    ),
});

export const FAMILY_TOOLS: CoachToolEntry[] = [addFamilyMemberTool];
