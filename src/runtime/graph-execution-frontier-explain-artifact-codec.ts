import type {
  GraphBlockingExplainArtifactV1,
  GraphCompilePlan,
  GraphCompileRunLinkArtifactV1,
  GraphCompileRunLinkDispositionV1,
  GraphDependencyReadinessExplainArtifactV1,
  GraphExecutionFrontierDispositionV1,
  GraphExecutionFrontierEvidenceSourceV1,
  GraphExecutionFrontierExplainArtifactEnvelope,
  GraphExecutionFrontierExplainArtifactV1,
  GraphExecutionFrontierNodeRecordV1,
  GraphExecutionFrontierReasonKindV1,
  GraphExecutionFrontierSummaryV1,
  GraphFailureExplainArtifactV1,
  GraphNodeExecutionDispositionExplainArtifactV1,
  GraphNodeInputResolutionArtifactV1,
  GraphRunArtifact,
} from "../ui/components/graph/module-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toRequiredString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toNonNegativeInt(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return numeric >= 0 ? Math.trunc(numeric) : 0;
}

function toOptionalStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

const EXECUTION_FRONTIER_EVIDENCE_SOURCES: GraphExecutionFrontierEvidenceSourceV1[] =
  [
    "compile_run_link",
    "input_resolution",
    "node_execution_disposition",
    "dependency_readiness",
    "failure_explain",
    "blocking_explain",
    "run_status",
  ];

function toDisposition(
  value: unknown,
  fallback: GraphExecutionFrontierDispositionV1 = "unknown",
): GraphExecutionFrontierDispositionV1 {
  return value === "ready_frontier" ||
    value === "blocked_dependency" ||
    value === "blocked_input" ||
    value === "blocked_non_terminal" ||
    value === "unreachable" ||
    value === "unknown"
    ? value
    : fallback;
}

function toReasonKind(
  value: unknown,
  fallback: GraphExecutionFrontierReasonKindV1 = "unknown",
): GraphExecutionFrontierReasonKindV1 {
  return value === "all_prerequisites_satisfied_but_not_executed" ||
    value === "dependency_not_ready" ||
    value === "missing_or_unresolved_input" ||
    value === "non_terminal_blocked" ||
    value === "truncated_or_unreachable" ||
    value === "unknown"
    ? value
    : fallback;
}

function toRunDisposition(
  value: unknown,
): GraphCompileRunLinkDispositionV1 | undefined {
  return value === "executed" ||
    value === "skipped_reuse" ||
    value === "failed" ||
    value === "not_reached"
    ? value
    : undefined;
}

function toRunStatus(value: unknown): GraphRunArtifact["status"] | undefined {
  return value === "queued" ||
    value === "running" ||
    value === "streaming" ||
    value === "waiting_user" ||
    value === "cancelling" ||
    value === "cancelled" ||
    value === "failed" ||
    value === "completed"
    ? value
    : undefined;
}

function toEvidenceSources(
  value: unknown,
): GraphExecutionFrontierEvidenceSourceV1[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is GraphExecutionFrontierEvidenceSourceV1 =>
          typeof entry === "string" &&
          EXECUTION_FRONTIER_EVIDENCE_SOURCES.includes(
            entry as GraphExecutionFrontierEvidenceSourceV1,
          ),
      )
    : [];
}

function createEmptyReasonCounts(): Record<
  GraphExecutionFrontierReasonKindV1,
  number
> {
  return {
    all_prerequisites_satisfied_but_not_executed: 0,
    dependency_not_ready: 0,
    missing_or_unresolved_input: 0,
    non_terminal_blocked: 0,
    truncated_or_unreachable: 0,
    unknown: 0,
  };
}

function createEmptySummary(): GraphExecutionFrontierSummaryV1 {
  return {
    nodeCounts: {
      readyFrontier: 0,
      blockedDependency: 0,
      blockedInput: 0,
      blockedNonTerminal: 0,
      unreachable: 0,
      unknown: 0,
    },
    reasonCounts: createEmptyReasonCounts(),
    evidenceSources: [],
  };
}

