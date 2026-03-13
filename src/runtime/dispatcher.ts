import { buildFlowRequest } from './context-builder';
import { FlowResponseSchema, FlowTriggerV1 } from './contracts';
import { assembleOrderedPrompts, collectPromptComponents, PromptComponents } from './prompt-assembler';
import {
  DispatchFlowAttempt,
  DispatchFlowResult,
  EwApiPreset,
  EwFlowConfig,
  EwSettings,
  WorkflowProgressUpdate,
  WorkflowStreamPreview,
} from './types';

type DispatchInput = {
  settings: EwSettings;
  flows: EwFlowConfig[];
  message_id: number;
  user_input?: string;
  trigger?: FlowTriggerV1;
  request_id: string;
  abortSignal?: AbortSignal;
  isCancelled?: () => boolean;
  onProgress?: (update: WorkflowProgressUpdate) => void;
};

export type DispatchFlowsOutput = {
  results: DispatchFlowResult[];
  attempts: DispatchFlowAttempt[];
};

export class DispatchFlowsError extends Error {
  attempts: DispatchFlowAttempt[];

  constructor(message: string, attempts: DispatchFlowAttempt[]) {
    super(message);
    this.name = 'DispatchFlowsError';
    this.attempts = attempts;
  }
}

export const DEFAULT_WORKFLOW_SYSTEM_PROMPT = [
  '你是 Evolution World 的工作流执行器。',
  '你会收到一个 FlowRequestV1 JSON，请返回一个 JSON 对象。',
  '输出必须包含一个有效的 JSON 对象。允许使用 <thinking> 等标签进行思考推理，插件会自动提取 JSON 内容。',
  'operations.worldbook 字段必须存在（允许为空数组）。',
  'version/flow_id/status/priority 等固定字段可省略，插件会自动补全。',
].join('\n');

function getHostRuntime(): Record<string, any> {
  try {
    if (window.parent && window.parent !== window) {
      return window.parent as unknown as Record<string, any>;
    }
  } catch {
    // ignore cross-frame access failures and fall back to current window
  }

  return globalThis as Record<string, any>;
}

function resolveGenerateRaw(): ((options: Record<string, any>) => Promise<string>) | null {
  const hostRuntime = getHostRuntime();
  if (typeof hostRuntime.generateRaw === 'function') {
    return hostRuntime.generateRaw as (options: Record<string, any>) => Promise<string>;
  }
  if (typeof hostRuntime.TavernHelper?.generateRaw === 'function') {
    return hostRuntime.TavernHelper.generateRaw as (options: Record<string, any>) => Promise<string>;
  }
  return null;
}

function getStRequestHeaders(): Record<string, string> {
  const hostRuntime = getHostRuntime();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (typeof hostRuntime.SillyTavern?.getRequestHeaders === 'function') {
    Object.assign(headers, hostRuntime.SillyTavern.getRequestHeaders());
  } else if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getRequestHeaders === 'function') {
    Object.assign(headers, SillyTavern.getRequestHeaders());
  }

  headers['Content-Type'] = 'application/json';
  return headers;
}

function getSillyTavernContext(): Record<string, any> | undefined {
  const hostRuntime = getHostRuntime();
  const localRuntime = globalThis as Record<string, any>;

  if (typeof hostRuntime.SillyTavern?.getContext === 'function') {
    return hostRuntime.SillyTavern.getContext();
  }

  if (typeof localRuntime.SillyTavern?.getContext === 'function') {
    return localRuntime.SillyTavern.getContext();
  }

  return undefined;
}

function isDispatchAborted(signal?: AbortSignal, isCancelled?: () => boolean): boolean {
  return Boolean(signal?.aborted || isCancelled?.());
}

function throwIfDispatchAborted(signal?: AbortSignal, isCancelled?: () => boolean): void {
  if (isDispatchAborted(signal, isCancelled)) {
    throw new Error('workflow cancelled by user');
  }
}

function buildTemplateContext(base: Record<string, any>): Record<string, any> {
  const userInput = typeof base.user_input === 'string' ? base.user_input : '';
  return _.merge({}, base, {
    lastUserMessage: userInput,
    last_user_message: userInput,
    userInput,
  });
}

