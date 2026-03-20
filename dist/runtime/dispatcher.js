import _ from "lodash";
import { EVENT_STREAM_TOKEN, onEvent } from "./compat/events";
import { getSillyTavernContext, getStRequestHeaders, resolveGenerateRaw, stopSpecificGeneration, } from "./compat/generation";
import { buildFlowRequest } from "./context-builder";
import { FlowResponseSchema } from "./contracts";
import { assembleOrderedPrompts, collectPromptComponents, } from "./prompt-assembler";
export class DispatchFlowsError extends Error {
    attempts;
    constructor(message, attempts) {
        super(message);
        this.name = "DispatchFlowsError";
        this.attempts = attempts;
    }
}
export const DEFAULT_WORKFLOW_SYSTEM_PROMPT = [
    "你是 Evolution World 的工作流执行器。",
    "你会收到一个 FlowRequestV1 JSON，请返回一个 JSON 对象。",
    "输出必须包含一个有效的 JSON 对象。允许使用 <thinking> 等标签进行思考推理，插件会自动提取 JSON 内容。",
    "operations.worldbook 字段必须存在（允许为空数组）。",
    "version/flow_id/status/priority 等固定字段可省略，插件会自动补全。",
].join("\n");
// ── getHostRuntime / resolveGenerateRaw / getSillyTavernContext ──
// 已迁移至 compat/generation.ts。不再需要本地实现。
// resolveGenerateRaw, getStRequestHeaders, getSillyTavernContext
// 均从 compat/generation 导入。
function collectActiveDynEntryNames(promptComponents, settings) {
    const candidates = [
        ...(promptComponents.worldInfoBefore ?? []),
        ...(promptComponents.worldInfoAfter ?? []),
    ];
    return _.uniq(candidates
        .map((entry) => entry.source_name ?? entry.name)
        .filter((name) => typeof name === "string" &&
        name.startsWith(settings.dynamic_entry_prefix)));
}
function isDispatchAborted(signal, isCancelled) {
    return Boolean(signal?.aborted || isCancelled?.());
}
function throwIfDispatchAborted(signal, isCancelled) {
    if (isDispatchAborted(signal, isCancelled)) {
        throw new Error("workflow cancelled by user");
    }
}
function waitDispatchDelay(ms, signal, isCancelled) {
    if (ms <= 0) {
        return Promise.resolve();
    }
    return new Promise(async (resolve, reject) => {
        const startedAt = Date.now();
        try {
            while (Date.now() - startedAt < ms) {
                throwIfDispatchAborted(signal, isCancelled);
                const remaining = ms - (Date.now() - startedAt);
                await new Promise((innerResolve) => setTimeout(innerResolve, Math.min(remaining, 200)));
            }
            throwIfDispatchAborted(signal, isCancelled);
            resolve();
        }
        catch (error) {
            reject(error);
        }
    });
}
function buildTemplateContext(base) {
    const userInput = typeof base.user_input === "string" ? base.user_input : "";
    return _.merge({}, base, {
        lastUserMessage: userInput,
        last_user_message: userInput,
        userInput,
    });
}
function resolveTemplateExpression(templateContext, expression) {
    const normalizedPath = String(expression ?? "").trim();
    if (!normalizedPath) {
        return "";
    }
    return _.get(templateContext, normalizedPath);
}
function resolveTemplateString(templateContext, rawValue) {
    const exactMatch = rawValue.match(/^\{\{\s*([a-zA-Z0-9_.$]+)\s*\}\}$/);
    if (exactMatch) {
        return resolveTemplateExpression(templateContext, exactMatch[1]);
    }
    return rawValue.replace(/\{\{\s*([a-zA-Z0-9_.$]+)\s*\}\}/g, (_match, path) => {
        const value = resolveTemplateExpression(templateContext, path);
        if (value === undefined || value === null) {
            return "";
        }
        if (_.isPlainObject(value) || Array.isArray(value)) {
            return JSON.stringify(value);
        }
        return String(value);
    });
}
function resolveTemplateNode(templateContext, node) {
    if (typeof node === "string") {
        return resolveTemplateString(templateContext, node);
    }
    if (Array.isArray(node)) {
        return node.map((item) => resolveTemplateNode(templateContext, item));
    }
    if (_.isPlainObject(node)) {
        return _.mapValues(node, (value) => resolveTemplateNode(templateContext, value));
    }
    return node;
}
function applyTemplate(base, templateText) {
    if (!templateText.trim()) {
        return base;
    }
    let parsedTemplate;
    try {
        parsedTemplate = JSON.parse(templateText);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`flow request_template invalid: ${message}`);
    }
    if (!_.isPlainObject(parsedTemplate)) {
        throw new Error("flow request_template invalid: request_template must parse to JSON object");
    }
    const templateContext = buildTemplateContext(base);
    const templateObject = resolveTemplateNode(templateContext, parsedTemplate);
    if (!_.isPlainObject(templateObject)) {
        throw new Error("flow request_template invalid: resolved template must stay as JSON object");
    }
    return _.merge({}, base, templateObject);
}
function toErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
function shouldFallbackFromGenerateRawCustomApiError(error) {
    const message = toErrorMessage(error);
    if (!message.trim()) {
        return false;
    }
    if (/上游 API|HTTP\s+\d{3}|response schema invalid|model output is not a JSON object|unexpected token|response_extract_regex|timeout|cancelled|workflow cancelled/i.test(message)) {
        return false;
    }
    return /generateRaw is unavailable|custom_api.+(unsupported|not supported|not implemented)|is not a function|Cannot read propert/i.test(message);
}
function parseStBackendErrorPayload(errTxt) {
    try {
        const parsed = JSON.parse(errTxt);
        const payload = parsed?.error;
        if (!payload || typeof payload !== "object") {
            return null;
        }
        return {
            message: typeof payload.message === "string"
                ? payload.message
                : String(payload.message ?? ""),
            code: typeof payload.code === "string" ? payload.code : undefined,
            type: typeof payload.type === "string" ? payload.type : undefined,
        };
    }
    catch {
        return null;
    }
}
function getApiHostLabel(apiUrl) {
    try {
        return new URL(apiUrl).host || apiUrl;
    }
    catch {
        return apiUrl;
    }
}
function summarizeStBackendError(flowId, status, apiUrl, errTxt) {
    const payload = parseStBackendErrorPayload(errTxt);
    const host = getApiHostLabel(apiUrl);
    const rawMessage = payload?.message || errTxt;
    const normalizedMessage = rawMessage.replace(/\s+/g, " ").trim();
    const code = payload?.code ??
        (normalizedMessage.includes("ECONNRESET") ? "ECONNRESET" : undefined);
    if (code === "ECONNRESET" ||
        /secure TLS connection was not established/i.test(normalizedMessage) ||
        /Client network socket disconnected/i.test(normalizedMessage)) {
        return `[${flowId}] 上游 API 连接失败：与 ${host} 建立安全连接时被重置（HTTP ${status}${code ? ` / ${code}` : ""}）`;
    }
    if (code === "ETIMEDOUT" || /timed? out/i.test(normalizedMessage)) {
        return `[${flowId}] 上游 API 连接超时：${host}（HTTP ${status}${code ? ` / ${code}` : ""}）`;
    }
    if (payload?.message) {
        return `[${flowId}] 上游 API 请求失败：${payload.message}${code ? ` (${code})` : ""}`;
    }
    const compact = normalizedMessage.length > 180
        ? `${normalizedMessage.slice(0, 180)}...`
        : normalizedMessage;
    return `[${flowId}] ST backend error: ${status} ${compact}`;
}
function parseHeadersJson(headersJson) {
    const trimmed = headersJson.trim();
    if (!trimmed) {
        return {};
    }
    try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("headers_json must be a JSON object");
        }
        return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [
            String(key),
            String(value),
        ]));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`headers_json invalid: ${message}`);
    }
}
function buildCustomIncludeHeaders(apiPreset) {
    const headers = parseHeadersJson(apiPreset.headers_json);
    if (apiPreset.api_key.trim()) {
        headers.Authorization = `Bearer ${apiPreset.api_key.trim()}`;
    }
    return Object.entries(headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n");
}
function shouldUseGenerateRawCustomApi(apiPreset) {
    if (apiPreset.api_key.trim()) {
        return false;
    }
    return !apiPreset.headers_json.trim();
}
function resolveCurrentChatCompletionModel(context) {
    const getChatCompletionModel = context?.getChatCompletionModel;
    if (typeof getChatCompletionModel === "function") {
        const resolved = getChatCompletionModel(context?.chatCompletionSettings);
        if (typeof resolved === "string" && resolved.trim()) {
            return resolved.trim();
        }
    }
    const settings = context?.chatCompletionSettings;
    const source = String(settings?.chat_completion_source ?? "").trim();
    const modelBySource = {
        claude: settings?.claude_model,
        openai: settings?.openai_model,
        makersuite: settings?.google_model,
        vertexai: settings?.vertexai_model,
        openrouter: settings?.openrouter_model,
        ai21: settings?.ai21_model,
        mistralai: settings?.mistralai_model,
        custom: settings?.custom_model,
        cohere: settings?.cohere_model,
        perplexity: settings?.perplexity_model,
        groq: settings?.groq_model,
        siliconflow: settings?.siliconflow_model,
        electronhub: settings?.electronhub_model,
        chutes: settings?.chutes_model,
        nanogpt: settings?.nanogpt_model,
        deepseek: settings?.deepseek_model,
        aimlapi: settings?.aimlapi_model,
        xai: settings?.xai_model,
        pollinations: settings?.pollinations_model,
        cometapi: settings?.cometapi_model,
        moonshot: settings?.moonshot_model,
        fireworks: settings?.fireworks_model,
        azure_openai: settings?.azure_openai_model,
        zai: settings?.zai_model,
    };
    return String(modelBySource[source] ?? "").trim();
}
function normalizePenaltyNumber(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Number(Math.max(0, Math.min(2, value)).toFixed(4));
}
function buildChatCompletionPenaltyFields(flow) {
    const frequencyPenalty = normalizePenaltyNumber(flow.generation_options.frequency_penalty);
    const presencePenalty = normalizePenaltyNumber(flow.generation_options.presence_penalty);
    const fields = {};
    if (frequencyPenalty > 0) {
        fields.frequency_penalty = frequencyPenalty;
    }
    if (presencePenalty > 0) {
        fields.presence_penalty = presencePenalty;
    }
    return fields;
}
function buildGenerateRawPenaltyFields(flow) {
    const frequencyPenalty = normalizePenaltyNumber(flow.generation_options.frequency_penalty);
    const presencePenalty = normalizePenaltyNumber(flow.generation_options.presence_penalty);
    return {
        frequency_penalty: frequencyPenalty > 0 ? frequencyPenalty : "unset",
        presence_penalty: presencePenalty > 0 ? presencePenalty : "unset",
    };
}
function buildMainApiStBackendRequestBody(flow, orderedPrompts) {
    const context = getSillyTavernContext();
    const mainApi = String(context?.mainApi ?? context?.main_api ?? "")
        .trim()
        .toLowerCase();
    if (mainApi !== "openai") {
        return null;
    }
    const chatSettings = context?.chatCompletionSettings;
    if (!chatSettings || typeof chatSettings !== "object") {
        return null;
    }
    const model = resolveCurrentChatCompletionModel(context).replace(/^models\//, "");
    if (!model) {
        return null;
    }
    return {
        messages: orderedPrompts,
        model,
        max_tokens: flow.generation_options.max_reply_tokens,
        temperature: flow.generation_options.temperature,
        top_p: flow.generation_options.top_p,
        ...buildChatCompletionPenaltyFields(flow),
        stream: flow.generation_options.stream,
        chat_completion_source: String(chatSettings.chat_completion_source ?? "openai"),
        group_names: [],
        include_reasoning: flow.behavior_options.request_thinking,
        reasoning_effort: flow.behavior_options.reasoning_effort,
        verbosity: flow.behavior_options.verbosity,
        enable_web_search: false,
        request_images: flow.behavior_options.send_inline_media,
        reverse_proxy: String(chatSettings.reverse_proxy ?? ""),
        proxy_password: String(chatSettings.proxy_password ?? ""),
        custom_url: String(chatSettings.custom_url ?? ""),
        custom_include_headers: String(chatSettings.custom_include_headers ?? ""),
        custom_include_body: String(chatSettings.custom_include_body ?? ""),
        custom_exclude_body: String(chatSettings.custom_exclude_body ?? ""),
        custom_prompt_post_processing: String(chatSettings.custom_prompt_post_processing ?? "strict"),
        use_sysprompt: Boolean(chatSettings.use_sysprompt),
        assistant_prefill: String(chatSettings.assistant_prefill ?? ""),
        assistant_impersonation: String(chatSettings.assistant_impersonation ?? ""),
        continue_prefill: flow.behavior_options.continue_prefill ||
            Boolean(chatSettings.continue_prefill),
        squash_system_messages: flow.behavior_options.squash_system_messages,
    };
}
function buildCustomStBackendRequestBody(flow, apiPreset, orderedPrompts) {
    return {
        messages: orderedPrompts,
        model: apiPreset.model.trim().replace(/^models\//, ""),
        max_tokens: flow.generation_options.max_reply_tokens,
        temperature: flow.generation_options.temperature,
        top_p: flow.generation_options.top_p,
        ...buildChatCompletionPenaltyFields(flow),
        stream: flow.generation_options.stream,
        chat_completion_source: "custom",
        group_names: [],
        include_reasoning: flow.behavior_options.request_thinking,
        reasoning_effort: flow.behavior_options.reasoning_effort,
        enable_web_search: false,
        request_images: flow.behavior_options.send_inline_media,
        reverse_proxy: apiPreset.api_url.trim(),
        proxy_password: "",
        custom_url: apiPreset.api_url.trim(),
        custom_include_headers: buildCustomIncludeHeaders(apiPreset),
        custom_prompt_post_processing: "strict",
    };
}
function extractLatestJsonStringField(source, fieldName) {
    const pattern = new RegExp(`\\"${fieldName}\\"\\s*:\\s*\\"`, "g");
    let match;
    let last = null;
    while ((match = pattern.exec(source))) {
        const start = match.index + match[0].length;
        let raw = "";
        let escaped = false;
        for (let cursor = start; cursor < source.length; cursor += 1) {
            const char = source[cursor];
            if (escaped) {
                raw += char;
                escaped = false;
                continue;
            }
            if (char === "\\") {
                raw += char;
                escaped = true;
                continue;
            }
            if (char === '"') {
                break;
            }
            raw += char;
        }
        last = { raw, index: match.index };
    }
    return last;
}
function decodePartialJsonString(raw) {
    let result = "";
    for (let index = 0; index < raw.length; index += 1) {
        const char = raw[index];
        if (char !== "\\") {
            result += char;
            continue;
        }
        const next = raw[index + 1];
        if (!next) {
            break;
        }
        index += 1;
        switch (next) {
            case "n":
                result += "\n";
                break;
            case "r":
                result += "\r";
                break;
            case "t":
                result += "\t";
                break;
            case "b":
                result += "\b";
                break;
            case "f":
                result += "\f";
                break;
            case '"':
            case "\\":
            case "/":
                result += next;
                break;
            case "u": {
                const code = raw.slice(index + 1, index + 5);
                if (/^[0-9a-fA-F]{4}$/.test(code)) {
                    result += String.fromCharCode(Number.parseInt(code, 16));
                    index += 4;
                }
                break;
            }
            default:
                result += next;
                break;
        }
    }
    return result;
}
function extractStreamPreview(fullText) {
    const desiredEntriesIndex = fullText.lastIndexOf('"desired_entries"');
    const searchArea = desiredEntriesIndex >= 0 ? fullText.slice(desiredEntriesIndex) : fullText;
    const nameField = extractLatestJsonStringField(searchArea, "name");
    const contentField = extractLatestJsonStringField(searchArea, "content");
    if (!nameField && !contentField) {
        return undefined;
    }
    const entryName = nameField
        ? decodePartialJsonString(nameField.raw).trim()
        : "";
    const content = contentField
        ? decodePartialJsonString(contentField.raw).replace(/\s+/g, " ").trim()
        : "";
    if (!entryName && !content) {
        return undefined;
    }
    return {
        entry_name: entryName,
        content,
    };
}
function extractStreamDeltaFromPayload(payload) {
    const openAiDelta = payload?.choices?.[0]?.delta?.content;
    if (typeof openAiDelta === "string" && openAiDelta) {
        return { delta: openAiDelta };
    }
    const openAiFull = payload?.choices?.[0]?.message?.content ??
        payload?.choices?.[0]?.text ??
        payload?.content;
    if (typeof openAiFull === "string" && openAiFull) {
        return { full: openAiFull };
    }
    const anthropicDelta = payload?.delta?.text ?? payload?.content_block?.text;
    if (typeof anthropicDelta === "string" && anthropicDelta) {
        return { delta: anthropicDelta };
    }
    const candidatesText = payload?.candidates?.[0]?.content?.parts
        ?.map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("");
    if (typeof candidatesText === "string" && candidatesText) {
        return { full: candidatesText };
    }
    return {};
}
async function readStreamingSseText(response, onText) {
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error("stream response body is unavailable");
    }
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    const processEventBlock = (block) => {
        const trimmed = block.trim();
        if (!trimmed) {
            return;
        }
        const dataLines = trimmed
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim());
        if (!dataLines.length) {
            return;
        }
        const payloadText = dataLines.join("\n");
        if (!payloadText || payloadText === "[DONE]") {
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(payloadText);
        }
        catch {
            return;
        }
        const extracted = extractStreamDeltaFromPayload(parsed);
        if (typeof extracted.full === "string" && extracted.full) {
            fullText = extracted.full;
            onText?.(fullText);
            return;
        }
        if (typeof extracted.delta === "string" && extracted.delta) {
            fullText += extracted.delta;
            onText?.(fullText);
        }
    };
    while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const normalized = buffer.replace(/\r\n/g, "\n");
        const chunks = normalized.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
            processEventBlock(chunk);
        }
        if (done) {
            const finalBuffer = decoder.decode();
            if (finalBuffer) {
                buffer += finalBuffer;
            }
            if (buffer.trim()) {
                processEventBlock(buffer);
            }
            break;
        }
    }
    return fullText;
}
async function buildOrderedPromptsForFlow(flow, components, body) {
    const orderedPrompts = await assembleOrderedPrompts(flow.prompt_order, components, { templateContext: body });
    const systemPrompt = flow.system_prompt?.trim() || "";
    if (systemPrompt) {
        orderedPrompts.push({ role: "system", content: systemPrompt });
    }
    orderedPrompts.push({ role: "user", content: JSON.stringify(body, null, 2) });
    return orderedPrompts;
}
function buildGenerateRawCustomApi(apiPreset, flow) {
    return {
        apiurl: apiPreset.api_url.trim(),
        model: apiPreset.model.trim().replace(/^models\//, ""),
        source: apiPreset.api_source?.trim() || "openai",
        max_tokens: flow.generation_options.max_reply_tokens,
        temperature: flow.generation_options.temperature,
        ...buildGenerateRawPenaltyFields(flow),
        top_p: flow.generation_options.top_p,
    };
}
function parseJsonFromText(rawText, flowId) {
    const preview = rawText.slice(0, 300);
    // CR-10: Try direct parse first — handles clean JSON output without regex issues
    try {
        const direct = JSON.parse(rawText.trim());
        if (direct && typeof direct === "object" && !Array.isArray(direct)) {
            return direct;
        }
    }
    catch {
        /* fall through to regex extraction */
    }
    const trimmed = rawText.trim();
    const withoutFence = trimmed
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
    try {
        const parsed = JSON.parse(withoutFence);
        if (!_.isPlainObject(parsed)) {
            throw new Error("model output is not a JSON object");
        }
        return parsed;
    }
    catch {
        const start = withoutFence.indexOf("{");
        const end = withoutFence.lastIndexOf("}");
        if (start >= 0 && end > start) {
            try {
                const sliced = withoutFence.slice(start, end + 1);
                const parsed = JSON.parse(sliced);
                if (!_.isPlainObject(parsed)) {
                    throw new Error("model output is not a JSON object");
                }
                return parsed;
            }
            catch (error) {
                throw new Error(`[${flowId}] JSON 解析失败: ${toErrorMessage(error)}\n` +
                    `原始响应前300字: ${preview}`);
            }
        }
        if (!trimmed) {
            throw new Error(`[${flowId}] 模型返回了空响应（可能被响应后处理正则清空）`);
        }
        throw new Error(`[${flowId}] 模型输出中找不到 JSON 对象\n` +
            `原始响应前300字: ${preview}`);
    }
}
/**
 * Apply per-flow response regex post-processing.
 *
 * Execution order:
 *  1. Remove regex — strip matched content (e.g. <thinking>...</thinking>)
 *  2. Extract regex — extract first capture group (e.g. <content>(.*)</content>)
 *
 * If neither is configured, returns rawText unchanged.
 */
function applyResponseRegex(rawText, flow) {
    let text = rawText;
    // Step 1: Remove
    const removePattern = flow.response_remove_regex?.trim();
    if (removePattern) {
        try {
            const before = text;
            text = text.replace(new RegExp(removePattern, "gis"), "");
            if (text.trim() !== before.trim()) {
                console.debug(`[${flow.id}] response_remove_regex matched: removed ${before.length - text.length} chars`);
            }
        }
        catch (e) {
            console.warn(`[${flow.id}] response_remove_regex "${removePattern}" is invalid (ignored): ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    // Step 2: Extract
    const extractPattern = flow.response_extract_regex?.trim();
    if (extractPattern) {
        try {
            const match = new RegExp(extractPattern, "is").exec(text);
            if (match) {
                // Use first capture group if available, else full match
                text = match[1] ?? match[0];
                console.debug(`[${flow.id}] response_extract_regex matched: extracted ${text.length} chars`);
            }
            else {
                console.warn(`[${flow.id}] response_extract_regex "${extractPattern}" did not match anything, using full text`);
            }
        }
        catch (e) {
            console.warn(`[${flow.id}] response_extract_regex "${extractPattern}" is invalid (ignored): ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    const result = text.trim();
    // Early warning: if post-processing emptied the response
    if (!result && rawText.trim()) {
        console.warn(`[${flow.id}] 响应后处理正则将整个响应清空了！原始长度=${rawText.length}, 请检查 remove/extract 正则配置。原始内容前200字: ${rawText.slice(0, 200)}`);
    }
    return result;
}
/**
 * 自动补全 AI 回复中的固定字段。
 * AI 可以省略 version / flow_id / status / priority / diagnostics，
 * 脚本在 Schema 校验前注入默认值。若 AI 已输出则不覆盖（向后兼容）。
 */
function normalizeAiResponse(raw, flowId, flowPriority) {
    if (!raw.version)
        raw.version = "ew-flow/v1";
    if (!raw.flow_id)
        raw.flow_id = flowId;
    if (!raw.status)
        raw.status = "ok";
    if (raw.priority === undefined)
        raw.priority = flowPriority;
    if (!raw.diagnostics)
        raw.diagnostics = {};
    return raw;
}
function resolveApiPreset(settings, flow) {
    const matchedPreset = settings.api_presets.find((preset) => preset.id === flow.api_preset_id);
    if (matchedPreset) {
        return matchedPreset;
    }
    const hasLegacyApiConfig = Boolean(flow.api_url.trim() || flow.api_key.trim() || flow.headers_json.trim());
    if (hasLegacyApiConfig) {
        return {
            id: "__legacy__",
            name: "兼容旧配置",
            mode: "workflow_http",
            use_main_api: false,
            api_url: flow.api_url,
            api_key: flow.api_key,
            model: "",
            api_source: "openai",
            model_candidates: [],
            headers_json: flow.headers_json,
        };
    }
    if (settings.api_presets.length > 0) {
        console.warn(`[EW] Flow "${flow.id}": api_preset_id "${flow.api_preset_id}" not found, falling back to first preset "${settings.api_presets[0].name}"`);
        return settings.api_presets[0];
    }
    throw new Error(`[${flow.id}] api preset not found`);
}
/**
 * 主 API 路径：通过 TavernHelper.generateRaw 使用酒馆当前配置的 API。
 */
async function executeFlowViaLlmConnector(flow, orderedPrompts, generationId, onStreamText, abortSignal, isCancelled) {
    throwIfDispatchAborted(abortSignal, isCancelled);
    const generateRawFn = resolveGenerateRaw();
    if (!generateRawFn) {
        throw new Error(`[${flow.id}] generateRaw is unavailable`);
    }
    const abortGeneration = () => stopSpecificGeneration(generationId);
    if (abortSignal) {
        if (abortSignal.aborted) {
            abortGeneration();
        }
        else {
            abortSignal.addEventListener("abort", abortGeneration, { once: true });
        }
    }
    const stopStreamListener = flow.generation_options.stream && onStreamText
        ? onEvent(EVENT_STREAM_TOKEN(), (fullText) => {
            onStreamText(fullText);
        })
        : null;
    try {
        const rawText = await generateRawFn({
            generation_id: generationId,
            should_stream: flow.generation_options.stream,
            should_silence: true,
            ordered_prompts: orderedPrompts,
        });
        throwIfDispatchAborted(abortSignal, isCancelled);
        const processed = applyResponseRegex(rawText, flow);
        const parsedJson = parseJsonFromText(processed, flow.id);
        normalizeAiResponse(parsedJson, flow.id, flow.priority);
        const parsed = FlowResponseSchema.safeParse(parsedJson);
        if (!parsed.success) {
            throw new Error(`[${flow.id}] response schema invalid: ${parsed.error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; ")}`);
        }
        return parsed.data;
    }
    finally {
        stopStreamListener?.();
        if (abortSignal) {
            abortSignal.removeEventListener("abort", abortGeneration);
        }
    }
}
async function executeFlowViaGenerateRawCustomApi(flow, apiPreset, orderedPrompts, generationId, onStreamText, abortSignal, isCancelled) {
    throwIfDispatchAborted(abortSignal, isCancelled);
    if (!apiPreset.api_url.trim()) {
        throw new Error(`[${flow.id}] custom api_url is empty`);
    }
    if (!apiPreset.model.trim()) {
        throw new Error(`[${flow.id}] model is empty`);
    }
    const generateRawFn = resolveGenerateRaw();
    if (!generateRawFn) {
        throw new Error(`[${flow.id}] generateRaw is unavailable`);
    }
    const customApi = buildGenerateRawCustomApi(apiPreset, flow);
    const abortGeneration = () => stopSpecificGeneration(generationId);
    if (abortSignal) {
        if (abortSignal.aborted) {
            abortGeneration();
        }
        else {
            abortSignal.addEventListener("abort", abortGeneration, { once: true });
        }
    }
    const stopStreamListener = flow.generation_options.stream && onStreamText
        ? onEvent(EVENT_STREAM_TOKEN(), (fullText) => {
            onStreamText(fullText);
        })
        : null;
    try {
        const rawText = await generateRawFn({
            generation_id: generationId,
            should_stream: flow.generation_options.stream,
            should_silence: true,
            custom_api: customApi,
            ordered_prompts: orderedPrompts,
        });
        throwIfDispatchAborted(abortSignal, isCancelled);
        const processed = applyResponseRegex(rawText, flow);
        const parsedJson = parseJsonFromText(processed, flow.id);
        normalizeAiResponse(parsedJson, flow.id, flow.priority);
        const parsed = FlowResponseSchema.safeParse(parsedJson);
        if (!parsed.success) {
            throw new Error(`[${flow.id}] response schema invalid: ${parsed.error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; ")}`);
        }
        return parsed.data;
    }
    finally {
        stopStreamListener?.();
        if (abortSignal) {
            abortSignal.removeEventListener("abort", abortGeneration);
        }
    }
}
/**
 * 自定义 API 路径：通过 ST 后端代理 /api/backends/chat-completions/generate 转发请求。
 * 直接控制 model / temperature / max_tokens 等参数，不依赖 TavernHelper。
 */
async function executeFlowViaChatCompletionsBackend(flow, requestBody, requestTargetLabel, onStreamText, abortSignal, isCancelled) {
    throwIfDispatchAborted(abortSignal, isCancelled);
    if (!String(requestBody.model ?? "").trim()) {
        throw new Error(`[${flow.id}] model is empty`);
    }
    const stHeaders = getStRequestHeaders();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), flow.timeout_ms);
    const abortFromOuter = () => controller.abort();
    if (abortSignal) {
        if (abortSignal.aborted) {
            controller.abort();
        }
        else {
            abortSignal.addEventListener("abort", abortFromOuter, { once: true });
        }
    }
    try {
        const response = await fetch("/api/backends/chat-completions/generate", {
            method: "POST",
            headers: stHeaders,
            body: JSON.stringify(requestBody),
            signal: controller.signal,
        });
        if (!response.ok) {
            const errTxt = await response.text();
            throw new Error(summarizeStBackendError(flow.id, response.status, requestTargetLabel, errTxt));
        }
        throwIfDispatchAborted(abortSignal, isCancelled);
        const rawText = requestBody.stream
            ? await readStreamingSseText(response, onStreamText)
            : await response
                .json()
                .then((data) => data?.choices?.[0]?.message?.content?.trim() ??
                data?.content?.trim() ??
                "");
        if (!rawText) {
            throw new Error(`[${flow.id}] API returned empty response`);
        }
        const processed = applyResponseRegex(rawText, flow);
        const parsedJson = parseJsonFromText(processed, flow.id);
        normalizeAiResponse(parsedJson, flow.id, flow.priority);
        const parsed = FlowResponseSchema.safeParse(parsedJson);
        if (!parsed.success) {
            throw new Error(`[${flow.id}] response schema invalid: ${parsed.error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; ")}`);
        }
        return parsed.data;
    }
    catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            if (isDispatchAborted(abortSignal, isCancelled)) {
                throw new Error("workflow cancelled by user");
            }
            throw new Error(`[${flow.id}] timeout (${flow.timeout_ms}ms)`);
        }
        throw error;
    }
    finally {
        clearTimeout(timeout);
        if (abortSignal) {
            abortSignal.removeEventListener("abort", abortFromOuter);
        }
    }
}
async function executeFlowViaStBackend(flow, apiPreset, orderedPrompts, onStreamText, abortSignal, isCancelled) {
    if (!apiPreset.api_url.trim()) {
        throw new Error(`[${flow.id}] custom api_url is empty`);
    }
    if (!apiPreset.model.trim()) {
        throw new Error(`[${flow.id}] model is empty`);
    }
    return executeFlowViaChatCompletionsBackend(flow, buildCustomStBackendRequestBody(flow, apiPreset, orderedPrompts), apiPreset.api_url.trim(), onStreamText, abortSignal, isCancelled);
}
async function executeFlowViaMainApiStBackend(flow, orderedPrompts, onStreamText, abortSignal, isCancelled) {
    const requestBody = buildMainApiStBackendRequestBody(flow, orderedPrompts);
    if (!requestBody) {
        throw new Error(`[${flow.id}] 当前主 API 不支持工作流静默流式桥接`);
    }
    const targetLabel = String(requestBody.custom_url || requestBody.reverse_proxy || "tavern://main_api");
    return executeFlowViaChatCompletionsBackend(flow, requestBody, targetLabel, onStreamText, abortSignal, isCancelled);
}
async function executeFlow(settings, flow, flowOrder, messageId, userInput, trigger, requestId, serialResults, contextCursor, jobType, writebackPolicy, rederiveOptions, abortSignal, isCancelled, onProgress) {
    const startedAt = Date.now();
    throwIfDispatchAborted(abortSignal, isCancelled);
    const apiPreset = resolveApiPreset(settings, flow);
    const usesTavernMain = apiPreset.mode === "llm_connector" || apiPreset.use_main_api;
    const attemptApiUrl = usesTavernMain
        ? "tavern://main_api"
        : apiPreset.api_url;
    const generationId = `${requestId}:${flow.id}`;
    const streamEnabled = flow.generation_options.stream;
    let lastStreamSignature = "";
    onProgress?.({
        phase: "flow_started",
        request_id: requestId,
        flow_id: flow.id,
        flow_name: flow.name,
        flow_order: flowOrder,
        generation_id: generationId,
        stream_enabled: streamEnabled,
        message: flow.name.trim()
            ? `正在执行工作流「${flow.name}」…`
            : `正在执行工作流 ${flow.id}…`,
    });
    const emitStreamProgress = (fullText) => {
        const preview = extractStreamPreview(fullText);
        const signature = `${preview?.entry_name ?? ""}\u0000${preview?.content ?? ""}\u0000${fullText.length}`;
        if (signature === lastStreamSignature) {
            return;
        }
        lastStreamSignature = signature;
        onProgress?.({
            phase: "streaming",
            request_id: requestId,
            flow_id: flow.id,
            flow_name: flow.name,
            flow_order: flowOrder,
            generation_id: generationId,
            stream_enabled: true,
            stream_text: fullText,
            stream_preview: preview,
        });
    };
    // Collect prompt components once — shared by buildFlowRequest (metadata) and assembler (messages)
    const promptComponentsPromise = collectPromptComponents(flow, settings);
    let request;
    let requestDebug;
    try {
        throwIfDispatchAborted(abortSignal, isCancelled);
        const promptComponents = await promptComponentsPromise;
        request = await buildFlowRequest({
            settings,
            flow,
            message_id: messageId,
            user_input: userInput,
            trigger,
            request_id: requestId,
            serial_results: serialResults,
            active_dyn_entry_names: collectActiveDynEntryNames(promptComponents, settings),
            context_cursor: contextCursor,
            job_type: jobType,
            writeback_policy: writebackPolicy,
            legacy_approx: Boolean(rederiveOptions?.legacy_approx),
        });
        const body = applyTemplate(request, flow.request_template);
        const orderedPrompts = await buildOrderedPromptsForFlow(flow, promptComponents, body);
        const mainApiStreamBridgeRequest = usesTavernMain && streamEnabled
            ? buildMainApiStBackendRequestBody(flow, orderedPrompts)
            : null;
        const requestDebugBase = {
            route: usesTavernMain
                ? mainApiStreamBridgeRequest
                    ? "/api/backends/chat-completions/generate (main_api stream bridge)"
                    : "generateRaw(main_api)"
                : shouldUseGenerateRawCustomApi(apiPreset)
                    ? streamEnabled
                        ? "/api/backends/chat-completions/generate (custom_api stream bridge)"
                        : "generateRaw(custom_api)"
                    : "/api/backends/chat-completions/generate",
            flow_request: request,
            assembled_messages: orderedPrompts,
        };
        let response;
        requestDebug = requestDebugBase;
        if (usesTavernMain) {
            if (mainApiStreamBridgeRequest) {
                requestDebug = {
                    ...requestDebugBase,
                    transport_request: mainApiStreamBridgeRequest,
                };
                response = await executeFlowViaMainApiStBackend(flow, orderedPrompts, emitStreamProgress, abortSignal, isCancelled);
            }
            else {
                requestDebug = {
                    ...requestDebugBase,
                    transport_request: {
                        generation_id: generationId,
                        should_stream: streamEnabled,
                        should_silence: true,
                        ordered_prompts: orderedPrompts,
                    },
                };
                response = await executeFlowViaLlmConnector(flow, orderedPrompts, generationId, streamEnabled ? emitStreamProgress : undefined, abortSignal, isCancelled);
            }
        }
        else if (shouldUseGenerateRawCustomApi(apiPreset)) {
            if (streamEnabled) {
                const streamBridgeRequest = buildCustomStBackendRequestBody(flow, apiPreset, orderedPrompts);
                requestDebug = {
                    ...requestDebugBase,
                    transport_request: streamBridgeRequest,
                };
                response = await executeFlowViaStBackend(flow, apiPreset, orderedPrompts, emitStreamProgress, abortSignal, isCancelled);
            }
            else {
                try {
                    requestDebug = {
                        ...requestDebugBase,
                        transport_request: {
                            generation_id: generationId,
                            should_stream: streamEnabled,
                            should_silence: true,
                            custom_api: buildGenerateRawCustomApi(apiPreset, flow),
                            ordered_prompts: orderedPrompts,
                        },
                    };
                    response = await executeFlowViaGenerateRawCustomApi(flow, apiPreset, orderedPrompts, generationId, undefined, abortSignal, isCancelled);
                }
                catch (error) {
                    if (!shouldFallbackFromGenerateRawCustomApiError(error)) {
                        throw error;
                    }
                    console.warn(`[EW] Flow "${flow.id}": generateRaw.custom_api failed, fallback to ST backend — ${toErrorMessage(error)}`);
                    const fallbackRequestBody = buildCustomStBackendRequestBody(flow, apiPreset, orderedPrompts);
                    requestDebug = {
                        ...requestDebugBase,
                        route: "/api/backends/chat-completions/generate (fallback)",
                        transport_request: fallbackRequestBody,
                    };
                    response = await executeFlowViaStBackend(flow, apiPreset, orderedPrompts, undefined, abortSignal, isCancelled);
                }
            }
        }
        else {
            const stBackendRequest = buildCustomStBackendRequestBody(flow, apiPreset, orderedPrompts);
            requestDebug = {
                ...requestDebugBase,
                transport_request: stBackendRequest,
            };
            response = await executeFlowViaStBackend(flow, apiPreset, orderedPrompts, streamEnabled ? emitStreamProgress : undefined, abortSignal, isCancelled);
        }
        throwIfDispatchAborted(abortSignal, isCancelled);
        onProgress?.({
            phase: "flow_finished",
            request_id: requestId,
            flow_id: flow.id,
            flow_name: flow.name,
            flow_order: flowOrder,
            flow_ok: true,
            generation_id: generationId,
            message: flow.name.trim()
                ? `工作流「${flow.name}」已完成。`
                : `工作流 ${flow.id} 已完成。`,
        });
        return {
            flow,
            flow_order: flowOrder,
            api_preset_id: apiPreset.id,
            api_preset_name: apiPreset.name,
            api_url: attemptApiUrl,
            request,
            request_debug: requestDebug,
            response,
            ok: true,
            elapsed_ms: Date.now() - startedAt,
        };
    }
    catch (error) {
        onProgress?.({
            phase: "flow_finished",
            request_id: requestId,
            flow_id: flow.id,
            flow_name: flow.name,
            flow_order: flowOrder,
            flow_ok: false,
            generation_id: generationId,
            message: flow.name.trim()
                ? `工作流「${flow.name}」执行失败。`
                : `工作流 ${flow.id} 执行失败。`,
        });
        return {
            flow,
            flow_order: flowOrder,
            api_preset_id: apiPreset.id,
            api_preset_name: apiPreset.name,
            api_url: attemptApiUrl,
            request,
            request_debug: requestDebug ?? {
                flow_request: request,
            },
            ok: false,
            error: toErrorMessage(error),
            elapsed_ms: Date.now() - startedAt,
        };
    }
}
export async function dispatchFlows(input) {
    const flows = input.flows.filter((flow) => flow.enabled);
    if (flows.length === 0) {
        throw new Error("no enabled flows");
    }
    const serialIntervalMs = Math.max(0, Math.round((input.settings.serial_dispatch_interval_seconds ?? 0) * 1000));
    const parallelIntervalMs = Math.max(0, Math.round((input.settings.parallel_dispatch_interval_seconds ?? 0) * 1000));
    if (input.settings.dispatch_mode === "serial") {
        const serialResults = [];
        const attempts = [];
        const outputs = [];
        for (const [index, flow] of flows.entries()) {
            if (index > 0 && serialIntervalMs > 0) {
                input.onProgress?.({
                    phase: "dispatching",
                    request_id: input.request_id,
                    flow_id: flow.id,
                    flow_name: flow.name,
                    flow_order: index,
                    message: `串行调度等待 ${input.settings.serial_dispatch_interval_seconds} 秒后发出下一条工作流…`,
                });
                await waitDispatchDelay(serialIntervalMs, input.abortSignal, input.isCancelled);
            }
            throwIfDispatchAborted(input.abortSignal, input.isCancelled);
            const attempt = await executeFlow(input.settings, flow, index, input.message_id, input.user_input, input.trigger, input.request_id, serialResults, input.context_cursor, input.job_type, input.writeback_policy, input.rederive_options, input.abortSignal, input.isCancelled, input.onProgress);
            attempts.push(attempt);
            if (!attempt.ok || !attempt.response) {
                throw new DispatchFlowsError(attempt.error ?? `[${flow.id}] failed`, attempts);
            }
            const output = {
                flow: attempt.flow,
                flow_order: attempt.flow_order,
                response: attempt.response,
            };
            outputs.push(output);
            serialResults.push({
                flow_id: output.response.flow_id,
                priority: output.response.priority,
                reply_instruction: output.response.reply_instruction,
                operations: output.response.operations,
                diagnostics: output.response.diagnostics,
            });
        }
        return { results: outputs, attempts };
    }
    const attempts = await Promise.all(flows.map(async (flow, index) => {
        const delayMs = parallelIntervalMs * index;
        if (delayMs > 0) {
            input.onProgress?.({
                phase: "dispatching",
                request_id: input.request_id,
                flow_id: flow.id,
                flow_name: flow.name,
                flow_order: index,
                message: `同一批次还有后续工作流待发出：工作流「${flow.name || flow.id}」将在 ${delayMs / 1000} 秒后开始请求…`,
            });
            await waitDispatchDelay(delayMs, input.abortSignal, input.isCancelled);
        }
        return executeFlow(input.settings, flow, index, input.message_id, input.user_input, input.trigger, input.request_id, [], input.context_cursor, input.job_type, input.writeback_policy, input.rederive_options, input.abortSignal, input.isCancelled, input.onProgress);
    }));
    throwIfDispatchAborted(input.abortSignal, input.isCancelled);
    const succeeded = attempts.filter((attempt) => attempt.ok && Boolean(attempt.response));
    const failed = attempts.filter((attempt) => !attempt.ok);
    if (failed.length > 0) {
        // CR-3: allow_partial_success — use whatever succeeded, only throw if nothing worked
        if (input.settings.failure_policy === "allow_partial_success") {
            if (succeeded.length === 0) {
                throw new DispatchFlowsError(failed.map((f) => f.error ?? `[${f.flow.id}] failed`).join("; "), attempts);
            }
            console.warn(`[EW] allow_partial_success: ${failed.length} flow(s) failed, ${succeeded.length} succeeded — using partial results`);
        }
        else {
            // Default: any failure → throw
            const first = failed[0];
            throw new DispatchFlowsError(first.error ?? `[${first.flow.id}] failed`, attempts);
        }
    }
    return {
        results: succeeded.map((attempt) => ({
            flow: attempt.flow,
            flow_order: attempt.flow_order,
            response: attempt.response,
        })),
        attempts,
    };
}
//# sourceMappingURL=dispatcher.js.map