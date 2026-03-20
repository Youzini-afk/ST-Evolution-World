import _ from "lodash";
import {
  getEventTypes,
  getSTContext,
  onSTEvent,
  onSTEventFirst,
} from "../st-adapter";
import { EwWorkflowNoticeInput, showManagedWorkflowNotice } from "../ui/notice";
import { getEffectiveFlows } from "./char-flows";
import {
  getChatMessages,
  getLastMessageId,
  setChatMessages,
} from "./compat/character";
import { stopGeneration } from "./compat/generation";
import { clearReplyInstruction } from "./compat/injection";
import {
  applySnapshotDiffToCurrentWorldbook,
  disposeFloorBindingEvents,
  initFloorBindingEvents,
  migrateBeforeReplyArtifactsToAssistant,
  readFloorSnapshotByMessageId,
  rollbackBeforeFloor,
} from "./floor-binding";
import { getMessageVersionInfo, simpleHash } from "./helpers";
import { runIncrementalHideCheck } from "./hide-engine";
import { resetInterceptGuard, wasRecentlyIntercepted } from "./intercept-guard";
import { runWorkflow } from "./pipeline";
import { getSettings } from "./settings";
import {
  clearAfterReplyPending,
  clearAfterReplyPendingIfMatches,
  clearBeforeReplyBindingPending,
  clearSendContextIfMatches,
  getRuntimeState,
  isQuietLike,
  markAfterReplyHandled,
  markBeforeReplyBindingMigrated,
  pruneExpiredBeforeReplyBindingPending,
  recordGeneration,
  recordUserSend,
  recordUserSendIntent,
  resetRuntimeState,
  setBeforeReplyBindingPending,
  setProcessing,
  shouldHandleAfterReply,
  shouldHandleGenerationAfter,
  wasAfterReplyHandled,
} from "./state";
import {
  ContextCursor,
  DispatchFlowAttempt,
  DispatchFlowResult,
  EwSettings,
  WorkflowCapsuleMode,
  WorkflowFailureDiagnostic,
  WorkflowJobType,
  WorkflowProgressUpdate,
  WorkflowWritebackPolicy,
} from "./types";

type StopFn = () => void;

const EW_FLOOR_WORKFLOW_EXECUTION_KEY = "ew_workflow_execution";
const EW_BEFORE_REPLY_BINDING_KEY = "ew_before_reply_binding";
const EW_REDERIVE_META_KEY = "ew_rederive_meta";
const EW_WORKFLOW_REPLAY_CAPSULE_KEY = "ew_workflow_replay_capsule";

type FloorWorkflowStoredResult = {
  flow_id: string;
  response: Record<string, any>;
};

type FloorWorkflowExecutionVersionedMap = Record<
  string,
  FloorWorkflowExecutionState
>;

type FloorWorkflowExecutionState = {
  at: number;
  request_id: string;
  swipe_id?: number;
  content_hash?: string;
  attempted_flow_ids: string[];
  successful_results: FloorWorkflowStoredResult[];
  failed_flow_ids: string[];
  workflow_failed: boolean;
  execution_status: "executed" | "skipped";
  skip_reason?: string;
};

type WorkflowReplayCapsule = {
  at: number;
  request_id: string;
  job_type: WorkflowJobType;
  timing: "before_reply" | "after_reply" | "manual";
  source: string;
  generation_type: string;
  target_message_id: number;
  target_version_key: string;
  target_role: "user" | "assistant" | "other";
  flow_ids: string[];
  flow_ids_hash: string;
  capsule_mode: WorkflowCapsuleMode;
  legacy_approx: boolean;
  assembled_messages?: Array<{ role: string; content: string; name?: string }>;
  request_preview?: Array<Record<string, unknown>>;
};

const listenerStops: StopFn[] = [];
const domCleanup: Array<() => void> = [];
const HOOK_RETRY_DELAY_MS = 1200;
const EW_GENERATE_INTERCEPTOR_KEY = "ew_generation_interceptor";
let sendIntentRetryTimer: ReturnType<typeof setTimeout> | null = null;
const NON_SEND_GENERATION_TYPES = new Set(["continue", "regenerate", "swipe"]);
const WORKFLOW_NOTICE_COLLAPSE_MS = 5000;

// ST 扩展直接运行在主页面，无需 getHostWindow/getChatDocument
function getChatDocument(): Document {
  return document;
}

function scheduleSendIntentHooksRetry() {
  if (sendIntentRetryTimer) {
    return;
  }

  sendIntentRetryTimer = setTimeout(() => {
    sendIntentRetryTimer = null;
    installSendIntentHooks();
  }, HOOK_RETRY_DELAY_MS);
}

function registerGenerationAfterCommands(
  handler: (
    type: string,
    params: Record<string, any>,
    dryRun: boolean,
  ) => Promise<void>,
): StopFn {
  const eventTypes = getEventTypes();
  return onSTEventFirst(eventTypes.GENERATION_AFTER_COMMANDS, handler);
}

function getSendTextareaValue(): string {
  const textarea = getChatDocument().getElementById(
    "send_textarea",
  ) as HTMLTextAreaElement | null;
  return String(textarea?.value ?? "");
}

function firstNonEmptyText(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "");
    if (text.trim()) {
      return text;
    }
  }

  return "";
}

function getLatestUserMessageText(): string {
  try {
    const msgs = getChatMessages(`0-${getLastMessageId()}`, {
      hide_state: "unhidden",
    });
    const lastUserMsg = [...msgs]
      .reverse()
      .find((message: any) => message.role === "user");
    return String(lastUserMsg?.message ?? "");
  } catch {
    return "";
  }
}

function getInterceptedUserInput(options: Record<string, any>): string {
  const runtimeState = getRuntimeState();
  return firstNonEmptyText(
    options.user_input,
    options.prompt,
    runtimeState.last_send_intent?.user_input,
    options.injects?.[0]?.content,
  );
}

function resolveWorkflowUserInput(
  options: Record<string, any>,
  generationType: string,
): string {
  const interceptedInput = getInterceptedUserInput(options);
  if (interceptedInput) {
    return interceptedInput;
  }

  if (NON_SEND_GENERATION_TYPES.has(generationType)) {
    return getLatestUserMessageText();
  }

  return "";
}

function resolveFallbackWorkflowUserInput(generationType: string): string {
  const runtimeState = getRuntimeState();
  const interceptedInput = firstNonEmptyText(
    runtimeState.last_send?.user_input,
    runtimeState.last_send_intent?.user_input,
  );
  if (interceptedInput) {
    return interceptedInput;
  }

  if (NON_SEND_GENERATION_TYPES.has(generationType)) {
    return getLatestUserMessageText();
  }

  return "";
}

function resolvePrimaryWorkflowUserInput(generationType: string): string {
  const textareaInput = getSendTextareaValue();
  if (textareaInput.trim()) {
    return textareaInput;
  }

  return resolveFallbackWorkflowUserInput(generationType);
}

function resolveAfterReplyUserInput(): string {
  const runtimeState = getRuntimeState();
  return firstNonEmptyText(
    runtimeState.after_reply.pending_user_input,
    runtimeState.last_send?.user_input,
    runtimeState.last_send_intent?.user_input,
    getLatestUserMessageText(),
  );
}

function installSendIntentHooks() {
  for (const cleanup of domCleanup.splice(0, domCleanup.length)) {
    cleanup();
  }

  const doc = getChatDocument();
  const sendButton = doc.getElementById("send_but");
  if (sendButton) {
    const onSendIntent = () => {
      recordUserSendIntent(getSendTextareaValue());
    };
    sendButton.addEventListener("click", onSendIntent, true);
    sendButton.addEventListener("pointerup", onSendIntent, true);
    sendButton.addEventListener("touchend", onSendIntent, true);
    domCleanup.push(() => {
      sendButton.removeEventListener("click", onSendIntent, true);
      sendButton.removeEventListener("pointerup", onSendIntent, true);
      sendButton.removeEventListener("touchend", onSendIntent, true);
    });
  }

  const sendTextarea = doc.getElementById("send_textarea");
  if (sendTextarea) {
    const onKeyDown = (event: Event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (
        (keyboardEvent.key === "Enter" ||
          keyboardEvent.key === "NumpadEnter") &&
        !keyboardEvent.shiftKey
      ) {
        recordUserSendIntent(getSendTextareaValue());
      }
    };
    sendTextarea.addEventListener("keydown", onKeyDown, true);
    domCleanup.push(() =>
      sendTextarea.removeEventListener("keydown", onKeyDown, true),
    );
  }

  if (!sendButton || !sendTextarea) {
    scheduleSendIntentHooksRetry();
  }
}

function stopGenerationNow() {
  try {
    stopGeneration();
  } catch {
    // ignore
  }
}

