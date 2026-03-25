<template>
  <transition name="ew-prop-slide">
    <div v-if="node" class="ew-prop-panel" :class="{ 'is-embedded': embedded }">
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
          <div v-if="showSimpleModeHint" class="ew-prop-panel__hint">
            当前为 Simple 模式，仅显示推荐配置字段。
          </div>
          <div
            v-if="visibleSchemaFields.length === 0 && fallbackConfigEntries.length === 0"
            class="ew-prop-panel__empty"
          >
            此模块无可配置参数
          </div>
          <div
            v-for="field in visibleSchemaFields"
            :key="field.key"
            class="ew-prop-panel__field"
          >
            <div class="ew-prop-panel__field-label-row">
              <label class="ew-prop-panel__field-label">{{ field.label }}</label>
              <span
                v-if="field.required"
                class="ew-prop-panel__field-badge"
              >
                必填
              </span>
            </div>
            <div
              v-if="field.description || getDefaultHint(field.key)"
              class="ew-prop-panel__field-help"
            >
              <span v-if="field.description">{{ field.description }}</span>
              <span v-if="getDefaultHint(field.key)">
                默认值：{{ getDefaultHint(field.key) }}
              </span>
            </div>

            <button
              v-if="field.type === 'boolean'"
              type="button"
              class="ew-prop-panel__switch"
              :class="{ active: Boolean(localConfig[field.key]) }"
              @click="toggleBooleanField(field.key)"
            >
              {{ localConfig[field.key] ? 'ON' : 'OFF' }}
            </button>

            <div
              v-else-if="field.type === 'slider'"
              class="ew-prop-panel__slider"
            >
              <input
                type="range"
                class="ew-prop-panel__slider-input"
                :min="field.min ?? 0"
                :max="field.max ?? 100"
                :step="field.step ?? 1"
                v-model.number="localConfig[field.key]"
                @change="emitConfig()"
              />
              <span class="ew-prop-panel__slider-value">
                {{ localConfig[field.key] }}
              </span>
            </div>

            <select
              v-else-if="field.type === 'select'"
              class="ew-prop-panel__select"
              v-model="localConfig[field.key]"
              @change="emitConfig()"
            >
              <option
                v-for="option in field.options ?? []"
                :key="`${field.key}-${option}`"
                :value="option"
              >
                {{ option }}
              </option>
            </select>

            <input
              v-else-if="field.type === 'number'"
              type="number"
              class="ew-prop-panel__input"
              :min="field.min"
              :max="field.max"
              :step="field.step ?? 1"
              v-model.number="localConfig[field.key]"
              @change="emitConfig()"
            />

            <textarea
              v-else-if="field.type === 'textarea'"
              class="ew-prop-panel__textarea"
              :rows="field.rows ?? 4"
              :placeholder="field.placeholder"
              v-model="localConfig[field.key]"
              @change="emitConfig()"
            />

            <textarea
              v-else-if="field.type === 'json'"
              class="ew-prop-panel__textarea ew-prop-panel__textarea--json"
              :rows="field.rows ?? 5"
              :placeholder="field.placeholder"
              :value="toJsonFieldValue(field.key)"
              @change="onJsonChange(field.key, ($event.target as HTMLTextAreaElement).value)"
            />

            <input
              v-else
              :type="field.secret ? 'password' : 'text'"
              class="ew-prop-panel__input"
              :placeholder="field.placeholder"
              v-model="localConfig[field.key]"
              @change="emitConfig()"
            />
          </div>

          <div
            v-if="fallbackConfigEntries.length > 0"
            class="ew-prop-panel__section-subtitle"
          >
            其他配置
          </div>
          <div
            v-for="[key, val] in fallbackConfigEntries"
            :key="key"
            class="ew-prop-panel__field"
          >
            <label class="ew-prop-panel__field-label">{{ key }}</label>
            <button
              v-if="typeof val === 'boolean'"
              type="button"
              class="ew-prop-panel__switch"
              :class="{ active: localConfig[key] }"
              @click="localConfig[key] = !localConfig[key]; emitConfig()"
            >
              {{ localConfig[key] ? 'ON' : 'OFF' }}
            </button>
            <input
              v-else-if="typeof val === 'number'"
              type="number"
              class="ew-prop-panel__input"
              v-model.number="localConfig[key]"
              @change="emitConfig()"
            />
            <textarea
              v-else-if="typeof val === 'string' && val.length > 80"
              class="ew-prop-panel__textarea"
              v-model="localConfig[key]"
              @change="emitConfig()"
              rows="4"
            />
            <input
              v-else-if="typeof val === 'string'"
              type="text"
              class="ew-prop-panel__input"
              v-model="localConfig[key]"
              @change="emitConfig()"
            />
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
import type {
  ConfigFieldSchema,
  ModuleBlueprint,
  WorkbenchBuilderMode,
  WorkbenchNode,
} from "./module-types";
import {
  MODULE_REGISTRY,
  getModuleMetadataSurface,
  resolveModuleConfigWithDefaults,
} from "./module-registry";

const props = withDefaults(defineProps<{
  node: WorkbenchNode | null;
  builderMode?: WorkbenchBuilderMode;
  embedded?: boolean;
}>(), {
  builderMode: "advanced",
  embedded: false,
});

