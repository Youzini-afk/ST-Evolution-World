<template>
  <div
    class="ew-graph-node"
    :class="{ 'is-selected': selected }"
    :style="nodeStyle"
    :data-type="node.type"
    :data-collapsed="node.collapsed ? '1' : '0'"
    ref="nodeEl"
  >
    <!-- Header (draggable) -->
    <header
      class="ew-graph-node__header"
      @pointerdown.stop="onHeaderPointerDown"
    >
      <span class="ew-graph-node__icon">{{ nodeInfo.icon }}</span>
      <span class="ew-graph-node__title">{{ node.label }}</span>
      <button
        type="button"
        class="ew-graph-node__collapse"
        @click.stop="$emit('toggle-collapse')"
      >
        {{ node.collapsed ? '▶' : '▼' }}
      </button>
    </header>

    <!-- Ports -->
    <div class="ew-graph-node__ports">
      <div class="ew-graph-node__ports-in">
        <EwGraphPort
          v-for="port in inPorts"
          :key="port.id"
          :ref="(el: any) => registerPortRef(port.id, el)"
          :port="port"
          :connected="isPortConnected(port.id)"
          @drag-start="$emit('port-drag-start', node.id, port.id, $event)"
        />
      </div>

      <!-- Body (collapsed hides content) -->
      <div v-if="!node.collapsed" class="ew-graph-node__body">
        <component :is="contentComponent" v-if="contentComponent" :data="node.data" />
        <slot v-else />
      </div>

      <div class="ew-graph-node__ports-out">
        <EwGraphPort
          v-for="port in outPorts"
          :key="port.id"
          :ref="(el: any) => registerPortRef(port.id, el)"
          :port="port"
          :connected="isPortConnected(port.id)"
          @drag-start="$emit('port-drag-start', node.id, port.id, $event)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GraphNode, GraphEdge, PortDefinition, NodeType } from './graph-types';
import { NODE_TYPE_REGISTRY } from './graph-types';
import EwGraphPort from './EwGraphPort.vue';
import { markRaw } from 'vue';
import FlowEntryNode from './nodes/FlowEntryNode.vue';
import GenerationNode from './nodes/GenerationNode.vue';
import BehaviorNode from './nodes/BehaviorNode.vue';
import PromptOrderNode from './nodes/PromptOrderNode.vue';
import ContextRulesNode from './nodes/ContextRulesNode.vue';
import RequestBuilderNode from './nodes/RequestBuilderNode.vue';
import ResponseNode from './nodes/ResponseNode.vue';
import WorldbookOutputNode from './nodes/WorldbookOutputNode.vue';

const NODE_CONTENT_MAP: Record<string, any> = {
  flow_entry: markRaw(FlowEntryNode),
  generation_params: markRaw(GenerationNode),
  behavior_params: markRaw(BehaviorNode),
  prompt_ordering: markRaw(PromptOrderNode),
  context_rules: markRaw(ContextRulesNode),
  request_builder: markRaw(RequestBuilderNode),
  response_processor: markRaw(ResponseNode),
  worldbook_output: markRaw(WorldbookOutputNode),
};

const props = defineProps<{
  node: GraphNode;
  edges: GraphEdge[];
  zoom: number;
  selected?: boolean;
  selectedNodes?: Set<string>;
  zIndex?: number;
}>();

const emit = defineEmits<{
  (e: 'move', nodeId: string, x: number, y: number): void;
  (e: 'group-move', dx: number, dy: number): void;
  (e: 'toggle-collapse'): void;
  (e: 'port-drag-start', nodeId: string, portId: string, event: PointerEvent): void;
  (e: 'bring-to-front'): void;
}>();

const nodeEl = ref<HTMLElement>();
const portRefs = new Map<string, any>();

function registerPortRef(portId: string, comp: any) {
  if (comp) portRefs.set(portId, comp);
}

const nodeInfo = computed(() => NODE_TYPE_REGISTRY[props.node.type]);
const contentComponent = computed(() => NODE_CONTENT_MAP[props.node.type] || null);

const inPorts = computed(() =>
  props.node.ports.filter((p: PortDefinition) => p.direction === 'in')
);

const outPorts = computed(() =>
  props.node.ports.filter((p: PortDefinition) => p.direction === 'out')
);

const nodeStyle = computed(() => ({
  transform: `translate(${props.node.position.x}px, ${props.node.position.y}px)`,
  '--node-color': nodeInfo.value.color,
  zIndex: props.zIndex ?? 1,
}));

function isPortConnected(portId: string): boolean {
  return props.edges.some(
    e =>
      (e.source === props.node.id && e.sourcePort === portId) ||
      (e.target === props.node.id && e.targetPort === portId)
  );
}

