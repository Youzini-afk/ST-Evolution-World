<template>
  <div class="ew-studio-editor">
    <section v-if="activeGraph" class="ew-studio-editor__workspace">
      <header class="ew-studio-editor__workspace-top">
        <div class="ew-studio-editor__topbar">
          <div class="ew-studio-editor__tabs">
            <button
              v-for="(graph, index) in localGraphs"
              :key="graph.id"
              class="ew-studio-editor__tab"
              :class="{ active: localActiveGraphId === graph.id }"
              @click="localActiveGraphId = graph.id"
            >
              {{ graph.name || `图 ${index + 1}` }}
            </button>
            <button
              class="ew-studio-editor__tab ew-studio-editor__tab--add"
              @click="addGraph"
            >
              +
            </button>
          </div>
          <div class="ew-studio-editor__controls">
            <button class="ew-studio-editor__ctrl" @click="renameGraph">重命名</button>
            <button class="ew-studio-editor__ctrl" @click="toggleEnabled">
              {{ activeGraph.enabled ? "禁用" : "启用" }}
            </button>
            <button class="ew-studio-editor__ctrl" @click="$emit('open-observe')">
              打开观测
            </button>
          </div>
        </div>

        <section class="ew-studio-editor__summary">
          <div class="ew-studio-editor__summary-main">
            <div class="ew-studio-editor__summary-item">
              <span>名称</span>
              <input
                v-model="activeGraph.name"
                class="ew-studio-editor__input"
                @change="emitGraphs"
              />
            </div>
            <div class="ew-studio-editor__summary-item">
              <span>Builder 模式</span>
              <div class="ew-studio-editor__mode-switch">
                <button
                  class="ew-studio-editor__mode-btn"
                  :class="{ active: currentBuilderMode === 'simple' }"
                  @click="setBuilderMode('simple')"
                >
                  Simple
                </button>
                <button
                  class="ew-studio-editor__mode-btn"
                  :class="{ active: currentBuilderMode === 'advanced' }"
                  @click="setBuilderMode('advanced')"
                >
                  Advanced
                </button>
              </div>
            </div>
            <div class="ew-studio-editor__summary-item">
              <span>生成定位</span>
              <select
                v-model="currentGenerationOwnership"
                class="ew-studio-editor__select"
              >
                <option value="assistive">辅助工作流</option>
                <option value="optional_main_takeover">渐进主生成接管</option>
              </select>
            </div>
            <div class="ew-studio-editor__summary-item">
              <span>触发时机</span>
              <select v-model="currentTiming" class="ew-studio-editor__select">
                <option value="default">默认</option>
                <option value="before_reply">回复前</option>
                <option value="after_reply">回复后</option>
              </select>
            </div>
          </div>
          <div class="ew-studio-editor__summary-stats">
            <span class="ew-studio-editor__stat">节点 {{ activeGraph.nodes.length }}</span>
            <span class="ew-studio-editor__stat">连线 {{ activeGraph.edges.length }}</span>
            <span class="ew-studio-editor__stat">
              模板 {{ activeTemplate?.label ?? "自定义图" }}
            </span>
          </div>
        </section>
      </header>

      <aside class="ew-studio-editor__left">
        <div class="ew-studio-editor__left-tabs">
          <button
            class="ew-studio-editor__left-tab"
            :class="{ active: leftTab === 'components' }"
            @click="leftTab = 'components'"
          >
            构件树
          </button>
          <button
            class="ew-studio-editor__left-tab"
            :class="{ active: leftTab === 'structure' }"
            @click="leftTab = 'structure'"
          >
            当前图结构
          </button>
        </div>

        <div v-if="leftTab === 'components'" class="ew-studio-editor__left-panel">
          <p class="ew-studio-editor__hint">
            模板以下的资源统一视为构件体系，可逐层展开并插入到当前图。
          </p>
          <EwStudioComponentTree
            :entries="componentDirectory"
            :selected-id="selectedResourceEntryId"
            insertable
            @select="selectedResourceEntryId = $event"
            @insert="insertComponent"
          />
        </div>

        <div v-else class="ew-studio-editor__left-panel">
          <p class="ew-studio-editor__hint">
            当前图结构按画布位置排序，点击可切到对应节点属性。
          </p>
          <button
            v-for="node in sortedGraphNodes"
            :key="node.id"
            class="ew-studio-editor__structure-node"
            :class="{ active: selectedNodeId === node.id }"
            @click="selectedNodeId = node.id"
          >
            <strong>{{ getNodeLabel(node) }}</strong>
            <span>{{ node.moduleId }}</span>
          </button>
        </div>
      </aside>

      <div class="ew-studio-editor__canvas-shell">
        <div class="ew-studio-editor__canvas">
          <EwGraphEditor
            :graph="activeGraph"
            :saved-slots="savedSlots"
            :show-module-palette="false"
            :show-property-panel="false"
            :selected-node-id="selectedNodeId"
            @save-slots="$emit('save-slots', $event)"
            @update:graph="onGraphUpdated"
            @select-node="selectedNodeId = $event"
          />
        </div>
      </div>

      <aside class="ew-studio-editor__right">
        <template v-if="selectedNode">
          <EwNodePropertyPanel
            embedded
            :node="selectedNode"
            :builder-mode="currentBuilderMode"
            @close="selectedNodeId = null"
            @update-config="onUpdateNodeConfig"
          />
        </template>
        <template v-else>
          <section class="ew-studio-editor__card">
            <div class="ew-studio-editor__card-label">图属性</div>
            <div class="ew-studio-editor__field">
              <span>名称</span>
              <input v-model="activeGraph!.name" class="ew-studio-editor__input" @change="emitGraphs" />
            </div>
            <div class="ew-studio-editor__field">
              <span>生成定位</span>
              <select v-model="currentGenerationOwnership" class="ew-studio-editor__select">
                <option value="assistive">辅助工作流</option>
                <option value="optional_main_takeover">渐进主生成接管</option>
              </select>
            </div>
            <div class="ew-studio-editor__field">
              <span>触发时机</span>
              <select v-model="currentTiming" class="ew-studio-editor__select">
                <option value="default">默认</option>
                <option value="before_reply">回复前</option>
                <option value="after_reply">回复后</option>
              </select>
            </div>
          </section>
          <section class="ew-studio-editor__card">
            <div class="ew-studio-editor__card-label">当前引导</div>
            <p class="ew-studio-editor__text">
              {{
                currentBuilderMode === "simple"
                  ? "当前是 Simple 低密度视图，建议先改图级参数，再深入到构件与节点。"
                  : "当前是 Advanced 图编辑视图，可以直接改图、节点和更深层构件。"
              }}
            </p>
            <p class="ew-studio-editor__text">
              {{
                currentGenerationOwnership === "optional_main_takeover"
                  ? "这张图会作为渐进主生成接管候选工作流参与路由。"
                  : "这张图当前按辅助工作流参与执行。"
              }}
            </p>
            <div v-if="activeTemplate" class="ew-studio-editor__tags">
              <span
                v-for="highlight in activeTemplate.learningHighlights"
                :key="`active-highlight-${highlight}`"
                class="ew-studio-editor__tag"
              >
                {{ highlight }}
              </span>
            </div>
          </section>
        </template>
      </aside>

      <section class="ew-studio-editor__bottom" :data-open="bottomOpen ? '1' : '0'">
        <div class="ew-studio-editor__bottom-header">
          <div>
            <div class="ew-studio-editor__card-label">运行观测</div>
            <p class="ew-studio-editor__bottom-copy">
              默认半开，围绕当前工作流展示运行摘要、关键节点诊断与事件时间线。
            </p>
          </div>
          <button class="ew-studio-editor__ctrl" @click="bottomOpen = !bottomOpen">
            {{ bottomOpen ? "收起" : "展开" }}
          </button>
        </div>
        <div v-if="bottomOpen" class="ew-studio-editor__bottom-body">
          <EwStudioObserveSurface
            embedded
            :graph="activeGraph"
            :selected-node-id="selectedNodeId"
            :diagnostics-summary="visibleDiagnosticsSummary"
            :active-run-summary="visibleActiveRunSummary"
            :run-artifact="visibleRunArtifact"
            :run-events="visibleRunEvents"
            :selected-node-diagnostics="selectedNodeDiagnostics"
          />
        </div>
      </section>
    </section>

    <section v-else class="ew-studio-editor__empty">
      当前还没有工作流，先从资产库创建模板，或点击顶部 `+` 新建空白图。
    </section>
  </div>
