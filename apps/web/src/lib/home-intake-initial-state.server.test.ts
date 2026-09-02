import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_UPLOAD_INTAKE_VERSION } from "./home-intake-initial-state";

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

import { loadHomeIntakeInitialState } from "./home-intake-initial-state.server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const INTAKE_ID = "22222222-2222-4222-8222-222222222222";
const UPLOAD_ID = "33333333-3333-8333-8333-333333333333";

function processingSnapshot() {
  return {
    contract_version: HOME_UPLOAD_INTAKE_VERSION,
    intake_id: INTAKE_ID,
    owner_user_id: USER_ID,
    upload_id: UPLOAD_ID,
    state: "open",
    revision: 1,
    typed_situation: "Prepare my resume",
    file_name: "resume.pdf",
    file_type: "application/pdf",
    file_size_bytes: 1024,
    content_sha256: "a".repeat(64),
    upload_state: "processing",
    extracted_text: null,
    confirm_payload: null,
    confirmed_text: null,
    confirmed_text_sha256: null,
    outcome_id: null,
    retryable: true,
    safe_next_action: "TED is still processing this upload.",
    updated_at: "2026-09-02T01:02:03.000Z",
    idempotent_replay: false,
  };
}

describe("loadHomeIntakeInitialState", () => {
  beforeEach(() => createClientMock.mockReset());

  it("returns anonymous without querying durable intake state", async () => {
    const rpc = vi.fn();
    createClientMock.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      rpc,
    });

    await expect(loadHomeIntakeInitialState()).resolves.toEqual({
      authenticated: false,
      ownerUserId: null,
      persistence: "anonymous",
      intake: null,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("loads the latest active intake through one owner-scoped RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: processingSnapshot(), error: null });
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
      rpc,
    });

    const state = await loadHomeIntakeInitialState();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_own_home_upload_intake_v1", {
      p_intake_id: null,
    });
    expect(state).toMatchObject({
      authenticated: true,
      ownerUserId: USER_ID,
      persistence: "persisted",
      intake: { intakeId: INTAKE_ID, uploadState: "processing" },
    });
  });

  it("preserves the Supabase client binding when invoking the SSR RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
      rpc,
    };
    createClientMock.mockResolvedValue(client);

    await expect(loadHomeIntakeInitialState()).resolves.toMatchObject({
      authenticated: true,
      ownerUserId: USER_ID,
      persistence: "not_found",
    });
    expect(rpc.mock.contexts).toEqual([client]);
  });

  it("distinguishes a confirmed absence from unavailable or malformed state", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
    createClientMock
      .mockResolvedValueOnce({
        auth: { getUser },
        rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      })
      .mockResolvedValueOnce({
        auth: { getUser },
        rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "XX000" } }),
      })
      .mockResolvedValueOnce({
        auth: { getUser },
        rpc: vi.fn().mockResolvedValue({
          data: { ...processingSnapshot(), owner_user_id: UPLOAD_ID },
          error: null,
        }),
      });

    await expect(loadHomeIntakeInitialState()).resolves.toMatchObject({
      persistence: "not_found",
      intake: null,
    });
    await expect(loadHomeIntakeInitialState()).resolves.toMatchObject({
      persistence: "unavailable",
      intake: null,
    });
    await expect(loadHomeIntakeInitialState()).resolves.toMatchObject({
      persistence: "unavailable",
      intake: null,
    });
  });
});
