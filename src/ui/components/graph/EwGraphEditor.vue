<template>
  <Teleport to="body" :disabled="!isFullscreen">
    <div class="ew-graph-root" :class="{ 'is-fullscreen': isFullscreen }">
      <!-- Left palette -->
      <EwModulePalette />

      <!-- Main canvas area -->
      <div
        class="ew-graph-editor"
        ref="canvasContainer"
        @pointerdown="onCanvasPointerDown"
        @wheel.prevent="onWheel"
        @dblclick="onDblClick"
        @contextmenu.prevent="onCanvasContextMenu"
        @touchstart.passive="onTouchStart"
        @touchmove.prevent="onTouchMove"
        @touchend="onTouchEnd"
        @dragover.prevent="onDragOver"
        @drop.prevent="onDrop"
      >
        <!-- Grid background -->
        <svg class="ew-graph-editor__grid" :style="gridStyle">
          <defs>
            <pattern
              id="ew-grid-dots"
              :width="20 * graph.state.viewport.zoom"
              :height="20 * graph.state.viewport.zoom"
              patternUnits="userSpaceOnUse"
              :x="graph.state.viewport.x"
              :y="graph.state.viewport.y"
            >
              <circle
                :cx="(20 * graph.state.viewport.zoom) / 2"
                :cy="(20 * graph.state.viewport.zoom) / 2"
                :r="1 * graph.state.viewport.zoom"
                fill="rgba(255, 255, 255, 0.12)"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#ew-grid-dots)" />
        </svg>

        <!-- Canvas transform wrapper -->
        <div class="ew-graph-editor__canvas" :style="canvasStyle">
          <!-- SVG layer for edges -->
          <svg
            class="ew-graph-editor__edges"
            style="
              position: absolute;
              top: 0;
              left: 0;
              width: 1px;
              height: 1px;
              overflow: visible;
            "
          >
            <EwGraphEdge
              v-for="edge in graph.state.edges"
              :key="edge.id"
              :edge="edge"
              :source-x="getEdgeSourceX(edge)"
              :source-y="getEdgeSourceY(edge)"
              :target-x="getEdgeTargetX(edge)"
              :target-y="getEdgeTargetY(edge)"
              :source-color="getNodeColor(edge.source)"
              :selected="selectedEdge === edge.id"
              @select="selectedEdge = $event"
              @context-menu="onEdgeContextMenu"
            />
            <!-- In-progress drag edge -->
            <path
              v-if="dragEdge"
              class="ew-graph-editor__drag-edge"
              :d="dragEdgePath"
              fill="none"
              stroke="rgba(255, 255, 255, 0.5)"
              stroke-width="2"
              stroke-dasharray="6 4"
            />
          </svg>

          <!-- Marquee selection rect -->
          <div
            v-if="marquee"
            class="ew-graph-editor__marquee"
            :style="marqueeStyle"
          />

          <!-- Nodes -->
          <EwGraphNode
            v-for="node in graph.state.nodes"
            :key="node.id"
            :ref="(el: any) => registerNodeRef(node.id, el)"
            :node="node"
            :edges="graph.state.edges"
            :zoom="graph.state.viewport.zoom"
            :selected="selectedNodes.has(node.id)"
            :selected-nodes="selectedNodes"
            :z-index="nodeZIndex.get(node.id) || 1"
            @move="onNodeMove"
            @group-move="onGroupMove"
            @toggle-collapse="graph.toggleCollapse(node.id)"
            @port-drag-start="onPortDragStart"
            @contextmenu.stop.prevent="onNodeContextMenu(node.id, $event)"
            @bring-to-front="bringToFront(node.id)"
            @select="onNodeSelect"
          />
        </div>

        <!-- Toolbar -->
        <div class="ew-graph-editor__toolbar">
          <button type="button" @click="undo" title="撤销 (Ctrl+Z)">↩</button>
          <button type="button" @click="redo" title="重做 (Ctrl+Shift+Z)">
            ↪
          </button>
          <span class="ew-graph-editor__toolbar-sep"></span>
          <button type="button" @click="zoomIn" title="放大">+</button>
          <span class="ew-graph-editor__zoom-label">{{ zoomPercent }}%</span>
          <button type="button" @click="zoomOut" title="缩小">−</button>
          <button type="button" @click="fitView" title="适配视图">◎</button>
          <button type="button" @click="autoLayout" title="自动排列">⊞</button>
          <button type="button" @click="reloadCurrentSlot" title="重新加载">
            ↻
          </button>
          <button
            type="button"
            @click="toggleFullscreen"
            :title="isFullscreen ? '退出全屏' : '全屏'"
          >
            ⛶
          </button>
        </div>

        <!-- Canvas slot bar -->
        <div class="ew-graph-editor__slots">
          <button
            v-for="slot in canvasSlots"
            :key="slot.id"
            class="ew-graph-editor__slot-tab"
            :class="{ 'is-active': activeSlotId === slot.id }"
            @click="switchSlot(slot.id)"
          >
            <span>{{ slot.name }}</span>
            <span
              v-if="slot.id !== 'overview'"
              class="ew-graph-editor__slot-close"
              @click.stop="removeSlot(slot.id)"
              >×</span
            >
          </button>
          <button
            class="ew-graph-editor__slot-add"
            @click="addSlot"
            title="新建画布"
          >
            +
          </button>
        </div>

        <!-- Context menu -->
        <div
          v-if="ctxMenu"
          class="ew-graph-ctx"
          :style="{ top: ctxMenu.y + 'px', left: ctxMenu.x + 'px' }"
        >
          <button v-if="ctxMenu.edgeId" @click="deleteEdge(ctxMenu.edgeId)">
            🗑 删除连线
          </button>
          <button v-if="ctxMenu.nodeId" @click="deleteNode(ctxMenu.nodeId)">
            🗑 删除节点
          </button>
          <button @click="ctxMenu = null">✕ 取消</button>
        </div>
        <!-- Click-away overlay -->
        <div
          v-if="ctxMenu"
          class="ew-graph-ctx-overlay"
          @pointerdown="ctxMenu = null"
        />

        <!-- Minimap -->
        <div
          class="ew-graph-minimap"
          :style="{ right: minimapPos.x + 'px', bottom: minimapPos.y + 'px' }"
          @contextmenu.prevent
          @selectstart.prevent
        >
          <div
            class="ew-graph-minimap__handle"
            @pointerdown.stop.prevent="onMinimapDragStart"
          >
            <span>⡇</span>
          </div>
          <svg
            :viewBox="minimapViewBox"
            preserveAspectRatio="xMidYMid meet"
            width="100%"
            height="100%"
            @pointerdown.stop.prevent="onMinimapPointerDown"
          >
            <!-- Edges as cubic Bézier curves -->
            <path
              v-for="edge in minimapEdges"
              :key="'mm-e-' + edge.id"
              :d="edge.path"
              fill="none"
              :stroke="edge.color"
              stroke-width="2"
              stroke-opacity="0.5"
            />
            <!-- Nodes with type-specific colors -->
            <g v-for="node in graph.state.nodes" :key="'mm-' + node.id">
              <rect
                :x="node.position.x"
                :y="node.position.y"
                :width="180"
                :height="node.collapsed ? 36 : 100"
                rx="4"
                :fill="getMinimapNodeColor(node.moduleId) + '55'"
                :stroke="getMinimapNodeColor(node.moduleId)"
                stroke-width="1.5"
              />
              <text
                :x="node.position.x + 90"
                :y="node.position.y + (node.collapsed ? 22 : 16)"
                text-anchor="middle"
                fill="rgba(255,255,255,0.7)"
                font-size="11"
                font-family="sans-serif"
              >
                {{ (node.config?._label ?? node.moduleId).slice(0, 8) }}
              </text>
            </g>
            <!-- Viewport indicator -->
            <rect
              :x="viewportRect.x"
              :y="viewportRect.y"
              :width="viewportRect.w"
              :height="viewportRect.h"
              fill="rgba(255,255,255,0.04)"
              stroke="rgba(255,255,255,0.6)"
              stroke-width="4"
              stroke-dasharray="8 4"
              rx="3"
            />
          </svg>
        </div>

        <EwNodePropertyPanel
          :node="editingNode"
          :builder-mode="props.graph?.runtimeMeta?.builderMode ?? 'advanced'"
          @close="clearSelection"
          @update-config="onUpdateConfig"
        />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import EwGraphEdge from "./EwGraphEdge.vue";