function pushEvidenceSource(
  target: Set<GraphExecutionFrontierEvidenceSourceV1>,
  source: GraphExecutionFrontierEvidenceSourceV1,
): void {
  target.add(source);
}

function deriveSummaryFromNodes(
  nodes: readonly GraphExecutionFrontierNodeRecordV1[],
): GraphExecutionFrontierSummaryV1 {
  const summary = createEmptySummary();
  const evidenceSources = new Set<GraphExecutionFrontierEvidenceSourceV1>();

  for (const node of nodes) {
    switch (node.frontierDisposition) {
      case "ready_frontier":
        summary.nodeCounts.readyFrontier += 1;
        break;
      case "blocked_dependency":
        summary.nodeCounts.blockedDependency += 1;
        break;
      case "blocked_input":
        summary.nodeCounts.blockedInput += 1;
        break;
      case "blocked_non_terminal":
        summary.nodeCounts.blockedNonTerminal += 1;
        break;
      case "unreachable":
        summary.nodeCounts.unreachable += 1;
        break;
      default:
        summary.nodeCounts.unknown += 1;
        break;
    }

    summary.reasonCounts[node.primaryReasonKind] += 1;
    for (const source of node.evidenceSources) {
      pushEvidenceSource(evidenceSources, source);
    }
  }

  summary.evidenceSources = [...evidenceSources];
  return summary;
}

function normalizeNodeRecord(
  value: unknown,
): GraphExecutionFrontierNodeRecordV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const nodeId = toRequiredString(value.nodeId);
  const moduleId = toRequiredString(value.moduleId);
  const nodeFingerprint = toRequiredString(value.nodeFingerprint);
  if (!nodeId || !moduleId || !nodeFingerprint) {
    return null;
  }

  const upstreamRunDispositions = Array.isArray(value.upstreamRunDispositions)
    ? value.upstreamRunDispositions.filter(
        (disposition): disposition is GraphCompileRunLinkDispositionV1 =>
          disposition === "executed" ||
          disposition === "skipped_reuse" ||
          disposition === "failed" ||
          disposition === "not_reached",
      )
    : [];

  return {
    nodeId,
    moduleId,
    nodeFingerprint,
    compileOrder: toNonNegativeInt(value.compileOrder),
    frontierDisposition: toDisposition(value.frontierDisposition),
    primaryReasonKind: toReasonKind(value.primaryReasonKind),
    evidenceSources: toEvidenceSources(value.evidenceSources),
    ...(toOptionalStringArray(value.blockingDependencyNodeIds).length > 0
      ? {
          blockingDependencyNodeIds: toOptionalStringArray(
            value.blockingDependencyNodeIds,
          ),
        }
      : {}),
    ...(toOptionalStringArray(value.unresolvedInputKeys).length > 0
      ? {
          unresolvedInputKeys: toOptionalStringArray(value.unresolvedInputKeys),
        }
      : {}),
    ...(upstreamRunDispositions.length > 0 ? { upstreamRunDispositions } : {}),
    ...(toRunDisposition(value.runDisposition)
      ? { runDisposition: toRunDisposition(value.runDisposition) }
      : {}),
    ...(toRunStatus(value.blockedByRunStatus)
      ? { blockedByRunStatus: toRunStatus(value.blockedByRunStatus) }
      : {}),
  };
}

