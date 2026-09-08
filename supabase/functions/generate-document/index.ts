// Production entry point; admission and generation share the tested handler.
import { handleGenerateDocument } from "./handler.ts";

Deno.serve((req) => handleGenerateDocument(req));
