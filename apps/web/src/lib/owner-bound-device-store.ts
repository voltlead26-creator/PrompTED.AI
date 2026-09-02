"use client";

export type DeviceDataScope =
  | { kind: "guest"; deviceId: string }
  | { kind: "user"; userId: string };

interface DeviceDataEnvelope<T> {
  version: 2;
  owner: string;
  resource: string;
  id: string;
  value: T;
}

const PREFIX = "prompted:device-data:v2";
const DEVICE_ID_KEY = `${PREFIX}:guest-device-id`;
let volatileDeviceId: string | null = null;

function makeDeviceId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function currentDeviceDataScope(userId?: string | null): DeviceDataScope {
  const normalizedUserId = userId?.trim();
  if (normalizedUserId) return { kind: "user", userId: normalizedUserId };
  if (typeof window === "undefined") {
    volatileDeviceId ??= makeDeviceId();
    return { kind: "guest", deviceId: volatileDeviceId };
  }
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY)?.trim();
    const deviceId = stored || volatileDeviceId || makeDeviceId();
    volatileDeviceId = deviceId;
    if (!stored) localStorage.setItem(DEVICE_ID_KEY, deviceId);
    return { kind: "guest", deviceId };
  } catch {
    volatileDeviceId ??= makeDeviceId();
    return { kind: "guest", deviceId: volatileDeviceId };
  }
}

export function deviceDataOwnerToken(scope: DeviceDataScope): string {
  return scope.kind === "user" ? `user:${scope.userId}` : `guest:${scope.deviceId}`;
}

function key(scope: DeviceDataScope, resource: string, id: string): string {
  return `${PREFIX}:${encodeURIComponent(deviceDataOwnerToken(scope))}:${encodeURIComponent(resource)}:${encodeURIComponent(id)}`;
}

function parse<T>(raw: string | null): DeviceDataEnvelope<T> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DeviceDataEnvelope<T>;
  } catch {
    return null;
  }
}

export function readDeviceData<T>(
  scope: DeviceDataScope,
  resource: string,
  id: string,
  validate: (value: unknown) => value is T,
): T | null {
  if (typeof window === "undefined") return null;
  try {
    const envelope = parse<unknown>(localStorage.getItem(key(scope, resource, id)));
    if (
      !envelope ||
      envelope.version !== 2 ||
      envelope.owner !== deviceDataOwnerToken(scope) ||
      envelope.resource !== resource ||
      envelope.id !== id ||
      !validate(envelope.value)
    ) {
      return null;
    }
    return envelope.value;
  } catch {
    return null;
  }
}

export function writeDeviceData<T>(
  scope: DeviceDataScope,
  resource: string,
  id: string,
  value: T,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    const envelope: DeviceDataEnvelope<T> = {
      version: 2,
      owner: deviceDataOwnerToken(scope),
      resource,
      id,
      value,
    };
    localStorage.setItem(key(scope, resource, id), JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

export function listDeviceData<T>(
  scope: DeviceDataScope,
  resource: string,
  validate: (value: unknown) => value is T,
): Array<{ id: string; value: T }> {
  if (typeof window === "undefined") return [];
  const prefix = `${PREFIX}:${encodeURIComponent(deviceDataOwnerToken(scope))}:${encodeURIComponent(resource)}:`;
  const values: Array<{ id: string; value: T }> = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const storedKey = localStorage.key(index);
      if (!storedKey?.startsWith(prefix)) continue;
      let id: string;
      try {
        id = decodeURIComponent(storedKey.slice(prefix.length));
      } catch {
        continue;
      }
      const value = readDeviceData(scope, resource, id, validate);
      if (value) values.push({ id, value });
    }
  } catch {
    return [];
  }
  return values;
}

export function removeDeviceData(
  scope: DeviceDataScope,
  resource: string,
  id: string,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key(scope, resource, id));
  } catch {
    // Best-effort deletion; the caller remains responsible for durable data.
  }
}

export function purgeUserDeviceData(userId: string): boolean {
  if (typeof window === "undefined" || !userId.trim()) return true;
  const prefix = `${PREFIX}:${encodeURIComponent(`user:${userId.trim()}`)}:`;
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const storedKey = localStorage.key(index);
      if (storedKey?.startsWith(prefix)) keys.push(storedKey);
    }
    for (const storedKey of keys) localStorage.removeItem(storedKey);
    return true;
  } catch {
    // Server deletion remains authoritative even if browser storage is denied.
    return false;
  }
}
