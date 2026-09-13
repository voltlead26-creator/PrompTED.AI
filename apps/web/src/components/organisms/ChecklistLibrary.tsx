"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { parseManualPlanRoutingMetadata } from "@prompted/shared";
import { ProgressBar } from "@/components/atoms/ProgressBar";
import { listSavedLocalChecklists } from "@/lib/local-checklist-store";
import {
  currentDeviceDataScope,
  deviceDataOwnerToken,
  type DeviceDataScope,
} from "@/lib/owner-bound-device-store";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
  withOwnerDispatchSignal,
  type OwnerDispatchLease,
} from "@/lib/browser-principal-state";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";
import styles from "./ChecklistLibrary.module.css";

interface Summary {
  outcomeId: string;
  title: string;
  total: number;
  done: number;
}

const LOAD_ERROR = "PrompTED could not load your saved plans. Try again.";
const SESSION_ERROR = "Your account session changed. Try again to load your saved plans.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isUuid = (value: unknown): value is string => typeof value === "string" && value.length === 36 && UUID.test(value);
function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function exactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function queryData(value: unknown): unknown {
  if (!record(value) || !Object.hasOwn(value, "data") || !Object.hasOwn(value, "error") || value.error !== null) {
    throw new Error("CHECKLIST_LIBRARY_READ_FAILED");
  }
  return value.data;
}

function checklistCounts(value: unknown, ownerId: string): Map<string, { total: number; done: number }> {
  if (!Array.isArray(value)) throw new Error("CHECKLIST_LIBRARY_ROWS_INVALID");
  const counts = new Map<string, { total: number; done: number }>();
  const ids = new Set<string>();
  for (const row of value) {
    if (!exactRecord(row, ["id", "user_id", "outcome_id", "done"]) || !isUuid(row.id) ||
      ids.has(row.id) || row.user_id !== ownerId || !isUuid(row.outcome_id) || typeof row.done !== "boolean") {
      throw new Error("CHECKLIST_LIBRARY_ROWS_INVALID");
    }
    ids.add(row.id);
    const count = counts.get(row.outcome_id) ?? { total: 0, done: 0 };
    count.total += 1;
    if (row.done) count.done += 1;
    counts.set(row.outcome_id, count);
  }
  return counts;
}

function savedSummaries(value: unknown, counts: Map<string, { total: number; done: number }>, ownerId: string): Summary[] {
  if (!Array.isArray(value)) throw new Error("CHECKLIST_LIBRARY_OUTCOMES_INVALID");
  const result: Summary[] = [];
  const ids = new Set<string>();
  for (const row of value) {
    if (!exactRecord(row, ["id", "user_id", "situation_text", "recommendation_payload", "is_saved"]) ||
      !isUuid(row.id) || ids.has(row.id) || !counts.has(row.id) || row.user_id !== ownerId || row.is_saved !== true ||
      typeof row.situation_text !== "string") throw new Error("CHECKLIST_LIBRARY_OUTCOMES_INVALID");
    ids.add(row.id);
    const payload = row.recommendation_payload;
    if (payload !== null && !record(payload)) throw new Error("CHECKLIST_LIBRARY_OUTCOMES_INVALID");
    if (payload && Object.hasOwn(payload, "manual_plan")) {
      if (!parseManualPlanRoutingMetadata(payload)) throw new Error("MANUAL_PLAN_ROUTING_INVALID");
      // Manual content and navigation belong to the authoritative manual-plan
      // library, even though its checklist projection shares these tables.
      continue;
    }
    let reason: string | null = null;
    if (payload && Object.hasOwn(payload, "primary") && payload.primary !== null) {
      if (!record(payload.primary)) throw new Error("CHECKLIST_LIBRARY_OUTCOMES_INVALID");
      if (Object.hasOwn(payload.primary, "reason") && payload.primary.reason !== null) {
        if (typeof payload.primary.reason !== "string") throw new Error("CHECKLIST_LIBRARY_OUTCOMES_INVALID");
        reason = payload.primary.reason;
      }
    }
    const count = counts.get(row.id)!;
    result.push({ outcomeId: row.id, title: reason || row.situation_text || "Interactive plan", ...count });
  }
  return result;
}

