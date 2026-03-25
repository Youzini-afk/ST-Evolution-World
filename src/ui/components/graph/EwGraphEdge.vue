<template>
  <g>
    <defs>
      <linearGradient
        :id="gradientId"
        gradientUnits="userSpaceOnUse"
        :x1="sourceX"
        :y1="sourceY"
        :x2="targetX"
        :y2="targetY"
      >
        <stop offset="0%" :stop-color="edgeStartColor" />
        <stop offset="100%" :stop-color="edgeEndColor" />
      </linearGradient>
    </defs>
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
      :class="{
        'is-selected': selected,
        'is-activation': kind === 'activation',
      }"
      :d="pathD"
      :style="edgeStyle"
      :stroke="gradientStroke"
      pointer-events="none"
    />
    <!-- Animated flow pulse -->
    <path
      v-if="showFlow"
      class="ew-graph-edge__flow"
      :class="{ 'is-activation': kind === 'activation' }"
      :d="pathD"
      :style="edgeStyle"
      :stroke="gradientStroke"
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
  kind?: "data" | "activation";
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

const gradientId = computed(() => `ew-edge-gradient-${props.edge.id}`);
const gradientStroke = computed(() => `url(#${gradientId.value})`);
const edgeStartColor = computed(() => props.sourceColor || '#6366f1');
const edgeEndColor = computed(() => props.targetColor || props.sourceColor || '#6366f1');
const showFlow = computed(() => props.selected || props.kind === "activation");

const edgeStyle = computed(() => ({
  '--edge-solid-color': props.sourceColor || '#6366f1',
  '--edge-width': props.selected ? '3.4px' : props.kind === 'activation' ? '2.8px' : '2.2px',
  '--edge-opacity': props.selected ? '0.96' : props.kind === 'activation' ? '0.9' : '0.72',
  '--edge-glow': props.selected ? '14px' : props.kind === 'activation' ? '11px' : '7px',
}));
</script>

<style scoped>
.ew-graph-edge__path {
  fill: none;
  stroke-width: var(--edge-width, 2px);
  stroke-linecap: round;
  opacity: var(--edge-opacity, 0.72);
  transition:
    stroke-width 0.15s ease,
    opacity 0.15s ease,
    filter 0.15s ease;
  filter: drop-shadow(
    0 0 var(--edge-glow, 6px)
      color-mix(in srgb, var(--edge-solid-color, #6366f1) 55%, transparent)
  );
}

.ew-graph-edge__flow {
  fill: none;
  stroke-width: calc(var(--edge-width, 2px) - 0.2px);
  stroke-linecap: round;
  stroke-dasharray: 10 18;
  opacity: 0.68;
  animation: edgeFlow 2.4s linear infinite;
  filter: drop-shadow(0 0 6px var(--edge-solid-color, #6366f1));
}

.ew-graph-edge__flow.is-activation {
  stroke-dasharray: 7 10;
  animation-duration: 1s;
}

.ew-graph-edge__path.is-activation {
  opacity: 0.92;
}

.ew-graph-edge__path.is-selected {
  opacity: 1;
}

@keyframes edgeFlow {
  from { stroke-dashoffset: 42; }
  to   { stroke-dashoffset: 0; }
}
</style>
