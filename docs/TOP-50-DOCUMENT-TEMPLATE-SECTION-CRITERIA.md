# Top 50 Document Template Section Criteria

This file adds completion criteria to the original 50 PrompTED document templates. The implemented catalogue has since grown to **52** (see `docs/TOP-50-DOCUMENT-TEMPLATES.md` for the full reconciliation against `templates.data.json`). Each section has two rating categories:

- `Vital`: required information for the section to be considered complete. If a vital item is missing, the section should still render with a draft placeholder, but it should be flagged as needing user input.
- `Improver`: optional information that improves specificity, persuasion, polish, or usefulness. Missing improver data should not block completion.

Engine rule: a section is complete when its `Vital` criteria are satisfied. `Improver` criteria should drive follow-up questions, quality prompts, section scoring, and enhancement suggestions.

**Resolved: no new rows needed for templates added since this file was written.** Every template in `templates.data.json` -- including the 2 added beyond the original 50 (Offer Letter, Terms of Employment) and the 29 built in the template-library-expansion work -- carries its own `missing_detail_rules` array directly on the template record. That field already expresses the same vital/improver-style intent this file captures in table form, at the data layer, per template, rather than in this shared markdown reference. Keeping both in sync by hand isn't necessary and risks drifting out of agreement with the actual code, the way the rest of this file had drifted from the real template count until this pass. New templates should rely on `missing_detail_rules`; this file's table rows are considered complete and frozen at the original 50.

---

## 01. Resume / CV

| Section | Vital | Improver |
| --- | --- | --- |
| Header and contact | Full name, location or region, phone or email, and at least one reliable contact method. | LinkedIn, portfolio, visa/work rights, professional title, and clean formatting. |
| Professional summary | Target role or field, years or level of experience, 2-3 core strengths, and one clear value/outcome statement. | Industry keywords, measurable achievement, leadership style, specialist niche, and tone matched to target role. |
| Core skills | At least 6 relevant skills aligned to the target role or industry. | Grouped skill categories, tools/platforms, certifications, seniority indicators, and ATS keywords from job ads. |
| Professional experience | Role title, organisation, dates or duration, core responsibilities, and achievement or contribution for each role. | Metrics, scope, team size, budget, tools used, promotions, awards, and action-result wording. |
| Education and credentials | Qualification or credential name, institution/provider, and completion year or status. | Relevant subjects, honours, licences, short courses, professional memberships, and academic distinctions. |

## 02. Cover Letter

| Section | Vital | Improver |
| --- | --- | --- |
| Opening | Recipient or generic greeting, role title, company name, and direct application intent. | Referral name, role source, confident hook, and a concise reason for interest. |
| Why this role | Specific role attraction and connection to company, team, mission, product, or responsibilities. | Evidence of company research, values alignment, industry awareness, and enthusiasm without flattery. |
| Evidence of fit | One or more relevant achievements tied to the role requirements. | Metrics, STAR-style evidence, keywords from job description, and comparison to employer priorities. |
| Closing | Clear interest, thanks, and invitation to discuss the application. | Availability, attachment note, professional sign-off, and concise final value statement. |

## 03. LinkedIn Profile Rewrite

| Section | Vital | Improver |
| --- | --- | --- |
| Headline | Current or target role, main specialty, and professional value area. | Search keywords, audience, measurable outcome, industry niche, and recruiter-friendly phrasing. |
| About summary | Professional identity, experience area, core work focus, and key strengths. | First-person tone, career story, values, notable proof, and call to connect. |
| Featured experience | Recent achievements, projects, or credentials that demonstrate credibility. | Links, media, portfolio examples, metrics, named tools, and high-signal outcomes. |
| Availability or direction | Current career direction or opportunity type sought. | Location preference, work mode, sectors of interest, and collaboration/contact preference. |

## 04. Job-search Action Checklist

