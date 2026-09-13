import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), workspace: vi.fn(), redirect: vi.fn() }));
vi.mock("./manual-plan-route.server", () => ({ resolveManualPlanRoute: mocks.resolve }));
vi.mock("@/lib/workspace-initial-state.server", () => ({ loadWorkspaceInitialState: mocks.workspace }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("./[id]/WorkspaceScreen", () => ({ WorkspaceScreen: () => <div>Document workspace</div> }));
vi.mock("./[id]/checklist/InteractiveChecklistOutcome", () => ({ InteractiveChecklistOutcome: () => <div>Generated checklist</div> }));
import OutcomePage from "./[id]/page";
import ChecklistOutcomePage from "./[id]/checklist/page";
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { vi.clearAllMocks(); mocks.redirect.mockImplementation(() => { throw new Error("REDIRECT"); }); });
describe("manual outcome entry points", () => {
  it.each([OutcomePage, ChecklistOutcomePage])("routes persisted manual identity before any generated workflow", async page => {
    mocks.resolve.mockResolvedValue({ kind: "manual", planId: "old-plan:1" });
    await expect(page({ params: Promise.resolve({ id }) })).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/plans?create=manual&plan=old-plan%3A1");
    expect(mocks.workspace).not.toHaveBeenCalled();
  });
  it.each([OutcomePage, ChecklistOutcomePage])("shows retry after identity lookup failure without generation", async page => {
    mocks.resolve.mockResolvedValue({ kind: "unavailable" });
    render(await page({ params: Promise.resolve({ id }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("Retry");
    expect(screen.queryByText("Generated checklist")).not.toBeInTheDocument();
    expect(mocks.workspace).not.toHaveBeenCalled();
  });
  it("retains generated checklist routing after an authoritative non-manual result", async () => {
    mocks.resolve.mockResolvedValue({ kind: "other" });
    render(await ChecklistOutcomePage({ params: Promise.resolve({ id }) }));
    expect(screen.getByText("Generated checklist")).toBeInTheDocument();
  });
});
