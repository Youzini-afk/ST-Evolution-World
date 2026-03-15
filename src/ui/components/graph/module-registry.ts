/* ═══ Module Workbench — Module Registry ═══ */
/* All 44 atomic modules + composite packages */

import type { ModuleBlueprint, ModulePortDef } from './module-types';

// ── Helper for common port patterns ──

const textIn = (id = 'text_in', label = '文本'): ModulePortDef =>
  ({ id, label, direction: 'in', dataType: 'text' });
const textOut = (id = 'text_out', label = '文本'): ModulePortDef =>
  ({ id, label, direction: 'out', dataType: 'text' });
const msgsIn = (id = 'msgs_in', label = '消息'): ModulePortDef =>
  ({ id, label, direction: 'in', dataType: 'messages' });
const msgsOut = (id = 'msgs_out', label = '消息'): ModulePortDef =>
  ({ id, label, direction: 'out', dataType: 'messages' });
const entriesIn = (id = 'entries_in', label = '条目'): ModulePortDef =>
  ({ id, label, direction: 'in', dataType: 'entries' });
const entriesOut = (id = 'entries_out', label = '条目'): ModulePortDef =>
  ({ id, label, direction: 'out', dataType: 'entries' });
const jsonIn = (id = 'json_in', label = 'JSON'): ModulePortDef =>
  ({ id, label, direction: 'in', dataType: 'json' });
const jsonOut = (id = 'json_out', label = 'JSON'): ModulePortDef =>
  ({ id, label, direction: 'out', dataType: 'json' });

// ════════════════════════════════════════════════════════════
// 🔌 Source — 数据源模块
// ════════════════════════════════════════════════════════════

