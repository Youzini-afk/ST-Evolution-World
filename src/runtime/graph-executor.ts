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

import {
  getModuleBlueprint,
  getModuleExplainContract,
  getModuleMetadataSummary,
  getModuleMetadataSurface,
} from "../ui/components/graph/module-registry";
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
  GraphNodeDiagnosticsView,
  GraphNodeDirtyReason,
  GraphNodeExecutionDecision,
  GraphNodeExecutionDecisionReason,
  GraphNodeInputMissingReason,
  GraphNodeInputResolutionArtifactV1,
  GraphNodeInputResolutionNodeRecordV1,
  GraphNodeInputResolutionStatus,
  GraphNodeInputSource,
  GraphNodeInputSourceKind,
  GraphNodeInputValueSummary,
  GraphNodeReuseReason,
  GraphNodeReuseVerdict,
  GraphReuseSummary,
  GraphRunArtifact,
  GraphRunBlockingContract,
  GraphRunBlockingInputRequirementType,
  GraphRunBlockingReason,
  GraphRunCheckpointSummary,
  GraphRunConstraintSummaryViewModel,
  GraphRunContinuationContract,
  GraphRunContinuationHandlingPolicy,
  GraphRunContinuationVerdict,
  GraphRunControlPreconditionItem,
  GraphRunControlPreconditionsContract,
  GraphRunDiagnosticsOverview,
  GraphRunEvent,
  GraphRunManualInputSlotSchema,
  GraphRunNonContinuableReasonKind,
  GraphRunPhase,
  GraphRunRecoveryEligibilityFact,
  GraphRunRecoveryEvidenceFact,
  GraphRunRecoveryPrerequisiteFact,
  GraphRunStatus,
  GraphRunTerminalOutcome,
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
import { createGraphCompileArtifactEnvelope } from "./graph-compile-artifact-codec";
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

function inferBlockingInputRequirementType(
  waitingUser?: GraphRunArtifact["waitingUser"],
): GraphRunBlockingInputRequirementType {
  const reason = waitingUser?.reason?.trim().toLowerCase();
  if (!reason) {
    return "unknown";
  }
  if (/选择|select|choice|option/.test(reason)) {
    return "selection";
  }
  if (/输入|text|reply|answer/.test(reason)) {
    return "text_input";
  }
  if (/确认|confirm|approval|consent|继续/.test(reason)) {
    return "confirmation";
  }
  return "unknown";
}

function deriveRecoveryPrerequisites(params: {
  status: GraphRunStatus;
  waitingUser?: GraphRunArtifact["waitingUser"];
  checkpointCandidate?: GraphRunCheckpointSummary;
}): GraphRunRecoveryPrerequisiteFact[] {
  const facts: GraphRunRecoveryPrerequisiteFact[] = [];
  if (params.status === "waiting_user") {
    facts.push({
      source: "waiting_user",
      code: "user_input_required",
      label: "需要人工输入事实",
      detail:
        params.waitingUser?.reason?.trim() ||
        "检测到 waiting_user 只读阻塞事实。",
    });
    facts.push({
      source: "status",
      code: "run_not_terminal",
      label: "运行尚未终局",
      detail: "当前运行仍停留在只读阻塞态。",
    });
  }
  if (params.checkpointCandidate) {
    facts.push({
      source: "checkpoint_candidate",
      code: "checkpoint_observed",
      label: "已观测到 checkpoint candidate",
      detail: "仅表示存在检查点事实，不表示系统已支持恢复动作。",
    });
  }
  if (
    params.status === "failed" ||
    params.status === "cancelled" ||
    params.status === "completed"
  ) {
    facts.push({
      source: "terminal_state",
      code: "terminal_state",
      label: "运行已终局",
      detail: "终局状态不构成可恢复阻塞承诺。",
    });
  }
  if (facts.length === 0) {
    facts.push({
      source: "unknown",
      code: "unknown",
      label: "恢复前提未知",
      detail: "当前只读观测不足以推断更多恢复前提事实。",
    });
  }
  return facts;
}

function deriveBlockingContract(params: {
  status: GraphRunStatus;
  blockingReason?: GraphRunBlockingReason;
  waitingUser?: GraphRunArtifact["waitingUser"];
  checkpointCandidate?: GraphRunCheckpointSummary;
}): GraphRunBlockingContract | undefined {
  if (params.status !== "waiting_user" || !params.blockingReason) {
    return undefined;
  }
  const inputType = inferBlockingInputRequirementType(params.waitingUser);
  const detail = params.waitingUser?.reason?.trim();
  return {
    kind: "waiting_user",
    reason: params.blockingReason,
    requiresHumanInput: true,
    inputRequirement: {
      required: true,
      type: inputType,
      ...(detail ? { detail } : {}),
    },
    recoveryPrerequisites: deriveRecoveryPrerequisites({
      status: params.status,
      waitingUser: params.waitingUser,
      checkpointCandidate: params.checkpointCandidate,
    }),
  };
}

function deriveRecoveryEligibilityFact(params: {
  status: GraphRunStatus;
  waitingUser?: GraphRunArtifact["waitingUser"];
  checkpointCandidate?: GraphRunCheckpointSummary;
}): GraphRunRecoveryEligibilityFact {
  if (params.status === "cancelled" || params.status === "failed") {
    return {
      status: "ineligible",
      source: "terminal_state",
      label: "当前不具备恢复资格事实",
      detail: "cancelled / failed 仅表示终局结果，不应视为可恢复阻塞。",
    };
  }
  if (params.status === "completed") {
    return {
      status: "ineligible",
      source: "terminal_state",
      label: "当前不具备恢复资格事实",
      detail: "completed 为终局结果，不属于恢复阻塞。",
    };
  }
  if (params.checkpointCandidate) {
    return {
      status: "eligible",
      source: "checkpoint_candidate",
      label: "存在恢复资格事实",
      detail:
        "仅基于 checkpoint candidate 的只读资格归因，不代表系统已支持恢复。",
    };
  }
  if (params.status === "waiting_user" || params.waitingUser) {
    return {
      status: "unknown",
      source: "waiting_user",
      label: "恢复资格未知",
      detail: "waiting_user 仅说明阻塞与输入需求，不直接承诺恢复能力。",
    };
  }
  return {
    status: "unknown",
    source: "unknown",
    label: "恢复资格未知",
    detail: "当前缺少足够的只读事实。",
  };
}

