/* ═══ Module Workbench — Module Registry ═══ */
/* All atomic modules + composite packages */

import {
  RESERVED_ACTIVATION_PORT_ID,
  RESERVED_ACTIVATION_PORT_LABEL,
  RESERVED_ACTIVATION_RESULT_PORT_ID,
  RESERVED_ACTIVATION_RESULT_PORT_LABEL,
} from "./module-types";
import type {
  HostWriteSummary,
  ModuleBlueprint,
  ModuleExplainContract,
  ModuleMetadataConfigSummary,
  ModuleMetadataConstraintSummary,
  ModuleMetadataDiagnosticsSummary,
  ModuleMetadataHelpSummary,
  ModuleMetadataSchemaFieldSummary,
  ModuleMetadataSemanticSummary,
  ModuleMetadataUiSummary,
  ModuleMetadataValidationSummary,
  ModulePortDef,
} from "./module-types";
export type { ModuleBlueprint, ModulePortDef };

const withRuntimeMeta = (
  modules: ModuleBlueprint[],
  runtimeMeta: NonNullable<ModuleBlueprint["runtimeMeta"]>,
): ModuleBlueprint[] =>
  modules.map((module) => ({
    ...module,
    runtimeMeta: {
      ...runtimeMeta,
      ...module.runtimeMeta,
      migration: {
        ...(runtimeMeta.migration ?? {}),
        ...(module.runtimeMeta?.migration ?? {}),
      },
    },
  }));

const withHostTargetHint = (
  module: ModuleBlueprint,
  hostTargetHint: HostWriteSummary,
): ModuleBlueprint => ({
  ...module,
  runtimeMeta: {
    ...module.runtimeMeta,
    hostTargetHint,
  },
});

