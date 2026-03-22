import { klona } from "klona";
import _ from "lodash";
import { createDefaultApiPreset, createDefaultFlow } from "./factory";
import { migrateAllFlows } from "./flow-migrator";
import { readGraphCompileRunLinkArtifactEnvelope } from "./graph-compile-run-link-artifact-codec";
import {
  createGraphDocumentEnvelope,
  readGraphDocumentAsWorkbenchGraphs,
} from "./graph-document-codec";
import { readGraphFailureExplainArtifactEnvelope } from "./graph-failure-explain-artifact-codec";
import { readGraphHostEffectExplainArtifactEnvelope } from "./graph-host-effect-explain-artifact-codec";
import { readGraphOutputExplainArtifactEnvelope } from "./graph-output-explain-artifact-codec";
import { readGraphReuseExplainArtifactEnvelope } from "./graph-reuse-explain-artifact-codec";
import { readGraphTerminalOutcomeExplainArtifactEnvelope } from "./graph-terminal-outcome-explain-artifact-codec";
import { simpleHash } from "./helpers";
import {
  readSharedSettings,
  writeSharedSettings,
} from "./shared-settings-storage";
import {
  ControllerEntrySnapshot,
  DEFAULT_PROMPT_ORDER,
  EwApiPreset,
  EwApiPresetSchema,
  EwFlowConfig,
  EwFlowConfigSchema,
  EwPromptOrderEntry,
  EwSettings,
  EwSettingsSchema,
  LastIoSummary,
  LastIoSummarySchema,
  RunSummary,
  RunSummarySchema,
} from "./types";

type SettingsListener = (settings: EwSettings) => void;
type RunListener = (summary: RunSummary | null) => void;
type IoListener = (summary: LastIoSummary | null) => void;

type WorkflowRoundCounterEntry = {
  before_reply: number;
  after_reply: number;
  updated_at: number;
};

type ScriptStorageShape = {
  settings?: unknown;
  last_run?: RunSummary | null;
  last_io?: LastIoSummary | null;
  last_run_by_chat?: Record<string, RunSummary | null | undefined>;
  last_io_by_chat?: Record<string, LastIoSummary | null | undefined>;
  workflow_round_counters?: Record<
    string,
    Partial<WorkflowRoundCounterEntry> | undefined
  >;
  backups?: Record<
    string,
    {
      at: number;
      worldbook_name: string;
      controller_content:
        | string
        | Record<string, string>
        | ControllerEntrySnapshot[];
    }
  >;
};

const LOCAL_STORAGE_KEY = "evolution_world_assistant";

const settingsListeners = new Set<SettingsListener>();
const runListeners = new Set<RunListener>();
const ioListeners = new Set<IoListener>();
const SHARED_SETTINGS_WRITE_DELAY_MS = 120;
const MAX_WORKFLOW_ROUND_COUNTER_CHATS = 40;
const MAX_DEBUG_RECORD_CHATS = 80;

let cachedSettings: EwSettings | null = null;
let cachedLastRun: RunSummary | null | undefined = undefined;
let cachedLastIo: LastIoSummary | null | undefined = undefined;
let sharedSettingsHydrationPromise: Promise<EwSettings> | null = null;
let sharedSettingsWriteTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSharedSettings: EwSettings | null = null;
let sharedSettingsWritePromise: Promise<void> = Promise.resolve();
let hydrationComplete = false;

// M-3: 使用 factory.ts 中的共享工厂函数。
const makeDefaultApiPreset = createDefaultApiPreset;
const makeDefaultFlow = createDefaultFlow;

function readScriptStorage(): ScriptStorageShape {
  try {
    const raw = globalThis.localStorage?.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!_.isPlainObject(parsed)) {
      return {};
    }
    return parsed as ScriptStorageShape;
  } catch (error) {
    console.warn(
      "[Evolution World] Failed to read local storage cache:",
      error,
    );
    return {};
  }
}

function writeScriptStorage(
  updater: (storage: ScriptStorageShape) => ScriptStorageShape,
) {
  const previous = readScriptStorage();
  const nextStorage = updater(previous);

  try {
    globalThis.localStorage?.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify(nextStorage),
    );
  } catch (error) {
    console.warn(
      "[Evolution World] Failed to write local storage cache:",
      error,
    );
  }
}