function deriveRecoveryEvidence(params: {
  status: GraphRunStatus;
  waitingUser?: GraphRunArtifact["waitingUser"];
  checkpointCandidate?: GraphRunCheckpointSummary;
}): GraphRunRecoveryEvidenceFact {
  if (
    params.status === "completed" ||
    params.status === "failed" ||
    params.status === "cancelled"
  ) {
    return {
      source: "terminal_state",
      trust: "strong",
      label: "终局状态已观察",
      detail: "终局状态只能作为 system-side not continuable 的只读事实来源。",
    };
  }
  if (params.checkpointCandidate) {
    return {
      source: "checkpoint_candidate",
      trust: "limited",
      label: "checkpoint candidate 已观察",
      detail: "checkpoint candidate 仅提升恢复资格来源可信度，不构成恢复承诺。",
    };
  }
  if (params.status === "waiting_user" || params.waitingUser) {
    return {
      source: "waiting_user",
      trust: "weak",
      label: "外部输入阻塞已观察",
      detail: "waiting_user 只说明观测到外部输入需求，系统侧不承诺自动继续。",
    };
  }
  return {
    source: "unknown",
    trust: "unknown",
    label: "恢复证据来源未知",
    detail: "当前只读观测不足以形成更高可信度的来源判断。",
  };
}

function deriveManualInputSlotSchema(params: {
  status: GraphRunStatus;
  waitingUser?: GraphRunArtifact["waitingUser"];
}): GraphRunManualInputSlotSchema[] {
  if (params.status !== "waiting_user" || !params.waitingUser) {
    return [];
  }
  const inferredType = inferBlockingInputRequirementType(params.waitingUser);
  const valueType =
    inferredType === "confirmation"
      ? "confirmation"
      : inferredType === "text_input"
        ? "text"
        : inferredType === "selection"
          ? "selection"
          : "unknown";
  return [
    {
      key: "observed_waiting_user_input",
      label: "观察到的人工输入槽位",
      valueType,
      required: true,
      ...(params.waitingUser.reason?.trim()
        ? { description: params.waitingUser.reason.trim() }
        : {}),
      source: "waiting_user",
    },
  ];
}

function deriveContinuationHandlingPolicy(params: {
  status: GraphRunStatus;
  waitingUser?: GraphRunArtifact["waitingUser"];
  checkpointCandidate?: GraphRunCheckpointSummary;
}): GraphRunContinuationHandlingPolicy {
  if (
    params.status === "completed" ||
    params.status === "failed" ||
    params.status === "cancelled"
  ) {
    return {
      kind: "system_side_not_continuable",
      label: "系统侧判定不可继续",
      detail: "终局状态只保留只读结果解释，不再对继续性作出积极推断。",
    };
  }
  if (params.status === "waiting_user" || params.waitingUser) {
    return {
      kind: "external_input_observed",
      label: "已观察到外部输入阻塞",
      detail: "waiting_user 仅表示外部输入需求被观察到，系统侧不承诺自动继续。",
    };
  }
  if (params.checkpointCandidate) {
    return {
      kind: "checkpoint_evidence_only",
      label: "仅存在 checkpoint 证据",
      detail: "checkpoint candidate 只补充资格来源说明，不转化为恢复承诺。",
    };
  }
  return {
    kind: "observe_only",
    label: "仅保留只读观察",
    detail: "当前只读模型不声明任何继续动作能力。",
  };
}

function deriveContinuationVerdict(params: {
  status: GraphRunStatus;
  waitingUser?: GraphRunArtifact["waitingUser"];
  checkpointCandidate?: GraphRunCheckpointSummary;
}): GraphRunContinuationVerdict {
  if (params.status === "completed") {
    return {
      status: "not_continuable",
      source: "terminal_state",
      label: "终局后不可继续",
      detail: "completed 为 system-side not continuable 的保守结论。",
    };
  }
  if (params.status === "failed") {
    return {
      status: "not_continuable",
      source: "terminal_state",
      label: "失败后不可继续",
      detail: "failed 为 system-side not continuable 的保守结论。",
    };
  }
  if (params.status === "cancelled") {
    return {
      status: "not_continuable",
      source: "terminal_state",
      label: "取消后不可继续",
      detail: "cancelled 为 system-side not continuable 的保守结论。",
    };
  }
  if (params.status === "waiting_user" || params.waitingUser) {
    return {
      status: "blocked_by_external_input",
      source: "waiting_user",
      label: "继续性受外部输入阻塞",
      detail: "只观察到外部输入需求，系统侧不承诺自动继续。",
    };
  }
  if (params.checkpointCandidate) {
    return {
      status: "unknown",
      source: "checkpoint_candidate",
      label: "继续性未知",
      detail: "checkpoint candidate 仅说明存在只读证据，不能推出恢复承诺。",
    };
  }
  return {
    status: "unknown",
    source: "unknown",
    label: "继续性未知",
    detail: "当前缺少足够只读事实，已保守降级。",
  };
}

function deriveContinuationContract(params: {
  status: GraphRunStatus;
  waitingUser?: GraphRunArtifact["waitingUser"];
  checkpointCandidate?: GraphRunCheckpointSummary;
}): GraphRunContinuationContract {
  return {
    handlingPolicy: deriveContinuationHandlingPolicy(params),
    verdict: deriveContinuationVerdict(params),
    recoveryEvidence: deriveRecoveryEvidence(params),
    manualInputSlots: deriveManualInputSlotSchema(params),
  };
}

