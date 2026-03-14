<template>
  <div
    class="ew-graph-editor"
    ref="canvasContainer"
    @pointerdown="onCanvasPointerDown"
    @wheel.prevent="onWheel"
    @dblclick="onDblClick"
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
            :cx="20 * graph.state.viewport.zoom / 2"
            :cy="20 * graph.state.viewport.zoom / 2"
            :r="1 * graph.state.viewport.zoom"
            fill="rgba(255, 255, 255, 0.12)"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#ew-grid-dots)" />
    </svg>

    <!-- Canvas transform wrapper -->
    <div
      class="ew-graph-editor__canvas"
      :style="canvasStyle"
    >
      <!-- SVG layer for edges -->
      <svg class="ew-graph-editor__edges" style="position:absolute;top:0;left:0;width:1px;height:1px;overflow:visible">
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
      <button type="button" @click="addTestNodes" title="测试节点">＋</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { createGraphState } from './graph-state';
import { NODE_TYPE_REGISTRY } from './graph-types';
import type { GraphEdge } from './graph-types';
import EwGraphNode from './EwGraphNode.vue';
import EwGraphEdge from './EwGraphEdge.vue';

const canvasContainer = ref<HTMLElement>();
const graph = createGraphState();
const selectedEdge = ref<string | null>(null);
const nodeRefs = new Map<string, any>();

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
  transformOrigin: '0 0',
}));

const gridStyle = computed(() => ({
  position: 'absolute' as const,
  top: '0',
  left: '0',
  width: '100%',
  height: '100%',
  pointerEvents: 'none' as const,
}));

const zoomPercent = computed(() => Math.round(graph.state.viewport.zoom * 100));

// ── Edge position helpers ──

function getNodeColor(nodeId: string): string {
  const node = graph.nodeMap.value.get(nodeId);
  if (!node) return '#6366f1';
  return NODE_TYPE_REGISTRY[node.type]?.color || '#6366f1';
}

function getPortWorldPosition(nodeId: string, portId: string, direction: 'in' | 'out'): { x: number; y: number } {
  const node = graph.nodeMap.value.get(nodeId);
  if (!node) return { x: 0, y: 0 };
  // Approximate: in ports on left, out ports on right
  const x = direction === 'out' ? node.position.x + 240 : node.position.x;
  const y = node.position.y + 40; // middle-ish
  return { x, y };
}

function getEdgeSourceX(edge: GraphEdge): number {
  return getPortWorldPosition(edge.source, edge.sourcePort, 'out').x;
}
function getEdgeSourceY(edge: GraphEdge): number {
  return getPortWorldPosition(edge.source, edge.sourcePort, 'out').y;
}
function getEdgeTargetX(edge: GraphEdge): number {
  return getPortWorldPosition(edge.target, edge.targetPort, 'in').x;
}
function getEdgeTargetY(edge: GraphEdge): number {
  return getPortWorldPosition(edge.target, edge.targetPort, 'in').y;
}

// ── Drag edge path ──

const dragEdgePath = computed(() => {
  if (!dragEdge.value) return '';
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
  if (e.button === 1 || (e.button === 0 && e.target === canvasContainer.value)) {
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    vpStartX = graph.state.viewport.x;
    vpStartY = graph.state.viewport.y;

    const onMove = (ev: PointerEvent) => {
      if (!isPanning) return;
      graph.panTo(vpStartX + ev.clientX - panStartX, vpStartY + ev.clientY - panStartY);
    };
    const onUp = () => {
      isPanning = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // Deselect edge on background click
  if (e.target === canvasContainer.value || (e.target as HTMLElement)?.classList?.contains('ew-graph-editor__canvas')) {
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

// ── Port drag (edge creation) ──

function onPortDragStart(nodeId: string, portId: string, e: PointerEvent) {
  const pos = getPortWorldPosition(nodeId, portId, 'out');
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
    dragEdge.value.currentX = (ev.clientX - rect.left - graph.state.viewport.x) / zoom;
    dragEdge.value.currentY = (ev.clientY - rect.top - graph.state.viewport.y) / zoom;
  };

  const onUp = () => {
    dragEdge.value = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// ── Test data ──

function addTestNodes() {
  // Clear existing
  graph.state.nodes = [];
  graph.state.edges = [];

  const entry = graph.addNode('flow_entry', 50, 100);
  const gen = graph.addNode('generation_params', 380, 50);
  const behavior = graph.addNode('behavior_params', 380, 220);
  const prompt = graph.addNode('prompt_ordering', 710, 100);
  const ctx = graph.addNode('context_rules', 1040, 100);
  const req = graph.addNode('request_builder', 1370, 50);
  const resp = graph.addNode('response_processor', 1370, 250);

  graph.addEdge(entry.id, 'out', gen.id, 'in');
  graph.addEdge(entry.id, 'out', behavior.id, 'in');
  graph.addEdge(gen.id, 'out', prompt.id, 'in');
  graph.addEdge(prompt.id, 'out', ctx.id, 'in');
  graph.addEdge(ctx.id, 'out', req.id, 'in');
  graph.addEdge(req.id, 'out', resp.id, 'in');

  nextTick(() => fitView());
}

// Initialize with test nodes
onMounted(() => {
  addTestNodes();
});
</script>

<style scoped>
.ew-graph-editor {
  position: relative;
  width: 100%;
  height: 500px;
  overflow: hidden;
  background: radial-gradient(ellipse at center, rgba(15, 15, 30, 0.95), rgba(5, 5, 15, 0.98));
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
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

/* Node type label (placeholder for Phase 1) */
.ew-graph-node__type-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  font-family: monospace;
}
</style>
