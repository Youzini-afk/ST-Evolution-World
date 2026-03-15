<template>
  <transition name="ew-prop-slide">
    <div v-if="node" class="ew-prop-panel">
      <div class="ew-prop-panel__header">
        <span class="ew-prop-panel__icon">{{ blueprint?.icon }}</span>
        <span class="ew-prop-panel__title">{{ blueprint?.label ?? '属性' }}</span>
        <button class="ew-prop-panel__close" @click="$emit('close')" title="关闭">✕</button>
      </div>

      <div class="ew-prop-panel__desc">{{ blueprint?.description }}</div>

      <div class="ew-prop-panel__body">
        <!-- Ports Info -->
        <div class="ew-prop-panel__section">
          <div class="ew-prop-panel__section-title">端口</div>
          <div class="ew-prop-panel__ports">
            <div
              v-for="port in blueprint?.ports ?? []"
              :key="port.id"
              class="ew-prop-panel__port"
              :class="{ 'is-in': port.direction === 'in', 'is-out': port.direction === 'out' }"
            >
              <span class="ew-prop-panel__port-dir">{{ port.direction === 'in' ? '←' : '→' }}</span>
              <span class="ew-prop-panel__port-label">{{ port.label }}</span>
              <span class="ew-prop-panel__port-type">{{ port.dataType }}</span>
              <span v-if="port.optional" class="ew-prop-panel__port-opt">可选</span>
            </div>
          </div>
        </div>

        <!-- Config fields -->
        <div class="ew-prop-panel__section">
          <div class="ew-prop-panel__section-title">配置</div>
          <div v-if="configEntries.length === 0" class="ew-prop-panel__empty">
            此模块无可配置参数
          </div>
          <div v-for="[key, val] in configEntries" :key="key" class="ew-prop-panel__field">
            <label class="ew-prop-panel__field-label">{{ key }}</label>
            <!-- Boolean -->
            <button
              v-if="typeof val === 'boolean'"
              type="button"
              class="ew-prop-panel__switch"
              :class="{ active: localConfig[key] }"
              @click="localConfig[key] = !localConfig[key]; emitConfig()"
            >
              {{ localConfig[key] ? 'ON' : 'OFF' }}
            </button>
            <!-- Number -->
            <input
              v-else-if="typeof val === 'number'"
              type="number"
              class="ew-prop-panel__input"
              v-model.number="localConfig[key]"
              @change="emitConfig()"
            />
            <!-- String (textarea for multiline) -->
            <textarea
              v-else-if="typeof val === 'string' && val.length > 80"
              class="ew-prop-panel__textarea"
              v-model="localConfig[key]"
              @change="emitConfig()"
              rows="4"
            />
            <!-- String (input) -->
            <input
              v-else-if="typeof val === 'string'"
              type="text"
              class="ew-prop-panel__input"
              v-model="localConfig[key]"
              @change="emitConfig()"
            />
            <!-- Array / Object — JSON editor -->
            <textarea
              v-else
              class="ew-prop-panel__textarea ew-prop-panel__textarea--json"
              :value="JSON.stringify(localConfig[key], null, 2)"
              @change="onJsonChange(key, ($event.target as HTMLTextAreaElement).value)"
              rows="4"
            />
          </div>
        </div>

        <!-- Node metadata -->
        <div class="ew-prop-panel__section ew-prop-panel__section--meta">
          <div class="ew-prop-panel__section-title">节点信息</div>
          <div class="ew-prop-panel__meta-row">
            <span>ID</span>
            <code>{{ node.id }}</code>
          </div>
          <div class="ew-prop-panel__meta-row">
            <span>模块</span>
            <code>{{ node.moduleId }}</code>
          </div>
          <div class="ew-prop-panel__meta-row">
            <span>位置</span>
            <code>{{ Math.round(node.position.x) }}, {{ Math.round(node.position.y) }}</code>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import type { WorkbenchNode, ModuleBlueprint } from './module-types';
import { MODULE_REGISTRY } from './module-registry';

const props = defineProps<{
  node: WorkbenchNode | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update-config', nodeId: string, config: Record<string, any>): void;
}>();

const blueprint = computed<ModuleBlueprint | null>(() => {
  if (!props.node) return null;
  return MODULE_REGISTRY.get(props.node.moduleId) ?? null;
});

const localConfig = reactive<Record<string, any>>({});

// Sync config when node changes
watch(
  () => props.node,
  (newNode) => {
    // Clear and repopulate
    for (const key of Object.keys(localConfig)) {
      delete localConfig[key];
    }
    if (newNode) {
      const defaults = blueprint.value?.defaultConfig ?? {};
      Object.assign(localConfig, { ...defaults, ...newNode.config });
    }
  },
  { immediate: true },
);

