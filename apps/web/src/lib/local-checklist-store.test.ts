import { beforeEach, describe, expect, it } from "vitest";
import type { ChecklistItem } from "@prompted/shared";
import type { DeviceDataScope } from "./owner-bound-device-store";
import {
  isLocalChecklistSaved,
  listSavedLocalChecklists,
  loadLocalChecklist,
  markLocalChecklistSaved,
  saveLocalChecklist,
} from "./local-checklist-store";

const userA: DeviceDataScope = { kind: "user", userId: "user-a" };
const userB: DeviceDataScope = { kind: "user", userId: "user-b" };
const guest: DeviceDataScope = { kind: "guest", deviceId: "device-1" };
const item: ChecklistItem = {
  id: "item-1",
  outcome_id: "outcome-1",
  user_id: "user-a",
  text: "Confirm the owner",
  due_date: null,
  reason: null,
  done: false,
  reminder_offset_days: null,
  reminder_sent: false,
  order_index: 0,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
};

describe("local-checklist-store", () => {
  beforeEach(() => localStorage.clear());

  it("keeps checklists and saved status isolated by owner", () => {
    expect(saveLocalChecklist(userA, "outcome-1", [item])).toBe(true);
    expect(markLocalChecklistSaved(userA, "outcome-1")).toBe(true);

    expect(loadLocalChecklist(userA, "outcome-1")).toEqual([item]);
    expect(isLocalChecklistSaved(userA, "outcome-1")).toBe(true);
    expect(listSavedLocalChecklists(userA)).toEqual([
      { outcomeId: "outcome-1", items: [item] },
    ]);
    expect(loadLocalChecklist(userB, "outcome-1")).toEqual([]);
    expect(loadLocalChecklist(guest, "outcome-1")).toEqual([]);
    expect(listSavedLocalChecklists(userB)).toEqual([]);
  });

  it("rejects checklist rows bound to another outcome", () => {
    expect(saveLocalChecklist(userA, "outcome-2", [item])).toBe(false);
    expect(loadLocalChecklist(userA, "outcome-2")).toEqual([]);
  });
});