import EwGraphNode from "./EwGraphNode.vue";
import EwModulePalette from "./EwModulePalette.vue";
import EwNodePropertyPanel from "./EwNodePropertyPanel.vue";
import { MODULE_REGISTRY } from "./module-registry";
import type {
  WorkbenchEdge,
  WorkbenchGraph,
  WorkbenchNode,
} from "./module-types";
import { wouldCreateCycle } from "./module-types";

const props = defineProps<{
  graph: WorkbenchGraph | null;
  savedSlots?: Array<any>;
}>();

const emit = defineEmits<{
  (e: "update:graph", graph: WorkbenchGraph): void;
  (e: "save-slots", slots: any[]): void;
  (e: "select-node", nodeId: string | null): void;
}>();

// ── Inline reactive graph state (replaces createGraphState) ──
const graphState = reactive({
  nodes: [] as WorkbenchNode[],
  edges: [] as WorkbenchEdge[],
  viewport: { x: 0, y: 0, zoom: 1 },
});

const graphNodeMap = computed(() => {
  const m = new Map<string, WorkbenchNode>();
  for (const n of graphState.nodes) m.set(n.id, n);
  return m;
});

function graphAddNode(
  moduleId: string,
  x: number,
  y: number,
  extraConfig?: Record<string, any>,
): WorkbenchNode {
  const bp = MODULE_REGISTRY.get(moduleId);
  const node: WorkbenchNode = {
    id: `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    moduleId,
    position: { x, y },
    config: { ...(bp?.defaultConfig ?? {}), ...(extraConfig ?? {}) },
    collapsed: false,
  };
  graphState.nodes.push(node);
  return node;
}

function graphRemoveNode(nodeId: string) {
  graphState.edges = graphState.edges.filter(
    (e) => e.source !== nodeId && e.target !== nodeId,
  );
  graphState.nodes = graphState.nodes.filter((n) => n.id !== nodeId);
}

function graphAddEdge(
  source: string,
  sourcePort: string,
  target: string,
  targetPort: string,
) {
  if (wouldCreateCycle(graphState.edges, source, target)) return;
  const dup = graphState.edges.some(
    (e) =>
      e.source === source &&
      e.sourcePort === sourcePort &&
      e.target === target &&
      e.targetPort === targetPort,
  );
  if (dup) return;
  graphState.edges.push({
    id: `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    source,
    sourcePort,
    target,
    targetPort,
  });
}

function graphRemoveEdge(edgeId: string) {
  graphState.edges = graphState.edges.filter((e) => e.id !== edgeId);
}

function graphMoveNode(nodeId: string, x: number, y: number) {
  const node = graphNodeMap.value.get(nodeId);
  if (node) {
    node.position.x = x;
    node.position.y = y;
  }
}

function graphToggleCollapse(nodeId: string) {
  const node = graphNodeMap.value.get(nodeId);
  if (node) node.collapsed = !node.collapsed;
}

function graphPanTo(x: number, y: number) {
  graphState.viewport.x = x;
  graphState.viewport.y = y;
}

function graphZoomTo(newZoom: number, cx?: number, cy?: number) {
  const clamped = Math.max(0.1, Math.min(3, newZoom));
  if (cx !== undefined && cy !== undefined) {
    const ratio = clamped / graphState.viewport.zoom;
    graphState.viewport.x = cx - (cx - graphState.viewport.x) * ratio;
    graphState.viewport.y = cy - (cy - graphState.viewport.y) * ratio;
  }
  graphState.viewport.zoom = clamped;
}

function graphFitToView(width: number, height: number) {
  if (graphState.nodes.length === 0) return;
  const PAD = 80;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of graphState.nodes) {
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + 240);
    maxY = Math.max(maxY, n.position.y + 120);
  }
  const contentW = maxX - minX + PAD * 2;
  const contentH = maxY - minY + PAD * 2;
  const z = Math.min(1.5, Math.min(width / contentW, height / contentH));
  graphState.viewport.zoom = Math.max(0.1, z);
  graphState.viewport.x =
    (width - contentW * graphState.viewport.zoom) / 2 -
    minX * graphState.viewport.zoom +
    PAD * graphState.viewport.zoom;
  graphState.viewport.y =
    (height - contentH * graphState.viewport.zoom) / 2 -
    minY * graphState.viewport.zoom +
    PAD * graphState.viewport.zoom;
}

