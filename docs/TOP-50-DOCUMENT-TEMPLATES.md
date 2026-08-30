# Top 50 Document Templates for PrompTED

This catalogue originally defined 50 high-value document types across business, education, and job hunting. The implemented catalogue has since grown to **52** -- two templates (Offer Letter, Terms of Employment, both below as #51-52) were added beyond the original spec, and Financial Review / Budget Workbook were split out of Business into a new **Finance** domain. The filename and original "Top 50" framing are kept for continuity with existing references; the numbers below are the real, current count, verified directly against `packages/shared/src/templates/templates.data.json`.

Each entry includes a practical document structure and starter draft text for every section. The draft copy is intentionally specific enough to avoid blank output or generic instructional scaffolds, while still using placeholders that the document intelligence profile can fill from user context.

Implementation rule: every template should pre-assign sections before generation starts. If user context is thin, the engine should still return these section structures with editable mock draft text, not "no matching sections" and not empty cards.

## Coverage Summary (verified against templates.data.json)

- Business: 20 templates
- Education: 13 templates
- Job hunting and career (Employment): 17 templates
- Finance: 2 templates
- Total: 52 templates

Five of the original 50 names were lightly updated during implementation (cosmetic only, same template): "Business Proposal" -> "Proposal", "Meeting Minutes" -> "Meeting Minutes / Briefing", "Pay-rise Request" -> "Pay-rise Request & Conversation Script", "Resume / CV" -> "Resume", "Application Letter - Education" -> "Application Letter — Education".

## Final-wording Convention

Every section's starter draft must read as finished, first-person prose the user could send as-is — never a bracketed fill-in-the-blank and never meta copy describing what the section will contain. When a concrete fact is genuinely unknown (an employer's name, a specific date, a result), write around it with a natural, generic-but-true phrase rather than a placeholder: prefer "in my current role" over "[Company]", "in the role I'm applying for" over "[Role]", "delivered a measurable improvement" over "[Result]". As soon as the user provides the missing fact, TED replaces the generic phrase with their specific detail — the draft never visibly changes shape, it just gets sharper. Do not render meta copy such as "this section will explain" inside final user-facing drafts.

---

## 01. Resume / CV

Domain: Job Hunting and Career
Best for: Applying for jobs, graduate roles, internships, internal promotions, and professional opportunities.
Template type: Structured career profile

Sections:

- Header and contact: `[Full Name] | [City, Country] | [Phone] | [Email] | [LinkedIn/Portfolio]`
- Professional summary: `[Full Name] is a [role or field] with experience in [primary skill areas]. They bring strengths in [strength 1], [strength 2], and [strength 3], with a track record of delivering [outcome] in [industry or environment].`
- Core skills: `Key strengths include [skill 1], [skill 2], [skill 3], [tool or system], stakeholder communication, problem solving, and delivery against deadlines.`
- Professional experience: `[Role], [Company] | [Dates]. Delivered [responsibility or project], improved [metric/process], collaborated with [team/stakeholders], and contributed to [business/customer outcome].`
- Education and credentials: `[Qualification], [Institution] | [Year]. Relevant study, certifications, or training include [course/certification] and [specialisation].`

## 02. Cover Letter

Domain: Job Hunting and Career
Best for: Introducing an application with a focused argument for fit.
Template type: Persuasive letter

Sections:

- Opening: `Dear [Hiring Manager], I am applying for the [Role] position at [Company]. The role strongly aligns with my experience in [field], my strengths in [skill area], and my interest in contributing to [company goal or mission].`
- Why this role: `[Company] appeals to me because of [specific reason]. I am particularly interested in the opportunity to [role responsibility], where I can apply my background in [experience area].`
- Evidence of fit: `In my previous role at [Company/Organisation], I [achievement]. This required [skill], [skill], and [behaviour], and resulted in [measurable or practical outcome].`
- Closing: `I would welcome the opportunity to discuss how my experience can support [Company]'s priorities. Thank you for considering my application.`

## 03. LinkedIn Profile Rewrite

Domain: Job Hunting and Career
Best for: Updating online professional positioning for recruiters, clients, and hiring managers.
Template type: Profile optimisation

Sections:

- Headline: `Experienced professional helping employers and teams get reliable results, with a track record across my field.`
- About summary: `I bring hands-on experience across my industry, with a focus on practical results and steady follow-through. I'm known for staying calm under pressure and turning complex priorities into outcomes people can rely on.`
- Featured experience: `Recent highlights include the projects and responsibilities that best show what I can do, each one strengthening my expertise and delivering real value for the team or business involved.`
- Availability or direction: `I'm currently open to new opportunities where I can put this experience to work and make a genuine contribution from day one.`

