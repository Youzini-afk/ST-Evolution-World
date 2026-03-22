import type {
  GraphExecutionStage,
  GraphNodeDiagnosticsView,
  GraphRunArtifact,
  GraphRunBlockingContract,
  GraphRunBlockingReason,
  GraphRunCheckpointSummary,
  GraphRunConstraintSummaryViewModel,
  GraphRunControlPreconditionsContract,
  GraphRunDiagnosticsOverview,
  GraphRunEvent,
  GraphRunEventType,
  GraphRunHeartbeatSummary,
  GraphRunPartialOutputSummary,
  GraphRunPhase,
  GraphRunRecoveryEligibilityFact,
  GraphRunStatus,
  GraphRunTerminalOutcome,
  GraphRunWaitingUserSummary,
} from "../ui/components/graph/module-types";

export interface GraphRunOverviewRecordV1 {
  runId: string;
  graphId: string;
  compileFingerprint?: string;
  status: GraphRunStatus;
  phase: GraphRunPhase;
  phaseLabel: string;
  blockingReason?: GraphRunBlockingReason;
  blockingContract?: GraphRunBlockingContract;
  continuationContract?: GraphRunArtifact["continuationContract"];
  controlPreconditionsContract?: GraphRunControlPreconditionsContract;
  constraintSummary?: GraphRunConstraintSummaryViewModel;
  recoveryEligibility?: GraphRunRecoveryEligibilityFact;
  terminalOutcome?: GraphRunTerminalOutcome;
  currentStage?: GraphExecutionStage;
  failedStage?: GraphExecutionStage;
  latestNodeId?: string;
  latestNodeModuleId?: string;
  latestNodeStatus?: GraphRunArtifact["latestNodeStatus"];
  diagnosticsOverview?: GraphRunDiagnosticsOverview;
  errorSummary?: string;
  checkpointCandidate?: GraphRunCheckpointSummary;
  latestHeartbeat?: GraphRunHeartbeatSummary;
  latestPartialOutput?: GraphRunPartialOutputSummary;
  waitingUser?: GraphRunWaitingUserSummary;
  eventCount: number;
  updatedAt: number;
}

export interface GraphRunEventRecordV1 {
  type: GraphRunEventType;
  runId: string;
  graphId: string;
  status?: GraphRunStatus;
  phase?: GraphRunPhase;
  phaseLabel?: string;
  blockingReason?: GraphRunBlockingReason;
  blockingContract?: GraphRunBlockingContract;
  continuationContract?: GraphRunArtifact["continuationContract"];
  controlPreconditionsContract?: GraphRunControlPreconditionsContract;
  constraintSummary?: GraphRunConstraintSummaryViewModel;
  recoveryEligibility?: GraphRunRecoveryEligibilityFact;
  terminalOutcome?: GraphRunTerminalOutcome;
  stage?: GraphExecutionStage;
  nodeId?: string;
  moduleId?: string;
  nodeIndex?: number;
  checkpoint?: GraphRunCheckpointSummary;
  diagnosticsOverview?: GraphRunDiagnosticsOverview;
  heartbeat?: GraphRunHeartbeatSummary;
  partialOutput?: GraphRunPartialOutputSummary;
  waitingUser?: GraphRunWaitingUserSummary;
  error?: string;
  timestamp: number;
}

export interface GraphRunSnapshotV1 {
  overview: GraphRunOverviewRecordV1;
  events: GraphRunEventRecordV1[];
  diagnosticsOverview?: GraphRunDiagnosticsOverview;
  nodeDiagnostics?: GraphNodeDiagnosticsView[];
}

export interface GraphRunSnapshotEnvelope {
  kind: "graph_run_snapshot";
  version: "v1";
  snapshot: GraphRunSnapshotV1;
}

const GRAPH_RUN_STATUSES: GraphRunStatus[] = [
  "queued",
  "running",
  "streaming",
  "waiting_user",
  "cancelling",
  "cancelled",
  "failed",
  "completed",
];
const GRAPH_RUN_PHASES: GraphRunPhase[] = [
  "queued",
  "validating",
  "compiling",
  "executing",
  "blocked",
  "finishing",
  "terminal",
];
const GRAPH_RUN_TERMINAL_OUTCOMES: GraphRunTerminalOutcome[] = [
  "completed",
  "failed",
  "cancelled",
];
const GRAPH_RUN_EVENT_TYPES: GraphRunEventType[] = [
  "run_queued",
  "run_started",
  "stage_started",
  "stage_finished",
  "node_started",
  "node_finished",
  "node_failed",
  "node_skipped",
  "checkpoint_candidate",
  "heartbeat",
  "partial_output",
  "waiting_user",
  "run_completed",
  "run_failed",
];
const GRAPH_EXECUTION_STAGES: GraphExecutionStage[] = [
  "validate",
  "compile",
  "execute",
];
const GRAPH_NODE_STATUSES: NonNullable<
  GraphRunOverviewRecordV1["latestNodeStatus"]
