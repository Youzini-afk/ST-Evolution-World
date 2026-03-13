import { resolveControllerSnapshotEntryName } from './helpers';
import {
  cleanupSnapshotFiles,
  deleteSnapshot,
  readSnapshot,
  writeSnapshot,
  type SnapshotData,
} from './snapshot-storage';
import { ControllerEntrySnapshot, ControllerTemplateSlot, EwSettings } from './types';
import { ensureDefaultEntry, resolveTargetWorldbook } from './worldbook-runtime';

const EW_FLOOR_DATA_KEY = 'ew_entries';
const EW_CONTROLLER_DATA_KEY = 'ew_controller';
const EW_CONTROLLERS_DATA_KEY = 'ew_controllers';
const EW_DYN_SNAPSHOTS_KEY = 'ew_dyn_snapshots';
const EW_SNAPSHOT_FILE_KEY = 'ew_snapshot_file';

export type DynSnapshot = { name: string; content: string; enabled: boolean };

function normalizeDynSnapshot(snapshot: DynSnapshot): DynSnapshot {
  return {
    ...snapshot,
    enabled: false,
  };
}

function normalizeControllerSnapshot(snapshot: ControllerEntrySnapshot): ControllerEntrySnapshot {
  return {
    entry_name: String(snapshot.entry_name ?? '').trim(),
    content: String(snapshot.content ?? ''),
    flow_id: snapshot.flow_id ? String(snapshot.flow_id) : undefined,
    flow_name: snapshot.flow_name ? String(snapshot.flow_name) : undefined,
    legacy: Boolean(snapshot.legacy),
  };
}

function controllerSnapshotKey(snapshot: ControllerEntrySnapshot): string {
  return String(snapshot.flow_id ?? snapshot.entry_name ?? snapshot.flow_name ?? 'legacy');
}

const floorBindingListenerStops: EventOnReturn[] = [];
let floorBindingRestoreTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFloorBindingRestore(getSettings: () => EwSettings, delayMs: number): void {
  if (floorBindingRestoreTimer) {
    clearTimeout(floorBindingRestoreTimer);
  }

  floorBindingRestoreTimer = setTimeout(() => {
    floorBindingRestoreTimer = null;

    const freshSettings = getSettings();
    if (!freshSettings.enabled || !freshSettings.floor_binding_enabled) {
      return;
    }

    void onChatChanged(freshSettings);
  }, delayMs);
}

function clearInlineSnapshotFields(data: Record<string, unknown>) {
  delete data[EW_CONTROLLER_DATA_KEY];
  delete data[EW_CONTROLLERS_DATA_KEY];
  delete data[EW_DYN_SNAPSHOTS_KEY];
}

function clearFloorSnapshotFields(data: Record<string, unknown>) {
  delete data[EW_FLOOR_DATA_KEY];
  clearInlineSnapshotFields(data);
  delete data[EW_SNAPSHOT_FILE_KEY];
}

// ── Context Helpers ──────────────────────────────────────────

function getCharName(): string {
  return getCurrentCharacterName() ?? 'unknown';
}

function getChatId(): string {
  return String(SillyTavern.getCurrentChatId?.() ?? SillyTavern.chatId ?? 'unknown');
}

// ── Legacy upgrade helpers ───────────────────────────────────

/**
 * Read inline snapshot fields from message data, handling both legacy (single
 * controller string) and new (controllers record) formats.
 */
