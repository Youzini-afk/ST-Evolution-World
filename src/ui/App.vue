<template>
  <div class="ew-app">
    <div class="ew-app__header">
      <h3>✦ 🌍 Evolution World</h3>
      <span class="ew-app__version">v2.0.0 (ST Extension)</span>
    </div>
    <div class="ew-app__content">
      <p>扩展已成功加载！Vue Flow 测试（{{ nodeCount }} 个节点）：</p>
      <div class="ew-app__graph-test">
        <VueFlow
          :nodes="initialNodes"
          :edges="initialEdges"
          @nodes-initialized="onNodesReady"
        >
          <Background />
          <MiniMap />
          <Controls @fit-view="handleFitView" />
        </VueFlow>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { VueFlow, useVueFlow } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { MiniMap } from '@vue-flow/minimap';
import { Controls } from '@vue-flow/controls';

import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vue-flow/minimap/dist/style.css';
import '@vue-flow/controls/dist/style.css';

const { fitView, getNodes } = useVueFlow();

const nodeCount = ref(0);

const initialNodes = [
  {
    id: 'trigger-1',
    type: 'default',
    position: { x: 50, y: 50 },
    label: '🎯 触发器',
  },
  {
    id: 'context-1',
    type: 'default',
    position: { x: 50, y: 200 },
    label: '📋 上下文构建',
  },
  {
    id: 'ai-call-1',
    type: 'default',
    position: { x: 50, y: 350 },
    label: '🤖 AI 调用',
  },
];

const initialEdges = [
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
];

function onNodesReady() {
  nodeCount.value = getNodes.value.length;
  console.log('[EW] nodes initialized:', nodeCount.value);
  setTimeout(() => fitView({ padding: 0.3 }), 100);
}

function handleFitView() {
  fitView({ padding: 0.3 });
}

onMounted(() => {
  console.log('[EW] App mounted, initial nodes:', initialNodes.length);
  setTimeout(() => {
    const nodeEls = document.querySelectorAll('.vue-flow__node');
    console.log('[EW] DOM node elements:', nodeEls.length);
    if (nodeEls.length > 0) {
      const n = nodeEls[0] as HTMLElement;
      const cs = getComputedStyle(n);
      console.log('[EW] first node computed style:', {
        display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
        width: cs.width, height: cs.height, position: cs.position,
        background: cs.backgroundColor, color: cs.color,
        transform: n.style.transform,
      });
      console.log('[EW] first node innerHTML:', n.innerHTML.substring(0, 300));
    }
  }, 2000);
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

.ew-app__header h3 { margin: 0; font-size: 16px; }
.ew-app__version { font-size: 11px; opacity: 0.5; }

.ew-app__graph-test {
  width: 100%;
  height: 500px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.3);
}
</style>

<!-- 非 scoped：ST CSS 冲突修复 + 暗色主题 -->
<style>
/* ══════════════════════════════════════════════
   关键：ST 全局 CSS 覆盖了 Vue Flow 的 position 属性，
   导致 viewport 高度塌缩为 0px，节点不可见。
   必须用 !important 强制回正。
   ══════════════════════════════════════════════ */
.ew-app .vue-flow {
  position: relative !important;
  width: 100% !important;
  height: 100% !important;
  overflow: hidden !important;
}

.ew-app .vue-flow__container {
  position: absolute !important;
  width: 100% !important;
  height: 100% !important;
  top: 0 !important;
  left: 0 !important;
}

.ew-app .vue-flow__pane {
  position: absolute !important;
  width: 100% !important;
  height: 100% !important;
  top: 0 !important;
  left: 0 !important;
  z-index: 1;
}

.ew-app .vue-flow__transformationpane {
  position: absolute !important;
  width: 100% !important;
  height: 100% !important;
  top: 0 !important;
  left: 0 !important;
  transform-origin: 0 0 !important;
  pointer-events: none !important;
  z-index: 2;
}

.ew-app .vue-flow__viewport {
  position: absolute !important;
  width: 100% !important;
  height: 100% !important;
  top: 0 !important;
  left: 0 !important;
  overflow: visible !important;
  z-index: 4;
}

.ew-app .vue-flow__nodes {
  position: absolute !important;
  width: 100% !important;
  height: 100% !important;
  pointer-events: none !important;
  transform-origin: 0 0 !important;
}

.ew-app .vue-flow__node {
  display: block !important;
  visibility: visible !important;
  position: absolute !important;
  pointer-events: all !important;
  transform-origin: 0 0 !important;
  cursor: grab !important;
  z-index: 1;
}

.ew-app .vue-flow .vue-flow__edges {
  position: absolute !important;
  width: 100% !important;
  height: 100% !important;
  pointer-events: none !important;
  overflow: visible !important;
}

.ew-app .vue-flow__edges svg {
  position: absolute !important;
  width: 100% !important;
  height: 100% !important;
  overflow: visible !important;
}

.ew-app .vue-flow__panel {
  position: absolute !important;
  pointer-events: all !important;
}

/* ── 节点 ── */
.ew-app .vue-flow__node-default {
  background: rgba(30, 35, 50, 0.95);
  color: #e2e8f0;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  padding: 10px 18px;
  font-size: 14px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
  min-width: 120px;
  text-align: center;
}

.ew-app .vue-flow__node.selected .vue-flow__node-default {
  border-color: rgba(99, 102, 241, 0.6);
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.3), 0 2px 12px rgba(0, 0, 0, 0.4);
}

/* ── Handle ── */
.ew-app .vue-flow__handle {
  width: 10px;
  height: 10px;
  background: rgba(99, 102, 241, 0.8);
  border: 2px solid rgba(255, 255, 255, 0.4);
}

/* ── 连线 ── */
.ew-app .vue-flow__edge-path {
  stroke: rgba(255, 255, 255, 0.35);
  stroke-width: 2;
}

/* ── Controls ── */
.ew-app .vue-flow__controls {
  background: rgba(20, 24, 36, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 4px;
  pointer-events: all;
  z-index: 10;
}

.ew-app .vue-flow__controls-button {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  pointer-events: all;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.ew-app .vue-flow__controls-button:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.ew-app .vue-flow__controls-button svg {
  fill: currentColor;
  width: 14px;
  height: 14px;
}

/* ── Minimap ── */
.ew-app .vue-flow__minimap {
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
}

/* ── Panel pointer-events fix ── */
.ew-app .vue-flow__panel {
  pointer-events: all;
}
</style>
