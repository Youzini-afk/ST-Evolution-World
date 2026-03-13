import { TextSliceRuleSchema } from './contracts';

export const EwApiPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().default('API配置'),
  mode: z.enum(['workflow_http', 'llm_connector']).default('workflow_http'),
  use_main_api: z.boolean().default(false),
  api_url: z.string().default(''),
  api_key: z.string().default(''),
  model: z.string().default(''),
  api_source: z.string().default('openai'),
  model_candidates: z.array(z.string()).default([]),
  headers_json: z.string().default(''),
});

export const EwFlowGenerationOptionsSchema = z.object({
  unlock_context_length: z.boolean().default(false),
  max_context_tokens: z.coerce.number().int().positive().default(200000),
  max_reply_tokens: z.coerce.number().int().positive().default(65535),
  n_candidates: z.coerce.number().int().min(1).default(1),
  stream: z.boolean().default(true),
  temperature: z.coerce.number().min(0).max(2).default(1.2),
  frequency_penalty: z.coerce.number().min(0).max(2).default(0.85),
  presence_penalty: z.coerce.number().min(0).max(2).default(0.5),
  top_p: z.coerce.number().min(0).max(1).default(0.92),
});

export const EwFlowBehaviorOptionsSchema = z.object({
  name_behavior: z.enum(['none', 'default', 'complete_target', 'message_content']).default('default'),
  continue_prefill: z.boolean().default(false),
  squash_system_messages: z.boolean().default(false),
  enable_function_calling: z.boolean().default(false),
  send_inline_media: z.boolean().default(false),
  request_thinking: z.boolean().default(false),
  reasoning_effort: z.enum(['auto', 'low', 'medium', 'high']).default('auto'),
  verbosity: z.enum(['auto', 'low', 'medium', 'high']).default('auto'),
});

export const EwPromptOrderEntrySchema = z.object({
  identifier: z.string().min(1),
  name: z.string().default(''),
  enabled: z.boolean().default(true),
  type: z.enum(['marker', 'prompt']).default('prompt'),
  role: z.enum(['system', 'user', 'assistant']).default('system'),
  content: z.string().default(''),
  injection_position: z.enum(['relative', 'in_chat']).default('relative'),
  injection_depth: z.coerce.number().int().min(0).default(0),
});

export type EwPromptOrderEntry = z.infer<typeof EwPromptOrderEntrySchema>;

export const DEFAULT_PROMPT_ORDER: EwPromptOrderEntry[] = [
  {
    identifier: 'main',
    name: 'Main Prompt',
    type: 'prompt',
    enabled: true,
    role: 'system',
    content: '',
    injection_position: 'relative',
    injection_depth: 0,
  },
  {
    identifier: 'worldInfoBefore',
    name: 'World Info (before)',
    type: 'marker',
    enabled: true,
    role: 'system',
    content: '',
    injection_position: 'relative',
    injection_depth: 0,
  },
  {
    identifier: 'personaDescription',
    name: 'Persona Description',
    type: 'marker',
    enabled: true,
    role: 'system',
    content: '',
    injection_position: 'relative',
    injection_depth: 0,
  },
  {
    identifier: 'charDescription',
    name: 'Char Description',
    type: 'marker',
    enabled: true,
    role: 'system',
    content: '',
    injection_position: 'relative',
    injection_depth: 0,
  },
  {
    identifier: 'charPersonality',
    name: 'Char Personality',
    type: 'marker',
    enabled: true,
    role: 'system',
    content: '',
    injection_position: 'relative',
    injection_depth: 0,
  },
  {
    identifier: 'scenario',
    name: 'Scenario',
    type: 'marker',
    enabled: true,
    role: 'system',
    content: '',
    injection_position: 'relative',
    injection_depth: 0,
  },
  {
    identifier: 'enhanceDefinitions',
    name: 'Enhance Definitions',
    type: 'prompt',
    enabled: false,
    role: 'system',
    content: '',
    injection_position: 'relative',
    injection_depth: 0,
  },
  {
    identifier: 'auxiliaryPrompt',
    name: 'Auxiliary Prompt',
    type: 'prompt',
    enabled: true,
    role: 'system',
    content: '',
    injection_position: 'relative',
    injection_depth: 0,
  },
  {
    identifier: 'worldInfoAfter',
    name: 'World Info (after)',
    type: 'marker',
    enabled: true,
    role: 'system',
    content: '',
    injection_position: 'relative',
    injection_depth: 0,
  },
  {
    identifier: 'dialogueExamples',
    name: 'Chat Examples',
    type: 'marker',
    enabled: true,
    role: 'system',
    content: '',
    injection_position: 'relative',
    injection_depth: 0,
  },
  {
    identifier: 'chatHistory',
    name: 'Chat History',
    type: 'marker',
    enabled: true,
    role: 'system',
    content: '',
    injection_position: 'relative',
    injection_depth: 0,
  },
  {
    identifier: 'postHistoryInstructions',
    name: 'Post-History Instructions',
    type: 'prompt',
    enabled: true,
    role: 'system',
    content: '',
    injection_position: 'relative',
    injection_depth: 0,
  },
];

