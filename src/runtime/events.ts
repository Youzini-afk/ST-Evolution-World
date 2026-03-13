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
  disposeFloorBindingEvents,
  initFloorBindingEvents,
  rollbackBeforeFloor,
} from "./floor-binding";
import { runIncrementalHideCheck } from "./hide-engine";
import { resetInterceptGuard, wasRecentlyIntercepted } from "./intercept-guard";
import { runWorkflow } from "./pipeline";
import { getSettings } from "./settings";
import {
  clearAfterReplyPending,
  clearSendContext,
  getRuntimeState,
  isQuietLike,
  markAfterReplyHandled,
  recordGeneration,
  recordUserSend,
  recordUserSendIntent,
  resetRuntimeState,
  setProcessing,
  shouldHandleAfterReply,
  shouldHandleGenerationAfter,
  wasAfterReplyHandled,
} from "./state";
import {
  DispatchFlowResult,
  EwSettings,
  WorkflowProgressUpdate,
} from "./types";

type StopFn = () => void;

const EW_FLOOR_WORKFLOW_EXECUTION_KEY = "ew_workflow_execution";

type FloorWorkflowStoredResult = {
  flow_id: string;
  response: Record<string, any>;
};

type FloorWorkflowExecutionState = {
  at: number;
  request_id: string;
  successful_results: FloorWorkflowStoredResult[];
  failed_flow_ids: string[];
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

  return {
    at: Number(obj.at ?? 0),
    request_id: String(obj.request_id ?? "").trim(),
    successful_results: successfulResults,
    failed_flow_ids: _.uniq(failedFlowIds),
  };
}

function readFloorWorkflowExecution(
  messageId: number,
): FloorWorkflowExecutionState | null {
  try {
    const message = getChatMessages(messageId)[0];
    return normalizeFloorWorkflowExecutionState(
      message?.data?.[EW_FLOOR_WORKFLOW_EXECUTION_KEY],
    );
  } catch {
    return null;
  }
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
    nextData[EW_FLOOR_WORKFLOW_EXECUTION_KEY] = state;
  } else {
    delete nextData[EW_FLOOR_WORKFLOW_EXECUTION_KEY];
  }

  await setChatMessages([{ message_id: messageId, data: nextData }], {
    refresh: "none",
  });
}

