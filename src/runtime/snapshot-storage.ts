/**
 * File-based snapshot storage via ST's /api/files endpoint.
 *
 * Stores per-message worldbook snapshots (Dyn entries + Controller)
 * as JSON files on the server, keeping chat message data lightweight.
 *
 * File naming: ew__{charName}__{chatId}__msg-{messageId}.json
 * (flat layout — ST file API doesn't support subdirectories)
 */

import { buildMessageVersionKey, simpleHash } from "./helpers";
import type { ControllerEntrySnapshot } from "./types";

export type SnapshotData = {
  controllers: ControllerEntrySnapshot[];
  dyn_entries: Array<{ name: string; content: string; enabled: boolean }>;
  /** 写入快照时 assistant 消息的 swipe_id，用于版本校验 */
  swipe_id?: number;
  /** assistant 消息当前可见文本的哈希，检测 edit/update */
  content_hash?: string;
};

export type SnapshotVersionStore = {
  version: "ew-snapshot/v2";
  updated_at: number;
  versions: Record<string, SnapshotData>;
  owner?: SnapshotStoreOwner;
};

export type SnapshotStoreOwner = {
  char_name: string;
  chat_id: string;
  chat_fingerprint: string;
};

/**
 * Upgrade legacy snapshot formats to the new multi-controller array structure.
 */
export function upgradeSnapshotData(raw: any): SnapshotData | null {
  if (!raw || typeof raw !== "object") return null;

  if (Array.isArray(raw.controllers)) {
    return {
      controllers: raw.controllers
        .filter((entry: unknown) => entry && typeof entry === "object")
        .map((entry: ControllerEntrySnapshot) => ({
          entry_name: String(entry.entry_name ?? ""),
          content: String(entry.content ?? ""),
          flow_id: entry.flow_id,
          flow_name: entry.flow_name,
          legacy: Boolean(entry.legacy),
        }))
        .filter((entry: ControllerEntrySnapshot) => entry.content),
      dyn_entries: Array.isArray(raw.dyn_entries) ? raw.dyn_entries : [],
      swipe_id: typeof raw.swipe_id === "number" ? raw.swipe_id : undefined,
      content_hash:
        typeof raw.content_hash === "string" ? raw.content_hash : undefined,
    };
  }

  if (
    raw.controllers &&
    typeof raw.controllers === "object" &&
    !Array.isArray(raw.controllers)
  ) {
    return {
      controllers: Object.entries(
        raw.controllers as Record<string, unknown>,
      ).map(([key, value]) => ({
        entry_name: key.startsWith("EW/Controller/") ? key : "",
        flow_name: key.startsWith("EW/Controller/") ? undefined : key,
        content: String(value ?? ""),
        legacy: key === "legacy",
      })),
      dyn_entries: Array.isArray(raw.dyn_entries) ? raw.dyn_entries : [],
      swipe_id: typeof raw.swipe_id === "number" ? raw.swipe_id : undefined,
      content_hash:
        typeof raw.content_hash === "string" ? raw.content_hash : undefined,
    };
  }

  if (typeof raw.controller === "string") {
    return {
      controllers: raw.controller
        ? [
            {
              entry_name: "",
              flow_name: "Legacy Controller",
              content: raw.controller,
              legacy: true,
            },
          ]
        : [],
      dyn_entries: Array.isArray(raw.dyn_entries) ? raw.dyn_entries : [],
      swipe_id: typeof raw.swipe_id === "number" ? raw.swipe_id : undefined,
      content_hash:
        typeof raw.content_hash === "string" ? raw.content_hash : undefined,
    };
  }

  // Unknown format
  return null;
}

function snapshotVersionKey(data: SnapshotData): string {
  return buildMessageVersionKey(
    Number(data.swipe_id ?? 0),
    String(data.content_hash ?? "").trim(),
  );
}