function readInlineSnapshot(data: Record<string, unknown>): SnapshotData | null {
  const snapshots = _.get(data, EW_DYN_SNAPSHOTS_KEY) as DynSnapshot[] | undefined;

  const controllersArray = _.get(data, EW_CONTROLLERS_DATA_KEY) as ControllerEntrySnapshot[] | undefined;
  if (Array.isArray(controllersArray)) {
    return {
      controllers: controllersArray.map(normalizeControllerSnapshot).filter(entry => entry.content),
      dyn_entries: Array.isArray(snapshots) ? snapshots : [],
    };
  }

  const controllersRaw = _.get(data, EW_CONTROLLERS_DATA_KEY) as Record<string, string> | undefined;
  if (controllersRaw && typeof controllersRaw === 'object' && !Array.isArray(controllersRaw)) {
    return {
      controllers: Object.entries(controllersRaw).map(([key, value]) =>
        normalizeControllerSnapshot({
          entry_name: key.startsWith('EW/Controller/') ? key : '',
          flow_name: key.startsWith('EW/Controller/') ? undefined : key,
          content: String(value ?? ''),
          legacy: key === 'legacy',
        }),
      ),
      dyn_entries: Array.isArray(snapshots) ? snapshots : [],
    };
  }

  const ctrlSnap = _.get(data, EW_CONTROLLER_DATA_KEY) as string | undefined;
  if ((Array.isArray(snapshots) && snapshots.length > 0) || (typeof ctrlSnap === 'string' && ctrlSnap.length > 0)) {
    return {
      controllers: ctrlSnap
        ? [
            normalizeControllerSnapshot({
              entry_name: '',
              flow_name: 'Legacy Controller',
              content: ctrlSnap,
              legacy: true,
            }),
          ]
        : [],
      dyn_entries: Array.isArray(snapshots) ? snapshots : [],
    };
  }

  return null;
}

// ── Floor Marking ────────────────────────────────────────────

/**
 * Mark floor entries: write snapshot data to the appropriate storage backend.
 *
 * - message_data mode: snapshots stored directly in msg.data
 * - file mode: snapshots written to ST server file, msg.data stores filename reference
 */
export async function markFloorEntries(
  settings: EwSettings,
  messageId: number,
  entryNames: string[],
  controllerSnapshots?: ControllerTemplateSlot[],
  dynSnapshots?: DynSnapshot[],
): Promise<void> {
  const messages = getChatMessages(messageId);
  if (messages.length === 0) {
    return;
  }

  const msg = messages[0];
  const previousSnapshotFile = _.get(msg.data, EW_SNAPSHOT_FILE_KEY);
  const normalizedEntryNames = _.uniq(entryNames.filter(name => typeof name === 'string' && name.trim()));
  const normalizedDynSnapshots = (dynSnapshots ?? [])
    .filter(snap => snap.name && typeof snap.content === 'string')
    .map(normalizeDynSnapshot);
  const normalizedControllerSnapshots = (controllerSnapshots ?? [])
    .map(snapshot =>
      normalizeControllerSnapshot({
        entry_name: snapshot.entry_name,
        content: snapshot.content,
        flow_id: snapshot.flow_id,
        flow_name: snapshot.flow_name,
      }),
    )
    .filter(snapshot => snapshot.content);
  const hasSnapshotPayload = Boolean(
    normalizedControllerSnapshots.length > 0 || normalizedDynSnapshots.length > 0 || normalizedEntryNames.length > 0,
  );

  const nextData: Record<string, unknown> = {
    ...msg.data,
  };
  clearFloorSnapshotFields(nextData);

  if (!hasSnapshotPayload) {
    if (typeof previousSnapshotFile === 'string' && previousSnapshotFile) {
      await deleteSnapshot(previousSnapshotFile);
    }
    await setChatMessages([{ message_id: messageId, data: nextData }], { refresh: 'none' });
    return;
  }

  if (normalizedEntryNames.length > 0) {
    nextData[EW_FLOOR_DATA_KEY] = normalizedEntryNames;
  }

  if (settings.snapshot_storage === 'file') {
    // File mode: rewrite the entire snapshot file for this floor.
    const snapshotData: SnapshotData = {
      controllers: normalizedControllerSnapshots,
      dyn_entries: normalizedDynSnapshots,
    };
    try {
      const fileName = await writeSnapshot(getCharName(), getChatId(), messageId, snapshotData);
      nextData[EW_SNAPSHOT_FILE_KEY] = fileName;
      if (typeof previousSnapshotFile === 'string' && previousSnapshotFile && previousSnapshotFile !== fileName) {
        await deleteSnapshot(previousSnapshotFile);
      }
    } catch (e) {
      console.warn('[Evolution World] File snapshot write failed, falling back to message data:', e);
      if (normalizedControllerSnapshots.length > 0) {
        nextData[EW_CONTROLLERS_DATA_KEY] = normalizedControllerSnapshots;
      }
      nextData[EW_DYN_SNAPSHOTS_KEY] = normalizedDynSnapshots;
      if (typeof previousSnapshotFile === 'string' && previousSnapshotFile) {
        await deleteSnapshot(previousSnapshotFile);
      }
    }
  } else {
    // Message data mode (default): rewrite inline snapshot fields exactly.
    if (normalizedControllerSnapshots.length > 0) {
      nextData[EW_CONTROLLERS_DATA_KEY] = normalizedControllerSnapshots;
    }
    nextData[EW_DYN_SNAPSHOTS_KEY] = normalizedDynSnapshots;
    if (typeof previousSnapshotFile === 'string' && previousSnapshotFile) {
      await deleteSnapshot(previousSnapshotFile);
    }
  }

  await setChatMessages([{ message_id: messageId, data: nextData }], { refresh: 'none' });
}

