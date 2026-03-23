import type {
  GraphCompilePlan,
  GraphCompileRunLinkArtifactV1,
  GraphExecutionResult,
  GraphFailureExplainArtifactEnvelope,
  GraphFailureExplainArtifactV1,
  GraphFailureExplainDispositionV1,
  GraphFailureExplainEvidenceSourceV1,
  GraphFailureExplainKindV1,
  GraphFailureExplainNodeRecordV1,
  GraphFailureExplainReasonKindV1,
  GraphFailureExplainStageV1,
  GraphFailureExplainSummaryV1,
  GraphHostEffectExplainArtifactV1,
  GraphNodeInputResolutionArtifactV1,
  GraphNodeTrace,
  GraphOutputExplainArtifactV1,
  GraphReuseExplainArtifactV1,
  GraphRunArtifact,
  ModuleExecutionResult,
} from "../ui/components/graph/module-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toRequiredString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

const FAILURE_EXPLAIN_EVIDENCE_SOURCES: GraphFailureExplainEvidenceSourceV1[] =
  [
    "run_status",
    "failed_stage",
    "run_error_summary",
    "run_latest_node",
    "node_trace_error",
    "module_result_error",
    "compile_run_link",
    "input_resolution",
    "output_explain",
    "host_effect_explain",
    "reuse_explain",
  ];

function toFailureStage(value: unknown): GraphFailureExplainStageV1 {
  return value === "validate" || value === "compile" || value === "execute"
    ? value
    : "unknown";
}

function toFailureKind(value: unknown): GraphFailureExplainKindV1 {
  return value === "none" ||
    value === "validation_error" ||
    value === "compile_error" ||
    value === "runtime_error" ||
    value === "unknown"
    ? value
    : "unknown";
}

function toFailureReasonKind(value: unknown): GraphFailureExplainReasonKindV1 {
  return value === "none" ||
    value === "validation_error" ||
    value === "compile_error" ||
    value === "runtime_error" ||
    value === "dependency_not_reached" ||
    value === "unknown"
    ? value
    : "unknown";
}

function toFailureDisposition(
  value: unknown,
): GraphFailureExplainDispositionV1 {
  return value === "not_failed" || value === "failed" || value === "not_reached"
    ? value
    : "not_failed";
}

function toEvidenceSources(
  value: unknown,
): GraphFailureExplainEvidenceSourceV1[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is GraphFailureExplainEvidenceSourceV1 =>
          typeof entry === "string" &&
          FAILURE_EXPLAIN_EVIDENCE_SOURCES.includes(
            entry as GraphFailureExplainEvidenceSourceV1,
          ),
      )
    : [];
}

function sanitizeErrorSummary(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? trimmed;
  const maxLength = 240;
  return firstLine.length > maxLength
    ? `${firstLine.slice(0, maxLength)}...`
    : firstLine;
}

function inferFailureKind(params: {
  runStatus?: GraphRunArtifact["status"];
  summary?: Pick<GraphFailureExplainSummaryV1, "failedStage"> | null;
}): GraphFailureExplainKindV1 {
  if (params.runStatus !== "failed") {
    return "none";
  }
  switch (params.summary?.failedStage) {
    case "validate":
      return "validation_error";
    case "compile":
      return "compile_error";
    case "execute":
      return "runtime_error";
    default:
      return "unknown";
  }
}

function inferNodeFailureReasonKind(params: {
  runDisposition: GraphFailureExplainNodeRecordV1["runDisposition"];
  stage: GraphFailureExplainStageV1;
}): GraphFailureExplainReasonKindV1 {
  if (params.runDisposition === "not_reached") {
    return "dependency_not_reached";
  }
  if (params.runDisposition !== "failed") {
    return "none";
  }
  switch (params.stage) {
    case "validate":
      return "validation_error";
    case "compile":
      return "compile_error";
    case "execute":
      return "runtime_error";
    default:
      return "unknown";
  }
}

function toModuleResultMap(
  result?: Pick<GraphExecutionResult, "moduleResults"> | null,
): Map<string, ModuleExecutionResult> {
  return new Map(
    (result?.moduleResults ?? []).map((moduleResult) => [
      moduleResult.nodeId,
      moduleResult,
    ]),
  );
}

