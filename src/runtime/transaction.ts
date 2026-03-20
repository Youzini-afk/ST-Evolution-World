import { getChatId, getChatMessages } from "./compat/character";
import { replaceWorldbook, type WbEntry } from "./compat/worldbook";
import { markFloorEntries } from "./floor-binding";
import { getMessageVersionInfo } from "./helpers";
import { saveControllerBackup } from "./settings";
import {
  ControllerEntrySnapshot,
  ControllerTemplateSlot,
  DynSnapshot,
  EwSettings,
  MergedPlan,
  MergedWorldbookDesiredEntry,
} from "./types";
import {
  applyDynWriteConfigToEntry,
  buildDynSnapshotFromEntry,
  createDynEntryFromWriteConfig,
  ensureDefaultEntry,
  resolveTargetWorldbook,
} from "./worldbook-runtime";

type CommitResult = {
  worldbook_name: string;
  chat_id: string;
  changed_count: number;
};

type MarkdownItemSet = {
  header: string;
  items: string[];
};

function isManagedEntryName(settings: EwSettings, name: string): boolean {
  if (name.startsWith(settings.controller_entry_prefix)) {
    return true;
  }
  return name.startsWith(settings.dynamic_entry_prefix);
}

function compareContributionApplyOrder(
  lhs: MergedWorldbookDesiredEntry,
  rhs: MergedWorldbookDesiredEntry,
): number {
  if (lhs.priority !== rhs.priority) {
    return lhs.priority - rhs.priority;
  }
  return lhs.flow_order - rhs.flow_order;
}

function parseMarkdownItemSet(raw: string): MarkdownItemSet | null {
  const text = String(raw ?? "").replace(/\r\n?/g, "\n");
  if (!text.trim()) {
    return { header: "", items: [] };
  }

  const lines = text.split("\n");
  const headerLines: string[] = [];
  const items: string[] = [];
  let currentItem: string[] | null = null;
  let sawBullet = false;

  const flushCurrentItem = () => {
    if (!currentItem) {
      return;
    }
    const normalized = currentItem
      .join("\n")
      .replace(/\s*\n\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (normalized) {
      items.push(normalized);
    }
    currentItem = null;
  };

  for (const line of lines) {
    const bulletMatch = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bulletMatch) {
      sawBullet = true;
      flushCurrentItem();
      currentItem = [bulletMatch[1].trim()];
      continue;
    }

    if (!sawBullet) {
      headerLines.push(line);
      continue;
    }

    if (!currentItem) {
      return null;
    }

    if (!line.trim()) {
      continue;
    }

    currentItem.push(line.trim());
  }

  flushCurrentItem();
  const header = headerLines.join("\n").trim();

  if (!sawBullet) {
    return null;
  }

  return { header, items };
}

