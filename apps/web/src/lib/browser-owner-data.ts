"use client";

import { purgeUserDeviceData } from "./owner-bound-device-store";
import { purgeWorkspaceCachesForUser } from "./workspace-store";
import { purgeEditOperationIdentitiesForUser } from "@/hooks/useEditWithTED";

const CAPTURED_ADMISSION_PREFIX = "prompted:captured-admission:v2";

function purgeCapturedAdmissions(userId: string): boolean {
  const prefix = `${CAPTURED_ADMISSION_PREFIX}:${encodeURIComponent(userId)}:`;
  try {
    const keys: string[] = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Purges only the deleted account's browser-owned content. Guest/device data,
 * another account's data, and non-sensitive presentation preferences remain.
 */
export function purgeBrowserDataForUser(userId: string): boolean {
  if (!userId.trim()) return false;
  return [
    purgeWorkspaceCachesForUser(userId),
    purgeUserDeviceData(userId),
    purgeCapturedAdmissions(userId),
    purgeEditOperationIdentitiesForUser(userId),
  ].every(Boolean);
}