## 04. Job-search Action Checklist

Domain: Job Hunting and Career
Best for: Organising a search across roles, applications, networking, and follow-up.
Template type: Checklist and tracker

Sections:

- Target roles: `Primary targets are [role 1], [role 2], and [role 3], with preferred industries including [industry list]. Priority employers include [company list].`
- Application assets: `Prepare a master resume, tailored resume versions, cover letter templates, LinkedIn updates, portfolio samples, reference list, and a short introduction message.`
- Weekly activity plan: `Each week, apply for [number] high-fit roles, contact [number] people, follow up on pending applications, and review job alerts for new matches.`
- Tracking fields: `Track company, role title, source, closing date, application status, contact person, follow-up date, interview date, and outcome.`

## 05. Interview Preparation Questions

Domain: Job Hunting and Career
Best for: Preparing answers before screening, panel, behavioural, or technical interviews.
Template type: Q&A workbook

Sections:

- Role understanding: `This role appears to require [responsibility], [responsibility], and [responsibility]. My strongest evidence for these requirements is [example].`
- Behavioural questions: `Question: Tell us about a time you solved a difficult problem. Draft answer: In [situation], I was responsible for [task]. I took [action], managed [challenge], and achieved [result].`
- Company questions: `I want to ask about [team priority], [success measure], and [first 90 days]. These questions show interest in outcomes, expectations, and team context.`
- Closing statement: `Thank you for the conversation. I am excited by this role because it combines [interest] with [strength], and I can see clear ways to contribute to [company/team].`

## 06. Interview Script

Domain: Job Hunting and Career
Best for: Practising a spoken interview flow.
Template type: Conversation script

Sections:

- Introduction: `Thank you for meeting with me. I am a [profession] with experience in [field], and I am especially interested in this role because it connects my strengths in [skill] with [company need].`
- Career story: `My background started in [starting point], then developed through [role/project]. The common thread has been [theme], which is why this opportunity feels like a strong next step.`
- Achievement example: `One example I would highlight is [project]. The challenge was [challenge], my role was [role], and the outcome was [result].`
- Final close: `I appreciate the opportunity to speak today. Based on what we discussed, I am confident I could contribute to [priority] and build momentum quickly in the role.`

## 07. STAR Achievement Bank

Domain: Job Hunting and Career
Best for: Building reusable behavioural interview examples and resume evidence.
Template type: Evidence library

Sections:

- Situation: `In my role, the team was facing a real challenge that affected how well we could deliver for the people relying on us.`
- Task: `My responsibility was to resolve it, while balancing competing priorities, what the people involved needed, and the time I had to act.`
- Action: `I worked through the problem methodically, took clear and deliberate steps to address it, and kept the people affected informed along the way so nothing came as a surprise.`
- Result: `The result was a measurable, practical improvement. This example shows I can be trusted to handle this kind of situation well.`

## 08. Selection Criteria Response

Domain: Job Hunting and Career
Best for: Government, education, health, and structured application criteria.
Template type: Criteria response

Sections:

- Criterion heading: `Demonstrated ability to manage competing priorities under time pressure.`
- Summary claim: `I meet this criterion through my day-to-day experience balancing multiple deadlines and stakeholders, where I consistently use clear prioritisation and early communication to keep everything on track.`
- Evidence example: `For example, in my current role I was responsible for several overlapping deadlines at once. I assessed each task's urgency and impact, agreed a revised order with my manager, and kept affected stakeholders briefed so nothing was a surprise.`
- Outcome and relevance: `Every deadline was met without sacrificing quality, and the stakeholders involved told me they appreciated being kept informed throughout. This is directly relevant to this role because the same pressure to juggle priorities under time constraints is part of the position, and I've already shown I can handle it calmly and reliably.`

## 09. Job Follow-up Email

Domain: Job Hunting and Career
Best for: Following up after application submission, interviews, or networking discussions.
Template type: Email

Sections:

- Subject: `Follow-up regarding [Role] application`
- Opening: `Hi [Name], I hope you are well. I am following up on my application for the [Role] position submitted on [Date].`
- Value reminder: `I remain very interested in the opportunity because my background in [experience] aligns with [role requirement]. I would welcome the chance to contribute to [team/company priority].`
- Close: `Please let me know if there is any further information I can provide. Thank you again for your time and consideration.`

## 10. Reference Request

Domain: Job Hunting and Career
Best for: Asking a manager, colleague, teacher, or client to act as a reference.
Template type: Email/request note

