"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import {
  ingestUpload,
  jobMatch,
  type JobMatchResult,
  type JobRoleIdea,
  type JobVacancy,
} from "@prompted/shared/api-client";
import { ensureApiConfigured } from "@/lib/api";
import { type ConfirmOutcomeParams, useOutcome } from "@/hooks/useOutcome";
import { useAuth } from "@/components/providers";
import {
  fetchActionItems,
  fetchRoleOutcomes,
  recordRoleOutcome,
  saveRole,
  setActionItemStatus,
  ROLE_OUTCOME_STAGE_LABELS,
  type RoleActionItem,
  type RoleOutcome,
  type RoleOutcomeStage,
} from "@/lib/api/saved-roles";
import { ACCEPT_ATTRIBUTE, MAX_FILE_BYTES } from "@/hooks/useFileAttachment";
import { Icon } from "@/components/atoms/Icon";
import { ProfileResourceSelector } from "./ProfileResourceSelector";
import { fetchProfileResources, type ProfileResourceSnapshot } from "@/lib/profile-resources";
import {
  locationFromSelectedAddress,
  materializeSelectedProfileResources,
  type ProfileResourceSelection,
} from "@/lib/profile-resource-selection";
import styles from "./FindRolesScreen.module.css";

type EnhancedVacancy = JobVacancy & {
  fit_score?: number;
  risk_flags?: string[];
  improve_before_applying?: string[];
  application_actions?: string[];
};

type EnhancedRoleIdea = JobRoleIdea & {
  fit_score?: number;
  evidence_to_show?: string[];
  application_actions?: string[];
};

type EnhancedJobMatchResult = Omit<JobMatchResult, "listings" | "role_ideas"> & {
  resume_signals?: string[];
  application_gaps?: string[];
  next_best_documents?: string[];
  listings?: EnhancedVacancy[];
  role_ideas?: EnhancedRoleIdea[];
};

const READABLE_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".csv"] as const;

function uploadErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "payload" in err) {
    const payload = (err as { payload?: unknown }).payload;
    if (payload && typeof payload === "object" && "error" in payload) {
      const error = (payload as { error?: unknown }).error;
      if (error && typeof error === "object" && "message" in error) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === "string" && message.trim()) return message;
      }
    }
  }
  return "TED couldn't read that resume. Please try a PDF, DOCX, TXT, Markdown or CSV file.";
}

