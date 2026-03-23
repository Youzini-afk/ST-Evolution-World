import type {
  GraphCompilePlan,
  GraphCompileRunLinkArtifactV1,
  GraphExecutionResult,
  GraphHostEffectExplainArtifactEnvelope,
  GraphHostEffectExplainArtifactV1,
  GraphHostEffectExplainCommitRecordV1,
  GraphHostEffectExplainDispositionKindV1,
  GraphHostEffectExplainNodeRecordV1,
  GraphHostEffectExplainProjectionKindV1,
  GraphHostEffectExplainSummaryV1,
  GraphHostEffectExplainWriteRecordV1,
  GraphOutputExplainArtifactV1,
  GraphRunArtifact,
  HostCommitContract,
  HostWriteDescriptor,
  ModuleExecutionResult,
} from "../ui/components/graph/module-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toRequiredString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
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

function toHostEffectProjectionKind(
  value: unknown,
  fallback: GraphHostEffectExplainProjectionKindV1 = "no_host_effect",
): GraphHostEffectExplainProjectionKindV1 {
  return value === "host_effect_only" ||
    value === "host_effect_and_output" ||
    value === "declared_only" ||
    value === "no_host_effect" ||
    value === "not_reached" ||
    value === "failed"
    ? value
    : fallback;
}

function toDispositionKind(
  value: unknown,
  fallback: GraphHostEffectExplainDispositionKindV1 = "no_host_effect_evidence",
): GraphHostEffectExplainDispositionKindV1 {
  return value === "declared_and_observed" ||
    value === "declared_but_unobserved" ||
    value === "observed_but_undeclared" ||
    value === "no_host_effect_evidence"
    ? value
    : fallback;
}

function normalizeHostWriteSummary(
  value: unknown,
): GraphHostEffectExplainWriteRecordV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const kind = toRequiredString(value.kind);
  const targetType = toRequiredString(value.targetType);
  const operation = toRequiredString(value.operation);
  if (!kind || !targetType || !operation) {
    return null;
  }

  return {
    kind,
    targetType,
    ...(toOptionalString(value.targetId)
      ? { targetId: toOptionalString(value.targetId) }
      : {}),
    operation,
    ...(toOptionalString(value.path)
      ? { path: toOptionalString(value.path) }
      : {}),
  };
}

function normalizeHostCommitSummary(
  value: unknown,
): GraphHostEffectExplainCommitRecordV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const kind = toRequiredString(value.kind);
  const mode = toRequiredString(value.mode);
  const targetType = toRequiredString(value.targetType);
  const operation = toRequiredString(value.operation);
  if (!kind || !mode || !targetType || !operation) {
    return null;
  }

  return {
    kind,
    mode,
    targetType,
    ...(toOptionalString(value.targetId)
      ? { targetId: toOptionalString(value.targetId) }
      : {}),
    operation,
    ...(toOptionalString(value.path)
      ? { path: toOptionalString(value.path) }
      : {}),
    supportsRetry: value.supportsRetry === true,
  };
}

function inferHostEffectProjectionKind(params: {
  runDisposition: GraphHostEffectExplainNodeRecordV1["runDisposition"];
  runtimeObservedHostEffect: boolean;
  outputProjectionKind: GraphHostEffectExplainNodeRecordV1["outputProjectionKind"];
  compileDeclaredHostEffect: boolean;
}): GraphHostEffectExplainProjectionKindV1 {
  const {
    runDisposition,
    runtimeObservedHostEffect,
    outputProjectionKind,
    compileDeclaredHostEffect,
  } = params;

  if (runDisposition === "failed") {
    return "failed";
  }
  if (runDisposition === "not_reached") {
    return "not_reached";
  }
  if (
    runtimeObservedHostEffect &&
    outputProjectionKind === "host_effect_only"
  ) {
    return "host_effect_only";
  }
  if (runtimeObservedHostEffect) {
    return "host_effect_and_output";
  }
  if (compileDeclaredHostEffect) {
    return "declared_only";
  }
  return "no_host_effect";
}

