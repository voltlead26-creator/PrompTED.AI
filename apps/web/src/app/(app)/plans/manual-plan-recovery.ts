import { parseManualPlanSaveCommand, type ManualPlanSaveCommand, type ManualPlanVersion } from "@prompted/shared";
import type { ManualPlanState } from "./manual-plan-store";
import { listDeviceData, type DeviceDataScope } from "@/lib/owner-bound-device-store";

export const MANUAL_PLAN_RECOVERY_RESOURCE = "manual-plan-recovery";

export interface ManualPlanRecovery {
  version: 1;
  ownerId: string;
  plan: ManualPlanState;
  expected: ManualPlanVersion | null;
  pending: ManualPlanSaveCommand | null;
  dirty: boolean;
  rejected?: { code: "MANUAL_PLAN_INPUT_INVALID" | "MANUAL_PLAN_ITEM_REMOVAL_BLOCKED"; command: ManualPlanSaveCommand };
}
const VALIDATION_OPERATION = "00000000-0000-4000-8000-000000000001";
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

// Recovery is deliberately a lossless shape check. Invalid civil dates, long
// wording and duplicate IDs remain available to repair; wire admission below
// rejects them without coercing or silently dropping any user content.
export function manualPlanDraftShape(value: unknown): value is ManualPlanState {
  return record(value) && Object.keys(value).sort().join() === "id,items,title,updatedAt" &&
    typeof value.id === "string" && typeof value.title === "string" && typeof value.updatedAt === "string" &&
    Array.isArray(value.items) && value.items.every(item => record(item) &&
      Object.keys(item).sort().join() === "done,dueDate,id,notes,section,text" &&
      ["id", "section", "text", "notes", "dueDate"].every(key => typeof item[key] === "string") && typeof item.done === "boolean");
}
export function manualPlanCommand(plan: ManualPlanState, expected: ManualPlanVersion | null, operationId: string): ManualPlanSaveCommand | null {
  return parseManualPlanSaveCommand({ contract_version: "manual-plan-save.1", operation_id: operationId,
    plan_id: plan.id, expected, title: plan.title, items: plan.items.map(item => ({
      id: item.id, section: item.section, text: item.text, notes: item.notes, due_date: item.dueDate || null, done: item.done,
    })) });
}
export function manualPlanRecoveryShape(value: unknown): value is ManualPlanRecovery {
  if (!record(value) || !["dirty,expected,ownerId,pending,plan,version", "dirty,expected,ownerId,pending,plan,rejected,version"].includes(Object.keys(value).sort().join()) ||
    value.version !== 1 || typeof value.ownerId !== "string" || !manualPlanDraftShape(value.plan) || typeof value.dirty !== "boolean") return false;
  // Validate version metadata independently of potentially invalid draft text.
  const probe = manualPlanCommand({ id: value.plan.id, title: "", items: [{ id: "probe", section: "", text: "", notes: "", dueDate: "", done: false }], updatedAt: "" },
    value.expected as ManualPlanVersion | null, VALIDATION_OPERATION);
  if (!probe) return false;
  if (Object.hasOwn(value, "rejected")) {
    if (!record(value.rejected) || Object.keys(value.rejected).sort().join() !== "code,command" ||
      typeof value.rejected.code !== "string" ||
      !["MANUAL_PLAN_INPUT_INVALID", "MANUAL_PLAN_ITEM_REMOVAL_BLOCKED"].includes(value.rejected.code)) return false;
    const rejected = parseManualPlanSaveCommand(value.rejected.command);
    if (!rejected || rejected.plan_id !== value.plan.id) return false;
  }
  if (value.pending === null) return true;
  const command = parseManualPlanSaveCommand(value.pending);
  return command !== null && command.plan_id === value.plan.id && (command.expected === null ? probe.expected === null :
    probe.expected !== null && command.expected.outcome_id === probe.expected.outcome_id &&
    command.expected.artifact_id === probe.expected.artifact_id && command.expected.revision === probe.expected.revision &&
    command.expected.updated_at === probe.expected.updated_at);
}

export function listManualPlanRecoveries(scope: DeviceDataScope): Array<{ id: string; value: ManualPlanRecovery }> {
  if (scope.kind !== "user") return [];
  return listDeviceData(scope, MANUAL_PLAN_RECOVERY_RESOURCE, manualPlanRecoveryShape)
    .filter(({ id, value }) => id.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) &&
      value.ownerId === scope.userId && (value.dirty || value.pending !== null));
}
