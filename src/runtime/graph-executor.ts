/* ═══ Module Workbench — Graph Execution Engine ═══ */
/*
 * Executes a WorkbenchGraph by:
 *   1. Topological sort of nodes
 *   2. Per-node execution with input collection from upstream edges
 *   3. Module dispatch via runtime-node-registry (P2.1)
 *
 * This is the core that replaces the fixed pipeline with graph-driven execution.
 *
 * P2.1 change: The executor no longer owns the static handler map.
 * Node execution handlers are registered in and resolved from
 * runtime-node-registry.ts (plugin contract v1).
 */

import { getModuleBlueprint } from "../ui/components/graph/module-registry";
import type {
  ExecutionContext,
  GraphCompilePlan,
  GraphCompilePlanNode,
  GraphDirtySetEntry,
  GraphDirtySetSummary,
  GraphExecutionDecisionSummary,
  GraphExecutionResult,
  GraphExecutionStage,
  GraphNodeCacheKeyFacts,
  GraphNodeDirtyReason,
  GraphNodeExecutionDecision,
  GraphNodeExecutionDecisionReason,
  GraphNodeInputSource,
  GraphNodeReuseReason,
  GraphNodeReuseVerdict,
  GraphReuseSummary,
  GraphRunArtifact,
  GraphRunCheckpointSummary,
  GraphRunDiagnosticsOverview,
  GraphRunEvent,
  GraphRunStatus,
  GraphStageTrace,
  GraphTraceStageStatus,
  HostCommitContract,
  HostCommitSummary,
  HostWriteDescriptor,
  HostWriteSummary,
  ModuleExecutionResult,
  ModuleOutput,
  ModulePortDef,
  PortDataType,
  WorkbenchCapability,
  WorkbenchEdge,
  WorkbenchGraph,
  WorkbenchNode,
  WorkbenchSideEffectLevel,
} from "../ui/components/graph/module-types";
import {
  ensureBuiltinHandlers,
  resolveNodeHandler,
  type NodeHandlerRequest,
  type NodeHandlerResult,
  type RuntimeImplModules,
} from "./runtime-node-registry";

// ── Topological Sort ──

interface SortedNode {
  node: WorkbenchNode;
  /** Indices of nodes that this node depends on (upstream) */
  dependsOn: number[];
}

/**
 * Kahn's algorithm for topological sort.
 * Returns nodes in execution order. Throws on cycles.
 */
export function topologicalSort(
  nodes: WorkbenchNode[],
  edges: WorkbenchEdge[],
): SortedNode[] {
  const nodeIndex = new Map<string, number>();
  nodes.forEach((n, i) => nodeIndex.set(n.id, i));

  // Build adjacency: inDegree and dependsOn
  const inDegree = new Array(nodes.length).fill(0);
  const dependsOn: number[][] = nodes.map(() => []);
  const downstream: number[][] = nodes.map(() => []);

  for (const edge of edges) {
    const srcIdx = nodeIndex.get(edge.source);
    const tgtIdx = nodeIndex.get(edge.target);
    if (srcIdx === undefined || tgtIdx === undefined) continue;
    inDegree[tgtIdx]++;
    dependsOn[tgtIdx].push(srcIdx);
    downstream[srcIdx].push(tgtIdx);
  }

  // Kahn's: start with zero in-degree nodes
  const queue: number[] = [];
  for (let i = 0; i < inDegree.length; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }

  const sorted: SortedNode[] = [];
  while (queue.length > 0) {
    const idx = queue.shift()!;
    sorted.push({ node: nodes[idx], dependsOn: dependsOn[idx] });
    for (const dIdx of downstream[idx]) {
      inDegree[dIdx]--;
      if (inDegree[dIdx] === 0) queue.push(dIdx);
    }
  }

  if (sorted.length !== nodes.length) {
    const remaining = nodes
      .filter((_, i) => inDegree[i] > 0)
      .map((n) => n.id)
      .join(", ");
    throw new Error(`图中存在循环依赖，无法排序执行。涉及节点: ${remaining}`);
  }

  return sorted;
}

// ── Input Collection ──

/**
 * For a given node, collect all inputs from upstream edges.
 * Returns a map of { targetPortId → data } sourced from upstream node outputs.
 */
function collectNodeInputs(
  node: WorkbenchNode,
  edges: WorkbenchEdge[],
  nodeOutputs: Map<string, ModuleOutput>,
): Record<string, any> {
  const inputs: Record<string, any> = {};

  for (const edge of edges) {
    if (edge.target !== node.id) continue;

    const upstream = nodeOutputs.get(edge.source);
    if (!upstream) continue;

    const value = upstream[edge.sourcePort];
    if (value === undefined) continue;

    // If this port already has a value (multiple connections), merge into array
    if (inputs[edge.targetPort] !== undefined) {
      if (Array.isArray(inputs[edge.targetPort])) {
        inputs[edge.targetPort].push(value);
      } else {
        inputs[edge.targetPort] = [inputs[edge.targetPort], value];
      }
    } else {
      inputs[edge.targetPort] = value;
    }
  }

  return inputs;
}

function collectNodeInputSources(
  node: WorkbenchNode,
  edges: WorkbenchEdge[],
  nodeOutputs: Map<string, ModuleOutput>,
): GraphNodeInputSource[] {
  const inputSources: GraphNodeInputSource[] = [];

  for (const edge of edges) {
    if (edge.target !== node.id) continue;

    const upstream = nodeOutputs.get(edge.source);
    if (!upstream) continue;

    const value = upstream[edge.sourcePort];
    if (value === undefined) continue;

    inputSources.push({
      sourceNodeId: edge.source,
      sourcePort: edge.sourcePort,
      targetPort: edge.targetPort,
    });
  }

  return inputSources.sort((left, right) => {
    const leftKey = `${left.targetPort}:${left.sourceNodeId}:${left.sourcePort}`;
    const rightKey = `${right.targetPort}:${right.sourceNodeId}:${right.sourcePort}`;
    return leftKey.localeCompare(rightKey);
  });
}

// ── Module Execution Dispatch (P2.1: registry-based) ──

/*
 * P2.1: The executor no longer defines createNodeHandlerMap() or
 * createFallbackNodeHandler(). All handler registration is owned by
 * runtime-node-registry.ts. The executor only resolves handlers via
 * the registry's resolveNodeHandler() API.
 */

class NodeExecutionError extends Error {
  readonly failedAt: "dispatch" | "handler";

  constructor(message: string, failedAt: "dispatch" | "handler") {
    super(message);
    this.name = "NodeExecutionError";
    this.failedAt = failedAt;
  }
}

/**
 * Dispatch node execution via the runtime registry.
 *
 * Resolution path:
 *   1. Ensure built-in handlers are registered (idempotent)
 *   2. resolveNodeHandler(moduleId) → registered or fallback descriptor
 *   3. Execute the resolved handler
 *
 * The fallback is now an explicit registry strategy, not an implicit
 * executor-level catch-all.
 */
