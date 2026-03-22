import { readGraphBlockingExplainArtifactEnvelope } from "@/runtime/graph-blocking-explain-artifact-codec";
import {
  GraphDocumentEnvelope,
  buildGraphDocumentExportPayload,
} from "@/runtime/graph-document-codec";
import { readGraphTerminalOutcomeExplainArtifactEnvelope } from "@/runtime/graph-terminal-outcome-explain-artifact-codec";
import _ from "lodash";
import {
  clearCharFlowDraft,
  readCharFlowDraft,
  readCharFlows,
  writeCharFlowDraft,
  writeCharFlows,
} from "../runtime/char-flows";
import {
  getChatMessages,
  getCurrentCharacterName,
  getLastMessageId,
} from "../runtime/compat/character";
import { createDefaultApiPreset, createDefaultFlow } from "../runtime/factory";
import {
  collectAllFloorSnapshots,
  collectLatestSnapshots,
  rollbackToFloor,
  type FloorSnapshot,
} from "../runtime/floor-binding";
import { readGraphCompileArtifactEnvelope } from "../runtime/graph-compile-artifact-codec";
import { readGraphCompileRunLinkArtifactEnvelope } from "../runtime/graph-compile-run-link-artifact-codec";
import { readGraphDocumentEnvelope } from "../runtime/graph-document-codec";
import { readGraphFailureExplainArtifactEnvelope } from "../runtime/graph-failure-explain-artifact-codec";
import { readGraphHostEffectExplainArtifactEnvelope } from "../runtime/graph-host-effect-explain-artifact-codec";
import { readGraphNodeInputResolutionArtifactEnvelope } from "../runtime/graph-input-resolution-artifact-codec";
import { readGraphOutputExplainArtifactEnvelope } from "../runtime/graph-output-explain-artifact-codec";
import { readGraphReuseExplainArtifactEnvelope } from "../runtime/graph-reuse-explain-artifact-codec";
import { readGraphRunSnapshotEnvelope } from "../runtime/graph-run-artifact-codec";
import { readGraphSchedulingExplainArtifactEnvelope } from "../runtime/graph-scheduling-explain-artifact-codec";
import { runWorkflow } from "../runtime/pipeline";
import {
  previewPrompt,
  type PromptPreviewMessage,
} from "../runtime/prompt-assembler";
import {
  getLastIo,
  getLastRun,
  getSettings,
  loadLastIo,
  loadLastIoForChat,
  loadLastRun,
  loadLastRunForChat,
  patchSettings,
  persistSettingsDraft,
  replaceSettings,
  subscribeLastIo,
  subscribeLastRun,
  subscribeSettings,
} from "../runtime/settings";
import type { DynSnapshot } from "../runtime/types";
import {
  EwFlowConfig,
  EwFlowConfigSchema,
  EwSettings,
  EwSettingsSchema,
  LastIoSummary,
  RunSummary,
  type ControllerEntrySnapshot,
} from "../runtime/types";
import { getModuleExplainContract } from "./components/graph/module-registry";
import type {
  GraphActiveRunSummaryViewModel,
  GraphBlockingExplainArtifactV1,
  GraphCheckpointCandidateViewModel,
  GraphCompileArtifactV1,
  GraphCompileRunLinkArtifactV1,
  GraphExecutionStage,
  GraphFailureExplainArtifactV1,
  GraphHostEffectExplainArtifactV1,
  GraphNodeDiagnosticsView,
  GraphNodeDiagnosticsViewModel,
  GraphNodeDirtyReason,
  GraphNodeExecutionDecisionReason,
  GraphNodeInputResolutionArtifactV1,
  GraphNodeReuseReason,
  GraphOutputExplainArtifactV1,
  GraphReuseExplainArtifactV1,
  GraphRunArtifact,
  GraphRunBlockingContract,
  GraphRunBlockingInputRequirementType,
  GraphRunBlockingReason,
  GraphRunConstraintSummaryViewModel,
  GraphRunControlPreconditionItem,
  GraphRunControlPreconditionsContract,
  GraphRunDiagnosticsOverview,
  GraphRunDiagnosticsSummaryViewModel,
  GraphRunHeartbeatSummary,
  GraphRunNonContinuableReasonKind,
  GraphRunPartialOutputSummary,
  GraphRunPhase,
  GraphRunRecoveryEligibilityFact,
  GraphRunRecoveryEvidenceTrust,
  GraphRunStatus,
  GraphRunTerminalOutcome,
  GraphRunWaitingUserSummary,
  GraphSchedulingExplainArtifactV1,
  GraphTerminalOutcomeExplainArtifactV1,
  ModuleExplainContract,
  WorkbenchGraph,
} from "./components/graph/module-types";
import { convertStPresetToFlow, isSillyTavernPreset } from "./convertStPreset";
import type { TabKey } from "./help-meta";
import { showEwNotice } from "./notice";

