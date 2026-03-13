<template>
  <div class="ew-app">
    <div class="ew-app__header">
      <h3>🌍 Evolution World</h3>
      <span class="ew-app__version">v2.0.0 (ST Extension)</span>
    </div>
    <div class="ew-app__content">
      <p>扩展已成功加载！Vue Flow 测试：</p>
      <div class="ew-app__graph-test" ref="graphContainer">
        <VueFlow
          v-model:nodes="nodes"
          v-model:edges="edges"
          :default-viewport="{ x: 50, y: 50, zoom: 0.8 }"
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
import { ref } from 'vue';
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
    style: {
      background: 'rgba(59, 130, 246, 0.15)',
      border: '1px solid rgba(59, 130, 246, 0.4)',
      borderRadius: '8px',
      color: '#e2e8f0',
      padding: '8px 16px',
    },
  },
  {
    id: 'context-1',
    type: 'default',
    position: { x: 50, y: 180 },
    label: '📋 上下文构建',
    style: {
      background: 'rgba(16, 185, 129, 0.15)',
      border: '1px solid rgba(16, 185, 129, 0.4)',
      borderRadius: '8px',
      color: '#e2e8f0',
      padding: '8px 16px',
    },
  },
  {
    id: 'ai-call-1',
    type: 'default',
    position: { x: 50, y: 310 },
    label: '🤖 AI 调用',
    style: {
      background: 'rgba(245, 158, 11, 0.15)',
      border: '1px solid rgba(245, 158, 11, 0.4)',
      borderRadius: '8px',
      color: '#e2e8f0',
      padding: '8px 16px',
    },
  },
]);

const edges = ref([
  {
    id: 'e1',
    source: 'trigger-1',
    target: 'context-1',
    animated: true,
    style: { stroke: 'rgba(255,255,255,0.3)' },
  },
  {
    id: 'e2',
    source: 'context-1',
    target: 'ai-call-1',
    animated: true,
    style: { stroke: 'rgba(255,255,255,0.3)' },
  },
]);
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
