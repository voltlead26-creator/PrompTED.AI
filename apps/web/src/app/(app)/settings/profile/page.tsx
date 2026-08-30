"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/atoms/Button";
import { Icon } from "@/components/atoms/Icon";
import { Input } from "@/components/atoms/Input";
import { Spinner } from "@/components/atoms/Spinner";
import { useToast } from "@/components/atoms/Toast";
import { useAuth } from "@/components/providers";
import { ensureApiConfigured } from "@/lib/api";
import {
  createResumeDownloadUrl,
  fetchProfileResources,
  restorePreviousResume,
  saveProfileDetails,
  uploadMasterResume,
  type ProfileDetails,
  type ProfileResourceSnapshot,
  type ProfileResumeResource,
} from "@/lib/profile-resources";
import styles from "./ProfilePage.module.css";

const EMPTY_DETAILS: ProfileDetails = {
  fullName: "",
  preferredName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  addressLine1: "",
  addressLine2: "",
  suburb: "",
  state: "",
  postcode: "",
  country: "Australia",
};

function formatAcceptedDate(value: string): string {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatBytes(value: number | null): string | null {
  if (!value || value <= 0) return null;
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function sourceLabel(resource: ProfileResumeResource): string {
  switch (resource.sourceKind) {
    case "ted_update":
      return "Updated with TED";
    case "tailored_promotion":
      return "Promoted from tailored resume";
    case "restore":
      return "Restored version";
    default:
      return "Uploaded by you";
  }
}

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [snapshot, setSnapshot] = useState<ProfileResourceSnapshot | null>(null);
  const [details, setDetails] = useState<ProfileDetails>(EMPTY_DETAILS);
  const [savedDetails, setSavedDetails] = useState<ProfileDetails>(EMPTY_DETAILS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(details) !== JSON.stringify(savedDetails),
    [details, savedDetails],
  );
  const today = useMemo(
    () => new Intl.DateTimeFormat("en-CA").format(new Date()),
    [],
  );

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchProfileResources();
      setSnapshot(next);
      setDetails(next.details);
      setSavedDetails(next.details);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "TED couldn't load your Profile.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/sign-in");
      return;
    }
    void reload();
    // reload is intentionally called once after auth resolves for this mounted user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id, router]);

  function update<K extends keyof ProfileDetails>(key: K, value: ProfileDetails[K]) {
    setDetails((current) => ({ ...current, [key]: value }));
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await saveProfileDetails(details);
      setSavedDetails(details);
      setSnapshot((current) => (current ? { ...current, details } : current));
      showToast({ message: "Profile saved.", tone: "success" });
    } catch (caught) {
      showToast({
        message: caught instanceof Error ? caught.message : "Your Profile couldn't be saved.",
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  function resetChanges() {
    setDetails(savedDetails);
  }

  async function handleResumeUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || uploading) return;
    setUploading(true);
    try {
      ensureApiConfigured();
      await uploadMasterResume(file);
      await reload();
      showToast({
        message: "Current resume updated. Your previous version is still available.",
        tone: "success",
      });
    } catch (caught) {
      showToast({
        message: caught instanceof Error ? caught.message : "TED couldn't save that resume.",
        tone: "error",
      });
    } finally {
      setUploading(false);
    }
  }

  async function openResume(resource: ProfileResumeResource, download = false) {
    try {
      const url = await createResumeDownloadUrl(resource);
      if (download) {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = resource.fileName;
        anchor.rel = "noopener";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (caught) {
      showToast({
        message: caught instanceof Error ? caught.message : "TED couldn't open that resume file.",
        tone: "error",
      });
    }
  }

  async function confirmRestore() {
    if (!snapshot?.previousResume || restoring) return;
    setRestoring(true);
    try {
      await restorePreviousResume();
      setRestoreConfirm(false);
      await reload();
      showToast({ message: "Previous resume restored as Current.", tone: "success" });
    } catch (caught) {
      showToast({
        message: caught instanceof Error ? caught.message : "TED couldn't restore that resume.",
        tone: "error",
      });
    } finally {
      setRestoring(false);
    }
  }

  if (authLoading || (loading && !snapshot && !error)) {
    return (
      <section className={styles.page} aria-labelledby="profile-heading">
        <h1 id="profile-heading" className="sr-only">
          Profile
        </h1>
        <div className={styles.loadingCard}>
          <Spinner label="Loading your Profile" />
        </div>
      </section>
    );
  }

  if (!user) return null;

  if (error && !snapshot) {
    return (
      <section className={styles.page} aria-labelledby="profile-heading">
        <div className={styles.errorCard} role="alert">
          <h1 id="profile-heading" className={styles.heading}>
            Profile
          </h1>
          <p>{error}</p>
          <Button onClick={() => void reload()}>Try again</Button>
        </div>
      </section>
    );
  }

  const currentResume = snapshot?.currentResume ?? null;
  const previousResume = snapshot?.previousResume ?? null;

  return (
    <section className={styles.page} aria-labelledby="profile-heading">
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>Your trusted TED resources</p>
          <h1 id="profile-heading" className={styles.heading}>
            Profile
          </h1>
          <p className={styles.intro}>
            Keep the personal information and master resume you want ready for TED. Other workflows
            only use saved Profile resources when you select them.
          </p>
        </div>
        <div className={styles.saveState} aria-live="polite">
          {saving ? "Saving changes…" : dirty ? "Unsaved changes" : "Profile up to date"}
        </div>
      </header>

      <div className={styles.layout}>
        <form className={styles.mainColumn} onSubmit={handleSave} aria-label="Edit Profile details">
          <section className={styles.card} aria-labelledby="personal-details-heading">
            <header className={styles.cardHeader}>
              <div>
                <h2 id="personal-details-heading">Personal details</h2>
                <p>Reusable facts TED can offer back to you when a workflow needs them.</p>
              </div>
            </header>

            <div className={styles.fieldGrid}>
              <Input
                label="Full name"
                autoComplete="name"
                value={details.fullName}
                maxLength={200}
                onChange={(event) => update("fullName", event.target.value)}
                hint="Your full legal or professional name."
              />
              <Input
                label="Preferred name"
                autoComplete="nickname"
                value={details.preferredName}
                maxLength={160}
                onChange={(event) => update("preferredName", event.target.value)}
                hint="How TED should address you."
              />
              <Input
                label="Email"
                type="email"
                value={details.email}
                disabled
                hint="Your signed-in account email is the trusted Profile email."
              />
              <Input
                label="Contact number"
                type="tel"
                autoComplete="tel"
                value={details.phone}
                maxLength={80}
                onChange={(event) => update("phone", event.target.value)}
              />
              <Input
                label="Date of birth"
                type="date"
                autoComplete="bday"
                value={details.dateOfBirth}
                max={today}
                onChange={(event) => update("dateOfBirth", event.target.value)}
                hint="Only offered to workflows where it is genuinely relevant."
              />
            </div>
          </section>

          <section className={styles.card} aria-labelledby="address-heading">
            <header className={styles.cardHeader}>
              <div>
                <h2 id="address-heading">Address</h2>
                <p>Stored in parts so TED can use only the pieces a document actually needs.</p>
              </div>
            </header>

            <div className={styles.fieldGrid}>
              <Input
                className={styles.fullWidth}
                label="Address line 1"
                autoComplete="address-line1"
                value={details.addressLine1}
                maxLength={240}
                onChange={(event) => update("addressLine1", event.target.value)}
              />
              <Input
                className={styles.fullWidth}
                label="Address line 2"
                autoComplete="address-line2"
                value={details.addressLine2}
                maxLength={240}
                onChange={(event) => update("addressLine2", event.target.value)}
                hint="Optional."
              />
              <Input
                label="Suburb / locality"
                autoComplete="address-level2"
                value={details.suburb}
                maxLength={160}
                onChange={(event) => update("suburb", event.target.value)}
              />
              <Input
                label="State / territory"
                autoComplete="address-level1"
                value={details.state}
                maxLength={160}
                onChange={(event) => update("state", event.target.value)}
              />
              <Input
                label="Postcode"
                autoComplete="postal-code"
                value={details.postcode}
                maxLength={40}
                onChange={(event) => update("postcode", event.target.value)}
              />
              <Input
                label="Country"
                autoComplete="country-name"
                value={details.country}
                maxLength={160}
                onChange={(event) => update("country", event.target.value)}
              />
            </div>

            <div className={styles.formActions}>
              <Button
                variant="ghost"
                type="button"
                disabled={!dirty || saving}
                onClick={resetChanges}
              >
                Discard changes
              </Button>
              <Button
                type="submit"
                loading={saving}
                loadingLabel="Saving Profile"
                disabled={!dirty}
              >
                Save Profile
              </Button>
            </div>
          </section>
        </form>

        <aside className={styles.sideColumn} aria-label="Saved Profile resources">
          <section className={styles.card} aria-labelledby="resume-resources-heading">
            <header className={styles.cardHeader}>
              <div>
                <h2 id="resume-resources-heading">Master resume</h2>
                <p>TED keeps your Current version and one Previous version available.</p>
              </div>
            </header>

            <input
              ref={fileRef}
              className={styles.hiddenInput}
              type="file"
              accept=".pdf,.docx,.txt,.md,.csv"
              onChange={handleResumeUpload}
              tabIndex={-1}
              aria-hidden="true"
            />

            {currentResume ? (
              <article className={styles.resourceCard}>
                <div className={styles.resourceTop}>
                  <div>
                    <h3>Current resume</h3>
                    <p className={styles.resourceName}>{currentResume.fileName}</p>
                  </div>
                  <span className={styles.slotBadge}>Current</span>
                </div>
                <div className={styles.resourceMeta}>
                  <span>{sourceLabel(currentResume)}</span>
                  <span>{formatAcceptedDate(currentResume.acceptedAt)}</span>
                  {formatBytes(currentResume.fileSizeBytes) ? (
                    <span>{formatBytes(currentResume.fileSizeBytes)}</span>
                  ) : null}
                </div>
                <div className={styles.resourceActions}>
                  <Button variant="ghost" size="sm" onClick={() => void openResume(currentResume)}>
                    Open
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void openResume(currentResume, true)}
                  >
                    Download
                  </Button>
                  <Button
                    size="sm"
                    loading={uploading}
                    loadingLabel="Reading resume"
                    onClick={() => fileRef.current?.click()}
                    leadingIcon={<Icon name="upload" size={17} />}
                  >
                    Replace Current
                  </Button>
                </div>
              </article>
            ) : (
              <div className={styles.emptyResume}>
                <strong>No Current resume saved</strong>
                <p>
                  Upload your master resume once and TED can offer it as a resource in relevant
                  workflows.
                </p>
                <Button
                  loading={uploading}
                  loadingLabel="Reading resume"
                  onClick={() => fileRef.current?.click()}
                  leadingIcon={<Icon name="upload" size={17} />}
                >
                  Upload master resume
                </Button>
              </div>
            )}

            {previousResume ? (
              <article className={styles.resourceCard}>
                <div className={styles.resourceTop}>
                  <div>
                    <h3>Previous resume</h3>
                    <p className={styles.resourceName}>{previousResume.fileName}</p>
                  </div>
                  <span className={styles.slotBadge}>Previous</span>
                </div>
                <div className={styles.resourceMeta}>
                  <span>{sourceLabel(previousResume)}</span>
                  <span>{formatAcceptedDate(previousResume.acceptedAt)}</span>
                  {formatBytes(previousResume.fileSizeBytes) ? (
                    <span>{formatBytes(previousResume.fileSizeBytes)}</span>
                  ) : null}
                </div>
                <div className={styles.resourceActions}>
                  <Button variant="ghost" size="sm" onClick={() => void openResume(previousResume)}>
                    Open
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void openResume(previousResume, true)}
                  >
                    Download
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setRestoreConfirm(true)}>
                    Restore as Current
                  </Button>
                </div>
                {restoreConfirm ? (
                  <div
                    className={styles.confirmBox}
                    role="group"
                    aria-label="Confirm resume restore"
                  >
                    <p>Make this Previous resume your Current master resume?</p>
                    <div className={styles.confirmActions}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRestoreConfirm(false)}
                        disabled={restoring}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        loading={restoring}
                        loadingLabel="Restoring resume"
                        onClick={() => void confirmRestore()}
                      >
                        Restore resume
                      </Button>
                    </div>
                  </div>
                ) : null}
              </article>
            ) : currentResume ? (
              <div className={styles.emptyResume}>
                <strong>No Previous resume yet</strong>
                <p>
                  Your existing Current resume will move here the next time you replace or accept an
                  updated master version.
                </p>
              </div>
            ) : null}
          </section>

          <section className={styles.helperCard} aria-labelledby="profile-use-heading">
            <div>
              <h2 id="profile-use-heading">How TED uses Profile</h2>
              <p>Saving information here does not give every workflow automatic access to it.</p>
            </div>
            <ul className={styles.helperPoints}>
              <li>
                <span className={styles.helperMark}>T</span>
                <span>Relevant workflows show one simple T-check resource list.</span>
              </li>
              <li>
                <span className={styles.helperMark}>T</span>
                <span>You choose which saved facts or resume version TED may use.</span>
              </li>
              <li>
                <span className={styles.helperMark}>T</span>
                <span>
                  Unticked required facts can be entered manually or left as an interactive
                  placeholder.
                </span>
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </section>
  );
}
