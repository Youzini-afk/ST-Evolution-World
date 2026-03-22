import type {
  GraphCompilePlan,
  GraphCompileRunLinkArtifactEnvelope,
  GraphCompileRunLinkArtifactV1,
  GraphCompileRunLinkDispositionV1,
  GraphCompileRunLinkNodeRecordV1,
  GraphExecutionResult,
  GraphNodeInputResolutionArtifactV1,
  GraphNodeTrace,
  GraphRunArtifact,
  ModuleExecutionResult,
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

function toRunDisposition(
  value: unknown,
  fallback: GraphCompileRunLinkDispositionV1 = "not_reached",
): GraphCompileRunLinkDispositionV1 {
  return value === "executed" ||
    value === "skipped_reuse" ||
    value === "failed" ||
    value === "not_reached"
    ? value
    : fallback;
}

function normalizeNodeRecord(
  value: unknown,
): GraphCompileRunLinkNodeRecordV1 | null {
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
    dependsOn: toOptionalStringArray(value.dependsOn),
    isTerminal: value.isTerminal === true,
    isSideEffect: value.isSideEffect === true,
    runDisposition: toRunDisposition(value.runDisposition),
    includedInFinalOutputs: value.includedInFinalOutputs === true,
    producedHostEffect: value.producedHostEffect === true,
    inputResolutionObserved: value.inputResolutionObserved === true,
  };
}

function normalizeArtifact(
  value: unknown,
): GraphCompileRunLinkArtifactV1 | null {
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
          (node): node is GraphCompileRunLinkNodeRecordV1 => node !== null,
        )
        .sort((left, right) => left.compileOrder - right.compileOrder)
    : [];

  const terminalOutputNodeIdsSource = toOptionalStringArray(
    value.terminalOutputNodeIds,
  );
  const hostEffectNodeIdsSource = toOptionalStringArray(
    value.hostEffectNodeIds,
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
    terminalOutputNodeIds:
      terminalOutputNodeIdsSource.length > 0
        ? terminalOutputNodeIdsSource
        : nodes
            .filter((node) => node.includedInFinalOutputs)
            .map((node) => node.nodeId),
    hostEffectNodeIds:
      hostEffectNodeIdsSource.length > 0
        ? hostEffectNodeIdsSource
        : nodes
            .filter((node) => node.producedHostEffect)
            .map((node) => node.nodeId),
    nodes,
  };
}

function collectFinalOutputNodeIds(
  finalOutputs: Record<string, any> | undefined,
): Set<string> {
  if (!finalOutputs || typeof finalOutputs !== "object") {
    return new Set<string>();
  }
  return new Set(
    Object.keys(finalOutputs).filter(
      (nodeId) => typeof nodeId === "string" && nodeId,
    ),
  );
}

function collectHostEffectNodeIds(
  result: Pick<GraphExecutionResult, "moduleResults"> | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const moduleResult of result?.moduleResults ?? []) {
    if ((moduleResult.hostWrites?.length ?? 0) > 0) {
      ids.add(moduleResult.nodeId);
    }
  }
  return ids;
}

function collectInputResolutionNodeIds(
  artifact: GraphNodeInputResolutionArtifactV1 | null | undefined,
): Set<string> {
  return new Set((artifact?.nodes ?? []).map((node) => node.nodeId));
}

function createDispositionByNodeId(params: {
  result?: Pick<GraphExecutionResult, "moduleResults" | "nodeTraces"> | null;
}): Map<string, GraphCompileRunLinkDispositionV1> {
  const dispositionByNodeId = new Map<
    string,
    GraphCompileRunLinkDispositionV1
  >();

  const moduleResultsByNodeId = new Map<string, ModuleExecutionResult>();
  for (const moduleResult of params.result?.moduleResults ?? []) {
    moduleResultsByNodeId.set(moduleResult.nodeId, moduleResult);
  }

  const executeTraces = (params.result?.nodeTraces ?? []).filter(
    (trace): trace is GraphNodeTrace => trace.stage === "execute",
  );

  for (const trace of executeTraces) {
    let disposition: GraphCompileRunLinkDispositionV1 = "not_reached";
    if (trace.status === "error") {
      disposition = "failed";
    } else if (trace.status === "skipped") {
      disposition =
        trace.executionDecision?.reason === "skip_reuse_outputs"
          ? "skipped_reuse"
          : "not_reached";
    } else if (trace.status === "ok") {
      disposition = "executed";
    }
    dispositionByNodeId.set(trace.nodeId, disposition);
  }

  for (const [nodeId, moduleResult] of moduleResultsByNodeId) {
    let disposition: GraphCompileRunLinkDispositionV1 = "not_reached";
    if (moduleResult.status === "error") {
      disposition = "failed";
    } else if (moduleResult.status === "skipped") {
      disposition =
        moduleResult.executionDecision?.reason === "skip_reuse_outputs"
          ? "skipped_reuse"
          : "not_reached";
    } else if (moduleResult.status === "ok") {
      disposition = "executed";
    }
    dispositionByNodeId.set(nodeId, disposition);
  }

  return dispositionByNodeId;
}

