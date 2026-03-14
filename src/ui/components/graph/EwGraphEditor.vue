<template>
  <Teleport to="body" :disabled="!isFullscreen">
    <div
      class="ew-graph-editor"
      :class="{ 'is-fullscreen': isFullscreen }"
      ref="canvasContainer"
      @pointerdown="onCanvasPointerDown"
      @wheel.prevent="onWheel"
      @dblclick="onDblClick"
      @contextmenu.prevent="onCanvasContextMenu"
      @touchstart.passive="onTouchStart"
      @touchmove.prevent="onTouchMove"
      @touchend="onTouchEnd"
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

        <!-- Nodes -->
        <EwGraphNode
          v-for="node in graph.state.nodes"
          :key="node.id"
          :ref="(el: any) => registerNodeRef(node.id, el)"
          :node="node"
          :edges="graph.state.edges"
          :zoom="graph.state.viewport.zoom"
          @move="graph.moveNode"
          @toggle-collapse="graph.toggleCollapse(node.id)"
          @port-drag-start="onPortDragStart"
          @contextmenu.stop.prevent="onNodeContextMenu(node.id, $event)"
        >
          <div class="ew-graph-node__type-label">{{ node.type }}</div>
        </EwGraphNode>
      </div>

      <!-- Toolbar -->
      <div class="ew-graph-editor__toolbar">
        <button type="button" @click="zoomIn" title="放大">+</button>
        <span class="ew-graph-editor__zoom-label">{{ zoomPercent }}%</span>
        <button type="button" @click="zoomOut" title="缩小">−</button>
        <button type="button" @click="fitView" title="适配">⊞</button>
        <button type="button" @click="addTestNodes" title="重置测试节点">
          ↻
        </button>
        <button
          type="button"
          @click="toggleFullscreen"
          :title="isFullscreen ? '退出全屏' : '全屏'"
        >
          {{ isFullscreen ? "⛶" : "⛶" }}
        </button>
      </div>

      <!-- Context menu -->
      <div
        v-if="ctxMenu"
        class="ew-graph-ctx"
        :style="{ top: ctxMenu.y + 'px', left: ctxMenu.x + 'px' }"
      >
        <button v-if="ctxMenu.edgeId" @click="deleteEdge(ctxMenu.edgeId)">🗑 删除连线</button>
        <button v-if="ctxMenu.nodeId" @click="deleteNode(ctxMenu.nodeId)">🗑 删除节点</button>
        <button @click="ctxMenu = null">✕ 取消</button>
      </div>
      <!-- Click-away overlay -->
      <div v-if="ctxMenu" class="ew-graph-ctx-overlay" @pointerdown="ctxMenu = null" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import EwGraphEdge from "./EwGraphEdge.vue";
import EwGraphNode from "./EwGraphNode.vue";
import { createGraphState } from "./graph-state";
import type { GraphEdge } from "./graph-types";
import { NODE_TYPE_REGISTRY } from "./graph-types";

const canvasContainer = ref<HTMLElement>();
const graph = createGraphState();
const selectedEdge = ref<string | null>(null);
const isFullscreen = ref(false);

// ── Context menu ──
const ctxMenu = ref<{ x: number; y: number; edgeId?: string; nodeId?: string } | null>(null);

function onEdgeContextMenu(edgeId: string, event: MouseEvent) {
  const rect = canvasContainer.value?.getBoundingClientRect();
  if (!rect) return;
  ctxMenu.value = { x: event.clientX - rect.left, y: event.clientY - rect.top, edgeId };
}

function onNodeContextMenu(nodeId: string, event: MouseEvent) {
  const rect = canvasContainer.value?.getBoundingClientRect();
  if (!rect) return;
  ctxMenu.value = { x: event.clientX - rect.left, y: event.clientY - rect.top, nodeId };
}

function onCanvasContextMenu(event: MouseEvent) {
  // Only show if we right-clicked on the blank canvas itself
  ctxMenu.value = null;
}

function deleteEdge(edgeId: string) {
  graph.removeEdge(edgeId);
  selectedEdge.value = null;
  ctxMenu.value = null;
}

function deleteNode(nodeId: string) {
  graph.removeNode(nodeId);
  ctxMenu.value = null;
}

// ── Touch (mobile) ──
let touchPanState: { startX: number; startY: number; vpX: number; vpY: number } | null = null;
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

// ── Edge position helpers ──

function getNodeColor(nodeId: string): string {
  const node = graph.nodeMap.value.get(nodeId);
  if (!node) return "#6366f1";
  return NODE_TYPE_REGISTRY[node.type]?.color || "#6366f1";
}

