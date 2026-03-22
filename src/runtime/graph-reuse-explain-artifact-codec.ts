import type {
  GraphCompilePlan,
  GraphCompileRunLinkArtifactV1,
  GraphExecutionDecisionSummary,
  GraphExecutionResult,
  GraphNodeExecutionDecisionReason,
  GraphNodeReuseReason,
  GraphNodeTrace,
  GraphReuseExplainArtifactEnvelope,
  GraphReuseExplainArtifactV1,
  GraphReuseExplainFinalDispositionV1,
  GraphReuseExplainNodeRecordV1,
  GraphReuseExplainSummaryV1,
  GraphReuseSummary,
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
  return Number.isFinite(numeric) && numeric >= 0
    ? Math.trunc(numeric)
    : fallback;
}

function toOptionalStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function toOptionalReuseReason(
  value: unknown,
): GraphNodeReuseReason | undefined {
  return value === "eligible" ||
    value === "ineligible_dirty" ||
    value === "ineligible_side_effect" ||
    value === "ineligible_capability" ||
    value === "ineligible_missing_baseline"
    ? value
    : undefined;
}

function toOptionalExecutionDecisionReason(
  value: unknown,
): GraphNodeExecutionDecisionReason | undefined {
  return value === "feature_disabled" ||
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

function toFinalDisposition(
  value: unknown,
  fallback: GraphReuseExplainFinalDispositionV1 = "not_applicable",
): GraphReuseExplainFinalDispositionV1 {
  return value === "skipped_reuse" ||
    value === "eligible_but_executed" ||
    value === "ineligible_executed" ||
    value === "not_applicable"
    ? value
    : fallback;
}

function toFingerprintSummary(
  value: unknown,
): GraphReuseExplainNodeRecordV1["baselineInputFingerprint"] {
  if (!isRecord(value)) {
    return undefined;
  }

  const available = value.available === true;
  const fingerprint =
    typeof value.fingerprint === "string" && value.fingerprint.trim()
      ? value.fingerprint
      : undefined;

  if (!available && !fingerprint) {
    return { available: false };
  }

  return {
    available: available || Boolean(fingerprint),
    ...(fingerprint ? { fingerprint } : {}),
  };
}

function createEmptyVerdictCounts(): Record<GraphNodeReuseReason, number> {
  return {
    eligible: 0,
    ineligible_dirty: 0,
    ineligible_side_effect: 0,
    ineligible_capability: 0,
    ineligible_missing_baseline: 0,
  };
}

function createEmptyDecisionCounts(): Record<
  GraphNodeExecutionDecisionReason,
  number
> {
  return {
    feature_disabled: 0,
    ineligible_reuse_verdict: 0,
    ineligible_capability: 0,
    ineligible_side_effect: 0,
    ineligible_source: 0,
    ineligible_terminal: 0,
    ineligible_fallback: 0,
    missing_baseline: 0,
    missing_reusable_outputs: 0,
    execute: 0,
    skip_reuse_outputs: 0,
  };
}

function createEmptyFinalDispositionCounts(): Record<
  GraphReuseExplainFinalDispositionV1,
  number
> {
  return {
    skipped_reuse: 0,
    eligible_but_executed: 0,
    ineligible_executed: 0,
    not_applicable: 0,
  };
}

function inferFinalReuseDisposition(params: {
  executionDecision?: GraphNodeExecutionDecisionReason;
  reuseVerdict?: GraphNodeReuseReason;
  featureEnabled: boolean;
}): GraphReuseExplainFinalDispositionV1 {
  const { executionDecision, reuseVerdict, featureEnabled } = params;

  if (executionDecision === "skip_reuse_outputs") {
    return "skipped_reuse";
  }

  if (!executionDecision) {
    return "not_applicable";
  }

  if (executionDecision === "feature_disabled") {
    return "not_applicable";
  }

  if (executionDecision === "execute") {
    return reuseVerdict === "eligible"
      ? "eligible_but_executed"
      : "ineligible_executed";
  }

  if (!featureEnabled) {
    return "not_applicable";
  }

  return reuseVerdict === "eligible"
    ? "eligible_but_executed"
    : "ineligible_executed";
}

function normalizeNodeRecord(
  value: unknown,
): GraphReuseExplainNodeRecordV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const nodeId = toRequiredString(value.nodeId);
  const moduleId = toRequiredString(value.moduleId);
  const nodeFingerprint = toRequiredString(value.nodeFingerprint);
  if (!nodeId || !moduleId || !nodeFingerprint) {
    return null;
  }

  const reuseVerdict = toOptionalReuseReason(value.reuseVerdict);
  const executionDecision = toOptionalExecutionDecisionReason(
    value.executionDecision,
  );

  return {
    nodeId,
    moduleId,
    nodeFingerprint,
    compileOrder: toNonNegativeInt(value.compileOrder),
    isTerminal: value.isTerminal === true,
    isSideEffect: value.isSideEffect === true,
    ...(value.dirtyReason === "initial_run" ||
    value.dirtyReason === "input_changed" ||
    value.dirtyReason === "upstream_dirty" ||
    value.dirtyReason === "clean"
      ? { dirtyReason: value.dirtyReason }
      : {}),
    ...(reuseVerdict ? { reuseVerdict } : {}),
    ...(toFingerprintSummary(value.baselineInputFingerprint)
      ? {
          baselineInputFingerprint: toFingerprintSummary(
            value.baselineInputFingerprint,
          ),
        }
      : {}),
    ...(toFingerprintSummary(value.currentInputFingerprint)
      ? {
          currentInputFingerprint: toFingerprintSummary(
            value.currentInputFingerprint,
          ),
        }
      : {}),
    ...(executionDecision ? { executionDecision } : {}),
    reusableOutputsObserved: value.reusableOutputsObserved === true,
    finalReuseDisposition: toFinalDisposition(
      value.finalReuseDisposition,
      inferFinalReuseDisposition({
        executionDecision,
        reuseVerdict,
        featureEnabled: value.featureEnabled !== false,
      }),
    ),
  };
}