function loadGuestPlans(scope: DeviceDataScope): Summary[] {
  return listSavedLocalChecklists(scope).map(({ outcomeId, items }) => ({
    outcomeId,
    title: "Saved checklist or action plan",
    total: items.length,
    done: items.filter((item) => item.done).length,
  }));
}

export function ChecklistLibrary({ userId }: { userId?: string }) {
  const deviceScope = useMemo(() => currentDeviceDataScope(userId), [userId]);
  const ownerToken = deviceDataOwnerToken(deviceScope);
  const [items, setItems] = useState<Summary[]>([]);
  const [itemsOwner, setItemsOwner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

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
      setItems([]);
      setError(SESSION_ERROR);
      setLoading(false);
    };

    async function load() {
      setLoading(true);
      setError(null);
      setItemsOwner(ownerToken);
      setItems([]);
      if (!userId) {
        if (!cancelled) {
          setItems(loadGuestPlans(deviceScope));
          setLoading(false);
        }
        return;
      }

      original = captureOwnerDispatch(userId);
      original.signal.addEventListener("abort", accountChanged, { once: true });
      const requestContext = withOwnerDispatchSignal(original, controller.signal);
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        setItems([]);
        setError(LOAD_ERROR);
        setLoading(false);
      }, 15_000);
      const next = await withOwnerSupabase(
        requestContext,
        async (supabase) => {
          requestContext.assertCurrent();
          const response = await supabase
            .from("checklist_items")
            .select("id, user_id, outcome_id, done")
            .eq("user_id", userId)
            .abortSignal(requestContext.signal);
          requestContext.assertCurrent();
          const counts = checklistCounts(queryData(response), userId);
          const ids = Array.from(counts.keys());

          if (ids.length === 0) return [];

          const outcomesResponse = await supabase
            .from("outcomes")
            .select("id, user_id, situation_text, recommendation_payload, is_saved")
            .in("id", ids)
            .eq("is_saved", true)
            .eq("user_id", userId)
            .abortSignal(requestContext.signal);
          requestContext.assertCurrent();
          return savedSummaries(queryData(outcomesResponse), counts, userId);
        },
      );

      if (!cancelled && !timedOut && ownerDispatchIsCurrent(requestContext)) {
        setItems(next);
        setLoading(false);
      }
    }

    void load().catch(() => {
      if (!cancelled && !timedOut && (!original || ownerDispatchIsCurrent(original))) {
        setItems([]);
        setError(original ? LOAD_ERROR : SESSION_ERROR);
        setLoading(false);
      }
    }).finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      clearTimeout(timer);
      original?.signal.removeEventListener("abort", accountChanged);
      controller.abort();
    };
  }, [deviceScope, ownerToken, retryToken, userId]);

  const visibleItems = itemsOwner === ownerToken ? items : [];
  const visibleLoading = itemsOwner === ownerToken ? loading : true;

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Saved plans and checklists</h2>
      <p className={styles.description}>Reopen an interactive plan and continue tracking your progress.</p>
      {visibleLoading ? (
        <div className={styles.empty}>Loading your saved plans…</div>
      ) : error ? (
        <div className={styles.empty} role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setRetryToken((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className={styles.empty}>Saved checklists and action plans will appear here.</div>
      ) : (
        <div className={styles.grid}>
          {visibleItems.map((item) => {
            const progress = item.total ? item.done / item.total : 0;
            return (
              <Link key={item.outcomeId} href={`/outcomes/${item.outcomeId}/checklist`} className={styles.card}>
                <div className={styles.cardTop}>
                  <h3>{item.title}</h3>
                  <span>{item.done} / {item.total}</span>
                </div>
                <ProgressBar value={progress} label={`${Math.round(progress * 100)}% complete`} />
                <span className={styles.open}>Open interactive plan</span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
