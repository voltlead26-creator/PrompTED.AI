import { describe, it, expect } from "vitest";
import {
  TEMPLATES,
  BUNDLES,
  getTemplate,
  getTemplateByName,
  templatesByDomain,
  getBundle,
  bundleTemplates,
  applyPreFill,
  missingRequiredFields,
  normaliseRecommendationForCatalog,
  resolveTemplateByRecommendationName,
} from "./index";
import {
  monthsBetween,
  formatDuration,
  summariseBudget,
} from "./derived-fields";

describe("template catalogue integrity", () => {
  it("ships the complete 86-document extended catalogue", () => {
    expect(TEMPLATES).toHaveLength(86);
  });

  it("covers every launch domain", () => {
    const domains = new Set(TEMPLATES.map((t) => t.domain));
    for (const d of ["employment", "education", "business", "finance"]) {
      expect(domains.has(d as never)).toBe(true);
    }
  });

  it("has unique ids and slugs", () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    expect(new Set(TEMPLATES.map((t) => t.slug)).size).toBe(TEMPLATES.length);
  });

  it("gives every template specific, non-vague section names", () => {
    const vague = /^(section\s*\d*|content|untitled)$/i;
    for (const t of TEMPLATES) {
      expect(t.sections.length).toBeGreaterThan(0);
      for (const s of t.sections) {
        expect(s.name.trim().length).toBeGreaterThan(0);
        expect(vague.test(s.name)).toBe(false);
      }
    }
  });

  it("does not mark every field required (respects optionality)", () => {
    const withFields = TEMPLATES.filter((t) => t.fields.length > 1);
    const anyOptional = withFields.some((t) =>
      t.fields.some((f) => !f.required),
    );
    expect(anyOptional).toBe(true);
  });

  it("sets the correct advice boundaries on high-stakes templates", () => {
    expect(getTemplate("offer-letter")?.advice_boundary).toBe("high-stakes");
    expect(getTemplate("terms-of-employment")?.advice_boundary).toBe("high-stakes");
    expect(getTemplate("service-agreement")?.advice_boundary).toBe("high-stakes");
    expect(getTemplate("performance-review")?.advice_boundary).toBe("light");
    expect(getTemplate("business-email")?.advice_boundary).toBe("none");
  });

  it("makes the Budget Workbook a structured_form with excel export", () => {
    const budget = getTemplate("budget-workbook");
    expect(budget?.structure_type).toBe("structured_form");
    expect(budget?.flags?.export_format).toBe("excel");
    const keys = budget?.sections.map((s) => s.key) ?? [];
    expect(keys).toEqual(
      expect.arrayContaining(["income", "expenses", "savings", "debt"]),
    );
  });

  it("orders templates within a domain by display_order", () => {
    const employment = templatesByDomain("employment");
    const orders = employment.map((t) => t.display_order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("includes complete Phase 2 finance, upload and workforce templates", () => {
    for (const slug of [
      "forecasted-earnings",
      "ebitda-analysis",
      "investment-capital-gains-report",
      "timesheet",
      "staff-roster",
    ]) {
      const template = getTemplate(slug);
      expect(template).toBeDefined();
      expect(template?.sections.length).toBeGreaterThanOrEqual(3);
      expect(template?.missing_detail_rules.length).toBeGreaterThanOrEqual(3);
      expect(template?.flags?.supports_upload).toBe(true);
    }

    expect(getTemplate("forecasted-earnings")?.flags?.visualisations).toContain(
      "scenario comparison",
    );
    expect(getTemplate("timesheet")?.flags?.append_only_history).toBe(true);
    expect(getTemplate("staff-roster")?.flags?.calendar_export).toBe(true);
  });
});

describe("bundles", () => {
  it("has four bundles whose template ids all resolve", () => {
    expect(BUNDLES).toHaveLength(4);
    for (const bundle of BUNDLES) {
      for (const id of bundle.template_ids) {
        expect(getTemplate(id)).toBeDefined();
      }
    }
  });

  it("resolves the 'I need a job' bundle in order", () => {
    const templates = bundleTemplates("i-need-a-job");
    expect(templates[0]?.slug).toBe("resume");
    expect(templates.some((t) => t.slug === "budget-workbook")).toBe(true);
  });

  it("points checklist_template_id at a checklist template when set", () => {
    const bundle = getBundle("i-need-a-job");
    const checklist = getTemplate(bundle!.checklist_template_id!);
    expect(checklist?.structure_type).toBe("checklist");
  });
});

describe("recommendation catalogue normalisation", () => {
  it("resolves loose recommendation names to catalogue templates", () => {
    expect(resolveTemplateByRecommendationName("cover letter")?.slug).toBe(
      "cover-letter",
    );
    expect(resolveTemplateByRecommendationName("Job Recommendations")).toBeUndefined();
  });

  it("keeps job-seeker flows away from resignation and employer documents", () => {
    const recommendation = normaliseRecommendationForCatalog(
      {
        primary: {
          name: "Resignation Letter",
          format: "document",
          reason: "Wrongly suggested leaving-job paperwork.",
          use_case: "Finding a job",
          benefits: [],
        },
        alternatives: [
          {
            name: "Offer Letter",
            format: "document",
            reason: "",
            use_case: "",
            benefits: [],
          },
          {
            name: "Job Recommendations",
            format: "document",
            reason: "",
            use_case: "",
            benefits: [],
          },
        ],
      },
      "I need a job. I was a warehouse supervisor and want work quickly.",
    );

    expect(recommendation.primary.name).toBe("Resume");
    expect(recommendation.alternatives.map((item) => item.name)).toEqual([
      "Cover Letter",
      "Job-search Action Checklist",
    ]);
  });
});

describe("pre-fill", () => {
  it("populates fields from matching profile values", () => {
    const offer = getTemplateByName("Offer Letter")!;
    const filled = applyPreFill(offer, {
      business_name: "Acme Pty Ltd",
      display_name: "Jordan",
    });
    expect(filled.business_name).toBe("Acme Pty Ltd");
    // candidate_name has no profile source — not pre-filled.
    expect(filled.candidate_name).toBeUndefined();
  });

  it("omits fields whose profile source is empty", () => {
    const resume = getTemplate("resume")!;
    const filled = applyPreFill(resume, { display_name: "  " });
    expect(filled.full_name).toBeUndefined();
  });

  it("reports the required fields pre-fill did not satisfy", () => {
    const offer = getTemplate("offer-letter")!;
    const filled = applyPreFill(offer, { business_name: "Acme" });
    const missing = missingRequiredFields(offer, filled);
    const fields = missing.map((m) => m.field);
    expect(fields).toContain("role_title");
    expect(fields).toContain("candidate_name");
    expect(fields).not.toContain("business_name");
  });
});

describe("derived fields", () => {
  it("computes months between dates and formats a duration", () => {
    expect(monthsBetween("2022-01-01", "2024-04-01")).toBe(27);
    expect(formatDuration(27)).toBe("2 years 3 months");
    expect(formatDuration(0)).toBe("less than a month");
    expect(formatDuration(1)).toBe("1 month");
  });

  it("summarises a budget with surplus and savings rate", () => {
    const summary = summariseBudget({
      income_salary: 5000,
      income_other: 500,
      expense_housing: 2000,
      expense_living: 1500,
      savings_monthly: 1000,
      debt_repayment: 500,
    });
    expect(summary.totalIncome).toBe(5500);
    expect(summary.totalOutgoings).toBe(5000);
    expect(summary.surplus).toBe(500);
    expect(summary.savingsRate).toBe(18);
  });
});
