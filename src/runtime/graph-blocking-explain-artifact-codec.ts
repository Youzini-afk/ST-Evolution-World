import type {
  GraphBlockingDispositionV1,
  GraphBlockingExplainArtifactEnvelope,
  GraphBlockingExplainArtifactV1,
  GraphBlockingExplainEvidenceSourceV1,
  GraphBlockingExplainKindV1,
  GraphBlockingExplainObservedCheckpointV1,
  GraphBlockingExplainObservedConstraintSummaryV1,
  GraphBlockingExplainObservedContractV1,
  GraphBlockingExplainObservedPreconditionsV1,
  GraphBlockingExplainObservedReasonV1,
  GraphBlockingExplainObservedRecoveryEligibilityV1,
  GraphBlockingExplainObservedWaitingUserV1,
  GraphBlockingExplainSummaryV1,
  GraphRunArtifact,
} from "../ui/components/graph/module-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toRequiredString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toNonNegativeInt(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return numeric >= 0 ? Math.trunc(numeric) : 0;
}

const BLOCKING_EXPLAIN_EVIDENCE_SOURCES: GraphBlockingExplainEvidenceSourceV1[] =
  [
    "run_status",
    "phase",
    "blocking_reason",
    "blocking_contract",
    "waiting_user",
    "checkpoint_candidate",
    "control_preconditions",
    "constraint_summary",
    "recovery_eligibility",
    "terminal_outcome",
  ];

function toRunStatus(
  value: unknown,
): GraphBlockingExplainSummaryV1["runStatus"] {
  return value === "queued" ||
    value === "running" ||
    value === "streaming" ||
    value === "waiting_user" ||
    value === "cancelling" ||
    value === "cancelled" ||
    value === "failed" ||
    value === "completed"
    ? value
    : "completed";
}

function toRunPhase(value: unknown): GraphBlockingExplainSummaryV1["phase"] {
  return value === "queued" ||
    value === "validating" ||
    value === "compiling" ||
    value === "executing" ||
    value === "blocked" ||
    value === "finishing" ||
    value === "terminal"
    ? value
    : "terminal";
}

function toBlockingDisposition(value: unknown): GraphBlockingDispositionV1 {
  return value === "not_blocked" ||
    value === "waiting_user" ||
    value === "blocked" ||
    value === "terminal" ||
    value === "running" ||
    value === "unknown"
    ? value
    : "unknown";
}

function toBlockingExplainKind(value: unknown): GraphBlockingExplainKindV1 {
  return value === "waiting_for_external_input" ||
    value === "blocked_without_input" ||
    value === "terminal_non_resumable" ||
    value === "non_terminal_running" ||
    value === "unknown"
    ? value
    : "unknown";
}

function toEvidenceSources(
  value: unknown,
): GraphBlockingExplainEvidenceSourceV1[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is GraphBlockingExplainEvidenceSourceV1 =>
          typeof entry === "string" &&
          BLOCKING_EXPLAIN_EVIDENCE_SOURCES.includes(
            entry as GraphBlockingExplainEvidenceSourceV1,
          ),
      )
    : [];
}

function toObservedReason(
  value: unknown,
): GraphBlockingExplainObservedReasonV1 | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const label = toOptionalString(value.label);
  if (!label) {
    return undefined;
  }
  return {
    category:
      value.category === "waiting_user" ||
      value.category === "cancellation" ||
      value.category === "unknown"
        ? value.category
        : "unknown",
    code:
      value.code === "waiting_user" ||
      value.code === "cancelling" ||
      value.code === "unknown"
        ? value.code
        : "unknown",
    label,
    ...(toOptionalString(value.detail)
      ? { detail: toOptionalString(value.detail) }
      : {}),
  };
}

