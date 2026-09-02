// =====================================================
// PrompTED — Shared Domain Types (V1)
// Mirrors the DB schema in 03-PHASE3-ARCHITECTURE.md §3.5
// =====================================================

export type UUID = string;
export type ISODateString = string;
export type Plan = "free" | "pro" | "premium" | "business";
export type SubscriptionStatus = "active" | "expired" | "cancelled" | "trialing";
export type Domain = "employment" | "education" | "business" | "personal" | "finance";
export type StructureType = "compose" | "structured_form" | "checklist";
export type AdviceBoundary = "none" | "light" | "high-stakes";
export type SectionStatus = "draft" | "edited" | "approved" | "locked";
export type DocumentStatus = "draft" | "edited" | "approved" | "exported" | "archived";
export type OutcomeStatus = "draft" | "in_progress" | "completed";
export type ReadingLevel = "simple" | "moderate" | "detailed";
export type Tone = "casual" | "professional";
export type DetailLevel = "low" | "medium" | "high";
export type MembershipRole = "admin" | "member";
export type UsageLedgerEventType = "document_created" | "ai_edit";

export interface Profile {
  id: UUID;
  display_name: string | null;
  avatar_url: string | null;
  plan: Plan;
  phone: string | null;
  business_id: UUID | null;
  acknowledged_advice_boundaries: string[];
  memory_context: string[];
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface Business {
  id: UUID;
  owner_user_id: UUID;
  trading_name: string;
  legal_name: string | null;
  abn: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  industry: string | null;
  voice_descriptor: string | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface Membership {
  id: UUID;
  business_id: UUID;
  user_id: UUID;
  role: MembershipRole;
  created_at: ISODateString;
}

export interface ClariPreferences {
  id: UUID;
  user_id: UUID;
  reading_level: ReadingLevel;
  tone: Tone;
  detail_level: DetailLevel;
  updated_at: ISODateString;
}

export interface TemplateSection {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
}

export interface Template {
  id: UUID;
  name: string;
  domain: Domain;
  category: string;
  plain_description: string;
  structure_type: StructureType;
  sections: TemplateSection[];
  fields: Record<string, unknown>[];
  missing_detail_rules: Record<string, unknown>[];
  fill_from_profile: Record<string, string>;
  recommendation_reason: string | null;
  related_document_ids: UUID[];
  advice_boundary: AdviceBoundary;
  brandable: boolean;
  flags: Record<string, unknown>;
  is_published: boolean;
  display_order: number;
  created_at: ISODateString;
}

export interface Bundle {
  id: UUID;
  name: string;
  description: string | null;
  domain: Domain;
  template_ids: UUID[];
  checklist_template_id: UUID | null;
  display_order: number;
  is_published: boolean;
  created_at: ISODateString;
}

export interface ConversationMessage {
  role: "user" | "ted";
  text: string;
}

export interface RecommendationPayload {
  primary: { template_id: UUID; reason: string };
  alternatives: Array<{ template_id: UUID; reason: string }>;
  bundle_id?: UUID;
  conversation?: ConversationMessage[];
  situation?: string;
  conversation_context?: string;
  upload_context?: string;
  upload_id?: UUID;
}

export interface Outcome {
  id: UUID;
  user_id: UUID;
  business_id: UUID | null;
  bundle_id: UUID | null;
  situation_text: string;
  recommendation_payload: RecommendationPayload | null;
  status: OutcomeStatus;
  is_saved: boolean;
  /** Monotonic CAS token for the conversation-owned payload fields. */
  conversation_revision?: number;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export type SectionVersionOrigin = "imported_original" | "user_edit" | "ted_edit" | "restore" | "system";

export interface SectionVersion {
  content: string;
  saved_at: ISODateString;
  /** Plain-English reason shown to the user in version history. */
  label?: string;
  /** Where this version came from, for trust and auditability. */
  origin?: SectionVersionOrigin;
}

export interface DocumentNeutralReplacementOption {
  id: string;
  label: string;
  value: string;
  suitability: string;
  clearsExportWarning: boolean;
  regenerateSurroundingWording: boolean;
}

export interface DocumentPlaceholderMetadata {
  id: string;
  profileKey: string;
  sectionKey: string;
  informationKey: string;
  label: string;
  question: string;
  factType: string;
  automaticFallback?: string;
  requiredForExport: boolean;
  sharedResolutionKey?: string;
  neutralReplacementOptions: DocumentNeutralReplacementOption[];
}

export interface Section {
  key?: string;
  id: UUID;
  document_id: UUID;
  user_id: UUID;
  name: string;
  order_index: number;
  content: string;
  status: SectionStatus;
  version_history: SectionVersion[];
  is_required: boolean;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface Document {
  id: UUID;
  user_id: UUID;
  outcome_id: UUID | null;
  template_id: UUID | null;
  title: string;
  status: DocumentStatus;
  is_template: boolean;
  unresolved_placeholders?: DocumentPlaceholderMetadata[];
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface Upload {
  id: UUID;
  user_id: UUID;
  outcome_id: UUID | null;
  storage_path: string;
  file_type: string;
  file_name: string;
  file_size_bytes: number | null;
  extracted_text: string | null;
  extracted_payload: Record<string, unknown> | null;
  created_at: ISODateString;
}

export interface ChecklistItem {
  id: UUID;
  outcome_id: UUID;
  user_id: UUID;
  text: string;
  due_date: string | null;
  reason: string | null;
  done: boolean;
  reminder_offset_days: number | null;
  reminder_sent: boolean;
  order_index: number;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/** Database-backed checklist revision identity. Guest/device items deliberately
 * remain plain ChecklistItem values until they are imported into Supabase. */
export interface PersistedChecklistItem extends ChecklistItem {
  mutation_token: UUID;
}

export interface BrandKit {
  id: UUID;
  business_id: UUID;
  logo_url: string | null;
  primary_colour: string;
  secondary_colour: string | null;
  footer_text: string | null;
  revision: number;
  logo_operation_id: UUID | null;
  logo_storage_path: string | null;
  logo_content_sha256: string | null;
  logo_media_type: "image/png" | "image/jpeg" | "image/webp" | null;
  logo_byte_length: number | null;
  logo_status: "ready" | "legacy_unverified" | "reconciliation_required";
  updated_at: ISODateString;
}

export interface CompanyProfile {
  id: UUID;
  business_id: UUID;
  section_key: string;
  content: string;
  updated_at: ISODateString;
}

export interface Subscription {
  id: UUID;
  user_id: UUID;
  plan: Plan;
  status: SubscriptionStatus;
  provider: string | null;
  provider_customer_id: string | null;
  provider_entitlement_id: string | null;
  current_period_end: ISODateString | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}
