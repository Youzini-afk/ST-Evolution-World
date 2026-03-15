# 🌍 Evolution World — SillyTavern Extension

> **v2.0.0** | 多工作流调度引擎 + 可视化节点图编辑器

Evolution World 是一个 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 第三方扩展，提供**多工作流并行调度**、**提示词精细编排**和**DAG 节点图可视化编辑**功能。

---

## ✨ 核心功能

### 🔀 多工作流引擎
- 支持配置**多条独立工作流**，每条流有独立的 API 预设、提示词模板和生成参数
- **串行/并行调度**模式，支持超时控制和失败策略
- 完整的**14 阶段请求管线** — 从消息拦截到响应注入
- **楼层绑定**机制 — 工作流输出可精准绑定到对话中的指定楼层

### 📝 提示词编排
- 可视化**提示词排序**编辑器 — 拖拽调整 system/user/assistant 提示词位置
- **上下文规则** — 提取/排除/自定义正则过滤
- **世界书深度集成** — 自动管理动态条目和控制器条目
- 自定义系统提示词编辑

### 🗺️ DAG 节点图编辑器
可视化的有向无环图编辑器，将工作流配置映射为节点链：

| 功能 | 说明 |
|------|------|
| **8 种节点类型** | 流入口、生成参数、行为参数、提示词排序、上下文规则、请求构建、响应处理、世界书输出 |
| **画布操作** | 缩放、平移、适配视图、全屏、框选多选、组拖动 |
| **连接系统** | 拖拽创建边、DAG 环检测、右键删除 |
| **连线动画** | 边上持续流动的脉冲动画，可视化数据流方向 |
| **小地图** | 可拖动的缩略图导航，点击/拖拽平移视口 |
| **自动排列** | 一键 DAG 分层布局 |
| **撤销/重做** | Ctrl+Z / Ctrl+Shift+Z，30 步快照栈 |
| **复制/粘贴** | Ctrl+C/V，自动生成新 ID |
| **置顶交互** | 点击节点自动提升到最上层 |
| **画布槽位** | ★ 实时总览（自动从工作流加载）+ 自定义空白画布 |
| **双向同步** | 节点表单编辑自动同步回 store |
| **左侧面板** | 工作流列表 + 模块拖拽到画布 |

### 🎨 UI 设计
- **毛玻璃（Glassmorphism）**主题，深色模式
- 浮动球（FAB）快速入口
- 月相主题切换
- 完整的移动端适配

---

## 🏗️ 技术架构

```
src/
├── index.ts                  ← 扩展入口（jQuery ready → 初始化）
├── st-adapter.ts             ← SillyTavern API 适配层
├── runtime/                  ← 运行时核心
│   ├── main.ts               ← 运行时初始化
│   ├── pipeline.ts           ← 14 阶段请求管线
│   ├── dispatcher.ts         ← 多工作流调度器
│   ├── prompt-assembler.ts   ← 提示词组装引擎
│   ├── worldinfo-engine.ts   ← 世界书集成引擎
│   ├── floor-binding.ts      ← 楼层绑定系统
│   ├── events.ts             ← 事件系统
│   ├── settings.ts           ← 设置持久化
│   ├── types.ts              ← Zod Schema 定义
│   └── ...                   ← 更多运行时模块
├── ui/                       ← Vue 3 前端
│   ├── App.vue               ← 主应用面板
│   ├── store.ts              ← Pinia 状态管理
│   ├── mount.ts              ← UI 挂载到 ST
│   └── components/
│       ├── graph/             ← DAG 节点图编辑器
│       │   ├── EwGraphEditor.vue
│       │   ├── EwGraphNode.vue
│       │   ├── EwGraphEdge.vue
│       │   ├── EwGraphPort.vue
│       │   ├── EwGraphPalette.vue
│       │   ├── graph-state.ts
│       │   ├── graph-types.ts
│       │   ├── graph-serializer.ts
│       │   └── nodes/        ← 8 种节点内容组件
│       ├── EwFlowCard.vue     ← 工作流配置卡片
│       ├── EwDebugPanel.vue   ← 调试面板
│       └── ...
└── util/                     ← 工具函数
```

**技术栈：**
- **前端**: Vue 3 + Pinia + Zod
- **构建**: Webpack 5 + TypeScript + Vue SFC
- **样式**: Vanilla CSS (Glassmorphism)
- **运行时**: 纯 TypeScript，无外部依赖

---

## 🚀 快速开始

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

# 开发模式（监听变化）
npm run watch

# 生产构建
npm run build
```

构建产物输出到 `dist/index.js` 和 `dist/style.css`。

---

## ⌨️ 快捷键

| 按键 | 功能 |
|------|------|
| `Ctrl+Z` | 撤销 |
| `Ctrl+Shift+Z` / `Ctrl+Y` | 重做 |
| `Ctrl+C` | 复制选中节点 |
| `Ctrl+V` | 粘贴节点 |
| `Delete` / `Backspace` | 删除选中节点或边 |
| `Escape` | 退出全屏 |
| 鼠标滚轮 | 缩放画布 |
| 鼠标拖拽空白区 | 平移画布 |
| 长按拖框 | 框选多个节点 |

---

## 📄 License

MIT
