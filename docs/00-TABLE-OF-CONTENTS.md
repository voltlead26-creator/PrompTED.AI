# PrompTED — Master Documentation Index

**Product:** PrompTED · **Company:** TED AI · **Persona:** TED  
**Web:** littlemissscarlett.co (landing) · littlemissscarlett.co/app (application)  
**Status:** Historical pre-code documentation index · **Version:** 1.0
**Date:** June 2026

This index preserves the June 2026 pre-code planning set. It is not the current
source of truth for repository process, target architecture, implementation, or
release state. Use root `AGENTS.md` for process, `docs/CANONICAL_ARCHITECTURE.md`
for the approved target system, and current source/tests/migrations for
implementation evidence.

---

## Document Map

| File                              | Phase   | Contents                                                                 |
| --------------------------------- | ------- | ------------------------------------------------------------------------ |
| `00-TABLE-OF-CONTENTS.md`         | Index   | This document                                                            |
| `01-PHASE1-PRODUCT-DEFINITION.md` | Phase 1 | Product vision, users, problems, MVP scope, risks, metrics               |
| `02-PHASE2-SRS.md`                | Phase 2 | Full Software Requirements Specification (30 sections, requirement IDs)  |
| `03-PHASE3-ARCHITECTURE.md`       | Phase 3 | Tech stack, folder structure, component map, schema, API list, flows     |
| `04-PHASE4-UX-SYSTEM.md`          | Phase 4 | Design principles, palette, type, components, all screen layouts, states |
| `05-PHASE5-BUILD-PLAN.md`         | Phase 5 | 18-layer implementation plan with goals, files, acceptance criteria      |

---

## Full Table of Contents

### Phase 1 — Product Definition

1.1 Product Vision  
1.2 Target Users  
1.3 Main User Problems  
1.4 Core Value Proposition  
1.5 Primary Use Cases  
1.6 MVP Scope  
1.7 Future Scope  
1.8 Non-Goals  
1.9 Risks and Assumptions  
1.10 Success Metrics

### Phase 2 — Software Requirements Specification

2.1 Executive Summary  
2.2 Product Overview  
2.3 User Personas  
2.4 User Stories  
2.5 Functional Requirements (FR-001 – FR-080)  
2.6 Non-Functional Requirements (NFR-001 – NFR-030)  
2.7 System Architecture Overview  
2.8 Frontend Architecture  
2.9 Backend Architecture  
2.10 Database Design (DB-001 – DB-020)  
2.11 API Design (API-001 – API-030)  
2.12 Authentication and Authorisation (SEC-001 – SEC-010)  
2.13 AI Provider Integration (AI-001 – AI-010)  
2.14 Prompt Orchestration Layer (AI-011 – AI-020)  
2.15 Document Generation System (FR-020 – FR-035)  
2.16 Master Workspace System (UX-001 – UX-015)  
2.17 Section Editor System (UX-016 – UX-025)  
2.18 Project / History System (FR-050 – FR-055)  
2.19 Export System (FR-056 – FR-065)  
2.20 Error Handling (NFR-010 – NFR-015)  
2.21 Logging and Monitoring (NFR-016 – NFR-020)  
2.22 Security Requirements (SEC-010 – SEC-025)  
2.23 Privacy Requirements (SEC-026 – SEC-035)  
2.24 Data Retention Requirements (SEC-036 – SEC-040)  
2.25 Performance Requirements (NFR-021 – NFR-025)  
2.26 Accessibility Requirements (NFR-026 – NFR-030)  
2.27 Testing Requirements (TEST-001 – TEST-020)  
2.28 Deployment Requirements (DEP-001 – DEP-010)  
2.29 Maintenance Requirements (MAINT-001 – MAINT-010)  
2.30 Contractor Task Breakdown

### Phase 3 — Architecture

3.1 Recommended Tech Stack  
3.2 Folder Structure  
3.3 Frontend Component Map  
3.4 Backend Service Map  
3.5 Database Schema (full DDL)  
3.6 API Endpoint List  
3.7 AI Orchestration Flow  
3.8 Authentication Flow  
3.9 Document Generation Flow  
3.10 Master Workspace Flow  
3.11 Export Flow  
3.12 Error Handling Flow  
3.13 Deployment Flow

### Phase 4 — UX and UI System

4.1 Design Principles  
4.2 Colour Palette  
4.3 Typography  
4.4 Layout System  
4.5 Component Library  
4.6 Navigation Structure  
4.7 Chat Home Screen Layout  
4.8 Master Workspace Layout  
4.9 Document Editor Layout  
4.10 Project History Layout  
4.11 Settings Layout  
4.12 Empty States  
4.13 Loading States  
4.14 Error States  
4.15 Mobile Responsive Behaviour

### Phase 5 — Build Plan

Layer 1: Project Setup  
Layer 2: Design System  
Layer 3: App Shell and Routing  
Layer 4: Chat Interface  
Layer 5: AI Gateway  
Layer 6: Prompt Orchestration  
Layer 7: Output Selection Logic  
Layer 8: Master Workspace  
Layer 9: Section Editor  
Layer 10: Document Templates  
Layer 11: Export System  
Layer 12: User Accounts  
Layer 13: Project History  
Layer 14: Database Persistence  
Layer 15: Security Hardening  
Layer 16: Testing  
Layer 17: Deployment  
Layer 18: Monitoring and Maintenance

---

## Existing Codebase State (June 2026)

The repository contains a working HTML/JS prototype deployed at `littlemissscarlett.co/app`.

**What exists:**

- `index.html` — marketing/landing page (Fraunces + Hanken Grotesk, warm identity)
- `app/index.html` — app prototype (chat UI, dark/light theme, DM Sans + Syne)
- `app/prompted-supabase.js` — Supabase client init and auth helpers
- `app/prompted-*.js / *.css` — UX patches, mobile overrides, workspace prototype
- `supabase/functions/openai-chat/` — dormant historical raw chat interface (not deployed)
- `supabase/functions/openai-stream/` — dormant historical raw stream interface (not deployed)
- `supabase/functions/openai-responses/` — dormant historical raw Responses interface (not deployed)
- `supabase/functions/anthropic-messages/` — Anthropic proxy with document intelligence
- `supabase/functions/live-source/` — Web search research tool
- `supabase/migrations/` — Basic schema: profiles, documents, revision_history, export_history
- `netlify.toml` — Deploy config with API proxy routes

**What the prototype demonstrates:**

- Chat-first request flow that starts in conversation and moves into structured document work
- Adaptive preview and recommendation paths that shape the best output before editing
- Master Workspace for comparing variants, editing sections, and promoting approved content to canonical state
- Revision history, approval checkpoints, and export-oriented project memory
- Authenticated account-backed persistence with the provider and routing details hidden behind the product surface
- The current product identity and public-facing framing, not a demo or placeholder app

**What is not yet production-ready:**

- No structured template system (documents are freeform)
- No recommendation checkpoint (TED recommends before drafting)
- No section approval workflow
- No bundle system
- No business profile / brand kit
- No checklist/action plan system
- No PDF/Word/Excel export pipeline
- No subscription/monetisation enforcement
- No full accessibility pass
- Schema missing: businesses, bundles, outcomes, sections, checklist_items, brand_kits, subscriptions, usage_ledger
- App theme does not match SRS brand spec (should use Nunito, cream/coral/charcoal)

**Build approach:**  
The existing prototype is a valuable design reference and has working AI routing. The production build should preserve the AI gateway architecture, Supabase backend, and Netlify deployment, while rebuilding the frontend to match the SRS specification exactly. Do not ship the prototype as the production app.
