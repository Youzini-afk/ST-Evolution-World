<template>
  <div class="ew-inspector">
    <!-- No node selected: show graph overview -->
    <div v-if="!currentNode" class="ew-inspector__empty">
      <div class="ew-inspector__empty-icon">🎯</div>
      <div class="ew-inspector__empty-title">工作台</div>
      <div class="ew-inspector__empty-hint">
        在工作流图中选中一个节点后，在此编辑其详细配置。
      </div>

      <!-- Graph summary when a graph exists -->
      <div v-if="currentGraph" class="ew-inspector__graph-summary">
        <div class="ew-inspector__summary-header">
          <span>📊 当前图：{{ currentGraph.name || '未命名' }}</span>
          <span :class="['ew-inspector__status', currentGraph.enabled ? 'is-on' : 'is-off']">
            {{ currentGraph.enabled ? '已启用' : '已禁用' }}
          </span>
        </div>
        <div class="ew-inspector__summary-stats">
          <span>{{ currentGraph.nodes?.length ?? 0 }} 节点</span>
          <span>·</span>
          <span>{{ currentGraph.edges?.length ?? 0 }} 连线</span>
          <span>·</span>
          <span>优先级 {{ currentGraph.priority ?? 100 }}</span>
        </div>
      </div>
    </div>

    <!-- Node selected: show inspector -->
    <template v-else>
      <!-- Header -->
      <div class="ew-inspector__header">
        <span class="ew-inspector__node-icon">{{ blueprint?.icon ?? '?' }}</span>
        <div class="ew-inspector__header-text">
          <div class="ew-inspector__node-title">{{ blueprint?.label ?? currentNode.moduleId }}</div>
          <div class="ew-inspector__node-desc">{{ blueprint?.description ?? '' }}</div>
        </div>
        <button class="ew-inspector__deselect" @click="clearSelection" title="取消选中">✕</button>
      </div>

      <!-- Port info -->
      <details class="ew-inspector__section" open>
        <summary class="ew-inspector__section-title">端口信息</summary>
        <div class="ew-inspector__ports">
          <div
            v-for="port in blueprint?.ports ?? []"
            :key="port.id"
            class="ew-inspector__port"
            :class="{ 'is-in': port.direction === 'in', 'is-out': port.direction === 'out' }"
          >
            <span class="ew-inspector__port-dir">{{ port.direction === 'in' ? '←' : '→' }}</span>
            <span class="ew-inspector__port-label">{{ port.label }}</span>
            <span class="ew-inspector__port-type">{{ port.dataType }}</span>
            <span v-if="port.optional" class="ew-inspector__port-opt">可选</span>
          </div>
        </div>
      </details>

      <!-- Config fields grouped by section -->
      <details class="ew-inspector__section" open>
        <summary class="ew-inspector__section-title">基础配置</summary>
        <div v-if="configEntries.length === 0" class="ew-inspector__empty-config">
          此模块无可配置参数
        </div>
        <div v-for="[key, val] in configEntries" :key="key" class="ew-inspector__field">
          <label class="ew-inspector__field-label">
            {{ key }}
            <span v-if="schemaForKey(key)?.description" class="ew-inspector__field-help" :title="schemaForKey(key)?.description">?</span>
          </label>
          <!-- Boolean -->
          <button
            v-if="typeof val === 'boolean'"
            type="button"
            class="ew-inspector__switch"
            :class="{ active: localConfig[key] }"
            @click="localConfig[key] = !localConfig[key]; emitConfig()"
          >
            {{ localConfig[key] ? 'ON' : 'OFF' }}
          </button>
          <!-- Number -->
          <input
            v-else-if="typeof val === 'number'"
            type="number"
            class="ew-inspector__input"
            v-model.number="localConfig[key]"
            @change="emitConfig()"
          />
          <!-- Long string → textarea -->
          <textarea
            v-else-if="typeof val === 'string' && val.length > 60"
            class="ew-inspector__textarea"
            v-model="localConfig[key]"
            @change="emitConfig()"
            rows="6"
          />
          <!-- Short string -->
          <input
            v-else-if="typeof val === 'string'"
            type="text"
            class="ew-inspector__input"
            v-model="localConfig[key]"
            @change="emitConfig()"
          />
          <!-- Array / Object → JSON -->
          <textarea
            v-else
            class="ew-inspector__textarea ew-inspector__textarea--json"
            :value="JSON.stringify(localConfig[key], null, 2)"
            @change="onJsonChange(key, ($event.target as HTMLTextAreaElement).value)"
            rows="6"
          />
        </div>
      </details>

      <!-- Node metadata -->
      <details class="ew-inspector__section">
        <summary class="ew-inspector__section-title">节点信息</summary>
        <div class="ew-inspector__meta">
          <div class="ew-inspector__meta-row">
            <span>ID</span><code>{{ currentNode.id }}</code>
          </div>
          <div class="ew-inspector__meta-row">
            <span>模块</span><code>{{ currentNode.moduleId }}</code>
          </div>
          <div class="ew-inspector__meta-row">
            <span>位置</span>
            <code>{{ Math.round(currentNode.position.x) }}, {{ Math.round(currentNode.position.y) }}</code>
          </div>
        </div>
      </details>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { WorkbenchNode, WorkbenchGraph, ModuleBlueprint, ConfigFieldSchema } from './module-types';
