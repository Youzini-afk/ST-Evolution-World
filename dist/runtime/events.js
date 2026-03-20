import _ from "lodash";
import { getEventTypes, getSTContext, onSTEvent, onSTEventFirst, } from "../st-adapter";
import { showManagedWorkflowNotice } from "../ui/notice";
import { getEffectiveFlows } from "./char-flows";
import { getChatMessages, getCurrentCharacterName, getLastMessageId, setChatMessages, } from "./compat/character";
import { stopGeneration } from "./compat/generation";
import { clearReplyInstruction } from "./compat/injection";
import { applySnapshotDiffToCurrentWorldbook, disposeFloorBindingEvents, initFloorBindingEvents, migrateBeforeReplyArtifactsToAssistant, pinMessageSnapshotToCurrentVersion, readFloorSnapshotByMessageId, rollbackBeforeFloor, } from "./floor-binding";
import { getMessageVersionInfo, simpleHash } from "./helpers";
import { resetHideState, runIncrementalHideCheck, scheduleHideSettingsApply, } from "./hide-engine";
import { markIntercepted, resetInterceptGuard, wasRecentlyIntercepted, } from "./intercept-guard";
import { runWorkflow } from "./pipeline";
import { getSettings, patchSettings } from "./settings";
import { buildArchivedArtifactVersionKey, buildFileName, buildLegacyFileName, buildSnapshotStoreOwner, createEmptySnapshotStore, deleteSnapshot, hasSnapshotStorePayload, pruneAllVersionedEntries, pruneArchivedVersionedEntries, readSnapshotStore, writeSnapshotStore, } from "./snapshot-storage";
import { clearAfterReplyPending, clearAfterReplyPendingIfMatches, clearBeforeReplyBindingPending, clearSendContextIfMatches, getRuntimeState, isQuietLike, markAfterReplyHandled, markBeforeReplyBindingMigrated, pruneExpiredBeforeReplyBindingPending, recordGeneration, recordUserSend, recordUserSendIntent, resetRuntimeState, setBeforeReplyBindingPending, setProcessing, shouldHandleAfterReply, shouldHandleGenerationAfter, wasAfterReplyHandled, } from "./state";
const EW_FLOOR_WORKFLOW_EXECUTION_KEY = "ew_workflow_execution";
const EW_BEFORE_REPLY_BINDING_KEY = "ew_before_reply_binding";
const EW_REDERIVE_META_KEY = "ew_rederive_meta";
const EW_WORKFLOW_REPLAY_CAPSULE_KEY = "ew_workflow_replay_capsule";
const EW_SNAPSHOT_FILE_KEY = "ew_snapshot_file";
const EW_SWIPE_ID_KEY = "ew_snapshot_swipe_id";
const EW_CONTENT_HASH_KEY = "ew_snapshot_content_hash";
const listenerStops = [];
const domCleanup = [];
const HOOK_RETRY_DELAY_MS = 1200;
const EW_GENERATE_INTERCEPTOR_KEY = "ew_generation_interceptor";
let sendIntentRetryTimer = null;
const NON_SEND_GENERATION_TYPES = new Set(["continue", "regenerate", "swipe"]);
const WORKFLOW_NOTICE_COLLAPSE_MS = 5000;
const workflowTaskQueue = [];
const queuedBeforeReplyJobKeys = new Set();
const queuedAfterReplyJobKeys = new Set();
const queuedAfterReplyDedupKeys = new Set();
const processedAfterReplyIdentityKeys = new Set();
const failedAfterReplyJobsByChat = new Map();
let workflowTaskDrainPromise = null;
let workflowTaskSeq = 0;
const lastBeforeReplyTriggerByIdentityKey = new Map();
const lastAfterReplyTriggerByIdentityKey = new Map();
const MIN_BEFORE_REPLY_INTERVAL_MS = 2500;
const MIN_AFTER_REPLY_INTERVAL_MS = 3000;
let runtimeEventsInitialized = false;
const artifactCompactionInFlightByChat = new Map();
function getCurrentCharacterNameSafe() {
    return getCurrentCharacterName() ?? "unknown";
}
function buildArtifactFileCandidates(messageId, message) {
    const candidates = [];
    const explicit = typeof message?.data?.[EW_SNAPSHOT_FILE_KEY] === "string"
        ? String(message.data[EW_SNAPSHOT_FILE_KEY]).trim()
        : "";
    if (explicit) {
        candidates.push(explicit);
    }
    const chatId = getCurrentChatKey();
    const charName = getCurrentCharacterNameSafe();
    const currentNamed = buildFileName(charName, chatId, messageId);
    if (!candidates.includes(currentNamed)) {
        candidates.push(currentNamed);
    }
    const legacyNamed = buildLegacyFileName(charName, chatId, messageId);
    if (!candidates.includes(legacyNamed)) {
        candidates.push(legacyNamed);
    }
    return candidates;
}
async function resolveArtifactStoreForMessage(messageId) {
    const message = getChatMessages(messageId)[0];
    if (!message) {
        return null;
    }
    const chatId = getCurrentChatKey();
    const charName = getCurrentCharacterNameSafe();
    const currentNamed = buildFileName(charName, chatId, messageId);
    const legacyNamed = buildLegacyFileName(charName, chatId, messageId);
    const expectedOwner = buildSnapshotStoreOwner(charName, chatId);
    for (const candidate of buildArtifactFileCandidates(messageId, message)) {
        const store = await readSnapshotStore(candidate);
        if (store) {
            const ownerMatches = store.owner &&
                store.owner.char_name === expectedOwner.char_name &&
                store.owner.chat_id === expectedOwner.chat_id &&
                store.owner.chat_fingerprint === expectedOwner.chat_fingerprint;
            const nameMatches = candidate === currentNamed || candidate === legacyNamed;
            if (store.owner) {
                if (!ownerMatches) {
                    continue;
                }
            }
            else if (!nameMatches) {
                continue;
            }
            return {
                message,
                fileName: candidate,
                store,
            };
        }
    }
    return {
        message,
        fileName: currentNamed,
        store: createEmptySnapshotStore(buildSnapshotStoreOwner(charName, chatId)),
    };
}
function syncArtifactMessageVersionMeta(nextData, message) {
    const versionInfo = getMessageVersionInfo(message);
    nextData[EW_SWIPE_ID_KEY] = versionInfo.swipe_id;
    if (String(versionInfo.content_hash ?? "").trim()) {
        nextData[EW_CONTENT_HASH_KEY] = versionInfo.content_hash;
    }
    else {
        delete nextData[EW_CONTENT_HASH_KEY];
    }
}
// ST 扩展直接运行在主页面，无需 getHostWindow/getChatDocument
function getChatDocument() {
    return document;
}
function scheduleSendIntentHooksRetry() {
    if (sendIntentRetryTimer) {
        return;
    }
    sendIntentRetryTimer = setTimeout(() => {
        sendIntentRetryTimer = null;
        installSendIntentHooks();
    }, HOOK_RETRY_DELAY_MS);
}
function registerGenerationAfterCommands(handler) {
    const eventTypes = getEventTypes();
    return onSTEventFirst(eventTypes.GENERATION_AFTER_COMMANDS, handler);
}
function getSendTextareaValue() {
    const textarea = getChatDocument().getElementById("send_textarea");
    return String(textarea?.value ?? "");
}
function firstNonEmptyText(...values) {
    for (const value of values) {
        const text = String(value ?? "");
        if (text.trim()) {
            return text;
        }
    }
    return "";
}
function getLatestUserMessageText() {
    try {
        const msgs = getChatMessages(`0-${getLastMessageId()}`, {
            hide_state: "unhidden",
        });
        const lastUserMsg = [...msgs]
            .reverse()
            .find((message) => message.role === "user");
        return String(lastUserMsg?.message ?? "");
    }
    catch {
        return "";
    }
}
function getInterceptedUserInput(options) {
    const runtimeState = getRuntimeState();
    return firstNonEmptyText(options.user_input, options.prompt, runtimeState.last_send_intent?.user_input, options.injects?.[0]?.content);
}
function resolveWorkflowUserInput(options, generationType) {
    const interceptedInput = getInterceptedUserInput(options);
    if (interceptedInput) {
        return interceptedInput;
    }
    if (NON_SEND_GENERATION_TYPES.has(generationType)) {
        return getLatestUserMessageText();
    }
    return "";
}
function resolveFallbackWorkflowUserInput(generationType) {
    const runtimeState = getRuntimeState();
    const interceptedInput = firstNonEmptyText(runtimeState.last_send?.user_input, runtimeState.last_send_intent?.user_input);
    if (interceptedInput) {
        return interceptedInput;
    }
    if (NON_SEND_GENERATION_TYPES.has(generationType)) {
        return getLatestUserMessageText();
    }
    return "";
}
function resolvePrimaryWorkflowUserInput(generationType) {
    const textareaInput = getSendTextareaValue();
    if (textareaInput.trim()) {
        return textareaInput;
    }
    return resolveFallbackWorkflowUserInput(generationType);
}
function resolveAfterReplyUserInput() {
    const runtimeState = getRuntimeState();
    return firstNonEmptyText(runtimeState.after_reply.pending_user_input, runtimeState.last_send?.user_input, runtimeState.last_send_intent?.user_input, getLatestUserMessageText());
}
function resolveWorkflowJobPriority(jobType) {
    if (jobType === "live_auto") {
        return 0;
    }
    if (jobType === "live_reroll") {
        return 1;
    }
    return 2;
}
function resolveAfterReplyContextWindowMs(settings) {
    return Math.max(settings.total_timeout_ms + 10000, settings.gate_ttl_ms, 600000);
}
function clearQueuedWorkflowTasks(reason) {
    for (const task of workflowTaskQueue.splice(0, workflowTaskQueue.length)) {
        task.reject(new Error(reason));
    }
    queuedBeforeReplyJobKeys.clear();
    queuedAfterReplyJobKeys.clear();
    queuedAfterReplyDedupKeys.clear();
    processedAfterReplyIdentityKeys.clear();
    lastBeforeReplyTriggerByIdentityKey.clear();
    lastAfterReplyTriggerByIdentityKey.clear();
}
function enqueueWorkflowTask(label, run, priority = 1) {
    return new Promise((resolve, reject) => {
        workflowTaskQueue.push({
            label,
            priority,
            seq: workflowTaskSeq++,
            run: run,
            resolve: (value) => resolve(value),
            reject,
        });
        workflowTaskQueue.sort((left, right) => left.priority - right.priority || left.seq - right.seq);
        if (!workflowTaskDrainPromise) {
            workflowTaskDrainPromise = (async () => {
                while (workflowTaskQueue.length > 0) {
                    const task = workflowTaskQueue.shift();
                    if (!task) {
                        continue;
                    }
                    try {
                        task.resolve(await task.run());
                    }
                    catch (error) {
                        task.reject(error);
                    }
                }
            })().finally(() => {
                workflowTaskDrainPromise = null;
            });
        }
    });
}
function enqueueWorkflowJob(jobType, label, run) {
    return enqueueWorkflowTask(label, run, resolveWorkflowJobPriority(jobType));
}
function getFailedAfterReplyJobs(chatKey) {
    return [...(failedAfterReplyJobsByChat.get(chatKey) ?? [])].sort((left, right) => left.failed_at - right.failed_at);
}
function upsertFailedAfterReplyJob(job) {
    const current = failedAfterReplyJobsByChat.get(job.chat_key) ?? [];
    const next = current.filter((item) => item.message_id !== job.message_id);
    next.push(job);
    failedAfterReplyJobsByChat.set(job.chat_key, next.sort((left, right) => left.failed_at - right.failed_at));
}
function removeFailedAfterReplyJob(chatKey, messageId) {
    const current = failedAfterReplyJobsByChat.get(chatKey);
    if (!current?.length) {
        return;
    }
    const next = current.filter((item) => item.message_id !== messageId);
    if (next.length > 0) {
        failedAfterReplyJobsByChat.set(chatKey, next);
    }
    else {
        failedAfterReplyJobsByChat.delete(chatKey);
    }
}
function installSendIntentHooks() {
    for (const cleanup of domCleanup.splice(0, domCleanup.length)) {
        cleanup();
    }
    const doc = getChatDocument();
    const sendButton = doc.getElementById("send_but");
    if (sendButton) {
        const onSendIntent = () => {
            recordUserSendIntent(getSendTextareaValue());
        };
        sendButton.addEventListener("click", onSendIntent, true);
        sendButton.addEventListener("pointerup", onSendIntent, true);
        sendButton.addEventListener("touchend", onSendIntent, true);
        domCleanup.push(() => {
            sendButton.removeEventListener("click", onSendIntent, true);
            sendButton.removeEventListener("pointerup", onSendIntent, true);
            sendButton.removeEventListener("touchend", onSendIntent, true);
        });
    }
    const sendTextarea = doc.getElementById("send_textarea");
    if (sendTextarea) {
        const onKeyDown = (event) => {
            const keyboardEvent = event;
            if ((keyboardEvent.key === "Enter" ||
                keyboardEvent.key === "NumpadEnter") &&
                !keyboardEvent.shiftKey) {
                recordUserSendIntent(getSendTextareaValue());
            }
        };
        sendTextarea.addEventListener("keydown", onKeyDown, true);
        domCleanup.push(() => sendTextarea.removeEventListener("keydown", onKeyDown, true));
    }
    if (!sendButton || !sendTextarea) {
        scheduleSendIntentHooksRetry();
    }
}
function stopGenerationNow() {
    try {
        stopGeneration();
    }
    catch {
        // ignore
    }
}
function formatReasonForDisplay(reason, maxLen = 160) {
    const text = String(reason ?? "unknown")
        .replace(/\s+/g, " ")
        .trim();
    if (text.length <= maxLen) {
        return text;
    }
    return `${text.slice(0, maxLen)}...`;
}
function getFailureStageLabel(stage) {
    switch (stage) {
        case "dispatch":
            return "请求阶段";
        case "merge":
            return "合并阶段";
        case "commit":
            return "写回阶段";
        case "cancelled":
            return "已取消";
        case "config":
            return "配置阶段";
        case "unknown":
        default:
            return "未知阶段";
    }
}
function buildFailureNoticeMessage(failure, fallbackReason, options) {
    if (!failure) {
        return options?.retrying
            ? `首次处理失败，正在重试… ${formatReasonForDisplay(fallbackReason, 120)}`
            : `工作流失败：${formatReasonForDisplay(fallbackReason)}`;
    }
    const lines = [
        options?.retrying
            ? `首次处理失败，正在重试：${failure.summary}`
            : `工作流失败：${failure.summary}`,
        `阶段：${getFailureStageLabel(failure.stage)}`,
    ];
    if (failure.flow_name || failure.flow_id) {
        lines.push(`工作流：${failure.flow_name || failure.flow_id}`);
    }
    if (failure.api_preset_name) {
        lines.push(`接口：${failure.api_preset_name}`);
    }
    if (failure.suggestion) {
        lines.push(`建议：${failure.suggestion}`);
    }
    if (options?.includeReleaseHint) {
        lines.push("原消息是否继续发送取决于当前放行策略。");
    }
    return lines.join("\n");
}
function buildFailureToastMessage(failure, fallbackReason) {
    if (!failure) {
        return formatReasonForDisplay(fallbackReason);
    }
    const parts = [failure.summary, getFailureStageLabel(failure.stage)];
    if (failure.flow_name || failure.flow_id) {
        parts.push(failure.flow_name || failure.flow_id);
    }
    if (failure.suggestion) {
        parts.push(failure.suggestion);
    }
    return parts.join(" · ");
}
function buildFailureNoticeAction(failure) {
    if (!failure) {
        return undefined;
    }
    return {
        label: "打开面板",
        kind: "neutral",
        onClick: () => {
            patchSettings({ ui_open: true });
        },
    };
}
function collectSuccessfulDispatchResultsFromAttempts(attempts) {
    return attempts
        .filter((attempt) => attempt.ok && attempt.response)
        .map((attempt) => ({
        flow: attempt.flow,
        flow_order: attempt.flow_order,
        response: attempt.response,
    }));
}
function mergePreservedDispatchResults(current, next) {
    const resultByFlowId = new Map();
    for (const item of current) {
        resultByFlowId.set(item.flow.id, item);
    }
    for (const item of next) {
        resultByFlowId.set(item.flow.id, item);
    }
    return [...resultByFlowId.values()].sort((left, right) => left.flow_order - right.flow_order);
}
function resolveAutoRerollTarget(result) {
    const failedFlowIds = [
        ...new Set(result.attempts
            .filter((attempt) => !attempt.ok)
            .map((attempt) => String(attempt.flow.id ?? "").trim())
            .filter(Boolean)),
    ];
    if (failedFlowIds.length > 0) {
        return { ok: true, flowIds: failedFlowIds };
    }
    const stage = result.failure?.stage;
    if (stage === "merge" || stage === "commit") {
        return {
            ok: false,
            reason: "失败发生在合并/写回阶段；自动重roll已跳过，避免重复请求已成功的工作流。",
        };
    }
    return { ok: false, reason: "未定位到失败工作流；自动重roll已跳过。" };
}
function buildExecutionVersionKey(state) {
    return `sw:${Math.max(0, Math.trunc(Number(state.swipe_id ?? 0) || 0))}|${String(state.content_hash ?? "").trim()}`;
}
function normalizeFloorWorkflowExecutionState(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
    }
    const obj = raw;
    const successfulResults = Array.isArray(obj.successful_results)
        ? obj.successful_results
            .filter((item) => item && typeof item === "object" && !Array.isArray(item))
            .map((item) => {
            const result = item;
            return {
                flow_id: String(result.flow_id ?? "").trim(),
                response: result.response && typeof result.response === "object"
                    ? result.response
                    : {},
            };
        })
            .filter((item) => item.flow_id)
        : [];
    const failedFlowIds = Array.isArray(obj.failed_flow_ids)
        ? obj.failed_flow_ids
            .map((value) => String(value ?? "").trim())
            .filter(Boolean)
        : [];
    const attemptedFlowIds = Array.isArray(obj.attempted_flow_ids)
        ? obj.attempted_flow_ids
            .map((value) => String(value ?? "").trim())
            .filter(Boolean)
        : [];
    const executionStatus = obj.execution_status === "skipped" ? "skipped" : "executed";
    const skipReason = typeof obj.skip_reason === "string" ? String(obj.skip_reason).trim() : "";
    const successfulFlowIds = Array.isArray(obj.successful_flow_ids)
        ? obj.successful_flow_ids
            .map((value) => String(value ?? "").trim())
            .filter(Boolean)
        : successfulResults.map((item) => item.flow_id);
    return {
        at: Number(obj.at ?? 0),
        request_id: String(obj.request_id ?? "").trim(),
        swipe_id: typeof obj.swipe_id === "number" ? obj.swipe_id : undefined,
        content_hash: typeof obj.content_hash === "string" ? obj.content_hash : undefined,
        attempted_flow_ids: _.uniq(attemptedFlowIds),
        successful_results: successfulResults,
        successful_flow_ids: _.uniq(successfulFlowIds),
        failed_flow_ids: _.uniq(failedFlowIds),
        workflow_failed: Boolean(obj.workflow_failed),
        execution_status: executionStatus,
        skip_reason: skipReason || undefined,
        details_externalized: Boolean(obj.details_externalized),
    };
}
function normalizeFloorWorkflowExecutionMap(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const obj = raw;
    if (Array.isArray(obj.attempted_flow_ids) ||
        Array.isArray(obj.successful_results) ||
        Array.isArray(obj.failed_flow_ids) ||
        typeof obj.request_id === "string") {
        const upgraded = normalizeFloorWorkflowExecutionState(raw);
        if (!upgraded) {
            return {};
        }
        return {
            [buildExecutionVersionKey(upgraded)]: upgraded,
        };
    }
    const map = {};
    for (const [key, value] of Object.entries(obj)) {
        const normalized = normalizeFloorWorkflowExecutionState(value);
        if (normalized) {
            map[key] = normalized;
        }
    }
    return map;
}
function readFloorWorkflowExecutionMap(messageId) {
    try {
        const message = getChatMessages(messageId)[0];
        return normalizeFloorWorkflowExecutionMap(message?.data?.[EW_FLOOR_WORKFLOW_EXECUTION_KEY]);
    }
    catch {
        return {};
    }
}
function buildFloorWorkflowExecutionSummaryState(state) {
    return {
        ...state,
        successful_results: [],
        successful_flow_ids: _.uniq(state.successful_flow_ids ??
            state.successful_results.map((result) => result.flow_id)),
        details_externalized: true,
    };
}
function buildFloorWorkflowExecutionSummaryMap(map) {
    const summaryMap = {};
    for (const [key, value] of Object.entries(map)) {
        const normalized = normalizeFloorWorkflowExecutionState(value);
        if (!normalized) {
            continue;
        }
        summaryMap[key] = buildFloorWorkflowExecutionSummaryState(normalized);
    }
    pruneAllVersionedEntries(summaryMap, 2);
    return summaryMap;
}
function isExecutionSummaryOnlyMap(raw) {
    const map = normalizeFloorWorkflowExecutionMap(raw);
    const values = Object.values(map);
    return values.length > 0 && values.every((value) => Boolean(value.details_externalized));
}
async function readFloorWorkflowExecutionMapComplete(messageId) {
    const inline = readFloorWorkflowExecutionMap(messageId);
    const resolved = await resolveArtifactStoreForMessage(messageId);
    if (!resolved) {
        return inline;
    }
    const external = normalizeFloorWorkflowExecutionMap(resolved.store.workflow_execution);
    if (Object.keys(external).length === 0) {
        return inline;
    }
    if (Object.keys(inline).length === 0) {
        return external;
    }
    return {
        ...inline,
        ...external,
    };
}
function selectExecutionStateForHistory(map, versionInfo) {
    const exact = map[versionInfo.version_key];
    if (exact) {
        return exact;
    }
    const entries = Object.entries(map);
    if (entries.length === 0) {
        return null;
    }
    const stableEntries = entries.filter(([key]) => !String(key).includes("@rev:"));
    const effectiveEntries = stableEntries.length > 0 ? stableEntries : entries;
    if (effectiveEntries.length === 1) {
        return effectiveEntries[0][1];
    }
    for (let index = effectiveEntries.length - 1; index >= 0; index -= 1) {
        const [, state] = effectiveEntries[index];
        if (Number(state.swipe_id ?? -1) === Number(versionInfo.swipe_id ?? -1)) {
            return state;
        }
    }
    return effectiveEntries[effectiveEntries.length - 1]?.[1] ?? null;
}
export function readFloorWorkflowExecution(messageId, mode = "strict") {
    const message = getChatMessages(messageId)[0];
    if (!message) {
        return null;
    }
    const versionInfo = getMessageVersionInfo(message);
    const map = readFloorWorkflowExecutionMap(messageId);
    const exact = map[versionInfo.version_key];
    if (exact) {
        return exact;
    }
    if (mode === "history") {
        return selectExecutionStateForHistory(map, versionInfo);
    }
    const values = Object.values(map);
    if (values.length === 1) {
        const only = values[0];
        if (!only.content_hash) {
            return only;
        }
    }
    return null;
}
async function readFloorWorkflowExecutionComplete(messageId, mode = "strict") {
    const message = getChatMessages(messageId)[0];
    if (!message) {
        return null;
    }
    const versionInfo = getMessageVersionInfo(message);
    const map = await readFloorWorkflowExecutionMapComplete(messageId);
    const exact = map[versionInfo.version_key];
    if (exact) {
        return exact;
    }
    if (mode === "history") {
        return selectExecutionStateForHistory(map, versionInfo);
    }
    const values = Object.values(map);
    if (values.length === 1) {
        const only = values[0];
        if (!only.content_hash) {
            return only;
        }
    }
    return null;
}
async function persistFloorWorkflowExecutionMap(messageId, map) {
    const resolved = await resolveArtifactStoreForMessage(messageId);
    if (!resolved) {
        return;
    }
    const normalizedMap = normalizeFloorWorkflowExecutionMap(map);
    pruneAllVersionedEntries(normalizedMap, 2);
    const { message, fileName } = resolved;
    const nextData = {
        ...(message.data ?? {}),
    };
    if (getSettings().snapshot_storage === "file") {
        try {
            const chatId = getCurrentChatKey();
            const charName = getCurrentCharacterNameSafe();
            const store = resolved.store ??
                createEmptySnapshotStore(buildSnapshotStoreOwner(charName, chatId));
            store.owner = buildSnapshotStoreOwner(charName, chatId);
            store.workflow_execution = { ...normalizedMap };
            pruneAllVersionedEntries(store.workflow_execution, 2);
            if (Object.keys(normalizedMap).length > 0) {
                await writeSnapshotStore(fileName, store);
                nextData[EW_SNAPSHOT_FILE_KEY] = fileName;
                nextData[EW_FLOOR_WORKFLOW_EXECUTION_KEY] =
                    buildFloorWorkflowExecutionSummaryMap(normalizedMap);
                syncArtifactMessageVersionMeta(nextData, message);
            }
            else {
                delete nextData[EW_FLOOR_WORKFLOW_EXECUTION_KEY];
                if (hasSnapshotStorePayload(store)) {
                    await writeSnapshotStore(fileName, store);
                    nextData[EW_SNAPSHOT_FILE_KEY] = fileName;
                }
                else {
                    delete nextData[EW_SNAPSHOT_FILE_KEY];
                    await deleteSnapshot(fileName);
                }
            }
        }
        catch (error) {
            console.warn("[Evolution World] workflow execution artifact externalization failed, falling back to message data:", error);
            if (Object.keys(normalizedMap).length > 0) {
                nextData[EW_FLOOR_WORKFLOW_EXECUTION_KEY] = normalizedMap;
            }
            else {
                delete nextData[EW_FLOOR_WORKFLOW_EXECUTION_KEY];
            }
        }
    }
    else {
        if (Object.keys(normalizedMap).length > 0) {
            nextData[EW_FLOOR_WORKFLOW_EXECUTION_KEY] = normalizedMap;
        }
        else {
            delete nextData[EW_FLOOR_WORKFLOW_EXECUTION_KEY];
        }
    }
    await setChatMessages([{ message_id: messageId, data: nextData }], {
        refresh: "none",
    });
}
async function writeFloorWorkflowExecution(messageId, state) {
    if (state) {
        const map = await readFloorWorkflowExecutionMapComplete(messageId);
        const versionKey = buildExecutionVersionKey(state);
        const existing = map[versionKey];
        if (existing) {
            const existingJson = JSON.stringify(existing);
            const nextJson = JSON.stringify(state);
            if (existingJson !== nextJson) {
                map[buildArchivedArtifactVersionKey(versionKey, map)] = existing;
            }
        }
        map[versionKey] = state;
        pruneArchivedVersionedEntries(map, versionKey, 2);
        await persistFloorWorkflowExecutionMap(messageId, map);
        return;
    }
    await persistFloorWorkflowExecutionMap(messageId, {});
}
async function pinFloorWorkflowExecutionToCurrentVersion(messageId, state) {
    if (!state) {
        return false;
    }
    const message = getChatMessages(messageId)[0];
    if (!message) {
        return false;
    }
    const versionInfo = getMessageVersionInfo(message);
    const targetKey = buildExecutionVersionKey(versionInfo);
    const map = await readFloorWorkflowExecutionMapComplete(messageId);
    if (map[targetKey]) {
        return false;
    }
    map[targetKey] = {
        ...state,
        swipe_id: versionInfo.swipe_id,
        content_hash: versionInfo.content_hash,
    };
    await persistFloorWorkflowExecutionMap(messageId, map);
    return true;
}
function normalizeWorkflowReplayCapsuleMap(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const map = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            continue;
        }
        const obj = value;
        map[key] = {
            at: Number(obj.at ?? 0),
            request_id: String(obj.request_id ?? "").trim(),
            job_type: obj.job_type === "live_auto" ||
                obj.job_type === "live_reroll" ||
                obj.job_type === "historical_rederive"
                ? obj.job_type
                : "live_auto",
            timing: obj.timing === "before_reply" ||
                obj.timing === "after_reply" ||
                obj.timing === "manual"
                ? obj.timing
                : "manual",
            source: String(obj.source ?? ""),
            generation_type: String(obj.generation_type ?? ""),
            target_message_id: Number(obj.target_message_id ?? -1),
            target_version_key: String(obj.target_version_key ?? ""),
            target_role: obj.target_role === "user" || obj.target_role === "assistant"
                ? obj.target_role
                : "other",
            flow_ids: Array.isArray(obj.flow_ids)
                ? obj.flow_ids
                    .map((value) => String(value ?? "").trim())
                    .filter(Boolean)
                : [],
            flow_ids_hash: String(obj.flow_ids_hash ?? ""),
            capsule_mode: obj.capsule_mode === "light" ? "light" : "full",
            legacy_approx: Boolean(obj.legacy_approx),
            assembled_messages: Array.isArray(obj.assembled_messages)
                ? obj.assembled_messages
                    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
                    .map((item) => ({
                    role: String(item.role ?? ""),
                    content: String(item.content ?? ""),
                    name: typeof item.name === "string"
                        ? String(item.name)
                        : undefined,
                }))
                : undefined,
            request_preview: Array.isArray(obj.request_preview)
                ? obj.request_preview
                    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
                    .map((item) => ({ ...item }))
                : undefined,
            details_externalized: Boolean(obj.details_externalized),
        };
    }
    return map;
}
function readWorkflowReplayCapsuleMap(messageId) {
    const message = getChatMessages(messageId)[0];
    return normalizeWorkflowReplayCapsuleMap(message?.data?.[EW_WORKFLOW_REPLAY_CAPSULE_KEY]);
}
function buildWorkflowReplayCapsuleSummary(capsule) {
    return {
        ...capsule,
        assembled_messages: undefined,
        request_preview: undefined,
        details_externalized: true,
    };
}
function buildWorkflowReplayCapsuleSummaryMap(map) {
    const summaryMap = {};
    for (const [key, value] of Object.entries(map)) {
        summaryMap[key] = buildWorkflowReplayCapsuleSummary(value);
    }
    pruneAllVersionedEntries(summaryMap, 2);
    return summaryMap;
}
function isWorkflowReplayCapsuleSummaryMap(raw) {
    const map = normalizeWorkflowReplayCapsuleMap(raw);
    const values = Object.values(map);
    return values.length > 0 && values.every((value) => Boolean(value.details_externalized));
}
async function readWorkflowReplayCapsuleMapComplete(messageId) {
    const inline = readWorkflowReplayCapsuleMap(messageId);
    const resolved = await resolveArtifactStoreForMessage(messageId);
    if (!resolved) {
        return inline;
    }
    const external = normalizeWorkflowReplayCapsuleMap(resolved.store.replay_capsules);
    if (Object.keys(external).length === 0) {
        return inline;
    }
    if (Object.keys(inline).length === 0) {
        return external;
    }
    return {
        ...inline,
        ...external,
    };
}
function hasWorkflowReplayCapsule(messageId) {
    const map = readWorkflowReplayCapsuleMap(messageId);
    return Object.keys(map).length > 0;
}
async function hasWorkflowReplayCapsuleComplete(messageId) {
    const map = await readWorkflowReplayCapsuleMapComplete(messageId);
    return Object.keys(map).length > 0;
}
async function persistWorkflowReplayCapsuleMap(messageId, map) {
    const resolved = await resolveArtifactStoreForMessage(messageId);
    if (!resolved) {
        return;
    }
    const normalizedMap = normalizeWorkflowReplayCapsuleMap(map);
    pruneAllVersionedEntries(normalizedMap, 2);
    const { message, fileName } = resolved;
    const nextData = {
        ...(message.data ?? {}),
    };
    if (getSettings().snapshot_storage === "file") {
        try {
            const chatId = getCurrentChatKey();
            const charName = getCurrentCharacterNameSafe();
            const store = resolved.store ??
                createEmptySnapshotStore(buildSnapshotStoreOwner(charName, chatId));
            store.owner = buildSnapshotStoreOwner(charName, chatId);
            store.replay_capsules = { ...normalizedMap };
            pruneAllVersionedEntries(store.replay_capsules, 2);
            if (Object.keys(normalizedMap).length > 0) {
                await writeSnapshotStore(fileName, store);
                nextData[EW_SNAPSHOT_FILE_KEY] = fileName;
                nextData[EW_WORKFLOW_REPLAY_CAPSULE_KEY] =
                    buildWorkflowReplayCapsuleSummaryMap(normalizedMap);
                syncArtifactMessageVersionMeta(nextData, message);
            }
            else {
                delete nextData[EW_WORKFLOW_REPLAY_CAPSULE_KEY];
                if (hasSnapshotStorePayload(store)) {
                    await writeSnapshotStore(fileName, store);
                    nextData[EW_SNAPSHOT_FILE_KEY] = fileName;
                }
                else {
                    delete nextData[EW_SNAPSHOT_FILE_KEY];
                    await deleteSnapshot(fileName);
                }
            }
        }
        catch (error) {
            console.warn("[Evolution World] replay capsule externalization failed, falling back to message data:", error);
            if (Object.keys(normalizedMap).length > 0) {
                nextData[EW_WORKFLOW_REPLAY_CAPSULE_KEY] = normalizedMap;
            }
            else {
                delete nextData[EW_WORKFLOW_REPLAY_CAPSULE_KEY];
            }
        }
    }
    else {
        if (Object.keys(normalizedMap).length > 0) {
            nextData[EW_WORKFLOW_REPLAY_CAPSULE_KEY] = normalizedMap;
        }
        else {
            delete nextData[EW_WORKFLOW_REPLAY_CAPSULE_KEY];
        }
    }
    await setChatMessages([{ message_id: messageId, data: nextData }], {
        refresh: "none",
    });
}
async function writeWorkflowReplayCapsule(messageId, capsule, versionInfo) {
    const resolved = await resolveArtifactStoreForMessage(messageId);
    if (!resolved) {
        return;
    }
    const message = resolved.message;
    const effectiveVersion = versionInfo?.version_key
        ? versionInfo
        : getMessageVersionInfo(message);
    const key = String(effectiveVersion.version_key ?? "").trim();
    if (!key) {
        return;
    }
    const map = await readWorkflowReplayCapsuleMapComplete(messageId);
    const existing = map[key];
    if (existing) {
        const existingJson = JSON.stringify(existing);
        const nextJson = JSON.stringify(capsule);
        if (existingJson !== nextJson) {
            map[buildArchivedArtifactVersionKey(key, map)] = existing;
        }
    }
    map[key] = capsule;
    pruneArchivedVersionedEntries(map, key, 2);
    await persistWorkflowReplayCapsuleMap(messageId, map);
}
async function migrateFloorWorkflowCapsuleToAssistant(sourceMessageId, assistantMessageId) {
    if (sourceMessageId === assistantMessageId) {
        return { migrated: false, reason: "same_message" };
    }
    const sourceMsg = getChatMessages(sourceMessageId)[0];
    const assistantMsg = getChatMessages(assistantMessageId)[0];
    if (!sourceMsg || !assistantMsg) {
        return { migrated: false, reason: "message_not_found" };
    }
    const sourceMap = readWorkflowReplayCapsuleMap(sourceMessageId);
    const sourceVersionInfo = getMessageVersionInfo(sourceMsg);
    const sourceCapsule = sourceMap[sourceVersionInfo.version_key];
    if (!sourceCapsule) {
        return { migrated: false, reason: "source_capsule_missing" };
    }
    const assistantMap = readWorkflowReplayCapsuleMap(assistantMessageId);
    const assistantVersionInfo = getMessageVersionInfo(assistantMsg);
    const targetKey = assistantVersionInfo.version_key;
    const nextCapsule = {
        ...sourceCapsule,
        target_message_id: assistantMessageId,
        target_version_key: targetKey,
        target_role: "assistant",
    };
    const existingAssistantCapsule = assistantMap[targetKey];
    if (existingAssistantCapsule) {
        const existingJson = JSON.stringify(existingAssistantCapsule);
        const nextJson = JSON.stringify(nextCapsule);
        if (existingJson !== nextJson) {
            assistantMap[buildArchivedArtifactVersionKey(targetKey, assistantMap)] =
                existingAssistantCapsule;
        }
    }
    assistantMap[targetKey] = nextCapsule;
    delete sourceMap[sourceVersionInfo.version_key];
    const sourceNextData = {
        ...(sourceMsg.data ?? {}),
    };
    if (Object.keys(sourceMap).length > 0) {
        sourceNextData[EW_WORKFLOW_REPLAY_CAPSULE_KEY] = sourceMap;
    }
    else {
        delete sourceNextData[EW_WORKFLOW_REPLAY_CAPSULE_KEY];
    }
    const assistantNextData = {
        ...(assistantMsg.data ?? {}),
        [EW_WORKFLOW_REPLAY_CAPSULE_KEY]: assistantMap,
    };
    await setChatMessages([
        { message_id: sourceMessageId, data: sourceNextData },
        { message_id: assistantMessageId, data: assistantNextData },
    ], { refresh: "none" });
    return { migrated: true };
}
function resolveExecutionStateForVersion(map, versionKey) {
    const exact = map[versionKey];
    if (exact) {
        return { key: versionKey, state: exact };
    }
    const entries = Object.entries(map);
    if (entries.length === 1) {
        const [key, state] = entries[0];
        return { key, state };
    }
    return null;
}
async function migrateFloorWorkflowExecutionToAssistant(sourceMessageId, assistantMessageId) {
    if (sourceMessageId === assistantMessageId) {
        return { migrated: false, reason: "same_message" };
    }
    const sourceMsg = getChatMessages(sourceMessageId)[0];
    const assistantMsg = getChatMessages(assistantMessageId)[0];
    if (!sourceMsg || !assistantMsg) {
        return { migrated: false, reason: "message_not_found" };
    }
    const sourceVersionInfo = getMessageVersionInfo(sourceMsg);
    const assistantVersionInfo = getMessageVersionInfo(assistantMsg);
    const sourceMap = readFloorWorkflowExecutionMap(sourceMessageId);
    const sourceResolved = resolveExecutionStateForVersion(sourceMap, buildExecutionVersionKey(sourceVersionInfo));
    if (!sourceResolved) {
        return { migrated: false, reason: "source_execution_missing" };
    }
    const sourceNextMap = { ...sourceMap };
    const assistantMap = readFloorWorkflowExecutionMap(assistantMessageId);
    const assistantNextMap = { ...assistantMap };
    const assistantVersionKey = buildExecutionVersionKey(assistantVersionInfo);
    let mutated = false;
    if (!assistantNextMap[assistantVersionKey]) {
        assistantNextMap[assistantVersionKey] = {
            ...sourceResolved.state,
            swipe_id: assistantVersionInfo.swipe_id,
            content_hash: assistantVersionInfo.content_hash,
        };
        mutated = true;
    }
    if (sourceNextMap[sourceResolved.key]) {
        delete sourceNextMap[sourceResolved.key];
        mutated = true;
    }
    if (!mutated) {
        return { migrated: false, reason: "already_migrated" };
    }
    const sourceNextData = {
        ...(sourceMsg.data ?? {}),
    };
    if (Object.keys(sourceNextMap).length > 0) {
        sourceNextData[EW_FLOOR_WORKFLOW_EXECUTION_KEY] = sourceNextMap;
    }
    else {
        delete sourceNextData[EW_FLOOR_WORKFLOW_EXECUTION_KEY];
    }
    const assistantNextData = {
        ...(assistantMsg.data ?? {}),
        [EW_FLOOR_WORKFLOW_EXECUTION_KEY]: assistantNextMap,
    };
    await setChatMessages([
        { message_id: sourceMessageId, data: sourceNextData },
        { message_id: assistantMessageId, data: assistantNextData },
    ], { refresh: "none" });
    return { migrated: true };
}
async function writeBeforeReplyBindingMeta(sourceMessageId, assistantMessageId, requestId) {
    const sourceMsg = getChatMessages(sourceMessageId)[0];
    const assistantMsg = getChatMessages(assistantMessageId)[0];
    if (!sourceMsg || !assistantMsg) {
        return;
    }
    const migratedAt = Date.now();
    const sourceData = {
        ...(sourceMsg.data ?? {}),
        [EW_BEFORE_REPLY_BINDING_KEY]: {
            role: "source",
            paired_message_id: assistantMessageId,
            request_id: requestId,
            migrated_at: migratedAt,
        },
    };
    const assistantData = {
        ...(assistantMsg.data ?? {}),
        [EW_BEFORE_REPLY_BINDING_KEY]: {
            role: "assistant_anchor",
            paired_message_id: sourceMessageId,
            request_id: requestId,
            migrated_at: migratedAt,
        },
    };
    await setChatMessages([
        { message_id: sourceMessageId, data: sourceData },
        { message_id: assistantMessageId, data: assistantData },
    ], { refresh: "none" });
}
async function migrateBeforeReplyBindingToAssistant(settings, assistantMessageId, pendingUserMessageId) {
    const pending = pruneExpiredBeforeReplyBindingPending();
    if (!pending) {
        return {
            migrated: false,
            snapshot_migrated: false,
            execution_migrated: false,
            capsule_migrated: false,
            reason: "pending_missing_or_expired",
        };
    }
    if (pending.migrated) {
        return {
            migrated: false,
            snapshot_migrated: false,
            execution_migrated: false,
            capsule_migrated: false,
            reason: "already_migrated",
        };
    }
    if (!Number.isFinite(pendingUserMessageId) ||
        pending.user_message_id !== pendingUserMessageId) {
        return {
            migrated: false,
            snapshot_migrated: false,
            execution_migrated: false,
            capsule_migrated: false,
            reason: "user_floor_mismatch",
        };
    }
    if (!Number.isFinite(pending.source_message_id) ||
        pending.source_message_id < 0) {
        clearBeforeReplyBindingPending();
        return {
            migrated: false,
            snapshot_migrated: false,
            execution_migrated: false,
            capsule_migrated: false,
            reason: "invalid_source_floor",
        };
    }
    const snapshotMove = await migrateBeforeReplyArtifactsToAssistant(settings, pending.source_message_id, assistantMessageId, pending.request_id);
    const executionMove = await migrateFloorWorkflowExecutionToAssistant(pending.source_message_id, assistantMessageId);
    const capsuleMove = await migrateFloorWorkflowCapsuleToAssistant(pending.source_message_id, assistantMessageId);
    const migrated = snapshotMove.migrated || executionMove.migrated || capsuleMove.migrated;
    const result = {
        migrated,
        snapshot_migrated: snapshotMove.migrated,
        execution_migrated: executionMove.migrated,
        capsule_migrated: capsuleMove.migrated,
        snapshot_reason: snapshotMove.reason,
        execution_reason: executionMove.reason,
        capsule_reason: capsuleMove.reason,
        reason: `snapshot:${snapshotMove.reason ?? "migrated"},execution:${executionMove.reason ?? "migrated"},capsule:${capsuleMove.reason ?? "migrated"}`,
    };
    if (migrated) {
        await writeBeforeReplyBindingMeta(pending.source_message_id, assistantMessageId, pending.request_id);
        markBeforeReplyBindingMigrated(assistantMessageId);
        console.info("[Evolution World] before_reply binding migrated to assistant anchor", {
            source_message_id: pending.source_message_id,
            assistant_message_id: assistantMessageId,
            snapshot_migrated: snapshotMove.migrated,
            execution_migrated: executionMove.migrated,
            capsule_migrated: capsuleMove.migrated,
            snapshot_reason: snapshotMove.reason ?? "migrated",
            execution_reason: executionMove.reason ?? "migrated",
            capsule_reason: capsuleMove.reason ?? "migrated",
        });
        return result;
    }
    console.warn("[Evolution World] before_reply binding migration failed", {
        source_message_id: pending.source_message_id,
        assistant_message_id: assistantMessageId,
        snapshot_reason: snapshotMove.reason ?? "not_migrated",
        execution_reason: executionMove.reason ?? "not_migrated",
        capsule_reason: capsuleMove.reason ?? "not_migrated",
    });
    return result;
}
function buildFloorWorkflowExecutionState(requestId, attempts, workflowFailed, preservedResults = [], versionInfo, meta) {
    const successfulResults = new Map(preservedResults.map((result) => [result.flow_id, result]));
    const failedFlowIds = new Set();
    const attemptedFlowIds = new Set();
    for (const attempt of attempts) {
        const flowId = String(attempt.flow.id ?? "").trim();
        if (!flowId) {
            continue;
        }
        attemptedFlowIds.add(flowId);
        if (attempt.ok && attempt.response) {
            successfulResults.set(flowId, {
                flow_id: flowId,
                response: klona(attempt.response),
            });
            failedFlowIds.delete(flowId);
        }
        else {
            successfulResults.delete(flowId);
            failedFlowIds.add(flowId);
        }
    }
    return {
        at: Date.now(),
        request_id: requestId,
        swipe_id: versionInfo?.swipe_id,
        content_hash: versionInfo?.content_hash,
        attempted_flow_ids: [...attemptedFlowIds],
        successful_results: [...successfulResults.values()],
        successful_flow_ids: [...successfulResults.keys()],
        failed_flow_ids: [...failedFlowIds],
        workflow_failed: workflowFailed,
        execution_status: meta?.execution_status ?? "executed",
        skip_reason: meta?.skip_reason?.trim()
            ? meta.skip_reason.trim()
            : undefined,
    };
}
async function buildPreservedDispatchResults(settings, preservedResults) {
    if (preservedResults.length === 0) {
        return [];
    }
    const effectiveFlows = await getEffectiveFlows(settings);
    const flowOrderById = new Map(effectiveFlows.map((flow, index) => [flow.id, index]));
    const flowById = new Map(effectiveFlows.map((flow) => [flow.id, flow]));
    return preservedResults
        .map((result) => {
        const flow = flowById.get(result.flow_id);
        if (!flow) {
            return null;
        }
        return {
            flow,
            flow_order: flowOrderById.get(result.flow_id) ?? 0,
            response: result.response,
        };
    })
        .filter((result) => Boolean(result));
}
function createProcessingReminder(onAbort) {
    let state = {
        title: "Evolution World",
        message: "正在读取上下文并处理本轮工作流，请稍后…",
        level: "info",
        persist: true,
        busy: true,
        collapse_after_ms: WORKFLOW_NOTICE_COLLAPSE_MS,
        island: {},
        action: {
            label: "终止处理",
            kind: "danger",
            onClick: onAbort,
        },
    };
    const handle = showManagedWorkflowNotice(state);
    const update = (next) => {
        state = {
            ...state,
            ...next,
            island: {
                ...(state.island ?? {}),
                ...(next.island ?? {}),
            },
        };
        handle.update(state);
    };
    return {
        update,
        dismiss: handle.dismiss,
        collapse: handle.collapse,
        expand: handle.expand,
    };
}
function setSendTextareaValue(text) {
    const textarea = getChatDocument().getElementById("send_textarea");
    if (!textarea) {
        return;
    }
    textarea.value = text;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
}
function restoreOriginalGenerateInput(options, userInput) {
    if (Array.isArray(options.injects) &&
        options.injects[0] &&
        typeof options.injects[0] === "object") {
        options.injects[0].content = userInput;
        return;
    }
    if (typeof options.prompt === "string") {
        options.prompt = userInput;
        return;
    }
    options.user_input = userInput;
}
function shouldReleaseInterceptedMessage(settings, outcome) {
    if (outcome.abortedByUser) {
        return false;
    }
    const policy = settings.intercept_release_policy ?? "success_only";
    if (policy === "never") {
        return false;
    }
    if (policy === "always") {
        return true;
    }
    return outcome.workflowSucceeded;
}
async function resolveFailedOnlyRerollTarget(settings, messageId) {
    const executionState = readFloorWorkflowExecution(messageId);
    if (!executionState) {
        return { ok: false, reason: "当前楼还没有可用的失败执行记录" };
    }
    if (executionState.failed_flow_ids.length === 0) {
        if (executionState.workflow_failed &&
            executionState.attempted_flow_ids.length > 0) {
            const effectiveFlows = await getEffectiveFlows(settings);
            const flowMap = new Map(effectiveFlows.map((flow) => [flow.id, flow]));
            const flowIds = executionState.attempted_flow_ids.filter((flowId) => flowMap.has(flowId));
            if (flowIds.length === 0) {
                return {
                    ok: false,
                    reason: "当前楼失败时涉及的工作流已被禁用或删除",
                };
            }
            return {
                ok: true,
                flowIds,
                preservedResults: [],
                fallbackToAll: true,
            };
        }
        return { ok: false, reason: "当前楼没有失败的工作流可供重跑" };
    }
    const effectiveFlows = await getEffectiveFlows(settings);
    const flowMap = new Map(effectiveFlows.map((flow) => [flow.id, flow]));
    const flowIds = executionState.failed_flow_ids.filter((flowId) => flowMap.has(flowId));
    if (flowIds.length === 0) {
        return { ok: false, reason: "当前楼记录中的失败工作流已被禁用或删除" };
    }
    return {
        ok: true,
        flowIds,
        preservedResults: executionState.successful_results.filter((result) => {
            return flowMap.has(result.flow_id) && !flowIds.includes(result.flow_id);
        }),
    };
}
function syncAfterReplyFailureQueue(options, executionState, workflowSucceeded) {
    if (options.trigger.timing !== "after_reply") {
        return;
    }
    const chatKey = getCurrentChatKey();
    const assistantMessageId = options.trigger.assistant_message_id ?? options.messageId;
    if (workflowSucceeded ||
        !executionState ||
        (!executionState.workflow_failed &&
            executionState.failed_flow_ids.length === 0)) {
        removeFailedAfterReplyJob(chatKey, assistantMessageId);
        return;
    }
    upsertFailedAfterReplyJob({
        chat_key: chatKey,
        message_id: assistantMessageId,
        user_message_id: Number.isFinite(options.trigger.user_message_id)
            ? Number(options.trigger.user_message_id)
            : undefined,
        user_input: String(options.userInput ?? ""),
        generation_type: options.trigger.generation_type,
        failed_at: executionState.at || Date.now(),
    });
}
async function rollbackInterceptedUserMessage(messageId, userInput, generationType) {
    if (messageId == null || NON_SEND_GENERATION_TYPES.has(generationType)) {
        return;
    }
    if (messageId !== getLastMessageId()) {
        return;
    }
    const message = getChatMessages(messageId)[0];
    const messageText = String(message?.message ?? "").trim();
    if (!message || message.role !== "user") {
        return;
    }
    if (userInput.trim() && messageText !== userInput.trim()) {
        return;
    }
    try {
        const ctx = getSTContext();
        if (typeof ctx.deleteLastMessage === "function") {
            await ctx.deleteLastMessage();
            clearAfterReplyPending();
            return;
        }
    }
    catch (error) {
        console.warn("[Evolution World] Failed to rollback intercepted user message:", error);
    }
}
// ---------------------------------------------------------------------------
// Per-flow timing gate (fast sync check).
// Returns true if there are potentially matching flows for the given timing.
// This only checks global flows as a fast-path; char-flows are filtered by
// the pipeline's timing_filter after getEffectiveFlows().
// ---------------------------------------------------------------------------
function hasFlowsForTiming(settings, timing) {
    // Fast path: any global flow explicitly or effectively matches
    const globalMatch = settings.flows.some((f) => {
        if (!f.enabled)
            return false;
        const effective = f.timing === "default" ? settings.workflow_timing : f.timing;
        return effective === timing;
    });
    if (globalMatch)
        return true;
    // Fallback: if the global default equals the requested timing,
    // char-flows with timing:'default' would resolve to it — proceed
    // and let the pipeline's timing_filter do the authoritative check.
    return settings.workflow_timing === timing;
}
// ---------------------------------------------------------------------------
// Shared workflow execution with failure-policy handling.
// Both the TavernHelper hook and GENERATION_AFTER_COMMANDS fallback call this.
// ---------------------------------------------------------------------------
async function executeWorkflowWithPolicy(settings, options) {
    // Returns the workflow outcome so the primary interception path can decide
    // whether the original user message should be released after EW processing.
    // Apply incremental hide check before workflow so AI context is up-to-date
    try {
        runIncrementalHideCheck(settings.hide_settings);
    }
    catch (e) {
        console.warn("[Evolution World] Hide check failed:", e);
    }
    const workflowAbortController = new AbortController();
    let abortedByUser = false;
    const buildAbortableReminder = (message, level = "info") => ({
        title: "Evolution World",
        message,
        level,
        persist: true,
        busy: true,
        action: {
            label: "终止处理",
            kind: "danger",
            onClick: cancelWorkflow,
        },
    });
    const cancelWorkflow = () => {
        if (abortedByUser) {
            return;
        }
        abortedByUser = true;
        workflowAbortController.abort();
        stopGenerationNow();
        processingReminder.update({
            title: "Evolution World",
            message: "正在终止本轮处理，请稍后…",
            level: "warning",
            persist: true,
            busy: true,
            action: undefined,
        });
    };
    const processingReminder = createProcessingReminder(cancelWorkflow);
    processingReminder.update(buildAbortableReminder(options.reminderMessage));
    let reminderSettled = false;
    let currentPreservedStoredResults = [...(options.preservedResults ?? [])];
    let currentPreservedDispatchResults = await buildPreservedDispatchResults(settings, currentPreservedStoredResults);
    let currentFlowIds = options.flowIds;
    const trimPreview = (text, maxLength) => {
        const normalized = String(text ?? "")
            .replace(/\s+/g, " ")
            .trim();
        if (normalized.length <= maxLength) {
            return normalized;
        }
        return `${normalized.slice(0, maxLength)}...`;
    };
    const activeFlows = new Map();
    let carouselIndex = 0;
    let carouselTimer = null;
    let totalFlowCount = 0;
    let completedFlowCount = 0;
    let failedFlowCount = 0;
    const buildFlowProgress = () => {
        if (totalFlowCount <= 0) {
            return undefined;
        }
        return {
            completed: completedFlowCount,
            total: totalFlowCount,
            failed: failedFlowCount,
        };
    };
    const getRotatedIsland = () => {
        const flows = [...activeFlows.values()].sort((a, b) => a.flow_order - b.flow_order);
        if (flows.length === 0) {
            return { extra_count: 0 };
        }
        const idx = carouselIndex % flows.length;
        const current = flows[idx];
        return {
            entry_name: current.entry_name,
            content: current.content,
            extra_count: Math.max(0, flows.length - 1),
        };
    };
    const startCarousel = () => {
        if (carouselTimer)
            return;
        carouselTimer = setInterval(() => {
            if (activeFlows.size > 1) {
                carouselIndex++;
                processingReminder.update({
                    island: getRotatedIsland(),
                });
            }
        }, 3000);
    };
    const stopCarousel = () => {
        if (carouselTimer) {
            clearInterval(carouselTimer);
            carouselTimer = null;
        }
    };
    const handleWorkflowProgress = (update) => {
        if (reminderSettled) {
            return;
        }
        switch (update.phase) {
            case "preparing":
                processingReminder.update({
                    message: update.message ?? options.reminderMessage,
                    level: "info",
                    persist: true,
                    busy: true,
                });
                break;
            case "dispatching":
                // extract total flow count from message (e.g. "已装载 3 条工作流")
                {
                    const match = update.message?.match(/装载\s*(\d+)\s*条/);
                    if (match) {
                        totalFlowCount = parseInt(match[1], 10);
                    }
                }
                processingReminder.update({
                    message: update.message ?? options.reminderMessage,
                    level: "info",
                    persist: true,
                    busy: true,
                    flow_progress: buildFlowProgress(),
                });
                break;
            case "merging":
            case "committing":
                // All flows complete — clear active flows
                completedFlowCount =
                    totalFlowCount > 0 ? totalFlowCount : activeFlows.size;
                activeFlows.clear();
                stopCarousel();
                processingReminder.update({
                    message: update.message ?? options.reminderMessage,
                    level: "info",
                    persist: true,
                    busy: true,
                    island: { extra_count: 0 },
                    flow_progress: buildFlowProgress(),
                });
                break;
            case "flow_started": {
                const flowId = update.flow_id ?? "";
                if (flowId) {
                    activeFlows.set(flowId, {
                        flow_id: flowId,
                        entry_name: update.flow_name?.trim() || undefined,
                        content: undefined,
                        flow_order: update.flow_order ?? 0,
                    });
                    if (activeFlows.size > 1) {
                        startCarousel();
                    }
                }
                processingReminder.update({
                    message: update.message ?? options.reminderMessage,
                    persist: true,
                    busy: true,
                    level: "info",
                    island: getRotatedIsland(),
                    workflow_name: update.flow_name?.trim() || undefined,
                    flow_progress: buildFlowProgress(),
                });
                break;
            }
            case "flow_finished": {
                const flowId = update.flow_id ?? "";
                if (flowId) {
                    activeFlows.delete(flowId);
                }
                completedFlowCount += 1;
                if (update.flow_ok === false) {
                    failedFlowCount += 1;
                }
                if (activeFlows.size <= 1) {
                    stopCarousel();
                }
                processingReminder.update({
                    message: update.message ?? options.reminderMessage,
                    persist: true,
                    busy: true,
                    level: update.flow_ok === false ? "warning" : "info",
                    island: getRotatedIsland(),
                    workflow_name: update.flow_name?.trim() || undefined,
                    flow_progress: buildFlowProgress(),
                });
                break;
            }
            case "streaming": {
                const flowId = update.flow_id ?? "";
                const previewName = trimPreview(update.stream_preview?.entry_name, 28);
                const previewContent = trimPreview(update.stream_preview?.content, 54);
                // Update the active flow's data
                if (flowId && activeFlows.has(flowId)) {
                    const flow = activeFlows.get(flowId);
                    flow.entry_name = previewName || flow.entry_name;
                    flow.content = previewContent || flow.content;
                }
                processingReminder.update({
                    message: update.flow_name?.trim()
                        ? `正在流式读取「${update.flow_name}」输出…`
                        : "正在流式读取工作流输出…",
                    persist: true,
                    busy: true,
                    level: "info",
                    island: getRotatedIsland(),
                    workflow_name: update.flow_name?.trim() || undefined,
                    flow_progress: buildFlowProgress(),
                });
                break;
            }
            case "completed":
                completedFlowCount =
                    totalFlowCount > 0 ? totalFlowCount : completedFlowCount;
                processingReminder.update({
                    message: update.message ?? options.successMessage,
                    persist: true,
                    busy: true,
                    level: "info",
                    island: { extra_count: 0 },
                    flow_progress: buildFlowProgress(),
                });
                break;
            case "failed":
            default:
                break;
        }
    };
    const finalizeUserAbort = () => {
        clearReplyInstruction();
        reminderSettled = true;
        stopCarousel();
        processingReminder.update({
            title: "Evolution World",
            message: "已终止本轮处理。",
            level: "warning",
            persist: false,
            busy: false,
            action: undefined,
            island: {
                entry_name: "",
                content: "",
                extra_count: 0,
            },
            collapse_after_ms: 0,
            duration_ms: 3500,
        });
        return {
            shouldAbortGeneration: true,
            workflowSucceeded: false,
            abortedByUser: true,
        };
    };
    let lastAfterReplyExecutionState = null;
    const runWorkflowAttempt = async () => {
        const nextResult = await runWorkflow({
            message_id: options.messageId,
            user_input: options.userInput,
            trigger: options.trigger,
            mode: options.jobType === "live_auto" ? "auto" : "manual",
            inject_reply: options.injectReply,
            flow_ids: currentFlowIds,
            timing_filter: options.timingFilter,
            preserved_results: currentPreservedDispatchResults,
            job_type: options.jobType ?? "live_auto",
            context_cursor: options.contextCursor,
            writeback_policy: options.writebackPolicy ?? "dual_diff_merge",
            rederive_options: options.rederiveOptions,
            abortSignal: workflowAbortController.signal,
            isCancelled: () => abortedByUser,
            onProgress: handleWorkflowProgress,
        });
        currentPreservedDispatchResults = mergePreservedDispatchResults(currentPreservedDispatchResults, collectSuccessfulDispatchResultsFromAttempts(nextResult.attempts));
        if (options.trigger.timing === "after_reply") {
            const assistantMessageId = options.trigger.assistant_message_id ?? options.messageId;
            const assistantMsg = getChatMessages(assistantMessageId)[0];
            const versionInfo = assistantMsg
                ? getMessageVersionInfo(assistantMsg)
                : undefined;
            const executionState = buildFloorWorkflowExecutionState(nextResult.request_id, nextResult.attempts, !nextResult.ok, currentPreservedStoredResults, versionInfo, {
                execution_status: nextResult.skipped ? "skipped" : "executed",
                skip_reason: nextResult.skipped ? nextResult.reason : undefined,
            });
            await writeFloorWorkflowExecution(assistantMessageId, executionState);
            lastAfterReplyExecutionState = executionState;
            if (!nextResult.skipped) {
                currentPreservedStoredResults = executionState.successful_results;
                currentPreservedDispatchResults = await buildPreservedDispatchResults(settings, currentPreservedStoredResults);
            }
        }
        return nextResult;
    };
    const waitForAutoRerollInterval = async (delayMs) => {
        const remainingDelayMs = Math.max(0, delayMs);
        if (remainingDelayMs <= 0) {
            return;
        }
        const deadline = Date.now() + remainingDelayMs;
        while (Date.now() < deadline) {
            if (abortedByUser || workflowAbortController.signal.aborted) {
                throw new Error("workflow cancelled by user");
            }
            await new Promise((resolve) => setTimeout(resolve, Math.min(200, deadline - Date.now())));
        }
    };
    let result;
    try {
        result = await runWorkflowAttempt();
    }
    catch (error) {
        if (abortedByUser) {
            return finalizeUserAbort();
        }
        processingReminder.dismiss();
        throw error;
    }
    if (abortedByUser) {
        return finalizeUserAbort();
    }
    if (result.skipped) {
        reminderSettled = true;
        stopCarousel();
        processingReminder.dismiss();
        return {
            shouldAbortGeneration: false,
            workflowSucceeded: true,
            abortedByUser: false,
        };
    }
    if (!result.ok) {
        const policy = settings.failure_policy ?? "stop_generation";
        const autoRerollMaxAttempts = Math.max(1, Math.trunc(Number(settings.auto_reroll_max_attempts ?? 1) || 1));
        const autoRerollIntervalMs = Math.max(0, Math.round((settings.auto_reroll_interval_seconds ?? 0) * 1000));
        let autoRerollCount = 0;
        let autoRerollSkippedReason = "";
        if (policy === "retry_once") {
            while (!result.ok && autoRerollCount < autoRerollMaxAttempts) {
                const rerollTarget = resolveAutoRerollTarget(result);
                if (!rerollTarget.ok) {
                    autoRerollSkippedReason = rerollTarget.reason;
                    console.warn(`[EW] auto reroll skipped: ${rerollTarget.reason}`);
                    break;
                }
                currentFlowIds = rerollTarget.flowIds;
                const nextAttemptNumber = autoRerollCount + 1;
                const retryMessageBase = buildFailureNoticeMessage(result.failure, result.reason, { retrying: true });
                const intervalHint = autoRerollIntervalMs > 0
                    ? `\n将在 ${settings.auto_reroll_interval_seconds} 秒后开始第 ${nextAttemptNumber} 次自动重roll。`
                    : `\n即将开始第 ${nextAttemptNumber} 次自动重roll。`;
                console.warn(`[EW] auto reroll: attempt ${nextAttemptNumber}/${autoRerollMaxAttempts} after failure.`, result.reason);
                processingReminder.update(buildAbortableReminder(`${retryMessageBase}${intervalHint}`, "warning"));
                toastr.warning(`工作流失败，准备进行第 ${nextAttemptNumber}/${autoRerollMaxAttempts} 次自动重roll: ${buildFailureToastMessage(result.failure, result.reason)}`, "Evolution World");
                try {
                    if (autoRerollIntervalMs > 0) {
                        await waitForAutoRerollInterval(autoRerollIntervalMs);
                    }
                    result = await runWorkflowAttempt();
                    autoRerollCount = nextAttemptNumber;
                }
                catch (error) {
                    if (abortedByUser) {
                        return finalizeUserAbort();
                    }
                    processingReminder.dismiss();
                    throw error;
                }
                if (abortedByUser) {
                    return finalizeUserAbort();
                }
            }
        }
        if (!result.ok) {
            const exhaustedAutoRerollSuffix = (() => {
                if (policy !== "retry_once") {
                    return "";
                }
                if (autoRerollSkippedReason) {
                    return `\n${autoRerollSkippedReason}`;
                }
                if (autoRerollCount > 0) {
                    return `\n已自动重roll ${autoRerollCount} 次，仍未成功。`;
                }
                return "";
            })();
            const displayReason = `${buildFailureNoticeMessage(result.failure, result.reason)}${exhaustedAutoRerollSuffix}`;
            const toastReason = `${buildFailureToastMessage(result.failure, result.reason)}${policy === "retry_once" && autoRerollCount > 0
                ? `（已自动重roll ${autoRerollCount} 次）`
                : ""}`;
            switch (policy) {
                case "continue_generation":
                    reminderSettled = true;
                    stopCarousel();
                    processingReminder.update({
                        title: "Evolution World",
                        message: buildFailureNoticeMessage(result.failure, result.reason, {
                            includeReleaseHint: true,
                        }),
                        level: "warning",
                        persist: false,
                        busy: false,
                        action: undefined,
                        collapse_after_ms: 0,
                        duration_ms: 5500,
                    });
                    toastr.warning(`工作流失败，原消息是否继续发送取决于放行策略: ${toastReason}`, "Evolution World");
                    break;
                case "allow_partial_success":
                case "notify_only":
                    reminderSettled = true;
                    stopCarousel();
                    processingReminder.update({
                        title: "Evolution World",
                        message: displayReason,
                        level: "warning",
                        persist: false,
                        busy: false,
                        action: undefined,
                        collapse_after_ms: 0,
                        duration_ms: 5500,
                    });
                    toastr.info(`工作流失败: ${toastReason}`, "Evolution World");
                    break;
                case "stop_generation":
                case "retry_once":
                default:
                    clearReplyInstruction();
                    reminderSettled = true;
                    stopCarousel();
                    processingReminder.update({
                        title: "Evolution World",
                        message: displayReason,
                        level: "error",
                        persist: false,
                        busy: false,
                        action: undefined,
                        collapse_after_ms: 0,
                        duration_ms: 5500,
                    });
                    stopGenerationNow();
                    toastr.error(`动态世界流程失败，本轮已中止: ${toastReason}`, "Evolution World");
                    return {
                        shouldAbortGeneration: true,
                        workflowSucceeded: false,
                        abortedByUser: false,
                    };
            }
            syncAfterReplyFailureQueue(options, lastAfterReplyExecutionState, false);
            return {
                shouldAbortGeneration: false,
                workflowSucceeded: false,
                abortedByUser: false,
            };
        }
    }
    {
        const capsuleMessageId = options.trigger.timing === "after_reply"
            ? Number(options.trigger.assistant_message_id ?? options.messageId)
            : Number(options.messageId);
        const capsuleMessage = getChatMessages(capsuleMessageId)[0];
        if (capsuleMessage) {
            const versionInfo = getMessageVersionInfo(capsuleMessage);
            const flowIds = _.uniq(result.attempts
                .map((attempt) => String(attempt.flow.id ?? "").trim())
                .filter(Boolean));
            const capsuleMode = options.rederiveOptions?.capsule_mode === "full"
                ? "full"
                : options.jobType === "historical_rederive"
                    ? "full"
                    : "light";
            const replayCapsule = {
                at: Date.now(),
                request_id: result.request_id,
                job_type: options.jobType ?? "live_auto",
                timing: options.trigger.timing,
                source: options.trigger.source,
                generation_type: options.trigger.generation_type,
                target_message_id: capsuleMessageId,
                target_version_key: versionInfo.version_key,
                target_role: capsuleMessage.role === "assistant"
                    ? "assistant"
                    : capsuleMessage.role === "user"
                        ? "user"
                        : "other",
                flow_ids: flowIds,
                flow_ids_hash: simpleHash(flowIds.join("|")),
                capsule_mode: capsuleMode,
                legacy_approx: Boolean(options.rederiveOptions?.legacy_approx),
            };
            if (capsuleMode === "full") {
                replayCapsule.assembled_messages = result.attempts.flatMap((attempt) => {
                    const assembled = attempt.request_debug?.assembled_messages;
                    if (!Array.isArray(assembled)) {
                        return [];
                    }
                    return assembled
                        .filter((item) => item && typeof item === "object" && !Array.isArray(item))
                        .map((item) => ({
                        role: String(item.role ?? ""),
                        content: String(item.content ?? ""),
                        name: typeof item.name === "string"
                            ? String(item.name)
                            : undefined,
                    }));
                });
                replayCapsule.request_preview = result.attempts
                    .map((attempt) => ({
                    flow_id: attempt.flow.id,
                    request_id: attempt.request?.request_id ?? "",
                    flow_name: attempt.flow.name,
                    flow_order: attempt.flow_order,
                }))
                    .slice(0, 20);
            }
            await writeWorkflowReplayCapsule(capsuleMessageId, replayCapsule, versionInfo);
        }
    }
    if (options.trigger.timing === "before_reply") {
        const sourceMessageId = Number(options.trigger.user_message_id ?? options.messageId);
        const userMessageId = Number(options.trigger.user_message_id ?? options.messageId);
        if (Number.isFinite(sourceMessageId) &&
            sourceMessageId >= 0 &&
            Number.isFinite(userMessageId) &&
            userMessageId >= 0) {
            setBeforeReplyBindingPending({
                request_id: result.request_id,
                user_message_id: userMessageId,
                source_message_id: sourceMessageId,
                generation_type: options.trigger.generation_type,
                window_ms: Math.max(settings.total_timeout_ms + 10000, settings.gate_ttl_ms, 600000),
            });
        }
        else {
            clearBeforeReplyBindingPending();
        }
    }
    if (options.trigger.timing === "after_reply") {
        const assistantMessageId = options.trigger.assistant_message_id ?? options.messageId;
        try {
            await pinMessageSnapshotToCurrentVersion(assistantMessageId);
            await pinFloorWorkflowExecutionToCurrentVersion(assistantMessageId, lastAfterReplyExecutionState);
        }
        catch (error) {
            console.warn("[Evolution World] Failed to pin after_reply artifacts to current visible version:", error);
        }
    }
    syncAfterReplyFailureQueue(options, lastAfterReplyExecutionState, true);
    reminderSettled = true;
    stopCarousel();
    processingReminder.update({
        title: "Evolution World",
        message: options.successMessage,
        level: "success",
        persist: false,
        busy: false,
        action: undefined,
        collapse_after_ms: 0,
        duration_ms: 4000,
    });
    return {
        shouldAbortGeneration: false,
        workflowSucceeded: true,
        abortedByUser: false,
    };
}
function hasPrimaryGenerateInterceptor() {
    return (typeof globalThis[EW_GENERATE_INTERCEPTOR_KEY] === "function");
}
async function runPrimaryBeforeReplyIntercept(_chat, _contextSize, abort, generationType) {
    const settings = getSettings();
    if (!settings.enabled ||
        getRuntimeState().is_processing ||
        !hasFlowsForTiming(settings, "before_reply")) {
        return;
    }
    const allowedTypes = new Set(["normal", "continue", "regenerate", "swipe"]);
    if (!allowedTypes.has(generationType) ||
        isQuietLike(generationType, undefined)) {
        return;
    }
    const textareaValue = getSendTextareaValue();
    if (!textareaValue.trim()) {
        const decision = shouldHandleGenerationAfter(generationType, undefined, false, settings);
        if (!decision.ok) {
            return;
        }
    }
    const userInput = resolvePrimaryWorkflowUserInput(generationType);
    const isNonSendType = NON_SEND_GENERATION_TYPES.has(generationType);
    if (!userInput.trim() && !isNonSendType) {
        return;
    }
    const messageId = getRuntimeState().last_send?.message_id ?? getLastMessageId();
    const pendingUserMessageId = getRuntimeState().last_send?.message_id ?? null;
    const identityKey = buildBeforeReplyIdentityKey(messageId, generationType, userInput);
    if (queuedBeforeReplyJobKeys.has(identityKey)) {
        console.debug(`[Evolution World] before_reply skipped in generate interceptor: duplicate in-flight (${identityKey})`);
        abort(true);
        return;
    }
    const lastTriggerAt = lastBeforeReplyTriggerByIdentityKey.get(identityKey) ?? 0;
    if (Date.now() - lastTriggerAt < MIN_BEFORE_REPLY_INTERVAL_MS) {
        console.debug(`[Evolution World] before_reply skipped in generate interceptor: identity-windowed dedup (${Date.now() - lastTriggerAt}ms, key=${identityKey})`);
        abort(true);
        return;
    }
    markIntercepted(userInput, {
        messageId,
        generationType,
    });
    queuedBeforeReplyJobKeys.add(identityKey);
    lastBeforeReplyTriggerByIdentityKey.set(identityKey, Date.now());
    let workflowOutcome = {
        shouldAbortGeneration: false,
        workflowSucceeded: false,
        abortedByUser: false,
    };
    try {
        workflowOutcome = await enqueueWorkflowJob("live_auto", `before_reply:generate_interceptor:${messageId}`, async () => {
            setProcessing(true);
            try {
                return await executeWorkflowWithPolicy(settings, {
                    messageId,
                    userInput,
                    injectReply: true,
                    timingFilter: "before_reply",
                    jobType: "live_auto",
                    trigger: {
                        timing: "before_reply",
                        source: "generate_interceptor",
                        generation_type: generationType,
                        user_message_id: getRuntimeState().last_send?.message_id,
                    },
                    reminderMessage: "正在读取上下文并处理本轮工作流，请稍后…",
                    successMessage: "动态世界流程处理完成，已更新本轮上下文。",
                });
            }
            finally {
                setProcessing(false);
                clearSendContextIfMatches(pendingUserMessageId, userInput);
            }
        });
    }
    catch (error) {
        console.error("[Evolution World] Error in generate interceptor:", error);
        clearReplyInstruction();
    }
    finally {
        queuedBeforeReplyJobKeys.delete(identityKey);
    }
    if (workflowOutcome.shouldAbortGeneration) {
        await rollbackInterceptedUserMessage(pendingUserMessageId, userInput, generationType);
        setSendTextareaValue(userInput);
        clearReplyInstruction();
        abort(true);
        return;
    }
    if (!shouldReleaseInterceptedMessage(settings, workflowOutcome)) {
        await rollbackInterceptedUserMessage(pendingUserMessageId, userInput, generationType);
        setSendTextareaValue(userInput);
        clearReplyInstruction();
        console.debug("[Evolution World] Original intercepted message was not released due to intercept_release_policy");
        abort(true);
        return;
    }
    setSendTextareaValue(userInput);
    recordUserSendIntent(userInput);
}
function installPrimaryGenerateInterceptor() {
    globalThis[EW_GENERATE_INTERCEPTOR_KEY] =
        runPrimaryBeforeReplyIntercept;
}
function uninstallPrimaryGenerateInterceptor() {
    delete globalThis[EW_GENERATE_INTERCEPTOR_KEY];
}
// ---------------------------------------------------------------------------
// Fallback path: GENERATION_AFTER_COMMANDS event
// ---------------------------------------------------------------------------
async function onGenerationAfterCommands(type, params, dryRun) {
    if (hasPrimaryGenerateInterceptor()) {
        return;
    }
    // Dedup check 1: already handled by TavernHelper hook
    if (params?._ew_processed) {
        console.debug("[Evolution World] GENERATION_AFTER_COMMANDS skipped: already processed by TavernHelper hook");
        return;
    }
    const settings = getSettings();
    if (!hasFlowsForTiming(settings, "before_reply")) {
        return;
    }
    const decision = shouldHandleGenerationAfter(type, params, dryRun, settings);
    if (!decision.ok) {
        return;
    }
    const messageId = getRuntimeState().last_send?.message_id ?? getLastMessageId();
    const genType = getRuntimeState().last_generation?.type ?? "";
    const userInput = resolveFallbackWorkflowUserInput(genType);
    const identityKey = buildBeforeReplyIdentityKey(messageId, genType || type, userInput);
    const isNonSendType = NON_SEND_GENERATION_TYPES.has(genType);
    if (!userInput.trim() && !isNonSendType) {
        console.debug("[Evolution World] skipped workflow: user input is empty");
        return;
    }
    if (queuedBeforeReplyJobKeys.has(identityKey)) {
        console.debug("[Evolution World] GENERATION_AFTER_COMMANDS skipped: duplicate before_reply job already in-flight");
        return;
    }
    const lastTriggerAt = lastBeforeReplyTriggerByIdentityKey.get(identityKey) ?? 0;
    if (Date.now() - lastTriggerAt < MIN_BEFORE_REPLY_INTERVAL_MS) {
        console.debug(`[Evolution World] GENERATION_AFTER_COMMANDS skipped: identity-windowed before_reply dedup (${Date.now() - lastTriggerAt}ms, key=${identityKey})`);
        return;
    }
    if (wasRecentlyIntercepted(userInput, {
        messageId,
        generationType: genType || type,
    })) {
        console.debug("[Evolution World] GENERATION_AFTER_COMMANDS skipped: recently intercepted by TavernHelper hook (hash match)");
        return;
    }
    console.debug("[Evolution World] GENERATION_AFTER_COMMANDS executing workflow (fallback path)");
    try {
        queuedBeforeReplyJobKeys.add(identityKey);
        lastBeforeReplyTriggerByIdentityKey.set(identityKey, Date.now());
        await enqueueWorkflowJob("live_auto", `before_reply:fallback:${messageId}`, async () => {
            setProcessing(true);
            try {
                await executeWorkflowWithPolicy(settings, {
                    messageId,
                    userInput,
                    injectReply: true,
                    timingFilter: "before_reply",
                    jobType: "live_auto",
                    trigger: {
                        timing: "before_reply",
                        source: "generation_after_commands",
                        generation_type: genType || type,
                        user_message_id: getRuntimeState().last_send?.message_id ?? messageId,
                    },
                    reminderMessage: "正在读取上下文并处理本轮工作流，请稍后…",
                    successMessage: "动态世界流程处理完成，已更新本轮上下文。",
                });
            }
            finally {
                clearSendContextIfMatches(messageId, userInput);
                setProcessing(false);
            }
        });
    }
    catch (error) {
        console.error("[Evolution World] GENERATION_AFTER_COMMANDS workflow failed:", error);
    }
    finally {
        queuedBeforeReplyJobKeys.delete(identityKey);
    }
}
function getMessageText(messageId) {
    try {
        const message = getChatMessages(messageId)[0];
        return String(message?.message ?? "");
    }
    catch {
        return "";
    }
}
function buildBeforeReplyIdentityKey(messageId, generationType, userInput) {
    const normalizedText = String(userInput ?? "")
        .replace(/\s+/g, " ")
        .trim();
    return `${getCurrentChatKey()}:before_reply:${messageId}:${generationType}:${simpleHash(normalizedText)}`;
}
function buildAfterReplyDedupKey(messageText, pendingUserMessageId) {
    const normalizedText = String(messageText ?? "")
        .replace(/\s+/g, " ")
        .trim();
    const contentHash = simpleHash(normalizedText);
    const userMessagePart = Number.isFinite(pendingUserMessageId)
        ? `user:${pendingUserMessageId}`
        : "user:unknown";
    return `${getCurrentChatKey()}:${userMessagePart}:${contentHash}`;
}
function buildAfterReplyIdentityKey(input) {
    const userMessagePart = Number.isFinite(input.pendingUserMessageId)
        ? `user:${input.pendingUserMessageId}`
        : "user:unknown";
    return `${input.chatKey}:assistant:${input.messageId}:gen:${Math.max(0, Math.trunc(input.generationSeq || 0))}:${userMessagePart}:${String(input.generationType || "normal").trim() || "normal"}`;
}
function isAssistantMessage(messageId) {
    try {
        const message = getChatMessages(messageId)[0];
        return message?.role === "assistant";
    }
    catch {
        return false;
    }
}
async function onAfterReplyMessage(messageId, type, source) {
    const settings = getSettings();
    pruneExpiredBeforeReplyBindingPending();
    if (!isAssistantMessage(messageId)) {
        return;
    }
    const messageText = getMessageText(messageId);
    if (!messageText.trim()) {
        return;
    }
    const runtimeState = getRuntimeState();
    const generationType = runtimeState.after_reply.pending_generation_type ||
        runtimeState.last_generation?.type ||
        type;
    const userInput = resolveAfterReplyUserInput();
    const pendingUserMessageId = runtimeState.after_reply.pending_user_message_id ??
        runtimeState.last_send?.message_id ??
        null;
    const pendingBeforeReplyBinding = pruneExpiredBeforeReplyBindingPending();
    const shouldAttemptBeforeReplyBindingMigration = Boolean(pendingBeforeReplyBinding &&
        !pendingBeforeReplyBinding.migrated &&
        Number.isFinite(pendingUserMessageId) &&
        pendingBeforeReplyBinding.user_message_id === pendingUserMessageId);
    const hasAfterReplyFlows = hasFlowsForTiming(settings, "after_reply");
    const decision = hasAfterReplyFlows
        ? shouldHandleAfterReply(messageId, type, settings)
        : { ok: false, reason: "after_reply_flows_disabled" };
    const shouldRunAfterReplyWorkflow = hasAfterReplyFlows &&
        decision.ok &&
        !wasAfterReplyHandled(messageId, messageText);
    if (!shouldRunAfterReplyWorkflow &&
        !shouldAttemptBeforeReplyBindingMigration) {
        return;
    }
    const chatKey = getCurrentChatKey();
    const generationSeq = getRuntimeState().after_reply.pending_generation_seq ||
        getRuntimeState().last_generation?.seq ||
        0;
    const queueKey = `${chatKey}:${messageId}`;
    const dedupKey = buildAfterReplyDedupKey(messageText, pendingUserMessageId);
    const identityKey = buildAfterReplyIdentityKey({
        chatKey,
        messageId,
        generationSeq,
        pendingUserMessageId,
        generationType: type,
    });
    if (queuedAfterReplyJobKeys.has(queueKey) ||
        queuedAfterReplyDedupKeys.has(dedupKey)) {
        console.debug(`[Evolution World] after_reply skipped as duplicate (${source}): ${dedupKey}`);
        return;
    }
    if (processedAfterReplyIdentityKeys.has(identityKey)) {
        console.debug(`[Evolution World] after_reply skipped: identity already processed (${source}, key=${identityKey})`);
        return;
    }
    const lastTriggerAt = lastAfterReplyTriggerByIdentityKey.get(identityKey) ?? 0;
    if (Date.now() - lastTriggerAt < MIN_AFTER_REPLY_INTERVAL_MS) {
        console.debug(`[Evolution World] after_reply skipped: identity-windowed dedup (${source}, ${Date.now() - lastTriggerAt}ms since last, key=${identityKey})`);
        return;
    }
    lastAfterReplyTriggerByIdentityKey.set(identityKey, Date.now());
    queuedAfterReplyJobKeys.add(queueKey);
    queuedAfterReplyDedupKeys.add(dedupKey);
    await enqueueWorkflowJob("live_auto", `after_reply:${messageId}`, async () => {
        setProcessing(true);
        try {
            if (shouldAttemptBeforeReplyBindingMigration) {
                const bindingMigration = await migrateBeforeReplyBindingToAssistant(settings, messageId, pendingUserMessageId);
                if (bindingMigration.migrated) {
                    console.info(`[Evolution World] before_reply binding migrated to assistant floor #${messageId} (snapshot=${bindingMigration.snapshot_migrated}, execution=${bindingMigration.execution_migrated})`);
                }
            }
            if (!shouldRunAfterReplyWorkflow) {
                return;
            }
            await executeWorkflowWithPolicy(settings, {
                messageId,
                userInput,
                injectReply: false,
                timingFilter: "after_reply",
                jobType: "live_auto",
                trigger: appendTriggerMessageIds({
                    timing: "after_reply",
                    source,
                    generation_type: generationType,
                }, {
                    userMessageId: pendingUserMessageId,
                    assistantMessageId: messageId,
                }),
                reminderMessage: "正在根据最新回复更新动态世界，请稍后…",
                successMessage: "动态世界已根据最新回复完成更新。",
            });
            markAfterReplyHandled(messageId, messageText);
        }
        finally {
            processedAfterReplyIdentityKeys.add(identityKey);
            clearAfterReplyPendingIfMatches(pendingUserMessageId);
            clearSendContextIfMatches(pendingUserMessageId, userInput);
            queuedAfterReplyJobKeys.delete(queueKey);
            queuedAfterReplyDedupKeys.delete(dedupKey);
            setProcessing(false);
        }
    });
}
function isBeforeReplyMigrationSettled(reason) {
    return (reason === "binding_meta_repaired" ||
        reason === "already_migrated" ||
        reason === "target_artifacts_present");
}
function shouldWarnBeforeReplyMigration(input) {
    const { artifactMigration, capsuleMigration } = input;
    if (artifactMigration.migrated || capsuleMigration.migrated) {
        return false;
    }
    if (!artifactMigration.reason) {
        return false;
    }
    if (artifactMigration.reason === "no_source_artifacts") {
        return false;
    }
    return !isBeforeReplyMigrationSettled(artifactMigration.reason);
}
function settleBeforeReplyMigration(input) {
    const settled = input.artifactMigration.migrated ||
        input.capsuleMigration.migrated ||
        isBeforeReplyMigrationSettled(input.artifactMigration.reason);
    if (settled && input.markPending) {
        markBeforeReplyBindingMigrated(input.assistantMessageId);
    }
    return settled;
}
function getCurrentChatKey() {
    return String(getSTContext()?.chatId ?? "").trim();
}
function appendTriggerMessageIds(trigger, ids) {
    const userMessageId = ids.userMessageId;
    if (typeof userMessageId === "number" && Number.isFinite(userMessageId)) {
        trigger.user_message_id = userMessageId;
    }
    const assistantMessageId = ids.assistantMessageId;
    if (typeof assistantMessageId === "number" &&
        Number.isFinite(assistantMessageId)) {
        trigger.assistant_message_id = assistantMessageId;
    }
    return trigger;
}
function resolveBeforeReplyPair(messageId) {
    const message = getChatMessages(messageId)[0];
    if (!message) {
        return { source_message_id: messageId };
    }
    const bindingMeta = message.data?.[EW_BEFORE_REPLY_BINDING_KEY];
    const role = typeof bindingMeta?.role === "string" ? String(bindingMeta.role) : "";
    const paired = Number(bindingMeta?.paired_message_id);
    const pairedMessageId = Number.isFinite(paired) ? paired : undefined;
    if (message.role === "assistant") {
        if (role === "assistant_anchor" && Number.isFinite(pairedMessageId)) {
            return {
                source_message_id: Number(pairedMessageId),
                assistant_message_id: messageId,
            };
        }
        return { source_message_id: messageId, assistant_message_id: messageId };
    }
    if (message.role === "user") {
        if (role === "source" && Number.isFinite(pairedMessageId)) {
            return {
                source_message_id: messageId,
                assistant_message_id: Number(pairedMessageId),
            };
        }
        const nextMessage = getChatMessages(messageId + 1)[0];
        if (nextMessage?.role === "assistant") {
            return {
                source_message_id: messageId,
                assistant_message_id: Number(nextMessage.message_id),
            };
        }
    }
    return { source_message_id: messageId };
}
function resolveAssistantSourceUserMessageId(messageId) {
    const pair = resolveBeforeReplyPair(messageId);
    if (Number.isFinite(pair.assistant_message_id) &&
        Number(pair.assistant_message_id) === messageId) {
        return Number.isFinite(pair.source_message_id)
            ? Number(pair.source_message_id)
            : null;
    }
    const previousMessage = getChatMessages(messageId - 1)[0];
    if (previousMessage?.role === "user") {
        return Number(previousMessage.message_id);
    }
    return null;
}
async function writeRederiveMeta(messageId, meta) {
    const message = getChatMessages(messageId)[0];
    if (!message) {
        return;
    }
    const nextData = {
        ...(message.data ?? {}),
        [EW_REDERIVE_META_KEY]: {
            ...meta,
            updated_at: Date.now(),
        },
    };
    await setChatMessages([{ message_id: messageId, data: nextData }], {
        refresh: "none",
    });
}
export async function rederiveWorkflowAtFloor(input) {
    const settings = getSettings();
    if (!settings.enabled) {
        return { ok: false, reason: "workflow disabled" };
    }
    const sourceMessageId = Number(input.message_id);
    if (!Number.isFinite(sourceMessageId) || sourceMessageId < 0) {
        return { ok: false, reason: "invalid target floor" };
    }
    const sourceMessage = getChatMessages(sourceMessageId)[0];
    if (!sourceMessage) {
        return { ok: false, reason: "target floor not found" };
    }
    const timing = input.timing;
    const pair = timing === "before_reply"
        ? resolveBeforeReplyPair(sourceMessageId)
        : { source_message_id: sourceMessageId };
    const assistantMessageId = pair.assistant_message_id;
    const beforeReplySourceMessageId = pair.source_message_id;
    const anchorMessageId = timing === "before_reply" && Number.isFinite(assistantMessageId)
        ? Number(assistantMessageId)
        : sourceMessageId;
    const anchorMessage = getChatMessages(anchorMessageId)[0];
    if (!anchorMessage) {
        return { ok: false, reason: "anchor floor not found" };
    }
    const hasCapsule = (await hasWorkflowReplayCapsuleComplete(anchorMessageId)) ||
        (Number.isFinite(beforeReplySourceMessageId) &&
            (await hasWorkflowReplayCapsuleComplete(beforeReplySourceMessageId)));
    if (!hasCapsule && !input.confirm_legacy) {
        return { ok: false, reason: "legacy_confirmation_required" };
    }
    const legacyApprox = !hasCapsule;
    const targetVersionInfo = getMessageVersionInfo(anchorMessage);
    const contextCursor = {
        chat_id: getCurrentChatKey(),
        target_message_id: timing === "before_reply" ? beforeReplySourceMessageId : anchorMessageId,
        target_role: timing === "before_reply"
            ? "user"
            : anchorMessage.role === "assistant"
                ? "assistant"
                : anchorMessage.role === "user"
                    ? "user"
                    : "other",
        target_version_key: String(input.target_version_key ?? targetVersionInfo.version_key),
        timing,
        source_user_message_id: timing === "before_reply" ? beforeReplySourceMessageId : undefined,
        assistant_message_id: timing === "before_reply" ? assistantMessageId : anchorMessageId,
        capsule_mode: input.capsule_mode === "light" ? "light" : "full",
    };
    const oldSnapshotRead = await readFloorSnapshotByMessageId(anchorMessageId, "history");
    const oldSnapshot = oldSnapshotRead?.snapshot ?? null;
    const sourceUserText = String(getChatMessages(beforeReplySourceMessageId)[0]?.message ?? "");
    const afterReplySourceUserMessageId = timing === "after_reply"
        ? resolveAssistantSourceUserMessageId(anchorMessageId)
        : null;
    const afterReplySourceUserText = String(Number.isFinite(afterReplySourceUserMessageId)
        ? (getChatMessages(Number(afterReplySourceUserMessageId))[0]?.message ??
            "")
        : "");
    const userInput = timing === "before_reply"
        ? sourceUserText
        : timing === "after_reply"
            ? afterReplySourceUserText || getMessageText(anchorMessageId)
            : sourceUserText || getMessageText(sourceMessageId);
    try {
        setProcessing(true);
        const executionOutcome = await executeWorkflowWithPolicy(settings, {
            messageId: timing === "before_reply"
                ? beforeReplySourceMessageId
                : anchorMessageId,
            userInput,
            injectReply: false,
            timingFilter: timing === "manual" ? undefined : timing,
            jobType: "historical_rederive",
            contextCursor,
            writebackPolicy: "dual_diff_merge",
            rederiveOptions: {
                legacy_approx: legacyApprox,
                capsule_mode: contextCursor.capsule_mode,
            },
            trigger: appendTriggerMessageIds({
                timing,
                source: "history_rederive",
                generation_type: getRuntimeState().last_generation?.type || "manual",
            }, {
                userMessageId: timing === "before_reply"
                    ? beforeReplySourceMessageId
                    : timing === "after_reply"
                        ? afterReplySourceUserMessageId
                        : undefined,
                assistantMessageId: timing === "before_reply"
                    ? assistantMessageId
                    : anchorMessage.role === "assistant"
                        ? anchorMessageId
                        : undefined,
            }),
            reminderMessage: "正在重推导历史楼层工作流并重建快照，请稍后…",
            successMessage: "历史楼层重推导与快照重建已完成。",
        });
        if (!executionOutcome.workflowSucceeded) {
            return {
                ok: false,
                reason: executionOutcome.abortedByUser
                    ? "workflow cancelled by user"
                    : "workflow failed",
            };
        }
        if (timing === "before_reply" &&
            Number.isFinite(assistantMessageId) &&
            Number.isFinite(beforeReplySourceMessageId) &&
            beforeReplySourceMessageId !== assistantMessageId) {
            const rederiveRequestId = `rederive:${Date.now().toString(36)}`;
            const artifactMigration = await migrateBeforeReplyArtifactsToAssistant(settings, beforeReplySourceMessageId, Number(assistantMessageId), rederiveRequestId);
            const capsuleMigration = await migrateFloorWorkflowCapsuleToAssistant(beforeReplySourceMessageId, Number(assistantMessageId));
            const migrationSettled = settleBeforeReplyMigration({
                assistantMessageId: Number(assistantMessageId),
                artifactMigration,
                capsuleMigration,
                markPending: false,
            });
            if (!migrationSettled &&
                shouldWarnBeforeReplyMigration({
                    artifactMigration,
                    capsuleMigration,
                })) {
                console.warn("[Evolution World] before_reply rederive migration did not complete:", artifactMigration);
            }
        }
        const newSnapshotRead = await readFloorSnapshotByMessageId(anchorMessageId, "history");
        const newSnapshot = newSnapshotRead?.snapshot ?? null;
        const writebackResult = await applySnapshotDiffToCurrentWorldbook(settings, oldSnapshot, newSnapshot);
        await writeRederiveMeta(anchorMessageId, {
            source_job: "historical_rederive",
            legacy_approx: legacyApprox,
            timing,
            conflicts: writebackResult.conflicts,
            conflict_names: writebackResult.conflict_names,
            writeback_applied: writebackResult.applied,
            writeback_ok: true,
        });
        return {
            ok: true,
            result: {
                message_id: sourceMessageId,
                anchor_message_id: anchorMessageId,
                legacy_approx: legacyApprox,
                writeback_applied: writebackResult.applied,
                writeback_conflicts: writebackResult.conflicts,
                writeback_conflict_names: writebackResult.conflict_names,
            },
        };
    }
    catch (error) {
        return {
            ok: false,
            reason: error instanceof Error ? error.message : String(error),
        };
    }
    finally {
        setProcessing(false);
    }
}
export async function rerollCurrentAfterReplyWorkflow() {
    const settings = getSettings();
    if (!hasFlowsForTiming(settings, "after_reply")) {
        return { ok: false, reason: "no flows configured for after_reply timing" };
    }
    if (!settings.enabled) {
        return { ok: false, reason: "workflow disabled" };
    }
    if (getRuntimeState().is_processing) {
        return { ok: false, reason: "workflow already processing" };
    }
    const messageId = getLastMessageId();
    if (!Number.isFinite(messageId) || messageId < 0) {
        return { ok: false, reason: "no current floor found" };
    }
    if (!isAssistantMessage(messageId)) {
        return { ok: false, reason: "current floor is not an assistant reply" };
    }
    const messageText = getMessageText(messageId);
    if (!messageText.trim()) {
        return { ok: false, reason: "current assistant reply is empty" };
    }
    const runtimeState = getRuntimeState();
    const generationType = runtimeState.last_generation?.type || "manual";
    const userInput = resolveAfterReplyUserInput();
    const rerollScope = settings.reroll_scope ?? "all";
    if (rerollScope === "queued_failed") {
        return rerollQueuedFailedAfterReplyWorkflows(settings);
    }
    let flowIds;
    let preservedResults = [];
    let failedOnlyFallbackToAll = false;
    if (rerollScope === "failed_only") {
        const resolved = await resolveFailedOnlyRerollTarget(settings, messageId);
        if (!resolved.ok) {
            return { ok: false, reason: resolved.reason };
        }
        flowIds = resolved.flowIds;
        preservedResults = resolved.preservedResults;
        failedOnlyFallbackToAll = Boolean(resolved.fallbackToAll);
    }
    try {
        const outcome = await enqueueWorkflowJob("live_reroll", `reroll_after_reply:${messageId}`, async () => {
            setProcessing(true);
            try {
                if (settings.floor_binding_enabled) {
                    await rollbackBeforeFloor(settings, messageId);
                }
                return await executeWorkflowWithPolicy(settings, {
                    messageId,
                    userInput,
                    injectReply: false,
                    flowIds,
                    timingFilter: "after_reply",
                    preservedResults,
                    jobType: "live_reroll",
                    trigger: appendTriggerMessageIds({
                        timing: "after_reply",
                        source: "fab_double_click",
                        generation_type: generationType,
                    }, {
                        userMessageId: runtimeState.after_reply.pending_user_message_id ??
                            runtimeState.last_send?.message_id,
                        assistantMessageId: messageId,
                    }),
                    reminderMessage: rerollScope === "failed_only" && flowIds?.length
                        ? failedOnlyFallbackToAll
                            ? `当前楼上次失败发生在合并或写回阶段，正在回退重跑该楼关联的 ${flowIds.length} 条工作流，请稍后…`
                            : `正在重跑当前楼失败的 ${flowIds.length} 条工作流，请稍后…`
                        : "正在重跑当前楼的回复后工作流，请稍后…",
                    successMessage: rerollScope === "failed_only" && flowIds?.length
                        ? failedOnlyFallbackToAll
                            ? "当前楼因整轮失败而回退重跑的工作流已完成。"
                            : "当前楼失败的工作流已重跑完成。"
                        : "当前楼的动态世界工作流已重跑完成。",
                });
            }
            finally {
                setProcessing(false);
            }
        });
        if (outcome.workflowSucceeded) {
            markAfterReplyHandled(messageId, messageText);
            return { ok: true };
        }
        if (outcome.abortedByUser) {
            return { ok: false, reason: "workflow cancelled by user" };
        }
        return { ok: false, reason: "workflow failed" };
    }
    catch (error) {
        return {
            ok: false,
            reason: error instanceof Error ? error.message : String(error),
        };
    }
}
async function rerollQueuedFailedAfterReplyWorkflows(settings) {
    const chatKey = getCurrentChatKey();
    const jobs = getFailedAfterReplyJobs(chatKey);
    if (jobs.length === 0) {
        return { ok: false, reason: "当前聊天没有失败队列可供重跑" };
    }
    try {
        const outcome = await enqueueWorkflowJob("live_reroll", `reroll_failed_queue:${chatKey}`, async () => {
            setProcessing(true);
            try {
                let retriedCount = 0;
                let successCount = 0;
                let failedCount = 0;
                let skippedCount = 0;
                for (let index = 0; index < jobs.length; index += 1) {
                    const job = jobs[index];
                    const resolved = await resolveFailedOnlyRerollTarget(settings, job.message_id);
                    if (!resolved.ok) {
                        removeFailedAfterReplyJob(chatKey, job.message_id);
                        skippedCount += 1;
                        continue;
                    }
                    retriedCount += 1;
                    if (settings.floor_binding_enabled) {
                        await rollbackBeforeFloor(settings, job.message_id);
                    }
                    const outcome = await executeWorkflowWithPolicy(settings, {
                        messageId: job.message_id,
                        userInput: job.user_input,
                        injectReply: false,
                        flowIds: resolved.flowIds,
                        timingFilter: "after_reply",
                        preservedResults: resolved.preservedResults,
                        jobType: "live_reroll",
                        trigger: {
                            timing: "after_reply",
                            source: "queued_failed_reroll",
                            generation_type: job.generation_type,
                            user_message_id: Number.isFinite(job.user_message_id)
                                ? Number(job.user_message_id)
                                : undefined,
                            assistant_message_id: job.message_id,
                        },
                        reminderMessage: `正在重跑失败队列 ${index + 1}/${jobs.length}，请稍后…`,
                        successMessage: `失败队列 ${index + 1}/${jobs.length} 已处理完成。`,
                    });
                    if (outcome.abortedByUser) {
                        return {
                            ok: false,
                            reason: `已终止失败队列重跑，已完成 ${successCount}/${retriedCount} 条。`,
                        };
                    }
                    if (outcome.workflowSucceeded) {
                        const queuedMessageText = getMessageText(job.message_id);
                        if (queuedMessageText.trim()) {
                            markAfterReplyHandled(job.message_id, queuedMessageText);
                        }
                        successCount += 1;
                    }
                    else {
                        failedCount += 1;
                    }
                }
                if (retriedCount === 0) {
                    return {
                        ok: false,
                        reason: "失败队列中的楼层记录已失效，已自动清理。",
                    };
                }
                if (failedCount > 0) {
                    return {
                        ok: false,
                        reason: `失败队列已重跑 ${retriedCount} 条，其中 ${successCount} 条成功，${failedCount} 条仍失败${skippedCount > 0 ? `，${skippedCount} 条已跳过` : ""}。`,
                    };
                }
                return {
                    ok: true,
                    reason: skippedCount > 0
                        ? `失败队列已重跑完成，共成功 ${successCount} 条，另有 ${skippedCount} 条失效记录已跳过。`
                        : `失败队列已重跑完成，共成功 ${successCount} 条。`,
                };
            }
            finally {
                setProcessing(false);
            }
        });
        return outcome;
    }
    catch (error) {
        return {
            ok: false,
            reason: error instanceof Error ? error.message : String(error),
        };
    }
}
export function initRuntimeEvents() {
    const eventTypes = getEventTypes();
    const hostWindow = globalThis;
    if (runtimeEventsInitialized || hostWindow.__ewRuntimeEventsInitialized) {
        return;
    }
    runtimeEventsInitialized = true;
    hostWindow.__ewRuntimeEventsInitialized = true;
    installPrimaryGenerateInterceptor();
    installSendIntentHooks();
    listenerStops.push(onSTEvent(eventTypes.MESSAGE_SENT, (messageId) => {
        const msg = getChatMessages(messageId)[0];
        if (!msg || msg.role !== "user") {
            return;
        }
        recordUserSend(messageId, msg.message ?? "");
    }));
    listenerStops.push(onSTEvent(eventTypes.GENERATION_STARTED, (type, params, dryRun) => {
        recordGeneration(type, params ?? {}, dryRun);
    }));
    listenerStops.push(onSTEvent(eventTypes.MESSAGE_RECEIVED, async (messageId, type) => {
        scheduleHideSettingsApply(getSettings().hide_settings, 120);
        await onAfterReplyMessage(messageId, type, "message_received");
    }));
    listenerStops.push(onSTEvent(eventTypes.GENERATION_ENDED, async (messageId) => {
        scheduleHideSettingsApply(getSettings().hide_settings, 180);
        const type = getRuntimeState().last_generation?.type ?? "normal";
        await onAfterReplyMessage(messageId, type, "generation_ended");
    }));
    // Primary path: GENERATION_AFTER_COMMANDS (ST 扩展中不再需要 TavernHelper hook)
    listenerStops.push(registerGenerationAfterCommands(async (type, params, dryRun) => {
        await onGenerationAfterCommands(type, params ?? {}, dryRun);
    }));
    listenerStops.push(onSTEvent(eventTypes.CHAT_CHANGED, () => {
        clearQueuedWorkflowTasks("workflow queue cleared because chat changed");
        resetRuntimeState();
        resetInterceptGuard();
        resetHideState();
        scheduleHideSettingsApply(getSettings().hide_settings, 360);
        setTimeout(() => {
            installSendIntentHooks();
            installPrimaryGenerateInterceptor();
        }, 300);
    }));
    // Initialize floor binding event listeners for automatic cleanup.
    initFloorBindingEvents(getSettings);
}
export function disposeRuntimeEvents() {
    runtimeEventsInitialized = false;
    delete globalThis.__ewRuntimeEventsInitialized;
    clearQueuedWorkflowTasks("runtime events disposed");
    for (const stop of listenerStops.splice(0, listenerStops.length)) {
        stop();
    }
    for (const cleanup of domCleanup.splice(0, domCleanup.length)) {
        cleanup();
    }
    if (sendIntentRetryTimer) {
        clearTimeout(sendIntentRetryTimer);
        sendIntentRetryTimer = null;
    }
    uninstallPrimaryGenerateInterceptor();
    resetInterceptGuard();
    disposeFloorBindingEvents();
}
//# sourceMappingURL=events.js.map