function normalizeSummary(
  value: unknown,
  fallbackNodes: GraphReuseExplainNodeRecordV1[],
  fallbackFeatureEnabled: boolean,
): GraphReuseExplainSummaryV1 {
  const verdictCounts = createEmptyVerdictCounts();
  const decisionCounts = createEmptyDecisionCounts();
  const finalDispositionCounts = createEmptyFinalDispositionCounts();

  for (const node of fallbackNodes) {
    if (node.reuseVerdict) {
      verdictCounts[node.reuseVerdict] += 1;
    }
    if (node.executionDecision) {
      decisionCounts[node.executionDecision] += 1;
    }
    finalDispositionCounts[node.finalReuseDisposition] += 1;
  }

  const projected = {
    eligibleNodeCount: fallbackNodes.filter(
      (node) => node.reuseVerdict === "eligible",
    ).length,
    ineligibleNodeCount: fallbackNodes.filter(
      (node) => node.reuseVerdict && node.reuseVerdict !== "eligible",
    ).length,
    skippedReuseNodeCount: fallbackNodes.filter(
      (node) => node.finalReuseDisposition === "skipped_reuse",
    ).length,
    eligibleButExecutedNodeCount: fallbackNodes.filter(
      (node) => node.finalReuseDisposition === "eligible_but_executed",
    ).length,
    ineligibleExecutedNodeCount: fallbackNodes.filter(
      (node) => node.finalReuseDisposition === "ineligible_executed",
    ).length,
    notApplicableNodeCount: fallbackNodes.filter(
      (node) => node.finalReuseDisposition === "not_applicable",
    ).length,
    verdictCounts,
    decisionCounts,
    finalDispositionCounts,
  } satisfies GraphReuseExplainSummaryV1;

  if (!isRecord(value)) {
    return projected;
  }

  return {
    eligibleNodeCount: toNonNegativeInt(
      value.eligibleNodeCount,
      projected.eligibleNodeCount,
    ),
    ineligibleNodeCount: toNonNegativeInt(
      value.ineligibleNodeCount,
      projected.ineligibleNodeCount,
    ),
    skippedReuseNodeCount: toNonNegativeInt(
      value.skippedReuseNodeCount,
      projected.skippedReuseNodeCount,
    ),
    eligibleButExecutedNodeCount: toNonNegativeInt(
      value.eligibleButExecutedNodeCount,
      projected.eligibleButExecutedNodeCount,
    ),
    ineligibleExecutedNodeCount: toNonNegativeInt(
      value.ineligibleExecutedNodeCount,
      projected.ineligibleExecutedNodeCount,
    ),
    notApplicableNodeCount: toNonNegativeInt(
      value.notApplicableNodeCount,
      projected.notApplicableNodeCount,
    ),
    verdictCounts: isRecord(value.verdictCounts)
      ? {
          ...projected.verdictCounts,
          ...Object.fromEntries(
            Object.keys(projected.verdictCounts).map((key) => [
              key,
              toNonNegativeInt(
                (value.verdictCounts as Record<string, unknown>)[key],
                projected.verdictCounts[key as GraphNodeReuseReason],
              ),
            ]),
          ),
        }
      : projected.verdictCounts,
    decisionCounts: isRecord(value.decisionCounts)
      ? {
          ...projected.decisionCounts,
          ...Object.fromEntries(
            Object.keys(projected.decisionCounts).map((key) => [
              key,
              toNonNegativeInt(
                (value.decisionCounts as Record<string, unknown>)[key],
                projected.decisionCounts[
                  key as GraphNodeExecutionDecisionReason
                ],
              ),
            ]),
          ),
        }
      : projected.decisionCounts,
    finalDispositionCounts: isRecord(value.finalDispositionCounts)
      ? {
          ...projected.finalDispositionCounts,
          ...Object.fromEntries(
            Object.keys(projected.finalDispositionCounts).map((key) => [
              key,
              toNonNegativeInt(
                (value.finalDispositionCounts as Record<string, unknown>)[key],
                projected.finalDispositionCounts[
                  key as GraphReuseExplainFinalDispositionV1
                ],
              ),
            ]),
          ),
        }
      : projected.finalDispositionCounts,
  };
}

