<template>
  <div class="ew-studio-tree">
    <div
      v-for="entry in entries"
      :key="entry.id"
      class="ew-studio-tree__entry"
      :data-kind="entry.kind"
    >
      <div
        class="ew-studio-tree__row"
        :class="{ active: selectedId === entry.id }"
      >
        <button
          v-if="entry.children.length > 0"
          type="button"
          class="ew-studio-tree__toggle"
          @click="toggleExpanded(entry.id)"
        >
          {{ expandedIds.has(entry.id) ? "▾" : "▸" }}
        </button>
        <span
          v-else
          class="ew-studio-tree__toggle ew-studio-tree__toggle--placeholder"
        >
          ·
        </span>
        <button
          type="button"
          class="ew-studio-tree__label"
          @click="$emit('select', entry.id)"
        >
          <span>{{ entry.label }}</span>
          <small v-if="entry.moduleId">{{ entry.moduleId }}</small>
        </button>
        <button
          v-if="entry.kind === 'module' && entry.moduleId && insertable"
          type="button"
          class="ew-studio-tree__insert"
          @click="$emit('insert', entry.moduleId)"
        >
          插入
        </button>
      </div>

      <div
        v-if="entry.children.length > 0 && expandedIds.has(entry.id)"
        class="ew-studio-tree__children"
      >
        <EwStudioComponentTree
          :entries="entry.children"
          :selected-id="selectedId"
          :insertable="insertable"
          @select="$emit('select', $event)"
          @insert="$emit('insert', $event)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { StudioComponentDirectoryEntry } from "../graph/studio-library";

const props = withDefaults(
  defineProps<{
    entries: StudioComponentDirectoryEntry[];
    selectedId?: string | null;
    insertable?: boolean;
  }>(),
  {
    selectedId: null,
    insertable: false,
  },
);

defineEmits<{
  (e: "select", entryId: string): void;
  (e: "insert", moduleId: string): void;
}>();

const expandedIds = reactive(new Set<string>());

watch(
  () => props.entries,
  (entries) => {
    expandedIds.clear();
    for (const entry of entries) {
      if (entry.kind === "group") {
        expandedIds.add(entry.id);
      }
    }
  },
  { immediate: true, deep: true },
);

function toggleExpanded(entryId: string) {
  if (expandedIds.has(entryId)) {
    expandedIds.delete(entryId);
  } else {
    expandedIds.add(entryId);
  }
}
</script>

<style scoped>
.ew-studio-tree {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.ew-studio-tree__entry {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ew-studio-tree__row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 2px;
  border-radius: 14px;
}

.ew-studio-tree__row.active {
  background: rgba(99, 102, 241, 0.16);
  box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.18);
}

.ew-studio-tree__toggle {
  width: 24px;
  min-width: 24px;
  height: 24px;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.72);
  cursor: pointer;
}

.ew-studio-tree__toggle--placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ew-studio-tree__label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.88);
  padding: 8px 10px;
  cursor: pointer;
  text-align: left;
}

.ew-studio-tree__label:hover {
  background: rgba(255, 255, 255, 0.06);
}

.ew-studio-tree__entry[data-kind="group"] > .ew-studio-tree__row .ew-studio-tree__label {
  background: rgba(255, 255, 255, 0.02);
  font-weight: 600;
}

.ew-studio-tree__label small {
  color: rgba(255, 255, 255, 0.44);
  font-size: 11px;
}

.ew-studio-tree__insert {
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.88);
  border-radius: 10px;
  padding: 6px 10px;
  cursor: pointer;
  white-space: nowrap;
}

.ew-studio-tree__children {
  margin-left: 18px;
  padding-left: 8px;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
}
</style>
