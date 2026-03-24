<template>
  <div class="ew-studio-assets">
    <div class="ew-studio-assets__header">
      <div>
        <div class="ew-studio-assets__eyebrow">Assets</div>
        <h2 class="ew-studio-assets__title">资产库</h2>
      </div>
      <p class="ew-studio-assets__copy">
        在进入编辑器之前，先选模板入口，或者逐层查看统一构件体系。
      </p>
    </div>

    <div class="ew-studio-assets__tabs">
      <button
        class="ew-studio-assets__tab"
        :class="{ active: activeTab === 'templates' }"
        @click="activeTab = 'templates'"
      >
        模板
      </button>
      <button
        class="ew-studio-assets__tab"
        :class="{ active: activeTab === 'components' }"
        @click="activeTab = 'components'"
      >
        构件
      </button>
    </div>

    <div class="ew-studio-assets__body">
      <template v-if="activeTab === 'templates'">
        <aside class="ew-studio-assets__master">
          <button
            v-for="template in templates"
            :key="template.id"
            class="ew-studio-assets__list-item"
            :class="{ active: selectedTemplateId === template.id }"
            @click="selectedTemplateId = template.id"
          >
            <strong>{{ template.label }}</strong>
            <span>{{ template.summary }}</span>
          </button>
        </aside>
        <section class="ew-studio-assets__detail">
          <template v-if="selectedTemplate">
            <div class="ew-studio-assets__chips">
              <span
                v-if="selectedTemplate.featured"
                class="ew-studio-assets__chip"
              >
                精选
              </span>
              <span class="ew-studio-assets__chip">
                {{ formatTemplateKind(selectedTemplate.templateKind) }}
              </span>
              <span class="ew-studio-assets__chip">
                {{ formatTemplateFeatureFamily(selectedTemplate.featureFamily) }}
              </span>
              <span class="ew-studio-assets__chip">
                {{ formatBuilderMode(selectedTemplate.recommendedBuilderMode) }}
              </span>
            </div>
            <h3 class="ew-studio-assets__detail-title">
              {{ selectedTemplate.label }}
            </h3>
            <p class="ew-studio-assets__detail-text">
              {{ selectedTemplate.description }}
            </p>

            <div
              v-if="selectedTemplate.learningHighlights.length > 0"
              class="ew-studio-assets__detail-block"
            >
              <div class="ew-studio-assets__label">学习重点</div>
              <div class="ew-studio-assets__tags">
                <span
                  v-for="highlight in selectedTemplate.learningHighlights"
                  :key="`${selectedTemplate.id}-learning-${highlight}`"
                  class="ew-studio-assets__tag"
                >
                  {{ highlight }}
                </span>
              </div>
            </div>

            <div
              v-if="selectedTemplate.contractPreview.length > 0"
              class="ew-studio-assets__detail-block"
            >
              <div class="ew-studio-assets__label">Contract 预览</div>
              <div class="ew-studio-assets__tags">
                <span
                  v-for="preview in selectedTemplate.contractPreview"
                  :key="`${selectedTemplate.id}-contract-${preview}`"
                  class="ew-studio-assets__tag"
                >
                  {{ preview }}
                </span>
              </div>
            </div>

            <div
              v-if="selectedTemplate.structurePreview.length > 0"
              class="ew-studio-assets__detail-block"
            >
              <div class="ew-studio-assets__label">内部关键积木</div>
              <div class="ew-studio-assets__tags">
                <span
                  v-for="item in selectedTemplate.structurePreview"
                  :key="`${selectedTemplate.id}-structure-${item.role}-${item.moduleId}`"
                  class="ew-studio-assets__tag"
                >
                  {{ formatStructureItem(item) }}
                </span>
              </div>
            </div>

            <template v-if="selectedTemplateFacts">
              <div class="ew-studio-assets__detail-block">
                <div class="ew-studio-assets__label">图规模</div>
                <div class="ew-studio-assets__tags">
                  <span class="ew-studio-assets__tag">
                    节点 {{ selectedTemplateFacts.nodeCount }}
                  </span>
                  <span class="ew-studio-assets__tag">
                    连线 {{ selectedTemplateFacts.edgeCount }}
                  </span>
                  <span
                    v-if="selectedTemplateFacts.controlNodeCount > 0"
                    class="ew-studio-assets__tag"
                  >
                    控制节点 {{ selectedTemplateFacts.controlNodeCount }}
                  </span>
                  <span
                    v-if="selectedTemplateFacts.retryBoundaryCount > 0"
                    class="ew-studio-assets__tag"
                  >
                    重试边界 {{ selectedTemplateFacts.retryBoundaryCount }}
                  </span>
                </div>
              </div>
              <div
                v-if="selectedTemplateFacts.capabilities.length > 0"
                class="ew-studio-assets__detail-block"
              >
                <div class="ew-studio-assets__label">能力轮廓</div>
                <div class="ew-studio-assets__tags">
                  <span
                    v-for="capability in selectedTemplateFacts.capabilities"
                    :key="`${selectedTemplate.id}-capability-${capability}`"
                    class="ew-studio-assets__tag"
                  >
                    {{ formatTemplateCapability(capability) }}
                  </span>
                </div>
              </div>
            </template>

            <button
              class="ew-studio-assets__create"
              @click="$emit('create-template', selectedTemplate.id)"
            >
              创建到编辑器
            </button>
          </template>
        </section>
      </template>

      <template v-else>
        <aside class="ew-studio-assets__master">
          <EwStudioComponentTree
            :entries="componentDirectory"
            :selected-id="selectedComponentEntryId"
            @select="selectedComponentEntryId = $event"
          />
        </aside>
        <section class="ew-studio-assets__detail">
          <template v-if="selectedComponentPreview">
            <div class="ew-studio-assets__chips">
              <span class="ew-studio-assets__chip">
                {{ formatCompositeKind(selectedComponentPreview.compositeKind) }}
              </span>
              <span
                v-if="selectedComponentPreview.featured"
                class="ew-studio-assets__chip"
              >
                精选
              </span>
              <span
                v-if="selectedComponentPreview.recommendedBuilderMode"
                class="ew-studio-assets__chip"
              >
                {{ formatBuilderMode(selectedComponentPreview.recommendedBuilderMode) }}
              </span>
            </div>
            <h3 class="ew-studio-assets__detail-title">
              {{ selectedComponentPreview.label }}
            </h3>
            <p class="ew-studio-assets__detail-text">
              {{ selectedComponentPreview.description }}
            </p>

            <div
              v-if="selectedComponentPreview.learningLabels.length > 0"
              class="ew-studio-assets__detail-block"
            >
              <div class="ew-studio-assets__label">构件标签</div>
              <div class="ew-studio-assets__tags">
                <span
                  v-for="label in selectedComponentPreview.learningLabels"
                  :key="`${selectedComponentPreview.moduleId}-learning-${label}`"
                  class="ew-studio-assets__tag"
                >
                  {{ label }}
                </span>
              </div>
            </div>

            <div
              v-if="selectedComponentPreview.entryContractLabels.length > 0"
              class="ew-studio-assets__detail-block"
            >
              <div class="ew-studio-assets__label">入口约定</div>
              <div class="ew-studio-assets__tags">
                <span
                  v-for="label in selectedComponentPreview.entryContractLabels"
                  :key="`${selectedComponentPreview.moduleId}-entry-${label}`"
                  class="ew-studio-assets__tag"
                >
                  {{ label }}
                </span>
              </div>
            </div>

            <div
              v-if="selectedComponentPreview.exitContractLabels.length > 0"
              class="ew-studio-assets__detail-block"
            >
              <div class="ew-studio-assets__label">出口约定</div>
              <div class="ew-studio-assets__tags">
                <span
                  v-for="label in selectedComponentPreview.exitContractLabels"
                  :key="`${selectedComponentPreview.moduleId}-exit-${label}`"
                  class="ew-studio-assets__tag"
                >
                  {{ label }}
                </span>
              </div>
            </div>

            <div
              v-if="selectedComponentPreview.retryReasonLabel"
              class="ew-studio-assets__detail-block"
            >
              <div class="ew-studio-assets__label">重试资格</div>
              <div class="ew-studio-assets__tags">
                <span class="ew-studio-assets__tag">
                  {{ selectedComponentPreview.retryReasonLabel }}
                </span>
                <span
                  v-for="label in selectedComponentPreview.retryBlockingLabels"
                  :key="`${selectedComponentPreview.moduleId}-retry-${label}`"
                  class="ew-studio-assets__tag"
                >
                  {{ label }}
                </span>
              </div>
            </div>

            <div
              v-if="selectedComponentPreview.childLabels.length > 0"
              class="ew-studio-assets__detail-block"
            >
              <div class="ew-studio-assets__label">内部层级</div>
              <div class="ew-studio-assets__tags">
                <span
                  v-for="label in selectedComponentPreview.childLabels"
                  :key="`${selectedComponentPreview.moduleId}-child-${label}`"
                  class="ew-studio-assets__tag"
                >
                  {{ label }}
                </span>
              </div>
            </div>
          </template>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import EwStudioComponentTree from "./EwStudioComponentTree.vue";
