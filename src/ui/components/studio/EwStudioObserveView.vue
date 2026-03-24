<template>
  <div class="ew-studio-observe-page">
    <div class="ew-studio-observe-page__header">
      <div>
        <div class="ew-studio-observe-page__eyebrow">Observe</div>
        <h2 class="ew-studio-observe-page__title">运行观测</h2>
      </div>
      <p class="ew-studio-observe-page__copy">
        观测页围绕当前工作流展开；历史与调试作为补充入口保留。
      </p>
    </div>

    <div class="ew-studio-observe-page__tabs">
      <button
        class="ew-studio-observe-page__tab"
        :class="{ active: activeTab === 'current' }"
        @click="activeTab = 'current'"
      >
        当前工作流
      </button>
      <button
        class="ew-studio-observe-page__tab"
        :class="{ active: activeTab === 'history' }"
        @click="activeTab = 'history'"
      >
        历史
      </button>
      <button
        class="ew-studio-observe-page__tab"
        :class="{ active: activeTab === 'debug' }"
        @click="activeTab = 'debug'"
      >
        调试
      </button>
    </div>

    <template v-if="activeTab === 'current'">
      <div class="ew-studio-observe-page__summary-card">
        <span class="ew-studio-observe-page__summary-label">当前图</span>
        <strong>{{ graph?.name || "未选择工作流" }}</strong>
      </div>
      <EwStudioObserveSurface
        :graph="graph"
        :diagnostics-summary="diagnosticsSummary"
        :active-run-summary="activeRunSummary"
        :run-artifact="runArtifact"
        :run-events="runEvents"
        :selected-node-diagnostics="selectedNodeDiagnostics"
      />
    </template>
    <EwHistoryPanel v-else-if="activeTab === 'history'" />
    <EwDebugPanel v-else />
  </div>
</template>

<script setup lang="ts">
import EwDebugPanel from "../EwDebugPanel.vue";
import EwHistoryPanel from "../EwHistoryPanel.vue";
import EwStudioObserveSurface from "./EwStudioObserveSurface.vue";
import type {
  GraphActiveRunSummaryViewModel,
  GraphNodeDiagnosticsViewModel,
  GraphRunArtifact,
  GraphRunDiagnosticsSummaryViewModel,
  GraphRunEventRecordV1,
  WorkbenchGraph,
} from "../graph/module-types";

withDefaults(
  defineProps<{
    graph: WorkbenchGraph | null;
    diagnosticsSummary: GraphRunDiagnosticsSummaryViewModel | null;
    activeRunSummary: GraphActiveRunSummaryViewModel | null;
    runArtifact: GraphRunArtifact | null;
    runEvents?: GraphRunEventRecordV1[] | null;
    selectedNodeDiagnostics?: GraphNodeDiagnosticsViewModel | null;
  }>(),
  {
    runEvents: null,
    selectedNodeDiagnostics: null,
  },
);

const activeTab = ref<"current" | "history" | "debug">("current");
</script>

<style scoped>
.ew-studio-observe-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}

.ew-studio-observe-page__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.ew-studio-observe-page__eyebrow {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.42);
}

.ew-studio-observe-page__title {
  margin: 4px 0 0;
  font-size: 18px;
  color: rgba(255, 255, 255, 0.94);
}

.ew-studio-observe-page__copy {
  margin: 0;
  max-width: 460px;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.72);
}

.ew-studio-observe-page__tabs {
  display: inline-flex;
  gap: 6px;
}

.ew-studio-observe-page__tab {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.7);
  border-radius: 999px;
  padding: 8px 14px;
  cursor: pointer;
}

.ew-studio-observe-page__tab.active {
  background: rgba(99, 102, 241, 0.18);
  border-color: rgba(99, 102, 241, 0.36);
  color: rgba(255, 255, 255, 0.94);
}

.ew-studio-observe-page__summary-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(8, 12, 24, 0.68);
  border-radius: 16px;
  padding: 14px;
  display: grid;
  gap: 4px;
}

.ew-studio-observe-page__summary-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.42);
}

.ew-studio-observe-page__summary-card strong {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.92);
}

@media (max-width: 980px) {
  .ew-studio-observe-page__header {
    flex-direction: column;
  }
}
</style>