// ── Floor Query ──────────────────────────────────────────────

/**
 * Get the EW/Dyn/ entry names bound to a specific floor.
 */
export function getFloorEntryNames(messageId: number): string[] {
  const messages = getChatMessages(messageId);
  if (messages.length === 0) {
    return [];
  }
  return _.get(messages[0].data, EW_FLOOR_DATA_KEY, []);
}

// ── Unified Snapshot Collection ──────────────────────────────

/**
 * Scan all surviving messages and return the latest snapshots.
 *
 * Checks BOTH storage backends (message data and file) so that
 * mixed-mode chats work correctly (e.g. user switched mode mid-chat).
 * The latest snapshot (by message position) wins.
 */
export async function collectLatestSnapshots(): Promise<{
  controllers: ControllerEntrySnapshot[];
  dyn: Map<string, DynSnapshot>;
}> {
  const lastId = getLastMessageId();
  if (lastId < 0) {
    return { controllers: {}, dyn: new Map() };
  }

  const allMessages = getChatMessages(`0-${lastId}`);
  const dynMerged = new Map<string, DynSnapshot>();
  const mergedControllers = new Map<string, ControllerEntrySnapshot>();

  // Iterate oldest to newest: latest wins.
  for (const msg of allMessages) {
    const snapshotFile: string | undefined = _.get(msg.data, EW_SNAPSHOT_FILE_KEY);

    if (snapshotFile) {
      // File mode snapshot: read from file.
      const fileData = await readSnapshot(snapshotFile);
      if (fileData) {
        for (const snapshot of fileData.controllers.map(normalizeControllerSnapshot)) {
          mergedControllers.set(controllerSnapshotKey(snapshot), snapshot);
        }
        for (const snap of fileData.dyn_entries) {
          if (snap.name && typeof snap.content === 'string') {
            dynMerged.set(snap.name, snap);
          }
        }
        continue; // File snapshot found, skip message data for this message.
      }
    }

    // Message data mode (or file read failed — fallback).
    const inlineSnapshot = readInlineSnapshot(msg.data);
    if (inlineSnapshot) {
      for (const snapshot of inlineSnapshot.controllers.map(normalizeControllerSnapshot)) {
        mergedControllers.set(controllerSnapshotKey(snapshot), snapshot);
      }
      for (const snap of inlineSnapshot.dyn_entries) {
        if (snap.name && typeof snap.content === 'string') {
          dynMerged.set(snap.name, snap);
        }
      }
    }
  }

  return { controllers: [...mergedControllers.values()], dyn: dynMerged };
}

// ── Unified Purge + Restore ─────────────────────────────────

/**
 * Purge all EW-generated entries from worldbook, then restore from the
 * current chat's latest surviving snapshots.
 *
 * Unified handler for all CHAT_CHANGED events:
 *   Delete floor  → deleted message's snapshot gone → restores previous state (rollback)
 *   New chat      → no snapshots → clean slate
 *   Switch back   → old chat's snapshots survive → full restore
 */
