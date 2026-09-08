import { beforeEach, describe, expect, it, vi } from "vitest";
import { commitDocumentImport, type CommitDocumentImportInput } from "./import-workspace";
import type { OwnerDispatchLease } from "@/lib/browser-principal-state";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/owner-client", () => ({
  withOwnerSupabase: (
    _lease: OwnerDispatchLease,
    action: (client: { rpc: typeof rpc }) => unknown,
  ) => action({ rpc }),
}));

const input: CommitDocumentImportInput = {
  uploadId: "94061100-0000-8000-8000-000000000001",
  outcomeId: "94061100-0000-4000-8000-000000000002",
  documentId: "94061100-0000-4000-8000-000000000003",
  title: "Original document",
  situationText: "Import the original",
  recommendationPayload: {},
  sections: [],
};
const lease: OwnerDispatchLease = {
  expectedUserId: "94061100-0000-4000-8000-000000000004",
  principalEpoch: 1,
  signal: new AbortController().signal,
  assertCurrent: vi.fn(),
};
const receipt = {
  status: "committed",
  outcome_id: input.outcomeId,
  document_id: input.documentId,
  idempotent_replay: false,
};

describe("document import receipts", () => {
  beforeEach(() => rpc.mockReset());

  it("returns a fresh receipt bound to the requested destination", async () => {
    rpc.mockResolvedValue({ data: receipt, error: null });
    await expect(commitDocumentImport(input, lease)).resolves.toEqual(receipt);
    expect(rpc).toHaveBeenCalledWith(
      "commit_document_import",
      expect.objectContaining({
        p_upload_id: input.uploadId,
        p_document_id: input.documentId,
        p_outcome_id: input.outcomeId,
      }),
    );
  });

  it("accepts the server's earlier destination on exact-upload replay", async () => {
    const prior = {
      ...receipt,
      idempotent_replay: true,
      outcome_id: "94061100-0000-4000-8000-000000000012",
      document_id: "94061100-0000-4000-8000-000000000013",
    };
    rpc.mockResolvedValue({ data: prior, error: null });
    await expect(commitDocumentImport(input, lease)).resolves.toEqual(prior);
  });

  it.each([
    [],
    {},
    { ...receipt, status: "pending" },
    { ...receipt, outcome_id: "missing" },
    { ...receipt, document_id: null },
    { ...receipt, idempotent_replay: "true" },
    { ...receipt, idempotent_replay: undefined },
    { ...receipt, unexpected: "value" },
    { ...receipt, outcome_id: "94061100-0000-4000-8000-000000000012" },
    { ...receipt, document_id: "94061100-0000-4000-8000-000000000013" },
  ])("rejects malformed or mismatched fresh receipt %#", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(commitDocumentImport(input, lease)).rejects.toThrow(
      "IMPORT_COMMIT_INVALID_RESPONSE",
    );
  });

  it("propagates a failed command without inventing a receipt", async () => {
    const error = new Error("commit acknowledgement unavailable");
    rpc.mockResolvedValue({ data: receipt, error });
    await expect(commitDocumentImport(input, lease)).rejects.toBe(error);
  });
});