function formatReasonForDisplay(
  reason: string | undefined,
  maxLen = 160,
): string {
  const text = String(reason ?? "unknown")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen)}...`;
}

function getFailureStageLabel(
  stage: WorkflowFailureDiagnostic["stage"] | undefined,
): string {
  switch (stage) {
    case "dispatch":
      return "请求阶段";
    case "merge":
      return "合并阶段";
    case "commit":
      return "写回阶段";
    case "cancelled":
      return "已取消";
    case "config":
      return "配置阶段";
    case "unknown":
    default:
      return "未知阶段";
  }
}

function buildFailureNoticeMessage(
  failure: WorkflowFailureDiagnostic | null | undefined,
  fallbackReason: string | undefined,
  options?: { includeReleaseHint?: boolean; retrying?: boolean },
): string {
  if (!failure) {
    return options?.retrying
      ? `首次处理失败，正在重试… ${formatReasonForDisplay(fallbackReason, 120)}`
      : `工作流失败：${formatReasonForDisplay(fallbackReason)}`;
  }

  const lines = [
    options?.retrying
      ? `首次处理失败，正在重试：${failure.summary}`
      : `工作流失败：${failure.summary}`,
    `阶段：${getFailureStageLabel(failure.stage)}`,
  ];

  if (failure.flow_name || failure.flow_id) {
    lines.push(`工作流：${failure.flow_name || failure.flow_id}`);
  }
  if (failure.api_preset_name) {
    lines.push(`接口：${failure.api_preset_name}`);
  }
  if (failure.suggestion) {
    lines.push(`建议：${failure.suggestion}`);
  }
  if (options?.includeReleaseHint) {
    lines.push("原消息是否继续发送取决于当前放行策略。");
  }

  return lines.join("\n");
}

function buildFailureToastMessage(
  failure: WorkflowFailureDiagnostic | null | undefined,
  fallbackReason: string | undefined,
): string {
  if (!failure) {
    return formatReasonForDisplay(fallbackReason);
  }

  const parts = [failure.summary, getFailureStageLabel(failure.stage)];
  if (failure.flow_name || failure.flow_id) {
    parts.push(failure.flow_name || failure.flow_id);
  }
  if (failure.suggestion) {
    parts.push(failure.suggestion);
  }
  return parts.join(" · ");
}

function collectSuccessfulDispatchResultsFromAttempts(
  attempts: DispatchFlowAttempt[],
): DispatchFlowResult[] {
  return attempts
    .filter((attempt) => attempt.ok && attempt.response)
    .map((attempt) => ({
      flow: attempt.flow,
      flow_order: attempt.flow_order,
      response: attempt.response as any,
    }));
}

function mergePreservedDispatchResults(
  current: DispatchFlowResult[],
  next: DispatchFlowResult[],
): DispatchFlowResult[] {
  const resultByFlowId = new Map<string, DispatchFlowResult>();

  for (const item of current) {
    resultByFlowId.set(item.flow.id, item);
  }

  for (const item of next) {
    resultByFlowId.set(item.flow.id, item);
  }

  return [...resultByFlowId.values()].sort(
    (left, right) => left.flow_order - right.flow_order,
  );
}

function resolveAutoRerollTarget(
  result: Awaited<ReturnType<typeof runWorkflow>>,
): { ok: true; flowIds: string[] } | { ok: false; reason: string } {
  const failedFlowIds = [
    ...new Set(
      result.attempts
        .filter((attempt) => !attempt.ok)
        .map((attempt) => String(attempt.flow.id ?? "").trim())
        .filter(Boolean),
    ),
  ];

  if (failedFlowIds.length > 0) {
    return { ok: true, flowIds: failedFlowIds };
  }

  const stage = result.failure?.stage;
  if (stage === "merge" || stage === "commit") {
    return {
      ok: false,
      reason:
        "失败发生在合并/写回阶段；自动重roll已跳过，避免重复请求已成功的工作流。",
    };
  }

  return { ok: false, reason: "未定位到失败工作流；自动重roll已跳过。" };
}

function buildExecutionVersionKey(state: {
  swipe_id?: number;
  content_hash?: string;
}): string {
  return `sw:${Math.max(0, Math.trunc(Number(state.swipe_id ?? 0) || 0))}|${String(state.content_hash ?? "").trim()}`;
}

function normalizeFloorWorkflowExecutionState(
  raw: unknown,
): FloorWorkflowExecutionState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const obj = raw as Record<string, unknown>;
  const successfulResults = Array.isArray(obj.successful_results)
    ? obj.successful_results
        .filter(
          (item) => item && typeof item === "object" && !Array.isArray(item),
        )
        .map((item) => {
          const result = item as Record<string, unknown>;
          return {
            flow_id: String(result.flow_id ?? "").trim(),
            response:
              result.response && typeof result.response === "object"
                ? (result.response as Record<string, any>)
                : {},
          };
        })
        .filter((item) => item.flow_id)
    : [];

  const failedFlowIds = Array.isArray(obj.failed_flow_ids)
    ? obj.failed_flow_ids
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    : [];
  const attemptedFlowIds = Array.isArray(obj.attempted_flow_ids)
    ? obj.attempted_flow_ids
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    : [];

  return {
    at: Number(obj.at ?? 0),
    request_id: String(obj.request_id ?? "").trim(),
    swipe_id: typeof obj.swipe_id === "number" ? obj.swipe_id : undefined,
    content_hash:
      typeof obj.content_hash === "string" ? obj.content_hash : undefined,
    attempted_flow_ids: _.uniq(attemptedFlowIds),
    successful_results: successfulResults,
    failed_flow_ids: _.uniq(failedFlowIds),
    workflow_failed: Boolean(obj.workflow_failed),
    execution_status:
      obj.execution_status === "skipped" ? "skipped" : "executed",
    skip_reason:
      typeof obj.skip_reason === "string" && obj.skip_reason.trim()
        ? obj.skip_reason.trim()
        : undefined,
  };
}

function normalizeFloorWorkflowExecutionMap(
  raw: unknown,
): FloorWorkflowExecutionVersionedMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const obj = raw as Record<string, unknown>;
  if (
    Array.isArray(obj.successful_results) ||
    Array.isArray(obj.failed_flow_ids) ||
    typeof obj.request_id === "string"
  ) {
    const upgraded = normalizeFloorWorkflowExecutionState(raw);
    if (!upgraded) {
      return {};
    }
    return {
      [buildExecutionVersionKey(upgraded)]: upgraded,
    };
  }

  const map: FloorWorkflowExecutionVersionedMap = {};
  for (const [key, value] of Object.entries(obj)) {
    const normalized = normalizeFloorWorkflowExecutionState(value);
    if (normalized) {
      map[key] = normalized;
    }
  }
  return map;
}

function readFloorWorkflowExecutionMap(
  messageId: number,
): FloorWorkflowExecutionVersionedMap {
  try {
    const message = getChatMessages(messageId)[0];
    return normalizeFloorWorkflowExecutionMap(
      message?.data?.[EW_FLOOR_WORKFLOW_EXECUTION_KEY],
    );
  } catch {
    return {};
  }
}

export function readFloorWorkflowExecution(
  messageId: number,
): FloorWorkflowExecutionState | null {
  const message = getChatMessages(messageId)[0];
  if (!message) {
    return null;
  }
  const versionInfo = getMessageVersionInfo(message);
  const map = readFloorWorkflowExecutionMap(messageId);
  const exact = map[versionInfo.version_key];
  if (exact) {
    return exact;
  }
  const values = Object.values(map);
  if (values.length === 1 && !values[0].content_hash) {
    return values[0];
  }
  return null;
}

async function writeFloorWorkflowExecution(
  messageId: number,
  state: FloorWorkflowExecutionState | null,
): Promise<void> {
  const message = getChatMessages(messageId)[0];
  if (!message) {
    return;
  }

  const nextData: Record<string, unknown> = {
    ...(message.data ?? {}),
  };

  if (state) {
    const map = readFloorWorkflowExecutionMap(messageId);
    map[buildExecutionVersionKey(state)] = state;
    nextData[EW_FLOOR_WORKFLOW_EXECUTION_KEY] = map;
  } else {
    delete nextData[EW_FLOOR_WORKFLOW_EXECUTION_KEY];
  }

  await setChatMessages([{ message_id: messageId, data: nextData }], {
    refresh: "none",
  });
}

async function pinFloorWorkflowExecutionToCurrentVersion(
  messageId: number,
  state: FloorWorkflowExecutionState | null,
): Promise<boolean> {
  if (!state) {
    return false;
  }
  const message = getChatMessages(messageId)[0];
  if (!message) {
    return false;
  }
  const versionInfo = getMessageVersionInfo(message);
  const map = readFloorWorkflowExecutionMap(messageId);
  const targetKey = buildExecutionVersionKey(versionInfo);
  if (map[targetKey]) {
    return false;
  }
  map[targetKey] = {
    ...state,
    swipe_id: versionInfo.swipe_id,
    content_hash: versionInfo.content_hash,
  };
  await setChatMessages(
    [
      {
        message_id: messageId,
        data: {
          ...(message.data ?? {}),
          [EW_FLOOR_WORKFLOW_EXECUTION_KEY]: map,
        },
      },
    ],
    { refresh: "none" },
  );
  return true;
}

function normalizeWorkflowReplayCapsuleMap(
  raw: unknown,
): Record<string, WorkflowReplayCapsule> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const map: Record<string, WorkflowReplayCapsule> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const obj = value as Record<string, unknown>;
    map[key] = {
      at: Number(obj.at ?? 0),
      request_id: String(obj.request_id ?? "").trim(),
      job_type:
        obj.job_type === "live_auto" ||
        obj.job_type === "live_reroll" ||
        obj.job_type === "historical_rederive"
          ? obj.job_type
          : "live_auto",
      timing:
        obj.timing === "before_reply" ||
        obj.timing === "after_reply" ||
        obj.timing === "manual"
          ? obj.timing
          : "manual",
      source: String(obj.source ?? ""),
      generation_type: String(obj.generation_type ?? ""),
      target_message_id: Number(obj.target_message_id ?? -1),
      target_version_key: String(obj.target_version_key ?? ""),
      target_role:
        obj.target_role === "user" || obj.target_role === "assistant"
          ? obj.target_role
          : "other",
      flow_ids: Array.isArray(obj.flow_ids)
        ? obj.flow_ids
            .map((value) => String(value ?? "").trim())
            .filter(Boolean)
        : [],
      flow_ids_hash: String(obj.flow_ids_hash ?? ""),
      capsule_mode: obj.capsule_mode === "light" ? "light" : "full",
      legacy_approx: Boolean(obj.legacy_approx),
      assembled_messages: Array.isArray(obj.assembled_messages)
        ? obj.assembled_messages
            .filter(
              (item) =>
                item && typeof item === "object" && !Array.isArray(item),
            )
            .map((item) => ({
              role: String((item as Record<string, unknown>).role ?? ""),
              content: String((item as Record<string, unknown>).content ?? ""),
              name:
                typeof (item as Record<string, unknown>).name === "string"
                  ? String((item as Record<string, unknown>).name)
                  : undefined,
            }))
        : undefined,
      request_preview: Array.isArray(obj.request_preview)
        ? obj.request_preview
            .filter(
              (item) =>
                item && typeof item === "object" && !Array.isArray(item),
            )
            .map((item) => ({ ...(item as Record<string, unknown>) }))
        : undefined,
    };
  }
  return map;
}

function readWorkflowReplayCapsuleMap(
  messageId: number,
): Record<string, WorkflowReplayCapsule> {
  const message = getChatMessages(messageId)[0];
  return normalizeWorkflowReplayCapsuleMap(
    message?.data?.[EW_WORKFLOW_REPLAY_CAPSULE_KEY],
  );
}

function hasWorkflowReplayCapsule(messageId: number): boolean {
  const map = readWorkflowReplayCapsuleMap(messageId);
  return Object.keys(map).length > 0;
}

async function writeWorkflowReplayCapsule(
  messageId: number,
  capsule: WorkflowReplayCapsule,
  versionInfo?: { version_key: string },
): Promise<void> {
  const message = getChatMessages(messageId)[0];
  if (!message) {
    return;
  }
  const effectiveVersion = versionInfo?.version_key
    ? versionInfo
    : getMessageVersionInfo(message);
  const key = String(effectiveVersion.version_key ?? "").trim();
  if (!key) {
    return;
  }

  const map = readWorkflowReplayCapsuleMap(messageId);
  map[key] = capsule;
  const nextData: Record<string, unknown> = {
    ...(message.data ?? {}),
    [EW_WORKFLOW_REPLAY_CAPSULE_KEY]: map,
  };
  await setChatMessages([{ message_id: messageId, data: nextData }], {
    refresh: "none",
  });
}

async function migrateFloorWorkflowCapsuleToAssistant(
  sourceMessageId: number,
  assistantMessageId: number,
): Promise<{ migrated: boolean; reason?: string }> {
  if (sourceMessageId === assistantMessageId) {
    return { migrated: false, reason: "same_message" };
  }

  const sourceMsg = getChatMessages(sourceMessageId)[0];
  const assistantMsg = getChatMessages(assistantMessageId)[0];
  if (!sourceMsg || !assistantMsg) {
    return { migrated: false, reason: "message_not_found" };
  }

  const sourceMap = readWorkflowReplayCapsuleMap(sourceMessageId);
  const sourceVersionInfo = getMessageVersionInfo(sourceMsg);
  const sourceCapsule = sourceMap[sourceVersionInfo.version_key];
  if (!sourceCapsule) {
    return { migrated: false, reason: "source_capsule_missing" };
  }

  const assistantMap = readWorkflowReplayCapsuleMap(assistantMessageId);
  const assistantVersionInfo = getMessageVersionInfo(assistantMsg);
  assistantMap[assistantVersionInfo.version_key] = {
    ...sourceCapsule,
    target_message_id: assistantMessageId,
    target_version_key: assistantVersionInfo.version_key,
    target_role: "assistant",
  };
  delete sourceMap[sourceVersionInfo.version_key];

  const sourceNextData: Record<string, unknown> = {
    ...(sourceMsg.data ?? {}),
  };
  if (Object.keys(sourceMap).length > 0) {
    sourceNextData[EW_WORKFLOW_REPLAY_CAPSULE_KEY] = sourceMap;
  } else {
    delete sourceNextData[EW_WORKFLOW_REPLAY_CAPSULE_KEY];
  }

  const assistantNextData: Record<string, unknown> = {
    ...(assistantMsg.data ?? {}),
    [EW_WORKFLOW_REPLAY_CAPSULE_KEY]: assistantMap,
  };

  await setChatMessages(
    [
      { message_id: sourceMessageId, data: sourceNextData },
      { message_id: assistantMessageId, data: assistantNextData },
    ],
    { refresh: "none" },
  );

  return { migrated: true };
}

function buildFloorWorkflowExecutionState(
  requestId: string,
  attempts: Array<{
    flow: { id: string };
    ok: boolean;
    response?: Record<string, any>;
  }>,
  workflowFailed: boolean,
  preservedResults: FloorWorkflowStoredResult[] = [],
  versionInfo?: { swipe_id?: number; content_hash?: string },
  meta?: { execution_status?: "executed" | "skipped"; skip_reason?: string },
): FloorWorkflowExecutionState {
  const successfulResults = new Map<string, FloorWorkflowStoredResult>(
    preservedResults.map((result) => [result.flow_id, result]),
  );
  const failedFlowIds = new Set<string>();
  const attemptedFlowIds = new Set<string>();

  for (const attempt of attempts) {
    const flowId = String(attempt.flow.id ?? "").trim();
    if (!flowId) {
      continue;
    }
    attemptedFlowIds.add(flowId);

    if (attempt.ok && attempt.response) {
      successfulResults.set(flowId, {
        flow_id: flowId,
        response: klona(attempt.response),
      });
      failedFlowIds.delete(flowId);
    } else {
      successfulResults.delete(flowId);
      failedFlowIds.add(flowId);
    }
  }

  return {
    at: Date.now(),
    request_id: requestId,
    swipe_id: versionInfo?.swipe_id,
    content_hash: versionInfo?.content_hash,
    attempted_flow_ids: [...attemptedFlowIds],
    successful_results: [...successfulResults.values()],
    failed_flow_ids: [...failedFlowIds],
    workflow_failed: workflowFailed,
    execution_status: meta?.execution_status ?? "executed",
    skip_reason: meta?.skip_reason?.trim()
      ? meta.skip_reason.trim()
      : undefined,
  };
}

async function buildPreservedDispatchResults(
  settings: EwSettings,
  preservedResults: FloorWorkflowStoredResult[],
): Promise<DispatchFlowResult[]> {
  if (preservedResults.length === 0) {
    return [];
  }

  const effectiveFlows = await getEffectiveFlows(settings);
  const flowOrderById = new Map(
    effectiveFlows.map((flow, index) => [flow.id, index]),
  );
  const flowById = new Map(effectiveFlows.map((flow) => [flow.id, flow]));

  return preservedResults
    .map((result) => {
      const flow = flowById.get(result.flow_id);
      if (!flow) {
        return null;
      }

      return {
        flow,
        flow_order: flowOrderById.get(result.flow_id) ?? 0,
        response: result.response as any,
      } satisfies DispatchFlowResult;
    })
    .filter((result): result is DispatchFlowResult => Boolean(result));
}

function createProcessingReminder(onAbort: () => void) {
  let state: EwWorkflowNoticeInput = {
    title: "Evolution World",
    message: "正在读取上下文并处理本轮工作流，请稍后…",
    level: "info",
    persist: true,
    busy: true,
    collapse_after_ms: WORKFLOW_NOTICE_COLLAPSE_MS,
    island: {},
    action: {
      label: "终止处理",
      kind: "danger",
      onClick: onAbort,
    },
  };

  const handle = showManagedWorkflowNotice(state);

  const update = (next: Partial<EwWorkflowNoticeInput>) => {
    state = {
      ...state,
      ...next,
      island: {
        ...(state.island ?? {}),
        ...(next.island ?? {}),
      },
    };
    handle.update(state);
  };

  return {
    update,
    dismiss: handle.dismiss,
    collapse: handle.collapse,
    expand: handle.expand,
  };
}

type WorkflowExecutionOutcome = {
  shouldAbortGeneration: boolean;
  workflowSucceeded: boolean;
  abortedByUser: boolean;
};

type RederiveWorkflowInput = {
  message_id: number;
  timing: "before_reply" | "after_reply" | "manual";
  target_version_key?: string;
  confirm_legacy?: boolean;
  capsule_mode?: WorkflowCapsuleMode;
};

type RederiveWorkflowResult = {
  ok: boolean;
  reason?: string;
  result?: {
    message_id: number;
    anchor_message_id: number;
    legacy_approx: boolean;
    writeback_applied: number;
    writeback_conflicts: number;
    writeback_conflict_names: string[];
  };
};

type ExecuteWorkflowOptions = {
  messageId: number;
  userInput?: string;
  injectReply: boolean;
  flowIds?: string[];
  timingFilter?: "before_reply" | "after_reply";
  preservedResults?: FloorWorkflowStoredResult[];
  jobType?: WorkflowJobType;
  contextCursor?: ContextCursor;
  writebackPolicy?: WorkflowWritebackPolicy;
  rederiveOptions?: {
    legacy_approx?: boolean;
    capsule_mode?: WorkflowCapsuleMode;
  };
  trigger: {
    timing: "before_reply" | "after_reply" | "manual";
    source: string;
    generation_type: string;
    user_message_id?: number;
    assistant_message_id?: number;
  };
  reminderMessage: string;
  successMessage: string;
};

function setSendTextareaValue(text: string): void {
  const textarea = getChatDocument().getElementById(
    "send_textarea",
  ) as HTMLTextAreaElement | null;
  if (!textarea) {
    return;
  }

  textarea.value = text;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function restoreOriginalGenerateInput(
  options: Record<string, any>,
  userInput: string,
): void {
  if (
    Array.isArray(options.injects) &&
    options.injects[0] &&
    typeof options.injects[0] === "object"
  ) {
    options.injects[0].content = userInput;
    return;
  }

  if (typeof options.prompt === "string") {
    options.prompt = userInput;
    return;
  }

  options.user_input = userInput;
}

function shouldReleaseInterceptedMessage(
  settings: EwSettings,
  outcome: WorkflowExecutionOutcome,
): boolean {
  if (outcome.abortedByUser) {
    return false;
  }

  const policy = settings.intercept_release_policy ?? "success_only";
  if (policy === "never") {
    return false;
  }
  if (policy === "always") {
    return true;
  }

  return outcome.workflowSucceeded;
}

async function rollbackInterceptedUserMessage(
  messageId: number | null | undefined,
  userInput: string,
  generationType: string,
): Promise<void> {
  if (messageId == null || NON_SEND_GENERATION_TYPES.has(generationType)) {
    return;
  }

  if (messageId !== getLastMessageId()) {
    return;
  }

  const message = getChatMessages(messageId)[0];
  const messageText = String(message?.message ?? "").trim();
  if (!message || message.role !== "user") {
    return;
  }

  if (userInput.trim() && messageText !== userInput.trim()) {
    return;
  }

  try {
    const ctx = getSTContext() as any;
    if (typeof ctx.deleteLastMessage === "function") {
      await ctx.deleteLastMessage();
      clearAfterReplyPending();
      return;
    }
  } catch (error) {
    console.warn(
      "[Evolution World] Failed to rollback intercepted user message:",
      error,
    );
  }
}

// ---------------------------------------------------------------------------
// Per-flow timing gate (fast sync check).
// Returns true if there are potentially matching flows for the given timing.
// This only checks global flows as a fast-path; char-flows are filtered by
// the pipeline's timing_filter after getEffectiveFlows().
// ---------------------------------------------------------------------------

function hasFlowsForTiming(
  settings: EwSettings,
  timing: "before_reply" | "after_reply",
): boolean {
  // Fast path: any global flow explicitly or effectively matches
  const globalMatch = settings.flows.some((f) => {
    if (!f.enabled) return false;
    const effective =
      f.timing === "default" ? settings.workflow_timing : f.timing;
    return effective === timing;
  });
  if (globalMatch) return true;
  // Fallback: if the global default equals the requested timing,
  // char-flows with timing:'default' would resolve to it — proceed
  // and let the pipeline's timing_filter do the authoritative check.
  return settings.workflow_timing === timing;
}

// ---------------------------------------------------------------------------
// Shared workflow execution with failure-policy handling.
// Both the TavernHelper hook and GENERATION_AFTER_COMMANDS fallback call this.
// ---------------------------------------------------------------------------

async function executeWorkflowWithPolicy(
  settings: EwSettings,
  options: ExecuteWorkflowOptions,
): Promise<WorkflowExecutionOutcome> {
  // Returns the workflow outcome so the primary interception path can decide
  // whether the original user message should be released after EW processing.
  // Apply incremental hide check before workflow so AI context is up-to-date
  try {
    runIncrementalHideCheck(settings.hide_settings);
  } catch (e) {
    console.warn("[Evolution World] Hide check failed:", e);
  }

  const workflowAbortController = new AbortController();
  let abortedByUser = false;

  const buildAbortableReminder = (
    message: string,
    level: "info" | "warning" = "info",
  ) => ({
    title: "Evolution World",
    message,
    level,
    persist: true,
    busy: true,
    action: {
      label: "终止处理",
      kind: "danger" as const,
      onClick: cancelWorkflow,
    },
  });

  const cancelWorkflow = () => {
    if (abortedByUser) {
      return;
    }
    abortedByUser = true;
    workflowAbortController.abort();
    stopGenerationNow();
    processingReminder.update({
      title: "Evolution World",
      message: "正在终止本轮处理，请稍后…",
      level: "warning",
      persist: true,
      busy: true,
      action: undefined,
    });
  };

  const processingReminder = createProcessingReminder(cancelWorkflow);
  processingReminder.update(buildAbortableReminder(options.reminderMessage));
  let reminderSettled = false;
  let currentPreservedStoredResults = [...(options.preservedResults ?? [])];
  let currentPreservedDispatchResults = await buildPreservedDispatchResults(
    settings,
    currentPreservedStoredResults,
  );
  let currentFlowIds = options.flowIds;

  const trimPreview = (text: string | undefined, maxLength: number) => {
    const normalized = String(text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, maxLength)}...`;
  };

  // D: multi-flow tracking
  type FlowIslandData = {
    flow_id: string;
    entry_name?: string;
    content?: string;
    flow_order: number;
  };
  const activeFlows = new Map<string, FlowIslandData>();
  let carouselIndex = 0;
  let carouselTimer: ReturnType<typeof setInterval> | null = null;
  let totalFlowCount = 0;
  let completedFlowCount = 0;

  const getRotatedIsland = (): {
    entry_name?: string;
    content?: string;
    extra_count: number;
  } => {
    const flows = [...activeFlows.values()].sort(
      (a, b) => a.flow_order - b.flow_order,
    );
    if (flows.length === 0) {
      return { extra_count: 0 };
    }
    const idx = carouselIndex % flows.length;
    const current = flows[idx];
    return {
      entry_name: current.entry_name,
      content: current.content,
      extra_count: Math.max(0, flows.length - 1),
    };
  };

  const startCarousel = () => {
    if (carouselTimer) return;
    carouselTimer = setInterval(() => {
      if (activeFlows.size > 1) {
        carouselIndex++;
        processingReminder.update({
          island: getRotatedIsland(),
        });
      }
    }, 3000);
  };

  const stopCarousel = () => {
    if (carouselTimer) {
      clearInterval(carouselTimer);
      carouselTimer = null;
    }
  };

  const handleWorkflowProgress = (update: WorkflowProgressUpdate) => {
    if (reminderSettled) {
      return;
    }

    switch (update.phase) {
      case "preparing":
        processingReminder.update({
          message: update.message ?? options.reminderMessage,
          level: "info",
          persist: true,
          busy: true,
        });
        break;
      case "dispatching":
        // extract total flow count from message (e.g. "已装载 3 条工作流")
        {
          const match = update.message?.match(/装载\s*(\d+)\s*条/);
          if (match) {
            totalFlowCount = parseInt(match[1], 10);
          }
        }
        processingReminder.update({
          message: update.message ?? options.reminderMessage,
          level: "info",
          persist: true,
          busy: true,
          flow_progress:
            totalFlowCount > 0
              ? { completed: completedFlowCount, total: totalFlowCount }
              : undefined,
        });
        break;
      case "merging":
      case "committing":
        // All flows complete — clear active flows
        completedFlowCount = activeFlows.size;
        activeFlows.clear();
        stopCarousel();
        processingReminder.update({
          message: update.message ?? options.reminderMessage,
          level: "info",
          persist: true,
          busy: true,
          island: { extra_count: 0 },
          flow_progress:
            totalFlowCount > 0
              ? { completed: completedFlowCount, total: totalFlowCount }
              : undefined,
        });
        break;
      case "flow_started": {
        const flowId = update.flow_id ?? "";
        if (flowId) {
          activeFlows.set(flowId, {
            flow_id: flowId,
            entry_name: update.flow_name?.trim() || undefined,
            content: undefined,
            flow_order: update.flow_order ?? 0,
          });
          if (activeFlows.size > 1) {
            startCarousel();
          }
        }
        processingReminder.update({
          message: update.message ?? options.reminderMessage,
          persist: true,
          busy: true,
          level: "info",
          island: getRotatedIsland(),
          workflow_name: update.flow_name?.trim() || undefined,
          flow_progress:
            totalFlowCount > 0
              ? { completed: completedFlowCount, total: totalFlowCount }
              : undefined,
        });
        break;
      }
      case "streaming": {
        const flowId = update.flow_id ?? "";
        const previewName = trimPreview(update.stream_preview?.entry_name, 28);
        const previewContent = trimPreview(update.stream_preview?.content, 54);

        // Update the active flow's data
        if (flowId && activeFlows.has(flowId)) {
          const flow = activeFlows.get(flowId)!;
          flow.entry_name = previewName || flow.entry_name;
          flow.content = previewContent || flow.content;
        }

        processingReminder.update({
          message: update.flow_name?.trim()
            ? `正在流式读取「${update.flow_name}」输出…`
            : "正在流式读取工作流输出…",
          persist: true,
          busy: true,
          level: "info",
          island: getRotatedIsland(),
          workflow_name: update.flow_name?.trim() || undefined,
          flow_progress:
            totalFlowCount > 0
              ? { completed: completedFlowCount, total: totalFlowCount }
              : undefined,
        });
        break;
      }
      case "completed":
      case "failed":
      default:
        break;
    }
  };

  const finalizeUserAbort = () => {
    clearReplyInstruction();
    reminderSettled = true;
    stopCarousel();
    processingReminder.update({
      title: "Evolution World",
      message: "已终止本轮处理。",
      level: "warning",
      persist: false,
      busy: false,
      action: undefined,
      island: {
        entry_name: "",
        content: "",
        extra_count: 0,
      },
      collapse_after_ms: 0,
      duration_ms: 3500,
    });
    return {
      shouldAbortGeneration: true,
      workflowSucceeded: false,
      abortedByUser: true,
    } satisfies WorkflowExecutionOutcome;
  };

  let lastAfterReplyExecutionState: FloorWorkflowExecutionState | null = null;
  const runWorkflowAttempt = async () => {
    const nextResult = await runWorkflow({
      message_id: options.messageId,
      user_input: options.userInput,
      trigger: options.trigger,
      mode: options.jobType === "live_auto" ? "auto" : "manual",
      inject_reply: options.injectReply,
      flow_ids: currentFlowIds,
      timing_filter: options.timingFilter,
      preserved_results: currentPreservedDispatchResults,
      job_type: options.jobType ?? "live_auto",
      context_cursor: options.contextCursor,
      writeback_policy: options.writebackPolicy ?? "dual_diff_merge",
      rederive_options: options.rederiveOptions,
      abortSignal: workflowAbortController.signal,
      isCancelled: () => abortedByUser,
      onProgress: handleWorkflowProgress,
    });

    currentPreservedDispatchResults = mergePreservedDispatchResults(
      currentPreservedDispatchResults,
      collectSuccessfulDispatchResultsFromAttempts(nextResult.attempts),
    );

    if (options.trigger.timing === "after_reply") {
      const assistantMessageId =
        options.trigger.assistant_message_id ?? options.messageId;
      const assistantMsg = getChatMessages(assistantMessageId)[0];
      const versionInfo = assistantMsg
        ? getMessageVersionInfo(assistantMsg)
        : undefined;
      const executionState = buildFloorWorkflowExecutionState(
        nextResult.request_id,
        nextResult.attempts,
        !nextResult.ok,
        currentPreservedStoredResults,
        versionInfo,
        {
          execution_status: nextResult.skipped ? "skipped" : "executed",
          skip_reason: nextResult.skipped ? nextResult.reason : undefined,
        },
      );
      await writeFloorWorkflowExecution(assistantMessageId, executionState);
      lastAfterReplyExecutionState = executionState;
      if (!nextResult.skipped) {
        currentPreservedStoredResults = executionState.successful_results;
        currentPreservedDispatchResults = await buildPreservedDispatchResults(
          settings,
          currentPreservedStoredResults,
        );
      }
    }

    return nextResult;
  };

  let result;
  try {
    result = await runWorkflowAttempt();
  } catch (error) {
    if (abortedByUser) {
      return finalizeUserAbort();
    }
    processingReminder.dismiss();
    throw error;
  }

  if (abortedByUser) {
    return finalizeUserAbort();
  }

  if (result.skipped) {
    reminderSettled = true;
    stopCarousel();
    processingReminder.dismiss();
    return {
      shouldAbortGeneration: false,
      workflowSucceeded: true,
      abortedByUser: false,
    };
  }

  if (!result.ok) {
    const policy = settings.failure_policy ?? "stop_generation";
    const autoRerollMaxAttempts = Math.max(
      1,
      Math.trunc(Number(settings.auto_reroll_max_attempts ?? 1) || 1),
    );
    const autoRerollIntervalMs = Math.max(
      0,
      Math.round((settings.auto_reroll_interval_seconds ?? 0) * 1000),
    );
    let autoRerollCount = 0;
    let autoRerollSkippedReason = "";

    if (policy === "retry_once") {
      while (!result.ok && autoRerollCount < autoRerollMaxAttempts) {
        const rerollTarget = resolveAutoRerollTarget(result);
        if (!rerollTarget.ok) {
          autoRerollSkippedReason = rerollTarget.reason;
          console.warn(`[EW] auto reroll skipped: ${rerollTarget.reason}`);
          break;
        }

        currentFlowIds = rerollTarget.flowIds;

        const nextAttemptNumber = autoRerollCount + 1;
        const retryMessageBase = buildFailureNoticeMessage(
          result.failure,
          result.reason,
          { retrying: true },
        );
        const intervalHint =
          autoRerollIntervalMs > 0
            ? `\n将在 ${settings.auto_reroll_interval_seconds} 秒后开始第 ${nextAttemptNumber} 次自动重roll。`
            : `\n即将开始第 ${nextAttemptNumber} 次自动重roll。`;
        console.warn(
          `[EW] auto reroll: attempt ${nextAttemptNumber}/${autoRerollMaxAttempts} after failure.`,
          result.reason,
        );
        processingReminder.update(
          buildAbortableReminder(
            `${retryMessageBase}${intervalHint}`,
            "warning",
          ),
        );
        toastr.warning(
          `工作流失败，准备进行第 ${nextAttemptNumber}/${autoRerollMaxAttempts} 次自动重roll: ${buildFailureToastMessage(result.failure, result.reason)}`,
          "Evolution World",
        );

        try {
          if (autoRerollIntervalMs > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, autoRerollIntervalMs),
            );
          }
          result = await runWorkflowAttempt();
          autoRerollCount = nextAttemptNumber;
        } catch (error) {
          if (abortedByUser) {
            return finalizeUserAbort();
          }
          processingReminder.dismiss();
          throw error;
        }

        if (abortedByUser) {
          return finalizeUserAbort();
        }
      }
    }

    if (!result.ok) {
      const exhaustedAutoRerollSuffix = (() => {
        if (policy !== "retry_once") {
          return "";
        }
        if (autoRerollSkippedReason) {
          return `\n${autoRerollSkippedReason}`;
        }
        if (autoRerollCount > 0) {
          return `\n已自动重roll ${autoRerollCount} 次，仍未成功。`;
        }
        return "";
      })();
      const displayReason = `${buildFailureNoticeMessage(result.failure, result.reason)}${exhaustedAutoRerollSuffix}`;
      const toastReason = `${buildFailureToastMessage(result.failure, result.reason)}${
        policy === "retry_once" && autoRerollCount > 0
          ? `（已自动重roll ${autoRerollCount} 次）`
          : ""
      }`;
      switch (policy) {
        case "continue_generation":
          reminderSettled = true;
          stopCarousel();
          processingReminder.update({
            title: "Evolution World",
            message: buildFailureNoticeMessage(result.failure, result.reason, {
              includeReleaseHint: true,
            }),
            level: "warning",
            persist: false,
            busy: false,
            action: undefined,
            collapse_after_ms: 0,
            duration_ms: 5500,
          });
          toastr.warning(
            `工作流失败，原消息是否继续发送取决于放行策略: ${toastReason}`,
            "Evolution World",
          );
          break;
        case "allow_partial_success":
        case "notify_only":
          reminderSettled = true;
          stopCarousel();
          processingReminder.update({
            title: "Evolution World",
            message: displayReason,
            level: "warning",
            persist: false,
            busy: false,
            action: undefined,
            collapse_after_ms: 0,
            duration_ms: 5500,
          });
          toastr.info(`工作流失败: ${toastReason}`, "Evolution World");
          break;
        case "stop_generation":
        case "retry_once":
        default:
          clearReplyInstruction();
          reminderSettled = true;
          stopCarousel();
          processingReminder.update({
            title: "Evolution World",
            message: displayReason,
            level: "error",
            persist: false,
            busy: false,
            action: undefined,
            collapse_after_ms: 0,
            duration_ms: 5500,
          });
          stopGenerationNow();
          toastr.error(
            `动态世界流程失败，本轮已中止: ${toastReason}`,
            "Evolution World",
          );
          return {
            shouldAbortGeneration: true,
            workflowSucceeded: false,
            abortedByUser: false,
          };
      }

      return {
        shouldAbortGeneration: false,
        workflowSucceeded: false,
        abortedByUser: false,
      };
    }
  }

  {
    const capsuleMessageId =
      options.trigger.timing === "after_reply"
        ? Number(options.trigger.assistant_message_id ?? options.messageId)
        : Number(options.messageId);
    const capsuleMessage = getChatMessages(capsuleMessageId)[0];
    if (capsuleMessage) {
      const versionInfo = getMessageVersionInfo(capsuleMessage);
      const flowIds = _.uniq(
        result.attempts
          .map((attempt) => String(attempt.flow.id ?? "").trim())
          .filter(Boolean),
      );
      const capsuleMode: WorkflowCapsuleMode =
        options.rederiveOptions?.capsule_mode === "light" ? "light" : "full";
      const replayCapsule: WorkflowReplayCapsule = {
        at: Date.now(),
        request_id: result.request_id,
        job_type: options.jobType ?? "live_auto",
        timing: options.trigger.timing,
        source: options.trigger.source,
        generation_type: options.trigger.generation_type,
        target_message_id: capsuleMessageId,
        target_version_key: versionInfo.version_key,
        target_role:
          capsuleMessage.role === "assistant"
            ? "assistant"
            : capsuleMessage.role === "user"
              ? "user"
              : "other",
        flow_ids: flowIds,
        flow_ids_hash: simpleHash(flowIds.join("|")),
        capsule_mode: capsuleMode,
        legacy_approx: Boolean(options.rederiveOptions?.legacy_approx),
      };
      if (capsuleMode === "full") {
        replayCapsule.assembled_messages = result.attempts.flatMap(
          (attempt) => {
            const assembled = attempt.request_debug?.assembled_messages;
            if (!Array.isArray(assembled)) {
              return [];
            }
            return assembled
              .filter(
                (item) =>
                  item && typeof item === "object" && !Array.isArray(item),
              )
              .map((item) => ({
                role: String((item as Record<string, unknown>).role ?? ""),
                content: String(
                  (item as Record<string, unknown>).content ?? "",
                ),
                name:
                  typeof (item as Record<string, unknown>).name === "string"
                    ? String((item as Record<string, unknown>).name)
                    : undefined,
              }));
          },
        );
        replayCapsule.request_preview = result.attempts
          .map((attempt) => ({
            flow_id: attempt.flow.id,
            request_id: attempt.request?.request_id ?? "",
            flow_name: attempt.flow.name,
            flow_order: attempt.flow_order,
          }))
          .slice(0, 20);
      }
      await writeWorkflowReplayCapsule(
        capsuleMessageId,
        replayCapsule,
        versionInfo,
      );
    }
  }

  if (options.trigger.timing === "before_reply") {
    const sourceMessageId = Number(
      options.trigger.user_message_id ?? options.messageId,
    );
    const userMessageId = Number(
      options.trigger.user_message_id ?? options.messageId,
    );
    if (
      Number.isFinite(sourceMessageId) &&
      sourceMessageId >= 0 &&
      Number.isFinite(userMessageId) &&
      userMessageId >= 0
    ) {
      setBeforeReplyBindingPending({
        request_id: result.request_id,
        user_message_id: userMessageId,
        source_message_id: sourceMessageId,
        generation_type: options.trigger.generation_type,
        window_ms: Math.max(
          settings.total_timeout_ms + 10000,
          settings.gate_ttl_ms,
          600000,
        ),
      });
    } else {
      clearBeforeReplyBindingPending();
    }
  }

  if (options.trigger.timing === "after_reply") {
    const assistantMessageId =
      options.trigger.assistant_message_id ?? options.messageId;
    try {
      await pinFloorWorkflowExecutionToCurrentVersion(
        assistantMessageId,
        lastAfterReplyExecutionState,
      );
    } catch (error) {
      console.warn(
        "[Evolution World] Failed to pin after_reply execution to current visible version:",
        error,
      );
    }
  }

  reminderSettled = true;
  stopCarousel();
  processingReminder.update({
    title: "Evolution World",
    message: options.successMessage,
    level: "success",
    persist: false,
    busy: false,
    action: undefined,
    collapse_after_ms: 0,
    duration_ms: 4000,
  });
  return {
    shouldAbortGeneration: false,
    workflowSucceeded: true,
    abortedByUser: false,
  };
}

