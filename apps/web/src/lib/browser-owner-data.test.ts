import { beforeEach, describe, expect, it } from "vitest";
import { purgeBrowserDataForUser } from "./browser-owner-data";
import { readDeviceData, writeDeviceData, type DeviceDataScope } from "./owner-bound-device-store";

const userA: DeviceDataScope = { kind: "user", userId: "user-a" };
const userB: DeviceDataScope = { kind: "user", userId: "user-b" };
const guest: DeviceDataScope = { kind: "guest", deviceId: "device-1" };
const isNote = (value: unknown): value is { text: string } =>
  Boolean(value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string");

describe("purgeBrowserDataForUser", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("removes only records owned by the deleted account", () => {
    writeDeviceData(userA, "note", "one", { text: "User A" });
    writeDeviceData(userB, "note", "one", { text: "User B" });
    writeDeviceData(guest, "note", "one", { text: "Guest" });
    sessionStorage.setItem(
      "prompted:captured-admission:v2:user-a:outcome-a",
      JSON.stringify({ ownerUserId: "user-a" }),
    );
    sessionStorage.setItem(
      "prompted:captured-admission:v2:user-b:outcome-b",
      JSON.stringify({ ownerUserId: "user-b" }),
    );
    sessionStorage.setItem(
      "prompted:legacy-section-edit-operations:v2",
      JSON.stringify({
        a: { userId: "user-a" },
        b: { userId: "user-b" },
      }),
    );

    expect(purgeBrowserDataForUser("user-a")).toBe(true);
    expect(readDeviceData(userA, "note", "one", isNote)).toBeNull();
    expect(readDeviceData(userB, "note", "one", isNote)?.text).toBe("User B");
    expect(readDeviceData(guest, "note", "one", isNote)?.text).toBe("Guest");
    expect(sessionStorage.getItem("prompted:captured-admission:v2:user-a:outcome-a")).toBeNull();
    expect(sessionStorage.getItem("prompted:captured-admission:v2:user-b:outcome-b")).not.toBeNull();
    expect(JSON.parse(sessionStorage.getItem("prompted:legacy-section-edit-operations:v2")!)).toEqual({
      b: { userId: "user-b" },
    });
  });
});
