import type {
  GraphCompilePlan,
  GraphCompileRunLinkArtifactV1,
  GraphExecutionResult,
  GraphOutputExplainArtifactEnvelope,
  GraphOutputExplainArtifactV1,
  GraphOutputExplainNodeRecordV1,
  GraphOutputExplainProjectionKindV1,
  GraphOutputExplainSummaryV1,
  GraphRunArtifact,
  ModuleExecutionResult,
} from "../ui/components/graph/module-types";
import { simpleHash } from "./helpers";

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

function toProjectionKind(
  value: unknown,
  fallback: GraphOutputExplainProjectionKindV1 = "no_observed_output",
): GraphOutputExplainProjectionKindV1 {
  return value === "final_output" ||
    value === "intermediate_output" ||
    value === "host_effect_only" ||
    value === "no_observed_output" ||
    value === "not_reached" ||
    value === "failed"
    ? value
    : fallback;
}

function inferOutputValueType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function toStableJson(value: unknown): string {
  return JSON.stringify(value, (_key, currentValue) => {
    if (currentValue && typeof currentValue === "object") {
      if (Array.isArray(currentValue)) {
        return currentValue;
      }
      return Object.keys(currentValue as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((accumulator, key) => {
          accumulator[key] = (currentValue as Record<string, unknown>)[key];
          return accumulator;
        }, {});
    }
    return currentValue;
  });
}

function toOutputPreviewSummary(value: unknown): string {
  if (typeof value === "string") {
    return `string(length=${value.length})`;
  }
  if (Array.isArray(value)) {
    return `array(items=${value.length})`;
  }
  if (value === null) {
    return "null";
  }
  if (isRecord(value)) {
    return `object(keys=${Object.keys(value).length})`;
  }
  return inferOutputValueType(value);
}

function toFingerprintSource(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  const stable = toStableJson(value);
  return stable === undefined ? String(value) : stable;
}

function summarizeOutputValue(value: unknown): {
  outputObserved: boolean;
  outputValueType?: string;
  outputPreview?: string;
  outputFingerprintSummary?: string;
  isTruncated: boolean;
} {
  if (value === undefined) {
    return {
      outputObserved: false,
      isTruncated: false,
    };
  }

  const outputValueType = inferOutputValueType(value);
  const outputPreview = toOutputPreviewSummary(value);
  const outputFingerprintSummary = `sha1:${simpleHash(toFingerprintSource(value))}`;

  return {
    outputObserved: true,
    outputValueType,
    outputPreview,
    outputFingerprintSummary,
    isTruncated: false,
  };
}

function selectObservedOutputValue(
  moduleResult: ModuleExecutionResult | undefined,
  includedInFinalOutputs: boolean,
): unknown {
  if (!moduleResult || !isRecord(moduleResult.outputs)) {
    return undefined;
  }

  const outputs = moduleResult.outputs;
  const entries = Object.entries(outputs);
  if (entries.length === 0) {
    return undefined;
  }

  if (includedInFinalOutputs) {
    const preferredKeys = ["result", "output", "text", "value"];
    for (const key of preferredKeys) {
      if (Object.prototype.hasOwnProperty.call(outputs, key)) {
        return outputs[key];
      }
    }
  }

  return entries[0]?.[1];
}

function inferProjectionKind(params: {
  runDisposition: GraphCompileRunLinkArtifactV1["nodes"][number]["runDisposition"];
  includedInFinalOutputs: boolean;
  outputObserved: boolean;
  producedHostEffect: boolean;
}): GraphOutputExplainProjectionKindV1 {
  const {
    runDisposition,
    includedInFinalOutputs,
    outputObserved,
    producedHostEffect,
  } = params;

  if (runDisposition === "failed") {
    return "failed";
  }
  if (runDisposition === "not_reached") {
    return "not_reached";
  }
  if (includedInFinalOutputs && outputObserved) {
    return "final_output";
  }
  if (outputObserved) {
    return "intermediate_output";
  }
  if (producedHostEffect) {
    return "host_effect_only";
  }
  return "no_observed_output";
}

function normalizeNodeRecord(
  value: unknown,
): GraphOutputExplainNodeRecordV1 | null {
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
  const includedInFinalOutputs = value.includedInFinalOutputs === true;
  const producedHostEffect = value.producedHostEffect === true;
  const outputObserved = value.outputObserved === true;

  return {
    nodeId,
    moduleId,
    nodeFingerprint,
    compileOrder: toNonNegativeInt(value.compileOrder),
    runDisposition,
    isTerminal: value.isTerminal === true,
    isSideEffect: value.isSideEffect === true,
    outputObserved,
    ...(toOptionalString(value.outputValueType)
      ? { outputValueType: toOptionalString(value.outputValueType) }
      : {}),
    ...(toOptionalString(value.outputPreview)
      ? { outputPreview: toOptionalString(value.outputPreview) }
      : {}),
    ...(toOptionalString(value.outputFingerprintSummary)
      ? {
          outputFingerprintSummary: toOptionalString(
            value.outputFingerprintSummary,
          ),
        }
      : {}),
    isTruncated: value.isTruncated === true,
    includedInFinalOutputs,
    latestPartialOutputObserved: value.latestPartialOutputObserved === true,
    producedHostEffect,
    projectionKind: toProjectionKind(
      value.projectionKind,
      inferProjectionKind({
        runDisposition,
        includedInFinalOutputs,
        outputObserved,
        producedHostEffect,
      }),
    ),
  };
}

function deriveSummaryFromNodes(
  nodes: readonly GraphOutputExplainNodeRecordV1[],
): GraphOutputExplainSummaryV1 {
  return nodes.reduce<GraphOutputExplainSummaryV1>(
    (summary, node) => {
      if (node.outputObserved) {
        summary.observedOutputNodeCount += 1;
      }
      if (node.latestPartialOutputObserved) {
        summary.latestPartialOutputNodeCount += 1;
      }
      if (node.projectionKind === "final_output") {
        summary.finalOutputNodeCount += 1;
      }
      if (node.projectionKind === "intermediate_output") {
        summary.intermediateOutputNodeCount += 1;
      }
      if (node.producedHostEffect) {
        summary.hostEffectNodeCount += 1;
      }
      if (node.projectionKind === "host_effect_only") {
        summary.hostEffectOnlyNodeCount += 1;
      }
      if (node.projectionKind === "no_observed_output") {
        summary.noObservedOutputNodeCount += 1;
      }
      if (node.projectionKind === "not_reached") {
        summary.notReachedNodeCount += 1;
      }
      if (node.projectionKind === "failed") {
        summary.failedNodeCount += 1;
      }
      return summary;
    },
    {
      observedOutputNodeCount: 0,
      latestPartialOutputNodeCount: 0,
      finalOutputNodeCount: 0,
      intermediateOutputNodeCount: 0,
      hostEffectNodeCount: 0,
      hostEffectOnlyNodeCount: 0,
      noObservedOutputNodeCount: 0,
      notReachedNodeCount: 0,
      failedNodeCount: 0,
    },
  );
}

function normalizeSummary(
  value: unknown,
  nodes: readonly GraphOutputExplainNodeRecordV1[],
): GraphOutputExplainSummaryV1 {
  const derived = deriveSummaryFromNodes(nodes);
  if (!isRecord(value)) {
    return derived;
  }

  return {
    observedOutputNodeCount: toNonNegativeInt(
      value.observedOutputNodeCount,
      derived.observedOutputNodeCount,
    ),
    latestPartialOutputNodeCount: toNonNegativeInt(
      value.latestPartialOutputNodeCount,
      derived.latestPartialOutputNodeCount,
    ),
    finalOutputNodeCount: toNonNegativeInt(
      value.finalOutputNodeCount,
      derived.finalOutputNodeCount,
    ),
    intermediateOutputNodeCount: toNonNegativeInt(
      value.intermediateOutputNodeCount,
      derived.intermediateOutputNodeCount,
    ),
    hostEffectNodeCount: toNonNegativeInt(
      value.hostEffectNodeCount,
      derived.hostEffectNodeCount,
    ),
    hostEffectOnlyNodeCount: toNonNegativeInt(
      value.hostEffectOnlyNodeCount,
      derived.hostEffectOnlyNodeCount,
    ),
    noObservedOutputNodeCount: toNonNegativeInt(
      value.noObservedOutputNodeCount,
      derived.noObservedOutputNodeCount,
    ),
    notReachedNodeCount: toNonNegativeInt(
      value.notReachedNodeCount,
      derived.notReachedNodeCount,
    ),
    failedNodeCount: toNonNegativeInt(
      value.failedNodeCount,
      derived.failedNodeCount,
    ),
  };
}

function normalizeArtifact(
  value: unknown,
): GraphOutputExplainArtifactV1 | null {
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
        .filter((node): node is GraphOutputExplainNodeRecordV1 => node !== null)
        .sort((left, right) => left.compileOrder - right.compileOrder)
    : [];

  const summary = normalizeSummary(value.summary, nodes);
  const finalOutputNodeIds = toOptionalStringArray(value.finalOutputNodeIds);
  const intermediateOutputNodeIds = toOptionalStringArray(
    value.intermediateOutputNodeIds,
  );
  const hostEffectNodeIds = toOptionalStringArray(value.hostEffectNodeIds);

  return {
    graphId,
    runId,
    compileFingerprint,
    fingerprintVersion: 1,
    nodeCount:
      value.nodeCount === undefined
        ? nodes.length
        : toNonNegativeInt(value.nodeCount, nodes.length),
    observedOutputNodeCount:
      value.observedOutputNodeCount === undefined
        ? summary.observedOutputNodeCount
        : toNonNegativeInt(
            value.observedOutputNodeCount,
            summary.observedOutputNodeCount,
          ),
    summary,
    finalOutputNodeIds:
      finalOutputNodeIds.length > 0
        ? finalOutputNodeIds
        : nodes
            .filter((node) => node.projectionKind === "final_output")
            .map((node) => node.nodeId),
    intermediateOutputNodeIds:
      intermediateOutputNodeIds.length > 0
        ? intermediateOutputNodeIds
        : nodes
            .filter((node) => node.projectionKind === "intermediate_output")
            .map((node) => node.nodeId),
    hostEffectNodeIds:
      hostEffectNodeIds.length > 0
        ? hostEffectNodeIds
        : nodes
            .filter((node) => node.producedHostEffect)
            .map((node) => node.nodeId),
    nodes,
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

function toFinalOutputNodeIdSet(
  linkage?: GraphCompileRunLinkArtifactV1 | null,
): Set<string> {
  return new Set(
    (linkage?.nodes ?? [])
      .filter((node) => node.includedInFinalOutputs)
      .map((node) => node.nodeId),
  );
}

function createNodeRecord(params: {
  planNode: GraphCompilePlan["nodes"][number];
  linkageNode?: GraphCompileRunLinkArtifactV1["nodes"][number];
  moduleResult?: ModuleExecutionResult;
  latestPartialOutput?: GraphRunArtifact["latestPartialOutput"];
}): GraphOutputExplainNodeRecordV1 {
  const { planNode, linkageNode, moduleResult, latestPartialOutput } = params;
  const includedInFinalOutputs = linkageNode?.includedInFinalOutputs === true;
  const producedHostEffect = linkageNode?.producedHostEffect === true;
  const observedOutputValue = selectObservedOutputValue(
    moduleResult,
    includedInFinalOutputs,
  );
  const valueSummary = summarizeOutputValue(observedOutputValue);
  const latestPartialOutputObserved =
    latestPartialOutput?.nodeId === planNode.nodeId ||
    latestPartialOutput?.moduleId === planNode.moduleId;

  return {
    nodeId: planNode.nodeId,
    moduleId: planNode.moduleId,
    nodeFingerprint: planNode.nodeFingerprint,
    compileOrder: planNode.order,
    runDisposition: linkageNode?.runDisposition ?? "not_reached",
    isTerminal: planNode.isTerminal,
    isSideEffect: planNode.isSideEffectNode,
    outputObserved: valueSummary.outputObserved,
    ...(valueSummary.outputValueType
      ? { outputValueType: valueSummary.outputValueType }
      : {}),
    ...(valueSummary.outputPreview
      ? { outputPreview: valueSummary.outputPreview }
      : {}),
    ...(valueSummary.outputFingerprintSummary
      ? { outputFingerprintSummary: valueSummary.outputFingerprintSummary }
      : {}),
    isTruncated: valueSummary.isTruncated,
    includedInFinalOutputs,
    latestPartialOutputObserved,
    producedHostEffect,
    projectionKind: inferProjectionKind({
      runDisposition: linkageNode?.runDisposition ?? "not_reached",
      includedInFinalOutputs,
      outputObserved: valueSummary.outputObserved,
      producedHostEffect,
    }),
  };
}

export function createGraphOutputExplainArtifactEnvelope(params: {
  plan?: GraphCompilePlan | null;
  runArtifact?: GraphRunArtifact | null;
  result?: Pick<GraphExecutionResult, "moduleResults"> | null;
  compileRunLinkArtifact?: GraphCompileRunLinkArtifactV1 | null;
}): GraphOutputExplainArtifactEnvelope | null {
  const plan = params.plan;
  const runArtifact = params.runArtifact;
  const compileRunLinkArtifact = params.compileRunLinkArtifact;
  const graphId =
    plan?.fingerprintSource?.graphId ??
    compileRunLinkArtifact?.graphId ??
    runArtifact?.graphId;
  const runId = runArtifact?.runId ?? compileRunLinkArtifact?.runId;
  const compileFingerprint =
    plan?.compileFingerprint ??
    compileRunLinkArtifact?.compileFingerprint ??
    runArtifact?.compileFingerprint;

  if (!plan || !graphId || !runId || !compileFingerprint) {
    return null;
  }

  const moduleResultByNodeId = toModuleResultMap(params.result);
  const linkageNodeByNodeId = new Map(
    (compileRunLinkArtifact?.nodes ?? []).map((node) => [node.nodeId, node]),
  );

  const nodes = plan.nodes.map((planNode) =>
    createNodeRecord({
      planNode,
      linkageNode: linkageNodeByNodeId.get(planNode.nodeId),
      moduleResult: moduleResultByNodeId.get(planNode.nodeId),
      latestPartialOutput: runArtifact?.latestPartialOutput,
    }),
  );

  const finalOutputNodeIds = Array.from(
    toFinalOutputNodeIdSet(compileRunLinkArtifact),
  );
  const intermediateOutputNodeIds = nodes
    .filter((node) => node.projectionKind === "intermediate_output")
    .map((node) => node.nodeId);
  const hostEffectNodeIds = nodes
    .filter((node) => node.producedHostEffect)
    .map((node) => node.nodeId);

  const artifact = normalizeArtifact({
    graphId,
    runId,
    compileFingerprint,
    fingerprintVersion: 1,
    nodeCount: plan.fingerprintSource?.nodeCount ?? plan.nodes.length,
    observedOutputNodeCount: nodes.filter((node) => node.outputObserved).length,
    summary: deriveSummaryFromNodes(nodes),
    finalOutputNodeIds,
    intermediateOutputNodeIds,
    hostEffectNodeIds,
    nodes,
  });

  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_output_explain_artifact",
    version: "v1",
    artifact,
  };
}

function toEnvelopeFromLegacyRecord(
  value: Record<string, unknown>,
): GraphOutputExplainArtifactEnvelope | null {
  const artifact = normalizeArtifact(value.graph_output_explain_artifact);
  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_output_explain_artifact",
    version: "v1",
    artifact,
  };
}

export function readGraphOutputExplainArtifactEnvelope(
  value: unknown,
): GraphOutputExplainArtifactEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.kind === "graph_output_explain_artifact" &&
    value.version === "v1"
  ) {
    const artifact = normalizeArtifact(value.artifact);
    return artifact
      ? {
          kind: "graph_output_explain_artifact",
          version: "v1",
          artifact,
        }
      : null;
  }

  const directArtifact = normalizeArtifact(value);
  if (directArtifact) {
    return {
      kind: "graph_output_explain_artifact",
      version: "v1",
      artifact: directArtifact,
    };
  }

  if (isRecord(value.bridge)) {
    return readGraphOutputExplainArtifactEnvelope(value.bridge);
  }

  if (isRecord(value.graph_output_explain_artifact)) {
    return readGraphOutputExplainArtifactEnvelope(
      value.graph_output_explain_artifact,
    );
  }

  if ("graph_output_explain_artifact" in value) {
    return toEnvelopeFromLegacyRecord(value);
  }

  return null;
}
