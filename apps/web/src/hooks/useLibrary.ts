"use client";

import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Document, Outcome } from "@prompted/shared";

export interface LibraryItem {
  outcome: Outcome;
  documents: Document[];
}

export type LibraryTab = "recents" | "saved" | "templates";

interface UseLibraryState {
  items: LibraryItem[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
}

const PAGE_SIZE = 10;

export function useLibrary(tab: LibraryTab) {
  const [state, setState] = useState<UseLibraryState>({
    items: [],
    loading: false,
    error: null,
    hasMore: true,
  });
  const [offset, setOffset] = useState(0);

  const load = useCallback(
    async (reset = false) => {
      setState((s) => ({ ...s, loading: true, error: null }));
      const supabase = createClient();

      const currentOffset = reset ? 0 : offset;

      let query = supabase
        .from("outcomes")
        .select(
          `
          id, user_id, business_id, bundle_id, situation_text,
          recommendation_payload, status, is_saved, created_at, updated_at,
          documents:documents(id, user_id, outcome_id, template_id, title,
            status, format, is_template, created_at, updated_at)
        `,
        )
        .order("updated_at", { ascending: false })
        .range(currentOffset, currentOffset + PAGE_SIZE - 1);

      if (tab === "saved") {
        query = query.eq("is_saved", true);
      } else if (tab === "templates") {
        // templates: outcomes with at least one document where is_template = true
        query = query.eq("documents.is_template", true);
      }

      const { data, error } = await query;

      if (error) {
        setState((s) => ({ ...s, loading: false, error: "Could not load your library." }));
        return;
      }

      const items = (data ?? []).map((row) => ({
        outcome: {
          id: row.id,
          user_id: row.user_id,
          business_id: row.business_id,
          bundle_id: row.bundle_id,
          situation_text: row.situation_text,
          recommendation_payload: row.recommendation_payload,
          status: row.status,
          is_saved: row.is_saved,
          created_at: row.created_at,
          updated_at: row.updated_at,
        } as Outcome,
        documents: (row.documents ?? []) as Document[],
      }));

      setState((s) => ({
        loading: false,
        error: null,
        items: reset ? items : [...s.items, ...items],
        hasMore: items.length === PAGE_SIZE,
      }));
      setOffset(currentOffset + items.length);
    },
    [tab, offset],
  );

  async function toggleSaved(outcomeId: string, current: boolean) {
    const supabase = createClient();
    await supabase
      .from("outcomes")
      .update({ is_saved: !current })
      .eq("id", outcomeId);

    setState((s) => ({
      ...s,
      items: s.items.map((item) =>
        item.outcome.id === outcomeId
          ? { ...item, outcome: { ...item.outcome, is_saved: !current } }
          : item,
      ),
    }));
  }

  return { ...state, load, toggleSaved };
}
