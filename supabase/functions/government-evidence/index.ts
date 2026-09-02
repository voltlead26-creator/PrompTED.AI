import { handleGovernmentEvidenceRequest } from "./handler.ts";

Deno.serve((req) => handleGovernmentEvidenceRequest(req));