</template>

<script setup lang="ts">
import { klona } from "klona/full";
import EwGraphEditor from "../graph/EwGraphEditor.vue";
import EwNodePropertyPanel from "../graph/EwNodePropertyPanel.vue";
import EwStudioComponentTree from "./EwStudioComponentTree.vue";
import EwStudioObserveSurface from "./EwStudioObserveSurface.vue";
import {
  createBlankBuilderGraph,
  findBuilderWorkflowTemplate,
} from "../graph/builder-templates";
import {
  getModuleBlueprint,
  instantiateCompositeTemplate,
  resolveModuleConfigWithDefaults,
} from "../graph/module-registry";
import {
  getStudioComponentDirectory,
  getFirstStudioComponentEntryId,
} from "../graph/studio-library";
import type {
  GraphActiveRunSummaryViewModel,
  GraphNodeDiagnosticsViewModel,
  GraphRunArtifact,
  GraphRunDiagnosticsSummaryViewModel,
  GraphRunEventRecordV1,
  WorkbenchBuilderMode,
  WorkbenchGenerationOwnership,
  WorkbenchGraph,
  WorkbenchNode,
} from "../graph/module-types";

const props = withDefaults(
  defineProps<{
    graphs: WorkbenchGraph[];
    activeGraphId?: string;
    savedSlots?: any[];
    diagnosticsSummary: GraphRunDiagnosticsSummaryViewModel | null;
    activeRunSummary: GraphActiveRunSummaryViewModel | null;
    runArtifact?: GraphRunArtifact | null;
    runEvents?: GraphRunEventRecordV1[] | null;
  }>(),
  {
    activeGraphId: "",
    runArtifact: null,
    runEvents: null,
  },
);