// Wrap into graph object to preserve template & downstream API compatibility
const graph = {
  state: graphState,
  nodeMap: graphNodeMap,
  addNode: graphAddNode,
  removeNode: graphRemoveNode,
  addEdge: graphAddEdge,
  removeEdge: graphRemoveEdge,
  moveNode: graphMoveNode,
  toggleCollapse: graphToggleCollapse,
  panTo: graphPanTo,
  zoomTo: graphZoomTo,
  fitToView: graphFitToView,
};

const canvasContainer = ref<HTMLElement>();
const selectedEdge = ref<string | null>(null);
const selectedNodes = reactive(new Set<string>());
const isFullscreen = ref(false);

// Forward primary node selection to parent
watch(
  () => [...selectedNodes],
  (ids) => {
    emit("select-node", ids.length === 1 ? ids[0] : null);
  },
);

// ── Z-index (bring to front on click) ──
const nodeZIndex = reactive(new Map<string, number>());
let zCounter = 1;

function bringToFront(nodeId: string) {
  zCounter++;
  nodeZIndex.set(nodeId, zCounter);
}

function onNodeSelect(nodeId: string, shiftKey: boolean) {
  if (shiftKey) {
    // Toggle in multi-select
    if (selectedNodes.has(nodeId)) {
      selectedNodes.delete(nodeId);
    } else {
      selectedNodes.add(nodeId);
    }
  } else {
    // Single select: clear others, select this one
    selectedNodes.clear();
    selectedNodes.add(nodeId);
  }
}

// ── Canvas Slots ──
interface CanvasSlot {
  id: string;
  name: string;
  nodes: any[];
  edges: any[];
  viewport: { x: number; y: number; zoom: number };
}

function emitSaveSlots() {
  saveCurrentSlotState();
  emit("save-slots", JSON.parse(JSON.stringify(canvasSlots.value)));
}

const canvasSlots = ref<CanvasSlot[]>([
  {
    id: "overview",
    name: "★ 实时总览",
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
]);
const activeSlotId = ref("overview");

function initSlots() {
  const saved = props.savedSlots || [];
  if (saved.length > 0) {
    const hasOverview = saved.some((s: any) => s.id === "overview");
    if (!hasOverview) {
      saved.unshift({
        id: "overview",
        name: "★ 实时总览",
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      });
    }
    canvasSlots.value = saved;
  }
}

function saveCurrentSlotState() {
  const slot = canvasSlots.value.find((s) => s.id === activeSlotId.value);
  if (slot) {
    slot.nodes = JSON.parse(JSON.stringify(graph.state.nodes));
    slot.edges = JSON.parse(JSON.stringify(graph.state.edges));
    slot.viewport = { ...graph.state.viewport };
  }
}

function switchSlot(slotId: string) {
  if (slotId === activeSlotId.value) return;
  // Save current state
  saveCurrentSlotState();
  emitSaveSlots();

  activeSlotId.value = slotId;

  if (slotId === "overview") {
    // Overview always reloads from the bound workbench graph
    loadFromGraph();
  } else {
    // Load saved state
    const slot = canvasSlots.value.find((s) => s.id === slotId);
    if (slot) {
      graph.state.nodes = JSON.parse(JSON.stringify(slot.nodes));
      graph.state.edges = JSON.parse(JSON.stringify(slot.edges));
      graph.state.viewport.x = slot.viewport.x;
      graph.state.viewport.y = slot.viewport.y;
      graph.state.viewport.zoom = slot.viewport.zoom;
    }
  }
}

function addSlot() {
  const id = `slot_${Date.now().toString(36)}`;
  const num = canvasSlots.value.length;
  canvasSlots.value.push({
    id,
    name: `画布 ${num}`,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  switchSlot(id);
}

function removeSlot(slotId: string) {
  if (slotId === "overview") return;
  const idx = canvasSlots.value.findIndex((s) => s.id === slotId);
  if (idx === -1) return;
  canvasSlots.value.splice(idx, 1);
  if (activeSlotId.value === slotId) {
    switchSlot("overview");
  }
  emitSaveSlots();
}

function reloadCurrentSlot() {
  if (activeSlotId.value === "overview") {
    loadFromGraph();
  } else {
    const slot = canvasSlots.value.find((s) => s.id === activeSlotId.value);
    if (slot) {
      graph.state.nodes = JSON.parse(JSON.stringify(slot.nodes));
      graph.state.edges = JSON.parse(JSON.stringify(slot.edges));
    }
  }
}

// ── Marquee selection ──
const marquee = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(
  null,
);

const marqueeStyle = computed(() => {
  if (!marquee.value) return {};
  const { x1, y1, x2, y2 } = marquee.value;
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  return {
    left: left + "px",
    top: top + "px",
    width: Math.abs(x2 - x1) + "px",
    height: Math.abs(y2 - y1) + "px",
  };
});

function onNodeMove(nodeId: string, x: number, y: number) {
  // If the dragged node is selected and there are other selected nodes, move all
  if (selectedNodes.has(nodeId) && selectedNodes.size > 1) {
    const node = graph.state.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const dx = x - node.position.x;
    const dy = y - node.position.y;
    for (const sid of selectedNodes) {
      const sn = graph.state.nodes.find((n) => n.id === sid);
      if (sn) {
        sn.position.x += dx;
        sn.position.y += dy;
      }
    }
  } else {
    graph.moveNode(nodeId, x, y);
  }
}

function onGroupMove(dx: number, dy: number) {
  for (const sid of selectedNodes) {
    const sn = graph.state.nodes.find((n) => n.id === sid);
    if (sn) {
      sn.position.x += dx;
      sn.position.y += dy;
    }
  }
}

// ── Context menu ──
const ctxMenu = ref<{
  x: number;
  y: number;
  edgeId?: string;
  nodeId?: string;
} | null>(null);

function onEdgeContextMenu(edgeId: string, event: MouseEvent) {
  const rect = canvasContainer.value?.getBoundingClientRect();
  if (!rect) return;
  ctxMenu.value = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    edgeId,
  };
}

function onNodeContextMenu(nodeId: string, event: MouseEvent) {
  const rect = canvasContainer.value?.getBoundingClientRect();
  if (!rect) return;
  ctxMenu.value = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    nodeId,
  };
}

function onCanvasContextMenu(event: MouseEvent) {
  // Only show if we right-clicked on the blank canvas itself
  ctxMenu.value = null;
}

function deleteEdge(edgeId: string) {
  pushUndo();
  graph.removeEdge(edgeId);
  selectedEdge.value = null;
  ctxMenu.value = null;
}

function deleteNode(nodeId: string) {
  pushUndo();
  graph.removeNode(nodeId);
  selectedNodes.delete(nodeId);
  ctxMenu.value = null;
}

// ── Touch (mobile) ──
let touchPanState: {
  startX: number;
  startY: number;
  vpX: number;
  vpY: number;
} | null = null;
let pinchState: { dist: number; zoom: number } | null = null;

function getTouchDist(t1: Touch, t2: Touch): number {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function onTouchStart(e: TouchEvent) {
  ctxMenu.value = null;
  if (e.touches.length === 1) {
    // Single touch = pan
    touchPanState = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      vpX: graph.state.viewport.x,
      vpY: graph.state.viewport.y,
    };
    pinchState = null;
  } else if (e.touches.length === 2) {
    // Two touch = pinch zoom
    touchPanState = null;
    pinchState = {
      dist: getTouchDist(e.touches[0], e.touches[1]),
      zoom: graph.state.viewport.zoom,
    };
  }
}

function onTouchMove(e: TouchEvent) {
  if (e.touches.length === 1 && touchPanState) {
    const dx = e.touches[0].clientX - touchPanState.startX;
    const dy = e.touches[0].clientY - touchPanState.startY;
    graph.panTo(touchPanState.vpX + dx, touchPanState.vpY + dy);
  } else if (e.touches.length === 2 && pinchState) {
    const newDist = getTouchDist(e.touches[0], e.touches[1]);
    const scale = newDist / pinchState.dist;
    graph.zoomTo(pinchState.zoom * scale);
  }
}

function onTouchEnd() {
  touchPanState = null;
  pinchState = null;
}

// ── Palette drag-drop ──

function onDragOver(e: DragEvent) {
  if (e.dataTransfer?.types.includes("application/ew-module")) {
    e.dataTransfer.dropEffect = "copy";
  }
}

function onDrop(e: DragEvent) {
  const moduleId = e.dataTransfer?.getData("application/ew-module");
  if (!moduleId) return;
  const bp = MODULE_REGISTRY.get(moduleId);
  if (!bp) return;
  const rect = canvasContainer.value?.getBoundingClientRect();
  if (!rect) return;

  const zoom = graph.state.viewport.zoom;
  const worldX = (e.clientX - rect.left - graph.state.viewport.x) / zoom;
  const worldY = (e.clientY - rect.top - graph.state.viewport.y) / zoom;

  graph.addNode(moduleId, worldX, worldY);
}
const nodeRefs = new Map<string, any>();
let fitViewRaf: number | null = null;
let containerResizeObserver: ResizeObserver | null = null;

// ── Drag edge state ──
const dragEdge = ref<{
  sourceNodeId: string;
  sourcePortId: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
} | null>(null);

function registerNodeRef(nodeId: string, comp: any) {
  if (comp) nodeRefs.set(nodeId, comp);
}

// ── Computed styles ──

const canvasStyle = computed(() => ({
  transform: `translate(${graph.state.viewport.x}px, ${graph.state.viewport.y}px) scale(${graph.state.viewport.zoom})`,
  transformOrigin: "0 0",
}));

const gridStyle = computed(() => ({
  position: "absolute" as const,
  top: "0",
  left: "0",
  width: "100%",
  height: "100%",
  pointerEvents: "none" as const,
}));

const zoomPercent = computed(() => Math.round(graph.state.viewport.zoom * 100));

// ── Minimap ──
const minimapViewBox = computed(() => {
  const nodes = graph.state.nodes;
  if (nodes.length === 0) return "0 0 1000 600";
  const PAD = 200;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + 180);
    maxY = Math.max(maxY, n.position.y + 120);
  }
  return `${minX - PAD} ${minY - PAD} ${maxX - minX + PAD * 2} ${maxY - minY + PAD * 2}`;
});