function toNodeTraceMap(
  result?: Pick<GraphExecutionResult, "nodeTraces"> | null,
): Map<string, GraphNodeTrace> {
  return new Map(
    (result?.nodeTraces ?? []).map((trace) => [trace.nodeId, trace]),
  );
}

function toInputResolutionNodeIds(
  artifact?: GraphNodeInputResolutionArtifactV1 | null,
): Set<string> {
  return new Set((artifact?.nodes ?? []).map((node) => node.nodeId));
}

function toOutputNodeMap(
  artifact?: GraphOutputExplainArtifactV1 | null,
): Map<string, GraphOutputExplainArtifactV1["nodes"][number]> {
  return new Map((artifact?.nodes ?? []).map((node) => [node.nodeId, node]));
}

function toHostEffectNodeMap(
  artifact?: GraphHostEffectExplainArtifactV1 | null,
): Map<string, GraphHostEffectExplainArtifactV1["nodes"][number]> {
  return new Map((artifact?.nodes ?? []).map((node) => [node.nodeId, node]));
}

function toReuseNodeMap(
  artifact?: GraphReuseExplainArtifactV1 | null,
): Map<string, GraphReuseExplainArtifactV1["nodes"][number]> {
  return new Map((artifact?.nodes ?? []).map((node) => [node.nodeId, node]));
}

function normalizeNodeRecord(
  value: unknown,
): GraphFailureExplainNodeRecordV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const nodeId = toRequiredString(value.nodeId);
  const moduleId = toRequiredString(value.moduleId);
  const nodeFingerprint = toRequiredString(value.nodeFingerprint);
  if (!nodeId || !moduleId || !nodeFingerprint) {
    return null;
  }

  const runDisposition =
    value.runDisposition === "executed" ||
    value.runDisposition === "skipped_reuse" ||
    value.runDisposition === "failed" ||
    value.runDisposition === "not_reached"
      ? value.runDisposition
      : "not_reached";
  const stage = toFailureStage(value.stage);

  return {
    nodeId,
    moduleId,
    nodeFingerprint,
    compileOrder: toNonNegativeInt(value.compileOrder),
    runDisposition,
    failureDisposition: toFailureDisposition(value.failureDisposition),
    failureObserved: value.failureObserved === true,
    stage,
    failureReasonKind: toFailureReasonKind(value.failureReasonKind),
    isTerminal: value.isTerminal === true,
    isSideEffect: value.isSideEffect === true,
    outputObservedBeforeFailure: value.outputObservedBeforeFailure === true,
    outputProjectionKind:
      value.outputProjectionKind === "final_output" ||
      value.outputProjectionKind === "intermediate_output" ||
      value.outputProjectionKind === "host_effect_only" ||
      value.outputProjectionKind === "no_observed_output" ||
      value.outputProjectionKind === "not_reached" ||
      value.outputProjectionKind === "failed"
        ? value.outputProjectionKind
        : "no_observed_output",
    producedHostEffectBeforeFailure:
      value.producedHostEffectBeforeFailure === true,
    hostEffectProjectionKind:
      value.hostEffectProjectionKind === "host_effect_only" ||
      value.hostEffectProjectionKind === "host_effect_and_output" ||
      value.hostEffectProjectionKind === "declared_only" ||
      value.hostEffectProjectionKind === "no_host_effect" ||
      value.hostEffectProjectionKind === "not_reached" ||
      value.hostEffectProjectionKind === "failed"
        ? value.hostEffectProjectionKind
        : "no_host_effect",
    inputResolutionObserved: value.inputResolutionObserved === true,
    reuseDisposition:
      value.reuseDisposition === "skipped_reuse" ||
      value.reuseDisposition === "eligible_but_executed" ||
      value.reuseDisposition === "ineligible_executed" ||
      value.reuseDisposition === "not_applicable"
        ? value.reuseDisposition
        : "not_applicable",
    ...(sanitizeErrorSummary(value.errorSummary)
      ? { errorSummary: sanitizeErrorSummary(value.errorSummary) }
      : {}),
  };
}