>[] = ["started", "finished", "failed", "skipped"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toNonNegativeInt(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0
    ? Math.trunc(numeric)
    : fallback;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toRequiredString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toEnumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : undefined;
}

function toRunStatus(value: unknown, fallback: GraphRunStatus): GraphRunStatus {
  return toEnumValue(value, GRAPH_RUN_STATUSES) ?? fallback;
}

function toRunPhase(value: unknown, fallback: GraphRunPhase): GraphRunPhase {
  return toEnumValue(value, GRAPH_RUN_PHASES) ?? fallback;
}

function toExecutionStage(value: unknown): GraphExecutionStage | undefined {
  return toEnumValue(value, GRAPH_EXECUTION_STAGES);
}

function cloneDiagnosticsOverview(
  value: unknown,
  nodeDiagnostics?: GraphNodeDiagnosticsView[],
): GraphRunDiagnosticsOverview | undefined {
  if (!isRecord(value) || !isRecord(value.run)) {
    return undefined;
  }

  return {
    ...(value as unknown as GraphRunDiagnosticsOverview),
    ...(nodeDiagnostics ? { nodeDiagnostics: [...nodeDiagnostics] } : {}),
  };
}

function cloneCheckpointSummary(
  value: unknown,
): GraphRunCheckpointSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const stage = toExecutionStage(value.stage);
  const reason =
    value.reason === "stage_boundary" ||
    value.reason === "node_boundary" ||
    value.reason === "terminal_candidate"
      ? value.reason
      : "terminal_candidate";

  return {
    checkpointId: toRequiredString(value.checkpointId),
    runId: toRequiredString(value.runId),
    graphId: toRequiredString(value.graphId),
    ...(typeof value.compileFingerprint === "string"
      ? { compileFingerprint: value.compileFingerprint }
      : {}),
    stage: stage ?? "execute",
    ...(typeof value.nodeId === "string" ? { nodeId: value.nodeId } : {}),
    ...(value.nodeIndex !== undefined
      ? { nodeIndex: toNonNegativeInt(value.nodeIndex) }
      : {}),
    resumable: false,
    reason,
    createdAt: toNonNegativeInt(value.createdAt),
  };
}

function cloneHeartbeatSummary(
  value: unknown,
): GraphRunHeartbeatSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    timestamp: toNonNegativeInt(value.timestamp),
    ...(typeof value.nodeId === "string" ? { nodeId: value.nodeId } : {}),
    ...(typeof value.moduleId === "string" ? { moduleId: value.moduleId } : {}),
    ...(value.nodeIndex !== undefined
      ? { nodeIndex: toNonNegativeInt(value.nodeIndex) }
      : {}),
    ...(typeof value.message === "string" ? { message: value.message } : {}),
  };
}

function clonePartialOutputSummary(
  value: unknown,
): GraphRunPartialOutputSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    timestamp: toNonNegativeInt(value.timestamp),
    ...(typeof value.nodeId === "string" ? { nodeId: value.nodeId } : {}),
    ...(typeof value.moduleId === "string" ? { moduleId: value.moduleId } : {}),
    ...(value.nodeIndex !== undefined
      ? { nodeIndex: toNonNegativeInt(value.nodeIndex) }
      : {}),
    preview: toRequiredString(value.preview),
    length: toNonNegativeInt(value.length),
  };
}

function cloneWaitingUserSummary(
  value: unknown,
): GraphRunWaitingUserSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    timestamp: toNonNegativeInt(value.timestamp),
    ...(typeof value.nodeId === "string" ? { nodeId: value.nodeId } : {}),
    ...(typeof value.moduleId === "string" ? { moduleId: value.moduleId } : {}),
    ...(value.nodeIndex !== undefined
      ? { nodeIndex: toNonNegativeInt(value.nodeIndex) }
      : {}),
    reason:
      typeof value.reason === "string" && value.reason.trim().length > 0
        ? value.reason.trim()
        : "waiting_user",
  };
}