function applyTemplate(base: Record<string, any>, templateText: string): Record<string, any> {
  if (!templateText.trim()) {
    return base;
  }

  const templateContext = buildTemplateContext(base);

  const replaced = templateText.replace(/\{\{\s*([a-zA-Z0-9_.$]+)\s*\}\}/g, (_match, path) => {
    const value = _.get(templateContext, path);
    if (_.isPlainObject(value) || Array.isArray(value)) {
      return JSON.stringify(value);
    }
    return value === undefined ? '' : String(value);
  });

  let templateObject: Record<string, any>;
  try {
    const parsed = JSON.parse(replaced);
    if (!_.isPlainObject(parsed)) {
      throw new Error('request_template must parse to JSON object');
    }
    templateObject = parsed as Record<string, any>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`flow request_template invalid: ${message}`);
  }

  return _.merge({}, base, templateObject);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function parseStBackendErrorPayload(errTxt: string): {
  message: string;
  code?: string;
  type?: string;
} | null {
  try {
    const parsed = JSON.parse(errTxt);
    const payload = parsed?.error;
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    return {
      message: typeof payload.message === 'string' ? payload.message : String(payload.message ?? ''),
      code: typeof payload.code === 'string' ? payload.code : undefined,
      type: typeof payload.type === 'string' ? payload.type : undefined,
    };
  } catch {
    return null;
  }
}

function getApiHostLabel(apiUrl: string): string {
  try {
    return new URL(apiUrl).host || apiUrl;
  } catch {
    return apiUrl;
  }
}

function summarizeStBackendError(flowId: string, status: number, apiUrl: string, errTxt: string): string {
  const payload = parseStBackendErrorPayload(errTxt);
  const host = getApiHostLabel(apiUrl);
  const rawMessage = payload?.message || errTxt;
  const normalizedMessage = rawMessage.replace(/\s+/g, ' ').trim();
  const code = payload?.code ?? (normalizedMessage.includes('ECONNRESET') ? 'ECONNRESET' : undefined);

  if (
    code === 'ECONNRESET' ||
    /secure TLS connection was not established/i.test(normalizedMessage) ||
    /Client network socket disconnected/i.test(normalizedMessage)
  ) {
    return `[${flowId}] 上游 API 连接失败：与 ${host} 建立安全连接时被重置（HTTP ${status}${code ? ` / ${code}` : ''}）`;
  }

  if (code === 'ETIMEDOUT' || /timed? out/i.test(normalizedMessage)) {
    return `[${flowId}] 上游 API 连接超时：${host}（HTTP ${status}${code ? ` / ${code}` : ''}）`;
  }

  if (payload?.message) {
    return `[${flowId}] 上游 API 请求失败：${payload.message}${code ? ` (${code})` : ''}`;
  }

  const compact = normalizedMessage.length > 180 ? `${normalizedMessage.slice(0, 180)}...` : normalizedMessage;
  return `[${flowId}] ST backend error: ${status} ${compact}`;
}

function parseHeadersJson(headersJson: string): Record<string, string> {
  const trimmed = headersJson.trim();
  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('headers_json must be a JSON object');
    }

    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [String(key), String(value)]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`headers_json invalid: ${message}`);
  }
}