function inferDispositionKind(params: {
  compileDeclaredHostEffect: boolean;
  runtimeObservedHostEffect: boolean;
  runtimeObservedHostCommitContract: boolean;
}): GraphHostEffectExplainDispositionKindV1 {
  const {
    compileDeclaredHostEffect,
    runtimeObservedHostEffect,
    runtimeObservedHostCommitContract,
  } = params;
  const runtimeObserved =
    runtimeObservedHostEffect || runtimeObservedHostCommitContract;

  if (compileDeclaredHostEffect && runtimeObserved) {
    return "declared_and_observed";
  }
  if (compileDeclaredHostEffect) {
    return "declared_but_unobserved";
  }
  if (runtimeObserved) {
    return "observed_but_undeclared";
  }
  return "no_host_effect_evidence";
}

function normalizeNodeRecord(
  value: unknown,
): GraphHostEffectExplainNodeRecordV1 | null {
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
  const compileDeclaredHostEffect = value.compileDeclaredHostEffect === true;
  const runtimeObservedHostEffect = value.runtimeObservedHostEffect === true;
  const runtimeObservedHostCommitContract =
    value.runtimeObservedHostCommitContract === true;
  const outputProjectionKind =
    value.outputProjectionKind === "final_output" ||
    value.outputProjectionKind === "intermediate_output" ||
    value.outputProjectionKind === "host_effect_only" ||
    value.outputProjectionKind === "no_observed_output" ||
    value.outputProjectionKind === "not_reached" ||
    value.outputProjectionKind === "failed"
      ? value.outputProjectionKind
      : "no_observed_output";

  return {
    nodeId,
    moduleId,
    nodeFingerprint,
    compileOrder: toNonNegativeInt(value.compileOrder),
    runDisposition,
    isTerminal: value.isTerminal === true,
    isSideEffect: value.isSideEffect === true,
    compileDeclaredHostEffect,
    runtimeObservedHostEffect,
    runtimeObservedHostCommitContract,
    hostWriteCount: toNonNegativeInt(value.hostWriteCount),
    hostCommitContractCount: toNonNegativeInt(value.hostCommitContractCount),
    hostEffectOnly: value.hostEffectOnly === true,
    outputProjectionKind,
    hostEffectProjectionKind: toHostEffectProjectionKind(
      value.hostEffectProjectionKind,
      inferHostEffectProjectionKind({
        runDisposition,
        runtimeObservedHostEffect,
        outputProjectionKind,
        compileDeclaredHostEffect,
      }),
    ),
    dispositionKind: toDispositionKind(
      value.dispositionKind,
      inferDispositionKind({
        compileDeclaredHostEffect,
        runtimeObservedHostEffect,
        runtimeObservedHostCommitContract,
      }),
    ),
    hostWriteSummaries: Array.isArray(value.hostWriteSummaries)
      ? value.hostWriteSummaries
          .map((entry) => normalizeHostWriteSummary(entry))
          .filter(
            (entry): entry is GraphHostEffectExplainWriteRecordV1 =>
              entry !== null,
          )
      : [],
    hostCommitSummaries: Array.isArray(value.hostCommitSummaries)
      ? value.hostCommitSummaries
          .map((entry) => normalizeHostCommitSummary(entry))
          .filter(
            (entry): entry is GraphHostEffectExplainCommitRecordV1 =>
              entry !== null,
          )
      : [],
  };
}

function deriveSummaryFromNodes(
  nodes: readonly GraphHostEffectExplainNodeRecordV1[],
): GraphHostEffectExplainSummaryV1 {
  return nodes.reduce<GraphHostEffectExplainSummaryV1>(
    (summary, node) => {
      if (node.compileDeclaredHostEffect) {
        summary.declaredHostEffectNodeCount += 1;
      }
      if (node.runtimeObservedHostEffect) {
        summary.observedHostEffectNodeCount += 1;
      }
      if (node.runtimeObservedHostCommitContract) {
        summary.commitContractObservedNodeCount += 1;
      }
      if (node.hostEffectOnly) {
        summary.hostEffectOnlyNodeCount += 1;
      }
      if (
        node.compileDeclaredHostEffect &&
        !node.runtimeObservedHostEffect &&
        !node.runtimeObservedHostCommitContract
      ) {
        summary.compileDeclaredButUnobservedNodeCount += 1;
      }
      if (
        !node.compileDeclaredHostEffect &&
        (node.runtimeObservedHostEffect ||
          node.runtimeObservedHostCommitContract)
      ) {
        summary.runtimeObservedButUndeclaredNodeCount += 1;
      }
      return summary;
    },
    {
      declaredHostEffectNodeCount: 0,
      observedHostEffectNodeCount: 0,
      commitContractObservedNodeCount: 0,
      hostEffectOnlyNodeCount: 0,
      compileDeclaredButUnobservedNodeCount: 0,
      runtimeObservedButUndeclaredNodeCount: 0,
    },
  );
}