function deriveSummaryFromNodes(params: {
  runStatus?: GraphRunArtifact["status"];
  runErrorSummary?: string;
  nodes: readonly GraphFailureExplainNodeRecordV1[];
  failedStage: GraphFailureExplainStageV1;
  fallbackErrorSummary?: string;
  evidenceSources: readonly GraphFailureExplainEvidenceSourceV1[];
}): GraphFailureExplainSummaryV1 {
  const {
    runStatus,
    runErrorSummary,
    nodes,
    failedStage,
    fallbackErrorSummary,
    evidenceSources,
  } = params;
  const failedNodes = nodes.filter(
    (node) => node.failureDisposition === "failed",
  );
  const notReachedNodes = nodes.filter(
    (node) => node.failureDisposition === "not_reached",
  );
  const executedBeforeFailureNodes = nodes.filter(
    (node) =>
      node.runDisposition === "executed" ||
      node.runDisposition === "skipped_reuse",
  );
  const primaryFailedNode = failedNodes[0];
  const runFailed = runStatus === "failed";
  const errorSummary =
    sanitizeErrorSummary(primaryFailedNode?.errorSummary) ??
    sanitizeErrorSummary(runErrorSummary) ??
    sanitizeErrorSummary(fallbackErrorSummary);

  return {
    runFailed,
    failedStage,
    failureKind: inferFailureKind({
      runStatus,
      summary: { failedStage },
    }),
    ...(primaryFailedNode
      ? {
          primaryFailedNodeId: primaryFailedNode.nodeId,
          primaryFailedModuleId: primaryFailedNode.moduleId,
        }
      : {}),
    failedNodeCount: failedNodes.length,
    notReachedNodeCount: notReachedNodes.length,
    executedBeforeFailureNodeCount: executedBeforeFailureNodes.length,
    ...(errorSummary ? { errorSummary } : {}),
    failureEvidenceSources: [...evidenceSources],
  };
}

function normalizeSummary(
  value: unknown,
  fallback: GraphFailureExplainSummaryV1,
): GraphFailureExplainSummaryV1 {
  if (!isRecord(value)) {
    return fallback;
  }

  const evidenceSources = toEvidenceSources(value.failureEvidenceSources);

  return {
    runFailed:
      typeof value.runFailed === "boolean"
        ? value.runFailed
        : fallback.runFailed,
    failedStage:
      value.failedStage === undefined
        ? fallback.failedStage
        : toFailureStage(value.failedStage),
    failureKind:
      value.failureKind === undefined
        ? fallback.failureKind
        : toFailureKind(value.failureKind),
    ...(toOptionalString(value.primaryFailedNodeId)
      ? { primaryFailedNodeId: toOptionalString(value.primaryFailedNodeId) }
      : fallback.primaryFailedNodeId
        ? { primaryFailedNodeId: fallback.primaryFailedNodeId }
        : {}),
    ...(toOptionalString(value.primaryFailedModuleId)
      ? { primaryFailedModuleId: toOptionalString(value.primaryFailedModuleId) }
      : fallback.primaryFailedModuleId
        ? { primaryFailedModuleId: fallback.primaryFailedModuleId }
        : {}),
    failedNodeCount: toNonNegativeInt(
      value.failedNodeCount,
      fallback.failedNodeCount,
    ),
    notReachedNodeCount: toNonNegativeInt(
      value.notReachedNodeCount,
      fallback.notReachedNodeCount,
    ),
    executedBeforeFailureNodeCount: toNonNegativeInt(
      value.executedBeforeFailureNodeCount,
      fallback.executedBeforeFailureNodeCount,
    ),
    ...(sanitizeErrorSummary(value.errorSummary) || fallback.errorSummary
      ? {
          errorSummary:
            sanitizeErrorSummary(value.errorSummary) ?? fallback.errorSummary,
        }
      : {}),
    failureEvidenceSources:
      evidenceSources.length > 0
        ? evidenceSources
        : [...fallback.failureEvidenceSources],
  };
}