const emit = defineEmits<{
  (e: "update:graphs", graphs: WorkbenchGraph[]): void;
  (e: "update:activeGraphId", graphId: string): void;
  (e: "save-slots", slots: any[]): void;
  (e: "open-observe"): void;
}>();

const localGraphs = ref<WorkbenchGraph[]>(klona(props.graphs));
const localActiveGraphId = ref(props.activeGraphId || localGraphs.value[0]?.id || "");
const leftTab = ref<"components" | "structure">("components");
const selectedNodeId = ref<string | null>(null);
const selectedResourceEntryId = ref<string | null>(getFirstStudioComponentEntryId());
const bottomOpen = ref(true);
const componentDirectory = getStudioComponentDirectory();

watch(
  () => props.graphs,
  (graphs) => {
    localGraphs.value = klona(graphs);
    if (!localGraphs.value.some((graph) => graph.id === localActiveGraphId.value)) {
      localActiveGraphId.value = localGraphs.value[0]?.id ?? "";
    }
  },
  { deep: true, immediate: true },
);

watch(
  () => props.activeGraphId,
  (graphId) => {
    if (graphId && graphId !== localActiveGraphId.value) {
      localActiveGraphId.value = graphId;
    }
  },
  { immediate: true },
);

watch(localActiveGraphId, (graphId) => {
  selectedNodeId.value = null;
  emit("update:activeGraphId", graphId);
});

const activeGraph = computed(() => {
  return localGraphs.value.find((graph) => graph.id === localActiveGraphId.value) ?? null;
});

const activeTemplate = computed(() =>
  findBuilderWorkflowTemplate(activeGraph.value?.runtimeMeta?.templateId),
);

const currentBuilderMode = computed<WorkbenchBuilderMode>({
  get() {
    return activeGraph.value?.runtimeMeta?.builderMode === "advanced"
      ? "advanced"
      : "simple";
  },
  set(mode) {
    updateActiveGraphRuntimeMeta({ builderMode: mode });
  },
});

const currentGenerationOwnership = computed<WorkbenchGenerationOwnership>({
  get() {
    return activeGraph.value?.runtimeMeta?.generationOwnership === "optional_main_takeover"
      ? "optional_main_takeover"
      : "assistive";
  },
  set(value) {
    updateActiveGraphRuntimeMeta({ generationOwnership: value });
  },
});

const currentTiming = computed<WorkbenchGraph["timing"]>({
  get() {
    return activeGraph.value?.timing ?? "default";
  },
  set(value) {
    if (!activeGraph.value) {
      return;
    }
    activeGraph.value.timing = value;
    emitGraphs();
  },
});

const selectedNode = computed(() => {
  if (!selectedNodeId.value || !activeGraph.value) {
    return null;
  }
  return activeGraph.value.nodes.find((node) => node.id === selectedNodeId.value) ?? null;
});

const visibleActiveRunSummary = computed(() => {
  if (!activeGraph.value || !props.activeRunSummary) {
    return null;
  }
  return props.activeRunSummary.graphId === activeGraph.value.id
    ? props.activeRunSummary
    : null;
});

const visibleDiagnosticsSummary = computed(() => {
  if (visibleActiveRunSummary.value?.diagnosticsSummary) {
    return visibleActiveRunSummary.value.diagnosticsSummary;
  }
  return props.diagnosticsSummary;
});

