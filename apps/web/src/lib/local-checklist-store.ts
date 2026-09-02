"use client";

import type { ChecklistItem } from "@prompted/shared";
import {
  listDeviceData,
  readDeviceData,
  writeDeviceData,
  type DeviceDataScope,
} from "./owner-bound-device-store";

const CHECKLIST_RESOURCE = "checklist";
const CHECKLIST_SAVED_RESOURCE = "checklist-saved";

function isChecklist(value: unknown): value is ChecklistItem[] {
  return (
    Array.isArray(value) &&
    value.length <= 1_000 &&
    value.every(
      (item) =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as Partial<ChecklistItem>).id === "string" &&
        typeof (item as Partial<ChecklistItem>).outcome_id === "string" &&
        typeof (item as Partial<ChecklistItem>).text === "string" &&
        typeof (item as Partial<ChecklistItem>).done === "boolean",
    )
  );
}

function isSaved(value: unknown): value is { saved: true } {
  return Boolean(value && typeof value === "object" && (value as { saved?: unknown }).saved === true);
}

export function loadLocalChecklist(
  scope: DeviceDataScope,
  outcomeId: string,
): ChecklistItem[] {
  const items = readDeviceData(scope, CHECKLIST_RESOURCE, outcomeId, isChecklist) ?? [];
  return items.every((item) => item.outcome_id === outcomeId) ? items : [];
}

export function saveLocalChecklist(
  scope: DeviceDataScope,
  outcomeId: string,
  items: ChecklistItem[],
): boolean {
  if (!isChecklist(items) || items.some((item) => item.outcome_id !== outcomeId)) return false;
  return writeDeviceData(scope, CHECKLIST_RESOURCE, outcomeId, items);
}

export function isLocalChecklistSaved(scope: DeviceDataScope, outcomeId: string): boolean {
  return Boolean(readDeviceData(scope, CHECKLIST_SAVED_RESOURCE, outcomeId, isSaved));
}

export function markLocalChecklistSaved(scope: DeviceDataScope, outcomeId: string): boolean {
  return writeDeviceData(scope, CHECKLIST_SAVED_RESOURCE, outcomeId, { saved: true as const });
}

export function listSavedLocalChecklists(
  scope: DeviceDataScope,
): Array<{ outcomeId: string; items: ChecklistItem[] }> {
  return listDeviceData(scope, CHECKLIST_RESOURCE, isChecklist)
    .filter(({ id, value }) =>
      value.every((item) => item.outcome_id === id) && isLocalChecklistSaved(scope, id),
    )
    .map(({ id, value }) => ({ outcomeId: id, items: value }));
}
