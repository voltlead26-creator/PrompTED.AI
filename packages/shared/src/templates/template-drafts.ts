// =====================================================
// PrompTED — Template-specific starter drafts
// Seed content shown immediately in the Master Workspace before TED's streamed
// draft replaces it. These are intentionally document-shaped, not instructions.
// =====================================================

import phase2TemplatesData from "./phase2-templates.data.json";

const MARKER = "<!-- prompted:template-draft -->";
const FALLBACK_CONTEXT = "the details described in the conversation";

type DraftMap = Record<string, Record<string, string[]>>;

const DRAFTS: DraftMap = {
  resume: {
    contact_details: ["My confirmed name, phone, email, and location appear here as a clear resume header."],
    summary: ["I'm an experienced professional with a strong record in my field, applying for the kind of role described here and ready to contribute from day one."],
    experience: ["My most recent roles come first, each showing the employer, dates, what I was responsible for, and what I achieved."],
    education: ["My qualifications, licences, certificates, and relevant training, set out clearly."],
    skills: ["The skills most relevant to this role, in plain language I can back up in an interview."],
    referees: ["Referees can be listed here once confirmed, or this section can state that referees are available on request."],
  },
  "cover-letter": {
    opening: ["I am writing to apply for the role described in the conversation. I am interested in the opportunity because it matches my experience, strengths, and the direction I want to take next."],
    fit: ["My background gives me practical experience that is relevant to this role. The strongest points to highlight here are the confirmed skills, responsibilities, and achievements that match the employer's needs."],
    motivation: ["I am particularly interested in this employer because the role appears to offer work that aligns with my goals, values, and the kind of contribution I want to make."],
    closing: ["Thank you for considering my application. I would welcome the opportunity to discuss how my experience could support the team and contribute to the role."],
  },
  "job-search-checklist": {
    items: ["Confirm the target role and preferred industries.", "Update the resume so the strongest relevant experience appears first.", "Prepare a tailored cover letter for each serious application.", "Track applications, follow-up dates, contacts, and interview notes in one place."],
  },
  "interview-prep-questions": {
    about_you: ["Prepare clear answers for questions about strengths, work style, motivation, challenges, and why this role is the right next step."],
    role_specific: ["Prepare examples that show the technical skills, judgement, customer service, leadership, or operational experience required for the role."],
    your_questions: ["Ask questions that show genuine interest in the role, team expectations, success measures, training, and next steps in the hiring process."],
  },
  "interview-script": {
    intro: ["Thanks for meeting with me. I am looking for a role where I can use my confirmed experience, keep building my skills, and contribute reliably from the start."],
    stories: ["When the panel asks for an example, I walk through a real situation I handled — what was happening, what I did, and how it turned out."],
    tricky: ["For harder questions I stay calm and answer honestly. If something didn't go to plan, I explain what I learned and how I'd handle it now."],
  },
  "job-follow-up-email": {
    thanks: ["Thank you for taking the time to speak with me about the opportunity. I appreciated learning more about the role and the team."],
    value: ["After our conversation, I remain confident that my experience and approach would allow me to contribute positively to the role."],
    next: ["Please let me know if there is anything further I can provide. I look forward to hearing about the next steps when convenient."],
  },
  "pay-rise-request": {
    case: ["I would like to discuss my pay in light of my responsibilities, contribution, and the value I have been bringing to the role."],
    ask: ["My request is for my pay to be reviewed and adjusted to better reflect my current contribution, responsibilities, and market position."],
    script: ["I would like to talk through my contribution and discuss whether there is room to review my pay. I have prepared examples of the work I have taken on and the value it has created."],
  },
  "promotion-case": {
    impact: ["I've taken on responsibilities and delivered results that already go beyond my current role, with clear examples to back that up."],
    readiness: ["My current skills, reliability, and the scope of work I handle line up closely with what the next role asks for."],
    proposal: ["I'd like to be considered for the next role; the move is well justified and would benefit the team."],
  },
  "selection-criteria-response": {
    heading: ["Demonstrated ability to {context}."],
    claim: ["I meet this criterion through experience I can point to directly, where I've consistently applied the judgement and follow-through this kind of situation calls for."],
    evidence: ["In my current role I was responsible for handling exactly this kind of situation. I assessed what needed to happen, took clear, deliberate action, and worked through it step by step rather than leaving it to chance."],
    relevance: ["The outcome was a result I could point to with confidence, and the people involved noticed the difference. This is directly relevant to the role I'm applying for, because it shows I can be trusted to handle the same kind of situation here."],
  },
  "linkedin-profile-rewrite": {
    headline: ["Experienced professional helping employers and teams get reliable results, with a track record across my field."],
    about: ["I bring hands-on experience across my industry, with a focus on practical results and steady follow-through. I'm known for staying calm under pressure and turning complex priorities into outcomes people can rely on."],
    featured: ["Recent highlights include the projects and responsibilities that best show what I can do, each one strengthening my expertise and delivering real value for the team or business involved."],
    direction: ["I'm currently open to new opportunities where I can put this experience to work and make a genuine contribution from day one."],
  },
  "star-achievement-bank": {
    situation: ["In my role, the team was facing a real challenge that affected how well we could deliver for the people relying on us."],
    task: ["My responsibility was to resolve it, while balancing competing priorities, what the people involved needed, and the time I had to act."],
    action: ["I worked through the problem methodically, took clear and deliberate steps to address it, and kept the people affected informed along the way so nothing came as a surprise."],
    result: ["The result was a measurable, practical improvement. This example shows I can be trusted to handle this kind of situation well."],
  },
  "professional-reference-letter": {
    relationship: ["I'm pleased to recommend this candidate, whom I worked with directly and can speak to with confidence."],
    performance: ["Throughout our time working together, they consistently showed sound judgement, reliability, and the professional behaviour you'd want from someone in this role."],
    evidence: ["A clear example of this was a piece of work where they took the right action and delivered a result the wider team noticed."],
    recommendation: ["I recommend them without hesitation for roles that call for the qualities they've shown, and I believe they would be a strong addition to any team they join."],
  },
  "personal-brand-statement": {
    identity: ["I'm a professional with hands-on experience across my field, and I bring a practical, results-focused approach to the work."],
    value: ["I help the people and teams I work with get real outcomes, by combining solid technical skill with a steady, dependable approach."],
    proof: ["My strongest examples are the achievements I can speak to confidently — each one shows my ability to turn an idea into a practical result."],
    direction: ["I'm now focused on opportunities where I can put this experience to work and keep growing in the direction I care about."],
  },
  "career-change-plan": {
    direction: ["This plan maps a genuine move from my current field into the new direction I'm pursuing."],
    strengths: ["My most relevant strengths carry across directly, because the target role draws on a lot of the same underlying skills and judgement."],
    gaps: ["The main gaps I need to close are skills and experience specific to the new field — closing them means targeted study, hands-on practice, or building a track record in the area."],
    timeline: ["Over the coming months, the priority is steady, concrete progress toward the move, with regular check-ins to see what's working."],
  },
  "resignation-letter": {
    notice: ["Please accept this letter as formal notice of my resignation from my current role, with my final working day to be confirmed in line with my notice period."],
    appreciation: ["I genuinely appreciate the opportunities I've had in this role and the experience it's given me."],
    transition: ["During my notice period, I'll support a smooth handover by documenting my current work, handing over key tasks clearly, and assisting with priorities wherever I can."],
    close: ["Thank you again for the support I've received. I wish the team continued success going forward."],
  },
  "networking-outreach-message": {
    intro: ["Hi, I came across your work and wanted to reach out directly."],
    reason: ["I'm exploring a new direction in my career and would really value your perspective, given your experience in the area."],
    ask: ["Would you be open to a short, no-pressure conversation sometime over the next couple of weeks?"],
    close: ["Totally understand if your schedule doesn't allow it right now — thank you for considering it either way."],
  },
  "recruiter-introduction-email": {
    subject: ["Candidate interested in new opportunities matching your current roles"],
    summary: ["I'm reaching out to introduce myself and the kind of opportunity I'm currently exploring, in case it matches anything you're working on."],
    fit: ["My background includes the experience and skills most relevant to roles in this space, and I'm particularly interested in work where I can put them to direct use."],
    close: ["I've attached my resume for context, and I'd welcome a conversation if my background lines up with anything you're supporting."],
  },
  "business-plan": {
    concept: ["This business provides a clear product or service for a specific target customer, solving a real problem in a way that sets it apart."],
    market: ["The target market has genuine, identifiable demand, and the competitor landscape has been considered honestly."],
    operating_model: ["The business operates through a defined channel and model, using the resources, team, and systems needed to deliver what customers expect."],
    financials: ["Revenue comes from clearly identified streams, the main costs are accounted for, and break-even is tied to a realistic, specific condition."],
    milestones: ["The priority milestones for the coming period are concrete and time-bound."],
  },
  "executive-summary": {
    purpose: ["This summary sets out the topic and the decision being asked of the reader, in plain terms up front."],
    situation: ["The current position is described honestly, with the key issues named rather than glossed over."],
    recommendation: ["The recommended option is stated directly, along with the specific benefit it delivers and the risk or cost it reduces."],
    decision: ["A specific approval is being requested, with a clear point by which implementation needs to begin."],
  },
  "pitch-deck-outline": {
    problem: ["The target customer has a real, specific problem that creates genuine cost, friction, or risk that existing options don't solve well."],
    solution: ["This solves it directly, in a way that lets customers get the benefit they're actually after."],
    market: ["The market opportunity is real and sized honestly, and current traction reflects what's actually been achieved so far."],
    model: ["Revenue comes from a defined model, with pricing logic that holds up and a growth channel already showing signs of working."],
    ask: ["A specific amount or kind of support is being sought, tied to a clear use of funds and the next milestone it unlocks."],
  },
  "scope-of-work": {
    overview: ["This project will deliver a specific outcome for the client or team, by an agreed date."],
    in_scope: ["The included work covers exactly the deliverables agreed, named clearly so there's no ambiguity."],
    out_of_scope: ["Excluded work is stated plainly, along with the principle that anything not confirmed in writing isn't included."],
    acceptance: ["Deliverables will be accepted once the agreed criteria are met and reviewed by the right approver."],
    assumptions: ["This scope assumes a small number of named dependencies hold true, including timely access to the information or resources needed to deliver it."],
  },
  "board-report": {
    overview: ["This report updates the board on the period just finished, including the key achievement, the key risk, and what needs a decision."],
    performance: ["Performance for the period is set out against target or baseline, with the main drivers named honestly."],
    risks: ["Current risks are named directly, along with the mitigations already in place."],
    decisions: ["The board is asked to approve a specific decision and to note specific information, clearly distinguished from each other."],
  },
  "quarterly-business-review": {
    summary: ["This quarter, the team delivered against its key commitments, progressed the initiatives that mattered, and managed the challenges that came up."],
    metrics: ["The key results are set out plainly, with an honest read on where performance was strongest and where it needs work."],
    insights: ["The main lessons from the quarter are named directly, not buried in the numbers."],
    priorities: ["The priorities for next quarter are specific, with an owner assigned to each one."],
  },
  "risk-assessment": {
    context: ["This assessment covers a specific activity, project, or process, carried out by a named team over a defined period."],
    risks: ["The key risks are named clearly, each with its likely impact on people, cost, time, compliance, or quality spelled out."],
    rating: ["Each risk is rated based on a genuine assessment of likelihood and consequence, not a guess."],
    controls: ["The controls already in place are listed honestly, along with the specific actions still needed and who owns them."],
    review: ["This assessment will be reviewed on a set date, or sooner if there's an incident, a change, or new information."],
  },
  "financial-review": {
    summary: ["This review covers financial performance for a defined period, with an honest read on how it tracked against expectations."],
    revenue: ["Revenue is reported clearly against budget or the previous period, with the main contributors named."],
    expenses: ["Expenses are reported clearly, with the major cost areas identified and the reason for any variance explained."],
    cashflow: ["The cash position is described plainly, along with the pressures coming up and the opportunities worth acting on."],
    actions: ["The recommended actions before the next review are specific, not generic."],
  },
  "marketing-brief": {
    objective: ["The objective is specific and time-bound — what this campaign needs to achieve, for what, by when."],
    audience: ["The target audience is described in terms of what they actually care about and what motivates them, not just demographics."],
    message: ["The core message is stated plainly, with proof points that genuinely back it up."],
    deliverables: ["The deliverables and the channels they'll run on are named specifically."],
    success: ["Success is defined by measures that can actually be tracked, not vague impressions."],
  },
  "grant-funding-proposal": {
    summary: ["This application seeks a specific amount of funding to deliver a defined project for a named beneficiary or community."],
    need: ["The project responds to a real need, with the affected audience and the impact on them described honestly."],
    activities: ["The funding will support specific, named activities, delivered within a clear timeframe."],
    outcomes: ["The expected outcomes are concrete and measurable, not aspirational."],
    budget: ["The total budget is stated clearly, the funding use is itemised, and the path to sustainability beyond the grant is realistic."],
  },
  "scholarship-application": {
    profile: ["I'm applying for this scholarship to support my study, and I want to set out clearly why it matters to me and what I bring to it."],
    case: ["This scholarship would directly address a genuine need or recognise genuine merit, and would let me focus more fully on my study and the contribution I want to make."],
    evidence: ["My achievements speak to real commitment and capability, each one showing the qualities this scholarship is looking for."],
    impact: ["With this support, I'll be able to complete my goals and make a genuine contribution to my field or community."],
  },
  "statement-of-purpose": {
    focus: ["My intended area of study reflects a genuine interest I've developed over time, not a passing curiosity."],
    preparation: ["My academic and professional background has built the specific ability this area of study calls for."],
    fit: ["This program is a strong fit because of what it specifically offers — its approach, its strengths, and the opportunities it provides that other programs don't."],
    direction: ["My goal is to use this program to move toward a clear career or research direction, and to make a genuine contribution once I get there."],
  },
  "study-plan": {
    goal: ["The goal is to build real competence in this subject by a specific date, with a clear way to measure success."],
    level: ["Current strengths are named honestly, and so are the priority gaps that need the most attention."],
    schedule: ["Each week includes focused study time, a practice task, a way to review what's been learned, and a checkpoint."],
    accountability: ["Progress gets reviewed on a set schedule, with the plan adjusted based on how it's actually going."],
  },
  "research-proposal": {
    title_question: ["This proposal sets out a working title and a central research question that's specific enough to actually be answered."],
    background: ["This topic matters for a clear reason, and there's a genuine gap in existing work that this research responds to."],
    methodology: ["The study uses a defined method, with a clear data source or participant group and a specific analysis approach."],
    contribution: ["The research is expected to contribute real knowledge or practical value to the people who would use it."],
  },
  "literature-review": {
    scope: ["This review examines the literature on a defined topic, focused on the themes that matter most to the research question."],
    themes: ["The major themes in the literature are set out clearly, with what different scholars actually argue."],
    tension: ["The literature genuinely differs on key points, and those differences are described fairly rather than flattened."],
    gap: ["A clear gap remains in the existing work, and this project addresses that gap directly."],
  },
  "academic-appeal-letter": {
    decision: ["I am writing to formally appeal a specific academic decision, named clearly along with the date it was made and the course it relates to."],
    grounds: ["The basis for this appeal is a specific, stated ground, supported by the evidence behind it."],
    explanation: ["I'm setting out factually what happened, when it happened, and how it affected my work, along with the steps I took at the time to manage it."],
    outcome: ["I'm respectfully requesting a specific outcome, stated plainly so the panel knows exactly what's being asked for."],
  },
  "extension-request-letter": {
    request: ["I'm requesting an extension for this assignment, currently due on a specific date."],
    reason: ["The reason for this request is a genuine circumstance that's affected my ability to complete the work to the standard I'd otherwise meet."],
    proposed_date: ["I'm requesting a specific revised submission date, one that realistically allows me to finish what's left."],
    close: ["I've mentioned any supporting evidence I can provide, and I appreciate the consideration."],
  },
  "student-support-plan": {
    context: ["This plan sets out the support needed, anchored to the student's current course and year level."],
    strengths: ["The student's genuine strengths and existing supports are named, not just the gaps."],
    needs: ["The priority support needs are named clearly, including when they matter most."],
    actions: ["The specific support actions are set out, along with when progress will be reviewed and with whom."],
  },
  "course-comparison-matrix": {
    options: ["The specific options being compared are named clearly, so the comparison is grounded in real choices."],
    criteria: ["The decision criteria reflect what actually matters for this choice — cost, duration, delivery mode, reputation, and career outcomes among them."],
    notes: ["Each option's real strengths and weaknesses are set out honestly, rather than treating them all the same."],
    recommendation: ["Based on the priorities that matter most, one option stands out as the strongest match."],
  },
  "academic-reference-request": {
    request: ["I'm writing to ask whether you'd be willing to provide an academic reference for an opportunity I'm applying for."],
    context: ["I studied with you over a specific period, and the work I did during that time is what I'd want this reference to speak to."],
    application: ["The opportunity is looking for specific qualities, and your perspective on those would genuinely strengthen my application."],
    close: ["I'm happy to provide my resume, transcript, or any other materials you'd find useful, and I really appreciate you considering this."],
  },
  "personal-statement": {
    motivation: ["My interest in this opportunity comes from where I want to take my study and career, and why this course or program matters to me."],
    background: ["My relevant background includes the experiences, study, work, interests, or achievements that have prepared me for this opportunity."],
    goals: ["My goal is to use this opportunity to build capability, move toward my longer-term plans, and make a meaningful contribution in the area I am pursuing."],
  },
  "education-cover-letter": {
    intro: ["I am writing to support my application for the program or education opportunity described in the conversation."],
    suitability: ["I believe I am a suitable applicant because my background, motivation, and confirmed experience align with what this opportunity requires."],
    close: ["Thank you for considering my application. I would appreciate the opportunity to be considered and am happy to provide any further information required."],
  },
  "reference-request": {
    ask: ["I hope you are well. I am applying for the opportunity described in the conversation and wanted to ask whether you would be comfortable acting as a referee for me."],
    details: ["The reference would relate to my experience, character, work ethic, and suitability for the opportunity. I can send through the role or application details to make it easier."],
  },
  "business-email": {
    subject: ["Subject: Follow-up regarding the matter discussed", "Hi [recipient name],"],
    body: ["I am writing about the matter described in the conversation. I wanted to set out the key point clearly and make it easy to confirm the next step."],
    action: ["Could you please review this and let me know the best way to proceed?"],
  },
  "workplace-policy": {
    purpose: ["This policy sets out the purpose, scope, and expectations for the workplace topic described in the conversation."],
    policy: ["The business expects all relevant team members to follow the standards set out in this policy and to act consistently with safe, fair, and professional workplace practice."],
    responsibilities: ["Managers are responsible for explaining and applying the policy. Team members are responsible for understanding it, asking questions when unsure, and following the agreed process."],
    breach: ["A breach of this policy may be addressed through coaching, further training, formal direction, or other appropriate action depending on the circumstances."],
  },
  sop: {
    overview: ["This procedure explains when and how to complete the process described in the conversation so it can be done consistently each time."],
    steps: ["Step 1: Confirm the task and required outcome.", "Step 2: Gather the required information, tools, or approvals.", "Step 3: Complete the task according to the agreed process.", "Step 4: Check the result and record any required follow-up."],
    roles: ["The responsible person should complete the task, the manager should provide oversight where required, and any supporting team members should complete their assigned parts on time."],
  },
  "offer-letter": {
    offer: ["We are pleased to offer you the role described in the conversation, subject to the terms and conditions that will be confirmed in this letter."],
    terms: ["This section will confirm the key employment terms, including role title, start date, hours, location, remuneration, and any other confirmed arrangements."],
    conditions: ["This offer may be subject to any conditions confirmed by the business, such as reference checks, right-to-work confirmation, licences, or other role requirements."],
    acceptance: ["To accept this offer, please confirm your acceptance in writing by the date specified once the final details are added."],
  },
  "terms-of-employment": {
    parties: ["This document summarises the employment arrangement between the employer and employee for the role described in the conversation."],
    pay: ["This section will set out the confirmed pay, hours, ordinary work location, superannuation, and any other agreed employment terms."],
    obligations: ["The employee is expected to perform the role responsibly, follow lawful and reasonable directions, comply with workplace policies, and maintain professional conduct."],
    ending: ["This section will set out how the employment arrangement may end, including notice requirements and any relevant handover expectations."],
  },
  "induction-manual": {
    welcome: ["Welcome to the team. This induction manual is designed to help new starters understand the business, the workplace, and what to expect in the first few weeks."],
    how_we_work: ["This section explains the practical ways the team works, including communication, hours, tools, expectations, and everyday workplace routines."],
    policies: ["New starters should read and understand the key workplace policies that apply to their role, including safety, conduct, leave, confidentiality, and any role-specific requirements."],
    contacts: ["This section lists the key people a new starter can contact for support, questions, training, payroll, rostering, and workplace issues."],
  },
  "onboarding-checklist": {
    items: ["Confirm the new starter's role, start date, manager, and work location.", "Prepare login details, equipment, documents, and first-day instructions.", "Schedule induction, safety briefing, training, and key team introductions.", "Check in during the first week and confirm any follow-up support required."],
  },
  "performance-review": {
    summary: ["This review summarises performance over the relevant period, focusing on confirmed responsibilities, contribution, conduct, and progress against expectations."],
    strengths: ["This section records the employee's key strengths, positive behaviours, and examples of work that has met or exceeded expectations."],
    development: ["This section identifies areas for development in a constructive way, with practical examples and support needed for improvement."],
    goals: ["Goals for the next review period should be clear, practical, measurable where possible, and aligned with the role and business priorities."],
  },
  "profit-and-loss-statement": {
    revenue: ["This section records total revenue for the reporting period, broken down by major revenue stream so it is clear where income came from."],
    cogs_gross_profit: ["This section records the direct costs of delivering the product or service and the resulting gross profit for the period."],
    operating_expenses: ["This section lists operating expense categories such as wages, rent, marketing, and administration, with an amount against each."],
    net_profit: ["This section summarises net profit or loss for the period, calculated as gross profit minus operating expenses, with the reporting period stated."],
  },
  "meeting-minutes": {
    attendees: ["This section records who attended the meeting, who was absent or invited, and the purpose of the discussion."],
    discussion: ["This section summarises the main points discussed, keeping the record factual, neutral, and focused on relevant details."],
    decisions: ["This section records decisions made during the meeting so everyone has the same understanding of what was agreed."],
    actions: ["This section lists action items, owners, deadlines, and any follow-up required after the meeting."],
  },
  "service-agreement": {
    parties: ["This agreement is between the service provider and the client named in the final document. It records the basis on which services will be provided."],
    scope: ["The provider will deliver the services described in the conversation, subject to the final agreed scope, inclusions, exclusions, and deliverables."],
    payment: ["This section will set out the agreed fees, invoicing timing, payment due dates, expenses, and any deposit or milestone payments."],
    terms: ["This section will set out the agreement duration, changes to scope, cancellation or termination process, and any important operating terms."],
  },
  proposal: {
    summary: ["This proposal responds to {context}. It sets out a clear offer, the value of the work, and the reason this approach is worth considering."],
    understanding: ["The need behind this proposal is to address {context} in a practical, achievable way. The proposal should show that the client’s problem, goal, or opportunity has been understood."],
    solution: ["The proposed solution is to deliver the work in a structured way, with clear deliverables, agreed priorities, and a process that makes progress easy to review."],
    pricing: ["Pricing and timing should be confirmed once the final scope, deliverables, revision process, and turnaround are agreed. A staged timeline is recommended so progress can be tracked clearly."],
    next: ["The next step is to confirm the preferred scope, clarify any open details, and agree on timing so the proposal can be finalised for approval."],
  },
  "budget-workbook": {
    income: ["This section records all confirmed sources of income so the budget starts from a clear monthly or weekly baseline."],
    expenses: ["This section records fixed and variable expenses, separating essentials from flexible spending where useful."],
    savings: ["This section sets out savings goals, regular savings amounts, and any planned buffers or emergency funds."],
    debt: ["This section records debts, repayment amounts, interest where known, and the order or strategy for managing repayments."],
  },
};

// Phase 2 templates share the same non-blank workspace guarantee as the
// original catalogue. Generate their temporary, visibly marked starter copy
// from the authored section metadata rather than maintaining a second manual
// 26-template registry that will drift whenever a section is added or renamed.
for (const template of phase2TemplatesData) {
  DRAFTS[template.slug] ??= {};
  for (const section of template.sections) {
    DRAFTS[template.slug]![section.key] ??= [
      `${section.name} for {context}: ${section.description}`,
    ];
  }
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraph(text: string): string {
  return `<p>${htmlEscape(text)}</p>`;
}

export function templateDraftContent(input: {
  templateSlug: string;
  sectionKey: string;
  context?: string;
}): string | null {
  const template = DRAFTS[input.templateSlug];
  const lines = template?.[input.sectionKey];
  if (!lines) return null;

  const context = input.context?.trim() || FALLBACK_CONTEXT;
  const body = lines
    .map((line) => line.replaceAll("{context}", context))
    .map(paragraph)
    .join("");
  return `${MARKER}${body}`;
}

export function hasTemplateDraft(input: {
  templateSlug: string;
  sectionKey: string;
}): boolean {
  return Boolean(DRAFTS[input.templateSlug]?.[input.sectionKey]);
}