import {
  BUILDER_WORKFLOW_TEMPLATES,
  findBuilderWorkflowTemplate,
  getBuilderWorkflowTemplatePreviewFacts,
  type BuilderWorkflowTemplateCapability,
  type BuilderWorkflowTemplateStructureItem,
} from "../graph/builder-templates";
import {
  findStudioComponentDirectoryEntry,
  getFirstStudioComponentEntryId,
  getFirstStudioComponentModuleId,
  getStudioComponentDirectory,
  getStudioComponentPreview,
  type StudioComponentPreview,
} from "../graph/studio-library";
import { getModuleBlueprint } from "../graph/module-registry";
import type {
  BuilderTemplateFeatureFamily,
  BuilderTemplateKind,
  CompositeModuleKind,
  WorkbenchBuilderMode,
} from "../graph/module-types";

defineEmits<{
  (e: "create-template", templateId: string): void;
}>();

const activeTab = ref<"templates" | "components">("templates");
const templates = [...BUILDER_WORKFLOW_TEMPLATES];
const selectedTemplateId = ref<string>(templates[0]?.id ?? "blank_builder");
const componentDirectory = getStudioComponentDirectory();
const selectedComponentEntryId = ref<string | null>(null);

const selectedTemplate = computed(() =>
  findBuilderWorkflowTemplate(selectedTemplateId.value),
);

