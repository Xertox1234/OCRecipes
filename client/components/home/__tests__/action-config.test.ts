import {
  HOME_ACTIONS,
  getActionsByGroup,
  navigateAction,
} from "../action-config";

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

    // The server refuses free-tier text parsing (textFoodParsing), so the row
    // must be locked, not offered (user decision 2026-09-26: lock, not hide).
    it("marks Quick Log as premium", () => {
      const quickLog = HOME_ACTIONS.find((a) => a.id === "quick-log");
      expect(quickLog?.premium).toBe(true);
    });

    // Same lock as the Profile Pantry tile (QA sweep #65).
    it("marks Pantry as premium", () => {
      const pantry = HOME_ACTIONS.find((a) => a.id === "pantry");
      expect(pantry?.premium).toBe(true);
    });

    it("premium row actions have a subtitle (shown under the label)", () => {
      const premiumActions = HOME_ACTIONS.filter((a) => a.premium);
      for (const action of premiumActions) {
        expect(action.subtitle).toBeTruthy();
      }
    });
  });

  // QA sweep #3 (owner 2026-10-19): every Home recipes row has a subtitle;
  // inline drawers (HomeInlineDrawer) render it too.
  describe("subtitles", () => {
    it("every recipes row and every inline drawer has a subtitle", () => {
      const rows = HOME_ACTIONS.filter(
        (a) => a.group === "recipes" || a.renderInline,
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const action of rows) {
        expect(action.subtitle, action.id).toBeTruthy();
      }
    });
  });

  describe("getActionsByGroup", () => {
    it("returns only scanning actions", () => {
      const actions = getActionsByGroup("scanning");
      expect(actions.length).toBe(7);
      expect(actions.every((a) => a.group === "scanning")).toBe(true);
    });

    it("returns only nutrition actions", () => {
      const actions = getActionsByGroup("nutrition");
      expect(actions.length).toBe(1);
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

  describe("navigateAction camera entries", () => {
    const run = (id: string) => {
      const navigate = vi.fn();
      const action = HOME_ACTIONS.find((a) => a.id === id)!;
      navigateAction(action, { navigate } as unknown as Parameters<
        typeof navigateAction
      >[1]);
      return navigate;
    };

    it('photo-food-log navigates to Scan with { intent: "log" }', () => {
      expect(run("photo-food-log")).toHaveBeenCalledWith("Scan", {
        intent: "log",
      });
    });

    it("scan-barcode navigates to Scan with no params", () => {
      expect(run("scan-barcode")).toHaveBeenCalledWith("Scan");
    });

    // Owner's condition: every + menu item keeps opening its own screen.
    it("scan-receipt still opens ReceiptCapture", () => {
      expect(run("scan-receipt")).toHaveBeenCalledWith("ReceiptCapture");
    });

    it('scan-nutrition-label still opens Scan with { mode: "label" }', () => {
      expect(run("scan-nutrition-label")).toHaveBeenCalledWith("Scan", {
        mode: "label",
      });
    });

    it("batch-scan still opens BatchScan", () => {
      expect(run("batch-scan")).toHaveBeenCalledWith("BatchScan");
    });

    it('snap-anything opens Scan with { mode: "smart" }', () => {
      expect(run("snap-anything")).toHaveBeenCalledWith("Scan", {
        mode: "smart",
      });
    });

    it('scan-menu opens the menu camera: Scan with { intent: "menu" }', () => {
      expect(run("scan-menu")).toHaveBeenCalledWith("Scan", {
        intent: "menu",
      });
    });

    it("snap-anything is first in the scanning group", () => {
      expect(getActionsByGroup("scanning")[0].id).toBe("snap-anything");
    });
  });
});
