import type { WorkbenchGraph } from "../ui/components/graph/module-types";
import { getEffectiveFlows } from "./char-flows";
import { getChatId, getChatMessages } from "./compat/character";
import { FlowTriggerV1 } from "./contracts";
import { renderControllerTemplate } from "./controller-renderer";
import { dispatchFlows, DispatchFlowsError } from "./dispatcher";
import { executeGraph, validateGraph } from "./graph-executor";
import { uuidv4 } from "./helpers";
import { injectReplyInstructionOnce } from "./injection";
import { mergeFlowResults } from "./merger";
import { getSettings, setLastIo, setLastRun } from "./settings";
import { commitMergedPlan } from "./transaction";
import {
  ContextCursor,
  ControllerTemplateSlot,
  DispatchFlowAttempt,
  DispatchFlowResult,
  RunSummarySchema,
  WorkflowCapsuleMode,
  WorkflowFailureDiagnostic,
  WorkflowJobType,
  WorkflowProgressUpdate,
  WorkflowWritebackPolicy,
} from "./types";

type WorkflowExecutionStage =
  | "preparing"
  | "dispatch"
  | "merge"
  | "commit"
  | "completed";

type RunWorkflowInput = {
  message_id: number;
  user_input?: string;
  trigger?: FlowTriggerV1;
  mode: "auto" | "manual";
  inject_reply?: boolean;
  flow_ids?: string[];
  timing_filter?: "before_reply" | "after_reply";
  preserved_results?: DispatchFlowResult[];
  job_type?: WorkflowJobType;
  context_cursor?: ContextCursor;
  writeback_policy?: WorkflowWritebackPolicy;
  rederive_options?: {
    legacy_approx?: boolean;
    capsule_mode?: WorkflowCapsuleMode;
  };
  abortSignal?: AbortSignal;
  isCancelled?: () => boolean;
  onProgress?: (update: WorkflowProgressUpdate) => void;
};

export type RunWorkflowOutput = {
  ok: boolean;
  reason?: string;
  request_id: string;
  diagnostics?: Record<string, any>;
  attempts: DispatchFlowAttempt[];
  results: DispatchFlowResult[];
  failure: WorkflowFailureDiagnostic | null;
  skipped?: boolean;
};