import { MODULE_REGISTRY } from './module-registry';
import { useEwStore } from '../../store';

const store = useEwStore();

const props = defineProps<{
  graphs: WorkbenchGraph[];
  selectedGraphId?: string | null;
  selectedNodeId?: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:graphs', graphs: WorkbenchGraph[]): void;
}>();

const currentGraph = computed<WorkbenchGraph | null>(() => {
  const id = props.selectedGraphId ?? store.selectedGraphId;
  if (!id) return props.graphs[0] ?? null;
  return props.graphs.find(g => g.id === id) ?? props.graphs[0] ?? null;
});

const currentNode = computed<WorkbenchNode | null>(() => {
  const nodeId = props.selectedNodeId ?? store.selectedNodeId;
  if (!nodeId || !currentGraph.value) return null;
  return currentGraph.value.nodes.find(n => n.id === nodeId) ?? null;
});

const blueprint = computed<ModuleBlueprint | null>(() => {
  if (!currentNode.value) return null;
  return MODULE_REGISTRY.get(currentNode.value.moduleId) ?? null;
});

const localConfig = reactive<Record<string, any>>({});

watch(
  () => currentNode.value,
  (node) => {
    for (const key of Object.keys(localConfig)) delete localConfig[key];
    if (node) {
      const defaults = blueprint.value?.defaultConfig ?? {};
      Object.assign(localConfig, { ...defaults, ...node.config });
    }
  },
  { immediate: true },
);

const configEntries = computed(() =>
  Object.entries(localConfig).filter(([key]) => !key.startsWith('_')),
);

function schemaForKey(key: string): ConfigFieldSchema | undefined {
  return blueprint.value?.configSchema?.find(s => s.key === key);
}

function emitConfig() {
  if (!currentNode.value || !currentGraph.value) return;
  const nodeId = currentNode.value.id;
  const updatedGraphs = props.graphs.map(g => {
    if (g.id !== currentGraph.value!.id) return g;
    return {
      ...g,
      nodes: g.nodes.map(n => n.id === nodeId ? { ...n, config: { ...localConfig } } : n),
    };
  });
  emit('update:graphs', updatedGraphs);
}

function onJsonChange(key: string, raw: string) {
  try {
    localConfig[key] = JSON.parse(raw);
    emitConfig();
  } catch { /* invalid JSON, ignore */ }
}

function clearSelection() {
  store.selectNode(null);
}
</script>

<style scoped>
.ew-inspector {
  height: 100%;
  overflow-y: auto;
  background: rgba(10, 10, 30, 0.6);
  font-family: system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* ── Empty state ── */
.ew-inspector__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  padding: 40px 24px;
  text-align: center;
}

.ew-inspector__empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.ew-inspector__empty-title {
  font-size: 18px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 8px;
}

.ew-inspector__empty-hint {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.35);
  line-height: 1.5;
  max-width: 300px;
}

