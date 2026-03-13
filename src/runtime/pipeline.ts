import { getEffectiveFlows } from './char-flows';
import { renderControllerTemplate } from './controller-renderer';
import { dispatchFlows, DispatchFlowsError } from './dispatcher';
import { uuidv4 } from './helpers';
import { injectReplyInstructionOnce } from './injection';
import { mergeFlowResults } from './merger';
import { getSettings, setLastIo, setLastRun } from './settings';
import { commitMergedPlan } from './transaction';
import {
  ControllerTemplateSlot,
  DispatchFlowAttempt,
  DispatchFlowResult,
  RunSummarySchema,
  WorkflowProgressUpdate,
} from './types';

type RunWorkflowInput = {
  message_id: number;
  user_input?: string;
  trigger?: Record<string, any>;
  mode: 'auto' | 'manual';
  inject_reply?: boolean;
  flow_ids?: string[];
  timing_filter?: 'before_reply' | 'after_reply';
  preserved_results?: DispatchFlowResult[];
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
};

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

function saveIoSummary(requestId: string, chatId: string, mode: 'auto' | 'manual', attempts: DispatchFlowAttempt[]) {
  setLastIo({
    at: Date.now(),
    request_id: requestId,
    chat_id: chatId,
    mode,
    flows: attempts.map(attempt => ({
      flow_id: attempt.flow.id,
      flow_name: attempt.flow.name,
      priority: attempt.flow.priority,
      api_preset_name: attempt.api_preset_name,
      api_url: attempt.api_url,
      ok: attempt.ok,
      elapsed_ms: attempt.elapsed_ms,
      error: attempt.error ?? '',
      request_preview: buildAttemptRequestPreview(attempt),
      response_preview: attempt.response ? toPreview(attempt.response) : '',
    })),
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`workflow timeout (${timeoutMs}ms)`)), timeoutMs);
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

function isWorkflowCancelled(input: Pick<RunWorkflowInput, 'abortSignal' | 'isCancelled'>): boolean {
  return Boolean(input.abortSignal?.aborted || input.isCancelled?.());
}

function throwIfWorkflowCancelled(input: Pick<RunWorkflowInput, 'abortSignal' | 'isCancelled'>): void {
  if (isWorkflowCancelled(input)) {
    throw new Error('workflow cancelled by user');
  }
}

export async function runWorkflow(input: RunWorkflowInput): Promise<RunWorkflowOutput> {
  const startedAt = Date.now();
  const settings = getSettings();
  const requestId = uuidv4();
  const preservedResults = [...(input.preserved_results ?? [])];
  const currentChatId = String(
    (typeof SillyTavern !== 'undefined' ? (SillyTavern?.getCurrentChatId?.() ?? (SillyTavern as any).chatId) : null) ??
      'unknown',
  );
  let attempts: DispatchFlowAttempt[] = [];

  try {
    throwIfWorkflowCancelled(input);
    input.onProgress?.({
      phase: 'preparing',
      request_id: requestId,
      message: '正在准备工作流上下文…',
    });
    // Merge global flows + per-character flows (from EW/Flows worldbook entry).
    const allEnabledFlows = await getEffectiveFlows(settings);
    const selectedFlowIds = new Set((input.flow_ids ?? []).filter(Boolean));
    let enabledFlows =
      selectedFlowIds.size > 0 ? allEnabledFlows.filter(flow => selectedFlowIds.has(flow.id)) : allEnabledFlows;

    // Per-flow timing filter: resolve 'default' to global workflow_timing, then keep only matching.
    if (input.timing_filter) {
      enabledFlows = enabledFlows.filter(f => {
        const effective = f.timing === 'default' ? settings.workflow_timing : f.timing;
        return effective === input.timing_filter;
      });
    }

    if (enabledFlows.length === 0) {
      // If timing filter caused 0 flows, this is a no-op — not an error.
      if (input.timing_filter) {
        return {
          ok: true,
          reason: `no flows match timing '${input.timing_filter}'`,
          request_id: requestId,
          attempts: [],
          results: [],
        };
      }
      throw new Error('no enabled flows');
    }

    throwIfWorkflowCancelled(input);
    input.onProgress?.({
      phase: 'dispatching',
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
        abortSignal: input.abortSignal,
        isCancelled: input.isCancelled,
        onProgress: input.onProgress,
      }),
      settings.total_timeout_ms,
    );
    attempts = dispatchOutput.attempts;
    saveIoSummary(requestId, currentChatId, input.mode, attempts);

    throwIfWorkflowCancelled(input);

    const results = [...preservedResults, ...dispatchOutput.results];

    input.onProgress?.({
      phase: 'merging',
      request_id: requestId,
      message: '模型响应已返回，正在合并条目结果…',
    });
    const mergedPlan = mergeFlowResults(results, settings);
    throwIfWorkflowCancelled(input);

    // Render each flow's controller_model into an EJS template.
    const controllerTemplates: ControllerTemplateSlot[] = [];
    for (const slot of mergedPlan.controller_models) {
      controllerTemplates.push({
        flow_id: slot.flow_id,
        flow_name: slot.flow_name,
        entry_name: slot.entry_name,
        content: await renderControllerTemplate(slot.model, settings.dynamic_entry_prefix),
      });
    }
    throwIfWorkflowCancelled(input);
    input.onProgress?.({
      phase: 'committing',
      request_id: requestId,
      message: '正在写回世界书与控制器…',
    });

    const commitResult = await commitMergedPlan(settings, mergedPlan, controllerTemplates, requestId, input.message_id);
    throwIfWorkflowCancelled(input);

    if (input.inject_reply !== false) {
      injectReplyInstructionOnce(mergedPlan.reply_instruction);
    }

    const summary = RunSummarySchema.parse({
      at: Date.now(),
      ok: true,
      reason: '',
      request_id: requestId,
      chat_id: commitResult.chat_id,
      flow_count: results.length,
      elapsed_ms: Date.now() - startedAt,
      mode: input.mode,
      diagnostics: mergedPlan.diagnostics,
    });
    setLastRun(summary);

    input.onProgress?.({
      phase: 'completed',
      request_id: requestId,
      message: '工作流处理完成。',
    });

    return {
      ok: true,
      request_id: requestId,
      diagnostics: mergedPlan.diagnostics,
      attempts,
      results,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    input.onProgress?.({
      phase: 'failed',
      request_id: requestId,
      message: reason,
    });
    if (error instanceof DispatchFlowsError) {
      attempts = error.attempts;
      saveIoSummary(requestId, currentChatId, input.mode, attempts);
    } else if (attempts.length === 0) {
      saveIoSummary(requestId, currentChatId, input.mode, []);
    }

    const summary = RunSummarySchema.parse({
      at: Date.now(),
      ok: false,
      reason,
      request_id: requestId,
      chat_id: currentChatId,
      flow_count:
        (input.flow_ids?.length ?? 0) > 0
          ? (input.flow_ids?.length ?? 0)
          : settings.flows.filter(flow => flow.enabled).length,
      elapsed_ms: Date.now() - startedAt,
      mode: input.mode,
      diagnostics: {},
    });
    setLastRun(summary);

    return { ok: false, reason, request_id: requestId, attempts, results: preservedResults };
  }
}