function normalizeSummary(
  value: unknown,
  nodes: readonly GraphHostEffectExplainNodeRecordV1[],
): GraphHostEffectExplainSummaryV1 {
  const derived = deriveSummaryFromNodes(nodes);
  if (!isRecord(value)) {
    return derived;
  }

  return {
    declaredHostEffectNodeCount: toNonNegativeInt(
      value.declaredHostEffectNodeCount,
      derived.declaredHostEffectNodeCount,
    ),
    observedHostEffectNodeCount: toNonNegativeInt(
      value.observedHostEffectNodeCount,
      derived.observedHostEffectNodeCount,
    ),
    commitContractObservedNodeCount: toNonNegativeInt(
      value.commitContractObservedNodeCount,
      derived.commitContractObservedNodeCount,
    ),
    hostEffectOnlyNodeCount: toNonNegativeInt(
      value.hostEffectOnlyNodeCount,
      derived.hostEffectOnlyNodeCount,
    ),
    compileDeclaredButUnobservedNodeCount: toNonNegativeInt(
      value.compileDeclaredButUnobservedNodeCount,
      derived.compileDeclaredButUnobservedNodeCount,
    ),
    runtimeObservedButUndeclaredNodeCount: toNonNegativeInt(
      value.runtimeObservedButUndeclaredNodeCount,
      derived.runtimeObservedButUndeclaredNodeCount,
    ),
  };
}

function normalizeArtifact(
  value: unknown,
): GraphHostEffectExplainArtifactV1 | null {
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
          (node): node is GraphHostEffectExplainNodeRecordV1 => node !== null,
        )
        .sort((left, right) => left.compileOrder - right.compileOrder)
    : [];

  const summary = normalizeSummary(value.summary, nodes);
  const declaredHostEffectNodeIds = toOptionalStringArray(
    value.declaredHostEffectNodeIds,
  );
  const observedHostEffectNodeIds = toOptionalStringArray(
    value.observedHostEffectNodeIds,
  );
  const commitContractObservedNodeIds = toOptionalStringArray(
    value.commitContractObservedNodeIds,
  );
  const hostEffectOnlyNodeIds = toOptionalStringArray(
    value.hostEffectOnlyNodeIds,
  );

  return {
    graphId,
    runId,
    compileFingerprint,
    fingerprintVersion: 1,
    nodeCount:
      value.nodeCount === undefined
        ? nodes.length
        : toNonNegativeInt(value.nodeCount, nodes.length),
    declaredHostEffectNodeIds:
      declaredHostEffectNodeIds.length > 0
        ? declaredHostEffectNodeIds
        : nodes
            .filter((node) => node.compileDeclaredHostEffect)
            .map((node) => node.nodeId),
    observedHostEffectNodeIds:
      observedHostEffectNodeIds.length > 0
        ? observedHostEffectNodeIds
        : nodes
            .filter((node) => node.runtimeObservedHostEffect)
            .map((node) => node.nodeId),
    commitContractObservedNodeIds:
      commitContractObservedNodeIds.length > 0
        ? commitContractObservedNodeIds
        : nodes
            .filter((node) => node.runtimeObservedHostCommitContract)
            .map((node) => node.nodeId),
    hostEffectOnlyNodeIds:
      hostEffectOnlyNodeIds.length > 0
        ? hostEffectOnlyNodeIds
        : nodes
            .filter((node) => node.hostEffectOnly)
            .map((node) => node.nodeId),
    nodes,
    summary,
  };
}