// ── Drag handling ──
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let nodeStartX = 0;
let nodeStartY = 0;

function onHeaderPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  emit('bring-to-front');
  isDragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  nodeStartX = props.node.position.x;
  nodeStartY = props.node.position.y;

  const onMove = (ev: PointerEvent) => {
    if (!isDragging) return;
    const dx = (ev.clientX - dragStartX) / props.zoom;
    const dy = (ev.clientY - dragStartY) / props.zoom;
    emit('move', props.node.id, nodeStartX + dx, nodeStartY + dy);
  };

  const onUp = () => {
    isDragging = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/** Get the center position of a port in canvas coordinates */
function getPortCenter(portId: string): { x: number; y: number } | null {
  const comp = portRefs.get(portId);
  const dot = comp?.portEl?.querySelector('.ew-graph-port__dot') as HTMLElement | null;
  if (!dot) return null;
  const rect = dot.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

defineExpose({ nodeEl, getPortCenter });
</script>

<style scoped>
.ew-graph-node {
  position: absolute;
  top: 0;
  left: 0;
  width: 240px;
  min-height: 60px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--node-color, #6366f1) 8%, rgba(20, 20, 30, 0.85));
  border: 1px solid color-mix(in srgb, var(--node-color, #6366f1) 30%, transparent);
  backdrop-filter: blur(12px);
  box-shadow:
    0 4px 24px rgba(0, 0, 0, 0.3),
    0 0 0 1px rgba(255, 255, 255, 0.06) inset;
  cursor: default;
  user-select: none;
  transition: box-shadow 0.2s ease;
}

.ew-graph-node.is-selected {
  box-shadow:
    0 4px 24px rgba(0, 0, 0, 0.3),
    0 0 0 2px rgba(100, 160, 255, 0.6),
    0 0 16px rgba(100, 160, 255, 0.15);
}

.ew-graph-node:hover {
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.4),
    0 0 16px color-mix(in srgb, var(--node-color, #6366f1) 20%, transparent),
    0 0 0 1px rgba(255, 255, 255, 0.1) inset;
}

.ew-graph-node__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  cursor: grab;
  border-radius: 12px 12px 0 0;
  background: color-mix(in srgb, var(--node-color, #6366f1) 15%, transparent);
}

.ew-graph-node__header:active {
  cursor: grabbing;
}

.ew-graph-node__icon {
  font-size: 16px;
  flex-shrink: 0;
}

.ew-graph-node__title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ew-graph-node__collapse {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 10px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
}

.ew-graph-node__collapse:hover {
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.1);
}

.ew-graph-node__ports {
  display: flex;
  justify-content: space-between;
  padding: 4px 6px;
}

.ew-graph-node__ports-in,
.ew-graph-node__ports-out {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ew-graph-node__body {
  padding: 8px 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  overflow: hidden;
  min-width: 0;
}

.ew-graph-node[data-collapsed="1"] .ew-graph-node__ports {
  padding: 6px;
}

/* ── Shared node field styles ── */
:deep(.node-fields) {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

:deep(.node-field) {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

:deep(.node-field--row) {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

:deep(.node-field label) {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

:deep(.node-field__val) {
  float: right;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 600;
}

:deep(.node-field input[type="text"]),
:deep(.node-field input[type="number"]),
:deep(.node-field input:not([type])),
:deep(.node-field select),
:deep(.node-field textarea) {
  width: 100%;
  padding: 4px 6px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.3);
  color: rgba(255, 255, 255, 0.85);
  font-size: 11px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

:deep(.node-field input:focus),
:deep(.node-field select:focus),
:deep(.node-field textarea:focus) {
  border-color: rgba(255, 255, 255, 0.3);
}

:deep(.node-field textarea) {
  resize: vertical;
  min-height: 40px;
  line-height: 1.4;
}

:deep(.node-field input[type="range"]) {
  width: 100%;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
  outline: none;
  border: none;
}

:deep(.node-field input[type="range"]::-webkit-slider-thumb) {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--node-color, #6366f1);
  cursor: pointer;
}

:deep(.node-field input[type="checkbox"]) {
  width: 14px;
  height: 14px;
  accent-color: var(--node-color, #6366f1);
}

:deep(.node-field__list-header) {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  padding-bottom: 2px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

:deep(.node-field__list-item) {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.65);
  padding: 1px 0;
  min-width: 0;
}

:deep(.node-field__list-dot) {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--node-color, #6366f1);
  flex-shrink: 0;
}

:deep(.node-field__list-text) {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.node-field__list-role) {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.4);
  flex-shrink: 0;
  white-space: nowrap;
}

:deep(.node-field__empty) {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.25);
  font-style: italic;
  text-align: center;
  padding: 4px;
}
</style>
