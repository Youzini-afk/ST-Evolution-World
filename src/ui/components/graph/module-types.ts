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

export interface ModuleMetadataSemanticSummary {
  runtimeKind?: WorkbenchRuntimeKind;
  capability?: WorkbenchCapability;
  sideEffect?: WorkbenchSideEffectLevel;
  hostWriteHint?: HostWriteSummary;
}

export interface ModuleMetadataSchemaFieldSummary {
  key: string;
  label: string;
  required?: boolean;
  defaultValueHint?: string;
  description?: string;
}

export type ModuleMetadataValidationSeverity = "warning" | "error";
export type ModuleMetadataUnknownKeyPolicy =
  | "allow_with_warning"
  | "allow_with_error";

export interface ModuleMetadataValidationSummary {
  allowedConfigKeys?: readonly string[];
  requiredConfigKeys?: readonly string[];
  unknownConfigSeverity?: ModuleMetadataValidationSeverity;
  requiredConfigSeverity?: ModuleMetadataValidationSeverity;
  unknownKeyPolicy?: ModuleMetadataUnknownKeyPolicy;
  explainHint?: string;
}

export interface ModuleMetadataConfigSummary {
  schemaFieldKeys: readonly string[];
  schemaFieldCount: number;
  hasSchema: boolean;
  schemaFields?: readonly ModuleMetadataSchemaFieldSummary[];
  validation?: ModuleMetadataValidationSummary;
}

export interface ModuleMetadataPortConstraintSummary {
  portId: string;
  direction: "in" | "out";
  summary: string;
}

export interface ModuleMetadataConstraintSummary {
  inputs?: readonly ModuleMetadataPortConstraintSummary[];
  outputs?: readonly ModuleMetadataPortConstraintSummary[];
}

export interface ModuleMetadataHelpSummary {
  summary: string;
  whenToUse?: string;
  caution?: string;
  runtimeUsage?: string;
}

export interface ModuleMetadataUiSummary {
  badge?: string;
  accent?: "neutral" | "info" | "success" | "warning" | "danger";
}

export interface ModuleMetadataDiagnosticsSummary {
  capabilityLabel: string;
  sideEffectLabel: string;
  hostWriteLabel?: string;
}

export interface ModuleExplainContractConfigView {
  requiredConfigKeys: readonly string[];
  allowedConfigKeys: readonly string[];
  unknownKeyPolicy: ModuleMetadataUnknownKeyPolicy;
  schemaFields: readonly ModuleMetadataSchemaFieldSummary[];
}

export interface ModuleExplainContractPortView {
  inputs: readonly ModuleMetadataPortConstraintSummary[];
  outputs: readonly ModuleMetadataPortConstraintSummary[];
}

export interface ModuleExplainContractLabels {
  capability: string;
  sideEffect: string;
  hostWrite?: string;
}

export interface ModuleExplainContract {
  semantic: ModuleMetadataSemanticSummary;
  config: ModuleExplainContractConfigView;
  ports: ModuleExplainContractPortView;
  help?: ModuleMetadataHelpSummary;
  diagnostics: ModuleExplainContractLabels;
}

export interface ModuleMetadataSurface {
  semantic: ModuleMetadataSemanticSummary;
  config?: ModuleMetadataConfigSummary;
  constraints?: ModuleMetadataConstraintSummary;
  help?: ModuleMetadataHelpSummary;
  ui?: ModuleMetadataUiSummary;
  diagnostics?: ModuleMetadataDiagnosticsSummary;
  explain?: ModuleExplainContract;
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
  /** Optional lightweight schema metadata summary kept compatible with configSchema */
  configMetadata?: {
    schemaFields?: ModuleMetadataSchemaFieldSummary[];
  };
  /** If true, this is a composite module (contains sub-graph) */
  isComposite?: boolean;
  /** For composite modules: the pre-wired sub-graph template */
  compositeTemplate?: {
    nodes: WorkbenchNode[];
    edges: WorkbenchEdge[];
  };
  /** Read-only registry metadata surface used by UI / diagnostics summaries */
  metadata?: ModuleMetadataSurface;
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
export type ModuleExecutionStatus =
  | "pending"
  | "running"
  | "ok"
  | "error"
  | "skipped";

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
  cleanNodeIds?: string[];
  totalNodeCount?: number;
  dirtyNodeCount?: number;
  cleanNodeCount?: number;
  reasonCounts?: Record<GraphNodeDirtyReason, number>;
}

