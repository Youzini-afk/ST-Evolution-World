import { createPinia, setActivePinia } from "pinia";

import {
  getModuleExplainContract,
  getModuleMetadataSummary,
  getModuleMetadataSurface,
} from "../ui/components/graph/module-registry";
import type {
  ExecutionContext,
  GraphCompilePlan,
  GraphExecutionStage,
  GraphNodeDiagnosticsView,
  WorkbenchGraph,
} from "../ui/components/graph/module-types";
import { useEwStore } from "../ui/store";
import { autoMigrateIfNeeded, migrateFlowToGraph } from "./flow-migrator";
import {
  createGraphCompileArtifactEnvelope,
  readGraphCompileArtifactEnvelope,
} from "./graph-compile-artifact-codec";
import {
  createGraphCompileRunLinkArtifactEnvelope,
  readGraphCompileRunLinkArtifactEnvelope,
} from "./graph-compile-run-link-artifact-codec";
import {
  buildGraphDocumentExportPayload,
  createGraphDocumentEnvelope,
  readGraphDocumentAsWorkbenchGraphs,
  readGraphDocumentEnvelope,
  toWorkbenchGraphs,
} from "./graph-document-codec";
import {
  buildGraphRunDiagnosticsOverview,
  clearGraphExecutorReusableOutputsForTesting,
  compileGraphPlan,
  executeCompiledGraph,
  executeGraph,
  resetGraphExecutorReuseStateForTesting,
  validateGraph,
} from "./graph-executor";
import {
  createGraphNodeInputResolutionArtifactEnvelope,
  readGraphNodeInputResolutionArtifactEnvelope,
} from "./graph-input-resolution-artifact-codec";
import {
  createGraphRunSnapshotEnvelope,
  readGraphRunSnapshotEnvelope,
} from "./graph-run-artifact-codec";
import {
  createGraphSchedulingExplainArtifactEnvelope,
  readGraphSchedulingExplainArtifactEnvelope,
} from "./graph-scheduling-explain-artifact-codec";
import {
  buildWorkflowBridgeDiagnostics,
  selectWorkflowBridgeRoute,
  type WorkflowBridgeRouteSelection,
} from "./pipeline";
import {
  _resetRegistryForTesting,
  getRegisteredModuleIds,
  hasRegisteredHandler,
  resolveNodeHandler,
} from "./runtime-node-registry";
import { loadLastRun, loadLastRunForChat, setLastRun } from "./settings";
import { RunSummarySchema, type EwFlowConfig, type RunSummary } from "./types";

function toActiveGraphRunArtifactForTest(diagnostics: Record<string, any>): {
  recoveryEligibility?: { status?: string };
  continuationContract?: {
    handlingPolicy?: { kind?: string };
    verdict?: { status?: string };
    recoveryEvidence?: { source?: string; trust?: string };
    manualInputSlots?: Array<{ key?: string; valueType?: string }>;
  };
  controlPreconditionsContract?: {
    nonContinuableReasonKind?: string;
    explanation?: string;
    items?: Array<{
      kind?: string;
      status?: string;
      sourceKind?: string;
      conservativeSourceKind?: string;
    }>;
  };
  constraintSummary?: {
    heading?: string;
    explanation?: string;
    disclaimer?: string;
    capabilityBoundary?: string;
  };
  diagnosticsOverview?: { nodeDiagnostics?: GraphNodeDiagnosticsView[] };
} | null {
  const artifact =
    readGraphRunSnapshotEnvelope(diagnostics)?.snapshot.overview ??
    diagnostics?.bridge?.graph_run_overview;
  if (!artifact || typeof artifact !== "object") {
    return null;
  }
  const recovery = artifact.recoveryEligibility;
  const continuation =
    artifact.continuationContract &&
    typeof artifact.continuationContract === "object"
      ? artifact.continuationContract
      : null;
  const controlPreconditions =
    artifact.controlPreconditionsContract &&
    typeof artifact.controlPreconditionsContract === "object"
      ? artifact.controlPreconditionsContract
      : null;
  const constraintSummary =
    artifact.constraintSummary && typeof artifact.constraintSummary === "object"
      ? artifact.constraintSummary
      : null;
  const diagnosticsOverview =
    artifact.diagnosticsOverview &&
    typeof artifact.diagnosticsOverview === "object"
      ? artifact.diagnosticsOverview
      : null;
  return {
    recoveryEligibility:
      recovery &&
      typeof recovery === "object" &&
      (recovery.status === "eligible" ||
        recovery.status === "ineligible" ||
        recovery.status === "unknown")
        ? { status: recovery.status }
        : { status: "unknown" },
    continuationContract: continuation
      ? {
          handlingPolicy:
            continuation.handlingPolicy &&
            typeof continuation.handlingPolicy === "object"
              ? { kind: String(continuation.handlingPolicy.kind ?? "unknown") }
              : { kind: "unknown" },
          verdict:
            continuation.verdict && typeof continuation.verdict === "object"
              ? { status: String(continuation.verdict.status ?? "unknown") }
              : { status: "unknown" },
          recoveryEvidence:
            continuation.recoveryEvidence &&
            typeof continuation.recoveryEvidence === "object"
              ? {
                  source: String(
                    continuation.recoveryEvidence.source ?? "unknown",
                  ),
                  trust: String(
                    continuation.recoveryEvidence.trust ?? "unknown",
                  ),
                }
              : { source: "unknown", trust: "unknown" },
          manualInputSlots: Array.isArray(continuation.manualInputSlots)
            ? continuation.manualInputSlots.map((slot: unknown) => ({
                key:
                  slot && typeof slot === "object"
                    ? String((slot as Record<string, unknown>).key ?? "")
                    : "",
                valueType:
                  slot && typeof slot === "object"
                    ? String(
                        (slot as Record<string, unknown>).valueType ??
                          "unknown",
                      )
                    : "unknown",
              }))
            : [],
        }
      : {
          handlingPolicy: { kind: "unknown" },
          verdict: { status: "unknown" },
          recoveryEvidence: { source: "unknown", trust: "unknown" },
          manualInputSlots: [],
        },
    controlPreconditionsContract: controlPreconditions
      ? {
          nonContinuableReasonKind:
            controlPreconditions.nonContinuableReasonKind ===
              "terminal_completed" ||
            controlPreconditions.nonContinuableReasonKind ===
              "terminal_failed" ||
            controlPreconditions.nonContinuableReasonKind ===
              "terminal_cancelled" ||
            controlPreconditions.nonContinuableReasonKind ===
              "continuation_capability_not_inferred" ||
            controlPreconditions.nonContinuableReasonKind ===
              "control_action_surface_not_inferred" ||
            controlPreconditions.nonContinuableReasonKind ===
              "external_input_still_required" ||
            controlPreconditions.nonContinuableReasonKind ===
              "checkpoint_not_observed" ||
            controlPreconditions.nonContinuableReasonKind ===
              "insufficient_evidence" ||
            controlPreconditions.nonContinuableReasonKind === "unknown"
              ? String(controlPreconditions.nonContinuableReasonKind)
              : "unknown",
          explanation: String(controlPreconditions.explanation ?? ""),
          items: Array.isArray(controlPreconditions.items)
            ? controlPreconditions.items.map((item: unknown) => {
                const record =
                  item && typeof item === "object"
                    ? (item as Record<string, unknown>)
                    : null;
                return {
                  kind:
                    record?.kind === "external_input_observed" ||
                    record?.kind === "checkpoint_candidate_observed" ||
                    record?.kind === "run_not_terminal" ||
                    record?.kind === "continuation_capability_inference" ||
                    record?.kind === "control_action_surface_inference" ||
                    record?.kind === "unknown"
                      ? String(record.kind)
                      : "unknown",
                  status:
                    record?.status === "satisfied" ||
                    record?.status === "unsatisfied" ||
                    record?.status === "unknown"
                      ? String(record.status)
                      : "unknown",
                  sourceKind:
                    record?.sourceKind === "observed" ||
                    record?.sourceKind === "inferred" ||
                    record?.sourceKind === "host_limited"
                      ? String(record.sourceKind)
                      : "unknown",
                  conservativeSourceKind:
                    record?.conservativeSourceKind === "observed" ||
                    record?.conservativeSourceKind === "inferred" ||
                    record?.conservativeSourceKind === "host_limited"
                      ? String(record.conservativeSourceKind)
                      : "unknown",
                };
              })
            : [],
        }
      : {
          nonContinuableReasonKind: "unknown",
          explanation: "",
          items: [],
        },
    constraintSummary: constraintSummary
      ? {
          heading: String(constraintSummary.heading ?? ""),
          explanation: String(constraintSummary.explanation ?? ""),
          disclaimer: String(constraintSummary.disclaimer ?? ""),
          capabilityBoundary: String(
            constraintSummary.capabilityBoundary ?? "",
          ),
        }
      : {
          heading: "",
          explanation: "",
          disclaimer: "",
          capabilityBoundary: "",
        },
    diagnosticsOverview: diagnosticsOverview
      ? {
          nodeDiagnostics: Array.isArray(
            (diagnosticsOverview as Record<string, unknown>).nodeDiagnostics,
          )
            ? ((diagnosticsOverview as Record<string, unknown>)
                .nodeDiagnostics as GraphNodeDiagnosticsView[])
            : [],
        }
      : { nodeDiagnostics: [] },
  };
}

type MemoryStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

function ensureMemoryLocalStorage(): MemoryStorage {
  const existing = globalThis.localStorage as MemoryStorage | undefined;
  if (existing) {
    existing.clear();
    return existing;
  }

  const store = new Map<string, string>();
  const memoryStorage: MemoryStorage = {
    getItem: (key) => (store.has(key) ? (store.get(key) ?? null) : null),
    setItem: (key, value) => {
      store.set(String(key), String(value));
    },
    removeItem: (key) => {
      store.delete(String(key));
    },
    clear: () => {
      store.clear();
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage,
    configurable: true,
    writable: true,
  });

  return memoryStorage;
}

function makeBaseGraph(): WorkbenchGraph {
  return {
    id: "graph_test",
    name: "Validation Test",
    enabled: true,
    timing: "after_reply",
    priority: 0,
    viewport: { x: 0, y: 0, zoom: 1 },
    runtimeMeta: { schemaVersion: 1, runtimeKind: "dataflow" },
    nodes: [
      {
        id: "src_text",
        moduleId: "src_user_input",
        position: { x: 0, y: 0 },
        config: {},
        collapsed: false,
      },
      {
        id: "filter_text",
        moduleId: "flt_mvu_strip",
        position: { x: 200, y: 0 },
        config: {},
        collapsed: false,
      },
    ],
    edges: [
      {
        id: "edge_valid",
        source: "src_text",
        sourcePort: "text",
        target: "filter_text",
        targetPort: "text_in",
      },
    ],
  };
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type GraphValidationIssue = ReturnType<typeof validateGraph>["errors"][number];

function assertHasMessage(
  errors: GraphValidationIssue[],
  keyword: string,
): void {
  assert(
    errors.some((error) => error.message.includes(keyword)),
    `Expected validation error containing: ${keyword}. Actual: ${errors.map((error) => error.message).join(" | ")}`,
  );
}

function assertHasRef(
  errors: GraphValidationIssue[],
  predicate: (error: GraphValidationIssue) => boolean,
  label: string,
): void {
  assert(
    errors.some(predicate),
    `Expected validation error matching ${label}. Actual: ${errors.map((error) => JSON.stringify(error)).join(" | ")}`,
  );
}

function assertHasDiagnosticMessage(
  diagnostics: ReturnType<typeof validateGraph>["diagnostics"],
  keyword: string,
): void {
  assert(
    diagnostics.some((diagnostic) => diagnostic.message.includes(keyword)),
    `Expected validation diagnostic containing: ${keyword}. Actual: ${diagnostics.map((diagnostic) => diagnostic.message).join(" | ")}`,
  );
}

function assertNoMessage(
  errors: GraphValidationIssue[],
  keyword: string,
): void {
  assert(
    !errors.some((error) => error.message.includes(keyword)),
    `Expected no validation error containing: ${keyword}. Actual: ${errors.map((error) => error.message).join(" | ")}`,
  );
}

function makeExecutionContext(
  overrides: Partial<ExecutionContext> = {},
): ExecutionContext {
  return {
    requestId: "req_test",
    chatId: "chat_test",
    messageId: 1,
    userInput: "hello world",
    settings: {},
    ...overrides,
  };
}

function makePlanExecutionGraph(): WorkbenchGraph {
  return {
    id: "graph_plan_exec",
    name: "Plan Execution Graph",
    enabled: true,
    timing: "after_reply",
    priority: 0,
    viewport: { x: 0, y: 0, zoom: 1 },
    runtimeMeta: { schemaVersion: 1, runtimeKind: "dataflow" },
    nodes: [
      {
        id: "src_text",
        moduleId: "src_user_input",
        position: { x: 0, y: 0 },
        config: {},
        collapsed: false,
      },
      {
        id: "filter_text",
        moduleId: "flt_mvu_strip",
        position: { x: 240, y: 0 },
        config: {},
        collapsed: false,
      },
      {
        id: "out_reply",
        moduleId: "out_reply_inject",
        position: { x: 480, y: 0 },
        config: {},
        collapsed: false,
      },
    ],
    edges: [
      {
        id: "edge_src_to_filter",
        source: "src_text",
        sourcePort: "text",
        target: "filter_text",
        targetPort: "text_in",
      },
      {
        id: "edge_filter_to_out",
        source: "filter_text",
        sourcePort: "text_out",
        target: "out_reply",
        targetPort: "instruction",
      },
    ],
  };
}

function makeFingerprintMutationGraph(): WorkbenchGraph {
  const graph = makePlanExecutionGraph();
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === "filter_text"
        ? {
            ...node,
            config: {
              ...node.config,
              trimMode: "strict",
            },
          }
        : node,
    ),
  };
}

function makeDirtyPropagationGraph(): WorkbenchGraph {
  return {
    id: "graph_dirty_propagation",
    name: "Dirty Propagation Graph",
    enabled: true,
    timing: "after_reply",
    priority: 0,
    viewport: { x: 0, y: 0, zoom: 1 },
    runtimeMeta: { schemaVersion: 1, runtimeKind: "dataflow" },
    nodes: [
      {
        id: "src_text",
        moduleId: "src_user_input",
        position: { x: 0, y: 0 },
        config: {},
        collapsed: false,
      },
      {
        id: "filter_text",
        moduleId: "flt_mvu_strip",
        position: { x: 240, y: 0 },
        config: {},
        collapsed: false,
      },
      {
        id: "out_reply",
        moduleId: "out_reply_inject",
        position: { x: 480, y: 0 },
        config: {},
        collapsed: false,
      },
    ],
    edges: [
      {
        id: "edge_src_to_filter_dirty",
        source: "src_text",
        sourcePort: "text",
        target: "filter_text",
        targetPort: "text_in",
      },
      {
        id: "edge_filter_to_reply_dirty",
        source: "filter_text",
        sourcePort: "text_out",
        target: "out_reply",
        targetPort: "instruction",
      },
    ],
  };
}

function makeDispatchSmokeGraph(): WorkbenchGraph {
  return {
    id: "graph_dispatch_smoke",
    name: "Dispatch Smoke Graph",
    enabled: true,
    timing: "after_reply",
    priority: 0,
    viewport: { x: 0, y: 0, zoom: 1 },
    runtimeMeta: { schemaVersion: 1, runtimeKind: "dataflow" },
    nodes: [
      {
        id: "src_text",
        moduleId: "src_user_input",
        position: { x: 0, y: 0 },
        config: {},
        collapsed: false,
      },
      {
        id: "concat_text",
        moduleId: "cmp_message_concat",
        position: { x: 200, y: 0 },
        config: {},
        collapsed: false,
      },
      {
        id: "fallback_pkg",
        moduleId: "pkg_prompt_assembly",
        position: { x: 420, y: 0 },
        config: {},
        collapsed: false,
      },
    ],
    edges: [
      {
        id: "edge_src_to_concat",
        source: "src_text",
        sourcePort: "text",
        target: "concat_text",
        targetPort: "a",
      },
      {
        id: "edge_concat_to_pkg",
        source: "concat_text",
        sourcePort: "msgs_out",
        target: "fallback_pkg",
        targetPort: "messages",
      },
    ],
  };
}

function makeNetworkTerminalGraph(): WorkbenchGraph {
  return {
    id: "graph_network_terminal",
    name: "Network Terminal Graph",
    enabled: true,
    timing: "after_reply",
    priority: 0,
    viewport: { x: 0, y: 0, zoom: 1 },
    runtimeMeta: { schemaVersion: 1, runtimeKind: "dataflow" },
    nodes: [
      {
        id: "src_text",
        moduleId: "src_user_input",
        position: { x: 0, y: 0 },
        config: {},
        collapsed: false,
      },
      {
        id: "network_terminal",
        moduleId: "flt_mvu_strip",
        position: { x: 240, y: 0 },
        config: {},
        collapsed: false,
        runtimeMeta: {
          capability: "network",
          sideEffect: "unknown",
        },
      },
    ],
    edges: [
      {
        id: "edge_src_to_network_terminal",
        source: "src_text",
        sourcePort: "text",
        target: "network_terminal",
        targetPort: "text_in",
      },
    ],
  };
}

function makeHandlerFailureGraph(): WorkbenchGraph {
  return {
    id: "graph_handler_failure",
    name: "Handler Failure Graph",
    enabled: true,
    timing: "after_reply",
    priority: 0,
    viewport: { x: 0, y: 0, zoom: 1 },
    runtimeMeta: { schemaVersion: 1, runtimeKind: "dataflow" },
    nodes: [
      {
        id: "src_messages",
        moduleId: "src_chat_history",
        position: { x: 0, y: 0 },
        config: {},
        collapsed: false,
      },
      {
        id: "cfg_api",
        moduleId: "cfg_api_preset",
        position: { x: 0, y: 180 },
        config: {},
        collapsed: false,
      },
      {
        id: "llm_call",
        moduleId: "exe_llm_call",
        position: { x: 260, y: 0 },
        config: {},
        collapsed: false,
      },
    ],
    edges: [
      {
        id: "edge_messages_to_llm",
        source: "src_messages",
        sourcePort: "messages",
        target: "llm_call",
        targetPort: "messages",
      },
      {
        id: "edge_cfg_to_llm",
        source: "cfg_api",
        sourcePort: "config",
        target: "llm_call",
        targetPort: "api_config",
      },
    ],
  };
}

function makeSideEffectHandlerFailureGraph(): WorkbenchGraph {
  const graph = makeHandlerFailureGraph();
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === "llm_call"
        ? {
            ...node,
            runtimeMeta: {
              ...(node.runtimeMeta ?? {}),
              sideEffect: "writes_host",
            },
          }
        : node,
    ),
  };
}

function makeIntegratedSmokeGraph(): WorkbenchGraph {
  return {
    id: "graph_integrated_smoke",
    name: "Integrated Smoke Graph",
    enabled: true,
    timing: "after_reply",
    priority: 0,
    viewport: { x: 0, y: 0, zoom: 1 },
    runtimeMeta: { schemaVersion: 1, runtimeKind: "dataflow" },
    nodes: [
      {
        id: "src_text",
        moduleId: "src_user_input",
        position: { x: 0, y: 0 },
        config: {},
        collapsed: false,
      },
      {
        id: "filter_text",
        moduleId: "flt_mvu_strip",
        position: { x: 220, y: 0 },
        config: {},
        collapsed: false,
      },
      {
        id: "src_flow",
        moduleId: "src_flow_context",
        position: { x: 0, y: 180 },
        config: {},
        collapsed: false,
      },
      {
        id: "compose_body",
        moduleId: "cmp_json_body_build",
        position: { x: 440, y: 180 },
        config: { staticValue: "from_compose_config" },
        collapsed: false,
      },
      {
        id: "execute_normalize",
        moduleId: "exe_response_normalize",
        position: { x: 660, y: 180 },
        config: {},
        collapsed: false,
      },
      {
        id: "out_floor",
        moduleId: "out_floor_bind",
        position: { x: 880, y: 180 },
        config: {},
        collapsed: false,
      },
      {
        id: "out_reply",
        moduleId: "out_reply_inject",
        position: { x: 660, y: 0 },
        config: {},
        collapsed: false,
      },
    ],
    edges: [
      {
        id: "edge_src_to_filter",
        source: "src_text",
        sourcePort: "text",
        target: "filter_text",
        targetPort: "text_in",
      },
      {
        id: "edge_filter_to_reply",
        source: "filter_text",
        sourcePort: "text_out",
        target: "out_reply",
        targetPort: "instruction",
      },
      {
        id: "edge_flow_to_compose",
        source: "src_flow",
        sourcePort: "context",
        target: "compose_body",
        targetPort: "context",
      },
      {
        id: "edge_compose_to_execute",
        source: "compose_body",
        sourcePort: "body",
        target: "execute_normalize",
        targetPort: "raw",
      },
      {
        id: "edge_execute_to_floor",
        source: "execute_normalize",
        sourcePort: "normalized",
        target: "out_floor",
        targetPort: "result",
      },
    ],
  };
}

function assertPlanMatchesGraph(
  plan: GraphCompilePlan,
  graph: WorkbenchGraph,
): void {
  const nodesWithOutgoing = new Set(graph.edges.map((edge) => edge.source));

  assert(
    plan.nodeOrder.join(",") === graph.nodes.map((node) => node.id).join(","),
    `Expected compile plan node order to align with graph fixture order. Actual: ${plan.nodeOrder.join(",")}`,
  );

  assert(
    plan.nodes.every(
      (node, index) => node.order === index && node.sequence === index,
    ),
    `Expected compile plan nodes to carry stable sequential order metadata. Actual: ${plan.nodes.map((node) => `${node.nodeId}:${node.order}:${node.sequence}`).join(",")}`,
  );

  for (const planNode of plan.nodes) {
    const graphNode = graph.nodes.find((node) => node.id === planNode.nodeId);
    assert(
      graphNode?.moduleId === planNode.moduleId,
      `Expected compile plan node ${planNode.nodeId} to preserve moduleId. Actual: ${planNode.moduleId}`,
    );

    const expectedDependsOn = graph.edges
      .filter((edge) => edge.target === planNode.nodeId)
      .map((edge) => edge.source)
      .sort();
    const actualDependsOn = [...planNode.dependsOn].sort();
    assert(
      actualDependsOn.join(",") === expectedDependsOn.join(","),
      `Expected compile plan dependsOn for ${planNode.nodeId} to align with graph edges. Actual: ${actualDependsOn.join(",")}`,
    );

    const expectedIsTerminal = !nodesWithOutgoing.has(planNode.nodeId);
    assert(
      planNode.isTerminal === expectedIsTerminal,
      `Expected compile plan terminal flag for ${planNode.nodeId} to align with graph edges. Actual: ${planNode.isTerminal}`,
    );
  }
}

function makeLegacyFlowFixture(): EwFlowConfig {
  return {
    id: "legacy_flow_1",
    name: "Legacy Flow",
    enabled: true,
    timing: "after_reply",
    run_every_n_floors: 1,
    priority: 5,
    timeout_ms: 30_000,
    api_preset_id: "preset_default",
    generation_options: {
      unlock_context_length: false,
      max_context_tokens: 200000,
      max_reply_tokens: 4096,
      n_candidates: 1,
      stream: true,
      temperature: 0.7,
      frequency_penalty: 0,
      presence_penalty: 0,
      top_p: 0.92,
    },
    behavior_options: {
      name_behavior: "default",
      continue_prefill: false,
      squash_system_messages: false,
      enable_function_calling: false,
      send_inline_media: false,
      request_thinking: false,
      reasoning_effort: "auto",
      verbosity: "auto",
    },
    dyn_write: {
      mode: "overwrite",
      item_format: "markdown_list",
      activation_mode: "controller_only",
      profile: {
        comment: "",
        position: {
          type: "before_character_definition",
          role: "system",
          depth: 0,
          order: 100,
        },
        strategy: {
          type: "constant",
          keys: [],
          keys_secondary: {
            logic: "and_any",
            keys: [],
          },
          scan_depth: "same_as_global",
        },
        probability: 100,
        effect: {
          sticky: null,
          cooldown: null,
          delay: null,
        },
        extra: {
          caseSensitive: false,
          matchWholeWords: false,
          group: "",
          groupOverride: false,
          groupWeight: 100,
          useGroupScoring: false,
        },
      },
    },
    prompt_order: [
      {
        identifier: "main",
        name: "Main Prompt",
        enabled: true,
        type: "marker",
        role: "system",
        content: "",
        injection_position: "relative",
        injection_depth: 0,
      },
    ],
    prompt_items: [],
    api_url: "",
    api_key: "",
    context_turns: 6,
    extract_rules: [],
    exclude_rules: [],
    use_tavern_regex: false,
    custom_regex_rules: [],
    request_template: "",
    response_extract_regex: "",
    response_remove_regex: "",
    system_prompt: "System {{char}}",
    headers_json: "",
  };
}

function makeLegacyPromptContextFixture(): EwFlowConfig {
  return {
    ...makeLegacyFlowFixture(),
    id: "legacy_prompt_context_1",
    name: "Legacy Prompt Context Flow",
    enabled: false,
    timing: "before_reply",
    priority: 9,
    context_turns: 12,
    extract_rules: [
      {
        start: "<context>",
        end: "</context>",
      },
    ],
    exclude_rules: [
      {
        start: "<hidden>",
        end: "</hidden>",
      },
    ],
    system_prompt: "System {{char}}\nRemember {{user}}",
    custom_regex_rules: [
      {
        id: "regex_enabled_cleanup",
        name: "Cleanup enabled rule",
        enabled: true,
        find_regex: "foo(\\s+)bar",
        replace_string: "baz",
      },
      {
        id: "regex_disabled_passthrough",
        name: "Disabled passthrough rule",
        enabled: false,
        find_regex: "do-not-import",
        replace_string: "ignored",
      },
    ],
  };
}

function assertBridgeRoute(
  actual: WorkflowBridgeRouteSelection,
  expected: {
    route: WorkflowBridgeRouteSelection["route"];
    reason: WorkflowBridgeRouteSelection["reason"];
    enabledGraphIds: string[];
    hasExplicitLegacyFlowSelection: boolean;
  },
): void {
  assert(
    actual.route === expected.route,
    `Expected bridge route to be ${expected.route}. Actual: ${actual.route}`,
  );
  assert(
    actual.reason === expected.reason,
    `Expected bridge route reason to be ${expected.reason}. Actual: ${actual.reason}`,
  );
  assert(
    actual.hasExplicitLegacyFlowSelection ===
      expected.hasExplicitLegacyFlowSelection,
    `Expected hasExplicitLegacyFlowSelection to be ${expected.hasExplicitLegacyFlowSelection}. Actual: ${actual.hasExplicitLegacyFlowSelection}`,
  );
  assert(
    actual.enabledGraphs.map((graph) => graph.id).join(",") ===
      expected.enabledGraphIds.join(","),
    `Expected enabled graph ids to be ${expected.enabledGraphIds.join(",")}. Actual: ${actual.enabledGraphs.map((graph) => graph.id).join(",")}`,
  );
}