function normalizePersistedWorkbenchGraphs(raw: unknown): unknown {
  if (!_.isPlainObject(raw)) {
    return raw;
  }

  const next = { ...(raw as Record<string, unknown>) };
  if (!("workbench_graphs" in next)) {
    return next;
  }

  next.workbench_graphs =
    readGraphDocumentAsWorkbenchGraphs(next.workbench_graphs) ?? [];
  return next;
}

function encodeSettingsForPersist(
  settings: EwSettings,
): Record<string, unknown> {
  const next = klona(settings) as unknown as Record<string, unknown>;
  next.workbench_graphs = createGraphDocumentEnvelope({
    graphs: settings.workbench_graphs ?? [],
    source: "settings_persist",
  });
  return next;
}

function persistLocalSettings(settings: EwSettings) {
  writeScriptStorage((previous) => ({
    ...previous,
    settings: encodeSettingsForPersist(settings),
  }));
}

function normalizeWorkflowRoundCounterEntry(
  raw: Partial<WorkflowRoundCounterEntry> | undefined,
): WorkflowRoundCounterEntry {
  return {
    before_reply: Math.max(0, Math.trunc(Number(raw?.before_reply ?? 0) || 0)),
    after_reply: Math.max(0, Math.trunc(Number(raw?.after_reply ?? 0) || 0)),
    updated_at: Math.max(0, Math.trunc(Number(raw?.updated_at ?? 0) || 0)),
  };
}

export function advanceWorkflowRoundCounter(
  chatId: string,
  timing: "before_reply" | "after_reply",
): number {
  let nextValue = 1;

  writeScriptStorage((previous) => {
    const counters = {
      ...(previous.workflow_round_counters ?? {}),
    };
    const entry = normalizeWorkflowRoundCounterEntry(counters[chatId]);
    nextValue = entry[timing] + 1;
    counters[chatId] = {
      ...entry,
      [timing]: nextValue,
      updated_at: Date.now(),
    };

    const entries = Object.entries(counters);
    if (entries.length > MAX_WORKFLOW_ROUND_COUNTER_CHATS) {
      entries.sort(
        (left, right) =>
          (Number(right[1]?.updated_at ?? 0) || 0) -
          (Number(left[1]?.updated_at ?? 0) || 0),
      );
      for (const [staleChatId] of entries.slice(
        MAX_WORKFLOW_ROUND_COUNTER_CHATS,
      )) {
        delete counters[staleChatId];
      }
    }

    return {
      ...previous,
      workflow_round_counters: counters,
    };
  });

  return nextValue;
}

function queueSharedSettingsPersist(settings: EwSettings) {
  pendingSharedSettings = klona(settings);

  if (sharedSettingsWriteTimer !== null) {
    clearTimeout(sharedSettingsWriteTimer);
  }

  sharedSettingsWriteTimer = setTimeout(() => {
    sharedSettingsWriteTimer = null;
    const nextSettings = pendingSharedSettings;
    pendingSharedSettings = null;
    if (!nextSettings) {
      return;
    }

    sharedSettingsWritePromise = sharedSettingsWritePromise
      .catch(() => undefined)
      .then(async () => {
        await writeSharedSettings(
          encodeSettingsForPersist(nextSettings) as EwSettings,
        );
      })
      .catch((error) => {
        console.warn(
          "[Evolution World] Failed to persist shared settings:",
          error,
        );
      });
  }, SHARED_SETTINGS_WRITE_DELAY_MS);
}

function ensurePresetId(
  rawId: string,
  index: number,
  usedIds: Set<string>,
): string {
  let nextId =
    rawId.trim() ||
    `api_${index + 1}_${simpleHash(`api-${index}-${Date.now()}`)}`;
  while (usedIds.has(nextId)) {
    nextId = `${nextId}_${usedIds.size + 1}`;
  }
  usedIds.add(nextId);
  return nextId;
}

function ensurePresetName(baseName: string, usedNames: Set<string>): string {
  const trimmed = baseName.trim() || "API配置";
  if (!usedNames.has(trimmed)) {
    usedNames.add(trimmed);
    return trimmed;
  }

  let counter = 2;
  let nextName = `${trimmed} ${counter}`;
  while (usedNames.has(nextName)) {
    counter += 1;
    nextName = `${trimmed} ${counter}`;
  }
  usedNames.add(nextName);
  return nextName;
}