export function createGraphCompileRunLinkArtifactEnvelope(params: {
  plan?: GraphCompilePlan | null;
  runArtifact?: GraphRunArtifact | null;
  result?: Pick<
    GraphExecutionResult,
    "moduleResults" | "finalOutputs" | "nodeTraces" | "inputResolutionArtifact"
  > | null;
}): GraphCompileRunLinkArtifactEnvelope | null {
  const plan = params.plan;
  const runArtifact = params.runArtifact;
  const graphId = plan?.fingerprintSource?.graphId ?? runArtifact?.graphId;
  const runId = runArtifact?.runId;
  const compileFingerprint =
    plan?.compileFingerprint ?? runArtifact?.compileFingerprint;

  if (!plan || !graphId || !runId || !compileFingerprint) {
    return null;
  }

  const finalOutputNodeIds = collectFinalOutputNodeIds(
    params.result?.finalOutputs,
  );
  const hostEffectNodeIds = collectHostEffectNodeIds(params.result);
  const inputResolutionNodeIds = collectInputResolutionNodeIds(
    params.result?.inputResolutionArtifact,
  );
  const dispositionByNodeId = createDispositionByNodeId({
    result: params.result,
  });

  const artifact = normalizeArtifact({
    graphId,
    runId,
    compileFingerprint,
    fingerprintVersion: 1,
    nodeCount: plan.fingerprintSource?.nodeCount ?? plan.nodes.length,
    terminalOutputNodeIds: plan.nodes
      .filter((node) => finalOutputNodeIds.has(node.nodeId))
      .map((node) => node.nodeId),
    hostEffectNodeIds: plan.nodes
      .filter((node) => hostEffectNodeIds.has(node.nodeId))
      .map((node) => node.nodeId),
    nodes: plan.nodes.map((node) => ({
      nodeId: node.nodeId,
      moduleId: node.moduleId,
      nodeFingerprint: node.nodeFingerprint,
      compileOrder: node.order,
      dependsOn: [...node.dependsOn],
      isTerminal: node.isTerminal,
      isSideEffect: node.isSideEffectNode,
      runDisposition: dispositionByNodeId.get(node.nodeId) ?? "not_reached",
      includedInFinalOutputs: finalOutputNodeIds.has(node.nodeId),
      producedHostEffect: hostEffectNodeIds.has(node.nodeId),
      inputResolutionObserved: inputResolutionNodeIds.has(node.nodeId),
    })),
  });

  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_compile_run_link_artifact",
    version: "v1",
    artifact,
  };
}

function toEnvelopeFromLegacyRecord(
  value: Record<string, unknown>,
): GraphCompileRunLinkArtifactEnvelope | null {
  const artifact = normalizeArtifact(
    value.graph_compile_run_link_artifact ??
      value.graph_compile_run_linkage_artifact,
  );
  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_compile_run_link_artifact",
    version: "v1",
    artifact,
  };
}

export function readGraphCompileRunLinkArtifactEnvelope(
  value: unknown,
): GraphCompileRunLinkArtifactEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.kind === "graph_compile_run_link_artifact" &&
    value.version === "v1"
  ) {
    const artifact = normalizeArtifact(value.artifact);
    return artifact
      ? {
          kind: "graph_compile_run_link_artifact",
          version: "v1",
          artifact,
        }
      : null;
  }

  if (isRecord(value.bridge)) {
    return readGraphCompileRunLinkArtifactEnvelope(value.bridge);
  }

  if (isRecord(value.graph_compile_run_link_artifact)) {
    return readGraphCompileRunLinkArtifactEnvelope(
      value.graph_compile_run_link_artifact,
    );
  }

  if (
    "graph_compile_run_link_artifact" in value ||
    "graph_compile_run_linkage_artifact" in value
  ) {
    return toEnvelopeFromLegacyRecord(value);
  }

  return null;
}
