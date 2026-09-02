import { beforeEach, describe, expect, it } from "vitest";
import type { DeviceDataScope } from "./owner-bound-device-store";
import {
  clearConversationSaveCommand,
  loadConversationSaveCommand,
  persistConversationSaveCommand,
} from "./outcome-conversation-save-spool";

const scopeA: DeviceDataScope = { kind: "user", userId: "owner-a" };
const scopeB: DeviceDataScope = { kind: "user", userId: "owner-b" };
const command = {
  outcomeId: "22222222-2222-4222-8222-222222222222",
  expectedConversationRevision: 4,
  requestId: "conversation-save-4",
  conversation: [{ role: "user" as const, text: "Keep these exact words." }],
};

describe("outcome conversation save spool", () => {
  beforeEach(() => localStorage.clear());

  it("persists one validated exact command for one owner and outcome", () => {
    expect(persistConversationSaveCommand(scopeA, command)).toBe(true);
    expect(loadConversationSaveCommand(scopeA, command.outcomeId)).toEqual(command);
    expect(loadConversationSaveCommand(scopeB, command.outcomeId)).toBeNull();
  });

  it("does not expose a command under a different outcome key", () => {
    expect(persistConversationSaveCommand(scopeA, command)).toBe(true);
    expect(
      loadConversationSaveCommand(
        scopeA,
        "33333333-3333-4333-8333-333333333333",
      ),
    ).toBeNull();
  });

  it("clears only after the caller has an authoritative terminal receipt", () => {
    expect(persistConversationSaveCommand(scopeA, command)).toBe(true);
    clearConversationSaveCommand(scopeA, command.outcomeId);
    expect(loadConversationSaveCommand(scopeA, command.outcomeId)).toBeNull();
  });
});