type GenerationInterceptorAbort = (immediately: boolean) => void;

function hasPrimaryGenerateInterceptor(): boolean {
  return (
    typeof (globalThis as Record<string, unknown>)[
      EW_GENERATE_INTERCEPTOR_KEY
    ] === "function"
  );
}

async function runPrimaryBeforeReplyIntercept(
  _chat: any[],
  _contextSize: number,
  abort: GenerationInterceptorAbort,
  generationType: string,
): Promise<void> {
  const settings = getSettings();
  if (
    !settings.enabled ||
    getRuntimeState().is_processing ||
    !hasFlowsForTiming(settings, "before_reply")
  ) {
    return;
  }

  const allowedTypes = new Set(["normal", "continue", "regenerate", "swipe"]);
  if (
    !allowedTypes.has(generationType) ||
    isQuietLike(generationType, undefined)
  ) {
    return;
  }

  const textareaValue = getSendTextareaValue();
  if (!textareaValue.trim()) {
    const decision = shouldHandleGenerationAfter(
      generationType,
      undefined,
      false,
      settings,
    );
    if (!decision.ok) {
      return;
    }
  }

  const userInput = resolvePrimaryWorkflowUserInput(generationType);
  const isNonSendType = NON_SEND_GENERATION_TYPES.has(generationType);
  if (!userInput.trim() && !isNonSendType) {
    return;
  }

  const messageId =
    getRuntimeState().last_send?.message_id ?? getLastMessageId();
  const pendingUserMessageId = getRuntimeState().last_send?.message_id ?? null;

  let workflowOutcome: WorkflowExecutionOutcome = {
    shouldAbortGeneration: false,
    workflowSucceeded: false,
    abortedByUser: false,
  };

  setProcessing(true);
  try {
    workflowOutcome = await executeWorkflowWithPolicy(settings, {
      messageId,
      userInput,
      injectReply: true,
      timingFilter: "before_reply",
      trigger: {
        timing: "before_reply",
        source: "generate_interceptor",
        generation_type: generationType,
        user_message_id: getRuntimeState().last_send?.message_id,
      },
      reminderMessage: "正在读取上下文并处理本轮工作流，请稍后…",
      successMessage: "动态世界流程处理完成，已更新本轮上下文。",
    });
  } catch (error) {
    console.error("[Evolution World] Error in generate interceptor:", error);
    clearReplyInstruction();
  } finally {
    setProcessing(false);
    clearSendContextIfMatches(pendingUserMessageId, userInput);
  }

  if (workflowOutcome.shouldAbortGeneration) {
    await rollbackInterceptedUserMessage(
      pendingUserMessageId,
      userInput,
      generationType,
    );
    setSendTextareaValue(userInput);
    clearReplyInstruction();
    abort(true);
    return;
  }

  if (!shouldReleaseInterceptedMessage(settings, workflowOutcome)) {
    await rollbackInterceptedUserMessage(
      pendingUserMessageId,
      userInput,
      generationType,
    );
    setSendTextareaValue(userInput);
    clearReplyInstruction();
    console.debug(
      "[Evolution World] Original intercepted message was not released due to intercept_release_policy",
    );
    abort(true);
    return;
  }

  setSendTextareaValue(userInput);
  recordUserSendIntent(userInput);
}