function normalizeArtifact(value: unknown): GraphReuseExplainArtifactV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const graphId = toRequiredString(value.graphId);
  const runId = toRequiredString(value.runId);
  const compileFingerprint = toRequiredString(value.compileFingerprint);
  if (!graphId || !runId || !compileFingerprint) {
    return null;
  }

  const featureEnabled = value.featureEnabled === true;
  const nodes = Array.isArray(value.nodes)
    ? value.nodes
        .map((node) =>
          normalizeNodeRecord({
            ...((isRecord(node) ? node : {}) as object),
            featureEnabled,
          }),
        )
        .filter((node): node is GraphReuseExplainNodeRecordV1 => node !== null)
        .sort((left, right) => left.compileOrder - right.compileOrder)
    : [];

  const eligibleNodeIds = toOptionalStringArray(value.eligibleNodeIds);
  const skippedReuseNodeIds = toOptionalStringArray(value.skippedReuseNodeIds);

  return {
    graphId,
    runId,
    compileFingerprint,
    fingerprintVersion: 1,
    featureEnabled,
    nodeCount:
      value.nodeCount === undefined
        ? nodes.length
        : toNonNegativeInt(value.nodeCount, nodes.length),
    eligibleNodeIds:
      eligibleNodeIds.length > 0
        ? eligibleNodeIds
        : nodes
            .filter((node) => node.reuseVerdict === "eligible")
            .map((node) => node.nodeId),
    skippedReuseNodeIds:
      skippedReuseNodeIds.length > 0
        ? skippedReuseNodeIds
        : nodes
            .filter((node) => node.finalReuseDisposition === "skipped_reuse")
            .map((node) => node.nodeId),
    nodes,
    summary: normalizeSummary(value.summary, nodes, featureEnabled),
  };
}