function assertBridgeDiagnostics(
  actual: Record<string, any>,
  expected: {
    route: WorkflowBridgeRouteSelection["route"];
    reason: WorkflowBridgeRouteSelection["reason"];
    hasExplicitLegacyFlowSelection: boolean;
    enabledGraphCount: number;
    selectedGraphIds?: string[];
    failureOrigin?:
      | "graph_dispatch"
      | "legacy_dispatch"
      | "legacy_merge"
      | "legacy_writeback"
      | "cancelled";
    graphDiagnostics?: {
      dirtyNodeCount: number;
      cleanNodeCount: number;
      reuseEligibleNodeCount: number;
      reuseIneligibleNodeCount: number;
      skipReuseOutputHitCount: number;
    };
  },
): void {
  const bridge = actual.bridge;
  assert(bridge && typeof bridge === "object", "Expected bridge diagnostics");
  assert(
    bridge.route === expected.route,
    `Expected bridge route diagnostics to be ${expected.route}. Actual: ${bridge.route}`,
  );
  assert(
    bridge.reason === expected.reason,
    `Expected bridge reason diagnostics to be ${expected.reason}. Actual: ${bridge.reason}`,
  );
  assert(
    bridge.has_explicit_legacy_flow_selection ===
      expected.hasExplicitLegacyFlowSelection,
    `Expected bridge has_explicit_legacy_flow_selection to be ${expected.hasExplicitLegacyFlowSelection}. Actual: ${bridge.has_explicit_legacy_flow_selection}`,
  );
  assert(
    bridge.enabled_graph_count === expected.enabledGraphCount,
    `Expected bridge enabled_graph_count to be ${expected.enabledGraphCount}. Actual: ${bridge.enabled_graph_count}`,
  );

  if (expected.route === "graph") {
    const actualSelectedGraphIds = Array.isArray(bridge.selected_graph_ids)
      ? bridge.selected_graph_ids
      : bridge.graph_context?.selected_graph_ids;
    assert(
      Array.isArray(actualSelectedGraphIds),
      `Expected graph route bridge diagnostics to expose selected_graph_ids. Actual: ${JSON.stringify(bridge)}`,
    );
    assert(
      actualSelectedGraphIds.join(",") ===
        (expected.selectedGraphIds ?? []).join(","),
      `Expected graph selected_graph_ids to be ${(expected.selectedGraphIds ?? []).join(",")}. Actual: ${actualSelectedGraphIds.join(",")}`,
    );
  } else {
    assert(
      bridge.graph_context === undefined,
      `Expected legacy bridge diagnostics to omit graph_context. Actual: ${JSON.stringify(bridge.graph_context)}`,
    );
  }

  assert(
    bridge.failure_origin === expected.failureOrigin,
    `Expected bridge failure_origin to be ${expected.failureOrigin}. Actual: ${bridge.failure_origin}`,
  );

  if (expected.graphDiagnostics) {
    const graphRunDiagnostics = bridge.graph_run_diagnostics;
    assert(
      graphRunDiagnostics && typeof graphRunDiagnostics === "object",
      `Expected bridge graph_run_diagnostics to exist. Actual: ${JSON.stringify(graphRunDiagnostics)}`,
    );
    assert(
      graphRunDiagnostics.dirty?.dirtyNodeCount ===
        expected.graphDiagnostics.dirtyNodeCount,
      `Expected bridge graph_run_diagnostics dirtyNodeCount to be ${expected.graphDiagnostics.dirtyNodeCount}. Actual: ${graphRunDiagnostics.dirty?.dirtyNodeCount}`,
    );
    assert(
      graphRunDiagnostics.dirty?.cleanNodeCount ===
        expected.graphDiagnostics.cleanNodeCount,
      `Expected bridge graph_run_diagnostics cleanNodeCount to be ${expected.graphDiagnostics.cleanNodeCount}. Actual: ${graphRunDiagnostics.dirty?.cleanNodeCount}`,
    );
    assert(
      graphRunDiagnostics.reuse?.eligibleNodeCount ===
        expected.graphDiagnostics.reuseEligibleNodeCount,
      `Expected bridge graph_run_diagnostics reuse eligible count to be ${expected.graphDiagnostics.reuseEligibleNodeCount}. Actual: ${graphRunDiagnostics.reuse?.eligibleNodeCount}`,
    );
    assert(
      graphRunDiagnostics.reuse?.ineligibleNodeCount ===
        expected.graphDiagnostics.reuseIneligibleNodeCount,
      `Expected bridge graph_run_diagnostics reuse ineligible count to be ${expected.graphDiagnostics.reuseIneligibleNodeCount}. Actual: ${graphRunDiagnostics.reuse?.ineligibleNodeCount}`,
    );
    assert(
      graphRunDiagnostics.executionDecision?.skipReuseOutputNodeIds?.length ===
        expected.graphDiagnostics.skipReuseOutputHitCount,
      `Expected bridge graph_run_diagnostics skipReuseOutputHitCount to be ${expected.graphDiagnostics.skipReuseOutputHitCount}. Actual: ${graphRunDiagnostics.executionDecision?.skipReuseOutputNodeIds?.length}`,
    );
  } else {
    assert(
      bridge.graph_run_diagnostics === undefined,
      `Expected bridge graph_run_diagnostics to be omitted. Actual: ${JSON.stringify(bridge.graph_run_diagnostics)}`,
    );
  }
}

function assertRunSummaryBridgeContract(
  actual: RunSummary | null,
  expected: {
    chatId: string;
    requestId: string;
    ok: boolean;
    reason: string;
    route: WorkflowBridgeRouteSelection["route"];
    bridgeReason: WorkflowBridgeRouteSelection["reason"];
    hasExplicitLegacyFlowSelection: boolean;
    enabledGraphCount: number;
    selectedGraphIds?: string[];
    failureOrigin?:
      | "graph_dispatch"
      | "legacy_dispatch"
      | "legacy_merge"
      | "legacy_writeback"
      | "cancelled";
    hasFailure: boolean;
  },
): void {
  assert(actual, "Expected run summary to exist");
  const summary = actual as RunSummary;
  assert(
    summary.chat_id === expected.chatId,
    `Expected summary.chat_id to be ${expected.chatId}. Actual: ${summary.chat_id}`,
  );
  assert(
    summary.request_id === expected.requestId,
    `Expected summary.request_id to be ${expected.requestId}. Actual: ${summary.request_id}`,
  );
  assert(
    summary.ok === expected.ok,
    `Expected summary.ok to be ${expected.ok}. Actual: ${summary.ok}`,
  );
  assert(
    summary.reason === expected.reason,
    `Expected summary.reason to be ${expected.reason}. Actual: ${summary.reason}`,
  );
  assertBridgeDiagnostics(summary.diagnostics, {
    route: expected.route,
    reason: expected.bridgeReason,
    hasExplicitLegacyFlowSelection: expected.hasExplicitLegacyFlowSelection,
    enabledGraphCount: expected.enabledGraphCount,
    selectedGraphIds: expected.selectedGraphIds,
    failureOrigin: expected.failureOrigin,
  });
  assert(
    Boolean(summary.failure) === expected.hasFailure,
    `Expected summary.failure presence to be ${expected.hasFailure}. Actual: ${JSON.stringify(summary.failure)}`,
  );
}

function createRunSummaryFixture(params: {
  chatId: string;
  requestId: string;
  ok: boolean;
  reason: string;
  bridgeDiagnostics: Record<string, any>;
  failure?: RunSummary["failure"];
}): RunSummary {
  return RunSummarySchema.parse({
    at: Date.now(),
    ok: params.ok,
    reason: params.reason,
    request_id: params.requestId,
    chat_id: params.chatId,
    flow_count: 1,
    elapsed_ms: 12,
    mode: "manual",
    diagnostics: params.bridgeDiagnostics,
    ...(params.failure ? { failure: params.failure } : {}),
  });
}

