import type {
  GraphBlockingExplainArtifactV1,
  GraphCompilePlan,
  GraphCompileRunLinkArtifactV1,
  GraphCompileRunLinkDispositionV1,
  GraphFailureExplainArtifactV1,
  GraphNodeExecutionDecisionReason,
  GraphNodeExecutionDispositionEvidenceSourceV1,
  GraphNodeExecutionDispositionExplainArtifactEnvelope,
  GraphNodeExecutionDispositionExplainArtifactV1,
  GraphNodeExecutionDispositionRecordV1,
  GraphNodeExecutionDispositionSummaryV1,
  GraphNodeExecutionDispositionV1,
  GraphNodeExecutionReasonKindV1,
  GraphNodeInputResolutionArtifactV1,
  GraphReuseExplainArtifactV1,
  GraphRunArtifact,
  GraphTerminalOutcomeExplainArtifactV1,
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

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toOptionalStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
}

const NODE_EXECUTION_DISPOSITION_EVIDENCE_SOURCES: GraphNodeExecutionDispositionEvidenceSourceV1[] =
  [
    "compile_run_link",
    "input_resolution",
    "reuse_explain",
    "failure_explain",
    "terminal_outcome",
    "blocking_explain",
    "run_status",
  ];

function toDisposition(
  value: unknown,
  fallback: GraphNodeExecutionDispositionV1 = "unknown",
): GraphNodeExecutionDispositionV1 {
  return value === "executed" ||
    value === "skipped_reuse" ||
    value === "failed" ||
    value === "not_reached" ||
    value === "blocked" ||
    value === "unknown"
    ? value
    : fallback;
}

function toReasonKind(
  value: unknown,
  fallback: GraphNodeExecutionReasonKindV1 = "unknown",
): GraphNodeExecutionReasonKindV1 {
  return value === "executed_by_decision" ||
    value === "executed_despite_reuse_eligibility" ||
    value === "reuse_skip" ||
    value === "control_flow_inactive" ||
    value === "retry_exhausted" ||
    value === "dependency_not_reached" ||
    value === "input_missing_or_unresolved" ||
    value === "truncated_by_failure" ||
    value === "non_terminal_blocked" ||
    value === "terminal_projection_only" ||
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

function toEvidenceSources(
  value: unknown,
): GraphNodeExecutionDispositionEvidenceSourceV1[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is GraphNodeExecutionDispositionEvidenceSourceV1 =>
          typeof entry === "string" &&
          NODE_EXECUTION_DISPOSITION_EVIDENCE_SOURCES.includes(
            entry as GraphNodeExecutionDispositionEvidenceSourceV1,
          ),
      )
    : [];
}

function toReuseDecision(
  value: unknown,
): GraphNodeExecutionDecisionReason | undefined {
  return value === "feature_disabled" ||
    value === "inactive_control_flow" ||
    value === "ineligible_reuse_verdict" ||
    value === "ineligible_capability" ||
    value === "ineligible_side_effect" ||
    value === "ineligible_source" ||
    value === "ineligible_terminal" ||
    value === "ineligible_fallback" ||
    value === "missing_baseline" ||
    value === "missing_reusable_outputs" ||
    value === "execute" ||
    value === "skip_reuse_outputs"
    ? value
    : undefined;
}