export const BUILTIN_MARKERS = new Set([
  'worldInfoBefore',
  'personaDescription',
  'charDescription',
  'charPersonality',
  'scenario',
  'worldInfoAfter',
  'dialogueExamples',
  'chatHistory',
]);

export const BUILTIN_PROMPTS = new Set(['main', 'enhanceDefinitions', 'auxiliaryPrompt', 'postHistoryInstructions']);

export const EwFlowPromptTriggerTypeSchema = z.enum(['all', 'send', 'continue', 'regenerate', 'quiet', 'manual']);

const EwFlowPromptPositionSchema = z.preprocess(
  value => {
    if (value === 'before') {
      return 'relative';
    }
    if (value === 'after') {
      return 'in_chat';
    }
    return value;
  },
  z.enum(['relative', 'in_chat']),
);

const EwFlowPromptTriggerListSchema = z.preprocess(
  value => {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return undefined;
      }
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      return [value];
    }
    return undefined;
  },
  z.array(EwFlowPromptTriggerTypeSchema).min(1).default(['all']),
);

export const EwFlowPromptItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().default('提示词'),
  enabled: z.boolean().default(true),
  role: z.enum(['system', 'user', 'assistant']).default('system'),
  position: EwFlowPromptPositionSchema.default('relative'),
  trigger_types: EwFlowPromptTriggerListSchema,
  content: z.string().default(''),
});

export const EwFlowConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().default('Flow'),
  enabled: z.boolean().default(true),
  timing: z.enum(['default', 'after_reply', 'before_reply']).default('default'),
  priority: z.coerce.number().int().default(100),
  timeout_ms: z.coerce.number().int().positive().default(300000),
  api_preset_id: z.string().default(''),
  generation_options: EwFlowGenerationOptionsSchema.default(() => EwFlowGenerationOptionsSchema.parse({})),
  behavior_options: EwFlowBehaviorOptionsSchema.default(() => EwFlowBehaviorOptionsSchema.parse({})),
  prompt_order: z.array(EwPromptOrderEntrySchema).default(DEFAULT_PROMPT_ORDER),
  prompt_items: z.array(EwFlowPromptItemSchema).default([]),
  // 旧版字段，保留用于向后兼容旧配置的迁移。
  api_url: z.string().default(''),
  api_key: z.string().default(''),
  context_turns: z.coerce.number().int().min(1).default(8),
  extract_rules: z.array(TextSliceRuleSchema).default([]),
  exclude_rules: z.array(TextSliceRuleSchema).default([]),
  use_tavern_regex: z.boolean().default(false),
  custom_regex_rules: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().default(''),
        enabled: z.boolean().default(true),
        find_regex: z.string().default(''),
        replace_string: z.string().default(''),
      }),
    )
    .default([]),
  request_template: z.string().default(''),
  response_extract_regex: z.string().default(''),
  response_remove_regex: z.string().default(''),
  system_prompt: z.string().default(''),
  headers_json: z.string().default(''),
});

export const EwSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  total_timeout_ms: z.coerce.number().int().positive().default(300000),
  dispatch_mode: z.enum(['parallel', 'serial']).default('parallel'),
  workflow_timing: z.enum(['after_reply', 'before_reply']).default('after_reply'),
  reroll_scope: z.enum(['all', 'failed_only']).default('all'),
  failure_policy: z
    .enum(['stop_generation', 'continue_generation', 'retry_once', 'notify_only', 'allow_partial_success'])
    .default('stop_generation'),
  intercept_release_policy: z.enum(['success_only', 'always', 'never']).default('success_only'),
  controller_entry_prefix: z.string().default('EW/Controller/'),
  dynamic_entry_prefix: z.string().default('EW/Dyn/'),
  gate_ttl_ms: z.coerce.number().int().positive().default(12000),
  floor_binding_enabled: z.boolean().default(true),
  auto_cleanup_orphans: z.boolean().default(true),
  snapshot_storage: z.enum(['message_data', 'file']).default('file'),
  theme_moon: z.boolean().default(false),
  show_fab: z.boolean().default(true),
  fab_x: z.number().default(-1),
  fab_y: z.number().default(-1),
  ui_open: z.boolean().default(false),
  api_presets: z.array(EwApiPresetSchema).default([]),
  flows: z.array(EwFlowConfigSchema).default([]),

  // 已弃用：仅保留用于向后兼容迁移。
  meta_entry_name: z.string().default('EW/Meta'),
  meta_marker: z.string().default('EW_RUNTIME_META'),
  runtime_worldbook_prefix: z.string().default('EW_RUNTIME::'),
  max_scan_worldbooks: z.coerce.number().int().min(1).default(20),

  // ── 隐藏设置（全局） ──
  hide_settings: z
    .object({
      enabled: z.boolean().default(false),
      hide_last_n: z.coerce.number().int().min(0).default(0),
      limiter_enabled: z.boolean().default(false),
      limiter_count: z.coerce.number().int().min(1).default(20),
    })
    .default({ enabled: false, hide_last_n: 0, limiter_enabled: false, limiter_count: 20 }),
});

