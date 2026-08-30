import { ingestUpload } from "@prompted/shared/api-client";
import { createClient } from "@/lib/supabase/client";

export type ProfileResumeSlot = "current" | "previous";
export type ProfileResumeSourceKind = "upload" | "ted_update" | "tailored_promotion" | "restore";

export interface ProfileDetails {
  fullName: string;
  preferredName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
}

export interface ProfileResumeResource {
  id: string;
  uploadId: string;
  slot: ProfileResumeSlot;
  acceptedAt: string;
  sourceKind: ProfileResumeSourceKind;
  fileName: string;
  fileType: string;
  fileSizeBytes: number | null;
  storagePath: string;
  extractedText: string;
}

export interface ProfileResourceSnapshot {
  details: ProfileDetails;
  currentResume: ProfileResumeResource | null;
  previousResume: ProfileResumeResource | null;
}

export type ProfilePersonalResourceKey =
  | "fullName"
  | "preferredName"
  | "dateOfBirth"
  | "address"
  | "email"
  | "phone";

export interface ProfileResourceAvailability {
  personal: Record<ProfilePersonalResourceKey, boolean>;
  currentResume: boolean;
  previousResume: boolean;
}

export class ProfileResourceError extends Error {
  constructor(
    public readonly code:
      | "not_authenticated"
      | "fetch_failed"
      | "save_failed"
      | "upload_failed"
      | "resume_empty"
      | "promote_failed"
      | "restore_failed"
      | "download_failed",
    message: string,
  ) {
    super(message);
    this.name = "ProfileResourceError";
  }
}

/**
 * Resolve the current signed-in user without racing the Supabase SDK's own
 * background token-refresh timer. auth.getUser() makes a live network round
 * trip to Supabase Auth on every call; doing that immediately before a write
 * can collide with an in-flight background refresh and invalidate the
 * session's single-use, rotating refresh token out from under the request
 * (see apps/web/src/lib/api.ts for the same fix applied to the API client's
 * token fetch). getSession() reads the locally cached session instead, and
 * we only force a refresh when it's actually at or near expiry.
 */
async function requireAuthedUser(
  supabase: ReturnType<typeof createClient>,
  message: string,
): Promise<{ id: string; email: string | null }> {
  const { data } = await supabase.auth.getSession();
  let session = data.session;

  const expiresSoon =
    !session || !session.expires_at || session.expires_at * 1000 <= Date.now() + 30_000;
  if (expiresSoon) {
    const { data: refreshed, error } = await supabase.auth.refreshSession();
    if (error || !refreshed.session) {
      throw new ProfileResourceError("not_authenticated", message);
    }
    session = refreshed.session;
  }

  if (!session?.user) {
    throw new ProfileResourceError("not_authenticated", message);
  }
  return { id: session.user.id, email: session.user.email ?? null };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normaliseSourceKind(value: unknown): ProfileResumeSourceKind {
  return value === "ted_update" || value === "tailored_promotion" || value === "restore"
    ? value
    : "upload";
}

function normaliseResumeRow(row: unknown): ProfileResumeResource | null {
  if (!row || typeof row !== "object") return null;
  const input = row as Record<string, unknown>;
  const upload = input.uploads && typeof input.uploads === "object"
    ? input.uploads as Record<string, unknown>
    : null;
  const slot = input.slot === "previous" ? "previous" : input.slot === "current" ? "current" : null;
  if (!slot || !input.id || !input.upload_id || !upload) return null;
  return {
    id: String(input.id),
    uploadId: String(input.upload_id),
    slot,
    acceptedAt: clean(input.accepted_at),
    sourceKind: normaliseSourceKind(input.source_kind),
    fileName: clean(upload.file_name) || "Resume",
    fileType: clean(upload.file_type),
    fileSizeBytes: typeof upload.file_size_bytes === "number" ? upload.file_size_bytes : null,
    storagePath: clean(upload.storage_path),
    extractedText: clean(upload.extracted_text),
  };
}

export function normaliseProfileDetails(
  profile: Record<string, unknown> | null | undefined,
  email = "",
): ProfileDetails {
  return {
    fullName: clean(profile?.full_name),
    preferredName: clean(profile?.preferred_name) || clean(profile?.display_name),
    email: clean(email),
    phone: clean(profile?.phone),
    dateOfBirth: clean(profile?.date_of_birth),
    addressLine1: clean(profile?.address_line_1),
    addressLine2: clean(profile?.address_line_2),
    suburb: clean(profile?.suburb),
    state: clean(profile?.state),
    postcode: clean(profile?.postcode),
    country: clean(profile?.country),
  };
}

export function getProfileResourceAvailability(
  snapshot: ProfileResourceSnapshot,
): ProfileResourceAvailability {
  const { details } = snapshot;
  return {
    personal: {
      fullName: Boolean(details.fullName.trim()),
      preferredName: Boolean(details.preferredName.trim()),
      dateOfBirth: Boolean(details.dateOfBirth.trim()),
      address: Boolean(
        details.addressLine1.trim() || details.suburb.trim() || details.state.trim() ||
          details.postcode.trim() || details.country.trim()
      ),
      email: Boolean(details.email.trim()),
      phone: Boolean(details.phone.trim()),
    },
    currentResume: Boolean(snapshot.currentResume),
    previousResume: Boolean(snapshot.previousResume),
  };
}

export async function fetchProfileResources(): Promise<ProfileResourceSnapshot> {
  const supabase = createClient();
  const user = await requireAuthedUser(supabase, "Sign in to open your Profile.");

  const [profileResult, resumeResult] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "display_name, full_name, preferred_name, phone, date_of_birth, address_line_1, address_line_2, suburb, state, postcode, country",
      )
      .eq("id", user.id)
      .single(),
    supabase
      .from("profile_resume_versions")
      .select(
        "id, upload_id, slot, accepted_at, source_kind, uploads!inner(file_name, file_type, file_size_bytes, storage_path, extracted_text)",
      )
      .eq("user_id", user.id)
      .order("accepted_at", { ascending: false }),
  ]);

  if (profileResult.error) {
    throw new ProfileResourceError("fetch_failed", "TED couldn't load your Profile details. Please try again.");
  }
  if (resumeResult.error) {
    throw new ProfileResourceError("fetch_failed", "TED couldn't load your saved resume resources. Please try again.");
  }

  const resumes = (resumeResult.data ?? [])
    .map((row) => normaliseResumeRow(row))
    .filter((row): row is ProfileResumeResource => Boolean(row));

  return {
    details: normaliseProfileDetails(
      profileResult.data as Record<string, unknown> | null,
      user.email ?? "",
    ),
    currentResume: resumes.find((row) => row.slot === "current") ?? null,
    previousResume: resumes.find((row) => row.slot === "previous") ?? null,
  };
}

