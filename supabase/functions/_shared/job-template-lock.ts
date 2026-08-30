export interface LockedRecommendation {
  primary: Record<string, unknown>;
  alternatives: Record<string, unknown>[];
}

const EXPLICIT_JOB_DOCUMENTS: Array<{
  name: string;
  pattern: RegExp;
  reason: string;
  useCase: string;
}> = [
  {
    name: "Interview Preparation Questions",
    pattern:
      /\b(interview preparation questions|interview prep questions|prepare me for (an|the|my) interview)\b/i,
    reason:
      "The user explicitly asked for tailored interview preparation questions.",
    useCase: "Preparing evidence-backed answers for a specific interview",
  },
  {
    name: "Interview Script",
    pattern: /\b(interview script|mock interview script)\b/i,
    reason: "The user explicitly asked for an interview script.",
    useCase: "Rehearsing a realistic interview conversation",
  },
  {
    name: "Job Follow-up Email",
    pattern:
      /\b(job follow[- ]?up email|interview follow[- ]?up email|thank[- ]?you email after (an|the|my) interview)\b/i,
    reason: "The user explicitly asked for a job follow-up email.",
    useCase: "Following up after an application or interview",
  },
  {
    name: "Selection Criteria Response",
    pattern:
      /\b(selection criteria response|respond to (the )?selection criteria|key selection criteria)\b/i,
    reason: "The user explicitly asked for a selection criteria response.",
    useCase: "Addressing stated selection criteria with verified evidence",
  },
  {
    name: "LinkedIn Profile Rewrite",
    pattern:
      /\b(linkedin profile rewrite|rewrite my linkedin|linkedin rewrite)\b/i,
    reason: "The user explicitly asked for a LinkedIn profile rewrite.",
    useCase: "Improving a job-seeker LinkedIn profile",
  },
  {
    name: "STAR Achievement Bank",
    pattern: /\b(star achievement bank|star examples bank|star stories)\b/i,
    reason: "The user explicitly asked for a STAR achievement bank.",
    useCase: "Preparing reusable evidence for applications and interviews",
  },
  {
    name: "Recruiter Introduction Email",
    pattern:
      /\b(recruiter introduction email|email (a|the) recruiter|introduce me to (a|the) recruiter)\b/i,
    reason: "The user explicitly asked for a recruiter introduction email.",
    useCase: "Making a targeted first approach to a recruiter",
  },
  {
    name: "Job-search Action Checklist",
    pattern: /\b(job[- ]search action checklist|job[- ]search checklist)\b/i,
    reason: "The user explicitly asked for a job-search action checklist.",
    useCase: "Planning and tracking a job search",
  },
  {
    name: "Cover Letter",
    pattern: /\b(cover letter|letter of application)\b/i,
    reason: "The user explicitly asked for a cover letter.",
    useCase: "Applying for a specific role",
  },
  {
    name: "Resume",
    pattern: /\b(resume|curriculum vitae|\bcv\b)\b/i,
    reason: "The user explicitly asked for a resume.",
    useCase: "Applying for work",
  },
];

function item(
  name: string,
  reason: string,
  useCase: string,
): Record<string, unknown> {
  return {
    name,
    format: name.includes("Checklist") ? "checklist" : "document",
    reason,
    use_case: useCase,
    benefits: [
      "Honours the user's explicit document request",
      "Uses only confirmed candidate evidence",
    ],
  };
}

/** Lock an explicit job-document request before accepting a model recommendation. */
export function lockExplicitJobDocument(
  situation: string,
): LockedRecommendation | null {
  const requested = EXPLICIT_JOB_DOCUMENTS.find((candidate) =>
    candidate.pattern.test(situation)
  );
  if (!requested) return null;

  const alternatives = EXPLICIT_JOB_DOCUMENTS
    .filter((candidate) => candidate.name !== requested.name)
    .slice(0, 2)
    .map((candidate) =>
      item(
        candidate.name,
        `Useful after the requested ${requested.name}.`,
        candidate.useCase,
      )
    );

  return {
    primary: item(requested.name, requested.reason, requested.useCase),
    alternatives,
  };
}