function normalizeArtifact(
  value: unknown,
): GraphFailureExplainArtifactV1 | null {
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
          (node): node is GraphFailureExplainNodeRecordV1 => node !== null,
        )
        .sort((left, right) => left.compileOrder - right.compileOrder)
    : [];

  const fallbackSummary = deriveSummaryFromNodes({
    runStatus:
      nodes.some((node) => node.failureDisposition === "failed") ||
      toFailureKind(
        value.summary && isRecord(value.summary)
          ? value.summary.failureKind
          : undefined,
      ) !== "none"
        ? "failed"
        : "completed",
    runErrorSummary: sanitizeErrorSummary(
      isRecord(value.summary) ? value.summary.errorSummary : undefined,
    ),
    nodes,
    failedStage: toFailureStage(
      isRecord(value.summary) ? value.summary.failedStage : undefined,
    ),
    fallbackErrorSummary: sanitizeErrorSummary(
      isRecord(value.summary) ? value.summary.errorSummary : undefined,
    ),
    evidenceSources: toEvidenceSources(
      isRecord(value.summary)
        ? value.summary.failureEvidenceSources
        : undefined,
    ),
  });

  const summary = normalizeSummary(value.summary, fallbackSummary);
  const failedNodeIds = toOptionalStringArray(value.failedNodeIds);
  const notReachedNodeIds = toOptionalStringArray(value.notReachedNodeIds);

  return {
    graphId,
    runId,
    compileFingerprint,
    fingerprintVersion: 1,
    nodeCount:
      value.nodeCount === undefined
        ? nodes.length
        : toNonNegativeInt(value.nodeCount, nodes.length),
    summary,
    failedNodeIds:
      failedNodeIds.length > 0
        ? failedNodeIds
        : nodes
            .filter((node) => node.failureDisposition === "failed")
            .map((node) => node.nodeId),
    notReachedNodeIds:
      notReachedNodeIds.length > 0
        ? notReachedNodeIds
        : nodes
            .filter((node) => node.failureDisposition === "not_reached")
            .map((node) => node.nodeId),
    nodes,
  };
}

function pushEvidenceSource(
  target: Set<GraphFailureExplainEvidenceSourceV1>,
  source: GraphFailureExplainEvidenceSourceV1,
): void {
  target.add(source);
}

function createNodeRecord(params: {
  planNode: GraphCompilePlan["nodes"][number];
  linkageNode?: GraphCompileRunLinkArtifactV1["nodes"][number];
  moduleResult?: ModuleExecutionResult;
  nodeTrace?: GraphNodeTrace;
  failedStage: GraphFailureExplainStageV1;
  primaryFailedNodeId?: string;
  inputResolutionNodeIds: Set<string>;
  outputNode?: GraphOutputExplainArtifactV1["nodes"][number];
  hostEffectNode?: GraphHostEffectExplainArtifactV1["nodes"][number];
  reuseNode?: GraphReuseExplainArtifactV1["nodes"][number];
}): GraphFailureExplainNodeRecordV1 {
  const {
    planNode,
    linkageNode,
    moduleResult,
    nodeTrace,
    failedStage,
    primaryFailedNodeId,
    inputResolutionNodeIds,
    outputNode,
    hostEffectNode,
    reuseNode,
  } = params;
  const runDisposition = linkageNode?.runDisposition ?? "not_reached";
  const failureDisposition: GraphFailureExplainDispositionV1 =
    runDisposition === "failed"
      ? "failed"
      : runDisposition === "not_reached" && primaryFailedNodeId
        ? "not_reached"
        : "not_failed";
  const stage =
    runDisposition === "failed"
      ? failedStage
      : runDisposition === "not_reached" && primaryFailedNodeId
        ? failedStage
        : "unknown";
  const errorSummary =
    sanitizeErrorSummary(moduleResult?.error) ??
    sanitizeErrorSummary(nodeTrace?.error);

  return {
    nodeId: planNode.nodeId,
    moduleId: planNode.moduleId,
    nodeFingerprint: planNode.nodeFingerprint,
    compileOrder: planNode.order,
    runDisposition,
    failureDisposition,
    failureObserved: runDisposition === "failed",
    stage,
    failureReasonKind: inferNodeFailureReasonKind({
      runDisposition,
      stage,
    }),
    isTerminal: planNode.isTerminal,
    isSideEffect: planNode.isSideEffectNode,
    outputObservedBeforeFailure: outputNode?.outputObserved === true,
    outputProjectionKind: outputNode?.projectionKind ?? "no_observed_output",
    producedHostEffectBeforeFailure:
      hostEffectNode?.runtimeObservedHostEffect === true ||
      linkageNode?.producedHostEffect === true,
    hostEffectProjectionKind:
      hostEffectNode?.hostEffectProjectionKind ?? "no_host_effect",
    inputResolutionObserved:
      linkageNode?.inputResolutionObserved === true ||
      inputResolutionNodeIds.has(planNode.nodeId),
    reuseDisposition: reuseNode?.finalReuseDisposition ?? "not_applicable",
    ...(errorSummary ? { errorSummary } : {}),
  };
}