const visibleRunArtifact = computed(() => {
  if (!activeGraph.value || !props.runArtifact) {
    return null;
  }
  return props.runArtifact.graphId === activeGraph.value.id ? props.runArtifact : null;
});

const visibleRunEvents = computed(() => {
  if (!activeGraph.value) {
    return [];
  }
  return (props.runEvents ?? []).filter((event) => event.graphId === activeGraph.value?.id);
});

const selectedNodeDiagnostics = computed<GraphNodeDiagnosticsViewModel | null>(() => {
  const diagnostics = visibleActiveRunSummary.value?.nodeDiagnostics;
  if (!diagnostics || !selectedNodeId.value) {
    return null;
  }
  return diagnostics.nodeId === selectedNodeId.value ? diagnostics : null;
});

const sortedGraphNodes = computed(() => {
  return [...(activeGraph.value?.nodes ?? [])].sort((left, right) => {
    if (left.position.x !== right.position.x) {
      return left.position.x - right.position.x;
    }
    return left.position.y - right.position.y;
  });
});

function emitGraphs() {
  emit("update:graphs", klona(localGraphs.value));
}

function updateActiveGraphRuntimeMeta(
  patch: Partial<NonNullable<WorkbenchGraph["runtimeMeta"]>>,
) {
  if (!activeGraph.value) {
    return;
  }
  activeGraph.value.runtimeMeta = {
    schemaVersion: activeGraph.value.runtimeMeta?.schemaVersion ?? 1,
    runtimeKind: activeGraph.value.runtimeMeta?.runtimeKind ?? "dataflow",
    ...(activeGraph.value.runtimeMeta ?? {}),
    ...patch,
  };
  emitGraphs();
}

function setBuilderMode(mode: WorkbenchBuilderMode) {
  currentBuilderMode.value = mode;
}

function addGraph() {
  const nextGraph = createBlankBuilderGraph({
    name: `工作流 ${localGraphs.value.length + 1}`,
    builderMode: currentBuilderMode.value,
    generationOwnership: currentGenerationOwnership.value,
    timing: currentTiming.value,
  });
  localGraphs.value.push(nextGraph);
  localActiveGraphId.value = nextGraph.id;
  emitGraphs();
}

function renameGraph() {
  if (!activeGraph.value) {
    return;
  }
  const nextName = prompt("图名称:", activeGraph.value.name);
  if (nextName === null) {
    return;
  }
  activeGraph.value.name = nextName;
  emitGraphs();
}

function toggleEnabled() {
  if (!activeGraph.value) {
    return;
  }
  activeGraph.value.enabled = !activeGraph.value.enabled;
  emitGraphs();
}

function onGraphUpdated(graph: WorkbenchGraph) {
  const index = localGraphs.value.findIndex((item) => item.id === localActiveGraphId.value);
  if (index >= 0) {
    localGraphs.value.splice(index, 1, klona(graph));
  } else {
    localGraphs.value = [klona(graph)];
    localActiveGraphId.value = graph.id;
  }
  emitGraphs();
}

function onUpdateNodeConfig(nodeId: string, config: Record<string, any>) {
  if (!activeGraph.value) {
    return;
  }
  const node = activeGraph.value.nodes.find((item) => item.id === nodeId);
  if (!node) {
    return;
  }
  node.config = config;
  emitGraphs();
}