function deriveControlPreconditionsContract(params: {
  status: GraphRunStatus;
  waitingUser?: GraphRunArtifact["waitingUser"];
  checkpointCandidate?: GraphRunCheckpointSummary;
}): GraphRunControlPreconditionsContract {
  const items: GraphRunControlPreconditionItem[] = [];
  const pushItem = (
    item: GraphRunControlPreconditionItem,
  ): GraphRunControlPreconditionItem => {
    items.push(item);
    return item;
  };

  pushItem({
    kind: "external_input_observed",
    status:
      params.status === "waiting_user" || params.waitingUser
        ? "satisfied"
        : params.status === "completed" ||
            params.status === "failed" ||
            params.status === "cancelled"
          ? "unsatisfied"
          : "unknown",
    label: "外部输入阻塞事实",
    detail:
      params.status === "waiting_user" || params.waitingUser
        ? params.waitingUser?.reason?.trim() ||
          "已观察到 waiting_user，只能说明当前存在外部输入需求。"
        : params.status === "completed" ||
            params.status === "failed" ||
            params.status === "cancelled"
          ? "终局状态下不存在待处理的 waiting_user 外部输入阻塞事实。"
          : "当前缺少稳定 waiting_user 事实，已保守降级为未知。",
    sourceKind:
      params.status === "waiting_user" || params.waitingUser
        ? "observed"
        : params.status === "completed" ||
            params.status === "failed" ||
            params.status === "cancelled"
          ? "observed"
          : "inferred",
    conservativeSourceKind:
      params.status === "waiting_user" || params.waitingUser
        ? "observed"
        : "inferred",
  });

  pushItem({
    kind: "checkpoint_candidate_observed",
    status: params.checkpointCandidate ? "satisfied" : "unknown",
    label: "checkpoint candidate 事实",
    detail: params.checkpointCandidate
      ? "已观察到 checkpoint candidate；该事实仅用于约束说明，不构成恢复承诺。"
      : "当前未观察到 checkpoint candidate，不能据此暗示存在恢复能力。",
    sourceKind: params.checkpointCandidate ? "observed" : "inferred",
    conservativeSourceKind: params.checkpointCandidate
      ? "observed"
      : "inferred",
  });

  pushItem({
    kind: "run_not_terminal",
    status:
      params.status === "completed" ||
      params.status === "failed" ||
      params.status === "cancelled"
        ? "unsatisfied"
        : params.status === "waiting_user" ||
            params.status === "running" ||
            params.status === "streaming" ||
            params.status === "queued" ||
            params.status === "cancelling"
          ? "satisfied"
          : "unknown",
    label: "运行未终局",
    detail:
      params.status === "completed" ||
      params.status === "failed" ||
      params.status === "cancelled"
        ? "当前运行已终局，不能再把未终局视为控制动作前提。"
        : "当前运行仍处于终局前阶段，该事实只说明状态位置，不代表已有继续动作。",
    sourceKind: "observed",
    conservativeSourceKind: "observed",
  });

  pushItem({
    kind: "continuation_capability_inference",
    status: "unknown",
    label: "继续能力可推断性",
    detail:
      "当前仓库仅建模只读解释层，无法从现有事实推出宿主已具备 continuation / resume 能力。",
    sourceKind: "host_limited",
    conservativeSourceKind: "host_limited",
  });

  pushItem({
    kind: "control_action_surface_inference",
    status: "unknown",
    label: "控制动作入口可推断性",
    detail: "当前工作台只展示约束解释，无法从现有事实推出已存在控制动作入口。",
    sourceKind: "host_limited",
    conservativeSourceKind: "host_limited",
  });

  let nonContinuableReasonKind: GraphRunNonContinuableReasonKind | undefined;
  if (params.status === "completed") {
    nonContinuableReasonKind = "terminal_completed";
  } else if (params.status === "failed") {
    nonContinuableReasonKind = "terminal_failed";
  } else if (params.status === "cancelled") {
    nonContinuableReasonKind = "terminal_cancelled";
  } else if (params.status === "waiting_user" || params.waitingUser) {
    nonContinuableReasonKind = params.checkpointCandidate
      ? "continuation_capability_not_inferred"
      : "checkpoint_not_observed";
  } else if (params.checkpointCandidate) {
    nonContinuableReasonKind = "control_action_surface_not_inferred";
  } else {
    nonContinuableReasonKind = "insufficient_evidence";
  }

  return {
    items,
    nonContinuableReasonKind,
    explanation:
      "当前仅输出控制前提解释与只读事实边界；这些原因只表示无法从当前观测推出 continuation / resume 能力，不构成恢复承诺，也不表示控制动作系统已经存在。",
  };
}

function deriveConstraintSummary(): GraphRunConstraintSummaryViewModel {
  return {
    heading: "控制前提说明（只读）",
    explanation:
      "当前工作台展示的是 control preconditions contract / constraint explanation 的只读解释层，用于说明为何仍无法从当前事实推出 continuation / resume 能力。",
    disclaimer: "它不是恢复承诺，也不是 waiting_user 交互恢复协议。",
    capabilityBoundary:
      "它不表示 control edge、control node、resume API 或任务中心已经存在。",
  };
}

function deriveRunReadModel(params: {
  status: GraphRunStatus;
  currentStage?: GraphExecutionStage;
  failedStage?: GraphExecutionStage;
  waitingUser?: GraphRunArtifact["waitingUser"];
  checkpointCandidate?: GraphRunCheckpointSummary;
}): {
  phase: GraphRunPhase;
  phaseLabel: string;
  blockingReason?: GraphRunBlockingReason;
  blockingContract?: GraphRunBlockingContract;
  continuationContract: GraphRunContinuationContract;
  controlPreconditionsContract: GraphRunControlPreconditionsContract;
  constraintSummary: GraphRunConstraintSummaryViewModel;
  recoveryEligibility: GraphRunRecoveryEligibilityFact;
  terminalOutcome?: GraphRunTerminalOutcome;
} {
  const stageLabel =
    params.currentStage === "validate"
      ? "校验"
      : params.currentStage === "compile"
        ? "编译"
        : params.currentStage === "execute"
          ? "执行"
          : "运行";

  const finalizeReadModel = (readModel: {
    phase: GraphRunPhase;
    phaseLabel: string;
    blockingReason?: GraphRunBlockingReason;
    terminalOutcome?: GraphRunTerminalOutcome;
  }) => {
    const blockingContract = deriveBlockingContract({
      status: params.status,
      blockingReason: readModel.blockingReason,
      waitingUser: params.waitingUser,
      checkpointCandidate: params.checkpointCandidate,
    });
    return {
      ...readModel,
      ...(blockingContract ? { blockingContract } : {}),
      continuationContract: deriveContinuationContract({
        status: params.status,
        waitingUser: params.waitingUser,
        checkpointCandidate: params.checkpointCandidate,
      }),
      controlPreconditionsContract: deriveControlPreconditionsContract({
        status: params.status,
        waitingUser: params.waitingUser,
        checkpointCandidate: params.checkpointCandidate,
      }),
      constraintSummary: deriveConstraintSummary(),
      recoveryEligibility: deriveRecoveryEligibilityFact({
        status: params.status,
        waitingUser: params.waitingUser,
        checkpointCandidate: params.checkpointCandidate,
      }),
    };
  };

  if (params.status === "queued") {
    return finalizeReadModel({
      phase: "queued",
      phaseLabel: "排队中",
    });
  }

  if (params.status === "completed") {
    return finalizeReadModel({
      phase: "terminal",
      phaseLabel: "已完成",
      terminalOutcome: "completed",
    });
  }

  if (params.status === "failed") {
    return finalizeReadModel({
      phase: "terminal",
      phaseLabel: "已失败",
      terminalOutcome: "failed",
    });
  }

  if (params.status === "cancelled") {
    return finalizeReadModel({
      phase: "terminal",
      phaseLabel: "已取消",
      terminalOutcome: "cancelled",
    });
  }

  if (params.status === "cancelling") {
    return finalizeReadModel({
      phase: "blocked",
      phaseLabel: "取消中",
      blockingReason: {
        category: "cancellation",
        code: "cancelling",
        label: "正在取消",
        detail: "运行收到取消信号，等待当前串行路径收束。",
      },
    });
  }

  if (params.status === "waiting_user") {
    const detail = params.waitingUser?.reason?.trim();
    return finalizeReadModel({
      phase: "blocked",
      phaseLabel: "等待用户",
      blockingReason: {
        category: "waiting_user",
        code: "waiting_user",
        label: "等待用户输入",
        ...(detail ? { detail } : {}),
      },
    });
  }

  if (params.status === "streaming") {
    return finalizeReadModel({
      phase: "executing",
      phaseLabel: `${stageLabel}中（流式）`,
    });
  }

  if (params.currentStage === "validate") {
    return finalizeReadModel({
      phase: "validating",
      phaseLabel: "校验中",
    });
  }

  if (params.currentStage === "compile") {
    return finalizeReadModel({
      phase: "compiling",
      phaseLabel: "编译中",
    });
  }

  if (params.currentStage === "execute") {
    return finalizeReadModel({
      phase: "executing",
      phaseLabel: "执行中",
    });
  }

  return finalizeReadModel({
    phase: "finishing",
    phaseLabel: `${stageLabel}收束中`,
  });
}