function normalizeMarkdownItem(item: string): string {
  return String(item ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeMarkdownItems(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = normalizeMarkdownItem(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function renderMarkdownItemSet(set: MarkdownItemSet): string {
  const header = set.header.trim();
  const items = dedupeMarkdownItems(set.items);
  const body = items.map((item) => `- ${item}`).join("\n");
  if (header && body) {
    return `${header}\n\n${body}`;
  }
  if (body) {
    return body;
  }
  return header;
}

function applyMarkdownMerge(
  currentContent: string,
  incomingContent: string,
  mode: "add" | "add_remove",
): { ok: true; content: string } | { ok: false; reason: string } {
  const current = parseMarkdownItemSet(currentContent);
  const incoming = parseMarkdownItemSet(incomingContent);
  if (!current) {
    return { ok: false, reason: "current_markdown_parse_failed" };
  }
  if (!incoming) {
    return { ok: false, reason: "incoming_markdown_parse_failed" };
  }

  const header = incoming.header.trim()
    ? incoming.header.trim()
    : current.header.trim();
  if (mode === "add") {
    return {
      ok: true,
      content: renderMarkdownItemSet({
        header,
        items: [...current.items, ...incoming.items],
      }),
    };
  }

  return {
    ok: true,
    content: renderMarkdownItemSet({
      header,
      items: incoming.items,
    }),
  };
}

function pickWinningContribution(
  contributions: MergedWorldbookDesiredEntry[],
): MergedWorldbookDesiredEntry {
  return [...contributions].sort(compareContributionApplyOrder)[
    contributions.length - 1
  ];
}

function groupDesiredEntries(
  entries: MergedWorldbookDesiredEntry[],
): Map<string, MergedWorldbookDesiredEntry[]> {
  const grouped = new Map<string, MergedWorldbookDesiredEntry[]>();
  for (const entry of entries) {
    const bucket = grouped.get(entry.name) ?? [];
    bucket.push(entry);
    grouped.set(entry.name, bucket);
  }
  return grouped;
}

function materializeDynEntryContent(
  entryName: string,
  currentContent: string,
  contributions: MergedWorldbookDesiredEntry[],
): { skipped: boolean; content?: string; winner: MergedWorldbookDesiredEntry } {
  const ordered = [...contributions].sort(compareContributionApplyOrder);
  const winner = ordered[ordered.length - 1];

  if (ordered.every((entry) => entry.dyn_write.mode === "add")) {
    let nextContent = currentContent;
    for (const contribution of ordered) {
      const merged = applyMarkdownMerge(
        nextContent,
        contribution.content,
        "add",
      );
      if (!merged.ok) {
        console.warn(
          `[EW Commit] skip incremental Dyn "${entryName}" from flow "${contribution.source_flow_id}": ${merged.reason}`,
        );
        return { skipped: true, winner };
      }
      nextContent = merged.content;
    }
    return { skipped: false, content: nextContent, winner };
  }

  if (winner.dyn_write.mode === "overwrite") {
    return { skipped: false, content: winner.content, winner };
  }

  const merged = applyMarkdownMerge(
    currentContent,
    winner.content,
    winner.dyn_write.mode,
  );
  if (!merged.ok) {
    console.warn(
      `[EW Commit] skip incremental Dyn "${entryName}" from flow "${winner.source_flow_id}": ${merged.reason}`,
    );
    return { skipped: true, winner };
  }

  return { skipped: false, content: merged.content, winner };
}

function applyResolvedManagedEntries(
  nextEntries: WbEntry[],
  resolvedEntries: Array<{ name: string; content: string; enabled: boolean }>,
): void {
  const indexByName = new Map<string, number>();
  for (let i = 0; i < nextEntries.length; i++) {
    indexByName.set(nextEntries[i].name, i);
  }

  for (const desired of resolvedEntries) {
    const existingIndex = indexByName.get(desired.name);
    if (existingIndex !== undefined) {
      nextEntries[existingIndex].content = desired.content;
      nextEntries[existingIndex].enabled = desired.enabled;
      continue;
    }

    const newEntry = ensureDefaultEntry(
      desired.name,
      desired.content,
      desired.enabled,
      nextEntries,
    );
    indexByName.set(desired.name, nextEntries.length);
    nextEntries.push(newEntry);
  }
}

function collectManagedDynSnapshots(
  nextEntries: WbEntry[],
  settings: EwSettings,
): DynSnapshot[] {
  return nextEntries
    .filter((entry) => entry.name.startsWith(settings.dynamic_entry_prefix))
    .map((entry) => buildDynSnapshotFromEntry(entry));
}

function collectManagedControllerSnapshots(
  nextEntries: WbEntry[],
  settings: EwSettings,
): ControllerEntrySnapshot[] {
  return nextEntries
    .filter((entry) => entry.name.startsWith(settings.controller_entry_prefix))
    .map((entry) => ({
      entry_name: entry.name,
      content: entry.content,
    }))
    .filter((entry) => entry.content);
}

export async function commitMergedPlan(
  settings: EwSettings,
  mergedPlan: MergedPlan,
  controllerTemplates: ControllerTemplateSlot[],
  _requestId: string,
  messageId: number,
): Promise<CommitResult> {
  const target = await resolveTargetWorldbook(settings);
  if (!target) {
    throw new Error("Cannot resolve target worldbook — no worldbook available");
  }
  const beforeEntries = target.entries;
  const chatId = String(getChatId() ?? "unknown");

  const previousControllers: ControllerEntrySnapshot[] = [];
  for (const entry of beforeEntries) {
    if (entry.name.startsWith(settings.controller_entry_prefix)) {
      previousControllers.push({
        entry_name: entry.name,
        content: entry.content,
      });
    }
  }
  saveControllerBackup(chatId, target.worldbook_name, previousControllers);

  const allNames = [
    ...mergedPlan.worldbook.desired_entries.map((entry) => entry.name),
    ...mergedPlan.worldbook.remove_entries.map((entry) => entry.name),
  ];
  const unmanaged = allNames.filter(
    (name) => !isManagedEntryName(settings, name),
  );
  if (unmanaged.length > 0) {
    throw new Error(`unmanaged entry name(s): ${unmanaged.join(", ")}`);
  }

  const nextEntries = klona(beforeEntries);
  const desiredEntriesByName = groupDesiredEntries(
    mergedPlan.worldbook.desired_entries,
  );
  const resolvedNonDynEntries: Array<{
    name: string;
    content: string;
    enabled: boolean;
  }> = [];

  for (const [entryName, contributions] of desiredEntriesByName.entries()) {
    if (entryName.startsWith(settings.dynamic_entry_prefix)) {
      continue;
    }
    const winner = pickWinningContribution(contributions);
    resolvedNonDynEntries.push({
      name: entryName,
      content: winner.content,
      enabled: winner.enabled,
    });
  }

  applyResolvedManagedEntries(nextEntries, resolvedNonDynEntries);

  for (const [entryName, contributions] of desiredEntriesByName.entries()) {
    if (!entryName.startsWith(settings.dynamic_entry_prefix)) {
      continue;
    }

    const existing = nextEntries.find((entry) => entry.name === entryName);
    const materialized = materializeDynEntryContent(
      entryName,
      existing?.content ?? "",
      contributions,
    );
    if (materialized.skipped || materialized.content === undefined) {
      continue;
    }

    if (existing) {
      applyDynWriteConfigToEntry(
        existing,
        entryName,
        materialized.content,
        materialized.winner.dyn_write,
      );
    } else {
      nextEntries.push(
        createDynEntryFromWriteConfig(
          entryName,
          materialized.content,
          nextEntries,
          materialized.winner.dyn_write,
        ),
      );
    }
  }

  const desiredControllerByName = new Map(
    controllerTemplates.map((slot) => [slot.entry_name, slot]),
  );

  for (const entry of nextEntries) {
    if (!entry.name.startsWith(settings.controller_entry_prefix)) {
      continue;
    }
    const desiredController = desiredControllerByName.get(entry.name);
    if (desiredController) {
      entry.content = desiredController.content;
      entry.enabled = true;
    } else {
      entry.content = "";
      entry.enabled = false;
    }
  }

  for (const slot of controllerTemplates) {
    const ctrlExisting = nextEntries.find(
      (entry) => entry.name === slot.entry_name,
    );
    if (ctrlExisting) {
      continue;
    }
    nextEntries.push(
      ensureDefaultEntry(
        slot.entry_name,
        slot.content,
        true,
        nextEntries,
        true,
      ),
    );
  }

  await replaceWorldbook(target.worldbook_name, nextEntries, {
    render: "debounced",
  });

  if (settings.floor_binding_enabled && messageId >= 0) {
    const dynSnapshots = collectManagedDynSnapshots(nextEntries, settings);
    const controllerSnapshots = collectManagedControllerSnapshots(
      nextEntries,
      settings,
    );

    const targetMsg = getChatMessages(messageId)[0];
    const versionInfo = getMessageVersionInfo(targetMsg);

    await markFloorEntries(
      settings,
      messageId,
      dynSnapshots.map((entry) => entry.name),
      controllerSnapshots,
      dynSnapshots,
      versionInfo.swipe_id,
      versionInfo.content_hash,
    );
  }

  return {
    worldbook_name: target.worldbook_name,
    chat_id: chatId,
    changed_count: nextEntries.length,
  };
}
