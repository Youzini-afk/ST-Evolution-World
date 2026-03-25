<template>
  <div
    class="ew-graph-node"
    :class="{ 'is-selected': selected }"
    :style="nodeStyle"
    :data-collapsed="node.collapsed ? '1' : '0'"
    ref="nodeEl"
    @pointerdown="emit('bring-to-front')"
  >
    <!-- Header (draggable) -->
    <header
      class="ew-graph-node__header"
      @pointerdown.stop="onHeaderPointerDown"
    >
      <span class="ew-graph-node__icon">{{ blueprint?.icon ?? "?" }}</span>
      <div class="ew-graph-node__title-stack">
        <span class="ew-graph-node__title">{{
          node.config?._label ?? blueprint?.label ?? node.moduleId
        }}</span>
        <div class="ew-graph-node__meta">
          <span class="ew-graph-node__category">
            {{ categoryVisual.icon }} {{ categoryVisual.label }}
          </span>
          <span class="ew-graph-node__module-id">{{ node.moduleId }}</span>
        </div>
      </div>
      <button
        type="button"
        class="ew-graph-node__collapse"
        @click.stop="$emit('toggle-collapse')"
      >
        {{ node.collapsed ? "▶" : "▼" }}
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
        <div class="ew-graph-node__summary">
          {{ summaryText }}
        </div>
        <div class="ew-graph-node__body-meta">
          <span>入 {{ inPorts.length }} · 出 {{ outPorts.length }}</span>
          <span v-if="visibleConfigCount > 0">参数 {{ visibleConfigCount }}</span>
        </div>
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
import EwGraphPort from "./EwGraphPort.vue";
import { getModuleCategoryVisual } from "./graph-visuals";
import { MODULE_REGISTRY } from "./module-registry";
import type {
  ModulePortDef,
  WorkbenchEdge,
  WorkbenchNode,
} from "./module-types";

const props = defineProps<{
  node: WorkbenchNode;
  edges: WorkbenchEdge[];
  zoom: number;
  selected?: boolean;
  selectedNodes?: Set<string>;
  zIndex?: number;
  showHiddenPorts?: boolean;
}>();

const emit = defineEmits<{
  (e: "move", nodeId: string, x: number, y: number): void;
  (e: "group-move", dx: number, dy: number): void;
  (e: "toggle-collapse"): void;
  (
    e: "port-drag-start",
    nodeId: string,
    portId: string,
    event: PointerEvent,
  ): void;
  (e: "bring-to-front"): void;
  (e: "select", nodeId: string, shiftKey: boolean): void;
}>();

const nodeEl = ref<HTMLElement>();
const portRefs = new Map<string, any>();

function registerPortRef(portId: string, comp: any) {
  if (comp) portRefs.set(portId, comp);
}

const blueprint = computed(
  () => MODULE_REGISTRY.get(props.node.moduleId) ?? null,
);

const categoryVisual = computed(() =>
  getModuleCategoryVisual(blueprint.value?.category ?? "config"),
);

