/* ═══ Graph Document Codec — Stable Compatibility Layer ═══ */
/*
 * Provides versioned envelope read/write for graph documents (graph definitions),
 * mirroring the pattern established in graph-run-artifact-codec.ts for runtime snapshots.
 *
 * Responsibilities:
 *  - Define GraphDocumentV1 / GraphDocumentEnvelope as the stable serialization contract
 *  - Provide createGraphDocumentEnvelope() for normalized write
 *  - Provide readGraphDocumentEnvelope() for tolerant read with legacy flow absorption
 *  - Conservative degradation: missing fields get safe defaults, unknown modules are preserved
 *  - Legacy flow payloads are absorbed through the internal migrateFlowToGraph adapter
 */

import type {
  WorkbenchEdge,
  WorkbenchGraph,
  WorkbenchNode,
  WorkbenchViewport,
} from "../ui/components/graph/module-types";
import { resolveModuleConfigWithDefaults } from "../ui/components/graph/module-registry";
import { migrateFlowToGraph } from "./flow-migrator";
import { EwFlowConfigSchema } from "./types";

// ── Stable V1 Record Types ──

export interface GraphDocumentNodeV1 {
  id: string;
  moduleId: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
  collapsed: boolean;
  runtimeMeta?: Record<string, unknown>;
}

export interface GraphDocumentEdgeV1 {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
  runtimeMeta?: Record<string, unknown>;
}

export interface GraphDocumentViewportV1 {
  x: number;
  y: number;
  zoom: number;
}

export interface GraphDocumentV1 {
  id: string;
  name: string;
  enabled: boolean;
  timing: "default" | "before_reply" | "after_reply";
  priority: number;
  nodes: GraphDocumentNodeV1[];
  edges: GraphDocumentEdgeV1[];
  viewport: GraphDocumentViewportV1;
  runtimeMeta?: Record<string, unknown>;
}

export interface GraphDocumentEnvelope {
  kind: "graph_document";
  version: "v1";
  graphs: GraphDocumentV1[];
  metadata?: {
    createdAt?: number;
    source?: string;
    legacyFlowCount?: number;
  };
}

// ── Helpers ──

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toNonNegativeInt(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return numeric >= 0 ? Math.trunc(numeric) : 0;
}

function toRequiredString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

const TIMING_VALUES = ["default", "before_reply", "after_reply"] as const;
type TimingValue = (typeof TIMING_VALUES)[number];

function toTiming(value: unknown): TimingValue {
  if (
    typeof value === "string" &&
    TIMING_VALUES.includes(value as TimingValue)
  ) {
    return value as TimingValue;
  }
  return "default";
}

// ── Node Normalization ──

function normalizeNodeV1(value: unknown): GraphDocumentNodeV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = toRequiredString(value.id);
  const moduleId = toRequiredString(value.moduleId);
  if (!id || !moduleId) {
    return null;
  }

  const positionRecord = isRecord(value.position) ? value.position : {};
  const position = {
    x: toFiniteNumber(positionRecord.x, 0),
    y: toFiniteNumber(positionRecord.y, 0),
  };

  const config = isRecord(value.config)
    ? (value.config as Record<string, unknown>)
    : {};

  const node: GraphDocumentNodeV1 = {
    id,
    moduleId,
    position,
    config: resolveModuleConfigWithDefaults(
      moduleId,
      config as Record<string, any>,
    ),
    collapsed: toBoolean(value.collapsed, false),
  };

  if (isRecord(value.runtimeMeta)) {
    node.runtimeMeta = { ...(value.runtimeMeta as Record<string, unknown>) };
  }

  return node;
}

// ── Edge Normalization ──

function normalizeEdgeV1(value: unknown): GraphDocumentEdgeV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = toRequiredString(value.id);
  const source = toRequiredString(value.source);
  const sourcePort = toRequiredString(value.sourcePort);
  const target = toRequiredString(value.target);
  const targetPort = toRequiredString(value.targetPort);

  if (!id || !source || !sourcePort || !target || !targetPort) {
    return null;
  }

  const edge: GraphDocumentEdgeV1 = {
    id,
    source,
    sourcePort,
    target,
    targetPort,
  };

  if (isRecord(value.runtimeMeta)) {
    edge.runtimeMeta = { ...(value.runtimeMeta as Record<string, unknown>) };
  }

  return edge;
}

// ── Viewport Normalization ──

function normalizeViewportV1(value: unknown): GraphDocumentViewportV1 {
  if (!isRecord(value)) {
    return { x: 0, y: 0, zoom: 1 };
  }

  const zoom = toFiniteNumber(value.zoom, 1);
  return {
    x: toFiniteNumber(value.x, 0),
    y: toFiniteNumber(value.y, 0),
    zoom: zoom > 0 ? zoom : 1,
  };
}

