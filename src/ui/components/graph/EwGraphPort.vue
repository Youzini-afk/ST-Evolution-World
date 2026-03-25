<template>
  <div
    class="ew-graph-port"
    :data-direction="port.direction"
    :data-connected="connected ? '1' : '0'"
    :data-type="port.dataType"
    :style="{ '--port-color': portVisual.color }"
    :title="`${port.label} · ${portVisual.label}`"
    ref="portEl"
    @pointerdown.stop="$emit('drag-start', $event)"
  >
    <template v-if="port.direction === 'in'">
      <span class="ew-graph-port__dot" />
      <span class="ew-graph-port__label">{{ port.label }}</span>
      <span v-if="showTypeBadge" class="ew-graph-port__type">
        {{ portVisual.shortLabel }}
      </span>
    </template>
    <template v-else>
      <span v-if="showTypeBadge" class="ew-graph-port__type">
        {{ portVisual.shortLabel }}
      </span>
      <span class="ew-graph-port__label">{{ port.label }}</span>
      <span class="ew-graph-port__dot" />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { ModulePortDef } from './module-types';
import { getPortTypeVisual } from "./graph-visuals";

const props = defineProps<{
  port: ModulePortDef;
  connected?: boolean;
}>();

defineEmits<{
  (e: 'drag-start', event: PointerEvent): void;
}>();

const portEl = ref<HTMLElement>();
const portVisual = computed(() => getPortTypeVisual(props.port.dataType));
const showTypeBadge = computed(() => props.port.dataType !== "any");

defineExpose({ portEl });
</script>

<style scoped>
.ew-graph-port {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  cursor: crosshair;
  padding: 3px 0;
  color: rgba(255, 255, 255, 0.82);
  min-width: 0;
}

.ew-graph-port[data-direction="in"] {
  justify-content: flex-start;
}
.ew-graph-port[data-direction="out"] {
  justify-content: flex-end;
}

.ew-graph-port__dot {
  width: 12px;
  height: 12px;
  min-width: 12px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--port-color, #94a3b8) 60%, white 18%);
  background: color-mix(in srgb, var(--port-color, #94a3b8) 16%, rgba(255, 255, 255, 0.05));
  transition: all 0.2s ease;
  box-shadow: 0 0 0 0 transparent;
}

.ew-graph-port__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1.2;
}

.ew-graph-port__type {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--port-color, #94a3b8) 55%, transparent);
  background: color-mix(in srgb, var(--port-color, #94a3b8) 14%, transparent);
  color: color-mix(in srgb, var(--port-color, #94a3b8) 70%, white 24%);
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.04em;
}

.ew-graph-port:hover .ew-graph-port__dot,
.ew-graph-port[data-connected="1"] .ew-graph-port__dot {
  border-color: var(--port-color, #6366f1);
  background: var(--port-color, #6366f1);
  box-shadow: 0 0 8px color-mix(in srgb, var(--port-color, #6366f1) 60%, transparent);
}

.ew-graph-port:hover .ew-graph-port__label,
.ew-graph-port[data-connected="1"] .ew-graph-port__label {
  color: rgba(255, 255, 255, 0.96);
}

.ew-graph-port[data-type="activation"] .ew-graph-port__dot {
  border-radius: 4px;
}

.ew-graph-port[data-direction="out"] .ew-graph-port__label {
  text-align: right;
}
</style>
