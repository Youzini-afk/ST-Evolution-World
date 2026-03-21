import type {
  ExecutionContext,
  GraphCompilePlan,
  WorkbenchGraph,
} from "../ui/components/graph/module-types";
import { autoMigrateIfNeeded, migrateFlowToGraph } from "./flow-migrator";
import {
  compileGraphPlan,
  executeCompiledGraph,
  executeGraph,
  validateGraph,
} from "./graph-executor";
import type { EwFlowConfig } from "./types";

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

async function runValidationSpec(): Promise<void> {
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
          `${node.nodeId}:${node.isTerminal}:${node.isSideEffectNode}:${node.sideEffect}`,
      )
      .join(",") ===
      "src_text:false:false:reads_host,filter_text:false:false:pure,out_reply:true:true:writes_host",
    `Expected terminal/side-effect smoke flags to be stable in compile plan. Actual: ${compilePlanFixture.nodes
      .map(
        (node) =>
          `${node.nodeId}:${node.isTerminal}:${node.isSideEffectNode}:${node.sideEffect}`,
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
      .map((result) => `${result.nodeId}:${result.isSideEffectNode}`)
      .join(",") === "src_text:false,filter_text:false,out_reply:true",
    `Expected executeCompiledGraph side-effect markers to come from compile plan. Actual: ${compiledExecution.moduleResults.map((result) => `${result.nodeId}:${result.isSideEffectNode}`).join(",")}`,
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
  const filterTrace = successExecuteTraces?.find(
    (trace) => trace.nodeId === "filter_text",
  );
  assert(
    filterTrace?.inputKeys?.join(",") === "text_in",
    `Expected filter_text execute trace to expose input keys. Actual: ${JSON.stringify(filterTrace)}`,
  );
  assert(
    filterTrace?.sideEffect === "pure",
    `Expected filter_text execute trace to preserve sideEffect. Actual: ${JSON.stringify(filterTrace?.sideEffect)}`,
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
    handlerFailureTrace?.sideEffect === "reads_host",
    `Expected handler failure trace to preserve sideEffect metadata. Actual: ${JSON.stringify(handlerFailureTrace?.sideEffect)}`,
  );

  assert(
    handlerFailureResult.nodeTraces
      ?.map((trace) => `${trace.nodeId}:${trace.stage}:${trace.status}`)
      .join(",") ===
      "src_messages:compile:ok,cfg_api:compile:ok,llm_call:compile:ok,src_messages:execute:ok,cfg_api:execute:ok,llm_call:execute:error",
    `Expected execute failure top-level nodeTraces to retain compile+execute traces. Actual: ${handlerFailureResult.nodeTraces?.map((trace) => `${trace.nodeId}:${trace.stage}:${trace.status}`).join(",")}`,
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
      sideEffectFailureTrace.sideEffect === "writes_host",
    `Expected side-effect failed node trace to stay error and preserve writes_host metadata. Actual: ${JSON.stringify(sideEffectFailureTrace)}`,
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
    outReplyTrace?.sideEffect === "writes_host",
    `Expected out_reply execute trace to have sideEffect=writes_host. Actual: ${JSON.stringify(outReplyTrace?.sideEffect)}`,
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
}

runValidationSpec()
  .then(() => {
    console.info("[graph-executor.validation.spec] validation checks passed");
  })
  .catch((error) => {
    console.error(error);
    throw error;
  });