export const useEwStore = defineStore("evolution-world-store", () => {
  const settings = ref<EwSettings>(getSettings());
  const lastRun = ref<RunSummary | null>(getLastRun());
  const lastIo = ref<LastIoSummary | null>(getLastIo());
  const activeTab = ref<TabKey>("overview");
  const globalAdvancedOpen = ref(false);
  const expandedApiPresetId = ref<string | null>(null);
  const expandedFlowId = ref<string | null>(null);
  const importText = ref("");
  const busy = ref(false);

  const charFlows = ref<EwFlowConfig[]>([]);
  const activeCharName = ref<string>("");
  const flowScope = ref<"global" | "character">("global");
  const charFlowsLoading = ref(false);
  let suppressCharFlowDraftPersist = false;
  let charFlowRefreshTimer: number | null = null;

  const promptPreview = ref<PromptPreviewMessage[] | null>(null);
  const snapshotPreview = ref<{
    controllers: ControllerEntrySnapshot[];
    dyn: Map<string, DynSnapshot>;
  } | null>(null);
  const previewFlowId = ref<string>("");

  const floorSnapshots = ref<FloorSnapshot[]>([]);
  const selectedFloorId = ref<number | null>(null);
  const compareFloorId = ref<number | null>(null);
  let suppressPersist = false;
  let persistTimeoutId: number | null = null;
  let persistIdleId: number | null = null;

  function getHostRuntime(): Record<string, any> {
    try {
      if (window.parent && window.parent !== window) {
        return window.parent as unknown as Record<string, any>;
      }
    } catch {
      // ignore
    }

    return window as unknown as Record<string, any>;
  }

  function getCurrentChatIdSafe(): string {
    try {
      const hostRuntime = getHostRuntime();
      const sillyTavern =
        hostRuntime.SillyTavern ??
        (globalThis as Record<string, any>).SillyTavern;
      return String(
        sillyTavern?.getCurrentChatId?.() ?? sillyTavern?.chatId ?? "",
      ).trim();
    } catch {
      return "";
    }
  }

  function clearScheduledPersist() {
    if (persistTimeoutId !== null) {
      window.clearTimeout(persistTimeoutId);
      persistTimeoutId = null;
    }
    if (
      persistIdleId !== null &&
      typeof window.cancelIdleCallback === "function"
    ) {
      window.cancelIdleCallback(persistIdleId);
      persistIdleId = null;
    }
  }

  function flushSettingsPersist() {
    clearScheduledPersist();
    persistSettingsDraft(settings.value);
  }

  function clearCharFlowRefreshTimer() {
    if (charFlowRefreshTimer !== null) {
      window.clearInterval(charFlowRefreshTimer);
      charFlowRefreshTimer = null;
    }
  }

  function isCharacterFlowPanelActive() {
    return (
      settings.value.ui_open &&
      activeTab.value === "flows" &&
      flowScope.value === "character"
    );
  }

  function scheduleCharFlowRefreshWatch() {
    clearCharFlowRefreshTimer();

    if (!isCharacterFlowPanelActive()) {
      return;
    }

    charFlowRefreshTimer = window.setInterval(() => {
      if (!isCharacterFlowPanelActive() || charFlowsLoading.value) {
        return;
      }

      const currentName = (getCurrentCharacterName?.() ?? "").trim();
      const loadedName = activeCharName.value.trim();
      if (currentName !== loadedName) {
        void loadCharFlows();
      }
    }, 900);
  }

  function scheduleSettingsPersist() {
    clearScheduledPersist();

    const runPersist = () => {
      persistTimeoutId = null;
      persistIdleId = null;
      flushSettingsPersist();
    };

    if (typeof window.requestIdleCallback === "function") {
      persistIdleId = window.requestIdleCallback(runPersist, { timeout: 320 });
      return;
    }

    persistTimeoutId = window.setTimeout(runPersist, 180);
  }

  const syncFromRuntime = subscribeSettings((next) => {
    suppressPersist = true;
    if (!_.isEqual(settings.value, next)) {
      settings.value = next;
    }
    queueMicrotask(() => {
      suppressPersist = false;
    });
  });

  const syncRun = subscribeLastRun((next) => {
    const currentChatId = getCurrentChatIdSafe();
    if (
      !currentChatId ||
      !next?.chat_id ||
      next.chat_id.trim() === currentChatId
    ) {
      lastRun.value = next;
    }
  });
  const syncIo = subscribeLastIo((next) => {
    const currentChatId = getCurrentChatIdSafe();
    if (
      !currentChatId ||
      !next?.chat_id ||
      next.chat_id.trim() === currentChatId
    ) {
      lastIo.value = next;
    }
  });

  onScopeDispose(() => {
    syncFromRuntime.stop();
    syncRun.stop();
    syncIo.stop();
    clearScheduledPersist();
    clearCharFlowRefreshTimer();
  });

  watch(
    settings,
    () => {
      if (suppressPersist) {
        return;
      }
      scheduleSettingsPersist();
    },
    { deep: true, flush: "post" },
  );

  watch(
    () => settings.value.api_presets.map((preset) => preset.id),
    (presetIds) => {
      if (
        expandedApiPresetId.value &&
        !presetIds.includes(expandedApiPresetId.value)
      ) {
        expandedApiPresetId.value = null;
      }
    },
  );

  watch(
    () => settings.value.flows.map((flow) => flow.id),
    (flowIds) => {
      if (expandedFlowId.value && !flowIds.includes(expandedFlowId.value)) {
        expandedFlowId.value = null;
      }
    },
  );

  watch(
    charFlows,
    (next) => {
      if (suppressCharFlowDraftPersist || charFlowsLoading.value) {
        return;
      }
      if (flowScope.value !== "character") {
        return;
      }
      if (!activeCharName.value.trim()) {
        return;
      }
      writeCharFlowDraft(activeCharName.value, next);
    },
    { deep: true, flush: "post" },
  );

  watch(
    () => [settings.value.ui_open, activeTab.value, flowScope.value] as const,
    (nextState, previous) => {
      const [uiOpen, tab, scope] = nextState;
      const [prevUiOpen, prevTab, prevScope] = previous ?? [
        undefined,
        undefined,
        undefined,
      ];
      scheduleCharFlowRefreshWatch();

      if (
        uiOpen &&
        (tab === "debug" || tab === "workbench") &&
        (!prevUiOpen || prevTab !== tab)
      ) {
        refreshDebugRecords({ silent: true });
      }

      if (!uiOpen || tab !== "flows" || scope !== "character") {
        return;
      }

      if (!prevUiOpen || prevTab !== "flows" || prevScope !== "character") {
        void loadCharFlows();
      }
    },
    { immediate: true },
  );

  const graphRunPhases: GraphRunPhase[] = [
    "queued",
    "validating",
    "compiling",
    "executing",
    "blocked",
    "finishing",
    "terminal",
  ];

  const graphRunTerminalOutcomes: GraphRunTerminalOutcome[] = [
    "completed",
    "failed",
    "cancelled",
  ];

  function toBlockingReason(
    value: unknown,
  ): GraphRunBlockingReason | undefined {
    if (!_.isPlainObject(value)) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const category =
      record.category === "waiting_user" ||
      record.category === "cancellation" ||
      record.category === "unknown"
        ? record.category
        : undefined;
    const code =
      record.code === "waiting_user" ||
      record.code === "cancelling" ||
      record.code === "unknown"
        ? record.code
        : undefined;
    const label =
      typeof record.label === "string" && record.label.trim()
        ? record.label.trim()
        : undefined;
    if (!category || !code || !label) {
      return undefined;
    }
    return {
      category,
      code,
      label,
      detail:
        typeof record.detail === "string" && record.detail.trim()
          ? record.detail.trim()
          : undefined,
    };
  }

  function toBlockingInputRequirementType(
    value: unknown,
  ): GraphRunBlockingInputRequirementType {
    return value === "confirmation" ||
      value === "text_input" ||
      value === "selection" ||
      value === "unknown"
      ? value
      : "unknown";
  }

  function toRecoveryEligibility(
    value: unknown,
  ): GraphRunRecoveryEligibilityFact | undefined {
    if (!_.isPlainObject(value)) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const status =
      record.status === "eligible" ||
      record.status === "ineligible" ||
      record.status === "unknown"
        ? record.status
        : undefined;
    const source =
      record.source === "waiting_user" ||
      record.source === "checkpoint_candidate" ||
      record.source === "terminal_state" ||
      record.source === "status" ||
      record.source === "unknown"
        ? record.source
        : undefined;
    const label =
      typeof record.label === "string" && record.label.trim()
        ? record.label.trim()
        : undefined;
    if (!status || !source || !label) {
      return undefined;
    }
    return {
      status,
      source,
      label,
      detail:
        typeof record.detail === "string" && record.detail.trim()
          ? record.detail.trim()
          : undefined,
    };
  }

  function toBlockingContract(
    value: unknown,
  ): GraphRunBlockingContract | undefined {
    if (!_.isPlainObject(value)) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const kind =
      record.kind === "waiting_user" ||
      record.kind === "cancellation" ||
      record.kind === "unknown"
        ? record.kind
        : undefined;
    const reason = toBlockingReason(record.reason);
    const inputRequirement = _.isPlainObject(record.inputRequirement)
      ? (record.inputRequirement as Record<string, unknown>)
      : null;
    if (!kind || !reason || !inputRequirement) {
      return undefined;
    }
    return {
      kind,
      reason,
      requiresHumanInput: record.requiresHumanInput === true,
      inputRequirement: {
        required: inputRequirement.required === true,
        type: toBlockingInputRequirementType(inputRequirement.type),
        detail:
          typeof inputRequirement.detail === "string" &&
          inputRequirement.detail.trim()
            ? inputRequirement.detail.trim()
            : undefined,
      },
      recoveryPrerequisites: Array.isArray(record.recoveryPrerequisites)
        ? record.recoveryPrerequisites
            .filter((item): item is Record<string, unknown> =>
              _.isPlainObject(item),
            )
            .map((item) => {
              const source =
                item.source === "waiting_user" ||
                item.source === "checkpoint_candidate" ||
                item.source === "terminal_state" ||
                item.source === "status" ||
                item.source === "unknown"
                  ? item.source
                  : "unknown";
              const code =
                item.code === "user_input_required" ||
                item.code === "checkpoint_observed" ||
                item.code === "run_not_terminal" ||
                item.code === "terminal_state" ||
                item.code === "unknown"
                  ? item.code
                  : "unknown";
              const label =
                typeof item.label === "string" && item.label.trim()
                  ? item.label.trim()
                  : "恢复前提未知";
              return {
                source,
                code,
                label,
                detail:
                  typeof item.detail === "string" && item.detail.trim()
                    ? item.detail.trim()
                    : undefined,
              };
            })
        : [
            {
              source: "unknown",
              code: "unknown",
              label: "恢复前提未知",
            },
          ],
    };
  }

  function toGraphDiagnosticsOverview(
    diagnostics: unknown,
  ): GraphRunDiagnosticsOverview | null {
    if (!_.isPlainObject(diagnostics)) {
      return null;
    }

    const diagnosticsRecord = diagnostics as Record<string, unknown>;
    const bridge = _.isPlainObject(diagnosticsRecord.bridge)
      ? (diagnosticsRecord.bridge as Record<string, unknown>)
      : null;
    const graph = _.isPlainObject(diagnosticsRecord.graph)
      ? (diagnosticsRecord.graph as Record<string, unknown>)
      : null;
    const graphOverview = graph?.overview;
    const bridgeOverview = bridge?.graph_run_overview;
    const bridgeDiagnosticsOverview = _.isPlainObject(
      bridge?.graph_run_diagnostics,
    )
      ? (bridge?.graph_run_diagnostics as Record<string, unknown>)
      : null;
    const bridgeNodeDiagnostics = Array.isArray(bridge?.graph_node_diagnostics)
      ? bridge.graph_node_diagnostics
      : null;
    const overview = _.isPlainObject(graphOverview)
      ? (graphOverview as Record<string, unknown>)
      : _.isPlainObject(bridgeDiagnosticsOverview)
        ? (bridgeDiagnosticsOverview as Record<string, unknown>)
        : _.isPlainObject(bridgeOverview)
          ? (bridgeOverview as Record<string, unknown>)
          : null;

    if (!overview || !_.isPlainObject(overview.run)) {
      return null;
    }

    const run = overview.run as Record<string, unknown>;
    const compile = _.isPlainObject(overview.compile)
      ? (overview.compile as Record<string, unknown>)
      : {};
    const dirty = _.isPlainObject(overview.dirty)
      ? (overview.dirty as Record<string, unknown>)
      : null;
    const reasonCountsRaw = _.isPlainObject(dirty?.reasonCounts)
      ? (dirty?.reasonCounts as Record<string, unknown>)
      : {};
    const reuse = _.isPlainObject(overview.reuse)
      ? (overview.reuse as Record<string, unknown>)
      : null;
    const executionDecision = _.isPlainObject(overview.executionDecision)
      ? (overview.executionDecision as Record<string, unknown>)
      : null;
    const verdictCountsRaw = _.isPlainObject(reuse?.verdictCounts)
      ? (reuse?.verdictCounts as Record<string, unknown>)
      : {};
    const decisionCountsRaw = _.isPlainObject(executionDecision?.decisionCounts)
      ? (executionDecision?.decisionCounts as Record<string, unknown>)
      : {};

    const normalizeCount = (value: unknown): number => {
      const num = Number(value);
      return Number.isFinite(num) && num >= 0 ? Math.trunc(num) : 0;
    };

    const normalizeReasonCount = <Reason extends string>(
      raw: Record<string, unknown>,
      reason: Reason,
    ): number => normalizeCount(raw[reason]);

    const graphRunStatuses: GraphRunStatus[] = [
      "queued",
      "running",
      "streaming",
      "waiting_user",
      "cancelling",
      "cancelled",
      "failed",
      "completed",
    ];
    const runStatus = graphRunStatuses.includes(run.status as GraphRunStatus)
      ? (run.status as GraphRunStatus)
      : "completed";
    const failedStage =
      run.failedStage === "validate" ||
      run.failedStage === "compile" ||
      run.failedStage === "execute"
        ? (run.failedStage as GraphExecutionStage)
        : undefined;
    const compileFingerprint =
      typeof compile.compileFingerprint === "string" &&
      compile.compileFingerprint.trim()
        ? compile.compileFingerprint.trim()
        : typeof run.compileFingerprint === "string" &&
            run.compileFingerprint.trim()
          ? run.compileFingerprint.trim()
          : undefined;

    const phase = graphRunPhases.includes(run.phase as GraphRunPhase)
      ? (run.phase as GraphRunPhase)
      : runStatus === "completed" ||
          runStatus === "failed" ||
          runStatus === "cancelled"
        ? "terminal"
        : runStatus === "queued"
          ? "queued"
          : runStatus === "waiting_user" || runStatus === "cancelling"
            ? "blocked"
            : runStatus === "running" && failedStage === "validate"
              ? "validating"
              : runStatus === "running" && failedStage === "compile"
                ? "compiling"
                : "executing";
    const phaseLabel =
      typeof run.phaseLabel === "string" && run.phaseLabel.trim()
        ? run.phaseLabel.trim()
        : phase === "terminal"
          ? "已结束"
          : "运行中";
    const terminalOutcome = graphRunTerminalOutcomes.includes(
      run.terminalOutcome as GraphRunTerminalOutcome,
    )
      ? (run.terminalOutcome as GraphRunTerminalOutcome)
      : runStatus === "completed" ||
          runStatus === "failed" ||
          runStatus === "cancelled"
        ? runStatus
        : undefined;
    const blockingReason = toBlockingReason(run.blockingReason);

    const toNodeDiagnostics = (value: unknown): GraphNodeDiagnosticsView[] => {
      if (!Array.isArray(value)) {
        return [];
      }
      return value
        .filter((item): item is Record<string, unknown> =>
          _.isPlainObject(item),
        )
        .map((item): GraphNodeDiagnosticsView => {
          const reuseVerdict = _.isPlainObject(item.reuseVerdict)
            ? (item.reuseVerdict as Record<string, unknown>)
            : null;
          const executionDecision = _.isPlainObject(item.executionDecision)
            ? (item.executionDecision as Record<string, unknown>)
            : null;
          const cacheKey = _.isPlainObject(item.cacheKey)
            ? (item.cacheKey as Record<string, unknown>)
            : null;
          const inputSources = Array.isArray(item.inputSources)
            ? item.inputSources
                .filter((source): source is Record<string, unknown> =>
                  _.isPlainObject(source),
                )
                .map((source) => ({
                  sourceNodeId:
                    typeof source.sourceNodeId === "string"
                      ? source.sourceNodeId.trim()
                      : "",
                  sourcePort:
                    typeof source.sourcePort === "string"
                      ? source.sourcePort.trim()
                      : "",
                  targetPort:
                    typeof source.targetPort === "string"
                      ? source.targetPort.trim()
                      : "",
                }))
                .filter(
                  (source) =>
                    source.sourceNodeId &&
                    source.sourcePort &&
                    source.targetPort,
                )
            : [];
          const dirtyReason: GraphNodeDiagnosticsView["dirtyReason"] =
            item.dirtyReason === "initial_run" ||
            item.dirtyReason === "input_changed" ||
            item.dirtyReason === "upstream_dirty" ||
            item.dirtyReason === "clean"
              ? item.dirtyReason
              : undefined;
          const reuseReason =
            reuseVerdict?.reason === "eligible" ||
            reuseVerdict?.reason === "ineligible_dirty" ||
            reuseVerdict?.reason === "ineligible_side_effect" ||
            reuseVerdict?.reason === "ineligible_capability" ||
            reuseVerdict?.reason === "ineligible_missing_baseline"
              ? reuseVerdict.reason
              : "ineligible_missing_baseline";
          const executionReason =
            executionDecision?.reason === "feature_disabled" ||
            executionDecision?.reason === "ineligible_reuse_verdict" ||
            executionDecision?.reason === "ineligible_capability" ||
            executionDecision?.reason === "ineligible_side_effect" ||
            executionDecision?.reason === "ineligible_source" ||
            executionDecision?.reason === "ineligible_terminal" ||
            executionDecision?.reason === "ineligible_fallback" ||
            executionDecision?.reason === "missing_baseline" ||
            executionDecision?.reason === "missing_reusable_outputs" ||
            executionDecision?.reason === "execute" ||
            executionDecision?.reason === "skip_reuse_outputs"
              ? executionDecision.reason
              : "execute";
          return {
            nodeId: typeof item.nodeId === "string" ? item.nodeId.trim() : "",
            moduleId:
              typeof item.moduleId === "string" ? item.moduleId.trim() : "",
            title:
              typeof item.title === "string" && item.title.trim()
                ? item.title.trim()
                : undefined,
            dirtyReason,
            reuseVerdict: reuseVerdict
              ? {
                  canReuse: reuseVerdict.canReuse === true,
                  reason: reuseReason,
                }
              : undefined,
            executionDecision: executionDecision
              ? {
                  shouldExecute: executionDecision.shouldExecute === true,
                  shouldSkip: executionDecision.shouldSkip === true,
                  reason: executionReason,
                  reusableOutputHit:
                    executionDecision.reusableOutputHit === true,
                }
              : undefined,
            inputSources,
            cacheKey: cacheKey
              ? {
                  compileFingerprint:
                    typeof cacheKey.compileFingerprint === "string" &&
                    cacheKey.compileFingerprint.trim()
                      ? cacheKey.compileFingerprint.trim()
                      : undefined,
                  nodeFingerprint:
                    typeof cacheKey.nodeFingerprint === "string" &&
                    cacheKey.nodeFingerprint.trim()
                      ? cacheKey.nodeFingerprint.trim()
                      : undefined,
                  inputFingerprint:
                    typeof cacheKey.inputFingerprint === "string" &&
                    cacheKey.inputFingerprint.trim()
                      ? cacheKey.inputFingerprint.trim()
                      : undefined,
                  fingerprintVersion:
                    Number(cacheKey.fingerprintVersion) === 1 ? 1 : undefined,
                }
              : undefined,
            reusableOutputsHit: item.reusableOutputsHit === true,
            skipReuseOutputsHit: item.skipReuseOutputsHit === true,
          };
        })
        .filter((item) => item.nodeId && item.moduleId);
    };

    return {
      run: {
        runId: typeof run.runId === "string" ? run.runId : "",
        status: runStatus,
        phase,
        phaseLabel,
        ...(blockingReason ? { blockingReason } : {}),
        controlPreconditionsContract: {
          items: [],
          nonContinuableReasonKind: "unknown",
          explanation: "读侧缺少控制前提契约字段，已降级为空的只读约束解释。",
        },
        constraintSummary: {
          heading: "控制前提说明（只读）",
          explanation: "当前工作台展示的是只读约束解释层。",
          disclaimer: "它不是恢复承诺。",
          capabilityBoundary: "它不表示控制动作能力已经存在。",
        },
        ...(terminalOutcome ? { terminalOutcome } : {}),
        ...(failedStage ? { failedStage } : {}),
        startedAt: normalizeCount(run.startedAt),
        completedAt: normalizeCount(run.completedAt),
        elapsedMs: normalizeCount(run.elapsedMs),
        ...(compileFingerprint ? { compileFingerprint } : {}),
      },
      compile: {
        ...(compileFingerprint ? { compileFingerprint } : {}),
        nodeCount:
          compile.nodeCount === undefined
            ? undefined
            : normalizeCount(compile.nodeCount),
        terminalNodeCount:
          compile.terminalNodeCount === undefined
            ? undefined
            : normalizeCount(compile.terminalNodeCount),
      },
      dirty: {
        totalNodeCount: normalizeCount(dirty?.totalNodeCount),
        dirtyNodeCount: normalizeCount(dirty?.dirtyNodeCount),
        cleanNodeCount: normalizeCount(dirty?.cleanNodeCount),
        dirtyNodeIds: Array.isArray(dirty?.dirtyNodeIds)
          ? dirty!.dirtyNodeIds
              .filter((value): value is string => typeof value === "string")
              .map((value) => value.trim())
              .filter(Boolean)
          : [],
        cleanNodeIds: Array.isArray(dirty?.cleanNodeIds)
          ? dirty!.cleanNodeIds
              .filter((value): value is string => typeof value === "string")
              .map((value) => value.trim())
              .filter(Boolean)
          : [],
        reasonCounts: {
          initial_run: normalizeReasonCount(reasonCountsRaw, "initial_run"),
          input_changed: normalizeReasonCount(reasonCountsRaw, "input_changed"),
          upstream_dirty: normalizeReasonCount(
            reasonCountsRaw,
            "upstream_dirty",
          ),
          clean: normalizeReasonCount(reasonCountsRaw, "clean"),
        },
      },
      ...(reuse
        ? {
            reuse: {
              eligibleNodeCount: normalizeCount(reuse.eligibleNodeCount),
              ineligibleNodeCount: normalizeCount(reuse.ineligibleNodeCount),
              eligibleNodeIds: Array.isArray(reuse.eligibleNodeIds)
                ? reuse.eligibleNodeIds
                    .filter(
                      (value): value is string => typeof value === "string",
                    )
                    .map((value) => value.trim())
                    .filter(Boolean)
                : [],
              ineligibleNodeIds: Array.isArray(reuse.ineligibleNodeIds)
                ? reuse.ineligibleNodeIds
                    .filter(
                      (value): value is string => typeof value === "string",
                    )
                    .map((value) => value.trim())
                    .filter(Boolean)
                : [],
              verdictCounts: {
                eligible: normalizeReasonCount(verdictCountsRaw, "eligible"),
                ineligible_dirty: normalizeReasonCount(
                  verdictCountsRaw,
                  "ineligible_dirty",
                ),
                ineligible_side_effect: normalizeReasonCount(
                  verdictCountsRaw,
                  "ineligible_side_effect",
                ),
                ineligible_capability: normalizeReasonCount(
                  verdictCountsRaw,
                  "ineligible_capability",
                ),
                ineligible_missing_baseline: normalizeReasonCount(
                  verdictCountsRaw,
                  "ineligible_missing_baseline",
                ),
              },
            },
          }
        : {}),
      ...(executionDecision
        ? {
            executionDecision: {
              featureEnabled: executionDecision.featureEnabled === true,
              skippedNodeCount: normalizeCount(
                executionDecision.skippedNodeCount,
              ),
              executedNodeCount: normalizeCount(
                executionDecision.executedNodeCount,
              ),
              skippedNodeIds: Array.isArray(executionDecision.skippedNodeIds)
                ? executionDecision.skippedNodeIds
                    .filter(
                      (value): value is string => typeof value === "string",
                    )
                    .map((value) => value.trim())
                    .filter(Boolean)
                : [],
              executedNodeIds: Array.isArray(executionDecision.executedNodeIds)
                ? executionDecision.executedNodeIds
                    .filter(
                      (value): value is string => typeof value === "string",
                    )
                    .map((value) => value.trim())
                    .filter(Boolean)
                : [],
              skipReuseOutputNodeIds: Array.isArray(
                executionDecision.skipReuseOutputNodeIds,
              )
                ? executionDecision.skipReuseOutputNodeIds
                    .filter(
                      (value): value is string => typeof value === "string",
                    )
                    .map((value) => value.trim())
                    .filter(Boolean)
                : [],
              decisionCounts: {
                feature_disabled: normalizeReasonCount(
                  decisionCountsRaw,
                  "feature_disabled",
                ),
                ineligible_reuse_verdict: normalizeReasonCount(
                  decisionCountsRaw,
                  "ineligible_reuse_verdict",
                ),
                ineligible_capability: normalizeReasonCount(
                  decisionCountsRaw,
                  "ineligible_capability",
                ),
                ineligible_side_effect: normalizeReasonCount(
                  decisionCountsRaw,
                  "ineligible_side_effect",
                ),
                ineligible_source: normalizeReasonCount(
                  decisionCountsRaw,
                  "ineligible_source",
                ),
                ineligible_terminal: normalizeReasonCount(
                  decisionCountsRaw,
                  "ineligible_terminal",
                ),
                ineligible_fallback: normalizeReasonCount(
                  decisionCountsRaw,
                  "ineligible_fallback",
                ),
                missing_baseline: normalizeReasonCount(
                  decisionCountsRaw,
                  "missing_baseline",
                ),
                missing_reusable_outputs: normalizeReasonCount(
                  decisionCountsRaw,
                  "missing_reusable_outputs",
                ),
                execute: normalizeReasonCount(decisionCountsRaw, "execute"),
                skip_reuse_outputs: normalizeReasonCount(
                  decisionCountsRaw,
                  "skip_reuse_outputs",
                ),
              },
            },
          }
        : {}),
      nodeDiagnostics: toNodeDiagnostics(
        overview.nodeDiagnostics ?? bridgeNodeDiagnostics,
      ),
    };
  }

  function toDiagnosticsSummaryViewModel(
    overview: GraphRunDiagnosticsOverview | null,
  ): GraphRunDiagnosticsSummaryViewModel | null {
    if (!overview) {
      return null;
    }

    const compileFingerprint = overview.compile.compileFingerprint?.trim();
    const fingerprintShort = compileFingerprint
      ? compileFingerprint.length > 12
        ? `${compileFingerprint.slice(0, 6)}…${compileFingerprint.slice(-4)}`
        : compileFingerprint
      : "—";
    const dirtyReasonLabels: Record<GraphNodeDirtyReason, string> = {
      initial_run: "初次运行",
      input_changed: "输入变化",
      upstream_dirty: "上游脏",
      clean: "干净",
    };
    const reuseReasonLabels: Record<GraphNodeReuseReason, string> = {
      eligible: "可复用",
      ineligible_dirty: "输入不干净",
      ineligible_side_effect: "存在副作用",
      ineligible_capability: "能力不满足",
      ineligible_missing_baseline: "缺少基线",
    };
    const executionDecisionLabels: Record<
      GraphNodeExecutionDecisionReason,
      string
    > = {
      feature_disabled: "实验开关关闭",
      ineligible_reuse_verdict: "复用判定未通过",
      ineligible_capability: "能力不满足",
      ineligible_side_effect: "存在副作用",
      ineligible_source: "source 节点不参与",
      ineligible_terminal: "terminal 节点不参与",
      ineligible_fallback: "fallback 节点不参与",
      missing_baseline: "缺少基线",
      missing_reusable_outputs: "缺少可复用输出",
      execute: "正常执行",
      skip_reuse_outputs: "命中 skip_reuse_outputs",
    };
    const primaryDirtyReasons = (
      Object.entries(overview.dirty.reasonCounts) as Array<
        [GraphNodeDirtyReason, number]
      >
    )
      .filter(([reason, count]) => reason !== "clean" && count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason, count]) => ({
        reason,
        label: dirtyReasonLabels[reason],
        count,
      }));
    const primaryReuseReasons = overview.reuse
      ? ((
          Object.entries(overview.reuse.verdictCounts) as Array<
            [GraphNodeReuseReason, number]
          >
        )
          .filter(([reason, count]) => reason !== "eligible" && count > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([reason, count]) => ({
            reason,
            label: reuseReasonLabels[reason],
            count,
          })) as GraphRunDiagnosticsSummaryViewModel["primaryReuseReasons"])
      : [];
    const primaryExecutionDecisionReasons = overview.executionDecision
      ? ((
          Object.entries(overview.executionDecision.decisionCounts) as Array<
            [GraphNodeExecutionDecisionReason, number]
          >
        )
          .filter(([reason, count]) => reason !== "execute" && count > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([reason, count]) => ({
            reason,
            label: executionDecisionLabels[reason],
            count,
          })) as GraphRunDiagnosticsSummaryViewModel["primaryExecutionDecisionReasons"])
      : [];

    return {
      runStatus: overview.run.status,
      runStatusLabel:
        overview.run.status === "completed"
          ? "最近运行成功"
          : overview.run.status === "failed"
            ? `最近运行失败${overview.run.failedStage ? ` · ${overview.run.failedStage}` : ""}`
            : overview.run.status === "cancelled"
              ? "最近运行已取消"
              : `最近运行中 · ${overview.run.status}`,
      compileFingerprint,
      compileFingerprintShort: fingerprintShort,
      nodeCount: overview.compile.nodeCount ?? overview.dirty.totalNodeCount,
      terminalNodeCount: overview.compile.terminalNodeCount ?? 0,
      dirtyNodeCount: overview.dirty.dirtyNodeCount,
      cleanNodeCount: overview.dirty.cleanNodeCount,
      primaryDirtyReasons,
      reuseEligibleNodeCount: overview.reuse?.eligibleNodeCount ?? 0,
      reuseIneligibleNodeCount: overview.reuse?.ineligibleNodeCount ?? 0,
      skipReuseOutputHitCount:
        overview.executionDecision?.skipReuseOutputNodeIds.length ?? 0,
      primaryReuseReasons,
      primaryExecutionDecisionReasons,
    };
  }

  function toControlPreconditionsContract(
    value: unknown,
  ): GraphRunControlPreconditionsContract | undefined {
    if (!_.isPlainObject(value)) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const items = Array.isArray(record.items)
      ? record.items
          .filter((item): item is Record<string, unknown> =>
            _.isPlainObject(item),
          )
          .map(
            (item): GraphRunControlPreconditionItem => ({
              kind:
                item.kind === "external_input_observed" ||
                item.kind === "checkpoint_candidate_observed" ||
                item.kind === "run_not_terminal" ||
                item.kind === "continuation_capability_inference" ||
                item.kind === "control_action_surface_inference" ||
                item.kind === "unknown"
                  ? item.kind
                  : "unknown",
              status:
                item.status === "satisfied" ||
                item.status === "unsatisfied" ||
                item.status === "unknown"
                  ? item.status
                  : "unknown",
              label:
                typeof item.label === "string" && item.label.trim()
                  ? item.label.trim()
                  : "控制前提未知",
              detail:
                typeof item.detail === "string" && item.detail.trim()
                  ? item.detail.trim()
                  : undefined,
              sourceKind:
                item.sourceKind === "observed" ||
                item.sourceKind === "inferred" ||
                item.sourceKind === "host_limited"
                  ? item.sourceKind
                  : "inferred",
              conservativeSourceKind:
                item.conservativeSourceKind === "observed" ||
                item.conservativeSourceKind === "inferred" ||
                item.conservativeSourceKind === "host_limited"
                  ? item.conservativeSourceKind
                  : "inferred",
            }),
          )
      : [];
    const nonContinuableReasonKind: GraphRunNonContinuableReasonKind =
      record.nonContinuableReasonKind === "terminal_completed" ||
      record.nonContinuableReasonKind === "terminal_failed" ||
      record.nonContinuableReasonKind === "terminal_cancelled" ||
      record.nonContinuableReasonKind ===
        "continuation_capability_not_inferred" ||
      record.nonContinuableReasonKind ===
        "control_action_surface_not_inferred" ||
      record.nonContinuableReasonKind === "external_input_still_required" ||
      record.nonContinuableReasonKind === "checkpoint_not_observed" ||
      record.nonContinuableReasonKind === "insufficient_evidence" ||
      record.nonContinuableReasonKind === "unknown"
        ? record.nonContinuableReasonKind
        : "unknown";
    return {
      items,
      nonContinuableReasonKind,
      explanation:
        typeof record.explanation === "string" && record.explanation.trim()
          ? record.explanation.trim()
          : "当前仅提供控制前提的只读解释，缺少稳定字段时已保守降级。",
    };
  }

  function toConstraintSummary(
    value: unknown,
  ): GraphRunConstraintSummaryViewModel | undefined {
    if (!_.isPlainObject(value)) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    return {
      heading:
        typeof record.heading === "string" && record.heading.trim()
          ? record.heading.trim()
          : "控制前提说明（只读）",
      explanation:
        typeof record.explanation === "string" && record.explanation.trim()
          ? record.explanation.trim()
          : "当前工作台展示的是只读约束解释层。",
      disclaimer:
        typeof record.disclaimer === "string" && record.disclaimer.trim()
          ? record.disclaimer.trim()
          : "它不是恢复承诺。",
      capabilityBoundary:
        typeof record.capabilityBoundary === "string" &&
        record.capabilityBoundary.trim()
          ? record.capabilityBoundary.trim()
          : "它不表示控制动作能力已经存在。",
    };
  }

  function toActiveGraphCompileArtifact(
    diagnostics: unknown,
  ): GraphCompileArtifactV1 | null {
    return readGraphCompileArtifactEnvelope(diagnostics)?.artifact ?? null;
  }

  function toActiveGraphNodeInputResolutionArtifact(
    diagnostics: unknown,
  ): GraphNodeInputResolutionArtifactV1 | null {
    return (
      readGraphNodeInputResolutionArtifactEnvelope(diagnostics)?.artifact ??
      null
    );
  }

  function toActiveGraphSchedulingExplainArtifact(
    diagnostics: unknown,
  ): GraphSchedulingExplainArtifactV1 | null {
    return (
      readGraphSchedulingExplainArtifactEnvelope(diagnostics)?.artifact ?? null
    );
  }

  function toActiveGraphCompileRunLinkArtifact(
    diagnostics: unknown,
  ): GraphCompileRunLinkArtifactV1 | null {
    return (
      readGraphCompileRunLinkArtifactEnvelope(diagnostics)?.artifact ?? null
    );
  }

  function toActiveGraphFailureExplainArtifact(
    diagnostics: unknown,
  ): GraphFailureExplainArtifactV1 | null {
    return (
      readGraphFailureExplainArtifactEnvelope(diagnostics)?.artifact ?? null
    );
  }

  function toActiveGraphOutputExplainArtifact(
    diagnostics: unknown,
  ): GraphOutputExplainArtifactV1 | null {
    return (
      readGraphOutputExplainArtifactEnvelope(diagnostics)?.artifact ?? null
    );
  }

  function toActiveGraphHostEffectExplainArtifact(
    diagnostics: unknown,
  ): GraphHostEffectExplainArtifactV1 | null {
    return (
      readGraphHostEffectExplainArtifactEnvelope(diagnostics)?.artifact ?? null
    );
  }

  function toActiveGraphReuseExplainArtifact(
    diagnostics: unknown,
  ): GraphReuseExplainArtifactV1 | null {
    return readGraphReuseExplainArtifactEnvelope(diagnostics)?.artifact ?? null;
  }

  function toActiveGraphTerminalOutcomeExplainArtifact(
    diagnostics: unknown,
  ): GraphTerminalOutcomeExplainArtifactV1 | null {
    return (
      readGraphTerminalOutcomeExplainArtifactEnvelope(diagnostics)?.artifact ??
      null
    );
  }

  function toActiveGraphBlockingExplainArtifact(
    diagnostics: unknown,
  ): GraphBlockingExplainArtifactV1 | null {
    return (
      readGraphBlockingExplainArtifactEnvelope(diagnostics)?.artifact ?? null
    );
  }

  function toActiveGraphRunArtifact(
    diagnostics: unknown,
  ): GraphRunArtifact | null {
    const snapshot = readGraphRunSnapshotEnvelope(diagnostics);
    const artifact = snapshot?.snapshot.overview;
    if (!artifact) {
      return null;
    }
    const updatedAt = Number(artifact.updatedAt);
    const eventCount = Number(artifact.eventCount);
    const toHeartbeatSummary = (
      value: unknown,
    ): GraphRunHeartbeatSummary | undefined => {
      if (!_.isPlainObject(value)) {
        return undefined;
      }
      const record = value as Record<string, unknown>;
      const timestamp = Number(record.timestamp);
      return {
        timestamp: Number.isFinite(timestamp)
          ? Math.max(0, Math.trunc(timestamp))
          : 0,
        nodeId: typeof record.nodeId === "string" ? record.nodeId : undefined,
        moduleId:
          typeof record.moduleId === "string" ? record.moduleId : undefined,
        nodeIndex: Number.isFinite(Number(record.nodeIndex))
          ? Math.max(0, Math.trunc(Number(record.nodeIndex)))
          : undefined,
        message:
          typeof record.message === "string" ? record.message : undefined,
      };
    };
    const toPartialOutputSummary = (
      value: unknown,
    ): GraphRunPartialOutputSummary | undefined => {
      if (!_.isPlainObject(value)) {
        return undefined;
      }
      const record = value as Record<string, unknown>;
      const timestamp = Number(record.timestamp);
      const length = Number(record.length);
      return {
        timestamp: Number.isFinite(timestamp)
          ? Math.max(0, Math.trunc(timestamp))
          : 0,
        nodeId: typeof record.nodeId === "string" ? record.nodeId : undefined,
        moduleId:
          typeof record.moduleId === "string" ? record.moduleId : undefined,
        nodeIndex: Number.isFinite(Number(record.nodeIndex))
          ? Math.max(0, Math.trunc(Number(record.nodeIndex)))
          : undefined,
        preview: typeof record.preview === "string" ? record.preview : "",
        length: Number.isFinite(length) ? Math.max(0, Math.trunc(length)) : 0,
      };
    };
    const toWaitingUserSummary = (
      value: unknown,
    ): GraphRunWaitingUserSummary | undefined => {
      if (!_.isPlainObject(value)) {
        return undefined;
      }
      const record = value as Record<string, unknown>;
      const timestamp = Number(record.timestamp);
      return {
        timestamp: Number.isFinite(timestamp)
          ? Math.max(0, Math.trunc(timestamp))
          : 0,
        nodeId: typeof record.nodeId === "string" ? record.nodeId : undefined,
        moduleId:
          typeof record.moduleId === "string" ? record.moduleId : undefined,
        nodeIndex: Number.isFinite(Number(record.nodeIndex))
          ? Math.max(0, Math.trunc(Number(record.nodeIndex)))
          : undefined,
        reason:
          typeof record.reason === "string" && record.reason.trim()
            ? record.reason.trim()
            : "waiting_user",
      };
    };
    const status =
      typeof artifact.status === "string"
        ? (artifact.status as GraphRunStatus)
        : "completed";
    const phase = graphRunPhases.includes(artifact.phase as GraphRunPhase)
      ? (artifact.phase as GraphRunPhase)
      : status === "completed" || status === "failed" || status === "cancelled"
        ? "terminal"
        : status === "queued"
          ? "queued"
          : status === "waiting_user" || status === "cancelling"
            ? "blocked"
            : "executing";
    const terminalOutcome = graphRunTerminalOutcomes.includes(
      artifact.terminalOutcome as GraphRunTerminalOutcome,
    )
      ? (artifact.terminalOutcome as GraphRunTerminalOutcome)
      : status === "completed" || status === "failed" || status === "cancelled"
        ? status
        : undefined;
    const blockingReason = toBlockingReason(artifact.blockingReason);
    const phaseLabels: Record<GraphRunPhase, string> = {
      queued: "排队中",
      validating: "校验中",
      compiling: "编译中",
      executing: "执行中",
      blocked: "阻塞中",
      finishing: "收束中",
      terminal: "已结束",
    };
    const terminalOutcomeLabels: Record<GraphRunTerminalOutcome, string> = {
      completed: "已完成",
      failed: "已失败",
      cancelled: "已取消",
    };

    const blockingContract = toBlockingContract(artifact.blockingContract);
    const continuationContract = _.isPlainObject(artifact.continuationContract)
      ? (artifact.continuationContract as GraphRunArtifact["continuationContract"])
      : undefined;
    const controlPreconditionsContract = toControlPreconditionsContract(
      artifact.controlPreconditionsContract,
    ) ?? {
      items: [],
      nonContinuableReasonKind: "unknown",
      explanation: "读侧缺少控制前提契约字段，已回退到保守 unknown。",
    };
    const constraintSummary = toConstraintSummary(
      artifact.constraintSummary,
    ) ?? {
      heading: "控制前提说明（只读）",
      explanation: "当前工作台展示的是只读约束解释层。",
      disclaimer: "它不是恢复承诺。",
      capabilityBoundary: "它不表示控制动作能力已经存在。",
    };
    const recoveryEligibility = toRecoveryEligibility(
      artifact.recoveryEligibility,
    ) ?? {
      status: "unknown",
      source: "unknown",
      label: "恢复资格未知",
      detail: "读侧缺少足够字段，已保守降级。",
    };

    return {
      runId: typeof artifact.runId === "string" ? artifact.runId : "",
      graphId: typeof artifact.graphId === "string" ? artifact.graphId : "",
      status,
      phase,
      phaseLabel:
        typeof artifact.phaseLabel === "string" && artifact.phaseLabel.trim()
          ? artifact.phaseLabel.trim()
          : (phaseLabels[phase] ?? "运行中"),
      ...(blockingReason ? { blockingReason } : {}),
      ...(blockingContract ? { blockingContract } : {}),
      ...(continuationContract ? { continuationContract } : {}),
      controlPreconditionsContract,
      constraintSummary,
      recoveryEligibility,
      ...(terminalOutcome ? { terminalOutcome } : {}),
      currentStage:
        artifact.currentStage === "validate" ||
        artifact.currentStage === "compile" ||
        artifact.currentStage === "execute"
          ? (artifact.currentStage as GraphExecutionStage)
          : undefined,
      failedStage:
        artifact.failedStage === "validate" ||
        artifact.failedStage === "compile" ||
        artifact.failedStage === "execute"
          ? (artifact.failedStage as GraphExecutionStage)
          : undefined,
      compileFingerprint:
        typeof artifact.compileFingerprint === "string"
          ? artifact.compileFingerprint
          : undefined,
      latestNodeId:
        typeof artifact.latestNodeId === "string"
          ? artifact.latestNodeId
          : undefined,
      latestNodeModuleId:
        typeof artifact.latestNodeModuleId === "string"
          ? artifact.latestNodeModuleId
          : undefined,
      latestNodeStatus:
        artifact.latestNodeStatus === "started" ||
        artifact.latestNodeStatus === "finished" ||
        artifact.latestNodeStatus === "failed" ||
        artifact.latestNodeStatus === "skipped"
          ? artifact.latestNodeStatus
          : undefined,
      diagnosticsOverview:
        toGraphDiagnosticsOverview({
          graph: {
            overview:
              snapshot?.snapshot.diagnosticsOverview ??
              artifact.diagnosticsOverview,
          },
          bridge: {
            graph_node_diagnostics: snapshot?.snapshot.nodeDiagnostics,
          },
        }) ?? undefined,
      errorSummary:
        typeof artifact.errorSummary === "string"
          ? artifact.errorSummary
          : undefined,
      checkpointCandidate: _.isPlainObject(artifact.checkpointCandidate)
        ? (artifact.checkpointCandidate as GraphRunArtifact["checkpointCandidate"])
        : undefined,
      latestHeartbeat: toHeartbeatSummary(artifact.latestHeartbeat),
      latestPartialOutput: toPartialOutputSummary(artifact.latestPartialOutput),
      waitingUser: toWaitingUserSummary(artifact.waitingUser),
      eventCount: Number.isFinite(eventCount)
        ? Math.max(0, Math.trunc(eventCount))
        : 0,
      updatedAt: Number.isFinite(updatedAt)
        ? Math.max(0, Math.trunc(updatedAt))
        : 0,
    };
  }

  function toCheckpointCandidateViewModel(
    candidate: GraphRunArtifact["checkpointCandidate"],
  ): GraphCheckpointCandidateViewModel | null {
    if (!candidate) {
      return null;
    }

    return {
      checkpointId: candidate.checkpointId,
      stage: candidate.stage,
      nodeId: candidate.nodeId,
      nodeIndex: candidate.nodeIndex,
      resumable: false,
      reason: candidate.reason,
      createdAt: candidate.createdAt,
    };
  }

  function toNodeDiagnosticsViewModel(
    overview: GraphRunDiagnosticsOverview | null,
    artifact: GraphRunArtifact | null,
  ): GraphNodeDiagnosticsViewModel | null {
    const selectedNodeId = artifact?.latestNodeId?.trim();
    if (!selectedNodeId) {
      return null;
    }
    const nodeDiagnostics = overview?.nodeDiagnostics?.find(
      (item) => item.nodeId === selectedNodeId,
    );
    if (!nodeDiagnostics) {
      return null;
    }

    const dirtyReasonLabels: Record<GraphNodeDirtyReason, string> = {
      initial_run: "初次运行",
      input_changed: "输入变化",
      upstream_dirty: "上游脏",
      clean: "干净",
    };
    const reuseReasonLabels: Record<GraphNodeReuseReason, string> = {
      eligible: "可复用",
      ineligible_dirty: "输入不干净",
      ineligible_side_effect: "存在副作用",
      ineligible_capability: "能力不满足",
      ineligible_missing_baseline: "缺少基线",
    };
    const executionDecisionLabels: Record<
      GraphNodeExecutionDecisionReason,
      string
    > = {
      feature_disabled: "实验开关关闭",
      ineligible_reuse_verdict: "复用判定未通过",
      ineligible_capability: "能力不满足",
      ineligible_side_effect: "存在副作用",
      ineligible_source: "source 节点不参与",
      ineligible_terminal: "terminal 节点不参与",
      ineligible_fallback: "fallback 节点不参与",
      missing_baseline: "缺少基线",
      missing_reusable_outputs: "缺少可复用输出",
      execute: "正常执行",
      skip_reuse_outputs: "命中 skip_reuse_outputs",
    };
    const fingerprintShort = (value?: string): string => {
      if (!value) {
        return "—";
      }
      return value.length > 12
        ? `${value.slice(0, 6)}…${value.slice(-4)}`
        : value;
    };

    return {
      nodeId: nodeDiagnostics.nodeId,
      title:
        nodeDiagnostics.title?.trim() ||
        getModuleExplainContract(nodeDiagnostics.moduleId)?.help?.summary ||
        nodeDiagnostics.moduleId,
      disclaimer: "这是运行事实与决策解释，不是缓存、跳过或恢复能力承诺。",
      dirtyReasonLabel: nodeDiagnostics.dirtyReason
        ? dirtyReasonLabels[nodeDiagnostics.dirtyReason]
        : "无 dirty 事实",
      reuseVerdictLabel: nodeDiagnostics.reuseVerdict
        ? `${nodeDiagnostics.reuseVerdict.canReuse ? "可复用" : "不可复用"} · ${reuseReasonLabels[nodeDiagnostics.reuseVerdict.reason]}`
        : "无 reuse 事实",
      executionDecisionLabel: nodeDiagnostics.executionDecision
        ? `${nodeDiagnostics.executionDecision.shouldSkip ? "跳过" : nodeDiagnostics.executionDecision.shouldExecute ? "执行" : "观察中"} · ${executionDecisionLabels[nodeDiagnostics.executionDecision.reason]}`
        : "无 execution decision 事实",
      inputSourcesSummary:
        nodeDiagnostics.inputSources.length > 0
          ? nodeDiagnostics.inputSources
              .map(
                (source) =>
                  `${source.targetPort} ← ${source.sourceNodeId}.${source.sourcePort}`,
              )
              .join("；")
          : "无上游输入源事实",
      cacheKeyFactsSummary: nodeDiagnostics.cacheKey
        ? [
            `compile ${fingerprintShort(nodeDiagnostics.cacheKey.compileFingerprint)}`,
            `node ${fingerprintShort(nodeDiagnostics.cacheKey.nodeFingerprint)}`,
            `input ${fingerprintShort(nodeDiagnostics.cacheKey.inputFingerprint)}`,
          ].join(" · ")
        : "无 cache key facts",
      reusableOutputsFactLabel: nodeDiagnostics.reusableOutputsHit
        ? "命中 reusable outputs"
        : "未命中 reusable outputs",
      skipReuseOutputsFactLabel: nodeDiagnostics.skipReuseOutputsHit
        ? "命中 skip_reuse_outputs"
        : "未命中 skip_reuse_outputs",
    };
  }

  function toActiveGraphRunSummaryViewModel(
    artifact: GraphRunArtifact | null,
    diagnosticsSummary: GraphRunDiagnosticsSummaryViewModel | null,
    nodeDiagnostics: GraphNodeDiagnosticsViewModel | null,
  ): GraphActiveRunSummaryViewModel | null {
    if (!artifact) {
      return null;
    }

    const stageLabels: Record<GraphExecutionStage, string> = {
      validate: "校验阶段",
      compile: "编译阶段",
      execute: "执行阶段",
    };
    const statusLabels: Record<GraphRunStatus, string> = {
      queued: "排队中",
      running: "运行中",
      streaming: "流式处理中",
      waiting_user: "等待用户",
      cancelling: "取消中",
      completed: "已完成",
      failed: "失败",
      cancelled: "已取消",
    };
    const latestNodeStatusLabels: Record<
      NonNullable<GraphRunArtifact["latestNodeStatus"]>,
      string
    > = {
      started: "节点执行中",
      finished: "节点已完成",
      failed: "节点失败",
      skipped: "节点已跳过",
    };
    const checkpointCandidate = toCheckpointCandidateViewModel(
      artifact.checkpointCandidate,
    );

    const phaseLabels: Record<GraphRunPhase, string> = {
      queued: "排队中",
      validating: "校验中",
      compiling: "编译中",
      executing: "执行中",
      blocked: "阻塞中",
      finishing: "收束中",
      terminal: "已结束",
    };
    const terminalOutcomeLabels: Record<GraphRunTerminalOutcome, string> = {
      completed: "已完成",
      failed: "已失败",
      cancelled: "已取消",
    };

    const blockingContract = artifact.blockingContract ?? null;
    const continuationContract = artifact.continuationContract ?? null;
    const controlPreconditionsContract =
      artifact.controlPreconditionsContract ?? null;
    const constraintSummary = artifact.constraintSummary ?? null;
    const inputType = blockingContract?.inputRequirement.type ?? "unknown";
    const inputRequirementTypeLabels: Record<
      GraphRunBlockingInputRequirementType,
      string
    > = {
      confirmation: "确认",
      text_input: "文本输入",
      selection: "选择",
      unknown: "未知",
    };
    const evidenceTrustLabels: Record<GraphRunRecoveryEvidenceTrust, string> = {
      strong: "高",
      limited: "中",
      weak: "低",
      unknown: "未知",
    };
    const blockingCategoryLabel = blockingContract
      ? blockingContract.kind === "waiting_user"
        ? "waiting_user"
        : blockingContract.kind === "cancellation"
          ? "cancellation"
          : "unknown"
      : "无阻塞契约";
    const manualInputSlots = Array.isArray(
      continuationContract?.manualInputSlots,
    )
      ? continuationContract.manualInputSlots
      : [];
    const manualInputSlotSchemaLabel =
      manualInputSlots.length > 0
        ? manualInputSlots
            .map((slot) => {
              const typeLabel =
                slot.valueType === "confirmation"
                  ? "确认"
                  : slot.valueType === "text"
                    ? "文本"
                    : slot.valueType === "selection"
                      ? "选择"
                      : "未知";
              return `${slot.label}（${typeLabel}）`;
            })
            .join("；")
        : "未观察到人工输入槽位声明";

    const preconditionStatusLabel = (
      status: GraphRunControlPreconditionItem["status"],
    ) =>
      status === "satisfied"
        ? "满足"
        : status === "unsatisfied"
          ? "不满足"
          : "未知";
    const controlPreconditionsLabel = controlPreconditionsContract
      ? controlPreconditionsContract.items.length > 0
        ? controlPreconditionsContract.items
            .map(
              (item) =>
                `${item.label}（${preconditionStatusLabel(item.status)} / ${item.sourceKind} / ${item.conservativeSourceKind}）`,
            )
            .join("；")
        : "当前没有可消费的控制前提条目，已保守降级。"
      : "当前没有可消费的控制前提条目，已保守降级。";
    const constraintSummaryLabel = constraintSummary
      ? [
          constraintSummary.heading,
          constraintSummary.explanation,
          constraintSummary.disclaimer,
          constraintSummary.capabilityBoundary,
        ].join(" · ")
      : "控制前提说明（只读） · 当前仅提供保守解释，只表示无法从现有事实推出 continuation / resume 或控制动作能力。";

    return {
      runId: artifact.runId,
      graphId: artifact.graphId,
      hasActiveRun: artifact.terminalOutcome === undefined,
      status: artifact.status,
      statusLabel:
        statusLabels[artifact.status] ?? `状态 ${String(artifact.status)}`,
      phase: artifact.phase,
      phaseLabel:
        artifact.phaseLabel ||
        phaseLabels[artifact.phase] ||
        `阶段 ${artifact.phase}`,
      blockingReason: artifact.blockingReason ?? null,
      blockingReasonLabel: artifact.blockingReason
        ? artifact.blockingReason.detail?.trim()
          ? `${artifact.blockingReason.label} · ${artifact.blockingReason.detail.trim()}`
          : artifact.blockingReason.label
        : "无阻塞原因",
      blockingContract,
      hasBlockingContract: blockingContract !== null,
      blockingCategoryLabel,
      requiresHumanInput: blockingContract?.requiresHumanInput === true,
      requiresHumanInputLabel:
        blockingContract?.requiresHumanInput === true ? "需要" : "不需要",
      inputRequirementType: inputType,
      inputRequirementTypeLabel: inputRequirementTypeLabels[inputType],
      continuationContract,
      controlPreconditionsContract,
      constraintSummary,
      handlingPolicyLabel: continuationContract?.handlingPolicy
        ? `${continuationContract.handlingPolicy.label}${continuationContract.handlingPolicy.detail?.trim() ? ` · ${continuationContract.handlingPolicy.detail.trim()}` : ""}`
        : "unknown · 仅保留只读观察",
      continuationVerdictLabel: continuationContract?.verdict
        ? `${continuationContract.verdict.status} · ${continuationContract.verdict.label}${continuationContract.verdict.detail?.trim() ? ` · ${continuationContract.verdict.detail.trim()}` : ""}`
        : "unknown · 继续性未知",
      recoveryEvidenceLabel: continuationContract?.recoveryEvidence
        ? `${continuationContract.recoveryEvidence.label}${continuationContract.recoveryEvidence.detail?.trim() ? ` · ${continuationContract.recoveryEvidence.detail.trim()}` : ""}`
        : "unknown · 恢复证据未知",
      recoveryEvidenceTrustLabel: continuationContract?.recoveryEvidence
        ? evidenceTrustLabels[continuationContract.recoveryEvidence.trust]
        : "未知",
      recoveryEvidenceSourceLabel:
        continuationContract?.recoveryEvidence?.source ?? "unknown",
      manualInputSlotCount: manualInputSlots.length,
      manualInputSlotSchemaLabel,
      recoveryEligibility: artifact.recoveryEligibility ?? null,
      recoveryEligibilityLabel: artifact.recoveryEligibility
        ? `${artifact.recoveryEligibility.status} · ${artifact.recoveryEligibility.label}`
        : "unknown · 恢复资格未知",
      terminalOutcome: artifact.terminalOutcome ?? null,
      terminalOutcomeLabel: artifact.terminalOutcome
        ? terminalOutcomeLabels[artifact.terminalOutcome]
        : "未终局",
      currentStage: artifact.currentStage,
      currentStageLabel: artifact.currentStage
        ? stageLabels[artifact.currentStage]
        : "—",
      latestNodeId: artifact.latestNodeId,
      latestNodeModuleId: artifact.latestNodeModuleId,
      latestNodeLabel:
        artifact.latestNodeId || artifact.latestNodeModuleId
          ? [artifact.latestNodeId, artifact.latestNodeModuleId]
              .filter((value): value is string => Boolean(value))
              .join(" · ")
          : "—",
      latestNodeStatus: artifact.latestNodeStatus,
      latestNodeStatusLabel: artifact.latestNodeStatus
        ? latestNodeStatusLabels[artifact.latestNodeStatus]
        : "—",
      eventCount: artifact.eventCount,
      updatedAt: artifact.updatedAt,
      checkpointCandidate,
      latestHeartbeat: artifact.latestHeartbeat ?? null,
      latestHeartbeatLabel: artifact.latestHeartbeat
        ? artifact.latestHeartbeat.message?.trim()
          ? artifact.latestHeartbeat.message.trim()
          : [artifact.latestHeartbeat.nodeId, artifact.latestHeartbeat.moduleId]
              .filter((value): value is string => Boolean(value))
              .join(" · ") || "heartbeat"
        : "无 heartbeat",
      latestPartialOutput: artifact.latestPartialOutput ?? null,
      latestPartialOutputLabel: artifact.latestPartialOutput
        ? artifact.latestPartialOutput.preview.trim()
          ? `${artifact.latestPartialOutput.preview}${artifact.latestPartialOutput.length > artifact.latestPartialOutput.preview.length ? "…" : ""}`
          : `长度 ${artifact.latestPartialOutput.length}`
        : "无 partial output",
      waitingUser: artifact.waitingUser ?? null,
      waitingUserLabel: artifact.waitingUser?.reason ?? "未进入 waiting_user",
      controlPreconditionsLabel,
      constraintSummaryLabel,
      diagnosticsSummary,
      nodeDiagnostics,
    };
  }

  const activeWorkbenchDiagnosticsOverview = computed(() =>
    toGraphDiagnosticsOverview(lastRun.value?.diagnostics),
  );

  const activeWorkbenchDiagnosticsSummary = computed(() =>
    toDiagnosticsSummaryViewModel(activeWorkbenchDiagnosticsOverview.value),
  );

  const activeGraphCompileArtifact = computed(() =>
    toActiveGraphCompileArtifact(lastRun.value?.diagnostics),
  );

  const activeGraphRunArtifact = computed(() =>
    toActiveGraphRunArtifact(lastRun.value?.diagnostics),
  );

  const activeGraphNodeInputResolutionArtifact = computed(() =>
    toActiveGraphNodeInputResolutionArtifact(lastRun.value?.diagnostics),
  );

  const activeGraphCompileRunLinkArtifact = computed(() =>
    toActiveGraphCompileRunLinkArtifact(lastRun.value?.diagnostics),
  );

  const activeGraphFailureExplainArtifact = computed(() =>
    toActiveGraphFailureExplainArtifact(lastRun.value?.diagnostics),
  );

  const activeGraphOutputExplainArtifact = computed(() =>
    toActiveGraphOutputExplainArtifact(lastRun.value?.diagnostics),
  );

  const activeGraphHostEffectExplainArtifact = computed(() =>
    toActiveGraphHostEffectExplainArtifact(lastRun.value?.diagnostics),
  );

  const activeGraphReuseExplainArtifact = computed(() =>
    toActiveGraphReuseExplainArtifact(lastRun.value?.diagnostics),
  );

  const activeGraphSchedulingExplainArtifact = computed(() =>
    toActiveGraphSchedulingExplainArtifact(lastRun.value?.diagnostics),
  );

  const activeGraphTerminalOutcomeExplainArtifact = computed(() =>
    toActiveGraphTerminalOutcomeExplainArtifact(lastRun.value?.diagnostics),
  );

  const activeGraphBlockingExplainArtifact = computed(() =>
    toActiveGraphBlockingExplainArtifact(lastRun.value?.diagnostics),
  );

  const activeWorkbenchNodeDiagnostics = computed(() =>
    toNodeDiagnosticsViewModel(
      activeWorkbenchDiagnosticsOverview.value,
      activeGraphRunArtifact.value,
    ),
  );

  const activeGraphRunSummary = computed(() =>
    toActiveGraphRunSummaryViewModel(
      activeGraphRunArtifact.value,
      activeWorkbenchDiagnosticsSummary.value,
      activeWorkbenchNodeDiagnostics.value,
    ),
  );

  function getModuleExplainContractView(
    moduleId: string,
  ): ModuleExplainContract | null {
    return getModuleExplainContract(moduleId);
  }

  function refreshDebugRecords(options: { silent?: boolean } = {}) {
    const currentChatId = getCurrentChatIdSafe();
    const nextRun = currentChatId
      ? loadLastRunForChat(currentChatId)
      : loadLastRun();
    const nextIo = currentChatId
      ? loadLastIoForChat(currentChatId)
      : loadLastIo();

    lastRun.value = nextRun;
    lastIo.value = nextIo;

    if (options.silent) {
      return;
    }

    showEwNotice({
      title: "调试",
      message:
        nextRun || nextIo
          ? currentChatId
            ? "已刷新当前聊天的调试记录"
            : "已刷新调试记录"
          : currentChatId
            ? "当前聊天暂无调试记录"
            : "暂无可用调试记录",
      level: "info",
    });
  }

  function addApiPreset() {
    const next = klona(settings.value);
    const newPreset = createDefaultApiPreset(next.api_presets.length + 1);
    next.api_presets.push(newPreset);
    settings.value = next;
    expandedApiPresetId.value = newPreset.id;
    activeTab.value = "api";
  }

  function duplicateApiPreset(presetId: string) {
    const source = settings.value.api_presets.find((p) => p.id === presetId);
    if (!source) return;
    const next = klona(settings.value);
    const copy = klona(source);
    copy.id = `${copy.id}_${Date.now()}`;
    copy.name = `${copy.name} (副本)`;
    const insertIndex =
      next.api_presets.findIndex((p) => p.id === presetId) + 1;
    next.api_presets.splice(insertIndex, 0, copy);
    settings.value = next;
    expandedApiPresetId.value = copy.id;
  }

  function removeApiPreset(presetId: string) {
    const next = klona(settings.value);
    _.remove(next.api_presets, (preset) => preset.id === presetId);

    if (next.api_presets.length === 0) {
      next.api_presets.push(createDefaultApiPreset(1));
    }

    const fallbackPresetId = next.api_presets[0].id;
    next.flows = next.flows.map((flow) => {
      if (flow.api_preset_id !== presetId) {
        return flow;
      }
      return {
        ...flow,
        api_preset_id: fallbackPresetId,
      };
    });

    settings.value = next;
    if (expandedApiPresetId.value === presetId) {
      expandedApiPresetId.value = next.api_presets[0]?.id ?? null;
    }
  }

  function addFlow() {
    const next = klona(settings.value);
    if (next.api_presets.length === 0) {
      next.api_presets.push(createDefaultApiPreset(1));
    }
    const newFlow = createDefaultFlow(
      next.flows.length + 1,
      next.api_presets[0].id,
    );
    next.flows.push(newFlow);
    settings.value = next;
    expandedFlowId.value = newFlow.id;
    activeTab.value = "flows";
  }

  function removeFlow(flowId: string) {
    const next = klona(settings.value);
    _.remove(next.flows, (flow) => flow.id === flowId);
    if (next.flows.length === 0) {
      if (next.api_presets.length === 0) {
        next.api_presets.push(createDefaultApiPreset(1));
      }
      next.flows.push(createDefaultFlow(1, next.api_presets[0].id));
    }
    settings.value = next;
    if (expandedFlowId.value === flowId) {
      expandedFlowId.value = next.flows[0]?.id ?? null;
    }
  }

  function duplicateFlow(flowId: string) {
    const source = settings.value.flows.find((f) => f.id === flowId);
    if (!source) return;
    const next = klona(settings.value);
    const copy = klona(source);
    copy.id = `${copy.id}_${Date.now()}`;
    copy.name = `${copy.name} (副本)`;
    const insertIndex = next.flows.findIndex((f) => f.id === flowId) + 1;
    next.flows.splice(insertIndex, 0, copy);
    settings.value = next;
    expandedFlowId.value = copy.id;
  }

  function setActiveTab(tab: TabKey) {
    activeTab.value = tab;
    if (tab === "flows" && flowScope.value === "character") {
      void loadCharFlows();
    }
  }

  function setGlobalAdvancedOpen(open: boolean) {
    globalAdvancedOpen.value = open;
  }

  function toggleGlobalAdvancedOpen() {
    globalAdvancedOpen.value = !globalAdvancedOpen.value;
  }

  function toggleApiPresetExpanded(presetId: string) {
    expandedApiPresetId.value =
      expandedApiPresetId.value === presetId ? null : presetId;
  }

  function toggleFlowExpanded(flowId: string) {
    expandedFlowId.value = expandedFlowId.value === flowId ? null : flowId;
  }

  function setExpandedApiPreset(presetId: string | null) {
    expandedApiPresetId.value = presetId;
  }

  function setExpandedFlow(flowId: string | null) {
    expandedFlowId.value = flowId;
  }

  async function runManual(message: string) {
    busy.value = true;
    try {
      const text = message.trim() || getChatMessages(-1)[0]?.message || "";
      const result = await runWorkflow({
        message_id: getLastMessageId(),
        user_input: text,
        mode: "manual",
        inject_reply: false,
      });
      if (!result.ok) {
        toastr.error(result.reason ?? "手动运行失败", "Evolution World");
      } else {
        toastr.success("手动运行成功", "Evolution World");
      }
    } finally {
      busy.value = false;
    }
  }

  async function rollbackController() {
    busy.value = true;
    try {
      const api = window.EvolutionWorldAPI;
      if (!api) {
        toastr.error("EvolutionWorldAPI 尚未就绪", "Evolution World");
        return;
      }
      const result = await api.rollbackController();
      if (!result.ok) {
        toastr.error(result.reason ?? "回滚失败", "Evolution World");
      } else {
        toastr.success("控制器回滚成功", "Evolution World");
      }
    } finally {
      busy.value = false;
    }
  }

  function exportConfig() {
    const safeSettings = klona(settings.value);
    for (const preset of safeSettings.api_presets) {
      preset.api_key = "";
      preset.api_url = "";
      preset.headers_json = "";
    }
    for (const flow of safeSettings.flows) {
      (flow as any).api_url = "";
      (flow as any).api_key = "";
      (flow as any).headers_json = "";
      (flow as any).api_preset_id = "";
    }
    const payload = JSON.stringify(safeSettings, null, 2);
    navigator.clipboard
      .writeText(payload)
      .then(() =>
        toastr.success(
          "配置已复制到剪贴板（已去除 API 密钥）",
          "Evolution World",
        ),
      )
      .catch(() => toastr.error("复制配置失败", "Evolution World"));
  }

  function sanitizeImportData(data: any): any {
    if (!data || typeof data !== "object") return data;
    const clone = klona(data);
    if (Array.isArray(clone.api_presets)) {
      for (const preset of clone.api_presets) {
        if (preset.mode === "llm_connector") {
          preset.mode = "workflow_http";
        }
        delete preset.use_main_api;
      }
    }
    return clone;
  }

  function importConfig() {
    if (!importText.value.trim()) {
      showEwNotice({
        title: "导入失败",
        message: "导入内容为空，请先粘贴 JSON 配置。",
        level: "warning",
        duration_ms: 3600,
      });
      toastr.warning("导入内容为空", "Evolution World");
      return;
    }

    try {
      const raw = JSON.parse(importText.value);
      const sanitized = sanitizeImportData(raw);
      const parsed = EwSettingsSchema.parse(sanitized);
      replaceSettings(parsed as EwSettings);
      settings.value = getSettings();
      showEwNotice({
        title: "导入成功",
        message: "配置已加载并应用到当前脚本。",
        level: "success",
        duration_ms: 3200,
      });
      toastr.success("配置已导入", "Evolution World");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showEwNotice({
        title: "导入失败",
        message,
        level: "error",
        duration_ms: 4800,
      });
      toastr.error(`导入失败: ${message}`, "Evolution World");
    }
  }

  function downloadJson(data: unknown, filename: string) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function buildFlowExportPayload(flows: EwFlowConfig[]) {
    const safeFlows = flows.map((flow) => {
      const copy = klona(flow) as Record<string, unknown>;
      delete copy.api_url;
      delete copy.api_key;
      delete copy.headers_json;
      delete copy.api_preset_id;
      return copy;
    });
    return { ew_flow_export: true, version: 1, flows: safeFlows };
  }

  /**
   * Build a graph document export payload using the stable codec envelope.
   * Strips sensitive fields from node configs.
   */
  function buildGraphExportPayload(
    graphs: WorkbenchGraph[],
  ): GraphDocumentEnvelope {
    return buildGraphDocumentExportPayload(graphs);
  }

  function sanitizeFilename(name: string) {
    return name.replace(/[<>:"/\\|?*]/g, "_").trim() || "flow";
  }

  function ensureUniqueFlowIds(
    flows: EwFlowConfig[],
    existingIds: Set<string>,
  ) {
    for (const flow of flows) {
      if (existingIds.has(flow.id)) {
        flow.id = `${flow.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      }
      existingIds.add(flow.id);
    }
  }

  function parseImportedFlows(jsonText: string, filename?: string) {
    const parsed = JSON.parse(jsonText);

    let validated: EwFlowConfig[];

    // Try graph document envelope first (new stable format)
    const graphEnvelope = readGraphDocumentEnvelope(parsed);
    if (graphEnvelope && graphEnvelope.graphs.length > 0) {
      // Graph document format detected — store graphs directly into workbench_graphs
      // rather than converting back to flows. This preserves the graph structure.
      const next = klona(settings.value);
      const existingGraphIds = new Set(
        ((next as any).workbench_graphs ?? []).map((g: any) => g.id),
      );
      const newGraphs = graphEnvelope.graphs.filter(
        (g) => !existingGraphIds.has(g.id),
      );
      if (newGraphs.length === 0) {
        throw new Error("导入的图文档中所有图表 ID 已存在");
      }
      (next as any).workbench_graphs = [
        ...((next as any).workbench_graphs ?? []),
        ...newGraphs,
      ];
      settings.value = next;
      toastr.success(
        `已通过图文档 codec 导入 ${newGraphs.length} 个工作流图`,
        "Evolution World",
      );
      return []; // Empty array signals no legacy flow import needed
    }

    if (
      parsed &&
      parsed.ew_flow_export === true &&
      Array.isArray(parsed.flows)
    ) {
      validated = [];
      for (const raw of parsed.flows) {
        validated.push(EwFlowConfigSchema.parse(raw));
      }
    } else if (isSillyTavernPreset(parsed)) {
      const flowName = filename?.replace(/\.json$/i, "") || "ST Preset";
      const flow = EwFlowConfigSchema.parse(
        convertStPresetToFlow(parsed, flowName),
      );
      validated = [flow];
      toastr.info("已识别为酒馆预设并转换", "Evolution World");
    } else {
      throw new Error(
        "无效的工作流导出文件，缺少 ew_flow_export 标识且非酒馆预设",
      );
    }

    if (validated.length === 0) {
      throw new Error("导出文件中没有工作流");
    }

    return validated;
  }

  function exportSingleFlow(flowId: string) {
    const flow = settings.value.flows.find((f) => f.id === flowId);
    if (!flow) {
      toastr.error("找不到该工作流", "Evolution World");
      return;
    }
    const payload = buildFlowExportPayload([flow]);
    downloadJson(payload, `ew_flow_${sanitizeFilename(flow.name)}.json`);
    toastr.success(`已导出工作流「${flow.name}」`, "Evolution World");
  }

  function exportAllFlows() {
    exportGraphDocument();
  }

  /**
   * Export all workbench graphs as a stable graph document envelope.
   */
  function exportGraphDocument() {
    const graphs: WorkbenchGraph[] =
      (settings.value as any).workbench_graphs ?? [];
    if (graphs.length === 0) {
      toastr.warning("没有工作流可导出", "Evolution World");
      return;
    }
    const payload = buildGraphExportPayload(graphs);
    downloadJson(payload, `ew_flows_all_${settings.value.flows.length}.json`);
    toastr.success(
      `已导出全部 ${settings.value.flows.length} 条工作流`,
      "Evolution World",
    );
  }

  function importFlowsFromText(jsonText: string, filename?: string) {
    if (!jsonText.trim()) {
      toastr.warning("导入内容为空", "Evolution World");
      return;
    }

    try {
      const validated = parseImportedFlows(jsonText, filename);
      // Empty array means graph document was handled inline by parseImportedFlows
      if (validated.length === 0) {
        return;
      }
      const existingIds = new Set(settings.value.flows.map((f) => f.id));
      ensureUniqueFlowIds(validated, existingIds);

      const next = klona(settings.value);
      next.flows.push(...validated);
      settings.value = next;
      toastr.success(`已导入 ${validated.length} 条工作流`, "Evolution World");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toastr.error(`工作流导入失败: ${message}`, "Evolution World");
    }
  }

  function exportSingleCharFlow(flowId: string) {
    const flow = charFlows.value.find((f) => f.id === flowId);
    if (!flow) {
      toastr.error("找不到该角色卡工作流", "Evolution World");
      return;
    }
    const payload = buildFlowExportPayload([flow]);
    downloadJson(payload, `ew_char_flow_${sanitizeFilename(flow.name)}.json`);
    toastr.success(`已导出角色卡工作流「${flow.name}」`, "Evolution World");
  }

  function exportAllCharFlows() {
    if (charFlows.value.length === 0) {
      toastr.warning("当前角色卡没有工作流可导出", "Evolution World");
      return;
    }
    const charName = sanitizeFilename(activeCharName.value || "character");
    const payload = buildFlowExportPayload(charFlows.value);
    downloadJson(
      payload,
      `ew_char_flows_${charName}_${charFlows.value.length}.json`,
    );
    toastr.success(
      `已导出当前角色卡全部 ${charFlows.value.length} 条工作流`,
      "Evolution World",
    );
  }

  function importCharFlowsFromText(jsonText: string, filename?: string) {
    if (!jsonText.trim()) {
      toastr.warning("导入内容为空", "Evolution World");
      return;
    }

    try {
      const validated = parseImportedFlows(jsonText, filename);
      const next = [...charFlows.value];
      const existingIds = new Set(next.map((f) => f.id));
      ensureUniqueFlowIds(validated, existingIds);
      next.push(...validated);
      charFlows.value = next;

      showEwNotice({
        title: "Evolution World",
        message: `已导入 ${validated.length} 条角色卡工作流。若要写回世界书，请继续点击“保存到绑定世界书”。`,
        level: "success",
      });
      toastr.success(
        `已导入 ${validated.length} 条角色卡工作流`,
        "Evolution World",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toastr.error(`角色卡工作流导入失败: ${message}`, "Evolution World");
    }
  }

  function validateConfig() {
    try {
      const result = EwSettingsSchema.safeParse(settings.value);
      if (result.success) {
        toastr.success("配置校验通过 ✓", "Evolution World");
        showEwNotice({
          title: "校验",
          message: "当前配置合法、完整。",
          level: "success",
        });
        return;
      }
      const errors = result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      );
      toastr.error(`配置校验失败 (${errors.length} 项)`, "Evolution World");
      showEwNotice({
        title: "校验失败",
        message: errors.join("\n"),
        level: "error",
        duration_ms: 6000,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toastr.error(`校验异常: ${msg}`, "Evolution World");
    }
  }

  async function validateControllerSyntax() {
    busy.value = true;
    try {
      const result = await window.EvolutionWorldAPI?.validateControllerSyntax();
      if (!result) {
        toastr.error("EvolutionWorldAPI 尚未就绪", "Evolution World");
        return;
      }

      if (result.ok) {
        toastr.success("控制器语法校验通过 ✓", "Evolution World");
      } else {
        toastr.error(result.reason ?? "控制器语法无效", "Evolution World");
      }
    } finally {
      busy.value = false;
    }
  }

  function setOpen(open: boolean) {
    patchSettings({ ui_open: open });
  }

  function openPanel() {
    setOpen(true);
  }

  function closePanel() {
    setOpen(false);
    activeTab.value = "overview";
  }

  async function loadCharFlows() {
    charFlowsLoading.value = true;
    try {
      const name = getCurrentCharacterName?.() ?? "";
      activeCharName.value = name;
      const savedFlows = await readCharFlows(settings.value);
      const draftFlows = readCharFlowDraft(name);

      suppressCharFlowDraftPersist = true;
      charFlows.value = draftFlows ?? savedFlows;
      queueMicrotask(() => {
        suppressCharFlowDraftPersist = false;
      });
    } catch (e) {
      console.warn("[Evolution World] loadCharFlows failed:", e);
      charFlows.value = [];
    } finally {
      charFlowsLoading.value = false;
    }
  }

  async function reloadCharFlowsFromWorldbook() {
    charFlowsLoading.value = true;
    try {
      const name = getCurrentCharacterName?.() ?? "";
      activeCharName.value = name;
      const savedFlows = await readCharFlows(settings.value);

      suppressCharFlowDraftPersist = true;
      charFlows.value = savedFlows;
      clearCharFlowDraft(name);
      queueMicrotask(() => {
        suppressCharFlowDraftPersist = false;
      });

      showEwNotice({
        title: "Evolution World",
        message: `已从角色世界书重新读取 ${savedFlows.length} 条工作流，并覆盖当前角色卡草稿。`,
        level: "success",
      });
    } catch (e) {
      console.error(
        "[Evolution World] reloadCharFlowsFromWorldbook failed:",
        e,
      );
      showEwNotice({
        title: "Evolution World",
        message: "从角色世界书读取工作流失败: " + (e as Error).message,
        level: "error",
      });
    } finally {
      charFlowsLoading.value = false;
    }
  }

  async function saveCharFlows() {
    try {
      await writeCharFlows(settings.value, charFlows.value);
      writeCharFlowDraft(activeCharName.value, charFlows.value);
      showEwNotice({
        title: "Evolution World",
        message:
          "角色卡工作流已保存到当前绑定世界书。若要分享，请连同更新后的角色世界书一起导出。",
        level: "success",
      });
    } catch (e) {
      console.error("[Evolution World] saveCharFlows failed:", e);
      showEwNotice({
        title: "Evolution World",
        message: "角色卡工作流保存失败: " + (e as Error).message,
        level: "error",
      });
    }
  }

  async function mergeFlowsToCard(flowIds: string[]) {
    try {
      const selected = settings.value.flows.filter((f) =>
        flowIds.includes(f.id),
      );
      if (selected.length === 0) {
        showEwNotice({
          title: "Evolution World",
          message: "未选择任何工作流",
          level: "warning",
        });
        return;
      }

      const existing = await readCharFlows(settings.value);
      const merged = [...existing];
      let updatedCount = 0;
      let appendedCount = 0;

      for (const flow of selected) {
        const copy = klona(flow);
        delete (copy as any).api_url;
        delete (copy as any).api_key;
        delete (copy as any).headers_json;

        const trimmedName = copy.name.trim();
        const existingIndex = merged.findIndex(
          (f) => f.name.trim() === trimmedName,
        );
        if (existingIndex >= 0) {
          copy.id = merged[existingIndex].id;
          merged[existingIndex] = copy;
          updatedCount++;
        } else {
          copy.id = `${copy.id}_char_${Date.now()}`;
          merged.push(copy);
          appendedCount++;
        }
      }

      await writeCharFlows(settings.value, merged);
      charFlows.value = merged;
      activeCharName.value = getCurrentCharacterName?.() ?? "";
      writeCharFlowDraft(activeCharName.value, merged);

      const parts: string[] = [];
      if (updatedCount > 0) parts.push(`更新 ${updatedCount} 条`);
      if (appendedCount > 0) parts.push(`新增 ${appendedCount} 条`);
      showEwNotice({
        title: "Evolution World",
        message: `已写入角色卡工作流：${parts.join("，")}`,
        level: "success",
      });
    } catch (e) {
      console.error("[Evolution World] mergeFlowsToCard failed:", e);
      showEwNotice({
        title: "Evolution World",
        message: "写入角色卡失败: " + (e as Error).message,
        level: "error",
      });
    }
  }

  function addCharFlow() {
    const apiPresets = settings.value.api_presets;
    if (apiPresets.length === 0) {
      const next = klona(settings.value);
      next.api_presets.push(createDefaultApiPreset(1));
      settings.value = next;
    }
    const newFlow = createDefaultFlow(
      charFlows.value.length + 1,
      settings.value.api_presets[0].id,
    );
    charFlows.value = [...charFlows.value, newFlow];
    expandedFlowId.value = newFlow.id;
  }

  function removeCharFlow(flowId: string) {
    charFlows.value = charFlows.value.filter((f) => f.id !== flowId);
    if (expandedFlowId.value === flowId) {
      expandedFlowId.value = charFlows.value[0]?.id ?? null;
    }
  }

  function duplicateCharFlow(flowId: string) {
    const source = charFlows.value.find((f) => f.id === flowId);
    if (!source) return;
    const copy = klona(source);
    copy.id = `${copy.id}_${Date.now()}`;
    copy.name = `${copy.name} (副本)`;
    const insertIndex = charFlows.value.findIndex((f) => f.id === flowId) + 1;
    const next = [...charFlows.value];
    next.splice(insertIndex, 0, copy);
    charFlows.value = next;
    expandedFlowId.value = copy.id;
  }

  function setFlowScope(scope: "global" | "character") {
    flowScope.value = scope;
    if (scope === "character") {
      void loadCharFlows();
    }
  }

  async function loadPromptPreview() {
    const flowId = previewFlowId.value;
    const allFlows = [...settings.value.flows, ...charFlows.value];
    const flow =
      allFlows.find((f) => f.id === flowId) ??
      allFlows.find((f) => f.enabled) ??
      allFlows[0];
    if (!flow) {
      showEwNotice({
        title: "调试",
        message: "没有可用的工作流",
        level: "warning",
      });
      return;
    }
    previewFlowId.value = flow.id;
    busy.value = true;
    try {
      promptPreview.value = await previewPrompt(flow);
      showEwNotice({
        title: "调试",
        message: `Prompt 预览已生成（${promptPreview.value.length} 条消息）`,
        level: "success",
      });
    } catch (e) {
      console.error("[Evolution World] previewPrompt failed:", e);
      showEwNotice({
        title: "调试",
        message: "Prompt 预览失败: " + (e as Error).message,
        level: "error",
      });
    } finally {
      busy.value = false;
    }
  }

  async function loadSnapshotPreview() {
    busy.value = true;
    try {
      snapshotPreview.value = await collectLatestSnapshots();
      const dynCount = snapshotPreview.value.dyn.size;
      const controllerCount = snapshotPreview.value.controllers.length;
      showEwNotice({
        title: "调试",
        message: `Controller: ${controllerCount} 条 | Dyn 条目: ${dynCount}`,
        level: "success",
      });
    } catch (e) {
      console.error("[Evolution World] loadSnapshotPreview failed:", e);
      showEwNotice({
        title: "调试",
        message: "快照读取失败: " + (e as Error).message,
        level: "error",
      });
    } finally {
      busy.value = false;
    }
  }

  async function loadFloorSnapshots() {
    busy.value = true;
    try {
      floorSnapshots.value = await collectAllFloorSnapshots();
      showEwNotice({
        title: "历史",
        message: `已加载 ${floorSnapshots.value.length} 个楼层`,
        level: "success",
      });
    } catch (e) {
      console.error("[Evolution World] loadFloorSnapshots failed:", e);
      showEwNotice({
        title: "历史",
        message: "楼层快照加载失败: " + (e as Error).message,
        level: "error",
      });
    } finally {
      busy.value = false;
    }
  }

  async function doRollbackToFloor(messageId: number) {
    busy.value = true;
    try {
      await rollbackToFloor(settings.value, messageId);
      showEwNotice({
        title: "历史",
        message: `已回滚到楼层 #${messageId}`,
        level: "success",
      });
    } catch (e) {
      console.error("[Evolution World] doRollbackToFloor failed:", e);
      showEwNotice({
        title: "历史",
        message: "回滚失败: " + (e as Error).message,
        level: "error",
      });
    } finally {
      busy.value = false;
    }
  }

  async function rederiveFloorWorkflow(
    messageId: number,
    timing: "before_reply" | "after_reply" | "manual" = "manual",
  ): Promise<{ ok: boolean; reason?: string; result?: any }> {
    busy.value = true;
    try {
      const api = window.EvolutionWorldAPI as
        | (typeof window.EvolutionWorldAPI & {
            rederiveWorkflowAtFloor?: (input: {
              message_id: number;
              timing: "before_reply" | "after_reply" | "manual";
              target_version_key?: string;
              confirm_legacy?: boolean;
              capsule_mode?: "full" | "light";
            }) => Promise<{ ok: boolean; reason?: string; result?: any }>;
          })
        | undefined;
      if (!api?.rederiveWorkflowAtFloor) {
        return {
          ok: false,
          reason: "EvolutionWorldAPI.rederiveWorkflowAtFloor 尚未就绪",
        };
      }

      const result = await api.rederiveWorkflowAtFloor({
        message_id: messageId,
        timing,
        capsule_mode: "full",
      });

      if (result.ok) {
        const applied = Number(result.result?.writeback_applied ?? 0);
        const conflicts = Number(result.result?.writeback_conflicts ?? 0);
        const anchorId = Number(result.result?.anchor_message_id ?? messageId);
        showEwNotice({
          title: "历史",
          message: `楼层 #${messageId} 已完成重推导：锚点 #${anchorId}，写回 ${applied} 项，冲突 ${conflicts} 项。`,
          level: "success",
          duration_ms: 4200,
        });
        await loadFloorSnapshots();
      } else if (result.reason && result.reason !== "cancelled_by_user") {
        showEwNotice({
          title: "历史",
          message: `楼层 #${messageId} 重推导失败：${result.reason}`,
          level: "error",
          duration_ms: 5200,
        });
      }

      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      showEwNotice({
        title: "历史",
        message: `楼层 #${messageId} 重推导异常：${reason}`,
        level: "error",
        duration_ms: 5200,
      });
      return { ok: false, reason };
    } finally {
      busy.value = false;
    }
  }

  return {
    settings,
    lastRun,
    lastIo,
    activeWorkbenchDiagnosticsOverview,
    activeWorkbenchDiagnosticsSummary,
    activeWorkbenchNodeDiagnostics,
    activeGraphCompileArtifact,
    activeGraphNodeInputResolutionArtifact,
    activeGraphCompileRunLinkArtifact,
    activeGraphFailureExplainArtifact,
    activeGraphOutputExplainArtifact,
    activeGraphHostEffectExplainArtifact,
    activeGraphReuseExplainArtifact,
    activeGraphSchedulingExplainArtifact,
    activeGraphTerminalOutcomeExplainArtifact,
    activeGraphBlockingExplainArtifact,
    activeGraphRunArtifact,
    activeGraphRunSummary,
    getModuleExplainContractView,
    activeTab,
    globalAdvancedOpen,
    expandedApiPresetId,
    expandedFlowId,
    importText,
    busy,
    charFlows,
    activeCharName,
    flowScope,
    charFlowsLoading,
    promptPreview,
    snapshotPreview,
    previewFlowId,
    floorSnapshots,
    selectedFloorId,
    compareFloorId,
    refreshDebugRecords,
    addApiPreset,
    duplicateApiPreset,
    removeApiPreset,
    addFlow,
    duplicateFlow,
    removeFlow,
    setActiveTab,
    setGlobalAdvancedOpen,
    toggleGlobalAdvancedOpen,
    toggleApiPresetExpanded,
    toggleFlowExpanded,
    setExpandedApiPreset,
    setExpandedFlow,
    runManual,
    rollbackController,
    exportConfig,
    importConfig,
    exportSingleFlow,
    exportAllFlows,
    exportGraphDocument,
    importFlowsFromText,
    exportSingleCharFlow,
    exportAllCharFlows,
    importCharFlowsFromText,
    validateConfig,
    validateControllerSyntax,
    setOpen,
    openPanel,
    closePanel,
    loadCharFlows,
    reloadCharFlowsFromWorldbook,
    saveCharFlows,
    mergeFlowsToCard,
    addCharFlow,
    duplicateCharFlow,
    removeCharFlow,
    setFlowScope,
    loadPromptPreview,
    loadSnapshotPreview,
    loadFloorSnapshots,
    doRollbackToFloor,
    rederiveFloorWorkflow,
  };
});