const emit = defineEmits<{
  (e: "close"): void;
  (e: "update-config", nodeId: string, config: Record<string, any>): void;
}>();

const blueprint = computed<ModuleBlueprint | null>(() => {
  if (!props.node) return null;
  return MODULE_REGISTRY.get(props.node.moduleId) ?? null;
});

const metadata = computed(() => {
  if (!props.node) {
    return null;
  }
  return getModuleMetadataSurface(props.node.moduleId) ?? null;
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
      Object.assign(
        localConfig,
        resolveModuleConfigWithDefaults(newNode.moduleId, newNode.config),
      );
    }
  },
  { immediate: true },
);

const configEntries = computed(() => {
  return Object.entries(localConfig).filter(([key]) => {
    // Filter out internal keys
    return !key.startsWith("_");
  });
});

const configSchema = computed<ConfigFieldSchema[]>(() => {
  if (blueprint.value?.configSchema?.length) {
    return blueprint.value.configSchema;
  }
  return (metadata.value?.config?.schemaFields ?? []).map((field) => ({
    key: field.key,
    label: field.label,
    type: "text",
    required: field.required,
    placeholder: field.defaultValueHint,
    description: field.description,
  }));
});

const visibleSchemaFields = computed(() => {
  if (configSchema.value.length === 0) {
    return [];
  }
  if (props.builderMode !== "simple") {
    return configSchema.value;
  }
  const recommendedFields = configSchema.value.filter(
    (field) => field.exposeInSimpleMode === true,
  );
  return recommendedFields.length > 0 ? recommendedFields : configSchema.value;
});

const fallbackConfigEntries = computed(() => {
  const knownSchemaKeys = new Set(configSchema.value.map((field) => field.key));
  if (configSchema.value.length === 0) {
    return configEntries.value;
  }
  if (props.builderMode === "simple") {
    return [];
  }
  return configEntries.value.filter(([key]) => !knownSchemaKeys.has(key));
});

const showSimpleModeHint = computed(() => {
  return (
    props.builderMode === "simple" &&
    configSchema.value.some((field) => field.exposeInSimpleMode === true)
  );
});

function emitConfig() {
  if (!props.node) return;
  emit("update-config", props.node.id, { ...localConfig });
}

function onJsonChange(key: string, raw: string) {
  try {
    localConfig[key] = JSON.parse(raw);
    emitConfig();
  } catch {
    // Invalid JSON, don't update
  }
}

function toggleBooleanField(key: string) {
  localConfig[key] = !localConfig[key];
  emitConfig();
}

function getDefaultHint(key: string): string | undefined {
  const schemaField = metadata.value?.config?.schemaFields?.find(
    (field) => field.key === key,
  );
  if (schemaField?.defaultValueHint) {
    return schemaField.defaultValueHint;
  }
  if (!blueprint.value) {
    return undefined;
  }
  const rawDefault = blueprint.value.defaultConfig?.[key];
  if (rawDefault === undefined) {
    return undefined;
  }
  if (typeof rawDefault === "string") {
    return rawDefault.length > 0 ? rawDefault : '""';
  }
  try {
    return JSON.stringify(rawDefault);
  } catch {
    return String(rawDefault);
  }
}

function toJsonFieldValue(key: string): string {
  try {
    return JSON.stringify(localConfig[key], null, 2);
  } catch {
    return "";
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

.ew-prop-panel.is-embedded {
  position: relative;
  top: auto;
  right: auto;
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 0;
  background: transparent;
  backdrop-filter: none;
  box-shadow: none;
}

.ew-prop-panel.is-embedded .ew-prop-panel__header {
  padding: 0 0 10px;
}

.ew-prop-panel.is-embedded .ew-prop-panel__desc {
  padding: 0 0 12px;
}

.ew-prop-panel.is-embedded .ew-prop-panel__body {
  padding: 0;
}

.ew-prop-panel.is-embedded .ew-prop-panel__section {
  padding: 6px 0 10px;
}

.ew-prop-panel.is-embedded .ew-prop-panel__close {
  display: none;
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

.ew-prop-panel__hint {
  margin-bottom: 8px;
  padding: 7px 8px;
  border-radius: 6px;
  background: rgba(59, 130, 246, 0.12);
  color: rgba(191, 219, 254, 0.92);
  font-size: 10px;
  line-height: 1.5;
}

.ew-prop-panel__section-subtitle {
  margin: 10px 0 6px;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.28);
}

.ew-prop-panel__field {
  margin-bottom: 8px;
}

.ew-prop-panel__field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 3px;
}

.ew-prop-panel__field-label {
  display: block;
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
}

.ew-prop-panel__field-badge {
  display: inline-flex;
  align-items: center;
  min-height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.16);
  color: #fbbf24;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.ew-prop-panel__field-help {
  display: grid;
  gap: 2px;
  margin-bottom: 5px;
  font-size: 10px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.38);
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

.ew-prop-panel__select {
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

.ew-prop-panel__select:focus {
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

.ew-prop-panel__slider {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ew-prop-panel__slider-input {
  flex: 1;
}

.ew-prop-panel__slider-value {
  min-width: 40px;
  text-align: right;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.7);
  font-family: "Consolas", "Monaco", monospace;
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