export interface GraphRunDiagnosticsDirtyOverview {
  totalNodeCount: number;
  dirtyNodeCount: number;
  cleanNodeCount: number;
  dirtyNodeIds: string[];
  cleanNodeIds: string[];
  reasonCounts: Record<GraphNodeDirtyReason, number>;
}

export interface GraphNodeCacheKeyFacts {
  compileFingerprint: string;
  nodeFingerprint: string;
  inputFingerprint: string;
  scopeKey: string;
  fingerprintVersion: 1;
}

export interface GraphNodeDiagnosticsInputSourceSummary {
  sourceNodeId: string;
  sourcePort: string;
  targetPort: string;
}

export interface GraphNodeDiagnosticsCacheKeySummary {
  compileFingerprint?: string;
  nodeFingerprint?: string;
  inputFingerprint?: string;
  fingerprintVersion?: 1;
}

export interface GraphNodeDiagnosticsView {
  nodeId: string;
  moduleId: string;
  title?: string;
  dirtyReason?: GraphNodeDirtyReason;
  reuseVerdict?: Pick<GraphNodeReuseVerdict, "canReuse" | "reason">;
  executionDecision?: Pick<
    GraphNodeExecutionDecision,
    "shouldExecute" | "shouldSkip" | "reason" | "reusableOutputHit"
  >;
  inputSources: GraphNodeDiagnosticsInputSourceSummary[];
  cacheKey?: GraphNodeDiagnosticsCacheKeySummary;
  reusableOutputsHit: boolean;
  skipReuseOutputsHit: boolean;
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
  eligibleNodeCount?: number;
  ineligibleNodeCount?: number;
  verdictCounts: Record<GraphNodeReuseReason, number>;
}

export type GraphNodeExecutionDecisionReason =
  | "feature_disabled"
  | "ineligible_reuse_verdict"
  | "ineligible_capability"
  | "ineligible_side_effect"
  | "ineligible_source"
  | "ineligible_terminal"
  | "ineligible_fallback"
  | "missing_baseline"
  | "missing_reusable_outputs"
  | "execute"
  | "skip_reuse_outputs";

export interface GraphNodeExecutionDecision {
  shouldExecute: boolean;
  shouldSkip: boolean;
  reason: GraphNodeExecutionDecisionReason;
  reusableOutputHit: boolean;
}

export interface GraphExecutionDecisionSummary {
  featureEnabled: boolean;
  skippedNodeIds: string[];
  executedNodeIds: string[];
  skippedNodeCount?: number;
  executedNodeCount?: number;
  skipReuseOutputNodeIds?: string[];
  decisionCounts: Record<GraphNodeExecutionDecisionReason, number>;
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
  executionDecision?: GraphNodeExecutionDecision;
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
  executionDecisionSummary?: GraphExecutionDecisionSummary;
}

export type GraphRunStatus =
  | "queued"
  | "running"
  | "streaming"
  | "waiting_user"
  | "cancelling"
  | "cancelled"
  | "failed"
  | "completed";

export type GraphRunPhase =
  | "queued"
  | "validating"
  | "compiling"
  | "executing"
  | "blocked"
  | "finishing"
  | "terminal";

export type GraphRunBlockingReasonCategory =
  | "waiting_user"
  | "cancellation"
  | "unknown";

export type GraphRunBlockingReasonCode =
  | "waiting_user"
  | "cancelling"
  | "unknown";

export interface GraphRunBlockingReason {
  category: GraphRunBlockingReasonCategory;
  code: GraphRunBlockingReasonCode;
  label: string;
  detail?: string;
}