export function toGraphRunOverviewRecordV1(
  value: unknown,
): GraphRunOverviewRecordV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const status = toRunStatus(value.status, "completed");
  const phase = toRunPhase(
    value.phase,
    status === "completed" || status === "failed" || status === "cancelled"
      ? "terminal"
      : status === "queued"
        ? "queued"
        : status === "waiting_user" || status === "cancelling"
          ? "blocked"
          : "executing",
  );
  const nodeDiagnostics = Array.isArray(value.diagnosticsOverview)
    ? undefined
    : Array.isArray(
          (value.diagnosticsOverview as GraphRunDiagnosticsOverview | undefined)
            ?.nodeDiagnostics,
        )
      ? [
          ...(((value.diagnosticsOverview as GraphRunDiagnosticsOverview)
            .nodeDiagnostics ?? []) as GraphNodeDiagnosticsView[]),
        ]
      : undefined;

  return {
    runId: toRequiredString(value.runId),
    graphId: toRequiredString(value.graphId),
    ...(typeof value.compileFingerprint === "string"
      ? { compileFingerprint: value.compileFingerprint }
      : {}),
    status,
    phase,
    phaseLabel:
      typeof value.phaseLabel === "string" && value.phaseLabel.trim().length > 0
        ? value.phaseLabel.trim()
        : phase,
    ...(isRecord(value.blockingReason)
      ? {
          blockingReason:
            value.blockingReason as unknown as GraphRunBlockingReason,
        }
      : {}),
    ...(isRecord(value.blockingContract)
      ? {
          blockingContract:
            value.blockingContract as unknown as GraphRunBlockingContract,
        }
      : {}),
    ...(isRecord(value.continuationContract)
      ? {
          continuationContract:
            value.continuationContract as unknown as GraphRunArtifact["continuationContract"],
        }
      : {}),
    ...(isRecord(value.controlPreconditionsContract)
      ? {
          controlPreconditionsContract:
            value.controlPreconditionsContract as unknown as GraphRunControlPreconditionsContract,
        }
      : {}),
    ...(isRecord(value.constraintSummary)
      ? {
          constraintSummary:
            value.constraintSummary as unknown as GraphRunConstraintSummaryViewModel,
        }
      : {}),
    ...(isRecord(value.recoveryEligibility)
      ? {
          recoveryEligibility:
            value.recoveryEligibility as unknown as GraphRunRecoveryEligibilityFact,
        }
      : {}),
    ...(toEnumValue(value.terminalOutcome, GRAPH_RUN_TERMINAL_OUTCOMES)
      ? {
          terminalOutcome: toEnumValue(
            value.terminalOutcome,
            GRAPH_RUN_TERMINAL_OUTCOMES,
          )!,
        }
      : {}),
    ...(toExecutionStage(value.currentStage)
      ? { currentStage: toExecutionStage(value.currentStage) }
      : {}),
    ...(toExecutionStage(value.failedStage)
      ? { failedStage: toExecutionStage(value.failedStage) }
      : {}),
    ...(typeof value.latestNodeId === "string"
      ? { latestNodeId: value.latestNodeId }
      : {}),
    ...(typeof value.latestNodeModuleId === "string"
      ? { latestNodeModuleId: value.latestNodeModuleId }
      : {}),
    ...(toEnumValue(value.latestNodeStatus, GRAPH_NODE_STATUSES)
      ? {
          latestNodeStatus: toEnumValue(
            value.latestNodeStatus,
            GRAPH_NODE_STATUSES,
          ),
        }
      : {}),
    ...(cloneDiagnosticsOverview(value.diagnosticsOverview, nodeDiagnostics)
      ? {
          diagnosticsOverview: cloneDiagnosticsOverview(
            value.diagnosticsOverview,
            nodeDiagnostics,
          ),
        }
      : {}),
    ...(typeof value.errorSummary === "string"
      ? { errorSummary: value.errorSummary }
      : {}),
    ...(cloneCheckpointSummary(value.checkpointCandidate)
      ? {
          checkpointCandidate: cloneCheckpointSummary(
            value.checkpointCandidate,
          ),
        }
      : {}),
    ...(cloneHeartbeatSummary(value.latestHeartbeat)
      ? { latestHeartbeat: cloneHeartbeatSummary(value.latestHeartbeat) }
      : {}),
    ...(clonePartialOutputSummary(value.latestPartialOutput)
      ? {
          latestPartialOutput: clonePartialOutputSummary(
            value.latestPartialOutput,
          ),
        }
      : {}),
    ...(cloneWaitingUserSummary(value.waitingUser)
      ? { waitingUser: cloneWaitingUserSummary(value.waitingUser) }
      : {}),
    eventCount: toNonNegativeInt(value.eventCount),
    updatedAt: toNonNegativeInt(value.updatedAt),
  };
}

