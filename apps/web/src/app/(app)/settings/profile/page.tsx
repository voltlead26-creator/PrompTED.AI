"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import {
  preflightUploadMetadata,
  UPLOAD_ACCEPT_ATTRIBUTE,
} from "@prompted/shared/ingest-upload";
import { Button } from "@/components/atoms/Button";
import { Icon } from "@/components/atoms/Icon";
import { Input } from "@/components/atoms/Input";
import { Spinner } from "@/components/atoms/Spinner";
import { useToast } from "@/components/atoms/Toast";
import { useAuth } from "@/components/providers";
import { ensureApiConfigured } from "@/lib/api";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
  withOwnerDispatchSignal,
  type OwnerDispatchLease,
} from "@/lib/browser-principal-state";
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

type ResumeFileAction = {
  resourceId: string;
  download: boolean;
  controller: AbortController;
  popup: Window | null;
};

function isPendingResumeTab(popup: Window | null): popup is Window {
  try {
    return popup !== null && !popup.closed && popup.location.href === "about:blank";
  } catch {
    // A user-navigated, cross-origin tab is no longer ours to change or close.
    return false;
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
  const resumeActionRef = useRef<ResumeFileAction | null>(null);
  const [resumeAction, setResumeAction] = useState<ResumeFileAction | null>(null);

  useLayoutEffect(() => () => {
    const action = resumeActionRef.current;
    resumeActionRef.current = null;
    if (action) {
      action.controller.abort();
      if (isPendingResumeTab(action.popup)) action.popup.close();
    }
  }, [user?.id]);

  const dirty = useMemo(
    () => JSON.stringify(details) !== JSON.stringify(savedDetails),
    [details, savedDetails],
  );
  const today = useMemo(
    () => new Intl.DateTimeFormat("en-CA").format(new Date()),
    [],
  );

  async function reload(existingLease?: OwnerDispatchLease, preserveDetails = false): Promise<boolean> {
    if (!user?.id) return false;
    const requestContext = existingLease ?? captureOwnerDispatch(user.id);
    setLoading(true);
    try {
      const next = await fetchProfileResources(requestContext, user.email ?? "");
      requestContext.assertCurrent();
      setSnapshot(next);
      // Resume changes refresh resources without replacing personal edits or
      // the baseline of a detail save that may finish while this read is pending.
      if (!preserveDetails) {
        setDetails(next.details);
        setSavedDetails(next.details);
      }
      setError(null);
      return true;
    } catch (caught) {
      if (ownerDispatchIsCurrent(requestContext)) {
        setError(caught instanceof Error ? caught.message : "TED couldn't load your Profile.");
      }
      return false;
    } finally {
      if (ownerDispatchIsCurrent(requestContext)) setLoading(false);
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
    if (!user?.id || !dirty || saving) return;
    const requestContext = captureOwnerDispatch(user.id);
    const submittedDetails = details;
    setSaving(true);
    try {
      await saveProfileDetails(submittedDetails, requestContext);
      requestContext.assertCurrent();
      setSavedDetails(submittedDetails);
      setSnapshot((current) =>
        current ? { ...current, details: submittedDetails } : current,
      );
      showToast({ message: "Profile saved.", tone: "success" });
    } catch (caught) {
      if (ownerDispatchIsCurrent(requestContext)) {
        showToast({
          message: caught instanceof Error ? caught.message : "Your Profile couldn't be saved.",
          tone: "error",
        });
      }
    } finally {
      if (ownerDispatchIsCurrent(requestContext)) setSaving(false);
    }
  }

  function resetChanges() {
    setDetails(savedDetails);
  }

  async function handleResumeUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!user?.id || !file || uploading) return;
    const preflight = preflightUploadMetadata({
      fileName: file.name,
      mimeType: file.type,
      byteLength: file.size,
    });
    if (!preflight.ok) {
      showToast({ message: preflight.message, tone: "error" });
      return;
    }
    const requestContext = captureOwnerDispatch(user.id);
    setUploading(true);
    try {
      ensureApiConfigured();
      await uploadMasterResume(file, requestContext);
      requestContext.assertCurrent();
      const refreshed = await reload(requestContext, true);
      requestContext.assertCurrent();
      if (!refreshed) {
        showToast({ message: "Your resume change was saved, but TED couldn't refresh your saved resources. Try again below.", tone: "error" });
        return;
      }
      showToast({
        message: "Current resume updated. Your previous version is still available.",
        tone: "success",
      });
    } catch (caught) {
      if (ownerDispatchIsCurrent(requestContext)) {
        showToast({
          message: caught instanceof Error ? caught.message : "TED couldn't save that resume.",
          tone: "error",
        });
      }
    } finally {
      if (ownerDispatchIsCurrent(requestContext)) setUploading(false);
    }
  }

  async function openResume(resource: ProfileResumeResource, download = false) {
    if (!user?.id || resumeActionRef.current || loading || error || uploading || restoring) return;
    const ownerContext = captureOwnerDispatch(user.id);
    const action: ResumeFileAction = {
      resourceId: resource.id, download, controller: new AbortController(), popup: null,
    };
    const requestContext = withOwnerDispatchSignal(ownerContext, action.controller.signal);
    resumeActionRef.current = action;
    setResumeAction(action);
    let removeAbortListener = () => {};
    const timer = window.setTimeout(() => action.controller.abort(new Error(
      "Preparing the resume file took too long. Please try again.",
    )), 30_000);
    try {
      if (!download) {
        // Reserve the tab during the click's user activation, before signing.
        action.popup = window.open("about:blank", "_blank");
        if (!action.popup) {
          throw new Error("Your browser blocked the resume tab. Allow popups for this site or use Download.");
        }
        action.popup.opener = null;
        action.popup.document.title = "Opening resume";
        action.popup.document.body.textContent = "Preparing your resume file…";
      }
      const cancelled = new Promise<never>((_, reject) => {
        const abort = () => reject(requestContext.signal.reason);
        requestContext.signal.addEventListener("abort", abort, { once: true });
        removeAbortListener = () => requestContext.signal.removeEventListener("abort", abort);
        if (requestContext.signal.aborted) abort();
      });
      // Bound the UI wait even if an underlying session request ignores abort.
      const url = await Promise.race([createResumeDownloadUrl(resource, requestContext), cancelled]);
      requestContext.assertCurrent();
      if (resumeActionRef.current !== action) return;
      if (download) {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = resource.fileName;
        anchor.rel = "noopener";
        document.body.appendChild(anchor);
        try { anchor.click(); } finally { anchor.remove(); }
      } else {
        if (!isPendingResumeTab(action.popup)) {
          throw new Error("The resume tab is no longer available. Try Open again or use Download.");
        }
        action.popup.location.replace(url);
      }
    } catch (caught) {
      if (isPendingResumeTab(action.popup)) action.popup.close();
      if (resumeActionRef.current === action && ownerDispatchIsCurrent(ownerContext)) {
        showToast({
          message: caught instanceof Error ? caught.message : "TED couldn't open that resume file.",
          tone: "error",
        });
      }
    } finally {
      window.clearTimeout(timer);
      removeAbortListener();
      action.controller.abort();
      if (resumeActionRef.current === action) {
        resumeActionRef.current = null;
        setResumeAction(null);
      }
    }
  }

  async function confirmRestore() {
    if (!user?.id || !snapshot?.previousResume || restoring) return;
    const requestContext = captureOwnerDispatch(user.id);
    setRestoring(true);
    try {
      await restorePreviousResume(requestContext);
      requestContext.assertCurrent();
      setRestoreConfirm(false);
      const refreshed = await reload(requestContext, true);
      requestContext.assertCurrent();
      if (!refreshed) {
        showToast({ message: "Your resume change was saved, but TED couldn't refresh your saved resources. Try again below.", tone: "error" });
        return;
      }
      showToast({ message: "Previous resume restored as Current.", tone: "success" });
    } catch (caught) {
      if (ownerDispatchIsCurrent(requestContext)) {
        showToast({
          message: caught instanceof Error ? caught.message : "TED couldn't restore that resume.",
          tone: "error",
        });
      }
    } finally {
      if (ownerDispatchIsCurrent(requestContext)) setRestoring(false);
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
          <Button disabled={loading} onClick={() => void reload()}>Try again</Button>
          {loading ? <p role="status">Refreshing Profile…</p> : null}
        </div>
      </section>
    );
  }

  const currentResume = snapshot?.currentResume ?? null;
  const previousResume = snapshot?.previousResume ?? null;
  const resourcesUnavailable = loading || error !== null || uploading || restoring || resumeAction !== null;

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
          {saving ? "Saving changes…" : loading ? "Refreshing Profile…" : dirty ? "Unsaved changes" : error ? "Profile refresh unavailable" : "Profile up to date"}
        </div>
      </header>

      {error ? (
        <div className={styles.errorCard} role="alert">
          <p>{error}</p>
          <p>Last loaded resources are shown. Try again before opening or changing a resume. Your personal edits are kept.</p>
          <Button disabled={loading} onClick={() => void reload(undefined, true)}>Try again</Button>
        </div>
      ) : null}

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

        <aside className={styles.sideColumn} aria-label="Saved Profile resources" aria-busy={loading || uploading || restoring || resumeAction !== null}>
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
              accept={UPLOAD_ACCEPT_ATTRIBUTE}
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
                  <Button variant="ghost" size="sm" disabled={resourcesUnavailable}
                    loading={resumeAction?.resourceId === currentResume.id && !resumeAction.download}
                    loadingLabel="Opening resume" onClick={() => void openResume(currentResume)}>
                    Open
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={resourcesUnavailable}
                    loading={resumeAction?.resourceId === currentResume.id && resumeAction.download}
                    loadingLabel="Preparing download"
                    onClick={() => void openResume(currentResume, true)}
                  >
                    Download
                  </Button>
                  <Button
                    size="sm"
                    loading={uploading}
                    disabled={resourcesUnavailable}
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
                  disabled={resourcesUnavailable}
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
                  <Button variant="ghost" size="sm" disabled={resourcesUnavailable}
                    loading={resumeAction?.resourceId === previousResume.id && !resumeAction.download}
                    loadingLabel="Opening resume" onClick={() => void openResume(previousResume)}>
                    Open
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={resourcesUnavailable}
                    loading={resumeAction?.resourceId === previousResume.id && resumeAction.download}
                    loadingLabel="Preparing download"
                    onClick={() => void openResume(previousResume, true)}
                  >
                    Download
                  </Button>
                  <Button variant="ghost" size="sm" disabled={resourcesUnavailable} onClick={() => setRestoreConfirm(true)}>
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
                        disabled={resourcesUnavailable}
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