function normalizeSummary(
  value: unknown,
  fallback: GraphExecutionFrontierSummaryV1,
): GraphExecutionFrontierSummaryV1 {
  if (!isRecord(value)) {
    return fallback;
  }

  const nodeCounts = isRecord(value.nodeCounts) ? value.nodeCounts : null;
  const reasonCounts = isRecord(value.reasonCounts) ? value.reasonCounts : null;
  const normalizedReasonCounts = createEmptyReasonCounts();

  for (const key of Object.keys(
    normalizedReasonCounts,
  ) as GraphExecutionFrontierReasonKindV1[]) {
    normalizedReasonCounts[key] = toNonNegativeInt(
      reasonCounts?.[key],
      fallback.reasonCounts[key],
    );
  }

  return {
    nodeCounts: {
      readyFrontier: toNonNegativeInt(
        nodeCounts?.readyFrontier,
        fallback.nodeCounts.readyFrontier,
      ),
      blockedDependency: toNonNegativeInt(
        nodeCounts?.blockedDependency,
        fallback.nodeCounts.blockedDependency,
      ),
      blockedInput: toNonNegativeInt(
        nodeCounts?.blockedInput,
        fallback.nodeCounts.blockedInput,
      ),
      blockedNonTerminal: toNonNegativeInt(
        nodeCounts?.blockedNonTerminal,
        fallback.nodeCounts.blockedNonTerminal,
      ),
      unreachable: toNonNegativeInt(
        nodeCounts?.unreachable,
        fallback.nodeCounts.unreachable,
      ),
      unknown: toNonNegativeInt(
        nodeCounts?.unknown,
        fallback.nodeCounts.unknown,
      ),
    },
    reasonCounts: normalizedReasonCounts,
    evidenceSources:
      toEvidenceSources(value.evidenceSources).length > 0
        ? toEvidenceSources(value.evidenceSources)
        : [...fallback.evidenceSources],
  };
}

function normalizeArtifact(
  value: unknown,
): GraphExecutionFrontierExplainArtifactV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const graphId = toRequiredString(value.graphId);
  const runId = toRequiredString(value.runId);
  const compileFingerprint = toRequiredString(value.compileFingerprint);
  if (!graphId || !runId || !compileFingerprint) {
    return null;
  }

  const nodes = Array.isArray(value.nodes)
    ? value.nodes
        .map((node) => normalizeNodeRecord(node))
        .filter(
          (node): node is GraphExecutionFrontierNodeRecordV1 => node !== null,
        )
        .sort((left, right) => left.compileOrder - right.compileOrder)
    : [];

  const fallbackSummary = deriveSummaryFromNodes(nodes);

  return {
    graphId,
    runId,
    compileFingerprint,
    fingerprintVersion: 1,
    nodeCount:
      value.nodeCount === undefined
        ? nodes.length
        : toNonNegativeInt(value.nodeCount, nodes.length),
    summary: normalizeSummary(value.summary, fallbackSummary),
    nodes,
  };
}

function collectUnresolvedInputKeys(
  inputNode?: GraphNodeInputResolutionArtifactV1["nodes"][number],
): string[] {
  if (!inputNode) {
    return [];
  }

  return inputNode.inputs
    .filter(
      (input) =>
        input.resolutionStatus === "missing" ||
        input.resolutionStatus === "unknown" ||
        input.missingReason === "upstream_unavailable" ||
        input.missingReason === "value_unavailable" ||
        input.missingReason === "no_observed_source",
    )
    .map((input) => input.inputKey)
    .filter((inputKey) => typeof inputKey === "string" && inputKey);
}

