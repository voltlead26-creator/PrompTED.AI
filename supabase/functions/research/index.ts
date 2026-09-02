// =====================================================
// PrompTED — Research Function
// Authenticated fail-closed boundary pending independent claim verification.
// =====================================================

import { guardRequest } from "../_shared/auth-guard.ts";
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { handleResearchRequest } from "./handler.ts";

const forbiddenDownstream = async (): Promise<never> => {
  throw new Error("RESEARCH_GATE_DOWNSTREAM_FORBIDDEN");
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
