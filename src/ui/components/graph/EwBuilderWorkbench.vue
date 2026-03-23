<template>
  <div class="ew-builder-workbench">
    <div class="ew-builder-workbench__topbar">
      <div class="ew-builder-workbench__tabs">
        <button
          v-for="(graph, index) in localGraphs"
          :key="graph.id"
          class="ew-builder-workbench__tab"
          :class="{ active: activeGraphId === graph.id }"
          @click="activeGraphId = graph.id"
        >
          {{ graph.name || `图 ${index + 1}` }}
        </button>
        <button
          class="ew-builder-workbench__tab ew-builder-workbench__tab--add"
          @click="addGraph"
          title="新增图"
        >
          +
        </button>
      </div>
      <div class="ew-builder-workbench__controls">
        <button
          class="ew-builder-workbench__ctrl-btn"
          :disabled="!activeGraph"
          title="重命名当前图"
          @click="renameGraph"
        >
          ✏️
        </button>
        <button
          class="ew-builder-workbench__ctrl-btn"
          :disabled="!activeGraph"
          :title="activeGraph?.enabled ? '禁用当前图' : '启用当前图'"
          @click="toggleEnabled"
        >
          {{ activeGraph?.enabled ? "🟢" : "⚫" }}
        </button>
        <button
          class="ew-builder-workbench__ctrl-btn"
          :class="{ active: advancedSidebarOpen }"
          :title="advancedSidebarOpen ? '收起高级侧栏' : '展开高级侧栏'"
          @click="advancedSidebarOpen = !advancedSidebarOpen"
        >
          ⫶
        </button>
      </div>
    </div>

    <div class="ew-builder-workbench__body">
      <div class="ew-builder-workbench__editor">
        <EwGraphEditor
          :graph="activeGraph"
          :saved-slots="savedSlots"
          @save-slots="$emit('save-slots', $event)"
          @update:graph="onGraphUpdated"
          @select-node="selectedNodeId = $event"
        />
      </div>

      <aside
        v-if="advancedSidebarOpen"
        class="ew-builder-workbench__sidebar"
      >
        <section class="ew-builder-workbench__section">
          <div class="ew-builder-workbench__section-header">
            <div>
              <div class="ew-builder-workbench__eyebrow">Builder</div>
              <h3 class="ew-builder-workbench__title">当前图</h3>
            </div>
          </div>
          <div class="ew-builder-workbench__summary-grid">
            <article class="ew-builder-workbench__summary-card">
              <span class="ew-builder-workbench__summary-label">名称</span>
              <strong>{{ activeGraph?.name || "未命名图" }}</strong>
            </article>
            <article class="ew-builder-workbench__summary-card">
              <span class="ew-builder-workbench__summary-label">状态</span>
              <strong>{{ activeGraph?.enabled ? "已启用" : "已禁用" }}</strong>
            </article>
            <article class="ew-builder-workbench__summary-card">
              <span class="ew-builder-workbench__summary-label">节点</span>
              <strong>{{ activeGraph?.nodes.length ?? 0 }}</strong>
            </article>
            <article class="ew-builder-workbench__summary-card">
              <span class="ew-builder-workbench__summary-label">连线</span>
              <strong>{{ activeGraph?.edges.length ?? 0 }}</strong>
            </article>
          </div>
        </section>

        <section class="ew-builder-workbench__section">
          <div class="ew-builder-workbench__section-header">
            <div>
              <div class="ew-builder-workbench__eyebrow">高级诊断</div>
              <h3 class="ew-builder-workbench__title">运行摘要</h3>
            </div>
          </div>
          <div v-if="visibleActiveRunSummary" class="ew-builder-workbench__stack">
            <div class="ew-builder-workbench__chips">
              <span
                class="ew-builder-workbench__chip"
                :data-status="visibleActiveRunSummary.status"
              >
                {{ visibleActiveRunSummary.statusLabel }}
              </span>
              <span class="ew-builder-workbench__chip">
                {{ visibleActiveRunSummary.phaseLabel }}
              </span>
              <span class="ew-builder-workbench__chip">
                {{ visibleActiveRunSummary.terminalOutcomeLabel }}
              </span>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>最近节点</span>
              <strong>{{ visibleActiveRunSummary.latestNodeLabel }}</strong>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>节点状态</span>
              <strong>{{ visibleActiveRunSummary.latestNodeStatusLabel }}</strong>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>阻塞契约</span>
              <strong>{{
                visibleActiveRunSummary.hasBlockingContract ? "存在" : "无"
              }}</strong>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>恢复资格</span>
              <strong>{{ visibleActiveRunSummary.recoveryEligibilityLabel }}</strong>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>waiting_user</span>
              <strong>{{ visibleActiveRunSummary.waitingUserLabel }}</strong>
            </div>
          </div>
          <div
            v-else-if="visibleDiagnosticsSummary"
            class="ew-builder-workbench__stack"
          >
            <div class="ew-builder-workbench__chips">
              <span
                class="ew-builder-workbench__chip"
                :data-status="visibleDiagnosticsSummary.runStatus"
              >
                {{ visibleDiagnosticsSummary.runStatusLabel }}
              </span>
              <span class="ew-builder-workbench__chip">
                指纹 {{ visibleDiagnosticsSummary.compileFingerprintShort }}
              </span>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>节点</span>
              <strong>{{ visibleDiagnosticsSummary.nodeCount }}</strong>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>Dirty</span>
              <strong>{{ visibleDiagnosticsSummary.dirtyNodeCount }}</strong>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>Reuse eligible</span>
              <strong>{{
                visibleDiagnosticsSummary.reuseEligibleNodeCount
              }}</strong>
            </div>
          </div>
          <div v-else class="ew-builder-workbench__empty">
            当前图暂无可展示的运行摘要。
          </div>
        </section>

        <section class="ew-builder-workbench__section">
          <div class="ew-builder-workbench__section-header">
            <div>
              <div class="ew-builder-workbench__eyebrow">模块说明</div>
              <h3 class="ew-builder-workbench__title">当前选中节点</h3>
            </div>
          </div>
          <template v-if="selectedModuleExplain && selectedNode">
            <div class="ew-builder-workbench__stack">
              <div class="ew-builder-workbench__chips">
                <span class="ew-builder-workbench__chip">
                  {{ selectedNode.moduleId }}
                </span>
                <span class="ew-builder-workbench__chip">
                  {{ selectedModuleExplain.diagnostics.capability }}
                </span>
                <span class="ew-builder-workbench__chip">
                  {{ selectedModuleExplain.diagnostics.sideEffect }}
                </span>
              </div>
              <div class="ew-builder-workbench__kv">
                <span>标题</span>
                <strong>{{ selectedModuleLabel }}</strong>
              </div>
              <p
                v-if="selectedModuleExplain.help?.summary"
                class="ew-builder-workbench__text"
              >
                {{ selectedModuleExplain.help.summary }}
              </p>
              <div class="ew-builder-workbench__kv">
                <span>必填配置</span>
                <strong>{{
                  selectedModuleExplain.config.requiredConfigKeys.join("、") ||
                  "无"
                }}</strong>
              </div>
              <div class="ew-builder-workbench__kv">
                <span>Schema 字段</span>
                <strong>{{
                  selectedModuleExplain.config.schemaFields
                    .map((field) => field.key)
                    .join("、") || "无"
                }}</strong>
              </div>
            </div>
          </template>
          <div v-else class="ew-builder-workbench__empty">
            选中一个节点后，这里会显示模块说明与配置约束。
          </div>
        </section>

        <section
          v-if="selectedNodeDiagnostics"
          class="ew-builder-workbench__section"
        >
          <div class="ew-builder-workbench__section-header">
            <div>
              <div class="ew-builder-workbench__eyebrow">节点诊断</div>
              <h3 class="ew-builder-workbench__title">
                {{ selectedNodeDiagnostics.title }}
              </h3>
            </div>
          </div>
          <div class="ew-builder-workbench__stack">
            <div class="ew-builder-workbench__chips">
              <span class="ew-builder-workbench__chip">
                dirty {{ selectedNodeDiagnostics.dirtyReasonLabel }}
              </span>
              <span class="ew-builder-workbench__chip">
                reuse {{ selectedNodeDiagnostics.reuseVerdictLabel }}
              </span>
              <span class="ew-builder-workbench__chip">
                decision {{ selectedNodeDiagnostics.executionDecisionLabel }}
              </span>
            </div>
            <p class="ew-builder-workbench__text">
              {{ selectedNodeDiagnostics.disclaimer }}
            </p>
            <div class="ew-builder-workbench__kv">
              <span>输入源概要</span>
              <strong>{{ selectedNodeDiagnostics.inputSourcesSummary }}</strong>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>Cache Key Facts</span>
              <strong>{{
                selectedNodeDiagnostics.cacheKeyFactsSummary
              }}</strong>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>只读命中事实</span>
              <strong>{{
                selectedNodeDiagnostics.reusableOutputsFactLabel
              }}</strong>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>skip_reuse_outputs</span>
              <strong>{{
                selectedNodeDiagnostics.skipReuseOutputsFactLabel
              }}</strong>
            </div>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { klona } from "klona/full";
