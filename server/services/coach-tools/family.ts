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
        "Show the user a card to add one person to their family profiles, the people they plan meals for. Nothing is saved until the user taps Save on the card. Call this only when the user asks to add someone and gives their name, used exactly as given. If they give only a relation (\"my wife\") or no name, ask what to call the person; never use the relation word or make up a name. Not for the user themselves, and not for a pet. A family member's allergies go only in this tool's allergens, never in an add_allergy card, which is for the user's own allergies. The user picks each severity on the card, so never ask for or guess one. You cannot see the user's existing family profiles: if asked who is in their family or about someone's allergies, say you cannot see that and point to Profile, Family, where they also change or remove someone; never guess.",
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
              'The allergies the user said this person has, from these nine only. "Nuts" alone is ambiguous: ask whether they mean peanuts, tree nuts (almonds, walnuts, cashews) or both before calling. Never swap in a nearby allergen for one that is not listed: leave it out, and say in your reply that it is not recorded and can be added in Profile, Family.',
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