function createRunState(params: {
  runId: string;
  graphId: string;
  startedAt: number;
  status: GraphRunStatus;
  currentStage?: GraphExecutionStage;
  failedStage?: GraphExecutionStage;
  compileFingerprint?: string;
  waitingUser?: GraphRunArtifact["waitingUser"];
  checkpointCandidate?: GraphRunCheckpointSummary;
}) {
  const completedAt = Date.now();
  const readModel = deriveRunReadModel({
    status: params.status,
    currentStage: params.currentStage,
    failedStage: params.failedStage,
    waitingUser: params.waitingUser,
    checkpointCandidate: params.checkpointCandidate,
  });
  return {
    runId: params.runId,
    graphId: params.graphId,
    status: params.status,
    phase: readModel.phase,
    phaseLabel: readModel.phaseLabel,
    ...(readModel.blockingReason
      ? { blockingReason: readModel.blockingReason }
      : {}),
    ...(readModel.blockingContract
      ? { blockingContract: readModel.blockingContract }
      : {}),
    continuationContract: readModel.continuationContract,
    controlPreconditionsContract: readModel.controlPreconditionsContract,
    constraintSummary: readModel.constraintSummary,
    recoveryEligibility: readModel.recoveryEligibility,
    ...(readModel.terminalOutcome
      ? { terminalOutcome: readModel.terminalOutcome }
      : {}),
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
  const readModel = deriveRunReadModel({
    status: params.status,
    currentStage: params.currentStage,
    failedStage: params.failedStage,
    waitingUser: params.waitingUser,
    checkpointCandidate: params.checkpointCandidate,
  });
  return {
    runId: params.runId,
    graphId: params.graphId,
    status: params.status,
    phase: readModel.phase,
    phaseLabel: readModel.phaseLabel,
    ...(readModel.blockingReason
      ? { blockingReason: readModel.blockingReason }
      : {}),
    ...(readModel.blockingContract
      ? { blockingContract: readModel.blockingContract }
      : {}),
    continuationContract: readModel.continuationContract,
    controlPreconditionsContract: readModel.controlPreconditionsContract,
    constraintSummary: readModel.constraintSummary,
    recoveryEligibility: readModel.recoveryEligibility,
    ...(readModel.terminalOutcome
      ? { terminalOutcome: readModel.terminalOutcome }
      : {}),
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
      waitingUser: params.waitingUser,
      checkpointCandidate: params.checkpointCandidate,
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
  const capability = getNodeCapability(node);
  if (capability !== "writes_host") {
    return undefined;
  }
  const metadataSummary = getModuleMetadataSummary(node.moduleId);
  const metadataHostWriteHint = metadataSummary?.semantic.hostWriteHint;
  if (metadataHostWriteHint) {
    return metadataHostWriteHint;
  }
  const blueprint = getModuleBlueprint(node.moduleId);
  return blueprint.runtimeMeta?.hostTargetHint;
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

function createValueSummary(value: unknown): GraphNodeInputValueSummary {
  const valueType: GraphNodeInputValueSummary["valueType"] =
    value === null
      ? "null"
      : value === undefined
        ? "undefined"
        : Array.isArray(value)
          ? "array"
          : typeof value === "string"
            ? "string"
            : typeof value === "number"
              ? "number"
              : typeof value === "boolean"
                ? "boolean"
                : typeof value === "object"
                  ? "object"
                  : "unknown";
  const rawPreview =
    value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : value === null
            ? "null"
            : stableSerialize(value);
  const valuePreview = rawPreview.slice(0, 160);

  return {
    valuePreview,
    valueFingerprint: hashFingerprint(
      stableSerialize({
        scope: "graph_node_input_value_summary",
        version: 1,
        value,
      }),
    ),
    valueType,
    isTruncated: rawPreview.length > valuePreview.length,
  };
}

function resolveInputSourceKind(params: {
  hasObservedEdge: boolean;
  hasContextValue: boolean;
  isDefaulted: boolean;
  hasValue: boolean;
}): GraphNodeInputSourceKind {
  if (params.hasObservedEdge) {
    return "edge";
  }
  if (params.hasContextValue) {
    return "context";
  }
  if (params.isDefaulted) {
    return "default";
  }
  if (params.hasValue) {
    return "constant";
  }
  return "unknown";
}

function resolveInputResolutionStatus(params: {
  hasValue: boolean;
  isDefaulted: boolean;
  hasObservedEdge: boolean;
  hasContextValue: boolean;
}): GraphNodeInputResolutionStatus {
  if (params.isDefaulted) {
    return "defaulted";
  }
  if (params.hasValue || params.hasObservedEdge || params.hasContextValue) {
    return "resolved";
  }
  return "missing";
}

function resolveInputMissingReason(params: {
  status: GraphNodeInputResolutionStatus;
  hasConfiguredEdge: boolean;
  hasObservedEdge: boolean;
  hasValue: boolean;
}): GraphNodeInputMissingReason | undefined {
  if (params.status !== "missing") {
    return undefined;
  }
  if (params.hasConfiguredEdge && !params.hasObservedEdge) {
    return "upstream_unavailable";
  }
  if (params.hasConfiguredEdge && params.hasObservedEdge && !params.hasValue) {
    return "value_unavailable";
  }
  return "no_observed_source";
}

function createNodeInputResolutionRecord(params: {
  node: WorkbenchNode;
  planNode: GraphCompilePlanNode;
  graph: WorkbenchGraph;
  inputs: Record<string, any>;
  inputSources: GraphNodeInputSource[];
  stableContextInputs?: Record<string, unknown>;
}): GraphNodeInputResolutionNodeRecordV1 {
  const blueprint = getModuleBlueprint(params.node.moduleId);
  const declaredInputKeys = new Set(
    blueprint.ports
      .filter((port) => port.direction === "in")
      .map((port) => port.id),
  );
  for (const key of Object.keys(params.inputs)) {
    declaredInputKeys.add(key);
  }
  for (const key of Object.keys(params.stableContextInputs ?? {})) {
    declaredInputKeys.add(key);
  }
  for (const source of params.inputSources) {
    declaredInputKeys.add(source.targetPort);
  }

  const inputs = [...declaredInputKeys]
    .sort((left, right) => left.localeCompare(right))
    .map((inputKey) => {
      const port = blueprint.ports.find(
        (candidate) =>
          candidate.direction === "in" && candidate.id === inputKey,
      );
      const hasValue = Object.prototype.hasOwnProperty.call(
        params.inputs,
        inputKey,
      );
      const inputValue = hasValue ? params.inputs[inputKey] : undefined;
      const observedSources = params.inputSources.filter(
        (source) => source.targetPort === inputKey,
      );
      const hasObservedEdge = observedSources.length > 0;
      const hasConfiguredEdge = params.graph.edges.some(
        (edge) =>
          edge.target === params.node.id && edge.targetPort === inputKey,
      );
      const hasContextValue = Boolean(
        params.stableContextInputs &&
        Object.prototype.hasOwnProperty.call(
          params.stableContextInputs,
          inputKey,
        ),
      );
      const contextValue = hasContextValue
        ? params.stableContextInputs?.[inputKey]
        : undefined;
      const isDefaulted =
        !hasValue &&
        !hasObservedEdge &&
        !hasContextValue &&
        Boolean(port?.optional);
      const status = resolveInputResolutionStatus({
        hasValue,
        isDefaulted,
        hasObservedEdge,
        hasContextValue,
      });
      const sourceKind = resolveInputSourceKind({
        hasObservedEdge,
        hasContextValue,
        isDefaulted,
        hasValue,
      });
      const primaryObservedSource = observedSources[0];
      const resolvedValue = hasValue
        ? inputValue
        : hasContextValue
          ? contextValue
          : undefined;
      const missingReason = resolveInputMissingReason({
        status,
        hasConfiguredEdge,
        hasObservedEdge,
        hasValue,
      });

      return {
        inputKey,
        resolutionStatus: status,
        sourceKind,
        ...(primaryObservedSource?.sourceNodeId
          ? { sourceNodeId: primaryObservedSource.sourceNodeId }
          : {}),
        ...(primaryObservedSource?.sourcePort
          ? { sourcePort: primaryObservedSource.sourcePort }
          : {}),
        isDefaulted,
        ...(missingReason ? { missingReason } : {}),
        ...(status !== "missing" && status !== "unknown"
          ? { valueSummary: createValueSummary(resolvedValue) }
          : {}),
      };
    });

  return {
    nodeId: params.node.id,
    moduleId: params.node.moduleId,
    nodeFingerprint: params.planNode.nodeFingerprint,
    inputs,
  };
}

function createInputResolutionArtifact(params: {
  runId: string;
  graphId: string;
  compileFingerprint?: string;
  moduleResults: ModuleExecutionResult[];
}): GraphNodeInputResolutionArtifactV1 {
  return {
    runId: params.runId,
    graphId: params.graphId,
    ...(params.compileFingerprint
      ? { compileFingerprint: params.compileFingerprint }
      : {}),
    nodes: params.moduleResults
      .map((result) => result.inputResolution)
      .filter((record): record is GraphNodeInputResolutionNodeRecordV1 =>
        Boolean(record),
      )
      .map((record) => ({
        ...record,
        inputs: record.inputs.map((input) => ({
          ...input,
          ...(input.valueSummary
            ? { valueSummary: { ...input.valueSummary } }
            : {}),
        })),
      })),
  };
}

function createDirtySetSummary(
  entries: GraphDirtySetEntry[],
): GraphDirtySetSummary {
  const reasonCounts: Record<GraphNodeDirtyReason, number> = {
    initial_run: 0,
    input_changed: 0,
    upstream_dirty: 0,
    clean: 0,
  };
  const dirtyNodeIds = entries
    .filter((entry) => entry.isDirty)
    .map((entry) => entry.nodeId);
  const cleanNodeIds = entries
    .filter((entry) => !entry.isDirty)
    .map((entry) => entry.nodeId);

  for (const entry of entries) {
    reasonCounts[entry.dirtyReason] += 1;
  }

  return {
    fingerprintVersion: 1,
    entries: entries.map((entry) => ({ ...entry })),
    dirtyNodeIds,
    cleanNodeIds,
    totalNodeCount: entries.length,
    dirtyNodeCount: dirtyNodeIds.length,
    cleanNodeCount: cleanNodeIds.length,
    reasonCounts,
  };
}

function createNodeDiagnosticsView(trace: {
  nodeId: string;
  moduleId: string;
  inputSources?: GraphNodeInputSource[];
  dirtyReason?: GraphNodeDirtyReason;
  cacheKeyFacts?: GraphNodeCacheKeyFacts;
  reuseVerdict?: GraphNodeReuseVerdict;
  executionDecision?: GraphNodeExecutionDecision;
}): GraphNodeDiagnosticsView {
  return {
    nodeId: trace.nodeId,
    moduleId: trace.moduleId,
    title: getModuleBlueprint(trace.moduleId)?.label,
    dirtyReason: trace.dirtyReason,
    reuseVerdict: trace.reuseVerdict
      ? {
          canReuse: trace.reuseVerdict.canReuse,
          reason: trace.reuseVerdict.reason,
        }
      : undefined,
    executionDecision: trace.executionDecision
      ? {
          shouldExecute: trace.executionDecision.shouldExecute,
          shouldSkip: trace.executionDecision.shouldSkip,
          reason: trace.executionDecision.reason,
          reusableOutputHit: trace.executionDecision.reusableOutputHit,
        }
      : undefined,
    inputSources: (trace.inputSources ?? []).map((source) => ({
      sourceNodeId: source.sourceNodeId,
      sourcePort: source.sourcePort,
      targetPort: source.targetPort,
    })),
    cacheKey: trace.cacheKeyFacts
      ? {
          compileFingerprint: trace.cacheKeyFacts.compileFingerprint,
          nodeFingerprint: trace.cacheKeyFacts.nodeFingerprint,
          inputFingerprint: trace.cacheKeyFacts.inputFingerprint,
          fingerprintVersion: trace.cacheKeyFacts.fingerprintVersion,
        }
      : undefined,
    reusableOutputsHit: trace.executionDecision?.reusableOutputHit === true,
    skipReuseOutputsHit:
      trace.executionDecision?.reason === "skip_reuse_outputs" &&
      trace.executionDecision.shouldSkip === true,
  };
}

export function buildGraphRunDiagnosticsOverview(
  result: GraphExecutionResult,
): GraphRunDiagnosticsOverview {
  const dirtySetSummary = result.dirtySetSummary;
  const reuseSummary = result.reuseSummary;
  const executionDecisionSummary = result.executionDecisionSummary;
  const dirtyReasonCounts: Record<GraphNodeDirtyReason, number> = {
    initial_run: 0,
    input_changed: 0,
    upstream_dirty: 0,
    clean: 0,
  };

  if (dirtySetSummary?.reasonCounts) {
    Object.assign(dirtyReasonCounts, dirtySetSummary.reasonCounts);
  } else if (dirtySetSummary) {
    for (const entry of dirtySetSummary.entries) {
      dirtyReasonCounts[entry.dirtyReason] += 1;
    }
  }

  const nodeDiagnosticsSource =
    result.trace?.nodeTraces?.filter((trace) => trace.stage === "execute") ??
    result.moduleResults.map((moduleResult) => ({
      nodeId: moduleResult.nodeId,
      moduleId: moduleResult.moduleId,
      inputSources: moduleResult.inputSources,
      dirtyReason: moduleResult.dirtyReason,
      cacheKeyFacts: moduleResult.cacheKeyFacts,
      reuseVerdict: moduleResult.reuseVerdict,
      executionDecision: moduleResult.executionDecision,
    }));

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
      totalNodeCount:
        dirtySetSummary?.totalNodeCount ?? dirtySetSummary?.entries.length ?? 0,
      dirtyNodeCount:
        dirtySetSummary?.dirtyNodeCount ??
        dirtySetSummary?.dirtyNodeIds.length ??
        0,
      cleanNodeCount:
        dirtySetSummary?.cleanNodeCount ??
        dirtySetSummary?.cleanNodeIds?.length ??
        Math.max(
          0,
          (dirtySetSummary?.entries.length ?? 0) -
            (dirtySetSummary?.dirtyNodeIds.length ?? 0),
        ),
      dirtyNodeIds: [...(dirtySetSummary?.dirtyNodeIds ?? [])],
      cleanNodeIds: [...(dirtySetSummary?.cleanNodeIds ?? [])],
      reasonCounts: dirtyReasonCounts,
    },
    ...(reuseSummary
      ? {
          reuse: {
            eligibleNodeCount:
              reuseSummary.eligibleNodeCount ??
              reuseSummary.eligibleNodeIds.length,
            ineligibleNodeCount:
              reuseSummary.ineligibleNodeCount ??
              reuseSummary.ineligibleNodeIds.length,
            eligibleNodeIds: [...reuseSummary.eligibleNodeIds],
            ineligibleNodeIds: [...reuseSummary.ineligibleNodeIds],
            verdictCounts: { ...reuseSummary.verdictCounts },
          },
        }
      : {}),
    ...(executionDecisionSummary
      ? {
          executionDecision: {
            featureEnabled: executionDecisionSummary.featureEnabled,
            skippedNodeCount:
              executionDecisionSummary.skippedNodeCount ??
              executionDecisionSummary.skippedNodeIds.length,
            executedNodeCount:
              executionDecisionSummary.executedNodeCount ??
              executionDecisionSummary.executedNodeIds.length,
            skippedNodeIds: [...executionDecisionSummary.skippedNodeIds],
            executedNodeIds: [...executionDecisionSummary.executedNodeIds],
            skipReuseOutputNodeIds: [
              ...(executionDecisionSummary.skipReuseOutputNodeIds ?? []),
            ],
            decisionCounts: { ...executionDecisionSummary.decisionCounts },
          },
        }
      : {}),
    nodeDiagnostics: nodeDiagnosticsSource.map(createNodeDiagnosticsView),
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

  const eligibleNodeIds = verdicts
    .filter(({ reuseVerdict }) => reuseVerdict.canReuse)
    .map(({ nodeId }) => nodeId);
  const ineligibleNodeIds = verdicts
    .filter(({ reuseVerdict }) => !reuseVerdict.canReuse)
    .map(({ nodeId }) => nodeId);

  return {
    fingerprintVersion: REUSE_FINGERPRINT_VERSION,
    eligibleNodeIds,
    ineligibleNodeIds,
    eligibleNodeCount: eligibleNodeIds.length,
    ineligibleNodeCount: ineligibleNodeIds.length,
    verdictCounts,
  };
}

function cloneModuleOutput(outputs: ModuleOutput): ModuleOutput {
  return { ...outputs };
}

function createNodeRunArtifact(params: {
  runId: string;
  graphId: string;
  status?: GraphRunStatus;
  nodeId?: string;
  moduleId?: string;
  checkpointCandidate?: GraphRunCheckpointSummary;
  heartbeat?: GraphRunEvent["heartbeat"];
  partialOutput?: GraphRunEvent["partialOutput"];
  waitingUser?: GraphRunEvent["waitingUser"];
  eventCount: number;
}): GraphRunArtifact {
  return createGraphRunArtifact({
    runId: params.runId,
    graphId: params.graphId,
    status: params.status ?? "running",
    currentStage: "execute",
    latestNodeId: params.nodeId,
    latestNodeModuleId: params.moduleId,
    checkpointCandidate: params.checkpointCandidate,
    latestHeartbeat: params.heartbeat,
    latestPartialOutput: params.partialOutput,
    waitingUser: params.waitingUser,
    eventCount: params.eventCount,
  });
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

  const skippedNodeIds = decisions
    .filter(({ executionDecision }) => executionDecision.shouldSkip)
    .map(({ nodeId }) => nodeId);
  const executedNodeIds = decisions
    .filter(({ executionDecision }) => executionDecision.shouldExecute)
    .map(({ nodeId }) => nodeId);
  const skipReuseOutputNodeIds = decisions
    .filter(
      ({ executionDecision }) =>
        executionDecision.reason === "skip_reuse_outputs" &&
        executionDecision.shouldSkip,
    )
    .map(({ nodeId }) => nodeId);

  return {
    featureEnabled,
    skippedNodeIds,
    executedNodeIds,
    skippedNodeCount: skippedNodeIds.length,
    executedNodeCount: executedNodeIds.length,
    skipReuseOutputNodeIds,
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
    const artifact = createGraphRunArtifact({
      runId: context.requestId,
      graphId: graph.id,
      status: params.status ?? "running",
      currentStage: "execute",
      latestNodeId: params.nodeId,
      latestNodeModuleId: params.moduleId,
      checkpointCandidate,
      latestHeartbeat: params.heartbeat,
      latestPartialOutput: params.partialOutput,
      waitingUser: params.waitingUser,
      eventCount: runEvents.length + 1,
    });
    const event: GraphRunEvent = {
      type,
      runId: context.requestId,
      graphId: graph.id,
      timestamp: Date.now(),
      ...(params.status ? { status: params.status } : {}),
      phase: artifact.phase,
      phaseLabel: artifact.phaseLabel,
      ...(artifact.blockingReason
        ? { blockingReason: artifact.blockingReason }
        : {}),
      ...(artifact.blockingContract
        ? { blockingContract: artifact.blockingContract }
        : {}),
      ...(artifact.continuationContract
        ? { continuationContract: artifact.continuationContract }
        : {}),
      ...(artifact.controlPreconditionsContract
        ? {
            controlPreconditionsContract: artifact.controlPreconditionsContract,
          }
        : {}),
      ...(artifact.constraintSummary
        ? { constraintSummary: artifact.constraintSummary }
        : {}),
      ...(artifact.recoveryEligibility
        ? { recoveryEligibility: artifact.recoveryEligibility }
        : {}),
      ...(artifact.terminalOutcome
        ? { terminalOutcome: artifact.terminalOutcome }
        : {}),
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
      artifact,
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
    const inputResolution = createNodeInputResolutionRecord({
      node,
      planNode,
      graph,
      inputs,
      inputSources,
      stableContextInputs,
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
        inputResolution,
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
        inputResolution,
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
        inputResolution,
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
        totalNodeCount:
          dirtySetSummary?.totalNodeCount ??
          dirtySetSummary?.entries.length ??
          0,
        dirtyNodeCount:
          dirtySetSummary?.dirtyNodeCount ??
          dirtySetSummary?.dirtyNodeIds.length ??
          0,
        cleanNodeCount:
          dirtySetSummary?.cleanNodeCount ??
          dirtySetSummary?.cleanNodeIds?.length ??
          Math.max(
            0,
            (dirtySetSummary?.entries.length ?? 0) -
              (dirtySetSummary?.dirtyNodeIds.length ?? 0),
          ),
        dirtyNodeIds: [...(dirtySetSummary?.dirtyNodeIds ?? [])],
        cleanNodeIds: [...(dirtySetSummary?.cleanNodeIds ?? [])],
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
    const runArtifact = observation.runArtifact;
    if (!runArtifact) {
      return;
    }
    const event: GraphRunEvent = {
      type,
      runId: context.requestId,
      graphId: graph.id,
      timestamp: Date.now(),
      ...(params.status ? { status: params.status } : {}),
      phase: runArtifact.phase,
      phaseLabel: runArtifact.phaseLabel,
      ...(runArtifact.blockingReason
        ? { blockingReason: runArtifact.blockingReason }
        : {}),
      ...(runArtifact.blockingContract
        ? { blockingContract: runArtifact.blockingContract }
        : {}),
      ...(runArtifact.continuationContract
        ? { continuationContract: runArtifact.continuationContract }
        : {}),
      ...(runArtifact.controlPreconditionsContract
        ? {
            controlPreconditionsContract:
              runArtifact.controlPreconditionsContract,
          }
        : {}),
      ...(runArtifact.constraintSummary
        ? { constraintSummary: runArtifact.constraintSummary }
        : {}),
      ...(runArtifact.recoveryEligibility
        ? { recoveryEligibility: runArtifact.recoveryEligibility }
        : {}),
      ...(runArtifact.terminalOutcome
        ? { terminalOutcome: runArtifact.terminalOutcome }
        : {}),
      ...(params.stage ? { stage: params.stage } : {}),
      ...(params.error ? { error: params.error } : {}),
      ...(params.diagnosticsOverview
        ? { diagnosticsOverview: params.diagnosticsOverview }
        : {}),
      artifact: runArtifact,
    };
    runEvents.push(event);
    context.onProgress?.(event);
  };

  emitRunEvent("run_queued", { status: "queued" });
  emitRunEvent("run_started", { status: "running" });
  emitRunEvent("stage_started", { status: "running", stage: "validate" });

  const validateTimer = startStage("validate");
  const validationResult = validateGraph(graph);
  if (validationResult.errors.length > 0) {
    const reason = formatGraphValidationErrors(validationResult.errors);
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
  let compileArtifact: GraphExecutionResult["compileArtifact"];
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
    compileArtifact = createGraphCompileArtifactEnvelope({
      plan: compilePlan,
    })?.artifact;
    checkpointCandidate = createCheckpointCandidate({
      runId: context.requestId,
      graphId: graph.id,
      compileFingerprint: compilePlan.compileFingerprint,
      stage: "compile",
      reason: "stage_boundary",
    });
    emitRunEvent("stage_finished", { status: "running", stage: "compile" });
    const compileCheckpointObservation = buildRunObservation({
      graph,
      requestId: context.requestId,
      startedAt,
      status: "running",
      currentStage: "compile",
      compileFingerprint: compilePlan.compileFingerprint,
      checkpointCandidate,
      latestHeartbeat,
      latestPartialOutput,
      waitingUser,
      eventCount: runEvents.length + 1,
    });
    const compileCheckpointArtifact = compileCheckpointObservation.runArtifact;
    if (compileCheckpointArtifact) {
      runEvents.push({
        type: "checkpoint_candidate",
        runId: context.requestId,
        graphId: graph.id,
        status: "running",
        phase: compileCheckpointArtifact.phase,
        phaseLabel: compileCheckpointArtifact.phaseLabel,
        ...(compileCheckpointArtifact.blockingReason
          ? { blockingReason: compileCheckpointArtifact.blockingReason }
          : {}),
        ...(compileCheckpointArtifact.blockingContract
          ? { blockingContract: compileCheckpointArtifact.blockingContract }
          : {}),
        ...(compileCheckpointArtifact.recoveryEligibility
          ? {
              recoveryEligibility:
                compileCheckpointArtifact.recoveryEligibility,
            }
          : {}),
        ...(compileCheckpointArtifact.terminalOutcome
          ? { terminalOutcome: compileCheckpointArtifact.terminalOutcome }
          : {}),
        stage: "compile",
        checkpoint: checkpointCandidate,
        artifact: compileCheckpointArtifact,
        timestamp: Date.now(),
      });
    }
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
      compileArtifact,
      inputResolutionArtifact: createInputResolutionArtifact({
        runId: context.requestId,
        graphId: graph.id,
        compileFingerprint: compilePlan.compileFingerprint,
        moduleResults: execution.moduleResults,
      }),
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
      diagnosticsOverview,
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
      compileArtifact: createGraphCompileArtifactEnvelope({
        plan: compilePlan,
      })?.artifact,
      inputResolutionArtifact: createInputResolutionArtifact({
        runId: context.requestId,
        graphId: graph.id,
        compileFingerprint: compilePlan.compileFingerprint,
        moduleResults:
          error instanceof GraphExecutionStageError ? error.moduleResults : [],
      }),
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

export interface GraphValidationResult {
  errors: GraphValidationError[];
  diagnostics: GraphValidationError[];
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

function hasMeaningfulConfigValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

function isHostWriteNodeMisplaced(
  graph: WorkbenchGraph,
  node: WorkbenchNode,
): boolean {
  return graph.edges.some((edge) => edge.source === node.id);
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

export function validateGraph(graph: WorkbenchGraph): GraphValidationResult {
  const errors: GraphValidationError[] = [];
  const diagnostics: GraphValidationError[] = [];
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

  // Check that all nodes reference valid module IDs and metadata-aware config facts
  for (const node of graph.nodes) {
    try {
      const blueprint = getModuleBlueprint(node.moduleId);
      const metadata = getModuleMetadataSurface(node.moduleId);
      const explain = getModuleExplainContract(node.moduleId);
      const validation = metadata?.config?.validation;
      const knownSchemaFields =
        explain?.config.schemaFields ?? metadata?.config?.schemaFields ?? [];
      const knownFieldLabelByKey = new Map(
        knownSchemaFields.map((field) => [field.key, field.label]),
      );
      const allowedConfigKeys = new Set(
        explain?.config.allowedConfigKeys ??
          validation?.allowedConfigKeys ??
          [],
      );
      const requiredConfigKeys =
        explain?.config.requiredConfigKeys ??
        validation?.requiredConfigKeys ??
        [];
      const configRecord =
        node.config && typeof node.config === "object" ? node.config : {};

      for (const requiredKey of requiredConfigKeys) {
        if (hasMeaningfulConfigValue(configRecord[requiredKey])) {
          continue;
        }
        const fieldLabel = knownFieldLabelByKey.get(requiredKey) ?? requiredKey;
        const requiredSeverity = validation?.requiredConfigSeverity ?? "error";
        const targetCollection =
          requiredSeverity === "error" ? errors : diagnostics;
        targetCollection.push({
          nodeId: node.id,
          message: `${formatNodeRef(node, blueprint.label)} 缺少 metadata-required 配置字段「${fieldLabel}」(${requiredKey})；当前按 ${requiredSeverity} 级别处理，并保持执行期默认回退语义不变。`,
        });
      }

      if (allowedConfigKeys.size > 0) {
        for (const rawKey of Object.keys(configRecord)) {
          if (allowedConfigKeys.has(rawKey)) {
            continue;
          }
          const explainHint =
            validation?.explainHint ?? "当前按说明性 metadata 处理未知配置键。";
          const unknownSeverity =
            validation?.unknownConfigSeverity ??
            (explain?.config.unknownKeyPolicy === "allow_with_error"
              ? "error"
              : "warning");
          const targetCollection =
            unknownSeverity === "error" ? errors : diagnostics;
          targetCollection.push({
            nodeId: node.id,
            message: `${formatNodeRef(node, blueprint.label)} 检测到 schema 外未知配置键「${rawKey}」；按兼容优先策略保守视为 ${unknownSeverity} / explain。${explainHint}`,
          });
        }
      }
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
      const metadataSummary = getModuleMetadataSummary(node.moduleId);
      const explain = metadataSummary?.explainContract;

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

      if (
        metadataSummary?.semantic.capability === "writes_host" ||
        metadataSummary?.semantic.hostWriteHint
      ) {
        if (isHostWriteNodeMisplaced(graph, node)) {
          const hostWriteLabel =
            explain?.diagnostics.hostWrite ??
            (metadataSummary.semantic.hostWriteHint?.targetType &&
            metadataSummary.semantic.hostWriteHint?.operation
              ? `${metadataSummary.semantic.hostWriteHint.targetType}:${metadataSummary.semantic.hostWriteHint.operation}`
              : "host_write");
          diagnostics.push({
            nodeId: node.id,
            message: `${formatNodeRef(node, bp.label)} 带有 host-write 提示 ${hostWriteLabel}，但当前被串接为上游数据源位置；这属于静态 explain/告警，不引入新的控制语义或执行拒绝。`,
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

  return {
    errors,
    diagnostics,
  };
}
