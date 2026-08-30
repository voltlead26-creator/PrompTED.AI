"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ChecklistItem } from "@prompted/shared";

const guestKey = (outcomeId: string) => `prompted:guest-checklist:${outcomeId}`;

function readGuestItems(outcomeId: string): ChecklistItem[] {
  try {
    const raw = window.localStorage.getItem(guestKey(outcomeId));
    return raw ? JSON.parse(raw) as ChecklistItem[] : [];
  } catch {
    return [];
  }
}

function writeGuestItems(outcomeId: string, items: ChecklistItem[]) {
  try {
    window.localStorage.setItem(guestKey(outcomeId), JSON.stringify(items));
  } catch {
    // Guest persistence is best-effort during testing.
  }
}

export function useChecklist(outcomeId: string) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [guestMode, setGuestMode] = useState(false);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    const guestItems = readGuestItems(outcomeId);
    if (guestItems.length > 0) {
      setItems(guestItems);
      setGuestMode(true);
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { data, error } = await supabase
      .from("checklist_items")
      .select("*")
      .eq("outcome_id", outcomeId)
      .order("order_index", { ascending: true });

    if (error) {
      setGuestMode(true);
      setItems([]);
    } else {
      setItems((data ?? []) as ChecklistItem[]);
    }
    setLoading(false);
  }, [outcomeId]);

  useEffect(() => { void load(); }, [load]);

  async function toggleDone(id: string) {
    const current = items.find((item) => item.id === id);
    if (!current) return;

    const nextItems = items.map((item) => item.id === id ? { ...item, done: !item.done } : item);
    setItems(nextItems);

    if (guestMode || current.user_id === "guest") {
      writeGuestItems(outcomeId, nextItems);
      return;
    }

    const supabase = createClient();
    await supabase
      .from("checklist_items")
      .update({ done: !current.done, updated_at: new Date().toISOString() })
      .eq("id", id);
  }

  async function updateText(id: string, text: string) {
    const current = items.find((item) => item.id === id);
    const trimmed = text.trim();
    if (!current || !trimmed || savingItemId) return;
    const updatedAt = new Date().toISOString();
    const nextItems = items.map((item) => item.id === id
      ? { ...item, text: trimmed, updated_at: updatedAt }
      : item);
    setItems(nextItems);
    setSavingItemId(id);
    try {
      if (guestMode || current.user_id === "guest") {
        writeGuestItems(outcomeId, nextItems);
        return;
      }
      const supabase = createClient();
      const { error } = await supabase
        .from("checklist_items")
        .update({ text: trimmed, updated_at: updatedAt })
        .eq("id", id);
      if (error) throw error;
    } catch (error) {
      await load();
      throw error;
    } finally {
      setSavingItemId(null);
    }
  }

  const total = items.length;
  const done = items.filter((item) => item.done).length;
  const progress = total > 0 ? done / total : 0;

  return { items, loading, savingItemId, toggleDone, updateText, total, done, progress };
}

export function useWhatsDue(userId: string) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const today = new Date().toISOString().split("T")[0]!;
    const in14 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0]!;

    supabase
      .from("checklist_items")
      .select("*")
      .eq("user_id", userId)
      .eq("done", false)
      .gte("due_date", today)
      .lte("due_date", in14)
      .order("due_date", { ascending: true })
      .then(({ data }) => {
        setItems((data ?? []) as ChecklistItem[]);
        setLoading(false);
      });
  }, [userId]);

  return { items, loading };
}
