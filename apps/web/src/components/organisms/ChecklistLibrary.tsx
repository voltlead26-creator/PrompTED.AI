"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
} from "@/lib/browser-principal-state";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";
import styles from "./ChecklistLibrary.module.css";

interface Summary {
  outcomeId: string;
  title: string;
  total: number;
  done: number;
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

      const requestContext = captureOwnerDispatch(userId);
      const { raw, outcomes } = await withOwnerSupabase(
        requestContext,
        async (supabase) => {
          const { data: rows, error: rowsError } = await supabase
            .from("checklist_items")
            .select("outcome_id, done")
            .eq("user_id", userId);
          if (rowsError) throw rowsError;
          const rawRows = (rows ?? []) as Array<{ outcome_id: string; done: boolean }>;
          const ids = Array.from(new Set(rawRows.map((row) => row.outcome_id)));

          if (ids.length === 0) return { raw: rawRows, outcomes: [] };

          const { data: outcomeRows, error: outcomesError } = await supabase
            .from("outcomes")
            .select("id, situation_text, recommendation_payload, is_saved")
            .in("id", ids)
            .eq("is_saved", true)
            .eq("user_id", userId);
          if (outcomesError) throw outcomesError;
          return { raw: rawRows, outcomes: outcomeRows ?? [] };
        },
      );

      const next = (outcomes as Array<{
        id: string;
        situation_text: string;
        recommendation_payload: { primary?: { reason?: string } } | null;
      }>).map((outcome) => {
        const own = raw.filter((row) => row.outcome_id === outcome.id);
        return {
          outcomeId: outcome.id,
          title: outcome.recommendation_payload?.primary?.reason || outcome.situation_text || "Interactive plan",
          total: own.length,
          done: own.filter((row) => row.done).length,
        };
      });

      if (!cancelled && ownerDispatchIsCurrent(requestContext)) {
        setItems(next);
        setLoading(false);
      }
    }

    void load().catch(() => {
      if (!cancelled) {
        setItems([]);
        setError("PrompTED could not load your saved plans. Try again.");
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
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
