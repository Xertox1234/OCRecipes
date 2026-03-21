import { HOME_ACTIONS, getActionsByGroup } from "../action-config";

describe("action-config", () => {
  describe("HOME_ACTIONS", () => {
    it("has unique IDs for all actions", () => {
      const ids = HOME_ACTIONS.map((a) => a.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("every action has required fields", () => {
      for (const action of HOME_ACTIONS) {
        expect(action.id).toBeTruthy();
        expect(action.group).toBeTruthy();
        expect(action.icon).toBeTruthy();
        expect(action.label).toBeTruthy();
      }
    });

    it("premium actions have subtitle (shown as feature cards)", () => {
      const premiumActions = HOME_ACTIONS.filter((a) => a.premium);
      for (const action of premiumActions) {
        expect(action.subtitle).toBeTruthy();
      }
    });
  });

  describe("getActionsByGroup", () => {
    it("returns only scanning actions", () => {
      const actions = getActionsByGroup("scanning");
      expect(actions.length).toBe(6);
      expect(actions.every((a) => a.group === "scanning")).toBe(true);
    });

    it("returns only nutrition actions", () => {
      const actions = getActionsByGroup("nutrition");
      expect(actions.length).toBe(5);
      expect(actions.every((a) => a.group === "nutrition")).toBe(true);
    });

    it("returns only recipes actions", () => {
      const actions = getActionsByGroup("recipes");
      expect(actions.length).toBe(4);
      expect(actions.every((a) => a.group === "recipes")).toBe(true);
    });

    it("returns only planning actions", () => {
      const actions = getActionsByGroup("planning");
      expect(actions.length).toBe(3);
      expect(actions.every((a) => a.group === "planning")).toBe(true);
    });

    it("all groups sum to total actions", () => {
      const total =
        getActionsByGroup("scanning").length +
        getActionsByGroup("nutrition").length +
        getActionsByGroup("recipes").length +
        getActionsByGroup("planning").length;
      expect(total).toBe(HOME_ACTIONS.length);
    });
  });
});
