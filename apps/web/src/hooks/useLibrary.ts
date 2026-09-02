"use client";

import { useCallback, useState } from "react";
import { updateOutcome } from "@/lib/api/outcomes";
import type { Document, Outcome } from "@prompted/shared";
import { useAuth } from "@/components/providers";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
} from "@/lib/browser-principal-state";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";

export interface LibraryItem {
  outcome: Outcome;
  documents: Document[];
}

export type LibraryTab = "recents" | "saved" | "templates";

interface UseLibraryState {
  ownerId: string | null;
  items: LibraryItem[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
}

const PAGE_SIZE = 10;

export function useLibrary(tab: LibraryTab) {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<UseLibraryState>({
    ownerId: null,
    items: [],
    loading: false,
    error: null,
    hasMore: true,
  });
  const [offset, setOffset] = useState(0);

  const load = useCallback(
    async (reset = false) => {
      if (authLoading) return;
      if (!user?.id) {
        setState({
          ownerId: null,
          items: [],
          loading: false,
          error: "Sign in again to load your library.",
          hasMore: true,
        });
        setOffset(0);
        return;
      }
      const requestContext = captureOwnerDispatch(user.id);
      const requestedOwnerId = requestContext.expectedUserId;
      setState((current) => ({
        ownerId: requestedOwnerId,
        items: reset || current.ownerId !== requestedOwnerId ? [] : current.items,
        loading: true,
        error: null,
        hasMore: current.ownerId === requestedOwnerId ? current.hasMore : true,
      }));

      const currentOffset = reset || state.ownerId !== requestedOwnerId ? 0 : offset;

      const { data, error } = await withOwnerSupabase(
        requestContext,
        async (supabase) => {
          let query = supabase
            .from("outcomes")
            .select(
              `
          id, user_id, business_id, bundle_id, situation_text,
          recommendation_payload, status, is_saved, conversation_revision,
          created_at, updated_at,
          documents:documents(id, user_id, outcome_id, template_id, title,
            status, format, is_template, created_at, updated_at)
        `,
            )
            .order("updated_at", { ascending: false })
            .range(currentOffset, currentOffset + PAGE_SIZE - 1);

          if (tab === "saved") {
            query = query.eq("is_saved", true);
          } else if (tab === "templates") {
            query = query.eq("documents.is_template", true);
          }
          return await query;
        },
      );

      if (error) {
        if (ownerDispatchIsCurrent(requestContext)) {
          setState((s) => ({
            ...s,
            ownerId: requestedOwnerId,
            loading: false,
            error: "Could not load your library.",
          }));
        }
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
          conversation_revision: row.conversation_revision,
          created_at: row.created_at,
          updated_at: row.updated_at,
        } as Outcome,
        documents: (row.documents ?? []) as Document[],
      }));

      requestContext.assertCurrent();
      setState((s) => ({
        ownerId: requestedOwnerId,
        loading: false,
        error: null,
        items:
          reset || s.ownerId !== requestedOwnerId
            ? items
            : [...s.items, ...items],
        hasMore: items.length === PAGE_SIZE,
      }));
      setOffset(currentOffset + items.length);
    },
    [authLoading, offset, state.ownerId, tab, user?.id],
  );

  async function toggleSaved(outcomeId: string, current: boolean) {
    if (!user?.id) throw new Error("AUTH_REQUIRED");
    const requestContext = captureOwnerDispatch(user.id);
    await updateOutcome(outcomeId, { is_saved: !current }, requestContext);
    requestContext.assertCurrent();

    setState((s) => ({
      ...s,
      items:
        s.ownerId === requestContext.expectedUserId
          ? s.items.map((item) =>
              item.outcome.id === outcomeId
                ? { ...item, outcome: { ...item.outcome, is_saved: !current } }
                : item,
            )
          : [],
    }));
  }

  const visibleState = state.ownerId === user?.id
    ? state
    : {
        ownerId: user?.id ?? null,
        items: [],
        loading: Boolean(user?.id) || authLoading,
        error: null,
        hasMore: true,
      };
  return { ...visibleState, load, toggleSaved };
}