import EwGraphEditor from "./EwGraphEditor.vue";
import { getModuleBlueprint, getModuleExplainContract } from "./module-registry";
import type {
  GraphActiveRunSummaryViewModel,
  GraphNodeDiagnosticsViewModel,
  GraphRunDiagnosticsSummaryViewModel,
  ModuleExplainContract,
  WorkbenchGraph,
} from "./module-types";

const props = defineProps<{
  graphs: WorkbenchGraph[];
  savedSlots?: Array<any>;
  diagnosticsSummary: GraphRunDiagnosticsSummaryViewModel | null;
  activeRunSummary: GraphActiveRunSummaryViewModel | null;
}>();

const emit = defineEmits<{
  (e: "update:graphs", graphs: WorkbenchGraph[]): void;
  (e: "save-slots", slots: any[]): void;
}>();

const localGraphs = ref<WorkbenchGraph[]>(klona(props.graphs));
const activeGraphId = ref(localGraphs.value[0]?.id ?? "");
const advancedSidebarOpen = ref(true);
const selectedNodeId = ref<string | null>(null);

const activeGraph = computed(() =>
  localGraphs.value.find((graph) => graph.id === activeGraphId.value) ?? null,
);

const visibleActiveRunSummary = computed(() => {
  const summary = props.activeRunSummary;
  if (!summary || !activeGraph.value) {
    return null;
  }
  return summary.graphId === activeGraph.value.id ? summary : null;
});