function inferNodeRecord(params: {
  planNode: GraphCompilePlan["nodes"][number];
  linkageNode?: GraphCompileRunLinkArtifactV1["nodes"][number];
  linkageByNodeId: Map<string, GraphCompileRunLinkArtifactV1["nodes"][number]>;
  inputNode?: GraphNodeInputResolutionArtifactV1["nodes"][number];
  nodeExecutionNode?: GraphNodeExecutionDispositionExplainArtifactV1["nodes"][number];
  dependencyReadinessNode?: GraphDependencyReadinessExplainArtifactV1["nodes"][number];
  failureNode?: GraphFailureExplainArtifactV1["nodes"][number];
  blockingArtifact?: GraphBlockingExplainArtifactV1 | null;
}): GraphExecutionFrontierNodeRecordV1 {
  const {
    planNode,
    linkageNode,
    linkageByNodeId,
    inputNode,
    nodeExecutionNode,
    dependencyReadinessNode,
    failureNode,
    blockingArtifact,
  } = params;

  const evidenceSources = new Set<GraphExecutionFrontierEvidenceSourceV1>();
  const runDisposition = linkageNode?.runDisposition;
  const unresolvedInputKeys = collectUnresolvedInputKeys(inputNode);
  const runStatus = blockingArtifact?.summary.runStatus;
  const nonTerminalBlocked =
    blockingArtifact?.summary.blockingDisposition === "blocked" ||
    blockingArtifact?.summary.blockingDisposition === "waiting_user" ||
    blockingArtifact?.summary.blockingDisposition === "running" ||
    (blockingArtifact?.summary.runStatus === "waiting_user" &&
      blockingArtifact.summary.phase === "blocked");

  const blockingDependencyNodeIds = planNode.dependsOn.filter((nodeId) => {
    const upstreamRunDisposition = linkageByNodeId.get(nodeId)?.runDisposition;
    return (
      upstreamRunDisposition === "not_reached" ||
      upstreamRunDisposition === "failed" ||
      upstreamRunDisposition === undefined
    );
  });

  const upstreamRunDispositions = planNode.dependsOn
    .map((nodeId) => linkageByNodeId.get(nodeId)?.runDisposition)
    .filter(
      (disposition): disposition is GraphCompileRunLinkDispositionV1 =>
        disposition === "executed" ||
        disposition === "skipped_reuse" ||
        disposition === "failed" ||
        disposition === "not_reached",
    );

  if (linkageNode) {
    pushEvidenceSource(evidenceSources, "compile_run_link");
  }
  if (inputNode) {
    pushEvidenceSource(evidenceSources, "input_resolution");
  }
  if (nodeExecutionNode) {
    pushEvidenceSource(evidenceSources, "node_execution_disposition");
  }
  if (dependencyReadinessNode) {
    pushEvidenceSource(evidenceSources, "dependency_readiness");
  }
  if (failureNode) {
    pushEvidenceSource(evidenceSources, "failure_explain");
  }
  if (blockingArtifact) {
    pushEvidenceSource(evidenceSources, "blocking_explain");
    pushEvidenceSource(evidenceSources, "run_status");
  }

  const base: GraphExecutionFrontierNodeRecordV1 = {
    nodeId: planNode.nodeId,
    moduleId: planNode.moduleId,
    nodeFingerprint: planNode.nodeFingerprint,
    compileOrder: planNode.order,
    frontierDisposition: "unknown",
    primaryReasonKind: "unknown",
    evidenceSources: [...evidenceSources],
    ...(blockingDependencyNodeIds.length > 0
      ? { blockingDependencyNodeIds }
      : {}),
    ...(unresolvedInputKeys.length > 0 ? { unresolvedInputKeys } : {}),
    ...(upstreamRunDispositions.length > 0 ? { upstreamRunDispositions } : {}),
    ...(runDisposition ? { runDisposition } : {}),
    ...(runStatus ? { blockedByRunStatus: runStatus } : {}),
  };

  if (
    runDisposition === "executed" ||
    runDisposition === "skipped_reuse" ||
    runDisposition === "failed"
  ) {
    return base;
  }

  const dependencyReadinessDisposition =
    dependencyReadinessNode?.readinessDisposition ?? "unknown";
  const dependencyReadinessReason =
    dependencyReadinessNode?.primaryReasonKind ?? "unknown";
  const nodeExecutionReason = nodeExecutionNode?.primaryReasonKind ?? "unknown";
  const isFailureTruncated =
    failureNode?.failureDisposition === "not_reached" &&
    (runStatus === "failed" || runStatus === "cancelled");

  if (
    dependencyReadinessDisposition === "ready" &&
    dependencyReadinessReason === "all_prerequisites_satisfied" &&
    !nonTerminalBlocked &&
    unresolvedInputKeys.length === 0 &&
    blockingDependencyNodeIds.length === 0 &&
    runDisposition === "not_reached"
  ) {
    return {
      ...base,
      frontierDisposition: "ready_frontier",
      primaryReasonKind: "all_prerequisites_satisfied_but_not_executed",
    };
  }

  if (
    dependencyReadinessDisposition === "blocked_non_terminal" ||
    (nonTerminalBlocked &&
      dependencyReadinessDisposition !== "not_ready_input" &&
      dependencyReadinessDisposition !== "not_ready_dependency")
  ) {
    return {
      ...base,
      frontierDisposition: "blocked_non_terminal",
      primaryReasonKind: "non_terminal_blocked",
    };
  }

  if (
    dependencyReadinessDisposition === "truncated_by_failure" ||
    isFailureTruncated ||
    nodeExecutionReason === "truncated_by_failure"
  ) {
    if (
      dependencyReadinessDisposition === "not_ready_input" ||
      dependencyReadinessDisposition === "not_ready_dependency"
    ) {
      return base;
    }
    return {
      ...base,
      frontierDisposition: "unreachable",
      primaryReasonKind: "truncated_or_unreachable",
    };
  }

  if (
    dependencyReadinessDisposition === "not_ready_dependency" ||
    nodeExecutionReason === "dependency_not_reached"
  ) {
    if (unresolvedInputKeys.length > 0) {
      return base;
    }
    return {
      ...base,
      frontierDisposition: "blocked_dependency",
      primaryReasonKind: "dependency_not_ready",
    };
  }

  if (
    dependencyReadinessDisposition === "not_ready_input" ||
    nodeExecutionReason === "input_missing_or_unresolved"
  ) {
    if (nonTerminalBlocked) {
      return base;
    }
    return {
      ...base,
      frontierDisposition: "blocked_input",
      primaryReasonKind: "missing_or_unresolved_input",
    };
  }

  return base;
}