export type GraphRunBlockingContractKind =
  | "waiting_user"
  | "cancellation"
  | "unknown";

export type GraphRunBlockingInputRequirementType =
  | "confirmation"
  | "text_input"
  | "selection"
  | "unknown";

export interface GraphRunBlockingInputRequirement {
  required: boolean;
  type: GraphRunBlockingInputRequirementType;
  detail?: string;
}

export type GraphRunRecoveryFactSource =
  | "waiting_user"
  | "checkpoint_candidate"
  | "terminal_state"
  | "status"
  | "unknown";

export type GraphRunRecoveryEvidenceTrust =
  | "strong"
  | "limited"
  | "weak"
  | "unknown";

export interface GraphRunRecoveryEvidenceFact {
  source: GraphRunRecoveryFactSource;
  trust: GraphRunRecoveryEvidenceTrust;
  label: string;
  detail?: string;
}

export interface GraphRunRecoveryPrerequisiteFact {
  source: GraphRunRecoveryFactSource;
  code:
    | "user_input_required"
    | "checkpoint_observed"
    | "run_not_terminal"
    | "terminal_state"
    | "unknown";
  label: string;
  detail?: string;
}

export interface GraphRunBlockingContract {
  kind: GraphRunBlockingContractKind;
  reason: GraphRunBlockingReason;
  requiresHumanInput: boolean;
  inputRequirement: GraphRunBlockingInputRequirement;
  recoveryPrerequisites: GraphRunRecoveryPrerequisiteFact[];
}

export type GraphRunContinuationHandlingPolicyKind =
  | "observe_only"
  | "external_input_observed"
  | "checkpoint_evidence_only"
  | "system_side_not_continuable"
  | "unknown";

export interface GraphRunContinuationHandlingPolicy {
  kind: GraphRunContinuationHandlingPolicyKind;
  label: string;
  detail?: string;
}

export type GraphRunContinuationVerdictStatus =
  | "not_continuable"
  | "blocked_by_external_input"
  | "unknown";

export interface GraphRunContinuationVerdict {
  status: GraphRunContinuationVerdictStatus;
  source: GraphRunRecoveryFactSource;
  label: string;
  detail?: string;
}

export type GraphRunManualInputSlotValueType =
  | "confirmation"
  | "text"
  | "selection"
  | "unknown";

export interface GraphRunManualInputSlotSchema {
  key: string;
  label: string;
  valueType: GraphRunManualInputSlotValueType;
  required: boolean;
  description?: string;
  source: GraphRunRecoveryFactSource;
}

export interface GraphRunContinuationContract {
  handlingPolicy: GraphRunContinuationHandlingPolicy;
  verdict: GraphRunContinuationVerdict;
  recoveryEvidence: GraphRunRecoveryEvidenceFact;
  manualInputSlots: GraphRunManualInputSlotSchema[];
}

export type GraphRunConstraintSourceKind =
  | "observed"
  | "inferred"
  | "host_limited";

export type GraphRunControlPreconditionStatus =
  | "satisfied"
  | "unsatisfied"
  | "unknown";

export type GraphRunControlPreconditionKind =
  | "external_input_observed"
  | "checkpoint_candidate_observed"
  | "run_not_terminal"
  | "continuation_capability_inference"
  | "control_action_surface_inference"
  | "unknown";

export interface GraphRunControlPreconditionItem {
  kind: GraphRunControlPreconditionKind;
  status: GraphRunControlPreconditionStatus;
  label: string;
  detail?: string;
  sourceKind: GraphRunConstraintSourceKind;
  conservativeSourceKind: GraphRunConstraintSourceKind;
}

export type GraphRunNonContinuableReasonKind =
  | "terminal_completed"
  | "terminal_failed"
  | "terminal_cancelled"
  | "continuation_capability_not_inferred"
  | "control_action_surface_not_inferred"
  | "external_input_still_required"
  | "checkpoint_not_observed"
  | "insufficient_evidence"
  | "unknown";