function installPrimaryGenerateInterceptor(): void {
  (globalThis as Record<string, unknown>)[EW_GENERATE_INTERCEPTOR_KEY] =
    runPrimaryBeforeReplyIntercept;
}

function uninstallPrimaryGenerateInterceptor(): void {
  delete (globalThis as Record<string, unknown>)[EW_GENERATE_INTERCEPTOR_KEY];
}

// ---------------------------------------------------------------------------
// Fallback path: GENERATION_AFTER_COMMANDS event
// ---------------------------------------------------------------------------

async function onGenerationAfterCommands(
  type: string,
  params: {
    automatic_trigger?: boolean;
    quiet_prompt?: string;
    _ew_processed?: boolean;
    [key: string]: any;
  },
  dryRun: boolean,
) {
  if (hasPrimaryGenerateInterceptor()) {
    return;
  }

  // Dedup check 1: already handled by TavernHelper hook
  if (params?._ew_processed) {
    console.debug(
      "[Evolution World] GENERATION_AFTER_COMMANDS skipped: already processed by TavernHelper hook",
    );
    return;
  }

  const settings = getSettings();
  if (!hasFlowsForTiming(settings, "before_reply")) {
    return;
  }
  const decision = shouldHandleGenerationAfter(type, params, dryRun, settings);
  if (!decision.ok) {
    return;
  }

  const messageId =
    getRuntimeState().last_send?.message_id ?? getLastMessageId();
  const genType = getRuntimeState().last_generation?.type ?? "";
  const userInput = resolveFallbackWorkflowUserInput(genType);
  const isNonSendType = NON_SEND_GENERATION_TYPES.has(genType);

  // Only block on empty input for normal send — continue/regen/swipe can proceed without it
  if (!userInput.trim() && !isNonSendType) {
    console.debug("[Evolution World] skipped workflow: user input is empty");
    return;
  }

  // Dedup check 2: hash-based guard against recent TavernHelper interception
  if (wasRecentlyIntercepted(userInput)) {
    console.debug(
      "[Evolution World] GENERATION_AFTER_COMMANDS skipped: recently intercepted by TavernHelper hook (hash match)",
    );
    return;
  }

  console.debug(
    "[Evolution World] GENERATION_AFTER_COMMANDS executing workflow (fallback path)",
  );
  setProcessing(true);
  try {
    // Return value (shouldAbort) is only relevant for the primary path;
    // in the fallback path, stopGenerationNow() inside executeWorkflowWithPolicy
    // handles abort directly since generation is already in progress.
    await executeWorkflowWithPolicy(settings, {
      messageId,
      userInput,
      injectReply: true,
      timingFilter: "before_reply",
      trigger: {
        timing: "before_reply",
        source: "generation_after_commands",
        generation_type: genType || type,
        user_message_id: getRuntimeState().last_send?.message_id,
      },
      reminderMessage: "正在读取上下文并处理本轮工作流，请稍后…",
      successMessage: "动态世界流程处理完成，已更新本轮上下文。",
    });
  } finally {
    clearSendContextIfMatches(messageId, userInput);
    setProcessing(false);
  }
}

