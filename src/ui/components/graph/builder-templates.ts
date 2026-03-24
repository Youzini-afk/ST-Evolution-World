import {
  instantiateCompositeTemplate,
  resolveModuleConfigWithDefaults,
} from "./module-registry";
import type {
  BuilderTemplateFeatureFamily,
  BuilderTemplateKind,
  WorkbenchBuilderMode,
  WorkbenchEdge,
  WorkbenchGenerationOwnership,
  WorkbenchGraph,
  WorkbenchNode,
} from "./module-types";

export interface BuilderWorkflowTemplateDefinition {
  id: string;
  label: string;
  summary: string;
  description: string;
  tags: readonly string[];
  learningHighlights: readonly string[];
  contractPreview: readonly string[];
  templateKind: BuilderTemplateKind;
  featureFamily: BuilderTemplateFeatureFamily;
  featured?: boolean;
  ownership: WorkbenchGenerationOwnership;
  recommendedBuilderMode: WorkbenchBuilderMode;
  timing: WorkbenchGraph["timing"];
  createGraph: () => WorkbenchGraph;
}

function createGraphId(seed: string): string {
  return `graph_${seed}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

function createNode(
  id: string,
  moduleId: string,
  x: number,
  y: number,
  config: Record<string, any> = {},
): WorkbenchNode {
  return {
    id,
    moduleId,
    position: { x, y },
    config: resolveModuleConfigWithDefaults(moduleId, config),
    collapsed: false,
  };
}

function createEdge(
  id: string,
  source: string,
  sourcePort: string,
  target: string,
  targetPort: string,
): WorkbenchEdge {
  return {
    id,
    source,
    sourcePort,
    target,
    targetPort,
  };
}

function createBaseGraph(params: {
  templateId: string;
  name: string;
  timing: WorkbenchGraph["timing"];
  ownership: WorkbenchGenerationOwnership;
  builderMode: WorkbenchBuilderMode;
  priority?: number;
  nodes?: WorkbenchNode[];
  edges?: WorkbenchEdge[];
}): WorkbenchGraph {
  return {
    id: createGraphId(params.templateId),
    name: params.name,
    enabled: true,
    timing: params.timing,
    priority: params.priority ?? 100,
    nodes: [...(params.nodes ?? [])],
    edges: [...(params.edges ?? [])],
    viewport: { x: 0, y: 0, zoom: 1 },
    runtimeMeta: {
      schemaVersion: 1,
      runtimeKind: "dataflow",
      builderMode: params.builderMode,
      generationOwnership: params.ownership,
      templateId: params.templateId,
      templateLabel: params.name,
    },
  };
}

export function createBlankBuilderGraph(params?: {
  name?: string;
  builderMode?: WorkbenchBuilderMode;
  generationOwnership?: WorkbenchGenerationOwnership;
  timing?: WorkbenchGraph["timing"];
}): WorkbenchGraph {
  return createBaseGraph({
    templateId: "blank_builder",
    name: params?.name ?? "空白工作流",
    timing: params?.timing ?? "default",
    ownership: params?.generationOwnership ?? "assistive",
    builderMode: params?.builderMode ?? "simple",
  });
}

function createReplyInjectStarterGraph(): WorkbenchGraph {
  const nodes = [
    createNode("src_text", "src_user_input", 40, 90),
    createNode("filter_text", "flt_mvu_strip", 300, 90),
    createNode("out_reply", "out_reply_inject", 560, 90),
  ];
  const edges = [
    createEdge("edge_src_to_filter", "src_text", "text", "filter_text", "text_in"),
    createEdge(
      "edge_filter_to_reply",
      "filter_text",
      "text_out",
      "out_reply",
      "instruction",
    ),
  ];

  return createBaseGraph({
    templateId: "starter_reply_inject",
    name: "回复指令注入起步",
    timing: "before_reply",
    ownership: "assistive",
    builderMode: "simple",
    nodes,
    edges,
  });
}

function createMainTakeoverStarterGraph(): WorkbenchGraph {
  const nodes = [
    createNode("src_messages", "src_chat_history", 40, 60),
    createNode("cfg_api", "cfg_api_preset", 40, 260),
    createNode("cfg_generation", "cfg_generation", 40, 430),
    createNode("cfg_behavior", "cfg_behavior", 40, 600),
    createNode("llm_call", "exe_llm_call", 340, 170),
    createNode("out_reply", "out_reply_inject", 640, 170),
  ];
  const edges = [
    createEdge(
      "edge_messages_to_llm",
      "src_messages",
      "messages",
      "llm_call",
      "messages",
    ),
    createEdge("edge_api_to_llm", "cfg_api", "config", "llm_call", "api_config"),
    createEdge(
      "edge_generation_to_llm",
      "cfg_generation",
      "options",
      "llm_call",
      "gen_options",
    ),
    createEdge(
      "edge_behavior_to_llm",
      "cfg_behavior",
      "options",
      "llm_call",
      "behavior",
    ),
    createEdge(
      "edge_llm_to_reply",
      "llm_call",
      "raw_response",
      "out_reply",
      "instruction",
    ),
  ];

  return createBaseGraph({
    templateId: "starter_main_takeover",
    name: "LLM 接管起步",
    timing: "before_reply",
    ownership: "optional_main_takeover",
    builderMode: "advanced",
    priority: 80,
    nodes,
    edges,
  });
}

function createFloorBindingStarterGraph(): WorkbenchGraph {
  const nodes = [
    createNode("src_context", "src_flow_context", 40, 120),
    createNode("compose_body", "cmp_json_body_build", 290, 120),
    createNode("out_floor", "out_floor_bind", 550, 120),
  ];
  const edges = [
    createEdge(
      "edge_context_to_body",
      "src_context",
      "context",
      "compose_body",
      "context",
    ),
    createEdge("edge_body_to_floor", "compose_body", "body", "out_floor", "result"),
  ];

  return createBaseGraph({
    templateId: "starter_floor_binding",
    name: "楼层结果绑定起步",
    timing: "after_reply",
    ownership: "assistive",
    builderMode: "simple",
    nodes,
    edges,
  });
}

function createRequestTemplateStarterGraph(): WorkbenchGraph {
  const nodes = [
    createNode("src_context", "src_flow_context", 40, 110),
    createNode("compose_body", "cmp_json_body_build", 290, 110),
    createNode("request_template", "cmp_request_template", 560, 110, {
      template: '{\n  "chat_id": "{{chat_id}}",\n  "trigger": "{{trigger}}"\n}',
    }),
    createNode("out_floor", "out_floor_bind", 840, 110),
  ];
  const edges = [
    createEdge(
      "edge_context_to_body",
      "src_context",
      "context",
      "compose_body",
      "context",
    ),
    createEdge(
      "edge_body_to_template",
      "compose_body",
      "body",
      "request_template",
      "body",
    ),
    createEdge(
      "edge_template_to_floor",
      "request_template",
      "result",
      "out_floor",
      "result",
    ),
  ];

  return createBaseGraph({
    templateId: "starter_request_template",
    name: "请求模板试验台",
    timing: "after_reply",
    ownership: "assistive",
    builderMode: "advanced",
    nodes,
    edges,
  });
}

function createRetryFallbackCleanupStarterGraph(): WorkbenchGraph {
  const fragment = instantiateCompositeTemplate({
    moduleId: "frag_retry_fallback_text_cleanup",
    origin: { x: 300, y: 60 },
    exposedConfig: {
      retry_attempts: 2,
    },
  });
  if (!fragment) {
    return createReplyInjectStarterGraph();
  }

  const textEntry = fragment.contract.entries.find(
    (entry) => entry.key === "text_in",
  );
  const textExit = fragment.contract.exits.find(
    (entry) => entry.key === "text_out",
  );
  if (!textEntry || textEntry.targets.length === 0 || !textExit) {
    return createReplyInjectStarterGraph();
  }

  const nodes = [
    createNode("src_text", "src_user_input", 40, 220),
    ...fragment.nodes,
    createNode("out_reply", "out_reply_inject", 1600, 240),
  ];
  const edges = [
    ...fragment.edges,
    ...textEntry.targets.map((target, index) =>
      createEdge(
        `edge_retry_cleanup_input_${index}`,
        "src_text",
        "text",
        target.nodeId,
        target.portId,
      ),
    ),
    createEdge(
      "edge_retry_cleanup_to_reply",
      textExit.source.nodeId,
      textExit.source.portId,
      "out_reply",
      "instruction",
    ),
  ];

  return createBaseGraph({
    templateId: "starter_retry_fallback_cleanup",
    name: "重试回退文本清洗起步",
    timing: "before_reply",
    ownership: "assistive",
    builderMode: "simple",
    nodes,
    edges,
  });
}

function createRetryFallbackCompositionLabGraph(): WorkbenchGraph {
  const cleanupFragment = instantiateCompositeTemplate({
    moduleId: "frag_text_cleanup_stage",
    origin: { x: 280, y: 40 },
    exposedConfig: {
      retry_attempts: 2,
    },
  });
  const fallbackFragment = instantiateCompositeTemplate({
    moduleId: "frag_retry_value_fallback",
    origin: { x: 980, y: 120 },
  });
  if (!cleanupFragment || !fallbackFragment) {
    return createRetryFallbackCleanupStarterGraph();
  }

  const cleanupTextEntry = cleanupFragment.contract.entries.find(
    (entry) => entry.key === "text_in",
  );
  const cleanupTextExit = cleanupFragment.contract.exits.find(
    (entry) => entry.key === "text_out",
  );
  const cleanupRetryExit = cleanupFragment.contract.exits.find(
    (entry) => entry.key === "retry_exhausted",
  );
  const fallbackRetryEntry = fallbackFragment.contract.entries.find(
    (entry) => entry.key === "retry_exhausted",
  );
  const fallbackPrimaryEntry = fallbackFragment.contract.entries.find(
    (entry) => entry.key === "primary_value",
  );
  const fallbackValueEntry = fallbackFragment.contract.entries.find(
    (entry) => entry.key === "fallback_value",
  );
  const fallbackValueExit = fallbackFragment.contract.exits.find(
    (entry) => entry.key === "value_out",
  );
  if (
    !cleanupTextEntry ||
    cleanupTextEntry.targets.length === 0 ||
    !cleanupTextExit ||
    !cleanupRetryExit ||
    !fallbackRetryEntry ||
    fallbackRetryEntry.targets.length === 0 ||
    !fallbackPrimaryEntry ||
    fallbackPrimaryEntry.targets.length === 0 ||
    !fallbackValueEntry ||
    fallbackValueEntry.targets.length === 0 ||
    !fallbackValueExit
  ) {
    return createRetryFallbackCleanupStarterGraph();
  }

  const nodes = [
    createNode("src_text", "src_user_input", 40, 260),
    ...cleanupFragment.nodes,
    ...fallbackFragment.nodes,
    createNode("out_reply", "out_reply_inject", 1700, 260),
  ];
  const edges = [
    ...cleanupFragment.edges,
    ...fallbackFragment.edges,
    ...cleanupTextEntry.targets.map((target, index) =>
      createEdge(
        `edge_retry_lab_input_${index}`,
        "src_text",
        "text",
        target.nodeId,
        target.portId,
      ),
    ),
    createEdge(
      "edge_retry_lab_retry_flag",
      cleanupRetryExit.source.nodeId,
      cleanupRetryExit.source.portId,
      fallbackRetryEntry.targets[0].nodeId,
      fallbackRetryEntry.targets[0].portId,
    ),
    createEdge(
      "edge_retry_lab_primary",
      cleanupTextExit.source.nodeId,
      cleanupTextExit.source.portId,
      fallbackPrimaryEntry.targets[0].nodeId,
      fallbackPrimaryEntry.targets[0].portId,
    ),
    createEdge(
      "edge_retry_lab_fallback",
      "src_text",
      "text",
      fallbackValueEntry.targets[0].nodeId,
      fallbackValueEntry.targets[0].portId,
    ),
    createEdge(
      "edge_retry_lab_to_reply",
      fallbackValueExit.source.nodeId,
      fallbackValueExit.source.portId,
      "out_reply",
      "instruction",
    ),
  ];

  return createBaseGraph({
    templateId: "starter_retry_fallback_composition_lab",
    name: "重试回退组合实验台",
    timing: "before_reply",
    ownership: "assistive",
    builderMode: "advanced",
    nodes,
    edges,
  });
}

export const BUILDER_WORKFLOW_TEMPLATES: readonly BuilderWorkflowTemplateDefinition[] =
  [
    {
      id: "blank_builder",
      label: "空白工作流",
      summary: "从干净画布起步，但保留 Builder 元数据骨架。",
      description:
        "适合已经知道要搭什么的人。会保留 simple/advanced 与生成所有权占位，不需要先手写图文档。",
      tags: ["空白画布", "自定义", "Builder 骨架"],
      learningHighlights: [
        "自由画布起步",
        "保留 Builder 元数据骨架",
        "适合直接开画",
      ],
      contractPreview: [
        "入口 · 无预设链路",
        "输出 · 无预设输出",
        "元数据 · 保留 builderMode / ownership",
      ],
      templateKind: "starter",
      featureFamily: "general",
      ownership: "assistive",
      recommendedBuilderMode: "simple",
      timing: "default",
      createGraph: () => createBlankBuilderGraph(),
    },
    {
      id: "starter_reply_inject",
      label: "回复指令注入起步",
      summary: "用户输入 -> 清洗 -> 回复注入，适合做轻量辅助工作流。",
      description:
        "这是最适合新手理解的起步图：先拿到用户输入，再做一层净化，最后把结果注入回复指令。",
      tags: ["辅助工作流", "回复注入", "simple"],
      learningHighlights: [
        "Simple 起步图",
        "辅助工作流入口",
        "用户输入到回复注入",
      ],
      contractPreview: [
        "入口 · user_input.text",
        "处理 · flt_mvu_strip",
        "输出 · reply.instruction",
      ],
      templateKind: "starter",
      featureFamily: "reply_inject",
      featured: true,
      ownership: "assistive",
      recommendedBuilderMode: "simple",
      timing: "before_reply",
      createGraph: createReplyInjectStarterGraph,
    },
    {
      id: "starter_main_takeover",
      label: "LLM 接管起步",
      summary: "聊天历史 + API 预设 + 生成参数 -> LLM 调用 -> 回复注入。",
      description:
        "用于搭建“渐进主生成接管”骨架。它不会切死 legacy，但会把主生成 ownership 的入口与图结构先立起来。",
      tags: ["主生成预备", "LLM", "takeover"],
      learningHighlights: [
        "渐进主生成接管预备",
        "保留 legacy fallback",
        "Advanced 起步骨架",
      ],
      contractPreview: [
        "入口 · chat_history.messages",
        "所有权 · optional_main_takeover",
        "输出 · reply.instruction",
      ],
      templateKind: "starter",
      featureFamily: "main_takeover",
      featured: true,
      ownership: "optional_main_takeover",
      recommendedBuilderMode: "advanced",
      timing: "before_reply",
      createGraph: createMainTakeoverStarterGraph,
    },
    {
      id: "starter_floor_binding",
      label: "楼层结果绑定起步",
      summary: "把流上下文组装成结果并写回楼层，适合结果后处理与可视化链路。",
      description:
        "这类图适合做辅助结果链路，例如把工作流结果挂回当前对话楼层，后面再逐步补更复杂的处理节点。",
      tags: ["后处理", "楼层绑定", "assistive"],
      learningHighlights: [
        "结果绑定起步",
        "回复后链路",
        "适合后处理与可视化",
      ],
      contractPreview: [
        "入口 · flow_context.context",
        "处理 · cmp_json_body_build",
        "输出 · floor.result",
      ],
      templateKind: "starter",
      featureFamily: "floor_binding",
      ownership: "assistive",
      recommendedBuilderMode: "simple",
      timing: "after_reply",
      createGraph: createFloorBindingStarterGraph,
    },
    {
      id: "starter_request_template",
      label: "请求模板试验台",
      summary: "流上下文 -> JSON Body -> 请求模板 -> 楼层绑定。",
      description:
        "适合先试模板、占位 JSON 和调试 body 结构，再决定要不要继续接到更完整的执行链路。",
      tags: ["模板实验", "JSON", "advanced"],
      learningHighlights: [
        "Composition Lab",
        "JSON Body 试验台",
        "适合拆解请求模板",
      ],
      contractPreview: [
        "入口 · flow_context.context",
        "处理 · cmp_request_template.body",
        "输出 · floor.result",
      ],
      templateKind: "composition_lab",
      featureFamily: "request_template",
      ownership: "assistive",
      recommendedBuilderMode: "advanced",
      timing: "after_reply",
      createGraph: createRequestTemplateStarterGraph,
    },
    {
      id: "starter_retry_fallback_cleanup",
      label: "重试回退文本清洗",
      summary: "文本清洗先走 retry-safe 片段；若重试耗尽，则自动回退原文继续回复注入。",
      description:
        "适合作为 creator-oriented retry fallback 起步图。你可以先直接用模板，再展开内部片段，把成功链路和回退链路继续改成自己的工作流。",
      tags: ["retry fallback", "文本清洗", "assistive"],
      learningHighlights: [
        "包含 retry-safe boundary",
        "自动消费 retry_exhausted",
        "Simple 起步图",
      ],
      contractPreview: [
        "入口 · user_input.text",
        "边界 · frag_retry_fallback_text_cleanup",
        "surface · retry_exhausted",
        "输出 · reply.instruction",
      ],
      templateKind: "starter",
      featureFamily: "retry_fallback",
      featured: true,
      ownership: "assistive",
      recommendedBuilderMode: "simple",
      timing: "before_reply",
      createGraph: createRetryFallbackCleanupStarterGraph,
    },
    {
      id: "starter_retry_fallback_composition_lab",
      label: "重试回退组合实验台",
      summary:
        "把 retry-safe 文本清洗片段和通用 retry fallback 值路由片段拆开摆出来，适合作为高级创作者的组合范本。",
      description:
        "这张图不会把 retry fallback 封进黑盒，而是明确展示 retry_exhausted、primary_value、fallback_value 和最终输出的组合关系，方便你继续替换成功链路或回退链路。",
      tags: ["retry fallback", "组合范本", "advanced"],
      learningHighlights: [
        "显式展示 retry_exhausted 消费",
        "拆开成功链路与回退链路",
        "Advanced 拆解范本",
      ],
      contractPreview: [
        "入口 · user_input.text",
        "边界 · frag_text_cleanup_stage",
        "读取 · frag_retry_value_fallback.retry_exhausted",
        "输出 · reply.instruction",
      ],
      templateKind: "composition_lab",
      featureFamily: "retry_fallback",
      featured: true,
      ownership: "assistive",
      recommendedBuilderMode: "advanced",
      timing: "before_reply",
      createGraph: createRetryFallbackCompositionLabGraph,
    },
  ];

export function findBuilderWorkflowTemplate(
  templateId: string | null | undefined,
): BuilderWorkflowTemplateDefinition | null {
  if (!templateId) {
    return null;
  }
  return (
    BUILDER_WORKFLOW_TEMPLATES.find((template) => template.id === templateId) ??
    null
  );
}
