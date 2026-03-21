import type {
  ExecutionContext,
  GraphCompilePlan,
  GraphExecutionStage,
  WorkbenchGraph,
} from "../ui/components/graph/module-types";
import { autoMigrateIfNeeded, migrateFlowToGraph } from "./flow-migrator";
import {
  compileGraphPlan,
  executeCompiledGraph,
  executeGraph,
  validateGraph,
} from "./graph-executor";
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

function assertHasMessage(
  errors: ReturnType<typeof validateGraph>,
  keyword: string,
): void {
  assert(
    errors.some((error) => error.message.includes(keyword)),
    `Expected validation error containing: ${keyword}. Actual: ${errors.map((error) => error.message).join(" | ")}`,
  );
}

function assertHasRef(
  errors: ReturnType<typeof validateGraph>,
  predicate: (error: ReturnType<typeof validateGraph>[number]) => boolean,
  label: string,
): void {
  assert(
    errors.some(predicate),
    `Expected validation error matching ${label}. Actual: ${errors.map((error) => JSON.stringify(error)).join(" | ")}`,
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
    assert(
      Array.isArray(bridge.graph_context?.selected_graph_ids),
      `Expected graph route bridge diagnostics to expose selected_graph_ids. Actual: ${JSON.stringify(bridge.graph_context)}`,
    );
    assert(
      bridge.graph_context.selected_graph_ids.join(",") ===
        (expected.selectedGraphIds ?? []).join(","),
      `Expected graph selected_graph_ids to be ${(expected.selectedGraphIds ?? []).join(",")}. Actual: ${bridge.graph_context.selected_graph_ids.join(",")}`,
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

async function runValidationSpec(): Promise<void> {
  ensureMemoryLocalStorage();
  const validGraphErrors = validateGraph(makeBaseGraph());
  assert(
    validGraphErrors.length === 0,
    "Expected valid graph to have no validation errors",
  );

  const missingSourcePortGraph = makeBaseGraph();
  missingSourcePortGraph.edges[0].sourcePort = "missing_port";
  assertHasMessage(
    validateGraph(missingSourcePortGraph),
    "源端口(missing_port)不存在",
  );

  const invalidDirectionGraph = makeBaseGraph();
  invalidDirectionGraph.edges[0].targetPort = "text_out";
  assertHasMessage(validateGraph(invalidDirectionGraph), "不是输入端口");

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
  assertHasMessage(validateGraph(incompatibleTypeGraph), "类型不兼容");

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
  assertHasMessage(validateGraph(multipleIncomingGraph), "不允许多入边");

  const duplicateNodeIdGraph = makeBaseGraph();
  duplicateNodeIdGraph.nodes.push({
    id: "src_text",
    moduleId: "src_chat_history",
    position: { x: 0, y: 200 },
    config: {},
    collapsed: false,
  });
  const duplicateNodeErrors = validateGraph(duplicateNodeIdGraph);
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
  const duplicateEdgeErrors = validateGraph(duplicateEdgeIdGraph);
  assertHasMessage(duplicateEdgeErrors, "重复的连线 ID");
  assertHasRef(
    duplicateEdgeErrors,
    (error) => error.edgeId === "edge_valid",
    "duplicate edge ref",
  );

  const missingRequiredInputGraph = makeBaseGraph();
  missingRequiredInputGraph.edges = [];
  assertHasMessage(validateGraph(missingRequiredInputGraph), "必要输入");

  const cycleGraph = makeBaseGraph();
  cycleGraph.edges.push({
    id: "edge_cycle_back",
    source: "filter_text",
    sourcePort: "text_out",
    target: "src_text",
    targetPort: "text",
  });
  assertHasMessage(validateGraph(cycleGraph), "循环依赖");

  const unknownNodeRefGraph = makeBaseGraph();
  unknownNodeRefGraph.edges[0].target = "missing_target";
  const unknownNodeErrors = validateGraph(unknownNodeRefGraph);
  assertHasMessage(unknownNodeErrors, "不存在的目标节点");
  assertHasRef(
    unknownNodeErrors,
    (error) => error.edgeId === "edge_valid",
    "unknown target edge ref",
  );

  const unknownModuleGraph = makeBaseGraph();
  unknownModuleGraph.nodes[0].moduleId = "module_missing";
  const unknownModuleErrors = validateGraph(unknownModuleGraph);
  assertHasMessage(unknownModuleErrors, "未知的模块类型");
  assertHasRef(
    unknownModuleErrors,
    (error) => error.nodeId === "src_text",
    "unknown module node ref",
  );
  const compilePlanFixture = compileGraphPlan(makePlanExecutionGraph());
  assertPlanMatchesGraph(compilePlanFixture, makePlanExecutionGraph());
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

  const successResult = await executeGraph(
    makeBaseGraph(),
    makeExecutionContext(),
  );
  assert(successResult.ok, "Expected executeGraph to succeed for valid graph");
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

  const validationFailureResult = await executeGraph(
    missingRequiredInputGraph,
    makeExecutionContext(),
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
  assert(
    Array.isArray(validateGraph(migratedGraph)),
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
  assertBridgeDiagnostics(
    buildWorkflowBridgeDiagnostics({
      selection: graphFirstRoute,
      failureOrigin: "graph_dispatch",
    }),
    {
      route: "graph",
      reason: "graph_first",
      hasExplicitLegacyFlowSelection: false,
      enabledGraphCount: 1,
      selectedGraphIds: ["graph_test"],
      failureOrigin: "graph_dispatch",
    },
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

  // 4. Executor success path without static handler map
  //    (already tested above via executeGraph / executeCompiledGraph,
  //     but we add an explicit assertion that executor uses registry)
  const registrySuccessResult = await executeGraph(
    makeBaseGraph(),
    makeExecutionContext({ userInput: "registry_test" }),
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
}

runValidationSpec()
  .then(() => {
    console.info("[graph-executor.validation.spec] validation checks passed");
  })
  .catch((error) => {
    console.error(error);
    throw error;
  });
