import type {
  GraphCompilePlan,
  GraphCompileRunLinkArtifactV1,
  GraphExecutionResult,
  GraphFailureExplainArtifactV1,
  GraphHostEffectExplainArtifactV1,
  GraphOutputExplainArtifactV1,
  GraphRunArtifact,
  GraphTerminalOutcomeExplainArtifactEnvelope,
  GraphTerminalOutcomeExplainArtifactV1,
  GraphTerminalOutcomeExplainNodeRecordV1,
  GraphTerminalOutcomeExplainProjectionDispositionV1,
  GraphTerminalOutcomeExplainProjectionRoleV1,
  GraphTerminalOutcomeExplainSummaryV1,
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
  return Number.isFinite(numeric) && numeric >= 0
    ? Math.trunc(numeric)
    : fallback;
}

function toOptionalStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function toProjectionDisposition(
  value: unknown,
  fallback: GraphTerminalOutcomeExplainProjectionDispositionV1 = "non_terminal",
): GraphTerminalOutcomeExplainProjectionDispositionV1 {
  return value === "non_terminal" ||
    value === "projected_complete" ||
    value === "projected_truncated"
    ? value
    : fallback;
}

function toProjectionRole(
  value: unknown,
  fallback: GraphTerminalOutcomeExplainProjectionRoleV1 = "not_projected",
): GraphTerminalOutcomeExplainProjectionRoleV1 {
  return value === "not_reached" ||
    value === "observed_before_failure" ||
    value === "final_output" ||
    value === "host_effect_only" ||
    value === "not_projected"
    ? value
    : fallback;
}

function toRunDisposition(
  value: unknown,
): GraphTerminalOutcomeExplainNodeRecordV1["runDisposition"] {
  return value === "executed" ||
    value === "skipped_reuse" ||
    value === "failed" ||
    value === "not_reached"
    ? value
    : "not_reached";
}

function toRunStatus(
  value: unknown,
): GraphTerminalOutcomeExplainSummaryV1["runStatus"] {
  return value === "queued" ||
    value === "running" ||
    value === "streaming" ||
    value === "waiting_user" ||
    value === "cancelling" ||
    value === "cancelled" ||
    value === "failed" ||
    value === "completed"
    ? value
    : "completed";
}

function toRunPhase(
  value: unknown,
): GraphTerminalOutcomeExplainSummaryV1["phase"] {
  return value === "queued" ||
    value === "validating" ||
    value === "compiling" ||
    value === "executing" ||
    value === "blocked" ||
    value === "finishing" ||
    value === "terminal"
    ? value
    : "terminal";
}

function toTerminalOutcome(
  value: unknown,
): GraphTerminalOutcomeExplainSummaryV1["terminalOutcome"] {
  return value === "completed" || value === "failed" || value === "cancelled"
    ? value
    : "non_terminal";
}

function toExecutionStage(
  value: unknown,
): GraphTerminalOutcomeExplainSummaryV1["failedStage"] {
  return value === "validate" || value === "compile" || value === "execute"
    ? value
    : undefined;
}

