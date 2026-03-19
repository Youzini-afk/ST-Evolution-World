/**
 * 角色卡绑定工作流 — 读写模块
 *
 * 将工作流配置序列化到角色卡世界书的 `EW/Flows` 条目中，
 * 使工作流随角色卡导出/导入。
 *
 * 数据安全：EW/Flows 条目中不存储 API 密钥 / URL / headers，
 * 但会保留 api_preset_id，用于在刷新后继续绑定到同一个全局 API 预设。
 */

import { replaceWorldbook } from './compat/worldbook';
import { getCurrentCharacterName } from './compat/character';
import { EwFlowConfig, EwFlowConfigSchema, EwSettings } from './types';
import { ensureDefaultEntry, resolveTargetWorldbook } from './worldbook-runtime';

/** 角色卡工作流在世界书中的条目名称 */
export const CHAR_FLOWS_ENTRY_NAME = 'EW/Flows';
const CHAR_FLOW_DRAFT_STORAGE_PREFIX = 'ew_char_flow_draft:';

/** 角色卡工作流 JSON 包装格式 */
interface CharFlowsPayload {
  ew_char_flows: true;
  flows: unknown[];
}

// ── 敏感字段过滤 ────────────────────────────────────────────

/** 写入 EW/Flows 时排除的字段（敏感 / 仅本地） */
const EXCLUDED_FIELDS = new Set(['api_url', 'api_key', 'headers_json']);

function normalizeFlowName(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeCharDraftName(name: string): string {
  return name.trim();
}

function getCharFlowDraftStorageKey(charName: string): string | null {
  const normalizedName = normalizeCharDraftName(charName);
  if (!normalizedName) {
    return null;
  }
  return `${CHAR_FLOW_DRAFT_STORAGE_PREFIX}${normalizedName}`;
}

/**
 * 从 flow 配置中去除敏感字段，返回安全的纯数据对象。
 */
function sanitizeFlow(flow: EwFlowConfig): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flow)) {
    if (!EXCLUDED_FIELDS.has(key)) {
      obj[key] = value;
    }
  }
  return obj;
}

export function readCharFlowDraft(charName: string): EwFlowConfig[] | null {
  const storageKey = getCharFlowDraftStorageKey(charName);
  if (!storageKey) {
    return null;
  }

  try {
    const raw = globalThis.localStorage?.getItem(storageKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 'ew-char-flow-draft/v1' || !Array.isArray(parsed.flows)) {
      return null;
    }

    const flows: EwFlowConfig[] = [];
    for (const item of parsed.flows) {
      flows.push(EwFlowConfigSchema.parse(item));
    }
    return flows;
  } catch (error) {
    console.warn('[Evolution World] Failed to read char flow draft cache:', error);
    return null;
  }
}

export function writeCharFlowDraft(charName: string, flows: EwFlowConfig[]): void {
  const storageKey = getCharFlowDraftStorageKey(charName);
  if (!storageKey) {
    return;
  }

  try {
    const payload = {
      version: 'ew-char-flow-draft/v1',
      updated_at: Date.now(),
      flows: flows.map(sanitizeFlow),
    };
    globalThis.localStorage?.setItem(storageKey, JSON.stringify(payload));
  } catch (error) {
    console.warn('[Evolution World] Failed to write char flow draft cache:', error);
  }
}

export function clearCharFlowDraft(charName: string): void {
  const storageKey = getCharFlowDraftStorageKey(charName);
  if (!storageKey) {
    return;
  }

  try {
    globalThis.localStorage?.removeItem(storageKey);
  } catch (error) {
    console.warn('[Evolution World] Failed to clear char flow draft cache:', error);
  }
}

// ── 读取 ─────────────────────────────────────────────────────

/**
 * 从当前角色卡世界书读取绑定的工作流配置。
 * 如果条目不存在或解析失败，返回空数组。
 */