Sections:

- Opening request: `Hi [Name], I hope you are well. I am applying for [role/program/opportunity] and wanted to ask whether you would feel comfortable acting as a reference for me.`
- Context: `The opportunity focuses on [skills/responsibilities], and I thought of you because we worked together on [project/role], where you saw my work in [area].`
- Support materials: `I can send my resume, the role description, and a short summary of points that may be useful if you are contacted.`
- Close: `I completely understand if your schedule does not allow it. Thank you for considering this.`

## 11. Professional Reference Letter

Domain: Job Hunting and Career
Best for: Providing a written recommendation for employment or professional credibility.
Template type: Formal endorsement

Sections:

- Relationship: `I'm pleased to recommend this candidate, whom I worked with directly and can speak to with confidence.`
- Performance: `Throughout our time working together, they consistently showed sound judgement, reliability, and the professional behaviour you'd want from someone in this role.`
- Evidence: `A clear example of this was a piece of work where they took the right action and delivered a result the wider team noticed.`
- Recommendation: `I recommend them without hesitation for roles that call for the qualities they've shown, and I believe they would be a strong addition to any team they join.`

## 12. Personal Brand Statement

Domain: Job Hunting and Career
Best for: Clarifying professional positioning for resumes, bios, profiles, and introductions.
Template type: Positioning statement

Sections:

- Identity: `I'm a professional with hands-on experience across my field, and I bring a practical, results-focused approach to the work.`
- Value proposition: `I help the people and teams I work with get real outcomes, by combining solid technical skill with a steady, dependable approach.`
- Proof: `My strongest examples are the achievements I can speak to confidently — each one shows my ability to turn an idea into a practical result.`
- Direction: `I'm now focused on opportunities where I can put this experience to work and keep growing in the direction I care about.`

## 13. Career Change Plan

Domain: Job Hunting and Career
Best for: Mapping a transition into a new role, industry, or level.
Template type: Strategy plan

Sections:

- Target direction: `This plan maps a genuine move from my current field into the new direction I'm pursuing.`
- Transferable strengths: `My most relevant strengths carry across directly, because the target role draws on a lot of the same underlying skills and judgement.`
- Gap plan: `The main gaps I need to close are skills and experience specific to the new field — closing them means targeted study, hands-on practice, or building a track record in the area.`
- Timeline: `Over the coming months, the priority is steady, concrete progress toward the move, with regular check-ins to see what's working.`

## 14. Pay-rise Request

Domain: Job Hunting and Career
Best for: Preparing a salary review request and manager conversation.
Template type: Persuasive business case

Sections:

- Opening: `I would like to discuss my compensation in light of my current responsibilities, contribution, and market alignment for [Role].`
- Contribution summary: `Since [date/period], I have contributed to [achievement], [achievement], and [achievement], with impact across [team/customer/business area].`
- Evidence and benchmark: `My role now includes [expanded responsibility]. Based on [market/internal benchmark], a salary adjustment to [amount/range] would better reflect the scope and value of the role.`
- Conversation close: `I would appreciate the opportunity to review this together and agree on a fair next step.`

## 15. Promotion Case

Domain: Job Hunting and Career
Best for: Requesting or documenting readiness for a higher role.
Template type: Advancement case

Sections:

- Promotion request: `I am seeking consideration for promotion from [Current Role] to [Target Role], based on sustained performance and expanded contribution.`
- Current impact: `My recent work has delivered [result], improved [process/outcome], and supported [team/customer].`
- Readiness evidence: `I am already operating at the next level through [responsibility], [leadership example], and [strategic contribution].`
- Proposed next scope: `In the promoted role, I would take ownership of [responsibility], strengthen [area], and support [business/team goal].`

## 16. Resignation Letter

Domain: Job Hunting and Career
Best for: Resigning formally while preserving professional relationships.
Template type: Formal letter

Sections:

- Notice statement: `Please accept this letter as formal notice of my resignation from my current role, with my final working day to be confirmed in line with my notice period.`
- Appreciation: `I genuinely appreciate the opportunities I've had in this role and the experience it's given me.`
- Transition support: `During my notice period, I'll support a smooth handover by documenting my current work, handing over key tasks clearly, and assisting with priorities wherever I can.`
- Close: `Thank you again for the support I've received. I wish the team continued success going forward.`

## 17. Networking Outreach Message

Domain: Job Hunting and Career
Best for: Contacting professionals for advice, referrals, or market insight.
Template type: Short outreach message

Sections:

- Introduction: `Hi, I came across your work and wanted to reach out directly.`
- Reason for contact: `I'm exploring a new direction in my career and would really value your perspective, given your experience in the area.`
- Specific ask: `Would you be open to a short, no-pressure conversation sometime over the next couple of weeks?`
- Close: `Totally understand if your schedule doesn't allow it right now — thank you for considering it either way.`

## 18. Recruiter Introduction Email

Domain: Job Hunting and Career
Best for: Introducing yourself to recruiters with a clear target profile.
Template type: Email

Sections:

- Subject: `Candidate interested in new opportunities matching your current roles`
- Profile summary: `I'm reaching out to introduce myself and the kind of opportunity I'm currently exploring, in case it matches anything you're working on.`
- Fit details: `My background includes the experience and skills most relevant to roles in this space, and I'm particularly interested in work where I can put them to direct use.`
- Attachments and close: `I've attached my resume for context, and I'd welcome a conversation if my background lines up with anything you're supporting.`

## 19. Personal Statement

Domain: Education
Best for: University, college, scholarship, or program applications.
Template type: Narrative application statement

Sections:

- Opening motivation: `My interest in [field/program] has developed through [experience], where I became aware of [problem, opportunity, or intellectual interest].`
- Academic preparation: `My studies in [subjects] have prepared me through [skills], [knowledge], and [project/work].`
- Personal qualities: `I bring [quality], [quality], and [quality], shown through [activity/example]. These qualities would help me contribute to [program/community].`
- Future goals: `After completing [Program], I aim to [goal], with a longer-term interest in [impact area].`

## 20. Application Letter - Education

Domain: Education
Best for: Applying to schools, universities, courses, exchanges, or training programs.
Template type: Formal application letter

Sections:

- Opening: `Dear [Admissions Team/Name], I am writing to apply for [Program/Course] at [Institution] for [intake/year].`
- Reason for choosing program: `[Institution] appeals to me because of [feature], [course strength], and [opportunity].`
- Applicant fit: `My background in [study/work/activity] has developed my interest in [field] and prepared me for the demands of [Program].`
- Closing: `Thank you for considering my application. I would be grateful for the opportunity to join [Institution] and contribute to [community/program].`

## 21. Scholarship Application

Domain: Education
Best for: Merit, equity, leadership, research, travel, or community scholarships.
Template type: Funding application

Sections:

- Applicant profile: `I'm applying for this scholarship to support my study, and I want to set out clearly why it matters to me and what I bring to it.`
- Need or merit case: `This scholarship would directly address a genuine need or recognise genuine merit, and would let me focus more fully on my study and the contribution I want to make.`
- Achievement evidence: `My achievements speak to real commitment and capability, each one showing the qualities this scholarship is looking for.`
- Impact: `With this support, I'll be able to complete my goals and make a genuine contribution to my field or community.`

## 22. Statement of Purpose

Domain: Education
Best for: Graduate, postgraduate, research, and international program applications.
Template type: Academic purpose statement

Sections:

- Academic focus: `My intended area of study reflects a genuine interest I've developed over time, not a passing curiosity.`
- Preparation: `My academic and professional background has built the specific ability this area of study calls for.`
- Program fit: `This program is a strong fit because of what it specifically offers — its approach, its strengths, and the opportunities it provides that other programs don't.`
- Future direction: `My goal is to use this program to move toward a clear career or research direction, and to make a genuine contribution once I get there.`

## 23. Study Plan

Domain: Education
Best for: Planning coursework, exam preparation, language study, or self-directed learning.
Template type: Learning plan

Sections:

- Learning goal: `The goal is to build real competence in this subject by a specific date, with a clear way to measure success.`
- Current level: `Current strengths are named honestly, and so are the priority gaps that need the most attention.`
- Weekly schedule: `Each week includes focused study time, a practice task, a way to review what's been learned, and a checkpoint.`
- Accountability: `Progress gets reviewed on a set schedule, with the plan adjusted based on how it's actually going.`

## 24. Research Proposal

Domain: Education
Best for: Honours, masters, PhD, grant, or coursework research planning.
Template type: Research plan

Sections:

- Research title and question: `This proposal sets out a working title and a central research question that's specific enough to actually be answered.`
- Background and rationale: `This topic matters for a clear reason, and there's a genuine gap in existing work that this research responds to.`
- Methodology: `The study uses a defined method, with a clear data source or participant group and a specific analysis approach.`
- Expected contribution: `The research is expected to contribute real knowledge or practical value to the people who would use it.`

## 25. Literature Review