| Section | Vital | Improver |
| --- | --- | --- |
| Target roles | Target job titles, industries or functions, and preferred location or work mode. | Employer shortlist, salary range, deal-breakers, seniority level, and priority ranking. |
| Application assets | Resume, cover letter, LinkedIn/profile, references, and portfolio or samples where relevant. | Tailored versions, ATS keyword bank, achievement bank, file naming system, and review checkpoints. |
| Weekly activity plan | Application target, networking target, follow-up routine, and review cadence. | Time blocks, job board list, recruiter outreach, accountability partner, and success metrics. |
| Tracking fields | Role, company, date, status, contact, follow-up date, and outcome. | Interview notes, salary data, source channel, relationship strength, and lessons learned. |

## 05. Interview Preparation Questions

| Section | Vital | Improver |
| --- | --- | --- |
| Role understanding | Main responsibilities, required capabilities, and applicant evidence for fit. | Company-specific priorities, likely challenges, success measures, and language from job ad. |
| Behavioural questions | At least 3 behavioural questions with draft STAR answers. | Competency mapping, metrics, concise spoken wording, and alternate examples for each competency. |
| Company questions | At least 3 questions for the interviewer about role, team, or expectations. | Questions tailored by interview stage, strategic curiosity, and avoidance of already-public answers. |
| Closing statement | Clear final statement of interest and fit. | Reference to interview discussion, first-90-days contribution, and memorable final proof point. |

## 06. Interview Script

| Section | Vital | Improver |
| --- | --- | --- |
| Introduction | Candidate identity, target role, relevant experience, and reason for interest. | Natural spoken tone, time limit, warm opening, and role-specific hook. |
| Career story | Brief progression from background to current target opportunity. | Through-line theme, transition logic, values, and links between past work and future direction. |
| Achievement example | Specific project or challenge, candidate role, actions, and result. | Metrics, stakeholder detail, obstacle handled, and competency label. |
| Final close | Appreciation, restated fit, and interest in next step. | Reference to interviewer priorities, concise confidence statement, and availability. |

## 07. STAR Achievement Bank

| Section | Vital | Improver |
| --- | --- | --- |
| Situation | Context, problem, timeframe, and why it mattered. | Scale, stakes, stakeholders, constraints, and baseline condition. |
| Task | Candidate responsibility and expected outcome. | Decision authority, competing priorities, deadlines, and success criteria. |
| Action | Specific steps personally taken by the candidate. | Tools, collaboration, tradeoffs, communication approach, and leadership behaviours. |
| Result | Outcome and competency demonstrated. | Quantified impact, recognition, lessons learned, repeatability, and relevance to target role. |

## 08. Selection Criteria Response

| Section | Vital | Improver |
| --- | --- | --- |
| Criterion heading | Exact criterion or requirement being answered. | Numbered criterion, keywords preserved, and plain-language interpretation. |
| Summary claim | Direct statement that applicant meets the criterion and why. | Seniority level, frequency of use, scope, and role alignment. |
| Evidence example | Concrete example with context, action, and capability demonstrated. | Metrics, constraints, stakeholders, policy or compliance context, and STAR structure. |
| Outcome and relevance | Result achieved and explanation of relevance to target role. | Link to organisation values, repeatability, transferable lesson, and strong closing sentence. |

## 09. Job Follow-up Email

| Section | Vital | Improver |
| --- | --- | --- |
| Subject | Role or application reference. | Company name, concise action wording, and interview/application date. |
| Opening | Recipient, reason for follow-up, role, and submission or meeting date. | Warm tone, reminder of prior contact, and no-pressure phrasing. |
| Value reminder | Short restatement of fit or relevant experience. | Specific interview topic, key achievement, and alignment to team priority. |
| Close | Polite request or offer to provide information. | Availability, thanks, professional sign-off, and attachment mention if needed. |

## 10. Reference Request

| Section | Vital | Improver |
| --- | --- | --- |
| Opening request | Clear ask for reference and opportunity type. | Permission-based wording, deadline, and relationship warmth. |
| Context | Role/program details and why this person is relevant. | Specific skills to mention, shared project, and employer/application context. |
| Support materials | Offer of resume, role description, or talking points. | Draft referee notes, key achievements, submission method, and deadline reminders. |
| Close | Respectful opt-out and thanks. | Alternative contact option and confirmation of preferred phone/email. |

## 11. Professional Reference Letter