const minimapEdges = computed(() => {
  return graph.state.edges.map((edge) => {
    const sx = getEdgeSourceX(edge);
    const sy = getEdgeSourceY(edge);
    const tx = getEdgeTargetX(edge);
    const ty = getEdgeTargetY(edge);
    const dx = Math.abs(tx - sx);
    const cp = Math.max(80, dx * 0.4);
    const path = `M ${sx} ${sy} C ${sx + cp} ${sy}, ${tx - cp} ${ty}, ${tx} ${ty}`;
    const color = getNodeColor(edge.source);
    return { id: edge.id, path, color };
  });
});

function getMinimapNodeColor(moduleId: string): string {
  return MODULE_REGISTRY.get(moduleId)?.color ?? "#6366f1";
}

const editingNode = computed(() => {
  if (selectedNodes.size !== 1) return null;
  const [nodeId] = [...selectedNodes];
  return graph.nodeMap.value.get(nodeId) ?? null;
});

function clearSelection() {
  selectedNodes.clear();
  selectedEdge.value = null;
}

function onUpdateConfig(nodeId: string, config: Record<string, any>) {
  const node = graph.nodeMap.value.get(nodeId);
  if (!node) return;
  node.config = { ...config };
}

const viewportRect = computed(() => {
  const el = canvasContainer.value;
  const vp = graph.state.viewport;
  if (!el) return { x: 0, y: 0, w: 1000, h: 600 };
  const w = el.clientWidth / vp.zoom;
  const h = el.clientHeight / vp.zoom;
  const x = -vp.x / vp.zoom;
  const y = -vp.y / vp.zoom;
  return { x, y, w, h };
});

function minimapScreenToWorld(
  e: PointerEvent,
): { worldX: number; worldY: number } | null {
  const target = (e.currentTarget || e.target) as HTMLElement;
  const minimapEl = target.closest(".ew-graph-minimap") as HTMLElement;
  if (!minimapEl) return null;
  const svg = minimapEl.querySelector("svg");
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  const xRatio = (e.clientX - rect.left) / rect.width;
  const yRatio = (e.clientY - rect.top) / rect.height;
  const vb = minimapViewBox.value.split(" ").map(Number);
  return {
    worldX: vb[0] + xRatio * vb[2],
    worldY: vb[1] + yRatio * vb[3],
  };
}

