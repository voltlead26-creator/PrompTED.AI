import type {
  ProfilePersonalResourceKey,
  ProfileResourceSnapshot,
  ProfileResumeResource,
  ProfileResumeSlot,
} from "./profile-resources";

export interface ProfileResourceSelection {
  personal: ProfilePersonalResourceKey[];
  resume: ProfileResumeSlot | null;
}

export interface SelectedAddress {
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
}

export interface SelectedProfileFacts {
  fullName?: string;
  preferredName?: string;
  dateOfBirth?: string;
  address?: SelectedAddress;
  email?: string;
  phone?: string;
}

export interface MaterializedProfileResources {
  facts: SelectedProfileFacts;
  resume: ProfileResumeResource | null;
}

export type RequiredFactResolution =
  | { kind: "manual"; value: string }
  | { kind: "placeholder"; token: string };

export function normaliseProfileResourceSelection(
  personal: Iterable<ProfilePersonalResourceKey>,
  resume: ProfileResumeSlot | null,
): ProfileResourceSelection {
  return {
    personal: Array.from(new Set(personal)),
    resume,
  };
}

export function materializeSelectedProfileResources(
  snapshot: ProfileResourceSnapshot,
  selection: ProfileResourceSelection,
): MaterializedProfileResources {
  const selected = new Set(selection.personal);
  const facts: SelectedProfileFacts = {};
  const details = snapshot.details;

  if (selected.has("fullName") && details.fullName.trim()) facts.fullName = details.fullName.trim();
  if (selected.has("preferredName") && details.preferredName.trim()) facts.preferredName = details.preferredName.trim();
  if (selected.has("dateOfBirth") && details.dateOfBirth.trim()) facts.dateOfBirth = details.dateOfBirth.trim();
  if (selected.has("email") && details.email.trim()) facts.email = details.email.trim();
  if (selected.has("phone") && details.phone.trim()) facts.phone = details.phone.trim();
  if (selected.has("address")) {
    const address: SelectedAddress = {
      addressLine1: details.addressLine1.trim(),
      addressLine2: details.addressLine2.trim(),
      suburb: details.suburb.trim(),
      state: details.state.trim(),
      postcode: details.postcode.trim(),
      country: details.country.trim(),
    };
    if (Object.values(address).some(Boolean)) facts.address = address;
  }

  const resume = selection.resume === "current"
    ? snapshot.currentResume
    : selection.resume === "previous"
      ? snapshot.previousResume
      : null;

  return { facts, resume: resume ?? null };
}

/**
 * A short "Suburb, State" style location string from a selected profile
 * address — for a job search's location field, not a full postal address.
 * Deliberately omits the street address lines (irrelevant to a search
 * radius and unnecessary to send along with every request).
 */
export function locationFromSelectedAddress(address: SelectedAddress | undefined): string {
  if (!address) return "";
  return [address.suburb, address.state, address.postcode, address.country]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

export function resolveUnselectedRequiredFact(params: {
  key: string;
  manualValue?: string;
  leaveAsPlaceholder?: boolean;
  placeholderId: string;
  placeholderLabel: string;
}): RequiredFactResolution {
  const manualValue = String(params.manualValue ?? "").trim();
  if (manualValue) return { kind: "manual", value: manualValue };
  if (params.leaveAsPlaceholder) {
    const id = params.placeholderId.trim();
    const label = params.placeholderLabel.trim();
    if (!id || !label) throw new Error(`INVALID_PROFILE_PLACEHOLDER:${params.key}`);
    return { kind: "placeholder", token: `{{TED_PLACEHOLDER:${id}:${label}}}` };
  }
  throw new Error(`PROFILE_FACT_UNRESOLVED:${params.key}`);
}
