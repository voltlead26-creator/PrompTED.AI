import { beforeEach, describe, expect, it } from "vitest";
import {
  listDeviceData,
  purgeUserDeviceData,
  readDeviceData,
  removeDeviceData,
  writeDeviceData,
  type DeviceDataScope,
} from "./owner-bound-device-store";

const userA: DeviceDataScope = { kind: "user", userId: "user-a" };
const userB: DeviceDataScope = { kind: "user", userId: "user-b" };
const guest: DeviceDataScope = { kind: "guest", deviceId: "device-1" };
const isNote = (value: unknown): value is { text: string } =>
  Boolean(value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string");

describe("owner-bound-device-store", () => {
  beforeEach(() => localStorage.clear());

  it("binds values and listings to one exact owner", () => {
    expect(writeDeviceData(userA, "note", "one", { text: "User A" })).toBe(true);
    expect(writeDeviceData(userB, "note", "one", { text: "User B" })).toBe(true);
    expect(writeDeviceData(guest, "note", "one", { text: "Guest" })).toBe(true);

    expect(readDeviceData(userA, "note", "one", isNote)?.text).toBe("User A");
    expect(readDeviceData(userB, "note", "one", isNote)?.text).toBe("User B");
    expect(readDeviceData(guest, "note", "one", isNote)?.text).toBe("Guest");
    expect(listDeviceData(userA, "note", isNote)).toEqual([
      { id: "one", value: { text: "User A" } },
    ]);
  });

  it("quarantines malformed or owner-mismatched envelopes", () => {
    localStorage.setItem(
      "prompted:device-data:v2:user%3Auser-a:note:one",
      JSON.stringify({
        version: 2,
        owner: "user:user-b",
        resource: "note",
        id: "one",
        value: { text: "Wrong owner" },
      }),
    );
    expect(readDeviceData(userA, "note", "one", isNote)).toBeNull();
  });

  it("purges one deleted user while preserving another user and guest data", () => {
    writeDeviceData(userA, "note", "one", { text: "User A" });
    writeDeviceData(userB, "note", "one", { text: "User B" });
    writeDeviceData(guest, "note", "one", { text: "Guest" });

    expect(purgeUserDeviceData("user-a")).toBe(true);
    expect(readDeviceData(userA, "note", "one", isNote)).toBeNull();
    expect(readDeviceData(userB, "note", "one", isNote)?.text).toBe("User B");
    expect(readDeviceData(guest, "note", "one", isNote)?.text).toBe("Guest");

    removeDeviceData(userB, "note", "one");
    expect(readDeviceData(userB, "note", "one", isNote)).toBeNull();
  });
});
