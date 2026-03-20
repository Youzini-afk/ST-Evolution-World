import { z } from "zod";
import { TextSliceRuleSchema } from "./contracts";
export const EwApiPresetSchema = z.object({
    id: z.string().min(1),
    name: z.string().default("API配置"),
    mode: z.enum(["workflow_http", "llm_connector"]).default("workflow_http"),
    use_main_api: z.boolean().default(false),
    api_url: z.string().default(""),
    api_key: z.string().default(""),
    model: z.string().default(""),
    api_source: z.string().default("openai"),
    model_candidates: z.array(z.string()).default([]),
    headers_json: z.string().default(""),
});
export const EwFlowGenerationOptionsSchema = z.object({
    unlock_context_length: z.boolean().default(false),
    max_context_tokens: z.coerce.number().int().positive().default(200000),
    max_reply_tokens: z.coerce.number().int().positive().default(65535),
    n_candidates: z.coerce.number().int().min(1).default(1),
    stream: z.boolean().default(true),
    temperature: z.coerce.number().min(0).max(2).default(1.2),
    frequency_penalty: z.coerce.number().min(0).max(2).default(0),
    presence_penalty: z.coerce.number().min(0).max(2).default(0),
    top_p: z.coerce.number().min(0).max(1).default(0.92),
});
export const EwFlowBehaviorOptionsSchema = z.object({
    name_behavior: z
        .enum(["none", "default", "complete_target", "message_content"])
        .default("default"),
    continue_prefill: z.boolean().default(false),
    squash_system_messages: z.boolean().default(false),
    enable_function_calling: z.boolean().default(false),
    send_inline_media: z.boolean().default(false),
    request_thinking: z.boolean().default(false),
    reasoning_effort: z.enum(["auto", "low", "medium", "high"]).default("auto"),
    verbosity: z.enum(["auto", "low", "medium", "high"]).default("auto"),
});
const DynSecondaryLogicSchema = z.enum([
    "and_any",
    "and_all",
    "not_any",
    "not_all",
]);
const DynPositionRoleSchema = z.enum(["system", "user", "assistant"]);
const DynScanDepthSchema = z.union([
    z.literal("same_as_global"),
    z.coerce.number().int().min(0),
    z.string().min(1),
]);
const DEFAULT_DYN_POSITION = {
    type: "before_character_definition",
    role: "system",
    depth: 0,
    order: 100,
};
const DEFAULT_DYN_SECONDARY = {
    logic: "and_any",
    keys: [],
};
const DEFAULT_DYN_STRATEGY = {
    type: "constant",
    keys: [],
    keys_secondary: DEFAULT_DYN_SECONDARY,
    scan_depth: "same_as_global",
};
const DEFAULT_DYN_EFFECT = {
    sticky: null,
    cooldown: null,
    delay: null,
};
const DEFAULT_DYN_EXTRA = {
    caseSensitive: false,
    matchWholeWords: false,
    group: "",
    groupOverride: false,
    groupWeight: 100,
    useGroupScoring: false,
};
export const DynWorldbookProfileSchema = z.object({
    comment: z.string().default(""),
    position: z
        .object({
        type: z.string().default("before_character_definition"),
        role: DynPositionRoleSchema.default("system"),
        depth: z.coerce.number().int().min(0).default(0),
        order: z.coerce.number().int().default(100),
    })
        .default(DEFAULT_DYN_POSITION),
    strategy: z
        .object({
        type: z.string().default("constant"),
        keys: z.array(z.string()).default([]),
        keys_secondary: z
            .object({
            logic: DynSecondaryLogicSchema.default("and_any"),
            keys: z.array(z.string()).default([]),
        })
            .default(DEFAULT_DYN_SECONDARY),
        scan_depth: DynScanDepthSchema.default("same_as_global"),
    })
        .default(DEFAULT_DYN_STRATEGY),
    probability: z.coerce.number().min(0).max(100).default(100),
    effect: z
        .object({
        sticky: z.coerce.number().int().min(0).nullable().default(null),
        cooldown: z.coerce.number().int().min(0).nullable().default(null),
        delay: z.coerce.number().int().min(0).nullable().default(null),
    })
        .default(DEFAULT_DYN_EFFECT),
    extra: z
        .object({
        caseSensitive: z.boolean().default(false),
        matchWholeWords: z.boolean().default(false),
        group: z.string().default(""),
        groupOverride: z.boolean().default(false),
        groupWeight: z.coerce.number().default(100),
        useGroupScoring: z.boolean().default(false),
    })
        .default(DEFAULT_DYN_EXTRA),
});
export const DynWriteConfigSchema = z.object({
    mode: z.enum(["overwrite", "add", "add_remove"]).default("overwrite"),
    item_format: z.literal("markdown_list").default("markdown_list"),
    activation_mode: z
        .enum(["controller_only", "worldbook_direct"])
        .default("controller_only"),
    profile: DynWorldbookProfileSchema.default(() => DynWorldbookProfileSchema.parse({})),
});
export const EwPromptOrderEntrySchema = z.object({
    identifier: z.string().min(1),
    name: z.string().default(""),
    enabled: z.boolean().default(true),
    type: z.enum(["marker", "prompt"]).default("prompt"),
    role: z.enum(["system", "user", "assistant"]).default("system"),
    content: z.string().default(""),
    injection_position: z.enum(["relative", "in_chat"]).default("relative"),
    injection_depth: z.coerce.number().int().min(0).default(0),
});
export const DEFAULT_PROMPT_ORDER = [
    {
        identifier: "main",
        name: "Main Prompt",
        type: "prompt",
        enabled: true,
        role: "system",
        content: "",
        injection_position: "relative",
        injection_depth: 0,
    },
    {
        identifier: "worldInfoBefore",
        name: "World Info (before)",
        type: "marker",
        enabled: true,
        role: "system",
        content: "",
        injection_position: "relative",
        injection_depth: 0,
    },
    {
        identifier: "personaDescription",
        name: "Persona Description",
        type: "marker",
        enabled: true,
        role: "system",
        content: "",
        injection_position: "relative",
        injection_depth: 0,
    },
    {
        identifier: "charDescription",
        name: "Char Description",
        type: "marker",
        enabled: true,
        role: "system",
        content: "",
        injection_position: "relative",
        injection_depth: 0,
    },
    {
        identifier: "charPersonality",
        name: "Char Personality",
        type: "marker",
        enabled: true,
        role: "system",
        content: "",
        injection_position: "relative",
        injection_depth: 0,
    },
    {
        identifier: "scenario",
        name: "Scenario",
        type: "marker",
        enabled: true,
        role: "system",
        content: "",
        injection_position: "relative",
        injection_depth: 0,
    },
    {
        identifier: "enhanceDefinitions",
        name: "Enhance Definitions",
        type: "prompt",
        enabled: false,
        role: "system",
        content: "",
        injection_position: "relative",
        injection_depth: 0,
    },
    {
        identifier: "auxiliaryPrompt",
        name: "Auxiliary Prompt",
        type: "prompt",
        enabled: true,
        role: "system",
        content: "",
        injection_position: "relative",
        injection_depth: 0,
    },
    {
        identifier: "worldInfoAfter",
        name: "World Info (after)",
        type: "marker",
        enabled: true,
        role: "system",
        content: "",
        injection_position: "relative",
        injection_depth: 0,
    },
    {
        identifier: "dialogueExamples",
        name: "Chat Examples",
        type: "marker",
        enabled: true,
        role: "system",
        content: "",
        injection_position: "relative",
        injection_depth: 0,
    },
    {
        identifier: "chatHistory",
        name: "Chat History",
        type: "marker",
        enabled: true,
        role: "system",
        content: "",
        injection_position: "relative",
        injection_depth: 0,
    },
    {
        identifier: "postHistoryInstructions",
        name: "Post-History Instructions",
        type: "prompt",
        enabled: true,
        role: "system",
        content: "",
        injection_position: "relative",
        injection_depth: 0,
    },
];
export const BUILTIN_MARKERS = new Set([
    "worldInfoBefore",
    "personaDescription",
    "charDescription",
    "charPersonality",
    "scenario",
    "worldInfoAfter",
    "dialogueExamples",
    "chatHistory",
]);
export const BUILTIN_PROMPTS = new Set([
    "main",
    "enhanceDefinitions",
    "auxiliaryPrompt",
    "postHistoryInstructions",
]);
export const EwFlowPromptTriggerTypeSchema = z.enum([
    "all",
    "send",
    "continue",
    "regenerate",
    "quiet",
    "manual",
]);
const EwFlowPromptPositionSchema = z.preprocess((value) => {
    if (value === "before") {
        return "relative";
    }
    if (value === "after") {
        return "in_chat";
    }
    return value;
}, z.enum(["relative", "in_chat"]));
const EwFlowPromptTriggerListSchema = z.preprocess((value) => {
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return undefined;
        }
        return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
        return [value];
    }
    return undefined;
}, z.array(EwFlowPromptTriggerTypeSchema).min(1).default(["all"]));
export const EwFlowPromptItemSchema = z.object({
    id: z.string().min(1),
    name: z.string().default("提示词"),
    enabled: z.boolean().default(true),
    role: z.enum(["system", "user", "assistant"]).default("system"),
    position: EwFlowPromptPositionSchema.default("relative"),
    trigger_types: EwFlowPromptTriggerListSchema,
    content: z.string().default(""),
});
export const EwFlowConfigSchema = z.object({
    id: z.string().min(1),
    name: z.string().default("Flow"),
    enabled: z.boolean().default(true),
    timing: z.enum(["default", "after_reply", "before_reply"]).default("default"),
    run_every_n_floors: z.coerce.number().int().min(1).default(1),
    priority: z.coerce.number().int().default(100),
    timeout_ms: z.coerce.number().int().positive().default(300000),
    api_preset_id: z.string().default(""),
    generation_options: EwFlowGenerationOptionsSchema.default(() => EwFlowGenerationOptionsSchema.parse({})),
    behavior_options: EwFlowBehaviorOptionsSchema.default(() => EwFlowBehaviorOptionsSchema.parse({})),
    dyn_write: DynWriteConfigSchema.default(() => DynWriteConfigSchema.parse({})),
    prompt_order: z.array(EwPromptOrderEntrySchema).default(DEFAULT_PROMPT_ORDER),
    prompt_items: z.array(EwFlowPromptItemSchema).default([]),
    api_url: z.string().default(""),
    api_key: z.string().default(""),
    context_turns: z.coerce.number().int().min(1).default(8),
    extract_rules: z.array(TextSliceRuleSchema).default([]),
    exclude_rules: z.array(TextSliceRuleSchema).default([]),
    use_tavern_regex: z.boolean().default(false),
    custom_regex_rules: z
        .array(z.object({
        id: z.string().min(1),
        name: z.string().default(""),
        enabled: z.boolean().default(true),
        find_regex: z.string().default(""),
        replace_string: z.string().default(""),
    }))
        .default([]),
    request_template: z.string().default(""),
    response_extract_regex: z.string().default(""),
    response_remove_regex: z.string().default(""),
    system_prompt: z.string().default(""),
    headers_json: z.string().default(""),
});
export const EwSettingsSchema = z.object({
    enabled: z.boolean().default(false),
    total_timeout_ms: z.coerce.number().int().positive().default(300000),
    dispatch_mode: z.enum(["parallel", "serial"]).default("parallel"),
    workflow_chat_context_mode: z
        .enum(["host_processed", "raw_chat_preferred"])
        .default("host_processed"),
    after_reply_delay_seconds: z.coerce.number().min(0).default(0),
    strip_workflow_image_blocks: z.boolean().default(true),
    auto_reroll_max_attempts: z.coerce.number().int().min(1).default(1),
    auto_reroll_interval_seconds: z.coerce.number().min(0).default(0),
    parallel_dispatch_interval_seconds: z.coerce.number().min(0).default(0),
    serial_dispatch_interval_seconds: z.coerce.number().min(0).default(2),
    workflow_timing: z
        .enum(["after_reply", "before_reply"])
        .default("after_reply"),
    reroll_scope: z.enum(["all", "failed_only", "queued_failed"]).default("all"),
    failure_policy: z
        .enum([
        "stop_generation",
        "continue_generation",
        "retry_once",
        "notify_only",
        "allow_partial_success",
    ])
        .default("stop_generation"),
    intercept_release_policy: z
        .enum(["success_only", "always", "never"])
        .default("success_only"),
    controller_entry_prefix: z.string().default("EW/Controller/"),
    dynamic_entry_prefix: z.string().default("EW/Dyn/"),
    gate_ttl_ms: z.coerce.number().int().positive().default(12000),
    floor_binding_enabled: z.boolean().default(true),
    auto_cleanup_orphans: z.boolean().default(true),
    snapshot_storage: z.enum(["message_data", "file"]).default("file"),
    theme_moon: z.boolean().default(false),
    show_fab: z.boolean().default(true),
    fab_x: z.number().default(-1),
    fab_y: z.number().default(-1),
    ui_open: z.boolean().default(false),
    api_presets: z.array(EwApiPresetSchema).default([]),
    flows: z.array(EwFlowConfigSchema).default([]),
    workbench_graphs: z.array(z.any()).default([]),
    graph_canvas_slots: z
        .array(z.object({
        id: z.string(),
        name: z.string(),
        nodes: z.array(z.any()).default([]),
        edges: z.array(z.any()).default([]),
        viewport: z
            .object({
            x: z.number().default(0),
            y: z.number().default(0),
            zoom: z.number().default(1),
        })
            .default({ x: 0, y: 0, zoom: 1 }),
    }))
        .default([]),
    meta_entry_name: z.string().default("EW/Meta"),
    meta_marker: z.string().default("EW_RUNTIME_META"),
    runtime_worldbook_prefix: z.string().default("EW_RUNTIME::"),
    max_scan_worldbooks: z.coerce.number().int().min(1).default(20),
    hide_settings: z
        .object({
        enabled: z.boolean().default(true),
        hide_last_n: z.coerce.number().int().min(0).default(10),
        affect_workflow_context: z.boolean().default(false),
        limiter_enabled: z.boolean().default(true),
        limiter_count: z.coerce.number().int().min(1).default(10),
    })
        .default({
        enabled: true,
        hide_last_n: 10,
        affect_workflow_context: false,
        limiter_enabled: true,
        limiter_count: 10,
    }),
});
export const WorldbookOperationSchema = z.object({
    upsert_entries: z.array(z.object({
        name: z.string(),
        content: z.string(),
        enabled: z.boolean(),
    })),
    delete_entries: z.array(z.object({ name: z.string() })),
    toggle_entries: z.array(z.object({ name: z.string(), enabled: z.boolean() })),
});
export const RunSummarySchema = z.object({
    at: z.coerce.number().default(0),
    ok: z.boolean().default(false),
    reason: z.string().default(""),
    request_id: z.string().default(""),
    chat_id: z.string().default(""),
    flow_count: z.coerce.number().int().default(0),
    elapsed_ms: z.coerce.number().int().default(0),
    mode: z.enum(["auto", "manual"]).default("auto"),
    diagnostics: z.record(z.string(), z.any()).default({}),
    failure: z
        .object({
        stage: z
            .enum(["dispatch", "merge", "commit", "cancelled", "config", "unknown"])
            .default("unknown"),
        kind: z
            .enum([
            "http_error",
            "auth_error",
            "permission_error",
            "not_found",
            "rate_limit",
            "tls_error",
            "connection_reset",
            "timeout",
            "empty_response",
            "response_parse",
            "regex_extract",
            "schema_invalid",
            "template_invalid",
            "config_invalid",
            "worldbook_missing",
            "merge_failed",
            "commit_failed",
            "cancelled",
            "unknown",
        ])
            .default("unknown"),
        summary: z.string().default(""),
        detail: z.string().default(""),
        suggestion: z.string().default(""),
        request_id: z.string().default(""),
        flow_id: z.string().default(""),
        flow_name: z.string().default(""),
        api_preset_name: z.string().default(""),
        http_status: z.coerce.number().int().nullable().default(null),
        retry_count: z.coerce.number().int().min(0).default(0),
        attempted_flow_count: z.coerce.number().int().min(0).default(0),
        successful_flow_count: z.coerce.number().int().min(0).default(0),
        failed_flow_count: z.coerce.number().int().min(0).default(0),
        partial_success: z.boolean().default(false),
        whole_workflow_failed: z.boolean().default(false),
    })
        .nullable()
        .default(null),
});
export const FlowIoSummarySchema = z.object({
    flow_id: z.string().default(""),
    flow_name: z.string().default(""),
    priority: z.coerce.number().default(0),
    api_preset_name: z.string().default(""),
    api_url: z.string().default(""),
    ok: z.boolean().default(false),
    elapsed_ms: z.coerce.number().int().default(0),
    error: z.string().default(""),
    error_stage: z
        .enum(["dispatch", "merge", "commit", "cancelled", "config", "unknown"])
        .default("unknown"),
    error_kind: z
        .enum([
        "http_error",
        "auth_error",
        "permission_error",
        "not_found",
        "rate_limit",
        "tls_error",
        "connection_reset",
        "timeout",
        "empty_response",
        "response_parse",
        "regex_extract",
        "schema_invalid",
        "template_invalid",
        "config_invalid",
        "worldbook_missing",
        "merge_failed",
        "commit_failed",
        "cancelled",
        "unknown",
    ])
        .default("unknown"),
    error_suggestion: z.string().default(""),
    error_status: z.coerce.number().int().nullable().default(null),
    request_preview: z.string().default(""),
    response_preview: z.string().default(""),
});
export const LastIoSummarySchema = z.object({
    at: z.coerce.number().default(0),
    request_id: z.string().default(""),
    chat_id: z.string().default(""),
    mode: z.enum(["auto", "manual"]).default("auto"),
    flows: z.array(FlowIoSummarySchema).default([]),
});
//# sourceMappingURL=types.js.map