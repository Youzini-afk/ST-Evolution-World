import type {
  GraphBlockingExplainArtifactV1,
  GraphCompilePlan,
  GraphCompileRunLinkArtifactV1,
  GraphCompileRunLinkDispositionV1,
  GraphDependencyReadinessDispositionV1,
  GraphDependencyReadinessEvidenceSourceV1,
  GraphDependencyReadinessExplainArtifactEnvelope,
  GraphDependencyReadinessExplainArtifactV1,
  GraphDependencyReadinessNodeRecordV1,
  GraphDependencyReadinessReasonKindV1,
  GraphDependencyReadinessSummaryV1,
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

const DEPENDENCY_READINESS_EVIDENCE_SOURCES: GraphDependencyReadinessEvidenceSourceV1[] =
  [
    "compile_run_link",
    "input_resolution",
    "node_execution_disposition",
    "failure_explain",
    "blocking_explain",
    "run_status",
  ];

function toDisposition(
  value: unknown,
  fallback: GraphDependencyReadinessDispositionV1 = "unknown",
): GraphDependencyReadinessDispositionV1 {
  return value === "ready" ||
    value === "not_ready_dependency" ||
    value === "not_ready_input" ||
    value === "blocked_non_terminal" ||
    value === "truncated_by_failure" ||
    value === "unknown"
    ? value
    : fallback;
}

function toReasonKind(
  value: unknown,
  fallback: GraphDependencyReadinessReasonKindV1 = "unknown",
): GraphDependencyReadinessReasonKindV1 {
  return value === "all_prerequisites_satisfied" ||
    value === "control_flow_inactive" ||
    value === "dependency_not_ready" ||
    value === "missing_or_unresolved_input" ||
    value === "non_terminal_blocked" ||
    value === "truncated_by_failure" ||
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
): GraphDependencyReadinessEvidenceSourceV1[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is GraphDependencyReadinessEvidenceSourceV1 =>
          typeof entry === "string" &&
          DEPENDENCY_READINESS_EVIDENCE_SOURCES.includes(
            entry as GraphDependencyReadinessEvidenceSourceV1,
          ),
      )
    : [];
}

function createEmptyReasonCounts(): Record<
  GraphDependencyReadinessReasonKindV1,
  number
> {
  return {
    all_prerequisites_satisfied: 0,
    control_flow_inactive: 0,
    dependency_not_ready: 0,
    missing_or_unresolved_input: 0,
    non_terminal_blocked: 0,
    truncated_by_failure: 0,
    unknown: 0,
  };
}

function createEmptySummary(): GraphDependencyReadinessSummaryV1 {
  return {
    nodeCounts: {
      ready: 0,
      notReadyDependency: 0,
      notReadyInput: 0,
      blockedNonTerminal: 0,
      truncatedByFailure: 0,
      unknown: 0,
    },
    reasonCounts: createEmptyReasonCounts(),
    evidenceSources: [],
  };
}

function pushEvidenceSource(
  target: Set<GraphDependencyReadinessEvidenceSourceV1>,
  source: GraphDependencyReadinessEvidenceSourceV1,
): void {
  target.add(source);
}

function deriveSummaryFromNodes(
  nodes: readonly GraphDependencyReadinessNodeRecordV1[],
): GraphDependencyReadinessSummaryV1 {
  const summary = createEmptySummary();
  const evidenceSources = new Set<GraphDependencyReadinessEvidenceSourceV1>();

  for (const node of nodes) {
    switch (node.readinessDisposition) {
      case "ready":
        summary.nodeCounts.ready += 1;
        break;
      case "not_ready_dependency":
        summary.nodeCounts.notReadyDependency += 1;
        break;
      case "not_ready_input":
        summary.nodeCounts.notReadyInput += 1;
        break;
      case "blocked_non_terminal":
        summary.nodeCounts.blockedNonTerminal += 1;
        break;
      case "truncated_by_failure":
        summary.nodeCounts.truncatedByFailure += 1;
        break;
      default:
        summary.nodeCounts.unknown += 1;
        break;
    }

    summary.reasonCounts[node.primaryReasonKind] += 1;
    for (const source of node.readinessEvidenceSources) {
      pushEvidenceSource(evidenceSources, source);
    }
  }

  summary.evidenceSources = [...evidenceSources];
  return summary;
}