// ── Graph Document Normalization ──

function normalizeGraphDocumentV1(value: unknown): GraphDocumentV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = toRequiredString(value.id);
  if (!id) {
    return null;
  }

  const nodes = Array.isArray(value.nodes)
    ? value.nodes
        .map(normalizeNodeV1)
        .filter((node): node is GraphDocumentNodeV1 => node !== null)
    : [];
  const nodeIds = new Set(nodes.map((node) => node.id));

  const edges = Array.isArray(value.edges)
    ? value.edges
        .map(normalizeEdgeV1)
        .filter(
          (edge): edge is GraphDocumentEdgeV1 =>
            edge !== null &&
            nodeIds.has(edge.source) &&
            nodeIds.has(edge.target),
        )
    : [];

  const graph: GraphDocumentV1 = {
    id,
    name: toRequiredString(value.name, ""),
    enabled: toBoolean(value.enabled, true),
    timing: toTiming(value.timing),
    priority: toFiniteNumber(value.priority, 0),
    nodes,
    edges,
    viewport: normalizeViewportV1(value.viewport),
  };

  if (isRecord(value.runtimeMeta)) {
    graph.runtimeMeta = { ...(value.runtimeMeta as Record<string, unknown>) };
  }

  return graph;
}

// ── Create Envelope (Write Path) ──

/**
 * Create a stable GraphDocumentEnvelope from WorkbenchGraph[].
 * This is the canonical write path for graph document serialization.
 */
export function createGraphDocumentEnvelope(params: {
  graphs: WorkbenchGraph[];
  source?: string;
}): GraphDocumentEnvelope {
  const graphs: GraphDocumentV1[] = params.graphs
    .map((graph) => normalizeGraphDocumentV1(graph))
    .filter((graph): graph is GraphDocumentV1 => graph !== null);

  return {
    kind: "graph_document",
    version: "v1",
    graphs,
    metadata: {
      createdAt: Date.now(),
      ...(params.source ? { source: params.source } : {}),
    },
  };
}

// ── Read Envelope (Read Path) ──

/**
 * Read a GraphDocumentEnvelope from unknown input with conservative degradation.
 *
 * Handles:
 *  1. Native envelope format (`kind: "graph_document"`, `version: "v1"`)
 *  2. Raw WorkbenchGraph[] arrays
 *  3. Legacy flow export format (`ew_flow_export: true`)
 *  4. Single legacy flow objects
 *  5. Settings-level `workbench_graphs` extraction
 *
 * Unknown modules are preserved. Missing fields get safe defaults.
 * Returns null only if the input cannot be interpreted as any known format.
 */