export async function readCharFlows(settings: EwSettings): Promise<EwFlowConfig[]> {
  try {
    const target = await resolveTargetWorldbook(settings);
    const entry = target.entries.find(e => e.name === CHAR_FLOWS_ENTRY_NAME);
    if (!entry) return [];

    const parsed: unknown = JSON.parse(entry.content);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as any).ew_char_flows !== true ||
      !Array.isArray((parsed as any).flows)
    ) {
      return [];
    }

    const defaultPresetId = settings.api_presets[0]?.id ?? '';
    const presetIds = new Set(settings.api_presets.map(preset => preset.id));
    const globalPresetIdByName = new Map(
      settings.flows
        .map(flow => [normalizeFlowName(flow.name), flow.api_preset_id])
        .filter((entry): entry is [string, string] => Boolean(entry[1])),
    );

    const result: EwFlowConfig[] = [];
    for (const raw of (parsed as CharFlowsPayload).flows) {
      try {
        const flow = EwFlowConfigSchema.parse(raw);
        if (!flow.api_preset_id || !presetIds.has(flow.api_preset_id)) {
          const recoveredPresetId = globalPresetIdByName.get(normalizeFlowName(flow.name));
          if (recoveredPresetId && presetIds.has(recoveredPresetId)) {
            flow.api_preset_id = recoveredPresetId;
          } else if (defaultPresetId) {
            flow.api_preset_id = defaultPresetId;
          }
        }
        result.push(flow);
      } catch {
        console.warn('[Evolution World] skipped invalid char flow entry');
      }
    }
    return result;
  } catch (e) {
    console.debug('[Evolution World] readCharFlows failed:', e);
    return [];
  }
}

// ── 写入 ─────────────────────────────────────────────────────

/**
 * 将工作流配置写入当前角色卡世界书的 EW/Flows 条目。
 * 自动过滤敏感字段（api_url、api_key）。
 */
export async function writeCharFlows(settings: EwSettings, flows: EwFlowConfig[]): Promise<void> {
  const target = await resolveTargetWorldbook(settings);

  const payload: CharFlowsPayload = {
    ew_char_flows: true,
    flows: flows.map(sanitizeFlow),
  };
  const content = JSON.stringify(payload, null, 2);

  const nextEntries = klona(target.entries);
  const existing = nextEntries.find(e => e.name === CHAR_FLOWS_ENTRY_NAME);

  if (existing) {
    existing.content = content;
    existing.enabled = false;
  } else {
    const newEntry = ensureDefaultEntry(
      CHAR_FLOWS_ENTRY_NAME,
      content,
      false,
      nextEntries,
      true,
    );
    nextEntries.push(newEntry);
  }

  await replaceWorldbook(target.worldbook_name, nextEntries, { render: 'debounced' });
}

// ── 合并 ─────────────────────────────────────────────────────

/** 角色卡工作流的优先级偏移量，确保高于全局流 */
const CHAR_FLOW_PRIORITY_BOOST = 1000;

/**
 * 获取最终生效的工作流：全局 + 角色卡合并。
 *
 * - 角色卡工作流自动获得 priority + 1000 偏移
 * - 如果 ID 或名称冲突，角色卡工作流覆盖全局工作流
 * - 合并后按 priority 降序排列
 */
export async function getEffectiveFlows(settings: EwSettings): Promise<EwFlowConfig[]> {
  const globalFlows = settings.flows.filter(f => f.enabled);

  let charFlows: EwFlowConfig[];
  try {
    const currentCharName = String(getCurrentCharacterName() ?? '').trim();
    const draftFlows = currentCharName ? readCharFlowDraft(currentCharName) : null;
    charFlows = (draftFlows ?? (await readCharFlows(settings))).filter(f => f.enabled);
  } catch {
    charFlows = [];
  }

  if (charFlows.length === 0) return globalFlows;

  const charFlowIds = new Set(charFlows.map(f => f.id));
  const charFlowNames = new Set(charFlows.map(f => normalizeFlowName(f.name)));

  const filteredGlobal = globalFlows.filter(
    flow => !charFlowIds.has(flow.id) && !charFlowNames.has(normalizeFlowName(flow.name)),
  );

  const boostedChar = charFlows.map(flow => ({
    ...flow,
    priority: flow.priority + CHAR_FLOW_PRIORITY_BOOST,
  }));

  const merged = [...filteredGlobal, ...boostedChar];
  merged.sort((a, b) => b.priority - a.priority);

  return merged;
}