function toTraceMap(
  result?: Pick<GraphExecutionResult, "nodeTraces"> | null,
): Map<string, GraphNodeTrace> {
  const map = new Map<string, GraphNodeTrace>();
  for (const trace of result?.nodeTraces ?? []) {
    if (trace && typeof trace.nodeId === "string" && trace.nodeId) {
      map.set(trace.nodeId, trace);
    }
  }
  return map;
}

function toRunDispositionMap(
  linkage?: GraphCompileRunLinkArtifactV1 | null,
): Map<
  string,
  GraphCompileRunLinkArtifactV1["nodes"][number]["runDisposition"]
> {
  return new Map(
    (linkage?.nodes ?? []).map((node) => [node.nodeId, node.runDisposition]),
  );
}

function createNodeRecord(params: {
  planNode: GraphCompilePlan["nodes"][number];
  trace?: GraphNodeTrace;
  featureEnabled: boolean;
  runDisposition?: GraphCompileRunLinkArtifactV1["nodes"][number]["runDisposition"];
}): GraphReuseExplainNodeRecordV1 {
  const { planNode, trace, featureEnabled, runDisposition } = params;
  const reuseVerdict = trace?.reuseVerdict?.reason;
  const executionDecision = trace?.executionDecision?.reason;
  const inferredFinalDisposition = inferFinalReuseDisposition({
    executionDecision,
    reuseVerdict,
    featureEnabled,
  });

  const finalReuseDisposition: GraphReuseExplainFinalDispositionV1 =
    runDisposition === "skipped_reuse"
      ? "skipped_reuse"
      : runDisposition === "executed"
        ? inferredFinalDisposition === "skipped_reuse"
          ? "eligible_but_executed"
          : inferredFinalDisposition
        : inferredFinalDisposition;

  return {
    nodeId: planNode.nodeId,
    moduleId: planNode.moduleId,
    nodeFingerprint: planNode.nodeFingerprint,
    compileOrder: planNode.order,
    isTerminal: planNode.isTerminal,
    isSideEffect: planNode.isSideEffectNode,
    ...(trace?.dirtyReason ? { dirtyReason: trace.dirtyReason } : {}),
    ...(reuseVerdict ? { reuseVerdict } : {}),
    baselineInputFingerprint:
      trace?.reuseVerdict?.baselineInputFingerprint !== undefined
        ? {
            available: true,
            fingerprint: trace.reuseVerdict.baselineInputFingerprint,
          }
        : { available: false },
    currentInputFingerprint:
      trace?.reuseVerdict?.currentInputFingerprint !== undefined
        ? {
            available: true,
            fingerprint: trace.reuseVerdict.currentInputFingerprint,
          }
        : trace?.inputFingerprint
          ? { available: true, fingerprint: trace.inputFingerprint }
          : { available: false },
    ...(executionDecision ? { executionDecision } : {}),
    reusableOutputsObserved:
      trace?.executionDecision?.reusableOutputHit === true,
    finalReuseDisposition,
  };
}

