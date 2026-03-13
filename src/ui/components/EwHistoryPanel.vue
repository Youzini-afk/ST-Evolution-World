<template>
  <EwSectionCard title="楼层快照时间线" subtitle="每个楼层的 EW 条目变更记录。">
    <div class="hist-toolbar">
      <button type="button" class="ew-btn" :disabled="store.busy" @click="store.loadFloorSnapshots">🔄 刷新</button>
      <span class="hist-stats"> {{ hasSnapshotCount }} / {{ store.floorSnapshots.length }} 楼层有快照 </span>
    </div>

    <div v-if="store.floorSnapshots.length > 0" class="hist-grid-wrap">
      <div class="hist-grid">
        <div
          v-for="item in timelineItems"
          :key="item.floor.messageId"
          class="hist-block"
          :data-has-snapshot="item.floor.snapshot ? '1' : '0'"
          @click="openFloor(item.floor.messageId)"
        >
          <span class="hist-block-floor">#{{ item.floor.messageId }}</span>
          <div v-if="item.floor.snapshot" class="hist-block-changes">
            <span v-if="item.diff.created.length" class="hist-tag hist-tag--created">
              +{{ item.diff.created.length }}
            </span>
            <span v-if="item.diff.modified.length" class="hist-tag hist-tag--modified">
              ~{{ item.diff.modified.length }}
            </span>
            <span v-if="item.diff.deleted.length" class="hist-tag hist-tag--deleted">
              −{{ item.diff.deleted.length }}
            </span>
            <span v-if="item.diff.toggled.length" class="hist-tag hist-tag--toggled">
              ⇄{{ item.diff.toggled.length }}
            </span>
            <span v-if="Object.keys(item.diff.controllersChanged).length" class="hist-tag hist-tag--modified">
              ≈C{{ Object.keys(item.diff.controllersChanged).length }}
            </span>
          </div>
          <div v-else class="hist-block-empty">—</div>
        </div>
      </div>
    </div>
    <div v-else class="hist-empty">暂无楼层数据。点击「刷新」加载。</div>
  </EwSectionCard>

  <EwFloorDetailModal
    :visible="modalVisible"
    :floor-id="selectedFloorId"
    :snapshot="selectedSnapshot"
    :prev-snapshot="selectedPrevSnapshot"
    @close="modalVisible = false"
  />
</template>

<script setup lang="ts">
import { diffSnapshots, type SnapshotDiff } from '../../runtime/floor-binding';
import type { SnapshotData } from '../../runtime/snapshot-storage';
import { useEwStore } from '../store';
import EwFloorDetailModal from './EwFloorDetailModal.vue';
import EwSectionCard from './EwSectionCard.vue';

const store = useEwStore();
const modalVisible = ref(false);
const selectedFloorId = ref(0);

const hasSnapshotCount = computed(() => store.floorSnapshots.filter(f => f.snapshot !== null).length);

const selectedSnapshot = computed<SnapshotData | null>(() => {
  const floor = store.floorSnapshots.find(f => f.messageId === selectedFloorId.value);
  return floor?.snapshot ?? null;
});

const selectedPrevSnapshot = computed<SnapshotData | null>(() => {
  const idx = store.floorSnapshots.findIndex(f => f.messageId === selectedFloorId.value);
  if (idx <= 0) return null;
  // 查找最近的拥有快照的前一楼层
  for (let i = idx - 1; i >= 0; i--) {
    if (store.floorSnapshots[i].snapshot) return store.floorSnapshots[i].snapshot;
  }
  return null;
});

const emptyDiff: SnapshotDiff = { created: [], modified: [], deleted: [], toggled: [], controllersChanged: {} };
const timelineItems = computed(() => {
  const items: Array<{ floor: (typeof store.floorSnapshots)[number]; diff: SnapshotDiff }> = [];
  let previousSnapshot: SnapshotData | null = null;

  for (const floor of store.floorSnapshots) {
    const currentSnapshot = floor.snapshot;
    const diff = diffSnapshots(previousSnapshot, currentSnapshot) ?? emptyDiff;
    items.push({ floor, diff });
    if (currentSnapshot) {
      previousSnapshot = currentSnapshot;
    }
  }

  return items;
});

function openFloor(messageId: number) {
  selectedFloorId.value = messageId;
  modalVisible.value = true;
}
</script>

<style scoped>
.hist-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.hist-stats {
  font-size: 0.78rem;
  color: color-mix(in srgb, var(--SmartThemeBodyColor) 55%, transparent);
}

/* ── Grid ── */
.hist-grid-wrap {
  max-height: calc(4 * 5.5rem + 3 * 0.4rem);
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
}

.hist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 0.4rem;
}

.hist-block {
  border-radius: 0.65rem;
  border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 25%, transparent);
  background: color-mix(in srgb, var(--SmartThemeQuoteColor, #7f92ab) 8%, rgba(0, 0, 0, 0.12));
  padding: 0.5rem;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    transform 0.15s ease,
    box-shadow 0.2s ease;
  min-height: 4.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.hist-block:hover {
  border-color: color-mix(in srgb, var(--ew-accent, #818cf8) 50%, transparent);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--ew-accent, #818cf8) 15%, transparent);
}

.hist-block[data-has-snapshot='0'] {
  opacity: 0.4;
}

.hist-block-floor {
  font-size: 0.75rem;
  font-weight: 700;
  color: color-mix(in srgb, var(--SmartThemeBodyColor) 80%, transparent);
}

.hist-block-changes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem;
}

.hist-tag {
  font-size: 0.62rem;
  font-weight: 700;
  padding: 0.1rem 0.35rem;
  border-radius: 0.3rem;
  line-height: 1.3;
}

.hist-tag--created {
  background: color-mix(in srgb, #22c55e 20%, transparent);
  color: #86efac;
}
.hist-tag--modified {
  background: color-mix(in srgb, #f59e0b 20%, transparent);
  color: #fcd34d;
}
.hist-tag--deleted {
  background: color-mix(in srgb, #ef4444 20%, transparent);
  color: #fca5a5;
}
.hist-tag--toggled {
  background: color-mix(in srgb, #6366f1 20%, transparent);
  color: #a5b4fc;
}

.hist-block-empty {
  font-size: 0.7rem;
  color: color-mix(in srgb, var(--SmartThemeBodyColor) 30%, transparent);
}

.hist-empty {
  font-size: 0.78rem;
  color: color-mix(in srgb, var(--SmartThemeBodyColor) 45%, transparent);
  font-style: italic;
  padding: 0.5rem 0;
}

/* ── Buttons ── */
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

/* ── Mobile ── */
@media (max-width: 768px) {
  .hist-grid {
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  }
  .hist-block {
    min-height: 3.5rem;
    padding: 0.35rem;
  }
  .hist-block-floor {
    font-size: 0.68rem;
  }
  .hist-tag {
    font-size: 0.58rem;
  }
}
</style>