export interface GraphRunControlPreconditionsContract {
  items: GraphRunControlPreconditionItem[];
  nonContinuableReasonKind?: GraphRunNonContinuableReasonKind;
  explanation: string;
}

export interface GraphRunConstraintSummaryViewModel {
  heading: string;
  explanation: string;
  disclaimer: string;
  capabilityBoundary: string;
}

export type GraphRunRecoveryEligibility = "eligible" | "ineligible" | "unknown";

export interface GraphRunRecoveryEligibilityFact {
  status: GraphRunRecoveryEligibility;
  source: GraphRunRecoveryFactSource;
  label: string;
  detail?: string;
}

export type GraphRunTerminalOutcome = "completed" | "failed" | "cancelled";

export type GraphRunEventType =
  | "run_queued"
  | "run_started"
  | "run_completed"
  | "run_failed"
  | "run_cancelled"
  | "stage_started"
  | "stage_finished"
  | "node_started"
  | "node_finished"
  | "node_failed"
  | "node_skipped"
  | "checkpoint_candidate"
  | "heartbeat"
  | "partial_output"
  | "waiting_user";

export interface GraphRunHeartbeatSummary {
  timestamp: number;
  nodeId?: string;
  moduleId?: string;
  nodeIndex?: number;
  message?: string;
}

export interface GraphRunPartialOutputSummary {
  timestamp: number;
  nodeId?: string;
  moduleId?: string;
  nodeIndex?: number;
  preview: string;
  length: number;
}

export interface GraphRunWaitingUserSummary {
  timestamp: number;
  nodeId?: string;
  moduleId?: string;
  nodeIndex?: number;
  reason: string;
}

export interface GraphRunCheckpointSummary {
  checkpointId: string;
  runId: string;
  graphId: string;
  compileFingerprint?: string;
  stage: GraphExecutionStage;
  nodeId?: string;
  nodeIndex?: number;
  resumable: false;
  reason: "stage_boundary" | "node_boundary" | "terminal_candidate";
  createdAt: number;
}

export interface GraphRunArtifact {
  runId: string;
  graphId: string;
  compileFingerprint?: string;
  status: GraphRunStatus;
  phase: GraphRunPhase;
  phaseLabel: string;
  blockingReason?: GraphRunBlockingReason;
  blockingContract?: GraphRunBlockingContract;
  continuationContract?: GraphRunContinuationContract;
  controlPreconditionsContract?: GraphRunControlPreconditionsContract;
  constraintSummary?: GraphRunConstraintSummaryViewModel;
  recoveryEligibility?: GraphRunRecoveryEligibilityFact;
  terminalOutcome?: GraphRunTerminalOutcome;
  currentStage?: GraphExecutionStage;
  failedStage?: GraphExecutionStage;
  latestNodeId?: string;
  latestNodeModuleId?: string;
  latestNodeStatus?: "started" | "finished" | "failed" | "skipped";
  diagnosticsOverview?: GraphRunDiagnosticsOverview;
  errorSummary?: string;
  checkpointCandidate?: GraphRunCheckpointSummary;
  latestHeartbeat?: GraphRunHeartbeatSummary;
  latestPartialOutput?: GraphRunPartialOutputSummary;
  waitingUser?: GraphRunWaitingUserSummary;
  eventCount: number;
  updatedAt: number;
}

export interface GraphRunEvent {
  type: GraphRunEventType;
  runId: string;
  graphId: string;
  status?: GraphRunStatus;
  phase?: GraphRunPhase;
  phaseLabel?: string;
  blockingReason?: GraphRunBlockingReason;
  blockingContract?: GraphRunBlockingContract;
  continuationContract?: GraphRunContinuationContract;
  controlPreconditionsContract?: GraphRunControlPreconditionsContract;
  constraintSummary?: GraphRunConstraintSummaryViewModel;
  recoveryEligibility?: GraphRunRecoveryEligibilityFact;
  terminalOutcome?: GraphRunTerminalOutcome;
  stage?: GraphExecutionStage;
  nodeId?: string;
  moduleId?: string;
  nodeIndex?: number;
  checkpoint?: GraphRunCheckpointSummary;
  artifact?: GraphRunArtifact;
  diagnosticsOverview?: GraphRunDiagnosticsOverview;
  heartbeat?: GraphRunHeartbeatSummary;
  partialOutput?: GraphRunPartialOutputSummary;
  waitingUser?: GraphRunWaitingUserSummary;
  error?: string;
  timestamp: number;
}