const selectedTemplateFacts = computed(() =>
  getBuilderWorkflowTemplatePreviewFacts(selectedTemplateId.value),
);

const selectedComponentModuleId = computed(() => {
  const entry = findStudioComponentDirectoryEntry(
    selectedComponentEntryId.value,
    componentDirectory,
  );
  if (entry?.moduleId) {
    return entry.moduleId;
  }
  return getFirstStudioComponentModuleId(componentDirectory);
});

const selectedComponentPreview = computed<StudioComponentPreview | null>(() =>
  getStudioComponentPreview(selectedComponentModuleId.value),
);

watch(
  () => activeTab.value,
  (tab) => {
    if (tab === "components" && !selectedComponentEntryId.value) {
      const firstEntryId = getFirstStudioComponentEntryId(componentDirectory);
      if (firstEntryId) {
        selectedComponentEntryId.value = firstEntryId;
      }
    }
  },
  { immediate: true },
);

const TEMPLATE_KIND_LABELS: Record<BuilderTemplateKind, string> = {
  starter: "Quick Start",
  composition_lab: "Composition Lab",
};

const TEMPLATE_FEATURE_FAMILY_LABELS: Record<
  BuilderTemplateFeatureFamily,
  string
> = {
  general: "通用起步",
  reply_inject: "回复注入",
  main_takeover: "主生成预备",
  floor_binding: "结果绑定",
  request_template: "模板实验",
  retry_fallback: "Retry / Fallback",
};

