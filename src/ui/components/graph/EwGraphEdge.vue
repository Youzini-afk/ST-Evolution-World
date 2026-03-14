<template>
  <path
    class="ew-graph-edge__path"
    :d="pathD"
    :style="edgeStyle"
    @click.stop="$emit('select', edge.id)"
  />
</template>

<script setup lang="ts">
import type { GraphEdge } from './graph-types';

const props = defineProps<{
  edge: GraphEdge;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourceColor?: string;
  targetColor?: string;
  selected?: boolean;
}>();

defineEmits<{
  (e: 'select', edgeId: string): void;
}>();

const pathD = computed(() => {
  const sx = props.sourceX;
  const sy = props.sourceY;
  const tx = props.targetX;
  const ty = props.targetY;

  // Horizontal distance for control points
  const dx = Math.abs(tx - sx);
  const cp = Math.max(80, dx * 0.4);

  return `M ${sx} ${sy} C ${sx + cp} ${sy}, ${tx - cp} ${ty}, ${tx} ${ty}`;
});

const edgeStyle = computed(() => ({
  '--edge-color': props.sourceColor || '#6366f1',
  strokeWidth: props.selected ? '3px' : '2px',
}));
</script>

<style scoped>
.ew-graph-edge__path {
  fill: none;
  stroke: var(--edge-color, #6366f1);
  stroke-width: 2px;
  stroke-linecap: round;
  cursor: pointer;
  transition: stroke-width 0.15s ease;
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--edge-color, #6366f1) 40%, transparent));
}

.ew-graph-edge__path:hover {
  stroke-width: 3px;
  filter: drop-shadow(0 0 8px color-mix(in srgb, var(--edge-color, #6366f1) 60%, transparent));
}
</style>