| Section | Vital | Improver |
| --- | --- | --- |
| Relationship | Referee identity, candidate identity, relationship, and timeframe. | Referee title, organisation, reporting line, and context of collaboration. |
| Performance | Candidate strengths and work quality. | Reliability, conduct, technical skill, leadership, and comparison to peers. |
| Evidence | Specific example of candidate contribution. | Measurable outcome, stakeholder impact, challenge overcome, and responsibility level. |
| Recommendation | Clear endorsement and suitable role/context. | Contact details, strength of recommendation, and future potential statement. |

## 12. Personal Brand Statement

| Section | Vital | Improver |
| --- | --- | --- |
| Identity | Profession, role, specialty, or target positioning. | Niche, audience, seniority, and memorable wording. |
| Value proposition | Audience served, outcome delivered, and core approach. | Differentiator, measurable value, industry language, and concise rhythm. |
| Proof | At least one achievement or credibility signal. | Metrics, named projects, awards, testimonials, and recognisable organisations. |
| Direction | Future focus or opportunity type. | Mission, values, preferred environment, and call-to-action. |

## 13. Career Change Plan

| Section | Vital | Improver |
| --- | --- | --- |
| Target direction | Current role/field and target role/field. | Motivation, preferred sector, salary/work-mode constraints, and transition deadline. |
| Transferable strengths | Existing skills relevant to target field. | Evidence examples, mapped competencies, portfolio proof, and recruiter language. |
| Gap plan | Missing skills or experience and actions to address them. | Course names, projects, mentors, certifications, and priority ranking. |
| Timeline | Timeframe, milestones, and review cadence. | Weekly actions, networking targets, risk plan, and success indicators. |

## 14. Pay-rise Request

| Section | Vital | Improver |
| --- | --- | --- |
| Opening | Clear request to discuss compensation and role context. | Desired adjustment range, meeting request, and calm professional tone. |
| Contribution summary | Recent achievements and expanded responsibilities. | Metrics, revenue/cost/customer impact, peer comparison, and leadership contribution. |
| Evidence and benchmark | Basis for salary adjustment, such as scope or market alignment. | External salary data, internal bands, retention risk, and documentation of added duties. |
| Conversation close | Specific next step or discussion request. | Flexibility on package components, review date, and collaborative wording. |

## 15. Promotion Case

| Section | Vital | Improver |
| --- | --- | --- |
| Promotion request | Current role, target role, and clear promotion ask. | Timing, business need, and alignment to role framework. |
| Current impact | Achievements and value delivered in current period. | Metrics, stakeholder feedback, strategic contribution, and consistency over time. |
| Readiness evidence | Examples showing next-level responsibilities already performed. | Leadership examples, decision-making scope, mentoring, and cross-functional influence. |
| Proposed next scope | Responsibilities and outcomes candidate would own if promoted. | 30/60/90-day plan, team benefit, risk reduction, and measurable goals. |

## 16. Resignation Letter

| Section | Vital | Improver |
| --- | --- | --- |
| Notice statement | Resignation statement, role, company, and final working day. | Notice period reference and contract-aware wording. |
| Appreciation | Brief thanks or positive acknowledgement. | Specific opportunity, manager support, or professional growth note. |
| Transition support | Offer to hand over responsibilities. | Named tasks, documentation plan, replacement support, and key dates. |
| Close | Professional closing and goodwill. | Personal contact detail and concise future-facing tone. |

## 17. Networking Outreach Message

| Section | Vital | Improver |
| --- | --- | --- |
| Introduction | Sender identity and reason for contacting recipient. | Shared connection, specific work reference, and concise credibility signal. |
| Reason for contact | Topic or career area where advice is sought. | Context on current goal, respectful relevance, and targeted question. |
| Specific ask | Clear request for a short conversation or advice. | Time estimate, flexible scheduling, and low-pressure framing. |
| Close | Thanks and respectful opt-out. | LinkedIn/profile link and offer to work around their schedule. |

## 18. Recruiter Introduction Email

