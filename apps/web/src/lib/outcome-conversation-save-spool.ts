"use client";

import {
  isSaveOutcomeConversationInput,
  type SaveOutcomeConversationInput,
} from "@/lib/api/outcomes";
import {
  readDeviceData,
  removeDeviceData,
  writeDeviceData,
  type DeviceDataScope,
} from "@/lib/owner-bound-device-store";

const CONVERSATION_SAVE_RESOURCE = "outcome-conversation-save-command.v1";

export function loadConversationSaveCommand(
  scope: DeviceDataScope,
  outcomeId: string,
): SaveOutcomeConversationInput | null {
  const command = readDeviceData(
    scope,
    CONVERSATION_SAVE_RESOURCE,
    outcomeId,
    isSaveOutcomeConversationInput,
  );
  return command?.outcomeId === outcomeId ? command : null;
}

export function persistConversationSaveCommand(
  scope: DeviceDataScope,
  input: SaveOutcomeConversationInput,
): boolean {
  if (!isSaveOutcomeConversationInput(input)) return false;
  return writeDeviceData(
    scope,
    CONVERSATION_SAVE_RESOURCE,
    input.outcomeId,
    input,
  );
}

export function clearConversationSaveCommand(
  scope: DeviceDataScope,
  outcomeId: string,
): void {
  removeDeviceData(scope, CONVERSATION_SAVE_RESOURCE, outcomeId);
}
