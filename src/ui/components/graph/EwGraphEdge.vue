<template>
  <g>
    <!-- Invisible fat hitbox for easier clicking -->
    <path
      :d="pathD"
      fill="none"
      stroke="transparent"
      stroke-width="14"
      style="cursor: pointer"
      @click.stop="$emit('select', edge.id)"
      @contextmenu.stop.prevent="$emit('context-menu', edge.id, $event)"
    />
    <!-- Visible edge -->
    <path
      class="ew-graph-edge__path"
      :d="pathD"
      :style="edgeStyle"
      pointer-events="none"
    />
    <!-- Animated flow pulse -->
    <path
      class="ew-graph-edge__flow"
      :d="pathD"
      :style="edgeStyle"
      pointer-events="none"
    />
  </g>
</template>

<script setup lang="ts">
import type { WorkbenchEdge } from './module-types';

const props = defineProps<{
  edge: WorkbenchEdge;
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
  (e: 'context-menu', edgeId: string, event: MouseEvent): void;
}>();

const pathD = computed(() => {
  const sx = props.sourceX;
  const sy = props.sourceY;
  const tx = props.targetX;
  const ty = props.targetY;

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
  transition: stroke-width 0.15s ease;
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--edge-color, #6366f1) 40%, transparent));
}

.ew-graph-edge__flow {
  fill: none;
  stroke: var(--edge-color, #6366f1);
  stroke-width: 2px;
  stroke-linecap: round;
  stroke-dasharray: 6 14;
  opacity: 0.7;
  animation: edgeFlow 1.2s linear infinite;
  filter: drop-shadow(0 0 3px var(--edge-color, #6366f1));
}

@keyframes edgeFlow {
  from { stroke-dashoffset: 20; }
  to   { stroke-dashoffset: 0; }
}
</style>