export function createGraphExecutionFrontierExplainArtifactEnvelope(params: {
  plan?: GraphCompilePlan | null;
  runArtifact?: GraphRunArtifact | null;
  compileRunLinkArtifact?: GraphCompileRunLinkArtifactV1 | null;
  inputResolutionArtifact?: GraphNodeInputResolutionArtifactV1 | null;
  nodeExecutionDispositionExplainArtifact?: GraphNodeExecutionDispositionExplainArtifactV1 | null;
  dependencyReadinessExplainArtifact?: GraphDependencyReadinessExplainArtifactV1 | null;
  failureExplainArtifact?: GraphFailureExplainArtifactV1 | null;
  blockingExplainArtifact?: GraphBlockingExplainArtifactV1 | null;
}): GraphExecutionFrontierExplainArtifactEnvelope | null {
  const plan = params.plan;
  const graphId =
    plan?.fingerprintSource?.graphId ??
    params.compileRunLinkArtifact?.graphId ??
    params.inputResolutionArtifact?.graphId ??
    params.nodeExecutionDispositionExplainArtifact?.graphId ??
    params.dependencyReadinessExplainArtifact?.graphId ??
    params.failureExplainArtifact?.graphId ??
    params.blockingExplainArtifact?.graphId ??
    params.runArtifact?.graphId;
  const runId =
    params.runArtifact?.runId ??
    params.compileRunLinkArtifact?.runId ??
    params.inputResolutionArtifact?.runId ??
    params.nodeExecutionDispositionExplainArtifact?.runId ??
    params.dependencyReadinessExplainArtifact?.runId ??
    params.failureExplainArtifact?.runId ??
    params.blockingExplainArtifact?.runId;
  const compileFingerprint =
    plan?.compileFingerprint ??
    params.compileRunLinkArtifact?.compileFingerprint ??
    params.inputResolutionArtifact?.compileFingerprint ??
    params.nodeExecutionDispositionExplainArtifact?.compileFingerprint ??
    params.dependencyReadinessExplainArtifact?.compileFingerprint ??
    params.failureExplainArtifact?.compileFingerprint ??
    params.blockingExplainArtifact?.compileFingerprint ??
    params.runArtifact?.compileFingerprint;

  if (!plan || !graphId || !runId || !compileFingerprint) {
    return null;
  }

  const linkageByNodeId = new Map(
    (params.compileRunLinkArtifact?.nodes ?? []).map((node) => [
      node.nodeId,
      node,
    ]),
  );
  const inputByNodeId = new Map(
    (params.inputResolutionArtifact?.nodes ?? []).map((node) => [
      node.nodeId,
      node,
    ]),
  );
  const nodeExecutionByNodeId = new Map(
    (params.nodeExecutionDispositionExplainArtifact?.nodes ?? []).map(
      (node) => [node.nodeId, node],
    ),
  );
  const dependencyReadinessByNodeId = new Map(
    (params.dependencyReadinessExplainArtifact?.nodes ?? []).map((node) => [
      node.nodeId,
      node,
    ]),
  );
  const failureByNodeId = new Map(
    (params.failureExplainArtifact?.nodes ?? []).map((node) => [
      node.nodeId,
      node,
    ]),
  );

  const nodes: GraphExecutionFrontierNodeRecordV1[] = plan.nodes.map(
    (planNode) =>
      inferNodeRecord({
        planNode,
        linkageNode: linkageByNodeId.get(planNode.nodeId),
        linkageByNodeId,
        inputNode: inputByNodeId.get(planNode.nodeId),
        nodeExecutionNode: nodeExecutionByNodeId.get(planNode.nodeId),
        dependencyReadinessNode: dependencyReadinessByNodeId.get(
          planNode.nodeId,
        ),
        failureNode: failureByNodeId.get(planNode.nodeId),
        blockingArtifact: params.blockingExplainArtifact ?? null,
      }),
  );

  const artifact = normalizeArtifact({
    graphId,
    runId,
    compileFingerprint,
    fingerprintVersion: 1,
    nodeCount: plan.fingerprintSource?.nodeCount ?? plan.nodes.length,
    summary: deriveSummaryFromNodes(nodes),
    nodes,
  });

  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_execution_frontier_explain_artifact",
    version: "v1",
    artifact,
  };
}

