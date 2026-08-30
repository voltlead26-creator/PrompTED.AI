import { beforeEach, describe, expect, it } from "vitest";
import {
  createManualPlan,
  createManualPlanItem,
  listGuestManualPlans,
  loadGuestManualPlan,
  moveManualPlanItem,
  saveGuestManualPlan,
} from "./manual-plan-store";

describe("manual-plan-store", () => {
  beforeEach(() => window.localStorage.clear());

  it("creates a live-editable plan with one action", () => {
    const plan = createManualPlan();
    expect(plan.title).toBe("Untitled action plan");
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]!.text).toBe("");
    expect(plan.items[0]!.done).toBe(false);
  });

  it("moves actions without changing their content", () => {
    const first = { ...createManualPlanItem(), id: "first", text: "First" };
    const second = { ...createManualPlanItem(), id: "second", text: "Second" };
    const moved = moveManualPlanItem([first, second], "second", -1);
    expect(moved.map((item) => item.id)).toEqual(["second", "first"]);
    expect(moved.map((item) => item.text)).toEqual(["Second", "First"]);
  });

  it("persists, reloads and lists plans saved on this device", () => {
    const plan = createManualPlan();
    plan.title = "Launch checklist";
    plan.items[0]!.text = "Confirm launch owner";
    saveGuestManualPlan(plan);

    expect(loadGuestManualPlan(plan.id)?.title).toBe("Launch checklist");
    const listed = listGuestManualPlans();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.items[0]!.text).toBe("Confirm launch owner");
  });
});
