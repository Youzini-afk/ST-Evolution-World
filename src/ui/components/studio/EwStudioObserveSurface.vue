<template>
  <div class="ew-studio-observe" :data-embedded="embedded ? '1' : '0'">
    <div class="ew-studio-observe__tabs">
      <button
        class="ew-studio-observe__tab"
        :class="{ active: activeTab === 'summary' }"
        @click="activeTab = 'summary'"
      >
        运行摘要
      </button>
      <button
        class="ew-studio-observe__tab"
        :class="{ active: activeTab === 'node' }"
        @click="activeTab = 'node'"
      >
        节点诊断
      </button>
      <button
        class="ew-studio-observe__tab"
        :class="{ active: activeTab === 'timeline' }"
        @click="activeTab = 'timeline'"
      >
        事件时间线
      </button>
    </div>

    <div v-if="activeTab === 'summary'" class="ew-studio-observe__stack">
      <template v-if="visibleActiveRunSummary">
        <div class="ew-studio-observe__chips">
          <span class="ew-studio-observe__chip">
            {{ visibleActiveRunSummary.statusLabel }}
          </span>
          <span class="ew-studio-observe__chip">
            {{ visibleActiveRunSummary.generationOwnershipLabel }}
          </span>
          <span class="ew-studio-observe__chip">
            {{ visibleActiveRunSummary.phaseLabel }}
          </span>
          <span class="ew-studio-observe__chip">
            {{ visibleActiveRunSummary.terminalOutcomeLabel }}
          </span>
        </div>
        <div class="ew-studio-observe__kv">
          <span>最近节点</span>
          <strong>{{ visibleActiveRunSummary.latestNodeLabel }}</strong>
        </div>
        <div class="ew-studio-observe__kv">
          <span>恢复资格</span>
          <strong>{{ visibleActiveRunSummary.recoveryEligibilityLabel }}</strong>
        </div>
        <div class="ew-studio-observe__kv">
          <span>waiting_user</span>
          <strong>{{ visibleActiveRunSummary.waitingUserLabel }}</strong>
        </div>
        <div class="ew-studio-observe__kv">
          <span>立即重试</span>
          <strong>{{ visibleActiveRunSummary.latestRetryLabel }}</strong>
        </div>
      </template>
      <template v-else-if="visibleDiagnosticsSummary">
        <div class="ew-studio-observe__chips">
          <span class="ew-studio-observe__chip">
            {{ visibleDiagnosticsSummary.runStatusLabel }}
          </span>
          <span class="ew-studio-observe__chip">
            指纹 {{ visibleDiagnosticsSummary.compileFingerprintShort }}
          </span>
          <span class="ew-studio-observe__chip">
            节点 {{ visibleDiagnosticsSummary.nodeCount }}
          </span>
          <span
            v-if="visibleDiagnosticsSummary.retryExhaustedNodeCount > 0"
            class="ew-studio-observe__chip"
          >
            重试耗尽 {{ visibleDiagnosticsSummary.retryExhaustedNodeCount }}
          </span>
        </div>
        <div class="ew-studio-observe__kv">
          <span>Reuse eligible</span>
          <strong>{{ visibleDiagnosticsSummary.reuseEligibleNodeCount }}</strong>
        </div>
        <div class="ew-studio-observe__kv">
          <span>控制流未激活</span>
          <strong>{{
            visibleDiagnosticsSummary.controlFlowSummary?.inactiveNodeIds.join("、") ||
            "无"
          }}</strong>
        </div>
      </template>
      <div v-else class="ew-studio-observe__empty">
        当前工作流还没有可展示的运行摘要。
      </div>
    </div>

    <div v-else-if="activeTab === 'node'" class="ew-studio-observe__stack">
      <template v-if="selectedNodeDiagnostics">
        <div class="ew-studio-observe__chips">
          <span class="ew-studio-observe__chip">
            dirty {{ selectedNodeDiagnostics.dirtyReasonLabel }}
          </span>
          <span class="ew-studio-observe__chip">
            reuse {{ selectedNodeDiagnostics.reuseVerdictLabel }}
          </span>
          <span class="ew-studio-observe__chip">
            {{ selectedNodeDiagnostics.retryLabel }}
          </span>
        </div>
        <div class="ew-studio-observe__kv">
          <span>节点</span>
          <strong>{{ selectedNodeDiagnostics.title }}</strong>
        </div>
        <div class="ew-studio-observe__kv">
          <span>输入概要</span>
          <strong>{{ selectedNodeDiagnostics.inputSourcesSummary }}</strong>
        </div>
        <div class="ew-studio-observe__kv">
          <span>控制流执行位形</span>
          <strong>{{ selectedNodeDiagnostics.controlFlowDispositionLabel }}</strong>
        </div>
        <p class="ew-studio-observe__text">
          {{ selectedNodeDiagnostics.disclaimer }}
        </p>
      </template>
      <div v-else class="ew-studio-observe__empty">
        还没有稳定的节点诊断视图；当前只保证最近关键节点与当前选中节点优先显示。
      </div>
    </div>

    <div v-else class="ew-studio-observe__stack">
      <template v-if="visibleRunEvents.length > 0">
        <div class="ew-studio-observe__timeline">
          <article
            v-for="event in visibleRunEvents"
            :key="`${event.timestamp}-${event.type}-${event.nodeId ?? 'graph'}`"
            class="ew-studio-observe__timeline-item"
          >
            <div class="ew-studio-observe__timeline-meta">
              <strong>{{ event.type }}</strong>
              <span>{{ formatEventTime(event.timestamp) }}</span>
            </div>
            <div class="ew-studio-observe__timeline-copy">
              {{
                [
                  event.phaseLabel,
                  event.moduleId,
                  event.nodeId,
                  event.error,
                ]
                  .filter((value): value is string => Boolean(value))
                  .join(" · ")
              }}
            </div>
          </article>
        </div>
      </template>
      <div v-else class="ew-studio-observe__empty">
        当前还没有事件时间线可展示。
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type {
  GraphActiveRunSummaryViewModel,
  GraphNodeDiagnosticsViewModel,
  GraphRunArtifact,
  GraphRunDiagnosticsSummaryViewModel,
  GraphRunEventRecordV1,
  WorkbenchGraph,
} from "../graph/module-types";

