<template>
  <div class="ew-app">
    <div class="ew-app__header">
      <h3>✦ 🌍 Evolution World</h3>
      <span class="ew-app__version">v2.0.0 (ST Extension)</span>
    </div>
    <div class="ew-app__content">
      <p>扩展已成功加载！Vue Flow 测试：</p>
      <div class="ew-app__graph-test">
        <VueFlow
          v-model:nodes="nodes"
          v-model:edges="edges"
          :default-viewport="{ x: 20, y: 20, zoom: 0.9 }"
          fit-view-on-init
        >
          <Background />
          <MiniMap />
          <Controls />
        </VueFlow>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { VueFlow } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { MiniMap } from '@vue-flow/minimap';
import { Controls } from '@vue-flow/controls';

import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vue-flow/minimap/dist/style.css';
import '@vue-flow/controls/dist/style.css';

const nodes = ref([
  {
    id: 'trigger-1',
    type: 'default',
    position: { x: 50, y: 50 },
    label: '🎯 触发器',
  },
  {
    id: 'context-1',
    type: 'default',
    position: { x: 50, y: 180 },
    label: '📋 上下文构建',
  },
  {
    id: 'ai-call-1',
    type: 'default',
    position: { x: 50, y: 310 },
    label: '🤖 AI 调用',
  },
]);

const edges = ref([
  {
    id: 'e1',
    source: 'trigger-1',
    target: 'context-1',
    animated: true,
  },
  {
    id: 'e2',
    source: 'context-1',
    target: 'ai-call-1',
    animated: true,
  },
]);

onMounted(() => {
  setTimeout(() => {
    const nodeEls = document.querySelectorAll('.vue-flow__node');
    console.log('[EW] node count:', nodeEls.length);
    if (nodeEls.length > 0) {
      const n = nodeEls[0] as HTMLElement;
      const cs = getComputedStyle(n);
      console.log('[EW] first node:', {
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        position: cs.position,
        width: cs.width,
        height: cs.height,
        background: cs.background,
        color: cs.color,
        transform: n.style.transform,
        innerHTML: n.innerHTML.substring(0, 200),
      });
    }
    const controls = document.querySelectorAll('.vue-flow__controls-button');
    console.log('[EW] controls count:', controls.length);
    if (controls.length > 0) {
      const btn = controls[0] as HTMLElement;
      const bcs = getComputedStyle(btn);
      console.log('[EW] first control:', {
        pointerEvents: bcs.pointerEvents,
        cursor: bcs.cursor,
        zIndex: bcs.zIndex,
      });
    }
  }, 1500);
});
</script>

<style scoped>
.ew-app {
  padding: 12px;
  color: var(--SmartThemeBodyColor, #e2e8f0);
}

.ew-app__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.ew-app__header h3 {
  margin: 0;
  font-size: 16px;
}

.ew-app__version {
  font-size: 11px;
  opacity: 0.5;
}

.ew-app__graph-test {
  width: 100%;
  height: 500px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.3);
}
</style>

<!-- 非 scoped 样式：覆盖 Vue Flow 默认主题为暗色 + 修复 ST CSS 冲突 -->
<style>
/* ── 节点暗色主题 ── */
.ew-app .vue-flow__node {
  background: rgba(30, 35, 50, 0.95) !important;
  color: #e2e8f0 !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  border-radius: 8px !important;
  padding: 8px 16px !important;
  font-size: 13px !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
  cursor: grab !important;
}

.ew-app .vue-flow__node.selected {
  border-color: rgba(99, 102, 241, 0.6) !important;
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.3), 0 2px 8px rgba(0, 0, 0, 0.3) !important;
}

/* ── Handle（连接点） ── */
.ew-app .vue-flow__handle {
  width: 10px !important;
  height: 10px !important;
  background: rgba(99, 102, 241, 0.7) !important;
  border: 2px solid rgba(255, 255, 255, 0.3) !important;
}

/* ── 连线暗色 ── */
.ew-app .vue-flow__edge-path {
  stroke: rgba(255, 255, 255, 0.3) !important;
  stroke-width: 2 !important;
}

/* ── Controls 修复 ── */
.ew-app .vue-flow__controls {
  background: rgba(20, 24, 36, 0.95) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  border-radius: 8px !important;
  padding: 4px !important;
  pointer-events: all !important;
  z-index: 10 !important;
}

.ew-app .vue-flow__controls-button {
  background: transparent !important;
  border: none !important;
  color: rgba(255, 255, 255, 0.6) !important;
  cursor: pointer !important;
  pointer-events: all !important;
  width: 28px !important;
  height: 28px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

.ew-app .vue-flow__controls-button:hover {
  background: rgba(255, 255, 255, 0.1) !important;
  color: #fff !important;
  border-radius: 4px !important;
}

.ew-app .vue-flow__controls-button svg {
  fill: currentColor !important;
  width: 14px !important;
  height: 14px !important;
}

/* ── Minimap 暗色 ── */
.ew-app .vue-flow__minimap {
  background: rgba(0, 0, 0, 0.5) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 8px !important;
}

/* ── 防止 ST 的全局 CSS 干扰 ── */
.ew-app .vue-flow__panel {
  pointer-events: all !important;
}
</style>