function formatDefaultValueHint(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value.length > 0 ? value : '""';
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildSchemaFieldSummaries(
  module: Pick<
    ModuleBlueprint,
    "configSchema" | "defaultConfig" | "configMetadata"
  >,
): ModuleMetadataSchemaFieldSummary[] {
  if (module.configMetadata?.schemaFields?.length) {
    return [...module.configMetadata.schemaFields];
  }
  return (module.configSchema ?? []).map((field) => ({
    key: field.key,
    label: field.label,
    required: field.required,
    defaultValueHint: formatDefaultValueHint(module.defaultConfig[field.key]),
    description: field.description,
  }));
}

function buildValidationSummary(
  module: Pick<
    ModuleBlueprint,
    "configSchema" | "defaultConfig" | "configMetadata"
  >,
): ModuleMetadataValidationSummary | undefined {
  const schemaFields = buildSchemaFieldSummaries(module);
  if (schemaFields.length === 0) {
    return undefined;
  }
  const allowedConfigKeys = schemaFields.map((field) => field.key);
  const requiredConfigKeys = schemaFields
    .filter((field) => field.required)
    .map((field) => field.key);
  return {
    allowedConfigKeys,
    requiredConfigKeys,
    unknownConfigSeverity: "warning",
    requiredConfigSeverity: "error",
    unknownKeyPolicy: "allow_with_warning",
    explainHint:
      "当前校验仅消费 metadata fact surface，未知配置键默认以解释型告警处理。",
  };
}

function buildConfigSummary(
  module: Pick<
    ModuleBlueprint,
    "configSchema" | "defaultConfig" | "configMetadata"
  >,
): ModuleMetadataConfigSummary {
  const schemaFields = buildSchemaFieldSummaries(module);
  const schemaFieldKeys = schemaFields.map((field) => field.key);
  return {
    schemaFieldKeys,
    schemaFieldCount: schemaFieldKeys.length,
    hasSchema: schemaFieldKeys.length > 0,
    schemaFields,
    validation: buildValidationSummary(module),
  };
}

function buildDiagnosticsSummary(
  semantic: ModuleMetadataSemanticSummary,
): ModuleMetadataDiagnosticsSummary {
  const capabilityLabelMap: Record<
    NonNullable<ModuleMetadataSemanticSummary["capability"]>,
    string
  > = {
    unknown: "未知能力",
    pure: "纯数据处理",
    reads_host: "读取宿主",
    writes_host: "写入宿主",
    network: "网络调用",
    source: "源节点",
    fallback: "回退执行",
  };
  const sideEffectLabelMap: Record<
    NonNullable<ModuleMetadataSemanticSummary["sideEffect"]>,
    string
  > = {
    unknown: "副作用未知",
    pure: "无宿主副作用",
    reads_host: "仅读取宿主",
    writes_host: "写入宿主",
    network: "网络副作用",
    source: "源侧读取",
    fallback: "回退语义",
  };
  return {
    capabilityLabel: capabilityLabelMap[semantic.capability ?? "unknown"],
    sideEffectLabel: sideEffectLabelMap[semantic.sideEffect ?? "unknown"],
    hostWriteLabel: semantic.hostWriteHint
      ? `${semantic.hostWriteHint.targetType}:${semantic.hostWriteHint.operation}`
      : undefined,
  };
}

function buildExplainContract(params: {
  semantic: ModuleMetadataSemanticSummary;
  config: ModuleMetadataConfigSummary;
  constraints?: ModuleMetadataConstraintSummary;
  help?: ModuleMetadataHelpSummary;
  diagnostics: ModuleMetadataDiagnosticsSummary;
}): ModuleExplainContract {
  const validation = params.config.validation;
  return {
    semantic: params.semantic,
    config: {
      requiredConfigKeys: validation?.requiredConfigKeys ?? [],
      allowedConfigKeys: validation?.allowedConfigKeys ?? [],
      unknownKeyPolicy:
        validation?.unknownKeyPolicy ??
        (validation?.unknownConfigSeverity === "error"
          ? "allow_with_error"
          : "allow_with_warning"),
      schemaFields: params.config.schemaFields ?? [],
    },
    ports: {
      inputs: params.constraints?.inputs ?? [],
      outputs: params.constraints?.outputs ?? [],
    },
    help: params.help,
    diagnostics: {
      capability: params.diagnostics.capabilityLabel,
      sideEffect: params.diagnostics.sideEffectLabel,
      hostWrite: params.diagnostics.hostWriteLabel,
    },
  };
}

function withMetadataSurface(
  module: ModuleBlueprint,
  options: {
    semantic?: Partial<ModuleMetadataSemanticSummary>;
    constraints?: ModuleMetadataConstraintSummary;
    help?: ModuleMetadataHelpSummary;
    ui?: ModuleMetadataUiSummary;
  },
): ModuleBlueprint {
  const runtimeMeta = module.runtimeMeta ?? {};
  const resolvedSideEffect =
    options.semantic?.sideEffect ?? runtimeMeta.sideEffect;
  const semantic: ModuleMetadataSemanticSummary = {
    runtimeKind: options.semantic?.runtimeKind ?? runtimeMeta.runtimeKind,
    capability:
      options.semantic?.capability ??
      runtimeMeta.capability ??
      (resolvedSideEffect === "writes_host" ||
      resolvedSideEffect === "reads_host" ||
      resolvedSideEffect === "pure"
        ? resolvedSideEffect
        : undefined),
    sideEffect: resolvedSideEffect,
    hostWriteHint:
      options.semantic?.hostWriteHint ??
      runtimeMeta.hostTargetHint ??
      undefined,
  };
  const config = buildConfigSummary(module);
  const diagnostics = buildDiagnosticsSummary(semantic);
  const explain = buildExplainContract({
    semantic,
    config,
    constraints: options.constraints,
    help: options.help,
    diagnostics,
  });
  return {
    ...module,
    metadata: {
      semantic,
      config,
      constraints: options.constraints,
      help: options.help,
      ui: options.ui,
      diagnostics,
      explain,
    },
  };
}

// ── Helper for common port patterns ──

const textIn = (id = "text_in", label = "文本"): ModulePortDef => ({
  id,
  label,
  direction: "in",
  dataType: "text",
});
const textOut = (id = "text_out", label = "文本"): ModulePortDef => ({
  id,
  label,
  direction: "out",
  dataType: "text",
});
const msgsIn = (id = "msgs_in", label = "消息"): ModulePortDef => ({
  id,
  label,
  direction: "in",
  dataType: "messages",
});
const msgsOut = (id = "msgs_out", label = "消息"): ModulePortDef => ({
  id,
  label,
  direction: "out",
  dataType: "messages",
});
const entriesIn = (id = "entries_in", label = "条目"): ModulePortDef => ({
  id,
  label,
  direction: "in",
  dataType: "entries",
});
const entriesOut = (id = "entries_out", label = "条目"): ModulePortDef => ({
  id,
  label,
  direction: "out",
  dataType: "entries",
});
const jsonIn = (id = "json_in", label = "JSON"): ModulePortDef => ({
  id,
  label,
  direction: "in",
  dataType: "json",
});
const jsonOut = (id = "json_out", label = "JSON"): ModulePortDef => ({
  id,
  label,
  direction: "out",
  dataType: "json",
});
const activationIn = (
  id = RESERVED_ACTIVATION_PORT_ID,
  label = RESERVED_ACTIVATION_PORT_LABEL,
  uiHidden = true,
): ModulePortDef => ({
  id,
  label,
  direction: "in",
  dataType: "activation",
  optional: true,
  uiHidden,
});
const activationOut = (id: string, label: string): ModulePortDef => ({
  id,
  label,
  direction: "out",
  dataType: "activation",
});

function withReservedActivationPorts(module: ModuleBlueprint): ModuleBlueprint {
  const nextPorts = [...module.ports];
  if (!nextPorts.some((port) => port.id === RESERVED_ACTIVATION_PORT_ID)) {
    nextPorts.unshift(activationIn());
  }
  if (
    !nextPorts.some((port) => port.id === RESERVED_ACTIVATION_RESULT_PORT_ID)
  ) {
    nextPorts.push(
      activationOut(
        RESERVED_ACTIVATION_RESULT_PORT_ID,
        RESERVED_ACTIVATION_RESULT_PORT_LABEL,
      ),
    );
    nextPorts[nextPorts.length - 1].uiHidden = true;
  }
  return {
    ...module,
    ports: nextPorts,
  };
}

function compositeNode(
  id: string,
  moduleId: string,
  x: number,
  y: number,
  config: Record<string, any> = {},
): NonNullable<ModuleBlueprint["compositeTemplate"]>["nodes"][number] {
  return {
    id,
    moduleId,
    position: { x, y },
    config,
    collapsed: false,
  };
}

function compositeEdge(
  id: string,
  source: string,
  sourcePort: string,
  target: string,
  targetPort: string,
): NonNullable<ModuleBlueprint["compositeTemplate"]>["edges"][number] {
  return {
    id,
    source,
    sourcePort,
    target,
    targetPort,
  };
}

// ════════════════════════════════════════════════════════════
// 🔌 Source — 数据源模块
// ════════════════════════════════════════════════════════════

const SOURCE_MODULES: ModuleBlueprint[] = [
  {
    moduleId: "src_char_fields",
    label: "角色卡字段",
    category: "source",
    color: "#f59e0b",
    icon: "👤",
    description: "从 ST 运行时获取角色卡的描述、性格、场景、系统提示等字段",
    ports: [
      { id: "main", label: "主提示", direction: "out", dataType: "text" },
      { id: "description", label: "描述", direction: "out", dataType: "text" },
      { id: "personality", label: "性格", direction: "out", dataType: "text" },
      { id: "scenario", label: "场景", direction: "out", dataType: "text" },
      { id: "persona", label: "人设", direction: "out", dataType: "text" },
      { id: "examples", label: "示例对话", direction: "out", dataType: "text" },
      { id: "jailbreak", label: "越狱", direction: "out", dataType: "text" },
    ],
    defaultConfig: {},
  },
  {
    moduleId: "src_chat_history",
    label: "聊天历史",
    category: "source",
    color: "#f59e0b",
    icon: "💬",
    description: "获取最近 N 轮对话消息",
    ports: [msgsOut("messages", "消息列表")],
    defaultConfig: {
      context_turns: 8,
      include_system: false,
    },
    configSchema: [
      {
        key: "context_turns",
        label: "上下文轮数",
        type: "number",
        min: 1,
        step: 1,
        exposeInSimpleMode: true,
        description: "向前读取最近多少轮聊天历史消息。",
      },
      {
        key: "include_system",
        label: "包含系统消息",
        type: "boolean",
        exposeInSimpleMode: true,
        description: "是否把系统消息一并带入历史消息列表。",
      },
    ],
  },
  {
    moduleId: "src_worldbook_raw",
    label: "世界书原始条目",
    category: "source",
    color: "#f59e0b",
    icon: "📖",
    description: "从角色/人设/聊天世界书收集所有原始条目（不含全局世界书）",
    ports: [entriesOut("entries", "原始条目")],
    defaultConfig: {
      include_character: true,
      include_persona: true,
      include_chat: true,
      include_global: false,
    },
  },
  {
    moduleId: "src_extension_prompts",
    label: "扩展提示词",
    category: "source",
    color: "#f59e0b",
    icon: "🧩",
    description: "获取酒馆其他插件注入的 extension_prompts",
    ports: [
      {
        id: "before_prompt",
        label: "前置注入",
        direction: "out",
        dataType: "messages",
      },
      {
        id: "in_chat",
        label: "深度注入",
        direction: "out",
        dataType: "messages",
      },
      {
        id: "in_prompt",
        label: "提示词内",
        direction: "out",
        dataType: "messages",
      },
    ],
    defaultConfig: {},
  },
  {
    moduleId: "src_user_input",
    label: "用户输入",
    category: "source",
    color: "#f59e0b",
    icon: "✏️",
    description: "当前触发工作流的用户输入文本",
    ports: [textOut("text", "用户输入")],
    defaultConfig: {},
    configMetadata: {
      schemaFields: [],
    },
  },
  {
    moduleId: "src_flow_context",
    label: "流上下文",
    category: "source",
    color: "#f59e0b",
    icon: "📋",
    description: "当前执行的上下文信息：chat_id, message_id, trigger 等",
    ports: [
      {
        id: "context",
        label: "上下文",
        direction: "out",
        dataType: "flow_context",
      },
    ],
    defaultConfig: {},
  },
  {
    moduleId: "src_serial_results",
    label: "前序结果",
    category: "source",
    color: "#f59e0b",
    icon: "📊",
    description: "串行模式下前序工作流的执行结果",
    ports: [
      {
        id: "results",
        label: "前序结果",
        direction: "out",
        dataType: "results",
      },
    ],
    defaultConfig: {},
  },
];

// ════════════════════════════════════════════════════════════
// 🔍 Filter — 过滤 / 处理模块
// ════════════════════════════════════════════════════════════

const FILTER_MODULES: ModuleBlueprint[] = [
  {
    moduleId: "flt_wi_keyword_match",
    label: "WI 关键词匹配",
    category: "filter",
    color: "#3b82f6",
    icon: "🔑",
    description: "对世界书条目执行关键词激活：常量、主关键词、次关键词 AND/NOT",
    ports: [
      entriesIn("entries", "候选条目"),
      msgsIn("chat_texts", "聊天文本"),
      entriesOut("activated", "激活条目"),
    ],
    defaultConfig: {},
  },
  {
    moduleId: "flt_wi_probability",
    label: "WI 概率过滤",
    category: "filter",
    color: "#3b82f6",
    icon: "🎲",
    description:
      "按概率过滤世界书条目（probability < 100 的条目按概率随机激活）",
    ports: [entriesIn(), entriesOut()],
    defaultConfig: {},
  },
  {
    moduleId: "flt_wi_mutex_group",
    label: "WI 互斥组",
    category: "filter",
    color: "#3b82f6",
    icon: "🔒",
    description: "同一互斥组内只保留一个激活条目",
    ports: [entriesIn(), entriesOut()],
    defaultConfig: {},
  },
  {
    moduleId: "flt_mvu_strip",
    label: "MVU 内容剥离",
    category: "filter",
    color: "#3b82f6",
    icon: "🧹",
    description: "移除文本中的 MVU XML 块和产物",
    ports: [textIn(), textOut()],
    defaultConfig: {},
    configMetadata: {
      schemaFields: [],
    },
  },
  {
    moduleId: "flt_mvu_detect",
    label: "MVU 产物检测",
    category: "filter",
    color: "#3b82f6",
    icon: "🔎",
    description: "检测文本是否为 MVU 产物，是则丢弃",
    ports: [
      textIn(),
      textOut(),
      { id: "is_mvu", label: "是否MVU", direction: "out", dataType: "boolean" },
    ],
    defaultConfig: {},
  },
  {
    moduleId: "flt_blocked_content_strip",
    label: "被忽略条目剥离",
    category: "filter",
    color: "#3b82f6",
    icon: "✂️",
    description: "子串匹配移除已被忽略的 WI 条目内容",
    ports: [
      textIn(),
      {
        id: "blocked",
        label: "被忽略内容",
        direction: "in",
        dataType: "entries",
        optional: true,
      },
      textOut(),
    ],
    defaultConfig: {},
  },
  {
    moduleId: "flt_regex_process",
    label: "酒馆正则处理",
    category: "filter",
    color: "#3b82f6",
    icon: "📐",
    description: "应用酒馆内置的正则处理规则到文本",
    ports: [textIn(), textOut()],
    defaultConfig: {},
  },
  {
    moduleId: "flt_context_extract",
    label: "上下文提取规则",
    category: "filter",
    color: "#3b82f6",
    icon: "📥",
    description: "按正则提取匹配的消息",
    ports: [msgsIn(), msgsOut()],
    defaultConfig: {
      rules: [],
    },
  },
  {
    moduleId: "flt_context_exclude",
    label: "上下文排除规则",
    category: "filter",
    color: "#3b82f6",
    icon: "📤",
    description: "按正则排除匹配的消息",
    ports: [msgsIn(), msgsOut()],
    defaultConfig: {
      rules: [],
    },
  },
  {
    moduleId: "flt_custom_regex",
    label: "自定义正则替换",
    category: "filter",
    color: "#3b82f6",
    icon: "🔧",
    description: "用户自定义的查找/替换正则规则",
    ports: [textIn(), textOut()],
    defaultConfig: {
      rules: [],
    },
  },
  {
    moduleId: "flt_hide_messages",
    label: "消息隐藏器",
    category: "filter",
    color: "#3b82f6",
    icon: "🙈",
    description: "隐藏末尾 N 条消息或按限制器阈值截断",
    ports: [msgsIn(), msgsOut()],
    defaultConfig: {
      hide_last_n: 0,
      limiter_enabled: false,
      limiter_count: 20,
    },
  },
];

// ════════════════════════════════════════════════════════════
// 🔮 Transform — 渲染 / 转换模块
// ════════════════════════════════════════════════════════════

const TRANSFORM_MODULES: ModuleBlueprint[] = [
  {
    moduleId: "tfm_ejs_render",
    label: "EJS 模板渲染",
    category: "transform",
    color: "#8b5cf6",
    icon: "🔮",
    description: "对文本执行 EJS 模板渲染（支持 getwi/getvar 等内置函数）",
    ports: [
      textIn("template", "模板文本"),
      jsonIn("context", "模板上下文"),
      textOut("rendered", "渲染结果"),
    ],
    defaultConfig: {},
  },
  {
    moduleId: "tfm_macro_replace",
    label: "宏替换",
    category: "transform",
    color: "#8b5cf6",
    icon: "🏷️",
    description: "替换 {{user}} {{char}} {{persona}} 等宏变量",
    ports: [textIn(), textOut()],
    defaultConfig: {},
  },
  {
    moduleId: "tfm_controller_expand",
    label: "Controller 展开",
    category: "transform",
    color: "#8b5cf6",
    icon: "🎛️",
    description:
      "展开 EW/Controller 条目，将 getwi 拉取的 Dyn 条目拆为独立条目",
    ports: [
      entriesIn("controller", "Controller 条目"),
      entriesOut("expanded", "展开后条目"),
    ],
    defaultConfig: {},
  },
  {
    moduleId: "tfm_wi_bucket",
    label: "WI 分桶",
    category: "transform",
    color: "#8b5cf6",
    icon: "🗂️",
    description: "按 position 将条目分为 before / after / atDepth 三个桶",
    ports: [
      entriesIn(),
      { id: "before", label: "before", direction: "out", dataType: "entries" },
      { id: "after", label: "after", direction: "out", dataType: "entries" },
      {
        id: "at_depth",
        label: "atDepth",
        direction: "out",
        dataType: "entries",
      },
    ],
    defaultConfig: {},
  },
  {
    moduleId: "tfm_entry_name_inject",
    label: "条目名称注入",
    category: "transform",
    color: "#8b5cf6",
    icon: "🏷️",
    description: "在世界书条目内容前插入 [条目名] 标签",
    ports: [
      msgsIn(),
      {
        id: "snapshots",
        label: "快照",
        direction: "in",
        dataType: "snapshot",
        optional: true,
      },
      msgsOut(),
    ],
    defaultConfig: {},
  },
];

// ════════════════════════════════════════════════════════════
// 📝 Compose — 编排模块
// ════════════════════════════════════════════════════════════

const COMPOSE_MODULES: ModuleBlueprint[] = [
  {
    moduleId: "cmp_prompt_order",
    label: "提示词排序",
    category: "compose",
    color: "#10b981",
    icon: "📝",
    description: "按用户配置的 prompt_order 编排所有提示词组件为消息列表",
    ports: [
      {
        id: "components",
        label: "提示词组件",
        direction: "in",
        dataType: "json",
      },
      {
        id: "order",
        label: "排序配置",
        direction: "in",
        dataType: "json",
        optional: true,
      },
      msgsOut(),
    ],
    defaultConfig: {
      prompt_order: [],
    },
  },
  {
    moduleId: "cmp_depth_inject",
    label: "深度注入",
    category: "compose",
    color: "#10b981",
    icon: "📌",
    description: "按 depth 将消息插入聊天历史的指定位置",
    ports: [
      msgsIn("messages", "聊天消息"),
      msgsIn("injections", "待注入消息"),
      msgsOut(),
    ],
    defaultConfig: {},
  },
  {
    moduleId: "cmp_message_concat",
    label: "消息拼接",
    category: "compose",
    color: "#10b981",
    icon: "🔗",
    description: "将多个消息列表按序拼接",
    ports: [
      { id: "a", label: "列表 A", direction: "in", dataType: "messages" },
      { id: "b", label: "列表 B", direction: "in", dataType: "messages" },
      msgsOut(),
    ],
    defaultConfig: {},
  },
  {
    moduleId: "cmp_json_body_build",
    label: "JSON Body 构建",
    category: "compose",
    color: "#10b981",
    icon: "📦",
    description: "将流上下文和配置组装为 FlowRequestV1 JSON body",
    ports: [
      {
        id: "context",
        label: "流上下文",
        direction: "in",
        dataType: "flow_context",
      },
      {
        id: "config",
        label: "流配置",
        direction: "in",
        dataType: "json",
        optional: true,
      },
      jsonOut("body", "JSON Body"),
    ],
    defaultConfig: {},
  },
  {
    moduleId: "cmp_request_template",
    label: "请求模板",
    category: "compose",
    color: "#10b981",
    icon: "📋",
    description: "将 mustache 模板应用到 JSON body，支持深路径取值",
    ports: [
      jsonIn("body", "原始 Body"),
      textIn("template", "模板"),
      jsonOut("result", "合并后 Body"),
    ],
    defaultConfig: {
      template: "",
    },
    configSchema: [
      {
        key: "template",
        label: "模板文本",
        type: "textarea",
        rows: 8,
        exposeInSimpleMode: false,
        placeholder:
          '{\n  "chat_id": "{{chat_id}}",\n  "trigger": "{{trigger}}"\n}',
        description:
          "Mustache 风格 JSON 模板，适合做 body 结构试验与占位替换。",
      },
    ],
  },
  {
    moduleId: "cmp_passthrough",
    label: "直通",
    category: "compose",
    color: "#10b981",
    icon: "↦",
    description:
      "原样透传任意输入值；未接输入时保守输出 null，适合作为分支占位或 fragment 脚手架节点。",
    ports: [
      {
        id: "value",
        label: "输入值",
        direction: "in",
        dataType: "any",
        optional: true,
      },
      {
        id: "value_out",
        label: "透传值",
        direction: "out",
        dataType: "any",
      },
    ],
    defaultConfig: {},
  },
];

// ════════════════════════════════════════════════════════════
// 🚀 Execute — 执行模块
// ════════════════════════════════════════════════════════════

const EXECUTE_MODULES: ModuleBlueprint[] = [
  {
    moduleId: "exe_llm_call",
    label: "LLM 调用",
    category: "execute",
    color: "#ef4444",
    icon: "🚀",
    description: "向 AI 模型发送请求（支持 HTTP 直连和酒馆 LLM 连接器）",
    ports: [
      msgsIn("messages", "提示词消息"),
      {
        id: "api_config",
        label: "API 配置",
        direction: "in",
        dataType: "api_config",
      },
      {
        id: "gen_options",
        label: "生成参数",
        direction: "in",
        dataType: "gen_options",
        optional: true,
      },
      {
        id: "behavior",
        label: "行为参数",
        direction: "in",
        dataType: "behavior_options",
        optional: true,
      },
      textOut("raw_response", "原始响应"),
    ],
    defaultConfig: {
      stream: true,
    },
  },
  {
    moduleId: "exe_response_extract",
    label: "响应提取正则",
    category: "execute",
    color: "#ef4444",
    icon: "🎯",
    description: "用正则表达式从响应中提取内容（第一个捕获组）",
    ports: [textIn("raw", "原始文本"), textOut("extracted", "提取结果")],
    defaultConfig: {
      pattern: "",
    },
  },
  {
    moduleId: "exe_response_remove",
    label: "响应移除正则",
    category: "execute",
    color: "#ef4444",
    icon: "🗑️",
    description: "用正则移除响应中的指定内容（如 <thinking> 块）",
    ports: [textIn("raw", "原始文本"), textOut("cleaned", "清理后")],
    defaultConfig: {
      pattern: "",
    },
  },
  {
    moduleId: "exe_json_parse",
    label: "JSON 解析",
    category: "execute",
    color: "#ef4444",
    icon: "{ }",
    description: "从文本中提取并解析 JSON 对象（支持代码块和嵌套提取）",
    ports: [textIn("text", "文本"), jsonOut("parsed", "解析结果")],
    defaultConfig: {},
  },
  {
    moduleId: "exe_response_normalize",
    label: "响应标准化",
    category: "execute",
    color: "#ef4444",
    icon: "✅",
    description: "自动补全 AI 回复中的固定字段（version/flow_id/status 等）",
    ports: [jsonIn("raw", "原始 JSON"), jsonOut("normalized", "标准化后")],
    defaultConfig: {},
  },
  {
    moduleId: "exe_stream_sse",
    label: "SSE 流读取",
    category: "execute",
    color: "#ef4444",
    icon: "📡",
    description: "从 SSE 流式响应中逐步读取完整文本",
    ports: [
      {
        id: "response",
        label: "HTTP 响应",
        direction: "in",
        dataType: "http_response",
      },
      textOut("full_text", "完整文本"),
    ],
    defaultConfig: {},
  },
];

// ════════════════════════════════════════════════════════════
// 📤 Output — 输出模块
// ════════════════════════════════════════════════════════════

const OUTPUT_MODULES: ModuleBlueprint[] = [
  {
    moduleId: "out_worldbook_write",
    label: "世界书写入",
    category: "output",
    color: "#14b8a6",
    icon: "📚",
    description: "执行世界书条目的 upsert / delete / toggle 操作",
    ports: [
      {
        id: "operations",
        label: "操作指令",
        direction: "in",
        dataType: "operations",
      },
    ],
    defaultConfig: {},
  },
  {
    moduleId: "out_floor_bind",
    label: "楼层绑定",
    category: "output",
    color: "#14b8a6",
    icon: "📌",
    description: "将工作流结果绑定到对话中指定楼层的 extra 数据",
    ports: [
      {
        id: "result",
        label: "执行结果",
        direction: "in",
        dataType: "json",
      },
      {
        id: "message_id",
        label: "消息 ID",
        direction: "in",
        dataType: "number",
        optional: true,
      },
    ],
    defaultConfig: {},
  },
  {
    moduleId: "out_snapshot_save",
    label: "快照存储",
    category: "output",
    color: "#14b8a6",
    icon: "💾",
    description: "将当前快照数据持久化（支持 message_data 或 file 模式）",
    ports: [
      {
        id: "snapshot",
        label: "快照数据",
        direction: "in",
        dataType: "snapshot",
      },
    ],
    defaultConfig: {
      storage_mode: "file",
    },
  },
  withHostTargetHint(
    {
      moduleId: "out_reply_inject",
      label: "回复指令注入",
      category: "output",
      color: "#14b8a6",
      icon: "💉",
      description: "向 AI 的下一次回复注入指令文本",
      ports: [textIn("instruction", "指令文本")],
      defaultConfig: {
        target_slot: "reply.instruction",
      },
      configMetadata: {
        schemaFields: [
          {
            key: "target_slot",
            label: "目标槽位",
            required: true,
            defaultValueHint: "reply.instruction",
            description: "说明性 metadata 字段：标记当前宿主写入目标槽位。",
          },
        ],
      },
      configSchema: [
        {
          key: "target_slot",
          label: "目标槽位",
          type: "text",
          required: true,
          exposeInSimpleMode: false,
          placeholder: "reply.instruction",
          description: "说明当前宿主写入目标槽位，默认写入 reply.instruction。",
        },
      ],
    },
    {
      kind: "host_write",
      targetType: "reply_instruction",
      targetId: undefined,
      operation: "inject_reply_instruction",
      path: "reply.instruction",
    },
  ),
  {
    moduleId: "out_merge_results",
    label: "结果合并",
    category: "output",
    color: "#14b8a6",
    icon: "🔀",
    description: "将多个工作流结果合并为统一的执行计划",
    ports: [
      {
        id: "results",
        label: "结果列表",
        direction: "in",
        dataType: "results",
        multiple: true,
      },
      jsonOut("merged_plan", "合并计划"),
    ],
    defaultConfig: {},
  },
];

// ════════════════════════════════════════════════════════════
// ⚙ Config — 配置模块
// ════════════════════════════════════════════════════════════

const CONFIG_MODULES: ModuleBlueprint[] = [
  {
    moduleId: "cfg_api_preset",
    label: "API 预设",
    category: "config",
    color: "#6366f1",
    icon: "🔑",
    description: "API 连接配置：URL、Key、模型、Headers",
    ports: [
      {
        id: "config",
        label: "API 配置",
        direction: "out",
        dataType: "api_config",
      },
    ],
    defaultConfig: {
      mode: "workflow_http",
      use_main_api: false,
      api_url: "",
      api_key: "",
      model: "",
      api_source: "openai",
      headers_json: "",
    },
    configSchema: [
      {
        key: "use_main_api",
        label: "使用主 API",
        type: "boolean",
        exposeInSimpleMode: true,
        description: "启用后优先走酒馆主 API / LLM connector。",
      },
      {
        key: "api_url",
        label: "API 地址",
        type: "text",
        exposeInSimpleMode: true,
        placeholder: "https://api.example.com/v1",
        description: "workflow_http 模式下的请求地址。",
      },
      {
        key: "api_key",
        label: "API Key",
        type: "text",
        exposeInSimpleMode: true,
        secret: true,
        placeholder: "sk-...",
        description: "将以密码输入框渲染，不在面板中明文展示。",
      },
      {
        key: "model",
        label: "模型名",
        type: "text",
        exposeInSimpleMode: true,
        placeholder: "gpt-4.1 / gemini / claude ...",
        description: "发送给目标后端的模型名。",
      },
      {
        key: "mode",
        label: "连接模式",
        type: "select",
        options: ["workflow_http", "llm_connector"],
        exposeInSimpleMode: false,
        description: "workflow_http 为直连，llm_connector 为走酒馆连接器。",
      },
      {
        key: "api_source",
        label: "API Source",
        type: "text",
        exposeInSimpleMode: false,
        placeholder: "openai",
        description: "用于部分宿主分支的来源标记。",
      },
      {
        key: "headers_json",
        label: "附加请求头",
        type: "textarea",
        rows: 5,
        exposeInSimpleMode: false,
        placeholder: '{\n  "X-Trace": "demo"\n}',
        description: "额外请求头，要求是合法 JSON 对象字符串。",
      },
    ],
  },
  {
    moduleId: "cfg_generation",
    label: "生成参数",
    category: "config",
    color: "#6366f1",
    icon: "⚙",
    description:
      "模型生成参数：temperature, top_p, penalties, max_tokens, stream",
    ports: [
      {
        id: "options",
        label: "生成参数",
        direction: "out",
        dataType: "gen_options",
      },
    ],
    defaultConfig: {
      temperature: 1.2,
      top_p: 0.92,
      frequency_penalty: 0.85,
      presence_penalty: 0.5,
      max_reply_tokens: 65535,
      max_context_tokens: 200000,
      stream: true,
      n_candidates: 1,
      unlock_context_length: false,
    },
    configSchema: [
      {
        key: "temperature",
        label: "Temperature",
        type: "slider",
        min: 0,
        max: 2,
        step: 0.01,
        exposeInSimpleMode: true,
        description: "采样温度，越高越发散。",
      },
      {
        key: "top_p",
        label: "Top P",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        exposeInSimpleMode: true,
        description: "核采样阈值。",
      },
      {
        key: "max_reply_tokens",
        label: "最大回复 Token",
        type: "number",
        min: 1,
        step: 1,
        exposeInSimpleMode: true,
        description: "单次回复允许的最大 token 数。",
      },
      {
        key: "stream",
        label: "流式输出",
        type: "boolean",
        exposeInSimpleMode: true,
        description: "是否请求流式输出。",
      },
      {
        key: "frequency_penalty",
        label: "Frequency Penalty",
        type: "slider",
        min: 0,
        max: 2,
        step: 0.01,
        exposeInSimpleMode: false,
        description: "频率惩罚。",
      },
      {
        key: "presence_penalty",
        label: "Presence Penalty",
        type: "slider",
        min: 0,
        max: 2,
        step: 0.01,
        exposeInSimpleMode: false,
        description: "存在惩罚。",
      },
      {
        key: "max_context_tokens",
        label: "最大上下文 Token",
        type: "number",
        min: 1,
        step: 1,
        exposeInSimpleMode: false,
        description: "允许的上下文长度上限。",
      },
      {
        key: "n_candidates",
        label: "候选数",
        type: "number",
        min: 1,
        step: 1,
        exposeInSimpleMode: false,
        description: "请求的候选回复数量。",
      },
      {
        key: "unlock_context_length",
        label: "解锁上下文长度",
        type: "boolean",
        exposeInSimpleMode: false,
        description: "允许使用更长上下文长度。",
      },
    ],
  },
  {
    moduleId: "cfg_behavior",
    label: "行为参数",
    category: "config",
    color: "#6366f1",
    icon: "🧠",
    description: "模型行为参数：推理模式、详细度、消息压缩、function calling",
    ports: [
      {
        id: "options",
        label: "行为参数",
        direction: "out",
        dataType: "behavior_options",
      },
    ],
    defaultConfig: {
      name_behavior: "default",
      continue_prefill: false,
      squash_system_messages: false,
      enable_function_calling: false,
      send_inline_media: false,
      request_thinking: false,
      reasoning_effort: "auto",
      verbosity: "auto",
    },
    configSchema: [
      {
        key: "request_thinking",
        label: "请求思考内容",
        type: "boolean",
        exposeInSimpleMode: true,
        description: "向支持的后端请求 reasoning / thinking 内容。",
      },
      {
        key: "reasoning_effort",
        label: "Reasoning Effort",
        type: "select",
        options: ["auto", "low", "medium", "high"],
        exposeInSimpleMode: true,
        description: "推理强度提示。",
      },
      {
        key: "verbosity",
        label: "Verbosity",
        type: "select",
        options: ["auto", "low", "medium", "high"],
        exposeInSimpleMode: true,
        description: "输出冗长度提示。",
      },
      {
        key: "name_behavior",
        label: "Name Behavior",
        type: "select",
        options: ["none", "default", "complete_target", "message_content"],
        exposeInSimpleMode: false,
        description: "名字字段拼装策略。",
      },
      {
        key: "continue_prefill",
        label: "Continue Prefill",
        type: "boolean",
        exposeInSimpleMode: false,
        description: "继续预填充已有 assistant 内容。",
      },
      {
        key: "squash_system_messages",
        label: "压缩系统消息",
        type: "boolean",
        exposeInSimpleMode: false,
        description: "合并系统消息，降低消息数量。",
      },
      {
        key: "enable_function_calling",
        label: "启用 Function Calling",
        type: "boolean",
        exposeInSimpleMode: false,
        description: "启用函数调用能力。",
      },
      {
        key: "send_inline_media",
        label: "发送内联媒体",
        type: "boolean",
        exposeInSimpleMode: false,
        description: "向支持的模型发送内联媒体。",
      },
    ],
  },
  {
    moduleId: "cfg_timing",
    label: "执行时机",
    category: "config",
    color: "#6366f1",
    icon: "⏰",
    description: "工作流触发时机：before_reply 或 after_reply",
    ports: [
      { id: "timing", label: "时机", direction: "out", dataType: "timing" },
    ],
    defaultConfig: {
      timing: "after_reply",
    },
  },
  {
    moduleId: "cfg_system_prompt",
    label: "系统提示词",
    category: "config",
    color: "#6366f1",
    icon: "💬",
    description: "用户自定义的系统提示词文本",
    ports: [textOut("prompt", "系统提示")],
    defaultConfig: {
      content: "",
    },
  },
];

// ════════════════════════════════════════════════════════════
// 📦 Composite — 组合包
// ════════════════════════════════════════════════════════════

const COMPOSITE_MODULES: ModuleBlueprint[] = [
  {
    moduleId: "pkg_control_branch_router",
    label: "🧭 两路分支脚手架",
    category: "control",
    color: "#f97316",
    icon: "🧭",
    description:
      "Builder 宏脚手架：条件分支 → Then/Else 占位 → 分支汇合 → 汇合后节点，插入后直接展开成可编辑子图。",
    ports: [
      {
        id: "condition",
        label: "条件",
        direction: "in",
        dataType: "any",
      },
      {
        id: "value",
        label: "透传值",
        direction: "in",
        dataType: "any",
        optional: true,
      },
      {
        id: "value_out",
        label: "汇合后值",
        direction: "out",
        dataType: "any",
      },
    ],
    defaultConfig: {
      negate: false,
      join_mode: "any",
    },
    configSchema: [
      {
        key: "negate",
        label: "反转条件",
        type: "boolean",
        exposeInSimpleMode: false,
        description: "插入时写入内部条件分支节点。启用后 then / else 命中结果会反转。",
      },
      {
        key: "join_mode",
        label: "汇合策略",
        type: "select",
        options: ["any", "all"],
        exposeInSimpleMode: false,
        description:
          "any 适合普通两路路由；all 适合后续把占位扩展成并行分支后再汇合。",
      },
    ],
    compositeTemplate: {
      nodes: [
        compositeNode("route_if", "ctl_if", 0, 0, { _label: "路由判断" }),
        compositeNode("branch_then", "cmp_passthrough", 260, -140, {
          _label: "Then 占位",
        }),
        compositeNode("branch_else", "cmp_passthrough", 260, 140, {
          _label: "Else 占位",
        }),
        compositeNode("route_join", "ctl_join", 540, 0, {
          _label: "分支汇合",
        }),
        compositeNode("after_join", "cmp_passthrough", 820, 0, {
          _label: "汇合后",
        }),
      ],
      edges: [
        compositeEdge(
          "edge_then_activation",
          "route_if",
          "then",
          "branch_then",
          RESERVED_ACTIVATION_PORT_ID,
        ),
        compositeEdge(
          "edge_else_activation",
          "route_if",
          "else",
          "branch_else",
          RESERVED_ACTIVATION_PORT_ID,
        ),
        compositeEdge(
          "edge_then_done",
          "branch_then",
          RESERVED_ACTIVATION_RESULT_PORT_ID,
          "route_join",
          "branches",
        ),
        compositeEdge(
          "edge_else_done",
          "branch_else",
          RESERVED_ACTIVATION_RESULT_PORT_ID,
          "route_join",
          "branches",
        ),
        compositeEdge(
          "edge_join_activation",
          "route_join",
          "joined",
          "after_join",
          RESERVED_ACTIVATION_PORT_ID,
        ),
      ],
      configBindings: [
        {
          sourceKey: "negate",
          targetNodeId: "route_if",
          targetConfigKey: "negate",
        },
        {
          sourceKey: "join_mode",
          targetNodeId: "route_join",
          targetConfigKey: "mode",
        },
      ],
    },
    isComposite: true,
  },
  {
    moduleId: "pkg_worldbook_engine",
    label: "📖 世界书引擎",
    category: "source",
    color: "#f59e0b",
    icon: "📖",
    description:
      "完整世界书处理管线：收集 → 关键词匹配 → 概率过滤 → 互斥组 → EJS 渲染 → Controller 展开 → 分桶",
    ports: [
      msgsIn("chat_texts", "聊天文本"),
      { id: "before", label: "before", direction: "out", dataType: "entries" },
      { id: "after", label: "after", direction: "out", dataType: "entries" },
      {
        id: "at_depth",
        label: "atDepth",
        direction: "out",
        dataType: "entries",
      },
    ],
    defaultConfig: {
      include_character: true,
      include_persona: true,
      include_chat: true,
      include_global: false,
    },
    configSchema: [
      {
        key: "include_character",
        label: "角色卡世界书",
        type: "boolean",
        exposeInSimpleMode: true,
        description: "是否纳入角色卡世界书条目。",
      },
      {
        key: "include_persona",
        label: "Persona 世界书",
        type: "boolean",
        exposeInSimpleMode: true,
        description: "是否纳入 persona 世界书条目。",
      },
      {
        key: "include_chat",
        label: "聊天世界书",
        type: "boolean",
        exposeInSimpleMode: true,
        description: "是否纳入当前聊天的世界书条目。",
      },
      {
        key: "include_global",
        label: "全局世界书",
        type: "boolean",
        exposeInSimpleMode: false,
        description: "是否把全局世界书条目也并入这个包骨架。",
      },
    ],
    compositeTemplate: {
      nodes: [
        compositeNode("src_worldbook", "src_worldbook_raw", 0, 40),
        compositeNode("keyword_match", "flt_wi_keyword_match", 260, 40),
        compositeNode("probability_filter", "flt_wi_probability", 520, 40),
        compositeNode("mutex_group", "flt_wi_mutex_group", 780, 40),
        compositeNode("controller_expand", "tfm_controller_expand", 1040, 40),
        compositeNode("bucket_entries", "tfm_wi_bucket", 1300, 40),
      ],
      edges: [
        compositeEdge(
          "edge_worldbook_to_keyword",
          "src_worldbook",
          "entries",
          "keyword_match",
          "entries",
        ),
        compositeEdge(
          "edge_keyword_to_probability",
          "keyword_match",
          "activated",
          "probability_filter",
          "entries_in",
        ),
        compositeEdge(
          "edge_probability_to_mutex",
          "probability_filter",
          "entries_out",
          "mutex_group",
          "entries_in",
        ),
        compositeEdge(
          "edge_mutex_to_expand",
          "mutex_group",
          "entries_out",
          "controller_expand",
          "controller",
        ),
        compositeEdge(
          "edge_expand_to_bucket",
          "controller_expand",
          "expanded",
          "bucket_entries",
          "entries_in",
        ),
      ],
      configBindings: [
        {
          sourceKey: "include_character",
          targetNodeId: "src_worldbook",
          targetConfigKey: "include_character",
        },
        {
          sourceKey: "include_persona",
          targetNodeId: "src_worldbook",
          targetConfigKey: "include_persona",
        },
        {
          sourceKey: "include_chat",
          targetNodeId: "src_worldbook",
          targetConfigKey: "include_chat",
        },
        {
          sourceKey: "include_global",
          targetNodeId: "src_worldbook",
          targetConfigKey: "include_global",
        },
      ],
    },
    isComposite: true,
  },
  {
    moduleId: "pkg_extension_cleaner",
    label: "🧹 扩展提示词清洗",
    category: "filter",
    color: "#3b82f6",
    icon: "🧹",
    description: "完整清洗管线：MVU 剥离 → MVU 检测 → 被忽略条目剥离",
    ports: [
      {
        id: "raw_prompts",
        label: "原始扩展提示",
        direction: "in",
        dataType: "messages",
      },
      msgsOut("cleaned", "清洗后"),
    ],
    defaultConfig: {
      hide_last_n: 0,
      limiter_enabled: false,
      limiter_count: 20,
    },
    configSchema: [
      {
        key: "hide_last_n",
        label: "隐藏末尾消息数",
        type: "number",
        min: 0,
        step: 1,
        exposeInSimpleMode: true,
        description: "插入后会作用到消息隐藏器。",
      },
      {
        key: "limiter_enabled",
        label: "启用限制器",
        type: "boolean",
        exposeInSimpleMode: true,
        description: "是否启用消息数量限制器。",
      },
      {
        key: "limiter_count",
        label: "限制器阈值",
        type: "number",
        min: 1,
        step: 1,
        exposeInSimpleMode: false,
        description: "启用限制器后的消息数量阈值。",
      },
    ],
    compositeTemplate: {
      nodes: [
        compositeNode("hide_messages", "flt_hide_messages", 0, 60),
        compositeNode("exclude_messages", "flt_context_exclude", 280, 60),
      ],
      edges: [
        compositeEdge(
          "edge_hide_to_exclude",
          "hide_messages",
          "msgs_out",
          "exclude_messages",
          "msgs_in",
        ),
      ],
      configBindings: [
        {
          sourceKey: "hide_last_n",
          targetNodeId: "hide_messages",
          targetConfigKey: "hide_last_n",
        },
        {
          sourceKey: "limiter_enabled",
          targetNodeId: "hide_messages",
          targetConfigKey: "limiter_enabled",
        },
        {
          sourceKey: "limiter_count",
          targetNodeId: "hide_messages",
          targetConfigKey: "limiter_count",
        },
      ],
    },
    isComposite: true,
  },
  {
    moduleId: "pkg_prompt_assembly",
    label: "📝 完整提示词组装",
    category: "compose",
    color: "#10b981",
    icon: "📝",
    description:
      "完整组装管线：数据源 → 世界书引擎 → 扩展清洗 → 提示词排序 → 深度注入 → 名称注入",
    ports: [msgsOut("messages", "最终消息列表")],
    defaultConfig: {
      context_turns: 8,
      hide_last_n: 0,
      limiter_enabled: false,
      limiter_count: 20,
    },
    configSchema: [
      {
        key: "context_turns",
        label: "上下文轮数",
        type: "number",
        min: 1,
        step: 1,
        exposeInSimpleMode: true,
        description: "读取最近多少轮聊天历史作为提示词骨架。",
      },
      {
        key: "hide_last_n",
        label: "隐藏末尾消息数",
        type: "number",
        min: 0,
        step: 1,
        exposeInSimpleMode: true,
        description: "拼装后对消息列表做轻量裁剪。",
      },
      {
        key: "limiter_enabled",
        label: "启用限制器",
        type: "boolean",
        exposeInSimpleMode: false,
        description: "启用消息数量限制器。",
      },
      {
        key: "limiter_count",
        label: "限制器阈值",
        type: "number",
        min: 1,
        step: 1,
        exposeInSimpleMode: false,
        description: "启用限制器后的消息数量阈值。",
      },
    ],
    compositeTemplate: {
      nodes: [
        compositeNode("src_messages", "src_chat_history", 0, 40),
        compositeNode("src_extensions", "src_extension_prompts", 0, 240),
        compositeNode("concat_messages", "cmp_message_concat", 280, 140),
        compositeNode("hide_messages", "flt_hide_messages", 560, 140),
      ],
      edges: [
        compositeEdge(
          "edge_messages_to_concat",
          "src_messages",
          "messages",
          "concat_messages",
          "a",
        ),
        compositeEdge(
          "edge_extensions_to_concat",
          "src_extensions",
          "before_prompt",
          "concat_messages",
          "b",
        ),
        compositeEdge(
          "edge_concat_to_hide",
          "concat_messages",
          "msgs_out",
          "hide_messages",
          "msgs_in",
        ),
      ],
      configBindings: [
        {
          sourceKey: "context_turns",
          targetNodeId: "src_messages",
          targetConfigKey: "context_turns",
        },
        {
          sourceKey: "hide_last_n",
          targetNodeId: "hide_messages",
          targetConfigKey: "hide_last_n",
        },
        {
          sourceKey: "limiter_enabled",
          targetNodeId: "hide_messages",
          targetConfigKey: "limiter_enabled",
        },
        {
          sourceKey: "limiter_count",
          targetNodeId: "hide_messages",
          targetConfigKey: "limiter_count",
        },
      ],
    },
    isComposite: true,
  },
  {
    moduleId: "pkg_full_workflow",
    label: "🚀 完整工作流",
    category: "execute",
    color: "#ef4444",
    icon: "🚀",
    description:
      "完整工作流管线：等同于当前的 EwFlowConfig — 全部数据源 → 提示词 → LLM 调用 → 响应处理 → 输出",
    ports: [
      { id: "result", label: "执行结果", direction: "out", dataType: "json" },
    ],
    defaultConfig: {
      context_turns: 8,
      use_main_api: false,
      model: "",
      request_thinking: false,
      reasoning_effort: "auto",
    },
    configSchema: [
      {
        key: "context_turns",
        label: "上下文轮数",
        type: "number",
        min: 1,
        step: 1,
        exposeInSimpleMode: true,
        description: "主链路读取最近多少轮聊天历史。",
      },
      {
        key: "use_main_api",
        label: "使用主 API",
        type: "boolean",
        exposeInSimpleMode: true,
        description: "启用后让完整工作流优先走酒馆主 API。",
      },
      {
        key: "model",
        label: "模型名",
        type: "text",
        exposeInSimpleMode: true,
        placeholder: "gpt-4.1 / gemini / claude ...",
        description: "插入时会写入内部 API 预设节点。",
      },
      {
        key: "request_thinking",
        label: "请求思考内容",
        type: "boolean",
        exposeInSimpleMode: false,
        description: "插入时会写入行为参数节点。",
      },
      {
        key: "reasoning_effort",
        label: "Reasoning Effort",
        type: "select",
        options: ["auto", "low", "medium", "high"],
        exposeInSimpleMode: false,
        description: "插入时会写入行为参数节点。",
      },
    ],
    compositeTemplate: {
      nodes: [
        compositeNode("src_messages", "src_chat_history", 0, 120),
        compositeNode("cfg_api", "cfg_api_preset", 0, 320),
        compositeNode("cfg_generation", "cfg_generation", 0, 500),
        compositeNode("cfg_behavior", "cfg_behavior", 0, 700),
        compositeNode("llm_call", "exe_llm_call", 320, 300),
        compositeNode("out_reply", "out_reply_inject", 620, 300),
      ],
      edges: [
        compositeEdge(
          "edge_messages_to_llm",
          "src_messages",
          "messages",
          "llm_call",
          "messages",
        ),
        compositeEdge(
          "edge_api_to_llm",
          "cfg_api",
          "config",
          "llm_call",
          "api_config",
        ),
        compositeEdge(
          "edge_generation_to_llm",
          "cfg_generation",
          "options",
          "llm_call",
          "gen_options",
        ),
        compositeEdge(
          "edge_behavior_to_llm",
          "cfg_behavior",
          "options",
          "llm_call",
          "behavior",
        ),
        compositeEdge(
          "edge_llm_to_reply",
          "llm_call",
          "raw_response",
          "out_reply",
          "instruction",
        ),
      ],
      configBindings: [
        {
          sourceKey: "context_turns",
          targetNodeId: "src_messages",
          targetConfigKey: "context_turns",
        },
        {
          sourceKey: "use_main_api",
          targetNodeId: "cfg_api",
          targetConfigKey: "use_main_api",
        },
        {
          sourceKey: "model",
          targetNodeId: "cfg_api",
          targetConfigKey: "model",
        },
        {
          sourceKey: "request_thinking",
          targetNodeId: "cfg_behavior",
          targetConfigKey: "request_thinking",
        },
        {
          sourceKey: "reasoning_effort",
          targetNodeId: "cfg_behavior",
          targetConfigKey: "reasoning_effort",
        },
      ],
    },
    isComposite: true,
  },
];

// ════════════════════════════════════════════════════════════
// 🧭 Control — 控制流模块
// ════════════════════════════════════════════════════════════

const CONTROL_MODULES: ModuleBlueprint[] = [
  {
    moduleId: "ctl_if",
    label: "条件分支",
    category: "control",
    color: "#f97316",
    icon: "🧭",
    description: "根据输入条件输出 then / else 激活信号，用于驱动分支链路。",
    ports: [
      {
        id: "condition",
        label: "条件",
        direction: "in",
        dataType: "any",
      },
      activationOut("then", "Then"),
      activationOut("else", "Else"),
      {
        id: "selected_branch",
        label: "命中分支",
        direction: "out",
        dataType: "text",
      },
    ],
    defaultConfig: {
      negate: false,
    },
    configSchema: [
      {
        key: "negate",
        label: "反转条件",
        type: "boolean",
        exposeInSimpleMode: false,
        description: "启用后把 truthy / falsy 结果反转。",
      },
    ],
  },
  {
    moduleId: "ctl_join",
    label: "分支汇合",
    category: "control",
    color: "#f97316",
    icon: "🔀",
    description: "聚合多个 activation 输入，并按 any/all 策略输出 joined 激活信号。",
    ports: [
      {
        id: "branches",
        label: "分支完成",
        direction: "in",
        dataType: "activation",
        multiple: true,
        optional: true,
      },
      activationOut("joined", "Joined"),
      {
        id: "joined_count",
        label: "命中分支数",
        direction: "out",
        dataType: "number",
      },
      {
        id: "pending_count",
        label: "待满足分支数",
        direction: "out",
        dataType: "number",
      },
      {
        id: "mode",
        label: "聚合模式",
        direction: "out",
        dataType: "text",
      },
    ],
    defaultConfig: {
      mode: "all",
    },
    configSchema: [
      {
        key: "mode",
        label: "聚合策略",
        type: "select",
        options: ["all", "any"],
        exposeInSimpleMode: false,
        description: "all 需要所有已配置分支都完成；any 命中任一分支即可。",
      },
    ],
  },
];

// ════════════════════════════════════════════════════════════
// Registry
// ════════════════════════════════════════════════════════════

const ALL_MODULES_BASE: ModuleBlueprint[] = [
  ...withRuntimeMeta(SOURCE_MODULES, {
    schemaVersion: 1,
    runtimeKind: "dataflow",
    capability: "source",
    sideEffect: "reads_host",
    migration: { strategy: "compatible" },
  }),
  ...withRuntimeMeta(FILTER_MODULES, {
    schemaVersion: 1,
    runtimeKind: "dataflow",
    sideEffect: "pure",
    migration: { strategy: "compatible" },
  }),
  ...withRuntimeMeta(TRANSFORM_MODULES, {
    schemaVersion: 1,
    runtimeKind: "dataflow",
    sideEffect: "pure",
    migration: { strategy: "compatible" },
  }),
  ...withRuntimeMeta(COMPOSE_MODULES, {
    schemaVersion: 1,
    runtimeKind: "dataflow",
    sideEffect: "pure",
    migration: { strategy: "compatible" },
  }),
  ...withRuntimeMeta(CONTROL_MODULES, {
    schemaVersion: 1,
    runtimeKind: "control",
    capability: "pure",
    sideEffect: "pure",
    migration: { strategy: "compatible" },
  }),
  ...withRuntimeMeta(EXECUTE_MODULES, {
    schemaVersion: 1,
    runtimeKind: "hybrid",
    capability: "network",
    sideEffect: "unknown",
    migration: { strategy: "compatible" },
  }),
  ...withRuntimeMeta(OUTPUT_MODULES, {
    schemaVersion: 1,
    runtimeKind: "hybrid",
    sideEffect: "writes_host",
    migration: { strategy: "compatible" },
  }),
  ...withRuntimeMeta(CONFIG_MODULES, {
    schemaVersion: 1,
    runtimeKind: "dataflow",
    sideEffect: "pure",
    migration: { strategy: "compatible" },
  }),
  ...withRuntimeMeta(COMPOSITE_MODULES, {
    schemaVersion: 1,
    runtimeKind: "hybrid",
    sideEffect: "unknown",
    migration: { strategy: "legacy_bridge" },
  }),
];

const MODULE_METADATA_PILOT_BY_ID: Readonly<
  Record<
    string,
    {
      constraints: ModuleMetadataConstraintSummary;
      help: ModuleMetadataHelpSummary;
      ui: ModuleMetadataUiSummary;
    }
  >
> = {
  src_user_input: {
    constraints: {
      outputs: [
        {
          portId: "text",
          direction: "out",
          summary:
            "输出当前触发事件携带的单段用户输入文本；为空时保守降级为空字符串。",
        },
      ],
    },
    help: {
      summary: "读取当前触发图执行的用户输入文本。",
      whenToUse: "作为文本处理链路的起点，适合接到过滤或拼接节点。",
      caution: "仅暴露当前触发输入，不承担历史对话聚合。",
      runtimeUsage:
        "运行时从执行上下文读取 userInput，并向 diagnostics 暴露 source/reads_host 语义摘要。",
    },
    ui: { badge: "Source", accent: "info" },
  },
  flt_mvu_strip: {
    constraints: {
      inputs: [
        {
          portId: "text_in",
          direction: "in",
          summary:
            "期望单段文本输入；若上游缺失或非字符串，运行时保守按空文本处理。",
        },
      ],
      outputs: [
        {
          portId: "text_out",
          direction: "out",
          summary: "输出剥离 MVU XML 块后的净化文本，不引入新的宿主副作用。",
        },
      ],
    },
    help: {
      summary: "剥离文本中的 MVU XML 块与相关产物。",
      whenToUse: "接在用户输入或模型输出后，做轻量净化。",
      caution: "仅做文本清洗，不负责宿主写入或状态控制。",
      runtimeUsage: "运行时只消费说明性输入约束，不把它提升为新的强类型系统。",
    },
    ui: { badge: "Pure", accent: "success" },
  },
  out_reply_inject: {
    constraints: {
      inputs: [
        {
          portId: "instruction",
          direction: "in",
          summary:
            "需要可序列化为字符串的指令文本；终端节点自身不产生数据流输出。",
        },
      ],
    },
    help: {
      summary: "把指令文本写入宿主 reply instruction。",
      whenToUse: "作为终端输出节点，把处理后的文本交给宿主回复注入。",
      caution: "会产生宿主写入，不应视为纯计算节点。",
      runtimeUsage:
        "运行时沿用 internal-only host write descriptor，并复用 metadata summary 供 explain/diagnostics 展示。",
    },
    ui: { badge: "Host Write", accent: "warning" },
  },
};

const ALL_MODULES: ModuleBlueprint[] = ALL_MODULES_BASE.map((baseModule) => {
  const module = withReservedActivationPorts(baseModule);
  const pilotMetadata = MODULE_METADATA_PILOT_BY_ID[module.moduleId];
  if (!pilotMetadata) {
    const hasConfigFactSurface =
      (module.configSchema?.length ?? 0) > 0 ||
      (module.configMetadata?.schemaFields?.length ?? 0) > 0;
    if (!hasConfigFactSurface) {
      return module;
    }
    return withMetadataSurface(module, {
      semantic: {
        runtimeKind: module.runtimeMeta?.runtimeKind,
        capability: module.runtimeMeta?.capability,
        sideEffect: module.runtimeMeta?.sideEffect,
        hostWriteHint: module.runtimeMeta?.hostTargetHint,
      },
    });
  }
  return withMetadataSurface(module, {
    semantic: {
      runtimeKind: module.runtimeMeta?.runtimeKind,
      capability: module.runtimeMeta?.capability,
      sideEffect: module.runtimeMeta?.sideEffect,
      hostWriteHint: module.runtimeMeta?.hostTargetHint,
    },
    constraints: pilotMetadata.constraints,
    help: pilotMetadata.help,
    ui: pilotMetadata.ui,
  });
});

/** Map for O(1) lookup by moduleId */
export const MODULE_REGISTRY: ReadonlyMap<string, ModuleBlueprint> = new Map(
  ALL_MODULES.map((m) => [m.moduleId, m]),
);

/** Get a module blueprint by ID, throws if not found */
export function getModuleBlueprint(moduleId: string): ModuleBlueprint {
  const bp = MODULE_REGISTRY.get(moduleId);
  if (!bp) {
    throw new Error(`[ModuleRegistry] Unknown module: ${moduleId}`);
  }
  return bp;
}

function cloneRecord<T extends Record<string, any> | undefined>(
  value: T,
): Record<string, any> {
  return value && typeof value === "object" ? { ...value } : {};
}

/**
 * Resolve the effective node config by layering persisted config over module defaults.
 *
 * This keeps older graph documents and fixtures backward compatible when new
 * default-backed metadata fields are introduced later.
 *
 * Unknown modules are preserved as-is to honor the graph document codec's
 * forward-compatibility contract.
 */
export function resolveModuleConfigWithDefaults(
  moduleId: string,
  config: Record<string, any> | undefined,
): Record<string, any> {
  const rawConfig = cloneRecord(config);
  const blueprint = MODULE_REGISTRY.get(moduleId);
  if (!blueprint) {
    return rawConfig;
  }
  return {
    ...cloneRecord(blueprint.defaultConfig),
    ...rawConfig,
  };
}

export function instantiateCompositeTemplate(params: {
  moduleId: string;
  origin?: { x: number; y: number };
  exposedConfig?: Record<string, any>;
}): { nodes: ModuleBlueprint["compositeTemplate"]["nodes"]; edges: ModuleBlueprint["compositeTemplate"]["edges"] } | null {
  const blueprint = MODULE_REGISTRY.get(params.moduleId);
  const template = blueprint?.compositeTemplate;
  if (!blueprint || !template || template.nodes.length === 0) {
    return null;
  }

  const effectiveExposedConfig = {
    ...cloneRecord(blueprint.defaultConfig),
    ...cloneRecord(params.exposedConfig),
  };
  const origin = params.origin ?? { x: 120, y: 120 };
  const minX = Math.min(...template.nodes.map((node) => node.position.x));
  const minY = Math.min(...template.nodes.map((node) => node.position.y));
  const idSuffix = `${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const nodeIdMap = new Map<string, string>();

  const nodes = template.nodes.map((node) => {
    const nextId = `${node.id}_${idSuffix}`;
    nodeIdMap.set(node.id, nextId);
    return {
      ...node,
      id: nextId,
      position: {
        x: origin.x + (node.position.x - minX),
        y: origin.y + (node.position.y - minY),
      },
      config: resolveModuleConfigWithDefaults(node.moduleId, node.config),
      runtimeMeta: node.runtimeMeta ? { ...node.runtimeMeta } : undefined,
    };
  });

  for (const binding of template.configBindings ?? []) {
    if (!(binding.sourceKey in effectiveExposedConfig)) {
      continue;
    }
    const targetNodeId = nodeIdMap.get(binding.targetNodeId);
    if (!targetNodeId) {
      continue;
    }
    const targetNode = nodes.find((node) => node.id === targetNodeId);
    if (!targetNode) {
      continue;
    }
    targetNode.config = {
      ...targetNode.config,
      [binding.targetConfigKey]: effectiveExposedConfig[binding.sourceKey],
    };
  }

  const edges = template.edges.map((edge) => ({
    ...edge,
    id: `${edge.id}_${idSuffix}`,
    source: nodeIdMap.get(edge.source) ?? edge.source,
    target: nodeIdMap.get(edge.target) ?? edge.target,
    runtimeMeta: edge.runtimeMeta ? { ...edge.runtimeMeta } : undefined,
  }));

  return { nodes, edges };
}

export function getModuleMetadataSurface(
  moduleId: string,
): ModuleBlueprint["metadata"] | undefined {
  return getModuleBlueprint(moduleId).metadata;
}

export function getModuleExplainContract(
  moduleId: string,
): ModuleExplainContract | null {
  return getModuleMetadataSurface(moduleId)?.explain ?? null;
}

export function getModuleMetadataSummary(moduleId: string): {
  semantic: ModuleBlueprint["metadata"] extends infer T
    ? T extends { semantic: infer S }
      ? S
      : never
    : never;
  configFields?: readonly ModuleMetadataSchemaFieldSummary[];
  inputConstraintSummary?: readonly string[];
  outputConstraintSummary?: readonly string[];
  helpSummary?: string;
  runtimeUsage?: string;
  diagnosticsLabel?: string;
  explainContract?: ModuleExplainContract;
} | null {
  const metadata = getModuleMetadataSurface(moduleId);
  if (!metadata) {
    return null;
  }
  const explain = metadata.explain;
  return {
    semantic: metadata.semantic,
    configFields: explain?.config.schemaFields ?? metadata.config?.schemaFields,
    inputConstraintSummary: explain?.ports.inputs.map(
      (constraint) => `${constraint.portId}:${constraint.summary}`,
    ),
    outputConstraintSummary: explain?.ports.outputs.map(
      (constraint) => `${constraint.portId}:${constraint.summary}`,
    ),
    helpSummary: explain?.help?.summary ?? metadata.help?.summary,
    runtimeUsage: explain?.help?.runtimeUsage ?? metadata.help?.runtimeUsage,
    diagnosticsLabel:
      explain?.diagnostics.hostWrite ?? metadata.diagnostics?.hostWriteLabel,
    explainContract: explain,
  };
}

/** Get all modules in a category */
export function getModulesByCategory(category: string): ModuleBlueprint[] {
  return ALL_MODULES.filter((m) => m.category === category);
}

/** Get all composite (package) modules */
export function getCompositeModules(): ModuleBlueprint[] {
  return ALL_MODULES.filter((m) => m.isComposite);
}

/** Get all non-composite (atomic) modules */
export function getAtomicModules(): ModuleBlueprint[] {
  return ALL_MODULES.filter((m) => !m.isComposite);
}

/** Total module count */
export const MODULE_COUNT = ALL_MODULES.length;
