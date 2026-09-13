"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { isManualPlanId, parseManualPlanList, type ManualPlanSummary } from "@prompted/shared";
import { listRemoteManualPlans } from "@/lib/api/manual-plans";
import {
  captureOwnerDispatch, ownerDispatchIsCurrent, withOwnerDispatchSignal, type OwnerDispatchLease,
} from "@/lib/browser-principal-state";
import { listManualPlans, type ManualPlanState } from "./manual-plan-store";
import { listManualPlanRecoveries, manualPlanDraftShape, type ManualPlanRecovery } from "./manual-plan-recovery";
import { currentDeviceDataScope, deviceDataOwnerToken, listDeviceData } from "@/lib/owner-bound-device-store";
import styles from "./PlansHub.module.css";

const PAGE_SIZE = 20;
const LOAD_ERROR = "PrompTED could not load your account plans. Retry to refresh the list.";
const SESSION_ERROR = "Your account session changed. Retry to load plans for the current account.";

interface AccountPlansState {
  items: ManualPlanSummary[];
  hasMore: boolean;
  loading: boolean;
  error: string | null;
}

function AccountManualPlans({ ownerId }: { ownerId: string }) {
  const [request, setRequest] = useState<{ offset: number; existing: ManualPlanSummary[] }>({ offset: 0, existing: [] });
  const [state, setState] = useState<AccountPlansState>({ items: [], hasMore: false, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    let timedOut = false;
    let original: OwnerDispatchLease | null = null;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const accountChanged = () => {
      if (cancelled) return;
      clearTimeout(timer);
      controller.abort();
      setState({ items: [], hasMore: false, loading: false, error: SESSION_ERROR });
    };
    setState({ items: request.existing, hasMore: false, loading: true, error: null });

    async function load() {
      original = captureOwnerDispatch(ownerId);
      original.signal.addEventListener("abort", accountChanged, { once: true });
      const lease = withOwnerDispatchSignal(original, controller.signal);
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        setState({ items: request.existing, hasMore: false, loading: false, error: LOAD_ERROR });
      }, 15_000);
      const value = await listRemoteManualPlans({ limit: PAGE_SIZE, offset: request.offset }, lease);
      if (cancelled || timedOut) return;
      lease.assertCurrent();
      const result = parseManualPlanList(value, ownerId);
      if (!result || result.items.length > PAGE_SIZE || (result.has_more && result.items.length !== PAGE_SIZE)) {
        throw new Error("MANUAL_PLAN_LIST_INVALID");
      }
      const next = [...request.existing, ...result.items];
      for (const field of ["plan_id", "outcome_id", "artifact_id"] as const) {
        if (new Set(next.map(item => item[field])).size !== next.length) throw new Error("MANUAL_PLAN_LIST_CHANGED");
      }
      const previous = request.existing.at(-1);
      const first = result.items[0];
      if (previous && first && (previous.updated_at < first.updated_at ||
        (previous.updated_at === first.updated_at && previous.artifact_id >= first.artifact_id))) {
        throw new Error("MANUAL_PLAN_LIST_CHANGED");
      }
      setState({ items: next, hasMore: result.has_more, loading: false, error: null });
    }

    void load().catch(() => {
      if (cancelled || timedOut || (original && !ownerDispatchIsCurrent(original))) return;
      setState({ items: request.existing, hasMore: false, loading: false, error: original ? LOAD_ERROR : SESSION_ERROR });
    }).finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      clearTimeout(timer);
      original?.signal.removeEventListener("abort", accountChanged);
      controller.abort();
    };
  }, [ownerId, request]);

  return (
    <section className={styles.manualLibrary} aria-labelledby="account-manual-plans-heading">
      <div>
        <h2 id="account-manual-plans-heading">Plans saved to your account</h2>
        <p>Reopen a saved manual plan from any device signed in to this account.</p>
      </div>
      {state.items.length > 0 && (
        <div className={styles.manualGrid}>
          {state.items.map(plan => (
            <Link key={plan.plan_id} href={`/plans?create=manual&plan=${encodeURIComponent(plan.plan_id)}`} className={styles.manualCard}>
              <strong>{plan.title.trim() ? plan.title : "Untitled action plan"}</strong>
              <span>{plan.completed_count} / {plan.item_count} complete</span>
              <span>Open saved plan</span>
            </Link>
          ))}
        </div>
      )}
      {state.loading && <p role="status">Loading your account plans…</p>}
      {state.error && (
        <div role="alert">
          <p>{state.error}</p>
          <button type="button" onClick={() => setRequest({ offset: 0, existing: [] })}>Retry account plans</button>
        </div>
      )}
      {!state.loading && !state.error && state.items.length === 0 && <p>No manual plans saved to your account yet.</p>}
      {state.hasMore && !state.loading && !state.error && (
        <button type="button" onClick={() => setRequest({ offset: state.items.length, existing: state.items })}>
          Load more account plans
        </button>
      )}
    </section>
  );
}