export const WorldbookOperationSchema = z.object({
  upsert_entries: z.array(
    z.object({
      name: z.string(),
      content: z.string(),
      enabled: z.boolean(),
    }),
  ),
  delete_entries: z.array(z.object({ name: z.string() })),
  toggle_entries: z.array(z.object({ name: z.string(), enabled: z.boolean() })),
});

export const RunSummarySchema = z.object({
  at: z.coerce.number().default(0),
  ok: z.boolean().default(false),
  reason: z.string().default(''),
  request_id: z.string().default(''),
  chat_id: z.string().default(''),
  flow_count: z.coerce.number().int().default(0),
  elapsed_ms: z.coerce.number().int().default(0),
  mode: z.enum(['auto', 'manual']).default('auto'),
  diagnostics: z.record(z.string(), z.any()).default({}),
});

export const FlowIoSummarySchema = z.object({
  flow_id: z.string().default(''),
  flow_name: z.string().default(''),
  priority: z.coerce.number().default(0),
  api_preset_name: z.string().default(''),
  api_url: z.string().default(''),
  ok: z.boolean().default(false),
  elapsed_ms: z.coerce.number().int().default(0),
  error: z.string().default(''),
  request_preview: z.string().default(''),
  response_preview: z.string().default(''),
});

export const LastIoSummarySchema = z.object({
  at: z.coerce.number().default(0),
  request_id: z.string().default(''),
  chat_id: z.string().default(''),
  mode: z.enum(['auto', 'manual']).default('auto'),
  flows: z.array(FlowIoSummarySchema).default([]),
});

export type EwFlowConfig = z.infer<typeof EwFlowConfigSchema>;
export type EwApiPreset = z.infer<typeof EwApiPresetSchema>;
export type EwFlowGenerationOptions = z.infer<typeof EwFlowGenerationOptionsSchema>;
export type EwFlowBehaviorOptions = z.infer<typeof EwFlowBehaviorOptionsSchema>;
export type EwFlowPromptItem = z.infer<typeof EwFlowPromptItemSchema>;
export type EwFlowPromptTriggerType = z.infer<typeof EwFlowPromptTriggerTypeSchema>;
export type EwSettings = z.infer<typeof EwSettingsSchema>;
export type RunSummary = z.infer<typeof RunSummarySchema>;
export type LastIoSummary = z.infer<typeof LastIoSummarySchema>;

export type DispatchFlowResult = {
  flow: EwFlowConfig;
  flow_order: number;
  response: import('./contracts').FlowResponseV1;
};

export type DispatchFlowAttempt = {
  flow: EwFlowConfig;
  flow_order: number;
  api_preset_id: string;
  api_preset_name: string;
  api_url: string;
  request: import('./contracts').FlowRequestV1;
  request_debug?: Record<string, any>;
  response?: import('./contracts').FlowResponseV1;
  ok: boolean;
  elapsed_ms: number;
  error?: string;
};

export type WorkflowProgressPhase =
  | 'preparing'
  | 'dispatching'
  | 'flow_started'
  | 'streaming'
  | 'merging'
  | 'committing'
  | 'completed'
  | 'failed';

export type WorkflowStreamPreview = {
  entry_name?: string;
  content?: string;
};

export type WorkflowProgressUpdate = {
  phase: WorkflowProgressPhase;
  request_id: string;
  message?: string;
  flow_id?: string;
  flow_name?: string;
  flow_order?: number;
  generation_id?: string;
  stream_enabled?: boolean;
  stream_text?: string;
  stream_preview?: WorkflowStreamPreview;
};

export type MergeInput = DispatchFlowResult[];

export type Prioritized<T> = {
  value: T;
  priority: number;
  flow_order: number;
};

export type ControllerEntrySnapshot = {
  entry_name: string;
  content: string;
  flow_id?: string;
  flow_name?: string;
  legacy?: boolean;
};

export type ControllerModelSlot = {
  flow_id: string;
  flow_name: string;
  entry_name: string;
  model: import('./contracts').ControllerModel;
};

export type ControllerTemplateSlot = {
  flow_id: string;
  flow_name: string;
  entry_name: string;
  content: string;
};

export type MergedPlan = {
  worldbook: {
    desired_entries: Array<{ name: string; content: string; enabled: boolean }>;
    remove_entries: Array<{ name: string }>;
  };
  controller_models: ControllerModelSlot[];
  reply_instruction: string;
  diagnostics: Record<string, any>;
};