function navigateToWorld(worldX: number, worldY: number) {
  const el = canvasContainer.value;
  if (!el) return;
  const zoom = graph.state.viewport.zoom;
  graph.state.viewport.x = -(worldX * zoom) + el.clientWidth / 2;
  graph.state.viewport.y = -(worldY * zoom) + el.clientHeight / 2;
}

function onMinimapPointerDown(e: PointerEvent) {
  const pos = minimapScreenToWorld(e);
  if (!pos) return;
  navigateToWorld(pos.worldX, pos.worldY);

  const minimapEl = (e.currentTarget as HTMLElement).closest(
    ".ew-graph-minimap",
  ) as HTMLElement;
  if (!minimapEl) return;
  minimapEl.setPointerCapture(e.pointerId);

  const svg = minimapEl.querySelector("svg")!;

  const onMove = (me: PointerEvent) => {
    const rect = svg.getBoundingClientRect();
    const xRatio = (me.clientX - rect.left) / rect.width;
    const yRatio = (me.clientY - rect.top) / rect.height;
    const vb = minimapViewBox.value.split(" ").map(Number);
    navigateToWorld(vb[0] + xRatio * vb[2], vb[1] + yRatio * vb[3]);
  };

  const onUp = () => {
    svg.removeEventListener("pointermove", onMove);
    svg.removeEventListener("pointerup", onUp);
  };

  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);
}

// ── Minimap position (draggable) ──
const minimapPos = ref({ x: 12, y: 90 });

function onMinimapDragStart(e: PointerEvent) {
  e.preventDefault();
  const handle = e.currentTarget as HTMLElement;
  const minimap = handle.closest(".ew-graph-minimap") as HTMLElement;
  if (!minimap) return;

  const container = minimap.parentElement;
  if (!container) return;

  const startX = e.clientX;
  const startY = e.clientY;
  const startRight = minimapPos.value.x;
  const startBottom = minimapPos.value.y;
  const containerRect = container.getBoundingClientRect();

  handle.setPointerCapture(e.pointerId);

  const onMove = (me: PointerEvent) => {
    const dx = me.clientX - startX;
    const dy = me.clientY - startY;
    // right/bottom positioning: moving right on screen decreases 'right', moving down decreases 'bottom'
    minimapPos.value.x = Math.max(
      0,
      Math.min(containerRect.width - 190, startRight - dx),
    );
    minimapPos.value.y = Math.max(
      0,
      Math.min(containerRect.height - 140, startBottom - dy),
    );
  };

  const onUp = () => {
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onUp);
  };

  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
}

// ── Edge position helpers ──

function getNodeColor(nodeId: string): string {
  const node = graph.nodeMap.value.get(nodeId);
  if (!node) return "#6366f1";
  return MODULE_REGISTRY.get(node.moduleId)?.color ?? "#6366f1";
}

function getPortWorldPosition(
  nodeId: string,
  portId: string,
  direction: "in" | "out",
): { x: number; y: number } {
  const node = graph.nodeMap.value.get(nodeId);
  if (!node) return { x: 0, y: 0 };

  const nodeComp = nodeRefs.get(nodeId);
  const screenPos = nodeComp?.getPortCenter?.(portId) as {
    x: number;
    y: number;
  } | null;
  const rect = canvasContainer.value?.getBoundingClientRect();
  if (screenPos && rect) {
    return {
      x:
        (screenPos.x - rect.left - graph.state.viewport.x) /
        graph.state.viewport.zoom,
      y:
        (screenPos.y - rect.top - graph.state.viewport.y) /
        graph.state.viewport.zoom,
    };
  }

  const blueprint = MODULE_REGISTRY.get(node.moduleId);
  const ports =
    blueprint?.ports.filter((port) => port.direction === direction) ?? [];
  const index = Math.max(
    0,
    ports.findIndex((port) => port.id === portId),
  );
  const x = direction === "out" ? node.position.x + 240 : node.position.x;
  const y = node.position.y + 46 + index * 24;
  return { x, y };
}

function getEdgeSourceX(edge: WorkbenchEdge): number {
  return getPortWorldPosition(edge.source, edge.sourcePort, "out").x;
}
function getEdgeSourceY(edge: WorkbenchEdge): number {
  return getPortWorldPosition(edge.source, edge.sourcePort, "out").y;
}
function getEdgeTargetX(edge: WorkbenchEdge): number {
  return getPortWorldPosition(edge.target, edge.targetPort, "in").x;
}
function getEdgeTargetY(edge: WorkbenchEdge): number {
  return getPortWorldPosition(edge.target, edge.targetPort, "in").y;
}

// ── Drag edge path ──

const dragEdgePath = computed(() => {
  if (!dragEdge.value) return "";
  const { startX, startY, currentX, currentY } = dragEdge.value;
  const dx = Math.abs(currentX - startX);
  const cp = Math.max(60, dx * 0.4);
  return `M ${startX} ${startY} C ${startX + cp} ${startY}, ${currentX - cp} ${currentY}, ${currentX} ${currentY}`;
});

// ── Canvas interactions ──

let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let vpStartX = 0;
let vpStartY = 0;

let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let isMarqueeMode = false;
let marqueeOriginX = 0;
let marqueeOriginY = 0;