export function createGraphFailureExplainArtifactEnvelope(params: {
  plan?: GraphCompilePlan | null;
  runArtifact?: GraphRunArtifact | null;
  result?: Pick<
    GraphExecutionResult,
    "moduleResults" | "nodeTraces" | "inputResolutionArtifact"
  > | null;
  compileRunLinkArtifact?: GraphCompileRunLinkArtifactV1 | null;
  outputExplainArtifact?: GraphOutputExplainArtifactV1 | null;
  hostEffectExplainArtifact?: GraphHostEffectExplainArtifactV1 | null;
  reuseExplainArtifact?: GraphReuseExplainArtifactV1 | null;
}): GraphFailureExplainArtifactEnvelope | null {
  const plan = params.plan;
  const runArtifact = params.runArtifact;
  const compileRunLinkArtifact = params.compileRunLinkArtifact;
  const outputExplainArtifact = params.outputExplainArtifact;
  const hostEffectExplainArtifact = params.hostEffectExplainArtifact;
  const reuseExplainArtifact = params.reuseExplainArtifact;
  const graphId =
    plan?.fingerprintSource?.graphId ??
    compileRunLinkArtifact?.graphId ??
    outputExplainArtifact?.graphId ??
    hostEffectExplainArtifact?.graphId ??
    reuseExplainArtifact?.graphId ??
    runArtifact?.graphId;
  const runId =
    runArtifact?.runId ??
    compileRunLinkArtifact?.runId ??
    outputExplainArtifact?.runId ??
    hostEffectExplainArtifact?.runId ??
    reuseExplainArtifact?.runId;
  const compileFingerprint =
    plan?.compileFingerprint ??
    compileRunLinkArtifact?.compileFingerprint ??
    outputExplainArtifact?.compileFingerprint ??
    hostEffectExplainArtifact?.compileFingerprint ??
    reuseExplainArtifact?.compileFingerprint ??
    runArtifact?.compileFingerprint;

  if (!plan || !graphId || !runId || !compileFingerprint) {
    return null;
  }

  const evidenceSources = new Set<GraphFailureExplainEvidenceSourceV1>();
  if (runArtifact) {
    pushEvidenceSource(evidenceSources, "run_status");
  }
  if (runArtifact?.failedStage) {
    pushEvidenceSource(evidenceSources, "failed_stage");
  }
  if (sanitizeErrorSummary(runArtifact?.errorSummary)) {
    pushEvidenceSource(evidenceSources, "run_error_summary");
  }
  if (runArtifact?.latestNodeId) {
    pushEvidenceSource(evidenceSources, "run_latest_node");
  }
  if (compileRunLinkArtifact) {
    pushEvidenceSource(evidenceSources, "compile_run_link");
  }
  if (params.result?.inputResolutionArtifact) {
    pushEvidenceSource(evidenceSources, "input_resolution");
  }
  if (outputExplainArtifact) {
    pushEvidenceSource(evidenceSources, "output_explain");
  }
  if (hostEffectExplainArtifact) {
    pushEvidenceSource(evidenceSources, "host_effect_explain");
  }
  if (reuseExplainArtifact) {
    pushEvidenceSource(evidenceSources, "reuse_explain");
  }

  const failedStage = toFailureStage(runArtifact?.failedStage);
  const moduleResultByNodeId = toModuleResultMap(params.result);
  const nodeTraceByNodeId = toNodeTraceMap(params.result);
  const linkageNodeByNodeId = new Map(
    (compileRunLinkArtifact?.nodes ?? []).map((node) => [node.nodeId, node]),
  );
  const outputNodeByNodeId = toOutputNodeMap(outputExplainArtifact);
  const hostEffectNodeByNodeId = toHostEffectNodeMap(hostEffectExplainArtifact);
  const reuseNodeByNodeId = toReuseNodeMap(reuseExplainArtifact);
  const inputResolutionNodeIds = toInputResolutionNodeIds(
    params.result?.inputResolutionArtifact,
  );

  const failedLinkageNode = (compileRunLinkArtifact?.nodes ?? []).find(
    (node) => node.runDisposition === "failed",
  );
  const primaryFailedNodeId = failedLinkageNode?.nodeId;

  for (const moduleResult of params.result?.moduleResults ?? []) {
    if (sanitizeErrorSummary(moduleResult.error)) {
      pushEvidenceSource(evidenceSources, "module_result_error");
      break;
    }
  }
  for (const nodeTrace of params.result?.nodeTraces ?? []) {
    if (sanitizeErrorSummary(nodeTrace.error)) {
      pushEvidenceSource(evidenceSources, "node_trace_error");
      break;
    }
  }

  const nodes = plan.nodes.map((planNode) =>
    createNodeRecord({
      planNode,
      linkageNode: linkageNodeByNodeId.get(planNode.nodeId),
      moduleResult: moduleResultByNodeId.get(planNode.nodeId),
      nodeTrace: nodeTraceByNodeId.get(planNode.nodeId),
      failedStage,
      primaryFailedNodeId,
      inputResolutionNodeIds,
      outputNode: outputNodeByNodeId.get(planNode.nodeId),
      hostEffectNode: hostEffectNodeByNodeId.get(planNode.nodeId),
      reuseNode: reuseNodeByNodeId.get(planNode.nodeId),
    }),
  );

  const artifact = normalizeArtifact({
    graphId,
    runId,
    compileFingerprint,
    fingerprintVersion: 1,
    nodeCount: plan.fingerprintSource?.nodeCount ?? plan.nodes.length,
    summary: deriveSummaryFromNodes({
      runStatus: runArtifact?.status,
      runErrorSummary: runArtifact?.errorSummary,
      nodes,
      failedStage,
      fallbackErrorSummary: runArtifact?.errorSummary,
      evidenceSources: Array.from(evidenceSources),
    }),
    failedNodeIds: nodes
      .filter((node) => node.failureDisposition === "failed")
      .map((node) => node.nodeId),
    notReachedNodeIds: nodes
      .filter((node) => node.failureDisposition === "not_reached")
      .map((node) => node.nodeId),
    nodes,
  });

  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_failure_explain_artifact",
    version: "v1",
    artifact,
  };
}