function summarizeHostWrite(
  value: HostWriteDescriptor | null | undefined,
): GraphHostEffectExplainWriteRecordV1 | null {
  if (!value) {
    return null;
  }
  return {
    kind: value.kind,
    targetType: value.targetType,
    ...(typeof value.targetId === "string" && value.targetId.trim()
      ? { targetId: value.targetId }
      : {}),
    operation: value.operation,
    ...(typeof value.path === "string" && value.path.trim()
      ? { path: value.path }
      : {}),
  };
}

function summarizeHostCommit(
  value: HostCommitContract | null | undefined,
): GraphHostEffectExplainCommitRecordV1 | null {
  if (!value) {
    return null;
  }
  return {
    kind: value.kind,
    mode: value.mode,
    targetType: value.targetType,
    ...(typeof value.targetId === "string" && value.targetId.trim()
      ? { targetId: value.targetId }
      : {}),
    operation: value.operation,
    ...(typeof value.path === "string" && value.path.trim()
      ? { path: value.path }
      : {}),
    supportsRetry: value.supportsRetry === true,
  };
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

function toOutputProjectionKindMap(
  outputExplainArtifact?: GraphOutputExplainArtifactV1 | null,
): Map<string, GraphHostEffectExplainNodeRecordV1["outputProjectionKind"]> {
  return new Map(
    (outputExplainArtifact?.nodes ?? []).map((node) => [
      node.nodeId,
      node.projectionKind,
    ]),
  );
}

function inferCompileDeclaredHostEffect(
  planNode: GraphCompilePlan["nodes"][number],
): boolean {
  return Boolean(planNode.isSideEffectNode || planNode.hostWriteSummary);
}

function createNodeRecord(params: {
  planNode: GraphCompilePlan["nodes"][number];
  linkageNode?: GraphCompileRunLinkArtifactV1["nodes"][number];
  moduleResult?: ModuleExecutionResult;
  outputProjectionKind?: GraphHostEffectExplainNodeRecordV1["outputProjectionKind"];
}): GraphHostEffectExplainNodeRecordV1 {
  const { planNode, linkageNode, moduleResult } = params;
  const hostWriteSummaries = (moduleResult?.hostWrites ?? [])
    .map((entry) => summarizeHostWrite(entry))
    .filter(
      (entry): entry is GraphHostEffectExplainWriteRecordV1 => entry !== null,
    );
  const hostCommitSummaries = (moduleResult?.hostCommitContracts ?? [])
    .map((entry) => summarizeHostCommit(entry))
    .filter(
      (entry): entry is GraphHostEffectExplainCommitRecordV1 => entry !== null,
    );
  const runtimeObservedHostEffect = hostWriteSummaries.length > 0;
  const runtimeObservedHostCommitContract = hostCommitSummaries.length > 0;
  const compileDeclaredHostEffect = inferCompileDeclaredHostEffect(planNode);
  const outputProjectionKind =
    params.outputProjectionKind ??
    (runtimeObservedHostEffect ? "host_effect_only" : "no_observed_output");
  const hostEffectOnly = outputProjectionKind === "host_effect_only";

  return {
    nodeId: planNode.nodeId,
    moduleId: planNode.moduleId,
    nodeFingerprint: planNode.nodeFingerprint,
    compileOrder: planNode.order,
    runDisposition: linkageNode?.runDisposition ?? "not_reached",
    isTerminal: planNode.isTerminal,
    isSideEffect: planNode.isSideEffectNode,
    compileDeclaredHostEffect,
    runtimeObservedHostEffect,
    runtimeObservedHostCommitContract,
    hostWriteCount: hostWriteSummaries.length,
    hostCommitContractCount: hostCommitSummaries.length,
    hostEffectOnly,
    outputProjectionKind,
    hostEffectProjectionKind: inferHostEffectProjectionKind({
      runDisposition: linkageNode?.runDisposition ?? "not_reached",
      runtimeObservedHostEffect,
      outputProjectionKind,
      compileDeclaredHostEffect,
    }),
    dispositionKind: inferDispositionKind({
      compileDeclaredHostEffect,
      runtimeObservedHostEffect,
      runtimeObservedHostCommitContract,
    }),
    hostWriteSummaries,
    hostCommitSummaries,
  };
}

export function createGraphHostEffectExplainArtifactEnvelope(params: {
  plan?: GraphCompilePlan | null;
  runArtifact?: GraphRunArtifact | null;
  result?: Pick<GraphExecutionResult, "moduleResults"> | null;
  compileRunLinkArtifact?: GraphCompileRunLinkArtifactV1 | null;
  outputExplainArtifact?: GraphOutputExplainArtifactV1 | null;
}): GraphHostEffectExplainArtifactEnvelope | null {
  const plan = params.plan;
  const runArtifact = params.runArtifact;
  const compileRunLinkArtifact = params.compileRunLinkArtifact;
  const outputExplainArtifact = params.outputExplainArtifact;
  const graphId =
    plan?.fingerprintSource?.graphId ??
    compileRunLinkArtifact?.graphId ??
    outputExplainArtifact?.graphId ??
    runArtifact?.graphId;
  const runId =
    runArtifact?.runId ??
    compileRunLinkArtifact?.runId ??
    outputExplainArtifact?.runId;
  const compileFingerprint =
    plan?.compileFingerprint ??
    compileRunLinkArtifact?.compileFingerprint ??
    outputExplainArtifact?.compileFingerprint ??
    runArtifact?.compileFingerprint;

  if (!plan || !graphId || !runId || !compileFingerprint) {
    return null;
  }

  const moduleResultByNodeId = toModuleResultMap(params.result);
  const linkageNodeByNodeId = new Map(
    (compileRunLinkArtifact?.nodes ?? []).map((node) => [node.nodeId, node]),
  );
  const outputProjectionKindByNodeId = toOutputProjectionKindMap(
    outputExplainArtifact,
  );

  const nodes = plan.nodes.map((planNode) =>
    createNodeRecord({
      planNode,
      linkageNode: linkageNodeByNodeId.get(planNode.nodeId),
      moduleResult: moduleResultByNodeId.get(planNode.nodeId),
      outputProjectionKind: outputProjectionKindByNodeId.get(planNode.nodeId),
    }),
  );

  const artifact = normalizeArtifact({
    graphId,
    runId,
    compileFingerprint,
    fingerprintVersion: 1,
    nodeCount: plan.fingerprintSource?.nodeCount ?? plan.nodes.length,
    declaredHostEffectNodeIds: nodes
      .filter((node) => node.compileDeclaredHostEffect)
      .map((node) => node.nodeId),
    observedHostEffectNodeIds: nodes
      .filter((node) => node.runtimeObservedHostEffect)
      .map((node) => node.nodeId),
    commitContractObservedNodeIds: nodes
      .filter((node) => node.runtimeObservedHostCommitContract)
      .map((node) => node.nodeId),
    hostEffectOnlyNodeIds: nodes
      .filter((node) => node.hostEffectOnly)
      .map((node) => node.nodeId),
    nodes,
    summary: deriveSummaryFromNodes(nodes),
  });

  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_host_effect_explain_artifact",
    version: "v1",
    artifact,
  };
}

