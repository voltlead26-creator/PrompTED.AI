import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("atomic checklist persistence contract", () => {
  it("uses the single owner-scoped RPC for initial and refined checklists", () => {
    const initial = source(
      "src/app/(app)/outcomes/[id]/checklist/InteractiveChecklistOutcome.tsx",
    );
    const refinement = source("src/components/organisms/ConversationView.tsx");

    for (const implementation of [initial, refinement]) {
      expect(implementation).toContain("replaceOwnChecklist");
      expect(implementation).not.toMatch(
        /from\(["']checklist_items["']\)[\s\S]{0,160}\.delete\(/,
      );
    }
    expect(refinement).toContain("persistenceRevision!.updated_at");
    expect(initial).toContain("outcome.updated_at");
  });

  it("binds item edits and the deploy preflight to the opaque-token RPC", () => {
    const hook = source("src/hooks/useChecklist.ts");
    const api = source("src/lib/api/checklists.ts");
    const contract = JSON.parse(
      source("../../supabase/deployment-contract.json"),
    ) as {
      requiredRpcSignatures: Record<string, string>;
      webRequirements: { requiredMigrations: string[]; requiredRpcs: string[] };
    };

    expect(hook).toContain("updateOwnChecklistItem");
    expect(hook).not.toMatch(/\.from\(["']checklist_items["']\)[\s\S]{0,200}\.update\(/);
    expect(api).toContain("p_expected_mutation_token");
    expect(contract.requiredRpcSignatures.update_own_checklist_item).toBe(
      "uuid, uuid, uuid, boolean, text",
    );
    expect(contract.webRequirements.requiredMigrations).toContain(
      "20260901103000_checklist_item_cas",
    );
    expect(contract.webRequirements.requiredRpcs).toContain("update_own_checklist_item");
  });
});
