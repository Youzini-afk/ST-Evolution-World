import type {
  ExecutionContext,
  WorkbenchGraph,
} from "../ui/components/graph/module-types";
import { executeGraph, validateGraph } from "./graph-executor";

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
    successResult.compilePlan?.terminalNodeIds.join(",") === "filter_text",
    `Expected terminal node to be filter_text. Actual: ${successResult.compilePlan?.terminalNodeIds.join(",")}`,
  );
  assert(
    successResult.compilePlan?.nodes
      .map((node) => `${node.nodeId}:${node.stage}:${node.status}`)
      .join(",") === "src_text:compile:ok,filter_text:compile:ok",
    `Expected compile plan nodes to carry compile status. Actual: ${successResult.compilePlan?.nodes.map((node) => `${node.nodeId}:${node.stage}:${node.status}`).join(",")}`,
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
}

runValidationSpec()
  .then(() => {
    console.info("[graph-executor.validation.spec] validation checks passed");
  })
  .catch((error) => {
    console.error(error);
    throw error;
  });