function normalizeNodeRecord(
  value: unknown,
): GraphTerminalOutcomeExplainNodeRecordV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const nodeId = toRequiredString(value.nodeId);
  const moduleId = toRequiredString(value.moduleId);
  const nodeFingerprint = toRequiredString(value.nodeFingerprint);
  if (!nodeId || !moduleId || !nodeFingerprint) {
    return null;
  }

  const runDisposition = toRunDisposition(value.runDisposition);
  const includedInTerminalProjection =
    value.includedInTerminalProjection === true;
  const hostEffectObserved = value.hostEffectObserved === true;
  const outputObserved = value.outputObserved === true;

  return {
    nodeId,
    moduleId,
    nodeFingerprint,
    compileOrder: toNonNegativeInt(value.compileOrder),
    runDisposition,
    isTerminal: value.isTerminal === true,
    isSideEffect: value.isSideEffect === true,
    includedInTerminalProjection,
    projectionRole: toProjectionRole(
      value.projectionRole,
      inferProjectionRole({
        runDisposition,
        includedInTerminalProjection,
        hostEffectObserved,
        outputObserved,
        terminalOutcome: toTerminalOutcome(value.terminalOutcome),
      }),
    ),
    hostEffectObserved,
    outputObserved,
    outputProjectionKind:
      value.outputProjectionKind === "final_output" ||
      value.outputProjectionKind === "intermediate_output" ||
      value.outputProjectionKind === "host_effect_only" ||
      value.outputProjectionKind === "no_observed_output" ||
      value.outputProjectionKind === "not_reached" ||
      value.outputProjectionKind === "failed"
        ? value.outputProjectionKind
        : "no_observed_output",
    hostEffectProjectionKind:
      value.hostEffectProjectionKind === "host_effect_only" ||
      value.hostEffectProjectionKind === "host_effect_and_output" ||
      value.hostEffectProjectionKind === "declared_only" ||
      value.hostEffectProjectionKind === "no_host_effect" ||
      value.hostEffectProjectionKind === "not_reached" ||
      value.hostEffectProjectionKind === "failed"
        ? value.hostEffectProjectionKind
        : "no_host_effect",
    failureDisposition:
      value.failureDisposition === "not_failed" ||
      value.failureDisposition === "failed" ||
      value.failureDisposition === "not_reached"
        ? value.failureDisposition
        : "not_failed",
  };
}

function inferProjectionDisposition(params: {
  runStatus?: GraphRunArtifact["status"];
  phase?: GraphRunArtifact["phase"];
  terminalOutcome?: GraphRunArtifact["terminalOutcome"];
  truncatedByFailure: boolean;
}): GraphTerminalOutcomeExplainProjectionDispositionV1 {
  const { runStatus, phase, terminalOutcome, truncatedByFailure } = params;
  const terminalObserved =
    phase === "terminal" &&
    (runStatus === "completed" ||
      runStatus === "failed" ||
      runStatus === "cancelled");

  if (!terminalObserved || !terminalOutcome) {
    return "non_terminal";
  }
  if (truncatedByFailure) {
    return "projected_truncated";
  }
  return "projected_complete";
}

function inferProjectionRole(params: {
  runDisposition: GraphTerminalOutcomeExplainNodeRecordV1["runDisposition"];
  includedInTerminalProjection: boolean;
  hostEffectObserved: boolean;
  outputObserved: boolean;
  terminalOutcome: GraphTerminalOutcomeExplainSummaryV1["terminalOutcome"];
}): GraphTerminalOutcomeExplainProjectionRoleV1 {
  const {
    runDisposition,
    includedInTerminalProjection,
    hostEffectObserved,
    outputObserved,
    terminalOutcome,
  } = params;

  if (runDisposition === "not_reached") {
    return "not_reached";
  }
  if (includedInTerminalProjection) {
    return hostEffectObserved && !outputObserved
      ? "host_effect_only"
      : "final_output";
  }
  if (
    (terminalOutcome === "failed" || terminalOutcome === "cancelled") &&
    (runDisposition === "executed" ||
      runDisposition === "skipped_reuse" ||
      runDisposition === "failed")
  ) {
    return "observed_before_failure";
  }
  return "not_projected";
}