function ensureFlowId(
  rawId: string,
  index: number,
  flowName: string,
  usedIds: Set<string>,
): string {
  const trimmed = rawId.trim();
  const baseId =
    trimmed ||
    `flow_${index + 1}_${simpleHash(`${index}:${flowName || "flow"}`)}`;
  let nextId = baseId;
  let counter = 2;
  while (usedIds.has(nextId)) {
    nextId = `${baseId}__${counter}`;
    counter += 1;
  }
  usedIds.add(nextId);
  return nextId;
}

function normalizeApiPresets(rawPresets: EwApiPreset[]): EwApiPreset[] {
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();

  const normalized = rawPresets.map((preset, index) => {
    const parsed = EwApiPresetSchema.parse(preset);
    const id = ensurePresetId(parsed.id, index, usedIds);
    const name = ensurePresetName(parsed.name, usedNames);
    return EwApiPresetSchema.parse({
      ...parsed,
      id,
      name,
      mode: parsed.mode ?? "workflow_http",
      use_main_api: parsed.use_main_api ?? false,
      model: parsed.model ?? "",
      api_source: parsed.api_source ?? "openai",
      model_candidates: parsed.model_candidates ?? [],
    });
  });

  if (normalized.length > 0) {
    return normalized;
  }

  return [];
}

function findPresetByLegacyFields(
  presets: EwApiPreset[],
  flow: EwFlowConfig,
): EwApiPreset | null {
  const legacyUrl = flow.api_url.trim();
  const legacyKey = flow.api_key.trim();
  const legacyHeaders = flow.headers_json.trim();
  if (!legacyUrl && !legacyKey && !legacyHeaders) {
    return null;
  }

  return (
    presets.find((preset) => {
      return (
        preset.api_url.trim() === legacyUrl &&
        preset.api_key.trim() === legacyKey &&
        preset.headers_json.trim() === legacyHeaders
      );
    }) ?? null
  );
}

function migratePromptItems(flow: EwFlowConfig): EwFlowConfig {
  // 如果 prompt_order 已被自定义（长度与默认不同），跳过迁移
  if (flow.prompt_order.length !== DEFAULT_PROMPT_ORDER.length) return flow;

  // 检查 prompt_order 是否仍为默认值（从未被用户配置）
  const isDefault = flow.prompt_order.every(
    (entry, idx) => entry.identifier === DEFAULT_PROMPT_ORDER[idx].identifier,
  );
  if (!isDefault) return flow;

  // 如果存在 prompt_items，将其作为自定义条目追加到 prompt_order
  if (flow.prompt_items.length === 0) return flow;

  const migratedOrder: EwPromptOrderEntry[] = [...flow.prompt_order];
  for (const item of flow.prompt_items) {
    // 避免重复 —— 检查 identifier 是否已存在
    if (migratedOrder.some((e) => e.identifier === item.id)) continue;
    const oldItem = item as any; // may carry legacy depth field
    migratedOrder.push({
      identifier: item.id,
      name: item.name || "迁移提示词",
      enabled: item.enabled,
      type: "prompt",
      role: item.role as "system" | "user" | "assistant",
      content: item.content,
      injection_position: item.position === "in_chat" ? "in_chat" : "relative",
      injection_depth:
        typeof oldItem.injection_depth === "number"
          ? oldItem.injection_depth
          : typeof oldItem.depth === "number"
            ? oldItem.depth
            : 0,
    });
  }
  return { ...flow, prompt_order: migratedOrder };
}