function extractHttpStatus(reason: string): number | null {
  const match = reason.match(/HTTP\s+(\d{3})\b/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function hasJsonSyntaxHint(reason: string): boolean {
  return /unexpected token|unterminated|stringified|jsonrepair|json5|parse json|JSON at position/i.test(
    reason,
  );
}

function hasRegexExtractHint(reason: string): boolean {
  return /response_extract_regex|extract regex|did not match|未匹配/i.test(
    reason,
  );
}

function inferFailureKind(
  stage: WorkflowFailureDiagnostic["stage"],
  reason: string,
): WorkflowFailureDiagnostic["kind"] {
  const httpStatus = extractHttpStatus(reason);
  if (/workflow cancelled by user/i.test(reason)) {
    return "cancelled";
  }
  if (httpStatus === 401) {
    return "auth_error";
  }
  if (httpStatus === 403) {
    return "permission_error";
  }
  if (httpStatus === 404) {
    return "not_found";
  }
  if (httpStatus === 429) {
    return "rate_limit";
  }
  if (
    /secure TLS connection was not established|tls|certificate|ssl/i.test(
      reason,
    )
  ) {
    return "tls_error";
  }
  if (/ECONNRESET|connection reset|socket disconnected/i.test(reason)) {
    return "connection_reset";
  }
  if (/timeout/i.test(reason)) {
    return "timeout";
  }
  if (/API returned empty response|empty response/i.test(reason)) {
    return "empty_response";
  }
  if (hasRegexExtractHint(reason)) {
    return "regex_extract";
  }
  if (/response schema invalid/i.test(reason)) {
    return "schema_invalid";
  }
  if (hasJsonSyntaxHint(reason)) {
    return "response_parse";
  }
  if (/request_template invalid|headers_json invalid/i.test(reason)) {
    return "template_invalid";
  }
  if (/bound worldbook|worldbook/i.test(reason) && stage === "config") {
    return "worldbook_missing";
  }
  if (
    /no enabled flows|api_url is empty|model is empty|generateRaw is unavailable/i.test(
      reason,
    )
  ) {
    return "config_invalid";
  }
  if (
    /上游 API|ST backend error|HTTP\s+\d{3}|ECONNRESET|ETIMEDOUT/i.test(reason)
  ) {
    return "http_error";
  }
  if (stage === "merge") {
    return "merge_failed";
  }
  if (stage === "commit") {
    return "commit_failed";
  }
  return "unknown";
}

function inferFailureSuggestion(
  stage: WorkflowFailureDiagnostic["stage"],
  kind: WorkflowFailureDiagnostic["kind"],
  reason: string,
): string {
  const httpStatus = extractHttpStatus(reason);
  switch (kind) {
    case "auth_error":
      return "上游接口返回 401，优先检查 API Key、Authorization 头和当前预设是否绑定到了正确模型。";
    case "permission_error":
      return "上游接口返回 403，通常是权限不足、额度受限或模型无权访问，先检查账号权限与模型白名单。";
    case "not_found":
      return "上游接口返回 404，优先检查 API 地址、反向代理路径和模型名称是否写错。";
    case "rate_limit":
      return "上游接口返回 429，说明触发了限流；建议提高并行间隔、串行间隔或 after_reply 延迟，并检查 RPM/TPM 配额。";
    case "tls_error":
      return "与上游建立 TLS/SSL 连接失败，检查证书链、代理配置以及 API 地址是否支持 HTTPS。";
    case "connection_reset":
      return "连接在建立或传输过程中被重置，优先检查代理、网络稳定性和上游服务可用性。";
    case "http_error":
      return httpStatus
        ? `上游接口返回 HTTP ${httpStatus}，检查 API 预设中的地址、模型、鉴权和代理配置。`
        : "检查 API 预设中的地址、模型、鉴权和代理配置，确认上游服务当前可访问。";
    case "timeout":
      return "检查模型响应速度，或提高工作流/全局超时，并减少单次返回体积。";
    case "empty_response":
      return "上游接口返回了空内容，优先检查模型是否被静默拒答、流式桥接是否中断，以及请求模板是否导致无正文返回。";
    case "regex_extract":
      return "检查该工作流的 response_extract_regex 是否能稳定命中模型输出；如果模型会输出 thinking/解释文本，也要同步调整 remove/extract 规则。";
    case "schema_invalid":
      return "模型返回结构不符合 FlowResponse 约定，先检查 prompt 约束，再检查响应提取后的 JSON 结构。";
    case "response_parse":
      return "模型返回的文本无法解析为 JSON，优先检查 response_remove_regex、response_extract_regex、thinking 污染以及 schema 约束。";
    case "template_invalid":
      return "检查 request_template 或 headers_json 是否仍是合法 JSON，并确认模板替换后没有破坏结构。";
    case "worldbook_missing":
      return "先为当前角色绑定世界书，再执行工作流。";
    case "config_invalid":
      return "检查工作流启用状态、API 预设绑定以及必填字段是否完整。";
    case "merge_failed":
      return "检查各工作流返回的 operations / controller_model 是否存在结构冲突或字段缺失。";
    case "commit_failed":
      return "检查世界书写回、控制器渲染和楼层绑定状态，确认宿主允许当前聊天写入。";
    case "cancelled":
      return "这是手动中止，不是系统故障；如需复现，请重新执行本轮工作流。";
    case "unknown":
    default:
      if (stage === "dispatch") {
        return "先从下方请求/响应详情定位是哪条工作流失败，再检查对应 API 返回内容。";
      }
      if (stage === "merge") {
        return "优先查看运行记录中的成功 flow 返回结果，确认合并前的数据是否完整。";
      }
      if (stage === "commit") {
        return "优先检查世界书绑定、控制器模板和宿主写回路径。";
      }
      return reason
        ? "请结合下方运行记录和请求/响应详情继续排查。"
        : "请结合运行记录继续排查。";
  }
}

function classifyDispatchFlowFailure(reason: string) {
  const kind = inferFailureKind("dispatch", reason);
  return {
    stage: "dispatch" as const,
    kind,
    suggestion: inferFailureSuggestion("dispatch", kind, reason),
    httpStatus: extractHttpStatus(reason),
  };
}

function shouldRunFlowOnRound(
  flow: DispatchFlowAttempt["flow"] | DispatchFlowResult["flow"],
  round: number,
): boolean {
  const interval = Math.max(
    1,
    Math.trunc(Number(flow.run_every_n_floors ?? 1) || 1),
  );
  if (interval <= 1) {
    return true;
  }
  return round % interval === 0;
}

function resolveAutoTriggerAnchorMessageId(input: RunWorkflowInput): number {
  const assistantMessageId = Number(input.trigger?.assistant_message_id);
  if (
    input.timing_filter === "after_reply" &&
    Number.isFinite(assistantMessageId) &&
    assistantMessageId >= 0
  ) {
    return assistantMessageId;
  }

  const userMessageId = Number(input.trigger?.user_message_id);
  if (
    input.timing_filter === "before_reply" &&
    Number.isFinite(userMessageId) &&
    userMessageId >= 0
  ) {
    return userMessageId;
  }

  return Math.max(0, Math.trunc(Number(input.message_id) || 0));
}

function resolveAutoTriggerOrdinal(input: RunWorkflowInput): number {
  if (!input.timing_filter) {
    return 1;
  }

  const anchorMessageId = resolveAutoTriggerAnchorMessageId(input);
  const expectedRole =
    input.timing_filter === "after_reply" ? "assistant" : "user";
  let matchedCount = 0;

  try {
    const messages = getChatMessages(`0-${anchorMessageId}`);
    for (const message of Array.isArray(messages) ? messages : []) {
      if (String(message?.role ?? "") === expectedRole) {
        matchedCount += 1;
      }
    }

    if (input.timing_filter === "before_reply") {
      const anchorMessage = getChatMessages(anchorMessageId)[0];
      if (String(anchorMessage?.role ?? "") !== expectedRole) {
        matchedCount += 1;
      }
    }
  } catch (error) {
    console.warn(
      "[Evolution World] resolveAutoTriggerOrdinal failed, fallback to 1:",
      error,
    );
  }

  return Math.max(1, matchedCount);
}

function buildWorkflowFailureDiagnostic(params: {
  stage: WorkflowFailureDiagnostic["stage"];
  reason: string;
  requestId: string;
  attempts: DispatchFlowAttempt[];
}): WorkflowFailureDiagnostic {
  const { stage, reason, requestId, attempts } = params;
  const failedAttempts = attempts.filter((attempt) => !attempt.ok);
  const successfulAttempts = attempts.filter((attempt) => attempt.ok);
  const primaryAttempt =
    failedAttempts[0] ?? attempts[attempts.length - 1] ?? null;
  const kind = inferFailureKind(stage, reason);
  const flowName = primaryAttempt?.flow.name?.trim() || "";
  const flowId = primaryAttempt?.flow.id ?? "";
  const flowLabel = flowName || flowId || "当前工作流";
  const httpStatus = extractHttpStatus(reason);
  let summary = "";

  switch (stage) {
    case "dispatch":
      switch (kind) {
        case "auth_error":
          summary = `工作流“${flowLabel}”鉴权失败`;
          break;
        case "permission_error":
          summary = `工作流“${flowLabel}”被上游拒绝访问`;
          break;
        case "not_found":
          summary = `工作流“${flowLabel}”请求地址或模型不存在`;
          break;
        case "rate_limit":
          summary = `工作流“${flowLabel}”触发了上游限流`;
          break;
        case "tls_error":
          summary = `工作流“${flowLabel}”建立安全连接失败`;
          break;
        case "connection_reset":
          summary = `工作流“${flowLabel}”连接被上游重置`;
          break;
        case "timeout":
          summary = `工作流“${flowLabel}”请求超时`;
          break;
        case "empty_response":
          summary = `工作流“${flowLabel}”返回了空响应`;
          break;
        case "regex_extract":
          summary = `工作流“${flowLabel}”提取规则未命中有效内容`;
          break;
        case "response_parse":
          summary = `工作流“${flowLabel}”返回内容无法解析为 JSON`;
          break;
        case "schema_invalid":
          summary = `工作流“${flowLabel}”返回结构不符合预期`;
          break;
        case "template_invalid":
          summary = `工作流“${flowLabel}”请求模板配置无效`;
          break;
        case "http_error":
          summary = httpStatus
            ? `工作流“${flowLabel}”请求失败（HTTP ${httpStatus}）`
            : `请求工作流“${flowLabel}”失败`;
          break;
        default:
          summary = `请求工作流“${flowLabel}”失败`;
          break;
      }
      break;
    case "merge":
      summary =
        successfulAttempts.length > 0
          ? "工作流响应已返回，但在合并结果时失败"
          : "工作流结果合并失败";
      break;
    case "commit":
      summary = "工作流结果已生成，但写回世界书或控制器时失败";
      break;
    case "cancelled":
      summary = "本轮工作流已被手动终止";
      break;
    case "config":
      summary = "工作流在执行前的配置检查阶段失败";
      break;
    case "unknown":
    default:
      summary = "工作流执行失败";
      break;
  }

  return {
    stage,
    kind,
    summary,
    detail: reason,
    suggestion: inferFailureSuggestion(stage, kind, reason),
    request_id: requestId,
    flow_id: flowId,
    flow_name: flowName,
    api_preset_name: primaryAttempt?.api_preset_name ?? "",
    http_status: extractHttpStatus(reason),
    retry_count: 0,
    attempted_flow_count: attempts.length,
    successful_flow_count: successfulAttempts.length,
    failed_flow_count: failedAttempts.length,
    partial_success: failedAttempts.length > 0 && successfulAttempts.length > 0,
    whole_workflow_failed:
      attempts.length > 0 &&
      failedAttempts.length === 0 &&
      stage !== "dispatch",
  };
}

function toPreview(value: unknown, maxLen = 3000): string {
  try {
    const text = JSON.stringify(value, null, 2);
    if (text.length <= maxLen) {
      return text;
    }
    return `${text.slice(0, maxLen)}\n...truncated`;
  } catch {
    return String(value);
  }
}

function buildAttemptRequestPreview(attempt: DispatchFlowAttempt): string {
  return toPreview(
    attempt.request_debug ?? {
      flow_request: attempt.request,
    },
    20000,
  );
}

function saveIoSummary(
  requestId: string,
  chatId: string,
  mode: "auto" | "manual",
  attempts: DispatchFlowAttempt[],
) {
  setLastIo({
    at: Date.now(),
    request_id: requestId,
    chat_id: chatId,
    mode,
    flows: attempts.map((attempt) => {
      const failure = attempt.error
        ? classifyDispatchFlowFailure(attempt.error)
        : null;
      return {
        flow_id: attempt.flow.id,
        flow_name: attempt.flow.name,
        priority: attempt.flow.priority,
        api_preset_name: attempt.api_preset_name,
        api_url: attempt.api_url,
        ok: attempt.ok,
        elapsed_ms: attempt.elapsed_ms,
        error: attempt.error ?? "",
        error_stage: failure?.stage ?? "unknown",
        error_kind: failure?.kind ?? "unknown",
        error_suggestion: failure?.suggestion ?? "",
        error_status: failure?.httpStatus ?? null,
        request_preview: buildAttemptRequestPreview(attempt),
        response_preview: attempt.response ? toPreview(attempt.response) : "",
      };
    }),
  });
}

function persistIoSummarySafe(
  requestId: string,
  chatId: string,
  mode: "auto" | "manual",
  attempts: DispatchFlowAttempt[],
) {
  try {
    saveIoSummary(requestId, chatId, mode, attempts);
  } catch (error) {
    console.warn("[Evolution World] saveIoSummary failed:", error);
  }
}

function persistRunSummarySafe(
  summary: ReturnType<typeof RunSummarySchema.parse>,
) {
  try {
    setLastRun(summary);
  } catch (error) {
    console.warn("[Evolution World] setLastRun failed:", error);
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`workflow timeout (${timeoutMs}ms)`)),
      timeoutMs,
    );
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result as T;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function isWorkflowCancelled(
  input: Pick<RunWorkflowInput, "abortSignal" | "isCancelled">,
): boolean {
  return Boolean(input.abortSignal?.aborted || input.isCancelled?.());
}

function throwIfWorkflowCancelled(
  input: Pick<RunWorkflowInput, "abortSignal" | "isCancelled">,
): void {
  if (isWorkflowCancelled(input)) {
    throw new Error("workflow cancelled by user");
  }
}

async function waitWithCancellation(
  ms: number,
  input: Pick<RunWorkflowInput, "abortSignal" | "isCancelled">,
): Promise<void> {
  if (ms <= 0) {
    return;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < ms) {
    throwIfWorkflowCancelled(input);
    const remaining = ms - (Date.now() - startedAt);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(remaining, 200)),
    );
  }
  throwIfWorkflowCancelled(input);
}

