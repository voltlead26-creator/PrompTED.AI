import { assert } from "jsr:@std/assert@1";

Deno.test("generate-checklist admits allowance before checkpoint, memory, and provider work", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  const reserve = source.indexOf("await reserveDocumentAllowance");
  const replay = source.indexOf("if (reservation.replayResult)");
  const checkpoint = source.indexOf("setModelCallCheckpointContext(req.signal");
  const memory = source.indexOf("await loadUserMemoryContext", checkpoint);
  const provider = source.indexOf("routeRequest({", checkpoint);
  assert(
    reserve >= 0 && replay > reserve && checkpoint > replay &&
      memory > checkpoint && provider > memory,
  );
  assert(source.includes('scope: "generate-checklist"'));
  assert(
    source.includes("executionClaimToken: reservation.executionClaimToken!"),
  );
});