function toObservedContract(
  value: unknown,
): GraphBlockingExplainObservedContractV1 | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    kind:
      value.kind === "waiting_user" ||
      value.kind === "cancellation" ||
      value.kind === "unknown"
        ? value.kind
        : "unknown",
    requiresHumanInput: value.requiresHumanInput === true,
    inputRequirementType:
      value.inputRequirementType === "confirmation" ||
      value.inputRequirementType === "text_input" ||
      value.inputRequirementType === "selection" ||
      value.inputRequirementType === "unknown"
        ? value.inputRequirementType
        : "unknown",
    ...(toOptionalString(value.reasonLabel)
      ? { reasonLabel: toOptionalString(value.reasonLabel) }
      : {}),
  };
}

function toObservedWaitingUser(
  value: unknown,
): GraphBlockingExplainObservedWaitingUserV1 | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    observed: value.observed === true,
    ...(toOptionalString(value.reason)
      ? { reason: toOptionalString(value.reason) }
      : {}),
    ...(toOptionalString(value.nodeId)
      ? { nodeId: toOptionalString(value.nodeId) }
      : {}),
    ...(toOptionalString(value.moduleId)
      ? { moduleId: toOptionalString(value.moduleId) }
      : {}),
    ...(value.nodeIndex !== undefined
      ? { nodeIndex: toNonNegativeInt(value.nodeIndex) }
      : {}),
  };
}

function toObservedCheckpoint(
  value: unknown,
): GraphBlockingExplainObservedCheckpointV1 | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    observed: value.observed === true,
    ...(value.stage === "validate" ||
    value.stage === "compile" ||
    value.stage === "execute"
      ? { stage: value.stage }
      : {}),
    ...(value.reason === "stage_boundary" ||
    value.reason === "node_boundary" ||
    value.reason === "terminal_candidate"
      ? { reason: value.reason }
      : {}),
    ...(toOptionalString(value.nodeId)
      ? { nodeId: toOptionalString(value.nodeId) }
      : {}),
    ...(value.nodeIndex !== undefined
      ? { nodeIndex: toNonNegativeInt(value.nodeIndex) }
      : {}),
  };
}

function toObservedPreconditions(
  value: unknown,
): GraphBlockingExplainObservedPreconditionsV1 | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const items = Array.isArray(value.items)
    ? value.items
        .map((item) => {
          if (!isRecord(item)) {
            return null;
          }
          const label = toOptionalString(item.label) ?? "控制前提未知";
          return {
            kind:
              item.kind === "external_input_observed" ||
              item.kind === "checkpoint_candidate_observed" ||
              item.kind === "run_not_terminal" ||
              item.kind === "continuation_capability_inference" ||
              item.kind === "control_action_surface_inference" ||
              item.kind === "unknown"
                ? item.kind
                : "unknown",
            status:
              item.status === "satisfied" ||
              item.status === "unsatisfied" ||
              item.status === "unknown"
                ? item.status
                : "unknown",
            label,
            ...(toOptionalString(item.detail)
              ? { detail: toOptionalString(item.detail) }
              : {}),
            sourceKind:
              item.sourceKind === "observed" ||
              item.sourceKind === "inferred" ||
              item.sourceKind === "host_limited"
                ? item.sourceKind
                : "inferred",
            conservativeSourceKind:
              item.conservativeSourceKind === "observed" ||
              item.conservativeSourceKind === "inferred" ||
              item.conservativeSourceKind === "host_limited"
                ? item.conservativeSourceKind
                : "inferred",
          };
        })
        .filter(
          (
            item,
          ): item is GraphBlockingExplainObservedPreconditionsV1["items"][number] =>
            Boolean(item),
        )
    : [];

  return {
    explanation:
      toOptionalString(value.explanation) ?? "当前仅提供控制前提的只读解释。",
    ...(value.nonContinuableReasonKind === "terminal_completed" ||
    value.nonContinuableReasonKind === "terminal_failed" ||
    value.nonContinuableReasonKind === "terminal_cancelled" ||
    value.nonContinuableReasonKind === "continuation_capability_not_inferred" ||
    value.nonContinuableReasonKind === "control_action_surface_not_inferred" ||
    value.nonContinuableReasonKind === "external_input_still_required" ||
    value.nonContinuableReasonKind === "checkpoint_not_observed" ||
    value.nonContinuableReasonKind === "insufficient_evidence" ||
    value.nonContinuableReasonKind === "unknown"
      ? { nonContinuableReasonKind: value.nonContinuableReasonKind }
      : {}),
    items,
  };
}

