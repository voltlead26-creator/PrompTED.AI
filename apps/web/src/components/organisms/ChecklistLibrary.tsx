"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ProgressBar } from "@/components/atoms/ProgressBar";
import styles from "./ChecklistLibrary.module.css";

interface Summary {
  outcomeId: string;
  title: string;
  total: number;
  done: number;
}

interface StoredGuestItem {
  done?: boolean;
}

function loadGuestPlans(): Summary[] {
  const prefix = "prompted:guest-checklist:";
  const savedPrefix = "prompted:guest-checklist-saved:";
  const plans: Summary[] = [];

  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(prefix) || key.startsWith(savedPrefix)) continue;

      const outcomeId = key.slice(prefix.length);
      const explicitlySaved = window.localStorage.getItem(`${savedPrefix}${outcomeId}`) === "true";
      if (!explicitlySaved) continue;

      const raw = window.localStorage.getItem(key);
      const items = raw ? JSON.parse(raw) as StoredGuestItem[] : [];
      plans.push({
        outcomeId,
        title: "Saved checklist or action plan",
        total: items.length,
        done: items.filter((item) => item.done).length,
      });
    }
  } catch {
    return [];
  }

  return plans;
}

export function ChecklistLibrary({ userId }: { userId?: string }) {
  const [items, setItems] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!userId) {
        if (!cancelled) {
          setItems(loadGuestPlans());
          setLoading(false);
        }
        return;
      }

      const supabase = createClient();
      const { data: rows } = await supabase
        .from("checklist_items")
        .select("outcome_id, done")
        .eq("user_id", userId);
      const raw = (rows ?? []) as Array<{ outcome_id: string; done: boolean }>;
      const ids = Array.from(new Set(raw.map((row) => row.outcome_id)));

      if (ids.length === 0) {
        if (!cancelled) {
          setItems([]);
          setLoading(false);
        }
        return;
      }

      const { data: outcomes } = await supabase
        .from("outcomes")
        .select("id, situation_text, recommendation_payload, is_saved")
        .in("id", ids)
        .eq("is_saved", true);

      const next = ((outcomes ?? []) as Array<{
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

      if (!cancelled) {
        setItems(next);
        setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [userId]);

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Saved plans and checklists</h2>
      <p className={styles.description}>Reopen an interactive plan and continue tracking your progress.</p>
      {loading ? (
        <div className={styles.empty}>Loading your saved plans…</div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>Saved checklists and action plans will appear here.</div>
      ) : (
        <div className={styles.grid}>
          {items.map((item) => {
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