export function ManualPlansLibrary({ ownerUserId }: { ownerUserId?: string | null }) {
  const deviceScope = useMemo(() => currentDeviceDataScope(ownerUserId), [ownerUserId]);
  const guestScope = useMemo(() => currentDeviceDataScope(), []);
  const ownerToken = deviceDataOwnerToken(deviceScope);
  const [boundPlans, setBoundPlans] = useState<{
    ownerToken: string;
    plans: ManualPlanState[];
    recoveries: Array<{ id: string; value: ManualPlanRecovery }>;
    guestPlans: ManualPlanState[];
  } | null>(null);
  const plans = boundPlans?.ownerToken === ownerToken ? boundPlans.plans : [];
  const recoveries = boundPlans?.ownerToken === ownerToken ? boundPlans.recoveries : [];
  const guestPlans = boundPlans?.ownerToken === ownerToken ? boundPlans.guestPlans : [];
  const signedIn = deviceScope.kind === "user";

  useEffect(() => {
    const refresh = () => setBoundPlans({
      ownerToken,
      plans: listManualPlans(deviceScope),
      recoveries: listManualPlanRecoveries(deviceScope),
      guestPlans: deviceScope.kind === "user" ? listDeviceData(guestScope, "manual-plan", manualPlanDraftShape)
        .flatMap(({ id, value }) => id === value.id && isManualPlanId(id) ? [value] : []) : [],
    });
    refresh();
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [deviceScope, guestScope, ownerToken]);

  return (
    <>
    {deviceScope.kind === "user" && <AccountManualPlans key={ownerToken} ownerId={deviceScope.userId} />}
    {plans.length > 0 && (
    <section className={styles.manualLibrary} aria-labelledby="manual-plans-heading">
      <div>
        <h2 id="manual-plans-heading">{signedIn ? "Plan copies saved on this device" : "Live plans saved on this device"}</h2>
        <p>{signedIn ? "These are device copies. Open one to review its account save status." : "Reopen a plan and keep editing exactly where you left it."}</p>
      </div>
      <div className={styles.manualGrid}>
        {plans.map((plan) => {
          const done = plan.items.filter((item) => item.done).length;
          return (
            <Link
              key={plan.id}
              href={`/plans?create=manual&plan=${encodeURIComponent(plan.id)}`}
              className={styles.manualCard}
            >
              <strong>{plan.title.trim() || "Untitled action plan"}</strong>
              <span>{done} / {plan.items.length} complete</span>
              <span>{signedIn ? "Review device copy" : "Open live editor"}</span>
            </Link>
          );
        })}
      </div>
    </section>
    )}
    {recoveries.length > 0 && (
      <section className={styles.manualLibrary} aria-labelledby="manual-plan-recoveries-heading">
        <div>
          <h2 id="manual-plan-recoveries-heading">Unsaved recovery copies on this device</h2>
          <p>Each copy keeps the edits from its editor tab. Open a copy to review and finish its account save.</p>
        </div>
        <div className={styles.manualGrid}>
          {recoveries.map(({ id, value }, index) => (
            <Link key={id} href={`/plans?create=manual&plan=${encodeURIComponent(value.plan.id)}&recovery=${encodeURIComponent(id)}`} className={styles.manualCard}>
              <strong>{value.plan.title.trim() ? value.plan.title : "Untitled action plan"}</strong>
              <span>{value.pending ? "Account save unconfirmed" : "Changes saved only on this device"}</span>
              <span>Open recovery copy {index + 1}</span>
            </Link>
          ))}
        </div>
      </section>
    )}
    {guestPlans.length > 0 && (
      <section className={styles.manualLibrary} aria-labelledby="guest-manual-plans-heading">
        <div>
          <h2 id="guest-manual-plans-heading">Guest plans on this device</h2>
          <p>Review a guest plan before saving it to this account. Its original device copy is kept.</p>
        </div>
        <div className={styles.manualGrid}>
          {guestPlans.map(plan => (
            <Link key={plan.id} href={`/plans?create=manual&plan=${encodeURIComponent(plan.id)}&import=guest`} className={styles.manualCard}>
              <strong>{plan.title.trim() ? plan.title : "Untitled action plan"}</strong>
              <span>Saved only on this device</span>
              <span>Review and save to my account</span>
            </Link>
          ))}
        </div>
      </section>
    )}
    </>
  );
}