function normalizeNodeRecord(
  value: unknown,
): GraphDependencyReadinessNodeRecordV1 | null {
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
    readinessDisposition: toDisposition(value.readinessDisposition),
    primaryReasonKind: toReasonKind(value.primaryReasonKind),
    readinessEvidenceSources: toEvidenceSources(value.readinessEvidenceSources),
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
  fallback: GraphDependencyReadinessSummaryV1,
): GraphDependencyReadinessSummaryV1 {
  if (!isRecord(value)) {
    return fallback;
  }

  const nodeCounts = isRecord(value.nodeCounts) ? value.nodeCounts : null;
  const reasonCounts = isRecord(value.reasonCounts) ? value.reasonCounts : null;
  const normalizedReasonCounts = createEmptyReasonCounts();

  for (const key of Object.keys(
    normalizedReasonCounts,
  ) as GraphDependencyReadinessReasonKindV1[]) {
    normalizedReasonCounts[key] = toNonNegativeInt(
      reasonCounts?.[key],
      fallback.reasonCounts[key],
    );
  }

  return {
    nodeCounts: {
      ready: toNonNegativeInt(nodeCounts?.ready, fallback.nodeCounts.ready),
      notReadyDependency: toNonNegativeInt(
        nodeCounts?.notReadyDependency,
        fallback.nodeCounts.notReadyDependency,
      ),
      notReadyInput: toNonNegativeInt(
        nodeCounts?.notReadyInput,
        fallback.nodeCounts.notReadyInput,
      ),
      blockedNonTerminal: toNonNegativeInt(
        nodeCounts?.blockedNonTerminal,
        fallback.nodeCounts.blockedNonTerminal,
      ),
      truncatedByFailure: toNonNegativeInt(
        nodeCounts?.truncatedByFailure,
        fallback.nodeCounts.truncatedByFailure,
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
): GraphDependencyReadinessExplainArtifactV1 | null {
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
          (node): node is GraphDependencyReadinessNodeRecordV1 => node !== null,
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
  failureNode?: GraphFailureExplainArtifactV1["nodes"][number];
  blockingArtifact?: GraphBlockingExplainArtifactV1 | null;
  readinessByNodeId: Map<string, GraphDependencyReadinessDispositionV1>;
}): GraphDependencyReadinessNodeRecordV1 {
  const {
    planNode,
    linkageNode,
    linkageByNodeId,
    inputNode,
    nodeExecutionNode,
    failureNode,
    blockingArtifact,
    readinessByNodeId,
  } = params;

  const evidenceSources = new Set<GraphDependencyReadinessEvidenceSourceV1>();
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
    const readiness = readinessByNodeId.get(nodeId);
    return (
      readiness === "not_ready_dependency" ||
      readiness === "not_ready_input" ||
      readiness === "blocked_non_terminal" ||
      readiness === "truncated_by_failure" ||
      readiness === "unknown"
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
  if (failureNode) {
    pushEvidenceSource(evidenceSources, "failure_explain");
  }
  if (blockingArtifact) {
    pushEvidenceSource(evidenceSources, "blocking_explain");
    pushEvidenceSource(evidenceSources, "run_status");
  }

  const base: GraphDependencyReadinessNodeRecordV1 = {
    nodeId: planNode.nodeId,
    moduleId: planNode.moduleId,
    nodeFingerprint: planNode.nodeFingerprint,
    compileOrder: planNode.order,
    readinessDisposition: "unknown",
    primaryReasonKind: "unknown",
    readinessEvidenceSources: [...evidenceSources],
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
    return {
      ...base,
      readinessDisposition: "ready",
      primaryReasonKind: "all_prerequisites_satisfied",
    };
  }

  if (
    nodeExecutionNode?.primaryReasonKind === "dependency_not_reached" &&
    unresolvedInputKeys.length > 0
  ) {
    return base;
  }

  if (
    nodeExecutionNode?.primaryReasonKind === "control_flow_inactive" &&
    (runDisposition === "not_reached" || !runDisposition)
  ) {
    return {
      ...base,
      readinessDisposition: "blocked_non_terminal",
      primaryReasonKind: "control_flow_inactive",
    };
  }

  if (
    (runStatus === "failed" || runStatus === "cancelled") &&
    failureNode?.failureDisposition === "not_reached"
  ) {
    if (
      blockingDependencyNodeIds.length > 0 ||
      unresolvedInputKeys.length > 0
    ) {
      return base;
    }
    return {
      ...base,
      readinessDisposition: "truncated_by_failure",
      primaryReasonKind: "truncated_by_failure",
    };
  }

  if (blockingDependencyNodeIds.length > 0) {
    if (unresolvedInputKeys.length > 0) {
      return base;
    }
    return {
      ...base,
      readinessDisposition: "not_ready_dependency",
      primaryReasonKind: "dependency_not_ready",
    };
  }

  if (unresolvedInputKeys.length > 0) {
    if (nonTerminalBlocked || runStatus === "waiting_user") {
      return base;
    }
    return {
      ...base,
      readinessDisposition: "not_ready_input",
      primaryReasonKind: "missing_or_unresolved_input",
    };
  }

  if (
    nonTerminalBlocked &&
    (runDisposition === "not_reached" || !runDisposition)
  ) {
    return {
      ...base,
      readinessDisposition: "blocked_non_terminal",
      primaryReasonKind: "non_terminal_blocked",
    };
  }

  if (
    inputNode &&
    unresolvedInputKeys.length === 0 &&
    blockingDependencyNodeIds.length === 0 &&
    !nonTerminalBlocked
  ) {
    return {
      ...base,
      readinessDisposition: "ready",
      primaryReasonKind: "all_prerequisites_satisfied",
    };
  }

  return base;
}

export function createGraphDependencyReadinessExplainArtifactEnvelope(params: {
  plan?: GraphCompilePlan | null;
  runArtifact?: GraphRunArtifact | null;
  compileRunLinkArtifact?: GraphCompileRunLinkArtifactV1 | null;
  inputResolutionArtifact?: GraphNodeInputResolutionArtifactV1 | null;
  nodeExecutionDispositionExplainArtifact?: GraphNodeExecutionDispositionExplainArtifactV1 | null;
  failureExplainArtifact?: GraphFailureExplainArtifactV1 | null;
  blockingExplainArtifact?: GraphBlockingExplainArtifactV1 | null;
}): GraphDependencyReadinessExplainArtifactEnvelope | null {
  const plan = params.plan;
  const graphId =
    plan?.fingerprintSource?.graphId ??
    params.compileRunLinkArtifact?.graphId ??
    params.inputResolutionArtifact?.graphId ??
    params.nodeExecutionDispositionExplainArtifact?.graphId ??
    params.failureExplainArtifact?.graphId ??
    params.blockingExplainArtifact?.graphId ??
    params.runArtifact?.graphId;
  const runId =
    params.runArtifact?.runId ??
    params.compileRunLinkArtifact?.runId ??
    params.inputResolutionArtifact?.runId ??
    params.nodeExecutionDispositionExplainArtifact?.runId ??
    params.failureExplainArtifact?.runId ??
    params.blockingExplainArtifact?.runId;
  const compileFingerprint =
    plan?.compileFingerprint ??
    params.compileRunLinkArtifact?.compileFingerprint ??
    params.inputResolutionArtifact?.compileFingerprint ??
    params.nodeExecutionDispositionExplainArtifact?.compileFingerprint ??
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
  const failureByNodeId = new Map(
    (params.failureExplainArtifact?.nodes ?? []).map((node) => [
      node.nodeId,
      node,
    ]),
  );

  const readinessByNodeId = new Map<
    string,
    GraphDependencyReadinessDispositionV1
  >();
  const nodes: GraphDependencyReadinessNodeRecordV1[] = [];

  for (const planNode of plan.nodes) {
    const nodeRecord = inferNodeRecord({
      planNode,
      linkageNode: linkageByNodeId.get(planNode.nodeId),
      linkageByNodeId,
      inputNode: inputByNodeId.get(planNode.nodeId),
      nodeExecutionNode: nodeExecutionByNodeId.get(planNode.nodeId),
      failureNode: failureByNodeId.get(planNode.nodeId),
      blockingArtifact: params.blockingExplainArtifact ?? null,
      readinessByNodeId,
    });
    nodes.push(nodeRecord);
    readinessByNodeId.set(planNode.nodeId, nodeRecord.readinessDisposition);
  }

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
    kind: "graph_dependency_readiness_explain_artifact",
    version: "v1",
    artifact,
  };
}

function toEnvelopeFromLegacyRecord(
  value: Record<string, unknown>,
): GraphDependencyReadinessExplainArtifactEnvelope | null {
  const artifact = normalizeArtifact(
    value.graph_dependency_readiness_explain_artifact ??
      value.graph_dependency_readiness_explain,
  );
  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_dependency_readiness_explain_artifact",
    version: "v1",
    artifact,
  };
}

export function readGraphDependencyReadinessExplainArtifactEnvelope(
  value: unknown,
): GraphDependencyReadinessExplainArtifactEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.kind === "graph_dependency_readiness_explain_artifact" &&
    value.version === "v1"
  ) {
    const artifact = normalizeArtifact(value.artifact);
    return artifact
      ? {
          kind: "graph_dependency_readiness_explain_artifact",
          version: "v1",
          artifact,
        }
      : null;
  }

  if (isRecord(value.bridge)) {
    return readGraphDependencyReadinessExplainArtifactEnvelope(value.bridge);
  }

  if (isRecord(value.graph_dependency_readiness_explain_artifact)) {
    return readGraphDependencyReadinessExplainArtifactEnvelope(
      value.graph_dependency_readiness_explain_artifact,
    );
  }

  if (
    "graph_dependency_readiness_explain_artifact" in value ||
    "graph_dependency_readiness_explain" in value
  ) {
    return toEnvelopeFromLegacyRecord(value);
  }

  return null;
}
