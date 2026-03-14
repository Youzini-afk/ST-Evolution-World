<template>
  <div class="ew-palette" :class="{ collapsed: isCollapsed }">
    <button class="ew-palette__toggle" @click="isCollapsed = !isCollapsed" :title="isCollapsed ? '展开面板' : '收起面板'">
      {{ isCollapsed ? '▸' : '◂' }}
    </button>

    <div v-show="!isCollapsed" class="ew-palette__content">
      <!-- Workflow section -->
      <div class="ew-palette__section">
        <div class="ew-palette__section-title">工作流</div>
        <div
          v-for="(flow, i) in flows"
          :key="flow.id"
          class="ew-palette__item ew-palette__item--flow"
          :style="{ '--accent': flowColor(i) }"
          draggable="true"
          @dragstart="onDragStart($event, 'flow', flow.id)"
        >
          <span class="ew-palette__item-dot" :style="{ background: flow.enabled ? flowColor(i) : '#555' }" />
          <span class="ew-palette__item-label">{{ flow.name || `流 ${i + 1}` }}</span>
        </div>
        <button class="ew-palette__add-btn" @click="$emit('add-flow')">+ 新建工作流</button>
      </div>

      <!-- Module section -->
      <div class="ew-palette__section">
        <div class="ew-palette__section-title">功能模块</div>
        <div
          v-for="mod in modules"
          :key="mod.type"
          class="ew-palette__item"
          :style="{ '--accent': mod.color }"
          draggable="true"
          @dragstart="onDragStart($event, 'module', mod.type)"
        >
          <span class="ew-palette__item-icon">{{ mod.icon }}</span>
          <span class="ew-palette__item-label">{{ mod.label }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { NODE_TYPE_REGISTRY, type NodeType } from './graph-types';

defineProps<{
  flows: Array<{ id: string; name: string; enabled: boolean }>;
}>();

defineEmits<{
  (e: 'add-flow'): void;
}>();

const isCollapsed = ref(false);

const FLOW_COLORS = ['#f59e0b', '#6366f1', '#10b981', '#ec4899', '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6'];
function flowColor(i: number): string {
  return FLOW_COLORS[i % FLOW_COLORS.length];
}

// Module blocks (exclude flow_entry which is created via the workflow section)
const modules = computed(() => {
  const exclude: NodeType[] = ['flow_entry'];
  return Object.values(NODE_TYPE_REGISTRY).filter(m => !exclude.includes(m.type));
});

function onDragStart(e: DragEvent, kind: 'flow' | 'module', payload: string) {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData('application/ew-graph-node', JSON.stringify({ kind, payload }));
  e.dataTransfer.effectAllowed = 'copy';
}
</script>

<style scoped>
.ew-palette {
  position: relative;
  width: 160px;
  min-width: 160px;
  background: rgba(10, 10, 25, 0.85);
  backdrop-filter: blur(12px);
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  font-family: system-ui, -apple-system, sans-serif;
  transition: width 0.2s ease, min-width 0.2s ease;
  z-index: 10;
}

.ew-palette.collapsed {
  width: 28px;
  min-width: 28px;
}

.ew-palette__toggle {
  position: absolute;
  top: 6px;
  right: 4px;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  transition: background 0.15s;
}

.ew-palette__toggle:hover {
  background: rgba(255, 255, 255, 0.15);
  color: white;
}

.ew-palette__content {
  padding: 28px 6px 6px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ew-palette__section-title {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.35);
  padding: 0 4px 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.ew-palette__item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  cursor: grab;
  transition: all 0.15s ease;
  user-select: none;
}

.ew-palette__item:hover {
  background: color-mix(in srgb, var(--accent, #6366f1) 15%, transparent);
  border-color: color-mix(in srgb, var(--accent, #6366f1) 30%, transparent);
}

.ew-palette__item:active {
  cursor: grabbing;
  transform: scale(0.97);
}

.ew-palette__item-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.ew-palette__item-icon {
  font-size: 13px;
  flex-shrink: 0;
  width: 18px;
  text-align: center;
}

.ew-palette__item-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.75);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ew-palette__add-btn {
  width: 100%;
  padding: 5px;
  border: 1px dashed rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  background: none;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  font-size: 11px;
  transition: all 0.15s;
  margin-top: 2px;
}

.ew-palette__add-btn:hover {
  border-color: rgba(255, 255, 255, 0.3);
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.04);
}
</style>