export function toGraphRunEventRecordV1(
  value: unknown,
): GraphRunEventRecordV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = toEnumValue(value.type, GRAPH_RUN_EVENT_TYPES);
  if (!type) {
    return null;
  }

  return {
    type,
    runId: toRequiredString(value.runId),
    graphId: toRequiredString(value.graphId),
    ...(toEnumValue(value.status, GRAPH_RUN_STATUSES)
      ? { status: toEnumValue(value.status, GRAPH_RUN_STATUSES) }
      : {}),
    ...(toEnumValue(value.phase, GRAPH_RUN_PHASES)
      ? { phase: toEnumValue(value.phase, GRAPH_RUN_PHASES) }
      : {}),
    ...(typeof value.phaseLabel === "string"
      ? { phaseLabel: value.phaseLabel }
      : {}),
    ...(isRecord(value.blockingReason)
      ? {
          blockingReason:
            value.blockingReason as unknown as GraphRunBlockingReason,
        }
      : {}),
    ...(isRecord(value.blockingContract)
      ? {
          blockingContract:
            value.blockingContract as unknown as GraphRunBlockingContract,
        }
      : {}),
    ...(isRecord(value.continuationContract)
      ? {
          continuationContract:
            value.continuationContract as unknown as GraphRunArtifact["continuationContract"],
        }
      : {}),
    ...(isRecord(value.controlPreconditionsContract)
      ? {
          controlPreconditionsContract:
            value.controlPreconditionsContract as unknown as GraphRunControlPreconditionsContract,
        }
      : {}),
    ...(isRecord(value.constraintSummary)
      ? {
          constraintSummary:
            value.constraintSummary as unknown as GraphRunConstraintSummaryViewModel,
        }
      : {}),
    ...(isRecord(value.recoveryEligibility)
      ? {
          recoveryEligibility:
            value.recoveryEligibility as unknown as GraphRunRecoveryEligibilityFact,
        }
      : {}),
    ...(toEnumValue(value.terminalOutcome, GRAPH_RUN_TERMINAL_OUTCOMES)
      ? {
          terminalOutcome: toEnumValue(
            value.terminalOutcome,
            GRAPH_RUN_TERMINAL_OUTCOMES,
          ),
        }
      : {}),
    ...(toExecutionStage(value.stage)
      ? { stage: toExecutionStage(value.stage) }
      : {}),
    ...(typeof value.nodeId === "string" ? { nodeId: value.nodeId } : {}),
    ...(typeof value.moduleId === "string" ? { moduleId: value.moduleId } : {}),
    ...(value.nodeIndex !== undefined
      ? { nodeIndex: toNonNegativeInt(value.nodeIndex) }
      : {}),
    ...(cloneCheckpointSummary(value.checkpoint)
      ? { checkpoint: cloneCheckpointSummary(value.checkpoint) }
      : {}),
    ...(cloneDiagnosticsOverview(value.diagnosticsOverview)
      ? {
          diagnosticsOverview: cloneDiagnosticsOverview(
            value.diagnosticsOverview,
          ),
        }
      : {}),
    ...(cloneHeartbeatSummary(value.heartbeat)
      ? { heartbeat: cloneHeartbeatSummary(value.heartbeat) }
      : {}),
    ...(clonePartialOutputSummary(value.partialOutput)
      ? { partialOutput: clonePartialOutputSummary(value.partialOutput) }
      : {}),
    ...(cloneWaitingUserSummary(value.waitingUser)
      ? { waitingUser: cloneWaitingUserSummary(value.waitingUser) }
      : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    timestamp: toNonNegativeInt(value.timestamp),
  };
}

function cloneNodeDiagnostics(
  value: unknown,
): GraphNodeDiagnosticsView[] | undefined {
  return Array.isArray(value)
    ? [...(value as GraphNodeDiagnosticsView[])]
    : undefined;
}