async function dispatchNodeExecution(
  request: NodeHandlerRequest,
): Promise<NodeHandlerResult> {
  try {
    ensureBuiltinHandlers(request.modules);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new NodeExecutionError(message, "dispatch");
  }

  const resolved = resolveNodeHandler(request.node.moduleId);

  try {
    const executionResult = await resolved.descriptor.execute(request);
    const hostWrites = resolved.descriptor.produceHostWriteDescriptors?.({
      planNode: request.planNode,
      node: request.node,
      inputs: request.inputs,
    });
    const hostCommitContracts = hostWrites
      ? resolved.descriptor.produceHostCommitContracts?.(hostWrites)
      : undefined;
    return {
      ...executionResult,
      hostWrites,
      hostCommitContracts,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new NodeExecutionError(message, "handler");
  }
}

// ── Main Executor ──

interface StageTimer {
  finish: (status: GraphTraceStageStatus, error?: string) => GraphStageTrace;
}

function startStage(stage: GraphExecutionStage): StageTimer {
  const startedAt = Date.now();
  return {
    finish: (status, error) => ({
      stage,
      status,
      elapsedMs: Date.now() - startedAt,
      ...(error ? { error } : {}),
    }),
  };
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(
        ([key, nestedValue]) =>
          `${JSON.stringify(key)}:${stableSerialize(nestedValue)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function hashFingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fp1_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function createNodeFingerprint(
  node: WorkbenchNode,
  dependsOn: string[],
  order: number,
  capability: WorkbenchCapability,
  sideEffect: WorkbenchSideEffectLevel,
  isTerminal: boolean,
  hostWriteSummary?: HostWriteSummary,
  hostCommitSummary?: HostCommitSummary,
): string {
  return hashFingerprint(
    stableSerialize({
      scope: "graph_node",
      version: 1,
      nodeId: node.id,
      moduleId: node.moduleId,
      order,
      dependsOn: [...dependsOn].sort(),
      isTerminal,
      capability,
      sideEffect,
      config: node.config,
      runtimeMeta: node.runtimeMeta,
      hostWriteSummary,
      hostCommitSummary,
    }),
  );
}

function createCompileFingerprint(
  graph: WorkbenchGraph,
  nodes: GraphCompilePlanNode[],
): string {
  return hashFingerprint(
    stableSerialize({
      scope: "graph_compile",
      version: 1,
      graphId: graph.id,
      timing: graph.timing,
      runtimeMeta: graph.runtimeMeta,
      nodes: nodes.map((node) => ({
        nodeId: node.nodeId,
        moduleId: node.moduleId,
        nodeFingerprint: node.nodeFingerprint,
        order: node.order,
        sequence: node.sequence,
        dependsOn: [...node.dependsOn].sort(),
        isTerminal: node.isTerminal,
        capability: node.capability,
        sideEffect: node.sideEffect,
        isSideEffectNode: node.isSideEffectNode,
        hostWriteSummary: node.hostWriteSummary,
        hostCommitSummary: node.hostCommitSummary,
      })),
      edges: graph.edges
        .map((edge) => ({
          id: edge.id,
          source: edge.source,
          sourcePort: edge.sourcePort,
          target: edge.target,
          targetPort: edge.targetPort,
          runtimeMeta: edge.runtimeMeta,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    }),
  );
}

function createRunState(params: {
  runId: string;
  graphId: string;
  startedAt: number;
  status: GraphRunStatus;
  currentStage?: GraphExecutionStage;
  failedStage?: GraphExecutionStage;
  compileFingerprint?: string;
}) {
  const completedAt = Date.now();
  return {
    runId: params.runId,
    graphId: params.graphId,
    status: params.status,
    currentStage: params.currentStage,
    failedStage: params.failedStage,
    startedAt: params.startedAt,
    completedAt,
    elapsedMs: completedAt - params.startedAt,
    ...(params.compileFingerprint
      ? { compileFingerprint: params.compileFingerprint }
      : {}),
  };
}

function createCheckpointCandidate(params: {
  runId: string;
  graphId: string;
  compileFingerprint?: string;
  stage: GraphExecutionStage;
  nodeId?: string;
  nodeIndex?: number;
  reason: GraphRunCheckpointSummary["reason"];
}): GraphRunCheckpointSummary {
  const createdAt = Date.now();
  return {
    checkpointId: `${params.runId}:${params.stage}:${params.nodeId ?? "none"}:${params.nodeIndex ?? -1}`,
    runId: params.runId,
    graphId: params.graphId,
    compileFingerprint: params.compileFingerprint,
    stage: params.stage,
    nodeId: params.nodeId,
    nodeIndex: params.nodeIndex,
    resumable: false,
    reason: params.reason,
    createdAt,
  };
}

function createGraphRunArtifact(params: {
  runId: string;
  graphId: string;
  status: GraphRunStatus;
  currentStage?: GraphExecutionStage;
  failedStage?: GraphExecutionStage;
  compileFingerprint?: string;
  latestNodeId?: string;
  latestNodeModuleId?: string;
  latestNodeStatus?: GraphRunArtifact["latestNodeStatus"];
  diagnosticsOverview?: GraphRunDiagnosticsOverview;
  errorSummary?: string;
  checkpointCandidate?: GraphRunCheckpointSummary;
  latestHeartbeat?: GraphRunArtifact["latestHeartbeat"];
  latestPartialOutput?: GraphRunArtifact["latestPartialOutput"];
  waitingUser?: GraphRunArtifact["waitingUser"];
  eventCount: number;
}): GraphRunArtifact {
  return {
    runId: params.runId,
    graphId: params.graphId,
    status: params.status,
    currentStage: params.currentStage,
    failedStage: params.failedStage,
    compileFingerprint: params.compileFingerprint,
    latestNodeId: params.latestNodeId,
    latestNodeModuleId: params.latestNodeModuleId,
    latestNodeStatus: params.latestNodeStatus,
    diagnosticsOverview: params.diagnosticsOverview,
    errorSummary: params.errorSummary,
    checkpointCandidate: params.checkpointCandidate,
    latestHeartbeat: params.latestHeartbeat,
    latestPartialOutput: params.latestPartialOutput,
    waitingUser: params.waitingUser,
    eventCount: params.eventCount,
    updatedAt: Date.now(),
  };
}

function buildRunObservation(params: {
  graph: WorkbenchGraph;
  requestId: string;
  startedAt: number;
  status: GraphRunStatus;
  currentStage?: GraphExecutionStage;
  failedStage?: GraphExecutionStage;
  compileFingerprint?: string;
  latestNodeId?: string;
  latestNodeModuleId?: string;
  latestNodeStatus?: GraphRunArtifact["latestNodeStatus"];
  diagnosticsOverview?: GraphRunDiagnosticsOverview;
  errorSummary?: string;
  checkpointCandidate?: GraphRunCheckpointSummary;
  latestHeartbeat?: GraphRunArtifact["latestHeartbeat"];
  latestPartialOutput?: GraphRunArtifact["latestPartialOutput"];
  waitingUser?: GraphRunArtifact["waitingUser"];
  eventCount: number;
}): Pick<
  GraphExecutionResult,
  "runState" | "runArtifact" | "checkpointCandidate"
> {
  return {
    runState: createRunState({
      runId: params.requestId,
      graphId: params.graph.id,
      startedAt: params.startedAt,
      status: params.status,
      currentStage: params.currentStage,
      failedStage: params.failedStage,
      compileFingerprint: params.compileFingerprint,
    }),
    runArtifact: createGraphRunArtifact({
      runId: params.requestId,
      graphId: params.graph.id,
      status: params.status,
      currentStage: params.currentStage,
      failedStage: params.failedStage,
      compileFingerprint: params.compileFingerprint,
      latestNodeId: params.latestNodeId,
      latestNodeModuleId: params.latestNodeModuleId,
      latestNodeStatus: params.latestNodeStatus,
      diagnosticsOverview: params.diagnosticsOverview,
      errorSummary: params.errorSummary,
      checkpointCandidate: params.checkpointCandidate,
      latestHeartbeat: params.latestHeartbeat,
      latestPartialOutput: params.latestPartialOutput,
      waitingUser: params.waitingUser,
      eventCount: params.eventCount,
    }),
    checkpointCandidate: params.checkpointCandidate,
  };
}

function normalizeCapability(
  capability?: WorkbenchCapability,
  sideEffect?: WorkbenchSideEffectLevel,
): WorkbenchCapability {
  return capability ?? sideEffect ?? "unknown";
}

function normalizeLegacySideEffect(
  sideEffect?: WorkbenchSideEffectLevel,
  capability?: WorkbenchCapability,
): WorkbenchSideEffectLevel {
  const legacySemantic = sideEffect ?? capability ?? "unknown";
  switch (legacySemantic) {
    case "pure":
    case "reads_host":
    case "writes_host":
    case "unknown":
      return legacySemantic;
    case "source":
      return "reads_host";
    case "network":
    case "fallback":
    default:
      return "unknown";
  }
}

function isSideEffectNode(sideEffect: WorkbenchSideEffectLevel): boolean {
  return sideEffect === "writes_host";
}

function getNodeCapability(node: WorkbenchNode): WorkbenchCapability {
  const blueprint = getModuleBlueprint(node.moduleId);
  return normalizeCapability(
    node.runtimeMeta?.capability ??
      node.runtimeMeta?.sideEffect ??
      blueprint.runtimeMeta?.capability,
    blueprint.runtimeMeta?.sideEffect,
  );
}

function getNodeLegacySideEffect(
  node: WorkbenchNode,
  capability: WorkbenchCapability,
): WorkbenchSideEffectLevel {
  const blueprint = getModuleBlueprint(node.moduleId);
  return normalizeLegacySideEffect(
    node.runtimeMeta?.sideEffect ?? blueprint.runtimeMeta?.sideEffect,
    capability,
  );
}

function getHostWriteSummary(
  node: WorkbenchNode,
): HostWriteSummary | undefined {
  if (node.moduleId !== "out_reply_inject") {
    return undefined;
  }
  const blueprint = getModuleBlueprint(node.moduleId);
  const capability = getNodeCapability(node);
  if (capability !== "writes_host") {
    return undefined;
  }
  const hostTargetHint = blueprint.runtimeMeta?.hostTargetHint;
  if (
    !hostTargetHint ||
    hostTargetHint.targetType !== "reply_instruction" ||
    hostTargetHint.operation !== "inject_reply_instruction" ||
    hostTargetHint.path !== "reply.instruction"
  ) {
    return undefined;
  }
  return hostTargetHint;
}

function getHostCommitSummary(
  node: WorkbenchNode,
): HostCommitSummary | undefined {
  const hostWriteSummary = getHostWriteSummary(node);
  if (!hostWriteSummary) {
    return undefined;
  }
  return {
    kind: hostWriteSummary.kind,
    mode: "immediate",
    targetType: hostWriteSummary.targetType,
    targetId: hostWriteSummary.targetId,
    operation: hostWriteSummary.operation,
    path: hostWriteSummary.path,
  };
}

export function compileGraphPlan(graph: WorkbenchGraph): GraphCompilePlan {
  const sorted = topologicalSort(graph.nodes, graph.edges);
  const nodesWithOutgoing = new Set(graph.edges.map((edge) => edge.source));
  const nodes: GraphCompilePlanNode[] = sorted.map(
    ({ node, dependsOn }, order) => {
      const capability = getNodeCapability(node);
      const sideEffect = getNodeLegacySideEffect(node, capability);
      const resolvedDependsOn = dependsOn
        .map((index) => graph.nodes[index]?.id)
        .filter((nodeId): nodeId is string => Boolean(nodeId));
      const isTerminal = !nodesWithOutgoing.has(node.id);
      const hostWriteSummary = getHostWriteSummary(node);
      const hostCommitSummary = getHostCommitSummary(node);
      return {
        nodeId: node.id,
        moduleId: node.moduleId,
        nodeFingerprint: createNodeFingerprint(
          node,
          resolvedDependsOn,
          order,
          capability,
          sideEffect,
          isTerminal,
          hostWriteSummary,
          hostCommitSummary,
        ),
        order,
        sequence: order,
        dependsOn: resolvedDependsOn,
        isTerminal,
        capability,
        sideEffect,
        stage: "compile",
        status: "ok",
        isSideEffectNode: isSideEffectNode(sideEffect),
        hostWriteSummary,
        hostCommitSummary,
      };
    },
  );

  return {
    compileFingerprint: createCompileFingerprint(graph, nodes),
    fingerprintVersion: 1,
    fingerprintSource: {
      graphId: graph.id,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
    },
    nodeOrder: nodes.map((node) => node.nodeId),
    terminalNodeIds: nodes
      .filter((node) => node.isTerminal)
      .map((node) => node.nodeId),
    sideEffectNodeIds: nodes
      .filter((node) => node.isSideEffectNode)
      .map((node) => node.nodeId),
    nodes,
  };
}

class GraphExecutionStageError extends Error {
  readonly stage: GraphExecutionStage;
  readonly moduleResults: ModuleExecutionResult[];
  readonly nodeTraces: NonNullable<GraphExecutionResult["trace"]>["nodeTraces"];
  readonly dirtySetSummary?: GraphDirtySetSummary;
  readonly failedNodeId?: string;
  readonly runEvents?: GraphRunEvent[];

  constructor(
    stage: GraphExecutionStage,
    message: string,
    moduleResults: ModuleExecutionResult[],
    nodeTraces: NonNullable<GraphExecutionResult["trace"]>["nodeTraces"],
    failedNodeId?: string,
    dirtySetSummary?: GraphDirtySetSummary,
    runEvents?: GraphRunEvent[],
  ) {
    super(message);
    this.name = "GraphExecutionStageError";
    this.stage = stage;
    this.moduleResults = moduleResults;
    this.nodeTraces = nodeTraces;
    this.failedNodeId = failedNodeId;
    this.dirtySetSummary = dirtySetSummary;
    this.runEvents = runEvents;
  }
}

function createNodeTraceBase(
  planNode: GraphCompilePlanNode,
  startedAt: number,
  inputKeys: string[],
) {
  return {
    nodeId: planNode.nodeId,
    moduleId: planNode.moduleId,
    nodeFingerprint: planNode.nodeFingerprint,
    stage: planNode.stage ?? "execute",
    capability: planNode.capability ?? planNode.sideEffect,
    sideEffect: planNode.sideEffect,
    isSideEffectNode: planNode.isSideEffectNode,
    startedAt,
    inputKeys,
    outputIncludedInFinalOutputs:
      planNode.isTerminal && !planNode.isSideEffectNode,
    hostWriteSummary: planNode.hostWriteSummary,
    hostCommitSummary: planNode.hostCommitSummary,
  };
}

function normalizeHostWrites(
  hostWrites: HostWriteDescriptor[] | undefined,
): HostWriteDescriptor[] | undefined {
  if (!hostWrites || hostWrites.length === 0) {
    return undefined;
  }
  return hostWrites.map((descriptor) => ({ ...descriptor }));
}

function normalizeHostCommitContracts(
  hostCommitContracts: HostCommitContract[] | undefined,
): HostCommitContract[] | undefined {
  if (!hostCommitContracts || hostCommitContracts.length === 0) {
    return undefined;
  }
  return hostCommitContracts.map((contract) => ({ ...contract }));
}

const previousInputFingerprintByNode = new Map<string, string>();
const previousReusableOutputsByNode = new Map<string, ModuleOutput>();
const REUSE_FINGERPRINT_VERSION = 1;

export function resetGraphExecutorReuseStateForTesting(): void {
  previousInputFingerprintByNode.clear();
  previousReusableOutputsByNode.clear();
}

export function clearGraphExecutorReusableOutputsForTesting(): void {
  previousReusableOutputsByNode.clear();
}
const REUSE_ELIGIBLE_CAPABILITIES = new Set<WorkbenchCapability>(["pure"]);
const EXECUTION_DECISION_REASONS: GraphNodeExecutionDecisionReason[] = [
  "feature_disabled",
  "ineligible_reuse_verdict",
  "ineligible_capability",
  "ineligible_side_effect",
  "ineligible_source",
  "ineligible_terminal",
  "ineligible_fallback",
  "missing_baseline",
  "missing_reusable_outputs",
  "execute",
  "skip_reuse_outputs",
];
const EXPERIMENTAL_REUSE_SKIP_SETTING_KEYS = [
  "experimentalGraphReuseSkip",
  "experimental_graph_reuse_skip",
  "graphReuseSkipPilot",
  "graph_reuse_skip_pilot",
] as const;

function collectStableContextInputFacts(
  node: WorkbenchNode,
  context: ExecutionContext,
): Record<string, unknown> | undefined {
  switch (node.moduleId) {
    case "src_user_input":
      return { userInput: context.userInput };
    default:
      return undefined;
  }
}

function createInputFingerprint(
  node: WorkbenchNode,
  planNode: GraphCompilePlanNode,
  inputs: Record<string, any>,
  inputSources: GraphNodeInputSource[],
  stableContextInputs?: Record<string, unknown>,
): string {
  return hashFingerprint(
    stableSerialize({
      scope: "graph_node_input",
      version: 1,
      nodeId: node.id,
      nodeFingerprint: planNode.nodeFingerprint,
      inputs,
      inputSources,
      stableContextInputs,
    }),
  );
}

function createDirtySetSummary(
  entries: GraphDirtySetEntry[],
): GraphDirtySetSummary {
  return {
    fingerprintVersion: 1,
    entries: entries.map((entry) => ({ ...entry })),
    dirtyNodeIds: entries
      .filter((entry) => entry.isDirty)
      .map((entry) => entry.nodeId),
  };
}

export function buildGraphRunDiagnosticsOverview(
  result: GraphExecutionResult,
): GraphRunDiagnosticsOverview {
  const dirtySetSummary = result.dirtySetSummary;
  const reasonCounts: Record<GraphNodeDirtyReason, number> = {
    initial_run: 0,
    input_changed: 0,
    upstream_dirty: 0,
    clean: 0,
  };

  if (dirtySetSummary) {
    for (const entry of dirtySetSummary.entries) {
      reasonCounts[entry.dirtyReason] += 1;
    }
  }

  return {
    run: { ...result.runState },
    compile: {
      compileFingerprint:
        result.compilePlan?.compileFingerprint ??
        result.runState.compileFingerprint,
      nodeCount: result.compilePlan?.nodeOrder.length,
      terminalNodeCount: result.compilePlan?.terminalNodeIds.length,
    },
    dirty: {
      totalNodeCount: dirtySetSummary?.entries.length ?? 0,
      dirtyNodeCount: dirtySetSummary?.dirtyNodeIds.length ?? 0,
      cleanNodeCount:
        (dirtySetSummary?.entries.length ?? 0) -
        (dirtySetSummary?.dirtyNodeIds.length ?? 0),
      dirtyNodeIds: [...(dirtySetSummary?.dirtyNodeIds ?? [])],
      reasonCounts,
    },
  };
}

function createCacheKeyFacts(
  graph: WorkbenchGraph,
  plan: GraphCompilePlan,
  planNode: GraphCompilePlanNode,
  inputFingerprint: string,
): GraphNodeCacheKeyFacts {
  return {
    compileFingerprint: plan.compileFingerprint,
    nodeFingerprint: planNode.nodeFingerprint,
    inputFingerprint,
    scopeKey: `${graph.id}:${planNode.nodeId}`,
    fingerprintVersion: REUSE_FINGERPRINT_VERSION,
  };
}

function createReuseVerdict(params: {
  capability?: WorkbenchCapability;
  isSideEffectNode: boolean;
  isDirty: boolean;
  previousInputFingerprint?: string;
  inputFingerprint: string;
}): GraphNodeReuseVerdict {
  const {
    capability,
    isSideEffectNode,
    isDirty,
    previousInputFingerprint,
    inputFingerprint,
  } = params;

  let reason: GraphNodeReuseReason;
  if (isSideEffectNode) {
    reason = "ineligible_side_effect";
  } else if (isDirty) {
    reason =
      previousInputFingerprint === undefined
        ? "ineligible_missing_baseline"
        : "ineligible_dirty";
  } else if (!capability || !REUSE_ELIGIBLE_CAPABILITIES.has(capability)) {
    reason = "ineligible_capability";
  } else if (previousInputFingerprint === undefined) {
    reason = "ineligible_missing_baseline";
  } else {
    reason = "eligible";
  }

  return {
    canReuse: reason === "eligible",
    reason,
    baselineInputFingerprint: previousInputFingerprint,
    currentInputFingerprint: inputFingerprint,
  };
}

function createReuseSummary(
  verdicts: Array<{ nodeId: string; reuseVerdict: GraphNodeReuseVerdict }>,
): GraphReuseSummary {
  const verdictCounts: Record<GraphNodeReuseReason, number> = {
    eligible: 0,
    ineligible_dirty: 0,
    ineligible_side_effect: 0,
    ineligible_capability: 0,
    ineligible_missing_baseline: 0,
  };

  for (const { reuseVerdict } of verdicts) {
    verdictCounts[reuseVerdict.reason] += 1;
  }

  return {
    fingerprintVersion: REUSE_FINGERPRINT_VERSION,
    eligibleNodeIds: verdicts
      .filter(({ reuseVerdict }) => reuseVerdict.canReuse)
      .map(({ nodeId }) => nodeId),
    ineligibleNodeIds: verdicts
      .filter(({ reuseVerdict }) => !reuseVerdict.canReuse)
      .map(({ nodeId }) => nodeId),
    verdictCounts,
  };
}

function cloneModuleOutput(outputs: ModuleOutput): ModuleOutput {
  return { ...outputs };
}

function readExperimentalReuseSkipFlag(context: ExecutionContext): boolean {
  const settings = context.settings as Record<string, unknown> | undefined;
  if (!settings || typeof settings !== "object") {
    return false;
  }

  for (const key of EXPERIMENTAL_REUSE_SKIP_SETTING_KEYS) {
    if (typeof settings[key] === "boolean") {
      return settings[key] as boolean;
    }
  }

  return false;
}

function createExecutionDecision(params: {
  featureEnabled: boolean;
  capability?: WorkbenchCapability;
  sideEffect?: WorkbenchSideEffectLevel;
  isSideEffectNode: boolean;
  isTerminal: boolean;
  isFallbackNode: boolean;
  dirtyReason: GraphNodeDirtyReason;
  previousInputFingerprint?: string;
  reuseVerdict: GraphNodeReuseVerdict;
  reusableOutputs?: ModuleOutput;
}): GraphNodeExecutionDecision {
  const {
    featureEnabled,
    capability,
    sideEffect,
    isSideEffectNode,
    isTerminal,
    isFallbackNode,
    dirtyReason,
    previousInputFingerprint,
    reuseVerdict,
    reusableOutputs,
  } = params;

  let reason: GraphNodeExecutionDecisionReason = "execute";

  if (!featureEnabled) {
    reason = "feature_disabled";
  } else if (isSideEffectNode || sideEffect === "writes_host") {
    reason = "ineligible_side_effect";
  } else if (capability === "source") {
    reason = "ineligible_source";
  } else if (isTerminal) {
    reason = "ineligible_terminal";
  } else if (isFallbackNode) {
    reason = "ineligible_fallback";
  } else if (previousInputFingerprint === undefined) {
    reason = "missing_baseline";
  } else if (!capability || capability !== "pure") {
    reason = "ineligible_capability";
  } else if (dirtyReason !== "clean" || !reuseVerdict.canReuse) {
    reason = "ineligible_reuse_verdict";
  } else if (!reusableOutputs) {
    reason = "missing_reusable_outputs";
  } else {
    reason = "skip_reuse_outputs";
  }

  return {
    shouldExecute: reason !== "skip_reuse_outputs",
    shouldSkip: reason === "skip_reuse_outputs",
    reason,
    reusableOutputHit: reason === "skip_reuse_outputs",
  };
}

function createExecutionDecisionSummary(
  decisions: Array<{
    nodeId: string;
    executionDecision: GraphNodeExecutionDecision;
  }>,
  featureEnabled: boolean,
): GraphExecutionDecisionSummary {
  const decisionCounts = Object.fromEntries(
    EXECUTION_DECISION_REASONS.map((reason) => [reason, 0]),
  ) as Record<GraphNodeExecutionDecisionReason, number>;

  for (const { executionDecision } of decisions) {
    decisionCounts[executionDecision.reason] += 1;
  }

  return {
    featureEnabled,
    skippedNodeIds: decisions
      .filter(({ executionDecision }) => executionDecision.shouldSkip)
      .map(({ nodeId }) => nodeId),
    executedNodeIds: decisions
      .filter(({ executionDecision }) => executionDecision.shouldExecute)
      .map(({ nodeId }) => nodeId),
    decisionCounts,
  };
}

export async function executeCompiledGraph(
  graph: WorkbenchGraph,
  plan: GraphCompilePlan,
  context: ExecutionContext,
): Promise<
  Pick<
    GraphExecutionResult,
    | "moduleResults"
    | "finalOutputs"
    | "hostWrites"
    | "hostCommitContracts"
    | "dirtySetSummary"
    | "executionDecisionSummary"
    | "checkpointCandidate"
    | "runEvents"
  > & {
    nodeTraces: NonNullable<GraphExecutionResult["trace"]>["nodeTraces"];
    reuseSummary: GraphReuseSummary;
  }
> {
  const moduleResults: ModuleExecutionResult[] = [];
  const nodeTraces: NonNullable<GraphExecutionResult["trace"]>["nodeTraces"] =
    [];
  const hostWrites: HostWriteDescriptor[] = [];
  const hostCommitContracts: HostCommitContract[] = [];
  const nodeOutputs = new Map<string, ModuleOutput>();
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const planNodeMap = new Map(plan.nodes.map((node) => [node.nodeId, node]));
  const dirtySetEntries: GraphDirtySetEntry[] = [];
  const dirtyStateByNodeId = new Map<
    string,
    {
      inputFingerprint: string;
      isDirty: boolean;
      dirtyReason: GraphNodeDirtyReason;
    }
  >();

  const reuseVerdicts: Array<{
    nodeId: string;
    reuseVerdict: GraphNodeReuseVerdict;
  }> = [];
  const executionDecisions: Array<{
    nodeId: string;
    executionDecision: GraphNodeExecutionDecision;
  }> = [];
  const reuseSkipEnabled = readExperimentalReuseSkipFlag(context);
  const runEvents: GraphRunEvent[] = [];
  let checkpointCandidate: GraphRunCheckpointSummary | undefined;

  const toTextPreview = (value: unknown): string => {
    if (typeof value === "string") {
      return value;
    }
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    try {
      return stableSerialize(value);
    } catch {
      return String(value);
    }
  };

  const emitNodeEvent = (
    type: GraphRunEvent["type"],
    params: {
      status?: GraphRunStatus;
      nodeId?: string;
      moduleId?: string;
      nodeIndex?: number;
      checkpoint?: GraphRunCheckpointSummary;
      heartbeat?: GraphRunEvent["heartbeat"];
      partialOutput?: GraphRunEvent["partialOutput"];
      waitingUser?: GraphRunEvent["waitingUser"];
      error?: string;
    },
  ) => {
    const event: GraphRunEvent = {
      type,
      runId: context.requestId,
      graphId: graph.id,
      timestamp: Date.now(),
      ...(params.status ? { status: params.status } : {}),
      stage: "execute",
      ...(params.nodeId ? { nodeId: params.nodeId } : {}),
      ...(params.moduleId ? { moduleId: params.moduleId } : {}),
      ...(params.nodeIndex !== undefined
        ? { nodeIndex: params.nodeIndex }
        : {}),
      ...(params.checkpoint ? { checkpoint: params.checkpoint } : {}),
      ...(params.heartbeat ? { heartbeat: params.heartbeat } : {}),
      ...(params.partialOutput ? { partialOutput: params.partialOutput } : {}),
      ...(params.waitingUser ? { waitingUser: params.waitingUser } : {}),
      ...(params.error ? { error: params.error } : {}),
    };
    runEvents.push(event);
  };

  const [
    sourceImpls,
    filterImpls,
    transformImpls,
    composeImpls,
    executeImpls,
    outputImpls,
  ] = await Promise.all([
    import("./module-impls/source-impls"),
    import("./module-impls/filter-impls"),
    import("./module-impls/transform-impls"),
    import("./module-impls/compose-impls"),
    import("./module-impls/execute-impls"),
    import("./module-impls/output-impls"),
  ]);

  const runtimeModules: RuntimeImplModules = {
    sourceImpls,
    filterImpls,
    transformImpls,
    composeImpls,
    executeImpls,
    outputImpls,
  };

  for (const nodeId of plan.nodeOrder) {
    const planNode = planNodeMap.get(nodeId);
    if (!planNode) {
      throw new Error(`compile plan 缺少节点元数据: ${nodeId}`);
    }
    if (context.abortSignal?.aborted || context.isCancelled?.()) {
      throw new GraphExecutionStageError(
        "execute",
        "workflow cancelled by user",
        moduleResults,
        nodeTraces,
      );
    }

    const node = nodeMap.get(nodeId);
    if (!node) {
      throw new Error(`compile plan 引用了不存在的节点: ${planNode.nodeId}`);
    }

    const nodeStart = Date.now();
    const inputs = collectNodeInputs(node, graph.edges, nodeOutputs);
    const inputSources = collectNodeInputSources(
      node,
      graph.edges,
      nodeOutputs,
    );
    const stableContextInputs = collectStableContextInputFacts(node, context);
    const inputFingerprint = createInputFingerprint(
      node,
      planNode,
      inputs,
      inputSources,
      stableContextInputs,
    );
    const previousInputFingerprint = previousInputFingerprintByNode.get(
      `${graph.id}:${node.id}`,
    );
    const hasDirtyUpstream = planNode.dependsOn.some(
      (dependencyNodeId) =>
        dirtyStateByNodeId.get(dependencyNodeId)?.isDirty === true,
    );
    const dirtyReason: GraphNodeDirtyReason =
      previousInputFingerprint === undefined
        ? "initial_run"
        : hasDirtyUpstream
          ? "upstream_dirty"
          : previousInputFingerprint !== inputFingerprint
            ? "input_changed"
            : "clean";
    const isDirty = dirtyReason !== "clean";
    dirtyStateByNodeId.set(node.id, {
      inputFingerprint,
      isDirty,
      dirtyReason,
    });
    dirtySetEntries.push({
      nodeId: node.id,
      inputFingerprint,
      isDirty,
      dirtyReason,
    });
    const cacheKeyFacts = createCacheKeyFacts(
      graph,
      plan,
      planNode,
      inputFingerprint,
    );
    const reuseVerdict = createReuseVerdict({
      capability: planNode.capability,
      isSideEffectNode: planNode.isSideEffectNode,
      isDirty,
      previousInputFingerprint,
      inputFingerprint,
    });
    reuseVerdicts.push({
      nodeId: node.id,
      reuseVerdict,
    });
    const inputKeys = Object.keys(inputs);
    const reusableOutputs = previousReusableOutputsByNode.get(
      `${graph.id}:${node.id}`,
    );
    const executionDecision = createExecutionDecision({
      featureEnabled: reuseSkipEnabled,
      capability: planNode.capability,
      sideEffect: planNode.sideEffect,
      isSideEffectNode: planNode.isSideEffectNode,
      isTerminal: planNode.isTerminal,
      isFallbackNode:
        resolveNodeHandler(node.moduleId).resolvedVia === "fallback",
      dirtyReason,
      previousInputFingerprint,
      reuseVerdict,
      reusableOutputs,
    });
    executionDecisions.push({
      nodeId: node.id,
      executionDecision,
    });
    const nodeTraceBase = {
      ...createNodeTraceBase(planNode, nodeStart, inputKeys),
      inputFingerprint,
      inputSources,
      isDirty,
      dirtyReason,
      cacheKeyFacts,
      reuseVerdict,
      executionDecision,
    };

    emitNodeEvent("node_started", {
      status: "running",
      nodeId: node.id,
      moduleId: node.moduleId,
      nodeIndex: planNode.order,
    });
    emitNodeEvent("heartbeat", {
      status: "running",
      nodeId: node.id,
      moduleId: node.moduleId,
      nodeIndex: planNode.order,
      heartbeat: {
        timestamp: Date.now(),
        nodeId: node.id,
        moduleId: node.moduleId,
        nodeIndex: planNode.order,
        message: `节点 ${node.id} 已开始执行`,
      },
    });

    if (executionDecision.shouldSkip && reusableOutputs) {
      const reusedOutputs = cloneModuleOutput(reusableOutputs);
      nodeOutputs.set(node.id, reusedOutputs);
      moduleResults.push({
        nodeId: node.id,
        moduleId: node.moduleId,
        nodeFingerprint: planNode.nodeFingerprint,
        inputFingerprint,
        inputSources,
        isDirty,
        dirtyReason,
        outputs: reusedOutputs,
        elapsedMs: 0,
        stage: "execute",
        status: "skipped",
        capability: planNode.capability,
        isSideEffectNode: planNode.isSideEffectNode,
        cacheKeyFacts,
        reuseVerdict,
        executionDecision,
        hostWriteSummary: planNode.hostWriteSummary,
        hostCommitSummary: planNode.hostCommitSummary,
      });
      nodeTraces.push({
        ...nodeTraceBase,
        stage: "execute",
        status: "skipped",
        elapsedMs: 0,
        durationMs: 0,
        completedAt: nodeStart,
        isFallback: false,
      });
      checkpointCandidate = createCheckpointCandidate({
        runId: context.requestId,
        graphId: graph.id,
        compileFingerprint: plan.compileFingerprint,
        stage: "execute",
        nodeId: node.id,
        nodeIndex: planNode.order,
        reason: planNode.isTerminal ? "terminal_candidate" : "node_boundary",
      });
      emitNodeEvent("node_skipped", {
        status: "running",
        nodeId: node.id,
        moduleId: node.moduleId,
        nodeIndex: planNode.order,
        checkpoint: checkpointCandidate,
      });
      emitNodeEvent("checkpoint_candidate", {
        status: "running",
        nodeId: node.id,
        moduleId: node.moduleId,
        nodeIndex: planNode.order,
        checkpoint: checkpointCandidate,
      });
      continue;
    }

    context.onProgress?.({
      phase: "module_executing",
      request_id: context.requestId,
      module_id: node.moduleId,
      node_id: node.id,
      stage: "execute",
      message: `正在执行模块「${getModuleBlueprint(node.moduleId).label}」…`,
      graph_id: graph.id,
    });

    try {
      const dispatchResult = await dispatchNodeExecution({
        planNode,
        node,
        inputs,
        context,
        modules: runtimeModules,
      });
      const outputs = dispatchResult.outputs;
      nodeOutputs.set(node.id, outputs);

      const partialOutputKeys = Object.keys(outputs).filter((key) => {
        const value = outputs[key];
        return value !== undefined && value !== null;
      });
      if (partialOutputKeys.length > 0) {
        const rawPreview = toTextPreview(outputs[partialOutputKeys[0]]);
        const preview = rawPreview.slice(0, 160);
        emitNodeEvent("partial_output", {
          status: "streaming",
          nodeId: node.id,
          moduleId: node.moduleId,
          nodeIndex: planNode.order,
          partialOutput: {
            timestamp: Date.now(),
            nodeId: node.id,
            moduleId: node.moduleId,
            nodeIndex: planNode.order,
            preview,
            length: rawPreview.length,
          },
        });
      }

      if (node.config?.observationState === "waiting_user") {
        emitNodeEvent("waiting_user", {
          status: "waiting_user",
          nodeId: node.id,
          moduleId: node.moduleId,
          nodeIndex: planNode.order,
          waitingUser: {
            timestamp: Date.now(),
            nodeId: node.id,
            moduleId: node.moduleId,
            nodeIndex: planNode.order,
            reason:
              typeof node.config?.waitingUserReason === "string" &&
              node.config.waitingUserReason.trim()
                ? node.config.waitingUserReason.trim()
                : `节点 ${node.id} 进入 waiting_user 观测态`,
          },
        });
      }

      const nodeHostWrites = normalizeHostWrites(dispatchResult.hostWrites);
      if (nodeHostWrites) {
        hostWrites.push(...nodeHostWrites);
      }
      const nodeHostCommitContracts = normalizeHostCommitContracts(
        dispatchResult.hostCommitContracts,
      );
      if (nodeHostCommitContracts) {
        hostCommitContracts.push(...nodeHostCommitContracts);
      }

      const elapsedMs = Date.now() - nodeStart;
      moduleResults.push({
        nodeId: node.id,
        moduleId: node.moduleId,
        nodeFingerprint: planNode.nodeFingerprint,
        inputFingerprint,
        inputSources,
        isDirty,
        dirtyReason,
        outputs,
        elapsedMs,
        stage: "execute",
        status: "ok",
        capability: dispatchResult.capability ?? planNode.capability,
        isSideEffectNode: planNode.isSideEffectNode,
        cacheKeyFacts,
        reuseVerdict,
        executionDecision,
        hostWriteSummary: planNode.hostWriteSummary,
        hostCommitSummary: planNode.hostCommitSummary,
        hostWrites: nodeHostWrites,
        hostCommitContracts: nodeHostCommitContracts,
      });
      const resultCapability = dispatchResult.capability ?? planNode.capability;
      nodeTraces.push({
        ...nodeTraceBase,
        stage: "execute",
        status: "ok",
        capability: resultCapability,
        sideEffect: normalizeLegacySideEffect(
          planNode.sideEffect,
          resultCapability,
        ),
        elapsedMs,
        durationMs: elapsedMs,
        completedAt: nodeStart + elapsedMs,
        handlerId: dispatchResult.handlerId,
        isFallback: dispatchResult.isFallback === true,
        hostWrites: nodeHostWrites,
        hostCommitContracts: nodeHostCommitContracts,
      });
      checkpointCandidate = createCheckpointCandidate({
        runId: context.requestId,
        graphId: graph.id,
        compileFingerprint: plan.compileFingerprint,
        stage: "execute",
        nodeId: node.id,
        nodeIndex: planNode.order,
        reason: planNode.isTerminal ? "terminal_candidate" : "node_boundary",
      });
      emitNodeEvent("node_finished", {
        status: "running",
        nodeId: node.id,
        moduleId: node.moduleId,
        nodeIndex: planNode.order,
        checkpoint: checkpointCandidate,
      });
      emitNodeEvent("checkpoint_candidate", {
        status: "running",
        nodeId: node.id,
        moduleId: node.moduleId,
        nodeIndex: planNode.order,
        checkpoint: checkpointCandidate,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const elapsedMs = Date.now() - nodeStart;
      const failedAt =
        error instanceof NodeExecutionError ? error.failedAt : "handler";
      moduleResults.push({
        nodeId: node.id,
        moduleId: node.moduleId,
        nodeFingerprint: planNode.nodeFingerprint,
        inputFingerprint,
        inputSources,
        isDirty,
        dirtyReason,
        outputs: {},
        elapsedMs,
        error: errorMsg,
        stage: "execute",
        status: "error",
        capability: planNode.capability,
        isSideEffectNode: planNode.isSideEffectNode,
        cacheKeyFacts,
        reuseVerdict,
        executionDecision,
        hostWriteSummary: planNode.hostWriteSummary,
        hostCommitSummary: planNode.hostCommitSummary,
      });
      nodeTraces.push({
        ...nodeTraceBase,
        stage: "execute",
        status: "error",
        elapsedMs,
        durationMs: elapsedMs,
        completedAt: nodeStart + elapsedMs,
        error: errorMsg,
        failedAt,
        isFallback: false,
      });
      emitNodeEvent("node_failed", {
        status: "failed",
        nodeId: node.id,
        moduleId: node.moduleId,
        nodeIndex: planNode.order,
        error: errorMsg,
      });

      // Append 'skipped' traces for remaining nodes in plan order (fail-fast)
      const failedIndex = plan.nodeOrder.indexOf(node.id);
      for (let i = failedIndex + 1; i < plan.nodeOrder.length; i++) {
        const skippedId = plan.nodeOrder[i];
        const skippedPlanNode = planNodeMap.get(skippedId);
        if (!skippedPlanNode) continue;
        nodeTraces.push({
          nodeId: skippedId,
          moduleId: skippedPlanNode.moduleId,
          nodeFingerprint: skippedPlanNode.nodeFingerprint,
          stage: "execute",
          status: "skipped",
          capability: skippedPlanNode.capability,
          sideEffect: skippedPlanNode.sideEffect,
          isSideEffectNode: skippedPlanNode.isSideEffectNode,
          durationMs: 0,
          elapsedMs: 0,
          hostWriteSummary: skippedPlanNode.hostWriteSummary,
          hostCommitSummary: skippedPlanNode.hostCommitSummary,
        });
      }

      throw new GraphExecutionStageError(
        "execute",
        `模块「${getModuleBlueprint(node.moduleId).label}」执行失败（node=${node.id}, module=${node.moduleId}）: ${errorMsg}`,
        moduleResults,
        nodeTraces,
        node.id,
        createDirtySetSummary(dirtySetEntries),
        runEvents,
      );
    }
  }

  const terminalOutputs: Record<string, any> = {};
  for (const terminalNodeId of plan.terminalNodeIds) {
    if (plan.sideEffectNodeIds.includes(terminalNodeId)) {
      continue;
    }

    const outputs = nodeOutputs.get(terminalNodeId);
    if (outputs) {
      terminalOutputs[terminalNodeId] = outputs;
    }
  }

  for (const [nodeId, dirtyState] of dirtyStateByNodeId) {
    previousInputFingerprintByNode.set(
      `${graph.id}:${nodeId}`,
      dirtyState.inputFingerprint,
    );
  }

  for (const result of moduleResults) {
    if (result.status === "ok") {
      previousReusableOutputsByNode.set(
        `${graph.id}:${result.nodeId}`,
        cloneModuleOutput(result.outputs),
      );
    }
  }

  return {
    moduleResults,
    nodeTraces,
    finalOutputs: terminalOutputs,
    hostWrites,
    hostCommitContracts,
    checkpointCandidate,
    runEvents,
    dirtySetSummary: createDirtySetSummary(dirtySetEntries),
    reuseSummary: createReuseSummary(reuseVerdicts),
    executionDecisionSummary: createExecutionDecisionSummary(
      executionDecisions,
      reuseSkipEnabled,
    ),
  };
}

export async function executeGraph(
  graph: WorkbenchGraph,
  context: ExecutionContext,
): Promise<GraphExecutionResult> {
  const startedAt = Date.now();
  const trace: GraphStageTrace[] = [];
  const nodeTraces: NonNullable<GraphExecutionResult["trace"]>["nodeTraces"] =
    [];
  const runEvents: GraphRunEvent[] = [];
  let latestNodeId: string | undefined;
  let latestNodeModuleId: string | undefined;
  let latestNodeStatus: GraphRunArtifact["latestNodeStatus"];
  let checkpointCandidate: GraphRunCheckpointSummary | undefined;
  let latestHeartbeat: GraphRunArtifact["latestHeartbeat"];
  let latestPartialOutput: GraphRunArtifact["latestPartialOutput"];
  let waitingUser: GraphRunArtifact["waitingUser"];

  const buildOverview = (
    runState: GraphExecutionResult["runState"],
    dirtySetSummary?: GraphDirtySetSummary,
    compilePlan?: GraphCompilePlan,
  ): GraphRunDiagnosticsOverview => {
    const reasonCounts: Record<GraphNodeDirtyReason, number> = {
      initial_run: 0,
      input_changed: 0,
      upstream_dirty: 0,
      clean: 0,
    };
    if (dirtySetSummary) {
      for (const entry of dirtySetSummary.entries) {
        reasonCounts[entry.dirtyReason] += 1;
      }
    }
    return {
      run: { ...runState },
      compile: {
        compileFingerprint:
          compilePlan?.compileFingerprint ?? runState.compileFingerprint,
        nodeCount: compilePlan?.nodeOrder.length,
        terminalNodeCount: compilePlan?.terminalNodeIds.length,
      },
      dirty: {
        totalNodeCount: dirtySetSummary?.entries.length ?? 0,
        dirtyNodeCount: dirtySetSummary?.dirtyNodeIds.length ?? 0,
        cleanNodeCount:
          (dirtySetSummary?.entries.length ?? 0) -
          (dirtySetSummary?.dirtyNodeIds.length ?? 0),
        dirtyNodeIds: [...(dirtySetSummary?.dirtyNodeIds ?? [])],
        reasonCounts,
      },
    };
  };

  const emitRunEvent = (
    type: GraphRunEvent["type"],
    params: {
      status?: GraphRunStatus;
      stage?: GraphExecutionStage;
      error?: string;
      diagnosticsOverview?: GraphRunDiagnosticsOverview;
    },
  ) => {
    const observation = buildRunObservation({
      graph,
      requestId: context.requestId,
      startedAt,
      status: params.status ?? "running",
      currentStage: params.stage,
      failedStage: params.status === "failed" ? params.stage : undefined,
      compileFingerprint:
        params.diagnosticsOverview?.compile.compileFingerprint,
      latestNodeId,
      latestNodeModuleId,
      latestNodeStatus,
      diagnosticsOverview: params.diagnosticsOverview,
      errorSummary: params.error,
      checkpointCandidate,
      latestHeartbeat,
      latestPartialOutput,
      waitingUser,
      eventCount: runEvents.length + 1,
    });
    const event: GraphRunEvent = {
      type,
      runId: context.requestId,
      graphId: graph.id,
      timestamp: Date.now(),
      ...(params.status ? { status: params.status } : {}),
      ...(params.stage ? { stage: params.stage } : {}),
      ...(params.error ? { error: params.error } : {}),
      ...(params.diagnosticsOverview
        ? { diagnosticsOverview: params.diagnosticsOverview }
        : {}),
      artifact: observation.runArtifact,
    };
    runEvents.push(event);
    context.onProgress?.(event);
  };

  emitRunEvent("run_queued", { status: "queued" });
  emitRunEvent("run_started", { status: "running" });
  emitRunEvent("stage_started", { status: "running", stage: "validate" });

  const validateTimer = startStage("validate");
  const validationErrors = validateGraph(graph);
  if (validationErrors.length > 0) {
    const reason = formatGraphValidationErrors(validationErrors);
    trace.push(validateTimer.finish("error", reason));
    trace.push({ stage: "compile", status: "skipped", elapsedMs: 0 });
    trace.push({ stage: "execute", status: "skipped", elapsedMs: 0 });
    const runState = createRunState({
      runId: context.requestId,
      graphId: graph.id,
      startedAt,
      status: "failed",
      currentStage: "validate",
      failedStage: "validate",
    });
    const diagnosticsOverview = buildOverview(runState);
    emitRunEvent("stage_finished", {
      status: "failed",
      stage: "validate",
      error: reason,
      diagnosticsOverview,
    });
    emitRunEvent("run_failed", {
      status: "failed",
      stage: "validate",
      error: reason,
      diagnosticsOverview,
    });
    return {
      ok: false,
      reason,
      requestId: context.requestId,
      ...buildRunObservation({
        graph,
        requestId: context.requestId,
        startedAt,
        status: "failed",
        currentStage: "validate",
        failedStage: "validate",
        diagnosticsOverview,
        errorSummary: reason,
        eventCount: runEvents.length,
      }),
      runEvents,
      moduleResults: [],
      finalOutputs: {},
      elapsedMs: Date.now() - startedAt,
      failedStage: "validate",
      nodeTraces,
      trace: {
        currentStage: "validate",
        failedStage: "validate",
        stages: trace,
        nodeTraces,
      },
    };
  }
  trace.push(validateTimer.finish("ok"));
  emitRunEvent("stage_finished", { status: "running", stage: "validate" });

  emitRunEvent("stage_started", { status: "running", stage: "compile" });
  const compileTimer = startStage("compile");
  let compilePlan: GraphCompilePlan;
  try {
    compilePlan = compileGraphPlan(graph);
    trace.push(compileTimer.finish("ok"));
    nodeTraces.push(
      ...compilePlan.nodes.map((planNode) => ({
        nodeId: planNode.nodeId,
        moduleId: planNode.moduleId,
        nodeFingerprint: planNode.nodeFingerprint,
        stage: "compile" as const,
        status: planNode.status ?? "ok",
        capability: planNode.capability,
        sideEffect: planNode.sideEffect,
        isSideEffectNode: planNode.isSideEffectNode,
        hostWriteSummary: planNode.hostWriteSummary,
        hostCommitSummary: planNode.hostCommitSummary,
      })),
    );
    compilePlan = {
      ...compilePlan,
      failedStage: undefined,
      stageTrace: [...trace],
    };
    checkpointCandidate = createCheckpointCandidate({
      runId: context.requestId,
      graphId: graph.id,
      compileFingerprint: compilePlan.compileFingerprint,
      stage: "compile",
      reason: "stage_boundary",
    });
    emitRunEvent("stage_finished", { status: "running", stage: "compile" });
    runEvents.push({
      type: "checkpoint_candidate",
      runId: context.requestId,
      graphId: graph.id,
      status: "running",
      stage: "compile",
      checkpoint: checkpointCandidate,
      timestamp: Date.now(),
    });
    context.onProgress?.(runEvents[runEvents.length - 1]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    trace.push(compileTimer.finish("error", reason));
    trace.push({ stage: "execute", status: "skipped", elapsedMs: 0 });
    const runState = createRunState({
      runId: context.requestId,
      graphId: graph.id,
      startedAt,
      status: "failed",
      currentStage: "compile",
      failedStage: "compile",
    });
    const diagnosticsOverview = buildOverview(runState);
    emitRunEvent("stage_finished", {
      status: "failed",
      stage: "compile",
      error: reason,
      diagnosticsOverview,
    });
    emitRunEvent("run_failed", {
      status: "failed",
      stage: "compile",
      error: reason,
      diagnosticsOverview,
    });
    return {
      ok: false,
      reason,
      requestId: context.requestId,
      ...buildRunObservation({
        graph,
        requestId: context.requestId,
        startedAt,
        status: "failed",
        currentStage: "compile",
        failedStage: "compile",
        diagnosticsOverview,
        errorSummary: reason,
        eventCount: runEvents.length,
      }),
      runEvents,
      moduleResults: [],
      finalOutputs: {},
      elapsedMs: Date.now() - startedAt,
      failedStage: "compile",
      nodeTraces,
      trace: {
        currentStage: "compile",
        failedStage: "compile",
        stages: trace,
        nodeTraces,
      },
    };
  }

  emitRunEvent("stage_started", { status: "running", stage: "execute" });
  const executeTimer = startStage("execute");
  try {
    const execution = await executeCompiledGraph(graph, compilePlan, context);
    if (execution.nodeTraces) {
      nodeTraces.push(...execution.nodeTraces);
    }
    if (execution.runEvents?.length) {
      runEvents.push(...execution.runEvents);
      const reversedEvents = [...execution.runEvents].reverse();
      const lastNodeEvent = reversedEvents.find((event) => event.nodeId);
      if (lastNodeEvent?.nodeId) {
        latestNodeId = lastNodeEvent.nodeId;
        latestNodeModuleId = lastNodeEvent.moduleId;
        latestNodeStatus =
          lastNodeEvent.type === "node_started"
            ? "started"
            : lastNodeEvent.type === "node_failed"
              ? "failed"
              : lastNodeEvent.type === "node_skipped"
                ? "skipped"
                : "finished";
      }
      const lastHeartbeatEvent = reversedEvents.find(
        (event) => event.heartbeat,
      );
      if (lastHeartbeatEvent?.heartbeat) {
        latestHeartbeat = lastHeartbeatEvent.heartbeat;
      }
      const lastPartialOutputEvent = reversedEvents.find(
        (event) => event.partialOutput,
      );
      if (lastPartialOutputEvent?.partialOutput) {
        latestPartialOutput = lastPartialOutputEvent.partialOutput;
      }
      const lastWaitingUserEvent = reversedEvents.find(
        (event) => event.waitingUser,
      );
      if (lastWaitingUserEvent?.waitingUser) {
        waitingUser = lastWaitingUserEvent.waitingUser;
      }
    }
    checkpointCandidate = execution.checkpointCandidate;
    trace.push(executeTimer.finish("ok"));
    compilePlan = {
      ...compilePlan,
      failedStage: undefined,
      stageTrace: [...trace],
    };
    const runState = createRunState({
      runId: context.requestId,
      graphId: graph.id,
      startedAt,
      status: "completed",
      currentStage: "execute",
      compileFingerprint: compilePlan.compileFingerprint,
    });
    const diagnosticsOverview = buildOverview(
      runState,
      execution.dirtySetSummary,
      compilePlan,
    );
    emitRunEvent("stage_finished", {
      status: "completed",
      stage: "execute",
      diagnosticsOverview,
    });
    emitRunEvent("run_completed", {
      status: "completed",
      stage: "execute",
      diagnosticsOverview,
    });
    return {
      ok: true,
      requestId: context.requestId,
      ...buildRunObservation({
        graph,
        requestId: context.requestId,
        startedAt,
        status: "completed",
        currentStage: "execute",
        compileFingerprint: compilePlan.compileFingerprint,
        latestNodeId,
        latestNodeModuleId,
        latestNodeStatus,
        diagnosticsOverview,
        checkpointCandidate,
        latestHeartbeat,
        latestPartialOutput,
        waitingUser,
        eventCount: runEvents.length,
      }),
      runEvents,
      moduleResults: execution.moduleResults,
      finalOutputs: execution.finalOutputs,
      hostWrites: execution.hostWrites,
      hostCommitContracts: execution.hostCommitContracts,
      dirtySetSummary: execution.dirtySetSummary,
      reuseSummary: execution.reuseSummary,
      executionDecisionSummary: execution.executionDecisionSummary,
      elapsedMs: Date.now() - startedAt,
      compilePlan,
      nodeTraces,
      trace: {
        currentStage: "execute",
        stages: trace,
        nodeTraces,
        compilePlan,
        dirtySetSummary: execution.dirtySetSummary,
        reuseSummary: execution.reuseSummary,
        executionDecisionSummary: execution.executionDecisionSummary,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const cancelled = /workflow cancelled by user/i.test(reason);
    trace.push(executeTimer.finish("error", reason));
    compilePlan = {
      ...compilePlan,
      failedStage: "execute",
      stageTrace: [...trace],
    };
    const executeNodeTraces =
      error instanceof GraphExecutionStageError ? (error.nodeTraces ?? []) : [];
    if (error instanceof GraphExecutionStageError && error.runEvents?.length) {
      runEvents.push(...error.runEvents);
      const reversedFailureEvents = [...error.runEvents].reverse();
      const lastHeartbeatEvent = reversedFailureEvents.find(
        (event) => event.heartbeat,
      );
      if (lastHeartbeatEvent?.heartbeat) {
        latestHeartbeat = lastHeartbeatEvent.heartbeat;
      }
      const lastPartialOutputEvent = reversedFailureEvents.find(
        (event) => event.partialOutput,
      );
      if (lastPartialOutputEvent?.partialOutput) {
        latestPartialOutput = lastPartialOutputEvent.partialOutput;
      }
      const lastWaitingUserEvent = reversedFailureEvents.find(
        (event) => event.waitingUser,
      );
      if (lastWaitingUserEvent?.waitingUser) {
        waitingUser = lastWaitingUserEvent.waitingUser;
      }
    }
    const combinedNodeTraces = [...nodeTraces, ...executeNodeTraces];
    const failedNodeTrace = [...executeNodeTraces]
      .reverse()
      .find((item) => item.stage === "execute");
    if (failedNodeTrace?.nodeId) {
      latestNodeId = failedNodeTrace.nodeId;
      latestNodeModuleId = failedNodeTrace.moduleId;
      latestNodeStatus =
        failedNodeTrace.status === "skipped" ? "skipped" : "failed";
    }
    const runState = createRunState({
      runId: context.requestId,
      graphId: graph.id,
      startedAt,
      status: cancelled ? "cancelled" : "failed",
      currentStage: "execute",
      failedStage: "execute",
      compileFingerprint: compilePlan.compileFingerprint,
    });
    const diagnosticsOverview = buildOverview(
      runState,
      error instanceof GraphExecutionStageError
        ? error.dirtySetSummary
        : undefined,
      compilePlan,
    );
    emitRunEvent("stage_finished", {
      status: cancelled ? "cancelled" : "failed",
      stage: "execute",
      error: reason,
      diagnosticsOverview,
    });
    emitRunEvent(cancelled ? "run_cancelled" : "run_failed", {
      status: cancelled ? "cancelled" : "failed",
      stage: "execute",
      error: reason,
      diagnosticsOverview,
    });
    return {
      ok: false,
      reason,
      requestId: context.requestId,
      ...buildRunObservation({
        graph,
        requestId: context.requestId,
        startedAt,
        status: cancelled ? "cancelled" : "failed",
        currentStage: "execute",
        failedStage: "execute",
        compileFingerprint: compilePlan.compileFingerprint,
        latestNodeId,
        latestNodeModuleId,
        latestNodeStatus,
        diagnosticsOverview,
        errorSummary: reason,
        checkpointCandidate,
        latestHeartbeat,
        latestPartialOutput,
        waitingUser,
        eventCount: runEvents.length,
      }),
      runEvents,
      moduleResults:
        error instanceof GraphExecutionStageError ? error.moduleResults : [],
      finalOutputs: {},
      hostWrites: [],
      hostCommitContracts: [],
      dirtySetSummary:
        error instanceof GraphExecutionStageError
          ? error.dirtySetSummary
          : undefined,
      elapsedMs: Date.now() - startedAt,
      failedStage: "execute",
      compilePlan,
      nodeTraces: combinedNodeTraces,
      trace: {
        currentStage: "execute",
        failedStage: "execute",
        failedNodeId:
          error instanceof GraphExecutionStageError
            ? error.failedNodeId
            : undefined,
        stages: trace,
        nodeTraces: combinedNodeTraces,
        compilePlan,
        dirtySetSummary:
          error instanceof GraphExecutionStageError
            ? error.dirtySetSummary
            : undefined,
      },
    };
  }
}

// ── Utility: validate graph before execution ──

export interface GraphValidationError {
  nodeId?: string;
  edgeId?: string;
  portId?: string;
  message: string;
}

function formatGraphValidationErrors(errors: GraphValidationError[]): string {
  return errors
    .map((error) => {
      const refs = [
        error.nodeId ? `node=${error.nodeId}` : null,
        error.edgeId ? `edge=${error.edgeId}` : null,
        error.portId ? `port=${error.portId}` : null,
      ].filter(Boolean);
      return refs.length > 0
        ? `[graph_validation ${refs.join(" ")}] ${error.message}`
        : `[graph_validation] ${error.message}`;
    })
    .join("; ");
}

interface GraphPortValidationContext {
  node: WorkbenchNode;
  port: ModulePortDef;
}

function formatNodeRef(node: WorkbenchNode, label?: string): string {
  return `节点「${label ?? node.moduleId}」(${node.id})`;
}

function formatPortRef(port: ModulePortDef): string {
  return `端口「${port.label}」(${port.id})`;
}

function isPortDataTypeCompatible(
  sourceType: PortDataType,
  targetType: PortDataType,
): boolean {
  if (sourceType === "any" || targetType === "any") return true;
  return sourceType === targetType;
}

function getPortContext(
  node: WorkbenchNode,
  portId: string,
): GraphPortValidationContext | null {
  try {
    const blueprint = getModuleBlueprint(node.moduleId);
    const port = blueprint.ports.find((candidate) => candidate.id === portId);
    if (!port) return null;
    return { node, port };
  } catch {
    return null;
  }
}

export function validateGraph(graph: WorkbenchGraph): GraphValidationError[] {
  const errors: GraphValidationError[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const nodeMap = new Map<string, WorkbenchNode>();
  const incomingEdgeCountByPort = new Map<string, number>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push({
        nodeId: node.id,
        message: `检测到重复的节点 ID: ${node.id}`,
      });
      continue;
    }

    nodeIds.add(node.id);
    nodeMap.set(node.id, node);
  }

  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      errors.push({
        edgeId: edge.id,
        message: `检测到重复的连线 ID: ${edge.id}`,
      });
      continue;
    }

    edgeIds.add(edge.id);
  }

  // Check that all nodes reference valid module IDs
  for (const node of graph.nodes) {
    try {
      getModuleBlueprint(node.moduleId);
    } catch {
      errors.push({
        nodeId: node.id,
        message: `节点(${node.id})引用了未知的模块类型: ${node.moduleId}`,
      });
    }
  }

  // Check that all edge references and port contracts exist
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push({
        edgeId: edge.id,
        message: `连线(${edge.id})引用了不存在的源节点: ${edge.source}`,
      });
    }
    if (!nodeIds.has(edge.target)) {
      errors.push({
        edgeId: edge.id,
        message: `连线(${edge.id})引用了不存在的目标节点: ${edge.target}`,
      });
    }

    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (!sourceNode || !targetNode) continue;

    const sourcePortCtx = getPortContext(sourceNode, edge.sourcePort);
    if (!sourcePortCtx) {
      errors.push({
        edgeId: edge.id,
        nodeId: sourceNode.id,
        portId: edge.sourcePort,
        message: `${formatNodeRef(sourceNode)} 的源端口(${edge.sourcePort})不存在`,
      });
      continue;
    }

    const targetPortCtx = getPortContext(targetNode, edge.targetPort);
    if (!targetPortCtx) {
      errors.push({
        edgeId: edge.id,
        nodeId: targetNode.id,
        portId: edge.targetPort,
        message: `${formatNodeRef(targetNode)} 的目标端口(${edge.targetPort})不存在`,
      });
      continue;
    }

    if (sourcePortCtx.port.direction !== "out") {
      errors.push({
        edgeId: edge.id,
        nodeId: sourceNode.id,
        portId: sourcePortCtx.port.id,
        message: `${formatNodeRef(sourceNode)} 的 ${formatPortRef(sourcePortCtx.port)} 不是输出端口，不能作为连线源端口`,
      });
    }

    if (targetPortCtx.port.direction !== "in") {
      errors.push({
        edgeId: edge.id,
        nodeId: targetNode.id,
        portId: targetPortCtx.port.id,
        message: `${formatNodeRef(targetNode)} 的 ${formatPortRef(targetPortCtx.port)} 不是输入端口，不能作为连线目标端口`,
      });
    }

    if (
      sourcePortCtx.port.direction === "out" &&
      targetPortCtx.port.direction === "in" &&
      !isPortDataTypeCompatible(
        sourcePortCtx.port.dataType,
        targetPortCtx.port.dataType,
      )
    ) {
      errors.push({
        edgeId: edge.id,
        nodeId: targetNode.id,
        portId: targetPortCtx.port.id,
        message: `连线(${edge.id})类型不兼容：${formatNodeRef(sourceNode)} 的 ${formatPortRef(sourcePortCtx.port)} 输出类型为 ${sourcePortCtx.port.dataType}，但 ${formatNodeRef(targetNode)} 的 ${formatPortRef(targetPortCtx.port)} 需要 ${targetPortCtx.port.dataType}`,
      });
    }

    const incomingKey = `${targetNode.id}:${targetPortCtx.port.id}`;
    incomingEdgeCountByPort.set(
      incomingKey,
      (incomingEdgeCountByPort.get(incomingKey) ?? 0) + 1,
    );
  }

  for (const node of graph.nodes) {
    try {
      const bp = getModuleBlueprint(node.moduleId);
      const inputPorts = bp.ports.filter((p) => p.direction === "in");

      for (const port of inputPorts) {
        const connectionCount =
          incomingEdgeCountByPort.get(`${node.id}:${port.id}`) ?? 0;

        if (!port.optional && connectionCount === 0) {
          errors.push({
            nodeId: node.id,
            portId: port.id,
            message: `${formatNodeRef(node, bp.label)} 的必要输入 ${formatPortRef(port)} 未连接`,
          });
        }

        if (!port.multiple && connectionCount > 1) {
          errors.push({
            nodeId: node.id,
            portId: port.id,
            message: `${formatNodeRef(node, bp.label)} 的输入 ${formatPortRef(port)} 不允许多入边，但当前检测到 ${connectionCount} 条入边`,
          });
        }
      }
    } catch {
      // Already reported above
    }
  }

  // Check for cycles
  try {
    topologicalSort(graph.nodes, graph.edges);
  } catch (error) {
    errors.push({
      message: error instanceof Error ? error.message : "图中存在循环依赖",
    });
  }

  return errors;
}