function toObservedConstraintSummary(
  value: unknown,
): GraphBlockingExplainObservedConstraintSummaryV1 | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    heading: toOptionalString(value.heading) ?? "控制前提说明（只读）",
    explanation:
      toOptionalString(value.explanation) ??
      "当前工作台展示的是只读约束解释层。",
    disclaimer: toOptionalString(value.disclaimer) ?? "它不是恢复承诺。",
    capabilityBoundary:
      toOptionalString(value.capabilityBoundary) ??
      "它不表示控制动作能力已经存在。",
  };
}

function toObservedRecoveryEligibility(
  value: unknown,
): GraphBlockingExplainObservedRecoveryEligibilityV1 | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    status:
      value.status === "eligible" ||
      value.status === "ineligible" ||
      value.status === "unknown"
        ? value.status
        : "unknown",
    source:
      value.source === "waiting_user" ||
      value.source === "checkpoint_candidate" ||
      value.source === "terminal_state" ||
      value.source === "status" ||
      value.source === "unknown"
        ? value.source
        : "unknown",
    label: toOptionalString(value.label) ?? "恢复资格未知",
    ...(toOptionalString(value.detail)
      ? { detail: toOptionalString(value.detail) }
      : {}),
  };
}

function inferBlockingDisposition(params: {
  runStatus?: GraphRunArtifact["status"];
  phase?: GraphRunArtifact["phase"];
  waitingUserObserved: boolean;
  terminalOutcome?: GraphRunArtifact["terminalOutcome"];
}): GraphBlockingDispositionV1 {
  if (
    params.terminalOutcome ||
    params.runStatus === "completed" ||
    params.runStatus === "failed" ||
    params.runStatus === "cancelled" ||
    params.phase === "terminal"
  ) {
    return "terminal";
  }
  if (params.runStatus === "waiting_user" || params.waitingUserObserved) {
    return "waiting_user";
  }
  if (params.phase === "blocked" || params.runStatus === "cancelling") {
    return "blocked";
  }
  if (
    params.runStatus === "queued" ||
    params.runStatus === "running" ||
    params.runStatus === "streaming" ||
    params.phase === "queued" ||
    params.phase === "validating" ||
    params.phase === "compiling" ||
    params.phase === "executing" ||
    params.phase === "finishing"
  ) {
    return "running";
  }
  return "unknown";
}

function inferBlockingExplainKind(params: {
  disposition: GraphBlockingDispositionV1;
  isHumanInputRequired: boolean;
}): GraphBlockingExplainKindV1 {
  if (params.disposition === "waiting_user" && params.isHumanInputRequired) {
    return "waiting_for_external_input";
  }
  if (params.disposition === "blocked") {
    return "blocked_without_input";
  }
  if (params.disposition === "terminal") {
    return "terminal_non_resumable";
  }
  if (
    params.disposition === "running" ||
    params.disposition === "not_blocked"
  ) {
    return "non_terminal_running";
  }
  return "unknown";
}

