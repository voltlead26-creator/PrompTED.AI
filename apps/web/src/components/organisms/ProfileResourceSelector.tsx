"use client";

import { TCheck } from "@/components/atoms/TCheck";
import {
  getProfileResourceAvailability,
  type ProfilePersonalResourceKey,
  type ProfileResourceSnapshot,
  type ProfileResumeSlot,
} from "@/lib/profile-resources";
import {
  normaliseProfileResourceSelection,
  type ProfileResourceSelection,
} from "@/lib/profile-resource-selection";
import styles from "./ProfileResourceSelector.module.css";

const PERSONAL_ITEMS: Array<{
  key: ProfilePersonalResourceKey;
  label: string;
  description: string;
}> = [
  { key: "fullName", label: "Full name", description: "Use the full name saved in Profile." },
  {
    key: "preferredName",
    label: "Preferred name",
    description: "Use the name TED should address you by.",
  },
  {
    key: "dateOfBirth",
    label: "Date of birth",
    description: "Use only when this workflow genuinely needs your date of birth.",
  },
  {
    key: "address",
    label: "Address",
    description: "Use the saved address parts required by this workflow.",
  },
  { key: "email", label: "Email", description: "Use your signed-in account email." },
  {
    key: "phone",
    label: "Contact number",
    description: "Use the contact number saved in Profile.",
  },
];

interface ProfileResourceSelectorProps {
  snapshot: ProfileResourceSnapshot;
  value: ProfileResourceSelection;
  onChange: (next: ProfileResourceSelection) => void;
  includeResumeResources?: boolean;
  heading?: string;
  description?: string;
}

export function ProfileResourceSelector({
  snapshot,
  value,
  onChange,
  includeResumeResources = false,
  heading = "Use saved Profile information",
  description = "Choose what TED may use for this workflow. Unticked information stays private to Profile.",
}: ProfileResourceSelectorProps) {
  const availability = getProfileResourceAvailability(snapshot);
  const selected = new Set(value.personal);

  function togglePersonal(key: ProfilePersonalResourceKey, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(key);
    else next.delete(key);
    onChange(normaliseProfileResourceSelection(next, value.resume));
  }

  function toggleResume(slot: ProfileResumeSlot, checked: boolean) {
    onChange(normaliseProfileResourceSelection(selected, checked ? slot : null));
  }

  return (
    <section className={styles.selector} aria-labelledby="profile-resource-selector-heading">
      <header className={styles.header}>
        <div>
          <h2 id="profile-resource-selector-heading">{heading}</h2>
          <p>{description}</p>
        </div>
        <span className={styles.sessionBadge}>This workflow only</span>
      </header>

      <div className={styles.group}>
        <h3>Personal information</h3>
        <div className={styles.checkGrid}>
          {PERSONAL_ITEMS.map((item) => {
            const available = availability.personal[item.key];
            return (
              <TCheck
                key={item.key}
                label={item.label}
                description={item.description}
                statusText={available ? undefined : "Not saved"}
                checked={available && selected.has(item.key)}
                disabled={!available}
                compact
                onChange={(checked) => togglePersonal(item.key, checked)}
              />
            );
          })}
        </div>
      </div>

      {includeResumeResources ? (
        <div className={styles.group}>
          <h3>Saved resources</h3>
          <div className={styles.checkGrid}>
            <TCheck
              label="Current resume"
              description="Use the active master resume saved in Profile."
              statusText={availability.currentResume ? undefined : "Not saved"}
              checked={availability.currentResume && value.resume === "current"}
              disabled={!availability.currentResume}
              compact
              onChange={(checked) => toggleResume("current", checked)}
            />
            <TCheck
              label="Previous resume"
              description="Use the immediately previous accepted master resume instead."
              statusText={availability.previousResume ? undefined : "Not saved"}
              checked={availability.previousResume && value.resume === "previous"}
              disabled={!availability.previousResume}
              compact
              onChange={(checked) => toggleResume("previous", checked)}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