const visibleDiagnosticsSummary = computed(() => {
  return (
    visibleActiveRunSummary.value?.diagnosticsSummary ??
    (localGraphs.value.length <= 1 ? props.diagnosticsSummary : null) ??
    null
  );
});

const selectedNode = computed(() => {
  if (!selectedNodeId.value || !activeGraph.value) {
    return null;
  }
  return (
    activeGraph.value.nodes.find((node) => node.id === selectedNodeId.value) ??
    null
  );
});

const selectedModuleExplain = computed<ModuleExplainContract | null>(() => {
  return selectedNode.value
    ? getModuleExplainContract(selectedNode.value.moduleId)
    : null;
});

const selectedModuleLabel = computed(() => {
  if (!selectedNode.value) {
    return "";
  }
  try {
    return getModuleBlueprint(selectedNode.value.moduleId).label;
  } catch {
    return selectedNode.value.moduleId;
  }
});

const selectedNodeDiagnostics = computed<GraphNodeDiagnosticsViewModel | null>(
  () => {
    const diagnostics = visibleActiveRunSummary.value?.nodeDiagnostics;
    if (!diagnostics || !selectedNodeId.value) {
      return null;
    }
    return diagnostics.nodeId === selectedNodeId.value ? diagnostics : null;
  },
);

watch(
  () => props.graphs,
  (graphs) => {
    localGraphs.value = klona(graphs);
    if (localGraphs.value.length === 0) {
      activeGraphId.value = "";
      selectedNodeId.value = null;
      return;
    }
    if (!localGraphs.value.some((graph) => graph.id === activeGraphId.value)) {
      activeGraphId.value = localGraphs.value[0].id;
      selectedNodeId.value = null;
    }
  },
  { deep: true, immediate: true },
);

watch(activeGraphId, () => {
  selectedNodeId.value = null;
});

function emitGraphs() {
  emit("update:graphs", klona(localGraphs.value));
}

