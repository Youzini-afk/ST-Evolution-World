<template>
  <Teleport to="body">
    <transition name="hist-modal">
      <div v-if="visible" class="hist-modal-overlay" @click.self="$emit('close')">
        <div class="hist-modal-container">
          <!-- Header -->
          <header class="hist-modal-header">
            <h3 class="hist-modal-title">
              {{ isComparing ? '楼层对比' : `楼层 #${floorId}` }}
            </h3>
            <button type="button" class="hist-modal-close" @click="$emit('close')">✕</button>
          </header>

          <!-- Normal Detail View -->
          <div v-if="!isComparing" class="hist-modal-body">
            <div v-if="diff" class="hist-changes">
              <div
                v-for="[controllerKey, change] in Object.entries(diff.controllersChanged)"
                :key="`ctrl-${controllerKey}`"
                class="hist-change-item hist-change--modified"
              >
                <span class="hist-change-icon">≈</span>
                <span>Controller {{ controllerKey }} · {{ change }}</span>
              </div>
              <div v-for="name in diff.created" :key="'c-' + name" class="hist-change-item hist-change--created">
                <span class="hist-change-icon">+</span>
                <span class="hist-change-name">{{ name }}</span>
              </div>
              <div v-for="name in diff.modified" :key="'m-' + name" class="hist-change-item hist-change--modified">
                <span class="hist-change-icon">~</span>
                <span class="hist-change-name">{{ name }}</span>
              </div>
              <div v-for="name in diff.deleted" :key="'d-' + name" class="hist-change-item hist-change--deleted">
                <span class="hist-change-icon">−</span>
                <span class="hist-change-name">{{ name }}</span>
              </div>
              <div v-for="name in diff.toggled" :key="'t-' + name" class="hist-change-item hist-change--toggled">
                <span class="hist-change-icon">⇄</span>
                <span class="hist-change-name">{{ name }}</span>
              </div>
              <div
                v-if="
                  !diff.created.length &&
                  !diff.modified.length &&
                  !diff.deleted.length &&
                  !diff.toggled.length &&
                  !Object.keys(diff.controllersChanged).length
                "
                class="hist-empty"
              >
                此楼层无变更。
              </div>
            </div>
            <div v-else class="hist-empty">此楼层无快照数据。</div>

            <!-- Snapshot content -->
            <div v-if="snapshot" class="hist-snapshot-detail">
              <h4 class="hist-sub-title">快照内容</h4>
              <div
                v-for="controller in snapshot.controllers"
                :key="controller.entry_name || controller.flow_id || controller.flow_name"
                class="hist-detail-block"
              >
                <strong>Controller · {{ controller.flow_name || controller.flow_id || 'Legacy' }}</strong>
                <pre>{{ truncate(controller.content, 500) }}</pre>
              </div>
              <div v-for="entry in snapshot.dyn_entries" :key="entry.name" class="hist-detail-block">
                <strong>
                  <span class="hist-enabled-dot" :data-enabled="entry.enabled ? '1' : '0'" />
                  {{ entry.name }}
                </strong>
                <pre>{{ truncate(entry.content, 300) }}</pre>
              </div>
            </div>

            <!-- Actions -->
            <div class="hist-modal-actions">
              <button type="button" class="ew-btn" :disabled="store.busy" @click="doRollback">↩ 回滚到此楼层</button>
              <button type="button" class="ew-btn" @click="startCompare">⇋ 对比其他楼层</button>
            </div>
          </div>

          <!-- Compare View -->
          <div v-else class="hist-modal-body">
            <div class="hist-compare-select">
              <label>对比目标楼层：</label>
              <select v-model="compareTargetId" class="hist-select">
                <option v-for="floor in otherFloors" :key="floor.messageId" :value="floor.messageId">
                  #{{ floor.messageId }}
                </option>
              </select>
              <button type="button" class="ew-btn ew-btn--sm" @click="isComparing = false">取消对比</button>
            </div>

            <div v-if="compareTargetId !== null" class="hist-diff-view">
              <!-- Left: current floor -->
              <div class="hist-diff-col">
                <h4 class="hist-diff-title">楼层 #{{ floorId }}</h4>
                <div v-if="snapshot" class="hist-diff-entries">
                  <div
                    v-for="controller in snapshot.controllers"
                    :key="`left-${controller.entry_name || controller.flow_id || controller.flow_name}`"
                    class="hist-diff-entry"
                  >
                    <strong>Controller · {{ controller.flow_name || controller.flow_id || 'Legacy' }}</strong>
                    <pre>{{ truncate(controller.content, 300) }}</pre>
                  </div>
                  <div
                    v-for="e in snapshot.dyn_entries"
                    :key="e.name"
                    class="hist-diff-entry"
                    :class="diffEntryClass(e.name, 'left')"
                  >
                    <strong>{{ e.name }}</strong>
                    <pre>{{ truncate(e.content, 200) }}</pre>
                  </div>
                </div>
                <div v-else class="hist-empty">无快照</div>
              </div>
              <!-- Right: compare target -->
              <div class="hist-diff-col">
                <h4 class="hist-diff-title">楼层 #{{ compareTargetId }}</h4>
                <div v-if="compareSnapshot" class="hist-diff-entries">
                  <div
                    v-for="controller in compareSnapshot.controllers"
                    :key="`right-${controller.entry_name || controller.flow_id || controller.flow_name}`"
                    class="hist-diff-entry"
                  >
                    <strong>Controller · {{ controller.flow_name || controller.flow_id || 'Legacy' }}</strong>
                    <pre>{{ truncate(controller.content, 300) }}</pre>
                  </div>
                  <div
                    v-for="e in compareSnapshot.dyn_entries"
                    :key="e.name"
                    class="hist-diff-entry"
                    :class="diffEntryClass(e.name, 'right')"
                  >
                    <strong>{{ e.name }}</strong>
                    <pre>{{ truncate(e.content, 200) }}</pre>
                  </div>
                </div>
                <div v-else class="hist-empty">无快照</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import { diffSnapshots, type SnapshotDiff } from '../../runtime/floor-binding';