export async function saveProfileDetails(details: ProfileDetails): Promise<void> {
  const supabase = createClient();
  await requireAuthedUser(supabase, "Sign in to save your Profile.");

  const preferred = details.preferredName.trim();
  const fullName = details.fullName.trim();
  const { error } = await supabase.rpc("update_own_profile_details", {
    p_display_name: preferred || fullName || null,
    p_full_name: fullName || null,
    p_preferred_name: preferred || null,
    p_phone: details.phone.trim() || null,
    p_date_of_birth: details.dateOfBirth.trim() || null,
    p_address_line_1: details.addressLine1.trim() || null,
    p_address_line_2: details.addressLine2.trim() || null,
    p_suburb: details.suburb.trim() || null,
    p_state: details.state.trim() || null,
    p_postcode: details.postcode.trim() || null,
    p_country: details.country.trim() || null,
  });

  if (error) {
    throw new ProfileResourceError("save_failed", "Your Profile couldn't be saved. Your existing details are unchanged.");
  }
}

export async function promoteMasterResume(
  uploadId: string,
  sourceKind: ProfileResumeSourceKind = "upload",
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("promote_profile_resume", {
    p_upload_id: uploadId,
    p_source_kind: sourceKind,
  });
  if (error) {
    throw new ProfileResourceError("promote_failed", "The resume was read, but TED couldn't make it your Current resume.");
  }
}

export async function uploadMasterResume(file: File): Promise<void> {
  let result: Awaited<ReturnType<typeof ingestUpload>>;
  try {
    result = await ingestUpload(
      file,
      "Save this as my master resume resource. Extract readable resume text while retaining the original file for Profile use.",
    );
  } catch {
    throw new ProfileResourceError("upload_failed", "TED couldn't read that resume. Try a PDF, DOCX, TXT, Markdown or CSV file under 8MB.");
  }

  if (!String(result.extracted_text ?? "").trim()) {
    throw new ProfileResourceError("resume_empty", "TED couldn't find readable resume text, so your Current resume was not changed.");
  }

  await promoteMasterResume(result.upload_id, "upload");
}

export async function restorePreviousResume(): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("restore_previous_profile_resume");
  if (error) {
    throw new ProfileResourceError("restore_failed", "TED couldn't restore the Previous resume. Your Current resume is unchanged.");
  }
}

export async function createResumeDownloadUrl(resource: ProfileResumeResource): Promise<string> {
  if (!resource.storagePath || resource.storagePath.startsWith("unretained/")) {
    throw new ProfileResourceError("download_failed", "The original file isn't available for download.");
  }
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from("original-documents")
    .createSignedUrl(resource.storagePath, 60);
  if (error || !data?.signedUrl) {
    throw new ProfileResourceError("download_failed", "TED couldn't prepare that resume file for download.");
  }
  return data.signedUrl;
}
