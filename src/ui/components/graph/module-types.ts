/* ═══ Module Workbench — Type Definitions ═══ */

// ── Module System Core Types ──

/** Category of a module */
export type ModuleCategory =
  | "source" // 数据源
  | "filter" // 过滤 / 处理
  | "transform" // 渲染 / 转换
  | "compose" // 编排
  | "execute" // 执行
  | "output" // 输出
  | "config"; // 配置

/** Data type that flows through ports */
export type PortDataType =
  | "any"
  | "text"
  | "messages" // Array<{ role, content }>
  | "entries" // WI entries array
  | "json" // arbitrary JSON object
  | "api_config" // API preset config
  | "gen_options" // generation parameters
  | "behavior_options"
  | "flow_context" // { chat_id, message_id, trigger }
  | "results" // DispatchFlowResult[]
  | "operations" // worldbook operations
  | "snapshot" // floor binding snapshot
  | "http_response" // raw HTTP response
  | "timing" // before_reply | after_reply
  | "boolean"
  | "number";

/** Definition of a port on a module blueprint */
export interface ModulePortDef {
  id: string;
  label: string;
  direction: "in" | "out";
  dataType: PortDataType;
  /** If true, this port can accept multiple connections */
  multiple?: boolean;
  /** If true, this port is optional (module can execute without it) */
  optional?: boolean;
}

/** Schema for a single config field (used by property panel) */
export interface ConfigFieldSchema {
  key: string;
  label: string;
  type:
    | "text"
    | "number"
    | "boolean"
    | "select"
    | "textarea"
    | "json"
    | "slider";
  options?: string[]; // for select
  min?: number;
  max?: number;
  step?: number; // for slider/number
  description?: string; // tooltip / help text
  placeholder?: string; // input placeholder
}

export type WorkbenchRuntimeKind = "dataflow" | "control" | "hybrid";
export type WorkbenchCapability =
  | "unknown"
  | "pure"
  | "reads_host"
  | "writes_host"
  | "network"
  | "source"
  | "fallback";
/**
 * Backward-compatible alias kept for existing side-effect-oriented call sites.
 * P2.2 introduces the more accurate `capability` terminology while preserving
 * the previous field name where needed.
 */
export type WorkbenchSideEffectLevel = WorkbenchCapability;

export interface RuntimeMigrationMeta {
  from?: string;
  strategy?: "compatible" | "requires_migration" | "legacy_bridge";
  notes?: string;
}

export interface HostWriteDescriptor {
  kind: string;
  targetType: string;
  targetId?: string;
  operation: string;
  path?: string;
  idempotency: "idempotent" | "non_idempotent" | "unknown";
  retryable: boolean;
}

export type HostCommitMode = "immediate";

export interface HostCommitContract {
  kind: HostWriteDescriptor["kind"];
  mode: HostCommitMode;
  targetType: HostWriteDescriptor["targetType"];
  targetId?: HostWriteDescriptor["targetId"];
  operation: HostWriteDescriptor["operation"];
  path?: HostWriteDescriptor["path"];
  supportsRetry: HostWriteDescriptor["retryable"];
}

export interface HostWriteSummary {
  kind: HostWriteDescriptor["kind"];
  targetType: HostWriteDescriptor["targetType"];
  targetId?: HostWriteDescriptor["targetId"];
  operation: HostWriteDescriptor["operation"];
  path?: HostWriteDescriptor["path"];
}

export interface HostCommitSummary {
  kind: HostCommitContract["kind"];
  mode: HostCommitContract["mode"];
  targetType: HostCommitContract["targetType"];
  targetId?: HostCommitContract["targetId"];
  operation: HostCommitContract["operation"];
  path?: HostCommitContract["path"];
}

