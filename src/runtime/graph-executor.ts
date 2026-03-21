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
  GraphExecutionResult,
  GraphExecutionStage,
  GraphNodeCacheKeyFacts,
  GraphNodeDirtyReason,
  GraphNodeInputSource,
  GraphNodeReuseReason,
  GraphNodeReuseVerdict,
  GraphReuseSummary,
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

function createRunState(
  requestId: string,
  startedAt: number,
  status: "completed" | "failed",
  failedStage?: GraphExecutionStage,
  compileFingerprint?: string,
) {
  const completedAt = Date.now();
  return {
    runId: requestId,
    status,
    failedStage,
    startedAt,
    completedAt,
    elapsedMs: completedAt - startedAt,
    ...(compileFingerprint ? { compileFingerprint } : {}),
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

  constructor(
    stage: GraphExecutionStage,
    message: string,
    moduleResults: ModuleExecutionResult[],
    nodeTraces: NonNullable<GraphExecutionResult["trace"]>["nodeTraces"],
    failedNodeId?: string,
    dirtySetSummary?: GraphDirtySetSummary,
  ) {
    super(message);
    this.name = "GraphExecutionStageError";
    this.stage = stage;
    this.moduleResults = moduleResults;
    this.nodeTraces = nodeTraces;
    this.failedNodeId = failedNodeId;
    this.dirtySetSummary = dirtySetSummary;
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
const REUSE_FINGERPRINT_VERSION = 1;
const REUSE_ELIGIBLE_CAPABILITIES = new Set<WorkbenchCapability>(["pure"]);

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
    const nodeTraceBase = {
      ...createNodeTraceBase(planNode, nodeStart, inputKeys),
      inputFingerprint,
      inputSources,
      isDirty,
      dirtyReason,
      cacheKeyFacts,
      reuseVerdict,
    };

    context.onProgress?.({
      phase: "module_executing",
      request_id: context.requestId,
      module_id: node.moduleId,
      node_id: node.id,
      stage: "execute",
      message: `正在执行模块「${getModuleBlueprint(node.moduleId).label}」…`,
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

  return {
    moduleResults,
    nodeTraces,
    finalOutputs: terminalOutputs,
    hostWrites,
    hostCommitContracts,
    dirtySetSummary: createDirtySetSummary(dirtySetEntries),
    reuseSummary: createReuseSummary(reuseVerdicts),
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

  const validateTimer = startStage("validate");
  const validationErrors = validateGraph(graph);
  if (validationErrors.length > 0) {
    trace.push(
      validateTimer.finish(
        "error",
        formatGraphValidationErrors(validationErrors),
      ),
    );
    trace.push({ stage: "compile", status: "skipped", elapsedMs: 0 });
    trace.push({ stage: "execute", status: "skipped", elapsedMs: 0 });
    return {
      ok: false,
      reason: formatGraphValidationErrors(validationErrors),
      requestId: context.requestId,
      runState: createRunState(
        context.requestId,
        startedAt,
        "failed",
        "validate",
      ),
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
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    trace.push(compileTimer.finish("error", reason));
    trace.push({ stage: "execute", status: "skipped", elapsedMs: 0 });
    return {
      ok: false,
      reason,
      requestId: context.requestId,
      runState: createRunState(
        context.requestId,
        startedAt,
        "failed",
        "compile",
      ),
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

  const executeTimer = startStage("execute");
  try {
    const execution = await executeCompiledGraph(graph, compilePlan, context);
    if (execution.nodeTraces) {
      nodeTraces.push(...execution.nodeTraces);
    }
    trace.push(executeTimer.finish("ok"));
    compilePlan = {
      ...compilePlan,
      failedStage: undefined,
      stageTrace: [...trace],
    };
    return {
      ok: true,
      requestId: context.requestId,
      runState: createRunState(
        context.requestId,
        startedAt,
        "completed",
        undefined,
        compilePlan.compileFingerprint,
      ),
      moduleResults: execution.moduleResults,
      finalOutputs: execution.finalOutputs,
      hostWrites: execution.hostWrites,
      hostCommitContracts: execution.hostCommitContracts,
      dirtySetSummary: execution.dirtySetSummary,
      reuseSummary: execution.reuseSummary,
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
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    trace.push(executeTimer.finish("error", reason));
    compilePlan = {
      ...compilePlan,
      failedStage: "execute",
      stageTrace: [...trace],
    };
    const executeNodeTraces =
      error instanceof GraphExecutionStageError ? (error.nodeTraces ?? []) : [];
    const combinedNodeTraces = [...nodeTraces, ...executeNodeTraces];
    return {
      ok: false,
      reason,
      requestId: context.requestId,
      runState: createRunState(
        context.requestId,
        startedAt,
        "failed",
        "execute",
        compilePlan.compileFingerprint,
      ),
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