function normalizeSettings(raw: unknown): EwSettings {
  const normalizedRaw = normalizePersistedWorkbenchGraphs(raw);

  // Migrate legacy controller_entry_name → controller_entry_prefix.
  if (
    normalizedRaw &&
    typeof normalizedRaw === "object" &&
    !Array.isArray(normalizedRaw)
  ) {
    const obj = normalizedRaw as Record<string, unknown>;
    if (
      typeof obj["controller_entry_name"] === "string" &&
      !obj["controller_entry_prefix"]
    ) {
      const oldName = obj["controller_entry_name"] as string;
      obj["controller_entry_prefix"] = oldName.endsWith("/")
        ? oldName
        : oldName + "/";
      delete obj["controller_entry_name"];
    }
    // Migrate legacy implicit parallel staggering.
    // Old versions defaulted to 10s, which is easily misread as a duplicate reroll.
    // Treat that legacy default as unsafe and collapse it back to true parallel dispatch.
    if (Number(obj["parallel_dispatch_interval_seconds"] ?? 0) === 10) {
      obj["parallel_dispatch_interval_seconds"] = 0;
    }
  }

  const parsed = EwSettingsSchema.safeParse(normalizedRaw);
  const base = parsed.success ? parsed.data : EwSettingsSchema.parse({});
  const apiPresets = normalizeApiPresets(base.api_presets ?? []);
  const usedPresetNames = new Set(apiPresets.map((preset) => preset.name));
  const defaultPresetId = apiPresets[0]?.id ?? "";
  const flowSeed = base.flows;
  const usedFlowIds = new Set<string>();

  const normalizedFlows = flowSeed.map((flow, index) => {
    let nextFlow = EwFlowConfigSchema.parse(flow);
    // Ensure unique flow IDs — deduplicate collisions
    const uniqueFlowId = ensureFlowId(
      nextFlow.id,
      index,
      nextFlow.name,
      usedFlowIds,
    );
    if (uniqueFlowId !== nextFlow.id) {
      console.warn(
        `[Evolution World] normalized duplicate flow id "${nextFlow.id}" -> "${uniqueFlowId}"`,
      );
      nextFlow = EwFlowConfigSchema.parse({
        ...nextFlow,
        id: uniqueFlowId,
      });
    }
    // FEAT-2: 将旧的 prompt_items 迁移到 prompt_order
    nextFlow = migratePromptItems(nextFlow);
    const boundPreset = apiPresets.find(
      (preset) => preset.id === nextFlow.api_preset_id,
    );
    if (boundPreset) {
      return nextFlow;
    }

    const legacyPreset = findPresetByLegacyFields(apiPresets, nextFlow);
    if (legacyPreset) {
      return EwFlowConfigSchema.parse({
        ...nextFlow,
        api_preset_id: legacyPreset.id,
      });
    }

    const hasLegacyApiConfig = Boolean(
      nextFlow.api_url.trim() ||
      nextFlow.api_key.trim() ||
      nextFlow.headers_json.trim(),
    );
    if (hasLegacyApiConfig) {
      const createdPreset = EwApiPresetSchema.parse({
        id: ensurePresetId(
          "",
          apiPresets.length,
          new Set(apiPresets.map((preset) => preset.id)),
        ),
        name: ensurePresetName(
          `${nextFlow.name || "工作流"} API`,
          usedPresetNames,
        ),
        mode: "workflow_http",
        use_main_api: false,
        api_url: nextFlow.api_url,
        api_key: nextFlow.api_key,
        model: "",
        api_source: "openai",
        model_candidates: [],
        headers_json: nextFlow.headers_json,
      });
      apiPresets.push(createdPreset);
      return EwFlowConfigSchema.parse({
        ...nextFlow,
        api_preset_id: createdPreset.id,
      });
    }

    return EwFlowConfigSchema.parse({
      ...nextFlow,
      api_preset_id: defaultPresetId,
    });
  });

  const result = EwSettingsSchema.parse({
    ...base,
    api_presets: apiPresets,
    flows: normalizedFlows,
  });

  // Auto-migrate legacy flows → WorkbenchGraphs whenever graphs are still empty.
  // Uses the graph document codec's unified read path for consistent normalization,
  // with a direct migrateAllFlows fallback if codec absorption fails.
  if (normalizedFlows.length > 0 && !(result as any).workbench_graphs?.length) {
    try {
      const codecGraphs = readGraphDocumentAsWorkbenchGraphs({
        ew_flow_export: true,
        flows: normalizedFlows,
      });
      if (codecGraphs && codecGraphs.length > 0) {
        (result as any).workbench_graphs = codecGraphs;
        console.info(
          `[Evolution World] Auto-migrated ${normalizedFlows.length} legacy flows to workbench graphs via codec`,
        );
      } else {
        // Fallback to direct migration
        (result as any).workbench_graphs = migrateAllFlows(normalizedFlows);
        console.info(
          `[Evolution World] Auto-migrated ${normalizedFlows.length} legacy flows to workbench graphs (direct)`,
        );
      }
    } catch (e) {
      console.debug("[Evolution World] Auto-migration skipped:", e);
    }
  }

  return result;
}