Domain: Education
Best for: Summarising academic sources and establishing a research gap.
Template type: Academic review

Sections:

- Review scope: `This review examines the literature on a defined topic, focused on the themes that matter most to the research question.`
- Key themes: `The major themes in the literature are set out clearly, with what different scholars actually argue.`
- Debate or tension: `The literature genuinely differs on key points, and those differences are described fairly rather than flattened.`
- Gap and direction: `A clear gap remains in the existing work, and this project addresses that gap directly.`

## 26. Academic Appeal Letter

Domain: Education
Best for: Appealing grades, exclusions, late penalties, attendance decisions, or administrative outcomes.
Template type: Formal appeal

Sections:

- Decision being appealed: `I am writing to formally appeal a specific academic decision, named clearly along with the date it was made and the course it relates to.`
- Grounds for appeal: `The basis for this appeal is a specific, stated ground, supported by the evidence behind it — not a general sense that the outcome was unfair.`
- Explanation: `I'm setting out factually what happened, when it happened, and how it affected my work, along with the steps I took at the time to manage it.`
- Requested outcome: `I'm respectfully requesting a specific outcome, stated plainly so the panel knows exactly what's being asked for.`

## 27. Extension Request Letter

Domain: Education
Best for: Requesting extra time for an assignment or assessment.
Template type: Formal request

Sections:

- Opening request: `I'm requesting an extension for this assignment, currently due on a specific date.`
- Reason: `The reason for this request is a genuine circumstance that's affected my ability to complete the work to the standard I'd otherwise meet.`
- Proposed date: `I'm requesting a specific revised submission date, one that realistically allows me to finish what's left.`
- Close: `I've mentioned any supporting evidence I can provide, and I appreciate the consideration.`

## 28. Student Support Plan

Domain: Education
Best for: Planning academic, wellbeing, accessibility, or attendance support.
Template type: Support plan

Sections:

- Student context: `This plan sets out the support needed, anchored to the student's current course and year level.`
- Strengths: `The student's genuine strengths and existing supports are named, not just the gaps.`
- Support needs: `The priority support needs are named clearly, including when they matter most.`
- Actions and review: `The specific support actions are set out, along with when progress will be reviewed and with whom.`

## 29. Course Comparison Matrix

Domain: Education
Best for: Comparing programs before choosing a course, university, or training provider.
Template type: Decision matrix

Sections:

- Options: `The specific options being compared are named clearly, so the comparison is grounded in real choices.`
- Criteria: `The decision criteria reflect what actually matters for this choice — cost, duration, delivery mode, reputation, and career outcomes among them.`
- Comparison notes: `Each option's real strengths and weaknesses are set out honestly, rather than treating them all the same.`
- Recommendation: `Based on the priorities that matter most, one option stands out as the strongest match.`

## 30. Academic Reference Request

Domain: Education
Best for: Asking a teacher, lecturer, supervisor, or tutor for an academic reference.
Template type: Email/request note

Sections:

- Opening request: `I'm writing to ask whether you'd be willing to provide an academic reference for an opportunity I'm applying for.`
- Relationship context: `I studied with you over a specific period, and the work I did during that time is what I'd want this reference to speak to.`
- Application context: `The opportunity is looking for specific qualities, and your perspective on those would genuinely strengthen my application.`
- Close: `I'm happy to provide my resume, transcript, or any other materials you'd find useful, and I really appreciate you considering this.`

## 31. Business Proposal

Domain: Business
Best for: Presenting a paid service, project, partnership, or solution to a client.
Template type: Persuasive proposal

Sections:

- Executive summary: `[Company] proposes to support [Client] with [solution] to address [problem/opportunity]. The recommended approach focuses on [priority], [priority], and [priority].`
- Client challenge: `[Client] is currently facing [challenge], which affects [cost, time, quality, growth, risk, or customer experience].`
- Proposed solution: `The solution includes [deliverable 1], [deliverable 2], and [deliverable 3], delivered through [method/process].`
- Timeline and investment: `The project can begin on [date] and run for [timeframe]. Estimated investment is [amount/range], subject to final scope confirmation.`
- Next steps: `To proceed, confirm the preferred scope, approve the proposal, and schedule a kickoff meeting with [stakeholders].`

## 32. Business Plan

Domain: Business
Best for: Planning a new venture, internal business case, or growth initiative.
Template type: Strategic plan

Sections:

- Business concept: `The business provides a clear product or service for a specific target customer, solving a real problem in a way competitors don't.`
- Market opportunity: `The target market has genuine, identifiable demand, and the competitor landscape has been considered honestly.`
- Operating model: `The business will operate through a defined channel and model, using the resources, team, and systems needed to deliver the outcome customers expect.`
- Financial outlook: `Revenue comes from clearly identified streams, the main costs are accounted for, and break-even is tied to a specific, realistic condition rather than a hope.`
- Milestones: `The priority milestones for the coming period are concrete and time-bound, not vague intentions.`

## 33. Executive Summary

Domain: Business
Best for: Summarising a longer report, proposal, plan, or decision paper.
Template type: Concise leadership summary

Sections:

- Purpose: `This summary sets out the topic and the decision being asked of the reader, in plain terms up front.`
- Current situation: `The current position is described honestly, with the key issues named rather than glossed over.`
- Recommendation: `The recommended option is stated directly, along with the specific benefit it delivers and the risk or cost it reduces.`
- Decision required: `A specific approval is being requested, with a clear point by which implementation needs to begin.`

## 34. Pitch Deck Outline

Domain: Business
Best for: Investor, partner, internal funding, or product pitch preparation.
Template type: Slide outline

Sections:

- Problem: `The target customer has a real, specific problem that creates a genuine cost, friction, or risk that existing options don't solve well.`
- Solution: `This solves it directly, in a way that lets customers get the benefit they're actually after.`
- Market and traction: `The market opportunity is real and sized honestly, and current traction is described with what's actually been achieved so far.`
- Business model: `Revenue comes from a defined model, with pricing logic that holds up and a growth channel that's already showing signs of working.`
- Ask: `A specific amount or kind of support is being sought, tied to a clear use of funds and the next milestone it unlocks.`

## 35. Service Agreement

Domain: Business
Best for: Defining commercial service terms between provider and client.
Template type: Contract-style agreement

Sections:

- Parties and purpose: `This agreement is between [Provider] and [Client] for the provision of [services] commencing on [date].`
- Scope of services: `[Provider] will deliver [service 1], [service 2], and [service 3] as described in the agreed scope.`
- Fees and payment: `[Client] will pay [amount/rate] according to [payment schedule]. Invoices are payable within [number] days.`
- Responsibilities: `[Provider] is responsible for [provider obligations]. [Client] is responsible for [client obligations].`
- Termination: `Either party may terminate this agreement with [notice period] written notice, subject to payment for work completed.`

## 36. Scope of Work

Domain: Business
Best for: Translating an approved project into clear deliverables, boundaries, and responsibilities.
Template type: Project scope document

Sections:

- Project overview: `This project will deliver a specific outcome for the client or team, by an agreed date.`
- In-scope work: `The included work covers exactly the deliverables agreed, named clearly so there's no ambiguity.`
- Out-of-scope work: `Excluded work is stated plainly, along with the principle that anything not confirmed in writing isn't included.`
- Deliverables and acceptance: `Deliverables will be accepted once the agreed criteria are met and reviewed by the right approver.`
- Assumptions: `This scope assumes a small number of named dependencies hold true, including timely access to the information or resources needed to deliver it.`

## 37. Standard Operating Procedure

Domain: Business
Best for: Documenting repeatable work processes.
Template type: Procedure

Sections:

- Purpose: `This procedure explains how to complete [process] consistently, safely, and accurately.`
- Scope: `The procedure applies to [team/role/process area] and covers [included activities].`
- Steps: `Step 1: [action]. Step 2: [action]. Step 3: [action]. Step 4: [review/record/submit].`
- Roles and responsibilities: `[Role] is responsible for [task]. [Role] reviews [output]. [Role] approves [decision].`
- Records and review: `Records must be saved in [location/system]. This procedure should be reviewed every [interval] or after a process change.`

## 38. Workplace Policy

Domain: Business
Best for: Setting workplace expectations, rules, and compliance requirements.
Template type: Policy

Sections:

- Policy statement: `[Company] is committed to [principle/outcome] and expects all employees to follow this policy when [situation].`
- Scope: `This policy applies to [employees/contractors/visitors] across [locations/systems/activities].`
- Requirements: `Employees must [requirement], [requirement], and [requirement]. Managers must [manager responsibility].`
- Breaches: `Breaches may result in [consequence/process], depending on severity and relevant employment obligations.`
- Review: `This policy will be reviewed by [owner] every [interval] or when legislation, risk, or operations change.`

## 39. Business Email

Domain: Business
Best for: Clear professional communication with clients, suppliers, staff, or stakeholders.
Template type: Email

Sections:

- Subject: `[Action/topic] - [specific reference]`
- Opening: `Hi [Name], I am writing about [topic] following [context].`
- Main message: `The key point is [message]. We need to [action/decision] by [date] so that [reason/outcome].`
- Details: `Relevant details are [detail], [detail], and [detail].`
- Close: `Please confirm [requested response/action] by [date]. Thank you.`

## 40. Meeting Minutes

Domain: Business
Best for: Recording decisions, actions, and discussion outcomes.
Template type: Record of meeting

Sections:

- Meeting details: `Meeting: [Name]. Date: [Date]. Attendees: [Names]. Chair: [Name]. Minute taker: [Name].`
- Agenda summary: `The meeting covered [topic], [topic], and [topic].`
- Decisions: `Decision 1: [decision]. Decision 2: [decision]. These decisions were made to support [goal/project].`
- Action items: `[Owner] will [action] by [date]. [Owner] will [action] by [date].`
- Next meeting: `The next meeting is scheduled for [date/time], with priority items including [items].`

## 41. Board Report

Domain: Business
Best for: Reporting performance, risk, decisions, and strategic matters to a board.
Template type: Governance report

Sections:

- Executive overview: `This report updates the board on the period just finished, including the key achievement, the key risk, and what needs a decision.`
- Performance: `Performance for the period is set out against target or baseline, with the main drivers named honestly.`
- Risks and issues: `Current risks are named directly, along with the mitigations already in place.`
- Decisions required: `The board is asked to approve a specific decision and to note specific information, clearly distinguished from each other.`

## 42. Quarterly Business Review

Domain: Business
Best for: Reviewing quarterly performance with leadership, clients, or teams.
Template type: Performance review report

Sections:

- Quarter summary: `This quarter, the team delivered against its key commitments, progressed the initiatives that mattered, and managed the challenges that came up.`
- Metrics: `The key results are set out plainly, with an honest read on where performance was strongest and where it needs work.`
- Insights: `The main lessons from the quarter are named directly, not buried in the numbers.`
- Next quarter priorities: `The priorities for next quarter are specific, with an owner assigned to each one.`

## 43. Performance Review

Domain: Business
Best for: Employee self-review, manager review, or formal appraisal.
Template type: Review document

Sections:

- Role summary: `[Employee] worked as [Role] during [period], with responsibilities including [responsibility], [responsibility], and [responsibility].`
- Achievements: `Key achievements include [achievement], [achievement], and [achievement], with impact on [team/customer/business outcome].`
- Strengths: `Strengths demonstrated during the period include [strength], [strength], and [strength].`
- Development areas: `Priority development areas are [area] and [area], supported by [training/coaching/stretch task].`
- Goals: `Goals for the next period are [goal], [goal], and [goal], measured by [metric/result].`

## 44. Onboarding Checklist

Domain: Business
Best for: Bringing new employees, contractors, or volunteers into an organisation.
Template type: Checklist

Sections:

- Pre-start: `Before [start date], complete contract paperwork, payroll setup, equipment allocation, system access, and welcome communication.`
- First day: `On day one, welcome [Employee], introduce the team, review role expectations, confirm schedule, and complete essential compliance tasks.`
- First week: `During week one, provide process training, assign a buddy, introduce key stakeholders, and confirm early work priorities.`
- First 30 days: `By day 30, review progress, answer questions, identify support needs, and confirm goals for the next phase.`

## 45. Induction Manual

Domain: Business
Best for: Explaining organisational basics to new starters.
Template type: Internal manual

Sections:

- Welcome: `Welcome to [Company]. We are pleased to have you joining the team as [Role] and look forward to supporting your success.`
- About the organisation: `[Company] provides [products/services] to [customers/community], guided by [values/principles].`
- How work gets done: `Core systems include [system], [system], and [system]. Standard communication channels are [channels].`
- Expectations: `Employees are expected to follow [policies], communicate early about issues, and contribute to a respectful and effective workplace.`
- Support contacts: `For support, contact [manager], [HR/contact], [IT/contact], or [buddy].`

## 46. Risk Assessment

Domain: Business
Best for: Identifying, assessing, and controlling operational, project, safety, or compliance risks.
Template type: Risk register and assessment

Sections:

- Activity or context: `This assessment covers a specific activity, project, or process, carried out by a named team over a defined period.`
- Identified risks: `The key risks are named clearly, each with its likely impact on people, cost, time, compliance, or quality spelled out.`
- Risk rating: `Each risk is rated based on a genuine assessment of likelihood and consequence, not a guess.`
- Controls: `The controls already in place are listed honestly, along with the specific actions still needed and who owns them.`
- Review: `This assessment will be reviewed on a set date, or sooner if there's an incident, a change, or new information.`