export async function purgeAndRestoreForChat(settings: EwSettings): Promise<void> {
  const target = await resolveTargetWorldbook(settings);

  // Step 1: Remove all EW/Dyn/* entries and clear all EW/Controller/* entries.
  const nextEntries = klona(target.entries).filter(entry => !entry.name.startsWith(settings.dynamic_entry_prefix));

  // Clear all existing controller entries.
  const ctrlEntries = nextEntries.filter(e => e.name.startsWith(settings.controller_entry_prefix));
  for (const entry of ctrlEntries) {
    entry.content = '';
    entry.enabled = false;
  }

  // Step 2: Restore from current chat's latest surviving snapshots.
  const { controllers: controllerSnapshots, dyn: dynSnapshots } = await collectLatestSnapshots();

  for (const snap of dynSnapshots.values()) {
    const normalizedSnap = normalizeDynSnapshot(snap);
    const existing = nextEntries.find(e => e.name === snap.name);
    if (existing) {
      existing.content = normalizedSnap.content;
      existing.enabled = false;
    } else {
      nextEntries.push(ensureDefaultEntry(normalizedSnap.name, normalizedSnap.content, false, nextEntries));
    }
  }

  // Restore multi-controllers.
  for (const controllerSnapshot of controllerSnapshots) {
    const entryName = resolveControllerSnapshotEntryName(settings.controller_entry_prefix, controllerSnapshot);
    const existing = nextEntries.find(e => e.name === entryName);
    if (existing) {
      existing.content = controllerSnapshot.content;
      existing.enabled = true;
    } else {
      nextEntries.push(ensureDefaultEntry(entryName, controllerSnapshot.content, true, nextEntries, true));
    }
  }

  // Step 3: Commit the cleaned + restored worldbook.
  await replaceWorldbook(target.worldbook_name, nextEntries, { render: 'debounced' });

  // Step 4: Cleanup orphaned snapshot files (file mode only).
  if (settings.snapshot_storage === 'file') {
    try {
      const lastId = getLastMessageId();
      if (lastId >= 0) {
        const allMessages = getChatMessages(`0-${lastId}`);
        const keepFiles = new Set<string>();
        const allMsgIds: number[] = [];
        for (const msg of allMessages) {
          allMsgIds.push(msg.message_id);
          const file: string | undefined = _.get(msg.data, EW_SNAPSHOT_FILE_KEY);
          if (file) keepFiles.add(file);
        }
        const cleaned = await cleanupSnapshotFiles(getCharName(), getChatId(), allMsgIds, keepFiles);
        if (cleaned > 0) {
          console.info(`[Evolution World] Cleaned up ${cleaned} orphaned snapshot files`);
        }
      }
    } catch (e) {
      console.warn('[Evolution World] Snapshot file cleanup failed:', e);
    }
  }

  const restoredDyn = dynSnapshots.size;
  const restoredCtrl = controllerSnapshots.length;
  console.info(`[Evolution World] purgeAndRestore: ${restoredDyn} Dyn + ${restoredCtrl} Controller(s) restored`);
}

// ── 迁移 ────────────────────────────────────────────────

/**
 * Migrate snapshots between storage modes for the current chat.
 */
export async function migrateSnapshots(direction: 'to_file' | 'to_message_data'): Promise<{ migrated: number }> {
  const lastId = getLastMessageId();
  if (lastId < 0) return { migrated: 0 };

  const charName = getCharName();
  const chatId = getChatId();
  const allMessages = getChatMessages(`0-${lastId}`);
  let migrated = 0;

  if (direction === 'to_file') {
    // message_data → file: read from msg.data, write to file, clear msg.data snapshot fields.
    for (const msg of allMessages) {
      const inlineSnapshot = readInlineSnapshot(msg.data);
      if (!inlineSnapshot) continue;

      const snapshotData: SnapshotData = {
        controllers: inlineSnapshot.controllers,
        dyn_entries: inlineSnapshot.dyn_entries,
      };

      const fileName = await writeSnapshot(charName, chatId, msg.message_id, snapshotData);

      // Update message data: keep ew_entries, add file ref, remove inline snapshots.
      const nextData: Record<string, unknown> = { ...msg.data };
      nextData[EW_SNAPSHOT_FILE_KEY] = fileName;
      clearInlineSnapshotFields(nextData);

      await setChatMessages([{ message_id: msg.message_id, data: nextData }], { refresh: 'none' });
      migrated++;
    }
  } else {
    // file → message_data: read from file, write to msg.data, delete file.
    for (const msg of allMessages) {
      const snapshotFile: string | undefined = _.get(msg.data, EW_SNAPSHOT_FILE_KEY);
      if (!snapshotFile) continue;

      const fileData = await readSnapshot(snapshotFile);

      const nextData: Record<string, unknown> = { ...msg.data };
      delete nextData[EW_SNAPSHOT_FILE_KEY];

      if (fileData) {
        if (fileData.controllers.length > 0) {
          nextData[EW_CONTROLLERS_DATA_KEY] = fileData.controllers;
        }
        if (fileData.dyn_entries.length > 0) {
          nextData[EW_DYN_SNAPSHOTS_KEY] = fileData.dyn_entries;
        }
      }

      await setChatMessages([{ message_id: msg.message_id, data: nextData }], { refresh: 'none' });

      await deleteSnapshot(snapshotFile);
      migrated++;
    }
  }

  console.info(`[Evolution World] Migration ${direction}: ${migrated} messages processed`);
  return { migrated };
}

