import { handleTransportVictoriaRequest } from "./handler.ts";

Deno.serve((req) => handleTransportVictoriaRequest(req));