type WorkflowBridgeFacts = {
  route: "graph" | "legacy";
  reason: string;
  has_explicit_legacy_flow_selection?: boolean;
  enabled_graph_count?: number;
  selected_graph_ids?: string[];
  failure_origin?: string;
  graph_compile_run_link_artifact?: ReturnType<
    typeof readGraphCompileRunLinkArtifactEnvelope
  >;
  graph_failure_explain_artifact?: ReturnType<
    typeof readGraphFailureExplainArtifactEnvelope
  >;
  graph_host_effect_explain_artifact?: ReturnType<
    typeof readGraphHostEffectExplainArtifactEnvelope
  >;
  graph_output_explain_artifact?: ReturnType<
    typeof readGraphOutputExplainArtifactEnvelope
  >;
  graph_reuse_explain_artifact?: ReturnType<
    typeof readGraphReuseExplainArtifactEnvelope
  >;
  graph_terminal_outcome_explain_artifact?: ReturnType<
    typeof readGraphTerminalOutcomeExplainArtifactEnvelope
  >;
};

function normalizeWorkflowBridgeDiagnostics(
  bridge: unknown,
): WorkflowBridgeFacts | undefined {
  if (!_.isPlainObject(bridge)) {
    return undefined;
  }

  const bridgeRecord = bridge as Record<string, unknown>;
  const route = bridgeRecord.route;
  const reason = bridgeRecord.reason;
  if ((route !== "graph" && route !== "legacy") || typeof reason !== "string") {
    return undefined;
  }

  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    return undefined;
  }

  const normalized: WorkflowBridgeFacts = {
    route,
    reason: normalizedReason,
  };

  if (typeof bridgeRecord.has_explicit_legacy_flow_selection === "boolean") {
    normalized.has_explicit_legacy_flow_selection =
      bridgeRecord.has_explicit_legacy_flow_selection;
  }

  const enabledGraphCount = bridgeRecord.enabled_graph_count;
  if (
    typeof enabledGraphCount === "number" &&
    Number.isInteger(enabledGraphCount) &&
    enabledGraphCount >= 0
  ) {
    normalized.enabled_graph_count = enabledGraphCount;
  }

  const graphContext = _.isPlainObject(bridgeRecord.graph_context)
    ? (bridgeRecord.graph_context as Record<string, unknown>)
    : null;
  const selectedGraphIds = Array.isArray(bridgeRecord.selected_graph_ids)
    ? bridgeRecord.selected_graph_ids
    : graphContext?.selected_graph_ids;
  if (
    Array.isArray(selectedGraphIds) &&
    selectedGraphIds.every((entry: unknown) => typeof entry === "string")
  ) {
    normalized.selected_graph_ids = [...selectedGraphIds];
  }

  const failureOrigin = bridgeRecord.failure_origin;
  if (typeof failureOrigin === "string") {
    const normalizedFailureOrigin = failureOrigin.trim();
    if (normalizedFailureOrigin) {
      normalized.failure_origin = normalizedFailureOrigin;
    }
  }

  const graphCompileRunLinkArtifact = readGraphCompileRunLinkArtifactEnvelope({
    bridge: bridgeRecord,
  });
  if (graphCompileRunLinkArtifact) {
    normalized.graph_compile_run_link_artifact = graphCompileRunLinkArtifact;
  }

  const graphFailureExplainArtifact = readGraphFailureExplainArtifactEnvelope({
    bridge: bridgeRecord,
  });
  if (graphFailureExplainArtifact) {
    normalized.graph_failure_explain_artifact = graphFailureExplainArtifact;
  }

  const graphHostEffectExplainArtifact =
    readGraphHostEffectExplainArtifactEnvelope({
      bridge: bridgeRecord,
    });
  if (graphHostEffectExplainArtifact) {
    normalized.graph_host_effect_explain_artifact =
      graphHostEffectExplainArtifact;
  }

  const graphOutputExplainArtifact = readGraphOutputExplainArtifactEnvelope({
    bridge: bridgeRecord,
  });
  if (graphOutputExplainArtifact) {
    normalized.graph_output_explain_artifact = graphOutputExplainArtifact;
  }

  const graphReuseExplainArtifact = readGraphReuseExplainArtifactEnvelope({
    bridge: bridgeRecord,
  });
  if (graphReuseExplainArtifact) {
    normalized.graph_reuse_explain_artifact = graphReuseExplainArtifact;
  }

  const graphTerminalOutcomeExplainArtifact =
    readGraphTerminalOutcomeExplainArtifactEnvelope({
      bridge: bridgeRecord,
    });
  if (graphTerminalOutcomeExplainArtifact) {
    normalized.graph_terminal_outcome_explain_artifact =
      graphTerminalOutcomeExplainArtifact;
  }

  return normalized;
}

