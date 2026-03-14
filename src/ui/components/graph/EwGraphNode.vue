<template>
  <div
    class="ew-graph-node"
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
        <slot />
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
import type { GraphNode, GraphEdge, PortDefinition } from './graph-types';
import { NODE_TYPE_REGISTRY } from './graph-types';
import EwGraphPort from './EwGraphPort.vue';

const props = defineProps<{
  node: GraphNode;
  edges: GraphEdge[];
  zoom: number;
}>();

const emit = defineEmits<{
  (e: 'move', nodeId: string, x: number, y: number): void;
  (e: 'toggle-collapse'): void;
  (e: 'port-drag-start', nodeId: string, portId: string, event: PointerEvent): void;
}>();

const nodeEl = ref<HTMLElement>();
const portRefs = new Map<string, any>();

function registerPortRef(portId: string, comp: any) {
  if (comp) portRefs.set(portId, comp);
}

const nodeInfo = computed(() => NODE_TYPE_REGISTRY[props.node.type]);

const inPorts = computed(() =>
  props.node.ports.filter((p: PortDefinition) => p.direction === 'in')
);

const outPorts = computed(() =>
  props.node.ports.filter((p: PortDefinition) => p.direction === 'out')
);

const nodeStyle = computed(() => ({
  transform: `translate(${props.node.position.x}px, ${props.node.position.y}px)`,
  '--node-color': nodeInfo.value.color,
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
}

.ew-graph-node[data-collapsed="1"] .ew-graph-node__ports {
  padding: 6px;
}
</style>
