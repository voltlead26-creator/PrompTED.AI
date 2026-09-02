import { assert } from "jsr:@std/assert@1";

Deno.test("generate-document opts into provider checkpoints only after allowance admission", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  const reserve = source.indexOf("await reserveDocumentAllowance");
  const replay = source.indexOf("if (reservation.replayResult)");
  const checkpoint = source.indexOf("setModelCallCheckpointContext(req.signal");
  const provider = source.indexOf("designBespokeTemplate", checkpoint);
  assert(
    reserve >= 0 && replay > reserve && checkpoint > replay &&
      provider > checkpoint,
  );
  assert(source.includes('scope: "generate-document"'));
  assert(source.includes("originReservationId: reservation.reservationId"));
  assert(
    source.includes("executionClaimToken: reservation.executionClaimToken!"),
  );
});