function normalizeRunSummaryBridge(summary: unknown): unknown {
  if (!_.isPlainObject(summary)) {
    return summary;
  }

  const summaryRecord = summary as Record<string, unknown>;
  if (!_.isPlainObject(summaryRecord.diagnostics)) {
    return summary;
  }

  const diagnostics = {
    ...(summaryRecord.diagnostics as Record<string, unknown>),
  };
  const normalizedBridge = normalizeWorkflowBridgeDiagnostics(
    diagnostics.bridge,
  );

  if (normalizedBridge) {
    diagnostics.bridge = normalizedBridge;
  } else {
    delete diagnostics.bridge;
  }

  return {
    ...summaryRecord,
    diagnostics,
  };
}

function normalizeRunRecordMap(
  storage: ScriptStorageShape,
): Record<string, RunSummary> {
  const raw = storage.last_run_by_chat;
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const next: Record<string, RunSummary> = {};
  for (const [chatId, summary] of Object.entries(raw)) {
    const parsed = RunSummarySchema.safeParse(
      normalizeRunSummaryBridge(summary),
    );
    if (parsed.success) {
      next[chatId] = parsed.data;
    }
  }
  return next;
}

function normalizeIoRecordMap(
  storage: ScriptStorageShape,
): Record<string, LastIoSummary> {
  const raw = storage.last_io_by_chat;
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const next: Record<string, LastIoSummary> = {};
  for (const [chatId, summary] of Object.entries(raw)) {
    const parsed = LastIoSummarySchema.safeParse(summary);
    if (parsed.success) {
      next[chatId] = parsed.data;
    }
  }
  return next;
}

function trimDebugRecordMap<T extends { at: number }>(
  records: Record<string, T>,
  maxEntries: number,
): Record<string, T> {
  const entries = Object.entries(records);
  if (entries.length <= maxEntries) {
    return records;
  }

  entries.sort(
    (left, right) => Number(right[1]?.at ?? 0) - Number(left[1]?.at ?? 0),
  );
  return Object.fromEntries(entries.slice(0, maxEntries));
}

function emitSettings(settings: EwSettings) {
  settingsListeners.forEach((listener) => listener(settings));
}

function emitRun(summary: RunSummary | null) {
  runListeners.forEach((listener) => listener(summary));
}

function emitIo(summary: LastIoSummary | null) {
  ioListeners.forEach((listener) => listener(summary));
}

export function loadSettings(): EwSettings {
  const storage = readScriptStorage();
  const normalized = normalizeSettings(storage.settings);
  cachedSettings = normalized;

  persistLocalSettings(normalized);
  return normalized;
}

export async function hydrateSharedSettings(): Promise<EwSettings> {
  if (sharedSettingsHydrationPromise) {
    return sharedSettingsHydrationPromise;
  }

  sharedSettingsHydrationPromise = (async () => {
    const localStorage = readScriptStorage();
    const localNormalized =
      cachedSettings ?? normalizeSettings(localStorage.settings);

    try {
      const shared = await readSharedSettings();
      if (shared?.settings) {
        const normalized = normalizeSettings(shared.settings);
        const changed = !_.isEqual(cachedSettings, normalized);
        cachedSettings = normalized;
        persistLocalSettings(normalized);
        if (changed) {
          emitSettings(klona(normalized));
        }
        hydrationComplete = true;
        console.info(
          "[Evolution World] Shared settings loaded from server file",
        );
        return klona(normalized);
      }

      cachedSettings = localNormalized;
      await writeSharedSettings(
        encodeSettingsForPersist(localNormalized) as EwSettings,
      );
      persistLocalSettings(localNormalized);
      hydrationComplete = true;
      console.info(
        localStorage.settings
          ? "[Evolution World] Migrated legacy local settings to shared server file"
          : "[Evolution World] Initialized shared server settings file",
      );
      return klona(localNormalized);
    } catch (error) {
      console.warn(
        "[Evolution World] Shared settings hydration failed, using local cache:",
        error,
      );
      cachedSettings = localNormalized;
      persistLocalSettings(localNormalized);
      hydrationComplete = true;
      return klona(localNormalized);
    }
  })();

  return sharedSettingsHydrationPromise;
}