const SOURCE_MODULES: ModuleBlueprint[] = [
  {
    moduleId: 'src_char_fields',
    label: '角色卡字段',
    category: 'source',
    color: '#f59e0b',
    icon: '👤',
    description: '从 ST 运行时获取角色卡的描述、性格、场景、系统提示等字段',
    ports: [
      { id: 'main', label: '主提示', direction: 'out', dataType: 'text' },
      { id: 'description', label: '描述', direction: 'out', dataType: 'text' },
      { id: 'personality', label: '性格', direction: 'out', dataType: 'text' },
      { id: 'scenario', label: '场景', direction: 'out', dataType: 'text' },
      { id: 'persona', label: '人设', direction: 'out', dataType: 'text' },
      { id: 'examples', label: '示例对话', direction: 'out', dataType: 'text' },
      { id: 'jailbreak', label: '越狱', direction: 'out', dataType: 'text' },
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'src_chat_history',
    label: '聊天历史',
    category: 'source',
    color: '#f59e0b',
    icon: '💬',
    description: '获取最近 N 轮对话消息',
    ports: [
      msgsOut('messages', '消息列表'),
    ],
    defaultConfig: {
      context_turns: 8,
      include_system: false,
    },
  },
  {
    moduleId: 'src_worldbook_raw',
    label: '世界书原始条目',
    category: 'source',
    color: '#f59e0b',
    icon: '📖',
    description: '从角色/人设/聊天世界书收集所有原始条目（不含全局世界书）',
    ports: [
      entriesOut('entries', '原始条目'),
    ],
    defaultConfig: {
      include_character: true,
      include_persona: true,
      include_chat: true,
      include_global: false,
    },
  },
  {
    moduleId: 'src_extension_prompts',
    label: '扩展提示词',
    category: 'source',
    color: '#f59e0b',
    icon: '🧩',
    description: '获取酒馆其他插件注入的 extension_prompts',
    ports: [
      { id: 'before_prompt', label: '前置注入', direction: 'out', dataType: 'messages' },
      { id: 'in_chat', label: '深度注入', direction: 'out', dataType: 'messages' },
      { id: 'in_prompt', label: '提示词内', direction: 'out', dataType: 'messages' },
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'src_user_input',
    label: '用户输入',
    category: 'source',
    color: '#f59e0b',
    icon: '✏️',
    description: '当前触发工作流的用户输入文本',
    ports: [
      textOut('text', '用户输入'),
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'src_flow_context',
    label: '流上下文',
    category: 'source',
    color: '#f59e0b',
    icon: '📋',
    description: '当前执行的上下文信息：chat_id, message_id, trigger 等',
    ports: [
      { id: 'context', label: '上下文', direction: 'out', dataType: 'flow_context' },
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'src_serial_results',
    label: '前序结果',
    category: 'source',
    color: '#f59e0b',
    icon: '📊',
    description: '串行模式下前序工作流的执行结果',
    ports: [
      { id: 'results', label: '前序结果', direction: 'out', dataType: 'results' },
    ],
    defaultConfig: {},
  },
];

// ════════════════════════════════════════════════════════════
// 🔍 Filter — 过滤 / 处理模块
// ════════════════════════════════════════════════════════════

const FILTER_MODULES: ModuleBlueprint[] = [
  {
    moduleId: 'flt_wi_keyword_match',
    label: 'WI 关键词匹配',
    category: 'filter',
    color: '#3b82f6',
    icon: '🔑',
    description: '对世界书条目执行关键词激活：常量、主关键词、次关键词 AND/NOT',
    ports: [
      entriesIn('entries', '候选条目'),
      msgsIn('chat_texts', '聊天文本'),
      entriesOut('activated', '激活条目'),
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'flt_wi_probability',
    label: 'WI 概率过滤',
    category: 'filter',
    color: '#3b82f6',
    icon: '🎲',
    description: '按概率过滤世界书条目（probability < 100 的条目按概率随机激活）',
    ports: [
      entriesIn(), entriesOut(),
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'flt_wi_mutex_group',
    label: 'WI 互斥组',
    category: 'filter',
    color: '#3b82f6',
    icon: '🔒',
    description: '同一互斥组内只保留一个激活条目',
    ports: [
      entriesIn(), entriesOut(),
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'flt_mvu_strip',
    label: 'MVU 内容剥离',
    category: 'filter',
    color: '#3b82f6',
    icon: '🧹',
    description: '移除文本中的 MVU XML 块和产物',
    ports: [
      textIn(), textOut(),
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'flt_mvu_detect',
    label: 'MVU 产物检测',
    category: 'filter',
    color: '#3b82f6',
    icon: '🔎',
    description: '检测文本是否为 MVU 产物，是则丢弃',
    ports: [
      textIn(),
      textOut(),
      { id: 'is_mvu', label: '是否MVU', direction: 'out', dataType: 'boolean' },
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'flt_blocked_content_strip',
    label: '被忽略条目剥离',
    category: 'filter',
    color: '#3b82f6',
    icon: '✂️',
    description: '子串匹配移除已被忽略的 WI 条目内容',
    ports: [
      textIn(),
      { id: 'blocked', label: '被忽略内容', direction: 'in', dataType: 'entries', optional: true },
      textOut(),
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'flt_regex_process',
    label: '酒馆正则处理',
    category: 'filter',
    color: '#3b82f6',
    icon: '📐',
    description: '应用酒馆内置的正则处理规则到文本',
    ports: [
      textIn(), textOut(),
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'flt_context_extract',
    label: '上下文提取规则',
    category: 'filter',
    color: '#3b82f6',
    icon: '📥',
    description: '按正则提取匹配的消息',
    ports: [
      msgsIn(), msgsOut(),
    ],
    defaultConfig: {
      rules: [],
    },
  },
  {
    moduleId: 'flt_context_exclude',
    label: '上下文排除规则',
    category: 'filter',
    color: '#3b82f6',
    icon: '📤',
    description: '按正则排除匹配的消息',
    ports: [
      msgsIn(), msgsOut(),
    ],
    defaultConfig: {
      rules: [],
    },
  },
  {
    moduleId: 'flt_custom_regex',
    label: '自定义正则替换',
    category: 'filter',
    color: '#3b82f6',
    icon: '🔧',
    description: '用户自定义的查找/替换正则规则',
    ports: [
      textIn(), textOut(),
    ],
    defaultConfig: {
      rules: [],
    },
  },
  {
    moduleId: 'flt_hide_messages',
    label: '消息隐藏器',
    category: 'filter',
    color: '#3b82f6',
    icon: '🙈',
    description: '隐藏末尾 N 条消息或按限制器阈值截断',
    ports: [
      msgsIn(), msgsOut(),
    ],
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
    moduleId: 'tfm_ejs_render',
    label: 'EJS 模板渲染',
    category: 'transform',
    color: '#8b5cf6',
    icon: '🔮',
    description: '对文本执行 EJS 模板渲染（支持 getwi/getvar 等内置函数）',
    ports: [
      textIn('template', '模板文本'),
      jsonIn('context', '模板上下文'),
      textOut('rendered', '渲染结果'),
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'tfm_macro_replace',
    label: '宏替换',
    category: 'transform',
    color: '#8b5cf6',
    icon: '🏷️',
    description: '替换 {{user}} {{char}} {{persona}} 等宏变量',
    ports: [
      textIn(), textOut(),
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'tfm_controller_expand',
    label: 'Controller 展开',
    category: 'transform',
    color: '#8b5cf6',
    icon: '🎛️',
    description: '展开 EW/Controller 条目，将 getwi 拉取的 Dyn 条目拆为独立条目',
    ports: [
      entriesIn('controller', 'Controller 条目'),
      entriesOut('expanded', '展开后条目'),
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'tfm_wi_bucket',
    label: 'WI 分桶',
    category: 'transform',
    color: '#8b5cf6',
    icon: '🗂️',
    description: '按 position 将条目分为 before / after / atDepth 三个桶',
    ports: [
      entriesIn(),
      { id: 'before', label: 'before', direction: 'out', dataType: 'entries' },
      { id: 'after', label: 'after', direction: 'out', dataType: 'entries' },
      { id: 'at_depth', label: 'atDepth', direction: 'out', dataType: 'entries' },
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'tfm_entry_name_inject',
    label: '条目名称注入',
    category: 'transform',
    color: '#8b5cf6',
    icon: '🏷️',
    description: '在世界书条目内容前插入 [条目名] 标签',
    ports: [
      msgsIn(),
      { id: 'snapshots', label: '快照', direction: 'in', dataType: 'snapshot', optional: true },
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
    moduleId: 'cmp_prompt_order',
    label: '提示词排序',
    category: 'compose',
    color: '#10b981',
    icon: '📝',
    description: '按用户配置的 prompt_order 编排所有提示词组件为消息列表',
    ports: [
      { id: 'components', label: '提示词组件', direction: 'in', dataType: 'json' },
      { id: 'order', label: '排序配置', direction: 'in', dataType: 'json', optional: true },
      msgsOut(),
    ],
    defaultConfig: {
      prompt_order: [],
    },
  },
  {
    moduleId: 'cmp_depth_inject',
    label: '深度注入',
    category: 'compose',
    color: '#10b981',
    icon: '📌',
    description: '按 depth 将消息插入聊天历史的指定位置',
    ports: [
      msgsIn('messages', '聊天消息'),
      msgsIn('injections', '待注入消息'),
      msgsOut(),
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'cmp_message_concat',
    label: '消息拼接',
    category: 'compose',
    color: '#10b981',
    icon: '🔗',
    description: '将多个消息列表按序拼接',
    ports: [
      { id: 'a', label: '列表 A', direction: 'in', dataType: 'messages' },
      { id: 'b', label: '列表 B', direction: 'in', dataType: 'messages' },
      msgsOut(),
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'cmp_json_body_build',
    label: 'JSON Body 构建',
    category: 'compose',
    color: '#10b981',
    icon: '📦',
    description: '将流上下文和配置组装为 FlowRequestV1 JSON body',
    ports: [
      { id: 'context', label: '流上下文', direction: 'in', dataType: 'flow_context' },
      { id: 'config', label: '流配置', direction: 'in', dataType: 'json', optional: true },
      jsonOut('body', 'JSON Body'),
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'cmp_request_template',
    label: '请求模板',
    category: 'compose',
    color: '#10b981',
    icon: '📋',
    description: '将 mustache 模板应用到 JSON body，支持深路径取值',
    ports: [
      jsonIn('body', '原始 Body'),
      textIn('template', '模板'),
      jsonOut('result', '合并后 Body'),
    ],
    defaultConfig: {
      template: '',
    },
  },
];

// ════════════════════════════════════════════════════════════
// 🚀 Execute — 执行模块
// ════════════════════════════════════════════════════════════

const EXECUTE_MODULES: ModuleBlueprint[] = [
  {
    moduleId: 'exe_llm_call',
    label: 'LLM 调用',
    category: 'execute',
    color: '#ef4444',
    icon: '🚀',
    description: '向 AI 模型发送请求（支持 HTTP 直连和酒馆 LLM 连接器）',
    ports: [
      msgsIn('messages', '提示词消息'),
      { id: 'api_config', label: 'API 配置', direction: 'in', dataType: 'api_config' },
      { id: 'gen_options', label: '生成参数', direction: 'in', dataType: 'gen_options', optional: true },
      { id: 'behavior', label: '行为参数', direction: 'in', dataType: 'behavior_options', optional: true },
      textOut('raw_response', '原始响应'),
    ],
    defaultConfig: {
      stream: true,
    },
  },
  {
    moduleId: 'exe_response_extract',
    label: '响应提取正则',
    category: 'execute',
    color: '#ef4444',
    icon: '🎯',
    description: '用正则表达式从响应中提取内容（第一个捕获组）',
    ports: [
      textIn('raw', '原始文本'),
      textOut('extracted', '提取结果'),
    ],
    defaultConfig: {
      pattern: '',
    },
  },
  {
    moduleId: 'exe_response_remove',
    label: '响应移除正则',
    category: 'execute',
    color: '#ef4444',
    icon: '🗑️',
    description: '用正则移除响应中的指定内容（如 <thinking> 块）',
    ports: [
      textIn('raw', '原始文本'),
      textOut('cleaned', '清理后'),
    ],
    defaultConfig: {
      pattern: '',
    },
  },
  {
    moduleId: 'exe_json_parse',
    label: 'JSON 解析',
    category: 'execute',
    color: '#ef4444',
    icon: '{ }',
    description: '从文本中提取并解析 JSON 对象（支持代码块和嵌套提取）',
    ports: [
      textIn('text', '文本'),
      jsonOut('parsed', '解析结果'),
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'exe_response_normalize',
    label: '响应标准化',
    category: 'execute',
    color: '#ef4444',
    icon: '✅',
    description: '自动补全 AI 回复中的固定字段（version/flow_id/status 等）',
    ports: [
      jsonIn('raw', '原始 JSON'),
      jsonOut('normalized', '标准化后'),
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'exe_stream_sse',
    label: 'SSE 流读取',
    category: 'execute',
    color: '#ef4444',
    icon: '📡',
    description: '从 SSE 流式响应中逐步读取完整文本',
    ports: [
      { id: 'response', label: 'HTTP 响应', direction: 'in', dataType: 'http_response' },
      textOut('full_text', '完整文本'),
    ],
    defaultConfig: {},
  },
];

// ════════════════════════════════════════════════════════════
// 📤 Output — 输出模块
// ════════════════════════════════════════════════════════════

const OUTPUT_MODULES: ModuleBlueprint[] = [
  {
    moduleId: 'out_worldbook_write',
    label: '世界书写入',
    category: 'output',
    color: '#14b8a6',
    icon: '📚',
    description: '执行世界书条目的 upsert / delete / toggle 操作',
    ports: [
      { id: 'operations', label: '操作指令', direction: 'in', dataType: 'operations' },
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'out_floor_bind',
    label: '楼层绑定',
    category: 'output',
    color: '#14b8a6',
    icon: '📌',
    description: '将工作流结果绑定到对话中指定楼层的 extra 数据',
    ports: [
      { id: 'result', label: '执行结果', direction: 'in', dataType: 'json' },
      { id: 'message_id', label: '消息 ID', direction: 'in', dataType: 'number', optional: true },
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'out_snapshot_save',
    label: '快照存储',
    category: 'output',
    color: '#14b8a6',
    icon: '💾',
    description: '将当前快照数据持久化（支持 message_data 或 file 模式）',
    ports: [
      { id: 'snapshot', label: '快照数据', direction: 'in', dataType: 'snapshot' },
    ],
    defaultConfig: {
      storage_mode: 'file',
    },
  },
  {
    moduleId: 'out_reply_inject',
    label: '回复指令注入',
    category: 'output',
    color: '#14b8a6',
    icon: '💉',
    description: '向 AI 的下一次回复注入指令文本',
    ports: [
      textIn('instruction', '指令文本'),
    ],
    defaultConfig: {},
  },
  {
    moduleId: 'out_merge_results',
    label: '结果合并',
    category: 'output',
    color: '#14b8a6',
    icon: '🔀',
    description: '将多个工作流结果合并为统一的执行计划',
    ports: [
      { id: 'results', label: '结果列表', direction: 'in', dataType: 'results', multiple: true },
      jsonOut('merged_plan', '合并计划'),
    ],
    defaultConfig: {},
  },
];

// ════════════════════════════════════════════════════════════
// ⚙ Config — 配置模块
// ════════════════════════════════════════════════════════════

const CONFIG_MODULES: ModuleBlueprint[] = [
  {
    moduleId: 'cfg_api_preset',
    label: 'API 预设',
    category: 'config',
    color: '#6366f1',
    icon: '🔑',
    description: 'API 连接配置：URL、Key、模型、Headers',
    ports: [
      { id: 'config', label: 'API 配置', direction: 'out', dataType: 'api_config' },
    ],
    defaultConfig: {
      mode: 'workflow_http',
      use_main_api: false,
      api_url: '',
      api_key: '',
      model: '',
      api_source: 'openai',
      headers_json: '',
    },
  },
  {
    moduleId: 'cfg_generation',
    label: '生成参数',
    category: 'config',
    color: '#6366f1',
    icon: '⚙',
    description: '模型生成参数：temperature, top_p, penalties, max_tokens, stream',
    ports: [
      { id: 'options', label: '生成参数', direction: 'out', dataType: 'gen_options' },
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
  },
  {
    moduleId: 'cfg_behavior',
    label: '行为参数',
    category: 'config',
    color: '#6366f1',
    icon: '🧠',
    description: '模型行为参数：推理模式、详细度、消息压缩、function calling',
    ports: [
      { id: 'options', label: '行为参数', direction: 'out', dataType: 'behavior_options' },
    ],
    defaultConfig: {
      name_behavior: 'default',
      continue_prefill: false,
      squash_system_messages: false,
      enable_function_calling: false,
      send_inline_media: false,
      request_thinking: false,
      reasoning_effort: 'auto',
      verbosity: 'auto',
    },
  },
  {
    moduleId: 'cfg_timing',
    label: '执行时机',
    category: 'config',
    color: '#6366f1',
    icon: '⏰',
    description: '工作流触发时机：before_reply 或 after_reply',
    ports: [
      { id: 'timing', label: '时机', direction: 'out', dataType: 'timing' },
    ],
    defaultConfig: {
      timing: 'after_reply',
    },
  },
  {
    moduleId: 'cfg_system_prompt',
    label: '系统提示词',
    category: 'config',
    color: '#6366f1',
    icon: '💬',
    description: '用户自定义的系统提示词文本',
    ports: [
      textOut('prompt', '系统提示'),
    ],
    defaultConfig: {
      content: '',
    },
  },
];

// ════════════════════════════════════════════════════════════
// 📦 Composite — 组合包
// ════════════════════════════════════════════════════════════

const COMPOSITE_MODULES: ModuleBlueprint[] = [
  {
    moduleId: 'pkg_worldbook_engine',
    label: '📖 世界书引擎',
    category: 'source',
    color: '#f59e0b',
    icon: '📖',
    description: '完整世界书处理管线：收集 → 关键词匹配 → 概率过滤 → 互斥组 → EJS 渲染 → Controller 展开 → 分桶',
    ports: [
      msgsIn('chat_texts', '聊天文本'),
      { id: 'before', label: 'before', direction: 'out', dataType: 'entries' },
      { id: 'after', label: 'after', direction: 'out', dataType: 'entries' },
      { id: 'at_depth', label: 'atDepth', direction: 'out', dataType: 'entries' },
    ],
    defaultConfig: {},
    isComposite: true,
  },
  {
    moduleId: 'pkg_extension_cleaner',
    label: '🧹 扩展提示词清洗',
    category: 'filter',
    color: '#3b82f6',
    icon: '🧹',
    description: '完整清洗管线：MVU 剥离 → MVU 检测 → 被忽略条目剥离',
    ports: [
      { id: 'raw_prompts', label: '原始扩展提示', direction: 'in', dataType: 'messages' },
      msgsOut('cleaned', '清洗后'),
    ],
    defaultConfig: {},
    isComposite: true,
  },
  {
    moduleId: 'pkg_prompt_assembly',
    label: '📝 完整提示词组装',
    category: 'compose',
    color: '#10b981',
    icon: '📝',
    description: '完整组装管线：数据源 → 世界书引擎 → 扩展清洗 → 提示词排序 → 深度注入 → 名称注入',
    ports: [
      msgsOut('messages', '最终消息列表'),
    ],
    defaultConfig: {
      prompt_order: [],
      context_turns: 8,
    },
    isComposite: true,
  },
  {
    moduleId: 'pkg_full_workflow',
    label: '🚀 完整工作流',
    category: 'execute',
    color: '#ef4444',
    icon: '🚀',
    description: '完整工作流管线：等同于当前的 EwFlowConfig — 全部数据源 → 提示词 → LLM 调用 → 响应处理 → 输出',
    ports: [
      { id: 'result', label: '执行结果', direction: 'out', dataType: 'json' },
    ],
    defaultConfig: {
      name: '新工作流',
      enabled: true,
      timing: 'after_reply',
      priority: 100,
    },
    isComposite: true,
  },
];

// ════════════════════════════════════════════════════════════
// Registry
// ════════════════════════════════════════════════════════════

const ALL_MODULES: ModuleBlueprint[] = [
  ...SOURCE_MODULES,
  ...FILTER_MODULES,
  ...TRANSFORM_MODULES,
  ...COMPOSE_MODULES,
  ...EXECUTE_MODULES,
  ...OUTPUT_MODULES,
  ...CONFIG_MODULES,
  ...COMPOSITE_MODULES,
];

/** Map for O(1) lookup by moduleId */
export const MODULE_REGISTRY: ReadonlyMap<string, ModuleBlueprint> = new Map(
  ALL_MODULES.map(m => [m.moduleId, m]),
);

/** Get a module blueprint by ID, throws if not found */
export function getModuleBlueprint(moduleId: string): ModuleBlueprint {
  const bp = MODULE_REGISTRY.get(moduleId);
  if (!bp) {
    throw new Error(`[ModuleRegistry] Unknown module: ${moduleId}`);
  }
  return bp;
}

/** Get all modules in a category */
export function getModulesByCategory(category: string): ModuleBlueprint[] {
  return ALL_MODULES.filter(m => m.category === category);
}

/** Get all composite (package) modules */
export function getCompositeModules(): ModuleBlueprint[] {
  return ALL_MODULES.filter(m => m.isComposite);
}

/** Get all non-composite (atomic) modules */
export function getAtomicModules(): ModuleBlueprint[] {
  return ALL_MODULES.filter(m => !m.isComposite);
}

/** Total module count */
export const MODULE_COUNT = ALL_MODULES.length;