function getMessageText(messageId: number): string {
  try {
    const message = getChatMessages(messageId)[0];
    return String(message?.message ?? "");
  } catch {
    return "";
  }
}

function isAssistantMessage(messageId: number): boolean {
  try {
    const message = getChatMessages(messageId)[0];
    return message?.role === "assistant";
  } catch {
    return false;
  }
}

async function onAfterReplyMessage(
  messageId: number,
  type: string,
  source: "message_received" | "generation_ended",
) {
  const settings = getSettings();
  pruneExpiredBeforeReplyBindingPending();
  const decision = shouldHandleAfterReply(messageId, type, settings);
  if (!decision.ok) {
    return;
  }

  if (!isAssistantMessage(messageId)) {
    return;
  }

  const messageText = getMessageText(messageId);
  if (!messageText.trim() || wasAfterReplyHandled(messageId, messageText)) {
    return;
  }

  const runtimeState = getRuntimeState();
  const generationType =
    runtimeState.after_reply.pending_generation_type ||
    runtimeState.last_generation?.type ||
    type;
  const userInput = resolveAfterReplyUserInput();
  const pendingUserMessageId =
    runtimeState.after_reply.pending_user_message_id ??
    runtimeState.last_send?.message_id ??
    null;
  const pendingBeforeReplyBinding = pruneExpiredBeforeReplyBindingPending();

  setProcessing(true);
  try {
    await executeWorkflowWithPolicy(settings, {
      messageId,
      userInput,
      injectReply: false,
      timingFilter: "after_reply",
      jobType: "live_auto",
      trigger: {
        timing: "after_reply",
        source,
        generation_type: generationType,
        user_message_id: pendingUserMessageId ?? undefined,
        assistant_message_id: messageId,
      },
      reminderMessage: "正在根据最新回复更新动态世界，请稍后…",
      successMessage: "动态世界已根据最新回复完成更新。",
    });
    if (
      pendingBeforeReplyBinding &&
      !pendingBeforeReplyBinding.migrated &&
      Number.isFinite(pendingUserMessageId) &&
      pendingBeforeReplyBinding.user_message_id === pendingUserMessageId
    ) {
      const sourceMsg = getChatMessages(
        pendingBeforeReplyBinding.source_message_id,
      )[0];
      const assistantMsg = getChatMessages(messageId)[0];
      if (sourceMsg && assistantMsg) {
        const artifactMigration = await migrateBeforeReplyArtifactsToAssistant(
          settings,
          pendingBeforeReplyBinding.source_message_id,
          messageId,
          pendingBeforeReplyBinding.request_id,
        );
        if (artifactMigration.migrated) {
          await migrateFloorWorkflowCapsuleToAssistant(
            pendingBeforeReplyBinding.source_message_id,
            messageId,
          );
          markBeforeReplyBindingMigrated(messageId);
        }
      }
    }
    markAfterReplyHandled(messageId, messageText);
  } finally {
    clearAfterReplyPendingIfMatches(pendingUserMessageId);
    clearSendContextIfMatches(pendingUserMessageId, userInput);
    setProcessing(false);
  }
}