function buildArchivedSnapshotVersionKey(
  baseKey: string,
  store: SnapshotVersionStore,
): string {
  let candidate = `${baseKey}@rev:${Date.now()}`;
  while (store.versions[candidate]) {
    candidate = `${baseKey}@rev:${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  }
  return candidate;
}

function buildChatFingerprint(chatId: string): string {
  return simpleHash(String(chatId ?? ""))
    .replace(/^h/, "")
    .slice(0, 12);
}

function buildSnapshotStoreOwner(
  charName: string,
  chatId: string,
): SnapshotStoreOwner {
  return {
    char_name: String(charName ?? ""),
    chat_id: String(chatId ?? ""),
    chat_fingerprint: buildChatFingerprint(chatId),
  };
}

function normalizeSnapshotStoreOwner(
  raw: unknown,
): SnapshotStoreOwner | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const owner = raw as Record<string, unknown>;
  const charName = String(owner.char_name ?? "").trim();
  const chatId = String(owner.chat_id ?? "").trim();
  const chatFingerprint = String(owner.chat_fingerprint ?? "").trim();
  if (!charName || !chatId || !chatFingerprint) {
    return undefined;
  }

  return {
    char_name: charName,
    chat_id: chatId,
    chat_fingerprint: chatFingerprint,
  };
}

function normalizeSnapshotVersionStore(raw: any): SnapshotVersionStore | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  if (
    raw.version === "ew-snapshot/v2" &&
    raw.versions &&
    typeof raw.versions === "object" &&
    !Array.isArray(raw.versions)
  ) {
    const versions: Record<string, SnapshotData> = {};
    for (const [key, value] of Object.entries(
      raw.versions as Record<string, unknown>,
    )) {
      const upgraded = upgradeSnapshotData(value);
      if (upgraded) {
        versions[String(key)] = upgraded;
      }
    }
    return {
      version: "ew-snapshot/v2",
      updated_at: Number(raw.updated_at ?? Date.now()),
      versions,
      owner: normalizeSnapshotStoreOwner(raw.owner),
    };
  }

  const upgraded = upgradeSnapshotData(raw);
  if (!upgraded) {
    return null;
  }

  return {
    version: "ew-snapshot/v2",
    updated_at: Date.now(),
    versions: {
      [snapshotVersionKey(upgraded)]: upgraded,
    },
  };
}

// ── 辅助函数 ──────────────────────────────────────────────────

function sanitizeSegment(s: string): string {
  // 仅允许字母数字、下划线、连字符
  return s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
}

function buildFileName(
  charName: string,
  chatId: string,
  messageId: number,
): string {
  return `ew__${sanitizeSegment(charName)}__${sanitizeSegment(chatId)}__fp-${buildChatFingerprint(chatId)}__msg-${messageId}.json`;
}

function buildFilePrefix(charName: string, chatId: string): string {
  return `ew__${sanitizeSegment(charName)}__${sanitizeSegment(chatId)}__fp-${buildChatFingerprint(chatId)}__`;
}

function buildLegacyFileName(
  charName: string,
  chatId: string,
  messageId: number,
): string {
  return `ew__${sanitizeSegment(charName)}__${sanitizeSegment(chatId)}__msg-${messageId}.json`;
}

function buildLegacyFilePrefix(charName: string, chatId: string): string {
  return `ew__${sanitizeSegment(charName)}__${sanitizeSegment(chatId)}__`;
}

async function getHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  // ST 可能需要 CSRF token
  if (typeof SillyTavern !== "undefined" && SillyTavern.getRequestHeaders) {
    const stHeaders = SillyTavern.getRequestHeaders();
    if (stHeaders && typeof stHeaders === "object") {
      Object.assign(headers, stHeaders);
    }
  }
  return headers;
}

// ── 写入 ────────────────────────────────────────────────────

async function persistSnapshotStore(
  fileName: string,
  store: SnapshotVersionStore,
): Promise<void> {
  const jsonContent = JSON.stringify(store);
  const base64Content = btoa(unescape(encodeURIComponent(jsonContent)));

  const response = await fetch("/api/files/upload", {
    method: "POST",
    headers: await getHeaders(),
    body: JSON.stringify({ name: fileName, data: base64Content }),
  });

  if (!response.ok) {
    throw new Error(
      `[EW] Failed to write snapshot file "${fileName}": ${response.status} ${response.statusText}`,
    );
  }
}

export async function writeSnapshotStore(
  fileName: string,
  store: SnapshotVersionStore,
): Promise<void> {
  await persistSnapshotStore(fileName, {
    version: "ew-snapshot/v2",
    updated_at: Date.now(),
    versions: { ...store.versions },
    owner: store.owner,
  });
}

export async function writeSnapshot(
  charName: string,
  chatId: string,
  messageId: number,
  data: SnapshotData,
): Promise<string> {
  const fileName = buildFileName(charName, chatId, messageId);
  const currentStore = (await readSnapshotStore(fileName)) ?? {
    version: "ew-snapshot/v2" as const,
    updated_at: Date.now(),
    versions: {},
    owner: buildSnapshotStoreOwner(charName, chatId),
  };
  currentStore.updated_at = Date.now();
  const versionKey = snapshotVersionKey(data);
  const existing = currentStore.versions[versionKey];
  if (existing) {
    const existingJson = JSON.stringify(existing);
    const nextJson = JSON.stringify(data);
    if (existingJson !== nextJson) {
      currentStore.versions[
        buildArchivedSnapshotVersionKey(versionKey, currentStore)
      ] = existing;
    }
  }
  currentStore.versions[versionKey] = data;
  currentStore.owner = buildSnapshotStoreOwner(charName, chatId);

  await persistSnapshotStore(fileName, currentStore);

  console.debug(`[Evolution World] Snapshot written: ${fileName}`);
  return fileName;
}

// ── 读取 ─────────────────────────────────────────────────────

export async function readSnapshotStore(
  fileName: string,
): Promise<SnapshotVersionStore | null> {
  try {
    const response = await fetch(`/user/files/${fileName}`);
    if (!response.ok) {
      console.debug(`[Evolution World] Snapshot file not found: ${fileName}`);
      return null;
    }
    const data = await response.json();
    return normalizeSnapshotVersionStore(data);
  } catch (e) {
    console.warn(`[Evolution World] Failed to read snapshot: ${fileName}`, e);
    return null;
  }
}

export async function readSnapshot(
  fileName: string,
  versionKey?: string,
): Promise<SnapshotData | null> {
  const store = await readSnapshotStore(fileName);
  if (!store) {
    return null;
  }

  if (versionKey) {
    return store.versions[versionKey] ?? null;
  }

  const values = Object.values(store.versions);
  return values.length === 1 ? values[0] : null;
}

// ── 删除 ───────────────────────────────────────────────────

export async function deleteSnapshot(fileName: string): Promise<void> {
  try {
    const response = await fetch("/api/files/delete", {
      method: "POST",
      headers: await getHeaders(),
      body: JSON.stringify({ path: `user/files/${fileName}` }),
    });
    if (response.ok) {
      console.debug(`[Evolution World] Snapshot deleted: ${fileName}`);
    }
  } catch (e) {
    console.warn(`[Evolution World] Failed to delete snapshot: ${fileName}`, e);
  }
}

// ── 批量操作 ─────────────────────────────────────────

/**
 * Find all snapshot files for a given chat.
 * Uses /api/files/verify with a set of candidate filenames.
 *
 * Since ST doesn't provide a "list files" API, we verify files
 * based on message IDs found in the current chat.
 */
export async function findSnapshotFiles(
  charName: string,
  chatId: string,
  messageIds: number[],
): Promise<string[]> {
  const prefix = buildFilePrefix(charName, chatId);
  const legacyPrefix = buildLegacyFilePrefix(charName, chatId);
  const candidates = _.uniq([
    ...messageIds.map((id) => `user/files/${prefix}msg-${id}.json`),
    ...messageIds.map((id) => `user/files/${legacyPrefix}msg-${id}.json`),
  ]);

  if (candidates.length === 0) return [];

  try {
    const response = await fetch("/api/files/verify", {
      method: "POST",
      headers: await getHeaders(),
      body: JSON.stringify({ urls: candidates }),
    });
    if (!response.ok) return [];

    const result = (await response.json()) as Record<string, boolean>;
    return Object.entries(result)
      .filter(([, exists]) => exists)
      .map(([url]) => url.replace("user/files/", ""));
  } catch (e) {
    console.warn("[Evolution World] Failed to verify snapshot files:", e);
    return [];
  }
}

/**
 * Delete all snapshot files for a given chat that are NOT in the keep list.
 */
export async function cleanupSnapshotFiles(
  charName: string,
  chatId: string,
  allMessageIds: number[],
  keepFileNames: Set<string>,
): Promise<number> {
  const allFiles = await findSnapshotFiles(charName, chatId, allMessageIds);
  let deleted = 0;
  for (const file of allFiles) {
    if (!keepFileNames.has(file)) {
      await deleteSnapshot(file);
      deleted++;
    }
  }
  return deleted;
}

// ── 迁移 ────────────────────────────────────────────────

export {
  buildChatFingerprint,
  buildFileName,
  buildFilePrefix,
  buildLegacyFileName,
  buildLegacyFilePrefix,
  buildSnapshotStoreOwner,
};