export function createGraphReuseExplainArtifactEnvelope(params: {
  plan?: GraphCompilePlan | null;
  runArtifact?: GraphRunArtifact | null;
  result?: Pick<
    GraphExecutionResult,
    "nodeTraces" | "reuseSummary" | "executionDecisionSummary"
  > | null;
  compileRunLinkArtifact?: GraphCompileRunLinkArtifactV1 | null;
}): GraphReuseExplainArtifactEnvelope | null {
  const plan = params.plan;
  const runArtifact = params.runArtifact;
  const graphId = plan?.fingerprintSource?.graphId ?? runArtifact?.graphId;
  const runId = runArtifact?.runId;
  const compileFingerprint =
    plan?.compileFingerprint ?? runArtifact?.compileFingerprint;

  if (!plan || !graphId || !runId || !compileFingerprint) {
    return null;
  }

  const featureEnabled =
    params.result?.executionDecisionSummary?.featureEnabled === true;
  const traceByNodeId = toTraceMap(params.result);
  const runDispositionByNodeId = toRunDispositionMap(
    params.compileRunLinkArtifact,
  );

  const nodes = plan.nodes.map((planNode) =>
    createNodeRecord({
      planNode,
      trace: traceByNodeId.get(planNode.nodeId),
      featureEnabled,
      runDisposition: runDispositionByNodeId.get(planNode.nodeId),
    }),
  );

  const reuseSummary: GraphReuseSummary | undefined =
    params.result?.reuseSummary;
  const executionDecisionSummary: GraphExecutionDecisionSummary | undefined =
    params.result?.executionDecisionSummary;

  const summary = normalizeSummary(
    {
      eligibleNodeCount:
        reuseSummary?.eligibleNodeCount ??
        reuseSummary?.eligibleNodeIds.length ??
        nodes.filter((node) => node.reuseVerdict === "eligible").length,
      ineligibleNodeCount:
        reuseSummary?.ineligibleNodeCount ??
        reuseSummary?.ineligibleNodeIds.length ??
        nodes.filter(
          (node) => node.reuseVerdict && node.reuseVerdict !== "eligible",
        ).length,
      skippedReuseNodeCount:
        executionDecisionSummary?.skippedNodeCount ??
        nodes.filter((node) => node.finalReuseDisposition === "skipped_reuse")
          .length,
      eligibleButExecutedNodeCount: nodes.filter(
        (node) => node.finalReuseDisposition === "eligible_but_executed",
      ).length,
      ineligibleExecutedNodeCount: nodes.filter(
        (node) => node.finalReuseDisposition === "ineligible_executed",
      ).length,
      notApplicableNodeCount: nodes.filter(
        (node) => node.finalReuseDisposition === "not_applicable",
      ).length,
      verdictCounts: reuseSummary?.verdictCounts,
      decisionCounts: executionDecisionSummary?.decisionCounts,
      finalDispositionCounts: createEmptyFinalDispositionCounts(),
    },
    nodes,
    featureEnabled,
  );

  const artifact = normalizeArtifact({
    graphId,
    runId,
    compileFingerprint,
    fingerprintVersion: 1,
    featureEnabled,
    nodeCount: plan.fingerprintSource?.nodeCount ?? plan.nodes.length,
    eligibleNodeIds:
      reuseSummary?.eligibleNodeIds ??
      nodes
        .filter((node) => node.reuseVerdict === "eligible")
        .map((node) => node.nodeId),
    skippedReuseNodeIds:
      executionDecisionSummary?.skipReuseOutputNodeIds ??
      nodes
        .filter((node) => node.finalReuseDisposition === "skipped_reuse")
        .map((node) => node.nodeId),
    nodes,
    summary,
  });

  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_reuse_explain_artifact",
    version: "v1",
    artifact,
  };
}

function toEnvelopeFromLegacyRecord(
  value: Record<string, unknown>,
): GraphReuseExplainArtifactEnvelope | null {
  const artifact = normalizeArtifact(value.graph_reuse_explain_artifact);
  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_reuse_explain_artifact",
    version: "v1",
    artifact,
  };
}

export function readGraphReuseExplainArtifactEnvelope(
  value: unknown,
): GraphReuseExplainArtifactEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.kind === "graph_reuse_explain_artifact" && value.version === "v1") {
    const artifact = normalizeArtifact(value.artifact);
    return artifact
      ? {
          kind: "graph_reuse_explain_artifact",
          version: "v1",
          artifact,
        }
      : null;
  }

  if (isRecord(value.bridge)) {
    return readGraphReuseExplainArtifactEnvelope(value.bridge);
  }

  if (isRecord(value.graph_reuse_explain_artifact)) {
    return readGraphReuseExplainArtifactEnvelope(
      value.graph_reuse_explain_artifact,
    );
  }

  if ("graph_reuse_explain_artifact" in value) {
    return toEnvelopeFromLegacyRecord(value);
  }

  return null;
}
