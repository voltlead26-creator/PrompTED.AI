"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import type { ChecklistItem, PersistedChecklistItem } from "@prompted/shared";
import { useAuth } from "@/components/providers";
import { loadLocalChecklist, saveLocalChecklist } from "@/lib/local-checklist-store";
import { currentDeviceDataScope } from "@/lib/owner-bound-device-store";
import {
  isPersistedChecklistItem,
  updateOwnChecklistItem,
} from "@/lib/api/checklists";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
  type OwnerDispatchLease,
} from "@/lib/browser-principal-state";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";

async function fetchPersistedChecklist(
  outcomeId: string,
  userId: string,
  lease: OwnerDispatchLease,
): Promise<PersistedChecklistItem[]> {
  if (userId.trim().toLowerCase() !== lease.expectedUserId) {
    throw new Error("CHECKLIST_OWNER_CONTEXT_MISMATCH");
  }
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase
      .from("checklist_items")
      .select("*")
      .eq("outcome_id", outcomeId)
      .eq("user_id", userId)
      .order("order_index", { ascending: true }),
  );
  if (error) throw error;
  if (
    !(data ?? []).every((item) =>
      isPersistedChecklistItem(item, { outcomeId, userId })
    )
  ) {
    throw new Error("CHECKLIST_DURABLE_REVISION_UNAVAILABLE");
  }
  return (data ?? []) as PersistedChecklistItem[];
}