const TEMPLATE_CAPABILITY_LABELS: Record<
  BuilderWorkflowTemplateCapability,
  string
> = {
  control_flow: "含控制流",
  retry_boundary: "含重试边界",
  main_takeover: "主生成接管预备",
  request_template: "含请求模板",
  reply_output: "回复输出",
  floor_output: "楼层输出",
};

function formatBuilderMode(mode: WorkbenchBuilderMode): string {
  return mode === "simple" ? "Simple" : "Advanced";
}

function formatTemplateKind(kind: BuilderTemplateKind): string {
  return TEMPLATE_KIND_LABELS[kind];
}

function formatTemplateFeatureFamily(
  family: BuilderTemplateFeatureFamily,
): string {
  return TEMPLATE_FEATURE_FAMILY_LABELS[family];
}

function formatTemplateCapability(
  capability: BuilderWorkflowTemplateCapability,
): string {
  return TEMPLATE_CAPABILITY_LABELS[capability];
}

function formatStructureItem(
  item: BuilderWorkflowTemplateStructureItem,
): string {
  try {
    return `${item.role} · ${getModuleBlueprint(item.moduleId).label}`;
  } catch {
    return `${item.role} · ${item.moduleId}`;
  }
}

function formatCompositeKind(kind: CompositeModuleKind | "atomic"): string {
  switch (kind) {
    case "package":
      return "工作流包";
    case "fragment":
      return "可拆构件";
    default:
      return "原子节点";
  }
}
</script>

<style scoped>
.ew-studio-assets {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}

.ew-studio-assets__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.ew-studio-assets__eyebrow {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.42);
}

.ew-studio-assets__title {
  margin: 4px 0 0;
  font-size: 18px;
  color: rgba(255, 255, 255, 0.94);
}

.ew-studio-assets__copy {
  margin: 0;
  max-width: 460px;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.72);
}

.ew-studio-assets__tabs {
  display: inline-flex;
  gap: 6px;
}

.ew-studio-assets__tab {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  padding: 8px 14px;
  cursor: pointer;
}

.ew-studio-assets__tab.active {
  background: rgba(99, 102, 241, 0.2);
  border-color: rgba(99, 102, 241, 0.4);
  color: rgba(255, 255, 255, 0.94);
}

.ew-studio-assets__body {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: 14px;
  min-height: 0;
}

.ew-studio-assets__master,
.ew-studio-assets__detail {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(8, 12, 24, 0.72);
  border-radius: 20px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.ew-studio-assets__master {
  overflow: auto;
}

.ew-studio-assets__list-item {
  display: grid;
  gap: 4px;
  text-align: left;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.88);
  border-radius: 14px;
  padding: 12px;
  cursor: pointer;
}

.ew-studio-assets__list-item.active {
  background: rgba(99, 102, 241, 0.16);
  border-color: rgba(99, 102, 241, 0.38);
}

.ew-studio-assets__list-item span {
  font-size: 12px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.66);
}

.ew-studio-assets__detail-title {
  margin: 0;
  font-size: 18px;
  color: rgba(255, 255, 255, 0.96);
}

.ew-studio-assets__detail-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.72);
}

.ew-studio-assets__detail-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ew-studio-assets__label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.44);
}

.ew-studio-assets__chips,
.ew-studio-assets__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ew-studio-assets__chip,
.ew-studio-assets__tag {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.84);
  font-size: 11px;
}

.ew-studio-assets__create {
  margin-top: auto;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(99, 102, 241, 0.18);
  color: rgba(255, 255, 255, 0.96);
  border-radius: 14px;
  padding: 12px 14px;
  cursor: pointer;
}

@media (max-width: 1100px) {
  .ew-studio-assets__header {
    flex-direction: column;
  }

  .ew-studio-assets__body {
    grid-template-columns: 1fr;
  }
}
</style>