| Section | Vital | Improver |
| --- | --- | --- |
| Subject | Role type and opportunity interest. | Location, seniority, contract/permanent preference, and niche skill. |
| Profile summary | Candidate role, experience area, and target opportunity. | Years of experience, industry, current availability, and work rights. |
| Fit details | Relevant achievements, skills, and preferred responsibilities. | Metrics, tools, certifications, salary range, and target companies/sectors. |
| Attachments and close | Resume mention and invitation to discuss fit. | Portfolio link, availability windows, and concise call-to-action. |

## 19. Personal Statement

| Section | Vital | Improver |
| --- | --- | --- |
| Opening motivation | Field/program interest and origin of motivation. | Personal insight, distinctive story, and connection to institution values. |
| Academic preparation | Relevant study, skills, and experiences. | Projects, grades, reading, awards, and subject-specific language. |
| Personal qualities | Qualities supported by example. | Leadership, resilience, community contribution, and reflective maturity. |
| Future goals | Intended outcome after program. | Specific career path, social impact, research direction, and institution fit. |

## 20. Application Letter - Education

| Section | Vital | Improver |
| --- | --- | --- |
| Opening | Program/course, institution, intake/year, and application intent. | Applicant ID, referral source, and concise reason for applying. |
| Reason for choosing program | Specific reason for choosing institution or course. | Faculty, curriculum, facilities, placement, reputation, or community fit. |
| Applicant fit | Relevant background and readiness for program. | Achievements, skills, extracurriculars, and evidence of commitment. |
| Closing | Thanks and clear interest in admission. | Availability for interview, attachments list, and respectful final statement. |

## 21. Scholarship Application

| Section | Vital | Improver |
| --- | --- | --- |
| Applicant profile | Applicant identity, scholarship name, study field, and institution. | Current year level, background, community, and eligibility category. |
| Need or merit case | Financial need or merit basis for support. | Specific costs, barriers, leadership, academic results, and personal context. |
| Achievement evidence | Achievements showing deservingness. | Metrics, awards, community service, overcoming adversity, and referee support. |
| Impact | How scholarship will help and what outcome it enables. | Broader community benefit, long-term goals, and accountability commitments. |

## 22. Statement of Purpose

| Section | Vital | Improver |
| --- | --- | --- |
| Academic focus | Intended field and topic of interest. | Research question, specialisation, and intellectual motivation. |
| Preparation | Relevant academic or professional background. | Methods, projects, publications, grades, internships, and technical skills. |
| Program fit | Clear reason the specific program is appropriate. | Faculty names, labs, courses, facilities, and institutional strengths. |
| Future direction | Career or research goal after completion. | Contribution to field, geographic/community impact, and long-term plan. |

## 23. Study Plan

| Section | Vital | Improver |
| --- | --- | --- |
| Learning goal | Subject/skill, deadline, and success measure. | Motivation, exam requirements, target score, and priority topics. |
| Current level | Strengths and gaps. | Diagnostic results, confidence rating, and evidence from prior performance. |
| Weekly schedule | Study hours, practice tasks, and review method. | Calendar blocks, resource list, spaced repetition, and practice-test cadence. |
| Accountability | Review interval and progress measure. | Mentor/tutor check-ins, reward system, adjustment rules, and risk plan. |

## 24. Research Proposal

| Section | Vital | Improver |
| --- | --- | --- |
| Research title and question | Working title and clear research question. | Sub-questions, hypothesis, scope limits, and concise title wording. |
| Background and rationale | Topic context, problem, and research gap. | Key literature, policy/social relevance, and original contribution argument. |
| Methodology | Method, data/source/participants, and analysis approach. | Ethics, sampling, limitations, timeline, and feasibility details. |
| Expected contribution | Academic or practical value of the research. | Beneficiaries, dissemination plan, and link to supervisor/institution priorities. |

## 25. Literature Review

| Section | Vital | Improver |
| --- | --- | --- |
| Review scope | Topic, boundaries, and themes reviewed. | Inclusion/exclusion criteria, date range, databases, and search terms. |
| Key themes | Main themes or schools of thought. | Representative authors, synthesis across sources, and chronological development. |
| Debate or tension | Area of disagreement or uncertainty. | Contrasting methodologies, evidence quality, and unresolved questions. |
| Gap and direction | Identified gap and how current work responds. | Specific research question, theoretical contribution, and practical relevance. |