// ── Graph Execution Path (Module Workbench) ──

async function runGraphWorkflow(
  input: RunWorkflowInput,
  settings: any,
  enabledGraphs: WorkbenchGraph[],
  requestId: string,
  startedAt: number,
): Promise<RunWorkflowOutput> {
  const currentChatId = String(getChatId() ?? "unknown");

  input.onProgress?.({
    phase: "preparing",
    request_id: requestId,
    message: `正在准备图工作流（${enabledGraphs.length} 个图）…`,
  });

  // Sort by priority (lower = earlier)
  const sorted = [...enabledGraphs].sort((a, b) => a.priority - b.priority);
  const allResults: DispatchFlowResult[] = [];

  for (const graph of sorted) {
    if (isWorkflowCancelled(input)) {
      throw new Error("workflow cancelled by user");
    }

    // Validate before execution
    const errors = validateGraph(graph);
    if (errors.length > 0) {
      const msg = errors.map((e) => e.message).join("; ");
      console.warn(`[EW] Graph "${graph.name}" validation failed: ${msg}`);
      continue; // Skip invalid graphs
    }

    input.onProgress?.({
      phase: "dispatching",
      request_id: requestId,
      message: `正在执行图工作流「${graph.name}」…`,
    });

    const graphResult = await executeGraph(graph, {
      requestId,
      chatId: currentChatId,
      messageId: input.message_id,
      userInput: input.user_input ?? "",
      trigger: input.trigger,
      settings,
      abortSignal: input.abortSignal,
      isCancelled: input.isCancelled,
      onProgress: input.onProgress,
    });

    if (!graphResult.ok) {
      return {
        ok: false,
        reason: graphResult.reason,
        request_id: requestId,
        attempts: [],
        results: allResults,
        failure: buildWorkflowFailureDiagnostic({
          stage: "dispatch",
          reason: graphResult.reason ?? "graph workflow failed",
          requestId,
          attempts: [],
        }),
      };
    }
  }

  const summary = RunSummarySchema.parse({
    at: Date.now(),
    ok: true,
    reason: "",
    request_id: requestId,
    chat_id: currentChatId,
    flow_count: sorted.length,
    elapsed_ms: Date.now() - startedAt,
    mode: input.mode,
    diagnostics: {},
  });
  persistRunSummarySafe(summary);

  return {
    ok: true,
    request_id: requestId,
    attempts: [],
    results: allResults,
    failure: null,
  };
}