function getPortWorldPosition(
  nodeId: string,
  portId: string,
  direction: "in" | "out",
): { x: number; y: number } {
  const node = graph.nodeMap.value.get(nodeId);
  if (!node) return { x: 0, y: 0 };
  // Approximate: in ports on left, out ports on right
  const x = direction === "out" ? node.position.x + 240 : node.position.x;
  const y = node.position.y + 40; // middle-ish
  return { x, y };
}

function getEdgeSourceX(edge: GraphEdge): number {
  return getPortWorldPosition(edge.source, edge.sourcePort, "out").x;
}
function getEdgeSourceY(edge: GraphEdge): number {
  return getPortWorldPosition(edge.source, edge.sourcePort, "out").y;
}
function getEdgeTargetX(edge: GraphEdge): number {
  return getPortWorldPosition(edge.target, edge.targetPort, "in").x;
}
function getEdgeTargetY(edge: GraphEdge): number {
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

function onCanvasPointerDown(e: PointerEvent) {
  // Middle button or space+left for panning
  if (
    e.button === 1 ||
    (e.button === 0 && e.target === canvasContainer.value)
  ) {
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    vpStartX = graph.state.viewport.x;
    vpStartY = graph.state.viewport.y;

    const onMove = (ev: PointerEvent) => {
      if (!isPanning) return;
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

  // Deselect edge on background click
  if (
    e.target === canvasContainer.value ||
    (e.target as HTMLElement)?.classList?.contains("ew-graph-editor__canvas")
  ) {
    selectedEdge.value = null;
  }
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

function onFullscreenKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && isFullscreen.value) {
    isFullscreen.value = false;
  }
  if ((event.key === "Delete" || event.key === "Backspace") && selectedEdge.value) {
    graph.removeEdge(selectedEdge.value);
    selectedEdge.value = null;
  }
}

// ── Port drag (edge creation) ──

function onPortDragStart(nodeId: string, portId: string, e: PointerEvent) {
  // Determine if we're dragging from an 'in' or 'out' port
  const sourceNode = graph.nodeMap.value.get(nodeId);
  const sourcePortDef = sourceNode?.ports.find((p: any) => p.id === portId);
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
      for (const port of node.ports) {
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

// ── Test data ──

function addTestNodes() {
  // Clear existing
  graph.state.nodes = [];
  graph.state.edges = [];

  const entry = graph.addNode("flow_entry", 50, 100);
  const gen = graph.addNode("generation_params", 380, 50);
  const behavior = graph.addNode("behavior_params", 380, 220);
  const prompt = graph.addNode("prompt_ordering", 710, 100);
  const ctx = graph.addNode("context_rules", 1040, 100);
  const req = graph.addNode("request_builder", 1370, 50);
  const resp = graph.addNode("response_processor", 1370, 250);

  graph.addEdge(entry.id, "out", gen.id, "in");
  graph.addEdge(entry.id, "out", behavior.id, "in");
  graph.addEdge(gen.id, "out", prompt.id, "in");
  graph.addEdge(prompt.id, "out", ctx.id, "in");
  graph.addEdge(ctx.id, "out", req.id, "in");
  graph.addEdge(req.id, "out", resp.id, "in");

  nextTick(() => fitView());
}

// Initialize with test nodes
onMounted(() => {
  addTestNodes();
  containerResizeObserver = new ResizeObserver(() => {
    if (isFullscreen.value) {
      scheduleFitView(2);
    }
  });

  if (canvasContainer.value) {
    containerResizeObserver.observe(canvasContainer.value);
  }

  window.addEventListener("keydown", onFullscreenKeydown);
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
  window.removeEventListener("keydown", onFullscreenKeydown);
});
</script>

<style scoped>
.ew-graph-editor {
  position: relative;
  width: 100%;
  height: 500px;
  overflow: hidden;
  background: radial-gradient(
    ellipse at center,
    rgba(15, 15, 30, 0.95),
    rgba(5, 5, 15, 0.98)
  );
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  cursor: grab;
  transition:
    border-radius 0.22s cubic-bezier(0.25, 1, 0.5, 1),
    box-shadow 0.22s cubic-bezier(0.25, 1, 0.5, 1),
    border-color 0.22s cubic-bezier(0.25, 1, 0.5, 1);
}

.ew-graph-editor.is-fullscreen {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  border-radius: 0;
  z-index: 99999;
  box-shadow: none;
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

/* Node type label (placeholder for Phase 1) */
.ew-graph-node__type-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  font-family: monospace;
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
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
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
</style>
