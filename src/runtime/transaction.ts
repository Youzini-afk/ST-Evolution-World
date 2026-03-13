import { markFloorEntries } from './floor-binding';
import { saveControllerBackup } from './settings';
import { ControllerEntrySnapshot, ControllerTemplateSlot, EwSettings, MergedPlan } from './types';
import { ensureDefaultEntry, resolveTargetWorldbook } from './worldbook-runtime';

type CommitResult = {
  worldbook_name: string;
  chat_id: string;
  changed_count: number;
};

function isManagedEntryName(settings: EwSettings, name: string): boolean {
  if (name.startsWith(settings.controller_entry_prefix)) {
    return true;
  }
  return name.startsWith(settings.dynamic_entry_prefix);
}

/**
 * Apply declarative diff: reconcile the worldbook entries to match the desired state.
 *
 * - desired_entries: each entry should exist with the given content and enabled state.
 *   If it already exists, overwrite content/enabled. If not, create it.
 * - remove_entries: each named entry should be deleted if it exists.
 */
function applyDeclarativeDiff(
  currentEntries: WorldbookEntry[],
  desiredEntries: Array<{ name: string; content: string; enabled: boolean }>,
  removeEntries: Array<{ name: string }>,
  settings: EwSettings,
): WorldbookEntry[] {
  // 步骤 1：移除条目。
  const removeSet = new Set(removeEntries.map(e => e.name));
  const result = klona(currentEntries.filter(entry => !removeSet.has(entry.name)));

  // 步骤 2：构建索引以实现 O(1) 查找。
  const indexByName = new Map<string, number>();
  for (let i = 0; i < result.length; i++) {
    indexByName.set(result[i].name, i);
  }

  // 步骤 3：应用目标状态（在已克隆的数组上就地修改）。
  for (const desired of desiredEntries) {
    // EW/Dyn/ 条目必须始终禁用（红灯）——它们由 EW/Controller 的 getwi() 拉取，
    // 不需要通过酒馆的关键词扫描激活。AI 返回的 enabled 字段对 Dyn 条目无效。
    const isDynEntry = desired.name.startsWith(settings.dynamic_entry_prefix);
    const effectiveEnabled = isDynEntry ? false : desired.enabled;

    const existingIndex = indexByName.get(desired.name);

    if (existingIndex !== undefined) {
      result[existingIndex].content = desired.content;
      result[existingIndex].enabled = effectiveEnabled;
    } else {
      const newEntry = ensureDefaultEntry(desired.name, desired.content, effectiveEnabled, result);
      indexByName.set(desired.name, result.length);
      result.push(newEntry);
    }
  }

  return result;
}

export async function commitMergedPlan(
  settings: EwSettings,
  mergedPlan: MergedPlan,
  controllerTemplates: ControllerTemplateSlot[],
  _requestId: string,
  messageId: number,
): Promise<CommitResult> {
  const target = await resolveTargetWorldbook(settings);
  const beforeEntries = target.entries;
  const chatId = String(SillyTavern.getCurrentChatId?.() ?? SillyTavern.chatId ?? 'unknown');

  // 覆写前备份当前所有 controller 条目内容。
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

  // 校验所有操作目标都是受管理的条目名称。
  const allNames = [
    ...mergedPlan.worldbook.desired_entries.map(entry => entry.name),
    ...mergedPlan.worldbook.remove_entries.map(entry => entry.name),
  ];
  const unmanaged = allNames.filter(name => !isManagedEntryName(settings, name));
  if (unmanaged.length > 0) {
    throw new Error(`unmanaged entry name(s): ${unmanaged.join(', ')}`);
  }

  // 将声明式 diff 应用到世界书条目。
  const nextEntries = applyDeclarativeDiff(
    beforeEntries,
    mergedPlan.worldbook.desired_entries,
    mergedPlan.worldbook.remove_entries,
    settings,
  );

  const desiredControllerByName = new Map(controllerTemplates.map(slot => [slot.entry_name, slot]));

  for (const entry of nextEntries) {
    if (!entry.name.startsWith(settings.controller_entry_prefix)) {
      continue;
    }
    const desiredController = desiredControllerByName.get(entry.name);
    if (desiredController) {
      entry.content = desiredController.content;
      entry.enabled = true;
    } else {
      entry.content = '';
      entry.enabled = false;
    }
  }

  for (const slot of controllerTemplates) {
    const ctrlExisting = nextEntries.find(e => e.name === slot.entry_name);
    if (ctrlExisting) {
      continue;
    }
    nextEntries.push(ensureDefaultEntry(slot.entry_name, slot.content, true, nextEntries, true));
  }

  // 在一次原子操作中提交所有变更。
  await replaceWorldbook(target.worldbook_name, nextEntries, { render: 'debounced' });

  // 标记楼层绑定：记录 EW/Dyn 条目、其内容快照和 Controller 快照。
  if (settings.floor_binding_enabled && messageId >= 0) {
    const dynDesired = mergedPlan.worldbook.desired_entries.filter(entry =>
      entry.name.startsWith(settings.dynamic_entry_prefix),
    );

    const dynSnapshots = dynDesired.map(entry => ({
      name: entry.name,
      content: entry.content,
      enabled: false,
    }));

    if (dynSnapshots.length > 0 || controllerTemplates.length > 0) {
      await markFloorEntries(
        settings,
        messageId,
        dynDesired.map(e => e.name),
        controllerTemplates,
        dynSnapshots,
      );
    }
  }

  return {
    worldbook_name: target.worldbook_name,
    chat_id: chatId,
    changed_count: nextEntries.length,
  };
}
