import type {
  GraphCompilePlan,
  GraphSchedulingExplainArtifactEnvelope,
  GraphSchedulingExplainArtifactV1,
  GraphSchedulingExplainNodeRecordV1,
  GraphSchedulingExplainOrderingReasonV1,
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

function computeReadyLayerByNode(
  nodes: Pick<
    GraphSchedulingExplainNodeRecordV1,
    "nodeId" | "order" | "dependsOn"
  >[],
): Map<string, number> {
  const readyLayerByNode = new Map<string, number>();
  const orderByNode = new Map(nodes.map((node) => [node.nodeId, node.order]));
  const sortedNodes = [...nodes].sort(
    (left, right) => left.order - right.order,
  );

  for (const node of sortedNodes) {
    const validDependsOn = [...node.dependsOn]
      .filter((dependencyId) => orderByNode.has(dependencyId))
      .filter(
        (dependencyId) =>
          (orderByNode.get(dependencyId) ?? Number.POSITIVE_INFINITY) <
          node.order,
      );
    const readyLayer =
      validDependsOn.length > 0
        ? Math.max(
            ...validDependsOn.map(
              (dependencyId) => readyLayerByNode.get(dependencyId) ?? 0,
            ),
          ) + 1
        : 0;
    readyLayerByNode.set(node.nodeId, readyLayer);
  }

  return readyLayerByNode;
}

function buildOrderingReason(params: {
  dependsOn: string[];
  isSource: boolean;
  isTerminal: boolean;
  isSideEffect: boolean;
}): GraphSchedulingExplainOrderingReasonV1 {
  const { dependsOn, isSource, isTerminal, isSideEffect } = params;

  if (isSource) {
    return {
      kind: "source_node",
      dependsOnNodeIds: [],
      detail: "No upstream dependencies were observed in compile order facts.",
    };
  }

  if (isTerminal) {
    return {
      kind: "terminal_projection",
      dependsOnNodeIds: [...dependsOn],
      detail:
        "Node remains in compile order after its observed dependencies and is also projected as terminal because no outgoing edges were observed.",
    };
  }

  if (isSideEffect) {
    return {
      kind: "side_effect_projection",
      dependsOnNodeIds: [...dependsOn],
      detail:
        "Node remains ordered after its observed dependencies; side-effect identity is a compile-fact projection and does not add new scheduling semantics.",
    };
  }

  return {
    kind:
      dependsOn.length > 0 ? "dependency_constrained" : "topological_tie_break",
    dependsOnNodeIds: [...dependsOn],
    detail:
      dependsOn.length > 0
        ? "Node is ordered after its observed dependency set in the current topological compile order."
        : "Node has no observed dependencies in compile facts and is kept in the current topological order without implying extra control-flow semantics.",
  };
}

function normalizeOrderingReason(
  value: unknown,
  fallbackDependsOn: string[],
  fallbackFlags: {
    isSource: boolean;
    isTerminal: boolean;
    isSideEffect: boolean;
  },
): GraphSchedulingExplainOrderingReasonV1 {
  if (!isRecord(value)) {
    return buildOrderingReason({
      dependsOn: fallbackDependsOn,
      ...fallbackFlags,
    });
  }

  const kind =
    value.kind === "source_node" ||
    value.kind === "dependency_constrained" ||
    value.kind === "terminal_projection" ||
    value.kind === "side_effect_projection" ||
    value.kind === "topological_tie_break"
      ? value.kind
      : buildOrderingReason({
          dependsOn: fallbackDependsOn,
          ...fallbackFlags,
        }).kind;

  return {
    kind,
    dependsOnNodeIds: toOptionalStringArray(value.dependsOnNodeIds),
    detail:
      typeof value.detail === "string" && value.detail.trim()
        ? value.detail
        : buildOrderingReason({
            dependsOn: fallbackDependsOn,
            ...fallbackFlags,
          }).detail,
  };
}

function normalizeNodeRecord(
  value: unknown,
): GraphSchedulingExplainNodeRecordV1 | null {
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
  const dependsOn = toOptionalStringArray(value.dependsOn);
  const isSource = value.isSource === true || dependsOn.length === 0;
  const isTerminal = value.isTerminal === true;
  const isSideEffect = value.isSideEffect === true;

  return {
    nodeId,
    moduleId,
    nodeFingerprint,
    order,
    dependsOn,
    readyLayer: toNonNegativeInt(value.readyLayer),
    isSource,
    isTerminal,
    isSideEffect,
    orderingReason: normalizeOrderingReason(value.orderingReason, dependsOn, {
      isSource,
      isTerminal,
      isSideEffect,
    }),
  };
}

function normalizeArtifact(
  value: unknown,
): GraphSchedulingExplainArtifactV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const graphId = toRequiredString(value.graphId);
  const compileFingerprint = toRequiredString(value.compileFingerprint);
  if (!graphId || !compileFingerprint) {
    return null;
  }

  const nodes = Array.isArray(value.nodes)
    ? value.nodes
        .map((node) => normalizeNodeRecord(node))
        .filter(
          (node): node is GraphSchedulingExplainNodeRecordV1 => node !== null,
        )
    : [];

  const projectedReadyLayerByNode = computeReadyLayerByNode(nodes);
  const normalizedNodes = [...nodes]
    .sort((left, right) => left.order - right.order)
    .map((node) => ({
      ...node,
      readyLayer: projectedReadyLayerByNode.get(node.nodeId) ?? 0,
      isSource: node.dependsOn.length === 0 ? true : node.isSource,
      orderingReason: normalizeOrderingReason(
        node.orderingReason,
        node.dependsOn,
        {
          isSource: node.dependsOn.length === 0 ? true : node.isSource,
          isTerminal: node.isTerminal,
          isSideEffect: node.isSideEffect,
        },
      ),
    }));

  return {
    graphId,
    compileFingerprint,
    fingerprintVersion: 1,
    strategyMode: "topological_order",
    nodeCount:
      value.nodeCount === undefined
        ? normalizedNodes.length
        : toNonNegativeInt(value.nodeCount, normalizedNodes.length),
    nodes: normalizedNodes,
  };
}