function normalizeArtifact(
  value: unknown,
): GraphBlockingExplainArtifactV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const graphId = toRequiredString(value.graphId);
  const runId = toRequiredString(value.runId);
  if (!graphId || !runId) {
    return null;
  }

  const waitingUser = toObservedWaitingUser(value.waitingUser);
  const blockingContract = toObservedContract(value.blockingContract);
  const terminalOutcome =
    value.summary && isRecord(value.summary)
      ? value.summary.terminalOutcome === "completed" ||
        value.summary.terminalOutcome === "failed" ||
        value.summary.terminalOutcome === "cancelled"
        ? value.summary.terminalOutcome
        : undefined
      : undefined;

  const summaryRecord = isRecord(value.summary) ? value.summary : {};
  const isHumanInputRequired =
    summaryRecord.isHumanInputRequired === true ||
    blockingContract?.requiresHumanInput === true;
  const checkpointObserved =
    summaryRecord.checkpointObserved === true ||
    toObservedCheckpoint(value.checkpoint)?.observed === true;
  const disposition = toBlockingDisposition(summaryRecord.blockingDisposition);

  return {
    graphId,
    runId,
    ...(typeof value.compileFingerprint === "string"
      ? { compileFingerprint: value.compileFingerprint }
      : {}),
    fingerprintVersion: 1,
    summary: {
      runStatus: toRunStatus(summaryRecord.runStatus),
      phase: toRunPhase(summaryRecord.phase),
      blockingDisposition:
        disposition === "unknown"
          ? inferBlockingDisposition({
              runStatus: toRunStatus(summaryRecord.runStatus),
              phase: toRunPhase(summaryRecord.phase),
              waitingUserObserved: waitingUser?.observed === true,
              terminalOutcome,
            })
          : disposition,
      blockingExplainKind:
        toBlockingExplainKind(summaryRecord.blockingExplainKind) === "unknown"
          ? inferBlockingExplainKind({
              disposition:
                disposition === "unknown"
                  ? inferBlockingDisposition({
                      runStatus: toRunStatus(summaryRecord.runStatus),
                      phase: toRunPhase(summaryRecord.phase),
                      waitingUserObserved: waitingUser?.observed === true,
                      terminalOutcome,
                    })
                  : disposition,
              isHumanInputRequired,
            })
          : toBlockingExplainKind(summaryRecord.blockingExplainKind),
      isHumanInputRequired,
      checkpointObserved,
      ...(terminalOutcome ? { terminalOutcome } : {}),
      evidenceSources: toEvidenceSources(summaryRecord.evidenceSources),
    },
    ...(toObservedReason(value.blockingReason)
      ? { blockingReason: toObservedReason(value.blockingReason) }
      : {}),
    ...(blockingContract ? { blockingContract } : {}),
    ...(waitingUser ? { waitingUser } : {}),
    ...(toObservedCheckpoint(value.checkpoint)
      ? { checkpoint: toObservedCheckpoint(value.checkpoint) }
      : {}),
    ...(toObservedPreconditions(value.controlPreconditions)
      ? {
          controlPreconditions: toObservedPreconditions(
            value.controlPreconditions,
          ),
        }
      : {}),
    ...(toObservedConstraintSummary(value.constraintSummary)
      ? {
          constraintSummary: toObservedConstraintSummary(
            value.constraintSummary,
          ),
        }
      : {}),
    ...(toObservedRecoveryEligibility(value.recoveryEligibility)
      ? {
          recoveryEligibility: toObservedRecoveryEligibility(
            value.recoveryEligibility,
          ),
        }
      : {}),
  };
}

function deriveEvidenceSources(
  artifact: GraphBlockingExplainArtifactV1,
): GraphBlockingExplainEvidenceSourceV1[] {
  const sources: GraphBlockingExplainEvidenceSourceV1[] = [
    "run_status",
    "phase",
  ];
  if (artifact.blockingReason) {
    sources.push("blocking_reason");
  }
  if (artifact.blockingContract) {
    sources.push("blocking_contract");
  }
  if (artifact.waitingUser?.observed) {
    sources.push("waiting_user");
  }
  if (artifact.checkpoint?.observed) {
    sources.push("checkpoint_candidate");
  }
  if (artifact.controlPreconditions) {
    sources.push("control_preconditions");
  }
  if (artifact.constraintSummary) {
    sources.push("constraint_summary");
  }
  if (artifact.recoveryEligibility) {
    sources.push("recovery_eligibility");
  }
  if (artifact.summary.terminalOutcome) {
    sources.push("terminal_outcome");
  }
  return sources;
}

