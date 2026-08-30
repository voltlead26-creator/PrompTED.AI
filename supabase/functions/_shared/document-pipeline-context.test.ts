import { renderSectionRequirements } from "./document-pipeline-utils.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("section requirements carry vital and optional template intelligence into generation", () => {
  const rendered = renderSectionRequirements({
    key: "experience",
    label: "Work Experience",
    hint: "Relevant roles in reverse chronological order.",
    vital: ["Employer", "Role title", "Dates"],
    improver: ["Measured achievements", "Systems used"],
  });

  assert(rendered.includes("Employer; Role title; Dates"), "vital facts were omitted");
  assert(
    rendered.includes("Optional quality improvers") &&
      rendered.includes("Measured achievements; Systems used"),
    "optional improvers were omitted or treated as mandatory",
  );
});