function deriveSummaryFromNodes(params: {
  runArtifact?: GraphRunArtifact | null;
  nodes: readonly GraphTerminalOutcomeExplainNodeRecordV1[];
}): GraphTerminalOutcomeExplainSummaryV1 {
  const { runArtifact, nodes } = params;
  const terminalOutcomeObserved =
    runArtifact?.phase === "terminal" &&
    (runArtifact.status === "completed" ||
      runArtifact.status === "failed" ||
      runArtifact.status === "cancelled");
  const terminalOutcome = terminalOutcomeObserved
    ? (runArtifact?.terminalOutcome ??
      (runArtifact?.status === "completed" ||
      runArtifact?.status === "failed" ||
      runArtifact?.status === "cancelled"
        ? runArtifact.status
        : "non_terminal"))
    : "non_terminal";
  const finalOutputNodeCount = nodes.filter(
    (node) => node.projectionRole === "final_output",
  ).length;
  const hostEffectOnlyNodeCount = nodes.filter(
    (node) => node.projectionRole === "host_effect_only",
  ).length;
  const truncatedByFailure =
    terminalOutcome === "failed" || terminalOutcome === "cancelled"
      ? nodes.some(
          (node) =>
            node.projectionRole === "not_reached" ||
            node.projectionRole === "observed_before_failure",
        )
      : false;

  return {
    runStatus: runArtifact?.status ?? "completed",
    phase: runArtifact?.phase ?? "terminal",
    terminalOutcomeObserved,
    terminalOutcome,
    ...(runArtifact?.failedStage
      ? { failedStage: runArtifact.failedStage }
      : {}),
    projectionDisposition: inferProjectionDisposition({
      runStatus: runArtifact?.status,
      phase: runArtifact?.phase,
      terminalOutcome: runArtifact?.terminalOutcome,
      truncatedByFailure,
    }),
    finalOutputNodeCount,
    hostEffectOnlyNodeCount,
    truncatedByFailure,
  };
}

function normalizeSummary(
  value: unknown,
  fallback: GraphTerminalOutcomeExplainSummaryV1,
): GraphTerminalOutcomeExplainSummaryV1 {
  if (!isRecord(value)) {
    return fallback;
  }

  const terminalOutcomeObserved =
    typeof value.terminalOutcomeObserved === "boolean"
      ? value.terminalOutcomeObserved
      : fallback.terminalOutcomeObserved;
  const terminalOutcome = terminalOutcomeObserved
    ? toTerminalOutcome(value.terminalOutcome) === "non_terminal"
      ? fallback.terminalOutcome
      : toTerminalOutcome(value.terminalOutcome)
    : "non_terminal";

  return {
    runStatus: toRunStatus(value.runStatus),
    phase: toRunPhase(value.phase),
    terminalOutcomeObserved,
    terminalOutcome,
    ...(toExecutionStage(value.failedStage) || fallback.failedStage
      ? {
          failedStage:
            toExecutionStage(value.failedStage) ?? fallback.failedStage,
        }
      : {}),
    projectionDisposition: toProjectionDisposition(
      value.projectionDisposition,
      fallback.projectionDisposition,
    ),
    finalOutputNodeCount: toNonNegativeInt(
      value.finalOutputNodeCount,
      fallback.finalOutputNodeCount,
    ),
    hostEffectOnlyNodeCount: toNonNegativeInt(
      value.hostEffectOnlyNodeCount,
      fallback.hostEffectOnlyNodeCount,
    ),
    truncatedByFailure:
      typeof value.truncatedByFailure === "boolean"
        ? value.truncatedByFailure
        : fallback.truncatedByFailure,
  };
}