## 47. Financial Review

Domain: Business
Best for: Reviewing income, expenses, variance, cash flow, and financial performance.
Template type: Finance report

Sections:

- Period summary: `This review covers financial performance for a defined period, with an honest read on how it tracked against expectations.`
- Revenue: `Revenue is reported clearly against budget or the previous period, with the main contributors named.`
- Expenses: `Expenses are reported clearly, with the major cost areas identified and the reason for any variance explained.`
- Cash flow and outlook: `The cash position is described plainly, along with the pressures coming up and the opportunities worth acting on.`
- Actions: `The recommended actions before the next review are specific, not generic.`

## 48. Budget Workbook

Domain: Business
Best for: Planning income, costs, assumptions, and scenarios.
Template type: Workbook structure

Sections:

- Budget purpose: `This budget supports [project/team/business] for [period], with planning based on [assumptions].`
- Income assumptions: `Income assumptions include [revenue stream], [volume], [price], and [timing].`
- Cost assumptions: `Cost categories include staffing, suppliers, software, marketing, travel, overheads, and contingency.`
- Scenario notes: `Base case assumes [assumption]. Conservative case assumes [risk]. Growth case assumes [opportunity].`
- Review process: `Budget performance will be reviewed [monthly/quarterly] against actuals, with variances explained and actions assigned.`

## 49. Marketing Brief

Domain: Business
Best for: Briefing a campaign, creative asset, launch, or marketing initiative.
Template type: Creative and campaign brief

Sections:

- Objective: `The objective is specific and time-bound — what this campaign needs to achieve, for what, by when.`
- Audience: `The target audience is described in terms of what they actually care about and what motivates them, not just demographics.`
- Message: `The core message is stated plainly, with proof points that genuinely back it up.`
- Channels and deliverables: `The deliverables and the channels they'll run on are named specifically.`
- Success measures: `Success is defined by measures that can actually be tracked, not vague impressions.`

## 50. Grant / Funding Proposal

Domain: Business
Best for: Seeking grant, sponsorship, philanthropic, government, or program funding.
Template type: Funding application

Sections:

- Project summary: `This application seeks a specific amount of funding to deliver a defined project for a named beneficiary or community.`
- Need: `The project responds to a real need, with the affected audience and the impact on them described honestly.`
- Activities: `The funding will support specific, named activities, delivered within a clear timeframe.`
- Outcomes: `The expected outcomes are concrete and measurable, not aspirational.`
- Budget and sustainability: `The total budget is stated clearly, the funding use is itemised, and the path to sustainability beyond the grant is realistic.`

---

## 51. Offer Letter

Domain: Business (Hiring)
Best for: Offering a candidate a role in writing, with clear terms and an acceptance path.
Template type: Formal offer letter

Sections:

- The offer: `[Business] is pleased to offer [Candidate] the role of [Role Title], commencing on [start date]. We're looking forward to having them on the team.`
- Key terms: `This role is offered at [remuneration], for [hours/days] per week, based at [location].`
- Conditions: `This offer is subject to [conditions, e.g. reference checks], to be completed before the start date.`
- Acceptance: `To accept this offer, please [sign and return / confirm by email] by [date].`

## 52. Terms of Employment

Domain: Business (Hiring)
Best for: Setting out the plain-English terms of an employment arrangement.
Template type: Employment terms summary

Sections:

- Parties and role: `This sets out the terms of employment between [Business] and [Employee] for the role of [Role Title].`
- Pay and hours: `[Employee] will be paid [remuneration] for [hours/days] per week, with entitlements as set out below.`
- Obligations: `[Employee] is expected to [key responsibilities and conduct expectations].`
- Ending employment: `Either party may end this arrangement with [notice period] notice, in line with applicable employment standards.`

## Implementation Notes for the Document Intelligence Profile

1. Treat these 52 document types as explicit templates, not fuzzy content categories.
2. Each template should have a stable section list and a stable draft generator.
3. The profile should select the nearest document type from user intent, uploaded material, keywords, and workflow context.
4. If confidence is low, the engine should still return a closest-match template with editable draft sections and a lightweight prompt for missing facts.
5. Business proposal, grant proposal, business plan, resume, cover letter, personal statement, and selection criteria response should be high-priority direct matches.
6. Draft sections must contain usable prose or structured starter content. They should not contain UI instructions, placeholder-only blanks, or generic scaffolds.
7. Template-specific drafts should live close to template metadata so the app cannot create a template without section-level starter content.
