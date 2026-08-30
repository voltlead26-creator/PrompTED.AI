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

const STORAGE_PREFIX = "prompted:manual-plan:";

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

export function loadGuestManualPlan(id: string): ManualPlanState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${id}`);
    return raw ? normaliseManualPlan(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveGuestManualPlan(plan: ManualPlanState): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${plan.id}`, JSON.stringify(plan));
    return true;
  } catch {
    return false;
  }
}

export function listGuestManualPlans(): ManualPlanState[] {
  if (typeof window === "undefined") return [];
  const plans: ManualPlanState[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const plan = normaliseManualPlan(JSON.parse(raw));
      if (plan) plans.push(plan);
    }
  } catch {
    return [];
  }
  return plans.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