function isReadableResume(file: File): boolean {
  const lower = file.name.toLowerCase();
  return READABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function cleanList(items: Array<string | undefined> | undefined, limit = 5): string[] {
  return (items ?? [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

export function safeExternalHttpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function scoreLabel(score?: number): string | null {
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  if (clamped >= 85) return `${clamped}% strong fit`;
  if (clamped >= 70) return `${clamped}% good fit`;
  if (clamped >= 50) return `${clamped}% possible fit`;
  return `${clamped}% stretch fit`;
}

export function FindRolesScreen() {
  const outcome = useOutcome();
  const { user } = useAuth();
  const [activeIndex, setActiveIndex] = useState(0);
  const [savedIds, setSavedIds] = useState<Record<string, string>>({});
  const [savingRole, setSavingRole] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planItems, setPlanItems] = useState<RoleActionItem[]>([]);
  // Outcome-tracking loop: what actually happened, distinct from the
  // action-plan checklist above (which tracks preparation, not results).
  const [outcomesOpen, setOutcomesOpen] = useState(false);
  const [outcomeHistory, setOutcomeHistory] = useState<RoleOutcome[]>([]);
  const [recordingOutcome, setRecordingOutcome] = useState(false);
  const [outcomeNote, setOutcomeNote] = useState("");
  const [outcomeStage, setOutcomeStage] = useState<RoleOutcomeStage>("applied");
  // Clarification chat: TED's readiness-gate questions and the user's
  // answers, kept as history so each follow-up call remembers what was
  // already said instead of asking the same thing twice. Disappears once
  // need_more_context resolves to false.
  const [clarifyHistory, setClarifyHistory] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [clarifyDraft, setClarifyDraft] = useState("");
  const resumeTextRef = useRef("");
  const situationRef = useRef<HTMLTextAreaElement>(null);
  const [situation, setSituation] = useState("");
  const [location, setLocation] = useState("");
  const [distance, setDistance] = useState("25 km");
  const [workType, setWorkType] = useState("Any");
  const [roleFocus, setRoleFocus] = useState("");
  const [hasResume, setHasResume] = useState(false);
  const [resumeName, setResumeName] = useState("");
  const [resumeSummary, setResumeSummary] = useState("");
  const [uploadingResume, setUploadingResume] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EnhancedJobMatchResult | null>(null);
  const [searched, setSearched] = useState(false);
  const [profileSnapshot, setProfileSnapshot] = useState<ProfileResourceSnapshot | null>(null);
  const [profileSelection, setProfileSelection] = useState<ProfileResourceSelection>({
    personal: [],
    resume: null,
  });

  useEffect(() => {
    let active = true;
    if (!user?.id)
      return () => {
        active = false;
      };
    void fetchProfileResources()
      .then((snapshot) => {
        if (active) setProfileSnapshot(snapshot);
      })
      .catch(() => {
        if (active) setProfileSnapshot(null);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  const selectedProfileResources = useMemo(
    () =>
      profileSnapshot
        ? materializeSelectedProfileResources(profileSnapshot, profileSelection)
        : { facts: {}, resume: null },
    [profileSnapshot, profileSelection],
  );
  const selectedProfileResumeText = selectedProfileResources.resume?.extractedText.trim() ?? "";
  const effectiveResumeText = resumeTextRef.current.trim() || selectedProfileResumeText;
  const effectiveResumeName = resumeName || selectedProfileResources.resume?.fileName || "";

  // The "situation" textarea was previously locked to a fixed 74px height
  // with overflow:hidden and no scrollbar, so text beyond ~3 lines was
  // simply invisible while typing. Auto-grow it to fit its content instead,
  // matching the pattern already used in ChatInput and ImportReviewPanel.
  const resizeSituation = useCallback(() => {
    const el = situationRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resizeSituation();
  }, [situation, resizeSituation]);

  // The live vacancy search is driven by the explicit `location` field, not
  // by whatever's buried in free-text context. Selecting the saved profile
  // address previously only added it to that context blob — the field
  // itself stayed empty unless retyped by hand, so the search silently
  // didn't use it. Pre-fill from the selected address once, without
  // clobbering anything the user has already typed.
  useEffect(() => {
    if (location.trim()) return;
    const fromProfile = locationFromSelectedAddress(selectedProfileResources.facts.address);
    if (fromProfile) setLocation(fromProfile);
  }, [selectedProfileResources.facts.address, location]);

  const hasLocation = Boolean(location.trim());
  const hasDirection = Boolean(situation.trim() || roleFocus.trim());
  const canSearch = Boolean(
    (hasDirection || hasResume || selectedProfileResumeText) && !loading && !uploadingResume,
  );

  const searchContext = useMemo(
    () =>
      [
        situation.trim(),
        roleFocus.trim() ? `Role focus: ${roleFocus.trim()}` : "",
        workType !== "Any" ? `Work type: ${workType}` : "",
        distance.trim() ? `Preferred distance: ${distance.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    [situation, roleFocus, workType, distance],
  );

  const readiness = useMemo(() => {
    const items = [
      {
        label: "Resume ready",
        done: Boolean(hasResume || selectedProfileResumeText),
        detail: effectiveResumeName || "Best for accurate matching",
      },
      {
        label: "Location added",
        done: hasLocation,
        detail: hasLocation ? location.trim() : "Needed for live vacancies",
      },
      {
        label: "Role focus",
        done: hasDirection,
        detail: hasDirection ? "TED will use your constraints" : "Role, hours, pay or industry",
      },
    ];
    const done = items.filter((item) => item.done).length;
    return { items, done, total: items.length };
  }, [
    hasResume,
    hasLocation,
    hasDirection,
    selectedProfileResumeText,
    effectiveResumeName,
    location,
  ]);

  const baseContext = useCallback(
    (target?: Pick<EnhancedVacancy, "title" | "employer" | "location" | "why_fit" | "url">) => {
      const resumeText = effectiveResumeText;
      const selectedFacts = Object.keys(selectedProfileResources.facts).length
        ? `Selected Profile information:\n${JSON.stringify(selectedProfileResources.facts)}`
        : "";
      return [
        searchContext ? `User job-search setup:\n${searchContext}` : "",
        location.trim() ? `User location: ${location.trim()}` : "",
        effectiveResumeName ? `Resume resource: ${effectiveResumeName}` : "",
        resumeSummary ? `Resume summary: ${resumeSummary}` : "",
        target?.title ? `Target role: ${target.title}` : "",
        target?.employer ? `Employer: ${target.employer}` : "",
        target?.location ? `Role location: ${target.location}` : "",
        target?.why_fit ? `Why this role fits: ${target.why_fit}` : "",
        target?.url ? `Source listing: ${target.url}` : "",
        resumeText ? `Uploaded resume text:\n${resumeText.slice(0, 8000)}` : "",
        selectedFacts,
      ]
        .filter(Boolean)
        .join("\n\n");
    },
    [
      searchContext,
      location,
      effectiveResumeName,
      resumeSummary,
      effectiveResumeText,
      selectedProfileResources.facts,
    ],
  );

  const search = useCallback(async () => {
    const s = searchContext.trim();
    const experience = effectiveResumeText;
    if ((!s && !experience) || loading || uploadingResume) return;
    setLoading(true);
    setError(null);
    setClarifyHistory([]);
    try {
      ensureApiConfigured();
      const res = await jobMatch({
        situation: s || "Use my uploaded resume to find suitable roles and application gaps.",
        experience: experience || undefined,
        location: location.trim() || undefined,
        work_type: workType !== "Any" ? workType : undefined,
        distance: distance.trim() || undefined,
        role_focus: roleFocus.trim() || undefined,
      });
      const typed = res as EnhancedJobMatchResult;
      setResult(typed);
      setSearched(true);
      if (typed.need_more_context && typed.ask) {
        setClarifyHistory([{ role: "assistant", content: typed.ask }]);
      }
    } catch {
      setError(
        "TED hit a snag finding roles. Try again in a moment, or add a little more location and role detail.",
      );
    } finally {
      setLoading(false);
    }
  }, [
    searchContext,
    location,
    workType,
    distance,
    roleFocus,
    loading,
    uploadingResume,
    effectiveResumeText,
  ]);

  /** Answers TED's clarifying question inline, in the chat panel, instead of
   * requiring the user to go back and edit the left-hand fields. Sends the
   * accumulated conversation as history so TED never re-asks something
   * already answered. */
  const answerClarify = useCallback(async () => {
    const answer = clarifyDraft.trim();
    if (!answer || loading) return;
    const nextHistory: { role: "user" | "assistant"; content: string }[] = [
      ...clarifyHistory,
      { role: "user", content: answer },
    ];
    setClarifyHistory(nextHistory);
    setClarifyDraft("");
    setLoading(true);
    setError(null);
    try {
      ensureApiConfigured();
      const answers = nextHistory
        .filter((message) => message.role === "user")
        .map((message) => message.content.trim())
        .filter(Boolean);
      const answersContext =
        answers.length > 0
          ? `Clarification answers:\n${answers.map((value) => `- ${value}`).join("\n")}`
          : "";
      const answeredLocation =
        !location.trim() && result?.missing?.includes("location") ? answer : location.trim();
      if (answeredLocation && answeredLocation !== location.trim()) setLocation(answeredLocation);
      const res = await jobMatch({
        situation: [
          searchContext.trim() ||
            "Use my uploaded resume to find suitable roles and application gaps.",
          answersContext,
        ]
          .filter(Boolean)
          .join("\n"),
        experience: effectiveResumeText || undefined,
        location: answeredLocation || undefined,
        work_type: workType !== "Any" ? workType : undefined,
        distance: distance.trim() || undefined,
        role_focus: roleFocus.trim() || undefined,
        history: nextHistory,
      });
      const typed = res as EnhancedJobMatchResult;
      setResult(typed);
      if (typed.need_more_context && typed.ask) {
        setClarifyHistory([...nextHistory, { role: "assistant", content: typed.ask }]);
      } else {
        // Resolved: the chat panel's job is done, so it disappears and the
        // normal role-match results take over.
        setClarifyHistory([]);
      }
    } catch {
      setError("TED hit a snag with that answer. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, [
    clarifyDraft,
    clarifyHistory,
    searchContext,
    location,
    workType,
    distance,
    roleFocus,
    loading,
    result,
    effectiveResumeText,
  ]);

  const uploadResume = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.currentTarget.files?.[0];
      e.currentTarget.value = "";
      if (!file || uploadingResume) return;

      if (!isReadableResume(file)) {
        setUploadError(
          "Use a PDF, DOCX, TXT, Markdown or CSV resume so TED can read the text properly.",
        );
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setUploadError("That resume is too large. Please upload a file under 8MB.");
        return;
      }

      setUploadingResume(true);
      setUploadError(null);
      setError(null);
      try {
        ensureApiConfigured();
        const upload = await ingestUpload(
          file,
          "Extract this resume for job matching. Identify the person's role history, skills, industries, qualifications, strengths, seniority, constraints and application gaps.",
        );
        const extractedText = upload.extracted_text.trim();
        const summary = String(upload.confirm_payload["summary"] ?? "").trim();
        resumeTextRef.current = extractedText;
        setHasResume(Boolean(extractedText));
        setResumeName(file.name);
        setResumeSummary(summary);
        setResult(null);
        setSearched(false);
      } catch (err) {
        setUploadError(uploadErrorMessage(err));
      } finally {
        setUploadingResume(false);
      }
    },
    [uploadingResume],
  );

  const clearResume = useCallback(() => {
    resumeTextRef.current = "";
    setHasResume(false);
    setResumeName("");
    setResumeSummary("");
    setUploadError(null);
    setResult(null);
    setSearched(false);
  }, []);

  const createDocument = useCallback(
    (params: {
      templateName: string;
      templateId: string;
      situation: string;
      target?: Pick<EnhancedVacancy, "title" | "employer" | "location" | "why_fit" | "url">;
    }) => {
      const confirmParams: ConfirmOutcomeParams = {
        situation: params.situation,
        templateName: params.templateName,
        templateId: params.templateId,
        conversationContext: baseContext(params.target),
      };
      const uploadContext = effectiveResumeText;
      if (uploadContext) confirmParams.uploadContext = uploadContext;
      outcome.confirm(confirmParams);
    },
    [baseContext, outcome, effectiveResumeText],
  );

  const tailorCoverLetter = useCallback(
    (v: Pick<EnhancedVacancy, "title" | "employer" | "location" | "why_fit" | "url">) => {
      const role = v.title || "this role";
      const at = v.employer ? ` at ${v.employer}` : "";
      createDocument({
        templateName: "Cover Letter",
        templateId: "cover-letter",
        situation: `Write a complete cover letter for ${role}${at}. Use final wording, not placeholders or instructions.`,
        target: v,
      });
    },
    [createDocument],
  );

  const improveResume = useCallback(
    (target?: Pick<EnhancedVacancy, "title" | "employer" | "location" | "why_fit" | "url">) => {
      const role = target?.title || "the roles TED recommends";
      const company = target?.employer ? ` at ${target.employer}` : "";
      createDocument({
        templateName: "Tailored Resume",
        templateId: "resume",
        situation: `Create a role-specific resume copy for ${role}${company}. Open it in Master Workspace for section-by-section approval and do not overwrite the original resume.`,
        target,
      });
    },
    [createDocument],
  );

  const createChecklist = useCallback(() => {
    createDocument({
      templateName: "Job-search Action Checklist",
      templateId: "job-search-checklist",
      situation:
        "Create a focused job-search action checklist from my resume, target roles, location and constraints.",
    });
  }, [createDocument]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void search();
    }
  };

  const roleKey = useCallback(
    (v: { title?: string; employer?: string }) => `${v.title ?? ""}::${v.employer ?? ""}`,
    [],
  );

  const handleSaveRole = useCallback(
    async (v: EnhancedVacancy): Promise<string | null> => {
      if (!user?.id || savingRole) return null;
      setSavingRole(true);
      try {
        const id = await saveRole({
          userId: user.id,
          roleTitle: v.title || "Role",
          companyName: v.employer,
          location: v.location,
          matchPercentage: typeof v.fit_score === "number" ? Math.round(v.fit_score) : undefined,
          jobUrl: v.url,
          sourceLabel: v.source,
          contactSourceStatus: v.url ? "official" : "needs_confirmation",
        });
        if (id) setSavedIds((prev) => ({ ...prev, [roleKey(v)]: id }));
        return id ?? null;
      } finally {
        setSavingRole(false);
      }
    },
    [user?.id, savingRole, roleKey],
  );

  const openActionPlan = useCallback(
    async (v: EnhancedVacancy) => {
      if (!user?.id) return;
      let id = savedIds[roleKey(v)];
      if (!id) {
        id = (await handleSaveRole(v)) ?? undefined;
      }
      if (!id) return;
      setPlanItems(await fetchActionItems(id));
      setPlanOpen(true);
      setOutcomesOpen(false);
    },
    [user?.id, savedIds, roleKey, handleSaveRole],
  );

  const togglePlanItem = useCallback(async (item: RoleActionItem) => {
    const next = item.status === "done" ? "pending" : "done";
    setPlanItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: next } : p)));
    await setActionItemStatus(item.id, next);
  }, []);

  /** Ensures the role is saved, then returns its id \u2014 shared by the
   * outcome and interview-prep handlers below (both need a saved_role_id). */
  const ensureSaved = useCallback(
    async (v: EnhancedVacancy): Promise<string | null> => {
      const existing = savedIds[roleKey(v)];
      if (existing) return existing;
      return handleSaveRole(v);
    },
    [savedIds, roleKey, handleSaveRole],
  );

  const openOutcomes = useCallback(
    async (v: EnhancedVacancy) => {
      if (!user?.id) return;
      const savedId = await ensureSaved(v);
      if (!savedId) return;
      setOutcomeHistory(await fetchRoleOutcomes(savedId));
      setOutcomesOpen(true);
      setPlanOpen(false);
    },
    [user?.id, ensureSaved],
  );

  const submitOutcome = useCallback(
    async (v: EnhancedVacancy) => {
      if (!user?.id || recordingOutcome) return;
      const savedId = await ensureSaved(v);
      if (!savedId) return;
      setRecordingOutcome(true);
      try {
        await recordRoleOutcome({
          userId: user.id,
          savedRoleId: savedId,
          stage: outcomeStage,
          note: outcomeNote,
        });
        setOutcomeHistory(await fetchRoleOutcomes(savedId));
        setOutcomeNote("");
      } finally {
        setRecordingOutcome(false);
      }
    },
    [user?.id, recordingOutcome, ensureSaved, outcomeStage, outcomeNote],
  );

  /** Interview prep tied to this specific role: seeds TED's existing
   * interview-prep-questions template with the actual posting AND the
   * gaps already surfaced by the fit evaluation (risk_flags,
   * improve_before_applying), so questions target this application's real
   * weak points instead of generic interview advice \u2014 the one genuinely
   * new idea worth porting from ai-job-search's /interview command. */
  const openInterviewPrep = useCallback(
    (v: EnhancedVacancy) => {
      const role = v.title || "this role";
      const at = v.employer ? ` at ${v.employer}` : "";
      const gaps = [...(v.risk_flags ?? []), ...(v.improve_before_applying ?? [])];
      const gapNote =
        gaps.length > 0
          ? ` Prepare honest answers for these known gaps \u2014 acknowledge, connect adjacent experience, never invent experience: ${gaps.join("; ")}.`
          : "";
      createDocument({
        templateName: "Interview Prep Questions",
        templateId: "interview-prep-questions",
        situation: `Prepare interview questions and answers for ${role}${at}.${gapNote}`,
        target: v,
      });
    },
    [createDocument],
  );

  const openApply = useCallback((v: EnhancedVacancy) => {
    const applyUrl = safeExternalHttpUrl(v.url);
    if (applyUrl) {
      window.open(applyUrl, "_blank", "noopener,noreferrer");
      return;
    }
    // No official link found: never guess contacts, tell the user plainly.
    setError(
      "No official apply link was found for this role. Check the employer's careers page directly.",
    );
  }, []);

  const listings = result?.listings ?? [];
  const roleIdeas = result?.role_ideas ?? [];
  const resumeSignals = useMemo(
    () => cleanList(result?.resume_signals, 6),
    [result?.resume_signals],
  );
  const applicationGaps = useMemo(
    () => cleanList(result?.application_gaps, 5),
    [result?.application_gaps],
  );
  const nextBestDocuments = useMemo(
    () => cleanList(result?.next_best_documents, 4),
    [result?.next_best_documents],
  );
  const empty =
    searched &&
    result &&
    !result.need_more_context &&
    listings.length === 0 &&
    roleIdeas.length === 0;
  const showResults = loading || Boolean(result);

  return (
    <div className={`${styles.screen}${showResults ? ` ${styles.screenResults}` : ""}`}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Resume-first job search</p>
          <h1 className={styles.title}>Find roles</h1>
          <p className={styles.sub}>
            Upload your resume, add your location and tell TED what matters. TED checks your
            experience against real current openings, flags gaps, then helps build a clean
            application bundle.
          </p>
        </div>
        <div className={styles.topActions}>
          <button type="button" onClick={() => void search()} disabled={!canSearch}>
            Refresh roles
          </button>
          <button type="button" onClick={() => document.getElementById("role-situation")?.focus()}>
            Improve match
          </button>
          <button type="button" onClick={() => document.getElementById("role-location")?.focus()}>
            Filters
          </button>
        </div>
      </header>

      <section className={styles.commandPanel} aria-label="Role search setup">
        <div className={styles.commandScroll}>
          <div className={styles.readiness}>
            <div>
              <span className={styles.readinessLabel}>Search strength</span>
              <strong>
                {readiness.done}/{readiness.total} ready
              </strong>
            </div>
            <div className={styles.readinessItems}>
              {readiness.items.map((item) => (
                <span
                  key={item.label}
                  className={`${styles.readinessItem}${item.done ? ` ${styles.done}` : ""}`}
                >
                  <Icon name={item.done ? "circle-check" : "circle"} size={15} />
                  {item.label}
                </span>
              ))}
            </div>
          </div>

          <label className={styles.uploadBox}>
            <input
              className={styles.fileInput}
              type="file"
              accept={ACCEPT_ATTRIBUTE}
              onChange={(e) => void uploadResume(e)}
              disabled={uploadingResume || loading}
            />
            <span className={styles.uploadIcon}>
              <Icon name="upload" size={20} />
            </span>
            <span className={styles.uploadText}>
              <strong>
                {uploadingResume
                  ? "Reading resume..."
                  : hasResume
                    ? "Replace resume"
                    : "Upload resume"}
              </strong>
              <span>
                PDF, DOCX, TXT, Markdown or CSV under 8MB. TED uses this as the evidence base for
                matching.
              </span>
            </span>
          </label>

          {resumeName && (
            <div className={styles.resumeCard}>
              <Icon name="file-text" size={18} />
              <div>
                <strong>{resumeName}</strong>
                <span>
                  {resumeSummary || "Resume uploaded and ready to use for role matching."}
                </span>
              </div>
              <button type="button" className={styles.clearResume} onClick={clearResume}>
                Remove
              </button>
            </div>
          )}

          {profileSnapshot ? (
            <ProfileResourceSelector
              snapshot={profileSnapshot}
              value={profileSelection}
              onChange={setProfileSelection}
              includeResumeResources
              heading="Use saved Profile information"
              description="Choose a saved resume for matching and any personal details TED may use in documents you create from these results."
            />
          ) : null}

          {uploadError && (
            <p className={styles.uploadError} role="alert">
              {uploadError}
            </p>
          )}

          <div className={styles.setupGrid}>
            <div className={styles.fieldGroup}>
              <label htmlFor="role-location">Location</label>
              <input
                id="role-location"
                className={styles.input}
                placeholder="Melbourne, VIC"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                onKeyDown={onKeyDown}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label htmlFor="role-distance">Distance</label>
              <input
                id="role-distance"
                className={styles.input}
                placeholder="25 km"
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
                onKeyDown={onKeyDown}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label htmlFor="role-work-type">Work type</label>
              <select
                id="role-work-type"
                className={styles.input}
                value={workType}
                onChange={(e) => setWorkType(e.target.value)}
              >
                <option>Any</option>
                <option>Full-time</option>
                <option>Part-time</option>
                <option>Casual</option>
                <option>Contract</option>
                <option>Hybrid</option>
                <option>Remote</option>
              </select>
            </div>
            <div className={styles.fieldGroup}>
              <label htmlFor="role-focus">Role focus</label>
              <input
                id="role-focus"
                className={styles.input}
                placeholder="Building manager, admin, operations..."
                value={roleFocus}
                onChange={(e) => setRoleFocus(e.target.value)}
                onKeyDown={onKeyDown}
              />
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="role-situation">What should TED know before matching roles?</label>
            <textarea
              id="role-situation"
              ref={situationRef}
              className={styles.textarea}
              placeholder="Example: I want hybrid admin roles over $70k, no heavy lifting, and I can start within two weeks."
              value={situation}
              onChange={(e) => setSituation(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>

          <div className={styles.ruleCards} aria-label="Find a Role rules">
            <div>
              <strong>Saved roles</strong>
              <span>Saved roles go into your Document Library as a role folder.</span>
            </div>
            <div>
              <strong>Apply source rules</strong>
              <span>
                Official links first. Public emails only. Unsure sources are marked needs
                confirmation.
              </span>
            </div>
            <div>
              <strong>TED suggestions</strong>
              <span>
                TED prepares documents and suggestions. You approve changes before they apply.
              </span>
            </div>
          </div>
        </div>
        <div className={styles.row}>
          <button className={styles.primary} onClick={() => void search()} disabled={!canSearch}>
            {loading ? "Searching..." : "Find roles"}
          </button>
        </div>
      </section>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {loading && (
        <div className={styles.loading} role="status">
          <Icon name="loader-2" /> TED is checking official and employer sources for current
          openings...
        </div>
      )}

      {result && !loading && (
        <div className={styles.results}>
          {result.need_more_context ? (
            <div className={styles.clarifyChat} aria-label="TED is asking a clarifying question">
              <div className={styles.clarifyHeader}>
                <Icon name="message-chatbot" size={18} />
                <span>TED needs a bit more to find roles that genuinely fit</span>
              </div>
              <div className={styles.clarifyThread}>
                {clarifyHistory.map((msg, idx) => (
                  <div
                    key={idx}
                    className={
                      msg.role === "assistant" ? styles.clarifyBubbleTed : styles.clarifyBubbleUser
                    }
                  >
                    {msg.content}
                  </div>
                ))}
                {Array.isArray(result.missing) && result.missing.length > 0 && (
                  <span className={styles.hint}>Still missing: {result.missing.join(", ")}</span>
                )}
              </div>
              <p className={styles.clarifyPrompt}>
                Answer in the chat box below and TED will keep going.
              </p>
            </div>
          ) : (
            <>
              {result.summary && <p className={styles.summary}>{result.summary}</p>}

              {resumeSignals.length > 0 && (
                <section className={styles.insightPanel}>
                  <h2 className={styles.sectionTitle}>What TED picked up from your resume</h2>
                  <div className={styles.tagRow}>
                    {resumeSignals.map((signal) => (
                      <span key={signal}>{signal}</span>
                    ))}
                  </div>
                </section>
              )}

              {applicationGaps.length > 0 && (
                <section className={styles.warningPanel}>
                  <h2 className={styles.sectionTitle}>Fix before applying</h2>
                  <ul>
                    {applicationGaps.map((gap) => (
                      <li key={gap}>{gap}</li>
                    ))}
                  </ul>
                </section>
              )}

              {listings.length > 0 &&
                (() => {
                  const active = listings[Math.min(activeIndex, listings.length - 1)];
                  if (!active) return null;
                  const label = scoreLabel(active.fit_score);
                  const risks = cleanList(active.risk_flags, 4);
                  const fixes = cleanList(active.improve_before_applying, 4);
                  const saved = Boolean(savedIds[roleKey(active)]);
                  return (
                    <section className={styles.roleGrid} aria-label="Current openings">
                      <article className={styles.activeRole}>
                        <div className={styles.cardHead}>
                          <div>
                            <span className={styles.roleTitle}>{active.title || "Role"}</span>
                            <p className={styles.employer}>
                              {[active.employer, active.location].filter(Boolean).join(" - ")}
                            </p>
                          </div>
                          {label && <span className={styles.fitPill}>{label}</span>}
                        </div>

                        {active.why_fit && (
                          <>
                            <h3 className={styles.detailHead}>Why this fits</h3>
                            <p className={styles.why}>{active.why_fit}</p>
                          </>
                        )}

                        {active.fit_breakdown && (
                          <>
                            <h3 className={styles.detailHead}>Fit breakdown</h3>
                            <div className={styles.fitBars}>
                              {(
                                [
                                  ["Skills", active.fit_breakdown.skills_match],
                                  ["Experience", active.fit_breakdown.experience_match],
                                  ["Work style", active.fit_breakdown.work_style_fit],
                                  ["Career direction", active.fit_breakdown.career_alignment],
                                ] as const
                              ).map(([label, value]) =>
                                typeof value === "number" ? (
                                  <div key={label} className={styles.fitBarRow}>
                                    <span className={styles.fitBarLabel}>{label}</span>
                                    <div className={styles.fitBarTrack}>
                                      <div
                                        className={styles.fitBarFill}
                                        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
                                      />
                                    </div>
                                    <span className={styles.fitBarValue}>{value}</span>
                                  </div>
                                ) : null,
                              )}
                              {active.fit_breakdown.location_fit && (
                                <div className={styles.fitBarRow}>
                                  <span className={styles.fitBarLabel}>Location</span>
                                  <span
                                    className={
                                      active.fit_breakdown.location_fit === "pass"
                                        ? styles.sourceOfficial
                                        : active.fit_breakdown.location_fit === "fail"
                                          ? styles.locationFail
                                          : styles.sourceUnsure
                                    }
                                  >
                                    {active.fit_breakdown.location_fit === "pass"
                                      ? "Commutable"
                                      : active.fit_breakdown.location_fit === "fail"
                                        ? "Needs relocation"
                                        : "Check arrangement"}
                                  </span>
                                </div>
                              )}
                            </div>
                          </>
                        )}

                        {(risks.length > 0 || fixes.length > 0) && (
                          <>
                            <h3 className={styles.detailHead}>Check before applying</h3>
                            <ul className={styles.risks}>
                              {[...risks, ...fixes].map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </>
                        )}

                        <h3 className={styles.detailHead}>Apply route</h3>
                        <ul className={styles.applyRoute}>
                          {active.url ? (
                            <li>
                              Official apply link: {active.source || "employer listing"}{" "}
                              <span className={styles.sourceOfficial}>Official</span>
                            </li>
                          ) : (
                            <li>
                              No official link found{" "}
                              <span className={styles.sourceUnsure}>Needs confirmation</span>
                            </li>
                          )}
                          <li>
                            You always apply on the source site yourself - TED never applies for
                            you.
                          </li>
                        </ul>

                        {planOpen && planItems.length > 0 && (
                          <div className={styles.planBox}>
                            <h3 className={styles.detailHead}>Action plan</h3>
                            <ul className={styles.planList}>
                              {planItems.map((item) => (
                                <li key={item.id}>
                                  <label className={styles.planItem}>
                                    <input
                                      type="checkbox"
                                      checked={item.status === "done"}
                                      onChange={() => void togglePlanItem(item)}
                                    />
                                    <span
                                      className={
                                        item.status === "done" ? styles.planDone : undefined
                                      }
                                    >
                                      {item.label}
                                    </span>
                                  </label>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {outcomesOpen && (
                          <div className={styles.planBox}>
                            <h3 className={styles.detailHead}>Outcome tracker</h3>
                            <p className={styles.matchSub}>
                              Record what actually happens - TED uses this over time to calibrate
                              fit scores against real results.
                            </p>
                            <div className={styles.outcomeForm}>
                              <select
                                className={styles.outcomeSelect}
                                value={outcomeStage}
                                onChange={(e) =>
                                  setOutcomeStage(e.target.value as typeof outcomeStage)
                                }
                              >
                                {(
                                  Object.keys(
                                    ROLE_OUTCOME_STAGE_LABELS,
                                  ) as (keyof typeof ROLE_OUTCOME_STAGE_LABELS)[]
                                ).map((key) => (
                                  <option key={key} value={key}>
                                    {ROLE_OUTCOME_STAGE_LABELS[key]}
                                  </option>
                                ))}
                              </select>
                              <input
                                className={styles.outcomeNote}
                                type="text"
                                placeholder="Note (optional) - e.g. what they asked, feedback given"
                                value={outcomeNote}
                                onChange={(e) => setOutcomeNote(e.target.value)}
                              />
                              <button
                                type="button"
                                className={styles.secondaryBtn}
                                onClick={() => void submitOutcome(active)}
                                disabled={recordingOutcome}
                              >
                                {recordingOutcome ? "Saving..." : "Add"}
                              </button>
                            </div>
                            {outcomeHistory.length > 0 ? (
                              <ul className={styles.outcomeHistory}>
                                {outcomeHistory.map((o) => (
                                  <li key={o.id}>
                                    <span className={styles.outcomeStagePill}>
                                      {ROLE_OUTCOME_STAGE_LABELS[o.stage]}
                                    </span>
                                    <span className={styles.outcomeDate}>{o.occurred_at}</span>
                                    {o.note && (
                                      <span className={styles.outcomeNoteText}>{o.note}</span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className={styles.matchSub}>
                                No outcomes recorded yet for this role.
                              </p>
                            )}
                          </div>
                        )}

                        <div className={styles.cardActions}>
                          <button
                            className={styles.secondaryBtn}
                            onClick={() => void handleSaveRole(active)}
                            disabled={!user?.id || savingRole || saved}
                          >
                            {saved ? "Saved to library" : savingRole ? "Saving..." : "Save role"}
                          </button>
                          <button
                            className={styles.secondaryBtn}
                            onClick={() => void openActionPlan(active)}
                            disabled={!user?.id}
                          >
                            Action plan
                          </button>
                          <button
                            className={styles.secondaryBtn}
                            onClick={() => void openOutcomes(active)}
                            disabled={!user?.id}
                          >
                            {active.title && savedIds[roleKey(active)]
                              ? "Outcome"
                              : "Track outcome"}
                          </button>
                          <button
                            className={styles.secondaryBtn}
                            onClick={() => improveResume(active)}
                          >
                            Tailor resume
                          </button>
                          <button
                            className={styles.secondaryBtn}
                            onClick={() => openInterviewPrep(active)}
                          >
                            Interview prep
                          </button>
                          <button
                            className={styles.tailorBtn}
                            onClick={() => tailorCoverLetter(active)}
                          >
                            Cover letter
                          </button>
                          <button className={styles.primaryBtn} onClick={() => openApply(active)}>
                            Open apply
                          </button>
                        </div>
                        <p className={styles.note}>
                          Saving stores this role, its apply link and TED&apos;s recommendations in
                          your Document Library.
                        </p>
                      </article>

                      <aside className={styles.matchList} aria-label="Role matches">
                        <h2 className={styles.sectionTitle}>Role matches</h2>
                        <p className={styles.matchSub}>Details, location and match percentage.</p>
                        <ul>
                          {listings.map((v, i) => {
                            const pct =
                              typeof v.fit_score === "number"
                                ? `${Math.round(v.fit_score)}%`
                                : null;
                            const isActive = i === Math.min(activeIndex, listings.length - 1);
                            const isSaved = Boolean(savedIds[roleKey(v)]);
                            return (
                              <li key={`${v.url ?? v.title ?? "role"}-${i}`}>
                                <button
                                  type="button"
                                  className={`${styles.matchItem}${isActive ? ` ${styles.matchActive}` : ""}`}
                                  onClick={() => {
                                    setActiveIndex(i);
                                    setPlanOpen(false);
                                  }}
                                >
                                  <span className={styles.matchTitle}>{v.title || "Role"}</span>
                                  {pct && <span className={styles.matchPct}>{pct}</span>}
                                  <span className={styles.matchMeta}>
                                    {[v.employer, v.location].filter(Boolean).join(" - ")}
                                  </span>
                                  <span className={styles.matchStatus}>
                                    {isSaved
                                      ? "Saved to library"
                                      : v.url
                                        ? "Apply link found"
                                        : "Needs confirmation"}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </aside>
                    </section>
                  );
                })()}

              {roleIdeas.length > 0 && (
                <section>
                  <div className={styles.sectionHead}>
                    <h2 className={styles.sectionTitle}>Roles worth considering</h2>
                    <span>Use these when live listings are thin or you want options.</span>
                  </div>
                  <div className={styles.cards}>
                    {roleIdeas.map((r, i) => {
                      const label = scoreLabel(r.fit_score);
                      const evidence = cleanList(r.evidence_to_show, 4);
                      return (
                        <article key={`${r.role ?? "idea"}-${i}`} className={styles.idea}>
                          <div className={styles.cardHead}>
                            <span className={styles.roleTitle}>{r.role || "Role"}</span>
                            <div className={styles.pills}>
                              {label && <span className={styles.fitPill}>{label}</span>}
                              {r.demand && <span className={styles.pill}>{r.demand} demand</span>}
                            </div>
                          </div>
                          {r.industry && <p className={styles.employer}>{r.industry}</p>}
                          {(r.typical_pay || r.how_fast) && (
                            <p className={styles.meta}>
                              {r.typical_pay && <span>{r.typical_pay}</span>}
                              {r.typical_pay && r.how_fast && <span> - </span>}
                              {r.how_fast && <span>{r.how_fast}</span>}
                            </p>
                          )}
                          {r.why_fit && <p className={styles.why}>{r.why_fit}</p>}
                          {evidence.length > 0 && (
                            <div className={styles.fixBox}>
                              <strong>Evidence to show</strong>
                              <ul>
                                {evidence.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {Array.isArray(r.first_steps) && r.first_steps.length > 0 && (
                            <ul className={styles.steps}>
                              {r.first_steps.map((s, j) => (
                                <li key={j}>{s}</li>
                              ))}
                            </ul>
                          )}
                          <div className={styles.cardActions}>
                            <button
                              className={styles.secondaryBtn}
                              onClick={() => improveResume({ title: r.role })}
                            >
                              Tailor resume
                            </button>
                            <button
                              className={styles.tailorBtn}
                              onClick={() => tailorCoverLetter({ title: r.role })}
                            >
                              Cover letter
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}

              {Array.isArray(result.tips) && result.tips.length > 0 && (
                <section className={styles.tips}>
                  <h2 className={styles.sectionTitle}>TED&apos;s tips</h2>
                  <ul>
                    {result.tips.map((tp, i) => (
                      <li key={i}>{tp}</li>
                    ))}
                  </ul>
                </section>
              )}

              {nextBestDocuments.length > 0 && (
                <section className={styles.nextDocs}>
                  <h2 className={styles.sectionTitle}>Next documents to create</h2>
                  <div className={styles.docActions}>
                    <button onClick={() => improveResume()}>Improved resume</button>
                    <button
                      onClick={() =>
                        tailorCoverLetter({ title: listings[0]?.title || roleIdeas[0]?.role })
                      }
                    >
                      Cover letter
                    </button>
                    <button onClick={createChecklist}>Job-search action plan</button>
                  </div>
                </section>
              )}

              {empty && (
                <p className={styles.empty}>
                  TED couldn&apos;t confirm live openings for that search right now. Add a tighter
                  location, broaden the role type, or use the role ideas to build your next
                  application pack.
                </p>
              )}

              <p className={styles.note}>
                TED never applies for you. Open each listing on its own site to apply. Use TED to
                sharpen the resume, cover letter and follow-up before you send anything.
              </p>
            </>
          )}
        </div>
      )}

      {showResults && (
        <div className={styles.refineBar} aria-label="Refine these roles with TED">
          <span className={styles.refineHint}>
            {result?.need_more_context && result.ask
              ? result.ask
              : 'Tell TED how to shape this list - "focus on the part-time ones", "remove the warehouse roles", "only hybrid".'}
          </span>
          <input
            className={styles.refineInput}
            type="text"
            placeholder="Type it here..."
            value={clarifyDraft}
            onChange={(e) => setClarifyDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) void answerClarify();
            }}
            disabled={loading}
          />
          <button
            type="button"
            className={styles.refineSend}
            onClick={() => void answerClarify()}
            disabled={loading || !clarifyDraft.trim()}
          >
            {loading ? "..." : "Send"}
          </button>
        </div>
      )}
    </div>
  );
}