const summaryText = computed(() => {
  const configEntries = Object.entries(props.node.config ?? {})
    .filter(
      ([key, value]) =>
        !key.startsWith("_") &&
        value !== "" &&
        value !== null &&
        value !== undefined,
    )
    .slice(0, 2)
    .map(([key, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return `${key}: ${text}`;
    });

  if (configEntries.length > 0) {
    return configEntries.join(" · ");
  }

  return blueprint.value?.description ?? "在右侧属性面板中配置此模块";
});

const visibleConfigCount = computed(() =>
  Object.entries(props.node.config ?? {}).filter(
    ([key, value]) =>
      !key.startsWith("_") &&
      value !== "" &&
      value !== null &&
      value !== undefined,
  ).length,
);

function shouldRenderPort(port: ModulePortDef): boolean {
  return !port.uiHidden || props.showHiddenPorts || isPortConnected(port.id);
}

const inPorts = computed(() =>
  (blueprint.value?.ports ?? []).filter(
    (p: ModulePortDef) => p.direction === "in" && shouldRenderPort(p),
  ),
);

const outPorts = computed(() =>
  (blueprint.value?.ports ?? []).filter(
    (p: ModulePortDef) => p.direction === "out" && shouldRenderPort(p),
  ),
);

const nodeStyle = computed(() => ({
  transform: `translate3d(${Math.round(props.node.position.x)}px, ${Math.round(props.node.position.y)}px, 0)`,
  "--node-color": blueprint.value?.color ?? "#6366f1",
  zIndex: props.zIndex ?? 1,
}));

function isPortConnected(portId: string): boolean {
  return props.edges.some(
    (e) =>
      (e.source === props.node.id && e.sourcePort === portId) ||
      (e.target === props.node.id && e.targetPort === portId),
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
  emit("bring-to-front");
  isDragging = true;
  let didMove = false;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  nodeStartX = props.node.position.x;
  nodeStartY = props.node.position.y;
  const shiftKey = e.shiftKey;

  const onMove = (ev: PointerEvent) => {
    if (!isDragging) return;
    const dx = (ev.clientX - dragStartX) / props.zoom;
    const dy = (ev.clientY - dragStartY) / props.zoom;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didMove = true;
    emit("move", props.node.id, nodeStartX + dx, nodeStartY + dy);
  };

  const onUp = () => {
    isDragging = false;
    // If the pointer didn't move, treat as click → select
    if (!didMove) {
      emit("select", props.node.id, shiftKey);
    }
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

/** Get the center position of a port in canvas coordinates */
function getPortCenter(portId: string): { x: number; y: number } | null {
  const comp = portRefs.get(portId);
  const dot = comp?.portEl?.querySelector(
    ".ew-graph-port__dot",
  ) as HTMLElement | null;
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
  width: 280px;
  min-height: 68px;
  border-radius: 16px;
  background: color-mix(
    in srgb,
    var(--node-color, #6366f1) 12%,
    rgba(14, 18, 28, 0.96)
  );
  border: 1px solid
    color-mix(in srgb, var(--node-color, #6366f1) 34%, transparent);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow:
    0 14px 38px rgba(0, 0, 0, 0.34),
    0 0 0 1px rgba(255, 255, 255, 0.06) inset;
  cursor: default;
  user-select: none;
  transition:
    box-shadow 0.2s ease,
    border-color 0.2s ease,
    transform 0.2s ease;
  will-change: transform;
  transform: translateZ(0);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

.ew-graph-node.is-selected {
  box-shadow:
    0 18px 42px rgba(0, 0, 0, 0.38),
    0 0 0 1px color-mix(in srgb, var(--node-color, #6366f1) 58%, white 20%),
    0 0 0 3px color-mix(in srgb, var(--node-color, #6366f1) 20%, transparent),
    0 0 22px color-mix(in srgb, var(--node-color, #6366f1) 22%, transparent);
}

.ew-graph-node:hover {
  box-shadow:
    0 18px 40px rgba(0, 0, 0, 0.4),
    0 0 18px color-mix(in srgb, var(--node-color, #6366f1) 20%, transparent),
    0 0 0 1px rgba(255, 255, 255, 0.1) inset;
}

.ew-graph-node__header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  cursor: grab;
  border-radius: 16px 16px 0 0;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--node-color, #6366f1) 20%, transparent),
      rgba(255, 255, 255, 0.02)
    );
}

.ew-graph-node__header:active {
  cursor: grabbing;
}

.ew-graph-node__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--node-color, #6366f1) 20%, rgba(255, 255, 255, 0.04));
  font-size: 15px;
  flex-shrink: 0;
}

.ew-graph-node__title-stack {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ew-graph-node__title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.01em;
}

.ew-graph-node__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.ew-graph-node__category,
.ew-graph-node__module-id {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  font-size: 9px;
  line-height: 1;
}

.ew-graph-node__category {
  color: rgba(255, 255, 255, 0.82);
}

.ew-graph-node__module-id {
  max-width: 116px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.38);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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
  gap: 8px;
  padding: 8px 8px 10px;
}

.ew-graph-node__ports-in,
.ew-graph-node__ports-out {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 96px;
}

.ew-graph-node__body {
  flex: 1;
  min-width: 0;
  padding: 2px 8px 6px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.56);
  overflow: hidden;
}

.ew-graph-node__summary {
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.ew-graph-node__body-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.36);
}

.ew-graph-node[data-collapsed="1"] .ew-graph-node__ports {
  padding: 6px;
}
</style>
