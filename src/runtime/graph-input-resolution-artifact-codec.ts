import type {
  GraphExecutionResult,
  GraphNodeInputMissingReason,
  GraphNodeInputResolutionArtifactEnvelope,
  GraphNodeInputResolutionArtifactV1,
  GraphNodeInputResolutionItemV1,
  GraphNodeInputResolutionNodeRecordV1,
  GraphNodeInputResolutionStatus,
  GraphNodeInputSourceKind,
  GraphNodeInputValueSummary,
} from "../ui/components/graph/module-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toRequiredString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toInputResolutionStatus(
  value: unknown,
): GraphNodeInputResolutionStatus {
  return value === "resolved" ||
    value === "missing" ||
    value === "defaulted" ||
    value === "unknown"
    ? value
    : "unknown";
}

function toSourceKind(value: unknown): GraphNodeInputSourceKind {
  return value === "edge" ||
    value === "context" ||
    value === "default" ||
    value === "constant" ||
    value === "unknown"
    ? value
    : "unknown";
}

function toMissingReason(
  value: unknown,
): GraphNodeInputMissingReason | undefined {
  return value === "upstream_unavailable" ||
    value === "value_unavailable" ||
    value === "no_observed_source" ||
    value === "unknown"
    ? value
    : undefined;
}

function toValueType(value: unknown): GraphNodeInputValueSummary["valueType"] {
  return value === "string" ||
    value === "number" ||
    value === "boolean" ||
    value === "array" ||
    value === "object" ||
    value === "null" ||
    value === "undefined" ||
    value === "unknown"
    ? value
    : "unknown";
}

function normalizeValueSummary(
  value: unknown,
): GraphNodeInputValueSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const valueFingerprint = toRequiredString(value.valueFingerprint);
  if (!valueFingerprint) {
    return undefined;
  }

  return {
    valuePreview: toRequiredString(value.valuePreview),
    valueFingerprint,
    valueType: toValueType(value.valueType),
    isTruncated: value.isTruncated === true,
  };
}

function normalizeInputItem(
  value: unknown,
): GraphNodeInputResolutionItemV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const inputKey = toRequiredString(value.inputKey);
  if (!inputKey) {
    return null;
  }

  const resolutionStatus = toInputResolutionStatus(value.resolutionStatus);
  const item: GraphNodeInputResolutionItemV1 = {
    inputKey,
    resolutionStatus,
    sourceKind: toSourceKind(value.sourceKind),
    isDefaulted: value.isDefaulted === true,
  };

  if (typeof value.sourceNodeId === "string" && value.sourceNodeId) {
    item.sourceNodeId = value.sourceNodeId;
  }
  if (typeof value.sourcePort === "string" && value.sourcePort) {
    item.sourcePort = value.sourcePort;
  }
  const missingReason = toMissingReason(value.missingReason);
  if (missingReason) {
    item.missingReason = missingReason;
  }
  const valueSummary = normalizeValueSummary(value.valueSummary);
  if (valueSummary) {
    item.valueSummary = valueSummary;
  }

  return item;
}

function normalizeNodeRecord(
  value: unknown,
): GraphNodeInputResolutionNodeRecordV1 | null {
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
    inputs: Array.isArray(value.inputs)
      ? value.inputs
          .map((item) => normalizeInputItem(item))
          .filter(
            (item): item is GraphNodeInputResolutionItemV1 => item !== null,
          )
      : [],
  };
}

function normalizeArtifact(
  value: unknown,
): GraphNodeInputResolutionArtifactV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const runId = toRequiredString(value.runId);
  const graphId = toRequiredString(value.graphId);
  if (!runId || !graphId) {
    return null;
  }

  return {
    runId,
    graphId,
    ...(typeof value.compileFingerprint === "string" && value.compileFingerprint
      ? { compileFingerprint: value.compileFingerprint }
      : {}),
    nodes: Array.isArray(value.nodes)
      ? value.nodes
          .map((node) => normalizeNodeRecord(node))
          .filter(
            (node): node is GraphNodeInputResolutionNodeRecordV1 =>
              node !== null,
          )
      : [],
  };
}

export function createGraphNodeInputResolutionArtifactEnvelope(params: {
  result?: Pick<
    GraphExecutionResult,
    "requestId" | "runArtifact" | "inputResolutionArtifact"
  > | null;
}): GraphNodeInputResolutionArtifactEnvelope | null {
  const artifact = normalizeArtifact(
    params.result?.inputResolutionArtifact ?? {
      runId: params.result?.runArtifact?.runId ?? params.result?.requestId,
      graphId: params.result?.runArtifact?.graphId,
      compileFingerprint: params.result?.runArtifact?.compileFingerprint,
      nodes: params.result?.inputResolutionArtifact?.nodes,
    },
  );
  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_node_input_resolution_artifact",
    version: "v1",
    artifact,
  };
}

function toEnvelopeFromLegacyRecord(
  value: Record<string, unknown>,
): GraphNodeInputResolutionArtifactEnvelope | null {
  const artifact = normalizeArtifact(
    value.graph_node_input_resolution_artifact ?? value.graph_input_resolution,
  );
  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_node_input_resolution_artifact",
    version: "v1",
    artifact,
  };
}

export function readGraphNodeInputResolutionArtifactEnvelope(
  value: unknown,
): GraphNodeInputResolutionArtifactEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.kind === "graph_node_input_resolution_artifact" &&
    value.version === "v1"
  ) {
    const artifact = normalizeArtifact(value.artifact);
    return artifact
      ? {
          kind: "graph_node_input_resolution_artifact",
          version: "v1",
          artifact,
        }
      : null;
  }

  if (isRecord(value.bridge)) {
    return readGraphNodeInputResolutionArtifactEnvelope(value.bridge);
  }

  if (isRecord(value.graph_node_input_resolution_artifact)) {
    return readGraphNodeInputResolutionArtifactEnvelope(
      value.graph_node_input_resolution_artifact,
    );
  }

  if (
    "graph_node_input_resolution_artifact" in value ||
    "graph_input_resolution" in value
  ) {
    return toEnvelopeFromLegacyRecord(value);
  }

  return null;
}