function getCurrentChatKey(): string {
  return String(getSTContext()?.chatId ?? "").trim();
}

function appendTriggerMessageIds(
  trigger: {
    timing: "before_reply" | "after_reply" | "manual";
    source: string;
    generation_type: string;
    user_message_id?: number;
    assistant_message_id?: number;
  },
  ids: { userMessageId?: number | null; assistantMessageId?: number | null },
) {
  const userMessageId = ids.userMessageId;
  if (typeof userMessageId === "number" && Number.isFinite(userMessageId)) {
    trigger.user_message_id = userMessageId;
  }

  const assistantMessageId = ids.assistantMessageId;
  if (
    typeof assistantMessageId === "number" &&
    Number.isFinite(assistantMessageId)
  ) {
    trigger.assistant_message_id = assistantMessageId;
  }

  return trigger;
}

function resolveBeforeReplyPair(messageId: number): {
  source_message_id: number;
  assistant_message_id?: number;
} {
  const message = getChatMessages(messageId)[0];
  if (!message) {
    return { source_message_id: messageId };
  }

  const bindingMeta = message.data?.[EW_BEFORE_REPLY_BINDING_KEY] as
    | { role?: unknown; paired_message_id?: unknown }
    | undefined;
  const role =
    typeof bindingMeta?.role === "string" ? String(bindingMeta.role) : "";
  const paired = Number(bindingMeta?.paired_message_id);
  const pairedMessageId = Number.isFinite(paired) ? paired : undefined;

  if (message.role === "assistant") {
    if (role === "assistant_anchor" && Number.isFinite(pairedMessageId)) {
      return {
        source_message_id: Number(pairedMessageId),
        assistant_message_id: messageId,
      };
    }
    return { source_message_id: messageId, assistant_message_id: messageId };
  }

  if (message.role === "user") {
    if (role === "source" && Number.isFinite(pairedMessageId)) {
      return {
        source_message_id: messageId,
        assistant_message_id: Number(pairedMessageId),
      };
    }
    const nextMessage = getChatMessages(messageId + 1)[0];
    if (nextMessage?.role === "assistant") {
      return {
        source_message_id: messageId,
        assistant_message_id: Number(nextMessage.message_id),
      };
    }
  }

  return { source_message_id: messageId };
}