const props = withDefaults(
  defineProps<{
    graph: WorkbenchGraph | null;
    selectedNodeId?: string | null;
    diagnosticsSummary: GraphRunDiagnosticsSummaryViewModel | null;
    activeRunSummary: GraphActiveRunSummaryViewModel | null;
    runArtifact: GraphRunArtifact | null;
    runEvents?: GraphRunEventRecordV1[] | null;
    selectedNodeDiagnostics?: GraphNodeDiagnosticsViewModel | null;
    embedded?: boolean;
  }>(),
  {
    selectedNodeId: null,
    runEvents: null,
    selectedNodeDiagnostics: null,
    embedded: false,
  },
);

const activeTab = ref<"summary" | "node" | "timeline">("summary");

const visibleActiveRunSummary = computed(() => {
  if (!props.graph || !props.activeRunSummary) {
    return null;
  }
  return props.activeRunSummary.graphId === props.graph.id
    ? props.activeRunSummary
    : null;
});

const visibleDiagnosticsSummary = computed(() => {
  if (visibleActiveRunSummary.value?.diagnosticsSummary) {
    return visibleActiveRunSummary.value.diagnosticsSummary;
  }
  return props.diagnosticsSummary;
});

const visibleRunEvents = computed(() => {
  if (!props.graph) {
    return [];
  }
  return (props.runEvents ?? [])
    .filter((event) => event.graphId === props.graph?.id)
    .slice()
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, 80);
});

function formatEventTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "未知时间";
  }
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
</script>

<style scoped>
.ew-studio-observe {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.ew-studio-observe__tabs {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
}

.ew-studio-observe__tab {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.7);
  border-radius: 999px;
  padding: 7px 12px;
  cursor: pointer;
}

.ew-studio-observe__tab.active {
  background: rgba(99, 102, 241, 0.18);
  border-color: rgba(99, 102, 241, 0.36);
  color: rgba(255, 255, 255, 0.94);
}

.ew-studio-observe__stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.ew-studio-observe__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ew-studio-observe__chip,
.ew-studio-observe__timeline-item {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  border-radius: 12px;
}

.ew-studio-observe__chip {
  padding: 6px 10px;
  color: rgba(255, 255, 255, 0.82);
  font-size: 11px;
}

.ew-studio-observe__kv {
  display: grid;
  gap: 4px;
}

.ew-studio-observe__kv span {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.42);
}

.ew-studio-observe__kv strong {
  color: rgba(255, 255, 255, 0.92);
  font-size: 13px;
  line-height: 1.6;
}

.ew-studio-observe__text,
.ew-studio-observe__empty,
.ew-studio-observe__timeline-copy {
  margin: 0;
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  line-height: 1.6;
}

.ew-studio-observe__timeline {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow: auto;
}

.ew-studio-observe__timeline-item {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ew-studio-observe__timeline-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
}
</style>