const configEntries = computed(() => {
  return Object.entries(localConfig).filter(([key]) => {
    // Filter out internal keys
    return !key.startsWith('_');
  });
});

function emitConfig() {
  if (!props.node) return;
  emit('update-config', props.node.id, { ...localConfig });
}

function onJsonChange(key: string, raw: string) {
  try {
    localConfig[key] = JSON.parse(raw);
    emitConfig();
  } catch {
    // Invalid JSON, don't update
  }
}
</script>

<style scoped>
.ew-prop-panel {
  position: absolute;
  top: 0;
  right: 0;
  width: 280px;
  height: 100%;
  background: rgba(10, 10, 30, 0.95);
  backdrop-filter: blur(20px);
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  z-index: 50;
  font-family: system-ui, -apple-system, sans-serif;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.4);
}

/* Slide animation */
.ew-prop-slide-enter-active,
.ew-prop-slide-leave-active {
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.ew-prop-slide-enter-from,
.ew-prop-slide-leave-to {
  transform: translateX(100%);
}

.ew-prop-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.ew-prop-panel__icon {
  font-size: 16px;
}

.ew-prop-panel__title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}

.ew-prop-panel__close {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.ew-prop-panel__close:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.ew-prop-panel__desc {
  padding: 8px 12px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  line-height: 1.4;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  flex-shrink: 0;
}

.ew-prop-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.ew-prop-panel__section {
  padding: 4px 12px 8px;
}

.ew-prop-panel__section-title {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.3);
  padding: 4px 0 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  margin-bottom: 6px;
}

/* Ports */
.ew-prop-panel__ports {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ew-prop-panel__port {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 4px;
  font-size: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.ew-prop-panel__port-dir {
  color: rgba(255, 255, 255, 0.3);
  width: 12px;
  text-align: center;
}

.ew-prop-panel__port.is-in .ew-prop-panel__port-dir { color: rgba(59, 130, 246, 0.7); }
.ew-prop-panel__port.is-out .ew-prop-panel__port-dir { color: rgba(16, 185, 129, 0.7); }

.ew-prop-panel__port-label {
  flex: 1;
  color: rgba(255, 255, 255, 0.65);
}

.ew-prop-panel__port-type {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.25);
  font-family: monospace;
}

.ew-prop-panel__port-opt {
  font-size: 8px;
  color: rgba(251, 191, 36, 0.7);
  background: rgba(251, 191, 36, 0.1);
  padding: 0 3px;
  border-radius: 2px;
}

/* Config fields */
.ew-prop-panel__empty {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.25);
  font-style: italic;
  padding: 6px 0;
}

.ew-prop-panel__field {
  margin-bottom: 8px;
}

.ew-prop-panel__field-label {
  display: block;
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 3px;
}

.ew-prop-panel__input {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.85);
  font-size: 11px;
  outline: none;
  transition: border-color 0.15s;
}

.ew-prop-panel__input:focus {
  border-color: rgba(99, 102, 241, 0.5);
}

.ew-prop-panel__textarea {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.85);
  font-size: 11px;
  outline: none;
  resize: vertical;
  font-family: inherit;
  line-height: 1.4;
  transition: border-color 0.15s;
}

.ew-prop-panel__textarea--json {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 10px;
}

.ew-prop-panel__textarea:focus {
  border-color: rgba(99, 102, 241, 0.5);
}

.ew-prop-panel__switch {
  padding: 3px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.5);
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.ew-prop-panel__switch.active {
  background: rgba(16, 185, 129, 0.2);
  border-color: rgba(16, 185, 129, 0.4);
  color: #10b981;
}

/* Meta section */
.ew-prop-panel__section--meta {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  margin-top: 8px;
  padding-top: 8px;
}

.ew-prop-panel__meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  padding: 2px 0;
}

.ew-prop-panel__meta-row span {
  color: rgba(255, 255, 255, 0.35);
}

.ew-prop-panel__meta-row code {
  color: rgba(255, 255, 255, 0.5);
  font-family: 'Consolas', monospace;
  font-size: 9px;
  background: rgba(255, 255, 255, 0.04);
  padding: 1px 4px;
  border-radius: 3px;
}

/* Scrollbar */
.ew-prop-panel__body::-webkit-scrollbar { width: 4px; }
.ew-prop-panel__body::-webkit-scrollbar-track { background: transparent; }
.ew-prop-panel__body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}
</style>
