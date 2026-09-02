export interface ManualPlanItem {
  id: string;
  section: string;
  text: string;
  notes: string;
  dueDate: string;
  done: boolean;
}

export interface ManualPlanState {
  id: string;
  title: string;
  items: ManualPlanItem[];
  updatedAt: string;
}

const MANUAL_PLAN_RESOURCE = "manual-plan";

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createManualPlan(): ManualPlanState {
  return {
    id: makeId("plan"),
    title: "Untitled action plan",
    items: [createManualPlanItem()],
    updatedAt: new Date().toISOString(),
  };
}

export function createManualPlanItem(): ManualPlanItem {
  return {
    id: makeId("step"),
    section: "",
    text: "",
    notes: "",
    dueDate: "",
    done: false,
  };
}

export function normaliseManualPlan(value: unknown): ManualPlanState | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<ManualPlanState>;
  if (!input.id || !Array.isArray(input.items)) return null;
  const items = input.items
    .filter((item): item is ManualPlanItem => Boolean(item && typeof item === "object" && "id" in item))
    .map((item) => ({
      id: String(item.id),
      section: String(item.section ?? ""),
      text: String(item.text ?? ""),
      notes: String(item.notes ?? ""),
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(item.dueDate ?? "")) ? String(item.dueDate) : "",
      done: Boolean(item.done),
    }));
  return {
    id: String(input.id),
    title: String(input.title ?? "Untitled action plan"),
    items: items.length ? items : [createManualPlanItem()],
    updatedAt: String(input.updatedAt ?? new Date().toISOString()),
  };
}

export function moveManualPlanItem(
  items: ManualPlanItem[],
  itemId: string,
  direction: -1 | 1,
): ManualPlanItem[] {
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) return items;
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (!item) return items;
  next.splice(target, 0, item);
  return next;
}

function isManualPlan(value: unknown): value is ManualPlanState {
  return normaliseManualPlan(value) !== null;
}

export function loadManualPlan(
  scope: DeviceDataScope,
  id: string,
): ManualPlanState | null {
  const value = readDeviceData(scope, MANUAL_PLAN_RESOURCE, id, isManualPlan);
  const plan = normaliseManualPlan(value);
  return plan?.id === id ? plan : null;
}

export function saveManualPlan(scope: DeviceDataScope, plan: ManualPlanState): boolean {
  const normalized = normaliseManualPlan(plan);
  if (!normalized || normalized.id !== plan.id) return false;
  return writeDeviceData(scope, MANUAL_PLAN_RESOURCE, plan.id, normalized);
}

export function listManualPlans(scope: DeviceDataScope): ManualPlanState[] {
  return listDeviceData(scope, MANUAL_PLAN_RESOURCE, isManualPlan)
    .flatMap(({ id, value }) => {
      const plan = normaliseManualPlan(value);
      return plan?.id === id ? [plan] : [];
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
import {
  listDeviceData,
  readDeviceData,
  writeDeviceData,
  type DeviceDataScope,
} from "@/lib/owner-bound-device-store";
