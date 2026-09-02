import { beforeEach, describe, expect, it } from "vitest";
import {
  createManualPlan,
  createManualPlanItem,
  listManualPlans,
  loadManualPlan,
  moveManualPlanItem,
  saveManualPlan,
} from "./manual-plan-store";
import { currentDeviceDataScope } from "@/lib/owner-bound-device-store";

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
    const scope = currentDeviceDataScope();
    const plan = createManualPlan();
    plan.title = "Launch checklist";
    plan.items[0]!.text = "Confirm launch owner";
    saveManualPlan(scope, plan);

    expect(loadManualPlan(scope, plan.id)?.title).toBe("Launch checklist");
    const listed = listManualPlans(scope);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.items[0]!.text).toBe("Confirm launch owner");
  });

  it("never exposes one account's device plan to another account or the guest profile", () => {
    const userA = currentDeviceDataScope("user-a");
    const userB = currentDeviceDataScope("user-b");
    const guest = currentDeviceDataScope();
    const plan = createManualPlan();
    plan.title = "User A private plan";

    expect(saveManualPlan(userA, plan)).toBe(true);
    expect(loadManualPlan(userA, plan.id)?.title).toBe("User A private plan");
    expect(loadManualPlan(userB, plan.id)).toBeNull();
    expect(loadManualPlan(guest, plan.id)).toBeNull();
    expect(listManualPlans(userB)).toEqual([]);
    expect(listManualPlans(guest)).toEqual([]);
  });
});
