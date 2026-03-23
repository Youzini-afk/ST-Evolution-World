import type {
  GraphCompileArtifactEnvelope,
  GraphCompileArtifactNodeRecordV1,
  GraphCompileArtifactV1,
  GraphCompilePlan,
  HostCommitSummary,
  HostWriteSummary,
  WorkbenchCapability,
  WorkbenchSideEffectLevel,
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

function toCapability(value: unknown): WorkbenchCapability | undefined {
  return typeof value === "string" ? (value as WorkbenchCapability) : undefined;
}

function toSideEffect(value: unknown): WorkbenchSideEffectLevel | undefined {
  return typeof value === "string"
    ? (value as WorkbenchSideEffectLevel)
    : undefined;
}

function cloneHostWriteSummary(value: unknown): HostWriteSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const kind = toRequiredString(value.kind);
  const targetType = toRequiredString(value.targetType);
  const operation = toRequiredString(value.operation);
  if (!kind || !targetType || !operation) {
    return undefined;
  }

  return {
    kind,
    targetType,
    operation,
    ...(typeof value.targetId === "string" ? { targetId: value.targetId } : {}),
    ...(typeof value.path === "string" ? { path: value.path } : {}),
  };
}

function cloneHostCommitSummary(value: unknown): HostCommitSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const kind = toRequiredString(value.kind);
  const mode = value.mode === "immediate" ? "immediate" : undefined;
  const targetType = toRequiredString(value.targetType);
  const operation = toRequiredString(value.operation);
  if (!kind || !mode || !targetType || !operation) {
    return undefined;
  }

  return {
    kind,
    mode,
    targetType,
    operation,
    ...(typeof value.targetId === "string" ? { targetId: value.targetId } : {}),
    ...(typeof value.path === "string" ? { path: value.path } : {}),
  };
}

function normalizeNodeRecordV1(
  value: unknown,
): GraphCompileArtifactNodeRecordV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const nodeId = toRequiredString(value.nodeId);
  const moduleId = toRequiredString(value.moduleId);
  const nodeFingerprint = toRequiredString(value.nodeFingerprint);
  if (!nodeId || !moduleId || !nodeFingerprint) {
    return null;
  }

  const order = toNonNegativeInt(value.order);
  const record: GraphCompileArtifactNodeRecordV1 = {
    nodeId,
    moduleId,
    nodeFingerprint,
    order,
    dependsOn: toOptionalStringArray(value.dependsOn),
    isTerminal: value.isTerminal === true,
  };

  const capability = toCapability(value.capability);
  if (capability) {
    record.capability = capability;
  }
  const sideEffect = toSideEffect(value.sideEffect);
  if (sideEffect) {
    record.sideEffect = sideEffect;
  }
  const hostWriteSummary = cloneHostWriteSummary(value.hostWriteSummary);
  if (hostWriteSummary) {
    record.hostWriteSummary = hostWriteSummary;
  }
  const hostCommitSummary = cloneHostCommitSummary(value.hostCommitSummary);
  if (hostCommitSummary) {
    record.hostCommitSummary = hostCommitSummary;
  }

  return record;
}

function normalizeArtifactV1(value: unknown): GraphCompileArtifactV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const compileFingerprint = toRequiredString(value.compileFingerprint);
  const graphId = toRequiredString(value.graphId);
  if (!compileFingerprint || !graphId) {
    return null;
  }

  const nodes = Array.isArray(value.nodes)
    ? value.nodes
        .map((node) => normalizeNodeRecordV1(node))
        .filter(
          (node): node is GraphCompileArtifactNodeRecordV1 => node !== null,
        )
    : [];

  const nodeOrderSource = toOptionalStringArray(value.nodeOrder);
  const nodeOrder =
    nodeOrderSource.length > 0
      ? nodeOrderSource
      : [...nodes]
          .sort((left, right) => left.order - right.order)
          .map((node) => node.nodeId);

  const terminalNodeIdsSource = toOptionalStringArray(value.terminalNodeIds);
  const terminalNodeIds =
    terminalNodeIdsSource.length > 0
      ? terminalNodeIdsSource
      : nodes.filter((node) => node.isTerminal).map((node) => node.nodeId);

  const sideEffectNodeIdsSource = toOptionalStringArray(
    value.sideEffectNodeIds,
  );
  const sideEffectNodeIds =
    sideEffectNodeIdsSource.length > 0
      ? sideEffectNodeIdsSource
      : nodes
          .filter((node) => node.sideEffect === "writes_host")
          .map((node) => node.nodeId);

  return {
    compileFingerprint,
    fingerprintVersion: 1,
    graphId,
    nodeCount:
      value.nodeCount === undefined
        ? nodes.length
        : toNonNegativeInt(value.nodeCount),
    edgeCount: toNonNegativeInt(value.edgeCount),
    nodeOrder,
    terminalNodeIds,
    sideEffectNodeIds,
    nodes,
  };
}

export function createGraphCompileArtifactEnvelope(params: {
  plan?: GraphCompilePlan | null;
}): GraphCompileArtifactEnvelope | null {
  const plan = params.plan;
  if (!plan) {
    return null;
  }

  const artifact = normalizeArtifactV1({
    compileFingerprint: plan.compileFingerprint,
    fingerprintVersion: 1,
    graphId: plan.fingerprintSource?.graphId,
    nodeCount: plan.fingerprintSource?.nodeCount ?? plan.nodes.length,
    edgeCount: plan.fingerprintSource?.edgeCount ?? 0,
    nodeOrder: plan.nodeOrder,
    terminalNodeIds: plan.terminalNodeIds,
    sideEffectNodeIds: plan.sideEffectNodeIds,
    nodes: plan.nodes.map((node) => ({
      nodeId: node.nodeId,
      moduleId: node.moduleId,
      nodeFingerprint: node.nodeFingerprint,
      order: node.order,
      dependsOn: [...node.dependsOn],
      isTerminal: node.isTerminal,
      ...(node.capability ? { capability: node.capability } : {}),
      ...(node.sideEffect ? { sideEffect: node.sideEffect } : {}),
      ...(node.hostWriteSummary
        ? { hostWriteSummary: { ...node.hostWriteSummary } }
        : {}),
      ...(node.hostCommitSummary
        ? { hostCommitSummary: { ...node.hostCommitSummary } }
        : {}),
    })),
  });

  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_compile_artifact",
    version: "v1",
    artifact,
  };
}

function toEnvelopeFromLegacyRecord(
  value: Record<string, unknown>,
): GraphCompileArtifactEnvelope | null {
  const artifact = normalizeArtifactV1(
    value.graph_compile_artifact ?? value.graph_compile_plan,
  );
  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_compile_artifact",
    version: "v1",
    artifact,
  };
}

export function readGraphCompileArtifactEnvelope(
  value: unknown,
): GraphCompileArtifactEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.kind === "graph_compile_artifact" && value.version === "v1") {
    const artifact = normalizeArtifactV1(value.artifact);
    if (!artifact) {
      return null;
    }

    return {
      kind: "graph_compile_artifact",
      version: "v1",
      artifact,
    };
  }

  if (isRecord(value.bridge)) {
    return readGraphCompileArtifactEnvelope(value.bridge);
  }

  if (isRecord(value.graph_compile_artifact)) {
    return readGraphCompileArtifactEnvelope(value.graph_compile_artifact);
  }

  if ("graph_compile_artifact" in value || "graph_compile_plan" in value) {
    return toEnvelopeFromLegacyRecord(value);
  }

  return null;
}