export function createGraphSchedulingExplainArtifactEnvelope(params: {
  plan?: GraphCompilePlan | null;
}): GraphSchedulingExplainArtifactEnvelope | null {
  const plan = params.plan;
  if (!plan?.fingerprintSource?.graphId) {
    return null;
  }

  const readyLayerByNode = computeReadyLayerByNode(
    plan.nodes.map((node) => ({
      nodeId: node.nodeId,
      order: node.order,
      dependsOn: [...node.dependsOn],
    })),
  );

  const artifact = normalizeArtifact({
    graphId: plan.fingerprintSource.graphId,
    compileFingerprint: plan.compileFingerprint,
    fingerprintVersion: 1,
    strategyMode: "topological_order",
    nodeCount: plan.fingerprintSource.nodeCount ?? plan.nodes.length,
    nodes: plan.nodes.map((node) => {
      const dependsOn = [...node.dependsOn];
      const isSource = dependsOn.length === 0;
      const isTerminal = node.isTerminal;
      const isSideEffect = node.isSideEffectNode;
      return {
        nodeId: node.nodeId,
        moduleId: node.moduleId,
        nodeFingerprint: node.nodeFingerprint,
        order: node.order,
        dependsOn,
        readyLayer: readyLayerByNode.get(node.nodeId) ?? 0,
        isSource,
        isTerminal,
        isSideEffect,
        orderingReason: buildOrderingReason({
          dependsOn,
          isSource,
          isTerminal,
          isSideEffect,
        }),
      };
    }),
  });

  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_scheduling_explain_artifact",
    version: "v1",
    artifact,
  };
}

function toEnvelopeFromLegacyRecord(
  value: Record<string, unknown>,
): GraphSchedulingExplainArtifactEnvelope | null {
  const artifact = normalizeArtifact(value.graph_scheduling_explain_artifact);
  if (!artifact) {
    return null;
  }

  return {
    kind: "graph_scheduling_explain_artifact",
    version: "v1",
    artifact,
  };
}

export function readGraphSchedulingExplainArtifactEnvelope(
  value: unknown,
): GraphSchedulingExplainArtifactEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.kind === "graph_scheduling_explain_artifact" &&
    value.version === "v1"
  ) {
    const artifact = normalizeArtifact(value.artifact);
    return artifact
      ? {
          kind: "graph_scheduling_explain_artifact",
          version: "v1",
          artifact,
        }
      : null;
  }

  if (isRecord(value.bridge)) {
    return readGraphSchedulingExplainArtifactEnvelope(value.bridge);
  }

  if (isRecord(value.graph_scheduling_explain_artifact)) {
    return readGraphSchedulingExplainArtifactEnvelope(
      value.graph_scheduling_explain_artifact,
    );
  }

  if ("graph_scheduling_explain_artifact" in value) {
    return toEnvelopeFromLegacyRecord(value);
  }

  return null;
}