function buildCustomIncludeHeaders(apiPreset: EwApiPreset): string {
  const headers = parseHeadersJson(apiPreset.headers_json);

  if (apiPreset.api_key.trim()) {
    headers.Authorization = `Bearer ${apiPreset.api_key.trim()}`;
  }

  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

function shouldUseGenerateRawCustomApi(apiPreset: EwApiPreset): boolean {
  return !apiPreset.headers_json.trim();
}

function resolveCurrentChatCompletionModel(context: Record<string, any> | undefined): string {
  const getChatCompletionModel = context?.getChatCompletionModel;
  if (typeof getChatCompletionModel === 'function') {
    const resolved = getChatCompletionModel(context?.chatCompletionSettings);
    if (typeof resolved === 'string' && resolved.trim()) {
      return resolved.trim();
    }
  }

  const settings = context?.chatCompletionSettings;
  const source = String(settings?.chat_completion_source ?? '').trim();
  const modelBySource: Record<string, string | undefined> = {
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

  return String(modelBySource[source] ?? '').trim();
}

function buildMainApiStBackendRequestBody(
  flow: EwFlowConfig,
  orderedPrompts: Array<{ role: 'system' | 'assistant' | 'user'; content: string }>,
): Record<string, any> | null {
  const context = getSillyTavernContext();
  const mainApi = String(context?.mainApi ?? context?.main_api ?? '')
    .trim()
    .toLowerCase();
  if (mainApi !== 'openai') {
    return null;
  }

  const chatSettings = context?.chatCompletionSettings;
  if (!chatSettings || typeof chatSettings !== 'object') {
    return null;
  }

  const model = resolveCurrentChatCompletionModel(context).replace(/^models\//, '');
  if (!model) {
    return null;
  }

  return {
    messages: orderedPrompts,
    model,
    max_tokens: flow.generation_options.max_reply_tokens,
    temperature: flow.generation_options.temperature,
    top_p: flow.generation_options.top_p,
    frequency_penalty: flow.generation_options.frequency_penalty,
    presence_penalty: flow.generation_options.presence_penalty,
    stream: flow.generation_options.stream,
    chat_completion_source: String(chatSettings.chat_completion_source ?? 'openai'),
    group_names: [],
    include_reasoning: flow.behavior_options.request_thinking,
    reasoning_effort: flow.behavior_options.reasoning_effort,
    verbosity: flow.behavior_options.verbosity,
    enable_web_search: false,
    request_images: flow.behavior_options.send_inline_media,
    reverse_proxy: String(chatSettings.reverse_proxy ?? ''),
    proxy_password: String(chatSettings.proxy_password ?? ''),
    custom_url: String(chatSettings.custom_url ?? ''),
    custom_include_headers: String(chatSettings.custom_include_headers ?? ''),
    custom_include_body: String(chatSettings.custom_include_body ?? ''),
    custom_exclude_body: String(chatSettings.custom_exclude_body ?? ''),
    custom_prompt_post_processing: String(chatSettings.custom_prompt_post_processing ?? 'strict'),
    use_sysprompt: Boolean(chatSettings.use_sysprompt),
    assistant_prefill: String(chatSettings.assistant_prefill ?? ''),
    assistant_impersonation: String(chatSettings.assistant_impersonation ?? ''),
    continue_prefill: flow.behavior_options.continue_prefill || Boolean(chatSettings.continue_prefill),
    squash_system_messages: flow.behavior_options.squash_system_messages,
  };
}

function buildCustomStBackendRequestBody(
  flow: EwFlowConfig,
  apiPreset: EwApiPreset,
  orderedPrompts: Array<{ role: 'system' | 'assistant' | 'user'; content: string }>,
): Record<string, any> {
  return {
    messages: orderedPrompts,
    model: apiPreset.model.trim().replace(/^models\//, ''),
    max_tokens: flow.generation_options.max_reply_tokens,
    temperature: flow.generation_options.temperature,
    top_p: flow.generation_options.top_p,
    frequency_penalty: flow.generation_options.frequency_penalty,
    presence_penalty: flow.generation_options.presence_penalty,
    stream: flow.generation_options.stream,
    chat_completion_source: 'custom',
    group_names: [],
    include_reasoning: flow.behavior_options.request_thinking,
    reasoning_effort: flow.behavior_options.reasoning_effort,
    enable_web_search: false,
    request_images: flow.behavior_options.send_inline_media,
    reverse_proxy: apiPreset.api_url.trim(),
    proxy_password: '',
    custom_url: apiPreset.api_url.trim(),
    custom_include_headers: buildCustomIncludeHeaders(apiPreset),
    custom_prompt_post_processing: 'strict',
  };
}

function extractLatestJsonStringField(source: string, fieldName: string): { raw: string; index: number } | null {
  const pattern = new RegExp(`\\"${fieldName}\\"\\s*:\\s*\\"`, 'g');
  let match: RegExpExecArray | null;
  let last: { raw: string; index: number } | null = null;

  while ((match = pattern.exec(source))) {
    const start = match.index + match[0].length;
    let raw = '';
    let escaped = false;

    for (let cursor = start; cursor < source.length; cursor += 1) {
      const char = source[cursor];
      if (escaped) {
        raw += char;
        escaped = false;
        continue;
      }
      if (char === '\\') {
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

function decodePartialJsonString(raw: string): string {
  let result = '';

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char !== '\\') {
      result += char;
      continue;
    }

    const next = raw[index + 1];
    if (!next) {
      break;
    }

    index += 1;
    switch (next) {
      case 'n':
        result += '\n';
        break;
      case 'r':
        result += '\r';
        break;
      case 't':
        result += '\t';
        break;
      case 'b':
        result += '\b';
        break;
      case 'f':
        result += '\f';
        break;
      case '"':
      case '\\':
      case '/':
        result += next;
        break;
      case 'u': {
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

function extractStreamPreview(fullText: string): WorkflowStreamPreview | undefined {
  const desiredEntriesIndex = fullText.lastIndexOf('"desired_entries"');
  const searchArea = desiredEntriesIndex >= 0 ? fullText.slice(desiredEntriesIndex) : fullText;
  const nameField = extractLatestJsonStringField(searchArea, 'name');
  const contentField = extractLatestJsonStringField(searchArea, 'content');

  if (!nameField && !contentField) {
    return undefined;
  }

  const entryName = nameField ? decodePartialJsonString(nameField.raw).trim() : '';
  const content = contentField ? decodePartialJsonString(contentField.raw).replace(/\s+/g, ' ').trim() : '';

  if (!entryName && !content) {
    return undefined;
  }

  return {
    entry_name: entryName,
    content,
  };
}

function extractStreamDeltaFromPayload(payload: any): { delta?: string; full?: string } {
  const openAiDelta = payload?.choices?.[0]?.delta?.content;
  if (typeof openAiDelta === 'string' && openAiDelta) {
    return { delta: openAiDelta };
  }

  const openAiFull = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text ?? payload?.content;
  if (typeof openAiFull === 'string' && openAiFull) {
    return { full: openAiFull };
  }

  const anthropicDelta = payload?.delta?.text ?? payload?.content_block?.text;
  if (typeof anthropicDelta === 'string' && anthropicDelta) {
    return { delta: anthropicDelta };
  }

  const candidatesText = payload?.candidates?.[0]?.content?.parts
    ?.map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
    .join('');
  if (typeof candidatesText === 'string' && candidatesText) {
    return { full: candidatesText };
  }

  return {};
}

async function readStreamingSseText(response: Response, onText?: (fullText: string) => void): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('stream response body is unavailable');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  const processEventBlock = (block: string) => {
    const trimmed = block.trim();
    if (!trimmed) {
      return;
    }

    const dataLines = trimmed
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim());

    if (!dataLines.length) {
      return;
    }

    const payloadText = dataLines.join('\n');
    if (!payloadText || payloadText === '[DONE]') {
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(payloadText);
    } catch {
      return;
    }

    const extracted = extractStreamDeltaFromPayload(parsed);
    if (typeof extracted.full === 'string' && extracted.full) {
      fullText = extracted.full;
      onText?.(fullText);
      return;
    }
    if (typeof extracted.delta === 'string' && extracted.delta) {
      fullText += extracted.delta;
      onText?.(fullText);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    const normalized = buffer.replace(/\r\n/g, '\n');
    const chunks = normalized.split('\n\n');
    buffer = chunks.pop() ?? '';
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

async function buildOrderedPromptsForFlow(
  flow: EwFlowConfig,
  components: PromptComponents,
  body: Record<string, any>,
): Promise<Array<{ role: 'system' | 'assistant' | 'user'; content: string }>> {
  const orderedPrompts = await assembleOrderedPrompts(flow.prompt_order, components, { templateContext: body });
  const systemPrompt = flow.system_prompt?.trim() || '';
  if (systemPrompt) {
    orderedPrompts.push({ role: 'system', content: systemPrompt });
  }
  orderedPrompts.push({ role: 'user', content: JSON.stringify(body, null, 2) });
  return orderedPrompts;
}

function stopSpecificGeneration(generationId: string): void {
  try {
    if (typeof stopGenerationById === 'function' && stopGenerationById(generationId)) {
      return;
    }
  } catch {
    // ignore and fall through to stopAllGeneration
  }

  try {
    stopAllGeneration();
  } catch {
    // ignore
  }
}

function buildGenerateRawCustomApi(
  apiPreset: EwApiPreset,
  flow: EwFlowConfig,
): {
  apiurl: string;
  key?: string;
  model: string;
  source?: string;
  max_tokens?: 'same_as_preset' | 'unset' | number;
  temperature?: 'same_as_preset' | 'unset' | number;
  frequency_penalty?: 'same_as_preset' | 'unset' | number;
  presence_penalty?: 'same_as_preset' | 'unset' | number;
  top_p?: 'same_as_preset' | 'unset' | number;
} {
  return {
    apiurl: apiPreset.api_url.trim(),
    key: apiPreset.api_key.trim() || undefined,
    model: apiPreset.model.trim().replace(/^models\//, ''),
    source: apiPreset.api_source?.trim() || 'openai',
    max_tokens: flow.generation_options.max_reply_tokens,
    temperature: flow.generation_options.temperature,
    frequency_penalty: flow.generation_options.frequency_penalty,
    presence_penalty: flow.generation_options.presence_penalty,
    top_p: flow.generation_options.top_p,
  };
}

function parseJsonFromText(rawText: string, flowId: string): Record<string, any> {
  const preview = rawText.slice(0, 300);

  // CR-10: Try direct parse first — handles clean JSON output without regex issues
  try {
    const direct = JSON.parse(rawText.trim());
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct;
    }
  } catch {
    /* fall through to regex extraction */
  }
  const trimmed = rawText.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(withoutFence);
    if (!_.isPlainObject(parsed)) {
      throw new Error('model output is not a JSON object');
    }
    return parsed as Record<string, any>;
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const sliced = withoutFence.slice(start, end + 1);
        const parsed = JSON.parse(sliced);
        if (!_.isPlainObject(parsed)) {
          throw new Error('model output is not a JSON object');
        }
        return parsed as Record<string, any>;
      } catch (error) {
        throw new Error(`[${flowId}] JSON 解析失败: ${toErrorMessage(error)}\n` + `原始响应前300字: ${preview}`);
      }
    }
    if (!trimmed) {
      throw new Error(`[${flowId}] 模型返回了空响应（可能被响应后处理正则清空）`);
    }
    throw new Error(`[${flowId}] 模型输出中找不到 JSON 对象\n` + `原始响应前300字: ${preview}`);
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
function applyResponseRegex(rawText: string, flow: EwFlowConfig): string {
  let text = rawText;

  // Step 1: Remove
  const removePattern = flow.response_remove_regex?.trim();
  if (removePattern) {
    try {
      const before = text;
      text = text.replace(new RegExp(removePattern, 'gis'), '');
      if (text.trim() !== before.trim()) {
        console.debug(`[${flow.id}] response_remove_regex matched: removed ${before.length - text.length} chars`);
      }
    } catch (e) {
      console.warn(
        `[${flow.id}] response_remove_regex "${removePattern}" is invalid (ignored): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Step 2: Extract
  const extractPattern = flow.response_extract_regex?.trim();
  if (extractPattern) {
    try {
      const match = new RegExp(extractPattern, 'is').exec(text);
      if (match) {
        // Use first capture group if available, else full match
        text = match[1] ?? match[0];
        console.debug(`[${flow.id}] response_extract_regex matched: extracted ${text.length} chars`);
      } else {
        console.warn(`[${flow.id}] response_extract_regex "${extractPattern}" did not match anything, using full text`);
      }
    } catch (e) {
      console.warn(
        `[${flow.id}] response_extract_regex "${extractPattern}" is invalid (ignored): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const result = text.trim();

  // Early warning: if post-processing emptied the response
  if (!result && rawText.trim()) {
    console.warn(
      `[${flow.id}] 响应后处理正则将整个响应清空了！原始长度=${rawText.length}, 请检查 remove/extract 正则配置。原始内容前200字: ${rawText.slice(0, 200)}`,
    );
  }

  return result;
}

/**
 * 自动补全 AI 回复中的固定字段。
 * AI 可以省略 version / flow_id / status / priority / diagnostics，
 * 脚本在 Schema 校验前注入默认值。若 AI 已输出则不覆盖（向后兼容）。
 */
function normalizeAiResponse(raw: Record<string, any>, flowId: string, flowPriority: number): Record<string, any> {
  if (!raw.version) raw.version = 'ew-flow/v1';
  if (!raw.flow_id) raw.flow_id = flowId;
  if (!raw.status) raw.status = 'ok';
  if (raw.priority === undefined) raw.priority = flowPriority;
  if (!raw.diagnostics) raw.diagnostics = {};
  return raw;
}

function resolveApiPreset(settings: EwSettings, flow: EwFlowConfig): EwApiPreset {
  const matchedPreset = settings.api_presets.find(preset => preset.id === flow.api_preset_id);
  if (matchedPreset) {
    return matchedPreset;
  }

  const hasLegacyApiConfig = Boolean(flow.api_url.trim() || flow.api_key.trim() || flow.headers_json.trim());
  if (hasLegacyApiConfig) {
    return {
      id: '__legacy__',
      name: '兼容旧配置',
      mode: 'workflow_http',
      use_main_api: false,
      api_url: flow.api_url,
      api_key: flow.api_key,
      model: '',
      api_source: 'openai',
      model_candidates: [],
      headers_json: flow.headers_json,
    };
  }

  if (settings.api_presets.length > 0) {
    console.warn(
      `[EW] Flow "${flow.id}": api_preset_id "${flow.api_preset_id}" not found, falling back to first preset "${settings.api_presets[0].name}"`,
    );
    return settings.api_presets[0];
  }

  throw new Error(`[${flow.id}] api preset not found`);
}

/**
 * 主 API 路径：通过 TavernHelper.generateRaw 使用酒馆当前配置的 API。
 */
async function executeFlowViaLlmConnector(
  flow: EwFlowConfig,
  orderedPrompts: Array<{ role: 'system' | 'assistant' | 'user'; content: string }>,
  generationId: string,
  onStreamText?: (fullText: string) => void,
  abortSignal?: AbortSignal,
  isCancelled?: () => boolean,
): Promise<NonNullable<DispatchFlowAttempt['response']>> {
  throwIfDispatchAborted(abortSignal, isCancelled);
  const generateRawFn = resolveGenerateRaw();
  if (!generateRawFn) {
    throw new Error(`[${flow.id}] generateRaw is unavailable`);
  }

  const abortGeneration = () => stopSpecificGeneration(generationId);
  if (abortSignal) {
    if (abortSignal.aborted) {
      abortGeneration();
    } else {
      abortSignal.addEventListener('abort', abortGeneration, { once: true });
    }
  }

  const stopStreamListener =
    flow.generation_options.stream && onStreamText
      ? eventOn(iframe_events.STREAM_TOKEN_RECEIVED_FULLY, (fullText, streamGenerationId) => {
          if (streamGenerationId === generationId) {
            onStreamText(fullText);
          }
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
      throw new Error(
        `[${flow.id}] response schema invalid: ${parsed.error.issues
          .map(issue => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    return parsed.data;
  } finally {
    stopStreamListener?.stop();
    if (abortSignal) {
      abortSignal.removeEventListener('abort', abortGeneration);
    }
  }
}

async function executeFlowViaGenerateRawCustomApi(
  flow: EwFlowConfig,
  apiPreset: EwApiPreset,
  orderedPrompts: Array<{ role: 'system' | 'assistant' | 'user'; content: string }>,
  generationId: string,
  onStreamText?: (fullText: string) => void,
  abortSignal?: AbortSignal,
  isCancelled?: () => boolean,
): Promise<NonNullable<DispatchFlowAttempt['response']>> {
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
    } else {
      abortSignal.addEventListener('abort', abortGeneration, { once: true });
    }
  }

  const stopStreamListener =
    flow.generation_options.stream && onStreamText
      ? eventOn(iframe_events.STREAM_TOKEN_RECEIVED_FULLY, (fullText, streamGenerationId) => {
          if (streamGenerationId === generationId) {
            onStreamText(fullText);
          }
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
      throw new Error(
        `[${flow.id}] response schema invalid: ${parsed.error.issues
          .map(issue => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    return parsed.data;
  } finally {
    stopStreamListener?.stop();
    if (abortSignal) {
      abortSignal.removeEventListener('abort', abortGeneration);
    }
  }
}

/**
 * 自定义 API 路径：通过 ST 后端代理 /api/backends/chat-completions/generate 转发请求。
 * 直接控制 model / temperature / max_tokens 等参数，不依赖 TavernHelper。
 */
async function executeFlowViaChatCompletionsBackend(
  flow: EwFlowConfig,
  requestBody: Record<string, any>,
  requestTargetLabel: string,
  onStreamText?: (fullText: string) => void,
  abortSignal?: AbortSignal,
  isCancelled?: () => boolean,
): Promise<NonNullable<DispatchFlowAttempt['response']>> {
  throwIfDispatchAborted(abortSignal, isCancelled);
  if (!String(requestBody.model ?? '').trim()) {
    throw new Error(`[${flow.id}] model is empty`);
  }

  const stHeaders = getStRequestHeaders();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), flow.timeout_ms);
  const abortFromOuter = () => controller.abort();

  if (abortSignal) {
    if (abortSignal.aborted) {
      controller.abort();
    } else {
      abortSignal.addEventListener('abort', abortFromOuter, { once: true });
    }
  }

  try {
    const response = await fetch('/api/backends/chat-completions/generate', {
      method: 'POST',
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
      : await response.json().then(data => data?.choices?.[0]?.message?.content?.trim() ?? data?.content?.trim() ?? '');

    if (!rawText) {
      throw new Error(`[${flow.id}] API returned empty response`);
    }

    const processed = applyResponseRegex(rawText, flow);
    const parsedJson = parseJsonFromText(processed, flow.id);
    normalizeAiResponse(parsedJson, flow.id, flow.priority);
    const parsed = FlowResponseSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new Error(
        `[${flow.id}] response schema invalid: ${parsed.error.issues
          .map(issue => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      if (isDispatchAborted(abortSignal, isCancelled)) {
        throw new Error('workflow cancelled by user');
      }
      throw new Error(`[${flow.id}] timeout (${flow.timeout_ms}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (abortSignal) {
      abortSignal.removeEventListener('abort', abortFromOuter);
    }
  }
}

async function executeFlowViaStBackend(
  flow: EwFlowConfig,
  apiPreset: EwApiPreset,
  orderedPrompts: Array<{ role: 'system' | 'assistant' | 'user'; content: string }>,
  onStreamText?: (fullText: string) => void,
  abortSignal?: AbortSignal,
  isCancelled?: () => boolean,
): Promise<NonNullable<DispatchFlowAttempt['response']>> {
  if (!apiPreset.api_url.trim()) {
    throw new Error(`[${flow.id}] custom api_url is empty`);
  }
  if (!apiPreset.model.trim()) {
    throw new Error(`[${flow.id}] model is empty`);
  }

  return executeFlowViaChatCompletionsBackend(
    flow,
    buildCustomStBackendRequestBody(flow, apiPreset, orderedPrompts),
    apiPreset.api_url.trim(),
    onStreamText,
    abortSignal,
    isCancelled,
  );
}

async function executeFlowViaMainApiStBackend(
  flow: EwFlowConfig,
  orderedPrompts: Array<{ role: 'system' | 'assistant' | 'user'; content: string }>,
  onStreamText?: (fullText: string) => void,
  abortSignal?: AbortSignal,
  isCancelled?: () => boolean,
): Promise<NonNullable<DispatchFlowAttempt['response']>> {
  const requestBody = buildMainApiStBackendRequestBody(flow, orderedPrompts);
  if (!requestBody) {
    throw new Error(`[${flow.id}] 当前主 API 不支持工作流静默流式桥接`);
  }

  const targetLabel = String(requestBody.custom_url || requestBody.reverse_proxy || 'tavern://main_api');
  return executeFlowViaChatCompletionsBackend(flow, requestBody, targetLabel, onStreamText, abortSignal, isCancelled);
}

async function executeFlow(
  settings: EwSettings,
  flow: EwFlowConfig,
  flowOrder: number,
  messageId: number,
  userInput: string | undefined,
  trigger: FlowTriggerV1 | undefined,
  requestId: string,
  serialResults: Record<string, any>[],
  abortSignal?: AbortSignal,
  isCancelled?: () => boolean,
  onProgress?: (update: WorkflowProgressUpdate) => void,
): Promise<DispatchFlowAttempt> {
  const startedAt = Date.now();
  throwIfDispatchAborted(abortSignal, isCancelled);
  const apiPreset = resolveApiPreset(settings, flow);
  const usesTavernMain = apiPreset.mode === 'llm_connector' || apiPreset.use_main_api;
  const attemptApiUrl = usesTavernMain ? 'tavern://main_api' : apiPreset.api_url;
  const generationId = `${requestId}:${flow.id}`;
  const streamEnabled = flow.generation_options.stream;
  let lastStreamSignature = '';

  onProgress?.({
    phase: 'flow_started',
    request_id: requestId,
    flow_id: flow.id,
    flow_name: flow.name,
    flow_order: flowOrder,
    generation_id: generationId,
    stream_enabled: streamEnabled,
    message: flow.name.trim() ? `正在执行工作流「${flow.name}」…` : `正在执行工作流 ${flow.id}…`,
  });

  const emitStreamProgress = (fullText: string) => {
    const preview = extractStreamPreview(fullText);
    const signature = `${preview?.entry_name ?? ''}\u0000${preview?.content ?? ''}\u0000${fullText.length}`;
    if (signature === lastStreamSignature) {
      return;
    }
    lastStreamSignature = signature;
    onProgress?.({
      phase: 'streaming',
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

  const request = await buildFlowRequest({
    settings,
    flow,
    message_id: messageId,
    user_input: userInput,
    trigger,
    request_id: requestId,
    serial_results: serialResults,
  });

  try {
    throwIfDispatchAborted(abortSignal, isCancelled);
    const body = applyTemplate(request as unknown as Record<string, any>, flow.request_template);
    const promptComponents = await promptComponentsPromise;
    const orderedPrompts = await buildOrderedPromptsForFlow(flow, promptComponents, body);
    const mainApiStreamBridgeRequest =
      usesTavernMain && streamEnabled ? buildMainApiStBackendRequestBody(flow, orderedPrompts) : null;
    const requestDebugBase = {
      route: usesTavernMain
        ? mainApiStreamBridgeRequest
          ? '/api/backends/chat-completions/generate (main_api stream bridge)'
          : 'generateRaw(main_api)'
        : shouldUseGenerateRawCustomApi(apiPreset)
          ? streamEnabled
            ? '/api/backends/chat-completions/generate (custom_api stream bridge)'
            : 'generateRaw(custom_api)'
          : '/api/backends/chat-completions/generate',
      flow_request: request,
      assembled_messages: orderedPrompts,
    };

    let response: NonNullable<DispatchFlowAttempt['response']>;
    let requestDebug = requestDebugBase as Record<string, any>;

    if (usesTavernMain) {
      if (mainApiStreamBridgeRequest) {
        requestDebug = {
          ...requestDebugBase,
          transport_request: mainApiStreamBridgeRequest,
        };
        response = await executeFlowViaMainApiStBackend(
          flow,
          orderedPrompts,
          emitStreamProgress,
          abortSignal,
          isCancelled,
        );
      } else {
        requestDebug = {
          ...requestDebugBase,
          transport_request: {
            generation_id: generationId,
            should_stream: streamEnabled,
            should_silence: true,
            ordered_prompts: orderedPrompts,
          },
        };
        response = await executeFlowViaLlmConnector(
          flow,
          orderedPrompts,
          generationId,
          streamEnabled ? emitStreamProgress : undefined,
          abortSignal,
          isCancelled,
        );
      }
    } else if (shouldUseGenerateRawCustomApi(apiPreset)) {
      if (streamEnabled) {
        const streamBridgeRequest = buildCustomStBackendRequestBody(flow, apiPreset, orderedPrompts);
        requestDebug = {
          ...requestDebugBase,
          transport_request: streamBridgeRequest,
        };
        response = await executeFlowViaStBackend(
          flow,
          apiPreset,
          orderedPrompts,
          emitStreamProgress,
          abortSignal,
          isCancelled,
        );
      } else {
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
          response = await executeFlowViaGenerateRawCustomApi(
            flow,
            apiPreset,
            orderedPrompts,
            generationId,
            undefined,
            abortSignal,
            isCancelled,
          );
        } catch (error) {
          console.warn(
            `[EW] Flow "${flow.id}": generateRaw.custom_api failed, fallback to ST backend — ${toErrorMessage(error)}`,
          );
          const fallbackRequestBody = buildCustomStBackendRequestBody(flow, apiPreset, orderedPrompts);
          requestDebug = {
            ...requestDebugBase,
            route: '/api/backends/chat-completions/generate (fallback)',
            transport_request: fallbackRequestBody,
          };
          response = await executeFlowViaStBackend(
            flow,
            apiPreset,
            orderedPrompts,
            undefined,
            abortSignal,
            isCancelled,
          );
        }
      }
    } else {
      const stBackendRequest = buildCustomStBackendRequestBody(flow, apiPreset, orderedPrompts);
      requestDebug = {
        ...requestDebugBase,
        transport_request: stBackendRequest,
      };
      response = await executeFlowViaStBackend(
        flow,
        apiPreset,
        orderedPrompts,
        streamEnabled ? emitStreamProgress : undefined,
        abortSignal,
        isCancelled,
      );
    }

    throwIfDispatchAborted(abortSignal, isCancelled);

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
  } catch (error) {
    return {
      flow,
      flow_order: flowOrder,
      api_preset_id: apiPreset.id,
      api_preset_name: apiPreset.name,
      api_url: attemptApiUrl,
      request,
      request_debug: {
        flow_request: request,
      },
      ok: false,
      error: toErrorMessage(error),
      elapsed_ms: Date.now() - startedAt,
    };
  }
}

export async function dispatchFlows(input: DispatchInput): Promise<DispatchFlowsOutput> {
  const flows = input.flows.filter(flow => flow.enabled);
  if (flows.length === 0) {
    throw new Error('no enabled flows');
  }

  if (input.settings.dispatch_mode === 'serial') {
    const serialResults: Record<string, any>[] = [];
    const attempts: DispatchFlowAttempt[] = [];
    const outputs: DispatchFlowResult[] = [];

    for (const [index, flow] of flows.entries()) {
      throwIfDispatchAborted(input.abortSignal, input.isCancelled);
      const attempt = await executeFlow(
        input.settings,
        flow,
        index,
        input.message_id,
        input.user_input,
        input.trigger,
        input.request_id,
        serialResults,
        input.abortSignal,
        input.isCancelled,
        input.onProgress,
      );
      attempts.push(attempt);

      if (!attempt.ok || !attempt.response) {
        throw new DispatchFlowsError(attempt.error ?? `[${flow.id}] failed`, attempts);
      }

      const output: DispatchFlowResult = {
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

  const attempts = await Promise.all(
    flows.map((flow, index) =>
      executeFlow(
        input.settings,
        flow,
        index,
        input.message_id,
        input.user_input,
        input.trigger,
        input.request_id,
        [],
        input.abortSignal,
        input.isCancelled,
        input.onProgress,
      ),
    ),
  );

  throwIfDispatchAborted(input.abortSignal, input.isCancelled);

  const succeeded = attempts.filter(
    (attempt): attempt is DispatchFlowAttempt & { response: NonNullable<DispatchFlowAttempt['response']> } =>
      attempt.ok && Boolean(attempt.response),
  );
  const failed = attempts.filter(attempt => !attempt.ok);

  if (failed.length > 0) {
    // CR-3: allow_partial_success — use whatever succeeded, only throw if nothing worked
    if (input.settings.failure_policy === 'allow_partial_success') {
      if (succeeded.length === 0) {
        throw new DispatchFlowsError(failed.map(f => f.error ?? `[${f.flow.id}] failed`).join('; '), attempts);
      }
      console.warn(
        `[EW] allow_partial_success: ${failed.length} flow(s) failed, ${succeeded.length} succeeded — using partial results`,
      );
    } else {
      // Default: any failure → throw
      const first = failed[0];
      throw new DispatchFlowsError(first.error ?? `[${first.flow.id}] failed`, attempts);
    }
  }

  return {
    results: succeeded.map(attempt => ({
      flow: attempt.flow,
      flow_order: attempt.flow_order,
      response: attempt.response,
    })),
    attempts,
  };
}