export function useChecklist(outcomeId: string) {
  const { user, loading: authLoading } = useAuth();
  const deviceScope = useMemo(() => currentDeviceDataScope(user?.id), [user?.id]);
  const [itemsSnapshot, setItemsSnapshot] = useState<{
    identity: string;
    items: ChecklistItem[];
  }>(() => ({ identity: `${user?.id ?? "guest"}\u0000${outcomeId}`, items: [] }));
  const [loading, setLoading] = useState(true);
  const [savingKeys, setSavingKeys] = useState<Set<string>>(() => new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const requestEpochRef = useRef(0);
  const savingKeysRef = useRef(new Set<string>());
  const identity = `${user?.id ?? "guest"}\u0000${outcomeId}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const items = itemsSnapshot.identity === identity ? itemsSnapshot.items : [];
  const setItems = useCallback((next: SetStateAction<ChecklistItem[]>) => {
    setItemsSnapshot((previous) => {
      const currentItems = previous.identity === identity ? previous.items : [];
      return {
        identity,
        items: typeof next === "function" ? next(currentItems) : next,
      };
    });
  }, [identity]);

  const savingKey = useCallback((id: string) => `${identity}\u0000${id}`, [identity]);
  const setItemSaving = useCallback((key: string, saving: boolean) => {
    const next = new Set(savingKeysRef.current);
    if (saving) next.add(key);
    else next.delete(key);
    savingKeysRef.current = next;
    setSavingKeys(next);
  }, []);
  const isSavingItem = useCallback(
    (id: string) => savingKeys.has(savingKey(id)),
    [savingKey, savingKeys],
  );
  const savingItemIds = useMemo(() => {
    const prefix = `${identity}\u0000`;
    return Array.from(savingKeys)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  }, [identity, savingKeys]);

  const load = useCallback(async () => {
    if (authLoading) return;
    const requestIdentity = identity;
    const requestEpoch = ++requestEpochRef.current;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setItems([]);
    savingKeysRef.current = new Set();
    setSavingKeys(new Set());

    if (!user) {
      if (identityRef.current === requestIdentity && requestEpochRef.current === requestEpoch) {
        setItems(loadLocalChecklist(deviceScope, outcomeId));
        setLoading(false);
      }
      return;
    }

    let requestContext: OwnerDispatchLease;
    try {
      requestContext = captureOwnerDispatch(user.id);
    } catch {
      if (identityRef.current === requestIdentity && requestEpochRef.current === requestEpoch) {
        setLoadError("Your signed-in account changed. Try loading this checklist again.");
        setLoading(false);
      }
      return;
    }
    try {
      const persisted = await fetchPersistedChecklist(
        outcomeId,
        user.id,
        requestContext,
      );
      if (
        ownerDispatchIsCurrent(requestContext) &&
        identityRef.current === requestIdentity &&
        requestEpochRef.current === requestEpoch
      ) {
        setItems(persisted);
      }
    } catch {
      if (
        ownerDispatchIsCurrent(requestContext) &&
        identityRef.current === requestIdentity &&
        requestEpochRef.current === requestEpoch
      ) {
        setLoadError(
          "PrompTED could not confirm this checklist's saved revision. Try again.",
        );
      }
    }
    if (
      ownerDispatchIsCurrent(requestContext) &&
      identityRef.current === requestIdentity &&
      requestEpochRef.current === requestEpoch
    ) {
      setLoading(false);
    }
  }, [authLoading, deviceScope, identity, outcomeId, setItems, user]);

  useEffect(() => {
    void load();
    return () => {
      requestEpochRef.current += 1;
    };
  }, [load]);

  async function toggleDone(id: string) {
    const current = items.find((item) => item.id === id);
    const key = savingKey(id);
    if (!current || savingKeysRef.current.has(key)) return;
    const requestIdentity = identity;
    let requestContext: OwnerDispatchLease | null = null;
    if (user?.id) {
      try {
        requestContext = captureOwnerDispatch(user.id);
      } catch {
        setSaveError("Your signed-in account changed. Try that checklist action again.");
        return;
      }
    }

    const nextItems = items.map((item) => item.id === id ? { ...item, done: !item.done } : item);
    setItems((latest) =>
      latest.map((item) => item.id === id ? { ...item, done: !item.done } : item)
    );
    setSaveError(null);

    if (!user) {
      if (!saveLocalChecklist(deviceScope, outcomeId, nextItems)) {
        setItems(items);
        setSaveError("PrompTED could not save that checklist change on this device.");
      }
      return;
    }

    if (!isPersistedChecklistItem(current, { itemId: id, outcomeId, userId: user.id })) {
      setItems(items);
      setLoadError("PrompTED could not confirm this checklist's saved revision. Try again.");
      return;
    }

    setItemSaving(key, true);
    try {
      const result = await updateOwnChecklistItem(
        {
          itemId: id,
          outcomeId,
          expectedMutationToken: current.mutation_token,
          expectedUserId: user.id,
          done: !current.done,
        },
        requestContext!,
      );
      if (
        !ownerDispatchIsCurrent(requestContext!) ||
        identityRef.current !== requestIdentity
      ) return;
      setItems((latest) => latest.map((item) => item.id === id ? result.item : item));
      if (result.status === "revision_conflict") {
        setSaveError("This item changed elsewhere. The latest saved version is shown.");
      }
    } catch {
      if (
        !requestContext ||
        !ownerDispatchIsCurrent(requestContext) ||
        identityRef.current !== requestIdentity
      ) return;
      try {
        const reconciled = await fetchPersistedChecklist(
          outcomeId,
          user.id,
          requestContext,
        );
        if (
          !ownerDispatchIsCurrent(requestContext) ||
          identityRef.current !== requestIdentity
        ) return;
        setItems(reconciled);
        const saved = reconciled.find((item) => item.id === id)?.done === !current.done;
        setSaveError(
          saved
            ? null
            : "The save response was interrupted. The latest saved version is shown.",
        );
      } catch {
        if (
          ownerDispatchIsCurrent(requestContext) &&
          identityRef.current === requestIdentity
        ) {
          setSaveError(
            "PrompTED could not confirm whether that change saved. Reload before changing this item again.",
          );
        }
      }
    } finally {
      if (!requestContext || ownerDispatchIsCurrent(requestContext)) {
        setItemSaving(key, false);
      }
    }
  }

  async function updateText(id: string, text: string) {
    const current = items.find((item) => item.id === id);
    const trimmed = text.trim();
    const key = savingKey(id);
    if (!current || !trimmed) return;
    if (savingKeysRef.current.has(key)) {
      throw new Error("CHECKLIST_ITEM_BUSY");
    }
    const requestIdentity = identity;
    let requestContext: OwnerDispatchLease | null = null;
    if (user?.id) {
      try {
        requestContext = captureOwnerDispatch(user.id);
      } catch {
        setSaveError("Your signed-in account changed. Try that checklist action again.");
        return;
      }
    }
    const updatedAt = new Date().toISOString();
    const nextItems = items.map((item) => item.id === id
      ? { ...item, text: trimmed, updated_at: updatedAt }
      : item);
    setItems((latest) =>
      latest.map((item) => item.id === id
        ? { ...item, text: trimmed, updated_at: updatedAt }
        : item)
    );
    setSaveError(null);
    try {
      if (!user) {
        if (!saveLocalChecklist(deviceScope, outcomeId, nextItems)) {
          throw new Error("LOCAL_CHECKLIST_SAVE_FAILED");
        }
        return;
      }
      if (!isPersistedChecklistItem(current, { itemId: id, outcomeId, userId: user.id })) {
        setItems(items);
        setLoadError("PrompTED could not confirm this checklist's saved revision. Try again.");
        return;
      }
      setItemSaving(key, true);
      const result = await updateOwnChecklistItem(
        {
          itemId: id,
          outcomeId,
          expectedMutationToken: current.mutation_token,
          expectedUserId: user.id,
          text: trimmed,
        },
        requestContext!,
      );
      if (
        ownerDispatchIsCurrent(requestContext!) &&
        identityRef.current === requestIdentity
      ) {
        setItems((latest) => latest.map((item) => item.id === id ? result.item : item));
        if (result.status === "revision_conflict") {
          setSaveError("This item changed elsewhere. The latest saved version is shown.");
        }
      }
    } catch (caught) {
      if (
        (!requestContext || ownerDispatchIsCurrent(requestContext)) &&
        identityRef.current === requestIdentity
      ) {
        if (user) {
          try {
            const reconciled = await fetchPersistedChecklist(
              outcomeId,
              user.id,
              requestContext!,
            );
            if (
              !ownerDispatchIsCurrent(requestContext!) ||
              identityRef.current !== requestIdentity
            ) return;
            setItems(reconciled);
            const saved = reconciled.find((item) => item.id === id)?.text === trimmed;
            setSaveError(
              saved
                ? null
                : "The save response was interrupted. The latest saved wording is shown.",
            );
            return;
          } catch {
            setSaveError(
              "PrompTED could not confirm whether that wording saved. Reload before changing this item again.",
            );
          }
        } else {
          setItems((latest) => latest.map((item) => item.id === current.id ? current : item));
          setSaveError("PrompTED could not save that wording on this device.");
        }
      }
      throw caught;
    } finally {
      if (!requestContext || ownerDispatchIsCurrent(requestContext)) {
        setItemSaving(key, false);
      }
    }
  }

  const total = items.length;
  const done = items.filter((item) => item.done).length;
  const progress = total > 0 ? done / total : 0;

  return {
    items,
    loading,
    error: loadError,
    saveError,
    retry: load,
    isSavingItem,
    savingItemIds,
    toggleDone,
    updateText,
    total,
    done,
    progress,
  };
}

export function useWhatsDue(userId: string) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setItems([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const today = new Date().toISOString().split("T")[0]!;
    const in14 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0]!;

    let active = true;
    let requestContext: OwnerDispatchLease;
    try {
      requestContext = captureOwnerDispatch(userId);
    } catch {
      setItems([]);
      setError("Your signed-in account changed. Try loading due items again.");
      setLoading(false);
      return;
    }
    void withOwnerSupabase(requestContext, async (supabase) =>
      await supabase
        .from("checklist_items")
        .select("*")
        .eq("user_id", userId)
        .eq("done", false)
        .gte("due_date", today)
        .lte("due_date", in14)
        .order("due_date", { ascending: true }),
    ).then(({ data, error: queryError }) => {
      if (queryError) throw queryError;
      if (!active || !ownerDispatchIsCurrent(requestContext)) return;
      setItems((data ?? []) as ChecklistItem[]);
      setError(null);
      setLoading(false);
    }).catch(() => {
      if (active && ownerDispatchIsCurrent(requestContext)) {
        setItems([]);
        setError("PrompTED could not confirm which checklist items are due.");
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [userId]);

  return { items, loading, error };
}