function addGraph() {
  const id = `graph_${Date.now()}`;
  localGraphs.value.push({
    id,
    name: `工作流 ${localGraphs.value.length + 1}`,
    enabled: true,
    timing: "default",
    priority: 100,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  activeGraphId.value = id;
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
  const index = localGraphs.value.findIndex(
    (item) => item.id === activeGraphId.value,
  );
  if (index >= 0) {
    localGraphs.value.splice(index, 1, klona(graph));
  } else {
    localGraphs.value = [klona(graph)];
    activeGraphId.value = graph.id;
  }
  emitGraphs();
}
</script>

<style scoped>
.ew-builder-workbench {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 12px;
}

.ew-builder-workbench__topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 42px;
  padding: 0 4px;
}

.ew-builder-workbench__tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}

.ew-builder-workbench__tab {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.62);
  border-radius: 999px;
  padding: 7px 12px;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  transition:
    background 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease;
}

.ew-builder-workbench__tab.active {
  background: rgba(99, 102, 241, 0.18);
  border-color: rgba(99, 102, 241, 0.4);
  color: rgba(255, 255, 255, 0.92);
}

.ew-builder-workbench__tab--add {
  font-weight: 700;
  min-width: 34px;
}

.ew-builder-workbench__controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ew-builder-workbench__ctrl-btn {
  width: 32px;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.68);
  cursor: pointer;
  transition:
    background 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease;
}

.ew-builder-workbench__ctrl-btn:hover:not(:disabled),
.ew-builder-workbench__ctrl-btn.active {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.16);
  color: rgba(255, 255, 255, 0.92);
}

.ew-builder-workbench__ctrl-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ew-builder-workbench__body {
  display: flex;
  gap: 12px;
  min-height: 0;
  flex: 1;
}

.ew-builder-workbench__editor {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.ew-builder-workbench__editor :deep(.ew-graph-root) {
  height: min(72vh, 780px);
}

.ew-builder-workbench__sidebar {
  width: 340px;
  max-width: 36vw;
  min-width: 300px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ew-builder-workbench__section {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(8, 12, 24, 0.68);
  border-radius: 16px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ew-builder-workbench__section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.ew-builder-workbench__eyebrow {
  font-size: 11px;
  line-height: 1.2;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.42);
}

.ew-builder-workbench__title {
  margin: 2px 0 0;
  font-size: 15px;
  line-height: 1.2;
  color: rgba(255, 255, 255, 0.92);
}

.ew-builder-workbench__summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.ew-builder-workbench__summary-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
}

.ew-builder-workbench__summary-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.44);
}

.ew-builder-workbench__summary-card strong {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
}

.ew-builder-workbench__stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ew-builder-workbench__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ew-builder-workbench__chip {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  font-size: 11px;
  color: rgba(255, 255, 255, 0.84);
}

.ew-builder-workbench__chip[data-status="completed"] {
  background: rgba(16, 185, 129, 0.2);
  color: #bbf7d0;
}

.ew-builder-workbench__chip[data-status="failed"] {
  background: rgba(239, 68, 68, 0.2);
  color: #fecaca;
}

.ew-builder-workbench__chip[data-status="running"],
.ew-builder-workbench__chip[data-status="streaming"],
.ew-builder-workbench__chip[data-status="queued"],
.ew-builder-workbench__chip[data-status="waiting_user"],
.ew-builder-workbench__chip[data-status="cancelling"] {
  background: rgba(59, 130, 246, 0.18);
  color: #bfdbfe;
}

.ew-builder-workbench__chip[data-status="cancelled"] {
  background: rgba(148, 163, 184, 0.18);
  color: #e2e8f0;
}

.ew-builder-workbench__kv {
  display: grid;
  gap: 4px;
}

.ew-builder-workbench__kv span {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.46);
}

.ew-builder-workbench__kv strong {
  font-size: 12px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.9);
}

.ew-builder-workbench__text {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.76);
}

.ew-builder-workbench__empty {
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.52);
}

@media (max-width: 1180px) {
  .ew-builder-workbench__body {
    flex-direction: column;
  }

  .ew-builder-workbench__sidebar {
    width: 100%;
    max-width: none;
    min-width: 0;
  }

  .ew-builder-workbench__editor :deep(.ew-graph-root) {
    height: min(68vh, 700px);
  }
}
</style>