export function createGraphBlockingExplainArtifactEnvelope(params: {
  runArtifact?: GraphRunArtifact | null;
}): GraphBlockingExplainArtifactEnvelope | null {
  const runArtifact = params.runArtifact;
  if (!runArtifact?.runId || !runArtifact.graphId) {
    return null;
  }

  const waitingUserObserved = Boolean(runArtifact.waitingUser);
  const checkpointObserved = Boolean(runArtifact.checkpointCandidate);
  const isHumanInputRequired =
    runArtifact.blockingContract?.requiresHumanInput === true ||
    runArtifact.status === "waiting_user" ||
    waitingUserObserved;
  const blockingDisposition = inferBlockingDisposition({
    runStatus: runArtifact.status,
    phase: runArtifact.phase,
    waitingUserObserved,
    terminalOutcome: runArtifact.terminalOutcome,
  });

  const artifact: GraphBlockingExplainArtifactV1 = {
    graphId: runArtifact.graphId,
    runId: runArtifact.runId,
    ...(runArtifact.compileFingerprint
      ? { compileFingerprint: runArtifact.compileFingerprint }
      : {}),
    fingerprintVersion: 1,
    summary: {
      runStatus: runArtifact.status,
      phase: runArtifact.phase,
      blockingDisposition,
      blockingExplainKind: inferBlockingExplainKind({
        disposition: blockingDisposition,
        isHumanInputRequired,
      }),
      isHumanInputRequired,
      checkpointObserved,
      ...(runArtifact.terminalOutcome
        ? { terminalOutcome: runArtifact.terminalOutcome }
        : {}),
      evidenceSources: [],
    },
    ...(runArtifact.blockingReason
      ? {
          blockingReason: {
            category: runArtifact.blockingReason.category,
            code: runArtifact.blockingReason.code,
            label: runArtifact.blockingReason.label,
            ...(toOptionalString(runArtifact.blockingReason.detail)
              ? { detail: toOptionalString(runArtifact.blockingReason.detail) }
              : {}),
          },
        }
      : {}),
    ...(runArtifact.blockingContract
      ? {
          blockingContract: {
            kind: runArtifact.blockingContract.kind,
            requiresHumanInput:
              runArtifact.blockingContract.requiresHumanInput === true,
            inputRequirementType:
              runArtifact.blockingContract.inputRequirement.type,
            ...(toOptionalString(runArtifact.blockingContract.reason.label)
              ? {
                  reasonLabel: toOptionalString(
                    runArtifact.blockingContract.reason.label,
                  ),
                }
              : {}),
          },
        }
      : {}),
    ...(waitingUserObserved
      ? {
          waitingUser: {
            observed: true,
            ...(toOptionalString(runArtifact.waitingUser?.reason)
              ? { reason: toOptionalString(runArtifact.waitingUser?.reason) }
              : {}),
            ...(toOptionalString(runArtifact.waitingUser?.nodeId)
              ? { nodeId: toOptionalString(runArtifact.waitingUser?.nodeId) }
              : {}),
            ...(toOptionalString(runArtifact.waitingUser?.moduleId)
              ? {
                  moduleId: toOptionalString(runArtifact.waitingUser?.moduleId),
                }
              : {}),
            ...(runArtifact.waitingUser?.nodeIndex !== undefined
              ? {
                  nodeIndex: toNonNegativeInt(
                    runArtifact.waitingUser.nodeIndex,
                  ),
                }
              : {}),
          },
        }
      : {}),
    ...(checkpointObserved
      ? {
          checkpoint: {
            observed: true,
            stage: runArtifact.checkpointCandidate?.stage,
            reason: runArtifact.checkpointCandidate?.reason,
            ...(toOptionalString(runArtifact.checkpointCandidate?.nodeId)
              ? {
                  nodeId: toOptionalString(
                    runArtifact.checkpointCandidate?.nodeId,
                  ),
                }
              : {}),
            ...(runArtifact.checkpointCandidate?.nodeIndex !== undefined
              ? {
                  nodeIndex: toNonNegativeInt(
                    runArtifact.checkpointCandidate.nodeIndex,
                  ),
                }
              : {}),
          },
        }
      : {}),
    ...(runArtifact.controlPreconditionsContract
      ? {
          controlPreconditions: {
            explanation: runArtifact.controlPreconditionsContract.explanation,
            ...(runArtifact.controlPreconditionsContract
              .nonContinuableReasonKind
              ? {
                  nonContinuableReasonKind:
                    runArtifact.controlPreconditionsContract
                      .nonContinuableReasonKind,
                }
              : {}),
            items: runArtifact.controlPreconditionsContract.items.map(
              (item) => ({
                kind: item.kind,
                status: item.status,
                label: item.label,
                ...(toOptionalString(item.detail)
                  ? { detail: toOptionalString(item.detail) }
                  : {}),
                sourceKind: item.sourceKind,
                conservativeSourceKind: item.conservativeSourceKind,
              }),
            ),
          },
        }
      : {}),
    ...(runArtifact.constraintSummary
      ? {
          constraintSummary: {
            heading: runArtifact.constraintSummary.heading,
            explanation: runArtifact.constraintSummary.explanation,
            disclaimer: runArtifact.constraintSummary.disclaimer,
            capabilityBoundary:
              runArtifact.constraintSummary.capabilityBoundary,
          },
        }
      : {}),
    ...(runArtifact.recoveryEligibility
      ? {
          recoveryEligibility: {
            status: runArtifact.recoveryEligibility.status,
            source: runArtifact.recoveryEligibility.source,
            label: runArtifact.recoveryEligibility.label,
            ...(toOptionalString(runArtifact.recoveryEligibility.detail)
              ? {
                  detail: toOptionalString(
                    runArtifact.recoveryEligibility.detail,
                  ),
                }
              : {}),
          },
        }
      : {}),
  };

  artifact.summary.evidenceSources = deriveEvidenceSources(artifact);

  return {
    kind: "graph_blocking_explain_artifact",
    version: "v1",
    artifact,
  };
}