export interface GraphRunProgressCompatibleUpdate {
  request_id: string;
  phase: string;
  message?: string;
  graph_id?: string;
  [key: string]: unknown;
}

export type GraphRunProgressUpdate =
  | GraphRunEvent
  | GraphRunProgressCompatibleUpdate;

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
  onProgress?: (update: GraphRunProgressUpdate) => void;
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
  executionDecision?: GraphNodeExecutionDecision;
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
  graphId?: string;
  status: GraphRunStatus;
  phase: GraphRunPhase;
  phaseLabel: string;
  blockingReason?: GraphRunBlockingReason;
  blockingContract?: GraphRunBlockingContract;
  continuationContract?: GraphRunContinuationContract;
  controlPreconditionsContract: GraphRunControlPreconditionsContract;
  constraintSummary: GraphRunConstraintSummaryViewModel;
  recoveryEligibility?: GraphRunRecoveryEligibilityFact;
  terminalOutcome?: GraphRunTerminalOutcome;
  currentStage?: GraphExecutionStage;
  failedStage?: GraphExecutionStage;
  startedAt: number;
  completedAt: number;
  elapsedMs: number;
  compileFingerprint?: string;
}

export interface GraphRunDiagnosticsReuseOverview {
  eligibleNodeCount: number;
  ineligibleNodeCount: number;
  eligibleNodeIds: string[];
  ineligibleNodeIds: string[];
  verdictCounts: Record<GraphNodeReuseReason, number>;
}

export interface GraphRunDiagnosticsExecutionDecisionOverview {
  featureEnabled: boolean;
  skippedNodeCount: number;
  executedNodeCount: number;
  skippedNodeIds: string[];
  executedNodeIds: string[];
  skipReuseOutputNodeIds: string[];
  decisionCounts: Record<GraphNodeExecutionDecisionReason, number>;
}

export interface GraphRunDiagnosticsOverview {
  run: GraphRunState;
  compile: {
    compileFingerprint?: string;
    nodeCount?: number;
    terminalNodeCount?: number;
  };
  dirty: GraphRunDiagnosticsDirtyOverview;
  reuse?: GraphRunDiagnosticsReuseOverview;
  executionDecision?: GraphRunDiagnosticsExecutionDecisionOverview;
  nodeDiagnostics?: GraphNodeDiagnosticsView[];
}

export interface GraphRunDiagnosticsReasonBadge<
  Reason extends string = string,
> {
  reason: Reason;
  label: string;
  count: number;
}

export interface GraphRunDiagnosticsSummaryViewModel {
  runStatus: GraphRunState["status"];
  runStatusLabel: string;
  compileFingerprint?: string;
  compileFingerprintShort: string;
  nodeCount: number;
  terminalNodeCount: number;
  dirtyNodeCount: number;
  cleanNodeCount: number;
  primaryDirtyReasons: GraphRunDiagnosticsReasonBadge<GraphNodeDirtyReason>[];
  reuseEligibleNodeCount: number;
  reuseIneligibleNodeCount: number;
  skipReuseOutputHitCount: number;
  primaryReuseReasons: GraphRunDiagnosticsReasonBadge<GraphNodeReuseReason>[];
  primaryExecutionDecisionReasons: GraphRunDiagnosticsReasonBadge<GraphNodeExecutionDecisionReason>[];
}

export interface GraphNodeDiagnosticsViewModelItem {
  nodeId: string;
  moduleId: string;
  title: string;
  dirtyReasonLabel: string;
  reuseVerdictLabel: string;
  executionDecisionLabel: string;
  inputSourcesSummary: string;
  cacheKeyFactsSummary: string;
  reusableOutputsFactLabel: string;
  skipReuseOutputsFactLabel: string;
}