/** Blueprint definition for a module type (registered in the registry) */
export interface ModuleBlueprint {
  /** Unique module type ID, e.g. 'src_char_fields' */
  moduleId: string;
  /** Display name */
  label: string;
  /** Category for palette grouping */
  category: ModuleCategory;
  /** Color accent */
  color: string;
  /** Emoji icon */
  icon: string;
  /** Short description */
  description: string;
  /** Port definitions */
  ports: ModulePortDef[];
  /** Default config values for this module */
  defaultConfig: Record<string, any>;
  /** Optional schema for config field rendering */
  configSchema?: ConfigFieldSchema[];
  /** If true, this is a composite module (contains sub-graph) */
  isComposite?: boolean;
  /** For composite modules: the pre-wired sub-graph template */
  compositeTemplate?: {
    nodes: WorkbenchNode[];
    edges: WorkbenchEdge[];
  };
  /** Optional runtime contract metadata for forward-compatible execution kernels */
  runtimeMeta?: {
    schemaVersion?: number;
    runtimeKind?: WorkbenchRuntimeKind;
    capability?: WorkbenchCapability;
    sideEffect?: WorkbenchSideEffectLevel;
    migration?: RuntimeMigrationMeta;
    hostTargetHint?: HostWriteSummary;
  };
}

// ── Workbench Instance Types ──

/** A node instance in the workbench graph */
export interface WorkbenchNode {
  id: string;
  /** References a ModuleBlueprint.moduleId */
  moduleId: string;
  position: { x: number; y: number };
  /** Per-instance configuration, merged over blueprint defaults */
  config: Record<string, any>;
  collapsed: boolean;
  /** Optional runtime-facing per-node metadata, kept non-breaking for stored graphs */
  runtimeMeta?: {
    schemaVersion?: number;
    runtimeKind?: WorkbenchRuntimeKind;
    capability?: WorkbenchCapability;
    sideEffect?: WorkbenchSideEffectLevel;
    migration?: RuntimeMigrationMeta;
    disabled?: boolean;
  };
}

/** An edge in the workbench graph */
export interface WorkbenchEdge {
  id: string;
  source: string; // source node ID
  sourcePort: string; // source port ID
  target: string; // target node ID
  targetPort: string; // target port ID
  /** Optional runtime metadata for future scheduling / migration use */
  runtimeMeta?: {
    schemaVersion?: number;
    runtimeKind?: WorkbenchRuntimeKind;
    migration?: RuntimeMigrationMeta;
  };
}

/** Viewport state */
export interface WorkbenchViewport {
  x: number;
  y: number;
  zoom: number;
}

/** A complete workbench graph (replaces one EwFlowConfig) */
export interface WorkbenchGraph {
  id: string;
  name: string;
  enabled: boolean;
  timing: "default" | "before_reply" | "after_reply";
  priority: number;
  nodes: WorkbenchNode[];
  edges: WorkbenchEdge[];
  viewport: WorkbenchViewport;
  /** Optional graph-level runtime contract metadata */
  runtimeMeta?: {
    schemaVersion?: number;
    runtimeKind?: WorkbenchRuntimeKind;
    capability?: WorkbenchCapability;
    sideEffect?: WorkbenchSideEffectLevel;
    migration?: RuntimeMigrationMeta;
  };
}

// ── Execution Types ──

/** The data packet flowing between modules during execution */
export type ModuleOutput = Record<string, any>;

export type GraphExecutionStage = "validate" | "compile" | "execute";
export type GraphTraceStageStatus = "pending" | "ok" | "error" | "skipped";
export type ModuleExecutionStatus = "pending" | "running" | "ok" | "error";

export interface GraphStageTrace {
  stage: GraphExecutionStage;
  status: GraphTraceStageStatus;
  elapsedMs: number;
  error?: string;
}