function toLegacyEnvelope(
  value: Record<string, unknown>,
): GraphBlockingExplainArtifactEnvelope | null {
  const artifact = normalizeArtifact(
    value.graph_blocking_explain_artifact ?? value.graph_blocking_explain,
  );
  if (!artifact) {
    return null;
  }
  artifact.summary.evidenceSources = artifact.summary.evidenceSources.length
    ? artifact.summary.evidenceSources
    : deriveEvidenceSources(artifact);
  return {
    kind: "graph_blocking_explain_artifact",
    version: "v1",
    artifact,
  };
}

export function readGraphBlockingExplainArtifactEnvelope(
  value: unknown,
): GraphBlockingExplainArtifactEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.kind === "graph_blocking_explain_artifact" &&
    value.version === "v1"
  ) {
    const artifact = normalizeArtifact(value.artifact);
    if (!artifact) {
      return null;
    }
    artifact.summary.evidenceSources = artifact.summary.evidenceSources.length
      ? artifact.summary.evidenceSources
      : deriveEvidenceSources(artifact);
    return {
      kind: "graph_blocking_explain_artifact",
      version: "v1",
      artifact,
    };
  }

  const directArtifact = normalizeArtifact(value);
  if (directArtifact) {
    directArtifact.summary.evidenceSources =
      directArtifact.summary.evidenceSources.length
        ? directArtifact.summary.evidenceSources
        : deriveEvidenceSources(directArtifact);
    return {
      kind: "graph_blocking_explain_artifact",
      version: "v1",
      artifact: directArtifact,
    };
  }

  if (isRecord(value.graph_blocking_explain_artifact)) {
    return readGraphBlockingExplainArtifactEnvelope(
      value.graph_blocking_explain_artifact,
    );
  }

  if (
    "graph_blocking_explain_artifact" in value ||
    "graph_blocking_explain" in value
  ) {
    return toLegacyEnvelope(value);
  }

  if (isRecord(value.bridge)) {
    return readGraphBlockingExplainArtifactEnvelope(value.bridge);
  }

  return null;
}