## 26. Academic Appeal Letter

| Section | Vital | Improver |
| --- | --- | --- |
| Decision being appealed | Decision, date, course/program, and student identity. | Student number, policy reference, and appeal deadline. |
| Grounds for appeal | Clear appeal reason and evidence basis. | Relevant policy clause, supporting documentation list, and procedural issue if any. |
| Explanation | Circumstances, timeframe, and impact on academic performance. | Actions taken, communication attempts, medical/support evidence, and responsibility taken. |
| Requested outcome | Specific remedy requested. | Alternative remedy, willingness to meet, and concise respectful tone. |

## 27. Extension Request Letter

| Section | Vital | Improver |
| --- | --- | --- |
| Opening request | Assignment, course, current due date, and extension ask. | Student ID, lecturer name, and requested duration. |
| Reason | Circumstance affecting completion. | Evidence, dates affected, work already completed, and impact explanation. |
| Proposed date | New requested submission date. | Realistic completion plan and remaining task list. |
| Close | Thanks and evidence/attachment mention if relevant. | Apology for inconvenience and willingness to discuss alternatives. |

## 28. Student Support Plan

| Section | Vital | Improver |
| --- | --- | --- |
| Student context | Student, course/year level, and support area. | Diagnosis/learning profile if appropriate, attendance pattern, and consent status. |
| Strengths | Student strengths or existing supports. | Interests, preferred learning modes, successful strategies, and motivators. |
| Support needs | Priority barriers or needs. | Triggers, risk indicators, accessibility details, and urgency rating. |
| Actions and review | Support actions, owner, and review date. | Frequency, measurable goals, escalation path, family/carer involvement, and documentation location. |

## 29. Course Comparison Matrix

| Section | Vital | Improver |
| --- | --- | --- |
| Options | Courses/programs being compared. | Institution names, locations, delivery mode, and intake dates. |
| Criteria | Decision criteria relevant to choice. | Weighting, must-have constraints, costs, career outcomes, and entry requirements. |
| Comparison notes | Relative strengths or weaknesses of each option. | Evidence links, student reviews, ranking, placement data, and risk notes. |
| Recommendation | Preferred option and reason. | Tradeoff explanation, backup option, next steps, and application deadline. |

## 30. Academic Reference Request

| Section | Vital | Improver |
| --- | --- | --- |
| Opening request | Clear request for academic reference and opportunity. | Deadline, submission method, and polite opt-out. |
| Relationship context | Course/unit, timeframe, and work completed with referee. | Grade, project title, class contribution, and supervisor relationship. |
| Application context | Program/scholarship focus and desired qualities to mention. | Selection criteria, statement of purpose summary, and tailored talking points. |
| Close | Offer to provide materials and thanks. | Attachments list, reminder date, and contact details. |

## 31. Business Proposal

| Section | Vital | Improver |
| --- | --- | --- |
| Executive summary | Client, provider, problem, proposed solution, and headline outcome. | Commercial value, differentiator, urgency, success measure, and executive tone. |
| Client challenge | Clear client problem and business impact. | Evidence, quantified pain, stakeholder effects, and risks of inaction. |
| Proposed solution | Deliverables, approach, and how solution addresses challenge. | Phases, methodology, assumptions, exclusions, and proof of capability. |
| Timeline and investment | Start date or timeframe and price/range. | Payment terms, options/packages, dependencies, milestones, and validity period. |
| Next steps | Approval or action required to proceed. | Named decision makers, kickoff agenda, signature process, and contact details. |

## 32. Business Plan

| Section | Vital | Improver |
| --- | --- | --- |
| Business concept | Product/service, customer, problem solved, and differentiator. | Mission, vision, positioning, and founder insight. |
| Market opportunity | Target market, demand driver, and competitor context. | Market size, segments, customer personas, trends, and validation evidence. |
| Operating model | Delivery channel, resources, team, and core operations. | Systems, suppliers, process map, staffing plan, and risk controls. |
| Financial outlook | Revenue streams, costs, and break-even logic. | Forecasts, margins, funding needs, assumptions, and sensitivity scenarios. |
| Milestones | Key milestones and timeframe. | Owners, metrics, dependencies, and investor-ready roadmap. |

