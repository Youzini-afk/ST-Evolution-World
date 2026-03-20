import { clearCharFlowDraft, readCharFlowDraft, readCharFlows, writeCharFlowDraft, writeCharFlows, } from "../runtime/char-flows";
import { getChatMessages, getCurrentCharacterName, getLastMessageId, } from "../runtime/compat/character";
import { createDefaultApiPreset, createDefaultFlow } from "../runtime/factory";
import { collectAllFloorSnapshots, collectLatestSnapshots, rollbackToFloor, } from "../runtime/floor-binding";
import { runWorkflow } from "../runtime/pipeline";
import { previewPrompt, } from "../runtime/prompt-assembler";
import { getLastIo, getLastRun, getSettings, loadLastIo, loadLastIoForChat, loadLastRun, loadLastRunForChat, patchSettings, persistSettingsDraft, replaceSettings, subscribeLastIo, subscribeLastRun, subscribeSettings, } from "../runtime/settings";
import { EwFlowConfigSchema, EwSettingsSchema, } from "../runtime/types";
import { convertStPresetToFlow, isSillyTavernPreset } from "./convertStPreset";
import { showEwNotice } from "./notice";
export const useEwStore = defineStore("evolution-world-store", () => {
    const settings = ref(getSettings());
    const lastRun = ref(getLastRun());
    const lastIo = ref(getLastIo());
    const activeTab = ref("overview");
    const globalAdvancedOpen = ref(false);
    const expandedApiPresetId = ref(null);
    const expandedFlowId = ref(null);
    const importText = ref("");
    const busy = ref(false);
    const charFlows = ref([]);
    const activeCharName = ref("");
    const flowScope = ref("global");
    const charFlowsLoading = ref(false);
    let suppressCharFlowDraftPersist = false;
    let charFlowRefreshTimer = null;
    const promptPreview = ref(null);
    const snapshotPreview = ref(null);
    const previewFlowId = ref("");
    const floorSnapshots = ref([]);
    const selectedFloorId = ref(null);
    const compareFloorId = ref(null);
    let suppressPersist = false;
    let persistTimeoutId = null;
    let persistIdleId = null;
    function getHostRuntime() {
        try {
            if (window.parent && window.parent !== window) {
                return window.parent;
            }
        }
        catch {
            // ignore
        }
        return window;
    }
    function getCurrentChatIdSafe() {
        try {
            const hostRuntime = getHostRuntime();
            const sillyTavern = hostRuntime.SillyTavern ??
                globalThis.SillyTavern;
            return String(sillyTavern?.getCurrentChatId?.() ?? sillyTavern?.chatId ?? "").trim();
        }
        catch {
            return "";
        }
    }
    function clearScheduledPersist() {
        if (persistTimeoutId !== null) {
            window.clearTimeout(persistTimeoutId);
            persistTimeoutId = null;
        }
        if (persistIdleId !== null &&
            typeof window.cancelIdleCallback === "function") {
            window.cancelIdleCallback(persistIdleId);
            persistIdleId = null;
        }
    }
    function flushSettingsPersist() {
        clearScheduledPersist();
        persistSettingsDraft(settings.value);
    }
    function clearCharFlowRefreshTimer() {
        if (charFlowRefreshTimer !== null) {
            window.clearInterval(charFlowRefreshTimer);
            charFlowRefreshTimer = null;
        }
    }
    function isCharacterFlowPanelActive() {
        return (settings.value.ui_open &&
            activeTab.value === "flows" &&
            flowScope.value === "character");
    }
    function scheduleCharFlowRefreshWatch() {
        clearCharFlowRefreshTimer();
        if (!isCharacterFlowPanelActive()) {
            return;
        }
        charFlowRefreshTimer = window.setInterval(() => {
            if (!isCharacterFlowPanelActive() || charFlowsLoading.value) {
                return;
            }
            const currentName = (getCurrentCharacterName?.() ?? "").trim();
            const loadedName = activeCharName.value.trim();
            if (currentName !== loadedName) {
                void loadCharFlows();
            }
        }, 900);
    }
    function scheduleSettingsPersist() {
        clearScheduledPersist();
        const runPersist = () => {
            persistTimeoutId = null;
            persistIdleId = null;
            flushSettingsPersist();
        };
        if (typeof window.requestIdleCallback === "function") {
            persistIdleId = window.requestIdleCallback(runPersist, { timeout: 320 });
            return;
        }
        persistTimeoutId = window.setTimeout(runPersist, 180);
    }
    const syncFromRuntime = subscribeSettings((next) => {
        suppressPersist = true;
        if (!_.isEqual(settings.value, next)) {
            settings.value = next;
        }
        queueMicrotask(() => {
            suppressPersist = false;
        });
    });
    const syncRun = subscribeLastRun((next) => {
        const currentChatId = getCurrentChatIdSafe();
        if (!currentChatId ||
            !next?.chat_id ||
            next.chat_id.trim() === currentChatId) {
            lastRun.value = next;
        }
    });
    const syncIo = subscribeLastIo((next) => {
        const currentChatId = getCurrentChatIdSafe();
        if (!currentChatId ||
            !next?.chat_id ||
            next.chat_id.trim() === currentChatId) {
            lastIo.value = next;
        }
    });
    onScopeDispose(() => {
        syncFromRuntime.stop();
        syncRun.stop();
        syncIo.stop();
        clearScheduledPersist();
        clearCharFlowRefreshTimer();
    });
    watch(settings, () => {
        if (suppressPersist) {
            return;
        }
        scheduleSettingsPersist();
    }, { deep: true, flush: "post" });
    watch(() => settings.value.api_presets.map((preset) => preset.id), (presetIds) => {
        if (expandedApiPresetId.value &&
            !presetIds.includes(expandedApiPresetId.value)) {
            expandedApiPresetId.value = null;
        }
    });
    watch(() => settings.value.flows.map((flow) => flow.id), (flowIds) => {
        if (expandedFlowId.value && !flowIds.includes(expandedFlowId.value)) {
            expandedFlowId.value = null;
        }
    });
    watch(charFlows, (next) => {
        if (suppressCharFlowDraftPersist || charFlowsLoading.value) {
            return;
        }
        if (flowScope.value !== "character") {
            return;
        }
        if (!activeCharName.value.trim()) {
            return;
        }
        writeCharFlowDraft(activeCharName.value, next);
    }, { deep: true, flush: "post" });
    watch(() => [settings.value.ui_open, activeTab.value, flowScope.value], (nextState, previous) => {
        const [uiOpen, tab, scope] = nextState;
        const [prevUiOpen, prevTab, prevScope] = previous ?? [
            undefined,
            undefined,
            undefined,
        ];
        scheduleCharFlowRefreshWatch();
        if (uiOpen && tab === "debug" && (!prevUiOpen || prevTab !== "debug")) {
            refreshDebugRecords({ silent: true });
        }
        if (!uiOpen || tab !== "flows" || scope !== "character") {
            return;
        }
        if (!prevUiOpen || prevTab !== "flows" || prevScope !== "character") {
            void loadCharFlows();
        }
    }, { immediate: true });
    function refreshDebugRecords(options = {}) {
        const currentChatId = getCurrentChatIdSafe();
        const nextRun = currentChatId
            ? loadLastRunForChat(currentChatId)
            : loadLastRun();
        const nextIo = currentChatId
            ? loadLastIoForChat(currentChatId)
            : loadLastIo();
        lastRun.value = nextRun;
        lastIo.value = nextIo;
        if (options.silent) {
            return;
        }
        showEwNotice({
            title: "调试",
            message: nextRun || nextIo
                ? currentChatId
                    ? "已刷新当前聊天的调试记录"
                    : "已刷新调试记录"
                : currentChatId
                    ? "当前聊天暂无调试记录"
                    : "暂无可用调试记录",
            level: "info",
        });
    }
    function addApiPreset() {
        const next = klona(settings.value);
        const newPreset = createDefaultApiPreset(next.api_presets.length + 1);
        next.api_presets.push(newPreset);
        settings.value = next;
        expandedApiPresetId.value = newPreset.id;
        activeTab.value = "api";
    }
    function duplicateApiPreset(presetId) {
        const source = settings.value.api_presets.find((p) => p.id === presetId);
        if (!source)
            return;
        const next = klona(settings.value);
        const copy = klona(source);
        copy.id = `${copy.id}_${Date.now()}`;
        copy.name = `${copy.name} (副本)`;
        const insertIndex = next.api_presets.findIndex((p) => p.id === presetId) + 1;
        next.api_presets.splice(insertIndex, 0, copy);
        settings.value = next;
        expandedApiPresetId.value = copy.id;
    }
    function removeApiPreset(presetId) {
        const next = klona(settings.value);
        _.remove(next.api_presets, (preset) => preset.id === presetId);
        if (next.api_presets.length === 0) {
            next.api_presets.push(createDefaultApiPreset(1));
        }
        const fallbackPresetId = next.api_presets[0].id;
        next.flows = next.flows.map((flow) => {
            if (flow.api_preset_id !== presetId) {
                return flow;
            }
            return {
                ...flow,
                api_preset_id: fallbackPresetId,
            };
        });
        settings.value = next;
        if (expandedApiPresetId.value === presetId) {
            expandedApiPresetId.value = next.api_presets[0]?.id ?? null;
        }
    }
    function addFlow() {
        const next = klona(settings.value);
        if (next.api_presets.length === 0) {
            next.api_presets.push(createDefaultApiPreset(1));
        }
        const newFlow = createDefaultFlow(next.flows.length + 1, next.api_presets[0].id);
        next.flows.push(newFlow);
        settings.value = next;
        expandedFlowId.value = newFlow.id;
        activeTab.value = "flows";
    }
    function removeFlow(flowId) {
        const next = klona(settings.value);
        _.remove(next.flows, (flow) => flow.id === flowId);
        if (next.flows.length === 0) {
            if (next.api_presets.length === 0) {
                next.api_presets.push(createDefaultApiPreset(1));
            }
            next.flows.push(createDefaultFlow(1, next.api_presets[0].id));
        }
        settings.value = next;
        if (expandedFlowId.value === flowId) {
            expandedFlowId.value = next.flows[0]?.id ?? null;
        }
    }
    function duplicateFlow(flowId) {
        const source = settings.value.flows.find((f) => f.id === flowId);
        if (!source)
            return;
        const next = klona(settings.value);
        const copy = klona(source);
        copy.id = `${copy.id}_${Date.now()}`;
        copy.name = `${copy.name} (副本)`;
        const insertIndex = next.flows.findIndex((f) => f.id === flowId) + 1;
        next.flows.splice(insertIndex, 0, copy);
        settings.value = next;
        expandedFlowId.value = copy.id;
    }
    function setActiveTab(tab) {
        activeTab.value = tab;
        if (tab === "flows" && flowScope.value === "character") {
            void loadCharFlows();
        }
    }
    function setGlobalAdvancedOpen(open) {
        globalAdvancedOpen.value = open;
    }
    function toggleGlobalAdvancedOpen() {
        globalAdvancedOpen.value = !globalAdvancedOpen.value;
    }
    function toggleApiPresetExpanded(presetId) {
        expandedApiPresetId.value =
            expandedApiPresetId.value === presetId ? null : presetId;
    }
    function toggleFlowExpanded(flowId) {
        expandedFlowId.value = expandedFlowId.value === flowId ? null : flowId;
    }
    function setExpandedApiPreset(presetId) {
        expandedApiPresetId.value = presetId;
    }
    function setExpandedFlow(flowId) {
        expandedFlowId.value = flowId;
    }
    async function runManual(message) {
        busy.value = true;
        try {
            const text = message.trim() || getChatMessages(-1)[0]?.message || "";
            const result = await runWorkflow({
                message_id: getLastMessageId(),
                user_input: text,
                mode: "manual",
                inject_reply: false,
            });
            if (!result.ok) {
                toastr.error(result.reason ?? "手动运行失败", "Evolution World");
            }
            else {
                toastr.success("手动运行成功", "Evolution World");
            }
        }
        finally {
            busy.value = false;
        }
    }
    async function rollbackController() {
        busy.value = true;
        try {
            const api = window.EvolutionWorldAPI;
            if (!api) {
                toastr.error("EvolutionWorldAPI 尚未就绪", "Evolution World");
                return;
            }
            const result = await api.rollbackController();
            if (!result.ok) {
                toastr.error(result.reason ?? "回滚失败", "Evolution World");
            }
            else {
                toastr.success("控制器回滚成功", "Evolution World");
            }
        }
        finally {
            busy.value = false;
        }
    }
    function exportConfig() {
        const safeSettings = klona(settings.value);
        for (const preset of safeSettings.api_presets) {
            preset.api_key = "";
            preset.api_url = "";
            preset.headers_json = "";
        }
        for (const flow of safeSettings.flows) {
            flow.api_url = "";
            flow.api_key = "";
            flow.headers_json = "";
            flow.api_preset_id = "";
        }
        const payload = JSON.stringify(safeSettings, null, 2);
        navigator.clipboard
            .writeText(payload)
            .then(() => toastr.success("配置已复制到剪贴板（已去除 API 密钥）", "Evolution World"))
            .catch(() => toastr.error("复制配置失败", "Evolution World"));
    }
    function sanitizeImportData(data) {
        if (!data || typeof data !== "object")
            return data;
        const clone = klona(data);
        if (Array.isArray(clone.api_presets)) {
            for (const preset of clone.api_presets) {
                if (preset.mode === "llm_connector") {
                    preset.mode = "workflow_http";
                }
                delete preset.use_main_api;
            }
        }
        return clone;
    }
    function importConfig() {
        if (!importText.value.trim()) {
            showEwNotice({
                title: "导入失败",
                message: "导入内容为空，请先粘贴 JSON 配置。",
                level: "warning",
                duration_ms: 3600,
            });
            toastr.warning("导入内容为空", "Evolution World");
            return;
        }
        try {
            const raw = JSON.parse(importText.value);
            const sanitized = sanitizeImportData(raw);
            const parsed = EwSettingsSchema.parse(sanitized);
            replaceSettings(parsed);
            settings.value = getSettings();
            showEwNotice({
                title: "导入成功",
                message: "配置已加载并应用到当前脚本。",
                level: "success",
                duration_ms: 3200,
            });
            toastr.success("配置已导入", "Evolution World");
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            showEwNotice({
                title: "导入失败",
                message,
                level: "error",
                duration_ms: 4800,
            });
            toastr.error(`导入失败: ${message}`, "Evolution World");
        }
    }
    function downloadJson(data, filename) {
        const blob = new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    function buildFlowExportPayload(flows) {
        const safeFlows = flows.map((flow) => {
            const copy = klona(flow);
            delete copy.api_url;
            delete copy.api_key;
            delete copy.headers_json;
            delete copy.api_preset_id;
            return copy;
        });
        return { ew_flow_export: true, version: 1, flows: safeFlows };
    }
    function sanitizeFilename(name) {
        return name.replace(/[<>:"/\\|?*]/g, "_").trim() || "flow";
    }
    function ensureUniqueFlowIds(flows, existingIds) {
        for (const flow of flows) {
            if (existingIds.has(flow.id)) {
                flow.id = `${flow.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            }
            existingIds.add(flow.id);
        }
    }
    function parseImportedFlows(jsonText, filename) {
        const parsed = JSON.parse(jsonText);
        let validated;
        if (parsed &&
            parsed.ew_flow_export === true &&
            Array.isArray(parsed.flows)) {
            validated = [];
            for (const raw of parsed.flows) {
                validated.push(EwFlowConfigSchema.parse(raw));
            }
        }
        else if (isSillyTavernPreset(parsed)) {
            const flowName = filename?.replace(/\.json$/i, "") || "ST Preset";
            const flow = EwFlowConfigSchema.parse(convertStPresetToFlow(parsed, flowName));
            validated = [flow];
            toastr.info("已识别为酒馆预设并转换", "Evolution World");
        }
        else {
            throw new Error("无效的工作流导出文件，缺少 ew_flow_export 标识且非酒馆预设");
        }
        if (validated.length === 0) {
            throw new Error("导出文件中没有工作流");
        }
        return validated;
    }
    function exportSingleFlow(flowId) {
        const flow = settings.value.flows.find((f) => f.id === flowId);
        if (!flow) {
            toastr.error("找不到该工作流", "Evolution World");
            return;
        }
        const payload = buildFlowExportPayload([flow]);
        downloadJson(payload, `ew_flow_${sanitizeFilename(flow.name)}.json`);
        toastr.success(`已导出工作流「${flow.name}」`, "Evolution World");
    }
    function exportAllFlows() {
        if (settings.value.flows.length === 0) {
            toastr.warning("没有工作流可导出", "Evolution World");
            return;
        }
        const payload = buildFlowExportPayload(settings.value.flows);
        downloadJson(payload, `ew_flows_all_${settings.value.flows.length}.json`);
        toastr.success(`已导出全部 ${settings.value.flows.length} 条工作流`, "Evolution World");
    }
    function importFlowsFromText(jsonText, filename) {
        if (!jsonText.trim()) {
            toastr.warning("导入内容为空", "Evolution World");
            return;
        }
        try {
            const validated = parseImportedFlows(jsonText, filename);
            const existingIds = new Set(settings.value.flows.map((f) => f.id));
            ensureUniqueFlowIds(validated, existingIds);
            const next = klona(settings.value);
            next.flows.push(...validated);
            settings.value = next;
            toastr.success(`已导入 ${validated.length} 条工作流`, "Evolution World");
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toastr.error(`工作流导入失败: ${message}`, "Evolution World");
        }
    }
    function exportSingleCharFlow(flowId) {
        const flow = charFlows.value.find((f) => f.id === flowId);
        if (!flow) {
            toastr.error("找不到该角色卡工作流", "Evolution World");
            return;
        }
        const payload = buildFlowExportPayload([flow]);
        downloadJson(payload, `ew_char_flow_${sanitizeFilename(flow.name)}.json`);
        toastr.success(`已导出角色卡工作流「${flow.name}」`, "Evolution World");
    }
    function exportAllCharFlows() {
        if (charFlows.value.length === 0) {
            toastr.warning("当前角色卡没有工作流可导出", "Evolution World");
            return;
        }
        const charName = sanitizeFilename(activeCharName.value || "character");
        const payload = buildFlowExportPayload(charFlows.value);
        downloadJson(payload, `ew_char_flows_${charName}_${charFlows.value.length}.json`);
        toastr.success(`已导出当前角色卡全部 ${charFlows.value.length} 条工作流`, "Evolution World");
    }
    function importCharFlowsFromText(jsonText, filename) {
        if (!jsonText.trim()) {
            toastr.warning("导入内容为空", "Evolution World");
            return;
        }
        try {
            const validated = parseImportedFlows(jsonText, filename);
            const next = [...charFlows.value];
            const existingIds = new Set(next.map((f) => f.id));
            ensureUniqueFlowIds(validated, existingIds);
            next.push(...validated);
            charFlows.value = next;
            showEwNotice({
                title: "Evolution World",
                message: `已导入 ${validated.length} 条角色卡工作流。若要写回世界书，请继续点击“保存到绑定世界书”。`,
                level: "success",
            });
            toastr.success(`已导入 ${validated.length} 条角色卡工作流`, "Evolution World");
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toastr.error(`角色卡工作流导入失败: ${message}`, "Evolution World");
        }
    }
    function validateConfig() {
        try {
            const result = EwSettingsSchema.safeParse(settings.value);
            if (result.success) {
                toastr.success("配置校验通过 ✓", "Evolution World");
                showEwNotice({
                    title: "校验",
                    message: "当前配置合法、完整。",
                    level: "success",
                });
                return;
            }
            const errors = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
            toastr.error(`配置校验失败 (${errors.length} 项)`, "Evolution World");
            showEwNotice({
                title: "校验失败",
                message: errors.join("\n"),
                level: "error",
                duration_ms: 6000,
            });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            toastr.error(`校验异常: ${msg}`, "Evolution World");
        }
    }
    async function validateControllerSyntax() {
        busy.value = true;
        try {
            const result = await window.EvolutionWorldAPI?.validateControllerSyntax();
            if (!result) {
                toastr.error("EvolutionWorldAPI 尚未就绪", "Evolution World");
                return;
            }
            if (result.ok) {
                toastr.success("控制器语法校验通过 ✓", "Evolution World");
            }
            else {
                toastr.error(result.reason ?? "控制器语法无效", "Evolution World");
            }
        }
        finally {
            busy.value = false;
        }
    }
    function setOpen(open) {
        patchSettings({ ui_open: open });
    }
    function openPanel() {
        setOpen(true);
    }
    function closePanel() {
        setOpen(false);
        activeTab.value = "overview";
    }
    async function loadCharFlows() {
        charFlowsLoading.value = true;
        try {
            const name = getCurrentCharacterName?.() ?? "";
            activeCharName.value = name;
            const savedFlows = await readCharFlows(settings.value);
            const draftFlows = readCharFlowDraft(name);
            suppressCharFlowDraftPersist = true;
            charFlows.value = draftFlows ?? savedFlows;
            queueMicrotask(() => {
                suppressCharFlowDraftPersist = false;
            });
        }
        catch (e) {
            console.warn("[Evolution World] loadCharFlows failed:", e);
            charFlows.value = [];
        }
        finally {
            charFlowsLoading.value = false;
        }
    }
    async function reloadCharFlowsFromWorldbook() {
        charFlowsLoading.value = true;
        try {
            const name = getCurrentCharacterName?.() ?? "";
            activeCharName.value = name;
            const savedFlows = await readCharFlows(settings.value);
            suppressCharFlowDraftPersist = true;
            charFlows.value = savedFlows;
            clearCharFlowDraft(name);
            queueMicrotask(() => {
                suppressCharFlowDraftPersist = false;
            });
            showEwNotice({
                title: "Evolution World",
                message: `已从角色世界书重新读取 ${savedFlows.length} 条工作流，并覆盖当前角色卡草稿。`,
                level: "success",
            });
        }
        catch (e) {
            console.error("[Evolution World] reloadCharFlowsFromWorldbook failed:", e);
            showEwNotice({
                title: "Evolution World",
                message: "从角色世界书读取工作流失败: " + e.message,
                level: "error",
            });
        }
        finally {
            charFlowsLoading.value = false;
        }
    }
    async function saveCharFlows() {
        try {
            await writeCharFlows(settings.value, charFlows.value);
            writeCharFlowDraft(activeCharName.value, charFlows.value);
            showEwNotice({
                title: "Evolution World",
                message: "角色卡工作流已保存到当前绑定世界书。若要分享，请连同更新后的角色世界书一起导出。",
                level: "success",
            });
        }
        catch (e) {
            console.error("[Evolution World] saveCharFlows failed:", e);
            showEwNotice({
                title: "Evolution World",
                message: "角色卡工作流保存失败: " + e.message,
                level: "error",
            });
        }
    }
    async function mergeFlowsToCard(flowIds) {
        try {
            const selected = settings.value.flows.filter((f) => flowIds.includes(f.id));
            if (selected.length === 0) {
                showEwNotice({
                    title: "Evolution World",
                    message: "未选择任何工作流",
                    level: "warning",
                });
                return;
            }
            const existing = await readCharFlows(settings.value);
            const merged = [...existing];
            let updatedCount = 0;
            let appendedCount = 0;
            for (const flow of selected) {
                const copy = klona(flow);
                delete copy.api_url;
                delete copy.api_key;
                delete copy.headers_json;
                const trimmedName = copy.name.trim();
                const existingIndex = merged.findIndex((f) => f.name.trim() === trimmedName);
                if (existingIndex >= 0) {
                    copy.id = merged[existingIndex].id;
                    merged[existingIndex] = copy;
                    updatedCount++;
                }
                else {
                    copy.id = `${copy.id}_char_${Date.now()}`;
                    merged.push(copy);
                    appendedCount++;
                }
            }
            await writeCharFlows(settings.value, merged);
            charFlows.value = merged;
            activeCharName.value = getCurrentCharacterName?.() ?? "";
            writeCharFlowDraft(activeCharName.value, merged);
            const parts = [];
            if (updatedCount > 0)
                parts.push(`更新 ${updatedCount} 条`);
            if (appendedCount > 0)
                parts.push(`新增 ${appendedCount} 条`);
            showEwNotice({
                title: "Evolution World",
                message: `已写入角色卡工作流：${parts.join("，")}`,
                level: "success",
            });
        }
        catch (e) {
            console.error("[Evolution World] mergeFlowsToCard failed:", e);
            showEwNotice({
                title: "Evolution World",
                message: "写入角色卡失败: " + e.message,
                level: "error",
            });
        }
    }
    function addCharFlow() {
        const apiPresets = settings.value.api_presets;
        if (apiPresets.length === 0) {
            const next = klona(settings.value);
            next.api_presets.push(createDefaultApiPreset(1));
            settings.value = next;
        }
        const newFlow = createDefaultFlow(charFlows.value.length + 1, settings.value.api_presets[0].id);
        charFlows.value = [...charFlows.value, newFlow];
        expandedFlowId.value = newFlow.id;
    }
    function removeCharFlow(flowId) {
        charFlows.value = charFlows.value.filter((f) => f.id !== flowId);
        if (expandedFlowId.value === flowId) {
            expandedFlowId.value = charFlows.value[0]?.id ?? null;
        }
    }
    function duplicateCharFlow(flowId) {
        const source = charFlows.value.find((f) => f.id === flowId);
        if (!source)
            return;
        const copy = klona(source);
        copy.id = `${copy.id}_${Date.now()}`;
        copy.name = `${copy.name} (副本)`;
        const insertIndex = charFlows.value.findIndex((f) => f.id === flowId) + 1;
        const next = [...charFlows.value];
        next.splice(insertIndex, 0, copy);
        charFlows.value = next;
        expandedFlowId.value = copy.id;
    }
    function setFlowScope(scope) {
        flowScope.value = scope;
        if (scope === "character") {
            void loadCharFlows();
        }
    }
    async function loadPromptPreview() {
        const flowId = previewFlowId.value;
        const allFlows = [...settings.value.flows, ...charFlows.value];
        const flow = allFlows.find((f) => f.id === flowId) ??
            allFlows.find((f) => f.enabled) ??
            allFlows[0];
        if (!flow) {
            showEwNotice({
                title: "调试",
                message: "没有可用的工作流",
                level: "warning",
            });
            return;
        }
        previewFlowId.value = flow.id;
        busy.value = true;
        try {
            promptPreview.value = await previewPrompt(flow);
            showEwNotice({
                title: "调试",
                message: `Prompt 预览已生成（${promptPreview.value.length} 条消息）`,
                level: "success",
            });
        }
        catch (e) {
            console.error("[Evolution World] previewPrompt failed:", e);
            showEwNotice({
                title: "调试",
                message: "Prompt 预览失败: " + e.message,
                level: "error",
            });
        }
        finally {
            busy.value = false;
        }
    }
    async function loadSnapshotPreview() {
        busy.value = true;
        try {
            snapshotPreview.value = await collectLatestSnapshots();
            const dynCount = snapshotPreview.value.dyn.size;
            const controllerCount = snapshotPreview.value.controllers.length;
            showEwNotice({
                title: "调试",
                message: `Controller: ${controllerCount} 条 | Dyn 条目: ${dynCount}`,
                level: "success",
            });
        }
        catch (e) {
            console.error("[Evolution World] loadSnapshotPreview failed:", e);
            showEwNotice({
                title: "调试",
                message: "快照读取失败: " + e.message,
                level: "error",
            });
        }
        finally {
            busy.value = false;
        }
    }
    async function loadFloorSnapshots() {
        busy.value = true;
        try {
            floorSnapshots.value = await collectAllFloorSnapshots();
            showEwNotice({
                title: "历史",
                message: `已加载 ${floorSnapshots.value.length} 个楼层`,
                level: "success",
            });
        }
        catch (e) {
            console.error("[Evolution World] loadFloorSnapshots failed:", e);
            showEwNotice({
                title: "历史",
                message: "楼层快照加载失败: " + e.message,
                level: "error",
            });
        }
        finally {
            busy.value = false;
        }
    }
    async function doRollbackToFloor(messageId) {
        busy.value = true;
        try {
            await rollbackToFloor(settings.value, messageId);
            showEwNotice({
                title: "历史",
                message: `已回滚到楼层 #${messageId}`,
                level: "success",
            });
        }
        catch (e) {
            console.error("[Evolution World] doRollbackToFloor failed:", e);
            showEwNotice({
                title: "历史",
                message: "回滚失败: " + e.message,
                level: "error",
            });
        }
        finally {
            busy.value = false;
        }
    }
    async function rederiveFloorWorkflow(messageId, timing = "manual") {
        busy.value = true;
        try {
            const api = window.EvolutionWorldAPI;
            if (!api?.rederiveWorkflowAtFloor) {
                return {
                    ok: false,
                    reason: "EvolutionWorldAPI.rederiveWorkflowAtFloor 尚未就绪",
                };
            }
            const result = await api.rederiveWorkflowAtFloor({
                message_id: messageId,
                timing,
                capsule_mode: "full",
            });
            if (result.ok) {
                const applied = Number(result.result?.writeback_applied ?? 0);
                const conflicts = Number(result.result?.writeback_conflicts ?? 0);
                const anchorId = Number(result.result?.anchor_message_id ?? messageId);
                showEwNotice({
                    title: "历史",
                    message: `楼层 #${messageId} 已完成重推导：锚点 #${anchorId}，写回 ${applied} 项，冲突 ${conflicts} 项。`,
                    level: "success",
                    duration_ms: 4200,
                });
                await loadFloorSnapshots();
            }
            else if (result.reason && result.reason !== "cancelled_by_user") {
                showEwNotice({
                    title: "历史",
                    message: `楼层 #${messageId} 重推导失败：${result.reason}`,
                    level: "error",
                    duration_ms: 5200,
                });
            }
            return result;
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            showEwNotice({
                title: "历史",
                message: `楼层 #${messageId} 重推导异常：${reason}`,
                level: "error",
                duration_ms: 5200,
            });
            return { ok: false, reason };
        }
        finally {
            busy.value = false;
        }
    }
    return {
        settings,
        lastRun,
        lastIo,
        activeTab,
        globalAdvancedOpen,
        expandedApiPresetId,
        expandedFlowId,
        importText,
        busy,
        charFlows,
        activeCharName,
        flowScope,
        charFlowsLoading,
        promptPreview,
        snapshotPreview,
        previewFlowId,
        floorSnapshots,
        selectedFloorId,
        compareFloorId,
        refreshDebugRecords,
        addApiPreset,
        duplicateApiPreset,
        removeApiPreset,
        addFlow,
        duplicateFlow,
        removeFlow,
        setActiveTab,
        setGlobalAdvancedOpen,
        toggleGlobalAdvancedOpen,
        toggleApiPresetExpanded,
        toggleFlowExpanded,
        setExpandedApiPreset,
        setExpandedFlow,
        runManual,
        rollbackController,
        exportConfig,
        importConfig,
        exportSingleFlow,
        exportAllFlows,
        importFlowsFromText,
        exportSingleCharFlow,
        exportAllCharFlows,
        importCharFlowsFromText,
        validateConfig,
        validateControllerSyntax,
        setOpen,
        openPanel,
        closePanel,
        loadCharFlows,
        reloadCharFlowsFromWorldbook,
        saveCharFlows,
        mergeFlowsToCard,
        addCharFlow,
        duplicateCharFlow,
        removeCharFlow,
        setFlowScope,
        loadPromptPreview,
        loadSnapshotPreview,
        loadFloorSnapshots,
        doRollbackToFloor,
        rederiveFloorWorkflow,
    };
});
//# sourceMappingURL=store.js.map