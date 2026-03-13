/**
 * 角色卡绑定工作流 — 读写模块
 *
 * 将工作流配置序列化到角色卡世界书的 `EW/Flows` 条目中，
 * 使工作流随角色卡导出/导入。
 *
 * 数据安全：EW/Flows 条目中不存储 API 配置（URL/Key/Model），
 * 角色卡工作流仅通过 api_preset_id 引用全局 API 预设。
 */

import { EwFlowConfig, EwFlowConfigSchema, EwSettings } from './types';
import { resolveTargetWorldbook, ensureDefaultEntry } from './worldbook-runtime';

/** 角色卡工作流在世界书中的条目名称 */
export const CHAR_FLOWS_ENTRY_NAME = 'EW/Flows';

/** 角色卡工作流 JSON 包装格式 */
interface CharFlowsPayload {
  ew_char_flows: true;
  flows: unknown[];
}

// ── 敏感字段过滤 ────────────────────────────────────────────

/** 写入 EW/Flows 时排除的字段（敏感 / 仅本地） */
const EXCLUDED_FIELDS = new Set(['api_url', 'api_key', 'headers_json', 'api_preset_id']);

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

    const result: EwFlowConfig[] = [];
    for (const raw of (parsed as CharFlowsPayload).flows) {
      try {
        result.push(EwFlowConfigSchema.parse(raw));
      } catch {
        // 跳过无效条目
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
export async function writeCharFlows(
  settings: EwSettings,
  flows: EwFlowConfig[],
): Promise<void> {
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
    existing.enabled = false; // 禁用以防注入上下文
  } else {
    const newEntry = ensureDefaultEntry(
      CHAR_FLOWS_ENTRY_NAME,
      content,
      false, // disabled
      nextEntries,
      true,  // constant
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
 * - 如果 ID 冲突，角色卡工作流覆盖全局工作流
 * - 合并后按 priority 降序排列
 */
export async function getEffectiveFlows(settings: EwSettings): Promise<EwFlowConfig[]> {
  const globalFlows = settings.flows.filter(f => f.enabled);

  let charFlows: EwFlowConfig[];
  try {
    charFlows = (await readCharFlows(settings)).filter(f => f.enabled);
  } catch {
    charFlows = [];
  }

  if (charFlows.length === 0) return globalFlows;

  // 角色卡流 ID 集合，用于覆盖同 ID 全局流
  const charFlowIds = new Set(charFlows.map(f => f.id));

  // 过滤掉被角色卡流覆盖的全局流
  const filteredGlobal = globalFlows.filter(f => !charFlowIds.has(f.id));

  // 给角色卡流加优先级偏移
  const boostedChar = charFlows.map(f => ({
    ...f,
    priority: f.priority + CHAR_FLOW_PRIORITY_BOOST,
  }));

  // 合并并按优先级降序排列
  const merged = [...filteredGlobal, ...boostedChar];
  merged.sort((a, b) => b.priority - a.priority);

  return merged;
}