## 33. Executive Summary

| Section | Vital | Improver |
| --- | --- | --- |
| Purpose | Topic, audience, and reason for summary. | Decision context, strategic link, and scope boundary. |
| Current situation | Present state and key issues. | Data points, trend direction, root causes, and stakeholder impact. |
| Recommendation | Recommended option and rationale. | Alternatives considered, quantified benefit, risk mitigation, and implementation confidence. |
| Decision required | Specific approval, decision, or action requested. | Deadline, budget implication, owner, and next-step sequence. |

## 34. Pitch Deck Outline

| Section | Vital | Improver |
| --- | --- | --- |
| Problem | Target customer, problem, and consequence. | Emotional hook, market evidence, scale of pain, and current workaround. |
| Solution | Product/service and core benefit. | Demo flow, unique mechanism, screenshots, and competitive difference. |
| Market and traction | Market segment and proof of demand or progress. | TAM/SAM/SOM, revenue/users, pilots, growth rate, and customer quotes. |
| Business model | Revenue model and pricing logic. | Unit economics, sales channel, retention, margin, and expansion strategy. |
| Ask | Funding/support amount and use of funds. | Milestones unlocked, runway, investor fit, and closing call-to-action. |

## 35. Service Agreement

| Section | Vital | Improver |
| --- | --- | --- |
| Parties and purpose | Provider, client, service purpose, and start date. | Legal names, addresses, ABN/company numbers, and background recitals. |
| Scope of services | Services to be provided. | Deliverable detail, service standards, exclusions, and change-control process. |
| Fees and payment | Fee amount/rate and payment timing. | Late fees, expenses, taxes, invoicing details, and deposit terms. |
| Responsibilities | Provider and client obligations. | Dependencies, access requirements, approvals, confidentiality, and compliance duties. |
| Termination | Termination rights and notice period. | Effects of termination, outstanding fees, handover, and dispute process. |

## 36. Scope of Work

| Section | Vital | Improver |
| --- | --- | --- |
| Project overview | Project outcome, client/team, and timeframe. | Background, business objective, sponsor, and success definition. |
| In-scope work | Included deliverables or services. | Phase breakdown, acceptance standards, quantities, and dependencies. |
| Out-of-scope work | Clear exclusions. | Examples of common extras, change request pathway, and pricing trigger. |
| Deliverables and acceptance | Deliverables and approval criteria. | Reviewer names, revision limits, sign-off process, and quality standards. |
| Assumptions | Critical assumptions or dependencies. | Risk notes, client responsibilities, access needs, and timeline constraints. |

## 37. Standard Operating Procedure

| Section | Vital | Improver |
| --- | --- | --- |
| Purpose | Process name and reason for procedure. | Quality, safety, compliance, or customer outcome it protects. |
| Scope | Who and what the SOP applies to. | Exclusions, triggering conditions, and related procedures. |
| Steps | Sequential actions needed to complete the process. | Screenshots, decision points, timing, error handling, and quality checks. |
| Roles and responsibilities | Owners, reviewers, and approvers. | RACI detail, escalation path, backups, and training requirements. |
| Records and review | Where records are stored and review cadence. | Version control, audit requirements, retention period, and improvement log. |

## 38. Workplace Policy

| Section | Vital | Improver |
| --- | --- | --- |
| Policy statement | Organisation commitment and behaviour/area governed. | Values link, legal basis, and plain-language summary. |
| Scope | People, places, systems, or activities covered. | Exclusions, examples, contractor/vendor applicability, and jurisdiction notes. |
| Requirements | Required behaviours, responsibilities, and prohibitions. | Examples, manager duties, reporting pathway, and training requirements. |
| Breaches | Consequence or process for non-compliance. | Investigation process, procedural fairness, escalation, and support options. |
| Review | Owner and review timing. | Version history, consultation requirement, and legislative trigger. |

## 39. Business Email

