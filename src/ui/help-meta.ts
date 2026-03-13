export type TabKey = 'overview' | 'api' | 'global' | 'flows' | 'graph' | 'debug' | 'history';

export type TabMeta = {
  key: TabKey;
  label: string;
};

export type FieldHelpMeta = {
  key: string;
  label: string;
  shortHelp: string;
  detailHelp: string;
  placeholder?: string;
  isAdvanced?: boolean;
};

export const PANEL_TABS: TabMeta[] = [
  { key: 'overview', label: '总览' },
  { key: 'api', label: 'API配置' },
  { key: 'global', label: '全局配置' },
  { key: 'flows', label: '工作流配置' },
  { key: 'graph', label: '工作流图' },
  { key: 'history', label: '历史' },
  { key: 'debug', label: '调试' },
];

const FIELD_HELP_LIST: FieldHelpMeta[] = [
  {
    key: 'enabled',
    label: '总开关',
    shortHelp: '关闭后不拦截发送，不执行动态世界工作流。',
    detailHelp: '建议先在单聊天内开启验证。出现异常可先关闭总开关快速回退。',
  },
  {
    key: 'dispatch_mode',
    label: '调度模式',
    shortHelp: '并行会同时请求所有工作流，串行会按顺序执行。',
    detailHelp: '串行模式下后续工作流可读取前序结果；并行模式更快，但冲突由优先级和顺序合并。',
  },
  {
    key: 'total_timeout_ms',
    label: '总超时',
    shortHelp: '整轮工作流的最大耗时上限（毫秒）。',
    detailHelp: '超过该时间视为失败并中止本轮发送。建议不小于所有启用工作流超时的最大值。',
  },
  {
    key: 'gate_ttl_ms',
    label: '门控时效',
    shortHelp: '发送链路去重与防重入的有效期（毫秒）。',
    detailHelp: '用于防止快速连点或重复事件触发同一轮工作流，设置过短可能导致重复执行。',
  },
  {
    key: 'dynamic_entry_prefix',
    label: '动态条目前缀',
    shortHelp: '动态条目写入时使用的命名前缀。',
    detailHelp: '外部返回的 upsert/toggle/delete 条目通常应落在该前缀下，便于识别与清理。',
    placeholder: 'EW/Dyn/',
  },
  {
    key: 'controller_entry_prefix',
    label: '控制器条目前缀',
    shortHelp: '控制器 EJS 条目的命名前缀，每个工作流会生成前缀+工作流名称的条目。',
    detailHelp:
      '例如前缀为"EW/Controller/"时，名为"环境检测"的工作流会写入"EW/Controller/环境检测"条目。多个工作流各自独立，互不覆盖。',
    placeholder: 'EW/Controller/',
  },
  {
    key: 'floor_binding_enabled',
    label: '楼层绑定',
    shortHelp: '开启后，工作流写入的条目会与当前聊天楼层绑定。',
    detailHelp: '删除楼层时，该楼层绑定的 EW/Dyn/ 条目将被自动清理，实现“删楼层 = 回滚修改”。',
  },
  {
    key: 'auto_cleanup_orphans',
    label: '自动清理孤儿条目',
    shortHelp: '切换聊天时自动检测并清理无主的 EW/Dyn/ 条目。',
    detailHelp: '开启后，在 CHAT_CHANGED 事件触发时会扫描世界书，移除不再与任何楼层关联的孤儿条目。',
  },
  {
    key: 'failure_policy',
    label: '失败策略',
    shortHelp: '工作流失败时的处理方式。',
    detailHelp:
      '失败即中止：停止 AI 生成并提示错误。静默继续：显示警告但 AI 照常生成。失败重试一次：自动重试一次，仍失败则中止。仅通知：仅弹出提示，不影响生成。',
    isAdvanced: true,
  },
  {
    key: 'workflow_timing',
    label: '执行时机',
    shortHelp: '选择在 AI 回复前执行工作流，还是在 AI 回复后再更新动态世界。',
    detailHelp:
      '回复后更新：默认模式，先让主回复返回，再根据最新 assistant 消息执行 EW 工作流，不阻塞对话。回复前拦截：沿用旧链路，在发给 AI 前先执行工作流，并结合原消息放行策略决定是否继续发送原始用户消息。',
    isAdvanced: true,
  },
  {
    key: 'reroll_scope',
    label: '重roll范围',
    shortHelp: '控制“重roll当前楼”时，是重跑全部工作流，还是仅重跑上次失败的工作流。',
    detailHelp:
      '全部重roll会从头重跑当前楼关联的全部工作流，结果最完整也最稳。仅失败工作流会保留当前楼上次成功的结果，只重试失败的部分；如果该楼没有失败记录，按钮会直接提示无需重跑。旧楼层若还没有执行记录，会回退为全部重roll。',
    isAdvanced: true,
  },
  {
    key: 'intercept_release_policy',
    label: '原消息放行策略',
    shortHelp: '被 EW 拦截的原始用户消息，在工作流结束后是否自动继续发送。',
    detailHelp:
      '仅成功时放行：默认选项，只有工作流成功后才继续把原始用户消息发给 AI。始终放行：无论工作流成功或失败，都继续发送原消息。永不自动放行：EW 完成处理后不自动发送，保留给你手动决定。',
    isAdvanced: true,
  },
  {
    key: 'api_preset.name',
    label: 'API配置名称',
    shortHelp: '用于在工作流里识别和选择该 API 配置。',
    detailHelp: '建议按用途命名，例如“剧情抽取API”“关系更新API”。',
  },
  {
    key: 'api_preset.mode',
    label: 'API模式',
    shortHelp: '选择“自定义API”或“酒馆连接器”模式。',
    detailHelp:
      '自定义API模式需要你填写 URL/Key/模型；酒馆连接器模式会直接使用酒馆当前主API与当前模型，不需要额外配置。',
  },
  {
    key: 'api_preset.api_url',
    label: 'API URL',
    shortHelp: '自定义API模式下使用的接口地址。',
    detailHelp: '填写你的自定义 API 基础地址后，可点击“加载模型列表”获取可用模型。',
    placeholder: 'https://example.com/flow',
  },
  {
    key: 'api_preset.api_key',
    label: 'API Key',
    shortHelp: '可选鉴权字段，会放入 Authorization 请求头。',
    detailHelp: '仅在你的服务端要求时填写。前端以密码框显示，但仍建议使用受限密钥。',
  },
  {
    key: 'api_preset.model',
    label: '模型',
    shortHelp: '自定义API模式下，指定要调用的模型名称。',
    detailHelp: '可手动输入，也可先填 URL/Key 后点击“加载模型列表”自动选择。',
    placeholder: 'gpt-4o-mini',
  },
  {
    key: 'api_preset.headers_json',
    label: '额外请求头',
    shortHelp: '可附加自定义 HTTP 头（JSON 对象）。',
    detailHelp: '用于网关鉴权或路由标识。格式错误会在调度前被视为配置异常。',
    placeholder: '{"X-Token":"value"}',
  },
  {
    key: 'flow.enabled',
    label: '工作流开关',
    shortHelp: '仅启用的工作流会参与调度。',
    detailHelp: '关闭后该工作流配置会保留，但不会请求外部 API，也不会参与合并。',
  },
  {
    key: 'flow.name',
    label: '名称',
    shortHelp: '仅用于你在界面里识别这条工作流。',
    detailHelp: '建议使用有语义的名称，例如“剧情抽取”“关系更新”。',
  },
  {
    key: 'flow.id',
    label: '工作流ID',
    shortHelp: '请求体中的 flow.id，需在当前工作流配置中唯一。',
    detailHelp: '返回体会带 flow_id 与其对应。重复 ID 会导致调试与合并定位困难。',
  },
  {
    key: 'flow.api_preset_id',
    label: 'API配置预设',
    shortHelp: '选择该工作流要使用的 API 配置预设。',
    detailHelp: '工作流只负责业务参数，接口地址/鉴权/请求头统一从预设读取。',
  },
  {
    key: 'flow.priority',
    label: '优先级',
    shortHelp: '用于多工作流结果合并冲突决策。',
    detailHelp: '按优先级降序合并；同优先级按工作流顺序后者覆盖前者。',
  },
  {
    key: 'flow.timeout_ms',
    label: '超时',
    shortHelp: '单条工作流请求最大耗时（毫秒）。',
    detailHelp: '超时会导致该工作流失败。失败策略固定为中止发送，因此请设置合理值。',
  },
  {
    key: 'flow.context_turns',
    label: '上下文楼层数',
    shortHelp: '发送给该工作流的历史消息楼层数量。',
    detailHelp: '数值越大上下文更完整，但 payload 也更大。建议按模型上下文成本调优。',
  },
  {
    key: 'flow.generation',
    label: '生成参数',
    shortHelp: '配置该工作流发送给外部模型的核心采样参数。',
    detailHelp: '这组参数只属于当前工作流。用于对不同工作流设置不同的回复长度、采样和流式策略。',
  },
  {
    key: 'flow.generation.unlock_context_length',
    label: '解锁上下文长度',
    shortHelp: '开启后可手动设置上下文词符上限。',
    detailHelp: '关闭时沿用模型默认上下文长度；开启后请确保设置值在你的模型服务允许范围内。',
  },
  {
    key: 'flow.generation.max_context_tokens',
    label: '上下文长度（词符）',
    shortHelp: '该工作流可见的最大上下文词符数。',
    detailHelp: '值越大历史信息越完整，但请求成本和延迟也会增加。',
  },
  {
    key: 'flow.generation.max_reply_tokens',
    label: '最大回复长度（词符）',
    shortHelp: '限制该工作流单次生成的最大输出长度。',
    detailHelp: '可用于防止抽取任务输出过长，建议按任务目标设置更紧凑的上限。',
  },
  {
    key: 'flow.generation.n_candidates',
    label: '备选回复数',
    shortHelp: '每次请求让模型返回的候选回复数量。',
    detailHelp: '大于 1 时请求成本更高；首版链路通常使用 1，保证稳定和低延迟。',
  },
  {
    key: 'flow.generation.stream',
    label: '流式传输',
    shortHelp: '是否按流式方式接收外部模型输出。',
    detailHelp: '开启后服务端可以边生成边返回；关闭则等待完整结果后一次性返回。',
  },
  {
    key: 'flow.generation.temperature',
    label: '温度',
    shortHelp: '控制输出随机性，越高越发散。',
    detailHelp: '抽取类任务建议中低温度；创意扩写类任务可以适当提高。',
  },
  {
    key: 'flow.generation.frequency_penalty',
    label: '频率惩罚',
    shortHelp: '降低模型重复使用同一词汇的倾向。',
    detailHelp: '值越高越抑制重复，适用于长文本重复问题明显的工作流。',
  },
  {
    key: 'flow.generation.presence_penalty',
    label: '存在惩罚',
    shortHelp: '鼓励模型引入新词或新内容。',
    detailHelp: '适当提高可减少原地重复，但过高可能降低输出稳定性。',
  },
  {
    key: 'flow.generation.top_p',
    label: 'Top P',
    shortHelp: '核采样阈值，控制候选词概率覆盖范围。',
    detailHelp: '通常与温度搭配调节；值越低越保守，越高越开放。',
  },
  {
    key: 'flow.behavior',
    label: '行为参数',
    shortHelp: '配置消息拼装策略和模型额外行为开关。',
    detailHelp: '用于控制名称行为、系统消息处理、思维链请求等模型侧行为。',
  },
  {
    key: 'flow.behavior.name_behavior',
    label: '角色名称行为',
    shortHelp: '控制消息中角色名称的拼接方式。',
    detailHelp: '不同模型对角色前缀敏感度不同，建议按你使用的模型逐项验证。',
  },
  {
    key: 'flow.behavior.reasoning_effort',
    label: '推理强度',
    shortHelp: '设置模型推理力度（若模型支持）。',
    detailHelp: '自动通常最稳；提高强度可能增加耗时与成本。',
  },
  {
    key: 'flow.behavior.verbosity',
    label: 'Verbosity',
    shortHelp: '控制输出详细程度（若模型支持）。',
    detailHelp: '高详细度更啰嗦，低详细度更紧凑。抽取任务通常用 auto 或 low。',
  },
  {
    key: 'flow.prompt_items',
    label: '提示词配置',
    shortHelp: '按条目管理工作流提示词，可独立启停与排序。',
    detailHelp: '每条提示词可指定角色、触发器、插入位置和文本内容，最终由外部工作流按顺序消费。',
  },
  {
    key: 'flow.prompt_item.name',
    label: '提示词名称',
    shortHelp: '用于识别该提示词条目的显示名称。',
    detailHelp: '建议使用任务语义名称，例如“剧情抽取规则”“阶段判定提示”。',
  },
  {
    key: 'flow.prompt_item.role',
    label: '提示词角色',
    shortHelp: '决定该提示词在消息数组中的角色类型。',
    detailHelp: '一般规则提示使用 system，辅助样例或追问可用 user/assistant。',
  },
  {
    key: 'flow.prompt_item.position',
    label: '插入位置',
    shortHelp: '决定提示词以“相对”或“聊天中”方式插入。',
    detailHelp: '相对模式更适合稳定的全局约束；聊天中模式更适合随对话动态变化的提示。',
  },
  {
    key: 'flow.prompt_item.trigger_types',
    label: '触发器',
    shortHelp: '限制该提示词在什么触发类型下生效。',
    detailHelp: '默认 All types 表示所有触发都生效，也可以按发送、继续、重试等类型单独限制。',
  },
  {
    key: 'flow.prompt_item.content',
    label: '提示词内容',
    shortHelp: '该条提示词的正文内容。',
    detailHelp: '建议保持单条职责清晰，避免把所有约束堆在同一条目里。',
  },
  {
    key: 'flow.extract_rules',
    label: '提取规则',
    shortHelp: '按起止标签从文本中提取片段。',
    detailHelp: '每条规则都包含 start/end，提取结果会进入工作流请求的 context 构建流程。',
  },
  {
    key: 'flow.exclude_rules',
    label: '排除规则',
    shortHelp: '按起止标签剔除不应发送的片段。',
    detailHelp: '常用于去掉 thinking 或系统中间内容，减少噪声并降低泄漏风险。',
  },
  {
    key: 'flow.request_template',
    label: '请求模板',
    shortHelp: '对标准请求体进行 JSON merge 扩展。',
    detailHelp: '用于补充额外字段。请确保合并后仍满足外部工作流预期结构。',
    placeholder: '{"context":{"turns":{{context.turns}}}}',
  },
  {
    key: 'flow.response_remove_regex',
    label: '移除正则',
    shortHelp: 'AI 响应后处理：移除匹配的内容（如思考过程标签）。',
    detailHelp: '在 JSON 解析前执行。使用正则表达式全局匹配并删除。留空则不做移除处理。',
    placeholder: '<thinking>[\\s\\S]*?</thinking>',
  },
  {
    key: 'flow.response_extract_regex',
    label: '提取正则',
    shortHelp: 'AI 响应后处理：从响应中提取特定标签内的内容。',
    detailHelp: '在移除正则之后执行。使用第一个捕获组 (group 1) 的内容。留空则不做提取处理。',
    placeholder: '<content>([\\s\\S]*?)</content>',
  },
  {
    key: 'manual_message',
    label: '手动运行输入',
    shortHelp: '调试模式手动执行时的输入内容。',
    detailHelp: '留空时默认使用最新楼层文本，适合快速复现实战场景。',
  },
  {
    key: 'import_text',
    label: '导入配置',
    shortHelp: '粘贴完整 JSON 后应用到当前脚本配置。',
    detailHelp: '导入后会立即校验并覆盖当前设置。建议先导出备份再导入。',
  },
];

export const FIELD_HELP: Record<string, FieldHelpMeta> = Object.fromEntries(
  FIELD_HELP_LIST.map(meta => [meta.key, meta]),
);

export function getFieldHelp(key: string): FieldHelpMeta | undefined {
  return FIELD_HELP[key];
}
