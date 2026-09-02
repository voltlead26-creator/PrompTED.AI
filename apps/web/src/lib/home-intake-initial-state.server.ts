import { createClient } from "@/lib/supabase/server";
import {
  adaptHomeUploadIntakeSnapshot,
  type HomeIntakeInitialState,
} from "./home-intake-initial-state";

function unavailable(
  authenticated: boolean,
  ownerUserId: string | null = null,
): HomeIntakeInitialState {
  return { authenticated, ownerUserId, persistence: "unavailable", intake: null };
}

interface HomeIntakeRpcResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

/** Loads the latest owner-scoped Home intake before the Client Component hydrates. */
export async function loadHomeIntakeInitialState(): Promise<HomeIntakeInitialState> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) return unavailable(false);
  if (!auth.user) {
    return { authenticated: false, ownerUserId: null, persistence: "anonymous", intake: null };
  }

  try {
    const ownerClient = supabase as unknown as {
      rpc: (
        name: "get_own_home_upload_intake_v1",
        args: { p_intake_id: null },
      ) => Promise<HomeIntakeRpcResult>;
    };
    // Supabase's rpc method reads private client state through `this`; invoking an
    // extracted method loses that binding and makes every authenticated read look
    // unavailable in the real SSR client even though simple function mocks pass.
    const { data, error } = await ownerClient.rpc("get_own_home_upload_intake_v1", {
      p_intake_id: null,
    });
    if (error) return unavailable(true, auth.user.id);
    if (data === null) {
      return {
        authenticated: true,
        ownerUserId: auth.user.id,
        persistence: "not_found",
        intake: null,
      };
    }
    return {
      authenticated: true,
      ownerUserId: auth.user.id,
      persistence: "persisted",
      intake: adaptHomeUploadIntakeSnapshot(data, auth.user.id),
    };
  } catch {
    return unavailable(true, auth.user.id);
  }
}