| Section | Vital | Improver |
| --- | --- | --- |
| Subject | Clear topic or action. | Deadline, reference number, and concise wording. |
| Opening | Recipient and context for message. | Relationship-appropriate tone and prior-contact reference. |
| Main message | Main point, requested action, and reason. | Decision framing, benefit, urgency, and no unnecessary detail. |
| Details | Supporting facts needed to act. | Bullets, attachments, links, dates, and ownership clarity. |
| Close | Requested response/action and deadline if relevant. | Thanks, next step, sign-off, and contact details. |

## 40. Meeting Minutes

| Section | Vital | Improver |
| --- | --- | --- |
| Meeting details | Meeting name, date, attendees, chair, and minute taker. | Apologies, location/link, meeting purpose, and document version. |
| Agenda summary | Topics discussed. | Time allocation, presenter names, and links to papers. |
| Decisions | Decisions made and context. | Decision owner, rationale, vote/consensus status, and dependencies. |
| Action items | Owner, task, and due date. | Priority, status, blockers, and follow-up channel. |
| Next meeting | Next date or next step. | Proposed agenda, required preparation, and recurring cadence. |

## 41. Board Report

| Section | Vital | Improver |
| --- | --- | --- |
| Executive overview | Reporting period, topic, key update, and decision needed if any. | Strategic framing, exception reporting, and one-page readability. |
| Performance | Key metrics and comparison to target/baseline. | Trend analysis, commentary, segment breakdown, and management response. |
| Risks and issues | Current risks/issues and mitigations. | Risk rating, appetite alignment, owner, due date, and emerging risks. |
| Decisions required | Specific board approval or noting request. | Resolution wording, implications, alternatives, and recommended motion. |

## 42. Quarterly Business Review

| Section | Vital | Improver |
| --- | --- | --- |
| Quarter summary | Quarter, major achievements, progress, and challenge. | Strategic context, customer impact, and comparison to previous quarter. |
| Metrics | Key results and performance interpretation. | Dashboard links, targets, variance analysis, and leading indicators. |
| Insights | Lessons or patterns from the quarter. | Root causes, market/customer feedback, and decision implications. |
| Next quarter priorities | Priorities and owners for next period. | Targets, risks, resource needs, and milestone dates. |

## 43. Performance Review

| Section | Vital | Improver |
| --- | --- | --- |
| Role summary | Employee, role, period, and core responsibilities. | Level expectations, changes in scope, and team context. |
| Achievements | Key achievements and impact. | Metrics, stakeholder feedback, behavioural examples, and goal linkage. |
| Strengths | Demonstrated strengths. | Evidence examples, role competency mapping, and peer/customer comments. |
| Development areas | Areas for improvement and support. | Training plan, coaching actions, resources, and behavioural specificity. |
| Goals | Future goals and measurement. | SMART format, career alignment, stretch targets, and review dates. |

## 44. Onboarding Checklist

| Section | Vital | Improver |
| --- | --- | --- |
| Pre-start | Contract, payroll, equipment, access, and welcome communication. | Buddy assigned, schedule sent, manager checklist, and workspace readiness. |
| First day | Welcome, introductions, expectations, schedule, and compliance basics. | Culture overview, team lunch, org chart, and first-day feedback check. |
| First week | Training, stakeholder introductions, and early priorities. | Shadowing plan, system walkthroughs, role-specific reading, and buddy check-ins. |
| First 30 days | Progress review, support needs, and next goals. | 30/60/90 plan, performance indicators, confidence check, and manager feedback loop. |

## 45. Induction Manual

| Section | Vital | Improver |
| --- | --- | --- |
| Welcome | New starter welcome, company name, and role context. | Founder/leader note, tone aligned to culture, and first-week reassurance. |
| About the organisation | Products/services, customers/community, and values. | History, mission, strategy, structure, and brand voice. |
| How work gets done | Core systems, communication channels, and standard workflows. | Meeting norms, decision rights, documentation practices, and remote/hybrid expectations. |
| Expectations | Policies, conduct, communication, and workplace standards. | Examples, probation expectations, escalation norms, and inclusion practices. |
| Support contacts | Manager, HR/admin, IT, and buddy/support contacts. | Response times, emergency contacts, and help channels. |