// ── History: Per-Floor Snapshot Collection ───────────────────

export type FloorSnapshot = {
  messageId: number;
  snapshot: SnapshotData | null;
};

export type SnapshotDiff = {
  created: string[];
  modified: string[];
  deleted: string[];
  toggled: string[];
  controllersChanged: Record<string, 'created' | 'modified' | 'deleted'>;
};

/**
 * Collect every message's individual snapshot (not merged).
 * Returns an array ordered by messageId ascending, where each entry
 * contains the snapshot data stored at that specific floor.
 * Messages without snapshots are included with `snapshot: null`.
 */
export async function collectAllFloorSnapshots(): Promise<FloorSnapshot[]> {
  const lastId = getLastMessageId();
  if (lastId < 0) return [];

  const allMessages = getChatMessages(`0-${lastId}`);
  const result: FloorSnapshot[] = [];

  for (const msg of allMessages) {
    const snapshotFile: string | undefined = _.get(msg.data, EW_SNAPSHOT_FILE_KEY);
    let snapshot: SnapshotData | null = null;

    if (snapshotFile) {
      snapshot = await readSnapshot(snapshotFile);
    }

    if (!snapshot) {
      snapshot = readInlineSnapshot(msg.data);
    }

    result.push({ messageId: msg.message_id, snapshot });
  }

  return result;
}

/**
 * Compute the diff between two snapshots (prev → curr).
 * If prev is null, all entries in curr are "created".
 */
export function diffSnapshots(prev: SnapshotData | null, curr: SnapshotData | null): SnapshotDiff {
  const diff: SnapshotDiff = { created: [], modified: [], deleted: [], toggled: [], controllersChanged: {} };
  if (!curr) return diff;

  const prevMap = new Map<string, { content: string; enabled: boolean }>();
  if (prev) {
    for (const e of prev.dyn_entries) {
      prevMap.set(e.name, { content: e.content, enabled: e.enabled });
    }
  }

  const currMap = new Map<string, { content: string; enabled: boolean }>();
  for (const e of curr.dyn_entries) {
    currMap.set(e.name, { content: e.content, enabled: e.enabled });
  }

  // Find created, modified, toggled
  for (const [name, currEntry] of currMap) {
    const prevEntry = prevMap.get(name);
    if (!prevEntry) {
      diff.created.push(name);
    } else if (prevEntry.content !== currEntry.content) {
      diff.modified.push(name);
    } else if (prevEntry.enabled !== currEntry.enabled) {
      diff.toggled.push(name);
    }
  }

  // Find deleted
  for (const name of prevMap.keys()) {
    if (!currMap.has(name)) {
      diff.deleted.push(name);
    }
  }

  // Controller changes (multi-controller)
  const prevControllers = new Map(
    (prev?.controllers ?? []).map(snapshot => [controllerSnapshotKey(snapshot), snapshot]),
  );
  const currControllers = new Map(curr.controllers.map(snapshot => [controllerSnapshotKey(snapshot), snapshot]));
  const allCtrlKeys = new Set([...prevControllers.keys(), ...currControllers.keys()]);
  for (const key of allCtrlKeys) {
    const prevVal = prevControllers.get(key);
    const currVal = currControllers.get(key);
    if (!prevVal && currVal) {
      diff.controllersChanged[key] = 'created';
    } else if (prevVal && !currVal) {
      diff.controllersChanged[key] = 'deleted';
    } else if (prevVal?.content !== currVal?.content || prevVal?.entry_name !== currVal?.entry_name) {
      diff.controllersChanged[key] = 'modified';
    }
  }

  return diff;
}

/**
 * Rollback worldbook to the cumulative snapshot state at a given floor.
 * This means: merge all snapshots from floor 0 up to and including
 * the target messageId, then apply that state to the worldbook.
 */