function onCanvasPointerDown(e: PointerEvent) {
  const isBackground =
    e.target === canvasContainer.value ||
    (e.target as HTMLElement)?.classList?.contains("ew-graph-editor__grid") ||
    (e.target as HTMLElement)?.tagName === "rect" ||
    (e.target as HTMLElement)?.tagName === "pattern" ||
    (e.target as HTMLElement)?.classList?.contains("ew-graph-editor__canvas");

  // Middle button = always pan
  if (e.button === 1) {
    startPan(e);
    return;
  }

  if (e.button === 0 && isBackground) {
    // Clear node selection on background click (unless shift)
    if (!e.shiftKey) {
      selectedNodes.clear();
    }
    selectedEdge.value = null;

    // Start pan immediately, but also start long-press timer for marquee
    startPan(e);

    const sx = e.clientX;
    const sy = e.clientY;

    longPressTimer = setTimeout(() => {
      // Switch from pan to marquee
      isPanning = false;
      isMarqueeMode = true;
      const rect = canvasContainer.value?.getBoundingClientRect();
      if (!rect) return;
      const zoom = graph.state.viewport.zoom;
      marqueeOriginX = (sx - rect.left - graph.state.viewport.x) / zoom;
      marqueeOriginY = (sy - rect.top - graph.state.viewport.y) / zoom;
      marquee.value = {
        x1: marqueeOriginX,
        y1: marqueeOriginY,
        x2: marqueeOriginX,
        y2: marqueeOriginY,
      };
    }, 300);

    // Also listen for move to update marquee
    const onMoveMarquee = (ev: PointerEvent) => {
      if (isMarqueeMode && marquee.value) {
        const rect = canvasContainer.value?.getBoundingClientRect();
        if (!rect) return;
        const zoom = graph.state.viewport.zoom;
        marquee.value.x2 =
          (ev.clientX - rect.left - graph.state.viewport.x) / zoom;
        marquee.value.y2 =
          (ev.clientY - rect.top - graph.state.viewport.y) / zoom;
      }
    };

    const onUpMarquee = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      if (isMarqueeMode && marquee.value) {
        // Hit-test: select nodes inside the marquee rect
        const { x1, y1, x2, y2 } = marquee.value;
        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        const right = Math.max(x1, x2);
        const bottom = Math.max(y1, y2);
        for (const node of graph.state.nodes) {
          const nx = node.position.x;
          const ny = node.position.y;
          const nw = 240; // node width
          const nh = 80; // approximate node height
          // Check overlap
          if (nx + nw > left && nx < right && ny + nh > top && ny < bottom) {
            selectedNodes.add(node.id);
          }
        }
      }
      isMarqueeMode = false;
      marquee.value = null;
      window.removeEventListener("pointermove", onMoveMarquee);
      window.removeEventListener("pointerup", onUpMarquee);
    };

    window.addEventListener("pointermove", onMoveMarquee);
    window.addEventListener("pointerup", onUpMarquee);
  }
}

function startPan(e: PointerEvent) {
  isPanning = true;
  panStartX = e.clientX;
  panStartY = e.clientY;
  vpStartX = graph.state.viewport.x;
  vpStartY = graph.state.viewport.y;

  const onMove = (ev: PointerEvent) => {
    if (!isPanning) return;
    // If we moved far enough, cancel the long-press timer
    const dist =
      Math.abs(ev.clientX - panStartX) + Math.abs(ev.clientY - panStartY);
    if (dist > 5 && longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    graph.panTo(
      vpStartX + ev.clientX - panStartX,
      vpStartY + ev.clientY - panStartY,
    );
  };
  const onUp = () => {
    isPanning = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function onWheel(e: WheelEvent) {
  const delta = e.deltaY > 0 ? -0.08 : 0.08;
  const rect = canvasContainer.value?.getBoundingClientRect();
  if (!rect) return;
  graph.zoomTo(
    graph.state.viewport.zoom + delta,
    e.clientX - rect.left,
    e.clientY - rect.top,
  );
}

function onDblClick() {
  fitView();
}

function zoomIn() {
  graph.zoomTo(graph.state.viewport.zoom + 0.15);
}

function zoomOut() {
  graph.zoomTo(graph.state.viewport.zoom - 0.15);
}

function fitView() {
  const el = canvasContainer.value;
  if (!el) return;
  graph.fitToView(el.clientWidth, el.clientHeight);
}

function scheduleFitView(frames = 2) {
  if (fitViewRaf != null) {
    cancelAnimationFrame(fitViewRaf);
    fitViewRaf = null;
  }

  let remainingFrames = Math.max(1, frames);
  const step = () => {
    remainingFrames -= 1;
    if (remainingFrames > 0) {
      fitViewRaf = requestAnimationFrame(step);
      return;
    }
    fitViewRaf = null;
    fitView();
  };

  fitViewRaf = requestAnimationFrame(step);
}

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value;
}

// ── Auto-layout (simple DAG layered) ──
function autoLayout() {
  pushUndo();
  const nodes = graph.state.nodes;
  const edges = graph.state.edges;
  if (nodes.length === 0) return;

  // Build adjacency
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const n of nodes) {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }
  for (const e of edges) {
    outgoing.get(e.source)?.push(e.target);
    incoming.get(e.source); // ensure entry
    incoming.get(e.target)?.push(e.source);
  }

  // Assign layers via BFS from roots
  const layer = new Map<string, number>();
  const roots = nodes.filter((n) => (incoming.get(n.id)?.length || 0) === 0);
  if (roots.length === 0) roots.push(nodes[0]); // fallback

  const queue: string[] = roots.map((n) => n.id);
  for (const id of queue) layer.set(id, 0);

  while (queue.length > 0) {
    const id = queue.shift()!;
    const l = layer.get(id)!;
    for (const next of outgoing.get(id) || []) {
      const existing = layer.get(next);
      if (existing === undefined || existing < l + 1) {
        layer.set(next, l + 1);
        queue.push(next);
      }
    }
  }

  // Assign layers to disconnected nodes
  for (const n of nodes) {
    if (!layer.has(n.id)) layer.set(n.id, 0);
  }

  // Group nodes by layer
  const layers = new Map<number, string[]>();
  for (const [id, l] of layer) {
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l)!.push(id);
  }

  // Position: horizontal spacing per layer, vertical centering
  const H_GAP = 300;
  const V_GAP = 160;
  const START_X = 60;
  const START_Y = 60;

  for (const [l, ids] of layers) {
    const x = START_X + l * H_GAP;
    for (let i = 0; i < ids.length; i++) {
      const node = nodes.find((n) => n.id === ids[i]);
      if (node) {
        node.position.x = x;
        node.position.y = START_Y + i * V_GAP;
      }
    }
  }

  nextTick(() => fitView());
}

// ── Clipboard (copy/paste) ──
let clipboard: { nodes: any[]; edges: any[] } | null = null;

function copySelectedNodes() {
  if (selectedNodes.size === 0) return;
  const nodeIds = new Set(selectedNodes);
  const copiedNodes = graph.state.nodes
    .filter((n) => nodeIds.has(n.id))
    .map((n) => JSON.parse(JSON.stringify(n)));
  const copiedEdges = graph.state.edges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e) => JSON.parse(JSON.stringify(e)));
  clipboard = { nodes: copiedNodes, edges: copiedEdges };
}