function normalizeArtifact(
  value: unknown,
): GraphTerminalOutcomeExplainArtifactV1 | null {
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
          (node): node is GraphTerminalOutcomeExplainNodeRecordV1 =>
            node !== null,
        )
        .sort((left, right) => left.compileOrder - right.compileOrder)
    : [];

  const fallbackSummary = normalizeSummary(value.summary, {
    runStatus: toRunStatus(
      isRecord(value.summary) ? value.summary.runStatus : undefined,
    ),
    phase: toRunPhase(
      isRecord(value.summary) ? value.summary.phase : undefined,
    ),
    terminalOutcomeObserved:
      isRecord(value.summary) &&
      typeof value.summary.terminalOutcomeObserved === "boolean"
        ? value.summary.terminalOutcomeObserved
        : false,
    terminalOutcome: toTerminalOutcome(
      isRecord(value.summary) ? value.summary.terminalOutcome : undefined,
    ),
    ...(toExecutionStage(
      isRecord(value.summary) ? value.summary.failedStage : undefined,
    )
      ? {
          failedStage: toExecutionStage(
            isRecord(value.summary) ? value.summary.failedStage : undefined,
          ),
        }
      : {}),
    projectionDisposition: inferProjectionDisposition({
      runStatus: toRunStatus(
        isRecord(value.summary) ? value.summary.runStatus : undefined,
      ),
      phase: toRunPhase(
        isRecord(value.summary) ? value.summary.phase : undefined,
      ),
      terminalOutcome:
        toTerminalOutcome(
          isRecord(value.summary) ? value.summary.terminalOutcome : undefined,
        ) === "non_terminal"
          ? undefined
          : (toTerminalOutcome(
              isRecord(value.summary)
                ? value.summary.terminalOutcome
                : undefined,
            ) as GraphRunArtifact["terminalOutcome"]),
      truncatedByFailure:
        isRecord(value.summary) && value.summary.truncatedByFailure === true,
    }),
    finalOutputNodeCount: nodes.filter(
      (node) => node.projectionRole === "final_output",
    ).length,
    hostEffectOnlyNodeCount: nodes.filter(
      (node) => node.projectionRole === "host_effect_only",
    ).length,
    truncatedByFailure: nodes.some(
      (node) =>
        node.projectionRole === "not_reached" ||
        node.projectionRole === "observed_before_failure",
    ),
  });
  const summary = normalizeSummary(value.summary, fallbackSummary);
  const finalProjectionNodeIds = toOptionalStringArray(
    value.finalProjectionNodeIds,
  );
  const hostEffectOnlyNodeIds = toOptionalStringArray(
    value.hostEffectOnlyNodeIds,
  );
  const observedBeforeFailureNodeIds = toOptionalStringArray(
    value.observedBeforeFailureNodeIds,
  );
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
    finalProjectionNodeIds:
      finalProjectionNodeIds.length > 0
        ? finalProjectionNodeIds
        : nodes
            .filter((node) => node.projectionRole === "final_output")
            .map((node) => node.nodeId),
    hostEffectOnlyNodeIds:
      hostEffectOnlyNodeIds.length > 0
        ? hostEffectOnlyNodeIds
        : nodes
            .filter((node) => node.projectionRole === "host_effect_only")
            .map((node) => node.nodeId),
    observedBeforeFailureNodeIds:
      observedBeforeFailureNodeIds.length > 0
        ? observedBeforeFailureNodeIds
        : nodes
            .filter((node) => node.projectionRole === "observed_before_failure")
            .map((node) => node.nodeId),
    notReachedNodeIds:
      notReachedNodeIds.length > 0
        ? notReachedNodeIds
        : nodes
            .filter((node) => node.projectionRole === "not_reached")
            .map((node) => node.nodeId),
    nodes,
  };
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

function toFailureNodeMap(
  artifact?: GraphFailureExplainArtifactV1 | null,
): Map<string, GraphFailureExplainArtifactV1["nodes"][number]> {
  return new Map((artifact?.nodes ?? []).map((node) => [node.nodeId, node]));
}

function toModuleResultNodeIdSet(
  result?: Pick<GraphExecutionResult, "moduleResults"> | null,
): Set<string> {
  return new Set((result?.moduleResults ?? []).map((entry) => entry.nodeId));
}

