# 🌍 Evolution World — SillyTavern Extension

> **v2.1.0** | 多工作流调度引擎 · 自研世界书引擎 · 提示词精细编排 · DAG 可视化编辑器

Evolution World 是一个 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 第三方扩展，为角色扮演场景提供**独立于酒馆主管线的多工作流并行执行体系**。每条工作流拥有独立的 API 预设、提示词编排、上下文规则和生成参数，支持 before/after reply 时机调度，实现角色行为驱动、状态追踪、世界书动态管理等高级场景。

---

## 📑 目录

- [核心架构](#-核心架构)
- [多工作流调度引擎](#-多工作流调度引擎)
- [请求构建管线](#-请求构建管线)
- [内置世界书引擎](#-内置世界书引擎)
- [提示词编排系统](#-提示词编排系统)
- [EJS 模板引擎](#-ejs-模板引擎)
- [楼层绑定与快照](#-楼层绑定与快照)
- [消息隐藏引擎](#-消息隐藏引擎)
- [API 预设系统](#-api-预设系统)
- [DAG 节点图编辑器](#-dag-节点图编辑器)
- [UI 设计](#-ui-设计)
- [安装与构建](#-安装与构建)
- [快捷键](#-快捷键)

---

## 🏛 核心架构

```
src/
├── index.ts                  ← 扩展入口（jQuery ready → 初始化）
├── st-adapter.ts             ← SillyTavern API 适配层
├── runtime/                  ← 运行时核心（30+ 模块）
│   ├── main.ts               ← 运行时初始化
│   ├── pipeline.ts           ← 请求管线（拦截 → 调度 → 合并）
│   ├── dispatcher.ts         ← 多工作流调度器
│   ├── prompt-assembler.ts   ← 提示词组装引擎
│   ├── worldinfo-engine.ts   ← 自研世界书引擎
│   ├── ejs-internal.ts       ← EJS 模板执行器
│   ├── floor-binding.ts      ← 楼层绑定系统
│   ├── hide-engine.ts        ← 消息隐藏引擎
│   ├── regex-engine.ts       ← 正则处理引擎
│   ├── snapshot-storage.ts   ← 快照持久化
│   ├── events.ts             ← 事件系统
│   ├── settings.ts           ← 设置持久化
│   ├── types.ts              ← Zod Schema 定义
│   ├── context-builder.ts    ← 请求 JSON body 构建
│   ├── controller-renderer.ts← Controller 条目渲染
│   ├── merger.ts             ← 响应合并器
│   ├── mvu-compat.ts         ← MVU 兼容层
│   └── ...
├── ui/                       ← Vue 3 前端
│   ├── App.vue               ← 主应用面板
│   ├── store.ts              ← Pinia 状态管理
│   ├── mount.ts              ← UI 挂载
│   └── components/
│       ├── graph/             ← DAG 节点图编辑器
│       ├── EwFlowCard.vue     ← 工作流配置卡片
│       ├── EwPromptOrderList.vue ← 提示词排序编辑器
│       ├── EwDebugPanel.vue   ← 调试面板
│       └── ...
└── util/                     ← 工具函数
```

**技术栈**: Vue 3 + Pinia + Zod + TypeScript + Webpack 5

---

## 🔀 多工作流调度引擎

每条工作流是一条独立的 AI 请求管线，拥有自己的：

- **API 预设** — 独立的模型、温度、token 限制
- **提示词编排** — 自定义 system/user/assistant 消息排列
- **上下文规则** — 提取/排除/正则过滤
- **生成参数** — temperature, top_p, frequency_penalty 等
- **行为参数** — 推理模式、详细度、消息压缩等

### 调度模式

| 模式                | 说明                                             |
| ------------------- | ------------------------------------------------ |
| **并行 (parallel)** | 所有工作流同时发送请求，互不等待                 |
| **串行 (serial)**   | 工作流按优先级顺序依次执行，前序结果可传递给后序 |

### 执行时机

| 时机             | 说明                                        |
| ---------------- | ------------------------------------------- |
| **after_reply**  | 用户发送消息后、AI 回复完成后执行           |
| **before_reply** | 用户发送消息后、AI 回复之前执行（拦截模式） |

### 失败策略

`stop_generation` / `continue_generation` / `retry_once` / `notify_only` / `allow_partial_success`

---

## 🔧 请求构建管线

工作流 AI 收到的请求由**两部分**拼接而成：

```
┌──────────────────────────────────────────────┐
│ [BEFORE_PROMPT 扩展提示词]                    │
├──────────────────────────────────────────────┤
│ 提示词编排（prompt_order 控制的 messages）     │
│   ← 主系统提示词 / 角色描述 / 世界书 / ...    │
│   ← 所有内容经 EJS 渲染 + 宏替换              │
│   ← 条目名称自动注入（[EW/Dyn/xxx]）          │
├──────────────────────────────────────────────┤
│ 聊天历史（最近 N 轮对话）                     │
│   ← depthInjections 按深度插入               │
├──────────────────────────────────────────────┤
│ 工作流系统指令（硬编码）                      │
├──────────────────────────────────────────────┤
│ JSON body（FlowRequestV1 结构化数据）         │
│   ← 版本、请求ID、触发信息、流配置、上下文     │
│   ← 串行模式下包含前序工作流结果              │
└──────────────────────────────────────────────┘
```

### 数据来源

| 组件                    | 来源                | 说明                   |
| ----------------------- | ------------------- | ---------------------- |
| `main`                  | 角色卡 system 字段  | 主系统提示词           |
| `charDescription`       | 角色卡 description  | 角色描述               |
| `charPersonality`       | 角色卡 personality  | 角色性格               |
| `scenario`              | 角色卡 scenario     | 场景                   |
| `personaDescription`    | 用户人设            | 角色扮演者描述         |
| `dialogueExamples`      | 角色卡 mes_examples | 对话示例               |
| `worldInfoBefore/After` | 内置 WI 引擎        | 非酒馆预拼接，自行解析 |
| `chatMessages`          | 聊天记录            | 最近对话               |
| `depthInjections`       | 扩展注入            | 按深度插入聊天中       |

---

## 📖 内置世界书引擎

EW **不使用**酒馆预拼接的 `worldInfoBefore/After`，而是通过 `worldinfo-engine.ts` **自行解析**世界书条目：

1. **收集条目** — 角色世界书（主 + 附加）、人设世界书、聊天世界书（不读全局世界书）
2. **过滤** — 跳过 MVU 条目、特殊条目（`[GENERATE:]`、`[RENDER:]`、`@INJECT` 等）
3. **激活** — 复现 ST 关键词匹配逻辑：
   - 常量条目、装饰器
   - 主关键词 + 次关键词（AND/NOT 逻辑）
   - 概率过滤、互斥组
4. **EJS 渲染** — 激活条目内容经过 `evalEjsTemplate()` 执行
5. **Controller 展开** — `EW/Controller` 条目中 `getwi()` 拉取的 Dyn 条目展开为独立条目
6. **分桶** — 按 position 分为 before / after / atDepth 三个桶

### 扩展提示词处理

对酒馆其他插件注入的 `extension_prompts` 做智能过滤：

- **MVU 内容剥离** — 移除 MVU XML 块
- **被忽略条目去重** — 子串匹配移除已过滤 WI 条目
- **MVU 产物检测** — 整体判断是否为 MVU 产物并丢弃

---

## 📝 提示词编排系统

用户可**自定义 prompt 排列顺序**，每个条目支持：

| 属性                 | 说明                                                     |
| -------------------- | -------------------------------------------------------- |
| `identifier`         | 条目标识（如 `main`、`worldInfoBefore`）                 |
| `type`               | `marker`（引用已有组件）或 `prompt`（用户自写内容）      |
| `role`               | `system` / `user` / `assistant`                          |
| `content`            | 提示词内容（支持 EJS + 宏）                              |
| `injection_position` | `relative`（按编排位置）或 `in_chat`（按深度注入聊天中） |
| `injection_depth`    | in_chat 模式下的插入深度                                 |

支持拖拽排序，实时预览效果。

---

## 🔮 EJS 模板引擎

所有提示词内容均经过 EJS 模板渲染：

### 内置函数

| 函数                | 说明                  |
| ------------------- | --------------------- |
| `getwi(name)`       | 获取世界书条目内容    |
| `getvar(name)`      | 获取 ST 全局/聊天变量 |
| `evalEjsTemplate()` | 嵌套 EJS 执行         |

### 宏替换

| 宏                    | 值                     |
| --------------------- | ---------------------- |
| `{{user}}`            | 用户名                 |
| `{{char}}`            | 角色名                 |
| `{{persona}}`         | 人设描述               |
| `{{lastUserMessage}}` | 用户最新输入           |
| `{{newline}}`         | 换行符                 |
| `{{任意路径}}`        | 从模板上下文深路径取值 |

---

## 📌 楼层绑定与快照

工作流输出可**绑定到对话中的指定楼层**：

- **楼层绑定** — 工作流结果写入指定消息的 `extra` 数据
- **快照存储** — 支持 `message_data`（存在消息中）或 `file`（独立文件）两种模式
- **条目名称注入** — `injectEntryNames()` 自动在世界书条目内容前插入 `[条目名]\n` 标签
- **孤儿清理** — 自动清理无效的绑定数据
- **快照回滚** — 支持回滚到指定楼层的历史状态

---

## 🙈 消息隐藏引擎

`hide-engine.ts` 提供对话消息的智能隐藏：

- **隐藏最后 N 条** — 从 AI 视角隐藏末尾 N 条消息
- **限制器** — 总消息数超过阈值时自动隐藏最旧的

---

## 🔑 API 预设系统

每个 API 预设支持：

| 模式              | 说明                          |
| ----------------- | ----------------------------- |
| **workflow_http** | 直接 HTTP 请求自定义 API 端点 |
| **llm_connector** | 通过酒馆的 LLM 连接器转发     |

配置项：URL、API Key、模型、候选模型列表、自定义 Headers

---

## 🗺️ DAG 节点图编辑器

可视化有向无环图编辑器，将工作流配置映射为可交互的节点链：

### 节点类型

| 类型       | 图标 | 说明                                         |
| ---------- | ---- | -------------------------------------------- |
| 流入口     | 🚀    | 工作流名称、启用、优先级、API 预设、超时     |
| 生成参数   | ⚙️    | temperature, top_p, 惩罚参数, max_tokens     |
| 行为参数   | 🧠    | 推理模式、详细度、消息压缩、function calling |
| 提示词排序 | 📝    | 自定义 prompt_order 视觉编排                 |
| 上下文规则 | 📐    | 提取/排除/正则过滤规则                       |
| 请求构建   | 🔧    | 请求模板、系统提示词、自定义 Headers         |
| 响应处理   | 📤    | 响应提取/移除正则                            |
| 世界书输出 | 📚    | 世界书条目的 upsert/delete/toggle 操作       |

### 编辑器功能

| 功能      | 操作                                |
| --------- | ----------------------------------- |
| 画布操作  | 缩放、平移、适配视图、全屏          |
| 连接系统  | 拖拽端口创建边、DAG 环检测          |
| 连线动画  | 持续流动的脉冲动画                  |
| 框选多选  | 长按拖框选中多个节点                |
| 组拖动    | 选中多个节点一起移动                |
| 节点置顶  | 点击节点自动提升到最上层            |
| 复制/粘贴 | Ctrl+C/V，自动 ID 重映射            |
| 撤销/重做 | Ctrl+Z / Ctrl+Shift+Z，30 步快照    |
| 自动排列  | DAG 分层布局算法                    |
| 小地图    | 可拖动缩略图导航，点击/拖拽平移视口 |
| 画布槽位  | ★ 实时总览 + 自定义空白画布         |
| 双向同步  | 节点表单编辑实时同步回 store        |
| 左侧面板  | 工作流列表 + 模块拖拽到画布         |

---

## 🎨 UI 设计

- **毛玻璃（Glassmorphism）** 深色主题
- 浮动球（FAB）快速入口，可拖拽定位
- 月相主题切换 🌙
- 完整的移动端适配
- 调试面板（运行日志、请求追踪）
- 历史记录面板

---

## 🚀 安装与构建

### 安装

**方式一：通过 ST 扩展管理器**（推荐）

在 SillyTavern 的扩展管理器中搜索 `Evolution World` 并安装。

**方式二：手动安装**

```bash
cd <SillyTavern根目录>/data/default-user/extensions/third-party/
git clone <仓库地址> ST-Evolution-World
```

### 开发构建

```bash
# 安装依赖
npm install

# 开发模式（监听变化自动编译）
npm run watch

# 生产构建
npm run build
```

构建产物：`dist/index.js` + `dist/style.css`

---

## ⌨️ 快捷键

| 按键                      | 功能             |
| ------------------------- | ---------------- |
| `Ctrl+Z`                  | 撤销             |
| `Ctrl+Shift+Z` / `Ctrl+Y` | 重做             |
| `Ctrl+C`                  | 复制选中节点     |
| `Ctrl+V`                  | 粘贴节点         |
| `Delete` / `Backspace`    | 删除选中节点或边 |
| `Escape`                  | 退出全屏         |
| 鼠标滚轮                  | 缩放画布         |
| 拖拽空白区                | 平移画布         |
| 长按拖框                  | 框选多个节点     |

---

## 📄 License

[Aladdin Free Public License (AFPL)](./LICENSE) v9

---

## 📋 更新日志

### v2.1.0 — 脚本版同步 (2026-03-20)

从脚本版同步 40+ 版本的 bug 修复与功能增强。

**事件系统**：任务队列机制 · 触发去重（身份键 + 时间窗） · before_reply 增强 · 初始化幂等 · 失败重跑队列

**请求管线**：世界书绑定校验 · 请求脱敏 · IO 安全持久化 · 失败诊断增强

**调度器**：模板解析增强 · 惩罚参数归一化 · 并行间隔默认 0 · Rederive 上下文透传

**世界书引擎**：确定性概率逻辑 · 动态条目支持（DynContext / dyn_write） · source_name 字段

**提示词组装**：聊天回退 · 压缩检测 · 图片块剥离 · 正则诊断

**隐藏引擎**：防抖模式 · 纯 CSS 隐藏（性能优化）

**写回系统**：增强版 commitMergedPlan · Dyn 条目物化 · MergedWorldbookDesiredEntry

**拦截守卫**：message_id + generation_type 精确去重