export function createGraphRunSnapshotEnvelope(params: {
  overview?: GraphRunArtifact | null;
  events?: GraphRunEvent[] | null;
  diagnosticsOverview?: GraphRunDiagnosticsOverview | null;
}): GraphRunSnapshotEnvelope | null {
  const overview = params.overview
    ? toGraphRunOverviewRecordV1(params.overview)
    : null;
  if (!overview) {
    return null;
  }

  const events = Array.isArray(params.events)
    ? params.events
        .map((event) => toGraphRunEventRecordV1(event))
        .filter((event): event is GraphRunEventRecordV1 => Boolean(event))
    : [];
  const nodeDiagnostics = cloneNodeDiagnostics(
    params.diagnosticsOverview?.nodeDiagnostics ??
      overview.diagnosticsOverview?.nodeDiagnostics,
  );
  const diagnosticsOverview = cloneDiagnosticsOverview(
    params.diagnosticsOverview ?? overview.diagnosticsOverview,
    nodeDiagnostics,
  );

  return {
    kind: "graph_run_snapshot",
    version: "v1",
    snapshot: {
      overview,
      events,
      ...(diagnosticsOverview ? { diagnosticsOverview } : {}),
      ...(nodeDiagnostics ? { nodeDiagnostics } : {}),
    },
  };
}

function toSnapshotFromLegacyRecord(
  value: Record<string, unknown>,
): GraphRunSnapshotEnvelope | null {
  const overview = toGraphRunOverviewRecordV1(value.graph_run_overview);
  if (!overview) {
    return null;
  }

  const events = Array.isArray(value.graph_run_events)
    ? value.graph_run_events
        .map((event) => toGraphRunEventRecordV1(event))
        .filter((event): event is GraphRunEventRecordV1 => Boolean(event))
    : [];
  const nodeDiagnostics = cloneNodeDiagnostics(value.graph_node_diagnostics);
  const diagnosticsOverview = cloneDiagnosticsOverview(
    value.graph_run_diagnostics ?? overview.diagnosticsOverview,
    nodeDiagnostics ?? overview.diagnosticsOverview?.nodeDiagnostics,
  );

  return {
    kind: "graph_run_snapshot",
    version: "v1",
    snapshot: {
      overview: diagnosticsOverview
        ? {
            ...overview,
            diagnosticsOverview,
          }
        : overview,
      events,
      ...(diagnosticsOverview ? { diagnosticsOverview } : {}),
      ...(nodeDiagnostics ? { nodeDiagnostics } : {}),
    },
  };
}

export function readGraphRunSnapshotEnvelope(
  value: unknown,
): GraphRunSnapshotEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.kind === "graph_run_snapshot" && value.version === "v1") {
    const snapshotRecord = isRecord(value.snapshot) ? value.snapshot : null;
    const overview = toGraphRunOverviewRecordV1(snapshotRecord?.overview);
    if (!overview) {
      return null;
    }
    const nodeDiagnostics = cloneNodeDiagnostics(
      snapshotRecord?.nodeDiagnostics,
    );
    const diagnosticsOverview = cloneDiagnosticsOverview(
      snapshotRecord?.diagnosticsOverview ?? overview.diagnosticsOverview,
      nodeDiagnostics ?? overview.diagnosticsOverview?.nodeDiagnostics,
    );
    const events = Array.isArray(snapshotRecord?.events)
      ? snapshotRecord.events
          .map((event) => toGraphRunEventRecordV1(event))
          .filter((event): event is GraphRunEventRecordV1 => Boolean(event))
      : [];

    return {
      kind: "graph_run_snapshot",
      version: "v1",
      snapshot: {
        overview: diagnosticsOverview
          ? {
              ...overview,
              diagnosticsOverview,
            }
          : overview,
        events,
        ...(diagnosticsOverview ? { diagnosticsOverview } : {}),
        ...(nodeDiagnostics ? { nodeDiagnostics } : {}),
      },
    };
  }

  if (isRecord(value.bridge)) {
    return readGraphRunSnapshotEnvelope(value.bridge);
  }

  if (isRecord(value.graph_run_snapshot)) {
    return readGraphRunSnapshotEnvelope(value.graph_run_snapshot);
  }

  if (
    "graph_run_overview" in value ||
    "graph_run_events" in value ||
    "graph_run_diagnostics" in value ||
    "graph_node_diagnostics" in value
  ) {
    return toSnapshotFromLegacyRecord(value);
  }

  return null;
}
