<template>
  <div class="ew-module-palette" :class="{ collapsed: isCollapsed }">
    <button
      class="ew-module-palette__toggle"
      @click="isCollapsed = !isCollapsed"
      :title="isCollapsed ? '展开模块面板' : '收起模块面板'"
    >
      {{ isCollapsed ? '▸' : '◂' }}
    </button>

    <div v-show="!isCollapsed" class="ew-module-palette__content">
      <!-- Search -->
      <div class="ew-module-palette__search">
        <input
          v-model="searchQuery"
          type="text"
          class="ew-module-palette__search-input"
          placeholder="搜索模块…"
        />
      </div>

      <!-- Categories -->
      <div
        v-for="cat in filteredCategories"
        :key="cat.id"
        class="ew-module-palette__category"
      >
        <button
          class="ew-module-palette__cat-header"
          @click="toggleCategory(cat.id)"
        >
          <span class="ew-module-palette__cat-icon">{{ cat.icon }}</span>
          <span class="ew-module-palette__cat-label">{{ cat.label }}</span>
          <span class="ew-module-palette__cat-count">{{ getModulesForCategory(cat.id).length }}</span>
          <span class="ew-module-palette__cat-arrow">{{ expandedCategories.has(cat.id) ? '▾' : '▸' }}</span>
        </button>

        <div v-show="expandedCategories.has(cat.id)" class="ew-module-palette__cat-body">
          <div
            v-for="mod in getModulesForCategory(cat.id)"
            :key="mod.moduleId"
            class="ew-module-palette__item"
            :style="{ '--accent': mod.color }"
            draggable="true"
            @dragstart="onDragStart($event, mod.moduleId)"
            :title="mod.description"
          >
            <span class="ew-module-palette__item-icon">{{ mod.icon }}</span>
            <span class="ew-module-palette__item-label">{{ mod.label }}</span>
            <span v-if="mod.isComposite" class="ew-module-palette__item-badge">包</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { MODULE_CATEGORIES, type ModuleCategory } from './module-types';
import { MODULE_REGISTRY, getModulesByCategory, type ModuleBlueprint } from './module-registry';

const searchQuery = ref('');
const isCollapsed = ref(false);
const expandedCategories = reactive(new Set<string>(['source', 'filter', 'compose', 'execute']));

function toggleCategory(catId: string) {
  if (expandedCategories.has(catId)) {
    expandedCategories.delete(catId);
  } else {
    expandedCategories.add(catId);
  }
}

function getModulesForCategory(catId: string): ModuleBlueprint[] {
  const mods = getModulesByCategory(catId);
  if (!searchQuery.value.trim()) return mods;
  const q = searchQuery.value.trim().toLowerCase();
  return mods.filter(m =>
    m.label.toLowerCase().includes(q) ||
    m.description.toLowerCase().includes(q) ||
    m.moduleId.toLowerCase().includes(q)
  );
}

const filteredCategories = computed(() => {
  if (!searchQuery.value.trim()) return MODULE_CATEGORIES;
  return MODULE_CATEGORIES.filter(cat => getModulesForCategory(cat.id).length > 0);
});

function onDragStart(e: DragEvent, moduleId: string) {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData('application/ew-module', moduleId);
  e.dataTransfer.effectAllowed = 'copy';
}
</script>

<style scoped>
.ew-module-palette {
  position: relative;
  width: 200px;
  min-width: 200px;
  background: rgba(10, 10, 25, 0.92);
  backdrop-filter: blur(16px);
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  font-family: system-ui, -apple-system, sans-serif;
  transition: width 0.25s ease, min-width 0.25s ease;
  z-index: 10;
}

.ew-module-palette.collapsed {
  width: 28px;
  min-width: 28px;
}

.ew-module-palette__toggle {
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

.ew-module-palette__toggle:hover {
  background: rgba(255, 255, 255, 0.15);
  color: white;
}

/* Search */
.ew-module-palette__search {
  padding: 28px 8px 4px;
}

.ew-module-palette__search-input {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.85);
  font-size: 11px;
  outline: none;
  transition: border-color 0.15s;
}

.ew-module-palette__search-input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.ew-module-palette__search-input:focus {
  border-color: rgba(99, 102, 241, 0.5);
}

.ew-module-palette__content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 8px;
}

/* Category header */
.ew-module-palette__cat-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  background: none;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  transition: color 0.15s, background 0.15s;
}

.ew-module-palette__cat-header:hover {
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.03);
}

.ew-module-palette__cat-icon {
  font-size: 12px;
  width: 16px;
  text-align: center;
}

.ew-module-palette__cat-label {
  flex: 1;
  text-align: left;
}

.ew-module-palette__cat-count {
  font-size: 9px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.25);
  min-width: 16px;
  text-align: center;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 0 4px;
}

.ew-module-palette__cat-arrow {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.3);
  width: 12px;
  text-align: center;
}

/* Module item */
.ew-module-palette__cat-body {
  padding: 0 6px 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ew-module-palette__item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.04);
  cursor: grab;
  transition: all 0.15s ease;
  user-select: none;
}

.ew-module-palette__item:hover {
  background: color-mix(in srgb, var(--accent, #6366f1) 15%, transparent);
  border-color: color-mix(in srgb, var(--accent, #6366f1) 25%, transparent);
  transform: translateX(2px);
}

.ew-module-palette__item:active {
  cursor: grabbing;
  transform: scale(0.97);
}

.ew-module-palette__item-icon {
  font-size: 12px;
  flex-shrink: 0;
  width: 16px;
  text-align: center;
}

.ew-module-palette__item-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.72);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.ew-module-palette__item-badge {
  font-size: 8px;
  font-weight: 700;
  color: rgba(255, 200, 100, 0.9);
  background: rgba(255, 200, 100, 0.15);
  border-radius: 3px;
  padding: 1px 4px;
  flex-shrink: 0;
  letter-spacing: 0.5px;
}

/* Scrollbar */
.ew-module-palette::-webkit-scrollbar {
  width: 4px;
}

.ew-module-palette::-webkit-scrollbar-track {
  background: transparent;
}

.ew-module-palette::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}

.ew-module-palette::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}
</style>
