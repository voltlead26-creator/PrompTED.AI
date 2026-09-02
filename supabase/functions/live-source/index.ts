// Stable authenticated live-source path, fail-closed until PrompTED has an
// independently evaluated claim-entailment and conflict-verification contract.

import { guardRequest } from "../_shared/auth-guard.ts";
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { handleResearchRequest } from "../research/handler.ts";

const forbiddenDownstream = async (): Promise<never> => {
  throw new Error("LIVE_SOURCE_GATE_DOWNSTREAM_FORBIDDEN");
};

Deno.serve((req) =>
  handleResearchRequest(req, {
    handleOptions,
    guardRequest,
    jsonResponse,
    downstream: {
      readMemory: forbiddenDownstream,
      readDatabaseContent: forbiddenDownstream,
      callProvider: forbiddenDownstream,
    },
  })
);