## 46. Risk Assessment

| Section | Vital | Improver |
| --- | --- | --- |
| Activity or context | Activity/project/process, team/location, and period. | Scope exclusions, assumptions, and assessment owner. |
| Identified risks | Risks and potential impacts. | Causes, affected stakeholders, categories, and existing incidents/data. |
| Risk rating | Likelihood, consequence, and overall rating. | Rating matrix, residual risk, risk appetite, and confidence level. |
| Controls | Current controls and required actions. | Control owner, due date, effectiveness rating, and evidence of implementation. |
| Review | Review date or trigger. | Monitoring cadence, incident trigger, version history, and approval record. |

## 47. Financial Review

| Section | Vital | Improver |
| --- | --- | --- |
| Period summary | Period, overall performance, and primary driver. | Comparison to budget, previous period, forecast, and executive implication. |
| Revenue | Revenue amount and comparison point. | Segment/product/channel detail, variance explanation, and pipeline outlook. |
| Expenses | Expense amount, major cost areas, and variance driver. | Fixed/variable split, one-off costs, cost controls, and supplier notes. |
| Cash flow and outlook | Cash position and upcoming pressures/opportunities. | Runway, receivables/payables, scenario forecast, and liquidity risks. |
| Actions | Recommended financial actions. | Owner, timing, expected impact, and monitoring measure. |

## 48. Budget Workbook

| Section | Vital | Improver |
| --- | --- | --- |
| Budget purpose | Budget owner, period, and project/team/business context. | Planning scenario, approval status, and linked strategic objective. |
| Income assumptions | Revenue streams, volume, price, and timing assumptions. | Confidence rating, source evidence, seasonality, and sensitivity variables. |
| Cost assumptions | Cost categories and key cost drivers. | Fixed/variable split, supplier quotes, contingency, and escalation assumptions. |
| Scenario notes | Base, conservative, or growth assumptions. | Scenario triggers, probability, and decision thresholds. |
| Review process | Review cadence and actuals comparison method. | Variance tolerance, owner, reporting format, and corrective action process. |

## 49. Marketing Brief

| Section | Vital | Improver |
| --- | --- | --- |
| Objective | Campaign goal, product/service, and deadline or timeframe. | Funnel stage, business metric, audience behaviour change, and priority ranking. |
| Audience | Target audience and their need/problem. | Persona detail, objections, customer insight, and segmentation. |
| Message | Core message and supporting proof. | Tone of voice, offer, emotional hook, and competitive differentiation. |
| Channels and deliverables | Required assets and distribution channels. | Specs, deadlines, owners, media budget, and approval workflow. |
| Success measures | Metrics used to judge success. | Baseline, targets, attribution method, and reporting cadence. |

## 50. Grant / Funding Proposal

| Section | Vital | Improver |
| --- | --- | --- |
| Project summary | Organisation, funding amount/support, project, and beneficiary. | One-sentence impact statement, location, duration, and alignment to funder priorities. |
| Need | Problem, affected audience, and impact. | Evidence, data, lived experience, policy context, and urgency. |
| Activities | Funded activities and delivery timeframe. | Workplan, partners, staffing, milestones, and accessibility considerations. |
| Outcomes | Expected outcomes and measurement method. | Outputs vs outcomes, evaluation plan, indicators, and beneficiary feedback. |
| Budget and sustainability | Total budget, funding use, and sustainability path. | Co-funding, in-kind support, detailed line items, and post-grant continuation plan. |

---

## Implementation Notes

1. Store criteria alongside the section metadata, not only in prompt text.
2. Mark a section as `complete` only when all vital criteria have either user-provided values or acceptable generated placeholders.
3. Use missing vital criteria to drive direct follow-up questions.
4. Use missing improver criteria to drive optional quality prompts, enhancement suggestions, or TED-assisted edits.
5. Expose the rating in the UI as section-level intelligence, for example: `Vital missing: company name, deadline`; `Improver available: add metric, add stakeholder impact`.
6. Do not block export solely because improver criteria are missing.
7. Never return blank sections when vital criteria are missing; return the section with draft placeholder text and a clear missing-vital flag.