function pasteNodes() {
  if (!clipboard || clipboard.nodes.length === 0) return;
  pushUndo();
  const idMap = new Map<string, string>();
  const OFFSET = 60;

  // Create new IDs and offset positions
  for (const node of clipboard.nodes) {
    const newId = `paste_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    idMap.set(node.id, newId);
  }

  selectedNodes.clear();

  for (const node of clipboard.nodes) {
    const newId = idMap.get(node.id)!;
    const newNode = {
      ...JSON.parse(JSON.stringify(node)),
      id: newId,
      position: { x: node.position.x + OFFSET, y: node.position.y + OFFSET },
    };
    graph.state.nodes.push(newNode);
    selectedNodes.add(newId);
  }

  for (const edge of clipboard.edges) {
    const newSource = idMap.get(edge.source);
    const newTarget = idMap.get(edge.target);
    if (newSource && newTarget) {
      graph.addEdge(newSource, edge.sourcePort, newTarget, edge.targetPort);
    }
  }

  // Update clipboard positions for cascading pastes
  clipboard = {
    nodes: clipboard.nodes.map((n) => ({
      ...n,
      position: { x: n.position.x + OFFSET, y: n.position.y + OFFSET },
    })),
    edges: clipboard.edges,
  };
}

// ── Undo / Redo ──
const MAX_HISTORY = 30;
const undoStack: string[] = [];
const redoStack: string[] = [];

function takeSnapshot(): string {
  return JSON.stringify({ nodes: graph.state.nodes, edges: graph.state.edges });
}

function pushUndo() {
  undoStack.push(takeSnapshot());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0; // Clear redo on new action
}

function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(takeSnapshot());
  const snapshot = JSON.parse(undoStack.pop()!);
  graph.state.nodes = snapshot.nodes;
  graph.state.edges = snapshot.edges;
}

function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(takeSnapshot());
  const snapshot = JSON.parse(redoStack.pop()!);
  graph.state.nodes = snapshot.nodes;
  graph.state.edges = snapshot.edges;
}

function onFullscreenKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && isFullscreen.value) {
    isFullscreen.value = false;
  }
  if (
    (event.key === "Delete" || event.key === "Backspace") &&
    selectedEdge.value
  ) {
    pushUndo();
    graph.removeEdge(selectedEdge.value);
    selectedEdge.value = null;
  }
  // Delete selected nodes
  if (
    (event.key === "Delete" || event.key === "Backspace") &&
    selectedNodes.size > 0 &&
    !selectedEdge.value
  ) {
    pushUndo();
    for (const nodeId of selectedNodes) {
      graph.removeNode(nodeId);
    }
    selectedNodes.clear();
  }
  // Copy
  if ((event.ctrlKey || event.metaKey) && event.key === "c") {
    copySelectedNodes();
  }
  // Paste
  if ((event.ctrlKey || event.metaKey) && event.key === "v") {
    pasteNodes();
  }
  // Undo
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key === "z" &&
    !event.shiftKey
  ) {
    event.preventDefault();
    undo();
  }
  // Redo
  if (
    (event.ctrlKey || event.metaKey) &&
    ((event.key === "z" && event.shiftKey) || event.key === "y")
  ) {
    event.preventDefault();
    redo();
  }
}

// ── Port drag (edge creation) ──

function onPortDragStart(nodeId: string, portId: string, e: PointerEvent) {
  // Determine if we're dragging from an 'in' or 'out' port
  const sourceNode = graph.nodeMap.value.get(nodeId);
  const sourceBp = MODULE_REGISTRY.get(sourceNode?.moduleId ?? "");
  const sourcePortDef = sourceBp?.ports.find((p) => p.id === portId);
  const sourceDir = sourcePortDef?.direction || "out";

  const pos = getPortWorldPosition(nodeId, portId, sourceDir);
  dragEdge.value = {
    sourceNodeId: nodeId,
    sourcePortId: portId,
    startX: pos.x,
    startY: pos.y,
    currentX: pos.x,
    currentY: pos.y,
  };

  const onMove = (ev: PointerEvent) => {
    if (!dragEdge.value) return;
    const rect = canvasContainer.value?.getBoundingClientRect();
    if (!rect) return;
    const zoom = graph.state.viewport.zoom;
    dragEdge.value.currentX =
      (ev.clientX - rect.left - graph.state.viewport.x) / zoom;
    dragEdge.value.currentY =
      (ev.clientY - rect.top - graph.state.viewport.y) / zoom;
  };

  const onUp = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);

    if (!dragEdge.value) return;

    // Hit-test: find the nearest port within 30px
    const dropX = dragEdge.value.currentX;
    const dropY = dragEdge.value.currentY;
    let bestDist = 30; // max snap distance in canvas units
    let targetNodeId: string | null = null;
    let targetPortId: string | null = null;

    for (const node of graph.state.nodes) {
      if (node.id === nodeId) continue; // skip self
      const nodeBp = MODULE_REGISTRY.get(node.moduleId);
      if (!nodeBp) continue;
      for (const port of nodeBp.ports) {
        // Only connect out→in or in→out
        if (port.direction === sourceDir) continue;
        const portPos = getPortWorldPosition(node.id, port.id, port.direction);
        const dx = portPos.x - dropX;
        const dy = portPos.y - dropY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < bestDist) {
          bestDist = dist;
          targetNodeId = node.id;
          targetPortId = port.id;
        }
      }
    }

    if (targetNodeId && targetPortId) {
      pushUndo();
      // Ensure correct direction: always source(out) → target(in)
      if (sourceDir === "out") {
        graph.addEdge(nodeId, portId, targetNodeId, targetPortId);
      } else {
        graph.addEdge(targetNodeId, targetPortId, nodeId, portId);
      }
    }

    dragEdge.value = null;
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

// ── Load graph data from props ──

function loadFromGraph() {
  graph.state.nodes = [];
  graph.state.edges = [];
  graph.state.viewport.x = 0;
  graph.state.viewport.y = 0;
  graph.state.viewport.zoom = 1;

  const boundGraph = props.graph;
  if (!boundGraph) return;

  graph.state.nodes = JSON.parse(JSON.stringify(boundGraph.nodes ?? []));
  graph.state.edges = JSON.parse(JSON.stringify(boundGraph.edges ?? []));
  if (boundGraph.viewport) {
    graph.state.viewport.x = boundGraph.viewport.x;
    graph.state.viewport.y = boundGraph.viewport.y;
    graph.state.viewport.zoom = boundGraph.viewport.zoom;
  }
  nextTick(() => fitView());
}

watch(
  () => props.graph,
  () => {
    if (activeSlotId.value === "overview") {
      loadFromGraph();
    }
  },
  { deep: true, immediate: true },
);

// ── Bidirectional data sync (overview only) ──
let syncTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => [
    graph.state.nodes,
    graph.state.edges,
    graph.state.viewport.x,
    graph.state.viewport.y,
    graph.state.viewport.zoom,
  ],
  () => {
    if (activeSlotId.value !== "overview") return;
    if (!props.graph) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      emit("update:graph", {
        ...props.graph!,
        nodes: JSON.parse(JSON.stringify(graph.state.nodes)),
        edges: JSON.parse(JSON.stringify(graph.state.edges)),
        viewport: { ...graph.state.viewport },
      });
    }, 150);
  },
  { deep: true },
);

// Initialize
onMounted(() => {
  initSlots();
  loadFromGraph();
  containerResizeObserver = new ResizeObserver(() => {
    if (isFullscreen.value) {
      scheduleFitView(2);
    }
  });

  if (canvasContainer.value) {
    containerResizeObserver.observe(canvasContainer.value);
  }

  window.addEventListener("keydown", onFullscreenKeydown);
  window.addEventListener("beforeunload", () => emitSaveSlots());
});

watch(isFullscreen, async (fullscreen) => {
  await nextTick();

  document.body.style.overflow = fullscreen ? "hidden" : "";
  scheduleFitView(fullscreen ? 3 : 2);
});

onUnmounted(() => {
  if (fitViewRaf != null) {
    cancelAnimationFrame(fitViewRaf);
    fitViewRaf = null;
  }
  if (containerResizeObserver) {
    containerResizeObserver.disconnect();
    containerResizeObserver = null;
  }
  document.body.style.overflow = "";
  emitSaveSlots();
  window.removeEventListener("keydown", onFullscreenKeydown);
});
</script>

<style scoped>
.ew-graph-root {
  display: flex;
  width: 100%;
  height: 500px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition:
    border-radius 0.22s cubic-bezier(0.25, 1, 0.5, 1),
    box-shadow 0.22s cubic-bezier(0.25, 1, 0.5, 1),
    border-color 0.22s cubic-bezier(0.25, 1, 0.5, 1);
}

.ew-graph-root.is-fullscreen {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  border-radius: 0;
  z-index: 99999;
  box-shadow: none;
  border: none;
}

.ew-graph-editor {
  position: relative;
  flex: 1;
  overflow: hidden;
  background: radial-gradient(
    ellipse at center,
    rgba(15, 15, 30, 0.95),
    rgba(5, 5, 15, 0.98)
  );
  cursor: grab;
}

.ew-graph-editor:active {
  cursor: grabbing;
}

.ew-graph-editor__grid {
  pointer-events: none;
}

.ew-graph-editor__canvas {
  position: absolute;
  top: 0;
  left: 0;
  will-change: transform;
}

.ew-graph-editor__edges {
  pointer-events: none;
}

.ew-graph-editor__edges :deep(path) {
  pointer-events: stroke;
}

.ew-graph-editor__drag-edge {
  pointer-events: none;
}

.ew-graph-editor__toolbar {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(20, 20, 35, 0.85);
  backdrop-filter: blur(12px);
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  z-index: 10;
}

.ew-graph-editor__toolbar button {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.ew-graph-editor__toolbar button:hover {
  background: rgba(255, 255, 255, 0.2);
  color: white;
}

.ew-graph-editor__zoom-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  min-width: 40px;
  text-align: center;
}

/* ── Context menu ── */
.ew-graph-ctx {
  position: absolute;
  display: flex;
  flex-direction: column;
  min-width: 120px;
  background: rgba(20, 20, 35, 0.92);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  padding: 4px;
  z-index: 100;
  animation: ew-ctx-in 0.12s ease-out;
}

@keyframes ew-ctx-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.ew-graph-ctx button {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.85);
  font-size: 13px;
  padding: 8px 12px;
  text-align: left;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.1s;
}

.ew-graph-ctx button:hover {
  background: rgba(255, 255, 255, 0.1);
}

.ew-graph-ctx-overlay {
  position: absolute;
  inset: 0;
  z-index: 99;
}

.ew-graph-editor__marquee {
  position: absolute;
  border: 1.5px dashed rgba(100, 160, 255, 0.7);
  background: rgba(100, 160, 255, 0.08);
  border-radius: 3px;
  pointer-events: none;
  z-index: 50;
}

.ew-graph-editor__slots {
  position: absolute;
  bottom: 44px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 2px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
  padding: 3px 4px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  z-index: 40;
}

.ew-graph-editor__slot-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.ew-graph-editor__slot-tab:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
}

.ew-graph-editor__slot-tab.is-active {
  background: rgba(99, 102, 241, 0.25);
  color: rgba(255, 255, 255, 0.95);
  font-weight: 600;
  box-shadow: 0 0 8px rgba(99, 102, 241, 0.15);
}

.ew-graph-editor__slot-close {
  font-size: 12px;
  line-height: 1;
  opacity: 0.4;
  cursor: pointer;
  padding: 0 2px;
  border-radius: 3px;
}

.ew-graph-editor__slot-close:hover {
  opacity: 1;
  background: rgba(255, 70, 70, 0.3);
}

.ew-graph-editor__slot-add {
  width: 24px;
  height: 24px;
  border-radius: 5px;
  border: 1px dashed rgba(255, 255, 255, 0.15);
  background: transparent;
  color: rgba(255, 255, 255, 0.4);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.ew-graph-editor__slot-add:hover {
  border-color: rgba(255, 255, 255, 0.3);
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.06);
}

.ew-graph-editor__toolbar-sep {
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.15);
  margin: 0 2px;
}

.ew-graph-minimap {
  position: absolute;
  width: 180px;
  height: 140px;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 35;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.ew-graph-minimap:hover {
  border-color: rgba(255, 255, 255, 0.2);
}

.ew-graph-minimap__handle {
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  color: rgba(255, 255, 255, 0.3);
  font-size: 10px;
  letter-spacing: 2px;
  flex-shrink: 0;
  user-select: none;
}

.ew-graph-minimap__handle:hover {
  color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.05);
}

.ew-graph-minimap__handle:active {
  cursor: grabbing;
}

.ew-graph-minimap svg {
  flex: 1;
  min-height: 0;
  cursor: crosshair;
}
</style>