import type { SnapshotData } from '../../runtime/snapshot-storage';
import { useEwStore } from '../store';

const props = defineProps<{
  visible: boolean;
  floorId: number;
  snapshot: SnapshotData | null;
  prevSnapshot: SnapshotData | null;
}>();

defineEmits<{
  (e: 'close'): void;
}>();

const store = useEwStore();
const isComparing = ref(false);
const compareTargetId = ref<number | null>(null);

const diff = computed<SnapshotDiff | null>(() => {
  if (!props.snapshot) return null;
  return diffSnapshots(props.prevSnapshot, props.snapshot);
});

const otherFloors = computed(() =>
  store.floorSnapshots.filter(f => f.messageId !== props.floorId && f.snapshot !== null),
);

const compareSnapshot = computed<SnapshotData | null>(() => {
  if (compareTargetId.value === null) return null;
  const floor = store.floorSnapshots.find(f => f.messageId === compareTargetId.value);
  return floor?.snapshot ?? null;
});

// 计算跨楼层 diff，用于对比视图中的条目着色
const crossDiff = computed<SnapshotDiff | null>(() => {
  if (!props.snapshot || !compareSnapshot.value) return null;
  return diffSnapshots(props.snapshot, compareSnapshot.value);
});

function diffEntryClass(name: string, side: 'left' | 'right'): string {
  if (!crossDiff.value) return '';
  if (side === 'left') {
    if (crossDiff.value.deleted.includes(name)) return 'hist-diff--deleted';
    if (crossDiff.value.modified.includes(name)) return 'hist-diff--modified';
    return '';
  }
  if (crossDiff.value.created.includes(name)) return 'hist-diff--created';
  if (crossDiff.value.modified.includes(name)) return 'hist-diff--modified';
  return '';
}

function doRollback() {
  store.doRollbackToFloor(props.floorId);
}

function startCompare() {
  isComparing.value = true;
  const first = otherFloors.value[0];
  compareTargetId.value = first ? first.messageId : null;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…';
}
</script>

<style scoped>
.hist-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.hist-modal-container {
  width: 100%;
  max-width: 760px;
  max-height: 85vh;
  border-radius: 1rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 30%, transparent);
  background: color-mix(in srgb, var(--SmartThemeChatMesColorBg, #1a1f2e) 95%, transparent);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.hist-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor) 20%, transparent);
}

.hist-modal-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--SmartThemeBodyColor, #edf2f9);
}

.hist-modal-close {
  background: none;
  border: none;
  color: color-mix(in srgb, var(--SmartThemeBodyColor) 60%, transparent);
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0.25rem;
  transition: color 0.2s;
}
.hist-modal-close:hover {
  color: var(--SmartThemeBodyColor);
}

.hist-modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 1.25rem;
}

/* ── Changes List ── */
.hist-changes {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 1rem;
}

.hist-change-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.6rem;
  border-radius: 0.5rem;
  font-size: 0.8rem;
}

.hist-change-icon {
  width: 1.2rem;
  text-align: center;
  font-weight: 700;
  flex-shrink: 0;
}

.hist-change-name {
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 0.78rem;
}