export function readGraphDocumentEnvelope(
  value: unknown,
): GraphDocumentEnvelope | null {
  if (!value) {
    return null;
  }

  // 1. Native envelope
  if (
    isRecord(value) &&
    value.kind === "graph_document" &&
    value.version === "v1"
  ) {
    const rawGraphs = Array.isArray(value.graphs) ? value.graphs : [];
    const graphs = rawGraphs
      .map(normalizeGraphDocumentV1)
      .filter((graph): graph is GraphDocumentV1 => graph !== null);

    const metadataRecord = isRecord(value.metadata) ? value.metadata : {};
    return {
      kind: "graph_document",
      version: "v1",
      graphs,
      metadata: {
        createdAt: toNonNegativeInt(metadataRecord.createdAt),
        ...(typeof metadataRecord.source === "string"
          ? { source: metadataRecord.source }
          : {}),
        ...(typeof metadataRecord.legacyFlowCount === "number"
          ? { legacyFlowCount: metadataRecord.legacyFlowCount }
          : {}),
      },
    };
  }

  // 2. Raw array of graph-like objects
  if (Array.isArray(value)) {
    const graphs = value
      .map(normalizeGraphDocumentV1)
      .filter((graph): graph is GraphDocumentV1 => graph !== null);
    if (graphs.length > 0) {
      return {
        kind: "graph_document",
        version: "v1",
        graphs,
        metadata: { createdAt: Date.now(), source: "raw_array" },
      };
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  // 3. Legacy flow export format
  if (value.ew_flow_export === true && Array.isArray(value.flows)) {
    return readLegacyFlowExport(value.flows);
  }

  // 4. Settings-level extraction (workbench_graphs field)
  if (Array.isArray(value.workbench_graphs)) {
    const graphs = value.workbench_graphs
      .map(normalizeGraphDocumentV1)
      .filter((graph): graph is GraphDocumentV1 => graph !== null);
    if (graphs.length > 0) {
      return {
        kind: "graph_document",
        version: "v1",
        graphs,
        metadata: { createdAt: Date.now(), source: "settings_extraction" },
      };
    }
  }

  // 5. Single graph-like object (has id + nodes)
  if (typeof value.id === "string" && Array.isArray(value.nodes)) {
    const graph = normalizeGraphDocumentV1(value);
    if (graph) {
      return {
        kind: "graph_document",
        version: "v1",
        graphs: [graph],
        metadata: { createdAt: Date.now(), source: "single_graph" },
      };
    }
  }

  // 6. Single legacy flow object (has EwFlowConfig shape)
  if (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (Array.isArray(value.prompt_items) || Array.isArray(value.prompt_order))
  ) {
    return readLegacyFlowExport([value]);
  }

  return null;
}

// ── Legacy Flow Absorption ──

function readLegacyFlowExport(
  rawFlows: unknown[],
): GraphDocumentEnvelope | null {
  const migratedGraphs: GraphDocumentV1[] = [];

  for (const rawFlow of rawFlows) {
    try {
      const parsed = EwFlowConfigSchema.parse(rawFlow);
      const migrated = migrateFlowToGraph(parsed);
      const normalized = normalizeGraphDocumentV1(migrated);
      if (normalized) {
        migratedGraphs.push(normalized);
      }
    } catch {
      // Skip flows that fail validation — conservative degradation
      continue;
    }
  }

  if (migratedGraphs.length === 0) {
    return null;
  }

  return {
    kind: "graph_document",
    version: "v1",
    graphs: migratedGraphs,
    metadata: {
      createdAt: Date.now(),
      source: "legacy_flow_migration",
      legacyFlowCount: rawFlows.length,
    },
  };
}

// ── Conversion Utilities ──

/**
 * Convert a GraphDocumentV1 back to a WorkbenchGraph for runtime consumption.
 */
export function toWorkbenchGraph(doc: GraphDocumentV1): WorkbenchGraph {
  return {
    id: doc.id,
    name: doc.name,
    enabled: doc.enabled,
    timing: doc.timing,
    priority: doc.priority,
    nodes: doc.nodes.map(
      (node): WorkbenchNode => ({
        id: node.id,
        moduleId: node.moduleId,
        position: { ...node.position },
        config: resolveModuleConfigWithDefaults(
          node.moduleId,
          node.config as Record<string, any>,
        ),
        collapsed: node.collapsed,
        ...(node.runtimeMeta
          ? { runtimeMeta: node.runtimeMeta as WorkbenchNode["runtimeMeta"] }
          : {}),
      }),
    ),
    edges: doc.edges.map(
      (edge): WorkbenchEdge => ({
        id: edge.id,
        source: edge.source,
        sourcePort: edge.sourcePort,
        target: edge.target,
        targetPort: edge.targetPort,
        ...(edge.runtimeMeta
          ? { runtimeMeta: edge.runtimeMeta as WorkbenchEdge["runtimeMeta"] }
          : {}),
      }),
    ),
    viewport: { ...doc.viewport } as WorkbenchViewport,
    ...(doc.runtimeMeta
      ? { runtimeMeta: doc.runtimeMeta as WorkbenchGraph["runtimeMeta"] }
      : {}),
  };
}

/**
 * Convert a full envelope back to WorkbenchGraph[] for runtime consumption.
 */
export function toWorkbenchGraphs(
  envelope: GraphDocumentEnvelope,
): WorkbenchGraph[] {
  return envelope.graphs.map(toWorkbenchGraph);
}

/**
 * Build a normalized graph document export payload (replaces buildFlowExportPayload for graph path).
 * Strips sensitive fields from node configs if present.
 */
export function buildGraphDocumentExportPayload(
  graphs: WorkbenchGraph[],
): GraphDocumentEnvelope {
  const cleanedGraphs = graphs.map((graph) => ({
    ...graph,
    nodes: graph.nodes.map((node) => {
      const config = { ...node.config };
      // Strip known sensitive fields from config payloads
      delete config.api_key;
      delete config.api_url;
      delete config.headers_json;
      return { ...node, config };
    }),
  }));

  const envelope = createGraphDocumentEnvelope({
    graphs: cleanedGraphs,
    source: "export",
  });

  return {
    ...envelope,
    graphs: envelope.graphs.map((graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) => {
        const config = { ...node.config };
        delete config.api_key;
        delete config.api_url;
        delete config.headers_json;
        return { ...node, config };
      }),
    })),
  };
}

/**
 * Unified graph document read path: accepts any known format and returns
 * normalized WorkbenchGraph[]. This is the single entry point that should
 * be used by store / import / persist code paths.
 *
 * Legacy flows are absorbed through migrateFlowToGraph internally.
 */
export function readGraphDocumentAsWorkbenchGraphs(
  value: unknown,
): WorkbenchGraph[] | null {
  const envelope = readGraphDocumentEnvelope(value);
  if (!envelope || envelope.graphs.length === 0) {
    return null;
  }
  return toWorkbenchGraphs(envelope);
}