function createNodeRecord(params: {
  planNode: GraphCompilePlan["nodes"][number];
  linkageNode?: GraphCompileRunLinkArtifactV1["nodes"][number];
  outputNode?: GraphOutputExplainArtifactV1["nodes"][number];
  hostEffectNode?: GraphHostEffectExplainArtifactV1["nodes"][number];
  failureNode?: GraphFailureExplainArtifactV1["nodes"][number];
  moduleResultNodeIds: Set<string>;
  terminalOutcome: GraphTerminalOutcomeExplainSummaryV1["terminalOutcome"];
}): GraphTerminalOutcomeExplainNodeRecordV1 {
  const {
    planNode,
    linkageNode,
    outputNode,
    hostEffectNode,
    failureNode,
    moduleResultNodeIds,
    terminalOutcome,
  } = params;
  const runDisposition = linkageNode?.runDisposition ?? "not_reached";
  const outputObserved =
    outputNode?.outputObserved === true ||
    outputNode?.projectionKind === "final_output" ||
    outputNode?.projectionKind === "intermediate_output";
  const hostEffectObserved =
    hostEffectNode?.runtimeObservedHostEffect === true ||
    linkageNode?.producedHostEffect === true;

  const includedInTerminalProjection =
    outputNode?.projectionKind === "final_output" ||
    (outputNode?.projectionKind === "host_effect_only" &&
      (terminalOutcome === "completed" ||
        terminalOutcome === "failed" ||
        terminalOutcome === "cancelled"));

  return {
    nodeId: planNode.nodeId,
    moduleId: planNode.moduleId,
    nodeFingerprint: planNode.nodeFingerprint,
    compileOrder: planNode.order,
    runDisposition,
    isTerminal: planNode.isTerminal,
    isSideEffect: planNode.isSideEffectNode,
    includedInTerminalProjection,
    projectionRole: inferProjectionRole({
      runDisposition,
      includedInTerminalProjection,
      hostEffectObserved,
      outputObserved,
      terminalOutcome,
    }),
    hostEffectObserved,
    outputObserved:
      outputObserved ||
      failureNode?.outputObservedBeforeFailure === true ||
      moduleResultNodeIds.has(planNode.nodeId),
    outputProjectionKind: outputNode?.projectionKind ?? "no_observed_output",
    hostEffectProjectionKind:
      hostEffectNode?.hostEffectProjectionKind ?? "no_host_effect",
    failureDisposition: failureNode?.failureDisposition ?? "not_failed",
  };
}