function toEnvelopeFromLegacyRecord(
  value: Record<string, unknown>,
): GraphFailureExplainArtifactEnvelope | null {
  const artifact = normalizeArtifact(
    value.graph_failure_explain_artifact ?? value.graph_failure_explain,
  );
  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_failure_explain_artifact",
    version: "v1",
    artifact,
  };
}

export function readGraphFailureExplainArtifactEnvelope(
  value: unknown,
): GraphFailureExplainArtifactEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.kind === "graph_failure_explain_artifact" &&
    value.version === "v1"
  ) {
    const artifact = normalizeArtifact(value.artifact);
    return artifact
      ? {
          kind: "graph_failure_explain_artifact",
          version: "v1",
          artifact,
        }
      : null;
  }

  const directArtifact = normalizeArtifact(value);
  if (directArtifact) {
    return {
      kind: "graph_failure_explain_artifact",
      version: "v1",
      artifact: directArtifact,
    };
  }

  if (isRecord(value.bridge)) {
    return readGraphFailureExplainArtifactEnvelope(value.bridge);
  }

  if (isRecord(value.graph_failure_explain_artifact)) {
    return readGraphFailureExplainArtifactEnvelope(
      value.graph_failure_explain_artifact,
    );
  }

  if (
    "graph_failure_explain_artifact" in value ||
    "graph_failure_explain" in value
  ) {
    return toEnvelopeFromLegacyRecord(value);
  }

  return null;
}
