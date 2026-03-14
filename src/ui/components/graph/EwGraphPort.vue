<template>
  <div
    class="ew-graph-port"
    :data-direction="port.direction"
    :data-connected="connected ? '1' : '0'"
    :title="port.label"
    ref="portEl"
    @pointerdown.stop="$emit('drag-start', $event)"
  >
    <span class="ew-graph-port__dot" />
  </div>
</template>

<script setup lang="ts">
import type { PortDefinition } from './graph-types';

defineProps<{
  port: PortDefinition;
  connected?: boolean;
}>();

defineEmits<{
  (e: 'drag-start', event: PointerEvent): void;
}>();

const portEl = ref<HTMLElement>();

defineExpose({ portEl });
</script>

<style scoped>
.ew-graph-port {
  display: flex;
  align-items: center;
  cursor: crosshair;
  padding: 4px 0;
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
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.15);
  transition: all 0.2s ease;
  box-shadow: 0 0 0 0 transparent;
}

.ew-graph-port:hover .ew-graph-port__dot,
.ew-graph-port[data-connected="1"] .ew-graph-port__dot {
  border-color: var(--node-color, #6366f1);
  background: var(--node-color, #6366f1);
  box-shadow: 0 0 8px color-mix(in srgb, var(--node-color, #6366f1) 60%, transparent);
}
</style>