/* ── Graph summary ── */
.ew-inspector__graph-summary {
  margin-top: 24px;
  padding: 16px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  width: 100%;
  max-width: 340px;
}

.ew-inspector__summary-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 8px;
}

.ew-inspector__status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 8px;
  font-weight: 600;
}
.ew-inspector__status.is-on {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
}
.ew-inspector__status.is-off {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.35);
}

.ew-inspector__summary-stats {
  display: flex;
  gap: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.35);
}

/* ── Header ── */
.ew-inspector__header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
}

.ew-inspector__node-icon {
  font-size: 24px;
  flex-shrink: 0;
  margin-top: 2px;
}

.ew-inspector__header-text {
  flex: 1;
  min-width: 0;
}

.ew-inspector__node-title {
  font-size: 15px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 4px;
}

.ew-inspector__node-desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  line-height: 1.4;
}

.ew-inspector__deselect {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s;
}
.ew-inspector__deselect:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

/* ── Sections ── */
.ew-inspector__section {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.ew-inspector__section-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: rgba(255, 255, 255, 0.35);
  padding: 10px 16px;
  cursor: pointer;
  user-select: none;
  list-style: none;
  display: flex;
  align-items: center;
}
.ew-inspector__section-title::before {
  content: '▶';
  font-size: 8px;
  margin-right: 8px;
  transition: transform 0.15s;
}
.ew-inspector__section[open] > .ew-inspector__section-title::before {
  transform: rotate(90deg);
}

/* ── Ports ── */
.ew-inspector__ports {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 0 16px 12px;
}

.ew-inspector__port {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 5px;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.02);
}

.ew-inspector__port-dir {
  width: 14px;
  text-align: center;
  color: rgba(255, 255, 255, 0.3);
}
.ew-inspector__port.is-in .ew-inspector__port-dir { color: rgba(59, 130, 246, 0.7); }
.ew-inspector__port.is-out .ew-inspector__port-dir { color: rgba(16, 185, 129, 0.7); }

.ew-inspector__port-label {
  flex: 1;
  color: rgba(255, 255, 255, 0.65);
}

.ew-inspector__port-type {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.25);
  font-family: monospace;
}

.ew-inspector__port-opt {
  font-size: 8px;
  color: rgba(251, 191, 36, 0.7);
  background: rgba(251, 191, 36, 0.1);
  padding: 0 4px;
  border-radius: 3px;
}

/* ── Config fields ── */
.ew-inspector__empty-config {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.25);
  font-style: italic;
  padding: 0 16px 12px;
}

.ew-inspector__field {
  padding: 0 16px;
  margin-bottom: 12px;
}

.ew-inspector__field-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.55);
  margin-bottom: 4px;
}

.ew-inspector__field-help {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.3);
  font-size: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: help;
}

.ew-inspector__input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s;
}
.ew-inspector__input:focus {
  border-color: rgba(99, 102, 241, 0.5);
}

.ew-inspector__textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
  outline: none;
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;
  transition: border-color 0.15s;
}
.ew-inspector__textarea--json {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 11px;
}
.ew-inspector__textarea:focus {
  border-color: rgba(99, 102, 241, 0.5);
}

.ew-inspector__switch {
  padding: 4px 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.ew-inspector__switch.active {
  background: rgba(16, 185, 129, 0.2);
  border-color: rgba(16, 185, 129, 0.4);
  color: #10b981;
}

/* ── Meta ── */
.ew-inspector__meta {
  padding: 0 16px 12px;
}

.ew-inspector__meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  padding: 3px 0;
}
.ew-inspector__meta-row span {
  color: rgba(255, 255, 255, 0.35);
}
.ew-inspector__meta-row code {
  color: rgba(255, 255, 255, 0.5);
  font-family: 'Consolas', monospace;
  font-size: 10px;
  background: rgba(255, 255, 255, 0.04);
  padding: 1px 5px;
  border-radius: 3px;
}

/* ── Scrollbar ── */
.ew-inspector::-webkit-scrollbar { width: 4px; }
.ew-inspector::-webkit-scrollbar-track { background: transparent; }
.ew-inspector::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}
</style>