function toEnvelopeFromLegacyRecord(
  value: Record<string, unknown>,
): GraphExecutionFrontierExplainArtifactEnvelope | null {
  const artifact = normalizeArtifact(
    value.graph_execution_frontier_explain_artifact ??
      value.graph_execution_frontier_explain,
  );
  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_execution_frontier_explain_artifact",
    version: "v1",
    artifact,
  };
}

export function readGraphExecutionFrontierExplainArtifactEnvelope(
  value: unknown,
): GraphExecutionFrontierExplainArtifactEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.kind === "graph_execution_frontier_explain_artifact" &&
    value.version === "v1"
  ) {
    const artifact = normalizeArtifact(value.artifact);
    return artifact
      ? {
          kind: "graph_execution_frontier_explain_artifact",
          version: "v1",
          artifact,
        }
      : null;
  }

  if (isRecord(value.bridge)) {
    return readGraphExecutionFrontierExplainArtifactEnvelope(value.bridge);
  }

  if (isRecord(value.graph_execution_frontier_explain_artifact)) {
    return readGraphExecutionFrontierExplainArtifactEnvelope(
      value.graph_execution_frontier_explain_artifact,
    );
  }

  if (
    "graph_execution_frontier_explain_artifact" in value ||
    "graph_execution_frontier_explain" in value
  ) {
    return toEnvelopeFromLegacyRecord(value);
  }

  return null;
}
