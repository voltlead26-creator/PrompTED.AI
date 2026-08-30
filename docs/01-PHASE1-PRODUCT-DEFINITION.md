# Phase 1 — Product Definition

**PrompTED · TED AI · Version 1.0 · June 2026**

> This document is the canonical product definition. All subsequent SRS, architecture, and build decisions derive from it. Where it conflicts with earlier notes, this document wins.

---

## 1.1 Product Vision

PrompTED turns a described situation into finished, professional documents, plans, and checklists — and tells the user clearly what to do next.

It is built for Australians who are capable but overwhelmed: by bureaucracy, by paperwork, and increasingly by AI tools that demand the user already know what to ask for. PrompTED removes that burden. The user describes their situation in plain language. TED works out what is needed, prepares it, and helps them finish.

The product is scoped to three domains — **employment, education, and business** — with business as the primary and most valuable segment because businesses generate documents constantly and will pay for a tool that produces them quickly and consistently.

PrompTED is not another AI document generator. Its advantage is that it removes the two things that stop people: not knowing what they need, and not knowing how to make it look professional.

The interface is a **chat-first home screen** that feels closer to ChatGPT than to a form builder. The user types their situation. TED responds with a clear plan, then executes it. The result is always a finished artifact — a real document, action plan, or checklist — not raw chat text the user must still wrangle.

---

## 1.2 Target Users

Users are ordered by revenue priority.

### Primary — Businesses (employers, owners, managers, operators)

The revenue engine. A business uses PrompTED frequently and repeatedly across a wide surface: internal and client emails, policies, induction and onboarding material, engagement letters, service agreements, proposals, performance reviews, meeting minutes, briefings, de-briefings, P&L summaries, consultation documents, and written analysis.

**Persona — Maria (small-business owner).** Runs a small Australian business; time-poor and not technical. Needs policies, onboarding material, client emails, agreements, and reports produced quickly and on-brand. Pain: no time, no in-house help, fear of looking unprofessional or getting compliance wrong. Wins when a short description becomes a finished, branded document she can use now and reuse later.

**Persona — Aroha (manager / HR).** Manages a team; produces performance reviews, onboarding packs, terms of employment, and briefings. Pain: consistency and employment-law worry. Wins when PrompTED gives fair, structured documents with clear "check Fair Work" guardrails on the high-stakes ones.

### Secondary — Job seekers and workers

The consumer wedge and the most viral hook. The flagship is the "I need a job" bundle: a complete, job-ready package produced from one request.

**Persona — Daniel (job seeker).** Recently out of work; lower confidence, not a strong writer. Needs a resume, cover letter, interview prep, and a budget for the job-search gap. Pain: doesn't know what to write or how to look professional. Wins when one request produces a complete, job-ready pack.

### Tertiary — Students and applicants

School and university applications, personal statements, scholarship and reference requests — high emotional stakes, clear value, very low liability.

**Persona — Priya (student / applicant).** Applying to study; needs a personal statement, application letter, and reference requests. Pain: high stakes, unsure how to present herself. Wins when PrompTED structures a compelling, honest application.

### Quaternary — Overwhelmed individuals (personal track)

Life-event planning: preparing for a baby, moving house, planning an event, getting fit. The product delivers research-backed, tickable, deadline-aware checklists — not formal documents.

**Persona — Sam (overwhelmed individual).** Preparing for a big life event. Pain: doesn't know all the steps; afraid of missing something important. Wins when PrompTED researches and lays out a prioritised, tickable plan that reminds them before deadlines.

---

## 1.3 Main User Problems

| # | Problem | Who | Severity |
|---|---------|-----|----------|
| P-01 | "I don't know what document I actually need" | All | Critical |
| P-02 | "I know what I need but I don't know how to write it professionally" | All | Critical |
| P-03 | "I spent time with ChatGPT but got text I still had to format and polish" | All | High |
| P-04 | "I don't know what to do next after writing the document" | All | High |
| P-05 | "Our business documents are inconsistent — different people, different styles" | Business | High |
| P-06 | "I'm scared I'll get employment law wrong" | Business | High |
| P-07 | "I don't have time to write a policy from scratch" | Business | High |
| P-08 | "I need a complete job-ready pack, not just a resume" | Job seekers | High |
| P-09 | "I don't know all the steps I need to take for this life event" | Personal | Medium |
| P-10 | "I start things but don't finish them — I need reminders and progress" | Personal | Medium |

