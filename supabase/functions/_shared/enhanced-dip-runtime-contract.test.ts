import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  renderProfile,
  selectProfile,
} from "./document-intelligence-profiles.ts";
import {
  createDocumentPlaceholderToken,
  determinePlaceholderExportDecision,
  renderDocumentPlaceholderLabels,
  resolveDocumentPlaceholders,
  type UnresolvedDocumentPlaceholder,
} from "./document-placeholder-policy.ts";

Deno.test("Resume Enhanced DIP renders all nine required information decisions", () => {
  const profile = selectProfile("resume", "employment");
  assert(profile?.informationContract);
  const rendered = renderProfile(profile, "document");
  const contact =
    profile.informationContract.sections[0].requiredInformation[0];
  for (
    const expected of [
      `information_key=${contact.key}`,
      `label=${contact.label}`,
      `fact_type=${contact.factType}`,
      `placeholder_label=${contact.placeholderLabel}`,
      `question=${contact.question}`,
      "automatic_fallback=",
      `required_for_export=${contact.requiredForExport}`,
      `shared_resolution_key=${contact.sharedResolutionKey ?? "<none>"}`,
      "neutral_replacements=",
    ]
  ) {
    assertStringIncludes(rendered, expected);
  }
});

Deno.test("placeholder resolution is scoped by id and shared resolution key", () => {
  const placeholders: UnresolvedDocumentPlaceholder[] = [
    {
      id: "resume.contact.full_name",
      profileKey: "resume",
      sectionKey: "contact_details",
      informationKey: "full_name",
      label: "your full name",
      question: "What is your full name?",
      factType: "person_name",
      requiredForExport: true,
      sharedResolutionKey: "candidate.full_name",
      neutralReplacementOptions: [],
    },
    {
      id: "resume.summary.full_name",
      profileKey: "resume",
      sectionKey: "professional_summary",
      informationKey: "full_name",
      label: "your full name",
      question: "What is your full name?",
      factType: "person_name",
      requiredForExport: true,
      sharedResolutionKey: "candidate.full_name",
      neutralReplacementOptions: [],
    },
    {
      id: "resume.contact.email",
      profileKey: "resume",
      sectionKey: "contact_details",
      informationKey: "email",
      label: "your email",
      question: "What is your email?",
      factType: "contact_detail",
      requiredForExport: true,
      neutralReplacementOptions: [],
    },
  ];
  const content = {
    contact_details: `${
      createDocumentPlaceholderToken(placeholders[0].id, placeholders[0].label)
    } · ${
      createDocumentPlaceholderToken(placeholders[2].id, placeholders[2].label)
    }`,
    professional_summary: `${
      createDocumentPlaceholderToken(placeholders[1].id, placeholders[1].label)
    } is an experienced professional.`,
  };
  const resolved = resolveDocumentPlaceholders(
    content,
    placeholders,
    placeholders[0].id,
    "Kai Churchward",
  );
  assertEquals(resolved.unresolved.map((item) => item.id), [
    "resume.contact.email",
  ]);
  assertStringIncludes(
    resolved.contentBySection.contact_details,
    "Kai Churchward",
  );
  assertStringIncludes(
    resolved.contentBySection.professional_summary,
    "Kai Churchward",
  );
  assertStringIncludes(
    resolved.contentBySection.contact_details,
    createDocumentPlaceholderToken(placeholders[2].id, placeholders[2].label),
  );
});

Deno.test("export decision requires acknowledgement for required unresolved facts", () => {
  const placeholders: UnresolvedDocumentPlaceholder[] = [{
    id: "resume.contact.email",
    profileKey: "resume",
    sectionKey: "contact_details",
    informationKey: "email_address",
    label: "your email address",
    question: "What email address should employers use?",
    factType: "contact_detail",
    requiredForExport: true,
    neutralReplacementOptions: [],
  }];
  assertEquals(
    determinePlaceholderExportDecision(placeholders).status,
    "acknowledgement_required",
  );
});

Deno.test("raw TED tokens render as visible labels for export", () => {
  const token = createDocumentPlaceholderToken(
    "resume.contact.email",
    "your email address",
  );
  assertEquals(
    renderDocumentPlaceholderLabels(`Email: ${token}`),
    "Email: your email address",
  );
});