export function getSettings(): EwSettings {
  if (!cachedSettings) {
    cachedSettings = loadSettings();
  }
  return klona(cachedSettings);
}

export function isHydrationComplete(): boolean {
  return hydrationComplete;
}

export function replaceSettings(nextSettings: EwSettings): EwSettings {
  const normalized = normalizeSettings(nextSettings);
  cachedSettings = normalized;
  queueSharedSettingsPersist(normalized);
  persistLocalSettings(normalized);
  emitSettings(klona(normalized));
  return klona(normalized);
}

export function persistSettingsDraft(nextSettings: EwSettings) {
  const draft = klona(nextSettings);
  cachedSettings = draft;
  queueSharedSettingsPersist(draft);
  persistLocalSettings(draft);
}

export function patchSettings(partial: Partial<EwSettings>): EwSettings {
  // 使用展开运算符（浅合并）替代 _.merge，避免按索引合并数组导致的数据损坏。
  // _.merge 在新数组较短时会保留旧数组的条目。
  const current = getSettings();
  const merged: EwSettings = { ...current, ...partial };
  return replaceSettings(merged);
}

export function subscribeSettings(listener: SettingsListener): {
  stop: () => void;
} {
  settingsListeners.add(listener);
  return { stop: () => settingsListeners.delete(listener) };
}

function persistNormalizedLastRunRecord(
  storage: ScriptStorageShape,
  summary: RunSummary,
): void {
  writeScriptStorage((previous) => {
    const byChat = normalizeRunRecordMap({
      ...previous,
      last_run_by_chat: storage.last_run_by_chat ?? previous.last_run_by_chat,
    });
    if (summary.chat_id.trim()) {
      byChat[summary.chat_id.trim()] = summary;
    }
    return {
      ...previous,
      last_run: summary,
      last_run_by_chat: trimDebugRecordMap(byChat, MAX_DEBUG_RECORD_CHATS),
    };
  });
}

export function loadLastRun(): RunSummary | null {
  const storage = readScriptStorage();
  const parsed = RunSummarySchema.safeParse(
    normalizeRunSummaryBridge(storage.last_run),
  );
  cachedLastRun = parsed.success ? parsed.data : null;
  if (cachedLastRun) {
    persistNormalizedLastRunRecord(storage, cachedLastRun);
  }
  return cachedLastRun ? klona(cachedLastRun) : null;
}

export function getLastRun(): RunSummary | null {
  if (cachedLastRun === undefined) {
    return loadLastRun();
  }
  return cachedLastRun ? klona(cachedLastRun) : null;
}

export function setLastRun(summary: RunSummary) {
  const normalized = RunSummarySchema.parse(normalizeRunSummaryBridge(summary));
  cachedLastRun = normalized;
  persistNormalizedLastRunRecord(readScriptStorage(), normalized);
  emitRun(klona(normalized));
}

export function subscribeLastRun(listener: RunListener): { stop: () => void } {
  runListeners.add(listener);
  return { stop: () => runListeners.delete(listener) };
}

export function loadLastIo(): LastIoSummary | null {
  const storage = readScriptStorage();
  const parsed = LastIoSummarySchema.safeParse(storage.last_io);
  cachedLastIo = parsed.success ? parsed.data : null;
  return cachedLastIo ? klona(cachedLastIo) : null;
}

export function getLastIo(): LastIoSummary | null {
  if (cachedLastIo === undefined) {
    return loadLastIo();
  }
  return cachedLastIo ? klona(cachedLastIo) : null;
}

export function setLastIo(summary: LastIoSummary) {
  const normalized = LastIoSummarySchema.parse(summary);
  cachedLastIo = normalized;
  writeScriptStorage((previous) => {
    const byChat = normalizeIoRecordMap(previous);
    if (normalized.chat_id.trim()) {
      byChat[normalized.chat_id.trim()] = normalized;
    }
    return {
      ...previous,
      last_io: normalized,
      last_io_by_chat: trimDebugRecordMap(byChat, MAX_DEBUG_RECORD_CHATS),
    };
  });
  emitIo(klona(normalized));
}

