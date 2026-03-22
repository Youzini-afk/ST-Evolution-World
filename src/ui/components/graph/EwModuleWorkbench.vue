<template>
  <Teleport to="body" :disabled="!isFullscreen">
    <div class="ew-workbench" :class="{ 'is-fullscreen': isFullscreen }">
      <!-- Top bar: graph tabs + controls -->
      <div class="ew-workbench__topbar">
        <div class="ew-workbench__tabs">
          <button
            v-for="(g, i) in localGraphs"
            :key="g.id"
            class="ew-workbench__tab"
            :class="{ active: activeGraphId === g.id }"
            @click="activeGraphId = g.id"
          >
            {{ g.name || `图 ${i + 1}` }}
          </button>
          <button
            class="ew-workbench__tab ew-workbench__tab--add"
            @click="addGraph"
          >
            +
          </button>
        </div>
        <div class="ew-workbench__controls">
          <button
            class="ew-workbench__ctrl-btn"
            @click="renameGraph"
            title="重命名"
          >
            ✏️
          </button>
          <button
            class="ew-workbench__ctrl-btn"
            @click="toggleEnabled"
            :title="activeGraph?.enabled ? '禁用' : '启用'"
          >
            {{ activeGraph?.enabled ? "🟢" : "⚫" }}
          </button>
          <button
            class="ew-workbench__ctrl-btn"
            @click="isFullscreen = !isFullscreen"
            :title="isFullscreen ? '退出全屏' : '全屏'"
          >
            ⛶
          </button>
        </div>
      </div>

      <div
        v-if="diagnosticsSummary || activeRunSummary"
        class="ew-workbench__diagnostics"
      >
        <div v-if="activeRunSummary" class="ew-workbench__diagnostics-block">
          <div class="ew-workbench__diagnostics-heading">活动运行观测</div>
          <div class="ew-workbench__diagnostics-main">
            <span
              class="ew-workbench__diagnostics-status"
              :data-status="activeRunSummary.status"
            >
              {{ activeRunSummary.statusLabel }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              运行阶段 {{ activeRunSummary.phaseLabel }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              终局结果 {{ activeRunSummary.terminalOutcomeLabel }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              {{
                activeRunSummary.hasActiveRun
                  ? "存在活动运行"
                  : "当前无活动运行"
              }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              执行阶段 {{ activeRunSummary.currentStageLabel }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              最近节点 {{ activeRunSummary.latestNodeLabel }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              节点状态 {{ activeRunSummary.latestNodeStatusLabel }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              事件 {{ activeRunSummary.eventCount }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              阻塞契约
              {{ activeRunSummary.hasBlockingContract ? "存在" : "无" }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              控制前提解释 {{ activeRunSummary.constraintSummaryLabel }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              handling policy {{ activeRunSummary.handlingPolicyLabel }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              continuation verdict
              {{ activeRunSummary.continuationVerdictLabel }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              恢复资格 {{ activeRunSummary.recoveryEligibilityLabel }}
            </span>
          </div>
          <div class="ew-workbench__diagnostics-reasons">
            <template v-if="activeRunSummary.checkpointCandidate">
              <span class="ew-workbench__diagnostics-reason">
                checkpoint {{ activeRunSummary.checkpointCandidate.stage }}
              </span>
              <span class="ew-workbench__diagnostics-reason">
                节点 {{ activeRunSummary.checkpointCandidate.nodeId ?? "—" }}
              </span>
              <span class="ew-workbench__diagnostics-reason">
                资格事实来源 checkpoint candidate
              </span>
            </template>
            <span v-else class="ew-workbench__diagnostics-item">
              无 checkpoint candidate 事实
            </span>
            <span class="ew-workbench__diagnostics-reason">
              恢复证据 {{ activeRunSummary.recoveryEvidenceLabel }}
            </span>
            <span class="ew-workbench__diagnostics-reason">
              证据可信度 {{ activeRunSummary.recoveryEvidenceTrustLabel }}
            </span>
            <span class="ew-workbench__diagnostics-reason">
              证据来源 {{ activeRunSummary.recoveryEvidenceSourceLabel }}
            </span>
            <span class="ew-workbench__diagnostics-reason">
              人工输入槽位 {{ activeRunSummary.manualInputSlotSchemaLabel }}
            </span>
            <span class="ew-workbench__diagnostics-reason">
              阻塞原因 {{ activeRunSummary.blockingReasonLabel }}
            </span>
            <span class="ew-workbench__diagnostics-reason">
              阻塞类别 {{ activeRunSummary.blockingCategoryLabel }}
            </span>
            <span class="ew-workbench__diagnostics-reason">
              人工输入 {{ activeRunSummary.requiresHumanInputLabel }}
            </span>
            <span class="ew-workbench__diagnostics-reason">
              输入需求 {{ activeRunSummary.inputRequirementTypeLabel }}
            </span>
            <span class="ew-workbench__diagnostics-reason">
              控制前提解释项 {{ activeRunSummary.controlPreconditionsLabel }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              heartbeat
              {{
                activeRunSummary.latestHeartbeat
                  ? activeRunSummary.latestHeartbeatLabel
                  : "无"
              }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              partial output
              {{
                activeRunSummary.latestPartialOutput
                  ? activeRunSummary.latestPartialOutputLabel
                  : "无"
              }}
            </span>
            <span
              class="ew-workbench__diagnostics-reason"
              :data-waiting-user="activeRunSummary.waitingUser ? '1' : '0'"
            >
              waiting_user（只读阻塞事实）
              {{
                activeRunSummary.waitingUser
                  ? activeRunSummary.waitingUserLabel
                  : "未进入"
              }}
            </span>
          </div>
        </div>

        <div v-if="diagnosticsSummary" class="ew-workbench__diagnostics-block">
          <div class="ew-workbench__diagnostics-heading">最近 diagnostics</div>
          <div class="ew-workbench__diagnostics-disclaimer">
            仅展示实验性增量执行事实/诊断；它不是系统承诺缓存、跳过动作或恢复能力。
          </div>
          <div class="ew-workbench__diagnostics-main">
            <span
              class="ew-workbench__diagnostics-status"
              :data-status="diagnosticsSummary.runStatus"
            >
              {{ diagnosticsSummary.runStatusLabel }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              指纹 {{ diagnosticsSummary.compileFingerprintShort }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              节点 {{ diagnosticsSummary.nodeCount }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              Terminal {{ diagnosticsSummary.terminalNodeCount }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              Dirty {{ diagnosticsSummary.dirtyNodeCount }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              Clean {{ diagnosticsSummary.cleanNodeCount }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              Reuse eligible {{ diagnosticsSummary.reuseEligibleNodeCount }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              Reuse ineligible {{ diagnosticsSummary.reuseIneligibleNodeCount }}
            </span>
            <span class="ew-workbench__diagnostics-item">
              skip_reuse_outputs
              {{ diagnosticsSummary.skipReuseOutputHitCount }}
            </span>
          </div>
          <div class="ew-workbench__diagnostics-reasons">
            <template v-if="diagnosticsSummary.primaryDirtyReasons.length > 0">
              <span
                v-for="reason in diagnosticsSummary.primaryDirtyReasons"
                :key="`dirty-${reason.reason}`"
                class="ew-workbench__diagnostics-reason"
              >
                dirty · {{ reason.label }} {{ reason.count }}
              </span>
            </template>
            <span v-else class="ew-workbench__diagnostics-item">
              主要 dirty 原因：无
            </span>
            <template v-if="diagnosticsSummary.primaryReuseReasons.length > 0">
              <span
                v-for="reason in diagnosticsSummary.primaryReuseReasons"
                :key="`reuse-${reason.reason}`"
                class="ew-workbench__diagnostics-reason"
              >
                reuse ineligible · {{ reason.label }} {{ reason.count }}
              </span>
            </template>
            <span v-else class="ew-workbench__diagnostics-item">
              主要不可复用原因：无
            </span>
            <template
              v-if="
                diagnosticsSummary.primaryExecutionDecisionReasons.length > 0
              "
            >
              <span
                v-for="reason in diagnosticsSummary.primaryExecutionDecisionReasons"
                :key="`decision-${reason.reason}`"
                class="ew-workbench__diagnostics-reason"
              >
                decision · {{ reason.label }} {{ reason.count }}
              </span>
            </template>
            <span v-else class="ew-workbench__diagnostics-item">
              主要执行决策原因：无
            </span>
          </div>
        </div>
      </div>

      <div class="ew-workbench__main">
        <!-- Module palette -->
        <EwModulePalette />

        <!-- Canvas area -->
        <div class="ew-workbench__canvas-wrap">
          <div
            v-if="selectedModuleExplain"
            class="ew-workbench__module-explain"
          >
            <div class="ew-workbench__module-explain-heading">
              <span>{{ selectedModuleLabel }}</span>
              <span v-if="selectedModuleExplain.help?.summary">
                {{ selectedModuleExplain.help.summary }}
              </span>
            </div>
            <div class="ew-workbench__module-explain-tags">
              <span class="ew-workbench__module-explain-tag">
                能力 {{ selectedModuleExplain.diagnostics.capability }}
              </span>
              <span class="ew-workbench__module-explain-tag">
                副作用 {{ selectedModuleExplain.diagnostics.sideEffect }}
              </span>
              <span
                v-if="selectedModuleExplain.diagnostics.hostWrite"
                class="ew-workbench__module-explain-tag"
              >
                host-write {{ selectedModuleExplain.diagnostics.hostWrite }}
              </span>
              <span class="ew-workbench__module-explain-tag">
                未知键策略 {{ selectedModuleExplain.config.unknownKeyPolicy }}
              </span>
            </div>
            <div class="ew-workbench__module-explain-sections">
              <div class="ew-workbench__module-explain-section">
                <div class="ew-workbench__module-explain-title">配置约束</div>
                <div class="ew-workbench__module-explain-text">
                  必填
                  {{
                    selectedModuleExplain.config.requiredConfigKeys.join(
                      "、",
                    ) || "无"
                  }}
                </div>
                <div class="ew-workbench__module-explain-text">
                  Schema 字段
                  {{
                    selectedModuleExplain.config.schemaFields
                      .map((field) => field.key)
                      .join("、") || "无"
                  }}
                </div>
              </div>
              <div class="ew-workbench__module-explain-section">
                <div class="ew-workbench__module-explain-title">端口约束</div>
                <div class="ew-workbench__module-explain-text">
                  输入
                  {{
                    selectedModuleExplain.ports.inputs
                      .map((item) => `${item.portId}:${item.summary}`)
                      .join("；") || "无"
                  }}
                </div>
                <div class="ew-workbench__module-explain-text">
                  输出
                  {{
                    selectedModuleExplain.ports.outputs
                      .map((item) => `${item.portId}:${item.summary}`)
                      .join("；") || "无"
                  }}
                </div>
              </div>
            </div>
          </div>
          <div
            class="ew-workbench__canvas"
            ref="canvasRef"
            @pointerdown="onCanvasPointerDown"
            @wheel.prevent="onWheel"
            @dragover.prevent
            @drop.prevent="onDrop"
            @dblclick="onCanvasDblClick"
          >
            <!-- Grid -->
            <svg class="ew-workbench__grid">
              <defs>
                <pattern
                  id="ew-wb-dots"
                  :width="20 * viewport.zoom"
                  :height="20 * viewport.zoom"
                  patternUnits="userSpaceOnUse"
                  :x="viewport.x"
                  :y="viewport.y"
                >
                  <circle
                    :cx="(20 * viewport.zoom) / 2"
                    :cy="(20 * viewport.zoom) / 2"
                    :r="1 * viewport.zoom"
                    fill="rgba(255,255,255,0.1)"
                  />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#ew-wb-dots)" />
            </svg>

            <!-- Transform wrapper -->
            <div class="ew-workbench__transform" :style="transformStyle">
              <!-- Edges SVG -->
              <svg
                class="ew-workbench__edges-svg"
                style="
                  position: absolute;
                  top: 0;
                  left: 0;
                  width: 1px;
                  height: 1px;
                  overflow: visible;
                "
              >
                <line
                  v-for="edge in activeEdges"
                  :key="edge.id"
                  :x1="getPortPos(edge.source, edge.sourcePort)?.x ?? 0"
                  :y1="getPortPos(edge.source, edge.sourcePort)?.y ?? 0"
                  :x2="getPortPos(edge.target, edge.targetPort)?.x ?? 0"
                  :y2="getPortPos(edge.target, edge.targetPort)?.y ?? 0"
                  stroke="rgba(99,102,241,0.5)"
                  stroke-width="2"
                  stroke-dasharray="6 3"
                />
              </svg>

              <!-- Nodes -->
              <div
                v-for="node in activeNodes"
                :key="node.id"
                class="ew-workbench__node"
                :class="{ 'is-selected': selectedNodeId === node.id }"
                :style="nodeStyle(node)"
                @pointerdown.stop="onNodePointerDown($event, node)"
                @dblclick.stop="openPropertyPanel(node)"
              >
                <div
                  class="ew-workbench__node-header"
                  :style="{ background: getModuleColor(node.moduleId) }"
                >
                  <span class="ew-workbench__node-icon">{{
                    getModuleIcon(node.moduleId)
                  }}</span>
                  <span class="ew-workbench__node-title">{{
                    getModuleLabel(node.moduleId)
                  }}</span>
                </div>
                <div class="ew-workbench__node-ports">
                  <div
                    v-for="port in getModulePorts(node.moduleId, 'in')"
                    :key="port.id"
                    class="ew-workbench__port ew-workbench__port--in"
                    :data-node-id="node.id"
                    :data-port-id="port.id"
                  >
                    <span class="ew-workbench__port-dot" />
                    <span class="ew-workbench__port-label">{{
                      port.label
                    }}</span>
                  </div>
                  <div
                    v-for="port in getModulePorts(node.moduleId, 'out')"
                    :key="port.id"
                    class="ew-workbench__port ew-workbench__port--out"
                    :data-node-id="node.id"
                    :data-port-id="port.id"
                  >
                    <span class="ew-workbench__port-label">{{
                      port.label
                    }}</span>
                    <span class="ew-workbench__port-dot" />
                  </div>
                </div>
              </div>
            </div>

            <!-- Empty state -->
            <div v-if="activeNodes.length === 0" class="ew-workbench__empty">
              <div class="ew-workbench__empty-icon">🧩</div>
              <div class="ew-workbench__empty-text">
                从左侧拖入模块开始搭建管线
              </div>
              <div class="ew-workbench__empty-hint">
                双击节点编辑参数 · 滚轮缩放 · 拖拽画布平移
              </div>
            </div>
          </div>
          <div
            v-if="selectedNodeDiagnostics"
            class="ew-workbench__module-explain ew-workbench__node-diagnostics"
          >
            <div class="ew-workbench__module-explain-heading">
              <span>节点诊断 · {{ selectedNodeDiagnostics.title }}</span>
              <span>{{ selectedNodeDiagnostics.disclaimer }}</span>
            </div>
            <div class="ew-workbench__module-explain-tags">
              <span class="ew-workbench__module-explain-tag">
                dirty {{ selectedNodeDiagnostics.dirtyReasonLabel }}
              </span>
              <span class="ew-workbench__module-explain-tag">
                reuse {{ selectedNodeDiagnostics.reuseVerdictLabel }}
              </span>
              <span class="ew-workbench__module-explain-tag">
                decision {{ selectedNodeDiagnostics.executionDecisionLabel }}
              </span>
            </div>
            <div class="ew-workbench__module-explain-sections">
              <div class="ew-workbench__module-explain-section">
                <div class="ew-workbench__module-explain-title">输入源概要</div>
                <div class="ew-workbench__module-explain-text">
                  {{ selectedNodeDiagnostics.inputSourcesSummary }}
                </div>
              </div>
              <div class="ew-workbench__module-explain-section">
                <div class="ew-workbench__module-explain-title">
                  Cache Key Facts 概要
                </div>
                <div class="ew-workbench__module-explain-text">
                  {{ selectedNodeDiagnostics.cacheKeyFactsSummary }}
                </div>
              </div>
              <div class="ew-workbench__module-explain-section">
                <div class="ew-workbench__module-explain-title">
                  只读命中事实
                </div>
                <div class="ew-workbench__module-explain-text">
                  {{ selectedNodeDiagnostics.reusableOutputsFactLabel }}
                </div>
                <div class="ew-workbench__module-explain-text">
                  {{ selectedNodeDiagnostics.skipReuseOutputsFactLabel }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Property panel -->
        <EwNodePropertyPanel
          :node="editingNode"
          @close="editingNode = null"
          @update-config="onUpdateConfig"
        />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { klona } from "klona/full";
import EwModulePalette from "./EwModulePalette.vue";
import EwNodePropertyPanel from "./EwNodePropertyPanel.vue";
import { MODULE_REGISTRY, getModuleExplainContract } from "./module-registry";
import type {
  GraphActiveRunSummaryViewModel,
  GraphNodeDiagnosticsViewModel,
  GraphRunDiagnosticsSummaryViewModel,
  ModuleExplainContract,
  ModulePortDef,
  WorkbenchGraph,
  WorkbenchNode,
} from "./module-types";

const props = defineProps<{
  graphs: WorkbenchGraph[];
  diagnosticsSummary: GraphRunDiagnosticsSummaryViewModel | null;
  activeRunSummary: GraphActiveRunSummaryViewModel | null;
}>();

const emit = defineEmits<{
  (e: "update:graphs", graphs: WorkbenchGraph[]): void;
}>();

const isFullscreen = ref(false);

// ── Active graph ──
const localGraphs = ref<WorkbenchGraph[]>(klona(props.graphs));
const activeGraphId = ref(localGraphs.value[0]?.id ?? "");
const activeGraph = computed(() =>
  localGraphs.value.find((g) => g.id === activeGraphId.value),
);
const activeNodes = computed(() => activeGraph.value?.nodes ?? []);
const activeEdges = computed(() => activeGraph.value?.edges ?? []);

// ── Property panel ──
const editingNode = ref<WorkbenchNode | null>(null);

watch(
  () => props.graphs,
  (graphs) => {
    localGraphs.value = klona(graphs);
    if (localGraphs.value.length > 0) {
      if (!localGraphs.value.find((gr) => gr.id === activeGraphId.value)) {
        activeGraphId.value = localGraphs.value[0].id;
      }
      if (editingNode.value) {
        const syncedNode = localGraphs.value
          .flatMap((graph) => graph.nodes)
          .find((node) => node.id === editingNode.value?.id);
        editingNode.value = syncedNode ?? null;
      }
      return;
    }

    activeGraphId.value = "";
    editingNode.value = null;
  },
  { deep: true, immediate: true },
);

// ── Viewport ──
const viewport = reactive({ x: 0, y: 0, zoom: 1 });
const canvasRef = ref<HTMLElement>();

const transformStyle = computed(() => ({
  transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
  transformOrigin: "0 0",
}));

// ── Pan & Zoom ──
let isPanning = false;
let panStartX = 0;
let panStartY = 0;

function onCanvasPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  isPanning = true;
  panStartX = e.clientX - viewport.x;
  panStartY = e.clientY - viewport.y;
  window.addEventListener("pointermove", onCanvasPanMove);
  window.addEventListener("pointerup", onCanvasPanEnd);
}

function onCanvasPanMove(e: PointerEvent) {
  if (!isPanning) return;
  viewport.x = e.clientX - panStartX;
  viewport.y = e.clientY - panStartY;
}

function onCanvasPanEnd() {
  isPanning = false;
  window.removeEventListener("pointermove", onCanvasPanMove);
  window.removeEventListener("pointerup", onCanvasPanEnd);
}

function onWheel(e: WheelEvent) {
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  const newZoom = Math.max(0.2, Math.min(3, viewport.zoom * delta));
  const rect = canvasRef.value?.getBoundingClientRect();
  if (rect) {
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    viewport.x = cx - (cx - viewport.x) * (newZoom / viewport.zoom);
    viewport.y = cy - (cy - viewport.y) * (newZoom / viewport.zoom);
  }
  viewport.zoom = newZoom;
}

// ── Node drag ──
const selectedNodeId = ref<string | null>(null);
const selectedModuleExplain = computed<ModuleExplainContract | null>(() => {
  const selectedNode = activeNodes.value.find(
    (node) => node.id === selectedNodeId.value,
  );
  return selectedNode ? getModuleExplainContract(selectedNode.moduleId) : null;
});
const selectedModuleLabel = computed(() => {
  const selectedNode = activeNodes.value.find(
    (node) => node.id === selectedNodeId.value,
  );
  return selectedNode ? getModuleLabel(selectedNode.moduleId) : "";
});
const selectedNodeDiagnostics = computed<GraphNodeDiagnosticsViewModel | null>(
  () => {
    if (!selectedNodeId.value) {
      return null;
    }
    const activeNodeDiagnostics = props.activeRunSummary?.nodeDiagnostics;
    if (
      activeNodeDiagnostics &&
      activeNodeDiagnostics.nodeId === selectedNodeId.value
    ) {
      return activeNodeDiagnostics;
    }
    return null;
  },
);
let draggingNodeId: string | null = null;
let dragOffsetX = 0;
let dragOffsetY = 0;

function onNodePointerDown(e: PointerEvent, node: WorkbenchNode) {
  selectedNodeId.value = node.id;
  draggingNodeId = node.id;
  const rect = canvasRef.value?.getBoundingClientRect();
  if (!rect) return;
  dragOffsetX =
    (e.clientX - rect.left - viewport.x) / viewport.zoom - node.position.x;
  dragOffsetY =
    (e.clientY - rect.top - viewport.y) / viewport.zoom - node.position.y;
  window.addEventListener("pointermove", onNodeDragMove);
  window.addEventListener("pointerup", onNodeDragEnd);
}

function onNodeDragMove(e: PointerEvent) {
  if (!draggingNodeId || !activeGraph.value) return;
  const node = activeGraph.value.nodes.find((n) => n.id === draggingNodeId);
  if (!node) return;
  const rect = canvasRef.value?.getBoundingClientRect();
  const rx = rect?.left ?? 0;
  const ry = rect?.top ?? 0;
  node.position.x = (e.clientX - rx - viewport.x) / viewport.zoom - dragOffsetX;
  node.position.y = (e.clientY - ry - viewport.y) / viewport.zoom - dragOffsetY;
}

function onNodeDragEnd() {
  draggingNodeId = null;
  window.removeEventListener("pointermove", onNodeDragMove);
  window.removeEventListener("pointerup", onNodeDragEnd);
  emitGraphs();
}

// ── Drop from palette ──
function onDrop(e: DragEvent) {
  const moduleId = e.dataTransfer?.getData("application/ew-module");
  if (!moduleId || !activeGraph.value || !canvasRef.value) return;

  const bp = MODULE_REGISTRY.get(moduleId);
  if (!bp) return;

  const rect = canvasRef.value.getBoundingClientRect();
  const x = (e.clientX - rect.left - viewport.x) / viewport.zoom;
  const y = (e.clientY - rect.top - viewport.y) / viewport.zoom;

  const newNode: WorkbenchNode = {
    id: `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    moduleId,
    position: { x, y },
    config: { ...bp.defaultConfig },
    collapsed: false,
  };

  activeGraph.value.nodes.push(newNode);
  emitGraphs();
}

function openPropertyPanel(node: WorkbenchNode) {
  editingNode.value = node;
}

function onCanvasDblClick() {
  editingNode.value = null;
}

function onUpdateConfig(nodeId: string, config: Record<string, any>) {
  if (!activeGraph.value) return;
  const node = activeGraph.value.nodes.find((n) => n.id === nodeId);
  if (node) {
    node.config = config;
    editingNode.value = node;
    emitGraphs();
  }
}

// ── Graph management ──
function addGraph() {
  const id = `graph_${Date.now()}`;
  const newGraph: WorkbenchGraph = {
    id,
    name: `工作流 ${localGraphs.value.length + 1}`,
    enabled: true,
    timing: "default",
    priority: 100,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  localGraphs.value.push(newGraph);
  activeGraphId.value = id;
  emitGraphs();
}

function renameGraph() {
  if (!activeGraph.value) return;
  const name = prompt("图名称:", activeGraph.value.name);
  if (name !== null) {
    activeGraph.value.name = name;
    emitGraphs();
  }
}

function toggleEnabled() {
  if (!activeGraph.value) return;
  activeGraph.value.enabled = !activeGraph.value.enabled;
  emitGraphs();
}

function emitGraphs() {
  emit("update:graphs", klona(localGraphs.value));
}

// ── Module helpers ──
function getModuleColor(moduleId: string): string {
  return MODULE_REGISTRY.get(moduleId)?.color ?? "#555";
}

function getModuleIcon(moduleId: string): string {
  return MODULE_REGISTRY.get(moduleId)?.icon ?? "?";
}

function getModuleLabel(moduleId: string): string {
  return MODULE_REGISTRY.get(moduleId)?.label ?? moduleId;
}

function getModulePorts(
  moduleId: string,
  direction: "in" | "out",
): ModulePortDef[] {
  const bp = MODULE_REGISTRY.get(moduleId);
  if (!bp) return [];
  return bp.ports.filter((p) => p.direction === direction);
}

function nodeStyle(node: WorkbenchNode) {
  return {
    transform: `translate(${node.position.x}px, ${node.position.y}px)`,
    position: "absolute" as const,
    left: 0,
    top: 0,
  };
}

// ── Port positions (simplified) ──
function getPortPos(nodeId: string, portId: string) {
  const node = activeNodes.value.find((n) => n.id === nodeId);
  if (!node) return null;
  const bp = MODULE_REGISTRY.get(node.moduleId);
  if (!bp) return null;
  const port = bp.ports.find((p) => p.id === portId);
  if (!port) return null;

  const inPorts = bp.ports.filter((p) => p.direction === "in");
  const outPorts = bp.ports.filter((p) => p.direction === "out");

  const nodeWidth = 220;
  if (port.direction === "in") {
    const idx = inPorts.indexOf(port);
    return { x: node.position.x, y: node.position.y + 40 + idx * 22 };
  } else {
    const idx = outPorts.indexOf(port);
    return {
      x: node.position.x + nodeWidth,
      y: node.position.y + 40 + idx * 22,
    };
  }
}
</script>

<style scoped>
.ew-workbench {
  display: flex;
  flex-direction: column;
  background: #0a0a1a;
  height: 500px;
  min-height: 300px;
  border-radius: 0 0 8px 8px;
  overflow: hidden;
}

.ew-workbench__diagnostics {
  display: grid;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(12, 16, 36, 0.96);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.84);
  font-size: 12px;
}

.ew-workbench__diagnostics-block {
  display: grid;
  gap: 6px;
}

.ew-workbench__diagnostics-heading {
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.62);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.ew-workbench__diagnostics-disclaimer {
  font-size: 11px;
  line-height: 1.5;
  color: rgba(248, 250, 252, 0.72);
}

.ew-workbench__diagnostics-main,
.ew-workbench__diagnostics-reasons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.ew-workbench__diagnostics-status,
.ew-workbench__diagnostics-item,
.ew-workbench__diagnostics-reason {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
}

.ew-workbench__diagnostics-status[data-status="completed"] {
  background: rgba(16, 185, 129, 0.2);
  color: #bbf7d0;
}

.ew-workbench__diagnostics-status[data-status="failed"] {
  background: rgba(239, 68, 68, 0.2);
  color: #fecaca;
}

.ew-workbench__diagnostics-status[data-status="running"],
.ew-workbench__diagnostics-status[data-status="streaming"],
.ew-workbench__diagnostics-status[data-status="queued"],
.ew-workbench__diagnostics-status[data-status="waiting_user"],
.ew-workbench__diagnostics-status[data-status="cancelling"] {
  background: rgba(59, 130, 246, 0.18);
  color: #bfdbfe;
}

.ew-workbench__diagnostics-status[data-status="cancelled"] {
  background: rgba(148, 163, 184, 0.18);
  color: #e2e8f0;
}

.ew-workbench__canvas-wrap {
  display: flex;
  flex: 1;
  min-height: 0;
}

.ew-workbench__module-explain {
  width: 300px;
  padding: 12px;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(14, 18, 34, 0.96);
  color: rgba(255, 255, 255, 0.84);
  display: grid;
  gap: 10px;
  align-content: start;
  overflow: auto;
}

.ew-workbench__module-explain-heading {
  display: grid;
  gap: 4px;
  font-size: 12px;
}

.ew-workbench__module-explain-heading span:first-child {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
}

.ew-workbench__module-explain-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ew-workbench__module-explain-tag {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  font-size: 11px;
}

.ew-workbench__module-explain-sections {
  display: grid;
  gap: 10px;
}

.ew-workbench__node-diagnostics {
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  border-right: none;
}

.ew-workbench__module-explain-section {
  display: grid;
  gap: 6px;
}

.ew-workbench__module-explain-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.62);
}

.ew-workbench__module-explain-text {
  font-size: 12px;
  line-height: 1.5;
}

/* Full-screen mode: fixed overlay covering entire screen */
.ew-workbench.is-fullscreen {
  position: fixed;
  inset: 0;
  height: 100vh;
  z-index: 10000;
  border-radius: 0;
}

/* Top bar */
.ew-workbench__topbar {
  display: flex;
  align-items: center;
  height: 36px;
  background: rgba(15, 15, 35, 0.95);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 0 8px;
  flex-shrink: 0;
}

.ew-workbench__tabs {
  display: flex;
  gap: 2px;
  flex: 1;
  overflow-x: auto;
}

.ew-workbench__tab {
  padding: 4px 12px;
  border: none;
  border-radius: 4px 4px 0 0;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.ew-workbench__tab.active {
  background: rgba(99, 102, 241, 0.2);
  color: rgba(255, 255, 255, 0.9);
}

.ew-workbench__tab:hover:not(.active) {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
}

.ew-workbench__tab--add {
  color: rgba(255, 255, 255, 0.3);
  background: none;
  font-size: 14px;
  padding: 4px 8px;
}

.ew-workbench__controls {
  display: flex;
  gap: 4px;
}

.ew-workbench__ctrl-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.ew-workbench__ctrl-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
}

/* Main layout */
.ew-workbench__main {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}

/* Canvas */
.ew-workbench__canvas {
  flex: 1;
  position: relative;
  overflow: hidden;
  cursor: grab;
}

.ew-workbench__canvas:active {
  cursor: grabbing;
}

.ew-workbench__grid {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.ew-workbench__transform {
  position: absolute;
  top: 0;
  left: 0;
  will-change: transform;
}

/* Edges */
.ew-workbench__edges-svg {
  pointer-events: none;
}

/* Nodes */
.ew-workbench__node {
  width: 220px;
  border-radius: 8px;
  background: rgba(15, 15, 35, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  cursor: move;
  user-select: none;
  transition: box-shadow 0.15s;
}

.ew-workbench__node.is-selected {
  border-color: rgba(99, 102, 241, 0.5);
  box-shadow:
    0 0 0 2px rgba(99, 102, 241, 0.25),
    0 4px 16px rgba(0, 0, 0, 0.3);
}

.ew-workbench__node:hover {
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
}

.ew-workbench__node-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 7px 7px 0 0;
  color: white;
  font-size: 11px;
  font-weight: 600;
}

.ew-workbench__node-icon {
  font-size: 13px;
}

.ew-workbench__node-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ew-workbench__node-ports {
  padding: 6px 0;
}

.ew-workbench__port {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  font-size: 10px;
}

.ew-workbench__port--in {
  flex-direction: row;
}

.ew-workbench__port--out {
  flex-direction: row;
  justify-content: flex-end;
}

.ew-workbench__port-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  border: 1.5px solid rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
  cursor: crosshair;
  transition: all 0.15s;
}

.ew-workbench__port-dot:hover {
  background: rgba(99, 102, 241, 0.5);
  border-color: rgba(99, 102, 241, 0.8);
  transform: scale(1.3);
}

.ew-workbench__port-label {
  color: rgba(255, 255, 255, 0.5);
}

/* Empty state */
.ew-workbench__empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.ew-workbench__empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
  opacity: 0.3;
}

.ew-workbench__empty-text {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.3);
  margin-bottom: 6px;
}

.ew-workbench__empty-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.15);
}
</style>
