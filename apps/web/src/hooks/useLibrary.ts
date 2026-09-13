"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { updateOutcome } from "@/lib/api/outcomes";
import { readManualPlan } from "@/lib/api/manual-plans";
import { parseManualPlanRoutingMetadata, type Document, type ManualPlanSnapshot, type Outcome } from "@prompted/shared";
import { useAuth } from "@/components/providers";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
  withOwnerDispatchSignal,
  type OwnerDispatchLease,
} from "@/lib/browser-principal-state";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";

// Project the authoritative contracts to the fields rendered by the library.
export type LibraryOutcome = Pick<
  Outcome,
  "id" | "user_id" | "situation_text" | "status" | "is_saved" | "updated_at"
>;
export type LibraryDocument = Pick<
  Document,
  "id" | "user_id" | "outcome_id" | "title" | "status" | "is_template"
>;
export interface LibraryItem {
  outcome: LibraryOutcome;
  documents: LibraryDocument[];
  manualPlan?: Pick<ManualPlanSnapshot,
    "owner_id" | "plan_id" | "outcome_id" | "artifact_id" | "revision" | "updated_at" | "title">;
}
interface LibraryCandidate extends LibraryItem {
  manualPlanId?: string;
}
export type LibraryTab = "recents" | "saved" | "templates";
interface Scope {
  ownerId: string | null;
  tab: LibraryTab;
}
interface LibraryState {
  scope: Scope | null;
  items: LibraryItem[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
}
const PAGE_SIZE = 10;
const REQUEST_TIMEOUT = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

function parseItems(value: unknown, scope: Scope): LibraryCandidate[] {
  const ownerId = scope.ownerId;
  if (!ownerId || !Array.isArray(value) || value.length > PAGE_SIZE)
    throw new Error("LIBRARY_RESPONSE_INVALID");
  const seen = new Set<string>();
  const manualPlanIds = new Set<string>();
  return value.map((row: unknown) => {
    if (
      !record(row) ||
      !uuid(row.id) ||
      seen.has(row.id) ||
      row.user_id !== scope.ownerId ||
      typeof row.situation_text !== "string" ||
      typeof row.is_saved !== "boolean" ||
      !["draft", "in_progress", "completed"].includes(String(row.status)) ||
      typeof row.updated_at !== "string" ||
      !Number.isFinite(Date.parse(row.updated_at)) ||
      !Array.isArray(row.documents) ||
      (scope.tab === "saved" && !row.is_saved)
    ) {
      throw new Error("LIBRARY_RESPONSE_INVALID");
    }
    seen.add(row.id);
    const outcome: LibraryOutcome = {
      id: row.id,
      user_id: ownerId,
      situation_text: row.situation_text,
      is_saved: row.is_saved,
      status: row.status as Outcome["status"],
      updated_at: row.updated_at,
    };
    const documentIds = new Set<string>();
    const documents = row.documents.map((doc: unknown): LibraryDocument => {
      if (
        !record(doc) ||
        !uuid(doc.id) ||
        documentIds.has(doc.id) ||
        doc.user_id !== scope.ownerId ||
        doc.outcome_id !== outcome.id ||
        typeof doc.title !== "string" ||
        typeof doc.is_template !== "boolean" ||
        !["draft", "edited", "approved", "exported", "archived"].includes(String(doc.status)) ||
        (scope.tab === "templates" && !doc.is_template)
      )
        throw new Error("LIBRARY_RESPONSE_INVALID");
      documentIds.add(doc.id);
      return {
        id: doc.id,
        user_id: outcome.user_id,
        outcome_id: outcome.id,
        title: doc.title,
        status: doc.status as Document["status"],
        is_template: doc.is_template,
      };
    });
    if (scope.tab === "templates" && documents.length === 0)
      throw new Error("LIBRARY_RESPONSE_INVALID");
    if (!Object.hasOwn(row, "recommendation_payload")) throw new Error("LIBRARY_RESPONSE_INVALID");
    if (row.recommendation_payload !== null) {
      const marker = parseManualPlanRoutingMetadata(row.recommendation_payload);
      if (!marker || documents.length > 0 || scope.tab === "templates" || manualPlanIds.has(marker.plan_id))
        throw new Error("LIBRARY_RESPONSE_INVALID");
      manualPlanIds.add(marker.plan_id);
      return { outcome, documents, manualPlanId: marker.plan_id };
    }
    return { outcome, documents };
  });
}

async function resolveManualPlans(candidates: LibraryCandidate[], lease: OwnerDispatchLease): Promise<LibraryItem[]> {
  const items = await Promise.all(candidates.map(async ({ manualPlanId, ...item }): Promise<LibraryItem> => {
    if (manualPlanId === undefined) return item;
    // The marker routes the read; only the owner-bound artifact snapshot supplies
    // the title and resource identity. Do not expose a provisional document card.
    const plan = await readManualPlan({ outcomeId: item.outcome.id }, lease);
    lease.assertCurrent();
    if (!plan || plan.owner_id !== lease.expectedUserId || plan.outcome_id !== item.outcome.id ||
      plan.plan_id !== manualPlanId) throw new Error("LIBRARY_RESPONSE_INVALID");
    return {
      ...item,
      manualPlan: {
        owner_id: plan.owner_id,
        plan_id: plan.plan_id,
        outcome_id: plan.outcome_id,
        artifact_id: plan.artifact_id,
        revision: plan.revision,
        updated_at: plan.updated_at,
        title: plan.title,
      },
    };
  }));
  const artifacts = new Set<string>();
  for (const item of items) {
    if (!item.manualPlan) continue;
    if (artifacts.has(item.manualPlan.artifact_id)) throw new Error("LIBRARY_RESPONSE_INVALID");
    artifacts.add(item.manualPlan.artifact_id);
  }
  return items;
}

export function useLibrary(tab: LibraryTab) {
  const { user, loading: authLoading } = useAuth();
  const ownerId = user?.id ?? null;
  const scopeRef = useRef<Scope>({ ownerId, tab });
  if (scopeRef.current.ownerId !== ownerId || scopeRef.current.tab !== tab)
    scopeRef.current = { ownerId, tab };
  const scope = scopeRef.current;
  const [state, setState] = useState<LibraryState>({
    scope: null,
    items: [],
    loading: false,
    error: null,
    hasMore: true,
  });
  const requestRef = useRef<{ scope: Scope; controller: AbortController } | null>(null);
  const cursorRef = useRef({ scope, offset: 0, hasMore: true });
  const mounted = useRef(true);
  const mutations = useRef(
    new Map<string, { lease: OwnerDispatchLease; controller: AbortController }>(),
  );
  const [saveState, setSaveState] = useState<{
    ownerId: string | null;
    ids: string[];
    error: string | null;
  }>({ ownerId, ids: [], error: null });

  useEffect(() => {
    for (const [id, mutation] of mutations.current) {
      if (!ownerDispatchIsCurrent(mutation.lease)) {
        mutation.controller.abort();
        mutations.current.delete(id);
      }
    }
    return () => {
      if (requestRef.current?.scope === scope) {
        requestRef.current.controller.abort();
        requestRef.current = null;
      }
    };
  }, [scope]);
  useEffect(() => {
    mounted.current = true;
    const pending = mutations.current;
    return () => {
      mounted.current = false;
      for (const mutation of pending.values()) mutation.controller.abort();
      pending.clear();
    };
  }, []);

  const load = useCallback(
    async (reset = false) => {
      if (authLoading || !mounted.current || scopeRef.current !== scope) return;
      if (!scope.ownerId) {
        setState({
          scope,
          items: [],
          loading: false,
          error: "Sign in again to load your library.",
          hasMore: false,
        });
        return;
      }
      if (
        !reset &&
        (requestRef.current?.scope === scope ||
          (cursorRef.current.scope === scope && !cursorRef.current.hasMore))
      )
        return;
      requestRef.current?.controller.abort();
      const request = { scope, controller: new AbortController() };
      requestRef.current = request;
      const currentOffset =
        reset || cursorRef.current.scope !== scope ? 0 : cursorRef.current.offset;
      const active = () =>
        mounted.current && scopeRef.current === scope && requestRef.current === request;
      let ownerLease: OwnerDispatchLease | null = null;
      const timeout = setTimeout(() => request.controller.abort(), REQUEST_TIMEOUT);
      setState((previous) => ({
        scope,
        items: previous.scope === scope ? previous.items : [],
        loading: true,
        error: null,
        hasMore: previous.scope === scope ? previous.hasMore : true,
      }));
      try {
        ownerLease = captureOwnerDispatch(scope.ownerId);
        const lease = withOwnerDispatchSignal(ownerLease, request.controller.signal);
        const { data, error } = await withOwnerSupabase(lease, async (supabase) => {
          const relation = scope.tab === "templates" ? "documents!inner" : "documents";
          let query = supabase
            .from("outcomes")
            .select(
              "id, user_id, situation_text, status, is_saved, updated_at, recommendation_payload:library_manual_plan_routing_v1, documents:" +
                relation +
                "(id, user_id, outcome_id, title, status, is_template)",
            )
            .eq("user_id", scope.ownerId!)
            .order("updated_at", { ascending: false })
            .order("id", { ascending: false })
            .range(currentOffset, currentOffset + PAGE_SIZE - 1);
          if (scope.tab === "saved") query = query.eq("is_saved", true);
          if (scope.tab === "templates") query = query.eq("documents.is_template", true);
          return await query;
        });
        if (!active()) return;
        lease.assertCurrent();
        if (error) throw error;
        const items = await resolveManualPlans(parseItems(data, scope), lease);
        if (!active()) return;
        lease.assertCurrent();
        const hasMore = items.length === PAGE_SIZE;
        cursorRef.current = { scope, offset: currentOffset + items.length, hasMore };
        setState((previous) => {
          const existing = !reset && previous.scope === scope ? previous.items : [];
          const ids = new Set(existing.map((item) => item.outcome.id));
          return {
            scope,
            items: [...existing, ...items.filter((item) => !ids.has(item.outcome.id))],
            loading: false,
            error: null,
            hasMore,
          };
        });
        if (reset)
          setSaveState({ ownerId: scope.ownerId, ids: [...mutations.current.keys()], error: null });
      } catch {
        if (active() && (!ownerLease || ownerDispatchIsCurrent(ownerLease))) {
          setState((previous) => ({
            ...previous,
            loading: false,
            error: "Could not load your library. Please try again.",
          }));
        }
      } finally {
        clearTimeout(timeout);
        request.controller.abort();
        if (active()) {
          requestRef.current = null;
          setState((previous) => ({ ...previous, loading: false }));
        }
      }
    },
    [authLoading, scope],
  );
  const loadRef = useRef(load);
  loadRef.current = load;

  async function toggleSaved(outcomeId: string, current: boolean): Promise<void> {
    if (
      !scope.ownerId ||
      !mounted.current ||
      scopeRef.current !== scope ||
      mutations.current.has(outcomeId) ||
      (saveState.ownerId === scope.ownerId && saveState.error)
    )
      return;
    const item =
      state.scope === scope ? state.items.find((item) => item.outcome.id === outcomeId) : null;
    if (!item || item.outcome.is_saved !== current || state.loading || state.error) return;
    const controller = new AbortController();
    let ownerLease: OwnerDispatchLease | null = null;
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      ownerLease = captureOwnerDispatch(scope.ownerId);
      const lease = withOwnerDispatchSignal(ownerLease, controller.signal);
      mutations.current.set(outcomeId, { lease, controller });
      setSaveState({ ownerId: scope.ownerId, ids: [...mutations.current.keys()], error: null });
      await updateOutcome(outcomeId, { is_saved: !current }, lease);
      lease.assertCurrent();
      if (!mounted.current) return;
      // Re-read after confirmation: bookmark mutations change the ordering and
      // membership of offset-paginated results. An overlapping read is retired.
      await loadRef.current(true);
    } catch {
      if (
        mounted.current &&
        scopeRef.current.ownerId === scope.ownerId &&
        (!ownerLease || ownerDispatchIsCurrent(ownerLease))
      ) {
        setSaveState({
          ownerId: scope.ownerId,
          ids: [...mutations.current.keys()],
          error: "Could not confirm the bookmark change. Refresh your library before trying again.",
        });
      }
    } finally {
      clearTimeout(timeout);
      if (mutations.current.get(outcomeId)?.controller === controller)
        mutations.current.delete(outcomeId);
      if (mounted.current && scopeRef.current.ownerId === scope.ownerId) {
        setSaveState((previous) => ({ ...previous, ids: [...mutations.current.keys()] }));
      }
    }
  }

  const visibleState =
    state.scope === scope ? state : { items: [], loading: true, error: null, hasMore: true };
  const ownSaves = saveState.ownerId === ownerId;
  return {
    ...visibleState,
    load,
    toggleSaved,
    saveError: ownSaves ? saveState.error : null,
    savingIds: ownSaves ? saveState.ids : [],
  };
}