export interface GraphNodeDiagnosticsViewModel {
  nodeId: string;
  title: string;
  disclaimer: string;
  dirtyReasonLabel: string;
  reuseVerdictLabel: string;
  executionDecisionLabel: string;
  inputSourcesSummary: string;
  cacheKeyFactsSummary: string;
  reusableOutputsFactLabel: string;
  skipReuseOutputsFactLabel: string;
}

export interface GraphCheckpointCandidateViewModel {
  checkpointId: string;
  stage: GraphExecutionStage;
  nodeId?: string;
  nodeIndex?: number;
  resumable: false;
  reason: GraphRunCheckpointSummary["reason"];
  createdAt: number;
}

export interface GraphActiveRunSummaryViewModel {
  runId: string;
  graphId: string;
  hasActiveRun: boolean;
  status: GraphRunStatus;
  statusLabel: string;
  phase: GraphRunPhase;
  phaseLabel: string;
  blockingReason: GraphRunBlockingReason | null;
  blockingReasonLabel: string;
  blockingContract: GraphRunBlockingContract | null;
  hasBlockingContract: boolean;
  blockingCategoryLabel: string;
  requiresHumanInput: boolean;
  requiresHumanInputLabel: string;
  inputRequirementType: GraphRunBlockingInputRequirementType;
  inputRequirementTypeLabel: string;
  continuationContract: GraphRunContinuationContract | null;
  controlPreconditionsContract: GraphRunControlPreconditionsContract | null;
  constraintSummary: GraphRunConstraintSummaryViewModel | null;
  controlPreconditionsLabel: string;
  constraintSummaryLabel: string;
  handlingPolicyLabel: string;
  continuationVerdictLabel: string;
  recoveryEvidenceLabel: string;
  recoveryEvidenceTrustLabel: string;
  recoveryEvidenceSourceLabel: string;
  manualInputSlotCount: number;
  manualInputSlotSchemaLabel: string;
  recoveryEligibility: GraphRunRecoveryEligibilityFact | null;
  recoveryEligibilityLabel: string;
  terminalOutcome: GraphRunTerminalOutcome | null;
  terminalOutcomeLabel: string;
  currentStage?: GraphExecutionStage;
  currentStageLabel: string;
  latestNodeId?: string;
  latestNodeModuleId?: string;
  latestNodeLabel: string;
  latestNodeStatus?: GraphRunArtifact["latestNodeStatus"];
  latestNodeStatusLabel: string;
  eventCount: number;
  updatedAt: number;
  checkpointCandidate: GraphCheckpointCandidateViewModel | null;
  latestHeartbeat: GraphRunHeartbeatSummary | null;
  latestHeartbeatLabel: string;
  latestPartialOutput: GraphRunPartialOutputSummary | null;
  latestPartialOutputLabel: string;
  waitingUser: GraphRunWaitingUserSummary | null;
  waitingUserLabel: string;
  diagnosticsSummary: GraphRunDiagnosticsSummaryViewModel | null;
  nodeDiagnostics: GraphNodeDiagnosticsViewModel | null;
}

/** Result of executing the entire graph */
export interface GraphExecutionResult {
  ok: boolean;
  reason?: string;
  requestId: string;
  runState: GraphRunState;
  runArtifact?: GraphRunArtifact;
  runEvents?: GraphRunEvent[];
  checkpointCandidate?: GraphRunCheckpointSummary;
  moduleResults: ModuleExecutionResult[];
  finalOutputs: Record<string, any>;
  elapsedMs: number;
  failedStage?: GraphExecutionStage;
  compilePlan?: GraphCompilePlan;
  trace?: GraphExecutionTrace;
  nodeTraces?: GraphNodeTrace[];
  dirtySetSummary?: GraphDirtySetSummary;
  reuseSummary?: GraphReuseSummary;
  executionDecisionSummary?: GraphExecutionDecisionSummary;
  diagnosticsOverview?: GraphRunDiagnosticsOverview;
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