---

## 1.4 Core Value Proposition

**One sentence:** TED turns what you're trying to achieve into a finished document, plan, or checklist — you never have to know what to ask for or how to format it.

**The three removals:**
1. Removes the need to know what document you need (TED decides)
2. Removes the need to know how to write or format it (TED drafts from structure)
3. Removes the blank-page paralysis (TED leads, user refines)

**The one addition:**
4. Adds clear next steps so the user finishes, not just generates

**Differentiation from ChatGPT / generic AI:**
- ChatGPT returns chat text. PrompTED returns a finished, formatted, downloadable artifact.
- ChatGPT requires the user to know what to ask. PrompTED interprets what the user is trying to achieve.
- ChatGPT has no memory of your business, name, style, or past work. PrompTED pre-fills from your profile.
- ChatGPT has no document structure. PrompTED uses verified templates and never improvises structure.

---

## 1.5 Primary Use Cases

### UC-01 — "I need a job" (employment bundle)
User: "I'm looking for work. I was a warehouse supervisor for 5 years."  
Output: Resume · Cover letter · Job-search action checklist · Live job suggestions · Budget Workbook · Interview questions · Interview script · Follow-up email  
Value: Complete job-ready pack from one request

### UC-02 — Onboard a new employee (business bundle)
User: "I need to bring on a new part-time receptionist next Monday."  
Output: Offer letter · Terms of employment · Induction manual · Onboarding checklist · Welcome email  
Value: Legally-framed onboarding package from a brief description, pre-filled with business name and role

### UC-03 — Business policy or document
User: "I need a social media policy for my team."  
Output: Workplace policy (structured, branded)  
Value: Professional document in minutes, brand kit applied, no blank page

### UC-04 — Analytical report from uploaded data
User uploads a spreadsheet of last quarter's sales. "Turn this into an executive summary."  
Output: Structured report with tables and charts, grounded only in the user's real data  
Value: Data in → finished report out, no reformatting

### UC-05 — Life-event checklist
User: "We're having a baby in September."  
Output: Research-backed checklist with items grouped by timing, deadlines, reasons, and reminders  
Value: Comprehensive plan with reminders so nothing is missed

### UC-06 — Education application
User: "I'm applying to nursing at RMIT. I need help with my personal statement."  
Output: Personal statement · Application letter · Reference requests  
Value: High-stakes application supported from a brief description

### UC-07 — Single document (off-catalogue)
User: "I need a client NDA."  
TED recommends a Non-Disclosure Agreement template plus two variants (Mutual NDA, Confidentiality Clause for Contracts), each with use-case explanation.  
Output: The user picks one; TED drafts it structured and pre-filled  
Value: Correct document type chosen without the user knowing legal terminology

---

## 1.6 MVP Scope (V1)

The MVP delivers the complete core loop across all three domains with four bundles, a template library, and the Master Workspace.

### In V1

**Core loop:**  
- Chat-first home screen (what are you trying to achieve?)  
- Intent interpretation and recommendation checkpoint (TED shows plan, user confirms)  
- Document generation from structured templates (Domain Engine)  
- Master Workspace: section-by-section editing, approval, and status tracking  
- Export: PDF and Word for all documents; Excel for the Budget Workbook only  

**Bundles (4):**  
1. "I need a job" (employment)  
2. "Onboard a new employee" (business)  
3. "Set up the basics of my business" (business)  
4. "I'm applying" (education)  

**Template library (~22 templates):**  
See Appendix 1 of the master SRS. Employment: Resume, Cover Letter, Job-search checklist, Interview prep, Interview script, Follow-up email, Pay-rise request, Promotion case. Education: Personal statement, Application letter, Reference request. Business: Business email, Workplace policy, SOP, Offer letter, Terms of employment, Induction manual, Onboarding checklist, Performance review, Meeting minutes / briefing, Service agreement, Proposal. Finance: Budget Workbook (Excel).