export async function rollbackToFloor(settings: EwSettings, targetMessageId: number): Promise<void> {
  await restoreWorldbookFromSnapshots(settings, floor => floor.messageId <= targetMessageId);
  console.info(`[Evolution World] Rolled back to floor #${targetMessageId}`);
}

export async function rollbackBeforeFloor(settings: EwSettings, messageId: number): Promise<void> {
  await restoreWorldbookFromSnapshots(settings, floor => floor.messageId < messageId);
  console.info(`[Evolution World] Rolled back to state before floor #${messageId}`);
}

async function restoreWorldbookFromSnapshots(
  settings: EwSettings,
  predicate: (floor: FloorSnapshot) => boolean,
): Promise<void> {
  const allFloors = await collectAllFloorSnapshots();
  const dynMerged = new Map<string, DynSnapshot>();
  const controllers = new Map<string, ControllerEntrySnapshot>();

  // Merge snapshots selected by caller.
  for (const floor of allFloors) {
    if (!predicate(floor)) continue;
    if (!floor.snapshot) continue;

    for (const snapshot of floor.snapshot.controllers.map(normalizeControllerSnapshot)) {
      controllers.set(controllerSnapshotKey(snapshot), snapshot);
    }
    for (const snap of floor.snapshot.dyn_entries) {
      if (snap.name && typeof snap.content === 'string') {
        dynMerged.set(snap.name, snap);
      }
    }
  }

  // Apply to worldbook (same pattern as purgeAndRestoreForChat)
  const target = await resolveTargetWorldbook(settings);
  const nextEntries = klona(target.entries).filter(entry => !entry.name.startsWith(settings.dynamic_entry_prefix));

  // Clear all existing controller entries.
  const ctrlEntries = nextEntries.filter(e => e.name.startsWith(settings.controller_entry_prefix));
  for (const entry of ctrlEntries) {
    entry.content = '';
    entry.enabled = false;
  }

  for (const snap of dynMerged.values()) {
    const normalizedSnap = normalizeDynSnapshot(snap);
    const existing = nextEntries.find(e => e.name === snap.name);
    if (existing) {
      existing.content = normalizedSnap.content;
      existing.enabled = false;
    } else {
      nextEntries.push(ensureDefaultEntry(normalizedSnap.name, normalizedSnap.content, false, nextEntries));
    }
  }

  // Restore multi-controllers.
  for (const controllerSnapshot of controllers.values()) {
    const entryName = resolveControllerSnapshotEntryName(settings.controller_entry_prefix, controllerSnapshot);
    const existing = nextEntries.find(e => e.name === entryName);
    if (existing) {
      existing.content = controllerSnapshot.content;
      existing.enabled = true;
    } else {
      nextEntries.push(ensureDefaultEntry(entryName, controllerSnapshot.content, true, nextEntries, true));
    }
  }

  await replaceWorldbook(target.worldbook_name, nextEntries, { render: 'debounced' });
}

// ── Event Handlers ──────────────────────────────────────────

async function onChatChanged(settings: EwSettings): Promise<void> {
  try {
    await purgeAndRestoreForChat(settings);
  } catch (error) {
    console.warn('[Evolution World] chat change handling failed:', error);
  }
}

/**
 * Initialize floor binding event listeners.
 */
export function initFloorBindingEvents(getSettings: () => EwSettings): void {
  disposeFloorBindingEvents();

  floorBindingListenerStops.push(
    eventOn(tavern_events.CHAT_CHANGED, () => {
      const currentSettings = getSettings();
      if (currentSettings.enabled && currentSettings.floor_binding_enabled) {
        scheduleFloorBindingRestore(getSettings, 500);
      }
    }),
  );

  floorBindingListenerStops.push(
    eventOn(tavern_events.MESSAGE_DELETED, () => {
      const currentSettings = getSettings();
      if (currentSettings.enabled && currentSettings.floor_binding_enabled) {
        // Let SillyTavern finish mutating the chat array before reading snapshots.
        scheduleFloorBindingRestore(getSettings, 180);
      }
    }),
  );
}

/**
 * Dispose floor binding event listeners.
 */
export function disposeFloorBindingEvents(): void {
  if (floorBindingRestoreTimer) {
    clearTimeout(floorBindingRestoreTimer);
    floorBindingRestoreTimer = null;
  }

  for (const stopper of floorBindingListenerStops.splice(0, floorBindingListenerStops.length)) {
    stopper.stop();
  }
}