function buildFloorWorkflowExecutionState(
  requestId: string,
  attempts: Array<{
    flow: { id: string };
    ok: boolean;
    response?: Record<string, any>;
  }>,
  preservedResults: FloorWorkflowStoredResult[] = [],
): FloorWorkflowExecutionState {
  const successfulResults = new Map<string, FloorWorkflowStoredResult>(
    preservedResults.map((result) => [result.flow_id, result]),
  );
  const failedFlowIds = new Set<string>();

  for (const attempt of attempts) {
    const flowId = String(attempt.flow.id ?? "").trim();
    if (!flowId) {
      continue;
    }

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
    successful_results: [...successfulResults.values()],
    failed_flow_ids: [...failedFlowIds],
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

type ExecuteWorkflowOptions = {
  messageId: number;
  userInput?: string;
  injectReply: boolean;
  flowIds?: string[];
  timingFilter?: "before_reply" | "after_reply";
  preservedResults?: FloorWorkflowStoredResult[];
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

  let result;
  try {
    result = await runWorkflow({
      message_id: options.messageId,
      user_input: options.userInput,
      trigger: options.trigger,
      mode: "auto",
      inject_reply: options.injectReply,
      flow_ids: options.flowIds,
      timing_filter: options.timingFilter,
      preserved_results: currentPreservedDispatchResults,
      abortSignal: workflowAbortController.signal,
      isCancelled: () => abortedByUser,
      onProgress: handleWorkflowProgress,
    });
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

  if (options.trigger.timing === "after_reply") {
    const assistantMessageId =
      options.trigger.assistant_message_id ?? options.messageId;
    const executionState = buildFloorWorkflowExecutionState(
      result.request_id,
      result.attempts,
      currentPreservedStoredResults,
    );
    await writeFloorWorkflowExecution(assistantMessageId, executionState);
    currentPreservedStoredResults = executionState.successful_results;
    currentPreservedDispatchResults = await buildPreservedDispatchResults(
      settings,
      currentPreservedStoredResults,
    );
  }

  if (!result.ok) {
    const policy = settings.failure_policy ?? "stop_generation";

    if (policy === "retry_once") {
      console.warn("[EW] retry_once: first attempt failed — retrying.");
      const retryReason = formatReasonForDisplay(result.reason, 120);
      processingReminder.update(
        buildAbortableReminder(
          `首次处理失败，正在重试… ${retryReason}`,
          "warning",
        ),
      );
      toastr.warning(
        `工作流首次失败，正在重试… (${retryReason})`,
        "Evolution World",
      );
      try {
        result = await runWorkflow({
          message_id: options.messageId,
          user_input: options.userInput,
          trigger: options.trigger,
          mode: "auto",
          inject_reply: options.injectReply,
          flow_ids: options.flowIds,
          timing_filter: options.timingFilter,
          preserved_results: currentPreservedDispatchResults,
          abortSignal: workflowAbortController.signal,
          isCancelled: () => abortedByUser,
          onProgress: handleWorkflowProgress,
        });
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

      if (options.trigger.timing === "after_reply") {
        const assistantMessageId =
          options.trigger.assistant_message_id ?? options.messageId;
        const executionState = buildFloorWorkflowExecutionState(
          result.request_id,
          result.attempts,
          currentPreservedStoredResults,
        );
        await writeFloorWorkflowExecution(assistantMessageId, executionState);
        currentPreservedStoredResults = executionState.successful_results;
        currentPreservedDispatchResults = await buildPreservedDispatchResults(
          settings,
          currentPreservedStoredResults,
        );
      }
    }

    if (!result.ok) {
      const displayReason = formatReasonForDisplay(result.reason);
      switch (policy) {
        case "continue_generation":
          reminderSettled = true;
          stopCarousel();
          processingReminder.update({
            title: "Evolution World",
            message: `工作流失败：${displayReason}。原消息是否继续发送取决于放行策略。`,
            level: "warning",
            persist: false,
            busy: false,
            action: undefined,
            collapse_after_ms: 0,
            duration_ms: 5500,
          });
          toastr.warning(
            `工作流失败，原消息是否继续发送取决于放行策略: ${displayReason}`,
            "Evolution World",
          );
          break;
        case "allow_partial_success":
        case "notify_only":
          reminderSettled = true;
          stopCarousel();
          processingReminder.update({
            title: "Evolution World",
            message: `工作流失败：${displayReason}`,
            level: "warning",
            persist: false,
            busy: false,
            action: undefined,
            collapse_after_ms: 0,
            duration_ms: 5500,
          });
          toastr.info(`工作流失败: ${displayReason}`, "Evolution World");
          break;
        case "stop_generation":
        case "retry_once":
        default:
          clearReplyInstruction();
          reminderSettled = true;
          stopCarousel();
          processingReminder.update({
            title: "Evolution World",
            message: `动态世界流程失败，本轮已中止：${displayReason}`,
            level: "error",
            persist: false,
            busy: false,
            action: undefined,
            collapse_after_ms: 0,
            duration_ms: 5500,
          });
          stopGenerationNow();
          toastr.error(
            `动态世界流程失败，本轮已中止: ${displayReason}`,
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
    clearSendContext();
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

  clearSendContext();

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
  if (!hasFlowsForTiming(settings, "after_reply")) {
    return;
  }

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

  setProcessing(true);
  try {
    await executeWorkflowWithPolicy(settings, {
      messageId,
      userInput,
      injectReply: false,
      timingFilter: "after_reply",
      trigger: {
        timing: "after_reply",
        source,
        generation_type: generationType,
        user_message_id:
          runtimeState.after_reply.pending_user_message_id ??
          runtimeState.last_send?.message_id,
        assistant_message_id: messageId,
      },
      reminderMessage: "正在根据最新回复更新动态世界，请稍后…",
      successMessage: "动态世界已根据最新回复完成更新。",
    });
    markAfterReplyHandled(messageId, messageText);
  } finally {
    clearAfterReplyPending();
    clearSendContext();
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