**Output types:**  
- Composed documents (prose structured by template)  
- Structured form documents (fillable fields)  
- Checklists and action plans (researched, tickable, deadline-aware)  
- Analytical/report documents (from user-uploaded data, with tables and charts)  

**Profiles:**  
- Individual profile (name, contact) for pre-fill  
- Business profile / company memory (name, ABN, brand, voice, reusable snippets)  
- Brand kit ("Brand it") applied to business outputs, with live preview  

**AI infrastructure:**  
- Provider-agnostic gateway wiring OpenAI, Anthropic, and Google  
- Web search for checklists, action plans, and job suggestions  
- Photo and document upload as input context  
- Clari (reading-level and tone personalisation)  

**Accounts and monetisation:**  
- Anonymous start; account gated at save/export  
- Sign in with Apple (iOS)  
- Free / Pro / Premium / Business subscription tiers  
- Usage ledger enforcement  
- Stripe (web) + Apple IAP + RevenueCat sync  

**Compliance:**  
- AI processing disclosure and consent  
- Privacy policy + terms (littlemissscarlett.co/privacy, /terms)  
- Account deletion in-app  
- App Store readiness (G7 full checklist)  

**V1 enhancements pulled forward (ride existing architecture):**  
- Recents / Saved / Your Templates fast lane  
- Bundle "download the whole pack" + share/copy  
- Light outcome status and "what's due" in Library  
- Live brand preview on business outputs  

### Not in V1

- Full business template breadth (Appendix 2 of SRS)  
- Team / multi-seat business accounts  
- Full application/outcome tracker (beyond checklists)  
- Education breadth beyond the three launch templates  
- Bulk multi-file ingestion  
- E-signature  
- Template marketplace  
- Third-party integrations  
- Legal, government, or official-form replication  

---

## 1.7 Future Scope

**V2:**  
Full business template library (Appendix 2 of SRS), brand kit full build-out, business team seats and multi-seat accounts, application/outcome tracker, document uploads at scale, education breadth.

**V3:**  
Evidence-collection engine, full outcome tracking, e-signature, template marketplace, third-party integrations, potential second domain (life admin).

**Explicitly parked (never in scope):**  
Legal government form replication (fines, Centrelink, tax declarations, statutory declarations, tenancy/official forms). Removes heaviest accuracy and liability exposure; keeps focus on employment, education, and business.

---

## 1.8 Non-Goals

| # | Non-goal | Reason |
|---|---------|--------|
| NG-01 | Being a chatbot or conversational assistant | PrompTED returns finished artifacts, not chat replies |
| NG-02 | Replicating official/government forms | Liability, accuracy exposure; explicitly parked |
| NG-03 | Replacing a lawyer or accountant | PrompTED prepares documents; it does not certify compliance |
| NG-04 | Daily habit / engagement loop | Not an app users should use for its own sake; interactivity only as completion scaffolding |
| NG-05 | Job board | Job suggestions are preparation and aggregation; not a competing job board |
| NG-06 | Template picker as primary UX | The front door is always "what are you trying to achieve?" — never "which template?" |
| NG-07 | Exposing AI provider names or model info | Hide the machinery — users care about outcomes, not engines |
| NG-08 | Generic/unconstrained image Q&A | Photos are context for producing a document only |
| NG-09 | Building standalone mini-apps | Interactivity exists only as completion scaffolding for a generated outcome |
| NG-10 | Broad life-admin scope in V1 | Personal track V1 = checklists and action plans for clearly scoped life events only |

---

## 1.9 Risks and Assumptions

### Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| R-01 | AI output quality is inconsistent across template types | High | High | Deterministic Domain Engine owns structure; AI writes into it, not around it. Manual QA on all 22 templates before launch |
| R-02 | PDF/Word export pipeline is harder than expected | Medium | High | Scope clearly: server-side render via Edge Function; chart specs rendered server-side. No client-side PDF hacks |
| R-03 | App Store rejection due to AI content concerns | Medium | High | Follow G7 checklist exactly. Supply demo credentials. Report-a-concern mechanism in-app |
| R-04 | Cost of AI API calls at scale | Medium | High | Fair-use ceilings per plan; AI-cost monitoring; usage ledger enforcement. Read from config |
| R-05 | Australian employment-law accuracy | Low | High | Documents are templates, not legal advice. Tiered disclaimers. Fair Work references reviewed |
| R-06 | Users abandon before export (low completion rate) | High | High | Streaming preview, section progress indicators, "nothing is lost" autosave, TED leads at every step |
| R-07 | Business adoption slower than individual | Medium | Medium | Job seeker bundle is V1 viral hook; business is the monetisation target. Validate pricing in beta |
| R-08 | Photo OCR misread produces wrong document | Medium | Medium | Confirm-what-I-read on every photo before drafting |
| R-09 | RevenueCat + Stripe + Apple IAP sync complexity | Medium | Medium | Use RevenueCat as the single entitlement source of truth; Supabase ledger is downstream of it |
| R-10 | Accessibility not passing App Store review | Low | High | Verify 17pt floor, AA contrast, VoiceOver before submission |

### Assumptions

| # | Assumption | If wrong |
|---|-----------|---------|
| A-01 | Supabase Edge Functions can render PDF/Word server-side via a library such as Puppeteer or docx | Use a dedicated render microservice if Edge Function limits are hit |
| A-02 | Three AI providers (OpenAI, Anthropic, Google) are all available and have stable APIs at launch | The gateway allows dropping to two providers; add the third once stable |
| A-03 | RevenueCat supports both Stripe web and Apple IAP for the same product | This is a documented RevenueCat capability; verify against current RevenueCat SDK |
| A-04 | Australian Privacy Act compliance does not require a local data residency requirement for Supabase | Confirm with legal; Supabase has AU region (ap-southeast-2) |
| A-05 | Netlify + Supabase is the correct production stack for web (not a dedicated Next.js server) | If SSR is needed for SEO or performance, introduce Next.js; not required for V1 |
| A-06 | The existing Netlify proxy routes (`/api/*`) are sufficient to keep provider keys server-side | Confirmed by existing architecture; do not expose keys to client |
| A-07 | ~22 templates are sufficient for a credible V1 launch | Validate in beta; add the most-requested Appendix 2 templates first |

---

## 1.10 Success Metrics

### North-star metric

**Outcome completion rate** — the share of started situations that reach an exported, approved result.  
Target: 40% in first 30 days; 60% at 90 days.  
Documents generated is a vanity metric and is explicitly not the target.

### Primary metrics

| Metric | Definition | V1 Target |
|--------|-----------|-----------|
| Completion rate | % started → exported | 40% at day 30 |
| Recommendation acceptance rate | % users who accept TED's recommendation without adjusting | >70% |
| Section approval rate | % sections approved before export | >80% |
| Business repeat usage | Documents per business account per week | >3/week by day 60 |
| Subscription conversion | % free users who subscribe after first export | >15% |

### Secondary metrics

| Metric | Definition |
|--------|-----------|
| Time to first export | Median minutes from session start to first PDF/Word download |
| Abandon rate by stage | Where users drop off (after recommendation? After draft? In workspace?) |
| Bundle completion rate | % of bundles where all documents are exported |
| Checklist completion rate | % of checklist items ticked over 30 days |
| AI edit usage | % of workspace sessions that use "Edit with TED" |

### Failure indicators

- Outcome completion rate below 20% at 30 days
- Users generating text but not reaching export
- Users confused about what to do next (support tickets, drop-off at workspace entry)
- Business accounts not generating more than 1 document per week
- App Store rejection for any reason in the G7 checklist

## 1.11 Operating Model

Product decisions remain accountable to the founder and the people explicitly
assigned to product, document quality, engineering, trust, and customer support.
TED is the single product-facing intelligence; internal responsibilities do not
create additional personas or voices in the user experience.

---

## Phase 1 Review

**Complete:** Vision, target users, problems, value proposition, use cases, MVP scope, future scope, non-goals, risks, metrics.  
**Internally consistent:** All scope decisions trace back to the governing doctrine ("the competitor is confusion, not ChatGPT").  
**No conflicts:** Non-goals, explicitly parked items, and V2/V3 deferrals are clear and do not overlap with V1 scope.  
**Ready for Phase 2:** Yes.