export function subscribeLastIo(listener: IoListener): { stop: () => void } {
  ioListeners.add(listener);
  return { stop: () => ioListeners.delete(listener) };
}

export function loadLastRunForChat(chatId: string): RunSummary | null {
  const normalizedChatId = String(chatId ?? "").trim();
  if (!normalizedChatId) {
    return loadLastRun();
  }

  const storage = readScriptStorage();
  const byChat = normalizeRunRecordMap(storage);
  const summary = byChat[normalizedChatId] ?? null;
  if (summary) {
    cachedLastRun = summary;
    persistNormalizedLastRunRecord(storage, summary);
    return klona(summary);
  }

  const globalSummary = RunSummarySchema.safeParse(
    normalizeRunSummaryBridge(storage.last_run),
  );
  if (
    globalSummary.success &&
    globalSummary.data.chat_id.trim() === normalizedChatId
  ) {
    cachedLastRun = globalSummary.data;
    persistNormalizedLastRunRecord(storage, globalSummary.data);
    return klona(globalSummary.data);
  }

  return null;
}

export function loadLastIoForChat(chatId: string): LastIoSummary | null {
  const normalizedChatId = String(chatId ?? "").trim();
  if (!normalizedChatId) {
    return loadLastIo();
  }

  const storage = readScriptStorage();
  const byChat = normalizeIoRecordMap(storage);
  const summary = byChat[normalizedChatId] ?? null;
  if (summary) {
    cachedLastIo = summary;
    return klona(summary);
  }

  const globalSummary = LastIoSummarySchema.safeParse(storage.last_io);
  if (
    globalSummary.success &&
    globalSummary.data.chat_id.trim() === normalizedChatId
  ) {
    cachedLastIo = globalSummary.data;
    return klona(globalSummary.data);
  }

  return null;
}

export function saveControllerBackup(
  chatId: string,
  worldbookName: string,
  controllerContent: ControllerEntrySnapshot[],
) {
  const MAX_BACKUPS = 10;
  writeScriptStorage((previous) => {
    const backups = { ...(previous.backups ?? {}) };
    backups[chatId] = {
      at: Date.now(),
      worldbook_name: worldbookName,
      controller_content: controllerContent,
    };

    // CR-4: LRU 淘汰 —— 仅保留最近的 MAX_BACKUPS 条记录。
    const entries = Object.entries(backups);
    if (entries.length > MAX_BACKUPS) {
      entries.sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0));
      const keysToRemove = entries.slice(MAX_BACKUPS).map((e) => e[0]);
      for (const key of keysToRemove) {
        delete backups[key];
      }
    }

    return { ...previous, backups };
  });
}

export function readControllerBackup(chatId: string): {
  at: number;
  worldbook_name: string;
  controller_content: ControllerEntrySnapshot[];
} | null {
  const storage = readScriptStorage();
  const backup = storage.backups?.[chatId];
  if (!backup) return null;

  const content = backup.controller_content;
  let controllers: ControllerEntrySnapshot[] = [];
  if (Array.isArray(content)) {
    controllers = content
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        entry_name: String((entry as ControllerEntrySnapshot).entry_name ?? ""),
        content: String((entry as ControllerEntrySnapshot).content ?? ""),
        flow_id: (entry as ControllerEntrySnapshot).flow_id,
        flow_name: (entry as ControllerEntrySnapshot).flow_name,
        legacy: Boolean((entry as ControllerEntrySnapshot).legacy),
      }))
      .filter((entry) => entry.content);
  } else if (typeof content === "string") {
    controllers = content
      ? [
          {
            entry_name: "",
            content,
            flow_name: "Legacy Controller",
            legacy: true,
          },
        ]
      : [];
  } else if (content && typeof content === "object") {
    controllers = Object.entries(content).map(([entryName, value]) => ({
      entry_name: entryName,
      content: String(value ?? ""),
    }));
  }

  return klona({
    at: backup.at,
    worldbook_name: backup.worldbook_name,
    controller_content: controllers,
  });
}

export function clearControllerBackup(chatId: string) {
  writeScriptStorage((previous) => {
    const backups = { ...(previous.backups ?? {}) };
    delete backups[chatId];
    return { ...previous, backups };
  });
}
