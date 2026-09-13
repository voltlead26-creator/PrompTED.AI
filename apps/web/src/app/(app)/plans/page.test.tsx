import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlansPage from "./page";
import { createManualPlan, saveManualPlan } from "./manual-plan-store";
import { currentDeviceDataScope } from "@/lib/owner-bound-device-store";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";
import type { ManualPlanSaveCommand, ManualPlanSnapshot } from "@prompted/shared";

const auth = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  loading: false,
}));
const account = vi.hoisted(() => ({ plans: new Map<string, ManualPlanSnapshot>(), read: vi.fn(), save: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/api/manual-plans", () => ({ readManualPlan: account.read, saveManualPlanCommand: account.save, listRemoteManualPlans: account.list }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/components/providers", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useChecklist", () => ({ useWhatsDue: () => ({ items: [] }) }));
vi.mock("@/components/organisms/ChecklistLibrary", () => ({
  ChecklistLibrary: () => <div>Generated checklist library</div>,
}));
vi.mock("@/hooks/useEditWithTED", () => ({
  useEditWithTED: () => ({ run: vi.fn(), streaming: false, error: null }),
}));

function navigate(url: string) {
  window.history.pushState(null, "", url);
}

describe("Plans page query navigation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    navigate("/plans");
    auth.user = { id: "11111111-1111-4111-8111-111111111111" };
    auth.loading = false;
    recordBrowserPrincipal(auth.user.id);
    account.plans.clear(); vi.clearAllMocks();
    account.read.mockImplementation(async ({ planId }, lease) => {
      const plan = account.plans.get(planId);
      return plan?.owner_id === lease.expectedUserId ? plan : null;
    });
    account.save.mockImplementation(async (command: ManualPlanSaveCommand, lease) => {
      const revision = (command.expected?.revision ?? 0) + 1;
      const stamp = `2026-09-13T00:00:00.${String(revision).padStart(6, "0")}Z`;
      const plan: ManualPlanSnapshot = { contract_version: "manual-plan.1", owner_id: lease.expectedUserId, plan_id: command.plan_id,
        outcome_id: "22222222-2222-4222-8222-222222222222", artifact_id: "33333333-3333-4333-8333-333333333333",
        revision, created_at: "2026-09-13T00:00:00.000000Z", updated_at: stamp, title: command.title, items: command.items };
      account.plans.set(command.plan_id, plan);
      return { contract_version: "manual-plan-save.1", owner_id: lease.expectedUserId, operation_id: command.operation_id,
        request_sha256: "a".repeat(64), status: "saved", committed: { outcome_id: plan.outcome_id, artifact_id: plan.artifact_id,
          revision, updated_at: stamp }, snapshot: plan };
    });
    account.list.mockImplementation(async (_options, lease) => ({ contract_version: "manual-plan-list.1", owner_id: lease.expectedUserId,
      has_more: false, items: [...account.plans.values()].filter(plan => plan.owner_id === lease.expectedUserId).map(plan => ({
        owner_id: plan.owner_id, plan_id: plan.plan_id, outcome_id: plan.outcome_id, artifact_id: plan.artifact_id, revision: plan.revision,
        updated_at: plan.updated_at, title: plan.title, item_count: plan.items.length, completed_count: plan.items.filter(item => item.done).length,
        next_due_date: null,
      })) }));
  });

  it("opens the manual editor without remounting the page and reopens saved edits", async () => {
    const page = render(<PlansPage />);
    navigate(screen.getByRole("link", { name: /Create manually/ }).getAttribute("href")!);
    page.rerender(<PlansPage />);

    fireEvent.change(screen.getByRole("textbox", { name: "Plan title" }), {
      target: { value: "Supplier follow-up" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Action 1" }), {
      target: { value: "Confirm delivery date" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark action 1 complete" }));
    await screen.findByText("Saved to your account");

    navigate(screen.getByRole("link", { name: "Back to plans" }).getAttribute("href")!);
    page.rerender(<PlansPage />);
    const savedLink = await screen.findByRole("link", { name: /Supplier follow-up/ });
    const savedUrl = savedLink.getAttribute("href")!;
    navigate(savedUrl);
    page.rerender(<PlansPage />);
    expect(await screen.findByRole("textbox", { name: "Action 1" })).toHaveValue("Confirm delivery date");
    expect(screen.getByRole("checkbox", { name: "Mark action 1 incomplete" })).toBeChecked();

    page.unmount();
    render(<PlansPage />);
    expect(await screen.findByRole("textbox", { name: "Plan title" })).toHaveValue("Supplier follow-up");
    expect(screen.getByRole("textbox", { name: "Action 1" })).toHaveValue("Confirm delivery date");
  });

  it("switches existing plan identities without showing the previous plan", async () => {
    const scope = currentDeviceDataScope(auth.user?.id);
    const first = { ...createManualPlan(), title: "First plan" };
    const second = { ...createManualPlan(), title: "Second plan" };
    expect(saveManualPlan(scope, first)).toBe(true);
    expect(saveManualPlan(scope, second)).toBe(true);
    navigate(`/plans?create=manual&plan=${first.id}`);
    const page = render(<PlansPage />);
    await screen.findByRole("button", { name: "Save to my account" });
    expect(screen.getByRole("textbox", { name: "Plan title" })).toHaveValue("First plan");

    navigate(`/plans?create=manual&plan=${second.id}`);
    page.rerender(<PlansPage />);
    await screen.findByRole("button", { name: "Save to my account" });
    expect(screen.getByRole("textbox", { name: "Plan title" })).toHaveValue("Second plan");
    navigate("/plans?create=manual");
    page.rerender(<PlansPage />);
    expect(screen.getByRole("textbox", { name: "Plan title" })).toHaveValue("Untitled action plan");
    await screen.findByText("Saved to your account");
  });

  it("responds to TED and unknown modes while preserving the library", async () => {
    const page = render(<PlansPage />);
    navigate("/plans?create=ted");
    page.rerender(<PlansPage />);
    expect(screen.getByRole("region", { name: "Create with TED" })).toBeInTheDocument();
    navigate("/plans?create=unknown");
    page.rerender(<PlansPage />);
    expect(screen.queryByRole("region", { name: "Create with TED" })).not.toBeInTheDocument();
    expect(screen.getByText("Generated checklist library")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Plan title" })).not.toBeInTheDocument();
    await screen.findByText("No manual plans saved to your account yet.");
  });

  it("waits for auth before opening a plan and clears prior owner content on owner changes", async () => {
    const plan = { ...createManualPlan(), title: "Owner private plan" };
    expect(saveManualPlan(currentDeviceDataScope(auth.user?.id), plan)).toBe(true);
    auth.loading = true;
    navigate(`/plans?create=manual&plan=${plan.id}`);
    const page = render(<PlansPage />);
    expect(screen.queryByRole("textbox", { name: "Plan title" })).not.toBeInTheDocument();
    auth.loading = false;
    page.rerender(<PlansPage />);
    expect(screen.getByRole("textbox", { name: "Plan title" })).toHaveValue("Owner private plan");
    await screen.findByRole("button", { name: "Save to my account" });
    auth.user = { id: "44444444-4444-4444-8444-444444444444" };
    recordBrowserPrincipal(auth.user.id);
    page.rerender(<PlansPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This plan is unavailable for this account"));
    expect(screen.queryByRole("textbox", { name: "Plan title" })).not.toBeInTheDocument();
  });
});