function readPersistedScriptStorage(): Record<string, unknown> {
  const raw = globalThis.localStorage?.getItem("evolution_world_assistant");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

async function runValidationSpec(): Promise<void> {
  ensureMemoryLocalStorage();
  setActivePinia(createPinia());
  resetGraphExecutorReuseStateForTesting();
  const validGraphValidation = validateGraph(makeBaseGraph());
  assert(
    validGraphValidation.errors.length === 0,
    "Expected valid graph to have no validation errors",
  );
  assert(
    validGraphValidation.diagnostics.length === 0,
    "Expected valid graph to have no validation diagnostics",
  );

  const missingSourcePortGraph = makeBaseGraph();
  missingSourcePortGraph.edges[0].sourcePort = "missing_port";
  assertHasMessage(
    validateGraph(missingSourcePortGraph).errors,
    "源端口(missing_port)不存在",
  );

  const invalidDirectionGraph = makeBaseGraph();
  invalidDirectionGraph.edges[0].targetPort = "text_out";
  assertHasMessage(validateGraph(invalidDirectionGraph).errors, "不是输入端口");

  const incompatibleTypeGraph = makeBaseGraph();
  incompatibleTypeGraph.nodes.push({
    id: "cfg_api",
    moduleId: "cfg_api_preset",
    position: { x: 0, y: 160 },
    config: {},
    collapsed: false,
  });
  incompatibleTypeGraph.edges = [
    {
      id: "edge_bad_type",
      source: "cfg_api",
      sourcePort: "config",
      target: "filter_text",
      targetPort: "text_in",
    },
  ];
  assertHasMessage(validateGraph(incompatibleTypeGraph).errors, "类型不兼容");

  const multipleIncomingGraph = makeBaseGraph();
  multipleIncomingGraph.nodes.push({
    id: "src_text_2",
    moduleId: "src_user_input",
    position: { x: 0, y: 160 },
    config: {},
    collapsed: false,
  });
  multipleIncomingGraph.edges.push({
    id: "edge_duplicate",
    source: "src_text_2",
    sourcePort: "text",
    target: "filter_text",
    targetPort: "text_in",
  });
  assertHasMessage(validateGraph(multipleIncomingGraph).errors, "不允许多入边");

  const duplicateNodeIdGraph = makeBaseGraph();
  duplicateNodeIdGraph.nodes.push({
    id: "src_text",
    moduleId: "src_chat_history",
    position: { x: 0, y: 200 },
    config: {},
    collapsed: false,
  });
  const duplicateNodeErrors = validateGraph(duplicateNodeIdGraph).errors;
  assertHasMessage(duplicateNodeErrors, "重复的节点 ID");
  assertHasRef(
    duplicateNodeErrors,
    (error) => error.nodeId === "src_text",
    "duplicate node ref",
  );

  const duplicateEdgeIdGraph = makeBaseGraph();
  duplicateEdgeIdGraph.nodes.push({
    id: "src_text_3",
    moduleId: "src_user_input",
    position: { x: 0, y: 240 },
    config: {},
    collapsed: false,
  });
  duplicateEdgeIdGraph.edges.push({
    id: "edge_valid",
    source: "src_text_3",
    sourcePort: "text",
    target: "filter_text",
    targetPort: "text_in",
  });
  const duplicateEdgeErrors = validateGraph(duplicateEdgeIdGraph).errors;
  assertHasMessage(duplicateEdgeErrors, "重复的连线 ID");
  assertHasRef(
    duplicateEdgeErrors,
    (error) => error.edgeId === "edge_valid",
    "duplicate edge ref",
  );

  const missingRequiredInputGraph = makeBaseGraph();
  missingRequiredInputGraph.edges = [];
  assertHasMessage(validateGraph(missingRequiredInputGraph).errors, "必要输入");

  const metadataRequiredConfigGraph = makeBaseGraph();
  metadataRequiredConfigGraph.nodes.push({
    id: "reply_output",
    moduleId: "out_reply_inject",
    position: { x: 420, y: 0 },
    config: {},
    collapsed: false,
  });
  metadataRequiredConfigGraph.edges.push({
    id: "edge_reply_output",
    source: "filter_text",
    sourcePort: "text_out",
    target: "reply_output",
    targetPort: "instruction",
  });
  const metadataRequiredConfigValidation = validateGraph(
    metadataRequiredConfigGraph,
  );
  assertHasMessage(
    metadataRequiredConfigValidation.errors,
    "metadata-required 配置字段",
  );
  assert(
    metadataRequiredConfigValidation.diagnostics.length === 0,
    `Expected required config validation to stay fatal-only. Actual diagnostics: ${metadataRequiredConfigValidation.diagnostics.map((diagnostic) => diagnostic.message).join(" | ")}`,
  );

  const unknownConfigKeyGraph = makeBaseGraph();
  unknownConfigKeyGraph.nodes.push({
    id: "reply_output_unknown_config",
    moduleId: "out_reply_inject",
    position: { x: 420, y: 0 },
    config: {
      target_slot: "reply.instruction",
      legacy_mode: true,
    },
    collapsed: false,
  });
  unknownConfigKeyGraph.edges.push({
    id: "edge_reply_output_unknown_config",
    source: "filter_text",
    sourcePort: "text_out",
    target: "reply_output_unknown_config",
    targetPort: "instruction",
  });
  const unknownConfigKeyValidation = validateGraph(unknownConfigKeyGraph);
  assertHasDiagnosticMessage(
    unknownConfigKeyValidation.diagnostics,
    "未知配置键",
  );
  assertHasDiagnosticMessage(
    unknownConfigKeyValidation.diagnostics,
    "allow_with_warning",
  );
  assertNoMessage(unknownConfigKeyValidation.errors, "未知配置键");

  const hostWriteMisplacedGraph = makeBaseGraph();
  hostWriteMisplacedGraph.nodes.push({
    id: "reply_output_misplaced",
    moduleId: "out_reply_inject",
    position: { x: 420, y: 0 },
    config: {
      target_slot: "reply.instruction",
    },
    collapsed: false,
  });
  hostWriteMisplacedGraph.nodes.push({
    id: "tail_strip",
    moduleId: "flt_mvu_strip",
    position: { x: 640, y: 0 },
    config: {},
    collapsed: false,
  });
  hostWriteMisplacedGraph.edges.push(
    {
      id: "edge_reply_output_misplaced_in",
      source: "filter_text",
      sourcePort: "text_out",
      target: "reply_output_misplaced",
      targetPort: "instruction",
    },
    {
      id: "edge_reply_output_misplaced_out",
      source: "reply_output_misplaced",
      sourcePort: "instruction",
      target: "tail_strip",
      targetPort: "text_in",
    },
  );
  const hostWriteMisplacedValidation = validateGraph(hostWriteMisplacedGraph);
  assertHasDiagnosticMessage(
    hostWriteMisplacedValidation.diagnostics,
    "host-write 提示",
  );
  assertNoMessage(hostWriteMisplacedValidation.errors, "host-write 提示");

  const metadataBackwardCompatibleGraph = makeBaseGraph();
  metadataBackwardCompatibleGraph.nodes.push({
    id: "composite_without_metadata",
    moduleId: "pkg_prompt_assembly",
    position: { x: 420, y: 160 },
    config: {
      legacy_payload: true,
    },
    collapsed: false,
  });
  const metadataBackwardCompatibleValidation = validateGraph(
    metadataBackwardCompatibleGraph,
  );
  assert(
    !metadataBackwardCompatibleValidation.errors.some(
      (error) =>
        error.nodeId === "composite_without_metadata" &&
        (error.message.includes("metadata-required") ||
          error.message.includes("未知配置键")),
    ) &&
      !metadataBackwardCompatibleValidation.diagnostics.some(
        (diagnostic) =>
          diagnostic.nodeId === "composite_without_metadata" &&
          (diagnostic.message.includes("metadata-required") ||
            diagnostic.message.includes("未知配置键")),
      ),
    `Expected module without pilot metadata to stay backward compatible for config validation. Actual errors: ${metadataBackwardCompatibleValidation.errors.map((error) => JSON.stringify(error)).join(" | ")} ; diagnostics: ${metadataBackwardCompatibleValidation.diagnostics.map((diagnostic) => JSON.stringify(diagnostic)).join(" | ")}`,
  );

  const cycleGraph = makeBaseGraph();
  cycleGraph.edges.push({
    id: "edge_cycle_back",
    source: "filter_text",
    sourcePort: "text_out",
    target: "src_text",
    targetPort: "text",
  });
  assertHasMessage(validateGraph(cycleGraph).errors, "循环依赖");

  const unknownNodeRefGraph = makeBaseGraph();
  unknownNodeRefGraph.edges[0].target = "missing_target";
  const unknownNodeErrors = validateGraph(unknownNodeRefGraph).errors;
  assertHasMessage(unknownNodeErrors, "不存在的目标节点");
  assertHasRef(
    unknownNodeErrors,
    (error) => error.edgeId === "edge_valid",
    "unknown target edge ref",
  );

  const unknownModuleGraph = makeBaseGraph();
  unknownModuleGraph.nodes[0].moduleId = "module_missing";
  const unknownModuleErrors = validateGraph(unknownModuleGraph).errors;
  assertHasMessage(unknownModuleErrors, "未知的模块类型");
  assertHasRef(
    unknownModuleErrors,
    (error) => error.nodeId === "src_text",
    "unknown module node ref",
  );
  const compilePlanFixture = compileGraphPlan(makePlanExecutionGraph());
  const compilePlanFixtureRepeat = compileGraphPlan(makePlanExecutionGraph());
  const fingerprintMutationPlan = compileGraphPlan(
    makeFingerprintMutationGraph(),
  );
  assertPlanMatchesGraph(compilePlanFixture, makePlanExecutionGraph());
  assert(
    compilePlanFixture.fingerprintVersion === 1,
    `Expected compile plan fingerprintVersion to be 1. Actual: ${compilePlanFixture.fingerprintVersion}`,
  );
  assert(
    compilePlanFixture.compileFingerprint ===
      compilePlanFixtureRepeat.compileFingerprint,
    `Expected compileFingerprint to stay stable for identical graph compile. Actual: ${compilePlanFixture.compileFingerprint} vs ${compilePlanFixtureRepeat.compileFingerprint}`,
  );
  assert(
    compilePlanFixture.nodes.every(
      (node, index) =>
        node.nodeFingerprint ===
        compilePlanFixtureRepeat.nodes[index]?.nodeFingerprint,
    ),
    `Expected nodeFingerprint to stay stable for identical graph compile. Actual: ${compilePlanFixture.nodes.map((node) => node.nodeFingerprint).join(",")} vs ${compilePlanFixtureRepeat.nodes.map((node) => node.nodeFingerprint).join(",")}`,
  );
  assert(
    compilePlanFixture.compileFingerprint !==
      fingerprintMutationPlan.compileFingerprint,
    `Expected compileFingerprint to change when graph structure/compile semantics change. Actual: ${compilePlanFixture.compileFingerprint} vs ${fingerprintMutationPlan.compileFingerprint}`,
  );
  assert(
    compilePlanFixture.nodes.find((node) => node.nodeId === "filter_text")
      ?.nodeFingerprint !==
      fingerprintMutationPlan.nodes.find(
        (node) => node.nodeId === "filter_text",
      )?.nodeFingerprint,
    `Expected mutated nodeFingerprint to change for affected node. Actual: ${compilePlanFixture.nodes.find((node) => node.nodeId === "filter_text")?.nodeFingerprint} vs ${fingerprintMutationPlan.nodes.find((node) => node.nodeId === "filter_text")?.nodeFingerprint}`,
  );
  assert(
    compilePlanFixture.nodes.find((node) => node.nodeId === "src_text")
      ?.nodeFingerprint ===
      fingerprintMutationPlan.nodes.find((node) => node.nodeId === "src_text")
        ?.nodeFingerprint,
    `Expected unaffected nodeFingerprint to remain stable. Actual: ${compilePlanFixture.nodes.find((node) => node.nodeId === "src_text")?.nodeFingerprint} vs ${fingerprintMutationPlan.nodes.find((node) => node.nodeId === "src_text")?.nodeFingerprint}`,
  );
  assert(
    compilePlanFixture.terminalNodeIds.join(",") === "out_reply",
    `Expected compile plan terminal node to be out_reply. Actual: ${compilePlanFixture.terminalNodeIds.join(",")}`,
  );
  assert(
    compilePlanFixture.sideEffectNodeIds.join(",") === "out_reply",
    `Expected compile plan side-effect node to be out_reply. Actual: ${compilePlanFixture.sideEffectNodeIds.join(",")}`,
  );
  assert(
    compilePlanFixture.nodes
      .map(
        (node) =>
          `${node.nodeId}:${node.isTerminal}:${node.isSideEffectNode}:${node.capability}:${node.sideEffect}`,
      )
      .join(",") ===
      "src_text:false:false:source:reads_host,filter_text:false:false:pure:pure,out_reply:true:true:writes_host:writes_host",
    `Expected terminal/side-effect smoke flags to be stable in compile plan. Actual: ${compilePlanFixture.nodes
      .map(
        (node) =>
          `${node.nodeId}:${node.isTerminal}:${node.isSideEffectNode}:${node.capability}:${node.sideEffect}`,
      )
      .join(",")}`,
  );
  assert(
    compilePlanFixture.nodes
      .map(
        (node) =>
          `${node.nodeId}:${node.hostWriteSummary?.targetType ?? "none"}:${node.hostWriteSummary?.operation ?? "none"}`,
      )
      .join(",") ===
      "src_text:none:none,filter_text:none:none,out_reply:reply_instruction:inject_reply_instruction",
    `Expected compile plan hostWriteSummary to stay limited to out_reply_inject. Actual: ${compilePlanFixture.nodes
      .map(
        (node) =>
          `${node.nodeId}:${node.hostWriteSummary?.targetType ?? "none"}:${node.hostWriteSummary?.operation ?? "none"}`,
      )
      .join(",")}`,
  );
  assert(
    compilePlanFixture.nodes
      .map(
        (node) =>
          `${node.nodeId}:${node.hostCommitSummary?.targetType ?? "none"}:${node.hostCommitSummary?.operation ?? "none"}:${node.hostCommitSummary?.mode ?? "none"}`,
      )
      .join(",") ===
      "src_text:none:none:none,filter_text:none:none:none,out_reply:reply_instruction:inject_reply_instruction:immediate",
    `Expected compile plan hostCommitSummary to stay limited to out_reply_inject. Actual: ${compilePlanFixture.nodes
      .map(
        (node) =>
          `${node.nodeId}:${node.hostCommitSummary?.targetType ?? "none"}:${node.hostCommitSummary?.operation ?? "none"}:${node.hostCommitSummary?.mode ?? "none"}`,
      )
      .join(",")}`,
  );
  const graphExecutionStages: GraphExecutionStage[] = [
    "validate",
    "compile",
    "execute",
  ];
  assert(
    graphExecutionStages.join(",") === "validate,compile,execute",
    `Expected GraphExecutionStage to remain unchanged without commit stage. Actual: ${graphExecutionStages.join(",")}`,
  );

  const networkTerminalPlan = compileGraphPlan(makeNetworkTerminalGraph());
  assert(
    networkTerminalPlan.terminalNodeIds.join(",") === "network_terminal",
    `Expected terminal network plan to mark network_terminal as terminal. Actual: ${networkTerminalPlan.terminalNodeIds.join(",")}`,
  );
  assert(
    networkTerminalPlan.sideEffectNodeIds.length === 0,
    `Expected network capability not to enter sideEffectNodeIds. Actual: ${networkTerminalPlan.sideEffectNodeIds.join(",")}`,
  );
  assert(
    networkTerminalPlan.nodes
      .map(
        (node) =>
          `${node.nodeId}:${node.isSideEffectNode}:${node.capability}:${node.sideEffect}`,
      )
      .join(",") ===
      "src_text:false:source:reads_host,network_terminal:false:network:unknown",
    `Expected network terminal compile plan to preserve capability while keeping legacy sideEffect conservative. Actual: ${networkTerminalPlan.nodes
      .map(
        (node) =>
          `${node.nodeId}:${node.isSideEffectNode}:${node.capability}:${node.sideEffect}`,
      )
      .join(",")}`,
  );

  const planExecutionGraph = makePlanExecutionGraph();
  const reversedGraph = {
    ...planExecutionGraph,
    nodes: [...planExecutionGraph.nodes].reverse(),
  };
  const reversedPlan = compileGraphPlan(reversedGraph);
  const progressEvents: Array<Record<string, any>> = [];
  const compiledExecution = await executeCompiledGraph(
    planExecutionGraph,
    reversedPlan,
    makeExecutionContext({
      onProgress: (update) => {
        progressEvents.push(update);
      },
    }),
  );
  assert(
    compiledExecution.moduleResults.map((result) => result.nodeId).join(",") ===
      reversedPlan.nodeOrder.join(","),
    `Expected executeCompiledGraph to follow compile plan nodeOrder. Actual: ${compiledExecution.moduleResults.map((result) => result.nodeId).join(",")}`,
  );
  assert(
    compiledExecution.moduleResults.every(
      (result) =>
        result.nodeFingerprint ===
        reversedPlan.nodes.find((node) => node.nodeId === result.nodeId)
          ?.nodeFingerprint,
    ),
    `Expected executeCompiledGraph moduleResults to preserve compile-plan nodeFingerprint. Actual: ${compiledExecution.moduleResults.map((result) => `${result.nodeId}:${result.nodeFingerprint}`).join(",")}`,
  );
  assert(
    compiledExecution.nodeTraces?.every(
      (trace) =>
        trace.nodeFingerprint ===
        reversedPlan.nodes.find((node) => node.nodeId === trace.nodeId)
          ?.nodeFingerprint,
    ) === true,
    `Expected executeCompiledGraph nodeTraces to preserve compile-plan nodeFingerprint. Actual: ${compiledExecution.nodeTraces?.map((trace) => `${trace.nodeId}:${trace.nodeFingerprint}`).join(",")}`,
  );
  assert(
    compiledExecution.moduleResults
      .map(
        (result) =>
          `${result.nodeId}:${result.isSideEffectNode}:${result.capability}`,
      )
      .join(",") ===
      "src_text:false:source,filter_text:false:pure,out_reply:true:writes_host",
    `Expected executeCompiledGraph capability markers to come from compile plan. Actual: ${compiledExecution.moduleResults.map((result) => `${result.nodeId}:${result.isSideEffectNode}:${result.capability}`).join(",")}`,
  );
  assert(
    Object.keys(compiledExecution.finalOutputs).length === 0,
    `Expected executeCompiledGraph to exclude side-effect terminal nodes from finalOutputs. Actual keys: ${Object.keys(compiledExecution.finalOutputs).join(",")}`,
  );
  assert(
    progressEvents.map((event) => event.node_id).join(",") ===
      reversedPlan.nodeOrder.join(","),
    `Expected dispatch-backed progress events to follow compile plan order. Actual: ${progressEvents.map((event) => event.node_id).join(",")}`,
  );
  assert(
    progressEvents.map((event) => event.module_id).join(",") ===
      reversedPlan.nodes.map((node) => node.moduleId).join(","),
    `Expected dispatch-backed progress events to preserve module ids. Actual: ${progressEvents.map((event) => event.module_id).join(",")}`,
  );
  assert(
    compiledExecution.moduleResults
      .map(
        (result) =>
          `${result.nodeId}:${result.hostWrites?.length ?? 0}:${result.hostWriteSummary?.targetType ?? "none"}`,
      )
      .join(",") ===
      "src_text:0:none,filter_text:0:none,out_reply:1:reply_instruction",
    `Expected executeCompiledGraph moduleResults to expose host write descriptors only for out_reply_inject. Actual: ${compiledExecution.moduleResults
      .map(
        (result) =>
          `${result.nodeId}:${result.hostWrites?.length ?? 0}:${result.hostWriteSummary?.targetType ?? "none"}`,
      )
      .join(",")}`,
  );
  assert(
    compiledExecution.hostWrites?.length === 1 &&
      compiledExecution.hostWrites[0]?.targetType === "reply_instruction" &&
      compiledExecution.hostWrites[0]?.operation === "inject_reply_instruction",
    `Expected executeCompiledGraph to aggregate graph-level hostWrites. Actual: ${JSON.stringify(compiledExecution.hostWrites)}`,
  );
  assert(
    compiledExecution.hostCommitContracts?.length === 1 &&
      compiledExecution.hostCommitContracts[0]?.targetType ===
        "reply_instruction" &&
      compiledExecution.hostCommitContracts[0]?.operation ===
        "inject_reply_instruction" &&
      compiledExecution.hostCommitContracts[0]?.supportsRetry === false,
    `Expected executeCompiledGraph to aggregate graph-level hostCommitContracts. Actual: ${JSON.stringify(compiledExecution.hostCommitContracts)}`,
  );
  assert(
    compiledExecution.moduleResults
      .map(
        (result) =>
          `${result.nodeId}:${result.hostCommitContracts?.length ?? 0}:${result.hostCommitSummary?.targetType ?? "none"}`,
      )
      .join(",") ===
      "src_text:0:none,filter_text:0:none,out_reply:1:reply_instruction",
    `Expected executeCompiledGraph moduleResults to expose hostCommitContracts only for out_reply_inject. Actual: ${compiledExecution.moduleResults
      .map(
        (result) =>
          `${result.nodeId}:${result.hostCommitContracts?.length ?? 0}:${result.hostCommitSummary?.targetType ?? "none"}`,
      )
      .join(",")}`,
  );
  const replyTrace = compiledExecution.nodeTraces?.find(
    (trace) => trace.nodeId === "out_reply" && trace.stage === "execute",
  );
  assert(
    replyTrace?.hostWrites?.length === 1 &&
      replyTrace.hostWrites[0]?.targetType === "reply_instruction" &&
      replyTrace.hostWriteSummary?.targetType === "reply_instruction" &&
      replyTrace.hostCommitContracts?.length === 1 &&
      replyTrace.hostCommitContracts[0]?.targetType === "reply_instruction" &&
      replyTrace.hostCommitContracts[0]?.operation ===
        "inject_reply_instruction" &&
      replyTrace.hostCommitContracts[0]?.supportsRetry === false &&
      replyTrace.hostCommitSummary?.targetType === "reply_instruction" &&
      replyTrace.hostCommitSummary?.mode === "immediate",
    `Expected writes_host execute trace to expose hostWrites/hostCommitContracts and summaries. Actual: ${JSON.stringify(replyTrace)}`,
  );

  const networkTerminalExecution = await executeCompiledGraph(
    makeNetworkTerminalGraph(),
    networkTerminalPlan,
    makeExecutionContext(),
  );
  assert(
    Object.keys(networkTerminalExecution.finalOutputs).join(",") ===
      "network_terminal",
    `Expected terminal network node to remain in finalOutputs. Actual keys: ${Object.keys(networkTerminalExecution.finalOutputs).join(",")}`,
  );
  assert(
    networkTerminalExecution.moduleResults
      .map(
        (result) =>
          `${result.nodeId}:${result.isSideEffectNode}:${result.capability}`,
      )
      .join(",") === "src_text:false:source,network_terminal:false:network",
    `Expected terminal network execution to keep network out of side-effect execution set. Actual: ${networkTerminalExecution.moduleResults
      .map(
        (result) =>
          `${result.nodeId}:${result.isSideEffectNode}:${result.capability}`,
      )
      .join(",")}`,
  );
  assert(
    networkTerminalPlan.nodes.every(
      (node) => node.hostWriteSummary === undefined,
    ),
    `Expected network compile plan not to expose hostWriteSummary. Actual: ${JSON.stringify(networkTerminalPlan.nodes)}`,
  );
  assert(
    networkTerminalExecution.hostWrites?.length === 0 &&
      networkTerminalExecution.moduleResults.every(
        (result) => (result.hostWrites?.length ?? 0) === 0,
      ) &&
      networkTerminalExecution.nodeTraces?.every(
        (trace) => (trace.hostWrites?.length ?? 0) === 0,
      ) === true,
    `Expected network execution not to expose host write descriptors. Actual: ${JSON.stringify(networkTerminalExecution)}`,
  );
  assert(
    networkTerminalExecution.hostCommitContracts?.length === 0 &&
      networkTerminalExecution.moduleResults.every(
        (result) => (result.hostCommitContracts?.length ?? 0) === 0,
      ) &&
      networkTerminalExecution.nodeTraces?.every(
        (trace) => (trace.hostCommitContracts?.length ?? 0) === 0,
      ) === true,
    `Expected network execution not to expose host commit contracts. Actual: ${JSON.stringify(networkTerminalExecution)}`,
  );

  const dispatchSmokeGraph = makeDispatchSmokeGraph();
  const dispatchSmokePlan = compileGraphPlan(dispatchSmokeGraph);
  const dispatchSmokeExecution = await executeCompiledGraph(
    dispatchSmokeGraph,
    dispatchSmokePlan,
    makeExecutionContext({ userInput: "dispatch smoke" }),
  );
  assert(
    dispatchSmokeExecution.moduleResults
      .map((result) => result.nodeId)
      .join(",") === dispatchSmokePlan.nodeOrder.join(","),
    `Expected dispatch smoke execution to preserve plan order. Actual: ${dispatchSmokeExecution.moduleResults.map((result) => result.nodeId).join(",")}`,
  );
  assert(
    JSON.stringify(
      dispatchSmokeExecution.finalOutputs.fallback_pkg?.messages,
    ) === JSON.stringify([]),
    `Expected dispatch smoke fallback output to preserve registered handler input normalization. Actual: ${JSON.stringify(dispatchSmokeExecution.finalOutputs.fallback_pkg)}`,
  );
  assert(
    dispatchSmokeExecution.moduleResults.every(
      (result) => result.status === "ok",
    ),
    `Expected dispatch smoke results to stay ok. Actual: ${dispatchSmokeExecution.moduleResults.map((result) => `${result.nodeId}:${result.status}`).join(",")}`,
  );
  assert(
    dispatchSmokeExecution.nodeTraces?.every(
      (trace) =>
        trace.stage !== "execute" ||
        (typeof trace.handlerId === "string" &&
          typeof trace.durationMs === "number" &&
          trace.durationMs >= 0 &&
          typeof trace.isFallback === "boolean"),
    ) === true,
    `Expected execute traces to expose handlerId/durationMs/isFallback. Actual: ${JSON.stringify(dispatchSmokeExecution.nodeTraces)}`,
  );
  const fallbackTrace = dispatchSmokeExecution.nodeTraces?.find(
    (trace) => trace.nodeId === "fallback_pkg" && trace.stage === "execute",
  );
  assert(
    fallbackTrace?.isFallback === true &&
      fallbackTrace.handlerId === "__fallback__",
    `Expected fallback node trace to expose fallback observability. Actual: ${JSON.stringify(fallbackTrace)}`,
  );
  assert(
    fallbackTrace?.inputKeys?.join(",") === "messages",
    `Expected fallback node trace to expose collected input keys. Actual: ${JSON.stringify(fallbackTrace?.inputKeys)}`,
  );
  assert(
    (fallbackTrace?.hostWrites?.length ?? 0) === 0,
    `Expected fallback trace not to expose hostWrites. Actual: ${JSON.stringify(fallbackTrace)}`,
  );
  assert(
    dispatchSmokeExecution.hostWrites?.length === 0,
    `Expected fallback graph not to expose graph-level hostWrites. Actual: ${JSON.stringify(dispatchSmokeExecution.hostWrites)}`,
  );

  const dualHostGraphFixture = makeIntegratedSmokeGraph();
  const dualHostGraph = {
    ...dualHostGraphFixture,
    nodes: [
      ...dualHostGraphFixture.nodes,
      {
        id: "out_reply_2",
        moduleId: "out_reply_inject",
        position: { x: 900, y: 0 },
        config: {},
        collapsed: false,
      },
    ],
    edges: [
      ...dualHostGraphFixture.edges,
      {
        id: "edge_filter_to_reply_2",
        source: "filter_text",
        sourcePort: "text_out",
        target: "out_reply_2",
        targetPort: "instruction",
      },
    ],
  };
  const dualHostPlan = compileGraphPlan(dualHostGraph);
  assert(
    dualHostPlan.nodes
      .filter((node) => node.hostWriteSummary)
      .map((node) => `${node.nodeId}:${node.hostWriteSummary?.targetType}`)
      .join(",") ===
      "out_reply:reply_instruction,out_reply_2:reply_instruction",
    `Expected compile plan hostWriteSummary coverage to stay within reply inject nodes. Actual: ${dualHostPlan.nodes
      .filter((node) => node.hostWriteSummary)
      .map((node) => `${node.nodeId}:${node.hostWriteSummary?.targetType}`)
      .join(",")}`,
  );
  assert(
    dualHostPlan.nodes.some((node) => node.nodeId === "out_floor") &&
      dualHostPlan.nodes.find((node) => node.nodeId === "out_floor")
        ?.hostWriteSummary === undefined,
    `Expected out_floor to remain writes_host without compile-time descriptor summary. Actual: ${JSON.stringify(dualHostPlan.nodes.find((node) => node.nodeId === "out_floor"))}`,
  );
  const dualHostExecution = await executeCompiledGraph(
    dualHostGraph,
    dualHostPlan,
    makeExecutionContext(),
  );
  assert(
    dualHostExecution.hostWrites?.length === 2,
    `Expected dual reply-inject graph to aggregate only reply descriptors. Actual: ${JSON.stringify(dualHostExecution.hostWrites)}`,
  );
  assert(
    dualHostExecution.moduleResults
      .filter((result) => (result.hostWrites?.length ?? 0) > 0)
      .map(
        (result) =>
          `${result.nodeId}:${result.hostWrites?.[0]?.targetType}:${result.hostWrites?.[0]?.operation}`,
      )
      .join(",") ===
      "out_reply:reply_instruction:inject_reply_instruction,out_reply_2:reply_instruction:inject_reply_instruction",
    `Expected runtime hostWrites to stay limited to reply inject nodes. Actual: ${dualHostExecution.moduleResults
      .filter((result) => (result.hostWrites?.length ?? 0) > 0)
      .map(
        (result) =>
          `${result.nodeId}:${result.hostWrites?.[0]?.targetType}:${result.hostWrites?.[0]?.operation}`,
      )
      .join(",")}`,
  );
  assert(
    dualHostExecution.hostCommitContracts?.length === 2 &&
      dualHostExecution.hostCommitContracts.every(
        (contract) =>
          contract.targetType === "reply_instruction" &&
          contract.operation === "inject_reply_instruction" &&
          contract.supportsRetry === false,
      ),
    `Expected dual reply-inject graph to aggregate only reply commit contracts. Actual: ${JSON.stringify(dualHostExecution.hostCommitContracts)}`,
  );
  assert(
    dualHostExecution.moduleResults.some(
      (result) =>
        result.nodeId === "out_floor" &&
        (result.hostWrites?.length ?? 0) === 0 &&
        (result.hostCommitContracts?.length ?? 0) === 0 &&
        result.capability === "writes_host" &&
        result.hostWriteSummary === undefined &&
        result.hostCommitSummary === undefined,
    ),
    `Expected out_floor module result to keep writes_host capability while producing no descriptor/contract. Actual: ${JSON.stringify(dualHostExecution.moduleResults.find((result) => result.nodeId === "out_floor"))}`,
  );
  assert(
    Object.keys(dualHostExecution.finalOutputs).length === 0,
    `Expected finalOutputs behavior to remain conservative with writes_host terminals. Actual: ${Object.keys(dualHostExecution.finalOutputs).join(",")}`,
  );

  const observationReadyGraph = {
    ...makeBaseGraph(),
    nodes: makeBaseGraph().nodes.map((node) =>
      node.id === "filter_text"
        ? {
            ...node,
            config: {
              ...node.config,
              observationState: "waiting_user",
              waitingUserReason: "需要用户确认后续执行",
            },
          }
        : node,
    ),
  };

  const successResult = await executeGraph(
    observationReadyGraph,
    makeExecutionContext(),
  );
  assert(successResult.ok, "Expected executeGraph to succeed for valid graph");
  assert(
    successResult.runState.status === "completed" &&
      successResult.runState.phase === "terminal" &&
      successResult.runState.phaseLabel === "已完成" &&
      successResult.runState.terminalOutcome === "completed" &&
      successResult.runState.currentStage === "execute" &&
      successResult.runState.graphId === "graph_test" &&
      successResult.runState.runId === successResult.requestId,
    `Expected success runState to remain completed with terminal read-only semantics even when waiting_user observation is emitted, while preserving requestId mapping. Actual: ${JSON.stringify(successResult.runState)}`,
  );
  assert(
    successResult.runArtifact?.status === "completed" &&
      successResult.runArtifact?.phase === "terminal" &&
      successResult.runArtifact?.terminalOutcome === "completed" &&
      !successResult.runArtifact?.blockingReason &&
      successResult.runArtifact?.graphId === "graph_test" &&
      successResult.runArtifact?.currentStage === "execute" &&
      successResult.runArtifact?.latestNodeId === "filter_text" &&
      successResult.runArtifact?.latestNodeStatus === "finished" &&
      typeof successResult.runArtifact?.latestHeartbeat?.timestamp ===
        "number" &&
      typeof successResult.runArtifact?.latestPartialOutput?.length ===
        "number" &&
      successResult.runArtifact?.waitingUser?.reason ===
        "需要用户确认后续执行" &&
      successResult.runArtifact?.recoveryEligibility?.status === "ineligible" &&
      successResult.runArtifact?.recoveryEligibility?.source ===
        "terminal_state" &&
      successResult.runArtifact?.continuationContract?.handlingPolicy.kind ===
        "system_side_not_continuable" &&
      successResult.runArtifact?.continuationContract?.verdict.status ===
        "not_continuable" &&
      successResult.runArtifact?.continuationContract?.recoveryEvidence
        .source === "terminal_state" &&
      successResult.runArtifact?.continuationContract?.recoveryEvidence
        .trust === "strong" &&
      Array.isArray(
        successResult.runArtifact?.continuationContract?.manualInputSlots,
      ) &&
      successResult.runArtifact?.continuationContract?.manualInputSlots
        .length === 0 &&
      !successResult.runArtifact?.blockingContract,
    `Expected success runArtifact to preserve waiting_user as read-only observation while final status remains completed. Actual: ${JSON.stringify(successResult.runArtifact)}`,
  );
  const waitingUserEvent = (successResult.runEvents ?? []).find(
    (event) => event.type === "waiting_user",
  );
  assert(
    waitingUserEvent?.blockingContract?.kind === "waiting_user" &&
      waitingUserEvent.blockingContract.requiresHumanInput === true &&
      waitingUserEvent.blockingContract.inputRequirement.type ===
        "confirmation" &&
      waitingUserEvent.recoveryEligibility?.status === "eligible" &&
      waitingUserEvent.recoveryEligibility?.source === "checkpoint_candidate" &&
      waitingUserEvent.continuationContract?.handlingPolicy.kind ===
        "external_input_observed" &&
      waitingUserEvent.continuationContract?.verdict.status ===
        "blocked_by_external_input" &&
      waitingUserEvent.continuationContract?.recoveryEvidence.source ===
        "checkpoint_candidate" &&
      waitingUserEvent.continuationContract?.recoveryEvidence.trust ===
        "limited" &&
      waitingUserEvent.controlPreconditionsContract?.items?.length === 5 &&
      waitingUserEvent.controlPreconditionsContract?.items?.some(
        (item) =>
          item.kind === "checkpoint_candidate_observed" &&
          item.status === "satisfied" &&
          item.sourceKind === "observed" &&
          item.conservativeSourceKind === "observed",
      ) &&
      waitingUserEvent.controlPreconditionsContract?.items?.some(
        (item) =>
          item.kind === "continuation_capability_inference" &&
          item.status === "unknown" &&
          item.sourceKind === "host_limited",
      ) &&
      waitingUserEvent.controlPreconditionsContract
        ?.nonContinuableReasonKind === "continuation_capability_not_inferred" &&
      waitingUserEvent.constraintSummary?.disclaimer?.includes(
        "不是恢复承诺",
      ) &&
      waitingUserEvent.artifact?.blockingContract?.kind === "waiting_user" &&
      waitingUserEvent.artifact?.continuationContract?.manualInputSlots?.[0]
        ?.key === "observed_waiting_user_input" &&
      waitingUserEvent.artifact?.continuationContract?.manualInputSlots?.[0]
        ?.valueType === "confirmation" &&
      waitingUserEvent.artifact?.controlPreconditionsContract?.items?.some(
        (item) =>
          item.kind === "control_action_surface_inference" &&
          item.status === "unknown" &&
          item.sourceKind === "host_limited",
      ) &&
      waitingUserEvent.artifact?.constraintSummary?.capabilityBoundary?.includes(
        "control edge",
      ) &&
      waitingUserEvent.artifact?.recoveryEligibility?.status === "eligible",
    `Expected waiting_user event to expose blocking contract plus conservative control-precondition explanation. Actual: ${JSON.stringify(waitingUserEvent)}`,
  );
  const waitingUserNoCheckpointArtifact = toActiveGraphRunArtifactForTest({
    bridge: {
      graph_run_overview: {
        runId: "req_waiting_no_checkpoint",
        graphId: "graph_test",
        status: "waiting_user",
        phase: "blocked",
        phaseLabel: "阻塞中",
        waitingUser: {
          timestamp: Date.now(),
          reason: "需要用户输入补充描述",
        },
        controlPreconditionsContract: {
          items: [
            {
              kind: "external_input_observed",
              status: "satisfied",
              sourceKind: "observed",
              conservativeSourceKind: "observed",
            },
            {
              kind: "checkpoint_candidate_observed",
              status: "unknown",
              sourceKind: "inferred",
              conservativeSourceKind: "inferred",
            },
            {
              kind: "continuation_capability_inference",
              status: "unknown",
              sourceKind: "host_limited",
              conservativeSourceKind: "host_limited",
            },
          ],
          nonContinuableReasonKind: "checkpoint_not_observed",
          explanation:
            "当前未观察到 checkpoint candidate，且只读解释层无法从现有事实推出 continuation / resume 能力。",
        },
        constraintSummary: {
          heading: "控制前提说明（只读）",
          explanation: "仅为约束说明。",
          disclaimer: "不是恢复承诺。",
          capabilityBoundary: "不是控制动作能力。",
        },
        recoveryEligibility: {
          status: "unknown",
          source: "waiting_user",
          label: "恢复资格未知",
        },
      },
    },
  });
  assert(
    waitingUserNoCheckpointArtifact?.recoveryEligibility?.status ===
      "unknown" &&
      waitingUserNoCheckpointArtifact.controlPreconditionsContract
        ?.nonContinuableReasonKind === "checkpoint_not_observed" &&
      waitingUserNoCheckpointArtifact.controlPreconditionsContract?.items?.some(
        (item) =>
          item.kind === "checkpoint_candidate_observed" &&
          item.status === "unknown",
      ) &&
      waitingUserNoCheckpointArtifact.constraintSummary?.disclaimer?.includes(
        "不是恢复承诺",
      ),
    `Expected waiting_user without checkpoint to stay unknown/incomplete and not imply resumable. Actual: ${JSON.stringify(waitingUserNoCheckpointArtifact)}`,
  );
  const degradedConstraintArtifact = toActiveGraphRunArtifactForTest({
    bridge: {
      graph_run_overview: {
        runId: "req_degraded_constraint",
        graphId: "graph_test",
        status: "running",
        phase: "executing",
        phaseLabel: "执行中",
        controlPreconditionsContract: {
          items: [
            {
              kind: "broken_kind",
              status: "broken_status",
              sourceKind: "broken_source",
              conservativeSourceKind: "broken_source",
            },
          ],
        },
      },
    },
  });
  assert(
    degradedConstraintArtifact?.controlPreconditionsContract?.items?.[0]
      ?.kind === "unknown" &&
      degradedConstraintArtifact.controlPreconditionsContract?.items?.[0]
        ?.status === "unknown" &&
      degradedConstraintArtifact.controlPreconditionsContract
        ?.nonContinuableReasonKind === "unknown" &&
      degradedConstraintArtifact.constraintSummary?.heading === "",
    `Expected degraded control-preconditions payload to fall back to conservative unknown parsing without crashing. Actual: ${JSON.stringify(degradedConstraintArtifact)}`,
  );
  assert(
    successResult.checkpointCandidate?.resumable === false &&
      successResult.runArtifact?.checkpointCandidate?.resumable === false,
    `Expected checkpoint candidate to remain non-promissory. Actual: ${JSON.stringify({ topLevel: successResult.checkpointCandidate, artifact: successResult.runArtifact?.checkpointCandidate })}`,
  );
  const successRunEventTypes = (successResult.runEvents ?? []).map(
    (event) => event.type,
  );
  assert(
    successRunEventTypes.join(",") ===
      "run_queued,run_started,stage_started,stage_finished,stage_started,stage_finished,checkpoint_candidate,stage_started,node_started,heartbeat,partial_output,node_finished,checkpoint_candidate,node_started,heartbeat,partial_output,waiting_user,node_finished,checkpoint_candidate,stage_finished,run_completed",
    `Expected success run event order to expose minimal lifecycle/stage/node/checkpoint semantics plus observation events. Actual: ${successRunEventTypes.join(",")}`,
  );
  assert(
    successResult.checkpointCandidate?.nodeId === "filter_text" &&
      successResult.checkpointCandidate?.stage === "execute" &&
      successResult.checkpointCandidate?.reason === "terminal_candidate" &&
      successResult.checkpointCandidate?.resumable === false &&
      waitingUserEvent?.continuationContract?.verdict.status !==
        "not_continuable",
    `Expected checkpoint candidate to retain terminal summary only without turning waiting_user observation into a recovery promise. Actual: ${JSON.stringify({ checkpoint: successResult.checkpointCandidate, waitingUserEvent })}`,
  );
  assert(
    successResult.runState.controlPreconditionsContract.items.some(
      (item) =>
        item.kind === "control_action_surface_inference" &&
        item.status === "unknown" &&
        item.sourceKind === "host_limited",
    ) &&
      successResult.runState.constraintSummary.capabilityBoundary.includes(
        "resume API",
      ) &&
      successResult.runState.failedStage === undefined,
    `Expected success runState to keep control-precondition explanation while staying within read-only boundary. Actual: ${JSON.stringify(successResult.runState)}`,
  );
  assert(
    successResult.runState.compileFingerprint ===
      successResult.compilePlan?.compileFingerprint,
    `Expected success runState.compileFingerprint to match compilePlan. Actual: ${successResult.runState.compileFingerprint} vs ${successResult.compilePlan?.compileFingerprint}`,
  );
  assert(
    successResult.compileArtifact?.compileFingerprint ===
      successResult.compilePlan?.compileFingerprint &&
      successResult.compileArtifact?.compileFingerprint ===
        successResult.runState.compileFingerprint,
    `Expected executeGraph success result to expose compileArtifact aligned with compileFingerprint. Actual: ${JSON.stringify({ compileArtifact: successResult.compileArtifact, compilePlanFingerprint: successResult.compilePlan?.compileFingerprint, runStateFingerprint: successResult.runState.compileFingerprint })}`,
  );
  assert(
    successResult.failedStage === undefined,
    "Expected no failedStage on success",
  );
  assert(
    successResult.compilePlan?.nodeOrder.join(",") === "src_text,filter_text",
    `Expected compile plan node order to be src_text,filter_text. Actual: ${successResult.compilePlan?.nodeOrder.join(",")}`,
  );
  assert(
    successResult.compilePlan?.sideEffectNodeIds.length === 0,
    `Expected base graph compile plan to have no side-effect nodes. Actual: ${successResult.compilePlan?.sideEffectNodeIds.join(",")}`,
  );
  assert(
    successResult.compilePlan?.nodes
      .map((node) => `${node.nodeId}:${node.capability}`)
      .join(",") === "src_text:source,filter_text:pure",
    `Expected base graph compile plan capability view to stay stable. Actual: ${successResult.compilePlan?.nodes.map((node) => `${node.nodeId}:${node.capability}`).join(",")}`,
  );
  assert(
    successResult.compilePlan?.terminalNodeIds.join(",") === "filter_text",
    `Expected terminal node to be filter_text. Actual: ${successResult.compilePlan?.terminalNodeIds.join(",")}`,
  );
  assert(
    successResult.compilePlan?.nodes
      .map(
        (node) =>
          `${node.nodeId}:${node.order}:${node.sequence}:${node.stage}:${node.status}:${node.isTerminal}:${node.isSideEffectNode}`,
      )
      .join(",") ===
      "src_text:0:0:compile:ok:false:false,filter_text:1:1:compile:ok:true:false",
    `Expected compile plan nodes to carry stable execution metadata. Actual: ${successResult.compilePlan?.nodes
      .map(
        (node) =>
          `${node.nodeId}:${node.order}:${node.sequence}:${node.stage}:${node.status}:${node.isTerminal}:${node.isSideEffectNode}`,
      )
      .join(",")}`,
  );
  assert(
    successResult.compilePlan?.stageTrace
      ?.map((stage) => `${stage.stage}:${stage.status}`)
      .join(",") === "validate:ok,compile:ok,execute:ok",
    `Expected compile plan stage trace to mirror graph stage trace on success. Actual: ${successResult.compilePlan?.stageTrace?.map((stage) => `${stage.stage}:${stage.status}`).join(",")}`,
  );
  assert(
    successResult.trace?.stages
      .map((stage) => `${stage.stage}:${stage.status}`)
      .join(",") === "validate:ok,compile:ok,execute:ok",
    `Expected success trace to contain validate/compile/execute ok. Actual: ${successResult.trace?.stages.map((stage) => `${stage.stage}:${stage.status}`).join(",")}`,
  );
  assert(
    successResult.trace?.nodeTraces
      ?.map((trace) => `${trace.nodeId}:${trace.stage}:${trace.status}`)
      .join(",") ===
      "src_text:compile:ok,filter_text:compile:ok,src_text:execute:ok,filter_text:execute:ok",
    `Expected node traces to contain compile and execute status. Actual: ${successResult.trace?.nodeTraces?.map((trace) => `${trace.nodeId}:${trace.stage}:${trace.status}`).join(",")}`,
  );
  const successExecuteTraces = successResult.trace?.nodeTraces?.filter(
    (trace) => trace.stage === "execute",
  );
  assert(
    successExecuteTraces?.every(
      (trace) =>
        typeof trace.handlerId === "string" &&
        typeof trace.durationMs === "number" &&
        trace.durationMs >= 0 &&
        trace.isFallback === false,
    ) === true,
    `Expected successful execute traces to expose structured handler metadata. Actual: ${JSON.stringify(successExecuteTraces)}`,
  );
  assert(
    successResult.hostWrites?.length === 0,
    `Expected base graph executeGraph success path not to expose hostWrites. Actual: ${JSON.stringify(successResult.hostWrites)}`,
  );
  assert(
    successResult.hostCommitContracts?.length === 0,
    `Expected base graph executeGraph success path not to expose hostCommitContracts. Actual: ${JSON.stringify(successResult.hostCommitContracts)}`,
  );
  const filterTrace = successExecuteTraces?.find(
    (trace) => trace.nodeId === "filter_text",
  );
  assert(
    filterTrace?.inputKeys?.join(",") === "text_in",
    `Expected filter_text execute trace to expose input keys. Actual: ${JSON.stringify(filterTrace)}`,
  );
  assert(
    filterTrace?.capability === "pure" && filterTrace?.sideEffect === "pure",
    `Expected filter_text execute trace to preserve capability/sideEffect. Actual: ${JSON.stringify({ capability: filterTrace?.capability, sideEffect: filterTrace?.sideEffect })}`,
  );
  assert(
    successResult.moduleResults.length === 2,
    `Expected 2 module results. Actual: ${successResult.moduleResults.length}`,
  );
  assert(
    successResult.moduleResults.every(
      (result) => result.stage === "execute" && result.status === "ok",
    ),
    `Expected all module results to be execute/ok. Actual: ${successResult.moduleResults.map((result) => `${result.nodeId}:${result.stage}:${result.status}`).join(",")}`,
  );
  const successSourceResult = successResult.moduleResults.find(
    (result) => result.nodeId === "src_text",
  );
  const successFilterResult = successResult.moduleResults.find(
    (result) => result.nodeId === "filter_text",
  );
  assert(successSourceResult, "Expected src_text module result to exist");
  assert(successFilterResult, "Expected filter_text module result to exist");
  assert(
    typeof successSourceResult?.inputFingerprint === "string" &&
      typeof successFilterResult?.inputFingerprint === "string",
    `Expected successful execute results to expose inputFingerprint. Actual: ${JSON.stringify(successResult.moduleResults)}`,
  );
  assert(
    successSourceResult?.dirtyReason === "initial_run" &&
      successSourceResult?.isDirty === true &&
      successFilterResult?.dirtyReason === "initial_run" &&
      successFilterResult?.isDirty === true,
    `Expected first run execute results to mark nodes as initial_run dirty. Actual: ${JSON.stringify(successResult.moduleResults.map((result) => ({ nodeId: result.nodeId, dirtyReason: result.dirtyReason, isDirty: result.isDirty })))}`,
  );
  assert(
    successResult.dirtySetSummary?.entries
      .map((entry) => `${entry.nodeId}:${entry.dirtyReason}:${entry.isDirty}`)
      .join(",") === "src_text:initial_run:true,filter_text:initial_run:true",
    `Expected success dirty-set summary to reflect initial_run for first execution. Actual: ${JSON.stringify(successResult.dirtySetSummary)}`,
  );
  assert(
    successResult.trace?.dirtySetSummary?.dirtyNodeIds.join(",") ===
      "src_text,filter_text",
    `Expected trace dirty-set summary to mirror top-level result on first execution. Actual: ${JSON.stringify(successResult.trace?.dirtySetSummary)}`,
  );
  assert(
    successFilterResult?.inputSources
      ?.map(
        (source) =>
          `${source.sourceNodeId}:${source.sourcePort}->${source.targetPort}`,
      )
      .join(",") === "src_text:text->text_in",
    `Expected filter_text inputSources to summarize upstream wiring. Actual: ${JSON.stringify(successFilterResult?.inputSources)}`,
  );
  assert(
    successSourceResult!.cacheKeyFacts?.compileFingerprint ===
      successResult.compilePlan?.compileFingerprint &&
      successSourceResult!.cacheKeyFacts?.nodeFingerprint ===
        successSourceResult!.nodeFingerprint &&
      successSourceResult!.cacheKeyFacts?.inputFingerprint ===
        successSourceResult!.inputFingerprint &&
      successSourceResult!.cacheKeyFacts?.scopeKey === "graph_test:src_text" &&
      successSourceResult!.cacheKeyFacts?.fingerprintVersion === 1,
    `Expected source node to expose cacheKeyFacts on first run. Actual: ${JSON.stringify(successSourceResult!.cacheKeyFacts)}`,
  );
  assert(
    successFilterResult!.cacheKeyFacts?.compileFingerprint ===
      successResult.compilePlan?.compileFingerprint &&
      successFilterResult!.cacheKeyFacts?.nodeFingerprint ===
        successFilterResult!.nodeFingerprint &&
      successFilterResult!.cacheKeyFacts?.inputFingerprint ===
        successFilterResult!.inputFingerprint &&
      successFilterResult!.cacheKeyFacts?.scopeKey ===
        "graph_test:filter_text" &&
      successFilterResult!.cacheKeyFacts?.fingerprintVersion === 1,
    `Expected pure node to expose cacheKeyFacts on first run. Actual: ${JSON.stringify(successFilterResult!.cacheKeyFacts)}`,
  );
  assert(
    successSourceResult?.reuseVerdict?.reason ===
      "ineligible_missing_baseline" &&
      successSourceResult.reuseVerdict?.canReuse === false &&
      successFilterResult?.reuseVerdict?.reason ===
        "ineligible_missing_baseline" &&
      successFilterResult.reuseVerdict?.canReuse === false,
    `Expected first run reuse verdicts to stay conservatively ineligible_missing_baseline. Actual: ${JSON.stringify(successResult.moduleResults.map((result) => ({ nodeId: result.nodeId, reuseVerdict: result.reuseVerdict })))}`,
  );
  assert(
    successResult.reuseSummary?.eligibleNodeIds.length === 0 &&
      successResult.reuseSummary?.ineligibleNodeIds.join(",") ===
        "src_text,filter_text" &&
      successResult.reuseSummary?.verdictCounts.eligible === 0 &&
      successResult.reuseSummary?.verdictCounts.ineligible_missing_baseline ===
        2,
    `Expected first run reuseSummary to match missing-baseline verdicts. Actual: ${JSON.stringify(successResult.reuseSummary)}`,
  );
  assert(
    successResult.trace?.reuseSummary?.verdictCounts
      .ineligible_missing_baseline ===
      successResult.reuseSummary?.verdictCounts.ineligible_missing_baseline,
    `Expected trace reuseSummary to mirror top-level result on first run. Actual: ${JSON.stringify(successResult.trace?.reuseSummary)}`,
  );

  const repeatedSuccessResult = await executeGraph(
    observationReadyGraph,
    makeExecutionContext(),
  );
  const repeatedSourceResult = repeatedSuccessResult.moduleResults.find(
    (result) => result.nodeId === "src_text",
  );
  const repeatedFilterResult = repeatedSuccessResult.moduleResults.find(
    (result) => result.nodeId === "filter_text",
  );
  assert(repeatedSourceResult, "Expected repeated src_text result to exist");
  assert(repeatedFilterResult, "Expected repeated filter_text result to exist");
  assert(
    repeatedSourceResult?.inputFingerprint ===
      successSourceResult?.inputFingerprint &&
      repeatedFilterResult?.inputFingerprint ===
        successFilterResult?.inputFingerprint,
    `Expected same graph and same inputs to produce stable inputFingerprint values. Actual: ${JSON.stringify({ first: successResult.moduleResults, second: repeatedSuccessResult.moduleResults })}`,
  );
  assert(
    repeatedSuccessResult.dirtySetSummary?.entries
      .map((entry) => `${entry.nodeId}:${entry.dirtyReason}:${entry.isDirty}`)
      .join(",") === "src_text:clean:false,filter_text:clean:false",
    `Expected second identical run to be observationally clean while still fully executed. Actual: ${JSON.stringify(repeatedSuccessResult.dirtySetSummary)}`,
  );
  assert(
    repeatedSuccessResult.moduleResults.length ===
      repeatedSuccessResult.compilePlan?.nodeOrder.length,
    `Expected identical second run to remain full execution with no skip semantics. Actual: moduleResults=${repeatedSuccessResult.moduleResults.length}, planNodes=${repeatedSuccessResult.compilePlan?.nodeOrder.length}`,
  );
  assert(
    repeatedSourceResult?.reuseVerdict?.reason === "ineligible_capability" &&
      repeatedSourceResult.reuseVerdict?.canReuse === false &&
      repeatedFilterResult?.reuseVerdict?.reason === "eligible" &&
      repeatedFilterResult.reuseVerdict?.canReuse === true,
    `Expected second identical run to mark only conservative pure nodes as eligible. Actual: ${JSON.stringify(repeatedSuccessResult.moduleResults.map((result) => ({ nodeId: result.nodeId, reuseVerdict: result.reuseVerdict })))}`,
  );
  assert(
    repeatedFilterResult?.cacheKeyFacts?.compileFingerprint ===
      repeatedSuccessResult.compilePlan?.compileFingerprint &&
      repeatedFilterResult?.cacheKeyFacts?.nodeFingerprint ===
        repeatedFilterResult?.nodeFingerprint &&
      repeatedFilterResult?.cacheKeyFacts?.inputFingerprint ===
        repeatedFilterResult?.inputFingerprint,
    `Expected repeated pure node to retain aligned cacheKeyFacts. Actual: ${JSON.stringify(repeatedFilterResult?.cacheKeyFacts)}`,
  );
  assert(
    repeatedSuccessResult.reuseSummary?.eligibleNodeIds.join(",") ===
      "filter_text" &&
      repeatedSuccessResult.reuseSummary?.ineligibleNodeIds.join(",") ===
        "src_text" &&
      repeatedSuccessResult.reuseSummary?.verdictCounts.eligible === 1 &&
      repeatedSuccessResult.reuseSummary?.verdictCounts
        .ineligible_capability === 1,
    `Expected repeated run reuseSummary to align with per-node verdicts. Actual: ${JSON.stringify(repeatedSuccessResult.reuseSummary)}`,
  );
  assert(
    repeatedSuccessResult.trace?.reuseSummary?.eligibleNodeIds.join(",") ===
      repeatedSuccessResult.reuseSummary?.eligibleNodeIds.join(","),
    `Expected repeated run trace reuseSummary to mirror top-level result. Actual: ${JSON.stringify(repeatedSuccessResult.trace?.reuseSummary)}`,
  );
  assert(
    repeatedSuccessResult.trace?.nodeTraces
      ?.filter((trace) => trace.stage === "execute")
      .map(
        (trace) =>
          `${trace.nodeId}:${trace.reuseVerdict?.reason}:${trace.status}`,
      )
      .join(",") ===
      "src_text:ineligible_capability:ok,filter_text:eligible:ok",
    `Expected execute traces to expose reuse verdicts while still executing eligible nodes. Actual: ${JSON.stringify(repeatedSuccessResult.trace?.nodeTraces)}`,
  );

  const skipPilotInitial = await executeGraph(
    makePlanExecutionGraph(),
    makeExecutionContext({
      userInput: "pilot-alpha",
      settings: { experimentalGraphReuseSkip: true },
    }),
  );
  const skipPilotRepeat = await executeGraph(
    makePlanExecutionGraph(),
    makeExecutionContext({
      userInput: "pilot-alpha",
      settings: { experimentalGraphReuseSkip: true },
    }),
  );
  const skipPilotFilterResult = skipPilotRepeat.moduleResults.find(
    (result) => result.nodeId === "filter_text",
  );
  const skipPilotSourceResult = skipPilotRepeat.moduleResults.find(
    (result) => result.nodeId === "src_text",
  );
  const skipPilotOutReplyResult = skipPilotRepeat.moduleResults.find(
    (result) => result.nodeId === "out_reply",
  );
  assert(skipPilotFilterResult, "Expected skip pilot filter result to exist");
  assert(skipPilotSourceResult, "Expected skip pilot source result to exist");
  assert(
    skipPilotOutReplyResult,
    "Expected skip pilot out_reply result to exist",
  );
  assert(
    skipPilotInitial.moduleResults
      .map(
        (result) =>
          `${result.nodeId}:${result.status}:${result.executionDecision?.reason}`,
      )
      .join(",") ===
      "src_text:ok:ineligible_source,filter_text:ok:ineligible_reuse_verdict,out_reply:ok:ineligible_side_effect",
    `Expected first skip-pilot run to keep executing without baseline skips. Actual: ${JSON.stringify(skipPilotInitial.moduleResults.map((result) => ({ nodeId: result.nodeId, status: result.status, executionDecision: result.executionDecision })))}`,
  );
  assert(
    skipPilotRepeat.moduleResults.length === 3,
    `Expected skip pilot repeat to keep all module results visible. Actual: ${skipPilotRepeat.moduleResults.length}`,
  );
  assert(
    skipPilotSourceResult!.status === "ok" &&
      skipPilotSourceResult!.executionDecision?.shouldSkip === false &&
      skipPilotSourceResult!.executionDecision?.reason === "ineligible_source",
    `Expected source node never to skip in pilot mode. Actual: ${JSON.stringify(skipPilotSourceResult)}`,
  );
  assert(
    skipPilotFilterResult!.status === "skipped" &&
      skipPilotFilterResult!.executionDecision?.shouldSkip === true &&
      skipPilotFilterResult!.executionDecision?.reason ===
        "skip_reuse_outputs" &&
      skipPilotFilterResult!.reuseVerdict?.canReuse === true &&
      JSON.stringify(skipPilotFilterResult!.outputs) ===
        JSON.stringify(
          skipPilotInitial.moduleResults.find(
            (result) => result.nodeId === "filter_text",
          )?.outputs,
        ),
    `Expected pure clean baseline node to skip and reuse outputs when pilot enabled. Actual: ${JSON.stringify(skipPilotFilterResult)}`,
  );
  assert(
    skipPilotOutReplyResult!.status === "ok" &&
      skipPilotOutReplyResult!.executionDecision?.shouldSkip === false &&
      skipPilotOutReplyResult!.executionDecision?.reason ===
        "ineligible_side_effect",
    `Expected side-effect node never to skip in pilot mode. Actual: ${JSON.stringify(skipPilotOutReplyResult)}`,
  );
  assert(
    skipPilotRepeat.executionDecisionSummary?.featureEnabled === true &&
      skipPilotRepeat.executionDecisionSummary?.skippedNodeIds.join(",") ===
        "filter_text" &&
      skipPilotRepeat.executionDecisionSummary?.executedNodeIds.join(",") ===
        "src_text,out_reply" &&
      skipPilotRepeat.executionDecisionSummary?.decisionCounts
        .skip_reuse_outputs === 1 &&
      skipPilotRepeat.executionDecisionSummary?.decisionCounts
        .ineligible_source === 1 &&
      skipPilotRepeat.executionDecisionSummary?.decisionCounts
        .ineligible_side_effect === 1,
    `Expected executionDecisionSummary to align with per-node decisions in pilot mode. Actual: ${JSON.stringify(skipPilotRepeat.executionDecisionSummary)}`,
  );
  assert(
    skipPilotRepeat.trace?.executionDecisionSummary?.skippedNodeIds.join(
      ",",
    ) === skipPilotRepeat.executionDecisionSummary?.skippedNodeIds.join(","),
    `Expected trace executionDecisionSummary to mirror top-level result in pilot mode. Actual: ${JSON.stringify(skipPilotRepeat.trace?.executionDecisionSummary)}`,
  );
  const skipPilotExecuteTraceSummary = skipPilotRepeat.trace?.nodeTraces
    ?.filter((trace) => trace.stage === "execute")
    .map(
      (trace) =>
        `${trace.nodeId}:${trace.status}:${trace.executionDecision?.reason}:${trace.reuseVerdict?.reason}`,
    )
    .join(",");
  assert(
    skipPilotExecuteTraceSummary ===
      "src_text:ok:ineligible_source:ineligible_capability,filter_text:skipped:skip_reuse_outputs:eligible,out_reply:ok:ineligible_side_effect:ineligible_side_effect",
    `Expected execute traces to record skip-vs-execute decisions consistently. Actual: ${JSON.stringify(skipPilotRepeat.trace?.nodeTraces)}`,
  );
  assert(
    skipPilotRepeat.hostWrites?.length === 1 &&
      skipPilotRepeat.hostWrites[0]?.targetType === "reply_instruction",
    `Expected downstream side-effect node to still consume reused outputs and produce host writes. Actual: ${JSON.stringify(skipPilotRepeat.hostWrites)}`,
  );

  clearGraphExecutorReusableOutputsForTesting();
  const missingReusableOutputsResult = await executeGraph(
    makePlanExecutionGraph(),
    makeExecutionContext({
      userInput: "pilot-alpha",
      settings: { experimentalGraphReuseSkip: true },
    }),
  );
  const missingReusableFilterResult =
    missingReusableOutputsResult.moduleResults.find(
      (result) => result.nodeId === "filter_text",
    );
  assert(
    missingReusableFilterResult?.status === "ok" &&
      missingReusableFilterResult.executionDecision?.shouldSkip === false &&
      missingReusableFilterResult.executionDecision?.reason ===
        "missing_reusable_outputs",
    `Expected pilot mode to execute when baseline exists but reusable outputs are missing. Actual: ${JSON.stringify(missingReusableFilterResult)}`,
  );
  assert(
    missingReusableOutputsResult.executionDecisionSummary?.decisionCounts
      .missing_reusable_outputs === 1,
    `Expected executionDecisionSummary to count missing reusable outputs. Actual: ${JSON.stringify(missingReusableOutputsResult.executionDecisionSummary)}`,
  );

  resetGraphExecutorReuseStateForTesting();
  const skipDisabledInitial = await executeGraph(
    makePlanExecutionGraph(),
    makeExecutionContext({ userInput: "pilot-disabled", settings: {} }),
  );
  const skipDisabledRepeat = await executeGraph(
    makePlanExecutionGraph(),
    makeExecutionContext({ userInput: "pilot-disabled", settings: {} }),
  );
  const skipDisabledFilterResult = skipDisabledRepeat.moduleResults.find(
    (result) => result.nodeId === "filter_text",
  );
  assert(
    skipDisabledRepeat.moduleResults.length ===
      skipDisabledRepeat.compilePlan?.nodeOrder.length &&
      skipDisabledFilterResult?.status === "ok" &&
      skipDisabledFilterResult.executionDecision?.shouldSkip === false &&
      skipDisabledFilterResult.executionDecision?.reason ===
        "feature_disabled" &&
      skipDisabledRepeat.executionDecisionSummary?.featureEnabled === false &&
      skipDisabledRepeat.executionDecisionSummary?.skippedNodeIds.length ===
        0 &&
      skipDisabledRepeat.executionDecisionSummary?.decisionCounts
        .feature_disabled === 3,
    `Expected feature-disabled path to remain full execution with no skip nodes. Actual: ${JSON.stringify({ initial: skipDisabledInitial.moduleResults, repeat: skipDisabledRepeat.moduleResults, summary: skipDisabledRepeat.executionDecisionSummary })}`,
  );

  const terminalPilotInitial = await executeGraph(
    makeBaseGraph(),
    makeExecutionContext({
      userInput: "terminal-pilot",
      settings: { experimentalGraphReuseSkip: true },
    }),
  );
  const terminalPilotRepeat = await executeGraph(
    makeBaseGraph(),
    makeExecutionContext({
      userInput: "terminal-pilot",
      settings: { experimentalGraphReuseSkip: true },
    }),
  );
  const terminalPilotFilterResult = terminalPilotRepeat.moduleResults.find(
    (result) => result.nodeId === "filter_text",
  );
  assert(
    terminalPilotInitial.moduleResults.every(
      (result) => result.status === "ok",
    ) &&
      terminalPilotFilterResult?.status === "ok" &&
      terminalPilotFilterResult.executionDecision?.reason ===
        "ineligible_terminal",
    `Expected terminal pure node never to skip even when clean baseline exists. Actual: ${JSON.stringify(terminalPilotRepeat.moduleResults)}`,
  );

  const fallbackPilotInitial = await executeCompiledGraph(
    makeDispatchSmokeGraph(),
    compileGraphPlan(makeDispatchSmokeGraph()),
    makeExecutionContext({
      userInput: "fallback-pilot",
      settings: { experimentalGraphReuseSkip: true },
    }),
  );
  const fallbackPilotRepeat = await executeCompiledGraph(
    makeDispatchSmokeGraph(),
    compileGraphPlan(makeDispatchSmokeGraph()),
    makeExecutionContext({
      userInput: "fallback-pilot",
      settings: { experimentalGraphReuseSkip: true },
    }),
  );
  const fallbackPilotTrace = fallbackPilotRepeat.nodeTraces?.find(
    (trace) => trace.nodeId === "fallback_pkg" && trace.stage === "execute",
  );
  assert(
    fallbackPilotInitial.moduleResults.some(
      (result) => result.nodeId === "fallback_pkg" && result.status === "ok",
    ) &&
      fallbackPilotTrace?.status === "ok" &&
      fallbackPilotTrace.executionDecision?.shouldSkip === false &&
      fallbackPilotTrace.executionDecision?.reason === "ineligible_terminal",
    `Expected fallback/terminal node to remain non-skippable in pilot mode. Actual: ${JSON.stringify({ moduleResults: fallbackPilotRepeat.moduleResults, trace: fallbackPilotTrace })}`,
  );

  const changedInputResult = await executeGraph(
    makeBaseGraph(),
    makeExecutionContext({ userInput: "hello world changed" }),
  );
  const changedSourceResult = changedInputResult.moduleResults.find(
    (result) => result.nodeId === "src_text",
  );
  const changedFilterResult = changedInputResult.moduleResults.find(
    (result) => result.nodeId === "filter_text",
  );
  assert(
    changedSourceResult?.inputFingerprint !==
      successSourceResult?.inputFingerprint &&
      changedFilterResult?.inputFingerprint !==
        successFilterResult?.inputFingerprint,
    `Expected runtime input change to alter downstream inputFingerprint values. Actual: ${JSON.stringify({ baseline: successResult.moduleResults, changed: changedInputResult.moduleResults })}`,
  );
  assert(
    changedSourceResult?.dirtyReason === "input_changed" &&
      changedFilterResult?.dirtyReason === "upstream_dirty",
    `Expected changed source node to be input_changed and downstream node to be upstream_dirty. Actual: ${JSON.stringify(changedInputResult.moduleResults.map((result) => ({ nodeId: result.nodeId, dirtyReason: result.dirtyReason })))}`,
  );
  assert(
    changedInputResult.trace?.dirtySetSummary?.entries
      .map((entry) => `${entry.nodeId}:${entry.dirtyReason}`)
      .join(",") === "src_text:input_changed,filter_text:upstream_dirty",
    `Expected trace dirty-set summary to expose minimal propagation semantics. Actual: ${JSON.stringify(changedInputResult.trace?.dirtySetSummary)}`,
  );

  const dirtyPropagationInitial = await executeGraph(
    makeDirtyPropagationGraph(),
    makeExecutionContext({ userInput: "alpha" }),
  );
  const dirtyPropagationRepeat = await executeGraph(
    makeDirtyPropagationGraph(),
    makeExecutionContext({ userInput: "alpha" }),
  );
  const dirtyPropagationChanged = await executeGraph(
    makeDirtyPropagationGraph(),
    makeExecutionContext({ userInput: "beta" }),
  );
  assert(
    dirtyPropagationInitial.dirtySetSummary?.entries
      .map((entry) => `${entry.nodeId}:${entry.dirtyReason}`)
      .join(",") ===
      "src_text:initial_run,filter_text:initial_run,out_reply:initial_run",
    `Expected first dirty propagation run to initialize all nodes as dirty. Actual: ${JSON.stringify(dirtyPropagationInitial.dirtySetSummary)}`,
  );
  assert(
    dirtyPropagationRepeat.dirtySetSummary?.entries
      .map((entry) => `${entry.nodeId}:${entry.dirtyReason}`)
      .join(",") === "src_text:clean,filter_text:clean,out_reply:clean",
    `Expected identical dirty propagation rerun to be observationally clean. Actual: ${JSON.stringify(dirtyPropagationRepeat.dirtySetSummary)}`,
  );
  assert(
    dirtyPropagationChanged.dirtySetSummary?.entries
      .map((entry) => `${entry.nodeId}:${entry.dirtyReason}`)
      .join(",") ===
      "src_text:input_changed,filter_text:upstream_dirty,out_reply:upstream_dirty",
    `Expected upstream dirty propagation to be visible in downstream nodes. Actual: ${JSON.stringify(dirtyPropagationChanged.dirtySetSummary)}`,
  );
  assert(
    dirtyPropagationChanged.moduleResults.length === 3,
    `Expected dirty propagation graph to remain fully executed after dirty observation. Actual: ${dirtyPropagationChanged.moduleResults.length}`,
  );
  const dirtyPropagationRepeatFilter =
    dirtyPropagationRepeat.moduleResults.find(
      (result) => result.nodeId === "filter_text",
    );
  const dirtyPropagationRepeatOutReply =
    dirtyPropagationRepeat.moduleResults.find(
      (result) => result.nodeId === "out_reply",
    );
  assert(
    dirtyPropagationRepeatFilter?.reuseVerdict?.reason === "eligible" &&
      dirtyPropagationRepeatFilter.reuseVerdict?.canReuse === true &&
      dirtyPropagationRepeatOutReply?.reuseVerdict?.reason ===
        "ineligible_side_effect" &&
      dirtyPropagationRepeatOutReply.reuseVerdict?.canReuse === false,
    `Expected repeated dirty-propagation run to keep pure nodes eligible and side-effect nodes conservatively ineligible. Actual: ${JSON.stringify(dirtyPropagationRepeat.moduleResults.map((result) => ({ nodeId: result.nodeId, reuseVerdict: result.reuseVerdict })))}`,
  );
  assert(
    dirtyPropagationChanged.moduleResults
      .map((result) => `${result.nodeId}:${result.reuseVerdict?.reason}`)
      .join(",") ===
      "src_text:ineligible_dirty,filter_text:ineligible_dirty,out_reply:ineligible_side_effect",
    `Expected dirty and side-effect boundaries to dominate reuse verdicts after input changes. Actual: ${JSON.stringify(dirtyPropagationChanged.moduleResults.map((result) => ({ nodeId: result.nodeId, reuseVerdict: result.reuseVerdict })))}`,
  );
  assert(
    dirtyPropagationChanged.reuseSummary?.eligibleNodeIds.length === 0 &&
      dirtyPropagationChanged.reuseSummary?.ineligibleNodeIds.join(",") ===
        "src_text,filter_text,out_reply" &&
      dirtyPropagationChanged.reuseSummary?.verdictCounts.ineligible_dirty ===
        2 &&
      dirtyPropagationChanged.reuseSummary?.verdictCounts
        .ineligible_side_effect === 1,
    `Expected dirty propagation reuseSummary to align with dirty and side-effect verdicts. Actual: ${JSON.stringify(dirtyPropagationChanged.reuseSummary)}`,
  );

  const validationFailureResult = await executeGraph(
    missingRequiredInputGraph,
    makeExecutionContext(),
  );
  assert(
    validationFailureResult.runState.status === "failed" &&
      validationFailureResult.runState.failedStage === "validate" &&
      validationFailureResult.runState.compileFingerprint === undefined,
    `Expected validation failure runState to be failed/validate without compileFingerprint. Actual: ${JSON.stringify(validationFailureResult.runState)}`,
  );
  assert(
    !validationFailureResult.compilePlan,
    "Expected validation failure to stop before compile plan generation",
  );
  assert(
    validationFailureResult.reason?.includes("[graph_validation") === true,
    `Expected validation failure reason to include graph_validation marker. Actual: ${validationFailureResult.reason}`,
  );
  assert(
    validationFailureResult.ok === false &&
      validationFailureResult.failedStage === "validate",
    `Expected validation failure to be attributed to validate stage. Actual: ok=${validationFailureResult.ok}, failedStage=${validationFailureResult.failedStage}`,
  );
  assert(
    validationFailureResult.trace?.failedStage === "validate",
    `Expected trace.failedStage to be validate. Actual: ${validationFailureResult.trace?.failedStage}`,
  );
  assert(
    validationFailureResult.trace?.stages
      .map((stage) => `${stage.stage}:${stage.status}`)
      .join(",") === "validate:error,compile:skipped,execute:skipped",
    `Expected validation failure trace to skip compile/execute. Actual: ${validationFailureResult.trace?.stages.map((stage) => `${stage.stage}:${stage.status}`).join(",")}`,
  );

  const handlerFailureResult = await executeGraph(
    makeHandlerFailureGraph(),
    makeExecutionContext(),
  );
  assert(
    handlerFailureResult.runState.status === "failed" &&
      handlerFailureResult.runState.phase === "terminal" &&
      handlerFailureResult.runState.terminalOutcome === "failed" &&
      handlerFailureResult.runState.currentStage === "execute" &&
      handlerFailureResult.runState.failedStage === "execute" &&
      handlerFailureResult.runState.compileFingerprint ===
        handlerFailureResult.compilePlan?.compileFingerprint,
    `Expected handler failure runState to align with execute failure and compile plan fingerprint. Actual: ${JSON.stringify(handlerFailureResult.runState)}`,
  );
  assert(
    handlerFailureResult.runArtifact?.status === "failed" &&
      handlerFailureResult.runArtifact?.phase === "terminal" &&
      handlerFailureResult.runArtifact?.terminalOutcome === "failed" &&
      handlerFailureResult.runArtifact?.failedStage === "execute" &&
      handlerFailureResult.runArtifact?.latestNodeId === "llm_call" &&
      handlerFailureResult.runArtifact?.latestNodeStatus === "failed" &&
      handlerFailureResult.runArtifact?.recoveryEligibility?.status ===
        "ineligible" &&
      !handlerFailureResult.runArtifact?.blockingContract &&
      typeof handlerFailureResult.runArtifact?.errorSummary === "string",
    `Expected handler failure runArtifact to expose failed node/error summary. Actual: ${JSON.stringify(handlerFailureResult.runArtifact)}`,
  );
  const handlerFailureEventTypes = (handlerFailureResult.runEvents ?? []).map(
    (event) => event.type,
  );
  assert(
    handlerFailureEventTypes.includes("node_failed") &&
      handlerFailureEventTypes[handlerFailureEventTypes.length - 1] ===
        "run_failed",
    `Expected failure event sequence to include node_failed and end with run_failed. Actual: ${handlerFailureEventTypes.join(",")}`,
  );
  assert(
    handlerFailureResult.ok === false &&
      handlerFailureResult.failedStage === "execute",
    `Expected handler failure to be attributed to execute stage. Actual: ok=${handlerFailureResult.ok}, failedStage=${handlerFailureResult.failedStage}`,
  );
  assert(
    handlerFailureResult.trace?.failedStage === "execute" &&
      handlerFailureResult.trace?.failedNodeId === "llm_call",
    `Expected handler failure trace to expose failed node attribution. Actual: failedStage=${handlerFailureResult.trace?.failedStage}, failedNodeId=${handlerFailureResult.trace?.failedNodeId}`,
  );
  const handlerFailureTrace = handlerFailureResult.trace?.nodeTraces?.find(
    (trace) => trace.nodeId === "llm_call" && trace.stage === "execute",
  );
  assert(
    handlerFailureTrace?.status === "error" &&
      typeof handlerFailureTrace.error === "string" &&
      handlerFailureTrace.failedAt === "handler",
    `Expected failed node trace to archive error and failedAt=handler. Actual: ${JSON.stringify(handlerFailureTrace)}`,
  );
  assert(
    typeof handlerFailureTrace?.inputFingerprint === "string",
    `Expected failed execute trace to retain inputFingerprint for diagnostics. Actual: ${JSON.stringify(handlerFailureTrace)}`,
  );
  const handlerFailureModuleResult = handlerFailureResult.moduleResults.find(
    (result) => result.nodeId === "llm_call",
  );
  assert(
    typeof handlerFailureModuleResult?.inputFingerprint === "string",
    `Expected failed module result to retain inputFingerprint for diagnostics. Actual: ${JSON.stringify(handlerFailureModuleResult)}`,
  );
  assert(
    handlerFailureTrace?.capability === "network" &&
      handlerFailureTrace?.sideEffect === "unknown",
    `Expected handler failure trace to preserve network capability while keeping legacy sideEffect conservative. Actual: ${JSON.stringify({ capability: handlerFailureTrace?.capability, sideEffect: handlerFailureTrace?.sideEffect })}`,
  );

  assert(
    handlerFailureResult.nodeTraces
      ?.map((trace) => `${trace.nodeId}:${trace.stage}:${trace.status}`)
      .join(",") ===
      "src_messages:compile:ok,cfg_api:compile:ok,llm_call:compile:ok,src_messages:execute:ok,cfg_api:execute:ok,llm_call:execute:error",
    `Expected execute failure top-level nodeTraces to retain compile+execute traces. Actual: ${handlerFailureResult.nodeTraces?.map((trace) => `${trace.nodeId}:${trace.stage}:${trace.status}`).join(",")}`,
  );
  assert(
    handlerFailureResult.hostWrites?.length === 0 &&
      handlerFailureResult.hostCommitContracts?.length === 0,
    `Expected non-target handler failure not to expose host descriptors/contracts. Actual: ${JSON.stringify({ hostWrites: handlerFailureResult.hostWrites, hostCommitContracts: handlerFailureResult.hostCommitContracts })}`,
  );

  assert(
    (handlerFailureResult.runArtifact?.latestHeartbeat?.timestamp ?? 0) > 0 &&
      (handlerFailureResult.runArtifact?.latestPartialOutput?.length ?? 0) >=
        0 &&
      !handlerFailureResult.runArtifact?.waitingUser &&
      !handlerFailureResult.runArtifact?.blockingReason,
    `Expected failure path to preserve last observable heartbeat and tolerate prior partial output summaries while safely omitting waiting_user. Actual: ${JSON.stringify(handlerFailureResult.runArtifact)}`,
  );

  const sideEffectFailureResult = await executeGraph(
    makeSideEffectHandlerFailureGraph(),
    makeExecutionContext(),
  );
  assert(
    sideEffectFailureResult.ok === false &&
      sideEffectFailureResult.failedStage === "execute",
    `Expected side-effect handler failure to fail the graph at execute stage. Actual: ok=${sideEffectFailureResult.ok}, failedStage=${sideEffectFailureResult.failedStage}`,
  );
  assert(
    sideEffectFailureResult.trace?.failedStage === "execute" &&
      sideEffectFailureResult.trace?.failedNodeId === "llm_call",
    `Expected side-effect handler failure trace to expose failed node attribution. Actual: failedStage=${sideEffectFailureResult.trace?.failedStage}, failedNodeId=${sideEffectFailureResult.trace?.failedNodeId}`,
  );
  const sideEffectFailureTrace =
    sideEffectFailureResult.trace?.nodeTraces?.find(
      (trace) => trace.nodeId === "llm_call" && trace.stage === "execute",
    );
  assert(
    sideEffectFailureTrace?.status === "error" &&
      sideEffectFailureTrace.isSideEffectNode === true &&
      sideEffectFailureTrace.capability === "writes_host" &&
      sideEffectFailureTrace.sideEffect === "writes_host",
    `Expected side-effect failed node trace to stay error and preserve writes_host capability metadata. Actual: ${JSON.stringify(sideEffectFailureTrace)}`,
  );
  assert(
    sideEffectFailureResult.hostWrites?.length === 0 &&
      sideEffectFailureResult.hostCommitContracts?.length === 0 &&
      (sideEffectFailureTrace?.hostWrites?.length ?? 0) === 0 &&
      (sideEffectFailureTrace?.hostCommitContracts?.length ?? 0) === 0,
    `Expected failed non-out_reply writes_host path not to misreport host descriptors/contracts. Actual: ${JSON.stringify({ graph: { hostWrites: sideEffectFailureResult.hostWrites, hostCommitContracts: sideEffectFailureResult.hostCommitContracts }, trace: sideEffectFailureTrace })}`,
  );
  const llmDescriptor = resolveNodeHandler("exe_llm_call").descriptor;
  assert(
    llmDescriptor.capability === "network" &&
      llmDescriptor.sideEffect === "unknown",
    `Expected exe_llm_call registry descriptor to preserve network capability and conservative legacy sideEffect. Actual: ${JSON.stringify(llmDescriptor)}`,
  );
  const floorDescriptor = resolveNodeHandler("out_floor_bind").descriptor;
  const replyDescriptor = resolveNodeHandler("out_reply_inject").descriptor;
  assert(
    floorDescriptor.capability === "writes_host" &&
      replyDescriptor.capability === "writes_host",
    `Expected host write descriptors to stay writes_host. Actual: floor=${JSON.stringify(floorDescriptor)}, reply=${JSON.stringify(replyDescriptor)}`,
  );
  assert(
    floorDescriptor.produceHostCommitContracts === undefined &&
      typeof replyDescriptor.produceHostCommitContracts === "function",
    `Expected only out_reply_inject to expose host commit contract producer. Actual: floor=${JSON.stringify(floorDescriptor)}, reply=${JSON.stringify(replyDescriptor)}`,
  );
  const replyDescriptorContracts = replyDescriptor.produceHostCommitContracts?.(
    replyDescriptor.produceHostWriteDescriptors?.({
      planNode: compilePlanFixture.nodes.find(
        (node) => node.nodeId === "out_reply",
      )!,
      node: makePlanExecutionGraph().nodes.find(
        (node) => node.id === "out_reply",
      )!,
      inputs: { instruction: "hello" },
    }) ?? [],
  );
  assert(
    replyDescriptorContracts?.length === 1 &&
      replyDescriptorContracts[0]?.targetType === "reply_instruction" &&
      replyDescriptorContracts[0]?.operation === "inject_reply_instruction" &&
      replyDescriptorContracts[0]?.path === "reply.instruction" &&
      replyDescriptorContracts[0]?.supportsRetry === false,
    `Expected out_reply_inject contract producer to map from host write descriptor fields. Actual: ${JSON.stringify(replyDescriptorContracts)}`,
  );

  const replyDescriptorWrites = replyDescriptor.produceHostWriteDescriptors?.({
    planNode: compilePlanFixture.nodes.find(
      (node) => node.nodeId === "out_reply",
    )!,
    node: makePlanExecutionGraph().nodes.find(
      (node) => node.id === "out_reply",
    )!,
    inputs: { instruction: "hello" },
  });
  assert(
    replyDescriptorWrites?.length === 1 &&
      replyDescriptorWrites[0]?.targetType === "reply_instruction" &&
      replyDescriptorWrites[0]?.operation === "inject_reply_instruction" &&
      replyDescriptorWrites[0]?.path === "reply.instruction",
    `Expected out_reply_inject host write producer to stay aligned with reply instruction contract. Actual: ${JSON.stringify(replyDescriptorWrites)}`,
  );

  const cancelledExecutionResult = await executeGraph(
    makeBaseGraph(),
    makeExecutionContext({ isCancelled: () => true }),
  );
  assert(
    cancelledExecutionResult.runState.status === "cancelled" &&
      cancelledExecutionResult.runState.phase === "terminal" &&
      cancelledExecutionResult.runState.terminalOutcome === "cancelled" &&
      cancelledExecutionResult.runState.currentStage === "execute" &&
      cancelledExecutionResult.runState.failedStage === "execute" &&
      cancelledExecutionResult.runState.compileFingerprint ===
        cancelledExecutionResult.compilePlan?.compileFingerprint,
    `Expected cancelled execution runState to align with execute failure and retain compileFingerprint. Actual: ${JSON.stringify(cancelledExecutionResult.runState)}`,
  );
  assert(
    cancelledExecutionResult.runArtifact?.status === "cancelled" &&
      cancelledExecutionResult.runArtifact?.phase === "terminal" &&
      cancelledExecutionResult.runArtifact?.terminalOutcome === "cancelled" &&
      cancelledExecutionResult.runArtifact?.failedStage === "execute" &&
      cancelledExecutionResult.runArtifact?.recoveryEligibility?.status ===
        "ineligible" &&
      !cancelledExecutionResult.runArtifact?.blockingContract,
    `Expected cancelled execution artifact to expose cancelled lifecycle state. Actual: ${JSON.stringify(cancelledExecutionResult.runArtifact)}`,
  );
  assert(
    (cancelledExecutionResult.runEvents ?? []).some(
      (event) => event.type === "run_cancelled",
    ),
    `Expected cancellation path to emit run_cancelled event. Actual: ${JSON.stringify(cancelledExecutionResult.runEvents)}`,
  );
  assert(
    cancelledExecutionResult.ok === false &&
      cancelledExecutionResult.failedStage === "execute",
    `Expected cancelled execution to be attributed to execute stage. Actual: ok=${cancelledExecutionResult.ok}, failedStage=${cancelledExecutionResult.failedStage}`,
  );
  assert(
    cancelledExecutionResult.compilePlan?.failedStage === "execute",
    `Expected compilePlan.failedStage to be execute on execution failure. Actual: ${cancelledExecutionResult.compilePlan?.failedStage}`,
  );
  assert(
    cancelledExecutionResult.trace?.failedStage === "execute",
    `Expected trace.failedStage to be execute. Actual: ${cancelledExecutionResult.trace?.failedStage}`,
  );
  assert(
    cancelledExecutionResult.trace?.stages
      .map((stage) => `${stage.stage}:${stage.status}`)
      .join(",") === "validate:ok,compile:ok,execute:error",
    `Expected cancelled execution trace to end with execute:error. Actual: ${cancelledExecutionResult.trace?.stages.map((stage) => `${stage.stage}:${stage.status}`).join(",")}`,
  );
  assert(
    cancelledExecutionResult.reason === "workflow cancelled by user",
    `Expected cancellation reason to be preserved. Actual: ${cancelledExecutionResult.reason}`,
  );
  assert(
    cancelledExecutionResult.moduleResults.length === 0,
    `Expected cancellation before first node execution to keep moduleResults empty. Actual: ${cancelledExecutionResult.moduleResults.length}`,
  );
  assert(
    cancelledExecutionResult.trace?.failedNodeId === undefined,
    `Expected cancellation before execution to have no failedNodeId. Actual: ${cancelledExecutionResult.trace?.failedNodeId}`,
  );

  const successOverview = buildGraphRunDiagnosticsOverview(successResult);
  assert(
    successOverview.run.runId === successResult.runState.runId &&
      successOverview.run.status === "completed" &&
      successOverview.run.phase === "terminal" &&
      successOverview.run.terminalOutcome === "completed" &&
      successOverview.compile.compileFingerprint ===
        successResult.compilePlan?.compileFingerprint &&
      successOverview.compile.nodeCount === 2 &&
      successOverview.compile.terminalNodeCount === 1 &&
      successOverview.dirty.totalNodeCount === 2 &&
      successOverview.dirty.dirtyNodeCount === 2 &&
      successOverview.dirty.cleanNodeCount === 0 &&
      successOverview.dirty.dirtyNodeIds.join(",") === "src_text,filter_text" &&
      successOverview.dirty.reasonCounts.initial_run === 2 &&
      successOverview.dirty.reasonCounts.input_changed === 0 &&
      successOverview.dirty.reasonCounts.upstream_dirty === 0 &&
      successOverview.dirty.reasonCounts.clean === 0,
    `Expected success overview to project stable run/compile/dirty facts only. Actual: ${JSON.stringify(successOverview)}`,
  );
  const successOverviewRecord = successOverview as unknown as Record<
    string,
    unknown
  >;
  const successOverviewDirtyRecord = successOverview.dirty as unknown as Record<
    string,
    unknown
  >;
  const successOverviewRunRecord = successOverview.run as unknown as Record<
    string,
    unknown
  >;
  assert(
    !("reuseVerdict" in successOverviewDirtyRecord) &&
      !("executionDecision" in successOverviewRunRecord) &&
      !("executionDecisionSummary" in successOverviewRecord) &&
      !("nodeTraces" in successOverviewRecord) &&
      !("cacheKeyFacts" in successOverviewRecord),
    `Expected overview not to expose reuse/execution/cache/trace internals. Actual: ${JSON.stringify(successOverview)}`,
  );

  const repeatedCleanOverview = buildGraphRunDiagnosticsOverview(
    repeatedSuccessResult,
  );
  assert(
    repeatedCleanOverview.dirty.totalNodeCount === 2 &&
      repeatedCleanOverview.dirty.dirtyNodeCount === 0 &&
      repeatedCleanOverview.dirty.cleanNodeCount === 2 &&
      repeatedCleanOverview.dirty.dirtyNodeIds.length === 0 &&
      repeatedCleanOverview.dirty.reasonCounts.clean === 2 &&
      repeatedSuccessResult.moduleResults.length ===
        repeatedSuccessResult.compilePlan?.nodeOrder.length,
    `Expected repeated clean overview to stay observational while full execution still occurs. Actual: ${JSON.stringify({ overview: repeatedCleanOverview, moduleResults: repeatedSuccessResult.moduleResults.length, planNodes: repeatedSuccessResult.compilePlan?.nodeOrder.length })}`,
  );

  const changedInputOverview = buildGraphRunDiagnosticsOverview(
    dirtyPropagationChanged,
  );
  assert(
    changedInputOverview.compile.compileFingerprint ===
      dirtyPropagationChanged.compilePlan?.compileFingerprint &&
      changedInputOverview.dirty.totalNodeCount === 3 &&
      changedInputOverview.dirty.dirtyNodeCount === 3 &&
      changedInputOverview.dirty.cleanNodeCount === 0 &&
      changedInputOverview.dirty.dirtyNodeIds.join(",") ===
        "src_text,filter_text,out_reply" &&
      changedInputOverview.dirty.reasonCounts.initial_run === 0 &&
      changedInputOverview.dirty.reasonCounts.input_changed === 1 &&
      changedInputOverview.dirty.reasonCounts.upstream_dirty === 2 &&
      changedInputOverview.dirty.reasonCounts.clean === 0,
    `Expected changed-input overview to summarize dirty propagation only, not skip/cache semantics. Actual: ${JSON.stringify(changedInputOverview)}`,
  );
  assert(
    dirtyPropagationChanged.moduleResults.length ===
      dirtyPropagationChanged.compilePlan?.nodeOrder.length,
    `Expected dirty overview not to imply skip/cache hit semantics. Actual: ${JSON.stringify({ moduleResults: dirtyPropagationChanged.moduleResults.length, planNodes: dirtyPropagationChanged.compilePlan?.nodeOrder.length, overview: changedInputOverview })}`,
  );

  const validationFailureOverview = buildGraphRunDiagnosticsOverview(
    validationFailureResult,
  );
  assert(
    validationFailureOverview.run.status === "failed" &&
      validationFailureOverview.run.phase === "terminal" &&
      validationFailureOverview.run.terminalOutcome === "failed" &&
      validationFailureOverview.run.failedStage === "validate" &&
      validationFailureOverview.compile.compileFingerprint === undefined &&
      validationFailureOverview.compile.nodeCount === undefined &&
      validationFailureOverview.compile.terminalNodeCount === undefined &&
      validationFailureOverview.dirty.totalNodeCount === 0 &&
      validationFailureOverview.dirty.dirtyNodeCount === 0 &&
      validationFailureOverview.dirty.cleanNodeCount === 0 &&
      validationFailureOverview.dirty.dirtyNodeIds.length === 0 &&
      validationFailureOverview.dirty.reasonCounts.initial_run === 0 &&
      validationFailureOverview.dirty.reasonCounts.input_changed === 0 &&
      validationFailureOverview.dirty.reasonCounts.upstream_dirty === 0 &&
      validationFailureOverview.dirty.reasonCounts.clean === 0,
    `Expected validate failure overview to return zero dirty summary without trace fallback. Actual: ${JSON.stringify(validationFailureOverview)}`,
  );

  const reuseContractResult = repeatedSuccessResult;
  const reuseDiagnostics = buildWorkflowBridgeDiagnostics({
    selection: selectWorkflowBridgeRoute({
      input: {
        flow_ids: undefined,
      },
      settings: {
        workbench_graphs: [makeBaseGraph()],
      },
    }),
    graphRunOverview: reuseContractResult.runArtifact,
    graphRunEvents: reuseContractResult.runEvents,
    graphCompilePlan: reuseContractResult.compilePlan,
  });
  assertBridgeDiagnostics(reuseDiagnostics, {
    route: "graph",
    reason: "graph_first",
    hasExplicitLegacyFlowSelection: false,
    enabledGraphCount: 1,
    selectedGraphIds: ["graph_test"],
    graphDiagnostics: {
      dirtyNodeCount: 0,
      cleanNodeCount: 2,
      reuseEligibleNodeCount: 1,
      reuseIneligibleNodeCount: 1,
      skipReuseOutputHitCount: 1,
    },
  });
  const reuseOverview = reuseDiagnostics.bridge?.graph_run_diagnostics;
  const reuseNodeDiagnostics = reuseDiagnostics.bridge
    ?.graph_node_diagnostics as GraphNodeDiagnosticsView[] | undefined;
  assert(
    reuseOverview?.executionDecision?.featureEnabled === true &&
      Array.isArray(reuseOverview?.executionDecision?.skipReuseOutputNodeIds) &&
      reuseOverview.executionDecision.skipReuseOutputNodeIds.join(",") ===
        "filter_text" &&
      !JSON.stringify(reuseOverview).includes("cacheKeyFacts"),
    `Expected graph bridge diagnostics to expose summary-only dirty/reuse/decision facts. Actual: ${JSON.stringify(reuseOverview)}`,
  );
  assert(
    Array.isArray(reuseOverview?.nodeDiagnostics) &&
      Array.isArray(reuseNodeDiagnostics) &&
      reuseNodeDiagnostics.length === 2 &&
      reuseNodeDiagnostics.every(
        (item) => !("scopeKey" in (item as unknown as Record<string, unknown>)),
      ) &&
      reuseNodeDiagnostics.some(
        (item) =>
          item.nodeId === "filter_text" &&
          item.executionDecision?.reason === "skip_reuse_outputs" &&
          item.skipReuseOutputsHit === true &&
          item.reusableOutputsHit === true,
      ) &&
      reuseNodeDiagnostics.some(
        (item) =>
          item.nodeId === "src_text" &&
          item.executionDecision?.reason === "ineligible_source" &&
          item.reuseVerdict?.reason === "ineligible_capability",
      ),
    `Expected bridge roundtrip to preserve stable node diagnostics surface without leaking cache internals. Actual: ${JSON.stringify(reuseNodeDiagnostics)}`,
  );

  const validationFailureEventTypes = (
    validationFailureResult.runEvents ?? []
  ).map((event) => event.type);
  assert(
    validationFailureEventTypes.join(",") ===
      "run_queued,run_started,stage_started,stage_finished,run_failed",
    `Expected validate failure to stop at minimal lifecycle events. Actual: ${validationFailureEventTypes.join(",")}`,
  );
  assert(
    !validationFailureResult.runArtifact?.latestHeartbeat &&
      !validationFailureResult.runArtifact?.latestPartialOutput &&
      !validationFailureResult.runArtifact?.waitingUser &&
      validationFailureResult.runArtifact?.recoveryEligibility?.status ===
        "ineligible",
    `Expected validation failure artifact to keep observation fields safely absent. Actual: ${JSON.stringify(validationFailureResult.runArtifact)}`,
  );

  const degradedArtifact = toActiveGraphRunArtifactForTest({
    bridge: {
      graph_run_overview: {
        runId: "run_degraded",
        graphId: "graph_degraded",
        status: "waiting_user",
        phase: "blocked",
        phaseLabel: "等待用户",
        blockingContract: {
          kind: "waiting_user",
          reason: {
            category: "waiting_user",
            code: "waiting_user",
            label: "等待用户输入",
          },
          requiresHumanInput: true,
          inputRequirement: {
            required: true,
          },
        },
        eventCount: 1,
        updatedAt: 1,
      },
    },
  });
  assert(
    degradedArtifact?.recoveryEligibility?.status === "unknown" &&
      degradedArtifact?.continuationContract?.handlingPolicy?.kind ===
        "unknown" &&
      degradedArtifact?.continuationContract?.verdict?.status === "unknown" &&
      degradedArtifact?.continuationContract?.recoveryEvidence?.source ===
        "unknown" &&
      degradedArtifact?.continuationContract?.recoveryEvidence?.trust ===
        "unknown" &&
      Array.isArray(degradedArtifact?.continuationContract?.manualInputSlots) &&
      degradedArtifact?.continuationContract?.manualInputSlots.length === 0 &&
      Array.isArray(degradedArtifact?.diagnosticsOverview?.nodeDiagnostics) &&
      degradedArtifact?.diagnosticsOverview?.nodeDiagnostics.length === 0,
    `Expected read-side fallback to degrade missing recovery eligibility, continuation fields, and node diagnostics to conservative empty/unknown values. Actual: ${JSON.stringify(degradedArtifact)}`,
  );

  const executeFailureOverview =
    buildGraphRunDiagnosticsOverview(handlerFailureResult);
  assert(
    executeFailureOverview.run.status === "failed" &&
      executeFailureOverview.run.failedStage === "execute" &&
      executeFailureOverview.compile.compileFingerprint ===
        handlerFailureResult.compilePlan?.compileFingerprint &&
      executeFailureOverview.compile.nodeCount ===
        handlerFailureResult.compilePlan?.nodeOrder.length &&
      executeFailureOverview.compile.terminalNodeCount ===
        handlerFailureResult.compilePlan?.terminalNodeIds.length &&
      executeFailureOverview.dirty.totalNodeCount === 3 &&
      executeFailureOverview.dirty.dirtyNodeCount === 3 &&
      executeFailureOverview.dirty.cleanNodeCount === 0 &&
      executeFailureOverview.dirty.reasonCounts.initial_run === 3,
    `Expected execute failure overview to preserve stable compile/run facts and partial dirty summary. Actual: ${JSON.stringify(executeFailureOverview)}`,
  );

  // ── P1.3 Trace Semantics ──

  // 1. Top-level nodeTraces on successful result
  assert(
    Array.isArray(successResult.nodeTraces) &&
      successResult.nodeTraces.length > 0,
    `Expected successful result to expose top-level nodeTraces. Actual: ${JSON.stringify(successResult.nodeTraces)}`,
  );
  assert(
    successResult
      .nodeTraces!.map((t) => `${t.nodeId}:${t.stage}:${t.status}`)
      .join(",") ===
      "src_text:compile:ok,filter_text:compile:ok,src_text:execute:ok,filter_text:execute:ok",
    `Expected top-level nodeTraces to match trace.nodeTraces. Actual: ${successResult.nodeTraces!.map((t) => `${t.nodeId}:${t.stage}:${t.status}`).join(",")}`,
  );

  // 2. Top-level nodeTraces on handler failure result
  assert(
    Array.isArray(handlerFailureResult.nodeTraces) &&
      handlerFailureResult.nodeTraces.length > 0,
    `Expected handler failure result to expose top-level nodeTraces. Actual: ${JSON.stringify(handlerFailureResult.nodeTraces)}`,
  );

  // 3. Fail-fast skipped trace: after llm_call fails, verify error/ok counts
  //    in a multi-node graph with upstream nodes that succeed.
  const failSkipResult = await executeGraph(
    makeHandlerFailureGraph(),
    makeExecutionContext(),
  );
  const failSkipExecuteTraces = failSkipResult.trace?.nodeTraces?.filter(
    (t) => t.stage === "execute",
  );
  // src_messages and cfg_api execute ok, llm_call fails, no downstream to skip
  const failSkipOkCount =
    failSkipExecuteTraces?.filter((t) => t.status === "ok").length ?? 0;
  const failSkipErrorCount =
    failSkipExecuteTraces?.filter((t) => t.status === "error").length ?? 0;
  assert(
    failSkipOkCount >= 1 && failSkipErrorCount === 1,
    `Expected at least 1 ok trace and exactly 1 error trace in fail-fast scenario. Actual ok=${failSkipOkCount}, error=${failSkipErrorCount}`,
  );

  // 4. Side-effect node trace: out_reply in planExecutionGraph is isSideEffectNode=true
  const sideEffectResult = await executeGraph(
    makePlanExecutionGraph(),
    makeExecutionContext(),
  );
  const sideEffectExecuteTraces = sideEffectResult.trace?.nodeTraces?.filter(
    (t) => t.stage === "execute",
  );
  const outReplyTrace = sideEffectExecuteTraces?.find(
    (t) => t.nodeId === "out_reply",
  );
  assert(
    outReplyTrace?.isSideEffectNode === true,
    `Expected out_reply execute trace to have isSideEffectNode=true. Actual: ${JSON.stringify(outReplyTrace?.isSideEffectNode)}`,
  );
  assert(
    outReplyTrace?.capability === "writes_host" &&
      outReplyTrace?.sideEffect === "writes_host",
    `Expected out_reply execute trace to have writes_host capability. Actual: ${JSON.stringify({ capability: outReplyTrace?.capability, sideEffect: outReplyTrace?.sideEffect })}`,
  );

  // 5. handlerId is consistently recorded in all execute traces
  assert(
    sideEffectExecuteTraces?.every(
      (t) => typeof t.handlerId === "string" && t.handlerId.length > 0,
    ) === true,
    `Expected all execute traces to have non-empty handlerId. Actual: ${JSON.stringify(sideEffectExecuteTraces?.map((t) => t.handlerId))}`,
  );

  // 6. durationMs non-negative for all execute traces
  assert(
    sideEffectExecuteTraces?.every(
      (t) => typeof t.durationMs === "number" && t.durationMs >= 0,
    ) === true,
    `Expected all execute traces to have non-negative durationMs. Actual: ${JSON.stringify(sideEffectExecuteTraces?.map((t) => t.durationMs))}`,
  );

  // 7. error field is string in handler failure trace
  const failedNodeTrace = failSkipResult.trace?.nodeTraces?.find(
    (t) => t.stage === "execute" && t.status === "error",
  );
  assert(
    typeof failedNodeTrace?.error === "string" &&
      failedNodeTrace.error.length > 0,
    `Expected failed node trace error to be a non-empty string. Actual: ${JSON.stringify(failedNodeTrace?.error)}`,
  );

  // 8. failedStage and node-level error trace consistency
  assert(
    failSkipResult.failedStage === "execute" &&
      failSkipResult.trace?.failedStage === "execute" &&
      failedNodeTrace?.status === "error",
    `Expected failedStage and node-level error trace to be consistent. failedStage=${failSkipResult.failedStage}, trace.failedStage=${failSkipResult.trace?.failedStage}, nodeStatus=${failedNodeTrace?.status}`,
  );

  const compileArtifactEnvelope = createGraphCompileArtifactEnvelope({
    plan: handlerFailureResult.compilePlan,
  });
  assert(
    compileArtifactEnvelope?.kind === "graph_compile_artifact" &&
      compileArtifactEnvelope.version === "v1" &&
      compileArtifactEnvelope.artifact.compileFingerprint ===
        handlerFailureResult.compilePlan?.compileFingerprint &&
      compileArtifactEnvelope.artifact.graphId ===
        handlerFailureResult.compilePlan?.fingerprintSource?.graphId &&
      compileArtifactEnvelope.artifact.nodeCount ===
        handlerFailureResult.compilePlan?.fingerprintSource?.nodeCount &&
      compileArtifactEnvelope.artifact.edgeCount ===
        handlerFailureResult.compilePlan?.fingerprintSource?.edgeCount &&
      compileArtifactEnvelope.artifact.nodeOrder.join(",") ===
        (handlerFailureResult.compilePlan?.nodeOrder ?? []).join(","),
    `Expected compile plan to project into stable compile artifact envelope. Actual: ${JSON.stringify(compileArtifactEnvelope)}`,
  );
  assert(
    !JSON.stringify(compileArtifactEnvelope).includes("scopeKey") &&
      !JSON.stringify(compileArtifactEnvelope).includes('"trace"') &&
      !JSON.stringify(compileArtifactEnvelope).includes('"sequence"') &&
      !JSON.stringify(compileArtifactEnvelope).includes('"status"') &&
      !JSON.stringify(compileArtifactEnvelope).includes('"stage"') &&
      !JSON.stringify(compileArtifactEnvelope).includes('"isSideEffectNode"'),
    `Expected compile artifact envelope to omit compile/runtime internal fields. Actual: ${JSON.stringify(compileArtifactEnvelope)}`,
  );

  const compileArtifactRoundtrip = readGraphCompileArtifactEnvelope({
    bridge: {
      graph_compile_artifact: {
        kind: "graph_compile_artifact",
        version: "v1",
        artifact: compileArtifactEnvelope?.artifact,
      },
    },
  });
  assert(
    compileArtifactRoundtrip?.artifact.compileFingerprint ===
      compileArtifactEnvelope?.artifact.compileFingerprint &&
      compileArtifactRoundtrip?.artifact.nodes.length ===
        compileArtifactEnvelope?.artifact.nodes.length,
    `Expected compile artifact envelope to roundtrip through stable read model. Actual: ${JSON.stringify(compileArtifactRoundtrip)}`,
  );

  const degradedCompileArtifact = readGraphCompileArtifactEnvelope({
    bridge: {
      graph_compile_artifact: {
        kind: "graph_compile_artifact",
        version: "v1",
        artifact: {
          compileFingerprint: "compile_fp_sparse",
          graphId: "graph_sparse",
          nodeCount: -3,
          edgeCount: -8,
          nodes: [
            {
              nodeId: "node_sparse",
              moduleId: "src_user_input",
              nodeFingerprint: "node_fp_sparse",
              order: -7,
              isTerminal: true,
              dependsOn: ["missing_dep", 2],
              hostWriteSummary: {
                targetType: "worldbook",
              },
            },
            {
              moduleId: "broken",
            },
          ],
        },
      },
    },
  });
  assert(
    degradedCompileArtifact?.artifact.nodeCount === 0 &&
      degradedCompileArtifact.artifact.edgeCount === 0 &&
      degradedCompileArtifact.artifact.nodeOrder.join(",") === "node_sparse" &&
      degradedCompileArtifact.artifact.terminalNodeIds.join(",") ===
        "node_sparse" &&
      degradedCompileArtifact.artifact.sideEffectNodeIds.length === 0 &&
      degradedCompileArtifact.artifact.nodes.length === 1 &&
      degradedCompileArtifact.artifact.nodes[0]?.order === 0 &&
      degradedCompileArtifact.artifact.nodes[0]?.dependsOn.join(",") ===
        "missing_dep" &&
      degradedCompileArtifact.artifact.nodes[0]?.hostWriteSummary === undefined,
    `Expected malformed or sparse compile artifact payloads to conservatively degrade to stable defaults. Actual: ${JSON.stringify(degradedCompileArtifact)}`,
  );

  const compileRunLinkEnvelope = createGraphCompileRunLinkArtifactEnvelope({
    plan: skipPilotRepeat.compilePlan,
    runArtifact: skipPilotRepeat.runArtifact,
    result: skipPilotRepeat,
  });
  assert(
    compileRunLinkEnvelope?.kind === "graph_compile_run_link_artifact" &&
      compileRunLinkEnvelope.version === "v1" &&
      compileRunLinkEnvelope.artifact.graphId ===
        skipPilotRepeat.runArtifact?.graphId &&
      compileRunLinkEnvelope.artifact.runId === skipPilotRepeat.requestId &&
      compileRunLinkEnvelope.artifact.compileFingerprint ===
        skipPilotRepeat.compilePlan?.compileFingerprint &&
      compileRunLinkEnvelope.artifact.nodeCount ===
        skipPilotRepeat.compilePlan?.fingerprintSource?.nodeCount &&
      compileRunLinkEnvelope.artifact.terminalOutputNodeIds.join(",") === "" &&
      compileRunLinkEnvelope.artifact.hostEffectNodeIds.join(",") ===
        "out_reply",
    `Expected compile-run link envelope to project stable compile-to-run linkage facts. Actual: ${JSON.stringify(compileRunLinkEnvelope)}`,
  );
  assert(
    !JSON.stringify(compileRunLinkEnvelope).includes("scopeKey") &&
      !JSON.stringify(compileRunLinkEnvelope).includes('"outputs"') &&
      !JSON.stringify(compileRunLinkEnvelope).includes('"hostWrites"') &&
      !JSON.stringify(compileRunLinkEnvelope).includes(
        '"hostCommitContracts"',
      ) &&
      !JSON.stringify(compileRunLinkEnvelope).includes('"error"') &&
      !JSON.stringify(compileRunLinkEnvelope).includes('"stack"'),
    `Expected compile-run link envelope to omit runtime/cache/output internals. Actual: ${JSON.stringify(compileRunLinkEnvelope)}`,
  );
  assert(
    compileRunLinkEnvelope?.artifact.nodes
      .map(
        (node: {
          nodeId: string;
          runDisposition: string;
          includedInFinalOutputs: boolean;
          producedHostEffect: boolean;
          inputResolutionObserved: boolean;
        }) =>
          `${node.nodeId}:${node.runDisposition}:${node.includedInFinalOutputs}:${node.producedHostEffect}:${node.inputResolutionObserved}`,
      )
      .join(",") ===
      "src_text:executed:false:false:true,filter_text:skipped_reuse:false:false:true,out_reply:executed:false:true:true",
    `Expected compile-run link artifact to project executed/skipped_reuse and final-output/host-effect split facts. Actual: ${JSON.stringify(compileRunLinkEnvelope?.artifact.nodes)}`,
  );

  const failureCompileRunLinkEnvelope =
    createGraphCompileRunLinkArtifactEnvelope({
      plan: handlerFailureResult.compilePlan,
      runArtifact: handlerFailureResult.runArtifact,
      result: handlerFailureResult,
    });
  assert(
    failureCompileRunLinkEnvelope?.artifact.compileFingerprint ===
      handlerFailureResult.runArtifact?.compileFingerprint &&
      failureCompileRunLinkEnvelope?.artifact.nodes
        .map(
          (node: { nodeId: string; runDisposition: string }) =>
            `${node.nodeId}:${node.runDisposition}`,
        )
        .join(",") ===
        "node_input:executed,node_transform:executed,node_reply:failed",
    `Expected compile fingerprint to align between compile/run facts and failed node to project as failed. Actual: ${JSON.stringify(failureCompileRunLinkEnvelope)}`,
  );

  const notReachedCompileRunLinkEnvelope =
    createGraphCompileRunLinkArtifactEnvelope({
      plan: failSkipResult.compilePlan,
      runArtifact: failSkipResult.runArtifact,
      result: failSkipResult,
    });
  assert(
    notReachedCompileRunLinkEnvelope?.artifact.nodes.some(
      (node: { runDisposition: string }) =>
        node.runDisposition === "not_reached",
    ) &&
      notReachedCompileRunLinkEnvelope.artifact.nodes.find(
        (node: { nodeId: string; runDisposition: string }) =>
          node.runDisposition === "not_reached",
      )?.nodeId === "out_reply",
    `Expected downstream node after execute failure to project as not_reached. Actual: ${JSON.stringify(notReachedCompileRunLinkEnvelope)}`,
  );

  const compileRunLinkRoundtrip = readGraphCompileRunLinkArtifactEnvelope({
    bridge: {
      graph_compile_run_link_artifact: {
        kind: "graph_compile_run_link_artifact",
        version: "v1",
        artifact: compileRunLinkEnvelope?.artifact,
      },
    },
  });
  assert(
    compileRunLinkRoundtrip?.artifact.compileFingerprint ===
      compileRunLinkEnvelope?.artifact.compileFingerprint &&
      compileRunLinkRoundtrip?.artifact.nodes.length ===
        compileRunLinkEnvelope?.artifact.nodes.length,
    `Expected compile-run link envelope to roundtrip through stable read model. Actual: ${JSON.stringify(compileRunLinkRoundtrip)}`,
  );

  const degradedCompileRunLink = readGraphCompileRunLinkArtifactEnvelope({
    bridge: {
      graph_compile_run_link_artifact: {
        kind: "graph_compile_run_link_artifact",
        version: "v1",
        artifact: {
          graphId: "graph_sparse",
          runId: "run_sparse",
          compileFingerprint: "compile_fp_sparse",
          nodeCount: -7,
          terminalOutputNodeIds: ["node_sparse", 2],
          hostEffectNodeIds: ["node_sparse", { bad: true }],
          nodes: [
            {
              nodeId: "node_sparse",
              moduleId: "src_user_input",
              nodeFingerprint: "node_fp_sparse",
              compileOrder: -4,
              dependsOn: ["dep_a", 9],
              isTerminal: true,
              isSideEffect: true,
              runDisposition: "invented_status",
              includedInFinalOutputs: true,
              producedHostEffect: true,
              inputResolutionObserved: true,
              outputs: { leak: true },
              scopeKey: "omit_me",
              hostWrites: [{ leak: true }],
              hostCommitContracts: [{ leak: true }],
              error: "omit_me",
            },
            {
              nodeId: "broken_only",
            },
          ],
        },
      },
    },
  });
  assert(
    degradedCompileRunLink?.artifact.nodeCount === 0 &&
      degradedCompileRunLink.artifact.terminalOutputNodeIds.join(",") ===
        "node_sparse" &&
      degradedCompileRunLink.artifact.hostEffectNodeIds.join(",") ===
        "node_sparse" &&
      degradedCompileRunLink.artifact.nodes.length === 1 &&
      degradedCompileRunLink.artifact.nodes[0]?.compileOrder === 0 &&
      degradedCompileRunLink.artifact.nodes[0]?.dependsOn.join(",") ===
        "dep_a" &&
      degradedCompileRunLink.artifact.nodes[0]?.runDisposition ===
        "not_reached" &&
      !JSON.stringify(degradedCompileRunLink).includes('"outputs"') &&
      !JSON.stringify(degradedCompileRunLink).includes("scopeKey") &&
      !JSON.stringify(degradedCompileRunLink).includes('"hostWrites"') &&
      !JSON.stringify(degradedCompileRunLink).includes(
        '"hostCommitContracts"',
      ) &&
      !JSON.stringify(degradedCompileRunLink).includes('"error"'),
    `Expected malformed or sparse compile-run link payloads to conservatively degrade without leaking runtime internals. Actual: ${JSON.stringify(degradedCompileRunLink)}`,
  );

  const schedulingExplainEnvelope =
    createGraphSchedulingExplainArtifactEnvelope({
      plan: handlerFailureResult.compilePlan,
    });
  assert(
    schedulingExplainEnvelope?.kind === "graph_scheduling_explain_artifact" &&
      schedulingExplainEnvelope.version === "v1" &&
      schedulingExplainEnvelope.artifact.compileFingerprint ===
        handlerFailureResult.compilePlan?.compileFingerprint &&
      schedulingExplainEnvelope.artifact.graphId ===
        handlerFailureResult.compilePlan?.fingerprintSource?.graphId &&
      schedulingExplainEnvelope.artifact.nodeCount ===
        handlerFailureResult.compilePlan?.fingerprintSource?.nodeCount &&
      schedulingExplainEnvelope.artifact.strategyMode === "topological_order" &&
      schedulingExplainEnvelope.artifact.nodes.length ===
        (handlerFailureResult.compilePlan?.nodes.length ?? 0),
    `Expected compile plan to project into stable scheduling explain envelope. Actual: ${JSON.stringify(schedulingExplainEnvelope)}`,
  );
  assert(
    !JSON.stringify(schedulingExplainEnvelope).includes("scopeKey") &&
      !JSON.stringify(schedulingExplainEnvelope).includes('"trace"') &&
      !JSON.stringify(schedulingExplainEnvelope).includes('"sequence"') &&
      !JSON.stringify(schedulingExplainEnvelope).includes('"status"') &&
      !JSON.stringify(schedulingExplainEnvelope).includes('"stage"') &&
      !JSON.stringify(schedulingExplainEnvelope).includes('"hostWrites"') &&
      !JSON.stringify(schedulingExplainEnvelope).includes(
        '"hostCommitContracts"',
      ),
    `Expected scheduling explain envelope to omit runtime/cache internals. Actual: ${JSON.stringify(schedulingExplainEnvelope)}`,
  );
  assert(
    schedulingExplainEnvelope?.artifact.nodes
      .map(
        (node) =>
          `${node.nodeId}:${node.order}:${node.readyLayer}:${node.isSource}:${node.isTerminal}:${node.isSideEffect}:${node.orderingReason.kind}:${node.dependsOn.join("+")}:${node.orderingReason.dependsOnNodeIds.join("+")}`,
      )
      .join(",") ===
      "src_text:0:0:true:false:false:source_node::,filter_text:1:1:false:false:false:dependency_constrained:src_text:src_text,out_reply:2:2:false:true:true:terminal_projection:filter_text:filter_text",
    `Expected scheduling explain artifact to project stable order/dependency/layer/identity facts. Actual: ${JSON.stringify(schedulingExplainEnvelope?.artifact.nodes)}`,
  );

  const schedulingExplainRoundtrip = readGraphSchedulingExplainArtifactEnvelope(
    {
      bridge: {
        graph_scheduling_explain_artifact: {
          kind: "graph_scheduling_explain_artifact",
          version: "v1",
          artifact: schedulingExplainEnvelope?.artifact,
        },
      },
    },
  );
  assert(
    schedulingExplainRoundtrip?.artifact.compileFingerprint ===
      schedulingExplainEnvelope?.artifact.compileFingerprint &&
      schedulingExplainRoundtrip?.artifact.nodes.length ===
        schedulingExplainEnvelope?.artifact.nodes.length,
    `Expected scheduling explain envelope to roundtrip through stable read model. Actual: ${JSON.stringify(schedulingExplainRoundtrip)}`,
  );

  const degradedSchedulingExplain = readGraphSchedulingExplainArtifactEnvelope({
    bridge: {
      graph_scheduling_explain_artifact: {
        kind: "graph_scheduling_explain_artifact",
        version: "v1",
        artifact: {
          graphId: "graph_sparse",
          compileFingerprint: "compile_fp_sparse",
          nodeCount: -4,
          strategyMode: "invented_parallel_mode",
          nodes: [
            {
              nodeId: "node_sparse",
              moduleId: "src_user_input",
              nodeFingerprint: "node_fp_sparse",
              order: -2,
              readyLayer: 99,
              dependsOn: ["missing_dep", 2],
              isTerminal: true,
              isSideEffect: true,
              orderingReason: {
                kind: "made_up_reason",
                dependsOnNodeIds: ["missing_dep", 2],
              },
              leakedTrace: true,
            },
            {
              moduleId: "broken",
            },
          ],
        },
      },
    },
  });
  assert(
    degradedSchedulingExplain?.artifact.nodeCount === 0 &&
      degradedSchedulingExplain.artifact.strategyMode === "topological_order" &&
      degradedSchedulingExplain.artifact.nodes.length === 1 &&
      degradedSchedulingExplain.artifact.nodes[0]?.nodeId === "node_sparse" &&
      degradedSchedulingExplain.artifact.nodes[0]?.order === 0 &&
      degradedSchedulingExplain.artifact.nodes[0]?.readyLayer === 0 &&
      degradedSchedulingExplain.artifact.nodes[0]?.isSource === false &&
      degradedSchedulingExplain.artifact.nodes[0]?.orderingReason.kind ===
        "terminal_projection" &&
      degradedSchedulingExplain.artifact.nodes[0]?.orderingReason.dependsOnNodeIds.join(
        ",",
      ) === "missing_dep",
    `Expected sparse scheduling explain payload to degrade conservatively. Actual: ${JSON.stringify(degradedSchedulingExplain)}`,
  );

  const inputResolutionEnvelope =
    createGraphNodeInputResolutionArtifactEnvelope({
      result: handlerFailureResult,
    });
  assert(
    inputResolutionEnvelope?.kind === "graph_node_input_resolution_artifact" &&
      inputResolutionEnvelope.version === "v1" &&
      inputResolutionEnvelope.artifact.runId ===
        handlerFailureResult.requestId &&
      inputResolutionEnvelope.artifact.graphId ===
        handlerFailureResult.runArtifact?.graphId &&
      inputResolutionEnvelope.artifact.compileFingerprint ===
        handlerFailureResult.runArtifact?.compileFingerprint &&
      inputResolutionEnvelope.artifact.nodes.length ===
        handlerFailureResult.moduleResults.length,
    `Expected node input resolution facts to project into stable input artifact envelope. Actual: ${JSON.stringify(inputResolutionEnvelope)}`,
  );
  assert(
    !JSON.stringify(inputResolutionEnvelope).includes("scopeKey") &&
      !JSON.stringify(inputResolutionEnvelope).includes('"outputs"') &&
      !JSON.stringify(inputResolutionEnvelope).includes('"trace"') &&
      !JSON.stringify(inputResolutionEnvelope).includes('"hostWrites"'),
    `Expected input resolution artifact envelope to omit runtime internals and full payloads. Actual: ${JSON.stringify(inputResolutionEnvelope)}`,
  );
  const resolvedNodeInput = inputResolutionEnvelope?.artifact.nodes.find(
    (node) => node.nodeId === "node_transform",
  );
  const sourceInput = resolvedNodeInput?.inputs.find(
    (item) => item.inputKey === "text",
  );
  assert(
    sourceInput?.resolutionStatus === "resolved" &&
      sourceInput.sourceKind === "edge" &&
      sourceInput.sourceNodeId === "node_input" &&
      sourceInput.sourcePort === "text" &&
      sourceInput.isDefaulted === false &&
      typeof sourceInput.valueSummary?.valueFingerprint === "string" &&
      sourceInput.valueSummary.valueFingerprint.length > 0,
    `Expected upstream edge-backed input resolution facts to be observable. Actual: ${JSON.stringify(sourceInput)}`,
  );
  const failingNodeInput = inputResolutionEnvelope?.artifact.nodes
    .find((node) => node.nodeId === "node_reply")
    ?.inputs.find((item) => item.inputKey === "text");
  assert(
    failingNodeInput?.resolutionStatus === "missing" &&
      failingNodeInput.sourceKind === "unknown" &&
      failingNodeInput.missingReason === "no_observed_source",
    `Expected missing input explanation to stay conservative when no source is observed. Actual: ${JSON.stringify(failingNodeInput)}`,
  );

  const inputResolutionRoundtrip = readGraphNodeInputResolutionArtifactEnvelope(
    {
      bridge: {
        graph_node_input_resolution_artifact: {
          kind: "graph_node_input_resolution_artifact",
          version: "v1",
          artifact: inputResolutionEnvelope?.artifact,
        },
      },
    },
  );
  assert(
    inputResolutionRoundtrip?.artifact.runId ===
      inputResolutionEnvelope?.artifact.runId &&
      inputResolutionRoundtrip?.artifact.nodes.length ===
        inputResolutionEnvelope?.artifact.nodes.length,
    `Expected node input resolution envelope to roundtrip through stable read model. Actual: ${JSON.stringify(inputResolutionRoundtrip)}`,
  );

  const degradedInputResolution = readGraphNodeInputResolutionArtifactEnvelope({
    bridge: {
      graph_node_input_resolution_artifact: {
        kind: "graph_node_input_resolution_artifact",
        version: "v1",
        artifact: {
          runId: "run_sparse",
          graphId: "graph_sparse",
          compileFingerprint: 42,
          nodes: [
            {
              nodeId: "node_sparse",
              moduleId: "src_user_input",
              nodeFingerprint: "node_fp_sparse",
              inputs: [
                {
                  inputKey: "userInput",
                  resolutionStatus: "resolved",
                  sourceKind: "context",
                  isDefaulted: false,
                  valueSummary: {
                    valuePreview: "hello",
                    valueFingerprint: "fp_value",
                    valueType: "string",
                    privatePayload: { raw: "should_not_survive" },
                  },
                  internalTrace: "omit_me",
                },
                {
                  resolutionStatus: "missing",
                },
              ],
            },
            {
              nodeId: "broken_only",
            },
          ],
        },
      },
    },
  });
  assert(
    degradedInputResolution?.artifact.compileFingerprint === undefined &&
      degradedInputResolution?.artifact.nodes.length === 1 &&
      degradedInputResolution?.artifact.nodes[0]?.inputs.length === 1 &&
      degradedInputResolution?.artifact.nodes[0]?.inputs[0]?.valueSummary
        ?.valueFingerprint === "fp_value" &&
      !JSON.stringify(degradedInputResolution).includes("privatePayload") &&
      !JSON.stringify(degradedInputResolution).includes("internalTrace"),
    `Expected malformed or sparse input resolution payloads to conservatively degrade without leaking internal fields. Actual: ${JSON.stringify(degradedInputResolution)}`,
  );

  const bridgeInputResolutionDiagnostics = buildWorkflowBridgeDiagnostics({
    selection: selectWorkflowBridgeRoute({
      input: {
        flow_ids: [],
      },
      settings: {
        workbench_graphs: [makeBaseGraph()],
      },
    }),
    graphRunOverview: handlerFailureResult.runArtifact,
    graphRunEvents: handlerFailureResult.runEvents,
    graphCompilePlan: handlerFailureResult.compilePlan,
    graphInputResolutionArtifact: inputResolutionEnvelope?.artifact,
  });
  const bridgeInputResolution = readGraphNodeInputResolutionArtifactEnvelope(
    bridgeInputResolutionDiagnostics,
  );
  assert(
    bridgeInputResolution?.artifact.runId === handlerFailureResult.requestId &&
      bridgeInputResolution?.artifact.nodes.length ===
        (inputResolutionEnvelope?.artifact.nodes.length ?? 0),
    `Expected workflow bridge diagnostics to expose stable node input resolution artifact surface. Actual: ${JSON.stringify(bridgeInputResolution)}`,
  );

  const snapshotEnvelope = createGraphRunSnapshotEnvelope({
    overview: handlerFailureResult.runArtifact,
    events: handlerFailureResult.runEvents,
    diagnosticsOverview: handlerFailureResult.diagnosticsOverview,
  });
  assert(
    snapshotEnvelope?.kind === "graph_run_snapshot" &&
      snapshotEnvelope.version === "v1" &&
      snapshotEnvelope.snapshot.overview.runId ===
        handlerFailureResult.requestId &&
      snapshotEnvelope.snapshot.overview.graphId ===
        handlerFailureResult.runArtifact?.graphId &&
      snapshotEnvelope.snapshot.events.length ===
        (handlerFailureResult.runEvents?.length ?? 0) &&
      snapshotEnvelope.snapshot.diagnosticsOverview?.nodeDiagnostics?.length ===
        (handlerFailureResult.diagnosticsOverview?.nodeDiagnostics?.length ??
          0),
    `Expected runtime graph run artifact to project into stable snapshot envelope. Actual: ${JSON.stringify(snapshotEnvelope)}`,
  );
  assert(
    !JSON.stringify(snapshotEnvelope).includes("scopeKey") &&
      !JSON.stringify(snapshotEnvelope).includes('"trace"') &&
      !JSON.stringify(snapshotEnvelope).includes('"nodeTraces"'),
    `Expected graph run snapshot envelope to omit runtime-only trace and scope internals. Actual: ${JSON.stringify(snapshotEnvelope)}`,
  );

  const roundtripEnvelope = readGraphRunSnapshotEnvelope({
    bridge: {
      graph_run_snapshot: {
        kind: "graph_run_snapshot",
        version: "v1",
        snapshot: snapshotEnvelope?.snapshot,
      },
    },
  });
  assert(
    roundtripEnvelope?.snapshot.overview.runId ===
      snapshotEnvelope?.snapshot.overview.runId &&
      roundtripEnvelope?.snapshot.events.length ===
        snapshotEnvelope?.snapshot.events.length,
    `Expected graph run snapshot envelope to roundtrip through stable read model. Actual: ${JSON.stringify(roundtripEnvelope)}`,
  );

  const legacyEnvelope = readGraphRunSnapshotEnvelope({
    bridge: {
      graph_run_overview: {
        runId: "legacy_run",
        graphId: "legacy_graph",
        status: "waiting_user",
        phase: "blocked",
        phaseLabel: "阻塞中",
        blockingContract: {
          kind: "waiting_user",
          reason: {
            category: "waiting_user",
            code: "waiting_user",
            label: "等待用户输入",
          },
          requiresHumanInput: true,
          inputRequirement: {
            required: true,
          },
          recoveryPrerequisites: [],
        },
        eventCount: 1,
        updatedAt: 7,
      },
      graph_run_events: [
        {
          type: "waiting_user",
          runId: "legacy_run",
          graphId: "legacy_graph",
          phase: "blocked",
          phaseLabel: "阻塞中",
          timestamp: 8,
          artifact: {
            trace: "should_be_ignored",
          },
        },
      ],
      graph_node_diagnostics: [
        {
          nodeId: "node_waiting",
          moduleId: "src_user_input",
          title: "等待用户输入",
        },
      ],
    },
  });
  assert(
    legacyEnvelope?.snapshot.overview.runId === "legacy_run" &&
      legacyEnvelope.snapshot.events.length === 1 &&
      legacyEnvelope.snapshot.nodeDiagnostics?.[0]?.nodeId === "node_waiting" &&
      !JSON.stringify(legacyEnvelope).includes("should_be_ignored"),
    `Expected legacy bridge graph run fields to upgrade into stable snapshot envelope without leaking nested runtime artifact payloads. Actual: ${JSON.stringify(legacyEnvelope)}`,
  );

  const degradedEnvelope = readGraphRunSnapshotEnvelope({
    bridge: {
      graph_run_snapshot: {
        kind: "graph_run_snapshot",
        version: "v1",
        snapshot: {
          overview: {
            runId: "degraded_run",
            graphId: "degraded_graph",
            status: "waiting_user",
            phaseLabel: "等待用户",
            eventCount: -3,
            updatedAt: -9,
          },
          events: [
            {
              type: "heartbeat",
              runId: "degraded_run",
              graphId: "degraded_graph",
              timestamp: -1,
            },
            {
              type: "unknown_event_type",
              runId: "degraded_run",
              graphId: "degraded_graph",
              timestamp: 2,
            },
          ],
        },
      },
    },
  });
  assert(
    degradedEnvelope?.snapshot.overview.phase === "blocked" &&
      degradedEnvelope.snapshot.overview.eventCount === 0 &&
      degradedEnvelope.snapshot.overview.updatedAt === 0 &&
      degradedEnvelope.snapshot.events.length === 1 &&
      degradedEnvelope.snapshot.events[0]?.timestamp === 0,
    `Expected malformed or sparse snapshot envelope fields to conservatively degrade to stable defaults. Actual: ${JSON.stringify(degradedEnvelope)}`,
  );

  const migratedGraph = migrateFlowToGraph(makeLegacyFlowFixture());
  assert(
    migratedGraph.id === "migrated_legacy_flow_1",
    `Expected migrated graph id to be prefixed. Actual: ${migratedGraph.id}`,
  );
  assert(
    migratedGraph.name === "[迁移] Legacy Flow",
    `Expected migrated graph name to be prefixed. Actual: ${migratedGraph.name}`,
  );
  assert(
    migratedGraph.nodes.some((node) => node.moduleId === "src_user_input"),
    "Expected migrated graph to retain user input source node",
  );
  assert(
    migratedGraph.nodes.some((node) => node.moduleId === "exe_llm_call"),
    "Expected migrated graph to include execution node",
  );
  assert(
    migratedGraph.nodes.some((node) => node.moduleId === "out_floor_bind"),
    "Expected migrated graph to include legacy output bridge node",
  );
  const migratedValidation = validateGraph(migratedGraph);
  assert(
    Array.isArray(migratedValidation.errors) &&
      Array.isArray(migratedValidation.diagnostics),
    "Expected migrated graph to remain acceptable to validateGraph entrypoint",
  );

  const promptContextGraph = migrateFlowToGraph(
    makeLegacyPromptContextFixture(),
  );
  const promptContextNodeByModule = new Map(
    promptContextGraph.nodes.map((node) => [node.moduleId, node]),
  );
  const promptContextEdgePairs = promptContextGraph.edges.map(
    (edge) =>
      `${promptContextGraph.nodes.find((node) => node.id === edge.source)?.moduleId}:${edge.sourcePort}->${promptContextGraph.nodes.find((node) => node.id === edge.target)?.moduleId}:${edge.targetPort}`,
  );
  const promptContextRegexNode =
    promptContextNodeByModule.get("flt_custom_regex");
  assert(
    promptContextNodeByModule.has("src_chat_history") &&
      promptContextNodeByModule.has("src_user_input") &&
      promptContextNodeByModule.has("src_flow_context") &&
      promptContextNodeByModule.has("src_worldbook_raw"),
    `Expected migrated prompt-context fixture to include required source assembly nodes. Actual modules: ${promptContextGraph.nodes.map((node) => node.moduleId).join(",")}`,
  );
  assert(
    promptContextEdgePairs.includes(
      "src_chat_history:messages->flt_context_extract:msgs_in",
    ) &&
      promptContextEdgePairs.includes(
        "flt_context_extract:msgs_out->flt_context_exclude:msgs_in",
      ) &&
      promptContextEdgePairs.includes(
        "flt_context_exclude:msgs_out->flt_hide_messages:msgs_in",
      ),
    `Expected context filtering chain order to remain chat_history -> flt_context_extract -> flt_context_exclude -> flt_hide_messages. Actual: ${promptContextEdgePairs.join(",")}`,
  );
  assert(
    promptContextEdgePairs.includes(
      "cfg_system_prompt:prompt->tfm_macro_replace:text_in",
    ) &&
      promptContextEdgePairs.includes(
        "tfm_macro_replace:text_out->flt_custom_regex:text_in",
      ),
    `Expected system prompt transform chain to remain cfg_system_prompt -> tfm_macro_replace -> flt_custom_regex when enabled regex rules exist. Actual: ${promptContextEdgePairs.join(",")}`,
  );
  assert(
    Array.isArray(promptContextRegexNode?.config.rules) &&
      promptContextRegexNode.config.rules.length === 1 &&
      promptContextRegexNode.config.rules[0]?.find === "foo(\\s+)bar" &&
      promptContextRegexNode.config.rules[0]?.replace === "baz" &&
      promptContextRegexNode.config.rules[0]?.flags === "g",
    `Expected only enabled custom regex rules to migrate with stable field mapping. Actual: ${JSON.stringify(promptContextRegexNode?.config)}`,
  );
  assert(
    promptContextGraph.enabled === false &&
      promptContextGraph.timing === "before_reply" &&
      promptContextGraph.priority === 9 &&
      promptContextGraph.id === "migrated_legacy_prompt_context_1" &&
      promptContextGraph.name === "[迁移] Legacy Prompt Context Flow",
    `Expected migrated graph metadata to stay bridge-consumable. Actual: ${JSON.stringify({ enabled: promptContextGraph.enabled, timing: promptContextGraph.timing, priority: promptContextGraph.priority, id: promptContextGraph.id, name: promptContextGraph.name })}`,
  );

  const passthroughGraphs = autoMigrateIfNeeded({
    flows: [makeLegacyFlowFixture()],
    workbench_graphs: [makeBaseGraph()],
  });
  assert(
    passthroughGraphs.length === 1 && passthroughGraphs[0].id === "graph_test",
    `Expected existing workbench graphs to bypass auto migration. Actual: ${passthroughGraphs.map((graph) => graph.id).join(",")}`,
  );

  const autoMigratedGraphs = autoMigrateIfNeeded({
    flows: [makeLegacyFlowFixture()],
    workbench_graphs: [],
  });
  assert(
    autoMigratedGraphs.length === 1 &&
      autoMigratedGraphs[0].id === migratedGraph.id,
    `Expected auto migration to produce migrated legacy graph. Actual: ${autoMigratedGraphs.map((graph) => graph.id).join(",")}`,
  );

  const graphFirstRoute = selectWorkflowBridgeRoute({
    input: {
      flow_ids: undefined,
    },
    settings: {
      workbench_graphs: [
        makeBaseGraph(),
        {
          ...makeDispatchSmokeGraph(),
          id: "graph_disabled",
          enabled: false,
        },
      ],
    },
  });
  assertBridgeRoute(graphFirstRoute, {
    route: "graph",
    reason: "graph_first",
    enabledGraphIds: ["graph_test"],
    hasExplicitLegacyFlowSelection: false,
  });

  const legacyFallbackRoute = selectWorkflowBridgeRoute({
    input: {
      flow_ids: undefined,
    },
    settings: {
      workbench_graphs: [],
    },
  });
  assertBridgeRoute(legacyFallbackRoute, {
    route: "legacy",
    reason: "no_enabled_graph",
    enabledGraphIds: [],
    hasExplicitLegacyFlowSelection: false,
  });

  const explicitLegacySelectionRoute = selectWorkflowBridgeRoute({
    input: {
      flow_ids: ["legacy_flow_1"],
    },
    settings: {
      workbench_graphs: [makeBaseGraph()],
    },
  });
  assertBridgeRoute(explicitLegacySelectionRoute, {
    route: "legacy",
    reason: "legacy_flow_selection",
    enabledGraphIds: ["graph_test"],
    hasExplicitLegacyFlowSelection: true,
  });

  const singlePathRoute = selectWorkflowBridgeRoute({
    input: {
      flow_ids: ["", "   "],
    },
    settings: {
      workbench_graphs: [makeBaseGraph(), makeDispatchSmokeGraph()],
    },
  });
  assertBridgeRoute(singlePathRoute, {
    route: "graph",
    reason: "graph_first",
    enabledGraphIds: ["graph_test", "graph_dispatch_smoke"],
    hasExplicitLegacyFlowSelection: false,
  });
  assert(
    ["graph", "legacy"].filter((route) => route === singlePathRoute.route)
      .length === 1,
    `Expected one request to resolve to a single bridge route. Actual route: ${singlePathRoute.route}`,
  );

  assertBridgeDiagnostics(
    buildWorkflowBridgeDiagnostics({ selection: graphFirstRoute }),
    {
      route: "graph",
      reason: "graph_first",
      hasExplicitLegacyFlowSelection: false,
      enabledGraphCount: 1,
      selectedGraphIds: ["graph_test"],
    },
  );
  const bridgeDiagnosticsWithCompileArtifact = buildWorkflowBridgeDiagnostics({
    selection: graphFirstRoute,
    failureOrigin: "graph_dispatch",
    graphCompilePlan: compilePlanFixture,
    graphExecutionResult: skipPilotRepeat,
  });
  assertBridgeDiagnostics(bridgeDiagnosticsWithCompileArtifact, {
    route: "graph",
    reason: "graph_first",
    hasExplicitLegacyFlowSelection: false,
    enabledGraphCount: 1,
    selectedGraphIds: ["graph_test"],
    failureOrigin: "graph_dispatch",
  });
  const bridgeCompileArtifact = readGraphCompileArtifactEnvelope(
    bridgeDiagnosticsWithCompileArtifact,
  );
  assert(
    bridgeCompileArtifact?.artifact.compileFingerprint ===
      compilePlanFixture.compileFingerprint &&
      bridgeCompileArtifact.artifact.graphId ===
        compilePlanFixture.fingerprintSource?.graphId &&
      bridgeCompileArtifact.artifact.nodes.length ===
        compilePlanFixture.nodes.length,
    `Expected workflow bridge diagnostics to expose stable compile artifact surface. Actual: ${JSON.stringify(bridgeCompileArtifact)}`,
  );
  const bridgeSchedulingExplainArtifact =
    readGraphSchedulingExplainArtifactEnvelope(
      bridgeDiagnosticsWithCompileArtifact,
    );
  assert(
    bridgeSchedulingExplainArtifact?.artifact.compileFingerprint ===
      compilePlanFixture.compileFingerprint &&
      bridgeSchedulingExplainArtifact.artifact.graphId ===
        compilePlanFixture.fingerprintSource?.graphId &&
      bridgeSchedulingExplainArtifact.artifact.nodes.length ===
        compilePlanFixture.nodes.length &&
      bridgeSchedulingExplainArtifact.artifact.nodes.every(
        (node) =>
          !Object.prototype.hasOwnProperty.call(node, "compileFingerprint") &&
          typeof node.orderingReason?.detail === "string",
      ),
    `Expected workflow bridge diagnostics to expose stable scheduling explain artifact surface aligned with compile fingerprint. Actual: ${JSON.stringify(bridgeSchedulingExplainArtifact)}`,
  );
  const bridgeCompileRunLinkArtifact = readGraphCompileRunLinkArtifactEnvelope(
    bridgeDiagnosticsWithCompileArtifact,
  );
  assert(
    bridgeCompileRunLinkArtifact?.artifact.compileFingerprint ===
      compilePlanFixture.compileFingerprint &&
      bridgeCompileRunLinkArtifact.artifact.runId ===
        skipPilotRepeat.requestId &&
      bridgeCompileRunLinkArtifact.artifact.nodes.length ===
        compilePlanFixture.nodes.length &&
      bridgeCompileRunLinkArtifact.artifact.nodes.some(
        (node) => node.runDisposition === "skipped_reuse",
      ) &&
      bridgeCompileRunLinkArtifact.artifact.hostEffectNodeIds.join(",") ===
        "out_reply",
    `Expected workflow bridge diagnostics to expose stable compile-run link artifact surface aligned with compile fingerprint and run facts. Actual: ${JSON.stringify(bridgeCompileRunLinkArtifact)}`,
  );
  const store = useEwStore();
  setLastRun(
    RunSummarySchema.parse({
      at: Date.now(),
      ok: true,
      reason: "store compile-run link artifact",
      request_id: skipPilotRepeat.requestId,
      chat_id: "chat_store_compile_run_link",
      flow_count: 1,
      elapsed_ms: skipPilotRepeat.elapsedMs,
      mode: "manual",
      diagnostics: bridgeDiagnosticsWithCompileArtifact,
    }),
  );
  const activeCompileRunLinkArtifact = store.activeGraphCompileRunLinkArtifact;
  assert(
    activeCompileRunLinkArtifact?.compileFingerprint ===
      compilePlanFixture.compileFingerprint &&
      activeCompileRunLinkArtifact.runId === skipPilotRepeat.requestId &&
      activeCompileRunLinkArtifact.nodes.some(
        (node: { runDisposition: string }) =>
          node.runDisposition === "skipped_reuse",
      ),
    `Expected store read surface to consume graph compile-run link artifact from lastRun diagnostics. Actual: ${JSON.stringify(activeCompileRunLinkArtifact)}`,
  );
  assertBridgeDiagnostics(
    buildWorkflowBridgeDiagnostics({ selection: legacyFallbackRoute }),
    {
      route: "legacy",
      reason: "no_enabled_graph",
      hasExplicitLegacyFlowSelection: false,
      enabledGraphCount: 0,
    },
  );
  assertBridgeDiagnostics(
    buildWorkflowBridgeDiagnostics({
      selection: explicitLegacySelectionRoute,
      failureOrigin: "legacy_dispatch",
    }),
    {
      route: "legacy",
      reason: "legacy_flow_selection",
      hasExplicitLegacyFlowSelection: true,
      enabledGraphCount: 1,
      failureOrigin: "legacy_dispatch",
    },
  );
  assertBridgeDiagnostics(
    buildWorkflowBridgeDiagnostics({
      selection: explicitLegacySelectionRoute,
      failureOrigin: "legacy_merge",
    }),
    {
      route: "legacy",
      reason: "legacy_flow_selection",
      hasExplicitLegacyFlowSelection: true,
      enabledGraphCount: 1,
      failureOrigin: "legacy_merge",
    },
  );
  assertBridgeDiagnostics(
    buildWorkflowBridgeDiagnostics({
      selection: explicitLegacySelectionRoute,
      failureOrigin: "legacy_writeback",
    }),
    {
      route: "legacy",
      reason: "legacy_flow_selection",
      hasExplicitLegacyFlowSelection: true,
      enabledGraphCount: 1,
      failureOrigin: "legacy_writeback",
    },
  );
  assertBridgeDiagnostics(
    buildWorkflowBridgeDiagnostics({
      selection: legacyFallbackRoute,
      failureOrigin: "cancelled",
    }),
    {
      route: "legacy",
      reason: "no_enabled_graph",
      hasExplicitLegacyFlowSelection: false,
      enabledGraphCount: 0,
      failureOrigin: "cancelled",
    },
  );

  const graphSummary = createRunSummaryFixture({
    chatId: "chat_graph_success",
    requestId: "req_graph_success",
    ok: true,
    reason: "",
    bridgeDiagnostics: buildWorkflowBridgeDiagnostics({
      selection: graphFirstRoute,
    }),
  });
  setLastRun(graphSummary);
  assertRunSummaryBridgeContract(loadLastRun(), {
    chatId: "chat_graph_success",
    requestId: "req_graph_success",
    ok: true,
    reason: "",
    route: "graph",
    bridgeReason: "graph_first",
    hasExplicitLegacyFlowSelection: false,
    enabledGraphCount: 1,
    selectedGraphIds: ["graph_test"],
    hasFailure: false,
  });
  assertRunSummaryBridgeContract(loadLastRunForChat("chat_graph_success"), {
    chatId: "chat_graph_success",
    requestId: "req_graph_success",
    ok: true,
    reason: "",
    route: "graph",
    bridgeReason: "graph_first",
    hasExplicitLegacyFlowSelection: false,
    enabledGraphCount: 1,
    selectedGraphIds: ["graph_test"],
    hasFailure: false,
  });

  const legacySuccessSummary = createRunSummaryFixture({
    chatId: "chat_legacy_success",
    requestId: "req_legacy_success",
    ok: true,
    reason: "",
    bridgeDiagnostics: buildWorkflowBridgeDiagnostics({
      selection: explicitLegacySelectionRoute,
    }),
  });
  setLastRun(legacySuccessSummary);
  assertRunSummaryBridgeContract(loadLastRunForChat("chat_legacy_success"), {
    chatId: "chat_legacy_success",
    requestId: "req_legacy_success",
    ok: true,
    reason: "",
    route: "legacy",
    bridgeReason: "legacy_flow_selection",
    hasExplicitLegacyFlowSelection: true,
    enabledGraphCount: 1,
    hasFailure: false,
  });

  const legacyFailureSummary = createRunSummaryFixture({
    chatId: "chat_legacy_failure",
    requestId: "req_legacy_failure",
    ok: false,
    reason: "legacy dispatch failed",
    bridgeDiagnostics: buildWorkflowBridgeDiagnostics({
      selection: explicitLegacySelectionRoute,
      failureOrigin: "legacy_dispatch",
    }),
    failure: {
      stage: "dispatch",
      kind: "unknown",
      summary: "legacy dispatch failed",
      detail: "legacy dispatch failed",
      suggestion: "",
      request_id: "req_legacy_failure",
      flow_id: "flow_legacy",
      flow_name: "Legacy Flow",
      api_preset_name: "preset",
      http_status: null,
      retry_count: 0,
      attempted_flow_count: 1,
      successful_flow_count: 0,
      failed_flow_count: 1,
      partial_success: false,
      whole_workflow_failed: true,
    },
  });
  setLastRun(legacyFailureSummary);
  assertRunSummaryBridgeContract(loadLastRunForChat("chat_legacy_failure"), {
    chatId: "chat_legacy_failure",
    requestId: "req_legacy_failure",
    ok: false,
    reason: "legacy dispatch failed",
    route: "legacy",
    bridgeReason: "legacy_flow_selection",
    hasExplicitLegacyFlowSelection: true,
    enabledGraphCount: 1,
    failureOrigin: "legacy_dispatch",
    hasFailure: true,
  });

  const noEnabledGraphSummary = createRunSummaryFixture({
    chatId: "chat_legacy_skip",
    requestId: "req_legacy_skip",
    ok: true,
    reason: "no flows match timing 'after_reply'",
    bridgeDiagnostics: buildWorkflowBridgeDiagnostics({
      selection: legacyFallbackRoute,
    }),
  });
  setLastRun(noEnabledGraphSummary);
  assertRunSummaryBridgeContract(loadLastRunForChat("chat_legacy_skip"), {
    chatId: "chat_legacy_skip",
    requestId: "req_legacy_skip",
    ok: true,
    reason: "no flows match timing 'after_reply'",
    route: "legacy",
    bridgeReason: "no_enabled_graph",
    hasExplicitLegacyFlowSelection: false,
    enabledGraphCount: 0,
    hasFailure: false,
  });

  const legacyGlobalSummaryRaw = {
    at: Date.now(),
    ok: true,
    reason: "",
    request_id: "req_legacy_global_only",
    chat_id: "chat_legacy_global_only",
    flow_count: 1,
    elapsed_ms: 21,
    mode: "manual",
    diagnostics: buildWorkflowBridgeDiagnostics({
      selection: explicitLegacySelectionRoute,
    }),
  };
  globalThis.localStorage?.setItem(
    "evolution_world_assistant",
    JSON.stringify({
      last_run: legacyGlobalSummaryRaw,
    }),
  );
  assertRunSummaryBridgeContract(loadLastRun(), {
    chatId: "chat_legacy_global_only",
    requestId: "req_legacy_global_only",
    ok: true,
    reason: "",
    route: "legacy",
    bridgeReason: "legacy_flow_selection",
    hasExplicitLegacyFlowSelection: true,
    enabledGraphCount: 1,
    hasFailure: false,
  });
  assertRunSummaryBridgeContract(
    loadLastRunForChat("chat_legacy_global_only"),
    {
      chatId: "chat_legacy_global_only",
      requestId: "req_legacy_global_only",
      ok: true,
      reason: "",
      route: "legacy",
      bridgeReason: "legacy_flow_selection",
      hasExplicitLegacyFlowSelection: true,
      enabledGraphCount: 1,
      hasFailure: false,
    },
  );

  const legacyByChatPreferredRaw = {
    at: Date.now(),
    ok: true,
    reason: "preferred by chat",
    request_id: "req_legacy_by_chat_preferred",
    chat_id: "chat_legacy_by_chat_preferred",
    flow_count: 1,
    elapsed_ms: 34,
    mode: "manual",
    diagnostics: buildWorkflowBridgeDiagnostics({
      selection: explicitLegacySelectionRoute,
    }),
  };
  const legacyGlobalFallbackRaw = {
    at: Date.now(),
    ok: false,
    reason: "should not win over by chat",
    request_id: "req_legacy_global_stale",
    chat_id: "chat_legacy_by_chat_preferred",
    flow_count: 1,
    elapsed_ms: 55,
    mode: "manual",
    diagnostics: buildWorkflowBridgeDiagnostics({
      selection: legacyFallbackRoute,
      failureOrigin: "cancelled",
    }),
  };
  globalThis.localStorage?.setItem(
    "evolution_world_assistant",
    JSON.stringify({
      last_run: legacyGlobalFallbackRaw,
      last_run_by_chat: {
        chat_legacy_by_chat_preferred: legacyByChatPreferredRaw,
      },
    }),
  );
  assertRunSummaryBridgeContract(
    loadLastRunForChat("chat_legacy_by_chat_preferred"),
    {
      chatId: "chat_legacy_by_chat_preferred",
      requestId: "req_legacy_by_chat_preferred",
      ok: true,
      reason: "preferred by chat",
      route: "legacy",
      bridgeReason: "legacy_flow_selection",
      hasExplicitLegacyFlowSelection: true,
      enabledGraphCount: 1,
      hasFailure: false,
    },
  );
  assertRunSummaryBridgeContract(loadLastRun(), {
    chatId: "chat_legacy_by_chat_preferred",
    requestId: "req_legacy_by_chat_preferred",
    ok: true,
    reason: "preferred by chat",
    route: "legacy",
    bridgeReason: "legacy_flow_selection",
    hasExplicitLegacyFlowSelection: true,
    enabledGraphCount: 1,
    hasFailure: false,
  });
  const persistedByChatPreferred = readPersistedScriptStorage();
  assert(
    (persistedByChatPreferred.last_run as RunSummary | undefined)
      ?.request_id === "req_legacy_by_chat_preferred",
    `Expected by-chat hit to backfill global last_run. Actual: ${JSON.stringify(persistedByChatPreferred.last_run)}`,
  );

  const legacyGlobalChatFallbackRaw = {
    at: Date.now(),
    ok: true,
    reason: "fallback from global",
    request_id: "req_legacy_global_chat_fallback",
    chat_id: "chat_legacy_global_chat_fallback",
    flow_count: 1,
    elapsed_ms: 18,
    mode: "manual",
    diagnostics: buildWorkflowBridgeDiagnostics({
      selection: explicitLegacySelectionRoute,
    }),
  };
  globalThis.localStorage?.setItem(
    "evolution_world_assistant",
    JSON.stringify({
      last_run: legacyGlobalChatFallbackRaw,
      last_run_by_chat: {},
    }),
  );
  assertRunSummaryBridgeContract(
    loadLastRunForChat("chat_legacy_global_chat_fallback"),
    {
      chatId: "chat_legacy_global_chat_fallback",
      requestId: "req_legacy_global_chat_fallback",
      ok: true,
      reason: "fallback from global",
      route: "legacy",
      bridgeReason: "legacy_flow_selection",
      hasExplicitLegacyFlowSelection: true,
      enabledGraphCount: 1,
      hasFailure: false,
    },
  );

  // ══════════════════════════════════════════════════════════════════
  // P3.7 — last_run 读取链 diagnostics.bridge 最小结构归一化
  // ══════════════════════════════════════════════════════════════════

  // 场景 A: 合法最小 bridge 可读回
  const minimalGlobalBridgeRaw = {
    at: Date.now(),
    ok: true,
    reason: "minimal global bridge",
    request_id: "req_minimal_global_bridge",
    chat_id: "chat_minimal_global_bridge",
    flow_count: 1,
    elapsed_ms: 19,
    mode: "manual",
    diagnostics: {
      bridge: {
        route: "legacy",
        reason: "legacy_flow_selection",
      },
    },
  };
  globalThis.localStorage?.setItem(
    "evolution_world_assistant",
    JSON.stringify({
      last_run: minimalGlobalBridgeRaw,
      last_run_by_chat: {},
    }),
  );
  const minimalGlobalBridgeSummary = loadLastRun();
  assert(
    minimalGlobalBridgeSummary,
    "P3.7-A: Expected minimal global bridge to load",
  );
  assert(
    minimalGlobalBridgeSummary?.diagnostics?.bridge?.route === "legacy" &&
      minimalGlobalBridgeSummary?.diagnostics?.bridge?.reason ===
        "legacy_flow_selection",
    `P3.7-A: Expected minimal bridge facts to survive load. Actual: ${JSON.stringify(minimalGlobalBridgeSummary?.diagnostics?.bridge)}`,
  );

  // 场景 B: 合法 bridge 的可选字段按白名单保留，且 selected_graph_ids 归一到顶层
  const whitelistedBridgeRaw = {
    at: Date.now(),
    ok: true,
    reason: "whitelisted bridge",
    request_id: "req_whitelisted_bridge",
    chat_id: "chat_whitelisted_bridge",
    flow_count: 1,
    elapsed_ms: 20,
    mode: "manual",
    diagnostics: {
      bridge: {
        route: "graph",
        reason: "graph_first",
        has_explicit_legacy_flow_selection: false,
        enabled_graph_count: 2,
        graph_context: {
          selected_graph_ids: ["graph_a", "graph_b"],
        },
        failure_origin: "graph_dispatch",
        ignored_extra_field: "should_drop",
      },
    },
  };
  globalThis.localStorage?.setItem(
    "evolution_world_assistant",
    JSON.stringify({
      last_run: whitelistedBridgeRaw,
      last_run_by_chat: {},
    }),
  );
  const whitelistedBridgeSummary = loadLastRun();
  assert(
    whitelistedBridgeSummary?.diagnostics?.bridge?.route === "graph" &&
      whitelistedBridgeSummary?.diagnostics?.bridge?.reason === "graph_first",
    `P3.7-B: Expected valid bridge core facts to survive load. Actual: ${JSON.stringify(whitelistedBridgeSummary?.diagnostics?.bridge)}`,
  );
  assert(
    whitelistedBridgeSummary?.diagnostics?.bridge
      ?.has_explicit_legacy_flow_selection === false &&
      whitelistedBridgeSummary?.diagnostics?.bridge?.enabled_graph_count ===
        2 &&
      JSON.stringify(
        whitelistedBridgeSummary?.diagnostics?.bridge?.selected_graph_ids,
      ) === JSON.stringify(["graph_a", "graph_b"]) &&
      !(
        "graph_context" in
        ((whitelistedBridgeSummary?.diagnostics?.bridge as Record<
          string,
          unknown
        > | null) ?? {})
      ) &&
      whitelistedBridgeSummary?.diagnostics?.bridge?.failure_origin ===
        "graph_dispatch" &&
      !(
        "ignored_extra_field" in
        ((whitelistedBridgeSummary?.diagnostics?.bridge as Record<
          string,
          unknown
        > | null) ?? {})
      ),
    `P3.7-B: Expected only whitelisted optional fields to survive load. Actual: ${JSON.stringify(whitelistedBridgeSummary?.diagnostics?.bridge)}`,
  );

  // 场景 B2: 历史 graph_context.selected_graph_ids 输入会归一到顶层 selected_graph_ids
  const legacyGraphContextBridgeRaw = {
    at: Date.now(),
    ok: true,
    reason: "legacy graph context bridge",
    request_id: "req_legacy_graph_context_bridge",
    chat_id: "chat_legacy_graph_context_bridge",
    flow_count: 1,
    elapsed_ms: 21,
    mode: "manual",
    diagnostics: {
      bridge: {
        route: "graph",
        reason: "graph_first",
        graph_context: {
          selected_graph_ids: ["graph_legacy_a"],
        },
      },
    },
  };
  globalThis.localStorage?.setItem(
    "evolution_world_assistant",
    JSON.stringify({
      last_run: legacyGraphContextBridgeRaw,
      last_run_by_chat: {},
    }),
  );
  const legacyGraphContextBridgeSummary = loadLastRun();
  assert(
    JSON.stringify(
      legacyGraphContextBridgeSummary?.diagnostics?.bridge?.selected_graph_ids,
    ) === JSON.stringify(["graph_legacy_a"]) &&
      !(
        "graph_context" in
        ((legacyGraphContextBridgeSummary?.diagnostics?.bridge as Record<
          string,
          unknown
        > | null) ?? {})
      ),
    `P3.7-B2: Expected legacy graph_context.selected_graph_ids input to normalize to top-level selected_graph_ids without graph_context. Actual: ${JSON.stringify(legacyGraphContextBridgeSummary?.diagnostics?.bridge)}`,
  );

  // 场景 C: 缺失 route 时整个 bridge 被剔除
  const invalidBridgeMissingRouteRaw = {
    at: Date.now(),
    ok: true,
    reason: "invalid bridge missing route",
    request_id: "req_invalid_bridge_missing_route",
    chat_id: "chat_invalid_bridge_missing_route",
    flow_count: 1,
    elapsed_ms: 11,
    mode: "manual",
    diagnostics: {
      bridge: {
        reason: "legacy_flow_selection",
      },
    },
  };
  globalThis.localStorage?.setItem(
    "evolution_world_assistant",
    JSON.stringify({
      last_run: invalidBridgeMissingRouteRaw,
      last_run_by_chat: {},
    }),
  );
  const invalidBridgeMissingRouteSummary = loadLastRun();
  assert(
    invalidBridgeMissingRouteSummary?.diagnostics?.bridge === undefined,
    `P3.7-C: Expected bridge to be removed when route is missing. Actual: ${JSON.stringify(invalidBridgeMissingRouteSummary?.diagnostics?.bridge)}`,
  );

  // 场景 D: 缺失 reason 时整个 bridge 被剔除
  const invalidBridgeMissingReasonRaw = {
    at: Date.now(),
    ok: true,
    reason: "invalid bridge missing reason",
    request_id: "req_invalid_bridge_missing_reason",
    chat_id: "chat_invalid_bridge_missing_reason",
    flow_count: 1,
    elapsed_ms: 13,
    mode: "manual",
    diagnostics: {
      bridge: {
        route: "legacy",
      },
    },
  };
  globalThis.localStorage?.setItem(
    "evolution_world_assistant",
    JSON.stringify({
      last_run: invalidBridgeMissingReasonRaw,
      last_run_by_chat: {},
    }),
  );
  const invalidBridgeMissingReasonSummary = loadLastRun();
  assert(
    invalidBridgeMissingReasonSummary?.diagnostics?.bridge === undefined,
    `P3.7-D: Expected bridge to be removed when reason is missing. Actual: ${JSON.stringify(invalidBridgeMissingReasonSummary?.diagnostics?.bridge)}`,
  );

  // 场景 E: route 非法值时整个 bridge 被剔除
  const invalidBridgeRouteRaw = {
    at: Date.now(),
    ok: true,
    reason: "invalid bridge route",
    request_id: "req_invalid_bridge_route",
    chat_id: "chat_invalid_bridge_route",
    flow_count: 1,
    elapsed_ms: 14,
    mode: "manual",
    diagnostics: {
      bridge: {
        route: "broken",
        reason: "legacy_flow_selection",
      },
    },
  };
  globalThis.localStorage?.setItem(
    "evolution_world_assistant",
    JSON.stringify({
      last_run: invalidBridgeRouteRaw,
      last_run_by_chat: {},
    }),
  );
  const invalidBridgeRouteSummary = loadLastRun();
  assert(
    invalidBridgeRouteSummary?.diagnostics?.bridge === undefined,
    `P3.7-E: Expected bridge to be removed when route is invalid. Actual: ${JSON.stringify(invalidBridgeRouteSummary?.diagnostics?.bridge)}`,
  );

  // 场景 F: bridge 不是对象时整个 bridge 被剔除
  const invalidBridgePrimitiveRaw = {
    at: Date.now(),
    ok: true,
    reason: "invalid bridge primitive",
    request_id: "req_invalid_bridge_primitive",
    chat_id: "chat_invalid_bridge_primitive",
    flow_count: 1,
    elapsed_ms: 15,
    mode: "manual",
    diagnostics: {
      bridge: "legacy_flow_selection",
    },
  };
  globalThis.localStorage?.setItem(
    "evolution_world_assistant",
    JSON.stringify({
      last_run: invalidBridgePrimitiveRaw,
      last_run_by_chat: {},
    }),
  );
  const invalidBridgePrimitiveSummary = loadLastRun();
  assert(
    invalidBridgePrimitiveSummary?.diagnostics?.bridge === undefined,
    `P3.7-F: Expected bridge to be removed when bridge is not an object. Actual: ${JSON.stringify(invalidBridgePrimitiveSummary?.diagnostics?.bridge)}`,
  );

  // 场景 G: 合法核心字段 + 非法可选字段时仅裁剪非法可选字段
  const partiallyInvalidBridgeRaw = {
    at: Date.now(),
    ok: true,
    reason: "partially invalid bridge",
    request_id: "req_partially_invalid_bridge",
    chat_id: "chat_partially_invalid_bridge",
    flow_count: 1,
    elapsed_ms: 16,
    mode: "manual",
    diagnostics: {
      bridge: {
        route: "legacy",
        reason: "legacy_flow_selection",
        has_explicit_legacy_flow_selection: "yes",
        enabled_graph_count: -1,
        graph_context: {
          selected_graph_ids: ["graph_ok", 3],
        },
        failure_origin: "   ",
      },
    },
  };
  globalThis.localStorage?.setItem(
    "evolution_world_assistant",
    JSON.stringify({
      last_run: partiallyInvalidBridgeRaw,
      last_run_by_chat: {},
    }),
  );
  const partiallyInvalidBridgeSummary = loadLastRun();
  assert(
    JSON.stringify(partiallyInvalidBridgeSummary?.diagnostics?.bridge) ===
      JSON.stringify({
        route: "legacy",
        reason: "legacy_flow_selection",
      }),
    `P3.7-G: Expected invalid optional fields to be pruned while keeping valid core fields. Actual: ${JSON.stringify(partiallyInvalidBridgeSummary?.diagnostics?.bridge)}`,
  );

  // 场景 H: by-chat 命中后回填全局时同步归一非法 bridge
  const degradedByChatPreferredRaw = {
    at: Date.now(),
    ok: true,
    reason: "degraded by chat bridge wins",
    request_id: "req_degraded_by_chat_bridge",
    chat_id: "chat_degraded_by_chat_bridge",
    flow_count: 1,
    elapsed_ms: 23,
    mode: "manual",
    diagnostics: {
      bridge: {
        route: "graph",
        reason: "graph_first",
        graph_context: {
          selected_graph_ids: ["graph_1", 2],
        },
        enabled_graph_count: 1,
      },
    },
  };
  const staleGlobalBridgeRaw = {
    at: Date.now(),
    ok: false,
    reason: "stale global should lose",
    request_id: "req_stale_global_bridge",
    chat_id: "chat_degraded_by_chat_bridge",
    flow_count: 1,
    elapsed_ms: 41,
    mode: "manual",
    diagnostics: buildWorkflowBridgeDiagnostics({
      selection: legacyFallbackRoute,
      failureOrigin: "cancelled",
    }),
  };
  globalThis.localStorage?.setItem(
    "evolution_world_assistant",
    JSON.stringify({
      last_run: staleGlobalBridgeRaw,
      last_run_by_chat: {
        chat_degraded_by_chat_bridge: degradedByChatPreferredRaw,
      },
    }),
  );
  const degradedByChatPreferredSummary = loadLastRunForChat(
    "chat_degraded_by_chat_bridge",
  );
  assert(
    JSON.stringify(degradedByChatPreferredSummary?.diagnostics?.bridge) ===
      JSON.stringify({
        route: "graph",
        reason: "graph_first",
        enabled_graph_count: 1,
      }),
    `P3.7-H: Expected by-chat hit to normalize bridge before returning. Actual: ${JSON.stringify(degradedByChatPreferredSummary?.diagnostics?.bridge)}`,
  );
  const persistedDegradedByChatPreferred = readPersistedScriptStorage();
  assert(
    JSON.stringify(
      (persistedDegradedByChatPreferred.last_run as RunSummary | undefined)
        ?.diagnostics?.bridge,
    ) ===
      JSON.stringify({
        route: "graph",
        reason: "graph_first",
        enabled_graph_count: 1,
      }),
    `P3.7-H: Expected by-chat hit to backfill normalized global bridge. Actual: ${JSON.stringify((persistedDegradedByChatPreferred.last_run as RunSummary | undefined)?.diagnostics?.bridge)}`,
  );

  // 场景 I: 仅全局 fallback 命中的记录也会归一 bridge
  const degradedGlobalFallbackBridgeRaw = {
    at: Date.now(),
    ok: true,
    reason: "degraded global fallback bridge",
    request_id: "req_degraded_global_fallback_bridge",
    chat_id: "chat_degraded_global_fallback_bridge",
    flow_count: 1,
    elapsed_ms: 17,
    mode: "manual",
    diagnostics: {
      bridge: {
        route: "legacy",
        reason: "legacy_flow_selection",
        failure_origin: "   ",
        has_explicit_legacy_flow_selection: true,
      },
    },
  };
  globalThis.localStorage?.setItem(
    "evolution_world_assistant",
    JSON.stringify({
      last_run: degradedGlobalFallbackBridgeRaw,
      last_run_by_chat: {},
    }),
  );
  const degradedGlobalFallbackBridgeSummary = loadLastRunForChat(
    "chat_degraded_global_fallback_bridge",
  );
  assert(
    JSON.stringify(degradedGlobalFallbackBridgeSummary?.diagnostics?.bridge) ===
      JSON.stringify({
        route: "legacy",
        reason: "legacy_flow_selection",
        has_explicit_legacy_flow_selection: true,
      }),
    `P3.7-I: Expected global fallback hit to normalize bridge before returning. Actual: ${JSON.stringify(degradedGlobalFallbackBridgeSummary?.diagnostics?.bridge)}`,
  );

  const isolatedLegacySummaryRaw = {
    at: Date.now(),
    ok: true,
    reason: "isolated legacy summary",
    request_id: "req_legacy_isolated",
    chat_id: "chat_legacy_isolated",
    flow_count: 1,
    elapsed_ms: 16,
    mode: "manual",
    diagnostics: buildWorkflowBridgeDiagnostics({
      selection: explicitLegacySelectionRoute,
    }),
  };
  globalThis.localStorage?.setItem(
    "evolution_world_assistant",
    JSON.stringify({
      last_run: isolatedLegacySummaryRaw,
      last_run_by_chat: {},
    }),
  );
  assert(
    loadLastRunForChat("chat_other") === null,
    `Expected mismatched chatId not to read legacy summary for another chat`,
  );

  const emptyChatIdSummary = createRunSummaryFixture({
    chatId: "   ",
    requestId: "req_legacy_empty_chat",
    ok: true,
    reason: "empty chat id preserved",
    bridgeDiagnostics: buildWorkflowBridgeDiagnostics({
      selection: explicitLegacySelectionRoute,
    }),
  });
  setLastRun(emptyChatIdSummary);
  assertRunSummaryBridgeContract(loadLastRunForChat("   "), {
    chatId: "   ",
    requestId: "req_legacy_empty_chat",
    ok: true,
    reason: "empty chat id preserved",
    route: "legacy",
    bridgeReason: "legacy_flow_selection",
    hasExplicitLegacyFlowSelection: true,
    enabledGraphCount: 1,
    hasFailure: false,
  });
  const persistedEmptyChatId = readPersistedScriptStorage();
  assert(
    !persistedEmptyChatId.last_run_by_chat ||
      Object.keys(
        persistedEmptyChatId.last_run_by_chat as Record<string, unknown>,
      ).length === 0,
    `Expected empty chatId summary not to create by-chat entry. Actual: ${JSON.stringify(persistedEmptyChatId.last_run_by_chat)}`,
  );

  // ══════════════════════════════════════════════════════════════════
  // P2.1 — Runtime Node Registry Tests
  // ══════════════════════════════════════════════════════════════════

  // 1. Registry resolves registered built-in nodes
  const builtinModuleIds = getRegisteredModuleIds();
  assert(
    builtinModuleIds.length > 0,
    `Expected registry to have registered built-in handlers after execution. Actual count: ${builtinModuleIds.length}`,
  );
  assert(
    hasRegisteredHandler("src_user_input"),
    `Expected registry to have src_user_input handler registered`,
  );
  assert(
    hasRegisteredHandler("flt_mvu_strip"),
    `Expected registry to have flt_mvu_strip handler registered`,
  );
  assert(
    hasRegisteredHandler("exe_llm_call"),
    `Expected registry to have exe_llm_call handler registered`,
  );
  assert(
    hasRegisteredHandler("out_reply_inject"),
    `Expected registry to have out_reply_inject handler registered`,
  );

  // 2. Registry resolves registered handler with resolvedVia='registered'
  const srcUserResolve = resolveNodeHandler("src_user_input");
  assert(
    srcUserResolve.resolvedVia === "registered",
    `Expected src_user_input to resolve via 'registered'. Actual: ${srcUserResolve.resolvedVia}`,
  );
  assert(
    srcUserResolve.descriptor.kind === "builtin",
    `Expected src_user_input descriptor kind to be 'builtin'. Actual: ${srcUserResolve.descriptor.kind}`,
  );
  assert(
    srcUserResolve.descriptor.handlerId === "src_user_input",
    `Expected src_user_input descriptor handlerId to be 'src_user_input'. Actual: ${srcUserResolve.descriptor.handlerId}`,
  );
  assert(
    srcUserResolve.descriptor.capability === "source" &&
      srcUserResolve.descriptor.sideEffect === "reads_host",
    `Expected src_user_input descriptor capability to stay source while legacy sideEffect maps to reads_host. Actual: ${JSON.stringify(srcUserResolve.descriptor)}`,
  );

  const sourceMetadata = getModuleMetadataSurface("src_user_input");
  const filterMetadata = getModuleMetadataSurface("flt_mvu_strip");
  const outputMetadata = getModuleMetadataSurface("out_reply_inject");
  assert(
    sourceMetadata?.semantic.capability === "source" &&
      sourceMetadata.help?.summary === "读取当前触发图执行的用户输入文本。" &&
      sourceMetadata.constraints?.outputs?.[0]?.summary?.includes(
        "用户输入文本",
      ),
    `Expected src_user_input metadata pilot summary to be exposed via blueprint. Actual: ${JSON.stringify(sourceMetadata)}`,
  );
  assert(
    filterMetadata?.semantic.sideEffect === "pure" &&
      filterMetadata.help?.summary === "剥离文本中的 MVU XML 块与相关产物。" &&
      Array.isArray(filterMetadata.config?.schemaFields) &&
      filterMetadata.config.schemaFields.length === 0 &&
      filterMetadata.config.validation === undefined &&
      filterMetadata.constraints?.inputs?.[0]?.summary?.includes(
        "空文本处理",
      ) &&
      filterMetadata.constraints?.outputs?.[0]?.summary?.includes("净化文本"),
    `Expected flt_mvu_strip metadata pilot summary to expose config fallback and port constraints from a single source. Actual: ${JSON.stringify(filterMetadata)}`,
  );
  assert(
    outputMetadata?.semantic.capability === "writes_host" &&
      outputMetadata.semantic.hostWriteHint?.operation ===
        "inject_reply_instruction" &&
      outputMetadata.help?.summary ===
        "把指令文本写入宿主 reply instruction。" &&
      outputMetadata.config?.validation?.requiredConfigKeys?.includes(
        "target_slot",
      ) &&
      outputMetadata.config?.validation?.unknownConfigSeverity === "warning" &&
      outputMetadata.constraints?.inputs?.[0]?.summary?.includes("指令文本"),
    `Expected out_reply_inject metadata pilot summary to carry host write hint. Actual: ${JSON.stringify(outputMetadata)}`,
  );

  const sourceExplain = getModuleExplainContract("src_user_input");
  const filterExplain = getModuleExplainContract("flt_mvu_strip");
  const outputExplain = getModuleExplainContract("out_reply_inject");
  const sourceMetadataSummary = getModuleMetadataSummary("src_user_input");
  const filterMetadataSummary = getModuleMetadataSummary("flt_mvu_strip");
  const outputMetadataSummary = getModuleMetadataSummary("out_reply_inject");
  assert(
    filterExplain?.ports.inputs[0]?.summary.includes("期望单段文本输入") &&
      filterExplain?.ports.outputs[0]?.summary.includes("净化文本") &&
      filterExplain?.config.schemaFields.length ===
        (filterMetadata?.config?.schemaFields?.length ?? 0) &&
      filterMetadataSummary?.inputConstraintSummary?.[0]?.includes(
        "text_in:期望单段文本输入",
      ) &&
      filterMetadataSummary?.outputConstraintSummary?.[0]?.includes(
        "text_out:输出剥离 MVU XML 块后的净化文本",
      ) &&
      filterMetadataSummary?.configFields?.length ===
        filterExplain?.config.schemaFields.length,
    `Expected registry metadata summary helper to reuse filter explain contract instead of hardcoding a separate summary. Actual explain=${JSON.stringify(filterExplain)} summary=${JSON.stringify(filterMetadataSummary)}`,
  );
  assert(
    outputExplain?.diagnostics.hostWrite ===
      "reply_instruction:inject_reply_instruction" &&
      outputExplain?.config.requiredConfigKeys.includes("target_slot") &&
      outputMetadataSummary?.diagnosticsLabel ===
        "reply_instruction:inject_reply_instruction",
    `Expected registry metadata summary helper to reuse host write diagnostics label from explain contract. Actual explain=${JSON.stringify(outputExplain)} summary=${JSON.stringify(outputMetadataSummary)}`,
  );
  assert(
    srcUserResolve.descriptor.metadataSummary?.helpSummary ===
      sourceMetadata?.help?.summary &&
      srcUserResolve.descriptor.metadataSummary?.semantic.capability ===
        sourceMetadata?.semantic.capability &&
      srcUserResolve.descriptor.metadataSummary?.explainContract?.help
        ?.summary === sourceExplain?.help?.summary &&
      srcUserResolve.descriptor.metadataSummary
        ?.outputConstraintSummary?.[0] ===
        sourceMetadataSummary?.outputConstraintSummary?.[0],
    `Expected runtime descriptor to reuse source metadata summary instead of redefining it. Actual descriptor=${JSON.stringify(srcUserResolve.descriptor.metadataSummary)} blueprint=${JSON.stringify(sourceMetadata)} summary=${JSON.stringify(sourceMetadataSummary)}`,
  );
  const outReplyResolve = resolveNodeHandler("out_reply_inject");
  assert(
    outReplyResolve.descriptor.metadataSummary?.diagnosticsLabel ===
      outputMetadataSummary?.diagnosticsLabel &&
      outReplyResolve.descriptor.metadataSummary?.semantic.hostWriteHint
        ?.operation ===
        outputMetadataSummary?.semantic.hostWriteHint?.operation &&
      outReplyResolve.descriptor.metadataSummary?.explainContract?.diagnostics
        .hostWrite === outputExplain?.diagnostics.hostWrite &&
      outReplyResolve.descriptor.metadataSummary?.runtimeUsage ===
        outputMetadata?.help?.runtimeUsage,
    `Expected runtime descriptor and registry metadata summary helper to share the same host-write summary. Actual descriptor=${JSON.stringify(outReplyResolve.descriptor.metadataSummary)} summary=${JSON.stringify(outputMetadataSummary)}`,
  );

  // 3. Registry resolves unregistered moduleId with explicit fallback
  const unknownResolve = resolveNodeHandler("__totally_unknown_module__");
  assert(
    unknownResolve.resolvedVia === "fallback",
    `Expected unknown module to resolve via 'fallback'. Actual: ${unknownResolve.resolvedVia}`,
  );
  assert(
    unknownResolve.descriptor.kind === "fallback",
    `Expected unknown module descriptor kind to be 'fallback'. Actual: ${unknownResolve.descriptor.kind}`,
  );
  assert(
    unknownResolve.descriptor.handlerId === "__fallback__",
    `Expected unknown module fallback handlerId to be '__fallback__'. Actual: ${unknownResolve.descriptor.handlerId}`,
  );
  assert(
    unknownResolve.descriptor.capability === "fallback" &&
      unknownResolve.descriptor.sideEffect === "unknown",
    `Expected unknown module fallback capability to stay 'fallback' while legacy sideEffect remains conservative. Actual: ${JSON.stringify(unknownResolve.descriptor)}`,
  );
  assert(
    unknownResolve.descriptor.metadataSummary === null,
    `Expected fallback descriptor metadata summary to stay null so fallback remains execution-only. Actual: ${JSON.stringify(unknownResolve.descriptor.metadataSummary)}`,
  );
  const fallbackBlueprintMetadata = getModuleMetadataSurface(
    "pkg_prompt_assembly",
  );
  const fallbackMetadataSummary = getModuleMetadataSummary(
    "pkg_prompt_assembly",
  );
  assert(
    fallbackBlueprintMetadata === undefined && fallbackMetadataSummary === null,
    `Expected fallback blueprint without pilot metadata not to grow UI/schema responsibilities. Actual blueprint=${JSON.stringify(fallbackBlueprintMetadata)} summary=${JSON.stringify(fallbackMetadataSummary)}`,
  );

  // 4. Executor success path without static handler map
  //    (already tested above via executeGraph / executeCompiledGraph,
  //     but we add an explicit assertion that executor uses registry)
  const registrySuccessResult = await executeGraph(
    observationReadyGraph,
    makeExecutionContext({ userInput: "registry_test" }),
  );
  assert(
    registrySuccessResult.compilePlan?.compileFingerprint ===
      successResult.compilePlan?.compileFingerprint,
    `Expected runtime-only input changes not to affect compileFingerprint. Actual: ${registrySuccessResult.compilePlan?.compileFingerprint} vs ${successResult.compilePlan?.compileFingerprint}`,
  );
  assert(
    registrySuccessResult.compilePlan?.nodes.every(
      (node, index) =>
        node.nodeFingerprint ===
        successResult.compilePlan?.nodes[index]?.nodeFingerprint,
    ) === true,
    `Expected runtime-only input changes not to affect nodeFingerprint. Actual: ${registrySuccessResult.compilePlan?.nodes.map((node) => node.nodeFingerprint).join(",")} vs ${successResult.compilePlan?.nodes.map((node) => node.nodeFingerprint).join(",")}`,
  );
  assert(
    registrySuccessResult.moduleResults.length ===
      registrySuccessResult.compilePlan?.nodeOrder.length,
    `Expected executor to remain full-run instead of cache-hit/skip semantics. Actual moduleResults=${registrySuccessResult.moduleResults.length}, planNodes=${registrySuccessResult.compilePlan?.nodeOrder.length}`,
  );
  assert(
    registrySuccessResult.ok === true,
    `Expected executor to succeed via registry-based dispatch. ok=${registrySuccessResult.ok}`,
  );
  const registryExecTraces = registrySuccessResult.trace?.nodeTraces?.filter(
    (t) => t.stage === "execute",
  );
  assert(
    registryExecTraces?.every(
      (t) =>
        typeof t.handlerId === "string" &&
        t.handlerId.length > 0 &&
        t.isFallback === false,
    ) === true,
    `Expected registry-dispatched execute traces to expose handlerId and isFallback=false. Actual: ${JSON.stringify(registryExecTraces)}`,
  );

  // 5. Fallback still works in dispatch smoke graph (pkg_prompt_assembly is not registered)
  const registryFallbackGraph = makeDispatchSmokeGraph();
  const registryFallbackPlan = compileGraphPlan(registryFallbackGraph);
  const registryFallbackExec = await executeCompiledGraph(
    registryFallbackGraph,
    registryFallbackPlan,
    makeExecutionContext({ userInput: "fallback_test" }),
  );
  assert(
    registryFallbackExec.moduleResults.every(
      (result) => result.status === "ok",
    ),
    `Expected dispatch smoke graph to succeed with fallback via registry. Actual: ${registryFallbackExec.moduleResults.map((r) => `${r.nodeId}:${r.status}`).join(",")}`,
  );
  const registryFallbackTrace = registryFallbackExec.nodeTraces?.find(
    (t) => t.nodeId === "fallback_pkg" && t.stage === "execute",
  );
  assert(
    registryFallbackTrace?.isFallback === true &&
      registryFallbackTrace.handlerId === "__fallback__" &&
      registryFallbackTrace.capability === "fallback" &&
      registryFallbackTrace.sideEffect === "unknown",
    `Expected fallback trace to show isFallback=true, handlerId='__fallback__', fallback capability, and conservative legacy sideEffect. Actual: ${JSON.stringify(registryFallbackTrace)}`,
  );

  // 6. Registry reset + re-initialize test (ensures idempotency)
  _resetRegistryForTesting();
  assert(
    getRegisteredModuleIds().length === 0,
    `Expected registry to be empty after reset. Actual: ${getRegisteredModuleIds().length}`,
  );
  assert(
    !hasRegisteredHandler("src_user_input"),
    `Expected src_user_input to be absent after registry reset`,
  );

  // After reset, resolveNodeHandler should return fallback for everything
  const postResetResolve = resolveNodeHandler("src_user_input");
  assert(
    postResetResolve.resolvedVia === "fallback",
    `Expected post-reset resolve for src_user_input to be 'fallback'. Actual: ${postResetResolve.resolvedVia}`,
  );

  // Re-run execution which triggers ensureBuiltinHandlers
  const postResetResult = await executeGraph(
    makeBaseGraph(),
    makeExecutionContext({ userInput: "post_reset" }),
  );
  assert(
    postResetResult.ok === true,
    `Expected execution after registry reset to succeed (auto re-registration). ok=${postResetResult.ok}`,
  );
  assert(
    hasRegisteredHandler("src_user_input"),
    `Expected src_user_input to be re-registered after execution`,
  );
  // ═══════════════════════════════════════════════════════════════════════════
  // §G: Graph Document Codec — stable envelope contract tests
  // ═══════════════════════════════════════════════════════════════════════════

  // G.1: Roundtrip — createGraphDocumentEnvelope → readGraphDocumentEnvelope
  const baseGraph = makeBaseGraph();
  const docEnvelope = createGraphDocumentEnvelope({
    graphs: [baseGraph],
    source: "test",
  });
  assert(
    docEnvelope.kind === "graph_document" &&
      docEnvelope.version === "v1" &&
      docEnvelope.graphs.length === 1 &&
      docEnvelope.graphs[0].id === "graph_test" &&
      docEnvelope.metadata?.source === "test",
    `G.1: Expected graph document envelope to roundtrip through create. Actual: ${JSON.stringify(docEnvelope)}`,
  );

  const roundtripDocEnvelope = readGraphDocumentEnvelope(docEnvelope);
  assert(
    roundtripDocEnvelope?.kind === "graph_document" &&
      roundtripDocEnvelope.version === "v1" &&
      roundtripDocEnvelope.graphs.length === 1 &&
      roundtripDocEnvelope.graphs[0].id === "graph_test" &&
      roundtripDocEnvelope.graphs[0].nodes.length === baseGraph.nodes.length &&
      roundtripDocEnvelope.graphs[0].edges.length === baseGraph.edges.length,
    `G.1: Expected graph document envelope to roundtrip through read. Actual: ${JSON.stringify(roundtripDocEnvelope)}`,
  );

  // G.2: Roundtrip back to WorkbenchGraph[]
  const roundtripGraphs = toWorkbenchGraphs(roundtripDocEnvelope!);
  assert(
    roundtripGraphs.length === 1 &&
      roundtripGraphs[0].id === "graph_test" &&
      roundtripGraphs[0].nodes.length === baseGraph.nodes.length &&
      roundtripGraphs[0].edges.length === baseGraph.edges.length &&
      roundtripGraphs[0].viewport.zoom === baseGraph.viewport.zoom,
    `G.2: Expected workbench graph roundtrip to preserve structure. Actual: ${JSON.stringify(roundtripGraphs[0])}`,
  );

  // G.3: Legacy flow absorption via readGraphDocumentEnvelope
  const legacyFlowPayload = {
    ew_flow_export: true,
    version: 1,
    flows: [makeLegacyFlowFixture()],
  };
  const legacyDocEnvelope = readGraphDocumentEnvelope(legacyFlowPayload);
  assert(
    legacyDocEnvelope?.kind === "graph_document" &&
      legacyDocEnvelope.version === "v1" &&
      legacyDocEnvelope.graphs.length === 1 &&
      legacyDocEnvelope.graphs[0].id.startsWith("migrated_") &&
      legacyDocEnvelope.graphs[0].nodes.length > 0 &&
      legacyDocEnvelope.metadata?.source === "legacy_flow_migration" &&
      legacyDocEnvelope.metadata?.legacyFlowCount === 1,
    `G.3: Expected legacy flow export to be absorbed into graph document envelope. Actual: ${JSON.stringify(legacyDocEnvelope)}`,
  );

  // G.4: readGraphDocumentAsWorkbenchGraphs unified path
  const unifiedGraphs = readGraphDocumentAsWorkbenchGraphs(legacyFlowPayload);
  assert(
    unifiedGraphs !== null &&
      unifiedGraphs.length === 1 &&
      unifiedGraphs[0].nodes.some((node) => node.moduleId === "exe_llm_call") &&
      unifiedGraphs[0].nodes.some((node) => node.moduleId === "out_floor_bind"),
    `G.4: Expected unified read path to produce executable workbench graphs from legacy flows. Actual: ${JSON.stringify(unifiedGraphs?.map((g) => g.id))}`,
  );

  // G.5: Unknown module preservation
  const unknownModuleGraphDoc: WorkbenchGraph = {
    ...baseGraph,
    id: "graph_unknown_module_test",
    nodes: [
      ...baseGraph.nodes,
      {
        id: "node_totally_unknown",
        moduleId: "__future_plugin_module__",
        position: { x: 500, y: 100 },
        config: { custom_param: "preserved_value" },
        collapsed: false,
      },
    ],
  };
  const unknownEnvelope = createGraphDocumentEnvelope({
    graphs: [unknownModuleGraphDoc],
  });
  const unknownRoundtrip = readGraphDocumentEnvelope(unknownEnvelope);
  const unknownNode = unknownRoundtrip?.graphs[0]?.nodes.find(
    (n) => n.moduleId === "__future_plugin_module__",
  );
  assert(
    unknownNode?.id === "node_totally_unknown" &&
      unknownNode?.config?.custom_param === "preserved_value",
    `G.5: Expected unknown module nodes to be preserved through codec roundtrip. Actual: ${JSON.stringify(unknownNode)}`,
  );

  // G.6: Field omission / conservative degradation
  const sparseDocEnvelope = readGraphDocumentEnvelope({
    kind: "graph_document",
    version: "v1",
    graphs: [
      {
        id: "sparse_graph",
        // name, enabled, timing, priority are all missing
        nodes: [
          {
            id: "n1",
            moduleId: "src_user_input",
            // position missing
            // config missing
            // collapsed missing
          },
        ],
        edges: [],
        // viewport missing
      },
    ],
  });
  assert(
    sparseDocEnvelope?.graphs[0]?.name === "" &&
      sparseDocEnvelope.graphs[0].enabled === true &&
      sparseDocEnvelope.graphs[0].timing === "default" &&
      sparseDocEnvelope.graphs[0].priority === 0 &&
      sparseDocEnvelope.graphs[0].viewport.x === 0 &&
      sparseDocEnvelope.graphs[0].viewport.y === 0 &&
      sparseDocEnvelope.graphs[0].viewport.zoom === 1 &&
      sparseDocEnvelope.graphs[0].nodes[0]?.position.x === 0 &&
      sparseDocEnvelope.graphs[0].nodes[0]?.position.y === 0 &&
      sparseDocEnvelope.graphs[0].nodes[0]?.collapsed === false &&
      Object.keys(sparseDocEnvelope.graphs[0].nodes[0]?.config ?? {}).length ===
        0,
    `G.6: Expected sparse graph document to degrade with safe defaults. Actual: ${JSON.stringify(sparseDocEnvelope?.graphs[0])}`,
  );

  // G.7: Viewport node edge conservative degradation
  const viewportEdgeDoc = readGraphDocumentEnvelope({
    kind: "graph_document",
    version: "v1",
    graphs: [
      {
        id: "vp_test",
        nodes: [
          { id: "a", moduleId: "src_user_input", position: { x: 10, y: 20 } },
          {
            id: "b",
            moduleId: "flt_custom_regex",
            position: { x: 100, y: 200 },
          },
        ],
        edges: [
          {
            id: "e1",
            source: "a",
            sourcePort: "out",
            target: "b",
            targetPort: "in",
          },
          // Invalid edge (missing fields) — should be filtered out
          { id: "e_bad" },
        ],
        viewport: { x: -50, y: 100, zoom: 0.5 },
      },
    ],
  });
  assert(
    viewportEdgeDoc?.graphs[0]?.viewport.x === -50 &&
      viewportEdgeDoc.graphs[0].viewport.y === 100 &&
      viewportEdgeDoc.graphs[0].viewport.zoom === 0.5 &&
      viewportEdgeDoc.graphs[0].nodes.length === 2 &&
      viewportEdgeDoc.graphs[0].edges.length === 1 &&
      viewportEdgeDoc.graphs[0].edges[0]?.id === "e1",
    `G.7: Expected viewport and edge conservative degradation. Invalid edges should be dropped. Actual: ${JSON.stringify(viewportEdgeDoc?.graphs[0])}`,
  );

  // G.8: Raw WorkbenchGraph[] array absorption
  const rawArrayGraphs = readGraphDocumentAsWorkbenchGraphs([baseGraph]);
  assert(
    rawArrayGraphs !== null &&
      rawArrayGraphs.length === 1 &&
      rawArrayGraphs[0].id === "graph_test",
    `G.8: Expected raw graph array to be absorbed into workbench graphs. Actual: ${JSON.stringify(rawArrayGraphs?.map((g) => g.id))}`,
  );

  // G.9: Null / invalid input returns null
  const nullResult = readGraphDocumentEnvelope(null);
  const undefinedResult = readGraphDocumentEnvelope(undefined);
  const numberResult = readGraphDocumentEnvelope(42);
  const emptyArrayResult = readGraphDocumentEnvelope([]);
  assert(
    nullResult === null &&
      undefinedResult === null &&
      numberResult === null &&
      emptyArrayResult === null,
    `G.9: Expected null/invalid inputs to return null. Actual: null=${nullResult}, undefined=${undefinedResult}, number=${numberResult}, emptyArray=${emptyArrayResult}`,
  );

  // G.10: Export payload strips sensitive fields
  const sensitiveGraph: WorkbenchGraph = {
    ...baseGraph,
    id: "graph_sensitive",
    nodes: [
      {
        id: "n_sensitive",
        moduleId: "cfg_api_preset",
        position: { x: 0, y: 0 },
        config: {
          api_key: "SECRET_KEY",
          api_url: "https://secret.api/v1",
          headers_json: '{"Authorization": "Bearer secret"}',
          model: "gpt-4",
        },
        collapsed: false,
      },
    ],
  };
  const exportPayload = buildGraphDocumentExportPayload([sensitiveGraph]);
  const exportedNode = exportPayload.graphs[0]?.nodes[0];
  assert(
    exportedNode &&
      !("api_key" in exportedNode.config) &&
      !("api_url" in exportedNode.config) &&
      !("headers_json" in exportedNode.config) &&
      exportedNode.config.model === "gpt-4",
    `G.10: Expected export payload to strip sensitive fields but preserve non-sensitive ones. Actual: ${JSON.stringify(exportedNode?.config)}`,
  );

  // G.11: Settings-level workbench_graphs extraction
  const settingsExtraction = readGraphDocumentEnvelope({
    workbench_graphs: [baseGraph],
  });
  assert(
    settingsExtraction?.graphs.length === 1 &&
      settingsExtraction.graphs[0].id === "graph_test" &&
      settingsExtraction.metadata?.source === "settings_extraction",
    `G.11: Expected settings-level workbench_graphs to be extracted. Actual: ${JSON.stringify(settingsExtraction)}`,
  );

  // G.12: Dangling edges are filtered against normalized node ids
  const danglingEdgeGraph = readGraphDocumentEnvelope({
    kind: "graph_document",
    version: "v1",
    graphs: [
      {
        ...baseGraph,
        id: "graph_dangling_edges",
        nodes: [baseGraph.nodes[0]],
        edges: [
          baseGraph.edges[0],
          {
            id: "edge_dangling_target",
            source: baseGraph.nodes[0].id,
            sourcePort: "out",
            target: "missing_target",
            targetPort: "in",
          },
        ],
      },
    ],
  });
  assert(
    danglingEdgeGraph?.graphs[0]?.edges.length === 0,
    `G.12: Expected dangling edges to be silently filtered after node normalization. Actual: ${JSON.stringify(danglingEdgeGraph?.graphs[0]?.edges)}`,
  );

  // G.13: Single graph object absorption
  const singleGraphRead = readGraphDocumentEnvelope(baseGraph);
  assert(
    singleGraphRead?.graphs.length === 1 &&
      singleGraphRead.graphs[0].id === "graph_test" &&
      singleGraphRead.metadata?.source === "single_graph",
    `G.13: Expected single graph object to be absorbed. Actual: ${JSON.stringify(singleGraphRead)}`,
  );
}

runValidationSpec()
  .then(() => {
    console.info("[graph-executor.validation.spec] validation checks passed");
  })
  .catch((error) => {
    console.error(error);
    throw error;
  });