export interface GraphCompilePlanNode {
  nodeId: string;
  moduleId: string;
  nodeFingerprint: string;
  order: number;
  sequence: number;
  dependsOn: string[];
  isTerminal: boolean;
  capability?: WorkbenchCapability;
  sideEffect?: WorkbenchSideEffectLevel;
  stage?: "compile";
  status?: Extract<GraphTraceStageStatus, "ok" | "error">;
  isSideEffectNode: boolean;
  hostWriteSummary?: HostWriteSummary;
  hostCommitSummary?: HostCommitSummary;
}

export interface GraphCompilePlan {
  compileFingerprint: string;
  fingerprintVersion: 1;
  fingerprintSource?: {
    graphId: string;
    nodeCount: number;
    edgeCount: number;
  };
  nodeOrder: string[];
  terminalNodeIds: string[];
  sideEffectNodeIds: string[];
  nodes: GraphCompilePlanNode[];
  failedStage?: GraphExecutionStage;
  stageTrace?: GraphStageTrace[];
}

export interface GraphNodeTraceError {
  message: string;
  stack?: string;
}

export type GraphNodeDirtyReason =
  | "initial_run"
  | "input_changed"
  | "upstream_dirty"
  | "clean";

export interface GraphNodeInputSource {
  sourceNodeId: string;
  sourcePort: string;
  targetPort: string;
}

export interface GraphDirtySetEntry {
  nodeId: string;
  inputFingerprint: string;
  isDirty: boolean;
  dirtyReason: GraphNodeDirtyReason;
}

export interface GraphDirtySetSummary {
  fingerprintVersion: 1;
  entries: GraphDirtySetEntry[];
  dirtyNodeIds: string[];
}

export interface GraphNodeCacheKeyFacts {
  compileFingerprint: string;
  nodeFingerprint: string;
  inputFingerprint: string;
  scopeKey: string;
  fingerprintVersion: 1;
}

export type GraphNodeReuseReason =
  | "eligible"
  | "ineligible_dirty"
  | "ineligible_side_effect"
  | "ineligible_capability"
  | "ineligible_missing_baseline";

export interface GraphNodeReuseVerdict {
  canReuse: boolean;
  reason: GraphNodeReuseReason;
  baselineInputFingerprint?: string;
  currentInputFingerprint?: string;
}

export interface GraphReuseSummary {
  fingerprintVersion: 1;
  eligibleNodeIds: string[];
  ineligibleNodeIds: string[];
  verdictCounts: Record<GraphNodeReuseReason, number>;
}

export interface GraphNodeTrace {
  nodeId: string;
  moduleId: string;
  nodeFingerprint: string;
  inputFingerprint?: string;
  inputSources?: GraphNodeInputSource[];
  isDirty?: boolean;
  dirtyReason?: GraphNodeDirtyReason;
  cacheKeyFacts?: GraphNodeCacheKeyFacts;
  reuseVerdict?: GraphNodeReuseVerdict;
  stage?: GraphExecutionStage;
  status?: ModuleExecutionStatus | GraphTraceStageStatus | "error" | "skipped";
  capability?: WorkbenchCapability;
  sideEffect?: WorkbenchSideEffectLevel;
  isSideEffectNode?: boolean;
  elapsedMs?: number;
  durationMs?: number;
  startedAt?: number;
  completedAt?: number;
  handlerId?: string;
  isFallback?: boolean;
  inputKeys?: string[];
  error?: string | GraphNodeTraceError;
  failedAt?: "dispatch" | "handler";
  outputIncludedInFinalOutputs?: boolean;
  hostWriteSummary?: HostWriteSummary;
  hostCommitSummary?: HostCommitSummary;
  hostWrites?: HostWriteDescriptor[];
  hostCommitContracts?: HostCommitContract[];
}

export interface GraphExecutionTrace {
  currentStage?: GraphExecutionStage;
  failedStage?: GraphExecutionStage;
  failedNodeId?: string;
  stages: GraphStageTrace[];
  nodeTraces?: GraphNodeTrace[];
  compilePlan?: GraphCompilePlan;
  dirtySetSummary?: GraphDirtySetSummary;
  reuseSummary?: GraphReuseSummary;
}

