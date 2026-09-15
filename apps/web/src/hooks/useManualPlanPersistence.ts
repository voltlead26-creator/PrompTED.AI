"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ManualPlanSnapshot,
  type ManualPlanVersion,
} from "@prompted/shared";
import { readManualPlan, saveManualPlanCommand } from "@/lib/api/manual-plans";
import {
  captureOwnerDispatch, ownerDispatchIsCurrent, withOwnerDispatchSignal,
  type OwnerDispatchLease,
} from "@/lib/browser-principal-state";
import {
  currentDeviceDataScope, deviceDataOwnerToken, readDeviceData, writeDeviceData,
  type DeviceDataScope,
} from "@/lib/owner-bound-device-store";
import {
  createManualPlan, loadManualPlan, saveManualPlan, type ManualPlanState,
} from "@/app/(app)/plans/manual-plan-store";

import { MANUAL_PLAN_RECOVERY_RESOURCE, manualPlanCommand, manualPlanDraftShape, manualPlanRecoveryShape, type ManualPlanRecovery } from "@/app/(app)/plans/manual-plan-recovery";

type Status = "opening" | "saved" | "pending" | "saving" | "error" | "conflict" | "import" | "unavailable";

interface Session extends ManualPlanRecovery {
  scope: DeviceDataScope;
  routeKey: string;
  requestedId: string | null;
  selectedRecoveryId: string | null;
  recoveryId: string;
  revision: number;
  status: Status;
  message: string | null;
  remote: ManualPlanSnapshot | null;
  lease: OwnerDispatchLease | null;
  loaded: boolean;
  disposed: boolean;
  hasPlan: boolean;
  readFailed: boolean;
  recoveryWriteFailed: boolean;
  controller: AbortController | null;
  timer: ReturnType<typeof setTimeout> | null;
  retire: (() => void) | null;
}
interface View {
  session: Session | null;
  plan: ManualPlanState | null;
  revision: number;
  status: Status;
  message: string | null;
  remote: ManualPlanSnapshot | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fromSnapshot(snapshot: ManualPlanSnapshot): ManualPlanState {
  return { id: snapshot.plan_id, title: snapshot.title, updatedAt: snapshot.updated_at,
    items: snapshot.items.map(item => ({ id: item.id, section: item.section, text: item.text,
      notes: item.notes, dueDate: item.due_date ?? "", done: item.done })) };
}
function version(snapshot: ManualPlanSnapshot): ManualPlanVersion {
  return { outcome_id: snapshot.outcome_id, artifact_id: snapshot.artifact_id, revision: snapshot.revision, updated_at: snapshot.updated_at };
}
function content(plan: ManualPlanState): string { return JSON.stringify([plan.id, plan.title, plan.items]); }
function sameVersion(a: ManualPlanVersion | null, b: ManualPlanVersion | null): boolean {
  return a === null ? b === null : b !== null && a.outcome_id === b.outcome_id && a.artifact_id === b.artifact_id &&
    a.revision === b.revision && a.updated_at === b.updated_at;
}
function recoveryOf(session: Session): ManualPlanRecovery {
  return { version: 1, ownerId: session.ownerId, plan: session.plan, expected: session.expected, pending: session.pending, dirty: session.dirty,
    ...(session.rejected ? { rejected: session.rejected } : {}) };
}
function retainLocation(session: Session) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (url.pathname !== "/plans") return;
  url.searchParams.set("create", "manual"); url.searchParams.set("plan", session.plan.id);
  if (session.ownerId) url.searchParams.set("recovery", session.recoveryId);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
function persist(session: Session): boolean {
  if (!session.ownerId) {
    const saved = saveManualPlan(session.scope, session.plan);
    session.recoveryWriteFailed = !saved;
    if (saved) retainLocation(session);
    return saved;
  }
  const recovery = recoveryOf(session);
  const saved = writeDeviceData(session.scope, MANUAL_PLAN_RECOVERY_RESOURCE, session.recoveryId, recovery);
  // A denied, corrupted or incomplete device write must not initiate a command
  // whose identity would be lost on reload.
  const stored = readDeviceData(session.scope, MANUAL_PLAN_RECOVERY_RESOURCE, session.recoveryId, (_value): _value is unknown => true);
  session.recoveryWriteFailed = !saved || JSON.stringify(stored) !== JSON.stringify(recovery);
  if (session.recoveryWriteFailed) return false;
  retainLocation(session);
  return true;
}
function stopTimer(session: Session) { if (session.timer) clearTimeout(session.timer); session.timer = null; }
function dispose(session: Session) {
  session.disposed = true; stopTimer(session); session.controller?.abort();
  if (session.retire) session.lease?.signal.removeEventListener("abort", session.retire);
}

/** Account content comes only from the manual-plan RPCs; device records retain
 * pending commands and unsaved wording. Each mount forks its own recovery ID,
 * so another tab can never overwrite this session's pending identity/draft. */
export function useManualPlanPersistence(ownerUserId?: string | null, planId?: string | null) {
  const scope = useMemo(() => currentDeviceDataScope(ownerUserId), [ownerUserId]);
  const ownerToken = deviceDataOwnerToken(scope);
  const routeKey = `${ownerToken}:${planId ?? "new"}`;
  const selectedRecoveryId = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("recovery");
  const currentRoute = useRef(routeKey); currentRoute.current = routeKey;
  const currentRecovery = useRef(selectedRecoveryId); currentRecovery.current = selectedRecoveryId;
  const current = useRef<Session | null>(null);
  const [view, setView] = useState<View>({ session: null, plan: null, revision: 0, status: "opening", message: null, remote: null });
  const actions = useRef({ save: async (_session: Session) => {}, read: async (_session: Session) => {} });

  const active = useCallback((session: Session): boolean => {
    const token = deviceDataOwnerToken(session.scope);
    return current.current === session && !session.disposed &&
      (!session.ownerId || currentRecovery.current === session.selectedRecoveryId || currentRecovery.current === session.recoveryId) &&
      (session.routeKey === currentRoute.current || (session.routeKey === `${token}:new` && currentRoute.current === `${token}:${session.plan.id}`));
  }, []);
  const publish = useCallback((session: Session) => {
    if (!active(session)) return;
    setView({ session, plan: session.hasPlan ? session.plan : null, revision: session.revision,
      status: session.status, message: [session.message,
        session.recoveryWriteFailed && session.dirty && session.hasPlan ?
          "Your latest edits are only in this open editor because device storage failed. Keep it open and retry saving before closing." : null,
      ].filter(Boolean).join(" ") || null, remote: session.remote });
  }, [active]);
  function schedule(session: Session) {
    stopTimer(session);
    if (session.ownerId && session.loaded && session.dirty && !session.pending && session.status === "pending")
      session.timer = setTimeout(() => { session.timer = null; void actions.current.save(session); }, 500);
  }
  const fail = useCallback((session: Session, message: string, status: Status = "error") => {
    session.status = status; session.message = message; publish(session);
  }, [publish]);
  async function read(session: Session) {
    if (!active(session) || !session.lease || session.controller) return;
    const controller = new AbortController(); session.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const wasConflict = session.status === "conflict";
    session.readFailed = false; session.status = "opening"; session.message = null; publish(session);
    try {
      const lease = withOwnerDispatchSignal(session.lease, controller.signal);
      const remote = await readManualPlan({ planId: session.plan.id }, lease);
      if (!active(session)) return;
      lease.assertCurrent();
      session.remote = remote; session.loaded = true;
      if (session.pending) {
        fail(session, wasConflict ? "Review the account version below. Your device edits remain in this editor." :
          "A previous save is unconfirmed. Retry that exact save to check its outcome; your later edits remain in this editor.", wasConflict ? "conflict" : "error");
      } else if (session.dirty && (session.expected !== null || remote !== null)) {
        if (!sameVersion(session.expected, remote ? version(remote) : null)) {
          fail(session, "This plan changed in your account. Your device edits remain in this editor. Review the account version before continuing.", "conflict");
        } else {
          session.status = "pending"; session.message = null; publish(session); schedule(session);
        }
      } else if (remote) {
        session.plan = fromSnapshot(remote); session.expected = version(remote); session.hasPlan = true;
        session.dirty = false; session.revision += 1; session.status = "saved";
        if (!persist(session)) session.message = "Saved in your account. Device recovery is unavailable in this browser.";
        publish(session);
      } else if (!session.hasPlan) {
        fail(session, "This plan is unavailable for this account. Reopen it from your plans.", "unavailable");
      } else if (session.requestedId) {
        fail(session, "This copy is saved only on this device. Save it to your account to use it across devices.", "import");
      } else {
        session.status = "pending"; session.dirty = true; publish(session); schedule(session);
      }
    } catch {
      if (active(session)) {
        session.readFailed = true;
        fail(session, "Couldn’t open the account version. Retry opening before saving.");
      }
    } finally { clearTimeout(timeout); if (session.controller === controller) session.controller = null; }
  }
  async function save(session: Session) {
    stopTimer(session);
    if (!active(session) || !session.hasPlan || session.controller) return;
    if (!session.ownerId) {
      const saved = persist(session); session.status = saved ? "saved" : "error";
      session.message = saved ? null : "Couldn’t save on this device"; publish(session); return;
    }
    if (!session.lease || !ownerDispatchIsCurrent(session.lease)) {
      fail(session, "Your account session changed. Reopen this plan before saving; your edits are kept."); return;
    }
    if (session.readFailed || !session.loaded) { await read(session); return; }
    if (session.status === "conflict") return;
    if (!session.pending && !session.dirty) return;
    if (!session.pending) {
      const command = manualPlanCommand(session.plan, session.expected, crypto.randomUUID());
      if (!command) { fail(session, "This plan contains an invalid date, repeated action identity or too much text. Your wording is kept; correct it before saving."); return; }
      session.pending = command;
    }
    // Persist exact operation bytes before the first async boundary. Subsequent
    // typing updates only recovery.plan; recovery.pending remains immutable.
    if (!persist(session)) { fail(session, "Couldn’t retain a recovery copy on this device. Free browser storage and retry saving."); return; }
    const command = session.pending;
    const controller = new AbortController(); session.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    session.status = "saving"; session.message = null; publish(session);
    try {
      const lease = withOwnerDispatchSignal(session.lease, controller.signal);
      const receipt = await saveManualPlanCommand(command, lease);
      if (!active(session)) return;
      lease.assertCurrent(); session.remote = receipt.snapshot;
      if (receipt.status === "superseded") {
        fail(session, "That save was accepted, then the account version changed. Your newer edits remain in this editor. Review the account version before continuing.", "conflict");
        return;
      }
      session.expected = version(receipt.snapshot); session.pending = null;
      session.dirty = content(session.plan) !== content(fromSnapshot(receipt.snapshot));
      session.status = session.dirty ? "pending" : "saved";
      if (!persist(session)) {
        fail(session, session.dirty ? "The earlier save reached your account, but newer edits could not be retained on this device. Retry saving." :
          "Saved in your account. Device recovery is unavailable in this browser.", session.dirty ? "error" : "saved");
      } else { session.message = null; publish(session); schedule(session); }
    } catch (error) {
      if (active(session)) {
        const code = error instanceof Error ? error.message : "";
        if (/MANUAL_PLAN_(VERSION|OPERATION|SOURCE)_CONFLICT|MANUAL_PLAN_NOT_FOUND/.test(code)) {
          session.remote = null;
          fail(session, "The account version could not accept this save. Your edits remain in this editor. Review the account version before continuing.", "conflict");
        } else if (code === "MANUAL_PLAN_INPUT_INVALID" || code === "MANUAL_PLAN_ITEM_REMOVAL_BLOCKED") {
          session.rejected = { code, command }; session.pending = null;
          persist(session);
          fail(session, code === "MANUAL_PLAN_ITEM_REMOVAL_BLOCKED" ?
            "An action is still referenced and could not be removed. Undo that deletion before saving again. Your edits remain in this editor." :
            "The account could not accept this plan. Check its dates and reduce oversized text before saving again. Your original wording is kept.");
        } else fail(session, "Couldn’t confirm the account save. Your edits remain in this editor. Retry the same save to check its outcome.");
      }
    } finally { clearTimeout(timeout); if (session.controller === controller) session.controller = null; }
  }
  actions.current = { save, read };

  useEffect(() => {
    const previous = current.current;
    const adopted = previous && !previous.disposed && (planId === previous.plan.id || (!planId && !previous.requestedId)) &&
      deviceDataOwnerToken(previous.scope) === ownerToken &&
      ((!previous.ownerId && previous.routeKey === `${ownerToken}:new`) || selectedRecoveryId === previous.recoveryId);
    if (adopted) {
      previous.routeKey = routeKey; previous.selectedRecoveryId = selectedRecoveryId; publish(previous);
      return () => {
        // replaceState may expose recovery first and planId on a later render.
        // Keep this new-plan lifetime across both halves of its own URL update.
        if (previous.routeKey === `${ownerToken}:new` && currentRoute.current === `${ownerToken}:${previous.plan.id}` &&
          currentRecovery.current === previous.recoveryId) return;
        if ((currentRoute.current === previous.routeKey || currentRoute.current === `${ownerToken}:${previous.plan.id}`) && currentRecovery.current === previous.recoveryId &&
          currentRecovery.current !== previous.selectedRecoveryId) return;
        dispose(previous);
      };
    }
    const ownerId = scope.kind === "user" ? scope.userId : "";
    let recovery: ManualPlanRecovery | null = null;
    let invalidRecovery = false;
    if (ownerId && planId) {
      const recoveryId = selectedRecoveryId;
      if (recoveryId && recoveryId.length === 36 && UUID.test(recoveryId)) {
        const raw = readDeviceData(scope, MANUAL_PLAN_RECOVERY_RESOURCE, recoveryId, (_value): _value is unknown => true);
        if (raw !== null) {
          if (manualPlanRecoveryShape(raw) && raw.ownerId === ownerId && raw.plan.id === planId) recovery = raw;
          else invalidRecovery = true;
        }
      }
    }
    const importGuest = ownerId && planId && new URLSearchParams(window.location.search).get("import") === "guest";
    const legacyScope = importGuest ? currentDeviceDataScope() : scope;
    const legacy = ownerId && planId ? readDeviceData(legacyScope, "manual-plan", planId, manualPlanDraftShape) : null;
    if (legacy && legacy.id !== planId) invalidRecovery = true;
    const initial = recovery?.plan ?? legacy ?? (planId ? (!ownerId ? loadManualPlan(scope, planId) : null) : createManualPlan());
    const session: Session = { version: 1, ownerId, scope, routeKey, requestedId: planId ?? null,
      recoveryId: crypto.randomUUID(), selectedRecoveryId, plan: !invalidRecovery && initial ? initial : { id: planId ?? "", title: "", items: [], updatedAt: "" },
      hasPlan: initial !== null && !invalidRecovery, expected: recovery?.expected ?? null,
      pending: recovery?.pending ?? null, dirty: recovery?.dirty ?? Boolean(initial), rejected: recovery?.rejected,
      revision: 0, status: "opening", message: null, remote: null, lease: null,
      loaded: !ownerId, disposed: false, readFailed: false, recoveryWriteFailed: false, controller: null, timer: null, retire: null };
    current.current = session;
    if (invalidRecovery) {
      fail(session, "This device recovery record is invalid. Its original bytes are kept. Reopen the plan from your account library.");
    } else if (!ownerId) {
      if (!initial) fail(session, "This plan is unavailable for this account on this device. Reopen it from your plans.", "unavailable");
      else { session.status = persist(session) ? "saved" : "error"; publish(session); }
    } else {
      try {
        session.lease = captureOwnerDispatch(ownerId);
        // A -> B -> A retires this lifetime even if React never renders B.
        session.retire = () => {
          stopTimer(session);
          if (active(session)) fail(session, "Your account session changed. Reopen this plan before saving; your edits are kept.");
        };
        session.lease.signal.addEventListener("abort", session.retire, { once: true });
        if (initial && !planId && !persist(session)) session.message = "Couldn’t retain a device recovery copy. Retry saving before closing.";
        publish(session); void actions.current.read(session);
      } catch { fail(session, "Sign in again to open this plan. Your device copy is kept."); }
    }
    return () => {
      if (session.routeKey === `${ownerToken}:new` && currentRoute.current === `${ownerToken}:${session.plan.id}`) return;
      if ((currentRoute.current === session.routeKey || currentRoute.current === `${ownerToken}:${session.plan.id}`) && currentRecovery.current === session.recoveryId &&
        currentRecovery.current !== session.selectedRecoveryId) return;
      dispose(session);
    };
    // Session lifetime is owner + requested plan. All asynchronous actions read
    // current refs; changing a draft never rehydrates or retires its lease.
  }, [scope, routeKey, ownerToken, planId, selectedRecoveryId, active, publish, fail]);

  function update(mutator: (plan: ManualPlanState) => ManualPlanState): ManualPlanState | null {
    const session = current.current;
    if (!session || !active(session) || !session.hasPlan || (session.ownerId && (!session.lease || !ownerDispatchIsCurrent(session.lease)))) return null;
    session.plan = { ...mutator(session.plan), updatedAt: new Date().toISOString() }; session.revision += 1; session.dirty = true;
    const saved = persist(session);
    if (!saved) { session.status = "error"; session.message = "Couldn’t retain your latest edits on this device. Retry saving before closing."; }
    else if (!session.ownerId) { session.status = "saved"; session.message = null; }
    else if (!session.pending && session.status !== "conflict" && session.status !== "import" && !session.readFailed) {
      session.status = session.loaded ? "pending" : "opening"; session.message = null; schedule(session);
    }
    publish(session); return session.plan;
  }
  async function retry() { const session = current.current; if (session) await actions.current.save(session); }
  async function reload() { const session = current.current; if (session) await actions.current.read(session); }
  function useAccountVersion() {
    const session = current.current;
    if (!session || !active(session) || !session.remote || session.controller || !session.lease || !ownerDispatchIsCurrent(session.lease)) return;
    // Preserve the abandoned draft/command record intact. The accepted account
    // version starts a different recovery record, never an implicit merge.
    if (!persist(session)) { fail(session, "Couldn’t preserve your device edits. Retry saving the recovery copy before switching versions."); return; }
    session.recoveryId = crypto.randomUUID(); session.plan = fromSnapshot(session.remote); session.expected = version(session.remote);
    session.pending = null; session.dirty = false; session.revision += 1; session.status = "saved"; session.message = null;
    if (!persist(session)) {
      // The account snapshot is already confirmed; keep the previous recovery
      // intact and make reload resolve the account, not the abandoned draft.
      retainLocation(session);
      session.message = "Account version opened. Your previous device edits remain in recovery, but this browser could not retain another copy.";
    }
    publish(session);
  }
  function cancelSave() { current.current?.controller?.abort(); }
  const expired = view.session?.ownerId && (!view.session.lease || !ownerDispatchIsCurrent(view.session.lease));
  const visible = view.session && active(view.session) ? expired ? { ...view, plan: null, remote: null, status: "error" as Status,
    message: "Your account session changed. Reopen this plan before saving; your edits are kept." } : view :
    { plan: null, revision: 0, status: "opening" as Status, message: null, remote: null };
  return { ...visible, sessionId: visible.plan ? view.session?.recoveryId ?? null : null,
    update, retry, reload, useAccountVersion, cancelSave, account: Boolean(ownerUserId) };
}