export function createGraphTerminalOutcomeExplainArtifactEnvelope(params: {
  plan?: GraphCompilePlan | null;
  runArtifact?: GraphRunArtifact | null;
  result?: Pick<GraphExecutionResult, "moduleResults"> | null;
  compileRunLinkArtifact?: GraphCompileRunLinkArtifactV1 | null;
  outputExplainArtifact?: GraphOutputExplainArtifactV1 | null;
  hostEffectExplainArtifact?: GraphHostEffectExplainArtifactV1 | null;
  failureExplainArtifact?: GraphFailureExplainArtifactV1 | null;
}): GraphTerminalOutcomeExplainArtifactEnvelope | null {
  const plan = params.plan;
  const runArtifact = params.runArtifact;
  const compileRunLinkArtifact = params.compileRunLinkArtifact;
  const outputExplainArtifact = params.outputExplainArtifact;
  const hostEffectExplainArtifact = params.hostEffectExplainArtifact;
  const failureExplainArtifact = params.failureExplainArtifact;
  const graphId =
    plan?.fingerprintSource?.graphId ??
    compileRunLinkArtifact?.graphId ??
    outputExplainArtifact?.graphId ??
    hostEffectExplainArtifact?.graphId ??
    failureExplainArtifact?.graphId ??
    runArtifact?.graphId;
  const runId =
    runArtifact?.runId ??
    compileRunLinkArtifact?.runId ??
    outputExplainArtifact?.runId ??
    hostEffectExplainArtifact?.runId ??
    failureExplainArtifact?.runId;
  const compileFingerprint =
    plan?.compileFingerprint ??
    compileRunLinkArtifact?.compileFingerprint ??
    outputExplainArtifact?.compileFingerprint ??
    hostEffectExplainArtifact?.compileFingerprint ??
    failureExplainArtifact?.compileFingerprint ??
    runArtifact?.compileFingerprint;

  if (!plan || !graphId || !runId || !compileFingerprint) {
    return null;
  }

  const terminalOutcomeObserved =
    runArtifact?.phase === "terminal" &&
    (runArtifact.status === "completed" ||
      runArtifact.status === "failed" ||
      runArtifact.status === "cancelled");
  const terminalOutcome: GraphTerminalOutcomeExplainSummaryV1["terminalOutcome"] =
    terminalOutcomeObserved
      ? (runArtifact?.terminalOutcome ??
        (runArtifact?.status === "completed" ||
        runArtifact?.status === "failed" ||
        runArtifact?.status === "cancelled"
          ? runArtifact.status
          : "non_terminal"))
      : "non_terminal";

  const linkageNodeByNodeId = new Map(
    (compileRunLinkArtifact?.nodes ?? []).map((node) => [node.nodeId, node]),
  );
  const outputNodeByNodeId = toOutputNodeMap(outputExplainArtifact);
  const hostEffectNodeByNodeId = toHostEffectNodeMap(hostEffectExplainArtifact);
  const failureNodeByNodeId = toFailureNodeMap(failureExplainArtifact);
  const moduleResultNodeIds = toModuleResultNodeIdSet(params.result);

  const nodes = plan.nodes.map((planNode) =>
    createNodeRecord({
      planNode,
      linkageNode: linkageNodeByNodeId.get(planNode.nodeId),
      outputNode: outputNodeByNodeId.get(planNode.nodeId),
      hostEffectNode: hostEffectNodeByNodeId.get(planNode.nodeId),
      failureNode: failureNodeByNodeId.get(planNode.nodeId),
      moduleResultNodeIds,
      terminalOutcome,
    }),
  );

  const artifact = normalizeArtifact({
    graphId,
    runId,
    compileFingerprint,
    fingerprintVersion: 1,
    nodeCount: plan.fingerprintSource?.nodeCount ?? plan.nodes.length,
    summary: deriveSummaryFromNodes({ runArtifact, nodes }),
    finalProjectionNodeIds: nodes
      .filter((node) => node.projectionRole === "final_output")
      .map((node) => node.nodeId),
    hostEffectOnlyNodeIds: nodes
      .filter((node) => node.projectionRole === "host_effect_only")
      .map((node) => node.nodeId),
    observedBeforeFailureNodeIds: nodes
      .filter((node) => node.projectionRole === "observed_before_failure")
      .map((node) => node.nodeId),
    notReachedNodeIds: nodes
      .filter((node) => node.projectionRole === "not_reached")
      .map((node) => node.nodeId),
    nodes,
  });

  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_terminal_outcome_explain_artifact",
    version: "v1",
    artifact,
  };
}

function toEnvelopeFromLegacyRecord(
  value: Record<string, unknown>,
): GraphTerminalOutcomeExplainArtifactEnvelope | null {
  const artifact = normalizeArtifact(
    value.graph_terminal_outcome_explain_artifact ??
      value.graph_terminal_outcome_explain,
  );
  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_terminal_outcome_explain_artifact",
    version: "v1",
    artifact,
  };
}

export function readGraphTerminalOutcomeExplainArtifactEnvelope(
  value: unknown,
): GraphTerminalOutcomeExplainArtifactEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.kind === "graph_terminal_outcome_explain_artifact" &&
    value.version === "v1"
  ) {
    const artifact = normalizeArtifact(value.artifact);
    return artifact
      ? {
          kind: "graph_terminal_outcome_explain_artifact",
          version: "v1",
          artifact,
        }
      : null;
  }

  if (isRecord(value.bridge)) {
    return readGraphTerminalOutcomeExplainArtifactEnvelope(value.bridge);
  }

  if (isRecord(value.graph_terminal_outcome_explain_artifact)) {
    return readGraphTerminalOutcomeExplainArtifactEnvelope(
      value.graph_terminal_outcome_explain_artifact,
    );
  }

  if (
    "graph_terminal_outcome_explain_artifact" in value ||
    "graph_terminal_outcome_explain" in value
  ) {
    return toEnvelopeFromLegacyRecord(value);
  }

  return null;
}
