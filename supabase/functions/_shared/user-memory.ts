// =====================================================
// PrompTED — User memory context
// Loads and appends persisted memory snippets for prompt reuse.
// =====================================================

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function dedupe(notes: string[]): string[] {
  return Array.from(new Set(notes.map((note) => note.trim()).filter(Boolean)));
}

function joinNotes(title: string, notes: string[]): string {
  if (notes.length === 0) return "";
  return `${title}:\n${notes.map((note) => `- ${note}`).join("\n")}`;
}

interface ProfileRow {
  id: string;
  display_name: string | null;
  phone: string | null;
  business_id: string | null;
  memory_context: unknown;
}

interface BusinessRow {
  trading_name: string | null;
  legal_name: string | null;
  industry: string | null;
  voice_descriptor: string | null;
}

interface CompanyProfileRow {
  voice_tone: string | null;
  reusable_clauses: unknown;
  extra_fields: Record<string, unknown> | null;
  memory_context: unknown;
}

export async function ownedBusinessId(
  admin: SupabaseClient,
  userId: string,
  requestedBusinessId: string | null | undefined,
): Promise<string | null> {
  if (!requestedBusinessId) return null;

  const { data, error } = await admin
    .from("businesses")
    .select("id")
    .eq("id", requestedBusinessId)
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (error) return null;
  return typeof data?.id === "string" ? data.id : null;
}

export async function loadUserMemoryContext(
  admin: SupabaseClient,
  userId: string,
): Promise<string> {
  if (!userId || userId === "anonymous") return "";

  const { data: profile } = await admin
    .from("profiles")
    .select("id, display_name, phone, business_id, memory_context")
    .eq("id", userId)
    .maybeSingle();

  const notes: string[] = [];

  if (profile?.display_name) {
    notes.push(`Preferred display name: ${profile.display_name}`);
  }
  if (profile?.phone) {
    notes.push(`Phone: ${profile.phone}`);
  }
  notes.push(...asStringArray(profile?.memory_context));

  const businessId = await ownedBusinessId(
    admin,
    userId,
    (profile as ProfileRow | null | undefined)?.business_id,
  );
  if (businessId) {
    const { data: business } = await admin
      .from("businesses")
      .select("trading_name, legal_name, industry, voice_descriptor")
      .eq("id", businessId)
      .maybeSingle();

    const businessRow = business as BusinessRow | null | undefined;
    if (businessRow?.trading_name) {
      notes.push(`Business name: ${businessRow.trading_name}`);
    }
    if (businessRow?.legal_name) {
      notes.push(`Legal business name: ${businessRow.legal_name}`);
    }
    if (businessRow?.industry) {
      notes.push(`Business industry: ${businessRow.industry}`);
    }
    if (businessRow?.voice_descriptor) {
      notes.push(`Business voice descriptor: ${businessRow.voice_descriptor}`);
    }

    const { data: company } = await admin
      .from("company_profile")
      .select("voice_tone, reusable_clauses, extra_fields, memory_context")
      .eq("business_id", businessId)
      .maybeSingle();

    const companyRow = company as CompanyProfileRow | null | undefined;
    if (companyRow?.voice_tone) {
      notes.push(`Business voice tone: ${companyRow.voice_tone}`);
    }

    const clauses = Array.isArray(companyRow?.reusable_clauses)
      ? companyRow.reusable_clauses as Array<Record<string, unknown>>
      : [];
    for (const clause of clauses) {
      const label = typeof clause?.label === "string" ? clause.label.trim() : "";
      const text = typeof clause?.text === "string" ? clause.text.trim() : "";
      if (label && text) notes.push(`${label}: ${text}`);
    }

    notes.push(...asStringArray(companyRow?.memory_context));

    const uploadMemory = companyRow?.extra_fields?.upload_memory;
    notes.push(...asStringArray(uploadMemory));
  }

  const unique = dedupe(notes).slice(0, 20);
  return joinNotes("Persisted user memory", unique);
}

async function updateMemoryList(
  existing: unknown,
  additions: string[],
): Promise<string[]> {
  return dedupe([...asStringArray(existing), ...additions]).slice(0, 20);
}

export async function appendUserMemoryContext(
  admin: SupabaseClient,
  userId: string,
  additions: string[],
): Promise<void> {
  const cleaned = dedupe(additions).slice(0, 10);
  if (!userId || userId === "anonymous" || cleaned.length === 0) return;

  const { data: profile } = await admin
    .from("profiles")
    .select("business_id, memory_context")
    .eq("id", userId)
    .maybeSingle();

  const profileRow = profile as Pick<ProfileRow, "business_id" | "memory_context"> | null | undefined;
  const nextProfileMemory = await updateMemoryList(profileRow?.memory_context, cleaned);
  await admin
    .from("profiles")
    .update({ memory_context: nextProfileMemory, updated_at: new Date().toISOString() })
    .eq("id", userId);

  const businessId = await ownedBusinessId(admin, userId, profileRow?.business_id);
  if (!businessId) return;

  const { data: company } = await admin
    .from("company_profile")
    .select("memory_context")
    .eq("business_id", businessId)
    .maybeSingle();

  const companyRow = company as Pick<CompanyProfileRow, "memory_context"> | null | undefined;
  const nextCompanyMemory = await updateMemoryList(companyRow?.memory_context, cleaned);
  await admin
    .from("company_profile")
    .upsert(
      {
        business_id: businessId,
        memory_context: nextCompanyMemory,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id" },
    );
}