.hist-change--created {
  background: color-mix(in srgb, #22c55e 12%, transparent);
  color: #86efac;
}
.hist-change--created .hist-change-icon {
  color: #22c55e;
}

.hist-change--modified {
  background: color-mix(in srgb, #f59e0b 12%, transparent);
  color: #fcd34d;
}
.hist-change--modified .hist-change-icon {
  color: #f59e0b;
}

.hist-change--deleted {
  background: color-mix(in srgb, #ef4444 12%, transparent);
  color: #fca5a5;
}
.hist-change--deleted .hist-change-icon {
  color: #ef4444;
}

.hist-change--toggled {
  background: color-mix(in srgb, #6366f1 12%, transparent);
  color: #a5b4fc;
}
.hist-change--toggled .hist-change-icon {
  color: #6366f1;
}

/* ── Snapshot Detail ── */
.hist-snapshot-detail {
  margin-top: 0.75rem;
}

.hist-sub-title {
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: color-mix(in srgb, var(--SmartThemeBodyColor) 80%, transparent);
}

.hist-detail-block {
  border-radius: 0.5rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor) 20%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor) 6%, rgba(0, 0, 0, 0.1));
  padding: 0.5rem 0.65rem;
  margin-bottom: 0.4rem;
}

.hist-detail-block strong {
  font-size: 0.78rem;
  color: color-mix(in srgb, var(--SmartThemeBodyColor) 75%, transparent);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.hist-detail-block pre {
  margin: 0.3rem 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.7rem;
  line-height: 1.5;
  color: color-mix(in srgb, var(--SmartThemeBodyColor) 65%, transparent);
  font-family: 'Fira Code', 'Consolas', monospace;
  max-height: 8rem;
  overflow: auto;
}

.hist-enabled-dot {
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: color-mix(in srgb, var(--ew-danger, #ef4444) 60%, transparent);
}
.hist-enabled-dot[data-enabled='1'] {
  background: var(--ew-success, #22c55e);
}

/* ── Actions ── */
.hist-modal-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor) 15%, transparent);
}

/* ── Compare ── */
.hist-compare-select {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  font-size: 0.82rem;
  color: var(--SmartThemeBodyColor);
}

.hist-select {
  flex: 1;
  min-width: 0;
  border-radius: 0.5rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor) 40%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor) 12%, transparent);
  color: var(--SmartThemeBodyColor);
  font-size: 0.8rem;
  padding: 0.35rem 0.5rem;
}

.hist-diff-view {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.hist-diff-col {
  border-radius: 0.75rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor) 20%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor) 5%, rgba(0, 0, 0, 0.08));
  padding: 0.65rem;
  overflow: hidden;
}

.hist-diff-title {
  margin: 0 0 0.5rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: color-mix(in srgb, var(--SmartThemeBodyColor) 80%, transparent);
}

.hist-diff-entries {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.hist-diff-entry {
  border-radius: 0.4rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid transparent;
}

.hist-diff-entry strong {
  font-size: 0.72rem;
  color: color-mix(in srgb, var(--SmartThemeBodyColor) 70%, transparent);
}

.hist-diff-entry pre {
  margin: 0.2rem 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.68rem;
  line-height: 1.4;
  color: color-mix(in srgb, var(--SmartThemeBodyColor) 55%, transparent);
  font-family: 'Fira Code', 'Consolas', monospace;
  max-height: 6rem;
  overflow: auto;
}

.hist-diff--created {
  background: color-mix(in srgb, #22c55e 10%, transparent);
  border-color: color-mix(in srgb, #22c55e 25%, transparent);
}
.hist-diff--modified {
  background: color-mix(in srgb, #f59e0b 10%, transparent);
  border-color: color-mix(in srgb, #f59e0b 25%, transparent);
}
.hist-diff--deleted {
  background: color-mix(in srgb, #ef4444 10%, transparent);
  border-color: color-mix(in srgb, #ef4444 25%, transparent);
}

/* ── Shared ── */
.hist-empty {
  font-size: 0.78rem;
  color: color-mix(in srgb, var(--SmartThemeBodyColor) 45%, transparent);
  font-style: italic;
  padding: 0.5rem 0;
}

/* ── Buttons (from App scoped) ── */
.ew-btn {
  border-radius: 0.75rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 45%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 20%, transparent);
  color: var(--SmartThemeBodyColor, #edf2f9);
  font-size: 0.8rem;
  font-weight: 600;
  padding: 0.4rem 0.85rem;
  cursor: pointer;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 0.2s ease;
}
.ew-btn:hover {
  border-color: var(--ew-accent);
  background: color-mix(in srgb, var(--ew-accent) 25%, transparent);
  color: #fff;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px var(--ew-accent-glow);
}
.ew-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}
.ew-btn--sm {
  font-size: 0.72rem;
  padding: 0.3rem 0.6rem;
}

/* ── Transition ── */
.hist-modal-enter-active,
.hist-modal-leave-active {
  transition: opacity 0.25s ease;
}
.hist-modal-enter-active .hist-modal-container,
.hist-modal-leave-active .hist-modal-container {
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.hist-modal-enter-from,
.hist-modal-leave-to {
  opacity: 0;
}
.hist-modal-enter-from .hist-modal-container {
  transform: scale(0.95) translateY(10px);
}
.hist-modal-leave-to .hist-modal-container {
  transform: scale(0.95) translateY(10px);
}

/* ── Mobile ── */
@media (max-width: 768px) {
  .hist-modal-overlay {
    padding: 0;
    align-items: stretch;
  }
  .hist-modal-container {
    max-width: 100%;
    max-height: 100vh;
    border-radius: 0;
  }
  .hist-diff-view {
    grid-template-columns: 1fr;
  }
}
</style>