function getNextInsertionOrigin() {
  const nodes = activeGraph.value?.nodes ?? [];
  if (nodes.length === 0) {
    return { x: 120, y: 120 };
  }
  const maxX = Math.max(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  return { x: maxX + 280, y: Math.max(60, minY) };
}

function insertComponent(moduleId: string) {
  if (!activeGraph.value) {
    return;
  }
  const origin = getNextInsertionOrigin();
  const blueprint = getModuleBlueprint(moduleId);
  if (blueprint.isComposite) {
    const fragment = instantiateCompositeTemplate({ moduleId, origin });
    if (!fragment) {
      return;
    }
    activeGraph.value.nodes.push(...fragment.nodes);
    activeGraph.value.edges.push(...fragment.edges);
    emitGraphs();
    return;
  }
  activeGraph.value.nodes.push({
    id: `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    moduleId,
    position: origin,
    config: resolveModuleConfigWithDefaults(moduleId, {}),
    collapsed: false,
  });
  emitGraphs();
}

function getNodeLabel(node: WorkbenchNode): string {
  if (typeof node.config?._label === "string" && node.config._label.trim()) {
    return node.config._label.trim();
  }
  try {
    return getModuleBlueprint(node.moduleId).label;
  } catch {
    return node.moduleId;
  }
}
</script>

<style scoped>
.ew-studio-editor {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.ew-studio-editor__workspace {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: linear-gradient(180deg, rgba(10, 16, 32, 0.92), rgba(7, 11, 22, 0.9));
  border-radius: 22px;
  padding: 12px;
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr) 320px;
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-areas:
    "top top top"
    "left canvas right"
    "bottom bottom bottom";
  gap: 12px;
  min-height: min(82vh, 1080px);
  overflow: hidden;
}

.ew-studio-editor__workspace-top {
  grid-area: top;
  display: grid;
  gap: 10px;
  padding: 2px 2px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.ew-studio-editor__topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ew-studio-editor__tabs,
.ew-studio-editor__controls,
.ew-studio-editor__left-tabs,
.ew-studio-editor__mode-switch {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.ew-studio-editor__tab,
.ew-studio-editor__ctrl,
.ew-studio-editor__left-tab,
.ew-studio-editor__mode-btn {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.78);
  border-radius: 999px;
  padding: 7px 12px;
  cursor: pointer;
}

.ew-studio-editor__tab.active,
.ew-studio-editor__left-tab.active,
.ew-studio-editor__mode-btn.active {
  background: rgba(99, 102, 241, 0.18);
  border-color: rgba(99, 102, 241, 0.36);
  color: rgba(255, 255, 255, 0.96);
}

.ew-studio-editor__summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
  border-radius: 18px;
  padding: 12px 14px;
}

.ew-studio-editor__summary-main {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  flex: 1;
}

.ew-studio-editor__summary-item,
.ew-studio-editor__field,
.ew-studio-editor__card {
  display: grid;
  gap: 6px;
}

.ew-studio-editor__summary-item span,
.ew-studio-editor__field span,
.ew-studio-editor__card-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.44);
}

.ew-studio-editor__summary-stats,
.ew-studio-editor__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ew-studio-editor__stat,
.ew-studio-editor__tag {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.84);
  font-size: 11px;
}

.ew-studio-editor__left,
.ew-studio-editor__right,
.ew-studio-editor__bottom {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(8, 12, 24, 0.68);
  border-radius: 18px;
}

.ew-studio-editor__left,
.ew-studio-editor__right {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.ew-studio-editor__left {
  grid-area: left;
}

.ew-studio-editor__right {
  grid-area: right;
}

.ew-studio-editor__left-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
  min-height: 0;
}

.ew-studio-editor__canvas-shell {
  grid-area: canvas;
  min-width: 0;
  min-height: 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(4, 8, 18, 0.52);
  border-radius: 22px;
  padding: 10px;
}

.ew-studio-editor__canvas {
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.ew-studio-editor__canvas :deep(.ew-graph-root) {
  height: 100%;
}

.ew-studio-editor__hint,
.ew-studio-editor__text,
.ew-studio-editor__bottom-copy,
.ew-studio-editor__structure-node span {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.68);
}

.ew-studio-editor__structure-node {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  border-radius: 14px;
  padding: 10px 12px;
  display: grid;
  gap: 4px;
  text-align: left;
  color: rgba(255, 255, 255, 0.88);
  cursor: pointer;
}

.ew-studio-editor__structure-node.active {
  background: rgba(99, 102, 241, 0.18);
  border-color: rgba(99, 102, 241, 0.34);
}

.ew-studio-editor__input,
.ew-studio-editor__select {
  width: 100%;
  min-height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.92);
  padding: 0 12px;
}

.ew-studio-editor__bottom {
  grid-area: bottom;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ew-studio-editor__empty {
  border: 1px dashed rgba(255, 255, 255, 0.16);
  border-radius: 18px;
  padding: 20px;
  color: rgba(255, 255, 255, 0.68);
  font-size: 13px;
  line-height: 1.7;
}

.ew-studio-editor__bottom-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.ew-studio-editor__bottom-body {
  min-height: 220px;
  max-height: 320px;
  overflow: auto;
}

@media (max-width: 1280px) {
  .ew-studio-editor__workspace {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto minmax(460px, 1fr) auto auto;
    grid-template-areas:
      "top"
      "left"
      "canvas"
      "right"
      "bottom";
    min-height: auto;
  }

  .ew-studio-editor__summary-main {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ew-studio-editor__summary,
  .ew-studio-editor__topbar,
  .ew-studio-editor__bottom-header {
    flex-direction: column;
    align-items: stretch;
  }
}

@media (max-width: 760px) {
  .ew-studio-editor__summary-main {
    grid-template-columns: 1fr;
  }
}
</style>