/** Context available to all modules during execution */
export interface ExecutionContext {
  requestId: string;
  chatId: string;
  messageId: number;
  userInput: string;
  trigger?: any;
  settings: any; // EwSettings
  abortSignal?: AbortSignal;
  isCancelled?: () => boolean;
  onProgress?: (update: any) => void;
}

/** Result of executing a single module */
export interface ModuleExecutionResult {
  nodeId: string;
  moduleId: string;
  nodeFingerprint: string;
  inputFingerprint?: string;
  inputSources?: GraphNodeInputSource[];
  isDirty?: boolean;
  dirtyReason?: GraphNodeDirtyReason;
  cacheKeyFacts?: GraphNodeCacheKeyFacts;
  reuseVerdict?: GraphNodeReuseVerdict;
  outputs: Record<string, any>; // keyed by output port ID
  elapsedMs: number;
  error?: string;
  stage?: GraphExecutionStage;
  status?: ModuleExecutionStatus;
  capability?: WorkbenchCapability;
  isSideEffectNode?: boolean;
  hostWriteSummary?: HostWriteSummary;
  hostCommitSummary?: HostCommitSummary;
  hostWrites?: HostWriteDescriptor[];
  hostCommitContracts?: HostCommitContract[];
}

export interface GraphRunState {
  runId: string;
  status: "completed" | "failed";
  failedStage?: GraphExecutionStage;
  startedAt: number;
  completedAt: number;
  elapsedMs: number;
  compileFingerprint?: string;
}

/** Result of executing the entire graph */
export interface GraphExecutionResult {
  ok: boolean;
  reason?: string;
  requestId: string;
  runState: GraphRunState;
  moduleResults: ModuleExecutionResult[];
  finalOutputs: Record<string, any>;
  elapsedMs: number;
  failedStage?: GraphExecutionStage;
  compilePlan?: GraphCompilePlan;
  trace?: GraphExecutionTrace;
  nodeTraces?: GraphNodeTrace[];
  dirtySetSummary?: GraphDirtySetSummary;
  reuseSummary?: GraphReuseSummary;
  hostWrites?: HostWriteDescriptor[];
  hostCommitContracts?: HostCommitContract[];
}

// ── Category Metadata ──

export interface CategoryInfo {
  id: ModuleCategory;
  label: string;
  icon: string;
  color: string;
  order: number;
}

export const MODULE_CATEGORIES: CategoryInfo[] = [
  { id: "source", label: "数据源", icon: "🔌", color: "#f59e0b", order: 0 },
  { id: "filter", label: "过滤处理", icon: "🔍", color: "#3b82f6", order: 1 },
  {
    id: "transform",
    label: "渲染转换",
    icon: "🔮",
    color: "#8b5cf6",
    order: 2,
  },
  { id: "compose", label: "编排组装", icon: "📝", color: "#10b981", order: 3 },
  { id: "execute", label: "执行调用", icon: "🚀", color: "#ef4444", order: 4 },
  { id: "output", label: "输出写入", icon: "📤", color: "#14b8a6", order: 5 },
  { id: "config", label: "配置参数", icon: "⚙", color: "#6366f1", order: 6 },
];

// ── Graph Utilities ──

/**
 * Check whether adding an edge from `source` to `target` would create a cycle.
 * Uses iterative BFS reachability from target → source.
 */
export function wouldCreateCycle(
  edges: WorkbenchEdge[],
  source: string,
  target: string,
): boolean {
  if (source === target) return true;

  // If target can already reach source through existing edges,
  // then adding source → target would close a cycle.
  const visited = new Set<string>();
  const queue = [target];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === source) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const edge of edges) {
      if (edge.source === current && !visited.has(edge.target)) {
        queue.push(edge.target);
      }
    }
  }

  return false;
}