// ── Legacy Flow Execution Path ──

export async function runWorkflow(
  input: RunWorkflowInput,
): Promise<RunWorkflowOutput> {
  const startedAt = Date.now();
  const settings = getSettings();
  const requestId = uuidv4();
  const preservedResults = [...(input.preserved_results ?? [])];
  const currentChatId = String(getChatId() ?? "unknown");
  let attempts: DispatchFlowAttempt[] = [];
  let currentStage: WorkflowExecutionStage = "preparing";

  try {
    throwIfWorkflowCancelled(input);

    const workbenchGraphs: WorkbenchGraph[] =
      (settings as any).workbench_graphs ?? [];
    const enabledGraphs = workbenchGraphs.filter((g) => g.enabled);
    if (enabledGraphs.length > 0 && !input.flow_ids?.length) {
      return await runGraphWorkflow(
        input,
        settings,
        enabledGraphs,
        requestId,
        startedAt,
      );
    }

    input.onProgress?.({
      phase: "preparing",
      request_id: requestId,
      message: "正在准备工作流上下文…",
    });

    const allEnabledFlows = await getEffectiveFlows(settings);
    const selectedFlowIds = new Set((input.flow_ids ?? []).filter(Boolean));
    let enabledFlows =
      selectedFlowIds.size > 0
        ? allEnabledFlows.filter((flow) => selectedFlowIds.has(flow.id))
        : allEnabledFlows;

    if (input.timing_filter) {
      enabledFlows = enabledFlows.filter((flow) => {
        const effective =
          flow.timing === "default" ? settings.workflow_timing : flow.timing;
        return effective === input.timing_filter;
      });
    }

    if (
      input.mode === "auto" &&
      input.timing_filter &&
      selectedFlowIds.size === 0
    ) {
      const ordinal = resolveAutoTriggerOrdinal(input);
      enabledFlows = enabledFlows.filter((flow) =>
        shouldRunFlowOnRound(flow, ordinal),
      );

      if (enabledFlows.length === 0) {
        return {
          ok: true,
          reason: `no flows scheduled for timing '${input.timing_filter}' on floor ordinal ${ordinal}`,
          request_id: requestId,
          attempts: [],
          results: [],
          failure: null,
          skipped: true,
        };
      }
    }

    if (enabledFlows.length === 0) {
      if (input.timing_filter) {
        return {
          ok: true,
          reason: `no flows match timing '${input.timing_filter}'`,
          request_id: requestId,
          attempts: [],
          results: [],
          failure: null,
          skipped: true,
        };
      }
      throw new Error("no enabled flows");
    }

    const afterReplyDelayMs = Math.max(
      0,
      Math.round((settings.after_reply_delay_seconds ?? 0) * 1000),
    );
    if (input.timing_filter === "after_reply" && afterReplyDelayMs > 0) {
      input.onProgress?.({
        phase: "dispatching",
        request_id: requestId,
        message: `AI 回复已完成，等待 ${settings.after_reply_delay_seconds} 秒后开始执行工作流…`,
      });
      await waitWithCancellation(afterReplyDelayMs, input);
    }

    throwIfWorkflowCancelled(input);
    currentStage = "dispatch";
    input.onProgress?.({
      phase: "dispatching",
      request_id: requestId,
      message: `已装载 ${enabledFlows.length} 条工作流，正在请求模型…`,
    });

    const dispatchOutput = await withTimeout(
      dispatchFlows({
        settings,
        flows: enabledFlows,
        message_id: input.message_id,
        user_input: input.user_input,
        trigger: input.trigger,
        request_id: requestId,
        context_cursor: input.context_cursor,
        job_type: input.job_type,
        writeback_policy: input.writeback_policy,
        rederive_options: input.rederive_options,
        abortSignal: input.abortSignal,
        isCancelled: input.isCancelled,
        onProgress: input.onProgress,
      }),
      settings.total_timeout_ms,
    );
    attempts = dispatchOutput.attempts;
    persistIoSummarySafe(requestId, currentChatId, input.mode, attempts);

    throwIfWorkflowCancelled(input);

    const results = [...preservedResults, ...dispatchOutput.results];

    currentStage = "merge";
    input.onProgress?.({
      phase: "merging",
      request_id: requestId,
      message: "模型响应已返回，正在合并条目结果…",
    });
    const mergedPlan = mergeFlowResults(results, settings);
    throwIfWorkflowCancelled(input);

    const controllerTemplates: ControllerTemplateSlot[] = [];
    for (const slot of mergedPlan.controller_models) {
      controllerTemplates.push({
        flow_id: slot.flow_id,
        flow_name: slot.flow_name,
        entry_name: slot.entry_name,
        content: await renderControllerTemplate(
          slot.model,
          settings.dynamic_entry_prefix,
        ),
      });
    }
    throwIfWorkflowCancelled(input);

    currentStage = "commit";
    input.onProgress?.({
      phase: "committing",
      request_id: requestId,
      message: "正在写回世界书与控制器…",
    });

    const commitResult = await commitMergedPlan(
      settings,
      mergedPlan,
      controllerTemplates,
      requestId,
      input.message_id,
    );
    throwIfWorkflowCancelled(input);

    if (input.inject_reply !== false) {
      injectReplyInstructionOnce(mergedPlan.reply_instruction);
    }

    const summary = RunSummarySchema.parse({
      at: Date.now(),
      ok: true,
      reason: "",
      request_id: requestId,
      chat_id: commitResult.chat_id,
      flow_count: results.length,
      elapsed_ms: Date.now() - startedAt,
      mode: input.mode,
      diagnostics: mergedPlan.diagnostics,
    });
    persistRunSummarySafe(summary);

    input.onProgress?.({
      phase: "completed",
      request_id: requestId,
      message: "工作流处理完成。",
    });
    currentStage = "completed";

    return {
      ok: true,
      request_id: requestId,
      diagnostics: mergedPlan.diagnostics,
      attempts,
      results,
      failure: null,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    input.onProgress?.({
      phase: "failed",
      request_id: requestId,
      message: reason,
    });
    if (error instanceof DispatchFlowsError) {
      attempts = error.attempts;
      saveIoSummary(requestId, currentChatId, input.mode, attempts);
    } else if (attempts.length === 0) {
      saveIoSummary(requestId, currentChatId, input.mode, []);
    }

    const failureStage: WorkflowFailureDiagnostic["stage"] = (() => {
      if (/workflow cancelled by user/i.test(reason)) {
        return "cancelled";
      }
      if (error instanceof DispatchFlowsError || currentStage === "dispatch") {
        return "dispatch";
      }
      if (currentStage === "merge") {
        return "merge";
      }
      if (currentStage === "commit") {
        return "commit";
      }
      return attempts.length === 0 ? "config" : "unknown";
    })();
    const failure = buildWorkflowFailureDiagnostic({
      stage: failureStage,
      reason,
      requestId,
      attempts,
    });

    const summary = RunSummarySchema.parse({
      at: Date.now(),
      ok: false,
      reason,
      request_id: requestId,
      chat_id: currentChatId,
      flow_count:
        (input.flow_ids?.length ?? 0) > 0
          ? (input.flow_ids?.length ?? 0)
          : settings.flows.filter((flow) => flow.enabled).length,
      elapsed_ms: Date.now() - startedAt,
      mode: input.mode,
      diagnostics: {},
      failure,
    });
    setLastRun(summary);

    return {
      ok: false,
      reason,
      request_id: requestId,
      attempts,
      results: preservedResults,
      failure,
    };
  }
}