function toEnvelopeFromLegacyRecord(
  value: Record<string, unknown>,
): GraphHostEffectExplainArtifactEnvelope | null {
  const artifact = normalizeArtifact(value.graph_host_effect_explain_artifact);
  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_host_effect_explain_artifact",
    version: "v1",
    artifact,
  };
}

export function readGraphHostEffectExplainArtifactEnvelope(
  value: unknown,
): GraphHostEffectExplainArtifactEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.kind === "graph_host_effect_explain_artifact" &&
    value.version === "v1"
  ) {
    const artifact = normalizeArtifact(value.artifact);
    return artifact
      ? {
          kind: "graph_host_effect_explain_artifact",
          version: "v1",
          artifact,
        }
      : null;
  }

  const directArtifact = normalizeArtifact(value);
  if (directArtifact) {
    return {
      kind: "graph_host_effect_explain_artifact",
      version: "v1",
      artifact: directArtifact,
    };
  }

  if (isRecord(value.bridge)) {
    return readGraphHostEffectExplainArtifactEnvelope(value.bridge);
  }

  if (isRecord(value.graph_host_effect_explain_artifact)) {
    return readGraphHostEffectExplainArtifactEnvelope(
      value.graph_host_effect_explain_artifact,
    );
  }

  if ("graph_host_effect_explain_artifact" in value) {
    return toEnvelopeFromLegacyRecord(value);
  }

  return null;
}