function resolveAssistantSourceUserMessageId(messageId: number): number | null {
  const pair = resolveBeforeReplyPair(messageId);
  if (
    Number.isFinite(pair.assistant_message_id) &&
    Number(pair.assistant_message_id) === messageId
  ) {
    return Number.isFinite(pair.source_message_id)
      ? Number(pair.source_message_id)
      : null;
  }

  const previousMessage = getChatMessages(messageId - 1)[0];
  if (previousMessage?.role === "user") {
    return Number(previousMessage.message_id);
  }

  return null;
}

async function writeRederiveMeta(
  messageId: number,
  meta: {
    source_job: WorkflowJobType;
    legacy_approx: boolean;
    timing: "before_reply" | "after_reply" | "manual";
    conflicts: number;
    conflict_names: string[];
    writeback_applied: number;
    writeback_ok: boolean;
  },
): Promise<void> {
  const message = getChatMessages(messageId)[0];
  if (!message) {
    return;
  }

  const nextData: Record<string, unknown> = {
    ...(message.data ?? {}),
    [EW_REDERIVE_META_KEY]: {
      ...meta,
      updated_at: Date.now(),
    },
  };
  await setChatMessages([{ message_id: messageId, data: nextData }], {
    refresh: "none",
  });
}

export async function rederiveWorkflowAtFloor(
  input: RederiveWorkflowInput,
): Promise<RederiveWorkflowResult> {
  const settings = getSettings();
  if (!settings.enabled) {
    return { ok: false, reason: "workflow disabled" };
  }

  const sourceMessageId = Number(input.message_id);
  if (!Number.isFinite(sourceMessageId) || sourceMessageId < 0) {
    return { ok: false, reason: "invalid target floor" };
  }
  const sourceMessage = getChatMessages(sourceMessageId)[0];
  if (!sourceMessage) {
    return { ok: false, reason: "target floor not found" };
  }

  const timing = input.timing;
  const pair =
    timing === "before_reply"
      ? resolveBeforeReplyPair(sourceMessageId)
      : { source_message_id: sourceMessageId };
  const assistantMessageId = pair.assistant_message_id;
  const beforeReplySourceMessageId = pair.source_message_id;
  const anchorMessageId =
    timing === "before_reply" && Number.isFinite(assistantMessageId)
      ? Number(assistantMessageId)
      : sourceMessageId;

  const anchorMessage = getChatMessages(anchorMessageId)[0];
  if (!anchorMessage) {
    return { ok: false, reason: "anchor floor not found" };
  }

  const hasCapsule =
    hasWorkflowReplayCapsule(anchorMessageId) ||
    (Number.isFinite(beforeReplySourceMessageId) &&
      hasWorkflowReplayCapsule(beforeReplySourceMessageId));
  if (!hasCapsule && !input.confirm_legacy) {
    return { ok: false, reason: "legacy_confirmation_required" };
  }
  const legacyApprox = !hasCapsule;
  const targetVersionInfo = getMessageVersionInfo(anchorMessage);
  const contextCursor: ContextCursor = {
    chat_id: getCurrentChatKey(),
    target_message_id:
      timing === "before_reply" ? beforeReplySourceMessageId : anchorMessageId,
    target_role:
      timing === "before_reply"
        ? "user"
        : anchorMessage.role === "assistant"
          ? "assistant"
          : anchorMessage.role === "user"
            ? "user"
            : "other",
    target_version_key: String(
      input.target_version_key ?? targetVersionInfo.version_key,
    ),
    timing,
    source_user_message_id:
      timing === "before_reply" ? beforeReplySourceMessageId : undefined,
    assistant_message_id:
      timing === "before_reply" ? assistantMessageId : anchorMessageId,
    capsule_mode: input.capsule_mode === "light" ? "light" : "full",
  };

  const oldSnapshotRead = await readFloorSnapshotByMessageId(
    anchorMessageId,
    "history",
  );
  const oldSnapshot = oldSnapshotRead?.snapshot ?? null;

  const sourceUserText = String(
    getChatMessages(beforeReplySourceMessageId)[0]?.message ?? "",
  );
  const afterReplySourceUserMessageId =
    timing === "after_reply"
      ? resolveAssistantSourceUserMessageId(anchorMessageId)
      : null;
  const afterReplySourceUserText = String(
    Number.isFinite(afterReplySourceUserMessageId)
      ? (getChatMessages(Number(afterReplySourceUserMessageId))[0]?.message ??
          "")
      : "",
  );
  const userInput =
    timing === "before_reply"
      ? sourceUserText
      : timing === "after_reply"
        ? afterReplySourceUserText || getMessageText(anchorMessageId)
        : sourceUserText || getMessageText(sourceMessageId);

  try {
    setProcessing(true);
    const executionOutcome = await executeWorkflowWithPolicy(settings, {
      messageId:
        timing === "before_reply"
          ? beforeReplySourceMessageId
          : anchorMessageId,
      userInput,
      injectReply: false,
      timingFilter: timing === "manual" ? undefined : timing,
      jobType: "historical_rederive",
      contextCursor,
      writebackPolicy: "dual_diff_merge",
      rederiveOptions: {
        legacy_approx: legacyApprox,
        capsule_mode: contextCursor.capsule_mode,
      },
      trigger: appendTriggerMessageIds(
        {
          timing,
          source: "history_rederive",
          generation_type: getRuntimeState().last_generation?.type || "manual",
        },
        {
          userMessageId:
            timing === "before_reply"
              ? beforeReplySourceMessageId
              : timing === "after_reply"
                ? afterReplySourceUserMessageId
                : undefined,
          assistantMessageId:
            timing === "before_reply"
              ? assistantMessageId
              : anchorMessage.role === "assistant"
                ? anchorMessageId
                : undefined,
        },
      ),
      reminderMessage: "正在重推导历史楼层工作流并重建快照，请稍后…",
      successMessage: "历史楼层重推导与快照重建已完成。",
    });

    if (!executionOutcome.workflowSucceeded) {
      return {
        ok: false,
        reason: executionOutcome.abortedByUser
          ? "workflow cancelled by user"
          : "workflow failed",
      };
    }

    if (
      timing === "before_reply" &&
      Number.isFinite(assistantMessageId) &&
      Number.isFinite(beforeReplySourceMessageId) &&
      beforeReplySourceMessageId !== assistantMessageId
    ) {
      const rederiveRequestId = `rederive:${Date.now().toString(36)}`;
      const artifactMigration = await migrateBeforeReplyArtifactsToAssistant(
        settings,
        beforeReplySourceMessageId,
        Number(assistantMessageId),
        rederiveRequestId,
      );
      if (artifactMigration.migrated) {
        await migrateFloorWorkflowCapsuleToAssistant(
          beforeReplySourceMessageId,
          Number(assistantMessageId),
        );
      }
    }

    const newSnapshotRead = await readFloorSnapshotByMessageId(
      anchorMessageId,
      "history",
    );
    const newSnapshot = newSnapshotRead?.snapshot ?? null;
    const writebackResult = await applySnapshotDiffToCurrentWorldbook(
      settings,
      oldSnapshot,
      newSnapshot,
    );
    await writeRederiveMeta(anchorMessageId, {
      source_job: "historical_rederive",
      legacy_approx: legacyApprox,
      timing,
      conflicts: writebackResult.conflicts,
      conflict_names: writebackResult.conflict_names,
      writeback_applied: writebackResult.applied,
      writeback_ok: true,
    });

    return {
      ok: true,
      result: {
        message_id: sourceMessageId,
        anchor_message_id: anchorMessageId,
        legacy_approx: legacyApprox,
        writeback_applied: writebackResult.applied,
        writeback_conflicts: writebackResult.conflicts,
        writeback_conflict_names: writebackResult.conflict_names,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    setProcessing(false);
  }
}

export async function rerollCurrentAfterReplyWorkflow(): Promise<{
  ok: boolean;
  reason?: string;
}> {
  const settings = getSettings();
  if (!hasFlowsForTiming(settings, "after_reply")) {
    return { ok: false, reason: "no flows configured for after_reply timing" };
  }
  if (!settings.enabled) {
    return { ok: false, reason: "workflow disabled" };
  }
  if (getRuntimeState().is_processing) {
    return { ok: false, reason: "workflow already processing" };
  }

  const messageId = getLastMessageId();
  if (!Number.isFinite(messageId) || messageId < 0) {
    return { ok: false, reason: "no current floor found" };
  }
  if (!isAssistantMessage(messageId)) {
    return { ok: false, reason: "current floor is not an assistant reply" };
  }

  const messageText = getMessageText(messageId);
  if (!messageText.trim()) {
    return { ok: false, reason: "current assistant reply is empty" };
  }

  const runtimeState = getRuntimeState();
  const generationType = runtimeState.last_generation?.type || "manual";
  const userInput = resolveAfterReplyUserInput();
  const rerollScope = settings.reroll_scope ?? "all";

  let flowIds: string[] | undefined;
  let preservedResults: FloorWorkflowStoredResult[] = [];

  if (rerollScope === "failed_only") {
    const executionState = readFloorWorkflowExecution(messageId);
    if (executionState?.failed_flow_ids.length) {
      const effectiveFlows = await getEffectiveFlows(settings);
      const flowMap = new Map(effectiveFlows.map((flow) => [flow.id, flow]));

      flowIds = executionState.failed_flow_ids.filter((flowId) =>
        flowMap.has(flowId),
      );
      preservedResults = executionState.successful_results.filter((result) => {
        return (
          flowMap.has(result.flow_id) && !flowIds?.includes(result.flow_id)
        );
      });

      if (flowIds.length === 0) {
        return { ok: false, reason: "当前楼记录中的失败工作流已被禁用或删除" };
      }
    } else if (executionState && executionState.failed_flow_ids.length === 0) {
      return { ok: false, reason: "当前楼没有失败的工作流可供重跑" };
    }
  }

  setProcessing(true);
  try {
    if (settings.floor_binding_enabled) {
      await rollbackBeforeFloor(settings, messageId);
    }

    const outcome = await executeWorkflowWithPolicy(settings, {
      messageId,
      userInput,
      injectReply: false,
      flowIds,
      timingFilter: "after_reply",
      preservedResults,
      jobType: "live_reroll",
      trigger: {
        timing: "after_reply",
        source: "fab_double_click",
        generation_type: generationType,
        user_message_id:
          runtimeState.after_reply.pending_user_message_id ??
          runtimeState.last_send?.message_id,
        assistant_message_id: messageId,
      },
      reminderMessage:
        rerollScope === "failed_only" && flowIds?.length
          ? `正在重跑当前楼失败的 ${flowIds.length} 条工作流，请稍后…`
          : "正在重跑当前楼的回复后工作流，请稍后…",
      successMessage:
        rerollScope === "failed_only" && flowIds?.length
          ? "当前楼失败的工作流已重跑完成。"
          : "当前楼的动态世界工作流已重跑完成。",
    });

    if (outcome.workflowSucceeded) {
      markAfterReplyHandled(messageId, messageText);
      return { ok: true };
    }

    if (outcome.abortedByUser) {
      return { ok: false, reason: "workflow cancelled by user" };
    }

    return { ok: false, reason: "workflow failed" };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    setProcessing(false);
  }
}

export function initRuntimeEvents() {
  const eventTypes = getEventTypes();

  installPrimaryGenerateInterceptor();
  installSendIntentHooks();

  listenerStops.push(
    onSTEvent(eventTypes.MESSAGE_SENT, (messageId: number) => {
      const msg = getChatMessages(messageId)[0];
      if (!msg || msg.role !== "user") {
        return;
      }
      recordUserSend(messageId, msg.message ?? "");
    }),
  );

  listenerStops.push(
    onSTEvent(
      eventTypes.GENERATION_STARTED,
      (type: string, params: Record<string, any>, dryRun: boolean) => {
        recordGeneration(type, params ?? {}, dryRun);
      },
    ),
  );

  listenerStops.push(
    onSTEvent(
      eventTypes.MESSAGE_RECEIVED,
      async (messageId: number, type: string) => {
        await onAfterReplyMessage(messageId, type, "message_received");
      },
    ),
  );

  listenerStops.push(
    onSTEvent(eventTypes.GENERATION_ENDED, async (messageId: number) => {
      const type = getRuntimeState().last_generation?.type ?? "normal";
      await onAfterReplyMessage(messageId, type, "generation_ended");
    }),
  );

  // Primary path: GENERATION_AFTER_COMMANDS (ST 扩展中不再需要 TavernHelper hook)
  listenerStops.push(
    registerGenerationAfterCommands(async (type, params, dryRun) => {
      await onGenerationAfterCommands(type, params ?? {}, dryRun);
    }),
  );

  listenerStops.push(
    onSTEvent(eventTypes.CHAT_CHANGED, () => {
      resetRuntimeState();
      resetInterceptGuard();
      setTimeout(() => {
        installSendIntentHooks();
      }, 300);
    }),
  );

  // Initialize floor binding event listeners for automatic cleanup.
  initFloorBindingEvents(getSettings);
}

export function disposeRuntimeEvents() {
  for (const stop of listenerStops.splice(0, listenerStops.length)) {
    stop();
  }
  for (const cleanup of domCleanup.splice(0, domCleanup.length)) {
    cleanup();
  }
  if (sendIntentRetryTimer) {
    clearTimeout(sendIntentRetryTimer);
    sendIntentRetryTimer = null;
  }
  uninstallPrimaryGenerateInterceptor();
  resetInterceptGuard();
  disposeFloorBindingEvents();
}
