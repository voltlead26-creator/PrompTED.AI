import { lockExplicitJobDocument } from "./job-template-lock.ts";

function assertEquals(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

for (
  const [request, expected] of [
    [
      "Create Interview Preparation Questions for my warehouse supervisor interview",
      "Interview Preparation Questions",
    ],
    ["I need an interview script", "Interview Script"],
    ["Write a cover letter for this job", "Cover Letter"],
    ["Please rewrite my LinkedIn profile", "LinkedIn Profile Rewrite"],
    ["Build a STAR achievement bank from my resume", "STAR Achievement Bank"],
  ] as const
) {
  Deno.test(`locks explicit request: ${expected}`, () => {
    const result = lockExplicitJobDocument(request);
    assertEquals(result?.primary.name, expected, request);
    assertEquals(result?.alternatives.length, 2, "exactly two alternatives");
  });
}

Deno.test("does not lock a general job-seeking situation", () => {
  assertEquals(
    lockExplicitJobDocument("I need a job and do not know where to start"),
    null,
    "general request",
  );
});