function toFailureStage(
  value: unknown,
): "validate" | "compile" | "execute" | undefined {
  return value === "validate" || value === "compile" || value === "execute"
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

function createEmptyReasonCounts(): Record<
  GraphNodeExecutionReasonKindV1,
  number
> {
  return {
    executed_by_decision: 0,
    executed_despite_reuse_eligibility: 0,
    reuse_skip: 0,
    control_flow_inactive: 0,
    retry_exhausted: 0,
    dependency_not_reached: 0,
    input_missing_or_unresolved: 0,
    truncated_by_failure: 0,
    non_terminal_blocked: 0,
    terminal_projection_only: 0,
    unknown: 0,
  };
}

function createEmptySummary(): GraphNodeExecutionDispositionSummaryV1 {
  return {
    nodeCounts: {
      executed: 0,
      skippedReuse: 0,
      failed: 0,
      notReached: 0,
      blocked: 0,
      unknown: 0,
    },
    reasonCounts: createEmptyReasonCounts(),
    evidenceSources: [],
  };
}

function pushEvidenceSource(
  target: Set<GraphNodeExecutionDispositionEvidenceSourceV1>,
  source: GraphNodeExecutionDispositionEvidenceSourceV1,
): void {
  target.add(source);
}

function deriveSummaryFromNodes(
  nodes: readonly GraphNodeExecutionDispositionRecordV1[],
): GraphNodeExecutionDispositionSummaryV1 {
  const summary = createEmptySummary();
  const evidenceSources =
    new Set<GraphNodeExecutionDispositionEvidenceSourceV1>();

  for (const node of nodes) {
    switch (node.disposition) {
      case "executed":
        summary.nodeCounts.executed += 1;
        break;
      case "skipped_reuse":
        summary.nodeCounts.skippedReuse += 1;
        break;
      case "failed":
        summary.nodeCounts.failed += 1;
        break;
      case "not_reached":
        summary.nodeCounts.notReached += 1;
        break;
      case "blocked":
        summary.nodeCounts.blocked += 1;
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
): GraphNodeExecutionDispositionRecordV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const nodeId = toRequiredString(value.nodeId);
  const moduleId = toRequiredString(value.moduleId);
  const nodeFingerprint = toRequiredString(value.nodeFingerprint);
  if (!nodeId || !moduleId || !nodeFingerprint) {
    return null;
  }

  return {
    nodeId,
    moduleId,
    nodeFingerprint,
    compileOrder: toNonNegativeInt(value.compileOrder),
    disposition: toDisposition(value.disposition),
    primaryReasonKind: toReasonKind(value.primaryReasonKind),
    evidenceSources: toEvidenceSources(value.evidenceSources),
    ...(toOptionalStringArray(value.upstreamNodeIds).length > 0
      ? { upstreamNodeIds: toOptionalStringArray(value.upstreamNodeIds) }
      : {}),
    ...(toOptionalStringArray(value.relatedInputKeys).length > 0
      ? { relatedInputKeys: toOptionalStringArray(value.relatedInputKeys) }
      : {}),
    ...(toReuseDecision(value.reuseDecision)
      ? { reuseDecision: toReuseDecision(value.reuseDecision) }
      : {}),
    ...(toRunDisposition(value.runDisposition)
      ? { runDisposition: toRunDisposition(value.runDisposition) }
      : {}),
    ...(toFailureStage(value.failureStage)
      ? { failureStage: toFailureStage(value.failureStage) }
      : {}),
    ...(toRunStatus(value.blockedByRunStatus)
      ? { blockedByRunStatus: toRunStatus(value.blockedByRunStatus) }
      : {}),
  };
}

function normalizeSummary(
  value: unknown,
  fallback: GraphNodeExecutionDispositionSummaryV1,
): GraphNodeExecutionDispositionSummaryV1 {
  if (!isRecord(value)) {
    return fallback;
  }

  const nodeCounts = isRecord(value.nodeCounts) ? value.nodeCounts : null;
  const reasonCounts = isRecord(value.reasonCounts) ? value.reasonCounts : null;
  const normalizedReasonCounts = createEmptyReasonCounts();

  for (const key of Object.keys(
    normalizedReasonCounts,
  ) as GraphNodeExecutionReasonKindV1[]) {
    normalizedReasonCounts[key] = toNonNegativeInt(
      reasonCounts?.[key],
      fallback.reasonCounts[key],
    );
  }

  return {
    nodeCounts: {
      executed: toNonNegativeInt(
        nodeCounts?.executed,
        fallback.nodeCounts.executed,
      ),
      skippedReuse: toNonNegativeInt(
        nodeCounts?.skippedReuse,
        fallback.nodeCounts.skippedReuse,
      ),
      failed: toNonNegativeInt(nodeCounts?.failed, fallback.nodeCounts.failed),
      notReached: toNonNegativeInt(
        nodeCounts?.notReached,
        fallback.nodeCounts.notReached,
      ),
      blocked: toNonNegativeInt(
        nodeCounts?.blocked,
        fallback.nodeCounts.blocked,
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
): GraphNodeExecutionDispositionExplainArtifactV1 | null {
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
          (node): node is GraphNodeExecutionDispositionRecordV1 =>
            node !== null,
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

function collectMissingInputKeys(
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
  inputNode?: GraphNodeInputResolutionArtifactV1["nodes"][number];
  reuseNode?: GraphReuseExplainArtifactV1["nodes"][number];
  failureNode?: GraphFailureExplainArtifactV1["nodes"][number];
  terminalNode?: GraphTerminalOutcomeExplainArtifactV1["nodes"][number];
  blockingArtifact?: GraphBlockingExplainArtifactV1 | null;
  dispositionByNodeId: Map<string, GraphNodeExecutionDispositionV1>;
}): GraphNodeExecutionDispositionRecordV1 {
  const {
    planNode,
    linkageNode,
    inputNode,
    reuseNode,
    failureNode,
    terminalNode,
    blockingArtifact,
    dispositionByNodeId,
  } = params;

  const evidenceSources =
    new Set<GraphNodeExecutionDispositionEvidenceSourceV1>();
  const runDisposition = linkageNode?.runDisposition;
  const missingInputKeys = collectMissingInputKeys(inputNode);
  const upstreamNodeIds = [...planNode.dependsOn];
  const nonTerminalBlocked =
    blockingArtifact?.summary.blockingDisposition === "blocked" ||
    blockingArtifact?.summary.blockingDisposition === "waiting_user" ||
    blockingArtifact?.summary.blockingDisposition === "running" ||
    (blockingArtifact?.summary.runStatus === "waiting_user" &&
      blockingArtifact.summary.phase === "blocked");
  const runStatus = blockingArtifact?.summary.runStatus;
  const runFailedOrCancelled =
    runStatus === "failed" || runStatus === "cancelled";
  const dependencyBlocked = upstreamNodeIds.some((nodeId) => {
    const upstreamDisposition = dispositionByNodeId.get(nodeId);
    return (
      upstreamDisposition === "not_reached" ||
      upstreamDisposition === "blocked" ||
      upstreamDisposition === "unknown" ||
      upstreamDisposition === "failed"
    );
  });

  if (linkageNode) {
    pushEvidenceSource(evidenceSources, "compile_run_link");
  }
  if (inputNode) {
    pushEvidenceSource(evidenceSources, "input_resolution");
  }
  if (reuseNode) {
    pushEvidenceSource(evidenceSources, "reuse_explain");
  }
  if (failureNode) {
    pushEvidenceSource(evidenceSources, "failure_explain");
  }
  if (terminalNode) {
    pushEvidenceSource(evidenceSources, "terminal_outcome");
  }
  if (blockingArtifact) {
    pushEvidenceSource(evidenceSources, "blocking_explain");
    pushEvidenceSource(evidenceSources, "run_status");
  }

  const base: GraphNodeExecutionDispositionRecordV1 = {
    nodeId: planNode.nodeId,
    moduleId: planNode.moduleId,
    nodeFingerprint: planNode.nodeFingerprint,
    compileOrder: planNode.order,
    disposition: "unknown",
    primaryReasonKind: "unknown",
    evidenceSources: [...evidenceSources],
    ...(upstreamNodeIds.length > 0 ? { upstreamNodeIds } : {}),
    ...(missingInputKeys.length > 0
      ? { relatedInputKeys: missingInputKeys }
      : {}),
    ...(reuseNode?.executionDecision
      ? { reuseDecision: reuseNode.executionDecision }
      : {}),
    ...(runDisposition ? { runDisposition } : {}),
    ...(failureNode?.stage && failureNode.stage !== "unknown"
      ? { failureStage: failureNode.stage }
      : {}),
    ...(runStatus ? { blockedByRunStatus: runStatus } : {}),
  };

  if (
    runDisposition === "executed" &&
    reuseNode?.finalReuseDisposition === "skipped_reuse"
  ) {
    return base;
  }

  if (runDisposition === "executed") {
    return {
      ...base,
      disposition: "executed",
      primaryReasonKind:
        reuseNode?.finalReuseDisposition === "eligible_but_executed"
          ? "executed_despite_reuse_eligibility"
          : "executed_by_decision",
    };
  }

  if (runDisposition === "skipped_reuse") {
    return {
      ...base,
      disposition:
        reuseNode?.finalReuseDisposition &&
        reuseNode.finalReuseDisposition !== "skipped_reuse"
          ? "unknown"
          : "skipped_reuse",
      primaryReasonKind:
        reuseNode?.finalReuseDisposition &&
        reuseNode.finalReuseDisposition !== "skipped_reuse"
          ? "unknown"
          : "reuse_skip",
    };
  }

  if (runDisposition === "failed") {
    return {
      ...base,
      disposition:
        failureNode && failureNode.failureDisposition === "not_reached"
          ? "unknown"
          : "failed",
      primaryReasonKind:
        failureNode?.failureReasonKind === "retry_exhausted"
          ? "retry_exhausted"
          : "unknown",
    };
  }

  const terminalProjectionOnly =
    runDisposition === "not_reached" &&
    terminalNode !== undefined &&
    terminalNode.runDisposition === "not_reached" &&
    terminalNode.includedInTerminalProjection === true;

  if (terminalProjectionOnly) {
    return {
      ...base,
      disposition: "not_reached",
      primaryReasonKind: "terminal_projection_only",
    };
  }

  if (runDisposition === "not_reached") {
    if (reuseNode?.executionDecision === "inactive_control_flow") {
      return {
        ...base,
        disposition: "blocked",
        primaryReasonKind: "control_flow_inactive",
      };
    }

    if (
      missingInputKeys.length > 0 &&
      dependencyBlocked &&
      !runFailedOrCancelled &&
      !nonTerminalBlocked
    ) {
      return base;
    }

    if (missingInputKeys.length > 0 && !dependencyBlocked) {
      return {
        ...base,
        disposition: nonTerminalBlocked ? "blocked" : "unknown",
        primaryReasonKind: nonTerminalBlocked
          ? "input_missing_or_unresolved"
          : "unknown",
      };
    }

    if (
      failureNode?.failureDisposition === "not_reached" &&
      runFailedOrCancelled
    ) {
      return {
        ...base,
        disposition: "not_reached",
        primaryReasonKind: "truncated_by_failure",
      };
    }

    if (
      failureNode?.failureReasonKind === "dependency_not_reached" ||
      dependencyBlocked
    ) {
      return {
        ...base,
        disposition: "not_reached",
        primaryReasonKind: "dependency_not_reached",
      };
    }

    if (nonTerminalBlocked) {
      return {
        ...base,
        disposition: "blocked",
        primaryReasonKind: "non_terminal_blocked",
      };
    }
  }

  if (nonTerminalBlocked && runDisposition === undefined) {
    return {
      ...base,
      disposition: "blocked",
      primaryReasonKind: missingInputKeys.length
        ? "input_missing_or_unresolved"
        : "non_terminal_blocked",
    };
  }

  return base;
}

export function createGraphNodeExecutionDispositionExplainArtifactEnvelope(params: {
  plan?: GraphCompilePlan | null;
  runArtifact?: GraphRunArtifact | null;
  compileRunLinkArtifact?: GraphCompileRunLinkArtifactV1 | null;
  inputResolutionArtifact?: GraphNodeInputResolutionArtifactV1 | null;
  reuseExplainArtifact?: GraphReuseExplainArtifactV1 | null;
  failureExplainArtifact?: GraphFailureExplainArtifactV1 | null;
  terminalOutcomeExplainArtifact?: GraphTerminalOutcomeExplainArtifactV1 | null;
  blockingExplainArtifact?: GraphBlockingExplainArtifactV1 | null;
}): GraphNodeExecutionDispositionExplainArtifactEnvelope | null {
  const plan = params.plan;
  const graphId =
    plan?.fingerprintSource?.graphId ??
    params.compileRunLinkArtifact?.graphId ??
    params.inputResolutionArtifact?.graphId ??
    params.reuseExplainArtifact?.graphId ??
    params.failureExplainArtifact?.graphId ??
    params.terminalOutcomeExplainArtifact?.graphId ??
    params.blockingExplainArtifact?.graphId ??
    params.runArtifact?.graphId;
  const runId =
    params.runArtifact?.runId ??
    params.compileRunLinkArtifact?.runId ??
    params.inputResolutionArtifact?.runId ??
    params.reuseExplainArtifact?.runId ??
    params.failureExplainArtifact?.runId ??
    params.terminalOutcomeExplainArtifact?.runId ??
    params.blockingExplainArtifact?.runId;
  const compileFingerprint =
    plan?.compileFingerprint ??
    params.compileRunLinkArtifact?.compileFingerprint ??
    params.inputResolutionArtifact?.compileFingerprint ??
    params.reuseExplainArtifact?.compileFingerprint ??
    params.failureExplainArtifact?.compileFingerprint ??
    params.terminalOutcomeExplainArtifact?.compileFingerprint ??
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
  const reuseByNodeId = new Map(
    (params.reuseExplainArtifact?.nodes ?? []).map((node) => [
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
  const terminalByNodeId = new Map(
    (params.terminalOutcomeExplainArtifact?.nodes ?? []).map((node) => [
      node.nodeId,
      node,
    ]),
  );

  const dispositionByNodeId = new Map<
    string,
    GraphNodeExecutionDispositionV1
  >();
  const nodes: GraphNodeExecutionDispositionRecordV1[] = [];

  for (const planNode of plan.nodes) {
    const nodeRecord = inferNodeRecord({
      planNode,
      linkageNode: linkageByNodeId.get(planNode.nodeId),
      inputNode: inputByNodeId.get(planNode.nodeId),
      reuseNode: reuseByNodeId.get(planNode.nodeId),
      failureNode: failureByNodeId.get(planNode.nodeId),
      terminalNode: terminalByNodeId.get(planNode.nodeId),
      blockingArtifact: params.blockingExplainArtifact ?? null,
      dispositionByNodeId,
    });
    nodes.push(nodeRecord);
    dispositionByNodeId.set(planNode.nodeId, nodeRecord.disposition);
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
    kind: "graph_node_execution_disposition_explain_artifact",
    version: "v1",
    artifact,
  };
}

function toEnvelopeFromLegacyRecord(
  value: Record<string, unknown>,
): GraphNodeExecutionDispositionExplainArtifactEnvelope | null {
  const artifact = normalizeArtifact(
    value.graph_node_execution_disposition_explain_artifact ??
      value.graph_node_execution_disposition_explain,
  );
  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_node_execution_disposition_explain_artifact",
    version: "v1",
    artifact,
  };
}

export function readGraphNodeExecutionDispositionExplainArtifactEnvelope(
  value: unknown,
): GraphNodeExecutionDispositionExplainArtifactEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.kind === "graph_node_execution_disposition_explain_artifact" &&
    value.version === "v1"
  ) {
    const artifact = normalizeArtifact(value.artifact);
    return artifact
      ? {
          kind: "graph_node_execution_disposition_explain_artifact",
          version: "v1",
          artifact,
        }
      : null;
  }

  if (isRecord(value.bridge)) {
    return readGraphNodeExecutionDispositionExplainArtifactEnvelope(
      value.bridge,
    );
  }

  if (isRecord(value.graph_node_execution_disposition_explain_artifact)) {
    return readGraphNodeExecutionDispositionExplainArtifactEnvelope(
      value.graph_node_execution_disposition_explain_artifact,
    );
  }

  if (
    "graph_node_execution_disposition_explain_artifact" in value ||
    "graph_node_execution_disposition_explain" in value
  ) {
    return toEnvelopeFromLegacyRecord(value);
  }

  return null;
}
