import { ingestUpload } from "@prompted/shared/api-client";
import { UPLOAD_REQUIREMENT } from "@prompted/shared/ingest-upload";
import type { OwnerDispatchLease } from "@/lib/browser-principal-state";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";

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

export async function fetchProfileResources(
  lease: OwnerDispatchLease,
  email = "",
): Promise<ProfileResourceSnapshot> {
  const [profileResult, resumeResult] = await withOwnerSupabase(lease, async (supabase) =>
    await Promise.all([
      supabase
        .from("profiles")
        .select(
          "display_name, full_name, preferred_name, phone, date_of_birth, address_line_1, address_line_2, suburb, state, postcode, country",
        )
        .eq("id", lease.expectedUserId)
        .single(),
      supabase
        .from("profile_resume_versions")
        .select(
          "id, upload_id, slot, accepted_at, source_kind, uploads!inner(file_name, file_type, file_size_bytes, storage_path, extracted_text)",
        )
        .eq("user_id", lease.expectedUserId)
        .order("accepted_at", { ascending: false }),
    ]),
  );

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
      email,
    ),
    currentResume: resumes.find((row) => row.slot === "current") ?? null,
    previousResume: resumes.find((row) => row.slot === "previous") ?? null,
  };
}

export async function saveProfileDetails(
  details: ProfileDetails,
  lease: OwnerDispatchLease,
): Promise<void> {
  const preferred = details.preferredName.trim();
  const fullName = details.fullName.trim();
  const { error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.rpc("update_own_profile_details", {
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
    }),
  );

  if (error) {
    throw new ProfileResourceError("save_failed", "Your Profile couldn't be saved. Your existing details are unchanged.");
  }
}

export async function promoteMasterResume(
  uploadId: string,
  lease: OwnerDispatchLease,
  sourceKind: ProfileResumeSourceKind = "upload",
): Promise<void> {
  const { error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.rpc("promote_profile_resume", {
      p_upload_id: uploadId,
      p_source_kind: sourceKind,
    }),
  );
  if (error) {
    throw new ProfileResourceError("promote_failed", "The resume was read, but TED couldn't make it your Current resume.");
  }
}

export async function uploadMasterResume(file: File, lease: OwnerDispatchLease): Promise<void> {
  let result: Awaited<ReturnType<typeof ingestUpload>>;
  try {
    result = await ingestUpload(
      file,
      "Save this as my master resume resource. Extract readable resume text while retaining the original file for Profile use.",
      lease,
    );
  } catch {
    throw new ProfileResourceError("upload_failed", `TED couldn't read that resume. ${UPLOAD_REQUIREMENT}`);
  }

  if (!String(result.extracted_text ?? "").trim()) {
    throw new ProfileResourceError("resume_empty", "TED couldn't find readable resume text, so your Current resume was not changed.");
  }

  lease.assertCurrent();
  await promoteMasterResume(result.upload_id, lease, "upload");
}

export async function restorePreviousResume(lease: OwnerDispatchLease): Promise<void> {
  const { error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.rpc("restore_previous_profile_resume"),
  );
  if (error) {
    throw new ProfileResourceError("restore_failed", "TED couldn't restore the Previous resume. Your Current resume is unchanged.");
  }
}

export async function createResumeDownloadUrl(
  resource: ProfileResumeResource,
  lease: OwnerDispatchLease,
): Promise<string> {
  if (!resource.storagePath || resource.storagePath.startsWith("unretained/")) {
    throw new ProfileResourceError("download_failed", "The original file isn't available for download.");
  }
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.storage.from("original-documents").createSignedUrl(resource.storagePath, 60),
  );
  if (error || !data?.signedUrl) {
    throw new ProfileResourceError("download_failed", "TED couldn't prepare that resume file for download.");
  }
  return data.signedUrl;
}
